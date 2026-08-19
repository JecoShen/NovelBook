# M-11 carryOverPaths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `previousChapter.injectedPaths` to resolver's `carryOverPaths` via a JSONL-backed sliding-window store, so chapter N+1 inherits chapter N's (and prior 2) lore paths.

**Architecture:**
- New `lore-carryover-store.ts` (JSONL append/tail with 3-record sliding window).
- Harness adds 2 calls: read on `prepareRun`, record after `recordExplicitContextEntries` (same call point).
- Spec bump: v4.6 → v4.7 (3 section changes: §2.2/§2.4/§2.6 + §3/§4/§5 sync).

**Tech Stack:** TypeScript / Bun test / Node fs (`appendFile` + `readFile`) / `ReadyProjectSessionRef` (existing type).

## Global Constraints

- **archive 模式**: worktree `.worktree/m-11-carryover-paths/` based on `feat-i-1-production-wiring` (lore impl 在该 branch, 主 main 没有 `server/agent/lore/` 目录). 0 push / 0 merge / 0 改 main.
- **TypeScript 严格类型**: `interface` 公开 API, 不用 `any`, `Readonly<>` + spread 实现不可变更新.
- **80% 覆盖率** (per ECC `typescript/testing.md`): 每个新文件 5+ 测试 case.
- **TDD 顺序**: RED (test first) → GREEN (impl pass) → REFACTOR. 每步独立 commit.
- **不写 `console.log`**: 用 `console.warn` (与现有 lore module 一致).
- **JSONL 路径**: `workspace/.nbook/state/lore-carryover.jsonl` (gitignored, 与 `runtime.lease` 同级目录).
- **依赖**: 仅 Node 内置 `fs/promises`, 不引新依赖.
- **Harness 改点**: 2 处 (prepareRun read + post-record). 1 commit 落地. 与 `recordExplicitContextEntries` 同一调点.
- **错误降级**: file 不存在 → read 返回 `[]`; 行 malformed → skip + warn; 写失败 → warn 不 throw.

## File Structure

| 文件 | 责任 | 增减 |
|---|---|---|
| `server/agent/lore/lore-carryover-store.ts` | JSONL append + tail read + 3-record sliding window | **NEW** (~80 行) |
| `server/agent/lore/lore-carryover-store.test.ts` | 5 test cases (AAA 模式) | **NEW** (~100 行) |
| `server/agent/harness/neuro-agent-harness.ts` | 加 2 调用 (read in prepareRun, record after commit-point) | **MODIFY** (~10 行) |
| `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` | v4.6 → v4.7 (3 section 改) | **MODIFY** |
| `docs/superpowers/plans/2026-08-19-m-11-carryover-paths.md` | 本文件 | **NEW** |

**接口契约** (locked per brainstorming 3 决策):
- `recordLoreInjection(project, {chapterId, paths, ts})` → append JSONL line, no return
- `readRecentLoreInjections(project, {limit: 3})` → `readonly string[]` (union-deduped, latest first)
- 文件不存在 → `[]`; 行 malformed → skip + warn
- 路径: `workspace/.nbook/state/lore-carryover.jsonl`

---

## Task 1: RED — 写 `lore-carryover-store.test.ts` 5 cases

**Files:**
- Create: `server/agent/lore/lore-carryover-store.test.ts`

**Interfaces:**
- Consumes: `recordLoreInjection`, `readRecentLoreInjections` (from `lore-carryover-store.ts`, **not yet implemented**)
- Produces: 5 failing tests proving spec §2.6 contract

- [ ] **Step 1: 写测试文件 (RED)**

```typescript
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync, appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {recordLoreInjection, readRecentLoreInjections} from "./lore-carryover-store";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {
        workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}},
        generation: 1,
    } as ReadyProjectSessionRef;
}

describe("lore-carryover-store", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-carryover-"));
        project = makeProjectRef(tmpRoot);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
    });

    it("record 1 chapter then read returns that chapter's paths", async () => {
        await recordLoreInjection(project, {
            chapterId: "ch-001",
            paths: ["character/lu-shen", "location/mei-lake"],
            ts: "2026-08-19T10:00:00Z",
        });
        const result = await readRecentLoreInjections(project, {limit: 3});
        expect(result).toEqual(["character/lu-shen", "location/mei-lake"]);
    });

    it("record 5 chapters, read limit=3 returns latest 3 union deduped", async () => {
        for (let i = 1; i <= 5; i += 1) {
            await recordLoreInjection(project, {
                chapterId: `ch-${String(i).padStart(3, "0")}`,
                paths: [`character/c-${i}`, `location/l-${i}`],
                ts: `2026-08-19T10:0${i}:00Z`,
            });
        }
        const result = await readRecentLoreInjections(project, {limit: 3});
        // 末 3 章 = ch-003, ch-004, ch-005 (latest first per spec)
        expect(result).toEqual([
            "character/c-5", "location/l-5",
            "character/c-4", "location/l-4",
            "character/c-3", "location/l-3",
        ]);
    });

    it("same chapterId recorded multiple times: path dedup, record entries kept", async () => {
        await recordLoreInjection(project, {
            chapterId: "ch-001", paths: ["character/lu-shen"], ts: "2026-08-19T10:00:00Z",
        });
        await recordLoreInjection(project, {
            chapterId: "ch-001", paths: ["character/lu-shen", "location/mei-lake"], ts: "2026-08-19T10:01:00Z",
        });
        const result = await readRecentLoreInjections(project, {limit: 3});
        // 2 records, same chapterId, path dedup, latest paths first
        expect(result).toEqual(["character/lu-shen", "location/mei-lake"]);
    });

    it("read with missing file returns empty array", async () => {
        const result = await readRecentLoreInjections(project, {limit: 3});
        expect(result).toEqual([]);
    });

    it("read skips malformed trailing line, returns valid prior lines in order", async () => {
        const jsonlPath = join(tmpRoot, "workspace", ".nbook", "state", "lore-carryover.jsonl");
        // Manually construct JSONL with malformed last line
        writeFileSync(jsonlPath, "");
        appendFileSync(jsonlPath, JSON.stringify({
            chapterId: "ch-001", paths: ["character/lu-shen"], ts: "2026-08-19T10:00:00Z",
        }) + "\n");
        appendFileSync(jsonlPath, JSON.stringify({
            chapterId: "ch-002", paths: ["location/mei-lake"], ts: "2026-08-19T10:01:00Z",
        }) + "\n");
        appendFileSync(jsonlPath, "{this is not valid json\n"); // malformed
        const result = await readRecentLoreInjections(project, {limit: 3});
        // ch-002 排前 (latest first), ch-001 后
        expect(result).toEqual(["location/mei-lake", "character/lu-shen"]);
    });
});
```

- [ ] **Step 2: 跑测试确认 RED**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bun test server/agent/lore/lore-carryover-store.test.ts
```

预期: 全部 5 个 test FAIL (因为 `lore-carryover-store.ts` 还不存在, 找不到 import).

- [ ] **Step 3: 临时 commit 标记 RED 阶段 (本步不进 commit, 验证后删)**
本步不 commit. RED → GREEN 连续做, 在 Task 2 一起 commit.

---

## Task 2: GREEN — 实现 `lore-carryover-store.ts`

**Files:**
- Create: `server/agent/lore/lore-carryover-store.ts` (~80 行)

**Interfaces:**
- Produces:
  - `interface LoreInjectionRecord { chapterId: string; paths: readonly string[]; ts: string }`
  - `interface ReadOptions { limit: number }`
  - `function recordLoreInjection(project, record): Promise<void>`
  - `function readRecentLoreInjections(project, options): Promise<readonly string[]>`

- [ ] **Step 1: 写实现 (GREEN)**

```typescript
import {appendFile, mkdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export interface LoreInjectionRecord {
    readonly chapterId: string;
    readonly paths: readonly string[];
    readonly ts: string;
}

export interface ReadOptions {
    readonly limit: number;
}

function getJsonlPath(project: ReadyProjectSessionRef): string {
    return join(project.workspace.ref.projectRoot, "workspace", ".nbook", "state", "lore-carryover.jsonl");
}

export async function recordLoreInjection(
    project: ReadyProjectSessionRef,
    record: LoreInjectionRecord,
): Promise<void> {
    const path = getJsonlPath(project);
    try {
        await mkdir(dirname(path), {recursive: true});
        await appendFile(path, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
        console.warn(`[lore-carryover] record failed for ${record.chapterId}:`, err);
    }
}

export async function readRecentLoreInjections(
    project: ReadyProjectSessionRef,
    options: ReadOptions,
): Promise<readonly string[]> {
    const path = getJsonlPath(project);
    let content: string;
    try {
        content = await readFile(path, "utf8");
    } catch (err) {
        // ENOENT (file 不存在) → 返回 []
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        console.warn(`[lore-carryover] read failed, returning []:`, err);
        return [];
    }
    const lines = content.split("\n").filter((l) => l.length > 0);
    // Tail 末 N 条 + 跳过 malformed + 逆序 (末条 first) + path Set 去重
    const recent = lines.slice(-options.limit);
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
        let parsed: LoreInjectionRecord;
        try {
            parsed = JSON.parse(recent[i]!) as LoreInjectionRecord;
        } catch {
            console.warn(`[lore-carryover] skip malformed line at index ${i}`);
            continue;
        }
        for (const p of parsed.paths) {
            if (!seen.has(p)) {
                seen.add(p);
                result.push(p);
            }
        }
    }
    return result;
}
```

- [ ] **Step 2: 跑测试确认 GREEN**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bun test server/agent/lore/lore-carryover-store.test.ts
```

预期: 5/5 PASS.

- [ ] **Step 3: 全量 lore 测试确认无回归**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bun test server/agent/lore/
```

预期: 5 (新 carryover) + 27 (现有 lore) = 32/32 PASS, 无回归.

- [ ] **Step 4: 跑 i134 perf 确认新组件不拖性能**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bun test server/agent/lore/lore-perf-benchmark.test.ts
```

预期: 3/3 PASS, 仍 < 100/20/50ms (新 store 是 IO, 在另一档, 单独 perf 后续).

- [ ] **Step 5: Commit (Task 1 + Task 2 一起, 1 commit)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git add server/agent/lore/lore-carryover-store.ts \
        server/agent/lore/lore-carryover-store.test.ts
git commit -m "feat(lore): M-11 carryOverPaths JSONL store (3-章 sliding window)"
```

---

## Task 3: harness 集成 (2 调用点)

**Files:**
- Modify: `server/agent/harness/neuro-agent-harness.ts` (2 处, ~10 行)

- [ ] **Step 1: 加 import (顶部)**

```typescript
import {recordLoreInjection, readRecentLoreInjections} from "nbook/server/agent/lore/lore-carryover-store";
```

- [ ] **Step 2: 在 prepareRun 阶段, resolveForChapter 之前, 加 readRecentLoreInjections 调用**

定位: `neuro-agent-harness.ts:2030` 附近的 `const resolved = await resolveForChapter({...})` 之前.

```typescript
// M-11: 读前 3 章 commit 时的注入 paths union 去重
const carryOverPaths = await readRecentLoreInjections({
    project: input.project,
    limit: 3,
});
const resolved = await resolveForChapter({
    project: input.project,
    chapterText,
    carryOverPaths,  // ← 改这里, 从 input.previousChapter?.injectedPaths 改为 carryOverPaths
    maxPaths: 8,
});
```

- [ ] **Step 3: 在 recordExplicitContextEntries 之后, 加 recordLoreInjection 调用**

定位: `neuro-agent-harness.ts:2056` 附近, 已有 `await recordExplicitContextEntries({...})` 之后.

```typescript
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
```

- [ ] **Step 4: 跑全量 lore + harness 测试**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bun test server/agent/lore/ server/agent/harness/
```

预期: 32 (lore) + 11 (writer profile) + harness 已有 tests 全部 PASS.

- [ ] **Step 5: 跑 tsc 确认无类型错误**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
bunx tsc --noEmit 2>&1 | tail -20
```

预期: 0 新错误 (与 baseline 比较).

- [ ] **Step 6: Commit (harness wiring 1 commit)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git add server/agent/harness/neuro-agent-harness.ts
git commit -m "feat(harness): M-11 wire carryOverPaths in prepareRun + record in commit-point"
```

---

## Task 4: spec 校正 (1 commit)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` (已 Task 1 阶段应用, 此处 commit)

- [ ] **Step 1: 确认 spec v4.7 改动已落 (在 worktree 中)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git diff --stat docs/superpowers/specs/2026-08-18-lore-resolver-design.md
```

预期: 1 file changed, +60 -5 (大致).

- [ ] **Step 2: Commit spec**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git add docs/superpowers/specs/2026-08-18-lore-resolver-design.md
git commit -m "docs(spec): v4.7 M-11 carryOverPaths spec (3 section sync + §2.6 new)"
```

---

## Task 5: archive 收官 (worktree remove + branch retain + cp 主工作区)

- [ ] **Step 1: 验证 worktree 干净**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git status
```

预期: clean working tree.

- [ ] **Step 2: 验证 commits 全部在 branch (HEAD 上 4 commits)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths
git log --oneline feat-i-1-production-wiring..HEAD
```

预期: 4 commits (M-11 feat + harness wire + spec + 备选 plan).

- [ ] **Step 3: cp 主工作区 archive**

```bash
cp /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths/server/agent/lore/lore-carryover-store.ts \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/lore-carryover-store.ts

cp /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths/server/agent/lore/lore-carryover-store.test.ts \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/lore-carryover-store.test.ts

cp /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths/docs/superpowers/specs/2026-08-18-lore-resolver-design.md \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/2026-08-18-lore-resolver-design-v4.7.md

cp /www/wwwroot/book.neoshen.dpdns.org/.worktree/m-11-carryover-paths/docs/superpowers/plans/2026-08-19-m-11-carryover-paths.md \
   /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/2026-08-19-m-11-carryover-paths.md
```

- [ ] **Step 4: 写 lockdown 文档**

```bash
cat > /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/06-m-11-carryover-lockdown.md <<'EOF'
# M-11 carryOverPaths lockdown

**锁版日期**: 2026-08-19
**状态**: ✅ M-11 落位 (carryOverPaths 串通: JSONL 持久化 + 3-章 sliding window + commit 后记录)

## 锁版范围

- 实施 commits (3, on `feat-i-1-production-wiring`):
  - `xxx feat(lore): M-11 carryOverPaths JSONL store (3-章 sliding window)`
  - `xxx feat(harness): M-11 wire carryOverPaths in prepareRun + record in commit-point`
  - `xxx docs(spec): v4.7 M-11 carryOverPaths spec (3 section sync + §2.6 new)`
- worktree: `.worktree/m-11-carryover-paths/` (基于 `feat-i-1-production-wiring`)
- archive 资产: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/`

## M-11 落位详情

| 决策点 | 选项 | 落地 |
|---|---|---|
| **存储** | (B) 磁盘 JSONL | `workspace/.nbook/state/lore-carryover.jsonl` (gitignored) |
| **Lookback** | (B) 3-章 sliding window | `readRecentLoreInjections({limit: 3})` 默认 3 |
| **记录时机** | (A) commit 后记录 | 与 `recordExplicitContextEntries` 同调点 (harness ~line 2056) |

## 验证

- 5/5 `lore-carryover-store.test.ts` PASS (record/read/union/dedup/missing/malformed)
- 32/32 全量 lore tests pass (5 新 + 27 现有)
- 11/11 writer profile tests pass
- tsc 0 新错误
- spec §2.6 章节落地, §2.2/§2.4/§3/§4/§5 同步

## 累计 P1-3 minor 落位

| 累计 | 状态 | Minor |
|---|---|---|
| 4/11 | APPLIED (前置 P1-3 + I-1) | M-1 / M-5 / M-8 / lore-frontmatter |
| 4/11 | APPLIED (8 minor 批次) | M-2 / M-3 / M-7 / M-9 |
| 3/11 | APPLIED (3 minor 批次) | M-4 / M-6 / M-10 |
| **1/11** | **APPLIED (本次 M-11 批次)** | **M-11 carryOverPaths** |
| **11/11** | **总累计** | — |

## spec §8 验收 (维持)

7/7 维持. M-11 是 P1-3 链的最后一环, 但 spec §8 没新验收项 (carryOver 是算法行为, 不在 §8 范围内).

## 决策: worktree 处置

待用户拍板 (选项 1/2/3, 同 8 minor 批次 + 3 minor 批次 模式).
EOF
```

- [ ] **Step 5: 更新主工作区 03-archive-lockdown.md 跟踪表 (M-11 → APPLIED)**

定位: `/www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-3-archive/03-archive-lockdown.md`

将 `M-11 carryOver | DEFERRED | — (需 previous-chapter tracking + spec 决策)` 改为:
`| M-11 carryOver | **APPLIED** (commits xxx) | M-11 批次 (2026-08-19) |`

并更新 `minor 累计: 10/11 APPLIED` → `11/11 APPLIED`.

- [ ] **Step 6: worktree 物理删除 (待用户拍板)**

⚠️ 本步需用户先拍板 (选项 1: remove + retain, 选项 2: remove + delete branch, 选项 3: 保留 worktree). 不自行执行.

---

## Task 总览

| # | 类型 | 文件 | 估计 token |
|---|---|---|---|
| 1 | RED | lore-carryover-store.test.ts (5 cases, ~100 行) | 1.5k |
| 2 | GREEN | lore-carryover-store.ts (~80 行) | 1k |
| 3 | INTEGRATE | neuro-agent-harness.ts 2 调用点 (~10 行) | 0.5k |
| 4 | DOCS | spec v4.7 (3 section 改, ~60 行) | 1k |
| 5 | ARCHIVE | lockdown + cp + worktree (待用户拍板) | 0.5k |
| **总** | | | **~4.5k tokens** |
