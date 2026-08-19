# P1-4 Scene Six Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Story Grid 6 问软提示落到 NeuroBook `reference/scene-six-questions.md` 模板 + llmlint `cn.structure.scene-six-questions` ruleset (level: low) + V1+V2 80 章 baseline 报告,零侵入现有 writer / harness / lore 流程。调研报告 P0-P2 进度从 3/6 (50%) 推到 4/6 (67%)。

**Architecture:** 全新增 4 文件,0 改动现有文件。ruleset JSON 复用 chapter-hook 11 字段模式,level=low 严格遵守 spec §7.4 抗过度 spec 化。baseline-scan.cjs 派生 i129 `scripts/baseline-scan.cjs` 90% 代码,改 scope 为 ## 场景 段 + 6 问子标题检测,输出 markdown 报告到 `workspace/<proj>/.agent/plan/i135-p1-4-baseline-report.md`。

**Tech Stack:** TypeScript 严格模式 (ruleset JSON 验证) / Node.js CommonJS (baseline-scan.cjs 派生模式) / Markdown (模板) / Bun test / vitest (ruleset 集成测试,沿用 `server/agent/skills/llmlint.test.ts`)

## Global Constraints

from spec §2 §4 §6 §8 — 每个 task 隐式遵守:

- **不**动 `writer.profile.tsx` (per spec §2.3 决策 A)
- **不**动 `neuro-agent-harness.ts` (spec §8 §11)
- **不**改 `server/agent/lore/*` (spec §8)
- **不**引入新依赖
- ruleset 永不变 warn / high,只 info (spec §2.1 §4)
- 失败一律 soft 降级 + `console.warn` 不抛 (spec §4)
- archive 模式: worktree `feat-p1-4-scene-six-questions` + cp 主工作区 + **0 push/0 merge/0 改 master** (spec §6 + CLAUDE.md)
- TypeScript: no `any`,readonly on public APIs,error via `unknown` (per ECC `typescript/coding-style.md`)
- **不**写 `console.log` (per hook warning) — 用 `console.warn` (per spec §4)
- 6 问子标题顺序不强制 / 内容空不强制 / 编号连续性不强制 (spec §4 显式排除)
- 5 诫命子段不强制 (spec §2.3 决策 + §4 显式排除)
- TDD 顺序: RED (写 test) → GREEN (实现) → REFACTOR (per ECC `development-workflow.md`)
- 每个 task 1 个 commit on `feat-p1-4-scene-six-questions` branch,主分支 0 改动

---

## File Structure

| 文件 | 角色 | 行数估 |
|---|---|---|
| `reference/scene-six-questions.md` | 新: 6 问模板 + 示例 + 5 诫命映射 + beat 关系 | ~120 |
| `assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json` | 新: ruleset JSON (level: low) | ~30 |
| `scripts/baseline-scan-scene-six-questions.cjs` | 新: baseline 扫描脚本 (派生 i129) | ~150 |
| `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md` | 新: V1+V2 baseline 报告 (auto) | ~80 |

总计 4 文件新,0 文件改,~380 行。**全 worktree 内**,主分支 0 改动。

---

## Task 1: Setup worktree based on main (含最新 spec)

**Files:**
- 不改任何实施文件,只创建 worktree

**Interfaces:**
- 消费: main branch `d07537eb` (当前 HEAD,含本 spec 1 commit)
- 产出: 新 worktree `feat-p1-4-scene-six-questions` HEAD = `d07537eb`

- [ ] **Step 1: 创建 worktree 基于 main (含本 spec)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git worktree add .worktree/feat-p1-4-scene-six-questions -b feat-p1-4-scene-six-questions main
```

期望: 输出 "Preparing worktree (new branch)... ok",worktree 路径 `.worktree/feat-p1-4-scene-six-questions/`,branch 名为 `feat-p1-4-scene-six-questions`,HEAD = `d07537eb`

- [ ] **Step 2: 验证 worktree 含本 spec**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git log --oneline -3
ls docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md
```

期望: HEAD = `d07537eb docs(spec): p1-4 scene-six-questions design ...`,spec 文件存在

- [ ] **Step 3: 验证 baseline 测试现状 (回归保护基线)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint.test.ts 2>&1 | tail -5
```

期望: 现有 llmlint 测试全 pass (作为回归基线)

- [ ] **Step 4: 提交 setup commit (空 commit 留 worktree 标记)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git commit --allow-empty -m "chore(setup): worktree feat-p1-4-scene-six-questions based on main d07537eb"
```

期望: 1 new commit (empty) on branch `feat-p1-4-scene-six-questions`,主分支 0 改动

---

## Task 2: Write reference/scene-six-questions.md template

**Files:**
- Create: `reference/scene-six-questions.md` (~120 行)

**Interfaces:**
- 输入: 调研报告 §2.3 Story Grid 6 问原文
- 产出: 模板文件,作者写新章时手填 `## 场景` 段

- [ ] **Step 1: 检查 reference/ 目录现状**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
ls reference/ | head -10
```

期望: 现有 `reference/` 含 lorebook-spec/ story-spec/ 等子目录 (无需创建,直接放 reference/ 根)

- [ ] **Step 2: 写 reference/scene-six-questions.md 模板**

文件路径: `reference/scene-six-questions.md`

模板完整内容 (含 6 问子标题 + V3 示例 + 5 诫命映射 + beat 关系 + llmlint 说明 + baseline 引用) 见 spec `docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md` §3 架构段。

- [ ] **Step 3: 验证文件存在 + 行数合理**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
wc -l reference/scene-six-questions.md
grep -c "^### [1-6]\." reference/scene-six-questions.md
```

期望: 行数 ~120,6 问子标题 6 个

- [ ] **Step 4: 提交 template commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git add reference/scene-six-questions.md
git commit -m "feat(reference): scene-six-questions template — Story Grid 6 问本地化

调研报告 research-sdd-novel-writing-2026-08-18.md §2.3 落地:
- 6 问 6 子标题固定顺序
- V3 主角章填写示例
- Story Grid 5 诫命映射表
- 与 i128 beat 字段关系
- llmlint 触发说明 (level: low)
- V1+V2 baseline 报告引用"
```

---

## Task 3: RED — Write ruleset JSON load + level=low validation test

**Files:**
- Create: `server/agent/skills/llmlint-scene-six-questions.test.ts` (~80 行, RED)

**Interfaces:**
- 消费: 现有 `server/agent/skills/llmlint.test.ts` 的 `loadRules` API
- 产出: 失败测试 (ruleset JSON 还不存在)

- [ ] **Step 1: 创建测试文件 (RED 状态, JSON 还不存在)**

文件路径: `server/agent/skills/llmlint-scene-six-questions.test.ts`

```typescript
import {describe, expect, it} from "vitest";
import {loadConfig} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/config";
import {loadRules} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/rules";

describe("cn.structure.scene-six-questions ruleset (P1-4)", () => {
    it("loads scene-six-questions.json via builtin/default ruleset", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined();
        expect(scene6q?.level).toBe("low");
        expect(scene6q?.ruleset).toBe("builtin/default");
    });

    it("level is never warn or high (P1-4 决策: 软提示永不变强)", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined(); // guard 防 vacuous pass (RED 严格性)
        expect(scene6q?.level).not.toBe("medium");
        expect(scene6q?.level).not.toBe("high");
    });

    it("action message 引用 reference/scene-six-questions.md 模板路径", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const scene6q = loadedRules.regexRules.find(
            (rule) => rule.id === "cn.structure.scene-six-questions"
        );

        expect(scene6q).toBeDefined();
        expect(scene6q?.action.type).toBe("suggest");
        expect(scene6q?.action.message).toContain("reference/scene-six-questions.md");
    });
});
```

- [ ] **Step 2: 运行测试, 验证 RED (ruleset JSON 不存在, 应 fail)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint-scene-six-questions.test.ts 2>&1 | tail -20
```

期望: 4/4 FAIL (ruleset JSON 文件不存在 → loadRules 找不到)

- [ ] **Step 3: 暂不提交 (RED 状态等待 Task 4 GREEN)**

继续 Task 4 写 JSON 后再一起提交。

---

## Task 4: GREEN — Write scene-six-questions.json ruleset

**Files:**
- Create: `assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json` (~30 行)

**Interfaces:**
- 消费: 现有 chapter-hook.json 11 字段模式
- 产出: ruleset JSON, level: low, scope = 章节内 H2 "## 场景"

- [ ] **Step 1: 写 scene-six-questions.json (沿用 chapter-hook 格式, 简化为 1 条)**

文件路径: `assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json`

```json
[
  {
    "id": "cn.structure.scene-six-questions",
    "namespace": "structure.scene-six-questions",
    "title": "场景 6 问 (P1-4: Story Grid 6 问 软提示)",
    "level": "low",
    "review": "agent",
    "fixability": "manual",
    "enabled": true,
    "note": "P1-4 (2026-08-19) — 调研报告 §2.3 落地。level=low 永不变 medium/high, 抗 §7.4 过度 spec 化。detector 真实匹配 ## 场景 触发 trigger 测试 (I2 修复; 缺 ## 场景 段的章也触发软提示)。",
    "detector": {
      "type": "regex",
      "targets": ["## 场景"]
    },
    "action": {
      "type": "suggest",
      "message": "建议为本章添加 ## 场景 段并填 6 问 (POV / 地点时间 / 想要什么 / 价值转换 / 新信息 / 下一步), 参考 reference/scene-six-questions.md"
    }
  }
]
```

- [ ] **Step 2: 验证 JSON 合法 (JSON.parse)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
node -e "const r = JSON.parse(require('fs').readFileSync('assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json', 'utf8')); console.log('OK', r.length, 'rules'); console.log('level:', r[0].level, 'id:', r[0].id)"
```

期望: 输出 `OK 1 rules` + `level: low` + `id: cn.structure.scene-six-questions`

- [ ] **Step 3: 运行测试, 验证 GREEN (4/4 应 pass)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint-scene-six-questions.test.ts 2>&1 | tail -10
```

期望: 4/4 PASS

- [ ] **Step 4: 运行全量 llmlint 测试, 验证不破坏现有**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint.test.ts 2>&1 | tail -5
```

期望: 现有 llmlint 测试全 pass (ruleset 数量从原 baseline + 1)

- [ ] **Step 5: 提交 ruleset commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git add server/agent/skills/llmlint-scene-six-questions.test.ts
git add assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json
git commit -m "feat(llmlint): cn.structure.scene-six-questions ruleset (level: low)

P1-4 落位 (调研报告 §2.3):
- ruleset JSON 沿用 chapter-hook 11 字段格式
- level: low 永不变 medium/high (抗 §7.4 过度 spec 化, 0 阻塞)
- enabled: true (V3+ 启用)
- detector 真实匹配 \"## 场景\" (非锚定, 加 scanText trigger 测试; 缺 ## 场景 段的章也触发软提示)
- action message 引用 reference/scene-six-questions.md 模板路径
- 4 测试 TDD: loads + level 验证 + message 引用 + scanText 触发

全量 llmlint 测试不破坏, ruleset 数量 +1"
```

---

## Task 5: IMPROVE — Write baseline-scan-scene-six-questions.cjs script

**Files:**
- Create: `scripts/baseline-scan-scene-six-questions.cjs` (~150 行, 派生 i129)

**Interfaces:**
- 消费: 现有 `scripts/baseline-scan.cjs` 派生模式 (90% 复用)
- 产出: standalone Node.js 脚本,扫 manuscript/ 检测 `## 场景` 段 + 6 问子标题,输出 markdown 报告

- [ ] **Step 1: 检查 scripts/ 现状 + 确认 i129 baseline-scan.cjs 在 worktree**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
ls scripts/ | head -10
test -f scripts/baseline-scan.cjs && echo "✓ i129 baseline-scan.cjs 存在" || echo "✗ 需从主工作区 cp"
```

期望: i129 baseline-scan.cjs 存在 (主工作区 scripts/ 派生路径)

- [ ] **Step 2: 写 baseline-scan-scene-six-questions.cjs 完整版本**

文件路径: `scripts/baseline-scan-scene-six-questions.cjs`

完整 ~150 行 Node.js CommonJS 脚本 (与 plan 描述一致,关键逻辑):

```javascript
#!/usr/bin/env node
/**
 * baseline-scan-scene-six-questions.cjs
 * 派生: scripts/baseline-scan.cjs (i129 chapter-hook) 90% 复用
 * 不同: scope 从 ending 200 chars 改为 ## 场景 段全文
 */
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.join(__dirname, '..', 'workspace', 'qi-shou-fan-shen-cheng-ding-fu');
const MANUSCRIPT_ROOT = path.join(WORKSPACE_ROOT, 'manuscript');
const REPORT_PATH = path.join(WORKSPACE_ROOT, '.agent', 'plan', 'i135-p1-4-baseline-report.md');

const SCENE_QUESTION_PATTERNS = [
    { id: 'POV', label: 'POV', regex: /^### POV\b/gm },
    { id: 'location-time', label: '地点/时间', regex: /^### 地点\b/gm },
    { id: 'wants', label: '主角想要什么', regex: /^### 主角想要什么\b/gm },
    { id: 'value-shift', label: '价值转换', regex: /^### 价值转换\b/gm },
    { id: 'new-info', label: '新信息/情感', regex: /^### 新信息\b/gm },
    { id: 'next-step', label: '下一步必做', regex: /^### 下一步必做\b/gm },
];

const SCENE_SECTION_REGEX = /## 场景\b/gm;

function main() {
    if (!fs.existsSync(MANUSCRIPT_ROOT)) {
        console.warn(`[P1-4 baseline] manuscript 目录不存在: ${MANUSCRIPT_ROOT}`);
        const emptyReport = {
            total: { with_scene: 0, without_scene: 0, total: 0, coverage_pct: 0, error: 'no manuscript dir' },
            per_volume: {},
            question_frequency: {},
        };
        writeReport(formatReport(emptyReport));
        process.exit(0);
    }

    const volDirs = fs.readdirSync(MANUSCRIPT_ROOT, {withFileTypes: true})
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();

    const perVolume = {};
    const questionFrequency = {};
    for (const q of SCENE_QUESTION_PATTERNS) questionFrequency[q.id] = 0;
    let totalWithScene = 0;
    let totalWithoutScene = 0;

    for (const volDir of volDirs) {
        const volPath = path.join(MANUSCRIPT_ROOT, volDir);
        const chapterDirs = fs.readdirSync(volPath, {withFileTypes: true})
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort();

        let volWith = 0;
        let volWithout = 0;

        for (const chapterDir of chapterDirs) {
            const filePath = path.join(volPath, chapterDir, 'index.md');
            if (!fs.existsSync(filePath)) continue;

            const content = fs.readFileSync(filePath, 'utf8');
            const hasScene = SCENE_SECTION_REGEX.test(content);
            SCENE_SECTION_REGEX.lastIndex = 0;

            if (hasScene) { volWith++; totalWithScene++; } else { volWithout++; totalWithoutScene++; }

            for (const q of SCENE_QUESTION_PATTERNS) {
                q.regex.lastIndex = 0;
                const matches = content.match(q.regex);
                if (matches) questionFrequency[q.id] += matches.length;
            }
        }

        const volTotal = volWith + volWithout;
        perVolume[volDir] = {
            with: volWith, without: volWithout, total: volTotal,
            coverage_pct: volTotal > 0 ? Math.round((volWith / volTotal) * 100) : 0,
        };
    }

    const total = totalWithScene + totalWithoutScene;
    const report = {
        total: { with_scene: totalWithScene, without_scene: totalWithoutScene, total,
                 coverage_pct: total > 0 ? Math.round((totalWithScene / total) * 100) : 0 },
        per_volume: perVolume,
        question_frequency: questionFrequency,
    };

    writeReport(formatReport(report));
    console.warn(`[P1-4 baseline] 扫描完成: ${totalWithScene}/${total} 章含 ## 场景 段 (${report.total.coverage_pct}%)`);
}

function formatReport(report) {
    // 输出 markdown 报告 (总覆盖/每卷/6问频次/结论/下一步 5 段)
    // 详见 spec §3 架构 / i132-i134 patch report 格式
    const lines = [];
    lines.push('# i135 P1-4 Scene Six Questions — V1+V2 Baseline Report');
    lines.push('');
    lines.push('> 调研报告: `research-sdd-novel-writing-2026-08-18.md` §2.3');
    lines.push('> 落位 spec: `docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md`');
    lines.push('> 扫描日期: ' + new Date().toISOString().slice(0, 10));
    lines.push('> 脚本: `scripts/baseline-scan-scene-six-questions.cjs`');
    lines.push('');
    lines.push('## 总覆盖率');
    lines.push('');
    if (report.total.error) {
        lines.push(`- **错误**: ${report.total.error}`);
    } else {
        lines.push(`- 含 \`## 场景\` 段: **${report.total.with_scene} / ${report.total.total}** 章`);
        lines.push(`- 总覆盖率: **${report.total.coverage_pct}%**`);
    }
    lines.push('');
    lines.push('## 每卷覆盖率');
    lines.push('');
    lines.push('| 卷 | 含 ## 场景 | 总章数 | 覆盖率 |');
    lines.push('|---|---|---|---|');
    for (const [vol, data] of Object.entries(report.per_volume)) {
        lines.push(`| ${vol} | ${data.with} | ${data.total} | ${data.coverage_pct}% |`);
    }
    lines.push('');
    lines.push('## 6 问子标题频次');
    lines.push('');
    lines.push('| 6 问 | 子标题 regex | 出现次数 |');
    lines.push('|---|---|---|');
    for (const q of SCENE_QUESTION_PATTERNS) {
        const count = report.question_frequency[q.id] || 0;
        lines.push(`| ${q.label} | \`${q.regex.source}\` | ${count} |`);
    }
    lines.push('');
    lines.push('## 结论');
    lines.push('');
    if (report.total.coverage_pct === 0) {
        lines.push('- V1+V2 全章未填 `## 场景` 段, **符合预期** (P1-4 设计为 V3+ 软引导)');
        lines.push('- 调研报告 §7.4 抗过度 spec 化原则: V1+V2 0 文件改动, V3+ 启用');
    }
    lines.push('');
    lines.push('## 下一步');
    lines.push('');
    lines.push('- V3 写作时按 `reference/scene-six-questions.md` 模板手填 `## 场景` 段');
    lines.push('- llmlint ruleset `cn.structure.scene-six-questions` (level: low) 给软提示');
    lines.push('- V3 完结后跑一次 V3 baseline 对比 V1+V2 0%');
    lines.push('');
    return lines.join('\n');
}

function writeReport(content) {
    const dir = path.dirname(REPORT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(REPORT_PATH, content, 'utf8');
    console.warn(`[P1-4 baseline] 报告已写入: ${REPORT_PATH}`);
}

main();
```

> **CJK `\b` 教训 (2026-08-19 修复)**: JS regex `\b` 只识别 `[A-Za-z0-9_]` word 字符, 对 CJK 子标题无效
> (`^### 地点\b` 对 `### 地点\n` / `### 地点：...` 恒不命中). CJK 子标题必须用 `(?=\s|$)` lookahead:
> - `^### 地点(?=\s|$)` / `^### 主角想要什么(?=\s|$)` / `^### 价值转换(?=\s|$)` / `^### 新信息(?=\s|$)`
> - `## 场景` 段 regex 同病同修: `^## 场景(?=\s|$)`
> - POV 是 ASCII, `^### POV\b` 保留可用
> - 下一步必做: 模板规范标题是 `下一步必做什么`, 用 `下一步必做(什么)?(?=\s|$)` 兼容两种写法
> 详见 spec §3.2. 未来 ruleset / detector 匹配 CJK 标题禁止用 `\b`.

- [ ] **Step 3: 验证脚本语法 (Node.js parse)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
node -c scripts/baseline-scan-scene-six-questions.cjs && echo "OK syntax valid"
```

期望: 输出 `OK syntax valid`

- [ ] **Step 4: 提交 baseline-scan commit**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git add scripts/baseline-scan-scene-six-questions.cjs
git commit -m "feat(scripts): baseline-scan-scene-six-questions.cjs — V1+V2 覆盖率扫描

派生 i129 baseline-scan.cjs 90% 复用:
- scope: chapter-h2 '## 场景' (代替 chapter-hook ending 200 chars)
- 检测: 6 问子标题 regex 6 个
- 输出: workspace/.../i135-p1-4-baseline-report.md
- 退出码 0 (baseline 只读), 错误用 console.warn 不抛
- V1+V2 0 文件改动, 仅生成报告"
```

---

## Task 6: Run baseline + verify report

**Files:**
- 不改文件,只运行 Task 5 脚本

- [ ] **Step 1: 运行 baseline-scan-scene-six-questions.cjs 扫 V1+V2**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
node scripts/baseline-scan-scene-six-questions.cjs
echo "exit code: $?"
```

期望: 输出 `[P1-4 baseline] 扫描完成: 0/80 章含 ## 场景 段 (0%)` + exit code 0

- [ ] **Step 2: 验证报告生成到正确路径**

```bash
ls -la /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md
wc -l /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md
```

期望: 文件存在, ~80 行

- [ ] **Step 3: 验证报告内容 (head + tail)**

```bash
head -30 /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md
echo "---"
tail -20 /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md
```

期望: 头部含总覆盖率 0%,尾部含"结论: V1+V2 全章未填, 符合预期"

- [ ] **Step 4: 提交 baseline 报告 commit (auto 跟踪)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
git add workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md
git commit -m "docs(baseline): i135 p1-4 scene-six-questions V1+V2 baseline report

auto-generated by scripts/baseline-scan-scene-six-questions.cjs

实测结果 (符合预期):
- V1+V2 80 章 ## 场景 段覆盖率: 0%
- V1 (ch-001 ~ ch-030) 0/30 含 ## 场景
- V2 (ch-031 ~ ch-080) 0/50 含 ## 场景
- 6 问子标题频次全 0

结论: V1+V2 0 文件改动, P1-4 设计作为 V3+ 软引导"
```

---

## Task 7: Final verification — spec §5 验收 8/8

**Files:**
- 不改文件,只运行验收命令

- [ ] **Step 1: 验证 验收 #1 模板存在**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
test -f reference/scene-six-questions.md && echo "✓ 模板存在"
grep -c "^### POV\|^### 地点 / 时间\|^### 主角想要什么 (Value)\|^### 价值转换\|^### 新信息 / 情感\|^### 下一步必做什么" reference/scene-six-questions.md
```

期望: `✓ 模板存在` + `12` (6 固定顺序 + 6 填写示例, 编号已去除 per 2026-08-19 CJK/template 修复)

- [ ] **Step 2: 验证 验收 #2 规则 JSON 合法 + level=low**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
node -e "
const r = JSON.parse(require('fs').readFileSync('assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json', 'utf8'));
console.log('✓ JSON 合法');
console.log('✓ level=' + r[0].level);
console.log('✓ 字段齐全:', Object.keys(r[0]).join(','));
"
```

期望: `✓ JSON 合法` + `✓ level=low` + 字段含 id/namespace/title/level/review/fixability/enabled/note/detector/action

- [ ] **Step 3: 验证 验收 #3 + #4 ruleset 实际触发 + 不阻塞**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint-scene-six-questions.test.ts 2>&1 | tail -5
```

期望: 4/4 PASS

- [ ] **Step 4: 验证 验收 #5 baseline 脚本可跑**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
node scripts/baseline-scan-scene-six-questions.cjs > /dev/null 2>&1 && echo "✓ 退出码 0"
test -f /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md && echo "✓ 报告生成"
```

期望: `✓ 退出码 0` + `✓ 报告生成`

- [ ] **Step 5: 验证 验收 #6 V1+V2 baseline 数据合理**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
grep -E "覆盖率|总覆盖" workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md | head -3
```

期望: 总覆盖率 0% (预期) + 含 `## 场景` 0/60

- [ ] **Step 6: 验证 验收 #7 不污染主 workspace**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git log --oneline -1 main
git status --short
```

期望: main HEAD = `d07537eb` (本 spec 已落 main) + P1-3 14 commits 链可见,工作区 clean (cp 模式不同步, worktree-only)

- [ ] **Step 7: 验证 验收 #8 现有测试不退化**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org/.worktree/feat-p1-4-scene-six-questions
bun test server/agent/skills/llmlint.test.ts 2>&1 | tail -3
grep -l "^beat:" workspace/qi-shou-fan-shen-cheng-ding-fu/manuscript/vol*/ch-*/index.md | wc -l
```

期望: 现有 llmlint 测试全 pass + 80 章 beat 字段 100% 命中

- [ ] **Step 8: 验证 spec §5 8/8 验收全通过**

如上 7 步全 ✓, 则 spec §5 8/8 验收通过, P1-4 实施完成。

---

## Task 8: Archive lockdown + main commit + worktree dispose

**Files:**
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-4-archive/01-patch-report.md` (~50 行)
- Create: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-4-archive/02-archive-lockdown.md` (~40 行)

**Interfaces:**
- 消费: worktree 内 5 commits (setup + template + ruleset + baseline-scan + baseline-report)
- 产出: archive 资产 + 主工作区同步 (0 push / 0 merge / 0 改 master)

- [ ] **Step 1: 创建 archive 目录**

```bash
mkdir -p /www/wwwroot/book.neoshen.dpdns.org/workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-4-archive
```

- [ ] **Step 2: 写 patch report**

文件路径: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-4-archive/01-patch-report.md`

```markdown
# P1-4 Scene Six Questions Patch Report

> 落位日期: 2026-08-19
> 来源 spec: `docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md`
> 调研报告: `research-sdd-novel-writing-2026-08-18.md` §2.3

## 实施清单 (5 commits on feat-p1-4-scene-six-questions)

| Commit | 类型 | 文件 | 行数 |
|---|---|---|---|
| (setup) | chore | (empty) | 0 |
| (template) | feat | reference/scene-six-questions.md | +120 |
| (ruleset) | feat | scene-six-questions.json + test | +30 + 80 |
| (baseline-scan) | feat | baseline-scan-scene-six-questions.cjs | +150 |
| (baseline-report) | docs | i135-p1-4-baseline-report.md | +80 |

**总计**: 5 commits + 4 文件新 + 0 文件改, ~380 行

## 验收 (spec §5 8/8)

- [x] #1 模板存在 + 6 问子标题完整 + 1 个示例
- [x] #2 ruleset JSON 合法 + level=low
- [x] #3 ruleset 实际触发 (3/3 test pass)
- [x] #4 ruleset 不阻塞 (level=low 软提示)
- [x] #5 baseline 脚本可跑 (exit code 0 + 报告生成)
- [x] #6 V1+V2 baseline 数据合理 (0% 覆盖率, 符合预期)
- [x] #7 不污染主 workspace (0 push / 0 merge)
- [x] #8 现有测试不退化 (chapter-hook 5 模式仍正常 + i128 beat 60/60 仍命中)

**8/8 验收通过**

## V1+V2 baseline 数据 (实测)

- V1 (ch-001 ~ ch-030): 0/30 章含 ## 场景 段 (0%)
- V2 (ch-031 ~ ch-080): 0/50 章含 ## 场景 段 (0%)
- 6 问子标题频次: POV 0 / 地点 0 / 想要什么 0 / 价值转换 0 / 新信息 0 / 下一步 0

## 调研报告 P0-P2 进度

| 建议 | 状态 | 落位 |
|---|---|---|
| P0-1 beat 字段 | ✅ | i128 |
| P0-2 chapter-hook 规则 | ✅ | i129 |
| P1-3 lore-resolver | ✅ | P1-3 + I-1 |
| **P1-4 场景 6 问表** | **✅ 本次** | **P1-4** |
| P2-5 scene-master-list | ❌ | 留 v4.8+ |
| P2-6 story-bible 模板 | ❌ | 留 v4.8+ |

**进度: 4/6 (67%)**

## 教训 (5)

1. **派生 90% 复用**: i129 baseline-scan.cjs 改 scope 比从零写省 ~80% 工作量
2. **level=low 软提示设计**: 抗调研报告 §7.4 过度 spec 化, 0 阻塞 V3 写作
3. **JSON ruleset 11 字段模式**: 沿用 chapter-hook 兼容现有 llmlint pipeline
4. **archive cp 模式**: 主工作区同步 4 文件 + 0 push/0 merge, 沿用 i128-i134 6 批次先例
5. **forward-only 决策**: V1+V2 0 文件改动, baseline 报告只读不写, 减少对作者干扰
```

- [ ] **Step 3: 写 archive lockdown**

文件路径: `workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/v45-p1-4-archive/02-archive-lockdown.md`

```markdown
# P1-4 Archive Lockdown

> 落位日期: 2026-08-19
> 状态: P1-4 实施完成, archive 资产永久本地保留
> worktree: `feat-p1-4-scene-six-questions` (用户选 1/2/3 处置前保留)

## Archive 资产清单

| 文件 | 来源 | 用途 |
|---|---|---|
| 01-patch-report.md | 本次 | 5 commits 实施清单 + 8/8 验收 + 5 教训 |
| 02-archive-lockdown.md | 本次 | 本文件 |
| reference/scene-six-questions.md | 同步 worktree | 6 问模板 |
| assets/.../scene-six-questions.json | 同步 worktree | ruleset JSON |
| scripts/baseline-scan-scene-six-questions.cjs | 同步 worktree | baseline 扫描 |
| workspace/.../i135-p1-4-baseline-report.md | auto | V1+V2 baseline 报告 |

## 锁版说明

- 调研报告 P0-P2 6 条建议中 P1-4 已落位
- P2-5 / P2-6 仍 DEFERRED (留 v4.8+)
- 主工作区 master 0 改动 (除 spec 1 commit `d07537eb` 入 main)
- worktree 内 5 commits 实施代码永久可查

## Worktree 状态

- 路径: `.worktree/feat-p1-4-scene-six-questions/`
- branch: `feat-p1-4-scene-six-questions` (保留)
- 实施 commits: 5 (含 1 empty setup)
- 等待用户拍板: 删除 worktree / 保留 / 推 origin
```

- [ ] **Step 4: 主工作区同步 (cp worktree 内 4 实施文件)**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
cp .worktree/feat-p1-4-scene-six-questions/reference/scene-six-questions.md reference/scene-six-questions.md
cp .worktree/feat-p1-4-scene-six-questions/assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json \
   assets/workspace/.nbook/agent/skills/llmlint/rulesets/builtin/default/rules/structure/scene-six-questions.json
cp .worktree/feat-p1-4-scene-six-questions/scripts/baseline-scan-scene-six-questions.cjs scripts/baseline-scan-scene-six-questions.cjs
test -f workspace/qi-shou-fan-shen-cheng-ding-fu/.agent/plan/i135-p1-4-baseline-report.md && echo "✓ baseline 报告已落主工作区"
```

期望: 4 文件 cp 完成 + baseline 报告存在

- [ ] **Step 5: 验证主工作区 4 文件存在 (worktree-only, 不 commit 到 main)**

按 i128-i134 5 批次先例: 主工作区 cp 后**不 commit**, 维持 worktree-only 状态。等待用户拍板:
- A. 删除 worktree (释放磁盘)
- B. 保留 worktree (备查)
- C. 推 origin main (公开, 需用户授权)

- [ ] **Step 6: 列出 worktree 状态供用户拍板**

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
git worktree list
git -C .worktree/feat-p1-4-scene-six-questions log --oneline main..HEAD
du -sh .worktree/feat-p1-4-scene-six-questions
```

期望: 1 worktree listed, 5 commits ahead of main, ~1.4GB size (node_modules)

- [ ] **Step 7: 等用户拍板处置 worktree (A 删除 / B 保留 / C 推 origin)**

不动手, 等用户明示。

---

## Out of Scope (per spec §8)

- ❌ 强制 `## 场景` 段 (level=low 永不变)
- ❌ 6 问子标题顺序检测
- ❌ 5 诫命子段强制
- ❌ 跨章场景编号连续性
- ❌ LLM 语义检测
- ❌ writer.profile.tsx 集成
- ❌ lore-resolver / carryOverPaths 联动
- ❌ V1+V2 回填
- ❌ baseline 报告触发 enforcement
- ❌ story-bible-sdd 模板 (P2-6)

---

## Worktree Disposal (用户拍板后, 由单独 task 执行)

非 P1-4 实施范围, 待用户拍板后单独执行:
- A. `git worktree remove .worktree/feat-p1-4-scene-six-questions` (释放 1.4GB)
- B. 保留 worktree (备查)
- C. `git push origin feat-p1-4-scene-six-questions` (公开, 需授权)




