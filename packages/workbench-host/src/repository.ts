import type {
  AddProjectMemberResult,
  ConfigureFeishuIdentityRouteResult,
  ConfigureFeishuTaskWorkflowResult,
  CreateProjectResult,
  DecideSuggestedChangeResult,
  BindFeishuTaskListResult,
  FeishuTaskEventInput,
  FeishuTaskEventResult,
  FeishuTaskMutationEffectProjection,
  FeishuActorBinding,
  FeishuConnectionIssue,
  FeishuIdentityKind,
  FeishuResourceProbeProjection,
  FeishuScopeObservation,
  OutcomeMetric,
  ProjectResponsibilitySuggestedValue,
  ProjectDetailProjection,
  ProjectMemberDraft,
  ProjectMemberStatus,
  ProjectQuery,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
  ProjectTaskListBindingProjection,
  ProjectTasksProjection,
  ProjectTeamProjection,
  ProjectTemplateSelection,
  ProposeProjectResponsibilityChangeResult,
  ReconcileProjectTasksResult,
  ReferenceFeishuTaskResult,
  ReviewCenterFilter,
  ReviewCenterProjection,
  SuggestedChangeEvidenceRef,
  SuggestedChangeRiskLevel,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
  SetStatusResult,
  VerifyFeishuIdentityRouteResult,
  UpdateFeishuTaskResult,
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxErrorCode,
  WorkbenchOutboxState,
  WorkbenchCommandReason,
  WorkbenchStatusChangeReason,
  WorkbenchStatusSnapshot,
} from './client.ts'
import type {
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
} from './feishu-task-federation.ts'
import type { WorkbenchFeishuTaskWorkflowValueObservation } from './feishu-task-workflow.ts'

/** Authenticated actor copied from the Host-only authorization scope. */
export interface WorkbenchCommandActor {
  readonly kind: 'owner'
  readonly id: string
  readonly organizationId: string
  readonly teamId: string
}

/** Generated command facts that are never accepted from browser actor fields. */
export interface WorkbenchCommandMetadata {
  readonly commandId: string
  readonly auditEventId: string
  readonly outboxId: string
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: WorkbenchCommandReason
  readonly actor: WorkbenchCommandActor
  readonly occurredAt: string
}

/** Provider-neutral write material prepared by the command boundary. */
export interface WorkbenchStatusMutation {
  readonly candidateId: string
  readonly message: string
  readonly expectedRevision: number | null
  readonly updatedAt: string
  readonly command: WorkbenchCommandMetadata & { readonly reason: WorkbenchStatusChangeReason }
}

/** One generated Outcome row aligned with its normalized request position. */
export interface WorkbenchOutcomeMutation {
  readonly outcomeId: string
  readonly name: string
  readonly metric: OutcomeMetric
}

/** Provider-neutral aggregate material for one atomic Project creation. */
export interface WorkbenchProjectMutation {
  readonly projectId: string
  readonly primaryGoalId: string
  readonly projectName: string
  readonly primaryGoal: {
    readonly name: string
    readonly outcomes: readonly WorkbenchOutcomeMutation[]
  }
  readonly supportingGoals: readonly {
    readonly goalId: string
    readonly expectedRevision: number
  }[]
  readonly template: ProjectTemplateSelection
  readonly expectedCatalogRevision: number
  readonly expectedRevision: null
  readonly createdAt: string
  readonly command: WorkbenchCommandMetadata & { readonly reason: 'owner-project-create' }
}

/** Provider-neutral aggregate material for one Project-scoped roster addition. */
export interface WorkbenchProjectMemberMutation {
  readonly projectId: string
  readonly memberId: string
  readonly member: ProjectMemberDraft
  readonly expectedTeamRevision: number
  readonly expectedRevision: null
  readonly createdAt: string
  readonly command: WorkbenchCommandMetadata & { readonly reason: 'owner-project-member-add' }
}

/** Provider-neutral status transition retaining the immutable member identity row. */
export interface WorkbenchProjectMemberStatusMutation {
  readonly projectId: string
  readonly memberId: string
  readonly status: ProjectMemberStatus
  readonly expectedTeamRevision: number
  readonly expectedMemberRevision: number
  readonly updatedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-project-member-status-change'
  }
}

/** Provider-neutral whole Project Responsibility replacement. */
export interface WorkbenchProjectResponsibilityMutation {
  readonly projectId: string
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly expectedTeamRevision: number
  readonly expectedResponsibilityRevision: number | null
  readonly updatedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-project-responsibility-set'
  }
}

/** Provider-neutral immutable proposal material; source/diff/risk remain repository-derived. */
export interface WorkbenchSuggestedChangeProposalMutation {
  readonly suggestedChangeId: string
  readonly projectId: string
  readonly candidate: ProjectResponsibilitySuggestedValue
  readonly evidenceRefs: readonly SuggestedChangeEvidenceRef[]
  readonly expectedTeamRevision: number
  readonly expectedRevision: null
  readonly createdAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-suggested-change-propose'
  }
}

interface WorkbenchSuggestedChangeDecisionMutationBase {
  readonly decisionId: string
  readonly projectId: string
  readonly suggestedChangeId: string
  readonly expectedSuggestedChangeRevision: number
  readonly feedback: string
  readonly decidedAt: string
}

/** One closed Owner disposition; immutable target base is loaded from the proposal. */
export type WorkbenchSuggestedChangeDecisionMutation =
  | WorkbenchSuggestedChangeDecisionMutationBase & {
    readonly mode: 'accept'
    readonly acknowledgedRiskLevel: SuggestedChangeRiskLevel
    readonly candidate?: never
    readonly command: WorkbenchCommandMetadata & {
      readonly reason: 'owner-suggested-change-accept'
    }
  }

  | WorkbenchSuggestedChangeDecisionMutationBase & {
    readonly mode: 'edit-and-accept'
    readonly acknowledgedRiskLevel: SuggestedChangeRiskLevel
    readonly candidate: ProjectResponsibilitySuggestedValue
    readonly command: WorkbenchCommandMetadata & {
      readonly reason: 'owner-suggested-change-edit-accept'
    }
  }
  | WorkbenchSuggestedChangeDecisionMutationBase & {
    readonly mode: 'reject'
    readonly acknowledgedRiskLevel?: never
    readonly candidate?: never
    readonly command: WorkbenchCommandMetadata & {
      readonly reason: 'owner-suggested-change-reject'
    }
  }
  | WorkbenchSuggestedChangeDecisionMutationBase & {
    readonly mode: 'defer'
    readonly acknowledgedRiskLevel?: never
    readonly candidate?: never
    readonly command: WorkbenchCommandMetadata & {
      readonly reason: 'owner-suggested-change-defer'
    }
  }

/** Host-only connection-center read scope fixed by the authorized Owner. */
export interface WorkbenchFeishuConnectionQuery {
  readonly organizationId: string
  readonly teamId: string
}

/** SQLite-owned route facts before live DSH credential-description enrichment. */
export interface WorkbenchStoredFeishuIdentityRouteProjection {
  readonly kind: FeishuIdentityKind
  readonly state: 'unconfigured' | 'configured' | 'disabled'
  readonly generation: number | null
  readonly appId: string | null
  readonly credentialRef: string | null
  readonly actor: FeishuActorBinding | null
  readonly displayLabel: string | null
  readonly lastVerification: import('./client.ts').FeishuVerificationProjection | null
}

/** Durable connection truth; configured/source/writable stay owned by DSH Credentials. */
export interface WorkbenchStoredFeishuConnectionProjection {
  readonly connectionId: 'feishu-primary'
  readonly realm: 'feishu-cn'
  readonly revision: number
  readonly bot: WorkbenchStoredFeishuIdentityRouteProjection
  readonly user: WorkbenchStoredFeishuIdentityRouteProjection
  readonly updatedAt: string | null
}

/** One route-generation transition; credential values can never enter this shape. */
export interface WorkbenchFeishuRouteMutation {
  readonly kind: FeishuIdentityKind
  readonly mode: 'set' | 'reset' | 'disable'
  readonly appId: string | null
  readonly credentialRef: string | null
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number | null
  readonly updatedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason:
      | 'owner-feishu-route-configure'
      | 'owner-feishu-route-reset'
      | 'owner-feishu-route-disable'
  }
}

/** Safe provider observation produced outside the database transaction. */
export interface WorkbenchFeishuVerificationObservation {
  readonly result: 'healthy' | 'attention' | 'failed'
  readonly identity: {
    readonly state: 'verified' | 'failed'
    readonly issue: FeishuConnectionIssue | null
  }
  readonly actor: Omit<FeishuActorBinding, 'connectionId' | 'routeGeneration'> | null
  readonly displayLabel: string | null
  readonly scopeInspection: {
    readonly state: 'observed' | 'unavailable' | 'not-inspected'
    readonly scopes: readonly FeishuScopeObservation[]
    readonly issue: FeishuConnectionIssue | null
  }
  readonly resourceProbe: FeishuResourceProbeProjection
}

/** Append one verification fact against the exact route generation that was probed. */
export interface WorkbenchFeishuVerificationMutation {
  readonly verificationId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null
  readonly observation: WorkbenchFeishuVerificationObservation
  readonly checkedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-route-verify'
  }
}

/** Idempotency preflight used before any external provider call. */
export interface WorkbenchFeishuVerificationReplayQuery {
  readonly organizationId: string
  readonly teamId: string
  readonly actorId: string
  readonly kind: FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-route-verify'
}

/** Host-fixed scope for one Project task workspace read. */
export interface WorkbenchProjectTasksReadQuery extends ProjectQuery {
  readonly organizationId: string
  readonly teamId: string
}

/** Atomic primary-list binding material after the exact external observation succeeds. */
export interface WorkbenchFeishuTaskListBindingMutation {
  readonly projectId: string
  readonly intent:
    | { readonly mode: 'existing'; readonly taskListGuid: string }
    | { readonly mode: 'create'; readonly name: string }
  readonly expectedBindingRevision: null
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly route: WorkbenchFeishuTaskRoute
  readonly createdByWorkbench: boolean
  readonly snapshot: WorkbenchFeishuTaskListSnapshot
  readonly boundAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-task-list-bind'
  }
}

/** Side-effect-free replay check performed before a possible remote list create. */
export interface WorkbenchFeishuTaskListBindingReplayQuery {
  readonly organizationId: string
  readonly teamId: string
  readonly actorId: string
  readonly projectId: string
  readonly intent: WorkbenchFeishuTaskListBindingMutation['intent']
  readonly kind: import('./client.ts').FeishuIdentityKind
  readonly expectedConnectionRevision: number
  readonly expectedRouteGeneration: number
  readonly expectedBindingRevision: null
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-list-bind'
}

/** One complete replacement baseline from the bound authoritative task list. */
export interface WorkbenchFeishuTaskReconciliationMutation {
  readonly projectId: string
  readonly expectedRevision: number
  readonly snapshot: WorkbenchFeishuTaskListSnapshot
  readonly attemptedAt: string
}

/** Safe failed reconciliation fact; no provider body or credential can enter storage. */
export interface WorkbenchFeishuTaskReconciliationFailureMutation {
  readonly projectId: string
  readonly expectedRevision: number
  readonly attemptedAt: string
  readonly issue: FeishuConnectionIssue
}

/** Host-only exact binding target used by manual and periodic reconciliation. */
export interface WorkbenchFeishuTaskReconciliationTarget {
  readonly projectId: string
  readonly revision: number
  readonly taskListGuid: string
  readonly route: WorkbenchFeishuTaskRoute
}

/** Host-only workflow context; raw custom values never cross the Remote boundary. */
export interface WorkbenchFeishuTaskWorkflowContext {
  readonly project: ProjectTasksProjection
  readonly target: WorkbenchFeishuTaskReconciliationTarget
  readonly taskValues: readonly WorkbenchFeishuTaskWorkflowValueObservation[]
}

export interface WorkbenchFeishuTaskWorkflowMappedField {
  readonly fieldGuid: string
  readonly name: string
  readonly remoteVersion: string
  readonly options: readonly {
    readonly stateId: string
    readonly optionGuid: string
    readonly name: string
    readonly colorIndex: number
    readonly hidden: boolean
  }[]
}

/** Exact authoritative field observation committed after create/map/migrate. */
export interface WorkbenchFeishuTaskWorkflowConfigurationMutation {
  /** Present only after a create/migrate provider write was durably reserved and claimed. */
  readonly operationId?: string
  readonly projectId: string
  readonly expectedTaskRevision: number
  readonly expectedWorkflowRevision: number | null
  readonly definition: ProjectTaskWorkflowDefinition
  readonly mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping
  readonly field: WorkbenchFeishuTaskWorkflowMappedField
  readonly compatibility: ProjectTaskWorkflowProjection['compatibility']
  readonly configuredAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-task-workflow-configure'
  }
}

/** Durable one-attempt reservation for non-idempotent workflow field create/PATCH. */
export interface WorkbenchFeishuTaskWorkflowOperationMutation {
  readonly operationId: string
  readonly projectId: string
  readonly expectedTaskRevision: number
  readonly expectedWorkflowRevision: number | null
  readonly definition: ProjectTaskWorkflowDefinition
  readonly mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping
  readonly preparedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-task-workflow-configure'
  }
}

export type WorkbenchFeishuTaskWorkflowOperationReservation =
  | {
    readonly state: 'deliver'
    readonly operationId: string
    /** Original reserved command identity, reused after a crash before provider delivery. */
    readonly command: WorkbenchFeishuTaskWorkflowOperationMutation['command']
  }
  | { readonly state: 'replay'; readonly result: ConfigureFeishuTaskWorkflowResult }
  | { readonly state: 'rejected'; readonly result: ConfigureFeishuTaskWorkflowResult }

export interface WorkbenchFeishuTaskWorkflowReplayQuery {
  readonly organizationId: string
  readonly teamId: string
  readonly actorId: string
  readonly projectId: string
  readonly expectedTaskRevision: number
  readonly expectedWorkflowRevision: number | null
  readonly definition: ProjectTaskWorkflowDefinition
  readonly mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping
  readonly idempotencyKey: string
  readonly causationId: string
  readonly reason: 'owner-feishu-task-workflow-configure'
}

/** Add one task outside the primary list through an explicit, audited Project reference. */
export interface WorkbenchFeishuTaskReferenceMutation {
  readonly projectId: string
  readonly expectedRevision: number
  readonly task: WorkbenchFeishuTaskSnapshot
  readonly referencedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-task-reference'
  }
}

/** Event plus optional authoritative entity observation accepted from a trusted connector. */
export interface WorkbenchFeishuTaskEventMutation {
  readonly event: FeishuTaskEventInput
  readonly task: WorkbenchFeishuTaskSnapshot | null
  readonly receivedAt: string
}

/** Durable intent committed before the non-idempotent Feishu PATCH begins. */
export interface WorkbenchFeishuTaskUpdateReservationMutation {
  readonly effectId: string
  readonly projectId: string
  readonly taskGuid: string
  readonly expectedRevision: number
  readonly expectedRemoteVersion: string
  readonly expectedWorkflowRevision?: number
  readonly changes: import('./client.ts').UpdateFeishuTaskRequest['changes']
  readonly preparedAt: string
  readonly command: WorkbenchCommandMetadata & {
    readonly reason: 'owner-feishu-task-update'
  }
}

export type WorkbenchFeishuTaskUpdateReservation =
  | {
    readonly state: 'deliver'
    readonly route: WorkbenchFeishuTaskRoute
    /** Exact provider patch frozen at reservation time for one-attempt delivery/recovery. */
    readonly patch: WorkbenchFeishuTaskPatch
    readonly effect: FeishuTaskMutationEffectProjection
    readonly receipt: import('./client.ts').WorkbenchCommandReceipt
  }
  | {
    readonly state: 'replay'
    readonly result: UpdateFeishuTaskResult
  }
  | {
    readonly state: 'rejected'
    readonly result: UpdateFeishuTaskResult
  }

export type WorkbenchFeishuTaskUpdateSettlement =
  | {
    readonly state: 'delivered'
    readonly task: WorkbenchFeishuTaskSnapshot
    readonly settledAt: string
  }
  | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuTaskSnapshot
    readonly settledAt: string
  }
  | {
    readonly state: 'unknown' | 'failed'
    readonly issue: FeishuConnectionIssue
    readonly settledAt: string
  }

/** Host-fixed scope for the Project creation-page read. */
export interface WorkbenchProjectStartQuery {
  readonly organizationId: string
  readonly teamId: string
  readonly filter: ProjectStartFilter
}

/** Host-fixed scope for one Project detail read. */
export interface WorkbenchProjectReadQuery extends ProjectQuery {
  readonly organizationId: string
  readonly teamId: string
}

/** Host-fixed scope for one Project Team read. */
export interface WorkbenchProjectTeamReadQuery extends ProjectQuery {
  readonly organizationId: string
  readonly teamId: string
}

/** Host-fixed scope for one Project's Review Center projection. */
export interface WorkbenchReviewCenterQuery {
  readonly organizationId: string
  readonly teamId: string
  readonly filter: ReviewCenterFilter
}

/** Host-only query with the actor organization already fixed by authorization. */
export interface WorkbenchActivityQuery {
  readonly organizationId: string
  readonly filter: WorkbenchActivityFilter
}

/** One leased Outbox intent; payload never crosses the public Activity projection. */
export interface WorkbenchOutboxClaim {
  readonly id: string
  readonly topic: string
  readonly effectKey: string
  readonly payload: string
  readonly causationId: string
  readonly claimToken: string
  readonly leaseExpiresAt: string
  readonly attemptCount: number
}

/** Claim one eligible pending intent without holding a transaction over delivery I/O. */
export interface WorkbenchOutboxClaimRequest {
  readonly claimToken: string
  readonly claimedAt: string
  readonly leaseExpiresAt: string
}

/** A definitive or ambiguous adapter result, expressed only as bounded safe codes. */
export interface WorkbenchOutboxSettlement {
  readonly outboxId: string
  readonly claimToken: string
  readonly state: Exclude<WorkbenchOutboxState, 'pending'>
  readonly settledAt: string
  readonly errorCode: WorkbenchOutboxErrorCode | null
}

/** Portable persistence seam owned by the highest-level Workbench scenario. */
export interface WorkbenchRepository {
  /** Open the medium and migrate it before accepting commands. */
  open(): Promise<void>
  /** Return a detached current projection, or null before the first write. */
  snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null>
  /** Atomically commit status, one pending Outbox intent, audit, and replay receipt. */
  commitStatus(mutation: WorkbenchStatusMutation, signal: AbortSignal): Promise<SetStatusResult>
  /** Read the immutable template, catalog CAS, and one descending Project page. */
  readProjectStart(
    query: WorkbenchProjectStartQuery,
    signal: AbortSignal,
  ): Promise<ProjectStartProjection>
  /** Atomically create Goal, Outcomes, Project, snapshot, Outbox, audit, and receipt. */
  commitProject(
    mutation: WorkbenchProjectMutation,
    signal: AbortSignal,
  ): Promise<CreateProjectResult>
  /** Return one detached Project detail when it is visible in the fixed Host scope. */
  readProject(
    query: WorkbenchProjectReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectDetailProjection | null>
  /** Return one detached Project Team or null when the Project is outside the fixed scope. */
  readProjectTeam(
    query: WorkbenchProjectTeamReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectTeamProjection | null>
  /** Atomically add a member, advance Team CAS, Outbox, audit, and replay receipt. */
  commitProjectMember(
    mutation: WorkbenchProjectMemberMutation,
    signal: AbortSignal,
  ): Promise<AddProjectMemberResult>
  /** Atomically transition one retained member's status. */
  commitProjectMemberStatus(
    mutation: WorkbenchProjectMemberStatusMutation,
    signal: AbortSignal,
  ): Promise<SetProjectMemberStatusResult>
  /** Atomically append and select one complete Project Responsibility version. */
  commitProjectResponsibility(
    mutation: WorkbenchProjectResponsibilityMutation,
    signal: AbortSignal,
  ): Promise<SetProjectResponsibilityResult>
  /** Return proposal context and one Host-filtered page of complete Review cards. */
  readReviewCenter(
    query: WorkbenchReviewCenterQuery,
    signal: AbortSignal,
  ): Promise<ReviewCenterProjection | null>
  /** Atomically derive and persist one immutable typed Project Responsibility proposal. */
  commitSuggestedChangeProposal(
    mutation: WorkbenchSuggestedChangeProposalMutation,
    signal: AbortSignal,
  ): Promise<ProposeProjectResponsibilityChangeResult>
  /** Atomically append one disposition and, for acceptance, the target mutation. */
  commitSuggestedChangeDecision(
    mutation: WorkbenchSuggestedChangeDecisionMutation,
    signal: AbortSignal,
  ): Promise<DecideSuggestedChangeResult>
  /** Read both independent Feishu routes from local truth; credential presence is enriched later. */
  readFeishuConnection(
    query: WorkbenchFeishuConnectionQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchStoredFeishuConnectionProjection>
  /** Atomically advance one route generation with audit, Outbox, and replay receipt. */
  commitFeishuRoute(
    mutation: WorkbenchFeishuRouteMutation,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuIdentityRouteResult>
  /** Return a committed verification replay/conflict, or null before any external read. */
  replayFeishuVerification(
    query: WorkbenchFeishuVerificationReplayQuery,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult | null>
  /** Atomically record one safe provider observation with route/connection CAS. */
  commitFeishuVerification(
    mutation: WorkbenchFeishuVerificationMutation,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult>
  /** Read one Project's durable task-list binding, task projection, and effect health. */
  readProjectTasks(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectTasksProjection | null>
  /** Resolve one authorized Project's immutable exact task route. */
  readFeishuTaskReconciliationTarget(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskReconciliationTarget | null>
  /** Read exact route, current mapping, and detached provider values for workflow planning. */
  readFeishuTaskWorkflowContext(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskWorkflowContext | null>
  /** Receipt-first replay check before any workflow field create or PATCH. */
  replayFeishuTaskWorkflowConfiguration(
    query: WorkbenchFeishuTaskWorkflowReplayQuery,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult | null>
  /** Reserve a create/migrate field write before its single provider attempt. */
  reserveFeishuTaskWorkflowOperation(
    mutation: WorkbenchFeishuTaskWorkflowOperationMutation,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskWorkflowOperationReservation>
  claimFeishuTaskWorkflowOperation(
    operationId: string,
    claimedAt: string,
    signal: AbortSignal,
  ): Promise<boolean>
  settleFeishuTaskWorkflowOperation(
    operationId: string,
    settlement:
      | Readonly<{
        readonly state: 'unknown' | 'failed'
        readonly issue: FeishuConnectionIssue
        readonly settledAt: string
      }>
      | Readonly<{
        readonly state: 'conflict'
        readonly settledAt: string
      }>,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult>
  /** Atomically install a stable field/option mapping and its immutable version. */
  commitFeishuTaskWorkflowConfiguration(
    mutation: WorkbenchFeishuTaskWorkflowConfigurationMutation,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult>
  /** Resolve a prior binding result before any remote create/read side effect. */
  replayFeishuTaskListBinding(
    query: WorkbenchFeishuTaskListBindingReplayQuery,
    signal: AbortSignal,
  ): Promise<BindFeishuTaskListResult | null>
  /** Enumerate bounded targets for Host-owned periodic repair. */
  listFeishuTaskReconciliationTargets(
    signal: AbortSignal,
  ): Promise<readonly WorkbenchFeishuTaskReconciliationTarget[]>
  /** Atomically bind the one primary list and install its first full projection. */
  commitFeishuTaskListBinding(
    mutation: WorkbenchFeishuTaskListBindingMutation,
    signal: AbortSignal,
  ): Promise<BindFeishuTaskListResult>
  /** Replace the primary-list subset from one complete authoritative baseline. */
  commitFeishuTaskReconciliation(
    mutation: WorkbenchFeishuTaskReconciliationMutation,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult>
  /** Persist a bounded failed-attempt health fact without changing task truth. */
  commitFeishuTaskReconciliationFailure(
    mutation: WorkbenchFeishuTaskReconciliationFailureMutation,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult>
  /** Add one explicit external task reference and its first projection. */
  commitFeishuTaskReference(
    mutation: WorkbenchFeishuTaskReferenceMutation,
    signal: AbortSignal,
  ): Promise<ReferenceFeishuTaskResult>
  /** Idempotently fold one normalized connector event into the projection. */
  commitFeishuTaskEvent(
    mutation: WorkbenchFeishuTaskEventMutation,
    signal: AbortSignal,
  ): Promise<FeishuTaskEventResult>
  /** Commit and replay-safe reserve one exact Feishu PATCH before transport starts. */
  reserveFeishuTaskUpdate(
    mutation: WorkbenchFeishuTaskUpdateReservationMutation,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskUpdateReservation>
  /** Move a prepared effect to its sole delivery attempt. */
  claimFeishuTaskUpdate(effectId: string, claimedAt: string, signal: AbortSignal): Promise<boolean>
  /** Settle the exact effect and update the authoritative projection when delivered. */
  settleFeishuTaskUpdate(
    effectId: string,
    settlement: WorkbenchFeishuTaskUpdateSettlement,
    signal: AbortSignal,
  ): Promise<UpdateFeishuTaskResult>
  /** Return a redacted, organization-scoped Activity page. */
  readActivity(query: WorkbenchActivityQuery, signal: AbortSignal): Promise<WorkbenchActivityProjection>
  /** Recompute the complete versioned hash chain and compare its stored head. */
  verifyAuditChain(signal: AbortSignal): Promise<WorkbenchAuditIntegrityProjection>
  /** Lease one pending intent; an expired unresolved lease becomes unknown. */
  claimOutbox(request: WorkbenchOutboxClaimRequest, signal: AbortSignal): Promise<WorkbenchOutboxClaim | null>
  /** Settle the exact active lease without exposing raw adapter responses. */
  settleOutbox(settlement: WorkbenchOutboxSettlement, signal: AbortSignal): Promise<boolean>
  /** Release every handle after callers have stopped admission and drained work. */
  close(): Promise<void>
}

/** Detach and freeze the complete Project task workspace at a process boundary. */
export function projectTasksProjection(value: ProjectTasksProjection): ProjectTasksProjection {
  const binding: ProjectTaskListBindingProjection | null = value.binding === null
    ? null
    : Object.freeze({
      taskListGuid: value.binding.taskListGuid,
      name: value.binding.name,
      canonicalUrl: value.binding.canonicalUrl,
      identity: Object.freeze({ ...value.binding.identity }),
      createdByWorkbench: value.binding.createdByWorkbench,
      remoteVersion: value.binding.remoteVersion,
      boundAt: value.binding.boundAt,
    })
  const tasks = Object.freeze(value.tasks.map(projectTaskProjection))
  const effects = Object.freeze(value.effects.map(effect => Object.freeze({ ...effect })))
  const workflow = value.workflow === null ? null : projectTaskWorkflowProjection(value.workflow)
  return Object.freeze({
    projectId: value.projectId,
    revision: value.revision,
    binding,
    tasks,
    sync: Object.freeze({
      state: value.sync.state,
      lastEventAt: value.sync.lastEventAt,
      lastReconciledAt: value.sync.lastReconciledAt,
      lastAttemptAt: value.sync.lastAttemptAt,
      issue: value.sync.issue === null
        ? null
        : Object.freeze({
          ...value.sync.issue,
          missingScopes: Object.freeze([...value.sync.issue.missingScopes]),
        }),
    }),
    effects,
    workflow,
  })
}

/** Detach all nested workflow collections before crossing a process boundary. */
export function projectTaskWorkflowProjection(
  value: ProjectTaskWorkflowProjection,
): ProjectTaskWorkflowProjection {
  return Object.freeze({
    revision: value.revision,
    definition: Object.freeze({
      fieldName: value.definition.fieldName,
      initialStateId: value.definition.initialStateId,
      terminalStateIds: Object.freeze([...value.definition.terminalStateIds]),
      states: Object.freeze(value.definition.states.map(state => Object.freeze({
        stateId: state.stateId,
        name: state.name,
        colorIndex: state.colorIndex,
        allowedNextStateIds: Object.freeze([...state.allowedNextStateIds]),
      }))),
    }),
    field: Object.freeze({ ...value.field }),
    options: Object.freeze(value.options.map(option => Object.freeze({ ...option }))),
    values: Object.freeze(value.values.map(item => Object.freeze({ ...item }))),
    compatibility: Object.freeze({
      state: value.compatibility.state,
      issues: Object.freeze(value.compatibility.issues.map(issue => Object.freeze({ ...issue }))),
    }),
    completionSuggestions: Object.freeze(value.completionSuggestions.map(
      suggestion => Object.freeze({ ...suggestion }),
    )),
    configuredAt: value.configuredAt,
    updatedAt: value.updatedAt,
  })
}

/** Detach one task and every nested member/comment collection. */
export function projectTaskProjection(value: ProjectTaskProjection): ProjectTaskProjection {
  const member = (candidate: ProjectTaskProjection['assignees'][number]) => Object.freeze({
    openId: candidate.openId,
    name: candidate.name,
  })
  return Object.freeze({
    taskGuid: value.taskGuid,
    taskId: value.taskId,
    scope: value.scope,
    parentTaskGuid: value.parentTaskGuid,
    summary: value.summary,
    description: value.description,
    assignees: Object.freeze(value.assignees.map(member)),
    followers: Object.freeze(value.followers.map(member)),
    comments: Object.freeze(value.comments.map(comment => Object.freeze({
      commentId: comment.commentId,
      content: comment.content,
      creator: comment.creator === null ? null : member(comment.creator),
      replyToCommentId: comment.replyToCommentId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    }))),
    completed: value.completed,
    completedAt: value.completedAt,
    canonicalUrl: value.canonicalUrl,
    remoteVersion: value.remoteVersion,
    projectionRevision: value.projectionRevision,
  })
}

/** Copy and freeze one projection at a process or transport boundary. */
export function statusSnapshot(value: WorkbenchStatusSnapshot): WorkbenchStatusSnapshot {
  return Object.freeze({
    id: value.id,
    message: value.message,
    revision: value.revision,
    updatedAt: value.updatedAt,
  })
}

/** Copy and freeze a complete mutation outcome. */
export function statusResult(value: SetStatusResult): SetStatusResult {
  if (value.ok) {
    return Object.freeze({
      ok: true,
      value: statusSnapshot(value.value),
      receipt: Object.freeze({ ...value.receipt }),
    })
  }
  if (value.error.code === 'idempotency-conflict') {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'idempotency-conflict',
        message: value.error.message,
      }),
    })
  }
  const current = value.error.current === null ? null : statusSnapshot(value.error.current)
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'revision-conflict',
      message: value.error.message,
      current,
    }),
  })
}

/** Copy and recursively freeze one complete Project detail projection. */
export function projectDetailProjection(
  value: ProjectDetailProjection,
): ProjectDetailProjection {
  const primaryGoal = Object.freeze({
    goalId: value.primaryGoal.goalId,
    name: value.primaryGoal.name,
    revision: value.primaryGoal.revision,
    outcomes: Object.freeze(value.primaryGoal.outcomes.map(outcome => Object.freeze({
      outcomeId: outcome.outcomeId,
      name: outcome.name,
      revision: outcome.revision,
      metric: Object.freeze({ ...outcome.metric }),
    }))),
  })
  return Object.freeze({
    project: projectSummaryProjection(value.project),
    primaryGoal,
    supportingGoals: Object.freeze(value.supportingGoals.map(goal => Object.freeze({ ...goal }))),
    templateSnapshot: Object.freeze({
      template: Object.freeze({ ...value.templateSnapshot.template }),
      snapshotSchemaVersion: value.templateSnapshot.snapshotSchemaVersion,
      definition: templateDefinition(value.templateSnapshot.definition),
      snapshotDigest: value.templateSnapshot.snapshotDigest,
      capturedAt: value.templateSnapshot.capturedAt,
    }),
  })
}

/** Copy and recursively freeze the one-round-trip Project creation projection. */
export function projectStartProjection(value: ProjectStartProjection): ProjectStartProjection {
  return Object.freeze({
    template: Object.freeze({
      selection: Object.freeze({ ...value.template.selection }),
      definition: templateDefinition(value.template.definition),
    }),
    catalogRevision: value.catalogRevision,
    projects: Object.freeze(value.projects.map(projectSummaryProjection)),
    nextBeforeSequence: value.nextBeforeSequence,
  })
}

/** Copy and recursively freeze a complete Project creation result. */
export function projectResult(value: CreateProjectResult): CreateProjectResult {
  if (value.ok) {
    return Object.freeze({
      ok: true,
      value: projectDetailProjection(value.value),
      catalogRevision: value.catalogRevision,
      receipt: Object.freeze({ ...value.receipt }),
    })
  }
  switch (value.error.code) {
    case 'idempotency-conflict':
      return Object.freeze({
        ok: false,
        error: Object.freeze({ ...value.error }),
      })
    case 'catalog-revision-conflict':
      return Object.freeze({
        ok: false,
        error: Object.freeze({ ...value.error }),
      })
    case 'supporting-goal-conflict':
      return Object.freeze({
        ok: false,
        error: Object.freeze({ ...value.error }),
      })
    case 'template-version-conflict':
      return Object.freeze({
        ok: false,
        error: Object.freeze({
          ...value.error,
          current: Object.freeze({ ...value.error.current }),
        }),
      })
  }
}

/** Copy and recursively freeze one complete authorized Project Team projection. */
export function projectTeamProjection(value: ProjectTeamProjection): ProjectTeamProjection {
  return Object.freeze({
    projectId: value.projectId,
    teamRevision: value.teamRevision,
    members: Object.freeze(value.members.map(projectMemberProjection)),
    responsibility: value.responsibility === null
      ? null
      : Object.freeze({
        projectId: value.responsibility.projectId,
        revision: value.responsibility.revision,
        accountableMemberId: value.responsibility.accountableMemberId,
        contributorMemberIds: Object.freeze([...value.responsibility.contributorMemberIds]),
        humanSponsorMemberId: value.responsibility.humanSponsorMemberId,
        updatedAt: value.responsibility.updatedAt,
      }),
  })
}

/** Copy and freeze one PII-free Project Team command result. */
export function projectTeamCommandResult<T extends
  | AddProjectMemberResult
  | SetProjectMemberStatusResult
  | SetProjectResponsibilityResult>(value: T): T {
  if (value.ok) {
    const receipt = Object.freeze({
      commandId: value.receipt.commandId,
      auditEventId: value.receipt.auditEventId,
      outboxId: value.receipt.outboxId,
    })
    if ('memberId' in value.value) {
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          projectId: value.value.projectId,
          memberId: value.value.memberId,
          kind: value.value.kind,
          status: value.value.status,
          memberRevision: value.value.memberRevision,
          teamRevision: value.value.teamRevision,
        }),
        receipt,
      }) as T
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        projectId: value.value.projectId,
        responsibilityRevision: value.value.responsibilityRevision,
        teamRevision: value.value.teamRevision,
      }),
      receipt,
    }) as T
  }
  const error = value.error
  switch (error.code) {
    case 'idempotency-conflict':
    case 'duplicate-feishu-identity':
      return failedTeamCommand({ code: error.code, message: error.message }) as T
    case 'project-not-found':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        projectId: error.projectId,
      }) as T
    case 'team-revision-conflict':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        expectedTeamRevision: error.expectedTeamRevision,
        currentTeamRevision: error.currentTeamRevision,
      }) as T
    case 'member-limit-reached':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        limit: 100 as const,
      }) as T
    case 'member-not-found':
    case 'member-in-use':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        memberId: error.memberId,
      }) as T
    case 'member-revision-conflict':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        memberId: error.memberId,
        expectedMemberRevision: error.expectedMemberRevision,
        currentMemberRevision: error.currentMemberRevision,
      }) as T
    case 'member-status-conflict':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        memberId: error.memberId,
        status: error.status,
      }) as T
    case 'responsibility-revision-conflict':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        expectedResponsibilityRevision: error.expectedResponsibilityRevision,
        currentResponsibilityRevision: error.currentResponsibilityRevision,
      }) as T
    case 'member-inactive':
    case 'accountable-also-contributor':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        memberId: error.memberId,
      }) as T
    case 'human-sponsor-required':
    case 'human-sponsor-forbidden':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        accountableMemberId: error.accountableMemberId,
      }) as T
    case 'human-sponsor-invalid':
      return failedTeamCommand({
        code: error.code,
        message: error.message,
        humanSponsorMemberId: error.humanSponsorMemberId,
      }) as T
  }
}

/** Copy and recursively freeze one complete authorized Review Center projection. */
export function reviewCenterProjection(value: ReviewCenterProjection): ReviewCenterProjection {
  return Object.freeze({
    projectId: value.projectId,
    proposalBuilder: Object.freeze({
      projectId: value.proposalBuilder.projectId,
      teamRevision: value.proposalBuilder.teamRevision,
      responsibilityRevision: value.proposalBuilder.responsibilityRevision,
      base: reviewResponsibilityValue(value.proposalBuilder.base),
      memberOptions: Object.freeze(value.proposalBuilder.memberOptions.map(option => Object.freeze({
        ...option,
      }))),
      evidenceOptions: Object.freeze(value.proposalBuilder.evidenceOptions.map(reviewEvidence)),
    }),
    items: Object.freeze(value.items.map(item => Object.freeze({
      suggestedChangeId: item.suggestedChangeId,
      sequence: item.sequence,
      revision: item.revision,
      projectId: item.projectId,
      source: Object.freeze({ ...item.source }),
      target: Object.freeze({ ...item.target }),
      proposedDiff: reviewDiff(item.proposedDiff),
      evidence: Object.freeze(item.evidence.map(reviewEvidence)),
      risk: Object.freeze({
        proposedLevel: item.risk.proposedLevel,
        effectiveLevel: item.risk.effectiveLevel,
        proposedReasonCodes: Object.freeze([...item.risk.proposedReasonCodes]),
        policyVersion: item.risk.policyVersion,
        batchPolicy: Object.freeze({ ...item.risk.batchPolicy }),
      }),
      originCausationId: item.originCausationId,
      persistedState: item.persistedState,
      effectiveStatus: item.effectiveStatus,
      decisions: Object.freeze(item.decisions.map(decision => Object.freeze({
        decisionId: decision.decisionId,
        suggestedChangeRevision: decision.suggestedChangeRevision,
        mode: decision.mode,
        actor: Object.freeze({ ...decision.actor }),
        feedback: decision.feedback,
        appliedDiff: decision.appliedDiff === null ? null : reviewDiff(decision.appliedDiff),
        appliedRiskLevel: decision.appliedRiskLevel,
        appliedRiskReasonCodes: Object.freeze([...decision.appliedRiskReasonCodes]),
        appliedTeamRevision: decision.appliedTeamRevision,
        appliedResponsibilityRevision: decision.appliedResponsibilityRevision,
        causationId: decision.causationId,
        receipt: Object.freeze({ ...decision.receipt }),
        decidedAt: decision.decidedAt,
      }))),
      allowedDecisions: Object.freeze([...item.allowedDecisions]),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))),
    nextBeforeSequence: value.nextBeforeSequence,
  })
}

/** Copy and freeze a PII-free proposal acknowledgement or closed conflict. */
export function suggestedChangeProposalResult(
  value: ProposeProjectResponsibilityChangeResult,
): ProposeProjectResponsibilityChangeResult {
  if (value.ok) return Object.freeze({
    ok: true,
    value: Object.freeze({ ...value.value }),
    receipt: Object.freeze({ ...value.receipt }),
  })
  return Object.freeze({
    ok: false,
    error: Object.freeze({ ...value.error }),
  }) as ProposeProjectResponsibilityChangeResult
}

/** Copy and freeze a PII-free decision acknowledgement or closed conflict. */
export function suggestedChangeDecisionResult(
  value: DecideSuggestedChangeResult,
): DecideSuggestedChangeResult {
  if (value.ok) return Object.freeze({
    ok: true,
    value: Object.freeze({ ...value.value }),
    receipt: Object.freeze({ ...value.receipt }),
  })
  return Object.freeze({
    ok: false,
    error: Object.freeze({ ...value.error }),
  }) as DecideSuggestedChangeResult
}

function reviewResponsibilityValue<T extends {
  readonly accountableMemberId: string | null
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
}>(value: T): T {
  return Object.freeze({
    ...value,
    contributorMemberIds: Object.freeze([...value.contributorMemberIds]),
  })
}

function reviewDiff(
  value: ReviewCenterProjection['items'][number]['proposedDiff'],
): ReviewCenterProjection['items'][number]['proposedDiff'] {
  return Object.freeze({
    kind: 'project-responsibility.diff',
    schemaVersion: 1,
    before: reviewResponsibilityValue(value.before),
    after: reviewResponsibilityValue(value.after),
    changedFields: Object.freeze([...value.changedFields]),
    digest: value.digest,
  })
}

function reviewEvidence(
  value: ReviewCenterProjection['items'][number]['evidence'][number],
): ReviewCenterProjection['items'][number]['evidence'][number] {
  return Object.freeze({
    kind: 'workbench-audit-event',
    auditEventId: value.auditEventId,
    occurredAt: value.occurredAt,
    action: value.action,
    summaryCode: value.summaryCode,
    object: Object.freeze({ ...value.object }),
  })
}

function failedTeamCommand<T extends Readonly<{ code: string; message: string }>>(
  error: T,
): Readonly<{ ok: false; error: T }> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

function projectMemberProjection(
  member: ProjectTeamProjection['members'][number],
): ProjectTeamProjection['members'][number] {
  if (member.kind === 'human') {
    return Object.freeze({
      memberId: member.memberId,
      projectId: member.projectId,
      kind: 'human',
      displayName: member.displayName,
      status: member.status,
      revision: member.revision,
      identity: Object.freeze({ ...member.identity }),
      feishuAssigneeEligibility: member.feishuAssigneeEligibility,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    })
  }
  return Object.freeze({
    memberId: member.memberId,
    projectId: member.projectId,
    kind: 'agent',
    displayName: member.displayName,
    status: member.status,
    revision: member.revision,
    feishuAssigneeEligibility: member.feishuAssigneeEligibility,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  })
}

function projectSummaryProjection(
  value: ProjectStartProjection['projects'][number],
): ProjectStartProjection['projects'][number] {
  return Object.freeze({
    projectId: value.projectId,
    name: value.name,
    revision: value.revision,
    catalogSequence: value.catalogSequence,
    timezone: value.timezone,
    createdAt: value.createdAt,
    primaryGoal: Object.freeze({ ...value.primaryGoal }),
  })
}

function templateDefinition(
  value: ProjectStartProjection['template']['definition'],
): ProjectStartProjection['template']['definition'] {
  return Object.freeze({
    ...value,
    rules: Object.freeze({ ...value.rules }),
    defaults: Object.freeze({ ...value.defaults }),
  })
}
