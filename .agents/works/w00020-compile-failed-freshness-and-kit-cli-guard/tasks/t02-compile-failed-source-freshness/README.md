---
schema: nbook.task/v2
taskId: t02-compile-failed-source-freshness
role: tasker
---

# compile_failed manifest 源码新鲜度

## 目标

消除 `catalog.ts:746-751` 的不对称：`compile_failed` entry 短路新鲜度校验、源码变化后仍无限期重放旧失败（loaded entry 每次 resolve 都过 sourceSha 失效链，失败态没有）。

## 范围

- `ProfileFreshnessChecker` 新增 `sourceMatches(profileRoot, item)`：只比较源码指纹（`hashFile` 复用，`profile-artifact-compiler.ts:1224` 已导出），不触碰 artifact 字段（失败 entry 无 artifactFileName，走 `validateProfileArtifact` 会在 `:1135` join undefined 抛 TypeError）。
- `catalog.ts` 失败分支：指纹一致→维持重放（现状）；失配→按 `not_compiled` 收口（当前源码无编译记录是诚实状态）+ fire-and-forget `enqueueBuild({fileName, reason: "compile_failed_source_changed"})` 自愈（未挂 coordinator 只 invalidate；自限：重编成功转 loaded，再失败记录新指纹恢复重放，不会反复入队）。
- 回归测试（镜像 `catalog.test.ts:1068` compile_stale 用例）：失败后改源码→snapshot 不再含 compile_failed、按 not_compiled 呈现；失败后不改源码→仍重放（现状语义锁）。RED 先跑（临时根，安全）。
- 不处理：project 级 child coordinator 的 bootSweep（读路径自愈已覆盖主场景，登记 Work 后续项）。

## 验收

1. 新回归用例 RED→GREEN；`catalog.test.ts` 全绿。
2. 失败未改源码的重放语义不变（既有用例与新语义锁用例双绿）。
3. `bun run --cwd packages/neuro-book test -- server/agent/profiles` 相关套件绿；typecheck 八层无新增错误；lint 棘轮不升。
