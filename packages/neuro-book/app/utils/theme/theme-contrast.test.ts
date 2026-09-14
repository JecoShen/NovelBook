import {describe, expect, it} from "vitest";
import {ideThemeIds, themeTokens, type ThemeVarKey, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";

/**
 * 内置主题对比度注册检查(2026-09-14 前端 critique P0 落地)。
 *
 * 每个内置主题必须通过同一组「前景 × 背景 × 最低比值」合同,阈值取自 WCAG 2.2:
 * 正文/占位/图标文字 4.5:1(1.4.3),激活指示与焦点环等非文本 3:1(1.4.11),
 * 源码辅助(行号)按辅助信息 3:1。新增或调整内置主题时本测试即注册门禁;
 * 自定义主题不走此门禁(用户资产,宽容导入),仅内置八盏灯受合同约束。
 */

type Rgb = [number, number, number];

interface Rgba extends Array<number> {
    0: number;
    1: number;
    2: number;
    3: number;
}

function parseHex(value: string): Rgba | null {
    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match?.[1]) {
        return null;
    }
    let hex = match[1];
    if (hex.length === 3) {
        hex = hex.split("").map((c) => c + c).join("");
    }
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
}

function parseRgba(value: string): Rgba | null {
    const match = value.trim().match(/^rgba?\(([^)]+)\)$/i);
    if (!match?.[1]) {
        return null;
    }
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) {
        return null;
    }
    return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 1];
}

/** color-mix(in srgb, …) 在 gamma 空间按通道线性插值。 */
function srgbMix(a: Rgba, b: Rgba, weightA: number): Rgb {
    return [0, 1, 2].map((i) => a[i]! * weightA + b[i]! * (1 - weightA)) as Rgb;
}

function parseColor(value: string): Rgba | null {
    const trimmed = value.trim();
    const direct = parseHex(trimmed) ?? parseRgba(trimmed);
    if (direct) {
        return direct;
    }
    const mix = trimmed.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+?)\)$/i);
    if (mix?.[1] && mix[2] && mix[3]) {
        const a = parseColor(mix[1]);
        const b = parseColor(mix[3]);
        if (a && b) {
            const weight = Number.parseFloat(mix[2]) / 100;
            return [...srgbMix(a, b, weight), a[3] * weight + b[3] * (1 - weight)] as Rgba;
        }
    }
    return null;
}

/** alpha 合成到不透明底。 */
function composite(fg: Rgba, bg: Rgb): Rgb {
    return [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])) as Rgb;
}

function relativeLuminance(rgb: Rgb): number {
    const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 解析 token 值为不透明 RGB;半透明值合成到 base 底上。 */
function resolveToken(vars: ThemeVars, key: ThemeVarKey, base: Rgb): Rgb {
    const parsed = parseColor(vars[key]);
    if (!parsed) {
        throw new Error(`无法解析颜色值 ${key}: ${vars[key]}`);
    }
    return parsed[3] >= 1 ? [parsed[0], parsed[1], parsed[2]] : composite(parsed, base);
}

const CHROME_SURFACES: ThemeVarKey[] = ["--bg-main", "--bg-panel", "--bg-sidebar", "--bg-input", "--bg-hover", "--bg-subtle", "--editor-bg"];
const STATUS_ROLES = ["info", "success", "warning", "danger"] as const;

interface ContrastPair {
    foreground: ThemeVarKey;
    background: ThemeVarKey | `@chip:${(typeof STATUS_ROLES)[number]}`;
    minimum: number;
    label: string;
}

function buildContract(): ContrastPair[] {
    const pairs: ContrastPair[] = [];
    for (const surface of CHROME_SURFACES) {
        pairs.push({foreground: "--text-main", background: surface, minimum: 4.5, label: "正文"});
        pairs.push({foreground: "--text-secondary", background: surface, minimum: 4.5, label: "次级文本"});
        pairs.push({foreground: "--text-muted", background: surface, minimum: 4.5, label: "弱化文本/占位/静息图标"});
    }
    pairs.push({foreground: "--text-main", background: "--chat-ai-bg", minimum: 4.5, label: "AI 气泡正文"});
    pairs.push({foreground: "--text-inverse", background: "--accent-main", minimum: 4.5, label: "主按钮文字"});
    pairs.push({foreground: "--text-inverse", background: "--status-danger", minimum: 4.5, label: "危险确认按钮文字"});
    for (const surface of ["--bg-main", "--bg-panel", "--editor-bg"] as const) {
        pairs.push({foreground: "--accent-text", background: surface, minimum: 4.5, label: "链接/强调"});
    }
    for (const surface of ["--bg-panel", "--bg-sidebar"] as const) {
        pairs.push({foreground: "--accent-main", background: surface, minimum: 3, label: "激活指示(WCAG 1.4.11)"});
    }
    for (const role of STATUS_ROLES) {
        pairs.push({foreground: `--status-${role}`, background: "--bg-panel", minimum: 4.5, label: `${role} 状态文本`});
        pairs.push({foreground: `--status-${role}`, background: `@chip:${role}`, minimum: 4.5, label: `${role} chip 文字/软底`});
    }
    pairs.push({foreground: "--source-text", background: "--source-bg", minimum: 4.5, label: "源码正文"});
    pairs.push({foreground: "--source-muted", background: "--source-bg", minimum: 3, label: "源码辅助(行号)"});
    pairs.push({foreground: "--border-accent", background: "--bg-panel", minimum: 3, label: "焦点环/选中描边(WCAG 1.4.11)"});
    return pairs;
}

const CONTRACT = buildContract();

describe("theme contrast registration gate", () => {
    it("keeps every built-in theme at or above the WCAG contract for the registered pairs", () => {
        const failures: string[] = [];
        for (const themeId of ideThemeIds) {
            const vars = themeTokens[themeId];
            const panel = resolveToken(vars, "--bg-panel", [255, 255, 255]);
            for (const pair of CONTRACT) {
                let background: Rgb;
                if (pair.background.startsWith("@chip:")) {
                    // chip 软底与状态主色同 RGB、只取 alpha;主色变深时软底跟随变深
                    const role = pair.background.slice(6) as (typeof STATUS_ROLES)[number];
                    const soft = parseRgba(vars[`--status-${role}-bg`]);
                    const main = parseHex(vars[`--status-${role}`]);
                    if (!soft || !main) {
                        throw new Error(`${themeId} 无法解析 ${role} chip 颜色`);
                    }
                    background = composite([main[0], main[1], main[2], soft[3]], panel);
                } else {
                    background = resolveToken(vars, pair.background as ThemeVarKey, panel);
                }
                const foreground = resolveToken(vars, pair.foreground, background);
                const ratio = contrastRatio(foreground, background);
                if (ratio < pair.minimum) {
                    failures.push(
                        `${themeId}: ${pair.foreground} on ${pair.background} = ${ratio.toFixed(2)} < ${pair.minimum}(${pair.label})`,
                    );
                }
            }
        }
        expect(failures, failures.length > 0 ? `对比度合同失败:\n${failures.join("\n")}` : undefined).toEqual([]);
    });
});
