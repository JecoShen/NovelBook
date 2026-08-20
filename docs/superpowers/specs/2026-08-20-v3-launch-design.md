# V3 启动准备 — 设计文档

> 日期: 2026-08-20
> 状态: design 阶段 (5 个核心决策已拍板,Stage 1 待开工)
> 项目: 《骑手翻身成顶富》第三卷(Volume 3, V3)写作期启动
> 位置: `workspace/qi-shou-fan-shen-cheng-ding-fu/`(与 V1V2 同一项目根)

## §0 背景与定位

V1 (30 章, 第1卷-坠落) + V2 (50 章, 第2卷-暗潮) 共 80 章已完成,5 批次 audit 闭环 (2026-08-20),SDD 调研报告 6/6 全部落位,工具护栏已就位 (scene-master-list / content-node templates / scene-six-questions / lore-resolver / beat / chapter-hook detector)。

PROJECT-STATUS L72 明确: "V3+ 写作期使用 scene-master-list + content-node templates 工具护栏"。

V3-V10 在 V1V2 收口时被清掉(叙事收敛),但 V3 工具准备是 8/20 完成的。本设计为 V3 启动做: 工具就位 + 业务规划同步 + 大纲落位, **不开笔**。

## §1 范围与边界

### §1.1 5 个核心决策(已拍板)

| 决策点 | 选型 |
|---|---|
| V3 范围 | 工具就位 + 业务规划同步 |
| 主角接力 | 沿用陆深(lu-shen) + 苏念(su-nian), V3 收官卷 |
| V3 长度 | 紧凑收官卷 20-25 章 |
| 完成判据 | 只到大纲落位, 不开笔(止于 ch-081 前) |
| 工作方案 | 阶段化 4 阶段交付 |

### §1.2 抗过度 spec 化(沿用 V1V2 + 调研报告 §7.4)

- ❌ 不强制 5 诫命子段 / 价值转换方向 / 钩子枚举 / 跨章场景连续性
- ❌ 不动 4 protected assets(`writer.profile.tsx` / `neuro-agent-harness.ts` / `server/agent/lore/*` / llmlint)
- ❌ 不开笔(只到大纲)
- ✅ 工具是建议非强制(模板字段可空、llmlint 软提示不阻塞)

## §2 4 阶段分解

### §2.1 Stage 1: 工具就位(预计 1-2 session)

**输入**: P2-5/P2-6 落地产物(已存在)
**动作**:
1. 铺 `content-node-templates/volume/` 到 `workspace/.../lorebook/volume/第3卷-{卷名}/`
2. 创建 V3 volume.md(`type: volume` + `chapter_range: ch-081 ~ ch-105` 范围)
3. 在 `reference/scene-master-list.md` 加 V3 20-25 行占位
4. 跑 `scripts/scan-scene-master-list.cjs` 验证 baseline

**产出**: V3 volume 模板就位 + scene-master-list 80+20-25=100-105 行
**验收**: scan 跑通 / 模板 cp 完整 / llmlint 0 errors

### §2.2 Stage 2: V3 业务规划(预计 1-2 session)

**输入**: V2 末章 ch-080 "松动" 收尾状态 + character 模板 17 个
**动作**:
1. 卷名(1 行, user 拍板)
2. Save the Cat 15 节拍序列分配到 20-25 章(节拍表)
3. 主角弧线(陆深/苏念从 V2 末"松动" → V3 终状态)
4. 主题陈述(1-2 句, 3 卷统一主题/还是 V3 子主题)
5. Story Grid 5 诫命映射
6. 暧昧线处理(顾霁已 N6 退出, V3 是否回收)

**产出**: `workspace/.../story-spec/v3-plan.md`
**验收**: user review 拍板 5 段内容(卷名/起点/节拍表/弧线/主题)

### §2.3 Stage 3: V3 大纲落位(预计 1 session)

**输入**: Stage 2 业务规划 + 现成 character 模板
**动作**:
1. volume.md 落位(卷名/chapter_range/beat_sequence/arc/主题 5 段)
2. scene-master-list V3 行 8 列填全(前 6 列自动抽 + 后 2 列手工填)
3. character 模板更新(陆深/苏念新增 V3 状态字段, 可选: he-ruimin/lin-yue 升 B 线)
4. relationship 模板更新(关键关系 V3 演变)

**产出**: V3 大纲全量落位
**验收**: llmlint baseline 0 errors / scene-master-list 8 列命中率报告 / spec sync

### §2.4 Stage 4: 验收(预计 0.5 session)

**输入**: Stage 1-3 产出
**动作**:
1. llmlint 全量跑(beat 硬约束 100% / chapter-hook 0 issues / scene-six-questions soft 触发)
2. spec/plan 与实际产出 sync
3. V3 启动准备 4 stage 收口报告

**产出**: `workspace/.../docs/tasks/<task-id>/README.md` + 收口 commit
**验收**: user 拍板"大纲 OK, ch-081 后再说"

### §2.5 工作流约束

- 每个 stage 独立可停/回滚(中间产物 archive, 不动 main)
- Stage 1-3 不动 main, Stage 4 才合并
- 沿用 V1V2 archive 模式(worktree + cp + 0 push)

## §3 模板与数据流

### §3.1 模板 cp 路径

```
源 (assets/workspace/.nbook/templates/content-node-templates/volume/)
  ↓ cp (V3 启动准备一次性, 无 install.sh)
目标 (workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/volume/第3卷-{卷名}/
  ├── index.md       (V3 volume card, 5 段)
  ├── state.md       (V3 状态, 主题/弧线指针)
  ├── beats.md       (V3 Save the Cat 15 节拍序列)
  └── chapters/      (V3 ch-081~ch-105 占位, 先空)
```

V1V2 已铺的 character/faction/location/item/note/rule 不动(Stage 3 仅更新陆深/苏念 state.md)。`relationship` 9th entity 模板已 cp(Stage 3 视 V3 剧情决定新建哪些 relationship 卡)。

### §3.2 scene-master-list V3 行加入流程

```
scripts/scan-scene-master-list.cjs
  ↓ 读 manuscript/第1卷-坠落/ + 第2卷-暗潮/ + 第3卷-{卷名}/
  ↓ 自动抽 6 列 (vol/chapter/title/beat/pov/scene)
  ↓ 输出 reference/scene-master-list.md (80+N 行, N=20~25)
```

V3 行格式与 V1V2 同构, 沿用 P2-5 8 列 schema:
- `vol`: 第3卷-{卷名}(自动)
- `chapter`: ch-081 ~ ch-105(自动, V3 阶段目录可能只建占位, frontmatter 留空)
- `title`: 目录名 fallback(Stage 2/3 落位)
- `beat`: V3 节拍序列(Stage 2 落位)
- `pov`: V3 阶段留空(无 frontmatter `pov:`, V1V2 baseline 0/80 一致)
- `scene`: 0(未写, V1V2 baseline 0/80 一致)
- `value_shift`: 手工(Stage 3 视情况填, V1V2 baseline 0/80 留空)
- `hook_type`: 手工(Stage 3 视情况填, V1V2 baseline 0/80 留空)

### §3.3 scene-six-questions soft prompt 触发

P1-4 ruleset `cn.structure.scene-six-questions` level=low:
- 触发条件: 章节内有 `## 场景` H2 段头 → 软提示 6 问填写
- V3 阶段所有章节都没写, scene 数 = 0 → 软提示不会触发(预期)
- Stage 4 验收只确认"模板就位 + baseline 报告 0/N 符合预期", 不开 ch-081

### §3.4 llmlint baseline 链

| 阶段 | llmlint 规则 | 预期 |
|---|---|---|
| Stage 1 | i128 beat 硬约束 | V3 占位章节有 frontmatter `beat: opening-image` 之类 → 100% 命中 |
| Stage 4 | i129 chapter-hook 5 模式 | V3 占位章节无 index.md body → 0 issues(预期) |
| Stage 4 | P1-4 scene-six-questions soft | V3 占位章节无 `## 场景` 段 → 0% 触发(预期) |

**抗过度 spec 化**: `value_shift` / `hook_type` 留空不报错, `pov` 留空不报错(沿用 V1V2 baseline 0/80 行为)。

## §4 业务规划结构

**产物**: `workspace/qi-shou-fan-shen-cheng-ding-fu/story-spec/v3-plan.md`(Stage 2 落位, Stage 3 验证)

### §4.1 卷名 + 副标题(1 行)
- 主标题(沿用 V1V2 "第N卷-XXX" 命名风格, V1=坠落, V2=暗潮)
- 副标题(可选, 1 句)

### §4.2 起点状态(从 V2 末章"松动"继承)
- 陆深状态(复仇进度 / 骑手身份 / 金融能力 / 情感线)
- 苏念状态(ChainInnovate 估值 / 与陆深关系 / 立场)
- 派系格局(鹏达系 / 恒瑞 / 杀猪盘帝国 / 深圳科技园)
- 暧昧线回收(顾霁 N6 已退出, V3 是否回收 / 留白)

### §4.3 Save the Cat 15 节拍 → 章号映射(核心表)

15 节拍 × 平均 1.5-2 章 = 20-25 章:

| # | 节拍 | V3 章号 | 字数预估 | 备注 |
|---|---|---|---|---|
| 1 | opening-image | ch-081 | 3500 | V3 卷开篇图, V2 末"松动"接续 |
| 2 | theme-stated | ch-082 | 3500 | 主题陈述(1-2 句)显式落位 |
| 3 | set-up | ch-083 | 3500 | V3 主线前置 |
| 4 | catalyst | ch-084 | 3500 | V3 触发事件 |
| 5 | debate | ch-085 | 3500 | 主角犹豫/辩论 |
| 6 | break-into-two | ch-086 | 3500 | 主角决定 |
| 7 | b-story | ch-087~ch-088 | 7000 | V3 副线(2 章) |
| 8 | fun-and-games | ch-089~ch-092 | 14000 | V3 主线展开(4 章) |
| 9 | midpoint | ch-093 | 3500 | V3 中点反转 |
| 10 | bad-guys-close-in | ch-094~ch-097 | 14000 | 反派逼近(4 章) |
| 11 | all-is-lost | ch-098 | 3500 | 主角最低点 |
| 12 | dark-night | ch-099 | 3500 | 黑暗之夜 |
| 13 | break-into-three | ch-100 | 3500 | 主角顿悟 |
| 14 | finale | ch-101~ch-104 | 14000 | V3 高潮(4 章) |
| 15 | final-image | ch-105 | 3500 | V3 卷末图 |

**总章数**: 25 章(20-25 上限, Save the Cat 15 节拍 × 1.5-2 章 配比)
**总字数**: 约 90,000 字(每章 3500)

### §4.4 主角弧线(陆深 / 苏念)
- 陆深: 起点(复仇余烬 + 骑手身份) → 终点(???, V3 收官完成)
- 苏念: 起点(CEO 稳健 + 与陆深未完成) → 终点(???, 互相成就落定)
- 关键节拍: midpoint / all-is-lost / break-into-three / finale 4 个节拍上的状态翻转

### §4.5 主题陈述 + Story Grid 5 诫命映射

**主题**: 1-2 句(从 V1V2 主题延伸, V3 子主题)
**5 诫命映射**(沿用 P1-4 6 问 → 5 诫命):
- Inciting Incident → catalyst (ch-084) + midpoint 新信息 (ch-093)
- Progressive Complication → value_shift (ch-085~089) + 新情感 (ch-087~092)
- Crisis → 下一步必做 (ch-098)
- Climax → 主角选择 (ch-101~104)
- Resolution → value_shift 终态 (ch-105)

**严守抗过度 spec 化**:
- 5 诫命不强制写子段(只在大脑规划, 不进 chapter frontmatter)
- value_shift 不强制(留 V3 写作期填)
- hook_type 不强制(同上)

## §5 验收与不变量

### §5.1 Stage 验收清单

| Stage | 验收命令 | 通过条件 |
|---|---|---|
| Stage 1 工具就位 | `node scripts/scan-scene-master-list.cjs workspace/.../manuscript workspace/.../.agent/plan/v3-stage1-baseline.md` | 80+V3 占位行 = 100+ 行, V3 行 frontmatter 缺留空不报错 |
| Stage 2 业务规划 | user review `story-spec/v3-plan.md` | user 拍板 5 段内容(卷名/起点/节拍表/弧线/主题) |
| Stage 3 大纲落位 | llmlint pass + scene-master-list 8 列命中率 | i128 beat 100% 命中 / i129 0 issues / scene 0/N 符合预期 / value_shift 0/N 留空不报错 |
| Stage 4 收口 | user 拍板"大纲 OK, ch-081 后再说" + 收口 commit | commit + 文档落地 + memory 更新 |

### §5.2 不变量(硬约束, 所有 Stage 遵守)

- ✅ **不动**: `writer.profile.tsx` / `neuro-agent-harness.ts` / `server/agent/lore/*` / llmlint rulesets(4 protected assets)
- ✅ **不动**: `assets/workspace/.nbook/agent/skills/llmlint/`(sibling snapshot, llmlint 仓改, 主仓不动)
- ✅ **不动**: `reference/scene-six-questions.md`(P1-4 产物, V3 沿用)
- ✅ **不动**: `scripts/scan-scene-master-list.cjs`(P2-5 产物, 直接复用)
- ✅ **不动**: `assets/workspace/.nbook/templates/content-node-templates/`(P2-6 产物, 只 cp 不改)

### §5.3 软约束(可改但需记录)

- ⚠️ V3 volume 命名(user 拍板)
- ⚠️ V3 chapter_range(20-25 章上限, 具体数 user 拍)
- ⚠️ Save the Cat 节拍 → 章号映射(user 拍)
- ⚠️ 主题陈述(user 拍)
- ⚠️ 暧昧线处理(顾霁 N6 已退出, V3 是否回收 user 拍)

### §5.4 抗过度 spec 化(沿用调研报告 §7.4)

- ❌ value_shift 不强制(V1V2 baseline 0/80 留空)
- ❌ hook_type 不强制(同上)
- ❌ 5 诫命子段不写
- ❌ 跨章 scene 编号连续性不检
- ❌ pov 字段不强求(V1V2 0/80 留空, V3 阶段不强求)

## §6 风险与回滚点

### §6.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| V3 命名 user 反复改 | 中 | Stage 1 volume 模板 cp 重做 | Stage 1 等 user 卷名拍板再 cp |
| 25 章节拍配比 user 不满 | 中 | Stage 2 业务规划返工 | Stage 2 user review 节点强 gate |
| 主角弧线终点 user 拿不定 | 中 | Stage 3 大纲无法落位 | Stage 2 提供 2-3 个弧线候选 |
| ch-081 之前 user 改方向 | 低 | Stage 1-3 全部返工 | 4 stage 独立可回滚 |
| 模板 cp 路径错(覆盖 V1V2) | 低 | 严重(数据丢失) | cp 走 dry-run, 目标路径 `volume/第3卷-*` 不与 V1V2 重叠 |

### §6.2 回滚点

- **Stage 1 内回滚**: 模板 cp 失败 → `rm -rf workspace/.../lorebook/volume/第3卷-临时命名` + scene-master-list 删 V3 行
- **Stage 2 内回滚**: v3-plan.md 全文覆盖即可, 无副作用
- **Stage 3 内回滚**: volume.md 改回 V2 末状态 + character 模板 revert
- **Stage 4 失败**: 不合并 main, worktree 留待 user 决策(沿用 V1V2 archive 模式)

### §6.3 archive 模式(沿用 V1V2)

- V3 启动准备全程 worktree + cp + 0 push / 0 merge / 0 force-push
- 中间产物 archive 到 `workspace/.../docs/tasks/<task-id>/`(V1V2 已用此路径)
- Stage 4 收口才合并 main, user 拍板

## §7 与现有调研/spec 的关系

- 沿用 P0-P2 调研报告(SDD 6 工具), V3 是它们的**第一批实战对象**
- 沿用 P1-3 lore-resolver(已落位, V3 写作期直接受益)
- 沿用 P1-4 scene-six-questions(已落位, V3 写作期软提示)
- 沿用 P2-5 scene-master-list(已落位, V3 20-25 行加入)
- 沿用 P2-6 content-node templates(已落位, V3 volume 模板 cp)
- V1V2 5 批次 audit 闭环(2026-08-20), 文档同步校验基线 = main HEAD e7157647
- V1V2 8/8 + 11/11 验收 + 80/80 beat 命中基线 = V3 启动的对照基线

## §8 实施 TODO(转 writing-plans)

- [ ] Stage 1: 工具就位(模板 cp / scene-master-list V3 行 / baseline 跑通)
- [ ] Stage 2: V3 业务规划(story-spec/v3-plan.md 5 段 + user review)
- [ ] Stage 3: V3 大纲落位(volume.md / character state / relationship / scene-master-list 8 列)
- [ ] Stage 4: 验收(llmlint 全量 pass / spec sync / 收口 commit)
- [ ] memory 更新: v3-launch-archive-closed-2026-08-XX.md
- [ ] push main(V3 启动准备 = 大纲落位 OK, 不开 ch-081)

## §9 设计变更记录

- 2026-08-20: 初版设计, 5 个核心决策 + 4 阶段分解 + 模板与数据流 + 业务规划结构 + 验收与不变量 + 风险回滚点
