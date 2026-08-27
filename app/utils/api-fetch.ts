export type ApiFetchOptions = {
  notify?: boolean
  errorMessage?: string | false
} & Record<string, unknown>

export async function apiFetch<T>(request: string, options?: ApiFetchOptions): Promise<T> {
  const fetcher = globalThis.$fetch as unknown as (...args: unknown[]) => Promise<unknown>
  return await fetcher(request, options) as T
}
