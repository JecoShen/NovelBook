# P1-3 lore-resolver.ts MVP — 按需 lore 注入

> 设计日期：2026-08-18
> 来源调研：`workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/research-sdd-novel-writing-2026-08-18.md` §6.3
> 状态：设计 spec（待 user review）
> **patch**: 2026-08-18 实施时校正 §6 文件清单 2 处路径错误 + §1 架构图 + §2.4 注释（详见 commit XXXXXXX 与 workspace/.../v45-p1-3-archive/02-patch-report.md）
> **patch v4.7**: 2026-08-19 M-11 落地 + §2.2/§2.4/§2.6 校正 + §3/§4/§5 同步（详见 commit 待定 + workspace/.../v45-p1-3-archive/06-m-11-carryover-lockdown.md）
> **patch v4.8** (Phase 4 audit, 2026-08-20): 8 minor 引用校正 — M-7 TTL+LRU+accessCounter (§2.1) + M-2 字符预算含 header/footer (§2.3) + M-3 cleanFrontmatter dropSummary (§2.3) + M-9 harness 内层 try-catch (§2.4) + §5 测试补 4 case + §6 文件清单 +1080→~980 行 + Cat 3 (per CLAUDE.md 假引用) L426/L511/L512 校正至 `vol2-v45-archive-mode` / `novel-frontend-display-fix-2026-08-17` memory
> **patch v4.9** (Phase 5 audit, 2026-08-20): 3 minor + A1 + M-11 引用校正 — M-6 LoreEntryKind 8 kinds 决策 (§2.1) + M-4 §2.3 8 kinds 顺序决策 (§2.3) + M-10 writer binding 5 测试 (§2.5) + M-11 cross-ref (§2.6) + A1 nits named const (§2.1) + §5 测试矩阵补 M-4 + M-10 entries + M-10 5 测试覆盖 (boundary <100/==100 + XML attrs + KIND_ORDER + maxChars budget)
> 目标：解决长篇 lore 全量注入 LLM 上下文导致超长 prompt 与 token 浪费

---

## §1 架构

```
                    ┌─────────────────────────────────────────┐
                    │       server/agent/lore/  (新子树)       │
                    │                                         │
                    │  lore-resolver-cache.ts                 │
                    │    ▲ build index on project.ready       │
                    │    │   Map<trigger, path[]>             │
                    │    │                                     │
                    │  lore-resolver.ts                       │
                    │    ▲ preloadChapter(text)               │
                    │    │   → Set<path>                       │
                    │    │                                     │
                    │  lore-context-injector.ts               │
                    │    ▲ renderInjectedMarkdown(paths)      │
                    │    │   → Markdown <chapter_lore_context> 段│
                    │    │                                     │
                    │  lore-resolver-cache.test.ts            │
                    │  lore-resolver.test.ts                  │
                    │  lore-context-injector.test.ts          │
                    │  lore-resolver-integration.test.ts       │
                    └──────────┬──────────────────────────────┘
                               │ 调用
                               ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  server/agent/harness/neuro-agent-harness.ts prepareRun (改 1 处)            │
   │    1. context-access 已注入 generated.md (existing)                          │
   │  // 注：注入点真实位置 = systemPrompt 拼接收尾 (line 2033), 详见 patch report│
   │    2. ★ 解析 chapter text → 调 resolver.preloadChapter()                     │
   │    3. 合并到 writer prompt 的 <chapter_lore_context> 段                      │
   │    4. 调 recordContextAccess 记 explicitInput                                │
   └──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  server/agent/profiles/writer.profile.tsx  (改 1 处)        │
   │    ★ 新增工具 lore_resolver_query(extra_terms: string[])  │
   │      让 agent 在写中可显式追加 lore                        │
   └──────────────────────────────────────────────────────────┘
```

**关键不变量**：
- `lore-resolver-cache.ts` 是**纯只读**：从 workspace 读 frontmatter + index.md，从不写
- 跨 session 共享 in-memory cache（同一 `ProjectWorkspaceKey` 复用）
- 不动 `profile-context-access.ts` 现有逻辑，resolver 是**只追加**一层
- `note/ / story-spec/ / instruction/` **不**进索引

---

## §2 组件

### 2.1 `lore-resolver-cache.ts`

```typescript
// 8 kinds — note 在 §3 invariant 显式排除 (作者笔记不可被 LLM 当 lore 读取),
// spec 类可注入 (story-spec/index.md 是符合 lore 形态的元数据, 但走不同 prefix)
export type LoreEntryKind =
  | "character" | "location" | "faction"
  | "event" | "item" | "world" | "system" | "spec";

export interface LoreEntryMeta {
  /** workspace-relative path，如 "lorebook/character/lu-shen" */
  readonly path: string;
  readonly kind: LoreEntryKind;
  /** 来自 frontmatter title 字段 */
  readonly title: string;
  /** 来自 frontmatter retrieval.trigger 数组 */
  readonly triggers: readonly string[];
  /** 来自 frontmatter retrieval.enabled，缺省 true */
  readonly enabled: boolean;
}

export interface LoreResolverIndex {
  /** trigger (中文/英文/slug) → 该 trigger 命中的 entry path 集合 */
  readonly triggerToPaths: ReadonlyMap<string, ReadonlySet<string>>;
  /** path → 该 entry 元数据 */
  readonly pathToEntry: ReadonlyMap<string, LoreEntryMeta>;
  /** 项目会话期间不变 */
  readonly builtAt: string;
}

export async function buildLoreResolverIndex(
  project: ReadyProjectSessionRef,
): Promise<LoreResolverIndex>;

export function invalidateLoreResolverIndex(
  project: ReadyProjectSessionRef,
): void;
```

**构建过程**：
1. 调 `project.workspace.ref.projectRoot` 拿到根
2. 用 `fs.readdir` 遍历 `lorebook/{character,location,faction,event,item,world,system,spec}/`（**不**遍历 `note/`、`story-spec/`、`instruction/`）— 8 dirs per **M-6 LoreEntryKind 决策** (note 故意排除, per §3 invariant 安全策略)
3. 每个 entry 读 `index.md` 的 frontmatter，提取 `path/kind/title/triggers/enabled`
4. `enabled === false` 跳过
5. 触发器去重 + 长度过滤（< 2 字符的 trigger 跳过，避免误伤"我"/"他"等）
6. 构建 `Map<trigger, Set<path>>` 索引

**§2.1 M-6 决策**：
- **LoreEntryKind = 8 kinds** (no `note`, 保留 `spec`)
- `note/` 故意不 traverse (per §3 invariant: 作者笔记不可被 LLM 当 lore 读取)
- `spec/` kind 可注入 (story-spec/index.md 是符合 lore 形态的元数据, 但走不同 prefix)
- impl `ALLOWED_KINDS = 8` 是 spec 真相, spec §2.1 早期版本列 9 kinds (含 note) 是 spec 文档错误, 已校正
- 实施 commit `7b3740d4` on `feat-i-1-production-wiring` (M-4 + M-6 合并 1 commit)

**缓存策略（M-7）**：
- TTL 5 分钟（`DEFAULT_CACHE_TTL_MS = 5 * MS_PER_MINUTE`）— 防止 `invalidate` 漏调时索引陈旧
- LRU 上限 100 entries（`DEFAULT_CACHE_SIZE = 100`）— 防 memory leak 在多 project 长会话
- Tie-breaker 单调计数器（`accessCounter`）— `Date.now()` 1ms 分辨率不够，4 个连续 `buildLoreResolverIndex` 在 1ms 内会全相等
- TTL 过期或 LRU 淘汰 → 重新 `buildLoreResolverIndex`
- `setLoreCacheOptions({ ttlMs, size })` 暴露给测试/调优

**缓存命名常量（A1 nits）**：
- `MS_PER_MINUTE = 60 * 1000`
- `DEFAULT_CACHE_TTL_MS = 5 * MS_PER_MINUTE`
- `DEFAULT_CACHE_SIZE = 100`
- `makeProjectRef(root)` 在 `lore-test-helpers.ts` 共享（6 test files DRY, 净 -22 行）
- 实施 commit `614d1a08` on `feat-p1-3-minor-nits` (branch 已删, 内容 main 已有)

**§2.1 引用**：`M-7 TTL+LRU+accessCounter 详见 [[m-7-archive-2026-08-19]]` (实施 3 commits on `feat-i-1-production-wiring`) + `M-6 LoreEntryKind 详见 [[p1-3-3-remaining-minor-archive-2026-08-19]]` + `A1 nits 详见 [[p1-3-minor-nits-archive-cleaned-2026-08-20]]`

### 2.2 `lore-resolver.ts`

```typescript
export interface ResolveForChapterInput {
  readonly project: ReadyProjectSessionRef;
  readonly chapterText: string;
  /**
   * 来自前 3 章 commit 时的注入 paths union 去重列表, 无条件优先保留 (即使本章未命中)。
   * 由 `readRecentLoreInjections({ project, limit: 3 })` 提供, 见 §2.6。
   * 末条 (最新 commit) 的 paths 排最前 (per existing carrySet 优先级)。
   */
  readonly carryOverPaths?: readonly string[];
  /** 注入上限，默认 8 */
  readonly maxPaths?: number;
}

export interface ResolveForChapterResult {
  /** 排序后的注入路径列表（按命中 trigger 数量降序） */
  readonly paths: readonly string[];
  /** 每个 path 命中的 trigger 列表（debug 用） */
  readonly hitsByPath: ReadonlyMap<string, readonly string[]>;
  /** 总命中 trigger 数（metrics 用） */
  readonly totalTriggersMatched: number;
}

export async function resolveForChapter(
  input: ResolveForChapterInput,
): Promise<ResolveForChapterResult>;
```

**算法**：
```
1. project 命中已构建索引 → 否则 throw
2. chapterText 按段落切分（避免误跨段匹配）
3. 对每个段落：
   for trigger of index.triggerToPaths.keys():
     if paragraph.includes(trigger):
       for path of index.triggerToPaths.get(trigger):
         hitsByPath[path].push(trigger)
4. 排序：hitsByPath[path].length DESC, 然后 carryOver 优先
5. 截取前 maxPaths (默认 8)
6. 返回 { paths, hitsByPath, totalTriggersMatched }
```

**复杂度**：`O(chunks × triggers × 1)` ≈ 50 段 × 200 trigger × string.includes ≈ <10ms

### 2.3 `lore-context-injector.ts`

```typescript
export interface RenderInjectedMarkdownInput {
  readonly project: ReadyProjectSessionRef;
  readonly paths: readonly string[];
  /** 注入上限字符数，默认 8000 (≈ 2k tokens) */
  readonly maxChars?: number;
}

export interface RenderInjectedMarkdownResult {
  /** 渲染好的 Markdown，可直接塞进 writer prompt */
  readonly markdown: string;
  /** 实际注入的 path（可能因 maxChars 被截） */
  readonly includedPaths: readonly string[];
  /** 被截断的 path（debug 用） */
  readonly truncatedPaths: readonly string[];
  /** 总字符数 */
  readonly totalChars: number;
}

export async function renderInjectedMarkdown(
  input: RenderInjectedMarkdownInput,
): Promise<RenderInjectedMarkdownResult>;
```

**渲染规则**（per entry）：
- 读 `index.md`，**只保留**：
  - frontmatter（去 `retrieval/governance/ext`，保留 `title/type/aliases/tags/summary`）
  - `## 基本信息` 段（**或** frontmatter `summary` 如果该段缺失）
  - `## 性格` 段**前 3 行**
- 顺序：`character` → `location` → `faction` → `event` → `item` → `world` → `system` → `spec` (8 kinds, 见 §2.1)
- 同类型按 hits 数降序
- 累计字符数超 `maxChars` → 截断后剩余

**字符预算（M-2）**：
- `maxChars` 默认 8000 (≈ 2k tokens) — 计入 `<chapter_lore_context>` 标签 + `## <title> (<kind>)` header + `>` 块引用 + 表格 + 段间空行
- 截断时优先保留已注入的 path（不再为新 path 抢预算），避免 prompt 上下文突然变窄
- 截断后剩余的 path 落入 `truncatedPaths`，harness 决定是否降级提示

**Frontmatter 清洗（M-3）**：
- `cleanFrontmatter(parsed)` 顺序：先剥 `retrieval.*` → `governance.*` → `ext.*` → 整体 `dropSummary` (若 frontmatter `summary` 与 `## 基本信息` 段同时存在，优先段，drop frontmatter summary 防重复)
- 保留：`title/type/aliases/tags/summary` (仅当 `## 基本信息` 段缺)
- drop 顺序按"作者不太会回看"由低到高：`ext → governance → retrieval`，便于未来 log debug

**§2.3 引用**：`M-2 字符预算 + M-3 frontmatter dropSummary 详见 [[m-2-m-3-archive-2026-08-19]]` (实施 1 commit `16b456b0` on `feat-i-1-production-wiring`)

**§2.3 M-4 决策**：
- **KIND_ORDER 顺序 = 8 kinds 顺序**: `character` → `location` → `faction` → `event` → `item` → `world` → `system` → `spec`
- spec §2.3 早期版本只列 7 kinds (no spec) 是 spec 漂移, impl `KIND_ORDER = 8 kinds` 是真相, spec 已校正
- 顺序依据: 用户对角色 / 地点 / 阵营关注度 > 事件 / 物品 / 世界观 > 系统规则 / 设定
- 同类型按 hits 数降序, 跨类型按 KIND_ORDER 优先
- 实施 commit `7b3740d4` on `feat-i-1-production-wiring` (M-4 + M-6 合并 1 commit)

**输出格式**：
```markdown
<chapter_lore_context generatedAt="2026-08-18T..." maxPaths="8" included="6" truncated="2">
  ## 陆深 (character)

  > 陆深（"陆"取自临江嘴，"深"意为深沉内敛、深度分析）

  | 项目 | 设定 |
  |------|------|
  | 姓名 | 陆深 |
  | 年龄 | 29岁 |
  | 前职业 | 量化交易员/基金经理（临江嘴某中型量化私募） |

  **核心性格**：高智商、理性至上、外冷内热、骄傲但正在学会谦卑
  **正面特质**：
  - 分析型思维：遇到问题先拆解、建模、找最优解——这是本能，不是技能
  - 抗压能力极强：从100万年薪到月入6000的落差没有击垮他

  ## 梅澜湖 (location)
  ...
</chapter_lore_context>
```

### 2.4 harness 集成点（`prepare-run.ts` 改 1 处）

```typescript
// 伪代码示意
async function prepareWriterContext(input) {
  // ... existing 流程

  // ★ 新增：章节级 lore 注入
  const chapterText = input.chapter?.text ?? "";
  if (chapterText.length > 100) {
    // M-11: 从 JSONL 读前 3 章 commit 时的注入 paths union 去重
    const carryOverPaths = await readRecentLoreInjections({
      project: input.project,
      limit: 3,
    });
    const resolved = await resolveForChapter({
      project: input.project,
      chapterText,
      carryOverPaths,
      maxPaths: 8,
    });

    const injected = await renderInjectedMarkdown({
      project: input.project,
      paths: resolved.paths,
      maxChars: 8000,
    });

    // 合并到 writer prompt
    promptSections.push({
      key: "chapter_lore_context",
      content: injected.markdown,
    });

    // 调 context-access 记录
    await recordExplicitContextEntries({
      project: input.project,
      profileKey: "writer",
      sessionId: input.sessionId,
      entries: injected.includedPaths.map((p) => ({ path: `lorebook/${p}/index.md` })),
    });

    // M-11: 追加本章注入到 JSONL (供下章 carryOver)
    await recordLoreInjection({
      project: input.project,
      record: {
        chapterId: input.chapter?.id ?? input.sessionId,
        paths: injected.includedPaths,
        ts: new Date().toISOString(),
      },
    });
  }

  return prompt;
}
```

**§2.4 引用**：`M-9 inner try-catch 详见 [[m-9-archive-2026-08-19]]` (实施 1 commit `21dc29eb` on `feat-i-1-production-wiring`)

**内层 try-catch 契约（M-9）**：
- `recordExplicitContextEntries` 与 `recordLoreInjection` 必须包在内层 try-catch，**失败不许 throw 阻断主流程**
- 失败日志键：`agent.lore.record.failed` (单一日志点便于运维检索)
- 失败行为：记日志 + 继续 commit，**不**重试（profile-context-access 同步写 SQLite，重试易引发同 key 双写）
- 验证：`writeLoreRecordFailedLog` 单元测试覆盖 throw path + 捕获栈 (per 1 test)

**注**: extractChapterText MVP 边界 — payload contract 暂无 `chapterText` 字段（真实 `WriterPayloadSchema` 为 `{path, chapterId?, context?}` + `additionalProperties: false`），真实 production 流程 auto-injection 不触发，降级为 `console.warn` 提示（非静默 no-op）。显式 follow-up: 加 chapter-read path 或扩 payload schema。

### 2.5 writer 工具（`writer.profile.tsx` 新增 1 工具）

```typescript
defineTool({
  name: "lore_resolver_query",
  description: "按额外实体名（trigger）追加检索 lore 卡片，写场景中如需补充设定可调用。返回 Markdown 片段，可直接复制到当前 prompt 上下文。",
  inputSchema: z.object({
    extra_triggers: z.array(z.string().min(2)).min(1).max(10),
  }),
  handler: async ({ extra_triggers }, ctx) => {
    const resolved = await resolveForChapter({
      project: ctx.project,
      chapterText: extra_triggers.join(" "),  // 用 trigger 串作为"伪文本"
      maxPaths: 4,
    });
    const injected = await renderInjectedMarkdown({
      project: ctx.project,
      paths: resolved.paths,
      maxChars: 4000,
    });
    return { content: injected.markdown };
  },
});
```

**§2.5 M-10 writer binding 测试**：
- 测试文件: `writer-profile-lore-injection.test.ts` (16 tests: 11 baseline + 5 new)
- 5 new 覆盖:
  1. **chapter 长度边界 < 100** — auto-injection **不**触发 (per spec §2.4 `if (chapterText.length > 100)`)
  2. **chapter 长度边界 == 100** — auto-injection 仍**不**触发 (`>` not `>=`)
  3. **XML attrs** — 验证 `<chapter_lore_context generatedAt="..." maxPaths="..." included="..." truncated="...">` 全部存在且合法数字
  4. **多卡片 KIND_ORDER** — 验证 character 先于 location 先于 faction 等 (8 kinds 顺序)
  5. **maxChars budget 数学** — 验证 `included+truncated = maxPaths` + truncated 是合法数字 (不强制 truncated > 0, 因 personality 截断 4 行后单卡字符数 < 1000)
- 实施 commit `d8169a74` on `feat-i-1-production-wiring`

### 2.6 `lore-carryover-store.ts` (M-11)

持久化章节级 lore 注入记录，供下章 `resolveForChapter` 的 `carryOverPaths` 使用。

```typescript
export interface LoreInjectionRecord {
  readonly chapterId: string;
  readonly paths: readonly string[];
  readonly ts: string; // ISO 8601
}

export interface ReadOptions {
  readonly limit: number; // 默认 3
}

export async function recordLoreInjection(
  project: ReadyProjectSessionRef,
  record: LoreInjectionRecord,
): Promise<void>;

export async function readRecentLoreInjections(
  project: ReadyProjectSessionRef,
  options: ReadOptions,
): Promise<readonly string[]>;
// ↑ 返回末 N 条 (按 JSONL 出现顺序) 的 paths union 去重, 末条排最前
```

**存储位置**：`workspace/.nbook/state/lore-carryover.jsonl`（gitignored, 与 `runtime.lease` 同级目录但不同子目录）。

**行为契约**：
- **append**：`fs.appendFile` 追加一行 JSON + `\n`，原子性足够（PM2 单进程顺序写）。
- **read**：tail 末 N 条 → 按出现顺序逆序遍历 → Set 去重 path → 返回 `[...result]`（末条 first）。
- **章去重**：同一 `chapterId` 多次 record 在 read 时不去重 (按 record 时间保留多版本, 但 path 用 Set 屏蔽)。
- **文件不存在** → `readRecent` 返回 `[]` (静默降级, 与 §4 错误处理一致)。
- **单行 malformed JSON** → 跳过该行 + warn log，不 throw（与 §4 容错一致）。

**为何用 JSONL 而非 JSON**：
- append-only 写不需 read-modify-write，并发安全。
- 损坏一行不影响其它行（每行独立 JSON 解析）。
- 顺序读 tail 末 N 条 = O(1) 内存。

**§2.6 M-11 引用**：
- spec v4.7 patch + 实施 4 commits on `feat-i-1-production-wiring`:
  - `8e293aae` feat(lore): M-11 carryOverPaths JSONL store
  - `5b2cb363` feat(harness): M-11 wire carryOverPaths in prepareRun + record in commit-point
  - `6d292d4e` docs(spec): v4.7 M-11 carryOverPaths spec
  - `97e1361d` docs(plan): M-11 carryOverPaths TDD plan
- 跨 spec 引用: §2.2 `ResolveForChapterInput.carryOverPaths` + §2.4 harness 集成 + §3 数据流 + §4 错误处理 + §5 测试矩阵 (5 case)
- 详细 plan: `docs/superpowers/plans/2026-08-19-m-11-carryover-paths.md` (502 行)
- 内存: `[[m-11-carryover-paths-archive-2026-08-19]]` (P1-3 minor 11/11 100% 闭环)
- 累计 P1-3 minor 11/11 APPLIED (M-1/M-2/M-3/M-4/M-5/M-6/M-7/M-8/M-9/M-10/M-11)
- 验证: 32/32 lore tests + 16/16 writer profile tests + i134 perf 0.00/0.20/2.68ms (余量 10000x/100x/19x)

---

## §3 数据流

```
首次启动会话:
  harness.bootstrap(project)
    → lore-resolver-cache.buildLoreResolverIndex(project)
        fs.readdir lorebook/character/ → 读 21 张 character
        fs.readdir lorebook/location/ → 读 ~10 张 location
        ...
        构建 Map<trigger, Set<path>>  ← in-memory, ~30ms
    → 缓存到 project.loreResolverIndex (session-scoped)

写章节:
  harness.prepareWriterContext(chapter)
    → readRecentLoreInjections({ project, limit: 3 })  ← JSONL 末 3 章 union 去重 (M-11)
    → resolveForChapter({ chapterText, carryOverPaths, ... })
        O(50段 × 200trigger × string.includes)  <10ms
    → renderInjectedMarkdown(paths)
        O(8 张卡片 × 6-8KB)  <50ms
    → 拼入 prompt <chapter_lore_context> 段

写中追加:
  agent 调用 lore_resolver_query(["顾霁", "临江嘴"])
    → resolveForChapter({ chapterText: "顾霁 临江嘴" })
    → renderInjectedMarkdown({ maxChars: 4000 })

注入完成 (M-11 调点):
  harness 注入后 (与 recordExplicitContextEntries 同点)
    → recordLoreInjection({ chapterId, paths: includedPaths, ts })  ← append JSONL
    → recordExplicitContextEntries(8 paths)  ← 进入 profile-context-access
    → 下次同项目同 profile 开新章，context-access 排序把这 8 张推为「strong」
    → 下次 prepareRun 读 JSONL 末 3 章 union 去重 = M-11 carryOver 来源
```

**关键不变量**：
- cache 失效只在 `invalidateLoreResolverIndex(project)` 显式调用
- `note/ / story-spec/ / instruction/` **不**进索引（避免 LLM 看到「作者笔记」误读为 lore）
- 输出 Markdown **总字符数**硬上限 8000（writer prompt 配额管理）
- **M-11**：JSONL 文件在 `workspace/.nbook/state/lore-carryover.jsonl`（gitignored），append-only，tail 读末 N 条

---

## §4 错误处理

| 失败场景 | 行为 | 失败模式 |
|---|---|---|
| `lorebook/` 目录不存在 | resolver 返回空 paths，prompt 不注入 `<chapter_lore_context>` 段 | **静默降级** |
| 某 entry index.md frontmatter 解析失败 | 跳过该 entry，记 warning log，索引继续构建 | **跳过错误 entry** |
| 某 trigger 命中但对应 entry index.md 读取失败 | 跳过该 path，从 paths 列表移除 | **跳过错误 path** |
| 章节文本 < 100 字符（如新章起笔） | 跳过整个 lore 解析 | **短路** |
| cache 构建超时（> 5s） | 强制返回空索引，记 error | **降级** |
| agent 调 `lore_resolver_query` 时 cache 未构建 | 同步触发 buildIndex（兜底） | **同步兜底** |
| **M-11** `lore-carryover.jsonl` 不存在 | `readRecent` 返回 `[]`, 走原 carryOver=[] 路径 | **静默降级** |
| **M-11** JSONL 单行 malformed | 跳过该行 + warn log, 其它行正常 | **跳过错误行** |
| **M-11** `recordLoreInjection` 写失败 | warn log, 不 throw (carryOver 仍有, 不影响下章读取) | **降级** |

**绝不让 resolver 失败导致 harness 抛错**——所有错误都是"降级到无 lore 注入"，harness 流程继续。

---

## §5 测试

按 ECC `typescript/testing.md` 80% 覆盖率 + AAA 模式：

| 测试文件 | 覆盖场景 |
|---|---|
| `lore-resolver-cache.test.ts` | (1) 扫 21 张 character 构建索引 (2) `enabled: false` 跳过 (3) 路径中含特殊字符（中文/空格） (4) frontmatter 缺字段时 defaults (5) `note/` 不进索引 **(6) M-7 TTL 过期 → 重新 build** **(7) M-7 LRU 100 上限 + accessCounter tie-breaker** |
| `lore-resolver.test.ts` | (1) 单 trigger 命中 (2) 多 trigger 命中 (3) 同一 path 多 trigger 累加 (4) 排序：命中数 DESC (5) carryOver 优先 (6) `maxPaths` 截取 (7) 空文本返回空 paths (8) 文本中 trigger 跨段不误命中 |
| `lore-context-injector.test.ts` | (1) 渲染 character/location/faction/**spec** 顺序 (2) `## 基本信息` 段提取 (3) `## 性格` 段只取 3 行 (4) `maxChars` 截断 + truncatedPaths (5) frontmatter 清洗（去掉 retrieval/governance/ext） **(6) M-2 字符预算含 header/footer** **(7) M-3 cleanFrontmatter dropSummary 防重复** **(8) M-4 8 kinds 顺序 (含 spec)** |
| `lore-resolver-integration.test.ts` | (1) build → resolve → render 全链路 (2) harness 调用注入点 mock (3) 调 `lore_resolver_query` 工具 **(4) M-9 recordExplicitContextEntries throw → 不阻断主流程 + log agent.lore.record.failed** |
| `lore-resolver-harness-trycatch.test.ts` (M-9) | (1) recordExplicitContextEntries throw → 日志键 + 继续 commit (2) recordLoreInjection throw → 同上 (3) 同步失败路径不重试（per profile-context-access 同步写 SQLite 易双写） |
| `writer-profile-lore-injection.test.ts` (M-10) | (1) 11 baseline (2) **M-10 5 new**: chapter 长度边界 < 100 / == 100 + XML attrs 合法数字 + 8 kinds KIND_ORDER + maxChars budget 数学 (included+truncated=maxPaths, truncated 是合法数字) |
| **`lore-carryover-store.test.ts` (M-11)** | (1) record 1 章 → read 1 返回该章 paths (2) record 5 章, read limit=3 返回末 3 章 union (3) 同一 chapterId 多次 record → read 保留多版本 + path 去重 (4) 文件不存在 → read 返回 `[]` (5) 末行 malformed → skip + 前面行正常返回 + 顺序保留 |

**TDD 顺序**（per ECC `development-workflow.md`）：
1. **RED**：先写 `lore-resolver-cache.test.ts` 5 个 case
2. **GREEN**：写 `lore-resolver-cache.ts` 通过
3. **REFACTOR**：抽 `lore-resolver-cache.ts`
4. **RED**：写 `lore-resolver.test.ts`
5. **GREEN**：实现 `lore-resolver.ts`
6. **RED**：写 `lore-context-injector.test.ts`
7. **GREEN**：实现 injector
8. **RED**：写 `lore-resolver-integration.test.ts`
9. **GREEN**：接入 prepare-run.ts 改 1 处
10. **GREEN**：writer.profile.tsx 加 1 工具

**archive 模式**（per `vol2-v45-archive-mode` memory）：worktree `feat-p1-3-lore-resolver` + cp 主工作区，**0 push**。

---

## §6 文件清单

新增 7 文件（全部在 archive worktree 内）：

| 文件 | 行数估 | 用途 |
|---|---|---|
| `server/agent/lore/lore-resolver-cache.ts` | ~150 | in-memory 索引构建 + 查询 + **M-7 TTL 5min + LRU 100 + accessCounter** |
| `server/agent/lore/lore-resolver.ts` | ~80 | resolveForChapter 主函数 |
| `server/agent/lore/lore-context-injector.ts` | ~180 | 解析 index.md + 渲染 Markdown + **M-2 字符预算含 header/footer + M-3 cleanFrontmatter dropSummary** |
| `server/agent/lore/lore-resolver-cache.test.ts` | ~210 | 索引测试 + **M-7 TTL/LRU 2 case** |
| `server/agent/lore/lore-resolver.test.ts` | ~150 | resolver 测试 |
| `server/agent/lore/lore-context-injector.test.ts` | ~240 | injector 测试 + **M-2/M-3 2 case** |
| `server/agent/lore/lore-resolver-integration.test.ts` | ~100 | 集成测试 + **M-9 recordExplicit throw 1 case** |
| `server/agent/lore/lore-resolver-harness-trycatch.test.ts` (M-9) | ~60 | harness 内层 try-catch 单元 (3 case) |

修改 2 文件：

| 文件 | 改动行 | 改动点 |
|---|---|---|
| `server/agent/harness/neuro-agent-harness.ts:2033` | +50 | runRuntimeHooks prepareRun 阶段 + systemPrompt 拼接收尾 + **M-9 内层 try-catch 包 recordExplicitContextEntries + recordLoreInjection** |
| `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | +60 | 新增 `lore_resolver_query` 工具 |

**总计**：~980 行新代码，~110 行修改（120+80+150+180+150+200+100 = 980; 50+60 = 110; 包含 M-2/M-3/M-7/M-9 增量）。**全 worktree 内**，主分支 0 改动。

---

## §7 不在范围（Out of Scope）

为防止 YAGNI，明确**不做**：

- ❌ **不**实现 LLM semantic NER（留 v4.8+）
- ❌ **不**自动从 title/aliases/slug 生成 fallback trigger（手填为唯一来源）
- ❌ **不**注入 soul.md（除非 PO V 角色 = 当前 POV 且显式 query）
- ❌ **不**实现 mtime 增量 invalidate（startup 一次构建够用）
- ❌ **不**为 `note/ / story-spec/ / instruction/` 做 lore 注入（避免 LLM 看到作者笔记）
- ❌ **不**改 `profile-context-access.ts` 现有打分逻辑（只追加 `recordContextAccess` 调用）
- ❌ **不**为 llmlint 加 `cn.structure.retrieval-trigger` 强制规则（调研报告 P1-3 范围外，列为 followup）

---

## §8 验收标准

1. **功能**：写 ch-007（含陆深/老王/飞鸟站）时，writer prompt 的 `<chapter_lore_context>` 段自动包含陆深（character）、老王（character）、飞鸟站（location）三张卡片的「基本身份」+「性格」前 3 行。**MVP-mock-verified**: harness auto-injection proven only against a mock profile with `payloadSchema: {chapterText: string}`; real `WriterPayloadSchema` has no `chapterText` (additionalProperties: false). Production wiring requires a chapter-read path or payload contract change. Explicitly deferred; harness emits a `console.warn` when chapterText absent for observability.
2. **性能**：buildIndex < 100ms，resolveForChapter < 20ms（30k 字章节），renderInjectedMarkdown < 50ms
3. **边界**：`note/ / instruction/ / story-spec/` 内容 0 出现在 prompt
4. **可降级**：lorebook 目录不存在时，harness 流程不报错
5. **可测**：6 测试文件 80% 覆盖，全套测试 < 5s
6. **可回滚**：worktree + archive 模式 + 主分支 0 push 0 merge
7. **可扩展**：未来加 `lore-resolver-semantic.ts`（LLM 版本）作为 fallback 路径，不改本设计 API

---

## §9 工作量估算

按 P1-3 调研报告 1 周工作量：

| 阶段 | 估时 |
|---|---|
| RED (写测试) | 1 天 |
| GREEN (实现) | 1.5 天 |
| 集成 (prepare-run + writer.profile) | 0.5 天 |
| archive 收尾 + 文档 | 0.5 天 |
| **总计** | **3.5 工作日** |

---

## 附录 A：与既有架构对齐

| 既有资产 | 对齐方式 |
|---|---|
| `server/agent/context-access/profile-context-access.ts` | resolver 输出推荐 path → harness 调 `recordContextAccess(signal: 'explicitInput')`；resolver **不**改打分逻辑 |
| 21 张角色卡已有 `retrieval.trigger` frontmatter | 直接消费，无需先做 migration |
| `ReadyProjectSessionRef` (project-file-index) | resolver 函数签名遵守，统一入参 |
| writer.profile 已有 `get_chapter_writer_brief` / `get_story_scene_context` | 新增 `lore_resolver_query` 与之并列 |
| archive 模式（worktree + cp + 0 push） | 全 worktree 内做，主分支 0 改动 |
| harness 集成点 | **实际集成点 = neuro-agent-harness.ts runRuntimeHooks prepareRun + systemPrompt 末尾拼**（spec §6 路径已校正） |

## 附录 B：参考

- 调研报告：`workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/research-sdd-novel-writing-2026-08-18.md` §6.3 第 3 项
- ECC `typescript/coding-style.md`：types、immutability、error handling、input validation 全部对齐
- ECC `typescript/testing.md`：80% 覆盖率 + AAA 模式
- archive 模式：`vol2-v45-archive-mode` memory
- PM2 lease 操作手册：仓 `CLAUDE.md` + `novel-frontend-display-fix-2026-08-17` memory（实施过程如触发 clean restart 必读）
