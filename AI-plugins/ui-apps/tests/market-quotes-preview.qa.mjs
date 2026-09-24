import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";
import {
  assertCommonComponentFrame,
  assertConnectionMask,
  assertRealtimeStatus
} from "./component-frame.qa.mjs";

const targetUrl = "http://127.0.0.1:18792/?component=market-quotes";
const outputDirectory = resolve("..", "..", ".tmp", "ui-apps-qa");

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const quoteRequests = [];
  const activeBeforePage = await activeSubscriptionCount(page);
  await page.route("**/v1/market/realtime/quote", async (route) => {
    quoteRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".preview-sidebar").getByText("多股行情", { exact: true }).click();
  await page.locator(".market-quotes-panel").waitFor();
  await waitFor(() => quoteRequests.length >= 2, 10_000, "未发起完整的批量行情请求");

  await assertRealRequestBatches(quoteRequests);
  await assertRowsOrRealError(page);
  await assertSecurityNamesReadable(page);
  await assertPreviewFrame(page);
  await assertViewportFit(page);
  await assertCommonComponentFrame(page, ".market-quotes-panel");
  await assertRealtimeStatus(page);
  if (await page.getByRole("button", { name: "刷新数据" }).count()) {
    throw new Error("实时行情组件不应保留手动刷新按钮");
  }

  const activeWithPanel = await waitForActiveSubscriptions(
    page,
    (count) => count > activeBeforePage,
    "多股行情实时订阅没有建立"
  );
  await page.screenshot({
    path: resolve(outputDirectory, "desktop-market-quotes.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });

  await page.locator(".preview-sidebar").getByText("登录", { exact: true }).click();
  await page.waitForTimeout(2_000);
  const activeDuringGracePeriod = await activeSubscriptionCount(page);
  if (activeDuringGracePeriod < activeWithPanel) {
    throw new Error("多股行情刚隐藏就断开了订阅，没有保留 10 秒宽限期");
  }
  const activeAfterHidden = await waitForActiveSubscriptions(
    page,
    (count) => count < activeWithPanel,
    "多股行情隐藏 10 秒后订阅数没有减少",
    10_000
  );
  await page.locator(".preview-sidebar").getByText("多股行情", { exact: true }).click();
  await waitForActiveSubscriptions(
    page,
    (count) => count > activeAfterHidden,
    "多股行情恢复可见后没有自动重连"
  );

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobilePage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await mobilePage.locator(".preview-sidebar").getByText("多股行情", { exact: true }).click();
  await mobilePage.locator(".market-quotes-panel").waitFor();
  await assertPreviewFrame(mobilePage);
  await assertViewportFit(mobilePage);
  await assertToolbarSingleLine(mobilePage);
  await assertCommonComponentFrame(mobilePage, ".market-quotes-panel");
  await mobilePage.screenshot({
    path: resolve(outputDirectory, "mobile-market-quotes.jpg"),
    type: "jpeg",
    quality: 88,
    fullPage: true
  });

  await assertAutomaticRecovery(browser);

  process.stdout.write(`多股行情组件验收通过，截图目录：${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function assertAutomaticRecovery(browser) {
  const recoveryPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let shanghaiRequests = 0;
  let serviceLostAt = 0;
  const healthRequestTimes = [];
  await recoveryPage.route("**/v1/market/realtime/quote", async (route) => {
    const body = route.request().postDataJSON();
    const market = body?.securities?.[0]?.market;
    if (market !== "USHA") return route.continue();
    shanghaiRequests += 1;
    if (shanghaiRequests === 1) {
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
    path: resolve(outputDirectory, "desktop-market-quotes-reconnecting.jpg"),
    type: "jpeg",
    quality: 88
  });
  await waitFor(
    () => healthRequestTimes.length >= 1,
    4_500,
    "多股行情失败后没有启动统一健康探测"
  );
  const retryDelay = healthRequestTimes[0] - serviceLostAt;
  if (retryDelay < 2_700 || retryDelay > 4_000) {
    throw new Error(`多股行情统一重连间隔不符合 3 秒约定：delay=${retryDelay}`);
  }
  await waitFor(
    () => shanghaiRequests >= 2,
    15_000,
    "数据服务恢复后多股行情没有自动重新读取快照"
  );
  await recoveryPage.getByText("正在重连数据服务", { exact: true }).waitFor({
    state: "hidden",
    timeout: 15_000
  });
  await recoveryPage.getByText("已连接", { exact: true }).waitFor({ timeout: 15_000 });
  await recoveryPage.screenshot({
    path: resolve(outputDirectory, "desktop-market-quotes-recovered.jpg"),
    type: "jpeg",
    quality: 88
  });
  await recoveryPage.close();
}

async function assertRealRequestBatches(requests) {
  if (requests.length < 2) throw new Error(`未按市场批量请求真实行情：${JSON.stringify(requests)}`);
  const markets = new Set();
  for (const request of requests) {
    if (!Array.isArray(request?.securities) || request.securities.length === 0) {
      throw new Error(`行情请求没有证券列表：${JSON.stringify(request)}`);
    }
    const batchMarkets = new Set(request.securities.map((item) => item.market));
    if (batchMarkets.size !== 1) throw new Error(`单次行情请求混入多个市场：${JSON.stringify(request)}`);
    markets.add(request.securities[0].market);
  }
  if (!markets.has("USHA") || !markets.has("USZA")) {
    throw new Error(`预览行情市场不完整：${JSON.stringify([...markets])}`);
  }
}

async function assertRowsOrRealError(page) {
  const result = await page.evaluate(() => ({
    rowCount: document.querySelectorAll(".quote-table .arco-table-tr").length,
    hasPrice: [...document.querySelectorAll(".quote-table .arco-table-td")]
      .some((cell) => /\d+\.\d+/.test(cell.textContent ?? "")),
    connectionText: document.querySelector(".component-connection-status")?.textContent?.trim() ?? ""
  }));
  if (result.rowCount < 7) throw new Error(`证券行数量不足：${JSON.stringify(result)}`);
  if (!result.hasPrice && !["已连接", "已断开", "重连中"].includes(result.connectionText)) {
    throw new Error(`页面既没有真实行情，也没有真实接口错误：${JSON.stringify(result)}`);
  }
}

async function assertSecurityNamesReadable(page) {
  const names = await page.locator(".security-name").allTextContents();
  const corrupt = names.filter((name) => name.includes("�"));
  if (corrupt.length > 0) {
    throw new Error(`实时推送用乱码覆盖了证券名称：${JSON.stringify(corrupt)}`);
  }
}

async function assertToolbarSingleLine(page) {
  const result = await page.evaluate(() => {
    const toolbar = document.querySelector(".quote-toolbar");
    const title = document.querySelector(".quote-toolbar .arco-typography");
    const count = document.querySelector(".quote-toolbar .arco-tag");
    if (!(toolbar instanceof HTMLElement) || !(title instanceof HTMLElement) || !(count instanceof HTMLElement)) {
      return null;
    }
    const toolbarRect = toolbar.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    return {
      toolbarHeight: toolbarRect.height,
      centerDifference: Math.abs(
        (titleRect.top + titleRect.height / 2) - (countRect.top + countRect.height / 2)
      ),
      countInsideToolbar: countRect.right <= toolbarRect.right && countRect.bottom <= toolbarRect.bottom
    };
  });
  if (
    !result
    || result.toolbarHeight > 52
    || result.centerDifference > 1
    || !result.countInsideToolbar
  ) {
    throw new Error(`窄屏工具栏发生换行：${JSON.stringify(result)}`);
  }
}

async function assertPreviewFrame(page) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector(".preview-canvas");
    const panel = document.querySelector(".market-quotes-panel");
    if (!(canvas instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;
    const style = getComputedStyle(canvas);
    const availableWidth = canvas.clientWidth
      - Number.parseFloat(style.paddingLeft)
      - Number.parseFloat(style.paddingRight);
    return {
      borderWidth: Number.parseFloat(style.borderTopWidth),
      padding: Number.parseFloat(style.paddingTop),
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

async function activeSubscriptionCount(page) {
  const response = await page.request.get("http://127.0.0.1:17281/v1/market/health");
  const payload = await response.json();
  return Number(payload?.data?.active_subscriptions ?? 0);
}

async function waitForActiveSubscriptions(page, predicate, failureMessage, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const count = await activeSubscriptionCount(page);
    if (predicate(count)) return count;
    await page.waitForTimeout(150);
  }
  throw new Error(`${failureMessage}：active_subscriptions=${await activeSubscriptionCount(page)}`);
}

async function waitFor(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!predicate()) throw new Error(message);
}
