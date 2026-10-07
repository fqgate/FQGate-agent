import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const readText = (...parts) => readFileSync(join(root, ...parts), "utf8");
const readJson = (...parts) => JSON.parse(readText(...parts));

const compatibility = readJson("compatibility.json");
const portable = readJson("plugin.json");
const codex = readJson(".codex-plugin", "plugin.json");
const claude = readJson(".claude-plugin", "plugin.json");
const claudeMarketplace = readJson(".claude-plugin", "marketplace.json");
const codexMarketplace = readJson(".agents", "plugins", "marketplace.json");
const apps = readJson("mcp-apps", "mcp-apps", "apps.json");
const unsupportedAccountOrTradingTool = /fqgate_(?:login|session|portfolio|account_(?!watchlist)|order_(?:place|submit|cancel)|trade_(?:buy|sell))/;

test("仓库根是唯一插件根，旧包装和无合同模块已经移除", () => {
  for (const directory of [
    "AI-plugins",
    "plugins",
    "installer",
    "examples",
    "sdk",
    "fqgate",
    "update",
    "marketing"
  ]) {
    assert.equal(existsSync(join(root, directory)), false, `不应保留 ${directory}/`);
  }
  for (const path of [
    "plugin.json",
    "mcp.json",
    ".mcp.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json",
    "compatibility.json"
  ]) {
    assert.equal(existsSync(join(root, path)), true, `缺少 ${path}`);
  }
});

test("Codex、Claude Code 和可移植清单共享版本与只读能力边界", () => {
  assert.match(compatibility.agentVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(compatibility.fqgate.minimumVersion, "2.0.0");
  assert.equal(portable.version, compatibility.agentVersion);
  assert.equal(codex.version, compatibility.agentVersion);
  assert.equal(claude.version, compatibility.agentVersion);
  assert.equal(claudeMarketplace.plugins[0].version, compatibility.agentVersion);
  for (const manifest of [portable, codex, claude, claudeMarketplace.plugins[0]]) {
    assert.match(manifest.description, /行情|证券数据/);
    assert.doesNotMatch(manifest.description, /账户|下单|交易操作/);
  }
  assert.equal(codexMarketplace.name, "fqgate-official");
  assert.equal(codexMarketplace.plugins[0].name, "fqgate-agent");
  assert.equal(claudeMarketplace.name, "tonghuasun-agent");
  assert.equal(claudeMarketplace.plugins[0].name, "fqgate-agent");
});

test("Codex 官方插件统一使用蓝色 FQGate 图标和展示名称", () => {
  const interfaces = [codex.interface, portable.extensions["com.openai"].interface];
  for (const manifestInterface of interfaces) {
    assert.equal(manifestInterface.displayName, "FQGate-股票助手");
    assert.equal(manifestInterface.brandColor, "#5969ED");
    assert.equal(manifestInterface.composerIcon, "./assets/brand/fqgate-logo.png");
    assert.equal(manifestInterface.logo, "./assets/brand/fqgate-logo.png");
    assert.equal(manifestInterface.logoDark, "./assets/brand/fqgate-logo.png");
    assert.equal(existsSync(join(root, manifestInterface.logo)), true);
  }
});

test("两类 MCP 清单都只连接本机 FQGate 2.0", () => {
  const hostMcp = readJson(".mcp.json");
  const portableMcp = readJson("mcp.json");
  assert.deepEqual(hostMcp.mcpServers.fqgate, {
    type: "http",
    url: "http://127.0.0.1:17281/mcp"
  });
  assert.deepEqual(portableMcp.mcpServers.fqgate, {
    type: "streamable-http",
    url: "http://127.0.0.1:17281/mcp"
  });
});

test("四个 Skill 是唯一业务工作流且都声明 fqgate MCP 依赖", () => {
  const expected = [
    "fqgate-event-research",
    "fqgate-order-flow-analyzer",
    "fqgate-realtime-stock-analyzer",
    "fqgate-stock-screener"
  ];
  const actual = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, expected);
  for (const skill of actual) {
    const body = readText("skills", skill, "SKILL.md");
    const openai = readText("skills", skill, "agents", "openai.yaml");
    assert.match(body, new RegExp(`^---\\nname: ${skill}$`, "m"));
    assert.match(openai, /value: "fqgate"/);
    assert.match(openai, /http:\/\/127\.0\.0\.1:17281\/mcp/);
    assert.doesNotMatch(body, unsupportedAccountOrTradingTool);
  }
});

test("MCP Apps 只绑定版本化资源和 FQGate V2 查询路径", () => {
  assert.equal(apps.schemaVersion, 1);
  assert.equal(apps.component, "fqgate-mcp-apps");
  assert.equal(apps.minimumFqgateVersion, "2.0.0");
  assert.deepEqual(
    apps.apps.map((app) => app.id).sort(),
    ["candle", "information", "market-quotes", "order-flow"]
  );
  const paths = new Set();
  for (const app of apps.apps) {
    assert.equal(app.resourceUri, `ui://fqgate/${apps.bundleVersion}/${app.file}`);
    assert.equal(app.file, `${app.id}.html`);
    assert.ok(app.toolPaths.length > 0);
    for (const path of app.toolPaths) {
      assert.match(path, /^\/v2\//);
      assert.equal(paths.has(path), false, `工具路径重复绑定：${path}`);
      paths.add(path);
    }
  }
});

test("CI 与发布只走当前目录和 FQGate-releases 稳定通道", () => {
  const ci = readText(".github", "workflows", "ci.yml");
  const release = readText(".github", "workflows", "prepare-mcp-apps-release.yml");
  assert.match(ci, /mcp-apps\/package-lock\.json/);
  assert.doesNotMatch(ci, /AI-plugins|installer|examples|sdk/);
  assert.match(release, /repository: fqgate\/FQGate-releases/);
  assert.match(release, /releases\/v2\/mcp-apps/);
  assert.match(release, /mcp-apps-ed25519-public\.pem/);
  assert.doesNotMatch(release, /fqgate\/mcp-apps|AI-plugins/);
});
