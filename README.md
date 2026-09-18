# 同花顺免费开源AI插件FQGate (QQ群-14546787)

> 面向 Codex、Claude Code、WorkBuddy、ZCode、OpenClaw、DeepSeek Harness、豆包和千问的本机 A 股行情与量化数据插件

> **1.0.0 升级提醒：** 配套的 FQGate 1.0.0 主程序只提供行情，不再提供交易 API 和交易 MCP 工具。下文的账户查询、交易技能和交易示例仅适用于仍提供这些接口的旧版主程序；连接 1.0.0 时请以实际工具列表为准。插件只设主程序最低版本，不限制更高版本。

---

## 🚀🚀🚀 一句话安装｜复制后发给 AI 🚀🚀🚀

> ⭐⭐⭐ **复制下面这句话，发送给你正在使用的 AI 助手** ⭐⭐⭐

```text
安装并配置同花顺免费开源AI插件FQGate：https://gitee.com/qicuo/tonghuasun-agent.git
```

### 👆👆👆 复制上面这句话即可开始安装 👆👆👆

> ✅ 自动选择对应安装方式　✅ 安装 FQGate 正式版　✅ 安装 AI 插件　✅ 检查连接

---

### 数据来自同花顺，响应更快、运行更稳定

通过这个插件，你可以在常用 AI 助手中直接查询 A 股实时行情、分时、K 线、Level-2 逐笔数据、资讯公告、证券资料、账户资产、持仓、委托和成交数据，也可以在明确确认后执行交易操作。

> **更名说明：** 本项目原插件名为 `tonghuasun-agent`，现已更名为 `fqgate-agent`。GitHub 和 Gitee 仓库地址继续沿用原名称，方便旧用户、已有收藏和外部链接继续访问。当前展示名称为“同花顺免费开源AI插件FQGate”。

所有 AI 插件入口、安装适配、技能和界面组件均免费开源，不设订阅、会员、套餐、试用额度或付费解锁。FQGate 作为本机量化网关单独提供编译包，并适用其随包许可。

这是一个由独立开发者维护的非官方项目，与同花顺及其关联公司不存在授权、合作或背书关系。插件不会增加任何行情、账户或交易权限，你能看到的数据和能使用的功能仍以当前账户及相应服务权限为准。

> **当前插件版本为 `1.0.0`，要求 FQGate `0.1.0` 或更高版本。** AI 插件安装包可以从 GitHub 或 Gitee 下载；FQGate 主程序请从下方的官方下载页获取。

## 项目地址

- 国内仓库：[Gitee](https://gitee.com/qicuo/tonghuasun-agent)
- GitHub 仓库：[GitHub](https://github.com/zhuyifang/tonghuasun-agent)

## 安装说明

如果你是 AI 助手，请先识别当前使用的 AI 工具，再打开下方对应的安装说明，完成主程序、插件和连接配置。

### FQGate 主程序下载

- 官方下载：[FQGate 正式发行页](https://github.com/zhuyifang/fqgate-releases/releases)
- 当前版本、文件名、大小和 SHA-256：[FQGate 稳定版清单](https://raw.githubusercontent.com/zhuyifang/fqgate-releases/main/releases/stable.json)

让 AI 帮你安装时，AI 应先查看稳定版清单，再下载适合当前电脑的文件。直接下载地址是 `https://github.com/zhuyifang/fqgate-releases/releases/download/fqgate-v<version>/<fileName>`，下载后核对文件大小和 SHA-256。

Windows 用户可以直接运行一条命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\runtime\install-fqgate.ps1
```

这条命令会读取正式版清单，下载并校验 FQGate，把程序放到当前用户的应用目录，创建桌面快捷方式，启动主程序并检查连接。使用已经解压的插件安装包时，把脚本路径换成 `.\scripts\install-fqgate.ps1`。

安装结束前，AI 应确认 FQGate 已经启动、名为 `fqgate` 的连接已经成功，并且能够读取工具列表或完成健康检查。如果连接尚未成功，应直接告诉用户“插件文件已安装，但 FQGate 尚未连接”。

AI 助手会根据你使用的工具选择对应的正式安装包并完成配置。自动安装失败时，可以前往 [GitHub 发行页面](https://github.com/zhuyifang/tonghuasun-agent/releases) 或 [Gitee 发行页面](https://gitee.com/qicuo/tonghuasun-agent/releases) 手动下载。

## 选择你使用的 AI 工具

- [在 Codex 中安装](./AI-plugins/codex/README.md)
- [在 Claude Code 中安装](./AI-plugins/claude-code/README.md)
- [在 WorkBuddy 中安装](./AI-plugins/workbuddy/README.md)
- [在 ZCode 中安装](./AI-plugins/zcode/README.md)
- [在 OpenClaw 中安装](./AI-plugins/openclaw/README.md)
- [在 DeepSeek Harness 中安装](./AI-plugins/deepseek-harness/README.md)
- [在豆包中安装](./AI-plugins/doubao/README.md)
- [在千问中安装](./AI-plugins/qianwen/README.md)

## 你可以直接这样问

插件只提供两个清晰入口：“同花顺免费实时数据代理”负责行情、资讯、行情登录和连接处理；“同花顺实盘交易代理”负责账户、持仓和实盘交易。登录和配置不会单独显示成技能。

- “查看航天机电的当前行情。”
- “显示贵州茅台最近一个月的日 K 线。”
- “同时对比工业富联、招商银行和宁德时代的行情。”
- “查看这只股票今天的盘口和 Level-2 逐笔委托。”
- “汇总我的账户资产和当前持仓。”
- “显示今天的委托、成交和撤单记录。”

## 为什么选择 FQGate

> **响应更快、运行更稳定**
>
> [FQGate](https://github.com/zhuyifang/fqgate-releases) 是本项目使用的本机量化网关。与常见的网页抓取、脚本转发或多层接口封装方案相比，FQGate 最核心的优势是**响应更快、运行更稳定**：它以本机常驻服务直接连接行情与交易会话，减少中间转发和重复初始化，再通过统一的超时、错误码、请求编号和日志机制，让长时间运行时的失败边界更明确、问题更容易定位。

- 一个 FQGate 实例可以同时服务多个 AI 工具，不需要为每个工具重复维护数据连接。
- 行情、账户、交易和插件界面使用统一接口，不同 AI 工具之间的体验更一致。
- 本机接口默认只监听 `127.0.0.1`，不会为了接入 AI 工具而开放公网服务。

## 使用前准备

- 安装并启动 FQGate `0.1.0` 或更高版本。
- 在 FQGate 中完成行情登录；查询账户或交易时，还需要单独登录对应券商账户。
- 首次安装或升级插件后，如果当前任务没有显示新工具，请新建任务或重新加载插件。
- 核心程序尚未使用代码签名，发行包提供 SHA-256 校验信息；如果不能接受闭源且未签名的本机组件，请不要安装或开启交易功能。

## 界面组件

插件已提供行情登录、个股行情、资讯、多股行情和 Level-2 逐笔委托界面。界面直接连接本机 FQGate，不提供模拟行情；是否显示相应数据，取决于当前登录状态和账户权限。

[交易接口演示](./examples/trading-demo/README.md)可用于查看账户、资产、持仓和交易记录，并核对委托等操作的请求与返回结果。

## 文档与交流

- 本机接口文档：[127.0.0.1:17281/docs](http://127.0.0.1:17281/docs)
- QQ 群：[免费AI量化数据](https://qm.qq.com/q/ZQSuiYQZ4Q)，群号：`14546787`
- 微信群：同花顺 AI Agent 插件交流（当前二维码有效期至 2026 年 9 月 25 日；失效后请提交 Issue 提醒更新）

<p align="center">
  <img src="./assets/community/wechat-agent-group-qr.png" alt="同花顺 AI Agent 插件交流群二维码，有效期至 2026 年 9 月 25 日" width="280">
</p>

## 关于交易功能

交易工具默认隐藏，只有你主动开启后才会出现。下单、撤单、申购或划转前，AI 必须展示完整操作内容并等待你单独确认；结果未知时不会自动重试。

交易功能涉及真实资金，请先用查询功能核对账户和权限，并以券商及交易所的最终记录为准。

## 不是投资建议

本项目是一项数据连接和展示工具，不提供个股推荐、收益预测或投资建议。AI 生成的内容可能存在错误或延迟，行情、资金、委托和成交状态请以同花顺、证券公司及交易所的正式记录为准。

## 数据与隐私

FQGate 默认只监听当前电脑的 `127.0.0.1:17281`，AI 插件不会连接公网或局域网中的 FQGate 地址。行情、账户和交易数据不会上传给项目维护者。

使用云端 AI 服务时，工具结果可能由你选择的服务处理，具体以该服务的隐私政策和设置为准。详细说明见[隐私政策](./docs/legal/PRIVACY.md)，软件风险见[使用条款](./docs/legal/TERMS.md)。

## 支持项目

<p align="center">
  <a href="./assets/support/support-banner.png">
    <img src="./assets/support/support-banner.png" alt="如果这个项目对你有帮助，欢迎打赏支持" width="100%">
  </a>
</p>

如果这个项目对你有帮助，欢迎打赏支持。打赏完全自愿，不用于购买任何功能、数据权限、投资建议、问题处理优先级或后续服务承诺。

赞赏者：<img src="./assets/sponsors/feng-kevin.jpg" alt="峰-Kevin" width="32" height="32"> **峰-Kevin** · <img src="./assets/sponsors/adong.jpg" alt="阿东" width="32" height="32"> **阿东** · <img src="./assets/sponsors/xingguang.jpg" alt="星光" width="32" height="32"> **星光** · <img src="./assets/sponsors/xu.jpg" alt="許" width="32" height="32"> **許** · <img src="./assets/sponsors/xuhao.jpg" alt="序号" width="32" height="32"> **序号** · <img src="./assets/sponsors/ice.jpg" alt="ICE" width="32" height="32"> **ICE** · <img src="./assets/sponsors/u_u.jpg" alt="U_U" width="32" height="32"> **U_U** · <img src="./assets/sponsors/wd.jpg" alt="wd" width="32" height="32"> **wd** · <img src="./assets/sponsors/betterme.png" alt="@BetterMe（借钱勿扰）" width="32" height="32"> **@BetterMe（借钱勿扰）**

## 版本与开源说明

- 版本兼容关系及下载校验信息：[FQGate 集成信息](./fqgate/README.md)
- 当前版本说明：[RELEASE_NOTES.md](./RELEASE_NOTES.md)
- 插件界面项目：[AI-plugins/ui-apps](./AI-plugins/ui-apps/README.md)

AI 插件入口、安装适配、技能、界面组件和可选 SDK 依据 AGPL-3.0-only 开源。FQGate 编译包适用其随包许可，详细范围见[法律与许可说明](./docs/legal/)。
