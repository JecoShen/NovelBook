# desktop 目录规则

按改动文件只读取 [`../docs/standards/code/README.md`](../docs/standards/code/README.md) 中命中的桌面行：Electron TypeScript、Electron 宿主页面、Tauri Rust/config、Tauri 宿主页面、desktop shared/packaging 分别独立路由。

跨宿主改动合并对应组合；单宿主改动不读取另一宿主或语言规范。完成标准由所选分支文件定义。