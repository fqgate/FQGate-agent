import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix as posixPath, resolve, win32 as winPath } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CONFIG_SCHEMA_VERSION = 1;
export const DEFAULT_MCP_URL = "http://127.0.0.1:17281/mcp";

export function configPathFor({ env = process.env, platform = process.platform } = {}) {
  const pathApi = platform === "win32" ? winPath : posixPath;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (!localAppData) {
      throw new Error("LOCALAPPDATA 不可用，无法定位 fqgate-agent 连接配置。");
    }
    return pathApi.join(localAppData, "fqgate", "agent-plugin.json");
  }

  const home = env.HOME?.trim() || homedir();
  if (!home) {
    throw new Error("HOME 不可用，无法定位 fqgate-agent 连接配置。");
  }
  return pathApi.join(home, "Library", "Application Support", "fqgate", "agent-plugin.json");
}

export function validateMcpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`FQGate MCP 地址无效：${value}`);
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    parsed.protocol !== "http:" ||
    !loopbackHosts.has(parsed.hostname) ||
    parsed.pathname !== "/mcp" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("FQGate MCP 只允许使用不含凭据、查询参数和片段的本机 http://.../mcp 地址。");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function readConfig(configPath = configPathFor()) {
  if (!existsSync(configPath)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 fqgate-agent 连接配置：${configPath}：${formatError(error)}`);
  }
  if (value?.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`不支持的 fqgate-agent 连接配置版本：${value?.schemaVersion ?? "缺失"}`);
  }
  if (typeof value.executablePath !== "string" || !value.executablePath.trim()) {
    throw new Error("fqgate-agent 连接配置缺少 executablePath。");
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    executablePath: resolve(value.executablePath),
    mcpUrl: validateMcpUrl(value.mcpUrl || DEFAULT_MCP_URL),
    fqgateVersion: typeof value.fqgateVersion === "string" ? value.fqgateVersion : null,
    updatedAtUtc: typeof value.updatedAtUtc === "string" ? value.updatedAtUtc : null
  };
}

export function writeConfig(config, configPath = configPathFor()) {
  const executablePath = normalizeExecutablePath(config.executablePath);
  const value = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    executablePath,
    mcpUrl: validateMcpUrl(config.mcpUrl || DEFAULT_MCP_URL),
    fqgateVersion: config.fqgateVersion || readFqgateVersion(executablePath),
    updatedAtUtc: new Date().toISOString()
  };
  mkdirSync(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Windows ACL 不使用 POSIX mode；失败不改变配置内容的安全边界。
    }
    renameSync(temporaryPath, configPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  return value;
}

export function removeConfig(configPath = configPathFor()) {
  if (!existsSync(configPath)) return false;
  rmSync(configPath, { force: true });
  return true;
}

export function discoverExecutable({
  explicitPath,
  configuredPath,
  env = process.env,
  platform = process.platform
} = {}) {
  const candidates = [];
  addCandidate(candidates, explicitPath);
  addCandidate(candidates, env.FQGATE_EXECUTABLE);
  addCandidate(candidates, configuredPath);
  for (const candidate of defaultExecutablePaths({ env, platform })) addCandidate(candidates, candidate);
  addCandidate(candidates, findExecutableOnPath({ env, platform }));

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
    } catch {
      // 候选路径不可读时继续检查其他明确候选，不递归扫描磁盘。
    }
  }
  return null;
}

export function defaultExecutablePaths({ env = process.env, platform = process.platform } = {}) {
  const pathApi = platform === "win32" ? winPath : posixPath;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    const programFiles = env.ProgramFiles?.trim();
    return [
      localAppData ? pathApi.join(localAppData, "FQGate", "fqgate.exe") : null,
      localAppData ? pathApi.join(localAppData, "Programs", "FQGate", "fqgate.exe") : null,
      programFiles ? pathApi.join(programFiles, "FQGate", "fqgate.exe") : null
    ].filter(Boolean);
  }

  const home = env.HOME?.trim() || homedir();
  return [
    home ? pathApi.join(home, "Applications", "FQGate.app", "Contents", "MacOS", "fqgate") : null,
    "/Applications/FQGate.app/Contents/MacOS/fqgate",
    home ? pathApi.join(home, ".local", "bin", "fqgate") : null,
    "/opt/homebrew/bin/fqgate",
    "/usr/local/bin/fqgate"
  ].filter(Boolean);
}

export function readFqgateVersion(executablePath) {
  const normalized = normalizeExecutablePath(executablePath);
  const result = spawnSync(normalized, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000
  });
  if (result.error) {
    throw new Error(`无法执行 FQGate：${formatError(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(`FQGate 版本检查失败：${(result.stderr || result.stdout || "未知错误").trim()}`);
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/\bfqgate\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i);
  if (!match) throw new Error("FQGate --version 未返回可识别的语义版本号。");
  return match[1];
}

export function readCompatibilityManifest(scriptUrl = import.meta.url) {
  const scriptDirectory = dirname(fileURLToPath(scriptUrl));
  const candidates = [
    join(scriptDirectory, "..", "metadata", "fqgate-compatibility.json"),
    join(scriptDirectory, "..", "..", "fqgate", "compatibility.json")
  ];
  const compatibilityPath = candidates.find((candidate) => existsSync(candidate));
  if (!compatibilityPath) {
    throw new Error("缺少 FQGate 兼容清单，拒绝在未知版本边界下启动。");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(compatibilityPath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 FQGate 兼容清单：${compatibilityPath}：${formatError(error)}`);
  }
  const minimumVersion = manifest?.fqgate?.minimumVersion;
  parseVersionCore(minimumVersion);
  return { compatibilityPath, minimumVersion };
}

export function assertFqgateVersionCompatible(version, range = readCompatibilityManifest()) {
  const current = parseVersionCore(version);
  const minimum = parseVersionCore(range.minimumVersion);
  if (compareVersionCore(current, minimum) < 0) {
    throw new Error(
      `FQGate ${version} 低于最低要求 ${range.minimumVersion}，请升级后重试。`
    );
  }
  return true;
}

export async function probeFqgate(mcpUrl, { timeoutMs = 3_000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 不支持 fetch，请使用 Node.js 18 或更新版本。");
  }
  const normalizedMcpUrl = validateMcpUrl(mcpUrl);
  const healthUrl = new URL(normalizedMcpUrl);
  healthUrl.pathname = "/v1/market/health";
  const result = {
    healthReachable: false,
    mcpReachable: false,
    serverVersion: null,
    toolCount: null,
    error: null
  };

  try {
    const health = await fetchWithTimeout(fetchImpl, healthUrl, { method: "GET" }, timeoutMs);
    result.healthReachable = health.ok;
  } catch (error) {
    result.error = formatError(error);
  }

  try {
    const initialize = await callMcp(fetchImpl, normalizedMcpUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fqgate-agent-configure", version: "1.0.0" }
      }
    }, timeoutMs);
    result.mcpReachable = initialize?.result?.serverInfo?.name === "fqgate";
    result.serverVersion = initialize?.result?.serverInfo?.version ?? null;

    if (result.mcpReachable) {
      let cursor;
      let toolCount = 0;
      let requestId = 2;
      do {
        const page = await callMcp(fetchImpl, normalizedMcpUrl, {
          jsonrpc: "2.0",
          id: requestId++,
          method: "tools/list",
          params: cursor ? { cursor } : {}
        }, timeoutMs);
        toolCount += Array.isArray(page?.result?.tools) ? page.result.tools.length : 0;
        cursor = page?.result?.nextCursor;
      } while (cursor);
      result.toolCount = toolCount;
    }
  } catch (error) {
    result.error = formatError(error);
  }
  return result;
}

export function isFqgateReady(probe, expectedVersion = null) {
  if (probe?.mcpReachable !== true || !Number.isInteger(probe.toolCount) || probe.toolCount <= 0) {
    return false;
  }
  return !expectedVersion || probe.serverVersion === expectedVersion;
}

export function parseBoolean(value) {
  return /^(1|true|yes|on|structured-json)$/i.test(String(value || "").trim());
}

function normalizeExecutablePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("FQGate 可执行文件路径不能为空。");
  const normalized = resolve(value.trim());
  if (!isAbsolute(normalized) || !existsSync(normalized) || !statSync(normalized).isFile()) {
    throw new Error(`没有找到 FQGate 可执行文件：${normalized}`);
  }
  return normalized;
}

function findExecutableOnPath({ env, platform }) {
  const command = platform === "win32" ? "where.exe" : "which";
  const executable = platform === "win32" ? "fqgate.exe" : "fqgate";
  const result = spawnSync(command, [executable], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
    env
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || null;
}

function addCandidate(candidates, value) {
  if (typeof value !== "string" || !value.trim()) return;
  const normalized = resolve(value.trim());
  if (!candidates.some((candidate) => samePath(candidate, normalized))) candidates.push(normalized);
}

function parseVersionCore(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`FQGate 版本格式无效：${value ?? "缺失"}`);
  return match.slice(1).map(Number);
}

function compareVersionCore(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function callMcp(fetchImpl, mcpUrl, message, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, mcpUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  }, timeoutMs);
  if (!response.ok) throw new Error(`MCP 返回 HTTP ${response.status}`);
  const value = await response.json();
  if (value?.error) throw new Error(value.error.message || "MCP 请求失败");
  return value;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
