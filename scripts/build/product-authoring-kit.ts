import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { init, parse } from 'es-module-lexer'
import {
  assertAuthoringDeclarationSourcePaths,
  buildAuthoringSdkTypeProjection,
} from 'nbook/scripts/build/authoring-sdk-type-projection'
import {
  productPiAiImportPlugin,
  productRuntimeCompatibilityPlugin,
} from 'nbook/scripts/build/product-bundle-plugins'
import {
  bundleProductJavaScript,
  productBundleOutputText,
} from 'nbook/scripts/build/product-reproducible-bundle'
import { productRuntimeIslandPackageNames } from 'nbook/scripts/build/product-runtime-islands'
import type { ProjectedAuthoringDependency } from 'nbook/scripts/build/product-authoring-type-projection'

export { assertAuthoringDeclarationSourcePaths }

export type ProductAuthoringKitResult = {
  compilerBytes: number
  sdkBytes: number
  typeBytes: number
  typeFiles: number
  dependencies: ProductAuthoringDependency[]
}

export type ProductAuthoringDependency = ProjectedAuthoringDependency

/**
 * 建立与 Product revision 绑定的 Profile Authoring Kit。
 *
 * worker 实现被 bundle 成一个确定性入口；SDK 保留源码与专用 tsconfig，供运行时
 * esbuild 编译用户 Profile。这里不复制完整 server/app/docs 或通用 node_modules。
 */
export async function buildProductAuthoringKit(outputRoot: string): Promise<ProductAuthoringKitResult> {
  const serverRoot = resolve(outputRoot, 'server')
  const kitRoot = resolve(serverRoot, 'authoring')
  const compilerPath = resolve(kitRoot, 'profile-compile-worker.mjs')
  const nbookRoot = resolve(kitRoot, 'nbook')
  const sdkSourceRoot = resolve(kitRoot, 'sdk-source')
  await rm(kitRoot, { recursive: true, force: true })
  await mkdir(nbookRoot, { recursive: true })
  await mkdir(sdkSourceRoot, { recursive: true })

  const result = await bundleProductJavaScript({
    entryPoints: [resolve('server', 'agent', 'profiles', 'profile-compile-worker-entry.ts')],
    outfile: compilerPath,
    write: false,
    plugins: [productPiAiImportPlugin(), productRuntimeCompatibilityPlugin()],
    external: [
      'bun',
      'bun:*',
      ...productRuntimeIslandPackageNames().flatMap(packageName => [packageName, `${packageName}/*`]),
    ],
  })
  await writeFile(
    compilerPath,
    productBundleOutputText(result, 'Profile compiler bundle'),
    'utf8',
  )

  const sdkEntries = [
    { name: 'profile-sdk', files: ['index.ts', 'contracts.ts', 'constructors.ts', 'writing.ts', 'jsx-runtime.ts', 'jsx-dev-runtime.ts'] },
    { name: 'variable-sdk', files: ['index.ts', 'contracts.ts'] },
  ] as const
  for (const sdk of sdkEntries) {
    const runtimeRoot = resolve(nbookRoot, sdk.name)
    const sourceRoot = resolve(sdkSourceRoot, sdk.name)
    await mkdir(runtimeRoot, { recursive: true })
    await mkdir(sourceRoot, { recursive: true })
    for (const fileName of sdk.files) {
      const source = resolve(sdk.name, fileName)
      if (!existsSync(source)) throw new Error(`${sdk.name} 缺少 ${fileName}`)
      await cp(source, resolve(sourceRoot, fileName))
      const runtimeFileName = fileName.replace(/\.ts$/u, '.mjs')
      const sdkBuild = await bundleProductJavaScript({
        entryPoints: [source],
        outfile: resolve(runtimeRoot, runtimeFileName),
        write: false,
        external: [
          'bun',
          'bun:*',
          ...(sdk.name === 'profile-sdk' && fileName.startsWith('jsx-')
            ? ['nbook/profile-sdk', 'nbook/profile-sdk/*']
            : []),
        ],
      })
      const runtimeSource = await rewriteProjectedSdkImports(
        productBundleOutputText(sdkBuild, `${sdk.name} ${fileName}`),
        `${sdk.name}/${runtimeFileName}`,
      )
      await writeFile(resolve(runtimeRoot, runtimeFileName), runtimeSource, 'utf8')
    }
  }

  // World Engine schema helper 与 Zod 运行时是 Authoring Kit 的独立小岛。
  // helper 保留唯一的相对 Zod 入口，最终用户 schema artifact 会把两者一起内联。
  const worldEngineRoot = resolve(nbookRoot, 'world-engine')
  const worldEngineSourceRoot = resolve(sdkSourceRoot, 'world-engine', 'schema')
  await mkdir(worldEngineRoot, { recursive: true })
  await mkdir(worldEngineSourceRoot, { recursive: true })
  await cp(resolve('world-engine', 'schema', 'index.ts'), resolve(worldEngineSourceRoot, 'index.ts'))
  const zodBuild = await bundleProductJavaScript({
    stdin: {
      contents: [
        'import * as z from "zod";',
        'export {z};',
        'export * from "zod";',
        'export default z;',
      ].join('\n'),
      resolveDir: resolve('.'),
      sourcefile: 'nbook-world-engine-zod-entry.mjs',
      loader: 'js',
    },
    outfile: resolve(worldEngineRoot, 'zod.mjs'),
    write: false,
  })
  await writeFile(
    resolve(worldEngineRoot, 'zod.mjs'),
    productBundleOutputText(zodBuild, 'World Engine Zod runtime'),
    'utf8',
  )
  const worldSchemaBuild = await bundleProductJavaScript({
    entryPoints: [resolve('world-engine', 'schema', 'index.ts')],
    outfile: resolve(worldEngineRoot, 'schema', 'index.mjs'),
    write: false,
    external: ['zod'],
  })
  await mkdir(resolve(worldEngineRoot, 'schema'), { recursive: true })
  await writeFile(
    resolve(worldEngineRoot, 'schema', 'index.mjs'),
    await rewriteWorldEngineSchemaImports(
      productBundleOutputText(worldSchemaBuild, 'World Engine schema helper'),
    ),
    'utf8',
  )
  const typeProjection = await buildAuthoringSdkTypeProjection({ targetRoot: kitRoot, sourceRoot: resolve('.') })
  await writeFile(resolve(kitRoot, 'package.json'), `${JSON.stringify({
    name: '@notnotype/neuro-book-profile-authoring-kit',
    private: true,
    type: 'module',
  }, null, 4)}\n`, 'utf8')
  await writeFile(resolve(kitRoot, 'authoring-dependencies.json'), `${JSON.stringify({
    schema: 'nbook.product-authoring-dependencies/v2',
    dependencies: typeProjection.dependencies,
    instances: typeProjection.dependencyInstances,
  }, null, 4)}\n`, 'utf8')

  const runtimeInventory = await directoryInventory(nbookRoot)
  const runtimeSourceInventory = await directoryInventory(sdkSourceRoot)
  return {
    compilerBytes: (await stat(compilerPath)).size,
    sdkBytes: runtimeInventory.bytes + runtimeSourceInventory.bytes,
    typeBytes: typeProjection.declarationBytes + typeProjection.dependencyBytes,
    typeFiles: typeProjection.declarationFiles + typeProjection.dependencyFiles,
    dependencies: [...typeProjection.dependencies],
  }
}

/**
 * 将 SDK 投影之间的公开裸入口改成镜像内相对引用。
 *
 * Source 仍使用 `nbook/profile-sdk` 供作者和仓库 tsconfig 消费；Product Runtime Image
 * 内部不能依赖祖先目录的 package resolution。只登记实际存在的投影边，新增边必须显式审查。
 */
async function rewriteProjectedSdkImports(source: string, importer: string): Promise<string> {
  await init
  const internalSpecifiers = new Map([
    ['nbook/profile-sdk', './index.mjs'],
    ['nbook/profile-sdk/jsx-runtime', './jsx-runtime.mjs'],
  ])
  const [imports] = parse(source)
  const replacements: Array<{ start: number, end: number, value: string }> = []
  for (const item of imports) {
    if (!item.n) continue
    const replacement = internalSpecifiers.get(item.n)
    if (replacement) {
      replacements.push({
        start: item.s,
        end: item.e,
        value: item.d >= 0 ? JSON.stringify(replacement) : replacement,
      })
      continue
    }
    if (item.n === 'nbook' || item.n.startsWith('nbook/')) {
      throw new Error(`Authoring SDK runtime 含未登记内部引用：${importer} -> ${item.n}`)
    }
  }
  let rewritten = source
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`
  }
  return rewritten
}

/** 把 helper 的唯一 zod external 边改成 Kit 内固定相对路径。 */
async function rewriteWorldEngineSchemaImports(source: string): Promise<string> {
  await init
  const [imports] = parse(source)
  const replacements: Array<{ start: number, end: number, value: string }> = []
  for (const item of imports) {
    if (item.n === 'zod') {
      replacements.push({ start: item.s, end: item.e, value: '../zod.mjs' })
      continue
    }
    if (item.n && !item.n.startsWith('node:')) {
      throw new Error(`World Engine schema helper 含未登记 runtime import：${item.n}`)
    }
  }
  let rewritten = source
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`
  }
  return rewritten
}

/** 统计 Authoring Kit 的声明树，供 owner inventory 和构建日志使用。 */
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

if (import.meta.main) {
  const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? '.output')
  console.log(await buildProductAuthoringKit(outputRoot))
}
