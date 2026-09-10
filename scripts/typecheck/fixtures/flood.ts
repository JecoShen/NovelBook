// 输出上限 fixture：先写 head 标记，再写指定 KiB 的填充行，最后写 tail 标记。
// 用于证明超出上限时保留尾部、丢弃头部并标注截断。
// `export {}` 让本文件成为模块，避免与其他 fixture 的同名顶层 const 撞全局作用域（TS2451）。
export {}

const kibibytes = Number.parseInt(process.argv[2] ?? '8', 10)
const filler = 'x'.repeat(1_023)

process.stdout.write('head-marker-first\n')
for (let index = 0; index < (Number.isInteger(kibibytes) ? kibibytes : 8); index += 1) {
  process.stdout.write(`${filler}\n`)
}
process.stdout.write('tail-marker-final\n')
