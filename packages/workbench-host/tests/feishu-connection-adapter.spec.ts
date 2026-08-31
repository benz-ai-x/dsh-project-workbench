import type {
  CredentialInfo,
  CredentialProvider,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import {
  DshFeishuConnectionAdapter,
  FeishuCredentialDescriptionError,
  type FeishuConnectionAdapter,
  type FeishuConnectionVerificationInput,
  type FeishuFetch,
} from '../src/feishu-connection-adapter.ts'
import type { WorkbenchFeishuVerificationObservation } from '../src/repository.ts'

const APP_ID = 'cli_workbench_fixture'
const BOT_SECRET = 'bot-secret-SENTINEL'
const BOT_SECRET_ROTATED = 'bot-secret-ROTATED-SENTINEL'
const TENANT_TOKEN = 'tenant-token-SENTINEL'
const USER_TOKEN = 'user-token-SENTINEL'
const RAW_PROVIDER_SENTINEL = 'raw-provider-secret-SENTINEL'

interface CredentialHarness {
  readonly provider: CredentialProvider
  readonly resolveRefs: string[]
  readonly describeRefs: string[]
  readonly values: Map<string, ResolvedCredential | undefined>
  readonly descriptions: Map<string, CredentialInfo>
  resolveFailure: unknown
  describeFailure: unknown
}

function credentials(): CredentialHarness {
  const harness = {
    resolveRefs: [] as string[],
    describeRefs: [] as string[],
    values: new Map<string, ResolvedCredential | undefined>(),
    descriptions: new Map<string, CredentialInfo>(),
    resolveFailure: null as unknown,
    describeFailure: null as unknown,
  }
  const provider = {
    resolve: async (ref: string) => {
      harness.resolveRefs.push(ref)
      if (harness.resolveFailure !== null) throw harness.resolveFailure
      return harness.values.get(ref)
    },
    describe: async (ref: string) => {
      harness.describeRefs.push(ref)
      if (harness.describeFailure !== null) throw harness.describeFailure
      return harness.descriptions.get(ref) ?? {
        configured: false,
        writable: true,
      }
    },
  } as unknown as CredentialProvider
  return Object.assign(harness, { provider })
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(payload), { ...init, headers })
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
}

function authorization(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('authorization')
}

function userIdentityResponse(): Response {
  return json({
    code: 0,
    data: {
      open_id: 'ou_owner_fixture',
      tenant_key: 'tenant_fixture',
      name: 'Owner Fixture',
      email: 'not-retained@example.invalid',
    },
  })
}

type CompleteVerificationInput = FeishuConnectionVerificationInput & {
  readonly resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null
}

async function completeUnboundVerification(
  adapter: FeishuConnectionAdapter,
  input: CompleteVerificationInput,
  signal: AbortSignal,
): Promise<WorkbenchFeishuVerificationObservation> {
  const started = await adapter.startIdentityVerification({
    kind: input.kind,
    appId: input.appId,
    credentialRef: input.credentialRef,
  }, signal)
  if (started.state === 'failed') {
    return {
      result: 'failed',
      identity: { state: 'failed', issue: started.issue },
      actor: null,
      displayLabel: null,
      scopeInspection: { state: 'not-inspected', scopes: [], issue: null },
      resourceProbe: { state: 'not-tested' },
    }
  }
  try {
    const capability = await started.session.finishVerification(input.resourceProbe, signal)
    return {
      result: capability.result,
      identity: { state: 'verified', issue: null },
      actor: started.session.actor,
      displayLabel: started.session.displayLabel,
      scopeInspection: capability.scopeInspection,
      resourceProbe: capability.resourceProbe,
    }
  } finally {
    started.session.dispose()
  }
}

describe('DshFeishuConnectionAdapter', () => {
  it('describes only a validated DSH reference and never resolves or exposes its value', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    store.descriptions.set('FEISHU_USER_TOKEN', {
      configured: true,
      source: 'project-env',
      writable: false,
    })
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => { throw new Error('network must not be used by describe') },
    })

    await expect(adapter.describeCredential('FEISHU_USER_TOKEN')).resolves.toEqual({
      ref: 'FEISHU_USER_TOKEN',
      configured: true,
      source: 'project-env',
      writable: false,
    })
    expect(store.describeRefs).toEqual(['FEISHU_USER_TOKEN'])
    expect(store.resolveRefs).toEqual([])
    expect(JSON.stringify(await adapter.describeCredential('FEISHU_USER_TOKEN'))).not.toContain(USER_TOKEN)

    await expect(adapter.describeCredential('not/a/ref')).rejects.toThrow(TypeError)
    expect(store.describeRefs).toEqual(['FEISHU_USER_TOKEN', 'FEISHU_USER_TOKEN'])

    store.describeFailure = new Error(`provider leaked ${RAW_PROVIDER_SENTINEL}`)
    const failure = await adapter.describeCredential('FEISHU_USER_TOKEN')
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FeishuCredentialDescriptionError)
    expect(String(failure)).not.toContain(RAW_PROVIDER_SENTINEL)
  })

  it('re-resolves the exact Bot secret per operation and uses only the Bot route', async () => {
    const store = credentials()
    store.values.set('FEISHU_BOT_SECRET', { value: BOT_SECRET, source: 'file' })
    const calls: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = []
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      calls.push({ url, authorization: authorization(init), redirect: init?.redirect })
      if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
        const body = JSON.parse(String(init?.body)) as { app_id: string; app_secret: string }
        expect(body.app_id).toBe(APP_ID)
        expect([BOT_SECRET, BOT_SECRET_ROTATED]).toContain(body.app_secret)
        return json({
          code: 0,
          tenant_access_token: body.app_secret === BOT_SECRET ? TENANT_TOKEN : `${TENANT_TOKEN}-rotated`,
          expire: 7_200,
        })
      }
      if (url.endsWith('/bot/v3/info')) {
        const token = authorization(init)
        expect([`Bearer ${TENANT_TOKEN}`, `Bearer ${TENANT_TOKEN}-rotated`]).toContain(token)
        return json({
          code: 0,
          bot: { activate_status: 2, app_name: 'Workbench Bot', open_id: 'ou_bot_fixture' },
        })
      }
      throw new Error(`unexpected endpoint ${url}`)
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })
    const input = {
      kind: 'bot' as const,
      appId: APP_ID,
      credentialRef: 'FEISHU_BOT_SECRET',
      resourceProbe: null,
    }

    const first = await completeUnboundVerification(adapter, input, new AbortController().signal)
    store.values.set('FEISHU_BOT_SECRET', { value: BOT_SECRET_ROTATED, source: 'file' })
    const second = await completeUnboundVerification(adapter, input, new AbortController().signal)

    expect(first).toMatchObject({
      result: 'healthy',
      identity: { state: 'verified', issue: null },
      actor: {
        realm: 'feishu-cn',
        appId: APP_ID,
        kind: 'bot',
        openId: 'ou_bot_fixture',
        tenantKey: null,
      },
      resourceProbe: { state: 'not-tested' },
    })
    expect(second.actor).toEqual(first.actor)
    expect(store.resolveRefs).toEqual(['FEISHU_BOT_SECRET', 'FEISHU_BOT_SECRET'])
    expect(calls).toHaveLength(4)
    expect(calls.every(call => call.redirect === 'error')).toBe(true)
    expect(calls.some(call => call.url.includes('/authen/v1/user_info'))).toBe(false)
    expect(JSON.stringify([first, second])).not.toContain(BOT_SECRET)
    expect(JSON.stringify([first, second])).not.toContain(TENANT_TOKEN)
  })

  it('delays the same-token User resource probe until the Host accepts the safe identity', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calls: string[] = []
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input, init) => {
        const url = requestUrl(input)
        calls.push(url)
        expect(authorization(init)).toBe(`Bearer ${USER_TOKEN}`)
        expect(init?.redirect).toBe('error')
        if (url.endsWith('/authen/v1/user_info')) return userIdentityResponse()
        if (url.endsWith('/task/v2/tasklists/tasklist_fixture')) return json({ code: 0, data: {} })
        throw new Error(`unexpected endpoint ${url}`)
      },
    })

    const signal = new AbortController().signal
    const started = await adapter.startIdentityVerification({
      kind: 'user',
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
    }, signal)

    expect(started.state).toBe('verified')
    if (started.state !== 'verified') throw new Error('fixture identity unexpectedly failed')
    expect(started.session.actor).toEqual({
      realm: 'feishu-cn',
      appId: APP_ID,
      kind: 'user',
      openId: 'ou_owner_fixture',
      tenantKey: 'tenant_fixture',
    })
    expect(calls).toEqual(['https://open.feishu.cn/open-apis/authen/v1/user_info'])
    expect(store.resolveRefs).toEqual(['FEISHU_USER_TOKEN'])

    const result = await started.session.finishVerification(
      { kind: 'task-list', resourceId: 'tasklist_fixture' },
      signal,
    )
    started.session.dispose()

    expect(result).toMatchObject({
      result: 'healthy',
      scopeInspection: { state: 'not-inspected', scopes: [], issue: null },
      resourceProbe: { state: 'accessible', kind: 'task-list', resourceId: 'tasklist_fixture' },
    })
    expect(store.resolveRefs).toEqual(['FEISHU_USER_TOKEN'])
    expect(calls).toHaveLength(2)
    expect(calls.some(url => url.includes('/tenant_access_token/'))).toBe(false)
    expect(calls.some(url => url.includes('/bot/v3/info'))).toBe(false)
    await expect(started.session.finishVerification(null, signal)).rejects.toThrow(
      'Workbench Feishu identity session is no longer available',
    )
    expect(JSON.stringify([started.session.actor, result])).not.toContain(USER_TOKEN)
    expect(JSON.stringify([started.session.actor, result])).not.toContain('not-retained@example.invalid')
  })

  it('fails closed before networking when the exact credential is absent or unavailable', async () => {
    const store = credentials()
    let fetchCalls = 0
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => {
        fetchCalls += 1
        return json({ code: 0 })
      },
    })
    const input = {
      kind: 'user' as const,
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }

    await expect(completeUnboundVerification(adapter, input, new AbortController().signal)).resolves.toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: { code: 'credential-unconfigured', recovery: 'configure-credential' },
      },
    })
    store.resolveFailure = new Error(`credential provider ${RAW_PROVIDER_SENTINEL}`)
    const unavailable = await completeUnboundVerification(adapter, input, new AbortController().signal)
    expect(unavailable).toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: { code: 'provider-unavailable', recovery: 'inspect-provider' },
      },
    })
    expect(fetchCalls).toBe(0)
    expect(JSON.stringify(unavailable)).not.toContain(RAW_PROVIDER_SENTINEL)
  })

  it('keeps missing app scope, User grant, resource ACL, and missing resources distinct', async () => {
    const cases = [
      {
        payload: {
          code: 99991672,
          msg: RAW_PROVIDER_SENTINEL,
          error: {
            permission_violations: [
              { type: 'action_scope_required', subject: 'task:tasklist:read' },
              { type: 'action_scope_required', subject: `unallowlisted:${RAW_PROVIDER_SENTINEL}` },
            ],
          },
        },
        issue: {
          code: 'missing-app-scope',
          recovery: 'grant-app-scope',
          missingScopes: ['task:tasklist:read'],
          grantPlane: 'application',
        },
        scopeState: 'observed',
      },
      {
        payload: {
          code: 99991679,
          msg: RAW_PROVIDER_SENTINEL,
          error: {
            permission_violations: [
              { type: 'action_privilege_required', name: 'task:tasklist:write' },
            ],
          },
        },
        issue: {
          code: 'missing-user-grant',
          recovery: 'reauthorize-user',
          missingScopes: ['task:tasklist:write'],
          grantPlane: 'user-consent',
        },
        scopeState: 'observed',
      },
      {
        payload: { code: 1470403, msg: RAW_PROVIDER_SENTINEL },
        issue: {
          code: 'resource-access-unavailable',
          recovery: 'share-resource',
          missingScopes: [],
          grantPlane: null,
        },
        scopeState: 'not-inspected',
      },
      {
        payload: { code: 1470404, msg: RAW_PROVIDER_SENTINEL },
        issue: {
          code: 'resource-not-found',
          recovery: 'check-resource-id',
          missingScopes: [],
          grantPlane: null,
        },
        scopeState: 'not-inspected',
      },
    ] as const

    for (const fixture of cases) {
      const store = credentials()
      store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
      let calls = 0
      const adapter = new DshFeishuConnectionAdapter(store.provider, {
        fetch: async input => {
          calls += 1
          return requestUrl(input).endsWith('/authen/v1/user_info')
            ? userIdentityResponse()
            : json(fixture.payload)
        },
      })
      const result = await completeUnboundVerification(adapter, {
        kind: 'user',
        appId: APP_ID,
        credentialRef: 'FEISHU_USER_TOKEN',
        resourceProbe: { kind: 'task-list', resourceId: 'tasklist_fixture' },
      }, new AbortController().signal)

      expect(result.result).toBe('attention')
      expect(result.identity).toEqual({ state: 'verified', issue: null })
      expect(result.scopeInspection.state).toBe(fixture.scopeState)
      expect(result.resourceProbe).toMatchObject({
        state: 'unavailable',
        kind: 'task-list',
        resourceId: 'tasklist_fixture',
        issue: fixture.issue,
      })
      if (fixture.scopeState === 'observed') {
        expect(result.scopeInspection.scopes).toEqual(fixture.issue.missingScopes.map(scope => ({
          scope,
          tokenType: 'user',
          state: 'missing',
        })))
      } else {
        expect(result.scopeInspection.scopes).toEqual([])
      }
      expect(calls).toBe(2)
      expect(JSON.stringify(result)).not.toContain(RAW_PROVIDER_SENTINEL)
      expect(JSON.stringify(result)).not.toContain('unallowlisted:')
    }
  })

  it('returns a bounded same-route rate-limit observation and discards the provider body', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const response = new Response(RAW_PROVIDER_SENTINEL, {
      status: 429,
      headers: { 'retry-after': '999999' },
    })
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => response,
      now: () => new Date('2026-08-31T00:00:00.000Z'),
    })

    const result = await completeUnboundVerification(adapter, {
      kind: 'user',
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }, new AbortController().signal)

    expect(result).toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: {
          code: 'rate-limited',
          recovery: 'retry-later',
          retryAt: '2026-08-31T01:00:00.000Z',
        },
      },
    })
    expect(response.bodyUsed).toBe(true)
    expect(JSON.stringify(result)).not.toContain(RAW_PROVIDER_SENTINEL)
  })

  it('turns its own deadline into a safe transport failure and propagates caller abort', async () => {
    const timeoutStore = credentials()
    timeoutStore.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let deadlineReachedTransport = false
    const deadlineAdapter = new DshFeishuConnectionAdapter(timeoutStore.provider, {
      timeoutMs: 10,
      fetch: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const signal = init?.signal as AbortSignal
          signal.addEventListener('abort', () => {
            deadlineReachedTransport = true
            controller.error(signal.reason)
          }, { once: true })
        },
      })),
    })

    const timedOut = await completeUnboundVerification(deadlineAdapter, {
      kind: 'user',
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }, new AbortController().signal)
    expect(deadlineReachedTransport).toBe(true)
    expect(timedOut).toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: { code: 'provider-unavailable', recovery: 'retry-later' },
      },
    })

    const abortStore = credentials()
    abortStore.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let transportSignal: AbortSignal | undefined
    const abortAdapter = new DshFeishuConnectionAdapter(abortStore.provider, {
      timeoutMs: 5_000,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        transportSignal = init?.signal as AbortSignal
        transportSignal.addEventListener('abort', () => reject(transportSignal?.reason), { once: true })
      }),
    })
    const controller = new AbortController()
    const pending = completeUnboundVerification(abortAdapter, {
      kind: 'user',
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }, controller.signal)
    for (let attempt = 0; transportSignal === undefined && attempt < 10; attempt += 1) {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(transportSignal?.aborted).toBe(true)
  })

  it('bounds declared and streamed response bodies and emits no raw provider payload', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const declaredResponse = new Response(JSON.stringify({
      code: 123,
      msg: RAW_PROVIDER_SENTINEL.repeat(20),
    }), {
      status: 200,
      headers: { 'content-length': '9999' },
    })
    const declaredAdapter = new DshFeishuConnectionAdapter(store.provider, {
      maxResponseBytes: 64,
      fetch: async () => declaredResponse,
    })
    const input = {
      kind: 'user' as const,
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }

    const declared = await completeUnboundVerification(declaredAdapter, input, new AbortController().signal)
    expect(declared.identity.issue).toMatchObject({
      code: 'provider-response-invalid',
      recovery: 'inspect-provider',
    })
    expect(declaredResponse.bodyUsed).toBe(true)

    let streamCancelled = false
    const streamedAdapter = new DshFeishuConnectionAdapter(store.provider, {
      maxResponseBytes: 32,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"code":0,"msg":"${RAW_PROVIDER_SENTINEL}`))
          controller.enqueue(new TextEncoder().encode(RAW_PROVIDER_SENTINEL.repeat(4)))
        },
        cancel() {
          streamCancelled = true
        },
      })),
    })
    const streamed = await completeUnboundVerification(streamedAdapter, input, new AbortController().signal)
    expect(streamed.identity.issue).toMatchObject({
      code: 'provider-response-invalid',
      recovery: 'inspect-provider',
    })
    expect(streamCancelled).toBe(true)
    expect(JSON.stringify([declared, streamed])).not.toContain(RAW_PROVIDER_SENTINEL)
    expect(JSON.stringify([declared, streamed])).not.toContain(USER_TOKEN)
  })

  it('reauthorizes User only for the explicit revoked code, not an arbitrary HTTP 403', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const responses = [
      json({ code: 99991668, msg: RAW_PROVIDER_SENTINEL }, { status: 403 }),
      userIdentityResponse(),
      json({ code: 31415926, msg: RAW_PROVIDER_SENTINEL }, { status: 403 }),
    ]
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => responses.shift() ?? json({ code: 0 }),
    })
    const input = {
      kind: 'user' as const,
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }

    const revoked = await completeUnboundVerification(
      adapter,
      input,
      new AbortController().signal,
    )
    expect(revoked.identity.issue).toMatchObject({
      code: 'user-authorization-revoked',
      recovery: 'reauthorize-user',
    })

    const unknown = await completeUnboundVerification(
      adapter,
      {
        ...input,
        resourceProbe: { kind: 'task-list', resourceId: 'tasklist_unknown_403' },
      },
      new AbortController().signal,
    )
    expect(unknown.identity).toEqual({ state: 'verified', issue: null })
    expect(unknown.resourceProbe).toMatchObject({
      state: 'unavailable',
      issue: {
        code: 'unknown-provider-error',
        recovery: 'inspect-provider',
      },
    })
    expect(JSON.stringify([revoked, unknown])).not.toContain(RAW_PROVIDER_SENTINEL)
  })

  it('maps unknown provider failures to a closed redacted issue', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => json({
        code: 31415926,
        msg: `${RAW_PROVIDER_SENTINEL} ${USER_TOKEN}`,
        data: { access_token: USER_TOKEN },
      }, { status: 400 }),
    })
    const result = await completeUnboundVerification(adapter, {
      kind: 'user',
      appId: APP_ID,
      credentialRef: 'FEISHU_USER_TOKEN',
      resourceProbe: null,
    }, new AbortController().signal)

    expect(result).toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: {
          code: 'unknown-provider-error',
          recovery: 'inspect-provider',
          missingScopes: [],
          grantPlane: null,
          retryAt: null,
        },
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(RAW_PROVIDER_SENTINEL)
    expect(serialized).not.toContain(USER_TOKEN)
    expect(serialized).not.toContain('31415926')
  })
})
