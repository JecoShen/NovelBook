# P1-3 lore-resolver.ts MVP — 按需 lore 注入

> 设计日期：2026-08-18
> 来源调研：`workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/research-sdd-novel-writing-2026-08-18.md` §6.3
> 状态：设计 spec（待 user review）
> **patch**: 2026-08-18 实施时校正 §6 文件清单 2 处路径错误 + §1 架构图 + §2.4 注释（详见 commit XXXXXXX 与 workspace/.../v45-p1-3-archive/02-patch-report.md）
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
export type LoreEntryKind =
  | "character" | "location" | "faction"
  | "event" | "item" | "world" | "system" | "spec" | "note";

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
2. 用 `fs.readdir` 遍历 `lorebook/{character,location,faction,event,item,world,system}/`（**不**遍历 `note/`、`story-spec/`、`instruction/`）
3. 每个 entry 读 `index.md` 的 frontmatter，提取 `path/kind/title/triggers/enabled`
4. `enabled === false` 跳过
5. 触发器去重 + 长度过滤（< 2 字符的 trigger 跳过，避免误伤"我"/"他"等）
6. 构建 `Map<trigger, Set<path>>` 索引

### 2.2 `lore-resolver.ts`

```typescript
export interface ResolveForChapterInput {
  readonly project: ReadyProjectSessionRef;
  readonly chapterText: string;
  /** 来自前章的「强相关」列表，优先保留 */
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
- 顺序：`character` → `location` → `faction` → `event` → `item` → `world` → `system`
- 同类型按 hits 数降序
- 累计字符数超 `maxChars` → 截断后剩余

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
    const resolved = await resolveForChapter({
      project: input.project,
      chapterText,
      carryOverPaths: input.previousChapter?.injectedPaths,
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
  }

  return prompt;
}
```

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
    → resolveForChapter(chapter.text)
        O(50段 × 200trigger × string.includes)  <10ms
    → renderInjectedMarkdown(paths)
        O(8 张卡片 × 6-8KB)  <50ms
    → 拼入 prompt <chapter_lore_context> 段

写中追加:
  agent 调用 lore_resolver_query(["顾霁", "临江嘴"])
    → resolveForChapter({ chapterText: "顾霁 临江嘴" })
    → renderInjectedMarkdown({ maxChars: 4000 })

提交:
  agent.commit
    → recordExplicitContextEntries(8 paths)  ← 进入 profile-context-access
    → 下次同项目同 profile 开新章，context-access 排序把这 8 张推为「strong」
```

**关键不变量**：
- cache 失效只在 `invalidateLoreResolverIndex(project)` 显式调用
- `note/ / story-spec/ / instruction/` **不**进索引（避免 LLM 看到「作者笔记」误读为 lore）
- 输出 Markdown **总字符数**硬上限 8000（writer prompt 配额管理）

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

**绝不让 resolver 失败导致 harness 抛错**——所有错误都是"降级到无 lore 注入"，harness 流程继续。

---

## §5 测试

按 ECC `typescript/testing.md` 80% 覆盖率 + AAA 模式：

| 测试文件 | 覆盖场景 |
|---|---|
| `lore-resolver-cache.test.ts` | (1) 扫 21 张 character 构建索引 (2) `enabled: false` 跳过 (3) 路径中含特殊字符（中文/空格） (4) frontmatter 缺字段时 defaults (5) `note/` 不进索引 |
| `lore-resolver.test.ts` | (1) 单 trigger 命中 (2) 多 trigger 命中 (3) 同一 path 多 trigger 累加 (4) 排序：命中数 DESC (5) carryOver 优先 (6) `maxPaths` 截取 (7) 空文本返回空 paths (8) 文本中 trigger 跨段不误命中 |
| `lore-context-injector.test.ts` | (1) 渲染 character/location/faction 顺序 (2) `## 基本信息` 段提取 (3) `## 性格` 段只取 3 行 (4) `maxChars` 截断 + truncatedPaths (5) frontmatter 清洗（去掉 retrieval/governance/ext） |
| `lore-resolver-integration.test.ts` | (1) build → resolve → render 全链路 (2) harness 调用注入点 mock (3) 调 `lore_resolver_query` 工具 |

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

**archive 模式**（per CLAUDE.md）：worktree `feat-p1-3-lore-resolver` + cp 主工作区，**0 push**。

---

## §6 文件清单

新增 6 文件（全部在 archive worktree 内）：

| 文件 | 行数估 | 用途 |
|---|---|---|
| `server/agent/lore/lore-resolver-cache.ts` | ~120 | in-memory 索引构建 + 查询 |
| `server/agent/lore/lore-resolver.ts` | ~80 | resolveForChapter 主函数 |
| `server/agent/lore/lore-context-injector.ts` | ~150 | 解析 index.md + 渲染 Markdown |
| `server/agent/lore/lore-resolver-cache.test.ts` | ~180 | 索引测试 |
| `server/agent/lore/lore-resolver.test.ts` | ~150 | resolver 测试 |
| `server/agent/lore/lore-context-injector.test.ts` | ~200 | injector 测试 |
| `server/agent/lore/lore-resolver-integration.test.ts` | ~100 | 集成测试 |

修改 2 文件：

| 文件 | 改动行 | 改动点 |
|---|---|---|
| `server/agent/harness/neuro-agent-harness.ts:2033` | +30 | runRuntimeHooks prepareRun 阶段 + systemPrompt 拼接收尾 |
| `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | +60 | 新增 `lore_resolver_query` 工具 |

**总计**：~1080 行新代码，~90 行修改。**全 worktree 内**，主分支 0 改动。

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

1. **功能**：写 ch-007（含陆深/老王/飞鸟站）时，writer prompt 的 `<chapter_lore_context>` 段自动包含陆深（character）、老王（character）、飞鸟站（location）三张卡片的「基本身份」+「性格」前 3 行
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
- archive 模式：CLAUDE.md 顶部段落
- PM2 lease 操作手册：CLAUDE.md 中段（实施过程如触发 clean restart 必读）
