import { McpFqgateFetch, McpPollingOrderFlowService } from "@/adapters/mcp-app";
import { OrderFlowApp } from "@/apps/OrderFlowApp";
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
  readSecurity,
  showEntryError
} from "./bootstrap";

async function main(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-order-flow", "fqgate_level2_order_events");
  const argumentsValue = await runtime.waitForToolInput(1_000);
  const initialSecurity = readSecurity(argumentsValue);
  const previewSource = readPreviewSourceContext(argumentsValue);
  applyPreviewHostActionInset(argumentsValue);
  const bridge = new McpFqgateFetch(runtime);
  const serviceOptions = { baseUrl: FQGATE_LOOPBACK_URL, fetch: bridge.fetch };
  mountNativeApp(new OrderFlowApp(
    requiredRoot(),
    new McpPollingOrderFlowService(serviceOptions),
    initialSecurity,
    {
      previewSource,
      onPreviewSourceChange: requestPreviewSourceSelection,
    },
  ));
}

void main().catch(showEntryError);
