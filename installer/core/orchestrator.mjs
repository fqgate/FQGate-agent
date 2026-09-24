import { createHash, randomUUID } from "node:crypto";
import { adapterFor } from "../adapters/index.mjs";
import { createBackup, restoreBackup } from "./backup.mjs";
import { loadManifestDirectory } from "./manifest.mjs";
import { OperationStore } from "./operation-store.mjs";
import { createPathContext, expandCodexSkills, expandManifestPaths } from "./paths.mjs";
import { createProcessRunner } from "./process-runner.mjs";
import { probeFqgate } from "../runtime/fqgate-config.mjs";

const INTENTS = new Set(["install", "repair", "uninstall"]);

export class InstallerOrchestrator {
  constructor({
    manifestDirectory,
    manifests,
    adapters,
    runner = createProcessRunner(),
    env = process.env,
    platform = process.platform,
    stateRoot,
    store,
    probe = probeFqgate
  }) {
    const pathContext = createPathContext({ env, platform, stateRoot });
    const loadedManifests = manifests || loadManifestDirectory(manifestDirectory);
    this.manifests = new Map(loadedManifests.map((manifest) => [manifest.id, manifest]));
    this.adapters = adapters || new Map();
    this.runner = runner;
    this.pathContext = pathContext;
    this.store = store || new OperationStore(pathContext.stateRoot);
    this.probe = probe;
  }

  async scan() {
    const clients = [];
    for (const clientId of [...this.manifests.keys()].sort()) clients.push(await this.detect(clientId));
    return { schema_version: 1, operation: "scan", clients };
  }

  async detect(clientId) {
    const { manifest, adapter, context } = this.resolve(clientId);
    const detected = await adapter.detect(manifest, context);
    return {
      schema_version: 1,
      operation: "detect",
      client_id: clientId,
      display_name: manifest.displayName,
      state: detectState(detected),
      ...detected
    };
  }

  async plan(clientId, intent = "install") {
    if (!INTENTS.has(intent)) throw new Error(`不支持的 plan intent：${intent}`);
    const { manifest, adapter, context } = this.resolve(clientId);
    const draft = await adapter.plan(manifest, context, intent);
    const planCore = {
      schema_version: 1,
      client_id: clientId,
      intent,
      detected_basis: draft.detected_basis,
      targets: draft.targets,
      backup: draft.backup,
      permissions: draft.permissions,
      restart: draft.restart,
      rollback: draft.rollback,
      verify: draft.verify,
      risk: draft.risk,
      actions: draft.actions,
      blockers: draft.blockers,
      confirmation_required: draft.actions.length > 0
    };
    return {
      ...planCore,
      plan_id: planIdFor(planCore),
      created_at: new Date().toISOString(),
      state: draft.blockers.length
        ? "unavailable"
        : draft.actions.length
          ? "plan_pending_confirmation"
          : "no_changes"
    };
  }

  async apply(clientId, { planId, confirmed = false, intent = "install" } = {}) {
    if (!planId) throw new Error("apply 必须提供由 plan 返回的 --plan。");
    const currentPlan = await this.plan(clientId, intent);
    if (currentPlan.plan_id !== planId) {
      throw new Error("plan 已过期或环境发生变化，请重新运行 plan 后再确认。");
    }
    if (currentPlan.blockers.length) throw new Error(currentPlan.blockers.join(" "));
    if (currentPlan.confirmation_required && !confirmed) {
      throw new Error("该 plan 会修改本机配置；确认后使用 --yes 执行。");
    }

    const { manifest, adapter, context } = this.resolve(clientId);
    const operationId = `op_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    let backup = null;
    let applied = { completedActions: [], changedFiles: [], ownershipChanges: { add: [], remove: [] } };
    try {
      if (currentPlan.actions.length) {
        backup = createBackup(context.backupPaths, context.stateRoot, operationId);
        assertBackupMatchesPlan(backup, currentPlan);
      }
      applied = await adapter.apply(manifest, context, currentPlan);
      const result = {
        schema_version: 1,
        operation_id: operationId,
        plan_id: planId,
        client_id: clientId,
        intent,
        state: "applied",
        lifecycle_state: currentPlan.actions.length ? "config_written" : detectNoopState(intent),
        changed_files: applied.changedFiles,
        backup: {
          created: Boolean(backup),
          location: backup?.location || null,
          verified: Boolean(backup)
        },
        rollback: {
          attempted: false,
          state: "not_needed",
          restored_files: [],
          reason_code: null
        },
        safe_to_retry: true,
        user_action_required: currentPlan.restart.required && currentPlan.actions.length > 0,
        evidence: applied.completedActions.map((item) => item.summary),
        started_at: startedAt,
        finished_at: new Date().toISOString()
      };
      this.store.record(clientId, result, applied.ownershipChanges);
      return result;
    } catch (error) {
      const completedActions = error.completedActions || applied.completedActions || [];
      let rollbackState = backup ? "succeeded" : "not_needed";
      let restoredFiles = [];
      const rollbackErrors = [];
      if (backup) {
        try {
          await adapter.rollback(manifest, context, completedActions);
        } catch (currentRollbackError) {
          rollbackErrors.push(currentRollbackError);
        }
        try {
          restoredFiles = restoreBackup(backup);
        } catch (currentRollbackError) {
          rollbackErrors.push(currentRollbackError);
        }
        if (rollbackErrors.length) rollbackState = "failed";
      }
      const result = {
        schema_version: 1,
        operation_id: operationId,
        plan_id: planId,
        client_id: clientId,
        intent,
        state: rollbackState === "failed" ? "rollback_failed" : "rolled_back",
        changed_files: rollbackState === "failed" ? applied.changedFiles || [] : [],
        backup: {
          created: Boolean(backup),
          location: backup?.location || null,
          verified: Boolean(backup)
        },
        rollback: {
          attempted: Boolean(backup),
          state: rollbackState,
          restored_files: restoredFiles,
          reason_code: rollbackErrors.length ? "rollback_failed" : "apply_failed"
        },
        safe_to_retry: rollbackState !== "failed",
        user_action_required: rollbackState === "failed",
        evidence: [],
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: formatError(error),
        rollback_error: rollbackErrors.length ? rollbackErrors.map(formatError).join("；") : null
      };
      throw new OrchestrationError(`编排执行失败：${formatError(error)}`, result);
    }
  }

  async verify(clientId) {
    const { manifest, adapter, context } = this.resolve(clientId);
    return adapter.verify(manifest, context);
  }

  async repair(clientId) {
    return this.plan(clientId, "repair");
  }

  async uninstall(clientId, options = {}) {
    return this.apply(clientId, { ...options, intent: "uninstall" });
  }

  resolve(clientId) {
    const manifest = this.manifests.get(clientId);
    if (!manifest) throw new Error(`未知客户端：${clientId}`);
    const adapter = this.adapters.get(manifest.adapter) || adapterFor(manifest.adapter);
    const backupPaths = expandManifestPaths(manifest, this.pathContext);
    const skills = expandCodexSkills(manifest, this.pathContext);
    const ownedResources = this.store.client(clientId).owned_resources || {};
    return {
      manifest,
      adapter,
      context: {
        runner: this.runner,
        probe: this.probe,
        env: this.pathContext.env,
        platform: this.pathContext.platform,
        stateRoot: this.pathContext.stateRoot,
        backupPaths,
        skills,
        ownedResources
      }
    };
  }
}

function assertBackupMatchesPlan(backup, plan) {
  const summaries = new Map(plan.targets.map((target) => [target.config_file, target.before_summary]));
  for (const entry of backup.entries) {
    const expected = summaries.get(entry.path);
    const actual = entry.existed ? `sha256:${entry.sha256}` : "文件不存在";
    if (expected !== actual) {
      throw new Error(`备份时发现配置已变化，拒绝执行过期计划：${entry.path}`);
    }
  }
}

export class OrchestrationError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "OrchestrationError";
    this.result = result;
  }
}

function planIdFor(value) {
  const digest = createHash("sha256").update(stableStringify(value)).digest("hex");
  return `plan_${digest.slice(0, 24)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function detectState(detected) {
  if (!detected.client_found) return "not_found";
  if (detected.compatible === false) return "unavailable";
  if (detected.access_state === "configured") return "config_written";
  if (detected.access_state === "conflict" || detected.access_state === "partial") return "repair_required";
  if (detected.access_state === "absent") return "available";
  return "unknown";
}

function detectNoopState(intent) {
  return intent === "uninstall" ? "uninstalled" : "config_written";
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
