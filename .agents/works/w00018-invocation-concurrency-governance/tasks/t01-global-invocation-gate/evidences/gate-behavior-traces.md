# w00018 t01 实证记录：并发闸行为轨迹

- 日期：2026-09-28；机器：生产同机（负载常态）。
- 全部轨迹产自 vitest 集成测试与一次临时插桩探针（插桩文件跑完即删，未入库）；最终断言以入库测试为准。

## 8 并发跨 session 闸快照轨迹（插桩实测，默认配置 max=2/reserved=1）

8 个 session 同时 invoke（探针工具阻塞在运行段内），700ms 间隔采样：

```text
t=0~3  active={interactive:2, total:2}  queue={interactive:6, total:6}  faux 响应余量 14
       → 放行（open）
t=4    settle[2]/settle[4] completed；新一对 probe enter（active 回到 2）
       queue 降为 4；faux 响应余量 10（每 run 恰好消耗 toolCall+done 各 1）
t=4~9  active 恒 =2、queue 恒 =4（探针阻塞等待下一轮放行——测试编排结束点）
```

- 全周期 active.total 从未超过 2（配置上限），探针 maxActive=2。
- drain 在每次 release 后按 FIFO 准入下一对；8 个 invocation 最终全部 completed，闸 totals：queued=6 / acquired=8 / released=8 / timeout=0（入库测试断言）。

## 超时与降级实证

- 排队超时（集成测试，config max=1/acquireTimeoutMs=1000）：B 在 A 持槽期间排队，1s 后返回 `status:"error"`、`errorPhase:"pre_loop"`、`errorInfo.code=AGENT_INVOCATION_CONCURRENCY_LIMIT`、`retryable:true`；A 正常 completed。
- 槽位泄漏三路径（集成测试）：运行中 abort / provider error stopReason / input.signal 断开，每路径后 `snapshot().active.total === 0`。
- 配置热读（集成测试）：max=1 时 B、C 排队 → 改写 config max=2（免重启）→ A 完成触发 drain → B、C 同轮双双准入（探针并发=2；旧上限下本轮只能准入 B）。
- fail-closed（单测）：readLimits 抛错 → 内置默认 2 槽生效，闸保持可用。
- normalizer 下界守卫实证（调试插曲）：测试写 `acquireTimeoutMs:300` 被 fail-closed 为默认 60s（下界 1000ms），排队超时按 60s 计——印证下界守卫生效，测试改用 1000。

## 测试与门禁汇总（最终态）

| 面 | 结果 |
|---|---|
| 闸单测 `invocation-concurrency-gate.test.ts` | 9/9 绿 |
| harness 集成 `invocation-concurrency.integration.test.ts` | 4/4 绿 |
| harness 目录全量（含存量 465KB 主套件 + black-box） | 25 文件 377 测试全绿 |
| tools / workflow-port / server/config | 7 文件 106 全绿 |
| workflow / api/agent | 29 文件 152 全绿 |
| shared/dto / http / bridge 路由+registry | 42 + 45 + 13 全绿 |
| typecheck:layers | 八层聚合退出码 0 |
| lint:ratchet | 2145 / 1513 与基线持平 |
| docs:check / governance:check | 6081 零 failure / 零告警 |
