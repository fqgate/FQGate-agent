import assert from "node:assert/strict";

import {
  normalizeFqgateBaseUrl,
  resolveFqgateBaseUrl
} from "../src/adapters/local-api/FqgateHttpClient.ts";

assert.equal(resolveFqgateBaseUrl(), "http://127.0.0.1:17281");
assert.equal(
  normalizeFqgateBaseUrl("http://127.0.0.1:18000/docs?source=preview"),
  "http://127.0.0.1:18000"
);
assert.equal(normalizeFqgateBaseUrl("http://localhost:17281/"), "http://localhost:17281");
assert.equal(normalizeFqgateBaseUrl("http://[::1]:17281/"), "http://[::1]:17281");
assert.equal(normalizeFqgateBaseUrl("https://127.0.0.1:17281"), undefined);
assert.equal(normalizeFqgateBaseUrl("http://192.168.1.10:17281"), undefined);
assert.equal(normalizeFqgateBaseUrl("http://example.com:17281"), undefined);
assert.equal(normalizeFqgateBaseUrl("http://name:secret@127.0.0.1:17281"), undefined);

process.stdout.write("FQGate 本机地址边界验收通过。\n");
