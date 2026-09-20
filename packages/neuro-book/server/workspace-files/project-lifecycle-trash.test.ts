import {access, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    ProjectLifecycle,
    projectWorkspaceRef,
    type ProjectLifecycleWatcherAdapter,
} from "nbook/server/workspace-files/project-lifecycle";
import {ProjectTrashStore} from "nbook/server/workspace-files/project-trash";

vi.mock("chokidar", () => ({
    watch: () => {
        const watcher = {
            on: () => watcher,
            once: (eventName: string, listener: () => void) => {
                if (eventName === "ready") {
                    queueMicrotask(listener);
                }
                return watcher;
            },
            close: async () => undefined,
        };
        return watcher;
    },
}));

const roots: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 与主Lifecycle测试同一模式的inert watcher，隔离真实文件系统事件。 */
function inertProjectLifecycleWatcher(): ProjectLifecycleWatcherAdapter {
    return {
        open: () => ({
            ready: Promise.resolve(),
            close: async () => undefined,
        }),
    };
}

async function createProjectFixture(workspaceRoot: string, name: string, title: string): Promise<void> {
    const projectRoot = path.join(workspaceRoot, name);
    await mkdir(path.join(projectRoot, "manuscript"), {recursive: true});
    await writeFile(path.join(projectRoot, "project.yaml"), `kind: novel\ntitle: ${title}\nsummary: ""\n`, "utf8");
    await writeFile(path.join(projectRoot, "manuscript", "chapter.md"), "# Chapter\n", "utf8");
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("waitFor超时：条件未在限定时间内满足");
}

describe("ProjectLifecycle 回收区", () => {
    it("delete提交后Project迁入回收区并保留完整内容与自描述marker", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "trashed-novel", "Trashed Novel");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const result = await lifecycle.delete(projectWorkspaceRef("trashed-novel"));
            expect(result.projectRoot).toBe("trashed-novel");
            expect((await lifecycle.readProjects()).projects).toEqual([]);
        } finally {
            await lifecycle.close();
        }

        await expect(access(path.join(workspaceRoot, "trashed-novel"))).rejects.toMatchObject({code: "ENOENT"});
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));
        const entries = await store.listEntries();
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.hasPayload).toBe(true);
        expect(entry.projectRoot).toBe("trashed-novel");
        expect(entry.marker).toMatchObject({
            schemaVersion: 1,
            kind: "nbook-project-trash-entry",
            projectRoot: "trashed-novel",
            deletedAtMs: expect.any(Number),
        });
        expect(entry.marker?.tombstoneName).toMatch(/^v1-/u);
        expect(await readFile(path.join(entry.payloadRoot, "project.yaml"), "utf8"))
            .toBe('kind: novel\ntitle: Trashed Novel\nsummary: ""\n');
        expect(await readFile(path.join(entry.payloadRoot, "manuscript", "chapter.md"), "utf8"))
            .toBe("# Chapter\n");
        const tombstones = (await readdir(path.join(workspaceRoot, ".nbook", "deleted-projects")))
            .filter((name) => name.startsWith("v1-"));
        expect(tombstones).toEqual([]);
    });

    it("回收区条目恢复后Project跨Lifecycle generation重新可用", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "restored-novel", "Restored Novel");
        const ref = projectWorkspaceRef("restored-novel");
        const first = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        try {
            await first.delete(ref);
        } finally {
            await first.close();
        }

        // 换一个Lifecycle generation恢复，验证回收区事实不依赖进程内token。
        const second = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        try {
            const result = await second.restoreDeleted(ref);
            expect(result).toEqual({
                revision: expect.any(Number),
                projectRoot: "restored-novel",
            });
            const snapshot = await second.readProjects();
            expect(snapshot.projects.map((project) => project.projectRoot)).toEqual(["restored-novel"]);
            expect(snapshot.projects[0]?.title).toBe("Restored Novel");
            const opened = await second.prepareOpen(ref);
            await opened.occupancy.release();
        } finally {
            await second.close();
        }

        expect(await readFile(path.join(workspaceRoot, "restored-novel", "manuscript", "chapter.md"), "utf8"))
            .toBe("# Chapter\n");
        await expect(new ProjectTrashStore(absoluteFsPath(workspaceRoot)).listEntries()).resolves.toEqual([]);
    });

    it("restoreDeleted对不存在的回收条目返回PROJECT_NOT_FOUND", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            await expect(lifecycle.restoreDeleted(projectWorkspaceRef("missing-novel"))).rejects.toMatchObject({
                code: "PROJECT_NOT_FOUND",
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("restoreDeleted在原位置已被新Project占用时返回PROJECT_EXISTS且不覆盖现存数据", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "taken-novel", "Old Taken");
        const ref = projectWorkspaceRef("taken-novel");
        const first = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        try {
            await first.delete(ref);
        } finally {
            await first.close();
        }

        const second = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
            templateAdapter: {materialize: async () => undefined},
        });
        try {
            await second.create({ref, title: "New Taken"});
            await expect(second.restoreDeleted(ref)).rejects.toMatchObject({
                code: "PROJECT_EXISTS",
                operation: "restore",
                committed: false,
                statusCode: 409,
            });
            const snapshot = await second.readProjects();
            expect(snapshot.projects.map((project) => project.title)).toEqual(["New Taken"]);
        } finally {
            await second.close();
        }

        // restore被拒绝后回收条目仍保留，现存Project内容未被覆盖。
        expect(await readFile(path.join(workspaceRoot, "taken-novel", "project.yaml"), "utf8"))
            .toContain("title: New Taken");
        const entries = await new ProjectTrashStore(absoluteFsPath(workspaceRoot)).listEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.hasPayload).toBe(true);
    });

    it("周期清扫清除超龄回收条目并保留新条目", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "old-novel", "Old Novel");
        await createProjectFixture(workspaceRoot, "fresh-novel", "Fresh Novel");
        let currentNow = Date.now();
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => currentNow,
            trashSweepIntervalMs: 40,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));

        try {
            await lifecycle.delete(projectWorkspaceRef("old-novel"));
            await waitFor(async () => (await store.listEntries()).length === 1);

            currentNow += 31 * DAY_MS;
            await waitFor(async () => (await store.listEntries()).length === 0);

            await lifecycle.delete(projectWorkspaceRef("fresh-novel"));
            await waitFor(async () => (await store.listEntries()).length === 1);
            // 越过数个清扫周期后新条目仍保留。
            await new Promise((resolve) => setTimeout(resolve, 200));
            const entries = await store.listEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0]?.projectRoot).toBe("fresh-novel");
        } finally {
            await lifecycle.close();
        }
    });

    it("readTrashedProjects按删除倒序返回可恢复条目投影，恢复后从列表消失", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "older-novel", "Older");
        await createProjectFixture(workspaceRoot, "newer-novel", "Newer");
        let currentNow = Date.now();
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => currentNow,
            trashRetentionMs: 10 * DAY_MS,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));
        try {
            const deletedOlderAtMs = currentNow;
            await lifecycle.delete(projectWorkspaceRef("older-novel"));
            // delete提交后tombstone迁入回收区是后台best-effort；等marker落地再断言投影。
            await waitFor(async () => (await store.listEntries())
                .some((entry) => entry.projectRoot === "older-novel" && entry.marker !== null));
            currentNow += DAY_MS;
            const deletedNewerAtMs = currentNow;
            await lifecycle.delete(projectWorkspaceRef("newer-novel"));
            await waitFor(async () => (await store.listEntries())
                .some((entry) => entry.projectRoot === "newer-novel" && entry.marker !== null));

            const listed = await lifecycle.readTrashedProjects();
            expect(listed).toEqual([
                {
                    projectRoot: "newer-novel",
                    deletedAt: new Date(deletedNewerAtMs).toISOString(),
                    deletedAtMs: deletedNewerAtMs,
                    expiresAtMs: deletedNewerAtMs + 10 * DAY_MS,
                },
                {
                    projectRoot: "older-novel",
                    deletedAt: new Date(deletedOlderAtMs).toISOString(),
                    deletedAtMs: deletedOlderAtMs,
                    expiresAtMs: deletedOlderAtMs + 10 * DAY_MS,
                },
            ]);

            await lifecycle.restoreDeleted(projectWorkspaceRef("newer-novel"));
            const remaining = await lifecycle.readTrashedProjects();
            expect(remaining.map((entry) => entry.projectRoot)).toEqual(["older-novel"]);
        } finally {
            await lifecycle.close();
        }
    });

    it("readTrashedProjects跳过无payload残壳与非法projectRoot条目", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        await createProjectFixture(workspaceRoot, "kept-novel", "Kept");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot));

        try {
            await lifecycle.delete(projectWorkspaceRef("kept-novel"));
            // 等delete的后台回收迁移落地，再混入两个不可恢复条目。
            await waitFor(async () => (await store.listEntries())
                .some((entry) => entry.projectRoot === "kept-novel" && entry.marker !== null));
            // 无payload残壳：entry目录里只有marker，restore无从下手。
            const shellRoot = path.join(workspaceRoot, ".nbook", "trash", "v1-shell");
            await mkdir(shellRoot, {recursive: true});
            await writeFile(path.join(shellRoot, "trash.json"), `${JSON.stringify({
                schemaVersion: 1,
                kind: "nbook-project-trash-entry",
                projectRoot: "shell-novel",
                deletedAt: new Date().toISOString(),
                deletedAtMs: Date.now(),
                tombstoneName: "v1-shell",
            })}\n`, "utf8");
            // marker里的projectRoot不再是一级合法目录名（历史上由旧版本写入）。
            const legacyTombstone = path.join(workspaceRoot, ".nbook", "deleted-projects", "v1-legacy");
            await mkdir(legacyTombstone, {recursive: true});
            await writeFile(path.join(legacyTombstone, "project.yaml"), "kind: novel\ntitle: Legacy\nsummary: \"\"\n", "utf8");
            await store.adopt({tombstoneRoot: absoluteFsPath(legacyTombstone), projectRoot: "bad/name"});

            const listed = await lifecycle.readTrashedProjects();
            expect(listed.map((entry) => entry.projectRoot)).toEqual(["kept-novel"]);
        } finally {
            await lifecycle.close();
        }
    });

    it("close停止清扫定时器，已超龄条目不再被清除", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-lifecycle-trash-"));
        roots.push(workspaceRoot);
        let currentNow = Date.now();
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => currentNow,
            trashRetentionMs: 1_000,
            trashSweepIntervalMs: 30,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        await lifecycle.readProjects();
        await lifecycle.close();

        // close之后种入一条按当前时间已超龄的回收条目；若定时器未被清理它会被删掉。
        const tombstoneRoot = path.join(workspaceRoot, ".nbook", "deleted-projects", "v1-late");
        await mkdir(tombstoneRoot, {recursive: true});
        await writeFile(path.join(tombstoneRoot, "project.yaml"), "kind: novel\ntitle: Late\nsummary: \"\"\n", "utf8");
        const store = new ProjectTrashStore(absoluteFsPath(workspaceRoot), {now: () => currentNow});
        const entry = await store.adopt({
            tombstoneRoot: absoluteFsPath(tombstoneRoot),
            projectRoot: "late-novel",
        });
        currentNow += 10_000;
        await new Promise((resolve) => setTimeout(resolve, 200));

        await expect(access(entry.entryRoot)).resolves.toBeUndefined();
    });
});
