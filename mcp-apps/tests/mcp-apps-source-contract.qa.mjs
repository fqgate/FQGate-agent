import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(root, "src");
const sourceFiles = collectSourceFiles(sourceRoot);

for (const path of sourceFiles) {
  const body = readFileSync(path, "utf8");
  const name = relative(root, path);
  assert.doesNotMatch(body, /\/v1\//, `${name} 不得依赖 FQGate V1`);
  assert.doesNotMatch(
    body,
    /\b(?:LoginPanel|LoginService|QrLogin|SmsLogin)\b/,
    `${name} 不得包含登录界面合同`,
  );
  assert.doesNotMatch(
    body,
    /new\s+WebSocket\s*\(/,
    `${name} 不得从组件沙箱直连 WebSocket`,
  );
  assert.doesNotMatch(
    body,
    /from\s+["']vue["']|\.vue["']|@arco-design/,
    `${name} 必须保持原生 HTML 实现`,
  );
}

const preview = readFileSync(join(sourceRoot, "preview.ts"), "utf8");
for (const service of [
  "McpPollingMarketQuoteService",
  "McpPollingMarketRealtimeService",
  "McpPollingOrderFlowService",
]) {
  assert.match(preview, new RegExp(`new ${service}\\(`));
}

const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
for (const dependency of [
  "vue",
  "vue-tsc",
  "@vitejs/plugin-vue",
  "@arco-design/web-vue",
]) {
  assert.equal(
    packageJson.dependencies?.[dependency],
    undefined,
    `运行依赖不得包含 ${dependency}`,
  );
  assert.equal(
    packageJson.devDependencies?.[dependency],
    undefined,
    `开发依赖不得包含 ${dependency}`,
  );
}
const styles = readFileSync(join(sourceRoot, "styles", "reset.css"), "utf8");
assert.match(styles, /font-size:\s*12px/, "正文基准字号必须为 12px");
const tokens = readFileSync(join(sourceRoot, "styles", "tokens.css"), "utf8");
assert.match(tokens, /Microsoft YaHei UI/, "Windows 必须使用系统 UI 字体栈");
assert.match(tokens, /prefers-color-scheme:\s*dark/, "必须支持系统深色模式");
const marketStyles = readFileSync(
  join(sourceRoot, "styles", "market-ui.css"),
  "utf8",
);
assert.match(
  marketStyles,
  /prefers-reduced-motion:\s*reduce/,
  "必须尊重减少动态效果设置",
);
const candleStyle =
  marketStyles.match(/\.candle-app\s*\{([^}]*)\}/s)?.[1] ?? "";
assert.match(
  candleStyle,
  /width:\s*100%[^;]*;\s*height:\s*100vh/,
  "个股 K 线必须跟随宿主内容区尺寸",
);
assert.match(candleStyle, /border:\s*0/, "个股 K 线根容器不得重复添加卡片边框");
assert.match(
  candleStyle,
  /border-radius:\s*0/,
  "个股 K 线根容器不得重复添加卡片圆角",
);
assert.match(
  candleStyle,
  /box-shadow:\s*none/,
  "个股 K 线根容器不得重复添加卡片阴影",
);
assert.doesNotMatch(
  candleStyle,
  /aspect-ratio/,
  "个股 K 线不得在宿主窗口内再固定画布比例",
);
const candleTitleStyle =
  marketStyles.match(/\.candle-heading__title\s*\{([^}]*)\}/s)?.[1] ?? "";
assert.match(
  candleTitleStyle,
  /border-radius:\s*999px/,
  "个股 K 线应用名称必须使用胶囊外形",
);
assert.match(
  candleTitleStyle,
  /background:\s*var\(--accent-soft\)/,
  "个股 K 线应用名称胶囊必须使用主题强调色背景",
);
const candleSource = readFileSync(
  join(sourceRoot, "apps", "CandleApp.ts"),
  "utf8",
);
assert.match(
  candleSource,
  /new URL\("\.\.\/assets\/fqgate-logo\.png", import\.meta\.url\)/,
  "个股 K 线工具栏必须使用 FQGate 品牌图形",
);
assert.match(
  candleSource,
  /candle-brand__wordmark", "FQGate"/,
  "个股 K 线工具栏品牌必须显示 FQGate 英文名称",
);
assert.match(
  candleSource,
  /requestHostPageRefresh\(\)[\s\S]*?refreshPage\(\)/,
  "个股 K 线刷新必须请求宿主页面刷新并执行 App 自身完整刷新",
);
const informationAppSource = readFileSync(
  join(sourceRoot, "apps", "InformationApp.ts"),
  "utf8",
);
assert.match(
  informationAppSource,
  /requestHostPageRefresh\(\)[\s\S]*?load\(true\)/,
  "个股资讯刷新必须复用宿主刷新意图并重新读取数据",
);
const previewSourceContext = readFileSync(
  join(sourceRoot, "shared", "previewSource.ts"),
  "utf8",
);
assert.match(
  previewSourceContext,
  /fqgate\.app\.refresh-page/,
  "MCP App 刷新意图必须使用统一宿主消息合同",
);
const candleChartSource = readFileSync(
  join(sourceRoot, "features", "candle", "CandleChartController.ts"),
  "utf8",
);
assert.match(
  candleChartSource,
  /fixLeftEdge:\s*true/,
  "K 线时间轴不得拖动到首条数据左侧的空白区",
);
assert.match(
  candleChartSource,
  /fixRightEdge:\s*true/,
  "K 线时间轴不得拖动到末条数据右侧的空白区",
);
assert.match(
  candleChartSource,
  /rightPriceScale:\s*\{\s*visible:\s*false\s*\}/,
  "窄屏 K 线不得为右侧价格刻度保留独立栏位",
);
assert.match(
  candleSource,
  /new MarketInspector\(\{/,
  "个股 K 线必须提供可钻取的盘口与成交侧栏",
);
assert.match(
  candleSource,
  /onDepth:[\s\S]*onTransactions:/,
  "个股 K 线必须订阅盘口与成交更新",
);
assert.match(
  candleSource,
  /setInspectorWorkspaceMode/,
  "个股 K 线必须支持全景盘口工作区和右侧栏成交明细",
);
const inspectorSource = readFileSync(
  join(sourceRoot, "features", "candle", "MarketInspector.ts"),
  "utf8",
);
const transactionSummarySource = readFileSync(
  join(sourceRoot, "features", "candle", "TransactionSummary.ts"),
  "utf8",
);
const orderBookSummarySource = readFileSync(
  join(sourceRoot, "features", "candle", "OrderBookSummary.ts"),
  "utf8",
);
assert.match(inspectorSource, /全景 500 档/);
assert.match(
  inspectorSource,
  /button\(\s*"成交明细",\s*"market-inspector-tab"/,
  "盘口表头必须提供成交明细页签",
);
assert.match(
  inspectorSource,
  /tabs\.setAttribute\("role", "tablist"\)/,
  "盘口与成交必须使用可访问的页签语义",
);
assert.match(inspectorSource, /tab\.setAttribute\("role", "tab"\)/);
assert.match(inspectorSource, /tab\.setAttribute\("aria-controls", panelId\)/);
assert.match(inspectorSource, /tab\.setAttribute\("aria-selected", String\(selected\)\)/);
assert.match(
  inspectorSource,
  /event\.key === "ArrowRight"[\s\S]*?event\.key === "ArrowLeft"[\s\S]*?event\.key === "Home"[\s\S]*?event\.key === "End"/,
  "盘口与成交页签必须支持桌面键盘导航",
);
assert.match(
  inspectorSource,
  /append\(\s*this\.root,\s*this\.header,\s*this\.summary,[\s\S]*?this\.transactionDetail\.root/,
  "盘口与成交页签必须在两个内容面板切换时保持可见",
);
assert.match(inspectorSource, /mode === "level2" \? "十档盘口" : "五档盘口"/);
assert.doesNotMatch(inspectorSource, />L1<|"L1"/);
assert.match(
  orderBookSummarySource,
  /visibleDepthStrength\(bids, asks\)/,
  "买卖强度条必须使用当前展示档位的统一委托金额口径",
);
assert.match(
  orderBookSummarySource,
  /cell\("金额"\)/,
  "盘口第三列必须明确使用委托金额口径",
);
assert.match(
  orderBookSummarySource,
  /cell\(formatOrderBookAmount\(level\.price, level\.volume\), "numeric depth-volume"\)/,
  "盘口每档委托金额必须由价格和股数计算",
);
assert.match(
  orderBookSummarySource,
  /formatCompact\(strength\.buyAmount\)[\s\S]*?formatCompact\(strength\.sellAmount\)/,
  "买卖强度说明必须与盘口统一使用委托金额",
);
assert.doesNotMatch(
  orderBookSummarySource,
  /order-book-strength__(?:buy|sell)-label/,
  "买卖强度条不得显示方向文字",
);
assert.match(
  orderBookSummarySource,
  /占 \$\{strength\.buyPercent\.toFixed\(1\)\}%[\s\S]*?占 \$\{strength\.sellPercent\.toFixed\(1\)\}%/,
  "买卖强度的精确占比必须保留在辅助功能描述中",
);
assert.match(
  orderBookSummarySource,
  /row\.title = description/,
  "无文字强度条必须通过悬停提示提供精确口径",
);
assert.match(
  marketStyles,
  /\.order-book-strength\s*\{[\s\S]*?height:\s*12px/,
  "买卖强度分隔行必须保持紧凑高度",
);
assert.match(
  marketStyles,
  /\.order-book-strength__track\s*\{[\s\S]*?grid-template-columns:\s*var\(--buy-strength\) var\(--sell-strength\)/,
  "买卖强度条必须按委买、委卖占比分割",
);
assert.match(
  marketStyles,
  /\.market-inspector-tab\[aria-selected="true"\]\s*\{[\s\S]*?color:\s*var\(--accent\)/,
  "当前页签必须有独立的选中视觉状态",
);
assert.match(
  marketStyles,
  /\.market-inspector-tab\[aria-selected="true"\]::after\s*\{[\s\S]*?opacity:\s*1/,
  "当前页签必须显示底部指示线",
);
assert.match(transactionSummarySource, /const BASIC_SUMMARY_ROWS = 6/);
assert.match(transactionSummarySource, /const LEVEL2_SUMMARY_ROWS = 2/);
assert.match(transactionSummarySource, /transactionSummaryRowLimit/);
assert.match(transactionSummarySource, /role", "button"/);
const virtualRowListSource = readFileSync(
  join(sourceRoot, "features", "candle", "VirtualRowList.ts"),
  "utf8",
);
assert.match(
  virtualRowListSource,
  /setProperty\("--virtual-row-height", `\$\{rowHeight\}px`\)/,
  "虚拟列表必须把计算行高同步给实际渲染行",
);
assert.match(
  marketStyles,
  /\.panoramic-row,\s*\.transaction-detail-row\s*\{[\s\S]*?height:\s*var\(--virtual-row-height\)/,
  "全景盘口和成交明细的实际行高必须与虚拟列表一致",
);
assert.match(inspectorSource, /openTransactions/);
assert.match(
  inspectorSource,
  /openPanorama\(\)[\s\S]*?onWorkspaceModeChange\("panorama"\)/,
  "全景盘口必须切换到独立工作区",
);
assert.match(
  inspectorSource,
  /openTransactions\(\)[\s\S]*?onWorkspaceModeChange\("split"\)/,
  "成交明细必须在右侧栏内展开并保留 K 线",
);
assert.match(
  candleSource,
  /"is-inspector-panorama"/,
  "宿主只能在全景盘口状态隐藏 K 线",
);
const detailServiceSource = readFileSync(
  join(sourceRoot, "adapters", "local-api", "FqgateMarketDetailService.ts"),
  "utf8",
);
assert.match(
  detailServiceSource,
  /\/v2\/market\/level2\/order-book-rankings/,
  "全景 500 档必须使用真实的 Level-2 买卖盘价格排名",
);
assert.match(
  candleSource,
  /statusBar:\s*false/,
  "个股 K 线必须使用自包含的窄屏工具栏",
);
assert.match(
  candleSource,
  /candle-heading__source-select/,
  "个股 K 线必须在标题旁提供数据源账号选择器",
);
const realtimeSource = readFileSync(
  join(sourceRoot, "adapters", "mcp-app", "McpPollingMarketRealtimeService.ts"),
  "utf8",
);
assert.match(
  realtimeSource,
  /wantsDepth\s*=\s*Boolean\(\s*listener\.onModeChange\s*\|\|\s*listener\.onDepth\s*\|\|\s*listener\.onTransactions\s*,?\s*\)/,
  "只有订阅盘口的 App 才请求盘口数据",
);
const orderFlowSource = readFileSync(
  join(sourceRoot, "apps", "OrderFlowApp.ts"),
  "utf8",
);
assert.match(
  orderFlowSource,
  /this\.frame\.root\.classList\.add\("order-flow-app"\)/,
  "逐笔委托必须声明独立的全高布局根节点",
);
assert.match(
  orderFlowSource,
  /this\.searchResults\.id\s*=\s*["']order-flow-search-results["'];\s*this\.setSearchResultsVisible\(false\);/,
  "逐笔委托的空搜索结果浮层必须默认关闭",
);
assert.match(
  orderFlowSource,
  /this\.searchResults\.hidden\s*=\s*!visible;\s*this\.searchInput\.setAttribute\(["']aria-expanded["'],\s*String\(visible\)\);/,
  "搜索结果浮层的显示状态和无障碍状态必须统一维护",
);
assert.match(
  marketStyles,
  /\.order-flow-app\s*\{[\s\S]*?height:\s*100vh[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\)/,
  "逐笔委托必须填满 MCP App 视口并把剩余高度交给内容区",
);
assert.match(
  marketStyles,
  /\.stream-table-scroll\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0/,
  "逐笔委托表格必须填满剩余空间并在内部滚动",
);
const informationSource = readFileSync(
  join(sourceRoot, "apps", "InformationApp.ts"),
  "utf8",
);
assert.match(
  informationSource,
  /createStandardAppHeader/,
  "个股资讯必须沿用个股 K 线的数据源账号选择器",
);
assert.match(
  informationSource,
  /element\("a", "information-item__action"\)/,
  "有原文地址的资讯必须把整个条目作为链接",
);
assert.match(
  informationSource,
  /event\.preventDefault\(\);[\s\S]*?this\.openItem\(item\)/,
  "资讯链接必须交给宿主打开系统浏览器",
);
const mcpRuntimeSource = readFileSync(
  join(sourceRoot, "adapters", "mcp-app", "McpAppRuntime.ts"),
  "utf8",
);
for (const app of ["market-quotes.ts", "order-flow.ts", "information.ts"]) {
  const entrySource = readFileSync(join(sourceRoot, "mcp-apps", app), "utf8");
  assert.match(entrySource, /readPreviewSourceContext/);
  assert.match(entrySource, /requestPreviewSourceSelection/);
  assert.match(entrySource, /applyPreviewHostActionInset/);
}
for (const [file, label] of [
  ["MarketQuotesApp.ts", "多股行情"],
  ["OrderFlowApp.ts", "L2 逐笔委托"],
]) {
  const appSource = readFileSync(join(sourceRoot, "apps", file), "utf8");
  assert.match(appSource, /createStandardAppHeader/, `${label}必须沿用个股 K 线的数据源账号选择器`);
}
const previewSourceSelectSource = readFileSync(
  join(sourceRoot, "ui", "previewSourceSelect.ts"),
  "utf8",
);
assert.match(
  previewSourceSelectSource,
  /candle-heading__source-select/,
  "数据源选择器必须复用个股 K 线的视觉样式",
);
const standardHeaderSource = readFileSync(
  join(sourceRoot, "ui", "standardAppHeader.ts"),
  "utf8",
);
assert.match(standardHeaderSource, /candle-brand__wordmark/, "所有 App 必须复用 FQGate 顶部品牌栏");
assert.match(standardHeaderSource, /candle-heading__title/, "所有 App 必须复用应用标题胶囊");
assert.match(
  mcpRuntimeSource,
  /this\.app\.openLink\(\{ url \}\)/,
  "MCP App 外链必须使用标准 ui/open-link 请求",
);

const config = JSON.parse(
  readFileSync(join(root, "mcp-apps", "apps.json"), "utf8"),
);
assert.equal(config.bundleVersion, "0.4.0");
assert.deepEqual(config.apps.map((app) => app.id).sort(), [
  "candle",
  "information",
  "market-quotes",
  "order-flow",
]);
for (const app of config.apps) {
  assert.ok(app.toolPaths.length > 0);
  for (const path of app.toolPaths) assert.match(path, /^\/v2\//);
  assert.match(app.preview.entryTool, /^fqgate_/);
  assert.ok(app.preview.inputs.length > 0);
}

process.stdout.write("MCP Apps 源码边界验收通过。\n");

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return [".ts", ".vue", ".md"].includes(extname(entry.name)) ? [path] : [];
  });
}
