import {describe, expect, it} from "vitest";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";

describe("resolveApiErrorCode", () => {
    it.each([
        [{data: {code: "SESSION_NOT_FOUND"}}],
        [{data: {data: {code: "SESSION_NOT_FOUND"}}}],
        [{response: {_data: {code: "SESSION_NOT_FOUND"}}}],
        [{response: {_data: {data: {code: "SESSION_NOT_FOUND"}}}}],
    ])("读取 $fetch/h3 的稳定业务错误码", (error) => {
        expect(resolveApiErrorCode(error)).toBe("SESSION_NOT_FOUND");
    });

    it("未知或非字符串 code 返回 null", () => {
        expect(resolveApiErrorCode(null)).toBeNull();
        expect(resolveApiErrorCode({data: {code: 404}})).toBeNull();
        expect(resolveApiErrorCode(new Error("failed"))).toBeNull();
    });
});

describe("resolveApiErrorMessage", () => {
    it("保留服务端的业务错误文案", () => {
        expect(resolveApiErrorMessage({data: {message: "项目不存在"}}, "兜底")).toBe("项目不存在");
        expect(resolveApiErrorMessage({response: {_data: {message: "会话已归档"}}}, "兜底")).toBe("会话已归档");
        expect(resolveApiErrorMessage({data: {statusMessage: "章节名已被占用"}}, "兜底")).toBe("章节名已被占用");
    });

    it("保留有信息量的英文 message", () => {
        expect(resolveApiErrorMessage(new Error("Project slug already exists"), "兜底")).toBe("Project slug already exists");
    });

    it.each([
        ["顶层 statusMessage", {statusMessage: "Server Error"}],
        ["顶层 message", {message: "Server Error"}],
        ["Error 实例", new Error("Server Error")],
        ["data.message", {data: {message: "Server Error"}}],
        ["response._data.statusMessage", {response: {_data: {statusMessage: "Internal Server Error"}}}],
        ["大小写与空白变体", {message: "  server error  "}],
        ["fetch 网络错误", {message: "Failed to fetch"}],
    ])("通用状态短语（%s）让位给调用方 fallback", (_label, error) => {
        expect(resolveApiErrorMessage(error, "绑定 Inline AI Session 失败")).toBe("绑定 Inline AI Session 失败");
    });

    it("通用短语且无 fallback 时回退默认文案", () => {
        expect(resolveApiErrorMessage({statusMessage: "Server Error"})).toBe("请求失败");
    });

    it("业务 data.message 优先于通用顶层 message", () => {
        expect(resolveApiErrorMessage({data: {message: "项目不存在"}, message: "Server Error"}, "兜底")).toBe("项目不存在");
    });

    it("完全无消息时回退 fallback 或默认文案", () => {
        expect(resolveApiErrorMessage(null, "兜底")).toBe("兜底");
        expect(resolveApiErrorMessage({})).toBe("请求失败");
    });

    it("抹除消息中的服务器绝对路径，保留其余上下文", () => {
        expect(resolveApiErrorMessage(
            {data: {message: "ENOENT: no such file or directory, open '/www/wwwroot/book/manuscript/001-volume/index.md'"}},
            "兜底",
        )).toBe("ENOENT: no such file or directory, open '…'");
        expect(resolveApiErrorMessage(
            {message: "读取 /data/state/projects 失败"},
            "兜底",
        )).toBe("读取 … 失败");
    });

    it("不误伤 URL 与相对路径", () => {
        expect(resolveApiErrorMessage({message: "请求 https://example.com/a/b 超时"}, "兜底")).toBe("请求 https://example.com/a/b 超时");
        expect(resolveApiErrorMessage({message: "manuscript/001-volume/index.md 已存在"}, "兜底")).toBe("manuscript/001-volume/index.md 已存在");
    });
});
