# Layered Non-Desktop Typecheck Projects

## 背景

当前根 `typecheck` 把 Nuxt、Server 与独立 Desktop 包串在一个命令中，并给 Node 设置 `4096 MiB` heap。当前任务明确不包含桌面端；本机又只有约 4 GiB 可用内存，不能靠放宽 heap 上限完成验证。

受控二分已经证明问题不是进程泄漏或多个 worker 叠加：`server/runtime/tsconfig.json`、`scripts/tsconfig.json` 与若干单入口图会由一个 TypeScript 进程加载完整 Agent、Project Session、History、Plot 与数据库类型闭包，并在约 1 GiB RSS 触发止损。`profile-dsl.ts` 通过轻量合同切边后，独立 typecheck 从 `1060976 KiB` 降到 `529260 KiB`；但 `profile-turn-context.ts` 仍因 Project Session / History 组合根达到 `1053668 KiB`。

这说明单 worker 只能防止并发放大，不能约束单个 TypeScript Program。需要把非桌面类型检查改成有向、可缓存、可逐层执行的项目边界。

## 目标

- 提供不安装、不检查 `desktop/electron` 的正式非桌面 typecheck 入口。
- 每个 TypeScript 子项目在单核执行时单进程 RSS 小于 `1310720 KiB`（**见下方修订**），并在 `MemAvailable` 低于 `2097152 KiB` 前停止。
- 下游项目通过上游生成的声明消费类型，不重新把上游 Source 加入同一个 Program。
- CI 与本地执行同一组项目和同一依赖顺序；项目可单独重跑并准确指出失败层。
- Nuxt/Vue、Server、Runtime 和构建脚本的类型错误仍全部受门禁覆盖；不新增或扩大 `skipLibCheck` 范围，不用 `any`、`noResolve` 或文本检查掩盖源码错误。
- 不改变运行时 import specifier、模块初始化顺序、数据库合同或用户数据。

### 修订：单进程 RSS 线 `1048576` → `1310720`（2026-09-09，Task 4）

初稿把单进程 RSS 目标定为 `1048576 KiB`（1 GiB）。Task 4 实测表明该值与本 spec 的另一条目标
「类型错误仍全部受门禁覆盖」**不可兼得**，故修订为 `1310720 KiB`（1.25 GiB）。
`MemAvailable >= 2097152 KiB` 这条底线**不变**——它才是真正的机器保护机制。

依据（全部为实测，测量方法见 plan Task 4）：

1. `server/agent/**` 的可达面含一个 **83 文件的不可分强连通分量**（228 条层内 import 边；
   任取一点的前向与后向可达集都覆盖全部 83 点）。它构成 `typecheck/agent` 层，
   **不改源码无法再分**，因此没有任何边界安排能让它变小。
2. 该层真实峰值实测 1034184 / 1042412 / 1058972 / 1065884 / 1066264 KiB，**横跨 1 GiB 线**。
   即旧线下该层时绿时红，是一个**闪烁门禁**，而非稳定的失败。该层类型检查本身干净。
3. 1 GiB 在初稿里是**目标值，无物理推导**。agent 层峰值时 `MemAvailable` 实测最低
   2835176 KiB，距 2 GiB 底线仍有 700+ MiB，机器安全从未受威胁。
4. 跨运行方差实测达 **130 MiB**（contracts 871004→1001208，agent-support 925552→988996），
   **大于 agent 的超线幅度**。1 GiB 线只给 contracts 留 47 MiB、给 agent-support 留 58 MiB 余量，
   均落在自身一次方差内。1.25 GiB 给最大层留约 244 MiB ≈ 1.9 倍最坏方差。
5. 反向选择（把 agent 层排除在门禁外）会直接违反上面那条覆盖目标，且是**覆盖回归**：
   根 `tsconfig.json` 今天就检查 `server/agent/**`。

已排除的替代手段（均不改源码，实测都不足以下线）：`--disableReferencedProjectLoad` 零效果
（`-p` 本就不载入上游源码）；收窄 `types` 只省约 16 MiB 且余量落在噪声内。成本主导项是
typebox `Static<>` 的条件类型求值（trace 中 `Conditional → Conditional` 占
`structuredTypeRelatedTo` 累计耗时 62.7%），属第三方类型机器病理，不是本层结构问题——
「改源码」在这里等于开放式性能工程，不是干净重构。

## 非目标

- 不处理 Electron、Windows Portable、Desktop 安装器或原生桌面验收。
- 不在本轮重构业务领域模型，也不借机清理所有既有循环依赖。
- 不提交生成的 `.d.ts`、`.tsbuildinfo` 或 Nuxt 输出。
- 不承诺把 GitHub Actions job 限制到本机的 1 GiB；CI 必须使用同一分层命令，但资源采样以本机受控验收为准。
- 不把完整测试套件拆分混入本设计；typecheck 收口后再单独处理 Vitest 高内存入口。

## 设计原则

### 1. 运行模块与类型项目分开

现有 `nbook/*` 运行时路径保持不变。分层只发生在 typecheck 配置中：上游项目以 `composite`、`declaration` 和 `emitDeclarationOnly` 生成声明，下游项目通过 project reference 和专用 `paths` 映射消费声明输出。

声明和 `.tsbuildinfo` 写入 `<repo>/.agent/tmp/typecheck/<runId>/`。串行调度器拥有该目录，在成功、失败和信号中止时都执行清理；Git 不跟踪任何生成物。

### 2. 依赖方向

目标有向图为：

```text
contracts
   ↓
workspace-history
   ↓
agent
   ├────────→ runtime ─────→ scripts
   ├────────→ scripts
   └────────→ web-server ←─ runtime
                       ↓
                  nuxt-vue
```

各层职责：

- `contracts`：`shared/`、Profile/Variable SDK、Project/History token 与纯数据合同；不得导入数据库、注册器、组合根或 Nuxt。
- `workspace-history`：Project Session、History、文件索引和 Plot/World 数据面；注册副作用只允许在本层的 composition entry。
- `agent`：消息、Profile、Harness、Workflow 与工具；通过 workspace/history 声明消费项目数据面。
- `runtime`：启动、迁移、关闭、路径和缓存入口；不重新检查 Agent/Workspace 源码。
- `scripts`：构建、发布和 CLI；通过声明消费 runtime/agent 合同。
- `web-server`：Nuxt server API、plugins 和 middleware；通过声明消费领域服务。
- `nuxt-vue`：Vue/App 与 Nuxt 生成类型；不重复把完整 Server Source 纳入 Program。

这个图是目标边界，不要求第一提交一次迁移全部文件。每个阶段只在前一阶段资源验收通过后继续。

### 3. 组合根切分

Project Session 与 Project History 当前把数据面函数、handle/token 合同、模块注册和生产 side-effect import 放在同一文件。声明项目不能把组合根暴露给轻量消费者。

需要拆成三类入口：

- `*-contract.ts`：纯类型及稳定 token identity，只依赖下层合同。
- `*-data-plane.ts`：读取 ready generation、History inbox/diff/cursor 等业务操作；不注册模块。
- 现有 `project-session.ts` / `project-history.ts`：保留生产 composition 与兼容 re-export，运行时行为不变。

`profile-turn-context.ts` 改为只依赖 contract/data-plane；Harness 仍通过现有公开入口工作。旧 import specifier 在迁移期保留 re-export，避免全仓一次性改调用方。

### 4. 循环依赖处理

不允许用 project references 伪装循环。若两个目标项目互相引用源码，先把它们共同需要的最小类型或 port 下沉到 `contracts`；值级调用通过已有 facade 或显式 port 单向传递。

第一阶段必须生成 `tsc --build --dry` 可解析的无环图，并用声明输出实际检查一个下游消费者。若需要 `prepend`、路径指向源码或同时把上下游文件列入一个项目，视为可行性失败，停止迁移并修订设计。

### 5. 串行调度与资源防线

新增一个仓库脚本作为唯一非桌面聚合入口。它按拓扑顺序逐层启动 TypeScript/Nuxt 子进程，同一时刻最多一个子进程；每层记录：

- 退出码与时长；
- `MAX_SINGLE_RSS_KIB`；
- `MAX_GROUP_RSS_KIB`；
- `MIN_MEM_AVAILABLE_KIB`；
- 被止损时的层名和命令。

本地默认止损为单进程 `1310720 KiB` 或 `MemAvailable < 2097152 KiB`。收到 SIGINT/SIGTERM 时终止当前子进程组并清理本 run 输出。不能通过自动重试或提高 heap 掩盖超限。

CI 使用同一脚本和层序，但可以关闭 `/proc` 采样兼容非 Linux runner；检查内容和项目边界不能分叉。

## 实施阶段

### Phase 0：可行性样板

1. 建立临时输出 owner 和串行 runner 合同测试。
2. 把 Project/History 最小 handle/token 合同与数据面从组合根分离。
3. 建立 `contracts` 与一个下游 `profile-turn-context` 样板项目。
4. 证明下游解析到声明输出而非上游源码，并完成真实 typecheck。
5. 单核测量样板；必须低于 `1310720 KiB`，且结束无残留进程和输出目录。

Phase 0 不通过时不继续创建其余项目。

### Phase 1：Server 领域层

按 `workspace-history → agent` 建立项目。每加入一层先跑本层 typecheck、相关聚焦测试和资源采样。兼容 re-export 在所有现有调用方迁移并验证前不删除。

### Phase 2：Runtime 与 Scripts

让 `server/runtime/tsconfig.json` 和 `scripts/tsconfig.json` 消费上游声明。正式配置分别完成后，再运行串行聚合入口；不能用最小诊断 tsconfig 代替正式项目。

### Phase 3：Web / Nuxt

把 server API/plugins 与 Vue/Nuxt 检查分开。Nuxt prepare 只执行一次；Nuxt/Vue 项目消费 Server 声明，不再次包含完整 Server Source。保持现有 `.env.typecheck` 行为。

### Phase 4：CI 切换与旧入口收口

- 新增 `typecheck:non-desktop` 作为本地和 CI 的正式入口。
- `typecheck` 是否继续包含 Desktop 由现有发布兼容决定，但本轮 CI baseline 改为明确调用非桌面入口；Desktop job 保持独立，不在本任务验证。
- 更新 workflow 合同测试，禁止 baseline 隐式安装 Desktop 依赖。
- 删除只为迁移存在的兼容配置；保留公共代码 re-export，除非全仓消费者已迁移。

## 测试与验收

按 TDD 建立以下证据：

1. runner：严格串行、失败即停、信号终止整个子进程组、finally 清理输出。
2. project graph：无环、每个文件只由一个 owner 项目声明、下游解析到声明输出。
3. boundary：contract 项目不得解析数据库、Nuxt、Project 注册器、Plot composition 或 Agent Harness 源码。
4. behavior：Project open/close、History inbox/diff/cursor、file-change notice 与 Profile DSL 现有聚焦测试不回退。
5. type errors：在各层 fixture 注入一个真实类型错误时，对应层失败且后续层不运行。
6. resources：每层单核采样均低于 `1310720 KiB`，聚合结束无 TypeScript/Nuxt 子进程残留。
7. formal gate：`bun run typecheck:non-desktop` 退出码 `0`；不能由若干最小临时配置代替。

全量 Vitest、浏览器验收和部署 smoke 分别记录，不把 typecheck 通过外推为这些门禁通过。

## 失败与回退

- 某层出现类型错误：停止后续层，保留日志摘要，清理声明输出。
- 某层超过资源线：终止整个层的进程组，报告层名和峰值；不自动扩大 heap。
- 声明输出缺失、过期或 identity 不匹配：本次运行失败，不回退到 Source 全图。
- Nuxt 无法消费 Server 声明：保持旧 CI 命令不变，回退该阶段配置；已经完成并验证的下层边界可以保留。
- 完整方案需要多次小提交。任何阶段行为测试回退时只回滚当前阶段，不推翻已通过的下层合同。

## 完成标准

- `bun run typecheck:non-desktop` 在单核串行模式退出码 `0`。
- 每层 `MAX_SINGLE_RSS_KIB < 1310720`，运行期间 `MIN_MEM_AVAILABLE_KIB >= 2097152`。
- 结束后无 TypeScript、Vue TypeScript、Nuxt typecheck 子进程和 `.agent/tmp/typecheck/<runId>` 残留。
- CI baseline 使用同一非桌面入口并通过；Desktop 未运行且明确标记不在范围。
- Project/History/Profile 相关聚焦测试通过，Task 125 与 `PROJECT-STATUS.md` 记录确切数字和未验证边界。
