import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";

const PROFILE_KEY = "leader.default";

export type AgentSmokeHarness = Pick<
    NeuroAgentHarness,
    "repo" | "createAgent" | "invokeAgent" | "runCommand" | "drainBackgroundTasks" | "dispose"
>;

export type AgentSmokeOptions = {
    workspaceRoot: string;
    modelLabel: string;
    createHarness: (workspaceRoot: string) => AgentSmokeHarness | Promise<AgentSmokeHarness>;
    compact?: boolean;
};

export type AgentSmokeReport = {
    ok: boolean;
    modelLabel: string;
    status: AgentInvocationResult["status"];
    compactionStatus: "completed" | "error" | "not-requested";
    sessionEntries: number;
    sessionPath: string;
    durationMs: number;
    output: string;
};

export function resolveAgentSmokeWorkspaceRoot(stamp = new Date().toISOString().replace(/[:.]/g, "-")): string {
    return path.resolve(resolveAgentTempRoot(), "agent-smoke", stamp);
}

/**
 * 执行一次 Agent smoke；Provider、模型和 Harness 构造由调用方注入，流程自身负责清理。
 * 只要 Harness 构造成功，任何 invoke、后台任务或 dispose 失败都不会跳过一次 dispose。
 */
export async function runAgentSmoke(options: AgentSmokeOptions): Promise<AgentSmokeReport> {
    const startedAt = Date.now();
    let harness: AgentSmokeHarness | undefined;
    try {
        await fs.mkdir(options.workspaceRoot, {recursive: true});
        harness = await options.createHarness(options.workspaceRoot);
        const agent = await harness.createAgent({
            profileKey: PROFILE_KEY,
            initial: {role: "smoke"},
        });
        const result = await harness.invokeAgent({
            sessionId: agent.sessionId,
            mode: "prompt",
            message: {text: "用一句中文回复：agent session smoke ok。"},
        });
        const snapshot = await harness.repo.readSession(agent.sessionId);
        const context = harness.repo.reduce(snapshot);
        const compactionStatus = options.compact
            ? await runCompactionSmoke(harness, agent.sessionId)
            : "not-requested";
        const finalSnapshot = await harness.repo.readSession(agent.sessionId);
        const sessionPath = path.join(
            options.workspaceRoot,
            ".nbook",
            "agent",
            "sessions",
            `${String(agent.sessionId)}.jsonl`,
        );
        const finalText = result.finalMessage ?? result.reportResult?.result ?? "";
        const output = [
            "# Agent Smoke",
            "",
            `Profile: ${PROFILE_KEY}`,
            `Model: ${options.modelLabel}`,
            `Workspace: ${options.workspaceRoot}`,
            `Session: ${String(agent.sessionId)}`,
            `Session JSONL: ${sessionPath}`,
            `Status: ${result.status}`,
            `Duration: ${String(Date.now() - startedAt)}ms`,
            `Session entries: ${String(finalSnapshot.entries.length)}`,
            `Compaction: ${compactionStatus}`,
            result.usage ? `Usage: ${JSON.stringify(result.usage)}` : "Usage: (not reported)",
            "",
            "## Result",
            "",
            result.reportResult ? JSON.stringify(result.reportResult, null, 2) : result.finalMessage ?? "(empty)",
            "",
            "## Last Messages",
            "",
            ...context.messages.slice(-6).map((message, index) => `${String(index + 1)}. ${message.role}: ${truncate(messageText(message as never))}`),
            "",
        ].join("\n");
        await harness.drainBackgroundTasks();
        return {
            ok: result.status !== "error" && compactionStatus !== "error" && finalText.includes("smoke"),
            modelLabel: options.modelLabel,
            status: result.status,
            compactionStatus,
            sessionEntries: finalSnapshot.entries.length,
            sessionPath,
            durationMs: Date.now() - startedAt,
            output,
        };
    } finally {
        try {
            await harness?.dispose();
        } finally {
            await fs.rm(options.workspaceRoot, {recursive: true, force: true});
        }
    }
}

async function main(): Promise<void> {
    try {
        const config = loadGlobalEffectiveConfigSync();
        const model = resolvePiModelFromConfig(config, PROFILE_KEY);
        const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
        if (!apiKey) {
            throw new Error(`provider ${model.provider} 未配置 apiKey，请先在 workspace/.nbook/config.json 或设置页中填写真实 Provider 密钥`);
        }
        const report = await runAgentSmoke({
            workspaceRoot: resolveAgentSmokeWorkspaceRoot(),
            modelLabel: `${model.provider}/${model.id}`,
            compact: process.env.AGENT_SMOKE_COMPACT === "1",
            createHarness: (workspaceRoot) => new NeuroAgentHarness({
                repo: new JsonlSessionRepository(workspaceRoot),
                modelResolver: () => model,
                runtimeResolver: () => resolvePiModelsFromConfig(config, model),
            }),
        });
        console.log(report.output);
        if (!report.ok) process.exitCode = 1;
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    }
}

/** 执行一次真实手动 compaction，并等待 lifecycle 结束。 */
async function runCompactionSmoke(harness: AgentSmokeHarness, sessionId: number): Promise<"completed" | "error"> {
    await harness.runCommand(sessionId, {
        command: "compact",
        instructions: "保留本次 smoke 的用户目标、模型响应和验证结论。",
    });
    for (let attempt = 0; attempt < 300; attempt += 1) {
        const snapshot = await harness.repo.readSession(sessionId);
        const lifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle");
        const latest = lifecycles.at(-1);
        if (latest?.status === "end") return "completed";
        if (latest?.status === "error" || latest?.status === "aborted") return "error";
        const {promise, resolve} = Promise.withResolvers<void>();
        setTimeout(resolve, 200);
        await promise;
    }
    throw new Error("等待真实 compaction smoke 完成超时");
}

/** 限制 smoke 控制台输出，避免把完整注入 reference 打到终端。 */
function truncate(value: string): string {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

if (import.meta.main) await main();
