# Volcengine Ark 模型配置与已知兼容性约束

> 与 [invoke-http.md](./invoke-http.md) 配套：使用 bridge 或内置 Agent 调方舟
> Coding Plan / Doubao / DeepSeek 系列时，先读完本节再写 `config.json` 的
> `models.providers`，否则第一次 invoke 会以 4xx 失败收场。

## TL;DR 配置模板

把 `config.json` 写成下面这样基本就能跑通。`apiKey` 通过 runtime config
注入（**不要**写进源）。

```jsonc
{
  "models": {
    "default": "volcengine-ark/<model-id-from-list-models>",
    "providers": [{
      "id": "volcengine-ark",
      "name": "Volcengine Ark",
      "enabled": true,
      "modelApi": "openai-completions",
      "options": {
        "apiKey": "ark-...",
        "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
        "proxy": "",
        "timeoutMs": 60000,
        "requestOptions": {"maxRetries": 2}
      },
      "models": [{
        "id": "<model-id-from-list-models>",   // 见下一节怎么查
        "name": "...",
        "enabled": true,
        "api": "openai-completions",
        "reasoning": true,                      // coding plan 系列通常支持
        "input": ["text"],
        "maxTokens": 32768,
        "contextWindowTokens": 256000,
        "compat": { "supportsDeveloperRole": false }  // 关键！见下
      }]
    }]
  }
}
```

## 第一关：模型名不能猜

方舟控制台的 UI 别名（`ark-code-latest` 之类）**不是** API 接受的 `model` 值。
在拿到 API key 后，先用 key 列出当前账号能用的模型清单：

```bash
curl https://ark.cn-beijing.volces.com/api/v3/models \
  -H "Authorization: Bearer $ARK_API_KEY"
```

返回 `data[]`，过滤掉 `status === "Shutdown"` 或 `status === "Retiring"`，
剩下的 `id` 才是真正能填进 `models.providers[*].models[*].id` 的值。常见
"代码"类（验证于 2026-08-13 的 Beijing 区域）：

- `doubao-seed-2-0-code-preview-260215`（Doubao seed code preview）
- `doubao-seed-2-0-pro-260215`
- `doubao-seed-2-1-pro-260628`
- `deepseek-v4-pro-260425`
- `deepseek-v4-flash-260425`

如果你的 key 走 Coding Plan 商品，`/v3/models` 还会出现 `ep-<uuid>` 这种
endpoint id——把 endpoint id 当 `model` 字段值即可，效果一样。

**症状**：直接写 `ark-code-latest` 这种 UI 别名，ARK 返回
`404 InvalidEndpointOrModel.NotFound`，bridge 上会冒
`errorPhase: "model"` 的 invocation error。

## 第二关：拒收 `developer` role

方舟的 OpenAI-compat 端点只接受 `messages.role ∈ {system, assistant, user, tool}`，
**不**接受 `developer`。而 pi-ai 0.80.6 的 openai-completions adapter 默认
逻辑是：

```ts
const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
```

——只要模型 `reasoning: true` 且 `compat.supportsDeveloperRole` 没显式设
`false`，system prompt 就会以 `developer` role 发出，ARK 立刻 400。

**症状**：

```
400: {"code":"InvalidParameter",
      "message":"The parameter `messages.role` specified in the request are not valid:
                 invalid value: `developer`, supported values are: `system`, `assistant`, `user`, `tool`."}
```

**修复**：在 model 配置里加：

```jsonc
"compat": { "supportsDeveloperRole": false }
```

这条 fix 在 NeuroBook 启动期也会被检测并 warn（见
`server/agent/harness/model-resolver.ts`），但**不**阻塞启动——用户可以在
设置页先确认再补 compat。

## 第三关：`baseURL` 与 region

不同 region 域名不同：

| Region | baseURL |
| --- | --- |
| 北京（cn-beijing） | `https://ark.cn-beijing.volces.com/api/v3` |
| 上海（cn-shanghai） | `https://ark.cn-shanghai.volces.com/api/v3` |
| 哥本哈根（eu-copenhagen） | `https://ark.eu-copenhagen.volces.com/api/v3` |

只有北京区域提供 Coding Plan 商品；其它区域用通用 Doubao / DeepSeek 模型。
控制台顶部"地域"切换时 key 不会自动迁移，混用会持续 401。

## 第四关：超时与限流

方舟对单请求的 `timeoutMs` 没有强制，但 SSE 流式输出 coding plan 模型时
平均 5–15 秒。`config.json` 推荐：

```jsonc
"options": {
  "timeoutMs": 60000,
  "requestOptions": { "maxRetries": 2 }
}
```

bridge 端的 `send` 默认 10 分钟 timeout（`scripts/cli/bridge/util/http.ts`），
够用。

## 启动期自动检测

NeuroBook 启动时 `resolvePiModelFromConfig` 会扫所有启用的 model provider，
对命中下列**启发式**条件的，输出 `appLogger.warn` 提醒：

- `api === "openai-completions"`
- `baseURL` 匹配 `ark\.[a-z0-9-]+\.volces\.com`
- `reasoning === true`
- `compat.supportsDeveloperRole !== false`

warn 内容：

```
[agent.model.arkCompat.developerRoleNotDisabled]
  provider: volcengine-ark
  model: doubao-seed-2-0-code-preview-260215
  hint: ARK OpenAI 端点拒 developer role，需在 model.compat 设 supportsDeveloperRole:false
```

warn 是 best-effort，**不**阻塞 harness 启动。用户在 settings 页看到 warn 后
再补 compat，重启会话即可生效（registry 标 `next-run` 生效周期）。

## 与本仓其他文件的关系

- [invoke-http.md](./invoke-http.md)：bridge 端点、鉴权、caller kind。
- `server/agent/harness/model-resolver.ts`：compat 解析 + 启发式 warn。
- `shared/dto/agent-session.dto.ts`：`AgentUserMessageInputDtoSchema` 是
  `{text: string}`——bridge CLI `send` 必须按这个形状发（已修，见
  [bridge-ark-e2e-verified](../../.claude/projects/-www-wwwroot-book-neoshen-dpdns-org/memory/bridge-ark-e2e-verified.md)）。
