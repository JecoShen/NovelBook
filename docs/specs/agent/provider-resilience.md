---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.provider-resilience
owners:
  - agent-runtime
---

# Agent Provider 韧性

一次 provider 错误不应直接等于一次 invocation 失败。本规范定义产品级重试/backoff、profile 降级链与 CJK 修正 token 估算的行为合同；批准依据为 p-009（2026-09-24 accepted）。

## 目标与非目标

目标：

- 可分类错误（429/5xx/网络断开/超时）按指数 backoff + jitter 产品级重试，带次数与总预算上限，全程可取消、可观测（事件 + trace）。
- 不可重试错误（4xx 鉴权/参数、content_filter、用户取消）维持快速失败，不放大 provider 压力。
- profile 可声明有序备用模型列表（`fallbackModelKeys`），主模型重试耗尽后按门禁降级，允许跨 provider；压缩摘要可独立声明摘要模型（`summaryModelKey`，默认维持主模型）。
- token 估算对 CJK 文本不再系统性低估：压缩触发判定、keepRecent 选界、上下文窗口断言、上下文面板与 trace 分区共用同一 CJK 分段口径；usage 真实值优先语义不可覆盖。
- 重试中与降级有明确的界面状态与最终失败文案；bridge/headless 调用面错误语义一致。
- 存量 session 与 profile 零迁移；新配置默认值不改变成功路径行为。

非目标：

- 全局 invocation 并发槽位（`agent.invocation-concurrency`，p-010 范围）。
- 已产出模型可见输出后的断流重试/续传（v1 partial 保留语义不变）。
- pi-ai 包内部 `clampMaxTokensToContext` 的 chars/4 估算替换（node_modules 内无注入点；其影响方向是 maxTokens 钳制偏松，provider 侧 400 兜底且属不可重试参数错误，语义自洽）。
- 跨 session 的 provider 熔断/冷却与按 provider 健康度统计；指标/告警面；OpenRouter/网关级路由（后续增强候选）。

## 术语与参与者

- **invocation / turn**：一次 Agent 调用的整体与其中单轮；主 turn 与压缩摘要（compaction summary）是本规范覆盖的两类 provider 调用。
- **模型可见输出**：流向用户侧的流式 start/partial 事件；compaction 为非流式调用，天然无可见输出。
- **零输出门禁**：仅当本次 attempt 未产出任何模型可见输出时才允许重试与降级。
- **可重试错误**：429、5xx、网络层错误（连接失败/重置/超时）。**不可重试错误**：4xx 鉴权与参数错误（400/401/403/404/422）、content_filter、用户取消（abort）。**无法归类的错误一律视为不可重试**（fail-closed）。
- **usage 优先语义**：上下文估算以最近一条有效 assistant usage（provider 真实值）为准，只对其后的 trailing 段做本地估算；aborted/error 或零值 usage 不作数。
- **fallback 候选**：`fallbackModelKeys` 声明的有序备用模型；候选使用其自身 provider 的凭据与请求配置。

## 输入与前置条件

- 配置节 `agent.resilience`（global、next-run 生效）：`enabled`（默认 true）、`maxAttempts`（默认 3，含首次）、`baseDelayMs`（默认 1000）、`retryBudgetMs`（默认 90000）、`respectRetryAfter`（默认 true）。登记链按 `observability.piTrace` 先例（zod → types → normalizer → registry → 重生成 OpenAPI meta）。
- Profile 模型配置增加可选 `fallbackModelKeys: string[]`（默认空 = 不降级）；保存校验复用 `inspectModelReferences` 的 runnable 口径。
- `ProfileCompactionRuntimePatch` 增加可选 `summaryModelKey`（默认 null = 维持主模型，兼容现状）；`fallbackModelKeys` 对实际选中的摘要模型同样生效。
- SDK 层 `maxRetries`（`DEFAULT_PI_MAX_RETRIES = 5`）维持不变，两层并存最坏 `maxAttempts × (1 + maxRetries)` 个请求；文档引导希望产品层完全接管策略的 provider 将 `requestOptions.maxRetries` 调低。

## 输出与可观察行为

- 成功路径事件序列与现状逐点一致：重试只在零输出失败时介入，对用户不可见。
- 重试中：custom 事件 `provider.retrying`（attempt/maxAttempts/delayMs/错误分类/modelKey），界面显示瞬时状态；零输出门禁保证此刻尚无流式气泡。
- 降级：custom 事件 `provider.fallback`（from/to modelKey、原因分类）；最终 assistant 消息自带真实应答模型身份（`provider`/`model` 字段），气泡标注实际模型。
- 最终失败：错误文案含重试史摘要（"已重试 N 次"/"已切换 M 个备用模型仍失败"）；`errorInfo.phase` 维持 `"model"`，bridge/headless 结构一致。
- trace：每次 attempt 经统一入口各落一条记录，重试/降级全程可回放。
- token 估算：CJK session 的上下文面板读数与"离压缩还有多远"显著上升、压缩触发时机提前——这是修复的直接效果，不是回归；发布说明需点名。

## 状态与转换

本能力不引入持久状态。单次 provider 调用的尝试状态机：

| 当前 | 事件 | 下一状态 | 条件/拒绝 |
|---|---|---|---|
| attempt 失败 | 错误可重试 ∧ 零输出 ∧ 预算未耗尽 | backoff 等待 | 延迟 = baseDelayMs × 2^(attempt-1) 内 full jitter；Retry-After 可得则尊重并封顶 |
| attempt 失败 | 错误不可重试 ∨ 已有可见输出 ∨ 预算耗尽 ∨ abort | 按现状收口（partial 闭合/failed） | 不可重试错误不触发 fallback |
| 主模型重试耗尽 | 存在 fallback 候选 | 顺序尝试下一候选 | 每候选独立走完整重试策略；零输出门禁同样适用；修正后估算超候选 `contextWindow` 跳过该候选 |
| 全部候选不可行 | — | 按末次错误收口 | 错误文案含重试史摘要 |
| backoff 等待 / 候选切换中 | abort | 立即收口 | 不重试不降级，对齐 `agent.session-abort` 语义 |

预算只累计 backoff 等待时间，attempt 本身的流式时长不计入。

## 副作用与数据

- session jsonl 格式不变；历史 compaction entry 的 `tokensBefore`（旧估算口径）不回填、不参与新判定。
- 新增两个 custom 事件名（`provider.retrying`/`provider.fallback`）为增量，老前端忽略未知 custom 事件即可。
- trace 每 attempt 一条；无新增持久化数据；新增配置全部可选。

## 失败与恢复

- 错误分类依据 `errorMessage` 前导状态码解析 + 网络错误模式匹配（v1 接受字符串解析的已知脆弱点）；无法归类 = 不可重试。
- 重试/降级的每一步失败都收口到既有失败语义，不新增失败种类。
- 回滚：`agent.resilience.enabled: false` 即回现状失败语义；`fallbackModelKeys` 清空即无降级；估算器为纯函数替换，回退即恢复 chars/4 口径（已按新口径触发的 compaction entry 不受回退影响，语义自洽）。

## 边界与兼容

- 密钥只从既有 provider config 读出直接交给 HTTP client，不进事件 payload、trace、日志与错误正文；错误分类不把 provider 原始 body 扩写进 UI 文案（`provider-error-sanitizer` 既有边界不变）。
- `AgentProfileModelConfig` 与 `ProfileCompactionRuntimePatch` 新字段全部可选；存量 profile 未声明时行为与现状逐点一致。
- 周期 summarizer 的 profileKey 路由维持既有机制不动。

### token 估算与压缩触发合同（本 Task 已先行落地）

- 本地估算唯一入口为 stored message 估算模块（零 npm 运行时依赖）；导出签名不变，内部为 CJK 分段启发式：CJK 段（统一表意文字及扩展区、假名、諺文、全角标点）按 1.5 字符/token，其余段按 4 字符/token，每条消息加少量 overhead 常量；图片/附件维持 4800 字符固定成本口径（折合 1200 token）。
- 方向刻意偏高估：压缩提前触发是安全侧，低估才是事故侧（chars/4 对 CJK 重内容实测低估约 2.4 倍）。系数校准依据：2026-09-23 生产 traces 实测 CJK 重文本 1.69 字符/token（p10–p90 1.63–1.71）、ASCII 主导 4.1–4.75；验收误差带 ±25%。
- usage 优先语义不变：provider 真实 usage 不被本地估算覆盖，CJK 修正只作用于 trailing 段与无 usage 路径。
- trace 分区（system/tools/消息段）、对话正文摘要估算、`get_session` recentMessages tokenBudget 守卫与压缩触发线共用同一估算入口，不得另起 chars/4 本地副本。

## 验收与 Smoke

1. 429 故障注入：faux provider 连续 429×2 后 200 → invocation 成功、2 条 `provider.retrying` 事件、3 条 trace 记录。
2. 401/400 → 立即失败，零重试、零 fallback。
3. 持续 429 超 `retryBudgetMs` → failed，错误文案含重试史；等待期间 abort → 立即收口。
4. 首个模型可见输出后断流 → 不重试不 fallback，partial 按现状闭合。
5. 主模型耗尽 → fallback 候选应答成功，`message.model` 为候选模型、事件齐全；上下文估算超候选窗口 → 跳过该候选。
6. CJK 估算基准：真实文本 fixture 与实测值对拍误差带 ±25% 内；同一 CJK session 修正前后 `shouldCompact` 判定时机对照留证。
7. 兼容：未配置新字段的存量 profile 全量行为测试无 diff。

## 实现合同

尚未实现（整体）。token 估算与压缩触发条款已于 2026-09-24 先行落地（证据见下节）；重试执行器、fallback 路由、事件/配置面与前端可见状态随后续 Task 落地，全部证据闭合后本文件原地晋升为 `implemented`。

## 证据

- 批准依据：[`../../proposals/p-009-provider-resilience.md`](../../proposals/p-009-provider-resilience.md)（2026-09-24 accepted，Q1–Q6 逐项拍板；含 2026-09-23 生产 traces CJK 实测校准记录）。
- 估算条款落地（w00017 t01，2026-09-24）：`bun run --cwd packages/neuro-book test -- server/agent/messages/stored-message-tokens.test.ts server/agent/messages/stored-message-presentation.test.ts server/agent/observability/trace-segments.test.ts server/agent/harness/compaction.test.ts` 全绿；`shouldCompact` 修正前后对照见该 Task `evidences/`。
- 其余条款：随后续 Task 补充。
