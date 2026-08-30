import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import {
  Config,
  DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES,
  OWNER_AUTH_INITIALIZE_PATH,
  OWNER_AUTH_LOGIN_PATH,
  OWNER_AUTH_LOGOUT_PATH,
  OWNER_AUTH_STATE_PATH,
  OWNER_SESSION_COOKIE_NAME,
  OwnerAuthService,
  ownerSessionClearCookie,
  type Config as OwnerAuthConfig,
  type OwnerAuthServiceInternals,
} from '../src/owner-auth-service.ts'
import type { OwnerPrincipal } from '../src/authorization.ts'
import type { OwnerCredentialStore } from '../src/owner-credential-store.ts'
import {
  DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_SESSIONS,
  DEFAULT_OWNER_SESSION_LIFETIME_MINUTES,
} from '../src/owner-access.ts'

interface MountedAuth {
  readonly service: OwnerAuthService
  readonly baseUrl: string
  readonly routes: Map<string, WebRoute>
  readonly sharedFetch: ReturnType<typeof vi.fn>
  readonly dispose: () => Promise<void>
}

const mounted: MountedAuth[] = []

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(value => value.dispose()))
})

describe('OwnerAuthService HTTP perimeter', () => {
  it('exports an explicit injection contract and a same-named validated Config schema', () => {
    expect(OwnerAuthService.inject).toEqual(['credentials', 'webServer', 'connection'])
    expect(OwnerAuthService.Config).toBe(Config)
    expect(Config({})).toEqual({
      sessionLifetimeMinutes: DEFAULT_OWNER_SESSION_LIFETIME_MINUTES,
      maxSessions: DEFAULT_OWNER_MAX_SESSIONS,
      maxConcurrentPasswordJobs: DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS,
      maxQueuedPasswordJobs: DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS,
      maxRequestBodyBytes: DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES,
    })
    expect(() => Config({ sessionLifetimeMinutes: 0 })).toThrow()
    expect(() => Config({ maxSessions: 65 })).toThrow()
    expect(() => Config({ maxConcurrentPasswordJobs: 1.5 })).toThrow()
    expect(() => Config({ maxQueuedPasswordJobs: -1 })).toThrow()
    expect(() => Config({ maxRequestBodyBytes: 0 })).toThrow()
  })

  it('sets the exact host-only cookie, enters ALS only after both gates, and revokes on logout', async () => {
    const world = await mountAuth()
    const outerHeaders = { 'x-dsh-browser': 'authenticated' }

    const setupState = await fetch(`${world.baseUrl}${OWNER_AUTH_STATE_PATH}`, {
      headers: outerHeaders,
    })
    expect(setupState.status).toBe(200)
    expect(setupState.headers.get('cache-control')).toBe('no-store')
    await expect(setupState.json()).resolves.toEqual({
      ok: true,
      value: { state: 'setup-required' },
    })

    const initialized = await postJson(
      `${world.baseUrl}${OWNER_AUTH_INITIALIZE_PATH}`,
      { password: 'a sufficiently long owner passphrase' },
      outerHeaders,
    )
    expect(initialized.status).toBe(201)
    const setCookie = initialized.headers.get('set-cookie') as string
    expect(setCookie).toMatch(new RegExp(
      `^${OWNER_SESSION_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}=v1\\.[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Strict$`,
      'u',
    ))
    expect(setCookie).not.toMatch(/Domain=/iu)
    const cookie = setCookie.split(';', 1)[0] as string
    const initializeBody = await initialized.json() as {
      ok: true
      value: { recoveryCode: string }
    }
    expect(initializeBody.ok).toBe(true)
    expect(initializeBody.value.recoveryCode).toMatch(/^WB1-/u)

    const unauthenticated = await fetch(`${world.baseUrl}/api/workbench/snapshot`, {
      method: 'POST',
      headers: outerHeaders,
      body: '{}',
    })
    expect(unauthenticated.status).toBe(401)
    expect(world.sharedFetch).not.toHaveBeenCalled()

    const authorized = await fetch(`${world.baseUrl}/api/workbench/snapshot`, {
      method: 'POST',
      headers: { ...outerHeaders, cookie },
      body: '{}',
    })
    expect(authorized.status).toBe(200)
    const carrier = await authorized.json() as { principal: OwnerPrincipal | null }
    expect(carrier.principal).toMatchObject({ kind: 'owner', sessionId: expect.any(String) })
    const forwarded = world.sharedFetch.mock.calls[0]?.[0] as Request
    expect(forwarded.headers.get('cookie')).toBeNull()
    expect(world.service.authorization.current()).toBeUndefined()

    const logout = await postJson(
      `${world.baseUrl}${OWNER_AUTH_LOGOUT_PATH}`,
      {},
      { ...outerHeaders, cookie },
    )
    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toBe(ownerSessionClearCookie())
    await expect(logout.json()).resolves.toEqual({
      ok: true,
      value: { state: 'signed-out' },
    })
    const revoked = await fetch(`${world.baseUrl}/api/workbench/snapshot`, {
      method: 'POST',
      headers: { ...outerHeaders, cookie },
      body: '{}',
    })
    expect(revoked.status).toBe(401)
    expect(world.sharedFetch).toHaveBeenCalledOnce()
  })

  it('revalidates a slow request at scenario admission after its session is revoked', async () => {
    const world = await mountAuth()
    const outerHeaders = { 'x-dsh-browser': 'authenticated' }
    const initialized = await postJson(
      `${world.baseUrl}${OWNER_AUTH_INITIALIZE_PATH}`,
      { password: 'a sufficiently long owner passphrase' },
      outerHeaders,
    )
    const cookie = (initialized.headers.get('set-cookie') as string).split(';', 1)[0] as string
    const authenticate = vi.spyOn(world.service.access, 'authenticate')
    const slow = chunkedPost(`${world.baseUrl}/api/workbench/setStatus`, {
      ...outerHeaders,
      cookie,
      'content-type': 'application/json',
    })
    slow.request.write('{')

    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce())
    await authenticate.mock.results[0]?.value
    const logout = await postJson(
      `${world.baseUrl}${OWNER_AUTH_LOGOUT_PATH}`,
      {},
      { ...outerHeaders, cookie },
    )
    expect(logout.status).toBe(200)

    slow.request.end('}')
    await expect(slow.response).resolves.toEqual({
      status: 401,
      body: JSON.stringify({ code: 'unauthorized' }),
    })
    expect(world.sharedFetch).toHaveBeenCalledOnce()
  })

  it('preserves Connection trust rejection and strictly validates bounded auth JSON', async () => {
    const world = await mountAuth()
    const rejected = await fetch(`${world.baseUrl}${OWNER_AUTH_STATE_PATH}`)
    expect(rejected.status).toBe(401)
    expect(await rejected.text()).toBe('unauthorized')
    expect(rejected.headers.get('cache-control')).toBe('no-store')

    const forbidden = await fetch(`${world.baseUrl}${OWNER_AUTH_STATE_PATH}`, {
      headers: { 'x-dsh-browser': 'authenticated', 'x-dsh-trust': 'reject' },
    })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.text()).toBe('forbidden')

    const extraField = await postJson(
      `${world.baseUrl}${OWNER_AUTH_INITIALIZE_PATH}`,
      { password: 'a sufficiently long owner passphrase', username: 'owner' },
      { 'x-dsh-browser': 'authenticated' },
    )
    expect(extraField.status).toBe(400)
    await expect(extraField.json()).resolves.toEqual({
      ok: false,
      error: { code: 'bad-request' },
    })

    const wrongMethod = await fetch(`${world.baseUrl}${OWNER_AUTH_LOGIN_PATH}`, {
      headers: { 'x-dsh-browser': 'authenticated' },
    })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')
  })

  it('throttles repeated failures without a timer and removes both routes on disposal', async () => {
    const world = await mountAuth()
    const headers = { 'x-dsh-browser': 'authenticated' }
    await postJson(
      `${world.baseUrl}${OWNER_AUTH_INITIALIZE_PATH}`,
      { password: 'the original owner password' },
      headers,
    )

    const statuses: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postJson(
        `${world.baseUrl}${OWNER_AUTH_LOGIN_PATH}`,
        { password: 'this password is incorrect' },
        headers,
      )
      statuses.push(response.status)
      if (attempt === 4) expect(response.headers.get('retry-after')).toBe('30')
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429])

    await world.dispose()
    expect(world.routes.size).toBe(0)
    expect(world.service.routeLifecycle).toBe('closed')
    expect(world.service.access.lifecycle).toBe('closed')
  })

  it('publishes no routes when disposed during credential open and can mount again', async () => {
    const ctx = new Context()
    const routes = new Map<string, WebRoute>()
    ctx.provide('credentials', memoryCredentials() as never)
    ctx.provide('webServer', {
      register(route: WebRoute) {
        if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
        routes.set(route.path, route)
        return () => {
          if (routes.get(route.path) === route) routes.delete(route.path)
        }
      },
    } as never)
    ctx.provide('connection', {
      requestRejection: () => undefined,
      createSharedFetchHandler: () => ({
        fetch: async () => new Response(null, { status: 204 }),
      }),
    } as never)

    const read = Promise.withResolvers<null>()
    const deferredRead = vi.fn(() => read.promise)
    let store: OwnerCredentialStore = {
      read: deferredRead,
      modify: async () => null,
    }
    const instances: OwnerAuthService[] = []
    class DeferredOwnerAuthService extends OwnerAuthService {
      constructor(pluginCtx: Context, config: OwnerAuthConfig) {
        super(pluginCtx, config, { store })
        instances.push(this)
      }
    }

    const first = ctx.plugin(DeferredOwnerAuthService, {})
    await vi.waitFor(() => expect(deferredRead).toHaveBeenCalledOnce())
    const firstService = instances[0] as OwnerAuthService
    expect(firstService.access.lifecycle).toBe('opening')

    let disposeSettled = false
    const disposing = first.dispose().then(() => { disposeSettled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(disposeSettled).toBe(false)
    expect(routes.size).toBe(0)

    read.resolve(null)
    await disposing
    expect(firstService.access.lifecycle).toBe('closed')
    expect(firstService.routeLifecycle).toBe('closed')
    expect(routes.size).toBe(0)

    store = {
      read: async () => null,
      modify: async () => null,
    }
    const second = ctx.plugin(DeferredOwnerAuthService, {})
    await second.await()
    const secondService = instances[1] as OwnerAuthService
    expect(secondService.access.lifecycle).toBe('running')
    expect(routes.has('/api/workbench-auth')).toBe(true)
    expect(routes.has('/api/workbench')).toBe(true)

    await second.dispose()
    expect(secondService.access.lifecycle).toBe('closed')
    expect(secondService.routeLifecycle).toBe('closed')
    expect(routes.size).toBe(0)
  })
})

async function mountAuth(): Promise<MountedAuth> {
  const ctx = new Context()
  const routes = new Map<string, WebRoute>()
  const credentials = memoryCredentials()
  ctx.provide('credentials', credentials as never)
  ctx.provide('webServer', {
    register(route: WebRoute) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as never)
  let service!: OwnerAuthService
  const sharedFetch = vi.fn(async () => {
    try {
      await service.authorization.require('workbench.status.write')
      return Response.json({ principal: service.authorization.current() ?? null })
    } catch (error) {
      if (error instanceof TypertRemoteFailure) {
        return Response.json(
          { code: error.failure.code },
          { status: error.failure.code === 'forbidden' ? 403 : 401 },
        )
      }
      throw error
    }
  })
  ctx.provide('connection', {
    requestRejection(request: { headers: Record<string, string | string[] | undefined> }) {
      if (request.headers['x-dsh-trust'] === 'reject') return 403
      return request.headers['x-dsh-browser'] === 'authenticated' ? undefined : 401
    },
    createSharedFetchHandler: () => ({ fetch: sharedFetch }),
  } as never)

  let randomCounter = 0
  const internals: OwnerAuthServiceInternals = {
    passwordHasher: {
      hash: async password => fakePhc(password),
      verify: async (phc, password) => phc === fakePhc(password),
      needsRehash: () => false,
    },
    clock: { now: () => new Date('2026-08-31T00:00:00.000Z') },
    random: {
      bytes(size) {
        randomCounter += 1
        return Uint8Array.from({ length: size }, (_, index) => (randomCounter + index) % 256)
      },
      id: prefix => `${prefix}-${String(++randomCounter)}`,
    },
    nowMilliseconds: () => Date.parse('2026-08-31T00:00:00.000Z'),
  }
  class FixtureOwnerAuthService extends OwnerAuthService {
    constructor(pluginCtx: Context, config: OwnerAuthConfig) {
      super(pluginCtx, config, internals)
      service = this
    }
  }
  const fiber = ctx.plugin(FixtureOwnerAuthService, { maxRequestBodyBytes: 4_096 })
  await fiber.await()

  const server = createServer((req, res) => {
    const route = longestRoute(routes, req)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void Promise.resolve(route.handler(req, res)).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(error instanceof Error ? error.message : String(error))
    })
  })
  await listen(server)
  const baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  let disposed = false
  const result: MountedAuth = {
    service,
    baseUrl,
    routes,
    sharedFetch,
    async dispose() {
      if (disposed) return
      disposed = true
      await fiber.dispose()
      await close(server)
    },
  }
  mounted.push(result)
  return result
}

function memoryCredentials(): {
  readRecord(): Promise<CredentialRecord | undefined>
  modifyRecord(
    key: unknown,
    mutation: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined>
} {
  let record: CredentialRecord | undefined
  return {
    readRecord: async () => record,
    async modifyRecord(_key, mutation) {
      const next = await mutation(record)
      if (next !== undefined) record = structuredClone(next)
      return record === undefined ? undefined : structuredClone(record)
    },
  }
}

function fakePhc(password: string): string {
  return `$argon2id$v=19$m=65536,p=4,t=3$c2FsdA$${Buffer.from(password).toString('base64').replace(/=+$/u, '')}`
}

function longestRoute(routes: Map<string, WebRoute>, req: IncomingMessage): WebRoute | undefined {
  const pathname = new URL(req.url ?? '/', 'http://fixture').pathname
  let match: WebRoute | undefined
  for (const route of routes.values()) {
    const matched = route.kind === 'exact'
      ? pathname === route.path
      : pathname === route.path || pathname.startsWith(`${route.path}/`)
    if (matched && (match === undefined || route.path.length > match.path.length)) match = route
  }
  return match
}

function postJson(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function chunkedPost(
  url: string,
  headers: Readonly<Record<string, string>>,
): {
  readonly request: ClientRequest
  readonly response: Promise<{ readonly status: number; readonly body: string }>
} {
  const request = httpRequest(url, { method: 'POST', headers })
  const response = new Promise<{ readonly status: number; readonly body: string }>((resolve, reject) => {
    request.once('error', reject)
    request.once('response', (incoming) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.once('error', reject)
      incoming.once('end', () => resolve({
        status: incoming.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
  })
  return { request, response }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}
