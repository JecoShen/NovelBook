# 运行、数据与隐私

这一页回答自部署用户最关心的四件事：**服务怎么管、数据在哪、怎么备份、哪些东西不能随便发出去**。

## 服务运行与停止

启动后默认监听 **3000** 端口（`NUXT_PORT` 或 `PORT` 可覆盖）。

```bash
.runtime/bin/neuro-book start
```

::: warning Manager 目前不提供 stop 或 restart
Manager CLI 有 `install / manage / instances / adopt / update / start / status / doctor / runtime / tools / admin / uninstall`；**没有 `stop` 或 `restart`**。停止服务需要按部署形态自己处理，卸载使用下方的 `uninstall` 命令。
:::

| 部署形态 | 停止方式 |
| --- | --- |
| Windows Portable | 关闭 `Start Neuro Book.cmd` 弹出的命令行窗口 |
| GHCR / 容器 | `docker compose --env-file .env -f .deploy/docker-compose.generated.yml stop` |
| Product Bun / Source | 终止 `neuro-book start` 所在的进程（前台 `Ctrl+C`） |

Manager v1 **不接管 systemd、pm2 或通用后台进程**。要开机自启或让服务在 SSH 断开后存活，需要自己写 unit / service。容器部署可以直接用 compose 的 `restart` 策略。

反向代理和 HTTPS 同样不在 Manager 职责内：把反代指向监听端口即可，注意放行 SSE（Agent 的流式输出依赖长连接，反代要关掉对应路径的缓冲）。

### PM2 服务器部署

本项目如果只在一台 Linux 服务器上以 Web 方式运行，可以把仓库根目录作为 Installation Root 和 State Root，用 PM2 托管 Product `.output`。这条路线不需要 Windows/macOS 本地安装包，也不需要 Electron/Tauri。

当前服务器约定如下：

| 项 | 值 |
| --- | --- |
| 仓库根目录 | `/www/wwwroot/book.neoshen.dpdns.org` |
| PM2 进程名 | `book-neoshen` |
| 监听端口 | `3001` |
| 公网入口 | `https://book.neoshen.dpdns.org` |
| State Root | `/www/wwwroot/book.neoshen.dpdns.org` |
| Cache Root | `/www/wwwroot/book.neoshen.dpdns.org/cache` |

PM2 配置应显式设置 `NEURO_BOOK_APPLICATION_ROOT`、`NEURO_BOOK_STATE_ROOT` 和 `NEURO_BOOK_CACHE_ROOT`。不要依赖 SSH 当前目录或临时 shell 环境来决定数据路径。

常用操作：

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
node -c ecosystem.config.cjs
pm2 start ecosystem.config.cjs --only book-neoshen
pm2 save
```

更新源码并重新构建后，用同一份 PM2 配置重启。PM2 7.0.3 在这台机器上执行 `pm2 restart ecosystem.config.cjs --only book-neoshen --update-env` 曾触发过 `Cannot read properties of undefined (reading 'pm2_env')`，可用删除再启动作为可恢复路径：

```bash
cd /www/wwwroot/book.neoshen.dpdns.org
pm2 delete book-neoshen
pm2 start ecosystem.config.cjs --only book-neoshen
pm2 save
```

重启前先确认没有迁移锁被其它存活进程持有：

```bash
scripts/clean-stale-lease.sh --dry-run
```

重启后执行服务器 smoke：

```bash
NEURO_BOOK_PUBLIC_URL=https://book.neoshen.dpdns.org \
NEURO_BOOK_PM2_NAME=book-neoshen \
PORT=3001 \
scripts/deploy/server-smoke.sh
```

该 smoke 只检查 PM2 online、端口监听、本地和公网版本接口、根路径 HTTP 状态以及 `nginx -t`。它不登录、不改数据、不重启服务。

Nginx 反代需要保留真实 Host，并关闭缓冲以支持 Agent 流式输出：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_buffering off;
```

如果公网版本接口返回 502，先查 PM2 状态、端口监听和最近错误日志：

```bash
pm2 status book-neoshen
ss -ltnp | grep ':3001'
pm2 logs book-neoshen --lines 80
```

## 更新与版本通道

```bash
neuro-book update                      # 按当前通道更新
neuro-book update --channel stable     # 切换到 stable
neuro-book update --channel canary     # 切换到 canary
```

Manager 只安装已经发布了正式 `release-manifest.json` 的完整 Release，仍在构建或已取消的版本会被安全跳过。**这意味着你实际装到的版本可能低于文档描述的最新版本**——用 `neuro-book status` 查当前实际版本。


::: warning 当前处于 canary 阶段
项目仍在快速迭代，已知问题包括：rootless Podman 环境下 `podman-compose stop` 会连带删除容器；Apple Silicon 上的 Docker / Podman 部署尚未实机验证。
:::
## 卸载与数据保留

默认卸载删除程序、Cache、Desktop/WebView 和日志，但保留 State Root 中的用户数据；外部 Project Workspace 永不删除。交互终端可确认执行，自动化或非 TTY 必须显式传入 `--yes`：

```bash
neuro-book uninstall --yes
```

只有明确需要删除托管 State Root 时才追加 `--delete-data`：

```bash
neuro-book uninstall --yes --delete-data
```

Windows Portable 或 Installed Windows 可能在退出当前 Manager 后由外置 Host 完成删除；使用 `--json` 时等待最终回执，不要把 `scheduled` 当作卸载已完成。

## 你的数据在哪

`NEURO_BOOK_STATE_ROOT` 是状态路径的真相源。默认 State Root 等于安装目录，Windows Portable 是安装目录下的 `data/`。

| 内容 | 路径（相对 State Root） |
| --- | --- |
| **你的作品**（正文、设定、世界引擎配置） | `workspace/{项目名}/` |
| 项目数据库（剧情结构、承诺、决策） | `workspace/{项目名}/.nbook/project.sqlite` |
| 文件历史（含全文快照） | `workspace/{项目名}/.nbook/history.sqlite` |
| 应用数据库（会话索引、账号） | `workspace/.nbook/neuro-book.sqlite` |
| 全局配置 | `workspace/.nbook/config.json` |
| 启动配置（端口、鉴权） | `config.yaml` |
| Agent 会话记录 | `workspace/.nbook/agent/` |
| 请求 trace（含完整 prompt 与正文） | `workspace/.nbook/agent/traces/` |
| 日志 | `logs/` |

**备份就是拷贝整个 State Root**。里面全是普通文件和 SQLite，没有外部依赖。恢复就是把目录放回去。注意 SQLite 有 WAL 文件，**热备份时不要只拷 `.sqlite` 而漏掉 `-wal` / `-shm`**，最稳妥是先停服务再拷。

这台 PM2 服务器的最小备份范围是：

- `workspace/`
- `config.yaml`
- `.env`
- `logs/`（可选，排障需要时保留）

冷备份流程是先停 PM2，再打包这些路径，最后启动服务并运行 smoke。热备份必须确保包含 SQLite 的 `-wal` 和 `-shm` 文件；否则恢复后的数据库可能缺最近写入。

正文和设定本身是 Markdown 文件，任何编辑器都能打开，不依赖 NeuroBook 才能读。

## 隐私边界

这一节请务必读完，尤其是打算把项目或日志发给别人之前。

**发给模型 Provider 的内容**：Agent 每次调用会把当前上下文（可能包含设定、正文片段、剧情结构）发送给**你自己配置的那个 Provider**，不经过 NeuroBook 的服务器。如果你启用了 embedding 检索功能，被索引的内容也会发给你配置的 embedding 服务端点。选服务商时请自行确认其数据使用条款。

**三类本地敏感文件**，按敏感度排序：

| 文件 | 含什么 | 分享风险 |
| --- | --- | --- |
| `traces/` | **完整 prompt 与小说正文** | 最高。默认保留每个会话最近 100 条，可在设置页「可观测」中关闭 |
| `history.sqlite` | **全文快照，包括你已经删掉的内容** | 高。项目下载包会包含它 |
| `project.sqlite` | 剧情结构、承诺、决策 | 中。不含正文 |

**可分享日志包是安全的**：`/api/app/logs/download` 导出的诊断日志包走白名单，**只包含日志和 manifest，不包含配置、数据库或作品正文**。报 bug 时用它，不要直接打包整个 State Root。

**项目下载包不是安全的**：它会包含 `history.sqlite` 的独立快照，也就是包含你删除过的内容。前端在下载时会提示这一点。要分享作品给别人看，直接发 `manuscript/` 下的 Markdown 文件。

## 排障

```bash
neuro-book status    # 当前实例状态与版本
neuro-book doctor    # 环境检查
```

日志在 State Root 的 `logs/` 下；容器部署看容器日志：

```bash
docker compose --env-file .env -f .deploy/docker-compose.generated.yml logs --tail 200 app
```

要让 AI 协助排障，把 [交付与运维桥梁](/operator-bridge) 发给它，那份文档专门写给运维 Agent。

## 继续阅读

- [部署方式](/deployment)：六种 Profile 的选择与边界。
- [快速开始](/quick-start)：最短安装路径。
- [交付与运维桥梁](/operator-bridge)：面向运维 Agent 的完整索引。
