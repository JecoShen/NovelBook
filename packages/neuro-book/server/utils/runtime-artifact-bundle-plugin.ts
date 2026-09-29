import {builtinModules, createRequire} from "node:module";
import {dirname, isAbsolute, join} from "node:path";
import {pathToFileURL} from "node:url";
import type {Plugin, ResolveOptions} from "esbuild";
import {
    resolveRuntimeArtifactNbookPath,
    type RuntimeArtifactCompilerContext,
} from "nbook/server/utils/runtime-artifact-compiler-context";

/**
 * 与 Product package island 登记（scripts/build/product-runtime-islands.ts）同族的
 * package 根集合：这些 package 含 native binding 或在运行时读取 package 相对文件，
 * 不能冻结进 artifact bundle。新增 island 须双侧同步；leader-assets 全量测试是
 * 漂移哨兵（w00016 lore 图首次把 island 引进 profile 编译图后才暴露此需求）。
 */
const RUNTIME_ARTIFACT_ISLAND_PACKAGE_EXACT = new Set([
    "jsdom",
    "typescript",
    "esbuild",
    "libsql",
    "sqlite-vec",
    "sharp",
    "detect-libc",
]);
const RUNTIME_ARTIFACT_ISLAND_PACKAGE_PREFIXES = ["@img/", "@libsql/", "@esbuild/", "@neon-rs/", "sqlite-vec-"];

/** 取 bare specifier 的 package 根：`@scope/name/sub` → `@scope/name`，`name/sub` → `name`。 */
function packageRootOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function isRuntimeArtifactIslandPackage(specifier: string): boolean {
    const root = packageRootOf(specifier);
    return RUNTIME_ARTIFACT_ISLAND_PACKAGE_EXACT.has(root)
        || RUNTIME_ARTIFACT_ISLAND_PACKAGE_PREFIXES.some((prefix) => root.startsWith(prefix) || specifier.startsWith(prefix));
}

/**
 * 为 Profile/Variable artifact 提供一致的 SDK 与批准依赖解析。
 *
 * `nbook/**` 固定投影到当前编译上下文；Runtime builtin 保持 external；其余 bare
 * package 必须从 compilerPackageRoot 解析后进入 bundle，禁止从 artifact 所在目录向上查找。
 * island package（native/运行时相对文件）改按编译期解析出的绝对路径 external——
 * artifact 与编译在同一运行环境执行，绝对路径不依赖 artifact 所在目录的向上查找，
 * 其内部可选依赖（jsdom 的 canvas/pnpapi、sharp 的 .node）由真实 package 形状自行处理。
 */
export function runtimeArtifactBundlePlugin(
    context: RuntimeArtifactCompilerContext,
    name: string,
): Plugin {
    const nodeModuleNames = new Set([
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
    ]);
    const requireFromImporterCache = new Map<string, NodeRequire>();
    /** `#` 前缀 subpath imports 按 importer 自身 package.json 的 imports 映射解析（Node 语义）。 */
    const requireFromImporter = (args: ResolveOptions): NodeRequire => {
        // `#` imports 只能出现在有 importer 的文件里；entry 调用拿不到时退回编译根目录锚点。
        const importerFile = args.importer
            || join(args.resolveDir || dirname(context.compilerPackageRoot), "index.js");
        let cached = requireFromImporterCache.get(importerFile);
        if (!cached) {
            cached = createRequire(pathToFileURL(importerFile));
            requireFromImporterCache.set(importerFile, cached);
        }
        return cached;
    };
    return {
        name,
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => ({
                path: resolveRuntimeArtifactNbookPath(
                    context,
                    args.path.replace(/^(nbook|neuro_book)\//, ""),
                ),
            }));
            buildApi.onResolve({filter: /^[^./].*/}, async (args) => {
                if (nodeModuleNames.has(args.path) || args.path === "bun" || args.path.startsWith("bun:")) {
                    return {path: args.path, external: true};
                }
                // `#` subpath imports 属于 importer 自己的 package（如 workspace 包的 #cache/*），
                // 不是 authoring 批准依赖，不参与 compilerPackageRoot 登记语义。
                if (args.path.startsWith("#")) {
                    try {
                        const resolved = requireFromImporter(args).resolve(args.path);
                        return isAbsolute(resolved)
                            ? {path: resolved}
                            : {path: args.path, external: true};
                    } catch {
                        return {
                            errors: [{
                                text: `Authoring Kit 无法解析 importer 私有 imports：${args.path}`,
                            }],
                        };
                    }
                }
                // build.resolve 的 import 语义兼容 import-only exports（如 pi-ai 只声明 import 条件，
                // createRequire 的 require 条件解析会 MODULE_NOT_FOUND）；pluginData 标记防止自递归。
                if ((args.pluginData as Record<string, unknown> | undefined)?.compilerRootResolve) return undefined;
                try {
                    const resolved = await buildApi.resolve(args.path, {
                        resolveDir: dirname(context.compilerPackageRoot),
                        importer: "",
                        kind: "import-statement",
                        pluginData: {compilerRootResolve: true},
                    });
                    // 解析失败时 build.resolve 不抛出而是返回空 path + errors——
                    // 空 path 落到 isAbsolute 分支会被误判为 builtin external，必须显式收口。
                    if (resolved.errors.length > 0 || !resolved.path) {
                        return {
                            errors: [{
                                text: `Authoring Kit 未登记依赖：${args.path}`,
                            }],
                        };
                    }
                    if (resolved.external || !isAbsolute(resolved.path)) return {path: args.path, external: true};
                    if (isRuntimeArtifactIslandPackage(args.path)) return {path: resolved.path, external: true};
                    return {path: resolved.path};
                } catch {
                    return {
                        errors: [{
                            text: `Authoring Kit 未登记依赖：${args.path}`,
                        }],
                    };
                }
            });
        },
    };
}
