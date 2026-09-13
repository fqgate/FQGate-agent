<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";

import ComponentFrame from "@/components/shared/ComponentFrame.vue";
import SecurityCodeEditor from "@/components/shared/SecurityCodeEditor.vue";
import type { ComponentConnectionState } from "@/components/shared/contracts";
import { useDataServiceReconnect } from "@/composables/useDataServiceReconnect";
import { useDelayedVisibility } from "@/composables/useDelayedVisibility";
import type {
  CandleBar,
  CandleData,
  CandleService,
  KlineAdjustment,
  KlineInterval,
  MarketDepthData,
  MarketDepthFallbackReason,
  MarketDepthLevel,
  MarketDepthService,
  MarketRealtimeConnection,
  MarketRealtimeListener,
  MarketRealtimeQuote,
  MarketRealtimeService,
  MarketSecurity,
  SecuritySearchService
} from "@/shared/contracts";
import { isLineKlineInterval, klineIntervalLabel } from "@/shared/kline";
import { CandleChartController } from "./CandleChartController";
import { CandleDataRepository } from "./CandleDataRepository";
import MarketDepthPanel from "./MarketDepthPanel.vue";
import { moreCandlePeriods, primaryCandlePeriods } from "./candlePeriods";
import { defaultCandleInterval } from "./defaultCandleInterval";
import {
  formatCompact,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice
} from "./formatters";
import {
  applyRealtimePoints,
  applyRealtimeQuote,
  initializeRealtimeCursor,
  type RealtimeCandleCursor
} from "./realtimeCandles";

const props = withDefaults(defineProps<{
  service: CandleService;
  securityService: SecuritySearchService;
  marketDepthService: MarketDepthService;
  realtimeService: MarketRealtimeService;
  security: MarketSecurity;
  active?: boolean;
  hiddenDelayMs?: number;
  initialInterval?: KlineInterval;
  count?: number;
  adjustment?: KlineAdjustment;
}>(), {
  count: 160,
  adjustment: "",
  active: true,
  hiddenDelayMs: 5_000
});

type PanelState = "idle" | "connecting" | "connected" | "paused" | "reconnecting" | "error";
const TRANSACTION_BUFFER_LIMIT = 500;
const emit = defineEmits<{ "update:security": [security: MarketSecurity] }>();
const security = ref<MarketSecurity>({ ...props.security });

const root = ref<HTMLElement>();
const streamEnabled = useDelayedVisibility(root, toRef(props, "active"), props.hiddenDelayMs);
const chartElement = ref<HTMLElement>();
const interval = ref<KlineInterval>(props.initialInterval ?? defaultCandleInterval());
const data = ref<CandleData>();
const hoverBar = ref<CandleBar>();
const busy = ref(false);
const error = ref("");
const marketDepthData = ref<MarketDepthData>();
const marketDepthBusy = ref(false);
const marketDepthError = ref("");
const panelState = ref<PanelState>("idle");
const streamError = ref("");
const showMovingAverages = ref(true);
let chartController: CandleChartController | undefined;
let resizeObserver: ResizeObserver | undefined;
let repository = new CandleDataRepository(props.service);
let renderVersion = 0;
let marketDepthVersion = 0;
let marketDepthAbort: AbortController | undefined;
let realtimeConnection: MarketRealtimeConnection | undefined;
let realtimeAbort: AbortController | undefined;
let realtimeVersion = 0;
let resumeVersion = 0;
let realtimeResyncPromise: Promise<void> | undefined;
let previousClose: number | null = null;
const realtimeCursor: RealtimeCandleCursor = {};

const {
  reconnecting: dataServiceReconnecting,
  connectionLoading: dataServiceLoading,
  handleServiceError
} = useDataServiceReconnect({
  service: props.realtimeService,
  onRecovered: () => streamEnabled.value ? resumeRealtime() : undefined
});

const displayedBar = computed(() => hoverBar.value ?? data.value?.latest);
const isLinePeriod = computed(() => isLineKlineInterval(interval.value));
const isMorePeriod = computed(() => moreCandlePeriods.some((period) => period.value === interval.value));
const loadingTip = computed(() => `正在读取${klineIntervalLabel(interval.value)}…`);
const isDisplayingLatest = computed(() => (
  Boolean(data.value && displayedBar.value && displayedBar.value.time === data.value.latest.time)
));
const directionClass = computed(() => {
  if (!isDisplayingLatest.value || data.value?.latest.change === null) return "neutral";
  if (data.value!.latest.change > 0) return "rise";
  if (data.value!.latest.change < 0) return "fall";
  return "neutral";
});
const changeText = computed(() => {
  if (!isDisplayingLatest.value || !data.value) return "—";
  return `${formatSignedPrice(data.value.latest.change)}  ${formatSignedPercent(data.value.latest.changePercent)}`;
});
const securityName = computed(() => data.value?.security.name || security.value.name || security.value.code);
const latestTime = computed(() => {
  if (!displayedBar.value) return "等待行情数据";
  return `${displayedBar.value.label} · ${data.value?.intervalLabel ?? ""}`;
});
const needsBlockingOverlay = computed(() => (
  data.value?.interval !== interval.value && (busy.value || Boolean(error.value))
));
const refreshing = computed(() => busy.value || marketDepthBusy.value);
const componentConnectionState = computed<ComponentConnectionState>(() => {
  if (dataServiceReconnecting.value) return "reconnecting";
  if (panelState.value === "connected") return "connected";
  if (panelState.value === "connecting" || panelState.value === "reconnecting") {
    return "reconnecting";
  }
  return "disconnected";
});
const connectionLoading = computed(() => (
  streamEnabled.value
  && (dataServiceLoading.value || panelState.value === "connecting" || panelState.value === "reconnecting")
));
const connectionLoadingTip = computed(() => (
  dataServiceLoading.value ? "正在重连数据服务" : "正在连接实时行情"
));

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "行情读取失败，请稍后重试。";
}

function candleQuery(targetInterval: KlineInterval) {
  return {
    security: security.value,
    interval: targetInterval,
    count: props.count,
    adjustment: props.adjustment
  };
}

function isFresh(result: CandleData): boolean {
  const age = Date.now() - Date.parse(result.fetchedAt);
  const maxAge = result.interval === "day" || result.interval === "week" || result.interval === "month"
    ? 5 * 60_000
    : 30_000;
  return Number.isFinite(age) && age >= 0 && age < maxAge;
}

async function renderCandles(result: CandleData, version: number): Promise<void> {
  if (version !== renderVersion || interval.value !== result.interval) return;
  data.value = result;
  hoverBar.value = undefined;
  await nextTick();
  if (version !== renderVersion || interval.value !== result.interval) return;
  chartController?.render(result);
  chartController?.setMovingAveragesVisible(showMovingAverages.value);
}

async function loadCandles(force = false): Promise<void> {
  const targetInterval = interval.value;
  const version = ++renderVersion;
  const query = candleQuery(targetInterval);
  const cached = force ? undefined : repository.peek(query);
  if (cached) {
    await renderCandles(cached, version);
    if (isFresh(cached)) {
      busy.value = false;
      error.value = "";
      return;
    }
  }

  busy.value = true;
  error.value = "";
  try {
    const result = await repository.load(query, force || Boolean(cached));
    await renderCandles(result, version);
  } catch (reason) {
    if (version === renderVersion && !handleServiceError(reason)) {
      error.value = errorMessage(reason);
    }
  } finally {
    if (version === renderVersion) busy.value = false;
  }
}

async function loadMarketDepth(): Promise<void> {
  const version = ++marketDepthVersion;
  marketDepthAbort?.abort();
  const controller = new AbortController();
  marketDepthAbort = controller;
  marketDepthBusy.value = true;
  marketDepthError.value = "";
  try {
    const result = await props.marketDepthService.getMarketDepth(security.value, controller.signal);
    if (version === marketDepthVersion && !controller.signal.aborted) marketDepthData.value = result;
  } catch (reason) {
    if (controller.signal.aborted || version !== marketDepthVersion) return;
    if (!handleServiceError(reason)) marketDepthError.value = errorMessage(reason);
  } finally {
    if (version === marketDepthVersion) marketDepthBusy.value = false;
  }
}

async function refreshAll(): Promise<void> {
  await Promise.allSettled([loadCandles(true), loadMarketDepth()]);
}

async function resumeRealtime(): Promise<void> {
  if (!streamEnabled.value) return;
  const version = ++resumeVersion;
  stopRealtimeConnection();
  await refreshAll();
  if (version !== resumeVersion || !streamEnabled.value) return;
  prefetchOneMinute();
  await startRealtimeConnection();
}

async function startRealtimeConnection(): Promise<void> {
  if (!streamEnabled.value) return;
  stopRealtimeConnection();
  const version = ++realtimeVersion;
  const controller = new AbortController();
  realtimeAbort = controller;
  panelState.value = "connecting";
  streamError.value = "";

  const listener: MarketRealtimeListener = {
    onConnectionState: (state) => {
      if (version !== realtimeVersion) return;
      if (state === "connected") streamError.value = "";
      if (state === "closed") {
        panelState.value = props.realtimeService.connection.getSnapshot().state === "reconnecting"
          ? "reconnecting"
          : "error";
      } else {
        panelState.value = state;
      }
    },
    onModeChange: (mode, fallbackReason) => {
      if (version !== realtimeVersion) return;
      updateMarketMode(mode, fallbackReason);
    },
    onQuote: (quote) => {
      if (version !== realtimeVersion) return;
      applyQuote(quote);
    },
    onIntraday: (points) => {
      if (version !== realtimeVersion || !data.value) return;
      const result = applyRealtimePoints(data.value, points, previousClose, realtimeCursor);
      updateRealtimeChart(result);
    },
    onDepth: (bids, asks) => {
      if (version !== realtimeVersion) return;
      updateMarketDepth(bids, asks);
    },
    onTransactions: (transactions) => {
      if (version !== realtimeVersion || !transactions.length) return;
      const current = ensureMarketDepthData();
      const byId = new Map(
        [...transactions, ...current.transactions].map((item) => [item.id, item])
      );
      marketDepthData.value = {
        ...current,
        fetchedAt: new Date().toISOString(),
        transactions: [...byId.values()]
          .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))
          .slice(0, TRANSACTION_BUFFER_LIMIT)
      };
    },
    onResyncRequired: () => {
      if (version === realtimeVersion) requestRealtimeResync();
    },
    onError: (message) => {
      if (version !== realtimeVersion) return;
      streamError.value = message;
      panelState.value = props.realtimeService.connection.getSnapshot().state === "reconnecting"
        ? "reconnecting"
        : "error";
    }
  };

  try {
    const connection = await props.realtimeService.connect(security.value, listener, controller.signal);
    if (version !== realtimeVersion || !streamEnabled.value) {
      connection.close();
      return;
    }
    realtimeConnection = connection;
  } catch (reason) {
    if (version !== realtimeVersion || isAbortError(reason)) return;
    const message = errorMessage(reason);
    streamError.value = message;
    const unavailable = handleServiceError(reason)
      || props.realtimeService.connection.getSnapshot().state === "reconnecting";
    panelState.value = unavailable ? "reconnecting" : "error";
  }
}

/**
 * 推送异常可能在短时间内连续上报。同一时刻只允许一轮快照重同步，
 * 避免新请求反复取消旧请求，导致界面长时间处于刷新状态。
 */
function requestRealtimeResync(): void {
  if (realtimeResyncPromise) return;
  const promise = refreshAll();
  realtimeResyncPromise = promise;
  void promise.finally(() => {
    if (realtimeResyncPromise === promise) realtimeResyncPromise = undefined;
  });
}

function stopRealtimeConnection(nextState?: PanelState): void {
  realtimeVersion += 1;
  realtimeAbort?.abort();
  realtimeAbort = undefined;
  realtimeConnection?.close();
  realtimeConnection = undefined;
  realtimeResyncPromise = undefined;
  if (nextState) panelState.value = nextState;
}

function applyQuote(quote: MarketRealtimeQuote): void {
  previousClose = quote.previousClose ?? previousClose;
  initializeRealtimeCursor(realtimeCursor, quote);
  if (!data.value) return;
  updateRealtimeChart(applyRealtimeQuote(data.value, quote));
}

function updateRealtimeChart(result: CandleData): void {
  if (result === data.value) return;
  data.value = result;
  hoverBar.value = undefined;
  chartController?.update(result);
  chartController?.setMovingAveragesVisible(showMovingAverages.value);
}

function updateMarketMode(
  mode: MarketDepthData["mode"],
  fallbackReason?: MarketDepthFallbackReason
): void {
  const current = ensureMarketDepthData();
  marketDepthData.value = { ...current, mode, fallbackReason };
}

function updateMarketDepth(bids: MarketDepthLevel[], asks: MarketDepthLevel[]): void {
  const current = ensureMarketDepthData();
  marketDepthData.value = {
    ...current,
    fetchedAt: new Date().toISOString(),
    bids,
    asks
  };
}

function ensureMarketDepthData(): MarketDepthData {
  return marketDepthData.value ?? {
    security: {
      market: security.value.market,
      code: security.value.code,
      name: security.value.name || security.value.code,
      fullCode: security.value.fullCode || `${security.value.market}${security.value.code}`
    },
    mode: "basic",
    fallbackReason: "level2_unknown",
    fetchedAt: new Date().toISOString(),
    bids: emptyDepthLevels(),
    asks: emptyDepthLevels(),
    transactions: []
  };
}

function emptyDepthLevels(): MarketDepthLevel[] {
  return Array.from({ length: 5 }, (_, index) => ({
    level: index + 1,
    price: null,
    volume: null
  }));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function prefetchOneMinute(): void {
  if (interval.value === "1m") return;
  void repository.load(candleQuery("1m")).catch(() => {
    // 预取失败不打扰当前图表；用户主动切换时仍会再次读取并显示错误。
  });
}

function handlePeriodChange(value: string | number | boolean): void {
  interval.value = String(value) as KlineInterval;
  void loadCandles();
}

function handleMorePeriodSelect(
  value: string | number | Record<string, unknown> | undefined
): void {
  if (value === "toggle-ma") {
    toggleMovingAverages();
  } else if (typeof value === "string") {
    handlePeriodChange(value);
  }
}

function toggleMovingAverages(): void {
  showMovingAverages.value = !showMovingAverages.value;
  chartController?.setMovingAveragesVisible(showMovingAverages.value);
}

function changeSecurity(value: MarketSecurity): void {
  security.value = { ...value };
  emit("update:security", value);
}

watch(
  () => [props.security.market, props.security.code, props.security.name, props.security.fullCode],
  () => { security.value = { ...props.security }; }
);

watch(
  security,
  () => {
    // 切换代码先使旧请求和推送失效，不能在新标题下展示上一只证券的图表或盘口。
    resumeVersion += 1;
    stopRealtimeConnection();
    renderVersion += 1;
    marketDepthVersion += 1;
    marketDepthAbort?.abort();
    chartController?.destroy();
    data.value = undefined;
    hoverBar.value = undefined;
    marketDepthData.value = undefined;
    error.value = "";
    streamError.value = "";
    marketDepthError.value = "";
    previousClose = null;
    realtimeCursor.dayKey = undefined;
    realtimeCursor.volume = undefined;
    realtimeCursor.amount = undefined;
    if (streamEnabled.value) void resumeRealtime();
  },
  { flush: "sync" }
);

watch(
  () => props.service,
  (service) => {
    repository = new CandleDataRepository(service);
    if (streamEnabled.value) void resumeRealtime();
  }
);

watch(
  () => props.marketDepthService,
  () => {
    marketDepthData.value = undefined;
    if (streamEnabled.value) void loadMarketDepth();
  }
);

watch(streamEnabled, (enabled, wasEnabled) => {
  if (enabled && !wasEnabled) {
    void resumeRealtime();
  } else if (!enabled && wasEnabled) {
    resumeVersion += 1;
    stopRealtimeConnection("paused");
  }
}, { immediate: true });

onMounted(() => {
  if (!chartElement.value) return;
  chartController = new CandleChartController(chartElement.value, (bar) => {
    hoverBar.value = bar ?? undefined;
  });
  resizeObserver = new ResizeObserver(() => chartController?.resize());
  resizeObserver.observe(chartElement.value);
});

onBeforeUnmount(() => {
  resumeVersion += 1;
  stopRealtimeConnection();
  renderVersion += 1;
  marketDepthVersion += 1;
  marketDepthAbort?.abort();
  resizeObserver?.disconnect();
  chartController?.destroy();
});
</script>

<template>
  <section ref="root" class="candle-component-root">
  <ComponentFrame
    realtime
    refreshable
    :connection-state="componentConnectionState"
    :connection-loading="connectionLoading"
    :loading-tip="connectionLoadingTip"
    :refreshing="refreshing"
    @refresh="refreshAll"
  >
    <a-card class="candle-panel" :body-style="{ padding: 0 }">
    <header class="quote-header">
      <div class="identity">
        <SecurityCodeEditor
          class="title-row" :security="security" :name="securityName"
          :service="securityService" @change="changeSecurity"
        />
        <div class="price-row">
          <strong class="latest-price" :class="directionClass">{{ formatPrice(displayedBar?.close) }}</strong>
          <span class="price-change" :class="directionClass">{{ changeText }}</span>
        </div>
        <a-typography-text class="latest-time" type="secondary">{{ latestTime }}</a-typography-text>
      </div>

      <div class="toolbar" aria-label="图表控制">
        <div class="period-control">
          <a-radio-group
            :model-value="interval"
            type="button"
            @change="handlePeriodChange"
          >
            <a-radio v-for="period in primaryCandlePeriods" :key="period.value" :value="period.value">
              {{ period.label }}
            </a-radio>
          </a-radio-group>
        </div>
        <a-dropdown trigger="click" @select="handleMorePeriodSelect">
          <a-button class="more-period-button" :type="isMorePeriod ? 'primary' : 'secondary'">
            更多
          </a-button>
          <template #content>
            <a-doption
              v-for="period in moreCandlePeriods"
              :key="period.value"
              :value="period.value"
              :active="interval === period.value"
            >
              {{ period.label }}
            </a-doption>
            <a-doption value="toggle-ma" :disabled="isLinePeriod">
              {{ showMovingAverages ? "隐藏均线" : "显示均线" }}
            </a-doption>
          </template>
        </a-dropdown>
      </div>
    </header>

    <section class="stat-grid" aria-label="行情摘要">
      <div><span>开</span><strong>{{ formatPrice(displayedBar?.open) }}</strong></div>
      <div><span>高</span><strong>{{ formatPrice(displayedBar?.high) }}</strong></div>
      <div><span>低</span><strong>{{ formatPrice(displayedBar?.low) }}</strong></div>
      <div><span>成交量</span><strong>{{ formatCompact(displayedBar?.volume) }}</strong></div>
      <div><span>成交额</span><strong>{{ formatCurrency(displayedBar?.amount) }}</strong></div>
      <div><span>换手率</span><strong>{{ formatPercent(displayedBar?.turnoverRate) }}</strong></div>
    </section>

    <div class="market-workspace">
      <section class="chart-panel">
        <div class="legend" aria-hidden="true">
          <span class="legend-candle">
            {{ interval === "intraday" ? "分时价格" : interval === "five_day" ? "五日走势" : "K 线" }}
          </span>
          <template v-if="!isLinePeriod">
            <span class="legend-ma5">MA5</span>
            <span class="legend-ma10">MA10</span>
            <span class="legend-ma20">MA20</span>
          </template>
          <span>成交量</span>
        </div>
        <div class="chart-stage">
          <div ref="chartElement" class="chart" role="img" aria-label="证券 K 线、成交量和移动平均线图" />
          <div v-if="needsBlockingOverlay" class="chart-overlay" aria-live="polite">
            <a-spin v-if="busy" :tip="loadingTip" />
            <a-space v-else direction="vertical" align="center">
              <a-typography-text type="danger">{{ error }}</a-typography-text>
              <a-button @click="loadCandles()">重新读取</a-button>
            </a-space>
          </div>
          <a-alert
            v-else-if="error || streamError"
            class="chart-warning"
            type="error"
            :show-icon="true"
            closable
          >
            {{ error || streamError }}
          </a-alert>
        </div>
      </section>
      <MarketDepthPanel
        :data="marketDepthData"
        :loading="marketDepthBusy"
        :error="marketDepthError"
        @retry="loadMarketDepth"
      />
    </div>

    </a-card>
  </ComponentFrame>
  </section>
</template>

<style scoped>
.candle-component-root {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.candle-panel {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.quote-header {
  display: flex;
  flex-wrap: nowrap;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px 12px;
}

.identity {
  flex: 0 1 auto;
  min-width: 0;
  width: 190px;
  max-width: 100%;
}

.price-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  white-space: nowrap;
}

.latest-price {
  margin-top: 7px;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -1px;
}

.price-change {
  font-size: 13px;
  font-weight: 600;
}

.latest-time {
  display: block;
  min-height: 20px;
  margin-top: 6px;
  font-size: 12px;
}

.rise {
  color: rgb(var(--red-6));
}

.fall {
  color: rgb(var(--green-6));
}

.neutral {
  color: var(--color-text-3);
}

.toolbar {
  display: flex;
  flex: 1 1 200px;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.toolbar > :deep(.arco-btn) {
  flex: 0 0 auto;
}

.period-control {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.period-control::-webkit-scrollbar {
  display: none;
}

.period-control :deep(.arco-radio-group) {
  display: flex;
  flex-wrap: nowrap;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  margin: 0 20px 8px;
  padding: 10px 12px;
  background: var(--color-fill-1);
  border-radius: var(--border-radius-medium);
}

.stat-grid div {
  min-width: 0;
  padding: 0 10px;
  border-right: 1px solid var(--color-border-2);
}

.stat-grid div:last-child {
  border-right: 0;
}

.stat-grid span,
.stat-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-grid span {
  color: var(--color-text-3);
  font-size: 11px;
}

.stat-grid strong {
  margin-top: 3px;
  color: var(--color-text-1);
  font-size: 13px;
}

.market-workspace {
  display: flex;
  min-width: 0;
}

.chart-panel {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  border-top: 1px solid var(--color-border-2);
}

.legend {
  display: flex;
  gap: 12px;
  height: 30px;
  padding: 9px 20px 0;
  color: var(--color-text-3);
  font-size: 11px;
}

.legend-candle {
  color: var(--color-text-1);
}

.legend-ma5 {
  color: rgb(var(--orange-6));
}

.legend-ma10 {
  color: rgb(var(--purple-6));
}

.legend-ma20 {
  color: rgb(var(--cyan-6));
}

.chart-stage {
  position: relative;
  height: 510px;
}

.chart {
  width: 100%;
  height: 100%;
}

.chart-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  padding: 24px;
  place-items: center;
  text-align: center;
  background: var(--color-bg-2);
}

.chart-warning {
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 68px;
  max-width: calc(100% - 88px);
}

@media (max-width: 760px) {
  .quote-header {
    gap: 12px;
    padding: 16px 14px 10px;
  }

  .stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: 10px;
    margin-inline: 14px;
  }

  .stat-grid div:nth-child(3) {
    border-right: 0;
  }

  .chart-stage {
    height: 360px;
  }
}

@media (max-width: 960px) {
  .market-workspace {
    display: block;
  }
}
</style>
