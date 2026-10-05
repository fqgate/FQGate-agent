import assert from "node:assert/strict";

import {
  McpFqgateFetch,
  resolveFqgateMcpToolName
} from "../src/adapters/mcp-app/McpFqgateFetch.ts";
import type {
  JsonObject,
  McpAppRuntime,
  McpToolResult,
  OriginatingToolSnapshot
} from "../src/adapters/mcp-app/McpAppRuntime.ts";

class FakeRuntime {
  callCount = 0;
  waitCount = 0;
  lastToolName?: string;
  lastArguments?: JsonObject;

  constructor(
    private readonly snapshot: OriginatingToolSnapshot,
    private readonly originatingResult: McpToolResult
  ) {}

  getOriginatingToolSnapshot(): OriginatingToolSnapshot {
    return this.snapshot;
  }

  async waitForToolResult(): Promise<McpToolResult> {
    this.waitCount += 1;
    return this.originatingResult;
  }

  async callTool(name: string, argumentsValue: JsonObject): Promise<McpToolResult> {
    this.callCount += 1;
    this.lastToolName = name;
    this.lastArguments = argumentsValue;
    return this.originatingResult;
  }
}

const requestArguments = {
  security: { market: "XSHG", code: "600151" },
  range: { type: "count", count: 160 },
  interval: "day",
  adjustment: "none"
};
const envelope = {
  code: 0,
  message: "操作成功",
  data: { row_count: 0, data_state: "empty", coverage: {}, items: [] }
};
const toolResult = {
  content: [],
  structuredContent: { ok: true, httpStatus: 200, data: envelope }
} as McpToolResult;
const runtime = new FakeRuntime(
  {
    name: "fqgate_bar_series",
    arguments: { ...requestArguments, instanceId: "tonghuashun-default" }
  },
  toolResult
);
const bridge = new McpFqgateFetch(runtime as unknown as McpAppRuntime);
const request = () => bridge.fetch("http://127.0.0.1:17281/v2/market/bars", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-request-timeout-ms": "30000"
  },
  body: JSON.stringify(requestArguments)
});

assert.deepEqual(await (await request()).json(), envelope);
assert.equal(runtime.callCount, 0, "首屏应复用触发 MCP App 的工具结果");
await request();
assert.equal(runtime.lastToolName, "fqgate_bar_series");
assert.deepEqual(runtime.lastArguments, {
  ...requestArguments,
  instanceId: "tonghuashun-default",
  requestTimeoutMs: 30000
});

await bridge.fetch(
  "http://127.0.0.1:17281/v2/information/articles?market=XSHG&code=600151&category_id=stock",
  { method: "GET" }
);
assert.equal(runtime.lastToolName, "fqgate_information_articles");
assert.deepEqual(runtime.lastArguments, {
  market: "XSHG",
  code: "600151",
  category_id: "stock",
  instanceId: "tonghuashun-default"
});

const previewRuntime = new FakeRuntime(
  {
    name: "fqgate_bar_series",
    arguments: {
      ...requestArguments,
      _fqgatePreview: { selectedInstanceId: "tonghuashun-preview" }
    }
  },
  toolResult
);
const previewBridge = new McpFqgateFetch(
  previewRuntime as unknown as McpAppRuntime
);
await previewBridge.fetch("http://127.0.0.1:17281/v2/market/bars", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(requestArguments)
});
assert.equal(
  previewRuntime.lastArguments?.instanceId,
  "tonghuashun-preview",
  "旧宿主只提供预览上下文时仍应路由到选中的数据源实例"
);

const expectedMappings = new Map([
  ["POST /v2/market/bars", "fqgate_bar_series"],
  ["POST /v2/market/intraday", "fqgate_intraday_series"],
  ["POST /v2/market/quotes/mainland", "fqgate_quote_mainland"],
  ["POST /v2/market/order-books/five-level", "fqgate_depth_five"],
  ["POST /v2/market/level2/order-books/ten-level", "fqgate_level2_depth_ten"],
  ["POST /v2/market/level2/order-book-rankings", "fqgate_level2_order_book_ranking"],
  ["POST /v2/market/level2/order-events", "fqgate_level2_order_events"],
  ["GET /v2/instruments/search", "fqgate_instrument_search"],
  ["GET /v2/information/categories", "fqgate_information_categories"]
]);
for (const [route, tool] of expectedMappings) {
  const [method, pathname] = route.split(" ");
  assert.equal(resolveFqgateMcpToolName(method!, pathname!), tool);
}
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/history/klines"),
  undefined,
  "MCP Apps 不得继续依赖 FQGate 1.0 工具"
);

process.stdout.write("MCP Apps 的 FQGate 2.0 工具桥接验收通过。\n");
