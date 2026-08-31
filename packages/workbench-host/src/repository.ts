import type {
  AddProjectMemberResult,
  CreateProjectResult,
  OutcomeMetric,
  ProjectDetailProjection,
  ProjectMemberDraft,
  ProjectMemberStatus,
  ProjectQuery,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectTeamProjection,
  ProjectTemplateSelection,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
  SetStatusResult,
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
