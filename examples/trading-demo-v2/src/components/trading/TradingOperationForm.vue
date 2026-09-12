<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  OperationField,
  OperationFieldValue,
  OperationFormValue,
  OperationStatus,
  UserFacingError,
} from './types'

interface FormInstance {
  validate: () => Promise<unknown>
}

const props = withDefaults(defineProps<{
  title: string
  modelValue: OperationFormValue
  fields: OperationField[]
  status?: OperationStatus
  requestId?: string
  recordsName?: string
  error?: UserFacingError | null
  unavailable?: boolean
  submitDisabled?: boolean
  statusMessage?: string
}>(), {
  status: 'draft',
  requestId: '',
  recordsName: '委托记录',
  error: null,
  unavailable: false,
  submitDisabled: false,
  statusMessage: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: OperationFormValue]
  submit: [value: OperationFormValue]
  'review-records': []
  'start-new': []
}>()

const formRef = ref<FormInstance>()
const editable = computed(() => props.status === 'draft' && !props.unavailable)
const submitting = computed(() => props.status === 'submitting')
const canSubmit = computed(() => (
  props.status === 'draft' || props.status === 'not-sent'
) && !props.unavailable && !props.submitDisabled)

const defaultStatusMessage = computed(() => ({
  draft: `请核对账户和${props.title}信息后提交。`,
  submitting: '正在提交本笔操作，请勿重复点击。',
  'not-sent': '本笔请求尚未发送。确认信息无误后，可以重试本笔操作。',
  rejected: '本笔请求未被受理，请核对原因后开始新操作。',
  accepted: `本笔操作已受理，最终结果请以${props.recordsName}为准。`,
  unknown: `本笔操作结果尚未确认，请先查询${props.recordsName}，不要重复提交。`,
}[props.status]))

const submitLabel = computed(() => {
  if (submitting.value) return '正在提交'
  if (props.status === 'not-sent') return '重试本笔操作'
  if (props.status !== 'draft') return `请先核对${props.recordsName}`
  return props.title
})

function updateField(key: string, value: OperationFieldValue) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function updateSelectField(key: string, value: unknown) {
  if (isOperationFieldValue(value)) updateField(key, value)
}

function isOperationFieldValue(value: unknown): value is OperationFieldValue {
  return value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

function fieldRules(field: OperationField) {
  return field.required ? [{ required: true, message: `请填写${field.label}` }] : []
}

async function submit() {
  if (!canSubmit.value) return
  const errors = await formRef.value?.validate()
  if (errors) return
  emit('submit', { ...props.modelValue })
}
</script>

<template>
  <section class="operation-form" :aria-label="`${title}表单`">
    <a-alert
      :type="status === 'unknown' || status === 'rejected' ? 'warning' : status === 'accepted' ? 'success' : 'info'"
      :show-icon="true"
    >
      {{ statusMessage || defaultStatusMessage }}
    </a-alert>

    <p v-if="requestId" class="operation-reference">
      本笔操作编号：<span>{{ requestId }}</span>
    </p>

    <a-form ref="formRef" :model="modelValue" layout="vertical" size="small" class="field-grid">
      <a-form-item
        v-for="field in fields"
        :key="field.key"
        :field="field.key"
        :label="field.label"
        :required="field.required"
        :rules="fieldRules(field)"
        :extra="field.description"
      >
        <a-select
          v-if="field.type === 'select'"
          :model-value="modelValue[field.key] as string | number | undefined"
          :disabled="!editable || field.disabled"
          :placeholder="field.placeholder || `请选择${field.label}`"
          allow-search
          @update:model-value="updateSelectField(field.key, $event)"
        >
          <a-option
            v-for="option in field.options ?? []"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ option.label }}
          </a-option>
        </a-select>

        <a-input-number
          v-else-if="field.type === 'number'"
          :model-value="modelValue[field.key] as number | undefined"
          :disabled="!editable || field.disabled"
          :placeholder="field.placeholder || `请输入${field.label}`"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :precision="field.precision"
          hide-button
          @update:model-value="updateField(field.key, $event)"
        />

        <a-input-password
          v-else-if="field.type === 'password'"
          :model-value="modelValue[field.key] as string | undefined"
          :disabled="!editable || field.disabled"
          :placeholder="field.placeholder || `请输入${field.label}`"
          @update:model-value="updateField(field.key, $event)"
        />

        <a-textarea
          v-else-if="field.type === 'textarea'"
          :model-value="modelValue[field.key] as string | undefined"
          :disabled="!editable || field.disabled"
          :placeholder="field.placeholder || `请输入${field.label}`"
          :auto-size="{ minRows: 2, maxRows: 4 }"
          @update:model-value="updateField(field.key, $event)"
        />

        <a-input
          v-else
          :model-value="modelValue[field.key] as string | undefined"
          :disabled="!editable || field.disabled"
          :placeholder="field.placeholder || `请输入${field.label}`"
          @update:model-value="updateField(field.key, $event)"
        />
      </a-form-item>
    </a-form>

    <a-alert v-if="error" type="error" :show-icon="true" class="operation-error">
      {{ error.message }}<template v-if="error.code">（{{ error.code }}）</template>
    </a-alert>

    <a-button
      type="primary"
      size="small"
      :loading="submitting"
      :disabled="!canSubmit"
      @click="submit"
    >
      {{ unavailable ? `暂时无法办理${title}` : submitLabel }}
    </a-button>

    <div v-if="status !== 'draft' && !submitting" class="result-actions">
      <a-button size="small" @click="emit('review-records')">查看{{ recordsName }}</a-button>
      <a-button size="small" type="outline" @click="emit('start-new')">开始新操作</a-button>
    </div>
  </section>
</template>

<style scoped>
.operation-form {
  display: grid;
  gap: 16px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0 16px;
}

.operation-reference {
  margin: 0;
  color: var(--color-text-3);
  font-size: 12px;
}

.operation-reference span {
  color: var(--color-text-2);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}

.operation-error {
  max-width: 720px;
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
