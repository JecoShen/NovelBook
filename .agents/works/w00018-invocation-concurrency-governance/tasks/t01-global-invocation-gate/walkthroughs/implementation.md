# w00018 t01 walkthrough：planned Spec + 全局 invocation 信号量（p-010 A1）

2026-09-28 Tasker 实施。范围：planned Spec + 并发闸模块 + invokeCore 接线与各入口 concurrencyClass + agent.concurrency 配置登记链 + 观测与失败面映射。

## 实现

- **Spec**：`docs/specs/agent/invocation-concurrency.md`（capability `agent.invocation-concurrency`，status planned），p-010 全文合同写入；`docs/specs/README.md` 待实现规范表登记；`bridge-run-registry.ts` 头注释补记分工（入口预审 vs 运行段兜底）。
- **闸模块** `server/agent/harness/invocation-concurrency-gate.ts`：形态镜像 bridge-run-registry（`globalThis` 单例 `useInvocationConcurrencyGate()` + `resetInvocationConcurrencyGateForTests()`）。准入规则：总数 < `maxConcurrentInvocations` 且 background 同时占用 < 上限减保留位；同类严格 FIFO（同类有排队者时新到者必须入队），跨类只受容量约束（background 排满其容量时 interactive 仍可即时 acquire）。acquire 返回幂等释放函数，holders 以 invocationId 为键——延迟 finally 重复释放只命中已失效的 released 标记，碰不到后续持有者。排队：时间有界（acquireTimeoutMs 超时抛 `InvocationConcurrencyLimitError`，code `AGENT_INVOCATION_CONCURRENCY_LIMIT` 含占用/队列/limits 快照）；acquire 携带 abort signal，排队中取消即放弃（AbortError）。超时/abort 计时器 unref，drain 串行链（drainChain）+ `whenIdle()` 测试 seam。
- **配置热读**：acquire 入口读一次最新 limits；排队者的唤醒判定（drain）每次重读——配置上调后一次释放可同轮准入多个排队者（单测锁定）；已持有槽位不受影响。readLimits 抛错 fail-closed 到内置默认 2/1/60s，闸保持可用。
- **invokeCore 挂载**：admission 判定非 queued 之后、prepareRun 之前 acquire（IIFE try 首句），释放函数挂外层既有 finally（waiting 返回、abort、provider 异常、客户端断开、watchdog 强制返回全部同路释放）。acquire 抛错走 IIFE catch → `failInvocation`：超时 → `status:"error"` + `errorPhase:"pre_loop"`；failInvocation 对 `InvocationConcurrencyLimitError` 保留 `errorInfo.code` 与 `retryable:true`（既有 toRunKernelErrorInfo 不带 code，本 Task 显式补齐）。abort → `aborted:true` 走既有 aborted 终态，durable 只记 `status:"aborted"`。
- **concurrencyClass**：`InvokeAgentInput` 新增内部字段（不进公开 DTO、不进 durable），缺省 interactive。显式标注：bridge 路由 / invoke_agent 后台 job / workflow activity / summarizer / follow-up drain = background；invoke_agent 前台 / moveTree 随行 = interactive。不由 `caller.kind` 推导（workflow-agent-port 保持 `kind:"user"` 不动）。
- **失败面映射**（全部沿既有失败面，无新失败形态）：
  - UI：`http.ts` `throwOnInvocationConcurrencyLimit` — invokeAgentSession 与 moveAgentSessionTree 对 code 命中抛 `createError(503)`（p-010 决策 5）。
  - bridge 路由：code 命中抛 `createError(429)`，与既有 BridgeConcurrencyLimitError 预审并列（SOP 依赖 429=占槽语义）。
  - invoke_agent 前台：code 命中在工具内 throw → 既有工具异常面 `isError:true`；后台 job：`status:"error"` → 既有 `run()` throw → job failed 回流。
  - workflow：`status:"error"` → 既有 throw → activity 失败 → run failed。summarizer：`status:"error"` → 既有 lastError 写回。drain：`acceptance.state!=="persisted"` → 既有 pauseFollowUpAdmission。后五者零代码改动（错误结果自然流入既有分支），仅标注 concurrencyClass。
- **观测**：appLogger jsonl 五事件——`agent.concurrency.queued`（queueDepth）/ `acquired`（waitMs）/ `timeout`（快照，warn）/ `rejected`（排队中 abort）/ `released`（heldMs）；`snapshot()` 输出 activeByClass / queueDepth / 五累计计数。rejected 语义 = 排队中 abort（时间有界排队无深度上限，无其它立即拒绝路径），已在 Spec 注明。
- **配置链** `agent.concurrency`（global-only，p-010 决策 3）：`shared/dto/config.dto.ts` `AgentConcurrencyConfigDtoSchema`（六字段 int 下界守卫，Global default({}) + Update optional）→ `server/config/types.ts` `AgentConcurrencyConfig` → `server/config/normalizer.ts` 逐字段范围守卫 fail-closed + `reservedInteractiveSlots` 钳到 < maxConcurrentInvocations → 重生成 OpenAPI meta（4 条路由：global.put / editor-snapshot.get / profile-home reset / project.put）。A2/A3 三字段（4/32/4）登记但本阶段零行为。

## 验收证据

1. **闸单测**（`invocation-concurrency-gate.test.ts`，vitest 9/9）：FIFO 顺序、类别保留（bg 占满时 interactive 即时 acquire + 反向等待）、超时拒绝（typed error 含快照、计时窗口断言）、释放幂等 + 防延迟误释放、排队中 abort 放弃、入队前已 abort 直抛、配置热读（drain 重读、上调后单轮双准入）、readLimits 抛错 fail-closed。✓
2. **harness 集成**（`invocation-concurrency.integration.test.ts`，vitest 4/4）：假 provider 8 并发跨 session——同时进入运行段 ≤2（探针工具实测 maxActive=2、闸快照 2 持 6 排）、其余排队后被服务（全部 completed、totals queued=6/acquired=8/released=8/timeout=0）；超时路径 typed error（code + pre_loop + retryable 逐项断言）。✓
3. **槽位泄漏守门**：abort（用户取消）/ provider 抛错（error stopReason）/ 客户端断开（input.signal）三路径后 `snapshot().active.total === 0`。✓
4. **bridge 回归**：bridge-run-registry 测试与 invoke.post 既有 429 用例不动全绿；新增闸超时 → 429 并列映射用例（含 concurrencyClass=background 断言 + release 仍执行）；UI 503 映射 http.test.ts 3 用例（invoke / moveTree 随行 / 非闸错误不误伤）。✓
5. **低负载一致 + 配置热读**：harness 全目录 25 文件 377 测试零改动全绿（存量并发/abort/follow-up/排队用例即低负载不变式主体证据）；集成测试锁定改 config 免重启（max 1→2 上调后排队者按新上限同轮双准入，已持槽位完成不受影响）；归一化 5 用例（默认值/合法值/逐字段 fail-closed/保留位钳断/project 不遮蔽）。✓

## 门禁

- `typecheck:layers` 八层聚合退出码 0（闸模块登记进 agent 层——它依赖的 appLogger 与 harness 同属该层）。
- `lint:ratchet` 2145 error / 1513 warning，与基线持平（新文件零 error；首跑 +3 全在本人新文件：unused import/unused var/any 包装，已修）。
- `docs:check` 6081 文件零 failure；`governance:check` 零告警。
- 套件：harness 目录 25 文件 377 + 闸单测/集成 13 + tools/workflow-port/config 106 + workflow/api-agent 152 + shared/dto 42 + http 45 + bridge 13，全绿。

## 偏差与决定

1. **acquire 位置在 IIFE try 首句**（非 admission 与 prepareRun 之间的字面中点）：admission 后到 prepareRun 之间的 resolutions 处理/标题写入/附件校验同属运行段开销，纳入槽位覆盖更贴近「运行段有界」语义；waiting 返回仍随外层 finally 释放，与 Task 挂载要求等价。
2. **超时错误经 failInvocation 收口为 error 结果而非裸抛**：admission 后 invocation 已登记（activeInvocations/lifecycle start），裸抛会泄漏 invocation 状态；error 结果 + errorInfo.code 保留使各入口映射成为纯检查（UI/bridge 转 createError，工具/后台链自然流入既有 status:"error" 分支）。bridge 的「并列捕获」落地为与预审 catch 并列的 code 检查。
3. **观测事件 rejected 的语义归位**：p-010 列了 queued/acquired/timeout/rejected/released 五事件但未定义 rejected 触发点；本实现 rejected = 排队中 abort 放弃（时间有界排队无深度上限，不存在其它立即拒绝路径），Spec「输出与可观察行为」节已写明。
4. **normalizer `acquireTimeoutMs` 下界 1000ms**：亚秒排队超时在生产是病态配置；集成测试首跑写 300 被 fail-closed 成 60s 撞 vitest 60s 超时——实测印证了下界守卫的必要性（测试已改 1000 并在注释说明）。
5. **drain 重读配置的粒度**：每个排队者在每轮 drain 各读一次 effective config（队列深度为个位数、配置读取与 prepareRun 既有每 invocation 读取同阶），不为它引入缓存/单飞复杂度。

## 观察（非本 Task 范围）

- 嵌套前台 invoke 的死锁降级路径（leader 持槽 → 子 agent 排队 → 超时逐层释放）由闸语义保证，未做专项 e2e（需要双层 profile + 饱和编排，留待饱和压测 Task 覆盖）。
- A2/A3 配置字段已随链登记（maxParallelToolCallsPerTurn/maxToolCallsPerTurn/maxActiveJobs），本阶段零行为；实现时无需再动配置链。
- 饱和压测验收（p-010 验收 6：生产或等效受限环境混合入口 8 并发）属后续 Task + 独立授权。
- 生产生效无需部署附加动作：默认配置下低负载行为不变；配置热读使上调免重启。部署后可用 `agent.concurrency.*` jsonl 事件面观察排队/超时频率再调参。

## 未运行项

- 真实 Provider/Model e2e（假 provider 已覆盖运行段并发合同；真实模型只改变运行段时长，不改变闸语义）。
- 浏览器人工验收：无前端可见面变更（排队对 UI 透明，超时才经既有失败面呈现）。
