---
schema: nbook.work/v1
workId: w00015-summarizer-writeback-regression
issueId: null
---

# summarizer 写回回归修复

Full tests 存量红（`neuro-agent-harness.test.ts` 三个 summarizer 用例，自 ≥7e7d5bbb 确定性失败）的定位与修复。开发者 2026-09-22 指示"下一步"立项。

根因：2026-09-14 `d4d1694d` 把生产 overlay（state root 装机期物化、重启不同步）里残留的 `write-source-summary` settleRun 写回 hook 误判为"canonical 静默丢失"回灌 canonical profile；实际写回链（含 titleOwner 用户改题保护、脏守卫）自 session-v2 账本迁移起已收归生产 harness 自有（`neuro-agent-harness.ts:4232/1522`），overlay 残留是迁移前旧设计的陈旧物化。回灌后 profile hook 与 harness 写回形成双写回路径，互相干扰：

- 受管 profile 多出不许有的 settleRun hook（test:5281 断言锁死"生产发布路径不再跨 session 写回"）；
- 脏守卫场景写回互相抵消，title 回落为默认 profile 名（test:5440 期望 `Fresh Title` 实测 `Summarizer Stale`）；
- rename 锁标题场景同理失效。

修复 =  revert `d4d1694d` 两个文件（canonical profile 移除 hook、删除锁定错误设计的 contract test）；harness 层行为不变，测试断言即设计锁，无需改动。

生产推论：现网 overlay 仍带旧 hook，目前双写回路径并存但终态由 harness 写回兜底，无用户可见事故；本次修复部署后经 state root 资产同步收敛 overlay。
