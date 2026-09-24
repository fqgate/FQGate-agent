import assert from "node:assert/strict";

import {
  McpFqgateFetch,
  resolveFqgateMcpToolName
} from "../src/adapters/mcp-app/McpFqgateFetch.ts";
import { parseRealtimeQuote } from "../src/adapters/local-api/FqgateMarketDataParsers.ts";
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
    private readonly originatingResult: McpToolResult,
    private readonly repeatedResult: McpToolResult = originatingResult
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
    return this.repeatedResult;
  }
}

const loginEnvelope = {
  code: 0,
  message: "操作成功",
  data: {
    flow_id: 17,
    qr_image_base64: "AA==",
    qr_media_type: "image/png",
    status: "waiting_for_scan"
  }
};
const loginResult = {
  content: [],
  structuredContent: { ok: true, httpStatus: 200 },
  _meta: {
    "fqgate/uiResult": {
      ok: true,
      httpStatus: 200,
      data: loginEnvelope
    }
  }
} as McpToolResult;

const runtime = new FakeRuntime({
  name: "fqgate_market_qr_login_begin",
  arguments: {},
  result: undefined
}, loginResult);
const bridge = new McpFqgateFetch(runtime as unknown as McpAppRuntime);
const request = () => bridge.fetch("http://127.0.0.1:17281/v1/market/session/qr/begin", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ cache_credentials: false })
});

const firstResponse = await request();
assert.deepEqual(await firstResponse.json(), loginEnvelope);
assert.equal(runtime.waitCount, 1, "首次匹配请求应等待并消费原始工具结果");
assert.equal(runtime.callCount, 0, "消费原始工具结果时不应重复调用二维码工具");

await request();
assert.equal(runtime.callCount, 1, "原始结果只能消费一次，后续刷新应重新调用工具");
assert.equal(runtime.lastToolName, "fqgate_market_qr_login_begin");
assert.deepEqual(runtime.lastArguments, {}, "本机 HTTP 专用参数不得传给 MCP 工具");

const candleEnvelope = { code: 0, message: "操作成功", data: { records: [] } };
const candleResult = {
  content: [],
  structuredContent: { ok: true, httpStatus: 200, data: candleEnvelope }
} as McpToolResult;
const candleRuntime = new FakeRuntime({
  name: "fqgate_market_klines",
  arguments: { market: "USHA", code: "600151", interval: "day", count: 160 },
  result: candleResult
}, candleResult);
const candleBridge = new McpFqgateFetch(candleRuntime as unknown as McpAppRuntime);
const candleRequest = () => candleBridge.fetch("http://127.0.0.1:17281/v1/market/history/klines", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-request-timeout-ms": "30000"
  },
  body: JSON.stringify({
    market: "USHA",
    code: "600151",
    interval: "day",
    count: 160,
    adjust: ""
  })
});
await candleRequest();
assert.equal(candleRuntime.waitCount, 0, "已有原始结果时不应再次等待");
assert.equal(candleRuntime.callCount, 0, "K 线首屏应复用原始工具结果");
await candleRequest();
assert.deepEqual(candleRuntime.lastArguments, {
  market: "USHA",
  code: "600151",
  interval: "day",
  count: 160,
  requestTimeoutMs: 30000
}, "MCP 工具应保留公共参数并剔除空的 HTTP 默认参数");
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/information/news"),
  "fqgate_market_news",
  "资讯接口应映射到 FQGate news 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/level2/orders"),
  "fqgate_market_level2_orders",
  "逐笔委托轮询应映射到 FQGate Level-2 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/level2/cancellations/buy"),
  "fqgate_market_level2_buy_cancellations",
  "买入撤单轮询应映射到 FQGate Level-2 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/level2/cancellations/sell"),
  "fqgate_market_level2_sell_cancellations",
  "卖出撤单轮询应映射到 FQGate Level-2 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/realtime/quote"),
  "fqgate_market_quote",
  "行情快照应映射到 FQGate V1 Quote 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/history/depth"),
  "fqgate_market_depth",
  "普通盘口应映射到 FQGate V1 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/level2/depth"),
  "fqgate_market_level2_depth",
  "Level-2 盘口应映射到 FQGate V1 工具"
);
const v1Quote = parseRealtimeQuote({
  records: [[{
    "5": { type: "string", value: "USHA600151" },
    "6": { type: "float", value: 10 },
    "10": { type: "float", value: 10.08 },
    "13": { type: "float", value: 20_000 },
    "19": { type: "float", value: 201_600 }
  }]]
});
assert.equal(v1Quote?.latestPrice, 10.08);
assert.equal(v1Quote?.previousClose, 10);
assert.equal(v1Quote?.volume, 20_000);
assert.equal(v1Quote?.amount, 201_600);
assert.equal(
  resolveFqgateMcpToolName("DELETE", "/v1/market/session"),
  "fqgate_market_logout",
  "退出登录接口应映射到 FQGate logout 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/session/cached-login"),
  "fqgate_market_cached_login",
  "本机快捷登录接口应映射到 FQGate cached-login 工具"
);

process.stdout.write("MCP 工具首屏结果复用验收通过。\n");
