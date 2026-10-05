import { McpFqgateFetch, McpPollingMarketQuoteService } from "@/adapters/mcp-app";
import { MarketQuotesApp } from "@/apps/MarketQuotesApp";
import {
  applyPreviewHostActionInset,
  readPreviewSourceContext,
  requestPreviewSourceSelection,
} from "@/shared/previewSource";
import { requiredRoot } from "@/ui/dom";
import {
  FQGATE_LOOPBACK_URL,
  connectMcpApp,
  mountNativeApp,
  readSecurities,
  showEntryError
} from "./bootstrap";

async function main(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-market-quotes", "fqgate_quote_mainland");
  const argumentsValue = await runtime.waitForToolInput();
  const securities = readSecurities(argumentsValue);
  if (securities.length === 0) throw new Error("没有收到多股行情所需的证券列表。");
  const previewSource = readPreviewSourceContext(argumentsValue);
  applyPreviewHostActionInset(argumentsValue);

  const bridge = new McpFqgateFetch(runtime);
  const service = new McpPollingMarketQuoteService({
    baseUrl: FQGATE_LOOPBACK_URL,
    fetch: bridge.fetch
  });
  mountNativeApp(new MarketQuotesApp(requiredRoot(), service, securities, {
    previewSource,
    onPreviewSourceChange: requestPreviewSourceSelection,
  }));
}

void main().catch(showEntryError);
