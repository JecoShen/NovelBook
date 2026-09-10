# Note 模板说明

> 模板位置: `content-node-templates/note/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/note/` (V1 笔记: 创作设定 / 备忘 / 金融规则草稿)

## §1 用途

笔记卡模板，用于设定 / 备忘 / 草稿。`index.md` 是基础卡，比 character/faction/item 简化（**没有 `state.md`**，因为笔记本身是单一文档）。

跟其他 entity 区别：

- `note` 是**最简化**的 entity（无 `state.md` / 无特殊字段）
- `note` 是 `character` / `faction` / `item` / `location` 的**草稿态**（status = draft 时可考虑转正为对应 entity）

## §2 必填字段

- `title` (string) — 笔记标题（e.g. "玉碎伏笔设计"）
- `type` (enum, = "note") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`（`draft` 为主）
- `summary` (string) — 一句话笔记要点
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 笔记细分（如 `setting` / `memo` / `outline` / `research`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用相关节点
- `retrieval.trigger` (string[]?)
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展

## §4 填表示例

```yaml
---
title: 玉碎伏笔设计
type: note
subtype: setting
status: draft
tags:
  - 伏笔
  - Ch.067
  - 玉坠
summary: "Ch.067 玉坠碎裂的伏笔设计，3 处铺垫位 + 1 处反转位。"
refs:
  - ../character/su-nian/
  - ../item/jade-pendant/
  - ../character/lu-shen/
retrieval:
  enabled: true
governance:
  source: manual
  review: proposed
---

## 笔记

### 伏笔位 1: Ch.005 陆深递玉坠时"轻拿轻放"

- 暗示玉的脆性

### 伏笔位 2: Ch.022 苏念戴玉坠跑动

- 暗示玉坠不稳

### 伏笔位 3: Ch.040 玉坠与桌角擦碰

- 制造"差点碎"的紧张

### 反转位: Ch.067 玉坠正式碎裂

- 苏念追陆深时玉坠挂链断裂
- 玉碎 + 心碎双关
```

## §5 相关模板

- `character/README.md` (本目录) — 笔记涉及角色
- `item/README.md` (本目录) — 笔记涉及物品
- `chapter/README.md` (本目录) — 笔记涉及章节
- `rule/README.md` (本目录) — 笔记涉及规则
