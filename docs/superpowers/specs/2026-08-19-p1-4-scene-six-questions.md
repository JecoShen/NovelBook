# P1-4 场景 6 问表 — Story Grid 6 问 软提示 + V1+V2 baseline 报告

> 设计日期: 2026-08-19
> 来源 spec: `workspace/.../plan/research-sdd-novel-writing-2026-08-18.md` §2.3 + §5.2 P1 候选 4
> 状态: 设计 spec (待 user review)
> 目标: 把 Story Grid 6 问落到 reference 模板 + llmlint 软提示 + V1+V2 baseline 报告,**零侵入**写作流程,符合调研报告 §7.4 抗过度 spec 化原则

---

## §1 背景与现状

调研报告 (`research-sdd-novel-writing-2026-08-18.md` §2.3 / §5.2) 提出 P1 候选 4: **"场景 6 问表"** + §5.2 表 "Story Grid 5 诫命可加 `cn.structure.scene-five-beats` 规则"。

但**报告自身 §7.4 警告**:
> ❌ **过度 spec 化**: 300 章节每节都写 6 问表 = 永远写不到正文

**当前已落地 (P0 完整 / P1 50%)**:
- i128 `beat:` 字段: 80/80 V1+V2 章命中
- i129 `cn.structure.chapter-hook` 规则: 5 模式 detector, scope=ending 200 chars
- i134 perf benchmark: 0.00/0.31/3.49ms 余量充足
- P1-3 lore-resolver: 14 commits merged, I-1 production wiring 完成, 7/7 验收

**根因 (P1-4 之前的状态)**:
- `reference/` 当前无 `scene-six-questions.md` 模板
- `assets/.../llmlint/rulesets/.../rules/structure/` 无 scene-six-questions 规则
- 无 V1+V2 baseline 覆盖率数据 (V1+V2 没填过 ## 场景 段, 预期 0%)
- writer.profile.tsx 当前不参考 6 问提示 (per P1-4 范围决策: 保持不集成)

---

## §2 设计选择

### 2.1 强制力度 (沿用报告 §7.4 抗反模式)

| 候选 | 行为 | 风险 | 评估 |
|---|---|---|---|
| **A. 轻量级 (level: info)** | ruleset 触发时仅 info 提示, 不报错 | 低: 写新章时建议填, 不强制 | **选定** |
| B. 中等 (level: warn) | 缺 `## 场景` 段报 warn | 中: 阻碍快速写作 | 否决 (§7.4 警告) |
| C. 严格 (level: high + 5 诫命) | 全检 | 高: 永远写不到正文 | 否决 (§7.4 警告) |

**决策**: 全程 level=info, 永不变 warn / high. 模板可见, 检测软提示, 0 阻塞.

### 2.2 作用范围 (Forward + V1+V2 baseline 报告)

| 候选 | 行为 | 评估 |
|---|---|---|
| **A. Forward-only** | 仅服务 Vol 3+ | 否决 (V1+V2 baseline 数据价值高) |
| **B. Forward + V1+V2 baseline 报告** | baseline 脚本跑一次, 报告入 archive, 不动 V1+V2 文件 | **选定** |
| C. 全部回填 | 60+ 章全补 ## 场景 段 | 否决 (§7.4 警告) |

**决策**: baseline 脚本只读不写, 跑完出报告即退出. V1+V2 0 文件改动.

### 2.3 集成深度 (独立 reference + ruleset)

| 候选 | 改动面 | 评估 |
|---|---|---|
| **A. 独立 reference + ruleset** | 1 模板 + 1 JSON | **选定** (用户选 A) |
| B. + writer profile 提示 | + 改 writer.profile.tsx | 否决 (侵入 AI 写作流) |
| C. + carryOverPaths 联动 | + 改 lore-injection | 否决 (侵入 lore 系统) |

**决策**: 零侵入. 不动 writer.profile.tsx / neuro-agent-harness.ts / lore-resolver.

### 2.4 baseline-scan 范围

| 候选 | 行为 | 评估 |
|---|---|---|
| **A. 沿用 i129 `scripts/baseline-scan.cjs` 派生** | 复制改少量, 输出 markdown 报告 | **选定** (复用 90% 代码) |
| B. 新写独立脚本 | 0 复用 | 否决 (重复) |

**决策**: 派生 `scripts/baseline-scan-scene-six-questions.cjs`, 沿用同一 regex 模式 + 输出格式.

---

## §3 架构

```
reference/scene-six-questions.md (~120 行)
─────────────────────────────────────────
- 6 问 6 子标题模板 (POV / 地点时间 / 想要什么 / 价值转换 / 新信息 / 下一步)
- 1 个填写示例 (V3 主角章)
- 5 诫命映射表 (Inciting / Progressive / Crisis / Climax / Resolution ← 对应哪 6 问字段)
- 与 i128 beat 字段关系说明 (章级 vs 场景级)


assets/.../llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json (~30 行)
─────────────────────────────────────────
{
  "id": "cn.structure.scene-six-questions",
  "namespace": "structure.scene-six-questions",
  "title": "场景 6 问 (P1-4: Story Grid 6 问 软提示)",
  "level": "low",
  "review": "agent",
  "fixability": "manual",
  "enabled": true,
  "note": "P1-4 (2026-08-19) — 调研报告 §2.3 落地。level=low 永不变 medium/high, 抗 §7.4 过度 spec 化。detector 非锚定, 会命中任意内联 \"## 场景\" 提及, level=low 软提示可接受; 缺 ## 场景 段的章也触发软提示。",
  "detector": {
    "type": "regex",
    "targets": ["## 场景"]
  },
  "action": {
    "type": "suggest",
    "message": "建议为本章添加 ## 场景 段并填 6 问 (POV / 地点时间 / 想要什么 / 价值转换 / 新信息 / 下一步), 参考 reference/scene-six-questions.md"
  }
}


scripts/baseline-scan-scene-six-questions.cjs (~150 行)
─────────────────────────────────────────
- 输入: workspace/.../manuscript/<vol>/<ch>/index.md
- 沿用 i129 baseline-scan.cjs 模式
- 检测: 包含 `## 场景` 的 chapter 数 / 6 问子标题出现频次
- 输出: workspace/.../.agent/plan/i135-p1-4-baseline-report.md
- 退出码: 0 (baseline 是只读, 不报错)


workspace/.../i135-p1-4-baseline-report.md (自动生成)
─────────────────────────────────────────
- 总覆盖: 60 章 / 含 ## 场景 段 0 章 / 覆盖率 0% (预期)
- 每卷: V1 30 章 / V2 30 章 / 各 0%
- 6 问子标题频次: POV 0 / 地点 0 / 想要什么 0 / ...
- 结论: V1+V2 全章未填 ## 场景 段, P1-4 设计作为 V3+ 软引导
```

**不变量**:
- 不动 `writer.profile.tsx` / `neuro-agent-harness.ts` / `lore-resolver*`
- 不动 V1+V2 任何 chapter 文件
- ruleset 永不变 medium / high
- 报告写 `.agent/plan/` 不污染 `docs/`

### 3.1 detector 锚定权衡 (2026-08-19 实施实证, 用户选 C 校正)

实施 Task 4 GREEN 时实证发现 llmlint scanner 约束:
- scanner 用 `g` flag 且无 `m` flag → `^` 只锚定字符串开头, **非行首**
- scanner 无 "缺段" 原语, 只有正向匹配 (positive-match only)
- 因此 锚定行首的写法无法满足 test 4 (期望无 `## 场景` 段的章也触发 issue)

**修正**: detector 定为**非锚定** `"## 场景"`, 与实现 `d2c0d5b3` 对齐。trade-off 接受:
- 会命中任意内联 `"## 场景"` 提及 (如 "参见 ## 场景 模板")
- level=low 软提示不阻塞, 仅信息性, 故可接受
- 章完全无 `## 场景` 提及 → 无 issue (test 4 精确文本仍触发); 但提及 `## 场景` 却无真实场景段的章也会触发 — 这是设计接受的噪声

---

## §4 错误处理

| 场景 | 行为 |
|---|---|
| `reference/scene-six-questions.md` 不存在 | ruleset 启动检测 → soft info 提示"参考路径缺失, 请联系 maintainer" |
| baseline-scan 找不到 `manuscript/` | 输出 `{ error: "no manuscript dir" }` 不退出 (退出码 0) |
| baseline-scan 章节无 frontmatter | 跳过 + 计入 `skipped: N` 不报错 |
| ruleset JSON 解析失败 | 沿用 llmlint 通用 fallback (chapter-hook 验证过) |
| 报告写入失败 | 沿用 i129 baseline 模式 (mkdir-p + try-catch) |

**显式不处理** (避免 §7.4 过度 spec 化):
- ❌ 缺 `## 场景` 段 → 不报错 (info 是单向软提示)
- ❌ 6 问子标题顺序错乱 → 不检测
- ❌ 6 问内容空 → 不检测
- ❌ 跨章 `## 场景 N` 编号连续性 → 不检测
- ❌ 5 诫命子段 (per Story Grid) → 不强制 (6 问 ≠ 5 诫命, 不耦合)
- ❌ baseline 报告触发任何 enforcement → 报告只读

---

## §5 测试与验收 (spec §8 验收表)

| # | 维度 | 验收标准 |
|---|---|---|
| 1 | 模板存在 | `reference/scene-six-questions.md` 文件存在 + 6 问子标题完整 + 至少 1 个填写示例 + 5 诫命映射表 + 与 i128 beat 关系说明 |
| 2 | 规则 JSON 合法 | `scene-six-questions.json` 通过 `JSON.parse` + 5 字段齐全 (id/scope/level/message/example) + level="info" 验证 |
| 3 | ruleset 实际触发 | 写 1 个测试章 (无 `## 场景` 段) 跑 llmlint pipeline, 验证 info 提示出现 + 引用 reference 路径 |
| 4 | ruleset 不阻塞 | 缺 `## 场景` 段时 exit code 0, 不影响其他规则 (chapter-hook 仍正常) |
| 5 | baseline 脚本可跑 | `node scripts/baseline-scan-scene-six-questions.cjs` 退出码 0 + 报告生成 |
| 6 | V1+V2 baseline 数据合理 | 总覆盖率 0% (预期) + 每卷分布 = 0% (预期) + 6 问子标题频次 = 0 (预期) + 不影响 V1+V2 任何文件 |
| 7 | 不污染主 workspace | 0 push / 0 merge / 0 改 master (archive 模式) + 报告落 `.agent/plan/` |
| 8 | 现有测试不退化 | chapter-hook 5 模式仍正常 + i128 beat 80/80 仍命中 + lore-resolver 32/32 + i134 perf 仍 < 100/20/50ms |

**spec §8 验收: 8/8** (i128 模式, 全 8 项独立可验证)

---

## §6 实施范围 (worktree + archive 模式)

| 维度 | 数据 |
|---|---|
| 新 worktree | `feat-p1-4-scene-six-questions` 基于 main (11c022ed) |
| 改动文件 | 0 (全新增) |
| 新增文件 | 3 (模板 + ruleset + baseline-scan) + 1 自动报告 |
| archive 模式 | worktree 内 + cp 主工作区 + 0 push/0 merge |
| 验收 | 8/8 |
| 风险 | 低 — 全新增, 失败不破坏任何现有资产 |
| 估时 | 3-4 hr (RED 1h + GREEN 1h + baseline 1h + 收尾 30min) |
| 估 token | 10-15k |

---

## §7 文件清单 (worktree 内)

新增 4 文件:

| 文件 | 行数估 | 用途 |
|---|---|---|
| `reference/scene-six-questions.md` | ~120 | 模板 + 6 问 + 示例 + 5 诫命映射 + beat 关系 |
| `assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json` | ~30 | ruleset JSON (level: info) |
| `scripts/baseline-scan-scene-six-questions.cjs` | ~150 | baseline 扫描脚本 (派生 i129) |
| `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md` | auto | V1+V2 baseline 报告 |

修改 0 文件 (不碰 writer.profile.tsx / harness / lore).

**总计**: 4 文件新, 0 文件改, ~300 行. **全 worktree 内**, 主分支 0 改动.

---

## §8 不在范围 (Out of Scope)

- ❌ 强制 `## 场景` 段 (永不变 warn / high)
- ❌ 6 问子标题顺序检测
- ❌ 5 诫命子段强制 (Story Grid 5 诫命不在 P1-4 范围)
- ❌ 跨章场景编号连续性
- ❌ LLM 语义检测 6 问质量 (留 v4.8+)
- ❌ writer.profile.tsx 集成 (per 2.3 决策)
- ❌ lore-resolver / carryOverPaths 联动
- ❌ V1+V2 回填 `## 场景` 段 (per 2.2 决策)
- ❌ baseline 报告触发任何 enforcement
- ❌ 国际化 `story-bible-sdd` 模板 (调研报告 P2-6, 留 v4.8+)

---

## §9 与既有架构对齐

| 既有资产 | 对齐方式 |
|---|---|
| `assets/.../llmlint/rulesets/builtin/default/rules/structure/chapter-hook.json` | 5 字段模式完全沿用 (id/scope/level/message/example) |
| `scripts/baseline-scan.cjs` (i129 派生) | 90% 复用, 派生 baseline-scan-scene-six-questions.cjs |
| `reference/` 目录 | 与现有 reference/scene-six-questions.md 共存 |
| i128 beat 字段 | 互补不冲突: beat = 章级 (Save the Cat 15), scene-six-questions = 场景级 (Story Grid 6 问) |
| i129 chapter-hook ruleset | 并行独立: chapter-hook scope=ending 200 chars, scene-six-questions scope=chapter-h2 全文 |
| 调研报告 §7.4 抗反模式 | level=info 严格遵守, 0 强制 |
| archive 模式 (5 批次先例) | 沿用 worktree + cp + 0 push + 报告入 .agent/plan/ |

---

## §10 调研报告 P1-4 完成度更新

| 调研报告 P0-P2 建议 | 落位状态 |
|---|---|
| P0-1 beat 字段 | ✅ i128 (已落) |
| P0-2 chapter-hook 规则 | ✅ i129 (已落) |
| P1-3 lore-resolver | ✅ P1-3 MVP + I-1 wiring (已落) |
| **P1-4 场景 6 问表** | **本 spec 落位** (3/6 → 4/6, 67%) |
| P2-5 scene-master-list | ❌ 留 v4.8+ |
| P2-6 story-bible 模板 | ❌ 留 v4.8+ |

**进度: 4/6 = 67%** (调研报告 P0-P2 共 6 条, 4 条落位).

---

## §11 参考

- 上游 spec: `workspace/.../plan/research-sdd-novel-writing-2026-08-18.md` §2.3 / §5.2 / §7.4
- i128 spec: `workspace/.../superpowers-specs/2026-08-18-` (chapter beat 字段模式)
- i129 spec: `docs/superpowers/specs/2026-08-18-lore-resolver-design.md` (chapter-hook ruleset 模式)
- i129 baseline-scan.cjs: 复用 90%
- archive 模式 5 批次先例: v45-p1-3-archive / v45-i-1-archive / v45-sdd-p0-archive / v45-p1-chapter-hook-archive / v45-p2-1-reversal-fp-tune-archive
- ECC `common/development-workflow.md`: TDD RED→GREEN→IMPROVE
- ECC `common/coding-style.md`: immutability, error handling, naming
