import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const compatibility = readJson("fqgate", "compatibility.json");
const agentVersion = compatibility.agentVersion;
const displayName = "同花顺免费开源AI插件FQGate";

const manifests = [
  ["codex", ".codex-plugin", "plugin.json"],
  ["claude-code", ".claude-plugin", "plugin.json"],
  ["workbuddy", ".codebuddy-plugin", "plugin.json"],
  ["zcode", ".zcode-plugin", "plugin.json"],
  ["openclaw", "plugin.json"],
  ["doubao", "plugin.json"],
  ["qianwen", "plugin.json"],
  ["deepseek-harness", "package.json"]
];

function pathInRepository(...segments) {
  return join(repositoryRoot, ...segments);
}

function readText(...segments) {
  return readFileSync(pathInRepository(...segments), "utf8");
}

function readJson(...segments) {
  return JSON.parse(readText(...segments));
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

test("八个适配器与兼容清单使用同一 Agent 版本", () => {
  assert.match(agentVersion, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(compatibility.fqgate.minimumVersion, "0.1.0");
  assert.deepEqual(Object.keys(compatibility.fqgate), ["minimumVersion"]);

  for (const [adapter, ...manifestPath] of manifests) {
    const manifest = readJson("AI-plugins", adapter, ...manifestPath);
    assert.equal(manifest.version, agentVersion, `${adapter} 版本不一致`);
  }
});

test("面向 Windows 用户的 PowerShell 脚本使用 UTF-8 BOM", () => {
  const scripts = [
    ["Build-Distribution.ps1"],
    ["scripts", "Build-AgentPlugins.ps1"],
    ["scripts", "Sync-FqgateUiApps.ps1"],
    ["scripts", "release", "Common.ps1"],
    ["installer", "runtime", "install-fqgate.ps1"],
    ["AI-plugins", "doubao", "setup.ps1"],
    ["AI-plugins", "doubao", "install.ps1"],
    ["AI-plugins", "qianwen", "setup.ps1"],
    ["AI-plugins", "qianwen", "install.ps1"]
  ];

  for (const segments of scripts) {
    const bytes = readFileSync(pathInRepository(...segments));
    assert.deepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${segments.join("/")} 缺少 UTF-8 BOM，Windows PowerShell 5.1 可能无法解析中文`
    );
  }
});

test("Codex 直接连接本机 FQGate，STDIO 适配器统一调用原生启动器", () => {
  const codexConfig = readJson("AI-plugins", "codex", ".mcp.json");
  assert.equal(codexConfig.mcpServers.fqgate.type, "http");
  assert.equal(codexConfig.mcpServers.fqgate.url, compatibility.mcp.defaultUrl);
  assert.equal(Object.hasOwn(codexConfig.mcpServers.fqgate, "cwd"), false);

  const configPaths = [
    ["claude-code", ".mcp.json"],
    ["workbuddy", ".mcp.json"],
    ["zcode", ".mcp.json"],
    ["openclaw", "mcp.json"],
    ["qianwen", "plugin.json"]
  ];

  for (const [adapter, configName] of configPaths) {
    const text = readText("AI-plugins", adapter, configName);
    assert.match(text, /fqgate/i, `${adapter} 未声明 FQGate`);
    assert.match(text, /launch-fqgate-mcp\.mjs/, `${adapter} 未使用公共启动器`);
    assert.doesNotMatch(text, /tonghuasun-mcp-proxy\.mjs/, `${adapter} 仍引用旧代理`);
  }

  const launcher = readText("installer", "runtime", "launch-fqgate-mcp.mjs");
  assert.match(launcher, /--mcp-stdio/);
  assert.match(launcher, /--mcp-url/);
});

test("公共能力只暴露两个面向用户的代理技能", () => {
  const expectedSkills = ["fqgate-realtime-stock-analyzer", "trade-execution"];
  const actualSkills = readdirSync(pathInRepository("skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(pathInRepository("skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualSkills, expectedSkills);

  for (const skill of expectedSkills) {
    assert.ok(existsSync(pathInRepository("skills", skill, "SKILL.md")), `缺少技能 ${skill}`);
  }

  const marketDataSkill = readText("skills", "fqgate-realtime-stock-analyzer", "SKILL.md");
  assert.match(marketDataSkill, /^name: fqgate-realtime-stock-analyzer$/m);
  assert.match(marketDataSkill, /获取个股实时数据与分析的唯一合法底座/);
  assert.match(marketDataSkill, /只要用户的提问中包含具体的【股票名称】或【股票代码】/);
  assert.match(marketDataSkill, /问“还能持有吗、该不该卖、能不能买、后市如何、支撑压力、风险大吗”/);
  assert.match(marketDataSkill, /纯粹询问“什么是市盈率”、“大盘为什么跌”/);
  assert.match(readText("skills", "fqgate-realtime-stock-analyzer", "agents", "openai.yaml"), /display_name: "同花顺免费实时数据代理"/);
  assert.match(readText("skills", "trade-execution", "agents", "openai.yaml"), /display_name: "同花顺实盘交易代理"/);
  assert.match(
    marketDataSkill,
    /数据来自“\[FQGate-免费本地同花顺数据源\]\(https:\/\/github\.com\/fqgate\/FQGate-agent\)”/,
    "行情文本回复缺少带 GitHub 链接的数据源署名"
  );
});

test("插件 ID、显示名称和品牌图标保持统一", () => {
  assert.ok(existsSync(pathInRepository("assets", "brand", "fqgate-app-icon.svg")));
  assert.ok(existsSync(pathInRepository("assets", "brand", "fqgate-app-icon.png")));

  const codex = readJson("AI-plugins", "codex", ".codex-plugin", "plugin.json");
  assert.equal(codex.name, "fqgate-agent");
  assert.equal(codex.interface.displayName, displayName);
  assert.equal(codex.interface.logo, "./assets/brand/fqgate-app-icon.svg");

  const claude = readJson("AI-plugins", "claude-code", ".claude-plugin", "plugin.json");
  const workbuddy = readJson("AI-plugins", "workbuddy", ".codebuddy-plugin", "plugin.json");
  const doubao = readJson("AI-plugins", "doubao", "plugin.json");
  const qianwen = readJson("AI-plugins", "qianwen", "plugin.json");
  const deepseek = readJson("AI-plugins", "deepseek-harness", "package.json");
  assert.equal(claude.name, "fqgate-agent");
  assert.equal(claude.displayName, displayName);
  assert.equal(workbuddy.name, "fqgate-agent");
  assert.equal(workbuddy.displayName, displayName);
  const workbuddyMcp = readJson("AI-plugins", "workbuddy", ".mcp.json");
  assert.equal(workbuddyMcp.mcpServers.fqgate["x-workbuddy"].displayName.zh, displayName);
  assert.equal(
    workbuddyMcp.mcpServers.fqgate["x-workbuddy"].icon,
    "./assets/brand/fqgate-app-icon.svg"
  );
  assert.equal(doubao.id, "fqgate-agent");
  assert.equal(doubao.name, displayName);
  assert.equal(doubao.icon, "./assets/brand/fqgate-app-icon.svg");
  assert.equal(qianwen.id, "fqgate-agent");
  assert.equal(qianwen.name, displayName);
  assert.equal(qianwen.icon, "./assets/brand/fqgate-app-icon.svg");
  assert.equal(deepseek.displayName, displayName);
  assert.equal(deepseek.icon, "./assets/brand/fqgate-app-icon.svg");
  assert.ok(deepseek.files.includes("assets/"));

  const openclaw = readJson("AI-plugins", "openclaw", "plugin.json");
  const zcode = readJson("AI-plugins", "zcode", ".zcode-plugin", "plugin.json");
  assert.equal(openclaw.name, "fqgate-agent");
  assert.equal(openclaw.extensions["io.github.zhuyifang.fqgate"].displayName, displayName);
  assert.equal(zcode.name, "fqgate-agent");
  assert.match(zcode.description, new RegExp(displayName));
});

test("README 和插件清单保留原名称并覆盖核心检索词", () => {
  const readme = readText("README.md");
  const workspace = readJson("package.json");
  const requiredKeywords = ["fqgate", "tonghuasun-agent", "mcp", "a-share", "market-data", "kline", "level-2", "quant-trading"];

  assert.match(readme, /原插件名为 `tonghuasun-agent`，现已更名为 `fqgate-agent`/);
  assert.match(readme, /A 股实时行情/);
  assert.match(readme, /Level-2/);
  assert.doesNotMatch(readme, /V2 分支|使用 V2 分支|V2 版本|V2 插件|V2 已提供/);

  for (const keyword of requiredKeywords) {
    assert.ok(workspace.keywords.includes(keyword), `根项目缺少关键词 ${keyword}`);
  }

  for (const adapter of ["codex", "claude-code", "workbuddy", "zcode", "openclaw", "deepseek-harness"]) {
    const manifestEntry = manifests.find(([name]) => name === adapter);
    const manifest = readJson("AI-plugins", ...manifestEntry);
    assert.ok(manifest.keywords.includes("tonghuasun-agent"), `${adapter} 未保留原插件名关键词`);
    assert.ok(manifest.keywords.includes("FQGate"), `${adapter} 缺少当前插件关键词`);
  }
});

test("八个 AI 工具只使用 FQGate 官方发行仓库", () => {
  const releaseRepository = "https://github.com/fqgate/FQGate-releases";
  const agentReleasePage = "https://github.com/fqgate/FQGate-agent/releases";
  const stableManifest = `${releaseRepository.replace("github.com", "raw.githubusercontent.com")}/main/releases/stable.json`;
  const releasePage = `${releaseRepository}/releases`;
  const downloadTemplate = `${releaseRepository}/releases/download/fqgate-v<version>/<fileName>`;

  assert.equal(compatibility.release.repositoryUrl, releaseRepository);
  assert.equal(compatibility.release.stableManifestUrl, stableManifest);
  assert.equal(compatibility.release.tagPrefix, "fqgate-v");

  for (const [adapter] of manifests) {
    const readme = readText("AI-plugins", adapter, "README.md");
    assert.ok(readme.includes(releasePage), `${adapter} 缺少 FQGate 官方下载页`);
    assert.ok(readme.includes(stableManifest), `${adapter} 缺少 FQGate 官方稳定版清单`);
    assert.ok(readme.includes(downloadTemplate), `${adapter} 缺少 FQGate 官方下载地址`);
    assert.ok(readme.includes(agentReleasePage), `${adapter} 缺少 AI 插件发行页`);
    assert.match(readme, /注册 `fqgate-realtime-stock-analyzer`（\*\*同花顺免费实时数据代理\*\*）/, `${adapter} 缺少行情技能 ID 和名称`);
    assert.match(readme, /`trade-execution`（\*\*同花顺实盘交易代理\*\*）/, `${adapter} 缺少交易技能 ID 和名称`);
    assert.match(readme, /`fqgate-realtime-stock-analyzer` 是当前行情技能 ID/, `${adapter} 没有说明当前行情技能 ID`);
    assert.match(readme, /只放 AI 技能安装包，不提供 `FQGate\.exe`/, `${adapter} 没有说清两个仓库的分工`);
    assert.match(readme, /SHA-256/, `${adapter} 缺少主程序校验要求`);
    assert.match(readme, /创建一个桌面快捷方式/, `${adapter} 缺少桌面快捷方式提醒`);
    assert.match(readme, /安装结束前，确认 FQGate 已经启动.*读取工具列表或完成健康检查/, `${adapter} 缺少安装验收条件`);
    assert.doesNotMatch(
      readme,
      /(?:github\.com\/fqgate\/FQGate-agent|gitee\.com\/qicuo\/tonghuasun-agent)\/(?:releases\/(?:tag|download)\/fqgate-v|raw\/main\/fqgate\/releases)/,
      `${adapter} 仍在使用插件仓库下载 FQGate`
    );
  }

  const rootReadme = readText("README.md");
  assert.match(rootReadme, /FQGate 主程序下载/);
  assert.ok(rootReadme.includes(releasePage));
  assert.ok(rootReadme.includes(stableManifest));
  assert.ok(rootReadme.includes(downloadTemplate));
  assert.match(rootReadme, /创建(?:一个)?桌面快捷方式/);
  assert.match(rootReadme, /安装结束前，AI 应确认 FQGate 已经启动.*读取工具列表或完成健康检查/s);
  assert.equal(existsSync(pathInRepository("fqgate", "releases", "stable.json")), false);
  assert.equal(existsSync(pathInRepository("fqgate", "releases", "0.1.0.json")), false);

  const packagedFqgateDocument = readText("fqgate", "README.md");
  assert.ok(packagedFqgateDocument.includes(releaseRepository));
  assert.ok(packagedFqgateDocument.includes(agentReleasePage));
  assert.match(packagedFqgateDocument, /注册 `fqgate-realtime-stock-analyzer`（\*\*同花顺免费实时数据代理\*\*）/);
  assert.match(packagedFqgateDocument, /`trade-execution`（\*\*同花顺实盘交易代理\*\*）/);
  assert.match(packagedFqgateDocument, /`fqgate-realtime-stock-analyzer` 是当前行情技能 ID/);
  assert.match(packagedFqgateDocument, /只放 AI 技能安装包，不提供 `FQGate\.exe`/);
});

test("Windows 自动安装使用正式包并在连接验收后才结束", () => {
  const installer = readText("installer", "runtime", "install-fqgate.ps1");
  assert.match(installer, /compatibility\.release\.stableManifestUrl/);
  assert.match(installer, /Get-FileHash[\s\S]*SHA256/);
  assert.match(installer, /Join-Path \$env:LOCALAPPDATA "FQGate"/);
  assert.match(installer, /CreateShortcut/);
  assert.match(installer, /Start-Process -FilePath \$executablePath/);
  assert.match(installer, /--require-ready/);
  assert.match(installer, /安装完成：FQGate/);

  const releaseHelpers = readText("scripts", "release", "Common.ps1");
  assert.match(releaseHelpers, /scripts\\install-fqgate\.ps1/);

  for (const adapter of ["doubao", "qianwen"]) {
    const setup = readText("AI-plugins", adapter, "setup.ps1");
    assert.match(setup, /scripts\\install-fqgate\.ps1/);
    assert.match(setup, /--require-ready/);
  }

  for (const [adapter] of manifests) {
    const readme = readText("AI-plugins", adapter, "README.md");
    assert.match(readme, /install-fqgate\.ps1/, `${adapter} 缺少 Windows 自动安装命令`);
  }
});

test("八个宿主安装说明都要求先卸载旧版插件", () => {
  for (const [adapter] of manifests) {
    const readme = readText("AI-plugins", adapter, "README.md");
    assert.match(readme, /卸载旧版 `tonghuasun-agent`/, `${adapter} 缺少旧版卸载流程`);
    assert.match(readme, /不要同时/, `${adapter} 缺少新旧版本冲突提示`);
    assert.match(readme, /不会删除 FQGate 主程序或共享配置/, `${adapter} 缺少数据保留说明`);
  }

  assert.match(
    readText("AI-plugins", "claude-code", "README.md"),
    /\/plugin uninstall tonghuasun-agent@tonghuasun-agent/
  );
  assert.match(
    readText("AI-plugins", "openclaw", "README.md"),
    /openclaw plugins uninstall tonghuasun-agent --dry-run/
  );
  assert.match(
    readText("AI-plugins", "deepseek-harness", "README.md"),
    /dsh plugin --profile web remove tonghuasun-agent-deepseek-harness/
  );
  for (const adapter of ["doubao", "qianwen"]) {
    assert.match(readText("AI-plugins", adapter, "README.md"), /setup\.ps1 -Uninstall/);
  }

  const rootReadme = readText("README.md");
  assert.doesNotMatch(rootReadme, /卸载旧版 `tonghuasun-agent`/);
  assert.doesNotMatch(rootReadme, /旧版用户请先卸载/);

});

test("V2 不重新引入旧 MCP 代理和私有原生载荷", () => {
  assert.equal(
    existsSync(pathInRepository("tonghuasun-mcp", "distribution", "scripts", "tonghuasun-mcp-proxy.mjs")),
    false
  );
  assert.equal(existsSync(pathInRepository("tonghuasun-mcp", "distribution", "payload")), false);
  assert.equal(existsSync(pathInRepository("fqgate", "src")), false);
  assert.equal(existsSync(pathInRepository("fqgate", "Cargo.toml")), false);
});

test("MCP Apps 构建产物只交给 FQGate，不复制进 Codex 插件", () => {
  const syncScript = readText("scripts", "Sync-FqgateUiApps.ps1");
  const appConfig = readJson("AI-plugins", "ui-apps", "mcp-apps", "apps.json");
  assert.equal(appConfig.apps.length, 5);
  assert.ok(appConfig.apps.some((app) => app.id === "information"));
  assert.match(syncScript, /npm[\s\S]*build:mcp-apps/);
  assert.match(syncScript, /manifest\.json/);
  assert.match(syncScript, /target\\debug\\mcp-apps/);
  assert.match(syncScript, /fqgate_mcp_apps_publish_complete=true/);
  assert.doesNotMatch(syncScript, /login\.html|candle\.html|information\.html|market-quotes\.html|order-flow\.html/);

  const releaseScript = readText("AI-plugins", "ui-apps", "scripts", "release-mcp-apps.mjs");
  assert.match(releaseScript, /loadSigningPrivateKey/);
  assert.doesNotMatch(releaseScript, /PRIVATE KEY-----/);

  const commonPackage = readText("scripts", "release", "Common.ps1");
  assert.doesNotMatch(commonPackage, /ui-apps/i);
  assert.doesNotMatch(commonPackage, /assets\\mcp-apps/i);
});

test("候选发行清单完整，稳定通道和 Claude 市场始终保持一致", () => {
  assert.equal(Object.hasOwn(compatibility, "release"), true);
  const release = readJson("update", "releases", `${agentVersion}.json`);
  assert.equal(release.component, "fqgate-agent");
  assert.equal(release.version, agentVersion);
  assert.equal(release.packages.length, 9);
  for (const releasePackage of release.packages) {
    assert.match(releasePackage.fileName, new RegExp(`${agentVersion.replaceAll(".", "\\.")}\\.(zip|tgz)$`));
    assert.ok(Number.isInteger(releasePackage.size) && releasePackage.size > 0);
    assert.match(releasePackage.sha256, /^[a-f0-9]{64}$/);
  }

  const stable = readJson("update", "stable.json");
  assert.match(stable.latestVersion, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.match(stable.releaseUrls.github, /github\.com\/fqgate\/FQGate-agent\/releases\/tag\/v/);
  assert.match(stable.releaseUrls.gitee, /gitee\.com\/qicuo\/tonghuasun-agent\/releases\/tag\/v/);
  assert.ok(compareVersions(stable.latestVersion, agentVersion) <= 0, "稳定版不能高于源码候选版本");
  const stableRelease = readJson("update", "releases", `${stable.latestVersion}.json`);
  const claudeMarketplace = readJson(".claude-plugin", "marketplace.json");
  assert.equal(claudeMarketplace.plugins[0].version, stable.latestVersion);
  assert.equal(claudeMarketplace.plugins[0].name, "fqgate-agent");
  assert.ok(
    claudeMarketplace.plugins[0].source.url.endsWith(
      `fqgate-agent-claude-code-${stable.latestVersion}.zip`
    )
  );
  assert.equal(
    claudeMarketplace.plugins[0].source.sha256,
    stableRelease.packages.find((item) => item.adapter === "claude-code").sha256
  );

  const claudeReadme = readText("AI-plugins", "claude-code", "README.md");
  assert.doesNotMatch(claudeReadme, new RegExp(`${agentVersion.replaceAll(".", "\\.")}\` 尚未发布|仍指向已发布的旧版`));
  assert.match(claudeReadme, /\/plugin marketplace add fqgate\/FQGate-agent/);
  assert.match(claudeReadme, /\/plugin install fqgate-agent@tonghuasun-agent/);
});

test("Agent 正式构建不依赖 FQGate 的发布状态", () => {
  const buildScript = readText("scripts", "Build-AgentPlugins.ps1");
  assert.doesNotMatch(buildScript, /compatibility\.release\.status/);
  assert.doesNotMatch(buildScript, /FQGate 发行清单尚未发布/);
  assert.match(buildScript, /build_mode=/);
  assert.match(buildScript, /SHA256SUMS\.txt/);
});

test("Gitee 只在 GitHub 主分支 CI 成功后执行安全镜像", () => {
  const workflow = readText(".github", "workflows", "sync-gitee.yml");
  const metadataScript = readText("scripts", "release", "update-agent-release-metadata.mjs");
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.doesNotMatch(workflow, /git push[^\n]*(?:--force|-f(?:\s|$))/);
  assert.match(workflow, /pending_agent_release=true/);
  assert.match(metadataScript, /gitee\.com\/qicuo\/tonghuasun-agent\/releases\/tag\/v/);
});

test("WorkBuddy 正式包本身就是可安装的插件市场", () => {
  const buildScript = readText("scripts", "Build-AgentPlugins.ps1");
  const releaseHelpers = readText("scripts", "release", "Common.ps1");
  const readme = readText("AI-plugins", "workbuddy", "README.md");

  assert.match(buildScript, /name = "fqgate-official"/);
  assert.match(buildScript, /Compress-PackageContents \$marketplaceRoot/);
  assert.match(releaseHelpers, /function Compress-PackageContents/);
  assert.ok(
    readme.includes(
      `plugin marketplace add .\\fqgate-agent-workbuddy-${agentVersion}.zip --name fqgate-official`
    )
  );
  assert.match(readme, /plugin install fqgate-agent@fqgate-official/);
  assert.match(readme, /发行包本身就是正式插件市场/);
});

test("千问安装器复制运行时所需的兼容清单", () => {
  const installer = readText("AI-plugins", "qianwen", "install.ps1");
  assert.match(installer, /metadata\\fqgate-compatibility\.json/);
  assert.match(installer, /sourceCompatibilityPath/);
  assert.match(installer, /Copy-FileIfChanged \$sourceCompatibilityPath/);
});
