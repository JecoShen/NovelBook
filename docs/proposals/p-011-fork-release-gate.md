# P-011：fork 发布门禁适配（manager:verify-public 结构性阻断裁剪）

- 状态：draft（提交开发者评审）
- 来源：`PROJECT-STATUS.md:77`「fork 发布门禁」段（2026-09-13 登记）的立项要求：「裁剪门禁属合同任务（触点：`scripts/release/release.ts`、release-assets 测试、`release-container.yml`、ADR 0015），待立项」

## 问题

`manager:verify-public`（`scripts/release/verify-public-manager.ts`）在 fork 上结构性不可通过，导致 fork 发布能力冻结：0.10.3-canary 发布载荷已签入 `RELEASE.md`（`0f6ba2c3`）但版本未切，生产只能按 9/10 先例在不提升版本号的情况下部署，运行实例身份与版本串脱钩。

结构性阻断的机制：门禁从 npm 拉取当前 `packages/neuro-book-manager` 版本对应的公开包，要求其元数据 `gitHead` 覆盖仓库当前构建输入（`bun.lock`、`packages/neuro-book-manager/{package.json,scripts/build.mjs,src}`、`server/runtime`）零漂移。该承诺成立的前提是「发布仓库自己也向 npm 发布 Manager」——上游历史上满足（Task 140/142 均记录先过 npm 发布再过 verify-public），fork 不满足：npm 包 `@notnotype/neuro-book-manager` 的 Trusted Publishing 绑定上游仓库与其 `npm` environment（`.github/workflows/release-manager.yml:13-60`），fork 无权也无法替上游发 npm 包。且上游自身处于 mid-train：i229 修复（build.mjs + bun.lock）落在其 npm 公开 `gitHead d0b93d2c` 之后（`PROJECT-STATUS.md:77`），即使 fork 与上游完全对齐，门禁同样失败；fork 再领先上游 218 个提交，漂移是 fork 的固有状态而非缺陷信号。门禁因此在 fork 上从「缺陷检测」退化为「恒红噪音」，且它恰好卡在 stable/prerelease 真实发布路径与 release workflow preflight 的必经位置上。

## 目标与非目标

目标：

- fork 恢复合法切版能力：`bun run release` 真实发布路径与 `release-container.yml` preflight 在 fork 形态下可通过，且通过语义有明确定义（不是简单放行）
- 改动以 fork 适配层形式存在：上游文件零改动或最小改动，跟随上游整树合并不回退；上游（或 fork 重新对齐上游 npm 发布）恢复时，原门禁一行开关即可完整复原
- 门禁在 fork 形态下仍 fail-closed：Manager 构建损坏、打包外部依赖回归、版本串不一致仍然阻断发布
- 0.10.3-canary 载荷获得合法切版路径

非目标：

- 不替上游或 fork 发 npm 包，不改 npm 包名/scope
- 不改 Windows Portable 与 GHCR 验收对上游 npm Manager 的消费方式（登记语义与约束，见「数据、接口…」节）
- 不动 `manager:release`（Manager 独立 npm 发布链）的实现；fork 不可用性只做文档声明
- 不处理部署链与版本脱钩的其余部分（p-007 范围）；不与 p-006/p-007 耦合，可独立落地

## 当前行为与证据

verify-public 保护的真实承诺：**npm 安装用户拿到的 Manager == 仓库当前构建输入**。实现上分三段（`scripts/release/verify-public-manager.ts`）：

1. `materializePublicManagerPackage`（`scripts/release/public-manager-package.ts:21-55`）从 npm registry 拉取与仓库 `packages/neuro-book-manager/package.json` 同版本的公开包，读取其元数据 `gitHead`；设计意图注释（`:17-20`）：Release 与 Portable 必须消费 Trusted Publisher 产出的同一份 bundle，不假定跨 OS 重建字节可复现
2. `git diff --name-only <gitHead> -- bun.lock packages/neuro-book-manager/... server/runtime`（`:24-37`）：任何构建输入晚于公开 `gitHead` 即抛错
3. 隔离目录安装公开 tarball 并断言 `--version` 输出等于仓库版本（`:40-46`）

该承诺在 fork 形态下的消费方盘点：

- `scripts/release/release.ts:184`（runStable 真实路径）与 `:281`（runPrerelease 真实路径）：发布前置硬门禁；`:344` 与 `:390` 是两个 dry-run 打印点，只输出计划文本不执行
- `.github/workflows/release-container.yml:56-57`：preflight job 的 "Verify public Manager provenance" step，全部发布资产构建的上游
- 间接消费方（消费 npm Manager 包本身，不经 verify-public）：Windows Portable 组装嵌入 npm 公开 Manager（`scripts/deploy/windows-portable-manager.ts:120`）；GHCR 公开验收在空目录 `bunx @notnotype/neuro-book-manager@<version>` 驱动安装/管理链路（`scripts/release/verify-public-ghcr.sh:25-28`）

结论：fork 不发 npm，「npm 上的 fork Manager」这个承诺主体不存在；剩下的是「上游 npm Manager 与 fork 仓库输入」的漂移检测，而该漂移恒为真、不构成缺陷信号。门禁在 fork 形态下没有可服务的消费方。

其它关键事实：

- fork 适配先例：`scripts/build/product-platform-matrix.ts:49-54` 的 `FORK_CI_TARGET_PLATFORMS`——fork 拥有的命名常量 + 注释说明收窄理由与恢复路径，上游条目原样保留；`PROJECT-STATUS.md:75` 登记「收窄的只是日常门禁，发布资产合同保持全平台不变」
- 本地一致性校验的现成底座：`packages/neuro-book-manager/scripts/pack-check.mjs`（`manager:pack` = build + pack-check）已在隔离临时根真实安装 `bun pm pack` 产物、验证单文件 bundle 内联全部生产依赖、无构建机绝对路径——与 verify-public 第 3 段的隔离安装哲学同构，只是包来源从 npm 换成本机构建
- 合同测试现状：`scripts/release/release-assets.test.ts:417-422` 断言 preflight 含 `bun run manager:verify-public` step 且 `verify-public-manager.ts` 含 `cat-file -e`/`fetch --no-tags`、不含 `--depth`；`:438-443` 断言 release-assets vitest 配置的 include 清单精确相等（新增测试文件须同步该断言）；`manager-release-contract.test.ts` 不引用 verify-public
- `scripts/tsconfig.json` 是显式 include 清单，新增脚本文件须登记才被 preflight 的 `bun x tsc --noEmit -p scripts/tsconfig.json` 覆盖
- 版本现状：应用 `0.10.2-canary.20260908.091411Z.2e86c254`，Manager `0.1.0-canary.60`；`RELEASE.md` 顶部为 0.10.3-canary 载荷（已含「内部维护」所需素材）
- 上游历史证明门禁本身有效：Task 140（`.agents/tasks/140-pr-review-and-release-gates/README.md:102`）记录过它真实拦截「Manager 源码未发布到 npm 公开 gitHead」的漂移

## 方案、备选方案和取舍

### 方案 A（推荐）：fork 适配层——命令入口改派 + fork 模式本地一致性校验

新增一个 fork 拥有的 dispatcher（建议 `scripts/release/public-manager-gate.ts`，新文件），根 `package.json` 的 `manager:verify-public` script 一行改指 dispatcher。dispatcher 内含 fork 模式标记常量（仿 `FORK_CI_TARGET_PLATFORMS` 先例，注释写明收窄理由与恢复条件）与 env 覆盖 `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream|fork`（供演练与上游语义验证）：

- **upstream 模式**：原样 spawn `bun scripts/release/verify-public-manager.ts`——上游文件字节不动，原门禁语义完整保留
- **fork 模式**：执行「本地构建一致性校验」替代 npm provenance 校验：
  1. `bun run manager:pack`（build + pack-check 隔离安装冷启动验证），证明当前仓库输入可构建出可独立安装运行的 Manager bundle
  2. 对本机构建的 `dist/neuro-book.mjs` 执行 `--version`，断言等于 `packages/neuro-book-manager/package.json` 版本（verify-public 第 3 段的本地对应物）
  3. 输出显式报告：跳过 npm provenance 校验的原因（fork 不发布 npm）、本地校验结果、恢复 upstream 模式的方法；可选地 best-effort 拉取 npm 元数据报告当前漂移状态（try/catch 包裹，离线不阻断）

取舍：fork 门禁仍 fail-closed（Manager 构建/打包/版本不一致照样阻断发布），不是装饰性放行；触点零改动（见下节）；代价是 fork 模式不再验证「公开包 == 构建输入」——但该承诺在 fork 形态下本就没有主体。放弃的是字节级 provenance 保证，这在没有 Trusted Publisher 的形态下本就不可获得。

### 方案 B：fork 模式显式跳过 + 报告

dispatcher 在 fork 模式只打印跳过报告、直接退出 0。改动最小，但 fork 上 Manager 构建损坏要等到 product-* 构建 job 才暴露，门禁从「恒红」变「恒绿」，两种极端都损失信号。

### 方案 C：门禁保留但降级为 warning

继续执行原校验但漂移只警告。在 fork 上该警告恒真，训练维护者忽略门禁输出；且保留对 npm registry 的硬网络依赖，与发布无关的网络故障会误阻断。

### fork 模式判定方式对比

- **文件常量（推荐）**：fork 独有的新文件，上游合并不触碰；显式、可评审、带恢复注释；与 `FORK_CI_TARGET_PLATFORMS` 先例同构
- env-only：仓库外不可见，CI 与本机易漂移，拒绝作为主判定；保留为覆盖开关
- git remote URL 自动检测：remote 命名无合同（fork 也常配 `upstream` remote 跟踪上游），隐式判定与仓库「显式优于隐式」惯例不符，拒绝

### release.ts 四个触点处置

四个触点统一走 `bun run manager:verify-public` 命令入口，判定函数抽在 dispatcher 内，**触点全部零改动**：

- `release.ts:184`（runStable）与 `:281`（runPrerelease）：执行的命令即 dispatcher，无需改
- `release.ts:344` 与 `:390`（dry-run 打印）：打印的 `command: bun run manager:verify-public` 文本仍然字面属实，无需改
- 连带第五触点 `release-container.yml:57` preflight step：同一命令入口，同样零改动

### 取舍结论

A 落地；B 的报告成分并入 A；C 否决。判定的唯一权威位置是 dispatcher，release.ts、workflow、dry-run 文案与既有合同测试断言（`release-assets.test.ts:417-422`）全部保持原样且继续通过——这些断言原地构成「上游语义未变」的测试级证据。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无持久化数据变更；fork 模式校验产物走系统临时根（沿用 pack-check 的 managed tmp root 约定）
- **接口**：根 `package.json:66` 的 `manager:verify-public` script 目标一行变更；新增 fork 独有文件 dispatcher（含模式常量）与 env 覆盖 `NEURO_BOOK_PUBLIC_MANAGER_GATE`；dispatcher 登记进 `scripts/tsconfig.json` include。上游文件 `verify-public-manager.ts`、`release.ts`、`release-container.yml` 零改动。跟随上游整树合并的冲突面收敛为 package.json scripts 一行 + tsconfig include 一行
- **安全**：fork 模式 best-effort npm 漂移报告只读 npm 公开元数据，无凭据面；本地校验不引入新网络写入。放弃 npm provenance 校验属有意识的形态适配，不构成凭据或供应链新风险（fork 发布资产本就不经 Trusted Publisher）
- **迁移**：无
- **发布**：
  - 0.10.3-canary 切版路径（门禁裁剪后）：本提案 accepted 并实施 → 本地验证（见验收）→ H3 批准后按 `scripts/release/AGENTS.md` 执行 `bun run release -- canary --next patch --push --yes --no-watch`。从代码推断：当前 package 版本 `0.10.2-canary.*` 经 `--next patch` 得 base `0.10.3`（`prereleaseNextBaseline` 取 package 版本与最近可达 SemVer tag 较新者，切版前以 dry-run 实际输出为准）；`shouldBumpPackage=true`，release notes 自动取 `RELEASE.md` 顶部 0.10.3-canary 载荷，满足「正文与上一版相同即视为未更新，不得发布」。**注意 `--repo` 必须显式指向 fork 远端**（`release.ts:68` 默认 `notnotype/neuro-book` 指向上游；或设 `GITHUB_REPOSITORY`），否则 Draft candidate 会打向上游仓库
  - 连带消费点的语义登记：fork 发布的 Windows Portable 与 GHCR 验收继续消费**上游** npm Manager（版本 = 仓库 `packages/neuro-book-manager/package.json`）。由此产生一条新合同约束：**fork 不得提升 `packages/neuro-book-manager` 版本号**（npm 上不存在该版本会导致 `materializePublicManagerPackage` 404 / `bunx` 失败），直到「Portable/GHCR 改嵌 fork 本机构建 Manager」另行立项。本机 linux-x64 部署不消费这两个路径，不受该约束影响
  - `manager:release`（Manager npm 发布链）在 fork 不可用：Trusted Publishing 绑定上游仓库与 environment，tag 推送后 `release-manager.yml` 会在 publish 步骤失败。文档声明即可；是否在 `manager-release.ts` 加 fork fail-fast 守卫留作开放问题（改动上游文件的收益不显然）
- **回滚**：dispatcher 常量翻回 `upstream`（或 package.json 一行还原）即恢复原门禁——`verify-public-manager.ts` 未动，回退等价原状。提案被否则维持现状：发布冻结、生产按 9/10 先例不提版本部署，无任何代码改动。实施后若上游恢复 npm 发布且 fork 选择回归上游门禁：翻常量并以 upstream 模式复跑验证即可

## 对 Spec 的预期改动

- `scripts/release/AGENTS.md`：新增「fork 发布门禁」小节——fork/upstream 两模式语义、env 覆盖、切版命令必须显式 `--repo`、`manager:release` 在 fork 不可用、Manager 版本冻结约束
- `docs/specs/README.md` P1「Manager 与发布资产」行（`:140`）：补一句 fork 门禁语义现状（npm provenance 校验在 fork 由本地一致性校验替代），作为该分散能力收敛时的输入
- `docs/adr/0015-architecture-boundaries-and-deferred-structure.md`：下一轮复核记录追加 fork 注记——`:81` 的「`manager:verify-public` 通过」证据在 fork 形态下改由 dispatcher 本地校验产生，npm provenance 语义冻结而非失效
- `PROJECT-STATUS.md:77`「fork 发布门禁」段：实施后更新为已裁剪状态并链接本提案与证据
- `RELEASE.md` 0.10.3-canary 载荷「内部维护」补一条发布门禁 fork 适配（切版时随载荷发布）
- 合同测试：`release-assets.test.ts` 新增断言（dispatcher 存在、含 fork 常量与 env 覆盖、upstream 模式委托 `verify-public-manager.ts`、package.json 指向 dispatcher、fork 模式含 `manager:pack` 与 `--version` 比对步骤）；既有 `:417-422` 断言不动；`:438-443` 的 include 清单断言不动（新断言写在本文件内，不改 vitest 配置）。`manager-release-contract.test.ts` 不变
- 验收：
  1. fork 本机 `bun run manager:verify-public` 退出 0，输出 fork 模式报告且本地一致性校验通过
  2. `NEURO_BOOK_PUBLIC_MANAGER_GATE=upstream bun run manager:verify-public` 执行原逻辑——预期在 fork 上失败并给出原漂移报错（证明上游语义原样保留、未被削弱）
  3. `bun run release -- canary --next patch --dry-run` 通过
  4. release-assets 合同测试（含新断言）、`manager:test`、`bun x tsc --noEmit -p scripts/tsconfig.json` 通过
  5. `verify-public-manager.ts`、`release.ts`、`release-container.yml` diff 为空
  6. 实际 0.10.3-canary 切版属 H3 批准后动作，不计入本提案代码验收

## 决策记录

- 2026-09-22：Leader 起草（依据 `PROJECT-STATUS.md:77` 立项要求；全部结论来自源码阅读，运行时行为标注「从代码推断」，未实测）。待开发者评审的开放问题：
  1. fork 模式本地校验强度：复用完整 `manager:pack`（推荐，多一次 Manager 构建，与 verify-public 隔离安装哲学同构）还是仅 `manager:build` + `--version`（更轻）？
  2. npm 漂移 best-effort 情报报告是否保留（引入对 npm registry 的软依赖，可 try/catch 兜底；不要则 fork 完全离线可发布）？
  3. `manager:release` 是否加 fork fail-fast 守卫（改上游文件），还是仅文档声明不可用（推荐）？
  4. fork 发布的 Windows Portable/GHCR 验收继续嵌入上游 npm Manager 的语义是否接受（推荐接受 + Manager 版本冻结约束），还是需要立后续项改嵌 fork 本机构建？
  5. dispatcher 文件名与常量命名（`public-manager-gate.ts` / `FORK_PUBLIC_MANAGER_GATE_MODE`）是否有更符合仓库惯例的取法？
- 附带动作（实施时）：`docs/proposals/README.md` 活跃提案清单登记本提案。
