#!/usr/bin/env bun
import {resolve} from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const PACKAGE_ROOT = resolve(ROOT, "packages", "neuro-book-manager");

/**
 * fork 发布门禁模式（p-011）。
 * fork 不向 npm 发布 Manager（Trusted Publishing 绑定上游仓库与其 environment），
 * verify-public-manager.ts 的 npm provenance 校验在本仓结构性恒红；fork 模式改做
 * 本机构建一致性校验（manager:pack + 本地 dist --version 断言），门禁仍 fail-closed。
 * 恢复条件：fork 重新对齐上游 npm 发布后把常量翻回 "upstream"，并以
 * NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream 复跑验证。
 */
const FORK_PUBLIC_MANAGER_GATE_MODE = "fork" as const;

type GateMode = "upstream" | "fork";

function resolveGateMode(): GateMode {
    const override = process.env.NEURO_BOOK_PUBLIC_MANAGER_GATE;
    if (override === undefined || override === "") {
        return FORK_PUBLIC_MANAGER_GATE_MODE;
    }
    if (override === "upstream" || override === "fork") {
        return override;
    }
    throw new Error(`NEURO_BOOK_PUBLIC_MANAGER_GATE 只接受 upstream|fork，收到：${override}`);
}

async function runInherit(command: string[]): Promise<void> {
    const child = Bun.spawn(command, {cwd: ROOT, stdout: "inherit", stderr: "inherit"});
    const exitCode = await child.exited;
    if (exitCode !== 0) {
        throw new Error(`${command.join(" ")} 退出码 ${exitCode}`);
    }
}

async function runCaptureStdout(command: string[]): Promise<string> {
    const child = Bun.spawn(command, {cwd: ROOT, stdout: "pipe", stderr: "pipe"});
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new Error(`${command.join(" ")} 退出码 ${exitCode}：${stderr.trim() || stdout.trim()}`);
    }
    return stdout;
}

const mode = resolveGateMode();
if (mode === "upstream") {
    await runInherit(["bun", "scripts/release/verify-public-manager.ts"]);
} else {
    const packageJson = await Bun.file(resolve(PACKAGE_ROOT, "package.json")).json() as {name: string; version: string};
    console.log("[public-manager-gate] fork 模式：fork 不发布 npm，跳过 npm provenance 校验"
        + "（公开 gitHead 承诺在 fork 无主体），改做本地构建一致性校验；"
        + "恢复上游语义：NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream。");
    await runInherit(["bun", "run", "manager:pack"]);
    const localExecutable = resolve(PACKAGE_ROOT, "dist", "neuro-book.mjs");
    const reportedVersion = (await runCaptureStdout(["bun", localExecutable, "--version"])).trim();
    if (reportedVersion !== packageJson.version) {
        throw new Error(`本机构建Manager --version错误：${reportedVersion}，期望 ${packageJson.version}`);
    }
    try {
        const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/${encodeURIComponent(packageJson.version)}`,
        );
        if (response.ok) {
            const metadata = await response.json() as {gitHead?: string};
            console.log(`[public-manager-gate] npm 漂移情报（仅观察不阻断）：${packageJson.name}@${packageJson.version}`
                + ` 公开 gitHead=${metadata.gitHead ?? "缺失"}；fork 构建输入与其漂移是固有状态而非缺陷信号。`);
        } else {
            console.log(`[public-manager-gate] npm 漂移情报不可用（HTTP ${response.status}，不阻断）。`);
        }
    } catch (error) {
        console.log(`[public-manager-gate] npm 漂移情报获取失败（不阻断）：${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`[public-manager-gate] fork 本地一致性校验通过：Manager ${packageJson.version}`
        + " 本机构建可打包、可独立安装运行，--version 与 package.json 一致。");
}
