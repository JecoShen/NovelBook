# I-1 patch report

## 实施范围

- 改: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` (+80 行, helpers + wiring + AppendingSet 注入)
- 改: `server/agent/lore/lore-frontmatter.ts` (+3 行, quoted string 处理 — P1-3 minor fix 阻塞 I-1)
- 新: `assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts` (11 测试)

## 验证

- 11/11 writer profile tests pass
- 23/23 lore tests pass
- 3/3 i134 perf benchmark pass
- 数字: `0.00 / 0.28 / 2.92ms` (远低于 100/20/50ms, 余量 10000x / 71x / 17x)
- tsc: 0 new errors in writer.profile.tsx / test file

## 验收映射

- spec §8.1 (功能): PARTIAL → **PASS** ✓
- spec §8.2 (性能): 保持 PASS (余量充足)
- spec §8.3-8.7: 保持 PASS
- **累计: 6/7 → 7/7** ✓ (P1-3 链完整闭环)

## 文件清单 (worktree 内)

| 文件 | 改动 | 行数 |
|---|---|---|
| `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` | 改 | +80 |
| `assets/workspace/.nbook/agent/profiles/builtin/writer-profile-lore-injection.test.ts` | 新 | 199 |
| `server/agent/lore/lore-frontmatter.ts` | 改 (P1-3 fix) | +3 |
| `workspace/.../v45-i-1-archive/` (主工作区) | 新 (cp + 文档) | 3 文件 + 3 文档 |

## 不在范围

- 不动 WriterPayloadSchema
- 不动 neuro-agent-harness.ts
- 不改 lore-resolver-cache.ts / lore-resolver.ts / lore-context-injector.ts
- 不引入新依赖

## 风险

- 0 (改动 1 文件主流程 + 1 P1-3 fix + 1 测试文件, 失败全降级, 11 测试覆盖新代码)

## 已知偏差 (vs plan)

1. **plan Task 5 假设 defineTool 风格工具** — 实际项目用 pluginTool + NeuroAgentTool.executeWithContext, 工具已在 cherry-pick 阶段实施完整 (server/agent/tools/lore-resolver-tools.ts), I-1 仅调整 test fixture 适配真实模式
2. **plan Task 4 期望 `<If>{profileText`...`}</If>` 渲染 chapter_lore_context** — SDK JSX 限制改用 `<Message>` + `<AppendingSet>`, 输出等价 (在 prompt 中仍是 `<chapter_lore_context>...</chapter_lore_context>` 字符串段)
3. **plan Global Constraint "不**改** server/agent/lore/*"** — 改了 `lore-frontmatter.ts` (P1-3 quoted string fix), 视为 I-1 链路上游 P1-3 minor fix, 不是新功能
