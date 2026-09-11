import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  isProjectLayer,
  type TypecheckLayer,
  type TypecheckLayerDefinition,
  type TypecheckProjectLayer,
} from '#scripts/typecheck/non-desktop-layers'

export type MaterializeContext = {
  /** 本次运行独占目录，由 runner 拥有并在结束时清理。 */
  readonly runRoot: string
  /** 仓库根绝对路径。 */
  readonly repoRoot: string
}

/**
 * per-run 配置必须显式锚回仓库的 `node_modules/@types`。
 *
 * 提交版基线声明了 `types: ["node", "bun"]` 却不声明 `typeRoots`，而 `typeRoots` 的默认值是从
 * **入口配置所在目录**向上找 `node_modules/@types`。runRoot 在系统临时根下，向上走不到仓库的
 * node_modules，两个 types 都解析不到，整层退化成 TS2688 而不是真实类型诊断。
 * 基线里的 `rootDir` / `baseUrl` 不受影响：相对路径按声明它的那个配置的位置解析。
 */
export function repositoryTypeRoots(repoRoot: string): readonly string[] {
  return [resolve(repoRoot, 'node_modules', '@types')]
}

/**
 * 某层声明产物目录：`<runRoot>/<层名>/`。
 *
 * 这个约定同时被提交版配置的 `paths` 依赖：下游写 `${configDir}/<上游层名>/*`，
 * TypeScript 5.5+ 把 `${configDir}` 替换成**入口配置**所在目录，而 per-run 配置就写在
 * runRoot 里，于是两边落在同一处。改这里必须同步改各层提交版配置的 paths。
 */
export function layerDeclarationDirectory(context: MaterializeContext, layerName: string): string {
  return join(context.runRoot, layerName)
}

/**
 * 把层定义物化成可直接 spawn 的 `TypecheckLayer`。
 *
 * 已经带 `command` 的层原样透传；声明项目层在 runRoot 内生成 per-run 配置。
 *
 * 生成的配置注入四样东西：本层声明输出目录、`.tsbuildinfo`、改指 runRoot 内同胞配置的
 * `references`，以及锚回仓库 node_modules 的 `typeRoots`。`paths` 刻意不注入——它由提交版
 * 配置用 `${configDir}` 表达，避免同一件事有两个事实来源。
 *
 * 注入值一律绝对路径：tsconfig 的相对路径按「声明它的那个配置文件所在目录」解析，
 * per-run 配置不在仓库树内，用相对路径会让 `outDir` 落到嵌套的错误位置（构建仍报
 * exit 0 但一个 `.d.ts` 都不产出）。
 */
export async function materializeTypecheckLayers(
  layers: readonly TypecheckLayerDefinition[],
  context: MaterializeContext,
): Promise<readonly TypecheckLayer[]> {
  const materialized: TypecheckLayer[] = []
  const seen = new Set<string>()

  for (const layer of layers) {
    if (!isProjectLayer(layer)) {
      materialized.push(layer)
      seen.add(layer.name)
      continue
    }
    const missing = layer.dependsOn.filter(name => !seen.has(name))
    if (missing.length > 0) {
      throw new Error(
        `typecheck 层 ${layer.name} 的上游 ${missing.join(', ')} 未在它之前出现：`
        + '层列表必须按拓扑顺序排列。',
      )
    }
    materialized.push(await writeProjectLayerConfig(layer, context))
    seen.add(layer.name)
  }

  return materialized
}

async function writeProjectLayerConfig(
  layer: TypecheckProjectLayer,
  context: MaterializeContext,
): Promise<TypecheckLayer> {
  const declarationDir = layerDeclarationDirectory(context, layer.name)
  await mkdir(declarationDir, { recursive: true })

  const configPath = join(context.runRoot, `${layer.name}.tsconfig.json`)
  const config = {
    extends: resolve(context.repoRoot, layer.project),
    compilerOptions: {
      outDir: declarationDir,
      declarationDir,
      tsBuildInfoFile: join(context.runRoot, `${layer.name}.tsbuildinfo`),
      typeRoots: repositoryTypeRoots(context.repoRoot),
    },
    // 提交版配置的 reference 指向提交版上游（没有输出目录）；改指本 run 生成的上游配置，
    // 引用才会去本 run 的声明目录核验新鲜度。缺失或过期的上游声明由此变成 TS6305 硬失败，
    // 而不是静默沿 paths 兜底回退到上游源码。
    references: layer.dependsOn.map(name => ({
      path: join(context.runRoot, `${name}.tsconfig.json`),
    })),
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  // `-p` 而不是 `--build`：`--build` 会把上游项目载入同一个进程，正好抵消分层要达到的
  // 内存边界。上游声明由前序层留在 runRoot 里，本层只消费。
  return {
    name: layer.name,
    command: ['bun', 'x', 'tsc', '-p', configPath],
  }
}
