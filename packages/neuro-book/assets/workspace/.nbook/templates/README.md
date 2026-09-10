# NeuroBook Story Bible SDD 模板集

> 版本: 2026-08-20 (P2-6 落地)
> 来源: 调研报告 `research-sdd-novel-writing-2026-08-18.md` §6 P2-6 + §7.5 三大优势
> License: AGPL-3.0 (沿用项目根)

## §1 概述

NeuroBook 平台提供 2 套**互补模板**，供其他小说项目复用：

- **`content-node-templates/`** (8 entity 模板 + 1 cross-entity 关系模板) — 单个内容节点的 frontmatter schema (`chapter` / `character` / `faction` / `item` / `location` / `note` / `rule` / `volume` / `relationship`)
- **`project-directory-templates/`** (项目骨架) — 整个项目目录结构（`.agent/` / `agents/` / `lorebook/` / `manual/` / `manuscript/` / `reference/` / `upload/` / `world-engine/` + `AGENTS.md`）

调研报告 §7.5 评估本项目 NeuroBook **行业天花板** 的 3 个独有资产之一就是这套模板化能力。模板的"字段集"是从现有 `index.md` frontmatter 真实数据提取（**0 字段新设计**），**关系模板**作为 9th entity 与 8 实体并列。

## §2 快速使用

```bash
# 复制 content-node-templates 到新项目 lorebook/
cp -r assets/workspace/.nbook/templates/content-node-templates/* /path/to/new-project/lorebook/

# 复制 project-directory-templates 到新项目根
cp -r assets/workspace/.nbook/templates/project-directory-templates/* /path/to/new-project/

# 复制模板的统一入口 README 到新项目 lorebook 根 (可选)
cp assets/workspace/.nbook/templates/README.md /path/to/new-project/lorebook/README.md
```

**不提供 install.sh**（调研报告 P2-6 是"低 ROI 1 月+"，写 install.sh 跨度过大；按调研报告 §7.4 抗过度 spec 化原则）。cp 命令足够手动复用。

## §3 content-node 8 entity 简介

8 个内容节点类型 (P2-6 新增 `relationship` 作为 9th entity)：

| entity | 用途 | 字段集 | 实例 |
|---|---|---|---|
| `chapter` | 章节节点 (frontmatter + index.md body) | `title` / `type` / `status` / `chapter` / `volume` / `beat` (i128 Save the Cat 15 节拍) / `pov` (P1-3 lore) / `aliases` / `tags` / `summary` / `refs` / `retrieval` / `governance` | V1+V2 80 章 (e.g. `第1卷-坠落/001-三个字/`) |
| `character` | 角色卡 (含 soul.md 灵魂 / state.md 状态) | `title` / `type` / `subtype` (person/group/archetype) / `status` / `aliases` / `tags` / `summary` / `refs` / `retrieval.trigger` (lore-resolver 触发词) / `governance` | V1 苏念 (`lorebook/character/su-nian/`) |
| `faction` | 派系卡 (组织 / 公司 / 团体) | 同 character | `chaininnovate-fintech` / `hengrui-group` / `pig-butchering-empire` / `ruifeng-tech` |
| `item` | 物品卡 (物品 / 道具) | 同 character + `ext.quantity` (数量) | `玉坠` (苏念的陆深 3 年前信物) |
| `location` | 地点卡 (城市 / 建筑 / 场景) | 同 character | `深圳科技园` / `古村北路` / `东海市金融工作办公室` |
| `note` | 笔记卡 (设定 / 备忘) | 简化版（无 `state.md`） | 项目实例见 `lorebook/note/` |
| `rule` | 规则卡 (世界规则 / 物理 / 金融制度) | 简化版 | 区块链支付通道规则 |
| `volume` | 卷卡 (整卷元数据) | 简化版 + `chapter_range` (起止章号) | `第1卷-坠落` (Ch.001-030) |
| **`relationship`** (P2-6 新) | **关系卡** (角色×角色 / 角色×派系 / 派系×派系) | 同 character + `state.md` (友好度 / 信任度 / 冲突点) | `relationship-network.md` + `relationship-overview.md` |

**详细字段说明**见各 entity 子目录的 `README.md` (P2-6 落位)。**9th entity** `relationship` 的 cross-entity 关系建模模板见 `content-node-templates/relationship/index.md` + `state.md`。

## §4 project-directory 骨架简介

| 目录 | 角色 |
|---|---|
| `.agent/plan/` | 计划与档案 (gitignored, 仅本地) |
| `agents/<profile>/` | Agent profile 入口 (context.md + memory.md) |
| `lorebook/` | 内容节点 (用 `content-node-templates` 填) |
| `manual/` | 项目用户手册 |
| `manuscript/` | 正文 (章节 frontmatter + index.md) |
| `reference/` | 参考资料 (`story-spec` / `scene-six-questions` / `scene-master-list` 等) |
| `upload/` | 上传文件 |
| `world-engine/` | 世界引擎 (时间线 / 日历 / 事件溯源) |

`AGENTS.md` 是项目级 Agent 入口, 所有 profile 先遵守本文件（沿用 P1-3 / P1-4 落地模式）。

## §5 relationship 模板简介

P2-6 新增 cross-entity 关系建模（**9th entity**），对应项目实例：

- `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/character/relationship-network.md` — 关系网全景（角色×角色 / 角色×派系）
- `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/character/relationship-overview.md` — 关系速览

模板位置：`content-node-templates/relationship/index.md` + `state.md`

- `index.md` — 关系卡（**主体 A × 主体 B** + 关系类型 + 关系强度 1-5 + 关系演变史 + 当前快照指针）
- `state.md` — 关系当前状态（**友好度 0-10** / **信任度 0-10** / 冲突点 / 关键节拍 / 关系网络位置）

**3 个 subtype**（与 character 的 `subtype: person/group/archetype` 对应）：

- `character-character` (e.g. 陆深 × 苏念)
- `character-faction` (e.g. 陆深 × 恒瑞集团)
- `faction-faction` (e.g. 恒瑞集团 × 鹏达系)

## §6 字段约定

跨 entity 共用字段（从现有 frontmatter 提取，**0 字段新设计**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | enum | 节点类型, 必填 (`chapter` / `character` / `faction` / `item` / `location` / `note` / `rule` / `volume` / `relationship`) |
| `subtype` | string? | 子类型（如 `character: person` / `group` / `archetype`；`relationship: character-character` / `character-faction` / `faction-faction`） |
| `status` | enum | 状态: `draft` / `pending` / `active` / `archived` |
| `aliases` | string[] | 别名列表（用于 P1-3 lore-resolver 触发匹配） |
| `tags` | string[] | 中文短标签（有明确分类意义、易理解、可复用） |
| `summary` | string | 一句话总结（必填） |
| `refs` | string[] | 结构化引用列表（Markdown 相对路径） |
| `retrieval.enabled` | bool (default true) | 是否允许 AI 自动检索 |
| `retrieval.trigger` | string[]? | 自然语言触发条件（lore-resolver 注入匹配词） |
| `governance.source` | enum | 内容来源: `manual` / `imported` / `generated` |
| `governance.review` | enum | 审阅状态: `proposed` / `reviewed` / `approved` |
| `ext` | object? | 自由扩展对象（系统不校验） |

**`chapter` 特有字段**：

- `chapter` (string) — 章号 (`ch-001`)，必填（防孤儿指针）
- `volume` (string) — 卷号 (`第1卷-坠落`)，必填
- `beat` (enum) — Save the Cat 15 节拍（`opening-image` / `theme-stated` / `set-up` / `catalyst` / `debate` / `break-into-two` / `b-story` / `fun-and-games` / `midpoint` / `bad-guys-close-in` / `all-is-lost` / `dark-night` / `break-into-three` / `finale` / `final-image`），i128 80/80 命中

**`character` / `faction` / `item` / `location` 共有字段**：

- `subtype` (enum) — person / group / archetype（character 限定）

**`relationship` 特有字段**：

- `subject-a` / `subject-b` (slug) — 关系主体 A / B 的 slug（引用 character / faction）
- `relationship.type` (string) — 血缘 / 婚姻 / 师徒 / 敌对 / 盟友 / 暧昧 / 商业合作 / 雇佣 / 背叛 / 自定义
- `relationship.strength` (int 1-5) — 1 (陌生人) / 2 (点头之交) / 3 (普通) / 4 (亲近) / 5 (核心)

**严守调研报告 §7.4**：字段是**建议**而非**强制**。`aliases` / `tags` / `summary` / `refs` 可空（项目实例灵活），不写 linter 强校验。

## §7 License

AGPL-3.0-only，沿用项目根 [LICENSE](../../../../../LICENSE)。模板可自由复用，修改后源码必须公开（per AGPL 传染性条款）。

---

**维护说明**：

- 8 entity 子目录的 `README.md` (P2-6 落位) 提供每 entity 的字段说明 + 1 个 V1 实际填示例
- `relationship/index.md` + `state.md` 提供 cross-entity 9th entity 模板
- 模板字段集与现有 `index.md` frontmatter **同构**（0 字段新设计）
- 不写 install.sh（cp 命令即可复用）
- 不写 linter（模板是建议不是强制，严守 §7.4）
