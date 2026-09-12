<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import LoginForm from "~/components/login/LoginForm.vue";
import type {
  AccessPointOption,
  BrokerOption,
  LoginAccountTypeOption,
  LoginFormError,
  LoginFormValue
} from "~/components/login/types";
import { tradingService } from "~/services";
import { useTradingSessionStore } from "~/stores";

const router = useRouter();
const sessionStore = useTradingSessionStore();
const accountTypes = ref<LoginAccountTypeOption[]>([]);
const brokers = ref<BrokerOption[]>([]);
const accessPoints = ref<AccessPointOption[]>([]);
const loadingAccountTypes = ref(false);
const loadingBrokers = ref(false);
const loadingAccessPoints = ref(false);
const pageError = ref("");
const form = ref<LoginFormValue>({
  tradingMode: sessionStore.tradingMode,
  accountType: "fundAccount",
  brokerId: sessionStore.brokerId,
  accessPointId: sessionStore.accessPointId,
  loginAccount: "",
  password: ""
});

let accountTypeRequest: AbortController | undefined;
let brokerRequest: AbortController | undefined;
let accessPointRequest: AbortController | undefined;

const formError = computed<LoginFormError | null>(() => {
  const message = sessionStore.errorMessage || pageError.value;
  return message ? { message } : null;
});

onMounted(() => {
  void loadAccountTypes();
  void loadBrokers();
});
onBeforeUnmount(() => {
  accountTypeRequest?.abort();
  brokerRequest?.abort();
  accessPointRequest?.abort();
  form.value.password = "";
});

async function loadAccountTypes(): Promise<void> {
  accountTypeRequest?.abort();
  const controller = new AbortController();
  accountTypeRequest = controller;
  loadingAccountTypes.value = true;
  try {
    const result = await tradingService.getLoginAccountTypes(controller.signal);
    accountTypes.value = result;
    form.value.accountType = result.find(
      (option) => option.accountType === form.value.accountType
    )?.accountType
      ?? result.find((option) => option.isDefault)?.accountType
      ?? result[0]?.accountType
      ?? "fundAccount";
  } catch (error) {
    if (!controller.signal.aborted) {
      accountTypes.value = [];
      pageError.value = readableError(error, "暂时无法加载账号类型，请稍后重试。");
    }
  } finally {
    if (accountTypeRequest === controller) loadingAccountTypes.value = false;
  }
}

async function loadBrokers(): Promise<void> {
  brokerRequest?.abort();
  const controller = new AbortController();
  brokerRequest = controller;
  loadingBrokers.value = true;
  pageError.value = "";
  try {
    const result = await tradingService.getBrokers(controller.signal);
    const sortedBrokers = [...result].sort((left, right) => (
      left.pinyin.localeCompare(right.pinyin, "en", { sensitivity: "base" })
      || left.name.localeCompare(right.name, "zh-CN")
    ));
    brokers.value = sortedBrokers.map(({ brokerId, name }) => ({ brokerId, name }));
    if (!form.value.brokerId || !result.some((item) => item.brokerId === form.value.brokerId)) {
      form.value.brokerId = result.find((item) => item.brokerId === "339")?.brokerId
        ?? result[0]?.brokerId
        ?? "";
    }
    if (form.value.brokerId) await loadAccessPoints(form.value.brokerId);
  } catch (error) {
    if (!controller.signal.aborted) pageError.value = readableError(error, "暂时无法加载证券公司，请稍后重试。");
  } finally {
    if (brokerRequest === controller) loadingBrokers.value = false;
  }
}

async function loadAccessPoints(brokerId: string): Promise<void> {
  accessPointRequest?.abort();
  form.value.accessPointId = "";
  accessPoints.value = [];
  if (!brokerId) return;

  const controller = new AbortController();
  accessPointRequest = controller;
  loadingAccessPoints.value = true;
  pageError.value = "";
  try {
    const result = await tradingService.getAccessPoints(brokerId, controller.signal);
    const available = result.filter((item) => item.ports.hexin !== null);
    accessPoints.value = available.map(({ accessPointId, name, area, carrier }) => ({
      accessPointId,
      name,
      area,
      carrier
    }));
    const savedAccessPoint = sessionStore.accessPointId;
    form.value.accessPointId = available.find((item) => item.accessPointId === savedAccessPoint)?.accessPointId
      ?? available.find((item) => item.name === "浙商杭州电信")?.accessPointId
      ?? available[0]?.accessPointId
      ?? "";
  } catch (error) {
    if (!controller.signal.aborted) pageError.value = readableError(error, "暂时无法加载交易站点，请稍后重试。");
  } finally {
    if (accessPointRequest === controller) loadingAccessPoints.value = false;
  }
}

function selectBroker(brokerId: string): void {
  sessionStore.rememberBroker(brokerId);
  void loadAccessPoints(brokerId);
}

async function submitLogin(value: LoginFormValue): Promise<void> {
  pageError.value = "";
  sessionStore.clearError();
  try {
    await sessionStore.login({
      tradingMode: value.tradingMode,
      accountType: value.accountType,
      brokerId: value.brokerId,
      accessPointId: value.accessPointId,
      loginAccount: value.loginAccount.trim(),
      password: value.password
    });
    form.value.password = "";
    await router.replace("/trading");
  } catch {
    form.value.password = "";
  }
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
</script>

<template>
  <main class="route-page route-page--centered" aria-label="交易账户登录">
    <LoginForm
      v-model="form"
      :account-types="accountTypes"
      :brokers="brokers"
      :access-points="accessPoints"
      :loading-account-types="loadingAccountTypes"
      :loading-brokers="loadingBrokers"
      :loading-access-points="loadingAccessPoints"
      :submitting="sessionStore.status === 'signing-in'"
      :error="formError"
      @broker-change="selectBroker"
      @submit="submitLogin"
    />
  </main>
</template>
