# nb-history v0.2 迁移指南（neuro-book 调用侧）

> 背景：nb-history 在 DSH 接入驱动下做了通用化改造（v0.2，详见源仓 NOTES.md #17）：
> 1. **移除 `workspaceRoot`**——新增 `resolvePath` port（缺省原样返回，path 即磁盘路径）；
> 2. **路径校验放宽**——`validateRelativePath` → `validatePath`，只拒绝空 / NUL；
> 3. **新增 `registerObservedWrite`**（观察型记账，本次 DSH 接入用，neuro-book 不需要）。
>
> neuro-book 通过 `server/vendor/nb-history/` 同步源码（`bun run sync:nb-history`）。
> **执行同步后**，本文件列出的调用侧必须同步修改，否则编译失败。
> 本清单基于 vendored 快照 commit `68c54ca`（8/2）逐文件核对。

## 影响总览

| 文件 | 是否受影响 | 改动 |
|---|---|---|
| `server/workspace-history/project-history.ts` | **是** | `openHistoryInstance` 的 `workspaceRoot` → `resolvePath`（唯一生产代码改动点） |
| `server/workspace-history/vendor-smoke.test.ts` | 是 | `open({workspaceRoot})` → `open({resolvePath})` |
| `server/workspace-history/project-history-module.test.ts` | 是 | 测试种子 `open({workspaceRoot})` → `open({resolvePath})` |
| `server/workspace-files/workspace-archive.test.ts` | 是 | 测试 `open({workspaceRoot})` → `open({resolvePath})` |
| 其余 12 个文件 | **否** | 只 import **type**（`InboxGroup` / `UnseenGroup` / `OperationActor` / `TextDiffResult` / `OperationLogEntry`）或 `HistoryInboxMutationError`——类型与错误类均未变 |

## 改动详情

### 1. `project-history.ts`（生产代码，必须改）

**位置**：`openHistoryInstance()`（约 358 行）

```ts
// 改前
const history = await WorkspaceHistory.open({
    databasePath,
    workspaceRoot: projectWorkspaceRoot,
    config: {...},
});

// 改后
const history = await WorkspaceHistory.open({
    databasePath,
    resolvePath: (relativePath) => path.join(projectWorkspaceRoot, ...relativePath.split("/")),
    config: {...},
});
```

**要点**：
- neuro-book 全部 path 语义是「相对 projectRoot、正斜杠」——`resolvePath` 把它映射回磁盘绝对路径，日志里记录的仍是相对路径（与现状一致）；
- `projectWorkspaceRoot` 是 `AbsoluteFsPath`（已是绝对路径），`path.join` 直接可用；
- 写路径（`registerWrite` / `registerDelete` / `registerRename`）和 `reconcile` **不落盘**，只记账——resolvePath 在它们上不会被调用；但 `revertAtRevision`（`server/api/workspace-history/revert.post.ts`）**会落盘**，依赖 resolvePath 正确——这也是本次改动最重要的正确性理由；
- `recordProjectWrite` 的 `before` 参数语义不变（`registerWrite` 签名未动）。

### 2. `vendor-smoke.test.ts`（测试，改）

```ts
// 改前
const history = await WorkspaceHistory.open({workspaceRoot, databasePath});
// 改后
const history = await WorkspaceHistory.open({
    databasePath,
    resolvePath: (relativePath) => path.join(workspaceRoot, ...relativePath.split("/")),
});
```

该测试还调 `performWrite`（模块落盘）——resolvePath 正确才能写到临时目录。

### 3. `project-history-module.test.ts`（测试种子，改）

`seeded = await WorkspaceHistory.open({databasePath, workspaceRoot: prepared.workspace.root, config})`（约 56 行）：

```ts
// 改后
const seeded = await WorkspaceHistory.open({
    databasePath,
    resolvePath: (relativePath) => path.join(prepared.workspace.root, ...relativePath.split("/")),
    config: {retentionFullDays: 30, keepDailyLastAfterWindow: true},
});
```

种子 `performWrite` 会落盘，resolvePath 必须正确。

### 4. `workspace-archive.test.ts`（测试，改）

`history = await WorkspaceHistory.open({databasePath: historyDatabasePath, workspaceRoot: root})`（约 94 行）：

```ts
// 改后
const history = await WorkspaceHistory.open({
    databasePath: historyDatabasePath,
    resolvePath: (relativePath) => path.join(root, ...relativePath.split("/")),
});
```

## 不需要动的文件（12 个）

`revision-routes.test.ts`、`revert.post.ts`、`accept.post.ts`、`accept-all.post.ts`、
`tracked-workspace-files.ts`、`history-inbox.ts`、`history-inbox.test.ts`、
`history-dto.ts`、`history-diff.ts`、`agent-change-diff.ts`、
`agent-change-diff-budget.test.ts`、`profile-turn-context.ts`、`file-change-reminder.test.ts`

——它们只 import 类型（`InboxGroup` / `UnseenGroup` / `OperationActor` / `TextDiffResult` /
`OperationLogEntry` / `WorkspaceHistory`（type-only））或 `HistoryInboxMutationError`，
这些在 v0.2 中均未变。

## 同步后验证

```bash
cd neuro-book
bun run sync:nb-history     # 重镜像 vendor 快照（先确认源仓 v0.2 改动已提交）
bun test server/workspace-history/vendor-smoke.test.ts   # 冒烟：open/写/时间线/diff/close
bun test server/workspace-history/project-history.test.ts
bun test server/workspace-history/project-history-module.test.ts
bun test server/workspace-files/workspace-archive.test.ts
bun test server/api/workspace-history/revision-routes.test.ts
```

## 可选优化（非必须，未来再做）

- `recordProjectWrite` 的调用侧已自带 `before`（写入收口层有写前内容），保留 `registerWrite` 精确记账即可，**不需要**换 `registerObservedWrite`——后者是给"拿不到 before"的观察型宿主（DSH）用的；
- 若将来想收紧，`validatePath` 的放宽不影响 neuro-book：其调用侧已有 `isHistoryTrackedRelativePath` + `projectWorkspacePathPolicy` 双重路径过滤（`project-history.ts:141-148`）。
