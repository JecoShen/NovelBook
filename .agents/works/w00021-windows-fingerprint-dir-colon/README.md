---
schema: nbook.work/v1
workId: w00021-windows-fingerprint-dir-colon
issueId: null
---

# Windows 类型投影指纹目录名冒号修复

0.10.3-canary 切版（d8f28f16）product-windows job 红的根因修复（2026-09-30 代码实证，开发者路由立项）：

`source-authoring-type-cache.ts:503` `projectionFingerprint` 返回 `sha256:<hex>` 并原样用作缓存目录名（`:183` `join(authoringRoot, fingerprint)`），冒号在 Windows 文件名非法，vitest global-setup 的 staging→target rename 抛 ENOENT。type cache 9/13 落地后 fork 发布首次跑 Windows 才暴露（fork CI 矩阵仅 linux-x64-glibc）；矩阵门禁致 assemble/verify 全 skipped，draft 发布 0 资产。

## 范围

- t01：指纹格式 `sha256:<hex>` → `sha256-<hex>`（`projectionFingerprint` 返回值 + `isFingerprint` 校验正则 + `SOURCE_AUTHORING_TYPE_CACHE_SCHEMA` v1→v2 使旧冒号目录成孤儿由 GC 收敛）；测试三处格式断言同步 + Windows 合法性合同注释。缓存可丢弃，零迁移。
- 修复落地后重切 0.10.3-canary（RELEASE.md 修复段补一条），验证 release-container product-windows 转绿与资产组装。
