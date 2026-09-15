<script setup lang="ts">
import { computed } from 'vue'
import type {
  DateRangeValue,
  RecordCellTone,
  RecordColumn,
  TradingRecord,
  UserFacingError,
} from './types'
import {
  dateRangePresets,
  presetDateRange,
  selectedDateRangePreset,
  type DateRangePreset,
} from './dateRanges'

const props = withDefaults(defineProps<{
  title: string
  columns: RecordColumn[]
  records: TradingRecord[]
  rowKey?: string
  loading?: boolean
  error?: UserFacingError | null
  emptyText?: string
  dateRange?: DateRangeValue | null
  showDateFilter?: boolean
  tableHeight?: number
  actionColumn?: {
    title: string
    width?: number
  }
}>(), {
  rowKey: 'id',
  loading: false,
  error: null,
  emptyText: '暂无记录',
  dateRange: null,
  showDateFilter: false,
  tableHeight: 420,
})

const emit = defineEmits<{
  'update:dateRange': [value: DateRangeValue]
  query: [dateRange: DateRangeValue | null]
  refresh: []
  'row-click': [record: TradingRecord]
}>()

const tableColumns = computed(() => [
  ...props.columns.map(column => ({
    title: column.title,
    dataIndex: column.key,
    width: column.width ?? defaultColumnWidth(column.title),
    align: column.align,
    fixed: column.fixed,
    ellipsis: true,
    tooltip: true,
    slotName: 'recordCell',
  })),
  ...(props.actionColumn ? [{
    title: props.actionColumn.title,
    dataIndex: '__recordActions',
    width: props.actionColumn.width ?? 88,
    align: 'center' as const,
    fixed: 'right' as const,
    ellipsis: false,
    tooltip: false,
    slotName: 'recordActions',
  }] : []),
])

const tableScroll = computed(() => ({
  x: tableColumns.value.reduce((width, column) => width + column.width, 0),
  y: props.tableHeight,
}))
const tableStyle = computed(() => ({
  '--records-table-height': `${props.tableHeight}px`,
}))

const pickerValue = computed<[string, string] | undefined>(() => props.dateRange
  ? [props.dateRange.startDate, props.dateRange.endDate]
  : undefined)

const canQuery = computed(() => !props.showDateFilter || Boolean(
  props.dateRange?.startDate
  && props.dateRange.endDate
  && props.dateRange.startDate <= props.dateRange.endDate,
))
const activeDateRangePreset = computed(() => selectedDateRangePreset(props.dateRange))

function updateDateRange(value?: Array<unknown>) {
  if (!value || value.length !== 2) {
    emit('update:dateRange', { startDate: '', endDate: '' })
    return
  }
  emit('update:dateRange', {
    startDate: String(value[0]),
    endDate: String(value[1]),
  })
}

function chooseDateRangePreset(value: string | number | boolean) {
  const preset = String(value) as DateRangePreset
  if (!dateRangePresets.some(item => item.key === preset)) return
  const range = presetDateRange(preset)
  emit('update:dateRange', range)
  emit('query', range)
}

function rawValue(record: TradingRecord, key: string) {
  if (record[key] !== undefined && record[key] !== null) return record[key]
  const rawFields = record.rawFields
  return rawFields && typeof rawFields === 'object'
    ? (rawFields as Record<string, unknown>)[key]
    : undefined
}

function columnFor(key: string) {
  return props.columns.find(column => column.key === key)
}

function displayCell(record: TradingRecord, key: string) {
  const value = rawValue(record, key)
  const formatted = columnFor(key)?.formatter?.(value, record)
  if (formatted !== undefined) return formatted
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function cellTone(record: TradingRecord, key: string): RecordCellTone {
  const value = rawValue(record, key)
  return columnFor(key)?.tone?.(value, record) ?? 'normal'
}

function query() {
  if (canQuery.value) emit('query', props.dateRange)
}

/** 未声明列宽时按标题估算，避免多列表格把中文标题压缩成单个字。 */
function defaultColumnWidth(title: string): number {
  const textWidth = Array.from(title).reduce(
    (width, character) => width + (/^[\x00-\x7F]$/.test(character) ? 8 : 14),
    0,
  )
  return Math.max(96, Math.min(textWidth + 40, 220))
}
</script>

<template>
  <section class="records-panel" :aria-label="title">
    <header class="records-toolbar">
      <div>
        <strong>{{ title }}</strong>
        <span>共 {{ records.length }} 条</span>
      </div>
      <a-space size="small" wrap>
        <a-radio-group
          v-if="showDateFilter"
          class="date-shortcuts"
          type="button"
          size="small"
          :model-value="activeDateRangePreset"
          :disabled="loading"
          @change="chooseDateRangePreset"
        >
          <a-radio v-for="preset in dateRangePresets" :key="preset.key" :value="preset.key">
            {{ preset.label }}
          </a-radio>
        </a-radio-group>
        <a-range-picker
          v-if="showDateFilter"
          :model-value="pickerValue"
          size="small"
          value-format="YYYY-MM-DD"
          :disabled="loading"
          allow-clear
          @update:model-value="updateDateRange"
        />
        <a-button
          v-if="showDateFilter"
          size="small"
          type="primary"
          :loading="loading"
          :disabled="!canQuery"
          @click="query"
        >
          查询
        </a-button>
        <a-button v-else size="small" :loading="loading" @click="emit('refresh')">刷新</a-button>
      </a-space>
    </header>

    <a-alert v-if="error" type="error" :show-icon="true" class="records-error">
      {{ error.message }}<template v-if="error.code">（{{ error.code }}）</template>
    </a-alert>

    <a-table
      class="records-table"
      :style="tableStyle"
      :columns="tableColumns"
      :data="records"
      :row-key="rowKey"
      :loading="loading"
      :pagination="false"
      :scroll="tableScroll"
      size="small"
      stripe
      @row-click="emit('row-click', $event)"
    >
      <template #recordCell="{ record, column }">
        <span :class="['record-cell', `tone-${cellTone(record, String(column.dataIndex))}`]">
          {{ displayCell(record, String(column.dataIndex)) }}
        </span>
      </template>
      <template #recordActions="{ record }">
        <slot name="actions" :record="record" />
      </template>
      <template #empty>
        <a-empty :description="loading ? '正在查询' : error ? '暂未取得数据' : emptyText" />
      </template>
    </a-table>
  </section>
</template>

<style scoped>
.records-panel {
  display: grid;
  gap: 12px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.records-panel :deep(.arco-table),
.records-panel :deep(.arco-table-container) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.records-table :deep(.arco-table-body) {
  height: var(--records-table-height);
  min-height: var(--records-table-height);
  max-height: var(--records-table-height) !important;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.records-table :deep(.arco-table-empty) {
  height: 100%;
}

.records-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.records-toolbar > div {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.records-toolbar strong {
  color: var(--color-text-1);
  font-size: 14px;
}

.records-toolbar span {
  color: var(--color-text-3);
  font-size: 12px;
}

.date-shortcuts {
  flex-wrap: wrap;
}

.records-error {
  max-width: 720px;
}

.record-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.records-panel :deep(.arco-table-th-title) {
  white-space: nowrap;
}

.tone-gain {
  color: rgb(var(--red-6));
}

.tone-loss {
  color: rgb(var(--green-6));
}

@media (max-width: 640px) {
  .records-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
