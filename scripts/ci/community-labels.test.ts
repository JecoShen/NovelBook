import { describe, expect, it } from 'vitest'

import {
  auditOpenIssueLabels,
  compareLabels,
  hasLabelDrift,
  parseRemoteLabels,
  type LabelDefinition,
  type RemoteLabel,
} from 'nbook/scripts/ci/community-labels'

const expected: readonly LabelDefinition[] = [
  { name: 'type: bug', color: 'D73A4A', description: '缺陷 / Bug' },
  { name: 'status: ready', color: '0E8A16', description: '可实现 / Ready' },
]

describe('community labels', () => {
  it('将 GitHub 的空标签描述归一为空字符串', () => {
    const remote = parseRemoteLabels(JSON.stringify([{
      name: 'type: bug',
      color: 'D73A4A',
      description: null,
    }]))

    expect(remote).toEqual([{
      name: 'type: bug',
      color: 'D73A4A',
      description: '',
    }])
    expect(compareLabels(expected, remote).changed.map(label => label.expected.name))
      .toEqual(['type: bug'])
  })

  it('接受完全一致的远端标签', () => {
    const remote: readonly RemoteLabel[] = expected
    const drift = compareLabels(expected, remote)

    expect(hasLabelDrift(drift)).toBe(false)
    expect(drift).toEqual({ missing: [], changed: [], extra: [] })
  })

  it('区分缺失、元数据漂移和额外标签', () => {
    const remote: readonly RemoteLabel[] = [
      { name: 'type: bug', color: 'ffffff', description: '旧描述 / Old' },
      { name: 'duplicate', color: 'CFD3D7', description: '重复 / Duplicate' },
    ]
    const drift = compareLabels(expected, remote)

    expect(drift.missing.map(label => label.name)).toEqual(['status: ready'])
    expect(drift.changed.map(label => label.expected.name)).toEqual(['type: bug'])
    expect(drift.extra.map(label => label.name)).toEqual(['duplicate'])
    expect(hasLabelDrift(drift)).toBe(true)
  })

  it('拒绝缺失或重复 type/status 的开放 Issue', () => {
    const violations = auditOpenIssueLabels([
      { number: 1, title: 'missing', labels: ['type: bug'] },
      {
        number: 2,
        title: 'duplicate',
        labels: ['type: bug', 'type: docs', 'status: ready', 'status: blocked'],
      },
    ])

    expect(violations).toHaveLength(3)
    expect(violations.map(violation => violation.message)).toEqual([
      '应恰有一个 status:*，实际 0 个',
      '应恰有一个 type:*，实际 2 个',
      '应恰有一个 status:*，实际 2 个',
    ])
  })

  it('只允许 ready Issue 使用社区发现标签', () => {
    const violations = auditOpenIssueLabels([
      {
        number: 12,
        title: 'design',
        labels: ['type: feature', 'status: needs-design', 'help wanted'],
      },
      {
        number: 16,
        title: 'ready',
        labels: ['type: docs', 'status: ready', 'good first issue'],
      },
    ])

    expect(violations).toEqual([{
      number: 12,
      title: 'design',
      message: 'help wanted/good first issue 只能与 status: ready 共存',
    }])
  })
})
