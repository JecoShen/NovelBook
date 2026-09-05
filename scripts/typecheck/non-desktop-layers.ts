export type TypecheckLayer = {
  readonly name: string
  readonly command: readonly [string, ...string[]]
}

/** 后续任务按拓扑顺序追加正式的非桌面 typecheck 项目。 */
export const NON_DESKTOP_TYPECHECK_LAYERS: readonly TypecheckLayer[] = Object.freeze([])
