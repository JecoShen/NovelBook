import {createError} from "h3";
import {useAgentHarness, type NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {listProjects, openProjectControl} from "nbook/server/workspace-files/project-session";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/resolve-workspace-file-target";
import {withProjectTargetOperation} from "nbook/server/workspace-files/project-open-guard";
import {readWorkspaceTextFile, statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {BRIDGE_DEFAULT_PROFILE_KEY} from "nbook/shared/dto/agent-bridge.dto";

/**
 * 桥的服务层。封装跨 module 的组合：open project + create session、product 模式文件读。
 *
 * 故意做成纯函数：每个调用都接收可选的 harness 注入，方便单测用 faux model。
 */

/** open + create 的入参。 */
export interface OpenProjectAndCreateSessionInput {
    projectRoot: string;
    profileKey?: string;
    harness?: NeuroAgentHarness;
}

/** open + create 的返回。sessionId 是路由层 invoke 的入参。 */
export interface OpenProjectAndCreateSessionResult {
    sessionId: number;
    projectRoot: string;
    profileKey: string;
}

/**
 * 校验 project 存在 → open（幂等）→ 创建 leader session 并绑定 projectRoot。
 *
 * `createAgent` 内部要求 project 已 open（`neuro-agent-harness.ts:794`），所以「先 open 后
 * create」是桥的硬性顺序，不能省。`openProjectControl` 幂等：已 open 时返回当前 generation。
 */
export async function openProjectAndCreateLeaderSession(
    input: OpenProjectAndCreateSessionInput,
): Promise<OpenProjectAndCreateSessionResult> {
    const harness = input.harness ?? useAgentHarness();
    const profileKey = input.profileKey ?? BRIDGE_DEFAULT_PROFILE_KEY;

    const snapshot = await listProjects();
    const exists = snapshot.projects.some((entry) => entry.projectRoot === input.projectRoot);
    if (!exists) {
        throw createError({
            statusCode: 404,
            message: `Project 不存在：${input.projectRoot}`,
            data: {code: "PROJECT_NOT_FOUND", projectRoot: input.projectRoot},
        });
    }

    const ref = projectWorkspaceRef(input.projectRoot);
    await openProjectControl(ref, {kind: "user"});

    const created = await harness.createAgent({
        profileKey,
        currentProjectRoot: input.projectRoot,
    });

    return {
        sessionId: created.sessionId,
        projectRoot: input.projectRoot,
        profileKey: created.profileKey,
    };
}

/** product 模式文件读入参。 */
export interface ReadBridgeProjectFileInput {
    projectRoot: string;
    path: string;
}

/** product 模式文件读返回。结构与 `workspace-files/read.get.ts` 对齐。 */
export interface ReadBridgeProjectFileResult {
    path: string;
    absolutePath: string;
    entryType: string;
    editable: boolean;
    mtimeMs: number;
    content: string;
}

/**
 * 复用 `workspace-files/read.get.ts` 的实现路径：解析 target → 跑 withProjectTargetOperation
 * （保证 ready generation 锁定）→ `readWorkspaceTextFile` + `statWorkspacePath`。
 *
 * 桥自己的端点只在此基础上补 `requireBridgeAuth`：product 模式鉴权开启时，CLI 没有
 * cookie 走不了原 `/api/workspace-files/read`，桥给它一个 loopback+token 的入口。
 */
export async function readBridgeProjectFile(
    input: ReadBridgeProjectFileInput,
): Promise<ReadBridgeProjectFileResult> {
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {
        projectRoot: input.projectRoot,
    });
    return withProjectTargetOperation(target, async () => {
        const [node, content] = await Promise.all([
            statWorkspacePath(target.root, input.path),
            readWorkspaceTextFile(target.root, input.path),
        ]);
        return {
            path: node.path,
            absolutePath: node.absolutePath,
            entryType: node.entryType,
            editable: node.editable,
            mtimeMs: node.mtimeMs,
            content,
        };
    });
}
