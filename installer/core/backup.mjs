import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

export function createBackup(paths, stateRoot, operationId) {
  const backupRoot = join(resolve(stateRoot), "backups", operationId);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const entries = paths.map((targetPath, index) => backupFile(targetPath, backupRoot, index));
  const record = {
    schema_version: 1,
    operation_id: operationId,
    created_at: new Date().toISOString(),
    location: backupRoot,
    entries
  };
  atomicWriteJson(join(backupRoot, "backup.json"), record);
  return record;
}

export function restoreBackup(record) {
  const restoredFiles = [];
  for (const entry of [...record.entries].reverse()) {
    const targetPath = validatePathTarget(entry.path);
    if (!entry.existed) {
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      restoredFiles.push(targetPath);
      continue;
    }
    if (!entry.backup_path || !existsSync(entry.backup_path)) {
      throw new Error(`备份文件缺失：${entry.backup_path ?? targetPath}`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.restore.tmp`;
    try {
      if (entry.kind === "directory") {
        cpSync(entry.backup_path, temporaryPath, { recursive: true, errorOnExist: true });
      } else {
        copyFileSync(entry.backup_path, temporaryPath);
        if (typeof entry.mode === "number") chmodSync(temporaryPath, entry.mode);
      }
      if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      renameSync(temporaryPath, targetPath);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { recursive: true, force: true });
    }
    if (pathSummary(targetPath).sha256 !== entry.sha256) {
      throw new Error(`备份恢复后哈希不一致：${targetPath}`);
    }
    restoredFiles.push(targetPath);
  }
  return restoredFiles;
}

export function fileSummary(targetPath) {
  const summary = pathSummary(targetPath);
  if (!summary.exists) return summary;
  if (summary.kind !== "file") throw new Error(`配置目标不是普通文件：${resolve(targetPath)}`);
  return summary;
}

export function pathSummary(targetPath) {
  const resolvedPath = validatePathTarget(targetPath);
  if (!existsSync(resolvedPath)) return { exists: false, kind: null, sha256: null };
  const stats = lstatSync(resolvedPath);
  if (stats.isSymbolicLink()) throw new Error(`拒绝读取符号链接目标：${resolvedPath}`);
  if (stats.isDirectory()) {
    const files = readDirectoryFiles(resolvedPath);
    return {
      exists: true,
      kind: "directory",
      sha256: sha256Entries(files),
      file_count: files.length
    };
  }
  if (!stats.isFile()) throw new Error(`配置目标不是普通文件：${resolvedPath}`);
  return { exists: true, kind: "file", sha256: sha256File(resolvedPath), size: stats.size };
}

export function atomicWriteJson(targetPath, value) {
  const resolvedPath = validatePathTarget(targetPath);
  mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Windows ACL 不依赖 POSIX mode。
    }
    renameSync(temporaryPath, resolvedPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function backupFile(targetPath, backupRoot, index) {
  const resolvedPath = validatePathTarget(targetPath);
  if (!existsSync(resolvedPath)) {
    return { path: resolvedPath, existed: false, kind: null, backup_path: null, sha256: null, mode: null };
  }
  const stats = lstatSync(resolvedPath);
  if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
    throw new Error(`拒绝备份非普通文件或目录：${resolvedPath}`);
  }
  const kind = stats.isDirectory() ? "directory" : "file";
  const backupPath = join(backupRoot, `${String(index + 1).padStart(2, "0")}-${basename(resolvedPath)}.backup`);
  if (kind === "directory") {
    cpSync(resolvedPath, backupPath, { recursive: true, errorOnExist: true });
  } else {
    copyFileSync(resolvedPath, backupPath);
    try {
      chmodSync(backupPath, 0o600);
    } catch {
      // Windows ACL 不依赖 POSIX mode。
    }
  }
  const sourceHash = pathSummary(resolvedPath).sha256;
  if (pathSummary(backupPath).sha256 !== sourceHash) {
    throw new Error(`配置备份哈希不一致：${resolvedPath}`);
  }
  return {
    path: resolvedPath,
    existed: true,
    kind,
    backup_path: backupPath,
    sha256: sourceHash,
    mode: stats.mode & 0o777
  };
}

function sha256File(targetPath) {
  return createHash("sha256").update(readFileSync(targetPath)).digest("hex");
}

export function sha256Entries(entries) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readDirectoryFiles(rootPath) {
  const resolvedRoot = validatePathTarget(rootPath);
  const files = [];
  walk(resolvedRoot, resolvedRoot, files);
  return files;
}

function walk(rootPath, currentPath, files) {
  for (const entry of readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`技能目录不能包含符号链接：${absolutePath}`);
    if (entry.isDirectory()) {
      walk(rootPath, absolutePath, files);
    } else if (entry.isFile()) {
      files.push({
        path: relative(rootPath, absolutePath).split(sep).join("/"),
        content: readFileSync(absolutePath)
      });
    } else {
      throw new Error(`技能目录包含不支持的文件类型：${absolutePath}`);
    }
  }
}

function validatePathTarget(targetPath) {
  const resolvedPath = resolve(targetPath);
  const parsed = parse(resolvedPath);
  if (resolvedPath === parsed.root || !parsed.base) {
    throw new Error(`拒绝把目录根作为备份目标：${resolvedPath}`);
  }
  return resolvedPath;
}
