# P-006：State Root 迁出 git checkout 根

- 状态：draft（提交开发者评审）
- 来源：`.local/architecture-review-2026-09-20.md` P0-6（三轮复核属实）

## 问题

生产部署把 `NEURO_BOOK_STATE_ROOT` 设为 git checkout 根本身，全部用户数据——作品 `workspace/`（实测 1.3GB）、Project/History SQLite、Agent 会话、`.env`、`config.yaml`、`logs/`、`cache/`、以及 P0-2 新增的本地备份 `backups/`——与源码树同居一个目录。

后果是单点灭失面：`git clean -fdx`（上述目录全部已被 gitignore，`-x` 会连带删除）、一次"重装=删目录重拉"的直觉运维操作、或对错误 worktree 的清理，都会不可逆地灭失全部用户数据。且备份与原始数据处于同一失败域，`backups/` 随 checkout 一同灭失，P0-2 的本地备份在这类事故下完全不提供保护。

这同时违反仓库自己的边界合同：`docs/modules/monorepo-boundaries.md` 已规定 Source Dev 默认 State Root 是平台用户数据根（Linux `$XDG_DATA_HOME/NeuroBook/data`），并把 checkout 根 `workspace/` 定性为"本机旧运行残留/用户数据隔离区"——生产部署是当前唯一把 State Root 放在 checkout 根的正式形态。

## 目标与非目标

目标：

- 生产 State Root 迁到 checkout 之外的独立目录，checkout 根不再持有任何用户数据真相源
- 迁移过程有完整性校验、可回滚、停机窗口有界（目标 < 10 分钟）
- 迁移后 `git clean -fdx` 或删除整个 checkout 不影响用户数据与产品可恢复性

非目标：

- 不改 State Root 内部布局（`workspace/`、`.nbook/` 结构、`workspace/` 逻辑前缀均不变）
- 不做多实例/多站点编排，PM2 单实例形态保持不变
- 不顺带实施部署链改造（p-007 独立提案，两者正交但建议本提案先行）
- 不迁移 bridge token 等凭证类文件（`.local/` 属仓库管理的本机凭证位，不是运行状态）

## 当前行为与证据

- `ecosystem.config.cjs:32-34`：`NEURO_BOOK_APPLICATION_ROOT`/`NEURO_BOOK_STATE_ROOT` 均为 `/www/wwwroot/book.neoshen.dpdns.org`（checkout 根），`NEURO_BOOK_CACHE_ROOT` 为其下 `cache/`
- `docs/modules/monorepo-boundaries.md:17`：Source Dev 默认物理 Workspace 在平台用户数据根，"不使用 checkout 根 `workspace/`"；`:29`：checkout 根 `assets/` 与 `workspace/` "仅是本机旧运行残留/用户数据隔离区"
- 本部署实测：checkout 根下 `workspace/` 1.3GB、`logs/` 11MB、`cache/` 4.6MB、`.env`/`config.yaml` 各 4KB；gitignore 确认 `.output`、`workspace`、`logs`、`cache`、`.env`、`config.yaml`、`backups`（f0ee6e3a 补）全部被忽略，即全部落在 `git clean -fdx` 删除面内
- 设计本意参照：`scripts/release/installation-state-root.ts` 的 Installation Manifest 模型把 State Root 定位在 installation-root 下——受管安装形态里 State Root 本就与 checkout 分离
- 运维史佐证此类操作真实发生：2026-08-17 深度清理（7G→2.4G）、worktree 残留清理均涉及对 checkout 内目录的大面积删除

## 方案、备选方案和取舍

### 方案 A（推荐）：PM2 形态不变，State Root 整体外迁

1. 停机（PM2 stop）
2. `rsync -a` 拷贝 `workspace/`、`backups/`（如已产生）、`.env`、`config.yaml`、`logs/` 到新 State Root（候选 `/www/neuro-book-state/`，具体路径在决策记录定）；`cache/` 不迁，由产品重建
3. 校验：文件数对比 + 各 SQLite `PRAGMA integrity_check` + 抽查 hash
4. `ecosystem.config.cjs` 改 `NEURO_BOOK_STATE_ROOT`/`NEURO_BOOK_CACHE_ROOT` 两行指向新位置
5. 启动，验证启动日志、作品列表、一个项目的打开与写盘
6. 旧位置数据保留观察期（建议 7 天）后清理

取舍：动作小、可逆、停机窗口可控；不解决部署链问题（归 p-007）。

### 方案 B：借迁移接入 Manager 受管 Installation

Manager 的 Installation 模型（`scripts/release/installation-state-root.ts`、`packages/neuro-book-manager/src/installation-*`）原生把 State Root 放在 installation-root 下。收益是顺带获得受管部署链，但把本提案与 p-007 耦合，停机窗口与失败面同时放大，且 Manager 在本机部署链零接入，接入本身是 P1 级工程。

### 方案 C：符号链接过渡

checkout 根 `workspace/` 等改为指向外部目录的 symlink。改动最小，但真相源位置变得隐晦，后续维护者容易误判数据位置，只可作为迁移期临时手段，不作为终态。

### 取舍结论

A 先行；B 作为 p-007 与 P1 双轨收敛决策时的候选终态一并评估；C 仅限迁移窗口内使用。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：必迁 `workspace/`、`backups/`、`.env`、`config.yaml`；建议迁 `logs/`（历史诊断价值）；不迁 `cache/`（可重建）。迁移校验以 integrity_check + 文件数为准
- **接口**：仅 `ecosystem.config.cjs` 的 `NEURO_BOOK_STATE_ROOT`/`NEURO_BOOK_CACHE_ROOT` 两行 env；`APPLICATION_ROOT`/`REPOSITORY_ROOT`/`PRODUCT_IMAGE_ROOT` 留在 checkout。product-start 的路径解析显式 env 优先（`ecosystem.config.cjs` 注释、`installation-paths.ts`），显式值变更后行为确定
- **安全**：新 State Root 目录权限按现 checkout 内同级（含 `.env`、`config.yaml` 的读取范围）设置；bridge token 留在 `.local/` 不动
- **迁移**：停机 < 10 分钟（1.3GB 本机拷贝 + 校验 + 重启）；迁移脚本需先写后验，禁止边迁边删
- **发布**：`ecosystem.config.cjs` 是已跟踪文件，变更走正常 commit；本机 PM2 reload 生效
- **回滚**：观察期内改回两行 env 即回退，旧位置数据原样保留

## 对 Spec 的预期改动

- `docs/modules/monorepo-boundaries.md`：把"任何部署形态不得把 State Root 放在 git checkout 根"从 Source Dev 默认上升为全形态合同；同步更新第 29 行对 checkout 根 `workspace/` 的定性（迁移后该目录应不存在）
- 验收依据：在隔离副本上执行 `git clean -fdx` 后产品仍可从新 State Root 完整启动并打开作品（不在生产执行该验证）

## 决策记录

- 2026-09-20：Leader 起草（依据架构审查 P0-6，证据经三轮复核）。待开发者评审：目标目录选址（`/www/neuro-book-state/` vs 其他）、观察期长度、迁移执行窗口。
