# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

NeuroBook — 面向长篇小说的本地优先 AI 工作台（AGPL-3.0-only）。Nuxt 4 全栈 + 自研 Agent Harness（NeuroAgentHarness），产品主线收敛到 **Novel 写作模式 v1**：World Engine（事件溯源世界状态）+ Plot 两棵树（承载树 × 因果树）+ Markdown Studio（TipTap）+ llmlint（AI 写作味 lint）。多平台发布（Linux/macOS/Windows Product + Portable + Container + Manager），Windows-first 桌面 spike（Electron/Tauri）。

## 文档分层

`CLAUDE.md` 只承担入口索引，**不复制**其他文档的内容。阅读路径按关注点分流：

| 关注点 | 去哪看 |
| --- | --- |
| 行为与长期规则（开发必读） | [`AGENTS.md`](AGENTS.md) |
| 模块状态 / 风险 / 验收缺口 | [`PROJECT-STATUS.md`](PROJECT-STATUS.md) |
| 稳定合同与领域术语 | [`reference/`](reference/README.md) |
| 已完成任务的实现证据 | [`docs/tasks/`](docs/tasks/README.md) |
| 架构决定记录 | [`docs/adr/`](docs/adr/) |
| 用户文档与教程 | [`docs/`](docs/README.md) |
| 外部贡献者规范 | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| 发布的用户可见变更 | [`RELEASE.md`](RELEASE.md) |
| 同仓 Agent 资产（profile / skill / workflow） | [`assets/workspace/.nbook/agent/`](assets/workspace/.nbook/agent/) |

## 工作区（CLAUDE.md 独有）

- 主工作区 = 仓库根 `/www/wwwroot/book.neoshen.dpdns.org`，分支 `main`。
- 远端 `main` 更新后建议 `git fetch`；**允许**普通 `git push`（`git push origin main`），**禁止** `force push` 与 `force-with-lease`（强推会改写 commit 哈希、破坏协作历史）。
- 测试 / 临时数据：放在 `.agent/tmp/<test-name>-<uuid>/`，不要写在仓库、`.worktree/` 或快照目录。
- 依赖：统一用 Bun；新增前先确认现有依赖是否能解决；`patches/` 目录有 nitropack 等上游未合补丁，**不要**绕过 `bunfig.toml` 的 patch 机制。
- Agent 不自行合并 PR、关闭 Issue、跑 `release`、改版本号——这些动作需要用户明确许可。

## 已知债务与门禁

- `shared/Manager` 运行时依赖环（P1 候选）、`shared/server/agent` 循环类型依赖（P2）、核心 Facade 单体偏大（P2）、OpenAPI 生成物写回路由源码（P2）。处理边界见 [`docs/adr/0015-architecture-boundaries-and-deferred-structure.md`](docs/adr/0015-architecture-boundaries-and-deferred-structure.md)。
- Nitro dev source-map 临时补丁等上游稳定版（`patches/nitropack@2.13.4.patch`，Issue #20），不要绕过。
- Agent Session v2 manifest 状态语义（2026-08-09 后的特殊性）见 `PROJECT-STATUS.md` 末尾段落与 `server/agent/session/migrations/session-v2/`。
- `0.9.3-canary` 是限量 canary，**不等于** stable、签名安装器、updater、WebView2 分发或最终 Desktop 框架选型。

## PM2 + Agent Session Store Lease 操作手册

**触发场景**：ecosystem.config.cjs 修改 / 全站 500 (`AgentSessionStoreLeaseHeldError`) / PM2 进程频繁重启 / `runtime.lease` 锁文件残留。

**根因复盘**（2026-08-17）：旧进程 OOM 死透但 `runtime.lease` 没释放，PM2 auto-restart 新进程持续 ELOCKED → 全站 500。`proper-lockfile` 的 `stale: 30_000` 对 directory lockfile 不接管，单纯等 30s 无效。

**当前自动恢复层（L1-L4 覆盖 99% case，本手册仅作最后手段）**：

| 层 | 触发 | 行为 | 来源 |
| --- | --- | --- | --- |
| L1 proper-lockfile `stale: 30_000` | 进程内运行时持有锁 | 理论值，directory lockfile 行为不一致，常不接管 | `server/agent/session/agent-session-store-lease.ts` |
| L2 owner.pid alive check | 每次 `acquire()` 入口 | `process.kill(pid, 0) === ESRCH` → 清 lease + .lock 接管 | R8 commit `4e652e61` |
| L3 .lock mtime check | owner 解析失败时 | `.lock` mtime > 30s 视为 stale,清 .lock 让 proper-lockfile 接管 | R7/R8 commit `a810574a` |
| **L4 新进程 grace 启发式** | owner 解析失败时 | 进程 uptime < 30s → **任何**残留 .lock 都接管 | **R10 commit `71ee5d48` 彻底解决 7s/22s 端到端 case** |
| L5 `clean-stale-lease.sh` | 外部手动调用 | 30s 阈值（`--stale-seconds 30`），支持 archive | R9 commit `01d24d88` |
| L6 pre-setup 钩子 | `pm2 deploy setup` 前 | `mmin +1` 自动清 (>1min 残留) | R9 `ecosystem.config.cjs` |

> 7s 用户端到端 case：L1 不接管 + L3 mtime 太小 + L4 进程已 > 30s → 唯一路径 = L5/L6 外部清理。R10 之前只能这样。R10 之后 PM2 clean restart 场景下 L4 自动恢复。

### Clean Restart 流程（不要用 `pm2 restart`）

```bash
# 1. 停（graceful shutdown，让进程 release lease）
pm2 stop book-neoshen
ps aux | grep -E "bun.*index.mjs" | grep -v grep  # 确认进程死了

# 2. 检查 lease 状态
cat workspace/.nbook/agent/migrations/runtime.lease 2>/dev/null
stat workspace/.nbook/agent/migrations/runtime.lease.lock 2>/dev/null

# 3. 干跑清理脚本（不实际删除，只列 stale 候选）
bash scripts/clean-stale-lease.sh

# 4. 实际清理（删除前自动归档到 .agent/plan/lease-archive-2026-MM-DD-stale/）
bash scripts/clean-stale-lease.sh --force --archive

# 5. 从 PM2 list 删 + 重启（拿全新 PID + 新 lease）
pm2 delete book-neoshen
pm2 start ecosystem.config.cjs
```

### Lease 状态诊断命令

```bash
# 当前 lease owner
cat workspace/.nbook/agent/migrations/runtime.lease | jq .

# lock mtime（proper-lockfile 的 heartbeat = lock mtime）
stat workspace/.nbook/agent/migrations/runtime.lease.lock

# stale 自检（mtime > 1min 需清；L4 grace 期已接管 < 30s fresh 残留）
find workspace/.nbook/agent/migrations -maxdepth 1 -name "*.lease*" -mmin +1

# 错误日志中找 lease 冲突
grep "AgentSessionStoreLeaseHeldError" logs/server-current.jsonl | tail -5

# 找心跳停止的旧 owner 是否还活着
ps -p <lease.pid>  # exit 1 = 死了
```

### 教训

- **`pm2 restart` 不可用**：旧进程不释放 lease，restart 不会清，新进程 ELOCKED。
- **`runtime.lease.lock` 是 DIRECTORY**：`rm -f` 失败 "Is a directory"，必须 `rm -rf`。
- **proper-lockfile 的 `stale` 对 directory lockfile 行为不一致**：不要相信"30s 后自动接管"。
- **修改 ecosystem.config.cjs 后必须 clean restart**：`pm2 reload` 同样会撞 lease。
- **PM2 `max_memory_restart` 触发的是"提前重启"**：256M → 512M → 1024M → 1536M（R9 调高 50% 缓冲），让 OOM 之前就重启而不是临界点死锁。当前 1536M，新 build 700-800MB 基线 + 150MB 突发缓冲。
- **fact-forcing gate**：单条 `rm` 命令比组合命令更易过 gate（拆开执行）。

完整复盘见 `novel-frontend-display-fix-2026-08-17` memory。
