# i135 P1-4 Scene Six Questions — V1+V2 Baseline Report

> 调研报告: `research-sdd-novel-writing-2026-08-18.md` §2.3
> 落位 spec: `docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md`
> 扫描日期: 2026-08-19
> 脚本: `scripts/baseline-scan-scene-six-questions.cjs`

## 总覆盖率

- 含 `## 场景` 段: **0 / 80** 章
- 总覆盖率: **0%**

## 每卷覆盖率

| 卷 | 含 ## 场景 | 总章数 | 覆盖率 |
|---|---|---|---|
| 第1卷-坠落 | 0 | 30 | 0% |
| 第2卷-暗潮 | 0 | 50 | 0% |

## 6 问子标题频次

| 6 问 | 子标题 regex | 出现次数 |
|---|---|---|
| POV | `^### POV\b` | 0 |
| 地点/时间 | `^### 地点(?=\s|$)` | 0 |
| 主角想要什么 | `^### 主角想要什么(?=\s|$)` | 0 |
| 价值转换 | `^### 价值转换(?=\s|$)` | 0 |
| 新信息/情感 | `^### 新信息(?=\s|$)` | 0 |
| 下一步必做 | `^### 下一步必做(什么)?(?=\s|$)` | 0 |

## 结论

- V1+V2 全章未填 `## 场景` 段, **符合预期** (P1-4 设计为 V3+ 软引导)
- 调研报告 §7.4 抗过度 spec 化原则: V1+V2 0 文件改动, V3+ 启用

## 下一步

- V3 写作时按 `reference/scene-six-questions.md` 模板手填 `## 场景` 段
- llmlint ruleset `cn.structure.scene-six-questions` (level: low) 给软提示
- V3 完结后跑一次 V3 baseline 对比 V1+V2 当前数据
