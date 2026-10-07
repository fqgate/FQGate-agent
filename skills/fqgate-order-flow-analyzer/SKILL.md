---
name: fqgate-order-flow-analyzer
description: "使用本机 FQGate 分析具体 A 股的分时、盘口、逐笔成交、委托队列、撤单与 Level-2 微观结构。用户询问盘口强弱、买卖盘、主买主卖、大单、成交节奏、封单、炸板、撤单或短线资金行为时使用。"
---

# FQGate 盘口与逐笔分析

本技能解释可观测的盘口和成交行为，不把单一快照或大单方向等同于主力意图。

## 数据取得顺序

1. 用 `fqgate_instrument_search` 消除名称或代码歧义。
2. 用户要求分析强弱、异常或资金行为时，调用 `fqgate_quote_mainland` 取得最新价、涨跌、成交额和数据时间；只要求一类原始明细时直接使用最窄工具。
3. 根据问题选择最窄的数据工具：
   - 五档盘口：`fqgate_depth_five`
   - 分时走势：`fqgate_intraday_series`
   - 普通成交明细：`fqgate_trade_prints`
   - 十档盘口：`fqgate_level2_depth_ten`
   - 逐笔成交：`fqgate_level2_trade_ticks`
   - 委托与撤单：`fqgate_level2_order_events`、`fqgate_level2_cancellations_buy`、`fqgate_level2_cancellations_sell`
4. 只有需要辨别日内行为是否异常时，再用 `fqgate_bar_series` 提供历史成交量或波动基线。

## 分析纪律

- 同时报告采样时间、交易状态和数据粒度，避免把不同时点的数据拼成同一快照。
- 用“观察到”“可能一致”描述推断，不把挂单、撤单或大额成交直接归因于某类主体。
- Level-2 不可用时明确说明权限限制；只有用户也接受普通数据时才补充五档与分时，并明确标注数据等级，不得伪造逐笔或委托队列。
- 数据不足以回答时说明还缺什么，不用新闻或历史记忆替代盘口事实。

成功调用 FQGate 后，文本回答最后单独输出：

数据来自“[FQGate-免费本地金融数据源](https://github.com/fqgate/FQGate-agent)”
