<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";

import {
  FqgateCandleService,
  FqgateSecuritySearchService,
  FqgateInformationService,
  FqgateLoginService,
  FqgateMarketDepthService,
  FqgateMarketRealtimeService,
  FqgateMarketQuoteService,
  FqgateOrderFlowService
} from "@/adapters/local-api";
import type { KlineInterval, MarketSecurity } from "@/shared/contracts";

const LoginPanel = defineAsyncComponent(() => import("@/components/login/LoginPanel.vue"));
const CandlePanel = defineAsyncComponent(() => import("@/components/candle/CandlePanel.vue"));
const InformationPreview = defineAsyncComponent(
  () => import("@/previews/InformationPreview.vue")
);
const MarketQuotesPanel = defineAsyncComponent(
  () => import("@/components/market-quotes/MarketQuotesPanel.vue")
);
const OrderFlowWatchPanel = defineAsyncComponent(
  () => import("@/components/order-flow/OrderFlowWatchPanel.vue")
);

const componentTitles = {
  login: "登录",
  candle: "个股行情",
  information: "资讯",
  "market-quotes": "多股行情",
  "order-flow": "L2 - 逐笔委托"
} as const;
type ComponentKey = keyof typeof componentTitles;

const selectedKey = ref<ComponentKey>(readComponentKey());
const previewInitialCandleInterval = readPreviewCandleInterval();
const visitedKeys = ref(new Set<ComponentKey>([selectedKey.value]));
const loginService = new FqgateLoginService();
const candleService = new FqgateCandleService();
const securityService = new FqgateSecuritySearchService();
const marketDepthService = new FqgateMarketDepthService();
const marketRealtimeService = new FqgateMarketRealtimeService();
const informationService = new FqgateInformationService();
const marketQuoteService = new FqgateMarketQuoteService();
const orderFlowService = new FqgateOrderFlowService();
const previewSecurity = {
  market: "USHA",
  code: "600151",
  fullCode: "USHA600151",
  name: "航天机电"
};
const componentTitle = computed(() => componentTitles[selectedKey.value] ?? "");

// 这里只声明预览要查询的真实证券，价格和走势全部来自本机 FQGate。
const previewSecurities: MarketSecurity[] = [
  { market: "USHA", code: "600151", name: "航天机电" },
  { market: "USHA", code: "600519", name: "贵州茅台" },
  { market: "USHA", code: "600036", name: "招商银行" },
  { market: "USHA", code: "601318", name: "中国平安" },
  { market: "USZA", code: "000001", name: "平安银行" },
  { market: "USZA", code: "300750", name: "宁德时代" },
  { market: "USZA", code: "000858", name: "五粮液" }
];

function selectComponent(key: string): void {
  if (!isComponentKey(key)) return;
  selectedKey.value = key;
  if (!visitedKeys.value.has(key)) visitedKeys.value = new Set([...visitedKeys.value, key]);
  if (window.location.hash !== `#${key}`) window.location.hash = key;
}

function readComponentKey(): ComponentKey {
  const hashKey = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
  const queryKey = new URLSearchParams(window.location.search).get("component")?.trim() ?? "";
  const candidate = hashKey || queryKey;
  return isComponentKey(candidate) ? candidate : "market-quotes";
}

function isComponentKey(value: string): value is ComponentKey {
  return Object.prototype.hasOwnProperty.call(componentTitles, value);
}

function syncComponentFromHash(): void {
  const key = readComponentKey();
  if (key === selectedKey.value) return;
  selectedKey.value = key;
  if (!visitedKeys.value.has(key)) visitedKeys.value = new Set([...visitedKeys.value, key]);
}

function readPreviewCandleInterval(): KlineInterval | undefined {
  const value = new URLSearchParams(window.location.search).get("interval");
  const intervals: KlineInterval[] = [
    "intraday", "five_day", "1m", "5m", "15m", "30m", "60m", "day", "week", "month"
  ];
  return intervals.includes(value as KlineInterval) ? value as KlineInterval : undefined;
}

onMounted(() => window.addEventListener("hashchange", syncComponentFromHash));
onBeforeUnmount(() => window.removeEventListener("hashchange", syncComponentFromHash));
</script>

<template>
  <a-config-provider size="small">
    <a-layout class="preview-layout">
      <a-layout-sider class="preview-sidebar" :width="200">
        <a-typography-title :heading="6">组件</a-typography-title>
        <a-menu :selected-keys="[selectedKey]" @menu-item-click="selectComponent">
          <a-menu-item key="login">登录</a-menu-item>
          <a-menu-item key="candle">个股行情</a-menu-item>
          <a-menu-item key="information">资讯</a-menu-item>
          <a-menu-item key="market-quotes">多股行情</a-menu-item>
          <a-menu-item key="order-flow">L2 - 逐笔委托</a-menu-item>
        </a-menu>
      </a-layout-sider>

      <a-layout-content class="preview-content">
        <a-page-header :title="componentTitle" subtitle="组件预览" :show-back="false" />
        <div class="preview-canvas">
          <LoginPanel v-if="selectedKey === 'login'" :service="loginService" />
          <div
            v-if="visitedKeys.has('candle')"
            v-show="selectedKey === 'candle'"
            class="component-preview-host"
          >
            <CandlePanel
              :active="selectedKey === 'candle'"
              :service="candleService"
              :security-service="securityService"
              :market-depth-service="marketDepthService"
              :realtime-service="marketRealtimeService"
              :security="previewSecurity"
              :initial-interval="previewInitialCandleInterval"
            />
          </div>
          <InformationPreview
            v-if="selectedKey === 'information'"
            :service="informationService"
            :security="previewSecurity"
          />
          <div
            v-if="visitedKeys.has('market-quotes')"
            v-show="selectedKey === 'market-quotes'"
            class="component-preview-host"
          >
            <MarketQuotesPanel
              :active="selectedKey === 'market-quotes'"
              :service="marketQuoteService"
              :securities="previewSecurities"
            />
          </div>
          <div
            v-if="visitedKeys.has('order-flow')"
            v-show="selectedKey === 'order-flow'"
            class="component-preview-host"
          >
            <OrderFlowWatchPanel
              :active="selectedKey === 'order-flow'"
              :initial-security="previewSecurity"
              :login-service="loginService"
              :service="orderFlowService"
            />
          </div>
        </div>
      </a-layout-content>
    </a-layout>
  </a-config-provider>
</template>

<style scoped>
.preview-layout {
  min-height: 100vh;
}

.preview-sidebar {
  padding: 16px 0;
  border-right: 1px solid var(--color-border-2);
}

.preview-sidebar :deep(.arco-typography) {
  margin: 0 16px 12px;
}

.preview-content {
  min-width: 0;
  padding: 8px 24px 24px;
}

.preview-canvas {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 360px;
  padding: 0;
  border: 10px solid var(--color-border-2);
}

.component-preview-host {
  width: 100%;
  min-width: 0;
}

@media (max-width: 720px) {
  .preview-layout {
    display: block;
  }

  .preview-sidebar {
    box-sizing: border-box;
    width: 100% !important;
    padding-bottom: 8px;
    border-right: 0;
    border-bottom: 1px solid var(--color-border-2);
  }

  .preview-content {
    padding: 8px 16px 16px;
  }

  .preview-canvas {
    min-height: 0;
    padding: 0;
  }
}
</style>
