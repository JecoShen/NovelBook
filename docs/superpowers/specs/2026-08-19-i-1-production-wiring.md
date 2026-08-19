# I-1 lore-resolver production wiring — 把 MVP 接入真生产 writer

> 设计日期:2026-08-19
> 来源 spec: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` §2.4 + §8.1 (commit 831270bf + 17cc0250 defer)
> 状态: 设计 spec(待 user review)
> 目标: 把 MVP-mock-verified 的 lore 自动注入推到真生产 writer 流程, spec §8 验收 6/7 → 7/7

---

## §1 背景与现状

P1-3 lore-resolver MVP 在 worktree `feat-p1-3-lore-resolver` (commit 1b41b81b, 已 archive 收官) 完整落位:
- `lore-resolver-cache.ts` / `lore-resolver.ts` / `lore-context-injector.ts` 实现 + 6 测试文件 + i134 perf benchmark (0.01/0.22/3.31ms)
- `lore_resolver_query` 工具 spec 已设计 (§2.5) 但 writer.profile.tsx 未实施
- spec §8.1 "功能" 仍为 **PARTIAL** — auto-injection 仅 mock profile 验证

**根因** (`server/agent/profiles/builtin-contracts.ts:217`):

```typescript
export const WriterPayloadSchema = Type.Object({
    path: Type.String({...}),  // 必填: 写入目标 = manuscript/{vol}/{ch}/index.md
    chapterId: Type.Optional(Type.String({...})),
    context: Type.Optional(Type.Object({lorebookEntries, readablePaths})),
}, {additionalProperties: false});  // ← 阻塞, 不能加 chapterText 字段
```

Mock profile 测试时用 `{chapterText: string}` 作为 payload, 但**真实 `WriterPayloadSchema` 没有 `chapterText` 字段**, `additionalProperties: false` 不允许加, prepareRun 时拿不到 chapter 文本做 resolver 输入。

MVP 当前行为: 每次 prepareRun 检测到 chapterText 缺失 → `console.warn` → no-op (per 17cc0250 spec §8.1 注)。

---

## §2 设计选择

### 2.1 chapterText 候选解法对比

| 解法 | 改动面 | 风险 | 评估 |
|---|---|---|---|
| **A. chapter-read path** | writer.profile.tsx 内调 readFile(payload.path) | 低: file 不存在/小自动降级 | **选定** |
| B. 扩 WriterPayloadSchema 加 chapterText? | schema + 所有调用方 | 高: 破 additionalProperties: false, 动 leader/retriever/测试 | 否决 |
| C. 注入点挪到 leader | leader.profile + 新 prepareRun | 中: leader 无现成集成点 | 否决 |

### 2.2 集成点位置

| 候选 | 范围 | 风险 | 评估 |
|---|---|---|---|
| **A1. writer.profile.tsx context(ctx)** | 1 文件 | 低: 仅 writer profile 受益, 边界清晰 | **选定** |
| A2. neuro-agent-harness.ts prepareRun | 全局 | 中: 跨 profile 影响, leader 无 payload.path 需降级 | 否决 |

### 2.3 范围

**一次全做**: auto-injection + `lore_resolver_query` 工具(per spec §6 一次性闭环 +60 行)。拆开 I-3 有接口不匹配风险(工具依赖同一 resolver/injector)。

---

## §3 架构

```
writer.profile.tsx:async context(ctx)
    │
    ├── payload.path → readFile(target.path) → chapterText
    │                    (no-op if file 不存在 or < 100 chars)
    │
    ├── if chapterText 有效:
    │     ├── resolveForChapter({ project, chapterText, maxPaths: 8 })
    │     ├── renderInjectedMarkdown({ project, paths, maxChars: 8000 })
    │     └── 拼入 <chapter_lore_context> 段
    │
    └── [toolset] 新增 builtin 工具 lore_resolver_query(extra_triggers)
                    (handler 内调 resolveForChapter + renderInjectedMarkdown)
```

**不变量**:
- 不动 `WriterPayloadSchema` (additionalProperties: false 保持)
- 不动 `neuro-agent-harness.ts`
- 不动 resolver / cache / injector (MVP 已落位,只调不改)
- 失败一律 no-op + `console.warn` (per spec §4 降级)

---

## §4 Components

### 4.1 `writer.profile.tsx` 改动 (~80 行)

```typescript
// 1. 新增 import
import {resolveForChapter, renderInjectedMarkdown}
    from "../../../server/agent/lore/lore-resolver";  // server-side
import {buildLoreResolverIndex, invalidateLoreResolverIndex}
    from "../../../server/agent/lore/lore-resolver-cache";
import {readFile, existsSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";

// 2. 工具: lore_resolver_query
const loreResolverQueryTool = defineTool({
    name: "lore_resolver_query",
    description: "按额外实体名追加检索 lore 卡片, 写场景中如需补充设定可调用。返回 Markdown 片段。",
    inputSchema: z.object({
        extra_triggers: z.array(z.string().min(2)).min(1).max(10),
    }),
    handler: async ({extra_triggers}, ctx) => {
        const project = ctx.session.currentProject;
        if (!project) return {content: ""};
        try {
            const resolved = await resolveForChapter({
                project, chapterText: extra_triggers.join(" "), maxPaths: 4,
            });
            const injected = await renderInjectedMarkdown({
                project, paths: resolved.paths, maxChars: 4000,
            });
            return {content: injected.markdown};
        } catch (e: unknown) {
            return {content: `[lore_resolver_query failed: ${getErrorMessage(e)}]`};
        }
    },
});

// 3. tools 列表追加
tools: toolset(
    builtin.file.read, builtin.file.write, builtin.file.edit,
    builtin.file.bash, builtin.world.execute("readonly"),
    ...plotReadBindings, builtin.result.main(),
    loreResolverQueryTool,  // ★ 新增
),

// 4. buildWriterPrompt: 新增 chapterLoreContext 渲染
async function buildWriterPrompt(ctx) {
    const chapterLoreContext = await renderChapterLoreContext(ctx);  // ★ 新 helper
    ...
    <If condition={chapterLoreContext.length > 0}>
        {profileText`<chapter_lore_context>${chapterLoreContext}</chapter_lore_context>`}
    </If>
}

// 5. 新 helper (独立函数, 便于测试)
async function renderChapterLoreContext(
    ctx: ProfilePrepareContext<Initial, Payload, Settings>
): Promise<string> {
    const payload = ctx.invocation?.payload;
    if (!payload?.path) return "";
    const project = ctx.session.currentProject;
    if (!project) return "";
    try {
        const chapterText = await readFileSafely(payload.path, project);
        if (chapterText.length < 100) return "";
        const resolved = await resolveForChapter({
            project, chapterText, maxPaths: 8,
        });
        if (resolved.paths.length === 0) return "";
        const injected = await renderInjectedMarkdown({
            project, paths: resolved.paths, maxChars: 8000,
        });
        return injected.markdown;
    } catch (e: unknown) {
        console.warn("[writer.lore-injection] skipped:", getErrorMessage(e));
        return "";
    }
}
```

### 4.2 `readFileSafely(path, project)` helper (~15 行)

```typescript
async function readFileSafely(
    relativePath: string, project: ReadyProjectSessionRef
): Promise<string> {
    const absPath = join(project.workspace.ref.projectRoot, relativePath);
    if (!existsSync(absPath)) return "";  // 新章起笔
    const content = await readFile(absPath, "utf8");
    // 去掉 frontmatter 部分, 只留正文
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}
```

---

## §5 Data flow

```
writer invoke 触发
    ↓
harness → writer.profile.async context(ctx)
    ↓
buildWriterPrompt(ctx)
    ├── [existing] 拼 writingStyle / writingReference / role / thinking_protocol ...
    ├── [existing] 拼 inputContext (target_file / chapter_id / suggested_context)
    └── [NEW] renderChapterLoreContext(ctx)
            ├── readFileSafely(payload.path)
            │     ├── file 不存在 → return ""
            │     ├── 读取失败 → catch + warn → return ""
            │     └── content < 100 chars → return ""
            ├── resolveForChapter({chapterText, maxPaths: 8})
            │     ├── 命中 0 paths → return ""
            │     ├── 命中 N paths → 排序截取
            │     └── 失败 → catch + warn → return ""
            └── renderInjectedMarkdown({paths, maxChars: 8000})
                  ├── 拼 markdown <chapter_lore_context>...</chapter_lore_context>
                  └── 失败 → catch + warn → return ""
    ↓
profile DSL render 最终 prompt
    ↓
[writer agent 看到 prompt, 内有完整 lore 上下文]
    ↓
[agent 可在写中调 lore_resolver_query 追加检索]
```

**关键不变量** (carry-over from MVP):
- cache 跨 invocation 共享 (session-scoped)
- chapterText 长度 < 100 短路
- maxPaths=8, maxChars=8000 (per spec §2.2/§2.3)
- 失败一律降级, 绝不抛错 (per spec §4)

---

## §6 Error handling

| 失败场景 | 行为 | 失败模式 |
|---|---|---|
| `payload.path` 为空 / 不存在 payload | `renderChapterLoreContext` 返回 "" | 静默 no-op |
| `currentProject` 为 null | 同上 | 静默 no-op |
| file 不存在 (新章起笔) | `readFileSafely` 返回 "" | no-op (合理退化) |
| file 读取失败 (权限/IO) | catch + console.warn | 静默 + observability |
| chapterText < 100 chars | 短路 | no-op (per spec §4) |
| `resolveForChapter` 抛错 | catch + console.warn | 静默 |
| `resolveForChapter` 返回 paths=[] | return "" | no-op (无相关 lore) |
| `renderInjectedMarkdown` 抛错 | catch + console.warn | 静默 |
| `lore_resolver_query` 工具内失败 | 返回 `[lore_resolver_query failed: ...]` 文案 | tool error (不 throw) |
| `lorebook/` 目录不存在 | resolver 内部已静默降级 (per spec §4) | 静默 |
| 任何 entry index.md frontmatter 解析失败 | resolver 内部已跳过 (per spec §4) | 静默 |

**核心原则**: 任何失败都不让 writer harness 抛错, prompt 缺一段不致命。Lore 注入是"增强",不是"必需"。

---

## §7 测试

按 spec §5 + ECC `typescript/testing.md` 80% 覆盖率。

### 7.1 `writer-profile-lore-injection.test.ts` (新, ~120 行, RED→GREEN)

| 测试用例 | 覆盖 |
|---|---|
| `auto-injects lore when chapter file exists and > 100 chars` | 主路径 |
| `no-op when payload.path file does not exist (new chapter)` | 新章起笔降级 |
| `no-op when chapterText < 100 chars` | 短路 |
| `no-op when payload missing` | payload 边界 |
| `no-op when resolveForChapter returns 0 paths` | 无相关 lore |
| `does not throw when readFile fails (mock fs failure)` | IO 降级 |
| `does not throw when resolveForChapter throws` | resolver 降级 |
| `integrates <chapter_lore_context> in final prompt output` | integration 验证 (substring) |
| `toolset includes lore_resolver_query tool` | tool 注册验证 |
| `lore_resolver_query tool returns markdown for valid triggers` | 工具 happy path |
| `lore_resolver_query tool returns error message on failure` | 工具降级 |

### 7.2 不改的测试 (回归保护)

- `lore-resolver-cache.test.ts` / `lore-resolver.test.ts` / `lore-context-injector.test.ts` / `lore-perf-benchmark.test.ts` 全保持
- `writer-invoke-integration.test.ts` 全保持 (WriterPayloadSchema 未动)

### 7.3 验收映射

- spec §8.1 自动注入 3 卡片: **PARTIAL → PASS** (ch-007 写时实际注入 陆深+老王+飞鸟站)
- spec §8.2 性能: **保持 PASS** (i134 perf benchmark 0.01/0.22/3.31ms 余量巨大)
- spec §8.3-8.7: 保持 PASS

→ 验收从 **6/7** 推到 **7/7** ✅

---

## §8 文件清单 (worktree 内)

修改 1 文件:

| 文件 | 改动行 | 改动点 |
|---|---|---|
| `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | +80 | 新 import + lore_resolver_query 工具 + renderChapterLoreContext helper + readFileSafely helper |

新增 1 文件:

| 文件 | 行数估 | 用途 |
|---|---|---|
| `assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts` | ~120 | integration test 11 case |

**总计**: 1 文件改 + 1 文件新, ~200 行。**全 worktree 内**, 主分支 0 改动。

---

## §9 实施范围 (worktree + archive 模式)

| 维度 | 数据 |
|---|---|
| 新 worktree | `feat-i-1-production-wiring` 基于 main (f92ce113) |
| 改动文件 | 1 (`writer.profile.tsx` + ~80 行) |
| 新增文件 | 1 (`writer-profile-lore-injection.test.ts` + ~120 行) |
| archive 模式 | worktree 内 + cp 主工作区 + 0 push/0 merge |
| 验收 | 6/7 → **7/7** |
| 风险 | 低 — 改动 1 文件, 失败全降级 |
| 估时 | 1-2 天 (RED 半天 + GREEN 半天 + integration 半天 + 收尾) |

---

## §10 不在范围 (Out of Scope)

- ❌ LLM semantic NER (留 v4.8+ per spec §7)
- ❌ 扩 WriterPayloadSchema (本设计明确不动)
- ❌ 改 neuro-agent-harness.ts (本设计明确不动)
- ❌ leader / retriever / researcher profile 享受 lore 注入 (后续 I-2+)
- ❌ cache 主动 invalidate 机制 (per spec §7 显式排除)
- ❌ soul.md 注入 (per spec §7 显式排除)

---

## §11 与既有架构对齐

| 既有资产 | 对齐方式 |
|---|---|
| `server/agent/lore/*` (MVP) | 直接调 resolveForChapter + renderInjectedMarkdown, 不改实现 |
| `WriterPayloadSchema` (additionalProperties: false) | 严格保持, 注入点挪到 profile 内部 |
| `ReadyProjectSessionRef` (project-file-index) | helper 用同一 ref 拼绝对路径 |
| `builtin.tool` / `defineTool` (profile-sdk) | 沿用同模式, 工具放在 toolset 末尾 |
| `profile-context-access.ts` | 不动 (resolver 仍调 recordContextAccess, 沿用 MVP 集成) |
| archive 模式 (worktree + cp + 0 push) | 全 worktree 内做, 主分支 0 改动 |

---

## §12 参考

- 上游 spec: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` §2.4 + §8.1
- defer commit: `17cc0250` (I-1 spec 标 deferred)
- MVP archive: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/03-archive-lockdown.md`
- PM2 lease 操作手册: CLAUDE.md 中段
- ECC `typescript/coding-style.md` / `typescript/testing.md`: types, immutability, error handling, 80% coverage
- ECC `common/development-workflow.md`: TDD RED→GREEN→REFACTOR
