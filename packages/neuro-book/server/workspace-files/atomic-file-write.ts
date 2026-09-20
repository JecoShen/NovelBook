import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 作品资产的落盘合同：任意时刻读者只能看到完整旧版或完整新版。
 * 裸 writeFile 先截断再写，进程中途崩溃会把正文切成任意前缀；临时文件与目标
 * 同目录保证 rename 不跨设备，目录 fsync 保证崩溃后目录项本身也可恢复。
 */
export async function writeTextFileAtomically(filePath: string, content: string): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    const handle = await fs.open(temporaryPath, "wx");
    try {
        try {
            await handle.writeFile(content, "utf-8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(temporaryPath, filePath);
    } catch (error) {
        // 只清理本函数已创建的临时文件；open 失败时不进入本分支。
        await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
        throw error;
    }
    await syncDirectory(directory);
}

/** rename 之后同步父目录；Windows 不能打开目录句柄，与 durable-file.ts 同样跳过。 */
async function syncDirectory(directory: string): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    const handle = await fs.open(directory, "r");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
