import {
  FqgateHttpClient,
  type FqgateHttpClientOptions
} from "@/adapters/local-api/FqgateHttpClient";
import { FqgateMarketDepthService } from "@/adapters/local-api/FqgateMarketDepthService";
import {
  parseRealtimePoints,
  parseRealtimeQuote,
  type FqgateMarketDataPayload
} from "@/adapters/local-api/FqgateMarketDataParsers";
import type {
  MarketDepthFallbackReason,
  MarketDepthMode,
  MarketRealtimeConnection,
  MarketRealtimeListener,
  MarketRealtimeService,
  MarketSecurity
} from "@/shared/contracts";
import { McpPollingConnection, type McpPollingState } from "./McpPollingConnection";

interface FqgateMarketHealth {
  connected: boolean;
  network_ready: boolean;
  level2_permission: boolean | null;
  reason?: string;
}

export interface McpPollingMarketRealtimeServiceOptions extends FqgateHttpClientOptions {
  pollIntervalMs?: number;
  detailEvery?: number;
}

/** MCP Apps 版个股实时层，不从组件沙箱直接访问 WebSocket。 */
export class McpPollingMarketRealtimeService implements MarketRealtimeService {
  readonly kind = "fqgate-mcp-polling";

  private readonly client: FqgateHttpClient;
  private readonly marketDepthService: FqgateMarketDepthService;
  private readonly pollIntervalMs: number;
  private readonly detailEvery: number;

  constructor(options: McpPollingMarketRealtimeServiceOptions = {}) {
    this.client = new FqgateHttpClient(options);
    this.marketDepthService = new FqgateMarketDepthService(options);
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.detailEvery = Math.max(1, options.detailEvery ?? 5);
  }

  get connection() {
    return this.client.connection;
  }

  async connect(
    security: MarketSecurity,
    listener: MarketRealtimeListener,
    signal?: AbortSignal
  ): Promise<MarketRealtimeConnection> {
    let successfulPolls = 0;
    let mode: MarketDepthMode | undefined;
    let fallbackReason: MarketDepthFallbackReason | undefined;

    const connection = new McpPollingConnection({
      signal,
      intervalMs: this.pollIntervalMs,
      retryIntervalMs: 3_000,
      poll: async (pollSignal) => {
        const refreshDetails = successfulPolls > 0 && successfulPolls % this.detailEvery === 0;
        if (!mode || refreshDetails) {
          const health = await this.client.get<FqgateMarketHealth>("/v1/market/health", pollSignal);
          if (!health.connected || !health.network_ready) {
            throw new Error(health.reason || "实时行情不可用，请确认已完成行情登录。");
          }
          const nextMode: MarketDepthMode = health.level2_permission === true ? "level2" : "basic";
          const nextFallback = fallbackReasonFromHealth(health.level2_permission);
          if (mode !== nextMode || fallbackReason !== nextFallback) {
            mode = nextMode;
            fallbackReason = nextFallback;
            listener.onModeChange(nextMode, nextFallback);
          }
        }

        const quoteData = await this.client.post<FqgateMarketDataPayload>(
          "/v1/market/realtime/quote",
          {
            securities: [{ market: security.market, code: security.code }],
            fields: [5, 6, 7, 8, 9, 10, 13, 19, 1968584]
          },
          pollSignal
        );
        const quote = parseRealtimeQuote(quoteData);
        if (quote) listener.onQuote(quote);

        if (refreshDetails) {
          await this.refreshDetails(security, listener, pollSignal);
        }
        successfulPolls += 1;
      },
      onStateChange: (state) => listener.onConnectionState(state, pollingStateMessage(state)),
      onError: (error) => listener.onError(error.message)
    });
    return { close: () => connection.close() };
  }

  /** 盘口和整段分时变化较慢，降低刷新频率，避免给 AI 工具造成高频调用压力。 */
  private async refreshDetails(
    security: MarketSecurity,
    listener: MarketRealtimeListener,
    signal: AbortSignal
  ): Promise<void> {
    const [intraday, depth] = await Promise.allSettled([
      this.client.post<FqgateMarketDataPayload>(
        "/v1/market/history/intraday",
        { market: security.market, code: security.code },
        signal
      ),
      this.marketDepthService.getMarketDepth(security, signal)
    ]);
    if (intraday.status === "fulfilled") {
      const points = parseRealtimePoints(intraday.value);
      if (points.length) listener.onIntraday(points);
    }
    if (depth.status === "fulfilled") {
      listener.onModeChange(depth.value.mode, depth.value.fallbackReason);
      listener.onDepth(depth.value.bids, depth.value.asks);
      if (depth.value.transactions.length) listener.onTransactions(depth.value.transactions);
    }
  }
}

function fallbackReasonFromHealth(
  permission: boolean | null
): MarketDepthFallbackReason | undefined {
  if (permission === false) return "level2_not_enabled";
  if (permission === null) return "level2_unknown";
  return undefined;
}

function pollingStateMessage(state: McpPollingState): string {
  if (state === "connected") return "实时行情已连接";
  if (state === "reconnecting") return "实时行情连接中断，正在重试";
  if (state === "closed") return "实时行情已暂停";
  return "正在连接实时行情…";
}
