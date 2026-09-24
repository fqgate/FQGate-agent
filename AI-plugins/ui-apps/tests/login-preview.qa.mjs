import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";
import { assertCommonComponentFrame } from "./component-frame.qa.mjs";

const targetUrl = "http://127.0.0.1:18792/?component=login";
const outputDirectory = resolve("..", "..", ".tmp", "ui-apps-qa");
const transparentPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const captchaBackground = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="195"><rect width="340" height="195" fill="#dbeafe"/></svg>'
).toString("base64");
const captchaPiece = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="55" height="68"><rect width="55" height="68" fill="#60a5fa"/></svg>'
).toString("base64");

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let qrBeginRequests = 0;
  let qrPollRequests = 0;
  let smsBeginRequests = 0;
  let smsSendCodeBody;
  let serviceLostAt = 0;
  const healthRequestTimes = [];
  await page.route("**/v1/market/session/qr/begin", async (route) => {
    qrBeginRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        data: {
          flow_id: qrBeginRequests,
          qr_image_base64: transparentPng,
          qr_media_type: "image/png",
          status: "waiting_for_scan"
        }
      })
    });
  });
  await page.route("**/v1/market/session/qr/poll", (route) => {
    qrPollRequests += 1;
    if (qrPollRequests === 1) {
      serviceLostAt = Date.now();
      return route.fulfill({ status: 500, body: "" });
    }
    if (qrBeginRequests === 2) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: 1003,
          message: "请求内容不完整或格式不正确，请核对后重试",
          data: null
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        data: { flow_id: qrBeginRequests, status: "waiting_for_scan" }
      })
    });
  });
  await page.route("**/v1/market/health", (route) => {
    // 登录页现在会先读取一次账号状态；重连验收只统计服务丢失后的探活请求。
    if (serviceLostAt !== 0) healthRequestTimes.push(Date.now());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "ok", data: {} })
    });
  });
  await page.route("**/v1/market/session/sms/begin", (route) => {
    smsBeginRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        data: {
          flow_id: 8 + smsBeginRequests,
          captcha: {
            background_image_base64: captchaBackground,
            background_media_type: "image/svg+xml",
            slider_image_base64: captchaPiece,
            slider_media_type: "image/svg+xml",
            initial_x: 60,
            initial_y: 30,
            image_width: 340,
            image_height: 195
          }
        }
      })
    });
  });
  await page.route("**/v1/market/session/sms/send-code", async (route) => {
    smsSendCodeBody = route.request().postDataJSON();
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: 3010, message: "滑块验证未通过，请重新操作", data: null })
    });
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await assertSharedConnectionMonitor(page);

  await page.locator(".preview-sidebar").getByText("登录", { exact: true }).click();
  await page.locator(".login-panel").waitFor();
  await expectText(page, "App 扫码");
  await expectText(page, "短信验证码");
  const windowsBrowser = await page.evaluate(() => /windows|win/i.test(`${navigator.userAgent} ${navigator.platform}`));
  if (windowsBrowser) {
    await page.locator(".arco-tabs-tab-title", { hasText: "本机快捷登录" }).waitFor({ state: "visible" });
    await page.locator(".arco-tabs-tab-title", { hasText: "本机快捷登录" }).click();
    await page.locator(".cached-login-flow input").fill("relative/path");
    await page.getByRole("button", { name: "本机快捷登录" }).click();
    await expectText(page, "请输入同花顺远航版安装目录的绝对路径，例如 E:\\同花顺远航版。");
    await page.locator(".arco-tabs-tab-title", { hasText: "App 扫码" }).click();
  }
  await page.locator(".qr-image").waitFor({ state: "visible" });
  if (qrBeginRequests !== 1) throw new Error(`页面未自动获取二维码：requestCount=${qrBeginRequests}`);
  await assertQrStageHeight(page);
  const settledCardHeight = await elementHeight(page, ".login-panel");
  await page.getByText("无法连接本机 FQGate", { exact: false }).waitFor({ timeout: 3_000 });
  if (await page.locator(".component-connection-mask").count()) {
    throw new Error("登录组件不应把请求失败显示成数据服务重连遮罩");
  }
  await assertQrStageHeight(page);
  const failedCardHeight = await elementHeight(page, ".login-panel");
  if (settledCardHeight !== failedCardHeight) {
    throw new Error(
      `请求失败导致卡片跳动：before=${settledCardHeight}, failed=${failedCardHeight}`
    );
  }
  await assertSmallButton(page);
  await assertViewportFit(page);
  await assertPreviewFrame(page);
  await assertCommonComponentFrame(page, ".login-panel");
  await page.screenshot({
    path: resolve(outputDirectory, "desktop-login-request-error.jpg"),
    type: "jpeg",
    quality: 85
  });

  await waitFor(() => healthRequestTimes.length === 1, 4_500, "未按时探测数据服务健康接口");
  const firstReconnectDelay = healthRequestTimes[0] - serviceLostAt;
  if (firstReconnectDelay < 2_700 || firstReconnectDelay > 4_000) {
    throw new Error(`重连轮询间隔不符合 3 秒约定：delay=${firstReconnectDelay}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (qrBeginRequests !== 1) throw new Error("数据服务状态不应自动改变登录组件请求");
  await page.getByRole("button", { name: "刷新二维码" }).click();
  await waitFor(() => qrBeginRequests === 2, 2_000, "用户刷新后没有重新获取二维码");
  await page.locator(".qr-image").waitFor({ state: "visible" });
  await expectText(page, "二维码已失效，请刷新二维码。", 3_000);
  if (await page.locator(".qr-image").count()) {
    throw new Error("失效二维码仍显示在登录组件中");
  }

  const qrContentHeight = await elementHeight(page, ".qr-flow");
  await page.locator(".arco-tabs-tab-title", { hasText: "短信验证码" }).click();
  const smsContentHeight = await elementHeight(page, ".sms-flow");
  if (qrContentHeight !== 380 || smsContentHeight !== qrContentHeight) {
    throw new Error(`扫码与短信登录内容区高度不一致：qr=${qrContentHeight}, sms=${smsContentHeight}`);
  }
  const phoneInput = page.getByPlaceholder("请输入手机号码");
  await phoneInput.fill("123");
  await page.getByRole("button", { name: "获取验证码" }).click();
  await expectText(page, "请输入 11 位手机号码。");
  await assertSmallInput(page);
  const phoneStageHeight = await elementHeight(page, ".sms-step-stage");
  await phoneInput.fill("13800138000");
  await page.getByRole("button", { name: "获取验证码" }).click();
  await page.locator(".captcha-piece").waitFor({ state: "visible" });
  const finalSliderX = await assertCaptchaLayout(page, phoneStageHeight);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expectText(page, "位置没有对准，已刷新验证图，请重新拖动。");
  if (
    smsBeginRequests !== 2
    || smsSendCodeBody?.flow_id !== 9
    || smsSendCodeBody?.relative_x !== finalSliderX
    || smsSendCodeBody?.relative_y !== 30
  ) {
    throw new Error(`滑块提交的最终坐标或失败刷新异常：${JSON.stringify({
      smsBeginRequests,
      smsSendCodeBody,
      finalSliderX
    })}`);
  }
  await page.screenshot({
    path: resolve(outputDirectory, "desktop-sms-captcha.jpg"),
    type: "jpeg",
    quality: 85
  });

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobilePage.route("**/v1/market/session/qr/begin", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      message: "ok",
      data: {
        flow_id: 1,
        qr_image_base64: transparentPng,
        qr_media_type: "image/png",
        status: "waiting_for_scan"
      }
    })
  }));
  await mobilePage.route("**/v1/market/session/qr/poll", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      message: "ok",
      data: { flow_id: 1, status: "waiting_for_scan" }
    })
  }));
  await mobilePage.route("**/v1/market/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      message: "ok",
      data: { connected: false, account: null, login_method: "guest" }
    })
  }));
  await mobilePage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await mobilePage.locator(".preview-sidebar").getByText("登录", { exact: true }).click();
  await mobilePage.locator(".login-panel").waitFor();
  await mobilePage.locator(".arco-tabs-tab-title", { hasText: "短信验证码" }).click();
  await assertViewportFit(mobilePage);
  await assertPreviewFrame(mobilePage);
  await assertCommonComponentFrame(mobilePage, ".login-panel");
  await mobilePage.screenshot({
    path: resolve(outputDirectory, "mobile-login.jpg"),
    type: "jpeg",
    quality: 85
  });

  process.stdout.write(`登录组件验收通过，截图目录：${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function expectText(page, text, timeout = 5_000) {
  await page.getByText(text, { exact: true }).waitFor({ state: "visible", timeout });
}

async function assertSharedConnectionMonitor(page) {
  const shared = await page.evaluate(async () => {
    const adapters = await import("/src/adapters/local-api/index.ts");
    const services = [
      new adapters.FqgateLoginService(),
      new adapters.FqgateCandleService(),
      new adapters.FqgateMarketQuoteService(),
      new adapters.FqgateOrderFlowService()
    ];
    return services.every((service) => service.connection === services[0].connection);
  });
  if (!shared) throw new Error("行情组件没有共享同一个底层连接监控器");
}

async function waitFor(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!predicate()) throw new Error(message);
}

async function assertSmallButton(page) {
  const button = page.getByRole("button", { name: "刷新二维码" });
  const height = await button.evaluate((element) => element.getBoundingClientRect().height);
  const className = await button.getAttribute("class");
  if (height !== 28 || !className?.includes("arco-btn-size-small")) {
    throw new Error(`按钮没有使用 small 尺寸：height=${height}, class=${className}`);
  }
}

async function assertQrStageHeight(page) {
  const stage = page.locator(".qr-stage");
  const height = await stage.evaluate((element) => element.getBoundingClientRect().height);
  if (height !== 224) throw new Error(`二维码区域高度发生变化：height=${height}`);
}

async function assertCaptchaLayout(page, phoneStageHeight) {
  const instruction = page.getByText("拖动滑块，使拼图对准缺口。", { exact: true });
  if (await instruction.count()) throw new Error("滑块页面仍显示多余的拖动说明");

  const result = await page.evaluate(() => {
    const stage = document.querySelector(".captcha-stage");
    const piece = document.querySelector(".captcha-piece");
    const slider = document.querySelector(".captcha-slider");
    const step = document.querySelector(".sms-step-stage");
    const sliderControl = document.querySelector('[role="slider"]');
    if (
      !(stage instanceof HTMLElement)
      || !(piece instanceof HTMLImageElement)
      || !(slider instanceof HTMLElement)
      || !(step instanceof HTMLElement)
      || !(sliderControl instanceof HTMLElement)
    ) return null;
    const stageRect = stage.getBoundingClientRect();
    const pieceRect = piece.getBoundingClientRect();
    return {
      stepHeight: step.getBoundingClientRect().height,
      stageWidth: stageRect.width,
      sliderWidth: slider.getBoundingClientRect().width,
      pieceLeft: pieceRect.left - stageRect.left,
      pieceTop: pieceRect.top - stageRect.top,
      pieceWidth: pieceRect.width,
      pieceHeight: pieceRect.height,
      borderWidth: getComputedStyle(piece).borderTopWidth,
      outlineWidth: getComputedStyle(piece).outlineWidth,
      sliderMin: sliderControl.getAttribute("aria-valuemin"),
      sliderMax: sliderControl.getAttribute("aria-valuemax"),
      sliderValue: sliderControl.getAttribute("aria-valuenow")
    };
  });
  if (
    !result
    || result.stepHeight !== phoneStageHeight
    || Math.abs(result.stageWidth - result.sliderWidth) > 1
    || Math.abs(result.pieceLeft - 60) > 1
    || Math.abs(result.pieceTop - 30) > 1
    || Math.abs(result.pieceWidth - 55) > 1
    || Math.abs(result.pieceHeight - 68) > 1
    || result.borderWidth !== "0px"
    || result.outlineWidth !== "2px"
    || result.sliderMin !== "0"
    || result.sliderMax !== "285"
    || result.sliderValue !== "60"
  ) {
    throw new Error(`滑块尺寸或坐标映射异常：${JSON.stringify(result)}`);
  }

  const slider = page.locator(".captcha-slider");
  const sliderBox = await slider.boundingBox();
  if (!sliderBox) throw new Error("无法读取滑块位置");
  await slider.click({ position: { x: sliderBox.width / 2, y: sliderBox.height / 2 } });
  await page.waitForFunction(() => document.querySelector('[role="slider"]')?.getAttribute("aria-valuenow") !== "60");
  const moved = await page.evaluate(() => {
    const stage = document.querySelector(".captcha-stage")?.getBoundingClientRect();
    const piece = document.querySelector(".captcha-piece")?.getBoundingClientRect();
    const control = document.querySelector('[role="slider"]');
    return stage && piece ? {
      left: piece.left - stage.left,
      value: control?.getAttribute("aria-valuenow")
    } : null;
  });
  const movedValue = Number(moved?.value);
  if (!moved || !Number.isFinite(movedValue) || movedValue <= 0 || Math.abs(moved.left - movedValue) > 1) {
    throw new Error(`滑块移动与拼图 X 轴不同步：${JSON.stringify(moved)}`);
  }
  return movedValue;
}

async function elementHeight(page, selector) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
}

async function assertSmallInput(page) {
  const height = await page.locator(".login-panel .arco-input-wrapper").last().evaluate(
    (element) => element.getBoundingClientRect().height
  );
  if (height !== 28) throw new Error(`输入框没有使用 small 尺寸：height=${height}`);
}

async function assertViewportFit(page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const panel = document.querySelector(".login-panel")?.getBoundingClientRect();
    return {
      canScrollX: root.scrollWidth > root.clientWidth,
      panelLeft: panel?.left ?? -1,
      panelRight: panel?.right ?? Number.MAX_SAFE_INTEGER,
      viewportWidth: window.innerWidth
    };
  });
  if (result.canScrollX || result.panelLeft < 0 || result.panelRight > result.viewportWidth) {
    throw new Error(`页面存在横向裁切：${JSON.stringify(result)}`);
  }
}

async function assertPreviewFrame(page) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector(".preview-canvas");
    const panel = document.querySelector(".login-panel");
    if (!(canvas instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;
    const canvasStyle = getComputedStyle(canvas);
    const availableWidth = canvas.clientWidth
      - Number.parseFloat(canvasStyle.paddingLeft)
      - Number.parseFloat(canvasStyle.paddingRight);
    return {
      borderWidth: Number.parseFloat(canvasStyle.borderTopWidth),
      availableWidth,
      panelWidth: panel.getBoundingClientRect().width
    };
  });
  if (!result || result.borderWidth !== 10 || Math.abs(result.availableWidth - result.panelWidth) > 1) {
    throw new Error(`预览区边框或组件宽度不符合要求：${JSON.stringify(result)}`);
  }
}
