import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expandTemplate, loadManifest, loadManifestDirectory } from "../core/manifest.mjs";

const installerRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("内置 YAML 清单只能选择已注册 Adapter", () => {
  const manifests = loadManifestDirectory(join(installerRoot, "manifests"));
  assert.deepEqual(manifests.map((item) => item.id), ["claude-code", "codex"]);
  const codex = manifests.find((item) => item.id === "codex");
  assert.equal(codex.connection.url, "http://127.0.0.1:17281/mcp");
  assert.deepEqual(codex.skills.map((item) => item.id), [
    "fqgate-realtime-stock-analyzer",
    "trade-execution"
  ]);
  assert.equal(manifests.find((item) => item.id === "claude-code").plugin.id, "fqgate-agent@tonghuasun-agent");
});

test("YAML 拒绝任意命令字段和未登记变量", () => {
  const root = mkdtempSync(join(tmpdir(), "fqgate-manifest-test-"));
  try {
    const manifestPath = join(root, "unsafe.yaml");
    writeFileSync(manifestPath, `
schemaVersion: 1
id: codex
displayName: Codex
adapter: codex
run: rm -rf /
executable:
  command: codex
  versionArgs: [--version]
connection:
  name: fqgate
  transport: http
  url: http://127.0.0.1:17281/mcp
backup:
  paths: ["\${HOME}/.codex/config.toml"]
restart:
  required: true
  reason: reload
`, "utf8");
    assert.throws(() => loadManifest(manifestPath), /未知字段：run/);
    assert.throws(() => expandTemplate("${UNSAFE}/config", {}), /不允许的变量/);

    const builtIn = readFileSync(join(installerRoot, "manifests", "codex.yaml"), "utf8");
    writeFileSync(manifestPath, builtIn.replace("command: codex", "command: rm"), "utf8");
    assert.throws(() => loadManifest(manifestPath), /只允许调用 codex/);

    writeFileSync(manifestPath, builtIn.replace("- --version", "- mcp\n    - remove\n    - fqgate"), "utf8");
    assert.throws(() => loadManifest(manifestPath), /只允许 --version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("YAML 拒绝非本机 MCP 地址", () => {
  const root = mkdtempSync(join(tmpdir(), "fqgate-manifest-url-test-"));
  try {
    const source = join(installerRoot, "manifests", "codex.yaml");
    const manifestPath = join(root, "codex.yaml");
    const text = readFileSync(source, "utf8")
      .replace("http://127.0.0.1:17281/mcp", "https://example.com/mcp");
    writeFileSync(manifestPath, text, "utf8");
    assert.throws(() => loadManifest(manifestPath), /只允许.*本机/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("YAML 拒绝把 Codex Skill 改为未登记来源或目标", () => {
  const root = mkdtempSync(join(tmpdir(), "fqgate-manifest-skill-test-"));
  try {
    const source = join(installerRoot, "manifests", "codex.yaml");
    const manifestPath = join(root, "codex.yaml");
    const text = readFileSync(source, "utf8");
    writeFileSync(manifestPath, text.replace(
      "../../skills/trade-execution",
      "../../skills/unknown"
    ), "utf8");
    assert.throws(() => loadManifest(manifestPath), /不是受控的 FQGate 官方路径/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
