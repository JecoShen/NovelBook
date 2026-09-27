// Profile SDK 子入口：把 chapter 级 lore 上下文注入暴露给 Profile 作者。
// Profile 沙箱要求只允许白名单 specifier；lore 注入是 writer 的常见需求但不能
// 暴露 nbook/server/* 整条路径，因此通过 SDK 子模块再导出。
import { resolveForChapter as resolveForChapterHost } from 'nbook/server/agent/lore/lore-resolver'
import { resolveChapterLore as resolveChapterLoreHost } from 'nbook/server/agent/lore/lore-retriever'
import { renderInjectedMarkdown as renderInjectedMarkdownHost } from 'nbook/server/agent/lore/lore-context-injector'
import { readRecentLoreInjections as readRecentLoreInjectionsHost } from 'nbook/server/agent/lore/lore-carryover-store'
import { recordLoreInjection as recordLoreInjectionHost } from 'nbook/server/agent/lore/lore-carryover-store'
import type { ResolveForChapterInput as ResolveForChapterInputHost, ResolveForChapterResult as ResolveForChapterResultHost } from 'nbook/server/agent/lore/lore-resolver'
import type { ReadyProjectSessionRef as ReadyProjectSessionRefHost } from 'nbook/server/workspace-files/project-session-types'

export const resolveForChapter: typeof resolveForChapterHost = resolveForChapterHost

// p-008：读配置闸（agent.loreContext.retriever）后的选卡入口；trigger 模式下
// 与 resolveForChapter 同语义同结果。writer 主链走这里，lore_resolver_query
// 工具继续用上面的 resolveForChapter（始终 trigger 语义）。
// 签名显式锚定 lore-resolver 的轻量类型而非 typeof 宿主函数：lore-retriever
// 的运行时重图（config-service/world-embedding/nb-memory）不属于作者可见声明图，
// authoring 类型投影以 stub 替换该模块（对齐 profileHomeResource 先例）。
export const resolveChapterLore: (input: ResolveForChapterInputHost) => Promise<ResolveForChapterResultHost> = resolveChapterLoreHost

export const renderInjectedMarkdown: typeof renderInjectedMarkdownHost = renderInjectedMarkdownHost

export const readRecentLoreInjections: typeof readRecentLoreInjectionsHost = readRecentLoreInjectionsHost

export const recordLoreInjection: typeof recordLoreInjectionHost = recordLoreInjectionHost

export type ReadyProjectSessionRef = ReadyProjectSessionRefHost
