import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expandTemplate } from "./manifest.mjs";

export function createPathContext({ env = process.env, platform = process.platform, stateRoot } = {}) {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  if (!home) throw new Error("无法确定当前用户目录。");
  const codexHome = env.CODEX_HOME?.trim() || join(home, ".codex");
  const claudeConfigDirectory = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const claudeUserConfig = env.CLAUDE_CONFIG_DIR?.trim()
    ? join(claudeConfigDirectory, ".claude.json")
    : join(home, ".claude.json");
  return {
    env: {
      ...env,
      HOME: home
    },
    platform,
    variables: {
      HOME: resolve(home),
      CODEX_HOME: resolve(codexHome),
      CLAUDE_CONFIG_DIR: resolve(claudeConfigDirectory),
      CLAUDE_USER_CONFIG: resolve(claudeUserConfig)
    },
    stateRoot: resolve(stateRoot || defaultStateRoot({ env, platform, home }))
  };
}

export function expandManifestPaths(manifest, pathContext) {
  return manifest.backup.paths.map((value) => resolve(expandTemplate(value, pathContext.variables)));
}

export function expandCodexSkills(manifest, pathContext) {
  if (!Array.isArray(manifest.skills)) return [];
  const manifestDirectory = dirname(manifest.manifestPath);
  return manifest.skills.map((skill) => ({
    id: skill.id,
    sourcePath: resolve(manifestDirectory, skill.source),
    adapterInstructionsPath: resolve(manifestDirectory, skill.adapterInstructions),
    targetPath: resolve(expandTemplate(skill.target, pathContext.variables))
  }));
}

function defaultStateRoot({ env, platform, home }) {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (!localAppData) throw new Error("LOCALAPPDATA 不可用，无法保存安装编排状态。");
    return join(localAppData, "FQGate", "agent-installer");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "fqgate", "agent-installer");
  }
  return join(env.XDG_STATE_HOME?.trim() || join(home, ".local", "state"), "fqgate", "agent-installer");
}
