# Chapter 模板说明

> 模板位置: `content-node-templates/chapter/index.md` (+ `index.md` body)
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/manuscript/<vol>/<ch>/index.md` (V1+V2 80 章)

## §1 用途

章节节点模板，用于写作期新建章节。frontmatter 提供元数据（章号 / 卷号 / 节拍 / POV），body 是正文（`manuscript/<vol>/<ch>/index.md`）。

跟其他 entity 区别：

- `chapter` 是**唯一有 body 正文**的 entity（其他是卡式 metadata）
- `chapter` 是**有 frontmatter 强必填字段**的（`chapter` / `volume`，防孤儿指针）

## §2 必填字段

从现有 `chapter/index.md` frontmatter 提取（`{{ }}` 是模板占位符，新章实际写时替换）：

- `title` (string) — 章节名 (e.g. "雨夜")
- `type` (enum, = "chapter") — 节点类型，必填
- `status` (enum) — 状态: `draft` / `pending` / `active` / `archived`
- `chapter` (string) — 章号（e.g. `ch-001`），**必填**（防孤儿指针核心）
- `volume` (string) — 卷号（e.g. `第1卷-坠落`），**必填**

## §3 可选字段

- `subtype` (string?) — 子类型，chapter 通常为 `null`
- `icon` (string?) — Lucide 图标名
- `beat` (enum) — Save the Cat 15 节拍（`opening-image` / `theme-stated` / `set-up` / `catalyst` / `debate` / `break-into-two` / `b-story` / `fun-and-games` / `midpoint` / `bad-guys-close-in` / `all-is-lost` / `dark-night` / `break-into-three` / `finale` / `final-image`），i128 80/80 命中
- `pov` (string) — POV 角色 slug（e.g. `lu-shen`），联动 P1-3 lore-resolver
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `summary` (string) — 一句话总结
- `refs` (string[]) — 引用其他节点路径
- `retrieval.enabled` (bool, default true) — 是否允许 AI 自动检索
- `retrieval.trigger` (string[]?) — 触发词
- `governance.source` (enum, default "manual") — manual / imported / generated
- `governance.review` (enum, default "proposed") — proposed / reviewed / approved
- `ext` (object?) — 自由扩展

## §4 填表示例

V1 ch-001 简化版（实际 frontmatter 只含 chapter + beat，title 走目录名 fallback）：

```yaml
---
title: "三个字"
type: chapter
status: active
chapter: "ch-001"
volume: "第1卷-坠落"
beat: opening-image
pov: lu-shen
tags: [开篇, 雨夜, 城市边缘]
summary: "陆深送外卖雨夜, 偶遇苏念, 关系重启的引子"
refs:
  - ../../lorebook/character/lu-shen/
  - ../../lorebook/character/su-nian/
retrieval:
  enabled: true
governance:
  source: manual
  review: reviewed
---
```

**实际 V1 80 章 frontmatter 简化版**（仅 chapter + beat）：

```yaml
---
chapter: ch-001
beat: opening-image
---
```

调研报告 §7.4 抗过度 spec 化：V1+V2 baseline 不强制填完整 frontmatter，scan 脚本（`scripts/scan-scene-master-list.cjs`）做 fallback（title 走目录名，pov 留空）。

## §5 相关模板

- `reference/scene-six-questions.md` (P1-4) — 场景 6 问软提示
- `reference/scene-master-list.md` (P2-5) — 全章 scene-master-list 表
- `volume/README.md` (本目录) — 卷级元数据
- `relationship/README.md` (本目录) — 跨章角色关系
- `character/README.md` (本目录) — POV 角色卡
