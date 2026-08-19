import fs from "node:fs/promises";
import path from "node:path";
import {buildLoreResolverIndex} from "./lore-resolver-cache";
import type {LoreEntryKind} from "./lore-resolver-cache";
import {parseFrontmatter} from "./lore-frontmatter";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export interface RenderInjectedMarkdownInput {
    readonly project: ReadyProjectSessionRef;
    readonly paths: readonly string[];
    readonly maxChars?: number;
}

export interface RenderInjectedMarkdownResult {
    readonly markdown: string;
    readonly includedPaths: readonly string[];
    readonly truncatedPaths: readonly string[];
    readonly totalChars: number;
}

const DEFAULT_MAX_CHARS = 8000;
const KIND_ORDER: readonly LoreEntryKind[] = [
    "character", "location", "faction", "event", "item", "world", "system", "spec",
];

/** 从 index.md 抽取 "## 基本信息" 段——遇到下一个 "## " 停止。 */
function extractSection(body: string, heading: string): string | null {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/**
 * 抽取 "## 性格" 段预览：特质描述行 + 前 3 条 bullet（共 4 个非空内容行，不含标题行）。
 * 注意：brief 原 `slice(0, 3)` 只含 特质行 + 2 条 bullet，测试要求 3 条 bullet → 修 4。
 */
function extractPersonalityPreview(body: string): string | null {
    const section = extractSection(body, "性格");
    if (!section) return null;
    const lines = section.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    return lines.slice(0, 4).join("\n");
}

/** 清洗 frontmatter：去掉 retrieval/governance/ext 嵌套对象,以及可选的 summary (M-3). */
function cleanFrontmatter(fm: Record<string, unknown>, dropSummary: boolean): string {
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
        if (k === "retrieval" || k === "governance" || k === "ext") continue;
        if (dropSummary && k === "summary") continue;  // M-3: 避免 summary 在 fmBlock 和 > summary 重复
        keep[k] = v;
    }
    return Object.entries(keep).map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
        return `${k}: ${String(v)}`;
    }).join("\n");
}

async function renderEntry(
    projectRoot: string,
    entryPath: string,
): Promise<string> {
    const [category, ...rest] = entryPath.split("/");
    const slug = rest.join("/");
    const filePath = path.join(projectRoot, "lorebook", category ?? "", slug, "index.md");
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch {
        return "";
    }
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) return "";
    // brief bug：传 fmMatch[1]（去掉了 --- 分隔符）会让 parseFrontmatter 匹配不到 → 传完整 raw（同 cache.ts）。
    const fm = parseFrontmatter(raw);
    const body = fmMatch[2] ?? "";
    const title = typeof fm.title === "string" ? fm.title : slug;
    const basicInfo = extractSection(body, "基本信息");
    const summary = typeof fm.summary === "string" ? fm.summary : null;
    const personality = extractPersonalityPreview(body);

    // M-3: 如果走 `> summary` 分支,frontmatter 里也 drop summary 避免重复
    const fmBlock = cleanFrontmatter(fm, !basicInfo && summary !== null);

    const parts: string[] = [`## ${title} (${category})`];
    if (fmBlock.length > 0) parts.push(fmBlock);
    if (basicInfo) {
        parts.push(basicInfo);
    } else if (summary) {
        parts.push(`> ${summary}`);
    }
    if (personality) parts.push(personality);
    return parts.join("\n\n");
}

/** kind 排序权重；不在 KIND_ORDER 的路径排最后。 */
function kindRank(entryPath: string): number {
    const [cat] = entryPath.split("/");
    const idx = KIND_ORDER.indexOf(cat as LoreEntryKind);
    return idx < 0 ? KIND_ORDER.length : idx;
}

export async function renderInjectedMarkdown(
    input: RenderInjectedMarkdownInput,
): Promise<RenderInjectedMarkdownResult> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const index = await buildLoreResolverIndex(input.project);

    // 按 kind 排序
    const sorted = [...input.paths].sort((a, b) => kindRank(a) - kindRank(b));

    const includedPaths: string[] = [];
    const truncatedPaths: string[] = [];
    const blocks: string[] = [];
    let total = 0;

    // M-2: 把 header+footer 开销从 budget 预扣,保证 final totalChars <= maxChars
    const headerOverhead = `<chapter_lore_context generatedAt="0000-00-00T00:00:00.000Z" maxPaths="${String(input.paths.length)}" included="${String(input.paths.length)}" truncated="0">\n`.length;
    const footerOverhead = "\n</chapter_lore_context>".length;
    const bodyBudget = Math.max(0, maxChars - headerOverhead - footerOverhead);

    for (const p of sorted) {
        if (!index.pathToEntry.has(p)) {
            truncatedPaths.push(p);
            continue;
        }
        const block = await renderEntry(input.project.workspace.root, p);
        if (block.length === 0) {
            truncatedPaths.push(p);
            continue;
        }
        // M-2: 用 bodyBudget (maxChars - header - footer) 而非 maxChars
        const candidate = total + block.length + 2; // 2 = "\n\n"
        if (candidate > bodyBudget) {
            truncatedPaths.push(p);
            continue;
        }
        blocks.push(block);
        includedPaths.push(p);
        total = candidate;
    }

    const body = blocks.join("\n\n");
    // brief bug：原 header 硬编码 included="0" truncated="0"，需在循环后按实际计数生成。
    const header = `<chapter_lore_context generatedAt="${new Date().toISOString()}" maxPaths="${String(input.paths.length)}" included="${String(includedPaths.length)}" truncated="${String(truncatedPaths.length)}">\n`;
    const footer = "\n</chapter_lore_context>";
    const markdown = `${header}${body}${footer}`;
    return {
        markdown,
        includedPaths,
        truncatedPaths,
        totalChars: markdown.length,
    };
}
