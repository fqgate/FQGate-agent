import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareVersions, versionParts } from "./versioning.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`参数不完整：${name}`);
    values.set(name.slice(2), value);
  }
  return values;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function describe(path) {
  const [content, fileStat] = await Promise.all([readFile(path), stat(path)]);
  return { size: fileStat.size, sha256: createHash("sha256").update(content).digest("hex") };
}

function packageDefinitions(version) {
  return [
    ["claude-code", `fqgate-agent-claude-code-${version}.zip`],
    ["codex", `fqgate-agent-codex-${version}.zip`],
    ["deepseek-harness", `fqgate-agent-deepseek-harness-${version}.tgz`],
    ["doubao", `fqgate-agent-doubao-${version}.zip`],
    ["openclaw", `fqgate-agent-openclaw-${version}.zip`],
    ["qianwen", `fqgate-agent-qianwen-${version}.zip`],
    ["workbuddy", `fqgate-agent-workbuddy-${version}.zip`],
    ["zcode", `fqgate-agent-zcode-${version}.zip`],
    ["zcode-marketplace", `fqgate-agent-zcode-marketplace-${version}.zip`]
  ];
}

async function readReleaseNotes(version) {
  const content = await readFile(resolve(repositoryRoot, "RELEASE_NOTES.md"), "utf8");
  const header = `# ${version} 更新说明`;
  const start = content.indexOf(header);
  if (start < 0) throw new Error(`RELEASE_NOTES.md 缺少 ${version} 标题。`);
  const remainder = content.slice(start + header.length);
  const nextHeader = remainder.search(/^# \d/m);
  const section = nextHeader < 0 ? remainder : remainder.slice(0, nextHeader);
  const notes = [...section.matchAll(/^\s*-\s+(.+)$/gm)].map((item) => item[1].trim());
  if (!notes.length) throw new Error(`RELEASE_NOTES.md 缺少 ${version} 的列表式更新说明。`);
  return notes;
}

async function buildRelease(version, artifactsDirectory, status, publishedAtUtc) {
  const packages = [];
  for (const [adapter, fileName] of packageDefinitions(version)) {
    const path = resolve(artifactsDirectory, fileName);
    packages.push({ adapter, fileName, ...(await describe(path)) });
  }
  const checksumName = `fqgate-agent-${version}-SHA256SUMS.txt`;
  const checksum = await readFile(resolve(artifactsDirectory, checksumName), "utf8");
  const expectedLines = packages
    .map((item) => `${item.sha256}  ${item.fileName}`)
    .sort()
    .join("\n");
  if (checksum.trim().split(/\r?\n/).sort().join("\n") !== expectedLines) {
    throw new Error("SHA256SUMS 文件与九个插件包不一致。 ");
  }
  return {
    schemaVersion: 1,
    component: "fqgate-agent",
    status,
    version,
    publishedAtUtc,
    releaseUrls: {
      github: `https://github.com/fqgate/FQGate-agent/releases/tag/v${version}`,
      gitee: `https://gitee.com/qicuo/tonghuasun-agent/releases/tag/v${version}`
    },
    releaseNotes: await readReleaseNotes(version),
    packages
  };
}

function samePackages(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function updateMarketplace(version, release) {
  const path = resolve(repositoryRoot, ".claude-plugin/marketplace.json");
  const marketplace = await readJson(path);
  const plugin = marketplace.plugins?.find((item) => item.name === "fqgate-agent");
  if (!plugin) throw new Error("Claude marketplace 缺少 fqgate-agent。 ");
  const packageInfo = release.packages.find((item) => item.adapter === "claude-code");
  plugin.version = version;
  plugin.source.url = `https://github.com/fqgate/FQGate-agent/releases/download/v${version}/${packageInfo.fileName}`;
  plugin.source.sha256 = packageInfo.sha256;
  await writeJson(path, marketplace);
}

const argumentsMap = parseArguments(process.argv.slice(2));
const mode = argumentsMap.get("mode");
const artifactsDirectory = resolve(argumentsMap.get("artifacts") ?? resolve(repositoryRoot, "artifacts"));
if (!new Set(["prepare", "verify", "promote"]).has(mode)) throw new Error("--mode 必须是 prepare、verify 或 promote。");
const compatibility = await readJson(resolve(repositoryRoot, "fqgate/compatibility.json"));
const version = compatibility.agentVersion;
versionParts(version);
const publishedAt = argumentsMap.get("published-at") ?? null;
if (mode === "promote" && !publishedAt) throw new Error("promote 必须提供 --published-at。");
if (mode === "promote") {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("--published-at 必须是 GitHub 返回的 UTC 时间。");
  }
  const stable = await readJson(resolve(repositoryRoot, "update/stable.json"));
  if (compareVersions(stable.latestVersion, version) > 0) {
    throw new Error(`拒绝把 Agent 稳定通道从 ${stable.latestVersion} 降级到 ${version}。`);
  }
}

const generated = await buildRelease(
  version,
  artifactsDirectory,
  mode === "promote" ? "published" : "unpublished",
  mode === "promote" ? publishedAt : null
);
const releasePath = resolve(repositoryRoot, `update/releases/${version}.json`);

if (mode === "verify") {
  const committed = await readJson(releasePath);
  if (committed.version !== version || !samePackages(committed.packages, generated.packages)) {
    throw new Error("提交的 Agent 发行清单与重新构建的产物不一致。 ");
  }
} else {
  await writeJson(releasePath, generated);
  if (mode === "promote") {
    await updateMarketplace(version, generated);
    await writeJson(resolve(repositoryRoot, "update/stable.json"), {
      schemaVersion: 1,
      latestVersion: version,
      publishedAtUtc: publishedAt,
      releaseUrls: generated.releaseUrls
    });
  }
}

process.stdout.write(`Agent ${version} 发行元数据${mode === "verify" ? "校验" : "更新"}完成。\n`);
