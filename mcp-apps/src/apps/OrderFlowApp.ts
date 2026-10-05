import type {
  MarketSecurity,
  OrderFlowConnectionState,
  OrderFlowDataMode,
  OrderFlowQuote,
  OrderFlowRecord,
  OrderFlowWatchConnection,
  OrderFlowWatchListener,
  OrderFlowWatchService
} from "@/shared/contracts";
import type { PreviewSourceContext } from "@/shared/previewSource";
import { AppFrame } from "@/ui/AppFrame";
import { append, button, element, errorText, replace } from "@/ui/dom";
import { direction, formatCompactNumber, formatTime } from "@/ui/format";
import { ServiceRecoveryController } from "@/ui/ServiceRecoveryController";
import { createStandardAppHeader } from "@/ui/standardAppHeader";
import { VisibilityController } from "@/ui/VisibilityController";

type PanelState = "idle" | "connecting" | "connected" | "paused" | "reconnecting" | "error";

export interface OrderFlowAppOptions {
  previewSource?: PreviewSourceContext;
  onPreviewSourceChange?: (instanceId: string) => void;
}

export class OrderFlowApp {
  private readonly frame: AppFrame;
  private readonly securityBadge = element("span", "badge", "未选择证券");
  private readonly price = element("strong", "order-flow-price numeric is-flat", "—");
  private readonly modeBadge = element("span", "badge", "等待数据");
  private readonly searchInput = element("input", "field order-flow-search") as HTMLInputElement;
  private readonly searchResults = element("div", "search-results");
  private readonly message = element("div", "status-message", "请选择证券后开始盯盘。");
  private readonly ordersBody = element("tbody");
  private readonly cancelsBody = element("tbody");
  private readonly orderCount = element("span", "stream-count");
  private readonly cancelCount = element("span", "stream-count");
  private readonly largeOnly = element("input") as HTMLInputElement;
  private readonly largeAmount = element("input", "field amount-field") as HTMLInputElement;
  private readonly markEnabled = element("input") as HTMLInputElement;
  private readonly markAmount = element("input", "field amount-field") as HTMLInputElement;
  private readonly recovery: ServiceRecoveryController;
  private readonly visibility: VisibilityController;

  private selected?: MarketSecurity;
  private securityOptions: MarketSecurity[] = [];
  private state: PanelState = "idle";
  private dataMode?: OrderFlowDataMode;
  private quote?: OrderFlowQuote;
  private orders: OrderFlowRecord[] = [];
  private cancels: OrderFlowRecord[] = [];
  private readonly seenIds = new Set<string>();
  private connection?: OrderFlowWatchConnection;
  private connectController?: AbortController;
  private connectRevision = 0;
  private searchController?: AbortController;
  private searchRevision = 0;
  private searchTimer?: number;
  private active = false;

  constructor(
    host: HTMLElement,
    private readonly service: OrderFlowWatchService,
    initial?: MarketSecurity,
    private readonly appOptions: OrderFlowAppOptions = {},
  ) {
    this.selected = initial;
    this.securityOptions = initial ? [initial] : [];
    // 标准栏已经承载应用级信息，避免再插入一层旧版状态栏导致内容被推到视口外。
    this.frame = new AppFrame(host, { realtime: true, statusBar: false });
    this.frame.root.classList.add("order-flow-app");
    this.buildLayout();
    this.bindControls();
    this.render();
    this.recovery = new ServiceRecoveryController(service, {
      onReconnecting: (value) => {
        if (value) {
          this.state = "reconnecting";
          this.renderConnection("数据服务连接中断，正在重试");
        }
      },
      onRecovered: () => this.active && this.selected ? this.startConnection() : undefined
    });
    this.visibility = new VisibilityController(this.frame.root, (visible) => {
      this.active = visible;
      if (visible && this.selected) void this.startConnection();
      else if (!visible) this.stopConnection("paused");
    });
  }

  destroy(): void {
    if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
    this.searchController?.abort();
    this.stopConnection();
    this.visibility.destroy();
    this.recovery.destroy();
  }

  private buildLayout(): void {
    const header = createStandardAppHeader({
      title: "L2 · 逐笔委托",
      previewSource: this.appOptions.previewSource,
      onPreviewSourceChange: this.appOptions.onPreviewSourceChange,
    });
    header.heading.append(this.securityBadge);
    const quote = element("div", "toolbar-group");
    append(quote, element("span", "subtle", "当前价"), this.price, this.modeBadge);
    header.actions.append(quote);

    const controls = element("section", "order-flow-controls");
    const search = element("div", "search-box");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "输入证券代码或名称";
    this.searchInput.autocomplete = "off";
    this.searchInput.setAttribute("role", "combobox");
    this.searchInput.setAttribute("aria-label", "搜索证券");
    this.searchInput.setAttribute("aria-controls", "order-flow-search-results");
    this.searchResults.id = "order-flow-search-results";
    this.setSearchResultsVisible(false);
    append(search, this.searchInput, this.searchResults);

    this.largeOnly.type = "checkbox";
    this.largeAmount.type = "number";
    this.largeAmount.min = "0";
    this.largeAmount.value = "50";
    this.largeAmount.setAttribute("aria-label", "大单筛选金额，万元");
    this.markEnabled.type = "checkbox";
    this.markAmount.type = "number";
    this.markAmount.min = "0";
    this.markAmount.value = "100";
    this.markAmount.setAttribute("aria-label", "大单标记金额，万元");
    const filters = element("div", "order-flow-filters");
    append(
      filters,
      filterControl(this.largeOnly, "仅看大单", this.largeAmount),
      filterControl(this.markEnabled, "标记大单", this.markAmount)
    );
    append(controls, search, filters);

    const grid = element("div", "stream-grid");
    grid.append(
      this.createStreamCard("挂单", this.orderCount, this.ordersBody, false),
      this.createStreamCard("撤单", this.cancelCount, this.cancelsBody, true)
    );
    append(this.frame.content, header.root, controls, grid, this.message);
  }

  private createStreamCard(
    title: string,
    count: HTMLElement,
    body: HTMLTableSectionElement,
    cancellation: boolean
  ): HTMLElement {
    const card = element("section", "stream-card");
    const header = element("header", "stream-card__header");
    append(header, element("h2", "stream-card__title", title), count);
    const scroll = element("div", "table-scroll stream-table-scroll");
    const table = element("table", "data-table stream-table");
    table.setAttribute("aria-label", title);
    const head = element("thead");
    const row = element("tr");
    for (const label of cancellation
      ? ["委托时间", "撤单时间", "方向", "委托价", "撤单量", "撤单金额"]
      : ["委托时间", "方向", "委托价", "委托量", "委托金额"]) {
      const cell = element("th", undefined, label);
      cell.scope = "col";
      row.append(cell);
    }
    head.append(row);
    append(table, head, body);
    scroll.append(table);
    append(card, header, scroll);
    return card;
  }

  private bindControls(): void {
    this.searchInput.addEventListener("input", () => {
      if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
      const pattern = this.searchInput.value.trim();
      if (!pattern) {
        this.setSearchResultsVisible(false);
        return;
      }
      this.searchTimer = window.setTimeout(() => void this.search(pattern), 250);
    });
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.setSearchResultsVisible(false);
      }
    });
    for (const control of [this.largeOnly, this.largeAmount, this.markEnabled, this.markAmount]) {
      control.addEventListener("change", () => this.renderRecords());
      control.addEventListener("input", () => this.renderRecords());
    }
  }

  private async search(pattern: string): Promise<void> {
    const revision = ++this.searchRevision;
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    this.searchInput.setAttribute("aria-busy", "true");
    try {
      const options = await this.service.searchSecurities(pattern, controller.signal);
      if (revision !== this.searchRevision) return;
      this.securityOptions = options;
      this.renderSearchResults(options);
    } catch (error) {
      if (controller.signal.aborted || revision !== this.searchRevision) return;
      this.renderSearchError(`证券搜索不可用：${errorText(error, "请稍后重试。")}`);
    } finally {
      if (revision === this.searchRevision) this.searchInput.removeAttribute("aria-busy");
    }
  }

  private renderSearchResults(options: readonly MarketSecurity[]): void {
    replace(this.searchResults);
    if (!options.length) {
      this.searchResults.append(element("div", "search-results__empty", "没有匹配的证券"));
    } else {
      for (const security of options.slice(0, 20)) {
        const choice = button(`${security.name || "未知名称"}  ${security.code}`, "search-result");
        choice.addEventListener("click", () => this.selectSecurity(security));
        this.searchResults.append(choice);
      }
    }
    this.setSearchResultsVisible(true);
  }

  private renderSearchError(message: string): void {
    replace(this.searchResults, element("div", "search-results__empty is-error", message));
    this.setSearchResultsVisible(true);
  }

  private selectSecurity(security: MarketSecurity): void {
    this.selected = security;
    this.searchInput.value = `${security.name || ""} ${security.code}`.trim();
    this.setSearchResultsVisible(false);
    this.quote = undefined;
    this.orders = [];
    this.cancels = [];
    this.seenIds.clear();
    this.render();
    if (this.active) void this.startConnection();
  }

  private setSearchResultsVisible(visible: boolean): void {
    this.searchResults.hidden = !visible;
    this.searchInput.setAttribute("aria-expanded", String(visible));
  }

  private async startConnection(): Promise<void> {
    const security = this.selected;
    if (!security || !this.active) return;
    this.stopConnection();
    const revision = ++this.connectRevision;
    const controller = new AbortController();
    this.connectController = controller;
    this.state = "connecting";
    this.renderConnection("正在连接实时数据…");

    const listener: OrderFlowWatchListener = {
      onConnectionState: (state, message) => {
        if (revision === this.connectRevision) this.applyConnectionState(state, message);
      },
      onModeChange: (change) => {
        if (revision !== this.connectRevision) return;
        this.dataMode = change.mode;
        if (change.mode === "basic") {
          this.orders = [];
          this.cancels = [];
          this.seenIds.clear();
        }
        this.render();
      },
      onQuote: (quote) => {
        if (revision === this.connectRevision) {
          this.quote = quote;
          this.renderQuote();
        }
      },
      onRecords: (records) => {
        if (revision === this.connectRevision) this.appendRecords(records);
      },
      onError: (message) => {
        if (revision !== this.connectRevision) return;
        this.state = this.service.connection.getSnapshot().state === "reconnecting" ? "reconnecting" : "error";
        this.renderConnection(`实时数据不可用：${message}`);
      }
    };

    try {
      const connection = await this.service.connect(security, listener, controller.signal);
      if (revision !== this.connectRevision || !this.active) connection.close();
      else this.connection = connection;
    } catch (error) {
      if (revision !== this.connectRevision || isAbortError(error)) return;
      const unavailable = this.recovery.handleError(error)
        || this.service.connection.getSnapshot().state === "reconnecting";
      this.state = unavailable ? "reconnecting" : "error";
      this.renderConnection(`实时数据不可用：${errorText(error, "请稍后重试。")}`);
    }
  }

  private stopConnection(nextState?: PanelState): void {
    this.connectRevision += 1;
    this.connectController?.abort();
    this.connectController = undefined;
    this.connection?.close();
    this.connection = undefined;
    if (nextState) {
      this.state = nextState;
      this.renderConnection(nextState === "paused" ? "实时数据已暂停" : "实时数据已断开");
    }
  }

  private applyConnectionState(state: OrderFlowConnectionState, message: string): void {
    this.state = state === "closed" ? "error" : state;
    this.renderConnection(message);
  }

  private renderConnection(message: string): void {
    const state = this.state === "connected"
      ? "connected"
      : this.state === "connecting" || this.state === "reconnecting"
        ? "reconnecting"
        : "disconnected";
    this.frame.setConnection(state, message);
    this.message.textContent = message;
    this.message.classList.toggle("is-error", this.state === "error");
  }

  private appendRecords(records: OrderFlowRecord[]): void {
    const newOrders: OrderFlowRecord[] = [];
    const newCancels: OrderFlowRecord[] = [];
    for (const record of records) {
      if (this.seenIds.has(record.id)) continue;
      this.seenIds.add(record.id);
      (record.kind === "order" ? newOrders : newCancels).push(record);
    }
    if (newOrders.length) this.orders = mergeNewest(this.orders, newOrders);
    if (newCancels.length) this.cancels = mergeNewest(this.cancels, newCancels);
    this.renderRecords();
  }

  private render(): void {
    this.securityBadge.textContent = this.selected
      ? `${this.selected.name || ""} ${this.selected.code}`.trim()
      : "未选择证券";
    this.modeBadge.textContent = this.dataMode === "level2" ? "Level-2" : this.dataMode === "basic" ? "普通行情" : "等待数据";
    this.modeBadge.classList.toggle("is-accent", this.dataMode === "level2");
    this.renderQuote();
    this.renderRecords();
  }

  private renderQuote(): void {
    this.price.textContent = this.quote?.latestPrice === null || this.quote?.latestPrice === undefined
      ? "—"
      : this.quote.latestPrice.toFixed(2);
    const difference = this.quote?.latestPrice !== null && this.quote?.latestPrice !== undefined
      && this.quote.previousClose !== null && this.quote.previousClose !== undefined
      ? this.quote.latestPrice - this.quote.previousClose
      : 0;
    this.price.className = `order-flow-price numeric is-${direction(difference)}`;
  }

  private renderRecords(): void {
    const orders = this.filtered(this.orders);
    const cancels = this.filtered(this.cancels);
    this.orderCount.textContent = `${orders.length}/${this.orders.length} 笔`;
    this.cancelCount.textContent = `${cancels.length}/${this.cancels.length} 笔`;
    replace(this.ordersBody);
    replace(this.cancelsBody);
    if (orders.length) for (const record of orders) this.ordersBody.append(this.renderRecord(record, false));
    else this.ordersBody.append(this.emptyRecordRow(false));
    if (cancels.length) for (const record of cancels) this.cancelsBody.append(this.renderRecord(record, true));
    else this.cancelsBody.append(this.emptyRecordRow(true));
  }

  private filtered(records: readonly OrderFlowRecord[]): OrderFlowRecord[] {
    if (!this.largeOnly.checked) return [...records];
    const minimum = Math.max(0, Number(this.largeAmount.value) || 0) * 10_000;
    return records.filter((record) => (record.amount ?? 0) >= minimum);
  }

  private renderRecord(record: OrderFlowRecord, cancellation: boolean): HTMLTableRowElement {
    const row = element("tr");
    if (this.markEnabled.checked) {
      const minimum = Math.max(0, Number(this.markAmount.value) || 0) * 10_000;
      if ((record.amount ?? 0) >= minimum) row.classList.add("is-marked");
    }
    const side = record.side === "buy" ? "买入" : record.side === "sell" ? "卖出" : "未知";
    const sideTone = record.side === "buy" ? "rise" : record.side === "sell" ? "fall" : "flat";
    const cells = cancellation
      ? [formatTime(record.orderTimestamp), formatTime(record.timestamp), side, formatPrice(record.price), formatVolume(record.volume), formatCompactNumber(record.amount)]
      : [formatTime(record.timestamp), side, formatPrice(record.price), formatVolume(record.volume), formatCompactNumber(record.amount)];
    cells.forEach((value, index) => {
      const cell = element("td", `numeric${index === (cancellation ? 2 : 1) ? ` is-${sideTone}` : ""}`, value);
      if (index === (cancellation ? 2 : 1)) cell.setAttribute("aria-label", side);
      row.append(cell);
    });
    return row;
  }

  private emptyRecordRow(cancellation: boolean): HTMLTableRowElement {
    const row = element("tr");
    const message = this.dataMode === "basic"
      ? "当前数据源没有 Level-2 权限，请在 FQGate 主程序中检查账号与权限。"
      : "正在等待实时逐笔数据";
    const cell = element("td", "empty-table-cell", message);
    cell.colSpan = cancellation ? 6 : 5;
    row.append(cell);
    return row;
  }
}

function filterControl(checkbox: HTMLInputElement, label: string, amount: HTMLInputElement): HTMLElement {
  const wrapper = element("div", "filter-control");
  const checkboxLabel = element("label", "checkbox-label");
  append(checkboxLabel, checkbox, element("span", undefined, label));
  const amountLabel = element("label", "amount-label");
  append(amountLabel, amount, element("span", undefined, "万元起"));
  append(wrapper, checkboxLabel, amountLabel);
  return wrapper;
}

function mergeNewest(current: readonly OrderFlowRecord[], incoming: readonly OrderFlowRecord[]): OrderFlowRecord[] {
  return [...current, ...incoming]
    .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))
    .slice(0, 500);
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatVolume(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
