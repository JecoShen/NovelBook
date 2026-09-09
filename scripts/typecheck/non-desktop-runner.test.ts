import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_LAYER_OUTPUT_BYTES,
  TYPECHECK_RUN_ROOT_RELATIVE,
  createTypecheckRunRoot,
  formatRunReport,
  runNonDesktopTypecheck,
  runNonDesktopTypecheckCli,
  selectLayersThrough,
  type TypecheckLayer,
} from 'nbook/scripts/typecheck/non-desktop-runner'

const TYPE_ERROR_TEXT = 'Type \'string\' is not assignable to type \'number\''

const temporaryRoots: string[] = []
const fixtureRoot = resolve('scripts/typecheck/fixtures')
const runnerEntry = resolve('scripts/typecheck/non-desktop-runner.ts')

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('non-desktop typecheck runner', () => {
  it('runs one layer at a time and stops after the first failure', async () => {
    const runRoot = await createRunRoot()

    const report = await runNonDesktopTypecheck({
      runRoot,
      layers: [ok('first'), fail('second'), ok('never')],
      sampleIntervalMs: 20,
    })

    expect(report.layers.map(layer => layer.name)).toEqual(['first', 'second'])
    expect(report.exitCode).not.toBe(0)
    await expect(pathExists(runRoot)).resolves.toBe(false)
  })

  it('kills the whole process group at the RSS limit and leaves no child', async () => {
    const runRoot = await createRunRoot()

    const report = await runNonDesktopTypecheck({
      runRoot,
      layers: [holdWithChild('rss-limit')],
      maxSingleRssKiB: 32_768,
      minMemAvailableKiB: 1,
      sampleIntervalMs: 20,
    })

    expect(report.layers[0]?.stopReason).toBe('max-single-rss')
    await expect(processGroupExists(report.layers[0]!.pgid)).resolves.toBe(false)
    await expect(pathExists(runRoot)).resolves.toBe(false)
  })
})

describe('non-desktop typecheck runner output capture', () => {
  it('captures layer stdout and stderr into the layer and aggregate report', async () => {
    const runRoot = await createRunRoot()

    const report = await runNonDesktopTypecheck({
      runRoot,
      layers: [emit('diagnostics', TYPE_ERROR_TEXT, 1)],
      sampleIntervalMs: 20,
    })

    expect(report.layers[0]?.output).toContain(TYPE_ERROR_TEXT)
    expect(report.layers[0]?.output).toContain('stderr-marker')
    expect(report.output).toContain(TYPE_ERROR_TEXT)
    expect(report.layers[0]?.exitCode).toBe(1)
    await expect(pathExists(runRoot)).resolves.toBe(false)
  })

  it('leaves the output empty and the exit code intact for a silent layer', async () => {
    const runRoot = await createRunRoot()

    const report = await runNonDesktopTypecheck({
      runRoot,
      layers: [ok('silent')],
      sampleIntervalMs: 20,
    })

    expect(report.layers[0]?.output).toBe('')
    expect(report.output).toBe('')
    expect(report.exitCode).toBe(0)
  })

  it('keeps the output tail and marks truncation past the byte cap', async () => {
    const runRoot = await createRunRoot()

    const report = await runNonDesktopTypecheck({
      runRoot,
      layers: [flood('flooding', 64)],
      maxLayerOutputBytes: 4_096,
      sampleIntervalMs: 20,
    })

    const output = report.layers[0]?.output ?? ''
    expect(output).toContain('output truncated')
    expect(output).toContain('tail-marker-final')
    expect(output).not.toContain('head-marker-first')
    expect(MAX_LAYER_OUTPUT_BYTES).toBeGreaterThanOrEqual(4_096)
  })
})

describe('non-desktop typecheck runner cli', () => {
  it('runs layers through the requested one and never starts later layers', async () => {
    const runRoot = await createRunRoot()
    const printed: string[] = []

    const exitCode = await runNonDesktopTypecheckCli({
      argv: ['--through', 'second'],
      layers: [ok('first'), ok('second'), fail('third')],
      createRunRoot: () => Promise.resolve(runRoot),
      writeOut: (text) => { printed.push(text) },
      writeError: (text) => { printed.push(text) },
    })

    expect(exitCode).toBe(0)
    expect(printed.join('\n')).toContain('first')
    expect(printed.join('\n')).toContain('second')
    expect(printed.join('\n')).not.toContain('third')
  })

  it('reports every resource metric for each executed layer', async () => {
    const runRoot = await createRunRoot()
    const printed: string[] = []

    await runNonDesktopTypecheckCli({
      argv: [],
      layers: [ok('only')],
      createRunRoot: () => Promise.resolve(runRoot),
      writeOut: (text) => { printed.push(text) },
      writeError: (text) => { printed.push(text) },
    })

    expect(printed.join('\n')).toMatch(
      /only exitCode=0 durationMs=\d+ maxSingleRssKiB=\S+ maxGroupRssKiB=\S+ minMemAvailableKiB=\S+ stopReason=none/u,
    )
  })

  it('rejects an unknown --through layer, lists available names and creates no run root', async () => {
    const errors: string[] = []

    const exitCode = await runNonDesktopTypecheckCli({
      argv: ['--through', 'missing'],
      layers: [ok('first'), ok('second')],
      createRunRoot: () => Promise.reject(new Error('参数校验失败时不应创建 run root。')),
      writeOut: () => undefined,
      writeError: (text) => { errors.push(text) },
    })

    expect(exitCode).not.toBe(0)
    expect(errors.join('\n')).toContain('missing')
    expect(errors.join('\n')).toContain('first, second')
    expect(errors.join('\n')).not.toContain('run root')
  })

  it('refuses to report success when no layer is registered', async () => {
    const errors: string[] = []

    const exitCode = await runNonDesktopTypecheckCli({
      argv: [],
      layers: [],
      createRunRoot: () => Promise.reject(new Error('空层集合时不应创建 run root。')),
      writeOut: () => undefined,
      writeError: (text) => { errors.push(text) },
    })

    expect(exitCode).not.toBe(0)
    expect(errors.join('\n')).not.toContain('run root')
  })

  it('prints the failing layer output so type errors stay visible', async () => {
    const runRoot = await createRunRoot()
    const errors: string[] = []

    const exitCode = await runNonDesktopTypecheckCli({
      argv: [],
      layers: [emit('diagnostics', TYPE_ERROR_TEXT, 3)],
      createRunRoot: () => Promise.resolve(runRoot),
      writeOut: () => undefined,
      writeError: (text) => { errors.push(text) },
    })

    expect(exitCode).toBe(3)
    expect(errors.join('\n')).toContain(TYPE_ERROR_TEXT)
  })

  it('exposes a real CLI entry that fails on an unknown --through layer', async () => {
    const result = await runCliProcess(['--through', 'definitely-missing'])

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain('definitely-missing')
  })

  it('creates a unique run root under .agent/tmp/typecheck', async () => {
    const repoRoot = await createRunRoot()

    const first = await createTypecheckRunRoot(repoRoot)
    const second = await createTypecheckRunRoot(repoRoot)

    expect(TYPECHECK_RUN_ROOT_RELATIVE).toBe(join('.agent', 'tmp', 'typecheck'))
    expect(first).not.toBe(second)
    expect(first.startsWith(join(repoRoot, TYPECHECK_RUN_ROOT_RELATIVE))).toBe(true)
    await expect(pathExists(first)).resolves.toBe(true)
    await expect(pathExists(second)).resolves.toBe(true)
  })
})

describe('non-desktop typecheck layer selection and reporting', () => {
  it('selects the full topology when --through is absent', () => {
    const layers = [ok('first'), ok('second'), ok('third')]

    expect(selectLayersThrough(layers, null)).toHaveLength(3)
    expect(selectLayersThrough(layers, 'second').map(layer => layer.name)).toEqual(['first', 'second'])
  })

  it('names the stopped layer and its command in the summary', () => {
    const summary = formatRunReport({
      exitCode: 1,
      output: '',
      layers: [{
        name: 'runtime',
        command: ['tsc', '--build', 'typecheck/runtime'],
        pgid: 4_242,
        exitCode: 1,
        durationMs: 1_234,
        maxSingleRssKiB: 1_048_600,
        maxGroupRssKiB: 1_100_000,
        minMemAvailableKiB: 2_000_000,
        stopReason: 'max-single-rss',
        output: '',
      }],
    })

    expect(summary).toContain('runtime')
    expect(summary).toContain('max-single-rss')
    expect(summary).toContain('tsc --build typecheck/runtime')
    expect(summary).toContain('maxSingleRssKiB=1048600')
  })
})

function ok(name: string): TypecheckLayer {
  return layer(name, '0')
}

function fail(name: string): TypecheckLayer {
  return layer(name, '1')
}

function holdWithChild(name: string): TypecheckLayer {
  return {
    name,
    command: [process.execPath, join(fixtureRoot, 'hold.ts')],
  }
}

function emit(name: string, message: string, exitCode: number): TypecheckLayer {
  return {
    name,
    command: [process.execPath, join(fixtureRoot, 'emit.ts'), message, String(exitCode)],
  }
}

function flood(name: string, kibibytes: number): TypecheckLayer {
  return {
    name,
    command: [process.execPath, join(fixtureRoot, 'flood.ts'), String(kibibytes)],
  }
}

function layer(name: string, exitCode: string): TypecheckLayer {
  return {
    name,
    command: [process.execPath, join(fixtureRoot, 'exit.ts'), exitCode],
  }
}

async function runCliProcess(args: readonly string[]): Promise<{ exitCode: number, output: string }> {
  // 必须用 bun 而不是 `process.execPath`：runner 入口 import `nbook/*`，该前缀只由
  // tsconfig `paths` 定义（`node_modules/nbook` 不存在），node 会在导入期就
  // `ERR_MODULE_NOT_FOUND`，于是本用例只验证到"进程非零退出"而从未真正跑到 CLI。
  // 真实入口同样由 bun 执行（Task 7 的 package.json script）。
  const child = spawn('bun', ['run', runnerEntry, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', code => resolvePromise(code ?? 1))
  })
  return { exitCode, output }
}

async function createRunRoot(): Promise<string> {
  const temporaryRoot = resolve('.agent/tmp')
  await mkdir(temporaryRoot, { recursive: true })
  const runRoot = await mkdtemp(join(temporaryRoot, 'non-desktop-runner-'))
  temporaryRoots.push(runRoot)
  return runRoot
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function processGroupExists(pgid: number): Promise<boolean> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      process.kill(-pgid, 0)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
    }
    catch {
      return false
    }
  }
  return true
}
