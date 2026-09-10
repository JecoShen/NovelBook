import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
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
  sessionStoreDir: string | null
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
    record(steps, 'project-directory-created', projectName)

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
    record(steps, 'inline-session-created', sessionId)

    // 合同 1：Idle 会话 abort 无副作用（先于发送任何 prompt）。
    const idleAbort = await postAbort(page, sessionId, { reason: 'acceptance idle no-op' })
    assertEqual(idleAbort.status, 'idle', 'Idle abort 应返回 status:"idle"')
    const idleSideEffects = await readSessionFile(options.sessionStoreDir, sessionId)
    assert(!idleSideEffects.includes('aborted'), 'Idle no-op 不得留下任何 aborted 痕迹')
    record(steps, 'idle-abort-noop')

    // browser 模式 composer 内联在 .ide-prompt-bar（桌面标题栏面板按钮是 desktop-bridge 专属）。
    await sendMessage(page, options.prompt)
    const { button: stopButton } = await findTitleButton(page, ['停止'])
    await stopButton.waitFor({ state: 'visible', timeout: FIRST_TOKEN_TIMEOUT_MS })
    await page.waitForTimeout(2_000) // 让部分 token 落屏，验证中止后保留。
    await shot(page, options.evidenceDir, '02-running')
    record(steps, 'run-streaming')

    // 合同 2+3：Running 点击「停止」→ 200 {status:"aborted"}；abort POST 200 仅表示"接受"，
    // durable aborted 终态（HTTP recovery + JSONL 唯一 lifecycle）必须在超时内落盘。
    const abortResponse = page.waitForResponse(response => response.url().endsWith(`/api/agent/sessions/${sessionId}/abort`))
    await stopButton.click()
    const abortJson = await (await abortResponse).json() as { status?: string }
    assertEqual(abortJson.status, 'aborted', 'Running abort 应返回 status:"aborted"')
    const durable = await assertDurableTerminal(page, options.url, sessionId, options.sessionStoreDir, FIRST_TOKEN_TIMEOUT_MS)
    assert(durable.abortedLifecycleCount === 1, `aborted lifecycle 必须唯一（实测 ${durable.abortedLifecycleCount}）`)
    await shot(page, options.evidenceDir, '03-after-abort')
    record(steps, 'ui-abort-roundtrip', durable)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openProjectWorkspace(page, options.url, projectName, filePath)
    await page.locator('.ide-prompt-bar').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
    assert((await page.locator('[title="停止"]:visible').count()) === 0, 'reload 后不应残留运行态')
    const composer = await findComposerInput(page)
    assert(await composer.isVisible(), 'reload 后 composer 应恢复可输入')
    await shot(page, options.evidenceDir, '04-after-reload')
    record(steps, 'reload-idle-composer-ready')

    // 合同 4：已终结 invocation 重复 abort 幂等返回 idle，且不再追加终态。
    const secondAbort = await postAbort(page, sessionId, { reason: 'acceptance repeat no-op' })
    assertEqual(secondAbort.status, 'idle', '重复 abort 应幂等返回 status:"idle"')
    const afterRepeat = await countAborted(options.sessionStoreDir, sessionId)
    assert(afterRepeat === durable.abortedLifecycleCount, '重复 abort 不得追加 aborted lifecycle 记录')
    record(steps, 'repeat-abort-idempotent', { afterRepeat })
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

/** 在多个候选 title 中找可见按钮（inline editor "发送给 Inline AI" / agent chat "发送"）。 */
async function findTitleButton(page: Page, titles: readonly string[]) {
  for (const title of titles) {
    const button = page.locator(`[title="${title}"]:visible`).first()
    if (await button.count() && await button.isVisible()) {
      return { button, title }
    }
  }
  throw new Error(`未找到可见按钮（候选 title: ${titles.join(' / ')}）`)
}

/** 定位 composer 输入（inline bar 的 contenteditable / textarea；页面级兜底）。 */
async function findComposerInput(page: Page) {
  const candidates = [
    page.locator('.ide-prompt-bar [contenteditable="true"]'),
    page.locator('.ide-prompt-bar textarea'),
    page.locator('[data-agent-panel] [contenteditable="true"]'),
    page.locator('[data-agent-panel] textarea'),
  ]
  for (const candidate of candidates) {
    if (await candidate.count() && await candidate.first().isVisible()) {
      return candidate.first()
    }
  }
  throw new Error('未在 inline bar / Agent 面板找到可见 composer 输入元素')
}

/** 输入 prompt 并点发送（inline 模式无独立面板；发送按钮取首个可见）。 */
async function sendMessage(page: Page, prompt: string): Promise<void> {
  const input = await findComposerInput(page)
  await input.click()
  await page.keyboard.type(prompt, { delay: 5 })
  const { button } = await findTitleButton(page, ['发送给 Inline AI', '发送'])
  await button.click()
}

/** 读 session JSONL（store 目录可得时用于强断言；不可得返回空串降级）。 */
async function readSessionFile(sessionStoreDir: string | null, sessionId: number): Promise<string> {
  if (!sessionStoreDir) {
    return ''
  }
  try {
    return await readFile(join(sessionStoreDir, `${sessionId}.jsonl`), 'utf8')
  }
  catch {
    return ''
  }
}

/** 统计 aborted lifecycle 行数（entry 行含 "aborted" 的持久化终态）。 */
async function countAborted(sessionStoreDir: string | null, sessionId: number): Promise<number> {
  const raw = await readSessionFile(sessionStoreDir, sessionId)
  if (!raw) {
    return -1
  }
  return raw.split('\n').filter(line => line.includes('"aborted"')).length
}

/** 轮询等待 JSONL 中出现 aborted 终态（合同权威信号；abort POST 200 仅表示"接受"，不表示全部完成）。 */
async function waitForAbortedLifecycle(
  sessionStoreDir: string | null,
  sessionId: number,
  timeoutMs: number,
): Promise<number> {
  if (!sessionStoreDir) {
    return 0
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = await countAborted(sessionStoreDir, sessionId)
    if (count >= 1) {
      return count
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`等待 ${timeoutMs}ms 后 JSONL 中仍未出现 aborted 终态行（sessionId=${sessionId}）`)
}

/** API 层 abort（复用浏览器上下文 Cookie）。 */
async function postAbort(page: Page, sessionId: number, body: Record<string, unknown>): Promise<{ status?: string }> {
  const response = await page.request.post(new URL(`/api/agent/sessions/${sessionId}/abort`, page.url()).href, { data: body })
  assert(response.ok(), `abort HTTP ${response.status()}`)
  return await response.json() as { status?: string }
}

/**
 * 终态持久断言（双通道）：
 * - HTTP recovery 视图必须含 aborted；
 * - 同仓 store 可得时，JSONL 中 aborted 终态行存在且 lifecycle 唯一（计数=1 为合同要求，
 *   出现次数原样返回供报告；0 行说明只写了内存未 durable = 失败）。
 */
async function assertDurableTerminal(
  page: Page,
  baseUrl: string,
  sessionId: number,
  sessionStoreDir: string | null,
  timeoutMs: number,
): Promise<{ httpOccurrences: number, abortedLifecycleCount: number }> {
  if (sessionStoreDir) {
    await waitForAbortedLifecycle(sessionStoreDir, sessionId, timeoutMs)
  }
  const response = await page.request.get(new URL(`/api/agent/sessions/${sessionId}`, baseUrl).href)
  assert(response.ok(), `session recovery HTTP ${response.status()}`)
  const raw = await response.text()
  const httpOccurrences = (raw.match(/aborted/g) ?? []).length
  assert(httpOccurrences >= 1, 'recovery 视图中未出现 aborted 终态')
  const abortedLifecycleCount = await countAborted(sessionStoreDir, sessionId)
  return { httpOccurrences, abortedLifecycleCount }
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
    sessionStoreDir: flag('session-store-dir') ?? process.env.NBOOK_ACCEPTANCE_SESSION_STORE ?? resolve('workspace', '.nbook', 'agent', 'sessions'),
    headless: flag('headless') !== 'false',
    keepProject: argv.includes('--keep-project'),
    prompt: flag('prompt') ?? '请写一个非常详细的长篇奇幻小说故事（至少 3000 字），主题是主角意外发现一本能改变现实的古书。要求：场景描写丰富、人物对话自然、情节层层递进。',
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
