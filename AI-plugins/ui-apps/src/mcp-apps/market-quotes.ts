import { McpFqgateFetch, McpPollingMarketQuoteService } from "@/adapters/mcp-app";
import MarketQuotesPanel from "@/components/market-quotes/MarketQuotesPanel.vue";
import {
  FQGATE_LOOPBACK_URL,
  connectMcpApp,
  mountSharedComponent,
  readSecurities,
  showEntryError
} from "./bootstrap";

async function main(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-market-quotes", "fqgate_market_market_data_cn");
  const securities = readSecurities(await runtime.waitForToolInput());
  if (securities.length === 0) throw new Error("没有收到多股行情所需的证券列表。");

  const bridge = new McpFqgateFetch(runtime);
  const service = new McpPollingMarketQuoteService({
    baseUrl: FQGATE_LOOPBACK_URL,
    fetch: bridge.fetch
  });
  mountSharedComponent(MarketQuotesPanel, { service, securities, active: true });
}

void main().catch(showEntryError);
