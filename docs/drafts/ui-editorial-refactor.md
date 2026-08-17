# UI 重构草案：编辑室风格与双区制

状态：草案，方向已拍板，实施未开始。
拍板日期：2026-08-10。

## 1. 决策

- 风格方向：**编辑室（Editorial Workstation）+ 双区制**。正文是主角，IDE 骨架降级为安静的工具边框；应用内并存两种密度，不再用一套密度覆盖全部界面。
- 暗色主题：**全部重做，砍掉程序员生态主题**（catppuccin / dracula / monokai / one-dark-pro / tokyo-night）。
- 默认主题继续是 `sepia`，不变。

以上三条勿重议。下面是把它们变成代码所需的规范。

## 2. 现状（已验证的计数）

| 维度 | 现状 | 判断 |
|---|---|---|
| 字号 | `text-[11px]` 567、`text-[10px]` 458、`text-xs` 577、`text-[12px]` 223；`text-base` 32、`text-lg` 15 | 约 1900 处正文 ≤12px，是监控大盘密度 |
| 界面字体 | 全局无 `font-family` 声明，入口是 `the-new-css-reset` | 界面字体是浏览器默认值 |
| 字重 | `font-medium` 423 + `font-semibold` 421 + `font-bold` 41 | 885 处加粗，层级失效 |
| 圆角 | `rounded-md` 796、`full` 226、`lg` 170、`xl` 92、`2xl` 85、`sm` 19，混入数值写法 `rounded-2` 11 | 6 档以上并存，无刻度纪律 |
| 组件规模 | `app/components/**/*.vue` 共 231 个 | 迁移必须分批 |

颜色系统（36 个语义变量、单一事实源、README 登记、禁止事项）是全项目最成熟的部分，本轮不推翻，只扩展。缺的是排版、间距、圆角、层级、动效五组 token。

## 3. 双区制

应用内划分两类空间，各自有独立的密度与排版规则。

| | 阅读区 | 控制区 |
|---|---|---|
| 范围 | Markdown Studio 正文与预览、`StructuredTextEditor` 正文、Agent 输出的正文段落 | ActivityBar、文件树、Plot 面板、Agent 面板、设置、任务中心、Dialog 表单 |
| 目录判据 | `app/components/markdown-studio/`、`common/form/` 的正文体 | `app/components/novel-ide/`、`common/` 其余、`profile-template-editor/`、`workflow-preview/` |
| 正文字号 | 16–18px（用户可调 12–28） | 13px 默认，**硬下限 12px** |
| 行高 | 1.85 | 1.45 |
| 字体 | 衬线，用户可调 | 无衬线系统栈 |
| 分层手段 | 留白，几乎不画边框 | 底色分区；边框只用于输入框和真实分隔 |
| 圆角 | 0 或 2px | 见 §4.3 |
| 强调 | 只有选区与引用 chip | accent 只给「当前项 + 主操作」 |

阅读区取值已存在于 `shared/editor-workbench.ts` 的 `DEFAULT_MARKDOWN_EDITOR_PREFERENCES`（`"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif` / 16 / 1.85）。本轮不改这些默认值，只做两件事：把它确立为阅读区规范，并阻止控制区密度继续渗透进来。

`--text-2xs`（11px）保留但受限：只允许承载角标、序号、计数、时间戳这类扫视型信息，不得承载需要阅读的句子。

## 4. Token 扩展

结构照搬现有颜色系统：primitive（刻度）→ semantic（角色），**组件只消费 semantic**。事实源新增 `app/utils/theme/` 下对应模块，并在 `app/utils/theme/README.md` 的变量总表登记。

### 4.1 排版

```
--font-ui:      system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
--font-mono:    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace
--font-reading: 由编辑器 preferences 承载，不在主题层重复定义

--text-2xs: 11px   角标、序号、计数、时间戳（禁止承载可读句子）
--text-xs:  12px   辅助信息下限
--text-sm:  13px   控制区默认正文（主力）
--text-md:  14px   面板标题、表单标签
--text-lg:  16px   区块标题
--text-xl:  20px   页面标题、空态

--leading-tight:   1.3    标题
--leading-ui:      1.45   控制区正文
--leading-reading: 1.85   阅读区
```

字重只留三级：400 / 500 / 600。700 仅允许用于 ≥20px 的标题。

`--font-mono` 当前在至少 9 个文件里重复写死同一串字面值，本轮收敛。

### 4.2 间距

4 的倍数，七级刻度：`2 4 6 8 12 16 24 32`。控制区内边距默认 8 / 12，面板间距默认 16。

### 4.3 圆角

三档加一个例外，替换现有 6 档混用：

```
--radius-control: 6px    按钮、输入框、chip 容器、列表项
--radius-panel:   10px   卡片、面板、Dialog
--radius-pill:    999px  chip、徽标、头像
```

阅读区用 0 或 2px。`rounded-2` 这类数值写法一律清除。

### 4.4 层级

主用底色分层，阴影只给真正浮起的元素：

```
--elevation-flat:    none                                                    面板内一切
--elevation-popover: 0 4px 12px color-mix(in srgb, var(--shadow-color) 8%, transparent)    下拉、菜单、tooltip
--elevation-dialog:  0 16px 40px color-mix(in srgb, var(--shadow-color) 14%, transparent)  Dialog、浮窗
```

沿用现有规则：阴影必须走 `--shadow-color`，禁止固定 rgba。

### 4.5 动效

```
--motion-fast:  120ms   hover、focus
--motion-base:  180ms   展开、折叠
--motion-enter: 220ms   浮层进入
--ease-standard: cubic-bezier(0.2, 0, 0, 1)
```

`prefers-reduced-motion: reduce` 时全部降为 0。动效只用于解释空间关系，不做装饰。

## 5. 主题阵容重做

### 5.1 新阵容（5 套）

| ID | 名称 | appearance | 定位 |
|---|---|---|---|
| `sepia` | 纸页 | light | 默认主题，保留现值，仅按新 token 微调 |
| `light` | 素白 | light | 日间强光，中性冷白，高对比 |
| `dark` | 夜书桌 | dark | 暗色默认，低饱和暖灰底 + 暖白文字 |
| `midnight` | 深墨 | dark | 更低亮度，长时间夜间写作 |
| `slate` | 冷石 | dark | 中性偏冷，承接原程序员暗色主题的使用者 |

暗色的隐喻是「夜里的书桌」，不是「把纸调黑」，也不是 Dracula 那种高饱和紫粉。

### 5.2 下线主题的迁移映射

`resolve-theme.ts` 当前对未知 ID **静默回退 `sepia`**。直接删 ID 会让 Dracula 用户某天打开变成米黄纸。必须先加一层 ID 别名映射再删：

```
dracula      -> slate
tokyo-night  -> slate
catppuccin   -> slate
monokai      -> midnight
one-dark-pro -> dark
```

命名用 `themeIdAliases` 或 `retiredThemeAliases`，**不要用 `legacy` 命名**（AGENTS.md 约定）。别名只作用于读取旧配置，不出现在主题选择器里。

### 5.3 牵连的文件

- `shared/theme/theme-vars.ts:6` `builtInThemeIds`（shared 合同，server 校验消费）
- `app/utils/theme/theme-tokens.ts` `themeMeta` 与 `themeTokens`
- `app/utils/theme/resolve-theme.ts` 加别名层
- `app/styles/theme-vars.css` SSR fallback 同步
- `server/config/normalizer.test.ts`
- `docs/guide/theme.md`、`docs/en/guide/theme.md`

## 6. 实施顺序

先立规范再改代码，不做全局批量替换。

1. **Token 层**：新增五组 token 的事实源，登记进 `app/utils/theme/README.md` 变量总表与禁止事项。补全局 `--font-ui`（投入产出比最高的单点改动）。
2. **主题重做**：按 §5 重建 5 套主题字面值、加别名层、同步 fallback 与文档测试。
3. **三个标杆屏**：Markdown Studio（阅读区标杆）、Agent 面板（控制区标杆）、设置页（表单密度标杆）。这三个定稿后其余照抄。
4. **分批迁移**：按目录 4–6 批。`text-[11px]` **不可机械映射**，必须先按 §3 的目录判据判定所属区，再取对应刻度。按 AGENTS.md 先 dry run，命中不确定改逐处编辑并报告实际修改文件。
5. **门禁**：新增检查脚本，禁裸 px 字号、禁刻度外圆角、禁 `dark:` 变体、禁 Tailwind 调色板类。现有 `product:policy:check` 是同形态先例。
6. **视觉回归**：对三个标杆屏建立 playwright 截图基线。

## 7. 不在本轮范围

- 分类色板例外（Plot / Workspace / Reference chip / Profile template / Markdown 内容主题）继续不迁移，规则见 `app/utils/theme/README.md`。
- World Engine `--we-*` 别名层不动。
- `NotificationViewport` 的宿主外玻璃拟态例外保留。
- 自定义主题编辑器的 13 核心色结构不变；新增 token 是否进入编辑器，待标杆屏定稿后再定。

## 8. 待确认

- 新增 token 是否需要进入自定义主题的导出 JSON schema（当前 `schemaVersion: 1` 只含颜色）。若进入，需要 schema 升版与导入兼容策略。
- `midnight` 与 `slate` 两套暗色是否都必要，可在标杆屏出来后按实际观感砍到一套。
