import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {createFauxModels, fauxProviderConfig, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE,
    resetInvocationConcurrencyGateForTests,
    useInvocationConcurrencyGate,
} from "nbook/server/agent/harness/invocation-concurrency-gate";
import type {AgentConcurrencyConfig} from "nbook/server/config/types";

/**
 * 全局并发闸 harness 集成测试（p-010 验收 2/3/5）：
 * 假 provider 下跨 session 并发真实进 invokeCore 运行段，闸的占用经 globalThis 单例观测。
 */

/** 探针工具：进入即持运行段证据，按调用逐个阻塞，测试逐个/全部放行；open() 后不再阻塞新进入者。 */
function createProbeTool() {
    let active = 0;
    let maxActive = 0;
    let opened = false;
    const waiters: Array<() => void> = [];
    const tool = {
        key: "cc_probe",
        name: "cc_probe",
        label: "Concurrency Probe",
        description: "Probe run-section occupancy for concurrency gate tests.",
        parameters: Type.Object({}),
        async execute() {
            active += 1;
            maxActive = Math.max(maxActive, active);
            if (!opened) {
                await new Promise<void>((resolve) => {
                    waiters.push(resolve);
                });
            }
            active -= 1;
            return {content: [{type: "text", text: "probe done"}], details: {}};
        },
    };
    return {
        tool,
        stats: () => ({active, maxActive}),
        releaseNext: () => {
            waiters.shift()?.();
        },
        releaseAll: () => {
            while (waiters.length > 0) {
                waiters.shift()!();
            }
        },
        /** 一次性开门：当前与后续进入者全部直接通过（观测完首轮占用后让整批跑完）。 */
        open: () => {
            opened = true;
            while (waiters.length > 0) {
                waiters.shift()!();
            }
        },
    };
}

/** 每请求消费一条响应：已含 toolResult 的会话给终答，否则给探针 toolCall——多 run 共享队列与顺序无关。 */
function probeResponses(count: number) {
    return Array.from({length: count}, () => (context: {messages: Array<{role?: string}>}) =>
        context.messages.some((message) => message.role === "toolResult")
            ? fauxAssistantMessage("done")
            : fauxAssistantMessage([fauxToolCall("cc_probe", {}, {id: `probe-${randomUUID()}`})], {stopReason: "toolUse"}));
}

async function writeConcurrencyConfig(
    root: string,
    faux: FauxModelsFixture,
    concurrency: Partial<AgentConcurrencyConfig>,
): Promise<void> {
    const config = fauxProviderConfig(faux);
    await mkdir(join(root, ".nbook"), {recursive: true});
    await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({models: config.models, agent: {concurrency}}), "utf8");
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`waitUntil 超时：${label}`);
}

describe("invocation concurrency gate integration（p-010 A1）", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        resetInvocationConcurrencyGateForTests();
        root = testHostPath("agent-invocation-concurrency-test", randomUUID());
        faux = createFauxModels({
            models: [{
                id: `faux-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        await writeFauxProviderConfig(root, faux);
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(
                join(root, "profiles-system"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(root),
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.cc.probe", name: "test.cc.probe"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys(["cc_probe"]),
            prepare() {
                return {};
            },
        }), false);
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        resetInvocationConcurrencyGateForTests();
        await rm(root, {recursive: true, force: true});
    });

    async function createSession(): Promise<number> {
        const created = await harness.createAgent({profileKey: "test.cc.probe", initial: {}});
        return created.sessionId;
    }

    function invoke(sessionId: number) {
        return harness.invokeAgent({
            sessionId,
            mode: "prompt",
            clientMessageId: randomUUID(),
            message: {text: "go"},
        });
    }

    it("8 并发跨 session invocation：同时进入运行段 ≤2，其余排队后被服务（验收 2）", async () => {
        const probe = createProbeTool();
        harness.tools.register(probe.tool);
        faux.setResponses(probeResponses(16));
        const sessions = await Promise.all(Array.from({length: 8}, () => createSession()));
        const gate = useInvocationConcurrencyGate();

        const results = sessions.map((sessionId) => invoke(sessionId));
        await waitUntil(() => gate.snapshot().active.total === 2 && gate.snapshot().queue.total === 6, "2 持槽 + 6 排队");
        await waitUntil(() => probe.stats().active === 2, "两个运行段进入探针");
        expect(probe.stats().maxActive).toBe(2);

        // 开门后整批按槽位上限流水跑完；后续准入的 invocation 不再阻塞于探针
        probe.open();
        const settled = await Promise.all(results);
        expect(settled.map((result) => result.status)).toEqual(Array.from({length: 8}, () => "completed"));
        // 全周期运行段并发从未超过配置上限
        expect(probe.stats().maxActive).toBeLessThanOrEqual(2);
        await gate.whenIdle();
        const snapshot = gate.snapshot();
        expect(snapshot.active.total).toBe(0);
        expect(snapshot.totals.queued).toBe(6);
        expect(snapshot.totals.acquired).toBe(8);
        expect(snapshot.totals.released).toBe(8);
        expect(snapshot.totals.timeout).toBe(0);
    });

    it("排队超时返回 typed error：code=AGENT_INVOCATION_CONCURRENCY_LIMIT、pre_loop、retryable（验收 2）", async () => {
        // acquireTimeoutMs 取下界 1000ms：normalizer fail-closed 下界即 1000，写更小值会被归一化成默认 60s
        await writeConcurrencyConfig(root, faux, {maxConcurrentInvocations: 1, acquireTimeoutMs: 1_000});
        const probe = createProbeTool();
        harness.tools.register(probe.tool);
        faux.setResponses(probeResponses(4));
        const sessionA = await createSession();
        const sessionB = await createSession();
        const gate = useInvocationConcurrencyGate();

        const resultAPromise = invoke(sessionA);
        await waitUntil(() => probe.stats().active === 1, "A 持槽进探针");

        const resultB = await invoke(sessionB);
        expect(resultB.status).toBe("error");
        expect(resultB.errorPhase).toBe("pre_loop");
        expect(resultB.errorInfo).toEqual(expect.objectContaining({
            code: AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE,
            retryable: true,
        }));

        probe.releaseAll();
        const resultA = await resultAPromise;
        expect(resultA.status).toBe("completed");
        await gate.whenIdle();
        expect(gate.snapshot().active.total).toBe(0);
        expect(gate.snapshot().totals.timeout).toBe(1);
    });

    it("槽位泄漏守门：abort / provider 抛错 / 客户端断开三路径后占用归零（验收 3）", async () => {
        const gate = useInvocationConcurrencyGate();
        // 三条路径共用一个探针（registry 同 key 只能注册一次；abort 后探针 execute 悬挂由 releaseAll 收尾）
        const probe = createProbeTool();
        harness.tools.register(probe.tool);

        // 路径 1：运行中 abort（用户取消）
        faux.setResponses(probeResponses(2));
        const sessionA = await createSession();
        const abortResultPromise = invoke(sessionA);
        await waitUntil(() => gate.snapshot().active.total === 1, "路径 1 持槽");
        await harness.abortInvocation(sessionA);
        await waitUntil(() => gate.snapshot().active.total === 0, "路径 1 释放");
        probe.releaseAll();
        await abortResultPromise.catch(() => undefined);

        // 路径 2：provider 抛错（error stopReason）
        faux.setResponses([fauxAssistantMessage([], {stopReason: "error", errorMessage: "provider failed"})]);
        const sessionB = await createSession();
        const errorResult = await invoke(sessionB);
        expect(errorResult.status).toBe("error");
        await waitUntil(() => gate.snapshot().active.total === 0, "路径 2 释放");

        // 路径 3：客户端断开（input.signal abort）
        const sessionC = await createSession();
        const controller = new AbortController();
        faux.setResponses(probeResponses(2));
        const disconnectPromise = harness.invokeAgent({
            sessionId: sessionC,
            mode: "prompt",
            clientMessageId: randomUUID(),
            message: {text: "go"},
            signal: controller.signal,
        });
        await waitUntil(() => gate.snapshot().active.total === 1, "路径 3 持槽");
        controller.abort();
        await disconnectPromise.catch(() => undefined);
        await waitUntil(() => gate.snapshot().active.total === 0, "路径 3 释放");
        probe.releaseAll();
        await harness.drainBackgroundTasks();
    });

    it("配置热读：改 config 免重启生效，上调后排队者随下次释放按新上限准入；已持槽位不受影响（验收 5）", async () => {
        await writeConcurrencyConfig(root, faux, {maxConcurrentInvocations: 1, reservedInteractiveSlots: 0});
        const probe = createProbeTool();
        harness.tools.register(probe.tool);
        faux.setResponses(probeResponses(6));
        const sessionA = await createSession();
        const sessionB = await createSession();
        const sessionC = await createSession();
        const gate = useInvocationConcurrencyGate();

        const resultAPromise = invoke(sessionA);
        await waitUntil(() => probe.stats().active === 1, "A 持槽进探针");
        const resultBPromise = invoke(sessionB);
        const resultCPromise = invoke(sessionC);
        await waitUntil(() => gate.snapshot().queue.total === 2, "B/C 排队（max=1）");

        // 免重启上调 max=2：A 完成触发 drain，B 与 C 按新上限同轮双双准入
        // （旧上限 1 下本轮只能准入 B，C 会继续排队——探针并发数区分两条世界线）。
        await writeConcurrencyConfig(root, faux, {maxConcurrentInvocations: 2, reservedInteractiveSlots: 0});
        probe.releaseNext();
        await resultAPromise;
        await waitUntil(() => probe.stats().active === 2, "B/C 按新上限双双进探针");
        expect(probe.stats().maxActive).toBe(2);

        probe.releaseAll();
        const [resultB, resultC] = await Promise.all([resultBPromise, resultCPromise]);
        expect(resultB.status).toBe("completed");
        expect(resultC.status).toBe("completed");
        await gate.whenIdle();
        expect(gate.snapshot().active.total).toBe(0);
    });
});
