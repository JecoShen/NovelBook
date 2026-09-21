---
schema: nbook.task/v2
taskId: t02-lint-ratchet-gate
role: leader
---

# lint ratchet 门禁入 CI（P1-5）

## 目标

`bun run lint` 基线只降不升：`scripts/ci/lint-ratchet.ts`（ESLint API 实测计数对比 `scripts/ci/lint-baseline.json`），`--update` 只允许回填更低基线；挂入 `code-baseline.yml` lint job（全仓口径，无作用域过滤）。

## 结果（2026-09-22 完成）

- 提交 `5d38fde7`：棘轮脚本 + 合同测试 + 基线回填 2145 error / 1513 warning + CI lint job。
- 口径决策：profile `.compiled` 生成产物不计入（本机生成态、不入库、CI 全新 checkout 不可复现）；过滤定义在棘轮内，`eslint.config.mjs` 仓库级 ignore 受 config-protection 钩子保护，留待开发者确认。
- 验证：`lint-ratchet.test.ts` 3 例绿；`bun run lint:ratchet` 实测与基线持平通过。
