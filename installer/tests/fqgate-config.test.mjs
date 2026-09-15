import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertFqgateVersionCompatible,
  configPathFor,
  discoverExecutable,
  isFqgateReady,
  probeFqgate,
  readCompatibilityManifest,
  readConfig,
  validateMcpUrl,
  writeConfig
} from "../runtime/fqgate-config.mjs";

test("配置位置按平台隔离", () => {
  assert.equal(
    configPathFor({ env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, platform: "win32" }),
    "C:\\Users\\tester\\AppData\\Local\\fqgate\\agent-plugin.json"
  );
  assert.equal(
    configPathFor({ env: { HOME: "/Users/tester" }, platform: "darwin" }),
    "/Users/tester/Library/Application Support/fqgate/agent-plugin.json"
  );
});

test("MCP 地址只能使用无凭据的本机 /mcp", () => {
  assert.equal(validateMcpUrl("http://127.0.0.1:17281/mcp"), "http://127.0.0.1:17281/mcp");
  for (const value of [
    "https://127.0.0.1:17281/mcp",
    "http://192.168.1.10:17281/mcp",
    "http://127.0.0.1:17281/openapi.json",
    "http://127.0.0.1:17281/mcp?token=secret"
  ]) {
    assert.throws(() => validateMcpUrl(value));
  }
});

test("共享配置可以原子写入并重新读取", () => {
  const root = mkdtempSync(join(tmpdir(), "fqgate-agent-config-"));
  try {
    const configPath = join(root, "agent-plugin.json");
    const written = writeConfig(
      {
        executablePath: process.execPath,
        mcpUrl: "http://localhost:17281/mcp",
        fqgateVersion: "0.1.0"
      },
      configPath
    );
    const reread = readConfig(configPath);
    assert.equal(reread.executablePath, process.execPath);
    assert.equal(reread.mcpUrl, "http://localhost:17281/mcp");
    assert.equal(reread.fqgateVersion, "0.1.0");
    assert.match(readFileSync(configPath, "utf8"), /"schemaVersion": 1/);
    assert.equal(discoverExecutable({ explicitPath: process.execPath }), process.execPath);
    assert.equal(written.schemaVersion, 1);

    writeConfig(
      {
        executablePath: process.execPath,
        mcpUrl: "http://127.0.0.1:17282/mcp",
        fqgateVersion: "0.1.1"
      },
      configPath
    );
    assert.equal(readConfig(configPath).mcpUrl, "http://127.0.0.1:17282/mcp");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("运行时只检查 FQGate 最低版本，允许更高的主版本", () => {
  const compatibility = readCompatibilityManifest();
  assert.equal(compatibility.minimumVersion, "0.1.0");
  assert.equal(Object.hasOwn(compatibility, "maximumVersionExclusive"), false);
  for (const version of ["0.1.0", "0.1.99-dev.1", "0.2.0", "1.0.0", "2.0.0", "10.0.0"]) {
    assert.equal(assertFqgateVersionCompatible(version, compatibility), true);
  }
  assert.throws(() => assertFqgateVersionCompatible("0.0.99", compatibility), /低于最低要求/);
  assert.throws(() => assertFqgateVersionCompatible("invalid", compatibility), /版本格式无效/);
  assert.throws(() => assertFqgateVersionCompatible("1.0.0", {}), /版本格式无效/);
  assert.throws(() => assertFqgateVersionCompatible("1.4.0", { minimumVersion: "1.5.0" }), /低于最低要求/);
  assert.equal(assertFqgateVersionCompatible("1.10.0", { minimumVersion: "1.5.0" }), true);
  assert.equal(assertFqgateVersionCompatible("1.0.0", {
    ...compatibility,
    maximumVersionExclusive: "0.2.0"
  }), true);
});

test("Windows 安装器的最低版本检查与启动器一致", { skip: process.platform !== "win32" }, () => {
  // 仅载入安装脚本中的纯版本检查函数，避免测试触发下载、安装或进程操作。
  const script = String.raw`
    $ErrorActionPreference = 'Stop'
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $env:FQGATE_VERSION_TEST_ROOT 'runtime/install-fqgate.ps1'),
      [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw '安装脚本语法错误' }
    $function = $ast.Find({ param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq 'Assert-MinimumFqgateVersion'
    }, $true)
    if ($null -eq $function) { throw '未找到最低版本检查函数' }
    . ([scriptblock]::Create($function.Extent.Text))
    foreach ($version in @('0.1.0', '0.2.0', '1.0.0', '2.0.0', '10.0.0')) {
      Assert-MinimumFqgateVersion $version '0.1.0'
    }
    Assert-MinimumFqgateVersion '1.10.0' '1.5.0'
    foreach ($case in @(@('0.0.99', '0.1.0'), @('1.4.0', '1.5.0'), @('invalid', '0.1.0'), @('1.0.0', ''))) {
      $rejected = $false
      try { Assert-MinimumFqgateVersion $case[0] $case[1] } catch { $rejected = $true }
      if (-not $rejected) { throw '未拒绝低于最低要求或无效的版本' }
    }
    Write-Output 'minimum-version-ok'
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, FQGATE_VERSION_TEST_ROOT: fileURLToPath(new URL("..", import.meta.url)) }
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.match(result.stdout, /minimum-version-ok/);
});

test("状态探针统计全部 MCP 工具分页", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), body: options.body });
    if (options.method === "GET") return new Response("{}", { status: 200 });
    const request = JSON.parse(options.body);
    if (request.method === "initialize") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: { serverInfo: { name: "fqgate", version: "0.1.0" } }
      });
    }
    const cursor = request.params.cursor;
    return jsonResponse({
      jsonrpc: "2.0",
      id: request.id,
      result: cursor
        ? { tools: [{ name: "fqgate_market_quote" }] }
        : { tools: [{ name: "fqgate_market_market_health" }], nextCursor: "1" }
    });
  };

  const result = await probeFqgate("http://127.0.0.1:17281/mcp", { fetchImpl: fakeFetch });
  assert.equal(result.healthReachable, true);
  assert.equal(result.mcpReachable, true);
  assert.equal(result.serverVersion, "0.1.0");
  assert.equal(result.toolCount, 2);
  assert.equal(calls.length, 4);
});

test("安装验收必须同时匹配连接、工具和正在运行的版本", () => {
  const ready = {
    mcpReachable: true,
    serverVersion: "0.1.0",
    toolCount: 108
  };
  assert.equal(isFqgateReady(ready), true);
  assert.equal(isFqgateReady(ready, "0.1.0"), true);
  assert.equal(isFqgateReady({ ...ready, toolCount: 0 }, "0.1.0"), false);
  assert.equal(isFqgateReady({ ...ready, mcpReachable: false }, "0.1.0"), false);
  assert.equal(isFqgateReady(ready, "0.1.1"), false);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
