---
schema: nbook.work/v1
workId: w00017-provider-resilience
issueId: null
---

# Provider 韧性（重试/backoff + fallback chain + CJK 估算器）

p-009（2026-09-24 accepted）的实施 Work。目标：harness 层 resilience 执行器（可分类错误指数 backoff + jitter、零输出门禁、预算与可取消）、profile `fallbackModelKeys` 降级链与 `summaryModelKey`、CJK 修正 token 估算器覆盖 chars/4；不可重试错误快速失败，成功路径行为零变化。

## 拍板要点（p-009 决策记录 2026-09-24）

- `agent.resilience.enabled` 默认 true；`DEFAULT_PI_MAX_RETRIES = 5` 维持（文档引导按需调低）。
- 不可重试错误不触发 fallback；fallback 允许跨 provider；仅开放 `summaryModelKey` 字段、默认维持主模型。
- CJK 段系数 1.5、验收误差带 ±25%（9/23 生产 traces 实测支持：CJK 重文本 1.69 字符/token，chars/4 低估 ≈2.4 倍）。
- v1 错误分类接受 `errorMessage` 字符串解析 + fail-closed。

## 范围

- t01：planned Spec + CJK 修正估算器（最小独立切片，先修复压缩触发线低估）。
- 后续（不预建）：重试执行器与事件/配置面、fallback chain 与摘要模型路由、前端可见状态与文案。
