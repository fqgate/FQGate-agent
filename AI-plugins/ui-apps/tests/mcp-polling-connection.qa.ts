import assert from "node:assert/strict";

import {
  McpPollingConnection,
  type McpPollingState
} from "../src/adapters/mcp-app/McpPollingConnection.ts";

const states: McpPollingState[] = [];
const errors: string[] = [];
let attempts = 0;
let activeRequests = 0;
let maxActiveRequests = 0;

const connection = new McpPollingConnection({
  intervalMs: 5,
  retryIntervalMs: 5,
  poll: async () => {
    attempts += 1;
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    try {
      await delay(2);
      if (attempts === 1) throw new Error("临时失败");
    } finally {
      activeRequests -= 1;
    }
  },
  onStateChange: (state) => states.push(state),
  onError: (error) => errors.push(error.message)
});

await waitUntil(() => states.includes("connected"));
connection.close();

assert.deepEqual(states.slice(0, 3), ["connecting", "reconnecting", "connected"]);
assert.equal(states.at(-1), "closed");
assert.deepEqual(errors, ["临时失败"]);
assert.equal(maxActiveRequests, 1, "轮询请求不能相互重叠");

process.stdout.write("MCP Apps 轮询连接恢复验收通过。\n");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待轮询状态超时。");
    await delay(2);
  }
}
