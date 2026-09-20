# P-007：生产部署获得原子切换与回滚能力

- 状态：draft（提交开发者评审）
- 来源：`.local/architecture-review-2026-09-20.md` P0-7（三轮复核属实）

## 问题

本机生产部署的当前形态是：git checkout 拉到目标提交 → 在 checkout 内原地构建（`.output/` 被直接覆盖）→ PM2 restart。这带来三个相互叠加的缺口：

1. **无回滚能力**：一次坏部署的唯一出路是"再部署一次对的"。仓库自己的 Publisher 模块已声明这个缺口是设计外：`scripts/build/local-product-publisher.ts:20-22` 注释原文"这个 Module 不管理安装、migration、健康提交点或 rollback；受管 Installation 必须由 Manager 完成这些动作"——而本机生产没有走 Manager。
2. **构建窗口无原子切换**：构建原地覆盖正在提供服务的 `.output/`，旧进程未重启期间用户即遇 chunk 500（2026-09-15 部署实证）；构建失败则留下半新半旧的产物树。
3. **运行版本与版本字符串脱钩**：`PROJECT-STATUS.md:77` 登记生产按 9/10 先例在不提升版本号的情况下部署 `0f6ba2c3`——运行实例自报的身份不能回答"现在跑的到底是哪个提交"。

部署后健康门禁的资产已存在但未接线：`product:browser-smoke`（`package.json:57`）从未接入部署流程，部署成功靠"PM2 显示 online"判定。

## 目标与非目标

目标：

- 每次部署产物不可变且按提交身份编址（如 `releases/<gitHead>/`），切换是原子操作（symlink 翻转或等价物），构建失败不影响在跑版本
- 部署流程内置健康门禁：启动 → HTTP 探活 → `product:browser-smoke` 通过才算成功；失败自动回切上一版本
- 运行实例可自报 gitHead/构建身份，与 RELEASE.md 登记一致
- 一键/自动回滚到上一个已知好版本，RTO < 5 分钟

非目标：

- 不做多实例蓝绿/滚动（PM2 单实例是现实运维规模，停机秒级切换可接受）
- 不接入完整 Manager 受管 Installation（P1 级工程，与双 harness/部署双轨收敛一并决策）
- 不动 fork 发布门禁（`manager:verify-public` 结构性阻断已在 `PROJECT-STATUS.md:77` 独立登记）
- 不引入容器化生产（GHCR 链存在，但本机部署不依赖它）

## 当前行为与证据

- `scripts/build/local-product-publisher.ts:20-22`：rollback 被显式声明为 Manager 职责，本地 Publisher 不管
- `PROJECT-STATUS.md:77`：版本脱钩与 `manager:verify-public` 阻断的登记原文
- `ecosystem.config.cjs:22-41`：PM2 单 app，`cwd` 与 `PRODUCT_IMAGE_ROOT` 均直指 checkout 与其 `.output`
- 已有未接线资产：`scripts/deploy/product-runtime.mjs`（启动编排）、`scripts/deploy/product-browser-smoke.ts`、`scripts/deploy/server-smoke.sh`、Manager 的 `installation-health.ts`、release 资产链
- 本部署实测 `.output` = 138MB：保留 2–3 份版本化产物的磁盘成本约 300–420MB，在本机磁盘水位（清理后约 3.5GB 可用）下可行但需纳入容量看护
- 2026-09-15 实证：构建覆盖根 `.output` 而未重启 = chunk 500

## 方案、备选方案和取舍

### 方案 A（推荐）：版本化产物 + symlink 原子切换 + 部署脚本门禁

产物根放 checkout 之外（与 p-006 同址族，如 `/www/neuro-book-releases/`；若 p-006 暂缓，本提案独立选址仍成立，避免 `git clean` 灭失与 checkout 污染）：

1. 构建到 `releases/<gitHead>/staging/`，完成后 rename 为 `releases/<gitHead>/`（同卷原子）
2. 校验产物（复用 `ProductRuntimeImageBuilder` 的验证入口）
3. `current` symlink 原子翻转（`ln -sfn` + rename 技巧）指向新版本；PM2 的 `cwd`/`PRODUCT_IMAGE_ROOT` 指向 `current`
4. 重启 → HTTP 探活 → `product:browser-smoke` 全过 → 登记 gitHead 为已知好版本
5. 任一门禁失败：symlink 翻回上一版本并重启，本次部署判失败，旧版本服务不受影响
6. 保留最近 2–3 份产物，更老的由部署脚本清理

取舍：用约 300–420MB 磁盘换真回滚与零构建窗口事故；全部为本机脚本，不依赖 Manager；PM2 形态不变。

### 方案 B：接入 Manager 受管 Installation

设计本意（Publisher 注释指向的终态）：migration、健康提交点、rollback 都是 Manager 合同的一部分。但 Manager 在本机部署链零接入，接入本身是 P1 级工程，且与"双轨部署形态收敛"决策耦合，不适合作为止血方案。

### 方案 C：原地构建 + 事后 smoke + 重建回滚

最低成本，但回滚=重新 checkout 旧版本再构建（10+ 分钟且构建本身可能再失败），不是真回滚能力，构建窗口事故也不解决。

### 取舍结论

A 为推荐落地方案；B 留作 P1 收敛决策的候选终态；C 否决。与 p-006 的顺序建议：p-006 先行（State Root 与产物根外迁后运维模型一致），但两提案各自独立可落地。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：产物根在 checkout 外，无用户数据触碰；保留产物数量纳入磁盘看护（`earlyoom`/清理例程的口径需更新）
- **接口**：`ecosystem.config.cjs` 的 `cwd`/`args`/`PRODUCT_IMAGE_ROOT` 改指 `current` symlink；新增部署入口脚本（建议 `scripts/deploy/local-deploy.mjs`，复用 `product-runtime.mjs` 与 builder 验证）；运行实例自报 gitHead（`server-current.jsonl` 启动行与/或健康端点）
- **安全**：无新凭据面；symlink 翻转需防跟随攻击（产物根权限 700/755 属主固定）
- **迁移**：首次切换需一次正常停机部署；旧 `.output` 保留即隐式第一份"上一版本"
- **发布**：gitHead→运行身份映射写回 `PROJECT-STATUS.md` 或 RELEASE 记录，消除版本脱钩
- **回滚**：本提案的核心交付；回滚路径本身进 smoke（定期演练，至少每次部署隐含验证一次回切逻辑未腐化）

## 对 Spec 的预期改动

- `scripts/release/AGENTS.md` 或 `docs/modules/monorepo-boundaries.md` 的 Product Runtime/Release 行：登记本机部署形态合同（版本化产物、原子切换、健康门禁、回滚语义）
- 部署 SOP 文档化（现状散在 `ecosystem.config.cjs` 注释与运维记忆中）
- 验收依据：故意部署一个启动即崩的构建，系统自动回切，服务恢复 < 5 分钟；`product:browser-smoke` 成为部署门禁的一部分而非可选步骤

## 决策记录

- 2026-09-20：Leader 起草（依据架构审查 P0-7，证据经三轮复核）。待开发者评审：产物根选址与保留份数、健康门禁的失败处置（自动回切 vs 仅告警）、与 p-006 的执行顺序。
