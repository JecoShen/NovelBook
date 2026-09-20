import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {createClient} from "@libsql/client";
import {describe, expect, it} from "vitest";
import {
    assertProjectWorkspaceDirectory,
    initProjectDatabaseAtRoot,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

describe("assertProjectWorkspaceDirectory", () => {
    it("Project root 指向不存在目录时返回稳定 404", async () => {
        const workspaceRoot = await fs.mkdtemp(testHostPath("nbook-project-workspace-root-"));
        const projectRoot = `missing-${randomUUID()}`;
        try {
            await expect(assertProjectWorkspaceDirectory(
                absoluteFsPath(workspaceRoot),
                projectWorkspaceRef(projectRoot),
            )).rejects.toMatchObject({
                statusCode: 404,
                message: "Project Workspace 不存在",
            });
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });
});

describe("initProjectDatabaseAtRoot", () => {
    it("会把旧 StoryPlot 备份并合并到 Scene，同时清理 plot ref", async () => {
        const projectRoot = await fs.mkdtemp(testHostPath("nbook-project-migration-"));
        try {
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createLegacyPlotSchema(client);
            } finally {
                client.close();
            }

            await initProjectDatabaseAtRoot(projectRoot);

            const migratedClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const sceneColumns = await migratedClient.execute(`PRAGMA table_info("StoryScene")`);
                expect(sceneColumns.rows.map((row) => String(row.name))).toEqual(expect.arrayContaining([
                    "startInstant",
                    "endInstant",
                    "subjectIdsJson",
                    "locationSubjectId",
                ]));

                const plotTable = await migratedClient.execute(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'StoryPlot'`);
                expect(plotTable.rows).toHaveLength(0);

                const scene = (await migratedClient.execute(`SELECT "summary", "purpose", "writingTip" FROM "StoryScene" WHERE "id" = 1`)).rows[0];
                expect(String(scene.summary)).toContain("## 原 Plot 摘要");
                expect(String(scene.summary)).toContain("- #0 conflict：旧 Plot 摘要");
                expect(String(scene.purpose)).toContain("## 原 Plot 效果");
                expect(String(scene.purpose)).toContain("- #0：旧 Plot 效果");
                expect(String(scene.writingTip)).toContain("## 原 Plot 写作提示");
                expect(String(scene.writingTip)).toContain("- #0：旧 Plot 提示");

                const refs = await migratedClient.execute(`SELECT "rawTarget", "targetKind" FROM "StorySceneRef" ORDER BY "id"`);
                expect(refs.rows).toEqual([
                    expect.objectContaining({rawTarget: "scene://2", targetKind: "scene"}),
                ]);
            } finally {
                migratedClient.close();
            }

            const backupText = await fs.readFile(path.join(projectRoot, ".nbook", "story-plot-backup.json"), "utf-8");
            expect(backupText).toContain("\"sourceTable\": \"StoryPlot\"");
            expect(backupText).toContain("旧 Plot 摘要");
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("老库 chapterPath 迁移为 chapterId 后数据完整并写入 schemaVersion", async () => {
        const projectRoot = await fs.mkdtemp(testHostPath("nbook-project-migration-chapter-"));
        try {
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createLegacyChapterPathSchema(client);
            } finally {
                client.close();
            }

            await initProjectDatabaseAtRoot(projectRoot);

            const migratedClient = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const sceneColumns = await migratedClient.execute(`PRAGMA table_info("StoryScene")`);
                const sceneColumnNames = sceneColumns.rows.map((row) => String(row.name));
                expect(sceneColumnNames).toContain("chapterId");
                expect(sceneColumnNames).not.toContain("chapterPath");

                const chapters = await migratedClient.execute(`SELECT "storyId", "sortOrder", "name", "title" FROM "StoryChapter" ORDER BY "id"`);
                expect(chapters.rows).toEqual([
                    expect.objectContaining({storyId: 1, sortOrder: 1, name: "001-volume-001-chapter", title: "001-chapter"}),
                    expect.objectContaining({storyId: 1, sortOrder: 2, name: "001-volume-002-chapter", title: "002-chapter"}),
                ]);

                const scenes = await migratedClient.execute(`SELECT "id", "title", "summary", "chapterId" FROM "StoryScene" ORDER BY "id"`);
                expect(scenes.rows).toEqual([
                    expect.objectContaining({id: 1, title: "场景一", summary: "场景一摘要", chapterId: 1}),
                    expect.objectContaining({id: 2, title: "场景二", summary: "", chapterId: 2}),
                    expect.objectContaining({id: 3, title: "场景三", summary: "", chapterId: 1}),
                ]);

                const version = await migratedClient.execute(`SELECT "value" FROM "ProjectMetadata" WHERE "key" = 'schemaVersion'`);
                expect(version.rows).toEqual([expect.objectContaining({value: "1"})]);
            } finally {
                migratedClient.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("重建最深处失败时整体回滚：原表与索引保留、无 _next 残留、schemaVersion 未推进", async () => {
        const projectRoot = await fs.mkdtemp(testHostPath("nbook-project-migration-rollback-"));
        try {
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            await fs.mkdir(path.dirname(databasePath), {recursive: true});
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await createRollbackFixtureSchema(client);
            } finally {
                client.close();
            }

            await expect(initProjectDatabaseAtRoot(projectRoot)).rejects.toThrow(/UNIQUE/);

            const inspected = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                // DROP/RENAME 已回滚：原表结构与数据保持可用。
                const sceneColumns = (await inspected.execute(`PRAGMA table_info("StoryScene")`)).rows.map((row) => String(row.name));
                expect(sceneColumns).toContain("chapterPath");
                const scenes = await inspected.execute(`SELECT "id", "title" FROM "StoryScene" ORDER BY "id"`);
                expect(scenes.rows).toEqual([
                    expect.objectContaining({id: 1, title: "场景一"}),
                    expect.objectContaining({id: 2, title: "场景二"}),
                ]);

                // 失败前被 DROP 的占位索引由回滚恢复(仍是非唯一)。
                const indexList = await inspected.execute(`PRAGMA index_list("StoryScene")`);
                expect(indexList.rows).toEqual([
                    expect.objectContaining({name: "StoryScene_threadId_threadSortOrder_key", unique: 0}),
                ]);

                // 无 _next 残表；事务内新建的表与索引整体回滚。
                const tables = (await inspected.execute(`SELECT name FROM sqlite_schema WHERE type = 'table'`)).rows.map((row) => String(row.name));
                expect(tables).not.toContain("StoryScene_next");
                expect(tables).not.toContain("StorySceneRef_next");
                expect(tables).not.toContain("StoryChapter");
                // ProjectMetadata 在事务内才创建：schemaVersion 未被推进。
                expect(tables).not.toContain("ProjectMetadata");

                // 迁移前已有的表保持原样。
                const stories = await inspected.execute(`SELECT "title" FROM "Story"`);
                expect(stories.rows).toEqual([expect.objectContaining({title: "故事"})]);
            } finally {
                inspected.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("schemaVersion 高于产品支持版本时拒绝迁移且不改动库", async () => {
        const projectRoot = await fs.mkdtemp(testHostPath("nbook-project-migration-version-"));
        try {
            // 先按当前版本建成库，再手工把版本戳改成未来版本。
            await initProjectDatabaseAtRoot(projectRoot);
            const databasePath = path.join(projectRoot, ".nbook", "project.sqlite");
            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                await client.execute(`UPDATE "ProjectMetadata" SET "value" = '2' WHERE "key" = 'schemaVersion'`);
            } finally {
                client.close();
            }

            await expect(initProjectDatabaseAtRoot(projectRoot)).rejects.toMatchObject({statusCode: 409});

            const inspected = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const version = await inspected.execute(`SELECT "value" FROM "ProjectMetadata" WHERE "key" = 'schemaVersion'`);
                expect(version.rows).toEqual([expect.objectContaining({value: "2"})]);
                const sceneTable = await inspected.execute(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'StoryScene'`);
                expect(sceneTable.rows).toHaveLength(1);
            } finally {
                inspected.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });
});

/**
 * Windows 上 libsql native handle 可能延迟释放，测试清理需要短重试。
 */
async function removeTempProject(projectRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            collectReleasedSqliteHandles({force: true});
            await fs.rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

/**
 * 构造 Task 78 前的最小旧 Plot schema。
 */
async function createLegacyPlotSchema(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "Story" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "title" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryThread" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "storyPhaseId" INTEGER, "sortOrder" INTEGER NOT NULL, "name" TEXT NOT NULL, "title" TEXT NOT NULL, "isMainThread" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "tags" TEXT NOT NULL DEFAULT '[]', "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryScene" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "threadId" INTEGER NOT NULL, "chapterPath" TEXT, "threadSortOrder" INTEGER NOT NULL, "chapterSortOrder" INTEGER, "title" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "purpose" TEXT, "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryPlot" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "sceneId" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL, "kind" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "effect" TEXT, "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StorySceneRef" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "sceneId" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL, "relation" TEXT NOT NULL, "rawTarget" TEXT NOT NULL, "targetKind" TEXT NOT NULL, "targetThreadId" INTEGER, "targetSceneId" INTEGER, "targetPlotId" INTEGER, "visibility" TEXT NOT NULL DEFAULT 'author', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`INSERT INTO "Story" ("id", "title", "summary") VALUES (1, '故事', '')`);
    await client.execute(`INSERT INTO "StoryThread" ("id", "storyId", "sortOrder", "name", "title") VALUES (1, 1, 0, 'main', '主线')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "threadSortOrder", "title", "summary", "purpose", "writingTip") VALUES (1, 1, 1, 0, '场景一', '原 Scene 摘要', '原 Scene 目的', '原 Scene 提示')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "threadSortOrder", "title", "summary") VALUES (2, 1, 1, 1, '场景二', '')`);
    await client.execute(`INSERT INTO "StoryPlot" ("id", "sceneId", "sortOrder", "kind", "summary", "effect", "writingTip") VALUES (1, 1, 0, 'conflict', '旧 Plot 摘要', '旧 Plot 效果', '旧 Plot 提示')`);
    await client.execute(`INSERT INTO "StorySceneRef" ("id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind", "targetPlotId") VALUES (1, 1, 0, 'foreshadows', 'plot://1', 'plot', 1)`);
    await client.execute(`INSERT INTO "StorySceneRef" ("id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind", "targetSceneId") VALUES (2, 1, 1, 'pays_off', 'scene://2', 'scene', 2)`);
}

/** chapterPath 时代的最小 StoryScene 建表(与 createLegacyPlotSchema 同一代的表结构)。 */
const LEGACY_STORY_SCENE_DDL = `CREATE TABLE "StoryScene" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "threadId" INTEGER NOT NULL, "chapterPath" TEXT, "threadSortOrder" INTEGER NOT NULL, "chapterSortOrder" INTEGER, "title" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "purpose" TEXT, "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`;

/**
 * 构造 chapterPath 时代的老库：两个 chapterPath 分属两章，场景三与场景一共章。
 */
async function createLegacyChapterPathSchema(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "Story" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "title" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryThread" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "storyPhaseId" INTEGER, "sortOrder" INTEGER NOT NULL, "name" TEXT NOT NULL, "title" TEXT NOT NULL, "isMainThread" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "tags" TEXT NOT NULL DEFAULT '[]', "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(LEGACY_STORY_SCENE_DDL);
    await client.execute(`INSERT INTO "Story" ("id", "title", "summary") VALUES (1, '故事', '')`);
    await client.execute(`INSERT INTO "StoryThread" ("id", "storyId", "sortOrder", "name", "title") VALUES (1, 1, 0, 'main', '主线')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "chapterPath", "threadSortOrder", "title", "summary") VALUES (1, 1, 1, 'manuscript/001-volume/001-chapter/', 0, '场景一', '场景一摘要')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "chapterPath", "threadSortOrder", "title", "summary") VALUES (2, 1, 1, 'manuscript/001-volume/002-chapter/', 1, '场景二', '')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "chapterPath", "threadSortOrder", "title", "summary") VALUES (3, 1, 1, 'manuscript/001-volume/001-chapter/', 2, '场景三', '')`);
}

/**
 * 失败注入夹具：两条场景重复 (threadId, threadSortOrder)，并用同名非唯一索引占位，
 * 让 PROJECT_MIGRATION_SQL 的 CREATE UNIQUE INDEX IF NOT EXISTS 跳过创建，使失败精确落在
 * 重建后(DROP TABLE→RENAME→回填之后)的唯一索引重建上——检验事务能否把最深处的失败整体回滚。
 */
async function createRollbackFixtureSchema(client: ReturnType<typeof createClient>): Promise<void> {
    await client.execute(`CREATE TABLE "Story" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "title" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE "StoryThread" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "storyId" INTEGER NOT NULL, "storyPhaseId" INTEGER, "sortOrder" INTEGER NOT NULL, "name" TEXT NOT NULL, "title" TEXT NOT NULL, "isMainThread" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'draft', "summary" TEXT NOT NULL DEFAULT '', "tags" TEXT NOT NULL DEFAULT '[]', "writingTip" TEXT, "note" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(LEGACY_STORY_SCENE_DDL);
    await client.execute(`CREATE INDEX "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder")`);
    await client.execute(`INSERT INTO "Story" ("id", "title", "summary") VALUES (1, '故事', '')`);
    await client.execute(`INSERT INTO "StoryThread" ("id", "storyId", "sortOrder", "name", "title") VALUES (1, 1, 0, 'main', '主线')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "chapterPath", "threadSortOrder", "title") VALUES (1, 1, 1, 'manuscript/v1/c1', 0, '场景一')`);
    await client.execute(`INSERT INTO "StoryScene" ("id", "storyId", "threadId", "threadSortOrder", "title") VALUES (2, 1, 1, 0, '场景二')`);
}
