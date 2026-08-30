import type {
  OwnerAccessProjection,
  OwnerAuthResponse,
} from '@benz-ai-x/dsh-project-workbench/client'
import { describe, expect, it, vi } from 'vitest'
import {
  OWNER_AUTH_ENDPOINTS,
  OwnerAuthHttpAdapter,
  type OwnerAuthFetch,
} from '../src/client/auth-http.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function signedIn(): Extract<OwnerAccessProjection, { readonly state: 'signed-in' }> {
  return {
    state: 'signed-in',
    ownerId: 'owner-1',
    organizationId: 'organization-1',
    teamId: 'team-1',
    sessionExpiresAt: '2099-09-01T00:00:00.000Z',
  }
}

describe('OwnerAuthHttpAdapter', () => {
  it('uses explicit same-origin, no-store JSON requests and exact POST bodies', async () => {
    const send = vi.fn<OwnerAuthFetch>()
      .mockResolvedValueOnce(json({ ok: true, value: { state: 'setup-required' } }))
      .mockResolvedValueOnce(json({
        ok: true,
        value: { access: signedIn(), recoveryCode: 'WB1-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH' },
      }, 201))
      .mockResolvedValueOnce(json({ ok: true, value: { access: signedIn() } }))
      .mockResolvedValueOnce(json({ ok: true, value: { state: 'signed-out' } }))
    const adapter = new OwnerAuthHttpAdapter(send)
    const abort = new AbortController()

    await adapter.state(abort.signal)
    await adapter.initialize('setup-secret', abort.signal)
    await adapter.login('login-secret', abort.signal)
    await adapter.logout(abort.signal)

    expect(send.mock.calls[0]).toEqual([
      OWNER_AUTH_ENDPOINTS.state,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      },
    ])
    expect(send.mock.calls[1]?.[0]).toBe(OWNER_AUTH_ENDPOINTS.initialize)
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'setup-secret' }),
      signal: abort.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
    expect(send.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ password: 'login-secret' }))
    expect(send.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({}))
  })

  it('reconstructs only the browser-safe projection and bounded auth errors', async () => {
    const send = vi.fn<OwnerAuthFetch>()
      .mockResolvedValueOnce(json({
        ok: true,
        value: { ...signedIn(), ignoredServerField: 'must not cross' },
      }))
      .mockResolvedValueOnce(json({
        ok: false,
        error: {
          code: 'rate-limited',
          retryAfterSeconds: 12,
          message: 'private server detail',
        },
      }, 429))
    const adapter = new OwnerAuthHttpAdapter(send)

    const state = await adapter.state()
    expect(state).toEqual({ ok: true, value: signedIn() })
    expect(state.ok && state.value).not.toHaveProperty('ignoredServerField')
    expect(await adapter.login('wrong')).toEqual({
      ok: false,
      error: { code: 'rate-limited', retryAfterSeconds: 12 },
    } satisfies OwnerAuthResponse<never>)
  })

  it('fails closed on plain outer rejections, malformed JSON, and success/status mismatch', async () => {
    const send = vi.fn<OwnerAuthFetch>()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(json({ ok: true, value: { state: 'invented' } }))
      .mockResolvedValueOnce(json({
        ok: true,
        value: { ...signedIn(), sessionExpiresAt: 'not-a-timestamp' },
      }))
      .mockResolvedValueOnce(json({ ok: true, value: { state: 'signed-out' } }, 403))
    const adapter = new OwnerAuthHttpAdapter(send)

    await expect(adapter.state()).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    })
    await expect(adapter.state()).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    })
    await expect(adapter.state()).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    })
    await expect(adapter.logout()).resolves.toEqual({
      ok: false,
      error: { code: 'unavailable' },
    })
  })

  it('preserves fetch cancellation for lifecycle fencing', async () => {
    const aborted = new DOMException('aborted', 'AbortError')
    const send = vi.fn<OwnerAuthFetch>().mockRejectedValue(aborted)
    const adapter = new OwnerAuthHttpAdapter(send)
    const controller = new AbortController()
    controller.abort(aborted)

    await expect(adapter.state(controller.signal)).rejects.toBe(aborted)
  })
})
