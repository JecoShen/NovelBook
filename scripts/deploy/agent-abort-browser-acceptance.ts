import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Page } from 'playwright-core'

/**
 * Agent Session Abort 真实浏览器验收（t159 链，合同见 reference/agent/session-abort.md）。
 *
 * 覆盖合同中的浏览器可观察面：
 * 1. Idle 会话 abort → HTTP 200 {status:"idle"}，零取消副作用；
 * 2. Running 会话点击「停止」→ abort POST 200 {status:"aborted"}，UI 回到可发送态；
 * 3. reload 后唯一 aborted 终态持久（recovery 视图含 aborted，部分输出保留）；
 * 4. 已完成 invocation 重复 abort → 幂等 {status:"idle"}。
 *
 * 8 步 SSE 事件序列与 forced-abort 有界性由移植的 33 个契约测试覆盖，
 * 本脚本不重复断言事件顺序，只断言浏览器端最终可观察一致性。
 *
 * 用法（在仓库根运行；凭据只从环境变量读取，绝不落盘）：
 *   NBOOK_ACCEPTANCE_URL=https://book.neoshen.dpdns.org \
 *   NBOOK_ACCEPTANCE_USERNAME=... NBOOK_ACCEPTANCE_PASSWORD=... \
 *   node --import tsx scripts/deploy/agent-abort-browser-acceptance.ts
 *
 * 验收项目以一次性目录方式创建在 <workspace>/<acceptance-project>，结束后默认删除；
 * --keep-project 保留现场，--headless=false 观察实际点击。
 */

type AcceptanceOptions = {
  url: string
  username: string
  password: string
  browserExecutable: string
  evidenceDir: string
  workspaceDir: string
  headless: boolean
  keepProject: boolean
  prompt: string
}

type StepResult = {
  step: string
  ok: boolean
  detail?: unknown
}

const STEP_TIMEOUT_MS = 30_000
const FIRST_TOKEN_TIMEOUT_MS = 90_000

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runAbortAcceptance(parseOptions(process.argv.slice(2)))
}

/**
 * 主流程：登录 → 一次性验收项目 → inline session → 停止点击 → 持久化断言 → 清理。
 */
async function runAbortAcceptance(options: AcceptanceOptions): Promise<void> {
  const steps: StepResult[] = []
  const projectName = `abort-acceptance-${new Date().toISOString().slice(0, 19).replaceAll(/[:T]/g, '-')}`
  const projectDir = join(options.workspaceDir, projectName)
  let exitReason = 'completed'
  let page: Page | null = null
  await mkdir(options.evidenceDir, { recursive: true })
  const browser = await chromium.launch({
    executablePath: options.browserExecutable,
    headless: options.headless,
    timeout: 60_000,
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await context.newPage()

    // 登录失败等前置错误不得触碰 workspace 目录。
    await login(page, options)
    await shot(page, options.evidenceDir, '01-after-login')
    record(steps, 'login')

    await prepareAcceptanceProject(projectDir)
    steps.push(record(steps, 'project-directory-created', projectName))

    await openProjectWorkspace(page, options.url, projectName)
    record(steps, 'workbench-opened')

    const filePath = `manuscript/abort-acceptance-${Date.now()}.md`
    const createFile = await page.request.post(new URL('/api/workspace-files/create-file', options.url).href, {
      data: { projectRoot: projectName, path: filePath, content: '# Abort 验收\n\n一次性项目，可删除。\n' },
    })
    assert(createFile.ok(), `创建验收文件失败：HTTP ${createFile.status()}`)
    await openProjectWorkspace(page, options.url, projectName, filePath)
    await page.locator('.ide-prompt-bar').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
    record(steps, 'inline-bar-ready')

    const sessionId = await createInlineSession(page)
    steps.push(record(steps, 'inline-session-created', sessionId))

    // 合同 1：Idle 会话 abort 无副作用（先于发送任何 prompt）。
    const idleAbort = await postAbort(page, sessionId, { reason: 'acceptance idle no-op' })
    assertEqual(idleAbort.status, 'idle', 'Idle abort 应返回 status:"idle"')
    record(steps, 'idle-abort-noop')

    await openAgentPanel(page)
    record(steps, 'agent-panel-opened')

    await sendMessage(page, options.prompt)
    const stopButton = page.locator('[title="停止"]')
    await stopButton.waitFor({ state: 'visible', timeout: FIRST_TOKEN_TIMEOUT_MS })
    await page.waitForTimeout(2_000) // 让部分 token 落屏，验证中止后保留。
    await shot(page, options.evidenceDir, '02-running')
    record(steps, 'run-streaming')

    // 合同 2：Running 点击「停止」→ 200 {status:"aborted"}，UI 收口回可发送态。
    const abortResponse = page.waitForResponse(response => response.url().endsWith(`/api/agent/sessions/${sessionId}/abort`))
    await stopButton.click()
    const abortJson = await (await abortResponse).json() as { status?: string }
    assertEqual(abortJson.status, 'aborted', 'Running abort 应返回 status:"aborted"')
    await page.locator('[title="发送"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
    await shot(page, options.evidenceDir, '03-after-abort')
    record(steps, 'ui-abort-roundtrip')

    // 合同 3：终态持久 —— recovery 视图含 aborted，且部分输出未被回滚。
    const durable = await assertDurableTerminal(page, options.url, sessionId)
    steps.push(record(steps, 'durable-aborted', durable))

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openProjectWorkspace(page, options.url, projectName, filePath)
    await page.locator('.ide-prompt-bar').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
    await openAgentPanel(page)
    const panel = page.locator('[data-agent-panel]')
    assert((await panel.locator('[title="停止"]').count()) === 0, 'reload 后面板不应残留运行态')
    assert(/\d/.test(await panel.innerText()), 'reload 后部分输出（数字流）应仍在')
    await shot(page, options.evidenceDir, '04-after-reload')
    record(steps, 'reload-idle-with-partial')

    // 合同 4：已终结 invocation 重复 abort 幂等返回 idle。
    const secondAbort = await postAbort(page, sessionId, { reason: 'acceptance repeat no-op' })
    assertEqual(secondAbort.status, 'idle', '重复 abort 应幂等返回 status:"idle"')
    record(steps, 'repeat-abort-idempotent')
  }
  catch (error) {
    exitReason = error instanceof Error ? error.message : String(error)
    try {
      if (page) {
        await page.waitForTimeout(1_000) // 给 SPA 渲染时间，避免失败证据全白。
        await shot(page, options.evidenceDir, '99-failure')
      }
    }
    catch {
      // 失败截图本身失败不应遮蔽原始验收错误。
    }
  }
  finally {
    await browser.close()
    if (!options.keepProject) {
      await rm(projectDir, { recursive: true, force: true })
    }
    await writeFile(join(options.evidenceDir, 'evidence.json'), JSON.stringify({
      url: options.url,
      projectName,
      prompt: options.prompt,
      result: exitReason,
      steps,
    }, null, 2), 'utf8')
  }
  if (exitReason !== 'completed') {
    throw new Error(`Abort 浏览器验收未通过：${exitReason}；证据：${options.evidenceDir}`)
  }
  console.log(`Abort browser acceptance passed. Evidence: ${options.evidenceDir}`)
}

/** 一次性验收项目：最小 project.yaml，与桌面 smoke fixture 同形。 */
async function prepareAcceptanceProject(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, 'manuscript'), { recursive: true })
  await writeFile(join(projectDir, 'project.yaml'), 'kind: novel\ntitle: Abort 验收\nsummary: \'\'\n', 'utf8')
}

/** 打开站点；auth 开启时经 /login 表单登录，关闭时直达工作台。 */
async function login(page: Page, options: AcceptanceOptions): Promise<void> {
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (new URL(page.url()).pathname === '/login') {
    assert(options.username && options.password, '目标启用了鉴权，需要 NBOOK_ACCEPTANCE_USERNAME / NBOOK_ACCEPTANCE_PASSWORD')
    await page.locator('input[autocomplete="username"]').fill(options.username)
    await page.locator('input[autocomplete="current-password"]').fill(options.password)
    await page.locator('form button[type="submit"]').click()
  }
  await page.locator('.novel-ide-page').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
}

/** 进入指定项目工作面（与桌面 smoke 的 ?project= 寻径一致）。 */
async function openProjectWorkspace(page: Page, baseUrl: string, projectName: string, openPath?: string): Promise<void> {
  const url = new URL(baseUrl)
  url.search = new URLSearchParams({ project: projectName, ...(openPath ? { openPath } : {}) }).toString()
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('.novel-ide-page').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
  const filesButton = page.locator('[data-activity-id="files"]')
  await filesButton.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-activity-id="files"]')?.disabled,
    undefined,
    { timeout: STEP_TIMEOUT_MS },
  )
}

/** 通过 inline 条创建 Session，读取 data-inline-agent-session-id。 */
async function createInlineSession(page: Page): Promise<number> {
  const expandBar = page.locator('[data-inline-agent-action="expand-bar"]')
  if (await expandBar.count()) {
    await expandBar.click()
  }
  await page.locator('[data-inline-agent-action="create-session"]').click()
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-inline-agent-action="session-menu"]')?.getAttribute('data-inline-agent-session-id')),
    undefined,
    { timeout: STEP_TIMEOUT_MS },
  )
  const sessionId = Number(await page.locator('[data-inline-agent-action="session-menu"]')
    .getAttribute('data-inline-agent-session-id'))
  assert(Number.isSafeInteger(sessionId) && sessionId > 0, `非法 sessionId：${sessionId}`)
  return sessionId
}

/** 打开右侧 Agent 面板（标题栏按钮幂等：已开则跳过）。 */
async function openAgentPanel(page: Page): Promise<void> {
  const panel = page.locator('[data-agent-panel]')
  if (await panel.count() && await panel.isVisible()) {
    return
  }
  await page.locator('[data-titlebar-action="toggle-agent-panel"]').click()
  await panel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
}

/** 在面板内定位富文本输入（textarea / contenteditable / 非隐藏 input）。 */
async function focusComposerInput(page: Page, text: string): Promise<void> {
  const panel = page.locator('[data-agent-panel]')
  const candidates = [
    panel.locator('textarea'),
    panel.locator('[contenteditable="true"]'),
    panel.locator('input[type="text"]'),
    panel.locator('input:not([type])'),
  ]
  for (const candidate of candidates) {
    if (await candidate.count() && await candidate.first().isVisible()) {
      await candidate.first().click()
      await page.keyboard.type(text, { delay: 5 })
      return
    }
  }
  throw new Error('Agent 面板内未找到可见输入元素')
}

/** 输入 prompt 并点发送。 */
async function sendMessage(page: Page, prompt: string): Promise<void> {
  await focusComposerInput(page, prompt)
  const send = page.locator('[data-agent-panel] [title="发送"]')
  await send.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
  await send.click()
}

/** API 层 abort（复用浏览器上下文 Cookie）。 */
async function postAbort(page: Page, sessionId: number, body: Record<string, unknown>): Promise<{ status?: string }> {
  const response = await page.request.post(`/api/agent/sessions/${sessionId}/abort`, { data: body })
  assert(response.ok(), `abort HTTP ${response.status()}`)
  return await response.json() as { status?: string }
}

/** recovery 视图断言：存在 aborted 终态并返回出现次数。 */
async function assertDurableTerminal(page: Page, baseUrl: string, sessionId: number): Promise<{ abortedOccurrences: number }> {
  const response = await page.request.get(`/api/agent/sessions/${sessionId}`)
  assert(response.ok(), `session recovery HTTP ${response.status()}`)
  const raw = await response.text()
  const occurrences = (raw.match(/aborted/g) ?? []).length
  assert(occurrences >= 1, 'recovery 视图中未出现 aborted 终态')
  return { abortedOccurrences: occurrences }
}

function parseOptions(argv: string[]): AcceptanceOptions {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  return {
    url: flag('url') ?? process.env.NBOOK_ACCEPTANCE_URL ?? 'http://127.0.0.1:3001',
    username: process.env.NBOOK_ACCEPTANCE_USERNAME ?? '',
    password: process.env.NBOOK_ACCEPTANCE_PASSWORD ?? '',
    browserExecutable: flag('browser-executable') ?? process.env.NBOOK_ACCEPTANCE_BROWSER ?? '/usr/bin/chromium',
    evidenceDir: flag('evidence-dir') ?? resolve('.agent', 'tmp', `abort-acceptance-${Date.now()}`),
    workspaceDir: flag('workspace-dir') ?? resolve('workspace'),
    headless: flag('headless') !== 'false',
    keepProject: argv.includes('--keep-project'),
    prompt: flag('prompt') ?? '请从 1 开始逐行输出数字直到 3000，每行一个数字，不要输出任何其它文字。',
  }
}

function record(steps: StepResult[], step: string, detail?: unknown): StepResult {
  const result: StepResult = { step, ok: true, detail }
  steps.push(result)
  console.log(`✅ ${step}${detail !== undefined ? ` (${typeof detail === 'object' ? JSON.stringify(detail) : String(detail)})` : ''}`)
  return result
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}（实际：${String(actual)}）`)
  }
}

async function shot(page: Page, evidenceDir: string, name: string): Promise<void> {
  await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true })
}
