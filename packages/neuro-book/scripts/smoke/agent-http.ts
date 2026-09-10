const baseUrl = process.env.AGENT_HTTP_BASE_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
    const created = await request("/api/agent/sessions", {
        method: "POST",
        body: {
            profileKey: "leader.default",
            initial: {
                role: "http-smoke",
            },
        },
    }) as {sessionId: number};

    const invoked = await request(`/api/agent/sessions/${created.sessionId}/invocations`, {
        method: "POST",
        body: {
            mode: "prompt",
            message: {
                text: "用一句中文回复：agent http smoke ok。任务完成时请调用 report_result，result 填 http smoke ok，success 填 true。",
            },
        },
    });

    console.log("# Agent HTTP Smoke");
    console.log(JSON.stringify(invoked, null, 2));
}

async function request(path: string, input: {
    method: "GET" | "POST";
    body?: unknown;
}): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: input.method,
        headers: input.body ? {"content-type": "application/json"} : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`${input.method} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
}

await main();
