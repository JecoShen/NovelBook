# Desktop Envelope

`desktop/` 是 NeuroBook 的根级交付宿主，不是主应用包。它把应用 Product 置于 Electron 或 Tauri 外壳中，并通过稳定的 Manager 与 contracts 入口执行安装、启动和退出编排。

## 边界

- `electron/`：Electron 主进程、preload、启动页和 Manager GUI。Renderer 只通过窄 preload bridge 消费宿主能力。
- `tauri/`：Tauri 原生外壳、WebView2 数据目录和 Windows 进程树收口。
- `shared/`：Electron、Tauri、Manager 和 Product 共同消费的可序列化桌面/安装/启动合同；不承载宿主实现。
- `packaging/`：Portable stage、Electron ASAR、Depot、manifest、摘要和安全审计。

UAC client 与 broker 的实现归 `packages/neuro-book-manager`，通过 `@notnotype/neuro-book-manager/desktop-uac-client` 等正式 subpath 消费；UAC 线协议归 `packages/neuro-book-contracts`。Desktop 不深导入应用源码，Manager 不深导入 `desktop/`。

## 入口与验证

- 边界正文：[`../docs/modules/monorepo-boundaries.md`](../docs/modules/monorepo-boundaries.md)
- Desktop 合同：`bun run test:desktop-contract`
- Manager 类型检查：`bun run manager:typecheck`
- Manager 构建与包检查：`bun run manager:pack`
- Electron 类型检查：`bun run --cwd desktop/electron typecheck`
- Electron 构建与安全审计：`bun run --cwd desktop/electron audit`
- Portable 安全审计：`bun desktop/packaging/security-audit.mjs`

真实 Windows Portable、签名安装器、Tauri 原生发布和人工浏览器验收属于平台交付门禁；未获得对应授权时只运行可复现的合同、类型和静态审计。
