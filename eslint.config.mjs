// 项目根 flat config：规则权威是 @nuxt/eslint-config，不引入 Prettier。
//
// 两处偏离拆包前写法，原因都不显然：
//
// 1) 用 @nuxt/eslint-config/flat 的独立入口，而非 withNuxt。拆包后 Nuxt 应用退到
//    packages/neuro-book/，根目录不再产出 .nuxt/eslint.config.mjs；继续用 withNuxt 会让
//    「lint 全仓」先依赖应用包跑通 nuxt prepare，而 packages/nb-history 这类非 Nuxt 包
//    不该被应用构建态卡住。代价是拿不到模块从目录结构推导的设置（组件名规则等）。
//
// 2) 格式规则整体关闭，本门禁只管语义。收编上游树后全仓实测：4 空格缩进 1498 文件
//    （2 空格仅 64）、双引号 import 13396 条（单引号 478）、带分号 import 11527 条
//    （无分号 538）——即本树风格与 @nuxt 默认（2 空格/单引号/无分号）三项全反。
//
//    先尝试过把 stylistic 配成实测风格（indent 4 / quotes double / semi true）：quotes
//    从 226275 降到 8454、semi 从 229076 降到 6265 都有效，但 indent 仍剩 118935，且
//    object-curly-spacing 87815、quote-props 15887、arrow-parens 9837、comma-dangle 9641
//    等未被这三项覆盖的规则原样保留，合计仍有 276587 条 error、波及 2785 个文件。
//    也就是说逐项配下去仍等同重排全树，而本仓 main 是 upstream/master 的严格超集并定期
//    整树合并上游，重排的代价是此后每次合并都全树冲突。
//
//    因此格式不由 lint 管。关闭后基线为 3480 条 error，全部是语义问题。若将来要统一格式，
//    应是独立的一次性格式化提交，不混进门禁。

import {createConfigForNuxt} from "@nuxt/eslint-config/flat";

export default createConfigForNuxt({
    features: {
        stylistic: false,
    },
}, {
    ignores: [
        // 依赖与构建产物
        "**/node_modules/**",
        "**/.nuxt/**",
        "**/.output/**",
        "**/.nitro/**",
        "**/dist/**",
        "**/coverage/**",
        "**/.cache/**",
        "**/.tmp/**",
        "**/.tmp-bun-install/**",

        // 生成代码：Prisma client 等，均由生成器负责
        "**/generated/**",

        // 本机状态与运行态（与 .gitignore 对齐）
        ".agent/**",
        ".worktree/**",
        ".local/**",
        ".traces/**",
        ".runtime/**",
        ".deploy/**",
        "assets/**",
        "logs/**",
        "product/**",
        "server/**",

        // 用户作品数据，不属于代码
        "workspace/**",

        // 文档站产物
        "docs/.vitepress/**",
        "vitepress/.vitepress/cache/**",
        "vitepress/.vitepress/staged/**",
        "vitepress/.vitepress/.temp/**",

        // 锁文件
        "bun.lock",
        "bun.lockb",

        // 工具链配置，不属于应用代码 lint 范围
        "**/*.config.cjs",
    ],
});
