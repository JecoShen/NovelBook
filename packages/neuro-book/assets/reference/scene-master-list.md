# Scene Master List — 全书场景主表

> 用途: 全书章节场景主表的 schema 与填写规范, 作者写作期 + 编辑期共用的 single source of truth
> 配套工具: `scripts/scan-scene-master-list.cjs` (半自动扫描 manuscript, 抽 6 列生成基线表)
> 设计原则: 失败一律 soft 降级; 不强制场景段 / 价值转换方向 / 钩子枚举 / 任何子段 (抗过度 spec 化)
> 来源 spec: `docs/superpowers/specs/2026-08-20-p2-5-p2-6.md` §2.3 + §3.2

---

## §1 用途

`scene-master-list.md` 是全书章节的场景主表。每一行是一章, 6 列从 manuscript 自动抽 (frontmatter + 目录约定 + `## 场景` 段计数), 2 列由作者手工填 (价值转换 + 钩子类型)。

**跟其他 reference 的关系**:

| reference | 角色 | 区别 |
|---|---|---|
| `scene-six-questions.md` | 单章 6 问软提示 | scene-master-list 是**全书视图** + 自动化 |
| `story-spec/index.md` | 整卷/整书规格 | scene-master-list 是**章级颗粒** |
| `lorebook/character/relationship-network.md` | 角色关系网 | scene-master-list 是**章节出现** |

**跟 llmlint 的关系**:

- `cn.structure.chapter-hook` 子规则组是**自动检测器**, 输出 issue 列表
- `scene-master-list` 是**作者主动维护**的全书快照
- 两者互补: llmlint 找具体问题, scene-master-list 给全景

---

## §2 8 列 schema

| # | 列名 | 类型 | 来源 | 自动/手工 | 备注 |
|---|---|---|---|---|---|
| 1 | `vol` | string | 卷目录名 | **自动** | 工具约定: 目录名以「第」开头且含「卷」(如 `第1卷-卷名`) |
| 2 | `chapter` | string | frontmatter `chapter:` 字段 | **自动** | 章号 (如 `ch-001`), 缺则留空 |
| 3 | `title` | string | frontmatter `title:` → 目录名 fallback | **自动** | fallback = 章节目录名剥掉 `NNN-` 前缀 |
| 4 | `beat` | enum | frontmatter `beat:` 字段 | **自动** | 项目自定义节拍 (示例: Save the Cat 15 节拍); 非产品内置字段, 缺省留空 |
| 5 | `pov` | string | frontmatter `pov:` 字段 | **自动** | POV 角色 slug, 缺省留空 |
| 6 | `scene` | int | `## 场景` 段计数 | **自动** | 未填场景段记 0 |
| 7 | `value_shift` | enum? | (无数据源) | **手工** | `+ → -` / `- → +` / 维持 / 留空 |
| 8 | `hook_type` | enum? | 作者判定 | **手工** | `reversal` / `suspense` / `short-drop` / `question` / `ellipsis` / 自定义 / 留空 |

**决策**: 6 自动 + 2 手工留空。机器可抽的列不手写, 需要判读的列不硬抽。

> 注: `beat` 列源自具体项目实践 (Save the Cat 15 节拍), 不是产品级硬约束; 产品内置的结构软提示只有 `scene-six-questions.md` 的场景六问。项目可以换成自己的节拍体系或整列留空。

**显式不强制** (抗过度 spec 化):

- ❌ 缺 `## 场景` 段 → 不报错 (记 0)
- ❌ `value_shift` 留空 → 不报错
- ❌ `hook_type` 填错枚举 → 不强制 (可自定义)
- ❌ 跨章 `## 场景 N` 编号连续性 → 不检测
- ❌ 5 诫命子段 (Inciting/Progressive/Crisis/Climax/Resolution) → 不强制
- ❌ 同一章多场景 → 不展开 (1 章 1 行, 只记场景数)

---

## §3 字段说明

### §3.1 `vol` (自动)

卷名。**来源**: manuscript 下的卷目录名。工具识别约定: 目录名以「第」开头且含「卷」字 (如 `第1卷-启程`)。

### §3.2 `chapter` (自动)

章号。**来源**: frontmatter `chapter:` 字段 (如 `chapter: ch-001`)。建议全书签全, 它是章节的反孤儿指针。

### §3.3 `title` (自动)

章名。**来源**: frontmatter `title:` 字段; 缺失时 fallback 到章节目录名 (工具识别 `NNN-` 三位数字前缀的目录, 剥掉前缀即为章名, 如 `001-雨夜来信` → `雨夜来信`)。

### §3.4 `beat` (自动)

节拍。**来源**: frontmatter `beat:` 字段, 枚举由项目自定。常见取法是 Save the Cat 15 节拍:

`opening-image` / `theme-stated` / `set-up` / `catalyst` / `debate` / `break-into-two` / `b-story` / `fun-and-games` / `midpoint` / `bad-guys-close-in` / `all-is-lost` / `dark-night` / `break-into-three` / `finale` / `final-image`

**arc-relative 节拍**: 卷末 `final-image` ≠ 全书 `final-image`, 每卷可以有独立的节拍序列。

### §3.5 `pov` (自动)

POV 角色 slug。**来源**: frontmatter `pov:` 字段。slug 与 lorebook 角色条目同名时可直接交叉引用; 未填留空。

### §3.6 `scene` (自动)

场景数。**来源**: 正文 `## 场景` 段计数 (regex `^## 场景` 锚定段头), 未填记 0。

单章场景段的填写引导见 `scene-six-questions.md` 六问; scene-master-list 是章节场景数的**全书快照**。

### §3.7 `value_shift` (手工)

价值转换方向, **作者判定** (不是机器可抽的):

- `+ → -` (positive 转 negative)
- `- → +` (negative 转 positive)
- `+ → +` / `- → -` (维持)
- 留空 (无明显转换)

### §3.8 `hook_type` (手工)

章末钩子类型, **作者判定**:

- `reversal` (反转)
- `suspense` (悬念)
- `short-drop` (短句顿挫)
- `question` (问号留白)
- `ellipsis` (省略号悬念)
- 自定义
- 留空

**与 llmlint 关系**: 这 5 个模式对应内置规则组 `cn.structure.chapter-hook.{question,ellipsis,reversal,suspense,short-drop}` 的自动检测。两者不冗余 —— detector 报具体 issue, 作者在表里标 `hook_type` 用于全书钩子的整体分析。

---

## §4 空白模板

**新增章节时按此模板填一行** (从前章 row 复制 + 改值):

```markdown
| vol | chapter | title | beat | pov | scene | value_shift | hook_type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第N卷-卷名 | ch-NNN | 章名 | opening-image | role-slug | 1 |  |  |
```

**写作期填写清单**:

1. 写完一章后 → 复制前一行 → 改 chapter/title/beat/pov
2. 数 `## 场景` 段数 → 填 scene
3. 判定价值转换方向 → 填 value_shift
4. 判定章末钩子类型 → 填 hook_type
5. (可选) 阶段性跑扫描脚本, 刷新前 6 列基线

---

## §5 填表示例

虚构示例, 演示各列填法 (前 6 列来自自动抽取, 后 2 列手工判定):

```markdown
| vol | chapter | title | beat | pov | scene | value_shift | hook_type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第1卷-启程 | ch-001 | 雨夜来信 | opening-image | lin-zhao | 1 | + → - | suspense |
| 第1卷-启程 | ch-002 | 旧车站 | set-up | lin-zhao | 2 |  | question |
| 第1卷-启程 | ch-003 | 不速之客 | catalyst |  | 1 | - → + | reversal |
```

**示例覆盖的情形**:

- `ch-001`: 全列填满的常规行
- `ch-002`: 一章多场景 (`scene` = 2), `value_shift` 留空 (维持章)
- `ch-003`: `pov` 留空 (frontmatter 未填 `pov:` 字段时的正常状态)

---

## §6 维护工作流

### §6.1 自动基线跑法

```bash
node scripts/scan-scene-master-list.cjs <manuscript-dir> <output-md>
# 例: node scripts/scan-scene-master-list.cjs workspace/<project>/manuscript <project>/.agent/plan/scene-master-baseline.md
```

**工具合同**:

- 卷目录识别: 名字以「第」开头且含「卷」字; 章节目录识别: `NNN-` 三位数字前缀, 内含 `index.md`
- frontmatter 缺字段 → 对应列留空; 无 frontmatter 或无 `index.md` → 跳过该章并计入 summary
- 输出: 顶部 summary (总章数 / 各列命中率 / 手工列留空率) + 全量 Markdown 表
- soft 降级: 参数缺失或目录不存在时打印警告并以退出码 0 结束, 不中断任何流程
- 输出文件建议落在项目的 `.agent/plan/` 下, 不污染文档目录

### §6.2 写作期手工填 2 列

- **value_shift**: 写完后判定该章价值转换方向
- **hook_type**: 写完后判定章末钩子类型 (5 模式 + 自定义 + 留空)

### §6.3 基线报告用法

- **复盘**: 自动列已填、手工列待补的全书快照, 做卷级/全书复盘时手工补 2 列
- **新阶段前置**: 进入新卷或新阶段前跑一次, 作为全书状态基线
- **跨卷审查**: 与 llmlint `chapter-hook` 检测结果交叉验证钩子分布

---

## §7 设计约束

- 工具只读 manuscript, 只写输出报告, 不修改任何章节源文件
- 缺字段 / 缺场景段 / 手工列留空一律不产生错误, 只如实记录
- 1 章 1 行; 同一章多场景不展开, 只记场景数
- 不强制 5 诫命子段 / 价值转换方向 / 钩子枚举 / 跨章场景编号连续性
