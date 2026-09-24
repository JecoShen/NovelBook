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
