# 在 Claude Code 中使用 FQGate

## 卸载旧版 `tonghuasun-agent`

如果 Claude Code 已经安装旧版插件，请依次执行：

```text
/plugin uninstall tonghuasun-agent@tonghuasun-agent
/plugin marketplace remove tonghuasun-agent
/reload-plugins
```

如果第一条命令提示找不到默认范围中的插件，请运行 `/plugin`，进入“Installed”页，从实际安装范围中卸载 `tonghuasun-agent`，然后移除旧市场并重新加载。不要同时启用旧版 `tonghuasun-agent` 和新版 `fqgate-agent`；卸载旧插件不会删除 FQGate 主程序或共享配置。

命令说明见 [Claude Code 官方插件文档](https://code.claude.com/docs/en/discover-plugins)。

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

## 安装

先按上面的正式路径安装并启动 FQGate `0.1.0` 或更高版本，然后在 Claude Code 中依次执行：

```text
/plugin marketplace add fqgate/FQGate-agent
/plugin install fqgate-agent@tonghuasun-agent
/reload-plugins
```

重新加载后，新建任务并确认名为 `fqgate` 的 MCP 已连接。需要离线安装时，从 [1.0.0 发行页](https://github.com/fqgate/FQGate-agent/releases/tag/v1.0.0)下载 `fqgate-agent-claude-code-1.0.0.zip`，核对发行清单中的 SHA-256 后再导入。

## 使用边界

插件可以查询 FQGate 提供的行情、Level-2、账户和交易记录。持续订阅需使用 FQGate 原生 WebSocket/SSE，不把一次快照描述成持续盯盘。

交易写工具默认隐藏，开启后仍须逐笔核对并取得明确确认。详情见[隐私政策](../../docs/legal/PRIVACY.md)和[使用条款](../../docs/legal/TERMS.md)。
