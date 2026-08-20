#!/usr/bin/env bun
/**
 * NeuroBook Agent Bridge CLI。
 *
 * 5 个子命令：
 * - open <projectRoot>          打开 project + 创建 leader session
 * - send <sessionId> "<prompt>" 阻塞 invoke（自动生成 clientMessageId）
 * - read <projectRoot> <path>   读 project 内文本文件
 * - abort <sessionId>           中断 in-flight invocation（复用现有 abort 端点）
 * - status <sessionId>          查 session recovery
 *
 * Token: --token 或 $NEURO_BOOK_BRIDGE_TOKEN。Base URL: --base-url，默认 127.0.0.1:3000。
 */
import { Command } from 'commander'
import { openCommand } from './commands/open'
import { sendCommand } from './commands/send'
import { readCommand } from './commands/read'
import { abortCommand } from './commands/abort'
import { statusCommand } from './commands/status'

const program = new Command()
program
  .name('nbook-bridge')
  .description('NeuroBook Agent Bridge CLI（同机调 leader 写章节）')
  .version('0.0.1')
  .option('--token <token>', 'bridge token；默认读 $NEURO_BOOK_BRIDGE_TOKEN')
  .option('--base-url <url>', 'bridge base URL', 'http://127.0.0.1:3000')

interface GlobalOptions {
  token?: string
  baseUrl: string
}

function resolveToken(): string {
  const opts = program.opts<GlobalOptions>()
  const token = opts.token ?? process.env.NEURO_BOOK_BRIDGE_TOKEN
  if (!token) {
    throw new Error('bridge token 未提供：--token 或 NEURO_BOOK_BRIDGE_TOKEN env')
  }
  return token
}

function resolveBaseUrl(): string {
  return program.opts<GlobalOptions>().baseUrl
}

program
  .command('open')
  .description('打开 project 并创建绑定的 leader session')
  .argument('<projectRoot>', 'project root（单段目录名）')
  .option('-p, --profile <profileKey>', 'profile key', 'leader.default')
  .action(async (projectRoot: string, options: { profile: string }) => {
    const result = await openCommand({
      projectRoot,
      profileKey: options.profile,
      token: resolveToken(),
      baseUrl: resolveBaseUrl(),
    })
    console.log(JSON.stringify(result, null, 2))
  })

program
  .command('send')
  .description('向 leader session 发消息（阻塞等 InvokeAgentResult）')
  .argument('<sessionId>', 'session id（正整数）', Number)
  .argument('<message>', '消息正文')
  .option('--followup', '使用 mode=followup（纠偏）', false)
  .option('-t, --title <title>', 'invoke title（持久化到 session log）')
  .action(async (sessionId: number, message: string, options: { followup: boolean, title?: string }) => {
    const result = await sendCommand({
      sessionId,
      message,
      followup: options.followup,
      title: options.title,
      token: resolveToken(),
      baseUrl: resolveBaseUrl(),
    })
    console.log(JSON.stringify(result, null, 2))
  })

program
  .command('read')
  .description('读 project 内文本文件（dev/product 同入口）')
  .argument('<projectRoot>', 'project root')
  .argument('<path>', 'project 内的相对路径，如 manuscript/001-volume/001-chapter/index.md')
  .action(async (projectRoot: string, filePath: string) => {
    const result = await readCommand({
      projectRoot,
      path: filePath,
      token: resolveToken(),
      baseUrl: resolveBaseUrl(),
    })
    console.log(result.content)
  })

program
  .command('abort')
  .description('中断 in-flight invocation（复用 /api/agent/sessions/:id/abort）')
  .argument('<sessionId>', 'session id（正整数）', Number)
  .option('-r, --reason <reason>', 'abort reason')
  .action(async (sessionId: number, options: { reason?: string }) => {
    const result = await abortCommand({
      sessionId,
      reason: options.reason,
      token: resolveToken(),
      baseUrl: resolveBaseUrl(),
    })
    console.log(JSON.stringify(result, null, 2))
  })

program
  .command('status')
  .description('查 session recovery（复用 /api/agent/sessions/:id?view=recovery）')
  .argument('<sessionId>', 'session id（正整数）', Number)
  .action(async (sessionId: number) => {
    const result = await statusCommand({
      sessionId,
      token: resolveToken(),
      baseUrl: resolveBaseUrl(),
    })
    console.log(JSON.stringify(result, null, 2))
  })

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
