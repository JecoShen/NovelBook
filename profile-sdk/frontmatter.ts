// Profile SDK 子入口：仅暴露 stripFrontmatterBody。
// 故意只放这一项 —— 它不依赖 zod / yaml，是 Profile 沙箱可以安全引入的最小 frontmatter
// 工具。parseFrontmatterDocument / renderFrontmatterDocument / assertNoReadonlyFrontmatterKeys
// 仍由 server/utils/frontmatter-document.ts 提供，server 内部使用，Profile 不该直接访问。

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 剥离 YAML frontmatter，仅返回正文部分；无 frontmatter 时原样返回。
 */
export function stripFrontmatterBody(content: string): string {
    const match = content.match(FRONTMATTER_PATTERN);
    return match ? match[2] ?? "" : content;
}
