---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.invocation-concurrency
owners:
  - agent-runtime
---

# Agent Invocation 并发治理（全局槽位）

所有进入 harness 运行段的 invocation 经过一道进程级并发闸：全局有界槽位、interactive/background 分级、FIFO 有界排队（时间有界）、超时 typed error 沿各入口既有失败面收口。低负载下可观察行为与闸引入前完全一致；新行为只在饱和时可见。批准依据为 p-010（2026-09-24 accepted），本规范覆盖其 A1（全局 invocation 信号量）；A2（per-turn 工具执行闸）与 A3（AgentJobManager 有界执行）是后续阶段，配置字段随本规范预留但不产生行为。

## 目标与非目标

目标：

- 全局 invocation 有界槽位覆盖**所有**进入 harness 运行段的入口：UI chat、bridge、invoke_agent（前台/后台）、workflow activity、summarizer、follow-up drain、moveTree 随行 invoke。
- 槽位满时 FIFO 排队 + 超时拒绝；拒绝语义沿各入口既有失败面呈现，不新增面向用户的失败形态。
- interactive（UI、moveTree 随行、invoke_agent 前台/嵌套链）与 background（bridge、invoke_agent 后台 job、workflow、summarizer、drain）分级：background 同时占用 ≤ `maxConcurrentInvocations - reservedInteractiveSlots`，不能占满全部槽位饿死交互。
- 嵌套前台 invoke（leader → 子 agent）在饱和下不死锁：超时把死锁降级为有界错误。
- 观测：排队、获取、超时、拒绝、释放进入 jsonl 日志面；闸提供 `snapshot()` 供测试与诊断。

非目标：

- per-turn 工具执行宽度/总数上限（p-010 A2，后续阶段）。
- AgentJobManager 活动执行数上限（p-010 A3，后续阶段）。
- 单 invocation 的 turn 数上限与成本/预算治理（p-010 已声明非目标）。
- Provider 侧 RPM/配额限流；多进程/多实例并发治理（PM2 单实例形态不变）。
- per-project 二级限额（p-010 决策 3：v1 不做，仅 bridge 自带 per-project=1 预审）。
- UI 队列位置展示（p-010 决策 4：排队对 UI 透明，超时才报错）。
- bridge registry 的废除或合并：它保留为入口预审（per-project 公平性 + 429 立即拒绝的 CLI 合同），本闸是运行段兜底。

## 术语与参与者

- **运行段**：`invokeCore` 内 admission 判定为非 queued 之后的执行区间（prepareRun → runLoop → finalize/settle）。admission 排队（follow-up/steer 入队）快进快出，不占槽位；waiting 返回即结束本次运行段，人工等待期间不占槽。
- **闸**：进程级单例（`globalThis`，镜像 bridge-run-registry 形态），进程内存态，重启即清空。
- **concurrencyClass**：`interactive | background`，各入口显式传递的内部字段，不进公开 DTO、不进 durable 消息；未显式标注缺省 `interactive`（偏向不阻塞人）。不由 `caller.kind` 推导。
- **有界排队**：时间有界——acquire 超过 `acquireTimeoutMs`（默认 60s）即拒绝；v1 无队列深度上限。

## 输入与前置条件

- 配置节 `agent.concurrency`（global-only，登记链按 `observability.piTrace` / `agent.loreContext` 先例）：
  - `maxConcurrentInvocations`（默认 2）：同时处于运行段的 invocation 上限。
  - `reservedInteractiveSlots`（默认 1）：只为 interactive 保留的槽位数；background 同时占用 ≤ 上限减保留位。
  - `acquireTimeoutMs`（默认 60000）：排队超时。
  - `maxParallelToolCallsPerTurn`（默认 4）、`maxToolCallsPerTurn`（默认 32）、`maxActiveJobs`（默认 4）：A2/A3 预留，本阶段不产生行为。
- 非法配置值 fail-closed 回落对应字段默认值；`reservedInteractiveSlots` 收敛到 `< maxConcurrentInvocations`。
- **配置热读**：每次 acquire 尝试读最新 effective config，改配置免重启生效；已持有槽位不受影响（不撤销）。

## 输出与可观察行为

- 低负载（槽位未满）：行为与事件序列和闸引入前一致；acquire 即时返回。
- 饱和：后续 acquire 按 FIFO 排队（同类内严格 FIFO；跨类只受容量约束——background 占满其容量时 interactive 仍可 acquire，反之 interactive 占满时 background 等待）。排队对 UI 透明。
- 排队超时：抛 `InvocationConcurrencyLimitError`（code `AGENT_INVOCATION_CONCURRENCY_LIMIT`，含占用/队列快照），经 `failInvocation` 收口为 `status: "error"` 结果（`errorPhase: "pre_loop"`，`retryable: true`），各入口映射：
  - UI 路由（invoke / moveTree 随行）→ HTTP 503 + code；
  - bridge 路由 → HTTP 429（与既有 `BridgeConcurrencyLimitError` 并列）；
  - invoke_agent 前台 → 工具 `isError` 结果；后台 job → job failed 并回流；
  - workflow → activity 失败 → run failed；
  - summarizer → 记 `lastError` 下轮再试；
  - follow-up drain → 既有 `pauseFollowUpAdmission` 暂停语义。
- 排队中取消：acquire 携带本次 invocation 的 abort signal，排队中用户取消/客户端断开即放弃排队，走既有 aborted 终态（durable 只记 `status: "aborted"`）。
- 观测事件（appLogger jsonl）：`agent.concurrency.queued`（含 queueDepth）、`agent.concurrency.acquired`（含 waitMs）、`agent.concurrency.timeout`（含快照）、`agent.concurrency.rejected`（排队中 abort）、`agent.concurrency.released`（含 heldMs）。
- `snapshot()`：`activeByClass`、queueDepth、累计 queued/acquired/timeout/rejected/released 计数。

## 状态与转换

闸的状态即其内存占用表与 FIFO 队列（非持久）：

| 状态 | 进入条件 | 行为 | 出口 |
|---|---|---|---|
| 空闲 | active < 上限 | acquire 即时返回释放函数 | — |
| 排队 | active 达上限或类别容量满 | FIFO 等待；配置上调在下次唤醒可见 | 获槽 → 持有；超时 → typed error；abort → 放弃 |
| 持有 | acquire 成功 | 运行段执行；释放函数幂等、按 invocationId 防延迟 finally 误释放 | 外层既有 finally 统一释放（含 abort、provider 异常、客户端断开、watchdog 强制返回） |

嵌套死锁转换：嵌套前台 invoke 排队而全部持有者在等它时，`acquireTimeoutMs` 后超时逐层释放——死锁被降级为有界错误（p-010 取舍，非缺陷）。

## 副作用与数据

- 无持久化格式变化；闸是进程内存态，重启即清空。既有会话、follow-up 队列、durable store 不受影响。
- 每次进入运行段新增一次 global config 读取（热读），成本与 prepareRun 既有每 invocation config 读取同阶。
- 观测日志每 acquire 生命周期追加 ≤3 行（queued? → acquired/timeout/rejected → released），行体积有界（计数与快照，不含消息正文）。
- 超时错误结果与 aborted 终态复用既有 durable lifecycle 写入，无新 entry 类型。

## 失败与恢复

- 超时：`AGENT_INVOCATION_CONCURRENCY_LIMIT` typed error，沿上表各入口既有失败面收口；不向 invoke 传播未捕获异常。
- 排队中 abort：放弃排队，走既有 aborted 终态。
- 配置读取失败/非法值：fail-closed 到默认值，闸保持可用。
- 槽位泄漏防回归：abort、provider 抛错、客户端断开三路径后 `snapshot()` 占用归零（验收 3 守门）。
- 回滚：config 把 `maxConcurrentInvocations` 调到极大值即近似关闭本闸，无需回滚代码；完全回滚 = revert，无数据残留。

## 边界与兼容

- 默认配置下低负载行为与闸引入前一致；升级、回滚均不需要数据迁移。
- bridge 既有 429 合同与 bridge-run-registry 测试不动（入口预审 vs 运行段兜底的分工写入其头注释）。
- 成功路径响应形状不变；对外仅新增错误 code `AGENT_INVOCATION_CONCURRENCY_LIMIT`（UI 503 / bridge 429 映射）。
- A2/A3 配置字段已预留登记但本阶段零行为；`executionMode: "sequential"` 工具语义、Job spawn 同步语义不变。

## 验收与 Smoke

1. 闸单测：FIFO 顺序、类别保留（background 占满时 interactive 仍可 acquire）、超时拒绝、释放幂等、排队中 abort 放弃、防延迟误释放。
2. harness 集成：假 provider 下 8 并发跨 session invocation，同时进入运行段 ≤ 2，其余排队后被服务；超时路径返回 typed error。
3. 槽位泄漏：abort / provider 抛错 / 客户端断开三路径后 `snapshot()` 占用归零（防回归守门）。
4. bridge 回归：既有 429 合同与 `bridge-run-registry` 测试不动；UI 超时映射 503。
5. 低负载（单 invoke）行为与事件序列和现状一致；配置热读单测锁定（改 config 免重启生效，已持槽位不受影响）。
6. 饱和压测（生产或等效受限环境，后续 Task）：混合入口 8 并发打满，无 OOM、无死锁，全部完成或 typed error；background 饱和时 UI 对话仍可进入运行段。

## 实现合同

> 尚未实现。实施 Work：w00018；首个 Task：t01（本 Spec 落地 + 全局 invocation 信号量 A1）。

- 闸模块为 harness 内部设施，形态镜像 bridge-run-registry（`globalThis` 单例、acquire 返回幂等释放函数、按 invocationId 防误释放）；挂载点为 `invokeCore` admission 判定非 queued 之后、prepareRun 之前，外层既有 finally 统一释放。
- `concurrencyClass` 只进 harness 内部输入类型，不进公开 DTO 与 durable 消息；配置登记链（zod → types → normalizer → 重生成 OpenAPI meta）对齐 piTrace/loreContext 先例。

## 证据

- p-010 提案与 2026-09-24 拍板：`docs/proposals/p-010-invocation-concurrency-governance.md`。
- 现状唯一限流：`packages/neuro-book/server/agent/bridge/bridge-run-registry.ts`（入口预审，per-project=1、global=2）。
- 挂载点：`packages/neuro-book/server/agent/harness/neuro-agent-harness.ts` `invokeCore`。
