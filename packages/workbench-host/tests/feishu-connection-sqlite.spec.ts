import { describe, expect, it } from 'vitest'
import {
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  type WorkbenchCommandMetadata,
  type WorkbenchFeishuRouteMutation,
  type WorkbenchFeishuVerificationMutation,
} from '../src/index.ts'

const signal = new AbortController().signal
const instant = (second: number) => `2026-08-31T03:00:${String(second).padStart(2, '0')}.000Z`

function command(
  sequence: number,
  reason: WorkbenchCommandMetadata['reason'],
): WorkbenchCommandMetadata {
  return Object.freeze({
    commandId: `command-feishu-${String(sequence)}`,
    auditEventId: `audit-feishu-${String(sequence)}`,
    outboxId: `outbox-feishu-${String(sequence)}`,
    idempotencyKey: `idempotency-feishu-${String(sequence).padStart(3, '0')}`,
    causationId: `causation-feishu-${String(sequence).padStart(3, '0')}`,
    reason,
    actor: Object.freeze({
      kind: 'owner',
      id: 'owner-feishu',
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }),
    occurredAt: instant(sequence),
  })
}

function healthyVerification(
  input: Readonly<{
    sequence: number
    expectedConnectionRevision: number
    expectedRouteGeneration: number
    appId: string
    openId: string
  }>,
): WorkbenchFeishuVerificationMutation {
  const { sequence } = input
  return Object.freeze({
    verificationId: `verification-feishu-${String(sequence)}`,
    kind: 'bot',
    expectedConnectionRevision: input.expectedConnectionRevision,
    expectedRouteGeneration: input.expectedRouteGeneration,
    resourceProbe: Object.freeze({ kind: 'task-list', resourceId: 'tasklist-demo' }),
    observation: Object.freeze({
      result: 'healthy',
      identity: Object.freeze({ state: 'verified', issue: null }),
      actor: Object.freeze({
        realm: 'feishu-cn',
        appId: input.appId,
        kind: 'bot',
        openId: input.openId,
        tenantKey: 'tenant-demo',
      }),
      displayLabel: 'Project Workbench Bot',
      scopeInspection: Object.freeze({
        state: 'observed',
        scopes: Object.freeze([Object.freeze({
          scope: 'task:tasklist:read',
          tokenType: 'tenant',
          state: 'verified',
        })]),
        issue: null,
      }),
      resourceProbe: Object.freeze({
        state: 'accessible',
        kind: 'task-list',
        resourceId: 'tasklist-demo',
      }),
    }),
    checkedAt: instant(sequence),
    command: command(sequence, 'owner-feishu-route-verify') as WorkbenchCommandMetadata & {
      readonly reason: 'owner-feishu-route-verify'
    },
  })
}

function routeTransition(input: Readonly<{
  sequence: number
  mode: WorkbenchFeishuRouteMutation['mode']
  expectedConnectionRevision: number
  expectedRouteGeneration: number | null
  appId?: string
  credentialRef?: string
}>): WorkbenchFeishuRouteMutation {
  const reason = input.mode === 'set'
    ? 'owner-feishu-route-configure' as const
    : input.mode === 'reset'
      ? 'owner-feishu-route-reset' as const
      : 'owner-feishu-route-disable' as const
  return Object.freeze({
    kind: 'bot',
    mode: input.mode,
    appId: input.mode === 'set' ? input.appId as string : null,
    credentialRef: input.mode === 'set' ? input.credentialRef as string : null,
    expectedConnectionRevision: input.expectedConnectionRevision,
    expectedRouteGeneration: input.expectedRouteGeneration,
    updatedAt: instant(input.sequence),
    command: command(input.sequence, reason) as WorkbenchFeishuRouteMutation['command'],
  })
}

describe('T07 Feishu SQLite connection aggregate', () => {
  it('persists route generations, exact actor continuity, replay, and safe audit facts', async () => {
    const repository = new SqliteWorkbenchRepository({
      databasePath: ':memory:',
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()

    expect(WORKBENCH_SCHEMA_VERSION).toBe(11)
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({ revision: 0, updatedAt: null })

    const route: WorkbenchFeishuRouteMutation = Object.freeze({
      kind: 'bot',
      mode: 'set',
      appId: 'cli_demo',
      credentialRef: 'FEISHU_APP_SECRET',
      expectedConnectionRevision: 0,
      expectedRouteGeneration: null,
      updatedAt: instant(1),
      command: command(1, 'owner-feishu-route-configure') as WorkbenchCommandMetadata & {
        readonly reason: 'owner-feishu-route-configure'
      },
    })
    await expect(repository.commitFeishuRoute(route, signal)).resolves.toMatchObject({
      ok: true,
      value: { connectionRevision: 1, kind: 'bot', routeGeneration: 1 },
    })

    const first = healthyVerification({
      sequence: 2,
      expectedConnectionRevision: 1,
      expectedRouteGeneration: 1,
      appId: 'cli_demo',
      openId: 'ou_bot_stable',
    })
    const committed = await repository.commitFeishuVerification(first, signal)
    expect(committed).toMatchObject({
      ok: true,
      value: { connectionRevision: 2, verificationSequence: 1, result: 'healthy' },
    })
    await expect(repository.replayFeishuVerification({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
      actorId: 'owner-feishu',
      kind: 'bot',
      expectedConnectionRevision: 1,
      expectedRouteGeneration: 1,
      resourceProbe: Object.freeze({ kind: 'task-list', resourceId: 'tasklist-demo' }),
      idempotencyKey: first.command.idempotencyKey,
      causationId: first.command.causationId,
      reason: 'owner-feishu-route-verify',
    }, signal)).resolves.toEqual(committed)

    const changedActor = healthyVerification({
      sequence: 3,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      appId: 'cli_demo',
      openId: 'ou_other_bot',
    })
    const continuity = await repository.commitFeishuVerification(changedActor, signal)
    expect(continuity).toMatchObject({ ok: true, value: { result: 'failed' } })
    const projection = await repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)
    expect(projection.bot.actor?.openId).toBe('ou_bot_stable')
    expect(projection.bot.lastVerification).toMatchObject({
      result: 'failed',
      identity: { issue: { code: 'identity-continuity-mismatch' } },
    })
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 3,
    })

    await repository.close()
  })

  it('preserves one immutable actor across set and disable generations until explicit reset', async () => {
    const repository = new SqliteWorkbenchRepository({
      databasePath: ':memory:',
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()

    await expect(repository.commitFeishuRoute(routeTransition({
      sequence: 1,
      mode: 'set',
      expectedConnectionRevision: 0,
      expectedRouteGeneration: null,
      appId: 'cli_original',
      credentialRef: 'FEISHU_SECRET_ONE',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { connectionRevision: 1, routeGeneration: 1 },
    })
    await expect(repository.commitFeishuVerification(healthyVerification({
      sequence: 2,
      expectedConnectionRevision: 1,
      expectedRouteGeneration: 1,
      appId: 'cli_original',
      openId: 'ou_original',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { connectionRevision: 2, result: 'healthy' },
    })

    // Credential-reference rotation is a new config generation, not a new identity epoch.
    await repository.commitFeishuRoute(routeTransition({
      sequence: 3,
      mode: 'set',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      appId: 'cli_original',
      credentialRef: 'FEISHU_SECRET_TWO',
    }), signal)
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({
      revision: 3,
      bot: {
        generation: 2,
        appId: 'cli_original',
        displayLabel: 'Project Workbench Bot',
        actor: { routeGeneration: 1, appId: 'cli_original', openId: 'ou_original' },
        lastVerification: null,
      },
    })
    await expect(repository.commitFeishuVerification(healthyVerification({
      sequence: 4,
      expectedConnectionRevision: 3,
      expectedRouteGeneration: 2,
      appId: 'cli_original',
      openId: 'ou_rotated_principal',
    }), signal)).resolves.toMatchObject({ ok: true, value: { result: 'failed' } })

    // App ID changes also preserve continuity and therefore cannot silently rebind.
    await repository.commitFeishuRoute(routeTransition({
      sequence: 5,
      mode: 'set',
      expectedConnectionRevision: 4,
      expectedRouteGeneration: 2,
      appId: 'cli_other',
      credentialRef: 'FEISHU_SECRET_OTHER',
    }), signal)
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({
      bot: {
        generation: 3,
        appId: 'cli_other',
        actor: { routeGeneration: 1, appId: 'cli_original', openId: 'ou_original' },
      },
    })
    await expect(repository.commitFeishuVerification(healthyVerification({
      sequence: 6,
      expectedConnectionRevision: 5,
      expectedRouteGeneration: 3,
      appId: 'cli_other',
      openId: 'ou_other_app',
    }), signal)).resolves.toMatchObject({ ok: true, value: { result: 'failed' } })

    // Disable and re-enable retain the same immutable binding as well.
    await repository.commitFeishuRoute(routeTransition({
      sequence: 7,
      mode: 'disable',
      expectedConnectionRevision: 6,
      expectedRouteGeneration: 3,
    }), signal)
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({
      bot: {
        state: 'disabled',
        generation: 4,
        actor: { routeGeneration: 1, openId: 'ou_original' },
      },
    })
    await repository.commitFeishuRoute(routeTransition({
      sequence: 8,
      mode: 'set',
      expectedConnectionRevision: 7,
      expectedRouteGeneration: 4,
      appId: 'cli_original',
      credentialRef: 'FEISHU_SECRET_THREE',
    }), signal)
    await expect(repository.commitFeishuVerification(healthyVerification({
      sequence: 9,
      expectedConnectionRevision: 8,
      expectedRouteGeneration: 5,
      appId: 'cli_original',
      openId: 'ou_after_reenable',
    }), signal)).resolves.toMatchObject({ ok: true, value: { result: 'failed' } })

    // Reset is the sole transition that starts a fresh identity epoch.
    await expect(repository.commitFeishuRoute(routeTransition({
      sequence: 10,
      mode: 'reset',
      expectedConnectionRevision: 9,
      expectedRouteGeneration: 5,
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { connectionRevision: 10, routeGeneration: 6 },
    })
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({
      bot: { generation: 6, actor: null, lastVerification: null },
    })
    const reboundVerification = healthyVerification({
      sequence: 11,
      expectedConnectionRevision: 10,
      expectedRouteGeneration: 6,
      appId: 'cli_original',
      openId: 'ou_rebound_after_reset',
    })
    const reboundCommit = await repository.commitFeishuVerification(reboundVerification, signal)
    expect(reboundCommit).toMatchObject({ ok: true, value: { result: 'healthy' } })

    const rebound = await repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)
    expect(rebound.bot.actor).toMatchObject({
      routeGeneration: 6,
      appId: 'cli_original',
      openId: 'ou_rebound_after_reset',
    })
    await expect(repository.replayFeishuVerification({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
      actorId: 'owner-feishu',
      kind: 'bot',
      expectedConnectionRevision: 10,
      expectedRouteGeneration: 6,
      resourceProbe: Object.freeze({ kind: 'task-list', resourceId: 'tasklist-demo' }),
      idempotencyKey: reboundVerification.command.idempotencyKey,
      causationId: reboundVerification.command.causationId,
      reason: 'owner-feishu-route-verify',
    }, signal)).resolves.toEqual(reboundCommit)
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 11,
    })

    await repository.close()
  })

  it('persists resource-not-found separately from resource ACL denial in the closed issue vocabulary', async () => {
    const repository = new SqliteWorkbenchRepository({
      databasePath: ':memory:',
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()
    await repository.commitFeishuRoute(routeTransition({
      sequence: 1,
      mode: 'set',
      expectedConnectionRevision: 0,
      expectedRouteGeneration: null,
      appId: 'cli_resource',
      credentialRef: 'FEISHU_RESOURCE_SECRET',
    }), signal)
    const issue = Object.freeze({
      code: 'resource-not-found' as const,
      recovery: 'check-resource-id' as const,
      missingScopes: Object.freeze([]),
      grantPlane: null,
      retryAt: null,
    })
    await expect(repository.commitFeishuVerification(Object.freeze({
      verificationId: 'verification-feishu-2',
      kind: 'bot',
      expectedConnectionRevision: 1,
      expectedRouteGeneration: 1,
      resourceProbe: Object.freeze({ kind: 'task-list', resourceId: 'tasklist-missing' }),
      observation: Object.freeze({
        result: 'attention',
        identity: Object.freeze({ state: 'verified', issue: null }),
        actor: Object.freeze({
          realm: 'feishu-cn',
          appId: 'cli_resource',
          kind: 'bot',
          openId: 'ou_resource_bot',
          tenantKey: 'tenant-demo',
        }),
        displayLabel: 'Resource Bot',
        scopeInspection: Object.freeze({
          state: 'not-inspected',
          scopes: Object.freeze([]),
          issue: null,
        }),
        resourceProbe: Object.freeze({
          state: 'unavailable',
          kind: 'task-list',
          resourceId: 'tasklist-missing',
          issue,
        }),
      }),
      checkedAt: instant(2),
      command: command(2, 'owner-feishu-route-verify') as WorkbenchCommandMetadata & {
        readonly reason: 'owner-feishu-route-verify'
      },
    }), signal)).resolves.toMatchObject({ ok: true, value: { result: 'attention' } })
    await expect(repository.readFeishuConnection({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    }, signal)).resolves.toMatchObject({
      bot: {
        lastVerification: {
          resourceProbe: {
            state: 'unavailable',
            issue: { code: 'resource-not-found', recovery: 'check-resource-id' },
          },
        },
      },
    })

    // A subsequent ledger mutation re-validates the stored closed issue and exact request hash.
    await expect(repository.commitFeishuRoute(routeTransition({
      sequence: 3,
      mode: 'set',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      appId: 'cli_resource',
      credentialRef: 'FEISHU_RESOURCE_SECRET_ROTATED',
    }), signal)).resolves.toMatchObject({ ok: true, value: { routeGeneration: 2 } })

    await repository.close()
  })
})
