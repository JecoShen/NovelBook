---
schema: nbook.work/v1
workId: w00018-invocation-concurrency-governance
issueId: null
---

# Agent Invocation 并发治理

p-010（2026-09-24 accepted）的实施 Work。目标：invokeCore 全局有界槽位（interactive/background 分级、FIFO 有界排队、超时拒绝）、per-turn 工具执行闸、AgentJobManager 有界执行；低负载行为与现状一致，新行为只在饱和时可见。

## 拍板要点（p-010 决策记录 2026-09-24）

- 默认值 2 / 1 / 60s / 4 / 32 / 4（9/23 本机实测：4C/8GB 但 12 个 PM2 应用共享、可用 ~3.3GB、earlyoom 机器级 10%、无 cgroup 上限，支持保守起步；配置热读上调零代码成本）。
- bridge 归 background 类，bridge registry 429=占槽预审保留；v1 不做 per-project 二级限额。
- 排队对 UI 透明、超时才报错；UI 超时映射 HTTP 503。

## 范围

- t01：planned Spec + 全局 invocation 信号量（A1）。
- 后续（不预建）：per-turn 工具执行闸（A2）、AgentJobManager 有界执行（A3）、饱和压测验收。
