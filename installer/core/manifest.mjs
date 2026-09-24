import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parse } from "yaml";

const SUPPORTED_ADAPTERS = new Set(["codex", "claude-code"]);
const ALLOWED_TEMPLATE_VARIABLES = new Set([
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_USER_CONFIG"
]);

export function loadManifest(manifestPath) {
  const resolvedPath = resolve(manifestPath);
  if (!existsSync(resolvedPath)) throw new Error(`编排清单不存在：${resolvedPath}`);

  let manifest;
  try {
    manifest = parse(readFileSync(resolvedPath, "utf8"), {
      maxAliasCount: 0,
      uniqueKeys: true
    });
  } catch (error) {
    throw new Error(`无法解析 YAML 编排清单 ${resolvedPath}：${formatError(error)}`);
  }
  validateManifest(manifest, resolvedPath);
  return Object.freeze({ ...manifest, manifestPath: resolvedPath });
}

export function loadManifestDirectory(manifestDirectory) {
  const resolvedDirectory = resolve(manifestDirectory);
  return readdirSync(resolvedDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name).toLowerCase()))
    .map((entry) => loadManifest(join(resolvedDirectory, entry.name)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function expandTemplate(value, variables) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!ALLOWED_TEMPLATE_VARIABLES.has(name)) {
      throw new Error(`YAML 使用了不允许的变量：${name}`);
    }
    const replacement = variables[name];
    if (typeof replacement !== "string" || !replacement.trim()) {
      throw new Error(`YAML 变量没有可用值：${name}`);
    }
    return replacement;
  });
}

function validateManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`YAML 编排清单必须是对象：${manifestPath}`);
  }
  assertExactKeys(manifest, [
    "schemaVersion",
    "id",
    "displayName",
    "adapter",
    "executable",
    "connection",
    "skills",
    "marketplace",
    "plugin",
    "backup",
    "restart"
  ], "清单根节点");
  if (manifest.schemaVersion !== 1) throw new Error("只支持 schemaVersion: 1。");
  assertIdentifier(manifest.id, "id");
  assertNonEmptyString(manifest.displayName, "displayName");
  if (!SUPPORTED_ADAPTERS.has(manifest.adapter)) {
    throw new Error(`不支持的 adapter：${manifest.adapter ?? "缺失"}`);
  }
  if (manifest.adapter !== manifest.id) {
    throw new Error("第一版要求 id 与 adapter 保持一致，避免清单加载错误的执行器。");
  }

  assertExactKeys(manifest.executable, ["command", "versionArgs", "minimumVersion"], "executable");
  assertIdentifier(manifest.executable.command, "executable.command");
  assertStringArray(manifest.executable.versionArgs, "executable.versionArgs");
  if (manifest.executable.minimumVersion !== undefined) {
    assertSemanticVersion(manifest.executable.minimumVersion, "executable.minimumVersion");
  }

  assertExactKeys(manifest.backup, ["paths"], "backup");
  assertStringArray(manifest.backup.paths, "backup.paths", { allowEmpty: false });
  for (const value of manifest.backup.paths) validateTemplate(value);

  assertExactKeys(manifest.restart, ["required", "reason"], "restart");
  if (typeof manifest.restart.required !== "boolean") {
    throw new Error("restart.required 必须是布尔值。");
  }
  assertNonEmptyString(manifest.restart.reason, "restart.reason");

  if (manifest.adapter === "codex") validateCodex(manifest);
  else validateClaudeCode(manifest);
}

function validateCodex(manifest) {
  if (!new Set(["codex", "codex.exe"]).has(manifest.executable.command.toLowerCase())) {
    throw new Error("Codex Adapter 只允许调用 codex 命令。");
  }
  assertVersionArguments(manifest.executable.versionArgs);
  if (manifest.marketplace || manifest.plugin) {
    throw new Error("Codex 清单不能声明 marketplace 或 plugin。");
  }
  assertExactKeys(manifest.connection, ["name", "transport", "url"], "connection");
  assertIdentifier(manifest.connection.name, "connection.name");
  if (manifest.connection.name !== "fqgate") {
    throw new Error("第一版 Codex Adapter 只管理名为 fqgate 的 MCP。");
  }
  if (manifest.connection.transport !== "http") {
    throw new Error("第一版 Codex 只支持 http MCP 连接。");
  }
  assertLoopbackMcpUrl(manifest.connection.url);
  validateCodexSkills(manifest);
}

function validateClaudeCode(manifest) {
  if (!new Set(["claude", "claude.exe"]).has(manifest.executable.command.toLowerCase())) {
    throw new Error("Claude Code Adapter 只允许调用 claude 命令。");
  }
  assertVersionArguments(manifest.executable.versionArgs);
  if (manifest.connection || manifest.skills) throw new Error("Claude Code 清单不能声明 connection 或 skills。");
  assertExactKeys(manifest.marketplace, ["source", "name", "scope"], "marketplace");
  assertNonEmptyString(manifest.marketplace.source, "marketplace.source");
  assertIdentifier(manifest.marketplace.name, "marketplace.name");
  assertScope(manifest.marketplace.scope, "marketplace.scope");
  assertExactKeys(manifest.plugin, ["id", "scope"], "plugin");
  assertNonEmptyString(manifest.plugin.id, "plugin.id");
  assertScope(manifest.plugin.scope, "plugin.scope");
  if (
    manifest.marketplace.source !== "fqgate/FQGate-agent" ||
    manifest.marketplace.name !== "tonghuasun-agent" ||
    manifest.marketplace.scope !== "user" ||
    manifest.plugin.id !== "fqgate-agent@tonghuasun-agent" ||
    manifest.plugin.scope !== "user"
  ) {
    throw new Error("第一版 Claude Code Adapter 只允许管理 FQGate 官方用户级插件与市场。");
  }
}

function validateCodexSkills(manifest) {
  if (!Array.isArray(manifest.skills) || manifest.skills.length !== 2) {
    throw new Error("第一版 Codex Adapter 必须声明两个 FQGate 官方 Skill。");
  }
  const expectedIds = ["fqgate-realtime-stock-analyzer", "trade-execution"];
  const actualIds = manifest.skills.map((skill) => skill?.id).sort();
  if (actualIds.join("\0") !== [...expectedIds].sort().join("\0")) {
    throw new Error("第一版 Codex Adapter 只允许安装两个 FQGate 官方 Skill。");
  }
  for (const skill of manifest.skills) {
    assertExactKeys(skill, ["id", "source", "adapterInstructions", "target"], `skills.${skill?.id ?? "unknown"}`);
    assertIdentifier(skill.id, "skills.id");
    const expected = {
      source: `../../skills/${skill.id}`,
      adapterInstructions: "../../AI-plugins/codex/ADAPTER.md",
      target: `\${CODEX_HOME}/skills/${skill.id}`
    };
    for (const [key, value] of Object.entries(expected)) {
      if (skill[key] !== value) {
        throw new Error(`skills.${skill.id}.${key} 不是受控的 FQGate 官方路径。`);
      }
    }
    validateTemplate(skill.target);
  }

  const requiredBackupPaths = [
    "${CODEX_HOME}/config.toml",
    ...manifest.skills.map((skill) => skill.target)
  ];
  if (
    manifest.backup.paths.length !== requiredBackupPaths.length ||
    requiredBackupPaths.some((path) => !manifest.backup.paths.includes(path))
  ) {
    throw new Error("Codex backup.paths 必须完整包含配置文件和两个 Skill 目标目录。");
  }
}

function validateTemplate(value) {
  for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    if (!ALLOWED_TEMPLATE_VARIABLES.has(match[1])) {
      throw new Error(`backup.paths 使用了不允许的变量：${match[1]}`);
    }
  }
  const withoutTemplates = value.replace(/\$\{[A-Z0-9_]+\}/g, "");
  if (withoutTemplates.includes("${")) throw new Error(`backup.paths 包含无效变量：${value}`);
}

function assertLoopbackMcpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`connection.url 不是有效 URL：${value}`);
  }
  if (
    parsed.protocol !== "http:" ||
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname) ||
    parsed.pathname !== "/mcp" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("connection.url 只允许不含凭据、查询参数和片段的本机 http://.../mcp 地址。");
  }
}

function assertExactKeys(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} 包含未知字段：${unexpected.join(", ")}`);
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${label} 必须是安全标识符。`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 不能为空。`);
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} 必须是${allowEmpty ? "" : "非空"}字符串数组。`);
  }
}

function assertScope(value, label) {
  if (!new Set(["user", "project", "local"]).has(value)) {
    throw new Error(`${label} 必须是 user、project 或 local。`);
  }
}

function assertSemanticVersion(value, label) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} 必须是语义版本号。`);
  }
}

function assertVersionArguments(value) {
  if (value.length !== 1 || value[0] !== "--version") {
    throw new Error("executable.versionArgs 只允许 --version，只读检测不能执行其他子命令。");
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function manifestLabel(manifest) {
  return `${manifest.displayName} (${basename(manifest.manifestPath)})`;
}
