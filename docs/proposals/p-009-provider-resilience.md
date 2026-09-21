# P-009：Provider 韧性（429 重试/backoff + fallback chain + CJK token 估算器）

- 状态：draft（提交开发者评审）
- 来源：`.local/architecture-review-2026-09-20.md` P1-3（三轮复核属实）；方向已由开发者拍板（429/backoff/重试 + fallback chain + CJK 真 tokenizer 覆盖估算器），本提案落成可评审设计
- 姊妹提案：[`p-010-invocation-concurrency-governance.md`](./p-010-invocation-concurrency-governance.md)（并发槽位治理，正交）

## 问题

一次 429 限流在今天等于一次 invocation 失败：harness 层拿到 `stopReason === "error"` 直接收口为 `kind: "failed"`，用户看到"生成失败"，正在进行的写作任务（多 turn run、压缩摘要）整体中断。具体三个缺口：

1. **无产品级重试/backoff**：harness 层对 provider 错误零重试、零等待策略、零用户可见状态。SDK 层虽对部分 adapter 有不可见的内建重试（见证据），但策略不可控、无事件、无预算，耗尽即失败。
2. **无 fallback chain**：一次 invocation 只绑定一个模型；主模型限流/故障时没有降级路径。压缩摘要固定使用主模型，不能用便宜模型兜底；周期 summarizer 的 profileKey 路由是既有先例，但主对话与压缩摘要都没有等效机制。
3. **chars/4 假 tokenizer 驱动压缩触发线**：上下文估算对 CJK 文本低估 2–4 倍（审查结论），而它是压缩触发线、keepRecent 选界、上下文窗口断言与前端"离压缩还有多远"面板的共同数据源。中文长篇小说（本产品主场景）下压缩触发严重晚于真实窗口，实际后果是把上下文溢出风险转嫁给 provider 侧 400。

## 目标与非目标

目标：

- 产品级重试：可分类错误（429/5xx/网络断开/超时）按指数 backoff + jitter 重试，带次数与总预算上限，全程可取消、可观测（事件 + trace）
- 不可重试错误（4xx 鉴权/参数、content_filter、用户取消）维持快速失败，不放大 provider 压力
- fallback chain：profile 可声明有序备用模型列表，主模型重试耗尽后按门禁降级；压缩摘要可独立声明摘要模型（默认维持主模型，兼容现状）
- CJK 修正估算器覆盖 chars/4：单一本地 choke point 替换，保留"最近 assistant usage 优先"语义；估算精度用真实文本基准验收
- 用户可见语义：重试中与降级有明确的界面状态与最终失败文案；bridge/headless 调用面错误语义一致
- 兼容：存量 session 与 profile 零迁移；新配置默认值不改变成功路径行为

非目标：

- 全局 invocation 有界槽位（p-010 范围）
- 已产出模型可见输出后的断流重试/续传（v1 不重试中途断流，partial 保留语义不变；v2 候选）
- pi-ai 包内部 `clampMaxTokensToContext` 所用 chars/4 估算器的替换（在 node_modules 内、无注入点；残留风险见方案节）
- 跨 session 的 provider 熔断/冷却、按 provider 的健康度统计（v2 候选）
- 指标/告警面（审查 P2 可观测性缺口，独立议题）
- OpenRouter/网关级路由（`openRouterRouting.order` 等）接入——可作为后续增强，不作为本提案主路径

## 当前行为与证据

### 重试与失败收口

- `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts:4960-4972`：`executeTurn` 对 `stopReason === "error"` 直接返回 `kind: "failed"`；`:5019-5027` provider 异常（非 abort）同样收口为 failed。该层无重试/backoff，审查结论属实。
- `streamAssistant`（同文件 `:5289-5396`）：流式消费中仅"用户取消"被接管闭合成 interrupted（`:5378-5395`）；其余异常冒泡为失败。已收到的 partial 由 `turn-failure.ts:24-34` `sanitizePartialAssistant` 剥离未闭合 toolCall 后落 partial 消息——v1 不重试断流正是为了保护这套 turn commit 契约。
- SDK 层重试现状（审查未覆盖到的补充证据，三轮复核后本提案首次登记）：
  - pi-ai 的 `openai-completions`/`openai-responses`/`anthropic-messages` adapter 把 `maxRetries` 透传给 vendor SDK client（`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:114`、`openai-responses.js:95`、`anthropic-messages.js:351`），SDK 对 429/5xx/连接错误在流开始前自建重试。
  - 本地默认：`packages/neuro-book/shared/dto/pi-request-options.dto.ts:4` `DEFAULT_PI_MAX_RETRIES = 5`，经 `pi-request-options.ts:17-25` 注入每次请求；provider `requestOptions.maxRetries/maxRetryDelayMs` 是已开放的 JSON-safe 旋钮。
  - `google-generative-ai` 与 `bedrock-converse-stream` adapter 的 dist 中无 `maxRetries` 引用（从代码推断：这两家未接线该旋钮；Bedrock AWS SDK 自带 standard 重试不受本配置控制）。
  - SDK 层重试对产品完全不可见：无事件、无独立 trace 记录（中间 attempt 的响应不到达 `onResponse`，从代码推断）、耗尽后只剩一条 `stopReason: "error"`。
- 错误结构化程度：adapter catch 块把 SDK 错误归一化为字符串（`node_modules/@earendil-works/pi-ai/dist/utils/error-body.js`：`normalizeProviderError` 提取 HTTP status，`formatProviderError` 输出 `"429: <body>"` 或 `"<prefix> (429): <msg>"` 形态），harness 侧只能拿到 `stopReason` + `errorMessage` 字符串，无类型化错误。状态码可从字符串前导解析，但不保证所有 adapter 路径都带（Anthropic happy path 返回原始 message，从代码推断其 SDK message 通常自带状态码前缀）——这是分类实现的脆弱点，见方案节取舍。

### Fallback 与模型路由现状

- 一次 invocation 的模型在 prepare 阶段一次性解析冻结：`neuro-agent-harness.ts:2058-2065`（`modelResolver` + `runtimeResolver`，二者均为 config 的纯函数，运行时重解析可行——从代码推断）。
- 压缩摘要固定用主模型：`packages/neuro-book/server/agent/harness/compaction.ts:295` `tracedCompleteSimple(input.models, input.model, ...)`，`input.model` 即主 turn 模型；`:250` 注释明确"这里不做 fallback，避免失败时写入误导性摘要"。
- per-kind 路由先例：周期 summarizer 通过 `ProfileSummarizerRuntimePatch.profileKey` 路由到另一个 profile（其自带 modelKey），见 `packages/neuro-book/shared/agent/profile-runtime-settings.ts:20-26` 与 `server/agent/profiles/profile-summarizer.ts`。
- Profile 模型配置面：`server/config/types.ts:23-29` `AgentProfileModelConfig = {modelKey, temperature, topK, reasoningEffort, stream}`（temperature/topK/stream 为死旋钮，活口是 modelKey 与 reasoningEffort）；provider 级 `requestOptions` 见 `types.ts:83-89`。
- 模型可运行性校验先例：`@notnotype/neuro-book-contracts/provider-config` 的 `inspectModelReferences` 以 `runnableModelKeys` 口径校验显式模型引用，fallback 列表可直接复用。

### Token 估算现状

- 上游估算器实体一：`node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js:147-152`，`estimateTokens` 对各 role 一律 `Math.ceil(chars / 4)`；`estimateContextTokens`（`:98-123`）有"最近一条有效 assistant usage 为准、仅估算 trailing 消息"语义。两个导出函数均无估算器注入参数（签名已核）。
- 本地唯一 choke point：`packages/neuro-book/server/agent/messages/stored-message-tokens.ts`（全仓仅 23 行的适配器），`estimateStoredMessageTokens`/`estimateStoredContextTokens` 是本地全部估算消费的入口；消费方包括 `compaction.ts:89`（触发判定）、`compaction.ts:350/390`（keepRecent 选界与 metrics）、`neuro-agent-harness.ts:5221-5227`（`assertContextWithinWindow`，关闭压缩时超窗直接抛错）与压缩触发线面板（`compaction.ts:231-245`）。
- 上游估算器实体二（本提案明确列为残留）：`node_modules/@earendil-works/pi-ai/dist/utils/estimate.js`（`CHARS_PER_TOKEN = 4`），被 `api/simple-options.js:7` 的 `clampMaxTokensToContext` 用于每次请求的 maxTokens 钳制；无注入点，且影响方向是钳制偏松（低估上下文→可用余额高估），风险单侧可控。
- usage 语义决定误差面：`estimateContextTokens` 在存在有效 assistant usage 时以真实值为准，chars/4 只影响 trailing 段与首条 usage 之前的会话；但 trailing 段恰是触发判定的增量部分，且 CJK 正文消息（章节、长 prompt）集中在 trailing，故触发线偏移在主场景稳定存在。

### 配置登记链先例

新增配置节的完整链路（`observability.piTrace.maxBytesPerBucket` 先例）：`shared/dto/config.dto.ts`（zod，`:378-384`）→ `server/config/types.ts`（Effective/Stored 类型 + 默认值，`:205-222`）→ `server/config/normalizer.ts`（`:109-111`）→ `server/config/registry.ts`（ConfigItemMeta，可选）→ `server/api/config/global.put.ts`（AUTO-GENERATED，由 generate-openapi-meta 重生成，禁止手改）。

### 事件与可见面先例

- `NeuroAgentEvent` 已有 `custom` 扩展通道：`server/agent/events/types.ts:4-13`（`{type: "custom", name, payload}`），重试/降级状态无需改上游事件联合。
- AssistantMessage 自带实际应答模型身份（`provider`/`model` 字段，pi-ai 在流开始时写入，`openai-completions.js:83-99`——从代码推断），降级后持久化消息天然记录真实模型。
- 前端失败展示现状：`app/i18n/locales/zh-CN.ts:2033`（"生成失败"）、`:2422`（"生成失败，provider 未返回错误详情。"）；bridge/headless 消费同一份 `errorInfo`。
- trace 统一入口：`server/agent/observability/traced-provider.ts` 的 `tracedStreamSimple`/`tracedCompleteSimple` 覆盖主 turn、compaction、health-check（`PiTraceKind = "turn" | "compaction" | "health-check"`，`pi-request-recorder.ts:22`）；每次 attempt 经此入口天然各落一条 trace。

## 方案、备选方案和取舍

### 方案 A（推荐）：harness 层 resilience 执行器 + profile fallbackModelKeys + 本地估算器覆盖

#### A1. 重试挂载层与可重试门禁

在 harness 的 provider 调用边界新增 resilience 执行器，包裹 `streamAssistant`（主 turn）与 `generateCompactionSummary`（压缩摘要）两处 `traced*` 调用。

- **为什么不在 pi-ai 层包装**：fallback 需要按 config 重新解析模型/provider/apiKey（产品层知识）；trace 关联（session/invocation/turnIndex）与 abort 契约也只在 harness 层完整。pi-ai 层包装会把产品语义倒灌进适配层。
- **为什么不停留在 SDK 层**：SDK 重试不可见、策略各 SDK 自定、无总预算、无 fallback，且 google/bedrock 未接线。
- **可重试门禁（核心不变量）**：仅当本次 attempt **未产出任何模型可见输出**（流未发出 start/partial 事件；compaction 为非流式天然满足）才允许重试与 fallback。一旦首个模型可见输出已 emit，后续断流/报错一律按现状收口（partial 闭合、failed），不重试不降级——保护 Task 07/139 的 turn commit 契约，避免同一内容写两次。
- **可重试错误分类（v1）**：429、5xx、网络层错误（连接失败/重置/超时）可重试；4xx 鉴权与参数错误（400/401/403/404/422）、content_filter、abort 不可重试。分类依据为 `errorMessage` 前导状态码解析 + 网络错误模式匹配；**无法归类的错误默认不可重试**（fail-closed，避免对参数错误死循环放大 provider 压力）。对字符串解析的依赖是已知脆弱点（见"开放问题"Q6）。
- **Retry-After**：429/503 携带的 Retry-After 头若已在 errorMessage/响应头中可得则尊重，封顶值沿用 provider `requestOptions.maxRetryDelayMs`（默认 60s，pi-ai 类型层语义：超出即快速失败交给上层）。

#### A2. backoff 参数与预算

- 基础延迟 1s，指数 ×2，full jitter（每次延迟在 `[0, base × 2^(attempt-1)]` 内均匀取），`maxAttempts` 默认 3（含首次）。
- 单 invocation 重试总预算 `retryBudgetMs` 默认 90s：**只累计 backoff 等待时间**，attempt 本身的流式时长不计入（否则长流式响应会被预算误杀）；预算耗尽即收口失败。
- backoff 等待可取消：等待期间 abort signal 触发立即收口（与 `session-abort.md` 的既有 abort 语义对齐），不重试不 fallback。
- 与 SDK `maxRetries` 的叠加关系：两层并存时最坏 `maxAttempts × (1 + maxRetries)` 个 HTTP 请求（默认 3 × 6 = 18）。SDK 层管亚秒级抖动，产品层管策略、预算与可见性。v1 维持 `DEFAULT_PI_MAX_RETRIES = 5` 不变（兼容），文档建议希望完全由产品层接管策略的 provider 把 `requestOptions.maxRetries` 设为 0–1。是否随本提案把该默认降到 1 列为开放问题 Q2。

#### A3. fallback chain 数据模型

- `AgentProfileModelConfig` 增加可选 `fallbackModelKeys: string[]`（`agent.profiles.<key>.model` 与 `agent.profileModelDefaults` 同字段），有序；默认空 = 不降级，存量 profile 零迁移。保存校验复用 `inspectModelReferences`（runnable 口径）。
- 触发：主模型重试耗尽后，按列表顺序尝试候选；每个候选独立走完整重试策略。**不可重试错误不触发 fallback**（鉴权/参数错误换模型大概率同样失败，且会掩盖配置错误）——此点列为开放问题 Q3 供评审。
- 候选门禁：与重试同一"零输出"门禁；且修正后估算器判定当前上下文须装进候选模型 `contextWindow`，装不下跳过该候选继续下一个；全部不可行则按末次错误收口。
- 候选执行配置：fallback 模型使用**其自身 provider** 的 `apiKey/baseURL/requestOptions`（config 中 provider-scoped，互不串用）；profile 级 `reasoningEffort` 沿用，由 pi-ai `thinkingLevelMap` 负责映射或忽略。
- per-invocation-kind 路由：`ProfileCompactionRuntimePatch` 增加可选 `summaryModelKey`（null = 维持主模型，现状）；`fallbackModelKeys` 对实际选中的摘要模型同样生效。周期 summarizer 的 profileKey 路由维持既有机制不动。
- 用户可见：主对话降级会改变行文风格，这是有意暴露的行为变化——默认空列表、设置页显式配置、`provider.fallback` 事件 + 消息自带模型身份共同保证可见性。

#### A4. CJK 修正估算器

- 实现：在 `stored-message-tokens.ts` 内部替换估算实现（导出签名不变），不再调用 pi-agent-core 的 chars/4。分段启发式：CJK 连续段（统一表意文字、扩展区、假名、諺文、全角标点）按约 1.5 字符/token 计，ASCII/空白段维持 4 字符/token，消息/块级加少量 overhead 常量。**方向上宁可略高估**：压缩提前触发是安全侧，低估才是事故侧。最终系数以验收基准校准（开放问题 Q5）。
- 保留语义：`estimateStoredContextTokens` 维持"最近有效 assistant usage 优先、仅估算 trailing"的结构（usage 是 provider 真实值，不可覆盖），只替换 trailing/无 usage 路径的字符折算。
- 不改 node_modules。pi-ai 内部 `clampMaxTokensToContext` 的 chars/4 为残留项：影响方向是 maxTokens 钳制偏松，provider 侧 400 是兜底，且该 400 属不可重试参数错误、语义自洽。
- 影响面预告：上下文面板 token 读数与"离压缩还有多远"在 CJK session 显著上升，压缩触发时机提前——这是修复的直接效果，不是回归；发布说明需点名。

#### A5. 用户可见语义与配置面

- 重试中：经 `custom` 事件 `provider.retrying`（payload：attempt/maxAttempts/delayMs/错误分类/modelKey）在 invocation 状态区显示瞬时状态（如"模型限流，X 秒后重试（第 N/M 次）"）；门禁保证此刻尚无流式气泡，不出现重复消息。
- 降级：`provider.fallback` 事件（from/to modelKey、原因分类）；最终 assistant 气泡标注实际应答模型（数据已在消息上，前端小改）。
- 最终失败：错误文案升级为含重试史摘要（"已重试 N 次"/"已切换 M 个备用模型仍失败"），新增 i18n key；`errorInfo.phase` 维持 `"model"`，bridge/headless 看到一致结构。
- trace：每个 attempt 经 `traced*` 各落一条记录（重试/降级全程可回放）。
- 新配置节 `agent.resilience`（global、next-run 生效）：`{enabled, maxAttempts, baseDelayMs, retryBudgetMs, respectRetryAfter}`，登记链按 `observability.piTrace` 先例（zod → types → normalizer → registry → 重生成 global.put.ts OpenAPI meta）。`resilience.enabled` 默认 true（推荐值，仅"零输出失败才重试"，成功路径零变化）——列为开放问题 Q1。

### 方案 B：pi-ai 层包装（自定义 ProviderStreams 内做 retry/fallback）

重试可行，但 fallback 需要在包装层内重新解析模型与 provider runtime（config 层知识倒灌适配层），"零输出"判定埋进事件流内部使 trace 归因（一 attempt 一记录）与 abort 语义显著变复杂。放弃。

### 方案 C：仅文档化 SDK maxRetries + 调默认值

零新代码，但不可见、无预算、无 fallback、无 CJK 修复，不回应审查结论的任一根因。放弃。

### 方案 D：fallback 外包给网关路由（OpenRouter `provider.order`/Vercel AI Gateway）

只对使用特定网关的用户有效，直连 provider（本部署主流）无收益；且降级策略不可观测、不可验收。可作为后续增强，不作为主路径。

### 取舍结论

A 先行；B 因知识分层放弃；C 不解决问题；D 留作网关用户的后续增强。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：session jsonl 格式不变；历史 compaction entry 的 `tokensBefore`（旧估算口径）不回填、不参与新判定。新增配置全部可选。
- **接口**：`AgentProfileModelConfig` + `fallbackModelKeys`（可选）；`ProfileCompactionRuntimePatch` + `summaryModelKey`（可选）；新增 `agent.resilience` 配置节；新增两个 `custom` 事件名（`provider.retrying`/`provider.fallback`）——事件为增量，老前端忽略未知 custom 事件即可（从代码推断：前端按 type/name 分发，未知名不命中任何分支）。`errorInfo` 结构不变。
- **安全**：fallback 模型的 apiKey 只从既有 provider config 读出直接交给 HTTP client，密钥不进事件 payload、trace、日志与错误正文（沿用 traced-provider 既有白名单/脱敏纪律）；错误分类解析只读 status 与错误类型，不把 provider 原始 body 扩写进 UI 文案（`provider-error-sanitizer` 既有边界不变）。
- **迁移**：无。存量 profile 未声明 fallback/summaryModelKey 时行为与现状逐点一致。
- **发布**：估算器修正使用户可见读数变化（面板 token 数、压缩触发提前），changelog 与用户文档需点名；`global.put.ts` 为生成文件，按先例跑 generate-openapi-meta 重生成。
- **回滚**：`agent.resilience.enabled: false` 即回到现状失败语义；fallbackModelKeys 清空即无降级；估算器为纯函数替换，回退即恢复 chars/4 口径（已按新口径触发的 compaction entry 不受回退影响，语义自洽）。

## 对 Spec 的预期改动

- 新建 `docs/specs/agent/provider-resilience.md`（planned，capability `agent.provider-resilience`，owner agent runtime）：错误分类与可重试门禁、backoff 参数与预算、fallback 路由与候选门禁、事件与文案合同、配置面、失败语义与验收场景（429 故障注入、断流不重试、fallback 成功/跳过、abort 打断 backoff）。
- token 估算与压缩触发合同：当前无独立 implemented spec（属 Reference: Agent 冻结区）；获准后在 `docs/specs/agent/` 新增估算精度与压缩触发合同（可并入 provider-resilience 的估算条款或独立小节），含 CJK 基准验收口径。
- `docs/specs/agent/session-abort.md`：补充 backoff 等待期与 fallback 候选切换期的 abort 语义（立即收口、不重试不降级）。
- `docs/specs/README.md` 注册表同步登记。

### 验收（写入 planned Spec 的场景清单）

1. 429 故障注入：faux provider（`server/agent/test-utils/faux-models.ts` 既有设施；若 faux 不支持错误队列则加最小故障桩）连续 429×2 后 200 → invocation 成功、2 条 `provider.retrying` 事件、3 条 trace 记录。
2. 401/400 → 立即失败，零重试、零 fallback。
3. 持续 429 超 `retryBudgetMs` → failed，错误文案含重试史；等待期间 abort → 立即收口。
4. 首个模型可见输出后断流 → 不重试不 fallback，partial 按现状闭合（回归 Task 07/139 契约）。
5. 主模型耗尽 → fallback 候选应答成功，`message.model` 为候选模型、事件齐全；上下文估算超候选窗口 → 跳过该候选。
6. CJK 估算基准：真实章节文本 fixture 与 provider 实际 usage 对拍，误差带 ±25% 内（阈值实现时以基准数据校准，此处为推断值）；同一 CJK session 修正前后 `shouldCompact` 判定时机对照。
7. 兼容：未配置新字段的存量 profile 全量行为测试无 diff（重试仅在零输出失败时介入，成功路径事件序列不变）。

## 决策记录

- 2026-09-22：Leader 起草（依据架构审查 P1-3，证据经三轮复核；SDK 层重试现状为本提案新增登记）。待开发者评审：
  - Q1：`agent.resilience.enabled` 默认值 true（推荐，零输出门禁下成功路径无变化）还是 false（完全 opt-in）。
  - Q2：产品层启用时是否把 `DEFAULT_PI_MAX_RETRIES` 从 5 降到 1（抑制两层叠加最坏 18 请求），还是维持 5 由文档引导按需调低。
  - Q3：不可重试错误（4xx 鉴权/参数）是否一律不触发 fallback（推荐：不触发，避免掩盖配置错误）；以及主对话 fallback 是否允许跨 provider（推荐：允许，正是意义所在）。
  - Q4：`compaction.summaryModelKey` 是否随提案给一个产品推荐的便宜模型默认模板，还是仅开放字段、默认值维持主模型（推荐后者，避免替用户做成本决策）。
  - Q5：CJK 段系数 1.5 字符/token 与验收误差带 ±25% 的最终取值（需基准数据集校准）。
  - Q6：错误分类对 `errorMessage` 字符串解析的依赖是否可接受（fail-closed 兜底），还是 v1 即在 traced 层包装结构化错误（成本：触碰 traced-provider 与 adapter 边界，且 status 在 SDK 重试耗尽前不可得）。
