/** Highest-level deterministic seam around the Workbench public command/query surface. */

import { randomUUID } from 'node:crypto'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  CreateProjectRequest,
  CreateProjectResult,
  DecideSuggestedChangeRequest,
  DecideSuggestedChangeResult,
  OutcomeDraft,
  ProjectDetailProjection,
  ProjectMemberDraft,
  ProjectQuery,
  ProjectResponsibilitySuggestedValue,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectTeamProjection,
  ProjectTeamQuery,
  ProjectTemplateSelection,
  ProposeProjectResponsibilityChangeRequest,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterFilter,
  ReviewCenterProjection,
  SetProjectMemberStatusRequest,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityRequest,
  SetProjectResponsibilityResult,
  SetStatusRequest,
  SetStatusResult,
  SuggestedChangeEvidenceRef,
  SuggestedChangeRiskLevel,
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchStatusSnapshot,
} from './client.ts'
import {
  projectDetailProjection,
  projectResult,
  projectStartProjection,
  projectTeamCommandResult,
  projectTeamProjection,
  reviewCenterProjection,
  statusResult,
  statusSnapshot,
  suggestedChangeDecisionResult,
  suggestedChangeProposalResult,
  type WorkbenchProjectMutation,
  type WorkbenchProjectMemberMutation,
  type WorkbenchProjectMemberStatusMutation,
  type WorkbenchProjectResponsibilityMutation,
  type WorkbenchRepository,
  type WorkbenchSuggestedChangeDecisionMutation,
  type WorkbenchSuggestedChangeProposalMutation,
} from './repository.ts'
import type { WorkbenchAuthorization } from './authorization.ts'

/** Injectable wall clock; production returns a fresh Date for every command. */
export interface WorkbenchClock {
  now(): Date
}

/** Injectable identities for every durable fact in one transactional command. */
export interface WorkbenchIdGenerator {
  nextStatusId(): string
  nextProjectId(): string
  nextProjectMemberId(): string
  nextSuggestedChangeId(): string
  nextSuggestedChangeDecisionId(): string
  nextGoalId(): string
  nextOutcomeId(): string
  nextCommandId(): string
  nextAuditEventId(): string
  nextOutboxId(): string
}

/** Stable identity for a future independently versioned external capability. */
export interface WorkbenchExternalAdapter {
  readonly adapterId: string
}

/**
 * External ports collected at the scenario boundary. T01 intentionally invokes
 * none of them: a durable local status write has no implied external effect.
 */
export interface WorkbenchExternalAdapters {
  readonly feishu?: WorkbenchExternalAdapter
  readonly files?: WorkbenchExternalAdapter
  readonly modelAndSubagent?: WorkbenchExternalAdapter
  readonly scheduler?: WorkbenchExternalAdapter
}

/** Construction dependencies for a deterministic scenario. */
export interface WorkbenchScenarioOptions {
  readonly clock: WorkbenchClock
  readonly ids: WorkbenchIdGenerator
  readonly repository: WorkbenchRepository
  readonly adapters: WorkbenchExternalAdapters
  readonly authorization: WorkbenchAuthorization
  readonly maxStatusLength: number
}

export const systemWorkbenchClock: WorkbenchClock = Object.freeze({
  now: () => new Date(),
})

export const randomWorkbenchIds: WorkbenchIdGenerator = Object.freeze({
  nextStatusId: () => `status-${randomUUID()}`,
  nextProjectId: () => `project-${randomUUID()}`,
  nextProjectMemberId: () => `member-${randomUUID()}`,
  nextSuggestedChangeId: () => `suggested-change-${randomUUID()}`,
  nextSuggestedChangeDecisionId: () => `decision-${randomUUID()}`,
  nextGoalId: () => `goal-${randomUUID()}`,
  nextOutcomeId: () => `outcome-${randomUUID()}`,
  nextCommandId: () => `command-${randomUUID()}`,
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextOutboxId: () => `outbox-${randomUUID()}`,
})

export const noWorkbenchExternalAdapters: WorkbenchExternalAdapters = Object.freeze({})

type ScenarioPhase = 'new' | 'opening' | 'running' | 'closing' | 'closed'

/**
 * Public behavior harness shared by the Cordis service and scenario tests.
 * It owns admission, cancellation, in-flight draining, and repository closure.
 */
export class WorkbenchScenario {
  private phase: ScenarioPhase = 'new'
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<unknown>>()
  private opening: Promise<void> | undefined
  private closing: Promise<void> | undefined

  constructor(readonly options: WorkbenchScenarioOptions) {
    if (!Number.isSafeInteger(options.maxStatusLength) || options.maxStatusLength < 1) {
      throw new TypeError('maxStatusLength must be a positive safe integer')
    }
  }

  /** Expose the injected external port set to scenario fixtures without invoking it. */
  get adapters(): WorkbenchExternalAdapters {
    return this.options.adapters
  }

  /** Current lifecycle phase for deterministic disposal assertions. */
  get lifecycle(): ScenarioPhase {
    return this.phase
  }

  open(): Promise<void> {
    if (this.phase === 'running') return Promise.resolve()
    if (this.phase === 'opening') return this.opening as Promise<void>
    if (this.phase !== 'new') return Promise.reject(unavailable('Workbench scenario cannot be reopened'))
    this.phase = 'opening'
    this.opening = this.doOpen()
    return this.opening
  }

  /** Query the externally observable durable projection. */
  snapshot(callerSignal: AbortSignal = new AbortController().signal): Promise<WorkbenchStatusSnapshot | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('snapshot requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      await this.options.authorization.require('workbench.status.read', operationSignal)
      throwIfCancelled(operationSignal)
      try {
        const value = await this.options.repository.snapshot(operationSignal)
        return value === null ? null : statusSnapshot(value)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
    })
  }

  /** Read one redacted, organization-scoped Activity page. */
  activity(
    filter: WorkbenchActivityFilter = {},
    callerSignal: AbortSignal = new AbortController().signal,
  ): Promise<WorkbenchActivityProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('activity requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.activity.read', operationSignal)
      const normalized = validateActivityFilter(filter)
      throwIfCancelled(operationSignal)
      let projection: WorkbenchActivityProjection
      try {
        projection = await this.options.repository.readActivity(Object.freeze({
          organizationId: scope.organizationId,
          filter: normalized,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return this.options.authorization.filterProjection(
        'workbench.activity.read',
        projection,
        operationSignal,
      )
    })
  }

  /** Verify the complete stored audit chain and its current head. */
  auditIntegrity(
    callerSignal: AbortSignal = new AbortController().signal,
  ): Promise<WorkbenchAuditIntegrityProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('auditIntegrity requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      await this.options.authorization.require('workbench.audit.verify', operationSignal)
      let projection: WorkbenchAuditIntegrityProjection
      try {
        projection = await this.options.repository.verifyAuditChain(operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return this.options.authorization.filterProjection(
        'workbench.audit.verify',
        projection,
        operationSignal,
      )
    })
  }

  /** Read the built-in template and one stable descending Project catalog page. */
  projectStart(
    filter: ProjectStartFilter,
    signal: AbortSignal,
  ): Promise<ProjectStartProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('projectStart requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.project.read', operationSignal)
      const normalized = validateProjectStartFilter(filter)
      throwIfCancelled(operationSignal)
      let projection: ProjectStartProjection
      try {
        projection = await this.options.repository.readProjectStart(Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          filter: normalized,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return this.options.authorization.filterProjection(
        'workbench.project.read',
        projectStartProjection(projection),
        operationSignal,
      )
    })
  }

  /** Atomically create one Project, its Primary Goal, and measurable Outcomes. */
  createProject(
    request: CreateProjectRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('createProject requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.project.create', operationSignal)
      throwIfCancelled(operationSignal)
      const normalized = validateCreateProjectRequest(request)
      const projectId = generatedId(this.options.ids.nextProjectId(), 'project')
      const primaryGoalId = generatedId(this.options.ids.nextGoalId(), 'goal')
      if (normalized.supportingGoals.some(goal => goal.goalId === primaryGoalId)) {
        throw badRequest('the new Primary Goal cannot also be a Supporting Goal', {
          field: 'supportingGoals',
        })
      }
      const outcomes = normalized.primaryGoal.outcomes.map((outcome) => Object.freeze({
        outcomeId: generatedId(this.options.ids.nextOutcomeId(), 'outcome'),
        name: outcome.name,
        metric: Object.freeze({ ...outcome.metric }),
      }))
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      const now = this.options.clock.now()
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw infrastructure('Workbench clock returned an invalid instant')
      }
      const occurredAt = now.toISOString()
      const mutation: WorkbenchProjectMutation = Object.freeze({
        projectId,
        primaryGoalId,
        projectName: normalized.projectName,
        primaryGoal: Object.freeze({
          name: normalized.primaryGoal.name,
          outcomes: Object.freeze(outcomes),
        }),
        supportingGoals: Object.freeze(normalized.supportingGoals.map(goal => Object.freeze({ ...goal }))),
        template: Object.freeze({ ...normalized.template }),
        expectedCatalogRevision: normalized.expectedCatalogRevision,
        expectedRevision: null,
        createdAt: occurredAt,
        command: Object.freeze({
          commandId,
          auditEventId,
          outboxId,
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: 'owner-project-create',
          actor: Object.freeze({
            kind: 'owner',
            id: scope.ownerId,
            organizationId: scope.organizationId,
            teamId: scope.teamId,
          }),
          occurredAt,
        }),
      })
      let result: CreateProjectResult
      try {
        result = await this.options.repository.commitProject(mutation, operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return projectResult(result)
    })
  }

  /** Reopen one visible Project from Host truth. */
  project(query: ProjectQuery, signal: AbortSignal): Promise<ProjectDetailProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('project requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.project.read', operationSignal)
      const normalized = validateProjectQuery(query)
      throwIfCancelled(operationSignal)
      let projection: ProjectDetailProjection | null
      try {
        projection = await this.options.repository.readProject(Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.read',
        projectDetailProjection(projection),
        operationSignal,
      )
    })
  }

  /** Read one authorized, detached Project Team and current responsibility. */
  projectTeam(
    query: ProjectTeamQuery,
    signal: AbortSignal,
  ): Promise<ProjectTeamProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('projectTeam requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.team.read',
        operationSignal,
      )
      const normalized = validateProjectTeamQuery(query)
      throwIfCancelled(operationSignal)
      let projection: ProjectTeamProjection | null
      try {
        projection = await this.options.repository.readProjectTeam(Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.team.read',
        projectTeamProjection(projection),
        operationSignal,
      )
    })
  }

  /** Atomically add one Project-scoped human or descriptive Agent member. */
  addProjectMember(
    request: AddProjectMemberRequest,
    signal: AbortSignal,
  ): Promise<AddProjectMemberResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('addProjectMember requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.member.create',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateAddProjectMemberRequest(request)
      const memberId = generatedId(this.options.ids.nextProjectMemberId(), 'Project member')
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      const occurredAt = commandInstant(this.options.clock)
      const mutation: WorkbenchProjectMemberMutation = Object.freeze({
        projectId: normalized.projectId,
        memberId,
        member: normalized.member,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedRevision: null,
        createdAt: occurredAt,
        command: Object.freeze({
          commandId,
          auditEventId,
          outboxId,
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: 'owner-project-member-add',
          actor: Object.freeze({
            kind: 'owner',
            id: scope.ownerId,
            organizationId: scope.organizationId,
            teamId: scope.teamId,
          }),
          occurredAt,
        }),
      })
      let result: AddProjectMemberResult
      try {
        result = await this.options.repository.commitProjectMember(mutation, operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return projectTeamCommandResult(result)
    })
  }

  /** Atomically activate or deactivate one retained Project member. */
  setProjectMemberStatus(
    request: SetProjectMemberStatusRequest,
    signal: AbortSignal,
  ): Promise<SetProjectMemberStatusResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('setProjectMemberStatus requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.member.status.write',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateSetProjectMemberStatusRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const mutation: WorkbenchProjectMemberStatusMutation = Object.freeze({
        projectId: normalized.projectId,
        memberId: normalized.memberId,
        status: normalized.status,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedMemberRevision: normalized.expectedMemberRevision,
        updatedAt: occurredAt,
        command: Object.freeze({
          commandId: generatedId(this.options.ids.nextCommandId(), 'command'),
          auditEventId: generatedId(this.options.ids.nextAuditEventId(), 'audit event'),
          outboxId: generatedId(this.options.ids.nextOutboxId(), 'outbox'),
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: 'owner-project-member-status-change',
          actor: Object.freeze({
            kind: 'owner',
            id: scope.ownerId,
            organizationId: scope.organizationId,
            teamId: scope.teamId,
          }),
          occurredAt,
        }),
      })
      let result: SetProjectMemberStatusResult
      try {
        result = await this.options.repository.commitProjectMemberStatus(mutation, operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return projectTeamCommandResult(result)
    })
  }

  /** Atomically replace the complete current Project Responsibility tuple. */
  setProjectResponsibility(
    request: SetProjectResponsibilityRequest,
    signal: AbortSignal,
  ): Promise<SetProjectResponsibilityResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('setProjectResponsibility requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.responsibility.write',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateSetProjectResponsibilityRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const mutation: WorkbenchProjectResponsibilityMutation = Object.freeze({
        projectId: normalized.projectId,
        accountableMemberId: normalized.accountableMemberId,
        contributorMemberIds: normalized.contributorMemberIds,
        humanSponsorMemberId: normalized.humanSponsorMemberId,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedResponsibilityRevision: normalized.expectedResponsibilityRevision,
        updatedAt: occurredAt,
        command: Object.freeze({
          commandId: generatedId(this.options.ids.nextCommandId(), 'command'),
          auditEventId: generatedId(this.options.ids.nextAuditEventId(), 'audit event'),
          outboxId: generatedId(this.options.ids.nextOutboxId(), 'outbox'),
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: 'owner-project-responsibility-set',
          actor: Object.freeze({
            kind: 'owner',
            id: scope.ownerId,
            organizationId: scope.organizationId,
            teamId: scope.teamId,
          }),
          occurredAt,
        }),
      })
      let result: SetProjectResponsibilityResult
      try {
        result = await this.options.repository.commitProjectResponsibility(mutation, operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return projectTeamCommandResult(result)
    })
  }

  /** Read proposal context and one authorized, Host-filtered Review page. */
  reviewCenter(
    filter: ReviewCenterFilter,
    signal: AbortSignal,
  ): Promise<ReviewCenterProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('reviewCenter requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.review.read',
        operationSignal,
      )
      const normalized = validateReviewCenterFilter(filter)
      throwIfCancelled(operationSignal)
      let projection: ReviewCenterProjection | null
      try {
        projection = await this.options.repository.readReviewCenter(Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          filter: normalized,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.review.read',
        reviewCenterProjection(projection),
        operationSignal,
      )
    })
  }

  /** Propose one complete Project Responsibility candidate against an exact Team base. */
  proposeProjectResponsibilityChange(
    request: ProposeProjectResponsibilityChangeRequest,
    signal: AbortSignal,
  ): Promise<ProposeProjectResponsibilityChangeResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('proposeProjectResponsibilityChange requires an AbortSignal', {
          field: 'signal',
        })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.review.decide',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateProposeProjectResponsibilityChangeRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const mutation: WorkbenchSuggestedChangeProposalMutation = Object.freeze({
        suggestedChangeId: generatedId(
          this.options.ids.nextSuggestedChangeId(),
          'SuggestedChange',
        ),
        projectId: normalized.projectId,
        candidate: normalized.candidate,
        evidenceRefs: normalized.evidenceRefs,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedRevision: null,
        createdAt: occurredAt,
        command: Object.freeze({
          commandId: generatedId(this.options.ids.nextCommandId(), 'command'),
          auditEventId: generatedId(this.options.ids.nextAuditEventId(), 'audit event'),
          outboxId: generatedId(this.options.ids.nextOutboxId(), 'outbox'),
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: 'owner-suggested-change-propose',
          actor: Object.freeze({
            kind: 'owner',
            id: scope.ownerId,
            organizationId: scope.organizationId,
            teamId: scope.teamId,
          }),
          occurredAt,
        }),
      })
      let result: ProposeProjectResponsibilityChangeResult
      try {
        result = await this.options.repository.commitSuggestedChangeProposal(
          mutation,
          operationSignal,
        )
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return suggestedChangeProposalResult(result)
    })
  }

  /** Apply one closed Owner disposition without allowing the Client to replace the target base. */
  decideSuggestedChange(
    request: DecideSuggestedChangeRequest,
    signal: AbortSignal,
  ): Promise<DecideSuggestedChangeResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('decideSuggestedChange requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.review.decide',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateDecideSuggestedChangeRequest(request)
      if (normalized.mode === 'accept' || normalized.mode === 'edit-and-accept') {
        const targetScope = await this.options.authorization.require(
          'workbench.project.responsibility.write',
          operationSignal,
        )
        if (targetScope.ownerId !== scope.ownerId
          || targetScope.organizationId !== scope.organizationId
          || targetScope.teamId !== scope.teamId) {
          throw infrastructure('Workbench authorization returned inconsistent Review scopes')
        }
        throwIfCancelled(operationSignal)
      }
      const decidedAt = commandInstant(this.options.clock)
      const command = Object.freeze({
        commandId: generatedId(this.options.ids.nextCommandId(), 'command'),
        auditEventId: generatedId(this.options.ids.nextAuditEventId(), 'audit event'),
        outboxId: generatedId(this.options.ids.nextOutboxId(), 'outbox'),
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
        actor: Object.freeze({
          kind: 'owner' as const,
          id: scope.ownerId,
          organizationId: scope.organizationId,
          teamId: scope.teamId,
        }),
        occurredAt: decidedAt,
      })
      const decisionId = generatedId(
        this.options.ids.nextSuggestedChangeDecisionId(),
        'SuggestedChange decision',
      )
      const common = {
        decisionId,
        projectId: normalized.projectId,
        suggestedChangeId: normalized.suggestedChangeId,
        expectedSuggestedChangeRevision: normalized.expectedSuggestedChangeRevision,
        feedback: normalized.feedback,
        decidedAt,
      } as const
      const mutation: WorkbenchSuggestedChangeDecisionMutation = normalized.mode === 'accept'
        ? Object.freeze({
          ...common,
          mode: 'accept',
          acknowledgedRiskLevel: normalized.acknowledgedRiskLevel,
          command: Object.freeze({ ...command, reason: 'owner-suggested-change-accept' }),
        })
        : normalized.mode === 'edit-and-accept'
          ? Object.freeze({
            ...common,
            mode: 'edit-and-accept',
            acknowledgedRiskLevel: normalized.acknowledgedRiskLevel,
            candidate: normalized.candidate,
            command: Object.freeze({ ...command, reason: 'owner-suggested-change-edit-accept' }),
          })
          : normalized.mode === 'reject'
            ? Object.freeze({
              ...common,
              mode: 'reject',
              command: Object.freeze({ ...command, reason: 'owner-suggested-change-reject' }),
            })
            : Object.freeze({
              ...common,
              mode: 'defer',
              command: Object.freeze({ ...command, reason: 'owner-suggested-change-defer' }),
            })
      let result: DecideSuggestedChangeResult
      try {
        result = await this.options.repository.commitSuggestedChangeDecision(
          mutation,
          operationSignal,
        )
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return suggestedChangeDecisionResult(result)
    })
  }

  /** Validate and execute the public compare-and-set command. */
  setStatus(request: SetStatusRequest, signal: AbortSignal): Promise<SetStatusResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('setStatus requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.status.write', operationSignal)
      throwIfCancelled(operationSignal)
      const normalized = validateRequest(request, this.options.maxStatusLength)
      const candidateId = generatedId(this.options.ids.nextStatusId(), 'status')
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      const now = this.options.clock.now()
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw infrastructure('Workbench clock returned an invalid instant')
      }
      let result: SetStatusResult
      try {
        result = await this.options.repository.commitStatus(Object.freeze({
          candidateId,
          message: normalized.message,
          expectedRevision: normalized.expectedRevision,
          updatedAt: now.toISOString(),
          command: Object.freeze({
            commandId,
            auditEventId,
            outboxId,
            idempotencyKey: normalized.idempotencyKey,
            causationId: normalized.causationId,
            reason: normalized.reason,
            actor: Object.freeze({
              kind: 'owner',
              id: scope.ownerId,
              organizationId: scope.organizationId,
              teamId: scope.teamId,
            }),
            occurredAt: now.toISOString(),
          }),
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      // A repository result is the durable commit point. Cancellation that
      // races after that result must not turn an acknowledged commit into a
      // false "cancelled" outcome and invite an unsafe retry.
      return statusResult(result)
    })
  }

  /** Stop admission, cancel owned work, wait for quiescence, then close storage. */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doOpen(): Promise<void> {
    try {
      await this.options.repository.open()
      if (this.phase === 'closing') return
      this.phase = 'running'
    } catch (error: unknown) {
      this.phase = 'closed'
      await this.options.repository.close().catch(() => undefined)
      throw error
    }
  }

  private async doClose(): Promise<void> {
    if (this.phase === 'closed') return
    this.phase = 'closing'
    this.lifetime.abort(new Error('Workbench scenario is disposing'))
    await this.opening?.catch(() => undefined)
    await Promise.allSettled([...this.inFlight])
    try {
      await this.options.repository.close()
    } finally {
      this.phase = 'closed'
    }
  }

  private async execute<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase !== 'running') throw unavailable('Workbench is not accepting requests')
    const pending = Promise.resolve().then(() => operation(this.lifetime.signal))
    this.inFlight.add(pending)
    try {
      return await pending
    } catch (error: unknown) {
      if (error instanceof TypertRemoteFailure) throw error
      if (this.lifetime.signal.aborted) throw cancelled('Workbench request was cancelled during disposal')
      throw infrastructure('Workbench persistence operation failed', error)
    } finally {
      this.inFlight.delete(pending)
    }
  }
}

function validateRequest(request: SetStatusRequest, maxStatusLength: number): SetStatusRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw badRequest('setStatus request must be an object', { field: 'request' })
  }
  const messageValue: unknown = Reflect.get(request, 'message')
  if (typeof messageValue !== 'string') {
    throw badRequest('status message must be a string', { field: 'message' })
  }
  const message = messageValue.trim()
  if (message.length === 0) {
    throw badRequest('status message must not be blank', { field: 'message' })
  }
  const actualLength = [...message].length
  if (actualLength > maxStatusLength) {
    throw badRequest(`status message exceeds ${maxStatusLength} characters`, {
      field: 'message',
      maxStatusLength,
      actualLength,
    })
  }
  const expectedRevision: unknown = Reflect.get(request, 'expectedRevision')
  if (expectedRevision !== null
    && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1)) {
    throw badRequest('expectedRevision must be null or a positive safe integer', {
      field: 'expectedRevision',
    })
  }
  const idempotencyKey = validateCommandKey(
    Reflect.get(request, 'idempotencyKey'),
    'idempotencyKey',
  )
  const causationId = validateCommandKey(
    Reflect.get(request, 'causationId'),
    'causationId',
  )
  const reason: unknown = Reflect.get(request, 'reason')
  if (reason !== 'owner-status-edit') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    message,
    expectedRevision: expectedRevision as number | null,
    idempotencyKey,
    causationId,
    reason,
  })
}

const DEFAULT_PROJECT_START_LIMIT = 20
const MAX_PROJECT_START_LIMIT = 100
const MAX_OUTCOMES_PER_PROJECT = 20
const MAX_SUPPORTING_GOALS_PER_PROJECT = 20
const MAX_PROJECT_NAME_LENGTH = 200
const MAX_GOAL_NAME_LENGTH = 200
const MAX_OUTCOME_NAME_LENGTH = 200
const MAX_METRIC_NAME_LENGTH = 120
const MAX_METRIC_UNIT_LENGTH = 64
const MAX_PROJECT_MEMBER_DISPLAY_NAME_LENGTH = 200
const MAX_EXTERNAL_CONTACT_VALUE_LENGTH = 320
const MAX_PROJECT_CONTRIBUTORS = 20
const DEFAULT_REVIEW_CENTER_LIMIT = 20
const MAX_REVIEW_CENTER_LIMIT = 50
const MAX_SUGGESTED_CHANGE_EVIDENCE_REFS = 20
const MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH = 2_000
const TEXT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u

function validateProjectStartFilter(value: ProjectStartFilter): ProjectStartFilter {
  const record = exactRecord(value, 'projectStart filter', [], ['beforeSequence', 'limit'])
  const beforeSequence = record.beforeSequence
  if (beforeSequence !== undefined
    && (!Number.isSafeInteger(beforeSequence) || (beforeSequence as number) < 1)) {
    throw badRequest('beforeSequence must be a positive safe integer', {
      field: 'beforeSequence',
    })
  }
  const requestedLimit = record.limit
  if (requestedLimit !== undefined
    && (!Number.isSafeInteger(requestedLimit)
      || (requestedLimit as number) < 1
      || (requestedLimit as number) > MAX_PROJECT_START_LIMIT)) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_PROJECT_START_LIMIT}`, {
      field: 'limit',
    })
  }
  return Object.freeze({
    ...(beforeSequence === undefined ? {} : { beforeSequence: beforeSequence as number }),
    limit: requestedLimit === undefined ? DEFAULT_PROJECT_START_LIMIT : requestedLimit as number,
  })
}

function validateCreateProjectRequest(value: CreateProjectRequest): CreateProjectRequest {
  const record = exactRecord(value, 'createProject request', [
    'template',
    'projectName',
    'primaryGoal',
    'supportingGoals',
    'expectedCatalogRevision',
    'expectedRevision',
    'idempotencyKey',
    'causationId',
    'reason',
  ])
  const template = validateTemplateSelection(record.template)
  const projectName = boundedText(record.projectName, 'projectName', MAX_PROJECT_NAME_LENGTH)
  const primaryGoalRecord = exactRecord(record.primaryGoal, 'primaryGoal', ['name', 'outcomes'])
  const primaryGoalName = boundedText(primaryGoalRecord.name, 'primaryGoal.name', MAX_GOAL_NAME_LENGTH)
  if (!Array.isArray(primaryGoalRecord.outcomes)
    || primaryGoalRecord.outcomes.length < 1
    || primaryGoalRecord.outcomes.length > MAX_OUTCOMES_PER_PROJECT) {
    throw badRequest(`primaryGoal.outcomes must contain 1-${MAX_OUTCOMES_PER_PROJECT} items`, {
      field: 'primaryGoal.outcomes',
    })
  }
  const outcomes = Object.freeze(Array.from(primaryGoalRecord.outcomes, (outcome, index) =>
    validateOutcomeDraft(outcome, index)))

  if (!Array.isArray(record.supportingGoals)
    || record.supportingGoals.length > MAX_SUPPORTING_GOALS_PER_PROJECT) {
    throw badRequest(`supportingGoals must contain 0-${MAX_SUPPORTING_GOALS_PER_PROJECT} items`, {
      field: 'supportingGoals',
    })
  }
  const supportingGoals = Object.freeze(Array.from(record.supportingGoals, (goal, index) => {
    const goalRecord = exactRecord(goal, `supportingGoals[${String(index)}]`, [
      'goalId',
      'expectedRevision',
    ])
    const goalId = safeId(goalRecord.goalId, `supportingGoals[${String(index)}].goalId`)
    if (!Number.isSafeInteger(goalRecord.expectedRevision)
      || (goalRecord.expectedRevision as number) < 1) {
      throw badRequest('supporting Goal expectedRevision must be a positive safe integer', {
        field: `supportingGoals[${String(index)}].expectedRevision`,
      })
    }
    return Object.freeze({
      goalId,
      expectedRevision: goalRecord.expectedRevision as number,
    })
  }))
  if (new Set(supportingGoals.map(goal => goal.goalId)).size !== supportingGoals.length) {
    throw badRequest('supportingGoals must not contain duplicate Goal ids', {
      field: 'supportingGoals',
    })
  }
  if (!Number.isSafeInteger(record.expectedCatalogRevision)
    || (record.expectedCatalogRevision as number) < 0) {
    throw badRequest('expectedCatalogRevision must be a non-negative safe integer', {
      field: 'expectedCatalogRevision',
    })
  }
  if (record.expectedRevision !== null) {
    throw badRequest('expectedRevision must be null for a new Project', {
      field: 'expectedRevision',
    })
  }
  const idempotencyKey = validateCommandKey(record.idempotencyKey, 'idempotencyKey')
  const causationId = validateCommandKey(record.causationId, 'causationId')
  if (record.reason !== 'owner-project-create') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    template,
    projectName,
    primaryGoal: Object.freeze({ name: primaryGoalName, outcomes }),
    supportingGoals,
    expectedCatalogRevision: record.expectedCatalogRevision as number,
    expectedRevision: null,
    idempotencyKey,
    causationId,
    reason: 'owner-project-create',
  })
}

function validateTemplateSelection(value: unknown): ProjectTemplateSelection {
  const record = exactRecord(value, 'template', [
    'templateId',
    'templateVersion',
    'definitionDigest',
  ])
  const templateId = safeId(record.templateId, 'template.templateId')
  if (!Number.isSafeInteger(record.templateVersion) || (record.templateVersion as number) < 1) {
    throw badRequest('template.templateVersion must be a positive safe integer', {
      field: 'template.templateVersion',
    })
  }
  if (typeof record.definitionDigest !== 'string' || !DIGEST_PATTERN.test(record.definitionDigest)) {
    throw badRequest('template.definitionDigest must be a lowercase SHA-256 digest', {
      field: 'template.definitionDigest',
    })
  }
  return Object.freeze({
    templateId,
    templateVersion: record.templateVersion,
    definitionDigest: record.definitionDigest,
  }) as ProjectTemplateSelection
}

function validateOutcomeDraft(value: unknown, index: number): OutcomeDraft {
  const prefix = `primaryGoal.outcomes[${String(index)}]`
  const record = exactRecord(value, prefix, ['name', 'metric'])
  const metricRecord = exactRecord(record.metric, `${prefix}.metric`, [
    'metricName',
    'initialValue',
    'targetValue',
    'unit',
    'direction',
  ])
  const initialValue = finiteNumber(metricRecord.initialValue, `${prefix}.metric.initialValue`)
  const targetValue = finiteNumber(metricRecord.targetValue, `${prefix}.metric.targetValue`)
  if (metricRecord.direction !== 'increase' && metricRecord.direction !== 'decrease') {
    throw badRequest('Outcome metric direction must be increase or decrease', {
      field: `${prefix}.metric.direction`,
    })
  }
  if ((metricRecord.direction === 'increase' && targetValue <= initialValue)
    || (metricRecord.direction === 'decrease' && targetValue >= initialValue)) {
    throw badRequest('Outcome metric target must move in its declared direction', {
      field: `${prefix}.metric.targetValue`,
    })
  }
  return Object.freeze({
    name: boundedText(record.name, `${prefix}.name`, MAX_OUTCOME_NAME_LENGTH),
    metric: Object.freeze({
      metricName: boundedText(
        metricRecord.metricName,
        `${prefix}.metric.metricName`,
        MAX_METRIC_NAME_LENGTH,
      ),
      initialValue,
      targetValue,
      unit: boundedText(metricRecord.unit, `${prefix}.metric.unit`, MAX_METRIC_UNIT_LENGTH),
      direction: metricRecord.direction,
    }),
  })
}

function validateProjectQuery(value: ProjectQuery): ProjectQuery {
  const record = exactRecord(value, 'project query', ['projectId'])
  return Object.freeze({ projectId: safeId(record.projectId, 'projectId') })
}

function validateProjectTeamQuery(value: ProjectTeamQuery): ProjectTeamQuery {
  const record = exactRecord(value, 'projectTeam query', ['projectId'])
  return Object.freeze({ projectId: safeId(record.projectId, 'projectId') })
}

function validateAddProjectMemberRequest(value: AddProjectMemberRequest): AddProjectMemberRequest {
  const record = exactRecord(value, 'addProjectMember request', [
    'projectId',
    'member',
    'expectedTeamRevision',
    'expectedRevision',
    'idempotencyKey',
    'causationId',
    'reason',
  ])
  if (record.expectedRevision !== null) {
    throw badRequest('expectedRevision must be null for a new Project member', {
      field: 'expectedRevision',
    })
  }
  if (record.reason !== 'owner-project-member-add') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    member: validateProjectMemberDraft(record.member),
    expectedTeamRevision: nonNegativeRevision(
      record.expectedTeamRevision,
      'expectedTeamRevision',
    ),
    expectedRevision: null,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-member-add',
  })
}

function validateProjectMemberDraft(value: unknown): ProjectMemberDraft {
  const record = exactRecord(
    value,
    'member',
    ['kind', 'displayName'],
    ['identity'],
  )
  const displayName = boundedText(
    record.displayName,
    'member.displayName',
    MAX_PROJECT_MEMBER_DISPLAY_NAME_LENGTH,
  )
  if (record.kind === 'agent') {
    if (Object.hasOwn(record, 'identity')) {
      throw badRequest('Agent member must not carry an identity or profile', {
        field: 'member.identity',
      })
    }
    return Object.freeze({ kind: 'agent', displayName })
  }
  if (record.kind !== 'human') {
    throw badRequest('member.kind must be human or agent', { field: 'member.kind' })
  }
  if (!Object.hasOwn(record, 'identity')) {
    throw badRequest('Human member must carry exactly one identity', {
      field: 'member.identity',
    })
  }
  const identityType = exactRecord(
    record.identity,
    'member.identity',
    ['type'],
    ['appId', 'openId', 'method', 'value'],
  ).type
  if (identityType === 'feishu') {
    const identity = exactRecord(record.identity, 'member.identity', ['type', 'appId', 'openId'])
    return Object.freeze({
      kind: 'human',
      displayName,
      identity: Object.freeze({
        type: 'feishu',
        appId: safeId(identity.appId, 'member.identity.appId'),
        openId: safeId(identity.openId, 'member.identity.openId'),
      }),
    })
  }
  if (identityType !== 'external') {
    throw badRequest('member.identity.type must be feishu or external', {
      field: 'member.identity.type',
    })
  }
  const identity = exactRecord(record.identity, 'member.identity', [
    'type',
    'method',
    'value',
  ])
  if (identity.method !== 'email'
    && identity.method !== 'phone'
    && identity.method !== 'other') {
    throw badRequest('member.identity.method must be email, phone, or other', {
      field: 'member.identity.method',
    })
  }
  return Object.freeze({
    kind: 'human',
    displayName,
    identity: Object.freeze({
      type: 'external',
      method: identity.method,
      value: boundedText(
        identity.value,
        'member.identity.value',
        MAX_EXTERNAL_CONTACT_VALUE_LENGTH,
      ),
    }),
  })
}

function validateSetProjectMemberStatusRequest(
  value: SetProjectMemberStatusRequest,
): SetProjectMemberStatusRequest {
  const record = exactRecord(value, 'setProjectMemberStatus request', [
    'projectId',
    'memberId',
    'status',
    'expectedTeamRevision',
    'expectedMemberRevision',
    'idempotencyKey',
    'causationId',
    'reason',
  ])
  if (record.status !== 'active' && record.status !== 'inactive') {
    throw badRequest('status must be active or inactive', { field: 'status' })
  }
  if (record.reason !== 'owner-project-member-status-change') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    memberId: safeId(record.memberId, 'memberId'),
    status: record.status,
    expectedTeamRevision: nonNegativeRevision(
      record.expectedTeamRevision,
      'expectedTeamRevision',
    ),
    expectedMemberRevision: positiveRevision(
      record.expectedMemberRevision,
      'expectedMemberRevision',
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-member-status-change',
  })
}

function validateSetProjectResponsibilityRequest(
  value: SetProjectResponsibilityRequest,
): SetProjectResponsibilityRequest {
  const record = exactRecord(value, 'setProjectResponsibility request', [
    'projectId',
    'accountableMemberId',
    'contributorMemberIds',
    'humanSponsorMemberId',
    'expectedTeamRevision',
    'expectedResponsibilityRevision',
    'idempotencyKey',
    'causationId',
    'reason',
  ])
  if (!Array.isArray(record.contributorMemberIds)
    || record.contributorMemberIds.length > MAX_PROJECT_CONTRIBUTORS) {
    throw badRequest(`contributorMemberIds must contain 0-${MAX_PROJECT_CONTRIBUTORS} items`, {
      field: 'contributorMemberIds',
    })
  }
  const contributorMemberIds = Array.from(record.contributorMemberIds, (memberId, index) =>
    safeId(memberId, `contributorMemberIds[${String(index)}]`))
  if (new Set(contributorMemberIds).size !== contributorMemberIds.length) {
    throw badRequest('contributorMemberIds must not contain duplicates', {
      field: 'contributorMemberIds',
    })
  }
  contributorMemberIds.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const sponsor = record.humanSponsorMemberId
  if (sponsor !== null && (typeof sponsor !== 'string' || !SAFE_FILTER_ID.test(sponsor))) {
    throw badRequest('humanSponsorMemberId must be null or a safe identifier', {
      field: 'humanSponsorMemberId',
    })
  }
  const expectedResponsibilityRevision = record.expectedResponsibilityRevision
  if (expectedResponsibilityRevision !== null
    && (!Number.isSafeInteger(expectedResponsibilityRevision)
      || (expectedResponsibilityRevision as number) < 1)) {
    throw badRequest(
      'expectedResponsibilityRevision must be null or a positive safe integer',
      { field: 'expectedResponsibilityRevision' },
    )
  }
  if (record.reason !== 'owner-project-responsibility-set') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    accountableMemberId: safeId(record.accountableMemberId, 'accountableMemberId'),
    contributorMemberIds: Object.freeze(contributorMemberIds),
    humanSponsorMemberId: sponsor as string | null,
    expectedTeamRevision: nonNegativeRevision(
      record.expectedTeamRevision,
      'expectedTeamRevision',
    ),
    expectedResponsibilityRevision: expectedResponsibilityRevision as number | null,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-responsibility-set',
  })
}

function validateReviewCenterFilter(value: ReviewCenterFilter): ReviewCenterFilter {
  const record = exactRecord(value, 'reviewCenter filter', ['projectId'], [
    'status',
    'riskLevel',
    'beforeSequence',
    'limit',
  ])
  const status = record.status
  if (status !== undefined
    && status !== 'pending'
    && status !== 'deferred'
    && status !== 'stale'
    && status !== 'accepted'
    && status !== 'rejected') {
    throw badRequest('status is not supported', { field: 'status' })
  }
  const riskLevel = record.riskLevel
  if (riskLevel !== undefined && riskLevel !== 'low' && riskLevel !== 'high') {
    throw badRequest('riskLevel must be low or high', { field: 'riskLevel' })
  }
  const beforeSequence = record.beforeSequence
  if (beforeSequence !== undefined) positiveRevision(beforeSequence, 'beforeSequence')
  const requestedLimit = record.limit
  if (requestedLimit !== undefined
    && (!Number.isSafeInteger(requestedLimit)
      || (requestedLimit as number) < 1
      || (requestedLimit as number) > MAX_REVIEW_CENTER_LIMIT)) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_REVIEW_CENTER_LIMIT}`, {
      field: 'limit',
    })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    ...(status === undefined ? {} : {
      status: status as Exclude<ReviewCenterFilter['status'], undefined>,
    }),
    ...(riskLevel === undefined ? {} : {
      riskLevel: riskLevel as Exclude<ReviewCenterFilter['riskLevel'], undefined>,
    }),
    ...(beforeSequence === undefined ? {} : { beforeSequence: beforeSequence as number }),
    limit: requestedLimit === undefined ? DEFAULT_REVIEW_CENTER_LIMIT : requestedLimit as number,
  })
}

function validateProposeProjectResponsibilityChangeRequest(
  value: ProposeProjectResponsibilityChangeRequest,
): ProposeProjectResponsibilityChangeRequest {
  const record = exactRecord(value, 'proposeProjectResponsibilityChange request', [
    'projectId',
    'candidate',
    'expectedTeamRevision',
    'evidenceRefs',
    'idempotencyKey',
    'causationId',
    'reason',
  ])
  if (!Array.isArray(record.evidenceRefs)
    || record.evidenceRefs.length < 1
    || record.evidenceRefs.length > MAX_SUGGESTED_CHANGE_EVIDENCE_REFS) {
    throw badRequest(
      `evidenceRefs must contain 1-${MAX_SUGGESTED_CHANGE_EVIDENCE_REFS} items`,
      { field: 'evidenceRefs' },
    )
  }
  const evidenceRefs = Object.freeze(
    Array.from(record.evidenceRefs, validateEvidenceRef).sort((left, right) =>
      left.auditEventId < right.auditEventId
        ? -1
        : left.auditEventId > right.auditEventId ? 1 : 0),
  )
  if (record.reason !== 'owner-suggested-change-propose') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    candidate: validateSuggestedResponsibilityValue(record.candidate, 'candidate'),
    expectedTeamRevision: nonNegativeRevision(
      record.expectedTeamRevision,
      'expectedTeamRevision',
    ),
    evidenceRefs,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-suggested-change-propose',
  })
}

function validateDecideSuggestedChangeRequest(
  value: DecideSuggestedChangeRequest,
): DecideSuggestedChangeRequest {
  const record = exactRecord(value, 'decideSuggestedChange request', [
    'projectId',
    'suggestedChangeId',
    'expectedSuggestedChangeRevision',
    'feedback',
    'idempotencyKey',
    'causationId',
    'mode',
    'reason',
  ], ['acknowledgedRiskLevel', 'candidate'])
  const common = Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    suggestedChangeId: safeId(record.suggestedChangeId, 'suggestedChangeId'),
    expectedSuggestedChangeRevision: positiveRevision(
      record.expectedSuggestedChangeRevision,
      'expectedSuggestedChangeRevision',
    ),
    feedback: boundedText(
      record.feedback,
      'feedback',
      MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH,
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
  })
  if (record.mode === 'accept') {
    assertDecisionReason(record.reason, 'owner-suggested-change-accept')
    if (Object.hasOwn(record, 'candidate')) {
      throw badRequest('accept must not carry an edited candidate', { field: 'candidate' })
    }
    return Object.freeze({
      ...common,
      mode: 'accept',
      acknowledgedRiskLevel: validateRiskAcknowledgement(record.acknowledgedRiskLevel),
      reason: 'owner-suggested-change-accept',
    })
  }
  if (record.mode === 'edit-and-accept') {
    assertDecisionReason(record.reason, 'owner-suggested-change-edit-accept')
    if (!Object.hasOwn(record, 'candidate')) {
      throw badRequest('edit-and-accept requires candidate', { field: 'candidate' })
    }
    return Object.freeze({
      ...common,
      mode: 'edit-and-accept',
      acknowledgedRiskLevel: validateRiskAcknowledgement(record.acknowledgedRiskLevel),
      candidate: validateSuggestedResponsibilityValue(record.candidate, 'candidate'),
      reason: 'owner-suggested-change-edit-accept',
    })
  }
  if (record.mode === 'reject' || record.mode === 'defer') {
    if (Object.hasOwn(record, 'candidate')) {
      throw badRequest(`${record.mode} must not carry candidate`, { field: 'candidate' })
    }
    if (Object.hasOwn(record, 'acknowledgedRiskLevel')) {
      throw badRequest(`${record.mode} must not carry acknowledgedRiskLevel`, {
        field: 'acknowledgedRiskLevel',
      })
    }
    if (record.mode === 'reject') {
      assertDecisionReason(record.reason, 'owner-suggested-change-reject')
      return Object.freeze({
        ...common,
        mode: 'reject',
        reason: 'owner-suggested-change-reject',
      })
    }
    assertDecisionReason(record.reason, 'owner-suggested-change-defer')
    return Object.freeze({
      ...common,
      mode: 'defer',
      reason: 'owner-suggested-change-defer',
    })
  }
  throw badRequest('mode is not supported', { field: 'mode' })
}

function validateSuggestedResponsibilityValue(
  value: unknown,
  field: string,
): ProjectResponsibilitySuggestedValue {
  const record = exactRecord(value, field, [
    'accountableMemberId',
    'contributorMemberIds',
    'humanSponsorMemberId',
  ])
  if (!Array.isArray(record.contributorMemberIds)
    || record.contributorMemberIds.length > MAX_PROJECT_CONTRIBUTORS) {
    throw badRequest(`contributorMemberIds must contain 0-${MAX_PROJECT_CONTRIBUTORS} items`, {
      field: `${field}.contributorMemberIds`,
    })
  }
  const contributorMemberIds = Array.from(record.contributorMemberIds, (memberId, index) =>
    safeId(memberId, `${field}.contributorMemberIds[${String(index)}]`))
  if (new Set(contributorMemberIds).size !== contributorMemberIds.length) {
    throw badRequest('contributorMemberIds must not contain duplicates', {
      field: `${field}.contributorMemberIds`,
    })
  }
  contributorMemberIds.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const humanSponsorMemberId = record.humanSponsorMemberId
  if (humanSponsorMemberId !== null) {
    safeId(humanSponsorMemberId, `${field}.humanSponsorMemberId`)
  }
  return Object.freeze({
    accountableMemberId: safeId(record.accountableMemberId, `${field}.accountableMemberId`),
    contributorMemberIds: Object.freeze(contributorMemberIds),
    humanSponsorMemberId: humanSponsorMemberId as string | null,
  })
}

function validateEvidenceRef(value: unknown, index: number): SuggestedChangeEvidenceRef {
  const field = `evidenceRefs[${String(index)}]`
  const record = exactRecord(value, field, ['kind', 'auditEventId'])
  if (record.kind !== 'workbench-audit-event') {
    throw badRequest('evidence kind is not supported', { field: `${field}.kind` })
  }
  return Object.freeze({
    kind: 'workbench-audit-event',
    auditEventId: safeId(record.auditEventId, `${field}.auditEventId`),
  })
}

function validateRiskAcknowledgement(value: unknown): SuggestedChangeRiskLevel {
  if (value !== 'low' && value !== 'high') {
    throw badRequest('acknowledgedRiskLevel must be low or high', {
      field: 'acknowledgedRiskLevel',
    })
  }
  return value
}

function assertDecisionReason(value: unknown, expected: DecideSuggestedChangeRequest['reason']): void {
  if (value !== expected) {
    throw badRequest('reason does not match the decision mode', { field: 'reason' })
  }
}

function nonNegativeRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw badRequest(`${field} must be a non-negative safe integer`, { field })
  }
  return value as number
}

function positiveRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw badRequest(`${field} must be a positive safe integer`, { field })
  }
  return value as number
}

function exactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`, { field: label })
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw badRequest(`${label} must be a plain data object`, { field: label })
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw badRequest(`${label} must not contain symbol fields`, { field: label })
  }
  const allowed = new Set([...required, ...optional])
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const field of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(field)) {
      throw badRequest(`${label} has unsupported field ${field}`, { field })
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw badRequest(`${label}.${field} must be an enumerable data field`, { field })
    }
    copy[field] = descriptor.value
  }
  for (const field of required) {
    if (!Object.hasOwn(copy, field)) {
      throw badRequest(`${label} is missing field ${field}`, { field })
    }
  }
  return copy
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string`, { field })
  }
  const normalized = value.trim()
  const length = [...normalized].length
  if (length < 1
    || length > maximum
    || !normalized.isWellFormed()
    || TEXT_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw badRequest(`${field} must contain 1-${maximum} safe characters`, {
      field,
      maximum,
      actualLength: length,
    })
  }
  return normalized
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    throw badRequest(`${field} must be a finite number other than negative zero`, { field })
  }
  return value
}

function safeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_FILTER_ID.test(value)) {
    throw badRequest(`${field} must be a safe identifier`, { field })
  }
  return value
}

const SAFE_COMMAND_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u
const SAFE_FILTER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DEFAULT_ACTIVITY_LIMIT = 50
const MAX_ACTIVITY_LIMIT = 100

function validateCommandKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_COMMAND_KEY.test(value)) {
    throw badRequest(`${field} must be 16-128 safe ASCII characters`, { field })
  }
  return value
}

function validateActivityFilter(value: WorkbenchActivityFilter): WorkbenchActivityFilter {
  const record = exactRecord(value, 'activity filter', [], [
    'projectId',
    'objectType',
    'objectId',
    'action',
    'beforeSequence',
    'limit',
  ])
  const projectId: unknown = record.projectId
  if (projectId !== undefined && projectId !== null
    && (typeof projectId !== 'string' || !SAFE_FILTER_ID.test(projectId))) {
    throw badRequest('projectId must be null or a safe identifier', { field: 'projectId' })
  }
  const objectType: unknown = record.objectType
  if (objectType !== undefined
    && objectType !== 'workbench-status'
    && objectType !== 'project'
    && objectType !== 'project-member'
    && objectType !== 'project-responsibility'
    && objectType !== 'suggested-change') {
    throw badRequest('objectType is not supported', { field: 'objectType' })
  }
  const objectId: unknown = record.objectId
  if (objectId !== undefined
    && (typeof objectId !== 'string' || !SAFE_FILTER_ID.test(objectId))) {
    throw badRequest('objectId must be a safe identifier', { field: 'objectId' })
  }
  const action: unknown = record.action
  if (action !== undefined
    && action !== 'workbench.status.updated'
    && action !== 'workbench.project.created'
    && action !== 'workbench.project-member.created'
    && action !== 'workbench.project-member.status-changed'
    && action !== 'workbench.project.responsibility-assigned'
    && action !== 'workbench.suggested-change.proposed'
    && action !== 'workbench.suggested-change.accepted'
    && action !== 'workbench.suggested-change.edited-accepted'
    && action !== 'workbench.suggested-change.rejected'
    && action !== 'workbench.suggested-change.deferred') {
    throw badRequest('action is not supported', { field: 'action' })
  }
  const beforeSequence: unknown = record.beforeSequence
  if (beforeSequence !== undefined
    && (!Number.isSafeInteger(beforeSequence) || (beforeSequence as number) < 1)) {
    throw badRequest('beforeSequence must be a positive safe integer', {
      field: 'beforeSequence',
    })
  }
  const requestedLimit: unknown = record.limit
  if (requestedLimit !== undefined
    && (!Number.isSafeInteger(requestedLimit)
      || (requestedLimit as number) < 1
      || (requestedLimit as number) > MAX_ACTIVITY_LIMIT)) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}`, {
      field: 'limit',
    })
  }
  return Object.freeze({
    ...(projectId === undefined ? {} : { projectId: projectId as string | null }),
    ...(objectType === undefined ? {} : {
      objectType: objectType as Exclude<WorkbenchActivityFilter['objectType'], undefined>,
    }),
    ...(objectId === undefined ? {} : { objectId: objectId as string }),
    ...(action === undefined ? {} : {
      action: action as Exclude<WorkbenchActivityFilter['action'], undefined>,
    }),
    ...(beforeSequence === undefined ? {} : { beforeSequence: beforeSequence as number }),
    limit: requestedLimit === undefined ? DEFAULT_ACTIVITY_LIMIT : requestedLimit as number,
  })
}

function generatedId(value: string, kind: string): string {
  if (typeof value !== 'string' || !SAFE_FILTER_ID.test(value)) {
    throw infrastructure(`Workbench id generator returned an invalid ${kind} id`)
  }
  return value
}

function commandInstant(clock: WorkbenchClock): string {
  const now = clock.now()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw infrastructure('Workbench clock returned an invalid instant')
  }
  return now.toISOString()
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw cancelled('Workbench request was cancelled')
}

function badRequest(message: string, details: Record<string, string | number>): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'bad-request', message, details })
}

function cancelled(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'cancelled', message, details: {} })
}

function unavailable(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'unavailable', message, details: {} })
}

function infrastructure(message: string, cause?: unknown): TypertRemoteFailure {
  const failure = new TypertRemoteFailure({ code: 'internal', message, details: {} })
  if (cause !== undefined) Object.defineProperty(failure, 'cause', { value: cause })
  return failure
}
