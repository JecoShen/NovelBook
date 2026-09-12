# 模块文档索引

本目录保存模块说明、需求整理和开发参考。稳定实现契约应放到 `packages/neuro-book/assets/reference/<module>/`。

## Agent

- [Agent 稳定参考入口](../../packages/neuro-book/assets/reference/agent/README.md)：Agent Harness 的 session、profile、ReAct loop、SSE 和消息持久化流程；Profile、上下文、Import、默认 Leader 协作协议和项目文件语义优先看这里。
- [leader-default.md](../../packages/neuro-book/assets/reference/agent/leader-default.md)：当前 `leader.default` 工具、任务、多 Agent、SQL、Plan Mode 和 Skills 操作协议。
- [skill-package.md](../../packages/neuro-book/assets/reference/agent/skill-package.md)：Skill package、版本、portable root、首次安装和依赖失效规范。
- [project-workspace-guide.md](../../packages/neuro-book/assets/reference/agent/project-workspace-guide.md)：Agent 处理 Project Workspace 路径、基础内容节点、常用目录和 workspace node CLI 的短指南。
- [workflow/](../../packages/neuro-book/assets/reference/agent/workflow/)：Agent Workflow 稳定参考；覆盖 catalog 目录、`run_workflow`、编写 API、确定性与 `wf.chart` 状态图。
- [../tasks/02-pi-agent-harness-migration/README.md](../../packages/neuro-book/.agents/tasks/02-pi-agent-harness-migration/README.md)：Pi-based Agent v3 后端 harness 迁移计划。
- [../tasks/04-tsx-profile-workbench/README.md](../../packages/neuro-book/.agents/tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前任务记录。
- [../tasks/05-leader-profile-v2-adaptation/README.md](../../packages/neuro-book/.agents/tasks/05-leader-profile-v2-adaptation/README.md)：leader.default v2 适配、ProfileTurnPlan 和 TSX DSL 调整记录。
- [../tasks/06-leader-default-prompt-parity/README.md](../../packages/neuro-book/.agents/tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt parity、task/plot/SQL 工具和 skill 迁移记录。

## Character

- [character/requirements.md](character/requirements.md)：Character 模块需求、界面字段和搜索设计。

## Editor

- [markdown-studio-notion-rich-text](../../.agents/tasks/archived/markdown-studio-notion-rich-text)：Markdown Studio 富文本与源码模式历史任务归档（稳定参考已随任务归档）。
- [../research/tiptap/00-overview.md](../research/tiptap/00-overview.md)：Tiptap 调研总览。

## Plot / Story

- [plot/functional-description.md](plot/functional-description.md)：Plot 系统完整功能说明。
- [plot/system.md](../../packages/neuro-book/assets/reference/plot/system.md)：剧情模块规范。
- [plot/frontend.md](../../packages/neuro-book/assets/reference/plot/frontend.md)：剧情模块前端规范。
- [../archived/drafts/plot-system.md](../archived/drafts/plot-system.md)：剧情系统早期草案归档。
