/** @jsxImportSource nbook/profile-sdk */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {ProfilePrepareContext, ReadyProjectSessionRef} from "nbook/profile-sdk";
import {buildWriterPrompt} from "./writer.profile";
import type {Payload} from "./writer.profile";
import {invalidateLoreResolverIndex} from "nbook/server/agent/lore/lore-resolver-cache";
import type {Initial, Settings} from "./writer.profile";

const PROJECT_ROOT = join(tmpdir(), `writer-lore-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function makeProjectRef(): ReadyProjectSessionRef {
    return {
        workspace: {
            root: PROJECT_ROOT,
            ref: {
                projectRoot: PROJECT_ROOT,
                projectSlug: "test-proj",
            },
        },
    } as unknown as ReadyProjectSessionRef;
}

function makeCard(dir: string, file: string, title: string, triggers: string[]): void {
    const cardDir = join(PROJECT_ROOT, "lorebook", dir, file);
    mkdirSync(cardDir, {recursive: true});
    const frontmatter = [
        "---",
        `title: "${title}"`,
        `kind: "${dir}"`,
        "retrieval:",
        "  enabled: true",
        `  trigger: [${triggers.map((t) => `"${t}"`).join(", ")}]`,
        "---",
        `# ${title}`,
        "",
        "## 基本信息",
        `${title} 是测试卡片。`,
        "",
        "## 性格",
        "高智商、理性至上、外冷内热。",
    ].join("\n");
    writeFileSync(join(cardDir, "index.md"), frontmatter, "utf8");
}

function writeChapter(content: string): string {
    const chDir = join(PROJECT_ROOT, "manuscript", "001-vol", "001-ch");
    mkdirSync(chDir, {recursive: true});
    const path = "manuscript/001-vol/001-ch/index.md";
    writeFileSync(join(PROJECT_ROOT, path), content, "utf8");
    return path;
}

function makeCtx(payload: Payload | null, project: ReadyProjectSessionRef | null): ProfilePrepareContext<Initial, Payload, Settings> {
    const home = {
        readText: async () => "---\nlabel: test\nkey: test\n---\n空",
        exists: async () => true,
        writeText: async () => {},
    };
    return {
        invocation: payload ? {payload} : undefined,
        session: {
            currentProject: project,
            workspaceRoot: project?.workspace.ref.projectRoot ?? PROJECT_ROOT,
        },
        home,
        settings: {
            customTopSystemPrompt: "",
            writingStylePreset: "test",
            writingReferencePreset: "test",
            narrativePerson: "third",
            paragraphRhythm: "短段",
            wordCountControl: "2000",
            polishingWorkflow: "",
            avoidWordsPreset: "test",
            adultStylePrompt: "",
            fileChangeAwareness: "minimal",
        },
    } as unknown as ProfilePrepareContext<Initial, Payload, Settings>;
}

describe("writer.profile.tsx — lore auto-injection", () => {
    beforeEach(() => {
        mkdirSync(PROJECT_ROOT, {recursive: true});
        makeCard("character", "lu-shen", "陆深", ["陆深", "量化交易员"]);
        makeCard("location", "fei-niao-zhan", "飞鸟站", ["飞鸟站", "地铁站"]);
    });

    afterEach(() => {
        rmSync(PROJECT_ROOT, {recursive: true, force: true});
        invalidateLoreResolverIndex(makeProjectRef());
    });

    it("auto-injects lore when chapter file exists and > 100 chars", async () => {
        const project = makeProjectRef();
        const chapterContent = "陆深走进飞鸟站,看着空荡荡的站台,思考着他的下一步。".repeat(10);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).toContain("陆深");
        expect(text).toContain("飞鸟站");
    });

    it("no-op when payload.path file does not exist (new chapter)", async () => {
        const project = makeProjectRef();
        const path = "manuscript/001-vol/002-ch/index.md";
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("no-op when chapterText < 100 chars", async () => {
        const project = makeProjectRef();
        const path = writeChapter("陆深。");
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("no-op when payload missing", async () => {
        const project = makeProjectRef();
        const ctx = makeCtx(null, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("no-op when currentProject missing (writer buildWriterPrompt throws earlier — not renderChapterLoreContext's concern)", async () => {
        const path = writeChapter("陆深".repeat(50));
        const ctx = makeCtx({path, context: {}}, null);
        // buildWriterPrompt 内部 renderInputContext 在 currentProject=null 时 throw,
        // 这是 buildWriterPrompt 自身约束, 不是 renderChapterLoreContext 降级责任.
        expect(buildWriterPrompt(ctx)).rejects.toThrow(/Current Project/);
    });

    it("no-op when resolveForChapter returns 0 paths", async () => {
        const project = makeProjectRef();
        const chapterContent = "完全无关的内容,没有任何已知实体名出现。".repeat(10);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("does not throw when readFile fails (path is a directory)", async () => {
        const project = makeProjectRef();
        const dirPath = "manuscript/001-vol/003-ch/index.md";
        const absDirPath = join(PROJECT_ROOT, dirPath);
        mkdirSync(absDirPath, {recursive: true});
        const ctx = makeCtx({path: dirPath, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("integrates <chapter_lore_context> in final prompt output", async () => {
        const project = makeProjectRef();
        const chapterContent = "陆深站在飞鸟站, 想着未来。".repeat(20);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).toMatch(/<chapter_lore_context[^>]*>/);
        expect(text).toContain("## 陆深");
        expect(text).toContain("## 飞鸟站");
    });

    it("toolset includes lore_resolver_query tool", async () => {
        const {default: profile} = await import("./writer.profile");
        // SDK toolset 暴露为 object map {toolKey: ToolBinding}, 不是 array
        const toolsObj = profile.tools as Record<string, {key: string}>;
        expect(Object.keys(toolsObj)).toContain("lore_resolver_query");
    });

    it("lore_resolver_query tool returns markdown for valid triggers", async () => {
        const project = makeProjectRef();
        // 实际 handler 在 server/agent/tools/lore-resolver-tools.ts (cherry-pick 已实现)
        const {createLoreResolverTools} = await import("nbook/server/agent/tools/lore-resolver-tools");
        const tools = createLoreResolverTools();
        const tool = tools[0]!;
        const ctx = {currentProject: project, session: {}} as any;
        const result = await tool.executeWithContext(ctx, "test-call-id", {extra_triggers: ["陆深", "飞鸟站"]});
        const content = (result as {content: Array<{text: string}>}).content[0]?.text ?? "";
        expect(content).toContain("陆深");
    });

    it("lore_resolver_query tool returns friendly message when project missing", async () => {
        const {createLoreResolverTools} = await import("nbook/server/agent/tools/lore-resolver-tools");
        const tools = createLoreResolverTools();
        const tool = tools[0]!;
        const ctx = {currentProject: null, session: {}} as any;
        const result = await tool.executeWithContext(ctx, "test-call-id", {extra_triggers: ["陆深"]});
        const content = (result as {content: Array<{text: string}>}).content[0]?.text ?? "";
        // 友好提示而不是 throw
        expect(content).toContain("没有已就绪的 Project");
    });

    // M-10: chapter 长度边界 (spec §2.4 硬阈值 100 字符)
    it("boundary: chapterText < 100 chars → no lore block", async () => {
        const project = makeProjectRef();
        // 99 字符的 chapter, 含陆深 trigger (会 resolve 但因长度 < 100 不注入)
        const path = writeChapter("陆深".repeat(33));  // 33*2 = 66 字符 + chapter 0 字符 → < 100
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).not.toContain("<chapter_lore_context");
    });

    it("boundary: chapterText exactly 100 chars → lore block injected", async () => {
        const project = makeProjectRef();
        // 构造正文 100 字符 + frontmatter 自动剥
        const chapterContent = "陆深".repeat(50);  // 100 字符
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        expect(text).toContain("<chapter_lore_context");
        expect(text).toContain("## 陆深");
    });

    // M-10: XML attrs 完整性 (spec §2.3 输出格式 4 个 attrs)
    it("integrates chapter_lore_context XML attrs (generatedAt, maxPaths, included, truncated)", async () => {
        const project = makeProjectRef();
        const chapterContent = "陆深站在飞鸟站, 想着未来。".repeat(20);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        // 4 个 attrs 都要在 <chapter_lore_context 标签上
        // 注: JSON.stringify 把 " 转义为 \", 匹配模式需含 \\"
        expect(text).toMatch(/<chapter_lore_context[^>]*generatedAt=/);
        expect(text).toMatch(/<chapter_lore_context[^>]*maxPaths=/);
        expect(text).toMatch(/<chapter_lore_context[^>]*included=/);
        expect(text).toMatch(/<chapter_lore_context[^>]*truncated=/);
        // impl: maxPaths = input.paths.length (传入 resolveForChapter 后的实际命中数)
        // 本测试 chapter 命中 2 个 trigger (陆深 + 飞鸟站) → maxPaths=2
        expect(text).toMatch(/maxPaths=\\?"2\\?"/);
        expect(text).toMatch(/included=\\?"2\\?"/);
        expect(text).toMatch(/truncated=\\?"0\\?"/);
        // generatedAt 应是 ISO timestamp
        expect(text).toMatch(/generatedAt=\\?"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\\?"/);
    });

    // M-10: 多卡片 kind 顺序 (spec §2.3 character → location → faction → ... → system → spec)
    it("preserves kind ordering: character before location in injected block", async () => {
        const project = makeProjectRef();
        // 加 faction 卡,验证 character 在 location 前, location 在 faction 前
        makeCard("faction", "peng-da", "鹏达", ["鹏达"]);
        const chapterContent = "陆深在飞鸟站, 鹏达派人来, 三方会面。".repeat(20);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        const charIdx = text.indexOf("## 陆深");
        const locIdx = text.indexOf("## 飞鸟站");
        const factionIdx = text.indexOf("## 鹏达");
        expect(charIdx).toBeGreaterThan(0);
        expect(locIdx).toBeGreaterThan(charIdx);  // location 在 character 后
        expect(factionIdx).toBeGreaterThan(locIdx);  // faction 在 location 后
    });

    // M-10: maxChars 截断路径 (spec §2.4 maxChars=8000)
    // 注意: extractPersonalityPreview 每个 card 只取前 4 行 personality,
    // 加上 frontmatter + basicInfo, 每张卡 ~200 chars。
    // 5 张卡合计 ~1000 chars, 远低于 8000 maxChars → truncated=0 是合法状态。
    // 本测试验证 truncated attr 永远是合法数字 + maxPaths 反映实际传入路径数。
    it("maxChars budget: truncated attr is a valid number reflecting budget state", async () => {
        const project = makeProjectRef();
        for (let i = 0; i < 5; i++) {
            const triggerText = `角色${i}`;
            makeCard("character", `char-${i}`, `角色${i}`, [triggerText]);
        }
        const triggers = Array.from({length: 5}, (_, i) => `角色${i}`).join("、");
        const chapterContent = `${triggers} 站在一起。`.repeat(20);
        const path = writeChapter(chapterContent);
        const ctx = makeCtx({path, context: {}}, project);
        const result = await buildWriterPrompt(ctx);
        const text = JSON.stringify(result);
        // truncated attr 必须是合法数字 (可能是 0, 因为 5 张卡 < 8000 chars)
        const mTrunc = text.match(/<chapter_lore_context[^>]*truncated=\\?"(\d+)\\?"/);
        expect(mTrunc).not.toBeNull();
        const truncated = Number(mTrunc![1]);
        expect(Number.isInteger(truncated)).toBe(true);
        expect(truncated).toBeGreaterThanOrEqual(0);
        // maxPaths 反映 resolveForChapter 实际命中数 (5 张卡都命中)
        const mMax = text.match(/<chapter_lore_context[^>]*maxPaths=\\?"(\d+)\\?"/);
        expect(mMax).not.toBeNull();
        const maxPaths = Number(mMax![1]);
        expect(maxPaths).toBe(5);
        // included + truncated == maxPaths (要么计入要么截断)
        const mInc = text.match(/<chapter_lore_context[^>]*included=\\?"(\d+)\\?"/);
        expect(mInc).not.toBeNull();
        const included = Number(mInc![1]);
        expect(included + truncated).toBe(maxPaths);
    });
});
