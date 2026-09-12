import {fileURLToPath} from "node:url";
import {defaultExclude, defineConfig} from "vitest/config";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

/**
 * 当前测试先聚焦后端 Agent 与 Agent 前端纯逻辑投影。
 * 统一使用 Node 环境，避免前端测试依赖和 Nuxt 浏览器运行时混进来。
 */
export default defineConfig({
    root: rootDir,
    resolve: {
        alias: {
            nbook: rootDir,
            "#scripts": fileURLToPath(new URL("../../scripts/", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        globals: true,
        // Product bundle 与隔离 workspace fixture 会显著抬高单 worker 内存；
        // Windows 实测 4 workers 会触发进程池异常退出，2 workers 能保持完整门禁稳定。
        maxWorkers: 2,
        // 默认 10s 不够：beforeEach 里开 Project 会加载 14 个 profile artifact，
        // 而单个 artifact 目前有 27.3 MiB（宿主实现被打进 bundle，见 Task 125 Phase 3）。
        // 这是承认当前 artifact 体积的真实成本，不是掩盖挂起——真正的修复是把 artifact 压小。
        hookTimeout: 60_000,
        // 默认 5s 不够：Source 模式编译上下文解析会即时构建有界声明投影（TS declaration
        // emit 约 330 文件，冷构建 10s+），且隔离 fixture 各自持有 cacheRoot 不共享产物。
        // 超时截断的 teardown 会与在途构建竞态（ENOTEMPTY/ENOENT unhandled rejection）。
        testTimeout: 60_000,
        // run 级：先由 Agent fixture 设置 runId，再注册受控临时根清理；teardown 逆序执行。
        globalSetup: [
            "server/agent/test/global-setup.ts",
            "@notnotype/neuro-book-test-support/vitest",
        ],
        setupFiles: [
            "@notnotype/neuro-book-test-support/vitest",
            "server/agent/test/setup.ts",
        ],
        include: [
            "app/composables/**/*.test.ts",
            "app/components/novel-ide/**/*.test.ts",
            "app/components/markdown-studio/**/*.test.ts",
            "app/components/profile-template-editor/**/*.test.ts",
            "app/utils/theme/**/*.test.ts",
            "app/stores/**/*.test.ts",
            "app/utils/novel-ide-settings-responsive.contract.test.ts",
            "server/**/*.test.ts",
            "server/**/*.test.tsx",
            "shared/**/*.test.ts",
            "scripts/**/*.test.ts",
            "scripts/**/*.test.tsx",
        ],
        exclude: [
            ...defaultExclude,
            // lore 套件是 bun:test 原生（runner = bun，入口 = bun run test:lore）；
            // vitest 收进来越界解析不了 'bun:test'，只会把 agent 门禁染红。
            "server/agent/lore/**/*.test.ts",
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: [
                "server/agent/**/*.ts",
                "shared/dto/agent-chat.dto.ts",
            ],
        },
    },
});
