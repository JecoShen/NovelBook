import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'

import type { TypecheckLayer } from 'nbook/scripts/typecheck/non-desktop-layers'

export type { TypecheckLayer } from 'nbook/scripts/typecheck/non-desktop-layers'

export const RESOURCE_LIMITS = Object.freeze({
  maxSingleRssKiB: 1_048_576,
  minMemAvailableKiB: 2_097_152,
  sampleIntervalMs: 250,
})

export type TypecheckStopReason = 'max-single-rss' | 'min-mem-available' | 'signal'

export type TypecheckLayerReport = {
  readonly name: string
  readonly command: readonly [string, ...string[]]
  readonly pgid: number
  readonly exitCode: number
  readonly durationMs: number
  readonly maxSingleRssKiB: number | null
  readonly maxGroupRssKiB: number | null
  readonly minMemAvailableKiB: number | null
  readonly stopReason: TypecheckStopReason | null
}

export type TypecheckRunReport = {
  readonly exitCode: number
  readonly layers: readonly TypecheckLayerReport[]
}

export type RunOptions = {
  readonly runRoot: string
  readonly layers: readonly TypecheckLayer[]
  readonly maxSingleRssKiB?: number
  readonly minMemAvailableKiB?: number
  readonly sampleIntervalMs?: number
  /** 非 Linux CI 可关闭 /proc 采样；层命令与顺序保持不变。 */
  readonly sampleResources?: boolean
}

type GroupResources = {
  readonly maxSingleRssKiB: number
  readonly groupRssKiB: number
  readonly memAvailableKiB: number | null
}

type ChildCompletion = {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

type ActiveRun = {
  child: ChildProcess | null
  terminate: (() => void) | null
}

export async function runNonDesktopTypecheck(options: RunOptions): Promise<TypecheckRunReport> {
  const limits = {
    maxSingleRssKiB: options.maxSingleRssKiB ?? RESOURCE_LIMITS.maxSingleRssKiB,
    minMemAvailableKiB: options.minMemAvailableKiB ?? RESOURCE_LIMITS.minMemAvailableKiB,
    sampleIntervalMs: options.sampleIntervalMs ?? RESOURCE_LIMITS.sampleIntervalMs,
    sampleResources: options.sampleResources ?? process.platform === 'linux',
  }
  const results: TypecheckLayerReport[] = []
  const activeRun: ActiveRun = { child: null, terminate: null }
  let receivedSignal: NodeJS.Signals | null = null

  const handleSignal = (signal: NodeJS.Signals) => {
    receivedSignal ??= signal
    activeRun.terminate?.()
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  try {
    await mkdir(options.runRoot, { recursive: true })
    for (const layer of options.layers) {
      if (receivedSignal) break

      const result = await runGuardedLayer(layer, limits, activeRun)
      results.push(result)
      activeRun.child = null
      activeRun.terminate = null
      if (result.exitCode !== 0 || result.stopReason !== null) break
    }
    return summarize(results, receivedSignal)
  }
  finally {
    try {
      activeRun.terminate?.()
      await terminateOwnedProcessGroup(activeRun.child)
    }
    finally {
      process.off('SIGINT', handleSignal)
      process.off('SIGTERM', handleSignal)
      await rm(options.runRoot, { recursive: true, force: true })
    }
  }
}

async function runGuardedLayer(
  layer: TypecheckLayer,
  limits: Required<Pick<RunOptions, 'maxSingleRssKiB' | 'minMemAvailableKiB' | 'sampleIntervalMs' | 'sampleResources'>>,
  activeRun: ActiveRun,
): Promise<TypecheckLayerReport> {
  const startedAt = Date.now()
  const child = spawn(layer.command[0], layer.command.slice(1), {
    detached: true,
    stdio: 'ignore',
  })
  const pgid = child.pid
  if (!pgid) throw new Error(`无法启动 typecheck 层 ${layer.name}。`)

  activeRun.child = child
  let stopReason: TypecheckStopReason | null = null
  let termination: Promise<void> | null = null
  const requestStop = (reason: TypecheckStopReason) => {
    if (stopReason) return
    stopReason = reason
    termination = terminateOwnedProcessGroup(child)
  }
  activeRun.terminate = () => requestStop('signal')

  let maxSingleRssKiB: number | null = limits.sampleResources ? 0 : null
  let maxGroupRssKiB: number | null = limits.sampleResources ? 0 : null
  let minMemAvailableKiB: number | null = null
  const completion = waitForChild(child)
  let completed: ChildCompletion | null = null

  while (completed === null) {
    if (limits.sampleResources) {
      const resources = await readGroupResources(pgid)
      maxSingleRssKiB = Math.max(maxSingleRssKiB ?? 0, resources.maxSingleRssKiB)
      maxGroupRssKiB = Math.max(maxGroupRssKiB ?? 0, resources.groupRssKiB)
      if (resources.memAvailableKiB !== null) {
        minMemAvailableKiB = Math.min(minMemAvailableKiB ?? resources.memAvailableKiB, resources.memAvailableKiB)
        if (resources.memAvailableKiB < limits.minMemAvailableKiB) requestStop('min-mem-available')
      }
      if (resources.maxSingleRssKiB >= limits.maxSingleRssKiB) requestStop('max-single-rss')
    }
    const maybeCompleted = await Promise.race([
      completion,
      delay(limits.sampleIntervalMs).then(() => null),
    ])
    if (maybeCompleted) completed = maybeCompleted
  }

  if (termination) await termination
  if (!completed) throw new Error(`typecheck 层 ${layer.name} 未返回退出状态。`)
  const exitCode = completed.exitCode ?? 1
  return {
    name: layer.name,
    command: layer.command,
    pgid,
    exitCode,
    durationMs: Date.now() - startedAt,
    maxSingleRssKiB,
    maxGroupRssKiB,
    minMemAvailableKiB,
    stopReason,
  }
}

function summarize(layers: readonly TypecheckLayerReport[], receivedSignal: NodeJS.Signals | null): TypecheckRunReport {
  const failedLayer = layers.find(layer => layer.exitCode !== 0 || layer.stopReason !== null)
  return {
    exitCode: failedLayer ? failedLayer.exitCode || 1 : receivedSignal ? 1 : 0,
    layers,
  }
}

function waitForChild(child: ChildProcess): Promise<ChildCompletion> {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (exitCode, signal) => {
      resolvePromise({ exitCode, signal })
    })
  })
}

async function readGroupResources(pgid: number): Promise<GroupResources> {
  const processIds = await readdir('/proc', { withFileTypes: true })
  const rssValues = await Promise.all(processIds
    .filter(entry => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map(entry => readProcessRssKiB(entry.name, pgid)))
  const members = rssValues.filter((rss): rss is number => rss !== null)
  const memAvailableKiB = await readMemAvailableKiB()
  return {
    maxSingleRssKiB: Math.max(0, ...members),
    groupRssKiB: members.reduce((total, rss) => total + rss, 0),
    memAvailableKiB,
  }
}

async function readProcessRssKiB(processId: string, pgid: number): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${processId}/stat`, 'utf8')
    if (processGroupId(stat) !== pgid) return null
    const status = await readFile(`/proc/${processId}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status)
    return match ? Number.parseInt(match[1]!, 10) : 0
  }
  catch {
    return null
  }
}

function processGroupId(stat: string): number | null {
  const closingParenthesis = stat.lastIndexOf(')')
  if (closingParenthesis === -1) return null
  const fields = stat.slice(closingParenthesis + 2).trim().split(/\s+/u)
  const pgid = Number.parseInt(fields[2] ?? '', 10)
  return Number.isInteger(pgid) ? pgid : null
}

async function readMemAvailableKiB(): Promise<number | null> {
  try {
    const meminfo = await readFile('/proc/meminfo', 'utf8')
    const match = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(meminfo)
    return match ? Number.parseInt(match[1]!, 10) : null
  }
  catch {
    return null
  }
}

async function terminateOwnedProcessGroup(child: ChildProcess | null): Promise<void> {
  if (!child?.pid) return
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL'] as const) {
    if (!sendSignalToProcessGroup(child.pid, signal)) return
    await waitForProcessGroupExit(child.pid, 250)
    if (!processGroupExists(child.pid)) return
  }
}

function sendSignalToProcessGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal)
    return true
  }
  catch (error: unknown) {
    if (isNoSuchProcessError(error)) return false
    throw error
  }
}

async function waitForProcessGroupExit(pgid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && processGroupExists(pgid)) {
    await delay(20)
  }
}

function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  }
  catch {
    return false
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ESRCH'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}
