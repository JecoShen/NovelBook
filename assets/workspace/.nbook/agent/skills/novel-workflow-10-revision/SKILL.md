---
name: novel-workflow-10-revision
description: 用于修改已有章节或片段，处理文风、节奏、视角、信息边界、局部重写和一致性检查；不改变核心事件结果时通常不推进 World Engine。
when_to_use:
  - 用户要求润色、重写、压缩、扩写、调整节奏或修改已有章节
  - 用户要求检查视角、信息边界、角色表现或文风问题
  - 已有正文需要局部编辑，但不一定需要重新设计剧情
---

# novel-workflow-10-revision：润色修订

本 skill 处理已有正文修改。默认不改变核心剧情事实；如果修改会改变事件结果、物品状态、角色位置、伤势或信息披露，再转入 `novel-workflow-08-plot-planning` 确认剧情事实并回补 World Engine。

## 执行顺序

1. 确认目标文件和修改范围。
2. 读取目标正文、相关 World Engine 状态、已确认剧情事实和必要 lorebook。
3. 判断修改类型：
   - 文风/语句：直接 edit。
   - 节奏/结构：先给修改方案，再按用户确认执行。
   - 事件结果变化：先走 `novel-workflow-08-plot-planning`，确认事实后再补 World Engine。
4. 修改正文。
5. 复查视角边界、角色信息、World Engine 状态一致性和用户要求。
6. 如果产生新事实，记录后续 World Engine 回补事项；用户确认后再写入切面。

## 完成标准

- 只修改用户指定范围或明确相关段落。
- 不引入未确认的核心设定或剧情转向。
- 如改变世界状态，已说明并提交或挂起 World Engine 回补。
- 修复完成后可进入 `novel-workflow-11-analyze` 复检，确认问题已解决且无新问题引入。
