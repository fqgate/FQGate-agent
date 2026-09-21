# 在 Codex 中使用 FQGate

本插件把 Codex 直接连接到当前电脑上运行中的 FQGate。行情、账户和交易工具由 FQGate 提供；插件负责连接和使用规范。

支持界面的工具会直接显示由 FQGate 提供的交互组件。组件与独立预览使用同一份界面，不会因为 Codex 适配而维护第二套布局；界面尚未加载时，查询结果仍会以文字正常返回。

当前界面资源覆盖行情登录、个股行情、资讯、多股行情和 L2 逐笔委托；是否显示对应界面，由已安装的 FQGate 版本和本次调用结果决定。

## 卸载旧版 `tonghuasun-agent`

如果 Codex 已经安装旧版 `tonghuasun-agent`（旧显示名“同花顺 Agent”），请先完成以下操作：

1. 打开 Codex 的 Plugins 页面，进入“已安装”列表。
2. 打开 `tonghuasun-agent` 的详情页，选择“卸载插件”。
3. 确认它不再显示为已安装，然后新建任务。

不要同时保留旧版 `tonghuasun-agent` 和新版 `fqgate-agent`。卸载旧插件不会删除 FQGate 主程序或共享配置。

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

## 安装与配置

1. 运行上面的自动安装命令；本机已有相同正式版本时会直接复用。
2. 在仓库根目录运行 `Build-Distribution.ps1`，在 Codex 的 Plugins 页面安装生成的 `fqgate-agent-codex-1.0.0.zip`。
3. 新建任务并发送“配置 FQGate”。自动发现失败时，只需提供 `fqgate.exe` 或 `FQGate.app/Contents/MacOS/fqgate` 的路径。
4. 确认检查结果中的 `mcpReachable=true` 且 `toolCount` 大于零。

Codex 插件的安装方式见 [OpenAI 官方插件说明](https://learn.chatgpt.com/docs/plugins)。

## 使用边界

可以查询行情、K 线、Level-2、账户、资产、持仓、委托和成交。持续 WebSocket/SSE 订阅不是一次性 MCP 工具，应使用 FQGate 原生流接口。

真实资金写工具默认隐藏。只有用户自行开启 FQGate 的交易写开关并逐笔确认后才能调用；超时或结果未知时禁止自动重试。

FQGate 数据可能由用户选择的 Codex 服务处理，详情见[隐私政策](../../docs/legal/PRIVACY.md)。
