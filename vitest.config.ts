import { fileURLToPath } from 'node:url'
import { defaultExclude, defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('./', import.meta.url))
const AGENT_TEST_INCLUDE = [
  'app/composables/**/*.test.ts',
  'app/components/novel-ide/**/*.test.ts',
  'app/components/markdown-studio/**/*.test.ts',
  'app/components/profile-template-editor/**/*.test.ts',
  'app/stores/**/*.test.ts',
  'app/utils/**/*.test.ts',
  'scripts/build/**/*.test.ts',
  'scripts/ci/**/*.test.ts',
  'scripts/cli/**/*.test.ts',
  'scripts/db/**/*.test.ts',
  'scripts/install/**/*.test.ts',
  'scripts/maintenance/**/*.test.ts',
  'scripts/release/**/*.test.ts',
  'server/**/*.test.ts',
  // Profile DSL 用 JSX，相关测试必须是 .tsx 才能被 oxc 解析。
  'server/**/*.test.tsx',
  'shared/**/*.test.ts',
]
const TEST_EXCLUDE = [...defaultExclude, 'server/agent/lore/**/*.test.ts']

/**
 * 当前测试先聚焦后端 Agent 与 Agent 前端纯逻辑投影。
 * 统一使用 Node 环境，避免前端测试依赖和 Nuxt 浏览器运行时混进来。
 */
export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      nbook: rootDir,
    },
  },
  test: {
    // zod 必须由 Vite 处理，不能作为外部依赖直接加载。
    //
    // zod 4 的 ESM 入口只有 4 行（`export * from` + `export { z }` + `export default z`），
    // CJS 入口用 TypeScript 的 __createBinding / __exportStar 降级辅助函数。Vite 8 把 zod
    // 当外部依赖加载时，interop 层拿不到命名导出 `z`：`import { z } from 'zod'` 得到
    // undefined，随后按调用链表现为 `TypeError: undefined is not an object (evaluating
    // 'z.string')` 或 `SyntaxError: [vite] The requested module 'zod' does not provide an
    // export named 'z'`。后者会在 agent project 的 setupFiles 加载期抛出，把该 project
    // 下**全部**测试一起染红，与被测代码无关。
    //
    // 实测（vite 8.1.4 / vitest 4.1.10 / zod 4.4.3）：`ssr.resolve.externalConditions` 与
    // `resolve.conditions` 改成优先 import 都**不能**修复——问题不在条件解析，而在
    // externalize 后的 interop。只有让 Vite 处理该包才行。代价是每次运行多约 1.6s transform。
    server: {
      deps: {
        inline: ['zod'],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'agent',
          environment: 'node',
          globals: true,
          // lore 套件是 bun:test 原生（runner = bun，入口 = bun run test:lore）；
          // vitest 收进来越界解析不了 'bun:test'，只会把 agent 门禁染红。
          // 若在 server/agent/lore 下新增 vitest 测试，须同步收窄这里的排除面。
          exclude: TEST_EXCLUDE,
          // 服务器与 CI 的内存并发防线；projection cache 负责降低单进程峰值。
          maxWorkers: 1,
          // 默认 10s 不够：beforeEach 里开 Project 会加载 14 个 profile artifact，
          // 而单个 artifact 目前有 27.3 MiB（宿主实现被打进 bundle，见 Task 125 Phase 3）。
          // 这是承认当前 artifact 体积的真实成本，不是掩盖挂起——真正的修复是把 artifact 压小。
          hookTimeout: 60_000,
          // Agent 测试需要完整的 run snapshot 与日志隔离合同。
          globalSetup: [
            'server/agent/test/global-setup.ts',
            'server/workspace-files/vitest-global-setup.ts',
          ],
          setupFiles: [
            'server/workspace-files/vitest-tmpdir-setup.ts',
            'server/agent/test/setup.ts',
          ],
          include: AGENT_TEST_INCLUDE,
          coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: [
              'server/agent/**/*.ts',
              'shared/dto/agent-chat.dto.ts',
            ],
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'typecheck',
          environment: 'node',
          globals: true,
          exclude: TEST_EXCLUDE,
          maxWorkers: 1,
          globalSetup: ['server/workspace-files/vitest-global-setup.ts'],
          setupFiles: ['server/workspace-files/vitest-tmpdir-setup.ts'],
          include: ['scripts/typecheck/**/*.test.ts'],
        },
      },
    ],
  },
})
