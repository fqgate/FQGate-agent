import { McpAppRuntime } from "@/adapters/mcp-app";
import "@/styles/market-ui.css";

export { readSecurities, readSecurity } from "./securityArguments";

export const MCP_APP_VERSION = "0.4.1";
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

export interface NativeApp {
  start?(): void;
  destroy(): void;
}

/** 原生 App 统一接入页面生命周期，避免隐藏或销毁后继续轮询。 */
export function mountNativeApp(app: NativeApp): void {
  app.start?.();
  window.addEventListener("pagehide", () => app.destroy(), { once: true });
}

export function showEntryError(error: unknown): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  root.className = "mcp-app-entry-error";
  root.textContent = error instanceof Error ? error.message : "组件加载失败。";
}
