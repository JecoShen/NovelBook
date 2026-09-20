import {randomUUID} from "node:crypto";
import type {Dirent} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {writeTextFileAtomically} from "nbook/server/workspace-files/atomic-file-write";
import {
    NODE_PROJECT_MANIFEST_ADAPTER,
    type ProjectManifestAdapter,
} from "nbook/server/workspace-files/project-lifecycle-manifest";

/** 回收区在Workspace Root `.nbook`下的目录名；与discovery scan的`.nbook`豁免天然对齐。 */
export const PROJECT_TRASH_DIRECTORY = "trash";
/** 回收条目的自描述marker文件名。 */
export const PROJECT_TRASH_MARKER_FILE = "trash.json";
/** 回收条目物理内容在entry内的固定目录名；restore按它定位payload。 */
export const PROJECT_TRASH_PAYLOAD_DIRECTORY = "payload";

const TRASH_ENTRY_PREFIX = "v1-";
/** 产品决策：删除的Project在回收区保留30天，超龄由周期清扫物理清除。 */
export const DEFAULT_PROJECT_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 回收条目marker的自描述内容；进程重启后仍凭它完成aging与按名恢复。 */
export type ProjectTrashMarker = {
    readonly schemaVersion: 1;
    readonly kind: "nbook-project-trash-entry";
    /** 被删Project的原Workspace Root-relative一级路径名。 */
    readonly projectRoot: string;
    /** ISO 8601删除时间，供人读；aging以deletedAtMs为准。 */
    readonly deletedAt: string;
    readonly deletedAtMs: number;
    /** 原tombstone目录名，供与Lifecycle delete事务日志对账。 */
    readonly tombstoneName: string;
};

/** 一次回收区/遗留tombstone扫描发现的单个条目。 */
export type ProjectTrashEntry = {
    readonly entryName: string;
    readonly entryRoot: AbsoluteFsPath;
    readonly payloadRoot: AbsoluteFsPath;
    /** payload目录当前是否存在；marker-only残壳不可恢复，只等aging清除。 */
    readonly hasPayload: boolean;
    /** marker缺失或损坏时为null，此时条目只能按目录mtime参与aging。 */
    readonly projectRoot: string | null;
    /** marker的deletedAtMs；marker不可读时回退为entry目录mtime。 */
    readonly deletedAtMs: number;
    readonly marker: ProjectTrashMarker | null;
};

/** 清扫遇到的单条目失败；不清扫动作本身不致命，由Lifecycle压缩为cleanup诊断。 */
export type ProjectTrashSweepIssue = {
    readonly entryRoot: AbsoluteFsPath;
    readonly phase: "scan" | "remove";
    readonly error: unknown;
};

export type ProjectTrashSweepReport = {
    /** 本轮物理清除的Workspace Root-relative entry路径。 */
    readonly removed: readonly string[];
    readonly issues: readonly ProjectTrashSweepIssue[];
};

export type ProjectTrashStoreOptions = {
    readonly now?: () => number;
    readonly retentionMs?: number;
    /**
     * mkdir/rename/rm与Lifecycle事务共用同一Adapter注入缝，测试可在回收路径上
     * 模拟I/O失败；readdir/stat/marker读取对事务语义无影响，直接走Node fs。
     */
    readonly adapter?: ProjectManifestAdapter;
};

/**
 * Project回收区深Module。
 *
 * delete提交后的tombstone不再即时rm，而是同卷rename进`.nbook/trash/v1-<uuid>/payload`
 * 并写自描述marker；超龄条目由周期清扫清除。Module只做文件系统事实，不参与锁与snapshot。
 */
export class ProjectTrashStore {
    readonly trashRoot: AbsoluteFsPath;
    private readonly workspaceRoot: AbsoluteFsPath;
    private readonly now: () => number;
    private readonly retentionMs: number;
    private readonly adapter: ProjectManifestAdapter;

    constructor(workspaceRoot: AbsoluteFsPath, options: ProjectTrashStoreOptions = {}) {
        this.workspaceRoot = workspaceRoot;
        this.trashRoot = absoluteFsPath(path.join(workspaceRoot, ".nbook", PROJECT_TRASH_DIRECTORY));
        this.now = options.now ?? Date.now;
        this.retentionMs = options.retentionMs ?? DEFAULT_PROJECT_TRASH_RETENTION_MS;
        this.adapter = options.adapter ?? NODE_PROJECT_MANIFEST_ADAPTER;
    }

    /**
     * 把delete事务已提交的tombstone迁入回收区。
     * 先rename payload再原子写marker；任一失败都不rm原始数据——未移动时只回收本函数
     * 新建的空entry壳，已移动未写marker时保留entry由aging按mtime兜底。
     */
    async adopt(input: {
        readonly tombstoneRoot: AbsoluteFsPath;
        readonly projectRoot: string;
    }): Promise<ProjectTrashEntry> {
        const entryName = `${TRASH_ENTRY_PREFIX}${randomUUID()}`;
        const entryRoot = absoluteFsPath(path.join(this.trashRoot, entryName));
        const payloadRoot = absoluteFsPath(path.join(entryRoot, PROJECT_TRASH_PAYLOAD_DIRECTORY));
        await this.adapter.mkdir(entryRoot, {recursive: true});
        let payloadMoved = false;
        try {
            await this.adapter.rename(input.tombstoneRoot, payloadRoot);
            payloadMoved = true;
            const deletedAtMs = this.now();
            const marker: ProjectTrashMarker = {
                schemaVersion: 1,
                kind: "nbook-project-trash-entry",
                projectRoot: input.projectRoot,
                deletedAt: new Date(deletedAtMs).toISOString(),
                deletedAtMs,
                tombstoneName: path.basename(input.tombstoneRoot),
            };
            await writeTextFileAtomically(
                path.join(entryRoot, PROJECT_TRASH_MARKER_FILE),
                `${JSON.stringify(marker, null, 2)}\n`,
            );
            return {
                entryName,
                entryRoot,
                payloadRoot,
                hasPayload: true,
                projectRoot: input.projectRoot,
                deletedAtMs,
                marker,
            };
        } catch (error) {
            if (!payloadMoved) {
                await this.adapter.rm(entryRoot, {recursive: true, force: true}).catch(() => undefined);
            }
            throw error;
        }
    }

    /** 列出回收区全部条目；消失的trash root视为空回收区。 */
    async listEntries(): Promise<readonly ProjectTrashEntry[]> {
        const dirents = await this.readEntryDirents(this.trashRoot);
        const entries: ProjectTrashEntry[] = [];
        for (const dirent of dirents) {
            if (!isTrashEntryDirent(dirent)) {
                continue;
            }
            const entry = await this.readEntry(
                absoluteFsPath(path.join(this.trashRoot, dirent.name)),
                dirent.name,
            );
            if (entry) {
                entries.push(entry);
            }
        }
        return Object.freeze(entries);
    }

    /** 按原Project名找最新一条仍带payload的可恢复条目；同名多次删除取最近删除的。 */
    async findByProjectRoot(projectRoot: string): Promise<ProjectTrashEntry | null> {
        const entries = await this.listEntries();
        let matched: ProjectTrashEntry | null = null;
        for (const entry of entries) {
            if (!entry.hasPayload || entry.projectRoot !== projectRoot) {
                continue;
            }
            if (!matched || entry.deletedAtMs > matched.deletedAtMs) {
                matched = entry;
            }
        }
        return matched;
    }

    /** 物理清除整个entry；restore提交后回收空壳与超龄清扫共用。 */
    async removeEntry(entryRoot: AbsoluteFsPath): Promise<void> {
        await this.adapter.rm(entryRoot, {recursive: true, force: true});
    }

    /**
     * 清除超龄回收条目，并按同一保留期兜底清除`.nbook/deleted-projects`里的遗留
     * tombstone（回收迁移失败或旧版本即时rm时代之外的残留）。单条目失败不中断本轮。
     */
    async sweep(input: {readonly tombstoneParent?: AbsoluteFsPath} = {}): Promise<ProjectTrashSweepReport> {
        const removed: string[] = [];
        const issues: ProjectTrashSweepIssue[] = [];
        const nowMs = this.now();

        let trashDirents: Dirent[] = [];
        try {
            trashDirents = await this.readEntryDirents(this.trashRoot);
        } catch (error) {
            issues.push({entryRoot: this.trashRoot, phase: "scan", error});
        }
        for (const dirent of trashDirents) {
            if (!isTrashEntryDirent(dirent)) {
                continue;
            }
            const entryRoot = absoluteFsPath(path.join(this.trashRoot, dirent.name));
            try {
                const entry = await this.readEntry(entryRoot, dirent.name);
                if (!entry || nowMs - entry.deletedAtMs < this.retentionMs) {
                    continue;
                }
                await this.adapter.rm(entryRoot, {recursive: true, force: true});
                removed.push(this.relativePath(entryRoot));
            } catch (error) {
                issues.push({entryRoot, phase: "remove", error});
            }
        }

        if (input.tombstoneParent) {
            let tombstoneDirents: Dirent[] = [];
            try {
                tombstoneDirents = await this.readEntryDirents(input.tombstoneParent);
            } catch (error) {
                issues.push({entryRoot: input.tombstoneParent, phase: "scan", error});
            }
            for (const dirent of tombstoneDirents) {
                if (!isTrashEntryDirent(dirent)) {
                    continue;
                }
                const tombstoneRoot = absoluteFsPath(path.join(input.tombstoneParent, dirent.name));
                try {
                    const stat = await fs.stat(tombstoneRoot);
                    if (nowMs - stat.mtimeMs < this.retentionMs) {
                        continue;
                    }
                    await this.adapter.rm(tombstoneRoot, {recursive: true, force: true});
                    removed.push(this.relativePath(tombstoneRoot));
                } catch (error) {
                    if (isEnoent(error)) {
                        continue;
                    }
                    issues.push({entryRoot: tombstoneRoot, phase: "remove", error});
                }
            }
        }

        return Object.freeze({
            removed: Object.freeze(removed),
            issues: Object.freeze(issues),
        });
    }

    /** 读取回收区目录项；目录尚不存在视为空，真实I/O失败上抛由调用方决定诊断或中止。 */
    private async readEntryDirents(root: AbsoluteFsPath): Promise<Dirent[]> {
        try {
            return await fs.readdir(root, {withFileTypes: true});
        } catch (error) {
            if (isEnoent(error)) {
                return [];
            }
            throw error;
        }
    }

    /** 读取单个entry的marker与payload事实；扫描期间条目消失返回null。 */
    private async readEntry(entryRoot: AbsoluteFsPath, entryName: string): Promise<ProjectTrashEntry | null> {
        const payloadRoot = absoluteFsPath(path.join(entryRoot, PROJECT_TRASH_PAYLOAD_DIRECTORY));
        try {
            const [marker, payloadStat, entryStat] = await Promise.all([
                this.readMarker(path.join(entryRoot, PROJECT_TRASH_MARKER_FILE)),
                fs.stat(payloadRoot).catch((error: unknown) => {
                    if (isEnoent(error)) {
                        return null;
                    }
                    throw error;
                }),
                fs.stat(entryRoot),
            ]);
            return {
                entryName,
                entryRoot,
                payloadRoot,
                hasPayload: payloadStat?.isDirectory() ?? false,
                projectRoot: marker?.projectRoot ?? null,
                deletedAtMs: marker?.deletedAtMs ?? entryStat.mtimeMs,
                marker,
            };
        } catch (error) {
            if (isEnoent(error)) {
                return null;
            }
            throw error;
        }
    }

    /** marker缺失或损坏返回null；真实I/O失败上抛，避免在fs故障时按mtime误删数据。 */
    private async readMarker(markerPath: string): Promise<ProjectTrashMarker | null> {
        let raw: Buffer;
        try {
            raw = await this.adapter.readFile(markerPath);
        } catch (error) {
            if (isEnoent(error)) {
                return null;
            }
            throw error;
        }
        return parseProjectTrashMarker(raw.toString("utf-8"));
    }

    /** 诊断用Workspace Root-relative路径，不暴露绝对文件系统位置。 */
    private relativePath(target: AbsoluteFsPath): string {
        return path.relative(this.workspaceRoot, target).replaceAll(path.sep, "/");
    }
}

/** 只接受结构完整的首版marker；字段缺失/类型错误一律按无marker处理。 */
function parseProjectTrashMarker(raw: string): ProjectTrashMarker | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }
        const candidate = parsed as Record<string, unknown>;
        if (
            candidate.kind !== "nbook-project-trash-entry"
            || candidate.schemaVersion !== 1
            || typeof candidate.projectRoot !== "string"
            || candidate.projectRoot.length === 0
            || typeof candidate.deletedAt !== "string"
            || typeof candidate.deletedAtMs !== "number"
            || !Number.isFinite(candidate.deletedAtMs)
            || typeof candidate.tombstoneName !== "string"
        ) {
            return null;
        }
        return Object.freeze({
            schemaVersion: 1,
            kind: "nbook-project-trash-entry",
            projectRoot: candidate.projectRoot,
            deletedAt: candidate.deletedAt,
            deletedAtMs: candidate.deletedAtMs,
            tombstoneName: candidate.tombstoneName,
        });
    } catch {
        return null;
    }
}

/** 回收条目统一使用v1-前缀目录；其它名字（包括人为放置的内容）一概不碰。 */
function isTrashEntryDirent(dirent: Dirent): boolean {
    return dirent.isDirectory() && !dirent.isSymbolicLink() && dirent.name.startsWith(TRASH_ENTRY_PREFIX);
}

function isEnoent(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
