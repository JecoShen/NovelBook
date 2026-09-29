---
schema: nbook.task/v2
taskId: t01-kit-cli-output-root-guard
role: tasker
---

# kit 构建 CLI 输出根守卫

## 目标

`scripts/build/product-authoring-kit.ts` 与 `scripts/build/product-command-bundle.ts` 的 `import.meta.main` 块加两层守卫，消除 9/28 生产覆盖事故（`server/authoring/**` 529 文件被默认 `.output` 兜底覆盖）的再现面。

## 范围

- 两 CLI 主块：`parseArgs({allowPositionals: false, strict: true, options: {}})` 拒绝一切位置参数与未知 flag（先例：`check-product-runtime-policies.ts:32`、`client-chunk-budget.mjs:132` 等四处）；`NEURO_BOOK_OUTPUT_DIR` 缺失或空白即抛错，文案对齐 `product-runtime-bundle.ts:417-420`「必须由 Product Runtime Image Builder 注入」并附本地测量用法指引。
- 管线零改动：两函数由 `patch-nitro-runtime-deps.mjs:14-15` import 直调（显式传根），Builder spawn 链显式注 env（`build-product-runtime-image.ts:107-114`、`patch-nitro-runtime-deps.mjs:58-60`），守卫只影响裸跑。
- 测试：`product-authoring-kit.test.ts` 补两个 spawn 用例——带位置参数非零退出；缺 env 非零退出且 stderr 命中守卫文案。
- RED 说明：两用例的 RED 态即 9/28 生产事故实测（已留档），裸跑会真实覆盖 `.output`，不在主工作区重放危险操作；采用修复与测试同批、跑 GREEN 验证。

## 验收

1. `bun scripts/build/product-authoring-kit.ts /tmp/x` 非零退出，零写入。
2. 无 `NEURO_BOOK_OUTPUT_DIR` 裸跑两 CLI 均非零退出，报错含 env 名与注入语义。
3. `NEURO_BOOK_OUTPUT_DIR=<tmp>/.output` 显式调用成功（happy path 不破）。
4. `product-authoring-kit.test.ts` 全绿；`bun x tsc --noEmit -p scripts/tsconfig.json` 通过；lint 棘轮不升。
