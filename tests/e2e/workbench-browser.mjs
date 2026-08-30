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

async function expectCarrierDenied(page, evidence, expectedOwnerCookie) {
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
  }, { marker, path: WORKBENCH_SNAPSHOT_PATH })
  assert.equal(result.status, 401, 'protected Workbench carrier did not deny the request')
  assert.equal(result.body, 'unauthorized')
  await waitForCondition(
    () => requestEvidenceByMarker(evidence, marker) !== undefined,
    PAGE_TIMEOUT_MS,
    'protected carrier request evidence',
  )
  const request = requestEvidenceByMarker(evidence, marker)
  assert.equal(new URL(request.url).pathname, WORKBENCH_SNAPSHOT_PATH)
  const sentOwnerCookie = headerValue(request.headers, 'cookie')
    ?.includes(`${OWNER_SESSION_COOKIE_NAME}=`) === true
  assert.equal(sentOwnerCookie, expectedOwnerCookie)
}

function countRequestsToPath(journey, path) {
  return journey.requests.filter(value => new URL(value).pathname === path).length
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
  for (let attempt = 0; attempt < 64; attempt += 1) {
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
  const initialStyleCount = await page.locator(
    `style[data-plugin="${CLIENT_PACKAGE_ID}"]`,
  ).count()
  assert.equal(initialStyleCount, 2, 'Workbench Client did not own exactly two CSS Module resources')

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
    count: styles.length,
    marked: styles.filter(style => style.textContent?.includes(marker) === true).length,
  }), cssMarker)
  assert.deepEqual(styleEvidence, { count: initialStyleCount, marked: 1 })
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

  const initialPassword = `T02 Owner initial ${new Date().toISOString()}!`
  const wrongPassword = 'T02 deliberately wrong password!'
  const firstRecoveredPassword = `T02 Owner recovered once ${new Date().toISOString()}!`
  const finalRecoveredPassword = `T02 Owner recovered twice ${new Date().toISOString()}!`
  const message = `T02 authenticated browser restart proof ${new Date().toISOString()}`
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
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)
  await assertVisibleKeyboardFocus(setupPassword, 'desktop setup password')
  await captureVisual(firstJourney.page, '01-setup-desktop')
  await useViewport(firstJourney.page, MOBILE_VIEWPORT, async () => {
    await setupPassword.waitFor({ state: 'visible' })
    await captureVisual(firstJourney.page, '02-setup-mobile-375')
    await assertWithinViewport(setupPassword, firstJourney.page, 'mobile setup password')
    await assertVisibleKeyboardFocus(setupPassword, 'mobile setup password')
  })

  await expectCarrierDenied(firstJourney.page, firstNetwork, false)
  assert.equal(countRequestsToPath(firstJourney, WORKBENCH_SNAPSHOT_PATH), 1)
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)

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
  assert.equal(await recoveryLocator.count(), 0)
  await firstJourney.page.reload({ waitUntil: 'load' })
  await dismissHarnessOnboarding(firstJourney.page)
  await firstJourney.page.locator('main[data-workbench-phase="empty"]').waitFor({ state: 'visible' })
  assert.equal(await recoveryLocator.count(), 0, 'refresh redisplayed the one-time recovery code')
  await assertSecretsAbsentFromBrowserStorage(
    firstJourney.page,
    [initialPassword, recoveryCode],
  )

  const firstEditor = firstJourney.page.locator('#workbench-status-editor')
  await firstEditor.click()
  await firstEditor.pressSequentially(message)
  assert.equal(await firstEditor.inputValue(), message)
  await firstJourney.page.locator('form button[type="submit"]').click()
  await firstJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const firstProjection = firstJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await firstProjection.waitFor({ state: 'visible' })
  assert.equal(await firstProjection.textContent(), message)
  assert.equal(await firstEditor.inputValue(), message)
  await exerciseClientHmr(
    firstJourney,
    join(repositoryRoot, 'packages/workbench-client/lib/client.js'),
    message,
  )
  const sessionBar = firstJourney.page.locator('header').filter({
    has: firstJourney.page.getByRole('button', { name: '退出登录' }),
  })
  await sessionBar.waitFor({ state: 'visible' })
  await captureVisual(firstJourney.page, '06-authenticated-desktop')
  await useViewport(firstJourney.page, MOBILE_VIEWPORT, async () => {
    await sessionBar.waitFor({ state: 'visible' })
    await firstJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
    await assertWithinViewport(sessionBar, firstJourney.page, 'mobile Owner session bar')
    await assertWithinViewport(firstJourney.page.locator('#workbench-status-editor'), firstJourney.page, 'mobile status editor')
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
  })
  await firstJourney.page.setViewportSize(DESKTOP_VIEWPORT)
  await assertNoBrowserErrors(firstJourney, [expectedHttpError])

  await firstJourney.page.getByRole('button', { name: '退出登录' }).click()
  await firstJourney.page.locator('#workbench-login-password').waitFor({ state: 'visible' })
  assert.equal(await firstJourney.page.locator('#workbench-status-editor').count(), 0)
  await expectCarrierDenied(firstJourney.page, firstNetwork, false)
  const postLogoutCookies = await firstNetwork.cdp.send('Network.getAllCookies')
  assert.equal(
    postLogoutCookies.cookies.filter(cookie => cookie.name === OWNER_SESSION_COOKIE_NAME).length,
    0,
    'logout did not clear the browser Owner cookie',
  )
  await firstJourney.context.close()

  // A genuinely separate browser context sees login, never setup. A rejected
  // password cannot create the protected controller; the correct password can.
  const separateJourney = await openCheckedPage(first.readyUrl, 'separate browser context')
  await dismissHarnessOnboarding(separateJourney.page)
  const separateLogin = separateJourney.page.locator('#workbench-login-password')
  await separateLogin.waitFor({ state: 'visible' })
  assert.equal(await separateJourney.page.locator('#workbench-owner-password').count(), 0)
  assert.equal(countRequestsToPath(separateJourney, WORKBENCH_SNAPSHOT_PATH), 0)
  await separateLogin.fill(wrongPassword)
  await separateJourney.page.locator('form button[type="submit"]').click()
  await separateJourney.page.locator('#workbench-auth-issue').waitFor({ state: 'visible' })
  assert.equal(await separateJourney.page.locator('#workbench-status-editor').count(), 0)
  await separateLogin.fill(initialPassword)
  await separateJourney.page.locator('form button[type="submit"]').click()
  await separateJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  const separateProjection = separateJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await separateProjection.waitFor({ state: 'visible' })
  assert.equal(await separateProjection.textContent(), message)
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
  await assertNoBrowserErrors(postRecoveryJourney, [expectedHttpError])
  await postRecoveryJourney.context.close()
  await stopDsh(third.host)

  process.stdout.write(
    'PASS real Workbench setup -> protected carrier -> secure cookie -> Client HMR '
      + '-> logout -> restart -> one-time offline recovery -> session revocation\n',
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
