import type {
  MarketDepthData,
  MarketDepthFallbackReason,
  MarketDepthLevel,
  MarketDepthMode,
  MarketDepthService,
  MarketSecurity,
  MarketTransaction
} from "@/shared/contracts";
import {
  FqgateApiError,
  FqgateHttpClient,
  type FqgateHttpClientOptions
} from "./FqgateHttpClient";
import {
  MARKET_TRANSACTION_LIMIT,
  parseBasicDepth,
  parseBasicTransactions,
  parseLevel2Depth,
  parseLevel2Transactions,
  type FqgateMarketDataPayload
} from "./FqgateMarketDataParsers";

interface FqgateMarketHealth {
  connected: boolean;
  network_ready: boolean;
  level2_permission: boolean | null;
  reason?: string;
}

interface LoadedMarketDetails {
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  transactions: MarketTransaction[];
}

export type FqgateMarketDepthServiceOptions = FqgateHttpClientOptions;

/**
 * FQGate 个股盘口快照适配器。它负责首屏和断线重同步，持续更新由
 * FqgateMarketRealtimeService 接管，二者共享同一套字段解析规则。
 */
export class FqgateMarketDepthService implements MarketDepthService {
  readonly kind = "fqgate-local-api";
  private readonly client: FqgateHttpClient;

  constructor(options: FqgateMarketDepthServiceOptions = {}) {
    this.client = new FqgateHttpClient({ ...options, timeoutMs: options.timeoutMs ?? 32_000 });
  }

  get connection() {
    return this.client.connection;
  }

  async getMarketDepth(
    security: MarketSecurity,
    signal?: AbortSignal
  ): Promise<MarketDepthData> {
    const health = await this.client.get<FqgateMarketHealth>("/v1/market/health", signal);
    if (!health.network_ready || !health.connected) {
      throw new Error(health.reason || "行情数据暂不可用，请确认已完成行情登录。");
    }

    if (health.level2_permission === true) {
      try {
        return this.toResult(security, "level2", undefined, await this.loadLevel2(security, signal));
      } catch (error) {
        if (!(error instanceof FqgateApiError) || error.code !== 3006) throw error;
        return this.toResult(
          security,
          "basic",
          "permission_denied",
          await this.loadBasic(security, signal)
        );
      }
    }

    const fallbackReason: MarketDepthFallbackReason = health.level2_permission === false
      ? "level2_not_enabled"
      : "level2_unknown";
    return this.toResult(security, "basic", fallbackReason, await this.loadBasic(security, signal));
  }

  private async loadLevel2(
    security: MarketSecurity,
    signal?: AbortSignal
  ): Promise<LoadedMarketDetails> {
    const [depthData, transactionData] = await Promise.all([
      this.client.post<FqgateMarketDataPayload>(
        "/v1/market/level2/depth",
        { securities: [securityRequest(security)] },
        signal,
        30_000
      ),
      this.client.post<FqgateMarketDataPayload>(
        "/v1/market/level2/transactions",
        {
          ...securityRequest(security),
          fields: ["source_tick_id", "price", "side", "volume", "trade_time"],
          count: MARKET_TRANSACTION_LIMIT,
          end_time: 0,
          require_data: false,
          semantic: true
        },
        signal,
        30_000
      )
    ]);
    const depth = parseLevel2Depth(depthData);
    return {
      ...depth,
      transactions: parseLevel2Transactions(transactionData)
    };
  }

  private async loadBasic(
    security: MarketSecurity,
    signal?: AbortSignal
  ): Promise<LoadedMarketDetails> {
    const [depthData, transactionData] = await Promise.all([
      this.client.post<FqgateMarketDataPayload>(
        "/v1/market/history/depth",
        { securities: [securityRequest(security)] },
        signal,
        30_000
      ),
      this.client.post<FqgateMarketDataPayload>(
        "/v1/market/history/tick",
        securityRequest(security),
        signal,
        30_000
      )
    ]);
    return {
      ...parseBasicDepth(depthData),
      transactions: parseBasicTransactions(transactionData)
    };
  }

  private toResult(
    security: MarketSecurity,
    mode: MarketDepthMode,
    fallbackReason: MarketDepthFallbackReason | undefined,
    loaded: LoadedMarketDetails
  ): MarketDepthData {
    return {
      security: completeSecurity(security),
      mode,
      fallbackReason,
      fetchedAt: new Date().toISOString(),
      ...loaded
    };
  }
}

function securityRequest(security: MarketSecurity): { market: string; code: string } {
  return { market: security.market, code: security.code };
}

function completeSecurity(security: MarketSecurity): Required<MarketSecurity> {
  return {
    market: security.market,
    code: security.code,
    name: security.name || security.code,
    fullCode: security.fullCode || `${security.market}${security.code}`
  };
}
