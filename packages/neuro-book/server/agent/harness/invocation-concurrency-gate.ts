import {appLogger} from "nbook/server/app-logs/logger";

/**
 * 全局 invocation 并发闸（p-010 A1）。
 *
 * 所有进入 harness 运行段的 invocation 共享这道进程级信号量：全局有界槽位、
 * interactive/background 分级、FIFO 时间有界排队、超时 typed error。
 * 形态镜像 bridge-run-registry（`globalThis` 单例、acquire 返回幂等释放函数、
 * 按 invocationId 防延迟 finally 误释放），语义不同：bridge registry 是拒绝式入口预审，
 * 本闸是有界排队式运行段兜底。
 *
 * 闸是纯进程内存态，重启即清空；配置（`agent.concurrency`，global-only）由调用方
 * 在每次 acquire 时经 `readLimits` 热读，改配置免重启生效，已持有槽位不受影响。
 */

export type InvocationConcurrencyClass = "interactive" | "background";

/** 闸消费的三个配置字段；A2/A3 预留字段不经过本模块。 */
export type InvocationConcurrencyGateLimits = {
    maxConcurrentInvocations: number;
    reservedInteractiveSlots: number;
    acquireTimeoutMs: number;
};

export const AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE = "AGENT_INVOCATION_CONCURRENCY_LIMIT" as const;

/** readLimits 失败时的 fail-closed 兜底；正常路径的默认值由 config normalizer 保证。 */
export const DEFAULT_INVOCATION_CONCURRENCY_GATE_LIMITS: InvocationConcurrencyGateLimits = {
    maxConcurrentInvocations: 2,
    reservedInteractiveSlots: 1,
    acquireTimeoutMs: 60_000,
};

export type InvocationConcurrencyGateSnapshot = {
    active: {interactive: number; background: number; total: number};
    queue: {interactive: number; background: number; total: number};
    totals: {queued: number; acquired: number; timeout: number; rejected: number; released: number};
};

/** 排队超时错误。code 沿 errorInfo.code 透出，各入口据此映射既有失败面（UI 503 / bridge 429 / 工具 isError）。 */
export class InvocationConcurrencyLimitError extends Error {
    readonly code = AGENT_INVOCATION_CONCURRENCY_LIMIT_CODE;
    readonly limits: InvocationConcurrencyGateLimits;
    readonly activeByClass: {interactive: number; background: number};
    readonly queueDepth: number;

    constructor(input: {
        limits: InvocationConcurrencyGateLimits;
        activeByClass: {interactive: number; background: number};
        queueDepth: number;
        waitMs: number;
    }) {
        super(`Agent invocation 并发槽位排队超时（等待 ${Math.round(input.waitMs)}ms，`
            + `active=${input.activeByClass.interactive}i+${input.activeByClass.background}b，`
            + `queue=${input.queueDepth}，limit=${input.limits.maxConcurrentInvocations}）`);
        this.name = "InvocationConcurrencyLimitError";
        this.limits = input.limits;
        this.activeByClass = input.activeByClass;
        this.queueDepth = input.queueDepth;
    }
}

export function isInvocationConcurrencyLimitError(error: unknown): error is InvocationConcurrencyLimitError {
    return error instanceof InvocationConcurrencyLimitError;
}

type HolderRecord = {
    concurrencyClass: InvocationConcurrencyClass;
    acquiredAt: number;
};

type QueueEntry = {
    invocationId: string;
    concurrencyClass: InvocationConcurrencyClass;
    enqueuedAt: number;
    /** 准入与超时快照用入队时配置；drain 唤醒判定重读最新配置（热读对排队者同样生效）。 */
    limits: InvocationConcurrencyGateLimits;
    readLimits: () => Promise<InvocationConcurrencyGateLimits>;
    timer: ReturnType<typeof setTimeout>;
    removeAbortListener: (() => void) | undefined;
    admit: () => void;
    reject: (error: Error) => void;
};

type ConcurrencyGateGlobal = {
    invocationConcurrencyGate?: InvocationConcurrencyGate;
};

const globalForConcurrencyGate = globalThis as typeof globalThis & ConcurrencyGateGlobal;

/**
 * 持有全局运行段槽位的 FIFO 排队闸。
 *
 * 准入规则：总数 < `maxConcurrentInvocations`，且 background 同时占用 < 上限减保留位
 * （interactive 可用全部槽）。同类严格 FIFO；跨类只受容量约束——background 排满其容量时
 * interactive 仍可即时 acquire，反之不成立（人优先于后台 churn）。
 */
export class InvocationConcurrencyGate {
    private readonly holders = new Map<string, HolderRecord>();
    private readonly queue: QueueEntry[] = [];
    private readonly totals = {queued: 0, acquired: 0, timeout: 0, rejected: 0, released: 0};
    /** drain 串行链：release 唤醒与超时/abort 清理不交错读配置。 */
    private drainChain: Promise<void> = Promise.resolve();

    /**
     * 占用一个运行段槽位；槽满时 FIFO 排队，超过 `acquireTimeoutMs` 抛
     * `InvocationConcurrencyLimitError`，signal abort 时抛 AbortError。
     * 成功返回幂等释放函数（按 invocationId 防延迟 finally 误释放）。
     */
    async acquire(input: {
        invocationId: string;
        concurrencyClass: InvocationConcurrencyClass;
        signal?: AbortSignal;
        readLimits: () => Promise<InvocationConcurrencyGateLimits>;
    }): Promise<() => void> {
        const limits = await this.safeReadLimits(input.readLimits);
        if (input.signal?.aborted) {
            throw concurrencyQueueAbortError();
        }
        // 同类有排队者时新到者必须入队（类内 FIFO）；跨类排队不阻塞即时准入。
        const sameClassQueued = this.queue.some((entry) => entry.concurrencyClass === input.concurrencyClass);
        if (!sameClassQueued && this.canAdmit(input.concurrencyClass, limits)) {
            return this.admitNow(input.invocationId, input.concurrencyClass, null);
        }
        return this.enqueue(input, limits);
    }

    /** 测试与诊断快照：占用/队列/累计计数。 */
    snapshot(): InvocationConcurrencyGateSnapshot {
        const active = {interactive: 0, background: 0, total: this.holders.size};
        for (const holder of this.holders.values()) {
            active[holder.concurrencyClass] += 1;
        }
        const queued = {interactive: 0, background: 0, total: this.queue.length};
        for (const entry of this.queue) {
            queued[entry.concurrencyClass] += 1;
        }
        return {active, queue: queued, totals: {...this.totals}};
    }

    /** 等待在途 drain 落定；测试 teardown 用，生产代码不需要。 */
    async whenIdle(): Promise<void> {
        await this.drainChain;
    }

    private canAdmit(concurrencyClass: InvocationConcurrencyClass, limits: InvocationConcurrencyGateLimits): boolean {
        if (this.holders.size >= limits.maxConcurrentInvocations) {
            return false;
        }
        if (concurrencyClass === "background") {
            const backgroundCap = limits.maxConcurrentInvocations - limits.reservedInteractiveSlots;
            return this.activeByClass("background") < backgroundCap;
        }
        return true;
    }

    private activeByClass(concurrencyClass: InvocationConcurrencyClass): number {
        let count = 0;
        for (const holder of this.holders.values()) {
            if (holder.concurrencyClass === concurrencyClass) {
                count += 1;
            }
        }
        return count;
    }

    private admitNow(
        invocationId: string,
        concurrencyClass: InvocationConcurrencyClass,
        enqueuedAt: number | null,
    ): () => void {
        this.holders.set(invocationId, {concurrencyClass, acquiredAt: Date.now()});
        this.totals.acquired += 1;
        void appLogger.info("agent.concurrency.acquired", {
            invocationId,
            concurrencyClass,
            waitMs: enqueuedAt === null ? 0 : Date.now() - enqueuedAt,
        });
        return this.createRelease(invocationId);
    }

    private async enqueue(
        input: {
            invocationId: string;
            concurrencyClass: InvocationConcurrencyClass;
            signal?: AbortSignal;
            readLimits: () => Promise<InvocationConcurrencyGateLimits>;
        },
        limits: InvocationConcurrencyGateLimits,
    ): Promise<() => void> {
        this.totals.queued += 1;
        void appLogger.info("agent.concurrency.queued", {
            invocationId: input.invocationId,
            concurrencyClass: input.concurrencyClass,
            queueDepth: this.queue.length + 1,
            activeTotal: this.holders.size,
        });
        return new Promise<() => void>((resolve, reject) => {
            const enqueuedAt = Date.now();
            const entry: QueueEntry = {
                invocationId: input.invocationId,
                concurrencyClass: input.concurrencyClass,
                enqueuedAt,
                limits,
                readLimits: input.readLimits,
                timer: undefined as unknown as ReturnType<typeof setTimeout>,
                removeAbortListener: undefined,
                admit: () => {
                    this.clearEntryWait(entry);
                    resolve(this.admitNow(entry.invocationId, entry.concurrencyClass, entry.enqueuedAt));
                },
                reject: (error: Error) => {
                    this.clearEntryWait(entry);
                    reject(error);
                },
            };
            // 超时计时器 unref：闸的等待不阻止进程退出（测试 teardown 同理）。
            entry.timer = setTimeout(() => {
                if (!this.removeQueuedEntry(entry)) {
                    return;
                }
                this.totals.timeout += 1;
                const snapshot = this.snapshot();
                void appLogger.warn("agent.concurrency.timeout", {
                    invocationId: entry.invocationId,
                    concurrencyClass: entry.concurrencyClass,
                    waitMs: Date.now() - enqueuedAt,
                    activeByClass: snapshot.active,
                    queueDepth: snapshot.queue.total,
                    limits: entry.limits,
                });
                entry.reject(new InvocationConcurrencyLimitError({
                    limits: entry.limits,
                    activeByClass: {interactive: snapshot.active.interactive, background: snapshot.active.background},
                    queueDepth: snapshot.queue.total,
                    waitMs: Date.now() - enqueuedAt,
                }));
            }, limits.acquireTimeoutMs);
            entry.timer.unref?.();
            if (input.signal) {
                const signal = input.signal;
                const onAbort = () => {
                    if (!this.removeQueuedEntry(entry)) {
                        return;
                    }
                    this.totals.rejected += 1;
                    void appLogger.info("agent.concurrency.rejected", {
                        invocationId: entry.invocationId,
                        concurrencyClass: entry.concurrencyClass,
                        waitMs: Date.now() - enqueuedAt,
                        reason: "aborted",
                    });
                    entry.reject(concurrencyQueueAbortError());
                };
                signal.addEventListener("abort", onAbort, {once: true});
                entry.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
            }
            this.queue.push(entry);
        });
    }

    private createRelease(invocationId: string): () => void {
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            const holder = this.holders.get(invocationId);
            // 仅当本 invocationId 仍占槽时释放；防止延迟 finally 误释放后续持有者。
            if (!holder) {
                return;
            }
            this.holders.delete(invocationId);
            this.totals.released += 1;
            void appLogger.info("agent.concurrency.released", {
                invocationId,
                concurrencyClass: holder.concurrencyClass,
                heldMs: Date.now() - holder.acquiredAt,
            });
            this.scheduleDrain();
        };
    }

    private scheduleDrain(): void {
        this.drainChain = this.drainChain.then(() => this.drainQueue()).catch((error: unknown) => {
            void appLogger.warn("agent.concurrency.drainFailed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    /** 按 FIFO 序唤醒当前容量可接纳的排队者；跨类跳过容量不足的排队者不阻塞后续。 */
    private async drainQueue(): Promise<void> {
        for (const entry of [...this.queue]) {
            if (!this.queue.includes(entry)) {
                continue;
            }
            const limits = await this.safeReadLimits(entry.readLimits);
            if (!this.canAdmit(entry.concurrencyClass, limits)) {
                continue;
            }
            if (!this.removeQueuedEntry(entry)) {
                continue;
            }
            entry.admit();
        }
    }

    private removeQueuedEntry(entry: QueueEntry): boolean {
        const index = this.queue.indexOf(entry);
        if (index < 0) {
            return false;
        }
        this.queue.splice(index, 1);
        return true;
    }

    private clearEntryWait(entry: QueueEntry): void {
        clearTimeout(entry.timer);
        entry.removeAbortListener?.();
    }

    /** 配置热读失败不致死：fail-closed 到内置默认，闸保持可用。 */
    private async safeReadLimits(readLimits: () => Promise<InvocationConcurrencyGateLimits>): Promise<InvocationConcurrencyGateLimits> {
        try {
            return await readLimits();
        } catch (error) {
            void appLogger.warn("agent.concurrency.configReadFailed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return DEFAULT_INVOCATION_CONCURRENCY_GATE_LIMITS;
        }
    }
}

function concurrencyQueueAbortError(): Error {
    const error = new Error("invocation aborted while queued for concurrency slot");
    error.name = "AbortError";
    return error;
}

/** 进程级单例（镜像 `useBridgeRunRegistry()` 模式）。 */
export function useInvocationConcurrencyGate(): InvocationConcurrencyGate {
    if (!globalForConcurrencyGate.invocationConcurrencyGate) {
        globalForConcurrencyGate.invocationConcurrencyGate = new InvocationConcurrencyGate();
    }
    return globalForConcurrencyGate.invocationConcurrencyGate;
}

/** 测试与重置钩子：把全局引用清空。生产代码不要调用。 */
export function resetInvocationConcurrencyGateForTests(): void {
    globalForConcurrencyGate.invocationConcurrencyGate = undefined;
}
