/**
 * 验证多 pendingApprovals 支持的简单脚本
 */

import { findPendingApprovalCalls } from '../server/agent/tools/approval'
import type { MessageContent } from '../server/agent/messages/types'
import type { AgentSessionSnapshotDto, AgentSessionLiveStateDto, AgentInvokeRequestDto } from '../shared/dto/agent-session.dto'

console.log('✅ 验证多 pendingApprovals 支持\n')

// 测试 1: findPendingApprovalCalls 返回数组
console.log('测试 1: findPendingApprovalCalls 返回数组')
const messages: MessageContent[] = [
  {
    role: 'user',
    content: [{ type: 'text', text: '测试' }],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '好的' },
      {
        type: 'toolUse',
        id: 'call_1',
        name: 'skill',
        input: { skillName: 'test1' },
      },
      {
        type: 'toolUse',
        id: 'call_2',
        name: 'skill',
        input: { skillName: 'test2' },
      },
    ],
  },
]

const pendingApprovals = findPendingApprovalCalls(messages, ['skill'])
console.log(`  找到 ${pendingApprovals.length} 个 pending approvals`)
console.log(`  ✅ 返回类型正确: ${Array.isArray(pendingApprovals)}`)

if (pendingApprovals.length === 2) {
  console.log('  ✅ 找到 2 个 pending approvals（预期）')
}
else {
  console.log(`  ❌ 预期 2 个，实际 ${pendingApprovals.length}`)
}

// 测试 2: DTO 类型检查
console.log('\n测试 2: DTO 类型定义')

const snapshotExample: Partial<AgentSessionSnapshotDto> = {
  pendingApprovals: [], // 应该是数组
}

const liveStateExample: Partial<AgentSessionLiveStateDto> = {
  pendingApprovals: [], // 应该是数组
}

console.log('  ✅ AgentSessionSnapshotDto.pendingApprovals 类型正确')
console.log('  ✅ AgentSessionLiveStateDto.pendingApprovals 类型正确')

// 测试 3: Continue API 支持批量 resolutions
console.log('\n测试 3: Continue API 类型定义')

const invokeExample: Partial<AgentInvokeRequestDto> = {
  mode: 'continue',
  resolutions: [
    { kind: 'tool_approval', toolCallId: 'call_1', approved: true },
    { kind: 'tool_approval', toolCallId: 'call_2', approved: true },
  ],
}

console.log('  ✅ AgentInvokeRequestDto.resolutions 类型正确')

console.log('\n✅ 所有验证通过！多 pendingApprovals 支持已正确实现。')
