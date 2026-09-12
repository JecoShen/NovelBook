# Scene Master List — 全书场景主表

> 版本: 2026-08-20 (P2-5 落地)
> 来源 spec: `docs/superpowers/specs/2026-08-20-p2-5-p2-6.md` §2.3 + §3.2
> 派生工具: `scripts/scan-scene-master-list.cjs` (派生自 `workspace/qi-shou-fan-shen-cheng-ding-fu/baseline-scan.cjs` i128/i130/i131/i132)
> 8 列 schema: 6 自动从 frontmatter 抽 + 2 手工留空
> **严守调研报告 §7.4 抗过度 spec 化**：失败一律 soft 降级；不强制 5 诫命子段；不强制场景段；不强制价值转换方向。

---

## §1 用途

`scene-master-list.md` 是全书章节的场景主表，**作者写作期 + 编辑期共用**的 single source of truth。每一行是一章（V1+V2 80 章 = 80 行），自动抽 6 列（从 manuscript `index.md` frontmatter + `## 场景` 段计数），手工填 2 列（价值转换 + 钩子类型）。

**跟其他 reference 的关系**：

| reference | 角色 | 区别 |
|---|---|---|
| `scene-six-questions.md` (P1-4) | 单章 6 问软提示 | scene-master-list 是**全书视图** + 自动化 |
| `story-spec/index.md` | 整卷/整书规格 | scene-master-list 是**章级颗粒** |
| `lorebook/character/relationship-network.md` | 角色关系网 | scene-master-list 是**章节出现** |

**跟 llmlint 的关系**：

- `cn.structure.chapter-hook` 5 模式 (i129) 是**自动检测器**，输出 issue 列表
- `scene-master-list` 是**作者主动维护**的全书快照
- 两者互补：llmlint 找具体问题，scene-master-list 给全景

---

## §2 8 列 schema

| # | 列名 | 类型 | 来源 | 自动/手工 | 备注 |
|---|---|---|---|---|---|
| 1 | `vol` | string | 目录名（第1卷-坠落 / 第2卷-暗潮） | **自动** | 卷名（中文） |
| 2 | `chapter` | string | frontmatter `chapter:` 字段 | **自动** | 章号（e.g. `ch-001`） |
| 3 | `title` | string | frontmatter `title:` → 目录名 fallback | **自动** | 章名（V1+V2 baseline 走目录名 fallback） |
| 4 | `beat` | enum | frontmatter `beat:` 字段 (i128) | **自动** | Save the Cat 15 节拍（80/80 命中） |
| 5 | `pov` | string | frontmatter `pov:` 字段 | **自动** | POV 角色 slug（V1+V2 baseline 0 命中，无字段） |
| 6 | `scene` | int | `## 场景` 段计数（P1-4 detector 模式） | **自动** | 场景数（V1+V2 baseline 0/80） |
| 7 | `value_shift` | enum? | (暂无数据源) | **手工** | `+ → -` / `- → +` / 留空 |
| 8 | `hook_type` | enum? | i129 5 模式（决策: 不抽，留 V3 手工） | **手工** | `reversal` / `suspense` / `short-drop` / `question` / `ellipsis` / 留空 |

**决策**：6 自动 + 2 手工留空。V1+V2 baseline **前 6 列填，后 2 列空**，V3 写作期由作者手工填。

**显式不强制**（调研报告 §7.4 抗过度 spec 化）：

- ❌ 缺 `## 场景` 段 → 不报错（baseline 0/80 符合预期）
- ❌ `value_shift` 留空 → 不报错（V1+V2 baseline 留空）
- ❌ `hook_type` 填错枚举 → 不强制（V3 写作期可自定义）
- ❌ 跨章 `## 场景 N` 编号连续性 → 不检测
- ❌ 5 诫命子段（Inciting/Progressive/Crisis/Climax/Resolution）→ 不强制
- ❌ 同一章多场景 → 暂不支持（1 章 1 行）

---

## §3 字段说明（8 段）

### §3.1 `vol` (自动)

卷名。**来源**：manuscript 下的子目录名（`第1卷-坠落` / `第2卷-暗潮`）。

**V1+V2 baseline**：100% 命中（V1=30 章 / V2=50 章）。

### §3.2 `chapter` (自动)

章号。**来源**：frontmatter `chapter:` 字段（e.g. `chapter: ch-001`）。

**V1+V2 baseline**：100% 命中（80/80 章都有此字段，作为反孤儿指针核心）。

### §3.3 `title` (自动)

章名。**来源**：frontmatter `title:` 字段（V1+V2 都缺），fallback 到目录名（`001-三个字` → `三个字`）。

**V1+V2 baseline**：100% 命中（走目录名 fallback）。

### §3.4 `beat` (自动) — 联动 i128

Save the Cat 15 节拍。**来源**：frontmatter `beat:` 字段。

15 个枚举值（`opening-image` / `theme-stated` / `set-up` / `catalyst` / `debate` / `break-into-two` / `b-story` / `fun-and-games` / `midpoint` / `bad-guys-close-in` / `all-is-lost` / `dark-night` / `break-into-three` / `finale` / `final-image`）。

**V1+V2 baseline**：80/80 命中（i128 落位后填全）。`ch-040` = `midpoint` 显式命名 100% 命中。

**arc-relative 节拍**：卷末 `final-image` ≠ 全书 `final-image`。每卷独立的节拍序列。

### §3.5 `pov` (自动) — 联动 P1-3 lore-resolver

POV 角色 slug（e.g. `lu-shen`）。**来源**：frontmatter `pov:` 字段。

**V1+V2 baseline**：0/80 命中（无 frontmatter `pov:` 字段，scan 留空）。

**P1-3 lore-resolver** 也用此字段做角色绑定（references 解析）。V3 写作期补全。

### §3.6 `scene` (自动) — 联动 P1-4 scene-six-questions

场景数。**来源**：`## 场景` 段计数（regex `^## 场景` 锚定段头）。

**V1+V2 baseline**：0/80 命中（V1+V2 章节都用 `^## 场景` 段头但实际未填场景段，P1-4 baseline 预期）。

**P1-4 软提示**：`reference/scene-six-questions.md` 6 问作为单章场景填写引导。`scene-master-list` 是章节场景数的**全书快照**。

### §3.7 `value_shift` (手工)

价值转换方向。**作者判定**（不是机器可抽的）：

- `+ → -` (positive 转 negative)
- `- → +` (negative 转 positive)
- `+ → +` (维持 positive)
- `- → -` (维持 negative)
- 留空（无明显转换）

**V1+V2 baseline**：0/80 填（V1+V2 价值转换是隐性，作者未标）。

### §3.8 `hook_type` (手工) — 联动 i129 chapter-hook

章末钩子类型。**作者判定**（P2-5 决策: 不从 i129 5 模式抽，留 V3 手工）：

- `reversal` (反转)
- `suspense` (悬念)
- `short-drop` (短句顿挫)
- `question` (问号留白)
- `ellipsis` (省略号悬念)
- 自定义
- 留空

**V1+V2 baseline**：0/80 填（baseline 留空）。

**与 i129 关系**：i129 chapter-hook 5 模式 detector 在 `cn.structure.chapter-hook` llmlint 规则里跑（auto）。scene-master-list 钩子列是**作者主动标注**（manual），两者不冗余 —— detector 报 issue，作者在表里标 hook_type 用于整体分析。

---

## §4 空白模板

**作者新增章节时按此模板填一行**（从前章 row 复制 + 改值）：

```markdown
| vol | chapter | title | beat | pov | scene | value_shift | hook_type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第N卷-XXX | ch-NNN | 章名 | opening-image | lu-shen | 1 |  |  |
```

**V3 写作期填写清单**：

1. 写完一章后 → 复制前一行 → 改 chapter/title/beat/pov
2. 数 `## 场景` 段数 → 填 scene
3. 标价值转换方向 → 填 value_shift
4. 标章末钩子类型 → 填 hook_type
5. （可选）回头填 V1+V2 缺失的 pov/scene/value_shift/hook_type

---

## §5 V1 5 章填表示例

V1 ch-001 / 005 / 010 / 015 / 020 五章，**前 6 列从 frontmatter + 目录名抽**（V1+V2 baseline 真实数据），**后 2 列手工示例**（演示 V3 写作期怎么填）：

```markdown
| vol | chapter | title | beat | pov | scene | value_shift | hook_type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第1卷-坠落 | ch-001 | 三个字 | opening-image |  | 0 | + → - | reversal |
| 第1卷-坠落 | ch-005 | 归集节点 | catalyst |  | 0 | - → + | suspense |
| 第1卷-坠落 | ch-010 | 188号 | break-into-two |  | 0 | + → - | short-drop |
| 第1卷-坠落 | ch-015 | 四个字 | b-story |  | 0 |  | reversal |
| 第1卷-坠落 | ch-020 | 同类 | fun-and-games |  | 0 | - → + | question |
```

**示例数据来源**：

- `vol`: 目录名 `第1卷-坠落/`
- `chapter`: frontmatter `chapter: ch-NNN`
- `title`: 目录名 fallback `001-三个字` → `三个字` (frontmatter 缺 `title:` 字段)
- `beat`: frontmatter `beat: opening-image` / `catalyst` / `break-into-two` / `b-story` / `fun-and-games` (i128 80/80 命中)
- `pov`: 留空 (V1+V2 frontmatter 缺 `pov:` 字段, P1-3 lore-resolver 留空)
- `scene`: 0 (V1+V2 章节无 `## 场景` 段, P1-4 baseline 预期)
- `value_shift` / `hook_type`: 演示填法（V3 写作期风格指南, V1+V2 baseline 实际全空）

---

## §6 维护工作流

### §6.1 自动 baseline 跑法

```bash
# worktree 或主工作区, 任一位置
cd /www/wwwroot/book.neoshen.dpdns.org
node scripts/scan-scene-master-list.cjs \
    workspace/qi-shou-fan-shen-cheng-ding-fu/manuscript \
    workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i137-p2-5-baseline-report.md
```

**输出**：

- 顶部 summary: 总章数 / V1 / V2 / 6 列命中率 / 2 列手工留空率
- 80 行 Markdown table（V1 30 + V2 50）
- 文件落在 `.agent/plan/` 不污染 `docs/`

### §6.2 V3 写作期手工填 2 列

- **value_shift**: 写完后判定该章价值转换方向（+ → - / - → + / 留空）
- **hook_type**: 写完后判定章末钩子类型（5 模式 + 留空 + 自定义）

### §6.3 baseline 报告使用

- **V1+V2 复盘**：80 行表里 6 自动列已填，2 手工列空 → 写 v4.6 复盘时手工补 2 列
- **V3 启动前置**：baseline 报告是 V3 第 1 章前的全书快照基线
- **跨卷审查**：i130/i131/i132 reversal+short-drop 模式与 scene-master-list hook_type 列交叉验证

---

## §7 已知不变量

- **不动** `writer.profile.tsx` / `neuro-agent-harness.ts` / `server/agent/lore/*` (4 protected assets, 全 untouched)
- **不动** `assets/.../llmlint/rulesets/.../cn.structure.chapter-hook.json` (i129 stable)
- **不动** `reference/scene-six-questions.md` (P1-4 产物, P2-5 字段说明引用)
- **不强制** 5 诫命子段 / 价值转换方向 / 钩子枚举 / 跨章场景连续性
- **不报** `value_shift` / `hook_type` 留空 / 字段缺失

---

## §8 验收（spec §5 验证清单）

- ✅ 文件存在 `reference/scene-master-list.md` (~150 行)
- ✅ 8 列 schema 完整 (vol/chapter/title/beat/pov/scene/value_shift/hook_type)
- ✅ 8 段字段说明 (§3.1-§3.8)
- ✅ V1 5 章填表示例 (ch-001/005/010/015/020)
- ✅ 空白模板 (§4)
- ✅ 维护工作流 (§6)
- ✅ 严守调研报告 §7.4 抗过度 spec 化（§2 末段 + §3.7 + §3.8 + §4）
- ✅ V1+V2 80 章 baseline 由 `scripts/scan-scene-master-list.cjs` 自动跑（见 §6.1）
