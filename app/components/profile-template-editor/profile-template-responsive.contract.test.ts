import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Profile Template 工作台响应式契约 — fork-native 版本.
 *
 * 上游 5693eec (port via beac6ddd / 75c035bd / 356c675e) 引入的 profile-template-responsive.contract.test.ts
 * 假设 BEM 命名 (profile-template-header__actions / __identity 等) 与 @container 容器查询,
 * 这些 fork 都没有. 本测试 fork-native 重写: 用真实可观察的 class 字符串 / aria-label /
 * onMounted 防御代替 BEM / container 断言, 与 3 个 fork commit 的实际行为一一对应.
 */
const headerPath = fileURLToPath(new URL('./ProfileTemplateHeader.vue', import.meta.url))
const libraryPanelPath = fileURLToPath(new URL('./ProfileTemplateComponentLibraryPanel.vue', import.meta.url))
const inspectorPanelPath = fileURLToPath(new URL('./ProfileTemplateInspectorPanel.vue', import.meta.url))
const canvasPanelPath = fileURLToPath(new URL('./ProfileTemplateCanvasPanel.vue', import.meta.url))
const visualEditorPath = fileURLToPath(new URL('./ProfileTemplateVisualEditor.vue', import.meta.url))

describe('Profile Template 工作台响应式契约 (fork 5693eec)', () => {
  describe('5-panels 响应式 (beac6ddd)', () => {
    it('Library 面板根节点 min-h-0 + min-w-0 允许收缩', async () => {
      const source = (await readFile(libraryPanelPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="panel flex min-h-0 min-w-0 flex-col"')
    })

    it('Canvas 面板根节点 min-h-0 + min-w-0 允许收缩', async () => {
      const source = (await readFile(canvasPanelPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="panel flex min-h-0 min-w-0 flex-col"')
    })

    it('Inspector 面板带 overflow-hidden 防御单列被内容撑开', async () => {
      const source = (await readFile(inspectorPanelPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="panel flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden"')
    })

    it('Library 折叠按钮用 Tooltip + aria-label="收起组件库", 不用 native title', async () => {
      const source = (await readFile(libraryPanelPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('import Tooltip from \'nbook/app/components/common/Tooltip.vue\'')
      expect(source).toMatch(/<Tooltip\s+text="收起组件库"\s+placement="bottom"\s+>/)
      expect(source).toContain('aria-label="收起组件库"')
      expect(source).not.toContain('title="收起组件库"')
    })

    it('Inspector 折叠按钮用 Tooltip + aria-label="收起右侧面板", 不用 native title', async () => {
      const source = (await readFile(inspectorPanelPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('import Tooltip from \'nbook/app/components/common/Tooltip.vue\'')
      expect(source).toMatch(/<Tooltip\s+text="收起右侧面板"\s+placement="bottom"\s+>/)
      expect(source).toContain('aria-label="收起右侧面板"')
      expect(source).not.toContain('title="收起右侧面板"')
    })
  })

  describe('Header 响应式 + 11 按钮 Tooltip (75c035bd)', () => {
    it('Header 根 flex-wrap + min-h-12 替代固定 h-12, 允许窄屏换行', async () => {
      const source = (await readFile(headerPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2')
      // 上游 not.toContain("flex h-12 shrink-0 items-center") 仍成立 (fork 改用 min-h-12)
      expect(source).not.toContain('flex h-12 shrink-0 items-center')
    })

    it('11 按钮全部 type="button" + aria-label, disabled 按钮带 disabled:pointer-events-none', async () => {
      const source = (await readFile(headerPath, 'utf8')).replace(/\r\n/g, '\n')
      const buttonTags = source.match(/<button[^>]*>/g) ?? []
      expect(buttonTags.length).toBeGreaterThanOrEqual(11)
      for (const tag of buttonTags) {
        expect(tag).toContain('type="button"')
        expect(tag).toContain('aria-label=')
      }
      // 关闭按钮无 :disabled, 其余 10 个 disabled 按钮必须带 disabled:pointer-events-none
      const disabledButtons = buttonTags.filter(tag => tag.includes(':disabled='))
      expect(disabledButtons.length).toBeGreaterThanOrEqual(10)
      for (const tag of disabledButtons) {
        expect(tag).toContain('disabled:pointer-events-none')
      }
      // 全文件无 native title= 残留 (Tooltip 完全替代)
      expect(source).not.toMatch(/\stitle="/)
    })

    it('Header 状态文本 min-w-0 truncate 防止撑爆动作区', async () => {
      const source = (await readFile(headerPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="hidden min-w-0 items-center gap-1 text-xs text-[var(--status-success)] md:flex"')
      expect(source).toContain('class="min-w-0 truncate">{{ props.editorStatusText }}')
    })

    it('11 动作按钮全部包在 Tooltip 里, 关键动作 text 一致', async () => {
      const source = (await readFile(headerPath, 'utf8')).replace(/\r\n/g, '\n')
      // 11 个 Tooltip 包裹 (含动态 :text): 用宽松 regex 跨多行匹配, 不要求属性顺序
      const tooltipWrappers = source.match(/<Tooltip\b[^>]*>/g) ?? []
      expect(tooltipWrappers.length).toBeGreaterThanOrEqual(11)
      // 关键按钮 text 字符串断言
      expect(source).toContain('text="撤销 Ctrl+Z"')
      expect(source).toContain('text="重做 Ctrl+Shift+Z"')
      expect(source).toContain('text="预览"')
      expect(source).toContain('text="编译"')
      expect(source).toContain('text="编译全部"')
      expect(source).toContain('text="恢复系统版本"')
      expect(source).toContain('text="新建"')
      expect(source).toContain('text="创建 Session"')
      expect(source).toContain('text="保存"')
      expect(source).toContain('text="关闭"')
    })
  })

  describe('VisualEditor 嵌套主题宿主防御 + 折叠态 a11y (356c675e)', () => {
    it('onMounted 检查 IDE_THEME_HOST_CLASS, 嵌套宿主不重复 mountThemeHost', async () => {
      const source = (await readFile(visualEditorPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('import { IDE_THEME_HOST_CLASS } from \'nbook/app/utils/theme/theme-tokens\'')
      expect(source).toContain('import { useIdeTheme } from \'nbook/app/composables/useIdeTheme\'')
      // 防御式 closest 检查: 已处于 IDE_THEME_HOST_CLASS 内不重复 mount
      expect(source).toContain('if (!themeHostRef.value?.closest(`.${IDE_THEME_HOST_CLASS}`)) {')
      expect(source).toContain('mountThemeHost(themeHostRef.value)')
    })

    it('main 元素 min-w-0 overflow-hidden 防御单列被内容撑开', async () => {
      const source = (await readFile(visualEditorPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toContain('class="grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3"')
    })

    it('折叠态: libraryPanelCollapsed + inspectorPanelCollapsed 状态变量 + v-if 使用存在', async () => {
      const source = (await readFile(visualEditorPath, 'utf8')).replace(/\r\n/g, '\n')
      // fork 用 ref 变量 (v-if 绑定) 替代 upstream 的 'library-collapsed' / 'inspector-collapsed' class 字符串
      expect(source).toContain('const libraryPanelCollapsed = ref(false)')
      expect(source).toContain('const inspectorPanelCollapsed = ref(false)')
      expect(source).toContain('v-if="libraryPanelCollapsed"')
      expect(source).toContain('v-if="inspectorPanelCollapsed"')
    })

    it('Library 折叠态 aside 包含 Tooltip + aria-label="展开组件库"', async () => {
      const source = (await readFile(visualEditorPath, 'utf8')).replace(/\r\n/g, '\n')
      expect(source).toMatch(/<Tooltip\s+text="展开组件库"\s+placement="right"\s+>/)
      expect(source).toContain('aria-label="展开组件库"')
    })

    it('Inspector 折叠态 aside 带 aria-label="展开右侧面板" (fork 用 aside 而非 button)', async () => {
      const source = (await readFile(visualEditorPath, 'utf8')).replace(/\r\n/g, '\n')
      // fork 决定保留 <aside> + click handler (per landed.md, 与上游 <button> 不同)
      expect(source).toMatch(/class="panel-rail"\s+aria-label="展开右侧面板"/)
    })
  })
})
