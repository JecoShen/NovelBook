---
schema: nbook.task/v2
taskId: t06-proposal-drafts
role: leader
---

# P1-2/3/4/6b 四份 proposal 起草（p-008~p-011）

## 目标

把开发者已拍板方向落成可评审 proposal：p-008 nb-memory 接主链、p-009 Provider 韧性、p-010 并发治理、p-011 fork 发布门禁。

## 结果（2026-09-22 完成）

- 4 代理并行起草（只读调查 + 各写一份 proposal），Leader 逐份审阅后入库，提交 `e4e9f6d9`；`docs/proposals/README.md` 活跃清单登记。
- 四份均为 draft，各自带开放问题清单待开发者评审：p-008 七项（阶段划分/配置命名/延迟预算/shadow 门槛/trigger 终态/备份面/项目级覆盖）、p-009 六项（enabled 默认/SDK 重试叠加/4xx 不降级/摘要模型默认/CJK 系数/错误分类解析）、p-010 五项（默认值组合/bridge 归类/无 per-project 限额/排队透明/503 映射）、p-011 五项（校验强度/漂移报告/fail-fast 守卫/Portable-GHCR 语义/命名）。
- 实施前置关系：p-008/p-009/p-010 评审 accepted 后另立实施 Work；p-011 评审后可直接实施（触点零改动设计）。
