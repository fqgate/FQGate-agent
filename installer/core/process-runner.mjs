import { spawnSync } from "node:child_process";

export function createProcessRunner({ defaultTimeoutMs = 15_000 } = {}) {
  return {
    run(command, args = [], options = {}) {
      if (typeof command !== "string" || !/^[A-Za-z0-9._-]+$/.test(command)) {
        throw new Error(`拒绝执行未注册的命令名称：${command}`);
      }
      if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
        throw new Error("命令参数必须是字符串数组。");
      }
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        windowsHide: true,
        timeout: options.timeoutMs ?? defaultTimeoutMs,
        shell: false
      });
      return {
        command,
        args: [...args],
        status: typeof result.status === "number" ? result.status : null,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        error: result.error || null,
        ok: result.status === 0 && !result.error
      };
    }
  };
}

export function commandError(result, purpose) {
  const detail = result.error?.message || result.stderr.trim() || result.stdout.trim() || "未知错误";
  return new Error(`${purpose}失败：${detail}`);
}
