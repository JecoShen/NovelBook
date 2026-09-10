---
title: "{{title}}"
type: relationship
subtype: character-character # character-character / character-faction / faction-faction
status: "{{status}}"
icon: null
aliases: []
tags: []
summary: ""
refs: []
retrieval:
  enabled: true
  trigger: null
governance:
  source: manual
  review: proposed
ext: {}
---

# {{title}} 关系卡

> 9th entity 模板，与 8 实体（chapter/character/faction/item/location/note/rule/volume）并列
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/character/relationship-network.md`（实际 `type: reference` 升级目标）
> 模板与 character/faction 字段集同构（0 字段新设计）

## §1 关系主体

- **主体 A**: `{{subject-a}}` (slug, 引用 character / faction)
- **主体 B**: `{{subject-b}}` (slug, 引用 character / faction)

**3 个 subtype**：

- `character-character` — 角色×角色（e.g. 陆深 × 苏念）
- `character-faction` — 角色×派系（e.g. 陆深 × 恒瑞集团）
- `faction-faction` — 派系×派系（e.g. 恒瑞集团 × 鹏达系）

## §2 关系类型

自定义（不强制 enum，严守调研报告 §7.4 抗过度 spec 化）：

- 血缘
- 婚姻
- 师徒
- 敌对
- 盟友
- 暧昧
- 商业合作
- 雇佣
- 背叛
- ... (其他自定义)

## §3 关系强度

- 1 (陌生人)
- 2 (点头之交)
- 3 (普通)
- 4 (亲近)
- 5 (核心)

## §4 关系演变史

按章节时间线记录关系变化（e.g. "Ch.012 苏念陆深 3 年前分手 → 关系降到 2"）。

按节拍位标注关键节点（e.g. "Ch.045 中点 → 关系升到 4"）。

```markdown
- Ch.001 陆深送外卖偶遇苏念 → 关系强度 3 (前任重逢, 试探)
- Ch.005 归集节点 → 关系强度 2 (苏念拒绝, 关系降温)
- Ch.010 188 号 → 关系强度 3 (陆深帮苏念, 升温)
- Ch.045 中点 (陆深决定加入苏念公司) → 关系强度 4 (亲近)
- Ch.067 玉坠碎裂 (苏念追陆深) → 关系强度 5 (核心)
```

## §5 当前快照

> 详见 `state.md`（动态状态：当前友好度 / 信任度 / 冲突点）

## §6 与其他 entity 关系

- **character**: `subject-a` / `subject-b` 引用 character 节点
- **faction**: `subject-a` / `subject-b` 引用 faction 节点
- **chapter**: 通过 `refs` 引用关键节点章节
- **item**: 关系象征物（e.g. 玉坠是陆深苏念关系的核心象征）
- **location**: 关系发生地（e.g. 群租房是陆深苏念关系重启地）

## §7 填表示例 (陆深 × 苏念 关系卡)

```yaml
---
title: 陆深-苏念 关系
type: relationship
subtype: character-character
status: active
aliases: [陆苏关系, 陆念, 主角关系, 男女主]
tags:
  - 主线关系
  - 情感核心
  - V1-V3 跨卷
summary: "《骑手翻身成顶富》男女主角 3 年分手 → 重逢试探 → 互相成就的复杂情感关系。"
refs:
  - ../character/lu-shen/
  - ../character/su-nian/
  - ../item/jade-pendant/
  - ../location/basement-room/
  - ../chapter/ch-001/
  - ../chapter/ch-045/
  - ../chapter/ch-067/
retrieval:
  enabled: true
  trigger: [陆苏关系, 男女主, 陆念, 主角关系, 陆深苏念]
governance:
  source: creation-constitution
  review: approved
ext: {}
---

# 陆深-苏念 关系卡

## 关系主体

- **主体 A**: `lu-shen` (陆深, 外卖骑手 → 金融科技入门)
- **主体 B**: `su-nian` (苏念, 恒瑞集团子公司 CEO)

## 关系类型

- 3 年前分手的前任
- 当前暧昧试探
- 商业伙伴（苏念邀请陆深做支付通道副业）

## 关系强度

- 当前: 4 (亲近, Ch.045 中点后)
- 峰值: 5 (Ch.067 玉坠碎裂时短暂达到)
- 谷值: 2 (Ch.005 归集节点, 苏念拒绝陆深)

## 关系演变史

- Ch.001 雨夜三个字 → 陆深送外卖偶遇苏念, 关系强度 3 (试探)
- Ch.005 归集节点 → 关系强度 2 (苏念拒绝陆深)
- Ch.010 188 号 → 关系强度 3 (升温)
- Ch.045 中点 → 关系强度 4 (陆深决定加入苏念公司)
- Ch.067 玉坠碎裂 → 关系强度 5 (短暂达到, 随即面对新冲突)
- Ch.080 V1 卷末 → 关系强度 4 (稳定, 但冲突未解)

## 当前快照

> 详见 `state.md`（友好度 7/10, 信任度 6/10, 冲突点: 陆深身份落差 + 苏承业婚姻锁定）
```
