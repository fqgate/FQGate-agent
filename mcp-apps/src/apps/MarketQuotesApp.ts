import type {
  MarketQuotePatch,
  MarketQuoteService,
  MarketQuoteSubscription,
  QuoteConnectionState
} from "@/features/market-quotes/contracts";
import { marketSecurityKey } from "@/features/market-quotes/contracts";
import type { MarketSecurity } from "@/shared/contracts";
import type { PreviewSourceContext } from "@/shared/previewSource";
import { requestHostPageRefresh } from "@/shared/previewSource";
import { AppFrame } from "@/ui/AppFrame";
import { append, button, element, replace } from "@/ui/dom";
import { direction, formatCompactNumber, formatTime, signed } from "@/ui/format";
import { ServiceRecoveryController } from "@/ui/ServiceRecoveryController";
import { createSparkline } from "@/ui/sparkline";
import { createStandardAppHeader } from "@/ui/standardAppHeader";
import { VisibilityController } from "@/ui/VisibilityController";

interface QuoteRow extends MarketQuotePatch {
  key: string;
  trend: number[];
}

type SortKey = "name" | "latestPrice" | "changePercent" | "volume" | "amount";

export interface MarketQuotesAppOptions {
  previewSource?: PreviewSourceContext;
  onPreviewSourceChange?: (instanceId: string) => void;
}

export class MarketQuotesApp {
  private readonly frame: AppFrame;
  private readonly refreshButton = button("↻", "icon-button candle-refresh");
  private readonly tableBody = element("tbody");
  private readonly status = element("footer", "status-message", "等待行情数据");
  private readonly visibility: VisibilityController;
  private readonly recovery: ServiceRecoveryController;
  private rows: QuoteRow[];
  private subscription?: MarketQuoteSubscription;
  private request?: AbortController;
  private loadEpoch = 0;
  private active = false;
  private updateFrame?: number;
  private readonly pending = new Map<string, MarketQuotePatch>();
  private sortKey?: SortKey;
  private sortDirection: 1 | -1 = -1;

  constructor(
    host: HTMLElement,
    private readonly service: MarketQuoteService,
    securities: readonly MarketSecurity[],
    private readonly options: MarketQuotesAppOptions = {},
  ) {
    this.rows = uniqueSecurities(securities).map(blankRow);
    this.frame = new AppFrame(host, { realtime: true, statusBar: false });
    this.frame.root.classList.add("market-quotes-app");
    const toolbar = createStandardAppHeader({
      title: "多股行情",
      previewSource: this.options.previewSource,
      onPreviewSourceChange: this.options.onPreviewSourceChange,
    });
    this.refreshButton.title = "刷新行情";
    this.refreshButton.setAttribute("aria-label", "刷新行情");
    this.refreshButton.addEventListener("click", () => {
      if (this.options.previewSource && requestHostPageRefresh()) return;
      void this.load();
    });
    toolbar.actions.append(this.refreshButton);

    const scroll = element("div", "table-scroll quote-table-scroll");
    const table = element("table", "data-table quote-table");
    table.setAttribute("aria-label", "多股实时行情");
    append(table, this.createHeader(), this.tableBody);
    scroll.append(table);
    append(this.frame.content, toolbar.root, scroll, this.status);
    this.render();

    this.recovery = new ServiceRecoveryController(service, {
      onReconnecting: (value) => {
        if (value) this.setConnection("reconnecting", "数据服务连接中断，正在重试");
      },
      onRecovered: () => this.active ? this.load() : undefined
    });
    this.visibility = new VisibilityController(this.frame.root, (visible) => {
      this.active = visible;
      if (visible) void this.load();
      else this.pause();
    });
  }

  destroy(): void {
    this.pause();
    this.visibility.destroy();
    this.recovery.destroy();
    if (this.updateFrame !== undefined) cancelAnimationFrame(this.updateFrame);
  }

  private createHeader(): HTMLTableSectionElement {
    const head = element("thead");
    const row = element("tr");
    const columns: Array<[string, SortKey | undefined]> = [
      ["证券", "name"], ["日内走势", undefined], ["最新价", "latestPrice"],
      ["涨跌幅", "changePercent"], ["涨跌额", undefined], ["今开", undefined],
      ["最高", undefined], ["最低", undefined], ["成交量", "volume"],
      ["成交额", "amount"], ["更新时间", undefined]
    ];
    for (const [label, key] of columns) {
      const cell = element("th");
      cell.scope = "col";
      if (key) {
        const sort = element("button", "table-sort", label);
        sort.type = "button";
        sort.addEventListener("click", () => this.toggleSort(key, sort));
        cell.append(sort);
      } else {
        cell.textContent = label;
      }
      row.append(cell);
    }
    head.append(row);
    return head;
  }

  private async load(): Promise<void> {
    if (!this.active || this.rows.length === 0) return;
    const epoch = ++this.loadEpoch;
    this.request?.abort();
    this.subscription?.close();
    const controller = new AbortController();
    this.request = controller;
    this.pending.clear();
    this.refreshButton.disabled = true;
    this.refreshButton.classList.add("is-spinning");
    this.frame.setBusy(this.rows.every((row) => row.latestPrice === undefined), "正在读取实时行情…");
    this.setConnection("reconnecting", "正在连接实时行情");
    this.status.textContent = "正在读取行情快照…";
    try {
      const securities = this.rows.map((row) => row.security);
      const snapshots = await this.service.getQuotes(securities, controller.signal);
      if (epoch !== this.loadEpoch) return;
      this.applyPatches(snapshots, false);
      this.subscription = this.service.subscribe(securities, {
        onQuote: (patch) => this.queuePatch(patch),
        onStateChange: (state) => {
          if (epoch === this.loadEpoch) this.applyConnectionState(state);
        },
        onError: (error) => {
          if (epoch !== this.loadEpoch) return;
          this.status.textContent = error.message;
          this.status.classList.add("is-error");
        }
      });
      this.frame.setBusy(false);
      const trends = await this.service.getIntradayTrends(securities, controller.signal);
      if (epoch !== this.loadEpoch) return;
      for (const row of this.rows) row.trend = trends.get(row.key) ?? row.trend;
      this.render();
    } catch (error) {
      if (epoch !== this.loadEpoch || controller.signal.aborted) return;
      if (this.recovery.handleError(error)) {
        this.setConnection("reconnecting", "数据服务连接中断，正在重试");
      } else {
        this.setConnection("disconnected", "实时行情已断开");
        this.status.textContent = error instanceof Error ? error.message : "行情读取失败，请稍后重试。";
        this.status.classList.add("is-error");
      }
    } finally {
      if (epoch === this.loadEpoch) {
        this.frame.setBusy(false);
        this.refreshButton.disabled = false;
        this.refreshButton.classList.remove("is-spinning");
      }
    }
  }

  private pause(): void {
    this.loadEpoch += 1;
    this.request?.abort();
    this.request = undefined;
    this.subscription?.close();
    this.subscription = undefined;
    this.pending.clear();
    this.setConnection("disconnected", "实时行情已暂停");
  }

  private queuePatch(patch: MarketQuotePatch): void {
    const key = marketSecurityKey(patch.security);
    this.pending.set(key, { ...this.pending.get(key), ...patch });
    if (this.updateFrame !== undefined) return;
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = undefined;
      const patches = [...this.pending.values()];
      this.pending.clear();
      this.applyPatches(patches, true);
    });
  }

  private applyPatches(patches: readonly MarketQuotePatch[], appendTrend: boolean): void {
    const byKey = new Map(patches.map((patch) => [marketSecurityKey(patch.security), patch]));
    this.rows = this.rows.map((row) => {
      const patch = byKey.get(row.key);
      if (!patch) return row;
      const trend = appendTrend && patch.latestPrice !== undefined
        ? [...row.trend, patch.latestPrice].slice(-64)
        : row.trend;
      return { ...row, ...patch, key: row.key, trend };
    });
    this.render();
  }

  private applyConnectionState(state: QuoteConnectionState): void {
    if (state === "connected") {
      this.setConnection("connected", "实时行情已连接");
      this.status.classList.remove("is-error");
      this.status.textContent = `实时更新 · ${formatTime(Date.now())}`;
    } else if (state === "connecting" || state === "reconnecting") {
      this.setConnection("reconnecting", "正在连接实时行情");
    } else {
      this.setConnection("disconnected", "实时行情已断开");
    }
  }

  private setConnection(state: "connected" | "reconnecting" | "disconnected", message: string): void {
    this.frame.setConnection(state, message);
  }

  private toggleSort(key: SortKey, trigger: HTMLButtonElement): void {
    if (this.sortKey === key) this.sortDirection = this.sortDirection === 1 ? -1 : 1;
    else {
      this.sortKey = key;
      this.sortDirection = key === "name" ? 1 : -1;
    }
    for (const button of this.frame.root.querySelectorAll<HTMLButtonElement>(".table-sort")) {
      button.removeAttribute("aria-sort");
    }
    trigger.setAttribute("aria-sort", this.sortDirection === 1 ? "ascending" : "descending");
    this.render();
  }

  private render(): void {
    const rows = [...this.rows];
    if (this.sortKey) rows.sort((left, right) => compareRows(left, right, this.sortKey!) * this.sortDirection);
    replace(this.tableBody);
    for (const quote of rows) this.tableBody.append(this.renderRow(quote));
    if (!rows.length) {
      const row = element("tr");
      const cell = element("td", "empty-state", "暂无证券");
      cell.colSpan = 11;
      row.append(cell);
      this.tableBody.append(row);
    }
  }

  private renderRow(row: QuoteRow): HTMLTableRowElement {
    const change = quoteChange(row);
    const percent = quoteChangePercent(row);
    const tr = element("tr");
    const security = element("td");
    const securityCell = element("div", "security-cell");
    append(
      securityCell,
      element("span", "security-cell__name", row.name || row.security.name || row.security.code),
      element("span", "security-cell__code numeric", `${row.security.market} · ${row.security.code}`)
    );
    security.append(securityCell);
    const trend = element("td");
    trend.append(createSparkline(row.trend));
    append(
      tr,
      security,
      trend,
      numberCell(formatPrice(row.latestPrice), direction(change)),
      numberCell(signed(percent, "%"), direction(percent), percent === undefined ? "" : `${percent >= 0 ? "上涨" : "下跌"} ${Math.abs(percent).toFixed(2)}%`),
      numberCell(signed(change), direction(change)),
      numberCell(formatPrice(row.openPrice)),
      numberCell(formatPrice(row.highPrice)),
      numberCell(formatPrice(row.lowPrice)),
      numberCell(formatCompactNumber(row.volume)),
      numberCell(formatCompactNumber(row.amount)),
      numberCell(formatTime(row.receivedAt))
    );
    return tr;
  }
}

function blankRow(security: MarketSecurity): QuoteRow {
  return { key: marketSecurityKey(security), security: { ...security }, name: security.name, trend: [], receivedAt: 0 };
}

function uniqueSecurities(securities: readonly MarketSecurity[]): MarketSecurity[] {
  return [...new Map(securities.map((item) => [marketSecurityKey(item), item])).values()];
}

function quoteChange(row: QuoteRow): number | undefined {
  return row.latestPrice !== undefined && row.previousClose !== undefined
    ? row.latestPrice - row.previousClose
    : undefined;
}

function quoteChangePercent(row: QuoteRow): number | undefined {
  const change = quoteChange(row);
  return change !== undefined && row.previousClose ? change / row.previousClose * 100 : undefined;
}

function formatPrice(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function numberCell(text: string, tone?: "rise" | "fall" | "flat", ariaLabel?: string): HTMLTableCellElement {
  const cell = element("td", `numeric${tone ? ` is-${tone}` : ""}`, text);
  if (ariaLabel) cell.setAttribute("aria-label", ariaLabel);
  return cell;
}

function compareRows(left: QuoteRow, right: QuoteRow, key: SortKey): number {
  if (key === "name") return (left.name || left.security.name || left.security.code)
    .localeCompare(right.name || right.security.name || right.security.code, "zh-CN");
  const leftValue = key === "changePercent" ? quoteChangePercent(left) : left[key];
  const rightValue = key === "changePercent" ? quoteChangePercent(right) : right[key];
  return (typeof leftValue === "number" ? leftValue : Number.NEGATIVE_INFINITY)
    - (typeof rightValue === "number" ? rightValue : Number.NEGATIVE_INFINITY);
}
