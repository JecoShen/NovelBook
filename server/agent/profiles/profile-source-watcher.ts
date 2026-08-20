import { relative } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import {
  PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
  PROFILE_COMPILED_DIR_NAME,
  PROFILE_COMPILED_MANIFEST_FILE,
} from 'nbook/server/agent/profiles/profile-artifact-compiler'
import { VARIABLE_TYPES_FILE_NAME } from 'nbook/server/agent/variables/generated-types'

const PROFILE_WATCH_AWAIT_WRITE_MS = 200

export type ProfileSourceWatchEvent = {
  eventName: string
  changedPath: string
  kind: 'user_profile' | 'user_dependency' | 'other'
  fileName?: string
}

/**
 * profile 源码 watcher。它只负责文件系统事件分类：
 * 源码文件、用户依赖文件、manifest/其它 fallback；具体 enqueue/invalidate 由 Catalog 决定。
 */
export class ProfileSourceWatcher {
  private watcher: FSWatcher | null = null
  private watcherStart?: Promise<void>

  constructor(readonly input: {
    systemRoot: string
    userRoot: string
    onEvent(event: ProfileSourceWatchEvent): void
    onError(error: Error, startup: boolean): void
  }) {}

  /**
     * 启动 chokidar watcher。重复调用会复用同一次启动过程。
     */
  async start(): Promise<void> {
    if (this.watcherStart) {
      return this.watcherStart
    }
    if (this.watcher) {
      return
    }
    const roots = [...new Set([this.input.systemRoot, this.input.userRoot])]
    let resolveReady: () => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    let readySettled = false
    let watcherReady = false
    let watcherFailed = false
    this.watcherStart = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let watcher: FSWatcher
    try {
      watcher = watch(roots, {
        ignoreInitial: true,
        ignored: changedPath => this.isIgnoredWatchPath(String(changedPath)),
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: PROFILE_WATCH_AWAIT_WRITE_MS,
          pollInterval: 50,
        },
      })
      this.watcher = watcher
    }
    catch (error) {
      this.watcherStart = undefined
      throw error
    }
    watcher.on('all', (eventName, changedPath) => {
      this.input.onEvent(this.classifyEvent(eventName, String(changedPath)))
    })
    watcher.on('ready', () => {
      watcherReady = true
      if (!readySettled) {
        readySettled = true
        resolveReady()
      }
    })
    watcher.on('error', (error) => {
      if (watcherFailed) {
        return
      }
      watcherFailed = true
      const nextError = error instanceof Error ? error : new Error(String(error))
      this.input.onError(nextError, !watcherReady)
      this.closeFailedWatcher(watcher)
      if (!readySettled) {
        readySettled = true
        rejectReady(nextError)
      }
    })
    await this.watcherStart.finally(() => {
      this.watcherStart = undefined
    })
  }

  /**
     * 关闭 watcher，供测试和短生命周期 catalog 清理文件句柄。
     */
  async dispose(): Promise<void> {
    const watcher = this.watcher
    this.watcher = null
    this.watcherStart = undefined
    if (watcher) {
      await watcher.close()
    }
  }

  private classifyEvent(eventName: string, changedPath: string): ProfileSourceWatchEvent {
    const fileName = this.userProfileFileNameFromWatchPath(changedPath)
    if (fileName !== null) {
      return { eventName, changedPath, kind: 'user_profile', fileName }
    }
    if (this.isUserProfileDependencyWatchPath(changedPath)) {
      return { eventName, changedPath, kind: 'user_dependency' }
    }
    return { eventName, changedPath, kind: 'other' }
  }

  private isIgnoredWatchPath(changedPath: string): boolean {
    const normalized = changedPath.replace(/[\\/]+/g, '/')
    if (!normalized.includes(`/${PROFILE_COMPILED_DIR_NAME}/`)) {
      return false
    }
    if (normalized.endsWith(`/${PROFILE_COMPILED_MANIFEST_FILE}`)) {
      return false
    }
    return normalized.includes(`/${PROFILE_COMPILED_DIR_NAME}/${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/`)
      || normalized.endsWith('.tmp')
      || normalized.endsWith(`.${VARIABLE_TYPES_FILE_NAME}`)
  }

  private userProfileFileNameFromWatchPath(changedPath: string): string | null {
    const relativePath = relative(this.input.userRoot, changedPath).split(/[\\/]+/).join('/')
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..' || /^[A-Za-z]:/.test(relativePath)) {
      return null
    }
    return /\.profile\.(tsx|ts|mjs|js)$/u.test(relativePath) ? relativePath : null
  }

  private isUserProfileDependencyWatchPath(changedPath: string): boolean {
    const relativePath = relative(this.input.userRoot, changedPath).split(/[\\/]+/).join('/')
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..' || /^[A-Za-z]:/.test(relativePath)) {
      return false
    }
    return !relativePath.startsWith(`${PROFILE_COMPILED_DIR_NAME}/`)
  }

  private closeFailedWatcher(watcher: FSWatcher): void {
    if (this.watcher === watcher) {
      this.watcher = null
    }
    void watcher.close().catch(() => undefined)
  }
}
