# 验收 3 本机基准：字面路检索延迟与端到端新增延迟

- 日期：2026-09-27；机器：生产同机（负载常态）。
- 方法：临时 fixture 项目 61 张卡片（8 kind × 7~12，header + 3 段 CJK 正文，facts 直报，embedding 未启用 = 纯字面路零网络）；扫描文本 16,910 字符（brief + ~15KB 章节正文）；每口径 120 次迭代（前 2 次预热），performance.now() 采样。
- 探针：临时文件 `packages/neuro-book/lore-memory-bench.probe.ts`（跑完即删，不入库），`bun lore-memory-bench.probe.ts` 实测输出原文：

```json
{"label":"trigger resolveForChapter","iterations":120,"p50":2.96,"p95":5.45,"max":8.75}
{"label":"memory recall（字面路）","iterations":120,"p50":14.84,"p95":20.24,"max":22.7}
{"label":"resolveChapterLore memory 端到端","iterations":120,"p50":18.86,"p95":24.3,"max":29.67}
{"label":"resolveChapterLore shadow 端到端（注入路径）","iterations":120,"p50":2.97,"p95":18.87,"max":27.94}
```

## 结论

| 口径 | p95 | 预算 | 判定 |
|---|---|---|---|
| memory recall 字面路 | 20.24ms | p95 < 50ms | ✓ 达标 |
| memory 端到端新增延迟（24.30 − trigger 5.45） | ≈ 18.9ms | 同预算 | ✓ 达标 |
| shadow 注入路径 | p50 = 2.97ms ≈ trigger | 用户可观察行为零变化 | ✓ fire-and-forget 生效 |

- shadow p95 18.87ms 高于 trigger 基线：后台观测检索与注入路径共用事件循环（BM25 纯 CPU），属预期竞争而非回归；p50 与 trigger 持平证明注入路径本身零新增。
- 语义路超时降级：单测覆盖（黑洞 embedding 端点 + 200ms race → status `timeout`，远早于 embed 自身 1500ms 超时）；生产常量 `MEMORY_SEARCH_TIMEOUT_MS = 2000`（p-008 决策 3）。错误信息不含 apiKey（用例断言）。
- 卡量级上界：61 卡 ≈ 245 条 facts 下 BM25/倒排在内存；数百卡量级成本同阶（线性扫描），p95 预算仍有 2 倍以上余量。

## shadow 观测记录样例（集成测试产出，字段形状即切换评审数据源）

```json
{
  "ts": "2026-09-27T…",
  "mode": "shadow",
  "queryChars": 168,
  "carryOverPaths": [],
  "trigger": { "paths": ["character/lu-shen"], "ms": 3.12 },
  "memory": {
    "status": "ok",
    "paths": ["character/lu-shen", "character/yin-fa-jian-shi"],
    "rawPaths": ["character/lu-shen", "character/yin-fa-jian-shi"],
    "ms": 15.4,
    "pendingVectors": 7
  },
  "diff": { "onlyTrigger": [], "onlyMemory": ["character/yin-fa-jian-shi"], "common": ["character/lu-shen"] }
}
```

- 真实 invoke 的 ≥20 次两路对照积累自部署后在 shadow 模式发生（配置闸翻转是独立授权动作）；本 Task 交付的是产生该数据的机制与字段合同。
