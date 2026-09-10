// Profile SDK 子入口：暴露宿主运行时文件路径类型。
// Profile 沙箱只允许白名单 specifier；fs path 类型是 Profile 在 prepare/runtime 中
// 表达"绝对路径"的常用契约，因此通过 SDK 子模块再导出。
import type { AbsoluteFsPath as AbsoluteFsPathHost } from 'nbook/server/runtime/paths/file-path'

export type AbsoluteFsPath = AbsoluteFsPathHost
