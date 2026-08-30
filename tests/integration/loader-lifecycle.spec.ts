import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type {
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from '../../packages/workbench-host/src/client.ts'
import type { WorkbenchService } from '../../packages/workbench-host/src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const hostEntry = resolve(repositoryRoot, 'packages/workbench-host/lib/index.js')
const ownerAuthEntry = resolve(
  repositoryRoot,
  'packages/workbench-host/lib/owner-auth-service.js',
)
const authFixtureEntry = resolve(
  repositoryRoot,
  'tests/integration/fixtures/workbench-auth-fixture.mjs',
)
const authDependenciesFixtureEntry = resolve(
  repositoryRoot,
  'tests/integration/fixtures/owner-auth-dependencies-fixture.mjs',
)
const temporaryRoots: string[] = []
const contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async context => {
    await context.fiber.dispose().catch(() => undefined)
  }))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolveClose => {
    server.close(() => { resolveClose() })
  })))
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })))
})

interface WorkbenchContext extends Context {
  readonly workbench: WorkbenchService
  readonly workbenchAuth: {
    readonly routeLifecycle: 'accepting' | 'closing' | 'closed'
    run<T>(operation: () => T): T
  }
  readonly ownerAuthDependencies: {
    readonly routes: Map<string, {
      readonly kind: 'exact' | 'prefix'
      readonly path: string
      readonly handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>
    }>
    route(pathname: string): {
      readonly handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>
    } | undefined
  }
}

async function fixture(): Promise<{
  readonly root: string
  readonly databasePath: string
  readonly configPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-loader-'))
  temporaryRoots.push(root)
  return {
    root,
    databasePath: join(root, 'state', 'workbench.sqlite'),
    configPath: join(root, 'cordis.yml'),
  }
}

function config(entry: string, databasePath: string, maxStatusLength = 280): string {
  return [
    '- id: workbench-auth-fixture',
    `  name: ${JSON.stringify(authFixtureEntry)}`,
    '- id: workbench-host',
    `  name: ${JSON.stringify(entry)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 500',
    `    maxStatusLength: ${String(maxStatusLength)}`,
    '',
  ].join('\n')
}

function invalidOwnerAuthConfig(entry: string): string {
  return [
    '- id: owner-auth-dependencies-fixture',
    `  name: ${JSON.stringify(authDependenciesFixtureEntry)}`,
    '- id: workbench-auth',
    `  name: ${JSON.stringify(entry)}`,
    '  config:',
    '    maxSessions: 0',
    '',
  ].join('\n')
}

function realOwnerAuthConfig(databasePath: string): string {
  return [
    '- id: owner-auth-dependencies-fixture',
    `  name: ${JSON.stringify(authDependenciesFixtureEntry)}`,
    '- id: workbench-auth',
    `  name: ${JSON.stringify(ownerAuthEntry)}`,
    '- id: workbench-host',
    `  name: ${JSON.stringify(hostEntry)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 500',
    '    maxStatusLength: 280',
    '',
  ].join('\n')
}

async function openFixtureCarrier(context: WorkbenchContext): Promise<string> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
    const route = context.ownerAuthDependencies.route(pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void Promise.resolve(route.handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

async function load(configPath: string): Promise<WorkbenchContext> {
  const context = await boot('workbench-test', configPath) as WorkbenchContext
  contexts.push(context)
  return context
}

describe('built Workbench Host through the real DSH Loader', () => {
  it('rejects invalid Owner auth Config before publishing its injected Service', async () => {
    expect(existsSync(ownerAuthEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, invalidOwnerAuthConfig(ownerAuthEntry))

    await expect(boot('workbench-test', test.configPath)).rejects.toThrow(
      /failed to apply loader entry workbench-auth|maxSessions/u,
    )
  })

  it('rejects invalid runtime Config before publishing the service or opening SQLite', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath, 0))

    await expect(boot('workbench-test', test.configPath)).rejects.toThrow(
      /failed to apply loader entry workbench-host|maxStatusLength/u,
    )
    expect(existsSync(test.databasePath)).toBe(false)
  })

  it('commits through the public command, disposes cleanly, and recovers after restart', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const first = await load(test.configPath)
    const firstService = first.workbench
    await expect(firstService.snapshot(new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(first.workbenchAuth.run(() =>
      firstService.snapshot(new AbortController().signal))).resolves.toBeNull()
    const committed: SetStatusResult = await first.workbenchAuth.run(() => firstService.setStatus({
      message: 'Loader-owned durable status',
      expectedRevision: null,
    }, new AbortController().signal))
    expect(committed).toMatchObject({
      ok: true,
      value: {
        message: 'Loader-owned durable status',
        revision: 1,
      },
    })
    if (!committed.ok) throw new Error('expected the initial status commit to succeed')
    const expected: WorkbenchStatusSnapshot = committed.value

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    expect(first.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')

    const restarted = await load(test.configPath)
    await expect(restarted.workbenchAuth.run(() =>
      restarted.workbench.snapshot(new AbortController().signal))).resolves.toEqual(expected)
    await restarted.fiber.dispose()
    contexts.splice(contexts.indexOf(restarted), 1)
    expect(restarted.get('workbench')).toBeUndefined()
  })

  it('withdraws and remounts the built Host cleanly through one live Loader entry', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const context = await load(test.configPath)
    const entry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-host')
    if (entry === undefined) throw new Error('real Loader did not publish workbench-host entry')
    const firstService = context.workbench
    const committed = await context.workbenchAuth.run(() => firstService.setStatus({
      message: 'same-process HMR status',
      expectedRevision: null,
    }, new AbortController().signal))
    if (!committed.ok) throw new Error('expected the HMR fixture commit to succeed')

    await entry.update({ disabled: true })
    await context.loader.await()
    expect(entry.fiber).toBeUndefined()
    expect(context.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')
    expect((firstService.scenario.options.repository as { closed?: boolean }).closed).toBe(true)

    await entry.update({ disabled: false })
    await context.loader.await()
    expect(entry.fiber).toBeDefined()
    expect(context.get('workbench')).toBeDefined()
    expect(context.workbench).not.toBe(firstService)
    await expect(context.workbenchAuth.run(() =>
      context.workbench.snapshot(new AbortController().signal))).resolves.toEqual(committed.value)

    const replacement = context.workbench
    await entry.update({ disabled: true })
    await context.loader.await()
    expect(context.get('workbench')).toBeUndefined()
    expect(replacement.scenario.lifecycle).toBe('closed')
    expect((replacement.scenario.options.repository as { closed?: boolean }).closed).toBe(true)
  })

  it('withdraws and remounts the real Owner auth provider, both routes, and its Host consumer', async () => {
    expect(existsSync(ownerAuthEntry)).toBe(true)
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, realOwnerAuthConfig(test.databasePath))

    const context = await load(test.configPath)
    const origin = await openFixtureCarrier(context)
    const authEntry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-auth')
    const hostLoaderEntry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-host')
    if (authEntry === undefined || hostLoaderEntry === undefined) {
      throw new Error('real Loader did not publish both Workbench entries')
    }
    const firstAuth = context.workbenchAuth
    const firstHost = context.workbench
    expect(context.ownerAuthDependencies.routes.size).toBe(2)
    expect(context.ownerAuthDependencies.routes.has('prefix:/api/workbench-auth')).toBe(true)
    expect(context.ownerAuthDependencies.routes.has('prefix:/api/workbench')).toBe(true)

    const initialized = await fetch(`${origin}/api/workbench-auth/initialize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'Loader-HMR-owner-passphrase-2026!' }),
    })
    expect(initialized.status).toBe(201)
    const setCookie = initialized.headers.get('set-cookie')
    if (setCookie === null) throw new Error('Owner initialization omitted its session cookie')
    const cookie = setCookie.split(';', 1)[0]
    expect(cookie).toMatch(/^__Host-dsh-workbench-session=/u)

    await authEntry.update({ disabled: true })
    await context.loader.await()
    expect(authEntry.fiber).toBeUndefined()
    expect(context.get('workbenchAuth')).toBeUndefined()
    expect(context.get('workbench')).toBeUndefined()
    expect(firstAuth.routeLifecycle).toBe('closed')
    expect(firstHost.scenario.lifecycle).toBe('closed')
    expect(context.ownerAuthDependencies.routes.size).toBe(0)
    await expect(fetch(`${origin}/api/workbench-auth/state`)).resolves.toMatchObject({ status: 404 })
    await expect(fetch(`${origin}/api/workbench/probe`)).resolves.toMatchObject({ status: 404 })

    await authEntry.update({ disabled: false })
    await context.loader.await()
    expect(authEntry.fiber).toBeDefined()
    expect(hostLoaderEntry.fiber).toBeDefined()
    expect(context.workbenchAuth).not.toBe(firstAuth)
    expect(context.workbench).not.toBe(firstHost)
    expect(context.ownerAuthDependencies.routes.size).toBe(2)

    const restored = await fetch(`${origin}/api/workbench-auth/state`, {
      headers: { cookie },
    })
    expect(restored.status).toBe(200)
    await expect(restored.json()).resolves.toMatchObject({
      ok: true,
      value: { state: 'signed-in' },
    })
    const forwarded = await fetch(`${origin}/api/workbench/probe`, {
      headers: { cookie },
    })
    expect(forwarded.status).toBe(418)
    await expect(forwarded.text()).resolves.toBe('shared Workbench API')
  })
})
