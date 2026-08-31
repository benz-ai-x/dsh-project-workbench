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

/** Project-scoped member eligibility state; inactive never deletes identity or history. */
export type ProjectMemberStatus = 'active' | 'inactive'

/** Closed app-scoped Feishu declaration. Verification belongs to the later connector ticket. */
export interface DeclaredFeishuIdentityDraft {
  readonly type: 'feishu'
  readonly appId: string
  readonly openId: string
  readonly state?: never
  readonly method?: never
  readonly value?: never
}

/** Host-derived projection state; callers never claim verification or declaration state. */
export interface DeclaredFeishuIdentity {
  readonly type: 'feishu'
  readonly appId: string
  readonly openId: string
  readonly state: 'declared'
}

/** Closed non-Feishu human contact. It is never translated into a formal assignee. */
export interface ExternalContactIdentity {
  readonly type: 'external'
  readonly method: 'email' | 'phone' | 'other'
  readonly value: string
}

/** Creation face explicitly forbids Feishu declaration fields on an external contact. */
export interface ExternalContactIdentityDraft extends ExternalContactIdentity {
  readonly appId?: never
  readonly openId?: never
  readonly state?: never
}

export type HumanProjectMemberIdentity = DeclaredFeishuIdentity | ExternalContactIdentity
export type HumanProjectMemberIdentityDraft =
  | DeclaredFeishuIdentityDraft
  | ExternalContactIdentityDraft

/** Exact creation material: human has one identity; Agent is descriptive only in T05. */
export type ProjectMemberDraft =
  | {
    readonly kind: 'human'
    readonly displayName: string
    readonly identity: HumanProjectMemberIdentityDraft
    readonly agentProfileId?: never
    readonly agentProfileVersionId?: never
  }
  | {
    readonly kind: 'agent'
    readonly displayName: string
    readonly identity?: never
    readonly agentProfileId?: never
    readonly agentProfileVersionId?: never
  }

export type FeishuAssigneeEligibility =
  | 'identifier-present'
  | 'external-contact'
  | 'agent-not-assignable'
  | 'inactive'

interface ProjectMemberProjectionBase {
  readonly memberId: string
  readonly projectId: string
  readonly displayName: string
  readonly status: ProjectMemberStatus
  readonly revision: number
  readonly feishuAssigneeEligibility: FeishuAssigneeEligibility
  readonly createdAt: string
  readonly updatedAt: string
}

/** Authorized roster value. Identity data never appears in receipts, audit, or Activity. */
export type ProjectMemberProjection =
  | ProjectMemberProjectionBase & {
    readonly kind: 'human'
    readonly identity: HumanProjectMemberIdentity
  }
  | ProjectMemberProjectionBase & {
    readonly kind: 'agent'
  }

/** Complete current responsibility tuple. History remains repository-owned and append-only. */
export interface ProjectResponsibilityProjection {
  readonly projectId: string
  readonly revision: number
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly updatedAt: string
}

/** One detached Project Team read; responsibility is null until first configuration. */
export interface ProjectTeamProjection {
  readonly projectId: string
  readonly teamRevision: number
  readonly members: readonly ProjectMemberProjection[]
  readonly responsibility: ProjectResponsibilityProjection | null
}

export interface ProjectTeamQuery {
  readonly projectId: string
  readonly actor?: never
  readonly organizationId?: never
  readonly teamId?: never
}

export interface AddProjectMemberRequest {
  readonly projectId: string
  readonly member: ProjectMemberDraft
  readonly expectedTeamRevision: number
  readonly expectedRevision: null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-member-add'
  readonly actor?: never
  readonly organizationId?: never
  readonly teamId?: never
  readonly memberId?: never
}

export interface SetProjectMemberStatusRequest {
  readonly projectId: string
  readonly memberId: string
  readonly status: ProjectMemberStatus
  readonly expectedTeamRevision: number
  readonly expectedMemberRevision: number
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-member-status-change'
  readonly actor?: never
  readonly organizationId?: never
  readonly teamId?: never
  readonly displayName?: never
  readonly identity?: never
}

export interface SetProjectResponsibilityRequest {
  readonly projectId: string
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly expectedTeamRevision: number
  readonly expectedResponsibilityRevision: number | null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-responsibility-set'
  readonly actor?: never
  readonly organizationId?: never
  readonly teamId?: never
  readonly responsibilityRevision?: never
}

/** PII-free member acknowledgement safe to retain in an immutable replay receipt. */
export interface ProjectMemberCommandAcknowledgement {
  readonly projectId: string
  readonly memberId: string
  readonly kind: 'human' | 'agent'
  readonly status: ProjectMemberStatus
  readonly memberRevision: number
  readonly teamRevision: number
}

/** PII-free responsibility acknowledgement; role membership stays out of the receipt. */
export interface ProjectResponsibilityCommandAcknowledgement {
  readonly projectId: string
  readonly responsibilityRevision: number
  readonly teamRevision: number
}

export interface ProjectNotFoundConflict {
  readonly code: 'project-not-found'
  readonly message: string
  readonly projectId: string
}

export interface ProjectTeamRevisionConflict {
  readonly code: 'team-revision-conflict'
  readonly message: string
  readonly expectedTeamRevision: number
  readonly currentTeamRevision: number
}

export interface ProjectMemberNotFoundConflict {
  readonly code: 'member-not-found'
  readonly message: string
  readonly memberId: string
}

type IdempotencyConflict = {
  readonly code: 'idempotency-conflict'
  readonly message: string
}

/** Atomic member creation result; the full member is obtained through projectTeam. */
export type AddProjectMemberResult =
  | {
    readonly ok: true
    readonly value: ProjectMemberCommandAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | { readonly ok: false; readonly error: ProjectTeamRevisionConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-limit-reached'
      readonly message: string
      readonly limit: 100
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'duplicate-feishu-identity'
      readonly message: string
    }
  }

/** Atomic member lifecycle result. In-use members must be reassigned first. */
export type SetProjectMemberStatusResult =
  | {
    readonly ok: true
    readonly value: ProjectMemberCommandAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | { readonly ok: false; readonly error: ProjectTeamRevisionConflict }
  | { readonly ok: false; readonly error: ProjectMemberNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-revision-conflict'
      readonly message: string
      readonly memberId: string
      readonly expectedMemberRevision: number
      readonly currentMemberRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-in-use'
      readonly message: string
      readonly memberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-status-conflict'
      readonly message: string
      readonly memberId: string
      readonly status: ProjectMemberStatus
    }
  }

/** Whole-tuple responsibility replacement result with closed policy conflicts. */
export type SetProjectResponsibilityResult =
  | {
    readonly ok: true
    readonly value: ProjectResponsibilityCommandAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | { readonly ok: false; readonly error: ProjectTeamRevisionConflict }
  | { readonly ok: false; readonly error: ProjectMemberNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'responsibility-revision-conflict'
      readonly message: string
      readonly expectedResponsibilityRevision: number | null
      readonly currentResponsibilityRevision: number | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-inactive'
      readonly message: string
      readonly memberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'accountable-also-contributor'
      readonly message: string
      readonly memberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'human-sponsor-required'
      readonly message: string
      readonly accountableMemberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'human-sponsor-invalid'
      readonly message: string
      readonly humanSponsorMemberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'human-sponsor-forbidden'
      readonly message: string
      readonly accountableMemberId: string
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
export type WorkbenchProjectTeamReason =
  | 'owner-project-member-add'
  | 'owner-project-member-status-change'
  | 'owner-project-responsibility-set'
export type WorkbenchCommandReason =
  | WorkbenchStatusChangeReason
  | WorkbenchProjectCreateReason
  | WorkbenchProjectTeamReason
export type WorkbenchAuditAction =
  | 'workbench.status.updated'
  | 'workbench.project.created'
  | 'workbench.project-member.created'
  | 'workbench.project-member.status-changed'
  | 'workbench.project.responsibility-assigned'
export type WorkbenchAuditObjectType =
  | 'workbench-status'
  | 'project'
  | 'project-member'
  | 'project-responsibility'
export type WorkbenchActivitySummaryCode =
  | 'status-revision-committed'
  | 'project-created-from-template'
  | 'project-member-created'
  | 'project-member-status-changed'
  | 'project-responsibility-assigned'

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
