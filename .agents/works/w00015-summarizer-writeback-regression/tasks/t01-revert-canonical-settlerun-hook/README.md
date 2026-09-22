---
schema: nbook.task/v2
taskId: t01-revert-canonical-settlerun-hook
role: leader
---

# 回退 d4d1694d canonical settleRun hook 错误移植

## 目标

消除 summarizer 双写回路径：canonical profile 移除 `write-source-summary` settleRun hook，恢复"harness 自有写回、profile 不跨 session 写回"的设计锁，Full tests 三用例转绿。

## 诊断链（2026-09-22）

1. 失败签名定位：test:5281 断言受管 profile 无 settleRun hook（注释明示"锁定生产发布路径不再跨 session 写回"）；test:5440 实测 title=`Summarizer Stale`（默认 profile 名=写回未生效）。
2. 引入窗口 9/12 全绿~9/20 红，窗口内唯一直接相关提交 = 9/14 `d4d1694d`（summarizer writeback 回写链从生产 overlay 回灌 canonical）。
3. 双源对照：测试 import 的受管 profile = canonical 资产（`assets/workspace/.nbook/agent/profiles/builtin/summarizer.profile.tsx`，即 d4d1694d 所改）；harness 内嵌最小版（`server/agent/profiles/summarizer-profile.ts`）本就无 settleRun。
4. 前提证伪：d4d1694d 称写回链与 readTitleOwner 保护"只存在于生产 overlay"，实际 harness 层自有（`neuro-agent-harness.ts:4232` 写回含 titleOwner=auto 才写标题、`:1522` 改名保护）；overlay 残留是 session-v2 迁移前旧设计的陈旧物化（state root 装机期物化、重启不同步，见 9/18 资产同步记录）。
5. 消费面普查：`write-source-summary` 全仓仅 d4d1694d 两个文件引用，revert 安全。

## 结果（2026-09-22 完成）

- 提交 `5cffd0ad`：`git revert --no-commit d4d1694d`（195 行纯删除：profile 移除 hook + 删 contract test）。
- contract test 删除而非反转：其 4 用例全部断言被移除行为；harness 测试 5281/5440/rename 锁三用例即设计锁，不重复立否定式守卫。
- 验证：`neuro-agent-harness.test.ts` 195/195（修复前 192/195，本地复跑确认）；`profile-summarizer`/`profile-source-imports`/`profile-sdk-contract` 12/12。
- 未运行：catalog/profile-dsl 等大文件套件（与改动面无交集，等 CI Full tests 完整面）；profile 全量编译普查属部署时动作。

## 教训

- **overlay 与 canonical 漂移时，先定性 overlay 的新旧再决定移植方向**：state root 物化层可能是被故意淘汰的旧设计，"canonical 缺"不等于"canonical 丢"。本例若先查 harness 是否已接管（4232 行证据），即可避免回灌。
- 设计锁注释（test:5278 "锁定生产发布路径不再跨 session 写回"）是最高优先级证据，改动与其冲突时先信锁。
