import fs from "node:fs/promises";
import path from "node:path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {parseFrontmatter} from "./lore-frontmatter";

export type LoreEntryKind =
    | "character" | "location" | "faction"
    | "event" | "item" | "world" | "system" | "spec";

export interface LoreEntryMeta {
    readonly path: string;
    readonly kind: LoreEntryKind;
    readonly title: string;
    readonly triggers: readonly string[];
    readonly enabled: boolean;
}

export interface LoreResolverIndex {
    readonly triggerToPaths: ReadonlyMap<string, ReadonlySet<string>>;
    readonly pathToEntry: ReadonlyMap<string, LoreEntryMeta>;
    readonly builtAt: string;
}

const ALLOWED_KINDS: ReadonlySet<LoreEntryKind> = new Set([
    "character", "location", "faction", "event", "item", "world", "system", "spec",
]);
const MIN_TRIGGER_LENGTH = 2;

const indexCache = new Map<string, LoreResolverIndex>();

function cacheKey(project: ReadyProjectSessionRef): string {
    return `${project.workspace.root}#${String(project.generation)}`;
}

async function readEntryMeta(
    projectRoot: string,
    category: string,
    slug: string,
): Promise<LoreEntryMeta | null> {
    const entryPath = `lorebook/${category}/${slug}`;
    const filePath = path.join(projectRoot, entryPath, "index.md");
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch {
        return null;
    }
    const fm = parseFrontmatter(raw);
    const retrieval = (typeof fm.retrieval === "object" && fm.retrieval !== null)
        ? fm.retrieval as Record<string, unknown>
        : {};
    const enabled = retrieval.enabled !== false;
    const triggers = Array.isArray(retrieval.trigger)
        ? (retrieval.trigger as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
    return {
        path: `${category}/${slug}`,
        kind: category as LoreEntryKind,
        title: typeof fm.title === "string" ? fm.title : slug,
        triggers,
        enabled,
    };
}

export async function buildLoreResolverIndex(
    project: ReadyProjectSessionRef,
): Promise<LoreResolverIndex> {
    const key = cacheKey(project);
    const cached = indexCache.get(key);
    if (cached) return cached;

    const projectRoot = project.workspace.root;
    const triggerToPaths = new Map<string, Set<string>>();
    const pathToEntry = new Map<string, LoreEntryMeta>();

    for (const category of ALLOWED_KINDS) {
        const dir = path.join(projectRoot, "lorebook", category);
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const slug of entries) {
            const meta = await readEntryMeta(projectRoot, category, slug);
            if (!meta || !meta.enabled) continue;
            pathToEntry.set(meta.path, meta);
            for (const trigger of meta.triggers) {
                if (trigger.length < MIN_TRIGGER_LENGTH) continue;
                let bucket = triggerToPaths.get(trigger);
                if (!bucket) {
                    bucket = new Set();
                    triggerToPaths.set(trigger, bucket);
                }
                bucket.add(meta.path);
            }
        }
    }

    const index: LoreResolverIndex = {
        triggerToPaths,
        pathToEntry,
        builtAt: new Date().toISOString(),
    };
    indexCache.set(key, index);
    return index;
}

export function invalidateLoreResolverIndex(project: ReadyProjectSessionRef): void {
    indexCache.delete(cacheKey(project));
}
