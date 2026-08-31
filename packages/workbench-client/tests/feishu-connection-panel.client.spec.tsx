// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ConfigureFeishuIdentityRouteRequest,
  FeishuConnectionCenterProjection,
  FeishuConnectionIssue,
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  VerifyFeishuIdentityRouteRequest,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FeishuConnectionPanel,
  type FeishuConnectionPanelCopy,
} from '../src/client/FeishuConnectionPanel.tsx'
import {
  WorkbenchFeishuConnectionController,
  type WorkbenchFeishuConnectionRemote,
} from '../src/client/feishu-connection-controller.ts'

afterEach(() => { cleanup() })

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

const copy: FeishuConnectionPanelCopy = {
  kicker: 'Connection Center',
  title: 'Feishu connection',
  subtitle: 'Inspect and configure explicit external identities.',
  noActorFallback: 'Bot and User are independent. A failure never switches actors.',
  loading: 'Loading connection',
  unavailable: 'Connection unavailable',
  phase: {
    loading: 'Loading', ready: 'Ready', pending: 'Saving', stale: 'Refreshing',
    error: 'Error', conflict: 'Conflict',
  },
  routeTitle: { bot: 'Bot identity', user: 'User identity' },
  routeBody: {
    bot: 'Tenant-token application actor.',
    user: 'User-token delegated actor.',
  },
  credentialReferenceLabel: {
    bot: 'Bot App Secret credential reference',
    user: 'User access-token credential reference',
  },
  routeState: {
    unconfigured: 'Unconfigured', configured: 'Configured', disabled: 'Disabled',
  },
  verificationResult: { healthy: 'Healthy', attention: 'Attention', failed: 'Failed' },
  identityState: { verified: 'Verified', failed: 'Failed' },
  scopeInspectionState: {
    observed: 'Observed', unavailable: 'Unavailable', 'not-inspected': 'Not inspected',
  },
  scopeState: {
    configured: 'Configured only', verified: 'Verified', missing: 'Missing', unknown: 'Unknown',
  },
  tokenType: { tenant: 'Tenant token', user: 'User token' },
  providerIssue: {
    'credential-unconfigured': 'The external credential reference is not configured.',
    'credential-invalid': 'The referenced credential is invalid.',
    'credential-expired': 'The referenced credential expired.',
    'user-authorization-revoked': 'User authorization was revoked.',
    'app-disabled': 'The Feishu app or bot is disabled.',
    'missing-app-scope': 'The application is missing a required scope.',
    'missing-user-grant': 'The user has not granted a required scope.',
    'outside-app-data-range': 'The resource is outside the app data range.',
    'resource-access-unavailable': 'This actor cannot access the resource.',
    'resource-not-found': 'The resource does not exist.',
    'unsupported-actor': 'The selected actor cannot call this API.',
    'identity-continuity-mismatch': 'The observed identity differs from the bound actor.',
    'tenant-mismatch': 'The observed tenant differs from the bound tenant.',
    'rate-limited': 'Feishu rate-limited this validation.',
    'provider-unavailable': 'Feishu is temporarily unavailable.',
    'provider-response-invalid': 'Feishu returned an invalid response.',
    'unknown-provider-error': 'Feishu returned an unclassified error.',
  },
  recovery: {
    'configure-credential': 'Provision the credential in DSH Credentials.',
    'rotate-credential': 'Rotate the external credential.',
    'enable-app': 'Enable and publish the application.',
    'grant-app-scope': 'Grant the required application scope and publish.',
    'reauthorize-user': 'Reauthorize this same User actor.',
    'expand-app-data-range': 'Expand the application data range.',
    'share-resource': 'Share the resource with this same actor.',
    'check-resource-id': 'Check the resource ID.',
    'reset-identity-binding': 'Reset this route identity explicitly.',
    'retry-later': 'Retry this same actor later.',
    'inspect-provider': 'Inspect the provider console.',
  },
  clientIssue: {
    unavailable: 'The Host is unavailable.',
    unauthorized: 'Authentication is required.',
    forbidden: 'Owner access is required.',
    'rate-limited': 'The Host rate-limited the request.',
    internal: 'The Host could not complete the request.',
    'transport-failure': 'The request failed safely.',
    'bad-request': 'The request was rejected.',
    'idempotency-conflict': 'The command identity conflicts.',
    'connection-revision-conflict': 'The connection changed.',
    'route-generation-conflict': 'This actor route changed.',
    'route-unconfigured': 'This actor route is unconfigured.',
    'no-op-route-configuration': 'The route already has this configuration.',
    'route-disabled': 'This actor route is disabled.',
  },
  operation: {
    'read-connection': 'Read connection', configure: 'Configure', reset: 'Reset',
    disable: 'Disable', verify: 'Verify',
  },
  connectionId: 'Connection ID',
  realm: 'Realm',
  revision: 'Connection revision',
  updatedAt: 'Updated at',
  routeGeneration: 'Route generation',
  configuration: 'Configuration',
  appId: 'Application ID',
  credential: 'Credential status',
  credentialReference: 'Credential reference',
  credentialConfigured: 'Credential configured',
  credentialSource: 'Credential source',
  credentialWritable: 'Credential writable',
  actor: 'Actor binding',
  displayLabel: 'Display label',
  openId: 'Open ID',
  tenantKey: 'Tenant key',
  authorization: 'Authorization validation',
  scopes: 'Observed scopes',
  scope: 'Scope',
  token: 'Token actor',
  status: 'Status',
  latestVerification: 'Latest validation',
  verificationSequence: 'Validation sequence',
  verificationCheckedAt: 'Checked at',
  identityCheck: 'Identity check',
  scopeInspection: 'Scope inspection',
  resourceProbe: 'Resource probe',
  resourceAccessible: 'Accessible',
  resourceUnavailable: 'Unavailable',
  resourceNotTested: 'Not tested',
  taskListProbe: 'Optional Task List probe',
  taskListProbeHint: 'Checks one Task List read with this exact actor.',
  externalProvisioningHint: 'Enter references only. Provision values outside this page.',
  resetIdentityHint: 'Starts a new identity-binding generation.',
  disableHint: 'Stops use of this route without selecting the other actor.',
  draftStale: 'The route changed after this draft started.',
  invalidConfiguration: 'Enter a valid application ID and credential reference.',
  invalidProbe: 'Enter a valid Task List identifier.',
  issueTitle: 'Connection issue',
  recoveryTitle: 'Recovery',
  missingScopes: 'Missing scopes',
  retryAt: 'Retry at',
  yes: 'Yes',
  no: 'No',
  none: 'None',
  notValidated: 'Not validated',
  notInspected: 'Not inspected',
  refresh: 'Refresh',
  retryExact: 'Retry exact command',
  saveConfiguration: 'Save configuration',
  reenableRoute: 'Re-enable route',
  resetForm: 'Reset form',
  adoptLatest: 'Adopt latest route',
  resetIdentity: 'Reset identity',
  disableRoute: 'Disable route',
  verifyRoute: 'Verify actor',
}

function issue(): FeishuConnectionIssue {
  return {
    code: 'missing-app-scope',
    recovery: 'grant-app-scope',
    missingScopes: ['task:tasklist:read'],
    grantPlane: 'application',
    retryAt: null,
  }
}

function route(
  kind: FeishuIdentityKind,
  providerIssue: FeishuConnectionIssue | null = null,
): FeishuIdentityRouteProjection {
  const credentialRef = kind === 'bot'
    ? 'FEISHU_APP_SECRET'
    : 'FEISHU_USER_ACCESS_TOKEN'
  return {
    kind,
    state: 'configured',
    generation: 4,
    appId: `cli_${kind}`,
    credential: { ref: credentialRef, configured: true, source: 'file', writable: true },
    actor: {
      connectionId: 'feishu-primary',
      realm: 'feishu-cn',
      appId: `cli_${kind}`,
      kind,
      routeGeneration: 4,
      openId: `ou_${kind}`,
      tenantKey: 'tenant-a',
    },
    displayLabel: `${kind} display`,
    lastVerification: {
      verificationId: `${kind}-verification-2`,
      sequence: 2,
      routeGeneration: 4,
      checkedAt: '2026-08-31T02:00:00.000Z',
      result: providerIssue === null ? 'healthy' : 'attention',
      identity: { state: 'verified', issue: null },
      scopeInspection: {
        state: 'observed',
        scopes: [{
          scope: 'task:tasklist:read',
          tokenType: kind === 'bot' ? 'tenant' : 'user',
          state: providerIssue === null ? 'verified' : 'missing',
        }],
        issue: providerIssue,
      },
      resourceProbe: {
        state: 'accessible',
        kind: 'task-list',
        resourceId: `${kind}-task-list`,
      },
    },
  }
}

function center(providerIssue: FeishuConnectionIssue | null = null)
  : FeishuConnectionCenterProjection {
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision: 7,
    bot: route('bot', providerIssue),
    user: route('user'),
    updatedAt: '2026-08-31T03:00:00.000Z',
  }
}

function receipt(suffix: string) {
  return { commandId: `command-${suffix}`, auditEventId: `audit-${suffix}`, outboxId: `outbox-${suffix}` }
}

function interactiveRemote(initial = center()) {
  let projection = initial
  const configure = vi.fn((request: ConfigureFeishuIdentityRouteRequest) => {
    const current = projection[request.kind]
    const generation = (current.generation ?? 0) + 1
    const nextRoute: FeishuIdentityRouteProjection = request.mode === 'set'
      ? {
          ...current,
          state: 'configured',
          generation,
          appId: request.appId,
          credential: {
            ref: request.credentialRef,
            configured: true,
            source: 'file',
            writable: true,
          },
          actor: null,
          displayLabel: null,
          lastVerification: null,
        }
      : request.mode === 'reset'
        ? { ...current, generation, actor: null, displayLabel: null, lastVerification: null }
        : { ...current, state: 'disabled', generation, actor: null, displayLabel: null, lastVerification: null }
    projection = {
      ...projection,
      revision: projection.revision + 1,
      [request.kind]: nextRoute,
    }
    return Promise.resolve(ok({
      ok: true as const,
      value: {
        connectionId: 'feishu-primary' as const,
        connectionRevision: projection.revision,
        kind: request.kind,
        routeGeneration: generation,
        state: nextRoute.state === 'disabled' ? 'disabled' as const : 'configured' as const,
      },
      receipt: receipt(`${request.kind}-${request.mode}`),
    }))
  })
  const verify = vi.fn((request: VerifyFeishuIdentityRouteRequest) => Promise.resolve(ok({
    ok: true as const,
    value: {
      connectionId: 'feishu-primary' as const,
      connectionRevision: projection.revision,
      kind: request.kind,
      routeGeneration: projection[request.kind].generation ?? 1,
      verificationSequence: 3,
      result: 'healthy' as const,
    },
    receipt: receipt(`${request.kind}-verify`),
  })))
  const remote: WorkbenchFeishuConnectionRemote = {
    feishuConnectionCenter: vi.fn(() => Promise.resolve(ok(projection))),
    configureFeishuIdentityRoute: configure,
    verifyFeishuIdentityRoute: verify,
  }
  return { remote, configure, verify }
}

function cardFor(title: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title }).closest('article')
  if (card === null) throw new Error(`${title} card missing`)
  return card
}

async function renderReady(initial = center()) {
  const harness = interactiveRemote(initial)
  const controller = new WorkbenchFeishuConnectionController(harness.remote, {
    nextCommandKey: (() => {
      let sequence = 0
      return () => `connection-key-${++sequence}`
    })(),
  })
  await controller.refresh()
  render(<FeishuConnectionPanel controller={controller} copy={copy} />)
  return { ...harness, controller }
}

describe('FeishuConnectionPanel', () => {
  it('renders separate Bot/User configuration, actor, scope, and validation facts without value fields', async () => {
    await renderReady(center(issue()))
    const bot = cardFor('Bot identity')
    const user = cardFor('User identity')

    expect(within(bot).getByText('FEISHU_APP_SECRET')).toBeTruthy()
    expect(within(user).getByText('FEISHU_USER_ACCESS_TOKEN')).toBeTruthy()
    expect(within(bot).getByText('ou_bot')).toBeTruthy()
    expect(within(user).getByText('ou_user')).toBeTruthy()
    expect(within(bot).getByText('Tenant token')).toBeTruthy()
    expect(within(user).getByText('User token')).toBeTruthy()
    expect(within(bot).getByText('Attention')).toBeTruthy()
    expect(screen.getByText('Bot and User are independent. A failure never switches actors.'))
      .toBeTruthy()

    expect(within(bot).getByText('The application is missing a required scope.')).toBeTruthy()
    expect(within(bot).getByText('Grant the required application scope and publish.')).toBeTruthy()
    expect(within(bot).getAllByText('task:tasklist:read').length).toBeGreaterThan(0)
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect([...document.querySelectorAll('input')].map(input => input.getAttribute('name')))
      .toEqual([
        'feishu-bot-app-id', 'feishu-bot-credential-ref', 'feishu-bot-task-list-probe',
        'feishu-user-app-id', 'feishu-user-credential-ref', 'feishu-user-task-list-probe',
      ])
  })

  it('renders a missing resource separately from an actor ACL denial', async () => {
    const projection = center()
    const userVerification = projection.user.lastVerification
    if (userVerification === null) throw new Error('fixture verification missing')
    const resourceIssue: FeishuConnectionIssue = {
      code: 'resource-not-found',
      recovery: 'check-resource-id',
      missingScopes: [],
      grantPlane: null,
      retryAt: null,
    }
    await renderReady({
      ...projection,
      user: {
        ...projection.user,
        lastVerification: {
          ...userVerification,
          result: 'attention',
          resourceProbe: {
            state: 'unavailable',
            kind: 'task-list',
            resourceId: 'missing-task-list',
            issue: resourceIssue,
          },
        },
      },
    })

    const user = cardFor('User identity')
    expect(within(user).getByText('The resource does not exist.')).toBeTruthy()
    expect(within(user).getByText('Check the resource ID.')).toBeTruthy()
    expect(within(user).queryByText('Share the resource with this same actor.')).toBeNull()
  })

  it('submits a Bot reference configuration and a User Task List probe to only those actors', async () => {
    const { configure, verify } = await renderReady()
    const bot = cardFor('Bot identity')
    const user = cardFor('User identity')

    fireEvent.change(within(bot).getByRole('textbox', { name: 'Application ID' }), {
      target: { value: 'cli_bot_next' },
    })
    fireEvent.change(within(bot).getByRole('textbox', {
      name: 'Bot App Secret credential reference',
    }), { target: { value: 'FEISHU_APP_SECRET_NEXT' } })
    await act(async () => {
      fireEvent.click(within(bot).getByRole('button', { name: 'Save configuration' }))
    })

    expect(configure).toHaveBeenCalledOnce()
    expect(configure.mock.calls[0]?.[0]).toMatchObject({
      mode: 'set',
      kind: 'bot',
      appId: 'cli_bot_next',
      credentialRef: 'FEISHU_APP_SECRET_NEXT',
      expectedConnectionRevision: 7,
      expectedRouteGeneration: 4,
      reason: 'owner-feishu-route-configure',
    })

    fireEvent.change(within(user).getByRole('textbox', { name: 'Optional Task List probe' }), {
      target: { value: 'task-list-user-42' },
    })
    await act(async () => {
      fireEvent.click(within(user).getByRole('button', { name: 'Verify actor' }))
    })

    expect(verify).toHaveBeenCalledOnce()
    expect(verify.mock.calls[0]?.[0]).toMatchObject({
      kind: 'user',
      resourceProbe: { kind: 'task-list', resourceId: 'task-list-user-42' },
      reason: 'owner-feishu-route-verify',
    })
    expect(verify.mock.calls[0]?.[0].kind).not.toBe('bot')
  })

  it('maps reset and disable controls to explicit route modes without switching identities', async () => {
    const { configure } = await renderReady()
    const bot = cardFor('Bot identity')
    const user = cardFor('User identity')

    await act(async () => {
      fireEvent.click(within(bot).getByRole('button', { name: 'Reset identity' }))
    })
    await waitFor(() => { expect(configure).toHaveBeenCalledTimes(1) })
    await act(async () => {
      fireEvent.click(within(user).getByRole('button', { name: 'Disable route' }))
    })

    expect(configure.mock.calls.map(call => ({ mode: call[0].mode, kind: call[0].kind })))
      .toEqual([{ mode: 'reset', kind: 'bot' }, { mode: 'disable', kind: 'user' }])
  })

  it('uses scoped theme tokens and responsive/reduced-motion rules', async () => {
    const root = process.cwd().endsWith('workbench-client')
      ? process.cwd()
      : resolve(process.cwd(), 'packages/workbench-client')
    const source = await readFile(
      resolve(root, 'src/client/FeishuConnectionPanel.module.css'),
      'utf8',
    )
    expect(source).toContain('var(--dsw-alias-bg-layer-1)')
    expect(source).toContain('@media (max-width: 600px)')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(source).not.toContain(':global')
  })
})
