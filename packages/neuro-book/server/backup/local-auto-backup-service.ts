import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {appLogger} from "nbook/server/app-logs/logger";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {BackupArchiveService} from "nbook/server/backup/backup-archive-service";
import {useBackupKeyringService, type BackupKeyringService} from "nbook/server/backup/backup-keyring-service";

// 本地自动备份：每日一次把 State Root 归档落到 <stateRoot>/backups/local/，保留最新 7 份。
// 收集根只覆盖 workspace/ 与顶层 config.yaml/.env，backups/ 在收集范围之外，归档不会自我递归。
// 已配置恢复码（keyring 有 active key）时产物与云备份同格式（envelope + keyId），
// 未配置时产出未加密裸 zip 并在 meta 与 nb-backup.json 里明确记录 "none"——不因缺恢复码拒绝备份。

/** 本地自动备份保留份数 */
export const LOCAL_AUTO_BACKUP_KEEP = 7;

const LOCAL_AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_SUFFIX = ".nbbackup";
const META_SUFFIX = ".meta.json";
const STAGING_PREFIX = ".staging-";

export type LocalAutoBackupReason = "startup" | "schedule";

/** 归档旁车 meta：与云端备份 meta 同一语义面，kind 用 "local-auto" 与 "manual" 区分。 */
export type LocalAutoBackupMeta = {
    formatVersion: 1;
    kind: "local-auto";
    createdAt: string; // ISO
    sha256: string; // hex 小写，覆盖归档文件全字节
    keyId: string; // 未加密为 "none"
    encrypted: boolean;
    appVersion: string;
    fileSize: number;
    fileCount: number;
    reason: LocalAutoBackupReason;
};

export type LocalAutoBackupEntry = {
    name: string;
    archivePath: string;
    metaPath: string;
    createdAtMs: number;
};

export type LocalAutoBackupRunResult = {
    archivePath: string;
    metaPath: string;
    meta: LocalAutoBackupMeta;
    pruned: string[];
};

export type LocalAutoBackupLogger = {
    info(event: string, data?: unknown, message?: string): unknown;
    warn(event: string, data?: unknown, message?: string): unknown;
    error(event: string, data?: unknown, error?: unknown, message?: string): unknown;
};

export type LocalAutoBackupServiceOptions = {
    now?: () => Date;
    keyring?: Pick<BackupKeyringService, "activeKey">;
    logger?: LocalAutoBackupLogger;
    keep?: number;
};

/**
 * 本地自动备份目标目录：State Root 下、收集范围（workspace/ + 顶层两个文件）之外。
 * 其他需要引用该形态的边界（如回收区排除核对）统一从这里取，不复制路径字面量。
 */
export function localAutoBackupDirectory(paths: RuntimePaths): string {
    return join(paths.stateRoot, "backups", "local");
}

/**
 * 列出目标目录内的本地自动备份，新→旧排序。
 * 时间基准优先 sidecar meta 的 createdAt，缺失或损坏退回归档文件 mtime；同刻按文件名降序稳定。
 */
export async function listLocalAutoBackups(directory: string): Promise<LocalAutoBackupEntry[]> {
    let entries;
    try {
        entries = await readdir(directory, {withFileTypes: true});
    } catch {
        return []; // 目录不存在 = 尚无备份
    }
    const backups: LocalAutoBackupEntry[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(ARCHIVE_SUFFIX)) {
            continue;
        }
        const archivePath = join(directory, entry.name);
        const metaPath = join(directory, `${entry.name.slice(0, -ARCHIVE_SUFFIX.length)}${META_SUFFIX}`);
        backups.push({
            name: entry.name,
            archivePath,
            metaPath,
            createdAtMs: await readEntryCreatedAtMs(archivePath, metaPath),
        });
    }
    backups.sort((left, right) => right.createdAtMs - left.createdAtMs || right.name.localeCompare(left.name));
    return backups;
}

/**
 * 保留最新 keep 份，删除更旧的归档与 sidecar。单个删除失败不致命，以 warning 形式返回。
 */
export async function pruneLocalAutoBackups(
    directory: string,
    keep = LOCAL_AUTO_BACKUP_KEEP,
): Promise<{deleted: string[]; warnings: string[]}> {
    const backups = await listLocalAutoBackups(directory);
    const deleted: string[] = [];
    const warnings: string[] = [];
    for (const entry of backups.slice(Math.max(0, keep))) {
        try {
            await rm(entry.archivePath, {force: true});
            await rm(entry.metaPath, {force: true});
            deleted.push(entry.name);
        } catch (error) {
            warnings.push(`删除过期本地备份失败：${entry.name}（${error instanceof Error ? error.message : String(error)}）`);
        }
    }
    return {deleted, warnings};
}

export class LocalAutoBackupService {
    private readonly now: () => Date;
    private readonly keyring: Pick<BackupKeyringService, "activeKey">;
    private readonly logger: LocalAutoBackupLogger;
    private readonly keep: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight: Promise<LocalAutoBackupRunResult> | null = null;

    constructor(options: LocalAutoBackupServiceOptions = {}) {
        this.now = options.now ?? (() => new Date());
        this.keyring = options.keyring ?? useBackupKeyringService();
        this.logger = options.logger ?? appLogger;
        this.keep = options.keep ?? LOCAL_AUTO_BACKUP_KEEP;
    }

    /**
     * 挂载每日调度：启动即检查今日备份（缺失则补一份），随后按 intervalMs 周期做同一检查。
     * 定时器 unref，不阻止进程退出；重复调用幂等返回既有定时器。关停必须走 stopScheduler。
     */
    startScheduler(paths: RuntimePaths, options: {intervalMs?: number} = {}): ReturnType<typeof setInterval> {
        if (this.timer) {
            return this.timer;
        }
        void this.guardedEnsureDaily(paths, "startup");
        this.timer = setInterval(() => {
            void this.guardedEnsureDaily(paths, "schedule");
        }, options.intervalMs ?? LOCAL_AUTO_BACKUP_INTERVAL_MS);
        this.timer.unref?.();
        return this.timer;
    }

    /**
     * 停止调度并等待在途归档收尾，没有在进行中的任务时立即返回。
     */
    async stopScheduler(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.inFlight?.catch(() => undefined);
    }

    isSchedulerRunning(): boolean {
        return this.timer !== null;
    }

    /**
     * 今日（本地日期）尚无备份时执行一次；已有则返回 null。启动检查与周期 tick 共用这一去重语义。
     */
    async ensureDaily(paths: RuntimePaths, reason: LocalAutoBackupReason): Promise<LocalAutoBackupRunResult | null> {
        const existing = await listLocalAutoBackups(localAutoBackupDirectory(paths));
        const now = this.now();
        if (existing.some((entry) => isSameLocalDate(new Date(entry.createdAtMs), now))) {
            return null;
        }
        return this.runOnce(paths, reason);
    }

    /**
     * 立即执行一次本地自动备份；已有任务在途时共享同一 Promise，不并发打包。
     */
    runOnce(paths: RuntimePaths, reason: LocalAutoBackupReason): Promise<LocalAutoBackupRunResult> {
        if (this.inFlight) {
            return this.inFlight;
        }
        const run = this.doRunOnce(paths, reason);
        this.inFlight = run;
        const clear = () => {
            if (this.inFlight === run) {
                this.inFlight = null;
            }
        };
        run.then(clear, clear);
        return run;
    }

    private async doRunOnce(paths: RuntimePaths, reason: LocalAutoBackupReason): Promise<LocalAutoBackupRunResult> {
        const directory = localAutoBackupDirectory(paths);
        await mkdir(directory, {recursive: true});
        // 上次进程在打包中途被杀时残留的 staging；同一 State Root 单实例运行，此处无并发使用者
        await this.sweepStaging(directory);

        const encryptionKey = await this.keyring.activeKey(paths);
        const stagingDir = join(directory, `${STAGING_PREFIX}${randomUUID()}`);
        let archive;
        try {
            archive = await new BackupArchiveService().createArchive(paths, stagingDir, encryptionKey);
        } catch (error) {
            await rm(stagingDir, {recursive: true, force: true}).catch(() => undefined);
            throw error;
        }

        const createdAt = this.now();
        const name = `local-auto-${createdAt.toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
        const archivePath = join(directory, `${name}${ARCHIVE_SUFFIX}`);
        const metaPath = join(directory, `${name}${META_SUFFIX}`);
        // staging 与目标同目录，rename 原子落位，读者不会看到半成品归档
        await rename(archive.backupPath, archivePath);
        await rm(stagingDir, {recursive: true, force: true}).catch(() => undefined);

        const meta: LocalAutoBackupMeta = {
            formatVersion: 1,
            kind: "local-auto",
            createdAt: createdAt.toISOString(),
            sha256: archive.sha256,
            keyId: archive.keyId,
            encrypted: encryptionKey !== null,
            appVersion: archive.appVersion,
            fileSize: archive.fileSize,
            fileCount: archive.fileCount,
            reason,
        };
        await writeFileAtomic(metaPath, `${JSON.stringify(meta, null, 4)}\n`);

        const pruned = await pruneLocalAutoBackups(directory, this.keep);
        for (const warning of [...archive.warnings, ...pruned.warnings]) {
            void this.logger.warn("backup.local-auto.warning", {warning}, warning);
        }
        if (pruned.deleted.length > 0) {
            void this.logger.info(
                "backup.local-auto.pruned",
                {deleted: pruned.deleted},
                `本地自动备份保留最新 ${this.keep} 份，已删除 ${pruned.deleted.length} 份过期归档`,
            );
        }
        void this.logger.info(
            "backup.local-auto.done",
            {name: `${name}${ARCHIVE_SUFFIX}`, reason, encrypted: meta.encrypted, fileSize: meta.fileSize, fileCount: meta.fileCount},
            meta.encrypted ? "本地自动备份完成（已加密）" : "本地自动备份完成（未配置恢复码，归档未加密）",
        );
        return {archivePath, metaPath, meta, pruned: pruned.deleted};
    }

    private async sweepStaging(directory: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(directory, {withFileTypes: true});
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX)) {
                await rm(join(directory, entry.name), {recursive: true, force: true}).catch(() => undefined);
            }
        }
    }

    private async guardedEnsureDaily(paths: RuntimePaths, reason: LocalAutoBackupReason): Promise<void> {
        try {
            await this.ensureDaily(paths, reason);
        } catch (error) {
            void this.logger.error("backup.local-auto.failed", {reason}, error, "本地自动备份失败");
        }
    }
}

/**
 * 读取条目的创建时间：sidecar createdAt 优先，缺失/损坏退回归档 mtime。
 */
async function readEntryCreatedAtMs(archivePath: string, metaPath: string): Promise<number> {
    try {
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as {createdAt?: unknown};
        if (typeof meta.createdAt === "string") {
            const parsed = Date.parse(meta.createdAt);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    } catch {
        // 退回 mtime
    }
    return (await stat(archivePath)).mtimeMs;
}

function isSameLocalDate(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

/**
 * 原子写文本文件：临时文件 + rename，避免读者看到半截 meta。
 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, content, {encoding: "utf8", flag: "wx"});
        await rename(temporaryPath, path);
    } catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
        throw error;
    }
}

type GlobalLocalAutoBackup = {
    localAutoBackupService?: LocalAutoBackupService;
};

const globalForLocalAutoBackup = globalThis as typeof globalThis & GlobalLocalAutoBackup;

/**
 * 进程级单例：调度定时器与在途任务必须跨请求唯一。
 */
export function useLocalAutoBackupService(): LocalAutoBackupService {
    if (!globalForLocalAutoBackup.localAutoBackupService) {
        globalForLocalAutoBackup.localAutoBackupService = new LocalAutoBackupService();
    }
    return globalForLocalAutoBackup.localAutoBackupService;
}
