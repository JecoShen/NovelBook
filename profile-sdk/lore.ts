// Profile SDK 子入口：把 chapter 级 lore 上下文注入暴露给 Profile 作者。
// Profile 沙箱要求只允许白名单 specifier；lore 注入是 writer 的常见需求但不能
// 暴露 nbook/server/* 整条路径，因此通过 SDK 子模块再导出。
import {resolveForChapter as resolveForChapterHost} from "nbook/server/agent/lore/lore-resolver";
import {renderInjectedMarkdown as renderInjectedMarkdownHost} from "nbook/server/agent/lore/lore-context-injector";
import type {ReadyProjectSessionRef as ReadyProjectSessionRefHost} from "nbook/server/workspace-files/project-session-types";

export const resolveForChapter: typeof resolveForChapterHost = resolveForChapterHost;

export const renderInjectedMarkdown: typeof renderInjectedMarkdownHost = renderInjectedMarkdownHost;

export type ReadyProjectSessionRef = ReadyProjectSessionRefHost;
