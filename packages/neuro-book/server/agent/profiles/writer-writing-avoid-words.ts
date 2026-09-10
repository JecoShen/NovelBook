import type { ProfileHomeFacade } from 'nbook/server/agent/profiles/profile-home'

export const DEFAULT_AVOID_WORDS_PRESET = 'avoid-words/default.md'

/**
 * 构造 writer 避讳词提示词。
 * 从 profile home 读取用户自定义的避讳词，不存在时回退到内置默认。
 */
export async function buildAvoidWords(input: { preset?: string, home?: ProfileHomeFacade } = {}): Promise<string> {
  const preset = input.preset || DEFAULT_AVOID_WORDS_PRESET
  if (input.home) {
    try {
      const content = await input.home.readText(preset)
      const trimmed = content.trim()
      if (trimmed) {
        return trimmed
      }
    }
    catch {
      // home 中不存在该预设时回退到内置默认
    }
  }
  return DEFAULT_AVOID_WORDS_CONTENT
}

const DEFAULT_AVOID_WORDS_CONTENT = [
  '禁止使用以下词汇：一丝、不容置疑、不易察觉、几不可察。',
  '禁止使用以下句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。',
  '如果想表达转折、对比或修正，直接写实际发生的动作、事实或判断，请换一种表述方式。',
].join('\n')
