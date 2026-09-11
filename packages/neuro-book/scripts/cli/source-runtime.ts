#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {seedSystemAssets} from "nbook/server/workspace-files/system-asset-installation";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const packageRoot = resolve(import.meta.dirname, "../..");
// 应用包在 monorepo 内的位置固定为 <repo>/packages/neuro-book，仓库根即再上两级；
// Source Dev 入口不跨根引用根 workspace 的 locator（应用脚本边界合同）。
const repositoryRoot = resolve(packageRoot, "../..");
process.env.NEURO_BOOK_REPOSITORY_ROOT = repositoryRoot;
process.env.NEURO_BOOK_RUNTIME_ASSET_MODE = "install";
delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
delete process.env.NEURO_BOOK_PRODUCT_BUILD;

const runtimePaths = runtimePathsFromEnv(packageRoot);
const seedResult = await seedSystemAssets({
    applicationRoot: runtimePaths.applicationRoot,
    stateRoot: runtimePaths.stateRoot,
});
if (seedResult.legacyAdoption) {
    const adoption = seedResult.legacyAdoption;
    console.warn(`[system-assets] 检测到缺少安装账本的 legacy Install Root，已按磁盘与 Seed 内容比对重建：${adoption.reason}`);
    console.warn(`[system-assets] 重建结果 bundled=${adoption.bundled}, dirty=[${adoption.dirty.join(", ")}], local=[${adoption.local.join(", ")}]`);
    if (adoption.dirty.length > 0 || adoption.local.length > 0) {
        console.warn("[system-assets] dirty/local 包不会被 Seed 自动升级或接管；如需按墓碑语义清理旧投影孤儿，运行 bun scripts/cli/migrate-legacy-agent-assets.ts --preflight 后再 --apply");
    }
}

const steps: readonly (readonly string[])[] = [
    ["--no-install", resolve(packageRoot, "scripts/db/check-migrations.ts")],
    ["--no-install", "run", "nuxt:prepare"],
    ["--no-install", "run", "generate"],
    ["--no-install", resolve(packageRoot, "scripts/build/prepare-system-assets.ts"), "--sync-user-assets", "--force-sync-user-assets"],
    ["--no-install", "x", "nuxt", "dev", "--no-fork"],
];

for (const args of steps) {
    const code = await run(args);
    if (code !== 0) {
        process.exitCode = code;
        break;
    }
}

function run(args: readonly string[]): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, args, {
            cwd: packageRoot,
            env: process.env,
            stdio: "inherit",
            windowsHide: false,
        });
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (signal) {
                resolvePromise(1);
                return;
            }
            resolvePromise(code ?? 1);
        });
    });
}
