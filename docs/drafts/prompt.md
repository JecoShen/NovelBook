检查任务遗漏，审查，可以从各种链路走一遍看通不通顺

可以，深入调研分析，然后制定系统性的计划，不要留技术债，不要过度设计，不要脱离实际，不要 hack。如果有重要的地方可以遵循 [$decision-brief](C:\\Users\\notnotype\\.agents\\skills\\decision-brief\\SKILL.md) 询问或者和我讨论。做决定前，需要考虑权衡他的复杂度是否应该妥协？或者是问题是否太过过度设计、过度考虑了。

---

使用 shadcn，是不能能支持换一套不同 UI 风格的组件，页面能直接接着用？能支持组件级别的自定义（而不是 css 级别的）。
比如说现在用的这一套是 Material Design，能够很方便地改成 IOS design ？

---

好，这些提示词、文档还需要不断完善。目前你列出来的旅程都是根据代码得出来的。可能有的不重要的地方测的很细，那些关键的地方测的很粗。所以接下来你在我的指导下进行测试。测试的经验可以用于更新这个 eval 文档。


---
NeuroBook 人工审查报告

## 用户体验部分

1. app/components/novel-ide/agent/AgentWorkflowPendingPanel.vue:244:4 这个 “Workflow 待处理” 没有做好。没有 workflow 他也显示。而且这种展示方式也不好看
2. 左侧文件树点击文件后，中间的 studio 加载文件有延迟（1秒左右的延迟）（希望做到几乎瞬间就打开）。参考 codex://threads/019ff4b4-2310-7900-bddc-1a850b4f0213 的讨论，参考 code server 做法。优先级不高，后续单独开任务进行优化
3. app/components/common/SideDetailPanel.vue:88:8 点击目录或者文件后这个面板自动打开。影响体验。UX 需要优化
4. 目前由于做了桌面版 UI 适配。导致现在 web 端没有 Agent 侧边栏打开的入口了
5. World Engine 这个 Dialog 太小了。准备全部换成 Dialog Window（允许用户移动拖拽缩放）
6. 剧本工作台的入口目前没有。点击后网页报错：

```
[Vue warn]: Unhandled error during execution of setup function
  at <Anonymous key=0 plugins= (5) [ƒ, ƒ, ƒ, ƒ, ƒ] sensors= (2) [{…}, ƒ]  ... >
  at <NovelIdePlotThreadPanelPlotThreadScenePanel threads= [{…}] scenes= (4) [{…}, {…}, {…}, {…}] chapters= (2) [{…}, {…}]  ... >
  at <NovelIdePlotNovelPlotPanel key=2 onOpenWorldEngine=fn >
  at <NovelIdeToolPanel width=444.5713806152344 onUpdate:width=fn class="ide-panel h-full"  ... >
  at <Index onVnodeUnmounted=fn<onVnodeUnmounted> ref=Ref< Proxy(Object) {__v_skip: true} > >
  at <RouteProvider key="/" vnode= {__v_isVNode: true, __v_skip: true, type: {…}, props: {…}, key: null, …} route= {fullPath: '/?project=ming-ding-zhi-shi-2', hash: '', query: {…}, name: 'index', path: '/', …}  ... >
  at <RouterView name=undefined route=undefined >
  at <NuxtPage >
  at <App key=4 >
  at <NuxtRoot>
Uncaught (in promise) Error: AutoScroller plugin depends on Scroller plugin
    at new AutoScroller (AutoScroller.ts:22:13)
    at PluginRegistry.register (registry.ts:119:22)
    at set values (registry.ts:77:12)
    at set plugins (manager.ts:145:27)
    at new DragDropManager (manager.ts:101:10)
    at new DragDropManager2 (manager.ts:47:5)
    at setup (index.js:112:68
    at callWithErrorHandling (runtime-core.esm-bundler.js:199:19)
    at setupStatefulComponent (runtime-core.esm-bundler.js:8205:25)
    at setupComponent (runtime-core.esm-bundler.js:8167:36)
```

7. 设置界面切换 tab 的时候显示：“当前配置正在读取，请稍候。” 直接阻塞了用户的操作。影响体验

## 关于 AgentChatFlow 的 UI 部分

8. AgentChatFlow 部分。我在 AgentComposer 输入提示词，然后刷新页面。此时应该有提示词草稿恢复功能的。但是此时点击发送会导致提示词草稿没被清空
9. task 气泡展示需要优化。目前 task 变更是用 task 消息气泡展示的。建议换一种展示方式，AgentChatFlow 提供一个独立的展示入口
10. 优化点：希望能提提供像 codex 一样的 tool call 气泡折叠功能。两种折叠方式：
    - ReAct 折叠，界面展示为：用户消息，ReAct 折叠 + 最后一条 AI 消息，用户消息，ReAct 折叠 + 最后一条 AI 消息。
    - 连续 tool call 折叠。连续的工具调用可以折叠

    如果当前 ReAct 正在运行，则不需要 ReAct 折叠，一旦当前 ReAct 结束就把这些消息进行 ReAct 折叠。这个优化能减少 ChatFlow 的高度，让用户的注意力专注在和 AI 的对话中。而不是中途的工具调用和执行过程。
11. Approval 界面这个样式太丑了，还需要细调
12. Agent Profile 模型这个地方加载太慢了
13. 使用上下文压缩命令，AgentChatFlow 没有反馈
14. cancel 还是无法取消。Harness 这一块这里需要参考 omp 对 Harness 进行治理。包括压缩算法等


## 未分类

1. Profile home 治理
2. 世界引擎这个功能应该是可选的，允许用户不启用世界引擎
3. 文件数的隐藏目录可以展示一下

## 优化项

1. 目前 neuro-book 中的 agent 操作项目好像用的是一个叫做 `workspace` 的 cli。可以考虑改名成 `nb` `nbook` `neurobook`。（注意：好像 neurobook 这个 cli 已经存在了。看看能不能融合起来，搞成子命令）

## 需要解耦，重构，重新设计。单独治理的

1. Harness，可以考虑解耦，接入 neuro-agent-harness 这个库了
2. 文件协议：需要扩展。目前用的是 file-snapshot-cache，后续可以参考有一个相关任务，参考 vscode 的做法搞成 ws 协议。还有 nb-history 我记得应该是集成在 file-snapshot-cache 里的
3. ui 层重构（目前阻塞在 ui 风格确定）
4. agent home 协议
5. Markdown 渲染，TipTap 这里我觉得需要理清一下了。
