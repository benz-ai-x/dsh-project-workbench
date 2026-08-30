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
  /** Caller-stable retry identity. The Host stores only its digest. */
  readonly idempotencyKey: string
  /** Root causal identity propagated to the audit and Outbox records. */
  readonly causationId: string
  /** Bounded, allowlisted audit reason; arbitrary log text is not accepted. */
  readonly reason: WorkbenchStatusChangeReason
}

/** The only safe reason admitted by the T03 walking-skeleton command. */
export type WorkbenchStatusChangeReason = 'owner-status-edit'

/** Stable references proving which durable facts belong to one command. */
export interface WorkbenchCommandReceipt {
  readonly commandId: string
  readonly auditEventId: string
  readonly outboxId: string
}

/** A successful status commit or a recoverable domain rejection. */
export type SetStatusResult =
  | {
    readonly ok: true
    readonly value: WorkbenchStatusSnapshot
    readonly receipt: WorkbenchCommandReceipt
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'revision-conflict'
      readonly message: string
      readonly current: WorkbenchStatusSnapshot | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'idempotency-conflict'
      readonly message: string
    }
  }

/** Durable truth about one committed integration intent. */
export type WorkbenchOutboxState = 'pending' | 'delivered' | 'unknown' | 'failed'

/** Stable categories only; raw adapter errors are never persisted or projected. */
export type WorkbenchOutboxErrorCode =
  | 'lease-expired'
  | 'transport-ambiguous'
  | 'definitive-rejection'

/** T03's first versioned audit vocabulary. Later aggregates extend these unions. */
export type WorkbenchAuditAction = 'workbench.status.updated'
export type WorkbenchAuditObjectType = 'workbench-status'
export type WorkbenchActivitySummaryCode = 'status-revision-committed'

/** Browser-supplied Activity filters; omitted project means every visible scope. */
export interface WorkbenchActivityFilter {
  /** `null` selects workspace-scoped events; a string selects one real Project. */
  readonly projectId?: string | null
  readonly objectType?: WorkbenchAuditObjectType
  readonly objectId?: string
  readonly action?: WorkbenchAuditAction
  /** Exclusive, descending sequence cursor. */
  readonly beforeSequence?: number
  readonly limit?: number
}

/** Server-derived actor projection; request JSON can never provide this value. */
export interface WorkbenchActivityActor {
  readonly kind: 'owner'
  readonly id: string
}

/** Safe object identity and committed version shown in Activity. */
export interface WorkbenchActivityObject {
  readonly type: WorkbenchAuditObjectType
  readonly id: string
  readonly version: number
}

/** Redacted Outbox status. Its payload, claim token, and raw adapter data stay Host-only. */
export interface WorkbenchActivityOutbox {
  readonly id: string
  readonly state: WorkbenchOutboxState
  readonly attemptCount: number
  readonly updatedAt: string
  readonly errorCode: WorkbenchOutboxErrorCode | null
}

/** One allowlisted, immutable Activity row. It deliberately excludes status text. */
export interface WorkbenchActivityItem {
  readonly sequence: number
  readonly eventId: string
  readonly occurredAt: string
  readonly actor: WorkbenchActivityActor
  readonly projectId: string | null
  readonly action: WorkbenchAuditAction
  readonly reason: WorkbenchStatusChangeReason
  readonly object: WorkbenchActivityObject
  readonly causationId: string
  readonly commandId: string
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly hash: string
  readonly previousHash: string
  readonly outbox: WorkbenchActivityOutbox
}

/** Stable reason when a stored audit chain cannot be verified. */
export type WorkbenchAuditIntegrityIssue =
  | 'sequence-gap'
  | 'previous-hash-mismatch'
  | 'event-hash-mismatch'
  | 'head-mismatch'
  | 'unsupported-format'
  | 'invalid-event'

/** Whole-ledger verification result; SHA-256 is tamper evidence, not non-repudiation. */
export interface WorkbenchAuditIntegrityProjection {
  readonly valid: boolean
  readonly eventCount: number
  readonly headHash: string
  readonly issue: WorkbenchAuditIntegrityIssue | null
}

/** Descending, cursor-paged Activity projection. */
export interface WorkbenchActivityProjection {
  readonly items: readonly WorkbenchActivityItem[]
  readonly nextBeforeSequence: number | null
  /** Verified against the same SQLite read snapshot as `items`. */
  readonly integrity: WorkbenchAuditIntegrityProjection
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
