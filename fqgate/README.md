# FQGate 下载与插件配套信息

FQGate 主程序和 AI 插件是两个不同的产品，版本号也各自管理。

> **下载地址别弄混**
>
> - `FQGate.exe` 主程序：只从 [FQGate 官方发行仓库](https://github.com/zhuyifang/fqgate-releases)下载。
> - AI 技能安装包：从 [tonghuasun-agent 发行页](https://github.com/zhuyifang/tonghuasun-agent/releases)下载。安装后会注册 `fqgate-realtime-stock-analyzer`（**同花顺免费实时数据代理**）和 `trade-execution`（**同花顺实盘交易代理**）。
>
> `fqgate-realtime-stock-analyzer` 是当前行情技能 ID。`tonghuasun-agent` 的发行页只放 AI 技能安装包，不提供 `FQGate.exe`。

## 1.0.0 使用范围

FQGate 1.0.0 只提供行情，不再提供交易 API 和交易 MCP 工具。插件保留的交易技能仅供仍提供交易接口的旧版主程序使用；连接 1.0.0 时，不应尝试调用不存在的交易工具。

## 下载 FQGate

- 正式发行页：[FQGate 官方下载页](https://github.com/zhuyifang/fqgate-releases/releases)
- 当前稳定版的文件名、大小和 SHA-256：[稳定版清单](https://raw.githubusercontent.com/zhuyifang/fqgate-releases/main/releases/stable.json)

Windows 用户在仓库根目录运行下面这条命令即可：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\runtime\install-fqgate.ps1
```

它会根据稳定版清单下载并校验 FQGate，把程序放到当前用户的应用目录，创建桌面快捷方式，启动主程序并检查连接。使用已经解压的插件安装包时，把脚本路径换成 `.\scripts\install-fqgate.ps1`。

## 当前配套版本

当前插件版本为 `1.0.0`，要求 FQGate `0.1.0` 或更高版本。插件只检查最低版本，不会因为 FQGate 升级到 `1.0.0` 或更高版本而阻止连接。最低版本见 [compatibility.json](./compatibility.json)。

FQGate 默认连接地址为 `http://127.0.0.1:17281/mcp`。只有 FQGate 已经启动、AI 工具中的 `fqgate` 连接成功，并且能够读取工具列表或完成健康检查，才算安装完成。只安装技能文件不算完成。

本目录不再保存 FQGate 发行清单的副本，避免副本没有及时更新，导致 AI 把已经发布的版本误判为“尚未发布”。
