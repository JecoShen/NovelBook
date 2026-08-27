<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useClientSanitizer } from 'nbook/app/composables/useClientSanitizer'
import { renderMermaid, type MermaidRenderResult } from 'nbook/app/utils/workflow-preview/render-mermaid'

const props = defineProps<{
  code: string
  /** 图容器最大高度；为空时保持 preview 页原有的不限高行为。 */
  maxHeight?: number
}>()

const result = ref<MermaidRenderResult | null>(null)
let renderRevision = 0

watch(() => props.code, async (code) => {
  const revision = ++renderRevision
  const next = code ? await renderMermaid(code) : null
  if (revision === renderRevision) {
    result.value = next
  }
}, { immediate: true })

const clientSanitizer = useClientSanitizer()
const safeSvg = computed(() => result.value?.ok ? clientSanitizer.value(result.value.svg) : '')
</script>

<template>
  <!-- Mermaid 图容器：preview 与聊天气泡复用；背景走主题变量，失败时保留源码。 -->
  <div
    class="workflow-mermaid overflow-auto rounded-lg border border-[var(--border-color)] p-3"
    :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
  >
    <!-- eslint-disable vue/no-v-html -->
    <div
      v-if="result?.ok"
      v-html="safeSvg"
    />
    <!-- eslint-enable vue/no-v-html -->
    <div
      v-else-if="result"
      class="space-y-2"
    >
      <div class="text-xs text-[var(--status-danger)]">
        Mermaid 渲染失败：{{ result.error }}
      </div>
      <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">{{ props.code }}</pre>
    </div>
  </div>
</template>

<style scoped>
.workflow-mermaid { background: var(--bg-main); min-height: 48px; }
</style>
