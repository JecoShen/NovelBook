import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'
import { z } from 'zod'

const labelDefinitionSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^[0-9A-F]{6}$/u),
  description: z.string().min(1),
})

const remoteLabelSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^[0-9A-Fa-f]{6}$/u),
  description: z.string().nullable().transform(description => description ?? ''),
})

const openIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  labels: z.array(z.object({ name: z.string().min(1) })),
})

/** 仓库标签清单中的单个标签合同。 */
export type LabelDefinition = z.infer<typeof labelDefinitionSchema>

/** GitHub 远端返回的标签元数据。 */
export type RemoteLabel = z.infer<typeof remoteLabelSchema>

/** 开放 Issue 的分流审计输入。 */
export interface OpenIssueSummary {
  number: number
  title: string
  labels: readonly string[]
}

/** 标签元数据不一致时的双端值。 */
export interface ChangedLabel {
  expected: LabelDefinition
  actual: RemoteLabel
}

/** 本地标签清单与 GitHub 远端之间的完整差异。 */
export interface LabelDrift {
  missing: readonly LabelDefinition[]
  changed: readonly ChangedLabel[]
  extra: readonly RemoteLabel[]
}

/** 开放 Issue 违反分流标签合同的说明。 */
export interface IssueLabelViolation {
  number: number
  title: string
  message: string
}

/** 读取并验证标签清单，拒绝重复名称或非双语描述。 */
export async function readLabelManifest(path: string): Promise<readonly LabelDefinition[]> {
  const result = z.array(labelDefinitionSchema).safeParse(parse(await readFile(path, 'utf8')))
  if (!result.success) {
    throw new Error(`标签清单格式错误：${z.prettifyError(result.error)}`)
  }
  if (result.data.length === 0) {
    throw new Error('标签清单不能为空')
  }

  const names = new Set<string>()
  for (const label of result.data) {
    if (names.has(label.name)) {
      throw new Error(`标签名称重复: ${label.name}`)
    }
    if (!label.description.includes(' / ')) {
      throw new Error(`标签描述必须中英双语: ${label.name}`)
    }
    names.add(label.name)
  }
  return result.data
}

/** 解析 `gh label list --json` 的外部输出。 */
export function parseRemoteLabels(text: string): readonly RemoteLabel[] {
  const result = z.array(remoteLabelSchema).safeParse(JSON.parse(text))
  if (!result.success) {
    throw new Error(`GitHub 标签响应格式错误：${z.prettifyError(result.error)}`)
  }
  return result.data
}

/** 解析 `gh issue list --json` 的外部输出并压平标签名称。 */
export function parseOpenIssues(text: string): readonly OpenIssueSummary[] {
  const result = z.array(openIssueSchema).safeParse(JSON.parse(text))
  if (!result.success) {
    throw new Error(`GitHub Issue 响应格式错误：${z.prettifyError(result.error)}`)
  }
  return result.data.map(issue => ({
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map(label => label.name),
  }))
}

/** 精确比较标签名称、颜色和描述。 */
export function compareLabels(
  expected: readonly LabelDefinition[],
  actual: readonly RemoteLabel[],
): LabelDrift {
  const expectedByName = new Map(expected.map(label => [label.name, label]))
  const actualByName = new Map(actual.map(label => [label.name, label]))
  const missing = expected.filter(label => !actualByName.has(label.name))
  const changed: ChangedLabel[] = []

  for (const label of expected) {
    const remote = actualByName.get(label.name)
    if (!remote) {
      continue
    }
    if (label.color !== remote.color.toUpperCase() || label.description !== remote.description) {
      changed.push({ expected: label, actual: remote })
    }
  }

  return {
    missing,
    changed,
    extra: actual.filter(label => !expectedByName.has(label.name)),
  }
}

/** 判断标签清单与远端是否完全一致。 */
export function hasLabelDrift(drift: LabelDrift): boolean {
  return drift.missing.length > 0 || drift.changed.length > 0 || drift.extra.length > 0
}

/** 审计开放 Issue 的 type/status 唯一性与社区发现标签前置条件。 */
export function auditOpenIssueLabels(issues: readonly OpenIssueSummary[]): readonly IssueLabelViolation[] {
  const violations: IssueLabelViolation[] = []
  for (const issue of issues) {
    const typeLabels = issue.labels.filter(label => label.startsWith('type: '))
    const statusLabels = issue.labels.filter(label => label.startsWith('status: '))
    if (typeLabels.length !== 1) {
      violations.push({
        number: issue.number,
        title: issue.title,
        message: `应恰有一个 type:*，实际 ${typeLabels.length} 个`,
      })
    }
    if (statusLabels.length !== 1) {
      violations.push({
        number: issue.number,
        title: issue.title,
        message: `应恰有一个 status:*，实际 ${statusLabels.length} 个`,
      })
    }

    const hasCommunityDiscovery = issue.labels.includes('help wanted')
      || issue.labels.includes('good first issue')
    if (hasCommunityDiscovery && !issue.labels.includes('status: ready')) {
      violations.push({
        number: issue.number,
        title: issue.title,
        message: 'help wanted/good first issue 只能与 status: ready 共存',
      })
    }
  }
  return violations
}
