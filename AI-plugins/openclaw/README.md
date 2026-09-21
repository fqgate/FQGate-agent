# 在 OpenClaw 中使用 FQGate

## 卸载旧版 `tonghuasun-agent`

如果 OpenClaw 已经安装旧版插件，请先执行：

```powershell
openclaw plugins uninstall tonghuasun-agent --dry-run
openclaw plugins uninstall tonghuasun-agent
openclaw gateway restart
```

第一条命令只预览将被移除的内容；确认目标确实是 `tonghuasun-agent` 后再执行第二条命令。不要同时启用旧版 `tonghuasun-agent` 和新版 `fqgate-agent`；卸载旧插件不会删除 FQGate 主程序或共享配置。

命令说明见 [OpenClaw 官方插件文档](https://docs.openclaw.ai/cli/plugins)。

## FQGate 主程序

> **下载地址别弄混**
>
> - `FQGate.exe` 主程序：只从 [FQGate 官方发行仓库](https://github.com/fqgate/FQGate-releases)下载。
> - AI 技能安装包：从 [FQGate-agent 发行页](https://github.com/fqgate/FQGate-agent/releases)下载。安装后会注册 `fqgate-realtime-stock-analyzer`（**同花顺免费实时数据代理**）和 `trade-execution`（**同花顺实盘交易代理**）。
>
> `fqgate-realtime-stock-analyzer` 是当前行情技能 ID。`FQGate-agent` 的发行页只放 AI 技能安装包，不提供 `FQGate.exe`。

FQGate 主程序从 [FQGate 官方下载页](https://github.com/fqgate/FQGate-releases/releases)获取。AI 安装时，先读取 [FQGate 稳定版清单](https://raw.githubusercontent.com/fqgate/FQGate-releases/main/releases/stable.json)，按当前系统选择文件并核对大小和 SHA-256。直接下载地址为 `https://github.com/fqgate/FQGate-releases/releases/download/fqgate-v<version>/<fileName>`。

安装完成后，为 FQGate 创建一个桌面快捷方式，方便以后启动。安装结束前，确认 FQGate 已经启动、名为 `fqgate` 的连接已经成功，并且能够读取工具列表或完成健康检查。

Windows 用户可以在仓库根目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\runtime\install-fqgate.ps1`；使用已经解压的插件安装包时，运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-fqgate.ps1`。命令会完成正式版下载、校验、固定目录安装、快捷方式创建、启动和连接检查。

先按上面的正式路径下载、校验并启动 FQGate `0.1.0` 或更高版本，再解压 `fqgate-agent-openclaw-1.0.0.zip` 并执行：

```powershell
openclaw plugins install .\fqgate-agent
openclaw plugins enable fqgate-agent
openclaw gateway restart
```

随后发送“配置 FQGate”。自动发现失败时提供 FQGate 可执行文件路径。可用以下命令检查入口：

```powershell
openclaw plugins inspect fqgate-agent --runtime --json
```

升级时使用 `openclaw plugins install .\fqgate-agent --force` 后重启 Gateway。卸载前可先运行 `openclaw plugins uninstall fqgate-agent --dry-run`；卸载单个入口不会删除共享 FQGate 配置或程序。

交易写工具默认隐藏，开启后仍须逐笔确认。详情见[隐私政策](../../docs/legal/PRIVACY.md)。
