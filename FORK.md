# NovelBook — NeuroBook 二开派生版本

NovelBook 是 [NeuroBook](https://github.com/notnotype/neuro-book) 的 AGPL-3.0 派生版本，
由 JecoShen 在 worktree `feat/bridge-cli-http` 基础上进行二次开发。

## 派生关系

- **上游**: <https://github.com/notnotype/neuro-book>（AGPL-3.0-only）
- **派生**: <https://github.com/JecoShen/NovelBook>（本仓库）
- **作者**: JecoShen
- **派生基准 commit**: `88006177 feat(bridge): expose in-process agent harness to external CLI`
- **协议**: 与上游一致，**AGPL-3.0-only**

## 二开范围（截至 2026-08-12）

- **Bridge CLI HTTP 暴露**: `server/agent/bridge/*` 完整实现，把 NeuroBook 内置 agent 通过
  HTTP/loopback + token 暴露给外部 CLI（`scripts/cli/bridge/index.ts`）
- **Writer SDK 迁移**: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  从 server 深层路径迁移到 Profile SDK 公开面
- **Profile SDK 公开面扩展**: 新增 `profile-sdk/workspace.ts` 和 `profile-sdk/runtime-paths.ts`，
  `profile-sdk/writing.ts` 增加 `DEFAULT_AVOID_WORDS_PRESET` / `buildAvoidWords` 包装
- **沙箱白名单**: `server/agent/profiles/profile-artifact-compiler.ts` 和 `profile-command.ts`
  的 `allowedSdkSpecifiers` 包含 `nbook/profile-sdk/workspace` 和 `nbook/profile-sdk/runtime-paths`
- **Typecheck 修复**: `nuxt.config.ts` session password fallback、tsconfig 兼容 shim 等

## 协议合规

NovelBook 是 NeuroBook 的派生作品，依据 AGPL-3.0 协议 Section 5：

> "A compilation of a covered work with other separate and independent works, which are not
> by their nature extensions of the covered work, and which are not combined with it such as
> to form a larger program, in or on a volume of a storage or distribution medium, is called
> an 'aggregate' if the compilation and its resulting copyright are not used to limit the
> access or legal rights of the compilation's users beyond what the individual works permit.
> Inclusion of a covered work in an aggregate does not cause this License to apply to the
> other parts of the aggregate."

本仓库：

- ✅ 保留上游 LICENSE（AGPL-3.0）
- ✅ 保留上游 copyright 头
- ✅ 源码公开（GitHub public）
- ✅ 在显著位置声明派生关系（本文件）

## 上游归功

所有原始代码、设计、协议和商标归 NeuroBook 上游贡献者所有。
本仓库的修改记录在 git commit history 中，可通过 `git log upstream/master..HEAD` 查阅。
