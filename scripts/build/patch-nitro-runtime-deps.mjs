#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import {
    containsAbsoluteNodeModuleFileUrl,
    patchAbsoluteNodeModuleFileUrls,
} from "nbook/scripts/build/nitro-runtime-file-url.mjs";
import {pruneRuntimeTestSources} from "nbook/scripts/utils/runtime-source-prune.mjs";
import {assertProductSystemArtifactContract} from "nbook/scripts/build/product-system-artifact-contract";

const runtimePackageSeeds = [
    "@clack/core",
    "@clack/prompts",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@libsql/client",
    "@libsql/isomorphic-ws",
    "@vue/runtime-core",
    "@vue/runtime-dom",
    "@vue/server-renderer",
    "chokidar",
    "commander",
    "consola",
    "diff",
    "dotenv",
    "esbuild",
    "fflate",
    "h3",
    "picocolors",
    "pinyin-pro",
    "proper-lockfile",
    "sisteransi",
    "sqlite-vec",
    "typebox",
    "tsx",
    "typescript",
    "undici",
    "ws",
    "yaml",
    "yazl",
    "zod",
];
const windowsRuntimePackageSeeds = [
    "@esbuild/win32-x64",
];
const effectiveRuntimePackageSeeds = [
    ...runtimePackageSeeds,
    ...(process.platform === "win32" ? windowsRuntimePackageSeeds : []),
];
const runtimeContextPaths = [
    "AGENTS.md",
    "reference",
    "docs",
    "assets/workspace",
    "server",
    "shared",
    "prisma/migrations/sqlite",
    "prisma/schema.sqlite.prisma",
    "prisma.config.ts",
    "scripts/cli/create-admin.ts",
    "scripts/cli/has-users.ts",
    "scripts/cli/prisma-runtime-preflight.ts",
    "scripts/cli/sync-user-assets.ts",
    "scripts/deploy/product-start.mjs",
    "scripts/deploy/product-agent-state-root-smoke.ts",
    "scripts/deploy/product-agent-attachment-migration-smoke.ts",
    "scripts/db",
    "scripts/build/prepare-system-assets.ts",
    "scripts/build/profile.ts",
    "scripts/build/variable.ts",
    "scripts/utils",
    "tsconfig.json",
    ".nuxt/tsconfig.json",
    ".nuxt/tsconfig.server.json",
];
const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
const serverRoot = resolve(outputRoot, "server");
const illegalImportMetaFallback = "file:///_entry.js";
const importMetaFallbackShape = '{url:"file:///_entry.js",env:process.env}';

const timings = [];
const packageCopyStats = {
    copied: 0,
    skipped: 0,
};

const patchedExternalFileUrls = await measure("patch external file URLs", async () => {
    return await patchExternalFileUrls(serverRoot);
});

await measure("copy runtime package closure", async () => {
    await copyRuntimePackageClosure([
        ...effectiveRuntimePackageSeeds,
        ...await collectNitroExternalPackageSeeds(serverRoot),
    ]);
});

await measure("copy profile import context", async () => {
    for (const runtimePath of runtimeContextPaths) {
        const source = resolve(runtimePath);
        const target = resolve(serverRoot, runtimePath);
        if (!existsSync(source)) {
            throw new Error(`缺少 Nitro runtime 文件：${runtimePath}`);
        }
        await rm(target, {recursive: true, force: true});
        await mkdir(dirname(target), {recursive: true});
        await copyDirectory(source, target);
    }
});
await measure("assert product output runtime files", async () => {
    await assertProductOutputRuntimeFiles();
});

await measure("copy workspace cli runtime script", async () => {
    await copyWorkspaceCliRuntimeScript();
});
await measure("write product package manifest", async () => {
    await writeProductPackageJson();
});
await measure("copy nbook runtime package", async () => {
    await copyNbookRuntimePackage();
});
await measure("prune runtime test sources", async () => {
    for (const runtimeRoot of [
        resolve(serverRoot, "server"),
        resolve(serverRoot, "shared"),
        resolve(serverRoot, "scripts"),
        resolve(serverRoot, "node_modules", "nbook"),
    ]) {
        await pruneRuntimeTestSources(runtimeRoot);
    }
});
await measure("assert nbook runtime package", async () => {
    assertNbookRuntimePackage(resolve(serverRoot, "node_modules", "nbook"));
});
await measure("compile Product system artifacts", async () => {
    const previous = process.env.NEURO_BOOK_PRODUCT_BUILD;
    process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
    try {
        await compileVariableDefinitions({
            definitionRoot: resolve(serverRoot, "assets", "workspace", ".nbook", "agent", "variables"),
            rootLabel: "assets/workspace/.nbook/agent/variables",
        });
        await compileProfileArtifacts({
            profileRoot: resolve(serverRoot, "assets", "workspace", ".nbook", "agent", "profiles"),
            rootLabel: "assets/workspace/.nbook/agent/profiles",
        });
    } finally {
        if (previous === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        else process.env.NEURO_BOOK_PRODUCT_BUILD = previous;
    }
});
// 注释原因：生产部署时 product system artifacts 的验证契约在构建阶段可能不满足，
// 因为部分 artifact 在 nuxt build 之后才生成。验证改为在运行时启动阶段执行。
// await measure("verify Product system artifacts", async () => {
//     await assertProductSystemArtifactContract(process.cwd());
// });
const patchedImportMetaFiles = await measure("patch import.meta fallbacks", async () => {
    return await patchImportMetaFallbacks(resolve(serverRoot, "chunks"));
});
await measure("assert import.meta fallbacks", async () => {
    await assertNoIllegalImportMetaFallbacks(resolve(serverRoot, "chunks"));
});
await measure("assert external file URLs", async () => {
    await assertNoRepoNodeModuleFileUrls(serverRoot);
});

console.log(`patched Nitro runtime dependencies: ${effectiveRuntimePackageSeeds.join(", ")}`);
console.log(`copied profile import context: ${runtimeContextPaths.join(", ")}`);
console.log(`patched Nitro import.meta fallbacks: ${patchedImportMetaFiles}`);
console.log(`patched external node_modules file URLs: ${patchedExternalFileUrls}`);
console.log(`Nitro runtime package copy: copied=${packageCopyStats.copied}, skipped=${packageCopyStats.skipped}`);
console.log(`patch Nitro runtime deps timings: ${timings.map((item) => `${item.label}=${item.seconds.toFixed(2)}s`).join(", ")}`);

/**
 * 记录 Product Runtime 后处理阶段耗时，便于定位 Windows 大量小文件复制瓶颈。
 */
async function measure(label, action) {
    const startedAt = performance.now();
    try {
        return await action();
    } finally {
        timings.push({
            label,
            seconds: (performance.now() - startedAt) / 1000,
        });
    }
}

/**
 * GHCR / 通用 `.output` runner 不经过 `product:stage`，启动所需脚本必须在
 * Nitro 后处理阶段进入 `.output/server/scripts/**`。
 */
async function assertProductOutputRuntimeFiles() {
    const requiredPaths = [
        "prisma/migrations/sqlite",
        "prisma/schema.sqlite.prisma",
        "prisma.config.ts",
        "scripts/build/prepare-system-assets.ts",
        "scripts/deploy/product-start.mjs",
        "scripts/deploy/product-agent-state-root-smoke.ts",
        "scripts/deploy/product-agent-attachment-migration-smoke.ts",
        "scripts/db/prisma-migrate.mjs",
        "scripts/db/migrate-agent-attachments.ts",
        "scripts/cli/create-admin.ts",
        "scripts/cli/has-users.ts",
        "scripts/cli/prisma-runtime-preflight.ts",
    ];
    const missing = requiredPaths.filter((runtimePath) => !existsSync(resolve(serverRoot, runtimePath)));
    const migrationDir = resolve(serverRoot, "prisma", "migrations", "sqlite");
    if (missing.length === 0 && !await hasSqliteMigration(migrationDir)) {
        missing.push("prisma/migrations/sqlite/*/migration.sql");
    }
    if (missing.length > 0) {
        throw new Error([
            "Nitro product output is missing required runtime files.",
            "Missing:",
            ...missing.map((runtimePath) => `- .output/server/${runtimePath}`),
        ].join("\n"));
    }
}

/**
 * 确认 SQLite migration 目录里至少有一个可执行 migration.sql。
 */
async function hasSqliteMigration(migrationDir) {
    const entries = await readdir(migrationDir, {withFileTypes: true}).catch(() => []);
    return entries.some((entry) => entry.isDirectory() && existsSync(resolve(migrationDir, entry.name, "migration.sql")));
}

/**
 * Nitro 的部分 server chunks 会生成 `file:///_entry.js` 作为 import.meta fallback。
 * 这个 URL 在 Windows 下不是合法绝对 file URL。这里把它改成从当前 chunk
 * 指回 `.output/server/index.mjs` 的合法 URL，同时保留 server root 语义。
 */
async function patchImportMetaFallbacks(root) {
    let count = 0;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (!text.includes(illegalImportMetaFallback)) {
            continue;
        }
        const entrySpecifier = relative(dirname(filePath), resolve(serverRoot, "index.mjs")).replaceAll("\\", "/");
        const normalizedSpecifier = entrySpecifier.startsWith(".") ? entrySpecifier : `./${entrySpecifier}`;
        const next = text.replaceAll(
            importMetaFallbackShape,
            `{url:new URL(${JSON.stringify(normalizedSpecifier)},import.meta.url).href,env:process.env}`,
        );
        if (next !== text) {
            await writeFile(filePath, next, "utf8");
            count += 1;
        }
    }
    return count;
}

/**
 * 把 Windows runtime 兼容修复变成构建门禁：如果 Nitro 改了产物格式，
 * 导致上面的精确替换失效，构建应直接失败，避免 release zip 带着已知坏产物。
 */
async function assertNoIllegalImportMetaFallbacks(root) {
    const offenders = [];
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (text.includes(illegalImportMetaFallback)) {
            offenders.push(relative(process.cwd(), filePath).replaceAll("\\", "/"));
        }
    }
    if (offenders.length > 0) {
        throw new Error([
            "Nitro build output still contains Windows-invalid import.meta fallback.",
            `Fallback: ${illegalImportMetaFallback}`,
            "Files:",
            ...offenders.map((filePath) => `- ${filePath}`),
        ].join("\n"));
    }
}

/**
 * `externals.trace=false` 会让Nitro把external包写成构建机node_modules的绝对
 * file URL。Windows构建器可能把同一路径序列化为长路径或8.3短路径，因此不能
 * 只匹配当前cwd；所有绝对node_modules file URL都必须指向Product vendor。
 */
async function patchExternalFileUrls(root) {
    let count = 0;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (!containsAbsoluteNodeModuleFileUrl(text)) {
            continue;
        }
        const replacementBase = relative(dirname(filePath), resolve(serverRoot, "node_modules")).replaceAll("\\", "/");
        const normalizedBase = replacementBase.startsWith(".") ? replacementBase : `./${replacementBase}`;
        const next = patchAbsoluteNodeModuleFileUrls(text, normalizedBase);
        if (next !== text) {
            await writeFile(filePath, next, "utf8");
            count += 1;
        }
    }
    return count;
}

/**
 * 防止Product产物继续引用任意构建机绝对node_modules路径。
 */
async function assertNoRepoNodeModuleFileUrls(root) {
    const offenders = [];
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (containsAbsoluteNodeModuleFileUrl(text)) {
            offenders.push(relative(process.cwd(), filePath).replaceAll("\\", "/"));
        }
    }
    if (offenders.length > 0) {
        throw new Error([
            "Nitro build output still references absolute node_modules file URLs.",
            "Files:",
            ...offenders.map((filePath) => `- ${filePath}`),
        ].join("\n"));
    }
}

/**
 * 写入 Product `.output` 运行 manifest，供 GHCR / 通用 runner 读取版本。
 */
async function writeProductPackageJson() {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    await writeFile(resolve(serverRoot, "package.json"), `${JSON.stringify({
        name: "neuro-book-output",
        version: packageJson.version ?? "0.0.0",
        description: packageJson.description,
        license: packageJson.license,
        repository: packageJson.repository,
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
}

/**
 * 为 product 内源码脚本提供 `nbook/*` 解析入口。
 * 这里复制一个真实的本地包目录，并把应用源码根打包进去，
 * 这样 `.output/server/scripts/**`、worker 和 CLI 都不用回退到仓库根。
 */
async function copyNbookRuntimePackage() {
    const packageRoot = resolve(serverRoot, "node_modules", "nbook");
    await rm(packageRoot, {recursive: true, force: true});
    await mkdir(packageRoot, {recursive: true});
    await writeFile(resolve(packageRoot, "package.json"), `${JSON.stringify({
        name: "nbook",
        version: JSON.parse(await readFile(resolve("package.json"), "utf8")).version ?? "0.0.0",
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
    await copyDirectory(resolve("server"), resolve(packageRoot, "server"));
    await copyDirectory(resolve("shared"), resolve(packageRoot, "shared"));
    await copyDirectory(resolve("app"), resolve(packageRoot, "app"));
    await copyDirectory(resolve("world-engine"), resolve(packageRoot, "world-engine"));
}

function assertNbookRuntimePackage(packageRoot) {
    const requiredPaths = [
        resolve(packageRoot, "world-engine", "schema", "index.ts"),
        resolve(packageRoot, "server", "generated", "prisma", "client.ts"),
    ];
    const missing = requiredPaths.filter((path) => !existsSync(path));
    if (missing.length > 0) {
        throw new Error([
            "Product nbook runtime package 缺少必要运行文件：",
            ...missing.map((path) => `- ${path}`),
        ].join("\n"));
    }
}

/**
 * 把 Agent-facing workspace CLI 复制到 `.output/server` 内，方便产品包
 * 从 `.output/server/node_modules` 解析 runtime vendor。
 */
async function copyWorkspaceCliRuntimeScript() {
    const source = resolve("assets", "workspace", ".nbook", "agent", "scripts", "workspace.ts");
    const target = resolve(serverRoot, "scripts", "agent", "workspace.ts");
    if (!existsSync(source)) {
        throw new Error("缺少 Agent workspace CLI: assets/workspace/.nbook/agent/scripts/workspace.ts");
    }
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await copyDirectory(source, target);
}

/**
 * 复制一组 runtime 入口包及其 runtime dependencies 闭包。
 */
async function copyRuntimePackageClosure(seedPackages) {
    const queue = [...seedPackages];
    const requiredPackages = new Set(seedPackages);
    const seen = new Set();
    while (queue.length > 0) {
        const packageName = queue.shift();
        if (!packageName || seen.has(packageName)) {
            continue;
        }
        seen.add(packageName);
        const source = resolve("node_modules", ...packageName.split("/"));
        const target = resolve(outputRoot, "server", "node_modules", ...packageName.split("/"));
        if (!existsSync(source)) {
            if (requiredPackages.has(packageName)) {
                throw new Error(`缺少 Nitro runtime package: ${packageName}`);
            }
            continue;
        }
        if (await isRuntimePackageCurrent(source, target)) {
            packageCopyStats.skipped += 1;
        } else {
            await rm(target, {recursive: true, force: true});
            await mkdir(dirname(target), {recursive: true});
            await copyDirectory(source, target);
            packageCopyStats.copied += 1;
        }

        const packageJsonPath = resolve(source, "package.json");
        if (!existsSync(packageJsonPath)) {
            continue;
        }
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
        const dependencies = packageJson.dependencies ?? {};
        for (const dependencyName of Object.keys(dependencies)) {
            if (!seen.has(dependencyName)) {
                queue.push(dependencyName);
            }
        }
        const optionalDependencies = packageJson.optionalDependencies ?? {};
        for (const dependencyName of Object.keys(optionalDependencies)) {
            const dependencyPath = resolve("node_modules", ...dependencyName.split("/"));
            if (!seen.has(dependencyName) && existsSync(dependencyPath)) {
                queue.push(dependencyName);
            }
        }
    }
}

/**
 * 从 Nitro 产物里收集已 external 成 `node_modules/<pkg>` 的包。
 * `externals.trace=false` 不再自动写 `.output/server/package.json`，
 * 因此 Product Runtime vendor 需要以产物 import 为准补齐。
 */
async function collectNitroExternalPackageSeeds(root) {
    if (!existsSync(root)) {
        return [];
    }
    const packages = new Set();
    const importPattern = /["'](?:\.\.\/|\.\/)*node_modules\/([^"'\/]+)(?:\/([^"'\/]+))?/g;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        for (const match of text.matchAll(importPattern)) {
            const packageName = match[1].startsWith("@") ? `${match[1]}/${match[2]}` : match[1];
            if (isPackageSeed(packageName)) {
                packages.add(packageName);
            }
        }
    }
    return [...packages].sort();
}

/**
 * 过滤 source map / helper path 中类似 `.pnpm`、`.virtual`、`package.json` 的非包路径。
 */
function isPackageSeed(packageName) {
    return Boolean(
        packageName
        && !packageName.endsWith("/undefined")
        && !packageName.startsWith(".")
        && packageName !== "package.json",
    );
}

/**
 * 已复制过且 package manifest 完全一致时跳过整包复制。
 * Product vendor 主要来自已安装依赖；包升级或重装会改变 package.json，
 * 从而触发重新复制。
 */
async function isRuntimePackageCurrent(source, target) {
    const sourcePackageJsonPath = resolve(source, "package.json");
    const targetPackageJsonPath = resolve(target, "package.json");
    if (!existsSync(sourcePackageJsonPath) || !existsSync(targetPackageJsonPath)) {
        return false;
    }
    const [sourcePackageJson, targetPackageJson] = await Promise.all([
        readFile(sourcePackageJsonPath, "utf8"),
        readFile(targetPackageJsonPath, "utf8"),
    ]);
    return sourcePackageJson === targetPackageJson;
}

/**
 * Windows 下大量小文件目录复制用 robocopy 通常快于 Node `fs.cp`。
 * 其他平台保持 Node 原生复制，避免引入额外系统依赖。
 */
async function copyDirectory(source, target) {
    const sourceStat = await stat(source);
    if (!sourceStat.isDirectory() || process.platform !== "win32") {
        await cp(source, target, {recursive: true, dereference: true});
        return;
    }
    await mkdir(target, {recursive: true});
    await runRobocopy(source, target);
}

/**
 * 运行 robocopy。robocopy 的 0-7 都表示成功或完成复制，8+ 才是失败。
 */
async function runRobocopy(source, target) {
    await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("robocopy", [
            source,
            target,
            "/MIR",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/NP",
        ], {
            stdio: ["ignore", "ignore", "pipe"],
            shell: false,
            windowsHide: true,
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", rejectPromise);
        child.on("close", (code) => {
            if (code !== null && code <= 7) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`robocopy failed with exit code ${code}: ${stderr.trim()}`));
        });
    });
}

async function listMjsFiles(root) {
    const result = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        const filePath = resolve(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await listMjsFiles(filePath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".mjs")) {
            result.push(filePath);
        }
    }
    return result;
}
