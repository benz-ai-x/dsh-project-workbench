import { describe, expect, it } from 'vitest'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  ConfigureFeishuIdentityRouteRequest,
  ConfigureFeishuIdentityRouteResult,
  CreateProjectRequest,
  CreateProjectResult,
  DecideSuggestedChangeRequest,
  DecideSuggestedChangeResult,
  FeishuCredentialProjection,
  FeishuIdentityKind,
  ProjectDetailProjection,
  ProjectMemberProjection,
  ProjectResponsibilityProjection,
  ProposeProjectResponsibilityChangeRequest,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterProjection,
  SuggestedChangeProjection,
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
  WorkbenchFeishuConnectionQuery,
  WorkbenchFeishuExternalAdapter,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
  WorkbenchFeishuRouteMutation,
  WorkbenchFeishuVerificationMutation,
  WorkbenchFeishuVerificationObservation,
  WorkbenchFeishuVerificationReplayQuery,
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
  WorkbenchReviewCenterQuery,
  WorkbenchStatusMutation,
  WorkbenchStatusSnapshot,
  WorkbenchSuggestedChangeDecisionMutation,
  WorkbenchSuggestedChangeProposalMutation,
  WorkbenchStoredFeishuConnectionProjection,
  VerifyFeishuIdentityRouteRequest,
  VerifyFeishuIdentityRouteResult,
} from '../src/index.ts'

const TEST_AUDIT_GENESIS = `sha256:${'0'.repeat(64)}`
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
  KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
  WorkbenchScenario,
} from '../src/index.ts'
import {
  WorkbenchAuthorizationContext,
  type WorkbenchAction,
  type WorkbenchAuthorization,
} from '../src/authorization.ts'

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
  reviewCenterReadCalls = 0
  suggestedChangeProposalWriteCalls = 0
  suggestedChangeDecisionWriteCalls = 0
  feishuConnectionReadCalls = 0
  feishuRouteWriteCalls = 0
  feishuVerificationReplayCalls = 0
  feishuVerificationWriteCalls = 0
  catalogRevision = 0
  readonly projects = new Map<string, ProjectDetailProjection>()
  readonly members = new Map<string, ProjectMemberProjection>()
  readonly responsibilities = new Map<string, ProjectResponsibilityProjection>()
  readonly teamRevisions = new Map<string, number>()
  readonly suggestedChanges = new Map<string, SuggestedChangeProjection>()
  feishuConnection: WorkbenchStoredFeishuConnectionProjection = emptyFeishuConnection()
  readonly feishuRouteReceipts = new Map<string, {
    readonly fingerprint: string
    readonly result: ConfigureFeishuIdentityRouteResult
  }>()
  readonly feishuVerificationReceipts = new Map<string, {
    readonly fingerprint: string
    readonly result: VerifyFeishuIdentityRouteResult
  }>()
  suggestedChangeSequence = 0
  onSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined
  onSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  afterSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  onCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined
  afterCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined
  onReviewCenter: ((signal: AbortSignal) => Promise<void>) | undefined
  onSuggestedChangeProposal: ((signal: AbortSignal) => Promise<void>) | undefined
  onSuggestedChangeDecision: ((signal: AbortSignal) => Promise<void>) | undefined
  onReadFeishuConnection: ((signal: AbortSignal) => Promise<void>) | undefined
  onCommitFeishuRoute: ((signal: AbortSignal) => Promise<void>) | undefined
  onReplayFeishuVerification: ((signal: AbortSignal) => Promise<void>) | undefined
  onCommitFeishuVerification: ((signal: AbortSignal) => Promise<void>) | undefined
  lastFeishuConnectionQuery: WorkbenchFeishuConnectionQuery | null = null
  lastFeishuRouteMutation: WorkbenchFeishuRouteMutation | null = null
  lastFeishuVerificationReplayQuery: WorkbenchFeishuVerificationReplayQuery | null = null
  lastFeishuVerificationMutation: WorkbenchFeishuVerificationMutation | null = null

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
    const candidateIdentity = mutation.member.kind === 'human' ? mutation.member.identity : null
    if (candidateIdentity?.type === 'feishu'
      && projectMembers.some(member => member.kind === 'human'
        && member.identity.type === 'feishu'
        && member.identity.appId === candidateIdentity.appId
        && member.identity.openId === candidateIdentity.openId)) {
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

  lastReviewCenterQuery: WorkbenchReviewCenterQuery | null = null

  async readReviewCenter(
    query: WorkbenchReviewCenterQuery,
    signal: AbortSignal,
  ): Promise<ReviewCenterProjection | null> {
    this.reviewCenterReadCalls += 1
    this.lastReviewCenterQuery = query
    await this.onReviewCenter?.(signal)
    if (!this.projects.has(query.filter.projectId)) return null
    const projectId = query.filter.projectId
    const teamRevision = this.teamRevisions.get(projectId) ?? 0
    const currentResponsibility = this.responsibilities.get(projectId)
    const limit = query.filter.limit ?? 20
    const candidates = [...this.suggestedChanges.values()]
      .filter(item => item.projectId === projectId)
      .map(item => reviewCardAtTeamRevision(item, teamRevision, currentResponsibility?.revision ?? null))
      .filter(item => query.filter.status === undefined
        || item.effectiveStatus === query.filter.status)
      .filter(item => query.filter.riskLevel === undefined
        || item.risk.effectiveLevel === query.filter.riskLevel)
      .filter(item => query.filter.beforeSequence === undefined
        || item.sequence < query.filter.beforeSequence)
      .sort((left, right) => right.sequence - left.sequence)
    const items = candidates.slice(0, limit)
    return {
      projectId,
      proposalBuilder: {
        projectId,
        teamRevision,
        responsibilityRevision: currentResponsibility?.revision ?? null,
        base: currentResponsibility === undefined
          ? {
            accountableMemberId: null,
            contributorMemberIds: [],
            humanSponsorMemberId: null,
          }
          : {
            accountableMemberId: currentResponsibility.accountableMemberId,
            contributorMemberIds: [...currentResponsibility.contributorMemberIds],
            humanSponsorMemberId: currentResponsibility.humanSponsorMemberId,
          },
        memberOptions: [...this.members.values()]
          .filter(member => member.projectId === projectId)
          .sort((left, right) => left.memberId.localeCompare(right.memberId))
          .map(member => ({
            memberId: member.memberId,
            displayName: member.displayName,
            kind: member.kind,
            status: member.status,
            requiresHumanSponsor: member.kind === 'agent'
              || (member.kind === 'human' && member.identity.type === 'external'),
            canBeHumanSponsor: member.kind === 'human',
          })),
        evidenceOptions: [reviewEvidence('audit-evidence-001', projectId)],
      },
      items,
      nextBeforeSequence: candidates.length > items.length
        ? items.at(-1)?.sequence ?? null
        : null,
    }
  }

  lastSuggestedChangeProposalMutation: WorkbenchSuggestedChangeProposalMutation | null = null

  async commitSuggestedChangeProposal(
    mutation: WorkbenchSuggestedChangeProposalMutation,
    signal: AbortSignal,
  ): Promise<ProposeProjectResponsibilityChangeResult> {
    this.suggestedChangeProposalWriteCalls += 1
    this.lastSuggestedChangeProposalMutation = mutation
    await this.onSuggestedChangeProposal?.(signal)
    if (!this.projects.has(mutation.projectId)) return projectNotFound(mutation.projectId)
    const teamRevision = this.teamRevisions.get(mutation.projectId) ?? 0
    if (teamRevision !== mutation.expectedTeamRevision) {
      return teamConflict(mutation.expectedTeamRevision, teamRevision)
    }
    const evidenceIds = mutation.evidenceRefs.map(reference => reference.auditEventId)
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      return {
        ok: false,
        error: {
          code: 'evidence-invalid',
          message: 'fixture duplicate evidence',
          reason: 'duplicate',
        },
      }
    }
    const current = this.responsibilities.get(mutation.projectId)
    const before = current === undefined
      ? {
        accountableMemberId: null,
        contributorMemberIds: [] as string[],
        humanSponsorMemberId: null,
      }
      : {
        accountableMemberId: current.accountableMemberId,
        contributorMemberIds: [...current.contributorMemberIds],
        humanSponsorMemberId: current.humanSponsorMemberId,
      }
    const changedFields = responsibilityChangedFields(before, mutation.candidate)
    if (changedFields.length === 0) {
      return {
        ok: false,
        error: { code: 'no-op-suggested-change', message: 'fixture no-op' },
      }
    }
    const risk = responsibilityRisk(before, mutation.candidate)
    this.suggestedChangeSequence += 1
    const item: SuggestedChangeProjection = {
      suggestedChangeId: mutation.suggestedChangeId,
      sequence: this.suggestedChangeSequence,
      revision: 1,
      projectId: mutation.projectId,
      source: { kind: 'owner', actorId: mutation.command.actor.id },
      target: {
        kind: 'project-responsibility',
        adapter: 'project-responsibility.replace',
        representationSchemaVersion: 1,
        projectId: mutation.projectId,
        baseTeamRevision: teamRevision,
        baseResponsibilityRevision: current?.revision ?? null,
        currentTeamRevision: teamRevision,
        currentResponsibilityRevision: current?.revision ?? null,
      },
      proposedDiff: {
        kind: 'project-responsibility.diff',
        schemaVersion: 1,
        before,
        after: { ...mutation.candidate, contributorMemberIds: [...mutation.candidate.contributorMemberIds] },
        changedFields,
        digest: `sha256:${'1'.repeat(64)}`,
      },
      evidence: mutation.evidenceRefs.map(reference =>
        reviewEvidence(reference.auditEventId, mutation.projectId)),
      risk: {
        proposedLevel: risk.level,
        effectiveLevel: risk.level,
        proposedReasonCodes: risk.reasons,
        policyVersion: 'project-responsibility-v1',
        batchPolicy: risk.level === 'low'
          ? {
            policy: 'eligible-later',
            homogeneityKey: 'project-responsibility.replace|low|project-responsibility-v1',
          }
          : { policy: 'forbidden', reason: 'high-risk' },
      },
      originCausationId: mutation.command.causationId,
      persistedState: 'pending',
      effectiveStatus: 'pending',
      decisions: [],
      allowedDecisions: ['accept', 'edit-and-accept', 'reject', 'defer'],
      createdAt: mutation.createdAt,
      updatedAt: mutation.createdAt,
    }
    this.suggestedChanges.set(item.suggestedChangeId, item)
    return {
      ok: true,
      value: {
        suggestedChangeId: item.suggestedChangeId,
        suggestedChangeRevision: 1,
        targetAdapter: 'project-responsibility.replace',
        baseTargetVersion: teamRevision,
        persistedState: 'pending',
        riskLevel: risk.level,
      },
      receipt: receipt(mutation),
    }
  }

  lastSuggestedChangeDecisionMutation: WorkbenchSuggestedChangeDecisionMutation | null = null

  async commitSuggestedChangeDecision(
    mutation: WorkbenchSuggestedChangeDecisionMutation,
    signal: AbortSignal,
  ): Promise<DecideSuggestedChangeResult> {
    this.suggestedChangeDecisionWriteCalls += 1
    this.lastSuggestedChangeDecisionMutation = mutation
    await this.onSuggestedChangeDecision?.(signal)
    if (!this.projects.has(mutation.projectId)) return projectNotFound(mutation.projectId)
    const stored = this.suggestedChanges.get(mutation.suggestedChangeId)
    if (stored === undefined || stored.projectId !== mutation.projectId) {
      return {
        ok: false,
        error: {
          code: 'suggested-change-not-found',
          message: 'fixture SuggestedChange missing',
          suggestedChangeId: mutation.suggestedChangeId,
        },
      }
    }
    if (stored.revision !== mutation.expectedSuggestedChangeRevision) {
      return {
        ok: false,
        error: {
          code: 'suggested-change-revision-conflict',
          message: 'fixture SuggestedChange revision conflict',
          expectedSuggestedChangeRevision: mutation.expectedSuggestedChangeRevision,
          currentSuggestedChangeRevision: stored.revision,
        },
      }
    }
    const teamRevision = this.teamRevisions.get(mutation.projectId) ?? 0
    const effective = reviewCardAtTeamRevision(
      stored,
      teamRevision,
      this.responsibilities.get(mutation.projectId)?.revision ?? null,
    )
    if (effective.effectiveStatus === 'accepted' || effective.effectiveStatus === 'rejected') {
      return {
        ok: false,
        error: {
          code: 'suggested-change-state-conflict',
          message: 'fixture terminal conflict',
          status: effective.effectiveStatus,
          attemptedMode: mutation.mode,
        },
      }
    }
    if (effective.effectiveStatus === 'stale' && mutation.mode !== 'reject') {
      return {
        ok: false,
        error: {
          code: 'suggested-change-stale',
          message: 'fixture stale',
          baseTeamRevision: stored.target.baseTeamRevision,
          currentTeamRevision: teamRevision,
        },
      }
    }
    if ((mutation.mode === 'accept' || mutation.mode === 'edit-and-accept')
      && mutation.acknowledgedRiskLevel !== stored.risk.effectiveLevel) {
      return {
        ok: false,
        error: {
          code: 'risk-acknowledgement-mismatch',
          message: 'fixture risk mismatch',
          requiredRiskLevel: stored.risk.effectiveLevel,
        },
      }
    }
    const persistedState = mutation.mode === 'reject'
      ? 'rejected'
      : mutation.mode === 'defer' ? 'deferred' : 'accepted'
    const decisionMode = mutation.mode === 'edit-and-accept'
      ? 'edited-accepted'
      : mutation.mode === 'accept' ? 'accepted' : persistedState
    const nextRevision = stored.revision + 1
    let appliedTeamRevision: number | null = null
    let appliedResponsibilityRevision: number | null = null
    if (mutation.mode === 'accept' || mutation.mode === 'edit-and-accept') {
      const candidate = mutation.mode === 'accept' ? stored.proposedDiff.after : mutation.candidate
      const current = this.responsibilities.get(mutation.projectId)
      appliedResponsibilityRevision = (current?.revision ?? 0) + 1
      appliedTeamRevision = teamRevision + 1
      this.responsibilities.set(mutation.projectId, {
        projectId: mutation.projectId,
        revision: appliedResponsibilityRevision,
        accountableMemberId: candidate.accountableMemberId,
        contributorMemberIds: [...candidate.contributorMemberIds],
        humanSponsorMemberId: candidate.humanSponsorMemberId,
        updatedAt: mutation.decidedAt,
      })
      this.teamRevisions.set(mutation.projectId, appliedTeamRevision)
    }
    const updated: SuggestedChangeProjection = {
      ...stored,
      revision: nextRevision,
      persistedState,
      effectiveStatus: persistedState,
      decisions: [...stored.decisions, {
        decisionId: mutation.decisionId,
        suggestedChangeRevision: nextRevision,
        mode: decisionMode,
        actor: { kind: 'owner', id: mutation.command.actor.id },
        feedback: mutation.feedback,
        appliedDiff: null,
        appliedRiskLevel: mutation.mode === 'accept' || mutation.mode === 'edit-and-accept'
          ? stored.risk.effectiveLevel
          : null,
        appliedRiskReasonCodes: [],
        appliedTeamRevision,
        appliedResponsibilityRevision,
        causationId: mutation.command.causationId,
        receipt: receipt(mutation),
        decidedAt: mutation.decidedAt,
      }],
      allowedDecisions: persistedState === 'deferred'
        ? ['accept', 'edit-and-accept', 'reject', 'defer']
        : [],
      updatedAt: mutation.decidedAt,
    }
    this.suggestedChanges.set(updated.suggestedChangeId, updated)
    return {
      ok: true,
      value: {
        suggestedChangeId: updated.suggestedChangeId,
        suggestedChangeRevision: nextRevision,
        persistedState,
        decisionMode,
        riskLevel: stored.risk.effectiveLevel,
        appliedTeamRevision,
        appliedResponsibilityRevision,
      },
      receipt: receipt(mutation),
    }
  }

  async readFeishuConnection(
    query: WorkbenchFeishuConnectionQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchStoredFeishuConnectionProjection> {
    this.feishuConnectionReadCalls += 1
    this.lastFeishuConnectionQuery = structuredClone(query)
    await this.onReadFeishuConnection?.(signal)
    throwFixtureCancelled(signal)
    return structuredClone(this.feishuConnection)
  }

  async commitFeishuRoute(
    mutation: WorkbenchFeishuRouteMutation,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuIdentityRouteResult> {
    this.feishuRouteWriteCalls += 1
    this.lastFeishuRouteMutation = structuredClone(mutation)
    await this.onCommitFeishuRoute?.(signal)
    throwFixtureCancelled(signal)

    const receiptKey = feishuReceiptKey(
      mutation.command.actor.organizationId,
      mutation.command.actor.id,
      mutation.command.idempotencyKey,
    )
    const fingerprint = feishuRouteFingerprint(mutation)
    const prior = this.feishuRouteReceipts.get(receiptKey)
    if (prior !== undefined) {
      return prior.fingerprint === fingerprint
        ? structuredClone(prior.result)
        : feishuIdempotencyConflict()
    }
    if (this.feishuVerificationReceipts.has(receiptKey)) return feishuIdempotencyConflict()

    if (this.feishuConnection.revision !== mutation.expectedConnectionRevision) {
      return {
        ok: false,
        error: {
          code: 'connection-revision-conflict',
          message: 'fixture Feishu connection conflict',
          expectedConnectionRevision: mutation.expectedConnectionRevision,
          currentConnectionRevision: this.feishuConnection.revision,
        },
      }
    }
    const current = mutation.kind === 'bot'
      ? this.feishuConnection.bot
      : this.feishuConnection.user
    if (current.generation !== mutation.expectedRouteGeneration) {
      return {
        ok: false,
        error: {
          code: 'route-generation-conflict',
          message: 'fixture Feishu route conflict',
          kind: mutation.kind,
          expectedRouteGeneration: mutation.expectedRouteGeneration,
          currentRouteGeneration: current.generation,
        },
      }
    }
    if (mutation.mode !== 'set' && current.state !== 'configured') {
      return {
        ok: false,
        error: {
          code: 'route-unconfigured',
          message: 'fixture Feishu route is not configured',
          kind: mutation.kind,
        },
      }
    }
    if (mutation.mode === 'set' && current.state === 'configured'
      && current.appId === mutation.appId
      && current.credentialRef === mutation.credentialRef) {
      return {
        ok: false,
        error: {
          code: 'no-op-route-configuration',
          message: 'fixture Feishu route already has this configuration',
          kind: mutation.kind,
        },
      }
    }

    const nextRevision = this.feishuConnection.revision + 1
    const nextGeneration = (current.generation ?? 0) + 1
    const nextRoute = {
      kind: mutation.kind,
      state: mutation.mode === 'disable' ? 'disabled' as const : 'configured' as const,
      generation: nextGeneration,
      appId: mutation.mode === 'set' ? mutation.appId : current.appId,
      credentialRef: mutation.mode === 'set' ? mutation.credentialRef : current.credentialRef,
      actor: null,
      displayLabel: null,
      lastVerification: null,
    }
    this.feishuConnection = {
      ...this.feishuConnection,
      revision: nextRevision,
      [mutation.kind]: nextRoute,
      updatedAt: mutation.updatedAt,
    }
    const result: ConfigureFeishuIdentityRouteResult = {
      ok: true,
      value: {
        connectionId: 'feishu-primary',
        connectionRevision: nextRevision,
        kind: mutation.kind,
        routeGeneration: nextGeneration,
        state: nextRoute.state,
      },
      receipt: receipt(mutation),
    }
    this.feishuRouteReceipts.set(receiptKey, { fingerprint, result: structuredClone(result) })
    return result
  }

  async replayFeishuVerification(
    query: WorkbenchFeishuVerificationReplayQuery,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult | null> {
    this.feishuVerificationReplayCalls += 1
    this.lastFeishuVerificationReplayQuery = structuredClone(query)
    await this.onReplayFeishuVerification?.(signal)
    throwFixtureCancelled(signal)
    const receiptKey = feishuReceiptKey(query.organizationId, query.actorId, query.idempotencyKey)
    if (this.feishuRouteReceipts.has(receiptKey)) return feishuIdempotencyConflict()
    const prior = this.feishuVerificationReceipts.get(receiptKey)
    if (prior === undefined) return null
    return prior.fingerprint === feishuVerificationFingerprint(query)
      ? structuredClone(prior.result)
      : feishuIdempotencyConflict()
  }

  async commitFeishuVerification(
    mutation: WorkbenchFeishuVerificationMutation,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult> {
    this.feishuVerificationWriteCalls += 1
    this.lastFeishuVerificationMutation = structuredClone(mutation)
    await this.onCommitFeishuVerification?.(signal)
    throwFixtureCancelled(signal)

    const receiptKey = feishuReceiptKey(
      mutation.command.actor.organizationId,
      mutation.command.actor.id,
      mutation.command.idempotencyKey,
    )
    const fingerprint = feishuVerificationFingerprint(mutation)
    if (this.feishuRouteReceipts.has(receiptKey)) return feishuIdempotencyConflict()
    const prior = this.feishuVerificationReceipts.get(receiptKey)
    if (prior !== undefined) {
      return prior.fingerprint === fingerprint
        ? structuredClone(prior.result)
        : feishuIdempotencyConflict()
    }

    if (this.feishuConnection.revision !== mutation.expectedConnectionRevision) {
      return {
        ok: false,
        error: {
          code: 'connection-revision-conflict',
          message: 'fixture Feishu connection conflict',
          expectedConnectionRevision: mutation.expectedConnectionRevision,
          currentConnectionRevision: this.feishuConnection.revision,
        },
      }
    }
    const current = mutation.kind === 'bot'
      ? this.feishuConnection.bot
      : this.feishuConnection.user
    if (current.generation === null) {
      return {
        ok: false,
        error: {
          code: 'route-unconfigured',
          message: 'fixture Feishu route is not configured',
          kind: mutation.kind,
        },
      }
    }
    if (current.generation !== mutation.expectedRouteGeneration) {
      return {
        ok: false,
        error: {
          code: 'route-generation-conflict',
          message: 'fixture Feishu route conflict',
          kind: mutation.kind,
          expectedRouteGeneration: mutation.expectedRouteGeneration,
          currentRouteGeneration: current.generation,
        },
      }
    }
    if (current.state === 'disabled') {
      return {
        ok: false,
        error: {
          code: 'route-disabled',
          message: 'fixture Feishu route is disabled',
          kind: mutation.kind,
        },
      }
    }

    const effective = enforceFixtureFeishuIdentityContinuity(mutation.observation, current)
    const nextRevision = this.feishuConnection.revision + 1
    const verificationSequence = (current.lastVerification?.sequence ?? 0) + 1
    const newlyBoundActor = current.actor === null
      && effective.identity.state === 'verified'
      && effective.actor !== null
      ? {
        connectionId: 'feishu-primary' as const,
        realm: effective.actor.realm,
        appId: effective.actor.appId,
        kind: effective.actor.kind,
        routeGeneration: current.generation,
        openId: effective.actor.openId,
        tenantKey: effective.actor.tenantKey,
      }
      : null
    const nextRoute = {
      ...current,
      actor: current.actor ?? newlyBoundActor,
      displayLabel: effective.displayLabel,
      lastVerification: {
        verificationId: mutation.verificationId,
        sequence: verificationSequence,
        routeGeneration: current.generation,
        checkedAt: mutation.checkedAt,
        result: effective.result,
        identity: structuredClone(effective.identity),
        scopeInspection: structuredClone(effective.scopeInspection),
        resourceProbe: structuredClone(effective.resourceProbe),
      },
    }
    this.feishuConnection = {
      ...this.feishuConnection,
      revision: nextRevision,
      [mutation.kind]: nextRoute,
      updatedAt: mutation.checkedAt,
    }
    const result: VerifyFeishuIdentityRouteResult = {
      ok: true,
      value: {
        connectionId: 'feishu-primary',
        connectionRevision: nextRevision,
        kind: mutation.kind,
        routeGeneration: current.generation,
        verificationSequence,
        result: effective.result,
      },
      receipt: receipt(mutation),
    }
    this.feishuVerificationReceipts.set(receiptKey, {
      fingerprint,
      result: structuredClone(result),
    })
    return result
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

function emptyFeishuConnection(): WorkbenchStoredFeishuConnectionProjection {
  const route = (kind: FeishuIdentityKind) => ({
    kind,
    state: 'unconfigured' as const,
    generation: null,
    appId: null,
    credentialRef: null,
    actor: null,
    displayLabel: null,
    lastVerification: null,
  })
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision: 0,
    bot: route('bot'),
    user: route('user'),
    updatedAt: null,
  }
}

function feishuReceiptKey(
  organizationId: string,
  actorId: string,
  idempotencyKey: string,
): string {
  return JSON.stringify([organizationId, actorId, idempotencyKey])
}

function feishuRouteFingerprint(mutation: WorkbenchFeishuRouteMutation): string {
  return JSON.stringify({
    kind: mutation.kind,
    mode: mutation.mode,
    appId: mutation.appId,
    credentialRef: mutation.credentialRef,
    expectedConnectionRevision: mutation.expectedConnectionRevision,
    expectedRouteGeneration: mutation.expectedRouteGeneration,
    causationId: mutation.command.causationId,
    reason: mutation.command.reason,
  })
}

function feishuVerificationFingerprint(
  value: WorkbenchFeishuVerificationReplayQuery | WorkbenchFeishuVerificationMutation,
): string {
  const command = 'command' in value ? value.command : value
  return JSON.stringify({
    kind: value.kind,
    expectedConnectionRevision: value.expectedConnectionRevision,
    expectedRouteGeneration: value.expectedRouteGeneration,
    resourceProbe: value.resourceProbe,
    causationId: command.causationId,
    reason: command.reason,
  })
}

function feishuIdempotencyConflict(): {
  readonly ok: false
  readonly error: { readonly code: 'idempotency-conflict'; readonly message: string }
} {
  return {
    ok: false,
    error: {
      code: 'idempotency-conflict',
      message: 'fixture idempotency key was already used for different intent',
    },
  }
}

function throwFixtureCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('fixture operation cancelled')
}

function enforceFixtureFeishuIdentityContinuity(
  observation: WorkbenchFeishuVerificationObservation,
  route: WorkbenchStoredFeishuConnectionProjection['bot'],
): WorkbenchFeishuVerificationObservation {
  if (observation.identity.state !== 'verified' || observation.actor === null) return observation
  if (observation.actor.realm !== 'feishu-cn'
    || observation.actor.kind !== route.kind
    || observation.actor.appId !== route.appId) {
    return failedFixtureFeishuObservation('provider-response-invalid', 'inspect-provider')
  }
  if (route.actor === null) return observation
  if (route.actor.appId !== observation.actor.appId
    || route.actor.openId !== observation.actor.openId) {
    return failedFixtureFeishuObservation(
      'identity-continuity-mismatch',
      'reset-identity-binding',
    )
  }
  if (route.actor.tenantKey !== observation.actor.tenantKey) {
    return failedFixtureFeishuObservation('tenant-mismatch', 'reset-identity-binding')
  }
  return observation
}

function failedFixtureFeishuObservation(
  code: 'provider-response-invalid' | 'identity-continuity-mismatch' | 'tenant-mismatch',
  recovery: 'inspect-provider' | 'reset-identity-binding',
): WorkbenchFeishuVerificationObservation {
  return {
    result: 'failed',
    identity: {
      state: 'failed',
      issue: { code, recovery, missingScopes: [], grantPlane: null, retryAt: null },
    },
    actor: null,
    displayLabel: null,
    scopeInspection: { state: 'not-inspected', scopes: [], issue: null },
    resourceProbe: { state: 'not-tested' },
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

function reviewEvidence(auditEventId: string, projectId: string) {
  return {
    kind: 'workbench-audit-event' as const,
    auditEventId,
    occurredAt: '2026-08-30T00:00:00.000Z',
    action: 'workbench.project.created' as const,
    summaryCode: 'project-created-from-template' as const,
    object: { type: 'project' as const, id: projectId, version: 1 },
  }
}

function responsibilityChangedFields(
  before: SuggestedChangeProjection['proposedDiff']['before'],
  after: SuggestedChangeProjection['proposedDiff']['after'],
): SuggestedChangeProjection['proposedDiff']['changedFields'] {
  const fields: Array<SuggestedChangeProjection['proposedDiff']['changedFields'][number]> = []
  if (before.accountableMemberId !== after.accountableMemberId) fields.push('accountable')
  if (before.humanSponsorMemberId !== after.humanSponsorMemberId) fields.push('human-sponsor')
  if (before.contributorMemberIds.length !== after.contributorMemberIds.length
    || before.contributorMemberIds.some((memberId, index) =>
      memberId !== after.contributorMemberIds[index])) {
    fields.push('contributors')
  }
  return fields
}

function responsibilityRisk(
  before: SuggestedChangeProjection['proposedDiff']['before'],
  after: SuggestedChangeProjection['proposedDiff']['after'],
): {
  readonly level: SuggestedChangeProjection['risk']['proposedLevel']
  readonly reasons: SuggestedChangeProjection['risk']['proposedReasonCodes']
} {
  if (before.accountableMemberId === null) {
    return { level: 'high', reasons: ['initial-responsibility'] }
  }
  const reasons: Array<SuggestedChangeProjection['risk']['proposedReasonCodes'][number]> = []
  if (before.accountableMemberId !== after.accountableMemberId) reasons.push('accountable-changed')
  if (before.humanSponsorMemberId !== after.humanSponsorMemberId) reasons.push('human-sponsor-changed')
  if (reasons.length > 0) return { level: 'high', reasons }
  return { level: 'low', reasons: ['contributors-only'] }
}

function reviewCardAtTeamRevision(
  value: SuggestedChangeProjection,
  currentTeamRevision: number,
  currentResponsibilityRevision: number | null,
): SuggestedChangeProjection {
  const unresolved = value.persistedState === 'pending' || value.persistedState === 'deferred'
  const stale = unresolved && value.target.baseTeamRevision !== currentTeamRevision
  const effectiveStatus = stale ? 'stale' : value.persistedState
  const actionable = effectiveStatus === 'pending' || effectiveStatus === 'deferred'
  return {
    ...value,
    target: {
      ...value.target,
      currentTeamRevision,
      currentResponsibilityRevision,
    },
    effectiveStatus,
    allowedDecisions: effectiveStatus === 'stale'
      ? ['reject']
      : actionable ? ['accept', 'edit-and-accept', 'reject', 'defer'] : [],
    risk: {
      ...value.risk,
      batchPolicy: actionable && value.risk.effectiveLevel === 'low'
        ? {
          policy: 'eligible-later',
          homogeneityKey: 'project-responsibility.replace|low|project-responsibility-v1',
        }
        : {
          policy: 'forbidden',
          reason: value.risk.effectiveLevel === 'high' ? 'high-risk' : 'not-actionable',
        },
    },
  }
}

type FixtureFeishuIdentityInput = WorkbenchFeishuIdentityVerificationInput
type FixtureFeishuIdentity = Pick<
  Extract<WorkbenchFeishuIdentityVerificationResult, { readonly state: 'verified' }>['session'],
  'actor' | 'displayLabel'
>

class FixtureFeishuAdapter implements WorkbenchFeishuExternalAdapter {
  readonly adapterId = 'fixture-feishu'
  readonly describeCalls: string[] = []
  readonly identityCalls: FixtureFeishuIdentityInput[] = []
  readonly identitySignals: AbortSignal[] = []
  readonly finishCalls: Array<{
    readonly input: FixtureFeishuIdentityInput
    readonly resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null
  }> = []
  readonly resourceProbeCalls: Array<{
    readonly input: FixtureFeishuIdentityInput
    readonly resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string }
  }> = []
  readonly finishSignals: AbortSignal[] = []
  disposeCalls = 0
  readonly descriptions = new Map<string, FeishuCredentialProjection>()
  identityHandler: (
    input: FixtureFeishuIdentityInput,
    signal: AbortSignal,
  ) => Promise<FixtureFeishuIdentity> = async input => healthyFixtureFeishuIdentity(input)
  resourceHandler: (
    input: FixtureFeishuIdentityInput,
    resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null,
    signal: AbortSignal,
  ) => Promise<WorkbenchFeishuResourceVerificationObservation> = async (input, resourceProbe) =>
    healthyFixtureFeishuCapability(input, resourceProbe)

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    this.describeCalls.push(ref)
    return structuredClone(this.descriptions.get(ref) ?? {
      ref,
      configured: true,
      source: 'project-env',
      writable: false,
    })
  }

  async startIdentityVerification(
    input: FixtureFeishuIdentityInput,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    this.identityCalls.push(structuredClone(input))
    this.identitySignals.push(signal)
    const identity = await this.identityHandler(input, signal)
    let disposed = false
    let finished = false
    return {
      state: 'verified',
      session: {
        actor: identity.actor,
        displayLabel: identity.displayLabel,
        finishVerification: async (resourceProbe, finishSignal) => {
          if (disposed || finished) throw new Error('fixture Feishu session is closed')
          finished = true
          this.finishCalls.push(structuredClone({ input, resourceProbe }))
          if (resourceProbe !== null) {
            this.resourceProbeCalls.push(structuredClone({ input, resourceProbe }))
          }
          this.finishSignals.push(finishSignal)
          return this.resourceHandler(input, resourceProbe, finishSignal)
        },
        dispose: () => {
          disposed = true
          this.disposeCalls += 1
        },
      },
    }
  }
}

function healthyFixtureFeishuIdentity(
  input: FixtureFeishuIdentityInput,
): FixtureFeishuIdentity {
  return {
    actor: {
      realm: 'feishu-cn',
      appId: input.appId,
      kind: input.kind,
      openId: input.kind === 'bot' ? 'ou_fixture_bot' : 'ou_fixture_user',
      tenantKey: 'tenant-fixture',
    },
    displayLabel: input.kind === 'bot' ? 'Fixture Bot' : 'Fixture User',
  }
}

function healthyFixtureFeishuCapability(
  input: FixtureFeishuIdentityInput,
  resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null,
): WorkbenchFeishuResourceVerificationObservation {
  return {
    result: 'healthy',
    scopeInspection: {
      state: 'observed',
      scopes: [{
        scope: 'task:tasklist:read',
        tokenType: input.kind === 'bot' ? 'tenant' : 'user',
        state: 'verified',
      }],
      issue: null,
    },
    resourceProbe: resourceProbe === null
      ? { state: 'not-tested' }
      : { state: 'accessible', ...resourceProbe },
  }
}

function createScenario(
  repository = new MemoryRepository(),
  access: WorkbenchAuthorization = authorization,
  feishu = new FixtureFeishuAdapter(),
): {
  readonly repository: MemoryRepository
  readonly scenario: WorkbenchScenario
  readonly feishu: FixtureFeishuAdapter
} {
  const instants = [
    new Date('2026-08-31T01:02:03.000Z'),
    new Date('2026-08-31T02:03:04.000Z'),
  ]
  const statusIds = ['status-001', 'status-002']
  const projectIds = ['project-001', 'project-002']
  const projectMemberIds = ['member-001', 'member-002', 'member-003', 'member-004']
  const suggestedChangeIds = [
    'suggested-change-001',
    'suggested-change-002',
    'suggested-change-003',
  ]
  const suggestedChangeDecisionIds = ['decision-001', 'decision-002', 'decision-003']
  const feishuVerificationIds = [
    'feishu-verification-001',
    'feishu-verification-002',
    'feishu-verification-003',
    'feishu-verification-004',
  ]
  const goalIds = ['goal-001', 'goal-002']
  const outcomeIds = ['outcome-001', 'outcome-002', 'outcome-003']
  const commandIds = Array.from({ length: 12 }, (_, index) => `command-${String(index + 1).padStart(3, '0')}`)
  const auditIds = Array.from({ length: 12 }, (_, index) => `audit-${String(index + 1).padStart(3, '0')}`)
  const outboxIds = Array.from({ length: 12 }, (_, index) => `outbox-${String(index + 1).padStart(3, '0')}`)
  const adapters = { feishu } as const
  return {
    repository,
    feishu,
    scenario: new WorkbenchScenario({
      repository,
      clock: { now: () => instants.shift() ?? new Date('2026-08-31T03:04:05.000Z') },
      ids: {
        nextStatusId: () => statusIds.shift() ?? 'status-fallback',
        nextProjectId: () => projectIds.shift() ?? 'project-fallback',
        nextProjectMemberId: () => projectMemberIds.shift() ?? 'member-fallback',
        nextSuggestedChangeId: () =>
          suggestedChangeIds.shift() ?? 'suggested-change-fallback',
        nextSuggestedChangeDecisionId: () =>
          suggestedChangeDecisionIds.shift() ?? 'decision-fallback',
        nextFeishuVerificationId: () =>
          feishuVerificationIds.shift() ?? 'feishu-verification-fallback',
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

function configureFeishuRouteRequest(
  kind: FeishuIdentityKind,
  expectedConnectionRevision: number,
  expectedRouteGeneration: number | null,
  suffix: string = kind,
): Extract<ConfigureFeishuIdentityRouteRequest, { readonly mode: 'set' }> {
  return {
    kind,
    mode: 'set',
    appId: kind === 'bot' ? 'cli_fixture_bot' : 'cli_fixture_user',
    credentialRef: kind === 'bot' ? 'FEISHU_BOT_SECRET' : 'FEISHU_USER_TOKEN',
    expectedConnectionRevision,
    expectedRouteGeneration,
    idempotencyKey: `feishu-configure-${suffix}`,
    causationId: `feishu-configure-cause-${suffix}`,
    reason: 'owner-feishu-route-configure',
  }
}

function verifyFeishuRouteRequest(
  kind: FeishuIdentityKind,
  expectedConnectionRevision: number,
  expectedRouteGeneration: number,
  suffix: string = kind,
  resourceId?: string,
): VerifyFeishuIdentityRouteRequest {
  return {
    kind,
    expectedConnectionRevision,
    expectedRouteGeneration,
    idempotencyKey: `feishu-verify-${suffix}`,
    causationId: `feishu-verify-cause-${suffix}`,
    ...(resourceId === undefined
      ? {}
      : { resourceProbe: { kind: 'task-list' as const, resourceId } }),
    reason: 'owner-feishu-route-verify',
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

function proposalRequest(
  overrides: Partial<ProposeProjectResponsibilityChangeRequest> = {},
): ProposeProjectResponsibilityChangeRequest {
  return {
    projectId: 'project-001',
    candidate: {
      accountableMemberId: 'member-003',
      contributorMemberIds: ['member-002', 'member-001'],
      humanSponsorMemberId: 'member-001',
    },
    expectedTeamRevision: 3,
    evidenceRefs: [{ kind: 'workbench-audit-event', auditEventId: 'audit-evidence-001' }],
    idempotencyKey: 'suggestion-idempotency-0001',
    causationId: 'suggestion-causation-0001',
    reason: 'owner-suggested-change-propose',
    ...overrides,
  }
}

function decisionRequest(
  mode: 'accept' | 'reject' | 'defer' = 'accept',
  overrides: Partial<DecideSuggestedChangeRequest> = {},
): DecideSuggestedChangeRequest {
  const common = {
    projectId: 'project-001',
    suggestedChangeId: 'suggested-change-001',
    expectedSuggestedChangeRevision: 1,
    feedback: 'Reviewed against the cited evidence.',
    idempotencyKey: `decision-idempotency-${mode}-0001`,
    causationId: `decision-causation-${mode}-0001`,
  }
  if (mode === 'accept') return {
    ...common,
    mode,
    acknowledgedRiskLevel: 'high',
    reason: 'owner-suggested-change-accept',
    ...overrides,
  } as DecideSuggestedChangeRequest
  if (mode === 'reject') return {
    ...common,
    mode,
    reason: 'owner-suggested-change-reject',
    ...overrides,
  } as DecideSuggestedChangeRequest
  return {
    ...common,
    mode,
    reason: 'owner-suggested-change-defer',
    ...overrides,
  } as DecideSuggestedChangeRequest
}

function editAndAcceptRequest(
  overrides: Partial<DecideSuggestedChangeRequest> = {},
): DecideSuggestedChangeRequest {
  return {
    projectId: 'project-001',
    suggestedChangeId: 'suggested-change-001',
    expectedSuggestedChangeRevision: 1,
    feedback: 'Edited and reviewed against the cited evidence.',
    mode: 'edit-and-accept',
    acknowledgedRiskLevel: 'high',
    candidate: {
      accountableMemberId: 'member-003',
      contributorMemberIds: ['member-001'],
      humanSponsorMemberId: 'member-001',
    },
    idempotencyKey: 'decision-idempotency-edit-accept-0001',
    causationId: 'decision-causation-edit-accept-0001',
    reason: 'owner-suggested-change-edit-accept',
    ...overrides,
  } as DecideSuggestedChangeRequest
}

async function seedReviewProject(scenario: WorkbenchScenario): Promise<void> {
  const signal = new AbortController().signal
  const project = await scenario.createProject(projectRequest(), signal)
  if (!project.ok) throw new Error('fixture Review Project creation unexpectedly failed')
  await scenario.addProjectMember(addMemberRequest({
    kind: 'human',
    displayName: 'Owner Sponsor',
    identity: { type: 'feishu', appId: 'cli_review', openId: 'ou_review_owner' },
  }, 0), signal)
  await scenario.addProjectMember(addMemberRequest({
    kind: 'human',
    displayName: 'Reviewer',
    identity: { type: 'external', method: 'email', value: 'reviewer@example.test' },
  }, 1, {
    idempotencyKey: 'review-member-idempotency-0002',
    causationId: 'review-member-causation-0002',
  }), signal)
  await scenario.addProjectMember(addMemberRequest({
    kind: 'agent',
    displayName: 'Review Agent',
  }, 2, {
    idempotencyKey: 'review-member-idempotency-0003',
    causationId: 'review-member-causation-0003',
  }), signal)
}

describe('T07 Feishu Connection Center scenario contracts', () => {
  it('uses the three Feishu capabilities and fails closed before persistence when configure is denied', async () => {
    const required: WorkbenchAction[] = []
    const filtered: WorkbenchAction[] = []
    const access: WorkbenchAuthorization = {
      require: async (action) => {
        required.push(action)
        return {
          ownerId: 'owner-feishu',
          organizationId: 'organization-feishu',
          teamId: 'team-feishu',
        }
      },
      filterProjection: async <T>(action: WorkbenchAction, projection: T): Promise<T> => {
        filtered.push(action)
        return projection
      },
    }
    const { scenario, repository } = createScenario(new MemoryRepository(), access)
    await scenario.open()

    await scenario.feishuConnectionCenter(new AbortController().signal)
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 0, null),
      new AbortController().signal,
    )
    await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('bot', 1, 1),
      new AbortController().signal,
    )

    expect(required).toEqual([
      'workbench.integration.feishu.read',
      'workbench.integration.feishu.configure',
      'workbench.integration.feishu.verify',
    ])
    expect(filtered).toEqual(['workbench.integration.feishu.read'])
    expect(repository.lastFeishuConnectionQuery).toEqual({
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    })
    expect(repository.lastFeishuRouteMutation?.command.actor).toEqual({
      kind: 'owner',
      id: 'owner-feishu',
      organizationId: 'organization-feishu',
      teamId: 'team-feishu',
    })
    await scenario.close()

    const deniedRepository = new MemoryRepository()
    const deniedAccess: WorkbenchAuthorization = {
      require: async (action) => {
        if (action === 'workbench.integration.feishu.configure') {
          throw new TypertRemoteFailure({
            code: 'forbidden',
            message: 'fixture denied Feishu configuration',
            details: {},
          })
        }
        return {
          ownerId: 'owner-feishu',
          organizationId: 'organization-feishu',
          teamId: 'team-feishu',
        }
      },
      filterProjection: <T>(_action: WorkbenchAction, projection: T): Promise<T> =>
        Promise.resolve(projection),
    }
    const denied = createScenario(deniedRepository, deniedAccess).scenario
    await denied.open()
    const deniedError = await denied.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 0, null, 'denied'),
      new AbortController().signal,
    ).catch((error: unknown) => error)
    expect(failureCode(deniedError)).toBe('forbidden')
    expect(deniedRepository.feishuRouteWriteCalls).toBe(0)
    await denied.close()
  })

  it('replays route configuration receipts and keeps connection/route CAS conflicts typed', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const request = configureFeishuRouteRequest('bot', 0, null)

    const committed = await scenario.configureFeishuIdentityRoute(
      request,
      new AbortController().signal,
    )
    const replayed = await scenario.configureFeishuIdentityRoute(
      request,
      new AbortController().signal,
    )
    expect(replayed).toEqual(committed)
    expect(repository.feishuConnection.revision).toBe(1)
    expect(repository.feishuConnection.bot).toMatchObject({
      state: 'configured',
      generation: 1,
      appId: 'cli_fixture_bot',
      credentialRef: 'FEISHU_BOT_SECRET',
    })

    const reusedForDifferentIntent = await scenario.configureFeishuIdentityRoute(
      { ...request, appId: 'cli_fixture_other' },
      new AbortController().signal,
    )
    expect(reusedForDifferentIntent).toMatchObject({
      ok: false,
      error: { code: 'idempotency-conflict' },
    })
    const staleConnection = await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('user', 0, null, 'stale-connection'),
      new AbortController().signal,
    )
    expect(staleConnection).toMatchObject({
      ok: false,
      error: {
        code: 'connection-revision-conflict',
        expectedConnectionRevision: 0,
        currentConnectionRevision: 1,
      },
    })
    const staleGeneration = await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 1, null, 'stale-generation'),
      new AbortController().signal,
    )
    expect(staleGeneration).toMatchObject({
      ok: false,
      error: {
        code: 'route-generation-conflict',
        kind: 'bot',
        expectedRouteGeneration: null,
        currentRouteGeneration: 1,
      },
    })
    expect(repository.feishuConnection.revision).toBe(1)
    await scenario.close()
  })

  it('preflights verification receipts, invokes only the exact Bot/User route, and retains identity continuity', async () => {
    const { scenario, repository, feishu } = createScenario()
    await scenario.open()
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 0, null),
      new AbortController().signal,
    )
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('user', 1, null),
      new AbortController().signal,
    )

    const order: string[] = []
    repository.onReplayFeishuVerification = async () => { order.push('receipt-preflight') }
    repository.onReadFeishuConnection = async () => { order.push('connection-read') }
    feishu.identityHandler = async input => {
      order.push(`adapter-identity:${input.kind}`)
      return healthyFixtureFeishuIdentity(input)
    }
    feishu.resourceHandler = async (input, resourceProbe) => {
      order.push(`adapter-resource:${input.kind}`)
      return healthyFixtureFeishuCapability(input, resourceProbe)
    }
    const botRequest = verifyFeishuRouteRequest('bot', 2, 1, 'bot-exact', 'task-list-bot')
    const first = await scenario.verifyFeishuIdentityRoute(
      botRequest,
      new AbortController().signal,
    )
    expect(order).toEqual([
      'receipt-preflight',
      'connection-read',
      'adapter-identity:bot',
      'adapter-resource:bot',
    ])
    const readsAfterFirst = repository.feishuConnectionReadCalls
    const replay = await scenario.verifyFeishuIdentityRoute(
      botRequest,
      new AbortController().signal,
    )
    expect(replay).toEqual(first)
    expect(order).toEqual([
      'receipt-preflight',
      'connection-read',
      'adapter-identity:bot',
      'adapter-resource:bot',
      'receipt-preflight',
    ])
    expect(repository.feishuConnectionReadCalls).toBe(readsAfterFirst)
    expect(repository.feishuVerificationWriteCalls).toBe(1)

    await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('user', 3, 1, 'user-exact', 'task-list-user'),
      new AbortController().signal,
    )
    expect(feishu.identityCalls).toEqual([
      {
        kind: 'bot',
        appId: 'cli_fixture_bot',
        credentialRef: 'FEISHU_BOT_SECRET',
      },
      {
        kind: 'user',
        appId: 'cli_fixture_user',
        credentialRef: 'FEISHU_USER_TOKEN',
      },
    ])
    expect(feishu.resourceProbeCalls).toEqual([
      {
        input: {
          kind: 'bot',
          appId: 'cli_fixture_bot',
          credentialRef: 'FEISHU_BOT_SECRET',
        },
        resourceProbe: { kind: 'task-list', resourceId: 'task-list-bot' },
      },
      {
        input: {
          kind: 'user',
          appId: 'cli_fixture_user',
          credentialRef: 'FEISHU_USER_TOKEN',
        },
        resourceProbe: { kind: 'task-list', resourceId: 'task-list-user' },
      },
    ])

    feishu.identityHandler = async input => {
      const healthy = healthyFixtureFeishuIdentity(input)
      return {
        ...healthy,
        actor: { ...healthy.actor, openId: 'ou_changed_actor' },
      }
    }
    const drift = await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('bot', 4, 1, 'bot-drift', 'task-list-must-not-read'),
      new AbortController().signal,
    )
    expect(drift).toMatchObject({ ok: true, value: { result: 'failed' } })
    expect(feishu.resourceProbeCalls).toHaveLength(2)
    expect(feishu.resourceProbeCalls.some(call =>
      call.resourceProbe.resourceId === 'task-list-must-not-read')).toBe(false)
    expect(feishu.disposeCalls).toBe(3)
    const projection = await scenario.feishuConnectionCenter(new AbortController().signal)
    expect(projection.bot.actor).toMatchObject({
      kind: 'bot',
      openId: 'ou_fixture_bot',
      routeGeneration: 1,
    })
    expect(projection.bot.lastVerification).toMatchObject({
      result: 'failed',
      identity: {
        state: 'failed',
        issue: {
          code: 'identity-continuity-mismatch',
          recovery: 'reset-identity-binding',
        },
      },
    })
    expect(projection.user.actor).toMatchObject({ kind: 'user', openId: 'ou_fixture_user' })
    await scenario.close()
  })

  it('projects missing scope separately from resource ACL and strips credential values', async () => {
    const { scenario, feishu } = createScenario()
    await scenario.open()
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 0, null),
      new AbortController().signal,
    )
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('user', 1, null),
      new AbortController().signal,
    )

    const secretSentinel = 'credential-value-MUST-NOT-PROJECT'
    feishu.descriptions.set('FEISHU_BOT_SECRET', {
      ref: 'FEISHU_BOT_SECRET',
      configured: true,
      source: 'file',
      writable: true,
      value: secretSentinel,
    } as FeishuCredentialProjection)
    feishu.resourceHandler = async (input, resourceProbe) => {
      const healthy = healthyFixtureFeishuCapability(input, resourceProbe)
      if (input.kind === 'bot') {
        return {
          ...healthy,
          result: 'attention',
          scopeInspection: {
            state: 'observed',
            scopes: [{
              scope: 'task:tasklist:read',
              tokenType: 'tenant',
              state: 'missing',
            }],
            issue: {
              code: 'missing-app-scope',
              recovery: 'grant-app-scope',
              missingScopes: ['task:tasklist:read'],
              grantPlane: 'application',
              retryAt: null,
            },
          },
          resourceProbe: { state: 'not-tested' },
        }
      }
      return {
        ...healthy,
        result: 'attention',
        resourceProbe: {
          state: 'unavailable',
          kind: 'task-list',
          resourceId: resourceProbe?.resourceId ?? 'task-list-private',
          issue: {
            code: 'resource-access-unavailable',
            recovery: 'share-resource',
            missingScopes: [],
            grantPlane: null,
            retryAt: null,
          },
        },
      }
    }
    await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('bot', 2, 1, 'bot-scope'),
      new AbortController().signal,
    )
    await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('user', 3, 1, 'user-acl', 'task-list-private'),
      new AbortController().signal,
    )

    const projection = await scenario.feishuConnectionCenter(new AbortController().signal)
    expect(projection.bot.lastVerification?.scopeInspection.issue).toEqual({
      code: 'missing-app-scope',
      recovery: 'grant-app-scope',
      missingScopes: ['task:tasklist:read'],
      grantPlane: 'application',
      retryAt: null,
    })
    expect(projection.user.lastVerification?.resourceProbe).toEqual({
      state: 'unavailable',
      kind: 'task-list',
      resourceId: 'task-list-private',
      issue: {
        code: 'resource-access-unavailable',
        recovery: 'share-resource',
        missingScopes: [],
        grantPlane: null,
        retryAt: null,
      },
    })
    expect(projection.bot.credential).toEqual({
      ref: 'FEISHU_BOT_SECRET',
      configured: true,
      source: 'file',
      writable: true,
    })
    expect(JSON.stringify(projection)).not.toContain(secretSentinel)
    await scenario.close()
  })

  it('aborts an exact-route verification, drains it, and closes storage before rejecting new work', async () => {
    const { scenario, repository, feishu } = createScenario()
    await scenario.open()
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('bot', 0, null),
      new AbortController().signal,
    )
    let startedResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => { startedResolve = resolve })
    feishu.resourceHandler = (_input, _resourceProbe, signal) => new Promise((_, reject) => {
      startedResolve?.()
      const rejectCancelled = () => reject(signal.reason ?? new Error('fixture aborted'))
      if (signal.aborted) rejectCancelled()
      else signal.addEventListener('abort', rejectCancelled, { once: true })
    })

    const pending = scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('bot', 1, 1, 'close-abort', 'task-list-close-abort'),
      new AbortController().signal,
    )
    await started
    const closing = scenario.close()
    const error = await pending.catch((reason: unknown) => reason)
    await closing

    expect(failureCode(error)).toBe('cancelled')
    expect(feishu.identitySignals).toHaveLength(1)
    expect(feishu.finishSignals).toHaveLength(1)
    expect(feishu.finishSignals[0]?.aborted).toBe(true)
    expect(feishu.disposeCalls).toBe(1)
    expect(repository.feishuVerificationWriteCalls).toBe(0)
    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
    const unavailable = await scenario.feishuConnectionCenter(new AbortController().signal)
      .catch((reason: unknown) => reason)
    expect(failureCode(unavailable)).toBe('unavailable')
    await scenario.close()
    expect(repository.closeCalls).toBe(1)
  })

  it('disposes a verified one-shot session when cancellation wins before the continuity gate', async () => {
    const { scenario, repository, feishu } = createScenario()
    await scenario.open()
    await scenario.configureFeishuIdentityRoute(
      configureFeishuRouteRequest('user', 0, null),
      new AbortController().signal,
    )
    const caller = new AbortController()
    feishu.identityHandler = async input => {
      caller.abort(new Error('caller left after self identity'))
      return healthyFixtureFeishuIdentity(input)
    }

    const error = await scenario.verifyFeishuIdentityRoute(
      verifyFeishuRouteRequest('user', 1, 1, 'cancel-after-identity', 'must-not-probe'),
      caller.signal,
    ).catch((reason: unknown) => reason)

    expect(failureCode(error)).toBe('cancelled')
    expect(feishu.disposeCalls).toBe(1)
    expect(feishu.finishCalls).toHaveLength(0)
    expect(feishu.resourceProbeCalls).toHaveLength(0)
    expect(repository.feishuVerificationWriteCalls).toBe(0)
    await scenario.close()
  })
})

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
    expect(scenario.adapters.feishu?.adapterId).toBe('fixture-feishu')

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

  it('drives all five Review statuses through Host-scoped proposal and decision commands', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    await seedReviewProject(scenario)
    const signal = new AbortController().signal

    const empty = await scenario.reviewCenter({ projectId: 'project-001' }, signal)
    expect(empty).toMatchObject({
      projectId: 'project-001',
      proposalBuilder: { teamRevision: 3, responsibilityRevision: null },
      items: [],
    })
    expect(repository.lastReviewCenterQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      filter: { projectId: 'project-001', limit: 20 },
    })

    const proposed = await scenario.proposeProjectResponsibilityChange(
      proposalRequest({
        evidenceRefs: [
          { kind: 'workbench-audit-event', auditEventId: 'audit-evidence-002' },
          { kind: 'workbench-audit-event', auditEventId: 'audit-evidence-001' },
        ],
      }),
      signal,
    )
    expect(proposed).toEqual({
      ok: true,
      value: {
        suggestedChangeId: 'suggested-change-001',
        suggestedChangeRevision: 1,
        targetAdapter: 'project-responsibility.replace',
        baseTargetVersion: 3,
        persistedState: 'pending',
        riskLevel: 'high',
      },
      receipt: {
        commandId: 'command-005',
        auditEventId: 'audit-005',
        outboxId: 'outbox-005',
      },
    })
    expect(Object.isFrozen(proposed)).toBe(true)
    expect(Object.isFrozen(proposed.ok && proposed.value)).toBe(true)
    expect(repository.lastSuggestedChangeProposalMutation).toMatchObject({
      suggestedChangeId: 'suggested-change-001',
      projectId: 'project-001',
      candidate: { contributorMemberIds: ['member-001', 'member-002'] },
      evidenceRefs: [
        { kind: 'workbench-audit-event', auditEventId: 'audit-evidence-001' },
        { kind: 'workbench-audit-event', auditEventId: 'audit-evidence-002' },
      ],
      expectedRevision: null,
      command: {
        actor: {
          kind: 'owner',
          id: 'owner-test',
          organizationId: 'organization-test',
          teamId: 'team-test',
        },
        reason: 'owner-suggested-change-propose',
      },
    })

    const pending = await scenario.reviewCenter({
      projectId: 'project-001',
      status: 'pending',
      riskLevel: 'high',
      limit: 10,
    }, signal)
    expect(pending?.items.map(item => item.effectiveStatus)).toEqual(['pending'])
    expect(Object.isFrozen(pending)).toBe(true)
    expect(Object.isFrozen(pending?.items)).toBe(true)
    expect(Object.isFrozen(pending?.items[0]?.proposedDiff.after.contributorMemberIds)).toBe(true)

    await expect(scenario.decideSuggestedChange(
      decisionRequest('defer'),
      signal,
    )).resolves.toMatchObject({
      ok: true,
      value: {
        suggestedChangeId: 'suggested-change-001',
        suggestedChangeRevision: 2,
        persistedState: 'deferred',
        decisionMode: 'deferred',
      },
    })
    const deferred = await scenario.reviewCenter({
      projectId: 'project-001',
      status: 'deferred',
    }, signal)
    expect(deferred?.items).toMatchObject([{
      effectiveStatus: 'deferred',
      decisions: [{ decisionId: 'decision-001', feedback: 'Reviewed against the cited evidence.' }],
    }])

    repository.teamRevisions.set('project-001', 4)
    const stale = await scenario.reviewCenter({
      projectId: 'project-001',
      status: 'stale',
    }, signal)
    expect(stale?.items).toMatchObject([{
      persistedState: 'deferred',
      effectiveStatus: 'stale',
      allowedDecisions: ['reject'],
    }])
    await expect(scenario.decideSuggestedChange(decisionRequest('accept', {
      expectedSuggestedChangeRevision: 2,
      idempotencyKey: 'decision-idempotency-stale-0002',
      causationId: 'decision-causation-stale-0002',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'suggested-change-stale', baseTeamRevision: 3, currentTeamRevision: 4 },
    })
    await expect(scenario.decideSuggestedChange(decisionRequest('reject', {
      expectedSuggestedChangeRevision: 2,
      idempotencyKey: 'decision-idempotency-reject-0002',
      causationId: 'decision-causation-reject-0002',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { persistedState: 'rejected', decisionMode: 'rejected' },
    })
    const rejected = await scenario.reviewCenter({
      projectId: 'project-001',
      status: 'rejected',
    }, signal)
    expect(rejected?.items.map(item => item.effectiveStatus)).toEqual(['rejected'])

    const second = await scenario.proposeProjectResponsibilityChange(proposalRequest({
      expectedTeamRevision: 4,
      idempotencyKey: 'suggestion-idempotency-0002',
      causationId: 'suggestion-causation-0002',
    }), signal)
    expect(second).toMatchObject({
      ok: true,
      value: { suggestedChangeId: 'suggested-change-002', persistedState: 'pending' },
    })
    await expect(scenario.decideSuggestedChange(decisionRequest('accept', {
      suggestedChangeId: 'suggested-change-002',
      idempotencyKey: 'decision-idempotency-accept-0003',
      causationId: 'decision-causation-accept-0003',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: {
        suggestedChangeId: 'suggested-change-002',
        persistedState: 'accepted',
        decisionMode: 'accepted',
        appliedTeamRevision: 5,
        appliedResponsibilityRevision: 1,
      },
    })
    const accepted = await scenario.reviewCenter({
      projectId: 'project-001',
      status: 'accepted',
    }, signal)
    expect(accepted?.items.map(item => item.effectiveStatus)).toEqual(['accepted'])
    const highRiskPage = await scenario.reviewCenter({
      projectId: 'project-001',
      riskLevel: 'high',
      limit: 1,
    }, signal)
    expect(highRiskPage?.items).toHaveLength(1)
    expect(highRiskPage?.nextBeforeSequence).toBe(2)
    await scenario.close()
  })

  it('uses stable Review capabilities in exact order before the single receipt-first repository path', async () => {
    const repository = new MemoryRepository()
    const events: string[] = []
    const access: WorkbenchAuthorization = {
      require: action => {
        events.push(`require:${action}`)
        return Promise.resolve({
          ownerId: 'owner-authoritative',
          organizationId: 'organization-authoritative',
          teamId: 'team-authoritative',
        })
      },
      filterProjection: (action, projection) => {
        events.push(`filter:${action}`)
        return Promise.resolve(projection)
      },
    }
    repository.onReviewCenter = async () => { events.push('repository:review') }
    repository.onSuggestedChangeProposal = async () => { events.push('repository:proposal') }
    repository.onSuggestedChangeDecision = async () => { events.push('repository:decision') }
    const { scenario } = createScenario(repository, access)
    await scenario.open()
    await seedReviewProject(scenario)
    events.length = 0
    const signal = new AbortController().signal

    await scenario.reviewCenter({ projectId: 'project-001' }, signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.read',
      'repository:review',
      'filter:workbench.review.read',
    ])

    await scenario.proposeProjectResponsibilityChange(proposalRequest(), signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.decide',
      'repository:proposal',
    ])

    await scenario.decideSuggestedChange(decisionRequest('defer'), signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.decide',
      'repository:decision',
    ])
    await scenario.decideSuggestedChange(decisionRequest('reject', {
      suggestedChangeId: 'suggested-change-missing-reject',
    }), signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.decide',
      'repository:decision',
    ])

    await scenario.decideSuggestedChange(decisionRequest('accept', {
      expectedSuggestedChangeRevision: 2,
      idempotencyKey: 'decision-idempotency-accept-order',
      causationId: 'decision-causation-accept-order',
    }), signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.decide',
      'require:workbench.project.responsibility.write',
      'repository:decision',
    ])
    await scenario.decideSuggestedChange(editAndAcceptRequest({
      suggestedChangeId: 'suggested-change-missing-edit',
    }), signal)
    expect(events.splice(0)).toEqual([
      'require:workbench.review.decide',
      'require:workbench.project.responsibility.write',
      'repository:decision',
    ])
    await scenario.close()
  })

  it('fails closed at Review and target-write authorization boundaries without excess checks', async () => {
    const repository = new MemoryRepository()
    const required: WorkbenchAction[] = []
    let deniedAction: WorkbenchAction | null = null
    let mismatchedAction: WorkbenchAction | null = null
    const access: WorkbenchAuthorization = {
      require: action => {
        required.push(action)
        if (action === deniedAction) {
          return Promise.reject(new TypertRemoteFailure({
            code: 'forbidden',
            message: 'fixture capability denied',
            details: { action },
          }))
        }
        if (action === mismatchedAction) {
          return Promise.resolve({
            ownerId: 'owner-other',
            organizationId: 'organization-other',
            teamId: 'team-other',
          })
        }
        return Promise.resolve({
          ownerId: 'owner-authoritative',
          organizationId: 'organization-authoritative',
          teamId: 'team-authoritative',
        })
      },
      filterProjection: (_action, projection) => Promise.resolve(projection),
    }
    const { scenario } = createScenario(repository, access)
    await scenario.open()
    const signal = new AbortController().signal

    deniedAction = 'workbench.review.read'
    await expect(scenario.reviewCenter({ projectId: 'project-001' }, signal))
      .rejects.toMatchObject({ failure: { code: 'forbidden' } })
    expect(required.splice(0)).toEqual(['workbench.review.read'])
    expect(repository.reviewCenterReadCalls).toBe(0)

    deniedAction = 'workbench.review.decide'
    await expect(scenario.proposeProjectResponsibilityChange(proposalRequest(), signal))
      .rejects.toMatchObject({ failure: { code: 'forbidden' } })
    expect(required.splice(0)).toEqual(['workbench.review.decide'])
    expect(repository.suggestedChangeProposalWriteCalls).toBe(0)
    await expect(scenario.decideSuggestedChange(decisionRequest('accept'), signal))
      .rejects.toMatchObject({ failure: { code: 'forbidden' } })
    expect(required.splice(0)).toEqual(['workbench.review.decide'])
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(0)

    deniedAction = 'workbench.project.responsibility.write'
    for (const request of [decisionRequest('accept'), editAndAcceptRequest()]) {
      await expect(scenario.decideSuggestedChange(request, signal))
        .rejects.toMatchObject({ failure: { code: 'forbidden' } })
      expect(required.splice(0)).toEqual([
        'workbench.review.decide',
        'workbench.project.responsibility.write',
      ])
    }
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(0)

    deniedAction = null
    mismatchedAction = 'workbench.project.responsibility.write'
    await expect(scenario.decideSuggestedChange(decisionRequest('accept'), signal))
      .rejects.toMatchObject({ failure: { code: 'internal' } })
    expect(required.splice(0)).toEqual([
      'workbench.review.decide',
      'workbench.project.responsibility.write',
    ])
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(0)

    mismatchedAction = null
    deniedAction = 'workbench.project.responsibility.write'
    await expect(scenario.proposeProjectResponsibilityChange(proposalRequest(), signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'project-not-found' } })
    expect(required.splice(0)).toEqual(['workbench.review.decide'])
    for (const mode of ['reject', 'defer'] as const) {
      await expect(scenario.decideSuggestedChange(decisionRequest(mode), signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'project-not-found' } })
      expect(required.splice(0)).toEqual(['workbench.review.decide'])
    }
    expect(repository.suggestedChangeProposalWriteCalls).toBe(1)
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(2)
    await scenario.close()
  })

  it('rejects inexact Review authority fields and closed-union violations before storage', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    for (const filter of [
      { projectId: 'project-001', status: 'unknown' },
      { projectId: 'project-001', riskLevel: 'critical' },
      { projectId: 'project-001', limit: 51 },
      { projectId: 'project-001', actor: 'forged-owner' },
    ]) {
      const error = await scenario.reviewCenter(filter as never, signal)
        .catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.reviewCenterReadCalls).toBe(0)

    const invalidProposals: unknown[] = [
      { ...proposalRequest(), source: { kind: 'owner', actorId: 'forged' } },
      { ...proposalRequest(), risk: 'low' },
      { ...proposalRequest(), suggestedChangeId: 'forged-id' },
      { ...proposalRequest(), evidenceRefs: [] },
      { ...proposalRequest(), expectedTeamRevision: -1 },
      {
        ...proposalRequest(),
        candidate: { ...proposalRequest().candidate, contributorMemberIds: ['member-001', 'member-001'] },
      },
    ]
    for (const request of invalidProposals) {
      const error = await scenario.proposeProjectResponsibilityChange(
        request as ProposeProjectResponsibilityChangeRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.suggestedChangeProposalWriteCalls).toBe(0)

    const invalidDecisions: unknown[] = [
      { ...decisionRequest(), target: { baseVersion: 3 } },
      { ...decisionRequest(), expectedTargetVersion: 3 },
      { ...decisionRequest(), feedback: '   ' },
      { ...decisionRequest(), expectedSuggestedChangeRevision: 0 },
      { ...decisionRequest('reject'), acknowledgedRiskLevel: 'low' },
      { ...decisionRequest(), candidate: proposalRequest().candidate },
      { ...decisionRequest(), reason: 'owner-suggested-change-reject' },
    ]
    for (const request of invalidDecisions) {
      const error = await scenario.decideSuggestedChange(
        request as DecideSuggestedChangeRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(0)
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
    const reviewError = await scenario.reviewCenter(
      { projectId: 'unsafe project' },
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(reviewError)).toBe('unauthorized')
    const proposalError = await scenario.proposeProjectResponsibilityChange(
      { ...proposalRequest(), actor: 'forged-owner' } as never,
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(proposalError)).toBe('unauthorized')
    const decisionError = await scenario.decideSuggestedChange(
      { ...decisionRequest(), mode: 'force-accept' } as never,
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(decisionError)).toBe('unauthorized')
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
    expect(repository.reviewCenterReadCalls).toBe(0)
    expect(repository.suggestedChangeProposalWriteCalls).toBe(0)
    expect(repository.suggestedChangeDecisionWriteCalls).toBe(0)

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
    await scenario.activity({
      projectId: 'project-safe',
      objectType: 'suggested-change',
      objectId: 'suggested-change-safe',
      action: 'workbench.suggested-change.edited-accepted',
      limit: 5,
    })
    expect(repository.lastActivityQuery?.filter).toEqual({
      projectId: 'project-safe',
      objectType: 'suggested-change',
      objectId: 'suggested-change-safe',
      action: 'workbench.suggested-change.edited-accepted',
      limit: 5,
    })
    await scenario.activity({
      projectId: 'project-safe',
      objectType: 'feishu-task-workflow',
      objectId: 'project-safe',
      action: 'workbench.feishu-task-workflow.configured',
      limit: 5,
    })
    expect(repository.lastActivityQuery?.filter).toEqual({
      projectId: 'project-safe',
      objectType: 'feishu-task-workflow',
      objectId: 'project-safe',
      action: 'workbench.feishu-task-workflow.configured',
      limit: 5,
    })
    for (const filter of [
      {
        projectId: 'project-safe',
        objectType: 'project-calendar-binding' as const,
        objectId: 'project-safe',
        action: 'workbench.project-calendar.bound' as const,
        limit: 5,
      },
      {
        projectId: 'project-safe',
        objectType: 'project-milestone' as const,
        objectId: 'milestone-safe',
        action: 'workbench.project-milestone.created' as const,
        limit: 5,
      },
      {
        projectId: 'project-safe',
        objectType: 'project-milestone' as const,
        objectId: 'milestone-safe',
        action: 'workbench.project-milestone.date-update-requested' as const,
        limit: 5,
      },
    ]) {
      await scenario.activity(filter)
      expect(repository.lastActivityQuery?.filter).toEqual(filter)
    }
    await expect(scenario.auditIntegrity()).resolves.toMatchObject({ valid: true, eventCount: 0 })
    expect(required).toEqual([
      ...Array.from({ length: 7 }, () => 'workbench.activity.read'),
      'workbench.audit.verify',
    ])
    expect(filtered).toEqual([
      ...Array.from({ length: 7 }, () => 'workbench.activity.read'),
      'workbench.audit.verify',
    ])

    for (const filter of [{ limit: 101 }, { limit: 10, rawContact: 'secret' }]) {
      const error = await scenario.activity(filter as never).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.activityCalls).toBe(7)
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

  it('propagates caller cancellation through an admitted Review Center read', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onReviewCenter = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.reviewCenter({ projectId: 'project-001' }, caller.signal)
    await started.promise
    caller.abort(new Error('caller left Review Center'))

    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(repository.reviewCenterReadCalls).toBe(1)
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
