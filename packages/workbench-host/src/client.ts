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

/** Persisted human-review lifecycle; stale is always derived from target truth. */
export type SuggestedChangePersistedState = 'pending' | 'accepted' | 'rejected' | 'deferred'
export type SuggestedChangeEffectiveStatus = SuggestedChangePersistedState | 'stale'
export type SuggestedChangeRiskLevel = 'low' | 'high'
export type SuggestedChangeRiskReason =
  | 'initial-responsibility'
  | 'accountable-changed'
  | 'human-sponsor-changed'
  | 'contributors-only'
export type SuggestedChangeDecisionMode =
  | 'accepted'
  | 'edited-accepted'
  | 'rejected'
  | 'deferred'

/** Canonical complete Review representation; null Accountable means not configured. */
export interface ProjectResponsibilityReviewValue {
  readonly accountableMemberId: string | null
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
}

/** Complete typed candidate admitted by the only T06 target. */
export interface ProjectResponsibilitySuggestedValue {
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
}

export type ProjectResponsibilityReviewField =
  | 'accountable'
  | 'contributors'
  | 'human-sponsor'

/** Host-derived typed diff; it is never interpreted as an arbitrary patch. */
export interface ProjectResponsibilityReviewDiff {
  readonly kind: 'project-responsibility.diff'
  readonly schemaVersion: 1
  readonly before: ProjectResponsibilityReviewValue
  readonly after: ProjectResponsibilitySuggestedValue
  readonly changedFields: readonly ProjectResponsibilityReviewField[]
  readonly digest: WorkbenchDigest
}

/** T06 evidence is one immutable, same-Project audit fact. */
export interface SuggestedChangeEvidenceRef {
  readonly kind: 'workbench-audit-event'
  readonly auditEventId: string
}

export interface SuggestedChangeEvidenceProjection extends SuggestedChangeEvidenceRef {
  readonly occurredAt: string
  readonly action: WorkbenchAuditAction
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly object: WorkbenchActivityObject
}

/** Safe member label used by the one-round-trip proposal builder. */
export interface SuggestedChangeMemberOption {
  readonly memberId: string
  readonly displayName: string
  readonly kind: 'human' | 'agent'
  readonly status: ProjectMemberStatus
  /** True for an Agent or external-contact Accountable. */
  readonly requiresHumanSponsor: boolean
  readonly canBeHumanSponsor: boolean
}

export interface SuggestedChangeSourceProjection {
  readonly kind: 'owner'
  readonly actorId: string
}

export interface ProjectResponsibilityReviewTargetProjection {
  readonly kind: 'project-responsibility'
  readonly adapter: 'project-responsibility.replace'
  readonly representationSchemaVersion: 1
  readonly projectId: string
  readonly baseTeamRevision: number
  readonly baseResponsibilityRevision: number | null
  readonly currentTeamRevision: number
  readonly currentResponsibilityRevision: number | null
}

export type SuggestedChangeBatchPolicy =
  | {
    readonly policy: 'eligible-later'
    readonly homogeneityKey:
      'project-responsibility.replace|low|project-responsibility-v1'
  }
  | {
    readonly policy: 'forbidden'
    readonly reason: 'high-risk' | 'not-actionable'
  }

export interface SuggestedChangeRiskProjection {
  readonly proposedLevel: SuggestedChangeRiskLevel
  readonly effectiveLevel: SuggestedChangeRiskLevel
  readonly proposedReasonCodes: readonly SuggestedChangeRiskReason[]
  readonly policyVersion: 'project-responsibility-v1'
  readonly batchPolicy: SuggestedChangeBatchPolicy
}

export interface SuggestedChangeDecisionProjection {
  readonly decisionId: string
  readonly suggestedChangeRevision: number
  readonly mode: SuggestedChangeDecisionMode
  readonly actor: WorkbenchActivityActor
  readonly feedback: string
  readonly appliedDiff: ProjectResponsibilityReviewDiff | null
  readonly appliedRiskLevel: SuggestedChangeRiskLevel | null
  readonly appliedRiskReasonCodes: readonly SuggestedChangeRiskReason[]
  readonly appliedTeamRevision: number | null
  readonly appliedResponsibilityRevision: number | null
  readonly causationId: string
  readonly receipt: WorkbenchCommandReceipt
  readonly decidedAt: string
}

export type SuggestedChangeAllowedDecision =
  | 'accept'
  | 'edit-and-accept'
  | 'reject'
  | 'defer'

/** One complete authorized Review card. */
export interface SuggestedChangeProjection {
  readonly suggestedChangeId: string
  readonly sequence: number
  readonly revision: number
  readonly projectId: string
  readonly source: SuggestedChangeSourceProjection
  readonly target: ProjectResponsibilityReviewTargetProjection
  readonly proposedDiff: ProjectResponsibilityReviewDiff
  readonly evidence: readonly SuggestedChangeEvidenceProjection[]
  readonly risk: SuggestedChangeRiskProjection
  readonly originCausationId: string
  readonly persistedState: SuggestedChangePersistedState
  readonly effectiveStatus: SuggestedChangeEffectiveStatus
  readonly decisions: readonly SuggestedChangeDecisionProjection[]
  readonly allowedDecisions: readonly SuggestedChangeAllowedDecision[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ReviewCenterFilter {
  readonly projectId: string
  readonly status?: SuggestedChangeEffectiveStatus
  readonly riskLevel?: SuggestedChangeRiskLevel
  readonly beforeSequence?: number
  readonly limit?: number
  readonly actor?: never
  readonly organizationId?: never
  readonly teamId?: never
}

/** Project context and bounded recent evidence needed to form a proposal safely. */
export interface SuggestedChangeProposalBuilderProjection {
  readonly projectId: string
  readonly teamRevision: number
  readonly responsibilityRevision: number | null
  readonly base: ProjectResponsibilityReviewValue
  readonly memberOptions: readonly SuggestedChangeMemberOption[]
  readonly evidenceOptions: readonly SuggestedChangeEvidenceProjection[]
}

export interface ReviewCenterProjection {
  readonly projectId: string
  readonly proposalBuilder: SuggestedChangeProposalBuilderProjection
  readonly items: readonly SuggestedChangeProjection[]
  readonly nextBeforeSequence: number | null
}

export interface ProposeProjectResponsibilityChangeRequest {
  readonly projectId: string
  readonly candidate: ProjectResponsibilitySuggestedValue
  readonly expectedTeamRevision: number
  readonly evidenceRefs: readonly SuggestedChangeEvidenceRef[]
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-suggested-change-propose'
  readonly actor?: never
  readonly source?: never
  readonly target?: never
  readonly diff?: never
  readonly risk?: never
  readonly digest?: never
  readonly organizationId?: never
  readonly teamId?: never
  readonly suggestedChangeId?: never
}

export interface SuggestedChangeProposalAcknowledgement {
  readonly suggestedChangeId: string
  readonly suggestedChangeRevision: 1
  readonly targetAdapter: 'project-responsibility.replace'
  readonly baseTargetVersion: number
  readonly persistedState: 'pending'
  readonly riskLevel: SuggestedChangeRiskLevel
}

export type ProposeProjectResponsibilityChangeResult =
  | {
    readonly ok: true
    readonly value: SuggestedChangeProposalAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | { readonly ok: false; readonly error: ProjectTeamRevisionConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'no-op-suggested-change' | 'evidence-required'
      readonly message: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'evidence-invalid'
      readonly message: string
      readonly reason: 'duplicate' | 'unavailable' | 'wrong-project' | 'integrity-failed'
    }
  }
  | { readonly ok: false; readonly error: ProjectMemberNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-inactive' | 'accountable-also-contributor'
      readonly message: string
      readonly memberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'human-sponsor-required' | 'human-sponsor-forbidden'
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

interface SuggestedChangeDecisionRequestBase {
  readonly projectId: string
  readonly suggestedChangeId: string
  readonly expectedSuggestedChangeRevision: number
  readonly feedback: string
  readonly idempotencyKey: string
  readonly causationId: string
  readonly actor?: never
  readonly source?: never
  readonly target?: never
  readonly expectedTargetVersion?: never
  readonly diff?: never
  readonly risk?: never
  readonly organizationId?: never
  readonly teamId?: never
}

export type DecideSuggestedChangeRequest =
  | SuggestedChangeDecisionRequestBase & {
    readonly mode: 'accept'
    readonly acknowledgedRiskLevel: SuggestedChangeRiskLevel
    readonly reason: 'owner-suggested-change-accept'
    readonly candidate?: never
  }
  | SuggestedChangeDecisionRequestBase & {
    readonly mode: 'edit-and-accept'
    readonly acknowledgedRiskLevel: SuggestedChangeRiskLevel
    readonly candidate: ProjectResponsibilitySuggestedValue
    readonly reason: 'owner-suggested-change-edit-accept'
  }
  | SuggestedChangeDecisionRequestBase & {
    readonly mode: 'reject'
    readonly acknowledgedRiskLevel?: never
    readonly candidate?: never
    readonly reason: 'owner-suggested-change-reject'
  }
  | SuggestedChangeDecisionRequestBase & {
    readonly mode: 'defer'
    readonly acknowledgedRiskLevel?: never
    readonly candidate?: never
    readonly reason: 'owner-suggested-change-defer'
  }

export interface SuggestedChangeDecisionAcknowledgement {
  readonly suggestedChangeId: string
  readonly suggestedChangeRevision: number
  readonly persistedState: 'accepted' | 'rejected' | 'deferred'
  readonly decisionMode: SuggestedChangeDecisionMode
  readonly riskLevel: SuggestedChangeRiskLevel
  readonly appliedTeamRevision: number | null
  readonly appliedResponsibilityRevision: number | null
}

export type DecideSuggestedChangeResult =
  | {
    readonly ok: true
    readonly value: SuggestedChangeDecisionAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'suggested-change-not-found'
      readonly message: string
      readonly suggestedChangeId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'suggested-change-revision-conflict'
      readonly message: string
      readonly expectedSuggestedChangeRevision: number
      readonly currentSuggestedChangeRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'suggested-change-stale'
      readonly message: string
      readonly baseTeamRevision: number
      readonly currentTeamRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'suggested-change-state-conflict'
      readonly message: string
      readonly status: SuggestedChangeEffectiveStatus
      readonly attemptedMode: DecideSuggestedChangeRequest['mode']
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'risk-acknowledgement-mismatch'
      readonly message: string
      readonly requiredRiskLevel: SuggestedChangeRiskLevel
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'no-op-suggested-change'
      readonly message: string
    }
  }
  | { readonly ok: false; readonly error: ProjectMemberNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'member-inactive' | 'accountable-also-contributor'
      readonly message: string
      readonly memberId: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'human-sponsor-required' | 'human-sponsor-forbidden'
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

/** Closed Feishu deployment realm. International Lark is a later, separately tested realm. */
export type FeishuRealm = 'feishu-cn'

/** One explicit external actor route. These routes are never fallback candidates for each other. */
export type FeishuIdentityKind = 'bot' | 'user'

/** Stable singleton connection aggregate owned by one authorized organization/team. */
export const FEISHU_CONNECTION_ID = 'feishu-primary'

/** Value-free DSH credential-reference status safe for an authorized settings page. */
export interface FeishuCredentialProjection {
  readonly ref: string | null
  readonly configured: boolean
  readonly source: string | null
  readonly writable: boolean
}

/** Immutable subject binding established by the first successful verification of a route generation. */
export interface FeishuActorBinding {
  readonly connectionId: typeof FEISHU_CONNECTION_ID
  readonly realm: FeishuRealm
  readonly appId: string
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly openId: string
  readonly tenantKey: string | null
}

/** Closed recovery action rendered as trusted copy rather than raw provider advice. */
export type FeishuConnectionRecoveryCode =
  | 'configure-credential'
  | 'rotate-credential'
  | 'enable-app'
  | 'grant-app-scope'
  | 'reauthorize-user'
  | 'expand-app-data-range'
  | 'share-resource'
  | 'check-resource-id'
  | 'reset-identity-binding'
  | 'retry-later'
  | 'inspect-provider'

/** Provider-neutral, redacted connection or permission failure. */
export type FeishuConnectionIssueCode =
  | 'credential-unconfigured'
  | 'credential-invalid'
  | 'credential-expired'
  | 'user-authorization-revoked'
  | 'app-disabled'
  | 'missing-app-scope'
  | 'missing-user-grant'
  | 'outside-app-data-range'
  | 'resource-access-unavailable'
  | 'resource-not-found'
  | 'unsupported-actor'
  | 'identity-continuity-mismatch'
  | 'tenant-mismatch'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'provider-response-invalid'
  | 'unknown-provider-error'

export interface FeishuConnectionIssue {
  readonly code: FeishuConnectionIssueCode
  readonly recovery: FeishuConnectionRecoveryCode
  /** Only allowlisted scope names; provider messages and numeric error codes never cross. */
  readonly missingScopes: readonly string[]
  readonly grantPlane: 'application' | 'user-consent' | null
  /** Safe absolute retry instant when the provider supplied bounded rate-limit information. */
  readonly retryAt: string | null
}

/** A scope fact must state what was actually observed; configured is not effective or probed. */
export interface FeishuScopeObservation {
  readonly scope: string
  readonly tokenType: 'tenant' | 'user'
  readonly state: 'configured' | 'verified' | 'missing' | 'unknown'
}

/** Optional T07 read-only diagnostic target. It is not a Project resource binding. */
export interface FeishuTaskListProbe {
  readonly kind: 'task-list'
  readonly resourceId: string
}

export type FeishuResourceProbeProjection =
  | { readonly state: 'not-tested' }
  | {
    readonly state: 'accessible'
    readonly kind: 'task-list'
    readonly resourceId: string
  }
  | {
    readonly state: 'unavailable'
    readonly kind: 'task-list'
    readonly resourceId: string
    readonly issue: FeishuConnectionIssue
  }

/** Last append-only verification fact for one exact route generation. */
export interface FeishuVerificationProjection {
  readonly verificationId: string
  readonly sequence: number
  readonly routeGeneration: number
  readonly checkedAt: string
  readonly result: 'healthy' | 'attention' | 'failed'
  readonly identity: {
    readonly state: 'verified' | 'failed'
    readonly issue: FeishuConnectionIssue | null
  }
  readonly scopeInspection: {
    readonly state: 'observed' | 'unavailable' | 'not-inspected'
    readonly scopes: readonly FeishuScopeObservation[]
    readonly issue: FeishuConnectionIssue | null
  }
  readonly resourceProbe: FeishuResourceProbeProjection
}

/** One Bot/User card in the Connection Center. */
export interface FeishuIdentityRouteProjection {
  readonly kind: FeishuIdentityKind
  readonly state: 'unconfigured' | 'configured' | 'disabled'
  readonly generation: number | null
  readonly appId: string | null
  readonly credential: FeishuCredentialProjection
  readonly actor: FeishuActorBinding | null
  readonly displayLabel: string | null
  readonly lastVerification: FeishuVerificationProjection | null
}

/** Authorized singleton settings projection; it contains references, never credential values. */
export interface FeishuConnectionCenterProjection {
  readonly connectionId: typeof FEISHU_CONNECTION_ID
  readonly realm: FeishuRealm
  readonly revision: number
  readonly bot: FeishuIdentityRouteProjection
  readonly user: FeishuIdentityRouteProjection
  readonly updatedAt: string | null
}

interface FeishuRouteCommandBase {
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number | null
  readonly idempotencyKey: string
  readonly causationId: string
}

/** Configure, explicitly reset, or disable one route without accepting a credential value. */
export type ConfigureFeishuIdentityRouteRequest =
  | FeishuRouteCommandBase & {
    readonly mode: 'set'
    readonly appId: string
    readonly credentialRef: string
    readonly reason: 'owner-feishu-route-configure'
  }
  | FeishuRouteCommandBase & {
    readonly mode: 'reset'
    readonly appId?: never
    readonly credentialRef?: never
    readonly reason: 'owner-feishu-route-reset'
  }
  | FeishuRouteCommandBase & {
    readonly mode: 'disable'
    readonly appId?: never
    readonly credentialRef?: never
    readonly reason: 'owner-feishu-route-disable'
  }

export interface ConfigureFeishuIdentityRouteAcknowledgement {
  readonly connectionId: typeof FEISHU_CONNECTION_ID
  readonly connectionRevision: number
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly state: 'configured' | 'disabled'
}

export type ConfigureFeishuIdentityRouteResult =
  | {
    readonly ok: true
    readonly value: ConfigureFeishuIdentityRouteAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'connection-revision-conflict'
      readonly message: string
      readonly expectedConnectionRevision: number
      readonly currentConnectionRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-generation-conflict'
      readonly message: string
      readonly kind: FeishuIdentityKind
      readonly expectedRouteGeneration: number | null
      readonly currentRouteGeneration: number | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-unconfigured' | 'no-op-route-configuration'
      readonly message: string
      readonly kind: FeishuIdentityKind
    }
  }

/** Read-only provider verification against one exact current route generation. */
export interface VerifyFeishuIdentityRouteRequest extends FeishuRouteCommandBase {
  readonly resourceProbe?: FeishuTaskListProbe
  readonly reason: 'owner-feishu-route-verify'
}

export interface VerifyFeishuIdentityRouteAcknowledgement {
  readonly connectionId: typeof FEISHU_CONNECTION_ID
  readonly connectionRevision: number
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly verificationSequence: number
  readonly result: 'healthy' | 'attention' | 'failed'
}

export type VerifyFeishuIdentityRouteResult =
  | {
    readonly ok: true
    readonly value: VerifyFeishuIdentityRouteAcknowledgement
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'connection-revision-conflict'
      readonly message: string
      readonly expectedConnectionRevision: number
      readonly currentConnectionRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-generation-conflict'
      readonly message: string
      readonly kind: FeishuIdentityKind
      readonly expectedRouteGeneration: number | null
      readonly currentRouteGeneration: number | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-unconfigured' | 'route-disabled'
      readonly message: string
      readonly kind: FeishuIdentityKind
    }
  }

/** One safe Feishu member projection. Provider-specific payloads never cross the Host boundary. */
export interface FeishuTaskMemberProjection {
  readonly openId: string
  readonly name: string | null
}

/** One authoritative Feishu task comment retained in the local read projection. */
export interface FeishuTaskCommentProjection {
  readonly commentId: string
  readonly content: string
  readonly creator: FeishuTaskMemberProjection | null
  readonly replyToCommentId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Why one task is visible inside a Project scope. */
export type ProjectTaskScope = 'primary-list' | 'explicit-reference'

/** Feishu-authoritative task data copied into the Workbench read model. */
export interface ProjectTaskProjection {
  readonly taskGuid: string
  readonly taskId: string | null
  readonly scope: ProjectTaskScope
  readonly parentTaskGuid: string | null
  readonly summary: string
  readonly description: string
  readonly assignees: readonly FeishuTaskMemberProjection[]
  readonly followers: readonly FeishuTaskMemberProjection[]
  readonly comments: readonly FeishuTaskCommentProjection[]
  readonly completed: boolean
  readonly completedAt: string | null
  readonly canonicalUrl: string
  /** Opaque Feishu `updated_at` token carried by every Workbench-originated write. */
  readonly remoteVersion: string
  readonly projectionRevision: number
}

/** Exact Bot/User route pinned by the Project task-list binding. */
export interface ProjectTaskListIdentityProjection {
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly appId: string
  readonly openId: string
  readonly tenantKey: string | null
}

/** The unique primary task-list identity and canonical link for one Project. */
export interface ProjectTaskListBindingProjection {
  readonly taskListGuid: string
  readonly name: string
  readonly canonicalUrl: string
  readonly identity: ProjectTaskListIdentityProjection
  readonly createdByWorkbench: boolean
  readonly remoteVersion: string
  readonly boundAt: string
}

export type ProjectTaskSyncState = 'unbound' | 'healthy' | 'attention' | 'unknown'

/** Safe reconciliation health; the original provider response is never persisted or rendered. */
export interface ProjectTaskSyncProjection {
  readonly state: ProjectTaskSyncState
  readonly lastEventAt: string | null
  readonly lastReconciledAt: string | null
  readonly lastAttemptAt: string | null
  readonly issue: FeishuConnectionIssue | null
}

/** Observable state of one Workbench-originated Feishu task mutation. */
export interface FeishuTaskMutationEffectProjection {
  readonly effectId: string
  readonly taskGuid: string
  readonly state: 'prepared' | 'delivered' | 'unknown' | 'failed' | 'conflict'
  readonly expectedRemoteVersion: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** One logical template state. Stable IDs survive display-name and color changes. */
export interface ProjectTaskWorkflowStateDefinition {
  readonly stateId: string
  readonly name: string
  readonly colorIndex: number
  readonly allowedNextStateIds: readonly string[]
}

/** Owner-defined workflow schema mapped to one Feishu single-select custom field. */
export interface ProjectTaskWorkflowDefinition {
  readonly fieldName: string
  readonly initialStateId: string
  readonly terminalStateIds: readonly string[]
  readonly states: readonly ProjectTaskWorkflowStateDefinition[]
}

/** Stable Feishu option identity retained for one logical template state. */
export interface ProjectTaskWorkflowOptionProjection {
  readonly stateId: string
  readonly optionGuid: string
  readonly name: string
  readonly colorIndex: number
  readonly hidden: boolean
  readonly usedTaskCount: number
}

export interface ProjectTaskWorkflowCompatibilityIssue {
  readonly code:
    | 'field-missing'
    | 'field-type-mismatch'
    | 'field-version-changed'
    | 'option-missing'
    | 'option-hidden'
    | 'option-name-changed'
    | 'used-state-removal'
    | 'duplicate-visible-option-name'
    | 'task-state-unmapped'
  readonly severity: 'attention' | 'blocked'
  readonly stateId: string | null
  readonly taskGuid: string | null
  readonly message: string
}

/** Feishu-authoritative workflow value for one projected task. */
export interface ProjectTaskWorkflowValueProjection {
  readonly taskGuid: string
  readonly stateId: string | null
  readonly optionGuid: string | null
  readonly stateName: string | null
  readonly recognized: boolean
}

/** Terminal workflow state is a suggestion only; completion still needs an Owner command. */
export interface FeishuTaskCompletionSuggestionProjection {
  readonly taskGuid: string
  readonly stateId: string
  readonly stateName: string
  readonly reason: 'terminal-state-awaiting-owner-confirmation'
}

/** Complete template-to-Feishu workflow mapping for one Project. */
export interface ProjectTaskWorkflowProjection {
  readonly revision: number
  readonly definition: ProjectTaskWorkflowDefinition
  readonly field: {
    readonly fieldGuid: string
    readonly name: string
    readonly type: 'single_select'
    readonly remoteVersion: string
  }
  readonly options: readonly ProjectTaskWorkflowOptionProjection[]
  readonly values: readonly ProjectTaskWorkflowValueProjection[]
  readonly compatibility: {
    readonly state: 'compatible' | 'attention' | 'blocked'
    readonly issues: readonly ProjectTaskWorkflowCompatibilityIssue[]
  }
  readonly completionSuggestions: readonly FeishuTaskCompletionSuggestionProjection[]
  readonly configuredAt: string
  readonly updatedAt: string
}

/** Complete Host-owned task workspace projection for one visible Project. */
export interface ProjectTasksProjection {
  readonly projectId: string
  readonly revision: number
  readonly binding: ProjectTaskListBindingProjection | null
  readonly tasks: readonly ProjectTaskProjection[]
  readonly sync: ProjectTaskSyncProjection
  readonly effects: readonly FeishuTaskMutationEffectProjection[]
  readonly workflow: ProjectTaskWorkflowProjection | null
}

export interface ProjectTasksQuery {
  readonly projectId: string
}

/** One selectable task list returned by an explicit, exact-identity provider read. */
export interface FeishuTaskListCandidateProjection {
  readonly taskListGuid: string
  readonly name: string
  readonly canonicalUrl: string
  readonly remoteVersion: string
}

export interface DiscoverFeishuTaskListsRequest {
  readonly projectId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
}

export interface FeishuTaskListDiscoveryProjection {
  readonly projectId: string
  readonly connectionRevision: number
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly items: readonly FeishuTaskListCandidateProjection[]
}

interface BindFeishuTaskListRequestBase {
  readonly projectId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly expectedBindingRevision: null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-list-bind'
}

/** Bind an accessible list or create one through the exact selected Feishu identity. */
export type BindFeishuTaskListRequest =
  | BindFeishuTaskListRequestBase & {
    readonly mode: 'existing'
    readonly taskListGuid: string
    readonly name?: never
  }
  | BindFeishuTaskListRequestBase & {
    readonly mode: 'create'
    readonly taskListGuid?: never
    readonly name: string
  }

export type BindFeishuTaskListResult =
  | {
    readonly ok: true
    readonly value: ProjectTasksProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-list-already-bound'
      readonly message: string
      readonly current: ProjectTasksProjection
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'connection-revision-conflict'
      readonly message: string
      readonly expectedConnectionRevision: number
      readonly currentConnectionRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-generation-conflict'
      readonly message: string
      readonly kind: FeishuIdentityKind
      readonly expectedRouteGeneration: number
      readonly currentRouteGeneration: number | null
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'route-unconfigured' | 'route-disabled' | 'route-unverified'
      readonly message: string
      readonly kind: FeishuIdentityKind
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'remote-outcome-unknown' | 'remote-rejected'
      readonly message: string
      readonly issue: FeishuConnectionIssue
    }
  }

export interface ReconcileProjectTasksRequest {
  readonly projectId: string
  readonly expectedRevision: number
}

export type ReconcileProjectTasksResult =
  | { readonly ok: true; readonly value: ProjectTasksProjection }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-list-unbound'
      readonly message: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-projection-revision-conflict'
      readonly message: string
      readonly expectedRevision: number
      readonly currentRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'remote-rejected'
      readonly message: string
      readonly issue: FeishuConnectionIssue
    }
  }

export interface ReferenceFeishuTaskRequest {
  readonly projectId: string
  readonly taskGuid: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-reference'
}

export type ReferenceFeishuTaskResult =
  | {
    readonly ok: true
    readonly value: ProjectTasksProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-list-unbound'
      readonly message: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-projection-revision-conflict'
      readonly message: string
      readonly expectedRevision: number
      readonly currentRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-already-in-project'
      readonly message: string
      readonly taskGuid: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'remote-rejected'
      readonly message: string
      readonly issue: FeishuConnectionIssue
    }
  }

export interface UpdateFeishuTaskRequest {
  readonly projectId: string
  readonly taskGuid: string
  readonly expectedRevision: number
  readonly expectedRemoteVersion: string
  /** Required exactly when `changes.workflowStateId` is present. */
  readonly expectedWorkflowRevision?: number
  readonly changes: {
    readonly summary?: string
    readonly description?: string
    readonly completed?: boolean
    readonly workflowStateId?: string
  }
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-update'
}

export type UpdateFeishuTaskResult =
  | {
    readonly ok: true
    readonly value: ProjectTasksProjection
    readonly effect: FeishuTaskMutationEffectProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-list-unbound' | 'task-not-in-project'
      readonly message: string
      readonly taskGuid?: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'task-projection-revision-conflict'
      readonly message: string
      readonly expectedRevision: number
      readonly currentRevision: number
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'remote-version-conflict'
      readonly message: string
      readonly taskGuid: string
      readonly expectedRemoteVersion: string
      readonly currentRemoteVersion: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'workflow-unconfigured'
        | 'workflow-revision-conflict'
        | 'workflow-transition-forbidden'
        | 'workflow-state-unmapped'
        | 'workflow-value-unrecognized'
      readonly message: string
      readonly expectedWorkflowRevision?: number
      readonly currentWorkflowRevision?: number
      readonly currentStateId?: string | null
      readonly requestedStateId?: string
    }
  }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'remote-outcome-unknown' | 'remote-rejected'
      readonly message: string
      readonly effect: FeishuTaskMutationEffectProjection
      readonly issue: FeishuConnectionIssue
    }
  }

/** One safe custom-field option returned by explicit workflow-field discovery. */
export interface FeishuTaskWorkflowFieldOptionCandidate {
  readonly optionGuid: string
  readonly name: string
  readonly colorIndex: number
  readonly hidden: boolean
}

/** One task-list custom field; non-single-select fields are visible but cannot be mapped. */
export interface FeishuTaskWorkflowFieldCandidate {
  readonly fieldGuid: string
  readonly name: string
  readonly type: string
  readonly remoteVersion: string
  readonly options: readonly FeishuTaskWorkflowFieldOptionCandidate[]
}

export interface DiscoverFeishuTaskWorkflowFieldsRequest {
  readonly projectId: string
  readonly expectedTaskRevision: number
}

export interface FeishuTaskWorkflowFieldDiscoveryProjection {
  readonly projectId: string
  readonly taskListGuid: string
  readonly taskRevision: number
  readonly items: readonly FeishuTaskWorkflowFieldCandidate[]
}

export type ConfigureFeishuTaskWorkflowMapping =
  | { readonly mode: 'create' }
  | {
    readonly mode: 'existing'
    readonly fieldGuid: string
    readonly options: readonly {
      readonly stateId: string
      readonly optionGuid: string
    }[]
  }
  | { readonly mode: 'migrate' }

export interface PreviewFeishuTaskWorkflowRequest {
  readonly projectId: string
  readonly expectedTaskRevision: number
  readonly expectedWorkflowRevision: number | null
  readonly definition: ProjectTaskWorkflowDefinition
  readonly mapping: ConfigureFeishuTaskWorkflowMapping
}

export interface FeishuTaskWorkflowCompatibilityPreview {
  readonly projectId: string
  readonly taskRevision: number
  readonly workflowRevision: number | null
  readonly definition: ProjectTaskWorkflowDefinition
  readonly mapping: ConfigureFeishuTaskWorkflowMapping
  readonly compatibility: ProjectTaskWorkflowProjection['compatibility']
  readonly usedStateIds: readonly string[]
}

export interface ConfigureFeishuTaskWorkflowRequest extends PreviewFeishuTaskWorkflowRequest {
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-workflow-configure'
}

export type ConfigureFeishuTaskWorkflowResult =
  | {
    readonly ok: true
    readonly value: ProjectTasksProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'task-list-unbound'
        | 'task-projection-revision-conflict'
        | 'workflow-revision-conflict'
        | 'workflow-compatibility-blocked'
        | 'remote-outcome-unknown'
        | 'remote-rejected'
      readonly message: string
      readonly compatibility?: ProjectTaskWorkflowProjection['compatibility']
      readonly issue?: FeishuConnectionIssue
    }
  }

/** Normalized event accepted only from a trusted Host connector, never from the browser. */
export interface FeishuTaskEventInput {
  readonly eventId: string
  readonly taskListGuid: string
  readonly taskGuid: string
  readonly kind: 'upsert' | 'removed'
  readonly remoteVersion: string
  readonly occurredAt: string
}

export interface FeishuTaskEventResult {
  readonly outcome: 'applied' | 'duplicate' | 'stale' | 'ignored'
  readonly projectId: string | null
  readonly projectionRevision: number | null
}

/** Closed formal-date value shared by Milestone commands and projections. */
export type ProjectCalendarSchedule =
  | {
    readonly kind: 'all-day'
    readonly startDate: string
    /** Exclusive ISO calendar date. */
    readonly endDate: string
  }
  | {
    readonly kind: 'timed'
    readonly startAt: string
    readonly endAt: string
    readonly timeZone: string
  }

export type FeishuCalendarRole =
  | 'unknown'
  | 'free_busy_reader'
  | 'reader'
  | 'writer'
  | 'owner'
export type FeishuCalendarType = 'primary' | 'shared' | 'resource' | 'unknown'

/** One calendar returned only by explicit exact-route discovery. */
export interface FeishuCalendarCandidateProjection {
  readonly calendarId: string
  readonly summary: string
  readonly description: string | null
  readonly calendarType: FeishuCalendarType
  readonly role: FeishuCalendarRole
  readonly deleted: boolean
  readonly thirdParty: boolean
  readonly selectable: boolean
}

export interface DiscoverFeishuCalendarsRequest {
  readonly projectId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
}

export interface FeishuCalendarDiscoveryProjection {
  readonly projectId: string
  readonly connectionRevision: number
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly items: readonly FeishuCalendarCandidateProjection[]
}

export interface ProjectCalendarIdentityProjection {
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly appId: string
  readonly openId: string
  readonly tenantKey: string | null
}

export interface ProjectCalendarBindingProjection {
  readonly calendarId: string
  readonly summary: string
  readonly calendarType: 'primary' | 'shared'
  readonly role: 'writer' | 'owner'
  readonly identity: ProjectCalendarIdentityProjection
  readonly createdByWorkbench: boolean
  readonly revision: number
  readonly boundAt: string
}

export type ProjectCalendarSyncState = 'unbound' | 'healthy' | 'attention' | 'unknown'

export interface ProjectCalendarSyncProjection {
  readonly state: ProjectCalendarSyncState
  readonly lastEventAt: string | null
  readonly lastReconciledAt: string | null
  readonly lastAttemptAt: string | null
  readonly issue: FeishuConnectionIssue | null
}

export interface ProjectMilestoneProjection {
  readonly milestoneId: string
  readonly name: string
  readonly description: string | null
  readonly eventId: string
  readonly eventAppLink: string
  readonly schedule: ProjectCalendarSchedule
  readonly remoteStatus: 'confirmed' | 'cancelled' | 'unknown'
  /** Workbench digest of an exact provider observation, never provider CAS. */
  readonly remoteObservationVersion: string
  readonly syncState: 'healthy' | 'attention' | 'unknown'
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastObservedAt: string
}

export interface ProjectScheduleChangeProjection {
  readonly changeId: string
  readonly projectRevision: number
  readonly milestoneId: string
  readonly milestoneRevision: number
  readonly source: 'workbench' | 'feishu'
  readonly changedFields: readonly (
    'schedule' | 'remote-status' | 'event-link' | 'remote-eligibility'
  )[]
  readonly beforeSchedule: ProjectCalendarSchedule | null
  readonly afterSchedule: ProjectCalendarSchedule
  readonly occurredAt: string
}

export interface FeishuCalendarMutationEffectProjection {
  readonly effectId: string
  readonly operation: 'calendar-create' | 'event-create' | 'event-date-update'
  readonly milestoneId: string | null
  readonly state: 'prepared' | 'delivered' | 'unknown' | 'failed' | 'conflict'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Complete authorized Project Calendar and Milestone projection. */
export interface ProjectMilestonesProjection {
  readonly projectId: string
  readonly revision: number
  readonly binding: ProjectCalendarBindingProjection | null
  readonly milestones: readonly ProjectMilestoneProjection[]
  readonly sync: ProjectCalendarSyncProjection
  readonly effects: readonly FeishuCalendarMutationEffectProjection[]
  readonly recentChanges: readonly ProjectScheduleChangeProjection[]
}

export interface ProjectMilestonesQuery {
  readonly projectId: string
}

interface BindProjectCalendarRequestBase {
  readonly projectId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly expectedBindingRevision: null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-calendar-bind'
}

export type BindProjectCalendarRequest =
  | BindProjectCalendarRequestBase & {
    readonly mode: 'existing'
    readonly calendarId: string
    readonly summary?: never
    readonly description?: never
  }
  | BindProjectCalendarRequestBase & {
    readonly mode: 'create'
    readonly calendarId?: never
    readonly summary: string
    readonly description?: string | null
  }

export type BindProjectCalendarResult =
  | {
    readonly ok: true
    readonly value: ProjectMilestonesProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'calendar-already-bound'
        | 'calendar-already-used'
        | 'calendar-not-selectable'
        | 'connection-revision-conflict'
        | 'route-generation-conflict'
        | 'route-unconfigured'
        | 'route-disabled'
        | 'route-unverified'
        | 'remote-outcome-unknown'
        | 'remote-rejected'
      readonly message: string
      readonly issue?: FeishuConnectionIssue
      readonly current?: ProjectMilestonesProjection
    }
  }

/** One non-recurring event returned by explicit discovery on the bound calendar. */
export interface FeishuCalendarEventCandidateProjection {
  readonly eventId: string
  readonly summary: string
  readonly description: string | null
  readonly schedule: ProjectCalendarSchedule
  readonly remoteStatus: 'confirmed' | 'cancelled' | 'unknown'
  readonly recurring: boolean
  readonly exception: boolean
  readonly organizerMatchesCalendar: boolean
  readonly eventAppLink: string
  readonly remoteObservationVersion: string
  readonly selectable: boolean
}

export interface DiscoverFeishuCalendarEventsRequest {
  readonly projectId: string
  readonly expectedRevision: number
}

export interface FeishuCalendarEventDiscoveryProjection {
  readonly projectId: string
  readonly revision: number
  readonly calendarId: string
  readonly items: readonly FeishuCalendarEventCandidateProjection[]
}

interface CreateProjectMilestoneRequestBase {
  readonly projectId: string
  readonly expectedRevision: number
  readonly expectedMilestoneRevision: null
  readonly name: string
  readonly description?: string | null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-milestone-create'
}

export type CreateProjectMilestoneRequest =
  | CreateProjectMilestoneRequestBase & {
    readonly mode: 'existing-event'
    readonly eventId: string
    readonly schedule?: never
  }
  | CreateProjectMilestoneRequestBase & {
    readonly mode: 'create-event'
    readonly eventId?: never
    readonly schedule: ProjectCalendarSchedule
  }

export type CreateProjectMilestoneResult =
  | {
    readonly ok: true
    readonly value: ProjectMilestonesProjection
    readonly milestone: ProjectMilestoneProjection
    readonly effect: FeishuCalendarMutationEffectProjection | null
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'calendar-unbound'
        | 'project-schedule-revision-conflict'
        | 'event-already-used'
        | 'event-not-selectable'
        | 'milestone-limit-reached'
        | 'remote-outcome-unknown'
        | 'remote-rejected'
      readonly message: string
      readonly issue?: FeishuConnectionIssue
      readonly current?: ProjectMilestonesProjection
    }
  }

export interface UpdateProjectMilestoneDateRequest {
  readonly projectId: string
  readonly milestoneId: string
  readonly expectedRevision: number
  readonly expectedMilestoneRevision: number
  readonly expectedRemoteObservationVersion: string
  readonly schedule: ProjectCalendarSchedule
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-project-milestone-date-update'
}

export type UpdateProjectMilestoneDateResult =
  | {
    readonly ok: true
    readonly value: ProjectMilestonesProjection
    readonly milestone: ProjectMilestoneProjection
    readonly effect: FeishuCalendarMutationEffectProjection
    readonly receipt: WorkbenchCommandReceipt
  }
  | { readonly ok: false; readonly error: IdempotencyConflict }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'calendar-unbound'
        | 'milestone-not-found'
        | 'project-schedule-revision-conflict'
        | 'milestone-revision-conflict'
        | 'remote-version-changed'
        | 'event-not-selectable'
        | 'remote-outcome-unknown'
        | 'remote-rejected'
      readonly message: string
      readonly issue?: FeishuConnectionIssue
      readonly current?: ProjectMilestonesProjection
      readonly currentMilestone?: ProjectMilestoneProjection
      readonly effect?: FeishuCalendarMutationEffectProjection
    }
  }

export interface ReconcileProjectCalendarRequest {
  readonly projectId: string
  readonly expectedRevision: number
}

export type ReconcileProjectCalendarResult =
  | { readonly ok: true; readonly value: ProjectMilestonesProjection }
  | { readonly ok: false; readonly error: ProjectNotFoundConflict }
  | {
    readonly ok: false
    readonly error: {
      readonly code:
        | 'calendar-unbound'
        | 'project-schedule-revision-conflict'
        | 'remote-rejected'
      readonly message: string
      readonly issue?: FeishuConnectionIssue
      readonly current?: ProjectMilestonesProjection
    }
  }

/** Trusted calendar hint; never accepted from a browser Remote. */
export interface FeishuCalendarEventInput {
  readonly eventEnvelopeId: string
  readonly calendarId: string
  readonly eventId: string | null
  readonly occurredAt: string
}

export interface FeishuCalendarEventResult {
  readonly outcome: 'applied' | 'duplicate' | 'ignored'
  readonly projectId: string | null
  readonly revision: number | null
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
export type WorkbenchSuggestedChangeReason =
  | 'owner-suggested-change-propose'
  | 'owner-suggested-change-accept'
  | 'owner-suggested-change-edit-accept'
  | 'owner-suggested-change-reject'
  | 'owner-suggested-change-defer'
export type WorkbenchFeishuConnectionReason =
  | 'owner-feishu-route-configure'
  | 'owner-feishu-route-reset'
  | 'owner-feishu-route-disable'
  | 'owner-feishu-route-verify'
export type WorkbenchFeishuTaskReason =
  | 'owner-feishu-task-list-bind'
  | 'owner-feishu-task-reference'
  | 'owner-feishu-task-update'
  | 'owner-feishu-task-workflow-configure'
export type WorkbenchProjectCalendarReason =
  | 'owner-project-calendar-bind'
  | 'owner-project-milestone-create'
  | 'owner-project-milestone-date-update'
export type WorkbenchCommandReason =
  | WorkbenchStatusChangeReason
  | WorkbenchProjectCreateReason
  | WorkbenchProjectTeamReason
  | WorkbenchSuggestedChangeReason
  | WorkbenchFeishuConnectionReason
  | WorkbenchFeishuTaskReason
  | WorkbenchProjectCalendarReason
export type WorkbenchAuditAction =
  | 'workbench.status.updated'
  | 'workbench.project.created'
  | 'workbench.project-member.created'
  | 'workbench.project-member.status-changed'
  | 'workbench.project.responsibility-assigned'
  | 'workbench.suggested-change.proposed'
  | 'workbench.suggested-change.accepted'
  | 'workbench.suggested-change.edited-accepted'
  | 'workbench.suggested-change.rejected'
  | 'workbench.suggested-change.deferred'
  | 'workbench.feishu-route.configured'
  | 'workbench.feishu-route.reset'
  | 'workbench.feishu-route.disabled'
  | 'workbench.feishu-route.verification-recorded'
  | 'workbench.feishu-task-list.bound'
  | 'workbench.feishu-task.referenced'
  | 'workbench.feishu-task.update-requested'
  | 'workbench.feishu-task-workflow.configured'
  | 'workbench.project-calendar.bound'
  | 'workbench.project-milestone.created'
  | 'workbench.project-milestone.date-update-requested'
export type WorkbenchAuditObjectType =
  | 'workbench-status'
  | 'project'
  | 'project-member'
  | 'project-responsibility'
  | 'suggested-change'
  | 'feishu-connection'
  | 'feishu-task-list-binding'
  | 'feishu-task'
  | 'feishu-task-workflow'
  | 'project-calendar-binding'
  | 'project-milestone'
export type WorkbenchActivitySummaryCode =
  | 'status-revision-committed'
  | 'project-created-from-template'
  | 'project-member-created'
  | 'project-member-status-changed'
  | 'project-responsibility-assigned'
  | 'suggested-change-proposed'
  | 'suggested-change-accepted'
  | 'suggested-change-edited-accepted'
  | 'suggested-change-rejected'
  | 'suggested-change-deferred'
  | 'feishu-route-configured'
  | 'feishu-route-reset'
  | 'feishu-route-disabled'
  | 'feishu-route-verification-healthy'
  | 'feishu-route-verification-attention'
  | 'feishu-route-verification-failed'
  | 'feishu-task-list-bound'
  | 'feishu-task-referenced'
  | 'feishu-task-update-requested'
  | 'feishu-task-workflow-configured'
  | 'project-calendar-bound'
  | 'project-milestone-created'
  | 'project-milestone-date-update-requested'

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
