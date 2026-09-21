export async function assertCommonComponentFrame(page, panelSelector) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const result = await page.locator(".component-frame").evaluate((frame, selector) => {
    const panel = document.querySelector(selector);
    const statusBar = frame.querySelector(".component-status-bar");
    const source = frame.querySelector(".component-source-badge");
    const github = frame.querySelector(".component-open-source-badge");
    if (
      !(panel instanceof HTMLElement)
      || !(statusBar instanceof HTMLElement)
      || !(source instanceof HTMLElement)
      || !(github instanceof HTMLElement)
    ) {
      return null;
    }
    const frameRect = frame.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const githubRect = github.getBoundingClientRect();
    const refresh = frame.querySelector(".component-refresh-button");
    const refreshRect = refresh?.getBoundingClientRect();
    const refreshStyle = refresh ? getComputedStyle(refresh) : undefined;
    const githubStyle = getComputedStyle(github);
    const sourceStyle = getComputedStyle(source);
    const githubAnchor = github instanceof HTMLAnchorElement ? github : github.querySelector("a");
    return {
      frameWidth: frameRect.width,
      panelWidth: panelRect.width,
      statusBarHeight: statusBar.getBoundingClientRect().height,
      sourceText: source.textContent?.trim(),
      githubText: github.textContent?.trim(),
      githubHref: githubAnchor?.getAttribute("href"),
      sourceTop: sourceRect.top - frameRect.top,
      sourceLeft: sourceRect.left - frameRect.left,
      githubTop: githubRect.top - frameRect.top,
      githubGap: githubRect.left - sourceRect.right,
      sourceFontSize: sourceStyle.fontSize,
      githubFontSize: githubStyle.fontSize,
      githubColor: githubStyle.color,
      githubBackground: githubStyle.backgroundColor,
      refresh: refreshRect && refreshStyle ? {
        width: refreshRect.width,
        height: refreshRect.height,
        right: frameRect.right - refreshRect.right,
        borderRadius: refreshStyle.borderRadius,
        borderTopWidth: refreshStyle.borderTopWidth,
        borderBottomWidth: refreshStyle.borderBottomWidth,
        background: refreshStyle.backgroundColor
      } : null
    };
  }, panelSelector);
  if (
    !result
    || Math.abs(result.frameWidth - result.panelWidth) > 1
    || result.statusBarHeight !== 28
    || result.sourceText !== "免费AI量化数据源(同花顺)"
    || result.githubText !== "GITHUB免费开源"
    || result.githubHref !== "https://github.com/fqgate/FQGate-agent"
    || Math.abs(result.sourceTop) > 0.5
    || Math.abs(result.sourceLeft) > 0.5
    || Math.abs(result.githubTop) > 0.5
    || Math.abs(result.githubGap) > 0.5
    || result.sourceFontSize !== "10px"
    || result.githubFontSize !== "12px"
    || result.githubColor !== "rgb(0, 0, 0)"
    || result.githubBackground !== "rgb(250, 220, 25)"
    || (result.refresh && (
      result.refresh.width !== 28
      || result.refresh.height !== 27
      || Math.abs(result.refresh.right) > 0.5
      || result.refresh.borderRadius !== "0px"
      || result.refresh.borderTopWidth !== "0px"
      || result.refresh.borderBottomWidth !== "0px"
    ))
  ) {
    throw new Error(`组件公共浮层不符合要求：${JSON.stringify(result)}`);
  }
  const github = page.locator(".component-open-source-badge");
  const initialBackground = result.githubBackground;
  await github.hover();
  await page.waitForTimeout(120);
  const hoverBackground = await github.evaluate((element) => getComputedStyle(element).backgroundColor);
  if (hoverBackground === initialBackground) {
    throw new Error(`GitHub 入口悬停时整块背景没有加深：${hoverBackground}`);
  }

  if (result.refresh) {
    const refresh = page.locator(".component-refresh-button");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(120);
    const initialRefreshBackground = await refresh.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    await refresh.hover();
    await page.waitForTimeout(120);
    const hoverRefreshBackground = await refresh.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    if (hoverRefreshBackground === initialRefreshBackground) {
      throw new Error(`刷新按钮悬停时整块背景没有加深：${hoverRefreshBackground}`);
    }
  }
}

export async function assertRealtimeStatus(page, expectedTexts = ["已连接", "已断开", "重连中"]) {
  const result = await page.locator(".component-connection-status").evaluate((element) => {
    const style = getComputedStyle(element.querySelector(".connection-dot"));
    const statusBar = element.closest(".component-status-bar")?.getBoundingClientRect();
    const status = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim(),
      dotColor: style.backgroundColor,
      height: status.height,
      top: statusBar ? status.top - statusBar.top : -1,
      right: statusBar ? statusBar.right - status.right : -1,
      borderRadius: getComputedStyle(element).borderRadius,
      borderTopWidth: getComputedStyle(element).borderTopWidth,
      borderBottomWidth: getComputedStyle(element).borderBottomWidth
    };
  });
  if (
    !expectedTexts.includes(result.text ?? "")
    || !["rgb(0, 180, 42)", "rgb(245, 63, 63)"].includes(result.dotColor)
    || result.height !== 27
    || Math.abs(result.top) > 0.5
    || result.right < 0
    || result.right > 0.5
    || result.borderRadius !== "0px"
    || result.borderTopWidth !== "0px"
    || result.borderBottomWidth !== "0px"
  ) {
    throw new Error(`实时连接状态不符合要求：${JSON.stringify(result)}`);
  }
}

export async function assertConnectionMask(page) {
  const result = await page.evaluate(() => {
    const frame = document.querySelector(".component-frame")?.getBoundingClientRect();
    const mask = document.querySelector(".component-connection-mask")?.getBoundingClientRect();
    if (!frame || !mask) return null;
    return {
      frameWidth: frame.width,
      frameHeight: frame.height,
      maskWidth: mask.width,
      maskHeight: mask.height
    };
  });
  if (
    !result
    || Math.abs(result.frameWidth - result.maskWidth) > 1
    || Math.abs(result.frameHeight - result.maskHeight) > 1
  ) {
    throw new Error(`连接遮罩没有覆盖完整组件：${JSON.stringify(result)}`);
  }
}
