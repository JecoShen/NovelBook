# Agent Bridge HTTP 合同

让同机 CLI（典型为 Claude Code 监督者）程序化调用 NeuroBook 内置 Agent
（leader / writer），按"写章节 → 读文件 → 纠偏 → 续写"循环推进创作。

## 范围

- 暴露端点：`/api/agent/bridge/**` 三个路由
- 暴露 CLI：`bun run bridge`（即 `scripts/cli/bridge/index.ts`）
- 不暴露：UI 会话、auth cookie、open project control plane（这些都是平台原语，CLI 直接调各自端点）

## 鉴权

| 步骤 | 机制 | 失败码 |
| --- | --- | --- |
| 1. 远端地址 | 仅接受 loopback（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），`HOST=0.0.0.0` 时 fall back 拒绝 | `403 BRIDGE_NOT_LOOPBACK` |
| 2. 启动时 token | `NEURO_BOOK_BRIDGE_TOKEN` env，**未设置视为功能关闭** | `503 BRIDGE_DISABLED` |
| 3. 每次请求 | `Authorization: Bearer <token>`，恒定时间比较 | `401 BRIDGE_INVALID_TOKEN` |

镜像 `server/routes/__nbook/control/shutdown.post.ts` 的 loopback + bearer
模式。`isLoopbackRequest` + `matchesControlToken` 已抽取到
`server/runtime/control/loopback-auth.ts`，shutdown 改为 import 同一份实现，
避免两份 loopback 判定漂移。

## 端点

### `POST /api/agent/bridge/sessions`

打开 project（幂等）并创建绑定的 leader session。客户端不传 `currentProjectRoot`——
open + create 一步到位（`createAgent` 内部要求 project 已 open，硬性顺序）。

请求体：
```ts
{
  projectRoot: string;       // 单段目录名，ProjectRootDtoSchema 校验
  profileKey?: string;       // 默认 "leader.default"
}
```

返回 `{sessionId, projectRoot, profileKey}`。

错误：
- `404 PROJECT_NOT_FOUND` — listProjects 找不到
- `400 INVALID_REQUEST` — Zod 校验失败

### `POST /api/agent/bridge/sessions/:sessionId/invoke`

阻塞式调用 leader session。`caller` 服务端强制为 `external-cli`（DTO schema 用
`caller: z.never()` 拒绝客户端传），`block: true`、`queueIfBusy: false`。
AbortSignal 接 `event.node.req.close`，客户端断开 → cancel generation。

请求体：复用现有 `AgentInvokeRequestDtoSchema`
（`shared/dto/agent-session.dto.ts:88`）。`clientMessageId` 必传（prompt / followup
模式 superRefine 强制），CLI 侧用 `crypto.randomUUID()` 自动生成。

返回：经过 `projectPublicInvocationResult` 投影的 `InvokeAgentResult`：
- `status: "completed"` — agent 跑完，看 `finalMessage` / `reportResult`
- `status: "waiting"` — leader 要 user input，用 `mode: "followup"` + `resolution` 字段作答
- `status: "error"` — harness 出错，看 `error.message` / `errorPhase`
- `aborted: true` — 被 abort 端点停掉

错误：
- `409 BRIDGE_PROJECT_UNBOUND` — session 未绑 projectRoot
- `429 BRIDGE_CONCURRENCY_LIMIT` — per-project=1 / global=2 命中
- `401 / 403 / 503` — 鉴权三态

### `GET /api/agent/bridge/projects/:projectRoot/read?path=...`

读取 Project Workspace 内文本文件。**product 模式专用**（cookie 鉴权开启时 CLI
没有 session cookie 走不了原 `/api/workspace-files/read`）。dev 模式可直连原
端点；本路由在 dev 下也工作，作为统一入口。

请求 query：`path: string`（必填，最小非空校验，越界由下游 `readWorkspaceTextFile` 拒绝）。

返回：与 `/api/workspace-files/read` 对齐
（`{path, absolutePath, entryType, editable, mtimeMs, content}`）。

错误：
- `400 INVALID_PROJECT_ROOT` — projectRoot 不是单段
- `400 INVALID_READ_QUERY` — path 缺失或空

## 并发限流

独立 `BridgeRunRegistry`（`server/agent/bridge/bridge-run-registry.ts`）：
- per-project cap=1：同 project 不并发
- global cap=2：跨 project 最多 2 个 bridge run 同时在飞
- 不进 `useAgentHarness()` 包装层：避免误伤 UI 会话
- 释放路径：invoke 路由 `finally { req.off("close") + controller.abort() + release() }`

## Caller kind

session log / `report_result` 提醒 / telemetry 通过 `caller.kind === "external-cli"`
区分外部 CLI 调用与普通用户。`AgentInvokeCallerKind` + `StoredInvocationCaller.kind`
+ `StoredInvocationCaller` codec + `profile-sdk/contracts.ts` 的
`AgentInvokeCaller.kind` union 各加一个 `"external-cli"`（共 4 处单行）。

**回退警告**：旧二进制读已含 `external-cli` 的 JSONL follow-up queue 会 `corrupt()`
该会话。缓解：单写者 lease（`agent-session-store-lease.ts`，30s stale / 15s
heartbeat）保证无双版本并发读；MVP 不需要"用外部 CLI 身份持久化 follow-up"用例，
回退时人工清队列即可。

## CLI sidecar

`bun run bridge` 进入 commander 程序。5 个子命令：

```bash
nbook-bridge open <projectRoot> [--profile leader.default]
nbook-bridge send <sessionId> "<prompt>" [--followup] [--title "..."]
nbook-bridge read <projectRoot> <path>
nbook-bridge abort <sessionId> [-r reason]
nbook-bridge status <sessionId>
```

Token：--token 或 $NEURO_BOOK_BRIDGE_TOKEN。Base URL：--base-url，默认
`http://127.0.0.1:3000`。abort / status 复用现有 `/api/agent/sessions/*` 端点
（不是桥专用端点）。

## dev / product 差异

| 模式 | cookie 鉴权 | bridge 鉴权 | CLI 文件读 |
| --- | --- | --- | --- |
| dev (`nodeEnv=development`) | 关 | 开（env 未设 503） | 走 `/api/agent/bridge/projects/:root/read` 即可（与 product 入口统一） |
| product (默认) | 开 | 开（同上） | 走 `/api/agent/bridge/projects/:root/read`（CLI 无 session cookie） |

dev 模式直连 `/api/workspace-files/read` 也行；bridge 文件读端点作为统一入口
不重复造路径。

## 风险与已验证缓解

| 风险 | 缓解 |
| --- | --- |
| 0.0.0.0 绑定变公网 | `isLoopbackRequest` 在 address 已知非 loopback 时直接 reject；fallback 仅在 NITRO_HOST/HOST 明确 loopback 时放行 |
| abort leader 不级联到 child writer | `agent-collaboration-tools.ts:178` 透传 signal；全链路集成测试应显式断言；不级联则 bridge abort 改为先查 linked agents 再级联 |
| leader 返 `status: "waiting"` | `queueIfBusy:false` 不排队；CLI 用 `mode:"followup"` + `resolution` 字段作答；waiting ≠ error |
| bridge cap 不约束 UI | 刻意（不饿死 UI），文档写明 |
| 无服务端请求超时 | 已有 harness watchdog 兜底；CLI sidecar 默认 10 分钟读超时 + AbortController |
| `external-cli` 持久化不可逆 | 单写者 lease 保证无双版本并发读；MVP 不需要持久化该 kind 的 follow-up 用例 |

## 范围外（Phase 2+）

- OpenAPI 文档（agent 路由按 `server/openapi/route-map.ts:4` 故意不进）
- bridge 专用 SSE 路由 + 服务端 idle timeout
- 多会话 daemon / 远程 session 池
- `nb-history` actor 扩展（要改 sibling 仓）
- 远端（跨机）调用（ssh -L 隧道是用户责任）
