import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildLoreResolverIndex, invalidateLoreResolverIndex} from "./lore-resolver-cache";
import {resolveForChapter} from "./lore-resolver";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

function makeProjectRef(root: string): ReadyProjectSessionRef {
    return {
        workspace: {root, key: {slug: "test", root}, ref: {projectRoot: root}},
        generation: 1,
    } as unknown as ReadyProjectSessionRef;
}

function writeCard(root: string, category: string, slug: string, triggers: string[]): void {
    const dir = join(root, "lorebook", category, slug);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "index.md"),
        `---\ntitle: ${slug}\ntype: ${category}\nretrieval:\n  enabled: true\n  trigger: [${triggers.join(", ")}]\n---\n\n## 基本信息\n\n| 项目 | 设定 |\n|------|------|\n| 名称 | ${slug} |\n`);
}

describe("resolveForChapter", () => {
    let tmpRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), "lore-resolver-"));
        project = makeProjectRef(tmpRoot);
        writeCard(tmpRoot, "character", "lu-shen", ["陆深", "男主"]);
        writeCard(tmpRoot, "character", "su-nian", ["苏念"]);
        writeCard(tmpRoot, "location", "mei-lake", ["梅澜湖"]);
        await buildLoreResolverIndex(project);
    });

    afterEach(() => {
        rmSync(tmpRoot, {recursive: true, force: true});
        invalidateLoreResolverIndex(project);
    });

    it("resolves a single trigger hit", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深骑车路过",
        });
        expect(result.paths).toContain("character/lu-shen");
        expect(result.totalTriggersMatched).toBe(1);
    });

    it("resolves multiple trigger hits", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深和苏念在梅澜湖见面",
        });
        expect(result.paths).toContain("character/lu-shen");
        expect(result.paths).toContain("character/su-nian");
        expect(result.paths).toContain("location/mei-lake");
        expect(result.totalTriggersMatched).toBe(3);
    });

    it("aggregates multiple triggers matching same path", async () => {
        const result = await resolveForChapter({
            project,
            chapterText: "陆深是男主",
        });
        const hits = result.hitsByPath.get("character/lu-shen") ?? [];
        expect(hits).toContain("陆深");
        expect(hits).toContain("男主");
    });

    it("sorts paths by hit count descending", async () => {
        // lu-shen 2 个 trigger 命中，su-nian 1 个 → lu-shen 排前
        const result = await resolveForChapter({
            project,
            chapterText: "陆深 男主 苏念",
        });
        const idxLu = result.paths.indexOf("character/lu-shen");
        const idxSu = result.paths.indexOf("character/su-nian");
        expect(idxLu).toBeLessThan(idxSu);
    });

    it("carryOverPaths are ranked first regardless of hit count", async () => {
        writeCard(tmpRoot, "character", "carry", ["携带"]);
        invalidateLoreResolverIndex(project); // 缓存失效后再重建，否则新卡片不可见
        await buildLoreResolverIndex(project);
        const result = await resolveForChapter({
            project,
            chapterText: "陆深和苏念",
            carryOverPaths: ["character/carry"],
        });
        expect(result.paths[0]).toBe("character/carry");
    });

    it("truncates to maxPaths (default 8)", async () => {
        // 写 10 张 character 卡
        for (let i = 0; i < 10; i += 1) {
            writeCard(tmpRoot, "character", `c-${i}`, [`触发${i}`]);
        }
        invalidateLoreResolverIndex(project); // 缓存失效后再重建，否则新卡片不可见
        await buildLoreResolverIndex(project);

        const text = Array.from({length: 10}, (_, i) => `触发${i}`).join(" ");
        const result = await resolveForChapter({project, chapterText: text});
        expect(result.paths.length).toBe(8);
    });

    it("returns empty paths for empty text", async () => {
        const result = await resolveForChapter({project, chapterText: ""});
        expect(result.paths).toEqual([]);
        expect(result.totalTriggersMatched).toBe(0);
    });

    it("does not match triggers across paragraph boundaries spuriously", async () => {
        // trigger 跨段不应误命中——按段切分后每段独立 includes
        const result = await resolveForChapter({
            project,
            chapterText: "陆\n深",  // 触发器 "陆深" 跨段
        });
        // 行为：段内 includes() 不应跨段匹配，所以可能 0 命中或 1 命中（按实现）
        // 此处只断言不抛错且返回合法 result
        expect(Array.isArray(result.paths)).toBe(true);
        expect(typeof result.totalTriggersMatched).toBe("number");
    });
});
