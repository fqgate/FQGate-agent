import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InstallerOrchestrator, OrchestrationError } from "../core/orchestrator.mjs";

const installerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestDirectory = join(installerRoot, "manifests");

test("plan 无副作用，apply 需要显式确认且过期计划会被拒绝", async () => {
  const fixture = createFixture();
  try {
    const plan = await fixture.orchestrator.plan("codex");
    assert.equal(plan.state, "plan_pending_confirmation");
    assert.equal(plan.confirmation_required, true);
    assert.deepEqual(plan.actions.map((item) => item.kind), [
      "codex_mcp_add",
      "codex_skill_install",
      "codex_skill_install"
    ]);
    assert.equal(existsSync(fixture.stateRoot), false);
    assert.equal(existsSync(fixture.configPath), false);
    assert.equal(fixture.skillPaths.some((path) => existsSync(path)), false);

    await assert.rejects(
      fixture.orchestrator.apply("codex", { planId: plan.plan_id }),
      /使用 --yes/
    );

    fixture.host.configured = true;
    writeConfig(fixture.configPath, "[mcp_servers.fqgate]\nurl = \"http://127.0.0.1:17281/mcp\"\n");
    await assert.rejects(
      fixture.orchestrator.apply("codex", { planId: plan.plan_id, confirmed: true }),
      /plan 已过期/
    );
  } finally {
    fixture.cleanup();
  }
});

test("Codex 完成预览、备份、应用、分层验证和受所有权保护的卸载", async () => {
  const fixture = createFixture();
  try {
    writeConfig(fixture.configPath, "model = \"gpt-test\"\n");
    const installPlan = await fixture.orchestrator.plan("codex");
    const applied = await fixture.orchestrator.apply("codex", {
      planId: installPlan.plan_id,
      confirmed: true
    });

    assert.equal(applied.state, "applied");
    assert.equal(applied.lifecycle_state, "config_written");
    assert.equal(applied.backup.created, true);
    assert.equal(fixture.host.configured, true);
    assert.match(readFileSync(fixture.configPath, "utf8"), /model = "gpt-test"/);
    assert.match(readFileSync(fixture.configPath, "utf8"), /mcp_servers\.fqgate/);
    for (const skillPath of fixture.skillPaths) {
      assert.equal(existsSync(skillPath), true);
      assert.match(readFileSync(join(skillPath, "SKILL.md"), "utf8"), /## Codex 适配/);
      assert.equal(existsSync(join(skillPath, "agents", "openai.yaml")), true);
    }
    assert.equal(existsSync(join(fixture.stateRoot, "state.json")), true);

    const verified = await fixture.orchestrator.verify("codex");
    assert.equal(verified.configuration_written, true);
    assert.equal(verified.skills_installed, true);
    assert.equal(verified.installed_skill_count, 2);
    assert.equal(verified.fqgate_ready, true);
    assert.equal(verified.client_loaded, null);
    assert.equal(verified.state, "restart_required");

    const uninstallPlan = await fixture.orchestrator.plan("codex", "uninstall");
    assert.deepEqual(uninstallPlan.actions.map((item) => item.kind), [
      "codex_mcp_remove",
      "codex_skill_remove",
      "codex_skill_remove"
    ]);
    const uninstalled = await fixture.orchestrator.uninstall("codex", {
      planId: uninstallPlan.plan_id,
      confirmed: true
    });
    assert.equal(uninstalled.state, "applied");
    assert.equal(fixture.host.configured, false);
    assert.equal(fixture.skillPaths.some((path) => existsSync(path)), false);

    const secondUninstall = await fixture.orchestrator.plan("codex", "uninstall");
    assert.equal(secondUninstall.state, "no_changes");
    assert.equal(secondUninstall.actions.length, 0);
    assert.equal(secondUninstall.blockers.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("同名非托管配置不会被覆盖或卸载", async () => {
  const fixture = createFixture();
  try {
    fixture.host.configured = true;
    fixture.host.url = "http://127.0.0.1:19999/mcp";
    writeConfig(fixture.configPath, "[mcp_servers.fqgate]\nurl = \"http://127.0.0.1:19999/mcp\"\n");
    const repairPlan = await fixture.orchestrator.repair("codex");
    assert.equal(repairPlan.state, "unavailable");
    assert.match(repairPlan.blockers[0], /拒绝覆盖/);

    fixture.host.url = "http://127.0.0.1:17281/mcp";
    const uninstallPlan = await fixture.orchestrator.plan("codex", "uninstall");
    assert.equal(uninstallPlan.actions.length, 0);
    assert.match(uninstallPlan.blockers[0], /不属于本编排器/);
  } finally {
    fixture.cleanup();
  }
});

test("同名非托管 Skill 内容不同时不会被覆盖", async () => {
  const fixture = createFixture();
  try {
    fixture.host.configured = true;
    writeConfig(fixture.configPath, "[mcp_servers.fqgate]\nurl = \"http://127.0.0.1:17281/mcp\"\n");
    mkdirSync(fixture.skillPaths[0], { recursive: true });
    writeFileSync(join(fixture.skillPaths[0], "SKILL.md"), "用户自己的 Skill\n", "utf8");

    const plan = await fixture.orchestrator.plan("codex");
    assert.equal(plan.state, "unavailable");
    assert.match(plan.blockers.join(" "), /内容不同.*拒绝覆盖/);
    assert.equal(readFileSync(join(fixture.skillPaths[0], "SKILL.md"), "utf8"), "用户自己的 Skill\n");
  } finally {
    fixture.cleanup();
  }
});

test("应用失败会恢复写入前配置并返回结构化回滚结果", async () => {
  const fixture = createFixture({ failAdd: true });
  try {
    const original = "model = \"keep-me\"\n";
    writeConfig(fixture.configPath, original);
    const plan = await fixture.orchestrator.plan("codex");
    let thrown;
    try {
      await fixture.orchestrator.apply("codex", { planId: plan.plan_id, confirmed: true });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof OrchestrationError);
    assert.equal(thrown.result.state, "rolled_back");
    assert.equal(thrown.result.rollback.state, "succeeded");
    assert.equal(readFileSync(fixture.configPath, "utf8"), original);
    assert.equal(fixture.host.configured, false);
    assert.equal(fixture.skillPaths.some((path) => existsSync(path)), false);
  } finally {
    fixture.cleanup();
  }
});

test("Claude Code 计划由受控动作组成，不暴露任意命令", async () => {
  const fixture = createFixture();
  try {
    const plan = await fixture.orchestrator.plan("claude-code");
    assert.deepEqual(plan.actions.map((item) => item.kind), [
      "claude_marketplace_add",
      "claude_plugin_install"
    ]);
    assert.equal(plan.actions.every((item) => !Object.hasOwn(item, "command")), true);
    assert.equal(plan.backup.required, true);
  } finally {
    fixture.cleanup();
  }
});

test("不满足 archive 来源最低版本的 Claude Code 只报告不可用", async () => {
  const fixture = createFixture({ claudeVersion: "2.1.119" });
  try {
    const detected = await fixture.orchestrator.detect("claude-code");
    assert.equal(detected.state, "unavailable");
    assert.equal(detected.compatible, false);
    assert.equal(detected.minimum_version, "2.1.224");
    const plan = await fixture.orchestrator.plan("claude-code");
    assert.equal(plan.actions.length, 0);
    assert.match(plan.blockers[0], /低于当前插件来源要求/);
    const verified = await fixture.orchestrator.verify("claude-code");
    assert.equal(verified.state, "unavailable");
    assert.equal(verified.probe, null);
    assert.equal(existsSync(fixture.stateRoot), false);
  } finally {
    fixture.cleanup();
  }
});

function createFixture({ failAdd = false, claudeVersion = "2.1.224" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fqgate-orchestrator-test-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const claudeHome = join(home, ".claude");
  const stateRoot = join(root, "state");
  const configPath = join(codexHome, "config.toml");
  const skillPaths = [
    join(codexHome, "skills", "fqgate-realtime-stock-analyzer"),
    join(codexHome, "skills", "trade-execution")
  ];
  const host = {
    configured: false,
    url: "http://127.0.0.1:17281/mcp",
    marketplace: false,
    plugin: false
  };
  const runner = {
    run(command, args) {
      if (command === "codex") return runCodex(host, configPath, args, failAdd);
      if (command === "claude") return runClaude(host, args, claudeVersion);
      return failed(`未知测试命令：${command}`);
    }
  };
  const orchestrator = new InstallerOrchestrator({
    manifestDirectory,
    runner,
    env: {
      HOME: home,
      CODEX_HOME: codexHome,
      CLAUDE_CONFIG_DIR: claudeHome,
      PATH: process.env.PATH
    },
    platform: process.platform,
    stateRoot,
    probe: async () => ({
      healthReachable: true,
      mcpReachable: true,
      serverVersion: "2.0.0",
      toolCount: 12,
      error: null
    })
  });
  return {
    root,
    stateRoot,
    configPath,
    skillPaths,
    host,
    orchestrator,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function runCodex(host, configPath, args, failAdd) {
  if (args[0] === "--version") return succeeded("codex-cli 0.142.5\n");
  if (args.join(" ") === "mcp list --json") {
    return succeeded(JSON.stringify(host.configured ? [{
      name: "fqgate",
      enabled: true,
      transport: { type: "streamable_http", url: host.url }
    }] : []));
  }
  if (args[0] === "mcp" && args[1] === "add") {
    host.configured = true;
    host.url = args[4];
    const previous = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    writeConfig(configPath, `${previous}${previous && !previous.endsWith("\n") ? "\n" : ""}[mcp_servers.fqgate]\nurl = "${host.url}"\n`);
    if (failAdd) {
      host.configured = false;
      return failed("模拟 Codex 写入后失败");
    }
    return succeeded("Added global MCP server 'fqgate'.\n");
  }
  if (args[0] === "mcp" && args[1] === "remove") {
    host.configured = false;
    if (existsSync(configPath)) {
      const preserved = readFileSync(configPath, "utf8").replace(/\[mcp_servers\.fqgate\]\nurl = "[^"]+"\n?/g, "");
      writeConfig(configPath, preserved);
    }
    return succeeded("Removed global MCP server 'fqgate'.\n");
  }
  return failed(`不支持的 Codex 测试参数：${args.join(" ")}`);
}

function runClaude(host, args, version) {
  if (args[0] === "--version") return succeeded(`${version} (Claude Code)\n`);
  if (args.join(" ") === "plugin marketplace list --json") {
    return succeeded(JSON.stringify(host.marketplace ? [{
      name: "tonghuasun-agent",
      source: "fqgate/FQGate-agent"
    }] : []));
  }
  if (args.join(" ") === "plugin list --json") {
    return succeeded(JSON.stringify(host.plugin ? [{ id: "fqgate-agent@tonghuasun-agent" }] : []));
  }
  return succeeded("");
}

function writeConfig(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function succeeded(stdout) {
  return { status: 0, stdout, stderr: "", error: null, ok: true };
}

function failed(stderr) {
  return { status: 1, stdout: "", stderr, error: null, ok: false };
}
