# 在 DeepSeek Harness 中使用 FQGate

## 卸载旧版 `tonghuasun-agent`

如果 `web` 配置已经安装旧版插件，请先关闭正在运行的 DeepSeek Harness，再执行：

```powershell
dsh plugin --profile web remove tonghuasun-agent-deepseek-harness
dsh plugin --profile web list
dsh web
```

第二条命令用于确认旧包已不在安装列表中。不要同时加载旧版 `tonghuasun-agent` 和新版 `fqgate-agent`；移除旧包不会删除 FQGate 主程序或共享配置。

命令说明见 [DeepSeek Harness 官方 CLI 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)。

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

先按上面的正式路径下载、校验并启动 FQGate `0.1.0` 或更高版本。在仓库根目录运行 `Build-Distribution.ps1` 生成 npm 包，然后执行：

```powershell
dsh plugin --profile web add <fqgate-agent-deepseek-harness-1.0.0.tgz>
dsh plugin --profile web exec fqgate-agent configure --fqgate-path "<FQGate 可执行文件>" --json
dsh web
```

Cordis 入口通过公共启动器连接 FQGate 自带的 STDIO 桥。连接失败时先运行 `status --json`，不要修改 FQGate 私有文件或把端口暴露到公网。

交易写工具默认隐藏，开启后仍须逐笔确认。详情见[隐私政策](../../docs/legal/PRIVACY.md)。
