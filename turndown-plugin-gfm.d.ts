// turndown-plugin-gfm 没有官方 @types；项目只取 `gfm` 工厂并当作类型不透明的扩展点。
// `Plugin` 类型位于 @types/turndown 的 TurndownService namespace 内，不能 top-level 引用，
// 所以在 declare module 里 import turndown 的 default 类、再把 gfm 标成与 Plugin 兼容的函数签名。
// 跟随仓库根既有的 declare-only *.d.ts 惯例（bun-sqlite.d.ts、yazl.d.ts、proper-lockfile.d.ts）。
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  export const gfm: (service: TurndownService) => void
}
