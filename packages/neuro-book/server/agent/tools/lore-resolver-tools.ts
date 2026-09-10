import { Type } from 'typebox'
import type { Static, TSchema } from 'typebox'
import { resolveForChapter } from 'nbook/server/agent/lore/lore-resolver'
import { renderInjectedMarkdown } from 'nbook/server/agent/lore/lore-context-injector'
import type { NeuroAgentTool, NeuroToolResult, ToolExecutionContext } from 'nbook/server/agent/tools/types'

/**
 * lore_resolver_query 工具参数。
 * extra_triggers：按额外实体名（trigger）追加检索 lore 卡片。
 */
const LoreResolverQuerySchema = Type.Object({
  extra_triggers: Type.Array(Type.String({ minLength: 2 }), {
    minItems: 1,
    maxItems: 10,
    description: '需要追加检索 lore 的额外实体名（trigger），每个至少 2 字符。',
  }),
})

/**
 * 创建 lore resolver 查询工具（Task 6，spec §2.5）。
 *
 * 与 get_chapter_writer_brief / get_story_scene_context 同构：writer profile 只声明
 * pluginTool("lore_resolver_query") 绑定，执行实现落在全局内置工具 registry。
 * 实现 = resolveForChapter（Task 2）+ renderInjectedMarkdown（Task 3），
 * Project 来自 ToolExecutionContext.currentProject；无已就绪 Project 时返回友好提示而非报错。
 */
export function createLoreResolverTools(): NeuroAgentTool[] {
  return [
    tool(
      'lore_resolver_query',
      '按额外实体名（trigger）追加检索 lore 卡片并渲染为 Markdown 片段，写场景中如需补充设定可调用；返回的 Markdown 可直接复制到当前 prompt 上下文。',
      LoreResolverQuerySchema,
      async (context, input) => {
        const project = context.currentProject
        if (!project) {
          return {
            content: [{
              type: 'text',
              text: '当前没有已就绪的 Project；lore_resolver_query 需要 Project Workspace 上下文才能检索 lore。',
            }],
          }
        }
        const chapterText = input.extra_triggers.join(' ')
        const resolved = await resolveForChapter({ project, chapterText, maxPaths: 4 })
        const injected = await renderInjectedMarkdown({ project, paths: resolved.paths, maxChars: 4000 })
        return {
          content: [{ type: 'text', text: injected.markdown }],
        }
      },
    ),
  ]
}

/**
 * lore 工具定义 helper，与 plot-tools 的 tool() 同构。
 * lore_resolver_query 是只读工具（mutatesWorkspace: false）。
 */
function tool<TSchemaValue extends TSchema>(
  key: string,
  description: string,
  parameters: TSchemaValue,
  execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<NeuroToolResult>,
): NeuroAgentTool {
  return {
    key,
    name: key,
    label: key,
    executionMode: 'sequential',
    description,
    parameters,
    mutatesWorkspace: false,
    async execute() {
      throw new Error(`${key} 需要 v3 session context。`)
    },
    async executeWithContext(context, _toolCallId, params: unknown) {
      return execute(context, params as Static<TSchemaValue>)
    },
  }
}
