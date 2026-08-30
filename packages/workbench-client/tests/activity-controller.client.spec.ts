import type {
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchActivityController,
  type WorkbenchActivityRemote,
} from '../src/client/activity-controller.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function activity(
  sequence = 1,
  projectId: string | null = null,
  nextBeforeSequence: number | null = null,
  eventCount = sequence,
): WorkbenchActivityProjection {
  return {
    items: [{
      sequence,
      eventId: `audit-${sequence}`,
      occurredAt: '2026-08-31T12:00:00.000Z',
      actor: { kind: 'owner', id: 'owner-safe' },
      projectId,
      action: 'workbench.status.updated',
      reason: 'owner-status-edit',
      object: { type: 'workbench-status', id: 'status-safe', version: sequence },
      causationId: `causation-${sequence}`,
      commandId: `command-${sequence}`,
      summaryCode: 'status-revision-committed',
      hash: `hash-${sequence}`,
      previousHash: sequence === 1 ? '' : `hash-${sequence - 1}`,
      outbox: {
        id: `outbox-${sequence}`,
        state: 'pending',
        attemptCount: 0,
        updatedAt: '2026-08-31T12:00:00.000Z',
        errorCode: null,
      },
    }],
    nextBeforeSequence,
    integrity: integrity(eventCount),
  }
}

function integrity(eventCount = 1): WorkbenchAuditIntegrityProjection {
  return {
    valid: true,
    eventCount,
    headHash: `head-${eventCount}`,
    issue: null,
  }
}

function remote(overrides: Partial<WorkbenchActivityRemote> = {}): WorkbenchActivityRemote {
  return {
    activity: overrides.activity ?? vi.fn(() => Promise.resolve(ok(activity()))),
  }
}

describe('WorkbenchActivityController', () => {
  it('accepts Activity and integrity from one snapshot, then publishes one detached ready page', async () => {
    const activityRequest = deferred<RemoteResult<WorkbenchActivityProjection>>()
    const sourceActivity = activity()
    const api = remote({
      activity: vi.fn(() => activityRequest.promise),
    })
    const controller = new WorkbenchActivityController(api)

    const refresh = controller.refresh()
    await Promise.resolve()
    expect(api.activity).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })

    activityRequest.resolve(ok(sourceActivity))
    await refresh

    const state = controller.getSnapshot()
    expect(state).toMatchObject({
      phase: 'ready',
      activity: sourceActivity,
      integrity: sourceActivity.integrity,
      issue: null,
    })
    expect(state.activity).not.toBe(sourceActivity)
    expect(state.activity?.items[0]).not.toBe(sourceActivity.items[0])
    expect(state.integrity).not.toBe(sourceActivity.integrity)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.activity?.items)).toBe(true)
    expect(Object.isFrozen(state.activity?.items[0]?.outbox)).toBe(true)
  })

  it('aborts a superseded filter generation and ignores its late result', async () => {
    const firstActivity = deferred<RemoteResult<WorkbenchActivityProjection>>()
    const secondActivity = deferred<RemoteResult<WorkbenchActivityProjection>>()
    const activityCalls: Array<{
      filter: WorkbenchActivityFilter
      signal: AbortSignal | undefined
    }> = []
    const api = remote({
      activity: vi.fn((filter, signal) => {
        activityCalls.push({ filter, signal })
        return activityCalls.length === 1 ? firstActivity.promise : secondActivity.promise
      }),
    })
    const controller = new WorkbenchActivityController(api)

    const first = controller.setFilter({ projectId: 'project-one' })
    await Promise.resolve()
    const second = controller.setFilter({
      projectId: 'project-two',
      objectType: 'workbench-status',
      action: 'workbench.status.updated',
    })
    await Promise.resolve()

    expect(activityCalls[0]?.signal?.aborted).toBe(true)
    expect(activityCalls[1]?.filter).toEqual({
      projectId: 'project-two',
      objectType: 'workbench-status',
      action: 'workbench.status.updated',
    })

    secondActivity.resolve(ok(activity(2, 'project-two')))
    await second
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      filter: { projectId: 'project-two' },
      activity: { items: [{ projectId: 'project-two', sequence: 2 }] },
    })

    firstActivity.resolve(ok(activity(1, 'project-one')))
    await first
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      activity: { items: [{ projectId: 'project-two', sequence: 2 }] },
    })
  })

  it('retains the last whole page on failure without publishing Remote messages', async () => {
    const onTransportFailure = vi.fn()
    const api = remote({
      activity: vi.fn()
        .mockResolvedValueOnce(ok(activity()))
        .mockResolvedValueOnce({
          ok: false,
          error: {
            code: 'unavailable',
            message: 'secret adapter diagnostic',
            details: { payload: 'must-not-enter-state' },
          },
        }),
    })
    const controller = new WorkbenchActivityController(api, { onTransportFailure })
    await controller.refresh()

    await controller.refresh()
    const state = controller.getSnapshot()
    expect(state.phase).toBe('error')
    expect(state.activity?.items).toHaveLength(1)
    expect(state.integrity?.valid).toBe(true)
    expect(state.issue).toEqual({ kind: 'transport', code: 'unavailable' })
    expect(JSON.stringify(state)).not.toMatch(/secret|payload|diagnostic/u)
    expect(onTransportFailure).toHaveBeenCalledOnce()
  })

  it('clears a prior filter page on bad-request without re-probing transport', async () => {
    const onTransportFailure = vi.fn()
    const api = remote({
      activity: vi.fn()
        .mockResolvedValueOnce(ok(activity(1, 'project-one')))
        .mockResolvedValueOnce({
          ok: false,
          error: {
            code: 'bad-request',
            message: 'secret validation diagnostic',
            details: { objectId: 'must-not-enter-state' },
          },
        }),
    })
    const controller = new WorkbenchActivityController(api, { onTransportFailure })
    await controller.setFilter({ projectId: 'project-one' })

    await controller.setFilter({ projectId: 'project-two' })
    const state = controller.getSnapshot()
    expect(state).toMatchObject({
      phase: 'error',
      filter: { projectId: 'project-two' },
      activity: null,
      integrity: null,
      issue: { kind: 'input', code: 'bad-request' },
    })
    expect(JSON.stringify(state)).not.toMatch(/secret|diagnostic|must-not-enter-state/u)
    expect(onTransportFailure).not.toHaveBeenCalled()
  })

  it('passes the exclusive cursor and appends a detached next page', async () => {
    const activityRemote = vi.fn()
      .mockResolvedValueOnce(ok(activity(2, 'project-safe', 2, 2)))
      .mockResolvedValueOnce(ok(activity(1, 'project-safe', null, 2)))
    const controller = new WorkbenchActivityController(remote({ activity: activityRemote }))
    await controller.setFilter({ projectId: 'project-safe', limit: 1 })

    await controller.loadMore()
    expect(activityRemote).toHaveBeenCalledTimes(2)
    expect(activityRemote.mock.calls[1]?.[0]).toEqual({
      projectId: 'project-safe',
      limit: 1,
      beforeSequence: 2,
    })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      loadingMore: false,
      activity: {
        items: [{ sequence: 2 }, { sequence: 1 }],
        nextBeforeSequence: null,
      },
      integrity: { valid: true, eventCount: 2 },
    })
  })

  it('fails admission closed and marks accepted state stale on disconnect', async () => {
    const allow = vi.fn(() => true)
    const api = remote()
    const controller = new WorkbenchActivityController(api, {
      onBeforeProtectedOperation: allow,
    })
    await controller.refresh()
    controller.markDisconnected()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stale',
      activity: { items: [{ sequence: 1 }] },
      issue: null,
    })

    const deniedApi = remote()
    const denied = new WorkbenchActivityController(deniedApi, {
      onBeforeProtectedOperation: () => false,
    })
    await denied.refresh()
    expect(deniedApi.activity).not.toHaveBeenCalled()
  })

  it('aborts and drains the snapshot Remote read during idempotent disposal', async () => {
    const activityRequest = deferred<RemoteResult<WorkbenchActivityProjection>>()
    let activitySignal: AbortSignal | undefined
    const controller = new WorkbenchActivityController(remote({
      activity: vi.fn((_filter, signal) => {
        activitySignal = signal
        return activityRequest.promise
      }),
    }))
    let observations = 0
    controller.subscribe(() => { observations += 1 })

    const refresh = controller.refresh()
    await Promise.resolve()
    const disposal = controller.dispose()
    expect(activitySignal?.aborted).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })

    activityRequest.resolve(ok(activity()))
    await Promise.all([refresh, disposal, controller.dispose()])
    expect(controller.getSnapshot().activity).toBeNull()
    expect(observations).toBe(1)
  })
})
