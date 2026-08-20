import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareSystemAssets } from 'nbook/server/workspace-files/system-assets-preflight'

const mocks = vi.hoisted(() => ({
  compileProfileArtifacts: vi.fn(async () => ({
    manifest: {
      compilerVersion: 8,
      generatedAt: new Date(0).toISOString(),
      profilesRoot: 'assets/workspace/.nbook/agent/profiles',
      entries: [],
      profiles: [],
    },
    compiledDir: '',
    manifestPath: '',
    compiled: [],
  })),
  compileVariableDefinitions: vi.fn(async () => ({
    compilerVersion: 1,
    generatedAt: new Date(0).toISOString(),
    definitionsRoot: 'assets/workspace/.nbook/agent/variables',
    definitions: [],
  })),
  syncSystemAssetsToUserAssets: vi.fn(),
  resolveSystemNbookRoot: vi.fn(() => 'C:/nbook-source/assets/workspace/.nbook'),
  runtimePathsFromEnv: vi.fn(() => ({ applicationRoot: 'C:/nbook-app' })),
}))

vi.mock('nbook/server/agent/profiles/profile-artifact-compiler', () => ({
  compileProfileArtifacts: mocks.compileProfileArtifacts,
}))
vi.mock('nbook/server/agent/variables/definition-artifact', () => ({
  compileVariableDefinitions: mocks.compileVariableDefinitions,
}))
vi.mock('nbook/server/workspace-files/novel-workspace', () => ({
  syncSystemAssetsToUserAssets: mocks.syncSystemAssetsToUserAssets,
}))
vi.mock('nbook/server/workspace-files/system-workspace-assets', () => ({
  resolveSystemNbookRoot: mocks.resolveSystemNbookRoot,
}))
vi.mock('nbook/server/runtime/paths/runtime-paths', () => ({
  runtimePathsFromEnv: mocks.runtimePathsFromEnv,
}))

describe('System assets preflight lifecycle policy', () => {
  beforeEach(() => {
    mocks.compileProfileArtifacts.mockClear()
    mocks.compileVariableDefinitions.mockClear()
  })

  it('内置 Source Profile 固定使用 builtin_source orphan 预算', async () => {
    await prepareSystemAssets()

    expect(mocks.compileProfileArtifacts).toHaveBeenCalledWith({
      profileRoot: join(resolve('C:/nbook-source/assets/workspace/.nbook'), 'agent', 'profiles'),
      rootLabel: 'assets/workspace/.nbook/agent/profiles',
      skipFresh: true,
      writePolicy: 'allow',
      orphanBudgetPolicy: 'builtin_source',
      publish: undefined,
    })
  })
})
