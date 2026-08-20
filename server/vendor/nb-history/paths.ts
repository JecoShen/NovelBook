import { HistoryError } from './types'

/**
 * 路径规范(R1):一律相对 workspaceRoot、正斜杠分隔。
 * 拒绝绝对路径、反斜杠、`.` / `..` 段与空段——非法路径直接抛错,
 * 避免同一文件出现两种表示(如 `a\b` 与 `a/b`)导致日志分裂。
 */
export function validateRelativePath(path: string): string {
  if (path.length === 0) {
    throw new HistoryError('路径不能为空')
  }
  if (path.includes('\\')) {
    throw new HistoryError(`路径必须用正斜杠分隔: ${path}`)
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new HistoryError(`路径必须是相对 workspaceRoot 的相对路径: ${path}`)
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new HistoryError(`路径含非法段(空段 / . / ..): ${path}`)
    }
  }
  return path
}
