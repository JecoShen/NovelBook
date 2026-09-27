# shouldCompact 修正前后对照（p-009 A4 / w00017 t01 验收 3）

2026-09-24 实测，估算函数为落地后的真实实现（`bun --cwd packages/neuro-book -e` 直接调 `estimateStoredContextTokens`）。

## 场景

同一 CJK session：assistant 有效 usage = 80,000 tokens（provider 真实值），trailing 一条 60,000 字符的中文正文消息（章节规模）；`contextWindow = 128,000`，`reserveTokens = 16,384`，触发线 = 111,616。

## 对照（真实输出）

| 口径 | trailing 估算 | 上下文总量 | shouldCompact |
|---|---|---|---|
| 旧（chars/4） | 15,000 | 95,000 | **false（不触发）** |
| 新（CJK 1.5 + overhead 4） | 40,004 | 120,004 | **true（触发）** |

同一 session 下旧口径离触发线还差 16,616 tokens（实际只剩 11,616），把溢出风险转嫁给 provider 侧 400；新口径正确触发压缩。

## 触发点迁移

以本场景 usage 固定 80,000 计，trailing 纯 CJK 正文的触发点：

- 旧口径：≈ 126,464 字符（约 12.6 万字，且已越过真实窗口安全线）
- 新口径：≈ 47,418 字符（约 4.7 万字）

压缩触发提前约 62%，与「chars/4 对 CJK 重内容低估 ≈2.4 倍」的实测结论互为印证（2026-09-23 traces 校准：CJK 重文本 1.69 字符/token）。

## 结论

修复方向与预期一致：usage 优先语义不变（80,000 真实值原样采用），只有 trailing 本地估算被修正；CJK 主场景下压缩触发显著提前，属修复效果而非回归。
