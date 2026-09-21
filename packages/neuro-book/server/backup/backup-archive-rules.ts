// 备份归档的纯规则层（Task 112 spec §9.4）：排除规则与 zip 条目名安全化。
// 抽成纯函数便于直接单测，也让打包/恢复两侧共享同一判据。

/**
 * 任意深度整目录排除的路径段。按段精确匹配，logs-notes.md 这类文件名不误伤；
 * secrets 无深度限制是刻意的：凭据类目录出现在作品树下同样不得上云。
 */
const EXCLUDED_DIRECTORY_SEGMENTS: ReadonlySet<string> = new Set([
    "secrets",
    "logs",
    ".staging", // 导入/激活的进行中暂存，恢复半成品无意义
    "runtime-artifact-import-cache",
]);

/**
 * 锚定 .nbook 运行态根的排除子树。不按裸段排除 traces/sessions/locks，
 * 避免误伤作品目录里的同名正常内容；locks 租约是本机进程状态，跨机恢复会复活幻影租约。
 */
const EXCLUDED_NBOOK_SUBTREES: readonly string[] = [
    "agent/traces", // 全文 prompt+正文 trace，实测可达数百 MB 且可再生成
    "agent/sessions", // 会话转录，本机进行中状态
    "agent/migrations", // 迁移前快照只在原机 rollback 窗口内有价值；跨机恢复时 sessions 已是新格式，快照只剩体积
    "locks",
    "trash", // 删除回收区（project-lifecycle 保留 30 天的项目副本），恢复备份不应复活已删内容
    "deleted-projects", // delete 事务的 tombstone 暂存；回收迁移失败时长留至保留期满，同属已删内容
];

/**
 * 打包排除规则：敏感目录、可再生运行态、锁/临时文件、SQLite wal/shm 伴生文件。
 * relativePath 以 State Root 为基准、使用 / 分隔；收集侧产出的条目名实际形态是
 * workspace/...（顶层 config.yaml 与 .env 不经过本规则直接入包）。
 */
export function shouldExcludeFromBackup(relativePath: string): boolean {
    const normalized = relativePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (segments.some((segment) => EXCLUDED_DIRECTORY_SEGMENTS.has(segment))) {
        return true;
    }
    const nbookIndex = segments.indexOf(".nbook");
    if (nbookIndex >= 0) {
        const subtree = segments.slice(nbookIndex + 1).join("/");
        if (EXCLUDED_NBOOK_SUBTREES.some((prefix) => subtree === prefix || subtree.startsWith(`${prefix}/`))) {
            return true;
        }
    }
    const name = segments[segments.length - 1] ?? "";
    return name.endsWith(".lock") || name.endsWith(".tmp") || name.endsWith("-wal") || name.endsWith("-shm");
}

/**
 * SQLite 数据库判定：这类文件不能直接拷贝活文件，打包时走 VACUUM INTO 冷快照。
 */
export function isSqliteFile(relativePath: string): boolean {
    return relativePath.replaceAll("\\", "/").endsWith(".sqlite");
}

/**
 * zip 条目名安全化（zip-slip 防护）：拒绝绝对路径、盘符、UNC 与 .. 逃逸；
 * 返回归一化的 / 分隔相对路径，非法返回 null。
 */
export function sanitizeZipEntryName(entryName: string): string | null {
    const normalized = entryName.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || normalized.startsWith("//") || /^[a-zA-Z]:/.test(normalized)) {
        return null;
    }
    const parts = normalized.split("/").filter((part) => part.length > 0 && part !== ".");
    if (parts.length === 0 || parts.some((part) => part === "..")) {
        return null;
    }
    return parts.join("/");
}
