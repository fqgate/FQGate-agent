<script setup lang="ts">
import { Modal } from "@arco-design/web-vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AccountWorkspace from "~/components/trading/AccountWorkspace.vue";
import { tradingService } from "~/services";
import { useTradingSessionStore } from "~/stores";

const router = useRouter();
const sessionStore = useTradingSessionStore();
const brokerName = ref("");
const session = computed(() => sessionStore.session);

onMounted(async () => {
  try {
    const brokers = await tradingService.getBrokers();
    brokerName.value = brokers.find((item) => item.brokerId === session.value?.brokerId)?.name ?? "";
  } catch {
    brokerName.value = "";
  }
});

function requestLogout(): void {
  Modal.confirm({
    title: "退出交易账户",
    content: "退出后需要重新登录才能继续查询账户或办理交易。",
    okText: "退出",
    cancelText: "取消",
    onOk: async () => {
      sessionStore.logout();
      await router.replace("/login");
    }
  });
}
</script>

<template>
  <a-layout v-if="session" class="trading-layout">
    <header class="trading-header">
      <div>
        <p>FQGate 交易服务</p>
        <h1>交易工作台</h1>
        <span>
          {{ brokerName || `证券公司 ${session.brokerId}` }} ·
          {{ session.accounts.length }} 个账户已登录
        </span>
      </div>
      <a-button size="small" @click="requestLogout">退出登录</a-button>
    </header>

    <a-layout-content class="trading-content">
      <a-alert type="warning" :show-icon="true">
        提交交易前，请确认账户、证券、方向、价格和数量。受理结果以券商记录为准。
      </a-alert>

      <section class="account-list" aria-label="已登录交易账户">
        <AccountWorkspace
          v-for="account in session.accounts"
          :key="`${session.sessionId}-${account.accountId}-${account.tradingMode}`"
          :account="account"
          :session-id="session.sessionId"
          :broker-name="brokerName"
        />
      </section>
    </a-layout-content>
  </a-layout>
</template>

<style scoped>
.trading-layout {
  min-height: 100vh;
  background: var(--color-fill-2);
}

.trading-header {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border-2);
  background: var(--color-bg-2);
}

.trading-header p,
.trading-header h1,
.trading-header span {
  margin: 0;
}

.trading-header p,
.trading-header span {
  color: var(--color-text-3);
  font-size: 12px;
}

.trading-header h1 {
  margin: 2px 0;
  color: var(--color-text-1);
  font-size: 20px;
  font-weight: 600;
}

.trading-content {
  display: grid;
  gap: 16px;
  width: min(100%, 1440px);
  margin: 0 auto;
  padding: 20px 24px 32px;
}

.account-list {
  display: grid;
  gap: 16px;
}

@media (max-width: 640px) {
  .trading-header,
  .trading-content {
    padding-right: 14px;
    padding-left: 14px;
  }
}
</style>
