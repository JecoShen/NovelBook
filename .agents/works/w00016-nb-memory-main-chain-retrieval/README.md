---
schema: nbook.work/v1
workId: w00016-nb-memory-main-chain-retrieval
issueId: null
---

# nb-memory 接入 writer 主链 lore 检索

p-008（2026-09-24 accepted）的实施 Work。目标：writer 主链 lore 卡片选择从字符串 trigger 匹配切换为 nb-memory 检索（语义 + 字面 RRF），经「检索器可插拔 + shadow 双跑 → 配置闸切换 → 退役评估」三阶段收敛；注入预算与渲染管线不变，任何失败自动退回现状路径。

## 拍板要点（p-008 决策记录 2026-09-24）

- 三阶段推进，不直接替换；`agent.loreContext.retriever`（trigger|shadow|memory）默认 `trigger`。
- 延迟预算：字面路 p95 < 50ms；语义路每次注入至多 1 次 embed 调用，超时 2s 自动降级。
- shadow → primary 切换门槛按证据量：≥20 次真实 invoke 两路召回对照 + 差异人工抽样。
- trigger 路径保留为永久降级兜底；`.nbook/memory/` 维持备份默认自动覆盖；v1 只做 global 配置。

## 范围

- t01：planned Spec + 可插拔检索器与 shadow 双跑（阶段 1）。
- 后续（不预建）：primary 切换与对照报告评审、trigger 退役评估。
- 后续（不预建）：authoring kit lore 图瘦身。2026-09-29 CI 实证 lore.mjs 5.7KB→14.5MB（minified），authoring-kit 基线 14.5MB→28.8MB 已按实测重登记；jiti TS loader、Source 类型投影缓存等 Source-only 机制随图混入产品 bundle，可评估剥离或按运行模式裁剪。
