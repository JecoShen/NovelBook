// `export {}` 让本文件成为模块：fixture 之间同名的顶层 const 否则会共享全局作用域，
// 在任何同时包含多个 fixture 的 tsconfig 下报 TS2451 重复声明。
export {}

const exitCode = Number.parseInt(process.argv[2] ?? '0', 10)

process.exit(Number.isInteger(exitCode) ? exitCode : 1)
