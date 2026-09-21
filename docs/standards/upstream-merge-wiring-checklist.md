# 上游整树合并接线复核清单

本仓 `main` 是上游 `upstream/master` 的严格超集。整树跟随上游合并时，fork 独有的接线可能被上游版本就地覆盖而**静默失活**——`git status` 干净、无冲突提示，合并盲区常规 diff 看不出来。已发生三次（均登记于 `PROJECT-STATUS.md`）：

1. 分层 typecheck 被 `9076c082` 覆盖（2026-09-11 恢复）；
2. Source Authoring 类型投影被同次合并换成上游版，自有投影零调用（2026-09-11 恢复）；
3. `docs/tasks` 已密封迁移的 127 个条目从上游老树回魂（2026-09-12 清零）。

本清单是每次跟随上游整树合并后的**强制复核程序**（P1-11 制度化）。逐条执行并在合并提交说明或 `PROJECT-STATUS.md` 登记复核结果；任一核查失败按对应行的恢复路径处理，不把"看起来干净"当作通过。

## 一、合并盲区探测（先做，决定复核面）

```bash
# 合并引入的变更按第一父展开（普通 git log 会漏合并第二父带来的覆盖）
git log --full-history --oneline <merge-commit> -- <path>
git diff <merge-commit>^1 <merge-commit> -- <path>   # 显式第一父 diff
# 被合并静默删除的文件
git diff --diff-filter=D <merge-commit>^1 <merge-commit> --name-only
# 声称"已合并"的分支必须实际验证，不信登记
git merge-base --is-ancestor <branch> main && echo merged
```

## 二、fork 独有接线点（逐条核查）

| # | 接线点 | 核查命令 / 方法 | 通过判据 |
|---|---|---|---|
| 1 | 分层 typecheck | `bun run typecheck:layers` | 八层全绿、聚合退出码 0 |
| 2 | Source Authoring 类型投影 | `grep -rn "source-authoring-type-cache" packages/neuro-book/server/runtime/` 确认调用方非零；`Profile CLI 峰值 RSS < 768 MiB` 验收线 | 投影被实际调用，非上游全量类型图路径 |
| 3 | CI push[main] 触发 | `bun x vitest run --config scripts/vitest.config.ts scripts/ci/workspace-workflows.test.ts` | 合同测试全绿（含 code-baseline / workspace-packages / desktop-envelope 的 push 分支断言） |
| 4 | 分支名单一取值 | 检查 workflow 无 `origin/master`、`refs/heads/master` 残留（同 #3 测试覆盖）；`scripts/ci/default-branch.ts` 存在 | 无写死上游分支名 |
| 5 | client 体积预算门禁 | `bun scripts/build/client-chunk-budget.mjs --image-root <产物>` 复测 | eager 集合与单 chunk 均在预算内 |
| 6 | llmlint 投影同步 | 改 `packages/llmlint/skill` 后必须同提交跑 `system-assets:prepare` | 投影产物与 skill 源同 hash |
| 7 | `docs/tasks` 回魂 | `git ls-files docs/tasks` | 应为空（canonical 在 `.agents/tasks/` 与包级 `.agents/tasks/`） |
| 8 | 治理合同 | `bun run governance:check` | failures 为空 |
| 9 | nb-ui 归档状态（ADR 0021） | `grep -c "packages/nb-ui" package.json scripts/ci/workspace-package-matrix.ts` | 0；matrix 为 5 格 |
| 10 | postinstall 解耦（ADR 0020） | `grep -c postinstall package.json` | 0；harness 构建由 llmlint `harness:ensure` 驱动 |
| 11 | lint ratchet 基线 | `bun run lint:ratchet` | 实测计数 ≤ `scripts/ci/lint-baseline.json` |
| 12 | fork CI 平台收窄 | `scripts/build/product-platform-matrix.ts` 的 `FORK_CI_TARGET_PLATFORMS` 仅 `linux-x64-glibc` | 未被上游合并恢复为全平台日常门禁 |

## 三、巨型文件体量监控（ADR 0015 §4 挂钩）

快照（2026-09-20 架构审查实测，P1-8）：

| 文件 | 行数 |
|---|---|
| `packages/neuro-book/app/pages/index.vue` | 3,083 |
| `packages/neuro-book/app/stores/novel-ide.ts` | 2,040 |
| `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts` | 8,531 |
| `packages/neuro-book/app/components/agent/AgentChatSurface.vue` | 4,455 |
| `packages/neuro-book/server/api/config/global.put.ts` | 5,244 |
| `packages/neuro-book/server/agent/`（目录合计） | 108,845 |

每次上游整树合并或季度复核时重测（`wc -l` 上述五文件 + `find packages/neuro-book/server/agent -name '*.ts' | xargs wc -l | tail -1`），把新数值记回本节。任一文件较快照增长超过 50%，或出现 ADR 0015「重新评估清单」第 4 条证据（可复现的用户流程回归、多人合并冲突、无法隔离的 focused test 失败）时，按该清单新开独立 task/ADR 评估拆分，不在普通改动中顺手拆。

## 四、复核登记

- 复核结果（通过/失败/恢复动作）写入合并提交说明；涉及行为变化的恢复另按 [`../proposals/README.md`](../proposals/README.md) 立项。
- 本清单自身被上游合并改动时，以本仓 fork 版本为准恢复，并把冲突点补录为新的核查行。
