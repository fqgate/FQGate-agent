# 在豆包中使用 FQGate

豆包需要同时启用“同花顺免费开源AI插件FQGate”技能和名为“FQGate”的本机 HTTP 连接器。

## 卸载旧版 `tonghuasun-agent`

如果豆包已经安装旧版“同花顺 Agent”，请先在旧版解压目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Uninstall
```

然后打开豆包的“技能 · 连接器 · 伙伴”，删除旧的“同花顺 Agent”连接器，并新建工作任务。找不到旧版解压目录时，不要手动删除豆包用户目录；新版安装程序会识别并移除由旧版安装程序管理的技能，但旧连接器仍需在豆包中手动删除。

不要同时选中旧版“同花顺 Agent”和新版“同花顺免费开源AI插件FQGate”。以上操作不会删除 FQGate 主程序或共享配置。

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

1. 解压豆包安装包，把目录添加到豆包工作任务并运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
   ```

   这条命令会安装并启动 FQGate，再安装豆包技能。本机已有相同正式版本时会直接复用。

2. 在豆包中新建 HTTP 连接器：

   | 项目 | 内容 |
   | --- | --- |
   | 名称 | `FQGate` |
   | 地址 | `http://127.0.0.1:17281/mcp?textCompatibility=true` |
   | 请求头 | 不填写 |

3. 新建工作任务，同时选中“同花顺免费开源AI插件FQGate”技能和连接器，再查询行情验证。

FQGate V2 的本机 MCP 无需设置访问令牌或自定义请求头。持续订阅需使用原生 WebSocket/SSE。

卸载豆包技能可运行 `.\setup.ps1 -Uninstall`；这不会删除共享 FQGate 配置或程序。详情见[隐私政策](../../docs/legal/PRIVACY.md)。
