# 更新日志

这里只放当前版本。更早的版本见 [中文 changelog](vitepress/locales/zh-Hans/changelog/) 与 [English changelog](vitepress/locales/en-US/changelog/)。

## 0.10.3-canary（限量 canary） - 2026-09-13

这一轮完成仓库从单体到 12 个 workspace 包的拆包迁移收口，恢复迁移中被覆盖的运行时接线与质量门禁，并带来 Agent 会话中止持久性合同、lore 写作注入与一批上游 UI 修复。它仍是限量 canary。

### 新功能

- Agent 写作链路接入 lore 解析与注入：章节写作提示词自动携带 lorebook 上下文，支持三章法滑动窗口的 carryOverPaths 记忆，lore 缓存带 TTL 与 LRU 上限。
- llmlint 新增中文结构「场景六问」软提示规则，以及场景总表、关系/状态等跨实体模板。

### 改进

- Source Authoring 类型投影缓存落地：Profile 与写作 SDK 的类型检查按内容指纹复用投影，Authoring 链路的类型检查成本显著下降。
- Agent 会话中止（abort）持久性合同移植收口：取消、清队列与断线恢复行为按 SSE 合同一致，附 33 项合同测试（上游 t159 fork-native 移植）。
- 通知卡片改用主题状态色并满足 WCAG AA 对比度；Provider 列表长滚动保持可见；剧本编排面板窄视口自动换行；Profile 编辑器按钮补 Tooltip、响应式布局与嵌套主题宿主防御（上游移植）。

### 修复

- 恢复拆包整树合并覆盖的 Source Authoring 类型投影接线；修复投影加载器并发打开时的 ELOCKED 文件锁错误（按 cacheRoot 进程内串行化）。
- 修复 Source 投影根与仓库根耦合导致的运行时不稳定；投影模块改为编译期解耦，Product Authoring Kit 与 Product 镜像构建恢复通过。
- 修复 external-cli 调用方三处类型定义在整树合并中被收窄的问题。
- 修复 lore-carryover 使用相对项目根导致的 lore-writer-proj 目录泄漏。
- 修复 summarizer 写回中断：profile-sdk 暴露 writePlan session_update 与 readTitleOwner，14/14 内置 Profile 恢复 0 违规。
- 修复 Product Runtime 在 stdio 破损（EPIPE）下的隔离问题（上游 #230）；修复 Manager 打包产物的 Node 兼容导入（上游 #231/#232）。
- llmlint 规则漂移修平：title 守卫、calibration fixture、manual 计数，并同步到产品 workspace 投影。

### 内部维护

- 仓库从单体拆分为 12 个 workspace 包并完成 fork 适配；恢复被合并抹掉的门禁：lint（stylistic 关闭）、分层 typecheck 八层、docs:check 清零、代码门禁覆盖 main 直推；Full tests 单 worker 串行首次完整全绿。
- 清理公开仓历史用户数据残留；生产 PM2 配置显式声明 Application/State/Cache Root 并关闭进程内 APM（Bun 下每 800ms 空烧半核）。

### 升级须知

- 这是限量 canary。升级前请备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`；先在可丢弃的 Project 上测试。
- 本版本无数据库 schema 迁移：`packages/neuro-book/prisma/` 自上版部署以来零改动。
- 真实外部 Provider 连接与完整 Agent/Workflow 浏览器流程验收仍未完成；不要把自动化门禁结果当成人工全流程验收。

## 0.10.2-canary（限量 canary） - 2026-09-08

这一轮修复 0.10.1-canary Windows Portable 发行包在无构建机 `node_modules` 环境首轮启动失败的问题，并继续覆盖 Windows Product/Portable 运行边界。

### 修复

- 修复 Windows Portable 内置 Manager 将 `yaml`、`semver` 留作外部依赖，导致干净解压目录启动时报 `Cannot find package 'yaml'` 的问题；Manager 单文件现在内联生产依赖，Portable 首轮启动不再依赖构建机 `node_modules` (#225)。

### 内部维护

- 收紧 Manager pack 门禁，真实在无 `node_modules` 的隔离目录冷启动单文件 bundle，防止外部依赖回归。

### 升级须知

- 这是限量 canary。请使用本版本替代 `0.10.1-canary` 的 Windows Portable 资产；升级前备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`，先在可丢弃的 Project 上测试。
- 真实 exFAT 120 秒租约观察未在本机执行；Product/Portable 的本地受控 smoke 不替代真实文件系统和真实 Provider/Model 验收。

## 0.9.7-canary（限量 canary） - 2026-08-25

这一轮修复 Podman 环境下容器方式安装与更新在迁移规划阶段崩溃的问题，并让发布流水线同时真机验收 `podman-compose` 与 `podman compose` 委托两条路径。它仍是限量 canary。

### 修复

- 修复 macOS/Linux 上用 Podman 以「Docker / GHCR」方式安装时，podman-compose 在迁移报告前输出的裸容器 ID 导致 Manager JSON 解析失败、容器 Profile 完全不可用的问题；Manager 现在从首个 JSON 行解析报告，并在独立 provider 缺失时保留用户环境、允许 `podman compose` 自行委托 (#110)。
- 修复 monorepo 收敛后 Manager npm 包携带干净环境无法解析的内部 `file:` 生产依赖导致发布包安装失败的问题；contracts 已在构建期内联进单文件 bundle 并新增打包守卫 (#179)。
- 修复 Manager 单文件 bundle 在复制到无构建机 `node_modules` 的环境后打开 TUI 时读取构建机绝对路径的问题；现在将 Blessed 运行时代码与必要 terminfo 资源纳入发布 bundle，并由打包门禁覆盖复制后 `bun --no-install` 启动 (#224)。
- 修复 Vite 依赖预优化下拖拽初始化失败：`@dnd-kit/vue` 改用其内置 preset，避免双 Scroller 类身份冲突 (#164)。
- 修复 Agent Provider 模型发现的代理安全、`file:` URL 拒绝与 Google `input: ["text"]` 合同问题 (#101)。

### 改进

- 「新建世界书条目」类型选择弹窗改为卡片化设计，取消操作不再混同于类型选项 (#113)。
- 发布流水线新增 Podman 委托路径验收 job：PATH 屏蔽 podman-compose 后完整执行安装→迁移→管理员→登录→健康检查→停止/重启→Operation 恢复链路，双 provider 路径每次发版都有真机证据 (#168)。

### 内部维护

- 发布工具链：manager-release 的类型检查指向应用 workspace (#172)；bun.lock 的 workspace file 描述符保持 POSIX 分隔符并加契约守卫 (#181)；部署 Operation ID 校验去重 (#166)；release workflow 精简 (#122)；stripFrontmatterBody 抽取复用 (#115)；任务文档记录 (#180)。

### 升级须知

- 这是限量 canary。升级前请备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`；先在可丢弃的 Project 上测试。
- 本版本要求 Manager `0.1.0-canary.58`。Manager canary.55/.56 是未通过发布门禁的审计记录，没有公开包。


## 0.9.6-canary（限量 canary） - 2026-08-14

这一轮把 Windows x64 桌面 beta 收口为可复核的内部候选包，并修复跨平台发布与 Agent 取消测试中的可靠性问题。它仍是限量 canary：现有公开发布流程提供五平台 Product、Windows Portable、Source、安装脚本、manifest、SHA256SUMS 和容器镜像；Electron Desktop ZIP/Depot 仍是内部 beta 产物，不是签名安装器。

### 新功能

- Windows x64 桌面 beta 支持当前用户安装、全局安装和 Portable；安装管理器提供安装、校验、迁移、修复、卸载和本地 Product 生命周期，Provider 配置可在引导流程中完成。该 beta 未承诺公开签名安装器、自动更新或 macOS 应用包 (#88)。

### 改进

- 桌面安装、修复和卸载共用同一套状态与权限边界；普通卸载默认保留用户 State Root，只有明确选择同时删除数据时才清理作品、配置和账号信息 (#88)。

### 修复

- 修复干净 Windows 上 PowerShell 5.1 读取引导脚本、缺少 VC++ Runtime，以及超过 MAX_PATH 的卸载目录导致安装或卸载失败的问题；发行包现在对这些输入和路径 fail closed 或使用 app-local 运行库 (#88)。
- 修复 Agent 取消黑盒测试的同步竞态：测试现在等待 Provider 真正取走挂起响应后再取消，并在结束时释放 gate，避免新 invocation 误取旧响应而撞上 30 秒超时 (#99)。
- 修复 Windows Portable 构建下载 GitHub Release 资产遇到正常临时 302 重定向时失败的问题；Manager 0.1.0-canary.54 现已通过公开 provenance 校验 (#103)。

### 内部维护

- 将只在 Bun 运行时可执行的部署测试移出 Node 根测试套件，改由专用 Bun 门禁执行，避免 `Bun is not defined` 污染全量测试 (#96)。

### 升级须知

- 这是限量 canary。升级前请备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`；先在可丢弃的 Project 上测试。
- 公开 Windows ZIP 是现有 Portable/Manager 发布包，不是 Electron Desktop ZIP；内部 beta 的 Electron Portable/Depot 不代表签名安装器、后台 updater 或最终 Desktop 框架选择已经完成。
- 真实外部 Provider 连接、完整 Agent/Workflow 浏览器流程、macOS 实包、原生 Snap 和公开签名仍未完成；不要把自动化门禁结果当成人工全流程验收。
- 桌面安装卸载默认保留用户 State Root；需要连同作品、配置和账号一起删除时，必须明确选择“同时删除数据”，并先备份重要数据。
