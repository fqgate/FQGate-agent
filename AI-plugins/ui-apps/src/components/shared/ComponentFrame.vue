<script setup lang="ts">
import { IconRefresh } from "@arco-design/web-vue/es/icon";
import { computed } from "vue";

import type { ComponentConnectionState } from "./contracts";

const props = withDefaults(defineProps<{
  realtime?: boolean;
  connectionState?: ComponentConnectionState;
  connectionLoading?: boolean;
  loadingTip?: string;
  refreshable?: boolean;
  refreshing?: boolean;
}>(), {
  realtime: false,
  connectionState: "disconnected",
  connectionLoading: false,
  loadingTip: "正在重新连接…",
  refreshable: false,
  refreshing: false
});

defineEmits<{
  refresh: [];
}>();

const connectionText = computed(() => {
  if (props.connectionState === "connected") return "已连接";
  if (props.connectionState === "reconnecting") return "重连中";
  return "已断开";
});
</script>

<template>
  <section class="component-frame" :aria-busy="connectionLoading || refreshing">
    <header class="component-status-bar">
      <div class="component-brand-badges">
        <a-tag class="component-source-badge" color="arcoblue">
          免费AI量化数据源(同花顺)
        </a-tag>
        <a
          class="component-open-source-badge"
          href="https://github.com/fqgate/FQGate-agent"
          target="_blank"
          rel="noopener noreferrer"
        >
          GITHUB免费开源
        </a>
      </div>

      <div class="component-status-actions">
        <a-tooltip v-if="realtime" :content="connectionText">
          <div
            class="component-connection-status"
            :class="`is-${connectionState}`"
            aria-live="polite"
          >
            <span class="connection-dot" aria-hidden="true" />
            <span>{{ connectionText }}</span>
          </div>
        </a-tooltip>

        <a-tooltip v-if="refreshable" content="刷新数据">
          <a-button
            class="component-refresh-button"
            aria-label="刷新数据"
            :loading="refreshing"
            @click="$emit('refresh')"
          >
            <template #icon><IconRefresh /></template>
          </a-button>
        </a-tooltip>
      </div>
    </header>

    <div class="component-content">
      <slot />
    </div>

    <div v-if="connectionLoading" class="component-connection-mask" role="status">
      <a-spin :tip="loadingTip" />
    </div>
  </section>
</template>

<style scoped>
.component-frame {
  box-sizing: border-box;
  position: relative;
  width: 100%;
  min-width: 0;
}

.component-status-bar {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 28px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border-2);
  background: var(--color-fill-1);
}

.component-content {
  width: 100%;
  min-width: 0;
}

.component-brand-badges {
  display: flex;
  height: 100%;
  align-items: center;
  gap: 0;
}

.component-status-actions {
  display: flex;
  height: 100%;
  align-items: center;
}

.component-source-badge,
.component-open-source-badge {
  box-sizing: border-box;
  display: inline-flex;
  margin: 0;
  height: 100%;
  padding: 0 8px;
  align-items: center;
  border-radius: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 27px;
  white-space: nowrap;
}

.component-source-badge {
  pointer-events: none;
  font-size: 10px;
}

.component-open-source-badge {
  color: #000;
  border: 1px solid #fadc19;
  background: #fadc19;
  text-decoration: none;
  transition: color 0.1s, border-color 0.1s, background-color 0.1s;
  cursor: pointer;
}

.component-open-source-badge:hover {
  color: #000;
  border-color: rgb(var(--gold-6));
  background: rgb(var(--gold-6));
}

.component-open-source-badge:active {
  border-color: rgb(var(--gold-7));
  background: rgb(var(--gold-7));
}

.component-connection-status {
  box-sizing: border-box;
  display: inline-flex;
  height: 100%;
  margin-right: 0;
  padding: 0 8px;
  align-items: center;
  gap: 6px;
  color: var(--color-text-2);
  border-right: 1px solid var(--color-border-2);
  border-left: 1px solid var(--color-border-2);
  border-radius: 0;
  background: var(--color-bg-5);
  font-size: 12px;
  line-height: 27px;
  cursor: default;
}

.connection-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgb(var(--red-6));
}

.component-connection-status.is-connected .connection-dot {
  background: rgb(var(--green-6));
}

.component-connection-status.is-reconnecting .connection-dot {
  animation: reconnect-pulse 1.2s ease-in-out infinite;
}

.component-status-bar .component-refresh-button {
  box-sizing: border-box;
  width: 28px;
  min-width: 28px;
  height: 100%;
  margin-right: 0;
  padding: 0;
  border-top: 0;
  border-bottom: 0;
  border-radius: 0;
  background: transparent;
}

.component-status-bar .component-refresh-button:hover {
  background: var(--color-fill-3);
}

.component-status-bar .component-refresh-button:active {
  background: var(--color-fill-4);
}

.component-connection-mask {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-spin-layer-bg);
  user-select: none;
}

@keyframes reconnect-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
