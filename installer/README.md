# FQGate Agent 安装编排器

这是一个可运行的第一版编排器，用 YAML 描述 Codex 与 Claude Code 的接入差异，用受控 Adapter 执行实际操作。

它遵循统一生命周期：

```text
detect → plan → apply → verify → repair → uninstall
```

## 安全边界

- YAML 不能包含任意 shell 或 PowerShell，只能选择编排器中已经注册的 Adapter 能力。
- `plan` 只读取状态并输出预览，不创建计划文件、不修改宿主配置。
- `apply` 会重新生成计划并核对 `plan_id`；环境变化后旧计划自动失效。
- 写入前备份宿主配置和受影响的 Skill 目录，通过临时路径和原子替换保存编排器状态。
- 失败时先执行已注册动作的逆操作，再恢复原始配置文件和 Skill 目录。
- 仅卸载编排器明确记录为自己创建的资源；同名但来源不明的配置或 Skill 不会删除、覆盖。
- 普通输出只包含配置摘要和 SHA-256，不输出配置正文或令牌。

## 使用

先安装 YAML 解析依赖：

```bash
npm --prefix installer ci
```

查看当前客户端：

```bash
node installer/cli.mjs scan --json
```

预览并执行 Codex 接入：

```bash
node installer/cli.mjs plan codex --json
node installer/cli.mjs apply codex --plan <plan_id> --yes --json
node installer/cli.mjs verify codex --json
```

修复仍然先生成计划：

```bash
node installer/cli.mjs repair codex --json
node installer/cli.mjs apply codex --intent repair --plan <plan_id> --yes --json
```

卸载也必须先预览：

```bash
node installer/cli.mjs plan codex --intent uninstall --json
node installer/cli.mjs uninstall codex --plan <plan_id> --yes --json
```

Claude Code 使用相同命令，只需把客户端标识改为 `claude-code`。

## YAML 清单

第一版清单位于 `manifests/`。清单只描述宿主元数据、连接目标、需要保护的配置文件和重启提示；具体命令由对应 Adapter 固定实现。

```yaml
schemaVersion: 1
id: codex
displayName: Codex
adapter: codex

executable:
  command: codex
  versionArgs:
    - --version

connection:
  name: fqgate
  transport: http
  url: http://127.0.0.1:17281/mcp

skills:
  - id: fqgate-realtime-stock-analyzer
    source: ../../skills/fqgate-realtime-stock-analyzer
    adapterInstructions: ../../AI-plugins/codex/ADAPTER.md
    target: ${CODEX_HOME}/skills/fqgate-realtime-stock-analyzer
  - id: trade-execution
    source: ../../skills/trade-execution
    adapterInstructions: ../../AI-plugins/codex/ADAPTER.md
    target: ${CODEX_HOME}/skills/trade-execution

backup:
  paths:
    - ${CODEX_HOME}/config.toml
    - ${CODEX_HOME}/skills/fqgate-realtime-stock-analyzer
    - ${CODEX_HOME}/skills/trade-execution

restart:
  required: true
  reason: 已经运行的 Codex 会话可能不会自动重新加载 MCP 配置与 Skill。
```

Codex Adapter 会复用 1.0 正式发行的组装规则：复制两个公共 Skill，并在各自的 `SKILL.md` 末尾追加 `AI-plugins/codex/ADAPTER.md`。因此编排安装得到的是完整的 Codex Skill，而不是缺少宿主语义的公共源目录副本。

目前允许的路径变量只有 `HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 和 `CLAUDE_USER_CONFIG`。新增 AI 工具时，应先增加专用 Adapter 和测试，再把新的 `adapter` 标识加入清单校验器；不要在 YAML 中开放通用命令执行。

Claude Code 清单暂时要求 `2.1.224` 或更新版本，因为当前插件市场使用带 SHA-256 的 archive 来源，这类来源从该版本开始支持。版本不足时只输出不可用原因，不尝试安装或修改配置。

## 当前验证边界

`verify` 分开报告：

- 配置是否已经写入；
- 两个 FQGate Skill 是否完整安装且内容哈希匹配；
- 宿主 CLI 是否能识别配置；
- 当前宿主会话是否仍需重新加载；
- FQGate MCP 是否可连接并返回工具。

因此，写入完成不会被直接显示为 `verified`。当清单声明需要重启时，结果会保持 `restart_required`，直到桌面端后续接入宿主级加载证据。
