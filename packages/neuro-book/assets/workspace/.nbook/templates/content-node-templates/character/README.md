# Character 模板说明

> 模板位置: `content-node-templates/character/index.md` + `state.md` + 可选 `soul.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/character/su-nian/` (V1 女主角)

## §1 用途

角色卡模板，用于人物建模。`index.md` 是基础卡（一句话定位 + 关系网），`state.md` 是动态状态（当前持有物 / 目标），`soul.md` 是项目专属的灵魂层（本项目 V1 实际有，模板建议性）。

跟其他 entity 区别：

- `character` 是**唯一有 `subtype: person/group/archetype`** 的
- `character` 的 `retrieval.trigger` 是 P1-3 lore-resolver 注入匹配词
- `character` 经常与 `state.md` 配对使用

## §2 必填字段

- `title` (string) — 角色名 (e.g. "苏念")
- `type` (enum, = "character") — 节点类型，必填
- `subtype` (enum) — `person` / `group` / `archetype`
- `status` (enum) — `draft` / `pending` / `active` / `archived`
- `summary` (string) — 一句话定位
- `retrieval.enabled` (bool, default true) — 是否允许 AI 自动检索
- `retrieval.trigger` (string[]) — 触发词（用于 P1-3 lore-resolver 注入），e.g. `[苏念, 女主, su-nian]`

## §3 可选字段

- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用其他节点
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展

## §4 填表示例 (苏念 / V1 女主角)

**`index.md` 简化版**：

```yaml
---
title: 苏念
type: character
subtype: person
status: active
aliases: [女主, 苏念, Su Nian, 苏总]
tags:
  - 女主
  - CEO
  - 金融科技
  - 前女友
summary: "《骑手翻身成顶富》女主——科技金融公司CEO，陆深前女友。理性果决，独立有事业心。与陆深重逢后的关系是互相成就，不是单向拯救。"
refs:
  - ../instruction/creation-constitution/
  - ./lu-shen/
retrieval:
  enabled: true
  trigger: [苏念, 女主, su-nian, 前女友, CEO]
governance:
  source: creation-constitution
  review: approved
---
```

**`state.md` 示例**（当前状态）：

```yaml
---
statusNote: ""
updatedAt: 2026-08-15
knowledge: []
ext: {}
---

## 当前状态

- 公司: 恒瑞集团子公司
- 情感: 与陆深重逢，互相试探
- 危机: 父亲苏承业 60% 持股，婚姻被安排

## 持有物

- 苏承业家股权 60%
- 陆深 3 年前信物（玉坠）
- 金融牌照

## 当前目标

- 摆脱父亲控制，独立做 CEO
- 重新评估与陆深关系（不重蹈 3 年前覆辙）

## 风险与限制

- 婚姻被父亲锁定
- 恒瑞集团内部派系斗争
- 陆深当前身份落差（骑手 vs CEO）
```

## §5 相关模板

- `relationship/README.md` (本目录) — 角色×角色关系
- `faction/README.md` (本目录) — 角色所属派系
- `chapter/README.md` (本目录) — 角色登场的章节
- `item/README.md` (本目录) — 角色持有物
- `location/README.md` (本目录) — 角色常出没地点
