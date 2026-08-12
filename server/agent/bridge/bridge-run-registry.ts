/**
 * Agent Bridge 专用并发限流注册表。
 *
 * 故意不进 `useAgentHarness()` 包装层：harness 是进程级单例，UI 会话也在上面跑，
 * 在那里限流会误伤前端。Registry 只约束 bridge 发起的 run（per-project=1, global=2），
 * 与 UI 的并发互不影响。
 *
 * 全局实例用 `globalThis` 缓存（镜像 `useAgentHarness()` 的单例模式），
 * 避免在多次 module re-evaluation 时丢失跨调用的并发计数。
 */

const DEFAULT_PER_PROJECT_LIMIT = 1;
const DEFAULT_GLOBAL_LIMIT = 2;

interface BridgeRunRecord {
    sessionId: number;
    startedAt: number;
}

type BridgeRegistryGlobal = {
    bridgeRunRegistry?: BridgeRunRegistry;
};

const globalForBridgeRegistry = globalThis as typeof globalThis & BridgeRegistryGlobal;

/** 桥并发超限错误。路由捕获后映射为 HTTP 429。 */
export class BridgeConcurrencyLimitError extends Error {
    readonly code = "BRIDGE_CONCURRENCY_LIMIT" as const;
    readonly perProjectLimit: number;
    readonly globalLimit: number;

    constructor(perProjectLimit: number, globalLimit: number) {
        super(`Agent Bridge 并发超限：per-project=${perProjectLimit}, global=${globalLimit}`);
        this.name = "BridgeConcurrencyLimitError";
        this.perProjectLimit = perProjectLimit;
        this.globalLimit = globalLimit;
    }
}

/**
 * 持有「同 project」+「全局」两层并发槽的注册表。
 *
 * `acquire` 在两个上限都未达时返回释放函数；任一上限达阈值即抛 `BridgeConcurrencyLimitError`。
 * 释放函数幂等：重复调用只释放一次；未 acquire 不可释放。
 */
export class BridgeRunRegistry {
    private readonly runs = new Map<string, BridgeRunRecord>();

    constructor(
        private readonly perProjectLimit: number = DEFAULT_PER_PROJECT_LIMIT,
        private readonly globalLimit: number = DEFAULT_GLOBAL_LIMIT,
    ) {}

    /** 占用一个 run 槽；超限抛 `BridgeConcurrencyLimitError`。 */
    acquire(projectRoot: string, sessionId: number): () => void {
        if (this.runs.has(projectRoot)) {
            throw new BridgeConcurrencyLimitError(this.perProjectLimit, this.globalLimit);
        }
        if (this.runs.size >= this.globalLimit) {
            throw new BridgeConcurrencyLimitError(this.perProjectLimit, this.globalLimit);
        }
        this.runs.set(projectRoot, {sessionId, startedAt: Date.now()});
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const current = this.runs.get(projectRoot);
            // 仅当本 sessionId 仍占此槽时释放；防止延迟 finally 误释放后续 run。
            if (current && current.sessionId === sessionId) {
                this.runs.delete(projectRoot);
            }
        };
    }

    /** 全局活跃 run 数（测试与诊断用）。 */
    activeCount(): number {
        return this.runs.size;
    }

    /** 指定 project 当前是否被占（路由层可选的快速查询）。 */
    isProjectActive(projectRoot: string): boolean {
        return this.runs.has(projectRoot);
    }
}

/** 进程级单例（镜像 `useAgentHarness()` 模式）。 */
export function useBridgeRunRegistry(): BridgeRunRegistry {
    if (!globalForBridgeRegistry.bridgeRunRegistry) {
        globalForBridgeRegistry.bridgeRunRegistry = new BridgeRunRegistry();
    }
    return globalForBridgeRegistry.bridgeRunRegistry;
}

/** 测试与重置钩子：把全局引用清空。生产代码不要调用。 */
export function resetBridgeRunRegistryForTests(): void {
    globalForBridgeRegistry.bridgeRunRegistry = undefined;
}
