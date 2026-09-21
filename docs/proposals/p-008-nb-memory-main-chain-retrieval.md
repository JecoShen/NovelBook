# P-008：nb-memory 接入 writer 主链 lore 检索

- 状态：draft（提交开发者评审）
- 来源：`.local/architecture-review-2026-09-20.md` P1-2（三轮复核属实）；开发者已拍板方向——nb-memory 接入 writer 主链（或过渡期：as-of 检索补充 lore 注入）

## 问题

writer 主链的 lore 上下文注入是每次写作 invoke 的 prompt 装配步骤，其中"选哪些 lore 卡片"这一步是全仓检索质量最弱的一环：纯字符串 `paragraph.includes(trigger)` 按命中 trigger 数降序取 top-8，与语义无关。同义词、代称、描述性指代（"银发的剑士"）召回为零；trigger 表的维护质量直接决定注入质量，而维护负担随卡片数线性增长。

与此同时，仓内 `packages/nb-memory` 是检索质量最好的组件——双时间轴、语义 + BM25 字面 RRF 融合、as-of 查询、B1 基准 0% 时间泄漏——却不在主应用依赖里，生产零接入。架构审查的定性是"有能力未接线"：长篇连续性上下文质量被最弱的一环决定，而最强的一环闲置。

## 目标与非目标

目标：

- writer 主链 lore 卡片选择可从字符串 trigger 切换为 nb-memory 检索（语义 + 字面 RRF），可灰度、可回退
- 注入预算与渲染管线不变：top-8 路径上限、8000 字符预算、kind 排序、截断语义与 `<chapter_lore_context>` XML 包装全部保持
- 失败与降级语义明确且不比现状更脆：新检索路径任何失败都自动退回现状行为
- 迁移不阻塞写作：存量项目无索引时后台构建，构建期间照常走现状路径

非目标：

- 不改注入渲染器（`renderInjectedMarkdown`）、不改 lorebook 文件格式与 frontmatter 合同
- 不做章节正文连续性索引（manuscript 段落进 nb-memory、as-of 跨章检索是后续阶段；本提案只覆盖 lorebook 卡片选择的对等替换）
- 不动 `lore_resolver_query` 工具（它是 maxPaths=4 / maxChars=4000 的独立调用面，可后续对齐）
- 不做知识边界与视角（`frontmatter.knowledge[]` 披露控制与 nb-memory as-of 的结合是后续方向）
- 不把 nb-memory 的 LLM 摄入管线（`extractFacts` 抽取 + 归一）接进主链；本提案只用 facts 直报模式，摄入零 LLM

## 当前行为与证据

- `packages/neuro-book/server/agent/lore/lore-resolver.ts:22,38`：`DEFAULT_MAX_PATHS = 8`；对每段执行 `paragraph.includes(trigger)`，命中路径按 trigger 命中数降序
- `packages/neuro-book/server/agent/lore/lore-context-injector.ts:21`：`DEFAULT_MAX_CHARS = 8000`；按 kind 固定序渲染卡片、预算内截断、包 `<chapter_lore_context>` XML
- 主链挂载点：`packages/neuro-book/assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 的 `renderChapterLoreContext`（约 506–566 行）：扫描文本 = invoke.message(brief) + 章节正文，合并 < 100 字符不触发；carryOver 取最近 3 条注入记录无条件置顶；`maxPaths: 8`、`maxChars: 8000` 显式传入；全部失败路径 `console.warn` + 返回空串（注入缺席，不阻塞写作）
- Profile 沙箱经 `packages/neuro-book/profile-sdk/lore.ts` 白名单再导出 server 侧 lore 模块（白名单见 `profile-authoring-sdk-specifiers.ts`，`nbook/profile-sdk/lore` 已登记）
- carryover 状态落项目目录 `.nbook/state/lore-carryover.jsonl`；项目数据库在 `.nbook/project.sqlite`（`project-workspace.ts:16`）
- `packages/neuro-book/package.json` 依赖无 nb-memory；`@notnotype/nb-history` 等 workspace 依赖在先（deps 85–89 行），且 nb-history 同为 TS 源码直出（`exports: ./src/index.ts`）被 nitro 主应用消费——nb-memory 同形态，接入先例完整
- nb-memory（`packages/nb-memory/README.md`、`src/ports/ports.ts`）：零第三方依赖；`FsStorage` jsonl 事实源（episodes/facts/registry/state 四文件，事件溯源可 git diff）+ `SqliteIndexStore` 派生索引（`bun:sqlite`，删除可重建）；`EmbedPort` 可注入（`embed(texts)` + `dims`）；`deferEmbedding` 下摄入零嵌入成本、字面路（BM25 在内存）立即可召回、语义路等 `backfillVectors` 补齐；检索基线 0 次 LLM + 1 次 embed
- B1 基准（sibling 仓 nb-memory-bench，fanpai-loli 20 章 / 338 事实 / 48 探针）：时间泄漏率 0%（对照 baseline 22.2%），entity 76.3% vs 68.4%；该成绩来自基准语料，未在主链与真实项目语料上实测
- 主应用已有 embedding 设施：`server/world-engine/world-embedding.ts` 的 `resolveWorldEmbedding`/`embedTexts`，复用 `EmbeddingServiceConfig`（enabled/provider/model/dimensions），与 nb-memory `EmbedPort` 结构化同构
- 配置登记先例（`observability.piTrace.maxBytesPerBucket`）：`shared/dto/config.dto.ts` zod schema → `server/config/types.ts` 类型与默认值 + `server/config/normalizer.ts` 归一 → `server/api/config/global.put.ts` route meta（`scripts/build/generate-openapi-meta.ts` 自动生成，DO NOT EDIT）；`project.put.ts` 存在同名项，项目级覆盖有先例

## 方案、备选方案和取舍

### 方案 A（推荐）：检索器可插拔 + shadow 双跑 → 配置闸切换 → 三阶段收敛

把 `resolveForChapter` 的"选卡片"一步抽象为可替换检索器，现有实现保留为 trigger 检索器，新增 memory 检索器：

- **索引内容**：lorebook 八类卡片正文段 + frontmatter 关键字段（title/triggers 并入索引文本），facts 直报模式摄入（零 LLM），`meta = {lorePath, kind}`，refId 稳定（lorePath + 段落序）
- **存储**：项目目录 `.nbook/memory/`（jsonl 事实源 + `index.sqlite` 派生索引），与 `.nbook/project.sqlite`、`.nbook/state/` 同级；per-project 隔离，A 项目的角色不会被 B 项目召回
- **检索**：以扫描文本（message + 章节正文，截断后）为 query 调 `memory.search`，hits 按 `meta.lorePath` 归并取 top-8，接入现有 carryOver 排序与渲染管线；embedding 未启用时纯字面路（零网络调用）
- **失效**：lorebook 写盘后按内容 hash 比对增量重嵌（`file-snapshot-cache` 已是主应用依赖）；单项目卡片量级从代码推断为数十到数百张，全量重建成本有界，首次构建可走全量

三阶段：

1. **shadow**：配置 `agent.loreContext.retriever = "shadow"` 时双跑——实际注入仍用 trigger 结果，memory 召回集合与两路差异只记观测日志（对齐 piTrace 观测面），用户可观察行为零变化
2. **primary**：`retriever = "memory"` 时 memory 结果进入注入，trigger 结果仅记录；索引未建、构建中、检索抛错、超时任一发生即自动退回 trigger 路径
3. **退役**：trigger 路径作为永久降级兜底保留还是删除，由 shadow 证据在阶段末决定（决策记录补）

理由：nb-memory 的 B1 成绩来自基准语料，未在真实 writer 链路与真实项目语料上实测；直接替换会把每次写作 invoke 的 prompt 质量押在未实测路径上，且质量回退无对照基线无法归因。shadow 期产出切换决策所需的证据：两路召回集合差异、延迟分布、降级触发频率。

### 方案 B：直接替换检索器

省一个阶段的工期，但回归面是每次写作 invoke 的 prompt 质量；nb-memory 摄入与索引形态在主应用零生产运行史，故障模式未知；出问题只能整体回退版本。不推荐。

### 方案 C：as-of 检索补充而非替换（拍板方向中的过渡形态）

保留 trigger 选卡不动，另把 nb-memory 检索结果作为额外段落注入。问题是两个召回源挤占同一 8000 字符预算，优先级语义复杂化，且 trigger 的误召/漏召原样保留。其"补充"形态可吸收为方案 A shadow 期的观测手段，不单独立项。

### 取舍结论

A 先行；B 仅在 shadow 证据充分且开发者要求压缩工期时考虑；C 不独立实施。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增项目目录 `.nbook/memory/`（jsonl 四个事实源文件 + `index.sqlite`）；jsonl 是可审查、可 diff 的事实源，`index.sqlite` 是派生物，删除后重建只慢一次；本地备份是否覆盖 `.nbook/memory/` 需登记确认（从代码推断：备份按项目目录整树则自动覆盖）
- **接口**：`packages/neuro-book/package.json` 增加 `"@notnotype/nb-memory": "workspace:*"`（对齐 nb-history 先例）；`profile-sdk/lore.ts` 增加新检索函数的再导出（沙箱白名单已含该子入口，无需新增 specifier）；配置新增 `agent.loreContext.retriever`（`trigger | shadow | memory`，默认 `trigger` 保持现状），登记链对齐 piTrace 先例（config.dto.ts zod + types.ts 默认值 + normalizer.ts + 重跑 generate-openapi-meta）；项目级覆盖与否在 Task 阶段定（project.put.ts 有 piTrace 同名先例）
- **安全**：嵌入调用复用项目 `EmbeddingServiceConfig`，密钥只在现有配置通道读出直交 HTTP client；lore 内容注入 prompt 发往已配置 provider，数据流向与现状相同；索引文件与作品数据同密级、同项目边界
- **迁移**：存量项目首次 invoke 发现无索引时走 trigger 兜底，并触发后台构建（不阻塞本次写作；构建 = 读 lorebook 全量卡片 + 逐条嵌入，成本随卡数线性）；embedding 未启用的项目只建字面路（`deferEmbedding` 形态），`stats().pendingVectors` 如实暴露降级状态
- **发布**：nb-memory 以 TS 源码直出被 nitro 消费，需一次构建验证确认（nb-history 同形态已在生产运行，从代码推断风险低）；shadow 期默认 `trigger`，发布本身零行为变化
- **回滚**：配置闸回 `trigger` 即回退；删除 `.nbook/memory/` 无副作用；三阶段任一阶段可独立回退到前一阶段

## 对 Spec 的预期改动

- 现状缺口：lore 注入行为无注册 spec——`docs/specs/` 下无对应 capability，代码注释引用的"spec §2.x"指向 `docs/superpowers/plans/2026-08-18-lore-resolver-mvp.md` 计划文档，不是行为合同
- 新建 `docs/specs/agent/writer-lore-context.md`（`capability: agent.writer-lore-context`，`kind: behavior`，`status: planned`），把现状行为与本提案的新检索路径写成同一份合同：输入（invoke payload.path/message、项目 lorebook、carryOver 记录）、输出（`<chapter_lore_context>` 注入段）、状态（索引生命周期：未建/构建中/就绪/降级）、失败与降级（memory → trigger → 空串三级退回）、预算（top-8、8000 字符、100 字符触发阈值）、验收
- 验收标准建议（具体数值待评审）：shadow 对照报告覆盖至少 1 个真实项目语料；as-of 泄漏率 0%（沿用 nb-memory B1 协议在主链接入后复测）；prompt 装配新增延迟 p95 有界（字面路纯 CPU；语义路 1 次 embed 调用，超时自动降级，预算毫秒数在 Task 阶段拍定）；配置闸回 `trigger` 后注入结果与升级前快照逐字节一致

## 决策记录

- 2026-09-22：Leader 起草（依据架构审查 P1-2，证据经三轮复核；方向已由开发者拍板：nb-memory 接入 writer 主链，或过渡期 as-of 检索补充）。待开发者评审：阶段划分（三阶段 vs 直接切换）、`retriever` 配置项命名与默认值、prompt 装配延迟预算数值、shadow 期长度与切换证据门槛、trigger 路径终态（永久降级 vs 退役删除）、`.nbook/memory/` 是否纳入本地备份面、项目级配置覆盖是否需要。
