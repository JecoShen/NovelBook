---
schema: nbook.task/v2
taskId: t04-postinstall-decoupling-matrix-slim
role: leader
---

# postinstall 解耦 + CI matrix 瘦身（P1-9/P1-10）

## 目标

install 链不被单包构建态绑架：根 postinstall 移除；harness dist 由唯一消费者 llmlint 自保证。CI matrix 按 ADR 0020/0021 调整；nb-ui 归档出 install/CI 面。

## 结果（2026-09-22 完成）

- 提交 `88560e00`：postinstall 移除（llmlint `harness:ensure` 挂 typecheck/test 链首）；nb-ui 移出 workspaces 与 matrix（5 格），退出三个 workflow 的 paths 面，目录原地归档加横幅；合同测试归档豁免改显式名单+反向断言。
- 验证：`bun install` 实测 665ms 无 harness 构建；matrix 选择器全量 5 格正确；`harness:ensure` 可用；workspace-workflows 14/14 绿；governance:check 零 failure。

## 跟随修复（2026-09-22，push 后 CI 首跑暴露）

- **web 孤岛漏网**：`workspace-packages.yml` 的 llmlint-web job 直连 `bun run typecheck`/`typecheck:server`/`build`（packages/llmlint/web/package.json），绕过了 llmlint 主包的 `harness:ensure` 链首；fresh checkout 无 harness dist，vue-tsc TS2307 全红（run 35669333076）。修复：web/package.json 加自己的 `harness:ensure`（`--cwd ../../neuro-agent-harness`）并挂到 typecheck/typecheck:server/build/dev/generate 五个链首。实证：本地 `rm -rf` harness dist 后按 CI 同序（nuxt prepare → typecheck）复跑。
- **dockerfile-contract 断言旧耦合**：`scripts/build/dockerfile-contract.test.ts:38` 断言根 postinstall 等于 harness 构建命令，与解耦决策直接冲突（CI Governance 红）。翻转为 `toBeUndefined()` 反向锁死；Dockerfile 内 build stage 显式构建 harness 的断言链保持不变。
- **存量红顺带收口**：`atomic-file-write.ts` 被 contracts 与 workspace-history 两层同时登记（P0 波次 cd9ce64e 遗留，fb768735/7e7d5bbb 两次 Code Baseline 均因此红）。唯一属主判定=contracts（本层 importer project-trash.ts；workspace-history 的 importer workspace-files.ts 经 project reference 的 paths 消费声明），从 workspace-history/tsconfig.json 移除后八层 typecheck 全绿。
- **教训**：本地验证必须跑 CI 的完整命令面（governance job = governance:check + scripts tsc + 六文件 vitest），子集全绿会掩盖确定性失败；fresh-checkout 与机存 dist 的差异是 install 链改动的固有盲区。
