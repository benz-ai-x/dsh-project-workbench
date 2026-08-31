import {
  credentialRef,
  type CredentialProvider,
} from '@deepseek-ai/dsh-credentials'
import type {
  FeishuConnectionIssue,
  FeishuCredentialProjection,
  FeishuIdentityKind,
  FeishuResourceProbeProjection,
  FeishuScopeObservation,
  FeishuTaskListProbe,
} from './client.ts'
import type {
  WorkbenchFeishuExternalAdapter,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
  WorkbenchFeishuVerifiedIdentitySession,
} from './scenario.ts'

const FEISHU_ORIGIN = 'https://open.feishu.cn'
const TENANT_TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal'
const BOT_INFO_PATH = '/open-apis/bot/v3/info'
const USER_INFO_PATH = '/open-apis/authen/v1/user_info'
const TASK_LIST_PATH = '/open-apis/task/v2/tasklists/'
const SAFE_ROUTE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/u
const MAX_APP_ID_LENGTH = 128
const MAX_CREDENTIAL_REF_LENGTH = 128
const MAX_RESOURCE_ID_LENGTH = 256
const MAX_ACTOR_ID_LENGTH = 128
const MAX_DISPLAY_LABEL_LENGTH = 200
const MAX_SECRET_LENGTH = 16_384
const MAX_SOURCE_LENGTH = 64
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000
const TASK_LIST_READ_SCOPE = 'task:tasklist:read'
const TASK_LIST_WRITE_SCOPE = 'task:tasklist:write'

export const DEFAULT_FEISHU_REQUEST_TIMEOUT_MS = 10_000
export const DEFAULT_FEISHU_MAX_RESPONSE_BYTES = 256 * 1_024
export const FEISHU_CONNECTION_ADAPTER_ID = 'feishu-open-platform-v1'

export interface FeishuConnectionVerificationInput {
  readonly kind: FeishuIdentityKind
  readonly appId: string
  readonly credentialRef: string
}

/** Exact-route Host seam. A call contains no alternate identity to fall back to. */
export interface FeishuConnectionAdapter extends WorkbenchFeishuExternalAdapter {}

export type FeishuFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface DshFeishuConnectionAdapterOptions {
  readonly fetch?: FeishuFetch
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly now?: () => Date
}

/** Fixed-message failure: provider diagnostics are deliberately not forwarded. */
export class FeishuCredentialDescriptionError extends Error {
  constructor() {
    super('Workbench Feishu credential description is unavailable')
    this.name = 'FeishuCredentialDescriptionError'
  }
}

interface HttpJsonResponse {
  readonly state: 'response'
  readonly status: number
  readonly payload: unknown
  readonly retryAt: string | null
}

interface InvalidHttpJsonResponse {
  readonly state: 'invalid-response'
  readonly status: number
  readonly retryAt: string | null
}

interface UnavailableHttpResponse {
  readonly state: 'unavailable'
}

type HttpResult = HttpJsonResponse | InvalidHttpJsonResponse | UnavailableHttpResponse
type EndpointKind = 'tenant-token' | 'identity' | 'task-list'

interface VerifiedIdentity {
  readonly actor: WorkbenchFeishuVerifiedIdentitySession['actor']
  readonly displayLabel: string | null
}

/** Production Feishu adapter over the pinned DSH credential-reference seam. */
export class DshFeishuConnectionAdapter implements FeishuConnectionAdapter {
  readonly adapterId = FEISHU_CONNECTION_ADAPTER_ID
  private readonly request: FeishuFetch
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly now: () => Date

  constructor(
    private readonly credentials: CredentialProvider,
    options: DshFeishuConnectionAdapterOptions = {},
  ) {
    this.request = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_FEISHU_REQUEST_TIMEOUT_MS,
      'Feishu request timeout is invalid',
    )
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_FEISHU_MAX_RESPONSE_BYTES,
      'Feishu response limit is invalid',
    )
    this.now = options.now ?? (() => new Date())
  }

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    const checkedRef = checkedCredentialRef(ref)
    try {
      const description = await this.credentials.describe(checkedRef)
      if (typeof description.configured !== 'boolean'
        || typeof description.writable !== 'boolean') {
        throw new TypeError('invalid credential description')
      }
      return Object.freeze({
        ref: checkedRef,
        configured: description.configured,
        source: safeSource(description.source),
        writable: description.writable,
      })
    } catch {
      throw new FeishuCredentialDescriptionError()
    }
  }

  async startIdentityVerification(
    input: FeishuConnectionVerificationInput,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const route = checkedInput(input)
    signal.throwIfAborted()

    let resolved: Awaited<ReturnType<CredentialProvider['resolve']>>
    try {
      resolved = await this.credentials.resolve(checkedCredentialRef(route.credentialRef))
    } catch {
      signal.throwIfAborted()
      return failedIdentity(issue('provider-unavailable', 'inspect-provider'))
    }
    signal.throwIfAborted()
    if (resolved === undefined) {
      return failedIdentity(issue('credential-unconfigured', 'configure-credential'))
    }
    let credentialValue: unknown
    try {
      credentialValue = resolved.value
    } catch {
      return failedIdentity(issue('provider-unavailable', 'inspect-provider'))
    }
    if (!safeSecret(credentialValue)) {
      return failedIdentity(issue('credential-invalid', 'rotate-credential'))
    }

    if (route.kind === 'bot') {
      return this.verifyBot(route, credentialValue, signal)
    }
    return this.verifyUser(route, credentialValue, signal)
  }

  private async verifyBot(
    input: FeishuConnectionVerificationInput & { readonly kind: 'bot' },
    appSecret: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const tokenResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${TENANT_TOKEN_PATH}`,
      {
        method: 'POST',
        headers: Object.freeze({ 'content-type': 'application/json' }),
        body: JSON.stringify({ app_id: input.appId, app_secret: appSecret }),
      },
      signal,
    )
    signal.throwIfAborted()
    const tokenIssue = providerIssue(tokenResponse, 'tenant-token', input.kind)
    if (tokenIssue !== null) return failedIdentity(tokenIssue)
    if (tokenResponse.state !== 'response') {
      return failedIdentity(issue('provider-response-invalid', 'inspect-provider'))
    }
    const tenantToken = safeStringField(tokenResponse.payload, 'tenant_access_token', MAX_SECRET_LENGTH)
    if (providerCode(tokenResponse.payload) !== 0 || tenantToken === null || !safeSecret(tenantToken)) {
      return failedIdentity(issue('provider-response-invalid', 'inspect-provider'))
    }

    const identityResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${BOT_INFO_PATH}`,
      bearerRequest(tenantToken),
      signal,
    )
    signal.throwIfAborted()
    const identityIssue = providerIssue(identityResponse, 'identity', input.kind)
    if (identityIssue !== null) return failedIdentity(identityIssue)
    const identity = botIdentity(identityResponse, input.appId)
    if ('issue' in identity) return failedIdentity(identity.issue)
    return this.verifiedIdentity(input.kind, tenantToken, identity)
  }

  private async verifyUser(
    input: FeishuConnectionVerificationInput & { readonly kind: 'user' },
    userToken: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const identityResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${USER_INFO_PATH}`,
      bearerRequest(userToken),
      signal,
    )
    signal.throwIfAborted()
    const identityIssue = providerIssue(identityResponse, 'identity', input.kind)
    if (identityIssue !== null) return failedIdentity(identityIssue)
    const identity = userIdentity(identityResponse, input.appId)
    if ('issue' in identity) return failedIdentity(identity.issue)
    return this.verifiedIdentity(input.kind, userToken, identity)
  }

  private verifiedIdentity(
    kind: FeishuIdentityKind,
    accessToken: string,
    identity: VerifiedIdentity,
  ): WorkbenchFeishuIdentityVerificationResult {
    let retainedToken: string | null = accessToken
    let finished = false
    const session: WorkbenchFeishuVerifiedIdentitySession = Object.freeze({
      actor: identity.actor,
      displayLabel: identity.displayLabel,
      finishVerification: async (
        resourceProbe: FeishuTaskListProbe | null,
        signal: AbortSignal,
      ): Promise<WorkbenchFeishuResourceVerificationObservation> => {
        if (finished || retainedToken === null) {
          throw new Error('Workbench Feishu identity session is no longer available')
        }
        finished = true
        const operationToken = retainedToken
        retainedToken = null
        return this.finishVerification(kind, resourceProbe, operationToken, signal)
      },
      dispose: (): void => {
        finished = true
        retainedToken = null
      },
    })
    return Object.freeze({ state: 'verified', session })
  }

  private async finishVerification(
    kind: FeishuIdentityKind,
    resourceProbe: FeishuTaskListProbe | null,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuResourceVerificationObservation> {
    const checkedProbe = checkedResourceProbe(resourceProbe)
    signal.throwIfAborted()
    if (checkedProbe === null) {
      return capabilityObservation(uninspectedScopes(), notTestedProbe())
    }

    const resourceId = checkedProbe.resourceId
    const response = await this.fetchJson(
      `${FEISHU_ORIGIN}${TASK_LIST_PATH}${encodeURIComponent(resourceId)}`,
      bearerRequest(accessToken),
      signal,
    )
    signal.throwIfAborted()
    const probeIssue = providerIssue(response, 'task-list', kind)
    if (probeIssue === null && response.state === 'response' && providerCode(response.payload) === 0) {
      return capabilityObservation(
        uninspectedScopes(),
        Object.freeze({ state: 'accessible', kind: 'task-list', resourceId }),
      )
    }
    const closedIssue = probeIssue
      ?? issue('provider-response-invalid', 'inspect-provider')
    return capabilityObservation(
      scopeEvidenceFor(closedIssue, kind),
      Object.freeze({
        state: 'unavailable',
        kind: 'task-list',
        resourceId,
        issue: closedIssue,
      }),
    )
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    callerSignal: AbortSignal,
  ): Promise<HttpResult> {
    callerSignal.throwIfAborted()
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
    const signal = AbortSignal.any([callerSignal, timeout.signal])
    try {
      const response = await this.request(url, {
        ...init,
        redirect: 'error',
        signal,
      })
      callerSignal.throwIfAborted()
      if (timeout.signal.aborted) {
        await response.body?.cancel().catch(() => undefined)
        return Object.freeze({ state: 'unavailable' })
      }
      const retryAt = retryInstant(response.headers.get('retry-after'), this.now())
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined)
        return Object.freeze({ state: 'invalid-response', status: response.status, retryAt })
      }
      const payload = await boundedJson(response, this.maxResponseBytes)
      callerSignal.throwIfAborted()
      if (timeout.signal.aborted) return Object.freeze({ state: 'unavailable' })
      if (payload === INVALID_JSON) {
        return Object.freeze({ state: 'invalid-response', status: response.status, retryAt })
      }
      return Object.freeze({ state: 'response', status: response.status, payload, retryAt })
    } catch {
      callerSignal.throwIfAborted()
      return Object.freeze({ state: 'unavailable' })
    } finally {
      clearTimeout(timer)
    }
  }
}

const INVALID_JSON = Symbol('invalid-json')

async function boundedJson(response: Response, maximum: number): Promise<unknown | typeof INVALID_JSON> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > maximum) {
    await response.body?.cancel().catch(() => undefined)
    return INVALID_JSON
  }
  if (response.body === null) return INVALID_JSON

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let total = 0
  let text = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximum) {
        await reader.cancel().catch(() => undefined)
        return INVALID_JSON
      }
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    await reader.cancel().catch(() => undefined)
    return INVALID_JSON
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A cancelled stream may already have released its lock.
    }
  }
  if (text.length === 0) return INVALID_JSON
  try {
    return JSON.parse(text) as unknown
  } catch {
    return INVALID_JSON
  }
}

function providerIssue(
  response: HttpResult,
  endpoint: EndpointKind,
  actor: FeishuIdentityKind,
): FeishuConnectionIssue | null {
  if (response.state === 'unavailable') {
    return issue('provider-unavailable', 'retry-later')
  }
  if (response.status === 429) {
    return issue('rate-limited', 'retry-later', [], null, response.retryAt)
  }
  if (response.state === 'invalid-response') {
    if (response.status >= 500 || response.status === 408) {
      return issue('provider-unavailable', 'retry-later')
    }
    return issue('provider-response-invalid', 'inspect-provider')
  }

  const code = providerCode(response.payload)
  if (response.status >= 200 && response.status < 300 && code === 0) return null
  if (endpoint === 'task-list' && code === 99991672) {
    const scopes = missingTaskScopes(response.payload)
    return issue('missing-app-scope', 'grant-app-scope', scopes, 'application')
  }
  if (endpoint === 'task-list' && actor === 'user' && code === 99991679) {
    const scopes = missingTaskScopes(response.payload)
    return issue('missing-user-grant', 'reauthorize-user', scopes, 'user-consent')
  }
  if (endpoint === 'task-list' && code === 1470403) {
    return issue('resource-access-unavailable', 'share-resource')
  }
  if (endpoint === 'task-list' && code === 1470404) {
    return issue('resource-not-found', 'check-resource-id')
  }
  if (code === 99991668) {
    return actor === 'user'
      ? issue('user-authorization-revoked', 'reauthorize-user')
      : issue('unsupported-actor', 'inspect-provider')
  }
  if (code === 99991663) {
    return actor === 'bot'
      ? issue('credential-invalid', 'rotate-credential')
      : issue('unsupported-actor', 'inspect-provider')
  }
  if (response.status === 429) {
    return issue('rate-limited', 'retry-later', [], null, response.retryAt)
  }
  if (response.status >= 500 || response.status === 408) {
    return issue('provider-unavailable', 'retry-later')
  }
  if (endpoint === 'tenant-token') {
    return issue('credential-invalid', 'rotate-credential')
  }
  return issue('unknown-provider-error', 'inspect-provider')
}

function botIdentity(
  response: HttpResult,
  appId: string,
): VerifiedIdentity | { readonly issue: FeishuConnectionIssue } {
  if (response.state !== 'response' || providerCode(response.payload) !== 0) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  const envelope = record(response.payload)
  const direct = envelope === null ? null : record(envelope.bot)
  const nestedData = envelope === null ? null : record(envelope.data)
  const bot = direct ?? (nestedData === null ? null : record(nestedData.bot))
  const openId = bot === null ? null : safeActorId(bot.open_id)
  if (bot === null || openId === null) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  if (!Number.isSafeInteger(bot.activate_status)) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  if (bot.activate_status !== 2) {
    return Object.freeze({ issue: issue('app-disabled', 'enable-app') })
  }
  return Object.freeze({
    actor: Object.freeze({ realm: 'feishu-cn', appId, kind: 'bot', openId, tenantKey: null }),
    displayLabel: safeDisplayLabel(bot.app_name),
  })
}

function userIdentity(
  response: HttpResult,
  appId: string,
): VerifiedIdentity | { readonly issue: FeishuConnectionIssue } {
  if (response.state !== 'response' || providerCode(response.payload) !== 0) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  const envelope = record(response.payload)
  const data = envelope === null ? null : record(envelope.data)
  const openId = data === null ? null : safeActorId(data.open_id)
  const tenantKey = data === null ? null : safeActorId(data.tenant_key)
  if (data === null || openId === null || tenantKey === null) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  return Object.freeze({
    actor: Object.freeze({ realm: 'feishu-cn', appId, kind: 'user', openId, tenantKey }),
    displayLabel: safeDisplayLabel(data.name),
  })
}

function capabilityObservation(
  scopeInspection: WorkbenchFeishuResourceVerificationObservation['scopeInspection'],
  resourceProbe: FeishuResourceProbeProjection,
): WorkbenchFeishuResourceVerificationObservation {
  const hasAttention = scopeInspection.state === 'unavailable'
    || scopeInspection.scopes.some(scope => scope.state === 'missing')
    || resourceProbe.state === 'unavailable'
  return Object.freeze({
    result: hasAttention ? 'attention' : 'healthy',
    scopeInspection,
    resourceProbe,
  })
}

function failedIdentity(failure: FeishuConnectionIssue): WorkbenchFeishuIdentityVerificationResult {
  return Object.freeze({ state: 'failed', issue: failure })
}

function uninspectedScopes(): WorkbenchFeishuResourceVerificationObservation['scopeInspection'] {
  return Object.freeze({
    state: 'not-inspected',
    scopes: Object.freeze([]),
    issue: null,
  })
}

function scopeEvidenceFor(
  failure: FeishuConnectionIssue,
  kind: FeishuIdentityKind,
): WorkbenchFeishuResourceVerificationObservation['scopeInspection'] {
  if (failure.code !== 'missing-app-scope' && failure.code !== 'missing-user-grant') {
    return uninspectedScopes()
  }
  const scopes: readonly FeishuScopeObservation[] = Object.freeze(
    failure.missingScopes.map(scope => Object.freeze({
      scope,
      tokenType: kind === 'bot' ? 'tenant' as const : 'user' as const,
      state: 'missing' as const,
    })),
  )
  return Object.freeze({ state: 'observed', scopes, issue: null })
}

function notTestedProbe(): FeishuResourceProbeProjection {
  return Object.freeze({ state: 'not-tested' })
}

function issue(
  code: FeishuConnectionIssue['code'],
  recovery: FeishuConnectionIssue['recovery'],
  missingScopes: readonly string[] = [],
  grantPlane: FeishuConnectionIssue['grantPlane'] = null,
  retryAt: string | null = null,
): FeishuConnectionIssue {
  return Object.freeze({
    code,
    recovery,
    missingScopes: Object.freeze([...missingScopes]),
    grantPlane,
    retryAt,
  })
}

function bearerRequest(token: string): RequestInit {
  return Object.freeze({
    method: 'GET',
    headers: Object.freeze({ authorization: `Bearer ${token}` }),
  })
}

function providerCode(payload: unknown): number | null {
  const envelope = record(payload)
  return envelope !== null && Number.isSafeInteger(envelope.code)
    ? envelope.code as number
    : null
}

function missingTaskScopes(payload: unknown): readonly string[] {
  const candidates = new Set<string>()
  const envelope = record(payload)
  const error = envelope === null ? null : record(envelope.error)
  const violations = error === null || !Array.isArray(error.permission_violations)
    ? []
    : error.permission_violations
  for (const candidate of violations) {
    const violation = record(candidate)
    if (violation === null) continue
    for (const key of ['scope', 'name', 'subject'] as const) {
      const value = violation[key]
      if (value === TASK_LIST_READ_SCOPE || value === TASK_LIST_WRITE_SCOPE) candidates.add(value)
    }
  }
  if (candidates.size === 0) candidates.add(TASK_LIST_READ_SCOPE)
  return Object.freeze([...candidates].sort())
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeStringField(value: unknown, key: string, maximum: number): string | null {
  const candidate = record(value)?.[key]
  return safeBoundedString(candidate, maximum) ? candidate : null
}

function safeActorId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= MAX_ACTOR_ID_LENGTH
    && SAFE_ROUTE_VALUE.test(value)
    ? value
    : null
}

function safeDisplayLabel(value: unknown): string | null {
  if (!safeBoundedString(value, MAX_DISPLAY_LABEL_LENGTH)) return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_LABEL_LENGTH ? trimmed : null
}

function safeSource(value: string | undefined): string | null {
  return safeBoundedString(value, MAX_SOURCE_LENGTH) ? value : null
}

function safeSecret(value: unknown): value is string {
  return safeBoundedString(value, MAX_SECRET_LENGTH)
}

function safeBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.isWellFormed()
    && !ASCII_CONTROL.test(value)
}

function checkedInput(input: FeishuConnectionVerificationInput):
  | FeishuConnectionVerificationInput & { readonly kind: 'bot' }
  | FeishuConnectionVerificationInput & { readonly kind: 'user' } {
  if (input.kind !== 'bot' && input.kind !== 'user') {
    throw new TypeError('Feishu route kind is invalid')
  }
  if (!safeRouteValue(input.appId, MAX_APP_ID_LENGTH)) {
    throw new TypeError('Feishu app id is invalid')
  }
  checkedCredentialRef(input.credentialRef)
  if (input.kind === 'bot') {
    return Object.freeze({
      kind: 'bot' as const,
      appId: input.appId,
      credentialRef: input.credentialRef,
    })
  }
  return Object.freeze({
    kind: 'user' as const,
    appId: input.appId,
    credentialRef: input.credentialRef,
  })
}

function checkedResourceProbe(value: FeishuTaskListProbe | null): FeishuTaskListProbe | null {
  if (value === null) return null
  if (value.kind !== 'task-list'
    || !safeRouteValue(value.resourceId, MAX_RESOURCE_ID_LENGTH)) {
    throw new TypeError('Feishu resource probe is invalid')
  }
  return Object.freeze({ kind: 'task-list', resourceId: value.resourceId })
}

function checkedCredentialRef(value: string): ReturnType<typeof credentialRef> {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_REF_LENGTH) {
    throw new TypeError('Feishu credential reference is invalid')
  }
  try {
    return credentialRef(value)
  } catch {
    throw new TypeError('Feishu credential reference is invalid')
  }
}

function safeRouteValue(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && SAFE_ROUTE_VALUE.test(value)
}

function positiveInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(message)
  return value
}

function retryInstant(value: string | null, now: Date): string | null {
  if (value === null || !Number.isFinite(now.getTime())) return null
  let delay: number
  if (/^\d{1,10}$/u.test(value)) {
    delay = Number(value) * 1_000
  } else {
    const instant = Date.parse(value)
    if (!Number.isFinite(instant)) return null
    delay = instant - now.getTime()
  }
  if (!Number.isFinite(delay) || delay < 0) return null
  return new Date(now.getTime() + Math.min(delay, MAX_RETRY_DELAY_MS)).toISOString()
}
