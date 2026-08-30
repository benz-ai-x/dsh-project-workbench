/** Deep Owner module: singleton setup, password login, sessions, and recovery. */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  InitializeOwnerResult,
  LoginOwnerResult,
  OwnerAccessProjection,
  OwnerAuthErrorCode,
} from './client.ts'
import {
  type OwnerPrincipal,
  V1OwnerAuthorizationPolicy,
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from './authorization.ts'
import {
  type OwnerAuthRecord,
  type OwnerCredentialStore,
  type OwnerSessionRecord,
} from './owner-credential-store.ts'
import {
  argon2idPasswordHasher,
  normalizeOwnerPassword,
  type PasswordHasher,
} from './password.ts'

export const DEFAULT_OWNER_SESSION_LIFETIME_MINUTES = 12 * 60
export const DEFAULT_OWNER_MAX_SESSIONS = 16
export const DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS = 2
export const DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS = 8
const SESSION_TOKEN_BYTES = 32
const RECOVERY_CODE_BYTES = 20
const SESSION_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/u
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RECOVERY_CODE_PATTERN = /^WB1-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){7}$/u

type OwnerAccessPhase = 'new' | 'opening' | 'running' | 'closing' | 'closed'

/** Stable wall-clock seam for expiry and deterministic tests. */
export interface OwnerAccessClock {
  now(): Date
}

/** Entropy/identity seam; production delegates to node:crypto. */
export interface OwnerAccessRandom {
  bytes(size: number): Uint8Array
  id(prefix: 'owner' | 'organization' | 'team' | 'session'): string
}

export interface OwnerAccessOptions {
  readonly store: OwnerCredentialStore
  readonly authorization?: WorkbenchAuthorizationContext
  readonly passwordHasher?: PasswordHasher
  readonly clock?: OwnerAccessClock
  readonly random?: OwnerAccessRandom
  readonly sessionLifetimeMinutes?: number
  readonly maxSessions?: number
  readonly maxConcurrentPasswordJobs?: number
  readonly maxQueuedPasswordJobs?: number
}

/** Internal setup/login result; the HTTP adapter alone serializes its cookie. */
export interface OwnerSessionGrant<T extends LoginOwnerResult | InitializeOwnerResult> {
  readonly token: string
  readonly value: T
}

/** Local recovery result; its replacement code is printed exactly once by CLI. */
export interface OwnerRecoveryResult {
  readonly ownerId: string
  readonly recoveryCode: string
}

/** Safe auth-domain rejection translated at the HTTP/CLI boundaries. */
export class OwnerAuthFailure extends Error {
  constructor(
    readonly code: OwnerAuthErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Owner authentication failed: ${code}`)
    this.name = 'OwnerAuthFailure'
  }
}

export const systemOwnerAccessClock: OwnerAccessClock = Object.freeze({
  now: () => new Date(),
})

export const systemOwnerAccessRandom: OwnerAccessRandom = Object.freeze({
  bytes: (size: number) => randomBytes(size),
  id: (prefix: 'owner' | 'organization' | 'team' | 'session') => `${prefix}-${randomUUID()}`,
})

/**
 * One deep authentication module hiding DSH record layout and secret handling.
 * It has no HTTP/Cookie knowledge; adapters receive/return opaque tokens only.
 */
export class OwnerAccess {
  readonly authorization: WorkbenchAuthorizationContext
  private readonly passwordHasher: PasswordHasher
  private readonly clock: OwnerAccessClock
  private readonly random: OwnerAccessRandom
  private readonly sessionLifetimeMilliseconds: number
  private readonly maxSessions: number
  private readonly passwordJobs: PasswordJobQueue
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<unknown>>()
  private phase: OwnerAccessPhase = 'new'
  private opening: Promise<void> | undefined
  private closing: Promise<void> | undefined

  constructor(private readonly options: OwnerAccessOptions) {
    this.authorization = options.authorization ?? new WorkbenchAuthorizationContext(
      new V1OwnerAuthorizationPolicy((principal, signal) =>
        this.principalIsActive(principal, signal)),
    )
    this.passwordHasher = options.passwordHasher ?? argon2idPasswordHasher
    this.clock = options.clock ?? systemOwnerAccessClock
    this.random = options.random ?? systemOwnerAccessRandom
    const sessionLifetimeMinutes = options.sessionLifetimeMinutes
      ?? DEFAULT_OWNER_SESSION_LIFETIME_MINUTES
    this.maxSessions = options.maxSessions ?? DEFAULT_OWNER_MAX_SESSIONS
    const maxConcurrentPasswordJobs = options.maxConcurrentPasswordJobs
      ?? DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS
    const maxQueuedPasswordJobs = options.maxQueuedPasswordJobs
      ?? DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS
    positiveInteger(sessionLifetimeMinutes, 'sessionLifetimeMinutes')
    positiveInteger(this.maxSessions, 'maxSessions')
    positiveInteger(maxConcurrentPasswordJobs, 'maxConcurrentPasswordJobs')
    nonNegativeInteger(maxQueuedPasswordJobs, 'maxQueuedPasswordJobs')
    if (this.maxSessions > 64) throw new TypeError('maxSessions cannot exceed 64')
    this.sessionLifetimeMilliseconds = sessionLifetimeMinutes * 60_000
    if (!Number.isSafeInteger(this.sessionLifetimeMilliseconds)) {
      throw new TypeError('sessionLifetimeMinutes is too large')
    }
    this.passwordJobs = new PasswordJobQueue(
      maxConcurrentPasswordJobs,
      maxQueuedPasswordJobs,
    )
  }

  get lifecycle(): OwnerAccessPhase {
    return this.phase
  }

  /** Validate any existing record before exposing auth routes. */
  async open(): Promise<void> {
    if (this.phase !== 'new') throw new Error('Owner access can only be opened once')
    this.phase = 'opening'
    this.opening = this.doOpen()
    await this.opening
  }

  /** Safe shell state for a request carrying an optional session token. */
  state(token: string | undefined, signal?: AbortSignal): Promise<OwnerAccessProjection> {
    return this.execute(signal, async (operationSignal) => {
      const record = await this.options.store.read()
      throwIfAborted(operationSignal)
      if (record === null) return Object.freeze({ state: 'setup-required' })
      const authenticated = token === undefined
        ? undefined
        : authenticateRecord(record, token, this.now())
      return authenticated === undefined
        ? Object.freeze({ state: 'signed-out' })
        : signedInProjection(record, authenticated.session)
    })
  }

  /** Atomically win the absent-to-singleton Owner initialization race. */
  initialize(password: string, signal?: AbortSignal): Promise<OwnerSessionGrant<InitializeOwnerResult>> {
    return this.execute(signal, async (operationSignal) => {
      normalizeOwnerPassword(password, true)
      const initial = await this.options.store.read()
      if (initial !== null) throw new OwnerAuthFailure('already-initialized')
      const passwordPhc = await this.passwordJobs.run(
        () => this.passwordHasher.hash(password),
        operationSignal,
      )
      throwIfAborted(operationSignal)
      const now = this.now()
      const recoveryCode = createRecoveryCode(this.random.bytes(RECOVERY_CODE_BYTES))
      const token = createSessionToken(this.random.bytes(SESSION_TOKEN_BYTES))
      const identity = Object.freeze({
        ownerId: this.random.id('owner'),
        organizationId: this.random.id('organization'),
        teamId: this.random.id('team'),
        createdAt: now.toISOString(),
      })
      const session = this.newSession(token, 1, now)
      let lostRace = false
      const stored = await this.options.store.modify(async (current) => {
        if (current !== null) {
          lostRace = true
          return undefined
        }
        throwIfAborted(operationSignal)
        return Object.freeze({
          version: 1 as const,
          credentialVersion: 1,
          identity,
          passwordPhc,
          recovery: Object.freeze({
            generation: 1,
            digest: secretDigest(recoveryCode),
            issuedAt: now.toISOString(),
          }),
          sessions: Object.freeze([session]),
        })
      })
      if (lostRace || stored === null || stored.identity.ownerId !== identity.ownerId) {
        throw new OwnerAuthFailure('already-initialized')
      }
      return Object.freeze({
        token,
        value: Object.freeze({
          access: signedInProjection(stored, session),
          recoveryCode,
        }),
      })
    })
  }

  /** Verify Argon2id outside the credential lock, then append a fresh session. */
  login(password: string, signal?: AbortSignal): Promise<OwnerSessionGrant<LoginOwnerResult>> {
    return this.execute(signal, async (operationSignal) => {
      const observed = await this.options.store.read()
      if (observed === null) throw new OwnerAuthFailure('invalid-credentials')
      const valid = await this.passwordJobs.run(
        () => this.passwordHasher.verify(observed.passwordPhc, password),
        operationSignal,
      )
      if (!valid) throw new OwnerAuthFailure('invalid-credentials')
      throwIfAborted(operationSignal)
      const replacementPhc = this.passwordHasher.needsRehash(observed.passwordPhc)
        ? await this.passwordJobs.run(() => this.passwordHasher.hash(password), operationSignal)
        : observed.passwordPhc
      throwIfAborted(operationSignal)
      const now = this.now()
      const token = createSessionToken(this.random.bytes(SESSION_TOKEN_BYTES))
      const session = this.newSession(token, observed.credentialVersion, now)
      let stale = false
      const stored = await this.options.store.modify(async (current) => {
        if (current === null
          || current.credentialVersion !== observed.credentialVersion
          || current.passwordPhc !== observed.passwordPhc) {
          stale = true
          return undefined
        }
        throwIfAborted(operationSignal)
        return Object.freeze({
          ...current,
          passwordPhc: replacementPhc,
          sessions: Object.freeze(appendBoundedSession(
            current,
            session,
            now,
            this.maxSessions,
          )),
        })
      })
      if (stale || stored === null) throw new OwnerAuthFailure('invalid-credentials')
      return Object.freeze({
        token,
        value: Object.freeze({ access: signedInProjection(stored, session) }),
      })
    })
  }

  /** Authenticate an opaque token against the current revocation record. */
  authenticate(token: string, signal?: AbortSignal): Promise<OwnerPrincipal | null> {
    return this.execute(signal, async (operationSignal) => {
      if (!SESSION_TOKEN_PATTERN.test(token)) return null
      const record = await this.options.store.read()
      throwIfAborted(operationSignal)
      if (record === null) return null
      return authenticateRecord(record, token, this.now())?.principal ?? null
    })
  }

  /** Revalidate an ALS principal at scenario admission against current durable grants. */
  private principalIsActive(
    principal: OwnerPrincipal,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.execute(signal, async (operationSignal) => {
      const record = await this.options.store.read()
      throwIfAborted(operationSignal)
      if (record === null) return false
      return principalMatchesRecord(record, principal, this.now())
    })
  }

  /** Remove the current server-side session before the adapter clears its cookie. */
  logout(token: string | undefined, signal?: AbortSignal): Promise<void> {
    return this.execute(signal, async (operationSignal) => {
      if (token === undefined || !SESSION_TOKEN_PATTERN.test(token)) return
      const digest = secretDigest(token)
      await this.options.store.modify(async (current) => {
        if (current === null) return undefined
        const sessions = current.sessions.filter(session => !sameDigest(session.digest, digest))
        if (sessions.length === current.sessions.length) return undefined
        throwIfAborted(operationSignal)
        return Object.freeze({ ...current, sessions: Object.freeze(sessions) })
      })
    })
  }

  /** Consume the current offline code, rotate credentials, and revoke all sessions. */
  recover(
    recoveryCode: string,
    newPassword: string,
    signal?: AbortSignal,
  ): Promise<OwnerRecoveryResult> {
    return this.execute(signal, async (operationSignal) => {
      const canonicalCode = normalizeRecoveryCode(recoveryCode)
      normalizeOwnerPassword(newPassword, true)
      const observed = await this.options.store.read()
      if (observed === null
        || !sameDigest(observed.recovery.digest, secretDigest(canonicalCode))) {
        throw new OwnerAuthFailure('invalid-credentials')
      }
      const passwordPhc = await this.passwordJobs.run(
        () => this.passwordHasher.hash(newPassword),
        operationSignal,
      )
      throwIfAborted(operationSignal)
      const now = this.now()
      const replacementCode = createRecoveryCode(this.random.bytes(RECOVERY_CODE_BYTES))
      let stale = false
      const stored = await this.options.store.modify(async (current) => {
        if (current === null
          || current.credentialVersion !== observed.credentialVersion
          || current.recovery.generation !== observed.recovery.generation
          || !sameDigest(current.recovery.digest, observed.recovery.digest)) {
          stale = true
          return undefined
        }
        throwIfAborted(operationSignal)
        return Object.freeze({
          ...current,
          credentialVersion: current.credentialVersion + 1,
          passwordPhc,
          recovery: Object.freeze({
            generation: current.recovery.generation + 1,
            digest: secretDigest(replacementCode),
            issuedAt: now.toISOString(),
          }),
          sessions: Object.freeze([]),
        })
      })
      if (stale || stored === null) throw new OwnerAuthFailure('invalid-credentials')
      return Object.freeze({
        ownerId: stored.identity.ownerId,
        recoveryCode: replacementCode,
      })
    })
  }

  /** Stop admission, cancel queued jobs, and wait for native jobs/record writes. */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private newSession(token: string, credentialVersion: number, now: Date): OwnerSessionRecord {
    const expiresAt = new Date(now.getTime() + this.sessionLifetimeMilliseconds)
    if (!Number.isFinite(expiresAt.getTime())) throw new OwnerAuthFailure('unavailable')
    return Object.freeze({
      id: this.random.id('session'),
      digest: secretDigest(token),
      credentialVersion,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
  }

  private now(): Date {
    const value = this.clock.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new OwnerAuthFailure('unavailable')
    }
    return new Date(value.getTime())
  }

  private async execute<T>(
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.phase !== 'running') throw new OwnerAuthFailure('unavailable')
    const signal = callerSignal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([callerSignal, this.lifetime.signal])
    const pending = Promise.resolve().then(() => operation(signal))
    this.inFlight.add(pending)
    try {
      return await pending
    } catch (error) {
      if (error instanceof OwnerAuthFailure) throw error
      if (signal.aborted) throw new OwnerAuthFailure('unavailable')
      throw error
    } finally {
      this.inFlight.delete(pending)
    }
  }

  private async doClose(): Promise<void> {
    if (this.phase === 'closed') return
    this.phase = 'closing'
    this.lifetime.abort(new Error('Owner access is disposing'))
    this.passwordJobs.close()
    await Promise.allSettled([
      ...(this.opening === undefined ? [] : [this.opening]),
      ...this.inFlight,
    ])
    this.phase = 'closed'
  }

  private async doOpen(): Promise<void> {
    try {
      await this.options.store.read()
    } catch (error) {
      if (this.phase === 'opening') this.phase = 'new'
      throw error
    }
    if (this.phase === 'opening') this.phase = 'running'
  }
}

interface AuthenticatedSession {
  readonly session: OwnerSessionRecord
  readonly principal: OwnerPrincipal
}

function authenticateRecord(
  record: OwnerAuthRecord,
  token: string,
  now: Date,
): AuthenticatedSession | undefined {
  if (!SESSION_TOKEN_PATTERN.test(token)) return undefined
  const digest = secretDigest(token)
  let matched: OwnerSessionRecord | undefined
  for (const session of record.sessions) {
    if (sameDigest(session.digest, digest)) matched = session
  }
  if (matched === undefined
    || matched.credentialVersion !== record.credentialVersion
    || Date.parse(matched.expiresAt) <= now.getTime()) return undefined
  return Object.freeze({
    session: matched,
    principal: ownerPrincipal({
      kind: 'owner',
      ownerId: record.identity.ownerId,
      organizationId: record.identity.organizationId,
      teamId: record.identity.teamId,
      sessionId: matched.id,
      credentialVersion: matched.credentialVersion,
    }),
  })
}

function principalMatchesRecord(
  record: OwnerAuthRecord,
  principal: OwnerPrincipal,
  now: Date,
): boolean {
  if (principal.credentialVersion !== record.credentialVersion
    || principal.ownerId !== record.identity.ownerId
    || principal.organizationId !== record.identity.organizationId
    || principal.teamId !== record.identity.teamId) return false
  const session = record.sessions.find(candidate => candidate.id === principal.sessionId)
  return session !== undefined
    && session.credentialVersion === record.credentialVersion
    && Date.parse(session.expiresAt) > now.getTime()
}

function signedInProjection(
  record: OwnerAuthRecord,
  session: OwnerSessionRecord,
): Extract<OwnerAccessProjection, { readonly state: 'signed-in' }> {
  return Object.freeze({
    state: 'signed-in',
    ownerId: record.identity.ownerId,
    organizationId: record.identity.organizationId,
    teamId: record.identity.teamId,
    sessionExpiresAt: session.expiresAt,
  })
}

function appendBoundedSession(
  current: OwnerAuthRecord,
  session: OwnerSessionRecord,
  now: Date,
  maxSessions: number,
): OwnerSessionRecord[] {
  const live = current.sessions.filter(candidate =>
    candidate.credentialVersion === current.credentialVersion
    && Date.parse(candidate.expiresAt) > now.getTime())
  live.push(session)
  live.sort((left, right) => Date.parse(left.issuedAt) - Date.parse(right.issuedAt))
  return live.slice(-maxSessions)
}

export function createSessionToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== SESSION_TOKEN_BYTES) {
    throw new TypeError(`Session entropy must be ${SESSION_TOKEN_BYTES} bytes`)
  }
  return `v1.${Buffer.from(bytes).toString('base64url')}`
}

export function createRecoveryCode(bytes: Uint8Array): string {
  if (bytes.byteLength !== RECOVERY_CODE_BYTES) {
    throw new TypeError(`Recovery entropy must be ${RECOVERY_CODE_BYTES} bytes`)
  }
  let accumulator = 0
  let bits = 0
  let encoded = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += RECOVERY_ALPHABET[(accumulator >>> bits) & 31]
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits !== 0 || encoded.length !== 32) throw new Error('Recovery encoder lost entropy')
  return `WB1-${encoded.match(/.{4}/gu)?.join('-') ?? ''}`
}

export function normalizeRecoveryCode(value: unknown): string {
  if (typeof value !== 'string') throw new OwnerAuthFailure('invalid-credentials')
  const compact = value.trim().toUpperCase().replace(/[\s-]+/gu, '')
  if (!compact.startsWith('WB1') || compact.length !== 35) {
    throw new OwnerAuthFailure('invalid-credentials')
  }
  const body = compact.slice(3)
  const canonical = `WB1-${body.match(/.{4}/gu)?.join('-') ?? ''}`
  if (!RECOVERY_CODE_PATTERN.test(canonical)) {
    throw new OwnerAuthFailure('invalid-credentials')
  }
  return canonical
}

export function secretDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url')
  const rightBytes = Buffer.from(right, 'base64url')
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new OwnerAuthFailure('unavailable')
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`)
  }
}

interface QueuedPasswordJob<T> {
  readonly task: () => Promise<T>
  readonly signal: AbortSignal
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
  readonly onAbort: () => void
}

/** Small no-timer semaphore preventing password guesses from exhausting RAM. */
class PasswordJobQueue {
  private active = 0
  private closed = false
  private readonly queue: QueuedPasswordJob<unknown>[] = []

  constructor(
    private readonly concurrency: number,
    private readonly maxQueued: number,
  ) {}

  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.closed || signal.aborted) return Promise.reject(new OwnerAuthFailure('unavailable'))
    if (this.active < this.concurrency) return this.start(task, signal)
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new OwnerAuthFailure('rate-limited', 1))
    }
    return new Promise<T>((resolve, reject) => {
      let queued: QueuedPasswordJob<T>
      const onAbort = (): void => {
        const index = this.queue.indexOf(queued as QueuedPasswordJob<unknown>)
        if (index === -1) return
        this.queue.splice(index, 1)
        reject(new OwnerAuthFailure('unavailable'))
      }
      queued = { task, signal, resolve, reject, onAbort }
      this.queue.push(queued as QueuedPasswordJob<unknown>)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  close(): void {
    this.closed = true
    for (const queued of this.queue.splice(0)) {
      queued.signal.removeEventListener('abort', queued.onAbort)
      queued.reject(new OwnerAuthFailure('unavailable'))
    }
  }

  private async start<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    this.active += 1
    try {
      if (signal.aborted || this.closed) throw new OwnerAuthFailure('unavailable')
      const value = await task()
      if (signal.aborted || this.closed) throw new OwnerAuthFailure('unavailable')
      return value
    } finally {
      this.active -= 1
      this.advance()
    }
  }

  private advance(): void {
    while (!this.closed && this.active < this.concurrency && this.queue.length > 0) {
      const queued = this.queue.shift() as QueuedPasswordJob<unknown>
      queued.signal.removeEventListener('abort', queued.onAbort)
      if (queued.signal.aborted) {
        queued.reject(new OwnerAuthFailure('unavailable'))
        continue
      }
      void this.start(queued.task, queued.signal).then(queued.resolve, queued.reject)
    }
  }
}
