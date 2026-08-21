import { randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { lock, lockSync } from 'proper-lockfile'

export const AGENT_SESSION_STORE_LEASE_RELATIVE_PATH = '.nbook/agent/migrations/runtime.lease'
export const AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA = 'nbook.agent-session-store-lease-owner/v1'
export const AGENT_SESSION_STORE_LEASE_STALE_MS = 30_000
export const AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS = 15_000
export const AGENT_SESSION_STORE_LEASE_RESIDUAL_LOCK_MS = 30_000
export const AGENT_SESSION_STORE_NEW_PROCESS_GRACE_MS = 30_000

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type AgentSessionStoreLeaseKind = 'runtime' | 'migration'

/** `runtime.lease` 中仅供本机排障使用的最小 owner 信息。 */
export type AgentSessionStoreLeaseOwner = {
  schema: typeof AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA
  leaseId: string
  kind: AgentSessionStoreLeaseKind
  pid: number
  acquiredAt: string
  runtime: 'bun' | 'node'
  runtimeVersion: string
}

/** Runtime lease 已失去所有权；该错误只用于诊断与有序关闭，不用于抢锁。 */
export class AgentSessionStoreLeaseCompromisedError extends Error {
  readonly code = 'AGENT_SESSION_STORE_LEASE_COMPROMISED' as const

  constructor(
    readonly leasePath: string,
    readonly kind: AgentSessionStoreLeaseKind,
    cause: unknown,
  ) {
    super(
      `Agent Session Store ${kind} lease已失去所有权：${leasePath}；`
      + '可能存在另一个 NeuroBook 实例或迁移程序，或当前进程/系统曾长时间暂停。'
      + '不要手动删除 runtime.lease.lock。',
      { cause },
    )
    this.name = 'AgentSessionStoreLeaseCompromisedError'
  }
}

/** HMR 与进程级关闭使用的 runtime lease handle。 */
export type AgentSessionStoreLeaseHandle = {
  readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>
  assertHealthy(): void
  release(): Promise<void>
}

/** 保留历史可调用 release API，同时暴露一次性失效信号与同步健康检查。 */
export type AgentSessionStoreLeaseRelease = (() => Promise<void>) & {
  readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>
  assertHealthy(): void
}

/** 同步启动调用方使用的可调用 release API。 */
export type AgentSessionStoreLeaseSyncRelease = (() => void) & {
  readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>
  assertHealthy(): void
}

/** 判断错误是否表示 Session Store lease 已失去所有权。 */
export function isAgentSessionStoreLeaseCompromisedError(
  error: unknown,
): error is AgentSessionStoreLeaseCompromisedError {
  return error instanceof AgentSessionStoreLeaseCompromisedError
    || typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'AGENT_SESSION_STORE_LEASE_COMPROMISED'
}

/** Session Store 已被另一进程占用；owner 只用于诊断，不授予终止或抢锁权限。 */
export class AgentSessionStoreLeaseHeldError extends Error {
  readonly code = 'ELOCKED' as const

  constructor(
    readonly leasePath: string,
    readonly heartbeatAt: string | null,
    readonly owner: AgentSessionStoreLeaseOwner | null,
    cause: unknown,
  ) {
    const ownerText = owner
      ? `报告 owner：pid=${String(owner.pid)} kind=${owner.kind} acquiredAt=${owner.acquiredAt} runtime=${owner.runtime}@${owner.runtimeVersion}`
      : '报告 owner：未知（旧版或损坏的诊断 metadata）'
    const heartbeatText = heartbeatAt ? `；heartbeat=${heartbeatAt}` : ''
    const holderText = owner?.kind === 'migration'
      ? '迁移程序'
      : owner?.kind === 'runtime' ? 'NeuroBook 运行实例' : 'NeuroBook 实例或迁移程序'
    super(
      `Agent Session Store 正被另一${holderText}使用：${leasePath}；${ownerText}${heartbeatText}。`
      + '请先正常关闭该实例；owner 仍存活时不要删除 runtime.lease.lock。',
      { cause },
    )
    this.name = 'AgentSessionStoreLeaseHeldError'
  }
}

/** 返回 Workspace Root 对应的 Session Store lease 绝对路径。 */
export function agentSessionStoreLeasePath(rootWorkspace: string): string {
  return resolve(rootWorkspace, AGENT_SESSION_STORE_LEASE_RELATIVE_PATH)
}

/** 获取带 heartbeat 和 owner metadata 的异步 Session Store lease。 */
export async function acquireAgentSessionStoreLease(
  rootWorkspace: string,
  kind: AgentSessionStoreLeaseKind,
): Promise<AgentSessionStoreLeaseRelease> {
  const lease = await acquireAgentSessionStoreLeaseHandle(rootWorkspace, kind)
  return decorateRelease(lease)
}

/** 获取带失效信号的 Session Store lease；runtime 与 migration 共用这一物理实现。 */
async function acquireAgentSessionStoreLeaseHandle(
  rootWorkspace: string,
  kind: AgentSessionStoreLeaseKind,
): Promise<AgentSessionStoreLeaseHandle> {
  const path = await ensureLeaseFile(rootWorkspace)
  // 历史教训（2026-08-17）：旧进程 OOM 死透但 lease 没释放, proper-lockfile
  // 的 stale=30s 对 directory lockfile 行为不一致, 新进程持续 ELOCKED → 全站 500。
  // 在 lock() 之前先用 owner.pid 主动检测: 进程已死 (ESRCH) 就清 lease + .lock 接管。
  await clearStaleSelfLock(path)
  const signal = compromiseSignal(path, kind)
  let releaseLock: () => Promise<void>
  try {
    releaseLock = await lock(path, {
      realpath: false,
      stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
      update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
      onCompromised: signal.notify,
    })
  }
  catch (error) {
    if (!isLockContention(error)) throw error
    throw await leaseHeldError(path, error)
  }
  const lease = leaseHandle(releaseLock, signal)
  await writeLeaseOwner(path, kind, lease)
  return lease
}

/** 获取运行时专用 lease；compromised 只通过一次性信号传播，不异步抛错。 */
export async function acquireAgentSessionStoreRuntimeLease(
  rootWorkspace: string,
): Promise<AgentSessionStoreLeaseHandle> {
  return acquireAgentSessionStoreLeaseHandle(rootWorkspace, 'runtime')
}

/** 获取启动构造路径使用的同步 Session Store lease。 */
export function acquireAgentSessionStoreLeaseSync(
  rootWorkspace: string,
  kind: AgentSessionStoreLeaseKind,
): AgentSessionStoreLeaseSyncRelease {
  const path = agentSessionStoreLeasePath(rootWorkspace)
  mkdirSync(dirname(path), { recursive: true })
  const handle = openSync(path, 'a')
  closeSync(handle)

  // 历史教训（2026-08-17）：与异步路径一致, 同步启动路径也用 owner.pid 检测 stale self-lock。
  clearStaleSelfLockSync(path)

  const signal = compromiseSignal(path, kind)
  let releaseLock: () => void
  try {
    releaseLock = lockSync(path, {
      realpath: false,
      stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
      update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
      onCompromised: signal.notify,
    })
  }
  catch (error) {
    if (!isLockContention(error)) throw error
    throw leaseHeldErrorSync(path, error)
  }
  const release = syncLeaseHandle(releaseLock, signal)
  try {
    release.assertHealthy()
    writeFileSync(path, `${JSON.stringify(currentOwner(kind), null, 2)}\n`, 'utf8')
    release.assertHealthy()
  }
  catch (error) {
    try {
      release()
    }
    catch (releaseError) {
      throw new AggregateError(
        [asError(error), asError(releaseError)],
        'Session Store lease owner写入失败且锁未能释放。',
      )
    }
    throw error
  }
  return release
}

/** 执行一个已持有Session Store lease的操作，并保留任务与释放同时失败的两个原因。 */
export async function runWithAgentSessionStoreLease<T>(
  release: () => Promise<void>,
  task: () => Promise<T>,
): Promise<T> {
  let outcome: { ok: true, value: T } | { ok: false, error: unknown }
  try {
    outcome = { ok: true, value: await task() }
  }
  catch (error) {
    outcome = { ok: false, error }
  }

  let releaseResult: { ok: true } | { ok: false, error: unknown }
  try {
    await release()
    releaseResult = { ok: true }
  }
  catch (error) {
    releaseResult = { ok: false, error }
  }

  if (!outcome.ok && !releaseResult.ok) {
    throw new AggregateError(
      [outcome.error, releaseResult.error],
      'Session Store操作失败且lease释放失败。',
    )
  }
  if (!outcome.ok) throw outcome.error
  if (!releaseResult.ok) throw releaseResult.error
  return outcome.value
}

/** 构造不含 argv/env/cwd/token 的当前 owner。 */
function currentOwner(kind: AgentSessionStoreLeaseKind): AgentSessionStoreLeaseOwner {
  const bunVersion = process.versions.bun
  return {
    schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
    leaseId: randomUUID(),
    kind,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    runtime: bunVersion ? 'bun' : 'node',
    runtimeVersion: bunVersion ?? process.versions.node,
  }
}

/** 创建 lease 文件但不写入 owner metadata。 */
async function ensureLeaseFile(rootWorkspace: string): Promise<string> {
  const path = agentSessionStoreLeasePath(rootWorkspace)
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  await handle.close()
  return path
}

/** 写入 owner metadata；写入失败时保留原始错误与 release 错误。 */
async function writeLeaseOwner(
  path: string,
  kind: AgentSessionStoreLeaseKind,
  lease: AgentSessionStoreLeaseHandle,
): Promise<void> {
  try {
    lease.assertHealthy()
    await writeFile(path, `${JSON.stringify(currentOwner(kind), null, 2)}\n`, 'utf8')
    lease.assertHealthy()
  }
  catch (error) {
    try {
      await lease.release()
    }
    catch (releaseError) {
      throw new AggregateError(
        [asError(error), asError(releaseError)],
        'Session Store lease owner写入失败且锁未能释放。',
      )
    }
    throw error
  }
}

type LeaseCompromiseSignal = {
  readonly promise: Promise<AgentSessionStoreLeaseCompromisedError>
  readonly notify: (error: Error) => void
  readonly failure: () => AgentSessionStoreLeaseCompromisedError | null
}

/** 建立只解析一次的 compromised 信号，避免 proper-lockfile 的默认异步 throw。 */
function compromiseSignal(path: string, kind: AgentSessionStoreLeaseKind): LeaseCompromiseSignal {
  let resolvePromise: (error: AgentSessionStoreLeaseCompromisedError) => void = () => undefined
  let failure: AgentSessionStoreLeaseCompromisedError | null = null
  const promise = new Promise<AgentSessionStoreLeaseCompromisedError>((resolvePromiseValue) => {
    resolvePromise = resolvePromiseValue
  })
  return {
    promise,
    notify: (error) => {
      if (failure) return
      failure = new AgentSessionStoreLeaseCompromisedError(path, kind, error)
      resolvePromise(failure)
    },
    failure: () => failure,
  }
}

/** 将 proper-lockfile release 包装为可观察、compromised 后不再触碰旧锁的 handle。 */
function leaseHandle(
  releaseLock: () => Promise<void>,
  signal: LeaseCompromiseSignal,
): AgentSessionStoreLeaseHandle {
  let released = false
  let releasePromise: Promise<void> | null = null
  return {
    compromised: signal.promise,
    assertHealthy: () => {
      const failure = signal.failure()
      if (failure) throw failure
    },
    release: () => {
      if (released) return Promise.resolve()
      if (signal.failure()) {
        released = true
        return Promise.resolve()
      }
      if (!releasePromise) {
        releasePromise = (async () => {
          try {
            if (signal.failure()) {
              released = true
              return
            }
            await releaseLock()
            released = true
          }
          catch (error) {
            if (signal.failure()) {
              released = true
              return
            }
            throw error
          }
        })().finally(() => {
          if (!released) releasePromise = null
        })
      }
      return releasePromise
    },
  }
}

/** 把可观察 handle 转成仍可直接调用的历史 release closure。 */
function decorateRelease(handle: AgentSessionStoreLeaseHandle): AgentSessionStoreLeaseRelease {
  return Object.assign(handle.release, {
    compromised: handle.compromised,
    assertHealthy: handle.assertHealthy,
  })
}

/** 同步 release 在失效后终态 no-op，并保留原有同步调用签名。 */
function syncLeaseHandle(
  releaseLock: () => void,
  signal: LeaseCompromiseSignal,
): AgentSessionStoreLeaseSyncRelease {
  let released = false
  const release = (): void => {
    if (released) return
    if (signal.failure()) {
      released = true
      return
    }
    try {
      releaseLock()
      released = true
    }
    catch (error) {
      if (signal.failure()) {
        released = true
        return
      }
      throw error
    }
  }
  return Object.assign(release, {
    compromised: signal.promise,
    assertHealthy: () => {
      const failure = signal.failure()
      if (failure) throw failure
    },
  })
}

/** 读取活跃 `.lock` 的 heartbeat 与持有者声明；诊断读取失败降级为未知。 */
async function leaseHeldError(path: string, cause: unknown): Promise<AgentSessionStoreLeaseHeldError> {
  const [owner, heartbeatAt] = await Promise.all([
    readFile(path, 'utf8').then(parseOwner, () => null),
    stat(`${path}.lock`).then(value => value.mtime.toISOString(), () => null),
  ])
  return new AgentSessionStoreLeaseHeldError(path, heartbeatAt, owner, cause)
}

/** 同步调用方使用相同诊断结构。 */
function leaseHeldErrorSync(path: string, cause: unknown): AgentSessionStoreLeaseHeldError {
  let owner: AgentSessionStoreLeaseOwner | null
  let heartbeatAt: string | null
  try {
    owner = parseOwner(readFileSync(path, 'utf8'))
  }
  catch {
    owner = null
  }
  try {
    heartbeatAt = statSync(`${path}.lock`).mtime.toISOString()
  }
  catch {
    heartbeatAt = null
  }
  return new AgentSessionStoreLeaseHeldError(path, heartbeatAt, owner, cause)
}

/** 严格解析外部持久化 owner；旧空文件和未知字段都只视为未知诊断。 */
function parseOwner(text: string): AgentSessionStoreLeaseOwner | null {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  }
  catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  // JSON 属于外部持久化输入，必须从 unknown 收窄后再读取字段。
  const owner = value as Record<string, unknown>
  const keys = Object.keys(owner).sort()
  const expected = ['acquiredAt', 'kind', 'leaseId', 'pid', 'runtime', 'runtimeVersion', 'schema'].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || owner.schema !== AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA
    || typeof owner.leaseId !== 'string'
    || !CANONICAL_UUID_PATTERN.test(owner.leaseId)
    || owner.kind !== 'runtime' && owner.kind !== 'migration'
    || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
    || typeof owner.acquiredAt !== 'string' || Number.isNaN(Date.parse(owner.acquiredAt))
    || owner.runtime !== 'bun' && owner.runtime !== 'node'
    || typeof owner.runtimeVersion !== 'string' || owner.runtimeVersion.length === 0) {
    return null
  }
  return {
    schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
    leaseId: owner.leaseId,
    kind: owner.kind,
    pid: owner.pid,
    acquiredAt: owner.acquiredAt,
    runtime: owner.runtime,
    runtimeVersion: owner.runtimeVersion,
  }
}

/** proper-lockfile 在其他 owner 持有 lease 时使用 ELOCKED。 */
function isLockContention(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ELOCKED'
}

/**
 * 检测 lease 的 owner pid 是否仍存活；已死 (ESRCH) 时清掉 lease 文件 + lock directory,
 * 让后续 proper-lockfile.lock() 能正常接管。
 *
 * 历史教训（2026-08-17）：旧进程 OOM 死透但 lease 没释放, proper-lockfile 的
 * stale=30s 对 directory lockfile 行为不一致, 新进程持续 ELOCKED → 全站 500。
 *
 * 边界 case (2026-08-17 第七轮): 端到端测试残留 .lock + 空 lease (损坏 metadata),
 * proper-lockfile 看到 fresh mtime 也不接管, 全站 500。新逻辑: 即使 owner 解析失败
 * (null/损坏), 若 .lock mtime > 30s 视为 stale, 清 .lock 让 proper-lockfile 接管。
 *
 * 仍然只在 owner.pid 存在且 process.kill(pid, 0) 返回 ESRCH 时清完整 lease + .lock;
 * 解析失败 (损坏 metadata) 静默回退到 mtime 检查, 避免误杀别人的锁。
 *
 * 新进程 grace 期 (2026-08-17 第九轮): PM2 clean restart 时 .lock mtime 才 22s
 * (新进程自己刚创建 .lock), 落在 P1 30s 阈值外 → 持续 ELOCKED 500。新增启发式:
 * 进程 uptime < AGENT_SESSION_STORE_NEW_PROCESS_GRACE_MS (30s) 时, 即使 .lock mtime
 * 距今 < 30s, owner 解析失败 (null/空) 也接管。安全前提: 单一 PM2 实例 + live owner
 * 永远保护 (此分支仅在 owner.pid 已死或解析失败时触发)。
 */
async function clearStaleSelfLock(leasePath: string): Promise<void> {
  const owner = await readLeaseOwner(leasePath)
  if (owner) {
    if (owner.pid === process.pid) return
    if (isProcessAlive(owner.pid)) return
    // owner.pid 已死 (ESRCH) → 清 lease + .lock 接管
    await rm(leasePath, { force: true })
    await rm(`${leasePath}.lock`, { recursive: true, force: true })
    return
  }
  // owner 解析失败 (损坏/空):
  // - 新进程 grace 期 (< 30s) → 任何残留 .lock 都视为 stale, 直接接管
  // - 进程运行 > 30s → 只清 mtime > 30s 的残留 (保护活跃 lock)
  if (isInNewProcessGracePeriod() || await isResidualLockStale(leasePath)) {
    await rm(leasePath, { force: true })
    await rm(`${leasePath}.lock`, { recursive: true, force: true })
  }
}

/** 同步版本, 给 acquireAgentSessionStoreLeaseSync 启动路径使用。 */
function clearStaleSelfLockSync(leasePath: string): void {
  let owner: AgentSessionStoreLeaseOwner | null = null
  try {
    owner = parseOwner(readFileSync(leasePath, 'utf8'))
  }
  catch {
    // ignore: fall through to mtime check
  }
  if (owner) {
    if (owner.pid === process.pid) return
    if (isProcessAlive(owner.pid)) return
    try {
      rmSync(leasePath)
    }
    catch {
      // 文件可能已被并发清理; 继续清 .lock
    }
    try {
      rmSync(`${leasePath}.lock`, { recursive: true, force: true })
    }
    catch {
      // 同样 best-effort
    }
    return
  }
  // owner 解析失败 → 同 async 路径, grace 期启发式接管
  if (isInNewProcessGracePeriod() || isResidualLockStaleSync(leasePath)) {
    try {
      rmSync(leasePath)
    }
    catch {
      // best-effort
    }
    try {
      rmSync(`${leasePath}.lock`, { recursive: true, force: true })
    }
    catch {
      // best-effort
    }
  }
}

/** 检测 .lock directory mtime > 30s 视为残留 stale lock。 */
async function isResidualLockStale(leasePath: string): Promise<boolean> {
  try {
    const lockStat = await stat(`${leasePath}.lock`)
    return Date.now() - lockStat.mtimeMs > AGENT_SESSION_STORE_LEASE_RESIDUAL_LOCK_MS
  }
  catch {
    // .lock 不存在, 不视为 stale
    return false
  }
}

/** 同步版本: 检测 .lock directory mtime > 30s 视为残留 stale lock。 */
function isResidualLockStaleSync(leasePath: string): boolean {
  try {
    const lockStat = statSync(`${leasePath}.lock`)
    return Date.now() - lockStat.mtimeMs > AGENT_SESSION_STORE_LEASE_RESIDUAL_LOCK_MS
  }
  catch {
    return false
  }
}

/** 读取 lease owner metadata, 失败或损坏时返回 null (静默回退给 proper-lockfile 协议)。 */
async function readLeaseOwner(leasePath: string): Promise<AgentSessionStoreLeaseOwner | null> {
  let text: string
  try {
    text = await readFile(leasePath, 'utf8')
  }
  catch {
    return null
  }
  return parseOwner(text)
}

/**
 * 用 process.kill(pid, 0) 探测进程是否存活 (不发任何信号)。
 * - 返回 true: 进程存在 (kill 0 成功, 或 EPERM 表示有权限问题但确实存在)。
 * - 返回 false: 进程已死 (ESRCH)。
 * - 抛其他错误: 透传给上游, 不静默吞。
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    // EPERM 等其他错误表示进程存在但我们没权限, 视为 alive, 让 proper-lockfile 抛 ELOCKED。
    return true
  }
}

/**
 * 启发式: 当前进程是新启动的 (uptime < grace 期), 在 clearStaleSelfLock 中
 * 可信地接管残留 .lock, 即便 mtime < RESIDUAL_LOCK_MS。
 *
 * 安全前提: 单一 PM2 实例 + live owner 永远保护 (此函数仅在 owner 解析失败时
 * 影响行为, 不会触发"另一个活进程"的抢锁)。
 */
function isInNewProcessGracePeriod(): boolean {
  return process.uptime() * 1000 < AGENT_SESSION_STORE_NEW_PROCESS_GRACE_MS
}

/** 将未知失败收窄为可聚合 Error。 */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
