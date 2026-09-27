# w00016 t01 walkthrough：可插拔检索器 + shadow 双跑（p-008 阶段 1）

2026-09-27 Tasker 实施。范围：planned Spec + 检索器抽象 + memory 检索器与索引生命周期 + shadow 双跑观测 + 配置闸登记链。

## 实现

- **Spec**：`docs/specs/agent/writer-lore-context.md`（capability `agent.writer-lore-context`，status planned），现状 trigger 行为与新检索路径写成同一份合同（输入/输出/索引生命周期四态/三级退回/预算/验收 6 条）；`docs/specs/README.md` 待实现规范登记。实现合同节保持黑盒（不指定模块文件名，符合 planned Spec 约束）。
- **检索器 dispatch**：`server/agent/lore/lore-retriever.ts` 的 `resolveChapterLore`——与 `resolveForChapter` 同形输入输出，按配置闸分发。`trigger` 原样透传（默认行为逐字节一致的结构性保证）；`shadow` 注入=trigger 结果，观测 fire-and-forget；`memory` 用 nb-memory 召回进注入，任一失败自动退回 trigger 并记 `fallbackToTrigger`。`lore_resolver_query` 工具不经过本模块（p-008 非目标）。
- **memory 检索器**：`server/agent/lore/lore-memory-index.ts`。卡片清单复用 trigger 索引（enabled/title/triggers 单一事实源）；每卡 header fact（title/triggers/summary）+ 正文空行切段（≤32 段 × ≤2000 字符）facts 直报零 LLM；`meta={lorePath,kind,cardHash}`，refId 内容寻址。nb-memory append-only 无删除 → 卡片变更以新 hash 追加新代，manifest（`.nbook/memory/lore-manifest.json`）记当前代，归并时按当前代过滤旧代；未变卡片零重嵌（验收 4 的「增量」语义）。摄入恒 `deferEmbedding`：落库即字面可召回，向量后台 backfill 渐进补齐，`pendingVectors>0` 即语义降级期。索引未建/构建中不阻塞写作（后台单飞构建，退回 trigger）；刷新节流 30s；构建失败重试节流 60s；每项目操作串行链；实例 LRU≤8。
- **嵌入复用**：`resolveWorldEmbedding`/`embedTexts`（EmbeddingServiceConfig 现成通道）；未启用/配置不完整 → NullEmbedPort 纯字面路零网络。查询 embed 每次注入至多 1 次（nb-memory 门面复用同一个 queryVec）；`MEMORY_SEARCH_TIMEOUT_MS=2000` race 超时降级（p-008 决策 3）。apiKey 只经既有配置通道进 HTTP client；单测断言错误信息不含 key。
- **观测日志**：`server/agent/lore/lore-shadow-log.ts` → 项目 `.nbook/state/lore-retriever-shadow.jsonl`（对齐 lore-carryover 项目级 jsonl 先例；best-effort，写失败只 warn）。字段含两路最终路径、memory rawPaths、diff（onlyTrigger/onlyMemory/common）、两路延迟、pendingVectors、fallback 标记——即后续 ≥20 次对照评审的数据合同。
- **配置闸**：`agent.loreContext.retriever`（`trigger|shadow|memory`，默认 `trigger`），登记链对齐 piTrace 先例：`shared/dto/config.dto.ts`（Global+Update 两个 zod schema）→ `server/config/types.ts`（`LoreRetrieverMode`/`LoreContextConfig`）→ `server/config/normalizer.ts`（非法值 fail-closed 回落 trigger；v1 global-only 不读 project 节）→ 重生成 OpenAPI meta（4 条路由嵌入 global agent schema 而连带更新：global.put/editor-snapshot.get/profile-home reset/project.put）。
- **接线**：`profile-sdk/lore.ts` 再导出 `resolveChapterLore`（白名单已含该子入口）；`writer.profile.tsx` 的 `renderChapterLoreContext` 切换到新入口（同签名，默认行为不变）；`packages/neuro-book/package.json` 与根 `package.json` 双侧加 `@notnotype/nb-memory: workspace:*`（对齐 nb-history 先例），bun.lock 更新。

## 验收证据

1. **trigger 逐字节一致**：单测 `resolveChapterLore(trigger)` 与 `resolveForChapter` 同输入结果逐点 deep-equal；渲染管线零 diff（未触碰）。✓
2. **shadow 双跑与降级**：集成测试覆盖——注入=trigger；日志含 memory 召回与两路 diff；索引未建（building）/检索抛错/超时（黑洞端点单测）均自动退回 trigger 不阻塞。✓
3. **延迟预算**：本机基准 120 迭代（61 卡 / 16.9KB 扫描文本）字面路 recall p95=20.24ms < 50ms；端到端新增 ≈19ms；语义超时降级单测（200ms race 命中 timeout，embed 自身 1500ms 未到）。✓ 详见 `evidences/literal-path-latency-benchmark.md`。
4. **索引失效**：卡片编辑增量重嵌（facts 恰好 +3 = 变化卡新代条数，未变卡零新增；命中 refId 全属当前代 hash）；删除 `.nbook/memory/` 后重建成功且召回正常；卡片删除后不再被召回。✓
5. **配置闸回 trigger**：归一化测试（默认 trigger/合法值生效/非法值 fail-closed/project 不遮蔽）+ dispatch 测试（缺省 config 无 shadow 日志，写 config 后 shadow 生效）。✓
6. **测试**：lore 套件（bun:test）46/46 绿（新增 11 用例：索引生命周期 4 + dispatch 6 + 超时 1 + 截断 2）；`server/config` vitest 84/84 绿（新增归一化 4 用例）；`profile-artifact-dependency-gate` 绿。新文件分层 typecheck 登记：`lore-shadow-log.ts` 入 agent-support 层，`lore-retriever.ts`/`lore-memory-index.ts` 入 agent 层（二者依赖 agent 层的 config-service/world-embedding，agent→agent-support 单向引用合法）。✓

## 门禁

- `typecheck:layers` 八层聚合退出码 0（两次全量，最终态一次）。
- `lint:ratchet` 2145 error / 1513 warning，与基线持平（新文件零新增）。
- `docs:check` 6075 文件零 failure（初次缺少「副作用与数据」「验收与 Smoke」节名，已按规范改名）。
- `governance:check` 零 failure 零 warning。

## 偏差与决定

1. **观测日志落点**：Task 写「对齐 piTrace 观测面」。落地采用项目级 jsonl（lore-carryover 先例）而非 piTrace 桶机制——shadow 数据是项目 lorebook 的检索对照，per-project 隔离与可审查性更强，体积有界（每次 invoke 一行）。判断属 Tasker 等价实现细节。
2. **memory 模式观测**：primary 成功路径的日志 await 落定再返回（检索成本已付，本地追加可忽略），保证切换评审数据确定性；shadow 模式保持全链路 fire-and-forget（观测不拖慢注入）。
3. **旧代过滤位置**：nb-memory 无删除 API（事实源 append-only 设计）。旧代 facts 不物理清理，归并时按 manifest 当前代过滤——增长有界（lorebook 编辑频率 × KB 级 facts），重建（删目录）即收敛。
4. **SDK 签名接线**：`profile-sdk/lore.ts` 的 `resolveChapterLore` 签名显式锚定 lore-resolver 轻量类型而非 `typeof` 宿主函数——宿主 lore-retriever 的运行时重图（config-service/world-embedding/nb-memory）不属于作者可见声明图。authoring 类型投影注册 lore-retriever stub（`AUTHORING_RUNTIME_TYPE_STUB_FILES` 第 6 个，对齐 profileHomeResource 先例）并把投影 schema bump v3→v4（文件清单类常量变更必须 bump，2026-09-13 教训写在源码注释里）。投影产物实测：`lore.d.ts` 只引用 lore-resolver 轻量声明，types/ 下无 config/world-engine 目录。
5. **顺带修复（独立提交）**：`scripts/build/generate-openapi-meta.ts` 的 `applicationRoot` 在 monorepo 拆包移位后指向 `scripts/`（应为包根），生成器 37 路由全量 File not found 静默失效（上次 piTrace meta 更新疑为手工同步）。修一行 + 重生成；20 个路由文件的存量空白差异一并 canonical 化。该修复与本 Task 配置闸重生成互为依赖，但性质独立，拆 `fix(scripts)` 单独提交。

## 观察（非本 Task 范围）

- **`leader-assets-profile.test.ts` 的 leader.default 用例在本机 20s 超时**：三次复现；关键 A/B——全量 stash（干净 HEAD c27124cc）同样失败，与本 Task 改动无关，定性为 HEAD 既有环境级超时（9/22 CI 四流水线全绿，疑本机负载/冷缓存；下次 push 需盯 Full tests 首跑）。
- shadow 双跑的真实 invoke 对照数据（≥20 次门槛）自部署后 shadow 模式开启时开始积累；配置闸翻转与 primary 切换评审是后续 Task + 独立授权。
- 生产生效前提：writer profile 是装机期物化资产，部署时需同步 state root 资产（restart 不自动同步，r18 教训）；部署后 profile compile --all 普查（9/13 事故教训）。

## 未运行项

- 真实 Provider/Model 的语义路 e2e（需真实 embedding 端点授权）：字面路与超时降级已覆盖，语义召回质量留 shadow 期生产对照。
- 浏览器人工验收：无前端可见面变更（配置项暂只能经 config.json/PUT API 设置，配置编辑器 UI 曝光不在本 Task）。
- `leader-assets-profile.test.ts` 全文件本地未转绿（既有超时，见观察节）；CI 首跑待 push 后核对。
