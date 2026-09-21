# ADR 0020：neuro-agent-harness 产品定位收口（llmlint 专用验证件）

- 状态：Accepted
- 日期：2026-09-22
- 决策者：开发者
- 关联：2026-09-20 全量架构审查 P1-1（`.local/architecture-review-2026-09-20.md`）、[ADR 0015](0015-architecture-boundaries-and-deferred-structure.md)、[w00002](../../.agents/works/w00002-neuro-agent-harness-redesign/README.md)、[w00014](../../.agents/works/w00014-p1-architecture-convergence/README.md)

## 背景

仓库内存在两代 Agent harness：

1. **生产 harness**（`packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`，8,531 行）：承载全部产品语义，是 UI、bridge、workflow 唯一在用的运行时。
2. **独立内核**（`packages/neuro-agent-harness`，7,608 行 src，CHANGELOG 103 轮）：w00002 章程本就声明"不接入 NeuroBook 产品"，但迭代中持续扩张产品语义；唯一消费者是 llmlint（`packages/llmlint` 的 agent 调用测试面）。

两代语义各自演化、方向不明：架构审查判定这是"新内核永远追平不了旧 harness 产品语义"的沉没风险，每轮内核迭代都在加深分叉；同时 postinstall 强制构建该包（P1-10）、CI matrix 为其单设一格（P1-9），每次 install 与 CI 都在为未接线资产付费。

候选方向：a) 立生产迁移路线图（大工程，迁移期双轨成本更高）；b) 降级收口；c) 维持双轨加语义对齐机制（成本最高，审查报告明确列为风险源）。

## 决策

开发者 2026-09-22 拍板：**降级收口**。

1. `packages/neuro-agent-harness` 的正式定位是 **llmlint 专用验证件/研究件**：继续服务 llmlint 的 agent 调用测试与验证场景，不追求接入 NeuroBook 生产链。
2. **冻结产品语义扩张**：不再向该包迁入或新建面向产品能力的语义（会话产品语义、工作流、写作域能力等）；维护性修复（bug、依赖升级、llmlint 需求）不受限。
3. 生产 harness 继续是唯一生产运行时；其产品语义演进不受独立内核形态约束。
4. 工程面随动：postinstall 不再强制构建该包（改为消费方 llmlint 自保证，见 w00014 t04）；CI matrix 保留该格（llmlint 依赖它，构建与验证仍需门禁）。
5. w00002 按本决策收口：其"不接入产品"的章程结论固化为长期定位，不再保留"未来可能接入"的开放表述。

## 后果

- 沉没风险止付：独立内核只在 llmlint 需求驱动下演进，产品语义单轨（生产 harness）。
- 承认独立内核 103 轮投入不进生产；其验证件价值（llmlint 消费、架构实验场）保留。
- 生产 harness 的巨型单点问题（P1-8）由 ADR 0015 §4 继续管理，与本决策正交。

## 重开条件

出现以下任一情况时重新评估本决策（新开 ADR，不顺手回摆）：

- llmlint 消费形态消失（规则引擎不再需要 agent 调用面），该包失去唯一消费者；
- 生产 harness 出现 ADR 0015 §4 清单内的拆分触发证据，且评估认为独立内核是更优迁移目标；
- 独立内核需要被第二个宿主（非 llmlint）真实消费。
