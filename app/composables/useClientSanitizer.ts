import { onMounted, ref, type Ref } from 'vue'

/**
 * 懒加载 DOMPurify 客户端 sanitizer，SSR 期间返回 identity 透传。
 * 仅在 import.meta.client 中动态加载 dompurify 客户端 bundle；
 * 首屏前 sanitize 调用会以 identity 透传，挂载完成后切换到严格 sanitize。
 */
export const useClientSanitizer = (): Ref<(html: string) => string> => {
  const sanitizer = ref<(html: string) => string>((html: string) => html)

  onMounted(() => {
    if (!import.meta.client) {
      return
    }
    void (async () => {
      const { default: createDOMPurify } = await import('dompurify')
      const purifier = createDOMPurify(window)
      sanitizer.value = (html: string) => purifier.sanitize(html) as string
    })()
  })

  return sanitizer
}
