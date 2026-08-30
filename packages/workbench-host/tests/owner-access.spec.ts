import { createHash } from 'node:crypto'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import {
  WorkbenchAuthorizationContext,
  ownerPrincipal,
  type AuthorizationDecision,
} from '../src/authorization.ts'
import {
  DshOwnerCredentialStore,
  OWNER_AUTH_CREDENTIAL_KEY,
  OwnerCredentialStateError,
  type OwnerCredentialStore,
} from '../src/owner-credential-store.ts'
import {
  OwnerAccess,
  OwnerAuthFailure,
  type OwnerAccessClock,
  type OwnerAccessRandom,
} from '../src/owner-access.ts'
import type { PasswordHasher } from '../src/password.ts'

class MemoryCredentials {
  record: CredentialRecord | undefined
  private tail: Promise<void> = Promise.resolve()

  readonly provider = {
    readRecord: async () => structuredClone(this.record),
    modifyRecord: async (
      _key: unknown,
      mutation: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ) => {
      let result: CredentialRecord | undefined
      const operation = this.tail.then(async () => {
        const next = await mutation(structuredClone(this.record))
        if (next !== undefined) this.record = structuredClone(next)
        result = structuredClone(this.record)
      })
      this.tail = operation.then(() => undefined, () => undefined)
      await operation
      return result
    },
  } as unknown as CredentialProvider
}

class DeterministicHasher implements PasswordHasher {
  hashCalls = 0

  async hash(password: string): Promise<string> {
    this.hashCalls += 1
    return phc(password)
  }

  async verify(digest: string, password: string): Promise<boolean> {
    return digest === phc(password)
  }

  needsRehash(): boolean {
    return false
  }
}

function phc(password: string): string {
  const digest = createHash('sha256').update(password).digest('base64').replace(/=+$/u, '')
  return `$argon2id$v=19$m=65536,p=4,t=3$c2FsdC1maXh0dXJl$${digest}`
}

function deterministicRandom(): OwnerAccessRandom {
  let byteSeed = 1
  let id = 0
  return {
    bytes(size) {
      const value = new Uint8Array(size)
      for (let index = 0; index < size; index += 1) value[index] = (byteSeed + index) & 0xff
      byteSeed += size
      return value
    },
    id(prefix) {
      id += 1
      return `${prefix}-fixture-${String(id)}`
    },
  }
}

function mutableClock(iso = '2026-08-31T10:00:00.000Z'): OwnerAccessClock & { advance(ms: number): void } {
  let now = Date.parse(iso)
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => { now += milliseconds },
  }
}

function bench(options: { maxSessions?: number; sessionLifetimeMinutes?: number } = {}) {
  const credentials = new MemoryCredentials()
  const store = new DshOwnerCredentialStore(credentials.provider)
  const clock = mutableClock()
  const hasher = new DeterministicHasher()
  const access = new OwnerAccess({
    store,
    clock,
    passwordHasher: hasher,
    random: deterministicRandom(),
    maxSessions: options.maxSessions,
    sessionLifetimeMinutes: options.sessionLifetimeMinutes,
  })
  return { access, clock, credentials, hasher, store }
}

function authCode(error: unknown): string | undefined {
  return error instanceof OwnerAuthFailure ? error.code : undefined
}

describe('OwnerAccess', () => {
  it('admits exactly one concurrent initializer and stores only hashes/digests', async () => {
    const { access, credentials } = bench()
    await access.open()
    await expect(access.state(undefined)).resolves.toEqual({ state: 'setup-required' })

    const attempts = await Promise.allSettled([
      access.initialize('first owner password phrase'),
      access.initialize('second owner password phrase'),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(authCode(rejected.reason)).toBe('already-initialized')

    const winner = attempts.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<OwnerAccess['initialize']>>>
    const serialized = JSON.stringify(credentials.record)
    expect(serialized).toContain('$argon2id$v=19$m=65536,p=4,t=3$')
    expect(serialized).not.toContain('first owner password phrase')
    expect(serialized).not.toContain('second owner password phrase')
    expect(serialized).not.toContain(winner.value.token)
    expect(serialized).not.toContain(winner.value.value.recoveryCode)
    expect(winner.value.value.recoveryCode).toMatch(/^WB1-(?:[A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/u)

    await access.close()
  })

  it('establishes request-local policy context and fails closed outside it', async () => {
    const { access } = bench()
    await access.open()
    const initialized = await access.initialize('a sufficiently long owner passphrase')
    const principal = await access.authenticate(initialized.token)
    expect(principal).not.toBeNull()

    const outside = await access.authorization.require('workbench.status.read')
      .catch((error: unknown) => error)
    expect(outside).toBeInstanceOf(TypertRemoteFailure)
    expect((outside as TypertRemoteFailure).failure.code).toBe('unauthorized')

    await expect(access.authorization.runAs(principal!, () =>
      access.authorization.require('workbench.status.write'))).resolves.toMatchObject({
      ownerId: principal?.ownerId,
      organizationId: principal?.organizationId,
      teamId: principal?.teamId,
    })
    await expect(access.authorization.runAs({
      ...principal!,
      ownerId: 'owner-forged',
    }, () => access.authorization.require('workbench.status.write'))).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    expect(access.authorization.current()).toBeUndefined()
    await access.close()
  })

  it('uses fresh bounded sessions and logout revokes the exact token immediately', async () => {
    const { access, credentials } = bench({ maxSessions: 2 })
    await access.open()
    const initialized = await access.initialize('a sufficiently long owner passphrase')
    await expect(access.login('wrong password value')).rejects.toMatchObject({
      code: 'invalid-credentials',
    })
    const first = await access.login('a sufficiently long owner passphrase')
    const second = await access.login('a sufficiently long owner passphrase')
    expect(first.token).not.toBe(second.token)
    expect((credentials.record as { payload: { sessions: unknown[] } }).payload.sessions).toHaveLength(2)
    await expect(access.authenticate(initialized.token)).resolves.toBeNull()
    await expect(access.authenticate(first.token)).resolves.not.toBeNull()

    const firstPrincipal = await access.authenticate(first.token)
    await access.logout(first.token)
    await expect(access.authenticate(first.token)).resolves.toBeNull()
    await expect(access.authorization.runAs(firstPrincipal!, () =>
      access.authorization.require('workbench.status.write'))).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(access.authenticate(second.token)).resolves.not.toBeNull()
    await access.close()
  })

  it('expires sessions at the server and persists valid sessions across module restart', async () => {
    const { access, clock, store, hasher } = bench({ sessionLifetimeMinutes: 1 })
    await access.open()
    const initialized = await access.initialize('a sufficiently long owner passphrase')
    const principal = await access.authenticate(initialized.token)
    await access.close()

    const restarted = new OwnerAccess({
      store,
      clock,
      passwordHasher: hasher,
      random: deterministicRandom(),
      sessionLifetimeMinutes: 1,
    })
    await restarted.open()
    await expect(restarted.authenticate(initialized.token)).resolves.not.toBeNull()
    await expect(restarted.authorization.runAs(principal!, () =>
      restarted.authorization.require('workbench.status.read'))).resolves.toMatchObject({
      ownerId: principal?.ownerId,
    })
    clock.advance(60_000)
    await expect(restarted.authenticate(initialized.token)).resolves.toBeNull()
    await expect(restarted.authorization.runAs(principal!, () =>
      restarted.authorization.require('workbench.status.read'))).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await restarted.close()
  })

  it('stops admission, rejects queued password work, and drains an accepted native hash', async () => {
    const credentials = new MemoryCredentials()
    let hashCalls = 0
    let announceStarted!: () => void
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    let releaseHash!: () => void
    const released = new Promise<void>(resolve => { releaseHash = resolve })
    const hasher: PasswordHasher = {
      async hash(password) {
        hashCalls += 1
        announceStarted()
        await released
        return phc(password)
      },
      verify: async (digest, password) => digest === phc(password),
      needsRehash: () => false,
    }
    const access = new OwnerAccess({
      store: new DshOwnerCredentialStore(credentials.provider),
      passwordHasher: hasher,
      random: deterministicRandom(),
      maxConcurrentPasswordJobs: 1,
      maxQueuedPasswordJobs: 1,
    })
    await access.open()

    const first = access.initialize('first queued owner password').then(
      () => undefined,
      (error: unknown) => error,
    )
    await started
    const second = access.initialize('second queued owner password').then(
      () => undefined,
      (error: unknown) => error,
    )
    await new Promise<void>(resolve => setImmediate(resolve))

    let closeSettled = false
    const closing = access.close().then(() => { closeSettled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(access.lifecycle).toBe('closing')
    expect(closeSettled).toBe(false)
    expect(hashCalls).toBe(1)

    releaseHash()
    await expect(first).resolves.toMatchObject({ code: 'unavailable' })
    await expect(second).resolves.toMatchObject({ code: 'unavailable' })
    await closing
    expect(access.lifecycle).toBe('closed')
    expect(credentials.record).toBeUndefined()
  })

  it('waits for an opening credential read and cannot resurrect after close', async () => {
    const read = Promise.withResolvers<null>()
    const store: OwnerCredentialStore = {
      read: () => read.promise,
      modify: async () => null,
    }
    const access = new OwnerAccess({
      store,
      passwordHasher: new DeterministicHasher(),
      random: deterministicRandom(),
    })

    const opening = access.open()
    expect(access.lifecycle).toBe('opening')
    let closeSettled = false
    const closing = access.close().then(() => { closeSettled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(access.lifecycle).toBe('closing')
    expect(closeSettled).toBe(false)

    read.resolve(null)
    await Promise.all([opening, closing])
    expect(access.lifecycle).toBe('closed')
    await expect(access.state(undefined)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('consumes recovery codes, rotates the password, and invalidates every session', async () => {
    const { access } = bench()
    await access.open()
    const initialized = await access.initialize('the original owner password')
    const login = await access.login('the original owner password')
    const principal = await access.authenticate(login.token)
    const recovered = await access.recover(
      initialized.value.recoveryCode,
      'the replacement owner password',
    )
    expect(recovered.recoveryCode).not.toBe(initialized.value.recoveryCode)
    await expect(access.authenticate(initialized.token)).resolves.toBeNull()
    await expect(access.authenticate(login.token)).resolves.toBeNull()
    await expect(access.authorization.runAs(principal!, () =>
      access.authorization.require('workbench.status.write'))).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(access.login('the original owner password')).rejects.toMatchObject({
      code: 'invalid-credentials',
    })
    await expect(access.login('the replacement owner password')).resolves.toHaveProperty('token')
    await expect(access.recover(
      initialized.value.recoveryCode,
      'a third sufficiently long password',
    )).rejects.toMatchObject({ code: 'invalid-credentials' })
    await expect(access.recover(
      recovered.recoveryCode.toLowerCase().replaceAll('-', ' '),
      'a third sufficiently long password',
    )).resolves.toHaveProperty('recoveryCode')
    await access.close()
  })

  it('treats malformed or unknown credential state as unavailable, never setup-required', async () => {
    const credentials = new MemoryCredentials()
    credentials.record = { kind: 'grant', payload: { version: 99 } }
    const store = new DshOwnerCredentialStore(credentials.provider)
    await expect(store.read()).rejects.toBeInstanceOf(OwnerCredentialStateError)
    expect(credentials.provider.readRecord).toBeDefined()
    expect(OWNER_AUTH_CREDENTIAL_KEY).toBe('project-workbench/owner-auth')
  })
})

describe('WorkbenchAuthorizationContext', () => {
  it('does not leak a principal across sibling async chains', async () => {
    const authorization = new WorkbenchAuthorizationContext()
    const principal = {
      kind: 'owner' as const,
      ownerId: 'owner-one',
      organizationId: 'organization-one',
      teamId: 'team-one',
      sessionId: 'session-one',
      credentialVersion: 1,
    }
    const inside = authorization.runAs(principal, async () => {
      await Promise.resolve()
      return authorization.current()?.sessionId
    })
    const outside = Promise.resolve().then(() => authorization.current())
    await expect(inside).resolves.toBe('session-one')
    await expect(outside).resolves.toBeUndefined()
  })

  it('normalizes an abort racing a policy read to the public cancelled failure', async () => {
    const policy = Promise.withResolvers<AuthorizationDecision>()
    const authorization = new WorkbenchAuthorizationContext({
      authorize: () => policy.promise,
    })
    const principal = ownerPrincipal({
      kind: 'owner',
      ownerId: 'owner-cancelled',
      organizationId: 'organization-cancelled',
      teamId: 'team-cancelled',
      sessionId: 'session-cancelled',
      credentialVersion: 1,
    })
    const abort = new AbortController()
    const pending = authorization.runAs(principal, () =>
      authorization.require('workbench.status.read', abort.signal))
    abort.abort(new Error('caller left'))
    policy.reject(new Error('credential read noticed cancellation'))

    await expect(pending).rejects.toMatchObject({
      failure: { code: 'cancelled' },
    })
  })
})
