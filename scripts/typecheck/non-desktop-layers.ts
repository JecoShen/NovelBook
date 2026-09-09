/**
 * 非桌面 typecheck 的层定义（纯数据）。
 *
 * 两种层：
 * - `TypecheckLayer`：命令已经确定，runner 直接 spawn（例如 `nuxt prepare`）。
 * - `TypecheckProjectLayer`：声明项目层。提交版 tsconfig 不含任何 per-run 输出路径，
 *   由 runner 在 runRoot 内生成配置后物化成 `TypecheckLayer`。
 */

export type TypecheckLayer = {
  readonly name: string
  readonly command: readonly [string, ...string[]]
}

export type TypecheckProjectLayer = {
  readonly name: string
  /** 提交版 tsconfig，仓库相对路径。 */
  readonly project: string
  /**
   * 上游层名，必须在本层之前出现。
   *
   * 物化时转成两样东西：指向上游生成配置的 `references`（缺失或过期的上游声明由此
   * 变成 TS6305 硬失败，而不是静默回退到上游源码），以及 `paths` 里上游声明目录的
   * 查找顺序（本层自己的文件由末尾的源码兜底命中）。
   */
  readonly dependsOn: readonly string[]
}

export type TypecheckLayerDefinition = TypecheckLayer | TypecheckProjectLayer

export function isProjectLayer(layer: TypecheckLayerDefinition): layer is TypecheckProjectLayer {
  return 'project' in layer
}

/**
 * 按拓扑顺序排列；后续任务按 spec §2 的依赖图继续追加。
 *
 * `phase0-sample` 是 Phase 0 可行性样板，不属于 spec §2 的 8 个正式层，
 * 在正式 agent 层就位后移除。
 */
export const NON_DESKTOP_TYPECHECK_LAYERS: readonly TypecheckLayerDefinition[] = Object.freeze([
  Object.freeze({
    name: 'contracts',
    project: 'typecheck/contracts/tsconfig.json',
    dependsOn: Object.freeze([]),
  }),
  Object.freeze({
    name: 'phase0-sample',
    project: 'typecheck/fixtures/profile-turn-context/tsconfig.json',
    dependsOn: Object.freeze(['contracts']),
  }),
])
