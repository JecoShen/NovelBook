import {access, mkdir, mkdtemp, open, readdir, readFile, rename, rm, utimes, writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectManifestAdapter} from "nbook/server/workspace-files/project-lifecycle-manifest";
import {
    DEFAULT_PROJECT_TRASH_RETENTION_MS,
    PROJECT_TRASH_MARKER_FILE,
    ProjectTrashStore,
    type ProjectTrashMarker,
} from "nbook/server/workspace-files/project-trash";

const roots: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function baseAdapter(overrides: Partial<ProjectManifestAdapter> = {}): ProjectManifestAdapter {
    return {
        access,
        mkdir,
        open,
        readFile,
        rename,
        rm,
        ...overrides,
    };
}

async function createTombstone(workspaceRoot: string, name: string): Promise<string> {
    const tombstoneRoot = path.join(workspaceRoot, ".nbook", "deleted-projects", name);
    await mkdir(path.join(tombstoneRoot, "manuscript"), {recursive: true});
    await writeFile(path.join(tombstoneRoot, "project.yaml"), "kind: novel\ntitle: Gone\nsummary: \"\"\n", "utf8");
    await writeFile(path.join(tombstoneRoot, "manuscript", "chapter.md"), "# Chapter\n", "utf8");
    return tombstoneRoot;
}

async function readMarker(entryRoot: string): Promise<ProjectTrashMarker> {
    return JSON.parse(await readFile(path.join(entryRoot, PROJECT_TRASH_MARKER_FILE), "utf8")) as ProjectTrashMarker;
}

describe("ProjectTrashStore", () => {
    it("adopt把tombstone迁入回收区并写自描述marker", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        const tombstoneRoot = await createTombstone(workspaceRoot, "v1-source");
        const deletedAtMs = 1_800_000_000_000;
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => deletedAtMs});

        const entry = await store.adopt({
            tombstoneRoot: absoluteFsPath(tombstoneRoot),
            projectRoot: "my-novel",
        });

        await expect(access(tombstoneRoot)).rejects.toMatchObject({code: "ENOENT"});
        expect(entry.hasPayload).toBe(true);
        expect(entry.projectRoot).toBe("my-novel");
        expect(entry.deletedAtMs).toBe(deletedAtMs);
        expect(await readFile(path.join(entry.payloadRoot, "project.yaml"), "utf8"))
            .toBe("kind: novel\ntitle: Gone\nsummary: \"\"\n");
        expect(await readFile(path.join(entry.payloadRoot, "manuscript", "chapter.md"), "utf8"))
            .toBe("# Chapter\n");
        const marker = await readMarker(entry.entryRoot);
        expect(marker).toEqual({
            schemaVersion: 1,
            kind: "nbook-project-trash-entry",
            projectRoot: "my-novel",
            deletedAt: new Date(deletedAtMs).toISOString(),
            deletedAtMs,
            tombstoneName: "v1-source",
        });
    });

    it("adopt失败保留原tombstone且不留entry壳", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        const tombstoneRoot = await createTombstone(workspaceRoot, "v1-kept");
        const adoptFailure = Object.assign(new Error("injected adopt mkdir failure"), {code: "EIO"});
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {
            adapter: baseAdapter({
                mkdir: async (filePath, options) => {
                    if (filePath.replaceAll("\\", "/").includes("/.nbook/trash/")) {
                        throw adoptFailure;
                    }
                    return mkdir(filePath, options);
                },
            }),
        });

        await expect(store.adopt({tombstoneRoot: absoluteFsPath(tombstoneRoot), projectRoot: "my-novel"}))
            .rejects.toBe(adoptFailure);

        expect(await readFile(path.join(tombstoneRoot, "project.yaml"), "utf8")).toContain("title: Gone");
        const trashRoot = path.join(workspaceRoot, ".nbook", "trash");
        await expect(readdir(trashRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("sweep清除超龄回收条目并保留新条目", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        let currentNow = 1_800_000_000_000;
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const oldEntry = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-old")),
            projectRoot: "old-novel",
        });
        currentNow += 31 * DAY_MS;
        const freshEntry = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-fresh")),
            projectRoot: "fresh-novel",
        });

        const report = await store.sweep();

        expect(report.issues).toEqual([]);
        expect(report.removed).toHaveLength(1);
        await expect(access(oldEntry.entryRoot)).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(freshEntry.entryRoot)).resolves.toBeUndefined();
    });

    it("sweep对marker损坏的条目按目录mtime参与aging", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        let currentNow = 1_800_000_000_000;
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const entry = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-corrupt")),
            projectRoot: "corrupt-novel",
        });
        await writeFile(path.join(entry.entryRoot, PROJECT_TRASH_MARKER_FILE), "not-json{", "utf8");
        const agedAt = new Date(currentNow - 31 * DAY_MS);
        await utimes(entry.entryRoot, agedAt, agedAt);

        const report = await store.sweep();

        expect(report.issues).toEqual([]);
        expect(report.removed).toHaveLength(1);
        await expect(access(entry.entryRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("sweep对不存在的回收区与tombstone目录返回空报告", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));

        const report = await store.sweep({
            tombstoneParent: absoluteFsPath(path.join(workspaceRoot, ".nbook", "deleted-projects")),
        });

        expect(report).toEqual({removed: [], issues: []});
    });

    it("sweep按同一保留期兜底清除遗留tombstone", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        // now必须贴近真实文件系统mtime：tombstone aging以目录mtime为准，伪造远期now会把新建条目误判为超龄。
        const currentNow = Date.now();
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const oldTombstone = await createTombstone(workspaceRoot, "v1-orphan-old");
        const agedAt = new Date(currentNow - DEFAULT_PROJECT_TRASH_RETENTION_MS - DAY_MS);
        await utimes(oldTombstone, agedAt, agedAt);
        const freshTombstone = await createTombstone(workspaceRoot, "v1-orphan-fresh");

        const report = await store.sweep({
            tombstoneParent: absoluteFsPath(path.join(workspaceRoot, ".nbook", "deleted-projects")),
        });

        expect(report.issues).toEqual([]);
        expect(report.removed).toEqual([".nbook/deleted-projects/v1-orphan-old"]);
        await expect(access(oldTombstone)).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(path.join(freshTombstone, "project.yaml"))).resolves.toBeUndefined();
    });

    it("findByProjectRoot返回最新可恢复条目并跳过无payload残壳", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        let currentNow = 1_800_000_000_000;
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const restorable = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-restorable")),
            projectRoot: "my-novel",
        });
        // 同名但更新的marker-only残壳（例如restore提交后entry壳回收失败残留）不得被当作可恢复条目。
        currentNow += 1000;
        const shellRoot = path.join(workspaceRoot, ".nbook", "trash", "v1-shell");
        await mkdir(shellRoot, {recursive: true});
        await writeFile(path.join(shellRoot, PROJECT_TRASH_MARKER_FILE), `${JSON.stringify({
            schemaVersion: 1,
            kind: "nbook-project-trash-entry",
            projectRoot: "my-novel",
            deletedAt: new Date(currentNow).toISOString(),
            deletedAtMs: currentNow,
            tombstoneName: "v1-restorable",
        })}\n`, "utf8");

        const found = await store.findByProjectRoot("my-novel");

        expect(found?.entryRoot).toBe(restorable.entryRoot);
        expect(found?.hasPayload).toBe(true);
        await expect(store.findByProjectRoot("unknown-novel")).resolves.toBeNull();
    });

    it("listEntries跳过非v1-前缀的条目", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        const trashRoot = path.join(workspaceRoot, ".nbook", "trash");
        await mkdir(path.join(trashRoot, "random-dir"), {recursive: true});
        await writeFile(path.join(trashRoot, "note.txt"), "stray", "utf8");
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));

        await expect(store.listEntries()).resolves.toEqual([]);
    });

    it("sweep单条目rm失败记录issue且不影响其它超龄条目", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-trash-"));
        roots.push(workspaceRoot);
        let currentNow = 1_800_000_000_000;
        const rmFailure = Object.assign(new Error("injected sweep rm failure"), {code: "EPERM"});
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const blocked = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-blocked")),
            projectRoot: "blocked-novel",
        });
        const removable = await store.adopt({
            tombstoneRoot: absoluteFsPath(await createTombstone(workspaceRoot, "v1-removable")),
            projectRoot: "removable-novel",
        });
        currentNow += 31 * DAY_MS;
        const failingStore = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {
            now: () => currentNow,
            adapter: baseAdapter({
                rm: async (filePath, options) => {
                    if (filePath === blocked.entryRoot) {
                        throw rmFailure;
                    }
                    return rm(filePath, options);
                },
            }),
        });

        const report = await failingStore.sweep();

        expect(report.removed).toHaveLength(1);
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0]).toMatchObject({entryRoot: blocked.entryRoot, phase: "remove", error: rmFailure});
        await expect(access(blocked.entryRoot)).resolves.toBeUndefined();
        await expect(access(removable.entryRoot)).rejects.toMatchObject({code: "ENOENT"});
    });
});
