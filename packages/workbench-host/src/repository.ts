import type {
  AddProjectMemberResult,
  ConfigureFeishuIdentityRouteResult,
  CreateProjectResult,
  DecideSuggestedChangeResult,
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
  ProjectTeamProjection,
  ProjectTemplateSelection,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterFilter,
  ReviewCenterProjection,
  SuggestedChangeEvidenceRef,
  SuggestedChangeRiskLevel,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
  SetStatusResult,
  VerifyFeishuIdentityRouteResult,
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxErrorCode,
  WorkbenchOutboxState,
  WorkbenchCommandReason,
  WorkbenchStatusChangeReason,
  WorkbenchStatusSnapshot,
} from './client.ts'

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
