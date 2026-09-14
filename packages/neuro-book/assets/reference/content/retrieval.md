# Content Node Retrieval

内容节点进入 Agent 上下文不再使用内容节点级 `inject`。当前模型分成两层：

- `retrieval`：内容节点声明自己是否可以进入任务相关召回候选。
- [../agent/profile-context-memory.md](../agent/profile-context-memory.md)：profile 自己维护哪些 Project 上下文需要优先读取、可能读取或避免读取。

## Frontmatter

标准内容节点 `index.md` frontmatter 包含：

```yaml
retrieval:
  enabled: true
  trigger: ["陆深", "lu-shen", "量化交易员"]
```

字段语义：

- `retrieval.enabled`：是否允许该节点进入 AI 自动检索与注入候选。`false` 时 trigger 与 title 都不生效。
- `retrieval.trigger`：字符串列表。writer 写章节时按「brief + 已有正文」做子串匹配（lore-resolver），命中才把该卡注入写作上下文（每章最多 8 张，按命中 trigger 数排序）；`lore_resolver_query` 工具共用同一索引。为空列表或 `null` 时，该条目只靠 title 命中。
- title 是隐式 trigger：条目标题自动参与匹配，不要把 title 重复写进列表。title 带括号修饰时（如「站长（老赵）」），全串不会命中正文里的常用称呼，括号外的称呼（站长、老赵）仍要写进 trigger。
- 只有 `character` / `location` / `faction` / `event` / `item` / `world` / `system` / `spec` 类别的条目会被索引；`instruction`、`note` 等类别的 `trigger` 不生效，留空即可。

trigger 编写规范（写错比不写更糟：通用词误命中会挤占每章 8 个注入槽位、稀释注意力）：

- **写专名**：角色名、别名、绰号、英文名；地名及别名；组织名及简称；关键道具、作品特定术语。
- **不写通用词**：天气（台风）、情绪（暧昧）、动作（直播）、题材高频词（骑手/骗局）、元词（剧情/叙事/文风/爽点）。自问：这个词在别的人物、别的场景出现时，这张卡还该被注入吗？不该就不写。
- **2 字词先过专名检验**：机制下限 2 字，但 2 字通用词是误命中重灾区。
- **每条 3-6 个为宜**：覆盖常用称呼即可，不堆同义词。

长期稳定的 profile-scoped 上下文选择不写在内容节点 frontmatter 中。它由 `agents/{profile}/context.md` 和 `agents/{profile}/generated.md` 管理。

## Retrieval Profile

`retrieval` 是专门的内容节点召回 profile。它允许使用 shell 搜索能力，例如 `rg`，也可以读取候选文件，但不编辑文件。它的输出面向 Leader，用于判断哪些内容节点值得传给 `writer`。

输入结构：

```ts
{
    prompt: string;
}
```

`prompt` 承载完整检索请求：任务目标、要找什么、给谁用、章节/正文上下文、排除项和数量偏好。

输出必须通过 `report_result` 工具提交完成结果。`report_result.data` 是给 Leader 使用的候选判断对象：

```ts
{
    entries: Array<{
        path: string;
        reason: string;
        use?: string;
        risk?: string;
    }>;
    note?: string;
}
```

其中 `path` 是唯一会传给 writer payload `context.lorebookEntries` 的字段；`reason` / `use` / `risk` / `note` 只给 Leader 判断，不直接传给 writer。

## Writer Flow

推荐流程：

1. Leader 或系统入口先创建并调用 `retrieval`。
2. Retrieval profile 根据自然语言 prompt 召回内容节点，调用 `report_result` 返回 `data: { entries, note? }`。
3. Leader 或系统入口阅读 `reason` / `use` / `risk` 后，把选中的 `entries[].path` 映射为 `invoke_agent.input.context.lorebookEntries`。
4. Writer 根据本轮 `message` 判断是否用 `read` 主动读取内容节点的 `index.md` 与同级可选 `state.md`。

这种设计让 retriever 专注路径选择，让 writer 获得明确建议上下文，同时避免在 prepare 阶段无差别注入大量文件正文。
