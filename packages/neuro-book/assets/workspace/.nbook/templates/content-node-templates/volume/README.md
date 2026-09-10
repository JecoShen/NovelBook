# Volume 模板说明

> 模板位置: `content-node-templates/volume/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/volume/` (V1: `第1卷-坠落` / V2: `第2卷-暗潮` / ... V10)

## §1 用途

卷卡模板，用于整卷元数据建模。`index.md` 是基础卡（卷名 / 章数范围 / 节拍覆盖 / 主线冲突 / 修订记录），body 段是分卷摘要 + 卷级剧情。

跟其他 entity 区别：

- `volume` 是**最高层**的 metadata entity
- `volume` 的 `chapter_range` 字段定义章号起止
- `volume` 的 `beat_coverage` 字段标 Save the Cat 15 节拍在本卷的覆盖（与 chapter 的 `beat` 字段交叉验证）

## §2 必填字段

- `title` (string) — 卷名（e.g. "第1卷-坠落"）
- `type` (enum, = "volume") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`
- `summary` (string) — 一句话卷主线
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 卷细分（如 `arc-1` / `standalone` / `epilogue`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用本卷核心角色 / 派系 / 地点
- `retrieval.trigger` (string[]?)
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展（e.g. `ext.chapter_range: "001-030"` 章号起止 / `ext.beat_coverage` 节拍覆盖 / `ext.word_count` 字数 / `ext.published_at` 出版时间）

## §4 填表示例

```yaml
---
title: 第1卷-坠落
type: volume
subtype: arc-1
status: active
aliases: [V1, 第一卷, 坠落, The Fall]
tags:
  - 陆深崛起篇
  - 30 章
  - V1
summary: "骑手陆深雨夜偶遇前女友苏念，从外卖骑手到接触金融科技副业的开篇 30 章。"
refs:
  - ../character/lu-shen/
  - ../character/su-nian/
  - ../character/peng-da/
retrieval:
  enabled: true
  trigger: [V1, 第1卷, 坠落, 陆深崛起篇]
governance:
  source: creation-constitution
  review: approved
---

## 分卷摘要

陆深（外卖骑手）在雨夜送外卖时偶遇前女友苏念（科技金融公司 CEO），重逢激化两人过去 3 年分手的悬而未决。苏念邀请陆深参与公司支付通道副业，陆深从"骑手身份落差"挣扎到"金融科技入门"，卷末陆深做出加入苏念公司的决定。

## Save the Cat 节拍覆盖 (V1)

- Opening Image (Ch.001 雨夜三个字)
- Theme Stated (Ch.003 父亲电话)
- Set-Up (Ch.001-009 骑手日常)
- Catalyst (Ch.005 归集节点)
- Debate (Ch.007-009 挣扎)
- Break Into Two (Ch.010 188号)
- B Story (Ch.015 四个字)
- Fun and Games (Ch.018-024 副业探路)
- Midpoint (Ch.040 中点)
- ... (后续节拍 Ch.045-080 在 V2-V3 覆盖)

## 修订记录

- v4.5 (2026-08-15): 整批 cp O-1 重做
- v4.5.1 (2026-08-16): 双轴扫描 20 项修复
- v4.5.2 (2026-08-17): deferred 清零
- v4.5.3 (2026-08-19): 女性角色外观形象补全
```

## §5 相关模板

- `chapter/README.md` (本目录) — 本卷章节节点
- `character/README.md` (本目录) — 本卷核心角色
- `faction/README.md` (本目录) — 本卷核心派系
- `location/README.md` (本目录) — 本卷核心地点
- `relationship/README.md` (本目录) — 本卷关系网络
- `reference/scene-master-list.md` (P2-5) — 本卷 scene-master-list 表
