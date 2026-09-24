import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBackup, pathSummary, restoreBackup } from "../core/backup.mjs";

test("Skill 目录备份可以恢复原内容并移除原先不存在的目录", () => {
  const root = mkdtempSync(join(tmpdir(), "fqgate-backup-test-"));
  try {
    const stateRoot = join(root, "state");
    const existingSkill = join(root, "skills", "existing");
    const absentSkill = join(root, "skills", "absent");
    mkdirSync(join(existingSkill, "agents"), { recursive: true });
    writeFileSync(join(existingSkill, "SKILL.md"), "原始内容\n", "utf8");
    writeFileSync(join(existingSkill, "agents", "openai.yaml"), "display: original\n", "utf8");
    const before = pathSummary(existingSkill);

    const backup = createBackup([existingSkill, absentSkill], stateRoot, "op_directory_restore");
    writeFileSync(join(existingSkill, "SKILL.md"), "已修改\n", "utf8");
    mkdirSync(absentSkill, { recursive: true });
    writeFileSync(join(absentSkill, "SKILL.md"), "新文件\n", "utf8");

    const restored = restoreBackup(backup);
    assert.deepEqual(restored, [absentSkill, existingSkill]);
    assert.equal(pathSummary(existingSkill).sha256, before.sha256);
    assert.equal(readFileSync(join(existingSkill, "SKILL.md"), "utf8"), "原始内容\n");
    assert.equal(existsSync(absentSkill), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
