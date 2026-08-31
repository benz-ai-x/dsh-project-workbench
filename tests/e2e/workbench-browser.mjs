#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const materializer = join(repositoryRoot, 'profiles/workbench-test/materialize.mjs')
const referenceLock = JSON.parse(readFileSync(join(repositoryRoot, 'dsh-reference.lock.json'), 'utf8'))
const configuredBaselineRoot = process.env.DSH_HARNESS_BASELINE_ROOT?.trim()
const dshBaselineRoot = resolve(
  configuredBaselineRoot === undefined || configuredBaselineRoot === ''
    ? join(repositoryRoot, referenceLock.localResolution.fallbackRelativePath)
    : configuredBaselineRoot,
)
const dshBin = join(dshBaselineRoot, 'apps/cli/lib/bin.js')
const profileName = 'workbench-test'

const COMMAND_TIMEOUT_MS = 60_000
const STARTUP_TIMEOUT_MS = 60_000
const PAGE_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const MAX_CAPTURED_OUTPUT = 512 * 1024
const tempPrefixName = 'dsh-workbench-browser-'
const CLIENT_PACKAGE_ID = '@benz-ai-x/dsh-project-workbench-client'
const OWNER_SESSION_COOKIE_NAME = '__Host-dsh-workbench-session'
const OWNER_AUTH_STATE_PATH = '/api/workbench-auth/state'
const OWNER_AUTH_INITIALIZE_PATH = '/api/workbench-auth/initialize'
const WORKBENCH_SNAPSHOT_PATH = '/api/workbench/snapshot'
const WORKBENCH_ACTIVITY_PATH = '/api/workbench/activity'
const WORKBENCH_AUDIT_INTEGRITY_PATH = '/api/workbench/auditIntegrity'
const WORKBENCH_PROJECT_START_PATH = '/api/workbench/projectStart'
const WORKBENCH_CREATE_PROJECT_PATH = '/api/workbench/createProject'
const WORKBENCH_PROJECT_PATH = '/api/workbench/project'
const WORKBENCH_PROJECT_TEAM_PATH = '/api/workbench/projectTeam'
const WORKBENCH_ADD_PROJECT_MEMBER_PATH = '/api/workbench/addProjectMember'
const WORKBENCH_SET_PROJECT_MEMBER_STATUS_PATH = '/api/workbench/setProjectMemberStatus'
const WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH = '/api/workbench/setProjectResponsibility'
const WORKBENCH_REVIEW_CENTER_PATH = '/api/workbench/reviewCenter'
const WORKBENCH_PROPOSE_RESPONSIBILITY_CHANGE_PATH = '/api/workbench/proposeProjectResponsibilityChange'
const WORKBENCH_DECIDE_SUGGESTED_CHANGE_PATH = '/api/workbench/decideSuggestedChange'
const WORKBENCH_FEISHU_CONNECTION_PATH = '/api/workbench/feishuConnectionCenter'
const WORKBENCH_CONFIGURE_FEISHU_ROUTE_PATH = '/api/workbench/configureFeishuIdentityRoute'
const WORKBENCH_VERIFY_FEISHU_ROUTE_PATH = '/api/workbench/verifyFeishuIdentityRoute'
const WORKBENCH_PROJECT_TASKS_PATH = '/api/workbench/projectTasks'
const WORKBENCH_DISCOVER_TASK_WORKFLOW_FIELDS_PATH
  = '/api/workbench/discoverFeishuTaskWorkflowFields'
const WORKBENCH_PREVIEW_TASK_WORKFLOW_PATH = '/api/workbench/previewFeishuTaskWorkflow'
const WORKBENCH_CONFIGURE_TASK_WORKFLOW_PATH = '/api/workbench/configureFeishuTaskWorkflow'
const WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH = '/api/workbench/discoverFeishuCalendars'
const WORKBENCH_BIND_PROJECT_CALENDAR_PATH = '/api/workbench/bindProjectCalendar'
const WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH
  = '/api/workbench/discoverFeishuCalendarEvents'
const WORKBENCH_GET_PROJECT_MILESTONES_PATH = '/api/workbench/getProjectMilestones'
const WORKBENCH_CREATE_PROJECT_MILESTONE_PATH = '/api/workbench/createProjectMilestone'
const WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH
  = '/api/workbench/updateProjectMilestoneDate'
const WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH = '/api/workbench/reconcileProjectCalendar'
const WORKBENCH_PROJECT_DELIVERABLES_PATH = '/api/workbench/projectDeliverables'
const WORKBENCH_CREATE_PROJECT_DELIVERABLE_PATH = '/api/workbench/createProjectDeliverable'
const WORKBENCH_REQUEST_DELIVERABLE_ACCEPTANCE_PATH
  = '/api/workbench/requestDeliverableAcceptance'
const WORKBENCH_DECIDE_DELIVERABLE_ACCEPTANCE_PATH
  = '/api/workbench/decideDeliverableAcceptance'
const PROJECT_MILESTONE_OPERATION_PATHS = Object.freeze([
  WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH,
  WORKBENCH_BIND_PROJECT_CALENDAR_PATH,
  WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH,
  WORKBENCH_CREATE_PROJECT_MILESTONE_PATH,
  WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH,
  WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH,
])
const WORKBENCH_CLIENT_STYLE_IDS = Object.freeze([
  'ActivityPanel.module.css',
  'FeishuConnectionPanel.module.css',
  'OwnerPage.module.css',
  'ProjectDeliverablesPanel.module.css',
  'ProjectMilestonesPanel.module.css',
  'ProjectTasksPanel.module.css',
  'ProjectTeamPanel.module.css',
  'ProjectsPanel.module.css',
  'ReviewCenterPanel.module.css',
  'WorkbenchStatusPage.module.css',
].map(name => `${CLIENT_PACKAGE_ID}/${name}`))
const DESKTOP_VIEWPORT = Object.freeze({ width: 1280, height: 720 })
const MOBILE_VIEWPORT = Object.freeze({ width: 375, height: 812 })

let browser
let tempRoot
let visualArtifactRoot
let pendingBundleRestore
let cleanupStarted = false
let reportedMobileShell = false
const runningHosts = new Set()

function chromeCandidates() {
  const explicit = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH?.trim()
  if (explicit !== undefined && explicit !== '') return [resolve(explicit)]
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (process.platform === 'win32') {
    return [
      process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ].filter(Boolean)
  }
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
}

function resolveChromeExecutable() {
  const executable = chromeCandidates().find(candidate => existsSync(candidate))
  assert.notEqual(executable, undefined, [
    'No supported Chromium executable was found.',
    'Set DSH_PLAYWRIGHT_EXECUTABLE_PATH to an installed Chrome/Chromium binary.',
  ].join(' '))
  return executable
}

function appendBounded(current, chunk) {
  const next = current + String(chunk)
  return next.length <= MAX_CAPTURED_OUTPUT
    ? next
    : next.slice(next.length - MAX_CAPTURED_OUTPUT)
}

function redact(value) {
  return value
    .replace(/([?&]token=)[^&\s)]+/gu, '$1<redacted>')
    .replace(/\bWB1-(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}\b/gu, '<redacted-recovery-code>')
}

function commandFailure(label, code, signal, stdout, stderr) {
  return new Error([
    `${label} failed (code=${String(code)}, signal=${String(signal)})`,
    `stdout:\n${redact(stdout)}`,
    `stderr:\n${redact(stderr)}`,
  ].join('\n'))
}

async function runCommand(label, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk) })
  child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk) })
  if (options.stdin !== undefined) child.stdin.end(options.stdin)

  const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      rejectOutcome(new Error(`${label} exceeded ${String(options.timeoutMs)} ms`))
    }, options.timeoutMs)
    child.once('error', error => {
      clearTimeout(timeout)
      rejectOutcome(new Error(`${label} could not start`, { cause: error }))
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveOutcome({ code, signal })
    })
  })
  if (outcome.code !== 0 && options.allowFailure !== true) {
    throw commandFailure(label, outcome.code, outcome.signal, stdout, stderr)
  }
  return { ...outcome, stdout, stderr }
}

function scrubbedRuntimeEnvironment(dshHome, agentsHome) {
  const credentialName = /(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|credential|authorization|cookie)/iu
  const proxyNames = new Set([
    'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY',
    'all_proxy', 'http_proxy', 'https_proxy',
  ])
  const env = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || credentialName.test(name) || proxyNames.has(name)
      || name === 'DSH_HARNESS_ROOT') continue
    env[name] = value
  }
  return {
    ...env,
    DSH_AGENTS_HOME: agentsHome,
    DSH_HARNESS_BASELINE_ROOT: dshBaselineRoot,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    SSH_CONNECTION: '',
    SSH_TTY: '',
  }
}

function hostDiagnostic(host) {
  return [
    `stdout:\n${redact(host.stdout)}`,
    `stderr:\n${redact(host.stderr)}`,
  ].join('\n')
}

async function startDsh(projectDir, env) {
  const child = spawn(process.execPath, [
    dshBin,
    '--profile', profileName,
    '--host', '127.0.0.1',
    '--port', '0',
    '--no-open',
  ], {
    cwd: projectDir,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const host = {
    child,
    stdout: '',
    stderr: '',
    exit: undefined,
  }
  runningHosts.add(host)
  const exited = new Promise(resolveExit => {
    child.once('exit', (code, signal) => {
      host.exit = { code, signal }
      runningHosts.delete(host)
      resolveExit(host.exit)
    })
  })
  host.exited = exited
  child.stdout.on('data', chunk => { host.stdout = appendBounded(host.stdout, chunk) })
  child.stderr.on('data', chunk => { host.stderr = appendBounded(host.stderr, chunk) })

  const readyUrl = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      rejectReady(new Error(`dsh Profile did not become ready within ${String(STARTUP_TIMEOUT_MS)} ms\n${hostDiagnostic(host)}`))
    }, STARTUP_TIMEOUT_MS)
    let settled = false
    const inspect = () => {
      const match = /(?:^|\r?\n)dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u.exec(host.stdout)
      if (match === null || settled) return
      settled = true
      clearTimeout(timeout)
      resolveReady(match[1])
    }
    child.stdout.on('data', inspect)
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectReady(new Error('dsh Profile could not start', { cause: error }))
    })
    void exited.then(({ code, signal }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectReady(commandFailure('dsh Profile startup', code, signal, host.stdout, host.stderr))
    })
  })

  return { host, readyUrl }
}

async function stopDsh(host, assertGraceful = true) {
  if (host.exit === undefined) host.child.kill('SIGTERM')
  let gracefulTimer
  const exitedGracefully = await Promise.race([
    host.exited.then(() => true),
    new Promise(resolveTimeout => {
      gracefulTimer = setTimeout(() => resolveTimeout(false), SHUTDOWN_TIMEOUT_MS)
    }),
  ])
  clearTimeout(gracefulTimer)
  if (!exitedGracefully) {
    host.child.kill('SIGKILL')
    let forceTimer
    const exitedAfterKill = await Promise.race([
      host.exited.then(() => true),
      new Promise(resolveTimeout => {
        forceTimer = setTimeout(() => resolveTimeout(false), 2_000)
      }),
    ])
    clearTimeout(forceTimer)
    if (!exitedAfterKill) {
      throw new Error(`dsh Profile remained alive after SIGKILL\n${hostDiagnostic(host)}`)
    }
    if (assertGraceful) {
      throw new Error(`dsh Profile did not dispose within ${String(SHUTDOWN_TIMEOUT_MS)} ms\n${hostDiagnostic(host)}`)
    }
  }
  if (assertGraceful && (host.exit?.code !== 0 || host.exit?.signal !== null)) {
    throw commandFailure('dsh Profile shutdown', host.exit?.code, host.exit?.signal, host.stdout, host.stderr)
  }
}

function isLoopbackBrowserUrl(value) {
  const url = new URL(value)
  if (['about:', 'blob:', 'data:'].includes(url.protocol)) return true
  return ['http:', 'ws:'].includes(url.protocol)
    && ['127.0.0.1', 'localhost'].includes(url.hostname)
}

async function openCheckedPage(readyUrl, label) {
  const errors = []
  const requests = []
  const context = await browser.newContext({
    locale: 'zh-CN',
    serviceWorkers: 'block',
    viewport: DESKTOP_VIEWPORT,
  })
  await context.route('**/*', async route => {
    const url = route.request().url()
    if (isLoopbackBrowserUrl(url)) {
      await route.fallback()
      return
    }
    errors.push(`${label}: blocked non-loopback request ${url}`)
    await route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*', async socket => {
    if (isLoopbackBrowserUrl(socket.url())) {
      socket.connectToServer()
      return
    }
    errors.push(`${label}: blocked non-loopback WebSocket ${socket.url()}`)
    await socket.close({ code: 1008, reason: 'The Workbench E2E permits loopback only' })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(PAGE_TIMEOUT_MS)
  page.on('request', request => {
    if (requests.length < 2_000) requests.push(request.url())
  })
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${label}: console error: ${message.text()}`)
  })
  page.on('pageerror', error => {
    errors.push(`${label}: page error: ${error.stack ?? error.message}`)
  })

  const response = await page.goto(readyUrl, { waitUntil: 'load' })
  assert.notEqual(response, null, `${label}: authenticated navigation produced no response`)
  assert.ok(response.ok(), `${label}: authenticated navigation returned ${String(response.status())}`)
  assert.equal(new URL(page.url()).hostname, '127.0.0.1')
  assert.equal(new URL(page.url()).searchParams.has('token'), false, `${label}: process token was not exchanged for a cookie`)
  return { context, errors, page, requests }
}

async function assertNoBrowserErrors(journey, allowed = []) {
  await journey.page.waitForTimeout(250)
  const unexpected = journey.errors.filter(value => !allowed.some(pattern => pattern.test(value)))
  assert.deepEqual(unexpected, [], unexpected.join('\n'))
}

async function dismissHarnessOnboarding(page) {
  const deadline = Date.now() + 15_000
  const continueButton = page.getByRole('button', { name: /^(?:继续|Continue)$/u }).first()
  const configureLater = page.getByRole('button', { name: /^(?:稍后配置|Configure later)$/u }).first()
  while (Date.now() < deadline) {
    if (await continueButton.isVisible().catch(() => false)
      && await continueButton.isEnabled().catch(() => false)) {
      await continueButton.click()
      await page.waitForTimeout(100)
      continue
    }
    if (await configureLater.isVisible().catch(() => false)
      && await configureLater.isEnabled().catch(() => false)) {
      await configureLater.click()
      await page.waitForFunction(() => document.getElementById('root')?.inert !== true)
      return
    }
    await page.waitForTimeout(100)
  }
  const dialogs = await page.locator('[role="dialog"]').allTextContents()
  throw new Error(`Harness onboarding did not expose its credential-free continuation: ${JSON.stringify(dialogs)}`)
}

async function installNetworkEvidence(page) {
  const cdp = await page.context().newCDPSession(page)
  const requestUrls = new Map()
  const requestHeaders = new Map()
  const responseHeaders = new Map()
  cdp.on('Network.requestWillBeSent', event => {
    requestUrls.set(event.requestId, event.request.url)
  })
  cdp.on('Network.requestWillBeSentExtraInfo', event => {
    requestHeaders.set(event.requestId, event.headers)
  })
  cdp.on('Network.responseReceivedExtraInfo', event => {
    responseHeaders.set(event.requestId, event.headers)
  })
  await cdp.send('Network.enable')
  return { cdp, requestHeaders, requestUrls, responseHeaders }
}

function headerValue(headers, name) {
  if (headers === undefined) return undefined
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return String(value)
  }
  return undefined
}

function requestEvidenceByMarker(evidence, marker) {
  for (const [requestId, headers] of evidence.requestHeaders) {
    if (headerValue(headers, 'x-workbench-e2e-probe') !== marker) continue
    return {
      headers,
      url: evidence.requestUrls.get(requestId),
    }
  }
  return undefined
}

function responseHeaderForPath(evidence, path, name) {
  for (const [requestId, url] of evidence.requestUrls) {
    if (new URL(url).pathname !== path) continue
    const value = headerValue(evidence.responseHeaders.get(requestId), name)
    if (value !== undefined) return value
  }
  return undefined
}

async function ownerCookieFromChrome(evidence) {
  const result = await evidence.cdp.send('Network.getAllCookies')
  const matches = result.cookies.filter(cookie => cookie.name === OWNER_SESSION_COOKIE_NAME)
  assert.equal(matches.length, 1, 'Chrome did not retain exactly one Owner session cookie')
  const cookie = matches[0]
  assert.equal(cookie.secure, true, 'Owner session cookie is not Secure')
  assert.equal(cookie.httpOnly, true, 'Owner session cookie is not HttpOnly')
  assert.equal(cookie.sameSite, 'Strict', 'Owner session cookie is not SameSite=Strict')
  assert.equal(cookie.path, '/', 'Owner session cookie does not use Path=/')
  assert.equal(cookie.domain, '127.0.0.1', 'Owner session cookie is not host-only on loopback')
  assert.ok(cookie.value.length >= 40, 'Owner session cookie has unexpectedly little entropy')
  return cookie
}

async function assertOwnerCookieRoundTrip(page, evidence) {
  const marker = `state-${Date.now().toString(36)}`
  const result = await page.evaluate(async ({ marker, path }) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-workbench-e2e-probe': marker },
    })
    const payload = await response.json()
    return {
      ok: response.ok,
      state: payload?.ok === true ? payload.value?.state : undefined,
      status: response.status,
    }
  }, { marker, path: OWNER_AUTH_STATE_PATH })
  assert.equal(result.status, 200)
  assert.equal(result.ok, true)
  assert.equal(result.state, 'signed-in')
  await waitForCondition(
    () => requestEvidenceByMarker(evidence, marker) !== undefined,
    PAGE_TIMEOUT_MS,
    'Chrome Owner-cookie request evidence',
  )
  const request = requestEvidenceByMarker(evidence, marker)
  assert.equal(new URL(request.url).pathname, OWNER_AUTH_STATE_PATH)
  const cookieHeader = headerValue(request.headers, 'cookie')
  assert.ok(
    cookieHeader?.includes(`${OWNER_SESSION_COOKIE_NAME}=`) === true,
    'Chrome did not send the retained HttpOnly Owner cookie to the Host',
  )
}

async function rawHttpRequest(url, headers) {
  const target = new URL(url)
  return await new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers,
    }, response => {
      const chunks = []
      response.on('data', chunk => { chunks.push(chunk) })
      response.once('error', rejectRequest)
      response.once('end', () => {
        resolveRequest({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
          status: response.statusCode,
        })
      })
    })
    request.once('error', rejectRequest)
    request.end()
  })
}

async function assertRealCarrierForbidden(page, evidence) {
  const allCookies = await evidence.cdp.send('Network.getAllCookies')
  const host = new URL(page.url()).hostname
  const cookies = allCookies.cookies.filter(cookie => cookie.domain === host)
  assert.ok(
    cookies.some(cookie => cookie.name === OWNER_SESSION_COOKIE_NAME),
    'real 403 probe did not carry the established Owner cookie',
  )
  assert.ok(
    cookies.some(cookie => cookie.name !== OWNER_SESSION_COOKIE_NAME),
    'real 403 probe did not carry the established DSH launch-session cookie',
  )
  const response = await rawHttpRequest(
    new URL(OWNER_AUTH_STATE_PATH, page.url()),
    {
      cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
      origin: 'https://attacker.invalid',
      'sec-fetch-site': 'cross-site',
    },
  )
  assert.equal(response.status, 403, 'real Connection Host/Origin fence did not reject cross-site input')
  assert.equal(response.body, 'forbidden')
  assert.equal(response.headers['cache-control'], 'no-store')
}

async function expectCarrierDenied(
  page,
  evidence,
  expectedOwnerCookie,
  path = WORKBENCH_SNAPSHOT_PATH,
) {
  const marker = `carrier-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const result = await page.evaluate(async ({ marker, path }) => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-workbench-e2e-probe': marker,
      },
      body: '{}',
    })
    return { body: await response.text(), status: response.status }
  }, { marker, path })
  assert.equal(result.status, 401, 'protected Workbench carrier did not deny the request')
  assert.equal(result.body, 'unauthorized')
  await waitForCondition(
    () => requestEvidenceByMarker(evidence, marker) !== undefined,
    PAGE_TIMEOUT_MS,
    'protected carrier request evidence',
  )
  const request = requestEvidenceByMarker(evidence, marker)
  assert.equal(new URL(request.url).pathname, path)
  const sentOwnerCookie = headerValue(request.headers, 'cookie')
    ?.includes(`${OWNER_SESSION_COOKIE_NAME}=`) === true
  assert.equal(sentOwnerCookie, expectedOwnerCookie)
}

function countRequestsToPath(journey, path) {
  return journey.requests.filter(value => new URL(value).pathname === path).length
}

function projectMilestoneRemoteCounts(journey) {
  return Object.freeze({
    read: countRequestsToPath(journey, WORKBENCH_GET_PROJECT_MILESTONES_PATH),
    operations: Object.freeze(Object.fromEntries(PROJECT_MILESTONE_OPERATION_PATHS.map(path => [
      path,
      countRequestsToPath(journey, path),
    ]))),
  })
}

function emptyProjectMilestoneRemoteCounts() {
  return Object.freeze({
    read: 0,
    operations: Object.freeze(Object.fromEntries(
      PROJECT_MILESTONE_OPERATION_PATHS.map(path => [path, 0]),
    )),
  })
}

function assertProjectMilestoneRemotesSilent(journey, expected, label) {
  assert.deepEqual(
    projectMilestoneRemoteCounts(journey),
    expected,
    `${label}: Project Milestones read or mutation/discovery Remote ran before Project reopen`,
  )
}

async function assertSecretsAbsentFromBrowserStorage(page, secrets) {
  const surfaces = await page.evaluate(() => ({
    href: location.href,
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
  }))
  const serialized = JSON.stringify(surfaces)
  for (const secret of secrets) {
    assert.ok(!serialized.includes(secret), 'an Owner secret escaped into URL or browser storage')
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  assert.ok(
    Math.max(dimensions.body, dimensions.document) <= dimensions.viewport + 1,
    `${label}: page has horizontal overflow (body=${String(dimensions.body)}, document=${String(dimensions.document)}, viewport=${String(dimensions.viewport)})`,
  )
}

async function assertNoInternalHorizontalOverflow(locator, label) {
  await locator.waitFor({ state: 'visible' })
  const dimensions = await locator.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  assert.ok(dimensions.clientWidth > 0, `${label}: rendered container has no width`)
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label}: container has horizontal overflow (scroll=${String(dimensions.scrollWidth)}, client=${String(dimensions.clientWidth)})`,
  )
}

async function assertActivityProjection(page, eventCount, ...protectedBusinessText) {
  const panel = page.locator('section[aria-labelledby="workbench-activity-title"]')
  await panel.waitFor({ state: 'visible' })
  await panel.getByText('审计链验证通过', { exact: true }).waitFor({ state: 'visible' })
  await panel.getByText(`已检查事件: ${String(eventCount)}`, { exact: true })
    .waitFor({ state: 'visible' })
  if (eventCount === 0) {
    await panel.getByText('没有匹配的活动', { exact: true }).waitFor({ state: 'visible' })
  } else {
    await panel.getByRole('heading', { name: '状态版本已提交' }).waitFor({ state: 'visible' })
    if (eventCount >= 2) {
      await panel.getByRole('heading', { name: '已从 Template 创建 Project' })
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 6) {
      await panel.getByRole('heading', { name: '已添加 ProjectMember' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 7) {
      await panel.getByRole('heading', { name: '已更新 ProjectMember 状态' })
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 8) {
      await panel.getByRole('heading', { name: '已替换 Project Responsibility' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 9) {
      await panel.getByRole('heading', { name: '已创建 SuggestedChange' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 10) {
      await panel.getByRole('heading', { name: '已延期 SuggestedChange' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 12) {
      await panel.getByRole('heading', { name: '已接受 SuggestedChange' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 15) {
      await panel.getByRole('heading', { name: '已拒绝 SuggestedChange' }).first()
        .waitFor({ state: 'visible' })
    }
    if (eventCount >= 17) {
      await panel.getByRole('heading', { name: '已编辑并接受 SuggestedChange' }).first()
        .waitFor({ state: 'visible' })
    }
    const pendingOutbox = panel.getByText('待投递', { exact: true })
    await pendingOutbox.first().waitFor({ state: 'visible' })
    assert.equal(
      await pendingOutbox.count(),
      eventCount,
      'Activity did not render one pending Outbox fact per committed event',
    )
  }
  for (const protectedText of protectedBusinessText) {
    if (protectedText === undefined) continue
    assert.equal(
      (await panel.textContent())?.includes(protectedText),
      false,
      'Activity copied protected business text into its audit projection',
    )
  }
  return panel
}

async function assertProjectCatalog(page, projectName) {
  const panel = page.locator('section[aria-labelledby="workbench-projects-title"]')
  await panel.waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: 'Knowledge Work Template' })
    .waitFor({ state: 'visible' })
  await panel.getByText('项目目录已同步', { exact: true }).waitFor({ state: 'visible' })
  const definitionDigest = (await panel.locator('article[aria-labelledby="workbench-template-title"] code')
    .textContent())?.trim()
  assert.match(definitionDigest ?? '', /^sha256:[0-9a-f]{64}$/u)
  if (projectName !== undefined) {
    const card = panel.locator('li').filter({ hasText: projectName }).first()
    await card.waitFor({ state: 'visible' })
    await card.getByRole('heading', { name: projectName, exact: true })
      .waitFor({ state: 'visible' })
    return { card, definitionDigest, panel }
  }
  return { definitionDigest, panel }
}

async function assertProjectDetail(page, expected) {
  const detail = page.locator('article[aria-labelledby="workbench-project-detail-title"]')
  await detail.getByRole('heading', { name: expected.projectName, exact: true })
    .waitFor({ state: 'visible' })
  await detail.getByText(expected.primaryGoalName, { exact: true }).waitFor({ state: 'visible' })
  await detail.getByText(expected.outcomeName, { exact: true }).waitFor({ state: 'visible' })
  await detail.getByText(expected.metricName, { exact: true }).waitFor({ state: 'visible' })
  await detail.getByText('12 → 3 天 · 减少', { exact: true }).waitFor({ state: 'visible' })
  await detail.getByRole('heading', { name: 'Project Template Snapshot', exact: true })
    .waitFor({ state: 'visible' })
  await detail.getByText('此 Project 没有关联 Supporting Goal。', { exact: true })
    .waitFor({ state: 'visible' })
  const digests = await detail.locator('code').allTextContents()
  assert.equal(digests.length, 2, 'Project detail did not expose both Template and snapshot digests')
  assert.equal(digests[0], expected.definitionDigest)
  assert.equal(digests[1], expected.definitionDigest)
  return detail
}

async function reopenProject(page, expected, options = {}) {
  const catalog = await assertProjectCatalog(page, expected.projectName)
  await catalog.card.getByRole('button', { name: '打开 Project', exact: true }).click()
  const detail = await assertProjectDetail(page, {
    ...expected,
    definitionDigest: catalog.definitionDigest,
  })
  await assertProjectTasksUnbound(page, expected.projectName)
  if (options.skipMilestones !== true) {
    await assertProjectMilestonesUnbound(page, expected.projectName)
  }
  return detail
}

function projectTeamPanel(page) {
  return page.locator('section[aria-labelledby="workbench-project-team-title"]')
}

function reviewCenterPanel(page) {
  return page.locator('section[aria-labelledby="workbench-review-center-title"]')
}

function feishuConnectionPanel(page) {
  return page.locator('section[aria-labelledby="workbench-feishu-connection-title"]')
}

function projectTasksPanel(page) {
  return page.locator('section[aria-labelledby="workbench-project-tasks-title"]')
}

function projectMilestonesPanel(page) {
  return page.locator('section[aria-labelledby="workbench-project-milestones-title"]')
}

function projectDeliverablesPanel(page) {
  return page.locator('section[aria-labelledby="workbench-project-deliverables-title"]')
}

async function assertProjectMilestonesUnbound(page, projectName) {
  const panel = projectMilestonesPanel(page)
  await panel.getByRole('heading', { name: 'Project Milestones', exact: true })
    .waitFor({ state: 'visible' })
  if (projectName === undefined) {
    await panel.getByText('先打开一个 Project，再配置或阅读它的里程碑。', { exact: true })
      .waitFor({ state: 'visible' })
    return panel
  }
  await panel.getByText(projectName, { exact: true }).waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '绑定唯一项目日历', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByText(
    '请先在 Connection Center 配置并验证所选身份；权限不足时不会回退到另一身份。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  assert.equal(
    await panel.getByRole('button', { name: '读取可访问日历', exact: true }).isDisabled(),
    true,
    'Project Milestones allowed discovery without a verified explicit Feishu route',
  )
  return panel
}

function mobileProjectMilestonesProjection(projectId) {
  return Object.freeze({
    projectId,
    revision: 4,
    binding: Object.freeze({
      calendarId: 'calendar-mobile-evidence',
      summary: '移动端证据日历',
      calendarType: 'shared',
      role: 'owner',
      identity: Object.freeze({
        kind: 'bot',
        routeGeneration: 4,
        appId: 'cli_mobile_evidence',
        openId: 'ou-mobile-evidence',
        tenantKey: 'tenant-mobile-evidence',
      }),
      createdByWorkbench: true,
      revision: 1,
      boundAt: '2026-08-31T11:00:00.000Z',
    }),
    milestones: Object.freeze([Object.freeze({
      milestoneId: 'milestone-mobile-evidence',
      name: 'Research sign-off',
      description: 'Confirm the source-backed recommendation.',
      eventId: 'event-mobile-evidence',
      eventAppLink: 'https://applink.feishu.cn/client/calendar/event/detail?eventId=event-mobile-evidence',
      schedule: Object.freeze({
        kind: 'all-day',
        startDate: '2026-09-10',
        endDate: '2026-09-11',
      }),
      remoteStatus: 'confirmed',
      remoteObservationVersion: `sha256:${'1'.repeat(64)}`,
      syncState: 'attention',
      revision: 2,
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:05:00.000Z',
      lastObservedAt: '2026-08-31T12:05:00.000Z',
    })]),
    sync: Object.freeze({
      state: 'attention',
      lastEventAt: '2026-08-31T12:04:00.000Z',
      lastReconciledAt: '2026-08-31T12:05:00.000Z',
      lastAttemptAt: '2026-08-31T12:05:00.000Z',
      issue: null,
    }),
    effects: Object.freeze([Object.freeze({
      effectId: 'effect-mobile-evidence',
      operation: 'event-date-update',
      milestoneId: 'milestone-mobile-evidence',
      state: 'unknown',
      createdAt: '2026-08-31T12:03:00.000Z',
      updatedAt: '2026-08-31T12:04:00.000Z',
    })]),
    recentChanges: Object.freeze([Object.freeze({
      changeId: 'change-mobile-evidence',
      projectRevision: 4,
      milestoneId: 'milestone-mobile-evidence',
      milestoneRevision: 2,
      source: 'feishu',
      changedFields: Object.freeze(['schedule', 'remote-status']),
      beforeSchedule: Object.freeze({
        kind: 'all-day',
        startDate: '2026-09-07',
        endDate: '2026-09-08',
      }),
      afterSchedule: Object.freeze({
        kind: 'all-day',
        startDate: '2026-09-10',
        endDate: '2026-09-11',
      }),
      occurredAt: '2026-08-31T12:04:00.000Z',
    })]),
  })
}

async function withProjectMilestonesProjection(page, projection, work) {
  const pattern = `**${WORKBENCH_GET_PROJECT_MILESTONES_PATH}`
  const handler = async route => {
    const envelope = route.request().postDataJSON()
    assert.equal(envelope?.type, 'client-request')
    assert.equal(envelope?.method, 'workbench/getProjectMilestones')
    assert.equal(envelope?.payload?.args?.query?.projectId, projection.projectId)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: { ok: true, value: projection },
      }),
    })
  }
  await page.route(pattern, handler)
  try {
    await work()
  } finally {
    await page.unroute(pattern, handler)
  }
}

function deliverableBrowserFixture(projectId, longToken) {
  const occurredAt = '2026-09-01T08:00:00.000Z'
  const digest = suffix => `sha256:${suffix.repeat(64)}`
  const members = Object.freeze([
    Object.freeze({
      memberId: 'member-deliverable-accountable',
      displayName: '浏览器 Deliverable Accountable',
      kind: 'agent',
      status: 'active',
      requiresHumanSponsor: true,
      canBeHumanSponsor: false,
      canAccept: false,
    }),
    Object.freeze({
      memberId: 'member-deliverable-sponsor',
      displayName: '浏览器 Human Sponsor',
      kind: 'human',
      status: 'active',
      requiresHumanSponsor: false,
      canBeHumanSponsor: true,
      canAccept: true,
    }),
    Object.freeze({
      memberId: 'member-deliverable-acceptor',
      displayName: '浏览器 Designated Acceptor',
      kind: 'human',
      status: 'active',
      requiresHumanSponsor: false,
      canBeHumanSponsor: true,
      canAccept: true,
    }),
  ])
  const task = Object.freeze({
    taskGuid: 'task-guid-deliverable-browser',
    taskId: 'task-deliverable-browser',
    scope: 'primary-list',
    parentTaskGuid: null,
    summary: '完成 Deliverable 浏览器证据',
    description: '',
    assignees: [],
    followers: [],
    comments: [],
    completed: false,
    completedAt: null,
    canonicalUrl: 'https://applink.feishu.cn/client/task/task-deliverable-browser',
    remoteVersion: 'task-browser-version-1',
    projectionRevision: 1,
  })
  const calendarBinding = Object.freeze({
    calendarId: 'calendar-deliverable-browser',
    summary: 'Deliverable 正式日历',
    calendarType: 'shared',
    role: 'owner',
    identity: Object.freeze({
      kind: 'bot',
      routeGeneration: 1,
      appId: 'cli_deliverable_browser',
      openId: 'ou_deliverable_browser',
      tenantKey: 'tenant-deliverable-browser',
    }),
    createdByWorkbench: false,
    revision: 1,
    boundAt: occurredAt,
  })
  const receipt = suffix => Object.freeze({
    commandId: `command-deliverable-${suffix}`,
    auditEventId: `audit-deliverable-${suffix}`,
    outboxId: `outbox-deliverable-${suffix}`,
  })
  const memberSnapshot = memberId => {
    const member = members.find(candidate => candidate.memberId === memberId)
    assert.notEqual(member, undefined, `Deliverable fixture received unknown member ${memberId}`)
    return Object.freeze({
      memberId: member.memberId,
      displayName: member.displayName,
      kind: member.kind,
    })
  }
  let deliverable = null
  let revision = 3
  let activity = []

  const projection = () => ({
    projectId,
    revision,
    teamRevision: 4,
    taskRevision: 5,
    scheduleRevision: 6,
    calendarBinding,
    memberOptions: members,
    taskOptions: [task],
    deliverables: deliverable === null ? [] : [deliverable],
    activity,
    nextBeforeActivitySequence: null,
  })
  const calendar = schedule => Object.freeze({
    eventId: 'event-deliverable-browser',
    eventAppLink: 'https://applink.feishu.cn/client/calendar/event/detail?eventId=event-deliverable-browser',
    schedule,
    remoteStatus: 'confirmed',
    remoteObservationVersion: 'event-deliverable-observation-1',
    syncState: 'healthy',
    lastObservedAt: occurredAt,
  })
  const appendActivity = (action, deliverableRevision, acceptanceRequestId, decisionId) => {
    const sequence = activity.length + 1
    activity = [{
      sequence,
      activityId: `deliverable-activity-${String(sequence)}`,
      deliverableId: 'deliverable-browser-1',
      deliverableRevision,
      action,
      source: { kind: 'audit-event', auditEventId: `audit-deliverable-${String(sequence)}` },
      planSnapshotId: 'deliverable-plan-browser-1',
      acceptanceRequestId,
      decisionId,
      occurredAt,
    }, ...activity]
  }

  return {
    get projection() { return projection() },
    create(request) {
      assert.equal(request.reason, 'owner-project-deliverable-create')
      assert.equal(request.expectedDeliverablesRevision, 3)
      assert.equal(request.expectedDeliverableRevision, null)
      assert.equal(request.expectedTeamRevision, 4)
      assert.equal(request.expectedTaskRevision, 5)
      assert.equal(request.expectedScheduleRevision, 6)
      assert.equal(request.event.mode, 'create-event')
      assert.equal(request.taskGuids.length, 1)
      const plan = Object.freeze({
        planSnapshotId: 'deliverable-plan-browser-1',
        name: request.name,
        description: request.description ?? null,
        criteria: request.criteria.map((criterion, index) => Object.freeze({
          criterionId: `criterion-browser-${String(index + 1)}`,
          statement: criterion.statement,
        })),
        responsibility: Object.freeze({
          accountable: memberSnapshot(request.accountableMemberId),
          contributors: request.contributorMemberIds.map(memberSnapshot),
          humanSponsor: request.humanSponsorMemberId === null
            ? null
            : memberSnapshot(request.humanSponsorMemberId),
          acceptor: memberSnapshot(request.acceptorMemberId),
        }),
        taskGuids: [...request.taskGuids],
        digest: digest('a'),
        createdAt: occurredAt,
      })
      deliverable = {
        deliverableId: 'deliverable-browser-1',
        sequence: 1,
        revision: 1,
        state: 'planned',
        plan,
        calendar: calendar(request.event.schedule),
        tasks: [{ taskGuid: task.taskGuid, availability: 'available', task }],
        acceptanceRequests: [],
        finalRelease: null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }
      revision = 4
      appendActivity('deliverable-created', 1, null, null)
      return {
        ok: true,
        value: projection(),
        deliverable,
        effect: {
          effectId: 'effect-deliverable-browser',
          operation: 'event-create',
          deliverableId: deliverable.deliverableId,
          state: 'delivered',
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        receipt: receipt('create'),
      }
    },
    requestAcceptance(request) {
      assert.notEqual(deliverable, null, 'acceptance was requested before Deliverable creation')
      assert.equal(request.reason, 'owner-deliverable-acceptance-request')
      assert.equal(request.expectedDeliverablesRevision, 4)
      assert.equal(request.expectedDeliverableRevision, 1)
      assert.equal(request.expectedTeamRevision, 4)
      assert.equal(request.expectedTaskRevision, 5)
      assert.equal(request.expectedScheduleRevision, 6)
      assert.equal(request.expectedRemoteObservationVersion, 'event-deliverable-observation-1')
      assert.equal(request.candidateVersions.length, 1)
      assert.equal(request.candidateVersions[0].kind, 'declared-file-version')
      assert.equal(request.candidateVersions[0].displayName, longToken)
      const candidateVersions = request.candidateVersions.map(candidate => Object.freeze({
        ...candidate,
        referenceDigest: digest('b'),
        resolution: 'declared',
      }))
      const acceptanceRequest = {
        acceptanceRequestId: 'acceptance-request-browser-1',
        sequence: 1,
        revision: 1,
        deliverableRevision: 2,
        plan: deliverable.plan,
        calendar: deliverable.calendar,
        taskGuids: deliverable.plan.taskGuids,
        candidateVersions,
        candidatesDigest: digest('c'),
        persistedState: 'pending',
        effectiveStatus: 'pending',
        decision: null,
        allowedDecisions: ['approve', 'reject', 'request-changes'],
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }
      deliverable = {
        ...deliverable,
        revision: 2,
        state: 'in-review',
        acceptanceRequests: [acceptanceRequest],
        updatedAt: occurredAt,
      }
      revision = 5
      appendActivity('acceptance-requested', 2, acceptanceRequest.acceptanceRequestId, null)
      return { ok: true, value: projection(), request: acceptanceRequest, receipt: receipt('request') }
    },
    decide(request) {
      assert.notEqual(deliverable, null, 'acceptance was decided before Deliverable creation')
      assert.equal(request.mode, 'approve')
      assert.equal(request.reason, 'owner-deliverable-acceptance-approve')
      assert.equal(request.expectedDeliverablesRevision, 5)
      assert.equal(request.expectedDeliverableRevision, 2)
      assert.equal(request.expectedAcceptanceRequestRevision, 1)
      assert.equal(Object.hasOwn(request, 'candidateVersions'), false)
      assert.ok(request.criteria.every(criterion => criterion.outcome === 'met'))
      assert.ok(request.feedback.trim().length > 0)
      const pending = deliverable.acceptanceRequests[0]
      assert.notEqual(pending, undefined)
      const decision = {
        decisionId: 'acceptance-decision-browser-1',
        requestRevision: 2,
        outcome: 'approved',
        actor: { kind: 'owner', id: 'owner-browser-authenticated' },
        designatedAcceptor: deliverable.plan.responsibility.acceptor,
        criteria: request.criteria,
        feedback: request.feedback,
        causationId: request.causationId,
        receipt: receipt('decision'),
        decidedAt: occurredAt,
      }
      const approved = {
        ...pending,
        revision: 2,
        persistedState: 'approved',
        effectiveStatus: 'approved',
        decision,
        allowedDecisions: [],
        updatedAt: occurredAt,
      }
      const finalRelease = {
        finalReleaseId: 'final-release-browser-1',
        acceptanceRequestId: pending.acceptanceRequestId,
        versions: pending.candidateVersions,
        versionsDigest: pending.candidatesDigest,
        createdAt: occurredAt,
      }
      deliverable = {
        ...deliverable,
        revision: 3,
        state: 'accepted',
        acceptanceRequests: [approved],
        finalRelease,
        updatedAt: occurredAt,
      }
      revision = 6
      appendActivity(
        'acceptance-approved',
        3,
        pending.acceptanceRequestId,
        decision.decisionId,
      )
      return {
        ok: true,
        value: projection(),
        request: approved,
        finalRelease,
        receipt: receipt('decision'),
      }
    },
    review() {
      return {
        reviewKind: 'deliverable-acceptance',
        projectId,
        deliverablesRevision: revision,
        items: deliverable === null || deliverable.acceptanceRequests.length === 0
          ? []
          : [{
              deliverableId: deliverable.deliverableId,
              deliverableName: deliverable.plan.name,
              currentDeliverableRevision: deliverable.revision,
              currentState: deliverable.state,
              currentCalendar: deliverable.calendar,
              currentTasks: deliverable.tasks,
              request: deliverable.acceptanceRequests[0],
              finalRelease: deliverable.finalRelease,
            }],
        nextBeforeSequence: null,
      }
    },
  }
}

async function installDeliverableBrowserFixture(page, fixture) {
  // This same-origin Remote fixture proves the generated codec and real Client
  // journey. Its in-memory state intentionally spans page/Host remounts, so it
  // is not evidence that a Deliverable survived a SQLite process restart.
  const calls = []
  const handlers = []
  const register = async (path, method, operation) => {
    const pattern = `**${path}`
    const handler = async route => {
      const envelope = route.request().postDataJSON()
      assert.equal(envelope?.type, 'client-request')
      assert.equal(envelope?.method, method)
      calls.push({ path, args: envelope?.payload?.args })
      const value = await operation(route, envelope?.payload?.args ?? {})
      if (value === undefined) return
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value },
        }),
      })
    }
    handlers.push({ pattern, handler })
    await page.route(pattern, handler)
  }
  await register(
    WORKBENCH_PROJECT_DELIVERABLES_PATH,
    'workbench/projectDeliverables',
    (_route, args) => {
      assert.equal(args.query.projectId, fixture.projection.projectId)
      return fixture.projection
    },
  )
  await register(
    WORKBENCH_CREATE_PROJECT_DELIVERABLE_PATH,
    'workbench/createProjectDeliverable',
    (_route, args) => fixture.create(args.request),
  )
  await register(
    WORKBENCH_REQUEST_DELIVERABLE_ACCEPTANCE_PATH,
    'workbench/requestDeliverableAcceptance',
    (_route, args) => fixture.requestAcceptance(args.request),
  )
  await register(
    WORKBENCH_DECIDE_DELIVERABLE_ACCEPTANCE_PATH,
    'workbench/decideDeliverableAcceptance',
    (_route, args) => fixture.decide(args.request),
  )
  await register(
    WORKBENCH_REVIEW_CENTER_PATH,
    'workbench/reviewCenter',
    async (route, args) => {
      if (args.filter?.reviewKind !== 'deliverable-acceptance') {
        await route.fallback()
        return undefined
      }
      return fixture.review()
    },
  )
  return {
    calls,
    async dispose() {
      await Promise.all(handlers.map(({ pattern, handler }) => page.unroute(pattern, handler)))
    },
  }
}

async function exerciseDeliverableBrowserJourney(page, fixture, expected) {
  const panel = projectDeliverablesPanel(page)
  await panel.getByRole('heading', { name: 'Project Deliverables', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByText(
    '正式决定由当前已验证的 Owner 实际记录；Plan 中指定的 Acceptor 作为独立责任快照显示。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  const createForm = panel.getByRole('form').first()
  const name = createForm.getByLabel(/Deliverable.*名称|Deliverable name/iu)
  const criterion = createForm.getByLabel(/验收标准.*1|Acceptance criterion.*1/iu)
  const accountable = createForm.getByRole('combobox', { name: 'Accountable', exact: true })
  const sponsor = createForm.getByRole('combobox', { name: 'Human Sponsor', exact: true })
  const acceptor = createForm.getByRole('combobox', { name: 'Acceptor', exact: true })
  const task = createForm.getByRole('checkbox', {
    name: '完成 Deliverable 浏览器证据',
    exact: true,
  })
  const startDate = createForm.getByLabel(/开始日期|Start date/iu)
  const endDate = createForm.getByLabel(/结束日期|End date/iu)
  for (const [control, label] of [
    [name, 'Deliverable name'],
    [criterion, 'Deliverable acceptance criterion'],
    [accountable, 'Deliverable Accountable'],
    [acceptor, 'Deliverable Acceptor'],
    [task, 'Deliverable Feishu Task'],
    [startDate, 'Deliverable start date'],
    [endDate, 'Deliverable end date'],
  ]) await assertVisibleKeyboardFocus(control, label)

  const advancedSummary = createForm.locator('summary').filter({
    hasText: /更多事件选项|More event options/iu,
  })
  const advanced = advancedSummary.locator('..')
  await advancedSummary.waitFor({ state: 'visible' })
  assert.equal(await advanced.getAttribute('open'), null, 'advanced Deliverable schedule opened by default')
  await assertVisibleKeyboardFocus(advancedSummary, 'Deliverable schedule disclosure')
  await advancedSummary.press('Enter')
  await advanced.evaluate(element => {
    if (!element.open) throw new Error('Enter did not open native Deliverable schedule disclosure')
  })
  await advancedSummary.press('Space')
  await advanced.evaluate(element => {
    if (element.open) throw new Error('Space did not close native Deliverable schedule disclosure')
  })

  await name.fill(expected.name)
  await criterion.fill(expected.criterion)
  await accountable.selectOption('member-deliverable-accountable')
  await sponsor.waitFor({ state: 'visible' })
  await assertVisibleKeyboardFocus(sponsor, 'Deliverable Human Sponsor')
  await sponsor.selectOption('member-deliverable-sponsor')
  await acceptor.selectOption('member-deliverable-acceptor')
  await task.check()
  await startDate.fill('2026-09-08')
  await endDate.fill('2026-09-09')
  await createForm.getByRole('button', { name: /创建 Deliverable|Create Deliverable/iu }).click()

  const card = panel.getByRole('article', { name: expected.name, exact: true })
  await card.waitFor({ state: 'visible' })
  await card.getByText('浏览器 Deliverable Accountable', { exact: true }).waitFor({ state: 'visible' })
  await card.getByText('浏览器 Designated Acceptor', { exact: true }).waitFor({ state: 'visible' })
  await card.getByText(/不可变|immutable/iu).waitFor({ state: 'visible' })
  const source = card.getByLabel(/版本来源|Artifact source|来源/iu)
  const resourceId = card.getByLabel(/资源 ID|Resource ID/iu)
  const versionId = card.getByLabel(/版本 ID|Version ID/iu)
  const displayName = card.getByLabel(/显示名称|Display name/iu)
  await source.selectOption('local')
  await resourceId.fill('reports/evidence.md')
  await versionId.fill('git-sha-browser-1')
  await displayName.fill(expected.longToken)
  await card.getByRole('button', { name: /添加(?:声明)?版本|Add (?:declared )?version/iu }).click()
  await card.getByText('声明版本（未验证）', { exact: true }).waitFor({ state: 'visible' })
  const longToken = card.getByText(expected.longToken, { exact: true })
  await longToken.waitFor({ state: 'visible' })
  assert.equal(
    await longToken.evaluate(element => getComputedStyle(element).overflowWrap),
    'anywhere',
    'declared artifact long token is not safely wrapped',
  )
  await card.getByRole('button', { name: /申请验收|Request acceptance/iu }).click()

  const review = reviewCenterPanel(page)
  await review.getByRole('button', { name: 'Deliverable Acceptance', exact: true }).click()
  const acceptanceCard = review.locator('article').filter({ hasText: expected.name }).first()
  await acceptanceCard.waitFor({ state: 'visible' })
  await acceptanceCard.getByText(
    /当前已验证(?:的)? Owner.*记录.*(?:designated )?Acceptor.*(?:计划快照|责任快照)/iu,
  ).waitFor({ state: 'visible' })
  const approve = acceptanceCard.getByRole('button', { name: /批准|Approve/iu })
  const reject = acceptanceCard.getByRole('button', { name: /拒绝|Reject/iu })
  const requestChanges = acceptanceCard.getByRole('button', {
    name: /要求修改|需要修改|Request changes/iu,
  })
  await Promise.all([
    approve.waitFor({ state: 'visible' }),
    reject.waitFor({ state: 'visible' }),
    requestChanges.waitFor({ state: 'visible' }),
  ])
  const criterionDecision = acceptanceCard.getByRole('group', {
    name: expected.criterion,
    exact: true,
  })
  const met = criterionDecision.getByRole('radio', { name: /^(?:满足|Met)$/iu })
  const notMet = criterionDecision.getByRole('radio', { name: /^(?:未满足|Not met)$/iu })
  const feedback = acceptanceCard.getByLabel(/反馈|Feedback/iu)
  await Promise.all([
    met.waitFor({ state: 'visible' }),
    notMet.waitFor({ state: 'visible' }),
    feedback.waitFor({ state: 'visible' }),
  ])
  await assertVisibleKeyboardFocus(met, 'Deliverable criterion met outcome')
  await met.press('ArrowRight')
  const notMetFocus = await notMet.evaluate(element => ({
    active: document.activeElement === element,
    focusVisible: element.matches(':focus-visible'),
  }))
  assert.equal(notMetFocus.active, true, 'ArrowRight did not reach the not-met radio option')
  assert.equal(notMetFocus.focusVisible, true, 'not-met radio focus is not visibly represented')
  await notMet.press('ArrowLeft')
  await assertVisibleKeyboardFocus(feedback, 'Deliverable acceptance feedback')
  await met.check()
  await feedback.fill(expected.feedback)
  assert.equal(await approve.isEnabled(), true, 'valid Deliverable approval stayed disabled')
  await assertVisibleKeyboardFocus(approve, 'Deliverable approve outcome')
  await approve.click()
  await waitForCondition(
    () => fixture.projection.deliverables[0]?.state === 'accepted',
    PAGE_TIMEOUT_MS,
    'Deliverable Review Center approval',
  )
  await acceptanceCard.getByText(expected.feedback, { exact: true })
    .waitFor({ state: 'visible' })
  assert.equal(
    fixture.projection.deliverables[0].finalRelease.versions[0].displayName,
    expected.longToken,
  )
}

async function assertAcceptedDeliverableBrowserProjection(page, expected) {
  const panel = projectDeliverablesPanel(page)
  await panel.getByRole('heading', { name: 'Project Deliverables', exact: true })
    .waitFor({ state: 'visible' })
  const card = panel.getByRole('article', { name: expected.name, exact: true })
  await card.waitFor({ state: 'visible' })
  await card.getByText(/^(?:已验收|Accepted)$/iu).first().waitFor({ state: 'visible' })
  await card.getByText(/Final Release/iu).waitFor({ state: 'visible' })
  await card.getByText('声明版本（未验证）', { exact: true }).first().waitFor({ state: 'visible' })
  await card.getByText(expected.longToken, { exact: true }).first().waitFor({ state: 'visible' })
  await card.getByText('浏览器 Deliverable Accountable', { exact: true }).first()
    .waitFor({ state: 'visible' })
  await card.getByText('浏览器 Designated Acceptor', { exact: true }).first()
    .waitFor({ state: 'visible' })
  const responsibilityChain = panel.locator(
    'section[aria-labelledby="workbench-deliverables-activity-title"]',
  )
  await responsibilityChain.getByRole('heading', { name: '可重放责任链', exact: true })
    .waitFor({ state: 'visible' })
  const activityEntries = await responsibilityChain.locator('ol > li').allTextContents()
  assert.equal(activityEntries.length, 3, 'Deliverable responsibility chain is incomplete')
  for (const [entry, expectedValues] of [
    [activityEntries[0], [
      '验收已批准',
      'deliverable-plan-browser-1',
      'acceptance-request-browser-1',
      'acceptance-decision-browser-1',
      'audit-deliverable-3',
    ]],
    [activityEntries[1], [
      '已申请验收',
      'deliverable-plan-browser-1',
      'acceptance-request-browser-1',
      'audit-deliverable-2',
    ]],
    [activityEntries[2], [
      '已创建 Deliverable',
      'deliverable-plan-browser-1',
      'audit-deliverable-1',
    ]],
  ]) {
    for (const value of expectedValues) {
      assert.ok(entry.includes(value), `Deliverable responsibility chain omitted ${value}`)
    }
  }
  await assertNoInternalHorizontalOverflow(card, 'accepted Deliverable card')
  return { card, panel }
}

async function reloadAuthenticatedWorkbench(page) {
  await page.reload({ waitUntil: 'load' })
  await dismissHarnessOnboarding(page)
  await page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
}

async function assertProjectMilestonesBound(page) {
  const panel = projectMilestonesPanel(page)
  await panel.getByRole('heading', { name: 'Project Milestones', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '移动端证据日历', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('button', { name: '立即对账日历', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '创建 Milestone', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: 'Research sign-off', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('link', {
    name: '在飞书日历中打开 Research sign-off （飞书日历）',
    exact: true,
  }).waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '日历写入需要关注', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '最近日程变化', exact: true })
    .waitFor({ state: 'visible' })
  return panel
}

async function assertProjectTasksUnbound(page, projectName) {
  const panel = projectTasksPanel(page)
  await panel.getByRole('heading', { name: 'Project Tasks', exact: true })
    .waitFor({ state: 'visible' })
  if (projectName === undefined) {
    await panel.getByText('先打开一个 Project，再配置或阅读它的任务清单。', { exact: true })
      .waitFor({ state: 'visible' })
    return panel
  }
  await panel.getByText(projectName, { exact: true }).waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: '绑定唯一主任务清单', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByText(
    '请先在 Connection Center 配置并验证所选身份。不会自动回退到另一身份。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  assert.equal(
    await panel.getByRole('button', { name: '读取可访问清单', exact: true }).isDisabled(),
    true,
    'Project Tasks allowed discovery without a verified explicit Feishu route',
  )
  return panel
}

async function assertFeishuConnectionCenter(page, expected = {}) {
  const panel = feishuConnectionPanel(page)
  await panel.getByRole('heading', { name: '飞书 Bot / User 连接中心', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByText(/不会自动切换到另一个身份/u).waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: 'Bot 身份路由', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByRole('heading', { name: 'User 身份路由', exact: true })
    .waitFor({ state: 'visible' })
  if (expected.botAppId === undefined) {
    assert.equal(await panel.getByText('未配置', { exact: true }).count(), 2)
    return panel
  }
  const bot = panel.locator('article[aria-labelledby="workbench-feishu-bot-title"]')
  await bot.getByText(expected.botAppId, { exact: true }).first().waitFor({ state: 'visible' })
  await bot.getByText(expected.credentialRef, { exact: true }).first().waitFor({ state: 'visible' })
  await bot.getByText('失败', { exact: true }).first().waitFor({ state: 'visible' })
  await bot.getByText('凭据引用尚未在 DSH 凭据存储中配置。', { exact: true })
    .waitFor({ state: 'visible' })
  assert.equal(await bot.getByText(expected.credentialValue, { exact: true }).count(), 0)
  return panel
}

async function configureAndVerifyMissingFeishuBot(page, expected) {
  const panel = await assertFeishuConnectionCenter(page)
  const bot = panel.locator('article[aria-labelledby="workbench-feishu-bot-title"]')
  await bot.locator('input[name="feishu-bot-app-id"]').fill(expected.botAppId)
  await bot.locator('input[name="feishu-bot-credential-ref"]').fill(expected.credentialRef)
  await bot.getByRole('button', { name: '保存配置', exact: true }).click()
  await bot.locator('[data-state="configured"]').waitFor({ state: 'visible' })
  await bot.getByRole('button', { name: '验证此身份', exact: true }).click()
  await bot.getByText('凭据引用尚未在 DSH 凭据存储中配置。', { exact: true })
    .waitFor({ state: 'visible' })
  return await assertFeishuConnectionCenter(page, expected)
}

function reviewCardHeadings(panel) {
  return panel.getByRole('heading', { name: /^建议 #\d+$/u })
}

function reviewCard(panel, heading) {
  return panel.locator('article').filter({ hasText: heading }).first()
}

function reviewFilterSelect(panel, index) {
  return panel.getByRole('group', { name: '筛选 Review 建议', exact: true })
    .getByRole('combobox').nth(index)
}

async function selectOptionContaining(select, text) {
  const value = await select.locator('option').evaluateAll((options, expected) => {
    const match = options.find(option => option.textContent?.trim().includes(expected) === true)
    return match?.value
  }, text)
  assert.notEqual(value, undefined, `select did not contain an option matching ${JSON.stringify(text)}`)
  await select.selectOption(value)
}

async function setNamedCheckbox(group, name, checked) {
  const checkbox = group.getByRole('checkbox', { name })
  await checkbox.waitFor({ state: 'visible' })
  if (await checkbox.isDisabled()) {
    assert.equal(await checkbox.isChecked(), checked, `${name}: disabled checkbox has the wrong state`)
    return
  }
  if (checked) await checkbox.check()
  else await checkbox.uncheck()
}

async function applyReviewFilters(panel, status, risk, expectedHeadings) {
  await reviewFilterSelect(panel, 0).selectOption({ label: status })
  await reviewFilterSelect(panel, 1).selectOption({ label: risk })
  await panel.getByRole('button', { name: '应用筛选', exact: true }).click()
  const expected = [...expectedHeadings].sort()
  await waitForCondition(
    async () => {
      const actual = [...await reviewCardHeadings(panel).allTextContents()].sort()
      return await panel.getAttribute('aria-busy') === 'false'
        && actual.length === expected.length
        && actual.every((heading, index) => heading === expected[index])
    },
    PAGE_TIMEOUT_MS,
    `Review filter ${status}/${risk}`,
  )
  const actual = await reviewCardHeadings(panel).allTextContents()
  assert.deepEqual(
    [...actual].sort(),
    expected,
    `Review filter ${status}/${risk} returned the wrong cards`,
  )
}

async function assertNoBatchAccept(panel) {
  assert.equal(
    await panel.getByRole('button', { name: /(?:批量|批次).*(?:接受|通过)/u }).count(),
    0,
    'T06 unexpectedly exposed a batch-accept action',
  )
}

async function configureProposal(panel, activeMemberNames, candidate) {
  await selectOptionContaining(
    panel.getByRole('combobox', { name: '提案 Accountable', exact: true }),
    candidate.accountable,
  )
  const contributors = panel.getByRole('group', { name: '提案 Contributors', exact: true })
  for (const name of activeMemberNames) {
    await setNamedCheckbox(contributors, name, candidate.contributors.includes(name))
  }
  const sponsor = panel.getByRole('combobox', { name: '提案 Human Sponsor', exact: true })
  if (candidate.sponsor === null) {
    if (await sponsor.isDisabled()) assert.equal(await sponsor.inputValue(), '')
    else await sponsor.selectOption('')
  } else {
    await selectOptionContaining(sponsor, candidate.sponsor)
  }
}

async function createProposalViaUi(panel, activeMemberNames, candidate) {
  await configureProposal(panel, activeMemberNames, candidate)
  const evidence = panel.getByRole('group', { name: '提案 Evidence', exact: true })
    .getByRole('checkbox').first()
  await evidence.waitFor({ state: 'visible' })
  await evidence.check()
  const before = new Set(await reviewCardHeadings(panel).allTextContents())
  const create = panel.getByRole('button', { name: '创建建议', exact: true })
  assert.equal(await create.isEnabled(), true, 'valid Review proposal stayed disabled')
  await create.click()
  await waitForCondition(
    async () => (await reviewCardHeadings(panel).allTextContents())
      .some(heading => !before.has(heading)),
    PAGE_TIMEOUT_MS,
    'new SuggestedChange card',
  )
  const headings = await reviewCardHeadings(panel).allTextContents()
  const heading = headings.find(value => !before.has(value))
  assert.notEqual(heading, undefined, 'proposal did not add one identifiable Review card')
  const card = reviewCard(panel, heading)
  await card.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' })
  const evidenceSection = card.getByRole('heading', { name: '证据', exact: true }).locator('..')
  const evidenceAuditEventId = (await evidenceSection.locator('code').first().textContent())?.trim()
  assert.ok(
    evidenceAuditEventId !== undefined && evidenceAuditEventId.length > 0,
    'Review card did not retain its inspectable evidence reference',
  )
  return { evidenceAuditEventId, heading }
}

const reviewDiffFieldLabels = Object.freeze({
  accountable: 'Accountable',
  contributors: 'Contributors',
  'human-sponsor': 'Human Sponsor',
})

function reviewSequenceFromHeading(heading) {
  const match = /^建议 #(\d+)$/u.exec(heading)
  assert.notEqual(match, null, `invalid Review card heading ${JSON.stringify(heading)}`)
  return Number(match[1])
}

async function readReviewItemViaCarrier(page, projectId, heading) {
  const review = await callAuthenticatedWorkbench(
    page,
    WORKBENCH_REVIEW_CENTER_PATH,
    { filter: { projectId, limit: 20 } },
  )
  assert.notEqual(review, null, 'authenticated Review read lost the selected Project')
  const sequence = reviewSequenceFromHeading(heading)
  const item = review.items.find(candidate => candidate.sequence === sequence)
  assert.notEqual(item, undefined, `authenticated Review read lost ${heading}`)
  return { item, memberOptions: review.proposalBuilder.memberOptions }
}

function reviewDiffValue(field, value, memberOptions) {
  const memberNames = new Map(memberOptions.map(member => {
    const parts = [
      member.displayName,
      member.kind === 'human' ? '人类' : 'Agent',
      member.memberId,
    ]
    if (member.kind === 'human' && member.requiresHumanSponsor) parts.push('外部联系人')
    if (member.status !== 'active') parts.push('已停用')
    return [member.memberId, parts.join(' · ')]
  }))
  const memberName = memberId => {
    if (memberId === null) return '未设置'
    return memberNames.get(memberId) ?? memberId
  }
  if (field === 'accountable') return memberName(value.accountableMemberId)
  if (field === 'human-sponsor') return memberName(value.humanSponsorMemberId)
  if (value.contributorMemberIds.length === 0) return '未设置'
  return value.contributorMemberIds.map(memberName).join('、')
}

async function assertReviewDiffTable(table, diff, memberOptions, digestLabel) {
  await table.waitFor({ state: 'visible' })
  for (const header of ['字段', '变更前', '变更后']) {
    await table.getByRole('columnheader', { name: header, exact: true })
      .waitFor({ state: 'visible' })
  }
  assert.equal(
    await table.locator('tbody').getByRole('row').count(),
    diff.changedFields.length,
    'SuggestedChange diff did not match its typed changedFields row count',
  )
  for (const field of diff.changedFields) {
    const fieldLabel = reviewDiffFieldLabels[field]
    assert.notEqual(fieldLabel, undefined, `unsupported Review diff field ${String(field)}`)
    const rowHeader = table.getByRole('rowheader', { name: fieldLabel, exact: true })
    await rowHeader.waitFor({ state: 'visible' })
    const actualCells = (await rowHeader.locator('..').getByRole('cell').allTextContents())
      .map(value => value.trim())
    assert.deepEqual(actualCells, [
      reviewDiffValue(field, diff.before, memberOptions),
      reviewDiffValue(field, diff.after, memberOptions),
    ], `${fieldLabel} before/after cells diverged from the authenticated carrier`)
  }
  const digest = table.locator('xpath=../..').locator('p')
    .filter({ hasText: digestLabel }).locator('code')
  assert.equal((await digest.textContent())?.trim(), diff.digest)
  return diff.digest
}

async function assertSuggestedDiff(page, projectId, card, heading) {
  const { item, memberOptions } = await readReviewItemViaCarrier(page, projectId, heading)
  const table = card.getByRole('table', { name: '建议差异', exact: true })
  return await assertReviewDiffTable(table, item.proposedDiff, memberOptions, '差异摘要')
}

async function assertAppliedDiff(page, projectId, card, heading) {
  const { item, memberOptions } = await readReviewItemViaCarrier(page, projectId, heading)
  const decision = [...item.decisions].reverse().find(candidate => candidate.appliedDiff !== null)
  assert.notEqual(decision, undefined, `${heading} lost its applied decision material`)
  const table = card.getByRole('table', { name: '实际应用差异', exact: true })
  return await assertReviewDiffTable(
    table,
    decision.appliedDiff,
    memberOptions,
    '实际应用差异摘要：',
  )
}

async function chooseDecision(card, mode, feedback, acknowledgeHighRisk = false) {
  await card.getByRole('button', { name: mode, exact: true }).click()
  const submit = card.getByRole('button', { name: '提交决定', exact: true })
  assert.equal(await submit.isDisabled(), true, `${mode}: empty mandatory feedback enabled submit`)
  await card.getByLabel('反馈原因', { exact: true }).fill(feedback)
  if (acknowledgeHighRisk) {
    assert.equal(await submit.isDisabled(), true, `${mode}: high-risk submit skipped confirmation`)
    await card.getByLabel('我已核对高风险差异与证据', { exact: true }).check()
  }
  assert.equal(await submit.isEnabled(), true, `${mode}: valid decision stayed disabled`)
  await submit.click()
  await card.getByRole('heading', { name: '审核历史', exact: true }).waitFor({ state: 'visible' })
  await card.getByText(feedback, { exact: true }).waitFor({ state: 'visible' })
}

async function configureEditedDecision(card, activeMemberNames, candidate) {
  await selectOptionContaining(
    card.getByRole('combobox', { name: '编辑后的 Accountable', exact: true }),
    candidate.accountable,
  )
  const contributors = card.getByRole('group', {
    name: '编辑后的 Contributors',
    exact: true,
  })
  for (const name of activeMemberNames) {
    await setNamedCheckbox(contributors, name, candidate.contributors.includes(name))
  }
  const sponsor = card.getByRole('combobox', {
    name: '编辑后的 Human Sponsor',
    exact: true,
  })
  if (candidate.sponsor === null) {
    if (await sponsor.isDisabled()) assert.equal(await sponsor.inputValue(), '')
    else await sponsor.selectOption('')
  } else {
    await selectOptionContaining(sponsor, candidate.sponsor)
  }
}

async function callAuthenticatedWorkbench(page, path, args) {
  const outcome = await page.evaluate(async ({ path, args }) => {
    const method = path.slice('/api/'.length)
    const rpcId = crypto.randomUUID()
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method,
        payload: { args },
      }),
    })
    return {
      body: await response.json(),
      ok: response.ok,
      rpcId,
      status: response.status,
    }
  }, { path, args })
  assert.equal(outcome.status, 200, `${path}: authenticated carrier returned HTTP ${String(outcome.status)}`)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.body?.type, 'server-response')
  assert.equal(outcome.body?.rpcId, outcome.rpcId)
  assert.equal(outcome.body?.result?.ok, true, `${path}: authenticated carrier failed`)
  return outcome.body.result.value
}

async function findProjectIdViaCarrier(page, projectName) {
  const start = await callAuthenticatedWorkbench(
    page,
    WORKBENCH_PROJECT_START_PATH,
    { filter: { limit: 20 } },
  )
  const project = start.projects.find(candidate => candidate.name === projectName)
  assert.notEqual(project, undefined, 'authenticated Project catalog did not contain the UI-created Project')
  return project.projectId
}

async function readTeamViaCarrier(page, projectId) {
  const team = await callAuthenticatedWorkbench(
    page,
    WORKBENCH_PROJECT_TEAM_PATH,
    { query: { projectId } },
  )
  assert.notEqual(team, null, 'authenticated Team read lost the selected Project')
  return team
}

async function advanceResponsibilityViaCarrier(page, projectId, candidate) {
  const team = await readTeamViaCarrier(page, projectId)
  assert.notEqual(team.responsibility, null, 'normal Responsibility write requires an existing tuple')
  const members = new Map(team.members.map(member => [member.displayName, member.memberId]))
  const memberId = name => {
    const value = members.get(name)
    assert.notEqual(value, undefined, `normal Responsibility write could not resolve ${name}`)
    return value
  }
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const result = await callAuthenticatedWorkbench(
    page,
    WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH,
    {
      request: {
        projectId,
        accountableMemberId: memberId(candidate.accountable),
        contributorMemberIds: candidate.contributors.map(memberId).sort(),
        humanSponsorMemberId: candidate.sponsor === null ? null : memberId(candidate.sponsor),
        expectedTeamRevision: team.teamRevision,
        expectedResponsibilityRevision: team.responsibility.revision,
        idempotencyKey: `browser-stale-idem-${nonce}`,
        causationId: `browser-stale-cause-${nonce}`,
        reason: 'owner-project-responsibility-set',
      },
    },
  )
  assert.equal(result.ok, true, `normal Responsibility write failed: ${result.error?.code ?? 'unknown'}`)
  return result
}

async function assertProjectTeam(page, expected) {
  const panel = projectTeamPanel(page)
  await panel.getByRole('heading', { name: 'Project Team', exact: true })
    .waitFor({ state: 'visible' })
  await panel.getByText('Project Team 已同步', { exact: true }).waitFor({ state: 'visible' })
  for (const member of expected.members ?? []) {
    const card = panel.locator('article').filter({ hasText: member.name }).first()
    await card.getByRole('heading', { name: member.name, exact: true })
      .waitFor({ state: 'visible' })
    await card.getByText(member.status === 'inactive' ? / · 已停用$/u : / · 活跃$/u)
      .waitFor({ state: 'visible' })
    if (member.identityText !== undefined) {
      await card.getByText(member.identityText, { exact: true }).waitFor({ state: 'visible' })
    }
    if (member.eligibilityText !== undefined) {
      await card.getByText(member.eligibilityText, { exact: true })
        .waitFor({ state: 'visible' })
    }
  }
  if ((expected.members ?? []).length === 0) {
    await panel.getByText('这个 Project 还没有成员。', { exact: true })
      .waitFor({ state: 'visible' })
  }
  if (expected.responsibility === undefined) {
    await panel.getByText('尚未配置 Project Responsibility。', { exact: true })
      .waitFor({ state: 'visible' })
  } else {
    const current = panel.locator('section[aria-label="当前 Host 责任"]')
    await current.waitFor({ state: 'visible' })
    const valueFor = label => current.getByText(label, { exact: true })
      .first().locator('..').locator('dd')
    assert.equal(
      (await valueFor('Accountable').textContent())?.trim(),
      expected.responsibility.accountable,
    )
    const contributors = (await valueFor('Contributors').textContent())?.trim().split(', ')
    assert.deepEqual(
      [...contributors ?? []].sort(),
      [...expected.responsibility.contributors].sort(),
    )
    assert.equal(
      (await valueFor('Human Sponsor').textContent())?.trim(),
      expected.responsibility.sponsor ?? '无 Human Sponsor',
    )
  }
  return panel
}

async function addProjectMemberViaUi(page, member) {
  const panel = projectTeamPanel(page)
  const disclosure = panel.locator('details').filter({ hasText: '添加 ProjectMember' })
  if (!(await disclosure.evaluate(element => element.open))) {
    await disclosure.locator('summary').click()
  }
  if (member.kind === 'agent') {
    await disclosure.getByLabel('Agent', { exact: true }).check()
  } else {
    await disclosure.getByLabel('人类', { exact: true }).check()
  }
  await disclosure.getByLabel('显示名称', { exact: true }).fill(member.name)
  if (member.kind === 'human' && member.identity === 'feishu') {
    await disclosure.getByLabel('声明的飞书身份', { exact: true }).check()
    await disclosure.getByLabel('飞书 App ID', { exact: true }).fill(member.appId)
    await disclosure.getByLabel('飞书 open_id', { exact: true }).fill(member.openId)
  } else if (member.kind === 'human') {
    await disclosure.getByLabel('外部联系人', { exact: true }).check()
    await disclosure.getByRole('combobox', { name: '联系方式', exact: true })
      .selectOption(member.method)
    await disclosure.getByLabel('联系值', { exact: true }).fill(member.value)
  }
  const add = disclosure.getByRole('button', { name: '添加成员', exact: true })
  assert.equal(await add.isEnabled(), true, `${member.name}: add member action stayed disabled`)
  await add.click()
  await panel.getByRole('heading', { name: member.name, exact: true })
    .waitFor({ state: 'visible' })
}

async function assertWithinViewport(locator, page, label) {
  const box = await locator.boundingBox()
  assert.notEqual(box, null, `${label}: element has no rendered box`)
  const viewport = page.viewportSize()
  assert.notEqual(viewport, null, `${label}: page has no viewport`)
  assert.ok(
    box.x >= -1 && box.x + box.width <= viewport.width + 1,
    `${label}: element overflows viewport (x=${String(box.x)}, width=${String(box.width)}, viewport=${String(viewport.width)})`,
  )
}

async function captureVisual(page, name, options = {}) {
  if (visualArtifactRoot === undefined) return
  const recovery = options.recovery
  const recoveryLocator = recovery === undefined
    ? undefined
    : page.locator('code[aria-labelledby="workbench-recovery-label"]')
  if (recoveryLocator !== undefined) {
    const placeholder = 'WB1-7J9K-M2NP-Q4RS-T6VW-X8YZ-3BCD-5FGH-7JKM'
    assert.equal(placeholder.length, recovery.length)
    await recoveryLocator.evaluate((node, value) => { node.textContent = value }, placeholder)
  }
  try {
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: join(visualArtifactRoot, `${name}.png`),
    })
    await assertNoHorizontalOverflow(page, name)
  } finally {
    if (recoveryLocator !== undefined) {
      await recoveryLocator.evaluate((node, value) => { node.textContent = value }, recovery)
    }
  }
}

async function useViewport(page, viewport, work) {
  const previous = page.viewportSize()
  await page.setViewportSize(viewport)
  if (viewport.width === MOBILE_VIEWPORT.width && previous?.width !== viewport.width) {
    // AppFrame seeds its responsive store from window.innerWidth. Reloading at
    // the target viewport mirrors a real mobile navigation and avoids testing
    // an intermediate wide-to-narrow transition frame.
    await page.reload({ waitUntil: 'load' })
    await dismissHarnessOnboarding(page)
    if (!reportedMobileShell) {
      reportedMobileShell = true
      process.stdout.write(
        'INFO 375px viewport: navigated at mobile width so the Harness shell starts on its compact rail\n',
      )
    }
  }
  await page.waitForTimeout(250)
  await work()
}

async function assertVisibleKeyboardFocus(locator, label) {
  const page = locator.page()
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })
  let reached = false
  for (let attempt = 0; attempt < 128; attempt += 1) {
    await page.keyboard.press('Tab')
    reached = await locator.evaluate(element => document.activeElement === element)
    if (reached) break
  }
  assert.equal(reached, true, `${label}: control is not reachable by keyboard Tab navigation`)
  const focus = await locator.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      active: document.activeElement === element,
      boxShadow: style.boxShadow,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    }
  })
  assert.equal(focus.active, true, `${label}: keyboard navigation did not focus the control`)
  assert.equal(focus.focusVisible, true, `${label}: keyboard focus is not represented by :focus-visible`)
  assert.ok(
    focus.boxShadow !== 'none'
      || (focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px'),
    `${label}: focus-visible has no visual indicator`,
  )
}

async function invokeRecoveryCli(profileDir, dshHome, env, recoveryCode, password, allowFailure = false) {
  const stdin = Buffer.from(`${recoveryCode}\n${password}\n${password}\n`, 'utf8')
  try {
    return await runCommand(
      'built dsh-workbench offline recovery',
      'pnpm',
      [
        '--dir', profileDir,
        'exec', 'dsh-workbench',
        'owner', 'recover',
        '--dsh-home', dshHome,
        '--stdin',
      ],
      {
        allowFailure,
        cwd: repositoryRoot,
        env,
        stdin,
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
    )
  } finally {
    stdin.fill(0)
  }
}

function replacementRecoveryCode(outcome) {
  assert.equal(outcome.code, 0, 'offline recovery did not exit successfully')
  const lines = outcome.stdout.split(/\r?\n/gu).filter(Boolean)
  assert.equal(lines.length, 1, 'offline recovery stdout must contain exactly one replacement code')
  assert.ok(
    /^WB1-(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/u.test(lines[0]),
    'offline recovery stdout was not one canonical recovery code',
  )
  return lines[0]
}

function assertRecoveryRejected(outcome) {
  assert.equal(outcome.code, 1, 'a consumed recovery code was unexpectedly accepted')
  assert.ok(outcome.stdout === '', 'failed recovery leaked data on stdout')
  assert.ok(
    outcome.stderr.includes('invalid or has already been used'),
    'failed recovery did not report the stable consumed-code result',
  )
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  throw new Error(`${label} did not happen within ${String(timeoutMs)} ms`)
}

function restoreClientBundle() {
  if (pendingBundleRestore === undefined) return
  writeFileSync(pendingBundleRestore.path, pendingBundleRestore.bytes)
  pendingBundleRestore = undefined
}

async function exerciseClientHmr(journey, bundlePath, message) {
  const page = journey.page
  const expectedBundlePath = join(repositoryRoot, 'packages/workbench-client/lib/client.js')
  assert.equal(resolve(bundlePath), expectedBundlePath)
  await waitForCondition(
    () => journey.requests.some(url => new URL(url).pathname === '/plugins/events'),
    10_000,
    'browser Client HMR event channel',
  )

  const oldSurface = await page.locator('main[data-workbench-phase="value"]').elementHandle()
  const oldEditor = await page.locator('#workbench-status-editor').elementHandle()
  assert.notEqual(oldSurface, null)
  assert.notEqual(oldEditor, null)
  const pageIdentity = await page.evaluate(() => {
    const value = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte =>
      byte.toString(16).padStart(2, '0')).join('')
    Object.defineProperty(window, '__workbenchE2ePageIdentity', { value })
    return value
  })
  const requestFence = journey.requests.length
  const original = readFileSync(bundlePath)
  pendingBundleRestore = { path: bundlePath, bytes: original }
  const originalSource = original.toString('utf8')
  const cssPrefix = `registerWorkbenchStyle("${CLIENT_PACKAGE_ID}/WorkbenchStatusPage.module.css", "`
  const cssAt = originalSource.indexOf(cssPrefix)
  assert.ok(cssAt >= 0, 'built Client bundle did not expose the status CSS registration')
  assert.equal(originalSource.lastIndexOf(cssPrefix), cssAt, 'built Client bundle duplicated the status CSS registration')
  const cssMarker = ':root{--workbench-e2e-css-hmr:applied}'
  assert.equal(originalSource.includes(cssMarker), false)
  const insertion = cssAt + cssPrefix.length
  const changed = originalSource.slice(0, insertion) + cssMarker + originalSource.slice(insertion)
  const initialStyleIds = await page.locator(
    `style[data-plugin="${CLIENT_PACKAGE_ID}"]`,
  ).evaluateAll(styles => styles.map(style => style.dataset.pluginCss).sort())
  assert.deepEqual(
    initialStyleIds,
    WORKBENCH_CLIENT_STYLE_IDS,
    'Workbench Client did not own the exact nine CSS Module resources',
  )

  // Change actual inline CSS bytes: stale tag reuse now fails this journey,
  // while a lifecycle-owned HMR replacement updates the live document.
  writeFileSync(bundlePath, changed)

  await page.waitForFunction(surface => !surface.isConnected, oldSurface, {
    timeout: PAGE_TIMEOUT_MS,
  })
  assert.equal(await oldEditor.evaluate(editor => editor.isConnected), false)
  const restored = page.locator('main[data-workbench-phase="value"]')
  await restored.waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS })
  const projection = restored.locator('p').filter({ hasText: message })
  await projection.waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS })
  assert.equal(await projection.textContent(), message)
  assert.equal(await restored.locator('#workbench-status-editor').inputValue(), message)
  assert.equal(await page.evaluate(() => window.__workbenchE2ePageIdentity), pageIdentity)
  await page.waitForFunction(marker => getComputedStyle(document.documentElement)
    .getPropertyValue('--workbench-e2e-css-hmr').trim() === marker, 'applied')
  const styleEvidence = await page.locator(
    `style[data-plugin="${CLIENT_PACKAGE_ID}"]`,
  ).evaluateAll((styles, marker) => ({
    ids: styles.map(style => style.dataset.pluginCss).sort(),
    marked: styles.filter(style => style.textContent?.includes(marker) === true).length,
  }), cssMarker)
  assert.deepEqual(styleEvidence, { ids: WORKBENCH_CLIENT_STYLE_IDS, marked: 1 })
  assert.ok(journey.requests.slice(requestFence).some(url =>
    decodeURIComponent(url).includes('@benz-ai-x/dsh-project-workbench-client/client.js')),
  'browser did not request the rebuilt Workbench Client bundle')
}

function assertSafeTempRoot(path) {
  const resolvedPath = resolve(path)
  const resolvedTmp = resolve(tmpdir())
  assert.equal(relative(resolvedTmp, resolvedPath).startsWith(`..${sep}`), false)
  assert.equal(resolvedPath === resolvedTmp, false)
  assert.ok(basename(resolvedPath).startsWith(tempPrefixName), `unsafe temporary root: ${resolvedPath}`)
}

async function cleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  for (const host of [...runningHosts]) {
    try {
      await stopDsh(host, false)
    } catch {
      host.child.kill('SIGKILL')
    }
  }
  if (browser !== undefined) {
    try {
      await browser.close()
    } catch {
      // A signal may race browser teardown; the host processes are already stopped.
    }
  }
  restoreClientBundle()
  if (tempRoot !== undefined) {
    assertSafeTempRoot(tempRoot)
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function main() {
  const chromeExecutable = resolveChromeExecutable()
  for (const required of [
    materializer,
    dshBin,
    chromeExecutable,
    join(dshBaselineRoot, 'apps/web/dist/index.html'),
    join(repositoryRoot, 'packages/workbench-host/lib/index.js'),
    join(repositoryRoot, 'packages/workbench-host/lib/recover-cli.js'),
    join(repositoryRoot, 'packages/workbench-client/lib/client.js'),
  ]) {
    assert.ok(existsSync(required), `required built artifact is missing: ${required}`)
  }

  tempRoot = mkdtempSync(join(tmpdir(), tempPrefixName))
  assertSafeTempRoot(tempRoot)
  const configuredVisualRoot = process.env.DSH_WORKBENCH_E2E_VISUAL_OUTPUT?.trim()
  visualArtifactRoot = configuredVisualRoot === undefined || configuredVisualRoot === ''
    ? join(tempRoot, 'visuals')
    : resolve(configuredVisualRoot)
  mkdirSync(visualArtifactRoot, { recursive: true })
  const dshHome = join(tempRoot, 'home')
  const agentsHome = join(tempRoot, 'agents')
  const projectDir = join(tempRoot, 'project')
  mkdirSync(projectDir, { recursive: true })

  const setupEnv = scrubbedRuntimeEnvironment(dshHome, agentsHome)
  const baselineCommit = await runCommand(
    'pinned DSH baseline commit check',
    'git',
    ['-C', dshBaselineRoot, 'rev-parse', 'HEAD'],
    { cwd: repositoryRoot, env: setupEnv, timeoutMs: COMMAND_TIMEOUT_MS },
  )
  assert.equal(baselineCommit.stdout.trim(), referenceLock.upstream.commit)
  const baselineStatus = await runCommand(
    'pinned DSH baseline cleanliness check',
    'git',
    ['-C', dshBaselineRoot, 'status', '--short', '--untracked-files=no'],
    { cwd: repositoryRoot, env: setupEnv, timeoutMs: COMMAND_TIMEOUT_MS },
  )
  assert.equal(baselineStatus.stdout.trim(), '', 'pinned DSH baseline has tracked changes')
  const materialized = await runCommand(
    'workbench Profile materializer',
    process.execPath,
    [materializer],
    { cwd: repositoryRoot, env: setupEnv, timeoutMs: COMMAND_TIMEOUT_MS },
  )
  const profileDir = join(dshHome, 'profiles', profileName)
  assert.equal(resolve(materialized.stdout.trim()), profileDir)
  await runCommand(
    'offline Profile install',
    'pnpm',
    ['install', '--offline', '--frozen-lockfile=false', '--ignore-scripts', '--dir', profileDir],
    { cwd: repositoryRoot, env: setupEnv, timeoutMs: COMMAND_TIMEOUT_MS },
  )

  const runtimeEnv = scrubbedRuntimeEnvironment(dshHome, agentsHome)
  browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
    ],
  })

  const initialPassword = `T06 Owner initial ${new Date().toISOString()}!`
  const wrongPassword = 'T06 deliberately wrong password!'
  const firstRecoveredPassword = `T06 Owner recovered once ${new Date().toISOString()}!`
  const finalRecoveredPassword = `T06 Owner recovered twice ${new Date().toISOString()}!`
  const message = `T06 audited browser restart proof ${new Date().toISOString()}`
  const projectName = `T06 browser Project ${new Date().toISOString()}`
  const primaryGoalName = '缩短 Workbench 浏览器反馈周期'
  const outcomeName = '将浏览器验证反馈周期降至三天'
  const metricName = '浏览器验证反馈周期'
  const feishuSponsorName = '浏览器飞书 Sponsor'
  const feishuAppId = 'cli.browser:001'
  const feishuOpenId = 'ou-browser_sponsor'
  const feishuCredentialRef = 'WORKBENCH_E2E_FEISHU_APP_SECRET'
  const feishuCredentialValue = 'must-never-enter-workbench-browser-or-sqlite'
  const externalContributorName = '浏览器外部 Contributor'
  const externalContact = 'browser.external@example.invalid'
  const agentAccountableName = '浏览器研究 Agent'
  const inactiveHistorianName = '浏览器历史成员'
  const inactiveHistorianContact = 'browser-historian-reference'
  const lowDeferredFeedback = 'T06 low proposal deferred for focused browser review'
  const highAcceptedFeedback = 'T06 high-risk ownership transfer explicitly confirmed'
  const staleRejectedFeedback = 'T06 stale proposal rejected without overwriting Team truth'
  const editedAcceptedFeedback = 'T06 edited candidate accepted with original high risk retained'
  const elevatedEditedAcceptedFeedback = 'T06 low proposal edited into high risk and explicitly confirmed'
  const finalDeferredFeedback = 'T06 final low proposal deferred after all target writes'
  const deliverableName = 'T11 browser acceptance evidence'
  const deliverableCriterion = '每个声明版本与验收证据均可检查'
  const deliverableDecisionFeedback = 'Owner 已检查全部冻结候选并记录正式批准。'
  const deliverableLongToken = `declared-version-${'x'.repeat(180)}`
  const expectedHttpError = /(?:401|Unauthorized)/u

  // Fresh browser: setup is visible, but the protected projection is neither
  // requested nor rendered before the Owner session exists.
  const first = await startDsh(projectDir, runtimeEnv)
  const firstJourney = await openCheckedPage(first.readyUrl, 'initial boot')
  await dismissHarnessOnboarding(firstJourney.page)
  const firstNetwork = await installNetworkEvidence(firstJourney.page)
  const setupPassword = firstJourney.page.locator('#workbench-owner-password')
  const setupConfirmation = firstJourney.page.locator('#workbench-owner-confirmation')
  await setupPassword.waitFor({ state: 'visible' })
  assert.equal(await firstJourney.page.locator('#workbench-login-password').count(), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SNAPSHOT_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_ACTIVITY_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_AUDIT_INTEGRITY_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_START_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TEAM_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_ADD_PROJECT_MEMBER_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_MEMBER_STATUS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_REVIEW_CENTER_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROPOSE_RESPONSIBILITY_CHANGE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DECIDE_SUGGESTED_CHANGE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_FEISHU_CONNECTION_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_FEISHU_ROUTE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_VERIFY_FEISHU_ROUTE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TASKS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_TASK_WORKFLOW_FIELDS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PREVIEW_TASK_WORKFLOW_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_TASK_WORKFLOW_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_BIND_PROJECT_CALENDAR_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_GET_PROJECT_MILESTONES_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_MILESTONE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_DELIVERABLES_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_DELIVERABLE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_REQUEST_DELIVERABLE_ACCEPTANCE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DECIDE_DELIVERABLE_ACCEPTANCE_PATH), 0)
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-projects-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-team-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-tasks-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-milestones-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-deliverables-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-activity-title').count(), 0)
  await assertVisibleKeyboardFocus(setupPassword, 'desktop setup password')
  await captureVisual(firstJourney.page, '01-setup-desktop')
  await useViewport(firstJourney.page, MOBILE_VIEWPORT, async () => {
    await setupPassword.waitFor({ state: 'visible' })
    await captureVisual(firstJourney.page, '02-setup-mobile-375')
    await assertWithinViewport(setupPassword, firstJourney.page, 'mobile setup password')
    await assertVisibleKeyboardFocus(setupPassword, 'mobile setup password')
  })

  await expectCarrierDenied(firstJourney.page, firstNetwork, false)
  await expectCarrierDenied(
    firstJourney.page,
    firstNetwork,
    false,
    WORKBENCH_DISCOVER_TASK_WORKFLOW_FIELDS_PATH,
  )
  await expectCarrierDenied(
    firstJourney.page,
    firstNetwork,
    false,
    WORKBENCH_PREVIEW_TASK_WORKFLOW_PATH,
  )
  await expectCarrierDenied(
    firstJourney.page,
    firstNetwork,
    false,
    WORKBENCH_CONFIGURE_TASK_WORKFLOW_PATH,
  )
  for (const path of [
    WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH,
    WORKBENCH_BIND_PROJECT_CALENDAR_PATH,
    WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH,
    WORKBENCH_GET_PROJECT_MILESTONES_PATH,
    WORKBENCH_CREATE_PROJECT_MILESTONE_PATH,
    WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH,
    WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH,
  ]) {
    await expectCarrierDenied(firstJourney.page, firstNetwork, false, path)
  }
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SNAPSHOT_PATH), 1)
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-projects-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-team-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-tasks-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-milestones-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-activity-title').count(), 0)

  // Hold the real initialize request briefly so the actual disabled/pending
  // UI is observable rather than inferred from component internals.
  let releaseInitialization
  const initializationGate = new Promise(resolveGate => { releaseInitialization = resolveGate })
  await firstJourney.page.route(`**${OWNER_AUTH_INITIALIZE_PATH}`, async route => {
    await initializationGate
    await route.fallback()
  }, { times: 1 })
  await setupPassword.fill(initialPassword)
  await setupConfirmation.fill(initialPassword)
  const initializeButton = firstJourney.page.locator('form button[type="submit"]')
  const initializationClick = initializeButton.click()
  try {
    await firstJourney.page.waitForFunction(() => {
      const password = document.querySelector('#workbench-owner-password')
      const confirmation = document.querySelector('#workbench-owner-confirmation')
      const submit = document.querySelector('form button[type="submit"]')
      return password?.disabled === true
        && confirmation?.disabled === true
        && submit?.disabled === true
    })
    await captureVisual(firstJourney.page, '03-setup-pending-disabled')
  } finally {
    releaseInitialization()
  }
  await initializationClick

  const recoveryLocator = firstJourney.page
    .locator('code[aria-labelledby="workbench-recovery-label"]')
  await recoveryLocator.waitFor({ state: 'visible' })
  const recoveryCode = (await recoveryLocator.textContent())?.trim()
  assert.ok(
    typeof recoveryCode === 'string'
      && /^WB1-(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/u.test(recoveryCode),
    'browser did not render one canonical offline recovery code',
  )
  const recoveryOccurrences = await firstJourney.page.evaluate(
    code => document.body.innerText.split(code).length - 1,
    recoveryCode,
  )
  assert.equal(recoveryOccurrences, 1, 'initial recovery code was rendered more than once')
  await assertSecretsAbsentFromBrowserStorage(
    firstJourney.page,
    [initialPassword, recoveryCode],
  )

  await waitForCondition(
    () => responseHeaderForPath(firstNetwork, OWNER_AUTH_INITIALIZE_PATH, 'set-cookie') !== undefined,
    PAGE_TIMEOUT_MS,
    'Owner initialize Set-Cookie response evidence',
  )
  const setCookie = responseHeaderForPath(
    firstNetwork,
    OWNER_AUTH_INITIALIZE_PATH,
    'set-cookie',
  )
  assert.ok(setCookie?.startsWith(`${OWNER_SESSION_COOKIE_NAME}=`) === true)
  assert.ok(/(?:^|;)\s*Path=\/(?:;|$)/iu.test(setCookie), 'Owner cookie is missing Path=/')
  assert.ok(/(?:^|;)\s*Secure(?:;|$)/iu.test(setCookie), 'Owner cookie is missing Secure')
  assert.ok(/(?:^|;)\s*HttpOnly(?:;|$)/iu.test(setCookie), 'Owner cookie is missing HttpOnly')
  assert.ok(/(?:^|;)\s*SameSite=Strict(?:;|$)/iu.test(setCookie), 'Owner cookie is missing SameSite=Strict')
  assert.ok(!/(?:^|;)\s*Domain=/iu.test(setCookie), 'Owner cookie unexpectedly declares Domain')

  await ownerCookieFromChrome(firstNetwork)
  assert.ok(
    !(await firstJourney.page.evaluate(name => document.cookie.includes(`${name}=`), OWNER_SESSION_COOKIE_NAME)),
    'HttpOnly Owner cookie was visible to document.cookie',
  )
  await assertOwnerCookieRoundTrip(firstJourney.page, firstNetwork)
  await assertRealCarrierForbidden(firstJourney.page, firstNetwork)

  const recoveryPresentation = await recoveryLocator.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      clientWidth: element.clientWidth,
      fontSize: Number.parseFloat(style.fontSize),
      overflowWrap: style.overflowWrap,
      scrollWidth: element.scrollWidth,
    }
  })
  assert.ok(recoveryPresentation.fontSize >= 12, 'recovery code text is too small to read')
  assert.equal(recoveryPresentation.overflowWrap, 'anywhere')
  assert.ok(
    recoveryPresentation.scrollWidth <= recoveryPresentation.clientWidth + 1,
    'mobile recovery code overflows its readable block',
  )
  await assertWithinViewport(recoveryLocator, firstJourney.page, 'mobile recovery code')
  await assertVisibleKeyboardFocus(recoveryLocator, 'mobile recovery code')
  await captureVisual(firstJourney.page, '04-recovery-mobile-375', { recovery: recoveryCode })
  await firstJourney.page.setViewportSize(DESKTOP_VIEWPORT)
  await firstJourney.page.waitForTimeout(250)
  await assertWithinViewport(recoveryLocator, firstJourney.page, 'desktop recovery code')
  await assertVisibleKeyboardFocus(recoveryLocator, 'desktop recovery code')
  await captureVisual(firstJourney.page, '05-recovery-desktop', { recovery: recoveryCode })

  await firstJourney.page.getByRole('button', { name: '我已安全保存，进入工作台' }).click()
  await firstJourney.page.locator('main[data-workbench-phase="empty"]').waitFor({ state: 'visible' })
  const initialProjectCatalog = await assertProjectCatalog(firstJourney.page)
  await initialProjectCatalog.panel.getByText('还没有 Project。完成上面的表单即可创建第一个。', {
    exact: true,
  }).waitFor({ state: 'visible' })
  const unselectedTeam = projectTeamPanel(firstJourney.page)
  await unselectedTeam.getByRole('heading', { name: 'Project Team', exact: true })
    .waitFor({ state: 'visible' })
  await unselectedTeam.getByText(
    '打开一个 Project 后，可在该项目的详情下管理成员与责任。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  const unselectedReview = reviewCenterPanel(firstJourney.page)
  await unselectedReview.getByRole('heading', { name: 'Review Center', exact: true })
    .waitFor({ state: 'visible' })
  await assertFeishuConnectionCenter(firstJourney.page)
  await assertProjectTasksUnbound(firstJourney.page)
  await assertProjectMilestonesUnbound(firstJourney.page)
  await projectDeliverablesPanel(firstJourney.page)
    .getByRole('heading', { name: 'Project Deliverables', exact: true })
    .waitFor({ state: 'visible' })
  await assertActivityProjection(firstJourney.page, 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_ACTIVITY_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_START_PATH) > 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TEAM_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_ADD_PROJECT_MEMBER_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_MEMBER_STATUS_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_REVIEW_CENTER_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROPOSE_RESPONSIBILITY_CHANGE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DECIDE_SUGGESTED_CHANGE_PATH), 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_FEISHU_CONNECTION_PATH) > 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_FEISHU_ROUTE_PATH), 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_VERIFY_FEISHU_ROUTE_PATH), 0)
  assert.equal(
    countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TASKS_PATH),
    0,
    'Project Tasks queried Host before a Project was selected',
  )
  assert.equal(
    countRequestsToPath(firstJourney, WORKBENCH_PROJECT_DELIVERABLES_PATH),
    0,
    'Project Deliverables queried Host before a Project was selected',
  )
  assert.equal(
    countRequestsToPath(firstJourney, WORKBENCH_GET_PROJECT_MILESTONES_PATH),
    1,
    'Project Milestones queried Host before selection beyond the explicit authorization probe',
  )
  for (const path of [
    WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH,
    WORKBENCH_BIND_PROJECT_CALENDAR_PATH,
    WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH,
    WORKBENCH_CREATE_PROJECT_MILESTONE_PATH,
    WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH,
    WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH,
  ]) {
    assert.equal(
      countRequestsToPath(firstJourney, path),
      1,
      `Project Milestones invoked ${path} beyond the explicit authorization probe`,
    )
  }
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_TASK_WORKFLOW_FIELDS_PATH), 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PREVIEW_TASK_WORKFLOW_PATH), 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_TASK_WORKFLOW_PATH), 1)
  assert.equal(
    countRequestsToPath(firstJourney, WORKBENCH_AUDIT_INTEGRITY_PATH),
    0,
    'Activity should receive audit integrity from the same Host snapshot, not a second RPC',
  )
  assert.equal(await recoveryLocator.count(), 0)
  await firstJourney.page.reload({ waitUntil: 'load' })
  await dismissHarnessOnboarding(firstJourney.page)
  await firstJourney.page.locator('main[data-workbench-phase="empty"]').waitFor({ state: 'visible' })
  const refreshedEmptyCatalog = await assertProjectCatalog(firstJourney.page)
  assert.equal(refreshedEmptyCatalog.definitionDigest, initialProjectCatalog.definitionDigest)
  await assertActivityProjection(firstJourney.page, 0)
  assert.equal(await recoveryLocator.count(), 0, 'refresh redisplayed the one-time recovery code')
  await assertSecretsAbsentFromBrowserStorage(
    firstJourney.page,
    [initialPassword, recoveryCode],
  )

  const firstEditor = firstJourney.page.locator('#workbench-status-editor')
  await firstEditor.click()
  await firstEditor.pressSequentially(message)
  assert.equal(await firstEditor.inputValue(), message)
  await firstJourney.page.getByRole('button', { name: '保存状态' }).click()
  await firstJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const firstProjection = firstJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await firstProjection.waitFor({ state: 'visible' })
  assert.equal(await firstProjection.textContent(), message)
  assert.equal(await firstEditor.inputValue(), message)
  const activityPanel = await assertActivityProjection(firstJourney.page, 1, message)
  const activityObjectId = activityPanel.getByLabel('对象 ID')
  await activityObjectId.fill('status-not-visible')
  await activityPanel.getByRole('button', { name: '应用筛选' }).click()
  await activityPanel.getByText('没有匹配的活动', { exact: true }).waitFor({ state: 'visible' })
  await activityObjectId.fill('')
  await activityPanel.getByRole('button', { name: '应用筛选' }).click()
  await assertActivityProjection(firstJourney.page, 1, message)

  const projectPanel = refreshedEmptyCatalog.panel
  await projectPanel.getByLabel('Project 名称', { exact: true }).fill(projectName)
  await projectPanel.getByLabel('Primary Goal 名称', { exact: true }).fill(primaryGoalName)
  await projectPanel.getByLabel('Outcome 名称', { exact: true }).fill(outcomeName)
  await projectPanel.getByLabel('衡量指标', { exact: true }).fill(metricName)
  await projectPanel.getByLabel('数值基线', { exact: true }).fill('12')
  await projectPanel.getByLabel('数值目标', { exact: true }).fill('3')
  await projectPanel.getByLabel('单位', { exact: true }).fill('天')
  await projectPanel.getByLabel('改善方向', { exact: true }).selectOption('decrease')
  const createProjectButton = projectPanel.getByRole('button', {
    name: '创建 Project',
    exact: true,
  })
  await createProjectButton.waitFor({ state: 'visible' })
  assert.equal(await createProjectButton.isEnabled(), true)
  await createProjectButton.click()
  await assertProjectDetail(firstJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    definitionDigest: refreshedEmptyCatalog.definitionDigest,
  })
  const committedCatalog = await assertProjectCatalog(firstJourney.page, projectName)
  assert.equal(committedCatalog.definitionDigest, refreshedEmptyCatalog.definitionDigest)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_PATH) > 0)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_PATH), 0)
  await assertProjectTasksUnbound(firstJourney.page, projectName)
  await assertProjectMilestonesUnbound(firstJourney.page, projectName)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TASKS_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_GET_PROJECT_MILESTONES_PATH) > 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH), 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_DISCOVER_TASK_WORKFLOW_FIELDS_PATH), 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_PREVIEW_TASK_WORKFLOW_PATH), 1)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_TASK_WORKFLOW_PATH), 1)
  await assertActivityProjection(
    firstJourney.page,
    2,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  )

  const activityObjectType = activityPanel.getByLabel('对象类型')
  const activityAction = activityPanel.getByLabel('动作')
  await activityObjectType.selectOption('project')
  await activityAction.selectOption('workbench.project.created')
  await activityPanel.getByRole('button', { name: '应用筛选' }).click()
  await activityPanel.getByRole('heading', { name: '已从 Template 创建 Project' })
    .waitFor({ state: 'visible' })
  assert.equal(await activityPanel.getByRole('heading', { name: '状态版本已提交' }).count(), 0)
  await activityPanel.getByText('已检查事件: 2', { exact: true }).waitFor({ state: 'visible' })
  for (const protectedText of [projectName, primaryGoalName, outcomeName, metricName]) {
    assert.equal((await activityPanel.textContent())?.includes(protectedText), false)
  }
  await activityObjectType.selectOption('feishu-task-workflow')
  await activityAction.selectOption('workbench.feishu-task-workflow.configured')
  await activityPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
  await activityPanel.getByText('没有匹配的活动', { exact: true }).waitFor({ state: 'visible' })
  await activityObjectType.selectOption('project-milestone')
  await activityAction.selectOption('workbench.project-milestone.date-update-requested')
  await activityPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
  await activityPanel.getByText('没有匹配的活动', { exact: true }).waitFor({ state: 'visible' })
  await activityObjectType.selectOption('')
  await activityAction.selectOption('')
  await activityPanel.getByRole('button', { name: '应用筛选' }).click()
  await assertActivityProjection(
    firstJourney.page,
    2,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  )

  const emptyTeam = await assertProjectTeam(firstJourney.page, { members: [] })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_TEAM_PATH) > 0)
  await emptyTeam.locator('details').filter({ hasText: '添加 ProjectMember' })
    .locator('summary').click()
  await emptyTeam.getByText(
    'open_id 只在该 App 范围内有意义。T05 只记录声明值，不会调用飞书验证。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  await addProjectMemberViaUi(firstJourney.page, {
    kind: 'human',
    identity: 'feishu',
    name: feishuSponsorName,
    appId: feishuAppId,
    openId: feishuOpenId,
  })
  await addProjectMemberViaUi(firstJourney.page, {
    kind: 'human',
    identity: 'external',
    name: externalContributorName,
    method: 'email',
    value: externalContact,
  })
  await addProjectMemberViaUi(firstJourney.page, {
    kind: 'agent',
    name: agentAccountableName,
  })
  await addProjectMemberViaUi(firstJourney.page, {
    kind: 'human',
    identity: 'external',
    name: inactiveHistorianName,
    method: 'other',
    value: inactiveHistorianContact,
  })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_ADD_PROJECT_MEMBER_PATH) >= 4)

  let teamPanel = projectTeamPanel(firstJourney.page)
  const historianCard = teamPanel.locator('article').filter({ hasText: inactiveHistorianName }).first()
  await historianCard.getByRole('button', { name: '停用成员', exact: true }).click()
  await historianCard.getByText(/ · 已停用$/u).waitFor({ state: 'visible' })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_MEMBER_STATUS_PATH) > 0)

  const accountableSelect = teamPanel.getByRole('combobox', {
    name: 'Accountable',
    exact: true,
  })
  await accountableSelect.selectOption({ label: `${agentAccountableName} · Agent 成员` })
  await teamPanel.getByText(
    '当前 Accountable 是 Agent 或外部联系人；必须选择一位不同的活跃人类 Sponsor。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  const saveResponsibility = teamPanel.getByRole('button', {
    name: '保存 Project Responsibility',
    exact: true,
  })
  assert.equal(await saveResponsibility.isDisabled(), true)
  await teamPanel.getByRole('group', { name: 'Contributors', exact: true })
    .getByRole('checkbox', { name: externalContributorName, exact: true })
    .check()
  assert.equal(await saveResponsibility.isDisabled(), true)
  await teamPanel.getByRole('combobox', { name: 'Human Sponsor', exact: true })
    .selectOption({ label: feishuSponsorName })
  assert.equal(await saveResponsibility.isEnabled(), true)
  await saveResponsibility.click()

  let expectedTeam = {
    members: [
      {
        name: feishuSponsorName,
        status: 'active',
        identityText: '仅声明，未验证',
        eligibilityText: '已有 App 范围 open_id；仍需后续连接器验证',
      },
      {
        name: externalContributorName,
        status: 'active',
        identityText: `email: ${externalContact}`,
        eligibilityText: '不可用：外部联系值不是飞书 assignee ID',
      },
      {
        name: agentAccountableName,
        status: 'active',
        identityText: 'Workbench Agent 描述身份',
        eligibilityText: '不可用：T05 Agent 不是飞书成员',
      },
      {
        name: inactiveHistorianName,
        status: 'inactive',
        identityText: `other: ${inactiveHistorianContact}`,
        eligibilityText: '不可用：成员已停用',
      },
    ],
    responsibility: {
      accountable: agentAccountableName,
      contributors: [externalContributorName],
      sponsor: feishuSponsorName,
    },
  }
  const teamPrivateValues = [
    feishuSponsorName,
    feishuAppId,
    feishuOpenId,
    externalContributorName,
    externalContact,
    agentAccountableName,
    inactiveHistorianName,
    inactiveHistorianContact,
  ]
  teamPanel = await assertProjectTeam(firstJourney.page, expectedTeam)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH) > 0)
  const accountableCard = teamPanel.locator('article')
    .filter({ hasText: agentAccountableName }).first()
  await accountableCard.getByText('Accountable', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(
    await accountableCard.getByRole('button', { name: '停用成员', exact: true }).isDisabled(),
    true,
  )
  await accountableCard.getByText(
    '该成员仍持有当前责任；请先重新分配责任，再停用。',
    { exact: true },
  ).waitFor({ state: 'visible' })
  await teamPanel.locator('article').filter({ hasText: externalContributorName }).first()
    .getByText('Contributors', { exact: true }).waitFor({ state: 'visible' })
  await teamPanel.locator('article').filter({ hasText: feishuSponsorName }).first()
    .getByText('Human Sponsor', { exact: true }).waitFor({ state: 'visible' })
  await assertActivityProjection(
    firstJourney.page,
    8,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    ...teamPrivateValues,
  )

  const activeReviewMembers = [
    feishuSponsorName,
    externalContributorName,
    agentAccountableName,
  ]
  const reviewPanel = reviewCenterPanel(firstJourney.page)
  await reviewPanel.getByRole('heading', { name: 'Review Center', exact: true })
    .waitFor({ state: 'visible' })
  await reviewPanel.getByRole('combobox', { name: '提案 Accountable', exact: true })
    .waitFor({ state: 'visible' })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_REVIEW_CENTER_PATH) > 0)
  const projectId = await findProjectIdViaCarrier(firstJourney.page, projectName)
  await applyReviewFilters(reviewPanel, '全部状态', '全部风险', [])
  await assertNoBatchAccept(reviewPanel)

  // A contributors-only proposal remains low risk and carries inspectable
  // evidence. T06 advertises only a future batch-policy seam: this card still
  // requires an individual decision with mandatory feedback.
  const lowDeferred = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: agentAccountableName,
    contributors: [externalContributorName, feishuSponsorName],
    sponsor: feishuSponsorName,
  })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROPOSE_RESPONSIBILITY_CHANGE_PATH) > 0)
  let lowDeferredCard = reviewCard(reviewPanel, lowDeferred.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    lowDeferredCard,
    lowDeferred.heading,
  )
  await lowDeferredCard.getByText(/Host 标记的 changed fields：.*Contributors/u)
    .waitFor({ state: 'visible' })
  await lowDeferredCard.getByText('低风险', { exact: true }).first().waitFor({ state: 'visible' })
  await lowDeferredCard.getByText('低风险同类批量 seam（尚未启用）', { exact: true })
    .waitFor({ state: 'visible' })
  await lowDeferredCard.getByRole('heading', { name: '证据', exact: true })
    .waitFor({ state: 'visible' })
  await lowDeferredCard.getByRole('button', { name: '接受', exact: true })
    .waitFor({ state: 'visible' })
  await assertNoBatchAccept(reviewPanel)
  await applyReviewFilters(reviewPanel, '待处理', '全部风险', [lowDeferred.heading])
  await applyReviewFilters(reviewPanel, '全部状态', '全部风险', [lowDeferred.heading])
  lowDeferredCard = reviewCard(reviewPanel, lowDeferred.heading)
  await chooseDecision(lowDeferredCard, '延期', lowDeferredFeedback)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_DECIDE_SUGGESTED_CHANGE_PATH) > 0)
  await applyReviewFilters(reviewPanel, '已延期', '全部风险', [lowDeferred.heading])
  await reviewCard(reviewPanel, lowDeferred.heading)
    .getByText('已延期', { exact: true }).first().waitFor({ state: 'visible' })

  // Accountable and Sponsor are high-risk ownership fields. Submission is
  // impossible until the card-local high-risk confirmation is explicitly set.
  await applyReviewFilters(reviewPanel, '全部状态', '全部风险', [lowDeferred.heading])
  const highAccepted = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [externalContributorName],
    sponsor: null,
  })
  let highAcceptedCard = reviewCard(reviewPanel, highAccepted.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    highAcceptedCard,
    highAccepted.heading,
  )
  await highAcceptedCard.getByText('高风险', { exact: true }).first().waitFor({ state: 'visible' })
  await highAcceptedCard.getByText(/(?:禁止|不可|不允许).*批量/u).waitFor({ state: 'visible' })
  await chooseDecision(highAcceptedCard, '接受', highAcceptedFeedback, true)
  expectedTeam = {
    ...expectedTeam,
    responsibility: {
      accountable: feishuSponsorName,
      contributors: [externalContributorName],
      sponsor: null,
    },
  }
  await assertProjectTeam(firstJourney.page, expectedTeam)
  await assertActivityProjection(
    firstJourney.page,
    12,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    ...teamPrivateValues,
    lowDeferredFeedback,
    highAcceptedFeedback,
    lowDeferred.evidenceAuditEventId,
    highAccepted.evidenceAuditEventId,
  )

  // A fresh low proposal is made stale by a normal authenticated Responsibility
  // carrier write. Review is then refreshed through its ordinary status filter;
  // the stale card exposes reject only and cannot overwrite the newer Team.
  await applyReviewFilters(
    reviewPanel,
    '全部状态',
    '全部风险',
    [lowDeferred.heading, highAccepted.heading],
  )
  const staleRejected = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [externalContributorName, agentAccountableName],
    sponsor: null,
  })
  await advanceResponsibilityViaCarrier(firstJourney.page, projectId, {
    accountable: agentAccountableName,
    contributors: [externalContributorName],
    sponsor: feishuSponsorName,
  })
  expectedTeam = {
    ...expectedTeam,
    responsibility: {
      accountable: agentAccountableName,
      contributors: [externalContributorName],
      sponsor: feishuSponsorName,
    },
  }
  await applyReviewFilters(
    reviewPanel,
    '已过期',
    '全部风险',
    [lowDeferred.heading, staleRejected.heading],
  )
  let staleRejectedCard = reviewCard(reviewPanel, staleRejected.heading)
  await staleRejectedCard.getByText('已过期', { exact: true }).first()
    .waitFor({ state: 'visible' })
  assert.equal(
    await staleRejectedCard.getByRole('button', { name: '接受', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await staleRejectedCard.getByRole('button', { name: '编辑后接受', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await staleRejectedCard.getByRole('button', { name: '延期', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await staleRejectedCard.getByRole('button', { name: '拒绝', exact: true }).isEnabled(),
    true,
  )
  const teamBeforeStaleReject = await readTeamViaCarrier(firstJourney.page, projectId)
  await applyReviewFilters(
    reviewPanel,
    '全部状态',
    '全部风险',
    [lowDeferred.heading, highAccepted.heading, staleRejected.heading],
  )
  staleRejectedCard = reviewCard(reviewPanel, staleRejected.heading)
  await chooseDecision(staleRejectedCard, '拒绝', staleRejectedFeedback)
  const teamAfterStaleReject = await readTeamViaCarrier(firstJourney.page, projectId)
  assert.deepEqual(
    {
      responsibility: teamAfterStaleReject.responsibility,
      teamRevision: teamAfterStaleReject.teamRevision,
    },
    {
      responsibility: teamBeforeStaleReject.responsibility,
      teamRevision: teamBeforeStaleReject.teamRevision,
    },
    'rejecting a stale proposal changed Project Team truth',
  )

  // Edit-and-accept preserves the original high-risk diff. The applied edit is
  // contributors-only, yet the effective risk cannot be downgraded below the
  // original high classification.
  const editedAccepted = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [externalContributorName],
    sponsor: null,
  })
  let editedAcceptedCard = reviewCard(reviewPanel, editedAccepted.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    editedAcceptedCard,
    editedAccepted.heading,
  )
  await editedAcceptedCard.getByRole('button', { name: '编辑后接受', exact: true }).click()
  await configureEditedDecision(editedAcceptedCard, activeReviewMembers, {
    accountable: agentAccountableName,
    contributors: [externalContributorName, feishuSponsorName],
    sponsor: feishuSponsorName,
  })
  await editedAcceptedCard.getByText('高风险', { exact: true }).first()
    .waitFor({ state: 'visible' })
  await editedAcceptedCard.getByLabel('我已核对高风险差异与证据', { exact: true })
    .waitFor({ state: 'visible' })
  await chooseDecision(editedAcceptedCard, '编辑后接受', editedAcceptedFeedback, true)
  expectedTeam = {
    ...expectedTeam,
    responsibility: {
      accountable: agentAccountableName,
      contributors: [externalContributorName, feishuSponsorName],
      sponsor: feishuSponsorName,
    },
  }
  await assertProjectTeam(firstJourney.page, expectedTeam)
  editedAcceptedCard = reviewCard(reviewPanel, editedAccepted.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    editedAcceptedCard,
    editedAccepted.heading,
  )
  await editedAcceptedCard.getByText(/实际应用的 changed fields：.*Contributors/u)
    .waitFor({ state: 'visible' })
  const editedAppliedDigest = await assertAppliedDiff(
    firstJourney.page,
    projectId,
    editedAcceptedCard,
    editedAccepted.heading,
  )
  await editedAcceptedCard.getByText('高风险', { exact: true }).first()
    .waitFor({ state: 'visible' })

  // The inverse edit is equally explicit: a low Contributor-only proposal is
  // promoted to high risk when the draft changes Accountable and Sponsor. The
  // form must expose the draft-aware effective risk before confirmation, and
  // history must preserve the exact applied values and digest after commit.
  const elevatedEditedAccepted = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: agentAccountableName,
    contributors: [externalContributorName],
    sponsor: feishuSponsorName,
  })
  let elevatedEditedAcceptedCard = reviewCard(reviewPanel, elevatedEditedAccepted.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    elevatedEditedAcceptedCard,
    elevatedEditedAccepted.heading,
  )
  await elevatedEditedAcceptedCard.getByRole('heading', {
    name: '原建议风险依据',
    exact: true,
  }).waitFor({ state: 'visible' })
  await elevatedEditedAcceptedCard.getByRole('button', {
    name: '编辑后接受',
    exact: true,
  }).click()
  await configureEditedDecision(elevatedEditedAcceptedCard, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [externalContributorName, agentAccountableName],
    sponsor: null,
  })
  const effectiveRiskPreview = elevatedEditedAcceptedCard
    .getByText('本次决定有效风险：', { exact: true }).locator('..')
  const appliedRiskPreview = elevatedEditedAcceptedCard
    .getByText('编辑后候选风险：', { exact: true }).locator('..')
  assert.ok((await effectiveRiskPreview.textContent())?.includes('高风险') === true)
  assert.ok((await appliedRiskPreview.textContent())?.includes('高风险') === true)
  await elevatedEditedAcceptedCard.getByText('Accountable 将发生变化。', { exact: true })
    .waitFor({ state: 'visible' })
  await elevatedEditedAcceptedCard.getByText('Human Sponsor 将发生变化。', { exact: true })
    .waitFor({ state: 'visible' })
  await chooseDecision(
    elevatedEditedAcceptedCard,
    '编辑后接受',
    elevatedEditedAcceptedFeedback,
    true,
  )
  expectedTeam = {
    ...expectedTeam,
    responsibility: {
      accountable: feishuSponsorName,
      contributors: [externalContributorName, agentAccountableName],
      sponsor: null,
    },
  }
  await assertProjectTeam(firstJourney.page, expectedTeam)
  elevatedEditedAcceptedCard = reviewCard(reviewPanel, elevatedEditedAccepted.heading)
  await assertSuggestedDiff(
    firstJourney.page,
    projectId,
    elevatedEditedAcceptedCard,
    elevatedEditedAccepted.heading,
  )
  const elevatedAppliedDigest = await assertAppliedDiff(
    firstJourney.page,
    projectId,
    elevatedEditedAcceptedCard,
    elevatedEditedAccepted.heading,
  )
  const elevatedClassification = elevatedEditedAcceptedCard
    .getByLabel('建议状态与风险', { exact: true })
  await elevatedClassification.getByText('高风险', { exact: true }).waitFor({ state: 'visible' })
  const elevatedProposedRisk = elevatedEditedAcceptedCard.getByRole('heading', {
    name: '原建议风险依据',
    exact: true,
  }).locator('..')
  await elevatedProposedRisk.getByText(/低风险/u).waitFor({ state: 'visible' })
  await elevatedProposedRisk.getByText('仅 Contributor 集合发生变化。', { exact: true })
    .waitFor({ state: 'visible' })
  const appliedRiskHistory = elevatedEditedAcceptedCard
    .getByText('实际应用风险：', { exact: true }).locator('..')
  assert.ok((await appliedRiskHistory.textContent())?.includes('高风险') === true)
  await elevatedEditedAcceptedCard.getByText('当前状态不可操作，因此不可批量处理。', {
    exact: true,
  }).waitFor({ state: 'visible' })

  // Leave one current-base pending and one current-base deferred low-risk card.
  // Together with the older stale/accepted/rejected cards, every T06 status and
  // both risk filters can now be exercised against one stable target version.
  const finalPending = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [externalContributorName],
    sponsor: null,
  })
  const finalDeferred = await createProposalViaUi(reviewPanel, activeReviewMembers, {
    accountable: feishuSponsorName,
    contributors: [agentAccountableName],
    sponsor: null,
  })
  let finalDeferredCard = reviewCard(reviewPanel, finalDeferred.heading)
  await chooseDecision(finalDeferredCard, '延期', finalDeferredFeedback)

  await applyReviewFilters(reviewPanel, '待处理', '全部风险', [finalPending.heading])
  await applyReviewFilters(reviewPanel, '已延期', '全部风险', [finalDeferred.heading])
  await applyReviewFilters(reviewPanel, '已过期', '全部风险', [lowDeferred.heading])
  await applyReviewFilters(
    reviewPanel,
    '已接受',
    '全部风险',
    [highAccepted.heading, editedAccepted.heading, elevatedEditedAccepted.heading],
  )
  await applyReviewFilters(reviewPanel, '已拒绝', '全部风险', [staleRejected.heading])
  await applyReviewFilters(
    reviewPanel,
    '全部状态',
    '低风险',
    [lowDeferred.heading, staleRejected.heading, finalPending.heading, finalDeferred.heading],
  )
  await applyReviewFilters(
    reviewPanel,
    '全部状态',
    '高风险',
    [highAccepted.heading, editedAccepted.heading, elevatedEditedAccepted.heading],
  )
  const allReviewHeadings = [
    lowDeferred.heading,
    highAccepted.heading,
    staleRejected.heading,
    editedAccepted.heading,
    elevatedEditedAccepted.heading,
    finalPending.heading,
    finalDeferred.heading,
  ]
  await applyReviewFilters(reviewPanel, '全部状态', '全部风险', allReviewHeadings)
  await assertNoBatchAccept(reviewPanel)

  const reviewPrivateValues = [
    lowDeferredFeedback,
    highAcceptedFeedback,
    staleRejectedFeedback,
    editedAcceptedFeedback,
    elevatedEditedAcceptedFeedback,
    finalDeferredFeedback,
    ...new Set([
      lowDeferred.evidenceAuditEventId,
      highAccepted.evidenceAuditEventId,
      staleRejected.evidenceAuditEventId,
      editedAccepted.evidenceAuditEventId,
      elevatedEditedAccepted.evidenceAuditEventId,
      finalPending.evidenceAuditEventId,
      finalDeferred.evidenceAuditEventId,
    ]),
  ]

  // Exercise the Client's T06 Activity form mapping, not only the Host codec:
  // the selected object/action must reach the Remote and return exactly the
  // two edited-accept audit facts while integrity still covers the full chain.
  await activityObjectType.selectOption('suggested-change')
  await activityAction.selectOption('workbench.suggested-change.edited-accepted')
  await activityPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
  const editedAcceptedActivity = activityPanel.getByRole('heading', {
    name: '已编辑并接受 SuggestedChange',
    exact: true,
  })
  await waitForCondition(
    async () => await editedAcceptedActivity.count() === 2,
    PAGE_TIMEOUT_MS,
    'T06 Activity object/action filter',
  )
  assert.equal(
    await activityPanel.getByRole('heading', { name: '已创建 SuggestedChange' }).count(),
    0,
    'T06 Activity filter was silently widened to every SuggestedChange action',
  )
  await activityPanel.getByText('已检查事件: 22', { exact: true }).waitFor({ state: 'visible' })
  await activityObjectType.selectOption('')
  await activityAction.selectOption('')
  await activityPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
  await assertActivityProjection(
    firstJourney.page,
    22,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    ...teamPrivateValues,
    ...reviewPrivateValues,
  )

  const assertRecoveredReview = async page => {
    const panel = reviewCenterPanel(page)
    await panel.getByRole('heading', { name: 'Review Center', exact: true })
      .waitFor({ state: 'visible' })
    await waitForCondition(
      async () => await reviewCardHeadings(panel).count() === allReviewHeadings.length,
      PAGE_TIMEOUT_MS,
      'durable Review cards',
    )
    assert.deepEqual(
      [...await reviewCardHeadings(panel).allTextContents()].sort(),
      [...allReviewHeadings].sort(),
    )
    await reviewCard(panel, lowDeferred.heading).getByText('已过期', { exact: true }).first()
      .waitFor({ state: 'visible' })
    await reviewCard(panel, highAccepted.heading).getByText(highAcceptedFeedback, { exact: true })
      .waitFor({ state: 'visible' })
    await reviewCard(panel, staleRejected.heading).getByText(staleRejectedFeedback, { exact: true })
      .waitFor({ state: 'visible' })
    const edited = reviewCard(panel, editedAccepted.heading)
    await edited.getByText(editedAcceptedFeedback, { exact: true }).waitFor({ state: 'visible' })
    await edited.getByText(/实际应用的 changed fields：.*Contributors/u)
      .waitFor({ state: 'visible' })
    assert.equal(await assertAppliedDiff(
      page,
      projectId,
      edited,
      editedAccepted.heading,
    ), editedAppliedDigest)
    const elevated = reviewCard(panel, elevatedEditedAccepted.heading)
    await elevated.getByText(elevatedEditedAcceptedFeedback, { exact: true })
      .waitFor({ state: 'visible' })
    assert.equal(await assertAppliedDiff(
      page,
      projectId,
      elevated,
      elevatedEditedAccepted.heading,
    ), elevatedAppliedDigest)
    await reviewCard(panel, finalPending.heading).getByText('待处理', { exact: true }).first()
      .waitFor({ state: 'visible' })
    await reviewCard(panel, finalDeferred.heading).getByText('已延期', { exact: true }).first()
      .waitFor({ state: 'visible' })
    await assertNoBatchAccept(panel)
    return panel
  }

  const deliverableFixture = deliverableBrowserFixture(projectId, deliverableLongToken)
  const firstDeliverableRoutes = await installDeliverableBrowserFixture(
    firstJourney.page,
    deliverableFixture,
  )
  await reloadAuthenticatedWorkbench(firstJourney.page)
  await reopenProject(firstJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await exerciseDeliverableBrowserJourney(firstJourney.page, deliverableFixture, {
    name: deliverableName,
    criterion: deliverableCriterion,
    feedback: deliverableDecisionFeedback,
    longToken: deliverableLongToken,
  })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_DELIVERABLES_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_CREATE_PROJECT_DELIVERABLE_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_REQUEST_DELIVERABLE_ACCEPTANCE_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_DECIDE_DELIVERABLE_ACCEPTANCE_PATH) > 0)
  await reloadAuthenticatedWorkbench(firstJourney.page)
  await reopenProject(firstJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await assertAcceptedDeliverableBrowserProjection(firstJourney.page, {
    name: deliverableName,
    longToken: deliverableLongToken,
  })

  const reviewRequestsBeforeHmr = countRequestsToPath(firstJourney, WORKBENCH_REVIEW_CENTER_PATH)
  const milestoneRequestsBeforeHmr = projectMilestoneRemoteCounts(firstJourney)
  await exerciseClientHmr(
    firstJourney,
    join(repositoryRoot, 'packages/workbench-client/lib/client.js'),
    message,
  )
  assert.equal(
    countRequestsToPath(firstJourney, WORKBENCH_REVIEW_CENTER_PATH),
    reviewRequestsBeforeHmr,
    'Client HMR queried Review without a selected Project',
  )
  assertProjectMilestoneRemotesSilent(
    firstJourney,
    milestoneRequestsBeforeHmr,
    'Client HMR',
  )
  await reopenProject(firstJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await assertProjectTeam(firstJourney.page, expectedTeam)
  await assertRecoveredReview(firstJourney.page)
  await assertAcceptedDeliverableBrowserProjection(firstJourney.page, {
    name: deliverableName,
    longToken: deliverableLongToken,
  })
  await configureAndVerifyMissingFeishuBot(firstJourney.page, {
    botAppId: feishuAppId,
    credentialRef: feishuCredentialRef,
    credentialValue: feishuCredentialValue,
  })
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_CONFIGURE_FEISHU_ROUTE_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_VERIFY_FEISHU_ROUTE_PATH) > 0)
  assert.ok(countRequestsToPath(firstJourney, WORKBENCH_PROJECT_PATH) > 0)
  await assertActivityProjection(
    firstJourney.page,
    24,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    feishuCredentialRef,
    feishuAppId,
    feishuCredentialValue,
    ...teamPrivateValues,
    ...reviewPrivateValues,
  )
  const sessionBar = firstJourney.page.locator('header').filter({
    has: firstJourney.page.getByRole('button', { name: '退出登录' }),
  })
  await sessionBar.waitFor({ state: 'visible' })
  await captureVisual(firstJourney.page, '06-authenticated-desktop')
  await withProjectMilestonesProjection(
    firstJourney.page,
    mobileProjectMilestonesProjection(projectId),
    async () => {
      await useViewport(firstJourney.page, MOBILE_VIEWPORT, async () => {
        await sessionBar.waitFor({ state: 'visible' })
        await firstJourney.page.locator('main[data-workbench-phase="value"]')
          .waitFor({ state: 'visible' })
        await reopenProject(firstJourney.page, {
          projectName,
          primaryGoalName,
          outcomeName,
          metricName,
        }, { skipMilestones: true })
        const mobileTeam = await assertProjectTeam(firstJourney.page, expectedTeam)
        const mobileReview = await assertRecoveredReview(firstJourney.page)
        const mobileMilestones = await assertProjectMilestonesBound(firstJourney.page)
        const mobileDeliverables = await assertAcceptedDeliverableBrowserProjection(
          firstJourney.page,
          { name: deliverableName, longToken: deliverableLongToken },
        )
        const mobileCreateSection = mobileMilestones.locator(
          'section[aria-labelledby="workbench-milestone-create-title"]',
        )
        const mobileMilestoneCard = mobileMilestones.locator(
          'article[aria-label="Research sign-off"]',
        )
        const mobileChanges = mobileMilestones.locator(
          'section[aria-labelledby="workbench-schedule-changes-title"]',
        )
        await mobileCreateSection.getByRole('radio', {
          name: '创建新的飞书事件',
          exact: true,
        }).check()
        const mobileCreateSchedule = mobileCreateSection.getByRole('group', {
          name: '权威日期意图',
          exact: true,
        })
        await mobileCreateSchedule.getByRole('radio', { name: '定时日程', exact: true }).check()
        await mobileCreateSchedule.getByLabel('IANA 时区', { exact: true })
          .waitFor({ state: 'visible' })
        await mobileMilestoneCard.locator('details summary').click()
        const mobileEditorSchedule = mobileMilestoneCard.getByRole('group', {
          name: '权威日期意图',
          exact: true,
        })
        await mobileEditorSchedule.getByLabel('开始日期', { exact: true })
          .waitFor({ state: 'visible' })
        await applyReviewFilters(mobileReview, '待处理', '全部风险', [finalPending.heading])
        const mobileAddDisclosure = mobileTeam.locator('details').filter({
          hasText: '添加 ProjectMember',
        })
        await mobileAddDisclosure.locator('summary').click()
        await assertWithinViewport(sessionBar, firstJourney.page, 'mobile Owner session bar')
        await assertWithinViewport(
          firstJourney.page.locator('#workbench-status-editor'),
          firstJourney.page,
          'mobile status editor',
        )
        await assertWithinViewport(
          firstJourney.page.getByLabel('Project 名称', { exact: true }),
          firstJourney.page,
          'mobile Project name editor',
        )
        await assertWithinViewport(
          mobileAddDisclosure.getByLabel('显示名称', { exact: true }),
          firstJourney.page,
          'mobile Project member name editor',
        )
        await assertWithinViewport(
          mobileTeam.getByRole('combobox', { name: 'Accountable', exact: true }),
          firstJourney.page,
          'mobile Accountable selector',
        )
        await assertVisibleKeyboardFocus(
          mobileTeam.getByRole('combobox', { name: 'Accountable', exact: true }),
          'mobile Accountable selector',
        )
        await assertWithinViewport(
          reviewFilterSelect(mobileReview, 0),
          firstJourney.page,
          'mobile Review status filter',
        )
        await assertWithinViewport(
          mobileReview.getByRole('combobox', { name: '提案 Accountable', exact: true }),
          firstJourney.page,
          'mobile Review proposal Accountable',
        )
        await assertWithinViewport(
          mobileCreateSection.getByRole('button', { name: '读取现有事件', exact: true }),
          firstJourney.page,
          'mobile Project event discovery',
        )
        await assertWithinViewport(
          mobileCreateSchedule.getByLabel('IANA 时区', { exact: true }),
          firstJourney.page,
          'mobile Project Milestone timezone',
        )
        await assertWithinViewport(
          mobileMilestoneCard.getByRole('link', {
            name: '在飞书日历中打开 Research sign-off （飞书日历）',
            exact: true,
          }),
          firstJourney.page,
          'mobile Feishu Calendar deep link',
        )
        await assertVisibleKeyboardFocus(
          reviewFilterSelect(mobileReview, 0),
          'mobile Review status filter',
        )
        await assertVisibleKeyboardFocus(
          mobileReview.getByRole('combobox', { name: '提案 Accountable', exact: true }),
          'mobile Review proposal Accountable',
        )
        await assertNoInternalHorizontalOverflow(
          mobileMilestones,
          'mobile Project Milestones panel',
        )
        await assertNoInternalHorizontalOverflow(
          mobileCreateSection,
          'mobile Project Milestone create section',
        )
        await assertNoInternalHorizontalOverflow(
          mobileCreateSchedule,
          'mobile timed Project Milestone fields',
        )
        await assertNoInternalHorizontalOverflow(
          mobileMilestoneCard,
          'mobile Project Milestone card',
        )
        await assertNoInternalHorizontalOverflow(
          mobileEditorSchedule,
          'mobile all-day Project Milestone editor',
        )
        await assertNoInternalHorizontalOverflow(
          mobileChanges,
          'mobile Project Milestone recent changes',
        )
        await assertNoInternalHorizontalOverflow(
          mobileDeliverables.panel,
          'mobile Project Deliverables panel',
        )
        await assertNoInternalHorizontalOverflow(
          mobileDeliverables.card,
          'mobile accepted Deliverable card with long declared version',
        )
        await assertNoHorizontalOverflow(firstJourney.page, 'authenticated mobile Project surfaces')
        const layout = await firstJourney.page.evaluate(() => {
          const session = document.querySelector('header[aria-label]')
          const status = document.querySelector('main[data-workbench-phase]')
          return {
            sessionHeight: session?.getBoundingClientRect().height ?? 0,
            statusHeight: status?.getBoundingClientRect().height ?? 0,
          }
        })
        assert.ok(layout.sessionHeight > 0 && layout.sessionHeight < MOBILE_VIEWPORT.height / 2)
        assert.ok(layout.statusHeight > 0, 'mobile session bar squeezed out the status surface')
        await captureVisual(firstJourney.page, '07-authenticated-mobile-375')
        await mobileMilestones.evaluate(element => { element.scrollIntoView({ block: 'start' }) })
        await firstJourney.page.waitForTimeout(100)
        await captureVisual(firstJourney.page, '08-project-milestones-mobile-375')
      })
    },
  )
  await firstJourney.page.setViewportSize(DESKTOP_VIEWPORT)
  await assertNoBrowserErrors(firstJourney, [expectedHttpError])

  await firstJourney.page.getByRole('button', { name: '退出登录' }).click()
  await firstJourney.page.locator('#workbench-login-password').waitFor({ state: 'visible' })
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-projects-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-team-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-milestones-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-project-deliverables-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-review-center-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-feishu-connection-title').count(), 0)
  assert.equal(await firstJourney.page.locator('#workbench-activity-title').count(), 0)
  await expectCarrierDenied(firstJourney.page, firstNetwork, false)
  const postLogoutCookies = await firstNetwork.cdp.send('Network.getAllCookies')
  assert.equal(
    postLogoutCookies.cookies.filter(cookie => cookie.name === OWNER_SESSION_COOKIE_NAME).length,
    0,
    'logout did not clear the browser Owner cookie',
  )
  await firstDeliverableRoutes.dispose()
  await firstJourney.context.close()

  // A genuinely separate browser context sees login, never setup. A rejected
  // password cannot create the protected controller; the correct password can.
  const separateJourney = await openCheckedPage(first.readyUrl, 'separate browser context')
  await dismissHarnessOnboarding(separateJourney.page)
  const separateLogin = separateJourney.page.locator('#workbench-login-password')
  await separateLogin.waitFor({ state: 'visible' })
  assert.equal(await separateJourney.page.locator('#workbench-owner-password').count(), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_SNAPSHOT_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_ACTIVITY_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_AUDIT_INTEGRITY_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_PROJECT_START_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_CREATE_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_PROJECT_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_PROJECT_TEAM_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_ADD_PROJECT_MEMBER_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_SET_PROJECT_MEMBER_STATUS_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_SET_PROJECT_RESPONSIBILITY_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_REVIEW_CENTER_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_PROPOSE_RESPONSIBILITY_CHANGE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_DECIDE_SUGGESTED_CHANGE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_PROJECT_DELIVERABLES_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_CREATE_PROJECT_DELIVERABLE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_REQUEST_DELIVERABLE_ACCEPTANCE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_DECIDE_DELIVERABLE_ACCEPTANCE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_FEISHU_CONNECTION_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_CONFIGURE_FEISHU_ROUTE_PATH), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_VERIFY_FEISHU_ROUTE_PATH), 0)
  for (const path of [
    WORKBENCH_DISCOVER_FEISHU_CALENDARS_PATH,
    WORKBENCH_BIND_PROJECT_CALENDAR_PATH,
    WORKBENCH_DISCOVER_FEISHU_CALENDAR_EVENTS_PATH,
    WORKBENCH_GET_PROJECT_MILESTONES_PATH,
    WORKBENCH_CREATE_PROJECT_MILESTONE_PATH,
    WORKBENCH_UPDATE_PROJECT_MILESTONE_DATE_PATH,
    WORKBENCH_RECONCILE_PROJECT_CALENDAR_PATH,
  ]) assert.equal(countRequestsToPath(separateJourney, path), 0)
  await separateLogin.fill(wrongPassword)
  await separateJourney.page.locator('form button[type="submit"]').click()
  await separateJourney.page.locator('#workbench-auth-issue').waitFor({ state: 'visible' })
  assert.equal(await separateJourney.page.locator('#workbench-status-editor').count(), 0)
  assert.equal(await separateJourney.page.locator('#workbench-projects-title').count(), 0)
  assert.equal(await separateJourney.page.locator('#workbench-project-team-title').count(), 0)
  assert.equal(await separateJourney.page.locator('#workbench-project-milestones-title').count(), 0)
  await separateLogin.fill(initialPassword)
  await separateJourney.page.locator('form button[type="submit"]').click()
  await separateJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const separateProjection = separateJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await separateProjection.waitFor({ state: 'visible' })
  assert.equal(await separateProjection.textContent(), message)
  await reviewCenterPanel(separateJourney.page)
    .getByRole('heading', { name: 'Review Center', exact: true })
    .waitFor({ state: 'visible' })
  await assertFeishuConnectionCenter(separateJourney.page, {
    botAppId: feishuAppId,
    credentialRef: feishuCredentialRef,
    credentialValue: feishuCredentialValue,
  })
  await assertProjectMilestonesUnbound(separateJourney.page)
  assert.equal(
    countRequestsToPath(separateJourney, WORKBENCH_REVIEW_CENTER_PATH),
    0,
    'a new browser context queried Review before selecting a Project',
  )
  assert.equal(
    countRequestsToPath(separateJourney, WORKBENCH_GET_PROJECT_MILESTONES_PATH),
    0,
    'a new browser context queried Milestones before selecting a Project',
  )
  await reopenProject(separateJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await assertProjectTeam(separateJourney.page, expectedTeam)
  await assertRecoveredReview(separateJourney.page)
  await assertActivityProjection(
    separateJourney.page,
    24,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    feishuCredentialRef,
    feishuAppId,
    feishuCredentialValue,
    ...teamPrivateValues,
    ...reviewPrivateValues,
  )
  await assertNoBrowserErrors(separateJourney, [expectedHttpError])
  await separateJourney.context.close()
  await stopDsh(first.host)
  restoreClientBundle()

  const databasePath = join(projectDir, '.dsh/project-workbench.sqlite')
  assert.ok(existsSync(databasePath), `Workbench database was not committed at ${databasePath}`)

  // A full Host restart reopens both the DSH credential record and Workbench
  // database. Login with the original credential recovers the same projection.
  const second = await startDsh(projectDir, runtimeEnv)
  const secondJourney = await openCheckedPage(second.readyUrl, 'credential and data restart boot')
  await dismissHarnessOnboarding(secondJourney.page)
  const secondNetwork = await installNetworkEvidence(secondJourney.page)
  const restartedDeliverableRoutes = await installDeliverableBrowserFixture(
    secondJourney.page,
    deliverableFixture,
  )
  const secondLogin = secondJourney.page.locator('#workbench-login-password')
  await secondLogin.waitFor({ state: 'visible' })
  assert.equal(await secondJourney.page.locator('#workbench-owner-password').count(), 0)
  await secondLogin.fill(initialPassword)
  await secondJourney.page.locator('form button[type="submit"]').click()
  await secondJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const recoveredProjection = secondJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await recoveredProjection.waitFor({ state: 'visible' })
  assert.equal(await recoveredProjection.textContent(), message)
  assert.equal(await secondJourney.page.locator('#workbench-status-editor').inputValue(), message)
  await reviewCenterPanel(secondJourney.page)
    .getByRole('heading', { name: 'Review Center', exact: true })
    .waitFor({ state: 'visible' })
  await assertFeishuConnectionCenter(secondJourney.page, {
    botAppId: feishuAppId,
    credentialRef: feishuCredentialRef,
    credentialValue: feishuCredentialValue,
  })
  assert.equal(
    countRequestsToPath(secondJourney, WORKBENCH_REVIEW_CENTER_PATH),
    0,
    'a restarted Host queried Review before the Owner selected a Project',
  )
  assert.equal(
    countRequestsToPath(secondJourney, WORKBENCH_PROJECT_DELIVERABLES_PATH),
    0,
    'a restarted Client queried Project Deliverables before Project selection',
  )
  assertProjectMilestoneRemotesSilent(
    secondJourney,
    emptyProjectMilestoneRemoteCounts(),
    'restarted Host before Project reopen',
  )
  await reopenProject(secondJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await assertProjectTeam(secondJourney.page, expectedTeam)
  await assertRecoveredReview(secondJourney.page)
  await assertAcceptedDeliverableBrowserProjection(secondJourney.page, {
    name: deliverableName,
    longToken: deliverableLongToken,
  })
  await assertActivityProjection(
    secondJourney.page,
    24,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    feishuCredentialRef,
    feishuAppId,
    feishuCredentialValue,
    ...teamPrivateValues,
    ...reviewPrivateValues,
  )
  await ownerCookieFromChrome(secondNetwork)
  await assertNoBrowserErrors(secondJourney)
  await stopDsh(second.host)

  // Recovery executes only with the Host stopped and carries every secret over
  // bounded stdin. The first replacement works once to rotate credentials a
  // second time; both consumed codes are then rejected.
  const firstRecovery = await invokeRecoveryCli(
    profileDir,
    dshHome,
    runtimeEnv,
    recoveryCode,
    firstRecoveredPassword,
  )
  const replacementCode = replacementRecoveryCode(firstRecovery)
  assert.ok(replacementCode !== recoveryCode, 'recovery did not rotate the one-time code')

  const replayedInitial = await invokeRecoveryCli(
    profileDir,
    dshHome,
    runtimeEnv,
    recoveryCode,
    firstRecoveredPassword,
    true,
  )
  assertRecoveryRejected(replayedInitial)

  const secondRecovery = await invokeRecoveryCli(
    profileDir,
    dshHome,
    runtimeEnv,
    replacementCode,
    finalRecoveredPassword,
  )
  const secondReplacementCode = replacementRecoveryCode(secondRecovery)
  assert.ok(secondReplacementCode !== replacementCode, 'replacement recovery code did not rotate')

  const replayedReplacement = await invokeRecoveryCli(
    profileDir,
    dshHome,
    runtimeEnv,
    replacementCode,
    finalRecoveredPassword,
    true,
  )
  assertRecoveryRejected(replayedReplacement)

  // The recovery credential-version fence revokes the pre-recovery browser
  // session. Old passwords fail; only the twice-rotated password reopens the
  // unchanged durable projection.
  const third = await startDsh(projectDir, runtimeEnv)
  const postRecoveryJourney = secondJourney
  postRecoveryJourney.errors.length = 0
  postRecoveryJourney.requests.length = 0
  const postRecoveryNavigation = await postRecoveryJourney.page.goto(third.readyUrl, {
    waitUntil: 'load',
  })
  assert.notEqual(postRecoveryNavigation, null)
  assert.ok(postRecoveryNavigation.ok(), 'post-recovery navigation failed')
  assert.equal(new URL(postRecoveryJourney.page.url()).searchParams.has('token'), false)
  await dismissHarnessOnboarding(postRecoveryJourney.page)
  const postRecoveryNetwork = secondNetwork
  const postRecoveryLogin = postRecoveryJourney.page.locator('#workbench-login-password')
  await postRecoveryLogin.waitFor({ state: 'visible' })
  assert.equal(await postRecoveryJourney.page.locator('#workbench-owner-password').count(), 0)

  await expectCarrierDenied(postRecoveryJourney.page, postRecoveryNetwork, true)
  const staleLogout = await postRecoveryJourney.page.evaluate(async () => {
    const response = await fetch('/api/workbench-auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const payload = await response.json()
    return { state: payload?.ok === true ? payload.value?.state : undefined, status: response.status }
  })
  assert.equal(staleLogout.status, 200)
  assert.equal(staleLogout.state, 'signed-out')
  await waitForCondition(async () => {
    const result = await postRecoveryNetwork.cdp.send('Network.getAllCookies')
    return !result.cookies.some(cookie => cookie.name === OWNER_SESSION_COOKIE_NAME)
  }, PAGE_TIMEOUT_MS, 'stale Owner cookie clearing')

  await postRecoveryLogin.fill(initialPassword)
  await postRecoveryJourney.page.locator('form button[type="submit"]').click()
  await postRecoveryJourney.page.locator('#workbench-auth-issue').waitFor({ state: 'visible' })
  await postRecoveryLogin.fill(firstRecoveredPassword)
  await postRecoveryJourney.page.locator('form button[type="submit"]').click()
  await postRecoveryJourney.page.locator('#workbench-auth-issue').waitFor({ state: 'visible' })
  await postRecoveryLogin.fill(finalRecoveredPassword)
  await postRecoveryJourney.page.locator('form button[type="submit"]').click()
  await postRecoveryJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const finalProjection = postRecoveryJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await finalProjection.waitFor({ state: 'visible' })
  assert.equal(await finalProjection.textContent(), message)
  assert.equal(await postRecoveryJourney.page.locator('#workbench-status-editor').inputValue(), message)
  await reviewCenterPanel(postRecoveryJourney.page)
    .getByRole('heading', { name: 'Review Center', exact: true })
    .waitFor({ state: 'visible' })
  await assertFeishuConnectionCenter(postRecoveryJourney.page, {
    botAppId: feishuAppId,
    credentialRef: feishuCredentialRef,
    credentialValue: feishuCredentialValue,
  })
  assert.equal(
    countRequestsToPath(postRecoveryJourney, WORKBENCH_REVIEW_CENTER_PATH),
    0,
    'post-recovery Client queried Review before selecting a Project',
  )
  assertProjectMilestoneRemotesSilent(
    postRecoveryJourney,
    emptyProjectMilestoneRemoteCounts(),
    'credential-recovered Client before Project reopen',
  )
  await reopenProject(postRecoveryJourney.page, {
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
  })
  await assertProjectTeam(postRecoveryJourney.page, expectedTeam)
  await assertRecoveredReview(postRecoveryJourney.page)
  await assertAcceptedDeliverableBrowserProjection(postRecoveryJourney.page, {
    name: deliverableName,
    longToken: deliverableLongToken,
  })
  await assertActivityProjection(
    postRecoveryJourney.page,
    24,
    message,
    projectName,
    primaryGoalName,
    outcomeName,
    metricName,
    feishuCredentialRef,
    feishuAppId,
    feishuCredentialValue,
    ...teamPrivateValues,
    ...reviewPrivateValues,
  )
  await assertNoBrowserErrors(postRecoveryJourney, [expectedHttpError])
  await restartedDeliverableRoutes.dispose()
  await postRecoveryJourney.context.close()
  await stopDsh(third.host)

  process.stdout.write(
    'PASS T11 cumulative real Workbench setup -> Project Team -> low/high SuggestedChange review '
      + '-> defer/stale/reject/edit-and-accept -> five status and two risk filters '
      + '-> explicit Feishu Bot configure/verify without actor fallback '
      + '-> Project Tasks selection boundary and verified-route gate '
      + '-> T09 workflow Remote authorization/selection gate and Activity vocabulary '
      + '-> Project Milestones selection/route/mobile boundary and seven protected Remotes '
      + '-> Deliverable mock-Remote create/request/approve/remount, declared versions, Owner/Acceptor truth '
      + '-> redacted Activity/Outbox -> Client HMR -> logout/separate context '
      + '-> Host restart persistence -> mobile keyboard/layout -> offline recovery '
      + '-> session revocation\n',
  )
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cleanup().finally(() => { process.exit(exitCode) })
  })
}

try {
  await main()
} finally {
  await cleanup()
}
