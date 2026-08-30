/** Owner authentication Service and the Workbench-owned HTTP perimeter. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionFetchHandler,
} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {
  InitializeOwnerResult,
  LoginOwnerResult,
  OwnerAccessProjection,
  OwnerAuthErrorCode,
  OwnerAuthResponse,
} from './client.ts'
import type { WorkbenchAuthorizationContext } from './authorization.ts'
import {
  bridgeWorkbenchHttp,
  WorkbenchRouteAdmission,
  writePlainResponse,
} from './http-bridge.ts'
import {
  DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_SESSIONS,
  DEFAULT_OWNER_SESSION_LIFETIME_MINUTES,
  OwnerAccess,
  OwnerAuthFailure,
  type OwnerAccessClock,
  type OwnerAccessRandom,
} from './owner-access.ts'
import {
  DshOwnerCredentialStore,
  type OwnerCredentialStore,
} from './owner-credential-store.ts'
import {
  PasswordValidationError,
  type PasswordHasher,
} from './password.ts'

export const OWNER_AUTH_API_PATH = '/api/workbench-auth'
export const OWNER_AUTH_STATE_PATH = `${OWNER_AUTH_API_PATH}/state`
export const OWNER_AUTH_INITIALIZE_PATH = `${OWNER_AUTH_API_PATH}/initialize`
export const OWNER_AUTH_LOGIN_PATH = `${OWNER_AUTH_API_PATH}/login`
export const OWNER_AUTH_LOGOUT_PATH = `${OWNER_AUTH_API_PATH}/logout`
export const WORKBENCH_API_PATH = '/api/workbench'
export const OWNER_SESSION_COOKIE_NAME = '__Host-dsh-workbench-session'

export const DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES = 8 * 1024
export const MAX_OWNER_AUTH_REQUEST_BODY_BYTES = 64 * 1024
export const OWNER_LOGIN_FAILURE_LIMIT = 5
export const OWNER_LOGIN_FAILURE_WINDOW_MS = 60_000
export const OWNER_LOGIN_BLOCK_MS = 30_000
export const OWNER_LOGIN_THROTTLE_MAX_ENTRIES = 1_024

const MAX_SESSION_LIFETIME_MINUTES = 5 * 366 * 24 * 60
const MAX_PASSWORD_JOBS = 16
const MAX_QUEUED_PASSWORD_JOBS = 128
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]{1,256}$/u

/** Public Loader configuration for the auth provider and its two raw routes. */
export interface Config {
  readonly sessionLifetimeMinutes?: number
  readonly maxSessions?: number
  readonly maxConcurrentPasswordJobs?: number
  readonly maxQueuedPasswordJobs?: number
  readonly maxRequestBodyBytes?: number
}

/** Same-named runtime mirror; defaults apply before the Service is published. */
export const Config: Schema<Config> = Schema.object({
  sessionLifetimeMinutes: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_SESSION_LIFETIME_MINUTES)
    .default(DEFAULT_OWNER_SESSION_LIFETIME_MINUTES),
  maxSessions: Schema.number()
    .step(1)
    .min(1)
    .max(64)
    .default(DEFAULT_OWNER_MAX_SESSIONS),
  maxConcurrentPasswordJobs: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_PASSWORD_JOBS)
    .default(DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS),
  maxQueuedPasswordJobs: Schema.number()
    .step(1)
    .min(0)
    .max(MAX_QUEUED_PASSWORD_JOBS)
    .default(DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS),
  maxRequestBodyBytes: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_OWNER_AUTH_REQUEST_BODY_BYTES)
    .default(DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES),
})

interface ResolvedConfig {
  readonly sessionLifetimeMinutes: number
  readonly maxSessions: number
  readonly maxConcurrentPasswordJobs: number
  readonly maxQueuedPasswordJobs: number
  readonly maxRequestBodyBytes: number
}

/** Test-only construction ports; production takes persistence from ctx.credentials. */
export interface OwnerAuthServiceInternals {
  readonly store?: OwnerCredentialStore
  readonly passwordHasher?: PasswordHasher
  readonly clock?: OwnerAccessClock
  readonly random?: OwnerAccessRandom
  readonly nowMilliseconds?: () => number
  readonly loginThrottle?: LoginFailureThrottle
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Owner session authority and Host-only principal carrier. */
    workbenchAuth: OwnerAuthService
  }
}

interface LoginFailureEntry {
  failures: number[]
  blockedUntil: number
  lastSeenAt: number
}

/**
 * Bounded, opportunistically-pruned, no-timer password failure throttle.
 * Remote socket addresses are server-derived; proxy headers never grant a new
 * bucket. The attempt that reaches the limit receives the first 429.
 */
export class LoginFailureThrottle {
  private readonly entries = new Map<string, LoginFailureEntry>()

  constructor(
    private readonly failureLimit = OWNER_LOGIN_FAILURE_LIMIT,
    private readonly failureWindowMs = OWNER_LOGIN_FAILURE_WINDOW_MS,
    private readonly blockMs = OWNER_LOGIN_BLOCK_MS,
    private readonly maxEntries = OWNER_LOGIN_THROTTLE_MAX_ENTRIES,
  ) {
    for (const [field, value] of [
      ['failureLimit', failureLimit],
      ['failureWindowMs', failureWindowMs],
      ['blockMs', blockMs],
      ['maxEntries', maxEntries],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`${field} must be a positive safe integer`)
      }
    }
  }

  get size(): number {
    return this.entries.size
  }

  retryAfterSeconds(key: string, now: number): number | undefined {
    this.prune(now)
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    entry.lastSeenAt = now
    if (entry.blockedUntil <= now) return undefined
    return millisecondsToRetrySeconds(entry.blockedUntil - now)
  }

  recordFailure(key: string, now: number): number | undefined {
    this.prune(now)
    const existing = this.entries.get(key)
    if (existing?.blockedUntil !== undefined && existing.blockedUntil > now) {
      existing.lastSeenAt = now
      return millisecondsToRetrySeconds(existing.blockedUntil - now)
    }
    const entry = existing ?? this.newEntry(key, now)
    entry.failures = entry.failures.filter(at => at > now - this.failureWindowMs)
    entry.failures.push(now)
    entry.lastSeenAt = now
    if (entry.failures.length < this.failureLimit) return undefined
    entry.blockedUntil = now + this.blockMs
    return millisecondsToRetrySeconds(this.blockMs)
  }

  recordSuccess(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  private newEntry(key: string, now: number): LoginFailureEntry {
    if (this.entries.size >= this.maxEntries) {
      let oldestKey: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [candidate, entry] of this.entries) {
        if (entry.lastSeenAt >= oldestAt) continue
        oldestKey = candidate
        oldestAt = entry.lastSeenAt
      }
      if (oldestKey !== undefined) this.entries.delete(oldestKey)
    }
    const entry: LoginFailureEntry = { failures: [], blockedUntil: 0, lastSeenAt: now }
    this.entries.set(key, entry)
    return entry
  }

  private prune(now: number): void {
    assertNow(now)
    const staleBefore = now - this.failureWindowMs
    for (const [key, entry] of this.entries) {
      entry.failures = entry.failures.filter(at => at > staleBefore)
      if (entry.blockedUntil <= now && entry.failures.length === 0) this.entries.delete(key)
    }
  }
}

/**
 * Deep auth Service: it owns the credential adapter, expensive auth module,
 * raw HTTP routes, request cancellation, and disposal drain as one lifecycle.
 */
export class OwnerAuthService extends Service {
  static inject = ['credentials', 'webServer', 'connection']
  static Config = Config

  readonly access: OwnerAccess
  readonly authorization: WorkbenchAuthorizationContext
  private readonly resolved: ResolvedConfig
  private readonly routes: WorkbenchRouteAdmission
  private readonly throttle: LoginFailureThrottle
  private readonly nowMilliseconds: () => number
  private readonly routeDisposers: Array<() => void> = []
  private sharedApi: ConnectionFetchHandler | undefined
  private closing: Promise<void> | undefined

  constructor(ctx: Context, config: Config = {}, internals: OwnerAuthServiceInternals = {}) {
    super(ctx, 'workbenchAuth')
    this.resolved = resolveConfig(config)
    this.access = new OwnerAccess({
      store: internals.store ?? new DshOwnerCredentialStore(ctx.credentials as CredentialProvider),
      ...(internals.passwordHasher === undefined ? {} : { passwordHasher: internals.passwordHasher }),
      ...(internals.clock === undefined ? {} : { clock: internals.clock }),
      ...(internals.random === undefined ? {} : { random: internals.random }),
      sessionLifetimeMinutes: this.resolved.sessionLifetimeMinutes,
      maxSessions: this.resolved.maxSessions,
      maxConcurrentPasswordJobs: this.resolved.maxConcurrentPasswordJobs,
      maxQueuedPasswordJobs: this.resolved.maxQueuedPasswordJobs,
    })
    this.authorization = this.access.authorization
    this.throttle = internals.loginThrottle ?? new LoginFailureThrottle()
    this.nowMilliseconds = internals.nowMilliseconds ?? Date.now
    this.routes = new WorkbenchRouteAdmission(() => {
      ctx.logger.warn('workbench-auth: contained an HTTP perimeter failure')
    })
  }

  get routeLifecycle(): 'accepting' | 'closing' | 'closed' {
    return this.routes.lifecycle
  }

  get activeRequests(): number {
    return this.routes.activeRequests
  }

  /** Validate stored credentials before exposing either route. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield () => this.close()
    await this.access.open()
    if (!this.canPublishRoutes()) return
    const sharedApi = this.ctx.connection.createSharedFetchHandler('/api')
    if (!this.canPublishRoutes()) return
    this.sharedApi = sharedApi
    const authRoute: WebRoute = {
      kind: 'prefix',
      path: OWNER_AUTH_API_PATH,
      handler: (req, res) => this.routes.run(res, signal =>
        this.handleAuthRoute(req, res, signal)),
    }
    const workbenchRoute: WebRoute = {
      kind: 'prefix',
      path: WORKBENCH_API_PATH,
      handler: (req, res) => this.routes.run(res, signal =>
        this.handleWorkbenchRoute(req, res, signal)),
    }
    if (!this.registerRoute(authRoute)) return
    this.registerRoute(workbenchRoute)
  }

  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async handleAuthRoute(
    req: IncomingMessage,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const rejection = this.ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      writeOuterRejection(res, rejection)
      return
    }
    const remoteAddress = remoteAddressKey(req)
    await bridgeWorkbenchHttp(req, res, {
      fetch: request => this.authFetch(request, remoteAddress),
    }, {
      maxRequestBodyBytes: this.resolved.maxRequestBodyBytes,
      signal,
      noStore: true,
      requestFailure: status => authErrorResponse('bad-request', status),
    })
  }

  private async handleWorkbenchRoute(
    req: IncomingMessage,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const rejection = this.ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      writeOuterRejection(res, rejection)
      return
    }
    const token = ownerSessionToken(req.headers.cookie)
    if (token === undefined) {
      writePlainResponse(res, 401, 'unauthorized', true)
      return
    }
    let principal
    try {
      principal = await this.access.authenticate(token, signal)
    } catch {
      writePlainResponse(res, 503, 'unavailable', true)
      return
    }
    if (principal === null) {
      writePlainResponse(res, 401, 'unauthorized', true)
      return
    }
    const sharedApi = this.sharedApi
    if (sharedApi === undefined) {
      writePlainResponse(res, 503, 'unavailable', true)
      return
    }
    await this.authorization.runAs(principal, () => bridgeWorkbenchHttp(req, res, {
      fetch: (request) => {
        removeOwnerSessionCookie(request.headers)
        return sharedApi.fetch(request)
      },
    }, {
      maxRequestBodyBytes: this.resolved.maxRequestBodyBytes,
      signal,
      noStore: true,
    }))
  }

  private async authFetch(request: Request, remoteAddress: string): Promise<Response> {
    const url = new URL(request.url)
    if (url.search !== '') return authErrorResponse('bad-request', 400)
    if (url.pathname === OWNER_AUTH_STATE_PATH) {
      if (request.method !== 'GET') return methodNotAllowed('GET')
      try {
        const state = await this.access.state(
          ownerSessionToken(request.headers.get('cookie') ?? undefined),
          request.signal,
        )
        return authSuccessResponse(state)
      } catch (error) {
        return this.safeAuthFailure(error)
      }
    }
    if (url.pathname === OWNER_AUTH_INITIALIZE_PATH) {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      const body = await readExactJson(request, ['password'])
      if (!body.ok) return body.response
      if (typeof body.value.password !== 'string') return authErrorResponse('bad-request', 400)
      try {
        const initialized = await this.access.initialize(body.value.password, request.signal)
        return authSuccessResponse<InitializeOwnerResult>(
          initialized.value,
          ownerSessionSetCookie(initialized.token),
          201,
        )
      } catch (error) {
        return this.safeAuthFailure(error)
      }
    }
    if (url.pathname === OWNER_AUTH_LOGIN_PATH) {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      const body = await readExactJson(request, ['password'])
      if (!body.ok) return body.response
      if (typeof body.value.password !== 'string') return authErrorResponse('bad-request', 400)
      let now: number
      try {
        now = this.readNow()
      } catch {
        return authErrorResponse('unavailable', 503)
      }
      const blockedFor = this.throttle.retryAfterSeconds(remoteAddress, now)
      if (blockedFor !== undefined) return authErrorResponse('rate-limited', 429, blockedFor)
      try {
        const loggedIn = await this.access.login(body.value.password, request.signal)
        this.throttle.recordSuccess(remoteAddress)
        return authSuccessResponse<LoginOwnerResult>(
          loggedIn.value,
          ownerSessionSetCookie(loggedIn.token),
        )
      } catch (error) {
        if (error instanceof OwnerAuthFailure && error.code === 'invalid-credentials') {
          const retryAfter = this.throttle.recordFailure(remoteAddress, now)
          if (retryAfter !== undefined) {
            return authErrorResponse('rate-limited', 429, retryAfter)
          }
        }
        return this.safeAuthFailure(error)
      }
    }
    if (url.pathname === OWNER_AUTH_LOGOUT_PATH) {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      const body = await readExactJson(request, [])
      if (!body.ok) return body.response
      try {
        await this.access.logout(
          ownerSessionToken(request.headers.get('cookie') ?? undefined),
          request.signal,
        )
        const signedOut: OwnerAccessProjection = Object.freeze({ state: 'signed-out' })
        // The durable session removal above is deliberately complete before
        // the response instructs the browser to clear its cookie.
        return authSuccessResponse(signedOut, ownerSessionClearCookie())
      } catch (error) {
        return this.safeAuthFailure(error)
      }
    }
    return authErrorResponse('bad-request', 404)
  }

  private safeAuthFailure(error: unknown): Response {
    if (error instanceof PasswordValidationError) return authErrorResponse('bad-request', 400)
    if (error instanceof OwnerAuthFailure) {
      switch (error.code) {
        case 'already-initialized': return authErrorResponse(error.code, 409)
        case 'bad-request': return authErrorResponse(error.code, 400)
        case 'invalid-credentials': return authErrorResponse(error.code, 401)
        case 'rate-limited': return authErrorResponse(error.code, 429, error.retryAfterSeconds ?? 1)
        case 'unavailable': return authErrorResponse(error.code, 503)
      }
    }
    this.ctx.logger.warn('workbench-auth: contained an authentication provider failure')
    return authErrorResponse('unavailable', 503)
  }

  private readNow(): number {
    const value = this.nowMilliseconds()
    assertNow(value)
    return value
  }

  private canPublishRoutes(): boolean {
    const dependencies = this.ctx.fiber.store
    const credentials = dependencies?.credentials?.fiber
    const webServer = dependencies?.webServer?.fiber
    const connection = dependencies?.connection?.fiber
    return this.ctx.fiber.uid !== null
      && credentials !== undefined
      && credentials.uid !== null
      && webServer !== undefined
      && webServer.uid !== null
      && connection !== undefined
      && connection.uid !== null
      && this.access.lifecycle === 'running'
      && this.routes.lifecycle === 'accepting'
  }

  /** Dispose immediately if synchronous registration re-enters teardown. */
  private registerRoute(route: WebRoute): boolean {
    if (!this.canPublishRoutes()) return false
    const dispose = this.ctx.webServer.register(route)
    if (!this.canPublishRoutes()) {
      dispose()
      return false
    }
    this.routeDisposers.push(dispose)
    return true
  }

  private async doClose(): Promise<void> {
    const routeDrain = this.routes.close()
    for (const dispose of this.routeDisposers.splice(0).reverse()) dispose()
    await Promise.allSettled([routeDrain, this.access.close()])
    this.sharedApi = undefined
    this.throttle.clear()
  }
}

interface ExactJsonSuccess {
  readonly ok: true
  readonly value: Record<string, unknown>
}

interface ExactJsonFailure {
  readonly ok: false
  readonly response: Response
}

async function readExactJson(
  request: Request,
  expectedKeys: readonly string[],
): Promise<ExactJsonSuccess | ExactJsonFailure> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return { ok: false, response: authErrorResponse('bad-request', 415) }
  }
  let value: unknown
  try {
    value = JSON.parse(await request.text())
  } catch {
    return { ok: false, response: authErrorResponse('bad-request', 400) }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: authErrorResponse('bad-request', 400) }
  }
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return { ok: false, response: authErrorResponse('bad-request', 400) }
  }
  return { ok: true, value: record }
}

function authSuccessResponse<T>(value: T, setCookie?: string, status = 200): Response {
  const payload: OwnerAuthResponse<T> = { ok: true, value }
  return Response.json(payload, {
    status,
    headers: authHeaders(setCookie),
  })
}

function authErrorResponse(
  code: OwnerAuthErrorCode,
  status: number,
  retryAfterSeconds?: number,
): Response {
  const retry = retryAfterSeconds === undefined
    ? {}
    : { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) }
  const payload: OwnerAuthResponse<never> = {
    ok: false,
    error: { code, ...retry },
  }
  const headers = authHeaders()
  if (retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfterSeconds))))
  }
  return Response.json(payload, { status, headers })
}

function methodNotAllowed(method: 'GET' | 'POST'): Response {
  const response = authErrorResponse('bad-request', 405)
  response.headers.set('allow', method)
  return response
}

function authHeaders(setCookie?: string): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  if (setCookie !== undefined) headers.append('set-cookie', setCookie)
  return headers
}

/** Serialize the only persistent Owner browser cookie. */
export function ownerSessionSetCookie(token: string): string {
  if (!SAFE_COOKIE_VALUE.test(token)) throw new TypeError('Owner session token is not cookie-safe')
  return `${OWNER_SESSION_COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`
}

/** Clear with the same host-only scope after server-side revocation commits. */
export function ownerSessionClearCookie(): string {
  return `${OWNER_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`
}

/** Parse one unquoted, unique Owner cookie; ambiguity fails closed. */
export function ownerSessionToken(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined
  let found: string | undefined
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator === -1) continue
    const name = segment.slice(0, separator).trim()
    if (name !== OWNER_SESSION_COOKIE_NAME) continue
    const value = segment.slice(separator + 1).trim()
    if (found !== undefined || !SAFE_COOKIE_VALUE.test(value)) return undefined
    found = value
  }
  return found
}

/** Keep the opaque Owner token inside its authenticating adapter boundary. */
function removeOwnerSessionCookie(headers: Headers): void {
  const cookieHeader = headers.get('cookie')
  if (cookieHeader === null) return
  const retained = cookieHeader.split(';').filter((segment) => {
    const separator = segment.indexOf('=')
    if (separator === -1) return true
    return segment.slice(0, separator).trim() !== OWNER_SESSION_COOKIE_NAME
  })
  if (retained.length === 0) headers.delete('cookie')
  else headers.set('cookie', retained.join(';'))
}

function writeOuterRejection(res: ServerResponse, rejection: 401 | 403): void {
  writePlainResponse(
    res,
    rejection,
    rejection === 401 ? 'unauthorized' : 'forbidden',
    true,
  )
}

function remoteAddressKey(req: IncomingMessage): string {
  const address = req.socket?.remoteAddress
  const family = req.socket?.remoteFamily
  return `${family ?? 'unknown'}:${address ?? 'unknown'}`
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = Config(config)
  return {
    sessionLifetimeMinutes: resolved.sessionLifetimeMinutes
      ?? DEFAULT_OWNER_SESSION_LIFETIME_MINUTES,
    maxSessions: resolved.maxSessions ?? DEFAULT_OWNER_MAX_SESSIONS,
    maxConcurrentPasswordJobs: resolved.maxConcurrentPasswordJobs
      ?? DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS,
    maxQueuedPasswordJobs: resolved.maxQueuedPasswordJobs
      ?? DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS,
    maxRequestBodyBytes: resolved.maxRequestBodyBytes
      ?? DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES,
  }
}

function millisecondsToRetrySeconds(value: number): number {
  return Math.max(1, Math.ceil(value / 1_000))
}

function assertNow(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Authentication throttle clock returned an invalid millisecond instant')
  }
}

export default OwnerAuthService
