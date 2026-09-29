// Profile SDK 子入口：把 chapter 级 lore 上下文注入暴露给 Profile 作者。
// Profile 沙箱要求只允许白名单 specifier；lore 注入是 writer 的常见需求但不能
// 暴露 nbook/server/* 整条路径，因此通过 SDK 子模块再导出。
import { resolveForChapter as resolveForChapterHost } from 'nbook/server/agent/lore/lore-resolver'
import { renderInjectedMarkdown as renderInjectedMarkdownHost } from 'nbook/server/agent/lore/lore-context-injector'
import { readRecentLoreInjections as readRecentLoreInjectionsHost } from 'nbook/server/agent/lore/lore-carryover-store'
import { recordLoreInjection as recordLoreInjectionHost } from 'nbook/server/agent/lore/lore-carryover-store'
import type { ResolveForChapterInput as ResolveForChapterInputHost, ResolveForChapterResult as ResolveForChapterResultHost } from 'nbook/server/agent/lore/lore-resolver'
import type { ReadyProjectSessionRef as ReadyProjectSessionRefHost } from 'nbook/server/workspace-files/project-session-types'
import type { ChapterLoreResolver } from './contracts'

export const resolveForChapter: typeof resolveForChapterHost = resolveForChapterHost

/** p-008 选卡分发（trigger/shadow/memory）的宿主能力形态，由 harness/preview 在 prepare 时注入。 */
export type { ChapterLoreResolver } from './contracts'

// p-008：读配置闸（agent.loreContext.retriever）后的选卡入口；trigger 模式下
// 与 resolveForChapter 同语义同结果。lore-retriever 的运行时重图（config-service/
// world-embedding/nb-memory）违反 profile artifact 依赖门禁（白名单前缀 server/agent/lore/
// 的「闭包小且无 npm/网络/写依赖」前提），必须经 ProfilePrepareContext.runtime 注入而不是
// 静态 import 进 artifact；宿主未注入时（脚本直调 prepare 等）退回 trigger 语义现状路径。
export const resolveChapterLore: (runtime: { resolveChapterLore?: ChapterLoreResolver } | undefined, input: ResolveForChapterInputHost) => Promise<ResolveForChapterResultHost> = async (runtime, input) => {
    if (runtime?.resolveChapterLore) return runtime.resolveChapterLore(input)
    return resolveForChapterHost(input)
}

export const renderInjectedMarkdown: typeof renderInjectedMarkdownHost = renderInjectedMarkdownHost

export const readRecentLoreInjections: typeof readRecentLoreInjectionsHost = readRecentLoreInjectionsHost

export const recordLoreInjection: typeof recordLoreInjectionHost = recordLoreInjectionHost

export type ReadyProjectSessionRef = ReadyProjectSessionRefHost
