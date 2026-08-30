/** Browser-only HTTP adapter for the Workbench Owner shell. */

import type {
  InitializeOwnerResult,
  LoginOwnerResult,
  OwnerAccessProjection,
  OwnerAuthErrorCode,
  OwnerAuthResponse,
} from '@benz-ai-x/dsh-project-workbench/client'

/** Stable same-origin routes owned by the Workbench Host auth adapter. */
export const OWNER_AUTH_ENDPOINTS = Object.freeze({
  state: '/api/workbench-auth/state',
  initialize: '/api/workbench-auth/initialize',
  login: '/api/workbench-auth/login',
  logout: '/api/workbench-auth/logout',
})

/** Fetch seam kept browser-shaped for focused transport tests. */
export type OwnerAuthFetch = (input: string, init: RequestInit) => Promise<Response>

/** Narrow auth face consumed by the React-free Owner controller. */
export interface OwnerAuthHttp {
  state(signal?: AbortSignal): Promise<OwnerAuthResponse<OwnerAccessProjection>>
  initialize(
    password: string,
    signal?: AbortSignal,
  ): Promise<OwnerAuthResponse<InitializeOwnerResult>>
  login(password: string, signal?: AbortSignal): Promise<OwnerAuthResponse<LoginOwnerResult>>
  logout(signal?: AbortSignal): Promise<OwnerAuthResponse<OwnerAccessProjection>>
}

type SuccessParser<T> = (value: unknown) => T | null

const ERROR_CODES = new Set<OwnerAuthErrorCode>([
  'already-initialized',
  'bad-request',
  'invalid-credentials',
  'rate-limited',
  'unavailable',
])

/**
 * Dedicated raw-HTTP adapter. It never forwards server text to presentation
 * state and reconstructs the small public envelope from untrusted JSON.
 */
export class OwnerAuthHttpAdapter implements OwnerAuthHttp {
  constructor(
    private readonly send: OwnerAuthFetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  state(signal?: AbortSignal): Promise<OwnerAuthResponse<OwnerAccessProjection>> {
    return this.request(OWNER_AUTH_ENDPOINTS.state, {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...signal === undefined ? {} : { signal },
    }, parseAccess)
  }

  initialize(
    password: string,
    signal?: AbortSignal,
  ): Promise<OwnerAuthResponse<InitializeOwnerResult>> {
    return this.post(
      OWNER_AUTH_ENDPOINTS.initialize,
      Object.freeze({ password }),
      parseInitializeResult,
      signal,
    )
  }

  login(password: string, signal?: AbortSignal): Promise<OwnerAuthResponse<LoginOwnerResult>> {
    return this.post(
      OWNER_AUTH_ENDPOINTS.login,
      Object.freeze({ password }),
      parseLoginResult,
      signal,
    )
  }

  logout(signal?: AbortSignal): Promise<OwnerAuthResponse<OwnerAccessProjection>> {
    return this.post(OWNER_AUTH_ENDPOINTS.logout, Object.freeze({}), parseAccess, signal)
  }

  private post<T>(
    endpoint: string,
    body: Readonly<Record<string, string>>,
    parseSuccess: SuccessParser<T>,
    signal?: AbortSignal,
  ): Promise<OwnerAuthResponse<T>> {
    return this.request(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      ...signal === undefined ? {} : { signal },
    }, parseSuccess)
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit,
    parseSuccess: SuccessParser<T>,
  ): Promise<OwnerAuthResponse<T>> {
    const response = await this.send(endpoint, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return unavailable()
    }
    const envelope = parseEnvelope(payload, parseSuccess)
    if (envelope === null || (!response.ok && envelope.ok)) return unavailable()
    return envelope
  }
}

function parseEnvelope<T>(
  value: unknown,
  parseSuccess: SuccessParser<T>,
): OwnerAuthResponse<T> | null {
  if (!isRecord(value)) return null
  if (value.ok === true) {
    const parsed = parseSuccess(value.value)
    return parsed === null ? null : Object.freeze({ ok: true, value: parsed })
  }
  if (value.ok !== false || !isRecord(value.error)) return null
  const code = value.error.code
  if (typeof code !== 'string' || !ERROR_CODES.has(code as OwnerAuthErrorCode)) return null
  const retryAfterSeconds = value.error.retryAfterSeconds
  if (retryAfterSeconds !== undefined
    && (typeof retryAfterSeconds !== 'number'
      || !Number.isSafeInteger(retryAfterSeconds)
      || retryAfterSeconds < 0)) return null
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: code as OwnerAuthErrorCode,
      ...retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
    }),
  })
}

function parseAccess(value: unknown): OwnerAccessProjection | null {
  if (!isRecord(value) || typeof value.state !== 'string') return null
  if (value.state === 'setup-required') return Object.freeze({ state: 'setup-required' })
  if (value.state === 'signed-out') return Object.freeze({ state: 'signed-out' })
  if (value.state !== 'signed-in'
    || !isNonEmptyString(value.ownerId)
    || !isNonEmptyString(value.organizationId)
    || !isNonEmptyString(value.teamId)
    || !isNonEmptyString(value.sessionExpiresAt)
    || !Number.isFinite(Date.parse(value.sessionExpiresAt))) return null
  return Object.freeze({
    state: 'signed-in',
    ownerId: value.ownerId,
    organizationId: value.organizationId,
    teamId: value.teamId,
    sessionExpiresAt: value.sessionExpiresAt,
  })
}

function parseInitializeResult(value: unknown): InitializeOwnerResult | null {
  if (!isRecord(value) || !isNonEmptyString(value.recoveryCode)) return null
  const access = parseAccess(value.access)
  if (access?.state !== 'signed-in') return null
  return Object.freeze({ access, recoveryCode: value.recoveryCode })
}

function parseLoginResult(value: unknown): LoginOwnerResult | null {
  if (!isRecord(value)) return null
  const access = parseAccess(value.access)
  return access?.state === 'signed-in' ? Object.freeze({ access }) : null
}

function unavailable<T>(): OwnerAuthResponse<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'unavailable' as const }),
  })
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
