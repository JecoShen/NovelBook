import {describe, expect, it} from "vitest";
import {isSqliteFile, sanitizeZipEntryName, shouldExcludeFromBackup} from "nbook/server/backup/backup-archive-rules";

describe("备份排除规则", () => {
    it("排除 logs 目录与锁/临时/wal/shm 文件", () => {
        expect(shouldExcludeFromBackup("logs")).toBe(true);
        expect(shouldExcludeFromBackup("logs/app.log")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/neuro-book.sqlite-wal")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/neuro-book.sqlite-shm")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/a/.b.lock")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/a/tempfile.tmp")).toBe(true);
        expect(shouldExcludeFromBackup("workspace\\a\\x.tmp")).toBe(true);
    });

    it("排除收集侧真实产出的 workspace/ 前缀形态（生产实测回归钉）", () => {
        // 收集器产出的条目名恒带 workspace/ 前缀，规则必须命中该形态而不是裸目录名
        expect(shouldExcludeFromBackup("workspace/.nbook/logs")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/logs/app.log")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/secrets")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/secrets/token.json")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/novel-a/secrets/draft.md")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/.staging/pending.bin")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/runtime-artifact-import-cache/blob.bin")).toBe(true);
    });

    it("排除 .nbook 下的 traces/sessions/locks 运行态子树（含目录本身）", () => {
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/traces")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/traces/run-1/trace.jsonl")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/sessions")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/sessions/sess-1/session.jsonl")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/locks/projects/abc.metadata.json")).toBe(true);
    });

    it("排除 .nbook 锚定的 trash 回收区，但不误伤作品树里的同名目录", () => {
        expect(shouldExcludeFromBackup("workspace/.nbook/trash")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/trash/novel-a/manuscript/chapter-1.md")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/trash/copy/manuscript/chapter-1.md")).toBe(true);
        // 作品目录里非 .nbook 锚定的 trash 是正常内容，不误排
        expect(shouldExcludeFromBackup("workspace/novel-a/trash/draft-notes.md")).toBe(false);
    });

    it("排除 .nbook 锚定的 deleted-projects 墓碑暂存（回收迁移失败时的长留形态）", () => {
        expect(shouldExcludeFromBackup("workspace/.nbook/deleted-projects")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/.nbook/deleted-projects/v1-abc/payload/manuscript/chapter-1.md")).toBe(true);
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/deleted-projects/v1-def/payload/project.sqlite")).toBe(true);
        // 项目根内的 deleted-project.json 删除标记是项目元数据，不在此子树语义内
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/deleted-project.json")).toBe(false);
    });

    it("保留正常内容文件（含名字里带 logs 的非目录命中）", () => {
        expect(shouldExcludeFromBackup("workspace/manuscript/chapter-1.md")).toBe(false);
        expect(shouldExcludeFromBackup("config.yaml")).toBe(false);
        expect(shouldExcludeFromBackup(".env")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/logs-notes.md")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/.nbook/neuro-book.sqlite")).toBe(false);
    });

    it("保留作品数据与设置：正文、lore、项目库、history、profiles、workflows、jobs", () => {
        expect(shouldExcludeFromBackup("workspace/novel-a/manuscript/chapter-1.md")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/novel-a/lorebook/world/history.md")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/project.sqlite")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/novel-a/.nbook/history.sqlite")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/.nbook/config.json")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/profiles/writer/profile.json")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/workflows/main.json")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/.nbook/agent/jobs/job-1.json")).toBe(false);
        // 作品目录里同名的 traces/sessions 不是 Agent 运行态，不误排
        expect(shouldExcludeFromBackup("workspace/novel-a/traces/ch-1.md")).toBe(false);
        expect(shouldExcludeFromBackup("workspace/novel-a/sessions/notes.md")).toBe(false);
    });

    it("SQLite 判定只按 .sqlite 后缀", () => {
        expect(isSqliteFile("workspace/.nbook/neuro-book.sqlite")).toBe(true);
        expect(isSqliteFile("workspace\\a\\.nbook\\project.sqlite")).toBe(true);
        expect(isSqliteFile("workspace/a/data.sqlite3")).toBe(false);
        expect(isSqliteFile("workspace/a/notes.md")).toBe(false);
    });
});

describe("zip 条目名安全化（zip-slip 防护）", () => {
    it("拒绝绝对路径、盘符与 .. 逃逸", () => {
        expect(sanitizeZipEntryName("/etc/passwd")).toBeNull();
        expect(sanitizeZipEntryName("C:/windows/system32")).toBeNull();
        expect(sanitizeZipEntryName("c:\\x")).toBeNull();
        expect(sanitizeZipEntryName("../outside.txt")).toBeNull();
        expect(sanitizeZipEntryName("workspace/../../outside.txt")).toBeNull();
        expect(sanitizeZipEntryName("")).toBeNull();
        expect(sanitizeZipEntryName("//server/share")).toBeNull();
    });

    it("归一化合法路径（反斜杠、冗余段）", () => {
        expect(sanitizeZipEntryName("workspace/manuscript/a.md")).toBe("workspace/manuscript/a.md");
        expect(sanitizeZipEntryName("workspace\\manuscript\\a.md")).toBe("workspace/manuscript/a.md");
        expect(sanitizeZipEntryName("./workspace//a.md")).toBe("workspace/a.md");
        expect(sanitizeZipEntryName("nb-backup.json")).toBe("nb-backup.json");
    });
});
