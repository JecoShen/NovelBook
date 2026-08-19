import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
    buildLoreResolverIndex,
    invalidateLoreResolverIndex,
    type LoreResolverIndex,
} from "./lore-resolver-cache";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** 构造一个指向临时目录的 mock ReadyProjectSessionRef。 */
function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {
        workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}},
        generation: 1,
    } as unknown as ReadyProjectSessionRef;
}

/** 写入最小 frontmatter + 段落到 index.md。 */
function writeLoreCard(
    rootDir: string,
    category: string,
    slug: string,
    opts: {title?: string; triggers?: string[]; enabled?: boolean; content?: string} = {},
): void {
    const dir = join(rootDir, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    const frontmatter = [
        "---",
        `title: ${opts.title ?? slug}`,
        `type: ${category}`,
        ...(opts.triggers ? [`retrieval:`, `  enabled: ${opts.enabled ?? true}`, `  trigger: [${opts.triggers.join(", ")}]`] : []),
        "---",
    ].join("\n");
    writeFileSync(join(dir, "index.md"), `${frontmatter}\n\n${opts.content ?? `## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${slug} |\n`}\n`);
}

describe("lore-resolver-cache", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-cache-"));
        project = makeProjectRef(tmpRoot);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("scans character directory and builds trigger index", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {title: "陆深", triggers: ["陆深", "男主"]});
        writeLoreCard(tmpRoot, "character", "su-nian", {triggers: ["苏念"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.triggerToPaths.get("陆深")?.has("character/lu-shen")).toBe(true);
        expect(index.triggerToPaths.get("男主")?.has("character/lu-shen")).toBe(true);
        expect(index.triggerToPaths.get("苏念")?.has("character/su-nian")).toBe(true);
        expect(index.pathToEntry.get("character/lu-shen")?.title).toBe("陆深");
    });

    it("skips entries with enabled: false", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"], enabled: true});
        writeLoreCard(tmpRoot, "character", "ghost", {triggers: ["幽灵"], enabled: false});

        const index = await buildLoreResolverIndex(project);

        expect(index.pathToEntry.has("character/lu-shen")).toBe(true);
        expect(index.pathToEntry.has("character/ghost")).toBe(false);
        expect(index.triggerToPaths.has("幽灵")).toBe(false);
    });

    it("ignores note/, story-spec/, instruction/ directories", async () => {
        writeLoreCard(tmpRoot, "note", "wip", {triggers: ["作者笔记"]});
        writeLoreCard(tmpRoot, "story-spec", "draft", {triggers: ["设定草稿"]});
        writeLoreCard(tmpRoot, "instruction", "system", {triggers: ["系统指令"]});
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.pathToEntry.has("note/wip")).toBe(false);
        expect(index.pathToEntry.has("story-spec/draft")).toBe(false);
        expect(index.pathToEntry.has("instruction/system")).toBe(false);
        expect(index.pathToEntry.has("character/lu-shen")).toBe(true);
    });

    it("filters triggers shorter than 2 characters", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深", "我", "A", "陆"]});

        const index = await buildLoreResolverIndex(project);

        expect(index.triggerToPaths.has("陆深")).toBe(true);
        expect(index.triggerToPaths.has("我")).toBe(false);   // 1 字符
        expect(index.triggerToPaths.has("A")).toBe(false);   // 1 字符
        expect(index.triggerToPaths.has("陆")).toBe(false);  // 1 字符
    });

    it("caches result by project key and invalidates correctly", async () => {
        writeLoreCard(tmpRoot, "character", "lu-shen", {triggers: ["陆深"]});

        const first = await buildLoreResolverIndex(project);
        const second = await buildLoreResolverIndex(project);

        expect(first).toBe(second);  // 同一对象引用

        invalidateLoreResolverIndex(project);
        const third = await buildLoreResolverIndex(project);

        expect(third).not.toBe(first);  // invalidate 后新对象
    });
});
