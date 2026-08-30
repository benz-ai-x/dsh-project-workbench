#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

let browser
let tempRoot
let pendingBundleRestore
let cleanupStarted = false
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
  return value.replace(/([?&]token=)[^&\s)]+/gu, '$1<redacted>')
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk) })
  child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk) })

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
  if (outcome.code !== 0) {
    throw commandFailure(label, outcome.code, outcome.signal, stdout, stderr)
  }
  return { stdout, stderr }
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
  })
  await context.route('**/*', async route => {
    const url = route.request().url()
    if (isLoopbackBrowserUrl(url)) {
      await route.continue()
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

async function assertNoBrowserErrors(journey) {
  await journey.page.waitForTimeout(250)
  assert.deepEqual(journey.errors, [], journey.errors.join('\n'))
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

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
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

  // First exercise the safest possible stat change. The Host hashes bytes, so
  // an equal rewrite intentionally produces no rebuilt frame on current DSH.
  writeFileSync(bundlePath, original)
  let replaced = false
  try {
    await page.waitForFunction(surface => !surface.isConnected, oldSurface, { timeout: 1_500 })
    replaced = true
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error
  }
  if (!replaced) {
    // One trailing newline changes the bundle hash without changing its lazy-CJS semantics.
    writeFileSync(bundlePath, Buffer.concat([original, Buffer.from('\n')]))
  }

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
    join(repositoryRoot, 'packages/workbench-client/lib/client.js'),
  ]) {
    assert.ok(existsSync(required), `required built artifact is missing: ${required}`)
  }

  tempRoot = mkdtempSync(join(tmpdir(), tempPrefixName))
  assertSafeTempRoot(tempRoot)
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

  const message = `T01 browser restart proof ${new Date().toISOString()}`
  const first = await startDsh(projectDir, runtimeEnv)
  const firstJourney = await openCheckedPage(first.readyUrl, 'initial boot')
  await firstJourney.page.locator('main[data-workbench-phase="empty"]').waitFor({ state: 'visible' })
  await dismissHarnessOnboarding(firstJourney.page)
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
  await assertNoBrowserErrors(firstJourney)
  await firstJourney.context.close()
  await stopDsh(first.host)
  restoreClientBundle()

  const databasePath = join(projectDir, '.dsh/project-workbench.sqlite')
  assert.ok(existsSync(databasePath), `Workbench database was not committed at ${databasePath}`)

  const second = await startDsh(projectDir, runtimeEnv)
  const secondJourney = await openCheckedPage(second.readyUrl, 'restart boot')
  await secondJourney.page.locator('main[data-workbench-phase="value"]').waitFor({ state: 'visible' })
  await dismissHarnessOnboarding(secondJourney.page)
  const recoveredProjection = secondJourney.page
    .locator('main[data-workbench-phase="value"] p')
    .filter({ hasText: message })
  await recoveredProjection.waitFor({ state: 'visible' })
  assert.equal(await recoveredProjection.textContent(), message)
  assert.equal(await secondJourney.page.locator('#workbench-status-editor').inputValue(), message)
  await assertNoBrowserErrors(secondJourney)
  await secondJourney.context.close()
  await stopDsh(second.host)

  process.stdout.write('PASS real Workbench browser command -> projection -> Client HMR -> full restart recovery\n')
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
