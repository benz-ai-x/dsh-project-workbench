import { describe, expect, it } from 'vitest'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SetStatusResult,
  WorkbenchRepository,
  WorkbenchStatusMutation,
  WorkbenchStatusSnapshot,
} from '../src/index.ts'
import { WorkbenchScenario } from '../src/index.ts'

class MemoryRepository implements WorkbenchRepository {
  state: WorkbenchStatusSnapshot | null = null
  openCalls = 0
  closeCalls = 0
  writeCalls = 0
  onSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined
  onSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  afterSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined

  async open(): Promise<void> {
    this.openCalls += 1
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    await this.onSnapshot?.(signal)
    return this.state === null ? null : { ...this.state }
  }

  async setStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    this.writeCalls += 1
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
    return { ok: true, value: { ...this.state } }
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

function createScenario(repository = new MemoryRepository()): {
  readonly repository: MemoryRepository
  readonly scenario: WorkbenchScenario
} {
  const instants = [
    new Date('2026-08-31T01:02:03.000Z'),
    new Date('2026-08-31T02:03:04.000Z'),
  ]
  const ids = ['status-001', 'status-002']
  const adapters = { feishu: { adapterId: 'fixture-feishu' } } as const
  return {
    repository,
    scenario: new WorkbenchScenario({
      repository,
      clock: { now: () => instants.shift() ?? new Date('2026-08-31T03:04:05.000Z') },
      ids: { nextStatusId: () => ids.shift() ?? 'status-fallback' },
      adapters,
      maxStatusLength: 12,
    }),
  }
}

function failureCode(error: unknown): string | undefined {
  return error instanceof TypertRemoteFailure ? error.failure.code : undefined
}

describe('WorkbenchScenario', () => {
  it('drives a deterministic command through the repository into the public projection', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()

    await expect(scenario.snapshot()).resolves.toBeNull()
    await expect(scenario.setStatus({
      message: '  On track  ',
      expectedRevision: null,
    }, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'On track',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
    })
    await expect(scenario.snapshot()).resolves.toEqual({
      id: 'status-001',
      message: 'On track',
      revision: 1,
      updatedAt: '2026-08-31T01:02:03.000Z',
    })
    expect(repository.openCalls).toBe(1)
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

    await expect(scenario.setStatus({
      message: 'Stale update',
      expectedRevision: 2,
    }, new AbortController().signal)).resolves.toEqual({
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
      { message: '   ', expectedRevision: null },
      { message: '1234567890123', expectedRevision: null },
      { message: 'valid', expectedRevision: 0 },
    ]) {
      const error = await scenario.setStatus(request, signal).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.writeCalls).toBe(0)

    const cancelled = new AbortController()
    cancelled.abort(new Error('caller left'))
    const error = await scenario.setStatus({
      message: 'valid',
      expectedRevision: null,
    }, cancelled.signal).catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(repository.writeCalls).toBe(0)

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

    const pending = scenario.setStatus({
      message: 'In flight',
      expectedRevision: null,
    }, caller.signal)
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

    const pending = scenario.setStatus({
      message: 'Committed',
      expectedRevision: null,
    }, caller.signal)
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
    })
    await scenario.close()
  })
})
