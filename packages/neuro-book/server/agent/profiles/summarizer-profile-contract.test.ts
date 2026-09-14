import { describe, expect, it } from 'vitest'
import profile from 'nbook/assets/workspace/.nbook/agent/profiles/builtin/summarizer.profile'

type WritePlan = {
  cause: string
  ops: Array<{ entry: { type: string, updates?: unknown, value?: unknown } }>
}

type WriteSourceSummaryHook = {
  name: string
  stage: string
  run: (ctx: unknown) => Promise<{ writePlans: WritePlan[] }>
}

function findHook(): WriteSourceSummaryHook {
  const runtime = (profile as { runtime?: { hooks?: Array<{ name: string }> } }).runtime
  const hook = runtime?.hooks?.find(item => item.name === 'write-source-summary')
  if (!hook) {
    throw new Error('canonical summarizer 缺少 write-source-summary hook（与生产 overlay 漂移）')
  }
  return hook as unknown as WriteSourceSummaryHook
}

function makeCtx(input: { data?: unknown, titleOwner?: 'user' | 'auto', leafId?: string | null }) {
  const leafId = input.leafId ?? 'leaf-1'
  return {
    initial: { sourceSessionId: 42 },
    runResult: { reportResult: { data: input.data } },
    session: {
      read: async () => ({
        context: {
          customState: {
            'summarizer.state': { running: true, sourceLeafId: leafId },
            ...(input.titleOwner ? { 'session.titleOwner': { owner: input.titleOwner } } : {}),
          },
        },
        snapshot: { leafId },
      }),
    },
  }
}

describe('summarizer profile (canonical) — write-source-summary hook', () => {
  it('registers the settleRun write-source-summary hook', () => {
    expect(findHook().stage).toBe('settleRun')
  })

  it('writes back title and summary when title owner is auto', async () => {
    const result = await findHook().run(makeCtx({
      data: { title: '第47章 双面', summary: '写完了双面。' },
      titleOwner: 'auto',
    }))
    const plan = result.writePlans[0]!
    expect(plan.cause).toBe('summarizer.writeback')
    expect(plan.ops[0]!.entry.type).toBe('session_update')
    expect(plan.ops[0]!.entry.updates).toEqual({ title: '第47章 双面', summary: '写完了双面。' })
  })

  it('keeps user-owned title and only updates summary', async () => {
    const result = await findHook().run(makeCtx({
      data: { title: '自动标题', summary: '新摘要。' },
      titleOwner: 'user',
    }))
    expect(result.writePlans[0]!.ops[0]!.entry.updates).toEqual({ summary: '新摘要。' })
  })

  it('marks stale state when report_result.data is missing', async () => {
    const result = await findHook().run(makeCtx({ data: undefined }))
    expect(result.writePlans[0]!.cause).toBe('summarizer.stale')
  })
})
