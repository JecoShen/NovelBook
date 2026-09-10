import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { WorkspaceHistory } from 'nbook/server/vendor/nb-history/index'

/**
 * Vendored nb-history 冒烟测试：验证镜像源码在 NeuroBook 的类型环境 / 测试运行时 / diff 依赖版本下
 * 全链路可用（open → 写入 → 时间线 → diff → close → Windows 句柄释放到「库文件可删」）。
 * 完整行为契约（T1–T12）在源仓 ../nb-history 的 bun test 覆盖，这里不重复。
 */
describe('vendored nb-history 冒烟', () => {
  const tempRoots: string[] = []

  afterAll(async () => {
    for (const root of tempRoots) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('open → performWrite → timeline → textDiff → close → 库文件可删', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-history-vendor-smoke-'))
    tempRoots.push(workspaceRoot)
    const databasePath = path.join(workspaceRoot, '.nbook', 'history.sqlite')
    await fs.mkdir(path.dirname(databasePath), { recursive: true })

    const history = await WorkspaceHistory.open({ workspaceRoot, databasePath })
    const created = await history.performWrite({ kind: 'user', userId: 'local' }, 'manuscript/ch1.md', '第一版正文\n')
    expect(created.operation.type).toBe('file.create')
    const edited = await history.performWrite({ kind: 'agent', sessionId: '42' }, 'manuscript/ch1.md', '第二版正文\n多了一行\n')
    expect(edited.operation.type).toBe('file.edit')
    expect(await fs.readFile(path.join(workspaceRoot, 'manuscript/ch1.md'), 'utf-8')).toBe('第二版正文\n多了一行\n')

    const timeline = await history.timeline('manuscript/ch1.md')
    expect(timeline.map(item => item.entry.operation.type)).toEqual(['file.create', 'file.edit'])

    // textDiff 走 diff 包（vendored 代码按 diff@9 书写，宿主装 diff@8）——这里守版本兼容。
    const editOperation = edited.operation
    if (editOperation.type !== 'file.edit') {
      throw new Error('预期 file.edit 操作')
    }
    const diff = await history.textDiff(editOperation.beforeHash, editOperation.afterHash)
    expect(diff.available).toBe(true)
    if (!diff.available) {
      throw new Error('预期 diff 可用')
    }
    expect(diff.changes.length).toBeGreaterThan(0)
    expect(diff.afterText).toBe('第二版正文\n多了一行\n')

    const runtimeEntry = await history.performWrite(
      { kind: 'system', source: 'vendor-smoke' },
      'runtime-artifact-import-cache/example.mjs',
      'export {};\n',
    )
    const purge = await history.purgePaths(recordedPath => recordedPath.startsWith('runtime-artifact-import-cache/'))
    expect(purge.entriesDeleted).toBe(1)
    expect(await history.timeline('runtime-artifact-import-cache/example.mjs')).toHaveLength(0)
    if (runtimeEntry.operation.type !== 'file.create') {
      throw new Error('预期 runtime artifact 为 file.create')
    }
    expect(await history.snapshotBody(runtimeEntry.operation.afterHash)).toBeNull()

    await history.close()
    // 「close 后立即可删库文件」只在 bun 运行时是模块承诺(close 内建强制 GC 收敛句柄);
    // vitest worker 跑在 node 运行时时无强制 GC,只能等自然 GC——删除断言降级为 best-effort,
    // 严格的 Windows 句柄验收由源仓 ../nb-history 的 bun test(T12)覆盖。
    const hasBunGc = typeof (globalThis as { Bun?: { gc?: unknown } }).Bun?.gc === 'function'
    if (hasBunGc) {
      await expectFileDeletable(databasePath)
    }
    else {
      await fs.rm(databasePath, { force: true }).catch(() => undefined)
    }
  }, 15_000)
})

/**
 * close 后库文件应可删除（Windows 句柄释放验收）。bun 运行时下 close() 内建强制 GC 即刻收敛；
 * 非 bun 运行时依赖自然 GC，留重试窗口兜底。
 */
async function expectFileDeletable(filePath: string): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      await fs.rm(filePath, { force: true })
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw new Error(`close 后库文件仍不可删除(句柄未释放): ${String(lastError)}`)
}
