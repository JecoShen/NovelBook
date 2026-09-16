import {readdirSync, readFileSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import zhCN from "nbook/app/i18n/locales/zh-CN";

/**
 * 作者语言守卫:中文界面不把工程黑话直接摊给作者。
 * Provider→服务商、Session→对话、Workflow→流程、Embedding→向量检索;
 * 英文名只允许以 gloss 形式出现在显式豁免的 key 里。
 */
const JARGON_PATTERN = /\b(Providers?|Sessions?|Workflows?|Embeddings?)\b/;

/** 豁免必须是刻意的 gloss(括号注英文),不是偷懒残留;新增豁免要在评审里说明理由。 */
const GLOSS_ALLOWLIST = new Set([
    "settings.section.embedding.description",
]);

function collectLeaves(value: unknown, path: string, out: Array<{path: string; text: string}>): void {
    if (typeof value === "string") {
        out.push({path, text: value});
        return;
    }
    if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            collectLeaves(child, path ? `${path}.${key}` : key, out);
        }
    }
}

describe("作者语言守卫", () => {
    it("zh-CN 用户面文案不残留 Provider/Session/Workflow/Embedding 黑话", () => {
        const leaves: Array<{path: string; text: string}> = [];
        collectLeaves(zhCN, "", leaves);
        const offenders = leaves.filter((leaf) => !GLOSS_ALLOWLIST.has(leaf.path) && JARGON_PATTERN.test(leaf.text));
        expect(offenders.map((leaf) => `${leaf.path}: ${leaf.text}`)).toEqual([]);
    });

    it("内置项目模板的目录摘要面向作者是中文(@ 引用菜单直接展示)", () => {
        const templateRoot = resolve("assets", "workspace", ".nbook", "templates", "project-directory-templates");
        const pending = [templateRoot];
        const offenders: string[] = [];
        while (pending.length > 0) {
            const dir = pending.pop()!;
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    pending.push(full);
                    continue;
                }
                if (entry !== "index.md") {
                    continue;
                }
                const summaryLine = readFileSync(full, "utf-8").split("\n").find((line) => line.startsWith("summary:"));
                const summary = summaryLine?.replace(/^summary:\s*"?|"?\s*$/g, "").trim() ?? "";
                if (summary && !/[一-鿿]/.test(summary)) {
                    offenders.push(`${full}: ${summary}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
