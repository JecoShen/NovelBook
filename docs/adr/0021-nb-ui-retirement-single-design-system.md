# ADR 0021：nb-ui 废弃与单一设计系统

- 状态：Accepted
- 日期：2026-09-22
- 决策者：开发者
- 关联：2026-09-20 全量架构审查 P1-7/P1-9（`.local/architecture-review-2026-09-20.md`）、[w00003](../../.agents/works/w00003-neurobook-ui-foundation-migration/README.md)、[w00014](../../.agents/works/w00014-p1-architecture-convergence/README.md)

## 背景

仓库内双设计系统并存：

1. **应用内基元 + 8 主题**（`packages/neuro-book`，AGPL）：前端 critique 六步程序（24→32/40）的全部 UX 投资都在这套系统上，生产在用。
2. **`packages/nb-ui`**（PolyForm-Noncommercial-1.0.0）：完整设计系统但与主应用零集成（全仓 grep 零消费者，唯一命中是 legacy task 文档）；w00003（UI 底座迁移到 nb-ui）立项后零进展。

两项结构问题：a) PolyForm-Noncommercial 与主应用 AGPL 存在许可证冲突，接入前必须先裁决；b) nb-ui 占 CI matrix 最重的一格（test + typecheck + build:css + build），每次 CI 为未接线资产付费。

候选方向：a) 继续 w00003 迁移（先改授许可再逐片接入，工程量大且要重做 8 主题与 critique 投资）；b) 废弃归档；c) 只改许可不迁移（半死状态延续，CI 成本照付）。

## 决策

开发者 2026-09-22 拍板：**废弃/归档 nb-ui**。

1. NeuroBook 的单一设计系统是**应用内基元 + 8 主题**；UI 演进全部发生在 `packages/neuro-book` 内。
2. `packages/nb-ui` 归档：从根 `workspaces` 与 CI matrix 移除，不再参与 install、typecheck、CI；目录原地保留并加归档说明，代码不进产物、不进认知面。
3. 许可证冲突随废弃消解（不再有接入 AGPL 产品的路径）；不做改授，因为接入方向已否决。
4. w00003 按本决策收口，其迁移切片与验收合同工作不再推进。

## 后果

- CI 与 install 面卸下最重的一格未接线资产；`bun install` 不再链接 nb-ui 依赖子树。
- 双设计系统并存的显性债务消除；前端演进单轨。
- 归档目录保留在 git 历史与 checkout 中，未来若重启共享 UI 底座（如多应用形态）可取回，但须先重新评估许可与彼时设计系统格局。

## 重开条件

出现以下任一情况时重新评估（新开 ADR）：

- NeuroBook 衍生第二个前端应用，共享 UI 底座成为真实需求；
- 应用内基元出现系统性重构需求，且评估认为以 nb-ui 为基础比原地演进成本更低。
