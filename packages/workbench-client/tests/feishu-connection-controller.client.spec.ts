import type {
  ConfigureFeishuIdentityRouteResult,
  FeishuConnectionCenterProjection,
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  VerifyFeishuIdentityRouteResult,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_FEISHU_APP_ID_LENGTH,
  MAX_FEISHU_CREDENTIAL_REF_LENGTH,
  MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH,
  WorkbenchFeishuConnectionController,
  validCredentialRef,
  validFeishuAppId,
  validTaskListResourceId,
  type WorkbenchFeishuConnectionRemote,
} from '../src/client/feishu-connection-controller.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function receipt(suffix = '1') {
  return {
    commandId: `command-${suffix}`,
    auditEventId: `audit-${suffix}`,
    outboxId: `outbox-${suffix}`,
  }
}

function route(
  kind: FeishuIdentityKind,
  options: {
    readonly state?: FeishuIdentityRouteProjection['state']
    readonly generation?: number | null
    readonly appId?: string | null
    readonly credentialRef?: string | null
  } = {},
): FeishuIdentityRouteProjection {
  const state = options.state ?? 'configured'
  const generation = options.generation === undefined ? 1 : options.generation
  const appId = options.appId === undefined ? `cli_${kind}` : options.appId
  const credentialRef = options.credentialRef === undefined
    ? kind === 'bot' ? 'FEISHU_APP_SECRET' : 'FEISHU_USER_ACCESS_TOKEN'
    : options.credentialRef
  const configured = state === 'configured'
  return {
    kind,
    state,
    generation,
    appId,
    credential: {
      ref: credentialRef,
      configured,
      source: configured ? 'file' : null,
      writable: configured,
    },
    actor: configured && generation !== null && appId !== null
      ? {
          connectionId: 'feishu-primary',
          realm: 'feishu-cn',
          appId,
          kind,
          routeGeneration: generation,
          openId: `ou_${kind}`,
          tenantKey: 'tenant-1',
        }
      : null,
    displayLabel: configured ? `${kind} actor` : null,
    lastVerification: configured && generation !== null
      ? {
          verificationId: `${kind}-verification-1`,
          sequence: 1,
          routeGeneration: generation,
          checkedAt: '2026-08-31T01:00:00.000Z',
          result: 'healthy',
          identity: { state: 'verified', issue: null },
          scopeInspection: {
            state: 'observed',
            scopes: [{
              scope: 'task:tasklist:read',
              tokenType: kind === 'bot' ? 'tenant' : 'user',
              state: 'verified',
            }],
            issue: null,
          },
          resourceProbe: { state: 'not-tested' },
        }
      : null,
  }
}

function center(
  revision = 2,
  overrides: Partial<Pick<FeishuConnectionCenterProjection, 'bot' | 'user'>> = {},
): FeishuConnectionCenterProjection {
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision,
    bot: overrides.bot ?? route('bot'),
    user: overrides.user ?? route('user'),
    updatedAt: '2026-08-31T02:00:00.000Z',
  }
}

function configureSuccess(
  kind: FeishuIdentityKind,
  revision = 3,
  generation = 2,
): Extract<ConfigureFeishuIdentityRouteResult, { readonly ok: true }> {
  return {
    ok: true,
    value: {
      connectionId: 'feishu-primary',
      connectionRevision: revision,
      kind,
      routeGeneration: generation,
      state: 'configured',
    },
    receipt: receipt(`${kind}-${revision}`),
  }
}

function verifySuccess(
  kind: FeishuIdentityKind,
): Extract<VerifyFeishuIdentityRouteResult, { readonly ok: true }> {
  return {
    ok: true,
    value: {
      connectionId: 'feishu-primary',
      connectionRevision: 3,
      kind,
      routeGeneration: 1,
      verificationSequence: 2,
      result: 'healthy',
    },
    receipt: receipt(`${kind}-verify`),
  }
}

function remote(overrides: Partial<WorkbenchFeishuConnectionRemote> = {})
  : WorkbenchFeishuConnectionRemote {
  return {
    feishuConnectionCenter: overrides.feishuConnectionCenter
      ?? vi.fn(() => Promise.resolve(ok(center()))),
    configureFeishuIdentityRoute: overrides.configureFeishuIdentityRoute
      ?? vi.fn(request => Promise.resolve(ok(configureSuccess(request.kind)))),
    verifyFeishuIdentityRoute: overrides.verifyFeishuIdentityRoute
      ?? vi.fn(request => Promise.resolve(ok(verifySuccess(request.kind)))),
  }
}

describe('WorkbenchFeishuConnectionController', () => {
  it('publishes a detached whole center and seeds independent Bot/User drafts', async () => {
    const source = center()
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn(() => Promise.resolve(ok(source))),
    }))

    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      center: {
        revision: 2,
        bot: { kind: 'bot', actor: { openId: 'ou_bot' } },
        user: { kind: 'user', actor: { openId: 'ou_user' } },
      },
      drafts: {
        bot: { appId: 'cli_bot', credentialRef: 'FEISHU_APP_SECRET' },
        user: { appId: 'cli_user', credentialRef: 'FEISHU_USER_ACCESS_TOKEN' },
      },
    })
    expect(controller.getSnapshot().center).not.toBe(source)
    expect(controller.getSnapshot().center?.bot).not.toBe(source.bot)
    expect(controller.getSnapshot().center?.bot.lastVerification?.scopeInspection.scopes)
      .not.toBe(source.bot.lastVerification?.scopeInspection.scopes)
  })

  it('configures only the selected Bot route with its exact CAS fence and reference metadata', async () => {
    const initial = center()
    const committed = center(3, {
      bot: route('bot', {
        generation: 2,
        appId: 'cli_bot_next',
        credentialRef: 'FEISHU_APP_SECRET_NEXT',
      }),
    })
    const read = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(committed))
    const configure = vi.fn(() => Promise.resolve(ok(configureSuccess('bot'))))
    const verify = vi.fn(() => Promise.resolve(ok(verifySuccess('user'))))
    const onCommitted = vi.fn()
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('idempotency-bot-configure')
      .mockReturnValueOnce('causation-bot-configure')
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: read,
      configureFeishuIdentityRoute: configure,
      verifyFeishuIdentityRoute: verify,
    }), { nextCommandKey, onCommitted })
    await controller.refresh()

    controller.setAppId('bot', '  cli_bot_next  ')
    controller.setCredentialRef('bot', '  FEISHU_APP_SECRET_NEXT  ')
    await controller.configure('bot')

    expect(configure).toHaveBeenCalledOnce()
    expect(configure).toHaveBeenCalledWith({
      mode: 'set',
      kind: 'bot',
      appId: 'cli_bot_next',
      credentialRef: 'FEISHU_APP_SECRET_NEXT',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      idempotencyKey: 'idempotency-bot-configure',
      causationId: 'causation-bot-configure',
      reason: 'owner-feishu-route-configure',
    }, expect.any(AbortSignal))
    expect(verify).not.toHaveBeenCalled()
    expect(controller.getSnapshot().center?.bot).toMatchObject({
      appId: 'cli_bot_next', generation: 2,
    })
    expect(controller.getSnapshot().center?.user.actor?.openId).toBe('ou_user')
    expect(onCommitted).toHaveBeenCalledWith(receipt('bot-3'))
  })

  it('verifies the explicit User actor with an optional Task List probe and never falls back to Bot', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(ok(center()))
      .mockResolvedValueOnce(ok(center(3)))
    const configure = vi.fn()
    const verify = vi.fn(() => Promise.resolve(ok(verifySuccess('user'))))
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('idempotency-user-verify')
      .mockReturnValueOnce('causation-user-verify')
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: read,
      configureFeishuIdentityRoute: configure,
      verifyFeishuIdentityRoute: verify,
    }), { nextCommandKey })
    await controller.refresh()

    controller.setTaskListResourceId('user', '  task-list-guid-1  ')
    await controller.verify('user')

    expect(verify).toHaveBeenCalledOnce()
    expect(verify).toHaveBeenCalledWith({
      kind: 'user',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      resourceProbe: { kind: 'task-list', resourceId: 'task-list-guid-1' },
      idempotencyKey: 'idempotency-user-verify',
      causationId: 'causation-user-verify',
      reason: 'owner-feishu-route-verify',
    }, expect.any(AbortSignal))
    expect(configure).not.toHaveBeenCalled()
    expect(controller.getSnapshot().drafts.user.taskListResourceId).toBe('  task-list-guid-1  ')
    expect(controller.getSnapshot().drafts.bot.taskListResourceId).toBe('')
  })

  it('emits explicit reset and disable commands and treats invalid route states as local no-ops', async () => {
    const configure = vi.fn()
      .mockResolvedValueOnce(ok(configureSuccess('bot')))
      .mockResolvedValueOnce(ok({
        ...configureSuccess('user', 3),
        value: { ...configureSuccess('user', 3).value, state: 'disabled' as const },
      }))
    const botController = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn()
        .mockResolvedValueOnce(ok(center()))
        .mockResolvedValueOnce(ok(center(3, {
          bot: route('bot', { state: 'unconfigured', generation: 2, appId: null, credentialRef: null }),
        }))),
      configureFeishuIdentityRoute: configure,
    }), {
      nextCommandKey: vi.fn()
        .mockReturnValueOnce('reset-idempotency').mockReturnValueOnce('reset-causation'),
    })
    await botController.refresh()
    await botController.resetIdentity('bot')
    expect(configure.mock.calls[0]?.[0]).toEqual({
      mode: 'reset', kind: 'bot', expectedConnectionRevision: 2,
      expectedRouteGeneration: 1, idempotencyKey: 'reset-idempotency',
      causationId: 'reset-causation', reason: 'owner-feishu-route-reset',
    })
    await botController.resetIdentity('bot')
    expect(configure).toHaveBeenCalledTimes(1)

    const userController = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn()
        .mockResolvedValueOnce(ok(center()))
        .mockResolvedValueOnce(ok(center(3, {
          user: route('user', { state: 'disabled', generation: 2 }),
        }))),
      configureFeishuIdentityRoute: configure,
    }), {
      nextCommandKey: vi.fn()
        .mockReturnValueOnce('disable-idempotency').mockReturnValueOnce('disable-causation'),
    })
    await userController.refresh()
    await userController.disable('user')
    expect(configure.mock.calls[1]?.[0]).toEqual({
      mode: 'disable', kind: 'user', expectedConnectionRevision: 2,
      expectedRouteGeneration: 1, idempotencyKey: 'disable-idempotency',
      causationId: 'disable-causation', reason: 'owner-feishu-route-disable',
    })
    expect(userController.canConfigure('user')).toBe(true)
    await userController.disable('user')
    expect(configure).toHaveBeenCalledTimes(2)
  })

  it('retains only the exact response-loss envelope and clears it when that route is edited', async () => {
    const requests: unknown[] = []
    const configure = vi.fn()
      .mockImplementationOnce(request => {
        requests.push(request)
        return Promise.resolve({
          ok: false as const,
          error: { code: 'unavailable' as const, message: 'response lost PRIVATE_DIAGNOSTIC' },
        })
      })
      .mockImplementationOnce(request => {
        requests.push(request)
        return Promise.resolve(ok(configureSuccess('bot')))
      })
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('retry-idempotency')
      .mockReturnValueOnce('retry-causation')
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn()
        .mockResolvedValueOnce(ok(center()))
        .mockResolvedValueOnce(ok(center(3))),
      configureFeishuIdentityRoute: configure,
    }), { nextCommandKey })
    await controller.refresh()
    controller.setAppId('bot', 'cli_bot_changed')
    await controller.configure('bot')

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      canRetryMutation: true,
      issue: { kind: 'transport', code: 'unavailable', routeKind: 'bot' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE_DIAGNOSTIC')
    await controller.retryMutation()
    expect(requests[1]).toEqual(requests[0])
    expect(nextCommandKey).toHaveBeenCalledTimes(2)

    const editController = new WorkbenchFeishuConnectionController(remote({
      configureFeishuIdentityRoute: vi.fn(() => Promise.resolve({
        ok: false as const,
        error: { code: 'unavailable' as const, message: 'offline', details: {} },
      })),
    }))
    await editController.refresh()
    editController.setAppId('user', 'cli_user_changed')
    await editController.configure('user')
    expect(editController.getSnapshot().canRetryMutation).toBe(true)
    editController.setCredentialRef('user', 'FEISHU_USER_ACCESS_TOKEN_NEXT')
    expect(editController.getSnapshot().canRetryMutation).toBe(false)
  })

  it('retains a dirty route draft across a domain conflict until the Owner adopts the new base', async () => {
    const configure = vi.fn(() => Promise.resolve(ok({
      ok: false as const,
      error: {
        code: 'route-generation-conflict' as const,
        message: 'raw host detail',
        kind: 'bot' as const,
        expectedRouteGeneration: 1,
        currentRouteGeneration: 2,
      },
    } satisfies ConfigureFeishuIdentityRouteResult)))
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn()
        .mockResolvedValueOnce(ok(center()))
        .mockResolvedValueOnce(ok(center(3, { bot: route('bot', { generation: 2 }) }))),
      configureFeishuIdentityRoute: configure,
    }))
    await controller.refresh()
    controller.setAppId('bot', 'cli_bot_candidate')
    await controller.configure('bot')

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      drafts: { bot: { appId: 'cli_bot_candidate', basedOnRouteGeneration: 1 } },
      issue: { kind: 'conflict', code: 'route-generation-conflict', routeKind: 'bot' },
      canRetryMutation: false,
    })
    expect(controller.isDraftStale('bot')).toBe(true)
    expect(controller.canConfigure('bot')).toBe(false)
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('raw host detail')

    controller.adoptLatestBase('bot')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      drafts: { bot: { appId: 'cli_bot_candidate', basedOnRouteGeneration: 2 } },
      issue: null,
    })
    expect(controller.canConfigure('bot')).toBe(true)
  })

  it('bounds all reference inputs and aborts late reads during disposal', async () => {
    expect(validFeishuAppId('cli_a-1.2:test')).toBe(true)
    expect(validFeishuAppId(`a${'b'.repeat(MAX_FEISHU_APP_ID_LENGTH)}`)).toBe(false)
    expect(validCredentialRef('_FEISHU_1')).toBe(true)
    expect(validCredentialRef('FEISHU/SECRET')).toBe(false)
    expect(validCredentialRef(`A${'B'.repeat(MAX_FEISHU_CREDENTIAL_REF_LENGTH)}`)).toBe(false)
    expect(validTaskListResourceId('task-list-guid')).toBe(true)
    expect(validTaskListResourceId(`a${'b'.repeat(MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH)}`))
      .toBe(false)

    let readSignal: AbortSignal | undefined
    let resolveRead!: (value: RemoteResult<FeishuConnectionCenterProjection>) => void
    const controller = new WorkbenchFeishuConnectionController(remote({
      feishuConnectionCenter: vi.fn((signal?: AbortSignal) => {
        readSignal = signal
        return new Promise<RemoteResult<FeishuConnectionCenterProjection>>(resolve => {
          resolveRead = resolve
        })
      }),
    }))
    const pending = controller.refresh()
    const disposal = controller.dispose()
    expect(readSignal?.aborted).toBe(true)
    resolveRead(ok(center()))
    await Promise.all([pending, disposal])
    expect(controller.getSnapshot()).toMatchObject({ phase: 'loading', center: null })
  })
})
