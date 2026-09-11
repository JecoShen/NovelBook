// 本仓默认分支是 main，上游 notnotype/neuro-book 用 master。
// 整树跟随上游合并会把分支名带回 master，而本仓不存在该 ref，后果分两种且都不报错：
// push 型 workflow 的分支过滤失配后静默不触发；作用域探测里的 merge-base 解析失败后整步失败，
// 连带 typecheck 与 tests 被跳过。两种都表现为"门禁看起来在，实际从不执行"。
// 因此凡是断言本仓分支名的校验器与合同测试都从这里取值，改这一处即可保持同步。
// 注意：.github/workflows/*.yml 无法引用本常量，其分支过滤由
// scripts/ci/workspace-workflows.test.ts 的合同测试反向校验。
export const DEFAULT_BRANCH = "main";
