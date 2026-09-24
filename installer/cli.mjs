#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InstallerOrchestrator, OrchestrationError } from "./core/orchestrator.mjs";

const installerRoot = dirname(fileURLToPath(import.meta.url));

await main().catch((error) => {
  const payload = error instanceof OrchestrationError
    ? { error: error.message, result: error.result }
    : { error: error instanceof Error ? error.message : String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const orchestrator = new InstallerOrchestrator({
    manifestDirectory: options.manifestDirectory,
    stateRoot: options.stateRoot
  });

  let result;
  if (options.command === "scan") result = await orchestrator.scan();
  else if (options.command === "detect") result = await orchestrator.detect(options.clientId);
  else if (options.command === "plan") result = await orchestrator.plan(options.clientId, options.intent);
  else if (options.command === "apply") {
    result = await orchestrator.apply(options.clientId, {
      planId: options.planId,
      confirmed: options.confirmed,
      intent: options.intent
    });
  } else if (options.command === "verify") result = await orchestrator.verify(options.clientId);
  else if (options.command === "repair") result = await orchestrator.repair(options.clientId);
  else if (options.command === "uninstall") {
    result = await orchestrator.uninstall(options.clientId, {
      planId: options.planId,
      confirmed: options.confirmed
    });
  } else {
    throw new Error(`未知命令：${options.command}`);
  }
  printResult(result, options.json);
}

function parseArguments(args) {
  const command = args.shift() || "scan";
  const commandsWithoutClient = new Set(["scan"]);
  const supportedCommands = new Set(["scan", "detect", "plan", "apply", "verify", "repair", "uninstall"]);
  if (!supportedCommands.has(command)) throw new Error(`未知命令：${command}`);

  const clientId = commandsWithoutClient.has(command) ? null : args.shift();
  if (!commandsWithoutClient.has(command) && (!clientId || clientId.startsWith("--"))) {
    throw new Error(`${command} 必须指定客户端，例如 codex 或 claude-code。`);
  }

  const options = {
    command,
    clientId,
    intent: "install",
    planId: null,
    confirmed: false,
    json: false,
    manifestDirectory: join(installerRoot, "manifests"),
    stateRoot: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" || argument === "--yes") {
      if (argument === "--json") options.json = true;
      else options.confirmed = true;
      continue;
    }
    const value = args[++index];
    if (!value) throw new Error(`${argument} 缺少参数值。`);
    if (argument === "--intent") options.intent = value;
    else if (argument === "--plan") options.planId = value;
    else if (argument === "--manifest-dir") options.manifestDirectory = resolve(value);
    else if (argument === "--state-root") options.stateRoot = resolve(value);
    else throw new Error(`未知参数：${argument}`);
  }

  if (!new Set(["install", "repair", "uninstall"]).has(options.intent)) {
    throw new Error(`不支持的 intent：${options.intent}`);
  }
  if (command === "uninstall") options.intent = "uninstall";
  if (command === "repair") options.intent = "repair";
  if (["apply", "uninstall"].includes(command) && !options.planId) {
    throw new Error(`${command} 必须使用 --plan 提供刚刚预览的 plan_id。`);
  }
  return options;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.operation === "scan") {
    for (const client of result.clients) {
      console.log(`${client.client_id}: ${client.state} (${client.client_version || "未发现版本"})`);
    }
    return;
  }
  for (const [key, value] of Object.entries(result)) {
    const rendered = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    console.log(`${key}=${rendered}`);
  }
}
