# NeuroBook Reference Bookshelf

`reference/` 是 NeuroBook 的稳定参考书架，给 Agent 和人类共同阅读。这里放当前实现契约、目录协议、Agent profile 共享说明和内容系统规则；任务过程、调研、草案和历史记录继续放在 `docs/`。

不要把仓库根 `reference/` 和 Project Workspace 里的 `{project}/reference/` 混淆：

- 仓库根 `reference/`：系统参考书，可被 profile `<Import />` 加载。
- Project Workspace `{project}/reference/`：外部素材、导入归档、低置信迁移材料。

## Modules

- [agent/](agent/)：Agent runtime、profile、TSX DSL、Import、Run Kernel、Workflow、后台 Job、SSE 和默认协作协议。
- [agent/workflow/](agent/workflow/)：Agent Workflow 的选用、目录覆盖、编写 API、确定性与 `wf.chart` 状态图规范。
- [agent/skill-package.md](agent/skill-package.md)：Agent Skill package、版本、可移植路径、安装和依赖同步合同。
- [content/](content/)：Project Workspace 内容目录、lorebook、simulation、Subject RAG memory、information control、Markdown 方言、retrieval 和内容节点状态。
- [agent/profile-context-memory.md](agent/profile-context-memory.md)：profile context memory、generated recommendations 和 `.nbook/context-access` 边界。
- [plot/](plot/)：Project SQLite 剧情系统、Story / Phase / Thread / Scene 合同和 Agent 消费方式。Scene 是最小剧情单位，通过 World Anchor 连接 World Engine。
- [world-engine/](world-engine/)：World Engine 世界引擎——写作模式动态世界状态 + 时间线真相源。slice / subject / instant / reduce 模型、schema、记录原则、Calendar 和 leader/writer 协作。
- [workspace/TERMS.md](workspace/TERMS.md)：Workspace Root、Project Workspace、user-assets 和 Bundled Workspace Template 标准术语。
- [editor/](editor/)：Markdown Studio 富文本 / 源码模式稳定规则。
- [theme/](theme/)：主题系统规则。
- [harness/invoke-http.md](harness/invoke-http.md)：Agent Bridge HTTP 合同——外部 CLI 调 leader 的端点、鉴权、caller kind、并发限流、CLI sidecar。
- [media/image-variants.md](media/image-variants.md)：图片原图所有权、授权 Adapter、变体参数、有界缓存和 Project 封面合同。

## Reading Order

- 修改 Agent profile 或 prompt：先读 [agent/README.md](agent/README.md)。
- 创建或更新 runnable Skill、版本和依赖同步：读 [agent/skill-package.md](agent/skill-package.md)。
- 编写或运行 Agent Workflow：先读 [agent/workflow/README.md](agent/workflow/README.md)，再按需读 [authoring](agent/workflow/authoring.md) 与 [`wf.chart` 规范](agent/workflow/chart.md)。
- 处理 Project Workspace 文件、lorebook、simulation 或导入素材：先读 [agent/project-workspace-guide.md](agent/project-workspace-guide.md) 和 [content/README.md](content/README.md)。
- 处理 subject 长期记忆、`events.jsonl` / `memory.jsonl` 或 `subject_rag_search`：读 [content/subject-rag-memory.md](content/subject-rag-memory.md)。
- 处理小说写作标准流程、World Engine 剧情推进、writer handoff 或写作 skill 三层体系（novel-guide / novel-setup / novel-writing）：读 [agent/novel-writing-workflow.md](agent/novel-writing-workflow.md)。只有处理 legacy RP / simulation 时才继续看 emulation tick 资料（skill 本体已归档到 `docs/archived/skills/`）。
- 处理 RP Tick 交互协议、LOD 世界模拟、actor-facing packet 格式或 Writer Brief 格式：读 [agent/rp-tick/README.md](agent/rp-tick/README.md)。
- 处理旧 Plot 系统、历史剧情结构或 Plot 工具维护：先读 [plot/system.md](plot/system.md)。Plot System 负责剧情结构（Story / Thread / Scene / Chapter Plot）；动态世界状态走 World Engine。
- 处理写作模式世界状态、时间线、subject、切面、reduce 或 leader/writer 协作：先读 [world-engine/README.md](world-engine/README.md)。
- 处理 workspace / project / user-assets 术语：先读 [workspace/TERMS.md](workspace/TERMS.md)。
- 处理图片缩略图、原图预览、Project 封面或 `sharp` Product 合同时：读 [media/image-variants.md](media/image-variants.md)。
- 写外部 CLI / 监督者脚本调内置 agent、扩展或排障 bridge：读 [harness/invoke-http.md](harness/invoke-http.md)。
