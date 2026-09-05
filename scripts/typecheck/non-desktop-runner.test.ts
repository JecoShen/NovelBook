import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  runNonDesktopTypecheck,
  type TypecheckLayer,
} from 'nbook/scripts/typecheck/non-desktop-runner'

const temporaryRoots: string[] = []
const fixtureRoot = resolve('scripts/typecheck/fixtures')

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

function layer(name: string, exitCode: string): TypecheckLayer {
  return {
    name,
    command: [process.execPath, join(fixtureRoot, 'exit.ts'), exitCode],
  }
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
