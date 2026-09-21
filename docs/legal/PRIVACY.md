# 隐私政策

更新日期：2026 年 9 月 9 日

## 本机处理

本项目不运营接收行情、账户或交易数据的远程服务器。FQGate 在用户电脑上连接行情与交易服务，并通过仅监听回环地址的接口把结果交给当前电脑上的 AI 客户端或程序。

V2 Agent 启动器只读取 FQGate 可执行文件路径、本机 MCP 地址和版本，不读取或保存行情密码、资金账号、交易密码、短信验证码、访问令牌、持仓或委托内容。默认共享配置为：

- Windows：`%LOCALAPPDATA%\fqgate\agent-plugin.json`
- macOS：`~/Library/Application Support/fqgate/agent-plugin.json`

FQGate 自身的登录信息、日志和安全策略以其随包文档为准。

## 必要网络连接

- FQGate 会按功能需要连接同花顺、证券公司或相关数据服务；问财查询会发送到相应服务。
- 下载或更新时可能访问 GitHub、Gitee 或其他明确登记的发行地址。
- 云端 AI 客户端可能把用户问题和工具返回结果发送给其模型服务；这由用户选择的服务及其隐私政策负责。

本项目不会把 FQGate MCP 配置成公网或局域网地址，也不会自动建立端口映射、内网穿透或反向代理。

## 删除数据

卸载单个 AI 入口只删除该入口管理的文件，不删除共享 FQGate 配置。用户明确要移除所有 Agent 连接配置时，可以运行：

```powershell
node scripts/configure-fqgate.mjs uninstall --json
```

FQGate 程序、登录状态和日志需要按 FQGate 随包说明单独处理。

## 安全联系

不要在 Issue、聊天、截图或日志附件中提交证券账号、密码、验证码、完整持仓和交易明细。安全问题请使用 [GitHub 私密安全报告](https://github.com/fqgate/FQGate-agent/security/advisories/new)。
