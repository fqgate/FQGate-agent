<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { FqgateApiError } from "@/adapters/local-api/FqgateHttpClient";

import { tradingService } from "~/services";
import type { AssetsResponse, Position, PositionsResponse, TradingAccount } from "~/types";
import AccountCard from "./AccountCard.vue";
import AccountRecordsPanel from "./AccountRecordsPanel.vue";
import CancelOrdersPanel from "./CancelOrdersPanel.vue";
import OperationPanel from "./OperationPanel.vue";
import RecordsTable from "./RecordsTable.vue";
import type {
  AccountActionKey,
  AccountAssetItem,
  AccountTabKey,
  RecordColumn,
  TradingRecord,
  UserFacingError
} from "./types";

const props = defineProps<{
  account: TradingAccount;
  sessionId: string;
  brokerName: string;
}>();

const activeTab = ref<AccountTabKey>(props.account.tradingMode === "credit" ? "positions" : "trade");
const tradeAction = ref<"买入" | "卖出" | "撤单">("买入");
const assets = ref<AssetsResponse | null>(null);
const assetsLoading = ref(false);
const assetError = ref<UserFacingError | null>(null);
const positions = ref<PositionsResponse | null>(null);
const positionsLoading = ref(false);
const positionError = ref<UserFacingError | null>(null);
const extraAction = ref<AccountActionKey | null>(null);
const extraTab = ref("query");
const reviewPanel = ref<{ title: string; path: string } | null>(null);
let assetsController: AbortController | undefined;
let positionsController: AbortController | undefined;

const recordRoutes: Partial<Record<AccountTabKey, { title: string; path: string }>> = {
  orders: { title: "委托记录", path: "/v1/trading/orders" },
  trades: { title: "成交记录", path: "/v1/trading/trades" },
  "fund-flows": { title: "资金流水", path: "/v1/trading/funds/flows" },
  settlements: { title: "交割单", path: "/v1/trading/settlements" }
};
const orderRoutes = {
  买入: "/v1/trading/accounts/{accountId}/orders",
  卖出: "/v1/trading/accounts/{accountId}/orders"
} as const;
const extraRoutes: Record<AccountActionKey, {
  title: string;
  query: string;
  submit: string;
  history?: string;
  quota?: string;
}> = {
  ipo: {
    title: "新股申购",
    query: "/v1/trading/ipo/securities",
    quota: "/v1/trading/ipo/quotas",
    submit: "/v1/trading/ipo/subscriptions"
  },
  "bank-transfer": {
    title: "银证转账",
    query: "/v1/trading/bank-accounts",
    history: "/v1/trading/bank-transfers",
    submit: "/v1/trading/bank-transfers"
  },
  "collateral-transfer": {
    title: "担保品划转",
    query: "/v1/trading/credit/collateral-securities",
    history: "/v1/trading/credit/collateral-transfer-flows",
    submit: "/v1/trading/credit/collateral-transfers"
  }
};

const assetItems = computed<AccountAssetItem[]>(() => {
  const data = assets.value;
  const items: AccountAssetItem[] = [
    { key: "totalAssets", label: "总资产", value: data?.totalAssets, prominent: true },
    { key: "securitiesMarketValue", label: "证券市值", value: data?.securitiesMarketValue },
    { key: "cashBalance", label: "资金余额", value: data?.cashBalance },
    { key: "availableCash", label: "可用资金", value: data?.availableCash },
    { key: "withdrawableCash", label: "可取资金", value: data?.withdrawableCash },
    { key: "frozenCash", label: "冻结资金", value: data?.frozenCash }
  ];
  if (props.account.tradingMode === "credit") {
    items.push(
      { key: "netAssets", label: "净资产", value: data?.netAssets },
      { key: "totalLiabilities", label: "总负债", value: data?.totalLiabilities },
      { key: "availableMargin", label: "可用保证金", value: data?.availableMargin },
      { key: "maintenanceRatio", label: "维持担保比例", value: data?.maintenanceRatio, suffix: "%" }
    );
  }
  return items;
});
const currencyName = computed(() => assets.value?.currency === "USD"
  ? "美元"
  : assets.value?.currency === "HKD" ? "港元" : "元");
const positionColumns = computed<RecordColumn[]>(() => {
  if (positions.value?.columns.length) {
    return positions.value.columns.map((column) => ({ key: column.key, title: column.label }));
  }
  return [
    { key: "securityCode", title: "证券代码", width: 100 },
    { key: "securityName", title: "证券名称", width: 120 },
    { key: "market", title: "市场", width: 80 },
    { key: "quantity", title: "持仓数量", align: "right" },
    { key: "availableQuantity", title: "可用数量", align: "right" },
    { key: "costPrice", title: "成本价", align: "right" },
    { key: "currentPrice", title: "现价", align: "right" },
    { key: "marketValue", title: "持仓市值", align: "right" },
    { key: "profitLoss", title: "浮动盈亏", align: "right", tone: numberTone },
    { key: "profitLossRatio", title: "盈亏比例", align: "right", tone: numberTone }
  ];
});
const positionRecords = computed<TradingRecord[]>(() => (positions.value?.items ?? []).map(
  (position: Position, index) => ({ ...position, __rowKey: `${position.market}-${position.securityCode}-${index}` })
));
const activeRecord = computed(() => recordRoutes[activeTab.value]);
const activeExtra = computed(() => extraAction.value ? extraRoutes[extraAction.value] : null);
const extraTabs = computed(() => {
  const route = activeExtra.value;
  if (!route) return [];
  return [
    { key: "query", title: "查询" },
    ...(route.quota ? [{ key: "quota", title: "额度" }] : []),
    ...(route.history ? [{ key: "history", title: "记录" }] : []),
    { key: "submit", title: "提交" }
  ];
});

onMounted(() => {
  void loadAssets();
  if (activeTab.value === "positions") void loadPositions();
});
onBeforeUnmount(() => {
  assetsController?.abort();
  positionsController?.abort();
});

async function loadAssets(): Promise<void> {
  assetsController?.abort();
  const controller = new AbortController();
  assetsController = controller;
  assetsLoading.value = true;
  assetError.value = null;
  try {
    const response = await tradingService.getAssets(accountContext(), controller.signal);
    verifyAccount(response);
    assets.value = response;
  } catch (reason) {
    if (!controller.signal.aborted) {
      assets.value = null;
      assetError.value = toUserError(reason, "资产信息查询未完成，请稍后重试。");
    }
  } finally {
    if (assetsController === controller) assetsLoading.value = false;
  }
}

async function loadPositions(): Promise<void> {
  positionsController?.abort();
  const controller = new AbortController();
  positionsController = controller;
  positionsLoading.value = true;
  positionError.value = null;
  try {
    const response = await tradingService.getPositions(accountContext(), controller.signal);
    verifyAccount(response);
    positions.value = response;
  } catch (reason) {
    if (!controller.signal.aborted) {
      positions.value = null;
      positionError.value = toUserError(reason, "持仓查询未完成，请稍后重试。");
    }
  } finally {
    if (positionsController === controller) positionsLoading.value = false;
  }
}

function changeTab(tab: AccountTabKey): void {
  activeTab.value = tab;
  if (tab === "positions" && !positions.value) void loadPositions();
}

function openExtra(action: AccountActionKey): void {
  extraAction.value = action;
  extraTab.value = "query";
}

function extraPanelPath(): string {
  const route = activeExtra.value;
  if (!route) return "";
  if (extraTab.value === "history") return route.history ?? route.query;
  if (extraTab.value === "quota") return route.quota ?? route.query;
  return route.query;
}

function openReview(title: string, path: string): void {
  reviewPanel.value = { title, path };
}

function openExtraReview(): void {
  const route = activeExtra.value;
  if (!route) return;
  openReview(
    route.history ? `${route.title}记录` : "委托记录",
    route.history ?? "/v1/trading/orders"
  );
}

function accountContext() {
  return {
    sessionId: props.sessionId,
    accountId: props.account.accountId,
    tradingMode: props.account.tradingMode
  };
}

function verifyAccount(response: { accountId: string; tradingMode: string }): void {
  if (
    response.accountId !== props.account.accountId
    || response.tradingMode !== props.account.tradingMode
  ) throw new Error("返回数据与当前账户不一致，请重新查询。");
}

function toUserError(reason: unknown, fallback: string): UserFacingError {
  if (reason instanceof FqgateApiError) {
    return { message: reason.message || fallback, code: String(reason.code) };
  }
  return { message: reason instanceof Error && reason.message.trim() ? reason.message : fallback };
}

function numberTone(value: unknown) {
  return typeof value === "number" && value < 0 ? "loss" : "gain";
}
</script>

<template>
  <AccountCard
    :account="{ ...account, brokerName, connected: true }"
    :assets="assetItems"
    :currency-name="currencyName"
    :active-tab="activeTab"
    :loading-assets="assetsLoading"
    :asset-error="assetError"
    @update:active-tab="changeTab"
    @refresh-assets="loadAssets"
    @action="openExtra"
  >
    <template #panel>
      <a-tabs v-if="activeTab === 'trade'" v-model:active-key="tradeAction" size="small">
        <a-tab-pane v-for="name in ['买入', '卖出', '撤单']" :key="name" :title="name">
          <CancelOrdersPanel
            v-if="tradeAction === name && name === '撤单'"
            :session-id="sessionId"
            :account="account"
          />
          <OperationPanel
            v-else-if="tradeAction === name"
            :key="name"
            :path="orderRoutes[name as keyof typeof orderRoutes]"
            :title="name"
            :session-id="sessionId"
            :account="account"
            @review-records="openReview('委托记录', '/v1/trading/orders')"
          />
        </a-tab-pane>
      </a-tabs>

      <RecordsTable
        v-else-if="activeTab === 'positions'"
        title="持仓"
        :columns="positionColumns"
        :records="positionRecords"
        row-key="__rowKey"
        :loading="positionsLoading"
        :error="positionError"
        @refresh="loadPositions"
      />

      <AccountRecordsPanel
        v-else-if="activeRecord"
        :key="activeTab"
        :title="activeRecord.title"
        :path="activeRecord.path"
        :session-id="sessionId"
        :account="account"
      />
    </template>
  </AccountCard>

  <a-modal
    :visible="Boolean(extraAction)"
    :title="activeExtra?.title"
    :width="760"
    :footer="false"
    unmount-on-close
    @cancel="extraAction = null"
  >
    <a-tabs v-if="activeExtra" v-model:active-key="extraTab" size="small">
      <a-tab-pane v-for="tab in extraTabs" :key="tab.key" :title="tab.title">
        <OperationPanel
          v-if="tab.key === 'submit' && extraTab === tab.key"
          :path="activeExtra.submit"
          :title="activeExtra.title"
          :session-id="sessionId"
          :account="account"
          @review-records="openExtraReview"
        />
        <AccountRecordsPanel
          v-else-if="extraTab === tab.key"
          :key="`${extraAction}-${tab.key}`"
          :title="`${activeExtra.title}${tab.title === '查询' ? '' : tab.title}`"
          :path="extraPanelPath()"
          :session-id="sessionId"
          :account="account"
        />
      </a-tab-pane>
    </a-tabs>
  </a-modal>

  <a-modal
    :visible="Boolean(reviewPanel)"
    :title="reviewPanel?.title"
    :width="880"
    :footer="false"
    unmount-on-close
    @cancel="reviewPanel = null"
  >
    <AccountRecordsPanel
      v-if="reviewPanel"
      :key="reviewPanel.path"
      :title="reviewPanel.title"
      :path="reviewPanel.path"
      :session-id="sessionId"
      :account="account"
    />
  </a-modal>
</template>
