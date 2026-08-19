# 场景 6 问表 — Story Grid 方法论本地化

> 来源: 调研报告 `research-sdd-novel-writing-2026-08-18.md` §2.3 Story Grid 5 诫命 + 6 问
> 用途: 写新章时手填 `## 场景` 段, llmlint ruleset `cn.structure.scene-six-questions` 软提示
> 状态: P1-4 落位 (2026-08-19), level: info 永不变 warn / high

---

## 6 问 6 子标题 (固定顺序)

每场景必填以下 6 个子标题, 缺则不强制, 软提示:

### 1. POV
[谁在讲这个故事 / 视角]

### 2. 地点 / 时间
[在哪儿 / 何时]

### 3. 主角想要什么 (Value)
[本章想达成什么 / 价值正负]

### 4. 价值转换
[从 + 转 - / - 转 + / 维持]

### 5. 新信息 / 情感
[主角获得什么新认知或情感变化]

### 6. 下一步必做什么
[本章末主角必须做的下一件事]

---

## 填写示例 (V3 主角章示意)

```markdown
## 场景 1 — 顾霁决定南下

### POV
顾霁 (第一视角)

### 地点 / 时间
苏州市区苏念公寓 / 2025 年深秋深夜

### 主角想要什么 (Value)
不再逃避顾家二房的债务纠纷, 主动南下深圳找鹏达

### 价值转换
从 - (逃避) 转 + (主动)

### 新信息 / 情感
收到鹏达短信"老地址老时间", 知道苏念一直在等他

### 下一步必做什么
订明早 7 点高铁票, 收拾行李
```

---

## 5 诫命映射 (Story Grid 5 诫命 → 6 问字段)

| Story Grid 5 诫命 | 对应 6 问字段 | 说明 |
|---|---|---|
| Inciting Incident (触发事件) | #3 + #5 | 主角想要什么触发新信息 |
| Progressive Complication (递进困难) | #4 + #5 | 价值转换 + 新情感 |
| Crisis (危机) | #6 | 下一步必做什么是危机 |
| Climax (顶点) | #6 | 主角做出选择并行动 |
| Resolution (解决) | #4 + #5 | 价值转换的最终态 |

> 注: 5 诫命不在 P1-4 强制范围, 此映射仅作参考

---

## 与 i128 beat 字段关系 (章级 vs 场景级)

| 维度 | i128 beat (章级) | P1-4 6 问 (场景级) |
|---|---|---|
| 取值来源 | Save the Cat 15 节拍 (i128) | Story Grid 6 问 (调研报告 §2.3) |
| 粒度 | 1 章 1 个 beat | 1 章 N 个场景, 每场景 6 问 |
| 强制力度 | `i128` frontmatter 必填 (硬约束) | `## 场景` 段软提示 (info) |
| 关系 | 互补不冲突 | 互补不冲突 |
| V3 落位 | 必须填 (V1+V2 已 80/80 命中) | 可选填 (V1+V2 0 命中, baseline 报告 0%) |

---

## llmlint 触发说明

`cn.structure.scene-six-questions` ruleset (level: info):
- scope: 章节内 H2 标题 = `## 场景`
- 触发: 缺 `## 场景` 段时提示
- 软提示: "建议为本章添加 ## 场景 段并填 6 问, 参考 reference/scene-six-questions.md"
- 不阻塞: level: info 永不变 warn / high
- 不强制: 6 问子标题顺序 / 内容空 / 编号连续性均不检测

---

## V1+V2 baseline 数据

见 `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md`:
- 总覆盖率 0% (预期, V1+V2 没用过此模板)
- V1 (ch-001 ~ ch-030) 0% / V2 (ch-031 ~ ch-060) 0%
- 6 问子标题频次全 0

> 结论: P1-4 设计作为 V3+ 软引导, V1+V2 0 文件改动
