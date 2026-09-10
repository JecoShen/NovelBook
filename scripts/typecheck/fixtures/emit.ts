// 输出捕获 fixture：往 stdout 写指定文本、往 stderr 写固定标记，再以给定退出码结束。
// 不调用 process.exit()：管道上的 stdout 是异步的，提前 exit 会截断输出，
// 让"捕获丢数据"和"fixture 自己没写完"两种失败无法区分。
// `export {}` 让本文件成为模块，避免与其他 fixture 的同名顶层 const 撞全局作用域（TS2451）。
export {}

const message = process.argv[2] ?? ''
const exitCode = Number.parseInt(process.argv[3] ?? '0', 10)

process.exitCode = Number.isInteger(exitCode) ? exitCode : 1
process.stdout.write(`${message}\n`)
process.stderr.write('stderr-marker\n')
