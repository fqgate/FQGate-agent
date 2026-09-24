import {
  FqgateApiError,
  FqgateHttpClient,
  type FqgateHttpClientOptions
} from "@/adapters/local-api/FqgateHttpClient";
import type { FqgateStandardQuoteData } from "@/adapters/local-api/FqgateMarketDataParsers";
import {
  parseOrderFlowRecords,
  parseStandardOrderFlowQuote
} from "@/adapters/local-api/FqgateOrderFlowParsers";
import { searchFqgateSecurities } from "@/adapters/local-api/FqgateSecuritySearchService";
import { toFqgateStandardSecurity } from "@/adapters/local-api/FqgateStandardMarket";
import type {
  MarketSecurity,
  OrderFlowDataMode,
  OrderFlowFallbackReason,
  OrderFlowRecord,
  OrderFlowWatchConnection,
  OrderFlowWatchListener,
  OrderFlowWatchService
} from "@/shared/contracts";
import { McpPollingConnection, type McpPollingState } from "./McpPollingConnection";

interface FqgateMarketHealth {
  connected: boolean;
  network_ready: boolean;
  level2_permission: boolean | null;
  reason?: string;
}

export interface McpPollingOrderFlowServiceOptions extends FqgateHttpClientOptions {
  pollIntervalMs?: number;
}

const ORDER_FIELDS = [
  "order_no", "price", "side", "volume", "amount", "order_time", "request_time"
];
const CANCEL_FIELDS = [
  "order_no", "latest_price", "price", "volume", "amount", "request_time", "cancel_time"
];

/** MCP Apps 版逐笔委托，通过 MCP 快照轮询代替组件内 WebSocket。 */
export class McpPollingOrderFlowService implements OrderFlowWatchService {
  readonly kind = "fqgate-mcp-polling";

  private readonly client: FqgateHttpClient;
  private readonly pollIntervalMs: number;

  constructor(options: McpPollingOrderFlowServiceOptions = {}) {
    this.client = new FqgateHttpClient(options);
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
  }

  get connection() {
    return this.client.connection;
  }

  searchSecurities(pattern: string, signal?: AbortSignal): Promise<MarketSecurity[]> {
    return searchFqgateSecurities(this.client, pattern, signal);
  }

  async connect(
    security: MarketSecurity,
    listener: OrderFlowWatchListener,
    signal?: AbortSignal
  ): Promise<OrderFlowWatchConnection> {
    let mode: OrderFlowDataMode | undefined;
    let successfulPolls = 0;
    const connection = new McpPollingConnection({
      signal,
      intervalMs: this.pollIntervalMs,
      retryIntervalMs: 3_000,
      poll: async (pollSignal) => {
        if (!mode || successfulPolls % 10 === 0) {
          const health = await this.client.get<FqgateMarketHealth>("/v1/market/health", pollSignal);
          if (!health.connected || !health.network_ready) {
            throw new Error(health.reason || "实时数据不可用，请确认已完成行情登录。");
          }
          mode = health.level2_permission === true ? "level2" : "basic";
          listener.onModeChange({
            mode,
            fallbackReason: fallbackReasonFromHealth(health.level2_permission)
          });
        }

        const quoteData = await this.client.post<FqgateStandardQuoteData>("/v2/market/quotes", {
          securities: [toFqgateStandardSecurity(security)],
          fields: ["latest", "previous_close"]
        }, pollSignal);
        const quote = parseStandardOrderFlowQuote(quoteData);
        if (quote) listener.onQuote(quote);

        if (mode === "level2") {
          try {
            listener.onRecords(await this.loadLevel2Records(security, pollSignal));
          } catch (error) {
            if (!(error instanceof FqgateApiError) || error.code !== 3006) throw error;
            mode = "basic";
            listener.onModeChange({ mode, fallbackReason: "permission_denied" });
          }
        }
        successfulPolls += 1;
      },
      onStateChange: (state) => listener.onConnectionState(state, pollingStateMessage(state)),
      onError: (error) => listener.onError(error.message)
    });
    return { close: () => connection.close() };
  }

  private async loadLevel2Records(
    security: MarketSecurity,
    signal: AbortSignal
  ): Promise<OrderFlowRecord[]> {
    const baseRequest = {
      market: security.market,
      code: security.code,
      range: { mode: "recent", count: 200, end: 0 },
      semantic: true,
      require_data: false
    };
    const [orders, buyCancels, sellCancels] = await Promise.all([
      this.client.post<unknown>(
        "/v1/market/level2/orders",
        { ...baseRequest, fields: ORDER_FIELDS },
        signal,
        30_000
      ),
      this.client.post<unknown>(
        "/v1/market/level2/cancellations/buy",
        { ...baseRequest, fields: CANCEL_FIELDS },
        signal,
        30_000
      ),
      this.client.post<unknown>(
        "/v1/market/level2/cancellations/sell",
        { ...baseRequest, fields: CANCEL_FIELDS },
        signal,
        30_000
      )
    ]);
    return [
      ...parseOrderFlowRecords(orders, "order", "order_detail"),
      ...parseOrderFlowRecords(buyCancels, "cancel", "buy_cancel"),
      ...parseOrderFlowRecords(sellCancels, "cancel", "sell_cancel")
    ];
  }
}

function fallbackReasonFromHealth(
  permission: boolean | null
): OrderFlowFallbackReason | undefined {
  if (permission === false) return "level2_not_enabled";
  if (permission === null) return "level2_unknown";
  return undefined;
}

function pollingStateMessage(state: McpPollingState): string {
  if (state === "connected") return "实时数据已连接";
  if (state === "reconnecting") return "实时数据连接中断，正在重试";
  if (state === "closed") return "实时数据已暂停";
  return "正在连接实时数据…";
}
