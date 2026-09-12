<script setup lang="ts">
import { computed } from 'vue'
import type {
  AccessPointOption,
  BrokerOption,
  LoginAccountTypeOption,
  LoginFormError,
  LoginFormValue,
} from './types'

const props = withDefaults(defineProps<{
  modelValue: LoginFormValue
  accountTypes: LoginAccountTypeOption[]
  brokers: BrokerOption[]
  accessPoints: AccessPointOption[]
  loadingAccountTypes?: boolean
  loadingBrokers?: boolean
  loadingAccessPoints?: boolean
  submitting?: boolean
  error?: LoginFormError | null
}>(), {
  loadingAccountTypes: false,
  loadingBrokers: false,
  loadingAccessPoints: false,
  submitting: false,
  error: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: LoginFormValue]
  'broker-change': [brokerId: string]
  submit: [value: LoginFormValue]
}>()

const selectedAccessPoint = computed(() => props.accessPoints.find(
  point => point.accessPointId === props.modelValue.accessPointId,
))
const selectedAccountType = computed(() => props.accountTypes.find(
  option => option.accountType === props.modelValue.accountType,
))

const canSubmit = computed(() => Boolean(
  props.modelValue.accountType
  && props.modelValue.brokerId
  && props.modelValue.accessPointId
  && props.modelValue.loginAccount.trim()
  && props.modelValue.password
  && !props.loadingAccountTypes
  && !props.submitting,
))

function updateField<K extends keyof LoginFormValue>(key: K, value: LoginFormValue[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
  if (key === 'brokerId') emit('broker-change', String(value))
}

function updateTradingMode(value: string | number | boolean) {
  if (value === 'ordinary' || value === 'credit') updateField('tradingMode', value)
}

function updateAccountType(value: unknown) {
  if (typeof value !== 'string') return
  if (props.accountTypes.some(option => option.accountType === value)) {
    updateField('accountType', value as LoginFormValue['accountType'])
  }
}

function updateStringField(key: 'brokerId' | 'accessPointId', value: unknown) {
  if (typeof value === 'string') updateField(key, value)
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    ...props.modelValue,
    loginAccount: props.modelValue.loginAccount.trim(),
  })
}
</script>

<template>
  <a-card class="login-card" :bordered="true">
    <header class="login-heading">
      <div class="brand-mark" aria-hidden="true">FQ</div>
      <div>
        <h1>登录交易账户</h1>
        <p>请选择账户信息、证券公司和交易站点。</p>
      </div>
    </header>

    <a-form :model="modelValue" layout="vertical" size="small" @submit="submit">
      <a-form-item field="tradingMode" label="账户类别">
        <a-radio-group
          type="button"
          :model-value="modelValue.tradingMode"
          :disabled="submitting"
          @update:model-value="updateTradingMode"
        >
          <a-radio value="ordinary">普通账户</a-radio>
          <a-radio value="credit">信用账户</a-radio>
        </a-radio-group>
      </a-form-item>

      <a-form-item
        field="accountType"
        label="账号类型"
        required
        :extra="selectedAccountType?.description"
      >
        <a-select
          :model-value="modelValue.accountType"
          :loading="loadingAccountTypes"
          :disabled="loadingAccountTypes || submitting"
          placeholder="请选择账号类型"
          @update:model-value="updateAccountType"
        >
          <a-option
            v-for="option in accountTypes"
            :key="option.accountType"
            :value="option.accountType"
          >
            {{ option.label }}
          </a-option>
        </a-select>
      </a-form-item>

      <a-form-item field="brokerId" label="证券公司" required>
        <a-select
          :model-value="modelValue.brokerId"
          :loading="loadingBrokers"
          :disabled="loadingBrokers || submitting"
          placeholder="请选择证券公司"
          allow-search
          @update:model-value="updateStringField('brokerId', $event)"
        >
          <a-option v-for="broker in brokers" :key="broker.brokerId" :value="broker.brokerId">
            {{ broker.name }}
          </a-option>
        </a-select>
      </a-form-item>

      <a-form-item
        field="accessPointId"
        label="交易站点"
        required
        :extra="selectedAccessPoint ? [selectedAccessPoint.area, selectedAccessPoint.carrier].filter(Boolean).join(' · ') : undefined"
      >
        <a-select
          :model-value="modelValue.accessPointId"
          :loading="loadingAccessPoints"
          :disabled="!modelValue.brokerId || loadingAccessPoints || submitting"
          placeholder="请选择交易站点"
          allow-search
          @update:model-value="updateStringField('accessPointId', $event)"
        >
          <a-option v-for="point in accessPoints" :key="point.accessPointId" :value="point.accessPointId">
            {{ point.name }}
          </a-option>
        </a-select>
      </a-form-item>

      <a-form-item
        field="loginAccount"
        :label="selectedAccountType?.label ?? '登录账号'"
        required
      >
        <a-input
          :model-value="modelValue.loginAccount"
          name="loginAccount"
          autocomplete="username"
          :max-length="32"
          :disabled="submitting"
          :placeholder="`请输入${selectedAccountType?.label ?? '登录账号'}`"
          @update:model-value="updateField('loginAccount', $event)"
        />
      </a-form-item>

      <a-form-item field="password" label="交易密码" required>
        <a-input-password
          :model-value="modelValue.password"
          name="password"
          autocomplete="current-password"
          :max-length="64"
          :disabled="submitting"
          placeholder="请输入交易密码"
          @update:model-value="updateField('password', $event)"
        />
      </a-form-item>

      <a-alert v-if="error" type="error" :show-icon="true" class="login-error">
        {{ error.message }}
        <template v-if="error.code" #action>
          <span class="error-code">{{ error.code }}</span>
        </template>
      </a-alert>

      <a-button
        type="primary"
        size="small"
        html-type="submit"
        long
        :loading="submitting"
        :disabled="!canSubmit"
      >
        {{ submitting ? '正在登录' : '登录' }}
      </a-button>
    </a-form>

    <p class="security-note">交易密码仅用于本次登录验证。</p>
  </a-card>
</template>

<style scoped>
.login-card {
  width: min(100%, 420px);
}

.login-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}

.login-heading h1 {
  margin: 0;
  color: var(--color-text-1);
  font-size: 20px;
  line-height: 1.4;
}

.login-heading p,
.security-note {
  margin: 4px 0 0;
  color: var(--color-text-3);
  font-size: 12px;
}

.brand-mark {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--border-radius-medium);
  color: #fff;
  background: rgb(var(--primary-6));
  font-weight: 700;
}

.login-error {
  margin-bottom: 16px;
}

.error-code {
  color: var(--color-text-3);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
}

.security-note {
  margin-top: 14px;
  text-align: center;
}
</style>
