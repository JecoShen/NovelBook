/**
 * 将字符串格式化为安全的 YAML 标量:纯 CJK/安全字符直接平铺(作者读源文件看到的是干净标题),
 * 含 YAML 特殊字符时退回 JSON 双引号。与服务端 content-node-templates.ts 的 formatYamlString 同一规则,
 * 避免新建文件的 frontmatter 出现可避免的引号(原始文本展示路径会连引号一起显示)。
 */
export function formatYamlScalar(value: string): string {
    const trimmedValue = value.trim();
    if (/^[^\s:[\]{},#&*!|>'"%@`][^:[\]{},#&*!|>'"%@`]*$/.test(trimmedValue)) {
        return trimmedValue;
    }
    return JSON.stringify(value);
}
