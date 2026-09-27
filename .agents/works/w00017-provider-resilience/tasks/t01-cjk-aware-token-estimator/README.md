---
schema: nbook.task/v2
taskId: t01-cjk-aware-token-estimator
role: tasker
---

# planned Spec + CJK 修正 token 估算器（p-009 A4）

## 目标

落地 p-009 的估算器切片：在本地唯一 choke point `server/agent/messages/stored-message-tokens.ts` 内部替换 chars/4（导出签名不变），分段启发式——CJK 连续段按 1.5 字符/token、ASCII/空白段维持 4、消息/块级加少量 overhead 常量；方向宁可略高估（压缩提前触发是安全侧）。保留「最近有效 assistant usage 优先、仅估算 trailing」语义。不改 node_modules。

## 范围

- Spec：新建 `docs/specs/agent/provider-resilience.md`（capability `agent.provider-resilience`，status planned），重试/fallback/估算条款按 proposal 全文写入 planned 合同；本 Task 落地其中估算精度与压缩触发合同的实现；`docs/specs/README.md` 登记。
- 实现：分段估算器（CJK 区间：统一表意文字及扩展区、假名、諺文、全角标点）；`estimateStoredContextTokens` 结构不变，只替换 trailing/无 usage 路径的字符折算。
- 基准：真实章节文本 fixture 与生产 traces 实测值（CJK 重 1.69、ASCII ≈4.1–4.75 字符/token）对拍，误差带 ±25% 内。
- 影响面预告写入 Task 记录：上下文面板 token 读数上升、压缩触发提前是修复效果不是回归（changelog 素材）。

## 验收

1. CJK 基准 fixture 估算误差 ±25% 内；ASCII 主导文本不退化（维持 ≈4 字符/token 带内）。
2. 有有效 assistant usage 的会话估算路径不变（usage 优先）；trailing CJK 段修正生效。
3. `shouldCompact` 触发判定在同一 CJK session 修正前后的对照记录落 `evidences/`。
4. 既有消费方（compaction 触发、keepRecent 选界、`assertContextWithinWindow`、触发线面板）测试全绿；新增估算器单测覆盖分段、overhead、边界字符。
5. 全仓 grep 确认无其它本地 chars/4 消费点被绕过（pi-ai 内 `clampMaxTokensToContext` 为已登记残留，不在本 Task）。

## 结果（2026-09-24，Tasker）

完成，验收 1–5 全部实测通过。

### 实现

- `stored-message-tokens.ts` 内部整体替换：本地 CJK 分段启发式（CJK 段 1.5 字符/token、其余段 4、每消息 overhead +4、图片/附件维持 4800 字符口径=1200 token），导出签名不变；新增 `estimatePlainTextTokens`（非消息负载同口径入口）与 `StoredContextTokenEstimate` 类型；模块转为零 npm 运行时依赖（原 pi-agent-core 值导入移除，profile artifact 依赖面进一步收窄）。usage 优先/trailing 语义逐行保留（aborted/error/零值 usage 不作数）。
- 统一其余本地 chars/4 消费点（验收 5）：trace-segments `charTokens`（system/tools 分区）改走 `estimatePlainTextTokens`；harness 私有 `estimateTextTokens`（`get_session` recentMessages tokenBudget 守卫）删除并直调统一入口；`estimateDialogueContentTokens`（对话正文摘要）委托统一入口。同步注释三处（pi-request-recorder、agent-trace.dto、stored-message-presentation 头注）。

### 验收证据

1. 基准带单测锁定：CJK fixture chars/token ∈ [1.27, 2.11]（实测中值 1.69 ±25%，实现值 1.5 取安全侧高估）；ASCII ∈ [3.08, 5.94]（实现值 4 不退化）。
2. usage 优先路径单测：usageTokens/lastUsageIndex 语义不变，trailing CJK 150 字从旧口径 42 → 新口径 104。
3. `shouldCompact` 对照（真实实现计算，非手推）：`evidences/shouldcompact-before-after.md`——同一 CJK session（usage 80,000 + trailing 6 万字）旧口径 95,000 不触发、新口径 120,004 触发；触发点从约 12.6 万字提前到约 4.7 万字。
4. 消费方测试全绿：聚焦套件 28 + compaction 10 + context-diagnostics/context-inspector + dialogue-content 与 neuro-agent-harness 全量 196；`stored-message-tokens.test.ts` 新增 12 用例（分段/overhead/代理对/全角/toolCall/usage 门禁/基准带）。
5. 全仓 grep（server/shared/app，排除 node_modules）：chars/4 消费点仅存于估算器模块自身与其测试注释；pi-ai `clampMaxTokensToContext` 为已登记残留（不改 node_modules）。
- 门禁：`bun run typecheck:layers` 八层聚合退出码 0；`bun run lint:ratchet` 2145/1513 与基线持平；`bun run docs:check` failures 空。

### 偏差与决定

- 删除 pi 估算器 custom/bashExecution/branchSummary/compactionSummary 分支：本地 `StoredMessageLike` 类型面只有 user/assistant/toolResult（stored-types.ts:36 与 pi `CustomAgentMessages` 默认空双重确证），那些内容以 session entry 而非 message 形态存在，分支在本地调用路径不可达；分层 typecheck 验证了这一点（初版保留时 TS2678 报错）。行为对本地合同零变化。
- 存量精确值断言按新口径有意更新（+4 overhead）：stored-message-presentation.test.ts 三处、compaction.test.ts `summarizedTokens` 1200→1204；trace-segments.test.ts 用例改名并补 CJK 段。
- planned Spec 落为单文件 `docs/specs/agent/provider-resilience.md`（整体 planned；估算条款已落地并在证据节登记），按 Task 指定未拆独立估算 Spec。

### 观察（超出本 Task 范围，待开发者知悉）

- vitest global-setup 的 cache root 回退链 `TEMP ?? TMP ?? "."` 在本机环境（TEMP/TMP 未设）会把 `nbook-app-cache-*` 写进包根；每个残留目录给 lint 口径贡献 24 error（本次 +48 虚高的根因，与代码无关）。已清理存量 4 个目录（可再生缓存）；建议另行把该回退改到系统临时根（test-support/paths），并从根上消除「跑过测试就 lint 不过」的本机陷阱。

### 未运行项

- Full tests 全量未跑（聚焦套件 + 分层 typecheck + ratchet 已逐项等命令实测）；面板读数上升与压缩提前是修复效果，生产表现需部署后观察（部署不在本 Task）。
