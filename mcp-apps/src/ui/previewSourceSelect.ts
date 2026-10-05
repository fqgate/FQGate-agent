import type { PreviewSourceContext } from "@/shared/previewSource";
import { element } from "@/ui/dom";

/**
 * 创建与个股 K 线一致的数据源账号选择器。
 * 没有宿主预览上下文时返回 undefined，普通 MCP 宿主继续保持原有布局。
 */
export function createPreviewSourceSelect(
  context: PreviewSourceContext | undefined,
  onChange: (instanceId: string) => void,
): HTMLSelectElement | undefined {
  if (!context) return undefined;

  const select = element(
    "select",
    "candle-heading__source-select",
  ) as HTMLSelectElement;
  select.setAttribute("aria-label", "数据源账号");
  select.title = "数据源账号";
  for (const source of context.sources) {
    const option = element("option", undefined, source.label);
    option.value = source.id;
    option.disabled = source.disabled === true;
    select.append(option);
  }
  select.value = context.selectedInstanceId;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}
