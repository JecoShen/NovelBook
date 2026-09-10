# Rule 模板说明

> 模板位置: `content-node-templates/rule/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/rule/` (V1 规则: 区块链支付通道规则 / 金融牌照制度 / 跨境外汇管制)

## §1 用途

规则卡模板，用于世界规则 / 物理 / 金融制度 / 法律建模。`index.md` 是基础卡，body 段是规则详情（条件 / 例外 / 影响）。

跟其他 entity 区别：

- `rule` 是 `note` 的**正式态**（status = active 优先）
- `rule` 是 `world-engine/` 的输入（时间线 / 日历 / 事件溯源依赖规则判定）
- `rule` 的 body 段结构化（条件 / 例外 / 影响）

## §2 必填字段

- `title` (string) — 规则名（e.g. "区块链支付通道规则"）
- `type` (enum, = "rule") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`（`active` 为主）
- `summary` (string) — 一句话规则要点
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 规则细分（如 `physical` / `financial` / `legal` / `social` / `technological`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用相关规则 / 派系 / 法律
- `retrieval.trigger` (string[]?)
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展

## §4 填表示例

```yaml
---
title: 区块链支付通道规则
type: rule
subtype: financial
status: active
aliases: [支付通道, payment channel, 链上支付]
tags:
  - V1 主线
  - 陆深副业
  - 金融科技
summary: "区块链链上支付通道的 KYC + 限额 + 冻结规则，V1 陆深副业的核心约束。"
refs:
  - ../faction/chaininnovate-fintech/
  - ../item/finance-license/
retrieval:
  enabled: true
  trigger: [支付通道, payment channel, KYC, 限额, 链上支付]
governance:
  source: creation-constitution
  review: approved
---

## 规则设定

### 条件

- KYC 二级认证（身份证 + 银行卡四要素）
- 单笔限额 5 万 CNY
- 日累计限额 20 万 CNY
- 月累计限额 100 万 CNY

### 例外

- VIP 客户可提升限额（需人工审批）
- 跨境支付走外管局单独通道

### 影响

- 陆深副业走通道时不能超 5 万/笔
- 苏念公司走通道需 VIP 通道
- 鹏达系通过 VIP 通道规避限额
```

## §5 相关模板

- `faction/README.md` (本目录) — 规则管辖派系
- `character/README.md` (本目录) — 规则涉及角色
- `chapter/README.md` (本目录) — 规则出现章节
- `note/README.md` (本目录) — 规则草稿
- `world-engine/` (项目根) — 规则驱动的世界引擎
