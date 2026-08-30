import type {
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from '@benz-ai-x/dsh-project-workbench/client'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { WorkbenchStatusController, type WorkbenchRemote } from '../src/client/controller.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function snapshot(revision: number, message = `status-${revision}`): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message,
    revision,
    updatedAt: `2026-08-31T0${revision}:00:00.000Z`,
  }
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function remote(options: Partial<WorkbenchRemote> = {}): WorkbenchRemote {
  return {
    snapshot: options.snapshot ?? vi.fn(() => Promise.resolve(ok(null))),
    setStatus: options.setStatus ?? vi.fn(() => Promise.resolve(ok({
      ok: true,
      value: snapshot(1),
    } satisfies SetStatusResult))),
  }
}

describe('WorkbenchStatusController', () => {
  it('replaces loading with whole empty/value snapshots without a Client-side domain fold', async () => {
    const snapshots = vi.fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(snapshot(1, 'Host truth')))
    const controller = new WorkbenchStatusController(remote({ snapshot: snapshots }))

    expect(controller.getSnapshot()).toMatchObject({ phase: 'loading', snapshot: null })
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'empty', snapshot: null, draft: '' })
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'value',
      snapshot: snapshot(1, 'Host truth'),
      draft: 'Host truth',
      draftDirty: false,
    })
  })

  it('locks duplicate submissions synchronously and publishes the committed snapshot', async () => {
    const pending = deferred<RemoteResult<SetStatusResult>>()
    const setStatus = vi.fn(() => pending.promise)
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(2, 'before')))),
      setStatus,
    }))
    await controller.refresh()
    controller.setDraft('  after  ')

    const first = controller.save()
    const duplicate = controller.save()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'pending', pending: true, draft: '  after  ' })
    expect(setStatus).toHaveBeenCalledOnce()
    expect(setStatus.mock.calls[0]?.[0]).toEqual({ message: 'after', expectedRevision: 2 })
    expect(setStatus.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)

    pending.resolve(ok({ ok: true, value: snapshot(3, 'after') }))
    await Promise.all([first, duplicate])
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'value',
      pending: false,
      snapshot: snapshot(3, 'after'),
      draft: 'after',
      draftDirty: false,
    })
  })

  it('keeps domain conflict distinct, preserves the draft, and retries against the latest revision', async () => {
    const setStatus = vi.fn()
      .mockResolvedValueOnce(ok({
        ok: false,
        error: {
          code: 'revision-conflict',
          message: 'stale revision',
          current: snapshot(5, 'another writer'),
        },
      } satisfies SetStatusResult))
      .mockResolvedValueOnce(ok({ ok: true, value: snapshot(6, 'my draft') } satisfies SetStatusResult))
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(4, 'old')))),
      setStatus,
    }))
    await controller.refresh()
    controller.setDraft('my draft')

    await controller.save()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      snapshot: snapshot(5, 'another writer'),
      draft: 'my draft',
      draftDirty: true,
      pending: false,
      issue: { kind: 'conflict', code: 'revision-conflict' },
    })

    controller.resetDraft()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'value',
      draft: 'another writer',
      draftDirty: false,
      issue: null,
    })
    controller.setDraft('my draft')

    await controller.save()
    expect(setStatus.mock.calls[1]?.[0]).toEqual({ message: 'my draft', expectedRevision: 5 })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'value', snapshot: snapshot(6, 'my draft') })
  })

  it('keeps a recoverable draft and last value on transport failure', async () => {
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(1, 'synced')))),
      setStatus: vi.fn(() => Promise.resolve({
        ok: false,
        error: { code: 'unavailable', message: 'offline', details: {} },
      })),
    }))
    await controller.refresh()
    controller.setDraft('unsaved work')
    await controller.save()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      snapshot: snapshot(1, 'synced'),
      draft: 'unsaved work',
      draftDirty: true,
      issue: { kind: 'transport', code: 'unavailable', message: 'offline' },
    })
  })

  it('keeps Host validation distinct from a transport outage without exposing details', async () => {
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(1, 'synced')))),
      setStatus: vi.fn(() => Promise.resolve({
        ok: false,
        error: {
          code: 'bad-request',
          message: 'internal validation detail',
          details: { maxStatusLength: 2 },
        },
      })),
    }))
    await controller.refresh()
    controller.setDraft('too long')
    await controller.save()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      draft: 'too long',
      draftDirty: true,
      pending: false,
      issue: { kind: 'input', code: 'bad-request' },
    })
    expect(controller.getSnapshot().issue).not.toHaveProperty('message')
  })

  it('keeps the last value stale across connection reset, then replaces it from the new generation', async () => {
    const next = deferred<RemoteResult<WorkbenchStatusSnapshot | null>>()
    const snapshots = vi.fn()
      .mockResolvedValueOnce(ok(snapshot(1, 'old generation')))
      .mockImplementationOnce(() => next.promise)
    const controller = new WorkbenchStatusController(remote({ snapshot: snapshots }))
    await controller.refresh()

    const resetting = controller.connectionReset()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stale',
      snapshot: snapshot(1, 'old generation'),
      draft: 'old generation',
    })
    next.resolve(ok(snapshot(2, 'new generation')))
    await resetting
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'value',
      snapshot: snapshot(2, 'new generation'),
      draft: 'new generation',
    })
  })

  it('aborts owned mutation work and ignores every late completion after disposal', async () => {
    const mutation = deferred<RemoteResult<SetStatusResult>>()
    let signal: AbortSignal | undefined
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(1, 'before')))),
      setStatus: vi.fn((_request, currentSignal) => {
        signal = currentSignal
        return mutation.promise
      }),
    }))
    await controller.refresh()
    controller.setDraft('late')
    const saving = controller.save()
    const beforeDispose = controller.getSnapshot()
    const observer = vi.fn()
    controller.subscribe(observer)

    const disposal = controller.dispose()
    expect(signal?.aborted).toBe(true)
    mutation.resolve(ok({ ok: true, value: snapshot(2, 'late') }))
    await Promise.all([saving, disposal])
    expect(controller.getSnapshot()).toBe(beforeDispose)
    expect(observer).not.toHaveBeenCalled()
  })

  it('aborts and drains an owned snapshot before disposal completes', async () => {
    let signal: AbortSignal | undefined
    let requestSettled = false
    const controller = new WorkbenchStatusController(remote({
      snapshot: vi.fn(currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          requestSettled = true
          reject(currentSignal.reason)
        }, { once: true })
      })),
    }))
    const refreshing = controller.refresh()

    const disposal = controller.dispose()
    expect(signal?.aborted).toBe(true)
    await disposal

    expect(requestSettled).toBe(true)
    await expect(refreshing).resolves.toBeUndefined()
  })

  it('resets drafts on authoritative entity replacement but preserves them across same-entity refresh', async () => {
    const replacement = { ...snapshot(3, 'replacement'), id: 'status-2' }
    const snapshots = vi.fn()
      .mockResolvedValueOnce(ok(snapshot(1, 'initial')))
      .mockResolvedValueOnce(ok(snapshot(2, 'same entity changed')))
      .mockResolvedValueOnce(ok(replacement))
    const controller = new WorkbenchStatusController(remote({ snapshot: snapshots }))
    await controller.refresh()
    controller.setDraft('recoverable draft')

    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ draft: 'recoverable draft', draftDirty: true })
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ draft: 'replacement', draftDirty: false, snapshot: replacement })
  })
})
