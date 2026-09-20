import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {basename, join} from "node:path";
import {createClient} from "@libsql/client";
import {strFromU8, unzipSync} from "fflate";
import {afterEach, describe, expect, it} from "vitest";
import {createRuntimePaths, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {BackupKeyringService} from "nbook/server/backup/backup-keyring-service";
import {
    createBackupCiphertextStream,
    createBackupEnvelopeDecipher,
    inspectBackupEnvelope,
    verifyBackupEnvelope,
} from "nbook/server/backup/backup-envelope";
import {
    listLocalAutoBackups,
    localAutoBackupDirectory,
    LocalAutoBackupService,
    type LocalAutoBackupLogger,
    type LocalAutoBackupMeta,
    type LocalAutoBackupRunResult,
    type LocalAutoBackupServiceOptions,
} from "nbook/server/backup/local-auto-backup-service";

// 本地自动备份端到端：假 State Root（含真 SQLite 与应排除物）→ 归档 + sidecar meta +
// 保留 7 份 + 加密/明文双分支 + 目标目录不被收集 + 调度定时器不悬挂。

const cleanupRoots: string[] = [];
const services: LocalAutoBackupService[] = [];

const silentLogger: LocalAutoBackupLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

afterEach(async () => {
    for (const service of services.splice(0)) {
        await service.stopScheduler();
    }
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

type Fixture = {
    root: string;
    paths: RuntimePaths;
    keyring: BackupKeyringService;
    activeKeyId: string | null;
};

/**
 * 假 State Root：正文 + 项目库（真 SQLite）+ 顶层 config.yaml，
 * 以及必须被排除且真实存在于收集范围内的 traces/trash/tmp 产物。
 */
async function makeFixture(options: {withKey: boolean}): Promise<Fixture> {
    const root = await mkdtemp(testHostPath("nbook-local-auto-"));
    cleanupRoots.push(root);
    await mkdir(join(root, "workspace", "novel-a", "manuscript"), {recursive: true});
    await mkdir(join(root, "workspace", "novel-a", ".nbook"), {recursive: true});
    await mkdir(join(root, "workspace", ".nbook", "agent", "traces", "run-1"), {recursive: true});
    await mkdir(join(root, "workspace", ".nbook", "trash", "deleted-novel", "manuscript"), {recursive: true});
    await writeFile(join(root, "workspace", "novel-a", "manuscript", "chapter-1.md"), "# 第一章\n正文内容");
    await writeFile(join(root, "workspace", "novel-a", "draft.tmp"), "temp");
    await writeFile(join(root, "workspace", ".nbook", "agent", "traces", "run-1", "trace.jsonl"), "trace");
    await writeFile(join(root, "workspace", ".nbook", "trash", "deleted-novel", "manuscript", "chapter-9.md"), "deleted");
    await writeFile(join(root, "config.yaml"), "auth:\n  enabled: true\n");

    const dbPath = join(root, "workspace", "novel-a", ".nbook", "project.sqlite");
    const client = createClient({url: `file:${dbPath.replaceAll("\\", "/")}`});
    await client.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)");
    await client.execute("INSERT INTO demo (name) VALUES ('hello')");
    client.close();

    const paths = createRuntimePaths({applicationRoot: absoluteFsPath(root), stateRoot: absoluteFsPath(root)});
    const keyring = new BackupKeyringService();
    let activeKeyId: string | null = null;
    if (options.withKey) {
        const prepared = await keyring.prepare(paths);
        await keyring.confirm(paths, prepared.key.keyId);
        activeKeyId = prepared.key.keyId;
    }
    return {root, paths, keyring, activeKeyId};
}

function makeService(options: LocalAutoBackupServiceOptions): LocalAutoBackupService {
    const service = new LocalAutoBackupService({logger: silentLogger, ...options});
    services.push(service);
    return service;
}

async function waitFor(assertion: () => Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await assertion()) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`等待超时：${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe("LocalAutoBackupService 归档产物", () => {
    it("有恢复码时产出加密归档与 sidecar meta，排除规则生效且 sha256 与文件一致", async () => {
        const fixture = await makeFixture({withKey: true});
        const service = makeService({keyring: fixture.keyring});
        const result = await service.runOnce(fixture.paths, "startup");

        const directory = localAutoBackupDirectory(fixture.paths);
        expect(result.archivePath.startsWith(`${directory}/`)).toBe(true);
        expect(basename(result.archivePath)).toMatch(/^local-auto-.*\.nbbackup$/);
        expect(result.meta.kind).toBe("local-auto");
        expect(result.meta.reason).toBe("startup");
        expect(result.meta.encrypted).toBe(true);
        expect(result.meta.keyId).toBe(fixture.activeKeyId);
        expect(result.meta.fileCount).toBe(3); // chapter-1.md + project.sqlite + config.yaml

        const sidecar = JSON.parse(await readFile(result.metaPath, "utf8")) as LocalAutoBackupMeta;
        expect(sidecar).toEqual(result.meta);

        const bytes = await readFile(result.archivePath);
        expect(bytes.byteLength).toBe(result.meta.fileSize);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(result.meta.sha256);
        expect(bytes.subarray(0, 8).toString("ascii")).toBe("NBOOKBK1");

        const activeKey = await fixture.keyring.activeKey(fixture.paths);
        if (!activeKey) {
            throw new Error("active key 缺失");
        }
        const envelope = await inspectBackupEnvelope(result.archivePath);
        expect(envelope.header.keyId).toBe(fixture.activeKeyId);
        await verifyBackupEnvelope(result.archivePath, envelope, activeKey);
        const chunks: Buffer[] = [];
        const decrypted = createBackupCiphertextStream(result.archivePath, envelope)
            .pipe(createBackupEnvelopeDecipher(envelope, activeKey));
        for await (const chunk of decrypted) {
            chunks.push(chunk as Buffer);
        }
        const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
        // 精确集合：traces/trash/tmp 在 fixture 磁盘上真实存在且位于收集范围内，
        // 缺席只能来自排除规则命中
        expect(Object.keys(entries).sort()).toEqual([
            "config.yaml",
            "nb-backup.json",
            "workspace/novel-a/.nbook/project.sqlite",
            "workspace/novel-a/manuscript/chapter-1.md",
        ]);
        const manifest = JSON.parse(strFromU8(entries["nb-backup.json"] as Uint8Array)) as {formatVersion: number; encryption: string};
        expect(manifest.formatVersion).toBe(2);
        expect(manifest.encryption).toBe("AES-256-GCM");
    });

    it("未配置恢复码时产出未加密裸 zip，meta 与 manifest 明确记录", async () => {
        const fixture = await makeFixture({withKey: false});
        const service = makeService({keyring: fixture.keyring});
        const result = await service.runOnce(fixture.paths, "schedule");

        expect(result.meta.kind).toBe("local-auto");
        expect(result.meta.encrypted).toBe(false);
        expect(result.meta.keyId).toBe("none");

        const bytes = await readFile(result.archivePath);
        // 裸 zip 魔数 PK，不是 NBOOKBK1 envelope
        expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
        const entries = unzipSync(new Uint8Array(bytes));
        const names = Object.keys(entries).sort();
        expect(names).toContain("workspace/novel-a/manuscript/chapter-1.md");
        expect(names).toContain("workspace/novel-a/.nbook/project.sqlite");
        expect(names.some((name) => name.includes("trash") || name.includes("traces"))).toBe(false);
        const manifest = JSON.parse(strFromU8(entries["nb-backup.json"] as Uint8Array)) as {encryption: string};
        expect(manifest.encryption).toBe("none");
    });
});

describe("LocalAutoBackupService 保留策略", () => {
    it("连续产出 8 份后只留最新 7 份，归档与 sidecar 成对删除", async () => {
        const fixture = await makeFixture({withKey: false});
        let currentNow = new Date("2026-09-10T08:00:00");
        const service = makeService({now: () => currentNow, keyring: fixture.keyring});

        const results: LocalAutoBackupRunResult[] = [];
        for (let day = 10; day <= 17; day += 1) {
            currentNow = new Date(`2026-09-${day}T08:00:00`);
            results.push(await service.runOnce(fixture.paths, "schedule"));
        }

        const directory = localAutoBackupDirectory(fixture.paths);
        const remaining = await listLocalAutoBackups(directory);
        expect(remaining.map((entry) => entry.name).sort()).toEqual(
            results.slice(1).map((run) => basename(run.archivePath)).sort(),
        );
        // 最旧一份的归档与 meta 都被删除
        await expect(stat(results[0]!.archivePath)).rejects.toThrow();
        await expect(stat(results[0]!.metaPath)).rejects.toThrow();
        expect(results[7]!.pruned).toContain(basename(results[0]!.archivePath));

        const files = (await readdir(directory, {withFileTypes: true}))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);
        expect(files.filter((name) => name.endsWith(".nbbackup"))).toHaveLength(7);
        expect(files.filter((name) => name.endsWith(".meta.json"))).toHaveLength(7);
        // 无 staging 残留
        expect((await readdir(directory, {withFileTypes: true})).some((entry) => entry.name.startsWith(".staging-"))).toBe(false);
    });
});

describe("LocalAutoBackupService 目录边界", () => {
    it("目标目录在收集范围之外，连续备份不会把备份打进备份", async () => {
        const fixture = await makeFixture({withKey: false});
        const service = makeService({keyring: fixture.keyring});

        const directory = localAutoBackupDirectory(fixture.paths);
        expect(directory.startsWith(`${fixture.paths.workspaceRoot}/`)).toBe(false);

        const first = await service.runOnce(fixture.paths, "startup");
        const second = await service.runOnce(fixture.paths, "schedule");
        expect(second.meta.fileCount).toBe(first.meta.fileCount);

        const entries = unzipSync(new Uint8Array(await readFile(second.archivePath)));
        expect(Object.keys(entries).some((name) => name.includes("backups") || name.includes("local-auto"))).toBe(false);
    });
});

describe("LocalAutoBackupService 调度", () => {
    it("ensureDaily 同日只补一份，跨日再补", async () => {
        const fixture = await makeFixture({withKey: false});
        let currentNow = new Date("2026-09-20T08:00:00");
        const service = makeService({now: () => currentNow, keyring: fixture.keyring});
        const directory = localAutoBackupDirectory(fixture.paths);

        expect(await service.ensureDaily(fixture.paths, "startup")).not.toBeNull();
        expect(await service.ensureDaily(fixture.paths, "startup")).toBeNull();
        expect((await listLocalAutoBackups(directory)).length).toBe(1);

        currentNow = new Date("2026-09-21T08:00:00");
        expect(await service.ensureDaily(fixture.paths, "schedule")).not.toBeNull();
        expect((await listLocalAutoBackups(directory)).length).toBe(2);
    });

    it("定时器 unref、启动补齐、每日 tick 与 stop 后不再触发", async () => {
        const fixture = await makeFixture({withKey: false});
        let currentNow = new Date("2026-09-20T08:00:00");
        const service = makeService({now: () => currentNow, keyring: fixture.keyring});
        const directory = localAutoBackupDirectory(fixture.paths);

        const timer = service.startScheduler(fixture.paths, {intervalMs: 25});
        expect(service.isSchedulerRunning()).toBe(true);
        expect(timer.hasRef?.()).toBe(false);
        // 重复 start 幂等，不叠加定时器
        expect(service.startScheduler(fixture.paths, {intervalMs: 25})).toBe(timer);

        await waitFor(async () => (await listLocalAutoBackups(directory)).length === 1, "启动补齐备份");

        currentNow = new Date("2026-09-21T08:00:00");
        await waitFor(async () => (await listLocalAutoBackups(directory)).length === 2, "次日 tick 备份");

        await service.stopScheduler();
        expect(service.isSchedulerRunning()).toBe(false);

        // stop 后跨日也不再产生新备份：定时器确实被清掉，测试退出不悬挂
        currentNow = new Date("2026-09-22T08:00:00");
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect((await listLocalAutoBackups(directory)).length).toBe(2);
    });
});
