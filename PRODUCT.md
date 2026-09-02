# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

> Canonical product is the Nuxt 4 web app. Windows x64 Electron and Tauri Desktop shells share the same Workbench Chrome and design system; they are not a separate design language. macOS / Linux / Portable / Container / Manager are distribution shapes of the same web product.

## Users

**Primary**: Chinese web novelists (连载作者) writing commercial serialization for platforms like 起点 / 番茄. They produce multi-chapter novels, 50k–200k 字 per 卷, on a daily-update rhythm, and need to keep worldview, character state, and plot threads consistent across chapters written days or weeks apart, with AI assistance.

**Adjacent (same product, not split)**: Literary / long-form fiction writers who need a local-first worldbuilding and AI-assisted workflow without the daily serialization rhythm.

**Operating situation**: The author's work-in-progress is their primary asset. They cannot put it behind a third-party cloud-only service, and they cannot lose consistency between a 伏笔 in 卷 1 and a payoff in 卷 3.

## Product Purpose

NeuroBook is a local-first AI workspace for long-form novel writing. It exists because no neighboring product truthfully combines an event-sourced worldview, a structured two-angle plot model, a Markdown-native long-form editor, and a public AI writing-style linter, on a stack where the author's manuscript and worldview live on their own machine.

**Success means**: an author can keep multi-chapter consistency (world state, character state, plot threads) across a 百万字 novel, with AI assistance, without trusting their manuscript to a third-party cloud, and without losing the ability to revise a worldview decision and have every downstream scene re-derive from it.

## Positioning

The product mechanism a neighboring product could not truthfully copy is the **four-pillar combination** on a **local-first** stack:

1. **Event-sourced World Engine** — worldview is a stream of typed `patches` (replace / increment / remove / append), never direct mutation. Entry: `world-engine/schema/index.ts`; calendar entry: `world-engine/calendar.ts`.
2. **Two-tree Plot** — 承载树 (carrier tree, chapter presentation) × 因果树 (causality tree, plot organization), connected by `StoryScene`. Same scenes, two angles.
3. **Markdown Studio** — TipTap-based long-form editor; the manuscript is plain Markdown in a Project Workspace.
4. **llmlint** — public AI writing-style linter with 5 模式 detector (reversal TP 100% / FP 0%, short-drop TP 100%, plus suspense / dropSummary / scene six questions); ruleset that any AI-generated text must satisfy before the author accepts it.

Neighboring products each cover one or two pillars but not all four on a local-first stack. World Anvil / Campfire do worldbuilding but not novel-specific. NovelAI / Sudowrite do AI writing but not worldview-grounded. Scrivener does structured writing but not AI-assisted and not event-sourced.

## Operating Context

**Default writing pipeline** (the path a new author is walked through):

```
灵感探索 → Project / Lorebook → World Engine 初始化
        → 08 剧情规划与状态推进 → 09 章节写作 → 写后回补与修订
```

**Default Project layout** in a Project Workspace:

```
manuscript/    lorebook/    agents/    manual/    reference/    world-engine/
```

New projects no longer generate a `simulation/` directory. Default templates create only `leader.default/` and `writer/` contexts.

**Default chrome**:

- **Web / shared**: 48px Activity Bar (left) — 书架 / 文件 / 角色 / 剧情 / World / Jobs/Trace/History / 用户资产 / 账户 / 设置.
- **Desktop (Windows x64)**: 36px Workbench title bar (self-drawn) with a full dropdown menu (Electron native menu + Tauri page events cover 15 public commands). The browser/SPA path does not draw a fake title bar.

**State and cache boundaries**:

- `NEURO_BOOK_STATE_ROOT` — user state, source of truth. Installed Windows: `%LOCALAPPDATA%/NeuroBook/{data,cache,desktop}`. Portable: `data/` and `.cache/` next to the executable.
- `NEURO_BOOK_CACHE_ROOT` — rebuildable cache, source of truth for cache.
- App SQLite at `workspace/.nbook/neuro-book.sqlite`; per-Project SQLite at `<project>/.nbook/project.sqlite`.
- Project identity and display metadata: `<project>/project.yaml`.

**Distribution shapes** (one product, multiple shapes):

- Linux x64 / ARM64 Product; macOS x64 / ARM64 Product; Windows x64 Product; Windows Portable; Container (GHCR); Manager; Source.
- Desktop first-cut is Windows x64; macOS `.app`, public signing, updater, WebView2 distribution and Snap are not yet shipped.

**Dev workflow** (this is product truth, not just ops): branches follow `{type}/{refs}-{slug}`; work in `.worktree/<slug>`; squash-merge via PR; `main` is the only integration branch. Batch work uses the **archive mode** (worktree + cp + 0 push / 0 merge / 0 force-push) — see `AGENTS.md` and the audit archive memory chain.

## Capabilities and Constraints

**Confirmed v1 mainline** (Novel 写作模式 v1):

- World Engine: core model, API, Workbench, and author main path are landed. Tasks 56 / 65 / 71 cover this.
- Plot two trees: 承载树 × 因果树 with StoryScene bridge. Tasks 78 / 93 / 99.
- Markdown Studio (TipTap) + 48px shared Activity Bar + Desktop Workbench.
- Agent / Workflow main path landed; Provider API / Automatic Model Discovery merged via PR #101 (Task 104). Real Project, real external Provider, and full end-to-end browser flow are still pending.
- Project lifecycle, snapshot, path, runtime artifact contract landed. Cross-environment release verification still pending.
- llmlint 3.0.0 vendored; P1-3 lore-resolver (M-1..M-11 minor 11/11 APPLIED + I-1 production wiring 5 commits merged) with 32/32 lore + 16/16 writer profile tests passing; P1-4 scene-six-questions (level=low soft prompt, CJK-safe baseline, V1+V2 0/80 baseline); i134 perf 0.00/0.22/3.31 ms vs 100/20/50 ms thresholds (10000×/90×/15× margin).
- Product Runtime: 5-platform Product, Windows Portable, Container, public manifest/checksum and GHCR published as `0.9.6-canary.20260814.024826Z.9653191d`; 22 release jobs green.

**Confirmed technical constraints**:

- AGPL-3.0-only license. See `Brand Commitments`.
- The 4 protected assets (writer.profile.tsx, neuro-agent-harness.ts, server/agent/lore/*, llmlint) are `shared mutable on main` for the I-1 era — this is a documented exception, not a pattern. After the 5-audit batch, future batches return to the 0-push / 0-merge archive mode.
- Filesystem, Project SQLite, History SQLite, Session JSONL, Job JSON do not provide a global atomic transaction. Distributed-transaction or cross-language runtime is not on the table.
- Electron / Tauri spike retains some cross-language duplicated implementation. That is an accepted architectural boundary.
- Architecture debts (P2, not current runtime failures): `shared/Manager` runtime dependency cycle; `shared/server/agent` circular type dependency; core Facade single-class size; OpenAPI generated artifacts written back to route source. Boundary: see `docs/adr/0015-architecture-boundaries-and-deferred-structure.md`.

**Explicitly undecided** (recorded, not invented):

- Whether to publish a stable (non-canary) release and on what cadence.
- Whether the public Application Canary should bundle the Electron Desktop ZIP / Depot (currently it does not).
- macOS real package (`.app`), public signing, updater, WebView2 distribution.
- Real external Provider end-to-end flow with a real model.
- Browser-acceptance and real-author writing smoke for the full product loop (focused tests and typecheck pass; browser smoke does not replace them).

## Brand Commitments

- **Name**: NeuroBook. Public repository: `notnotype/neuro-book`. The product name is the brand.
- **License**: AGPL-3.0-only. This is a hard brand commitment: any product work must preserve copyleft, network-use disclosure, and source-availability obligations. Forking for non-AGPL re-licensing is not on the table.
- **Chinese-default UI and copy**: 简体中文 is the default surface; English is supported but is the secondary language. The product copy speaks the author's language.
- **Local-first data ownership**: the manuscript and worldview never leave the author's machine as a precondition of using the product. Cloud sync, if it ever lands, must be opt-in and never the only path to the manuscript.
- **AI as assistant, not author**: llmlint rules are enforced as a hard gate on AI-generated text. The author decides; the AI proposes. Style rules are public, vendored, and audited (5 模式 detector v0.3, scene six questions level=low, lore-resolver with carryOverPaths JSONL + 3-章 sliding window).
- **Open documentation surface**: docs/, reference/, docs/tasks/, docs/adr/, and the published Release notes are part of the product, not afterthoughts.
- **Theme system, not ad-hoc colors**: Novel IDE colors consume the variables registered in `app/utils/theme/README.md`; the 8 built-in themes are the contract. New themes register, not override.
- **Status color semantics are stable**: `warning` (草稿/待审/未保存), `success` (完成/已同步), `danger` (错误/删除/冲突), `info` (运行中/引用/说明), `accent` (选中/当前/主操作). Content / editor / chip category colors are exceptions, not violations.
- **Honest gaps**: capabilities still pending (stable release, macOS, signing, real external Provider, full browser-verified author flow) are documented in `PROJECT-STATUS.md` and `RELEASE.md`, not papered over. Future work must not invent evidence that does not exist.

## Evidence on Hand

Real evidence paths and counts; future work must not fabricate any of these:

- **Published Release**: `v0.9.6-canary.20260814.024826Z.9653191d` — 12 public assets, 22 jobs green, source revision `778ef7d413650472df847601607e5983aa31e949`, GHCR digest `sha256:34294b4a...`. See `PROJECT-STATUS.md` § "2026-08-14 `0.9.6-canary` 发布状态".
- **Manager**: `0.1.0-canary.54` public provenance verified.
- **llmlint 3.0.0** vendored (sibling `llmlint` repo). 5 模式 detector TP 100% / FP 0% on the locked baseline; P1-4 scene-six-questions baseline 0/80 (V1 + V2). Source: `docs/tasks/51-anti-ai-slop-skill/README.md`.
- **P1-3 lore-resolver + I-1 wiring**: 14 commits merged into `main` (`49e62466` etc.), spec v4.5 → v4.7, 32/32 lore + 16/16 writer profile tests, tsc 0 errors, i134 perf far under threshold. Source: `docs/superpowers/specs/2026-08-19-p1-3-lore-resolver.md`.
- **5 批次 audit archive**: 12 批次 archive-worktree 闭包, 0 push / 0 merge / 0 force-push policy intact; 4 protected assets shared mutable on main is the one documented exception. `main` HEAD `b25456a7..e7157647` pushed 2026-08-20.
- **A 区 fork-native tests**: e.g. profile-template-responsive fork-native contract test, 14/14 vitest pass, 0 new lint, 0 new typecheck. Source: `.agent/plan/a-5693eec-test-2026-08-27/`.
- **Task 145 Electron Desktop beta**: Windows x64 internal Desktop beta, real UAC flow and Windows Sandbox `--delete-data` 11/11 assertions. Real external Provider and macOS not yet shipped.
- **Task 143 Workbench Chrome**: 36px Desktop title bar, 48px Activity Bar, drag/no-drag, Settings, Quit verified via Electron CDP real package.
- **Test baselines**: 32/32 lore + 16/16 writer profile (P1-3) + 8/8 (P1-4) + 27/27 (recent core suite) + 30/30 (recent merge) + 14/14 (fork-native) + 46/46 (profile SDK) all green at the time of recording.

**Stated absences that future work must not fabricate**:

- A browser-verified real-author writing smoke for the full product loop.
- A stable (non-canary) release with public signing.
- Public Electron Desktop ZIP / Depot in the Application Canary.
- macOS `.app`, updater, WebView2 distribution, public signing.
- An iOS / Android product surface (only `web` is canonical; the project has no current plan to add one — re-evaluate before claiming it).

## Product Principles

1. **Local-first truth, not local-first marketing.** `NEURO_BOOK_STATE_ROOT` is the source of truth; `NEURO_BOOK_CACHE_ROOT` is rebuildable. The author's manuscript never depends on a network round-trip to exist. If a feature cannot honor this, it does not ship.

2. **Event-sourced worldview.** The World Engine is a stream of typed `patches` (replace / increment / remove / append), never direct mutation. This is what makes AI-assisted multi-chapter consistency tractable: a worldview decision in 卷 1 is replayable, auditable, and reversible without losing downstream scenes.

3. **Two angles on the same scenes.** 承载树 × 因果树 with `StoryScene` as bridge. Plot is not a single tree; it is the same scenes read two ways. Any UI that flattens this to a single tree is wrong.

4. **AI as assistant, not author.** llmlint rules are a hard gate. The author decides; the AI proposes. Style rules are public and audited, not proprietary black boxes.

5. **Honest gaps over papered-over claims.** Capabilities still pending (stable, macOS, signing, real external Provider, full browser-verified author flow) are recorded in `PROJECT-STATUS.md` and `RELEASE.md`. Future work must not invent evidence that does not exist, and must not claim "tested" when only "compiled" or "typechecked" is true.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established for the author audience yet. The web app is rendered with semantic HTML and is keyboard-navigable in the standard Nuxt 4 / Vue 3 way, but full WCAG 2.2 AA conformance for the long-form editor (focus management in Markdown Studio, screen-reader semantics for the World Engine tree view, etc.) has not been audited. This is a recorded gap, not a claim of conformance. Add a section here the first time a specific WCAG level, screen-reader contract, or internationalization requirement is set.
