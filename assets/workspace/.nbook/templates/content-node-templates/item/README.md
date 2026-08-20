# Item 模板说明

> 模板位置: `content-node-templates/item/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/item/` (V1 物品: `玉坠` / `金融牌照` / `支付通道密钥` / `旧手机`)

## §1 用途

物品卡模板，用于物品 / 道具建模。`index.md` 是基础卡（物品设定 + 流转史 + 现状），通常关联 `character`（持有者）和 `faction`（所有者）。

跟其他 entity 区别：

- `item` 与 `character` / `faction` 字段集同构
- `item` 经常被 `character/state.md` 的"持有物"段引用
- `item` 通常用 `ext.quantity` 表达数量

## §2 必填字段

- `title` (string) — 物品名（e.g. "玉坠"）
- `type` (enum, = "item") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`
- `summary` (string) — 一句话物品定位
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 物品细分（如 `jewelry` / `document` / `tool` / `digital-asset` / `key`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用持有者（`character`）和所有者（`faction`）
- `retrieval.trigger` (string[]?)
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展（e.g. `ext.quantity` 数量 / `ext.value` 估值 / `ext.acquired-at` 获得时间）

## §4 填表示例

```yaml
---
title: 玉坠
type: item
subtype: jewelry
status: active
aliases: [玉佩, 玉, 陆深送的玉坠, jade pendant]
tags:
  - 情感信物
  - 苏念持有
  - 关键剧情物
summary: "陆深 3 年前送给苏念的玉坠，分手后苏念一直保留。重逢时苏念佩戴，作为两人关系重启的标志物。"
refs:
  - ../character/su-nian/
  - ../character/lu-shen/
retrieval:
  enabled: true
  trigger: [玉坠, 玉, 玉佩, jade]
governance:
  source: creation-constitution
  review: approved
---

## 物品设定

- 类型: 翡翠玉坠 (A 货)
- 来源: 陆深 3 年前在云南腾冲购买
- 象征: 陆深对苏念的承诺

## 流转史

- 3 年前: 陆深 → 苏念（分手信物）
- 3 年间: 苏念保留在床头柜抽屉
- 现在: 苏念佩戴，作为关系重启信号

## 现状

- 持有者: 苏念
- 当前位置: 苏念颈部
- 关键节拍: Ch.045 中点苏念佩戴出现，Ch.067 玉坠碎裂（剧情高潮）
```

## §5 相关模板

- `character/README.md` (本目录) — 物品持有者
- `faction/README.md` (本目录) — 物品所有者
- `relationship/README.md` (本目录) — 物品作为关系象征
- `chapter/README.md` (本目录) — 物品出场章节
