import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupProfileArtifactStaging,
  compileProfileArtifacts,
  PROFILE_ARTIFACT_STAGING_DIR_NAME,
  PROFILE_ARTIFACT_STAGING_LEASE_LOCK,
  PROFILE_ARTIFACT_STAGING_MAX_AGE_MS,
  PROFILE_ARTIFACT_STAGING_OWNER,
  PROFILE_ARTIFACT_STAGING_OWNER_FILE,
  PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA,
  stageProfileArtifactEntry,
  sweepProfileArtifactStaging,
  type ProfileArtifactStagingOwner,
} from 'nbook/server/agent/profiles/profile-artifact-compiler'

const roots: string[] = []
const leasedDirs: string[] = []

afterEach(async () => {
  await Promise.all(leasedDirs.splice(0).map(dir => cleanupProfileArtifactStaging(dir)))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** 创建测试 staging 根。 */
async function createStagingRoot(): Promise<{ root: string, stagingRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'nbook-profile-staging-'))
  roots.push(root)
  return { root, stagingRoot: join(root, '.staging') }
}

/** 写入一个由 Profile compiler owner 声明的 staging operation。 */
async function seedOwnedStaging(stagingRoot: string, operationId: string, startedAt: string): Promise<string> {
  const operationRoot = join(stagingRoot, PROFILE_ARTIFACT_STAGING_DIR_NAME, operationId)
  const marker: ProfileArtifactStagingOwner = {
    schema: PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA,
    owner: PROFILE_ARTIFACT_STAGING_OWNER,
    operationId,
    pid: process.pid,
    startedAt,
  }
  await mkdir(operationRoot, { recursive: true })
  await writeFile(
    join(operationRoot, PROFILE_ARTIFACT_STAGING_OWNER_FILE),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf8',
  )
  return operationRoot
}

describe('Profile artifact staging lifecycle', () => {
  it('existing artifact 的 skipFresh/forbid 校验把 sourceRoot 传给 compiler context', async () => {
    const { root } = await createStagingRoot()
    const profileRoot = join(root, 'profiles')
    const sourceRoot = resolve('.')
    await mkdir(profileRoot, { recursive: true })
    await writeFile(join(profileRoot, 'existing.profile.ts'), `import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
export default defineAgentProfile({
    manifest: {key: "existing", name: "Existing"},
    initialSchema: Type.Object({}),
    tools: toolset(),
    prepare: () => ({}),
});
`, 'utf8')
    await compileProfileArtifacts({ profileRoot, sourceRoot })

    const compilerContext = await import('nbook/server/utils/runtime-artifact-compiler-context')
    const original = compilerContext.resolveRuntimeArtifactCompilerContext
    const observedRoots: Array<string | undefined> = []
    const spy = vi.spyOn(compilerContext, 'resolveRuntimeArtifactCompilerContext')
      .mockImplementation(async (root?: string) => {
        observedRoots.push(root)
        return await original(root)
      })
    try {
      const result = await compileProfileArtifacts({
        profileRoot,
        sourceRoot,
        skipFresh: true,
        writePolicy: 'forbid',
      })
      expect(result.compiled).toEqual([])
    }
    finally {
      spy.mockRestore()
    }

    expect(observedRoots).toContain(sourceRoot)
  })

  it('超过 24 小时且没有活跃 lease 的同 owner staging 会被回收', async () => {
    const { stagingRoot } = await createStagingRoot()
    const now = Date.now()
    const operationRoot = await seedOwnedStaging(
      stagingRoot,
      'stale-operation',
      new Date(now - PROFILE_ARTIFACT_STAGING_MAX_AGE_MS - 1_000).toISOString(),
    )

    const report = await sweepProfileArtifactStaging(stagingRoot, now)

    expect(report).toEqual({ scanned: 1, fresh: 0, active: 0, deleted: 1, malformed: 0, failed: 0 })
    await expect(access(operationRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('owner marker 已过期但 proper-lockfile heartbeat 仍活跃时绝不删除', async () => {
    const { root, stagingRoot } = await createStagingRoot()
    const profileRoot = join(root, 'profiles')
    await mkdir(profileRoot, { recursive: true })
    await writeFile(join(profileRoot, 'active.profile.ts'), `export default {
    manifest: {key: "active"},
    initialSchema: {},
    tools: {},
    rootToolKeys: [],
    prepare: () => ({}),
};
`, 'utf8')
    const staged = await stageProfileArtifactEntry({
      profileRoot,
      fileName: 'active.profile.ts',
      stagingRoot,
    })
    leasedDirs.push(staged.buildCompiledDir)
    const markerPath = join(staged.buildCompiledDir, PROFILE_ARTIFACT_STAGING_OWNER_FILE)
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as ProfileArtifactStagingOwner
    const now = Date.now()
    await writeFile(markerPath, `${JSON.stringify({
      ...marker,
      startedAt: new Date(now - PROFILE_ARTIFACT_STAGING_MAX_AGE_MS - 1_000).toISOString(),
    }, null, 2)}\n`, 'utf8')

    expect(marker.operationId).toBe(basename(staged.buildCompiledDir))
    expect((await stat(join(staged.buildCompiledDir, PROFILE_ARTIFACT_STAGING_LEASE_LOCK))).isDirectory()).toBe(true)
    const report = await sweepProfileArtifactStaging(stagingRoot, now)

    expect(report).toEqual({ scanned: 1, fresh: 0, active: 1, deleted: 0, malformed: 0, failed: 0 })
    // Bun 与 Node 对成功 access 的返回值不同；没有抛错即表示 active staging 仍存在。
    await access(staged.buildCompiledDir)
  })

  it('无法校验的 marker 即使目录很旧也保守保留', async () => {
    const { stagingRoot } = await createStagingRoot()
    const operationRoot = join(stagingRoot, PROFILE_ARTIFACT_STAGING_DIR_NAME, 'malformed-operation')
    const markerPath = join(operationRoot, PROFILE_ARTIFACT_STAGING_OWNER_FILE)
    await mkdir(operationRoot, { recursive: true })
    await writeFile(markerPath, '{not-json\n', 'utf8')
    const old = (Date.now() - PROFILE_ARTIFACT_STAGING_MAX_AGE_MS - 1_000) / 1_000
    await utimes(markerPath, old, old)
    await utimes(operationRoot, old, old)

    const report = await sweepProfileArtifactStaging(stagingRoot)

    expect(report).toEqual({ scanned: 1, fresh: 0, active: 0, deleted: 0, malformed: 1, failed: 0 })
    await expect(readFile(markerPath, 'utf8')).resolves.toBe('{not-json\n')
  })
})
