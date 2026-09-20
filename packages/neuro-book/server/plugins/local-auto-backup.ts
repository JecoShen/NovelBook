import {defineNitroPlugin} from "nitropack/runtime";
import {useLocalAutoBackupService} from "nbook/server/backup/local-auto-backup-service";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 本地自动备份调度挂载：启动时补齐今日备份并挂每日 tick（定时器已 unref）。
 * nitro close 时停表并等待在途归档落盘，POSIX signal 路径与 project-session-close 同一生命周期。
 */
export default defineNitroPlugin((nitroApp) => {
    const service = useLocalAutoBackupService();
    service.startScheduler(runtimePathsFromEnv());
    nitroApp.hooks.hook("close", async () => {
        await service.stopScheduler();
    });
});
