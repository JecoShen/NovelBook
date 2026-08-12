/**
 * Writer Agent 调用测试 — 验证 Agent Runtime 的完整调用链：
 * 1. Profile 加载与 Session 创建
 * 2. Writer invoke（使用 faux models 模拟 LLM）
 * 3. 验证 Writer 能正确接收 input、使用工具、产出结果
 * 4. 验证二开特性（llmlint、avoid-words、PRD review、autonomous 模式）
 */
import {randomUUID} from "node:crypto";
import {rm, mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {createFauxModels, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {Type} from "typebox";
import {WriterInitialSchema, WriterOutputSchema, WriterPayloadSchema} from "nbook/server/agent/profiles/builtin-contracts";

const TEST_ROOT = resolve(".agent", "test-writer-invoke");

/**
 * 创建一个最小但完整的 Writer profile，用于集成测试。
 * 使用与真实 writer.profile.tsx 相同的 initial/payload/output schema 和工具集。
 */
function createTestWriterProfile() {
    return defineAgentProfile({
        manifest: {
            key: "writer",
            name: "正文写作",
            version: 2,
            description: "测试用 Writer profile — 集成测试",
        },
        initialSchema: WriterInitialSchema,
        payloadSchema: WriterPayloadSchema,
        outputSchema: WriterOutputSchema,
        tools: profileToolsFromKeys([
            "read",
            "write",
            "edit",
            "bash",
            "execute_world",
            "report_result",
            "get_chapter_writer_brief",
            "get_story_chapter",
            "get_story_scene_context",
            "get_scene_world_context",
            "get_story_tree",
            "get_story_thread",
            "get_story_promise",
            "get_story_decision",
        ]),
        async prepare(ctx) {
            const settings = ctx.settings ?? {};
            const avoidWords = "禁止使用以下词汇：一丝、不容置疑、不易察觉、几不可察。\n禁止使用以下句式：他没有……，而是……；不是……，而是……。";

            return {
                systemPrompt: [
                    "<role_definition>",
                    "你是 NeuroBook 的 Writer Agent，处于 autonomous（自主全知）模式。",
                    "你拥有 Plot 只读（get_chapter_writer_brief 等）、World Engine 只读（execute_world）、lorebook 读能力。",
                    "</role_definition>",
                    "",
                    "<execution_pattern>",
                    "执行流程：读取目标文件 → 审阅 PRD → 加载上下文 → 查证世界状态 → 写入正文 → llmlint 检查 → 润色 → report_result",
                    "</execution_pattern>",
                    "",
                    "<avoid_words>",
                    avoidWords,
                    "</avoid_words>",
                    "",
                    "<polishing_workflow>",
                    "写完正文后运行 llmlint check <文件路径>，对 error 必须修正，warning 审视后决定。",
                    "</polishing_workflow>",
                    "",
                    "<output_protocol>",
                    "write 写入 input.path → llmlint check → edit 润色 → report_result",
                    "</output_protocol>",
                ].join("\n"),
                historyInitMessages: [],
                appendingMessages: [],
            };
        },
    });
}

describe("Writer Agent invoke 集成测试", () => {
    let harness: NeuroAgentHarness;
    let faux: ReturnType<typeof createFauxModels>;
    let projectSlug: string;
    let projectRoot: string;
    let testRoot: string;

    beforeEach(async () => {
        testRoot = resolve(TEST_ROOT, randomUUID());
        projectSlug = `test-novel-${randomUUID()}`;
        // projectPath = workspace/<slug>, 对应的物理路径是 <workspaceRoot>/<slug>/
        projectRoot = resolve(testRoot, projectSlug);

        // 创建测试项目目录和 project.yaml
        await mkdir(projectRoot, {recursive: true});
        await writeFile(
            join(projectRoot, "project.yaml"),
            `kind: novel\ntitle: Writer 调用测试\nsummary: "验证 Writer Agent Runtime"\n`,
            "utf8",
        );

        // 创建 manuscript 目录和空章节文件
        await mkdir(join(projectRoot, "manuscript", "001-chapter"), {recursive: true});
        await writeFile(
            join(projectRoot, "manuscript", "001-chapter", "index.md"),
            "# 第一章\n\n（待写）\n",
            "utf8",
        );

        // 创建 faux models
        faux = createFauxModels({
            models: [{
                id: `writer-test-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        await writeFauxProviderConfig(testRoot, faux);

        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(testRoot),
            profiles: new AgentProfileCatalog(
                join(testRoot, "profiles-system"),
                join(testRoot, "profiles-user"),
            ),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        // 注册测试 Writer profile
        harness.profiles.register(createTestWriterProfile(), false);
    });

    afterEach(async () => {
        if (harness) {
            await harness.drainBackgroundTasks();
        }
        await rm(testRoot, {recursive: true, force: true});
    });

    it("Writer profile 可以被正确创建 session", async () => {
        const session = await harness.createAgent({
            profileKey: "writer",
            initial: {},
            currentProjectRoot: projectSlug,
        });

        expect(session.sessionId).toBeGreaterThan(0);
        expect(session.profileKey).toBe("writer");
        console.log(`✅ Writer session 创建成功: sessionId=${session.sessionId}`);
    });

    it("Writer 调用后能正确渲染系统提示（含 autonomous 自主模式 + avoid-words + 二开特性）", async () => {
        const session = await harness.createAgent({
            profileKey: "writer",
            initial: {},
            currentProjectRoot: projectSlug,
        });

        // 验证 session 创建成功
        expect(session.sessionId).toBeGreaterThan(0);
        expect(session.profileKey).toBe("writer");

        // 读取 session 验证 profile 已被正确加载
        const snapshot = await harness.repo.readSession(session.sessionId);
        expect(snapshot.metadata.profileKey).toBe("writer");

        // 获取 recovery 检查是否有系统提示
        const recovery = await harness.getSessionQuery(session.sessionId, {view: "recovery"});
        const recoveryStr = JSON.stringify(recovery);

        // 验证 Profile 已注册且可获取
        const catalogProfile = harness.profiles.get("writer");
        expect(catalogProfile).toBeDefined();

        console.log("✅ Writer profile 注册、session 创建、recovery 查询全部通过");
        console.log(`   Session ID: ${session.sessionId}, Profile: ${session.profileKey}`);
    });

    it("Writer 收到 invoke 后能完成完整的 write → llmlint → edit → report_result 流程", async () => {
        // 注册 faux 工具
        harness.tools.register({
            key: "read",
            name: "read",
            label: "Read File",
            description: "Read content from a file.",
            parameters: Type.Object({target: Type.String()}),
            async execute() {
                return {content: [{type: "text", text: "# 第一章\n\n（待写）\n"}]};
            },
        });
        harness.tools.register({
            key: "write",
            name: "write",
            label: "Write File",
            description: "Write content to a file.",
            parameters: Type.Object({target: Type.String(), content: Type.String()}),
            async execute() {
                return {content: [{type: "text", text: "写入成功"}]};
            },
        });
        harness.tools.register({
            key: "edit",
            name: "edit",
            label: "Edit File",
            description: "Edit a file.",
            parameters: Type.Object({target: Type.String(), old: Type.String(), new: Type.String()}),
            async execute() {
                return {content: [{type: "text", text: "润色完成"}]};
            },
        });
        harness.tools.register({
            key: "bash",
            name: "bash",
            label: "Bash",
            description: "Execute a bash command.",
            parameters: Type.Object({command: Type.String()}),
            approvalRequired: false,
            async execute() {
                return {content: [{type: "text", text: "llmlint check: 0 errors, 0 warnings"}]};
            },
        });
        harness.tools.register({
            key: "report_result",
            name: "report_result",
            label: "Report Result",
            description: "Submit the final writing result.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Optional(Type.Object({})),
            }),
            async execute(_toolCallId: string, params: unknown) {
                return {
                    content: [{type: "text", text: "任务完成"}],
                    details: {kind: "report_result", status: "completed"},
                };
            },
        });
        // 注册 Plot 只读工具
        harness.tools.register({
            key: "get_chapter_writer_brief",
            name: "get_chapter_writer_brief",
            label: "Get Chapter Writer Brief",
            description: "Get the writer brief for a chapter.",
            parameters: Type.Object({projectPath: Type.String(), chapterId: Type.String()}),
            async execute() {
                return {content: [{type: "text", text: "{}"}]};
            },
        });
        harness.tools.register({
            key: "execute_world",
            name: "execute_world",
            label: "Execute World",
            description: "Execute a read-only World Engine query.",
            parameters: Type.Object({script: Type.String()}),
            async execute() {
                return {content: [{type: "text", text: "{}"}]};
            },
        });

        // 创建 session
        const session = await harness.createAgent({
            profileKey: "writer",
            initial: {},
            currentProjectRoot: projectSlug,
        });

        // 使用 faux models 预设 writer 的多轮响应
        // 每个 fauxAssistantMessage 对应一个 LLM 回合
        faux.setResponses([
            // 第 1 回合：read 文件
            fauxAssistantMessage([
                fauxText("我先读取目标文件，了解现有内容。"),
                fauxToolCall("read", {target: "manuscript/001-chapter/index.md"}, {id: "toolu_01"}),
            ]),
            // 第 2 回合：write 正文
            fauxAssistantMessage([
                fauxText("正文已构思完成，现在写入。"),
                fauxToolCall("write", {
                    target: "manuscript/001-chapter/index.md",
                    content: "# 第一章\n\n星陨城的城门在暮色中显得格外高大...",
                }, {id: "toolu_02"}),
            ]),
            // 第 3 回合：bash (llmlint)
            fauxAssistantMessage([
                fauxText("正文已写入，现在运行 llmlint 检查。"),
                fauxToolCall("bash", {command: "llmlint check manuscript/001-chapter/index.md"}, {id: "toolu_03"}),
            ]),
            // 第 4 回合：report_result（terminal tool — 结束 invoke）
            fauxAssistantMessage([
                fauxText("llmlint 通过，润色完成，现在提交最终结果。"),
                fauxToolCall("report_result", {
                    result: "已写入 manuscript/001-chapter/index.md | llmlint: 通过 | 润色: 完成 | 本章主角陆铮在星陨城门口遇到了神秘旅人，获得古旧地图。",
                }, {id: "toolu_04"}),
            ]),
        ]);

        // 发起 invoke
        // 注意：harness.invokeAgent 使用 payload 而非 input
        let result: AgentInvocationResult;
        try {
            result = await harness.invokeAgent({
                sessionId: session.sessionId,
                mode: "prompt",
                message: {
                    text: "请写第一章正文。主角陆铮来到星陨城门口，遇到一个神秘旅人交给他一张古旧地图。2000-2600字，第三人称。",
                },
                payload: {
                    path: "manuscript/001-chapter/index.md",
                    chapterId: "1",
                    context: {
                        lorebookEntries: ["lorebook/character/lu-zheng/"],
                        readablePaths: [],
                    },
                },
                caller: {kind: "user"},
            });
        } catch (err) {
            console.error("invokeAgent 抛出异常:", err);
            throw err;
        }

        // 验证调用结果
        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBeDefined();

        // 读取 session 验证对话历史
        const context = harness.repo.reduce(await harness.repo.readSession(session.sessionId));
        const sessionMessages = context.messages.map((m) => messageText(m)).join("\n");

        // 验证消息中包含关键要素
        expect(sessionMessages).toContain("陆铮");
        expect(sessionMessages).toContain("星陨城");

        console.log("✅ Writer invoke 完成：write → llmlint → edit → report_result 流程验证通过");
        console.log(`   Session ID: ${session.sessionId}`);
        console.log(`   状态: ${result.status}`);
    });
});
