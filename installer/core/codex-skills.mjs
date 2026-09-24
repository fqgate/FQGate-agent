import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathSummary, readDirectoryFiles, sha256Entries } from "./backup.mjs";

export function inspectCodexSkill(skill) {
  const desired = desiredSkill(skill);
  const actual = pathSummary(skill.targetPath);
  return {
    id: skill.id,
    source_path: skill.sourcePath,
    target_path: skill.targetPath,
    desired_sha256: desired.sha256,
    desired_file_count: desired.entries.length,
    actual,
    access_state: !actual.exists
      ? "absent"
      : actual.kind === "directory" && actual.sha256 === desired.sha256
        ? "configured"
        : "conflict"
  };
}

export function installCodexSkill(skill) {
  const desired = desiredSkill(skill);
  const targetPath = resolve(skill.targetPath);
  const parentPath = dirname(targetPath);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  const displacedPath = `${targetPath}.${process.pid}.${randomUUID()}.old`;
  mkdirSync(parentPath, { recursive: true, mode: 0o700 });

  try {
    mkdirSync(temporaryPath, { recursive: false, mode: 0o700 });
    for (const entry of desired.entries) {
      const destination = join(temporaryPath, ...entry.path.split("/"));
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, entry.content, { mode: 0o600 });
    }
    const staged = pathSummary(temporaryPath);
    if (staged.sha256 !== desired.sha256) {
      throw new Error(`Skill 写入临时目录后哈希不一致：${skill.id}`);
    }

    if (existsSync(targetPath)) renameSync(targetPath, displacedPath);
    try {
      renameSync(temporaryPath, targetPath);
    } catch (error) {
      if (existsSync(displacedPath) && !existsSync(targetPath)) renameSync(displacedPath, targetPath);
      throw error;
    }
    if (existsSync(displacedPath)) rmSync(displacedPath, { recursive: true, force: true });
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { recursive: true, force: true });
    if (existsSync(displacedPath) && !existsSync(targetPath)) renameSync(displacedPath, targetPath);
  }

  const installed = pathSummary(targetPath);
  if (installed.sha256 !== desired.sha256) {
    throw new Error(`Skill 安装后哈希不一致：${skill.id}`);
  }
  return installed;
}

export function removeCodexSkill(skill) {
  const targetPath = resolve(skill.targetPath);
  if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
}

function desiredSkill(skill) {
  if (!existsSync(skill.sourcePath)) throw new Error(`Skill 源目录不存在：${skill.sourcePath}`);
  if (!existsSync(skill.adapterInstructionsPath)) {
    throw new Error(`Codex Skill 适配说明不存在：${skill.adapterInstructionsPath}`);
  }
  const entries = readDirectoryFiles(skill.sourcePath).map((entry) => ({ ...entry }));
  const skillDocument = entries.find((entry) => entry.path === "SKILL.md");
  if (!skillDocument) throw new Error(`Skill 缺少 SKILL.md：${skill.sourcePath}`);

  // 与 1.0 正式发行脚本保持同一语义：公共 Skill 之后追加宿主专属说明。
  const adapterInstructions = readFileSync(skill.adapterInstructionsPath);
  skillDocument.content = Buffer.concat([
    skillDocument.content,
    Buffer.from("\r\n---\r\n\r\n", "utf8"),
    adapterInstructions,
    Buffer.from("\r\n", "utf8")
  ]);
  return { entries, sha256: sha256Entries(entries) };
}
