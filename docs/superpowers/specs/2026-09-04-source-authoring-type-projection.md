# Source Authoring Type Projection

## 背景

Source 模式的 Profile / Variable CLI 当前读取仓库根 `tsconfig.json`，并让 TypeScript 从作者源码沿 `nbook/profile-sdk` 进入完整 Source 依赖图。`scripts/build/authoring-cli-blackbox.test.ts` 的单个 `profile compile broken.profile.ts` 子进程实测在约 70 秒内达到 `2,398,916 KiB` RSS；Vitest 默认两个 worker 时还会与其它测试叠加。

这不是已经证实的进程退出后泄漏：中止测试后相关进程全部退出，内存立即回收。问题是一次类型检查的依赖面和峰值工作集过大，既影响测试，也影响真实 Source authoring CLI。

## 目标

- Source Profile / Variable 类型检查只消费公开 Authoring SDK 的声明投影，不加载完整 Nuxt / Agent Source 类型图。
- Product 与 Source 使用同一个声明投影生成核心和同一份依赖白名单，不维护两套 authoring 类型合同。
- 投影是可重建缓存，具有稳定身份、并发发布、容量边界和失效规则。
- 全量 Vitest 默认单 worker，避免多个高内存测试进程并发；这只是防御线，不代替投影减重。
- Profile / Variable 现有语义诊断、SDK import gate、Product 自包含合同和 artifact 发布合同不回退。

## 非目标

- 不降低为 `transpileModule` 或只做语法检查。
- 不把生成声明提交进 Git，也不让 Source CLI 依赖已有 `.output/` Product build。
- 不复用短期 `authoring-cache` lease 作为持久缓存；短期 lease 在消费结束后删除，与共享投影的生命周期不同。
- 不改变 Profile `.compiled/` manifest、发布、GC 或运行时加载合同。

## 设计

### 共享投影生成器

把 `scripts/build/product-authoring-kit.ts` 中“从公开 SDK 入口生成声明、裁剪可达闭包、投影批准第三方类型依赖、生成最小 tsconfig”的逻辑提取为共享 build 模块。调用方提供目标目录，生成器返回投影 inventory：文件数、总字节数和输入指纹。

公开入口保持为：

- `profile-sdk/index.ts` 及已登记子入口；
- `variable-sdk/index.ts` 与 `variable-sdk/contracts.ts`；
- 已登记的声明辅助文件；
- `@types/node` 和投影闭包实际需要的批准依赖。

Product Authoring Kit 继续把结果写入 image staging；Source 缓存调用同一个生成器，不能复制生成规则。

### Source 缓存身份

新增 `source-authoring-types` 缓存 owner，根目录固定为：

```text
<Cache Root>/authoring-types/
  <fingerprint>/
    manifest.json
    tsconfig.json
    types/
    node_modules/
  current.json
  .publish.lock
```

`fingerprint` 由以下规范化输入计算：

- 投影生成器 schema/version；
- Bun lockfile 中批准 authoring 依赖的解析身份；
- 所有公开 SDK 投影入口及可达 Source 文件的相对路径、SHA-256 和字节数；
- 投影依赖登记表与生成 tsconfig 的规范化内容。

绝对 checkout 路径、mtime 和临时目录不进入指纹。同一源码和 lockfile 在不同 worktree 应得到同一指纹。

### 构建与发布

Source CLI 请求 authoring context 时：

1. 在无锁状态计算候选输入指纹并读取 `current.json`。
2. current 指向的 manifest、inventory 和文件哈希全部匹配时直接复用。
3. miss 时在 Cache Root 同级 staging 生成完整候选；生成过程不持有发布锁。
4. 获取 `.publish.lock` 后再次检查 current；若其他进程已发布相同 fingerprint，丢弃本候选并复用已有投影。
5. 否则把候选原子 rename 到 `<fingerprint>/`，再原子替换 `current.json`。
6. 锁外删除本进程 staging；清理失败只记录结构化 warning，不改变已发布结果。

消费者先取得已验证的 immutable fingerprint 路径，再创建 TypeScript Program。发布新 current 不删除旧目录中的在途读者。

### 容量与回收

- current 指向的投影永不删除。
- 非 current 投影保留最小安全年龄，默认 10 分钟，保护已经读取旧 current 的进程。
- orphan 总预算默认 256 MiB；超过预算后从最旧且已过安全年龄的目录开始回收。
- 目录必须含 owner schema、fingerprint 和完整 inventory 才能被 owner 回收；未知目录保守保留并告警。
- 回收失败不阻断当前类型检查，但报告 `orphanBytes`、`deletedBytes`、`failedFiles` 和 `overBudgetBytes`。

这些规则沿用 ADR 0002 的 owner / 真相源 / 可达集合 / 硬预算原则，但不与短期 authoring lease 或 Profile artifact GC 合并。

### Compiler Context

`resolveRuntimeArtifactCompilerContext()` 的 Source 分支改为异步取得已验证的 Source projection context：

- `tsconfigPath` 指向缓存投影的最小 `tsconfig.json`；
- 新增 `authoringTypeRoot`，指向投影声明根；
- `nbookRoot` 继续指向 Source checkout，供 artifact bundle 解析运行时代码；
- `compilerNodeModulesRoot` 指向投影依赖根；
- artifact 实际 esbuild 编译仍使用 Source checkout 的运行时代码和现有 dependency gate，不从声明缓存执行代码。

类型检查与 runtime bundle 因而使用不同但可追溯的输入：前者消费公开声明接口，后者消费 Source 实现并由 metafile 门禁验证。两者不能混成同一个路径字段，`authoringTypeRoot` 与 `nbookRoot` 的语义必须保持独立。

### 失败策略

- 指纹、manifest、inventory 或文件哈希不匹配：视为 cache miss，重建，不尝试修补目录。
- 生成失败：保留旧 current，但本次 CLI 失败并输出自然语言错误；不能静默回退完整 Source `tsconfig`，否则重新引入无界内存路径。
- 发布锁失败或缓存超过不可回收预算：本次 CLI fail closed，并报告 Cache Root、计数和字节数，不删除未知内容。
- 进程中止留下 staging：下次准入仅回收带合法 owner、超过保留期且 owner PID 不活跃的目录。

## 单 Worker 防线

根 `vitest.config.ts` 的 `maxWorkers` 从 `2` 改为 `1`。当前仓库在 4 核、7.8 GiB 内存服务器上运行测试，Profile CLI 会启动独立 Bun 子进程；单 worker 保证同一时刻只有一个测试文件进入这类黑盒链。

CI 并行 job 不由 Vitest `maxWorkers` 控制，workflow 仍可并行。若 CI runner 也共享固定资源，应由 runner 层限制并行 job；本任务不修改外部 runner 配置。

## 测试与验收

按 TDD 顺序建立以下证据：

1. 投影生成：相同输入跨目标目录得到相同 fingerprint 和 inventory；SDK 源码或批准依赖身份变化会失效。
2. 声明闭包：Profile / Variable 合法类型通过，故意类型错误失败，未批准 import 仍由现有 gate 拒绝。
3. 缓存发布：并发 miss 只发布一个 current；损坏 current 重建；活跃/年轻 orphan 不回收；超预算旧 orphan 回收。
4. Source CLI：真实 `authoring-cli-blackbox.test.ts` 通过，且不需要 `.output/`。
5. Product：现有 Product Authoring Kit 与 authoring smoke 聚焦测试通过，证明共享提取未改变镜像合同。
6. 资源验收：单核单 worker 运行黑盒测试，按固定采样记录 Profile CLI 峰值 RSS；目标为小于 768 MiB，且测试结束没有遗留 Bun/Vitest 子进程。
7. 类型与回归：`bun run typecheck`、相关聚焦测试通过；全量测试只在受控单 worker、超时和资源监控下运行。

资源目标是本任务的行为验收，不写成依赖特定 `ps` 输出格式的单元测试。若投影后仍超过 768 MiB，必须继续分析投影闭包，不得仅上调阈值。

## 迁移与回退

这是纯可重建缓存，无用户数据迁移。旧版本没有 `authoring-types/` 时首次按需生成；回退代码后该目录成为未知缓存，不影响旧 CLI，后续由明确 owner 的维护流程清理。

实现不修改 Profile/Variable 源码、compiled artifact 或 State Root 数据。最坏失败表现是 authoring CLI 明确失败，应用既有已编译 Profile 仍可读取。
