/** Browser-safe public data contract for the Workbench Remote namespace. */

/** The complete durable status projection shown by the walking-skeleton UI. */
export interface WorkbenchStatusSnapshot {
  readonly id: string
  readonly message: string
  readonly revision: number
  readonly updatedAt: string
}

/** Compare-and-set command for the singleton Workbench status. */
export interface SetStatusRequest {
  readonly message: string
  readonly expectedRevision: number | null
}

/** A successful status commit or a recoverable stale-writer outcome. */
export type SetStatusResult =
  | { readonly ok: true; readonly value: WorkbenchStatusSnapshot }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'revision-conflict'
      readonly message: string
      readonly current: WorkbenchStatusSnapshot | null
    }
  }

/** Safe browser projection of the singleton Owner/authentication state. */
export type OwnerAccessProjection =
  | { readonly state: 'setup-required' }
  | { readonly state: 'signed-out' }
  | {
    readonly state: 'signed-in'
    readonly ownerId: string
    readonly organizationId: string
    readonly teamId: string
    readonly sessionExpiresAt: string
  }

/** First-owner setup command carried by the dedicated auth HTTP adapter. */
export interface InitializeOwnerRequest {
  readonly password: string
}

/** Password login command; V1 has no selectable username. */
export interface LoginOwnerRequest {
  readonly password: string
}

/** Successful setup deliberately carries the only plaintext recovery-code copy. */
export interface InitializeOwnerResult {
  readonly access: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>
  readonly recoveryCode: string
}

/** Successful login establishes the cookie and returns only its safe projection. */
export interface LoginOwnerResult {
  readonly access: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>
}

/** Stable auth-adapter failures translated to localized Client copy. */
export type OwnerAuthErrorCode =
  | 'already-initialized'
  | 'bad-request'
  | 'invalid-credentials'
  | 'rate-limited'
  | 'unavailable'

/** Small, explicit response envelope used only by `/api/workbench-auth/*`. */
export type OwnerAuthResponse<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false
    readonly error: {
      readonly code: OwnerAuthErrorCode
      readonly retryAfterSeconds?: number
    }
  }
