import type { PreviewSourceContext } from "@/shared/previewSource";
import { append, element } from "@/ui/dom";
import { createPreviewSourceSelect } from "@/ui/previewSourceSelect";

export interface StandardAppHeaderOptions {
  title: string;
  previewSource?: PreviewSourceContext;
  onPreviewSourceChange?: (instanceId: string) => void;
}

export interface StandardAppHeader {
  root: HTMLElement;
  heading: HTMLElement;
  actions: HTMLElement;
}

/** 所有行情 MCP App 共用的顶部品牌、应用和数据源标准栏。 */
export function createStandardAppHeader(
  options: StandardAppHeaderOptions,
): StandardAppHeader {
  const root = element("header", "candle-toolbar");
  const brand = element("span", "candle-brand");
  brand.setAttribute("role", "img");
  brand.setAttribute("aria-label", "FQGate");
  const brandLogo = element("img", "candle-brand__logo");
  brandLogo.src = new URL("../assets/fqgate-logo.png", import.meta.url).href;
  brandLogo.alt = "";
  append(brand, brandLogo, element("span", "candle-brand__wordmark", "FQGate"));

  const heading = element("div", "candle-heading");
  heading.append(element("strong", "candle-heading__title", options.title));
  const sourceSelect = createPreviewSourceSelect(
    options.previewSource,
    (instanceId) => options.onPreviewSourceChange?.(instanceId),
  );
  append(
    heading,
    sourceSelect ?? element("span", "candle-heading__source", "同花顺"),
  );

  const actions = element("div", "candle-toolbar__actions");
  append(
    root,
    brand,
    heading,
    element("span", "candle-toolbar__spacer"),
    actions,
  );
  return { root, heading, actions };
}
