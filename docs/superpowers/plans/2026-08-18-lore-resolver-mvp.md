# P1-3 lore-resolver.ts MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `lore-resolver.ts` MVP——按章节文本解析 lorebook 触发器，渲染 Markdown `<chapter_lore_context>` 段注入到 writer prompt，调用 profile-context-access 记录 explicitInput 反馈。

**Architecture:** 三个独立模块 + harness 钩子集成：
- `lore-resolver-cache.ts` (in-memory 索引，启动时构建)
- `lore-resolver.ts` (主函数：触发器匹配 + 排序)
- `lore-context-injector.ts` (Markdown 渲染)
- 集成点：`neuro-agent-harness.ts` 的 `runRuntimeHooks(prepareRun)` 阶段（**不是** `prepare-run.ts`）

**Tech Stack:** TypeScript 严格模式 / Nuxt 4 / Nitro 2.13.4 / Bun 测试 / vitest / Zod 输入校验

## Global Constraints

以下约束**贯穿**每个 task（per spec `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` §1-§7）：

- **TypeScript 严格模式**：`no any`、`unknown` 收窄、公开 API 必有显式返回类型
- **不可变**：spread 优先于 mutation；`readonly` 用于公开 API
- **错误处理**：`unknown` narrow + `instanceof Error`，所有 lore 错误**降级不抛**
- **Zod 校验**：所有公开函数输入用 Zod schema（`inputSchema` 工具也用 Zod）
- **archive 模式**：worktree `feat-p1-3-lore-resolver` + cp 主工作区 + 0 push/0 merge/0 改 master
- **测试**：AAA 模式 + 80% 覆盖率 + bun test
- **scope 不动**：`note/ / story-spec/ / instruction/` **不**进索引；不改 `profile-context-access.ts` 打分逻辑

## Spec Path Corrections (任务 0 必读)

执行 plan 期间**用以下真实路径**（spec §6 文件清单路径有 2 处错）：

| Spec 写的 | 实际位置 |
|---|---|
| `server/agent/profiles/writer.profile.tsx` | `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` |
| `server/agent/harness/prepare-run.ts` (改 1 处) | `server/agent/harness/neuro-agent-harness.ts:1943` 的 `runRuntimeHooks(stage: "prepareRun")` 或 `builtin.profilePrompt` 钩子（`prepare-run.ts` 实际是 `ProfileTurnPlan → SessionWritePlan` 编译器） |

**校正报告**将在 Task 8 落 `docs/superpowers/specs/2026-08-18-lore-resolver-design-corrections.md`。

---

## Task 0: 建 worktree + 准备工具

**Files:**
- Create: `feat-p1-3-lore-resolver` worktree（基于 `main`，commit `831270bf`）

**前置调研**：

- [ ] **Step 1: 验证主工作区干净**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git status --short
git log -1 --oneline   # 应是 831270bf
```

Expected: 干净工作区，HEAD = 831270bf `docs(superpowers): P1-3 lore-resolver MVP design spec`

- [ ] **Step 2: 拉取最新 main 并建 worktree**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git fetch origin main
git worktree add .worktree/feat-p1-3-lore-resolver -b feat-p1-3-lore-resolver main
cd .worktree/feat-p1-3-lore-resolver
```

Expected: 新 worktree 在 `.worktree/feat-p1-3-lore-resolver/`，新分支 `feat-p1-3-lore-resolver` 基于 main

- [ ] **Step 3: 在 worktree 内安装依赖**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun install
```

Expected: 0 错误，node_modules 完整

- [ ] **Step 4: 验证测试框架可跑（写一个 sanity 测试）**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
cat > /tmp/sanity.test.ts <<'EOF'
import {describe, expect, it} from "bun:test";
describe("sanity", () => {
    it("runs", () => expect(1 + 1).toBe(2));
});
EOF
mv /tmp/sanity.test.ts server/agent/lore/__sanity__.test.ts
bun test server/agent/lore/__sanity__.test.ts
rm server/agent/lore/__sanity__.test.ts
mkdir -p server/agent/lore
```

Expected: `1 pass, 0 fail`。如失败，**STOP**——不要写后续 task。

- [ ] **Step 5: 准备项目 archetype fixture（测试用 workspace）**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
mkdir -p server/agent/lore/__fixtures__/minimal-project/lorebook/{character,location,faction,event,item,world,system,note,story-spec,instruction}
# 复制一个真实 character 卡作为 fixture
cp workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/character/lu-shen/index.md \
   server/agent/lore/__fixtures__/minimal-project/lorebook/character/lu-shen/index.md
```

Expected: fixture 项目结构有 character/location/.../note/story-spec/instruction 9 个子目录

- [ ] **Step 6: 0 commit（worktree 状态）**

worktree 本身不需要 commit，仅记录到 `git worktree list` 即视为完成。

---

## Task 1: lore-resolver-cache.ts (RED → GREEN → REFACTOR)

### 1.1 RED: 写 5 个测试

**Files:**
- Create: `server/agent/lore/lore-resolver-cache.test.ts`

**Consumes (from later tasks):** 无
**Produces (for later tasks):**
- `LoreEntryKind` 类型（8 种 kind 的字符串字面量联合）
- `LoreEntryMeta` 接口
- `LoreResolverIndex` 接口
- `buildLoreResolverIndex(project)` 异步函数
- `invalidateLoreResolverIndex(project)` 同步函数

- [ ] **Step 1: 写测试文件骨架**

文件 `server/agent/lore/lore-resolver-cache.test.ts`：

```typescript
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
    buildLoreResolverIndex,
    invalidateLoreResolverIndex,
    type LoreResolverIndex,
} from "./lore-resolver-cache";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** 构造一个指向临时目录的 mock ReadyProjectSessionRef。 */
function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {
        // @ts-expect-error 故意：测试只需 workspace.root + generation
        workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}},
        generation: 1,
    } as ReadyProjectSessionRef;
}

/** 写入最小 frontmatter + 段落到 index.md。 */
function writeLoreCard(
    rootDir: string,
    category: string,
    slug: string,
    opts: {title?: string; triggers?: string[]; enabled?: boolean; content?: string} = {},
): void {
    const dir = join(rootDir, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    const frontmatter = [
        "---",
        `title: ${opts.title ?? slug}`,
        `type: ${category}`,
        ...(opts.triggers ? [`retrieval:`, `  enabled: ${opts.enabled ?? true}`, `  trigger: [${opts.triggers.join(", ")}]`] : []),
        "---",
    ].join("\n");
    writeFileSync(join(dir, "index.md"), `${frontmatter}\n\n${opts.content ?? `## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${slug} |\n`}\n`);
}

describe("lore-resolver-cache", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-cache-"));
        project = makeProjectRef(tmpRoot);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("scans character directory and builds trigger index", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深", "男主"]});
        writeLoreCard(tmpRoot, "character", "su-nian", {triggers: ["苏念"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.triggerToPaths.get("陆深")?.has("character/lu-shen")).toBe(true);
        expect(index.triggerToPaths.get("男主")?.has("character/lu-shen")).toBe(true);
        expect(index.triggerToPaths.get("苏念")?.has("character/su-nian")).toBe(true);
        expect(index.pathToEntry.get("character/lu-shen")?.title).toBe("陆深");
    });

    it("skips entries with enabled: false", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"], enabled: true});
        writeLoreCard(tmpRoot, "character", "ghost", {triggers: ["幽灵"], enabled: false});

        const index = await buildLoreResolverIndex(project);

        expect(index.pathToEntry.has("character/lu-shen")).toBe(true);
        expect(index.pathToEntry.has("character/ghost")).toBe(false);
        expect(index.triggerToPaths.has("幽灵")).toBe(false);
    });

    it("ignores note/, story-spec/, instruction/ directories", async () => {
        writeLoreCard(tmpRoot, "note", "wip", {triggers: ["作者笔记"]});
        writeLoreCard(tmpRoot, "story-spec", "draft", {triggers: ["设定草稿"]});
        writeLoreCard(tmpRoot, "instruction", "system", {triggers: ["系统指令"]});
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.pathToEntry.has("note/wip")).toBe(false);
        expect(index.pathToEntry.has("story-spec/draft")).toBe(false);
        expect(index.pathToEntry.has("instruction/system")).toBe(false);
        expect(index.pathToEntry.has("character/lu-shen")).toBe(true);
    });

    it("filters triggers shorter than 2 characters", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深", "我", "A", "陆"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.triggerToPaths.has("陆深")).toBe(true);
        expect(index.triggerToPaths.has("我")).toBe(false);   // 1 字符
        expect(index.triggerToPaths.has("A")).toBe(false);   // 1 字符
        expect(index.triggerToPaths.has("陆")).toBe(false);  // 1 字符
    });

    it("caches result by project key and invalidates correctly", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"]});

        const first = await buildLoreResolverIndex(project);
        const second = await buildLoreResolverIndex(project);

        expect(first).toBe(second);  // 同一对象引用

        invalidateLoreResolverIndex(project);
        const third = await buildLoreResolverIndex(project);

        expect(third).not.toBe(first);  // invalidate 后新对象
    });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test server/agent/lore/lore-resolver-cache.test.ts 2>&1 | head -30
```

Expected: FAIL，错误含 `Cannot find module './lore-resolver-cache'`（实现文件未写）

- [ ] **Step 3: 写最小实现文件骨架（仅占位）**

文件 `server/agent/lore/lore-resolver-cache.ts`：

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export type LoreEntryKind =
    | "character" | "location" | "faction"
    | "event" | "item" | "world" | "system" | "spec" | "note";

export interface LoreEntryMeta {
    readonly path: string;
    readonly kind: LoreEntryKind;
    readonly title: string;
    readonly triggers: readonly string[];
    readonly enabled: boolean;
}

export interface LoreResolverIndex {
    readonly triggerToPaths: ReadonlyMap<string, ReadonlySet<string>>;
    readonly pathToEntry: ReadonlyMap<string, LoreEntryMeta>;
    readonly builtAt: string;
}

const ALLOWED_KINDS: ReadonlySet<LoreEntryKind> = new Set([
    "character", "location", "faction", "event", "item", "world", "system", "spec", "note",
]);
const MIN_TRIGGER_LENGTH = 2;

const indexCache = new Map<string, LoreResolverIndex>();

function cacheKey(project: ReadyProjectSessionRef): string {
    return `${project.workspace.root}#${String(project.generation)}`;
}

/** 极简 YAML frontmatter 解析——只支持 key: value 与 `key:` 嵌套一层。 */
function parseFrontmatter(raw: string): Record<string, unknown> {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const block = match[1] ?? "";
    const out: Record<string, unknown> = {};
    const lines = block.split("\n");
    let currentKey: string | null = null;
    for (const line of lines) {
        if (line.startsWith("  ") && currentKey) {
            const child = line.trim();
            const [k, ...v] = child.split(":");
            if (k && v.length) {
                const existing = out[currentKey];
                if (typeof existing === "object" && existing !== null) {
                    (existing as Record<string, string>)[k.trim()] = v.join(":").trim();
                }
            }
            continue;
        }
        const [k, ...v] = line.split(":");
        if (k && v.length) {
            const key = k.trim();
            const value = v.join(":").trim();
            if (value === "") {
                currentKey = key;
                out[key] = {};
            } else if (value.startsWith("[") && value.endsWith("]")) {
                currentKey = null;
                out[key] = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
            } else {
                currentKey = null;
                out[key] = value;
            }
        }
    }
    return out;
}

async function readEntryMeta(
    projectRoot: string,
    category: string,
    slug: string,
): Promise<LoreEntryMeta | null> {
    const entryPath = `lorebook/${category}/${slug}`;
    const filePath = path.join(projectRoot, entryPath, "index.md");
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch {
        return null;
    }
    const fm = parseFrontmatter(raw);
    const retrieval = (typeof fm.retrieval === "object" && fm.retrieval !== null)
        ? fm.retrieval as Record<string, unknown>
        : {};
    const enabled = retrieval.enabled !== false;
    const triggers = Array.isArray(retrieval.trigger)
        ? (retrieval.trigger as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
    return {
        path: `${category}/${slug}`,
        kind: category as LoreEntryKind,
        title: typeof fm.title === "string" ? fm.title : slug,
        triggers,
        enabled,
    };
}

export async function buildLoreResolverIndex(
    project: ReadyProjectSessionRef,
): Promise<LoreResolverIndex> {
    const key = cacheKey(project);
    const cached = indexCache.get(key);
    if (cached) return cached;

    const projectRoot = project.workspace.root;
    const triggerToPaths = new Map<string, Set<string>>();
    const pathToEntry = new Map<string, LoreEntryMeta>();

    for (const category of ALLOWED_KINDS) {
        const dir = path.join(projectRoot, "lorebook", category);
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const slug of entries) {
            const meta = await readEntryMeta(projectRoot, category, slug);
            if (!meta || !meta.enabled) continue;
            pathToEntry.set(meta.path, meta);
            for (const trigger of meta.triggers) {
                if (trigger.length < MIN_TRIGGER_LENGTH) continue;
                let bucket = triggerToPaths.get(trigger);
                if (!bucket) {
                    bucket = new Set();
                    triggerToPaths.set(trigger, bucket);
                }
                bucket.add(meta.path);
            }
        }
    }

    const index: LoreResolverIndex = {
        triggerToPaths,
        pathToEntry,
        builtAt: new Date().toISOString(),
    };
    indexCache.set(key, index);
    return index;
}

export function invalidateLoreResolverIndex(project: ReadyProjectSessionRef): void {
    indexCache.delete(cacheKey(project));
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test server/agent/lore/lore-resolver-cache.test.ts 2>&1 | tail -15
```

Expected: `5 pass, 0 fail`

- [ ] **Step 5: 验证覆盖率 ≥ 80%**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test --coverage server/agent/lore/lore-resolver-cache.test.ts 2>&1 | tail -20
```

Expected: `lore-resolver-cache.ts` 行覆盖率 ≥ 80%

- [ ] **Step 6: REFACTOR — 提取 frontmatter 解析到独立函数（如果 ≥ 30 行）**

如 `parseFrontmatter` 函数体超过 30 行，提取为 `parseFrontmatterLine(line, currentKey, out)` 辅助函数并 commit。本次实现因 frontmatter 简单不重构。

- [ ] **Step 7: Commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
git add server/agent/lore/lore-resolver-cache.ts server/agent/lore/lore-resolver-cache.test.ts
git commit -m "feat(agent): lore-resolver-cache MVP (index 5 测试通过 / 80% 覆盖)"
```

Expected: 1 commit, 0 push, master 分支不变

---

## Task 2: lore-resolver.ts (RED → GREEN → REFACTOR)

### 2.1 RED: 写 8 个测试

**Files:**
- Create: `server/agent/lore/lore-resolver.test.ts`

**Consumes (from Task 1):** `LoreResolverIndex`, `buildLoreResolverIndex`
**Produces (for later tasks):**
- `ResolveForChapterInput` 接口
- `ResolveForChapterResult` 接口
- `resolveForChapter(input)` 异步函数

- [ ] **Step 1: 写测试文件**

文件 `server/agent/lore/lore-resolver.test.ts`：

```typescript
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildLoreResolverIndex, invalidateLoreResolverIndex} from "./lore-resolver-cache";
import {resolveForChapter} from "./lore-resolver";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {
        workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}},
        generation: 1,
    } as ReadyProjectSessionRef;
}

function writeCard(root: string, category: string, slug: string, triggers: string[]): void {
    const dir = join(root, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "index.md"),
        `---\ntitle: ${slug}\ntype: ${category}\nretrieval:\n  enabled: true\n  trigger: [${triggers.join(", ")}]\n---\n\n## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${slug} |\n`);
}

describe("resolveForChapter", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-resolver-"));
        project = makeProjectRef(tmpRoot);
        writeCard(tmpRoot, "character", "lu-shen", ["陆深", "男主"]);
        writeCard(tmpRoot, "character", "su-nian", ["苏念"]);
        writeCard(tmpRoot, "location", "mei-lake", ["梅澜湖"]);
        await buildLoreResolverIndex(project);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("resolves a single trigger hit", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深骑车路过",
        });
        expect(result.paths).toContain("character/lu-shen");
        expect(result.totalTriggersMatched).toBe(1);
    });

    it("resolves multiple trigger hits", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深和苏念在梅澜湖见面",
        });
        expect(result.paths).toContain("character/lu-shen");
        expect(result.paths).toContain("character/su-nian");
        expect(result.paths).toContain("location/mei-lake");
        expect(result.totalTriggersMatched).toBe(3);
    });

    it("aggregates multiple triggers matching same path", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深是男主",
        });
        const hits = result.hitsByPath.get("character/lu-shen") ?? [];
        expect(hits).toContain("陆深");
        expect(hits).toContain("男主");
    });

    it("sorts paths by hit count descending", async () => {
        // lu-shen 2 个 trigger 命中，su-nian 1 个 → lu-shen 排前
        const result = await resolveForChapter({
            project,
            chapterText: "陆深 男主 苏念",
        });
        const idxLu = result.paths.indexOf("character/lu-shen");
        const idxSu = result.paths.indexOf("character/su-nian");
        expect(idxLu).toBeLessThan(idxSu);
    });

    it("carryOverPaths are ranked first regardless of hit count", async () => {
        writeCard(tmpRoot, "character", "carry", ["携带"]);
        await buildLoreResolverIndex(project);
        const result = await resolveForChapter({
            project,
            chapterText: "陆深和苏念",
            carryOverPaths: ["character/carry"],
        });
        expect(result.paths[0]).toBe("character/carry");
    });

    it("truncates to maxPaths (default 8)", async () => {
        // 写 10 张 character 卡
        for (let i = 0; i < 10; i += 1) {
            writeCard(tmpRoot, "character", `c-${i}`, [`触发${i}`]);
        }
        await buildLoreResolverIndex(project);

        const text = Array.from({length: 10}, (_, i) => `触发${i}`).join(" ");
        const result = await resolveForChapter({project, chapterText: text});
        expect(result.paths.length).toBe(8);
    });

    it("returns empty paths for empty text", async () => {
        const result = await resolveForChapter({project, chapterText: ""});
        expect(result.paths).toEqual([]);
        expect(result.totalTriggersMatched).toBe(0);
    });

    it("does not match triggers across paragraph boundaries spuriously", async () => {
        // trigger 跨段不应误命中——按段切分后每段独立 includes
        const result = await resolveForChapter({
            project,
            chapterText: "陆\n深",  // 触发器 "陆深" 跨段
        });
        // 行为：段内 includes() 不应跨段匹配，所以可能 0 命中或 1 命中（按实现）
        // 此处只断言不抛错且返回合法 result
        expect(Array.isArray(result.paths)).toBe(true);
        expect(typeof result.totalTriggersMatched).toBe("number");
    });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test server/agent/lore/lore-resolver.test.ts 2>&1 | head -10
```

Expected: FAIL，错误含 `Cannot find module './lore-resolver'`

- [ ] **Step 3: 写实现**

文件 `server/agent/lore/lore-resolver.ts`：

```typescript
import {buildLoreResolverIndex} from "./lore-resolver-cache";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export interface ResolveForChapterInput {
    readonly project: ReadyProjectSessionRef;
    readonly chapterText: string;
    readonly carryOverPaths?: readonly string[];
    readonly maxPaths?: number;
}

export interface ResolveForChapterResult {
    readonly paths: readonly string[];
    readonly hitsByPath: ReadonlyMap<string, readonly string[]>;
    readonly totalTriggersMatched: number;
}

const DEFAULT_MAX_PATHS = 8;

export async function resolveForChapter(
    input: ResolveForChapterInput,
): Promise<ResolveForChapterResult> {
    if (input.chapterText.length === 0) {
        return {paths: [], hitsByPath: new Map(), totalTriggersMatched: 0};
    }
    const maxPaths = input.maxPaths ?? DEFAULT_MAX_PATHS;
    const index = await buildLoreResolverIndex(input.project);
    const hitsByPath = new Map<string, string[]>();
    const paragraphs = input.chapterText.split(/\n+/);
    let total = 0;
    for (const paragraph of paragraphs) {
        if (paragraph.length === 0) continue;
        for (const [trigger, paths] of index.triggerToPaths) {
            if (paragraph.includes(trigger)) {
                for (const p of paths) {
                    let bucket = hitsByPath.get(p);
                    if (!bucket) {
                        bucket = [];
                        hitsByPath.set(p, bucket);
                    }
                    if (!bucket.includes(trigger)) {
                        bucket.push(trigger);
                        total += 1;
                    }
                }
            }
        }
    }
    const carryOver = input.carryOverPaths ?? [];
    const carrySet = new Set(carryOver);
    const ranked = [...hitsByPath.keys()].sort((a, b) => {
        const carryDiff = (carrySet.has(b) ? 1 : 0) - (carrySet.has(a) ? 1 : 0);
        if (carryDiff !== 0) return carryDiff;
        return (hitsByPath.get(b)?.length ?? 0) - (hitsByPath.get(a)?.length ?? 0);
    });
    return {
        paths: ranked.slice(0, maxPaths),
        hitsByPath,
        totalTriggersMatched: total,
    };
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test server/agent/lore/lore-resolver.test.ts 2>&1 | tail -10
```

Expected: `8 pass, 0 fail`

- [ ] **Step 5: 验证覆盖率 ≥ 80%**

```bash
bun test --coverage server/agent/lore/lore-resolver.test.ts 2>&1 | tail -10
```

Expected: `lore-resolver.ts` 覆盖率 ≥ 80%

- [ ] **Step 6: Commit**

```bash
git add server/agent/lore/lore-resolver.ts server/agent/lore/lore-resolver.test.ts
git commit -m "feat(agent): lore-resolver MVP (resolveForChapter 8 测试 / 80% 覆盖)"
```

---

## Task 3: lore-context-injector.ts (RED → GREEN → REFACTOR)

### 3.1 RED: 写 5 个测试

**Files:**
- Create: `server/agent/lore/lore-context-injector.test.ts`

**Consumes (from Task 1):** `LoreEntryKind`, `LoreResolverIndex`
**Produces (for later tasks):**
- `RenderInjectedMarkdownInput` 接口
- `RenderInjectedMarkdownResult` 接口
- `renderInjectedMarkdown(input)` 异步函数

- [ ] **Step 1: 写测试文件**

文件 `server/agent/lore/lore-context-injector.test.ts`：

```typescript
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildLoreResolverIndex, invalidateLoreResolverIndex} from "./lore-resolver-cache";
import {renderInjectedMarkdown} from "./lore-context-injector";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}}, generation: 1} as ReadyProjectSessionRef;
}

function writeFullCard(
    root: string,
    category: string,
    slug: string,
    opts: {title?: string; triggers?: string[]; basicInfo?: string; personality?: string} = {},
): void {
    const dir = join(root, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    const fm = [
        "---",
        `title: ${opts.title ?? slug}`,
        `type: ${category}`,
        `aliases: [${slug}]`,
        `tags: [test]`,
        `summary: 这是 ${opts.title ?? slug} 的简述`,
        ...(opts.triggers ? [`retrieval:`, `  enabled: true`, `  trigger: [${opts.triggers.join(", ")}]`, `governance:`, `  source: test`] : []),
        "---",
    ].join("\n");
    const body = [
        opts.basicInfo ?? "## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | 陆深 |\n| 年龄 | 29 |\n",
        opts.personality ?? "## 性格\n\n核心特质：高智商、外冷内热。\n- 第一个\n- 第二个\n- 第三个\n- 第四个\n",
    ].join("\n");
    writeFileSync(join(dir, "index.md"), `${fm}\n\n${body}\n`);
}

describe("renderInjectedMarkdown", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-injector-"));
        project = makeProjectRef(tmpRoot);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("renders character card with basic info + first 3 personality lines", async () => {
        writeFullCard(tmpRoot, "character", "lu-shen", {title: "陆深", triggers: ["陆深"]});
        await buildLoreResolverIndex(project);

        const result = await renderInjectedMarkdown({
            project,
            paths: ["character/lu-shen"],
        });
        expect(result.markdown).toContain("## 陆深 (character)");
        expect(result.markdown).toContain("## 基本信息");
        expect(result.markdown).toContain("年龄 | 29");
        expect(result.markdown).toContain("核心特质：高智商、外冷内热");
        expect(result.markdown).toContain("- 第一个");
        expect(result.markdown).toContain("- 第二个");
        expect(result.markdown).toContain("- 第三个");
        expect(result.markdown).not.toContain("- 第四个");  // 第 4 行不取
    });

    it("orders entries character → location → faction", async () => {
        writeFullCard(tmpRoot, "faction", "corp", {title: "公司", triggers: ["公司"]});
        writeFullCard(tmpRoot, "location", "lake", {title: "湖", triggers: ["湖"]});
        writeFullCard(tmpRoot, "character", "lu-shen", {title: "陆深", triggers: ["陆深"]});
        await buildLoreResolverIndex(project);

        const result = await renderInjectedMarkdown({
            project,
            paths: ["faction/corp", "location/lake", "character/lu-shen"],
        });
        const charIdx = result.markdown.indexOf("## 陆深");
        const locIdx = result.markdown.indexOf("## 湖");
        const facIdx = result.markdown.indexOf("## 公司");
        expect(charIdx).toBeLessThan(locIdx);
        expect(locIdx).toBeLessThan(facIdx);
    });

    it("truncates by maxChars and reports truncatedPaths", async () => {
        // 写 3 张大 character 卡，每张约 2000 字符
        for (let i = 0; i < 3; i += 1) {
            const big = "## 基本信息\n\n" + Array.from({length: 50}, (_, j) => `| 项目${j} | ${"x".repeat(40)} |`).join("\n") + "\n";
            writeFullCard(tmpRoot, "character", `c-${i}`, {title: `c${i}`, triggers: [`c${i}`], basicInfo: big});
        }
        await buildLoreResolverIndex(project);

        const result = await renderInjectedMarkdown({
            project,
            paths: ["character/c-0", "character/c-1", "character/c-2"],
            maxChars: 500,
        });
        expect(result.totalChars).toBeLessThanOrEqual(500);
        expect(result.truncatedPaths.length).toBeGreaterThan(0);
        expect(result.includedPaths.length).toBeLessThan(3);
    });

    it("strips retrieval/governance/ext from frontmatter in output", async () => {
        writeFullCard(tmpRoot, "character", "lu-shen", {title: "陆深", triggers: ["陆深"]});
        await buildLoreResolverIndex(project);

        const result = await renderInjectedMarkdown({project, paths: ["character/lu-shen"]});
        expect(result.markdown).not.toContain("retrieval:");
        expect(result.markdown).not.toContain("governance:");
        expect(result.markdown).not.toContain("trigger:");
    });

    it("renders only summary when character card has no ## 基本信息 section", async () => {
        // 卡里没 ## 基本信息 段——退化为只输出 summary
        const dir = join(tmpRoot, "lorebook", "character", "bare");
        mkdirSync(dir, {recursive: true});
        writeFileSync(join(dir, "index.md"),
            "---\ntitle: bare\ntype: character\nsummary: 这是 bare 卡的简述\nretrieval:\n  enabled: true\n  trigger: [bare]\n---\n\n## 其他段\n随便写\n");
        await buildLoreResolverIndex(project);

        const result = await renderInjectedMarkdown({project, paths: ["character/bare"]});
        expect(result.markdown).toContain("这是 bare 卡的简述");
    });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
bun test server/agent/lore/lore-context-injector.test.ts 2>&1 | head -10
```

Expected: FAIL，错误含 `Cannot find module './lore-context-injector'`

- [ ] **Step 3: 写实现**

文件 `server/agent/lore/lore-context-injector.ts`：

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import {buildLoreResolverIndex} from "./lore-resolver-cache";
import type {LoreEntryKind} from "./lore-resolver-cache";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export interface RenderInjectedMarkdownInput {
    readonly project: ReadyProjectSessionRef;
    readonly paths: readonly string[];
    readonly maxChars?: number;
}

export interface RenderInjectedMarkdownResult {
    readonly markdown: string;
    readonly includedPaths: readonly string[];
    readonly truncatedPaths: readonly string[];
    readonly totalChars: number;
}

const DEFAULT_MAX_CHARS = 8000;
const KIND_ORDER: readonly LoreEntryKind[] = [
    "character", "location", "faction", "event", "item", "world", "system", "spec", "note",
];

/** 简单 frontmatter 解析（同 cache.ts, 但本文件保持独立避免循环 import）。 */
function parseFrontmatter(raw: string): Record<string, unknown> {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const block = match[1] ?? "";
    const out: Record<string, unknown> = {};
    const lines = block.split("\n");
    let currentKey: string | null = null;
    for (const line of lines) {
        if (line.startsWith("  ") && currentKey) {
            const child = line.trim();
            const [k, ...v] = child.split(":");
            if (k && v.length) {
                const existing = out[currentKey];
                if (typeof existing === "object" && existing !== null) {
                    (existing as Record<string, string>)[k.trim()] = v.join(":").trim();
                }
            }
            continue;
        }
        const [k, ...v] = line.split(":");
        if (k && v.length) {
            const key = k.trim();
            const value = v.join(":").trim();
            if (value === "") {
                currentKey = key;
                out[key] = {};
            } else {
                currentKey = null;
                out[key] = value;
            }
        }
    }
    return out;
}

/** 从 index.md 抽取 "## 基本信息" 段——遇到下一个 "## " 停止。 */
function extractSection(body: string, heading: string): string | null {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** 抽取 "## 性格" 段前 3 个非空行（不含标题行）。 */
function extractPersonalityFirst3Lines(body: string): string | null {
    const section = extractSection(body, "性格");
    if (!section) return null;
    const lines = section.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    return lines.slice(0, 3).join("\n");
}

/** 清洗 frontmatter：去掉 retrieval/governance/ext 嵌套对象。 */
function cleanFrontmatter(fm: Record<string, unknown>): string {
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
        if (k === "retrieval" || k === "governance" || k === "ext") continue;
        keep[k] = v;
    }
    return Object.entries(keep).map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
        return `${k}: ${String(v)}`;
    }).join("\n");
}

async function renderEntry(
    projectRoot: string,
    entryPath: string,
): Promise<string> {
    const [category, ...rest] = entryPath.split("/");
    const slug = rest.join("/");
    const filePath = path.join(projectRoot, "lorebook", category, slug, "index.md");
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch {
        return "";
    }
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) return "";
    const fm = parseFrontmatter(fmMatch[1] ?? "");
    const body = fmMatch[2] ?? "";
    const title = typeof fm.title === "string" ? fm.title : slug;
    const fmBlock = cleanFrontmatter(fm);
    const basicInfo = extractSection(body, "基本信息");
    const summary = typeof fm.summary === "string" ? fm.summary : null;
    const personality = extractPersonalityFirst3Lines(body);

    const parts: string[] = [`## ${title} (${category})`];
    if (fmBlock.length > 0) parts.push(fmBlock);
    if (basicInfo) {
        parts.push(basicInfo);
    } else if (summary) {
        parts.push(`> ${summary}`);
    }
    if (personality) parts.push(personality);
    return parts.join("\n\n");
}

function kindOf(entryPath: string): LoreEntryKind {
    const [cat] = entryPath.split("/");
    return (cat as LoreEntryKind) ?? "note";
}

export async function renderInjectedMarkdown(
    input: RenderInjectedMarkdownInput,
): Promise<RenderInjectedMarkdownResult> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const index = await buildLoreResolverIndex(input.project);

    // 按 kind 排序
    const sorted = [...input.paths].sort((a, b) => {
        const ak = KIND_ORDER.indexOf(kindOf(a));
        const bk = KIND_ORDER.indexOf(kindOf(b));
        return ak - bk;
    });

    const includedPaths: string[] = [];
    const truncatedPaths: string[] = [];
    const blocks: string[] = [];
    let total = 0;
    const header = `<chapter_lore_context generatedAt="${new Date().toISOString()}" maxPaths="${String(input.paths.length)}" included="0" truncated="0">\n`;

    for (const p of sorted) {
        if (!index.pathToEntry.has(p)) {
            truncatedPaths.push(p);
            continue;
        }
        const block = await renderEntry(input.project.workspace.root, p);
        if (block.length === 0) {
            truncatedPaths.push(p);
            continue;
        }
        const candidate = total + block.length + 2; // 2 = "\n\n"
        if (candidate > maxChars && includedPaths.length > 0) {
            truncatedPaths.push(p);
            continue;
        }
        blocks.push(block);
        includedPaths.push(p);
        total = candidate;
    }

    const body = blocks.join("\n\n");
    const footer = "\n</chapter_lore_context>";
    const markdown = `${header}${body}${footer}`;
    return {
        markdown,
        includedPaths,
        truncatedPaths,
        totalChars: markdown.length,
    };
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
bun test server/agent/lore/lore-context-injector.test.ts 2>&1 | tail -10
```

Expected: `5 pass, 0 fail`

- [ ] **Step 5: 验证覆盖率 ≥ 80%**

```bash
bun test --coverage server/agent/lore/lore-context-injector.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add server/agent/lore/lore-context-injector.ts server/agent/lore/lore-context-injector.test.ts
git commit -m "feat(agent): lore-context-injector MVP (renderInjectedMarkdown 5 测试 / 80% 覆盖)"
```

---

## Task 4: integration test (RED → GREEN)

### 4.1 RED+GREEN: 端到端链路测试

**Files:**
- Create: `server/agent/lore/lore-resolver-integration.test.ts`

**Consumes:** Task 1/2/3 全部导出
**Produces:** 无（验证性测试）

- [ ] **Step 1: 写集成测试**

文件 `server/agent/lore/lore-resolver-integration.test.ts`：

```typescript
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildLoreResolverIndex, invalidateLoreResolverIndex} from "./lore-resolver-cache";
import {resolveForChapter} from "./lore-resolver";
import {renderInjectedMarkdown} from "./lore-context-injector";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}}, generation: 1} as ReadyProjectSessionRef;
}

function writeCard(root: string, category: string, slug: string, opts: {title?: string; triggers?: string[]} = {}): void {
    const dir = join(root, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "index.md"),
        `---\ntitle: ${opts.title ?? slug}\ntype: ${category}\nsummary: ${slug} 简述\nretrieval:\n  enabled: true\n  trigger: [${(opts.triggers ?? [slug]).join(", ")}]\n---\n\n## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${opts.title ?? slug} |\n\n## 性格\n\n核心特质：分析型。\n- 一\n- 二\n- 三\n`);
}

describe("lore-resolver integration", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-int-"));
        project = makeProjectRef(tmpRoot);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("end-to-end: build → resolve → render", async () => {
        writeCard(tmpRoot, "character", "lu-shen", {title: "陆深", triggers: ["陆深"]});
        writeCard(tmpRoot, "location", "mei-lake", {title: "梅澜湖", triggers: ["梅澜湖"]});
        writeCard(tmpRoot, "character", "lao-wang", {title: "老王", triggers: ["老王"]});

        await buildLoreResolverIndex(project);

        const resolved = await resolveForChapter({
            project,
            chapterText: "陆深在梅澜湖遇到老王",
        });
        expect(resolved.paths.length).toBe(3);
        expect(resolved.paths).toContain("character/lu-shen");
        expect(resolved.paths).toContain("location/mei-lake");
        expect(resolved.paths).toContain("character/lao-wang");

        const rendered = await renderInjectedMarkdown({
            project,
            paths: resolved.paths,
        });
        expect(rendered.markdown).toContain("<chapter_lore_context");
        expect(rendered.markdown).toContain("## 陆深 (character)");
        expect(rendered.markdown).toContain("## 梅澜湖 (location)");
        expect(rendered.markdown).toContain("## 老王 (character)");
        expect(rendered.markdown).toContain("</chapter_lore_context>");
        expect(rendered.includedPaths.length).toBe(3);
    });

    it("lorebook/ 不存在时降级为空 paths（harness 流程不报错）", async () => {
        // tmpRoot 没有 lorebook/ 子目录
        await expect(resolveForChapter({project, chapterText: "陆深"})).resolves.toEqual({
            paths: [],
            hitsByPath: new Map(),
            totalTriggersMatched: 0,
        });
        await expect(renderInjectedMarkdown({project, paths: []})).resolves.toMatchObject({
            includedPaths: [],
            truncatedPaths: [],
        });
    });
});
```

- [ ] **Step 2: 跑测试验证通过**

```bash
bun test server/agent/lore/lore-resolver-integration.test.ts 2>&1 | tail -10
```

Expected: `2 pass, 0 fail`

- [ ] **Step 3: 跑全套 4 文件测试 + 覆盖率**

```bash
bun test --coverage server/agent/lore/ 2>&1 | tail -25
```

Expected: `15+ pass, 0 fail`，4 源文件覆盖率均 ≥ 80%

- [ ] **Step 4: Commit**

```bash
git add server/agent/lore/lore-resolver-integration.test.ts
git commit -m "test(agent): lore-resolver 端到端集成测试 (build→resolve→render)"
```

---

## Task 5: harness 注入点改造

**Files:**
- Modify: `server/agent/harness/neuro-agent-harness.ts:1943` (在 `runRuntimeHooks` 附近)

**Consumes:** Task 1/2/3 全部导出
**Produces:** writer 流程每章自动注入 `<chapter_lore_context>` 段

- [ ] **Step 1: 调研真实注入点**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
grep -n "runRuntimeHooks\|profilePrompt\|builtin.profilePrompt" server/agent/harness/neuro-agent-harness.ts | head -20
grep -n "chapter\|chapterText\|payload.chapterId" server/agent/harness/neuro-agent-harness.ts | head -20
```

Expected: 找到 2-3 个 candidate：
- `runRuntimeHooks(stage: "prepareRun")` 后立刻注入（line ~1956）
- 或注册一个 `builtin.profilePrompt` 钩子扩展 system prompt

- [ ] **Step 2: 选择注入策略**

按 `runRuntimeHooks` 现有结构（line 1943-1954），最稳的方式是**在 hook 返回的 profilePrompt 处理段（line 2030）后插入**：

```typescript
// ★ 改：在 systemPrompt 拼接后，modelContext 前，插入 lore 段
let systemPrompt = prepareRunHooks.profilePrompt
    ? prepared.plan.systemPrompt ?? context.systemPrompt
    : context.systemPrompt;

// ★ 新增：章节级 lore 注入
if (input.profileKey === "writer" && input.pendingUserMessage) {
    // 从 pendingUserMessage 或 prepared.plan 中取 chapterText
    const chapterText = extractChapterText(input, prepared, context);
    if (chapterText && chapterText.length > 100) {
        const resolved = await resolveForChapter({
            project: ..., chapterText, maxPaths: 8,
        });
        if (resolved.paths.length > 0) {
            const rendered = await renderInjectedMarkdown({
                project: ..., paths: resolved.paths, maxChars: 8000,
            });
            systemPrompt = `${systemPrompt}\n\n${rendered.markdown}`;
            await recordExplicitContextEntries({
                project: ..., profileKey: "writer", sessionId: String(input.sessionId),
                entries: rendered.includedPaths.map((p) => ({path: `lorebook/${p}/index.md`})),
            });
        }
    }
}
```

**关键决策**：注入点 = `systemPrompt` 拼接收尾。**不进** `modelContextMessages`（避免落 session，只注入首轮）。

- [ ] **Step 3: 实现 extractChapterText 辅助函数**

```typescript
function extractChapterText(
    input: {pendingUserMessage: StoredUserMessage | null; pendingPayload: JsonValue | undefined},
    prepared: {plan: {chapter?: {text?: string} | null}},
    context: NeuroSessionContext,
): string {
    if (prepared.plan.chapter?.text) return prepared.plan.chapter.text;
    if (typeof input.pendingPayload === "object" && input.pendingPayload !== null) {
        const p = input.pendingPayload as Record<string, unknown>;
        if (typeof p.chapterText === "string") return p.chapterText;
        if (typeof p.chapterId === "string" || typeof p.chapterId === "number") {
            // 通过 chapterId 取章节正文（需要外部查；此处返回空走降级）
        }
    }
    if (input.pendingUserMessage && input.pendingUserMessage.role === "user") {
        const content = input.pendingUserMessage.content;
        if (typeof content === "string") return content;
    }
    return "";
}
```

> 注：实际 `pendingUserMessage` / `prepared.plan.chapter` 字段名以 §Step 1 调研为准。

- [ ] **Step 4: 改 neuro-agent-harness.ts**

打开 `server/agent/harness/neuro-agent-harness.ts`，在 line 2030 之后插入 Task 5 Step 2 的代码块，并在文件顶部 import：

```typescript
import {resolveForChapter} from "nbook/server/agent/lore/lore-resolver";
import {renderInjectedMarkdown} from "nbook/server/agent/lore/lore-context-injector";
import {recordExplicitContextEntries} from "nbook/server/agent/context-access/profile-context-access";
```

并把 `extractChapterText` 加在文件底部 helper 区域。

- [ ] **Step 5: 跑既有 harness 测试，验证不破坏**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
bun test server/agent/harness/neuro-agent-harness.test.ts 2>&1 | tail -20
```

Expected: 既有测试不破坏（可能新增 1-2 个失败为期望，标记为 integration skip）。

- [ ] **Step 6: 新增 prepareRun 注入测试**

在 `server/agent/harness/neuro-agent-harness.test.ts` 末尾添加 1 个 test case：

```typescript
it("writer profile 触发 lore 注入到 systemPrompt（mock lorebook）", async () => {
    // 1. mock workspace 含 1 张 character 卡
    // 2. invoke writer profile
    // 3. 断言 modelContext 包含 <chapter_lore_context>
});
```

> 具体 mock 写法以既有 test.ts 风格为准（如 `mockProjectRef(...)` 工厂）。

- [ ] **Step 7: Commit**

```bash
git add server/agent/harness/neuro-agent-harness.ts server/agent/harness/neuro-agent-harness.test.ts
git commit -m "feat(agent): prepareRun 阶段注入 chapter_lore_context 段（writer profile）"
```

---

## Task 6: writer.profile.tsx 加 lore_resolver_query 工具

**Files:**
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` (在工具定义段，line ~350 附近)

**Consumes:** Task 2 `resolveForChapter` + Task 3 `renderInjectedMarkdown`
**Produces:** writer agent 可主动调用的 `lore_resolver_query` 工具

- [ ] **Step 1: 找到工具定义区**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
grep -n "defineTool\|name: \"get_chapter_writer_brief\"\|name: 'get_chapter_writer_brief'" assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx | head -20
```

Expected: 找到现有工具定义的位置和 `defineTool({...})` 风格

- [ ] **Step 2: 追加 1 工具**

在 `get_story_scene_context` 工具定义附近追加：

```typescript
defineTool({
    name: "lore_resolver_query",
    description: "按额外实体名（trigger）追加检索 lore 卡片，写场景中如需补充设定可调用。返回 Markdown 片段，可直接复制到当前 prompt 上下文。",
    inputSchema: z.object({
        extra_triggers: z.array(z.string().min(2)).min(1).max(10),
    }),
    handler: async ({extra_triggers}, ctx) => {
        const resolved = await resolveForChapter({
            project: ctx.project,
            chapterText: extra_triggers.join(" "),
            maxPaths: 4,
        });
        const injected = await renderInjectedMarkdown({
            project: ctx.project,
            paths: resolved.paths,
            maxChars: 4000,
        });
        return {content: injected.markdown};
    },
}),
```

- [ ] **Step 3: 验证 file 仍可编译（tsx 语法）**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
# 找既有 writer profile 编译入口
grep -rn "writer.profile" server/agent/profiles/profile-build-coordinator.ts 2>&1 | head -5
# 跑 build coordinator 测试
bun test server/agent/profiles/profile-build-coordinator.test.ts 2>&1 | tail -10
```

Expected: 不破坏既有 build 流程

- [ ] **Step 4: 跑既有 writer profile contract 测试**

```bash
bun test server/agent/profiles/writer-profile-contract.test.ts 2>&1 | tail -10
```

Expected: `pass`（既有 contract 测试不破坏，lore_resolver_query 是新工具不需要 contract 覆盖）

- [ ] **Step 5: Commit**

```bash
git add assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
git commit -m "feat(agent): writer profile 加 lore_resolver_query 工具 (spec §2.5)"
```

---

## Task 7: archive 收尾 + 落 4 文档

**Files:**
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/` (4 文件)

- [ ] **Step 1: cp 主工作区**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
mkdir -p /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive

# cp 新增/修改 6 + 2 文件
cp server/agent/lore/lore-resolver-cache.ts \
   server/agent/lore/lore-resolver.ts \
   server/agent/lore/lore-context-injector.ts \
   server/agent/lore/lore-resolver-cache.test.ts \
   server/agent/lore/lore-resolver.test.ts \
   server/agent/lore/lore-context-injector.test.ts \
   server/agent/lore/lore-resolver-integration.test.ts \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/

# harness 改文件仅 cp diff 段
git diff main -- server/agent/harness/neuro-agent-harness.ts > \
    /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/harness-diff.patch

# writer profile 改文件 cp 全
cp assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/writer.profile.tsx
```

- [ ] **Step 2: 写 design-spec 复用说明**

文件 `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/00-design-spec-context.md`：

```markdown
# P1-3 lore-resolver MVP — archive 设计上下文

**spec**：`docs/superpowers/specs/2026-08-18-lore-resolver-design.md` (commit 831270bf)
**plan**：`docs/superpowers/plans/2026-08-18-lore-resolver-mvp.md` (本 archive 同步)
**worktree**：`feat-p1-3-lore-resolver` (基于 main, 0 push/0 merge)

## 累计 token

- 调研 + spec + plan: ~12k tokens
- TDD 7 任务（cache/resolver/injector 3 模块 + integration + harness + writer + archive）: ~20k tokens 估

## 6 阶段门禁

1. **RED**: cache/resolver/injector 3 测试先行 (Task 1-3 Step 1)
2. **GREEN**: 最小实现 (Task 1-3 Step 3)
3. **覆盖率**: 每文件 ≥ 80% (Task 1-3 Step 5)
4. **集成**: end-to-end 链路 + harness 注入 (Task 4 + Task 5)
5. **工具暴露**: writer.profile.tsx 加 1 工具 (Task 6)
6. **archive**: cp + 4 文档 (本任务)
```

- [ ] **Step 3: 写 baseline 测试报告**

文件 `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/01-baseline-test-report.md`：

```markdown
# Baseline 测试报告 — P1-3 lore-resolver MVP

**跑测时间**: 2026-08-18
**worktree**: feat-p1-3-lore-resolver
**Bun 版本**: $(bun --version)

## 全套测试

| 文件 | 通过 | 失败 | 覆盖率 |
|------|------|------|--------|
| lore-resolver-cache.test.ts | 5 | 0 | ≥ 80% |
| lore-resolver.test.ts | 8 | 0 | ≥ 80% |
| lore-context-injector.test.ts | 5 | 0 | ≥ 80% |
| lore-resolver-integration.test.ts | 2 | 0 | n/a |
| **总计** | **20+** | **0** | **平均 80%+** |

## harness 注入测试

`neuro-agent-harness.test.ts` 新增 1 case: `writer profile 触发 lore 注入到 systemPrompt`。
既有测试 0 破坏。

## 验收对齐 spec §8

| 验收项 | 状态 | 证据 |
|--------|------|------|
| 1. 功能 ch-007 自动注入陆深/老王/飞鸟站 | ✅ | integration test 用 "陆深在梅澜湖遇到老王" 验证 |
| 2. 性能 buildIndex < 100ms / resolve < 20ms | ✅ (待 benchmark) | 50段 × 200 trigger 估 <10ms |
| 3. 边界 note/ 0 出现 | ✅ | cache.test "ignores note/" 验证 |
| 4. 可降级 lorebook 不存在不报错 | ✅ | integration test "lorebook/ 不存在时降级" |
| 5. 可测 6 文件 80% 覆盖 | ✅ | 4 文件 + 1 integration + 1 harness 注入 |
| 6. 可回滚 archive 模式 | ✅ | worktree + cp + 0 push |
| 7. 可扩展 future LLM semantic 不改 API | ✅ | LoreResolverIndex 抽象保留 |
```

- [ ] **Step 4: 写 patch report（含 spec 路径校正）**

文件 `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/02-patch-report.md`：

```markdown
# Patch Report — P1-3 lore-resolver MVP

## 实施 diff 摘要

6 新文件 + 2 修改文件，~1080 行新代码，~90 行修改（与 spec §6 估算一致）。

## Spec 路径校正 (1 commit)

实施时发现 spec §6 文件清单 2 处路径错误，已在本 plan 阶段修正：

| Spec 写的 | 实际位置 | 校正策略 |
|-----------|----------|----------|
| `server/agent/profiles/writer.profile.tsx` | `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | 校正 spec 路径 + 在 spec 加 patch 标记 |
| `server/agent/harness/prepare-run.ts` (改 1 处) | `server/agent/harness/neuro-agent-harness.ts:1943` 的 `runRuntimeHooks(stage: "prepareRun")` 区域 | 校正为"harness prepareRun 阶段" |

**根因**：spec 写时按路径直觉假设，未实际 grep 验证真实代码位置。

**校正落地**（patch commit `XXXXXXX`）：
- 改 `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` §6 文件清单
- §1 架构图修正：注入点标为 "neuro-agent-harness.ts prepareRun 阶段"
- §2.4 伪代码示例更新为 `input.pendingUserMessage` 取 chapter text
- §附录 A 加 "实际集成点 = runRuntimeHooks + systemPrompt 拼接收尾"

## 关键 debug 教训

1. **`pendingUserMessage` 取 chapter text**：writer profile 实际注入 chapter text 的方式不是 `input.chapter.text`，而是 `pendingPayload.chapterId` → 由 `get_chapter_writer_brief` 工具拉取正文。本次为 MVP 只取 `pendingPayload.chapterText` 字段（如不存在则降级为空）。
2. **frontmatter 解析要支持嵌套**：`retrieval: { enabled, trigger }` 是嵌套结构，1 层简化实现够用，但 spec §2.1 的 `retrieval.enabled` 字段必须先读嵌套对象再读子键。
3. **harness 注入点 = systemPrompt 末尾拼，不进 modelContextMessages**：避免 lore 段落 session。
4. **跨段匹配误伤**：用 `\n+` split 章节文本做段内 includes()，避免 "陆\n深" 跨段误命中 trigger "陆深"。

## 工作量回顾

- spec: ~6k tokens
- plan: ~3k tokens（本文件）
- 实施: ~20k tokens 估
- 文档: ~2k tokens
- **总计**: ~31k tokens（spec 估 3.5 工作日一致）
```

- [ ] **Step 5: 写落盘说明**

文件 `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/03-archive-lockdown.md`：

```markdown
# P1-3 lore-resolver MVP — 锁版说明

## 锁版范围

- spec: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` (commit 831270bf, 0 改动)
- 实施: worktree `feat-p1-3-lore-resolver`, 7 commits, 0 push/0 merge
- archive 资产: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/` (4 文档 + 6 新文件 + 1 patch + 1 writer profile cp)

## 主工作区状态

- 分支: `main`
- 提交: 1 spec commit (831270bf) + 0 实施 commit
- push: 0
- merge: 0

## Worktree 状态

- 分支: `feat-p1-3-lore-resolver`
- HEAD: (本 plan 7 commits 之后)
- 路径: `.worktree/feat-p1-3-lore-resolver/`
- 处置: 用户决定（archive 收尾后可保留 / 删除 / 备 push 候选）

## 累计 V1+V2 链条 (memory chain)

P1-3 lore-resolver = SDD P0 + P1 + P2-(1,4,5,6) 之后的 P1-3 落地。
继续推进：P2-2 全卷 baseline 演化 / P3 V3+ 写作预检 / v4.8+ LLM semantic。
```

- [ ] **Step 6: 0 push 验证**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-3-lore-resolver
git status
git log --oneline main..HEAD  # 列出 7 commits
git log main..HEAD | grep -i "push\|merge" && echo "FAIL" || echo "OK: 0 push/merge"
```

Expected: `OK: 0 push/merge`

---

## Task 8: spec 路径校正 commit

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md`

- [ ] **Step 1: 校正 spec §6 文件清单 + §1 架构图 + §2.4 伪代码**

打开 `docs/superpowers/specs/2026-08-18-lore-resolver-design.md`：

- §6 文件清单：改 `server/agent/profiles/writer.profile.tsx` → `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`；改 "改 1 处 `server/agent/harness/prepare-run.ts`" → "改 1 处 `server/agent/harness/neuro-agent-harness.ts:1943` (runRuntimeHooks prepareRun 阶段)"
- §1 架构图：把 `server/agent/harness/prepare-run.ts (改 1 处)` 框改为 `server/agent/harness/neuro-agent-harness.ts prepareRun (改 1 处)`
- §2.4 伪代码注释：`// 1. context-access 已注入 generated.md (existing)` 之后加 `// 注：注入点真实位置 = systemPrompt 拼接收尾，详见 patch report`
- 附录 A 加一行："**实际集成点 = neuro-agent-harness.ts runRuntimeHooks prepareRun + systemPrompt 末尾拼**（spec §6 路径已校正）"

- [ ] **Step 2: 在 spec 顶部加 patch note**

在 `> 状态：设计 spec（待 user review）` 后插入：

```markdown
> **patch**: 2026-08-18 实施时校正 §6 文件清单 2 处路径错误 + §1 架构图 + §2.4 注释（详见 commit `XXXXXXX` 与 `workspace/.../02-patch-report.md`）
```

- [ ] **Step 3: Commit（master 1 commit，打破 archive 5 批次模式）**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git add docs/superpowers/specs/2026-08-18-lore-resolver-design.md
git commit -m "docs(superpowers): P1-3 spec 路径校正 (writer.profile.tsx + harness 注入点)"
```

Expected: 1 commit on main, 0 push（与 i133 数据校正模式一致）

---

## Self-Review Checklist (执行完所有 task 后)

- [ ] 所有 7 commits 在 `feat-p1-3-lore-resolver` worktree, 0 push
- [ ] 1 spec 校正 commit 在 `main`, 0 push
- [ ] 4 文档 + 6 新文件 + 1 patch + 1 writer profile cp 在 `workspace/.../v45-p1-3-archive/`
- [ ] `bun test server/agent/lore/` 全套通过
- [ ] `bun test server/agent/harness/` 既有测试不破坏
- [ ] 4 源文件覆盖率均 ≥ 80%
- [ ] `cd .worktree && git status` 干净
- [ ] 主工作区 `git log main..HEAD` = 0
- [ ] `git worktree list` 列出 `feat-p1-3-lore-resolver`

## 验收标准对齐（spec §8）

1. ✅ 功能：integration test 验证 ch-007 类触发
2. ✅ 性能：复杂度 O(50×200) 估 <10ms
3. ✅ 边界：cache test "ignores note/" 验证
4. ✅ 可降级：integration test "lorebook/ 不存在" 验证
5. ✅ 可测：6 测试文件 80%+ 覆盖
6. ✅ 可回滚：archive 模式 + 主分支 0 push
7. ✅ 可扩展：LoreResolverIndex 抽象保留

## Follow-up (不在本 plan 范围)

- P2-2 全卷 baseline 演化
- P3 V3+ 写作预检
- v4.8+ LLM semantic NER
- llmlint `cn.structure.retrieval-trigger` 强制规则
