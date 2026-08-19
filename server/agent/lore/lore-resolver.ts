import {buildLoreResolverIndex} from "./lore-resolver-cache";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export interface ResolveForChapterInput {
    readonly project: ReadyProjectSessionRef;
    readonly chapterText: string;
    /** 来自前章的「强相关」列表，无条件优先保留（即使本章未命中）。 */
    readonly carryOverPaths?: readonly string[];
    /** 注入上限，默认 8。 */
    readonly maxPaths?: number;
}

export interface ResolveForChapterResult {
    /** 排序后的注入路径列表（carryOver 优先，然后按命中 trigger 数量降序）。 */
    readonly paths: readonly string[];
    /** 每个 path 命中的 trigger 列表（debug 用）。 */
    readonly hitsByPath: ReadonlyMap<string, readonly string[]>;
    /** 总命中 trigger 数（metrics 用）。 */
    readonly totalTriggersMatched: number;
}

const DEFAULT_MAX_PATHS = 8;

export async function resolveForChapter(
    input: ResolveForChapterInput,
): Promise<ResolveForChapterResult> {
    if (input.chapterText.length === 0) {
        return {paths: [], hitsByPath: new Map(), totalTriggersMatched: 0};
    }
    const maxPaths = input.maxPaths ?? DEFAULT_MAX_PATHS;
    const index = await buildLoreResolverIndex(input.project);
    const hitsByPath = new Map<string, string[]>();
    const paragraphs = input.chapterText.split(/\n+/);
    let total = 0;
    for (const paragraph of paragraphs) {
        if (paragraph.length === 0) continue;
        for (const [trigger, paths] of index.triggerToPaths) {
            if (paragraph.includes(trigger)) {
                for (const p of paths) {
                    let bucket = hitsByPath.get(p);
                    if (!bucket) {
                        bucket = [];
                        hitsByPath.set(p, bucket);
                    }
                    if (!bucket.includes(trigger)) {
                        bucket.push(trigger);
                        total += 1;
                    }
                }
            }
        }
    }
    // carryOver 无条件排最前（即使本章未命中）；命中路径按 trigger 数降序。Set 天然去重并保序。
    const carryOver = input.carryOverPaths ?? [];
    const carrySet = new Set(carryOver);
    const matchedRanked = [...hitsByPath.keys()]
        .filter((p) => !carrySet.has(p))
        .sort((a, b) => (hitsByPath.get(b)?.length ?? 0) - (hitsByPath.get(a)?.length ?? 0));
    const ranked = [...carrySet, ...matchedRanked];
    return {
        paths: ranked.slice(0, maxPaths),
        hitsByPath,
        totalTriggersMatched: total,
    };
}
