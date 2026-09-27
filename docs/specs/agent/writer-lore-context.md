---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.writer-lore-context
owners:
  - agent-runtime
---

# Writer 主链 lore 上下文注入

writer 每次写作 invoke 的 prompt 装配包含 lore 卡片注入：从项目 lorebook 选出与当前扫描文本相关的卡片，渲染为 `<chapter_lore_context>` 段注入。本规范把现状 trigger 选卡与新 nb-memory 检索路径写成同一份行为合同；批准依据为 p-008（2026-09-24 accepted），按「检索器可插拔 + shadow 双跑 → 配置闸切换 → 退役评估」三阶段收敛。

## 目标与非目标

目标：

- lore 选卡抽象为可替换检索器：`trigger`（现状字符串匹配）、`memory`（nb-memory 语义 + 字面 RRF，facts 直报零 LLM）、`shadow`（双跑观测）。
- 注入预算与渲染管线不变：top-8 路径上限、8000 字符预算、kind 排序、截断语义与 `<chapter_lore_context>` XML 包装全部保持。
- 失败与降级语义明确且不比现状更脆：新检索路径任何失败都自动退回 trigger 路径，三级退回为 memory → trigger → 空串（注入缺席，不阻塞写作）。
- 迁移不阻塞写作：存量项目无索引时后台构建，构建期间照常走 trigger 路径。
- shadow 期产出切换决策证据：两路召回集合差异、延迟分布、降级触发频率。

非目标：

- 不改注入渲染器（`renderInjectedMarkdown`）、不改 lorebook 文件格式与 frontmatter 合同。
- 不做章节正文连续性索引（manuscript 段落进 nb-memory、as-of 跨章检索是后续阶段）。
- 不动 `lore_resolver_query` 工具（独立调用面，始终走 trigger 语义）。
- 不做知识边界与视角（`frontmatter.knowledge[]` 披露控制与 as-of 的结合）。
- 不把 nb-memory 的 LLM 摄入管线（`extractFacts` 抽取 + 归一）接进主链；本能力只用 facts 直报模式，摄入零 LLM。
- 项目级 `retriever` 覆盖（v1 只做 global 配置）。

## 术语与参与者

- **扫描文本**：`invoke.message`（brief）与章节已有正文合并后的文本；合并结果 < 100 字符时注入不触发。
- **trigger 检索器**：现状实现——对扫描文本逐段做 `paragraph.includes(trigger)`，命中路径按命中 trigger 数降序；trigger 表 = 卡片 `retrieval.trigger` + 标题隐式 trigger（长度 ≥ 2）。
- **memory 检索器**：nb-memory 检索——lorebook 卡片索引进项目 `.nbook/memory/`（jsonl 事实源 + `index.sqlite` 派生索引），以截断后的扫描文本为 query 做语义 + 字面 RRF 检索，命中段按 `meta.lorePath` 归并取 top-N。
- **carryOver**：最近 3 条注入记录的卡片路径，无条件置顶保留（即使本次未命中）。
- **三级退回**：memory 检索任一前置条件不满足或失败 → trigger 检索；trigger 检索失败或 0 命中 → 空串（注入缺席）。

## 输入与前置条件

- invoke payload：`path`（章节路径）与 `message`（brief）；缺 `path` 或缺当前项目时注入缺席。
- 项目 lorebook：八类目录（character/location/faction/event/item/world/system/spec）下每张卡片一个 `index.md`；`retrieval.enabled: false` 的卡片两路都不参与。
- carryOver 记录：项目 `.nbook/state/lore-carryover.jsonl`。
- 配置节 `agent.loreContext.retriever`（global，默认 `trigger`）：`trigger | shadow | memory`。登记链按 `observability.piTrace` 先例（zod → types → normalizer → 重生成 OpenAPI meta）；v1 无项目级覆盖。
- memory 路的嵌入：复用项目 `EmbeddingServiceConfig`（`resolveWorldEmbedding`/`embedTexts`）；未启用或配置不完整时纯字面路运行，零网络调用。apiKey 只从既有 provider 配置通道读出直交 HTTP client，不进事件/trace/日志。

## 输出与可观察行为

- 输出段：`<chapter_lore_context generatedAt maxPaths included truncated>` 包裹的 markdown；卡片按 kind 固定序（character → location → faction → event → item → world → system → spec）渲染，8000 字符预算内截断，超预算与渲染失败的卡片计入 truncated。
- `retriever = trigger`（默认）：注入结果与本规范落地前逐字节一致；用户可观察行为零变化。
- `retriever = shadow`：实际注入仍用 trigger 结果（与默认逐字节一致）；memory 召回集合与两路差异只写观测日志，用户可观察行为零变化。
- `retriever = memory`：注入用 memory 结果；索引未建、构建中、检索抛错、嵌入超时任一发生即自动退回 trigger 结果。
- 观测日志：项目 `.nbook/state/lore-retriever-shadow.jsonl`（对齐 lore-carryover 的项目级 jsonl 观测先例），每行一条 JSON：时间戳、模式、两路召回路径集合、差异（onlyTrigger/onlyMemory/common）、两路延迟、memory 路状态（ready/building/timeout/error/literal-only 与 pendingVectors）。日志写失败只 `console.warn`，不影响注入。
- 注入成功后写 carryOver 记录（现状行为，两路一致）。

## 状态与转换

### 索引生命周期（per project）

| 状态 | 进入条件 | 检索行为 | 出口 |
|---|---|---|---|
| 未建 | `.nbook/memory/` 或 manifest 不存在 | memory/shadow 模式退回 trigger，并触发后台构建（单飞，不阻塞本次写作） | 后台构建完成 → 就绪 |
| 构建中 | 后台构建/增量刷新进行中 | 退回 trigger | 完成 → 就绪；失败 → 未建（下次 invoke 重试） |
| 就绪 | manifest 与索引可用 | memory 路参与（shadow 观测或 primary 注入） | 索引目录被删 → 未建 |
| 降级（语义） | embedding 未启用或向量待补齐（`pendingVectors > 0`） | 字面路照常召回；语义路跳过未嵌条目 | `backfillVectors` 补齐 → 就绪 |

- 增量失效：卡片内容按 hash 比对（刷新节流 30s）；变化的卡片以其新内容追加新代 facts 并嵌入（未变卡片零重嵌），旧代 facts 保留在事实源中、检索时按 manifest 当前代过滤。卡片删除 → manifest 移除，其各代 facts 不再被召回。
- 索引目录整体删除后可从 lorebook 全量重建（jsonl 与 sqlite 均为派生物的镜像：facts 重建后逐条重嵌，成本随卡数线性）；重建期间注入走 trigger，行为正常。
- embedding 模型标识（provider/model/dims）变化时由 SqliteIndexStore 清空向量列渐进重嵌，不删库不报错。

### 检索模式转换

`trigger` ⇄ `shadow` ⇄ `memory` 由配置闸即时切换，无持久状态迁移；任一模式可独立回退。`memory` → `trigger` 回退后行为与升级前一致。

## 副作用与数据

- 新增项目目录 `.nbook/memory/`：`facts.jsonl` 等四个 jsonl 事实源文件 + `index.sqlite` 派生索引 + `lore-manifest.json`（卡片当前代指针）。与 `.nbook/project.sqlite`、`.nbook/state/` 同级；per-project 隔离。本地备份与云备份按既有归档规则自动覆盖本目录（p-008 决策 6）。
- 摄入为 facts 直报：每张卡片的正文段（空行切分，上限 32 段，单段截断 2000 字符）各成一条 fact，另有一条 header fact 汇总 title/triggers/summary；`meta = {lorePath, kind, cardHash}`，refId 内容寻址（`lore:<path>:v<hash>:<段序|header>`）。零 LLM 调用。
- 嵌入成本：后台构建/增量时逐条嵌入新代 facts；每次注入至多 1 次 query embed 调用（embedding 启用时），超时 2s 自动退回 trigger。
- 观测日志逐次 invoke 追加一行（shadow/memory 模式）；行体积有界（路径集合 + 计数，不含卡片正文）。

## 失败与恢复

- memory 路任一环节失败（索引打开、构建、检索、嵌入、超时）→ 退回 trigger 路径并记观测日志/警告，不向 invoke 传播。
- trigger 路失败或 0 命中 → 注入缺席（返回空串），写作 invoke 照常（现状语义）。
- 观测日志写入失败 → `console.warn`，不影响注入。
- 嵌入请求失败/超时只影响当次 query embed 与后台重嵌：当次检索退回 trigger（memory 模式）或记降级（shadow 模式）；后台重嵌失败保留 pendingVectors 降级状态，下次刷新重试。
- 配置值非法（非 `trigger|shadow|memory`）→ 归一化丢弃，回落默认 `trigger`。

## 边界与兼容

- 默认配置下注入结果与落地前逐字节一致；升级、回滚、模式切换均不需要数据迁移。
- `lore_resolver_query` 工具行为不变（独立入口，始终 trigger 语义）。
- 渲染管线（`renderInjectedMarkdown`）与 carryOver 记录格式不变；memory 路产出路径列表后复用同一渲染与记录代码。
- nb-memory 以 TS 源码直出被 nitro 消费（`@notnotype/nb-memory: workspace:*`，对齐 nb-history 先例）。
- `.nbook/memory/` 删除无副作用：功能退回 trigger 路径，后台重建。

## 验收与 Smoke

1. 默认配置（trigger）下注入结果与改动前快照逐字节一致。
2. shadow 模式：注入仍等于 trigger 结果；观测日志含 memory 召回集合与两路差异；索引未建/构建中/检索抛错/超时任一发生即自动退回 trigger，不阻塞写作 invoke。
3. 字面路注入新增延迟 p95 < 50ms（本机基准）；语义路超时 2s 降级生效。
4. 索引失效：lorebook 卡片编辑后增量重嵌生效（仅变化卡片重嵌）；删除 `.nbook/memory/` 后可重建且期间注入正常。
5. 配置闸回 `trigger` 后行为与升级前一致。
6. shadow → primary 切换门槛（后续 Task 评审）：≥20 次真实 invoke 两路召回对照 + 差异人工抽样，对照报告落 Task 证据。

## 实现合同

> 尚未实现。实施 Work：w00016；首个 Task：t01（本 Spec 落地 + 可插拔检索器与 shadow 双跑）。

- Profile 沙箱的 lore 子入口（`nbook/profile-sdk/lore`，白名单已登记）提供读取配置闸后的选卡入口；writer profile 经它完成选卡，`trigger` 模式下与既有 `resolveForChapter` 同语义同结果。
- 持久化格式合同（`.nbook/memory/` 布局、facts `meta`/refId 口径、观测日志字段）以本规范「副作用」节为准；`lore_resolver_query` 工具不经过新入口。

## 证据

- p-008 提案与 2026-09-24 拍板：`docs/proposals/p-008-nb-memory-main-chain-retrieval.md`。
- 现状实现：`packages/neuro-book/server/agent/lore/lore-resolver.ts`、`lore-context-injector.ts`、`lore-resolver-cache.ts`、`lore-carryover-store.ts`。
- nb-memory 公开面：`packages/nb-memory/src/index.ts`（NbMemory/FsStorage/SqliteIndexStore/EmbedPort）。
- 嵌入设施：`packages/neuro-book/server/world-engine/world-embedding.ts`。
