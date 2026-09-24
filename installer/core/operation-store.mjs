import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWriteJson } from "./backup.mjs";

export class OperationStore {
  constructor(stateRoot) {
    this.path = join(resolve(stateRoot), "state.json");
  }

  read() {
    if (!existsSync(this.path)) return { schema_version: 1, clients: {} };
    let value;
    try {
      value = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      throw new Error(`无法读取安装编排状态：${formatError(error)}`);
    }
    if (value?.schema_version !== 1 || !value.clients || typeof value.clients !== "object") {
      throw new Error("安装编排状态版本不受支持。");
    }
    return value;
  }

  client(clientId) {
    return this.read().clients[clientId] || { owned_resources: {} };
  }

  record(clientId, result, ownershipChanges) {
    const state = this.read();
    const previous = state.clients[clientId] || { owned_resources: {} };
    const ownedResources = { ...previous.owned_resources };
    for (const resourceId of ownershipChanges.add || []) {
      ownedResources[resourceId] = {
        acquired_at: result.finished_at,
        operation_id: result.operation_id
      };
    }
    for (const resourceId of ownershipChanges.remove || []) delete ownedResources[resourceId];
    state.clients[clientId] = {
      owned_resources: ownedResources,
      last_operation: result
    };
    state.updated_at = result.finished_at;
    atomicWriteJson(this.path, state);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
