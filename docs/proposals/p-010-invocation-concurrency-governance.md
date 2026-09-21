# P-010：Agent Invocation 并发治理（全局槽位 + 工具执行有界）

- 状态：draft（提交开发者评审）
- 来源：`.local/architecture-review-2026-09-20.md` P1-4（三轮复核属实）；方向已由开发者拍板（全局 invocation 有界槽位 + parallel 工具执行有界），本提案落成可评审设计

## 问题

生产部署是单核半~2C、小内存 VPS（earlyoom 水位 10%）。当前除 bridge 入口外，Agent 调用链没有任何全局并发治理，三条无界路径叠加：

1. **全局 invocation 无槽位**：UI chat、invoke_agent 工具（前台/后台）、workflow activity、summarizer、follow-up drain 可任意并发进入 harness 运行段。每个运行中的 invocation 持有完整会话上下文、模型流式响应与工具执行现场，内存随并发数线性上涨；饱和时唯一"保护"是 earlyoom 杀进程。
2. **parallel 工具执行无界**：模型单轮输出的全部 parallel 工具调用直接 `Promise.all` 并发执行，单 turn 工具数本身也无上限；病态输出（如一轮几十个 read/bash）会瞬时放大内存与子进程压力。
3. **AgentJobManager 无并发上限**：`spawn` 立即开始执行，后台 bash job 每个都起一个真实子进程，数量无界。

系统已经知道缺并发治理（bridge registry 的注释明说"在那里限流会误伤前端"），但只在外部入口打了补丁，harness 内部与后台路径全部裸露。

## 目标与非目标

目标：

- 全局 invocation 有界槽位，覆盖**所有**进入 harness 运行段的入口（UI、bridge、invoke_agent、workflow、summarizer、follow-up drain、moveTree 随行 invoke）
- 槽位满时有界排队 + 超时拒绝，拒绝语义沿各入口既有失败面呈现；嵌套前台 invoke（leader → 子 agent）在饱和下不死锁，超时把死锁降级为有界错误
- 交互类（UI 对话）与后台类（workflow、后台 job、summarizer、drain）分级，后台类不能占满全部槽位饿死交互
- parallel 工具执行 per-turn 宽度有界、单 turn 工具总数有上限；`executionMode: "sequential"` 工具语义不变
- AgentJobManager 活动执行数有界，超出排队
- 低负载下可观察行为与今天完全一致；新行为只在饱和时可见
- 观测：排队、获取、超时、拒绝进入 jsonl 日志面

非目标：

- 单 invocation 的 turn 数上限与成本/预算治理（run loop `while (shouldContinue)` 无 turn 上限是事实，但属预算治理范畴，另行提案）
- Provider 侧 RPM/配额限流
- 多进程/多实例并发治理（PM2 单实例形态不变）
- UI 队列位置展示、排队进度条（v1 排队对 UI 透明，只在超时后呈现错误）
- bridge registry 的废除或合并（保留为入口预审，见方案）

## 当前行为与证据

**唯一既有限流是 bridge 入口预审**：

- `packages/neuro-book/server/agent/bridge/bridge-run-registry.ts:12-13`：per-project=1、global=2，硬编码常量，未登记进 config；`:55-73` acquire 任一上限即抛 `BridgeConcurrencyLimitError`，释放函数幂等且按 sessionId 防误释放
- `packages/neuro-book/server/api/agent/bridge/sessions/[sessionId]/invoke.post.ts:44-53`：路由捕获后映射 HTTP 429；`:15` 注释明确"bridge 不排队，桥并发限流由 registry 承担"

**invocation 唯一汇合点是 `invokeCore`**（从代码推断，逐入口核实）：

| 入口 | 路径 | 现状 |
|---|---|---|
| UI chat | `server/api/agent/sessions/[sessionId]/invocations.post.ts` → `http.ts:173-178` → `invokeAgent` | 无任何限流；`block:false` 未实现（harness `:1176-1177`），全部阻塞式 |
| bridge | 上表路由 → `invokeAgent`（`:65-79`） | 仅 bridge registry 预审 |
| invoke_agent 前台 | `tools/agent-collaboration-tools.ts:178` → `invokeAgent` | 无界；该工具 `executionMode: "parallel"`（`:105`），可与兄弟工具并发 |
| invoke_agent 后台 | `tools/agent-collaboration-tools.ts:140-164` → `jobs.spawn` → `invokeAgent` | 无界 |
| workflow activity | `workflow/workflow-agent-port.ts:26-34` → `invokeAgent`（caller kind 为 `"user"`） | 无界；`workflow-job.ts:66-78` 把 run 纳入 Job 生命周期但 Job 本身也无界 |
| summarizer | `neuro-agent-harness.ts:4193` → `invokeAgent`（internalQueued） | 无界 |
| follow-up drain | `neuro-agent-harness.ts:6391` → `invokeStored`（internalQueued） | 无界 |
| moveTree 随行 invoke | `neuro-agent-harness.ts:3523` → `invokeCore`（preadmitted） | 无界 |

- 每 Session 的串行化已存在（`admitInvocationLocked`，同 session 并发走 follow-up 排队或 `active_invocation_exists`），但这是会话级互斥，不是全局资源闸
- `invokeCore`（`:1174`）结构：admission → 排队快进快出（`:1241-1254`，不占资源）→ 运行段（prepareRun `:1325` → runLoop `:1361` → finalize/settle）→ 外层 `try/finally`（`:1440-1446`）；waiting 返回即结束本次运行段，人工等待期间不占运行资源

**工具执行无界**：

- `neuro-agent-harness.ts:5685-5687`：segment 内非 sequential 即 `Promise.all` 全量并发；`:5683-5684` sequential 判定 = 调试开关 `toolExecution === "sequential"` 或 segment 内含 `executionMode: "sequential"` 工具；`:5830-5833` 缺省按 `"parallel"`
- 单 turn 工具数为模型输出的全部 toolCall（`:4974` 起逐一处理），无总数上限（审查复核行 220 已确认）

**Job 执行无界**：

- `agent-job-manager.ts:139-184`：`spawn` 登记后 `record.promise = this.execute(record)` 立即执行，无并发闸；`:34` 注释自明 bash 走 owned-process
- `tools/file-tools.ts:386` 起：后台 bash job 每个 spawn 一个真实子进程；bash 工具本身是 `executionMode: "sequential"`（`:383` 附近），只约束同 turn 内，不约束跨 job

**配置面先例**：

- `server/config/types.ts:201-222`：`ObservabilityConfig`/`PiTraceConfig` + `DEFAULT_PI_TRACE_MAX_BYTES_PER_BUCKET` 常量；`:268-270` `StoredGlobalConfig.observability` 为 Partial（global-only，`StoredProjectConfig` 不含）
- `server/api/config/global.put.ts:1600-1629`：对应 JSON Schema 登记（该文件为大体量生成式 schema，新增字段按同模式插入）
- bridge 的 per-project/global 限额目前**不在** config 面，是 registry 构造参数默认值

## 方案、备选方案和取舍

### 方案 A（推荐）：三道闸，全部配置化

**A1. 全局 invocation 信号量（ InvocationConcurrencyGate ）**

新模块 `server/agent/harness/invocation-concurrency-gate.ts`，形态镜像 bridge-run-registry（`globalThis` 单例、acquire 返回幂等释放函数、按 invocationId 防延迟 finally 误释放），语义不同：bridge registry 是**拒绝式预审**，本闸是**有界排队式兜底**。

- **挂载点**：`invokeCore` 内，admission 判定为非 queued（即本次真的进入运行段）之后、`prepareRun` 之前 acquire；外层既有 `finally`（`:1442-1446`）统一释放。waiting 返回自然释放（运行段已结束）；abort、provider 异常、客户端断开、强制 watchdog 返回全部经同一 finally 释放
- **排队**：FIFO；acquire 携带本次 invocation 的 abort signal——排队中用户取消/客户端断开即放弃排队，走既有 aborted 终态
- **超时**：acquire 超过 `acquireTimeoutMs`（默认 60s）抛 `InvocationConcurrencyLimitError`（code `AGENT_INVOCATION_CONCURRENCY_LIMIT`，含当前占用/队列深度快照）。各入口既有失败面吸收：UI 路由 → HTTP 503 + code；bridge 路由 → 429（与既有 BridgeConcurrencyLimitError 并列捕获）；invoke_agent → 工具 isError 结果；workflow → activity 失败 → run failed；后台 invoke job → job failed 并回流；summarizer → 记 lastError 下轮再试；follow-up drain → 既有 `pauseFollowUpAdmission` 暂停语义
- **分级**：槽位分两类——`interactive`（UI invocations、moveTree 随行 invoke、invoke_agent 前台/嵌套链）与 `background`（bridge、invoke_agent 后台 job、workflow activity、summarizer、follow-up drain）。后台类最多同时占 `maxConcurrentInvocations - reservedInteractiveSlots` 个槽；交互类可用全部槽。分类不由 `caller.kind` 推导（workflow-agent-port 现在用 `kind: "user"`，从代码推断无法可靠区分），而在各入口显式传 `concurrencyClass` 内部字段（不进公开 DTO）；未显式标注的新入口缺省 `interactive`（偏向不阻塞人）
- **默认值**（对齐本机部署现实）：`maxConcurrentInvocations=2`（与 bridge global=2 的现状等价，低负载行为不变）、`reservedInteractiveSlots=1`、`acquireTimeoutMs=60000`
- **嵌套死锁**：leader（占 1 槽）前台 invoke 子 agent（再占 1 槽），第三层嵌套排队而持有者都在等它——有界等待在超时后报错逐层释放，死锁被降级为有界错误；这是取舍不是缺陷，避免嵌套无限等待
- **配置热读**：每次 acquire 尝试时读最新 effective config（仿 `:2054` 每次 invocation 读 config 的现状），改 config 免重启生效；已持有槽位不受影响（从代码推断可实现，实现时以单测锁定）

**A2. per-turn 工具执行闸**

- `executeToolSegment`（`:5685-5687`）的 `Promise.all` 改为宽度有界池：同 segment 最多 `maxParallelToolCallsPerTurn`（默认 4）个工具并发，结果仍按 index 排序回放，事件序列不变
- 单 turn 工具总数上限 `maxToolCallsPerTurn`（默认 32）：超出部分不执行，按既有 skipped 形态（`:5835-5872` 三个 skippedToolResultsAfter* 先例）合成 `isError` 结果告知模型"超出本轮工具预算"，不静默丢弃
- `executionMode: "sequential"` 判定与 segment 边界逻辑（`:5427-5446` flushSegment）零改动；sequential 工具仍整段串行

**A3. AgentJobManager 有界执行**

- Manager 内部加活动执行闸：`maxActiveJobs`（默认 4）。`spawn` 同步语义、 durable 登记、事件发布全部不变；超出上限的 job 在 Manager 内部 FIFO 等待执行槽
- v1 不新增公开 job 状态（避免 DTO/durable schema/UI 连锁改动、零迁移）：等待中的 job 快照仍为 `running`，preview 置"等待执行槽位"；终态、取消、waitIdle、recovery 语义不变。取消等待中的 job 直接出队
- 与全局闸的关系：独立池但方向无环——job 闸 →（运行段内）全局 invocation 闸，反向不存在；invoke 类 job 在全局闸排队时仍占 job 槽（可接受：job 槽上限宽于 invocation 槽）

**bridge 既有限流的处置：保留入口预审 + 全局兜底**

- 保留理由：per-project=1 提供全局闸刻意不含的项目级公平性；429 立即拒绝是 bridge CLI 的既有合同（SOP 依赖"429=占槽"语义重试）；预审在 HTTP 层挡掉无谓的 admission 工作
- bridge 的 caller（external-cli）在全局闸归 `background`：bridge 主要服务批处理自动化（主编制 SOP），人机交互优先级让位给 UI；两个并发 bridge run 在今天都能立即跑，新行为下第二个在全局闸排队 ≤60s——只在饱和时可见的变化，正是治理目标

### 方案 B：把 bridge 模式推广到各入口（入口各自限流）

UI 路由、workflow 启动、invoke_agent 各自加 registry。拒绝理由：harness 内部入口（summarizer、drain、嵌套 invoke、moveTree）绕不过入口层，依然裸露；每个入口重复实现且语义漂移；入口间无法共享全局视图，总量仍无界。

### 方案 C：单池纯 FIFO（不分级）

实现最简，但 workflow 长 activity 可占满 2 槽数分钟，UI 用户对话排队到超时报错——单用户本地优先产品上，人必须优先于后台 churn，不可接受。

### 方案 D：无限排队不拒绝

嵌套前台 invoke 在饱和时自死锁（持有者互等），必须有界等待兜底；无限等待也把"资源不足"藏成"永远转圈"，违反失败可见原则。

### 取舍结论

A 落地；B/C/D 记录为放弃项。A 的代价：harness 核心路径引入排队语义（需要槽位泄漏测试兜底），config 面新增一组字段，AgentJobManager 内部状态机多一个等待段。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无持久化格式变化。闸是进程内存态，重启即清空；AgentJobManager durable schema 不变（不新增 job 状态）
- **接口**：
  - config 新增 `agent.concurrency`（global-only，仿 `observability.piTrace` 登记模式）：`maxConcurrentInvocations`、`reservedInteractiveSlots`、`acquireTimeoutMs`、`maxParallelToolCallsPerTurn`、`maxToolCallsPerTurn`、`maxActiveJobs`，全部带默认值，缺省配置行为 = 本提案默认值
  - harness 内部输入新增 `concurrencyClass` 字段（不进公开 DTO、不进 durable 消息）
  - 超时错误对外仅新增错误 code `AGENT_INVOCATION_CONCURRENCY_LIMIT`（UI 503 / bridge 429 映射）；不改变任何成功路径响应形状
- **安全**：无新攻击面；闸本身是资源耗尽防护。密钥等凭据不经手
- **迁移**：零迁移；既有会话、队列、durable store 不受影响
- **发布**：默认值下低负载行为与现状一致，可直接随常规发布上线；生产验证 = 饱和压测 checklist（见下节）
- **回滚**：config 把 `maxConcurrentInvocations` 调到极大值即近似关闭 A1（A2/A3 同理），无需回滚代码；完全回滚 = revert 对应 commit，无数据残留
- **观测**：jsonl 新增 `agent.concurrency.queued / acquired（含 waitMs）/ timeout / rejected / released（含 heldMs）` 事件，复用 `appLogger` 面；闸提供 `snapshot()`（activeByClass、queueDepth、累计超时/拒绝计数）供测试与诊断入口消费

## 对 Spec 的预期改动

- 新建 `docs/specs/agent/invocation-concurrency.md`，capability `agent.invocation-concurrency`，成熟度 `planned`，owner 同 agent 域；冻结过渡期的 `assets/reference/agent/` 不改动，新 Spec 直接落在 `docs/specs/agent/` 并在 `docs/specs/README.md` 待实现规范表登记
- Spec 要点（按模板）：输入=各入口 invoke 请求与 `agent.concurrency` config；状态=闸的内存占用/队列（非持久）；副作用=jsonl 观测事件与排队等待；失败语义=超时 typed error 沿各入口既有失败面（UI 503、bridge 429、tool isError、run/job failed、summarizer lastError、drain pause）；不变式=同时运行段 ≤ 配置上限、background 占用 ≤ 上限减保留位、任何退出路径释放槽位
- 验收依据（实现 Task 必须闭合）：
  1. 闸单测：FIFO 顺序、类别保留（background 占满时 interactive 仍可 acquire）、超时拒绝、释放幂等、排队中 abort 放弃、防延迟误释放
  2. harness 集成：假 provider 下 8 并发跨 session invocation，同时进入运行段 ≤2，其余排队后被服务；超时路径返回 typed error
  3. 工具闸：单 turn 10 个 parallel 工具实测最大并发 4、结果顺序不变；第 33 个工具获得合成 isError 结果；sequential 工具段仍串行
  4. Job 闸：6 个后台 bash job 并发子进程 ≤4；取消排队中 job 不出队执行
  5. 槽位泄漏：abort / provider 抛错 / 客户端断开三路径后 `snapshot().active` 归零（防回归守门）
  6. 饱和压测（生产或等效受限环境）：混合入口 8 并发打满，无 OOM、无死锁，全部完成或 typed error；background 饱和时 UI 对话仍可进入运行段
  7. bridge 回归：既有 429 合同与 `bridge-run-registry` 测试不动
- 连带更新：`docs/specs/README.md` 登记；`packages/neuro-book/server/agent/bridge/bridge-run-registry.ts` 头注释补一句与全局闸的分工（入口预审 vs 运行段兜底）

## 决策记录

- 2026-09-22：Leader 起草（依据架构审查 P1-4，证据经三轮复核；开发者已拍板"全局有界槽位 + parallel 工具执行有界"方向）。待开发者评审：
  1. 默认值组合（2 / 1 / 60s / 4 / 32 / 4）是否认可本机单核半~2C 小内存现实
  2. bridge（external-cli）归 background 类是否符合 CLI 批处理使用现实，还是应算 interactive
  3. v1 不做 per-project 二级限额（仅 bridge 自带 per-project=1 预审）是否接受
  4. v1 排队对 UI 透明、超时才报错，不做队列位置展示是否接受
  5. UI 侧超时映射 HTTP 503（而非 409/429）是否认可
