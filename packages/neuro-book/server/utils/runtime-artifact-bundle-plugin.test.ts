import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {build} from "esbuild";
import {runtimeArtifactBundlePlugin} from "nbook/server/utils/runtime-artifact-bundle-plugin";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Runtime Artifact bundle plugin", () => {
    it("批准包根缺少依赖时不向 importer 祖先回退", async () => {
        const root = await mkdtemp(testHostPath("nbook-authoring-plugin-"));
        roots.push(root);
        const packageRoot = join(root, "authoring", "package.json");
        await mkdir(join(root, "authoring"), {recursive: true});
        await writeFile(packageRoot, `${JSON.stringify({name: "fixture-authoring", private: true})}\n`, "utf8");
        const context: RuntimeArtifactCompilerContext = {
            kind: "product-candidate",
            root,
            productRuntime: true,
            imageRoot: root,
            outputRoot: root,
            nbookRoot: resolve("."),
            compilerPackageRoot: packageRoot,
            compilerNodeModulesRoot: join(root, "authoring", "node_modules"),
            artifactRuntimeRequireRoot: join(root, "server", "index.mjs"),
            tsconfigPath: resolve("tsconfig.json"),
        };

        await expect(build({
            bundle: true,
            entryPoints: [resolve("variable-sdk", "index.ts")],
            logLevel: "silent",
            outfile: join(root, "output.mjs"),
            plugins: [runtimeArtifactBundlePlugin(context, "fixture-authoring")],
            platform: "node",
        })).rejects.toThrow("Authoring Kit 未登记依赖：typebox");
    });

    /** 构造带 compilerPackageRoot 与 authoring/node_modules 的 fixture 编译上下文。 */
    async function fixtureContext(root: string): Promise<RuntimeArtifactCompilerContext> {
        const authoringRoot = join(root, "authoring");
        await mkdir(join(authoringRoot, "node_modules"), {recursive: true});
        const packageRoot = join(authoringRoot, "package.json");
        await writeFile(packageRoot, `${JSON.stringify({name: "fixture-authoring", private: true})}\n`, "utf8");
        return {
            kind: "product-candidate",
            root,
            productRuntime: true,
            imageRoot: root,
            outputRoot: root,
            nbookRoot: resolve("."),
            compilerPackageRoot: packageRoot,
            compilerNodeModulesRoot: join(authoringRoot, "node_modules"),
            artifactRuntimeRequireRoot: join(root, "server", "index.mjs"),
            tsconfigPath: resolve("tsconfig.json"),
        };
    }

    it("import-only exports 的批准依赖可解析进 bundle（pi-ai 型）", async () => {
        const root = await mkdtemp(testHostPath("nbook-authoring-plugin-esm-"));
        roots.push(root);
        const context = await fixtureContext(root);
        const packageDir = join(root, "authoring", "node_modules", "fixture-esm-only");
        await mkdir(packageDir, {recursive: true});
        await writeFile(join(packageDir, "package.json"), JSON.stringify({
            name: "fixture-esm-only",
            version: "1.0.0",
            exports: {".": {import: "./index.js"}},
        }), "utf8");
        await writeFile(join(packageDir, "index.js"), "export const marker = 'esm-only-marker';\n", "utf8");
        const entry = join(root, "entry.ts");
        await writeFile(entry, 'import {marker} from "fixture-esm-only";\nexport default marker;\n', "utf8");

        const outfile = join(root, "output.mjs");
        await build({
            bundle: true,
            entryPoints: [entry],
            logLevel: "silent",
            outfile,
            plugins: [runtimeArtifactBundlePlugin(context, "fixture-authoring")],
            platform: "node",
        });
        const output = await readFile(outfile, "utf8");
        expect(output).toContain("esm-only-marker");
    });

    it("importer 私有 `#` subpath imports 按其自身 package 解析", async () => {
        const root = await mkdtemp(testHostPath("nbook-authoring-plugin-hash-"));
        roots.push(root);
        const context = await fixtureContext(root);
        const packageDir = join(root, "authoring", "node_modules", "fixture-workspace-pkg");
        await mkdir(join(packageDir, "src"), {recursive: true});
        await writeFile(join(packageDir, "package.json"), JSON.stringify({
            name: "fixture-workspace-pkg",
            version: "1.0.0",
            exports: {".": "./src/index.js"},
            imports: {"#inner/*": "./src/*.js"},
        }), "utf8");
        await writeFile(join(packageDir, "src", "index.js"), 'export {innerValue} from "#inner/value";\n', "utf8");
        await writeFile(join(packageDir, "src", "value.js"), "export const innerValue = 'hash-import-marker';\n", "utf8");
        const entry = join(root, "entry.ts");
        await writeFile(entry, 'import {innerValue} from "fixture-workspace-pkg";\nexport default innerValue;\n', "utf8");

        const outfile = join(root, "output.mjs");
        await build({
            bundle: true,
            entryPoints: [entry],
            logLevel: "silent",
            outfile,
            plugins: [runtimeArtifactBundlePlugin(context, "fixture-authoring")],
            platform: "node",
        });
        const output = await readFile(outfile, "utf8");
        expect(output).toContain("hash-import-marker");
    });

    it("island package 不冻结进 bundle，按编译期解析绝对路径 external", async () => {
        const root = await mkdtemp(testHostPath("nbook-authoring-plugin-island-"));
        roots.push(root);
        const context = await fixtureContext(root);
        const packageDir = join(root, "authoring", "node_modules", "jsdom");
        await mkdir(join(packageDir, "lib"), {recursive: true});
        await writeFile(join(packageDir, "package.json"), JSON.stringify({
            name: "jsdom",
            version: "0.0.0-fixture",
            main: "./lib/api.js",
        }), "utf8");
        await writeFile(join(packageDir, "lib", "api.js"), "module.exports = {marker: 'jsdom-should-not-be-bundled'};\n", "utf8");
        const entry = join(root, "entry.ts");
        await writeFile(entry, 'import jsdom from "jsdom";\nexport default jsdom;\n', "utf8");

        const outfile = join(root, "output.mjs");
        await build({
            bundle: true,
            entryPoints: [entry],
            logLevel: "silent",
            outfile,
            plugins: [runtimeArtifactBundlePlugin(context, "fixture-authoring")],
            platform: "node",
        });
        const output = await readFile(outfile, "utf8");
        expect(output).not.toContain("jsdom-should-not-be-bundled");
        expect(output).toContain(join(packageDir, "lib", "api.js"));
    });
});
