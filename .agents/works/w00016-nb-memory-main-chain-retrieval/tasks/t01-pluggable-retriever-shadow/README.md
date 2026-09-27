---
schema: nbook.task/v2
taskId: t01-pluggable-retriever-shadow
role: tasker
---

# planned Spec + 可插拔检索器与 shadow 双跑（p-008 阶段 1）

## 目标

落地 p-008 阶段 1：lore 选卡抽象为可替换检索器，现有实现保留为 trigger 检索器，新增 memory 检索器（nb-memory 语义 + 字面 RRF，facts 直报零 LLM）；`agent.loreContext.retriever` 配置闸登记（默认 `trigger`）。shadow 模式双跑——实际注入仍用 trigger 结果，memory 召回集合与两路差异只记观测日志，用户可观察行为零变化。

## 范围

- Spec：新建 `docs/specs/agent/writer-lore-context.md`（capability `agent.writer-lore-context`，status planned），把现状行为与新检索路径写成同一份合同（输入/输出/索引生命周期/三级退回/预算/验收）；`docs/specs/README.md` 登记。
- 依赖：`packages/neuro-book/package.json` 增加 `"@notnotype/nb-memory": "workspace:*"`（对齐 nb-history 先例）；`profile-sdk/lore.ts` 再导出新检索函数（白名单已含该子入口）。
- 实现：检索器抽象 + memory 检索器（索引落项目 `.nbook/memory/`：jsonl 事实源 + index.sqlite 派生；lorebook 写盘后按内容 hash 增量重嵌；存量项目无索引时后台构建、不阻塞写作，构建期走 trigger）；shadow 双跑与观测日志（对齐 piTrace 观测面）。
- 配置：`agent.loreContext.retriever` 登记链对齐 piTrace 先例（zod → types → normalizer → 重生成 global.put.ts meta）；global-only。
- 嵌入复用 `resolveWorldEmbedding`/`EmbeddingServiceConfig`；未启用时纯字面路（零网络调用）。
- 密钥边界：apiKey 只从既有 provider config 读出直交 HTTP client，不进事件/trace/日志。

## 验收

1. 默认配置（trigger）下注入结果与改动前快照逐字节一致。
2. shadow 模式：注入仍等于 trigger 结果；观测日志含 memory 召回集合与两路差异；索引未建/构建中/检索抛错/超时任一发生即自动退回 trigger，不阻塞写作 invoke。
3. 字面路注入新增延迟 p95 < 50ms（本机基准）；语义路超时 2s 降级生效。
4. 索引失效：lorebook 卡片编辑后增量重嵌生效；删除 `.nbook/memory/` 后可重建且期间注入正常。
5. 配置闸回 `trigger` 后行为与升级前一致。
6. 测试：检索器单测（按 lorePath 归并 top-8、预算截断、降级路径）、shadow 双跑集成测试、配置归一化测试；新文件按分层 typecheck 要求登记。

## 产出

叙事与验证落 `walkthroughs/`；shadow 对照数据（切换评审用）落 `evidences/`。primary 切换评审在后续 Task 进行，门槛：≥20 次真实 invoke 两路对照 + 差异人工抽样。

## 结果（2026-09-27，Tasker）

全部范围落地，验收 1–6 实测通过；叙事见 [`walkthroughs/implementation.md`](walkthroughs/implementation.md)，验收 3 基准与观测记录样例见 [`evidences/literal-path-latency-benchmark.md`](evidences/literal-path-latency-benchmark.md)。

- 交付：planned Spec `agent.writer-lore-context` + 检索器 dispatch（trigger/shadow/memory）+ memory 检索器与索引生命周期（facts 直报零 LLM、新代 append-only 增量、后台构建不阻塞、30s 刷新节流、2s query embed 超时降级、NullEmbedPort 纯字面路）+ 项目级 shadow 观测 jsonl + `agent.loreContext.retriever` 配置闸全登记链（zod→types→normalizer→重生成 meta）+ nb-memory workspace 依赖双侧登记 + writer profile 切新入口。
- 验证：lore 套件 46/46、`server/config` 84/84、typecheck 八层 0、lint ratchet 2145/1513 持平、docs:check 6075 零 failure、governance:check 零告警；字面路 p95=20.24ms（预算 50ms）；trigger 一致性 deep-equal 单测锁定。
- 偏差：观测日志走 lore-carryover 项目级 jsonl 先例（非 piTrace 桶）；旧代 facts 归并时过滤不物理清理（nb-memory 无删除 API 的设计内方案）；SDK 签名锚定轻量类型 + 投影 stub v4（重图不进作者可见声明图）。详见 walkthrough 偏差与决定节。
- 顺带修复（独立提交）：generate-openapi-meta applicationRoot 拆包后指向错误（37 路由静默失效），修复 + 全量重生成 canonical 化。
- 观察：`leader-assets-profile.test.ts` leader.default 用例本机 20s 超时为 HEAD 既有（干净 HEAD A/B 同败，非本 Task 回归）；生产生效需 state root 资产同步 + profile compile 普查；真实语义路 e2e 与 shadow 配置闸翻转转后续授权动作。
