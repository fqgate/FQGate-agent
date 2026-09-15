# 在 WorkBuddy 中使用 FQGate

## 卸载旧版 `tonghuasun-agent`

如果 WorkBuddy 已经安装旧版 `tonghuasun-agent`（旧显示名“同花顺 Agent”），请先完成以下操作：

1. 打开 WorkBuddy 的插件管理页面，进入“已安装”列表。
2. 打开“同花顺 Agent”的详情，选择卸载。
3. 确认旧插件已经从已安装列表中移除，然后重启 WorkBuddy。

不要同时启用旧版 `tonghuasun-agent` 和新版 `fqgate-agent`。卸载旧插件不会删除 FQGate 主程序或共享配置。

界面入口见 [WorkBuddy 官方插件文档](https://www.codebuddy.cn/docs/workbuddy/Plugins)。

## FQGate 主程序

> **下载地址别弄混**
>
> - `FQGate.exe` 主程序：只从 [FQGate 官方发行仓库](https://github.com/zhuyifang/fqgate-releases)下载。
> - AI 技能安装包：从 [tonghuasun-agent 发行页](https://github.com/zhuyifang/tonghuasun-agent/releases)下载。安装后会注册 `fqgate-realtime-stock-analyzer`（**同花顺免费实时数据代理**）和 `trade-execution`（**同花顺实盘交易代理**）。
>
> `fqgate-realtime-stock-analyzer` 是当前行情技能 ID。`tonghuasun-agent` 的发行页只放 AI 技能安装包，不提供 `FQGate.exe`。

FQGate 主程序从 [FQGate 官方下载页](https://github.com/zhuyifang/fqgate-releases/releases)获取。AI 安装时，先读取 [FQGate 稳定版清单](https://raw.githubusercontent.com/zhuyifang/fqgate-releases/main/releases/stable.json)，按当前系统选择文件并核对大小和 SHA-256。直接下载地址为 `https://github.com/zhuyifang/fqgate-releases/releases/download/fqgate-v<version>/<fileName>`。

安装完成后，为 FQGate 创建一个桌面快捷方式，方便以后启动。安装结束前，确认 FQGate 已经启动、名为 `fqgate` 的连接已经成功，并且能够读取工具列表或完成健康检查。

Windows 用户可以在仓库根目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\runtime\install-fqgate.ps1`；使用已经解压的插件安装包时，运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-fqgate.ps1`。命令会完成正式版下载、校验、固定目录安装、快捷方式创建、启动和连接检查。

1. 按上面的正式路径下载、校验并启动 FQGate `0.1.0` 或更高版本；本机已有符合要求的版本时直接复用。
2. 从 [1.0.0 发行页](https://gitee.com/qicuo/tonghuasun-agent/releases/tag/v1.0.0)下载并校验 `fqgate-agent-workbuddy-1.0.0.zip`。
3. 在 WorkBuddy 终端执行以下命令；发行包本身就是正式插件市场，不需要再创建“本机验收市场”：

   ```powershell
   codebuddy plugin marketplace add .\fqgate-agent-workbuddy-1.0.0.zip --name fqgate-official
   codebuddy plugin install fqgate-agent@fqgate-official
   ```

4. 重启 WorkBuddy，调用“同花顺免费实时数据代理”检查连接；自动发现失败时提供 FQGate 可执行文件路径。
5. 用 `fqgate_market_market_health` 验证本机 MCP 连接。

安装后只显示“同花顺免费实时数据代理”和“同花顺实盘交易代理”两个技能。行情登录、连接检查和故障处理属于数据代理的内部能力，不会额外占用技能入口。

WorkBuddy 入口开启了 FQGate 的结构化结果文字兼容模式。文字副本只用于客户端兼容，不代表需要重复调用工具。

真实资金写工具默认隐藏，开启后仍须逐笔确认。持续订阅使用 FQGate 原生流接口。详情见[隐私政策](../../docs/legal/PRIVACY.md)。
