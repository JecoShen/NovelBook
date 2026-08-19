/**
 * 共享的 lore frontmatter 解析工具。
 *
 * 用途:cache(resolve 阶段读 frontmatter)和 injector(render 阶段读 frontmatter)
 * 都需要极简 YAML 解析,且过去两者各自复制了一份 ~55 行实现。提到本文件避免
 * 重复 + 单点维护 + 行为漂移风险。
 *
 * 设计选择:不引 `yaml` / `js-yaml` 等完整库,只支持 lore 卡实际用到的子集:
 *   - `key: value` 顶层标量
 *   - `[a, b]` 内联数组(自动 trim)
 *   - `true` / `false` 布尔字面量
 *   - `key:` 下面 `  child: value` 一层嵌套(供 `retrieval:` / `governance:` 等用)
 *
 * 任何超出该子集的需求应升级到完整 YAML 库。
 */

/** 解析单个标量值：`[a, b]` 数组 / `true`|`false` 布尔 / 其余字符串。 */
export function parseScalarValue(value: string): unknown {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
}

/** 极简 YAML frontmatter 解析——只支持 key: value 与 `key:` 嵌套一层。 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const block = match[1] ?? "";
    const out: Record<string, unknown> = {};
    const lines = block.split("\n");
    let currentKey: string | null = null;
    for (const line of lines) {
        if (line.startsWith("  ") && currentKey) {
            const child = line.trim();
            const [k, ...v] = child.split(":");
            if (k && v.length) {
                const existing = out[currentKey];
                if (typeof existing === "object" && existing !== null) {
                    (existing as Record<string, unknown>)[k.trim()] = parseScalarValue(v.join(":").trim());
                }
            }
            continue;
        }
        const [k, ...v] = line.split(":");
        if (k && v.length) {
            const key = k.trim();
            const value = v.join(":").trim();
            if (value === "") {
                currentKey = key;
                out[key] = {};
            } else {
                currentKey = null;
                out[key] = parseScalarValue(value);
            }
        }
    }
    return out;
}
