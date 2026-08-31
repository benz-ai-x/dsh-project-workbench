import { describe, expect, it } from 'vitest'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  CreateProjectRequest,
  CreateProjectResult,
  ProjectDetailProjection,
  ProjectMemberProjection,
  ProjectResponsibilityProjection,
  ProjectStartProjection,
  ProjectTeamProjection,
  SetProjectMemberStatusRequest,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityRequest,
  SetProjectResponsibilityResult,
  SetStatusRequest,
  SetStatusResult,
  WorkbenchActivityProjection,
  WorkbenchActivityQuery,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxClaim,
  WorkbenchOutboxClaimRequest,
  WorkbenchOutboxSettlement,
  WorkbenchProjectMutation,
  WorkbenchProjectMemberMutation,
  WorkbenchProjectMemberStatusMutation,
  WorkbenchProjectReadQuery,
  WorkbenchProjectResponsibilityMutation,
  WorkbenchProjectStartQuery,
  WorkbenchProjectTeamReadQuery,
  WorkbenchRepository,
  WorkbenchStatusMutation,
  WorkbenchStatusSnapshot,
} from '../src/index.ts'

const TEST_AUDIT_GENESIS = `sha256:${'0'.repeat(64)}`
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
  KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
  WorkbenchScenario,
} from '../src/index.ts'
import { WorkbenchAuthorizationContext, type WorkbenchAuthorization } from '../src/authorization.ts'

const authorization = Object.freeze({
  require: () => Promise.resolve(Object.freeze({
    ownerId: 'owner-test',
    organizationId: 'organization-test',
    teamId: 'team-test',
  })),
  filterProjection: <T>(_action: string, projection: T) => Promise.resolve(projection),
})

class MemoryRepository implements WorkbenchRepository {
  state: WorkbenchStatusSnapshot | null = null
  openCalls = 0
  closeCalls = 0
  readCalls = 0
  writeCalls = 0
  activityCalls = 0
  integrityCalls = 0
  projectStartCalls = 0
  projectWriteCalls = 0
  projectReadCalls = 0
  projectTeamReadCalls = 0
  projectMemberWriteCalls = 0
  projectMemberStatusWriteCalls = 0
  projectResponsibilityWriteCalls = 0
  catalogRevision = 0
  readonly projects = new Map<string, ProjectDetailProjection>()
  readonly members = new Map<string, ProjectMemberProjection>()
  readonly responsibilities = new Map<string, ProjectResponsibilityProjection>()
  readonly teamRevisions = new Map<string, number>()
  onSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined
  onSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  afterSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  onCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined
  afterCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined

  async open(): Promise<void> {
    this.openCalls += 1
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    this.readCalls += 1
    await this.onSnapshot?.(signal)
    return this.state === null ? null : { ...this.state }
  }

  lastMutation: WorkbenchStatusMutation | null = null

  async commitStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    this.writeCalls += 1
    this.lastMutation = mutation
    await this.onSetStatus?.(signal)
    const actualRevision = this.state?.revision ?? null
    if (actualRevision !== mutation.expectedRevision) {
      return {
        ok: false,
        error: {
          code: 'revision-conflict',
          message: 'fixture conflict',
          current: this.state === null ? null : { ...this.state },
        },
      }
    }
    this.state = this.state === null
      ? {
        id: mutation.candidateId,
        message: mutation.message,
        revision: 1,
        updatedAt: mutation.updatedAt,
      }
      : {
        ...this.state,
        message: mutation.message,
        revision: this.state.revision + 1,
        updatedAt: mutation.updatedAt,
      }
    await this.afterSetStatus?.(signal)
    return {
      ok: true,
      value: { ...this.state },
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
    }
  }

  lastProjectStartQuery: WorkbenchProjectStartQuery | null = null

  async readProjectStart(
    query: WorkbenchProjectStartQuery,
  ): Promise<ProjectStartProjection> {
    this.projectStartCalls += 1
    this.lastProjectStartQuery = query
    const limit = query.filter.limit ?? 20
    const projects = [...this.projects.values()]
      .map(value => value.project)
      .filter(value => query.filter.beforeSequence === undefined
        || value.catalogSequence < query.filter.beforeSequence)
      .sort((left, right) => right.catalogSequence - left.catalogSequence)
      .slice(0, limit)
    return {
      template: KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
      catalogRevision: this.catalogRevision,
      projects,
      nextBeforeSequence: projects.length === limit
        ? projects.at(-1)?.catalogSequence ?? null
        : null,
    }
  }

  lastProjectMutation: WorkbenchProjectMutation | null = null

  async commitProject(
    mutation: WorkbenchProjectMutation,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    this.projectWriteCalls += 1
    this.lastProjectMutation = mutation
    await this.onCreateProject?.(signal)
    if (mutation.expectedCatalogRevision !== this.catalogRevision) {
      return {
        ok: false,
        error: {
          code: 'catalog-revision-conflict',
          message: 'fixture catalog conflict',
          expectedCatalogRevision: mutation.expectedCatalogRevision,
          currentCatalogRevision: this.catalogRevision,
        },
      }
    }
    this.catalogRevision += 1
    const primaryGoal = {
      goalId: mutation.primaryGoalId,
      name: mutation.primaryGoal.name,
      revision: 1,
      outcomes: mutation.primaryGoal.outcomes.map(outcome => ({
        outcomeId: outcome.outcomeId,
        name: outcome.name,
        revision: 1,
        metric: { ...outcome.metric },
      })),
    }
    const supportingGoals = mutation.supportingGoals.map(reference => {
      const source = [...this.projects.values()].find(candidate =>
        candidate.primaryGoal.goalId === reference.goalId)
      if (source === undefined || source.primaryGoal.revision !== reference.expectedRevision) {
        throw new Error('fixture Supporting Goal does not satisfy its revision precondition')
      }
      return {
        goalId: source.primaryGoal.goalId,
        name: source.primaryGoal.name,
        revision: source.primaryGoal.revision,
      }
    })
    const detail: ProjectDetailProjection = {
      project: {
        projectId: mutation.projectId,
        name: mutation.projectName,
        revision: 1,
        catalogSequence: this.catalogRevision,
        timezone: 'Asia/Shanghai',
        createdAt: mutation.createdAt,
        primaryGoal: {
          goalId: primaryGoal.goalId,
          name: primaryGoal.name,
          revision: primaryGoal.revision,
        },
      },
      primaryGoal,
      supportingGoals,
      templateSnapshot: {
        template: { ...mutation.template },
        snapshotSchemaVersion: 1,
        definition: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
        snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
        capturedAt: mutation.createdAt,
      },
    }
    this.projects.set(mutation.projectId, detail)
    await this.afterCreateProject?.(signal)
    return {
      ok: true,
      value: detail,
      catalogRevision: this.catalogRevision,
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
    }
  }

  lastProjectReadQuery: WorkbenchProjectReadQuery | null = null

  async readProject(query: WorkbenchProjectReadQuery): Promise<ProjectDetailProjection | null> {
    this.projectReadCalls += 1
    this.lastProjectReadQuery = query
    return this.projects.get(query.projectId) ?? null
  }

  lastProjectTeamReadQuery: WorkbenchProjectTeamReadQuery | null = null

  async readProjectTeam(
    query: WorkbenchProjectTeamReadQuery,
  ): Promise<ProjectTeamProjection | null> {
    this.projectTeamReadCalls += 1
    this.lastProjectTeamReadQuery = query
    if (!this.projects.has(query.projectId)) return null
    return {
      projectId: query.projectId,
      teamRevision: this.teamRevisions.get(query.projectId) ?? 0,
      members: [...this.members.values()]
        .filter(member => member.projectId === query.projectId)
        .sort((left, right) => left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0),
      responsibility: this.responsibilities.get(query.projectId) ?? null,
    }
  }

  lastProjectMemberMutation: WorkbenchProjectMemberMutation | null = null

  async commitProjectMember(
    mutation: WorkbenchProjectMemberMutation,
  ): Promise<AddProjectMemberResult> {
    this.projectMemberWriteCalls += 1
    this.lastProjectMemberMutation = mutation
    if (!this.projects.has(mutation.projectId)) {
      return projectNotFound(mutation.projectId)
    }
    const teamRevision = this.teamRevisions.get(mutation.projectId) ?? 0
    if (teamRevision !== mutation.expectedTeamRevision) {
      return teamConflict(mutation.expectedTeamRevision, teamRevision)
    }
    const projectMembers = [...this.members.values()]
      .filter(member => member.projectId === mutation.projectId)
    if (projectMembers.length >= 100) {
      return { ok: false, error: { code: 'member-limit-reached', message: 'fixture limit', limit: 100 } }
    }
    if (mutation.member.kind === 'human' && mutation.member.identity.type === 'feishu'
      && projectMembers.some(member => member.kind === 'human'
        && member.identity.type === 'feishu'
        && member.identity.appId === mutation.member.identity.appId
        && member.identity.openId === mutation.member.identity.openId)) {
      return { ok: false, error: { code: 'duplicate-feishu-identity', message: 'fixture duplicate' } }
    }
    const nextTeamRevision = teamRevision + 1
    const member: ProjectMemberProjection = mutation.member.kind === 'agent'
      ? {
        memberId: mutation.memberId,
        projectId: mutation.projectId,
        kind: 'agent',
        displayName: mutation.member.displayName,
        status: 'active',
        revision: 1,
        feishuAssigneeEligibility: 'agent-not-assignable',
        createdAt: mutation.createdAt,
        updatedAt: mutation.createdAt,
      }
      : {
        memberId: mutation.memberId,
        projectId: mutation.projectId,
        kind: 'human',
        displayName: mutation.member.displayName,
        status: 'active',
        revision: 1,
        identity: mutation.member.identity.type === 'feishu'
          ? { ...mutation.member.identity, state: 'declared' }
          : { ...mutation.member.identity },
        feishuAssigneeEligibility: mutation.member.identity.type === 'feishu'
          ? 'identifier-present'
          : 'external-contact',
        createdAt: mutation.createdAt,
        updatedAt: mutation.createdAt,
      }
    this.members.set(member.memberId, member)
    this.teamRevisions.set(mutation.projectId, nextTeamRevision)
    return {
      ok: true,
      value: {
        projectId: mutation.projectId,
        memberId: mutation.memberId,
        kind: mutation.member.kind,
        status: 'active',
        memberRevision: 1,
        teamRevision: nextTeamRevision,
        // Deliberate repository-boundary smuggling attempt: Scenario result
        // copying must drop identity material outside the public acknowledgement.
        displayName: member.displayName,
        identity: member.kind === 'human' ? member.identity : null,
      },
      receipt: { ...receipt(mutation), rawIdentity: member },
    } as unknown as AddProjectMemberResult
  }

  lastProjectMemberStatusMutation: WorkbenchProjectMemberStatusMutation | null = null

  async commitProjectMemberStatus(
    mutation: WorkbenchProjectMemberStatusMutation,
  ): Promise<SetProjectMemberStatusResult> {
    this.projectMemberStatusWriteCalls += 1
    this.lastProjectMemberStatusMutation = mutation
    if (!this.projects.has(mutation.projectId)) return projectNotFound(mutation.projectId)
    const teamRevision = this.teamRevisions.get(mutation.projectId) ?? 0
    if (teamRevision !== mutation.expectedTeamRevision) {
      return teamConflict(mutation.expectedTeamRevision, teamRevision)
    }
    const member = this.members.get(mutation.memberId)
    if (member === undefined || member.projectId !== mutation.projectId) {
      return memberNotFound(mutation.memberId)
    }
    if (member.revision !== mutation.expectedMemberRevision) {
      return {
        ok: false,
        error: {
          code: 'member-revision-conflict',
          message: 'fixture member conflict',
          memberId: mutation.memberId,
          expectedMemberRevision: mutation.expectedMemberRevision,
          currentMemberRevision: member.revision,
        },
      }
    }
    if (member.status === mutation.status) {
      return {
        ok: false,
        error: {
          code: 'member-status-conflict',
          message: 'fixture same status',
          memberId: mutation.memberId,
          status: mutation.status,
        },
      }
    }
    const responsibility = this.responsibilities.get(mutation.projectId)
    if (mutation.status === 'inactive' && responsibility !== undefined
      && (responsibility.accountableMemberId === mutation.memberId
        || responsibility.humanSponsorMemberId === mutation.memberId
        || responsibility.contributorMemberIds.includes(mutation.memberId))) {
      return {
        ok: false,
        error: { code: 'member-in-use', message: 'fixture in use', memberId: mutation.memberId },
      }
    }
    const revision = member.revision + 1
    const nextTeamRevision = teamRevision + 1
    const updated: ProjectMemberProjection = member.kind === 'human'
      ? {
        ...member,
        status: mutation.status,
        revision,
        updatedAt: mutation.updatedAt,
        feishuAssigneeEligibility: mutation.status === 'inactive'
          ? 'inactive'
          : member.identity.type === 'feishu' ? 'identifier-present' : 'external-contact',
      }
      : {
        ...member,
        status: mutation.status,
        revision,
        updatedAt: mutation.updatedAt,
        feishuAssigneeEligibility: mutation.status === 'inactive'
          ? 'inactive'
          : 'agent-not-assignable',
      }
    this.members.set(member.memberId, updated)
    this.teamRevisions.set(mutation.projectId, nextTeamRevision)
    return {
      ok: true,
      value: {
        projectId: mutation.projectId,
        memberId: mutation.memberId,
        kind: member.kind,
        status: mutation.status,
        memberRevision: revision,
        teamRevision: nextTeamRevision,
      },
      receipt: receipt(mutation),
    }
  }

  lastProjectResponsibilityMutation: WorkbenchProjectResponsibilityMutation | null = null

  async commitProjectResponsibility(
    mutation: WorkbenchProjectResponsibilityMutation,
  ): Promise<SetProjectResponsibilityResult> {
    this.projectResponsibilityWriteCalls += 1
    this.lastProjectResponsibilityMutation = mutation
    if (!this.projects.has(mutation.projectId)) return projectNotFound(mutation.projectId)
    const teamRevision = this.teamRevisions.get(mutation.projectId) ?? 0
    if (teamRevision !== mutation.expectedTeamRevision) {
      return teamConflict(mutation.expectedTeamRevision, teamRevision)
    }
    const current = this.responsibilities.get(mutation.projectId)
    const currentRevision = current?.revision ?? null
    if (currentRevision !== mutation.expectedResponsibilityRevision) {
      return {
        ok: false,
        error: {
          code: 'responsibility-revision-conflict',
          message: 'fixture responsibility conflict',
          expectedResponsibilityRevision: mutation.expectedResponsibilityRevision,
          currentResponsibilityRevision: currentRevision,
        },
      }
    }
    const referenced = [
      mutation.accountableMemberId,
      ...mutation.contributorMemberIds,
      ...(mutation.humanSponsorMemberId === null ? [] : [mutation.humanSponsorMemberId]),
    ]
    for (const memberId of referenced) {
      const member = this.members.get(memberId)
      if (member === undefined || member.projectId !== mutation.projectId) {
        return memberNotFound(memberId)
      }
      if (member.status !== 'active') {
        return { ok: false, error: { code: 'member-inactive', message: 'fixture inactive', memberId } }
      }
    }
    if (mutation.contributorMemberIds.includes(mutation.accountableMemberId)) {
      return {
        ok: false,
        error: {
          code: 'accountable-also-contributor',
          message: 'fixture overlap',
          memberId: mutation.accountableMemberId,
        },
      }
    }
    const accountable = this.members.get(mutation.accountableMemberId) as ProjectMemberProjection
    const sponsorRequired = accountable.kind === 'agent'
      || (accountable.kind === 'human' && accountable.identity.type === 'external')
    if (sponsorRequired && mutation.humanSponsorMemberId === null) {
      return {
        ok: false,
        error: {
          code: 'human-sponsor-required',
          message: 'fixture sponsor required',
          accountableMemberId: accountable.memberId,
        },
      }
    }
    if (!sponsorRequired && mutation.humanSponsorMemberId !== null) {
      return {
        ok: false,
        error: {
          code: 'human-sponsor-forbidden',
          message: 'fixture sponsor forbidden',
          accountableMemberId: accountable.memberId,
        },
      }
    }
    if (mutation.humanSponsorMemberId !== null) {
      const sponsor = this.members.get(mutation.humanSponsorMemberId) as ProjectMemberProjection
      if (sponsor.memberId === accountable.memberId || sponsor.kind !== 'human') {
        return {
          ok: false,
          error: {
            code: 'human-sponsor-invalid',
            message: 'fixture sponsor invalid',
            humanSponsorMemberId: sponsor.memberId,
          },
        }
      }
    }
    const responsibilityRevision = (current?.revision ?? 0) + 1
    const nextTeamRevision = teamRevision + 1
    this.responsibilities.set(mutation.projectId, {
      projectId: mutation.projectId,
      revision: responsibilityRevision,
      accountableMemberId: mutation.accountableMemberId,
      contributorMemberIds: [...mutation.contributorMemberIds],
      humanSponsorMemberId: mutation.humanSponsorMemberId,
      updatedAt: mutation.updatedAt,
    })
    this.teamRevisions.set(mutation.projectId, nextTeamRevision)
    return {
      ok: true,
      value: {
        projectId: mutation.projectId,
        responsibilityRevision,
        teamRevision: nextTeamRevision,
      },
      receipt: receipt(mutation),
    }
  }

  lastActivityQuery: WorkbenchActivityQuery | null = null

  async readActivity(query: WorkbenchActivityQuery): Promise<WorkbenchActivityProjection> {
    this.activityCalls += 1
    this.lastActivityQuery = query
    return Object.freeze({
      items: Object.freeze([]),
      nextBeforeSequence: null,
      integrity: Object.freeze({
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      }),
    })
  }

  async verifyAuditChain(): Promise<WorkbenchAuditIntegrityProjection> {
    this.integrityCalls += 1
    return Object.freeze({
      valid: true,
      eventCount: 0,
      headHash: TEST_AUDIT_GENESIS,
      issue: null,
    })
  }

  async claimOutbox(_request: WorkbenchOutboxClaimRequest): Promise<WorkbenchOutboxClaim | null> {
    return null
  }

  async settleOutbox(_settlement: WorkbenchOutboxSettlement): Promise<boolean> {
    return false
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

function projectNotFound(projectId: string) {
  return {
    ok: false as const,
    error: {
      code: 'project-not-found' as const,
      message: 'fixture Project not found',
      projectId,
    },
  }
}

function teamConflict(expectedTeamRevision: number, currentTeamRevision: number) {
  return {
    ok: false as const,
    error: {
      code: 'team-revision-conflict' as const,
      message: 'fixture Team conflict',
      expectedTeamRevision,
      currentTeamRevision,
    },
  }
}

function memberNotFound(memberId: string) {
  return {
    ok: false as const,
    error: {
      code: 'member-not-found' as const,
      message: 'fixture member not found',
      memberId,
    },
  }
}

function receipt(mutation: {
  readonly command: {
    readonly commandId: string
    readonly auditEventId: string
    readonly outboxId: string
  }
}) {
  return {
    commandId: mutation.command.commandId,
    auditEventId: mutation.command.auditEventId,
    outboxId: mutation.command.outboxId,
  }
}

function createScenario(
  repository = new MemoryRepository(),
  access: WorkbenchAuthorization = authorization,
): {
  readonly repository: MemoryRepository
  readonly scenario: WorkbenchScenario
} {
  const instants = [
    new Date('2026-08-31T01:02:03.000Z'),
    new Date('2026-08-31T02:03:04.000Z'),
  ]
  const statusIds = ['status-001', 'status-002']
  const projectIds = ['project-001', 'project-002']
  const projectMemberIds = ['member-001', 'member-002', 'member-003', 'member-004']
  const goalIds = ['goal-001', 'goal-002']
  const outcomeIds = ['outcome-001', 'outcome-002', 'outcome-003']
  const commandIds = Array.from({ length: 12 }, (_, index) => `command-${String(index + 1).padStart(3, '0')}`)
  const auditIds = Array.from({ length: 12 }, (_, index) => `audit-${String(index + 1).padStart(3, '0')}`)
  const outboxIds = Array.from({ length: 12 }, (_, index) => `outbox-${String(index + 1).padStart(3, '0')}`)
  const adapters = { feishu: { adapterId: 'fixture-feishu' } } as const
  return {
    repository,
    scenario: new WorkbenchScenario({
      repository,
      clock: { now: () => instants.shift() ?? new Date('2026-08-31T03:04:05.000Z') },
      ids: {
        nextStatusId: () => statusIds.shift() ?? 'status-fallback',
        nextProjectId: () => projectIds.shift() ?? 'project-fallback',
        nextProjectMemberId: () => projectMemberIds.shift() ?? 'member-fallback',
        nextGoalId: () => goalIds.shift() ?? 'goal-fallback',
        nextOutcomeId: () => outcomeIds.shift() ?? 'outcome-fallback',
        nextCommandId: () => commandIds.shift() ?? 'command-fallback',
        nextAuditEventId: () => auditIds.shift() ?? 'audit-fallback',
        nextOutboxId: () => outboxIds.shift() ?? 'outbox-fallback',
      },
      adapters,
      authorization: access,
      maxStatusLength: 12,
    }),
  }
}

function failureCode(error: unknown): string | undefined {
  return error instanceof TypertRemoteFailure ? error.failure.code : undefined
}

function statusRequest(message: string, expectedRevision: number | null) {
  return {
    message,
    expectedRevision,
    idempotencyKey: 'idempotency-key-001',
    causationId: 'causation-id-000001',
    reason: 'owner-status-edit' as const,
  }
}

function projectRequest(overrides: Partial<CreateProjectRequest> = {}): CreateProjectRequest {
  return {
    template: {
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    },
    projectName: 'Market research',
    primaryGoal: {
      name: 'Validate demand',
      outcomes: [{
        name: 'Complete qualified interviews',
        metric: {
          metricName: 'Qualified interviews',
          initialValue: 0,
          targetValue: 20,
          unit: 'interviews',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'project-idempotency-key-0001',
    causationId: 'project-causation-id-0001',
    reason: 'owner-project-create',
    ...overrides,
  }
}

function addMemberRequest(
  member: AddProjectMemberRequest['member'],
  expectedTeamRevision: number,
  overrides: Partial<AddProjectMemberRequest> = {},
): AddProjectMemberRequest {
  return {
    projectId: 'project-001',
    member,
    expectedTeamRevision,
    expectedRevision: null,
    idempotencyKey: `member-idempotency-${String(expectedTeamRevision).padStart(4, '0')}`,
    causationId: `member-causation-${String(expectedTeamRevision).padStart(6, '0')}`,
    reason: 'owner-project-member-add',
    ...overrides,
  }
}

function memberStatusRequest(
  memberId: string,
  status: SetProjectMemberStatusRequest['status'],
  expectedTeamRevision: number,
  expectedMemberRevision: number,
  overrides: Partial<SetProjectMemberStatusRequest> = {},
): SetProjectMemberStatusRequest {
  return {
    projectId: 'project-001',
    memberId,
    status,
    expectedTeamRevision,
    expectedMemberRevision,
    idempotencyKey: `status-idempotency-${memberId}-${String(expectedMemberRevision)}`,
    causationId: `status-causation-${memberId}-${String(expectedMemberRevision)}`,
    reason: 'owner-project-member-status-change',
    ...overrides,
  }
}

function responsibilityRequest(
  overrides: Partial<SetProjectResponsibilityRequest> = {},
): SetProjectResponsibilityRequest {
  return {
    projectId: 'project-001',
    accountableMemberId: 'member-003',
    contributorMemberIds: ['member-002', 'member-001'],
    humanSponsorMemberId: 'member-001',
    expectedTeamRevision: 3,
    expectedResponsibilityRevision: null,
    idempotencyKey: 'responsibility-idempotency-0001',
    causationId: 'responsibility-causation-0001',
    reason: 'owner-project-responsibility-set',
    ...overrides,
  }
}

describe('WorkbenchScenario', () => {
  it('drives a deterministic command through the repository into the public projection', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()

    await expect(scenario.snapshot()).resolves.toBeNull()
    await expect(scenario.setStatus(
      {
        ...statusRequest('  On track  ', null),
        actor: { kind: 'owner', id: 'browser-forged-owner' },
        organizationId: 'browser-forged-organization',
      } as SetStatusRequest,
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'On track',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await expect(scenario.snapshot()).resolves.toEqual({
      id: 'status-001',
      message: 'On track',
      revision: 1,
      updatedAt: '2026-08-31T01:02:03.000Z',
    })
    expect(repository.openCalls).toBe(1)
    expect(repository.lastMutation?.command).toMatchObject({
      actor: {
        kind: 'owner',
        id: 'owner-test',
        organizationId: 'organization-test',
        teamId: 'team-test',
      },
      idempotencyKey: 'idempotency-key-001',
      causationId: 'causation-id-000001',
      reason: 'owner-status-edit',
    })
    expect(scenario.adapters).toEqual({ feishu: { adapterId: 'fixture-feishu' } })

    await scenario.close()
  })

  it('reads Project start, creates deterministic Goal/Outcomes/Project, and reopens a detached snapshot', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    const start = await scenario.projectStart({}, signal)
    expect(start).toEqual({
      template: KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
      catalogRevision: 0,
      projects: [],
      nextBeforeSequence: null,
    })
    expect(repository.lastProjectStartQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      filter: { limit: 20 },
    })

    const created = await scenario.createProject(projectRequest({
      projectName: '  Market research  ',
      primaryGoal: {
        name: '  Validate demand  ',
        outcomes: [
          {
            name: '  Complete qualified interviews  ',
            metric: {
              metricName: '  Qualified interviews  ',
              initialValue: 0,
              targetValue: 20,
              unit: '  interviews  ',
              direction: 'increase',
            },
          },
          {
            name: 'Reduce unresolved assumptions',
            metric: {
              metricName: 'Unresolved assumptions',
              initialValue: 12,
              targetValue: 3,
              unit: 'assumptions',
              direction: 'decrease',
            },
          },
        ],
      },
    }), signal)

    expect(created).toMatchObject({
      ok: true,
      catalogRevision: 1,
      value: {
        project: {
          projectId: 'project-001',
          name: 'Market research',
          revision: 1,
          catalogSequence: 1,
          timezone: 'Asia/Shanghai',
          createdAt: '2026-08-31T01:02:03.000Z',
          primaryGoal: { goalId: 'goal-001', name: 'Validate demand', revision: 1 },
        },
        primaryGoal: {
          goalId: 'goal-001',
          outcomes: [
            { outcomeId: 'outcome-001', metric: { direction: 'increase' } },
            { outcomeId: 'outcome-002', metric: { direction: 'decrease' } },
          ],
        },
        templateSnapshot: {
          template: {
            definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
          },
          definition: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
          snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
        },
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    expect(repository.lastProjectMutation).toMatchObject({
      projectId: 'project-001',
      primaryGoalId: 'goal-001',
      projectName: 'Market research',
      primaryGoal: {
        name: 'Validate demand',
        outcomes: [
          { outcomeId: 'outcome-001', name: 'Complete qualified interviews' },
          { outcomeId: 'outcome-002', name: 'Reduce unresolved assumptions' },
        ],
      },
      expectedCatalogRevision: 0,
      expectedRevision: null,
      command: {
        actor: {
          kind: 'owner',
          id: 'owner-test',
          organizationId: 'organization-test',
          teamId: 'team-test',
        },
        reason: 'owner-project-create',
      },
    })
    if (!created.ok) throw new Error('fixture Project creation unexpectedly failed')
    expect(Object.isFrozen(created.value.primaryGoal.outcomes)).toBe(true)
    expect(Object.isFrozen(created.value.templateSnapshot.definition.rules)).toBe(true)

    await expect(scenario.project({ projectId: 'project-001' }, signal))
      .resolves.toEqual(created.value)
    expect(repository.lastProjectReadQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      projectId: 'project-001',
    })
    await expect(scenario.project({ projectId: 'project-missing' }, signal)).resolves.toBeNull()

    const linked = await scenario.createProject(projectRequest({
      projectName: 'Research synthesis',
      primaryGoal: {
        name: 'Turn evidence into a decision',
        outcomes: [{
          name: 'Publish the decision brief',
          metric: {
            metricName: 'Accepted decision briefs',
            initialValue: 0,
            targetValue: 1,
            unit: 'briefs',
            direction: 'increase',
          },
        }],
      },
      supportingGoals: [{ goalId: 'goal-001', expectedRevision: 1 }],
      expectedCatalogRevision: 1,
      idempotencyKey: 'project-idempotency-key-0002',
      causationId: 'project-causation-id-0002',
    }), signal)
    expect(linked).toMatchObject({
      ok: true,
      catalogRevision: 2,
      value: {
        project: { projectId: 'project-002', primaryGoal: { goalId: 'goal-002' } },
        primaryGoal: { goalId: 'goal-002', outcomes: [{ outcomeId: 'outcome-003' }] },
        supportingGoals: [{ goalId: 'goal-001', name: 'Validate demand', revision: 1 }],
      },
    })
    if (!linked.ok) throw new Error('fixture linked Project creation unexpectedly failed')
    await expect(scenario.project({ projectId: 'project-002' }, signal))
      .resolves.toEqual(linked.value)

    await scenario.close()
  })

  it('manages a detached Project Team, canonical responsibility, and retained inactive members', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal
    const project = await scenario.createProject(projectRequest(), signal)
    if (!project.ok) throw new Error('fixture Project creation unexpectedly failed')

    await expect(scenario.projectTeam({ projectId: 'project-001' }, signal)).resolves.toEqual({
      projectId: 'project-001',
      teamRevision: 0,
      members: [],
      responsibility: null,
    })
    expect(repository.lastProjectTeamReadQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      projectId: 'project-001',
    })

    const feishu = await scenario.addProjectMember(addMemberRequest({
      kind: 'human',
      displayName: '  Lin Owner  ',
      identity: { type: 'feishu', appId: 'cli.app:001', openId: 'ou-user_001' },
    }, 0), signal)
    expect(feishu).toMatchObject({
      ok: true,
      value: {
        projectId: 'project-001',
        memberId: 'member-001',
        kind: 'human',
        status: 'active',
        memberRevision: 1,
        teamRevision: 1,
      },
    })
    expect(JSON.stringify(feishu)).not.toContain('Lin Owner')
    expect(JSON.stringify(feishu)).not.toContain('ou-user_001')

    await scenario.addProjectMember(addMemberRequest({
      kind: 'human',
      displayName: 'External Expert',
      identity: { type: 'external', method: 'email', value: 'expert@example.test' },
    }, 1, {
      idempotencyKey: 'member-idempotency-0002',
      causationId: 'member-causation-000002',
    }), signal)
    await scenario.addProjectMember(addMemberRequest({
      kind: 'agent',
      displayName: 'Research Agent',
    }, 2, {
      idempotencyKey: 'member-idempotency-0003',
      causationId: 'member-causation-000003',
    }), signal)

    const team = await scenario.projectTeam({ projectId: 'project-001' }, signal)
    expect(team).toMatchObject({
      projectId: 'project-001',
      teamRevision: 3,
      members: [
        {
          memberId: 'member-001',
          kind: 'human',
          displayName: 'Lin Owner',
          identity: { type: 'feishu', state: 'declared' },
          feishuAssigneeEligibility: 'identifier-present',
        },
        {
          memberId: 'member-002',
          kind: 'human',
          identity: { type: 'external' },
          feishuAssigneeEligibility: 'external-contact',
        },
        {
          memberId: 'member-003',
          kind: 'agent',
          feishuAssigneeEligibility: 'agent-not-assignable',
        },
      ],
      responsibility: null,
    })
    if (team === null) throw new Error('fixture Team unexpectedly missing')
    expect(Object.isFrozen(team)).toBe(true)
    expect(Object.isFrozen(team.members)).toBe(true)
    expect(Object.isFrozen(team.members[0])).toBe(true)
    expect(Object.isFrozen(team.members[0]?.kind === 'human' && team.members[0].identity)).toBe(true)

    await expect(scenario.setProjectResponsibility(responsibilityRequest({
      humanSponsorMemberId: null,
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'human-sponsor-required', accountableMemberId: 'member-003' },
    })
    await expect(scenario.setProjectResponsibility(responsibilityRequest({
      accountableMemberId: 'member-001',
      contributorMemberIds: ['member-002', 'member-003'],
      humanSponsorMemberId: 'member-002',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'human-sponsor-forbidden', accountableMemberId: 'member-001' },
    })

    const assigned = await scenario.setProjectResponsibility(responsibilityRequest(), signal)
    expect(assigned).toMatchObject({
      ok: true,
      value: {
        projectId: 'project-001',
        responsibilityRevision: 1,
        teamRevision: 4,
      },
    })
    expect(repository.lastProjectResponsibilityMutation?.contributorMemberIds)
      .toEqual(['member-001', 'member-002'])
    expect(JSON.stringify(assigned)).not.toContain('member-001')
    expect(JSON.stringify(assigned)).not.toContain('member-002')
    expect(JSON.stringify(assigned)).not.toContain('member-003')

    await expect(scenario.setProjectMemberStatus(
      memberStatusRequest('member-001', 'inactive', 4, 1),
      signal,
    )).resolves.toMatchObject({ ok: false, error: { code: 'member-in-use' } })

    await expect(scenario.setProjectResponsibility(responsibilityRequest({
      accountableMemberId: 'member-001',
      contributorMemberIds: ['member-003'],
      humanSponsorMemberId: null,
      expectedTeamRevision: 4,
      expectedResponsibilityRevision: 1,
      idempotencyKey: 'responsibility-idempotency-0002',
      causationId: 'responsibility-causation-0002',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { responsibilityRevision: 2, teamRevision: 5 },
    })

    await expect(scenario.setProjectMemberStatus(
      memberStatusRequest('member-002', 'inactive', 5, 1),
      signal,
    )).resolves.toMatchObject({
      ok: true,
      value: { memberId: 'member-002', memberRevision: 2, teamRevision: 6 },
    })
    await expect(scenario.setProjectMemberStatus(
      memberStatusRequest('member-002', 'inactive', 6, 2, {
        idempotencyKey: 'status-idempotency-member-002-2b',
        causationId: 'status-causation-member-002-2b',
      }),
      signal,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'member-status-conflict', status: 'inactive' },
    })

    const reopened = await scenario.projectTeam({ projectId: 'project-001' }, signal)
    expect(reopened).toMatchObject({
      teamRevision: 6,
      responsibility: {
        revision: 2,
        accountableMemberId: 'member-001',
        contributorMemberIds: ['member-003'],
        humanSponsorMemberId: null,
      },
      members: [
        { memberId: 'member-001', status: 'active' },
        { memberId: 'member-002', status: 'inactive', feishuAssigneeEligibility: 'inactive' },
        { memberId: 'member-003', status: 'active' },
      ],
    })
    await expect(scenario.projectTeam({ projectId: 'project-missing' }, signal)).resolves.toBeNull()
    await scenario.close()
  })

  it('rejects inexact Project Team identity, revision, and responsibility input before storage', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal
    const invalidMembers: unknown[] = [
      { ...addMemberRequest({ kind: 'agent', displayName: 'Agent' }, 0), extra: true },
      addMemberRequest({ kind: 'agent', displayName: 'Agent', identity: {
        type: 'external', method: 'other', value: 'forged',
      } } as never, 0),
      addMemberRequest({
        kind: 'agent',
        displayName: 'Agent',
        agentProfileVersionId: 'profile-version-forged',
      } as never, 0),
      addMemberRequest({ kind: 'human', displayName: 'Human' } as never, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: { type: 'feishu', appId: 'cli_app', openId: 'ou_user', state: 'declared' },
      } as never, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: {
          type: 'feishu',
          appId: 'cli_app',
          openId: 'ou_user',
          method: 'email',
          value: 'hybrid@example.test',
        },
      } as never, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: {
          type: 'external',
          method: 'email',
          value: 'human@example.test',
          appId: 'cli_app',
          openId: 'ou_user',
        },
      } as never, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: { type: 'feishu', appId: 'cli app', openId: 'ou_user' },
      }, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: { type: 'feishu', appId: 'cli_app', openId: '成员' },
      }, 0),
      addMemberRequest({
        kind: 'human',
        displayName: '\ud800',
        identity: { type: 'external', method: 'email', value: 'human@example.test' },
      }, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: { type: 'external', method: 'email', value: 'line\nbreak' },
      }, 0),
      addMemberRequest({
        kind: 'human',
        displayName: 'Human',
        identity: { type: 'external', method: 'sms', value: '123' },
      } as never, 0),
      { ...addMemberRequest({ kind: 'agent', displayName: 'Agent' }, 0), expectedTeamRevision: -1 },
      { ...addMemberRequest({ kind: 'agent', displayName: 'Agent' }, 0), expectedRevision: 1 },
      { ...addMemberRequest({ kind: 'agent', displayName: 'Agent' }, 0), reason: 'raw text' },
    ]
    for (const request of invalidMembers) {
      const error = await scenario.addProjectMember(
        request as AddProjectMemberRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectMemberWriteCalls).toBe(0)

    for (const request of [
      { ...memberStatusRequest('member-001', 'inactive', 0, 1), status: 'deleted' },
      { ...memberStatusRequest('member-001', 'inactive', 0, 1), expectedMemberRevision: 0 },
      { ...memberStatusRequest('member-001', 'inactive', 0, 1), expectedTeamRevision: -1 },
      { ...memberStatusRequest('member-001', 'inactive', 0, 1), displayName: 'leak' },
    ]) {
      const error = await scenario.setProjectMemberStatus(
        request as SetProjectMemberStatusRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectMemberStatusWriteCalls).toBe(0)

    const duplicate = responsibilityRequest({
      contributorMemberIds: ['member-001', 'member-001'],
    })
    const tooMany = responsibilityRequest({
      contributorMemberIds: Array.from({ length: 21 }, (_, index) => `member-${String(index)}`),
    })
    for (const request of [
      duplicate,
      tooMany,
      { ...responsibilityRequest(), expectedTeamRevision: -1 },
      { ...responsibilityRequest(), expectedResponsibilityRevision: 0 },
      { ...responsibilityRequest(), humanSponsorMemberId: 'unsafe member' },
      { ...responsibilityRequest(), reason: 'raw text' },
      { ...responsibilityRequest(), accountableDisplayName: 'leak' },
    ]) {
      const error = await scenario.setProjectResponsibility(
        request as SetProjectResponsibilityRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectResponsibilityWriteCalls).toBe(0)

    for (const query of [
      { projectId: 'unsafe member' },
      { projectId: 'project-001', actor: 'forged' },
    ]) {
      const error = await scenario.projectTeam(query as never, signal)
        .catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectTeamReadCalls).toBe(0)
    await scenario.close()
  })

  it('rejects invalid Project input before persistence and keeps domain conflicts typed', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal
    const base = projectRequest()
    const invalidRequests: unknown[] = [
      { ...base, actor: { kind: 'owner', id: 'browser-forged' } },
      { ...base, projectName: '   ' },
      { ...base, projectName: '\ud800' },
      { ...base, primaryGoal: { ...base.primaryGoal, outcomes: [] } },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, targetValue: Number.NaN },
          }],
        },
      },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, initialValue: -0 },
          }],
        },
      },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, targetValue: 0 },
          }],
        },
      },
      {
        ...base,
        supportingGoals: [
          { goalId: 'goal-existing', expectedRevision: 1 },
          { goalId: 'goal-existing', expectedRevision: 1 },
        ],
      },
      { ...base, expectedCatalogRevision: -1 },
      { ...base, expectedRevision: 1 },
      { ...base, reason: 'arbitrary-reason' },
    ]
    for (const request of invalidRequests) {
      const error = await scenario.createProject(request as CreateProjectRequest, signal)
        .catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectWriteCalls).toBe(0)

    repository.catalogRevision = 2
    await expect(scenario.createProject(projectRequest(), signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'catalog-revision-conflict',
        message: 'fixture catalog conflict',
        expectedCatalogRevision: 0,
        currentCatalogRevision: 2,
      },
    })
    await scenario.close()
  })

  it('returns revision conflict as a domain result with the current projection', async () => {
    const { scenario, repository } = createScenario()
    repository.state = {
      id: 'status-existing',
      message: 'Current',
      revision: 3,
      updatedAt: '2026-08-30T01:00:00.000Z',
    }
    await scenario.open()

    await expect(scenario.setStatus(
      statusRequest('Stale update', 2),
      new AbortController().signal,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'revision-conflict',
        message: 'fixture conflict',
        current: repository.state,
      },
    })

    await scenario.close()
  })

  it('rejects malformed commands before persistence with typed Remote failures', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    for (const request of [
      { ...statusRequest('   ', null) },
      { ...statusRequest('1234567890123', null) },
      { ...statusRequest('valid', 0) },
      { ...statusRequest('valid', null), idempotencyKey: 'short' },
      { ...statusRequest('valid', null), reason: 'raw user text' },
    ]) {
      const error = await scenario.setStatus(
        request as SetStatusRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.writeCalls).toBe(0)

    const cancelled = new AbortController()
    cancelled.abort(new Error('caller left'))
    const error = await scenario.setStatus(
      statusRequest('valid', null),
      cancelled.signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(repository.writeCalls).toBe(0)

    await scenario.close()
  })

  it('fails closed at the shared authorization seam before reading or writing persistence', async () => {
    const repository = new MemoryRepository()
    const { scenario } = createScenario(repository, new WorkbenchAuthorizationContext())
    await scenario.open()

    const readError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(readError)).toBe('unauthorized')
    const writeError = await scenario.setStatus(
      statusRequest('Must not pass', null),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(writeError)).toBe('unauthorized')
    const projectStartError = await scenario.projectStart({}, new AbortController().signal)
      .catch((reason: unknown) => reason)
    expect(failureCode(projectStartError)).toBe('unauthorized')
    const createProjectError = await scenario.createProject(
      projectRequest(),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(createProjectError)).toBe('unauthorized')
    const projectError = await scenario.project(
      { projectId: 'project-secret' },
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(projectError)).toBe('unauthorized')
    const projectTeamError = await scenario.projectTeam(
      { projectId: 'project-secret' },
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(projectTeamError)).toBe('unauthorized')
    const addMemberError = await scenario.addProjectMember(addMemberRequest({
      kind: 'agent',
      displayName: 'Secret Agent',
    }, 0), new AbortController().signal).catch((reason: unknown) => reason)
    expect(failureCode(addMemberError)).toBe('unauthorized')
    const statusMemberError = await scenario.setProjectMemberStatus(
      memberStatusRequest('member-secret', 'inactive', 0, 1),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(statusMemberError)).toBe('unauthorized')
    const responsibilityError = await scenario.setProjectResponsibility(
      responsibilityRequest(),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(responsibilityError)).toBe('unauthorized')
    expect(repository.readCalls).toBe(0)
    expect(repository.writeCalls).toBe(0)
    expect(repository.activityCalls).toBe(0)
    expect(repository.integrityCalls).toBe(0)
    expect(repository.projectStartCalls).toBe(0)
    expect(repository.projectWriteCalls).toBe(0)
    expect(repository.projectReadCalls).toBe(0)
    expect(repository.projectTeamReadCalls).toBe(0)
    expect(repository.projectMemberWriteCalls).toBe(0)
    expect(repository.projectMemberStatusWriteCalls).toBe(0)
    expect(repository.projectResponsibilityWriteCalls).toBe(0)

    await scenario.close()
  })

  it('derives Activity scope from authorization and validates safe filters before storage', async () => {
    const repository = new MemoryRepository()
    const required: string[] = []
    const filtered: string[] = []
    const access: WorkbenchAuthorization = {
      require: action => {
        required.push(action)
        return Promise.resolve({
          ownerId: 'owner-authoritative',
          organizationId: 'organization-authoritative',
          teamId: 'team-authoritative',
        })
      },
      filterProjection: (action, projection) => {
        filtered.push(action)
        return Promise.resolve(projection)
      },
    }
    const { scenario } = createScenario(repository, access)
    await scenario.open()

    await expect(scenario.activity({
      projectId: 'project-safe',
      objectType: 'workbench-status',
      objectId: 'status-safe',
      action: 'workbench.status.updated',
      beforeSequence: 4,
      limit: 10,
    })).resolves.toEqual({
      items: [],
      nextBeforeSequence: null,
      integrity: {
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      },
    })
    expect(repository.lastActivityQuery).toEqual({
      organizationId: 'organization-authoritative',
      filter: {
        projectId: 'project-safe',
        objectType: 'workbench-status',
        objectId: 'status-safe',
        action: 'workbench.status.updated',
        beforeSequence: 4,
        limit: 10,
      },
    })
    await scenario.activity({
      projectId: 'project-safe',
      objectType: 'project-member',
      objectId: 'member-safe',
      action: 'workbench.project-member.status-changed',
      limit: 5,
    })
    expect(repository.lastActivityQuery?.filter).toEqual({
      projectId: 'project-safe',
      objectType: 'project-member',
      objectId: 'member-safe',
      action: 'workbench.project-member.status-changed',
      limit: 5,
    })
    await expect(scenario.auditIntegrity()).resolves.toMatchObject({ valid: true, eventCount: 0 })
    expect(required).toEqual([
      'workbench.activity.read',
      'workbench.activity.read',
      'workbench.audit.verify',
    ])
    expect(filtered).toEqual([
      'workbench.activity.read',
      'workbench.activity.read',
      'workbench.audit.verify',
    ])

    for (const filter of [{ limit: 101 }, { limit: 10, rawContact: 'secret' }]) {
      const error = await scenario.activity(filter as never).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.activityCalls).toBe(2)
    await scenario.close()
  })

  it('stops admission, cancels and drains in-flight work, then closes its repository once', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSnapshot = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()

    const pending = scenario.snapshot()
    await started.promise
    const closing = scenario.close()
    const pendingError = await pending.catch((reason: unknown) => reason)
    expect(failureCode(pendingError)).toBe('cancelled')
    await closing

    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
    await scenario.close()
    expect(repository.closeCalls).toBe(1)
    const lateError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(lateError)).toBe('unavailable')
  })

  it('preserves caller cancellation while an accepted persistence operation is in flight', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSetStatus = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('In flight', null), caller.signal)
    await started.promise
    caller.abort(new Error('caller left'))

    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(scenario.lifecycle).toBe('running')
    await scenario.close()
  })

  it('returns the durable result when cancellation races after the commit point', async () => {
    const repository = new MemoryRepository()
    const committed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    repository.afterSetStatus = async (signal) => {
      committed.resolve()
      await release.promise
      expect(signal.aborted).toBe(true)
    }
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('Committed', null), caller.signal)
    await committed.promise
    caller.abort(new Error('caller left after commit'))
    release.resolve()

    await expect(pending).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'Committed',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await scenario.close()
  })

  it('cancels and drains an admitted Project create before closing storage', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onCreateProject = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()

    const pending = scenario.createProject(projectRequest(), new AbortController().signal)
    await started.promise
    const closing = scenario.close()
    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    await closing

    expect(repository.projects.size).toBe(0)
    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
  })
})
