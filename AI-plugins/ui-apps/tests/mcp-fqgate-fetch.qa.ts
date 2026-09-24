import assert from "node:assert/strict";

import {
  McpFqgateFetch,
  resolveFqgateMcpToolName
} from "../src/adapters/mcp-app/McpFqgateFetch.ts";
import {
  parseStandardOrderBook,
  parseStandardRealtimeQuote,
  type FqgateStandardOrderBookData,
  type FqgateStandardQuoteData
} from "../src/adapters/local-api/FqgateMarketDataParsers.ts";
import { FqgateMarketQuoteSnapshotService } from "../src/adapters/local-api/FqgateMarketQuoteService.ts";
import { toFqgateStandardSecurity } from "../src/adapters/local-api/FqgateStandardMarket.ts";
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
  resolveFqgateMcpToolName("POST", "/v2/market/quotes"),
  "fqgate_quote_snapshot",
  "V2 行情快照应映射到标准 Quote 工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v2/market/order-books/five-level"),
  "fqgate_depth_five",
  "V2 五档盘口应映射到独立标准工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v2/market/level2/order-books/ten-level"),
  "fqgate_level2_depth_ten",
  "V2 十档盘口应映射到独立标准工具"
);
assert.equal(
  resolveFqgateMcpToolName("POST", "/v1/market/realtime/quote"),
  undefined,
  "快照适配器不得再回退调用 V1 数字字段行情工具"
);
assert.deepEqual(
  toFqgateStandardSecurity({ market: "USHA", code: "600151" }),
  { market: "XSHG", code: "600151" },
  "V2 请求必须把同花顺上海市场代码转换为标准市场代码"
);
assert.deepEqual(
  toFqgateStandardSecurity({ market: "USZA", code: "000001" }),
  { market: "XSHE", code: "000001" },
  "V2 请求必须把同花顺深圳市场代码转换为标准市场代码"
);

const semanticQuote = parseStandardRealtimeQuote({
  items: [{
    security: { market: "XSHG", code: "600151" },
    previous_close: 10,
    latest: 10.08,
    volume: 20_000,
    transaction_amount: 201_600
  }]
});
assert.equal(semanticQuote?.latestPrice, 10.08);
assert.equal(semanticQuote?.previousClose, 10);
assert.equal(semanticQuote?.turnoverRate, null, "V2 Quote 未定义的换手率不得从来源字段推断");

const wrappedQuote = parseStandardRealtimeQuote({
  items: [{
    security: { market: "XSHG", code: "600151" },
    latest: { type: "float", value: 10.08 },
    volume: "20000"
  }]
} as unknown as FqgateStandardQuoteData);
assert.equal(wrappedQuote, undefined, "V2 解析器不得兼容数字字段包装或字符串数值");

const fiveLevel = parseStandardOrderBook({
  items: [{
    security: { market: "XSHG", code: "600151" },
    bids: [{ level: 1, price: 10.07, volume: 1_000 }],
    asks: [{ level: 1, price: 10.09, volume: 1_100 }]
  }]
}, 5);
assert.equal(fiveLevel.bids.length, 5, "五档快照必须保持固定五档结构");
assert.deepEqual(fiveLevel.bids[0], { level: 1, price: 10.07, volume: 1_000 });
const wrappedDepth = parseStandardOrderBook({
  items: [{
    security: { market: "XSHG", code: "600151" },
    bids: [{ level: 1, price: { type: "float", value: 10.07 }, volume: "1000" }],
    asks: []
  }]
} as unknown as FqgateStandardOrderBookData, 5);
assert.deepEqual(
  wrappedDepth.bids[0],
  { level: 1, price: null, volume: null },
  "V2 盘口解析器不得解包或转换来源格式"
);

let quoteRequest: { url: string; body: JsonObject } | undefined;
const quoteService = new FqgateMarketQuoteSnapshotService({
  baseUrl: "http://fqgate.test",
  fetch: async (input, init) => {
    quoteRequest = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as JsonObject
    };
    return new Response(JSON.stringify({
      code: 0,
      message: "操作成功",
      data: {
        row_count: 1,
        data_state: "present",
        coverage: {
          status: "complete",
          requested_count: 1,
          returned_count: 1
        },
        items: [{
          security: { market: "XSHG", code: "600151" },
          security_name: "航天机电",
          latest: 10.08,
          previous_close: 10
        }]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
});
const quotePatches = await quoteService.getQuotes([{ market: "USHA", code: "600151" }]);
assert.equal(new URL(quoteRequest!.url).pathname, "/v2/market/quotes");
assert.deepEqual(quoteRequest!.body.securities, [{ market: "XSHG", code: "600151" }]);
assert.ok(
  Array.isArray(quoteRequest!.body.fields)
    && quoteRequest!.body.fields.every((field) => typeof field === "string"),
  "V2 Quote 请求只能发送语义字段名"
);
assert.deepEqual(quotePatches[0]?.security, {
  market: "USHA",
  code: "600151",
  fullCode: "USHA600151"
}, "V2 响应匹配后应保留界面使用的原证券身份");
assert.equal(quotePatches[0]?.latestPrice, 10.08);

process.stdout.write("MCP 工具首屏结果复用验收通过。\n");
