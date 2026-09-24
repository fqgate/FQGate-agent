import { createApp } from "vue";

import App from "./App.vue";
import { mountMcpUi } from "./mcp-apps/universal";
import { resolveUiTransportMode } from "./shared/uiTransport";
import "./style.css";

async function main(): Promise<void> {
  if (resolveUiTransportMode() === "mcp") {
    await mountMcpUi();
    return;
  }
  createApp(App).mount("#app");
}

void main().catch((error: unknown) => {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  root.className = "mcp-app-entry-error";
  root.textContent = error instanceof Error ? error.message : "组件加载失败。";
});
