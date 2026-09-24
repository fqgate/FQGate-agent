import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

export const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const appConfigPath = resolve(projectDirectory, "mcp-apps", "apps.json");
export const defaultBuildOutput = resolve(projectDirectory, "dist", "mcp-apps");
export const defaultDevOutput = resolve(projectDirectory, "..", "..", "..", "fqgate", "target", "debug", "mcp-apps");
export const defaultReleaseOutput = resolve(projectDirectory, "..", "..", "fqgate", "mcp-apps");

const configKeys = ["schemaVersion", "component", "bundleVersion", "minimumFqgateVersion", "apps"];
const appKeys = ["id", "resourceUri", "file", "title", "description", "toolPaths"];
const sharedBuildFile = "index.html";
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumAppSize = 16 * 1024 * 1024;
const maximumBundleSize = 64 * 1024 * 1024;

export async function loadAppConfig() {
  const config = JSON.parse(await readFile(appConfigPath, "utf8"));
  assertExactKeys(config, configKeys, "应用配置");
  if (config.schemaVersion !== 1) throw new Error("MCP Apps 仅支持 schemaVersion 1。");
  if (config.component !== "fqgate-mcp-apps") throw new Error("MCP Apps component 必须是 fqgate-mcp-apps。");
  for (const [field, value] of [
    ["bundleVersion", config.bundleVersion],
    ["minimumFqgateVersion", config.minimumFqgateVersion]
  ]) {
    if (typeof value !== "string" || !versionPattern.test(value)) {
      throw new Error(`${field} 必须是有效的语义版本号。`);
    }
  }
  if (!Array.isArray(config.apps) || config.apps.length === 0) throw new Error("MCP Apps 配置不能为空。");

  const ids = new Set();
  const uris = new Set();
  const boundPaths = new Set();
  for (const app of config.apps) {
    assertExactKeys(app, appKeys, `应用 ${app?.id ?? "<unknown>"}`);
    if (typeof app.id !== "string" || !idPattern.test(app.id)) throw new Error(`应用 id 无效：${app.id}`);
    if (ids.has(app.id)) throw new Error(`应用 id 重复：${app.id}`);
    ids.add(app.id);
    if (typeof app.file !== "string" || app.file !== sharedBuildFile) {
      throw new Error(`应用 ${app.id} 必须共享唯一构建文件 ${sharedBuildFile}。`);
    }
    if (typeof app.resourceUri !== "string" || app.resourceUri !== `ui://fqgate/${app.id}.html`) {
      throw new Error(`应用 ${app.id} 的 resourceUri 必须使用自己的逻辑页面地址。`);
    }
    if (uris.has(app.resourceUri)) throw new Error(`应用资源地址重复：${app.resourceUri}`);
    uris.add(app.resourceUri);
    if (!isNonEmptyString(app.title) || app.title.length > 128 || !isNonEmptyString(app.description) || app.description.length > 512) {
      throw new Error(`应用 ${app.id} 缺少标题或说明。`);
    }
    if (!Array.isArray(app.toolPaths) || app.toolPaths.length === 0 || app.toolPaths.some((path) => !isApiPath(path))) {
      throw new Error(`应用 ${app.id} 的 toolPaths 无效。`);
    }
    for (const path of app.toolPaths) {
      if (boundPaths.has(path)) throw new Error(`一个接口不能绑定多个 MCP App：${path}`);
      boundPaths.add(path);
    }
  }
  return config;
}

export async function buildMcpApps({ channel = "dev", outputDirectory = defaultBuildOutput } = {}) {
  if (!new Set(["dev", "stable"]).has(channel)) throw new Error(`不支持的发布通道：${channel}`);
  const config = await loadAppConfig();
  if (channel === "stable") assertStableBundleVersion(config.bundleVersion);
  const output = resolve(outputDirectory);
  assertManagedBuildOutput(output);
  const temporaryDirectory = resolve(projectDirectory, "dist", `.mcp-apps-build-${process.pid}`);

  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  try {
    await buildSharedEntry(temporaryDirectory, output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const manifest = {
    schemaVersion: config.schemaVersion,
    component: config.component,
    channel,
    bundleVersion: config.bundleVersion,
    minimumFqgateVersion: config.minimumFqgateVersion,
    apps: []
  };
  for (const app of config.apps) {
    const filePath = resolve(output, app.file);
    const [content, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
    manifest.apps.push({
      ...app,
      size: fileStat.size,
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
  await writeJson(resolve(output, "manifest.json"), manifest);
  return { config, manifest, outputDirectory: output };
}

export async function publishDevelopmentBundle({ sourceDirectory, destinationDirectory }) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  if (basename(destination).toLowerCase() !== "mcp-apps") {
    throw new Error(`开发发布目录必须以 mcp-apps 结尾：${destination}`);
  }
  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
  validateGeneratedManifest(manifest, "dev");
  await mkdir(destination, { recursive: true });

  const expectedFiles = new Set(["manifest.json", ...manifest.apps.map((app) => app.file)]);
  for (const app of manifest.apps) {
    await verifyAppFile(source, app);
    await replaceFile(resolve(source, app.file), resolve(destination, app.file));
  }
  // 清单最后切换，FQGate 只会看到一套已经完整写入的页面。
  await replaceFile(resolve(source, "manifest.json"), resolve(destination, "manifest.json"));
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (entry.isFile() && !expectedFiles.has(entry.name) && entry.name.endsWith(".html")) {
      await unlink(resolve(destination, entry.name));
    }
  }
  return manifest;
}

export async function createRelease({ buildDirectory, releaseRoot, privateKey }) {
  const source = resolve(buildDirectory);
  const destination = resolve(releaseRoot);
  const manifestPath = resolve(source, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateGeneratedManifest(manifest, "stable");
  for (const app of manifest.apps) await verifyAppFile(source, app);

  const versionDirectory = resolve(destination, "releases", manifest.bundleVersion);
  if (await pathExists(versionDirectory)) {
    throw new Error(`版本目录已经存在，不能覆盖既有发布：${versionDirectory}`);
  }
  await mkdir(versionDirectory, { recursive: true });
  try {
    for (const app of manifest.apps) await copyFile(resolve(source, app.file), resolve(versionDirectory, app.file));
    await writeFile(resolve(versionDirectory, "manifest.json"), manifestBytes);
    await writeSignature(resolve(versionDirectory, "manifest.sig"), manifestBytes, privateKey);

    const stable = {
      schemaVersion: 1,
      component: "fqgate-mcp-apps",
      channel: "stable",
      bundleVersion: manifest.bundleVersion,
      manifest: `releases/${manifest.bundleVersion}/manifest.json`
    };
    const stableBytes = Buffer.from(`${JSON.stringify(stable, null, 2)}\n`, "utf8");
    const stableTemp = resolve(destination, `.stable-${process.pid}.json`);
    const signatureTemp = resolve(destination, `.stable-${process.pid}.sig`);
    await mkdir(destination, { recursive: true });
    await writeFile(stableTemp, stableBytes);
    await writeSignature(signatureTemp, stableBytes, privateKey);
    try {
      await updateStablePointer(destination, stableTemp, signatureTemp);
    } finally {
      await Promise.all([rm(stableTemp, { force: true }), rm(signatureTemp, { force: true })]);
    }
    return { manifest, stable, versionDirectory };
  } catch (error) {
    await rm(versionDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyRelease({ releaseRoot, publicKeyPem, bundleVersion }) {
  const root = resolve(releaseRoot);
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("MCP Apps 验签公钥必须是 Ed25519。");

  let version = bundleVersion;
  if (version) {
    assertStableBundleVersion(version);
  } else {
    const stablePath = resolve(root, "stable.json");
    const stableBytes = await readFile(stablePath);
    verifySignature(stableBytes, await readFile(resolve(root, "stable.sig"), "utf8"), publicKey, "stable.json");
    const stable = JSON.parse(stableBytes.toString("utf8"));
    assertExactKeys(stable, ["schemaVersion", "component", "channel", "bundleVersion", "manifest"], "稳定通道指针");
    if (stable.schemaVersion !== 1 || stable.component !== "fqgate-mcp-apps" || stable.channel !== "stable") {
      throw new Error("stable.json 的版本、组件或通道无效。");
    }
    assertStableBundleVersion(stable.bundleVersion);
    if (stable.manifest !== `releases/${stable.bundleVersion}/manifest.json`) {
      throw new Error("stable.json 的版本清单地址无效。");
    }
    version = stable.bundleVersion;
  }

  const versionDirectory = resolve(root, "releases", version);
  const manifestPath = resolve(versionDirectory, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  verifySignature(
    manifestBytes,
    await readFile(resolve(versionDirectory, "manifest.sig"), "utf8"),
    publicKey,
    "manifest.json"
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  validateGeneratedManifest(manifest, "stable");
  if (manifest.bundleVersion !== version) throw new Error("版本目录与 manifest.json 的 bundleVersion 不一致。");
  assertStableBundleVersion(manifest.bundleVersion);
  for (const app of manifest.apps) await verifyAppFile(versionDirectory, app);
  return { manifest, versionDirectory };
}

export async function loadSigningPrivateKey({ environment = process.env, keyFile } = {}) {
  if (keyFile && environment.FQGATE_MCP_APPS_ED25519_PRIVATE_KEY) {
    throw new Error("不能同时通过文件和环境变量提供 MCP Apps 签名私钥。");
  }
  const pem = keyFile
    ? await readFile(resolve(keyFile), "utf8")
    : environment.FQGATE_MCP_APPS_ED25519_PRIVATE_KEY;
  if (!isNonEmptyString(pem)) {
    throw new Error(
      "正式发布必须提供 Ed25519 私钥：使用 --signing-key-file，或设置 FQGATE_MCP_APPS_ED25519_PRIVATE_KEY。"
    );
  }
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("MCP Apps 签名私钥必须是 Ed25519。");
  return privateKey;
}

export function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`无法识别的参数：${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数 --${name} 缺少值。`);
    if (values.has(name)) throw new Error(`参数 --${name} 重复。`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

export function assertStableBundleVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`稳定通道不能发布预发行版本：${version}`);
  }
}

function validateGeneratedManifest(manifest, expectedChannel) {
  assertExactKeys(
    manifest,
    ["schemaVersion", "component", "channel", "bundleVersion", "minimumFqgateVersion", "apps"],
    "生成清单"
  );
  if (manifest.schemaVersion !== 1 || manifest.component !== "fqgate-mcp-apps" || manifest.channel !== expectedChannel) {
    throw new Error("生成清单的版本、组件或通道无效。");
  }
  if (!versionPattern.test(manifest.bundleVersion) || !versionPattern.test(manifest.minimumFqgateVersion)) {
    throw new Error("生成清单的版本号无效。");
  }
  if (!Array.isArray(manifest.apps) || manifest.apps.length === 0) throw new Error("生成清单没有应用。");
  const ids = new Set();
  let sharedFile;
  let sharedSize;
  let sharedSha256;
  const uris = new Set();
  const boundPaths = new Set();
  let bundleSize = 0;
  for (const app of manifest.apps) {
    assertExactKeys(app, [...appKeys, "size", "sha256"], `生成应用 ${app?.id ?? "<unknown>"}`);
    if (!idPattern.test(app.id) || app.file !== sharedBuildFile || app.resourceUri !== `ui://fqgate/${app.id}.html`) {
      throw new Error(`生成应用 ${app.id} 的标识、文件名或资源地址无效。`);
    }
    if (ids.has(app.id) || uris.has(app.resourceUri)) {
      throw new Error(`生成应用 ${app.id} 与其他应用重复。`);
    }
    ids.add(app.id);
    if (sharedFile && sharedFile !== app.file) throw new Error("生成清单必须只引用一个共享构建文件。");
    sharedFile = app.file;
    uris.add(app.resourceUri);
    if (!isNonEmptyString(app.title) || app.title.length > 128 || !isNonEmptyString(app.description) || app.description.length > 512) {
      throw new Error(`生成应用 ${app.id} 缺少标题或说明。`);
    }
    if (!Array.isArray(app.toolPaths) || app.toolPaths.length === 0 || app.toolPaths.some((path) => !isApiPath(path))) {
      throw new Error(`生成应用 ${app.id} 的 toolPaths 无效。`);
    }
    for (const path of app.toolPaths) {
      if (boundPaths.has(path)) throw new Error(`一个接口不能绑定多个 MCP App：${path}`);
      boundPaths.add(path);
    }
    if (!Number.isSafeInteger(app.size) || app.size <= 0 || app.size > maximumAppSize || !/^[a-f0-9]{64}$/.test(app.sha256)) {
      throw new Error(`生成应用 ${app.id} 的文件校验信息无效。`);
    }
    if (sharedSize !== undefined && (sharedSize !== app.size || sharedSha256 !== app.sha256)) {
      throw new Error("生成清单中共享构建文件的校验信息不一致。");
    }
    sharedSize ??= app.size;
    sharedSha256 ??= app.sha256;
    if (ids.size === 1) bundleSize = app.size;
  }
  if (bundleSize > maximumBundleSize) throw new Error("MCP Apps 总大小超过 64 MiB。 ");
}

async function buildSharedEntry(temporaryDirectory, outputDirectory) {
  const entryDirectory = resolve(temporaryDirectory, "universal");
  await build({
    configFile: resolve(projectDirectory, "vite.mcp-apps.config.ts"),
    root: projectDirectory,
    logLevel: "warn",
    build: {
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      emptyOutDir: true,
      minify: true,
      modulePreload: false,
      outDir: entryDirectory,
      rollupOptions: {
        input: resolve(projectDirectory, "index.html"),
        output: {
          inlineDynamicImports: true,
          entryFileNames: "assets/app.js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  });

  const htmlPath = await findFile(entryDirectory, sharedBuildFile);
  const html = await inlineBuildAssets(htmlPath);
  await writeFile(resolve(outputDirectory, sharedBuildFile), html, "utf8");
}

async function inlineBuildAssets(htmlPath) {
  let html = await readFile(htmlPath, "utf8");
  const scriptPattern = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
  const stylePattern = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g;
  html = await replaceAsync(html, scriptPattern, async (_match, source) => {
    const code = await readReferencedAsset(htmlPath, source);
    return `<script type="module">${escapeClosingTag(code, "script")}</script>`;
  });
  html = await replaceAsync(html, stylePattern, async (_match, source) => {
    const css = await readReferencedAsset(htmlPath, source);
    return `<style>${escapeClosingTag(css, "style")}</style>`;
  });
  if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/i.test(html)) {
    throw new Error(`入口仍包含外部脚本或样式：${htmlPath}`);
  }
  return html;
}

async function readReferencedAsset(htmlPath, source) {
  if (/^[a-z]+:/i.test(source) || source.startsWith("//")) throw new Error(`不能内联远程资源：${source}`);
  return readFile(resolve(dirname(htmlPath), source.split(/[?#]/, 1)[0]), "utf8");
}

async function findFile(directory, fileName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, fileName).catch(() => undefined);
      if (nested) return nested;
    } else if (entry.name === fileName) {
      return candidate;
    }
  }
  throw new Error(`没有找到构建入口：${fileName}`);
}

async function replaceAsync(value, pattern, replacer) {
  const matches = [...value.matchAll(pattern)];
  let result = value;
  for (const match of matches.reverse()) {
    const replacement = await replacer(...match);
    result = result.slice(0, match.index) + replacement + result.slice(match.index + match[0].length);
  }
  return result;
}

function escapeClosingTag(value, tagName) {
  return value.replace(new RegExp(`</${tagName}`, "gi"), `<\\/${tagName}`);
}

async function verifyAppFile(directory, app) {
  const content = await readFile(resolve(directory, app.file));
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (content.byteLength !== app.size || actualHash !== app.sha256) {
    throw new Error(`应用文件校验失败：${app.file}`);
  }
}

async function replaceFile(source, destination) {
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await copyFile(source, temporaryPath);
  await replaceExistingFile(temporaryPath, destination);
}

async function replaceExistingFile(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await rm(destination, { force: true });
    await rename(source, destination);
  }
}

async function updateStablePointer(directory, stableTemp, signatureTemp) {
  const stablePath = resolve(directory, "stable.json");
  const signaturePath = resolve(directory, "stable.sig");
  const [previousStable, previousSignature] = await Promise.all([
    readFile(stablePath).catch((error) => error?.code === "ENOENT" ? undefined : Promise.reject(error)),
    readFile(signaturePath).catch((error) => error?.code === "ENOENT" ? undefined : Promise.reject(error))
  ]);
  try {
    // stable.json 最后切换；主程序不会看到指向尚未发布版本的新指针。
    await replaceExistingFile(signatureTemp, signaturePath);
    await replaceExistingFile(stableTemp, stablePath);
  } catch (error) {
    await restoreFile(signaturePath, previousSignature);
    await restoreFile(stablePath, previousStable);
    throw error;
  }
}

async function restoreFile(path, content) {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }
  const temporaryPath = `${path}.${process.pid}.rollback`;
  await writeFile(temporaryPath, content);
  await replaceExistingFile(temporaryPath, path);
}

async function writeSignature(path, bytes, privateKey) {
  const signature = sign(null, bytes, privateKey);
  if (signature.byteLength !== 64) throw new Error("Ed25519 签名长度不是 64 字节。");
  await writeFile(path, `${signature.toString("base64")}\n`, "utf8");
}

function verifySignature(bytes, encodedSignature, publicKey, label) {
  const value = encodedSignature.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} 的签名不是 Base64。`);
  const signature = Buffer.from(value, "base64");
  if (signature.byteLength !== 64 || !verify(null, bytes, publicKey, signature)) {
    throw new Error(`${label} 的 Ed25519 签名无效。`);
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(path) {
  return stat(path).then(() => true, () => false);
}

function assertExactKeys(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  const expected = new Set(allowedKeys);
  const actual = Object.keys(value);
  const unexpected = actual.filter((key) => !expected.has(key));
  const missing = allowedKeys.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${label} 字段不符合约定；多余：${unexpected.join(",") || "无"}；缺少：${missing.join(",") || "无"}。`);
  }
}

function assertManagedBuildOutput(directory) {
  const distDirectory = resolve(projectDirectory, "dist");
  const relativePath = relative(distDirectory, directory);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`构建输出必须位于 dist 目录内：${directory}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isApiPath(value) {
  return typeof value === "string" && /^\/v1\/[a-z0-9/_-]+$/.test(value);
}
