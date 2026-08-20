import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { NeuroAgentHarness } from 'nbook/server/agent/harness/neuro-agent-harness'
import { resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig } from 'nbook/server/agent/harness/model-resolver'
import { resolvePiModelsFromConfig } from 'nbook/server/agent/harness/pi-runtime-resolver'
import { JsonlSessionRepository } from 'nbook/server/agent/session/session-repo'
import { messageText } from 'nbook/server/agent/messages/message-utils'
import { loadGlobalEffectiveConfigSync } from 'nbook/server/config/config-service'

const PROFILE_KEY = 'leader.default'

/**
 * 手动验证 Agent harness 的真实 provider、event、usage 和 JSONL session 链路。
 */
async function main(): Promise<void> {
  const startedAt = Date.now()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const workspaceRoot = path.resolve('.agent', 'agent-smoke', stamp)

  try {
    const config = loadGlobalEffectiveConfigSync()
    const model = resolvePiModelFromConfig(config, PROFILE_KEY)
    const apiKey = resolvePiApiKeyForModelFromConfig(config, model)
    if (!apiKey) {
      throw new Error(`provider ${model.provider} 未配置 apiKey，请先在 workspace/.nbook/config.json 或设置页中填写真实 Provider 密钥`)
    }

    await fs.mkdir(workspaceRoot, { recursive: true })
    const harness = new NeuroAgentHarness({
      repo: new JsonlSessionRepository(workspaceRoot),
      modelResolver: () => model,
      runtimeResolver: () => resolvePiModelsFromConfig(config, model),
    })
    const agent = await harness.createAgent({
      profileKey: PROFILE_KEY,
      initial: {
        role: 'smoke',
      },
    })

    const result = await harness.invokeAgent({
      sessionId: agent.sessionId,
      mode: 'prompt',
      message: {
        text: '用一句中文回复：agent session smoke ok。',
      },
    })
    const snapshot = await harness.repo.readSession(agent.sessionId)
    const context = harness.repo.reduce(snapshot)
    const compactionStatus = process.env.AGENT_SMOKE_COMPACT === '1'
      ? await runCompactionSmoke(harness, agent.sessionId)
      : 'not-requested'
    const finalSnapshot = await harness.repo.readSession(agent.sessionId)
    const sessionPath = path.join(
      workspaceRoot,
      '.nbook',
      'agent',
      'sessions',
      `${String(agent.sessionId)}.jsonl`,
    )

    console.log([
      '# Agent Smoke',
      '',
      `Profile: ${PROFILE_KEY}`,
      `Model: ${model.provider}/${model.id}`,
      `Workspace: ${workspaceRoot}`,
      `Session: ${String(agent.sessionId)}`,
      `Session JSONL: ${sessionPath}`,
      `Status: ${result.status}`,
      `Duration: ${String(Date.now() - startedAt)}ms`,
      `Session entries: ${String(finalSnapshot.entries.length)}`,
      `Compaction: ${compactionStatus}`,
      result.usage ? `Usage: ${JSON.stringify(result.usage)}` : 'Usage: (not reported)',
      '',
      '## Result',
      '',
      result.reportResult ? JSON.stringify(result.reportResult, null, 2) : result.finalMessage ?? '(empty)',
      '',
      '## Last Messages',
      '',
      ...context.messages.slice(-6).map((message, index) => `${String(index + 1)}. ${message.role}: ${truncate(messageText(message as never))}`),
      '',
    ].join('\n'))

    if (result.status === 'error' || compactionStatus === 'error' || !(result.finalMessage ?? result.reportResult?.result ?? '').includes('smoke')) {
      process.exitCode = 1
    }
    await harness.drainBackgroundTasks()
  }
  catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
  }
}

/** 执行一次真实手动 compaction，并等待 lifecycle 结束。 */
async function runCompactionSmoke(harness: NeuroAgentHarness, sessionId: number): Promise<'completed' | 'error'> {
  await harness.runCommand(sessionId, {
    command: 'compact',
    instructions: '保留本次 smoke 的用户目标、模型响应和验证结论。',
  })
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const snapshot = await harness.repo.readSession(sessionId)
    const lifecycles = snapshot.entries.filter(entry => entry.type === 'invocation_lifecycle')
    const latest = lifecycles.at(-1)
    if (latest?.status === 'end') {
      return 'completed'
    }
    if (latest?.status === 'error' || latest?.status === 'aborted') {
      return 'error'
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('等待真实 compaction smoke 完成超时')
}

/** 限制 smoke 控制台输出，避免把完整注入 reference 打到终端。 */
function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}…` : value
}

await main()
