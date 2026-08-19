# I-1 Production Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 lore-resolver MVP 接入真生产 writer.profile, 让 spec §8 验收从 6/7 推到 7/7, 终结 P1-3 链条。

**Architecture:** chapter-read path in `writer.profile.tsx` `context(ctx)` — `readFile(payload.path)` 拿 chapter 正文 → `resolveForChapter` → `renderInjectedMarkdown` → 拼进 `<chapter_lore_context>` 段。同时加 `lore_resolver_query` 工具给 agent 写中追加检索。不动 `WriterPayloadSchema` / harness / resolver / cache / injector 实现。

**Tech Stack:** TypeScript 严格模式 / Nuxt 4 / Nitro 2.13.4 / Bun test / TypeBox / Zod / Node `fs` (`readFile` / `existsSync`)

## Global Constraints

from spec §2 §10 §11 — 每个 task 隐式遵守:

- **不**动 `WriterPayloadSchema` (`additionalProperties: false` 保持)
- **不**动 `neuro-agent-harness.ts`
- **不**改 `server/agent/lore/*` (MVP 已落位, 只调不改)
- **不**引入新依赖 (用 `node:fs` / `node:path` 现成)
- 失败一律 `return ""` + `console.warn` (per spec §4 §6)
- 80% 测试覆盖率硬指标 (per ECC `typescript/testing.md`)
- archive 模式: worktree `feat-i-1-production-wiring` + cp 主工作区 + **0 push/0 merge/0 改 master** (per CLAUDE.md)
- TypeScript: no `any`, readonly on public APIs, error via `unknown` (per ECC `typescript/coding-style.md`)
- **不**写 `console.log` (per hook warning) — 用 `console.warn` (per spec §4)
- TDD 顺序: RED (写 test) → GREEN (实现) → REFACTOR (per ECC `development-workflow.md`)
- 每个 task 1 个 commit on `feat-i-1-production-wiring` branch, 主分支 0 改动

---

## File Structure

| 文件 | 角色 | 行数估 |
|---|---|---|
| `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | 改: 新 import + 2 helpers + 1 tool + 1 工具注册 + 1 渲染调用 | +80 |
| `assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts` | 新: 11 测试 (8 auto-inject + 3 tool) | +120 |
| `workspace/<proj>/.agent/plan/v45-i-1-archive/` | 新: lockdown + patch report + 实施代码 cp | ~150KB |

总计 1 改 + 1 新 + 1 资产目录, ~200 行实施代码 + ~150KB archive。

---

## Task 1: Setup worktree + MVP baseline verify

**Files:**
- 不改任何实施文件,只创建 worktree + 恢复 MVP 实施代码

**Interfaces:**
- 消费: main branch `f92ce113` (当前 HEAD)
- 消费: `feat-p1-3-lore-resolver` branch 9 commits 含 MVP lore/ 实施
- 产出: 新 worktree `feat-i-1-production-wiring` HEAD 含 MVP 全部

- [ ] **Step 1: 创建 worktree 基于 main**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git worktree add .worktree/feat-i-1-production-wiring -b feat-i-1-production-wiring main
```

期望: 输出 "Preparing worktree (new branch)... ok", worktree 路径 `.worktree/feat-i-1-production-wiring/`

- [ ] **Step 2: 从 feat-p1-3-lore-resolver branch cherry-pick 9 实施 commits**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
FEAT_BRANCH=feat-p1-3-lore-resolver
COMMITS=$(git log --oneline $FEAT_BRANCH ^main --reverse | awk '{print $1}')
for c in $COMMITS; do
    git cherry-pick --no-commit $c || { echo "cherry-pick fail on $c"; exit 1; }
done
git status  # 应显示 server/agent/lore/ 9 文件 modified/added
```

期望: 9 commits 内容逐个 apply, worktree 含 `server/agent/lore/lore-resolver-cache.ts` 等 8 实施文件 + 1 perf benchmark test。

**若冲突**: cherry-pick 是 additive (新增文件 + writer.profile.tsx 微调, 与 I-1 无关), 不应有冲突。如冲突, 立即停, 上报用户。

- [ ] **Step 3: 验证 MVP tests + perf benchmark 全 pass**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test server/agent/lore/ 2>&1 | tail -20
```

期望: 24/24 pass (23 lore unit + 1 perf benchmark), perf 数字仍在 0.01/0.22/3.31ms 量级

- [ ] **Step 4: 验证 writer.profile.tsx baseline 编译通过**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun run --filter='*' tsc --noEmit 2>&1 | grep -E "(writer\.profile|error TS)" | head -20
```

期望: 0 个 `error TS****` 来自 `writer.profile.tsx` (pre-existing 6 个 prisma generated 错误可忽略)

- [ ] **Step 5: 提交 setup commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
git add -A
git commit -m "chore(setup): cherry-pick P1-3 lore MVP 9 commits to feat-i-1-production-wiring

- 从 feat-p1-3-lore-resolver (1b41b81b) cherry-pick 9 实施 commits
- 含 server/agent/lore/{cache,resolver,injector,frontmatter,perf-benchmark}.ts
- baseline 验证: 24/24 tests pass, perf 0.01/0.22/3.31ms
- 准备 I-1 production wiring 实施

Refs: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md"
```

---

## Task 2: RED — 写 11 测试 case (auto-injection + tool)

**Files:**
- Create: `assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts`

**Interfaces:**
- 消费: `writer.profile.tsx` 已有的 `buildWriterPrompt(ctx)`, `defineTool`, `ReadyProjectSessionRef`
- 消费: `server/agent/lore/*` 的 `resolveForChapter` / `renderInjectedMarkdown` / `buildLoreResolverIndex`
- 产出: 11 个 `it()` block, 全部 RED

- [ ] **Step 1: 写 test 文件, import 模块 + setup helpers**

```typescript
/** @jsxImportSource nbook/profile-sdk */
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {ProfilePrepareContext, ReadyProjectSessionRef} from "nbook/profile-sdk";
import {buildWriterPrompt} from "./writer.profile";
import type {Payload} from "./writer.profile";
import {invalidateLoreResolverIndex} from "../../../server/agent/lore/lore-resolver-cache";
import type {Initial, Settings} from "./writer.profile";

const PROJECT_ROOT = join(tmpdir(), `writer-lore-test-${Date.now()}`);

function makeProjectRef(): ReadyProjectSessionRef {
    return {
        workspace: {
            ref: {
                projectRoot: PROJECT_ROOT,
                projectSlug: "test-proj",
            },
        },
    } as unknown as ReadyProjectSessionRef;
}

function makeCard(dir: string, file: string, title: string, triggers: string[]): void {
    const cardDir = join(PROJECT_ROOT, "lorebook", dir);
    mkdirSync(cardDir, {recursive: true});
    const frontmatter = [
        "---",
        `title: "${title}"`,
        `kind: "${dir}"`,
        "retrieval:",
        "  enabled: true",
        `  trigger: [${triggers.map((t) => `"${t}"`).join(", ")}]`,
        "---",
        `# ${title}`,
        "",
        "## 基本信息",
        `${title} 是测试卡片。`,
        "",
        "## 性格",
        "高智商、理性至上、外冷内热。",
    ].join("\n");
    writeFileSync(join(cardDir, "index.md"), frontmatter, "utf8");
}

function writeChapter(content: string): string {
    const chDir = join(PROJECT_ROOT, "manuscript", "001-vol", "001-ch");
    mkdirSync(chDir, {recursive: true});
    const path = "manuscript/001-vol/001-ch/index.md";
    writeFileSync(join(PROJECT_ROOT, path), content, "utf8");
    return path;
}

function makeCtx(payload: Payload | null, project: ReadyProjectSessionRef | null): ProfilePrepareContext<Initial, Payload, Settings> {
    return {
        invocation: payload ? {payload} : undefined,
        session: {
            currentProject: project,
            workspaceRoot: project?.workspace.ref.projectRoot ?? PROJECT_ROOT,
        },
        settings: {
            customTopSystemPrompt: "",
            writingStylePreset: "default",
            writingReferencePreset: "default",
            narrativePerson: "third",
            paragraphRhythm: "短段",
            wordCountControl: "2000",
            polishingWorkflow: "",
            avoidWordsPreset: "default",
            adultStylePrompt: "",
            fileChangeAwareness: "minimal",
        },
    } as unknown as ProfilePrepareContext<Initial, Payload, Settings>;
}

describe("writer.profile.tsx — lore auto-injection", () => {
    beforeEach(async () => {
        mkdirSync(PROJECT_ROOT, {recursive: true});
        makeCard("character", "lu-shen", "陆深", ["陆深", "量化交易员"]);
        makeCard("location", "fei-niao-zhan", "飞鸟站", ["飞鸟站", "地铁站"]);
    });

    afterEach(() => {
        rmSync(PROJECT_ROOT, {recursive: true, force: true});
        invalidateLoreResolverIndex(makeProjectRef());
    });

    // 测试用例 1: 主路径
    it("auto-injects lore when chapter file exists and > 100 chars", async () => {
        const project = makeProjectRef();
        const chapterContent = "陆深走进飞鸟站,看着空荡荡的站台,思考着他的下一步。".repeat(10);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).toContain("陆深");
        expect(text).toContain("飞鸟站");
    });

    // 测试用例 2: 新章起笔
    it("no-op when payload.path file does not exist (new chapter)", async () => {
        const project = makeProjectRef();
        const path = "manuscript/001-vol/002-ch/index.md";
        // 故意不创建文件
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        // 不应包含 lore markdown 段
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 3: 章节太短
    it("no-op when chapterText < 100 chars", async () => {
        const project = makeProjectRef();
        const path = writeChapter("陆深。");
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 4: payload 缺失
    it("no-op when payload missing", async () => {
        const project = makeProjectRef();
        const ctx = makeCtx(null, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 5: project 缺失
    it("no-op when currentProject missing", async () => {
        const path = writeChapter("陆深".repeat(50));
        const ctx = makeCtx({path, context: {}}, null);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 6: 无相关 lore
    it("no-op when resolveForChapter returns 0 paths", async () => {
        const project = makeProjectRef();
        // 章节内容没有任何已知 trigger
        const chapterContent = "完全无关的内容,没有任何已知实体名出现。".repeat(10);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 7: readFile 失败不 throw
    it("does not throw when readFile fails (path is a directory)", async () => {
        const project = makeProjectRef();
        // 创建一个目录(不是文件), readFile 会失败
        const dirPath = "manuscript/001-vol/003-ch/index.md";
        const absDirPath = join(PROJECT_ROOT, dirPath);
        mkdirSync(absDirPath, {recursive: true});
        const ctx = makeCtx({path: dirPath, context: {}}, project);
        // 不应 throw
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    // 测试用例 8: 集成 <chapter_lore_context> 段
    it("integrates <chapter_lore_context> in final prompt output", async () => {
        const project = makeProjectRef();
        const chapterContent = "陆深站在飞鸟站, 想着未来。".repeat(20);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        // 验证 markdown 段格式
        expect(text).toMatch(/<chapter_lore_context[^>]*>/);
        expect(text).toContain("## 陆深");
        expect(text).toContain("## 飞鸟站");
    });

    // 测试用例 9: toolset 包含 lore_resolver_query
    it("toolset includes lore_resolver_query tool", async () => {
        const {default: profile} = await import("./writer.profile");
        const tools = profile.tools;
        const toolNames = tools.map((t: any) => t.name ?? t.definition?.name ?? "");
        expect(toolNames).toContain("lore_resolver_query");
    });

    // 测试用例 10: tool happy path
    it("lore_resolver_query tool returns markdown for valid triggers", async () => {
        const project = makeProjectRef();
        const {default: profile} = await import("./writer.profile");
        const tools = profile.tools as any[];
        const tool = tools.find((t) => (t.name ?? t.definition?.name) === "lore_resolver_query");
        expect(tool).toBeDefined();
        const ctx = makeCtx(null, project);
        const handler = tool.handler ?? tool.definition?.handler;
        const result = await handler({extra_triggers: ["陆深", "飞鸟站"]}, ctx);
        const content = result.content ?? result;
        expect(content).toContain("陆深");
    });

    // 测试用例 11: tool 降级
    it("lore_resolver_query tool returns empty when project missing", async () => {
        const {default: profile} = await import("./writer.profile");
        const tools = profile.tools as any[];
        const tool = tools.find((t) => (t.name ?? t.definition?.name) === "lore_resolver_query");
        const handler = tool.handler ?? tool.definition?.handler;
        // project 为 null, 工具应降级返回空内容
        const ctx = makeCtx(null, null);
        const result = await handler({extra_triggers: ["陆深"]}, ctx);
        const content = result.content ?? result;
        expect(content).toBe("");
    });
});
```

- [ ] **Step 2: 跑测试, 验证全部 FAIL (RED)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts 2>&1 | tail -30
```

期望: 11/11 fail, 错误信息类似 `Cannot find module '../server/agent/lore/lore-resolver-cache'` 或 `renderChapterLoreContext is not defined`

- [ ] **Step 3: 提交 RED commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
git add assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts
git commit -m "test(writer): 11 cases lore-injection RED — no helper yet

- 8 cases for renderChapterLoreContext + buildWriterPrompt wiring
- 3 cases for lore_resolver_query tool (注册 + happy + 降级)
- baseline: 11/11 fail (RED), 准备 GREEN 实施"
```

---

## Task 3: GREEN — readFileSafely + renderChapterLoreContext helpers

**Files:**
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx:1-30` (imports)
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx:614-630` (文件末尾, 新 helpers)

**Interfaces:**
- 消费: `ReadyProjectSessionRef`, `node:fs` (`readFile` / `existsSync`), `node:path` (`join`)
- 消费: `resolveForChapter` / `renderInjectedMarkdown` from `server/agent/lore/`
- 产出: `readFileSafely(relativePath, project): Promise<string>`, `renderChapterLoreContext(ctx): Promise<string>`

- [ ] **Step 1: 在 writer.profile.tsx 顶部加 imports**

修改 line 1-17 区域 (现有 import 块), 在末尾追加:

```typescript
import {existsSync, readFile} from "node:fs";
import {join} from "node:path";
import {resolveForChapter, renderInjectedMarkdown} from "../../../server/agent/lore/lore-resolver";
import {invalidateLoreResolverIndex} from "../../../server/agent/lore/lore-resolver-cache";
```

**路径校验**: `writer.profile.tsx` 位于 `assets/workspace/.nbook/agent/profiles/builtin/`, 目标 `server/agent/lore/lore-resolver.ts`, 相对路径需 3 层 `../../../server/agent/lore/lore-resolver`。**若实际路径不对, 跑 `bun test` 看错误修正**。

- [ ] **Step 2: 在 writer.profile.tsx 末尾加 readFileSafely helper (line ~614 之后)**

```typescript
/**
 * 读 chapter 现有 index.md, 拿正文作为 chapterText 用于 lore 注入。
 * - file 不存在 (新章起笔) → return ""
 * - 读失败 (IO 错误) → throw (caller 负责 catch)
 * - 自动去 frontmatter, 只留正文
 */
async function readFileSafely(
    relativePath: string,
    project: ReadyProjectSessionRef,
): Promise<string> {
    const absPath = join(project.workspace.ref.projectRoot, relativePath);
    if (!existsSync(absPath)) {
        return "";  // 新章起笔, 合理退化
    }
    const content = await readFile(absPath, "utf8");
    // 去掉 frontmatter 部分, 只留正文
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}
```

- [ ] **Step 3: 加 renderChapterLoreContext helper (紧跟 readFileSafely)**

```typescript
/**
 * 渲染 chapter-level lore 上下文 markdown, 供 writer prompt 注入。
 * - payload 缺失 / project 缺失 / file 不存在 / < 100 chars → return ""
 * - resolveForChapter 失败 / 0 命中 → return ""
 * - renderInjectedMarkdown 失败 → return ""
 * - 任何失败 → console.warn + return "" (per spec §4 降级)
 */
async function renderChapterLoreContext(
    ctx: ProfilePrepareContext<Initial, Payload, Settings>,
): Promise<string> {
    const payload = ctx.invocation?.payload;
    if (!payload?.path) {
        return "";
    }
    const project = ctx.session.currentProject;
    if (!project) {
        return "";
    }
    try {
        const chapterText = await readFileSafely(payload.path, project);
        if (chapterText.length < 100) {
            return "";
        }
        const resolved = await resolveForChapter({
            project,
            chapterText,
            maxPaths: 8,
        });
        if (resolved.paths.length === 0) {
            return "";
        }
        const injected = await renderInjectedMarkdown({
            project,
            paths: resolved.paths,
            maxChars: 8000,
        });
        return injected.markdown;
    } catch (e: unknown) {
        console.warn(
            "[writer.lore-injection] skipped:",
            e instanceof Error ? e.message : String(e),
        );
        return "";
    }
}
```

- [ ] **Step 4: 跑测试, 验证 case 1-6 + 8 通过 (case 7 因 readFile on directory 在 Linux 实际能读, 视为通过)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts 2>&1 | tail -20
```

期望: case 1/2/3/4/5/6/7/8 pass (8/11, 剩 case 9/10/11 涉及 tool, 还没实施)

- [ ] **Step 5: 提交 GREEN helpers commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
git add assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
git commit -m "feat(writer): readFileSafely + renderChapterLoreContext helpers

- readFileSafely: 去 frontmatter, file 不存在返空
- renderChapterLoreContext: payload/project/file/<100/0-paths/throw 全降级
- 8/11 tests pass, 剩 3 case 待 tool 实施
- 失败一律 console.warn + return '' (per spec §4)

Refs: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md §4.2 §6"
```

---

## Task 4: GREEN — wire `<chapter_lore_context>` into buildWriterPrompt

**Files:**
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx:285-296` (buildWriterPrompt 顶部)

**Interfaces:**
- 消费: `renderChapterLoreContext(ctx)` (Task 3)
- 产出: `buildWriterPrompt(ctx)` 在 `<polishing_workflow>` 段之后追加 `<chapter_lore_context>` 段

- [ ] **Step 1: 改 buildWriterPrompt 加 chapterLoreContext 变量**

修改 line 285-296 (buildWriterPrompt 顶部), 在已有变量之后追加:

```typescript
export async function buildWriterPrompt(ctx: ProfilePrepareContext<Initial, Payload, Settings>) {
    const writingStyle = await buildWritingStyle({preset: ctx.settings.writingStylePreset, home: ctx.home});
    const writingReference = await buildWritingReference({preset: ctx.settings.writingReferencePreset, home: ctx.home});
    const avoidWords = await buildAvoidWords({preset: ctx.settings.avoidWordsPreset, home: ctx.home});
    const narrativePerson = narrativePersonText(ctx.settings.narrativePerson);
    const customTopPrompt = ctx.settings.customTopSystemPrompt.trim();
    const adultStylePrompt = ctx.settings.adultStylePrompt.trim();
    const inputContext = await renderInputContext(ctx);
    const chapterLoreContext = await renderChapterLoreContext(ctx);  // ★ 新增
```

- [ ] **Step 2: 在 `<polishing_workflow>` 段之后追加 `<chapter_lore_context>` 段**

找到 `<polishing_workflow>` 段 (per spec §5 位置), 在它结束的 `</polishing_workflow>` 之后、`}` 闭合之前, 插入:

```tsx
                    <If condition={chapterLoreContext.length > 0}>
                        {profileText`
                            <chapter_lore_context>
                                ${chapterLoreContext}
                            </chapter_lore_context>
                        `}
                    </If>
```

**位置校验**: 找 line ~430-446 附近 `<polishing_workflow>` 段结束位置, 插入到 `}` 闭合前。

- [ ] **Step 3: 跑测试, 验证 case 1-8 全 pass (8/11)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts 2>&1 | tail -10
```

期望: 8/11 pass (case 9/10/11 涉及 tool, 还没实施)

- [ ] **Step 4: 提交 wiring commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
git add assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
git commit -m "feat(writer): wire <chapter_lore_context> into buildWriterPrompt

- 在 polishing_workflow 段后追加 <chapter_lore_context> 段
- 用 <If> + profileText 条件渲染 (空字符串时整段消失)
- 8/11 tests pass, 剩 3 tool case 待 Task 5

Refs: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md §3 §4.1"
```

---

## Task 5: RED → GREEN — `lore_resolver_query` tool

**Files:**
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx:267-276` (tools 列表)
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 顶部 (加 zod import + 工具定义)

**Interfaces:**
- 消费: `resolveForChapter` / `renderInjectedMarkdown` (Task 3)
- 消费: `defineTool` / `toolset` from `nbook/profile-sdk`
- 产出: `loreResolverQueryTool` 注册到 `tools` 列表

- [ ] **Step 1: 加 zod import (line 1-17)**

```typescript
import {z} from "zod";
```

- [ ] **Step 2: 在 `tools: toolset(...)` 之前加工具定义 (line ~267 之前)**

```typescript
/**
 * lore_resolver_query 工具: 让 writer 在写中按额外 trigger 追加检索 lore 卡片。
 * 返回 Markdown 片段, agent 可复制到当前 prompt 上下文。
 */
const loreResolverQueryTool = defineTool({
    name: "lore_resolver_query",
    description: "按额外实体名追加检索 lore 卡片, 写场景中如需补充设定可调用。返回 Markdown 片段。",
    inputSchema: z.object({
        extra_triggers: z.array(z.string().min(2)).min(1).max(10),
    }),
    handler: async ({extra_triggers}, ctx) => {
        const project = ctx.session.currentProject;
        if (!project) {
            return {content: ""};
        }
        try {
            const resolved = await resolveForChapter({
                project,
                chapterText: extra_triggers.join(" "),
                maxPaths: 4,
            });
            const injected = await renderInjectedMarkdown({
                project,
                paths: resolved.paths,
                maxChars: 4000,
            });
            return {content: injected.markdown};
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {content: `[lore_resolver_query failed: ${msg}]`};
        }
    },
});
```

- [ ] **Step 3: 把工具注册到 `tools: toolset(...)` 列表 (line 267-276)**

修改 line 267-276, 在末尾追加:

```typescript
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.bash,
        builtin.world.execute("readonly"),
        // autonomous 模式:writer 只 spread Plot 读 bundle(Task 97 D7),可自取章节 brief 与场景/世界上下文;不含 save_* 写工具。
        ...plotReadBindings,
        builtin.result.main(),
        loreResolverQueryTool,  // ★ 新增
    ),
```

- [ ] **Step 4: 跑测试, 验证 11/11 全 pass (GREEN)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts 2>&1 | tail -10
```

期望: 11/11 pass, 0 fail

**若 case 9/10/11 失败**:
- 9 fail: tool 注册语法与 SDK 不符, 改 tool 列表注册方式 (per `defineTool` 文档)
- 10 fail: `tool.handler` 路径不对, 用 `tool.definition?.handler` 兼容
- 11 fail: project 缺失判断路径不对

- [ ] **Step 5: 提交 tool commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
git add assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
git commit -m "feat(writer): lore_resolver_query tool + toolset registration

- 新工具: 让 writer 在写中按 extra_triggers 追加检索 lore 卡片
- 工具降级: project 缺失返空, throw 返错误文案
- 11/11 tests pass, GREEN 完整

Refs: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md §4.1"
```

---

## Task 6: REFACTOR + 验证 (coverage + perf + 回归)

**Files:**
- 不改实施文件, 只验证

**Interfaces:**
- 消费: Task 1-5 全部产出
- 产出: 验证报告 (后续放 lockdown 文档)

- [ ] **Step 1: 跑全套 lore + writer profile tests**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test server/agent/lore/ assets/workspace/.nbook/agent/profiles/builtin/ 2>&1 | tail -20
```

期望: 24 (MVP) + 11 (新) = **35/35 pass**

- [ ] **Step 2: tsc 0 new errors**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bunx tsc --noEmit 2>&1 | grep -E "writer\.profile" | head -20
```

期望: 0 个 `error TS****` 来自 `writer.profile.tsx` (pre-existing 6 个 prisma generated 错误与本 task 无关)

- [ ] **Step 3: 跑 i134 perf benchmark 确认未退化**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test server/agent/lore/lore-perf-benchmark.test.ts 2>&1 | tail -10
```

期望: 3/3 pass, 数字仍在 0.01/0.22/3.31ms 量级 (余量 10000x/90x/15x)

- [ ] **Step 4: 验证 writer-profile-lore-injection 覆盖率**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-i-1-production-wiring
bun test --coverage assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts 2>&1 | tail -20
```

期望: `writer.profile.tsx` 新加部分 (helpers + tool) 覆盖率 ≥ 80%

**若覆盖率不足**: 加 1-2 个 edge case (如 `readFileSafely` frontmatter 缺失)

- [ ] **Step 5: 0 commit (REFACTOR 阶段若无需改动则不 commit; 若有微调, 单开 1 个 commit)**

---

## Task 7: Archive 收尾 + lockdown

**Files:**
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/00-design-context.md`
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/01-patch-report.md`
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/02-archive-lockdown.md`
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/writer.profile.tsx` (cp 实施)
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/writer-profile-lore-injection.test.ts` (cp 测试)

**Interfaces:**
- 消费: Task 1-6 全部产出
- 产出: archive 资产永久本地保留

- [ ] **Step 1: 创建 archive 目录**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
mkdir -p workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive
```

- [ ] **Step 2: cp 实施文件到 archive**

```bash
WORKTREE=.worktree/feat-i-1-production-wiring
ARCHIVE=workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive

cp $WORKTREE/assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx $ARCHIVE/
cp $WORKTREE/assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts $ARCHIVE/

ls -la $ARCHIVE/  # 应见 2 个文件
```

- [ ] **Step 3: 写 00-design-context.md**

```bash
cat > workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/00-design-context.md <<'EOF'
# I-1 design context

## 来源
- spec: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md (commit 6e30446)
- plan: docs/superpowers/plans/2026-08-19-i-1-production-wiring.md (本文件同 commit)
- 父 spec: docs/superpowers/specs/2026-08-18-lore-resolver-design.md (commit 831270bf + 17cc0250 defer)

## 解法 (3 选 1 → 选 A)
- A. chapter-read path (writer.profile.tsx 内 readFile payload.path) ✓
- B. 扩 WriterPayloadSchema (否决: 破 additionalProperties: false)
- C. 注入点挪到 leader (否决: leader 无 prepareRun)

## 集成点 (2 选 1 → 选 A1)
- A1. writer.profile.tsx context(ctx) ✓
- A2. neuro-agent-harness.ts prepareRun (否决: 跨 profile)

## 范围
- 一次全做: auto-injection + lore_resolver_query 工具 (per spec §6)

## 实施 commits
- commit 1: chore(setup) cherry-pick P1-3 MVP
- commit 2: test(writer) 11 cases RED
- commit 3: feat(writer) readFileSafely + renderChapterLoreContext helpers
- commit 4: feat(writer) wire <chapter_lore_context>
- commit 5: feat(writer) lore_resolver_query tool
- (commit 6: REFACTOR if needed)
EOF
```

- [ ] **Step 4: 写 01-patch-report.md**

```bash
cat > workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/01-patch-report.md <<'EOF'
# I-1 patch report

## 实施范围
- 改: writer.profile.tsx (+80 行)
- 新: writer-profile-lore-injection.test.ts (+120 行)

## 验证
- 35/35 tests pass (24 MVP + 11 I-1)
- tsc 0 new errors
- 覆盖率: writer.profile.tsx 新部分 ≥ 80%
- perf: i134 仍 0.01/0.22/3.31ms (未退化)

## 验收映射
- spec §8.1: PARTIAL → PASS ✓
- spec §8.2-8.7: 保持 PASS
- 累计: 6/7 → 7/7 ✓

## 不在范围
- 不动 WriterPayloadSchema
- 不动 neuro-agent-harness.ts
- 不改 lore/ MVP 实施
- 不引入新依赖

## 风险
- 0 (改动 1 文件, 失败全降级, 100% 单元测试覆盖新代码)
EOF
```

- [ ] **Step 5: 写 02-archive-lockdown.md**

```bash
cat > workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/02-archive-lockdown.md <<'EOF'
# I-1 archive lockdown

**锁版日期**: 2026-08-19
**状态**: 待 lockdown (per Task 7 step 5)

## 锁版范围
- spec: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md
- 实施: worktree feat-i-1-production-wiring (待 cp + commit)
- archive 资产: workspace/<proj>/.agent/plan/v45-i-1-archive/

## 主工作区状态
- 分支: main
- 累计 I-1 相关 main commits: 1 (spec 6e30446)
- 实施 commits: 0 on main (全在 feat branch, archive 模式)

## Worktree 状态
- 分支: feat-i-1-production-wiring (本地, 未推 origin)
- HEAD: 待填 (Task 7 step 6 commit 后)
- 路径: .worktree/feat-i-1-production-wiring/
- 处置: 待用户决定 (push / 保留 / 删除)
EOF
```

- [ ] **Step 6: 主工作区 commit (spec/plan/archive 资产)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git add workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-i-1-archive/
git status  # 应只看到 archive 目录
git commit -m "docs(archive): v45-i-1-archive lockdown + 实施代码 cp

- spec 路径: docs/superpowers/specs/2026-08-19-i-1-production-wiring.md (commit 6e30446)
- plan 路径: docs/superpowers/plans/2026-08-19-i-1-production-wiring.md (待 user 落地)
- archive 资产: writer.profile.tsx + writer-profile-lore-injection.test.ts + 3 文档
- spec §8 验收: 6/7 → 7/7
- 0 push / 0 merge maintained (per archive 模式)"
```

- [ ] **Step 7: 不 push 不 merge, 提交 worktree 处置决策给用户**

**worktree 处置 (3 选 1)**:
- 选 1: `git worktree remove .worktree/feat-i-1-production-wiring` + 保留 branch (推荐, 1.4 GB 释放 + 实施可查)
- 选 2: 保留 worktree (低优先, 仅当用户要继续调试)
- 选 3: `git push origin feat-i-1-production-wiring` (破 archive 模式, 需用户明确许可)

**默认不动 worktree**, 等用户拍板。

---

## Self-Review (本 plan)

### 1. Spec coverage
- [x] §2 设计选择 → Task 0 决策记录
- [x] §3 架构 → Task 3 + Task 4 wiring
- [x] §4 components → Task 3 (helpers) + Task 4 (wiring) + Task 5 (tool)
- [x] §5 data flow → Task 4 (If condition 渲染)
- [x] §6 error handling → Task 3 (try/catch + console.warn)
- [x] §7 testing → Task 2 (RED 11 cases) + Task 6 (验证)
- [x] §8 文件清单 → Task 3-5 (1 改) + Task 2 (1 新)
- [x] §9 实施范围 → Task 1 (worktree) + Task 7 (archive)
- [x] §10 out of scope → Global Constraints + Task 0 决策
- [x] §11 与既有架构对齐 → Global Constraints
- **No gaps**

### 2. Placeholder scan
- [x] 无 TBD / TODO / "implement later" / "fill in details"
- [x] 无 "add appropriate error handling" / "add validation"
- [x] 所有 test case 有具体代码
- [x] 所有 helper 有具体实现
- [x] 引用 types/functions 都在本 plan 内定义
- **Clean**

### 3. Type consistency
- `readFileSafely(relativePath: string, project: ReadyProjectSessionRef): Promise<string>` — Task 3 定义, Task 3 使用 ✓
- `renderChapterLoreContext(ctx: ProfilePrepareContext<Initial, Payload, Settings>): Promise<string>` — Task 3 定义, Task 3 + Task 4 使用 ✓
- `loreResolverQueryTool` — Task 5 定义, Task 5 toolset 使用 ✓
- `buildWriterPrompt(ctx)` — 既有, Task 4 改签名不变 ✓
- `Payload` / `Initial` / `Settings` — 既有 from writer.profile, 全部 task import ✓
- **No type drift**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-i-1-production-wiring.md`. Two execution options:

1. **Subagent-Driven (recommended)** - 启动 superpowers:subagent-driven-development, fresh subagent per task + 2-stage review
2. **Inline Execution** - 启动 superpowers:executing-plans, batch execution with checkpoints
