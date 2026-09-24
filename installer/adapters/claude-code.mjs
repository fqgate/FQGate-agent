import { DEFAULT_MCP_URL } from "../runtime/fqgate-config.mjs";
import { fileSummary } from "../core/backup.mjs";
import { commandError } from "../core/process-runner.mjs";

export const claudeCodeAdapter = {
  id: "claude-code",

  async detect(manifest, context) {
    const versionResult = run(context, manifest.executable.command, manifest.executable.versionArgs);
    if (versionResult.error?.code === "ENOENT") return notFound(manifest, context.backupPaths);
    if (!versionResult.ok) throw commandError(versionResult, "检测 Claude Code 版本");

    const marketplaceResult = run(context, manifest.executable.command, ["plugin", "marketplace", "list", "--json"]);
    if (!marketplaceResult.ok) throw commandError(marketplaceResult, "读取 Claude Code 插件市场");
    const pluginResult = run(context, manifest.executable.command, ["plugin", "list", "--json"]);
    if (!pluginResult.ok) throw commandError(pluginResult, "读取 Claude Code 插件列表");

    const clientVersion = parseVersion(versionResult.stdout || versionResult.stderr);
    const compatible = !manifest.executable.minimumVersion || versionAtLeast(clientVersion, manifest.executable.minimumVersion);
    const marketplaces = parseJsonArray(marketplaceResult.stdout, "Claude Code 插件市场列表");
    const plugins = parseJsonArray(pluginResult.stdout, "Claude Code 插件列表");
    const marketplace = marketplaces.find((item) => item?.name === manifest.marketplace.name) || null;
    const plugin = plugins.find((item) => pluginIdentity(item) === manifest.plugin.id) || null;
    const marketplaceExact = !marketplace || containsSource(marketplace, manifest.marketplace.source);
    const accessState = marketplace && !marketplaceExact
      ? "conflict"
      : marketplace && plugin
        ? "configured"
        : marketplace || plugin
          ? "partial"
          : "absent";
    return {
      client_found: true,
      client_version: clientVersion,
      compatible,
      minimum_version: manifest.executable.minimumVersion || null,
      config_source: context.backupPaths.join(", "),
      permissions_checked: ["read_config"],
      access_state: accessState,
      marketplace: marketplace ? { name: marketplace.name, source_matches: marketplaceExact } : null,
      plugin: plugin ? { id: pluginIdentity(plugin) } : null,
      config_summaries: context.backupPaths.map((path) => ({ path, ...fileSummary(path) }))
    };
  },

  async plan(manifest, context, intent) {
    const detected = await this.detect(manifest, context);
    const marketplaceResource = marketplaceResourceId(manifest);
    const pluginResource = pluginResourceId(manifest);
    const actions = [];
    const blockers = [];

    if (!detected.client_found) {
      blockers.push(`${manifest.displayName} 未安装或命令不可用。`);
    } else if (!detected.compatible) {
      blockers.push(`Claude Code ${detected.client_version || "未知版本"} 低于当前插件来源要求的 ${detected.minimum_version}。`);
    } else if (detected.access_state === "conflict") {
      blockers.push("Claude Code 中已经存在同名但来源不同的插件市场，拒绝覆盖用户配置。");
    } else if (intent === "uninstall") {
      if (detected.plugin && context.ownedResources[pluginResource]) {
        actions.push(action("claude_plugin_uninstall", pluginResource, `卸载 Claude Code 插件：${manifest.plugin.id}`));
      } else if (detected.plugin && !context.ownedResources[pluginResource]) {
        blockers.push("当前 FQGate 插件不属于本编排器，拒绝自动卸载。");
      }
      if (detected.marketplace && context.ownedResources[marketplaceResource]) {
        actions.push(action("claude_marketplace_remove", marketplaceResource, `移除 Claude Code 插件市场：${manifest.marketplace.name}`));
      } else if (detected.marketplace && !context.ownedResources[marketplaceResource]) {
        blockers.push("当前 FQGate 插件市场不属于本编排器，拒绝自动移除。");
      }
    } else {
      if (!detected.marketplace) {
        actions.push(action("claude_marketplace_add", marketplaceResource, `添加 Claude Code 插件市场：${manifest.marketplace.source}`));
      }
      if (!detected.plugin) {
        actions.push(action("claude_plugin_install", pluginResource, `安装 Claude Code 插件：${manifest.plugin.id}`));
      }
    }

    return buildDraft(manifest, context, intent, detected, actions, blockers);
  },

  async apply(manifest, context, plan) {
    const completed = [];
    try {
      for (const current of plan.actions) {
        const args = argumentsFor(current.kind, manifest);
        const result = run(context, manifest.executable.command, args);
        if (!result.ok) throw commandError(result, current.summary);
        completed.push(current);
      }
      return ownershipResult(completed, context.backupPaths);
    } catch (error) {
      error.completedActions = completed;
      throw error;
    }
  },

  async rollback(manifest, context, completedActions) {
    for (const current of [...completedActions].reverse()) {
      const reverseKind = reverseAction(current.kind);
      const result = run(context, manifest.executable.command, argumentsFor(reverseKind, manifest));
      if (!result.ok) throw commandError(result, `回滚 ${current.summary}`);
    }
  },

  async verify(manifest, context) {
    const detected = await this.detect(manifest, context);
    if (!detected.client_found || !detected.compatible) {
      return {
        schema_version: 1,
        client_id: manifest.id,
        state: detected.client_found ? "unavailable" : "not_found",
        configuration_written: detected.access_state === "configured",
        client_config_recognized: false,
        client_loaded: null,
        fqgate_ready: null,
        restart_required: false,
        evidence: [detected.client_found
          ? `Claude Code ${detected.client_version || "未知版本"} 低于最低要求 ${detected.minimum_version}。`
          : detected.reason],
        probe: null
      };
    }
    const probe = await context.probe(DEFAULT_MCP_URL);
    const configurationWritten = detected.access_state === "configured";
    const fqgateReady = probe.mcpReachable === true && Number.isInteger(probe.toolCount) && probe.toolCount > 0;
    let state = "repair_required";
    if (configurationWritten && fqgateReady) state = manifest.restart.required ? "restart_required" : "verified";
    else if (configurationWritten) state = "config_written";
    else if (!detected.client_found) state = "not_found";
    return {
      schema_version: 1,
      client_id: manifest.id,
      state,
      configuration_written: configurationWritten,
      client_config_recognized: configurationWritten,
      client_loaded: manifest.restart.required ? null : configurationWritten,
      fqgate_ready: fqgateReady,
      restart_required: configurationWritten && manifest.restart.required,
      evidence: [
        configurationWritten ? "Claude Code CLI 已识别插件与插件市场。" : "Claude Code 插件或插件市场尚未完整安装。",
        fqgateReady ? `FQGate MCP 返回 ${probe.toolCount} 个工具。` : `FQGate MCP 尚不可用：${probe.error || "未返回工具"}`
      ],
      probe
    };
  }
};

function buildDraft(manifest, context, intent, detected, actions, blockers) {
  return {
    detected_basis: detected,
    targets: detected.config_summaries.map((summary) => ({
      config_file: summary.path,
      ownership: "host_cli_managed_resource",
      before_summary: summary.exists ? `sha256:${summary.sha256}` : "文件不存在",
      add: actions.filter((item) => item.kind.endsWith("_add") || item.kind.endsWith("_install")).map((item) => item.summary),
      modify: [],
      remove: actions.filter((item) => item.kind.endsWith("_remove") || item.kind.endsWith("_uninstall")).map((item) => item.summary),
      preserve: ["其他 Claude Code 配置", "其他插件和插件市场"]
    })),
    backup: {
      required: actions.length > 0,
      location: `${context.stateRoot}/backups/<operation_id>`,
      retention: "保留，由用户主动清理"
    },
    permissions: actions.length ? ["read_config", "write_config", "network_for_marketplace"] : ["read_config"],
    restart: manifest.restart,
    rollback: {
      strategy: "restore_backup_and_reverse_registered_actions",
      checkpoint: "before_apply",
      trigger: ["write_failed", "state_record_failed"]
    },
    verify: {
      steps: ["marketplace_exists", "plugin_exists", "client_config_recognized", "fqgate_ready"],
      evidence: ["claude plugin marketplace list --json", "claude plugin list --json", "FQGate MCP initialize/tools/list"]
    },
    risk: blockers.length ? "检测到配置冲突或环境不可用，不允许写入。" : "通过 Claude Code 官方 CLI 管理指定插件和市场，不修改其他配置。",
    actions,
    blockers,
    intent
  };
}

function argumentsFor(kind, manifest) {
  if (kind === "claude_marketplace_add") {
    return ["plugin", "marketplace", "add", manifest.marketplace.source, "--scope", manifest.marketplace.scope];
  }
  if (kind === "claude_marketplace_remove") {
    return ["plugin", "marketplace", "remove", manifest.marketplace.name];
  }
  if (kind === "claude_plugin_install") {
    return ["plugin", "install", manifest.plugin.id, "--scope", manifest.plugin.scope];
  }
  if (kind === "claude_plugin_uninstall") {
    return ["plugin", "uninstall", manifest.plugin.id, "--scope", manifest.plugin.scope];
  }
  throw new Error(`Claude Code Adapter 不支持动作：${kind}`);
}

function reverseAction(kind) {
  const reverse = {
    claude_marketplace_add: "claude_marketplace_remove",
    claude_marketplace_remove: "claude_marketplace_add",
    claude_plugin_install: "claude_plugin_uninstall",
    claude_plugin_uninstall: "claude_plugin_install"
  }[kind];
  if (!reverse) throw new Error(`Claude Code Adapter 无法回滚动作：${kind}`);
  return reverse;
}

function action(kind, resourceId, summary) {
  return { kind, resource_id: resourceId, summary };
}

function marketplaceResourceId(manifest) {
  return `claude-code:marketplace:${manifest.marketplace.name}`;
}

function pluginResourceId(manifest) {
  return `claude-code:plugin:${manifest.plugin.id}`;
}

function ownershipResult(actions, changedFiles) {
  return {
    completedActions: actions,
    changedFiles: actions.length ? changedFiles : [],
    ownershipChanges: {
      add: actions.filter((item) => item.kind.endsWith("_add") || item.kind.endsWith("_install")).map((item) => item.resource_id),
      remove: actions.filter((item) => item.kind.endsWith("_remove") || item.kind.endsWith("_uninstall")).map((item) => item.resource_id)
    }
  };
}

function pluginIdentity(plugin) {
  return plugin?.id || plugin?.plugin || plugin?.name || null;
}

function containsSource(marketplace, expectedSource) {
  return JSON.stringify(marketplace).toLowerCase().includes(expectedSource.toLowerCase());
}

function run(context, command, args) {
  return context.runner.run(command, args, { env: context.env, timeoutMs: 60_000 });
}

function parseJsonArray(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("结果不是数组");
    return parsed;
  } catch (error) {
    throw new Error(`${label}不是有效 JSON：${error.message}`);
  }
}

function parseVersion(value) {
  return String(value || "").match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] || null;
}

function versionAtLeast(current, minimum) {
  if (!current) return false;
  const left = current.split("-")[0].split(".").map(Number);
  const right = minimum.split("-")[0].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function notFound(manifest, backupPaths) {
  return {
    client_found: false,
    client_version: null,
    compatible: false,
    minimum_version: manifest.executable.minimumVersion || null,
    config_source: backupPaths.join(", "),
    permissions_checked: [],
    access_state: "unknown",
    marketplace: null,
    plugin: null,
    config_summaries: backupPaths.map((path) => ({ path, ...fileSummary(path) })),
    reason: `${manifest.executable.command} 命令不存在。`
  };
}
