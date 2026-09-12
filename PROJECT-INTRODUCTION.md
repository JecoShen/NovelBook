# neuro-book 产品介绍

neuro-book 是一款面向长篇小说创作的本地工作台。

它解决的不是“生成一段文字”这种短问题，而是长篇创作中的持续管理问题：设定会变、剧情会推进、角色会记住过去、章节会互相影响、草稿会分叉、写作任务会积压。neuro-book 把这些内容放进同一个可见、可编辑、可协作的工作区里，让作者能长期维护一部作品。

## 产品定位

neuro-book 更像一个给小说作者使用的本地 IDE。

它同时提供三层能力：

1. 内容管理：设定、正文、草稿、章节资料、引用和状态文件。
2. 剧情管理：长期剧情线、场景和情节点。
3. AI 协作：检索、写作、规划、审批和多 Agent 任务协作。

它的设计原则很明确：

- 小说资产以文件形式保存，作者能直接看到和迁移。
- Markdown 是正文和设定的长期真相。
- 剧情结构和正文内容分层管理。
- Agent 负责辅助，不替代作者。
- 重要执行过程必须可见。

## 适合谁使用

- 需要长期维护世界观、角色表和剧情线的小说作者。
- 需要把设定库、正文和任务记录统一管理的创作团队。
- 想把 AI 用在检索、规划、写作和整理，而不是只拿来聊天的使用者。
- 需要本地部署、可控数据路径和可导出 Markdown 工作流的用户。

## 核心功能

### 文件化小说工作区

每本小说都有独立 workspace。常见目录包括：

- `lorebook/`：角色、地点、物品、规则、笔记。
- `manuscript/`：卷、章、正文、草稿。
- `.agent/`：Agent 计划、工作记录和临时文件。

内容节点通常以目录 + `index.md` 表达，必要时再配 `state.md` 表示当前状态。这样可以把稳定设定和动态状态拆开，避免长篇写作里最容易混乱的信息黏在一起。

### Markdown Studio

neuro-book 的正文编辑器围绕 Markdown 设计，同时提供更接近写作软件的体验。

它支持：

- 富文本模式与源码模式切换
- 图片、表格、inline code、引用和评论
- Workspace reference
- 更适合长文写作的实时预览

最终目标是：编辑体验更好，但 Markdown 原文仍然是唯一真相。

### 内容节点与引用系统

项目把角色、地点、规则和正文资料都组织成内容节点。

系统区分几类引用语义：

- 普通链接：用于作者自然引用文件或节点。
- `refs`：用于表达稳定结构关系。
- `retrieval`：用于告诉 Agent 什么时候应该召回这个节点。
- `inject`：用于告诉 profile 什么时候应该直接注入上下文。

这让引用不只是“能点开”，而是可以真正服务于 AI 任务和长篇创作。

### Plot System

neuro-book 用 Thread、Scene、Plot 来表达剧情：

- Thread：长期剧情线。
- Scene：可写作的场景单元。
- Plot：场景内部的动作、冲突、揭示和结果。

它的作用是把“剧情结构”从“正文文本”里剥离出来，让大纲、正文和设定各司其职。

### 多 Agent 协作

项目的 AGENT 系统是核心能力之一。它不是单一聊天机器人，而是一套多角色协作机制：

- `leader thread`：用户主入口。
- `subagent thread`：独立专业线程。
- `skill`：可读取的工作流程或能力说明。
- `tool`：真正执行动作的接口。
- `walkthrough`：subagent 的执行总结。

leader 负责统筹，subagent 负责具体执行，前端负责把整个过程展示给用户。

## AGENT 的产品价值

这套设计的目标不是“让 AI 多说话”，而是让 AI 在长篇创作里真正可控。

例如：

- 检索 subagent 可以先找相关内容节点。
- writer subagent 可以根据剧情点和设定生成正文。
- leader 可以组织上下文、审批计划、调用工具并汇总结果。
- subagent 过程中可以向用户提问，等待明确答案再继续。

对于作者来说，这意味着你不是在和一个模糊助手聊天，而是在使用一套可以分工的创作系统。

## TSX Profile

neuro-book 的 Agent prompt 不是普通字符串，而是用 TSX 组件树表达上下文结构。

常见结构包括：

- `HistorySet`：长期稳定上下文。
- `DynamicSet`：本轮动态信息。
- `AppendingSet`：贴近当前输入的提醒和附加信息。

这套结构的意义在于让 prompt 语义可见、可测试、可维护。比如：

- `HistorySet` 适合放 profile 身份和长期规则。
- `DynamicSet` 适合放本轮临时状态。
- `AppendingSet` 适合放 workspace reminder、Plan Mode reminder、activated skills 和当前用户输入。

因此，TSX profile 不只是“换了一种写法”，而是把 prompt 变成了一个明确的运行时合同。

## Profile 的作用

每个 profile 都会声明：

- `key`
- `kind`
- `name`
- `inputSchema`
- `outputSchema`
- `allowedToolKeys`
- `buildPrompt(ctx)`

这让 profile 不只是提示词文件，而是一个可执行角色模板。

当前常见内置 profile 包括：

- `leader.default`
- `subagent.writer`
- `subagent.retrieval`

## Plan Mode

项目还提供线程级软 Plan Mode。

它适合在需求不清晰时先规划、先阅读、先整理，再进入执行阶段。Plan Mode 会鼓励 leader 把计划留在聊天中，并在必要时写入当前线程的工作文件，等用户确认后再执行。

## 技术栈与部署

项目使用 Nuxt 4、Vue、Pinia、Prisma、PostgreSQL、Vitest、TipTap 等常见技术栈，支持本地开发和 Docker Compose 单机部署。

部署特点：

- `.env.docker` 只放运行环境变量和数据库连接。
- `config.yaml` 作为 Provider 配置真值源。
- 可挂载 `workspace/` 保存小说资产。

## 文档体系

项目文档分为几类：

- `PROJECT-STATUS.md`：仓库级现状和风险。
- `spec/`：稳定规范。
- `.agents/tasks/` 与 `packages/neuro-book/.agents/tasks/`：任务 walkthrough 与历史 provenance。
- `docs/research/`：调研资料。
- `docs/drafts/`：草案。

这是一个很重要的产品约束：因为 neuro-book 既是写作工具，也是长期演进的 AI 工程项目，文档本身就是产品的一部分。

## 一句话总结

neuro-book 不是一个单纯的写作软件，也不是一个普通的 AI 聊天工具。

它是一个把小说文件、剧情结构、编辑体验和 Agent 协作放在同一工作台里的产品，目标是让长篇创作变得可持续、可管理、可协作。
