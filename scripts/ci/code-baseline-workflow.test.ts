import { describe, expect, it } from 'vitest'

import rootVitestConfig from 'nbook/vitest.config'

describe('code baseline resource contract', () => {
  it('runs the root Vitest suite with one worker', () => {
    expect(rootVitestConfig).toMatchObject({
      test: {
        maxWorkers: 1,
      },
    })
  })
})
