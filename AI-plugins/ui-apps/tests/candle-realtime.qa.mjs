import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const targetUrl = "http://127.0.0.1:18792/?component=candle&interval=day";
const outputDirectory = resolve("..", "..", ".tmp", "ui-apps-qa");

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      diagnostics.push(`console: ${message.text()}`);
    }
  });

  await installRealtimeSocket(page);
  await routeSnapshots(page);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".candle-panel").waitFor();
  await page.locator(".component-connection-status.is-connected").waitFor({ timeout: 10_000 });
  await page.locator(".latest-price").filter({ hasText: "10.31" }).waitFor({ timeout: 10_000 });
  await page.locator(".latest-price.rise").waitFor({ timeout: 10_000 });
  const priceChange = (await page.locator(".price-change").innerText()).replaceAll(/\s/g, "");
  if (priceChange !== "+0.31+3.10%") {
    throw new Error(`涨跌额或涨跌幅显示异常：${priceChange}`);
  }
  await page.locator(".stat-grid").getByText("2.35%", { exact: true }).waitFor({ timeout: 10_000 });
  await page.locator(".depth-rows").filter({ hasText: "9999" }).waitFor({ timeout: 10_000 });
  await page.locator(".transaction-rows").filter({ hasText: "10.29" }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(200);
  const transactionTitle = await page.locator("#details-title").innerText();
  if (transactionTitle.replaceAll(/\s/g, "") !== "成交明细81") {
    throw new Error(`成交明细缓存数量异常：${transactionTitle}`);
  }
  await assertVirtualTransactionList(page);

  const realtimeState = await page.evaluate(() => window.__fqgateRealtimeQa);
  const requiredKinds = ["quote", "intraday", "level2_depth", "transaction_detail"];
  if (
    realtimeState.connections !== 1
    || requiredKinds.some((kind) => !realtimeState.subscriptions.includes(kind))
  ) {
    throw new Error(`实时行情没有复用一条连接订阅完整通道：${JSON.stringify(realtimeState)}`);
  }

  const beforeHidden = realtimeState.closes;
  await page.getByText("资讯", { exact: true }).first().click();
  await page.waitForTimeout(4_500);
  const earlyHidden = await page.evaluate(() => window.__fqgateRealtimeQa.closes);
  if (earlyHidden !== beforeHidden) throw new Error("面板短暂不可见时不应提前断开实时行情。");
  await page.waitForTimeout(800);
  const afterHidden = await page.evaluate(() => window.__fqgateRealtimeQa.closes);
  if (afterHidden <= beforeHidden) throw new Error("面板不可见 5 秒后没有断开实时行情。");

  await page.getByText("个股行情", { exact: true }).first().click();
  await page.locator(".component-connection-status.is-connected").waitFor({ timeout: 10_000 });
  const resumedState = await page.evaluate(() => window.__fqgateRealtimeQa);
  if (resumedState.connections !== 2) {
    throw new Error(`面板恢复可见后没有重新连接实时行情：${JSON.stringify(resumedState)}`);
  }
  if (diagnostics.length) throw new Error(`实时行情页面存在异常：${diagnostics.join(" | ")}`);

  await page.screenshot({
    path: resolve(outputDirectory, "desktop-candle-realtime.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });
  process.stdout.write(`K 线、盘口与成交实时更新验收通过，截图目录：${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function routeSnapshots(page) {
  await page.route("**/v1/market/health", (route) => route.fulfill(apiResponse({
    connected: true,
    network_ready: true,
    level2_permission: true,
    status: "ok"
  })));
  await page.route("**/v1/market/history/klines", (route) => route.fulfill(apiResponse({
    records: [[{
      "1": field(route.request().postDataJSON()?.interval === "day" ? "20260910" : "202609101129"),
      "7": field(10), "8": field(10.12), "9": field(9.98), "11": field(10.08),
      "13": field(20_000), "19": field(201_600)
    }]]
  })));
  await page.route("**/v1/market/realtime/quote", (route) => route.fulfill(apiResponse({
    records: [[{
      "5": field("USHA600151"),
      "6": field(10),
      "7": field(10.02),
      "8": field(10.12),
      "9": field(9.98),
      "10": field(10.08),
      "13": field(20_000),
      "19": field(201_600),
      "1968584": field(2.28)
    }]]
  })));
  await page.route("**/v1/market/level2/depth", (route) => route.fulfill(apiResponse({
    depth: [{
      security: "USHA600151",
      bids: depthLevels(10.07, -0.01, 1_000),
      asks: depthLevels(10.09, 0.01, 1_100)
    }]
  })));
  await page.route("**/v1/market/level2/transactions", (route) => route.fulfill(apiResponse({
    semantic_records: [[...Array.from({ length: 80 }, (_, index) => semanticTransaction(
      index + 1,
      9.01 + index * 0.01,
      100 + index,
      index % 2 === 0 ? "buy" : "sell",
      1_789_009_200_000 + index * 1_000
    ))]]
  })));
}

async function assertVirtualTransactionList(page) {
  const beforeScroll = await page.locator(".transaction-rows").innerText();
  const result = await page.locator(".transaction-rows").evaluate((root) => {
    const scrollable = [root, ...root.querySelectorAll("*")].find((element) => (
      element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 1
    ));
    if (!(scrollable instanceof HTMLElement)) return null;
    const renderedRows = root.querySelectorAll(".details-list-item").length;
    return {
      renderedRows,
      clientHeight: scrollable.clientHeight,
      scrollHeight: scrollable.scrollHeight
    };
  });
  if (!result || result.renderedRows >= 81 || result.scrollHeight <= result.clientHeight) {
    throw new Error(`成交明细没有启用虚拟滚动：${JSON.stringify(result)}`);
  }
  await page.locator(".transaction-rows").hover();
  await page.mouse.wheel(0, 2_000);
  await page.waitForTimeout(200);
  const afterScroll = await page.locator(".transaction-rows").innerText();
  if (afterScroll === beforeScroll) {
    const boxes = await page.locator(".transaction-rows").evaluate((root) => (
      [root, ...root.querySelectorAll("*")]
        .filter((element) => element instanceof HTMLElement && element.className)
        .map((element) => ({
          className: element.className,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          overflowY: getComputedStyle(element).overflowY
        }))
    ));
    throw new Error(`成交明细虚拟列表无法滚动浏览后续数据：${JSON.stringify(boxes)}`);
  }
}

/** 用可控 WebSocket 推送两轮变化，证明页面消费的是增量流而非重复 HTTP 快照。 */
async function installRealtimeSocket(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__fqgateRealtimeQa = { connections: 0, closes: 0, subscriptions: [] };
    let subscriptionId = 0;

    class FakeMarketWebSocket {
      readyState = 0;
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        window.__fqgateRealtimeQa.connections += 1;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
        }, 0);
      }

      send(raw) {
        const request = JSON.parse(String(raw));
        if (request.action !== "subscribe") return;
        window.__fqgateRealtimeQa.subscriptions.push(request.kind);
        const id = ++subscriptionId;
        this.emit({ event: "subscribed", subscription_id: id, kind: request.kind });
        if (request.kind === "quote") {
          this.emitData(request.kind, quotePayload(10.20, 20_100), 120);
          this.emitData(request.kind, quotePayload(10.31, 20_300), 720);
        } else if (request.kind === "intraday") {
          this.emitData(request.kind, intradayPayload(10.31, 20_300), 760);
        } else if (request.kind === "level2_depth") {
          this.emitData(request.kind, depthPayload(8_888), 160);
          this.emitData(request.kind, depthPayload(9_999), 780);
        } else if (request.kind === "transaction_detail") {
          this.emitData(
            request.kind,
            { semantic_records: [[semanticPayload(99, 10.29, 600, Date.now())]] },
            820
          );
        }
      }

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        window.__fqgateRealtimeQa.closes += 1;
        this.onclose?.({ code: 1000, reason: "panel hidden" });
      }

      emit(message) {
        setTimeout(() => {
          if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
        }, 0);
      }

      emitData(kind, data, delay) {
        setTimeout(() => {
          if (this.readyState === 1) {
            this.onmessage?.({ data: JSON.stringify({ event: "data", kind, code: 0, data }) });
          }
        }, delay);
      }
    }

    function fieldPayload(value) {
      return { type: typeof value === "number" && Number.isInteger(value) ? "integer" : "float", value };
    }

    function quotePayload(price, volume) {
      return { records: [[{
        "5": fieldPayload("USHA600151"), "6": fieldPayload(10), "7": fieldPayload(10.02),
        "8": fieldPayload(10.35), "9": fieldPayload(9.99), "10": fieldPayload(price),
        "13": fieldPayload(volume), "19": fieldPayload(volume * price),
        "1968584": fieldPayload(price === 10.31 ? 2.35 : 2.31)
      }]] };
    }

    function intradayPayload(price, volume) {
      return { records: [[{
        "1": fieldPayload(Math.floor(Date.now() / 1_000)), "10": fieldPayload(price),
        "13": fieldPayload(volume), "19": fieldPayload(volume * price)
      }]] };
    }

    function depthPayload(volume) {
      return {
        depth: [{
          security: "USHA600151",
          bids: Array.from({ length: 10 }, (_, index) => ({
            level: index + 1, price: 10.30 - index * 0.01, volume: index === 0 ? volume : 2_000 + index
          })),
          asks: Array.from({ length: 10 }, (_, index) => ({
            level: index + 1, price: 10.32 + index * 0.01, volume: 3_000 + index
          }))
        }]
      };
    }

    function semanticPayload(id, price, volume, timestamp) {
      return {
        values: {
          source_tick_id: fieldPayload(id), price: fieldPayload(price), volume: fieldPayload(volume)
        },
        derived: { side: "buy", timestamp: { unix_milliseconds: timestamp } }
      };
    }

    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        return String(args[0]).includes("/v1/market/stream")
          ? new FakeMarketWebSocket()
          : Reflect.construct(Target, args);
      }
    });
  });
}

function apiResponse(data) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "操作成功", data })
  };
}

function field(value) {
  return { type: typeof value === "number" && Number.isInteger(value) ? "integer" : "float", value };
}

function depthLevels(startPrice, step, startVolume) {
  return Array.from({ length: 10 }, (_, index) => ({
    level: index + 1,
    price: Number((startPrice + step * index).toFixed(2)),
    volume: startVolume + index * 100
  }));
}

function semanticTransaction(id, price, volume, side, timestamp) {
  return {
    values: { source_tick_id: field(id), price: field(price), volume: field(volume) },
    derived: { side, timestamp: { unix_milliseconds: timestamp } }
  };
}
