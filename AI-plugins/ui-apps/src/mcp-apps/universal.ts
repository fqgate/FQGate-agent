import { McpFqgateFetch, McpPollingMarketQuoteService, McpPollingMarketRealtimeService, McpPollingOrderFlowService } from "@/adapters/mcp-app";
import {
  FqgateCandleService,
  FqgateInformationService,
  FqgateLoginService,
  FqgateMarketDepthService,
  FqgateSecuritySearchService
} from "@/adapters/local-api";
import CandlePanel from "@/components/candle/CandlePanel.vue";
import LoginPanel from "@/components/login/LoginPanel.vue";
import MarketQuotesPanel from "@/components/market-quotes/MarketQuotesPanel.vue";
import OrderFlowWatchPanel from "@/components/order-flow/OrderFlowWatchPanel.vue";
import InformationPreview from "@/previews/InformationPreview.vue";
import type { KlineAdjustment, KlineInterval } from "@/shared/contracts";
import type { McpAppRuntime } from "@/adapters/mcp-app";
import {
  FQGATE_LOOPBACK_URL,
  connectMcpApp,
  mountSharedComponent,
  readSecurity,
  readSecurities
} from "./bootstrap";

const KLINE_INTERVALS = new Set<KlineInterval>([
  "intraday", "five_day", "1m", "5m", "15m", "30m", "60m", "day", "week", "month"
]);

const TOOL_TO_COMPONENT: Record<string, ComponentKey> = {
  fqgate_market_qr_login_begin: "login",
  fqgate_market_klines: "candle",
  fqgate_market_news: "information",
  fqgate_market_market_data_cn: "market-quotes",
  fqgate_market_level2_orders: "order-flow"
};

type ComponentKey = keyof typeof COMPONENT_TITLES;
const COMPONENT_TITLES = {
  login: "登录",
  candle: "个股行情",
  information: "资讯",
  "market-quotes": "多股行情",
  "order-flow": "L2 - 逐笔委托"
} as const;

/** MCP 宿主和本机预览共用的单一资源入口。 */
export async function mountMcpUi(): Promise<void> {
  const runtime = await connectMcpApp("fqgate-mcp-ui");
  const toolName = await readOriginatingToolName(runtime);
  const component = toolName ? TOOL_TO_COMPONENT[toolName] : undefined;
  if (!component) {
    throw new Error(`无法确定 MCP UI 对应的组件：${toolName ?? "未知工具"}。`);
  }
  await mountComponent(runtime, component);
}

async function readOriginatingToolName(runtime: McpAppRuntime): Promise<string | undefined> {
  const initial = runtime.getOriginatingToolSnapshot().name;
  if (initial) return initial;
  await runtime.waitForToolResult(2_000);
  return runtime.getOriginatingToolSnapshot().name;
}

async function mountComponent(runtime: McpAppRuntime, component: ComponentKey): Promise<void> {
  const bridge = new McpFqgateFetch(runtime);
  const serviceOptions = { baseUrl: FQGATE_LOOPBACK_URL, fetch: bridge.fetch };
  const argumentsValue = runtime.getOriginatingToolSnapshot().arguments
    ?? await runtime.waitForToolInput();

  switch (component) {
    case "login":
      mountSharedComponent(LoginPanel, { service: new FqgateLoginService(serviceOptions) });
      return;
    case "candle": {
      const security = readSecurity(argumentsValue);
      if (!security) throw new Error("没有收到个股行情所需的证券代码。");
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
      return;
    }
    case "information": {
      const security = readSecurity(argumentsValue);
      if (!security) throw new Error("没有收到资讯查询所需的证券代码。");
      mountSharedComponent(InformationPreview, {
        service: new FqgateInformationService(serviceOptions),
        security
      });
      return;
    }
    case "market-quotes": {
      const securities = readSecurities(argumentsValue);
      if (securities.length === 0) throw new Error("没有收到多股行情所需的证券列表。");
      mountSharedComponent(MarketQuotesPanel, {
        service: new McpPollingMarketQuoteService(serviceOptions),
        securities,
        active: true
      });
      return;
    }
    case "order-flow":
      mountSharedComponent(OrderFlowWatchPanel, {
        service: new McpPollingOrderFlowService(serviceOptions),
        loginService: new FqgateLoginService(serviceOptions),
        initialSecurity: readSecurity(argumentsValue),
        active: true
      });
      return;
  }
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
