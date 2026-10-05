import type { JsonObject } from "@/adapters/mcp-app";

export type PreviewSourceDepthMode = "basic" | "level2" | "auto";

export interface PreviewSourceOption {
  id: string;
  label: string;
  depthMode: PreviewSourceDepthMode;
  /** 宿主依据数据源能力标记资讯是否可用；旧宿主缺省时保持兼容。 */
  supportsInformation?: boolean;
  disabled?: boolean;
}

export interface PreviewSourceContext {
  selectedInstanceId: string;
  sources: PreviewSourceOption[];
}

const MAX_HOST_ACTION_INSET = 160;

/** FQGate Desktop 通过入口参数提供账号目录；其他 MCP 宿主不受该扩展影响。 */
export function readPreviewSourceContext(
  argumentsValue: JsonObject | undefined,
): PreviewSourceContext | undefined {
  const value = argumentsValue?._fqgatePreview;
  if (!isRecord(value) || !Array.isArray(value.sources)) return undefined;
  const sources = value.sources.flatMap((source) => {
    if (!isRecord(source)) return [];
    const id = stringValue(source.id);
    const label = stringValue(source.label);
    if (!id || !label) return [];
    return [{
      id,
      label,
      depthMode: depthMode(source.depthMode),
      ...(source.supportsInformation === false ? { supportsInformation: false } : {}),
      ...(source.disabled === true ? { disabled: true } : {}),
    }];
  });
  const selectedInstanceId = stringValue(value.selectedInstanceId) ?? "";
  if (sources.length === 0 || !sources.some(({ id }) => id === selectedInstanceId)) {
    return undefined;
  }
  return { selectedInstanceId, sources };
}

/** 沙箱只发出选择意图；宿主会校验实例并用新的入口上下文重新渲染。 */
export function requestPreviewSourceSelection(instanceId: string): void {
  window.parent.postMessage(
    { type: "fqgate.preview.select-source", instanceId },
    "*",
  );
}

/**
 * 请求宿主重新创建当前 MCP App 页面。
 *
 * MCP App 运行在沙箱 iframe 中，直接调用 location.reload() 会让新页面
 * 失去宿主创建的 AppBridge。由宿主重建 iframe 才能同时刷新入口数据并
 * 重新完成 MCP 握手；在没有宿主 iframe 的独立页面中返回 false，由调用方
 * 继续执行本地数据刷新作为兜底。
 */
export function requestHostPageRefresh(): boolean {
  if (window.parent === window) return false;
  window.parent.postMessage({ type: "fqgate.app.refresh-page" }, "*");
  return true;
}

/** FQGate Desktop 可在 App 工具栏内叠放窗口级动作；其他宿主保持零占位。 */
export function applyPreviewHostActionInset(
  argumentsValue: JsonObject | undefined,
): void {
  const value = argumentsValue?._fqgatePreview;
  const inset = isRecord(value) ? Number(value.hostActionInset) : 0;
  if (!Number.isFinite(inset) || inset <= 0) return;
  document.documentElement.style.setProperty(
    "--fqgate-host-action-inset",
    `${Math.min(Math.round(inset), MAX_HOST_ACTION_INSET)}px`,
  );
}

function depthMode(value: unknown): PreviewSourceDepthMode {
  return value === "basic" || value === "level2" ? value : "auto";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
