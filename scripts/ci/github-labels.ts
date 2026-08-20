#!/usr/bin/env bun
import { resolve } from 'node:path'
import process from 'node:process'

import { Command } from 'commander'

import {
  auditOpenIssueLabels,
  compareLabels,
  hasLabelDrift,
  parseOpenIssues,
  parseRemoteLabels,
  readLabelManifest,
  type LabelDrift,
} from 'nbook/scripts/ci/community-labels'
import { run, runCapture } from 'nbook/scripts/utils/process.mjs'

interface CommonOptions {
  repo: string
}

interface ApplyOptions extends CommonOptions {
  deleteExtra: boolean
  yes: boolean
}

const root = resolve(import.meta.dir, '../..')
const defaultRepo = process.env.GITHUB_REPOSITORY ?? 'notnotype/neuro-book'

/** 注册并执行标签维护 CLI。 */
async function main(): Promise<void> {
  const program = new Command()
    .name('github-labels')
    .description('校验或同步 NeuroBook GitHub 标签清单')
    .showHelpAfterError('使用 --help 查看命令')

  program
    .command('check')
    .description('只读检查远端标签和开放 Issue 分流合同')
    .option('--repo <repo>', 'GitHub 仓库 owner/name', defaultRepo)
    .action((options: CommonOptions) => check(options))

  program
    .command('apply')
    .description('创建缺失标签并更新已有标签元数据')
    .option('--repo <repo>', 'GitHub 仓库 owner/name', defaultRepo)
    .option('--delete-extra', '删除清单外的远端标签', false)
    .option('--yes', '确认写入 GitHub 远端', false)
    .action((options: ApplyOptions) => apply(options))

  await program.parseAsync(process.argv)
}

/** 读取本地清单与 GitHub 远端状态。 */
async function loadState(repo: string): Promise<{
  drift: LabelDrift
  issueViolations: ReturnType<typeof auditOpenIssueLabels>
}> {
  const expected = await readLabelManifest(resolve(root, '.github/labels.yml'))
  const remoteLabels = parseRemoteLabels(await runCapture('gh', [
    'label',
    'list',
    '--repo',
    repo,
    '--limit',
    '1000',
    '--json',
    'name,color,description',
  ], { cwd: root }))
  const issues = parseOpenIssues(await runCapture('gh', [
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,title,labels',
  ], { cwd: root }))
  return {
    drift: compareLabels(expected, remoteLabels),
    issueViolations: auditOpenIssueLabels(issues),
  }
}

/** 以可操作文本输出标签漂移。 */
function printDrift(drift: LabelDrift): void {
  for (const label of drift.missing) {
    console.error(`缺少远端标签: ${label.name}`)
  }
  for (const label of drift.changed) {
    console.error(`标签元数据漂移: ${label.expected.name}`)
  }
  for (const label of drift.extra) {
    console.error(`清单外远端标签: ${label.name}`)
  }
}

/** 只读检查远端标签与开放 Issue。 */
async function check(options: CommonOptions): Promise<void> {
  const state = await loadState(options.repo)
  printDrift(state.drift)
  for (const violation of state.issueViolations) {
    console.error(`#${violation.number} ${violation.title}: ${violation.message}`)
  }
  if (hasLabelDrift(state.drift) || state.issueViolations.length > 0) {
    throw new Error('GitHub 标签或开放 Issue 分流与仓库合同不一致')
  }
  console.log(`GitHub 标签检查通过：${options.repo}`)
}

/** 按清单创建、更新标签，并按显式参数决定是否删除额外标签。 */
async function apply(options: ApplyOptions): Promise<void> {
  if (!options.yes) {
    throw new Error('写入 GitHub 前必须显式传入 --yes；只读预览请使用 check')
  }

  const expected = await readLabelManifest(resolve(root, '.github/labels.yml'))
  const remote = parseRemoteLabels(await runCapture('gh', [
    'label',
    'list',
    '--repo',
    options.repo,
    '--limit',
    '1000',
    '--json',
    'name,color,description',
  ], { cwd: root }))
  const drift = compareLabels(expected, remote)

  for (const label of drift.missing) {
    await run('gh', [
      'label',
      'create',
      label.name,
      '--repo',
      options.repo,
      '--color',
      label.color,
      '--description',
      label.description,
    ], { cwd: root })
  }
  for (const label of drift.changed) {
    await run('gh', [
      'label',
      'edit',
      label.expected.name,
      '--repo',
      options.repo,
      '--color',
      label.expected.color,
      '--description',
      label.expected.description,
    ], { cwd: root })
  }
  if (options.deleteExtra) {
    for (const label of drift.extra) {
      await run('gh', [
        'label',
        'delete',
        label.name,
        '--repo',
        options.repo,
        '--yes',
      ], { cwd: root })
    }
  }
  else {
    for (const label of drift.extra) {
      console.warn(`保留清单外远端标签: ${label.name}；确认删除时使用 --delete-extra --yes`)
    }
  }

  console.log(`GitHub 标签同步完成：${options.repo}`)
}

await main()
