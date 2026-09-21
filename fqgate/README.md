# FQGate 下载与插件配套信息

FQGate 主程序和 AI 插件是两个不同的产品，版本号也各自管理。

> **下载地址别弄混**
>
> - `FQGate.exe` 主程序：只从 [FQGate 官方发行页](https://github.com/fqgate/FQGate-releases)下载。
> - AI 技能安装包：从 [FQGate-agent 发行页](https://github.com/fqgate/FQGate-agent/releases)下载；安装后会注册 `fqgate-realtime-stock-analyzer`（**同花顺免费实时数据代理**）和 `trade-execution`（**同花顺实盘交易代理**），把 FQGate 接入你使用的 AI 工具。
>
> `fqgate-realtime-stock-analyzer` 是当前行情技能 ID。`FQGate-agent` 的发行页只放 AI 技能安装包，不提供 `FQGate.exe`。

## 1.0.0 使用范围

FQGate 1.0.0 只提供行情，不再提供交易 API 和交易 MCP 工具。插件保留的交易技能仅供仍提供交易接口的旧版主程序使用；连接 1.0.0 时，不应尝试调用不存在的交易工具。

## 下载 FQGate

- 国内下载：[Gitee FQGate 正式发行页](https://gitee.com/qicuo/fqgate-releases/releases)
- 国外下载：[GitHub FQGate 正式发行页](https://github.com/fqgate/FQGate-releases/releases)

Windows 用户在仓库根目录运行下面这条命令即可：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\runtime\install-fqgate.ps1
```

它会自动选择当前正式版本，下载并检查 FQGate，把程序放到当前用户的应用目录，创建桌面快捷方式，启动主程序并检查连接。使用已经解压的插件安装包时，把脚本路径换成 `.\scripts\install-fqgate.ps1`。

## 当前配套版本

当前插件版本为 `1.0.0`，要求 FQGate `0.1.0` 或更高版本。插件只检查最低版本，不会因为 FQGate 升级到 `1.0.0` 或更高版本而阻止连接。最低版本见 [compatibility.json](./compatibility.json)。

FQGate 默认连接地址为 `http://127.0.0.1:17281/mcp`。只有 FQGate 已经启动、AI 工具中的 `fqgate` 连接成功，并且能够读取工具列表或完成健康检查，才算安装完成。只安装技能文件不算完成。

版本和下载文件请以 FQGate 官方发行页面为准，避免使用过期的下载信息。
