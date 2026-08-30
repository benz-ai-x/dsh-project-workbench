import type {
  InitializeOwnerResult,
  LoginOwnerResult,
  OwnerAccessProjection,
  OwnerAuthResponse,
  WorkbenchActivityProjection,
  WorkbenchStatusSnapshot,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { OwnerAuthHttp } from '../src/client/auth-http.ts'
import type { WorkbenchRemote } from '../src/client/controller.ts'
import { OwnerController } from '../src/client/owner-controller.ts'

function fakeClock(initial: string) {
  let current = Date.parse(initial)
  let nextId = 1
  const scheduled = new Map<ReturnType<typeof setTimeout>, {
    readonly at: number
    readonly callback: () => void
  }>()
  const options = {
    now: () => current,
    schedule: (callback: () => void, delayMs: number) => {
      const id = nextId++ as unknown as ReturnType<typeof setTimeout>
      scheduled.set(id, { at: current + delayMs, callback })
      return id
    },
    cancelScheduled: (id: ReturnType<typeof setTimeout>) => { scheduled.delete(id) },
  }
  return {
    options,
    set(value: string) { current = Date.parse(value) },
    advanceTo(value: string) {
      current = Date.parse(value)
      for (;;) {
        const due = [...scheduled.entries()]
          .filter(([, timer]) => timer.at <= current)
          .sort((left, right) => left[1].at - right[1].at)[0]
        if (due === undefined) return
        scheduled.delete(due[0])
        due[1].callback()
      }
    },
    count: () => scheduled.size,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function access(expires = '2099-09-01T00:00:00.000Z'):
Extract<OwnerAccessProjection, { readonly state: 'signed-in' }> {
  return {
    state: 'signed-in',
    ownerId: 'owner-1',
    organizationId: 'organization-1',
    teamId: 'team-1',
    sessionExpiresAt: expires,
  }
}

function snapshot(revision = 1, message = 'protected status'): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message,
    revision,
    updatedAt: `2026-08-31T0${revision}:00:00.000Z`,
  }
}

function authOk<T>(value: T): OwnerAuthResponse<T> {
  return { ok: true, value }
}

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function activityProjection(): WorkbenchActivityProjection {
  return {
    items: [],
    nextBeforeSequence: null,
    integrity: {
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    },
  }
}

function auth(overrides: Partial<OwnerAuthHttp> = {}): OwnerAuthHttp {
  return {
    state: overrides.state ?? vi.fn(() => Promise.resolve(authOk({ state: 'signed-out' }))),
    initialize: overrides.initialize ?? vi.fn(() => Promise.resolve({
      ok: false,
      error: { code: 'unavailable' },
    })),
    login: overrides.login ?? vi.fn(() => Promise.resolve({
      ok: false,
      error: { code: 'invalid-credentials' },
    })),
    logout: overrides.logout ?? vi.fn(() => Promise.resolve(authOk({ state: 'signed-out' }))),
  }
}

function remote(overrides: Partial<WorkbenchRemote> = {}): WorkbenchRemote {
  return {
    snapshot: overrides.snapshot ?? vi.fn(() => Promise.resolve(remoteOk(snapshot()))),
    setStatus: overrides.setStatus ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: snapshot(2),
      receipt: {
        commandId: 'command-test',
        auditEventId: 'audit-test',
        outboxId: 'outbox-test',
      },
    }))),
    activity: overrides.activity ?? vi.fn(() => Promise.resolve(remoteOk(activityProjection()))),
    auditIntegrity: overrides.auditIntegrity ?? vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    }))),
  }
}

describe('OwnerController', () => {
  it('probes auth first and never creates or calls protected controllers while setup is required', async () => {
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const auditIntegrity = vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    })))
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk({ state: 'setup-required' }))),
    }), remote({ snapshot: snapshotRemote, activity: activityRemote, auditIntegrity }))

    expect(controller.getSnapshot()).toMatchObject({ phase: 'probing', status: null })
    await controller.start()
    expect(controller.getSnapshot()).toEqual({
      phase: 'setup',
      access: { state: 'setup-required' },
      status: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    expect(snapshotRemote).not.toHaveBeenCalled()
    expect(activityRemote).not.toHaveBeenCalled()
    expect(auditIntegrity).not.toHaveBeenCalled()
  })

  it('checks confirmation, locks setup, and withholds status until recovery acknowledgement', async () => {
    const setup = deferred<OwnerAuthResponse<InitializeOwnerResult>>()
    const initialize = vi.fn(() => setup.promise)
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const auditIntegrity = vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    })))
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk({ state: 'setup-required' }))),
      initialize,
    }), remote({ snapshot: snapshotRemote, activity: activityRemote, auditIntegrity }))
    await controller.start()

    await controller.initialize('one', 'two')
    expect(initialize).not.toHaveBeenCalled()
    expect(controller.getSnapshot().issue).toEqual({
      operation: 'initialize',
      code: 'password-mismatch',
    })

    const first = controller.initialize('secret', 'secret')
    const duplicate = controller.initialize('secret', 'secret')
    expect(controller.getSnapshot().phase).toBe('setup-pending')
    expect(initialize).toHaveBeenCalledOnce()
    setup.resolve(authOk({
      access: access(),
      recoveryCode: 'WB1-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
    }))
    await Promise.all([first, duplicate])

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'recovery',
      access: access(),
      status: null,
      activity: null,
      recoveryCode: 'WB1-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
    })
    expect(snapshotRemote).not.toHaveBeenCalled()
    expect(activityRemote).not.toHaveBeenCalled()
    expect(auditIntegrity).not.toHaveBeenCalled()

    await controller.acknowledgeRecovery()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'authenticated',
      recoveryCode: null,
      status: expect.anything(),
      activity: expect.anything(),
    })
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(activityRemote).toHaveBeenCalledOnce()
    expect(auditIntegrity).not.toHaveBeenCalled()
  })

  it('keeps login errors safe, locks duplicate work, then opens status after success', async () => {
    const successful = deferred<OwnerAuthResponse<LoginOwnerResult>>()
    const login = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid-credentials' },
      } satisfies OwnerAuthResponse<LoginOwnerResult>)
      .mockImplementationOnce(() => successful.promise)
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const controller = new OwnerController(auth({ login }), remote({ snapshot: snapshotRemote }))
    await controller.start()

    await controller.login('wrong')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'login',
      status: null,
      issue: { operation: 'login', code: 'invalid-credentials' },
    })
    expect(controller.getSnapshot().issue).not.toHaveProperty('message')
    expect(snapshotRemote).not.toHaveBeenCalled()

    const first = controller.login('correct')
    const duplicate = controller.login('correct')
    expect(controller.getSnapshot().phase).toBe('login-pending')
    expect(login).toHaveBeenCalledTimes(2)
    successful.resolve(authOk({ access: access() }))
    await Promise.all([first, duplicate])

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'authenticated',
      status: expect.anything(),
      activity: expect.anything(),
      issue: null,
    })
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })

  it('creates Activity after authentication and refreshes it after a committed status command', async () => {
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const auditIntegrity = vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    })))
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access()))),
    }), remote({ activity: activityRemote, auditIntegrity }))

    await controller.start()
    const statusController = controller.getSnapshot().status
    const activityController = controller.getSnapshot().activity
    expect(activityController?.getSnapshot()).toMatchObject({
      phase: 'ready',
      activity: {
        items: [],
        nextBeforeSequence: null,
        integrity: { valid: true, eventCount: 0, issue: null },
      },
      integrity: { valid: true, eventCount: 0, issue: null },
      loadingMore: false,
    })
    expect(activityRemote).toHaveBeenCalledOnce()
    expect(auditIntegrity).not.toHaveBeenCalled()

    statusController?.setDraft('committed status')
    await statusController?.save()
    await vi.waitFor(() => {
      expect(activityRemote).toHaveBeenCalledTimes(2)
    })
    expect(auditIntegrity).not.toHaveBeenCalled()
    expect(controller.getSnapshot().activity).toBe(activityController)

    await controller.dispose()
  })

  it('erases the protected snapshot and draft after confirmed logout', async () => {
    const logout = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access()))),
      logout: vi.fn(() => logout.promise),
    }), remote())
    await controller.start()
    const status = controller.getSnapshot().status
    const activity = controller.getSnapshot().activity
    expect(status).not.toBeNull()
    expect(activity?.getSnapshot().phase).toBe('ready')
    status?.setDraft('sensitive unsaved draft')

    const leaving = controller.logout()
    expect(controller.getSnapshot().phase).toBe('logout-pending')
    expect(status?.getSnapshot()).toMatchObject({
      phase: 'stale',
      draft: 'sensitive unsaved draft',
    })
    expect(activity?.getSnapshot().phase).toBe('stale')
    logout.resolve(authOk({ state: 'signed-out' }))
    await leaving

    expect(controller.getSnapshot()).toEqual({
      phase: 'login',
      access: { state: 'signed-out' },
      status: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    expect(status?.getSnapshot()).toMatchObject({
      phase: 'loading',
      snapshot: null,
      draft: '',
      draftDirty: false,
    })
    expect(activity?.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })
  })

  it('fails closed at the projected session deadline and synchronously erases status memory', async () => {
    const clock = fakeClock('2026-08-31T00:00:00.000Z')
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access('2026-08-31T00:00:01.000Z')))),
    }), remote(), clock.options)
    await controller.start()
    const status = controller.getSnapshot().status
    const activity = controller.getSnapshot().activity
    status?.setDraft('deadline-sensitive draft')

    clock.advanceTo('2026-08-31T00:00:01.000Z')

    expect(controller.getSnapshot()).toEqual({
      phase: 'login',
      access: { state: 'signed-out' },
      status: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    expect(status?.getSnapshot()).toMatchObject({
      phase: 'loading',
      snapshot: null,
      draft: '',
      draftDirty: false,
    })
    expect(activity?.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })
    expect(clock.count()).toBe(0)
  })

  it('rechecks before every retained status operation when a background timer has not fired', async () => {
    const clock = fakeClock('2026-08-31T00:00:00.000Z')
    const setStatus = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: snapshot(2),
      receipt: {
        commandId: 'command-expired',
        auditEventId: 'audit-expired',
        outboxId: 'outbox-expired',
      },
    })))
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access('2026-08-31T00:00:01.000Z')))),
    }), remote({ setStatus }), clock.options)
    await controller.start()
    const retained = controller.getSnapshot().status
    retained?.setDraft('must disappear')

    clock.set('2026-08-31T00:00:02.000Z')
    retained?.setDraft('must never publish')
    await retained?.save()

    expect(controller.getSnapshot()).toMatchObject({ phase: 'login', status: null })
    expect(retained?.getSnapshot()).toMatchObject({ snapshot: null, draft: '' })
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('clears an unacknowledged recovery secret when its projected session expires', async () => {
    const clock = fakeClock('2026-08-31T00:00:00.000Z')
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk({ state: 'setup-required' }))),
      initialize: vi.fn(() => Promise.resolve(authOk({
        access: access('2026-08-31T00:00:01.000Z'),
        recoveryCode: 'WB1-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
      }))),
    }), remote(), clock.options)
    await controller.start()
    await controller.initialize('secret', 'secret')
    expect(controller.getSnapshot().phase).toBe('recovery')

    clock.advanceTo('2026-08-31T00:00:01.000Z')

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'login',
      access: { state: 'signed-out' },
      recoveryCode: null,
    })
  })

  it('re-probes before reconnect refresh and preserves a same-Owner draft', async () => {
    const order: string[] = []
    const state = vi.fn(() => {
      order.push('auth')
      return Promise.resolve(authOk(access()))
    })
    const snapshotRemote = vi.fn(() => {
      order.push('status')
      return Promise.resolve(remoteOk(snapshot()))
    })
    const controller = new OwnerController(auth({ state }), remote({ snapshot: snapshotRemote }))
    await controller.start()
    const status = controller.getSnapshot().status
    status?.setDraft('recoverable draft')
    order.length = 0

    controller.markDisconnected()
    await controller.connectionReset()

    expect(order).toEqual(['auth', 'status'])
    expect(controller.getSnapshot()).toMatchObject({ phase: 'authenticated', access: access() })
    expect(status?.getSnapshot()).toMatchObject({
      phase: 'value',
      draft: 'recoverable draft',
      draftDirty: true,
    })
  })

  it('denies retained protected controllers while an auth probe is pending', async () => {
    const probe = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const state = vi.fn()
      .mockResolvedValueOnce(authOk(access()))
      .mockImplementationOnce(() => probe.promise)
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const setStatus = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: snapshot(2),
      receipt: {
        commandId: 'command-probe-denied',
        auditEventId: 'audit-probe-denied',
        outboxId: 'outbox-probe-denied',
      },
    })))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const controller = new OwnerController(
      auth({ state }),
      remote({ snapshot: snapshotRemote, setStatus, activity: activityRemote }),
    )
    await controller.start()
    const status = controller.getSnapshot().status
    const activity = controller.getSnapshot().activity
    status?.setDraft('must not submit during probe')

    const probing = controller.start()
    expect(controller.getSnapshot().phase).toBe('probing')
    await Promise.all([
      status?.refresh(),
      status?.save(),
      activity?.refresh(),
      activity?.setFilter({ objectId: 'status-probe-denied' }),
    ])

    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(activityRemote).toHaveBeenCalledOnce()
    expect(setStatus).not.toHaveBeenCalled()

    probe.resolve(authOk(access()))
    await probing
    await controller.dispose()
  })

  it('denies retained protected controllers while logout is pending', async () => {
    const logout = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const setStatus = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: snapshot(2),
      receipt: {
        commandId: 'command-logout-denied',
        auditEventId: 'audit-logout-denied',
        outboxId: 'outbox-logout-denied',
      },
    })))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access()))),
      logout: vi.fn(() => logout.promise),
    }), remote({ snapshot: snapshotRemote, setStatus, activity: activityRemote }))
    await controller.start()
    const status = controller.getSnapshot().status
    const activity = controller.getSnapshot().activity
    status?.setDraft('draft before logout')

    const leaving = controller.logout()
    expect(controller.getSnapshot().phase).toBe('logout-pending')
    const staleDraft = status?.getSnapshot().draft
    status?.setDraft('must not enter a retained controller')
    await Promise.all([
      status?.refresh(),
      status?.connectionReset(),
      status?.save(),
      activity?.refresh(),
      activity?.setFilter({ objectId: 'status-logout-denied' }),
    ])

    expect(status?.getSnapshot().draft).toBe(staleDraft)
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(activityRemote).toHaveBeenCalledOnce()
    expect(setStatus).not.toHaveBeenCalled()

    logout.resolve(authOk({ state: 'signed-out' }))
    await leaving
  })

  it('erases protected state when a reconnect probe confirms auth loss without another status call', async () => {
    const state = vi.fn()
      .mockResolvedValueOnce(authOk(access()))
      .mockResolvedValueOnce(authOk({ state: 'signed-out' }))
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const controller = new OwnerController(auth({ state }), remote({ snapshot: snapshotRemote }))
    await controller.start()
    const status = controller.getSnapshot().status
    status?.setDraft('must be erased')

    controller.markDisconnected()
    await controller.connectionReset()

    expect(controller.getSnapshot()).toMatchObject({ phase: 'login', status: null })
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(status?.getSnapshot()).toMatchObject({ snapshot: null, draft: '' })
  })

  it('re-probes after a protected carrier failure and closes on confirmed session expiry', async () => {
    const state = vi.fn()
      .mockResolvedValueOnce(authOk(access()))
      .mockResolvedValueOnce(authOk({ state: 'signed-out' }))
    const snapshotRemote = vi.fn(() => Promise.resolve({
      ok: false,
      error: { code: 'internal', message: 'HTTP 401', details: {} },
    } as const))
    const controller = new OwnerController(auth({ state }), remote({ snapshot: snapshotRemote }))

    await controller.start()
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('login') })

    expect(state).toHaveBeenCalledTimes(2)
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().status).toBeNull()
  })

  it('aborts superseded probes and rejects every late generation', async () => {
    const first = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const second = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    let firstSignal: AbortSignal | undefined
    const state = vi.fn()
      .mockImplementationOnce(signal => {
        firstSignal = signal
        return first.promise
      })
      .mockImplementationOnce(() => second.promise)
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(snapshot())))
    const controller = new OwnerController(auth({ state }), remote({ snapshot: snapshotRemote }))

    const oldProbe = controller.start()
    const currentProbe = controller.connectionReset()
    expect(firstSignal?.aborted).toBe(true)
    second.resolve(authOk({ state: 'signed-out' }))
    await currentProbe
    first.resolve(authOk(access()))
    await oldProbe

    expect(controller.getSnapshot()).toMatchObject({ phase: 'login', status: null })
    expect(snapshotRemote).not.toHaveBeenCalled()
  })

  it('aborts and drains auth work while synchronously erasing memory on disposal', async () => {
    let signal: AbortSignal | undefined
    const state = vi.fn((currentSignal?: AbortSignal) => new Promise<OwnerAuthResponse<OwnerAccessProjection>>(
      (_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => { reject(currentSignal.reason) }, { once: true })
      },
    ))
    const controller = new OwnerController(auth({ state }), remote())
    const probing = controller.start()

    const disposal = controller.dispose()
    expect(signal?.aborted).toBe(true)
    expect(controller.getSnapshot()).toEqual({
      phase: 'probing',
      access: null,
      status: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    await Promise.all([probing, disposal])
  })

  it('synchronously erases and disposes Activity after authenticated Owner disposal', async () => {
    const controller = new OwnerController(auth({
      state: vi.fn(() => Promise.resolve(authOk(access()))),
    }), remote())
    await controller.start()
    const activity = controller.getSnapshot().activity
    expect(activity?.getSnapshot().phase).toBe('ready')

    const disposal = controller.dispose()
    expect(controller.getSnapshot()).toEqual({
      phase: 'probing',
      access: null,
      status: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    expect(activity?.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })
    await disposal
  })
})
