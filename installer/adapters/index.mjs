import { claudeCodeAdapter } from "./claude-code.mjs";
import { codexAdapter } from "./codex.mjs";

const adapters = new Map([
  [codexAdapter.id, codexAdapter],
  [claudeCodeAdapter.id, claudeCodeAdapter]
]);

export function adapterFor(id) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`没有注册 Adapter：${id}`);
  return adapter;
}
