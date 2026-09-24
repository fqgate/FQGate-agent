import { ConfigProvider } from "@arco-design/web-vue";
import { createApp, h, type Component } from "vue";
import appConfig from "../../mcp-apps/apps.json";

import { McpAppRuntime, type JsonObject } from "@/adapters/mcp-app";
import type { MarketSecurity } from "@/shared/contracts";
import "@/style.css";

export const MCP_APP_VERSION = appConfig.bundleVersion;
export const FQGATE_LOOPBACK_URL = "http://127.0.0.1:17281";

export async function connectMcpApp(
  name: string,
  originatingToolName?: string
): Promise<McpAppRuntime> {
  const runtime = new McpAppRuntime(name, MCP_APP_VERSION, originatingToolName);
  await runtime.connect();
  window.addEventListener("pagehide", () => void runtime.destroy(), { once: true });
  return runtime;
}

/**
 * 各 MCP App 入口仅在这里挂载现有组件。传入的是原组件本身，而不是任何
 * Codex 专用模板，因此组件布局调整会在下一次构建时自动进入所有宿主。
 */
export function mountSharedComponent(component: Component, props: JsonObject): void {
  createApp({
    render: () => h(ConfigProvider, { size: "small" }, {
      default: () => h(component, props)
    })
  }).mount("#app");
}

export function readSecurity(argumentsValue: JsonObject | undefined): MarketSecurity | undefined {
  if (!argumentsValue) return undefined;
  const nested = isJsonObject(argumentsValue.security) ? argumentsValue.security : argumentsValue;
  const market = stringValue(nested.market);
  const code = stringValue(nested.code);
  if (!market || !code) return undefined;
  return {
    market,
    code,
    name: stringValue(nested.name),
    fullCode: stringValue(nested.fullCode) ?? stringValue(nested.full_code) ?? `${market}${code}`
  };
}

export function readSecurities(argumentsValue: JsonObject | undefined): MarketSecurity[] {
  if (!argumentsValue) return [];
  if (Array.isArray(argumentsValue.securities)) {
    return argumentsValue.securities
      .map((value) => isJsonObject(value) ? readSecurity(value) : undefined)
      .filter((value): value is MarketSecurity => value !== undefined);
  }
  const security = readSecurity(argumentsValue);
  return security ? [security] : [];
}

export function showEntryError(error: unknown): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  root.className = "mcp-app-entry-error";
  root.textContent = error instanceof Error ? error.message : "组件加载失败。";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
