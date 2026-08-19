#!/usr/bin/env node
/**
 * baseline-scan-scene-six-questions.cjs
 * 派生: scripts/baseline-scan.cjs (i129 chapter-hook) 90% 复用
 * 不同: scope 从 ending 200 chars 改为 ## 场景 段
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.join(__dirname, '..', 'workspace', 'qi-shou-fan-shen-cheng-ding-fu');
const MANUSCRIPT_ROOT = path.join(WORKSPACE_ROOT, 'manuscript');
const REPORT_PATH = path.join(WORKSPACE_ROOT, '.agent', 'plan', 'i135-p1-4-baseline-report.md');

// CJK 边界说明: JS regex `\b` 只识别 [A-Za-z0-9_], 对 CJK 子标题无效
// (如 '## 场景\b' / '### 地点\b' 永远不命中). CJK 标题用 (?=\s|$) lookahead 替代.
// POV 是 ASCII, `\b` 可用.
// 下一步必做: 模板规范标题为 '下一步必做什么', 用 (什么)? 兼容 '下一步必做' 两种写法.
const SCENE_SECTION_REGEX = /^## 场景(?=\s|$)/gm;

const SCENE_QUESTION_PATTERNS = [
    { id: 'pov', label: 'POV', regex: /^### POV\b/gm },
    { id: 'location-time', label: '地点/时间', regex: /^### 地点(?=\s|$)/gm },
    { id: 'wants', label: '主角想要什么', regex: /^### 主角想要什么(?=\s|$)/gm },
    { id: 'value-shift', label: '价值转换', regex: /^### 价值转换(?=\s|$)/gm },
    { id: 'new-info', label: '新信息/情感', regex: /^### 新信息(?=\s|$)/gm },
    { id: 'next-step', label: '下一步必做', regex: /^### 下一步必做(什么)?(?=\s|$)/gm },
];

function main() {
    if (!fs.existsSync(MANUSCRIPT_ROOT)) {
        console.warn(`[P1-4 baseline] manuscript 目录不存在: ${MANUSCRIPT_ROOT}`);
        writeReport(formatReport({ total: { with_scene: 0, without_scene: 0, total: 0, coverage_pct: 0, error: 'no manuscript dir' }, per_volume: {}, question_frequency: {} }));
        process.exit(0);
    }

    const volDirs = fs.readdirSync(MANUSCRIPT_ROOT, { withFileTypes: true })
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
        const chapterDirs = fs.readdirSync(volPath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort();

        let volWith = 0;
        let volWithout = 0;

        for (const chapterDir of chapterDirs) {
            const filePath = path.join(volPath, chapterDir, 'index.md');
            if (!fs.existsSync(filePath)) continue;

            const content = fs.readFileSync(filePath, 'utf8');
            SCENE_SECTION_REGEX.lastIndex = 0;
            const hasScene = SCENE_SECTION_REGEX.test(content);

            if (hasScene) { volWith++; totalWithScene++; } else { volWithout++; totalWithoutScene++; }

            for (const q of SCENE_QUESTION_PATTERNS) {
                q.regex.lastIndex = 0;
                const matches = content.match(q.regex);
                if (matches) questionFrequency[q.id] += matches.length;
            }
        }

        const volTotal = volWith + volWithout;
        perVolume[volDir] = {
            with: volWith,
            without: volWithout,
            total: volTotal,
            coverage_pct: volTotal > 0 ? Math.round((volWith / volTotal) * 100) : 0,
        };
    }

    const total = totalWithScene + totalWithoutScene;
    const report = {
        total: {
            with_scene: totalWithScene,
            without_scene: totalWithoutScene,
            total,
            coverage_pct: total > 0 ? Math.round((totalWithScene / total) * 100) : 0,
        },
        per_volume: perVolume,
        question_frequency: questionFrequency,
    };

    writeReport(formatReport(report));
    console.warn(`[P1-4 baseline] 扫描完成: ${totalWithScene}/${total} 章含 ## 场景 段 (${report.total.coverage_pct}%)`);
}

function formatReport(report) {
    const lines = [];
    lines.push('# i135 P1-4 Scene Six Questions — V1+V2 Baseline Report');
    lines.push('');
    lines.push('> 调研报告: `research-sdd-novel-writing-2026-08-18.md` §2.3');
    lines.push('> 落位 spec: `docs/superpowers/specs/2026-08-19-p1-4-scene-six-questions.md`');
    lines.push(`> 扫描日期: ${new Date().toISOString().slice(0, 10)}`);
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
    } else {
        lines.push(`- V1+V2 总覆盖率 ${report.total.coverage_pct}%, 详见每卷分布`);
    }
    lines.push('');
    lines.push('## 下一步');
    lines.push('');
    lines.push('- V3 写作时按 `reference/scene-six-questions.md` 模板手填 `## 场景` 段');
    lines.push('- llmlint ruleset `cn.structure.scene-six-questions` (level: low) 给软提示');
    lines.push('- V3 完结后跑一次 V3 baseline 对比 V1+V2 当前数据');
    lines.push('');
    return lines.join('\n');
}

function writeReport(content) {
    const dir = path.dirname(REPORT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REPORT_PATH, content, 'utf8');
    console.warn(`[P1-4 baseline] 报告已写入: ${REPORT_PATH}`);
}

main();
