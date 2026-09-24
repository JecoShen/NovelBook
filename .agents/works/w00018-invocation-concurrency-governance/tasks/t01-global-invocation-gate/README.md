---
schema: nbook.task/v2
taskId: t01-global-invocation-gate
role: tasker
---

# planned Spec + 全局 invocation 信号量（p-010 A1）

## 目标

落地 p-010 A1：新模块 `server/agent/harness/invocation-concurrency-gate.ts`（形态镜像 bridge-run-registry：`globalThis` 单例、acquire 返回幂等释放函数、按 invocationId 防延迟 finally 误释放），挂载 `invokeCore` admission 判定为非 queued 之后、`prepareRun` 之前，外层既有 finally 统一释放。interactive/background 分级、FIFO 有界排队、超时 typed error 沿各入口既有失败面收口。

## 范围

- Spec：新建 `docs/specs/agent/invocation-concurrency.md`（capability `agent.invocation-concurrency`，status planned），全文合同按 proposal 写入；`docs/specs/README.md` 登记；`bridge-run-registry.ts` 头注释补一句与全局闸的分工（入口预审 vs 运行段兜底）。
- 实现：闸模块（FIFO；类别保留：background 同时占用 ≤ `maxConcurrentInvocations - reservedInteractiveSlots`；acquire 携带 abort signal，排队中取消即放弃；超时抛 `AGENT_INVOCATION_CONCURRENCY_LIMIT` 含占用/队列快照）；各入口显式传 `concurrencyClass` 内部字段（不进公开 DTO，缺省 interactive；bridge/invoke_agent 后台/workflow/summarizer/drain 标 background）。
- 配置：`agent.concurrency`（global-only：`maxConcurrentInvocations=2`、`reservedInteractiveSlots=1`、`acquireTimeoutMs=60000`，并为 A2/A3 预留 `maxParallelToolCallsPerTurn=4`、`maxToolCallsPerTurn=32`、`maxActiveJobs=4`），登记链对齐 piTrace 先例；每次 acquire 热读最新 effective config。
- 观测：jsonl `agent.concurrency.queued / acquired(waitMs) / timeout / rejected / released(heldMs)`，复用 appLogger 面；`snapshot()`（activeByClass、queueDepth、累计超时/拒绝）供测试与诊断。
- 失败面映射：UI 路由 → HTTP 503 + code；bridge 路由 → 429（与既有 BridgeConcurrencyLimitError 并列捕获）；invoke_agent → 工具 isError；workflow → activity 失败；后台 invoke job → job failed 回流；summarizer → lastError 下轮再试；follow-up drain → 既有 pause 语义。
- 嵌套前台 invoke 饱和时超时把死锁降级为有界错误（提案取舍，非缺陷）。

## 验收

1. 闸单测：FIFO 顺序、类别保留（background 占满时 interactive 仍可 acquire）、超时拒绝、释放幂等、排队中 abort 放弃、防延迟误释放。
2. harness 集成：假 provider 下 8 并发跨 session invocation，同时进入运行段 ≤2，其余排队后被服务；超时路径返回 typed error。
3. 槽位泄漏：abort / provider 抛错 / 客户端断开三路径后 `snapshot().active` 归零（防回归守门）。
4. bridge 回归：既有 429 合同与 bridge-run-registry 测试不动；UI 超时映射 503。
5. 低负载（单 invoke）行为与事件序列和现状一致；配置热读单测锁定（改 config 免重启生效，已持槽位不受影响）。
