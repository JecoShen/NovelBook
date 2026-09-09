import { describe, expect, it } from 'vitest'

import rootVitestConfig from 'nbook/vitest.config'

/**
 * 资源合同：本机与 CI 都不允许 Vitest 扇出 worker。
 *
 * 断言从根 `test.maxWorkers` 移到逐个 project。配置已重构成 `projects` 形态，
 * `maxWorkers` 下移到各 project 内，根上不再有这个键，原断言因此恒假——它长期红着
 * 却看不见，因为 agent project 的 setupFiles 加载期先抛了 zod interop 错误，
 * 整个 project 在收集阶段就崩了。逐 project 核验比原来更严：新增 project 必须自己
 * 声明 `maxWorkers: 1`，否则这条会点名它。
 */
describe('code baseline resource contract', () => {
  it('runs every Vitest project with one worker', () => {
    const projects = rootVitestConfig.test?.projects ?? []

    // 空数组会让下面的 filter 断言空转通过。
    expect(projects).not.toHaveLength(0)

    const workerSettings = projects.map((project) => {
      const projectTest = typeof project === 'object' && project !== null && 'test' in project
        ? project.test
        : undefined
      return {
        name: projectTest?.name ?? '(未命名)',
        maxWorkers: projectTest?.maxWorkers,
      }
    })

    // 违规项列表形式：失败信息直接点名是哪个 project 没设成 1。
    expect(workerSettings.filter(setting => setting.maxWorkers !== 1)).toEqual([])
  })
})
