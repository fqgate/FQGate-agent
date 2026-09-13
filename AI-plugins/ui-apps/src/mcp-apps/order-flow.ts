import { McpFqgateFetch, McpPollingOrderFlowService } from "@/adapters/mcp-app";
import { FqgateLoginService } from "@/adapters/local-api";
import OrderFlowWatchPanel from "@/components/order-flow/OrderFlowWatchPanel.vue";
import {
  FQGATE_LOOPBACK_URL,
  connectMcpApp,
  mountSharedComponent,
  readSecurity,
  showEntryError
} from "./bootstrap";

async function main(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-order-flow", "fqgate_market_level2_orders");
  const initialSecurity = readSecurity(await runtime.waitForToolInput(1_000));
  const bridge = new McpFqgateFetch(runtime);
  const serviceOptions = { baseUrl: FQGATE_LOOPBACK_URL, fetch: bridge.fetch };
  mountSharedComponent(OrderFlowWatchPanel, {
    service: new McpPollingOrderFlowService(serviceOptions),
    loginService: new FqgateLoginService(serviceOptions),
    initialSecurity,
    active: true
  });
}

void main().catch(showEntryError);
