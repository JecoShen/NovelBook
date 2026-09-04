import { expect } from 'vitest'

function normalizeSourceContract(value: string): string {
  return value
    .replace(/["']/gu, '"')
    .replaceAll(';', '')
    .replace(/\s+/gu, '')
    .replace(/\(([A-Za-z_$][\w$]*)\)=>/gu, '$1=>')
}

function isPlainCopy(value: string): boolean {
  return /^[\p{L}\p{N} .-]+$/u.test(value.trim())
}

expect.extend({
  toContainSource(received: string, expected: string) {
    const normalizedReceived = isPlainCopy(expected) ? received : normalizeSourceContract(received)
    const normalizedExpected = isPlainCopy(expected) ? expected : normalizeSourceContract(expected)
    const pass = normalizedReceived.includes(normalizedExpected)

    return {
      pass,
      message: () => pass
        ? `expected source not to contain ${this.utils.printExpected(expected)}`
        : `expected source to contain ${this.utils.printExpected(expected)}`,
    }
  },
})

declare module 'vitest' {
  // Vitest declares this generic with `any`; module augmentation must match it exactly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> {
    toContainSource(expected: string): T
  }
  interface AsymmetricMatchersContaining {
    toContainSource(expected: string): unknown
  }
}
