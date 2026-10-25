import assert from "node:assert/strict";

import {
  readSecurities,
  readSecurity,
} from "../src/mcp-apps/securityArguments.ts";

assert.deepEqual(
  readSecurity({ securities: [{ market: "XSHG", code: "600151" }] }),
  {
    market: "XSHG",
    code: "600151",
    name: undefined,
    fullCode: "XSHG600151",
  },
  "十档盘口的标准 securities 参数必须能被单证券界面读取",
);

assert.deepEqual(
  readSecurity({ security: { market: "XSHE", code: "000001" } }),
  {
    market: "XSHE",
    code: "000001",
    name: undefined,
    fullCode: "XSHE000001",
  },
);

assert.deepEqual(readSecurity({ market: "XSHG", code: "600519" }), {
  market: "XSHG",
  code: "600519",
  name: undefined,
  fullCode: "XSHG600519",
});

assert.deepEqual(
  readSecurities({
    securities: [
      { market: "XSHG", code: "600151" },
      { market: "XSHE", code: "000001" },
    ],
  }).map(({ market, code }) => ({ market, code })),
  [
    { market: "XSHG", code: "600151" },
    { market: "XSHE", code: "000001" },
  ],
);

process.stdout.write("MCP Apps 证券参数解析验收通过。\n");
