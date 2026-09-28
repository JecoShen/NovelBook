import {describe, expect, it, vi} from "vitest";
import {
    AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE,
    InvocationConcurrencyGate,
    InvocationConcurrencyLimitError,
    type InvocationConcurrencyGateLimits,
} from "nbook/server/agent/harness/invocation-concurrency-gate";

/**
 * 全局并发闸（p-010 A1）单测：FIFO、类别保留、超时、幂等释放、abort、防误释放、配置热读。
 * 每用例独立 new gate，不经 globalThis 单例。
 */

const DEFAULT_LIMITS: InvocationConcurrencyGateLimits = {
    maxConcurrentInvocations: 2,
    reservedInteractiveSlots: 1,
    acquireTimeoutMs: 60_000,
};

function limitsReader(limits: InvocationConcurrencyGateLimits): () => Promise<InvocationConcurrencyGateLimits> {
    return async () => limits;
}

/** 跟踪一个 acquire promise 是否已 settle。 */
function track(promise: Promise<unknown>): {settled: () => boolean} {
    let settled = false;
    void promise.then(() => {
        settled = true;
    }, () => {
        settled = true;
    });
    return {settled: () => settled};
}

/** acquire 入口先 await 读配置，入队是异步的；队列深度断言必须等入队落定。 */
async function waitForQueueDepth(gate: InvocationConcurrencyGate, expected: number): Promise<void> {
    await vi.waitFor(() => {
        expect(gate.snapshot().queue.total).toBe(expected);
    });
}

describe("InvocationConcurrencyGate", () => {
    it("低负载即时 acquire；释放后计数归零", async () => {
        const gate = new InvocationConcurrencyGate();
        const release = await gate.acquire({
            invocationId: "inv-1",
            concurrencyClass: "interactive",
            readLimits: limitsReader(DEFAULT_LIMITS),
        });
        expect(gate.snapshot().active).toEqual({interactive: 1, background: 0, total: 1});

        release();
        await gate.whenIdle();
        const snapshot = gate.snapshot();
        expect(snapshot.active.total).toBe(0);
        expect(snapshot.totals).toEqual(expect.objectContaining({acquired: 1, released: 1, queued: 0, timeout: 0}));
    });

    it("FIFO：同类排队者按到达顺序准入", async () => {
        const gate = new InvocationConcurrencyGate();
        const limits = {...DEFAULT_LIMITS, maxConcurrentInvocations: 1};
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        const bPromise = gate.acquire({invocationId: "b", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        const cPromise = gate.acquire({invocationId: "c", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        const cTrack = track(cPromise);
        await waitForQueueDepth(gate, 2);

        releaseA();
        const releaseB = await bPromise;
        await gate.whenIdle();
        // B 已准入；max=1 下 C 必须仍排队（drain 在同轮评估过 C 但容量不足）。
        expect(gate.snapshot().queue.total).toBe(1);
        expect(cTrack.settled()).toBe(false);

        releaseB();
        const releaseC = await cPromise;
        await gate.whenIdle();
        expect(gate.snapshot().active.total).toBe(1);
        releaseC();
    });

    it("类别保留：background 占满其容量时 interactive 仍可即时 acquire，反之等待", async () => {
        const gate = new InvocationConcurrencyGate();
        // max=2, reserved=1 → background 容量 = 1
        const releaseBg1 = await gate.acquire({invocationId: "bg-1", concurrencyClass: "background", readLimits: limitsReader(DEFAULT_LIMITS)});
        // background 容量已满 → 第二个 background 排队
        const bg2Promise = gate.acquire({invocationId: "bg-2", concurrencyClass: "background", readLimits: limitsReader(DEFAULT_LIMITS)});
        const bg2Track = track(bg2Promise);
        // interactive 不受 background 排队阻塞（保留槽语义）
        const releaseI1 = await gate.acquire({invocationId: "i-1", concurrencyClass: "interactive", readLimits: limitsReader(DEFAULT_LIMITS)});
        expect(gate.snapshot().active).toEqual({interactive: 1, background: 1, total: 2});
        // 总槽满 → 第二个 interactive 排队
        const i2Promise = gate.acquire({invocationId: "i-2", concurrencyClass: "interactive", readLimits: limitsReader(DEFAULT_LIMITS)});
        const i2Track = track(i2Promise);
        await waitForQueueDepth(gate, 2);

        // 释放 interactive：i2 准入；bg2 仍受 background 容量约束（activeBg=1 ≥ cap=1）
        releaseI1();
        const releaseI2 = await i2Promise;
        await gate.whenIdle();
        expect(bg2Track.settled()).toBe(false);
        expect(gate.snapshot().active).toEqual({interactive: 1, background: 1, total: 2});

        // 释放 background：bg2 才准入
        releaseBg1();
        const releaseBg2 = await bg2Promise;
        await gate.whenIdle();
        expect(gate.snapshot().active).toEqual({interactive: 1, background: 1, total: 2});
        expect(i2Track.settled()).toBe(true);
        releaseI2();
        releaseBg2();
    });

    it("超时拒绝：排队超过 acquireTimeoutMs 抛 typed error 含占用/队列快照", async () => {
        const gate = new InvocationConcurrencyGate();
        const limits: InvocationConcurrencyGateLimits = {maxConcurrentInvocations: 1, reservedInteractiveSlots: 0, acquireTimeoutMs: 50};
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits: limitsReader(limits)});

        const startedAt = Date.now();
        const error = await gate.acquire({
            invocationId: "b",
            concurrencyClass: "interactive",
            readLimits: limitsReader(limits),
        }).catch((caught: unknown) => caught);
        const elapsed = Date.now() - startedAt;

        expect(error).toBeInstanceOf(InvocationConcurrencyLimitError);
        const typed = error as InvocationConcurrencyLimitError;
        expect(typed.code).toBe(AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE);
        expect(typed.activeByClass).toEqual({interactive: 1, background: 0});
        expect(typed.limits.maxConcurrentInvocations).toBe(1);
        expect(elapsed).toBeGreaterThanOrEqual(40);
        expect(elapsed).toBeLessThan(5_000);
        await gate.whenIdle();
        expect(gate.snapshot().totals.timeout).toBe(1);
        expect(gate.snapshot().queue.total).toBe(0);
        releaseA();
    });

    it("释放幂等 + 防延迟误释放：重复释放只生效一次，不误伤后续持有者", async () => {
        const gate = new InvocationConcurrencyGate();
        const limits = {...DEFAULT_LIMITS, maxConcurrentInvocations: 1};
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        releaseA();
        releaseA();
        await gate.whenIdle();
        expect(gate.snapshot().totals.released).toBe(1);

        const releaseB = await gate.acquire({invocationId: "b", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        // A 的释放函数再次调用不得触碰 B 的槽位
        releaseA();
        await gate.whenIdle();
        expect(gate.snapshot().active.total).toBe(1);
        expect(gate.snapshot().totals.released).toBe(1);
        releaseB();
    });

    it("排队中 abort：放弃排队抛 AbortError，不占槽不阻塞后续 acquire", async () => {
        const gate = new InvocationConcurrencyGate();
        const limits = {...DEFAULT_LIMITS, maxConcurrentInvocations: 1};
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        const controller = new AbortController();
        const bPromise = gate.acquire({
            invocationId: "b",
            concurrencyClass: "interactive",
            signal: controller.signal,
            readLimits: limitsReader(limits),
        });
        // 等 B 真正入队（abort 监听器已挂上）再取消，走的才是「排队中放弃」路径
        await waitForQueueDepth(gate, 1);

        controller.abort();
        const error = await bPromise.catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe("AbortError");
        await gate.whenIdle();
        expect(gate.snapshot().totals.rejected).toBe(1);
        expect(gate.snapshot().queue.total).toBe(0);

        // B 未占槽：释放 A 后 C 可即时准入
        releaseA();
        const releaseC = await gate.acquire({invocationId: "c", concurrencyClass: "interactive", readLimits: limitsReader(limits)});
        releaseC();
    });

    it("acquire 前已 abort 的 signal 直接抛 AbortError，不进队列", async () => {
        const gate = new InvocationConcurrencyGate();
        const controller = new AbortController();
        controller.abort();
        const error = await gate.acquire({
            invocationId: "a",
            concurrencyClass: "interactive",
            signal: controller.signal,
            readLimits: limitsReader(DEFAULT_LIMITS),
        }).catch((caught: unknown) => caught);
        expect((error as Error).name).toBe("AbortError");
        expect(gate.snapshot().queue.total).toBe(0);
        expect(gate.snapshot().active.total).toBe(0);
    });

    it("配置热读：drain 重读最新 limits，上调后一次释放可准入多个排队者；已持槽位不受影响", async () => {
        const gate = new InvocationConcurrencyGate();
        let current: InvocationConcurrencyGateLimits = {maxConcurrentInvocations: 1, reservedInteractiveSlots: 0, acquireTimeoutMs: 60_000};
        const readLimits = async () => current;
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits});
        const bPromise = gate.acquire({invocationId: "b", concurrencyClass: "interactive", readLimits});
        const cPromise = gate.acquire({invocationId: "c", concurrencyClass: "interactive", readLimits});
        await waitForQueueDepth(gate, 2);

        // 上调为 2：drain 用新 limits，A 释放后 B 与 C 在同一轮 drain 双双准入
        // （若用入队时旧 limits（max=1），本轮只能准入 B）。
        current = {...current, maxConcurrentInvocations: 2};
        releaseA();
        const releaseB = await bPromise;
        const releaseC = await cPromise;
        await gate.whenIdle();
        expect(gate.snapshot().active.total).toBe(2);
        releaseB();
        releaseC();
    });

    it("readLimits 抛错 fail-closed 到内置默认（2 槽），闸保持可用", async () => {
        const gate = new InvocationConcurrencyGate();
        const brokenReader = async (): Promise<InvocationConcurrencyGateLimits> => {
            throw new Error("config unreadable");
        };
        const releaseA = await gate.acquire({invocationId: "a", concurrencyClass: "interactive", readLimits: brokenReader});
        const releaseB = await gate.acquire({invocationId: "b", concurrencyClass: "interactive", readLimits: brokenReader});
        const cPromise = gate.acquire({invocationId: "c", concurrencyClass: "interactive", readLimits: brokenReader});
        const cTrack = track(cPromise);
        // 默认 max=2：第三个 interactive 排队
        await waitForQueueDepth(gate, 1);
        expect(gate.snapshot().active.total).toBe(2);
        expect(cTrack.settled()).toBe(false);
        releaseA();
        const releaseC = await cPromise;
        releaseB();
        releaseC();
    });
});
