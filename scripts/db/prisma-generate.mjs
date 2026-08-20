#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { preparePrismaEnv } from './prisma-env.mjs'

const env = preparePrismaEnv()
const bunCommand = process.execPath

await runPrismaGenerate('./prisma/schema.sqlite.prisma')
await runPrismaGenerate('./prisma/project.schema.prisma')

/** 顺序生成App与Project Client，任一schema失败都立即终止发布链。 */
async function runPrismaGenerate(schema) {
  const retryDelays = [0, 250, 500, 1_000, 2_000]
  for (const [attempt, delayMs] of retryDelays.entries()) {
    if (delayMs > 0) {
      await sleep(delayMs)
    }
    const result = await spawnPrismaGenerate(schema)
    if (result.signal) {
      process.kill(process.pid, result.signal)
      return
    }
    if (result.code === 0) {
      return
    }
    const canRetry = result.stderr.includes('EBUSY') && attempt < retryDelays.length - 1
    if (!canRetry) {
      process.exit(result.code ?? 1)
    }
    console.warn(`Prisma generate遇到Windows文件占用，准备重试 ${schema}（${attempt + 2}/${retryDelays.length}）`)
  }
}

/** 执行一次Prisma generate，并保留stderr用于识别Windows瞬时文件占用。 */
async function spawnPrismaGenerate(schema) {
  const child = spawn(bunCommand, [
    'x',
    'prisma',
    'generate',
    '--config',
    './prisma.config.ts',
    '--schema',
    schema,
  ], {
    env: { ...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl },
    stdio: ['inherit', 'inherit', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    process.stderr.write(chunk)
  })
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return { ...result, stderr }
}
