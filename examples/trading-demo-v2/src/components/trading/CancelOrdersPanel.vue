<script setup lang="ts">
import { Message, Modal } from "@arco-design/web-vue";
import { computed, h, onBeforeUnmount, ref, watch } from "vue";

import { FqgateApiError } from "@/adapters/local-api/FqgateHttpClient";
import { tradingService } from "~/services";
import type { TableResponse, TradingAccount } from "~/types";
import RecordsTable from "./RecordsTable.vue";
import { buildCancelOrderRecords, type CancelOrderRecord } from "./orderRecords";
import type { RecordColumn, TradingRecord, UserFacingError } from "./types";

const props = defineProps<{
  sessionId: string;
  account: TradingAccount;
}>();

const columns: RecordColumn[] = [
  { key: "orderTime", title: "委托时间", width: 104 },
  { key: "security", title: "证券", width: 150 },
  { key: "direction", title: "方向", width: 88 },
  { key: "price", title: "委托价格", align: "right", width: 108 },
  { key: "orderQuantity", title: "委托数量", align: "right", width: 108 },
  { key: "filledQuantity", title: "已成数量", align: "right", width: 108 },
  { key: "orderStatus", title: "委托状态", width: 112 }
];

const result = ref<TableResponse | null>(null);
const loading = ref(false);
const error = ref<UserFacingError | null>(null);
const confirmingKey = ref("");
const submittingKey = ref("");
let requestController: AbortController | undefined;
let submitController: AbortController | undefined;
let confirmModal: ReturnType<typeof Modal.confirm> | undefined;

const records = computed<CancelOrderRecord[]>(() => buildCancelOrderRecords(
  result.value?.items ?? [],
  result.value?.columns ?? [],
  props.account.tradingMode
));

watch(
  () => [props.sessionId, props.account.accountId, props.account.tradingMode] as const,
  () => void load(),
  { immediate: true }
);

onBeforeUnmount(() => {
  confirmModal?.close();
  confirmModal = undefined;
  confirmingKey.value = "";
  requestController?.abort();
  submitController?.abort();
});

async function load(): Promise<void> {
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  loading.value = true;
  error.value = null;
  try {
    const response = await tradingService.getTable(
      "/v1/trading/orders",
      accountContext(),
      undefined,
      controller.signal
    );
    verifyAccount(response);
    result.value = response;
  } catch (reason) {
    if (!controller.signal.aborted) {
      result.value = null;
      error.value = toUserError(reason, "当前挂单查询未完成，请稍后重试。");
    }
  } finally {
    if (requestController === controller) loading.value = false;
  }
}

function requestCancel(rawRecord: TradingRecord): void {
  const record = rawRecord as CancelOrderRecord;
  if (!record.__canCancel || confirmingKey.value || submittingKey.value) return;
  confirmingKey.value = record.__rowKey;
  confirmModal = Modal.confirm({
    title: "确认撤单",
    content: () => h("div", { style: "display:grid;gap:6px" }, [
      h("div", `证券：${record.security}`),
      h("div", `方向：${record.direction}`),
      h("div", `委托价格：${record.price}`),
      h("div", `委托数量：${record.orderQuantity}`),
      h("div", `当前状态：${record.orderStatus}`),
      h("div", { style: "margin-top:6px" }, "确认后将向券商提交撤单申请。")
    ]),
    okText: "确认撤单",
    cancelText: "返回",
    maskClosable: false,
    onOk: () => submitCancel(record),
    onCancel: () => {
      confirmModal = undefined;
      confirmingKey.value = "";
    }
  });
}

/** 二次确认通过后才生成本次请求编号并提交；结果不明确时只刷新记录，不自动重试。 */
async function submitCancel(record: CancelOrderRecord): Promise<void> {
  const requestId = crypto.randomUUID();
  confirmingKey.value = "";
  submittingKey.value = record.__rowKey;
  submitController = new AbortController();
  try {
    const response = await tradingService.submit(
      "/v1/trading/orders/cancel",
      cancelPayload(record, requestId),
      undefined,
      submitController.signal
    );
    if (!isConfirmedResponse(response, requestId)) {
      Message.warning("撤单结果暂时无法确认，已为你刷新委托记录，请不要重复提交。");
      await load();
      return;
    }
    Message.success("撤单申请已受理，正在刷新委托记录。");
    await load();
  } catch (reason) {
    if (submitController?.signal.aborted) return;
    if (reason instanceof FqgateApiError && reason.httpStatus >= 400 && reason.httpStatus < 500) {
      Message.error(reason.message || "撤单申请未提交，请刷新记录后重试。");
      return;
    }
    Message.warning("撤单结果暂时无法确认，已为你刷新委托记录，请不要重复提交。");
    await load();
  } finally {
    confirmModal = undefined;
    submitController = undefined;
    submittingKey.value = "";
  }
}

function cancelPayload(record: CancelOrderRecord, requestId: string): Record<string, unknown> {
  const source = record.__cancelFields;
  const payload: Record<string, unknown> = {
    sessionId: props.sessionId,
    accountId: props.account.accountId,
    tradingMode: props.account.tradingMode,
    clientRequestId: requestId,
    contractNumber: source.contractNumber,
    marketCode: source.marketCode,
    shareholderAccount: source.shareholderAccount
  };
  if (props.account.tradingMode === "credit") {
    Object.assign(payload, {
      securityCode: source.securityCode,
      orderDate: source.orderDate,
      reportNumber: source.reportNumber,
      cancelQuantity: source.cancelQuantity,
      matchNumber: source.matchNumber
    });
  }
  return payload;
}

function isConfirmedResponse(response: unknown, requestId: string): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const body = response as Record<string, unknown>;
  return body.sessionId === props.sessionId
    && body.accountId === props.account.accountId
    && body.tradingMode === props.account.tradingMode
    && body.clientRequestId === requestId
    && body.status === "accepted";
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
  ) throw new Error("返回数据与当前账户不一致，请重新查询。");
}

function toUserError(reason: unknown, fallback: string): UserFacingError {
  if (reason instanceof FqgateApiError) {
    return { message: reason.message || fallback, code: String(reason.code) };
  }
  return { message: reason instanceof Error && reason.message.trim() ? reason.message : fallback };
}
</script>

<template>
  <RecordsTable
    title="当前挂单"
    :columns="columns"
    :records="records"
    row-key="__rowKey"
    :loading="loading"
    :error="error"
    empty-text="当前没有可撤挂单"
    :action-column="{ title: '操作', width: 88 }"
    @refresh="load"
  >
    <template #actions="{ record }">
      <a-tooltip
        v-if="!record.__canCancel"
        :content="record.__disabledReason"
      >
        <span class="disabled-action">
          <a-button size="mini" disabled>撤单</a-button>
        </span>
      </a-tooltip>
      <a-button
        v-else
        size="mini"
        status="danger"
        :loading="submittingKey === record.__rowKey"
        :disabled="Boolean(submittingKey || confirmingKey)"
        @click.stop="requestCancel(record)"
      >
        撤单
      </a-button>
    </template>
  </RecordsTable>
</template>

<style scoped>
.disabled-action {
  display: inline-flex;
  cursor: not-allowed;
}
</style>
