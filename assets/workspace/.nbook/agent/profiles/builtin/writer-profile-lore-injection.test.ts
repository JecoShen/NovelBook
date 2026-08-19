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
        const tools = profile.tools;
        const toolNames = (tools as Array<{name?: string; definition?: {name?: string}}>).map(
            (t) => t.name ?? t.definition?.name ?? "",
        );
        expect(toolNames).toContain("lore_resolver_query");
    });

    it("lore_resolver_query tool returns markdown for valid triggers", async () => {
        const project = makeProjectRef();
        const {default: profile} = await import("./writer.profile");
        const tools = profile.tools as Array<{name?: string; definition?: {name?: string}; handler?: Function; definition2?: {handler?: Function}}>;
        const tool = tools.find((t) => (t.name ?? t.definition?.name) === "lore_resolver_query");
        expect(tool).toBeDefined();
        const ctx = makeCtx(null, project);
        const handler = tool?.handler ?? (tool as any)?.definition?.handler;
        const result = await handler({extra_triggers: ["陆深", "飞鸟站"]}, ctx);
        const content = (result as {content?: string}).content ?? (result as string);
        expect(content).toContain("陆深");
    });

    it("lore_resolver_query tool returns empty when project missing", async () => {
        const {default: profile} = await import("./writer.profile");
        const tools = profile.tools as Array<{name?: string; definition?: {name?: string}; handler?: Function}>;
        const tool = tools.find((t) => (t.name ?? t.definition?.name) === "lore_resolver_query");
        const handler = tool?.handler ?? (tool as any)?.definition?.handler;
        const ctx = makeCtx(null, null);
        const result = await handler({extra_triggers: ["陆深"]}, ctx);
        const content = (result as {content?: string}).content ?? (result as string);
        expect(content).toBe("");
    });
});
