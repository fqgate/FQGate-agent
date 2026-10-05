import { CandleChartController } from "@/features/candle/CandleChartController";
import { CandleDataRepository } from "@/features/candle/CandleDataRepository";
import {
  createHistoryQuery,
  initialHistoryEndDate,
  mergeCandleHistory,
  previousHistoryEndDate,
} from "@/features/candle/candleHistory";
import {
  moreCandlePeriods,
  primaryCandlePeriods,
} from "@/features/candle/candlePeriods";
import { defaultCandleInterval } from "@/features/candle/defaultCandleInterval";
import {
  MarketInspector,
  type MarketInspectorWorkspaceMode,
} from "@/features/candle/MarketInspector";
import {
  formatCompact,
  formatCurrency,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice,
} from "@/features/candle/formatters";
import {
  applyRealtimePoints,
  applyRealtimeQuote,
  initializeRealtimeCursor,
  type RealtimeCandleCursor,
} from "@/features/candle/realtimeCandles";
import type {
  CandleBar,
  CandleData,
  CandleService,
  KlineAdjustment,
  KlineInterval,
  MarketRealtimeConnection,
  MarketRealtimeListener,
  MarketRealtimeQuote,
  MarketRealtimeService,
  MarketSecurity,
  MarketDetailService,
  SecuritySearchService,
} from "@/shared/contracts";
import { isLineKlineInterval, klineIntervalLabel } from "@/shared/kline";
import {
  requestHostPageRefresh,
  type PreviewSourceContext,
} from "@/shared/previewSource";
import { AppFrame } from "@/ui/AppFrame";
import { append, button, element, errorText, replace } from "@/ui/dom";
import {
  matchingSecurityCodes,
  securityFromMainlandCode,
  securitySearchPattern,
} from "@/ui/securityCode";
import { ServiceRecoveryController } from "@/ui/ServiceRecoveryController";
import { VisibilityController } from "@/ui/VisibilityController";

type PanelState =
  "idle" | "connecting" | "connected" | "paused" | "reconnecting" | "error";
const HISTORY_PAGE_ATTEMPTS = 2;

export interface CandleAppOptions {
  service: CandleService;
  securityService: SecuritySearchService;
  realtimeService: MarketRealtimeService;
  detailService: MarketDetailService;
  security: MarketSecurity;
  initialInterval?: KlineInterval;
  count?: number;
  adjustment?: KlineAdjustment;
  previewSource?: PreviewSourceContext;
  onPreviewSourceChange?: (instanceId: string) => void;
}

/**
 * 面向会话列表窄栏的自适应个股行情界面。
 * 右侧行情侧栏支持五/十档摘要、盘口展开、全景盘口和成交明细钻取；
 * 委托与撤单分析仍由独立的 OrderFlowApp 承担。
 */
export class CandleApp {
  private readonly frame: AppFrame;
  private readonly chart = element("div", "candle-chart");
  private readonly chartWorkspace = element("div", "candle-market-workspace");
  private readonly marketInspector: MarketInspector;
  private readonly chartController: CandleChartController;
  private readonly securityName = element(
    "strong",
    "candle-security__name",
    "—",
  );
  private readonly securityCode = element(
    "span",
    "candle-security__code numeric",
    "—",
  );
  private readonly securityForm = element("form", "candle-search");
  private readonly securityInput = element(
    "input",
    "field candle-search__input",
  ) as HTMLInputElement;
  private readonly securityCandidates = element("div", "security-candidates");
  private readonly refreshButton = button("↻", "icon-button candle-refresh");
  private readonly sourceSelect = element(
    "select",
    "candle-heading__source-select",
  ) as HTMLSelectElement;
  private readonly latestPrice = element(
    "strong",
    "candle-price numeric is-flat",
    "—",
  );
  private readonly priceChange = element(
    "span",
    "candle-change numeric is-flat",
    "—",
  );
  private readonly latestTime = element("span", "candle-time", "等待行情数据");
  private readonly rangeStatus = element("span", "candle-range");
  private readonly connection = element(
    "span",
    "candle-connection is-disconnected",
  );
  private readonly connectionLabel = element(
    "span",
    "candle-connection__label",
    "未连接",
  );
  private readonly statValues = new Map<string, HTMLElement>();
  private readonly periodButtons = new Map<KlineInterval, HTMLButtonElement>();
  private readonly periodSelect = element(
    "select",
    "candle-select",
  ) as HTMLSelectElement;
  private readonly adjustmentSelect = element(
    "select",
    "candle-select",
  ) as HTMLSelectElement;
  private readonly movingAverageButton = button(
    "均线",
    "period-button period-button--indicator",
  );
  private readonly legendPrimary = element(
    "span",
    "chart-legend__primary",
    "等待行情数据",
  );
  private readonly averageLegends = [
    element("span", "ma5", "MA5 —"),
    element("span", "ma10", "MA10 —"),
    element("span", "ma20", "MA20 —"),
  ];
  private readonly historyStatus = element("span", "chart-history-status");
  private readonly warning = element("div", "chart-warning");
  private readonly recovery: ServiceRecoveryController;
  private readonly visibility: VisibilityController;
  private readonly resizeObserver: ResizeObserver;

  private security: MarketSecurity;
  private interval: KlineInterval;
  private readonly count: number;
  private adjustment: KlineAdjustment;
  private repository: CandleDataRepository;
  private data?: CandleData;
  private hoverBar?: CandleBar;
  private state: PanelState = "idle";
  private streamError = "";
  private showMovingAverages = true;
  private renderVersion = 0;
  private realtimeConnection?: MarketRealtimeConnection;
  private realtimeAbort?: AbortController;
  private realtimeVersion = 0;
  private resumeVersion = 0;
  private realtimeResync?: Promise<void>;
  private previousClose: number | null = null;
  private readonly realtimeCursor: RealtimeCandleCursor = {};
  private active = false;
  private securitySearch?: AbortController;
  private securitySearchVersion = 0;
  private historyContext = "";
  private historyEndDate: string | null = null;
  private historyComplete = false;
  private historyLoading = false;
  private historyVersion = 0;
  private historyAbort?: AbortController;

  constructor(
    host: HTMLElement,
    private readonly options: CandleAppOptions,
  ) {
    this.security = { ...options.security };
    this.interval = options.initialInterval ?? defaultCandleInterval();
    this.count = options.count ?? 160;
    this.adjustment = options.adjustment ?? "";
    this.repository = new CandleDataRepository(options.service);
    this.frame = new AppFrame(host, { statusBar: false });
    this.frame.root.classList.add("candle-app");
    this.marketInspector = new MarketInspector({
      security: this.security,
      detailService: options.detailService,
      onWorkspaceModeChange: (mode) => this.setInspectorWorkspaceMode(mode),
    });
    this.buildLayout();
    this.chartController = new CandleChartController(
      this.chart,
      (bar) => {
        this.hoverBar = bar ?? undefined;
        this.renderSummary();
      },
      () => void this.loadPreviousHistory(),
    );
    this.resizeObserver = new ResizeObserver(() =>
      this.chartController.resize(),
    );
    this.resizeObserver.observe(this.chart);
    this.recovery = new ServiceRecoveryController(options.realtimeService, {
      onReconnecting: (value) => {
        if (value) {
          this.state = "reconnecting";
          this.renderConnection("数据服务连接中断，正在重试");
        }
      },
      onRecovered: () => (this.active ? this.resumeRealtime() : undefined),
    });
    this.visibility = new VisibilityController(
      this.frame.root,
      (visible) => {
        this.active = visible;
        if (visible) void this.resumeRealtime();
        else this.stopRealtime("paused");
      },
      5_000,
    );
    this.renderSummary();
    this.renderControlState();
  }

  destroy(): void {
    this.active = false;
    this.resumeVersion += 1;
    this.stopRealtime();
    this.renderVersion += 1;
    this.securitySearch?.abort();
    this.resetHistoryPaging();
    this.visibility.destroy();
    this.recovery.destroy();
    this.resizeObserver.disconnect();
    this.chartController.destroy();
    this.marketInspector.destroy();
  }

  private buildLayout(): void {
    const toolbar = element("header", "candle-toolbar");
    const brand = element("span", "candle-brand");
    brand.setAttribute("role", "img");
    brand.setAttribute("aria-label", "FQGate");
    const brandLogo = element("img", "candle-brand__logo");
    brandLogo.src = new URL("../assets/fqgate-logo.png", import.meta.url).href;
    brandLogo.alt = "";
    append(brand, brandLogo, element("span", "candle-brand__wordmark", "FQGate"));
    const heading = element("div", "candle-heading");
    heading.append(element("strong", "candle-heading__title", "个股 K 线"));
    const previewSource = this.options.previewSource;
    if (previewSource) {
      this.sourceSelect.setAttribute("aria-label", "数据源账号");
      this.sourceSelect.title = "数据源账号";
      appendSelectOptions(
        this.sourceSelect,
        previewSource.sources.map(({ id, label }) => [id, label] as const),
      );
      this.sourceSelect.value = previewSource.selectedInstanceId;
      this.sourceSelect.addEventListener("change", () => {
        this.options.onPreviewSourceChange?.(this.sourceSelect.value);
      });
      heading.append(this.sourceSelect);
    } else {
      heading.append(element("span", "candle-heading__source", "同花顺"));
    }

    this.securityInput.type = "search";
    this.securityInput.autocomplete = "off";
    this.securityInput.placeholder = "股票代码";
    this.securityInput.setAttribute("aria-label", "股票代码");
    this.securityForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.confirmSecurity();
    });
    this.securityForm.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.endSecurityEdit();
    });
    append(this.securityForm, this.securityInput, this.securityCandidates);
    this.securityCandidates.hidden = true;

    this.refreshButton.title = "刷新行情";
    this.refreshButton.setAttribute("aria-label", "刷新行情");
    this.refreshButton.addEventListener("click", () => {
      if (this.options.previewSource && requestHostPageRefresh()) return;
      void this.refreshPage();
    });
    append(
      toolbar,
      brand,
      heading,
      element("span", "candle-toolbar__spacer"),
      this.securityForm,
      this.refreshButton,
    );

    const quote = element("section", "candle-quote");
    quote.setAttribute("aria-label", "个股行情摘要");
    const identity = element("div", "candle-identity");
    const security = element("div", "candle-security");
    append(security, this.securityName, this.securityCode);
    const priceRow = element("div", "candle-price-row");
    append(priceRow, this.latestPrice, this.priceChange);
    append(identity, security, priceRow);

    const stats = element("div", "candle-stats");
    stats.setAttribute("aria-label", "当日主要指标");
    for (const [key, label] of [
      ["open", "今开"],
      ["high", "最高"],
      ["low", "最低"],
      ["previousClose", "昨收"],
      ["volume", "成交量"],
      ["amount", "成交额"],
    ] as const) {
      const item = element("div", "candle-stat");
      const value = element("strong", "numeric", "—");
      this.statValues.set(key, value);
      append(item, element("span", "candle-stat__label", label), value);
      stats.append(item);
    }
    append(quote, identity, stats);

    const controls = element("nav", "period-controls");
    controls.setAttribute("aria-label", "K 线周期与指标");
    for (const period of primaryCandlePeriods.filter(
      ({ value }) => value !== "five_day",
    )) {
      const control = button(period.label, "period-button");
      control.title = period.fullLabel;
      control.addEventListener("click", () =>
        this.changeInterval(period.value),
      );
      this.periodButtons.set(period.value, control);
      controls.append(control);
    }
    appendSelectOptions(this.periodSelect, [
      ["", "更多周期"],
      ["five_day", "五日"],
      ...moreCandlePeriods.map(({ value, label }) => [value, label] as const),
    ]);
    this.periodSelect.setAttribute("aria-label", "更多 K 线周期");
    this.periodSelect.addEventListener("change", () => {
      if (this.periodSelect.value)
        this.changeInterval(this.periodSelect.value as KlineInterval);
    });
    appendSelectOptions(this.adjustmentSelect, [
      ["", "不复权"],
      ["forward", "前复权"],
      ["backward", "后复权"],
    ]);
    this.adjustmentSelect.setAttribute("aria-label", "复权方式");
    this.adjustmentSelect.addEventListener("change", () => {
      this.changeAdjustment(this.adjustmentSelect.value as KlineAdjustment);
    });
    this.movingAverageButton.addEventListener("click", () =>
      this.toggleMovingAverages(),
    );
    append(
      controls,
      this.periodSelect,
      this.adjustmentSelect,
      element("span", "period-controls__spacer"),
      this.movingAverageButton,
    );

    const chartPanel = element("section", "chart-panel");
    const legend = element("div", "chart-legend");
    this.historyStatus.hidden = true;
    this.historyStatus.setAttribute("aria-live", "polite");
    append(
      legend,
      this.legendPrimary,
      ...this.averageLegends,
      this.historyStatus,
    );
    this.chart.setAttribute("role", "img");
    this.chart.setAttribute("aria-label", "证券价格、成交量和移动平均线图");
    this.warning.hidden = true;
    append(chartPanel, legend, this.chart, this.warning);
    append(this.chartWorkspace, chartPanel, this.marketInspector.root);

    const connectionDot = element("span", "candle-connection__dot");
    connectionDot.setAttribute("aria-hidden", "true");
    append(this.connection, connectionDot, this.connectionLabel);
    this.connection.setAttribute("role", "status");
    this.connection.setAttribute("aria-live", "polite");
    const footer = element("footer", "candle-statusbar");
    append(
      footer,
      this.latestTime,
      this.rangeStatus,
      element("span", "candle-statusbar__spacer"),
      this.connection,
    );

    append(
      this.frame.content,
      toolbar,
      quote,
      controls,
      this.chartWorkspace,
      footer,
    );
  }

  private query(interval = this.interval) {
    return {
      security: this.security,
      interval,
      count: this.count,
      adjustment: this.adjustment,
    };
  }

  private async loadCandles(force = false): Promise<void> {
    const target = this.interval;
    const version = ++this.renderVersion;
    const query = this.query(target);
    const cached = force ? undefined : this.repository.peek(query);
    if (cached) {
      this.renderCandles(cached, version);
      if (isFresh(cached)) return;
    }
    this.setRefreshBusy(true);
    this.frame.setBusy(
      !this.data || this.data.interval !== target,
      `正在读取${klineIntervalLabel(target)}…`,
    );
    try {
      const result = await this.repository.load(
        query,
        force || Boolean(cached),
      );
      this.renderCandles(result, version);
      this.streamError = "";
      this.renderWarning();
    } catch (error) {
      if (version !== this.renderVersion) return;
      if (!this.recovery.handleError(error)) {
        this.streamError = errorText(error, "行情读取失败，请稍后重试。");
        this.renderWarning();
      }
    } finally {
      if (version === this.renderVersion) {
        this.frame.setBusy(false);
        this.setRefreshBusy(false);
      }
    }
  }

  private renderCandles(result: CandleData, version: number): void {
    if (version !== this.renderVersion || result.interval !== this.interval)
      return;
    this.ensureHistoryPaging(result);
    this.data = result;
    this.hoverBar = undefined;
    this.chartController.render(result);
    this.chartController.setMovingAveragesVisible(this.showMovingAverages);
    this.renderSummary();
  }

  private async loadPreviousHistory(): Promise<void> {
    if (
      this.historyLoading ||
      this.historyComplete ||
      !this.data ||
      !this.historyEndDate
    )
      return;
    const version = this.historyVersion;
    const baseQuery = this.query();
    const controller = new AbortController();
    this.historyAbort?.abort();
    this.historyAbort = controller;
    this.historyLoading = true;
    this.renderHistoryStatus("正在加载更早数据…");

    try {
      for (let attempt = 0; attempt < HISTORY_PAGE_ATTEMPTS; attempt += 1) {
        const endDate = this.historyEndDate;
        if (!endDate) break;
        const query = createHistoryQuery(baseQuery, endDate);
        if (!query) {
          this.historyComplete = true;
          break;
        }
        const page = await this.repository.loadHistory(
          query,
          controller.signal,
        );
        if (
          version !== this.historyVersion ||
          controller.signal.aborted ||
          !this.data
        )
          return;
        this.historyEndDate = previousHistoryEndDate(query);
        if (page.bars.length === 0) {
          this.historyComplete = true;
          break;
        }

        const merged = mergeCandleHistory(this.data, page);
        if (merged.addedBefore === 0) continue;
        this.data = merged.data;
        this.repository.store(baseQuery, merged.data);
        this.hoverBar = undefined;
        this.chartController.prependHistory(merged.data);
        this.chartController.setMovingAveragesVisible(this.showMovingAverages);
        this.renderSummary();
        break;
      }
      this.renderHistoryStatus("");
    } catch (error) {
      if (version !== this.historyVersion || controller.signal.aborted) return;
      this.renderHistoryStatus(errorText(error, "更早数据加载失败。"), true);
    } finally {
      if (version === this.historyVersion) {
        this.historyLoading = false;
        if (this.historyAbort === controller) this.historyAbort = undefined;
      }
    }
  }

  private ensureHistoryPaging(data: CandleData): void {
    const context = historyContextKey(data, this.adjustment);
    if (context === this.historyContext) return;
    this.resetHistoryPaging();
    this.historyContext = context;
    this.historyEndDate = initialHistoryEndDate(data);
    this.historyComplete = this.historyEndDate === null;
  }

  private resetHistoryPaging(): void {
    this.historyVersion += 1;
    this.historyAbort?.abort();
    this.historyAbort = undefined;
    this.historyContext = "";
    this.historyEndDate = null;
    this.historyComplete = false;
    this.historyLoading = false;
    this.renderHistoryStatus("");
  }

  private renderHistoryStatus(message: string, error = false): void {
    this.historyStatus.textContent = message;
    this.historyStatus.hidden = !message;
    this.historyStatus.classList.toggle("is-error", error);
  }

  private async refreshAll(): Promise<void> {
    await this.loadCandles(true);
  }

  /**
   * 刷新按钮执行完整的 App 页面刷新语义：清理实时连接和历史分页，
   * 重新读取入口数据，再恢复当前 App 的实时连接。宿主若支持页面重建
   * 会同时收到刷新意图；不支持的 AI 工具仍可依靠这段逻辑得到一致结果。
   */
  private async refreshPage(): Promise<void> {
    this.stopRealtime("paused");
    this.resetHistoryPaging();
    await this.loadCandles(true);
    if (this.active) await this.startRealtime();
  }

  private async resumeRealtime(): Promise<void> {
    if (!this.active) return;
    const version = ++this.resumeVersion;
    this.stopRealtime();
    await this.refreshAll();
    if (version !== this.resumeVersion || !this.active) return;
    this.prefetchOneMinute();
    await this.startRealtime();
  }

  private async startRealtime(): Promise<void> {
    if (!this.active) return;
    this.stopRealtime();
    const version = ++this.realtimeVersion;
    const controller = new AbortController();
    this.realtimeAbort = controller;
    this.state = "connecting";
    this.renderConnection("正在连接实时行情…");

    const listener: MarketRealtimeListener = {
      onConnectionState: (state, message) => {
        if (version !== this.realtimeVersion) return;
        this.state = state === "closed" ? "error" : state;
        if (state === "connected") this.streamError = "";
        this.renderConnection(message);
        this.renderWarning();
      },
      onQuote: (quote) => {
        if (version === this.realtimeVersion) this.applyQuote(quote);
      },
      onModeChange: (mode, fallbackReason) => {
        if (version !== this.realtimeVersion) return;
        this.marketInspector.setMode(mode, fallbackReason);
      },
      onDepth: (bids, asks) => {
        if (version !== this.realtimeVersion) return;
        this.marketInspector.updateDepth(bids, asks);
      },
      onTransactions: (transactions) => {
        if (version !== this.realtimeVersion) return;
        this.marketInspector.updateTransactions(transactions);
      },
      onIntraday: (points) => {
        if (version !== this.realtimeVersion || !this.data) return;
        this.marketInspector.updateIntraday(points);
        this.updateRealtimeData(
          applyRealtimePoints(
            this.data,
            points,
            this.previousClose,
            this.realtimeCursor,
          ),
        );
      },
      onResyncRequired: () => {
        if (version === this.realtimeVersion) this.requestResync();
      },
      onError: (message) => {
        if (version !== this.realtimeVersion) return;
        this.streamError = message;
        this.state =
          this.options.realtimeService.connection.getSnapshot().state ===
          "reconnecting"
            ? "reconnecting"
            : "error";
        this.renderConnection(message);
        this.renderWarning();
      },
    };

    try {
      const connection = await this.options.realtimeService.connect(
        this.security,
        listener,
        controller.signal,
      );
      if (version !== this.realtimeVersion || !this.active) connection.close();
      else this.realtimeConnection = connection;
    } catch (error) {
      if (version !== this.realtimeVersion || isAbortError(error)) return;
      this.streamError = errorText(error, "实时行情连接失败。");
      const unavailable =
        this.recovery.handleError(error) ||
        this.options.realtimeService.connection.getSnapshot().state ===
          "reconnecting";
      this.state = unavailable ? "reconnecting" : "error";
      this.renderConnection(this.streamError);
      this.renderWarning();
    }
  }

  private stopRealtime(nextState?: PanelState): void {
    this.realtimeVersion += 1;
    this.realtimeAbort?.abort();
    this.realtimeAbort = undefined;
    this.realtimeConnection?.close();
    this.realtimeConnection = undefined;
    this.realtimeResync = undefined;
    if (nextState) {
      this.state = nextState;
      this.renderConnection(
        nextState === "paused" ? "实时行情已暂停" : "实时行情已断开",
      );
    }
  }

  private requestResync(): void {
    if (this.realtimeResync) return;
    const promise = this.refreshAll();
    this.realtimeResync = promise;
    void promise.finally(() => {
      if (this.realtimeResync === promise) this.realtimeResync = undefined;
    });
  }

  private applyQuote(quote: MarketRealtimeQuote): void {
    if (quote.securityName) {
      this.security.name = quote.securityName;
      if (this.data) {
        this.data = {
          ...this.data,
          security: { ...this.data.security, name: quote.securityName },
        };
      }
    }
    this.previousClose = quote.previousClose ?? this.previousClose;
    this.marketInspector.setReferencePrice(this.previousClose);
    initializeRealtimeCursor(this.realtimeCursor, quote);
    if (this.data)
      this.updateRealtimeData(applyRealtimeQuote(this.data, quote));
  }

  private updateRealtimeData(result: CandleData): void {
    if (result === this.data) return;
    this.data = result;
    this.hoverBar = undefined;
    this.chartController.update(result);
    this.chartController.setMovingAveragesVisible(this.showMovingAverages);
    this.renderSummary();
  }

  private renderSummary(): void {
    const displayed = this.hoverBar ?? this.data?.latest;
    const name =
      this.data?.security.name || this.security.name || this.security.code;
    this.securityName.textContent = name;
    this.securityCode.textContent = `${this.security.code} · ${marketLabel(this.security.market)}`;
    if (document.activeElement !== this.securityInput) {
      this.securityInput.value = this.security.code;
    }

    this.latestPrice.textContent = formatPrice(displayed?.close);
    const change = displayed ? this.displayedChange(displayed) : null;
    const tone =
      change === null || change.value === 0
        ? "flat"
        : change.value > 0
          ? "rise"
          : "fall";
    this.latestPrice.className = `candle-price numeric is-${tone}`;
    this.priceChange.className = `candle-change numeric is-${tone}`;
    this.priceChange.textContent = change
      ? `${formatSignedPrice(change.value)}  ${formatSignedPercent(change.percent)}`
      : "—";

    const previousClose = displayed ? this.previousCloseFor(displayed) : null;
    this.marketInspector.setReferencePrice(previousClose);
    setStat(this.statValues, "open", formatPrice(displayed?.open));
    setStat(this.statValues, "high", formatPrice(displayed?.high));
    setStat(this.statValues, "low", formatPrice(displayed?.low));
    setStat(this.statValues, "previousClose", formatPrice(previousClose));
    setStat(this.statValues, "volume", formatCompact(displayed?.volume));
    setStat(this.statValues, "amount", formatCurrency(displayed?.amount));

    this.latestTime.textContent = displayed
      ? `最近数据 ${displayed.label}`
      : "等待行情数据";
    this.rangeStatus.textContent = this.data
      ? `${this.data.bars.length} 根 · ${this.data.intervalLabel}`
      : klineIntervalLabel(this.interval);
    this.renderLegend(displayed);

    const label = displayed
      ? `${name} ${this.data?.intervalLabel || klineIntervalLabel(this.interval)}，价格 ${formatPrice(displayed.close)}，最高 ${formatPrice(displayed.high)}，最低 ${formatPrice(displayed.low)}`
      : `${name} ${klineIntervalLabel(this.interval)}，正在等待数据`;
    this.chart.setAttribute("aria-label", label);
  }

  private renderLegend(displayed?: CandleBar): void {
    if (!displayed) {
      this.legendPrimary.textContent = "等待行情数据";
      for (const [index, target] of this.averageLegends.entries()) {
        target.textContent = `MA${[5, 10, 20][index]} —`;
      }
      return;
    }
    this.legendPrimary.textContent = isLineKlineInterval(this.interval)
      ? `${displayed.label}  价格 ${formatPrice(displayed.close)}`
      : `${displayed.label}  开 ${formatPrice(displayed.open)}  高 ${formatPrice(displayed.high)}  低 ${formatPrice(displayed.low)}  收 ${formatPrice(displayed.close)}`;
    const lineMode = isLineKlineInterval(this.interval);
    for (const [index, period] of [5, 10, 20].entries()) {
      const target = this.averageLegends[index]!;
      target.hidden = lineMode || !this.showMovingAverages;
      target.textContent = `MA${period} ${formatPrice(movingAverageAtBar(this.data, displayed, period))}`;
    }
  }

  private displayedChange(
    displayed: CandleBar,
  ): { value: number; percent: number | null } | null {
    if (this.data && displayed.time === this.data.latest.time) {
      const value = this.data.latest.change;
      return value === null
        ? null
        : { value, percent: this.data.latest.changePercent };
    }
    const previous = this.previousCloseFor(displayed);
    if (previous === null) return null;
    const value = displayed.close - previous;
    return { value, percent: previous === 0 ? null : (value / previous) * 100 };
  }

  private previousCloseFor(displayed: CandleBar): number | null {
    if (!this.data) return null;
    if (displayed.time === this.data.latest.time && this.previousClose !== null)
      return this.previousClose;
    const index = this.data.bars.findIndex(
      (bar) => bar.time === displayed.time,
    );
    if (index > 0) return this.data.bars[index - 1]!.close;
    if (
      displayed.time === this.data.latest.time &&
      this.data.latest.change !== null
    ) {
      return displayed.close - this.data.latest.change;
    }
    return null;
  }

  private renderConnection(message: string): void {
    const state =
      this.state === "connected"
        ? "connected"
        : this.state === "connecting" || this.state === "reconnecting"
          ? "reconnecting"
          : "disconnected";
    this.frame.setConnection(state, message);
    this.connection.className = `candle-connection is-${state}`;
    this.connectionLabel.textContent =
      state === "connected"
        ? "行情已连接"
        : state === "reconnecting"
          ? "正在重连"
          : this.state === "paused"
            ? "行情已暂停"
            : "行情未连接";
    this.connection.title = message;
  }

  private renderWarning(): void {
    this.warning.hidden = !this.streamError;
    this.warning.textContent = this.streamError;
  }

  private renderControlState(): void {
    for (const [value, control] of this.periodButtons) {
      control.setAttribute("aria-pressed", String(value === this.interval));
    }
    const secondary = this.periodSelect.querySelector(
      `option[value="${this.interval}"]`,
    );
    this.periodSelect.value = secondary ? this.interval : "";
    this.adjustmentSelect.value = this.adjustment;
    const lineMode = isLineKlineInterval(this.interval);
    this.movingAverageButton.disabled = lineMode;
    this.movingAverageButton.setAttribute(
      "aria-pressed",
      String(!lineMode && this.showMovingAverages),
    );
  }

  private changeInterval(interval: KlineInterval): void {
    if (this.interval === interval) return;
    this.resetHistoryPaging();
    this.interval = interval;
    this.renderControlState();
    void this.loadCandles();
  }

  private changeAdjustment(adjustment: KlineAdjustment): void {
    if (this.adjustment === adjustment) return;
    this.resetHistoryPaging();
    this.adjustment = adjustment;
    this.renderControlState();
    void this.loadCandles();
  }

  private toggleMovingAverages(): void {
    this.showMovingAverages = !this.showMovingAverages;
    this.movingAverageButton.setAttribute(
      "aria-pressed",
      String(this.showMovingAverages),
    );
    this.chartController.setMovingAveragesVisible(this.showMovingAverages);
    this.renderLegend(this.hoverBar ?? this.data?.latest);
  }

  private endSecurityEdit(): void {
    this.securitySearchVersion += 1;
    this.securitySearch?.abort();
    this.securityCandidates.hidden = true;
    this.securityInput.value = this.security.code;
    this.securityInput.blur();
  }

  private async confirmSecurity(): Promise<void> {
    const input = this.securityInput.value.trim();
    if (!input) return;
    const exactSecurity = securityFromMainlandCode(input);
    if (exactSecurity) {
      this.changeSecurity(exactSecurity);
      return;
    }
    const version = ++this.securitySearchVersion;
    this.securitySearch?.abort();
    const controller = new AbortController();
    this.securitySearch = controller;
    this.securityInput.setAttribute("aria-busy", "true");
    try {
      const results = await this.options.securityService.searchSecurities(
        securitySearchPattern(input),
        controller.signal,
      );
      if (version !== this.securitySearchVersion) return;
      const matches = matchingSecurityCodes(input, results);
      if (!matches.length) throw new Error("未找到该证券，请核对代码或名称。");
      if (matches.length === 1) this.changeSecurity(matches[0]!);
      else this.renderSecurityCandidates(matches);
    } catch (error) {
      if (controller.signal.aborted || version !== this.securitySearchVersion)
        return;
      replace(
        this.securityCandidates,
        element(
          "div",
          "security-candidates__error",
          errorText(error, "证券查询失败。"),
        ),
      );
      this.securityCandidates.hidden = false;
    } finally {
      if (version === this.securitySearchVersion)
        this.securityInput.removeAttribute("aria-busy");
    }
  }

  private renderSecurityCandidates(matches: readonly MarketSecurity[]): void {
    replace(this.securityCandidates);
    for (const security of matches) {
      const choice = button(
        `${security.name || "未知名称"}  ${security.market}${security.code}`,
        "search-result",
      );
      choice.addEventListener("click", () => this.changeSecurity(security));
      this.securityCandidates.append(choice);
    }
    this.securityCandidates.hidden = false;
  }

  private changeSecurity(security: MarketSecurity): void {
    this.security = { ...security };
    this.endSecurityEdit();
    this.resumeVersion += 1;
    this.stopRealtime();
    this.renderVersion += 1;
    this.resetHistoryPaging();
    this.chartController.destroy();
    this.data = undefined;
    this.hoverBar = undefined;
    this.streamError = "";
    this.previousClose = null;
    this.marketInspector.setSecurity(this.security);
    this.realtimeCursor.dayKey = undefined;
    this.realtimeCursor.volume = undefined;
    this.realtimeCursor.amount = undefined;
    this.renderSummary();
    if (this.active) void this.resumeRealtime();
  }

  private prefetchOneMinute(): void {
    if (this.interval === "1m") return;
    void this.repository.load(this.query("1m")).catch(() => undefined);
  }

  private setRefreshBusy(busy: boolean): void {
    this.refreshButton.disabled = busy;
    this.refreshButton.classList.toggle("is-spinning", busy);
  }

  private setInspectorWorkspaceMode(mode: MarketInspectorWorkspaceMode): void {
    this.chartWorkspace.classList.toggle(
      "is-inspector-panorama",
      mode === "panorama",
    );
    globalThis.requestAnimationFrame(() => this.chartController?.resize());
  }
}

function appendSelectOptions(
  select: HTMLSelectElement,
  options: ReadonlyArray<readonly [string, string]>,
): void {
  for (const [value, label] of options) {
    const option = element("option", undefined, label);
    option.value = value;
    select.append(option);
  }
}

function setStat(
  values: Map<string, HTMLElement>,
  key: string,
  value: string,
): void {
  const target = values.get(key);
  if (target) target.textContent = value;
}

function movingAverageAtBar(
  data: CandleData | undefined,
  bar: CandleBar,
  period: number,
): number | null {
  if (!data) return null;
  const index = data.bars.findIndex((item) => item.time === bar.time);
  if (index < period - 1) return null;
  let total = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1)
    total += data.bars[cursor]!.close;
  return total / period;
}

function marketLabel(market: string): string {
  const normalized = market.toUpperCase();
  if (
    normalized === "XSHG" ||
    normalized.includes("SHA") ||
    normalized === "SH"
  )
    return "上交所";
  if (
    normalized === "XSHE" ||
    normalized.includes("SZA") ||
    normalized === "SZ"
  )
    return "深交所";
  if (
    normalized === "XBSE" ||
    normalized.includes("BJA") ||
    normalized === "BJ"
  )
    return "北交所";
  return market;
}

function isFresh(data: CandleData): boolean {
  const age = Date.now() - Date.parse(data.fetchedAt);
  const maxAge = ["day", "week", "month"].includes(data.interval)
    ? 5 * 60_000
    : 30_000;
  return Number.isFinite(age) && age >= 0 && age < maxAge;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function historyContextKey(
  data: CandleData,
  adjustment: KlineAdjustment,
): string {
  return [
    data.security.market,
    data.security.code,
    data.interval,
    adjustment,
  ].join(":");
}
