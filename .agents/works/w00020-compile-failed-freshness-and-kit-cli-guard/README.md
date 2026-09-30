---
schema: nbook.work/v1
workId: w00020-compile-failed-freshness-and-kit-cli-guard
issueId: null
---

# compile_failed 源码新鲜度与 kit CLI 输出根守卫

两个独立确认的缺陷修复（2026-09-29 代码实证，开发者路由立项）：

1. **compile_failed 陈旧重放**：`catalog.ts:746` 对 `compile_failed` 的 manifest entry 不做任何源码指纹比较直接重放（新鲜度校验 `:752` 只对 loaded entry 执行），失败记录里的 sourceSha256 恒有记录却从未被消费。读路径从不自愈；project 级 child catalog 无 bootSweep（唯一生产调用点 `neuro-agent-harness.ts:682` 只扫 install 级），停机编辑后旧失败可被永久重放——2f68dbf0 修复的 writer 编译门禁违规正是被这层缓存掩盖。对照组：loaded entry 每次 resolve 都过完整 sourceSha 失效链（`profile-artifact-compiler.ts:1132`）。
2. **kit CLI 输出根无守卫**（9/28 生产覆盖事故根源）：`product-authoring-kit.ts:479` 与 `product-command-bundle.ts:263` 零参数解析、位置参数静默忽略、输出根 `?? ".output"` 兜底、构建第一步 `rm -rf` 目标子树；裸跑即命中生产 `.output`（529 文件被覆盖事故的机理）。

## 范围

- t01：kit 构建 CLI 输出根守卫——`parseArgs({allowPositionals:false, strict:true})` 拒位置参数（scripts/build 四兄弟 CLI 同模式）+ `NEURO_BOOK_OUTPUT_DIR` 缺失即抛（`product-runtime-bundle.ts:417` 同款）；不移植 `assertOutputRoot` 的 basename 规则（Builder 候选根叶名是 operationId，照搬会打断正式构建，`product-runtime-image-builder.ts:380`）。
- t02：compile_failed 源码新鲜度——`ProfileFreshnessChecker` 增源码指纹比较（`hashFile` 已导出，`profile-artifact-compiler.ts:1224`）；指纹失配时按 `not_compiled` 收口并 fire-and-forget `enqueueBuild` 自愈（自限：重编成功转 loaded，再失败记录新指纹恢复重放）。
- 后续：install.sh/windows-bun-stage0.ps1 用户侧 bun pin 升级已落地（f7be4785，1.3.14→1.4.2 全平台哈希表）。project 级 child coordinator bootSweep 对账评估已收口（2026-09-30，结论如下），实施已落地（`AgentProfileBuildCoordinatorPort` 增可选 `bootSweep()`，`forProjectWorkspace` attach 后 fire-and-forget 触发 + catalog.test.ts 回归用例）。

## bootSweep 对账评估结论（2026-09-30）

**无完整性缺口，有自愈缺口（仅 project 级）。** 读路径对三类 manifest 状态全部过源码指纹：compiled 走 `validateProfileArtifact:1132`（失配→compile_stale 卸载）、compile_failed 走 t02 sourceMatches、无 entry→not_compiled——停机编辑不可能吃到陈旧 artifact，两级 catalog 行为一致，bootSweep 不是正确性依赖。

缺口在自愈：读路径仅 t02 分支带 enqueueBuild，not_compiled/compile_stale 分支只卸载不重编。root 级由启动 bootSweep（`neuro-agent-harness.ts:682`）兜底重编；project child 在 `forProjectWorkspace`（`catalog.ts:213`）lazy 创建时只挂 coordinator+watcher，从不 bootSweep——停机期间磁盘增改 project profile 后，读到即卸载且无自动重编，只能靠 UI 保存/watcher 事件/手动 compile 恢复。

**建议（已实施 2026-09-30）**：child 创建时 fire-and-forget 调 child coordinator `bootSweep()`，对齐 root 启动语义，每进程每项目一次。不取读路径补 enqueue 的替代方案——读路径副作用应保持在 t02 级别的例外，且 watcher 已覆盖运行期编辑。实施形态：`AgentProfileBuildCoordinatorPort` 增可选 `bootSweep?()`（stub 兼容），`forProjectWorkspace` 在 attach 后触发，失败经 `agent.profileBuild.bootSweepFailed` warn 收口（与 root 同事件名，附 `profileRootLabel`）。
