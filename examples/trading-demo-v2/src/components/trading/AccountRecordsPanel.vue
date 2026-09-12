<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { FqgateApiError } from "@/adapters/local-api/FqgateHttpClient";

import { tradingService } from "~/services";
import type { OpenApiContract, TableResponse, TradingAccount } from "~/types";
import RecordsTable from "./RecordsTable.vue";
import type { DateRangeValue, RecordColumn, TradingRecord, UserFacingError } from "./types";

const props = defineProps<{
  title: string;
  path: string;
  sessionId: string;
  account: TradingAccount;
}>();

const contract = ref<OpenApiContract | null>();
const result = ref<TableResponse | null>(null);
const loading = ref(false);
const error = ref<UserFacingError | null>(null);
const today = localDate();
const dateRange = ref<DateRangeValue>({ startDate: today, endDate: today });
let requestController: AbortController | undefined;

const usesDates = computed(() => contract.value?.parameters.some(
  (parameter) => parameter.name === "startDate"
) ?? false);
const columns = computed<RecordColumn[]>(() => (result.value?.columns ?? []).map((column) => ({
  key: column.key,
  title: column.label
})));
const records = computed<TradingRecord[]>(() => (result.value?.items ?? []).map((item, index) => ({
  ...item,
  __rowKey: `${props.path}-${index}`
})));

onMounted(() => void initialize());
onBeforeUnmount(() => requestController?.abort());

async function initialize(): Promise<void> {
  try {
    contract.value = await tradingService.getOpenApiContract(props.path, "get");
    if (!contract.value?.available) {
      error.value = { message: `暂时无法查询${props.title}。` };
      return;
    }
    await load();
  } catch (reason) {
    error.value = toUserError(reason, `${props.title}暂时无法加载，请稍后重试。`);
  }
}

async function load(range: DateRangeValue | null = dateRange.value): Promise<void> {
  if (loading.value || !contract.value?.available) return;
  if (usesDates.value && (!range?.startDate || !range.endDate || range.startDate > range.endDate)) {
    error.value = { message: "请选择有效的开始日期和结束日期。" };
    return;
  }

  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  loading.value = true;
  error.value = null;
  try {
    const response = await tradingService.getTable(
      props.path,
      accountContext(),
      usesDates.value && range ? range : undefined,
      controller.signal
    );
    verifyAccount(response);
    result.value = response;
  } catch (reason) {
    if (!controller.signal.aborted) {
      result.value = null;
      error.value = toUserError(reason, `${props.title}查询未完成，请稍后重试。`);
    }
  } finally {
    if (requestController === controller) loading.value = false;
  }
}

function accountContext() {
  return {
    sessionId: props.sessionId,
    accountId: props.account.accountId,
    tradingMode: props.account.tradingMode
  };
}

function verifyAccount(response: Pick<TableResponse, "accountId" | "tradingMode">): void {
  if (
    response.accountId !== props.account.accountId
    || response.tradingMode !== props.account.tradingMode
  ) {
    throw new Error("返回数据与当前账户不一致，请重新查询。");
  }
}

function toUserError(reason: unknown, fallback: string): UserFacingError {
  if (reason instanceof FqgateApiError) {
    return { message: reason.message || fallback, code: String(reason.code) };
  }
  return { message: reason instanceof Error && reason.message.trim() ? reason.message : fallback };
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
</script>

<template>
  <RecordsTable
    v-model:date-range="dateRange"
    :title="title"
    :columns="columns"
    :records="records"
    row-key="__rowKey"
    :loading="loading"
    :error="error"
    :show-date-filter="usesDates"
    @query="load"
    @refresh="load()"
  />
</template>
