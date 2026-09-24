export type UiTransportMode = "http" | "mcp";

/**
 * 通用 UI 只保留一个构建入口。FQGate 回环地址默认走 HTTP，
 * MCP 宿主通常会把资源放入自己的沙箱地址，因此走 MCP；测试和演示
 * 页面可以通过查询参数显式指定模式。
 */
export function resolveUiTransportMode(locationValue: Location = globalThis.location): UiTransportMode {
  const requested = new URLSearchParams(locationValue.search).get("transport");
  if (requested === "http" || requested === "mcp") return requested;

  const hostname = locationValue.hostname.toLowerCase();
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  return isLoopback && (locationValue.protocol === "http:" || locationValue.protocol === "https:")
    ? "http"
    : "mcp";
}
