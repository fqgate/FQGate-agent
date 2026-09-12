<script setup lang="ts">
import { computed } from 'vue'
import type {
  AccountActionKey,
  AccountAssetItem,
  AccountTabItem,
  AccountTabKey,
  TradingAccountView,
  UserFacingError,
} from './types'

const props = withDefaults(defineProps<{
  account: TradingAccountView
  assets?: AccountAssetItem[]
  currencyName?: string
  activeTab?: AccountTabKey
  tabs?: AccountTabItem[]
  loadingAssets?: boolean
  assetError?: UserFacingError | null
}>(), {
  assets: () => [],
  currencyName: '元',
  activeTab: 'trade',
  tabs: () => [
    { key: 'trade', label: '交易' },
    { key: 'positions', label: '持仓' },
    { key: 'orders', label: '委托记录' },
    { key: 'trades', label: '成交记录' },
    { key: 'fund-flows', label: '资金流水' },
    { key: 'settlements', label: '交割单' },
  ],
  loadingAssets: false,
  assetError: null,
})

const emit = defineEmits<{
  'update:activeTab': [value: AccountTabKey]
  'refresh-assets': []
  action: [action: AccountActionKey]
}>()

const modeName = computed(() => props.account.tradingMode === 'credit' ? '信用账户' : '普通账户')
const connected = computed(() => props.account.connected !== false)

function formatAsset(item: AccountAssetItem) {
  if (item.value === null || item.value === undefined || item.value === '') return '—'
  const formatted = typeof item.value === 'number'
    ? item.value.toLocaleString('zh-CN', {
        minimumFractionDigits: item.precision ?? 2,
        maximumFractionDigits: item.precision ?? 2,
      })
    : item.value
  return `${formatted}${item.suffix ?? ''}`
}

function selectTab(value: string | number) {
  emit('update:activeTab', String(value) as AccountTabKey)
}
</script>

<template>
  <a-card class="account-card" :bordered="true">
    <template #title>
      <div class="account-title">
        <span>账户 {{ account.fundAccount }}</span>
        <a-tag size="small" :color="account.tradingMode === 'credit' ? 'orangered' : 'arcoblue'">
          {{ modeName }}
        </a-tag>
        <a-tag v-if="account.brokerName" size="small">{{ account.brokerName }}</a-tag>
      </div>
    </template>

    <template #extra>
      <a-space size="small" wrap>
        <a-badge :status="connected ? 'success' : 'normal'" :text="connected ? '已登录' : '未连接'" />
        <a-button size="small" type="text" @click="emit('action', 'ipo')">新股申购</a-button>
        <a-button size="small" type="text" @click="emit('action', 'bank-transfer')">银证转账</a-button>
        <a-button
          v-if="account.tradingMode === 'credit'"
          size="small"
          type="text"
          @click="emit('action', 'collateral-transfer')"
        >
          担保品划转
        </a-button>
      </a-space>
    </template>

    <section class="asset-section" aria-label="账户资产" :aria-busy="loadingAssets">
      <a-spin :loading="loadingAssets" class="asset-loading">
        <div v-if="assets.length" class="asset-grid">
          <div v-for="item in assets" :key="item.key" class="asset-item">
            <span>{{ item.label }}</span>
            <strong :class="{ prominent: item.prominent }">{{ formatAsset(item) }}</strong>
          </div>
        </div>
        <a-empty v-else description="暂无资产数据" />
      </a-spin>

      <div class="asset-footer">
        <a-alert v-if="assetError" type="error" :show-icon="true">
          {{ assetError.message }}<template v-if="assetError.code">（{{ assetError.code }}）</template>
        </a-alert>
        <span v-else>金额单位：{{ currencyName }}</span>
        <a-button size="mini" type="text" :loading="loadingAssets" @click="emit('refresh-assets')">
          刷新资产
        </a-button>
      </div>
    </section>

    <a-tabs :active-key="activeTab" size="small" lazy-load @change="selectTab">
      <a-tab-pane v-for="tab in tabs" :key="tab.key" :title="tab.label">
        <slot v-if="tab.key === activeTab" name="panel" :active-tab="tab.key" />
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<style scoped>
.account-card {
  width: 100%;
}

.account-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.asset-section {
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background: var(--color-fill-1);
}

.asset-loading {
  display: block;
  min-height: 72px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 12px 20px;
}

.asset-item {
  display: grid;
  gap: 4px;
}

.asset-item span,
.asset-footer {
  color: var(--color-text-3);
  font-size: 12px;
}

.asset-item strong {
  color: var(--color-text-1);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.asset-item strong.prominent {
  font-size: 20px;
}

.asset-footer {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.asset-footer :deep(.arco-alert) {
  flex: 1;
}

@media (max-width: 720px) {
  .account-card :deep(.arco-card-header) {
    align-items: flex-start;
    flex-direction: column;
  }

  .account-card :deep(.arco-card-header-extra) {
    margin-left: 0;
  }
}
</style>
