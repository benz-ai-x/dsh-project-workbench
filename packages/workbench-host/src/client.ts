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

/** Content identity validated as lowercase SHA-256 at every Host boundary. */
export type WorkbenchDigest = string

/** Exact immutable Template Version selected by a caller. */
export interface ProjectTemplateSelection {
  readonly templateId: 'knowledge-work'
  readonly templateVersion: 1
  readonly definitionDigest: WorkbenchDigest
}

/** Closed V1 definition copied into every Project creation snapshot. */
export interface KnowledgeWorkTemplateDefinitionV1 {
  readonly snapshotSchemaVersion: 1
  readonly templateId: 'knowledge-work'
  readonly templateVersion: 1
  readonly kind: 'knowledge-work'
  readonly rules: {
    readonly minimumOutcomeCount: 1
    readonly outcomeMetricRequired: true
    readonly primaryGoalRequired: true
    readonly supportingGoalsAllowed: true
  }
  readonly defaults: {
    readonly projectTimezone: 'Asia/Shanghai'
  }
}

/** Browser-safe immutable Template Version projection. */
export interface ProjectTemplateProjection {
  readonly selection: ProjectTemplateSelection
  readonly definition: KnowledgeWorkTemplateDefinitionV1
}

export type OutcomeMetricDirection = 'increase' | 'decrease'

/** Typed measurable result, kept separate from task completion. */
export interface OutcomeMetric {
  readonly metricName: string
  readonly initialValue: number
  readonly targetValue: number
  readonly unit: string
  readonly direction: OutcomeMetricDirection
}

/** New Outcome material nested under the new Primary Goal. */
export interface OutcomeDraft {
  readonly name: string
  readonly metric: OutcomeMetric
}

export interface OutcomeProjection extends OutcomeDraft {
  readonly outcomeId: string
  readonly revision: number
}

export interface GoalSummaryProjection {
  readonly goalId: string
  readonly name: string
  readonly revision: number
}

export interface GoalProjection extends GoalSummaryProjection {
  readonly outcomes: readonly OutcomeProjection[]
}

/** Independent, Project-owned copy of the exact creation definition. */
export interface ProjectTemplateSnapshotProjection {
  readonly template: ProjectTemplateSelection
  readonly snapshotSchemaVersion: 1
  readonly definition: KnowledgeWorkTemplateDefinitionV1
  readonly snapshotDigest: WorkbenchDigest
  readonly capturedAt: string
}

export interface ProjectSummaryProjection {
  readonly projectId: string
  readonly name: string
  readonly revision: number
  /** Monotonic catalog sequence used for stable descending pagination. */
  readonly catalogSequence: number
  readonly timezone: string
  readonly createdAt: string
  /** Every loaded Project is also a selectable Supporting Goal source. */
  readonly primaryGoal: GoalSummaryProjection
}

export interface ProjectDetailProjection {
  readonly project: ProjectSummaryProjection
  readonly primaryGoal: GoalProjection
  readonly supportingGoals: readonly GoalSummaryProjection[]
  readonly templateSnapshot: ProjectTemplateSnapshotProjection
}

/** Exclusive descending Project catalog cursor and bounded page size. */
export interface ProjectStartFilter {
  readonly beforeSequence?: number
  readonly limit?: number
}

/** One-round-trip creation-page projection. */
export interface ProjectStartProjection {
  readonly template: ProjectTemplateProjection
  readonly catalogRevision: number
  readonly projects: readonly ProjectSummaryProjection[]
  readonly nextBeforeSequence: number | null
}

export interface CreateProjectRequest {
  readonly template: ProjectTemplateSelection
  readonly projectName: string
  readonly primaryGoal: {
    readonly name: string
    readonly outcomes: readonly OutcomeDraft[]
  }
  readonly supportingGoals: readonly {
    readonly goalId: string
    readonly expectedRevision: number
  }[]
  readonly expectedCatalogRevision: number
  readonly expectedRevision: null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-create'
}

export interface ProjectQuery {
  readonly projectId: string
}

/** Atomic Project creation outcome or one closed, typed domain conflict. */
export type CreateProjectResult =
  | {
    readonly ok: true
    readonly value: ProjectDetailProjection
    readonly catalogRevision: number
    readonly receipt: WorkbenchCommandReceipt
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'idempotency-conflict'
      readonly message: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'catalog-revision-conflict'
      readonly message: string
      readonly expectedCatalogRevision: number
      readonly currentCatalogRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'supporting-goal-conflict'
      readonly message: string
      readonly goalId: string
      readonly expectedRevision: number
      readonly currentRevision: number | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'template-version-conflict'
      readonly message: string
      readonly current: ProjectTemplateSelection
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
export type WorkbenchProjectCreateReason = 'owner-project-create'
export type WorkbenchCommandReason = WorkbenchStatusChangeReason | WorkbenchProjectCreateReason
export type WorkbenchAuditAction = 'workbench.status.updated' | 'workbench.project.created'
export type WorkbenchAuditObjectType = 'workbench-status' | 'project'
export type WorkbenchActivitySummaryCode =
  | 'status-revision-committed'
  | 'project-created-from-template'

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
  readonly reason: WorkbenchCommandReason
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
