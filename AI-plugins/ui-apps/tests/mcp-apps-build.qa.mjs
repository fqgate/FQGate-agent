import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("dist", "mcp-apps");
const config = JSON.parse(await readFile(resolve("mcp-apps", "apps.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8"));
const expectedFiles = ["manifest.json", ...config.apps.map((app) => app.file)].sort();
const actualFiles = (await readdir(outputDirectory)).sort();

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`MCP Apps 构建产物不完整：${JSON.stringify(actualFiles)}`);
}
for (const [field, expected] of [
  ["schemaVersion", 1],
  ["component", "fqgate-mcp-apps"],
  ["channel", "dev"],
  ["bundleVersion", config.bundleVersion],
  ["minimumFqgateVersion", config.minimumFqgateVersion]
]) {
  if (manifest[field] !== expected) throw new Error(`manifest.json 的 ${field} 无效。`);
}
if (manifest.apps.length !== config.apps.length) throw new Error("manifest.json 没有覆盖全部应用。");

for (const configuredApp of config.apps) {
  const app = manifest.apps.find((candidate) => candidate.id === configuredApp.id);
  if (!app) throw new Error(`manifest.json 缺少应用：${configuredApp.id}`);
  const expectedAppKeys = [...Object.keys(configuredApp), "size", "sha256"].sort();
  if (JSON.stringify(Object.keys(app).sort()) !== JSON.stringify(expectedAppKeys)) {
    throw new Error(`${app.id} 清单包含未约定字段。`);
  }
  for (const [field, expected] of Object.entries(configuredApp)) {
    if (JSON.stringify(app[field]) !== JSON.stringify(expected)) throw new Error(`${app.id}.${field} 与统一配置不一致。`);
  }

  const filePath = resolve(outputDirectory, app.file);
  const [html, fileStat, fileBytes] = await Promise.all([readFile(filePath, "utf8"), stat(filePath), readFile(filePath)]);
  if (fileStat.size < 20_000) throw new Error(`${app.file} 没有包含完整组件构建内容。`);
  if (app.size !== fileStat.size) throw new Error(`${app.file} 的 size 无效。`);
  if (app.sha256 !== createHash("sha256").update(fileBytes).digest("hex")) {
    throw new Error(`${app.file} 的 sha256 无效。`);
  }
  if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel=["']stylesheet/i.test(html)) {
    throw new Error(`${app.file} 仍依赖外部脚本或样式。`);
  }
  if (!html.includes("ui/initialize") || !html.includes("ui/notifications/tool-input")) {
    throw new Error(`${app.file} 没有包含 MCP Apps 标准通信运行时。`);
  }
  if (html.includes("preview-layout") || html.includes("组件预览")) {
    throw new Error(`${app.file} 错误包含了本地组件预览壳。`);
  }
  if (html.includes("/v1/market/stream")) {
    throw new Error(`${app.file} 仍包含组件沙箱直连 FQGate WebSocket 的代码。`);
  }
  if (["permissions", "appOnly", "csp", "connectDomains"].some((field) => field in app)) {
    throw new Error(`${app.id} 不能通过远程清单配置权限或网络访问。`);
  }
}

process.stdout.write("MCP Apps 自包含构建和清单验收通过。\n");
