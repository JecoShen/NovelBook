// 项目根 flat config：仅追加 ignores，规则全部由 @nuxt/eslint (withNuxt) 提供。
// 单一格式化器策略：依赖 @nuxt/eslint 内建 stylistic，不引入 Prettier。
// @nuxt/eslint 模块在 `nuxt prepare` 时会向 .nuxt/eslint.config.mjs 写入 withNuxt 包装器。

import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: [
    // 仓库既有的构建产物与本地状态（与 .gitignore 对齐）
    '.nuxt/**',
    '.output/**',
    '.agent/**',
    '.worktree/**',
    'workspace/**',
    'product/**',
    'dist/**',
    'coverage/**',
    'docs/.vitepress/**',
    '.cache/**',
    '.traces/**',
    '.runtime/**',
    '.deploy/**',
    '**/.tmp-bun-install/**',
    // 锁文件
    'bun.lock',
    'bun.lockb',
    // 第三方生成物
    '**/node_modules/**',
    // 生成代码
    'server/generated/**',
    'prisma/generated/**',
    // 工具链与构建脚本（不属于应用代码 lint 范围）
    '**/*.config.cjs',
  ],
})
