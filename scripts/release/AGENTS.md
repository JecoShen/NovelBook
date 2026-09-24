# scripts/release 目录规则

- 保持 Source、Product、Manager、Desktop 的现有发布入口和外部命令参数。
- 中间 staging、browser smoke、pack 与验证日志按 [`../../docs/testing/README.md`](../../docs/testing/README.md) 使用系统临时根；最终发布资产遵循既有 release output 合同。
- 修改发布复制闭包、安装器路径、workflow 命令或版本身份时，同步对应 contract test 和工作流断言。
- 未经 H3 批准，不运行发布、不推送资产、不创建 Release、不删除历史发布数据。

## 发布流程

- 发布、推送资产、创建 Release 或删除历史发布数据需要 H3 批准；本文件只定义门禁，不代表已获批准。
- 发布前读取 `PROJECT-STATUS.md` 和相关 Task walkthrough；用 `git log <上一个应用发布 tag>..origin/master --oneline` 核对合并范围，并把用户可见变化写入当前 `RELEASE.md`。正文与上一版本相同即视为未更新，不得发布；基线 tag 使用 `v*` 应用 tag，不混用 `manager-v*` 等其它 tag 线。历史版本放在 `vitepress/locales/{zh-Hans,en-US}/changelog/`。
- Canary 命令只能在 H3 批准后执行：`bun run release -- canary --next patch --push --yes --no-watch` 或对应 minor 命令。命令会更新版本、提交、push 并创建 GitHub prerelease，不得把未获批准的命令写成已运行。
- 命令中断后先检查工作区、最近提交和 `package.json` 版本，再用 `gh release view <tag> --repo notnotype/neuro-book` 判断是否已经完成，避免重复发布。

## fork 发布门禁

- `manager:verify-public` 的入口是 dispatcher（`scripts/release/public-manager-gate.ts`）：`FORK_PUBLIC_MANAGER_GATE_MODE` 常量决定默认模式，`NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream|fork` 可覆盖（p-011 / w00019）。
- upstream 模式原样执行 `verify-public-manager.ts` 的 npm provenance 校验；fork 模式以本地一致性校验替代（完整 `manager:pack` + 本机 `dist/neuro-book.mjs --version` 与 Manager package 版本断言），仍 fail-closed，并 best-effort 输出 npm 漂移情报（离线不阻断）。fork 不发布 npm（Trusted Publishing 绑定上游仓库与其 environment），npm provenance 语义在 fork 冻结而非失效；fork 重新对齐上游 npm 发布后把常量翻回 `upstream` 即恢复原门禁。
- fork 切版命令必须显式 `--repo` 指向 fork 远端（或设 `GITHUB_REPOSITORY`）；`release.ts` 的默认 `notnotype/neuro-book` 指向上游。
- `manager:release`（Manager 独立 npm 发布链）在 fork 不可用：Trusted Publishing 绑定上游，tag 推送后 publish 步骤会失败。
- **Manager 版本冻结**：fork 不得提升 `packages/neuro-book-manager` 版本号——fork 发布的 Windows Portable 与 GHCR 验收继续消费上游 npm Manager，npm 上不存在新版本会导致物化失败；解除约束需「Portable/GHCR 改嵌 fork 本机构建 Manager」另行立项。

## RELEASE.md 内容

- `RELEASE.md` 只保留当前版本；历史版本进入 `vitepress/locales/{zh-Hans,en-US}/changelog/`。版本段落必须覆盖自上一次发布以来合并的全部 PR；面向用户的变更各写一条并在末尾标注 PR 号（如 `(#63)`），纯内部改动可合并为一条“内部维护”并列出 PR 号；Task 不进入正文，通过 PR 描述追溯。
- 版本段落按需包含以下小节，不保留空标题：

```markdown
## <版本> - <日期>

一段话说明本版本解决的问题。

### 新功能
### 改进
### 修复
### 升级须知
```
