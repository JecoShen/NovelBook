import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureMonacoEnvironment } from 'nbook/app/components/markdown-studio/load-monaco-editor'

describe('loadMonacoEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('为 json language 分配 JSON worker', () => {
    const EditorWorker = function EditorWorker() {} as unknown as { new(): object }
    const JsonWorker = function JsonWorker() {} as unknown as { new(): object }

    vi.stubGlobal('MonacoEnvironment', undefined)
    ensureMonacoEnvironment({
      editor: EditorWorker as never,
      json: JsonWorker as never,
    })

    const environment = globalThis.MonacoEnvironment as {
      getWorker(moduleId: string, label: string): unknown
    }

    expect(environment.getWorker('', 'json')).toBeInstanceOf(JsonWorker)
    expect(environment.getWorker('', 'plaintext')).toBeInstanceOf(EditorWorker)
  })
})
