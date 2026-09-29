---
schema: nbook.task/v2
taskId: t01-fingerprint-dir-windows-safe
role: tasker
---

# 指纹目录名 Windows 合法化

## 目标

`projectionFingerprint` 输出从 `sha256:<hex>` 改为 `sha256-<hex>`，消除 Windows 文件名非法字符（`<>:/\|?*` 中唯一命中的冒号），解开 release-container product-windows 红。

## 范围

- `source-authoring-type-cache.ts` 三处：`:503` 返回格式、`:521` `isFingerprint` 正则、`:9` schema v1→v2（旧冒号目录成孤儿，GC 既有逻辑收敛；缓存可丢弃零迁移）。无 split/slice 字符串消费点（已全仓 grep）。
- 测试（TDD）：`source-authoring-type-cache.test.ts` `:136`/`:150` 格式断言与 `:251` 伪造指纹先改 dash 形态跑 RED，再改源码转 GREEN；首处断言注释写明 Windows 文件名禁冒号的来历（防回退）。
- 附带收益：`:251` 伪造目录用例此前在 Windows 上连建目录都会失败，同根同愈。

## 验收

1. 格式断言 RED→GREEN；`source-authoring-type-cache.test.ts` 全绿。
2. runtime 相关套件（runtime/*.test.ts + runtime-artifact-compiler-context.test.ts）绿。
3. typecheck 八层无新增；eslint 改动文件计数不升。
4. push 后重切 canary，release-container product-windows 转绿、资产组装完成（切版动作属 Work 范围，记录在 Work walkthrough）。
