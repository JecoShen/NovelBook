import fs from "node:fs";
import fsp from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import process from "node:process";
import type * as TypeScript from "typescript";
import {
    compileProfileArtifacts,
    readProfileArtifactManifest,
    validateProfileArtifact,
    type ProfileArtifactManifestFailureItem,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {previewAgentProfilePrepare, readAgentProfileDetail} from "nbook/server/agent/profiles/profile-http-service";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {generateBuiltinVariableTypes} from "nbook/server/agent/variables/generated-types";
import {builtinVariableDefinitions} from "nbook/server/agent/variables/registry";
import {readVariableDefinitionManifest, VARIABLE_DEFINITION_COMPILED_DIR} from "nbook/server/agent/variables/definition-artifact";
import {resolveApplicationRoot, resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {resolveStateRoot} from "nbook/server/runtime/installation-paths";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {prepareAuthoringCacheLease} from "nbook/server/runtime/authoring-cache";
import {validateRuntimeArtifactAuthoring} from "nbook/server/utils/runtime-artifact-authoring-interface";

const runtimeRequire = createRequire(import.meta.url);
const ts = runtimeRequire("typescript") as typeof TypeScript;

type ProfileCommand = "status" | "check" | "compile" | "preview";

type CliOptions = {
    command: ProfileCommand;
    target?: string;
    all: boolean;
    system: boolean;
    input?: JsonValue;
    sessionId?: string;
    projectRoot?: string;
    strictVariables: boolean;
};

const APPLICATION_ROOT = resolveApplicationRoot();
process.chdir(APPLICATION_ROOT);

const SYSTEM_NBOOK_ROOT = resolveSystemNbookRoot(APPLICATION_ROOT);
const USER_NBOOK_ROOT = resolveUserNbookRoot(APPLICATION_ROOT);
const SYSTEM_PROFILE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "profiles");
const USER_PROFILE_ROOT = path.join(USER_NBOOK_ROOT, "agent", "profiles");
const SYSTEM_VARIABLE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "variables");
const USER_VARIABLE_ROOT = path.join(USER_NBOOK_ROOT, "agent", "variables");

await main();

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        process.exitCode = 1;
        return;
    }
    try {
        switch (options.command) {
            case "status":
                await runStatus(options);
                return;
            case "check":
                await runCheck(options);
                return;
            case "compile":
                await runCompile(options);
                return;
            case "preview":
                await runPreview(options);
                return;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): CliOptions | null {
    const command = args.shift() as ProfileCommand | undefined;
    if (!command || !["status", "check", "compile", "preview"].includes(command)) {
        printUsage();
        return null;
    }
    const options: CliOptions = {
        command,
        all: false,
        system: false,
        strictVariables: false,
    };
    while (args.length > 0) {
        const arg = args.shift();
        if (!arg) {
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printUsage();
            return null;
        }
        if (arg === "--all") {
            options.all = true;
            continue;
        }
        if (arg === "--system") {
            options.system = true;
            continue;
        }
        if (arg === "--strict-variables") {
            options.strictVariables = true;
            continue;
        }
        if (arg === "--project") {
            const value = args.shift();
            if (!value) {
                throw new Error("--project 需要单段 Project Root。");
            }
            options.projectRoot = projectWorkspaceRef(value).projectRoot;
            continue;
        }
        if (arg === "--input-json") {
            const value = args.shift();
            if (!value) {
                throw new Error("--input-json 需要一个 JSON 字符串。");
            }
            options.input = JSON.parse(value) as JsonValue;
            continue;
        }
        if (arg === "--session-id") {
            const value = args.shift();
            if (!value) {
                throw new Error("--session-id 需要一个 session id。");
            }
            options.sessionId = value;
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`未知参数：${arg}`);
        }
        if (options.target) {
            throw new Error(`只能指定一个 profile 目标，多余参数：${arg}`);
        }
        options.target = arg;
    }
    if (!options.all && !options.target) {
        throw new Error(`${command} 需要指定 fileName/profileKey，或使用 --all。`);
    }
    return options;
}

async function runStatus(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    const manifest = await readProfileArtifactManifest(target.root);
    const sourceFiles = options.all ? await findProfileFiles(target.root) : target.fileName ? [target.fileName] : [];
    const entries = options.all
        ? manifest.entries.filter((item) => sourceFiles.includes(item.fileName))
        : manifest.entries.filter((item) => item.fileName === target.fileName || item.profileKey === target.profileKey);
    const missingFiles = sourceFiles.filter((fileName) => !entries.some((item) => item.fileName === fileName));
    if (entries.length === 0 && missingFiles.length === 0) {
        console.log("profile status: not_compiled");
        console.log(`profile root: ${target.rootKind}`);
        if (target.fileName) {
            console.log(`profile fileName: ${target.fileName}`);
        }
        process.exitCode = 1;
        return;
    }
    let failed = false;
    for (const fileName of missingFiles) {
        console.log(`${fileName}: not_compiled`);
        failed = true;
    }
    for (const item of entries) {
        if (item.status === "compile_failed") {
            console.log(`${item.profileKey}: compile_failed`);
            console.log(`  fileName: ${item.fileName}`);
            for (const issue of item.issues) console.log(`  [${issue.code}] ${issue.message}`);
            failed = true;
            continue;
        }
        const validation = await validateProfileArtifact(target.root, item);
        console.log(`${item.profileKey}: ${validation.fresh ? "loaded" : "compile_stale"}`);
        console.log(`  fileName: ${item.fileName}`);
        console.log(`  artifact: ${item.artifactFileName}`);
        if (!validation.fresh) {
            failed = true;
            console.log(`  reason: ${validation.reason}`);
        }
    }
    if (failed) process.exitCode = 1;
}

async function runCheck(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    if (!await runTypechecks(target, options)) {
        process.exitCode = 1;
        return;
    }
    const catalog = catalogForOptions(options);
    const snapshot = await catalog.snapshot();
    const issueTarget = target.profileKey ?? target.fileName;
    const issues = snapshot.issues.filter((issue) => issue.profileKey === issueTarget || relativeInside(target.root, issue.sourcePath ?? "") === target.fileName);
    for (const issue of issues) {
        console.log(`[${issue.code}] ${issue.message}`);
    }
    if (issues.some((issue) => issue.code !== "filename_mismatch" && issue.code !== "builtin_schema_locked" && issue.code !== "system_profile_shadowed" && issue.code !== "not_compiled" && issue.code !== "compile_stale")) {
        process.exitCode = 1;
        return;
    }
    console.log("profile check passed");
}

async function runCompile(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    if (!await runTypechecks(target, options)) {
        process.exitCode = 1;
        return;
    }
    const result = await compileProfileArtifacts({
        profileRoot: target.root,
        fileName: options.all ? undefined : target.fileName,
        rootLabel: target.rootKind === "system" ? "assets/workspace/.nbook/agent/profiles" : "workspace/.nbook/agent/profiles",
    });
    const failures = result.manifest.entries.filter((item): item is ProfileArtifactManifestFailureItem => item.status === "compile_failed"
        && (options.all || item.fileName === target.fileName || item.profileKey === target.profileKey));
    console.log(`profile compile wrote ${result.compiled.length} artifact(s)`);
    for (const item of result.compiled) {
        console.log(`- ${item.profileKey}: ${item.fileName} -> .compiled/${item.artifactFileName}`);
        if (item.typeFileName) {
            console.log(`  types: .compiled/${item.typeFileName}`);
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
        }
    }
    for (const item of failures) {
        console.log(`- ${item.profileKey}: ${item.fileName} -> compile_failed`);
        for (const issue of item.issues) console.log(`  [${issue.code}] ${issue.message}`);
    }
    if (failures.length > 0) process.exitCode = 1;
}

async function runPreview(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    if (options.all) {
        throw new Error("profile preview 不支持 --all，请指定一个 fileName 或 profileKey。");
    }
    const {catalog, profileKey, cleanup} = await compilePreviewCatalog(options, target);
    const runtimePaths = runtimePathsFromEnv();
    const preview = await previewAgentProfilePrepare(
        new NeuroAgentHarness({runtimePaths, profiles: catalog}),
        {
            profileKey,
            initial: options.input,
            sessionId: options.sessionId,
        },
    ).finally(cleanup);
    console.log(`preview ok: ${preview.ok ? "yes" : "no"}`);
    for (const issue of preview.issues) {
        console.log(`[${issue.severity}] ${issue.code ?? "issue"}: ${issue.message}`);
    }
    for (const message of preview.messages) {
        console.log(`\n## ${message.source ?? message.role}`);
        console.log(message.text);
    }
    if (!preview.ok || preview.issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
}

async function compilePreviewCatalog(
    options: CliOptions,
    target: Awaited<ReturnType<typeof resolveTarget>>,
): Promise<{
    catalog: AgentProfileCatalog;
    profileKey: string;
    cleanup: () => Promise<void>;
}> {
    if (!target.fileName || !target.filePath) {
        throw new Error("profile preview 需要能定位到源码文件，请传 fileName 或可从源码定位的 profileKey。");
    }
    return prepareAuthoringCacheLease(runtimePathsFromEnv().cacheRoot, "profile-preview", async (lease) => {
        const temporaryRoot = lease.root;
        const systemRoot = options.system ? temporaryRoot : SYSTEM_PROFILE_ROOT;
        const userRoot = options.system ? path.resolve(".agent", "missing-user-profiles") : temporaryRoot;
        await fsp.cp(target.root, temporaryRoot, {recursive: true, force: true});
        const result = await compileProfileArtifacts({
            profileRoot: temporaryRoot,
            fileName: target.fileName,
            rootLabel: "temporary-profile-cli-preview",
        });
        const failed = result.manifest.entries.find((entry): entry is ProfileArtifactManifestFailureItem => entry.fileName === target.fileName
            && entry.status === "compile_failed");
        if (failed) {
            throw new Error([
                `profile preview 编译失败：${target.fileName}`,
                ...failed.issues.map((issue) => `[${issue.code}] ${issue.message}`),
            ].join("\n"));
        }
        if (!result.compiled.some((entry) => entry.fileName === target.fileName)) {
            throw new Error(`profile preview 没有生成目标 artifact：${target.fileName}`);
        }
        const manifest = await readProfileArtifactManifest(temporaryRoot);
        const item = manifest.profiles.find((profile) => profile.fileName === target.fileName);
        if (!item) {
            throw new Error(`profile preview 无法从源码读取 profile key：${target.fileName}`);
        }
        return {
            catalog: new AgentProfileCatalog(systemRoot, userRoot),
            profileKey: item.profileKey,
            cleanup: lease.close,
        };
    });
}

function catalogForOptions(options: CliOptions): AgentProfileCatalog {
    if (options.system) {
        return new AgentProfileCatalog(SYSTEM_PROFILE_ROOT, path.resolve(".agent", "missing-user-profiles"));
    }
    return new AgentProfileCatalog(SYSTEM_PROFILE_ROOT, USER_PROFILE_ROOT);
}

async function resolveTarget(options: CliOptions): Promise<{
    root: string;
    rootKind: "system" | "user";
    fileName?: string;
    filePath?: string;
    profileKey?: string;
    manifestProfileKey?: string;
}> {
    const root = options.system ? SYSTEM_PROFILE_ROOT : USER_PROFILE_ROOT;
    const rootKind = options.system ? "system" as const : "user" as const;
    if (options.all) {
        return {root, rootKind};
    }
    const target = options.target!;
    const fileName = await resolveFileName(root, target);
    if (fileName) {
        const manifest = await readProfileArtifactManifest(root);
        const manifestItem = manifest.profiles.find((item) => item.fileName === fileName);
        return {
            root,
            rootKind,
            fileName,
            filePath: path.join(root, ...fileName.split("/")),
            manifestProfileKey: manifestItem?.profileKey,
        };
    }
    return {
        root,
        rootKind,
        profileKey: target,
    };
}

async function resolveFileName(root: string, target: string): Promise<string | null> {
    const normalized = target.split(/[\\/]+/).filter(Boolean).join("/");
    const direct = path.join(root, ...normalized.split("/"));
    if (/\.profile\.(tsx|ts|mjs|js)$/.test(path.basename(normalized)) && fs.existsSync(direct)) {
        return normalized;
    }
    const manifest = await readProfileArtifactManifest(root);
    const manifestItem = manifest.profiles.find((item) => item.profileKey === target);
    if (manifestItem) {
        return manifestItem.fileName;
    }
    return findProfileByKey(root, target);
}

async function findProfileByKey(root: string, profileKey: string): Promise<string | null> {
    const direct = `${profileKey}.profile.tsx`;
    if (fs.existsSync(path.join(root, direct))) {
        return direct;
    }
    const files = await findProfileFiles(root);
    for (const fileName of files) {
        const source = await fsp.readFile(path.join(root, ...fileName.split("/")), "utf8").catch(() => "");
        if (source.includes(`key: ${JSON.stringify(profileKey)}`) || source.includes(`key:${JSON.stringify(profileKey)}`)) {
            return fileName;
        }
    }
    return null;
}

async function findProfileFiles(root: string, current: string = root): Promise<string[]> {
    const entries = await fsp.readdir(current, {withFileTypes: true}).catch(() => []);
    const result: string[] = [];
    for (const entry of entries) {
        if (entry.name === ".compiled") {
            continue;
        }
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
            result.push(...await findProfileFiles(root, fullPath));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            result.push(path.relative(root, fullPath).split(path.sep).join("/"));
        }
    }
    return result.sort((left, right) => left.localeCompare(right));
}

type VariableTypeEnvironment = {
    typeFiles: string[];
    knownPaths: Set<string>;
    cleanup: () => Promise<void>;
};

type VariablePathDiagnostic = {
    severity: "warning" | "error";
    path: string;
    message: string;
};

async function runTypechecks(target: Awaited<ReturnType<typeof resolveTarget>>, options: CliOptions): Promise<boolean> {
    if (target.filePath) {
        return runTypecheckFiles([target.filePath], target, options);
    }
    if (!options.all) {
        return true;
    }
    const files = await findProfileFiles(target.root);
    return runTypecheckFiles(files.map((fileName) => path.join(target.root, ...fileName.split("/"))), target, options);
}

async function runTypecheckFiles(filePaths: string[], target: Awaited<ReturnType<typeof resolveTarget>>, options: CliOptions): Promise<boolean> {
    const checkedFilePaths = filePaths.filter((filePath) => /\.(tsx|ts)$/.test(filePath));
    if (checkedFilePaths.length === 0) {
        return true;
    }
    for (const filePath of checkedFilePaths) {
        await validateRuntimeArtifactAuthoring({
            kind: "profile",
            root: target.root,
            entry: filePath,
            allowedSdkSpecifiers: ["nbook/profile-sdk", "nbook/profile-sdk/writing", "nbook/profile-sdk/workspace", "nbook/profile-sdk/runtime-paths"],
        });
    }
    const variableTypes = await prepareVariableTypeEnvironment(target, options);
    try {
        const configPath = (await resolveRuntimeArtifactCompilerContext()).tsconfigPath;
        if (!configPath) {
            console.error("未找到 tsconfig.json");
            return false;
        }
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        if (configFile.error) {
            printDiagnostics([configFile.error]);
            return false;
        }
        const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
        const compilerOptions = withRuntimeTypecheckPaths({
            ...config.options,
            noEmit: true,
            skipLibCheck: true,
        }, configPath);
        const program = ts.createProgram({
            rootNames: [...checkedFilePaths, ...config.fileNames.filter((item) => item.endsWith(".d.ts")), ...variableTypes.typeFiles],
            options: compilerOptions,
        });
        const generatedTypeFiles = new Set(variableTypes.typeFiles.map((item) => path.resolve(item)));
        const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
            const fileName = diagnostic.file?.fileName;
            return !fileName
                || generatedTypeFiles.has(path.resolve(fileName))
                || Boolean(relativeInside(SYSTEM_PROFILE_ROOT, fileName) || relativeInside(USER_PROFILE_ROOT, fileName));
        });
        const variableDiagnostics = checkedFilePaths.flatMap((filePath) => collectVariablePathDiagnostics(filePath, variableTypes.knownPaths, options.strictVariables));
        if (diagnostics.length > 0) {
            printDiagnostics(diagnostics);
            return false;
        }
        for (const diagnostic of variableDiagnostics) {
            console.log(`[${diagnostic.severity}] ${diagnostic.message}`);
        }
        return !variableDiagnostics.some((diagnostic) => diagnostic.severity === "error");
    } finally {
        await variableTypes.cleanup();
    }
}

/**
 * Product Root 不带根 node_modules；profile typecheck 需要从 Nitro vendor
 * 解析第三方类型声明。
 */
function withRuntimeTypecheckPaths(options: TypeScript.CompilerOptions, configPath: string): TypeScript.CompilerOptions {
    if (fs.existsSync(path.resolve(process.cwd(), "node_modules"))) {
        return options;
    }
    const runtimeNodeModules = path.resolve(process.cwd(), ".output", "server", "node_modules");
    if (!fs.existsSync(runtimeNodeModules)) {
        return options;
    }
    const runtimePattern = `${path.relative(path.dirname(configPath), runtimeNodeModules).split(/[\\/]+/).join("/")}/*`;
    const paths = options.paths ?? {};
    const starPaths = paths["*"] ?? [];
    if (starPaths.includes(runtimePattern)) {
        return options;
    }
    return {
        ...options,
        paths: {
            ...paths,
            "*": [...starPaths, runtimePattern],
        },
    };
}

async function prepareVariableTypeEnvironment(target: Awaited<ReturnType<typeof resolveTarget>>, options: CliOptions): Promise<VariableTypeEnvironment> {
    return prepareAuthoringCacheLease(runtimePathsFromEnv().cacheRoot, "profile-variable-types", async (lease) => {
        const tempRoot = lease.root;
        const typeFiles: string[] = [];
        const knownPaths = new Set<string>();

        const builtinTypes = generateBuiltinVariableTypes();
        const builtinTypePath = path.join(tempRoot, "builtin.d.ts");
        await fsp.writeFile(builtinTypePath, builtinTypes.text, "utf8");
        typeFiles.push(builtinTypePath);
        for (const definition of builtinVariableDefinitions()) {
            knownPaths.add(`${definition.namespace}.${definition.key}`);
        }
        for (const diagnostic of builtinTypes.diagnostics) {
            console.log(`[${diagnostic.severity}] ${diagnostic.message}`);
        }

        await collectVariableDefinitionTypes(options.system ? SYSTEM_VARIABLE_ROOT : USER_VARIABLE_ROOT, knownPaths, typeFiles);
        if (options.projectRoot) {
            await collectVariableDefinitionTypes(
                path.resolve(resolveStateRoot(), "workspace", options.projectRoot, ".nbook", "agent", "variables"),
                knownPaths,
                typeFiles,
            );
        }
        await collectProfileSessionTypes(target, knownPaths, typeFiles, tempRoot);

        return {
            typeFiles,
            knownPaths,
            cleanup: lease.close,
        };
    });
}

async function collectVariableDefinitionTypes(root: string, knownPaths: Set<string>, typeFiles: string[]): Promise<void> {
    const manifest = await readVariableDefinitionManifest(root);
    for (const item of manifest.definitions) {
        for (const registeredPath of item.registeredPaths) {
            knownPaths.add(registeredPath);
        }
        if (item.typeFileName) {
            const typePath = path.join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.typeFileName);
            if (fs.existsSync(typePath)) {
                typeFiles.push(typePath);
            }
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`[${diagnostic.severity}] ${diagnostic.message}`);
        }
    }
}

async function collectProfileSessionTypes(target: Awaited<ReturnType<typeof resolveTarget>>, knownPaths: Set<string>, typeFiles: string[], tempRoot: string): Promise<void> {
    const temporaryProfileRoot = target.fileName || !target.profileKey ? path.join(tempRoot, "profiles") : null;
    const manifestRoot = temporaryProfileRoot ?? target.root;
    if (temporaryProfileRoot) {
        try {
            await fsp.cp(target.root, temporaryProfileRoot, {recursive: true, force: true});
            await compileProfileArtifacts({
                profileRoot: temporaryProfileRoot,
                fileName: target.fileName,
                rootLabel: "temporary-profile-variable-types",
            });
        } catch {
            // Type extraction is best-effort. The normal profile typecheck/catalog path reports real errors.
        }
    }
    const manifest = await readProfileArtifactManifest(manifestRoot);
    const items = target.fileName
        ? manifest.profiles.filter((profile) => profile.fileName === target.fileName)
        : target.profileKey
            ? manifest.profiles.filter((profile) => profile.profileKey === target.profileKey)
            : manifest.profiles;
    for (const item of items) {
        for (const registeredPath of item.registeredVariablePaths ?? []) {
            knownPaths.add(registeredPath);
        }
        if (item.typeFileName) {
            const typePath = path.join(manifestRoot, ".compiled", item.typeFileName);
            if (fs.existsSync(typePath)) {
                typeFiles.push(typePath);
            }
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`[${diagnostic.severity}] ${diagnostic.message}`);
        }
    }
}

function collectVariablePathDiagnostics(filePath: string, knownPaths: Set<string>, strict: boolean): VariablePathDiagnostic[] {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const paths = new Set<string>();
    const visit = (node: TypeScript.Node) => {
        collectVariablePathLiteral(node, sourceFile, paths);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return [...paths]
        .filter((pathValue) => !knownPaths.has(pathValue))
        .sort((left, right) => left.localeCompare(right))
        .map((pathValue) => ({
            severity: strict ? "error" as const : "warning" as const,
            path: pathValue,
            message: `变量 path 未注册：${pathValue}${strict ? "" : "（默认只警告；使用 --strict-variables 可作为错误处理）"}`,
        }));
}

function collectVariablePathLiteral(node: TypeScript.Node, sourceFile: TypeScript.SourceFile, paths: Set<string>): void {
    if (ts.isCallExpression(node)) {
        collectCtxVarsCallPath(node, sourceFile, paths);
        collectDslObjectPath(node, paths);
        return;
    }
    if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(sourceFile);
        if (name === "path" || name === "watchPath") {
            const literal = jsxAttributeString(node.initializer);
            if (literal && isVariablePath(literal)) {
                paths.add(literal);
            }
        }
        if (name === "paths") {
            for (const literal of jsxAttributeStringArray(node.initializer)) {
                if (isVariablePath(literal)) {
                    paths.add(literal);
                }
            }
        }
    }
}

function collectCtxVarsCallPath(node: TypeScript.CallExpression, sourceFile: TypeScript.SourceFile, paths: Set<string>): void {
    if (!ts.isPropertyAccessExpression(node.expression)) {
        return;
    }
    const method = node.expression.name.text;
    if (method !== "get" && method !== "read") {
        return;
    }
    if (!node.expression.expression.getText(sourceFile).endsWith(".vars")) {
        return;
    }
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg) && isVariablePath(firstArg.text)) {
        paths.add(firstArg.text);
    }
}

function collectDslObjectPath(node: TypeScript.CallExpression, paths: Set<string>): void {
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "Reminder") {
        return;
    }
    const firstArg = node.arguments[0];
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) {
        return;
    }
    for (const property of firstArg.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }
        const name = propertyNameText(property.name);
        if ((name === "path" || name === "watchPath") && ts.isStringLiteral(property.initializer) && isVariablePath(property.initializer.text)) {
            paths.add(property.initializer.text);
        }
        if (name === "paths" && ts.isArrayLiteralExpression(property.initializer)) {
            for (const item of property.initializer.elements) {
                if (ts.isStringLiteral(item) && isVariablePath(item.text)) {
                    paths.add(item.text);
                }
            }
        }
    }
}

function propertyNameText(name: TypeScript.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return null;
}

function jsxAttributeString(initializer: TypeScript.JsxAttribute["initializer"]): string | null {
    if (!initializer) {
        return null;
    }
    if (ts.isStringLiteral(initializer)) {
        return initializer.text;
    }
    if (ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteral(initializer.expression)) {
        return initializer.expression.text;
    }
    return null;
}

function jsxAttributeStringArray(initializer: TypeScript.JsxAttribute["initializer"]): string[] {
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression || !ts.isArrayLiteralExpression(initializer.expression)) {
        return [];
    }
    return initializer.expression.elements.flatMap((item) => ts.isStringLiteral(item) ? [item.text] : []);
}

function isVariablePath(value: string): boolean {
    return /^(client|global|project|session)\.[A-Za-z0-9_.-]+$/.test(value);
}

function printDiagnostics(diagnostics: readonly TypeScript.Diagnostic[]): void {
    const host: TypeScript.FormatDiagnosticsHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => ts.sys.newLine,
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}

function relativeInside(root: string, filePath: string): string | null {
    if (!filePath) {
        return null;
    }
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return null;
    }
    return relativePath.split(path.sep).join("/");
}

function printUsage(): void {
    console.error("用法：profile <status|check|compile|preview> <fileName|profileKey> [--system] [--all] [--project <projectRoot>] [--strict-variables]");
    console.error("示例：profile compile builtin/leader.default.profile.tsx --system");
}
