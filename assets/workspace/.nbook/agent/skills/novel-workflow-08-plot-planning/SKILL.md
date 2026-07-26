---
name: novel-workflow-08-plot-planning
description: 剧情讨论、剧情事实确认与 World Engine 状态推进。用于和用户一起讨论当前剧情、推演局势、确认会成为 canon 的剧情事实，并把确认后的时间、地点、角色状态、认知变化和势力动向写入 World Engine 时间线。
when_to_use: 用户想讨论剧情、推演当前局势、设计某个阶段或当前片段的走向；用户讲述了一段剧情，需要提取状态变化写入 World Engine；进入正式章节写作前，需要先把本章剧情事实推进进 World Engine。
---

# novel-workflow-08-plot-planning：剧情规划与状态推进

本 skill 是写作模式下 World Engine 的主使用流程。它负责两件事：

1. 像创作伙伴一样陪用户讨论剧情、推演可能性、指出风险。
2. 在用户确认剧情事实后，把这些事实造成的世界状态变化写进 World Engine。

用户是主创。未确认的推演、候选、随机素材和角色代入都不是 canon，不能写进 World Engine。剧情事实一旦确认，World Engine 就是动态世界状态与时间线的唯一真相源。

> 边界：本流程不使用 Plot / director / simulator / emulation 维护写作模式世界状态。剧情确定后的状态变化只落 World Engine：使用单一 `execute_world` 工具；leader / world.engine 可在脚本内用 `world.slice.write`、`world.slice.editPatches`、`world.slice.delete` 写入、修正或清理切面，writer 只有 readonly 查询能力。

## 协作原则

- 先回应用户的想法，再提出分析。不要把剧情讨论变成任务报告。
- 用户没有明确范围时，先判断本轮是在自由探索、宏观设计、当前片段推进，还是准备落库。
- 用户确认前，只给候选、风险、推演和问题，不写 World Engine。
- 用户确认后，用人话复述将要成为 canon 的剧情事实，再写入 World Engine。
- 对用户透明处理技术细节。用户只需要听到“时间线新增了什么、当前状态是什么”，不需要看到 slice / patch / op / JSON。

## Phase 1：判断本轮意图

先判断用户这句话属于哪一类：

| 用户意图 | 处理方式 |
| --- | --- |
| 自由探索 | 只讨论灵感、主题、角色可能性，不查或写 World Engine，除非用户要求看现状。 |
| 宏观剧情设计 | 讨论阶段目标、主线冲突、角色关系和主题承诺；通常不急着写入。 |
| 当前片段推进 | 查询当前状态，用角色代入和 World Engine 状态推导帮助设计下一段。 |
| 已确认剧情事实 | 进入 Phase 4-7，把状态变化写入 World Engine。 |
| 准备写章节 | 先确认本章剧情事实已写入 World Engine，再进入 `novel-workflow-09-chapter-writing`。 |

核心规则：**未确认的推演不是 canon，不写入 World Engine。**

## Phase 2：读取当前世界状态

项目已经初始化 World Engine 时，先用 `execute_world` 查询相关对象，避免和已有时间线冲突。

优先查询：

- 当前时间线推进到哪，最近发生了什么。
- 相关角色的位置、状态、目标、已知信息和关键物品。
- 相关地点、势力、物品是否已有 subject。
- 目标时间附近是否已有 slice，避免同一时间点冲突。
- 查询返回的 E issues 是否需要先修。

只读查询示例：

```javascript
const heroes = await world.subject.gets(["weiluosi", "liya"]);
const recentSlices = await world.slice.list({limit: 10});
const factions = await world.subject.list("faction");
```

给用户的反馈用人话：

> 现在时间线停在复兴纪元488年5月10日清晨。薇洛丝在星陨遗迹，莉雅刚解封但失忆，邪教徒巡逻队还在遗迹外围。

如果项目还没初始化 World Engine，本轮只能讨论剧情；若用户要正式推进剧情或写章节，先转 `novel-workflow-world-engine-init`。

## Phase 3：LOD 粒度判断

写入前先判断叙事粒度。LOD 用于决定“要不要建 subject、切面写多细、哪些只做氛围”。

| LOD | 范围 | 记录方式 |
| --- | --- | --- |
| LOD0 当前场景 | 主角视角附近，正在发生的动作、对话、战斗、选择 | 细记。关键对话、战斗回合、位置/HP/认知变化可拆多条 slice。 |
| LOD1 区域动向 | 同一地点或附近区域，能影响当前场景的其他角色/势力 | 中等粒度。只记录会影响当前剧情的动向。 |
| LOD2 远处世界 | 远方势力、背景变化、伏笔和世界事件 | 粗记。通常一条摘要 slice，不展开细节个体。 |
| LOD3 氛围/群体 | 天气、路人、城镇氛围、普通巡逻、背景人群 | 一般不建 subject，只写进相关事件摘要或正文 brief。 |

提升为 subject 的条件：

- 有名字、会对话、会再次出现，或需要追踪独立状态。
- 会持有关键物品、掌握秘密、改变关系或影响后续剧情。
- 群体先用单一 subject，例如“邪教徒巡逻队”；群体中某个个体变重要时，再拆成独立 subject。
- 临时角色不建 subject，只在主角或地点的事件文本里提及。

切片粒度判断：

- 当前场景细，视角之外粗。
- 新发生的事件细，旧背景粗。
- 战斗、关键对话、关系转折细；赶路、休息、日常过渡粗。
- 只记录后续会读取、引用或依赖的事实，不记录每个细节动作。

## Phase 4：确认剧情事实

写入前必须把将要成为 canon 的内容用人话对齐。示例：

> 那这一段我理解为：薇洛丝进入遗迹深处，解除莉雅封印；莉雅失忆，只记得名字；邪教徒队长追入，认出项链，章末拔剑。这个版本确定记进时间线吗？

用户确认后再写。若用户只是说“可以先看看”“你推一下”，继续讨论，不写入。

## Phase 5：拆成 World Engine 事件

把确认后的剧情事实拆成状态变化：

- 时间：发生在项目日历里的哪一天、几点或哪个代表时刻。
- 地点：谁移动到了哪里；地点是否首次变重要。
- 角色状态：HP、心理、目标、处境、身份暴露、当前关系。
- 认知变化：谁知道了什么、误解了什么、仍不知道什么。
- 物品变化：获得、失去、装备、损坏、发现来历。
- 势力变化：部署、追捕、撤退、结盟、暴露意图。
- 回溯补设定：当前剧情需要某能力、知识、身份或物品来历时，向过去插一条 backstory slice。

## Phase 6：写入 World Engine

使用 `execute_world` 里的 `world.slice.write` 写入。一个 slice 对应一个有叙事意义的时间点，同一时间点发生的多 subject 变化可以放进同一个 slice。

写入规则：

- 时间一律用项目 `calendar.ts` 能 parse 的日历字符串；禁止 raw instant。
- 默认模板使用公历数字年月日，格式到分钟、不带秒；不要凭空发明月份名或添加 format 里没有的空格。
- 首次写入新 subject 时，在该 subject 任意 patch 上声明 `type`，可选 `name`。
- 同一 instant 只能有一个 slice；冲突时先查已有 sliceId 和 patchId，再用 `world.slice.editPatches` 合并或修正。只有整条切面作废时才用 `world.slice.delete`。
- 用 `increment` 记录数值增减，用 `append` 记录经历、知识、技能、集合新增，用 `replace` 记录绝对状态。
- 引用已有 subject 前先查询确认 id 与 type。

写入示例：

```javascript
const time = world.time.parse("公元2020年4月12日 18:30");
await world.slice.write({
    time,
    title: "薇洛丝解除莉雅的封印",
    patches: [
        {subjectId: "liya", type: "character", name: "莉雅", path: "/status", op: "replace", value: "被解封，部分失忆"},
        {subjectId: "liya", path: "/location", op: "replace", value: "subject://ruins-meteor"},
        {subjectId: "weiluosi", path: "/events", op: "append", value: {text: "在星陨遗迹深处解除了莉雅的封印"}}
    ]
});
```

## Phase 7：处理 issues

写入、删除或查询后检查 issues：

- `severity: "error"` 是持久数据错误，必须修。
- `severity: "advisory"` 是补过去时的提醒，确认语义即可。
- 向用户解释时使用返回的 `title`、`message`、`explanation`，不要把 code 直接抛给用户。

## Phase 8：回报当前状态

写完后只回报人读摘要：

- 新增了哪几段时间线。
- 当前角色、地点、势力或物品状态。
- 新增或更新了哪些 subject。
- 是否有未定问题。
- 是否可以进入 `novel-workflow-09-chapter-writing`。

不要贴 patch JSON，不复述工具入参。

## 分析方法

剧情讨论阶段可以使用这些方法，但它们都只是帮助用户确认剧情事实：

- 上帝视角分析：检查节奏、冲突、爽点、悬念、信息差、降智风险。
- 主角代入：只用主角知道的信息、处境、资源和误判推演行动。
- 多角色代入：代入反派、配角、旁观者或远处势力，检查他们的目标和误判。
- World Engine 状态推导：从已记录真值出发推演下一步谁会怎么动。
- 随机素材池：提供 8 到 12 个扰动素材，让用户决定是否采用。
- 旁白式代入：Agent 描述局势和压力，用户决定角色关键行动。

## 两种录入模式

- **先设计、再落库**：先讨论结构化剧情，用户确认后写 World Engine。适合阶段设计、开局设计、章节前准备。
- **先叙述、再补回**：用户直接讲一段剧情，从中提取时间、地点、事件和状态变化，补齐缺失信息后写入。适合当前片段推进。

两种模式都必须遵守：先确认剧情事实，再写入。

## 后续衔接

剧情已确认、状态变化已推进进 World Engine 后，进入 `novel-workflow-09-chapter-writing`。`08` 负责剧情事实与世界状态；`09` 负责把这些事实交给 writer 写成正文。进入 09 前，leader 应先过 09 的「写前确认清单」——确认目标章节路径、视角、开头状态、结尾落点、不可改设定和文风参考都已明确。

如果本轮只是宏观阶段设计、主线结构或长期走向，还没有具体到可写章节，就留在本流程继续讨论，不急着进入 `09`。

## 完成标准

- 已判断本轮意图：探索、宏观设计、当前片段推进、落库或写章节准备。
- 必要时已查询当前 World Engine 状态，并用人话反馈。
- 已用 LOD 判断记录粒度和 subject 边界。
- 只有用户确认过的剧情事实被写入 World Engine。
- 写入后的 issues 已按 E / A 分类处理。
- 已向用户回报时间线和当前状态摘要，并给出是否进入 `09` 的判断。
- 连续完成多章后，建议引导进入 `novel-workflow-11-analyze` 做阶段性质量检查。
