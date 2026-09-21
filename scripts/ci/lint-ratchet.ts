#!/usr/bin/env bun
// lint ratchet（P1-5）：全仓 eslint 计数对基线只降不升。
// 基线在 scripts/ci/lint-baseline.json；CI 跑默认模式比对，本地用 --update 在计数下降后回填基线。
// warning 一并棘轮（多为 vue/html-self-closing 等可 --fix 项）；若 warning 棘轮被证过噪，
// 放宽它是开发者的合同决策，不是在 CI 红时顺手豁免的理由。
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

import {ESLint} from "eslint";

const ROOT = resolve(import.meta.dirname, "..", "..");
const BASELINE_PATH = resolve(ROOT, "scripts", "ci", "lint-baseline.json");

export type LintTotals = {
    errors: number;
    warnings: number;
};

export type LintBaseline = LintTotals & {
    updatedAt: string;
};

export function evaluateRatchet(
    baseline: LintTotals,
    current: LintTotals,
): {ok: boolean; failures: string[]} {
    const failures: string[] = [];
    if (current.errors > baseline.errors) {
        failures.push(`error 计数上升：${baseline.errors} → ${current.errors}（+${current.errors - baseline.errors}）`);
    }
    if (current.warnings > baseline.warnings) {
        failures.push(`warning 计数上升：${baseline.warnings} → ${current.warnings}（+${current.warnings - baseline.warnings}）`);
    }
    return {ok: failures.length === 0, failures};
}

export function readBaseline(path: string = BASELINE_PATH): LintBaseline {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof raw.errors !== "number" || typeof raw.warnings !== "number" || raw.errors < 0 || raw.warnings < 0) {
        throw new Error(`lint 基线文件格式非法：${path}`);
    }
    return {errors: raw.errors, warnings: raw.warnings, updatedAt: String(raw.updatedAt ?? "")};
}

// profile 编译产物（**/.compiled/**）是生成器负责的构建输出，不计入棘轮口径：
// 它们不入库、随 profile compile 再生，且只在跑过编译的机器上存在——计入会让基线
// 依赖本机生成态（CI 全新 checkout 计数恒低于本机）。仓库级 ignore 更合适的归处是
// eslint.config.mjs（与 **/generated/** 同理），但该文件受 config-protection 钩子保护，
// 需开发者确认后挪移；在此之前口径过滤只定义在棘轮这一处，bun run lint 全量输出不受影响。
const GENERATED_ARTIFACT_MARKER = "/.compiled/";

async function measure(): Promise<LintTotals & {topOffenders: string[]}> {
    const eslint = new ESLint({cwd: ROOT});
    const results = await eslint.lintFiles(["."]);
    let errors = 0;
    let warnings = 0;
    const offenders: {path: string; errors: number; warnings: number}[] = [];
    for (const result of results) {
        if (result.filePath.includes(GENERATED_ARTIFACT_MARKER)) {
            continue;
        }
        errors += result.errorCount;
        warnings += result.warningCount;
        if (result.errorCount > 0 || result.warningCount > 0) {
            offenders.push({
                path: result.filePath.replace(`${ROOT}/`, ""),
                errors: result.errorCount,
                warnings: result.warningCount,
            });
        }
    }
    offenders.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
    const topOffenders = offenders
        .slice(0, 10)
        .map((entry) => `  ${entry.path}: ${entry.errors} error / ${entry.warnings} warning`);
    return {errors, warnings, topOffenders};
}

if (import.meta.main) {
    const update = process.argv.includes("--update");
    if (!existsSync(BASELINE_PATH) && !update) {
        console.error(`lint 基线缺失：${BASELINE_PATH}（先跑 bun run lint:ratchet:update 生成）`);
        process.exit(1);
    }
    const current = await measure();
    console.log(`lint 实测：${current.errors} error / ${current.warnings} warning`);
    if (update) {
        const previous = existsSync(BASELINE_PATH) ? readBaseline() : null;
        if (previous !== null) {
            const verdict = evaluateRatchet(previous, current);
            if (!verdict.ok) {
                console.error(`拒绝回填：新基线不得高于旧基线（${previous.updatedAt}）。`);
                for (const failure of verdict.failures) console.error(`  ${failure}`);
                process.exit(1);
            }
        }
        const now = new Date();
        const updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const next: LintBaseline = {errors: current.errors, warnings: current.warnings, updatedAt};
        writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        console.log(`基线已回填：${JSON.stringify({errors: next.errors, warnings: next.warnings})}（${next.updatedAt}）`);
        process.exit(0);
    }
    const baseline = readBaseline();
    console.log(`lint 基线（${baseline.updatedAt}）：${baseline.errors} error / ${baseline.warnings} warning`);
    const verdict = evaluateRatchet(baseline, current);
    if (!verdict.ok) {
        console.error("lint ratchet 失败——计数只许降不许升。问题最多文件：");
        for (const line of current.topOffenders) console.error(line);
        for (const failure of verdict.failures) console.error(`  ${failure}`);
        console.error("修复后跑 bun run lint:ratchet:update 回填下降的基线。");
        process.exit(1);
    }
    const dropped = baseline.errors - current.errors + (baseline.warnings - current.warnings);
    console.log(dropped > 0 ? `lint ratchet 通过；计数较基线下降 ${dropped}，可跑 bun run lint:ratchet:update 回填。` : "lint ratchet 通过；计数与基线持平。");
}
