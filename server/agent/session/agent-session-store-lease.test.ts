import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireAgentSessionStoreLease,
  acquireAgentSessionStoreLeaseSync,
  AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
  AgentSessionStoreLeaseHeldError,
  agentSessionStoreLeasePath,
  runWithAgentSessionStoreLease,
  type AgentSessionStoreLeaseOwner,
} from 'nbook/server/agent/session/agent-session-store-lease'

describe('Agent Session Store runtime lease', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('async runtime owner写入最小版本化metadata且释放后可重取', async () => {
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const releaseRuntime = await acquireAgentSessionStoreLease(root, 'runtime')
    const runtimeOwner = await readOwner(path)

    expect(runtimeOwner).toMatchObject({
      schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
      kind: 'runtime',
      pid: process.pid,
    })
    expect(Object.keys(runtimeOwner).sort()).toEqual([
      'acquiredAt',
      'kind',
      'leaseId',
      'pid',
      'runtime',
      'runtimeVersion',
      'schema',
    ])
    expect(JSON.stringify(runtimeOwner)).not.toMatch(/argv|cwd|env|token|password/iu)

    await releaseRuntime()
    const releaseMigration = await acquireAgentSessionStoreLease(root, 'migration')
    expect(await readOwner(path)).toMatchObject({ kind: 'migration', pid: process.pid })
    await releaseMigration()
  })

  it('sync与async owner共享同一物理lease并返回稳定ELOCKED诊断', async () => {
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const releaseRuntime = acquireAgentSessionStoreLeaseSync(root, 'runtime')
    try {
      const failure = await acquireAgentSessionStoreLease(root, 'migration')
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError)
      expect(failure).toMatchObject({
        code: 'ELOCKED',
        leasePath: path,
        owner: expect.objectContaining({ kind: 'runtime', pid: process.pid }),
      })
      expect((failure as AgentSessionStoreLeaseHeldError).heartbeatAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
    finally {
      releaseRuntime()
    }

    const releaseMigration = await acquireAgentSessionStoreLease(root, 'migration')
    try {
      let failure: unknown
      try {
        acquireAgentSessionStoreLeaseSync(root, 'runtime')
      }
      catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'ELOCKED',
        owner: expect.objectContaining({ kind: 'migration', pid: process.pid }),
      })
    }
    finally {
      await releaseMigration()
    }
  })

  it.each([
    ['旧空文件', ''],
    ['损坏metadata', '{not-json'],
  ])('%s竞争时owner降级为未知，但保留heartbeat', async (_name, metadata) => {
    // mock uptime > 30s: 模拟"老进程"场景, 保护活跃 lock 不被 grace 期启发式接管。
    // 旧 P1 行为：owner=null + fresh .lock 抛 ELOCKED (active process holds real lock)。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const release = await acquireAgentSessionStoreLease(root, 'runtime')
    try {
      await writeFile(path, metadata, 'utf8')
      const uptimeSpy = vi.spyOn(process, 'uptime').mockReturnValue(60)
      try {
        const failure = await acquireAgentSessionStoreLease(root, 'migration')
          .catch((error: unknown) => error) as AgentSessionStoreLeaseHeldError

        expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError)
        expect(failure.owner).toBeNull()
        expect(failure.heartbeatAt).not.toBeNull()
        expect(failure.message).toContain('owner：未知')
      }
      finally {
        uptimeSpy.mockRestore()
      }
    }
    finally {
      await release()
    }
  })

  it('超过30秒的遗留lock由proper-lockfile协议接管并覆盖owner', async () => {
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', 'utf8')
    await mkdir(`${path}.lock`)
    const staleTime = new Date(Date.now() - 31_000)
    await utimes(`${path}.lock`, staleTime, staleTime)

    const release = await acquireAgentSessionStoreLease(root, 'migration')
    try {
      expect(await readOwner(path)).toMatchObject({ kind: 'migration', pid: process.pid })
      expect((await stat(`${path}.lock`)).mtimeMs).toBeGreaterThan(staleTime.getTime())
    }
    finally {
      await release()
    }
  })

  it('stale self-lock: owner pid 已死时自动清 lease 并接管', async () => {
    // 历史教训：2026-08-17 旧进程 OOM 死透但 lease 没释放, proper-lockfile
    // 的 stale=30s 对 directory lockfile 不接管, 新进程持续 ELOCKED → 全站 500。
    // 修复：在 lock() 之前检测 owner.pid 是否还活着, 死了就 rm -f lease + rm -rf .lock。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const deadPid = 99999999 // Linux 不存在的 pid → process.kill(deadPid, 0) 返回 ESRCH
    const staleOwner: AgentSessionStoreLeaseOwner = {
      schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
      leaseId: '11111111-2222-4222-8222-222222222222',
      kind: 'runtime',
      pid: deadPid,
      acquiredAt: new Date(Date.now() - 60_000).toISOString(),
      runtime: 'bun',
      runtimeVersion: '1.3.14',
    }

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(staleOwner, null, 2), 'utf8')
    await mkdir(`${path}.lock`)

    const release = await acquireAgentSessionStoreLease(root, 'runtime')
    try {
      // 接管后 owner 应当是当前进程
      const currentOwner = await readOwner(path)
      expect(currentOwner.pid).toBe(process.pid)
      expect(currentOwner.kind).toBe('runtime')
    }
    finally {
      await release()
    }
  })

  it('live owner pid 仍存活时不清 lease, 抛 ELOCKED', async () => {
    // 与"sync与async owner共享同一物理lease"互补, 显式覆盖另一个活进程持锁场景。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const release = await acquireAgentSessionStoreLease(root, 'runtime')
    try {
      // 当前进程 (process.pid) 仍活着, 第二次 acquire 必须抛 ELOCKED 而不是接管。
      const failure = await acquireAgentSessionStoreLease(root, 'migration')
        .catch((error: unknown) => error) as AgentSessionStoreLeaseHeldError
      expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError)
      expect(failure.code).toBe('ELOCKED')
      expect(failure.owner).toMatchObject({ kind: 'runtime', pid: process.pid })
    }
    finally {
      await release()
    }
  })

  it('空 lease + 残留 .lock (>30s stale) 时接管', async () => {
    // 历史教训 (2026-08-17 第七轮)：端到端测试 setup 残留的 .lock directory
    // (mtime 13:16:24 < 5min, clean-stale-lease.sh 不删) + lease 文件被清空。
    // 原 clearStaleSelfLock 在 owner=null 时直接 return, 不清 .lock, 导致 PM2
    // 启动后 proper-lockfile 看到 fresh mtime → 不接管 → 全站 500。
    // 修复: owner 解析失败 + .lock mtime > 30s 视为 stale, 清 .lock 让 proper-lockfile 接管。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', 'utf8') // 空 lease 文件
    await mkdir(`${path}.lock`)
    const staleTime = new Date(Date.now() - 31_000) // 31s ago, > 30s stale 阈值
    await utimes(`${path}.lock`, staleTime, staleTime)

    const release = await acquireAgentSessionStoreLease(root, 'runtime')
    try {
      expect(await readOwner(path)).toMatchObject({ kind: 'runtime', pid: process.pid })
    }
    finally {
      await release()
    }
  })

  it('空 lease + 残留 .lock (<30s fresh) 时不动, 抛 ELOCKED', async () => {
    // 边界保护: 如果 .lock mtime 距今 < 30s, 不能贸然清, 因为可能有别的新进程正在竞争。
    // 旧 P1 行为：仅当 mtime > 30s 才接管, fresh lock 抛 ELOCKED。
    // 新进程 grace 期 (< 30s) 会改变这个行为 → 这里 mock uptime > 30s 模拟"老进程"场景。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', 'utf8')
    await mkdir(`${path}.lock`)
    const freshTime = new Date(Date.now() - 5_000) // 5s ago, < 30s fresh
    await utimes(`${path}.lock`, freshTime, freshTime)

    // mock: 进程运行 60s, 已过 grace 期
    const uptimeSpy = vi.spyOn(process, 'uptime').mockReturnValue(60)
    try {
      const failure = await acquireAgentSessionStoreLease(root, 'runtime')
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError)
    }
    finally {
      uptimeSpy.mockRestore()
    }
  })

  it('新进程 grace 期 (< 30s) + 空 lease + fresh .lock (5s) 时接管', async () => {
    // 历史教训 (2026-08-17 第九轮): PM2 clean restart 时旧进程 OOM 死透
    // 但 lease 残留, 新进程 startup 时 .lock mtime 才 22s, 落在 P1 30s 阈值
    // 之外 → 新进程持续 ELOCKED → 全站 500。手动 rm 才能恢复。
    // 修复: 新进程 grace 期 (< 30s) 启发式接管, 任何残留 .lock 都视为 stale。
    // 安全前提: 单一 PM2 实例 + live owner 永远保护 (grace 期也保留 owner.pid alive 检查)。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', 'utf8')
    await mkdir(`${path}.lock`)
    const freshTime = new Date(Date.now() - 5_000) // 5s old, fresh
    await utimes(`${path}.lock`, freshTime, freshTime)

    // mock: 进程运行 10s, 在 grace 期 (< 30s)
    const uptimeSpy = vi.spyOn(process, 'uptime').mockReturnValue(10)
    try {
      const release = await acquireAgentSessionStoreLease(root, 'runtime')
      try {
        // 接管后 owner 应当是当前进程
        expect(await readOwner(path)).toMatchObject({ kind: 'runtime', pid: process.pid })
      }
      finally {
        await release()
      }
    }
    finally {
      uptimeSpy.mockRestore()
    }
  })

  it('新进程 grace 期 + live owner 仍存活时不清, 抛 ELOCKED', async () => {
    // 边界保护: 即使在 grace 期, live owner 永远不能被新进程抢锁。
    // 防止两个新进程同时启动 (例如手动 + 自动) 互相抢锁。
    const root = await nextRoot()
    const path = agentSessionStoreLeasePath(root)
    const release = await acquireAgentSessionStoreLease(root, 'runtime')
    try {
      // 当前进程持锁, 第二次 acquire 必须抛 ELOCKED (即使 mock uptime < 30s)
      const uptimeSpy = vi.spyOn(process, 'uptime').mockReturnValue(10)
      try {
        const failure = await acquireAgentSessionStoreLease(root, 'migration')
          .catch((error: unknown) => error) as AgentSessionStoreLeaseHeldError
        expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError)
        expect(failure.code).toBe('ELOCKED')
        expect(failure.owner).toMatchObject({ kind: 'runtime', pid: process.pid })
      }
      finally {
        uptimeSpy.mockRestore()
      }
    }
    finally {
      await release()
    }
  })

  it('任务失败与lease释放失败同时发生时保留两个原始原因', async () => {
    const taskFailure = new Error('migration failed')
    const releaseFailure = new Error('lease release failed')

    const failure = await runWithAgentSessionStoreLease(
      async () => {
        throw releaseFailure
      },
      async () => {
        throw taskFailure
      },
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([taskFailure, releaseFailure])
  })

  /** 为每个用例建立仓库外隔离 Workspace Root。 */
  async function nextRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'nbook-session-store-lease-'))
    roots.push(root)
    return root
  }
})

/** 读取当前测试 owner metadata。 */
async function readOwner(path: string): Promise<AgentSessionStoreLeaseOwner> {
  return JSON.parse(await readFile(path, 'utf8')) as AgentSessionStoreLeaseOwner
}
