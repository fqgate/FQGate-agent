import type {
  InformationData,
  InformationItem,
  InformationService,
  MarketSecurity
} from "@/shared/contracts";
import type { PreviewSourceContext } from "@/shared/previewSource";
import { requestHostPageRefresh } from "@/shared/previewSource";
import { AppFrame } from "@/ui/AppFrame";
import { append, button, element, errorText, replace } from "@/ui/dom";
import { ServiceRecoveryController } from "@/ui/ServiceRecoveryController";
import { createStandardAppHeader } from "@/ui/standardAppHeader";

export type ExternalUrlOpener = (url: string) => Promise<void> | void;

export interface InformationAppOptions {
  previewSource?: PreviewSourceContext;
  onPreviewSourceChange?: (instanceId: string) => void;
}

export class InformationApp {
  private readonly frame: AppFrame;
  private readonly feed = element("div", "information-feed");
  private readonly status = element("footer", "status-message", "等待资讯数据");
  private readonly refreshButton = button("↻", "icon-button candle-refresh");
  private readonly recovery: ServiceRecoveryController;
  private data?: InformationData;
  private request?: AbortController;
  private requestVersion = 0;

  constructor(
    host: HTMLElement,
    private readonly service: InformationService,
    private readonly security: MarketSecurity,
    private readonly openExternalUrl: ExternalUrlOpener = openBrowserWindow,
    private readonly options: InformationAppOptions = {},
  ) {
    this.frame = new AppFrame(host, { statusBar: false });
    this.frame.root.classList.add("information-app");
    const previewSource = informationPreviewSource(this.options.previewSource);
    const toolbar = createStandardAppHeader({
      title: "个股资讯",
      previewSource,
      onPreviewSourceChange: this.options.onPreviewSourceChange,
    });
    this.refreshButton.title = "刷新资讯";
    this.refreshButton.setAttribute("aria-label", "刷新资讯");
    this.refreshButton.addEventListener("click", () => {
      if (this.options.previewSource && requestHostPageRefresh()) return;
      this.data = undefined;
      this.render();
      void this.load(true);
    });
    toolbar.actions.append(this.refreshButton);
    this.feed.setAttribute("aria-live", "polite");
    append(this.frame.content, toolbar.root, this.feed, this.status);
    this.recovery = new ServiceRecoveryController(service, {
      onReconnecting: (value) => this.frame.setBusy(value && !this.data, "正在重连数据服务…"),
      onRecovered: () => this.load()
    });
    this.render();
  }

  start(): void {
    void this.load();
  }

  destroy(): void {
    this.requestVersion += 1;
    this.request?.abort();
    this.recovery.destroy();
  }

  private async load(force = false): Promise<void> {
    const version = ++this.requestVersion;
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.refreshButton.disabled = true;
    this.refreshButton.classList.add("is-spinning");
    this.frame.setBusy(!this.data, "正在读取资讯…");
    this.status.classList.remove("is-error");
    this.status.textContent = force ? "正在刷新资讯…" : "正在读取资讯…";
    try {
      const result = await this.service.getInformation({
        security: this.security,
        category: "security"
      }, controller.signal);
      if (version !== this.requestVersion) return;
      this.data = result;
      this.render();
    } catch (reason) {
      if (version !== this.requestVersion || controller.signal.aborted) return;
      if (!this.recovery.handleError(reason)) this.renderError(errorText(reason, "资讯读取失败，请稍后重试。"));
    } finally {
      if (version === this.requestVersion) {
        this.frame.setBusy(false);
        this.refreshButton.disabled = false;
        this.refreshButton.classList.remove("is-spinning");
      }
    }
  }

  private render(): void {
    replace(this.feed);
    const items = this.data?.items ?? [];
    if (!items.length) {
      this.feed.append(element("div", "empty-state", "暂无资讯"));
    } else {
      const list = element("ul", "information-list");
      for (const item of items) list.append(this.renderItem(item));
      this.feed.append(list);
    }
    const fetched = this.data?.fetchedAt ? formatFetchedAt(this.data.fetchedAt) : "";
    this.status.textContent = `${items.length} 条资讯${fetched ? ` · ${fetched}` : ""}`;
    this.status.classList.remove("is-error");
  }

  private renderItem(item: InformationItem): HTMLLIElement {
    const row = element("li", "information-item");
    const content = item.url
      ? element("a", "information-item__action")
      : element("div", "information-item__content");
    if (content instanceof HTMLAnchorElement && item.url) {
      content.href = item.url;
      content.target = "_blank";
      content.rel = "noopener noreferrer";
      content.setAttribute("aria-label", `在系统浏览器中打开：${item.title}`);
      content.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openItem(item);
      });
    }
    const meta = element("div", "information-item__meta");
    const time = element("time", "numeric", formatPublishedAt(item.publishedAt));
    if (item.publishedAt) time.dateTime = new Date(item.publishedAt).toISOString();
    append(meta, time, item.source ? element("span", "information-item__source", item.source) : null);
    if (item.url) meta.append(element("span", "information-item__link", "原文 ↗"));
    const title = element("h2", "information-item__title", item.title);
    append(
      content,
      meta,
      title,
      item.summary ? element("p", "information-item__summary", item.summary) : null
    );
    row.append(content);
    return row;
  }

  private async openItem(item: InformationItem): Promise<void> {
    if (!item.url) return;
    try {
      await this.openExternalUrl(item.url);
    } catch (reason) {
      this.status.textContent = errorText(reason, "无法使用系统浏览器打开原文。");
      this.status.classList.add("is-error");
    }
  }

  private renderError(message: string): void {
    if (!this.data) {
      const state = element("div", "empty-state");
      const box = element("div", "error-stack");
      const retry = button("重新读取");
      retry.addEventListener("click", () => void this.load(true));
      append(box, element("p", "error-banner", message), retry);
      state.append(box);
      replace(this.feed, state);
    }
    this.status.textContent = message;
    this.status.classList.add("is-error");
  }
}

function informationPreviewSource(
  context: PreviewSourceContext | undefined,
): PreviewSourceContext | undefined {
  if (!context) return undefined;
  return {
    ...context,
    sources: context.sources.map((source) =>
      source.supportsInformation === false
        ? { ...source, disabled: true, label: `${source.label}（不支持资讯）` }
        : source,
    ),
  };
}

function openBrowserWindow(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatPublishedAt(value: number | null): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  const sameDay = dateParts(date) === dateParts(new Date());
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(sameDay ? {} : { month: "2-digit", day: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function dateParts(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatFetchedAt(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "刚刚更新";
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed)}`;
}
