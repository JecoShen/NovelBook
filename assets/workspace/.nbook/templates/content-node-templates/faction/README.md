# Faction 模板说明

> 模板位置: `content-node-templates/faction/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/faction/` (V1 派系: `chaininnovate-fintech` / `hengrui-group` / `pig-butchering-empire` / `ruifeng-tech`)

## §1 用途

派系卡模板，用于组织 / 公司 / 团体建模。`index.md` 是基础卡（势力设定 + 资源与影响力 + 派系关系），`subtype` 默认 `null`（与 character 的 `person` / `group` 区分）。

跟其他 entity 区别：

- `faction` 与 `character` 字段集基本同构（共用 content-node 基础 schema）
- `faction` 通常作为 `relationship.subject-a` / `subject-b` 引用对象

## §2 必填字段

- `title` (string) — 派系名（e.g. "恒瑞集团"）
- `type` (enum, = "faction") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`
- `summary` (string) — 一句话势力定位
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 派系细分（如 `corporation` / `gangs` / `platform` / `institution`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用其他节点（特别是 `character/` 派系核心人物 + `faction/` 关联派系）
- `retrieval.trigger` (string[]?) — 触发词
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展（e.g. `ext.headquarters` 总部地址 / `ext.founded` 成立时间 / `ext.assets` 资产规模）

## §4 填表示例

```yaml
---
title: 恒瑞集团
type: faction
subtype: corporation
status: active
aliases: [恒瑞, 恒瑞金服, Hengrui Group]
tags:
  - 上市公司
  - 金融控股
  - 苏承业
summary: "国内大型金融控股集团，苏承业任董事长。旗下子公司含金融科技牌照 + 跨境支付通道。V1 主线核心派系。"
refs:
  - ../character/su-nian/
  - ../character/su-cheng-ye/
  - ../item/finance-license/
retrieval:
  enabled: true
  trigger: [恒瑞, 恒瑞集团, Hengrui, 苏承业]
governance:
  source: creation-constitution
  review: approved
---

## 势力设定

- 业务范围: 金融科技 + 跨境支付 + 区块链投资
- 实际控制人: 苏承业 (60% 股权)
- 上市状态: A 股主板

## 资源与影响力

- 金融牌照 5 张（覆盖支付 / 借贷 / 财富管理）
- 员工 3000+
- 跨境支付通道年流水 200 亿

## 内部派系

- 苏承业系 (60%)
- 鹏达系 (联合创始派，30%)
- 中立管理层 (10%)
```

## §5 相关模板

- `character/README.md` (本目录) — 派系核心人物
- `relationship/README.md` (本目录) — `character-faction` / `faction-faction` 关系
- `item/README.md` (本目录) — 派系持有物（金融牌照 / 资产）
- `location/README.md` (本目录) — 派系总部 / 营业地点
