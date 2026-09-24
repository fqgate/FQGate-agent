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

const RESOURCE_TO_COMPONENT: Record<string, ComponentKey> = {
  login: "login",
  candle: "candle",
  information: "information",
  "market-quotes": "market-quotes",
  "order-flow": "order-flow"
};

declare global {
  interface Window {
    /** FQGate 在 resources/read 时注入的逻辑页面提示。 */
    __FQGATE_MCP_APP_HINT__?: unknown;
  }
}

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
  const snapshot = await readOriginatingToolSnapshot(runtime);
  const component = resolveToolComponent(snapshot.name)
    ?? resolveComponentHint(window.__FQGATE_MCP_APP_HINT__)
    ?? resolveComponentFromLocation();
  if (!component) {
    throw new Error(`无法确定 MCP UI 对应的组件：${snapshot.name ?? "未知工具"}。`);
  }
  await mountComponent(runtime, component);
}

async function readOriginatingToolSnapshot(runtime: McpAppRuntime) {
  const initial = runtime.getOriginatingToolSnapshot();
  if (initial.name) return initial;
  await runtime.waitForToolResult(2_000);
  return runtime.getOriginatingToolSnapshot();
}

function resolveToolComponent(toolName: string | undefined): ComponentKey | undefined {
  return toolName ? TOOL_TO_COMPONENT[toolName] : undefined;
}

/**
 * 资源预览模式不一定有来源工具，使用 FQGate 传入的资源提示作为兜底。
 * 提示只包含已验签清单中的 id/URI，不会改变组件或接口权限。
 */
function resolveComponentHint(value: unknown): ComponentKey | undefined {
  if (typeof value === "string") return resolveResourceComponent(value);
  if (!isJsonObject(value)) return undefined;
  return resolveResourceComponent(stringValue(value.id))
    ?? resolveResourceComponent(stringValue(value.resourceUri))
    ?? resolveResourceComponent(stringValue(value.resource_uri));
}

function resolveComponentFromLocation(): ComponentKey | undefined {
  const query = new URLSearchParams(window.location.search);
  const candidates = [
    query.get("component"),
    query.get("app"),
    query.get("resourceUri"),
    query.get("resource_uri"),
    window.location.hash.replace(/^#/, "")
  ];
  for (const candidate of candidates) {
    const component = resolveResourceComponent(candidate ?? undefined);
    if (component) return component;
  }
  return resolveResourceComponent(window.location.pathname);
}

function resolveResourceComponent(value: string | undefined): ComponentKey | undefined {
  if (!value) return undefined;
  let normalized = value.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // 无法解码时继续使用原值；后续只按固定资源名匹配。
  }
  normalized = normalized.replace(/^ui:\/\/fqgate\//, "");
  normalized = normalized.split(/[?#]/, 1)[0].replace(/^.*\//, "");
  normalized = normalized.replace(/\.html$/i, "");
  return RESOURCE_TO_COMPONENT[normalized];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
