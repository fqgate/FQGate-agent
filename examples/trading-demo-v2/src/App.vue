<script setup lang="ts">
import { storeToRefs } from "pinia";

import { useTradingSessionStore } from "~/stores";

const sessionStore = useTradingSessionStore();
const { initialized } = storeToRefs(sessionStore);
</script>

<template>
  <div
    v-if="!initialized"
    class="session-restore"
    role="status"
    aria-live="polite"
    aria-label="正在确认登录状态"
  >
    <a-spin :size="24" />
    <p>正在确认登录状态…</p>
  </div>
  <RouterView v-else />
</template>

<style scoped>
.session-restore {
  display: grid;
  min-height: 100vh;
  place-content: center;
  justify-items: center;
  gap: 16px;
  color: #4e5969;
  background: #f2f3f5;
}

.session-restore p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}
</style>
