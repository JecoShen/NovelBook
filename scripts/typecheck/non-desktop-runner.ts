import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { parseArgs } from 'node:util'

import { materializeTypecheckLayers } from '#scripts/typecheck/layer-project-configs'
import {
  NON_DESKTOP_TYPECHECK_LAYERS,
  type TypecheckLayer,
  type TypecheckLayerDefinition,
} from '#scripts/typecheck/non-desktop-layers'

export type { TypecheckLayer, TypecheckLayerDefinition } from '#scripts/typecheck/non-desktop-layers'

/**
 * 资源止损线。
 *
 * `maxSingleRssKiB` 从 spec 初稿的 `1_048_576`（1 GiB）修正为 `1_310_720`（1.25 GiB）。
 * 依据是 Task 4 的实测，不是为了让门禁放行：
 *
 * - `agent` 层是一个 **83 文件的不可分强连通分量**（改源码才能拆），真实峰值实测
 *   1058972 KiB @250ms / 1066264 KiB @25ms，**超 1 GiB 仅约 1.7%**，且该层类型检查
 *   本身干净（exit 0）。
 * - 1 GiB 这条线在 spec 里是**目标值，没有物理推导**；真正的机器保护是
 *   `minMemAvailableKiB`。agent 峰值时 `MemAvailable` 实测最低 2835176 KiB，
 *   距 2 GiB 底线仍有 700+ MiB —— 机器安全从未受威胁，故该底线**保持不变**。
 * - 反过来，把 agent 层排除在门禁外会违反 spec 目标「类型错误仍全部受门禁覆盖」，
 *   并且是覆盖回归：根 `tsconfig.json` 今天就检查 `server/agent/**`。
 * - 跨运行方差实测 42–63 MiB（contracts 871004→913032，agent-support 925552→988996），
 *   **大于 agent 的超线幅度**。1 GiB 线只给 agent-support 留 58 MiB 余量，在一次自身
 *   方差之内，门禁会无代码改动而翻红。1.25 GiB 给最大层留 244456 KiB ≈ 3.8 倍最坏方差。
 *
 * 已排除的纯配置手段（都不改源码，实测均不足以下线）：`--disableReferencedProjectLoad`
 * 零效果（`-p` 本就不载入上游源码）；收窄 `types` 只省约 16 MiB 仍超线，且余量落在噪声内。
 * 成本主导项是 typebox `Static<>` 的条件类型求值（trace 中 `Conditional → Conditional`
 * 占 `structuredTypeRelatedTo` 累计耗时 62.7%），属第三方类型机器病理，非本层结构问题。
 */
export const RESOURCE_LIMITS = Object.freeze({
  maxSingleRssKiB: 1_310_720,
  minMemAvailableKiB: 2_097_152,
  sampleIntervalMs: 250,
})

/**
 * 单层输出保留上限（字节）。
 *
 * 1 MiB 已经能装下约一万条 tsc 诊断行，远超任何人会读的量；
 * 而 8 个层最坏情况合计 8 MiB，对 1310720 KiB 单进程 RSS 线和
 * 2097152 KiB MemAvailable 底线都可忽略。目的是让"某层刷海量输出"
 * 不能通过 runner 自身的缓冲把内存吃穿。
 */
export const MAX_LAYER_OUTPUT_BYTES = 1_048_576

/** `.agent/tmp/typecheck/<runId>` 的固定前缀；runner 拥有并在 finally 清理该目录。 */
export const TYPECHECK_RUN_ROOT_RELATIVE = join('.agent', 'tmp', 'typecheck')

/** 参数或层注册无效时的退出码：这一类失败发生在任何 run report 存在之前。 */
export const CLI_USAGE_EXIT_CODE = 2

/**
 * 子进程 exit 之后排空管道的时限。
 *
 * 用 `exit` 而不是 `close` 判定完成：孙进程继承管道时 `close` 可能永不触发，
 * 那会让 runner 在被止损后挂住。限时排空 + destroy 兼顾"输出不丢"和"不挂住"。
 */
const OUTPUT_DRAIN_TIMEOUT_MS = 1_000

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
  /** 该层 stdout + stderr 按到达顺序合并；超过上限时保留尾部并标注截断。 */
  readonly output: string
}

export type TypecheckRunReport = {
  readonly exitCode: number
  readonly layers: readonly TypecheckLayerReport[]
  /** 各有输出层的聚合文本，按执行顺序拼接并标注层名。 */
  readonly output: string
}

export type RunOptions = {
  readonly runRoot: string
  readonly layers: readonly TypecheckLayer[]
  readonly maxSingleRssKiB?: number
  readonly minMemAvailableKiB?: number
  readonly sampleIntervalMs?: number
  readonly maxLayerOutputBytes?: number
  /** 非 Linux CI 可关闭 /proc 采样；层命令与顺序保持不变。 */
  readonly sampleResources?: boolean
}

type ResolvedLimits = Required<Pick<
  RunOptions,
  'maxSingleRssKiB' | 'minMemAvailableKiB' | 'sampleIntervalMs' | 'maxLayerOutputBytes' | 'sampleResources'
>>

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

type OutputCollector = {
  push: (chunk: Buffer) => void
  text: () => string
}

export async function runNonDesktopTypecheck(options: RunOptions): Promise<TypecheckRunReport> {
  const limits: ResolvedLimits = {
    maxSingleRssKiB: options.maxSingleRssKiB ?? RESOURCE_LIMITS.maxSingleRssKiB,
    minMemAvailableKiB: options.minMemAvailableKiB ?? RESOURCE_LIMITS.minMemAvailableKiB,
    sampleIntervalMs: options.sampleIntervalMs ?? RESOURCE_LIMITS.sampleIntervalMs,
    maxLayerOutputBytes: options.maxLayerOutputBytes ?? MAX_LAYER_OUTPUT_BYTES,
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
  limits: ResolvedLimits,
  activeRun: ActiveRun,
): Promise<TypecheckLayerReport> {
  const startedAt = Date.now()
  const child = spawn(layer.command[0], layer.command.slice(1), {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const pgid = child.pid
  if (!pgid) throw new Error(`无法启动 typecheck 层 ${layer.name}。`)

  // 管道必须立即进入流动模式：不消费的话子进程写满 64 KiB 内核缓冲后会阻塞。
  const collector = createOutputCollector(limits.maxLayerOutputBytes)
  child.stdout?.on('data', (chunk: Buffer) => {
    collector.push(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    collector.push(chunk)
  })

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
  await drainChildOutput(child, OUTPUT_DRAIN_TIMEOUT_MS)
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
    output: collector.text(),
  }
}

/**
 * 有界输出缓冲：超过上限时从头部丢弃，保留最后 `maxBytes` 字节并标注截断。
 *
 * 保留尾部是因为 tsc 把 `Found N errors` 汇总打在最后，尾部信息密度更高。
 */
function createOutputCollector(maxBytes: number): OutputCollector {
  const chunks: Buffer[] = []
  let bufferedBytes = 0
  let droppedBytes = 0

  return {
    push(chunk: Buffer) {
      if (chunk.byteLength === 0) return
      chunks.push(chunk)
      bufferedBytes += chunk.byteLength
      while (bufferedBytes > maxBytes && chunks.length > 0) {
        const overflow = bufferedBytes - maxBytes
        const head = chunks[0]!
        if (head.byteLength <= overflow) {
          chunks.shift()
          bufferedBytes -= head.byteLength
          droppedBytes += head.byteLength
          continue
        }
        chunks[0] = head.subarray(overflow)
        bufferedBytes -= overflow
        droppedBytes += overflow
      }
    },
    text() {
      const body = Buffer.concat(chunks).toString('utf8')
      if (droppedBytes === 0) return body
      return `[output truncated: dropped first ${droppedBytes} bytes, kept last ${bufferedBytes} bytes]\n${body}`
    },
  }
}

function summarize(layers: readonly TypecheckLayerReport[], receivedSignal: NodeJS.Signals | null): TypecheckRunReport {
  const failedLayer = layers.find(layer => layer.exitCode !== 0 || layer.stopReason !== null)
  return {
    exitCode: failedLayer ? failedLayer.exitCode || 1 : receivedSignal ? 1 : 0,
    layers,
    output: layers
      .filter(layer => layer.output.length > 0)
      .map(layer => `[layer ${layer.name}]\n${layer.output}`)
      .join('\n'),
  }
}

/**
 * 只等 `exit`：`close` 要求所有 stdio 流关闭，孙进程继承管道时可能永不触发。
 * 输出完整性由 `drainChildOutput` 单独负责。
 */
function waitForChild(child: ChildProcess): Promise<ChildCompletion> {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (exitCode, signal) => {
      resolvePromise({ exitCode, signal })
    })
  })
}

async function drainChildOutput(child: ChildProcess, timeoutMs: number): Promise<void> {
  const streams = [child.stdout, child.stderr].filter((stream): stream is Readable => stream !== null)
  if (streams.length === 0) return
  const ended = Promise.all(streams.map(stream => new Promise<void>((resolvePromise) => {
    if (stream.readableEnded || stream.destroyed) {
      resolvePromise()
      return
    }
    stream.once('end', resolvePromise)
    stream.once('close', resolvePromise)
    stream.once('error', () => resolvePromise())
  })))
  await Promise.race([ended, delay(timeoutMs)])
  for (const stream of streams) stream.destroy()
}

// ── CLI ────────────────────────────────────────────────────────────────────

export type RunnerCliOptions = {
  readonly through: string | null
}

export type RunnerCliDependencies = {
  readonly argv?: readonly string[]
  readonly layers?: readonly TypecheckLayerDefinition[]
  readonly repoRoot?: string
  readonly createRunRoot?: () => Promise<string>
  readonly run?: (options: RunOptions) => Promise<TypecheckRunReport>
  readonly writeOut?: (text: string) => void
  readonly writeError?: (text: string) => void
}

export function parseRunnerCliArgs(argv: readonly string[]): RunnerCliOptions {
  try {
    const { values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: { through: { type: 'string' } },
      strict: true,
    })
    return { through: values.through ?? null }
  }
  catch (error: unknown) {
    throw new Error(`非桌面 typecheck runner 参数无效：${describeError(error)}`, { cause: error })
  }
}

/** `--through <layer>`：按拓扑顺序执行到该层（含），其后的层不运行。 */
export function selectLayersThrough<T extends { readonly name: string }>(
  layers: readonly T[],
  through: string | null,
): readonly T[] {
  if (through === null) return layers
  const index = layers.findIndex(layer => layer.name === through)
  if (index === -1) {
    const available = layers.length > 0
      ? layers.map(layer => layer.name).join(', ')
      : '(当前未注册任何层)'
    throw new Error(`未知的 typecheck 层 --through ${through}。可用层：${available}`)
  }
  return layers.slice(0, index + 1)
}

/** 创建本次运行独占的 `.agent/tmp/typecheck/<runId>`；mkdtemp 保证 runId 唯一。 */
export async function createTypecheckRunRoot(repoRoot: string = process.cwd()): Promise<string> {
  const parent = resolve(repoRoot, TYPECHECK_RUN_ROOT_RELATIVE)
  await mkdir(parent, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  return await mkdtemp(join(parent, `${stamp}-`))
}

export function formatRunReport(report: TypecheckRunReport): string {
  const lines = report.layers.map(formatLayerReport)
  const stopped = report.layers.find(layer => layer.stopReason !== null)
  if (stopped) {
    lines.push(
      `止损：层 ${stopped.name} 触发 ${stopped.stopReason}，`
      + `命令 ${formatCommand(stopped.command)}；后续层未运行。`,
    )
  }
  const failed = report.layers.find(layer => layer.exitCode !== 0 && layer.stopReason === null)
  if (failed) {
    lines.push(
      `失败：层 ${failed.name} 退出码 ${failed.exitCode}，`
      + `命令 ${formatCommand(failed.command)}；后续层未运行。`,
    )
  }
  lines.push(`聚合退出码：${report.exitCode}`)
  return lines.join('\n')
}

function formatLayerReport(layer: TypecheckLayerReport): string {
  return [
    `层 ${layer.name}`,
    `exitCode=${layer.exitCode}`,
    `durationMs=${layer.durationMs}`,
    `maxSingleRssKiB=${formatMetric(layer.maxSingleRssKiB)}`,
    `maxGroupRssKiB=${formatMetric(layer.maxGroupRssKiB)}`,
    `minMemAvailableKiB=${formatMetric(layer.minMemAvailableKiB)}`,
    `stopReason=${layer.stopReason ?? 'none'}`,
  ].join(' ')
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : String(value)
}

function formatCommand(command: readonly string[]): string {
  return command
    .map(part => /^[\w./:=@-]+$/u.test(part) ? part : JSON.stringify(part))
    .join(' ')
}

export async function runNonDesktopTypecheckCli(dependencies: RunnerCliDependencies = {}): Promise<number> {
  const writeOut = dependencies.writeOut ?? ((text: string) => {
    console.log(text)
  })
  const writeError = dependencies.writeError ?? ((text: string) => {
    console.error(text)
  })
  const layers = dependencies.layers ?? NON_DESKTOP_TYPECHECK_LAYERS

  let selected: readonly TypecheckLayerDefinition[]
  try {
    const { through } = parseRunnerCliArgs(dependencies.argv ?? process.argv.slice(2))
    selected = selectLayersThrough(layers, through)
  }
  catch (error: unknown) {
    writeError(describeError(error))
    return CLI_USAGE_EXIT_CODE
  }
  if (selected.length === 0) {
    writeError('未注册任何非桌面 typecheck 层：空运行不能算作通过的门禁。')
    return CLI_USAGE_EXIT_CODE
  }

  try {
    const repoRoot = dependencies.repoRoot ?? process.cwd()
    const runRoot = await (dependencies.createRunRoot ?? createTypecheckRunRoot)()
    // per-run 配置必须写在 runRoot 内且在层执行之前：runNonDesktopTypecheck 在 finally 里
    // 删掉整个 runRoot，生成物随之清理，仓库树不留任何构建产物。
    const runnable = await materializeTypecheckLayers(selected, { runRoot, repoRoot })
    const report = await (dependencies.run ?? runNonDesktopTypecheck)({ runRoot, layers: runnable })
    writeOut(formatRunReport(report))
    for (const layer of report.layers) {
      if (layer.output.length === 0) continue
      if (layer.exitCode === 0 && layer.stopReason === null) continue
      writeError(`── 层 ${layer.name} 输出 ──\n${layer.output}`)
    }
    return report.exitCode
  }
  catch (error: unknown) {
    writeError(`非桌面 typecheck runner 运行失败：${describeError(error)}`)
    return 1
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── /proc 采样与进程组归属 ───────────────────────────────────────────────────

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

if (import.meta.main) {
  process.exitCode = await runNonDesktopTypecheckCli()
}
