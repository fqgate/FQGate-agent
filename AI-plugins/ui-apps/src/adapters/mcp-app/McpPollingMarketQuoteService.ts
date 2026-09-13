import type {
  MarketQuoteService,
  MarketQuoteSubscription,
  QuoteStreamHandlers
} from "@/components/market-quotes/contracts";
import { FqgateMarketQuoteSnapshotService } from "@/adapters/local-api/FqgateMarketQuoteService";
import type { FqgateHttpClientOptions } from "@/adapters/local-api/FqgateHttpClient";
import type { MarketSecurity } from "@/shared/contracts";
import { McpPollingConnection } from "./McpPollingConnection";

export interface McpPollingMarketQuoteServiceOptions extends FqgateHttpClientOptions {
  pollIntervalMs?: number;
}

/** MCP Apps 版多股行情：所有刷新都通过宿主调用 MCP 工具。 */
export class McpPollingMarketQuoteService implements MarketQuoteService {
  readonly kind = "fqgate-mcp-polling";

  private readonly snapshotService: FqgateMarketQuoteSnapshotService;
  private readonly pollIntervalMs: number;

  constructor(options: McpPollingMarketQuoteServiceOptions = {}) {
    this.snapshotService = new FqgateMarketQuoteSnapshotService(options);
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
  }

  get connection() {
    return this.snapshotService.connection;
  }

  getQuotes(securities: readonly MarketSecurity[], signal?: AbortSignal) {
    return this.snapshotService.getQuotes(securities, signal);
  }

  getIntradayTrends(securities: readonly MarketSecurity[], signal?: AbortSignal) {
    return this.snapshotService.getIntradayTrends(securities, signal);
  }

  subscribe(
    securities: readonly MarketSecurity[],
    handlers: QuoteStreamHandlers
  ): MarketQuoteSubscription {
    const connection = new McpPollingConnection({
      initialState: "connected",
      initialDelayMs: this.pollIntervalMs,
      intervalMs: this.pollIntervalMs,
      retryIntervalMs: 3_000,
      poll: async (signal) => {
        const quotes = await this.snapshotService.getQuotes(securities, signal);
        for (const quote of quotes) handlers.onQuote(quote);
      },
      onStateChange: handlers.onStateChange,
      onError: handlers.onError
    });
    return { close: () => connection.close() };
  }
}
