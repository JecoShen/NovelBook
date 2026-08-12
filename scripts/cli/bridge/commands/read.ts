import {bridgeRequest} from "../util/http";

export interface ReadInput {
    projectRoot: string;
    path: string;
    token: string;
    baseUrl: string;
    signal?: AbortSignal;
}

export interface ReadResult {
    path: string;
    absolutePath: string;
    entryType: string;
    editable: boolean;
    mtimeMs: number;
    content: string;
}

export async function readCommand(input: ReadInput): Promise<ReadResult> {
    const search = new URLSearchParams({path: input.path});
    return bridgeRequest<ReadResult>({
        method: "GET",
        path: `/api/agent/bridge/projects/${encodeURIComponent(input.projectRoot)}/read?${search.toString()}`,
        token: input.token,
        baseUrl: input.baseUrl,
        signal: input.signal,
    });
}
