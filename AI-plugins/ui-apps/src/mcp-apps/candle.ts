import { McpFqgateFetch, McpPollingMarketRealtimeService } from "@/adapters/mcp-app";
import {
  FqgateCandleService,
  FqgateSecuritySearchService,
  FqgateMarketDepthService
} from "@/adapters/local-api";
import CandlePanel from "@/components/candle/CandlePanel.vue";
import type { KlineAdjustment, KlineInterval } from "@/shared/contracts";
import {
  FQGATE_LOOPBACK_URL,
  connectMcpApp,
  mountSharedComponent,
  readSecurity,
  showEntryError
} from "./bootstrap";

const KLINE_INTERVALS = new Set<KlineInterval>([
  "intraday", "five_day", "1m", "5m", "15m", "30m", "60m", "day", "week", "month"
]);

async function main(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-candle", "fqgate_market_klines");
  const argumentsValue = await runtime.waitForToolInput();
  const security = readSecurity(argumentsValue);
  if (!security) throw new Error("没有收到个股行情所需的证券代码。");

  const bridge = new McpFqgateFetch(runtime);
  const serviceOptions = { baseUrl: FQGATE_LOOPBACK_URL, fetch: bridge.fetch };
  mountSharedComponent(CandlePanel, {
    service: new FqgateCandleService(serviceOptions),
    securityService: new FqgateSecuritySearchService(serviceOptions),
    marketDepthService: new FqgateMarketDepthService(serviceOptions),
    realtimeService: new McpPollingMarketRealtimeService(serviceOptions),
    security,
    initialInterval: readInterval(argumentsValue?.interval),
    count: positiveInteger(argumentsValue?.count) ?? 160,
    adjustment: readAdjustment(argumentsValue?.adjust)
  });
}

function readInterval(value: unknown): KlineInterval | undefined {
  return typeof value === "string" && KLINE_INTERVALS.has(value as KlineInterval)
    ? value as KlineInterval
    : undefined;
}

function readAdjustment(value: unknown): KlineAdjustment {
  return value === "forward" || value === "backward" ? value : "";
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

void main().catch(showEntryError);
