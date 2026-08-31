/** Host-only principal propagation and the single Workbench authorization seam. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'

/** Capability names are stable policy inputs, not UI labels. */
export type WorkbenchAction =
  | 'workbench.status.read'
  | 'workbench.status.write'
  | 'workbench.activity.read'
  | 'workbench.audit.verify'
  | 'workbench.project.read'
  | 'workbench.project.create'
  | 'workbench.project.team.read'
  | 'workbench.project.member.create'
  | 'workbench.project.member.status.write'
  | 'workbench.project.responsibility.write'
  | 'workbench.review.read'
  | 'workbench.review.decide'
  | 'workbench.integration.feishu.read'
  | 'workbench.integration.feishu.configure'
  | 'workbench.integration.feishu.verify'

/** The only authenticated principal shape admitted by the V1 policy. */
export interface OwnerPrincipal {
  readonly kind: 'owner'
  readonly ownerId: string
  readonly organizationId: string
  readonly teamId: string
  readonly sessionId: string
  readonly credentialVersion: number
}

/** Identity scope returned after an authorization decision succeeds. */
export interface AuthorizedScope {
  readonly ownerId: string
  readonly organizationId: string
  readonly teamId: string
}

/** Complete input to the reusable policy module. */
export interface AuthorizationRequest {
  readonly principal: OwnerPrincipal | null
  readonly action: WorkbenchAction
  readonly signal?: AbortSignal
}

/** Stable decision form; callers never infer permission from a missing error. */
export type AuthorizationDecision =
  | { readonly allowed: true; readonly scope: AuthorizedScope }
  | {
    readonly allowed: false
    readonly reason: 'anonymous' | 'unsupported-principal' | 'revoked-session'
  }

/** Narrow policy interface that can grow beyond the single-owner V1 implementation. */
export interface AuthorizationPolicy {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>
}

/** Interface injected into scenarios so no command/query can bypass policy. */
export interface WorkbenchAuthorization {
  require(action: WorkbenchAction, signal?: AbortSignal): Promise<AuthorizedScope>
  filterProjection<T>(action: WorkbenchAction, projection: T, signal?: AbortSignal): Promise<T>
}

/** Live session validator supplied by the Owner credential authority. */
export interface OwnerPrincipalValidator {
  (principal: OwnerPrincipal, signal?: AbortSignal): Promise<boolean>
}

/** V1 policy: a currently active local Owner receives the complete local scope. */
export class V1OwnerAuthorizationPolicy implements AuthorizationPolicy {
  constructor(private readonly sessionIsActive: OwnerPrincipalValidator) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const principal = request.principal
    if (principal === null) return { allowed: false, reason: 'anonymous' }
    if (principal.kind !== 'owner') {
      return { allowed: false, reason: 'unsupported-principal' }
    }
    if (!await this.sessionIsActive(principal, request.signal)) {
      return { allowed: false, reason: 'revoked-session' }
    }
    return {
      allowed: true,
      scope: Object.freeze({
        ownerId: principal.ownerId,
        organizationId: principal.organizationId,
        teamId: principal.teamId,
      }),
    }
  }
}

const failClosedPolicy: AuthorizationPolicy = Object.freeze({
  authorize: async (request: AuthorizationRequest): Promise<AuthorizationDecision> => ({
    allowed: false,
    reason: request.principal === null ? 'anonymous' : 'revoked-session',
  }),
})

/**
 * Request-local principal carrier. Only the authenticated HTTP adapter enters
 * a principal; every scenario operation asks this same module for permission.
 */
export class WorkbenchAuthorizationContext implements WorkbenchAuthorization {
  private readonly principals = new AsyncLocalStorage<OwnerPrincipal>()

  constructor(private readonly policy: AuthorizationPolicy = failClosedPolicy) {}

  /** Run one complete Gateway dispatch inside a server-derived Owner scope. */
  runAs<T>(principal: OwnerPrincipal, operation: () => T): T {
    return this.principals.run(validatePrincipal(principal), operation)
  }

  /** Current principal for diagnostics/tests; undefined is deliberately anonymous. */
  current(): OwnerPrincipal | undefined {
    return this.principals.getStore()
  }

  async require(action: WorkbenchAction, signal?: AbortSignal): Promise<AuthorizedScope> {
    throwIfAborted(signal)
    let decision: AuthorizationDecision
    try {
      decision = await this.policy.authorize({
        principal: this.principals.getStore() ?? null,
        action,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      // A store adapter may surface its own cancellation-shaped failure. The
      // public Scenario contract still reports the caller's abort as cancelled.
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    if (decision.allowed) return decision.scope
    throw new TypertRemoteFailure({
      code: decision.reason === 'unsupported-principal' ? 'forbidden' : 'unauthorized',
      message: 'Workbench authorization rejected the request',
      details: { action },
    })
  }

  async filterProjection<T>(
    action: WorkbenchAction,
    projection: T,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.require(action, signal)
    return projection
  }
}

/** Validate and detach a principal at the only request-context entrypoint. */
export function ownerPrincipal(value: OwnerPrincipal): OwnerPrincipal {
  for (const [field, candidate] of [
    ['ownerId', value.ownerId],
    ['organizationId', value.organizationId],
    ['teamId', value.teamId],
    ['sessionId', value.sessionId],
  ] as const) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new TypeError(`Owner principal ${field} must be a non-empty string`)
    }
  }
  if (value.kind !== 'owner') throw new TypeError('Owner principal kind must be owner')
  if (!Number.isSafeInteger(value.credentialVersion) || value.credentialVersion < 1) {
    throw new TypeError('Owner principal credentialVersion must be a positive safe integer')
  }
  return Object.freeze({ ...value })
}

function validatePrincipal(value: OwnerPrincipal): OwnerPrincipal {
  return ownerPrincipal(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new TypertRemoteFailure({
    code: 'cancelled',
    message: 'Workbench authorization was cancelled',
    details: {},
  })
}
