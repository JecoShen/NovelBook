/**
 * 兼容入口：类型本体已下沉到 `nbook/server/agent/invocation-caller-contract`。
 *
 * 保留本文件是为了不改动现有调用方；contracts 声明项目消费合同文件本身，
 * 避免把 `server/agent/harness/` 前缀带进它的闭包。
 */
export type {
    AgentInvokeCaller,
    AgentInvokeCallerKind,
    AgentMessageIdentity,
} from "nbook/server/agent/invocation-caller-contract";
