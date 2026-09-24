import { fileSummary } from "../core/backup.mjs";
import { inspectCodexSkill, installCodexSkill, removeCodexSkill } from "../core/codex-skills.mjs";
import { commandError } from "../core/process-runner.mjs";

export const codexAdapter = {
  id: "codex",

  async detect(manifest, context) {
    const configPath = context.backupPaths[0];
    const skills = detectSkills(context);
    const versionResult = run(context, manifest.executable.command, manifest.executable.versionArgs);
    if (isMissingCommand(versionResult)) return notFound(manifest, configPath, skills);
    if (!versionResult.ok) throw commandError(versionResult, "检测 Codex 版本");

    const listResult = run(context, manifest.executable.command, ["mcp", "list", "--json"]);
    if (!listResult.ok) throw commandError(listResult, "读取 Codex MCP 配置");
    const servers = parseJsonArray(listResult.stdout, "Codex MCP 列表");
    const server = servers.find((item) => item?.name === manifest.connection.name) || null;
    const actualUrl = server?.transport?.type === "streamable_http" ? server.transport.url : null;
    const mcpAccessState = !server
      ? "absent"
      : actualUrl === manifest.connection.url
        ? "configured"
        : "conflict";
    return {
      client_found: true,
      client_version: parseVersion(versionResult.stdout || versionResult.stderr),
      config_source: configPath,
      permissions_checked: ["read_config", "read_skills"],
      access_state: aggregateAccessState(mcpAccessState, skills),
      mcp_access_state: mcpAccessState,
      actual: server ? summarizeServer(server) : null,
      config_summary: fileSummary(configPath),
      skills
    };
  },

  async plan(manifest, context, intent) {
    const detected = await this.detect(manifest, context);
    const actions = [];
    const blockers = [];
    const mcpResourceId = resourceIdForMcp(manifest);

    if (!detected.client_found) {
      blockers.push(`${manifest.displayName} 未安装或命令不可用。`);
    } else if (intent === "uninstall") {
      if (detected.mcp_access_state === "configured" && context.ownedResources[mcpResourceId]) {
        actions.push(action(
          "codex_mcp_remove",
          mcpResourceId,
          `移除 Codex MCP：${manifest.connection.name}`,
          detected.config_source
        ));
      } else if (detected.mcp_access_state === "configured") {
        blockers.push("当前 fqgate MCP 不属于本编排器，拒绝自动删除。");
      }
    } else if (detected.mcp_access_state === "absent") {
      actions.push(action(
        "codex_mcp_add",
        mcpResourceId,
        `添加 Codex MCP：${manifest.connection.name}`,
        detected.config_source
      ));
    } else if (detected.mcp_access_state === "conflict") {
      blockers.push("Codex 中已经存在同名但配置不同的 fqgate MCP，拒绝覆盖用户配置。");
    }

    for (const skill of detected.skills) {
      const resourceId = resourceIdForSkill(skill.id);
      const owned = Boolean(context.ownedResources[resourceId]);
      if (skill.error) {
        blockers.push(`无法读取 Skill ${skill.id}：${skill.error}`);
      } else if (intent === "uninstall") {
        if (skill.access_state === "configured" && owned) {
          actions.push(skillAction("codex_skill_remove", resourceId, skill, `移除 Codex Skill：${skill.id}`));
        } else if (skill.access_state === "conflict" && owned) {
          blockers.push(`Codex Skill ${skill.id} 已被修改，拒绝自动删除。`);
        }
      } else if (skill.access_state === "absent") {
        actions.push(skillAction("codex_skill_install", resourceId, skill, `安装 Codex Skill：${skill.id}`));
      } else if (skill.access_state === "conflict" && owned) {
        actions.push(skillAction("codex_skill_replace", resourceId, skill, `修复 Codex Skill：${skill.id}`));
      } else if (skill.access_state === "conflict") {
        blockers.push(`Codex Skill ${skill.id} 已存在且内容不同，拒绝覆盖用户文件。`);
      }
    }

    return buildDraft(manifest, context, intent, detected, actions, blockers);
  },

  async apply(manifest, context, plan) {
    const completed = [];
    try {
      for (const current of plan.actions) {
        let result = null;
        if (current.kind === "codex_mcp_add") {
          result = run(context, manifest.executable.command, [
            "mcp",
            "add",
            manifest.connection.name,
            "--url",
            manifest.connection.url
          ]);
        } else if (current.kind === "codex_mcp_remove") {
          result = run(context, manifest.executable.command, ["mcp", "remove", manifest.connection.name]);
        } else if (current.kind === "codex_skill_install" || current.kind === "codex_skill_replace") {
          installCodexSkill(findSkill(context, current.skill_id));
        } else if (current.kind === "codex_skill_remove") {
          removeCodexSkill(findSkill(context, current.skill_id));
        } else {
          throw new Error(`Codex Adapter 不支持动作：${current.kind}`);
        }
        if (result && !result.ok) throw commandError(result, current.summary);
        completed.push(current);
      }
      return ownershipResult(completed);
    } catch (error) {
      error.completedActions = completed;
      throw error;
    }
  },

  async rollback(manifest, context, completedActions) {
    for (const current of [...completedActions].reverse()) {
      if (!current.kind.startsWith("codex_mcp_")) continue;
      const args = current.kind === "codex_mcp_add"
        ? ["mcp", "remove", manifest.connection.name]
        : ["mcp", "add", manifest.connection.name, "--url", manifest.connection.url];
      const result = run(context, manifest.executable.command, args);
      if (!result.ok) throw commandError(result, `回滚 ${current.summary}`);
    }
  },

  async verify(manifest, context) {
    const detected = await this.detect(manifest, context);
    const probe = await context.probe(manifest.connection.url);
    return verification(manifest, detected, probe, "Codex CLI 已读取该 MCP 配置；正在运行的 Codex 会话仍需重新加载。 ");
  }
};

function buildDraft(manifest, context, intent, detected, actions, blockers) {
  const configSummary = detected.config_summary;
  const targets = [{
    config_file: detected.config_source,
    ownership: "adapter_managed_resource",
    before_summary: summaryText(configSummary),
    add: actions.filter((item) => item.kind === "codex_mcp_add").map((item) => item.summary),
    modify: [],
    remove: actions.filter((item) => item.kind === "codex_mcp_remove").map((item) => item.summary),
    preserve: ["其他 Codex 配置", "其他 MCP"]
  }];
  for (const skill of detected.skills) {
    targets.push({
      config_file: skill.target_path,
      ownership: "adapter_managed_resource",
      before_summary: summaryText(skill.actual),
      add: actions.filter((item) => item.kind === "codex_skill_install" && item.skill_id === skill.id).map((item) => item.summary),
      modify: actions.filter((item) => item.kind === "codex_skill_replace" && item.skill_id === skill.id).map((item) => item.summary),
      remove: actions.filter((item) => item.kind === "codex_skill_remove" && item.skill_id === skill.id).map((item) => item.summary),
      preserve: skill.access_state === "configured" && !context.ownedResources[resourceIdForSkill(skill.id)]
        ? ["安装前已经存在的同内容 Skill"]
        : []
    });
  }
  return {
    detected_basis: detected,
    targets,
    backup: {
      required: actions.length > 0,
      location: `${context.stateRoot}/backups/<operation_id>`,
      retention: "保留，由用户主动清理"
    },
    permissions: actions.length ? ["read_config", "write_config", "read_skills", "write_skills"] : ["read_config", "read_skills"],
    restart: manifest.restart,
    rollback: {
      strategy: "restore_backup_and_reverse_registered_action",
      checkpoint: "before_apply",
      trigger: ["write_failed", "state_record_failed"]
    },
    verify: {
      steps: ["config_exists", "skills_match", "owned_fields_match", "client_config_recognized", "fqgate_ready"],
      evidence: ["codex mcp list --json", "Codex Skill 目录 SHA-256", "FQGate MCP initialize/tools/list"]
    },
    risk: blockers.length
      ? "检测到配置、Skill 冲突或环境不可用，不允许写入。"
      : "只管理名为 fqgate 的 MCP 和两个 FQGate 官方 Skill，不修改其他 Codex 配置与 Skill。",
    actions,
    blockers,
    intent
  };
}

function action(kind, resourceId, summary, targetPath) {
  return { kind, resource_id: resourceId, summary, target_path: targetPath };
}

function skillAction(kind, resourceId, skill, summary) {
  return { ...action(kind, resourceId, summary, skill.target_path), skill_id: skill.id };
}

function resourceIdForMcp(manifest) {
  return `codex:mcp:${manifest.connection.name}`;
}

function resourceIdForSkill(skillId) {
  return `codex:skill:${skillId}`;
}

function ownershipResult(actions) {
  return {
    completedActions: actions,
    changedFiles: [...new Set(actions.map((item) => item.target_path))],
    ownershipChanges: {
      add: actions
        .filter((item) => ["codex_mcp_add", "codex_skill_install", "codex_skill_replace"].includes(item.kind))
        .map((item) => item.resource_id),
      remove: actions
        .filter((item) => ["codex_mcp_remove", "codex_skill_remove"].includes(item.kind))
        .map((item) => item.resource_id)
    }
  };
}

function verification(manifest, detected, probe, loadedEvidence) {
  const configurationWritten = detected.mcp_access_state === "configured";
  const skillsInstalled = detected.skills.length > 0 && detected.skills.every((skill) => skill.access_state === "configured");
  const fqgateReady = probe.mcpReachable === true && Number.isInteger(probe.toolCount) && probe.toolCount > 0;
  const configurationComplete = configurationWritten && skillsInstalled;
  let state = "repair_required";
  if (configurationComplete && fqgateReady) state = manifest.restart.required ? "restart_required" : "verified";
  else if (configurationComplete) state = "config_written";
  else if (!detected.client_found) state = "not_found";
  return {
    schema_version: 1,
    client_id: manifest.id,
    state,
    configuration_written: configurationWritten,
    skills_installed: skillsInstalled,
    installed_skill_count: detected.skills.filter((skill) => skill.access_state === "configured").length,
    client_config_recognized: configurationWritten,
    client_loaded: manifest.restart.required && configurationComplete ? null : configurationComplete,
    fqgate_ready: fqgateReady,
    restart_required: configurationComplete && manifest.restart.required,
    evidence: [
      configurationWritten ? loadedEvidence.trim() : "目标 MCP 配置尚未写入。",
      skillsInstalled ? "两个 FQGate Skill 的内容与发行源一致。" : "FQGate Skill 尚未完整安装。",
      fqgateReady ? `FQGate MCP 返回 ${probe.toolCount} 个工具。` : `FQGate MCP 尚不可用：${probe.error || "未返回工具"}`
    ],
    probe
  };
}

function detectSkills(context) {
  return context.skills.map((skill) => {
    try {
      return inspectCodexSkill(skill);
    } catch (error) {
      return {
        id: skill.id,
        source_path: skill.sourcePath,
        target_path: skill.targetPath,
        desired_sha256: null,
        desired_file_count: null,
        actual: { exists: false, kind: null, sha256: null },
        access_state: "unavailable",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function aggregateAccessState(mcpState, skills) {
  if (mcpState === "conflict" || skills.some((skill) => ["conflict", "unavailable"].includes(skill.access_state))) {
    return "conflict";
  }
  if (mcpState === "configured" && skills.every((skill) => skill.access_state === "configured")) return "configured";
  if (mcpState === "absent" && skills.every((skill) => skill.access_state === "absent")) return "absent";
  return "partial";
}

function summaryText(summary) {
  return summary?.exists ? `sha256:${summary.sha256}` : "文件不存在";
}

function findSkill(context, skillId) {
  const skill = context.skills.find((item) => item.id === skillId);
  if (!skill) throw new Error(`Codex Adapter 找不到受控 Skill：${skillId}`);
  return skill;
}

function run(context, command, args) {
  return context.runner.run(command, args, { env: context.env });
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

function summarizeServer(server) {
  return {
    name: server.name,
    enabled: server.enabled !== false,
    transport: server.transport?.type || null,
    url: server.transport?.url || null
  };
}

function notFound(manifest, configPath, skills) {
  return {
    client_found: false,
    client_version: null,
    config_source: configPath,
    permissions_checked: ["read_skills"],
    access_state: "unknown",
    mcp_access_state: "unknown",
    actual: null,
    config_summary: fileSummary(configPath),
    skills,
    reason: `${manifest.executable.command} 命令不存在。`
  };
}

function isMissingCommand(result) {
  return result.error?.code === "ENOENT";
}
