<script setup lang="ts">
import { Modal } from '@arco-design/web-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { FqgateApiError } from '@/adapters/local-api/FqgateHttpClient'
import { tradingService } from '~/services'
import type { OpenApiContract } from '~/types'

import TradingOperationForm from './TradingOperationForm.vue'
import type {
  OperationField,
  OperationFieldValue,
  OperationFormValue,
  OperationStatus,
  TradingAccountView,
  UserFacingError,
} from './types'

const props = defineProps<{
  sessionId: string
  account: TradingAccountView
  path: string
  title: string
}>()

const emit = defineEmits<{
  'review-records': []
  accepted: [response: unknown]
}>()

const identityFields = new Set([
  'sessionId',
  'accountId',
  'tradingMode',
  'clientOrderId',
  'clientRequestId',
])

const fieldLabels: Record<string, string> = {
  securityCode: '证券代码',
  marketCode: '交易市场',
  shareholderAccount: '股东账户',
  businessType: '业务类型',
  orderType: '委托类型',
  price: '委托价格',
  quantity: '数量',
  orderId: '委托编号',
  contractNumber: '合同编号',
  bankId: '银行',
  currency: '币种',
  direction: '方向',
  amount: '金额',
}

const optionLabels: Record<string, string> = {
  limit: '限价',
  cash_buy: '普通买入',
  cash_sell: '普通卖出',
  collateral_buy: '担保品买入',
  collateral_sell: '担保品卖出',
  margin_buy: '融资买入',
  short_sell: '融券卖出',
  buy_to_repay: '买券还券',
  sell_to_repay: '卖券还款',
  bank_to_securities: '银行转证券',
  securities_to_bank: '证券转银行',
  ordinary_to_credit: '普通账户转信用账户',
  credit_to_ordinary: '信用账户转普通账户',
}

const notSentCodes = new Set([
  'SUBMISSION_NOT_SENT',
  'BROKER_SUBMISSION_NOT_SENT',
  'SESSION_BUSY',
  'SESSION_NOT_FOUND',
  'ACCOUNT_MISMATCH',
  'INVALID_REQUEST',
  'REQUEST_INVALID',
  'INVALID_REQUEST_ID',
  'TRADING_FIELDS_INVALID',
  'TRADING_BUSINESS_MISMATCH',
  'CREDIT_ACCOUNT_REQUIRED',
  'BUSINESS_NOT_AVAILABLE',
  'SESSION_SUBMISSION_LIMIT',
  'TRADING_SESSION_REQUIRED',
  'SECURITY_CODE_INVALID',
  'SECURITY_MARKET_REQUIRED',
  'MARKET_ACCOUNT_NOT_FOUND',
  'ORDER_CONTEXT_QUERY_FAILED',
])
const rejectedCodes = new Set(['SUBMISSION_REJECTED', 'BROKER_SUBMISSION_REJECTED'])

const contract = ref<OpenApiContract | null>()
const fields = ref<OperationField[]>([])
const values = ref<OperationFormValue>({})
const status = ref<OperationStatus>('draft')
const operationId = ref('')
const error = ref<UserFacingError | null>(null)
const response = ref<unknown>()
const confirming = ref(false)
const recordsReviewed = ref(false)
const submittedPayload = ref<Record<string, unknown> | null>(null)

let submitController: AbortController | undefined

const isUnifiedOrder = computed(
  () => props.path === '/v1/trading/accounts/{accountId}/orders',
)

const recordsName = computed(() => {
  if (props.path.includes('bank-transfers')) return '转账记录'
  if (props.path.includes('collateral-transfers')) return '划转记录'
  if (props.path.includes('ipo/subscriptions')) return '申购记录'
  return '委托记录'
})

const unavailable = computed(() => contract.value !== undefined && !contract.value?.available)

const statusMessage = computed(() => {
  if (status.value === 'not-sent') {
    return 'FQGate 正在恢复连接，本笔请求尚未发送。连接恢复后可沿用原编号重试。'
  }
  if (status.value === 'unknown') {
    return `本笔操作结果尚未确认。请先查询${recordsName.value}，不要直接重复提交。`
  }
  return ''
})

watch(
  () => [props.path, props.title, props.account.accountId, props.account.tradingMode] as const,
  async (_, __, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    resetOperation(false)
    contract.value = undefined
    fields.value = []
    error.value = null

    try {
      const nextContract = await tradingService.getOpenApiContract(
        props.path,
        'post',
        controller.signal,
      )
      if (controller.signal.aborted) return
      contract.value = nextContract
      if (!nextContract?.available) {
        error.value = { message: `暂时无法办理${props.title}。` }
        return
      }
      fields.value = buildFields(nextContract)
      values.value = initialValues(fields.value)
    } catch (reason) {
      if (controller.signal.aborted) return
      contract.value = null
      error.value = toUserError(reason, '交易信息暂时无法加载，请稍后重试。')
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  submitController?.abort()
  submittedPayload.value = null
})

function buildFields(selectedContract: OpenApiContract): OperationField[] {
  return Object.entries(selectedContract.properties)
    .filter(([key]) => !identityFields.has(key))
    .map(([key, originalSchema]) => {
      const schema = key === 'businessType'
        ? { ...originalSchema, enum: businessTypes(originalSchema.enum) }
        : originalSchema
      const options = (schema.enum ?? [])
        .filter(isOptionValue)
        .map(value => ({ label: optionLabels[String(value)] ?? String(value), value }))
      return {
        key,
        label: fieldLabels[key] ?? schema.title ?? key,
        type: options.length
          ? 'select'
          : schema.type === 'integer' || schema.type === 'number'
            ? 'number'
            : key.toLowerCase().includes('password')
              ? 'password'
              : 'text',
        required: selectedContract.required.includes(key),
        description: schema.description,
        options,
        min: schema.minimum,
        max: schema.maximum,
        precision: schema.type === 'integer' ? 0 : undefined,
      }
    })
}

/** 统一委托只向用户展示当前账户和操作方向允许的业务类型。 */
function businessTypes(documentedValues: unknown[] | undefined): unknown[] | undefined {
  if (!isUnifiedOrder.value) return documentedValues
  const allowed = props.account.tradingMode === 'ordinary'
    ? props.title.includes('买') ? ['cash_buy'] : ['cash_sell']
    : props.title.includes('买')
      ? ['collateral_buy', 'margin_buy', 'buy_to_repay']
      : ['collateral_sell', 'short_sell', 'sell_to_repay']
  if (!documentedValues?.length) return allowed
  const documented = new Set(documentedValues.map(String))
  return allowed.filter(value => documented.has(value))
}

function initialValues(operationFields: OperationField[]): OperationFormValue {
  const result: OperationFormValue = {}
  for (const field of operationFields) {
    const schema = contract.value?.properties[field.key]
    const businessValues = field.key === 'businessType'
      ? businessTypes(schema?.enum)
      : schema?.enum
    const initial = schema?.default ?? (businessValues?.length === 1 ? businessValues[0] : '')
    result[field.key] = isFieldValue(initial) ? initial : ''
  }
  return result
}

function updateValues(nextValues: OperationFormValue) {
  if (status.value !== 'draft') return
  values.value = nextValues
}

function requestSubmit(nextValues: OperationFormValue) {
  if (confirming.value || (status.value !== 'draft' && status.value !== 'not-sent')) return
  confirming.value = true
  const retrying = status.value === 'not-sent'
  Modal.confirm({
    title: retrying ? '确认重试本笔操作' : `确认${props.title}`,
    content: retrying
      ? `将沿用操作编号 ${operationId.value} 重试同一笔请求，请确认未修改操作内容。`
      : `将使用账户 ${props.account.fundAccount} 办理${props.title}，请确认账户及填写信息无误。`,
    okText: retrying ? '确认重试' : '确认提交',
    cancelText: '返回核对',
    maskClosable: false,
    onOk: () => {
      confirming.value = false
      void submit(retrying ? undefined : nextValues)
    },
    onCancel: () => {
      confirming.value = false
    },
  })
}

/** 首次提交固定请求内容和 UUID；明确未发送的重试始终复用这份快照。 */
async function submit(nextValues?: OperationFormValue) {
  const isRetry = status.value === 'not-sent'
  if (!isRetry && status.value !== 'draft') return

  if (!isRetry) {
    operationId.value = crypto.randomUUID()
    submittedPayload.value = buildPayload(nextValues ?? values.value, operationId.value)
  }
  if (!submittedPayload.value || !operationId.value) return

  error.value = null
  response.value = undefined
  recordsReviewed.value = false

  // 重连状态在统一客户端发起 fetch 前即可确认，因此这是唯一允许原编号重试的失败。
  if (tradingService.connection.getSnapshot().state === 'reconnecting') {
    status.value = 'not-sent'
    return
  }

  status.value = 'submitting'
  submitController = new AbortController()
  try {
    const result = await tradingService.submit(
      submitPath(),
      submittedPayload.value,
      submitHeaders(),
      submitController.signal,
    )
    response.value = result
    if (isConfirmedResponse(result)) {
      status.value = 'accepted'
      emit('accepted', result)
    } else {
      status.value = 'unknown'
      error.value = {
        message: `FQGate 已返回结果，但无法确认它属于本笔操作。请先查询${recordsName.value}。`,
      }
    }
  } catch (reason) {
    if (submitController.signal.aborted) return
    if (reason instanceof FqgateApiError && reason.httpStatus >= 400 && reason.httpStatus < 600) {
      const code = String(reason.code)
      if (notSentCodes.has(code)) {
        status.value = 'not-sent'
        error.value = toUserError(reason, '本笔请求尚未发送，可以沿用原编号重试。')
        return
      }
      if (rejectedCodes.has(code)) {
        status.value = 'rejected'
        error.value = toUserError(reason, '本笔操作未被受理，请核对信息后重新操作。')
        return
      }
    }
    status.value = 'unknown'
    error.value = {
      message: `未能确认本笔操作结果。请先查询${recordsName.value}，确认后再决定是否开始新操作。`,
      code: reason instanceof FqgateApiError ? String(reason.code) : undefined,
    }
  } finally {
    submitController = undefined
  }
}

function buildPayload(formValues: OperationFormValue, requestId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = isUnifiedOrder.value
    ? {}
    : {
        sessionId: props.sessionId,
        accountId: props.account.accountId,
        tradingMode: props.account.tradingMode,
      }
  for (const field of fields.value) {
    const value = formValues[field.key]
    if (value !== '' && value !== null && value !== undefined) payload[field.key] = value
  }
  for (const key of ['clientOrderId', 'clientRequestId']) {
    if (contract.value?.properties[key]) payload[key] = requestId
  }
  return payload
}

function submitPath() {
  return isUnifiedOrder.value
    ? props.path.replace('{accountId}', encodeURIComponent(props.account.accountId))
    : props.path
}

function submitHeaders(): HeadersInit | undefined {
  return isUnifiedOrder.value
    ? {
        Authorization: `Bearer ${props.sessionId}`,
        'Idempotency-Key': operationId.value,
      }
    : undefined
}

function reviewRecords() {
  recordsReviewed.value = true
  emit('review-records')
}

function requestStartNew() {
  if ((status.value === 'unknown' || status.value === 'accepted') && !recordsReviewed.value) {
    Modal.warning({
      title: `请先查询${recordsName.value}`,
      content: '当前结果尚未确认。查询并核对本笔操作后，才能开始新操作。',
      okText: '知道了',
    })
    return
  }
  Modal.confirm({
    title: '确认开始新操作',
    content: `请确认已经核对${recordsName.value}。新操作将使用新的操作编号，不会撤销或重复发送上一笔请求。`,
    okText: '开始新操作',
    cancelText: '返回',
    onOk: () => resetOperation(true),
  })
}

/** 仅把账户、模式和操作编号均匹配的响应解释为本笔操作已受理。 */
function isConfirmedResponse(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  const body = result as Record<string, unknown>
  const responseId = body.clientRequestId ?? body.clientOrderId
  return body.sessionId === props.sessionId
    && body.accountId === props.account.accountId
    && body.tradingMode === props.account.tradingMode
    && responseId === operationId.value
    && (body.status === undefined || body.status === 'accepted' || body.status === 'submitted')
}

function resetOperation(reinitialize: boolean) {
  submitController?.abort()
  submitController = undefined
  status.value = 'draft'
  operationId.value = ''
  error.value = null
  response.value = undefined
  recordsReviewed.value = false
  submittedPayload.value = null
  if (reinitialize) values.value = initialValues(fields.value)
}

function isOptionValue(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

function isFieldValue(value: unknown): value is OperationFieldValue {
  return value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

function toUserError(reason: unknown, fallback: string): UserFacingError {
  if (reason instanceof FqgateApiError) {
    return { message: reason.message.trim() || fallback, code: String(reason.code) }
  }
  return { message: fallback }
}
</script>

<template>
  <div class="operation-panel">
    <TradingOperationForm
      :title="title"
      :model-value="values"
      :fields="fields"
      :status="status"
      :request-id="operationId"
      :records-name="recordsName"
      :error="error"
      :unavailable="unavailable"
      :submit-disabled="contract === undefined || confirming"
      :status-message="statusMessage"
      @update:model-value="updateValues"
      @submit="requestSubmit"
      @review-records="reviewRecords"
      @start-new="requestStartNew"
    />

    <a-collapse v-if="response !== undefined" :default-active-key="[]" size="small">
      <a-collapse-item key="response" header="查看受理结果">
        <pre class="operation-response">{{ JSON.stringify(response, null, 2) }}</pre>
      </a-collapse-item>
    </a-collapse>
  </div>
</template>

<style scoped>
.operation-panel {
  display: grid;
  gap: 16px;
}

.operation-response {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: var(--border-radius-small);
  color: var(--color-text-2);
  background: var(--color-fill-1);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre;
}
</style>
