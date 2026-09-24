import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";
import {
  assertCommonComponentFrame,
  assertConnectionMask
} from "./component-frame.qa.mjs";

const targetUrl = "http://127.0.0.1:18792/?component=candle&interval=day";
const outputDirectory = resolve("..", "..", ".tmp", "ui-apps-qa");

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  const requests = [];
  const marketDetailRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(history\/(depth|tick)|level2\/(depth|transactions))$/.test(path)) {
      marketDetailRequests.push(path);
    }
  });
  const recordMarketRequest = async (route) => {
    const body = route.request().postDataJSON();
    requests.push({
      path: new URL(route.request().url()).pathname,
      body,
      serverTimeout: route.request().headers()["x-request-timeout-ms"]
    });
    if (body.interval === "5m") await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    await route.continue();
  };
  await page.route("**/v1/market/history/klines", recordMarketRequest);
  await page.route("**/v1/market/history/intraday", recordMarketRequest);
  await page.route("**/v1/market/history/minute-snapshot", recordMarketRequest);
  const oneMinuteReady = page.waitForResponse((response) => {
    if (!response.ok() || !response.url().includes("/v1/market/history/klines")) return false;
    return response.request().postDataJSON()?.interval === "1m";
  }, { timeout: 35_000 })
    .then((response) => ({ response, receivedAt: Date.now() }))
    .catch((error) => error);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".candle-panel").waitFor();
  await page.getByText("航天机电", { exact: true }).waitFor();
  await page.getByText("个股行情", { exact: true }).first().waitFor();
  await waitForPanelOutcome(page, diagnostics);
  await waitForMarketDepthOutcome(page);
  await assertPeriodNavigation(page);
  await assertQuoteHeaderSingleRow(page);
  assertKlineRequest(findKlineRequest(requests, "day"), "day");
  await assertPanelState(page);
  await assertMarketDepthPanel(page, "right", marketDetailRequests);
  await assertPreviewFrame(page);
  await assertViewportFit(page);
  await assertSmallControls(page);
  await assertCommonComponentFrame(page, ".candle-panel");
  await assertRefreshUpdatesMarketDepth(page, marketDetailRequests);

  const settledHeight = await elementHeight(page, ".component-frame");
  const settledRefreshWidth = await elementWidth(page, "button[aria-label='刷新数据']");
  await page.getByText("五日", { exact: true }).click();
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "visible" });
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "hidden", timeout: 35_000 });
  assertFiveDayRequests(requests);
  await page.getByText("五日走势", { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "desktop-five-day-candle.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });

  await selectMorePeriod(page, "5分");
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "visible" });
  if (!await page.getByText("日K", { exact: true }).isEnabled()) {
    throw new Error("行情加载时不应锁死其他周期按钮。");
  }
  const loadingHeight = await elementHeight(page, ".component-frame");
  const loadingRefreshWidth = await elementWidth(page, "button[aria-label='刷新数据']");
  if (settledHeight !== loadingHeight) {
    throw new Error(`切换周期导致组件跳动：before=${settledHeight}, loading=${loadingHeight}`);
  }
  if (settledRefreshWidth !== loadingRefreshWidth) {
    throw new Error(`刷新状态导致按钮宽度变化：before=${settledRefreshWidth}, loading=${loadingRefreshWidth}`);
  }
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "hidden" });
  assertKlineRequest(findKlineRequest(requests, "5m"), "5m");
  await assertRealTimeLabel(page);

  const dayRequestCount = countKlineRequests(requests, "day");
  const cachedDayStarted = Date.now();
  await page.getByText("日K", { exact: true }).click();
  await waitForLatestInterval(page, "日 K");
  if (Date.now() - cachedDayStarted > 500) throw new Error("缓存周期切换超过 500ms。");
  if (countKlineRequests(requests, "day") !== dayRequestCount) {
    throw new Error("返回新鲜的日 K 缓存时不应重复请求接口。");
  }

  const oneMinuteResponse = await oneMinuteReady;
  if (oneMinuteResponse instanceof Error) throw oneMinuteResponse;
  const oneMinuteCacheIsFresh = Date.now() - oneMinuteResponse.receivedAt < 30_000;
  const oneMinuteRequestCount = countKlineRequests(requests, "1m");
  const cachedMinuteStarted = Date.now();
  await selectMorePeriod(page, "1分");
  await waitForLatestInterval(page, "1 分钟");
  if (Date.now() - cachedMinuteStarted > 500) throw new Error("预取后的 1 分 K 切换超过 500ms。");
  if (oneMinuteCacheIsFresh && countKlineRequests(requests, "1m") !== oneMinuteRequestCount) {
    throw new Error("1 分 K 已预取完成，点击时不应再次请求接口。");
  }

  await page.getByText("分时", { exact: true }).click();
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "visible" });
  await page.locator(".chart-overlay .arco-spin").waitFor({ state: "hidden" });
  assertIntradayRequest(requests.at(-1));
  await page.getByText("分时价格", { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "desktop-candle.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await assertViewportFit(page);
  await assertPreviewFrame(page);
  await assertCommonComponentFrame(page, ".candle-panel");
  await assertPeriodNavigation(page);
  await assertQuoteHeaderSingleRow(page);
  await assertMarketDepthPanel(page, "below", marketDetailRequests);
  await page.screenshot({
    path: resolve(outputDirectory, "mobile-candle.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });

  await assertLevel2MarketDepthSelection(browser);
  await assertAutomaticRecovery(browser);

  process.stdout.write(`K 线组件验收通过，截图目录：${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function assertAutomaticRecovery(browser) {
  const recoveryPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let dayRequests = 0;
  let serviceLostAt = 0;
  const healthRequestTimes = [];
  await recoveryPage.route("**/v1/market/history/klines", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.interval !== "day") return route.continue();
    dayRequests += 1;
    if (dayRequests === 1) {
      serviceLostAt = Date.now();
      return route.fulfill({ status: 503, body: "" });
    }
    return route.continue();
  });
  await recoveryPage.route("**/v1/market/health", (route) => {
    healthRequestTimes.push(Date.now());
    return route.continue();
  });
  await recoveryPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await recoveryPage.getByText("正在重连数据服务", { exact: true }).waitFor({ timeout: 5_000 });
  await assertConnectionMask(recoveryPage);
  await recoveryPage.screenshot({
    path: resolve(outputDirectory, "desktop-candle-reconnecting.jpg"),
    type: "jpeg",
    quality: 88
  });
  await waitFor(
    () => healthRequestTimes.some((time) => time - serviceLostAt >= 2_500),
    4_500,
    "个股行情失败后没有启动统一健康探测"
  );
  const retryDelay = healthRequestTimes.find((time) => time - serviceLostAt >= 2_500) - serviceLostAt;
  if (retryDelay < 2_700 || retryDelay > 4_000) {
    throw new Error(`个股行情统一重连间隔不符合 3 秒约定：delay=${retryDelay}`);
  }
  await waitFor(() => dayRequests >= 2, 35_000, "数据服务恢复后个股行情没有自动重载");
  await recoveryPage.getByText("正在重连数据服务", { exact: true }).waitFor({
    state: "hidden",
    timeout: 35_000
  });
  await recoveryPage.locator(".chart canvas").first().waitFor({ timeout: 35_000 });
  await recoveryPage.screenshot({
    path: resolve(outputDirectory, "desktop-candle-recovered.jpg"),
    type: "jpeg",
    quality: 88
  });
  await recoveryPage.close();
}

async function assertLevel2MarketDepthSelection(browser) {
  const level2Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installPassiveRealtimeSocket(level2Page, false);
  const level2Requests = [];
  level2Page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(history\/(depth|tick)|level2\/(depth|transactions))$/.test(path)) {
      level2Requests.push(path);
    }
  });
  await routeHealth(level2Page, true);
  await level2Page.route("**/v1/market/level2/depth", (route) => route.fulfill(apiResponse({
    depth: [{
      security: "USHA600151",
      bids: depthLevels(10.15, -0.01, 12_000),
      asks: depthLevels(10.16, 0.01, 11_000)
    }],
    records: []
  })));
  const level2Transactions = Array.from({ length: 500 }, (_, index) => semanticTransaction(
    500 - index,
    index === 0 ? 10.17 : 10.16,
    900 + index,
    index % 2 === 0 ? "buy" : "sell",
    1_789_009_202_000 - index * 1_000
  ));
  await level2Page.route("**/v1/market/level2/transactions", (route) => route.fulfill(apiResponse({
    records: [],
    semantic_records: [level2Transactions]
  })));
  await level2Page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await waitForMarketDepthOutcome(level2Page);
  await level2Page.locator(".depth-section").getByText("L2", { exact: true }).waitFor();
  await level2Page.getByText("盘口", { exact: true }).waitFor();
  await level2Page.getByText("卖10", { exact: true }).waitFor({ state: "attached" });
  await level2Page.getByText("买10", { exact: true }).waitFor({ state: "attached" });
  await level2Page.getByText("10.17", { exact: true }).last().waitFor();
  await assertLevel2DepthScrolling(level2Page);
  await assertTransactionVirtualScroll(level2Page);
  assertPermissionSelectedEndpoints("level2", level2Requests);
  await level2Page.screenshot({
    path: resolve(outputDirectory, "desktop-candle-level2.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });
  await level2Page.close();

  const fallbackPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installPassiveRealtimeSocket(fallbackPage, true);
  const fallbackRequests = [];
  fallbackPage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(history\/(depth|tick)|level2\/(depth|transactions))$/.test(path)) {
      fallbackRequests.push(path);
    }
  });
  await routeHealth(fallbackPage, true);
  const denyLevel2 = (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ code: 3006, message: "当前账户未开通所需行情权限", data: {} })
  });
  await fallbackPage.route("**/v1/market/level2/depth", denyLevel2);
  await fallbackPage.route("**/v1/market/level2/transactions", denyLevel2);
  await routeBasicMarketDetails(fallbackPage);
  await fallbackPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await waitForMarketDepthOutcome(fallbackPage);
  const fallbackModeTag = fallbackPage.locator(".depth-section").getByText("普通", { exact: true });
  await fallbackModeTag.waitFor();
  await fallbackModeTag.hover();
  await fallbackPage.getByText("登录同花顺查看L2", { exact: true }).waitFor();
  for (const path of [
    "/v1/market/level2/depth",
    "/v1/market/level2/transactions",
    "/v1/market/history/depth",
    "/v1/market/history/tick"
  ]) {
    if (!fallbackRequests.includes(path)) {
      throw new Error(`Level-2 权限变化后没有完整回退普通行情：${JSON.stringify(fallbackRequests)}`);
    }
  }
  await fallbackPage.screenshot({
    path: resolve(outputDirectory, "desktop-candle-basic-fallback.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });
  await fallbackPage.close();
}

async function assertLevel2DepthScrolling(page) {
  const layout = await page.evaluate(() => {
    const section = document.querySelector(".depth-section");
    const sell = document.querySelector(".sell-side");
    const buy = document.querySelector(".buy-side");
    const divider = document.querySelector(".depth-divider");
    if (!(section instanceof HTMLElement)
      || !(sell instanceof HTMLElement)
      || !(buy instanceof HTMLElement)
      || !(divider instanceof HTMLElement)) return null;
    const findRow = (viewport, label) => [...viewport.querySelectorAll(".data-row")]
      .find((row) => row.firstElementChild?.textContent?.trim() === label)
      ?.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();
    return {
      sectionHeight: section.getBoundingClientRect().height,
      sellClientHeight: sell.clientHeight,
      sellScrollHeight: sell.scrollHeight,
      sellScrollTop: sell.scrollTop,
      buyClientHeight: buy.clientHeight,
      buyScrollHeight: buy.scrollHeight,
      buyScrollTop: buy.scrollTop,
      sellOneBottom: findRow(sell, "卖1")?.bottom,
      buyOneTop: findRow(buy, "买1")?.top,
      dividerTop: dividerRect.top,
      dividerBottom: dividerRect.bottom
    };
  });
  if (!layout) throw new Error("L2 盘口滚动区域未渲染。");
  if (layout.sectionHeight !== 205) {
    throw new Error(`L2 盘口不应改变原有高度：${JSON.stringify(layout)}`);
  }
  if (layout.sellScrollHeight <= layout.sellClientHeight || layout.buyScrollHeight <= layout.buyClientHeight) {
    throw new Error(`L2 十档未提供滚动区域：${JSON.stringify(layout)}`);
  }
  const sellAtBottom = Math.abs(
    layout.sellScrollHeight - layout.sellClientHeight - layout.sellScrollTop
  ) <= 1;
  if (!sellAtBottom || layout.buyScrollTop !== 0) {
    throw new Error(`卖盘未滚至底部或买盘未停在顶部：${JSON.stringify(layout)}`);
  }
  if (Math.abs(layout.sellOneBottom - layout.dividerTop) > 1
    || Math.abs(layout.buyOneTop - layout.dividerBottom) > 1) {
    throw new Error(`卖一、买一未紧邻中间分隔线：${JSON.stringify(layout)}`);
  }
}

async function assertTransactionVirtualScroll(page) {
  const viewport = page.locator(".arco-virtual-list");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  const layout = await viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll(".details-list-item")]
      .map((row) => row.getBoundingClientRect())
      .filter((rect) => rect.bottom > viewportRect.top && rect.top < viewportRect.bottom);
    const last = rows.at(-1);
    return {
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
      visibleRows: rows.length,
      bottomGap: last ? viewportRect.bottom - last.bottom : viewportRect.height
    };
  });
  if (Math.abs(layout.scrollTop - layout.maxScrollTop) > 1
    || layout.visibleRows === 0
    || layout.bottomGap > 1) {
    throw new Error(`成交明细滚到底部出现空白：${JSON.stringify(layout)}`);
  }
}

async function installPassiveRealtimeSocket(page, denyLevel2) {
  await page.addInitScript((shouldDenyLevel2) => {
    const NativeWebSocket = window.WebSocket;
    let subscriptionId = 0;
    let permissionNoticeSent = false;
    class PassiveMarketWebSocket {
      readyState = 0;
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
        }, 0);
      }

      send(raw) {
        const request = JSON.parse(String(raw));
        if (request.action !== "subscribe") return;
        if (
          shouldDenyLevel2
          && !permissionNoticeSent
          && (request.kind === "level2_depth" || request.kind === "transaction_detail")
        ) {
          permissionNoticeSent = true;
          this.emit({ event: "notice", code: 3006, message: "当前账户未开通所需行情权限" });
          return;
        }
        this.emit({
          event: "subscribed",
          subscription_id: ++subscriptionId,
          kind: request.kind
        });
      }

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code: 1000 });
      }

      emit(message) {
        setTimeout(() => {
          if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
        }, 0);
      }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        return String(args[0]).includes("/v1/market/stream")
          ? new PassiveMarketWebSocket()
          : Reflect.construct(Target, args);
      }
    });
  }, denyLevel2);
}

async function routeHealth(page, level2Permission) {
  await page.route("**/v1/market/health", (route) => route.fulfill(apiResponse({
    connected: true,
    network_ready: true,
    level2_permission: level2Permission,
    status: "ok"
  })));
}

async function routeBasicMarketDetails(page) {
  await page.route("**/v1/market/history/depth", (route) => route.fulfill(apiResponse({
    records: [[{
      "24": field(10.15), "25": field(12_000),
      "26": field(10.14), "27": field(11_000),
      "28": field(10.13), "29": field(10_000),
      "150": field(10.12), "151": field(9_000),
      "154": field(10.11), "155": field(8_000),
      "30": field(10.16), "31": field(7_000),
      "32": field(10.17), "33": field(6_000),
      "34": field(10.18), "35": field(5_000),
      "152": field(10.19), "153": field(4_000),
      "156": field(10.20), "157": field(3_000)
    }]]
  })));
  await page.route("**/v1/market/history/tick", (route) => route.fulfill(apiResponse({
    records: [[
      basicTransaction(1_789_009_200, 10.15, 1_200, 5),
      basicTransaction(1_789_009_201, 10.16, 800, 1)
    ]]
  })));
}

function apiResponse(data) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "操作成功", data })
  };
}

function depthLevels(startPrice, step, startVolume) {
  return Array.from({ length: 10 }, (_, index) => ({
    level: index + 1,
    price: Number((startPrice + step * index).toFixed(2)),
    volume: startVolume + index * 1_000
  }));
}

function field(value) {
  return { type: Number.isInteger(value) ? "integer" : "float", value };
}

function semanticTransaction(id, price, volume, side, timestamp) {
  return {
    values: {
      source_tick_id: field(id),
      price: field(price),
      volume: field(volume)
    },
    derived: {
      side,
      timestamp: { unix_milliseconds: timestamp }
    }
  };
}

function basicTransaction(timestamp, price, volume, side) {
  return {
    "1": field(timestamp),
    "10": field(price),
    "12": field(side),
    "49": field(volume)
  };
}

async function waitFor(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  if (!predicate()) throw new Error(message);
}

async function assertPanelState(page) {
  const chartStageHeight = await elementHeight(page, ".chart-stage");
  if (chartStageHeight !== 510) throw new Error(`桌面图表区域高度异常：${chartStageHeight}`);

  const outcome = await page.evaluate(() => ({
    hasCanvas: Boolean(document.querySelector(".chart canvas")),
    error: document.querySelector(".chart-overlay .arco-typography")?.textContent?.trim() ?? ""
  }));
  if (!outcome.hasCanvas && !outcome.error) throw new Error("K 线组件既未绘图，也未显示真实接口错误。");
}

async function assertMarketDepthPanel(page, placement, requests) {
  const result = await page.evaluate(() => {
    const chart = document.querySelector(".chart-panel");
    const preview = document.querySelector(".market-depth-panel");
    if (!(chart instanceof HTMLElement) || !(preview instanceof HTMLElement)) return null;
    const chartRect = chart.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const sellSide = preview.querySelector(".sell-side")?.getBoundingClientRect();
    const buySide = preview.querySelector(".buy-side")?.getBoundingClientRect();
    const divider = preview.querySelector(".depth-divider")?.getBoundingClientRect();
    return {
      chart: {
        top: chartRect.top,
        right: chartRect.right,
        bottom: chartRect.bottom
      },
      preview: {
        top: previewRect.top,
        left: previewRect.left,
        right: previewRect.right
      },
      text: preview.textContent?.replace(/\s+/g, " ").trim() ?? "",
      mode: preview.dataset.mode,
      sellHeight: sellSide?.height ?? 0,
      buyHeight: buySide?.height ?? 0,
      dividerHeight: divider?.height ?? 0,
      viewportWidth: document.documentElement.clientWidth
    };
  });

  if (!result) throw new Error("盘口和成交明细未渲染。");
  for (const label of ["盘口", "卖5", "卖1", "买1", "买5", "成交明细"]) {
    if (!result.text.includes(label)) throw new Error(`盘口缺少“${label}”：${result.text}`);
  }
  if (Math.abs(result.sellHeight - result.buyHeight) > 1 || result.dividerHeight !== 5) {
    throw new Error(`买卖盘未上下均分或分割线不是 5px：${JSON.stringify(result)}`);
  }
  if (result.preview.right > result.viewportWidth + 1) {
    throw new Error(`盘口超出视口：${JSON.stringify(result)}`);
  }
  assertPermissionSelectedEndpoints(result.mode, requests);
  if (placement === "right") {
    if (
      Math.abs(result.preview.top - result.chart.top) > 1
      || Math.abs(result.preview.left - result.chart.right) > 1
    ) throw new Error(`桌面盘口没有位于 K 线右侧：${JSON.stringify(result)}`);
  } else if (result.preview.top < result.chart.bottom - 1) {
    throw new Error(`窄屏盘口没有移动到 K 线下方：${JSON.stringify(result)}`);
  }
}

function assertPermissionSelectedEndpoints(mode, requests) {
  const expected = mode === "level2"
    ? ["/v1/market/level2/depth", "/v1/market/level2/transactions"]
    : ["/v1/market/history/depth", "/v1/market/history/tick"];
  const unexpected = mode === "level2"
    ? ["/v1/market/history/depth", "/v1/market/history/tick"]
    : ["/v1/market/level2/depth", "/v1/market/level2/transactions"];
  if (expected.some((path) => !requests.includes(path)) || unexpected.some((path) => requests.includes(path))) {
    throw new Error(`盘口没有按权限选择接口：${JSON.stringify({ mode, requests })}`);
  }
}

async function waitForMarketDepthOutcome(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".market-depth-panel");
    return panel?.getAttribute("data-mode") !== "loading"
      || Boolean(panel?.querySelector("[role='alert']"));
  }, undefined, { timeout: 35_000 });
  const error = await page.locator(".market-depth-panel [role='alert']").textContent().catch(() => "");
  if (error) throw new Error(`盘口与成交明细接口读取失败：${error.trim()}`);
}

async function assertRefreshUpdatesMarketDepth(page, requests) {
  const requestCount = requests.length;
  const settledHeight = await elementHeight(page, ".component-frame");
  await page.getByRole("button", { name: "刷新数据" }).click();
  await waitFor(
    () => requests.length >= requestCount + 2,
    8_000,
    "刷新个股行情时没有同步刷新盘口和成交明细"
  );
  await page.waitForFunction(() => !document.querySelector(
    ".market-depth-panel > .status-overlay .arco-spin, .depth-section .section-title-row .arco-spin"
  ), undefined, {
    timeout: 35_000
  });
  const refreshedHeight = await elementHeight(page, ".component-frame");
  if (settledHeight !== refreshedHeight) {
    throw new Error(`刷新盘口导致组件跳动：before=${settledHeight}, after=${refreshedHeight}`);
  }
}

async function waitForPanelOutcome(page, diagnostics = []) {
  try {
    await page.waitForFunction(() => (
      Boolean(document.querySelector(".chart canvas"))
      || Boolean(document.querySelector(".chart-overlay .arco-typography"))
    ), undefined, { timeout: 25_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      panel: Boolean(document.querySelector(".candle-panel")),
      overlay: document.querySelector(".chart-overlay")?.textContent?.trim() ?? "",
      body: document.body.innerText.slice(0, 600)
    }));
    throw new Error(`K 线加载未结束：${JSON.stringify({ ...state, diagnostics })}`, { cause: error });
  }
}

function assertKlineRequest(request, interval) {
  if (!request) throw new Error("页面没有请求 FQGate K 线接口。");
  const expected = { market: "USHA", code: "600151", count: 160, adjust: "", interval };
  if (request.path !== "/v1/market/history/klines" || JSON.stringify(request.body) !== JSON.stringify(expected)) {
    throw new Error(`K 线请求参数异常：${JSON.stringify(request)}`);
  }
  if (request.serverTimeout !== "30000") {
    throw new Error(`K 线请求未与 FQGate 超时预算对齐：${JSON.stringify(request)}`);
  }
}

function findKlineRequest(requests, interval) {
  return requests.find((request) => request.body?.interval === interval);
}

function countKlineRequests(requests, interval) {
  return requests.filter((request) => request.body?.interval === interval).length;
}

function assertIntradayRequest(request) {
  const expected = { market: "USHA", code: "600151" };
  if (
    !request
    || request.path !== "/v1/market/history/intraday"
    || JSON.stringify(request.body) !== JSON.stringify(expected)
  ) throw new Error(`分时请求参数异常：${JSON.stringify(request)}`);
}

async function assertPeriodNavigation(page) {
  const labels = await page.locator(".period-control label").allTextContents();
  const normalized = labels.map((label) => label.trim()).filter(Boolean);
  const expected = ["分时", "日K", "周K", "月K", "五日"];
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`周期顺序异常：${JSON.stringify(normalized)}`);
  }
  await page.getByRole("button", { name: "更多", exact: true }).waitFor();
}

async function assertQuoteHeaderSingleRow(page) {
  const result = await page.evaluate(() => {
    const header = document.querySelector(".quote-header");
    const identity = document.querySelector(".quote-header .identity");
    const toolbar = document.querySelector(".quote-header .toolbar");
    if (!(header instanceof HTMLElement)
      || !(identity instanceof HTMLElement)
      || !(toolbar instanceof HTMLElement)) return null;

    const headerRect = header.getBoundingClientRect();
    const identityRect = identity.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      topDifference: Math.abs(identityRect.top - toolbarRect.top),
      toolbarInsideHeader: toolbarRect.right <= headerRect.right + 1,
      toolbarWidth: toolbarRect.width
    };
  });

  if (!result
    || result.topDifference > 1
    || !result.toolbarInsideHeader
    || result.toolbarWidth <= 0) {
    throw new Error(`行情信息和周期栏不在同一行：${JSON.stringify(result)}`);
  }
}

async function selectMorePeriod(page, label) {
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByText(label, { exact: true }).last().click();
}

function assertFiveDayRequests(requests) {
  const daily = requests.find((request) => (
    request.path === "/v1/market/history/klines"
    && request.body?.interval === "day"
    && request.body?.count === 5
  ));
  const snapshots = requests.filter((request) => request.path === "/v1/market/history/minute-snapshot");
  if (!daily || snapshots.length !== 5) {
    throw new Error(`五日走势没有按五个真实交易日查询：${JSON.stringify({ daily, snapshots })}`);
  }
  if (snapshots.some((request) => !/^\d{8}$/.test(request.body?.date ?? ""))) {
    throw new Error(`五日走势的交易日参数异常：${JSON.stringify(snapshots)}`);
  }
}

async function assertSmallControls(page) {
  const refresh = page.getByRole("button", { name: "刷新数据" });
  const height = await refresh.evaluate(
    (element) => element.getBoundingClientRect().height
  );
  const width = await refresh.evaluate((element) => element.getBoundingClientRect().width);
  if (height !== 27 || width !== 28) throw new Error(`刷新按钮没有使用顶栏标准尺寸：${width}x${height}`);
}

async function assertRealTimeLabel(page) {
  if (!await page.locator(".chart canvas").count()) return;
  const label = (await page.locator(".latest-time").textContent())?.trim() ?? "";
  if (!/^20\d{2}\//.test(label)) throw new Error(`分钟 K 时间解析异常：${label}`);
}

async function waitForLatestInterval(page, label) {
  await page.waitForFunction((expected) => (
    document.querySelector(".latest-time")?.textContent?.includes(expected)
  ), label);
}

async function assertPreviewFrame(page) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector(".preview-canvas");
    const panel = document.querySelector(".candle-panel");
    if (!(canvas instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;
    const canvasStyle = getComputedStyle(canvas);
    const availableWidth = canvas.clientWidth
      - Number.parseFloat(canvasStyle.paddingLeft)
      - Number.parseFloat(canvasStyle.paddingRight);
    return {
      borderWidth: Number.parseFloat(canvasStyle.borderTopWidth),
      padding: Number.parseFloat(canvasStyle.paddingTop),
      availableWidth,
      panelWidth: panel.getBoundingClientRect().width
    };
  });
  if (
    !result
    || result.borderWidth !== 10
    || result.padding !== 0
    || Math.abs(result.availableWidth - result.panelWidth) > 1
  ) {
    throw new Error(`预览区或组件宽度不符合要求：${JSON.stringify(result)}`);
  }
}

async function assertViewportFit(page) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  if (result.scrollWidth > result.viewportWidth) {
    throw new Error(`页面存在横向裁切：${JSON.stringify(result)}`);
  }
}

async function elementHeight(page, selector) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
}

async function elementWidth(page, selector) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);
}
