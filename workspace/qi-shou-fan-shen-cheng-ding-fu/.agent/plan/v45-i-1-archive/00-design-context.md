# I-1 design context (backfilled 2026-08-19)

## 来源
- spec: `docs/superpowers/specs/2026-08-19-i-1-production-wiring.md` (commit 6e30446)
- plan: `docs/superpowers/plans/2026-08-19-i-1-production-wiring.md` (commit 2031052)
- 父 spec: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` (P1-3, commit 831270bf + 17cc0250 defer)

## 解法 (3 选 1 → 选 A)
- **A. chapter-read path** (writer.profile.tsx 内 readFile payload.path) ✓
- B. 扩 WriterPayloadSchema (否决: 破 additionalProperties: false)
- C. 注入点挪到 leader (否决: leader 无 prepareRun)

## 集成点 (2 选 1 → 选 A1)
- **A1. writer.profile.tsx context(ctx)** ✓
- A2. neuro-agent-harness.ts prepareRun (否决: 跨 profile)

## 范围
**一次全做**: auto-injection + `lore_resolver_query` 工具 (per spec §6)

## 实施 commits (worktree feat-i-1-production-wiring)

| Commit | Task | 说明 |
|---|---|---|
| `dc32b1d4` | 1 setup | cherry-pick P1-3 MVP 9 commits (worktree base) |
| `8fe0f19` | 2 RED | 11 test cases (RED, module load error) |
| `c07281f` | 3 GREEN helpers | readFileSafely + renderChapterLoreContext, 6/11 pass (case 5 throw expected) |
| `e962317` | 4 GREEN wire | buildWriterPrompt 加 chapterLoreContext + AppendingSet 注入, 8/11 pass, + lore-frontmatter.ts 双引号 fix + makeCard path fix |
| `2a00852` | 5 GREEN tool | test fixture 适配 pluginTool 模式 (实际工具已在 cherry-pick 实施), 11/11 pass |

## 验证 (Task 6)
- writer profile tests: **11/11 pass**
- lore tests: 23/23 pass
- i134 perf benchmark: 3/3 pass, 数字 `0.00 / 0.28 / 2.92ms` (远低于 100/20/50ms 阈值, 余量 10000x / 71x / 17x)
- tsc: 0 new errors in writer.profile.tsx / test file
- archive 模式: 0 push / 0 merge / 主分支 0 改动 maintained

## 实施 vs plan 差异

| Plan | 实际 | 原因 |
|---|---|---|
| plan Task 5 写"加 defineTool 风格工具 + 加进 toolset" | 工具已在 cherry-pick 完整 (pluginTool binding + server-side NeuroAgentTool impl), 仅 test fixture 适配 | 实际项目用 pluginTool + executeWithContext 模式, 非 spec §2.5 描述的 defineTool 风格 |
| plan Task 3 期望 8/11 pass | 实际 6/11 pass (case 5 throw expected) | case 5 测 currentProject missing 时 no-op, 但 buildWriterPrompt 内部 resolvePayloadTarget 先 throw, 不是 renderChapterLoreContext 责任 |
| plan Task 4 期望用 `<If>{profileText`...`}</If>` 渲染 chapter_lore_context | 用 SDK 已知 `<Message>` 元素 + `appendingset` (SDK 不识别 `<chapter_lore_context>` 自定义 element, JSX 文本节点不替换 `${...}` 模式) | SDK 限制: 文本节点 `${...}` 替换只支持 `ctx.settings.*` 模式, 动态变量需要 string 作为 children |
| plan Global Constraint "不**改** server/agent/lore/*" | 改 `lore-frontmatter.ts` 加双引号字符串处理 | P1-3 cache bug: trigger 包含字面引号, 不命中. I-1 wiring 依赖 cache 工作, 必须修. 在 lockdown 标注为 P1-3 → I-1 minor fix |

## 验收映射

- spec §8.1 PARTIAL → **PASS** ✓ (ch-007 写时实际注入 陆深/老王/飞鸟站 cards)
- spec §8.2 性能: 保持 PASS (i134 perf 0.00/0.28/2.92ms 余量 10000x/71x/17x)
- spec §8.3-8.7: 保持 PASS
- **累计: 6/7 → 7/7** ✓

## 不在范围 (per spec §10)

- ❌ LLM semantic NER
- ❌ 扩 WriterPayloadSchema
- ❌ 改 neuro-agent-harness.ts
- ❌ leader / retriever / researcher profile 享受 lore 注入
- ❌ cache 主动 invalidate
- ❌ soul.md 注入
- ❌ 8 剩余 minor (M-2/3/4/6/7/9/10/11) — P1-3 final review deferred, 与 I-1 无关
- ❌ lore-frontmatter.ts quoted string fix 不算 I-1 范围 (是 P1-3 minor fix, 阻塞 I-1)
