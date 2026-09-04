import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import ts from 'typescript'
import {
  projectAuthoringDependencies,
  type AuthoringDependencyRegistration,
  type ProjectedAuthoringDependency,
  type ProjectedAuthoringDependencyInstance,
} from 'nbook/scripts/build/product-authoring-type-projection'
import { containsSourceRootDescendant } from 'nbook/scripts/build/product-source-path-contract'

export const AUTHORING_SDK_TYPE_PROJECTION_SCHEMA = 'nbook.authoring-sdk-type-projection/v1'

export const AUTHORING_SDK_DEPENDENCIES = [
  {
    name: 'typebox',
    kind: 'runtime',
    purpose: 'Profile 源码公开使用 Type 构造 schema，运行时 esbuild 需要读取实现与声明。',
    smoke: 'compile and import a Profile that uses Type.Object',
  },
  {
    name: '@types/node',
    kind: 'types',
    purpose: 'Profile SDK 声明引用 Node 类型。',
    smoke: 'typecheck Profile SDK declarations',
  },
  {
    name: 'undici-types',
    kind: 'types',
    purpose: '@types/node 的 fetch 声明引用 undici-types。',
    smoke: 'resolve Node fetch declarations',
  },
] as const satisfies readonly AuthoringDependencyRegistration[]

export type AuthoringSdkTypeProjectionResult = Readonly<{
  declarationFiles: number
  declarationBytes: number
  dependencyFiles: number
  dependencyBytes: number
  dependencies: readonly ProjectedAuthoringDependency[]
  dependencyInstances: readonly ProjectedAuthoringDependencyInstance[]
  inputFiles: readonly { path: string, sha256: string, bytes: number }[]
}>

export async function buildAuthoringSdkTypeProjection(
  input: { targetRoot: string },
): Promise<AuthoringSdkTypeProjectionResult> {
  const targetRoot = resolve(input.targetRoot)
  const typeRoot = resolve(targetRoot, 'types')
  const nodeModulesRoot = resolve(targetRoot, 'node_modules')
  const declarationDependencies = await emitAuthoringTypes(typeRoot)
  assertDeclaredTypeDependencies(declarationDependencies)
  await cp(resolve('proper-lockfile.d.ts'), resolve(typeRoot, 'proper-lockfile.d.ts'))
  const dependencyProjection = await projectAuthoringDependencies({
    // Authoring tsconfig 显式启用 Node globals；即使 SDK 声明没有直接 import，也必须投影其真实类型闭包。
    seedSpecifiers: new Set([
      ...[...declarationDependencies].filter(specifier => specifier !== 'proper-lockfile'),
      '@types/node',
    ]),
    targetNodeModulesRoot: nodeModulesRoot,
    registrations: AUTHORING_SDK_DEPENDENCIES,
    importerPath: resolve('profile-sdk', 'index.ts'),
  })
  await writeFile(resolve(targetRoot, 'tsconfig.json'), authoringSdkTsconfig(), 'utf8')

  const declarations = await directoryInventory(typeRoot)
  const dependencies = await directoryInventory(nodeModulesRoot)
  return {
    declarationFiles: declarations.files,
    declarationBytes: declarations.bytes,
    dependencyFiles: dependencies.files,
    dependencyBytes: dependencies.bytes,
    dependencies: dependencyProjection.dependencies,
    dependencyInstances: dependencyProjection.instances,
    inputFiles: await projectedInputFiles(targetRoot),
  }
}

export function authoringSdkTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      jsxImportSource: 'nbook/profile-sdk',
      strict: true,
      // Product 只保证批准依赖的公开声明可达；不为第三方 optional peer 伪造类型。
      skipLibCheck: true,
      baseUrl: '.',
      paths: {
        'nbook/profile-sdk': ['./types/profile-sdk/index.d.ts'],
        'nbook/profile-sdk/*': ['./types/profile-sdk/*'],
        'nbook/variable-sdk': ['./types/variable-sdk/index.d.ts'],
        'nbook/variable-sdk/*': ['./types/variable-sdk/*'],
        'nbook/*': ['./types/*'],
        '#cache/*': ['./types/packages/file-snapshot-cache/src/*'],
        'proper-lockfile': ['./types/proper-lockfile.d.ts'],
      },
      typeRoots: ['./node_modules/@types'],
      types: ['node'],
    },
    include: ['./types/**/*.d.ts', './types/**/*.d.mts', './sdk-source/**/*.ts'],
    exclude: ['./sdk-source/world-engine/schema/**/*.ts'],
  }, null, 4)}\n`
}

/**
 * 使用 TypeScript semantic gate 与声明 emitter 建立候选图，再从 SDK 公开入口精确投影可达声明。
 * `program.emit()` 会写出 Program 中所有源码；不能直接把那棵树当成 SDK 闭包。
 */
async function emitAuthoringTypes(typeRoot: string): Promise<Set<string>> {
  const root = resolve('.')
  const emittedRoot = resolve(dirname(typeRoot), '.types-emitted')
  await rm(emittedRoot, { recursive: true, force: true })
  await rm(typeRoot, { recursive: true, force: true })
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'nbook/profile-sdk',
    baseUrl: root,
    paths: { 'nbook/*': ['./*'] },
    rootDir: root,
    outDir: emittedRoot,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['bun', 'node'],
    skipLibCheck: true,
    strict: true,
    declaration: true,
    emitDeclarationOnly: true,
  }
  const roots = [
    resolve('profile-sdk', 'index.ts'),
    resolve('profile-sdk', 'contracts.ts'),
    resolve('profile-sdk', 'constructors.ts'),
    resolve('profile-sdk', 'writing.ts'),
    resolve('profile-sdk', 'jsx-runtime.ts'),
    resolve('profile-sdk', 'jsx-dev-runtime.ts'),
    resolve('variable-sdk', 'index.ts'),
    resolve('variable-sdk', 'contracts.ts'),
    resolve('server', 'agent', 'tools', 'web-extraction-modules.d.ts'),
  ]
  try {
    const program = ts.createProgram({ rootNames: roots, options })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length > 0) {
      throw new Error(ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }))
    }
    const emitted = program.emit()
    if (emitted.emitSkipped) throw new Error('Profile SDK declaration projection 没有完成。')
    return await copyReachableDeclarations(emittedRoot, typeRoot)
  }
  finally {
    await rm(emittedRoot, { recursive: true, force: true })
  }
}

/** 从声明入口沿静态 module specifier 复制闭包，并返回第三方类型依赖。 */
async function copyReachableDeclarations(emittedRoot: string, typeRoot: string): Promise<Set<string>> {
  const queue = [
    resolve(emittedRoot, 'profile-sdk', 'index.d.ts'),
    resolve(emittedRoot, 'profile-sdk', 'writing.d.ts'),
    resolve(emittedRoot, 'profile-sdk', 'jsx-runtime.d.ts'),
    resolve(emittedRoot, 'profile-sdk', 'jsx-dev-runtime.d.ts'),
    resolve(emittedRoot, 'variable-sdk', 'index.d.ts'),
    resolve(emittedRoot, 'variable-sdk', 'contracts.d.ts'),
  ]
  const visited = new Set<string>()
  const dependencies = new Set<string>()
  while (queue.length > 0) {
    const sourcePath = queue.shift()!
    if (visited.has(sourcePath)) continue
    visited.add(sourcePath)
    const emittedRelativePath = relative(emittedRoot, sourcePath)
    if (emittedRelativePath.startsWith('..') || extname(emittedRelativePath) === '') {
      throw new Error(`Authoring declaration 越出 emitter 根：${sourcePath}`)
    }
    const source = await readFile(sourcePath, 'utf8')
    assertAuthoringDeclarationSourcePaths(source, resolve('.'), emittedRelativePath)
    const targetPath = resolve(typeRoot, emittedRelativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await cp(sourcePath, targetPath)
    for (const specifier of declarationModuleSpecifiers(sourcePath, source)) {
      const internalPath = resolveInternalDeclaration(emittedRoot, sourcePath, specifier)
      if (internalPath) {
        queue.push(internalPath)
        continue
      }
      if (specifier.startsWith('nbook/') || specifier.startsWith('.') || specifier.startsWith('#cache/')) {
        throw new Error(`${emittedRelativePath} 引用了未投影声明：${specifier}`)
      }
      dependencies.add(specifier)
    }
  }
  return dependencies
}

/** 验证 Authoring 声明只包含可移植类型内容，不携带 Source Root 下的文件路径。 */
export function assertAuthoringDeclarationSourcePaths(
  source: string,
  sourceRoot: string,
  emittedRelativePath: string,
): void {
  if (containsSourceRootDescendant(source, sourceRoot)) {
    throw new Error(`Authoring declaration 泄漏构建机绝对路径：${emittedRelativePath}`)
  }
}

function declarationModuleSpecifiers(filePath: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const specifiers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text)
    }
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) {
      specifiers.add(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function resolveInternalDeclaration(emittedRoot: string, importer: string, specifier: string): string | null {
  let basePath: string
  if (specifier.startsWith('nbook/')) basePath = resolve(emittedRoot, specifier.slice('nbook/'.length))
  else if (specifier.startsWith('#cache/')) basePath = resolve(emittedRoot, 'packages', 'file-snapshot-cache', 'src', specifier.slice('#cache/'.length))
  else if (specifier.startsWith('.')) basePath = resolve(dirname(importer), specifier)
  else return null
  const sourceExtension = /\.(?:tsx?|mts|cts|mjs|cjs|js)$/u.exec(basePath)?.[0]
  const extensionlessPath = sourceExtension ? basePath.slice(0, -sourceExtension.length) : basePath
  return [
    `${extensionlessPath}.d.ts`,
    `${extensionlessPath}.d.mts`,
    `${extensionlessPath}.d.cts`,
    resolve(basePath, 'index.d.ts'),
    resolve(basePath, 'index.d.mts'),
    resolve(basePath, 'index.d.cts'),
  ].find(candidate => existsSync(candidate)) ?? null
}

function assertDeclaredTypeDependencies(specifiers: Set<string>): void {
  const allowedPackages = new Set(AUTHORING_SDK_DEPENDENCIES.map(dependency => dependency.name))
  const unsupported = [...specifiers].filter((specifier) => {
    if (specifier.startsWith('node:') || specifier === 'proper-lockfile') return false
    const segments = specifier.split('/')
    const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
    return !allowedPackages.has(packageName)
  })
  if (unsupported.length > 0) {
    throw new Error(`Authoring declaration 含未登记第三方依赖：\n${unsupported.sort().map(name => `- ${name}`).join('\n')}`)
  }
}

async function directoryInventory(root: string): Promise<{ files: number, bytes: number }> {
  let files = 0
  let bytes = 0
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(filePath)
      else if (entry.isFile()) {
        files += 1
        bytes += (await stat(filePath)).size
      }
      else throw new Error(`Authoring Kit 含特殊文件：${filePath}`)
    }
  }
  await walk(root)
  return { files, bytes }
}

/** 返回相对于投影根的稳定完整文件 inventory，供 Source cache manifest 逐项验证。 */
async function projectedInputFiles(targetRoot: string): Promise<Array<{ path: string, sha256: string, bytes: number }>> {
  const files: Array<{ path: string, sha256: string, bytes: number }> = []
  const collectFile = async (filePath: string): Promise<void> => {
    const contents = await readFile(filePath)
    files.push({
      path: relative(targetRoot, filePath).split(/[\\/]+/u).join('/'),
      sha256: createHash('sha256').update(contents).digest('hex'),
      bytes: contents.length,
    })
  }
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(filePath)
      else if (entry.isFile()) await collectFile(filePath)
      else throw new Error(`Authoring type projection 含特殊文件：${filePath}`)
    }
  }
  await collectFile(resolve(targetRoot, 'tsconfig.json'))
  await walk(resolve(targetRoot, 'types'))
  await walk(resolve(targetRoot, 'node_modules'))
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
