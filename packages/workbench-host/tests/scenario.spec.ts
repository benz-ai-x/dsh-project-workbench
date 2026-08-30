import { describe, expect, it } from 'vitest'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SetStatusRequest,
  SetStatusResult,
  WorkbenchActivityProjection,
  WorkbenchActivityQuery,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxClaim,
  WorkbenchOutboxClaimRequest,
  WorkbenchOutboxSettlement,
  WorkbenchRepository,
  WorkbenchStatusMutation,
  WorkbenchStatusSnapshot,
} from '../src/index.ts'

const TEST_AUDIT_GENESIS = `sha256:${'0'.repeat(64)}`
import { WorkbenchScenario } from '../src/index.ts'
import { WorkbenchAuthorizationContext, type WorkbenchAuthorization } from '../src/authorization.ts'

const authorization = Object.freeze({
  require: () => Promise.resolve(Object.freeze({
    ownerId: 'owner-test',
    organizationId: 'organization-test',
    teamId: 'team-test',
  })),
  filterProjection: <T>(_action: string, projection: T) => Promise.resolve(projection),
})

class MemoryRepository implements WorkbenchRepository {
  state: WorkbenchStatusSnapshot | null = null
  openCalls = 0
  closeCalls = 0
  readCalls = 0
  writeCalls = 0
  activityCalls = 0
  integrityCalls = 0
  onSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined
  onSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  afterSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined

  async open(): Promise<void> {
    this.openCalls += 1
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    this.readCalls += 1
    await this.onSnapshot?.(signal)
    return this.state === null ? null : { ...this.state }
  }

  lastMutation: WorkbenchStatusMutation | null = null

  async commitStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    this.writeCalls += 1
    this.lastMutation = mutation
    await this.onSetStatus?.(signal)
    const actualRevision = this.state?.revision ?? null
    if (actualRevision !== mutation.expectedRevision) {
      return {
        ok: false,
        error: {
          code: 'revision-conflict',
          message: 'fixture conflict',
          current: this.state === null ? null : { ...this.state },
        },
      }
    }
    this.state = this.state === null
      ? {
        id: mutation.candidateId,
        message: mutation.message,
        revision: 1,
        updatedAt: mutation.updatedAt,
      }
      : {
        ...this.state,
        message: mutation.message,
        revision: this.state.revision + 1,
        updatedAt: mutation.updatedAt,
      }
    await this.afterSetStatus?.(signal)
    return {
      ok: true,
      value: { ...this.state },
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
    }
  }

  lastActivityQuery: WorkbenchActivityQuery | null = null

  async readActivity(query: WorkbenchActivityQuery): Promise<WorkbenchActivityProjection> {
    this.activityCalls += 1
    this.lastActivityQuery = query
    return Object.freeze({
      items: Object.freeze([]),
      nextBeforeSequence: null,
      integrity: Object.freeze({
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      }),
    })
  }

  async verifyAuditChain(): Promise<WorkbenchAuditIntegrityProjection> {
    this.integrityCalls += 1
    return Object.freeze({
      valid: true,
      eventCount: 0,
      headHash: TEST_AUDIT_GENESIS,
      issue: null,
    })
  }

  async claimOutbox(_request: WorkbenchOutboxClaimRequest): Promise<WorkbenchOutboxClaim | null> {
    return null
  }

  async settleOutbox(_settlement: WorkbenchOutboxSettlement): Promise<boolean> {
    return false
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

function createScenario(
  repository = new MemoryRepository(),
  access: WorkbenchAuthorization = authorization,
): {
  readonly repository: MemoryRepository
  readonly scenario: WorkbenchScenario
} {
  const instants = [
    new Date('2026-08-31T01:02:03.000Z'),
    new Date('2026-08-31T02:03:04.000Z'),
  ]
  const statusIds = ['status-001', 'status-002']
  const commandIds = ['command-001', 'command-002']
  const auditIds = ['audit-001', 'audit-002']
  const outboxIds = ['outbox-001', 'outbox-002']
  const adapters = { feishu: { adapterId: 'fixture-feishu' } } as const
  return {
    repository,
    scenario: new WorkbenchScenario({
      repository,
      clock: { now: () => instants.shift() ?? new Date('2026-08-31T03:04:05.000Z') },
      ids: {
        nextStatusId: () => statusIds.shift() ?? 'status-fallback',
        nextCommandId: () => commandIds.shift() ?? 'command-fallback',
        nextAuditEventId: () => auditIds.shift() ?? 'audit-fallback',
        nextOutboxId: () => outboxIds.shift() ?? 'outbox-fallback',
      },
      adapters,
      authorization: access,
      maxStatusLength: 12,
    }),
  }
}

function failureCode(error: unknown): string | undefined {
  return error instanceof TypertRemoteFailure ? error.failure.code : undefined
}

function statusRequest(message: string, expectedRevision: number | null) {
  return {
    message,
    expectedRevision,
    idempotencyKey: 'idempotency-key-001',
    causationId: 'causation-id-000001',
    reason: 'owner-status-edit' as const,
  }
}

describe('WorkbenchScenario', () => {
  it('drives a deterministic command through the repository into the public projection', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()

    await expect(scenario.snapshot()).resolves.toBeNull()
    await expect(scenario.setStatus(
      {
        ...statusRequest('  On track  ', null),
        actor: { kind: 'owner', id: 'browser-forged-owner' },
        organizationId: 'browser-forged-organization',
      } as SetStatusRequest,
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'On track',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await expect(scenario.snapshot()).resolves.toEqual({
      id: 'status-001',
      message: 'On track',
      revision: 1,
      updatedAt: '2026-08-31T01:02:03.000Z',
    })
    expect(repository.openCalls).toBe(1)
    expect(repository.lastMutation?.command).toMatchObject({
      actor: {
        kind: 'owner',
        id: 'owner-test',
        organizationId: 'organization-test',
        teamId: 'team-test',
      },
      idempotencyKey: 'idempotency-key-001',
      causationId: 'causation-id-000001',
      reason: 'owner-status-edit',
    })
    expect(scenario.adapters).toEqual({ feishu: { adapterId: 'fixture-feishu' } })

    await scenario.close()
  })

  it('returns revision conflict as a domain result with the current projection', async () => {
    const { scenario, repository } = createScenario()
    repository.state = {
      id: 'status-existing',
      message: 'Current',
      revision: 3,
      updatedAt: '2026-08-30T01:00:00.000Z',
    }
    await scenario.open()

    await expect(scenario.setStatus(
      statusRequest('Stale update', 2),
      new AbortController().signal,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'revision-conflict',
        message: 'fixture conflict',
        current: repository.state,
      },
    })

    await scenario.close()
  })

  it('rejects malformed commands before persistence with typed Remote failures', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    for (const request of [
      { ...statusRequest('   ', null) },
      { ...statusRequest('1234567890123', null) },
      { ...statusRequest('valid', 0) },
      { ...statusRequest('valid', null), idempotencyKey: 'short' },
      { ...statusRequest('valid', null), reason: 'raw user text' },
    ]) {
      const error = await scenario.setStatus(
        request as SetStatusRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.writeCalls).toBe(0)

    const cancelled = new AbortController()
    cancelled.abort(new Error('caller left'))
    const error = await scenario.setStatus(
      statusRequest('valid', null),
      cancelled.signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(repository.writeCalls).toBe(0)

    await scenario.close()
  })

  it('fails closed at the shared authorization seam before reading or writing persistence', async () => {
    const repository = new MemoryRepository()
    const { scenario } = createScenario(repository, new WorkbenchAuthorizationContext())
    await scenario.open()

    const readError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(readError)).toBe('unauthorized')
    const writeError = await scenario.setStatus(
      statusRequest('Must not pass', null),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(writeError)).toBe('unauthorized')
    expect(repository.readCalls).toBe(0)
    expect(repository.writeCalls).toBe(0)
    expect(repository.activityCalls).toBe(0)
    expect(repository.integrityCalls).toBe(0)

    await scenario.close()
  })

  it('derives Activity scope from authorization and validates safe filters before storage', async () => {
    const repository = new MemoryRepository()
    const required: string[] = []
    const filtered: string[] = []
    const access: WorkbenchAuthorization = {
      require: action => {
        required.push(action)
        return Promise.resolve({
          ownerId: 'owner-authoritative',
          organizationId: 'organization-authoritative',
          teamId: 'team-authoritative',
        })
      },
      filterProjection: (action, projection) => {
        filtered.push(action)
        return Promise.resolve(projection)
      },
    }
    const { scenario } = createScenario(repository, access)
    await scenario.open()

    await expect(scenario.activity({
      projectId: 'project-safe',
      objectType: 'workbench-status',
      objectId: 'status-safe',
      action: 'workbench.status.updated',
      beforeSequence: 4,
      limit: 10,
    })).resolves.toEqual({
      items: [],
      nextBeforeSequence: null,
      integrity: {
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      },
    })
    expect(repository.lastActivityQuery).toEqual({
      organizationId: 'organization-authoritative',
      filter: {
        projectId: 'project-safe',
        objectType: 'workbench-status',
        objectId: 'status-safe',
        action: 'workbench.status.updated',
        beforeSequence: 4,
        limit: 10,
      },
    })
    await expect(scenario.auditIntegrity()).resolves.toMatchObject({ valid: true, eventCount: 0 })
    expect(required).toEqual(['workbench.activity.read', 'workbench.audit.verify'])
    expect(filtered).toEqual(['workbench.activity.read', 'workbench.audit.verify'])

    const error = await scenario.activity({ limit: 101 } as never)
      .catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('bad-request')
    expect(repository.activityCalls).toBe(1)
    await scenario.close()
  })

  it('stops admission, cancels and drains in-flight work, then closes its repository once', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSnapshot = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()

    const pending = scenario.snapshot()
    await started.promise
    const closing = scenario.close()
    const pendingError = await pending.catch((reason: unknown) => reason)
    expect(failureCode(pendingError)).toBe('cancelled')
    await closing

    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
    await scenario.close()
    expect(repository.closeCalls).toBe(1)
    const lateError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(lateError)).toBe('unavailable')
  })

  it('preserves caller cancellation while an accepted persistence operation is in flight', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSetStatus = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('In flight', null), caller.signal)
    await started.promise
    caller.abort(new Error('caller left'))

    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(scenario.lifecycle).toBe('running')
    await scenario.close()
  })

  it('returns the durable result when cancellation races after the commit point', async () => {
    const repository = new MemoryRepository()
    const committed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    repository.afterSetStatus = async (signal) => {
      committed.resolve()
      await release.promise
      expect(signal.aborted).toBe(true)
    }
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('Committed', null), caller.signal)
    await committed.promise
    caller.abort(new Error('caller left after commit'))
    release.resolve()

    await expect(pending).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'Committed',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await scenario.close()
  })
})
