import {access} from "node:fs/promises";
import {describe, expect, it, vi} from "vitest";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import {
    type AgentSmokeHarness,
    createSmokeHarnessOptions,
    resolveAgentSmokeWorkspaceRoot,
    runAgentSmoke,
} from "nbook/scripts/smoke/agent";

const completedResult = {
    sessionId: 7,
    invocationId: "smoke-invocation",
    status: "completed",
    acceptance: {status: "accepted"},
    finalMessage: "agent session smoke ok",
} as unknown as AgentInvocationResult;

describe("Agent smoke 生命周期", () => {
    it("成功后 dispose 一次并删除 workspace", async () => {
        const workspaceRoot = resolveAgentSmokeWorkspaceRoot("vitest-success");
        const harness = createHarness();

        const report = await runAgentSmoke({
            workspaceRoot,
            modelLabel: "faux/success",
            createHarness: () => harness.value,
        });

        expect(report.ok).toBe(true);
        expect(harness.dispose).toHaveBeenCalledTimes(1);
        await expect(access(workspaceRoot)).rejects.toThrow();
    });

    it("invoke 抛错后仍 dispose 一次并删除 workspace", async () => {
        const workspaceRoot = resolveAgentSmokeWorkspaceRoot("vitest-invoke-error");
        const harness = createHarness({invokeError: new Error("invoke failed")});

        await expect(runAgentSmoke({
            workspaceRoot,
            modelLabel: "faux/invoke-error",
            createHarness: () => harness.value,
        })).rejects.toThrow("invoke failed");

        expect(harness.dispose).toHaveBeenCalledTimes(1);
        await expect(access(workspaceRoot)).rejects.toThrow();
    });

    it("dispose 抛错时仍删除 workspace 且只调用一次", async () => {
        const workspaceRoot = resolveAgentSmokeWorkspaceRoot("vitest-dispose-error");
        const harness = createHarness({disposeError: new Error("dispose failed")});

        await expect(runAgentSmoke({
            workspaceRoot,
            modelLabel: "faux/dispose-error",
            createHarness: () => harness.value,
        })).rejects.toThrow("dispose failed");

        expect(harness.dispose).toHaveBeenCalledTimes(1);
        await expect(access(workspaceRoot)).rejects.toThrow();
    });

    // 钉住 2026-09-13 实测发现的两处断线之一：repo 模式必须显式提供
    // definitionArtifactPathContextProvider，否则真实调用 pre_loop 即失败而 mock 测试照绿。
    it("harness options 携带显式 artifact 编译上下文与固定模型解析器", () => {
        const model = {provider: "faux", id: "faux-model"};
        const options = createSmokeHarnessOptions({
            config: {} as never,
            model: model as never,
            workspaceRoot: "/tmp/agent-smoke-options",
            applicationRoot: "/tmp/agent-smoke-app",
        });

        expect(typeof options.definitionArtifactPathContextProvider).toBe("function");
        expect(options.modelResolver?.({} as never, "leader.default")).toBe(model);
        expect(options.repo).toBeDefined();
    });
});

function createHarness(options: {invokeError?: Error; disposeError?: Error} = {}) {
    const dispose = vi.fn(async () => {
        if (options.disposeError) throw options.disposeError;
    });
    const invokeAgent = vi.fn(async () => {
        if (options.invokeError) throw options.invokeError;
        return completedResult;
    });
    const snapshot = {entries: [{type: "leaf", id: "leaf-1"}]} as never;
    const value = {
        repo: {
            readSession: vi.fn(async () => snapshot),
            reduce: vi.fn(() => ({messages: []})),
        },
        createAgent: vi.fn(async () => ({sessionId: 7, profileKey: "leader.default"})),
        invokeAgent,
        runCommand: vi.fn(async () => ({})),
        drainBackgroundTasks: vi.fn(async () => undefined),
        dispose,
    } as unknown as AgentSmokeHarness;
    return {value, dispose};
}
