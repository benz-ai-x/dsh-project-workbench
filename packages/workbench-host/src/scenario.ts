/** Highest-level deterministic seam around the Workbench public command/query surface. */

import { createHash, randomUUID } from 'node:crypto'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalizeJson } from './audit.ts'
import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  BindProjectCalendarRequest,
  BindProjectCalendarResult,
  BindFeishuTaskListRequest,
  BindFeishuTaskListResult,
  ConfigureFeishuIdentityRouteRequest,
  ConfigureFeishuIdentityRouteResult,
  ConfigureFeishuTaskWorkflowMapping,
  ConfigureFeishuTaskWorkflowRequest,
  ConfigureFeishuTaskWorkflowResult,
  CreateProjectDeliverableRequest,
  CreateProjectDeliverableResult,
  CreateProjectRequest,
  CreateProjectResult,
  CreateProjectMilestoneRequest,
  CreateProjectMilestoneResult,
  CreateProjectRiskRequest,
  CreateProjectRiskResult,
  DecideSuggestedChangeRequest,
  DecideSuggestedChangeResult,
  DecideDeliverableAcceptanceRequest,
  DecideDeliverableAcceptanceResult,
  DeliverableAcceptanceReviewCenterFilter,
  DeliverableArtifactVersionRef,
  DeliverableAcceptanceReviewCenterProjection,
  DeliverablePlanProjection,
  DiscoverFeishuTaskListsRequest,
  DiscoverFeishuCalendarsRequest,
  DiscoverFeishuCalendarEventsRequest,
  FeishuCalendarDiscoveryProjection,
  FeishuCalendarEventDiscoveryProjection,
  FeishuCalendarEventInput,
  FeishuCalendarEventResult,
  DiscoverFeishuTaskWorkflowFieldsRequest,
  FeishuActorBinding,
  FeishuConnectionIssue,
  FeishuConnectionCenterProjection,
  FeishuCredentialProjection,
  FeishuIdentityKind,
  FeishuTaskEventResult,
  FeishuTaskMutationEffectProjection,
  FeishuTaskListDiscoveryProjection,
  FeishuTaskWorkflowCompatibilityPreview,
  FeishuTaskWorkflowFieldCandidate,
  FeishuTaskWorkflowFieldDiscoveryProjection,
  FeishuResourceProbeProjection,
  FeishuScopeObservation,
  OutcomeDraft,
  ProjectDetailProjection,
  ProjectDeliverablesProjection,
  ProjectDeliverablesQuery,
  ProjectDeliverableConflict,
  ProjectCalendarSchedule,
  ProjectMilestonesProjection,
  ProjectMilestonesQuery,
  ProjectRisksProjection,
  ProjectRisksQuery,
  ProjectRiskConflict,
  ProjectMemberDraft,
  ProjectQuery,
  ProjectResponsibilitySuggestedValue,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectTeamProjection,
  ProjectTeamQuery,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
  ProjectTasksProjection,
  ProjectTasksQuery,
  ProjectTemplateSelection,
  PreviewFeishuTaskWorkflowRequest,
  ProposeProjectResponsibilityChangeRequest,
  ProposeProjectResponsibilityChangeResult,
  ReconcileProjectTasksRequest,
  ReconcileProjectTasksResult,
  ReconcileProjectCalendarRequest,
  ReconcileProjectCalendarResult,
  ReferenceFeishuTaskRequest,
  ReferenceFeishuTaskResult,
  RequestDeliverableAcceptanceRequest,
  RequestDeliverableAcceptanceResult,
  ReviseProjectRiskRequest,
  ReviseProjectRiskResult,
  ReviewCenterFilter,
  ReviewCenterQuery,
  ReviewCenterResultProjection,
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
  WorkbenchProjectCalendarReason,
  WorkbenchFeishuTaskReason,
  WorkbenchStatusSnapshot,
  VerifyFeishuIdentityRouteRequest,
  VerifyFeishuIdentityRouteResult,
  UpdateFeishuTaskRequest,
  UpdateFeishuTaskResult,
  UpdateProjectMilestoneDateRequest,
  UpdateProjectMilestoneDateResult,
  TransitionProjectRiskRequest,
  TransitionProjectRiskResult,
} from './client.ts'
import {
  deliverableAcceptanceReviewCenterProjection,
  projectDetailProjection,
  projectDeliverablesProjection,
  projectMilestonesProjection,
  projectRisksProjection,
  projectResult,
  projectStartProjection,
  projectTeamCommandResult,
  projectTeamProjection,
  projectTasksProjection,
  reviewCenterProjection,
  statusResult,
  statusSnapshot,
  suggestedChangeDecisionResult,
  suggestedChangeProposalResult,
  type WorkbenchProjectMutation,
  type WorkbenchCommandMetadata,
  type WorkbenchFeishuVerificationObservation,
  type WorkbenchProjectMemberMutation,
  type WorkbenchProjectMemberStatusMutation,
  type WorkbenchProjectResponsibilityMutation,
  type WorkbenchFeishuTaskReconciliationTarget,
  type WorkbenchRepository,
  type WorkbenchSuggestedChangeDecisionMutation,
  type WorkbenchSuggestedChangeProposalMutation,
  type WorkbenchFeishuTaskWorkflowMappedField,
  type WorkbenchFeishuTaskWorkflowContext,
  type WorkbenchFeishuCalendarReconciliationMutation,
  type WorkbenchFeishuCalendarReconciliationTarget,
  type WorkbenchDeliverableAcceptanceDecisionMutation,
  type WorkbenchDeliverableAcceptanceRequestMutation,
  type WorkbenchDeliverableCalendarCreationReservationMutation,
  type WorkbenchProjectDeliverableMutation,
  type WorkbenchProjectDeliverableReplayQuery,
  type WorkbenchProjectRiskCreationMutation,
  type WorkbenchProjectRiskReplayQuery,
  type WorkbenchProjectRiskRevisionMutation,
  type WorkbenchProjectRiskTransitionMutation,
  type WorkbenchProjectMilestoneReplayQuery,
} from './repository.ts'
import {
  normalizeProjectRiskAssessment,
  normalizeProjectRiskAssessmentIntent,
  normalizeProjectRiskTransition,
  normalizeProjectRiskTransitionIntent,
} from './project-risk.ts'
import type { AuthorizedScope, WorkbenchAction, WorkbenchAuthorization } from './authorization.ts'
import type {
  WorkbenchFeishuTaskEventObservation,
  WorkbenchFeishuTaskExternalAdapter,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskWorkflowFieldWrite,
} from './feishu-task-federation.ts'
import type {
  WorkbenchFeishuCalendarEventSnapshot,
  WorkbenchFeishuCalendarExternalAdapter,
  WorkbenchFeishuCalendarRoute,
} from './feishu-calendar-federation.ts'
import {
  assessTaskWorkflowCompatibility,
  projectTaskWorkflowDefinition,
} from './feishu-task-workflow.ts'

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
  nextFeishuVerificationId(): string
  nextGoalId(): string
  nextOutcomeId(): string
  nextCommandId(): string
  nextAuditEventId(): string
  nextOutboxId(): string
  nextMilestoneId?(): string
  nextScheduleChangeId?(): string
  nextDeliverableId?(): string
  nextDeliverablePlanSnapshotId?(): string
  nextDeliverableCriterionId?(): string
  nextDeliverableAcceptanceRequestId?(): string
  nextDeliverableDecisionId?(): string
  nextDeliverableFinalReleaseId?(): string
  nextDeliverableActivityId?(): string
  nextProjectRiskId?(): string
  nextProjectRiskAssessmentId?(): string
  nextProjectRiskTransitionId?(): string
  nextProjectRiskActivityId?(): string
}

/** Stable identity for a future independently versioned external capability. */
export interface WorkbenchExternalAdapter {
  readonly adapterId: string
}

/** Credential-safe first phase: no resource identifier is available to this call. */
export interface WorkbenchFeishuIdentityVerificationInput {
  readonly kind: FeishuIdentityKind
  readonly appId: string
  readonly credentialRef: string
}

/** Capability facts returned only after the Host approves identity continuity. */
export interface WorkbenchFeishuResourceVerificationObservation {
  readonly result: 'healthy' | 'attention'
  readonly scopeInspection: {
    readonly state: 'observed' | 'unavailable' | 'not-inspected'
    readonly scopes: readonly FeishuScopeObservation[]
    readonly issue: FeishuConnectionIssue | null
  }
  readonly resourceProbe: FeishuResourceProbeProjection
}

/**
 * Opaque one-shot continuation retaining the resolved token only for this
 * verification operation. Callers can inspect the safe actor, never the token.
 */
export interface WorkbenchFeishuVerifiedIdentitySession {
  readonly actor: Omit<FeishuActorBinding, 'connectionId' | 'routeGeneration'>
  readonly displayLabel: string | null
  finishVerification(
    resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | null,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuResourceVerificationObservation>
  dispose(): void
}

/** A failed identity has no continuation, so it cannot reach a resource read. */
export type WorkbenchFeishuIdentityVerificationResult =
  | {
    readonly state: 'failed'
    readonly issue: FeishuConnectionIssue
  }
  | {
    readonly state: 'verified'
    readonly session: WorkbenchFeishuVerifiedIdentitySession
  }

/** Exact-route Feishu port; one call has no alternate actor or fallback input. */
export interface WorkbenchFeishuExternalAdapter extends WorkbenchExternalAdapter {
  describeCredential(ref: string): Promise<FeishuCredentialProjection>
  startIdentityVerification(
    input: Readonly<WorkbenchFeishuIdentityVerificationInput>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult>
}

/**
 * External ports collected at the scenario boundary. T01 intentionally invokes
 * none of them: a durable local status write has no implied external effect.
 */
export interface WorkbenchExternalAdapters {
  readonly feishu?: WorkbenchFeishuExternalAdapter
  readonly feishuTasks?: WorkbenchFeishuTaskExternalAdapter
  readonly feishuCalendars?: WorkbenchFeishuCalendarExternalAdapter
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
  /** Zero/omitted disables the timer; production supplies a bounded interval. */
  readonly taskReconciliationIntervalMs?: number
  /** Zero/omitted disables Calendar repair; notification hints remain optional. */
  readonly calendarReconciliationIntervalMs?: number
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
  nextFeishuVerificationId: () => `feishu-verification-${randomUUID()}`,
  nextGoalId: () => `goal-${randomUUID()}`,
  nextOutcomeId: () => `outcome-${randomUUID()}`,
  nextCommandId: () => `command-${randomUUID()}`,
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextOutboxId: () => `outbox-${randomUUID()}`,
  nextMilestoneId: () => `milestone-${randomUUID()}`,
  nextScheduleChangeId: () => `schedule-change-${randomUUID()}`,
  nextDeliverableId: () => `deliverable-${randomUUID()}`,
  nextDeliverablePlanSnapshotId: () => `deliverable-plan-${randomUUID()}`,
  nextDeliverableCriterionId: () => `criterion-${randomUUID()}`,
  nextDeliverableAcceptanceRequestId: () => `acceptance-request-${randomUUID()}`,
  nextDeliverableDecisionId: () => `acceptance-decision-${randomUUID()}`,
  nextDeliverableFinalReleaseId: () => `final-release-${randomUUID()}`,
  nextDeliverableActivityId: () => `deliverable-activity-${randomUUID()}`,
  nextProjectRiskId: () => `risk-${randomUUID()}`,
  nextProjectRiskAssessmentId: () => `risk-assessment-${randomUUID()}`,
  nextProjectRiskTransitionId: () => `risk-transition-${randomUUID()}`,
  nextProjectRiskActivityId: () => `risk-activity-${randomUUID()}`,
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
  private taskEventUnsubscribe: (() => void) | undefined
  private taskReconciliationTimer: ReturnType<typeof setInterval> | undefined
  private periodicReconciliationRunning = false
  private calendarEventUnsubscribe: (() => void) | undefined
  private calendarReconciliationTimer: ReturnType<typeof setInterval> | undefined
  private periodicCalendarReconciliationRunning = false

  constructor(readonly options: WorkbenchScenarioOptions) {
    if (!Number.isSafeInteger(options.maxStatusLength) || options.maxStatusLength < 1) {
      throw new TypeError('maxStatusLength must be a positive safe integer')
    }
    if (options.taskReconciliationIntervalMs !== undefined
      && (!Number.isSafeInteger(options.taskReconciliationIntervalMs)
        || options.taskReconciliationIntervalMs < 0)) {
      throw new TypeError('taskReconciliationIntervalMs must be a non-negative safe integer')
    }
    if (options.calendarReconciliationIntervalMs !== undefined
      && (!Number.isSafeInteger(options.calendarReconciliationIntervalMs)
        || options.calendarReconciliationIntervalMs < 0)) {
      throw new TypeError('calendarReconciliationIntervalMs must be a non-negative safe integer')
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

  /** Read independent Bot/User routes and enrich only credential-reference metadata live. */
  feishuConnectionCenter(
    callerSignal: AbortSignal = new AbortController().signal,
  ): Promise<FeishuConnectionCenterProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('feishuConnectionCenter requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.integration.feishu.read',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      const adapter = this.options.adapters.feishu
      const describe = async (ref: string | null): Promise<FeishuCredentialProjection> => {
        if (ref === null) {
          return Object.freeze({
            ref: null,
            configured: false,
            source: null,
            writable: false,
          })
        }
        if (adapter === undefined) {
          throw unavailable('Workbench Feishu adapter is not available')
        }
        const value = await adapter.describeCredential(ref)
        throwIfCancelled(operationSignal)
        return feishuCredentialProjection(value, ref)
      }
      const [botCredential, userCredential] = await Promise.all([
        describe(stored.bot.credentialRef),
        describe(stored.user.credentialRef),
      ])
      const projection: FeishuConnectionCenterProjection = Object.freeze({
        connectionId: stored.connectionId,
        realm: stored.realm,
        revision: stored.revision,
        bot: Object.freeze({
          kind: 'bot',
          state: stored.bot.state,
          generation: stored.bot.generation,
          appId: stored.bot.appId,
          credential: botCredential,
          actor: stored.bot.actor,
          displayLabel: stored.bot.displayLabel,
          lastVerification: stored.bot.lastVerification,
        }),
        user: Object.freeze({
          kind: 'user',
          state: stored.user.state,
          generation: stored.user.generation,
          appId: stored.user.appId,
          credential: userCredential,
          actor: stored.user.actor,
          displayLabel: stored.user.displayLabel,
          lastVerification: stored.user.lastVerification,
        }),
        updatedAt: stored.updatedAt,
      })
      return this.options.authorization.filterProjection(
        'workbench.integration.feishu.read',
        projection,
        operationSignal,
      )
    })
  }

  /** Advance one exact Bot/User route generation without accepting a secret value. */
  configureFeishuIdentityRoute(
    request: ConfigureFeishuIdentityRouteRequest,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuIdentityRouteResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('configureFeishuIdentityRoute requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.integration.feishu.configure',
        operationSignal,
      )
      const normalized = validateConfigureFeishuIdentityRouteRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      try {
        return await this.options.repository.commitFeishuRoute(Object.freeze({
          kind: normalized.kind,
          mode: normalized.mode,
          appId: normalized.mode === 'set' ? normalized.appId : null,
          credentialRef: normalized.mode === 'set' ? normalized.credentialRef : null,
          expectedConnectionRevision: normalized.expectedConnectionRevision,
          expectedRouteGeneration: normalized.expectedRouteGeneration,
          updatedAt: occurredAt,
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
            occurredAt,
          }),
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
    })
  }

  /** Verify one exact current route; replay is checked before any provider read. */
  verifyFeishuIdentityRoute(
    request: VerifyFeishuIdentityRouteRequest,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('verifyFeishuIdentityRoute requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.integration.feishu.verify',
        operationSignal,
      )
      const normalized = validateVerifyFeishuIdentityRouteRequest(request)
      const resourceProbe = normalized.resourceProbe ?? null
      const replay = await this.options.repository.replayFeishuVerification(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        kind: normalized.kind,
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration as number,
        resourceProbe,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      }), operationSignal)
      if (replay !== null) return replay

      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      const route = normalized.kind === 'bot' ? stored.bot : stored.user
      if (stored.revision !== normalized.expectedConnectionRevision) {
        return feishuVerifyConnectionConflict(
          normalized.expectedConnectionRevision,
          stored.revision,
        )
      }
      if (route.generation === null) return feishuVerifyRouteState('route-unconfigured', normalized.kind)
      if (route.generation !== normalized.expectedRouteGeneration) {
        return feishuVerifyGenerationConflict(
          normalized.kind,
          normalized.expectedRouteGeneration as number,
          route.generation,
        )
      }
      if (route.state === 'disabled') return feishuVerifyRouteState('route-disabled', normalized.kind)
      if (route.appId === null || route.credentialRef === null) {
        throw infrastructure('Workbench Feishu route projection is incomplete')
      }
      const adapter = this.options.adapters.feishu
      if (adapter === undefined) throw unavailable('Workbench Feishu adapter is not available')
      let observation: WorkbenchFeishuVerificationObservation
      try {
        const identity = await adapter.startIdentityVerification(Object.freeze({
          kind: normalized.kind,
          appId: route.appId,
          credentialRef: route.credentialRef,
        }), operationSignal)
        if (identity.state === 'failed') {
          throwIfCancelled(operationSignal)
          observation = failedFeishuVerificationObservation(identity.issue)
        } else {
          const session = identity.session
          try {
            throwIfCancelled(operationSignal)
            const continuityIssue = feishuIdentityContinuityIssue(
              normalized.kind,
              route.appId,
              route.actor,
              session.actor,
            )
            if (continuityIssue !== null) {
              observation = failedFeishuVerificationObservation(continuityIssue)
            } else {
              const capability = await session.finishVerification(resourceProbe, operationSignal)
              throwIfCancelled(operationSignal)
              observation = verifiedFeishuVerificationObservation(session, capability)
            }
          } finally {
            session.dispose()
          }
        }
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      throwIfCancelled(operationSignal)
      const checkedAt = commandInstant(this.options.clock)
      const verificationId = generatedId(
        this.options.ids.nextFeishuVerificationId(),
        'Feishu verification',
      )
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      return this.options.repository.commitFeishuVerification(Object.freeze({
        verificationId,
        kind: normalized.kind,
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration as number,
        resourceProbe,
        observation,
        checkedAt,
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
          occurredAt: checkedAt,
        }),
      }), operationSignal)
    })
  }

  /** Read the Feishu-authoritative task workspace for one authorized Project. */
  projectTasks(
    query: ProjectTasksQuery,
    signal: AbortSignal,
  ): Promise<ProjectTasksProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('projectTasks requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.read',
        operationSignal,
      )
      const normalized = validateProjectTasksQuery(query)
      const projection = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.tasks.read',
        projectTasksProjection(projection),
        operationSignal,
      )
    })
  }

  /** Discover task lists through exactly the selected, verified Bot/User route. */
  discoverFeishuTaskLists(
    request: DiscoverFeishuTaskListsRequest,
    signal: AbortSignal,
  ): Promise<FeishuTaskListDiscoveryProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('discoverFeishuTaskLists requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.bind',
        operationSignal,
      )
      const normalized = validateDiscoverFeishuTaskListsRequest(request)
      const project = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (project === null) throw badRequest('Project was not found', { field: 'projectId' })
      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      const resolved = resolveTaskRouteForBinding(stored, normalized)
      if (!resolved.ok) throw unavailable(resolved.error.error.message)
      const adapter = requiredTaskAdapter(this.options.adapters)
      const discovered = await adapter.listTaskLists(resolved.route, operationSignal)
      throwIfCancelled(operationSignal)
      if (discovered.state !== 'ok') {
        throw unavailable('Feishu task-list discovery was rejected')
      }
      return Object.freeze({
        projectId: normalized.projectId,
        connectionRevision: stored.revision,
        kind: normalized.kind,
        routeGeneration: normalized.expectedRouteGeneration,
        items: Object.freeze(discovered.value.map(item => Object.freeze({ ...item }))),
      })
    })
  }

  /** Discover custom fields only through the binding's pinned, verified actor route. */
  discoverFeishuTaskWorkflowFields(
    request: DiscoverFeishuTaskWorkflowFieldsRequest,
    signal: AbortSignal,
  ): Promise<FeishuTaskWorkflowFieldDiscoveryProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('discoverFeishuTaskWorkflowFields requires an AbortSignal', {
          field: 'signal',
        })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.workflow.read',
        operationSignal,
      )
      const normalized = validateDiscoverFeishuTaskWorkflowFieldsRequest(request)
      const context = await this.options.repository.readFeishuTaskWorkflowContext(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const ready = workflowContextForRead(context, normalized.expectedTaskRevision)
      const fields = await listWorkflowFields(
        requiredTaskAdapter(this.options.adapters),
        ready.target.route,
        ready.target.taskListGuid,
        operationSignal,
      )
      return Object.freeze({
        projectId: ready.project.projectId,
        taskListGuid: ready.target.taskListGuid,
        taskRevision: ready.project.revision,
        items: fields,
      })
    })
  }

  /** Validate a proposed schema/mapping against current Feishu field and task usage. */
  previewFeishuTaskWorkflow(
    request: PreviewFeishuTaskWorkflowRequest,
    signal: AbortSignal,
  ): Promise<FeishuTaskWorkflowCompatibilityPreview> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('previewFeishuTaskWorkflow requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.workflow.read',
        operationSignal,
      )
      const normalized = validatePreviewFeishuTaskWorkflowRequest(request)
      const context = await this.options.repository.readFeishuTaskWorkflowContext(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const ready = workflowContextForPreview(
        context,
        normalized.expectedTaskRevision,
        normalized.expectedWorkflowRevision,
      )
      const fields = await listWorkflowFields(
        requiredTaskAdapter(this.options.adapters),
        ready.target.route,
        ready.target.taskListGuid,
        operationSignal,
      )
      const assessed = assessTaskWorkflowCompatibility({
        current: ready.project.workflow,
        desired: normalized.definition,
        mapping: normalized.mapping,
        remoteFields: fields,
        taskValues: ready.taskValues,
      })
      return Object.freeze({
        projectId: normalized.projectId,
        taskRevision: ready.project.revision,
        workflowRevision: ready.project.workflow?.revision ?? null,
        definition: normalized.definition,
        mapping: normalized.mapping,
        compatibility: assessed.compatibility,
        usedStateIds: assessed.usedStateIds,
      })
    })
  }

  /** Create/map/migrate one Feishu field, then atomically commit its stable GUID mapping. */
  configureFeishuTaskWorkflow(
    request: ConfigureFeishuTaskWorkflowRequest,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('configureFeishuTaskWorkflow requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.workflow.configure',
        operationSignal,
      )
      const normalized = validateConfigureFeishuTaskWorkflowRequest(request)
      const replay = await this.options.repository.replayFeishuTaskWorkflowConfiguration(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          actorId: scope.ownerId,
          projectId: normalized.projectId,
          expectedTaskRevision: normalized.expectedTaskRevision,
          expectedWorkflowRevision: normalized.expectedWorkflowRevision,
          definition: normalized.definition,
          mapping: normalized.mapping,
          idempotencyKey: normalized.idempotencyKey,
          causationId: normalized.causationId,
          reason: normalized.reason,
        }),
        operationSignal,
      )
      if (replay !== null) return replay
      const project = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const projectPreflight = workflowProjectPreflight(project, normalized)
      if (projectPreflight !== null) return projectPreflight
      const context = await this.options.repository.readFeishuTaskWorkflowContext(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (context === null) throw infrastructure('Workbench workflow context disappeared')
      const preflight = workflowConfigurationPreflight(context, normalized)
      if (!preflight.ok) return preflight.result
      const adapter = requiredTaskAdapter(this.options.adapters)
      const fields = await listWorkflowFields(
        adapter,
        preflight.context.target.route,
        preflight.context.target.taskListGuid,
        operationSignal,
      )
      const assessed = assessTaskWorkflowCompatibility({
        current: preflight.context.project.workflow,
        desired: normalized.definition,
        mapping: normalized.mapping,
        remoteFields: fields,
        taskValues: preflight.context.taskValues,
      })
      if (assessed.compatibility.state === 'blocked') {
        return workflowCompatibilityBlocked(assessed.compatibility)
      }
      let configuredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      let command = taskCommand(
        this.options.ids,
        commandId,
        scope,
        normalized.idempotencyKey,
        normalized.causationId,
        normalized.reason,
        configuredAt,
      )
      let operationId: string | undefined
      if (normalized.mapping.mode !== 'existing') {
        const reservation = await this.options.repository.reserveFeishuTaskWorkflowOperation(
          Object.freeze({
            operationId: commandId,
            projectId: normalized.projectId,
            expectedTaskRevision: normalized.expectedTaskRevision,
            expectedWorkflowRevision: normalized.expectedWorkflowRevision,
            definition: normalized.definition,
            mapping: normalized.mapping,
            preparedAt: configuredAt,
            command,
          }),
          operationSignal,
        )
        if (reservation.state !== 'deliver') return reservation.result
        operationId = reservation.operationId
        command = reservation.command
        configuredAt = command.occurredAt
        if (!await this.options.repository.claimFeishuTaskWorkflowOperation(
          operationId,
          commandInstant(this.options.clock),
          operationSignal,
        )) {
          const recovered = await this.options.repository.reserveFeishuTaskWorkflowOperation(
            Object.freeze({
              operationId,
              projectId: normalized.projectId,
              expectedTaskRevision: normalized.expectedTaskRevision,
              expectedWorkflowRevision: normalized.expectedWorkflowRevision,
              definition: normalized.definition,
              mapping: normalized.mapping,
              preparedAt: configuredAt,
              command,
            }),
            operationSignal,
          )
          if (recovered.state !== 'deliver') return recovered.result
          throw infrastructure('Workbench workflow provider operation lost its claim')
        }
      }

      let mappedField: WorkbenchFeishuTaskWorkflowMappedField
      if (normalized.mapping.mode === 'existing') {
        const existingMapping = normalized.mapping
        const selected = fields.find(field => field.fieldGuid === existingMapping.fieldGuid)
        if (selected === undefined) return workflowCompatibilityBlocked(assessed.compatibility)
        mappedField = mappedWorkflowFieldFromExisting(
          normalized.definition,
          existingMapping,
          selected,
        )
      } else if (normalized.mapping.mode === 'create') {
        if (preflight.context.project.workflow !== null) {
          return workflowCompatibilityBlocked(Object.freeze({
            state: 'blocked',
            issues: Object.freeze([Object.freeze({
              code: 'field-missing',
              severity: 'blocked',
              stateId: null,
              taskGuid: null,
              message: 'An existing workflow must be migrated instead of creating another field',
            })]),
          }))
        }
        const create = requiredWorkflowFieldCreate(adapter)
        let outcome: Awaited<ReturnType<typeof create>>
        try {
          outcome = await create(
            preflight.context.target.route,
            Object.freeze({
              taskListGuid: preflight.context.target.taskListGuid,
              name: normalized.definition.fieldName,
              options: Object.freeze(normalized.definition.states.map(state => Object.freeze({
                name: state.name,
                colorIndex: state.colorIndex,
              }))),
            }),
            operationSignal,
          )
        } catch {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId as string,
            Object.freeze({
              state: 'unknown',
              issue: ambiguousTaskTransportIssue(),
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        throwIfCancelled(operationSignal)
        if (outcome.state !== 'ok') {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId as string,
            Object.freeze({
              state: outcome.state === 'unknown' ? 'unknown' : 'failed',
              issue: outcome.issue,
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        mappedField = mappedWorkflowFieldFromWrite(normalized.definition, outcome.value)
      } else {
        const current = preflight.context.project.workflow
        if (current === null) {
          return workflowCompatibilityBlocked(Object.freeze({
            state: 'blocked',
            issues: Object.freeze([Object.freeze({
              code: 'field-missing',
              severity: 'blocked',
              stateId: null,
              taskGuid: null,
              message: 'No configured workflow exists to migrate',
            })]),
          }))
        }
        const selected = fields.find(field => field.fieldGuid === current.field.fieldGuid)
        if (selected === undefined) return workflowCompatibilityBlocked(assessed.compatibility)
        const update = requiredWorkflowFieldUpdate(adapter)
        const currentByState = new Map(
          current.options.map(option => [option.stateId, option.optionGuid] as const),
        )
        let outcome: Awaited<ReturnType<typeof update>>
        try {
          outcome = await update(
            preflight.context.target.route,
            Object.freeze({
              fieldGuid: current.field.fieldGuid,
              expectedRemoteVersion: selected.remoteVersion,
              name: normalized.definition.fieldName,
              options: Object.freeze(normalized.definition.states.map(state => Object.freeze({
                ...(currentByState.get(state.stateId) === undefined
                  ? {}
                  : { optionGuid: currentByState.get(state.stateId) as string }),
                name: state.name,
                colorIndex: state.colorIndex,
              }))),
            }),
            operationSignal,
          )
        } catch {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId as string,
            Object.freeze({
              state: 'unknown',
              issue: ambiguousTaskTransportIssue(),
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        throwIfCancelled(operationSignal)
        if (outcome.state === 'conflict') {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId as string,
            Object.freeze({
              state: 'conflict',
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        if (outcome.state !== 'ok') {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId as string,
            Object.freeze({
              state: outcome.state === 'unknown' ? 'unknown' : 'failed',
              issue: outcome.issue,
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        mappedField = mappedWorkflowFieldFromWrite(normalized.definition, outcome.value, current)
      }

      const committedMapping = Object.freeze({
        mode: 'existing' as const,
        fieldGuid: mappedField.fieldGuid,
        options: Object.freeze(mappedField.options.map(option => Object.freeze({
          stateId: option.stateId,
          optionGuid: option.optionGuid,
        }))),
      })
      const postflight = assessTaskWorkflowCompatibility({
        current: preflight.context.project.workflow,
        desired: normalized.definition,
        mapping: committedMapping,
        remoteFields: Object.freeze([workflowCandidateFromMappedField(mappedField)]),
        taskValues: preflight.context.taskValues,
      })
      if (postflight.compatibility.state === 'blocked') {
        if (operationId !== undefined) {
          return this.options.repository.settleFeishuTaskWorkflowOperation(
            operationId,
            Object.freeze({
              state: 'unknown',
              issue: ambiguousTaskTransportIssue(),
              settledAt: commandInstant(this.options.clock),
            }),
            new AbortController().signal,
          )
        }
        return workflowCompatibilityBlocked(postflight.compatibility)
      }
      try {
        return await this.options.repository.commitFeishuTaskWorkflowConfiguration(Object.freeze({
          ...(operationId === undefined ? {} : { operationId }),
          projectId: normalized.projectId,
          expectedTaskRevision: normalized.expectedTaskRevision,
          expectedWorkflowRevision: normalized.expectedWorkflowRevision,
          definition: normalized.definition,
          mapping: normalized.mapping,
          field: mappedField,
          compatibility: postflight.compatibility,
          configuredAt,
          command,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationId === undefined) throw error
        return this.options.repository.settleFeishuTaskWorkflowOperation(
          operationId,
          Object.freeze({
            state: 'unknown',
            issue: ambiguousTaskTransportIssue(),
            settledAt: commandInstant(this.options.clock),
          }),
          new AbortController().signal,
        )
      }
    })
  }

  /** Create/select the unique primary task list, with replay before remote side effects. */
  bindFeishuTaskList(
    request: BindFeishuTaskListRequest,
    signal: AbortSignal,
  ): Promise<BindFeishuTaskListResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('bindFeishuTaskList requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.bind',
        operationSignal,
      )
      const normalized = validateBindFeishuTaskListRequest(request)
      const intent = normalized.mode === 'existing'
        ? Object.freeze({ mode: 'existing' as const, taskListGuid: normalized.taskListGuid })
        : Object.freeze({ mode: 'create' as const, name: normalized.name })
      const replay = await this.options.repository.replayFeishuTaskListBinding(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        intent,
        kind: normalized.kind,
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration,
        expectedBindingRevision: null,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      }), operationSignal)
      if (replay !== null) return replay
      const current = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (current === null) return taskProjectNotFoundResult(normalized.projectId)
      if (current.binding !== null) {
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: 'task-list-already-bound',
            message: 'Project already has a primary Feishu task list',
            current,
          }),
        })
      }
      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      const resolved = resolveTaskRouteForBinding(stored, normalized)
      if (!resolved.ok) return resolved.error
      const adapter = requiredTaskAdapter(this.options.adapters)
      let taskListGuid: string
      let createdByWorkbench = false
      if (normalized.mode === 'create') {
        const created = await adapter.createTaskList(resolved.route, Object.freeze({
          name: normalized.name,
          idempotencyKey: normalized.idempotencyKey,
        }), operationSignal)
        throwIfCancelled(operationSignal)
        if (created.state !== 'ok') {
          return taskRemoteBindFailure(
            created.state === 'unknown' ? 'remote-outcome-unknown' : 'remote-rejected',
            created.issue,
          )
        }
        taskListGuid = created.value.taskListGuid
        createdByWorkbench = true
      } else {
        taskListGuid = normalized.taskListGuid
      }
      const observed = await adapter.readTaskList(resolved.route, taskListGuid, operationSignal)
      throwIfCancelled(operationSignal)
      if (observed.state !== 'ok') return taskRemoteBindFailure('remote-rejected', observed.issue)
      if (observed.value.taskList.taskListGuid !== taskListGuid) {
        throw infrastructure('Feishu task-list read changed resource identity')
      }
      const boundAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      return this.options.repository.commitFeishuTaskListBinding(Object.freeze({
        projectId: normalized.projectId,
        intent,
        expectedBindingRevision: null,
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration,
        route: resolved.route,
        createdByWorkbench,
        snapshot: observed.value,
        boundAt,
        command: taskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          normalized.reason,
          boundAt,
        ),
      }), operationSignal)
    })
  }

  /** Replace the local primary-list subset from one complete remote baseline. */
  reconcileProjectTasks(
    request: ReconcileProjectTasksRequest,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('reconcileProjectTasks requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.reconcile',
        operationSignal,
      )
      const normalized = validateReconcileProjectTasksRequest(request)
      const current = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = reconcilePreflight(current, normalized)
      if (preflight !== null) return preflight
      const target = await this.options.repository.readFeishuTaskReconciliationTarget(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (target === null) throw infrastructure('Workbench task reconciliation target disappeared')
      return this.reconcileTaskTarget(target, operationSignal)
    })
  }

  /** Add one out-of-list task only through this explicit, audited command. */
  referenceFeishuTask(
    request: ReferenceFeishuTaskRequest,
    signal: AbortSignal,
  ): Promise<ReferenceFeishuTaskResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('referenceFeishuTask requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.reference',
        operationSignal,
      )
      const normalized = validateReferenceFeishuTaskRequest(request)
      const current = await this.options.repository.readProjectTasks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = referencePreflight(current, normalized)
      if (preflight !== null) return preflight
      const target = await this.options.repository.readFeishuTaskReconciliationTarget(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (target === null) throw infrastructure('Workbench task reference target disappeared')
      const observed = await requiredTaskAdapter(this.options.adapters).readTask(
        target.route,
        normalized.taskGuid,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (observed.state !== 'ok') return taskRemoteReferenceFailure(observed.issue)
      const referencedAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      return this.options.repository.commitFeishuTaskReference(Object.freeze({
        projectId: normalized.projectId,
        expectedRevision: normalized.expectedRevision,
        task: observed.value,
        referencedAt,
        command: taskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          normalized.reason,
          referencedAt,
        ),
      }), operationSignal)
    })
  }

  /** Reserve, attempt exactly once, and durably settle one versioned Feishu PATCH. */
  updateFeishuTask(
    request: UpdateFeishuTaskRequest,
    signal: AbortSignal,
  ): Promise<UpdateFeishuTaskResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('updateFeishuTask requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.tasks.update',
        operationSignal,
      )
      const normalized = validateUpdateFeishuTaskRequest(request)
      const preparedAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const mutation = Object.freeze({
        effectId: generatedId(`effect-${commandId}`, 'Feishu task effect'),
        projectId: normalized.projectId,
        taskGuid: normalized.taskGuid,
        expectedRevision: normalized.expectedRevision,
        expectedRemoteVersion: normalized.expectedRemoteVersion,
        ...(normalized.expectedWorkflowRevision === undefined
          ? {}
          : { expectedWorkflowRevision: normalized.expectedWorkflowRevision }),
        changes: Object.freeze({ ...normalized.changes }),
        preparedAt,
        command: taskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          normalized.reason,
          preparedAt,
        ),
      })
      let reservation = await this.options.repository.reserveFeishuTaskUpdate(
        mutation,
        operationSignal,
      )
      if (reservation.state !== 'deliver') return reservation.result
      if (!await this.options.repository.claimFeishuTaskUpdate(
        reservation.effect.effectId,
        commandInstant(this.options.clock),
        operationSignal,
      )) {
        reservation = await this.options.repository.reserveFeishuTaskUpdate(
          mutation,
          operationSignal,
        )
        if (reservation.state !== 'deliver') return reservation.result
        return unknownTaskUpdateResult(reservation.effect, reservation.receipt)
      }
      const settleSignal = new AbortController().signal
      try {
        const outcome = await requiredTaskAdapter(this.options.adapters).updateTask(
          reservation.route,
          Object.freeze({
            taskGuid: normalized.taskGuid,
            expectedRemoteVersion: normalized.expectedRemoteVersion,
            idempotencyKey: normalized.idempotencyKey,
            changes: reservation.patch,
          }),
          operationSignal,
        )
        const settledAt = commandInstant(this.options.clock)
        if (outcome.state === 'ok') {
          return this.options.repository.settleFeishuTaskUpdate(
            reservation.effect.effectId,
            Object.freeze({ state: 'delivered', task: outcome.value, settledAt }),
            settleSignal,
          )
        }
        if (outcome.state === 'conflict') {
          return this.options.repository.settleFeishuTaskUpdate(
            reservation.effect.effectId,
            Object.freeze({ state: 'conflict', current: outcome.current, settledAt }),
            settleSignal,
          )
        }
        return this.options.repository.settleFeishuTaskUpdate(
          reservation.effect.effectId,
          Object.freeze({
            state: outcome.state === 'unknown' ? 'unknown' : 'failed',
            issue: outcome.issue,
            settledAt,
          }),
          settleSignal,
        )
      } catch (error: unknown) {
        const result = await this.options.repository.settleFeishuTaskUpdate(
          reservation.effect.effectId,
          Object.freeze({
            state: 'unknown',
            issue: ambiguousTaskTransportIssue(),
            settledAt: commandInstant(this.options.clock),
          }),
          settleSignal,
        )
        if (error instanceof TypertRemoteFailure && !operationSignal.aborted) throw error
        return result
      }
    })
  }

  /** Discover calendars only through one explicitly selected verified route. */
  discoverFeishuCalendars(
    request: DiscoverFeishuCalendarsRequest,
    signal: AbortSignal,
  ): Promise<FeishuCalendarDiscoveryProjection> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'discoverFeishuCalendars')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.calendar.read',
        operationSignal,
      )
      const normalized = validateDiscoverFeishuCalendarsRequest(request)
      const project = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (project === null) throw badRequest('Project was not found', { field: 'projectId' })
      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      const resolved = resolveCalendarRouteForBinding(stored, normalized)
      if (!resolved.ok) throw unavailable(resolved.error.error.message)
      const observed = await requiredCalendarAdapter(this.options.adapters).listCalendars(
        resolved.route,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (observed.state !== 'ok') throw unavailable('Feishu calendar discovery was rejected')
      const seen = new Set<string>()
      const items = Object.freeze(observed.value.map((item) => {
        validateCalendarSnapshot(item)
        if (seen.has(item.calendarId)) {
          throw infrastructure('Feishu calendar discovery returned a duplicate identity')
        }
        seen.add(item.calendarId)
        return calendarCandidate(item)
      }))
      return Object.freeze({
        projectId: normalized.projectId,
        connectionRevision: stored.revision,
        kind: normalized.kind,
        routeGeneration: normalized.expectedRouteGeneration,
        items,
      })
    })
  }

  /** Bind exactly one immutable writable Calendar, reserving create before provider I/O. */
  bindProjectCalendar(
    request: BindProjectCalendarRequest,
    signal: AbortSignal,
  ): Promise<BindProjectCalendarResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'bindProjectCalendar')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.calendar.bind',
        operationSignal,
      )
      const normalized = validateBindProjectCalendarRequest(request)
      const intent = normalized.mode === 'existing'
        ? Object.freeze({ mode: 'existing' as const, calendarId: normalized.calendarId })
        : Object.freeze({
          mode: 'create' as const,
          summary: normalized.summary,
          description: normalized.description ?? null,
        })
      const replay = await this.options.repository.replayFeishuCalendarBinding(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        intent,
        kind: normalized.kind,
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration,
        expectedBindingRevision: null,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      }), operationSignal)
      if (replay !== null) return replay
      const current = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (current === null) return calendarProjectNotFound(normalized.projectId)
      if (current.binding !== null) return calendarAlreadyBound(current)
      const stored = await this.options.repository.readFeishuConnection(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
      }), operationSignal)
      const resolved = resolveCalendarRouteForBinding(stored, normalized)
      if (!resolved.ok) return resolved.error
      const adapter = requiredCalendarAdapter(this.options.adapters)
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const command = calendarCommand(
        this.options.ids,
        commandId,
        scope,
        normalized.idempotencyKey,
        normalized.causationId,
        normalized.reason,
        occurredAt,
      )
      if (normalized.mode === 'existing') {
        const observed = await adapter.readCalendar(
          resolved.route,
          normalized.calendarId,
          operationSignal,
        )
        throwIfCancelled(operationSignal)
        if (observed.state !== 'ok') return calendarRemoteBindFailure('remote-rejected', observed.issue)
        validateCalendarSnapshot(observed.value)
        if (observed.value.calendarId !== normalized.calendarId) {
          throw infrastructure('Feishu calendar read changed resource identity')
        }
        if (!calendarSelectable(observed.value)) return calendarNotSelectable()
        return this.options.repository.commitFeishuCalendarBinding(Object.freeze({
          projectId: normalized.projectId,
          intent: Object.freeze({ mode: 'existing' as const, calendarId: normalized.calendarId }),
          expectedConnectionRevision: normalized.expectedConnectionRevision,
          expectedRouteGeneration: normalized.expectedRouteGeneration,
          expectedBindingRevision: null,
          route: resolved.route,
          snapshot: observed.value,
          boundAt: occurredAt,
          command,
        }), operationSignal)
      }
      const effectId = generatedId(`effect-${commandId}`, 'Calendar effect')
      let reservation = await this.options.repository.reserveFeishuCalendarCreation(Object.freeze({
        effectId,
        projectId: normalized.projectId,
        intent: Object.freeze({
          mode: 'create' as const,
          summary: normalized.summary,
          description: normalized.description ?? null,
        }),
        expectedConnectionRevision: normalized.expectedConnectionRevision,
        expectedRouteGeneration: normalized.expectedRouteGeneration,
        expectedBindingRevision: null,
        route: resolved.route,
        preparedAt: occurredAt,
        command,
      }), operationSignal)
      if (reservation.state !== 'deliver') return reservation.result
      const reservedEffectId = reservation.effectId
      if (!await this.options.repository.claimFeishuCalendarEffect(
        reservedEffectId,
        commandInstant(this.options.clock),
        operationSignal,
      )) {
        reservation = await this.options.repository.reserveFeishuCalendarCreation(Object.freeze({
          effectId,
          projectId: normalized.projectId,
          intent: Object.freeze({
            mode: 'create' as const,
            summary: normalized.summary,
            description: normalized.description ?? null,
          }),
          expectedConnectionRevision: normalized.expectedConnectionRevision,
          expectedRouteGeneration: normalized.expectedRouteGeneration,
          expectedBindingRevision: null,
          route: resolved.route,
          preparedAt: occurredAt,
          command,
        }), operationSignal)
        if (reservation.state !== 'deliver') return reservation.result
        return calendarUnknownBinding(reservation.effect)
      }
      const settleSignal = new AbortController().signal
      try {
        const outcome = await adapter.createCalendar(
          reservation.route,
          Object.freeze({ summary: normalized.summary, description: normalized.description ?? null }),
          operationSignal,
        )
        const settledAt = commandInstant(this.options.clock)
        if (outcome.state === 'ok') {
          validateCalendarSnapshot(outcome.value)
          if (!calendarSelectable(outcome.value)) {
            return this.options.repository.settleFeishuCalendarBinding(reservedEffectId, Object.freeze({
              state: 'failed',
              issue: invalidCalendarIssue(),
              settledAt,
            }), settleSignal)
          }
          return this.options.repository.settleFeishuCalendarBinding(reservedEffectId, Object.freeze({
            state: 'delivered', calendar: outcome.value, settledAt,
          }), settleSignal)
        }
        return this.options.repository.settleFeishuCalendarBinding(reservedEffectId, Object.freeze({
          state: outcome.state === 'unknown' ? 'unknown' : 'failed',
          issue: outcome.issue,
          settledAt,
        }), settleSignal)
      } catch {
        return this.options.repository.settleFeishuCalendarBinding(reservedEffectId, Object.freeze({
          state: 'unknown',
          issue: ambiguousCalendarTransportIssue(),
          settledAt: commandInstant(this.options.clock),
        }), settleSignal)
      }
    })
  }

  /** Discover non-recurring event candidates on the immutable bound Calendar. */
  discoverFeishuCalendarEvents(
    request: DiscoverFeishuCalendarEventsRequest,
    signal: AbortSignal,
  ): Promise<FeishuCalendarEventDiscoveryProjection> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'discoverFeishuCalendarEvents')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.calendar.read',
        operationSignal,
      )
      const normalized = validateDiscoverFeishuCalendarEventsRequest(request)
      const current = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (current === null) throw badRequest('Project was not found', { field: 'projectId' })
      if (current.binding === null) throw unavailable('Project has no bound Calendar')
      if (current.revision !== normalized.expectedRevision) {
        throw unavailable('Project schedule revision changed before event discovery')
      }
      const target = await this.options.repository.readFeishuCalendarReconciliationTarget(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }),
        operationSignal,
      )
      if (target === null) throw infrastructure('Workbench Calendar target disappeared')
      const observed = await requiredCalendarAdapter(this.options.adapters).listCalendarEvents(
        target.route,
        target.calendarId,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (observed.state !== 'ok') throw unavailable('Feishu event discovery was rejected')
      const used = new Set(target.commitments.map(commitment => commitment.eventId))
      const seen = new Set<string>()
      const items = Object.freeze(observed.value.map((item) => {
        validateCalendarEventSnapshot(item)
        if (seen.has(item.eventId)) throw infrastructure('Feishu event discovery returned a duplicate')
        seen.add(item.eventId)
        return calendarEventCandidate(item, target.calendarId, !used.has(item.eventId))
      }))
      return Object.freeze({
        projectId: normalized.projectId,
        revision: current.revision,
        calendarId: target.calendarId,
        items,
      })
    })
  }

  /** Read the detached authoritative Milestone projection. */
  getProjectMilestones(
    query: ProjectMilestonesQuery,
    signal: AbortSignal,
  ): Promise<ProjectMilestonesProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'getProjectMilestones')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.calendar.read',
        operationSignal,
      )
      const normalized = validateProjectMilestonesQuery(query)
      const projection = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.calendar.read',
        projectMilestonesProjection(projection),
        operationSignal,
      )
    })
  }

  /** Read one Project's complete Deliverables workspace and authorized replay chain. */
  projectDeliverables(
    query: ProjectDeliverablesQuery,
    signal: AbortSignal,
  ): Promise<ProjectDeliverablesProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'projectDeliverables')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await requireIdenticalScopes(
        this.options.authorization,
        'workbench.project.deliverable.read',
        'workbench.project.deliverable.activity.read',
        operationSignal,
      )
      const normalized = validateProjectDeliverablesQuery(query)
      const projection = await this.options.repository.readProjectDeliverables(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
        ...(normalized.beforeActivitySequence === undefined
          ? {}
          : { beforeActivitySequence: normalized.beforeActivitySequence }),
        ...(normalized.activityLimit === undefined ? {} : { activityLimit: normalized.activityLimit }),
      }), operationSignal)
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.deliverable.read',
        projectDeliverablesProjection(projection),
        operationSignal,
      )
    })
  }

  /** Read the Risk register and its separately authorized replay in one projection. */
  projectRisks(
    query: ProjectRisksQuery,
    signal: AbortSignal,
  ): Promise<ProjectRisksProjection | null> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'projectRisks')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await requireIdenticalScopes(
        this.options.authorization,
        'workbench.project.risk.read',
        'workbench.project.risk.activity.read',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateProjectRisksQuery(query)
      const projection = await this.options.repository.readProjectRisks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        ...normalized,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (projection === null) return null
      return this.options.authorization.filterProjection(
        'workbench.project.risk.read',
        projectRisksProjection(projection),
        operationSignal,
      )
    })
  }

  /** Create one research Risk with a complete first assessment. */
  createProjectRisk(
    request: CreateProjectRiskRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectRiskResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'createProjectRisk')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.risk.write',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateCreateProjectRiskRequest(request)
      const replayQuery: WorkbenchProjectRiskReplayQuery = Object.freeze({
        mode: 'create',
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        assessment: normalized.assessment,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: null,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: 'owner-project-risk-create',
      })
      const replay = await this.options.repository.replayProjectRiskCommand(
        replayQuery,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (replay !== null) return replay as CreateProjectRiskResult
      const detail = await this.options.repository.readProject(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (detail === null) return projectRiskProjectMissing(normalized.projectId)
      const occurredAt = commandInstant(this.options.clock)
      const assessment = normalizedRiskAssessment(normalized.assessment, {
        assessedAt: occurredAt,
        projectTimezone: detail.project.timezone,
        previousTrigger: null,
      })
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const mutation: WorkbenchProjectRiskCreationMutation = Object.freeze({
        riskId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskId,
          `risk-${commandId}`,
          'Project Risk',
        ),
        assessmentId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskAssessmentId,
          `risk-assessment-${commandId}`,
          'Project Risk assessment',
        ),
        activityId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskActivityId,
          `risk-activity-${commandId}`,
          'Project Risk Activity',
        ),
        projectId: normalized.projectId,
        assessment,
        intent: normalized.assessment,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: null,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        command: projectRiskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          'owner-project-risk-create',
          occurredAt,
        ),
      })
      return this.options.repository.commitProjectRiskCreation(mutation, operationSignal)
    })
  }

  /** Append one complete immutable assessment replacement. */
  reviseProjectRisk(
    request: ReviseProjectRiskRequest,
    signal: AbortSignal,
  ): Promise<ReviseProjectRiskResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'reviseProjectRisk')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.risk.write',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateReviseProjectRiskRequest(request)
      const replayQuery: WorkbenchProjectRiskReplayQuery = Object.freeze({
        mode: 'revise',
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        riskId: normalized.riskId,
        assessment: normalized.assessment,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: normalized.expectedRiskRevision,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: 'owner-project-risk-revise',
      })
      const replay = await this.options.repository.replayProjectRiskCommand(
        replayQuery,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (replay !== null) return replay as ReviseProjectRiskResult
      const detail = await this.options.repository.readProject(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (detail === null) return projectRiskProjectMissing(normalized.projectId)
      const current = await this.options.repository.readProjectRisks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
        selectedRiskId: normalized.riskId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (current === null) return projectRiskProjectMissing(normalized.projectId)
      const risk = current.selectedRisk?.risk
      if (risk === undefined) return projectRiskFailure('risk-not-found', 'Project Risk was not found')
      if (risk.status === 'closed') return projectRiskFailure('risk-closed', 'Closed Project Risks are terminal')
      const occurredAt = commandInstant(this.options.clock)
      const assessment = normalizedRiskAssessment(normalized.assessment, {
        assessedAt: occurredAt,
        projectTimezone: detail.project.timezone,
        previousTrigger: risk.currentAssessment.trigger,
      })
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const mutation: WorkbenchProjectRiskRevisionMutation = Object.freeze({
        riskId: normalized.riskId,
        assessmentId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskAssessmentId,
          `risk-assessment-${commandId}`,
          'Project Risk assessment',
        ),
        activityId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskActivityId,
          `risk-activity-${commandId}`,
          'Project Risk Activity',
        ),
        projectId: normalized.projectId,
        assessment,
        intent: normalized.assessment,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: normalized.expectedRiskRevision,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        command: projectRiskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          'owner-project-risk-revise',
          occurredAt,
        ),
      })
      return this.options.repository.commitProjectRiskRevision(mutation, operationSignal)
    })
  }

  /** Append one explicit disposition transition; no task adapter is consulted. */
  transitionProjectRisk(
    request: TransitionProjectRiskRequest,
    signal: AbortSignal,
  ): Promise<TransitionProjectRiskResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'transitionProjectRisk')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require(
        'workbench.project.risk.write',
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      const normalized = validateTransitionProjectRiskRequest(request)
      const replayQuery: WorkbenchProjectRiskReplayQuery = Object.freeze({
        mode: 'transition',
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        riskId: normalized.riskId,
        transition: normalized.transition,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: normalized.expectedRiskRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: 'owner-project-risk-transition',
      })
      const replay = await this.options.repository.replayProjectRiskCommand(
        replayQuery,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (replay !== null) return replay as TransitionProjectRiskResult
      const detail = await this.options.repository.readProject(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (detail === null) return projectRiskProjectMissing(normalized.projectId)
      const current = await this.options.repository.readProjectRisks(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
        selectedRiskId: normalized.riskId,
      }), operationSignal)
      throwIfCancelled(operationSignal)
      if (current === null) return projectRiskProjectMissing(normalized.projectId)
      const risk = current.selectedRisk?.risk
      if (risk === undefined) return projectRiskFailure('risk-not-found', 'Project Risk was not found')
      if (risk.status === 'closed') return projectRiskFailure('risk-closed', 'Closed Project Risks are terminal')
      const occurredAt = commandInstant(this.options.clock)
      const availableMitigationTaskCount = risk.treatmentTasks.filter(
        link => link.role === 'mitigation' && link.availability === 'available',
      ).length
      let transition
      try {
        transition = normalizedRiskTransition(normalized.transition, {
          currentStatus: risk.status,
          currentNextReviewOn: risk.currentAssessment.nextReviewOn,
          availableMitigationTaskCount,
          occurredAt,
          projectTimezone: detail.project.timezone,
        })
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        if (error.message.includes('overdue')) {
          return projectRiskFailure('risk-review-overdue', 'Risk review is overdue')
        }
        if (error.message.includes('mitigation')) {
          return projectRiskFailure(
            'mitigation-task-required',
            'Mitigate requires an available mitigation task',
          )
        }
        return projectRiskFailure(
          'invalid-status-transition',
          'Project Risk status transition is not allowed',
        )
      }
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const mutation: WorkbenchProjectRiskTransitionMutation = Object.freeze({
        riskId: normalized.riskId,
        transitionId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskTransitionId,
          `risk-transition-${commandId}`,
          'Project Risk transition',
        ),
        activityId: nextDeliverableIdentity(
          this.options.ids.nextProjectRiskActivityId,
          `risk-activity-${commandId}`,
          'Project Risk Activity',
        ),
        projectId: normalized.projectId,
        transition,
        intent: normalized.transition,
        expectedRisksRevision: normalized.expectedRisksRevision,
        expectedRiskRevision: normalized.expectedRiskRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        command: projectRiskCommand(
          this.options.ids,
          commandId,
          scope,
          normalized.idempotencyKey,
          normalized.causationId,
          'owner-project-risk-transition',
          occurredAt,
        ),
      })
      return this.options.repository.commitProjectRiskTransition(mutation, operationSignal)
    })
  }

  /** Create one immutable Deliverable Plan and bind its formal Calendar event. */
  createProjectDeliverable(
    request: CreateProjectDeliverableRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectDeliverableResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'createProjectDeliverable')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.deliverable.write',
        operationSignal,
      )
      const normalized = validateCreateProjectDeliverableRequest(request)
      const replayQuery: WorkbenchProjectDeliverableReplayQuery = Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        name: normalized.name,
        description: normalized.description ?? null,
        criteria: Object.freeze(normalized.criteria.map(criterion => criterion.statement)),
        accountableMemberId: normalized.accountableMemberId,
        contributorMemberIds: normalized.contributorMemberIds,
        humanSponsorMemberId: normalized.humanSponsorMemberId,
        acceptorMemberId: normalized.acceptorMemberId,
        taskGuids: normalized.taskGuids,
        event: normalized.event,
        expectedDeliverablesRevision: normalized.expectedDeliverablesRevision,
        expectedDeliverableRevision: null,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        expectedScheduleRevision: normalized.expectedScheduleRevision,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      })
      const replay = await this.options.repository.replayProjectDeliverableCreation(
        replayQuery,
        operationSignal,
      )
      if (replay !== null) return replay
      const current = await this.options.repository.readProjectDeliverables(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = deliverableCreatePreflight(current, normalized)
      if (preflight !== null) return preflight
      if (current === null) throw infrastructure('Workbench Deliverable preflight lost its Project')
      const target = await this.options.repository.readFeishuCalendarReconciliationTarget(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }),
        operationSignal,
      )
      if (target === null) return deliverableConflict('calendar-unbound', 'Project has no bound Calendar')
      if (normalized.event.mode === 'existing-event'
        && target.commitments.some(item => item.eventId === normalized.event.eventId)) {
        return deliverableConflict('event-already-used', 'Calendar event already backs a commitment', current)
      }
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const deliverableId = nextDeliverableIdentity(
        this.options.ids.nextDeliverableId,
        `deliverable-${commandId}`,
        'Deliverable',
      )
      const planSnapshotId = nextDeliverableIdentity(
        this.options.ids.nextDeliverablePlanSnapshotId,
        `deliverable-plan-${commandId}`,
        'Deliverable Plan snapshot',
      )
      const criteria = Object.freeze(normalized.criteria.map((criterion, index) => Object.freeze({
        criterionId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableCriterionId,
          `criterion-${commandId}-${String(index + 1)}`,
          'Acceptance Criterion',
        ),
        statement: criterion.statement,
      })))
      const member = (memberId: string) => {
        const option = current.memberOptions.find(candidate => candidate.memberId === memberId)
        if (option === undefined) throw infrastructure('Workbench Deliverable member option disappeared')
        return Object.freeze({
          memberId: option.memberId,
          displayName: option.displayName,
          kind: option.kind,
        })
      }
      const responsibility = Object.freeze({
        accountable: member(normalized.accountableMemberId),
        contributors: Object.freeze(normalized.contributorMemberIds.map(member)),
        humanSponsor: normalized.humanSponsorMemberId === null
          ? null
          : member(normalized.humanSponsorMemberId),
        acceptor: member(normalized.acceptorMemberId),
      })
      const planWithoutDigest = Object.freeze({
        planSnapshotId,
        name: normalized.name,
        description: normalized.description ?? null,
        criteria,
        responsibility,
        taskGuids: normalized.taskGuids,
        createdAt: occurredAt,
      })
      const plan: DeliverablePlanProjection = Object.freeze({
        ...planWithoutDigest,
        digest: scenarioContentDigest(planWithoutDigest),
      })
      const command = Object.freeze({
        commandId,
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
        occurredAt,
      })
      const shared = Object.freeze({
        deliverableId,
        activityId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableActivityId,
          `deliverable-activity-${commandId}`,
          'Deliverable Activity',
        ),
        changeId: nextScheduleChangeId(this.options.ids, `${commandId}-created`),
        projectId: normalized.projectId,
        plan,
        memberIds: Object.freeze({
          accountableMemberId: normalized.accountableMemberId,
          contributorMemberIds: normalized.contributorMemberIds,
          humanSponsorMemberId: normalized.humanSponsorMemberId,
          acceptorMemberId: normalized.acceptorMemberId,
        }),
        expectedDeliverablesRevision: normalized.expectedDeliverablesRevision,
        expectedDeliverableRevision: null,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        expectedScheduleRevision: normalized.expectedScheduleRevision,
        createdAt: occurredAt,
        command,
      })
      const adapter = requiredCalendarAdapter(this.options.adapters)
      if (normalized.event.mode === 'existing-event') {
        const observed = await adapter.readCalendarEvent(
          target.route,
          target.calendarId,
          normalized.event.eventId,
          operationSignal,
        )
        throwIfCancelled(operationSignal)
        if (observed.state !== 'ok') {
          return deliverableConflict('remote-rejected', 'Feishu rejected the event observation', current, observed.issue)
        }
        validateCalendarEventSnapshot(observed.value)
        if (!eventSelectable(observed.value, target.calendarId)
          || observed.value.eventId !== normalized.event.eventId) {
          return deliverableConflict('event-not-selectable', 'Calendar event is not selectable', current)
        }
        const mutation: WorkbenchProjectDeliverableMutation = Object.freeze({
          ...shared,
          eventIntent: normalized.event,
          event: observed.value,
        })
        return this.options.repository.commitProjectDeliverable(mutation, operationSignal)
      }
      const effectId = generatedId(`effect-${commandId}`, 'Deliverable Calendar effect')
      const reservationMutation: WorkbenchDeliverableCalendarCreationReservationMutation =
        Object.freeze({
          ...shared,
          effectId,
          eventIntent: normalized.event,
          providerIdempotencyKey: calendarProviderIdempotencyKey(commandId, normalized.projectId),
          preparedAt: occurredAt,
        })
      let reservation = await this.options.repository.reserveDeliverableCalendarCreation(
        reservationMutation,
        operationSignal,
      )
      if (reservation.state !== 'deliver') return reservation.result
      if (!await this.options.repository.claimFeishuCalendarEffect(
        reservation.effectId,
        commandInstant(this.options.clock),
        operationSignal,
      )) {
        reservation = await this.options.repository.reserveDeliverableCalendarCreation(
          reservationMutation,
          operationSignal,
        )
        if (reservation.state !== 'deliver') return reservation.result
        return deliverableConflict(
          'remote-outcome-unknown',
          'Deliverable event creation outcome is unknown',
          current,
        )
      }
      const settleSignal = new AbortController().signal
      try {
        const outcome = await adapter.createCalendarEvent(
          reservation.route,
          Object.freeze({
            calendarId: reservation.calendarId,
            idempotencyKey: reservation.providerIdempotencyKey,
            summary: normalized.name,
            description: normalized.description ?? null,
            schedule: normalized.event.schedule,
          }),
          operationSignal,
        )
        const settledAt = commandInstant(this.options.clock)
        if (outcome.state === 'ok') {
          validateCalendarEventSnapshot(outcome.value)
          if (!eventSelectable(outcome.value, reservation.calendarId)) {
            return this.options.repository.settleDeliverableCalendarCreation(
              reservation.effectId,
              Object.freeze({ state: 'failed', issue: invalidCalendarIssue(), settledAt }),
              settleSignal,
            )
          }
          return this.options.repository.settleDeliverableCalendarCreation(
            reservation.effectId,
            Object.freeze({ state: 'delivered', event: outcome.value, settledAt }),
            settleSignal,
          )
        }
        return this.options.repository.settleDeliverableCalendarCreation(
          reservation.effectId,
          Object.freeze({
            state: outcome.state === 'unknown' ? 'unknown' : 'failed',
            issue: outcome.issue,
            settledAt,
          }),
          settleSignal,
        )
      } catch {
        return this.options.repository.settleDeliverableCalendarCreation(
          reservation.effectId,
          Object.freeze({
            state: 'unknown',
            issue: ambiguousCalendarTransportIssue(),
            settledAt: commandInstant(this.options.clock),
          }),
          settleSignal,
        )
      }
    })
  }

  /** Freeze one exact candidate-version set as a typed Acceptance Request. */
  requestDeliverableAcceptance(
    request: RequestDeliverableAcceptanceRequest,
    signal: AbortSignal,
  ): Promise<RequestDeliverableAcceptanceResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'requestDeliverableAcceptance')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.deliverable.write',
        operationSignal,
      )
      const normalized = validateRequestDeliverableAcceptanceRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const candidates = Object.freeze(normalized.candidateVersions.map((candidate) => {
        const referenceDigest = scenarioContentDigest(candidate)
        return Object.freeze({ ...candidate, referenceDigest, resolution: 'declared' as const })
      }))
      const mutation: WorkbenchDeliverableAcceptanceRequestMutation = Object.freeze({
        acceptanceRequestId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableAcceptanceRequestId,
          `acceptance-request-${commandId}`,
          'Acceptance Request',
        ),
        activityId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableActivityId,
          `deliverable-activity-${commandId}`,
          'Deliverable Activity',
        ),
        projectId: normalized.projectId,
        deliverableId: normalized.deliverableId,
        candidateVersions: candidates,
        candidatesDigest: scenarioContentDigest(candidates),
        expectedDeliverablesRevision: normalized.expectedDeliverablesRevision,
        expectedDeliverableRevision: normalized.expectedDeliverableRevision,
        expectedTeamRevision: normalized.expectedTeamRevision,
        expectedTaskRevision: normalized.expectedTaskRevision,
        expectedScheduleRevision: normalized.expectedScheduleRevision,
        expectedRemoteObservationVersion: normalized.expectedRemoteObservationVersion,
        createdAt: occurredAt,
        command: Object.freeze({
          commandId,
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
          occurredAt,
        }),
      })
      return this.options.repository.commitDeliverableAcceptanceRequest(mutation, operationSignal)
    })
  }

  /** Record one Owner decision under identical Review and Deliverable-accept scopes. */
  decideDeliverableAcceptance(
    request: DecideDeliverableAcceptanceRequest,
    signal: AbortSignal,
  ): Promise<DecideDeliverableAcceptanceResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'decideDeliverableAcceptance')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await requireIdenticalScopes(
        this.options.authorization,
        'workbench.review.decide',
        'workbench.project.deliverable.accept',
        operationSignal,
      )
      const normalized = validateDecideDeliverableAcceptanceRequest(request)
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const mutation: WorkbenchDeliverableAcceptanceDecisionMutation = Object.freeze({
        decisionId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableDecisionId,
          `acceptance-decision-${commandId}`,
          'Acceptance Decision',
        ),
        finalReleaseId: normalized.mode === 'approve'
          ? nextDeliverableIdentity(
              this.options.ids.nextDeliverableFinalReleaseId,
              `final-release-${commandId}`,
              'Final Release',
            )
          : null,
        activityId: nextDeliverableIdentity(
          this.options.ids.nextDeliverableActivityId,
          `deliverable-activity-${commandId}`,
          'Deliverable Activity',
        ),
        projectId: normalized.projectId,
        deliverableId: normalized.deliverableId,
        acceptanceRequestId: normalized.acceptanceRequestId,
        mode: normalized.mode,
        criteria: normalized.criteria,
        feedback: normalized.feedback,
        expectedDeliverablesRevision: normalized.expectedDeliverablesRevision,
        expectedDeliverableRevision: normalized.expectedDeliverableRevision,
        expectedAcceptanceRequestRevision: normalized.expectedAcceptanceRequestRevision,
        decidedAt: occurredAt,
        command: Object.freeze({
          commandId,
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
          occurredAt,
        }),
      })
      return this.options.repository.commitDeliverableAcceptanceDecision(mutation, operationSignal)
    })
  }

  /** Create Workbench Milestone semantics around one existing or newly created event. */
  createProjectMilestone(
    request: CreateProjectMilestoneRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectMilestoneResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'createProjectMilestone')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.milestone.write',
        operationSignal,
      )
      const normalized = validateCreateProjectMilestoneRequest(request)
      const description = normalized.description ?? null
      const intent: WorkbenchProjectMilestoneReplayQuery['intent'] = normalized.mode === 'existing-event'
        ? Object.freeze({ mode: 'existing-event', eventId: normalized.eventId })
        : Object.freeze({ mode: 'create-event', schedule: normalized.schedule })
      const replay = await this.options.repository.replayProjectMilestoneCreation(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        expectedRevision: normalized.expectedRevision,
        expectedMilestoneRevision: null,
        name: normalized.name,
        description,
        intent,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      }), operationSignal)
      if (replay !== null) return replay
      const current = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = milestoneCreationPreflight(current, normalized)
      if (preflight !== null) return preflight
      const target = await this.options.repository.readFeishuCalendarReconciliationTarget(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }),
        operationSignal,
      )
      if (target === null) throw infrastructure('Workbench Calendar target disappeared')
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const milestoneId = nextMilestoneId(this.options.ids, commandId)
      const changeId = nextScheduleChangeId(this.options.ids, `${commandId}-created`)
      const command = calendarCommand(
        this.options.ids,
        commandId,
        scope,
        normalized.idempotencyKey,
        normalized.causationId,
        normalized.reason,
        occurredAt,
      )
      const adapter = requiredCalendarAdapter(this.options.adapters)
      if (normalized.mode === 'existing-event') {
        const observed = await adapter.readCalendarEvent(
          target.route,
          target.calendarId,
          normalized.eventId,
          operationSignal,
        )
        throwIfCancelled(operationSignal)
        if (observed.state !== 'ok') return milestoneRemoteFailure('remote-rejected', observed.issue)
        validateCalendarEventSnapshot(observed.value)
        if (!eventSelectable(observed.value, target.calendarId)
          || observed.value.eventId !== normalized.eventId) return milestoneEventNotSelectable()
        return this.options.repository.commitProjectMilestone(Object.freeze({
          milestoneId,
          changeId,
          projectId: normalized.projectId,
          expectedRevision: normalized.expectedRevision,
          expectedMilestoneRevision: null,
          name: normalized.name,
          description,
          intent: Object.freeze({
            mode: 'existing-event' as const,
            eventId: normalized.eventId,
          }),
          event: observed.value,
          createdAt: occurredAt,
          command,
        }), operationSignal)
      }
      const effectId = generatedId(`effect-${commandId}`, 'Calendar effect')
      const providerIdempotencyKey = calendarProviderIdempotencyKey(commandId, normalized.projectId)
      let reservation = await this.options.repository.reserveFeishuCalendarEventCreation(
        Object.freeze({
          effectId,
          milestoneId,
          changeId,
          projectId: normalized.projectId,
          expectedRevision: normalized.expectedRevision,
          expectedMilestoneRevision: null,
          name: normalized.name,
          description,
          schedule: normalized.schedule,
          providerIdempotencyKey,
          preparedAt: occurredAt,
          command,
        }),
        operationSignal,
      )
      if (reservation.state !== 'deliver') return reservation.result
      const reservedEffectId = reservation.effectId
      if (!await this.options.repository.claimFeishuCalendarEffect(
        reservedEffectId,
        commandInstant(this.options.clock),
        operationSignal,
      )) {
        reservation = await this.options.repository.reserveFeishuCalendarEventCreation(
          Object.freeze({
            effectId,
            milestoneId,
            changeId,
            projectId: normalized.projectId,
            expectedRevision: normalized.expectedRevision,
            expectedMilestoneRevision: null,
            name: normalized.name,
            description,
            schedule: normalized.schedule,
            providerIdempotencyKey,
            preparedAt: occurredAt,
            command,
          }),
          operationSignal,
        )
        if (reservation.state !== 'deliver') return reservation.result
        return milestoneUnknownCreation(reservation.effect)
      }
      const settleSignal = new AbortController().signal
      try {
        const outcome = await adapter.createCalendarEvent(
          reservation.route,
          Object.freeze({
            calendarId: reservation.calendarId,
            idempotencyKey: reservation.providerIdempotencyKey,
            summary: normalized.name,
            description,
            schedule: normalized.schedule,
          }),
          operationSignal,
        )
        const settledAt = commandInstant(this.options.clock)
        if (outcome.state === 'ok') {
          validateCalendarEventSnapshot(outcome.value)
          if (!eventSelectable(outcome.value, reservation.calendarId)) {
            return this.options.repository.settleFeishuCalendarEventCreation(
              reservedEffectId,
              Object.freeze({ state: 'failed', issue: invalidCalendarIssue(), settledAt }),
              settleSignal,
            )
          }
          return this.options.repository.settleFeishuCalendarEventCreation(
            reservedEffectId,
            Object.freeze({ state: 'delivered', event: outcome.value, settledAt }),
            settleSignal,
          )
        }
        return this.options.repository.settleFeishuCalendarEventCreation(
          reservedEffectId,
          Object.freeze({
            state: outcome.state === 'unknown' ? 'unknown' : 'failed',
            issue: outcome.issue,
            settledAt,
          }),
          settleSignal,
        )
      } catch {
        return this.options.repository.settleFeishuCalendarEventCreation(
          reservedEffectId,
          Object.freeze({
            state: 'unknown',
            issue: ambiguousCalendarTransportIssue(),
            settledAt: commandInstant(this.options.clock),
          }),
          settleSignal,
        )
      }
    })
  }

  /** GET-before-reserve, claim once, PATCH dates only, and project only Feishu's response. */
  updateProjectMilestoneDate(
    request: UpdateProjectMilestoneDateRequest,
    signal: AbortSignal,
  ): Promise<UpdateProjectMilestoneDateResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'updateProjectMilestoneDate')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.milestone.write',
        operationSignal,
      )
      const normalized = validateUpdateProjectMilestoneDateRequest(request)
      const replay = await this.options.repository.replayFeishuCalendarDateUpdate(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        actorId: scope.ownerId,
        projectId: normalized.projectId,
        milestoneId: normalized.milestoneId,
        expectedRevision: normalized.expectedRevision,
        expectedMilestoneRevision: normalized.expectedMilestoneRevision,
        expectedRemoteObservationVersion: normalized.expectedRemoteObservationVersion,
        schedule: normalized.schedule,
        idempotencyKey: normalized.idempotencyKey,
        causationId: normalized.causationId,
        reason: normalized.reason,
      }), operationSignal)
      if (replay !== null) return replay
      const current = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = milestoneDatePreflight(current, normalized)
      if (preflight !== null) return preflight
      const target = await this.options.repository.readFeishuCalendarReconciliationTarget(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }),
        operationSignal,
      )
      if (target === null) throw infrastructure('Workbench Calendar target disappeared')
      const milestone = target.commitments.find(item =>
        item.kind === 'milestone' && item.targetId === normalized.milestoneId)
      if (milestone === undefined) return milestoneNotFound(normalized.milestoneId)
      const observed = await requiredCalendarAdapter(this.options.adapters).readCalendarEvent(
        target.route,
        target.calendarId,
        milestone.eventId,
        operationSignal,
      )
      throwIfCancelled(operationSignal)
      if (observed.state !== 'ok') return milestoneDateRemoteFailure('remote-rejected', observed.issue)
      validateCalendarEventSnapshot(observed.value)
      const occurredAt = commandInstant(this.options.clock)
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const effectId = generatedId(`effect-${commandId}`, 'Calendar effect')
      const command = calendarCommand(
        this.options.ids,
        commandId,
        scope,
        normalized.idempotencyKey,
        normalized.causationId,
        normalized.reason,
        occurredAt,
      )
      let reservation = await this.options.repository.reserveFeishuCalendarDateUpdate(
        Object.freeze({
          effectId,
          changeId: nextScheduleChangeId(this.options.ids, `${commandId}-preflight`),
          projectId: normalized.projectId,
          milestoneId: normalized.milestoneId,
          expectedRevision: normalized.expectedRevision,
          expectedMilestoneRevision: normalized.expectedMilestoneRevision,
          expectedRemoteObservationVersion: normalized.expectedRemoteObservationVersion,
          observed: observed.value,
          schedule: normalized.schedule,
          preparedAt: occurredAt,
          command,
        }),
        operationSignal,
      )
      if (reservation.state !== 'deliver') return reservation.result
      const reservedEffectId = reservation.effectId
      if (!await this.options.repository.claimFeishuCalendarEffect(
        reservedEffectId,
        commandInstant(this.options.clock),
        operationSignal,
      )) {
        reservation = await this.options.repository.reserveFeishuCalendarDateUpdate(
          Object.freeze({
            effectId,
            changeId: nextScheduleChangeId(this.options.ids, `${commandId}-recovered`),
            projectId: normalized.projectId,
            milestoneId: normalized.milestoneId,
            expectedRevision: normalized.expectedRevision,
            expectedMilestoneRevision: normalized.expectedMilestoneRevision,
            expectedRemoteObservationVersion: normalized.expectedRemoteObservationVersion,
            observed: observed.value,
            schedule: normalized.schedule,
            preparedAt: occurredAt,
            command,
          }),
          operationSignal,
        )
        if (reservation.state !== 'deliver') return reservation.result
        return milestoneDateUnknown(reservation.effect)
      }
      const adapter = requiredCalendarAdapter(this.options.adapters)
      const settleSignal = new AbortController().signal
      try {
        const outcome = await adapter.updateCalendarEventSchedule(
          reservation.route,
          Object.freeze({
            calendarId: reservation.calendarId,
            eventId: reservation.eventId,
            expectedRemoteObservationVersion: normalized.expectedRemoteObservationVersion,
            schedule: normalized.schedule,
          }),
          operationSignal,
        )
        const settledAt = commandInstant(this.options.clock)
        if (outcome.state === 'ok') {
          validateCalendarEventSnapshot(outcome.value)
          return this.options.repository.settleFeishuCalendarDateUpdate(
            reservedEffectId,
            Object.freeze({
              state: 'delivered',
              event: outcome.value,
              changeId: nextScheduleChangeId(this.options.ids, `${commandId}-delivered`),
              settledAt,
            }),
            settleSignal,
          )
        }
        if (outcome.state === 'conflict') {
          validateCalendarEventSnapshot(outcome.current)
          return this.options.repository.settleFeishuCalendarDateUpdate(
            reservedEffectId,
            Object.freeze({
              state: 'conflict',
              event: outcome.current,
              changeId: nextScheduleChangeId(this.options.ids, `${commandId}-conflict`),
              settledAt,
            }),
            settleSignal,
          )
        }
        return this.options.repository.settleFeishuCalendarDateUpdate(
          reservedEffectId,
          Object.freeze({
            state: outcome.state === 'unknown' ? 'unknown' : 'failed',
            issue: outcome.issue,
            settledAt,
          }),
          settleSignal,
        )
      } catch {
        return this.options.repository.settleFeishuCalendarDateUpdate(
          reservedEffectId,
          Object.freeze({
            state: 'unknown',
            issue: ambiguousCalendarTransportIssue(),
            settledAt: commandInstant(this.options.clock),
          }),
          settleSignal,
        )
      }
    })
  }

  /** Read every bound event and atomically converge changed authority tuples. */
  reconcileProjectCalendar(
    request: ReconcileProjectCalendarRequest,
    signal: AbortSignal,
  ): Promise<ReconcileProjectCalendarResult> {
    return this.execute(async (lifetimeSignal) => {
      requireSignal(signal, 'reconcileProjectCalendar')
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      const scope = await this.options.authorization.require(
        'workbench.project.calendar.reconcile',
        operationSignal,
      )
      const normalized = validateReconcileProjectCalendarRequest(request)
      const current = await this.options.repository.readProjectMilestones(Object.freeze({
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        projectId: normalized.projectId,
      }), operationSignal)
      const preflight = calendarReconciliationPreflight(current, normalized)
      if (preflight !== null) return preflight
      const target = await this.options.repository.readFeishuCalendarReconciliationTarget(
        Object.freeze({
          organizationId: scope.organizationId,
          teamId: scope.teamId,
          projectId: normalized.projectId,
        }),
        operationSignal,
      )
      if (target === null) throw infrastructure('Workbench Calendar target disappeared')
      return this.reconcileCalendarTarget(target, operationSignal)
    })
  }

  /** Trusted Calendar hint entrypoint; browser Remotes never call it. */
  ingestFeishuCalendarEvent(
    event: FeishuCalendarEventInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<FeishuCalendarEventResult> {
    return this.execute(async (lifetimeSignal) => {
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const normalized = validateFeishuCalendarEventInput(event)
      const accepted = await this.options.repository.commitFeishuCalendarEvent(Object.freeze({
        event: normalized,
        receivedAt: commandInstant(this.options.clock),
      }), operationSignal)
      if (accepted.outcome !== 'applied' || accepted.projectId === null) return accepted
      const targets = await this.options.repository.listFeishuCalendarReconciliationTargets(
        operationSignal,
      )
      const target = targets.find(candidate => candidate.projectId === accepted.projectId) ?? null
      if (target === null) return accepted
      const reconciled = await this.reconcileCalendarTarget(target, operationSignal)
      return Object.freeze({
        outcome: 'applied',
        projectId: accepted.projectId,
        revision: reconciled.ok ? reconciled.value.revision : accepted.revision,
      })
    })
  }

  /** Trusted connector entrypoint; it is intentionally not exposed as a Remote. */
  ingestFeishuTaskEvent(
    observation: WorkbenchFeishuTaskEventObservation,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<FeishuTaskEventResult> {
    return this.execute(async (lifetimeSignal) => {
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      return this.options.repository.commitFeishuTaskEvent(Object.freeze({
        event: observation.event,
        task: observation.task,
        receivedAt: commandInstant(this.options.clock),
      }), operationSignal)
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
    filter: ReviewCenterQuery,
    signal: AbortSignal,
  ): Promise<ReviewCenterResultProjection | null> {
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
      const normalized = validateReviewCenterQuery(filter)
      throwIfCancelled(operationSignal)
      let projection: ReviewCenterResultProjection | null
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
        isDeliverableAcceptanceReviewCenter(projection)
          ? deliverableAcceptanceReviewCenterProjection(projection)
          : reviewCenterProjection(projection),
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
      this.installTaskFederationLifecycle()
      this.installCalendarFederationLifecycle()
    } catch (error: unknown) {
      this.phase = 'closed'
      await this.options.repository.close().catch(() => undefined)
      throw error
    }
  }

  private async doClose(): Promise<void> {
    if (this.phase === 'closed') return
    this.phase = 'closing'
    if (this.taskReconciliationTimer !== undefined) {
      clearInterval(this.taskReconciliationTimer)
      this.taskReconciliationTimer = undefined
    }
    if (this.calendarReconciliationTimer !== undefined) {
      clearInterval(this.calendarReconciliationTimer)
      this.calendarReconciliationTimer = undefined
    }
    try {
      this.taskEventUnsubscribe?.()
    } finally {
      this.taskEventUnsubscribe = undefined
    }
    try {
      this.calendarEventUnsubscribe?.()
    } finally {
      this.calendarEventUnsubscribe = undefined
    }
    this.lifetime.abort(new Error('Workbench scenario is disposing'))
    await this.opening?.catch(() => undefined)
    await Promise.allSettled([...this.inFlight])
    try {
      await this.options.repository.close()
    } finally {
      this.phase = 'closed'
    }
  }

  private installTaskFederationLifecycle(): void {
    const adapter = this.options.adapters.feishuTasks
    if (adapter?.subscribeTaskEvents !== undefined) {
      this.taskEventUnsubscribe = adapter.subscribeTaskEvents(async (observation) => {
        await this.ingestFeishuTaskEvent(observation, this.lifetime.signal)
      })
    }
    const interval = this.options.taskReconciliationIntervalMs ?? 0
    if (adapter !== undefined && interval > 0) {
      this.taskReconciliationTimer = setInterval(() => {
        void this.runPeriodicTaskReconciliation().catch(() => undefined)
      }, interval)
      this.taskReconciliationTimer.unref?.()
    }
  }

  private installCalendarFederationLifecycle(): void {
    const adapter = this.options.adapters.feishuCalendars
    if (adapter?.subscribeCalendarChanges !== undefined) {
      this.calendarEventUnsubscribe = adapter.subscribeCalendarChanges(async (notification) => {
        await this.ingestFeishuCalendarEvent(Object.freeze({
          eventEnvelopeId: notification.eventEnvelopeId,
          calendarId: notification.calendarId,
          eventId: notification.eventId,
          occurredAt: notification.observedAt,
        }), this.lifetime.signal)
      })
    }
    const interval = this.options.calendarReconciliationIntervalMs ?? 0
    if (adapter !== undefined && interval > 0) {
      this.calendarReconciliationTimer = setInterval(() => {
        void this.runPeriodicCalendarReconciliation().catch(() => undefined)
      }, interval)
      this.calendarReconciliationTimer.unref?.()
    }
  }

  private async runPeriodicTaskReconciliation(): Promise<void> {
    if (this.periodicReconciliationRunning || this.phase !== 'running') return
    this.periodicReconciliationRunning = true
    try {
      await this.execute(async (signal) => {
        const targets = await this.options.repository.listFeishuTaskReconciliationTargets(signal)
        for (const target of targets) {
          throwIfCancelled(signal)
          await this.reconcileTaskTarget(target, signal)
        }
      })
    } finally {
      this.periodicReconciliationRunning = false
    }
  }

  private async runPeriodicCalendarReconciliation(): Promise<void> {
    if (this.periodicCalendarReconciliationRunning || this.phase !== 'running') return
    this.periodicCalendarReconciliationRunning = true
    try {
      await this.execute(async (signal) => {
        const targets = await this.options.repository.listFeishuCalendarReconciliationTargets(signal)
        for (const target of targets) {
          throwIfCancelled(signal)
          await this.reconcileCalendarTarget(target, signal)
        }
      })
    } finally {
      this.periodicCalendarReconciliationRunning = false
    }
  }

  private async reconcileTaskTarget(
    target: WorkbenchFeishuTaskReconciliationTarget,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult> {
    const observed = await requiredTaskAdapter(this.options.adapters).readTaskList(
      target.route,
      target.taskListGuid,
      signal,
    )
    const attemptedAt = commandInstant(this.options.clock)
    if (observed.state === 'ok') {
      if (observed.value.taskList.taskListGuid !== target.taskListGuid) {
        throw infrastructure('Feishu reconciliation changed task-list identity')
      }
      return this.options.repository.commitFeishuTaskReconciliation(Object.freeze({
        projectId: target.projectId,
        expectedRevision: target.revision,
        snapshot: observed.value,
        attemptedAt,
      }), signal)
    }
    return this.options.repository.commitFeishuTaskReconciliationFailure(Object.freeze({
      projectId: target.projectId,
      expectedRevision: target.revision,
      attemptedAt,
      issue: observed.issue,
    }), signal)
  }

  private async reconcileCalendarTarget(
    target: WorkbenchFeishuCalendarReconciliationTarget,
    signal: AbortSignal,
  ): Promise<ReconcileProjectCalendarResult> {
    const adapter = requiredCalendarAdapter(this.options.adapters)
    const observations: WorkbenchFeishuCalendarReconciliationMutation['observations'][number][] = []
    const attemptedAt = commandInstant(this.options.clock)
    for (const commitment of target.commitments) {
      throwIfCancelled(signal)
      const changeId = (outcome: string) => nextScheduleChangeId(
        this.options.ids,
        [
          target.projectId,
          commitment.kind,
          commitment.targetId,
          String(commitment.targetRevision),
          outcome,
        ].join('-'),
      )
      try {
        const observed = await adapter.readCalendarEvent(
          target.route,
          target.calendarId,
          commitment.eventId,
          signal,
        )
        throwIfCancelled(signal)
        if (observed.state !== 'ok') {
          observations.push(Object.freeze({
            eventId: commitment.eventId,
            issue: observed.issue,
            changeId: changeId(`failure-${observed.issue.code}`),
          }))
          continue
        }
        validateCalendarEventSnapshot(observed.value)
        if (observed.value.calendarId !== target.calendarId
          || observed.value.eventId !== commitment.eventId) {
          observations.push(Object.freeze({
            eventId: commitment.eventId,
            issue: invalidCalendarIssue(),
            changeId: changeId('invalid-identity'),
          }))
          continue
        }
        observations.push(Object.freeze({
          event: observed.value,
          changeId: changeId(`observed-${observed.value.remoteObservationVersion}`),
        }))
      } catch (error: unknown) {
        throwIfCancelled(signal)
        observations.push(Object.freeze({
          eventId: commitment.eventId,
          issue: invalidCalendarIssue(),
          changeId: changeId('invalid-response'),
        }))
      }
    }
    return this.options.repository.commitFeishuCalendarReconciliation(Object.freeze({
      projectId: target.projectId,
      expectedRevision: target.revision,
      observations: Object.freeze(observations),
      attemptedAt,
    }), signal)
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
const MAX_DELIVERABLE_NAME_LENGTH = 200
const MAX_DELIVERABLE_DESCRIPTION_LENGTH = 2_000
const MAX_DELIVERABLE_CRITERIA = 20
const MAX_DELIVERABLE_CRITERION_LENGTH = 2_000
const MAX_DELIVERABLE_CONTRIBUTORS = 20
const MAX_DELIVERABLE_TASKS = 50
const MAX_DELIVERABLE_CANDIDATES = 20
const MAX_DELIVERABLE_ARTIFACT_LABEL_LENGTH = 200
const MAX_DELIVERABLE_ARTIFACT_REFERENCE_LENGTH = 256
const MAX_DELIVERABLE_CANONICAL_URL_LENGTH = 2_048
const MAX_DELIVERABLE_FEEDBACK_LENGTH = 2_000
const TEXT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const MAX_FEISHU_RESOURCE_ID_LENGTH = 256

function feishuCredentialProjection(
  value: FeishuCredentialProjection,
  expectedRef: string,
): FeishuCredentialProjection {
  if (value.ref !== expectedRef || typeof value.configured !== 'boolean'
    || typeof value.writable !== 'boolean'
    || (value.source !== null && (typeof value.source !== 'string'
      || value.source.length < 1 || value.source.length > 64
      || TEXT_CONTROL_CHARACTER_PATTERN.test(value.source)))) {
    throw infrastructure('Workbench Feishu credential description is invalid')
  }
  return Object.freeze({
    ref: expectedRef,
    configured: value.configured,
    source: value.source,
    writable: value.writable,
  })
}

function validateConfigureFeishuIdentityRouteRequest(
  value: ConfigureFeishuIdentityRouteRequest,
): ConfigureFeishuIdentityRouteRequest {
  const record = exactRecord(value, 'configureFeishuIdentityRoute request', [
    'kind', 'mode', 'expectedConnectionRevision', 'expectedRouteGeneration',
    'idempotencyKey', 'causationId', 'reason',
  ], ['appId', 'credentialRef'])
  const common = {
    kind: validateFeishuKind(record.kind, 'kind'),
    expectedConnectionRevision: nonNegativeRevision(
      record.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration: nullablePositiveRevision(
      record.expectedRouteGeneration,
      'expectedRouteGeneration',
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
  }
  if (record.mode === 'set') {
    if (record.reason !== 'owner-feishu-route-configure') {
      throw badRequest('reason does not match set mode', { field: 'reason' })
    }
    const appId = safeId(record.appId, 'appId')
    if (typeof record.credentialRef !== 'string'
      || record.credentialRef.length > 128
      || !CREDENTIAL_REF_PATTERN.test(record.credentialRef)) {
      throw badRequest('credentialRef must be a DSH credential reference name', {
        field: 'credentialRef',
      })
    }
    return Object.freeze({
      ...common,
      mode: 'set',
      appId,
      credentialRef: record.credentialRef,
      reason: 'owner-feishu-route-configure',
    })
  }
  if (Object.hasOwn(record, 'appId') || Object.hasOwn(record, 'credentialRef')) {
    throw badRequest('reset/disable must not carry appId or credentialRef', { field: 'mode' })
  }
  if (record.mode === 'reset') {
    if (record.reason !== 'owner-feishu-route-reset') {
      throw badRequest('reason does not match reset mode', { field: 'reason' })
    }
    return Object.freeze({ ...common, mode: 'reset', reason: 'owner-feishu-route-reset' })
  }
  if (record.mode === 'disable') {
    if (record.reason !== 'owner-feishu-route-disable') {
      throw badRequest('reason does not match disable mode', { field: 'reason' })
    }
    return Object.freeze({ ...common, mode: 'disable', reason: 'owner-feishu-route-disable' })
  }
  throw badRequest('mode must be set, reset, or disable', { field: 'mode' })
}

function validateVerifyFeishuIdentityRouteRequest(
  value: VerifyFeishuIdentityRouteRequest,
): VerifyFeishuIdentityRouteRequest {
  const record = exactRecord(value, 'verifyFeishuIdentityRoute request', [
    'kind', 'expectedConnectionRevision', 'expectedRouteGeneration',
    'idempotencyKey', 'causationId', 'reason',
  ], ['resourceProbe'])
  if (record.reason !== 'owner-feishu-route-verify') {
    throw badRequest('reason is not supported for verification', { field: 'reason' })
  }
  const expectedRouteGeneration = positiveRevision(
    record.expectedRouteGeneration,
    'expectedRouteGeneration',
  )
  let resourceProbe: { readonly kind: 'task-list'; readonly resourceId: string } | undefined
  if (record.resourceProbe !== undefined) {
    const probe = exactRecord(record.resourceProbe, 'resourceProbe', ['kind', 'resourceId'])
    if (probe.kind !== 'task-list') {
      throw badRequest('resourceProbe.kind must be task-list', { field: 'resourceProbe.kind' })
    }
    if (typeof probe.resourceId !== 'string'
      || !SAFE_FEISHU_RESOURCE_ID.test(probe.resourceId)
      || probe.resourceId.length > MAX_FEISHU_RESOURCE_ID_LENGTH) {
      throw badRequest('resourceProbe.resourceId must be a safe identifier', {
        field: 'resourceProbe.resourceId',
      })
    }
    resourceProbe = Object.freeze({ kind: 'task-list', resourceId: probe.resourceId })
  }
  return Object.freeze({
    kind: validateFeishuKind(record.kind, 'kind'),
    expectedConnectionRevision: nonNegativeRevision(
      record.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    ...(resourceProbe === undefined ? {} : { resourceProbe }),
    reason: 'owner-feishu-route-verify',
  })
}

function validateFeishuKind(value: unknown, field: string): FeishuIdentityKind {
  if (value !== 'bot' && value !== 'user') {
    throw badRequest(`${field} must be bot or user`, { field })
  }
  return value
}

function nullablePositiveRevision(value: unknown, field: string): number | null {
  if (value === null) return null
  return positiveRevision(value, field)
}

function feishuIdentityContinuityIssue(
  kind: FeishuIdentityKind,
  appId: string,
  binding: FeishuActorBinding | null,
  actor: Omit<FeishuActorBinding, 'connectionId' | 'routeGeneration'>,
): FeishuConnectionIssue | null {
  if (actor.realm !== 'feishu-cn'
    || actor.kind !== kind
    || actor.appId !== appId
    || typeof actor.openId !== 'string'
    || !SAFE_FILTER_ID.test(actor.openId)
    || (actor.tenantKey !== null
      && (typeof actor.tenantKey !== 'string' || !SAFE_FILTER_ID.test(actor.tenantKey)))) {
    return feishuConnectionIssue('provider-response-invalid', 'inspect-provider')
  }
  if (binding === null) return null
  if (binding.appId !== actor.appId || binding.openId !== actor.openId) {
    return feishuConnectionIssue(
      'identity-continuity-mismatch',
      'reset-identity-binding',
    )
  }
  if (binding.tenantKey !== actor.tenantKey) {
    return feishuConnectionIssue('tenant-mismatch', 'reset-identity-binding')
  }
  return null
}

function feishuConnectionIssue(
  code: FeishuConnectionIssue['code'],
  recovery: FeishuConnectionIssue['recovery'],
): FeishuConnectionIssue {
  return Object.freeze({
    code,
    recovery,
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function failedFeishuVerificationObservation(
  issue: FeishuConnectionIssue,
): WorkbenchFeishuVerificationObservation {
  return Object.freeze({
    result: 'failed',
    identity: Object.freeze({ state: 'failed', issue }),
    actor: null,
    displayLabel: null,
    scopeInspection: Object.freeze({
      state: 'not-inspected',
      scopes: Object.freeze([]),
      issue: null,
    }),
    resourceProbe: Object.freeze({ state: 'not-tested' }),
  })
}

function verifiedFeishuVerificationObservation(
  session: WorkbenchFeishuVerifiedIdentitySession,
  capability: WorkbenchFeishuResourceVerificationObservation,
): WorkbenchFeishuVerificationObservation {
  return Object.freeze({
    result: capability.result,
    identity: Object.freeze({ state: 'verified', issue: null }),
    actor: Object.freeze({
      realm: session.actor.realm,
      appId: session.actor.appId,
      kind: session.actor.kind,
      openId: session.actor.openId,
      tenantKey: session.actor.tenantKey,
    }),
    displayLabel: session.displayLabel,
    scopeInspection: capability.scopeInspection,
    resourceProbe: capability.resourceProbe,
  })
}

function feishuVerifyConnectionConflict(
  expected: number,
  current: number,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'connection-revision-conflict',
      message: 'Workbench Feishu connection revision changed',
      expectedConnectionRevision: expected,
      currentConnectionRevision: current,
    }),
  })
}

function feishuVerifyGenerationConflict(
  kind: FeishuIdentityKind,
  expected: number,
  current: number,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'route-generation-conflict',
      message: 'Workbench Feishu route generation changed',
      kind,
      expectedRouteGeneration: expected,
      currentRouteGeneration: current,
    }),
  })
}

function feishuVerifyRouteState(
  code: 'route-unconfigured' | 'route-disabled',
  kind: FeishuIdentityKind,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message: code === 'route-disabled'
        ? 'Workbench Feishu route is disabled'
        : 'Workbench Feishu route is not configured',
      kind,
    }),
  })
}

const SAFE_FEISHU_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u

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

function validateReviewCenterQuery(value: ReviewCenterQuery): ReviewCenterQuery {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && Reflect.get(value, 'reviewKind') === 'deliverable-acceptance') {
    const record = exactRecord(value, 'reviewCenter filter', ['reviewKind', 'projectId'], [
      'status', 'beforeSequence', 'limit',
    ])
    const status = record.status
    if (status !== undefined && status !== 'pending' && status !== 'approved'
      && status !== 'rejected' && status !== 'needs_changes' && status !== 'stale') {
      throw badRequest('status is not supported for Deliverable Acceptance', { field: 'status' })
    }
    const beforeSequence = record.beforeSequence === undefined
      ? undefined
      : positiveRevision(record.beforeSequence, 'beforeSequence')
    const requestedLimit = record.limit
    if (requestedLimit !== undefined
      && (!Number.isSafeInteger(requestedLimit) || (requestedLimit as number) < 1
        || (requestedLimit as number) > MAX_REVIEW_CENTER_LIMIT)) {
      throw badRequest(`limit must be an integer from 1 to ${MAX_REVIEW_CENTER_LIMIT}`, {
        field: 'limit',
      })
    }
    return Object.freeze({
      reviewKind: 'deliverable-acceptance',
      projectId: safeId(record.projectId, 'projectId'),
      ...(status === undefined ? {} : {
        status: status as Exclude<DeliverableAcceptanceReviewCenterFilter['status'], undefined>,
      }),
      ...(beforeSequence === undefined ? {} : { beforeSequence }),
      limit: requestedLimit === undefined ? DEFAULT_REVIEW_CENTER_LIMIT : requestedLimit as number,
    })
  }
  return validateReviewCenterFilter(value as ReviewCenterFilter)
}

function isDeliverableAcceptanceReviewCenter(
  value: ReviewCenterResultProjection,
): value is DeliverableAcceptanceReviewCenterProjection {
  return Reflect.get(value, 'reviewKind') === 'deliverable-acceptance'
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
    && objectType !== 'suggested-change'
    && objectType !== 'feishu-connection'
    && objectType !== 'feishu-task-list-binding'
    && objectType !== 'feishu-task'
    && objectType !== 'feishu-task-workflow'
    && objectType !== 'project-calendar-binding'
    && objectType !== 'project-milestone') {
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
    && action !== 'workbench.suggested-change.deferred'
    && action !== 'workbench.feishu-route.configured'
    && action !== 'workbench.feishu-route.reset'
    && action !== 'workbench.feishu-route.disabled'
    && action !== 'workbench.feishu-route.verification-recorded'
    && action !== 'workbench.feishu-task-list.bound'
    && action !== 'workbench.feishu-task.referenced'
    && action !== 'workbench.feishu-task.update-requested'
    && action !== 'workbench.feishu-task-workflow.configured'
    && action !== 'workbench.project-calendar.bound'
    && action !== 'workbench.project-milestone.created'
    && action !== 'workbench.project-milestone.date-update-requested') {
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

const MAX_FEISHU_TASK_LIST_NAME_LENGTH = 100
const MAX_FEISHU_TASK_TEXT_LENGTH = 3_000

function validateProjectTasksQuery(value: ProjectTasksQuery): ProjectTasksQuery {
  const record = exactRecord(value, 'projectTasks query', ['projectId'])
  return Object.freeze({ projectId: safeId(record.projectId, 'projectId') })
}

function validateDiscoverFeishuTaskListsRequest(
  value: DiscoverFeishuTaskListsRequest,
): DiscoverFeishuTaskListsRequest {
  const record = exactRecord(value, 'discoverFeishuTaskLists request', [
    'projectId', 'kind', 'expectedConnectionRevision', 'expectedRouteGeneration',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    kind: taskIdentityKind(record.kind),
    expectedConnectionRevision: nonNegativeRevision(
      record.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration: positiveRevision(
      record.expectedRouteGeneration,
      'expectedRouteGeneration',
    ),
  })
}

function validateDiscoverFeishuTaskWorkflowFieldsRequest(
  value: DiscoverFeishuTaskWorkflowFieldsRequest,
): DiscoverFeishuTaskWorkflowFieldsRequest {
  const record = exactRecord(value, 'discoverFeishuTaskWorkflowFields request', [
    'projectId', 'expectedTaskRevision',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedTaskRevision: positiveRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
  })
}

function validatePreviewFeishuTaskWorkflowRequest(
  value: PreviewFeishuTaskWorkflowRequest,
): PreviewFeishuTaskWorkflowRequest {
  const record = exactRecord(value, 'previewFeishuTaskWorkflow request', [
    'projectId', 'expectedTaskRevision', 'expectedWorkflowRevision', 'definition', 'mapping',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedTaskRevision: positiveRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    expectedWorkflowRevision: nullablePositiveRevision(
      record.expectedWorkflowRevision,
      'expectedWorkflowRevision',
    ),
    definition: validateProjectTaskWorkflowDefinition(record.definition),
    mapping: validateConfigureFeishuTaskWorkflowMapping(record.mapping),
  })
}

function validateConfigureFeishuTaskWorkflowRequest(
  value: ConfigureFeishuTaskWorkflowRequest,
): ConfigureFeishuTaskWorkflowRequest {
  const record = exactRecord(value, 'configureFeishuTaskWorkflow request', [
    'projectId', 'expectedTaskRevision', 'expectedWorkflowRevision', 'definition', 'mapping',
    'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.reason !== 'owner-feishu-task-workflow-configure') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedTaskRevision: positiveRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    expectedWorkflowRevision: nullablePositiveRevision(
      record.expectedWorkflowRevision,
      'expectedWorkflowRevision',
    ),
    definition: validateProjectTaskWorkflowDefinition(record.definition),
    mapping: validateConfigureFeishuTaskWorkflowMapping(record.mapping),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-feishu-task-workflow-configure',
  })
}

function validateProjectTaskWorkflowDefinition(value: unknown): ProjectTaskWorkflowDefinition {
  const record = exactRecord(value, 'workflow definition', [
    'fieldName', 'initialStateId', 'terminalStateIds', 'states',
  ])
  if (!Array.isArray(record.states)) {
    throw badRequest('workflow definition states must be an array', { field: 'definition.states' })
  }
  if (!Array.isArray(record.terminalStateIds)) {
    throw badRequest('workflow terminalStateIds must be an array', {
      field: 'definition.terminalStateIds',
    })
  }
  const definition = {
    fieldName: record.fieldName,
    initialStateId: record.initialStateId,
    terminalStateIds: record.terminalStateIds.map((stateId, index) => {
      if (typeof stateId !== 'string') {
        throw badRequest('workflow terminal state id must be a string', {
          field: `definition.terminalStateIds[${String(index)}]`,
        })
      }
      return stateId
    }),
    states: record.states.map((candidate, index) => {
      const state = exactRecord(candidate, `workflow state ${String(index + 1)}`, [
        'stateId', 'name', 'colorIndex', 'allowedNextStateIds',
      ])
      if (!Array.isArray(state.allowedNextStateIds)) {
        throw badRequest('workflow state allowedNextStateIds must be an array', {
          field: `definition.states[${String(index)}].allowedNextStateIds`,
        })
      }
      return {
        stateId: state.stateId,
        name: state.name,
        colorIndex: state.colorIndex,
        allowedNextStateIds: state.allowedNextStateIds.map((target, targetIndex) => {
          if (typeof target !== 'string') {
            throw badRequest('workflow transition target must be a string', {
              field: `definition.states[${String(index)}].allowedNextStateIds[${String(targetIndex)}]`,
            })
          }
          return target
        }),
      }
    }),
  } as ProjectTaskWorkflowDefinition
  try {
    return projectTaskWorkflowDefinition(definition)
  } catch (error: unknown) {
    throw badRequest(error instanceof Error ? error.message : 'workflow definition is invalid', {
      field: 'definition',
    })
  }
}

function validateConfigureFeishuTaskWorkflowMapping(
  value: unknown,
): ConfigureFeishuTaskWorkflowMapping {
  const preliminary = exactRecord(value, 'workflow mapping', ['mode'], [
    'fieldGuid', 'options',
  ])
  if (preliminary.mode === 'create') {
    exactRecord(value, 'create workflow mapping', ['mode'])
    return Object.freeze({ mode: 'create' })
  }
  if (preliminary.mode === 'migrate') {
    exactRecord(value, 'migrate workflow mapping', ['mode'])
    return Object.freeze({ mode: 'migrate' })
  }
  if (preliminary.mode !== 'existing') {
    throw badRequest('workflow mapping mode is unsupported', { field: 'mapping.mode' })
  }
  const record = exactRecord(value, 'existing workflow mapping', [
    'mode', 'fieldGuid', 'options',
  ])
  if (!Array.isArray(record.options) || record.options.length < 2 || record.options.length > 100) {
    throw badRequest('workflow option mapping must contain 2-100 items', {
      field: 'mapping.options',
    })
  }
  return Object.freeze({
    mode: 'existing',
    fieldGuid: safeFeishuResourceId(record.fieldGuid, 'mapping.fieldGuid'),
    options: Object.freeze(record.options.map((candidate, index) => {
      const option = exactRecord(candidate, `workflow mapping option ${String(index + 1)}`, [
        'stateId', 'optionGuid',
      ])
      return Object.freeze({
        stateId: safeWorkflowStateId(option.stateId, `mapping.options[${String(index)}].stateId`),
        optionGuid: safeFeishuResourceId(
          option.optionGuid,
          `mapping.options[${String(index)}].optionGuid`,
        ),
      })
    })),
  })
}

function validateBindFeishuTaskListRequest(
  value: BindFeishuTaskListRequest,
): BindFeishuTaskListRequest {
  const base = [
    'projectId', 'kind', 'mode', 'expectedConnectionRevision',
    'expectedRouteGeneration', 'expectedBindingRevision', 'idempotencyKey',
    'causationId', 'reason',
  ]
  const preliminary = exactRecord(value, 'bindFeishuTaskList request', base, [
    'taskListGuid', 'name',
  ])
  if (preliminary.reason !== 'owner-feishu-task-list-bind') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  if (preliminary.expectedBindingRevision !== null) {
    throw badRequest('expectedBindingRevision must be null', { field: 'expectedBindingRevision' })
  }
  const common = {
    projectId: safeId(preliminary.projectId, 'projectId'),
    kind: taskIdentityKind(preliminary.kind),
    expectedConnectionRevision: nonNegativeRevision(
      preliminary.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration: positiveRevision(
      preliminary.expectedRouteGeneration,
      'expectedRouteGeneration',
    ),
    expectedBindingRevision: null,
    idempotencyKey: validateCommandKey(preliminary.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(preliminary.causationId, 'causationId'),
    reason: 'owner-feishu-task-list-bind' as const,
  }
  if (preliminary.mode === 'existing') {
    exactRecord(value, 'bindFeishuTaskList existing request', [...base, 'taskListGuid'])
    return Object.freeze({
      ...common,
      mode: 'existing',
      taskListGuid: safeFeishuResourceId(preliminary.taskListGuid, 'taskListGuid'),
    })
  }
  if (preliminary.mode === 'create') {
    exactRecord(value, 'bindFeishuTaskList create request', [...base, 'name'])
    return Object.freeze({
      ...common,
      mode: 'create',
      name: boundedText(preliminary.name, 'name', MAX_FEISHU_TASK_LIST_NAME_LENGTH),
    })
  }
  throw badRequest('mode must be existing or create', { field: 'mode' })
}

function validateReconcileProjectTasksRequest(
  value: ReconcileProjectTasksRequest,
): ReconcileProjectTasksRequest {
  const record = exactRecord(value, 'reconcileProjectTasks request', [
    'projectId', 'expectedRevision',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
  })
}

function validateReferenceFeishuTaskRequest(
  value: ReferenceFeishuTaskRequest,
): ReferenceFeishuTaskRequest {
  const record = exactRecord(value, 'referenceFeishuTask request', [
    'projectId', 'taskGuid', 'expectedRevision', 'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.reason !== 'owner-feishu-task-reference') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    taskGuid: safeFeishuResourceId(record.taskGuid, 'taskGuid'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-feishu-task-reference',
  })
}

function validateUpdateFeishuTaskRequest(
  value: UpdateFeishuTaskRequest,
): UpdateFeishuTaskRequest {
  const record = exactRecord(value, 'updateFeishuTask request', [
    'projectId', 'taskGuid', 'expectedRevision', 'expectedRemoteVersion',
    'changes', 'idempotencyKey', 'causationId', 'reason',
  ], ['expectedWorkflowRevision'])
  if (record.reason !== 'owner-feishu-task-update') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  const changesRecord = exactRecord(record.changes, 'changes', [], [
    'summary', 'description', 'completed', 'workflowStateId',
  ])
  if (Object.keys(changesRecord).length < 1) {
    throw badRequest('changes must contain at least one field', { field: 'changes' })
  }
  const changes = Object.freeze({
    ...(Object.hasOwn(changesRecord, 'summary') ? {
      summary: boundedText(changesRecord.summary, 'changes.summary', MAX_FEISHU_TASK_TEXT_LENGTH),
    } : {}),
    ...(Object.hasOwn(changesRecord, 'description') ? {
      description: boundedTaskDescription(changesRecord.description, 'changes.description'),
    } : {}),
    ...(Object.hasOwn(changesRecord, 'completed') ? {
      completed: booleanField(changesRecord.completed, 'changes.completed'),
    } : {}),
    ...(Object.hasOwn(changesRecord, 'workflowStateId') ? {
      workflowStateId: safeWorkflowStateId(
        changesRecord.workflowStateId,
        'changes.workflowStateId',
      ),
    } : {}),
  })
  const expectedWorkflowRevision = record.expectedWorkflowRevision
  if (Object.hasOwn(changesRecord, 'workflowStateId')) {
    if (expectedWorkflowRevision === undefined) {
      throw badRequest('expectedWorkflowRevision is required for a workflow state change', {
        field: 'expectedWorkflowRevision',
      })
    }
  } else if (expectedWorkflowRevision !== undefined) {
    throw badRequest('expectedWorkflowRevision requires changes.workflowStateId', {
      field: 'expectedWorkflowRevision',
    })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    taskGuid: safeFeishuResourceId(record.taskGuid, 'taskGuid'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
    expectedRemoteVersion: boundedRemoteVersion(
      record.expectedRemoteVersion,
      'expectedRemoteVersion',
    ),
    ...(expectedWorkflowRevision === undefined ? {} : {
      expectedWorkflowRevision: positiveRevision(
        expectedWorkflowRevision,
        'expectedWorkflowRevision',
      ),
    }),
    changes,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-feishu-task-update',
  })
}

function taskIdentityKind(value: unknown): FeishuIdentityKind {
  if (value !== 'bot' && value !== 'user') {
    throw badRequest('kind must be bot or user', { field: 'kind' })
  }
  return value
}

function safeFeishuResourceId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_FEISHU_RESOURCE_ID.test(value)) {
    throw badRequest(`${field} must be a safe Feishu identifier`, { field })
  }
  return value
}

function safeWorkflowStateId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value)) {
    throw badRequest(`${field} must be a lowercase stable identifier`, { field })
  }
  return value
}

function boundedRemoteVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64
    || !value.isWellFormed() || TEXT_CONTROL_CHARACTER_PATTERN.test(value)) {
    throw badRequest(`${field} must be a bounded remote version`, { field })
  }
  return value
}

function boundedTaskDescription(value: unknown, field: string): string {
  if (typeof value !== 'string' || [...value].length > MAX_FEISHU_TASK_TEXT_LENGTH
    || !value.isWellFormed() || TEXT_CONTROL_CHARACTER_PATTERN.test(value)) {
    throw badRequest(`${field} must contain at most ${MAX_FEISHU_TASK_TEXT_LENGTH} safe characters`, {
      field,
    })
  }
  return value
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be boolean`, { field })
  return value
}

type StoredFeishuConnection = Awaited<ReturnType<WorkbenchRepository['readFeishuConnection']>>

function resolveTaskRouteForBinding(
  stored: StoredFeishuConnection,
  request: Pick<
    DiscoverFeishuTaskListsRequest,
    'kind' | 'expectedConnectionRevision' | 'expectedRouteGeneration'
  >,
):
  | { readonly ok: true; readonly route: WorkbenchFeishuTaskRoute }
  | {
    readonly ok: false
    readonly error: Extract<BindFeishuTaskListResult, { readonly ok: false }>
  } {
  if (stored.revision !== request.expectedConnectionRevision) {
    return {
      ok: false,
      error: Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'connection-revision-conflict',
          message: 'Feishu connection changed before task-list access',
          expectedConnectionRevision: request.expectedConnectionRevision,
          currentConnectionRevision: stored.revision,
        }),
      }),
    }
  }
  const selected = request.kind === 'bot' ? stored.bot : stored.user
  if (selected.generation === null) {
    return {
      ok: false,
      error: Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'route-unconfigured',
          message: `Feishu ${request.kind} route is not configured`,
          kind: request.kind,
        }),
      }),
    }
  }
  if (selected.generation !== request.expectedRouteGeneration) {
    return {
      ok: false,
      error: Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'route-generation-conflict',
          message: 'Feishu route generation changed before task-list access',
          kind: request.kind,
          expectedRouteGeneration: request.expectedRouteGeneration,
          currentRouteGeneration: selected.generation,
        }),
      }),
    }
  }
  if (selected.state === 'disabled') {
    return {
      ok: false,
      error: Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'route-disabled',
          message: `Feishu ${request.kind} route is disabled`,
          kind: request.kind,
        }),
      }),
    }
  }
  if (selected.actor === null) {
    return {
      ok: false,
      error: Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'route-unverified',
          message: `Feishu ${request.kind} route is not identity-verified`,
          kind: request.kind,
        }),
      }),
    }
  }
  if (selected.appId === null || selected.credentialRef === null) {
    throw infrastructure('Workbench Feishu route projection is incomplete')
  }
  return {
    ok: true,
    route: Object.freeze({
      kind: request.kind,
      routeGeneration: selected.generation,
      appId: selected.appId,
      credentialRef: selected.credentialRef,
      actor: Object.freeze({ ...selected.actor }),
    }),
  }
}

function requiredTaskAdapter(adapters: WorkbenchExternalAdapters): WorkbenchFeishuTaskExternalAdapter {
  if (adapters.feishuTasks === undefined) {
    throw unavailable('Workbench Feishu task adapter is not available')
  }
  return adapters.feishuTasks
}

async function listWorkflowFields(
  adapter: WorkbenchFeishuTaskExternalAdapter,
  route: WorkbenchFeishuTaskRoute,
  taskListGuid: string,
  signal: AbortSignal,
): Promise<readonly FeishuTaskWorkflowFieldCandidate[]> {
  if (adapter.listTaskWorkflowFields === undefined) {
    throw unavailable('Workbench Feishu task adapter does not support workflow fields')
  }
  const outcome = await adapter.listTaskWorkflowFields(route, taskListGuid, signal)
  throwIfCancelled(signal)
  if (outcome.state !== 'ok') {
    throw unavailable('Feishu workflow-field discovery was rejected')
  }
  try {
    const fieldGuids = new Set<string>()
    return Object.freeze(outcome.value.map((field, fieldIndex) => {
      if (typeof field.fieldGuid !== 'string' || !SAFE_FEISHU_RESOURCE_ID.test(field.fieldGuid)
        || fieldGuids.has(field.fieldGuid)
        || typeof field.name !== 'string' || field.name.length < 1 || field.name.length > 50
        || typeof field.type !== 'string' || field.type.length < 1 || field.type.length > 64
        || typeof field.remoteVersion !== 'string' || field.remoteVersion.length < 1
        || field.remoteVersion.length > 64 || !Array.isArray(field.options)
        || field.options.length > 100) {
        throw new TypeError(`invalid workflow field ${String(fieldIndex)}`)
      }
      fieldGuids.add(field.fieldGuid)
      const optionGuids = new Set<string>()
      const options = Object.freeze(field.options.map((option, optionIndex) => {
        if (typeof option.optionGuid !== 'string'
          || !SAFE_FEISHU_RESOURCE_ID.test(option.optionGuid)
          || optionGuids.has(option.optionGuid)
          || typeof option.name !== 'string' || option.name.length < 1 || option.name.length > 50
          || !Number.isInteger(option.colorIndex) || option.colorIndex < 0 || option.colorIndex > 54
          || typeof option.hidden !== 'boolean') {
          throw new TypeError(`invalid workflow option ${String(optionIndex)}`)
        }
        optionGuids.add(option.optionGuid)
        return Object.freeze({ ...option })
      }))
      return Object.freeze({
        fieldGuid: field.fieldGuid,
        name: field.name,
        type: field.type,
        remoteVersion: field.remoteVersion,
        options,
      })
    }))
  } catch (error: unknown) {
    throw infrastructure('Feishu workflow-field response was invalid', error)
  }
}

function requiredWorkflowFieldCreate(adapter: WorkbenchFeishuTaskExternalAdapter): NonNullable<
  WorkbenchFeishuTaskExternalAdapter['createTaskWorkflowField']
> {
  if (adapter.createTaskWorkflowField === undefined) {
    throw unavailable('Workbench Feishu task adapter cannot create workflow fields')
  }
  return adapter.createTaskWorkflowField.bind(adapter)
}

function requiredWorkflowFieldUpdate(adapter: WorkbenchFeishuTaskExternalAdapter): NonNullable<
  WorkbenchFeishuTaskExternalAdapter['updateTaskWorkflowField']
> {
  if (adapter.updateTaskWorkflowField === undefined) {
    throw unavailable('Workbench Feishu task adapter cannot update workflow fields')
  }
  return adapter.updateTaskWorkflowField.bind(adapter)
}

function workflowContextForRead(
  context: WorkbenchFeishuTaskWorkflowContext | null,
  expectedTaskRevision: number,
): WorkbenchFeishuTaskWorkflowContext {
  if (context === null) {
    throw badRequest('Project was not found or has no primary task list', { field: 'projectId' })
  }
  if (context.project.revision !== expectedTaskRevision) {
    throw badRequest('Project task projection changed', { field: 'expectedTaskRevision' })
  }
  return context
}

function workflowContextForPreview(
  context: WorkbenchFeishuTaskWorkflowContext | null,
  expectedTaskRevision: number,
  expectedWorkflowRevision: number | null,
): WorkbenchFeishuTaskWorkflowContext {
  const ready = workflowContextForRead(context, expectedTaskRevision)
  if ((ready.project.workflow?.revision ?? null) !== expectedWorkflowRevision) {
    throw badRequest('Project task workflow changed', { field: 'expectedWorkflowRevision' })
  }
  return ready
}

function workflowProjectPreflight(
  project: ProjectTasksProjection | null,
  request: Pick<
    ConfigureFeishuTaskWorkflowRequest,
    'projectId' | 'expectedTaskRevision' | 'expectedWorkflowRevision'
  >,
): ConfigureFeishuTaskWorkflowResult | null {
  if (project === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'project-not-found',
        message: `Workbench Project ${request.projectId} was not found in the authorized scope`,
        projectId: request.projectId,
      }),
    })
  }
  if (project.binding === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({ code: 'task-list-unbound', message: 'Project has no primary task list' }),
    })
  }
  if (project.revision !== request.expectedTaskRevision) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'task-projection-revision-conflict',
        message: 'Project task projection changed before workflow configuration',
        expectedRevision: request.expectedTaskRevision,
        currentRevision: project.revision,
      }),
    })
  }
  if ((project.workflow?.revision ?? null) !== request.expectedWorkflowRevision) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'workflow-revision-conflict',
        message: 'Project task workflow changed before configuration',
      }),
    })
  }
  return null
}

function workflowConfigurationPreflight(
  context: WorkbenchFeishuTaskWorkflowContext,
  request: ConfigureFeishuTaskWorkflowRequest,
):
  | { readonly ok: true; readonly context: WorkbenchFeishuTaskWorkflowContext }
  | { readonly ok: false; readonly result: ConfigureFeishuTaskWorkflowResult } {
  const conflict = workflowProjectPreflight(context.project, request)
  return conflict === null
    ? Object.freeze({ ok: true, context })
    : Object.freeze({ ok: false, result: conflict })
}

function mappedWorkflowFieldFromExisting(
  definition: ProjectTaskWorkflowDefinition,
  mapping: Extract<ConfigureFeishuTaskWorkflowMapping, { readonly mode: 'existing' }>,
  field: FeishuTaskWorkflowFieldCandidate,
): WorkbenchFeishuTaskWorkflowMappedField {
  if (field.type !== 'single_select') throw infrastructure('Mapped workflow field type changed')
  const mappedByState = new Map(mapping.options.map(option => [option.stateId, option.optionGuid]))
  return Object.freeze({
    fieldGuid: field.fieldGuid,
    name: field.name,
    remoteVersion: field.remoteVersion,
    options: Object.freeze(definition.states.map((state) => {
      const optionGuid = mappedByState.get(state.stateId)
      const option = field.options.find(candidate => candidate.optionGuid === optionGuid)
      if (option === undefined) throw infrastructure('Mapped workflow option disappeared')
      return Object.freeze({ stateId: state.stateId, ...option })
    })),
  })
}

function mappedWorkflowFieldFromWrite(
  definition: ProjectTaskWorkflowDefinition,
  field: WorkbenchFeishuTaskWorkflowFieldWrite,
  current: ProjectTaskWorkflowProjection | null = null,
): WorkbenchFeishuTaskWorkflowMappedField {
  if (field.type !== 'single_select' || field.name !== definition.fieldName
    || field.options.length < definition.states.length) {
    throw infrastructure('Feishu workflow-field write returned an incompatible field')
  }
  const used = new Set<string>()
  const currentByState = new Map(
    (current?.options ?? []).map(option => [option.stateId, option.optionGuid] as const),
  )
  const options = definition.states.map((state) => {
    const expectedGuid = currentByState.get(state.stateId)
    const candidates = expectedGuid === undefined
      ? field.options.filter(option => option.name === state.name && !used.has(option.optionGuid))
      : field.options.filter(option => option.optionGuid === expectedGuid)
    if (candidates.length !== 1) {
      throw infrastructure('Feishu workflow-field write did not preserve one stable option identity')
    }
    const option = candidates[0] as WorkbenchFeishuTaskWorkflowFieldWrite['options'][number]
    if (option.name !== state.name || option.colorIndex !== state.colorIndex || option.hidden) {
      throw infrastructure('Feishu workflow-field write did not apply the desired option')
    }
    used.add(option.optionGuid)
    return Object.freeze({ stateId: state.stateId, ...option })
  })
  return Object.freeze({
    fieldGuid: field.fieldGuid,
    name: field.name,
    remoteVersion: field.remoteVersion,
    options: Object.freeze(options),
  })
}

function workflowCandidateFromMappedField(
  field: WorkbenchFeishuTaskWorkflowMappedField,
): FeishuTaskWorkflowFieldCandidate {
  return Object.freeze({
    fieldGuid: field.fieldGuid,
    name: field.name,
    type: 'single_select',
    remoteVersion: field.remoteVersion,
    options: Object.freeze(field.options.map(option => Object.freeze({
      optionGuid: option.optionGuid,
      name: option.name,
      colorIndex: option.colorIndex,
      hidden: option.hidden,
    }))),
  })
}

function workflowCompatibilityBlocked(
  compatibility: ProjectTaskWorkflowProjection['compatibility'],
): ConfigureFeishuTaskWorkflowResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'workflow-compatibility-blocked',
      message: 'Workflow compatibility checks blocked configuration',
      compatibility,
    }),
  })
}

function taskCommand<R extends WorkbenchFeishuTaskReason>(
  ids: WorkbenchIdGenerator,
  commandId: string,
  scope: AuthorizedScope,
  idempotencyKey: string,
  causationId: string,
  reason: R,
  occurredAt: string,
): WorkbenchCommandMetadata & { readonly reason: R } {
  return Object.freeze({
    commandId,
    auditEventId: generatedId(ids.nextAuditEventId(), 'audit event'),
    outboxId: generatedId(ids.nextOutboxId(), 'outbox'),
    idempotencyKey,
    causationId,
    reason,
    actor: Object.freeze({
      kind: 'owner',
      id: scope.ownerId,
      organizationId: scope.organizationId,
      teamId: scope.teamId,
    }),
    occurredAt,
  })
}

function taskProjectNotFoundResult(projectId: string): BindFeishuTaskListResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  })
}

function taskRemoteBindFailure(
  code: 'remote-outcome-unknown' | 'remote-rejected',
  issue: FeishuConnectionIssue,
): BindFeishuTaskListResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message: code === 'remote-outcome-unknown'
        ? 'Feishu task-list creation outcome is unknown'
        : 'Feishu rejected task-list access',
      issue: detachedIssue(issue),
    }),
  })
}

function taskRemoteReferenceFailure(issue: FeishuConnectionIssue): ReferenceFeishuTaskResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-rejected',
      message: 'Feishu rejected the explicit task reference',
      issue: detachedIssue(issue),
    }),
  })
}

function reconcilePreflight(
  current: ProjectTasksProjection | null,
  request: ReconcileProjectTasksRequest,
): ReconcileProjectTasksResult | null {
  if (current === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'project-not-found',
        message: `Workbench Project ${request.projectId} was not found in the authorized scope`,
        projectId: request.projectId,
      }),
    })
  }
  if (current.binding === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({ code: 'task-list-unbound', message: 'Project has no primary task list' }),
    })
  }
  if (current.revision !== request.expectedRevision) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'task-projection-revision-conflict',
        message: 'Project task projection changed before reconciliation',
        expectedRevision: request.expectedRevision,
        currentRevision: current.revision,
      }),
    })
  }
  return null
}

function referencePreflight(
  current: ProjectTasksProjection | null,
  request: ReferenceFeishuTaskRequest,
): ReferenceFeishuTaskResult | null {
  const shared = reconcilePreflight(current, request)
  if (shared !== null) return shared as ReferenceFeishuTaskResult
  if ((current as ProjectTasksProjection).tasks.some(task => task.taskGuid === request.taskGuid)) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'task-already-in-project',
        message: 'Feishu task is already visible in this Project',
        taskGuid: request.taskGuid,
      }),
    })
  }
  return null
}

function unknownTaskUpdateResult(
  effect: FeishuTaskMutationEffectProjection,
  _receipt: unknown,
): UpdateFeishuTaskResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-outcome-unknown',
      message: 'Feishu task update is already in flight; reconcile before retrying',
      effect: Object.freeze({ ...effect, state: 'unknown' }),
      issue: ambiguousTaskTransportIssue(),
    }),
  })
}

function ambiguousTaskTransportIssue(): FeishuConnectionIssue {
  return Object.freeze({
    code: 'unknown-provider-error',
    recovery: 'inspect-provider',
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function detachedIssue(issue: FeishuConnectionIssue): FeishuConnectionIssue {
  return Object.freeze({ ...issue, missingScopes: Object.freeze([...issue.missingScopes]) })
}

const MAX_CALENDAR_SUMMARY_LENGTH = 200
const MAX_MILESTONE_NAME_LENGTH = 200
const MAX_MILESTONE_DESCRIPTION_LENGTH = 2_000
const MAX_PROJECT_MILESTONES = 100
const CALENDAR_OBSERVATION_VERSION = /^sha256:[0-9a-f]{64}$/u

function calendarObservationVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CALENDAR_OBSERVATION_VERSION.test(value)) {
    throw badRequest(`${field} must be a Calendar observation digest`, { field })
  }
  return value
}
const STRICT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const OFFSET_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u

function requireSignal(signal: AbortSignal, operation: string): void {
  if (!(signal instanceof AbortSignal)) {
    throw badRequest(`${operation} requires an AbortSignal`, { field: 'signal' })
  }
}

async function requireIdenticalScopes(
  authorization: WorkbenchAuthorization,
  first: WorkbenchAction,
  second: WorkbenchAction,
  signal: AbortSignal,
): Promise<AuthorizedScope> {
  throwIfCancelled(signal)
  const left = await authorization.require(first, signal)
  throwIfCancelled(signal)
  const right = await authorization.require(second, signal)
  throwIfCancelled(signal)
  if (left.ownerId !== right.ownerId || left.organizationId !== right.organizationId
    || left.teamId !== right.teamId) {
    throw forbidden('Workbench authorization capabilities resolved to different scopes')
  }
  return left
}

function normalizeRiskPolicyInput<T>(operation: () => T, field: string): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof TypeError) throw badRequest(error.message, { field })
    throw error
  }
}

function validateProjectRisksQuery(value: ProjectRisksQuery) {
  const record = exactRecord(value, 'projectRisks query', ['projectId'], [
    'exposure', 'status', 'riskOwnerMemberId', 'triggerState', 'triggerContains',
    'reviewFrom', 'reviewTo', 'selectedRiskId', 'beforeRiskSequence', 'riskLimit',
    'beforeActivitySequence', 'activityLimit', 'beforeHistorySequence', 'historyLimit',
  ])
  const exposure = record.exposure
  if (exposure !== undefined && exposure !== 'low' && exposure !== 'medium' && exposure !== 'high') {
    throw badRequest('exposure is not supported', { field: 'exposure' })
  }
  const status = record.status
  if (status !== undefined && status !== 'research' && status !== 'watch'
    && status !== 'mitigate' && status !== 'accept' && status !== 'closed') {
    throw badRequest('status is not supported', { field: 'status' })
  }
  const triggerState = record.triggerState
  if (triggerState !== undefined && triggerState !== 'unknown'
    && triggerState !== 'not-met' && triggerState !== 'met') {
    throw badRequest('triggerState is not supported', { field: 'triggerState' })
  }
  const triggerContains = record.triggerContains === undefined
    ? undefined
    : typeof record.triggerContains === 'string'
      ? record.triggerContains.normalize('NFKC').trim().toLocaleLowerCase('und')
      : (() => { throw badRequest('triggerContains must be a string', { field: 'triggerContains' }) })()
  if (triggerContains !== undefined && [...triggerContains].length > 1_000) {
    throw badRequest('triggerContains must not exceed 1000 characters', { field: 'triggerContains' })
  }
  const reviewFrom = record.reviewFrom === undefined
    ? undefined
    : strictRiskDate(record.reviewFrom, 'reviewFrom')
  const reviewTo = record.reviewTo === undefined
    ? undefined
    : strictRiskDate(record.reviewTo, 'reviewTo')
  if (reviewFrom !== undefined && reviewTo !== undefined && reviewFrom > reviewTo) {
    throw badRequest('reviewFrom must not be after reviewTo', { field: 'reviewFrom' })
  }
  const cursor = (candidate: unknown, field: string) => candidate === undefined
    ? undefined
    : positiveRevision(candidate, field)
  const limit = (candidate: unknown, field: string) => {
    const normalized = cursor(candidate, field)
    if (normalized !== undefined && normalized > 100) {
      throw badRequest(`${field} must not exceed 100`, { field })
    }
    return normalized
  }
  const beforeRiskSequence = cursor(record.beforeRiskSequence, 'beforeRiskSequence')
  const riskLimit = limit(record.riskLimit, 'riskLimit')
  const beforeActivitySequence = cursor(record.beforeActivitySequence, 'beforeActivitySequence')
  const activityLimit = limit(record.activityLimit, 'activityLimit')
  const beforeHistorySequence = cursor(record.beforeHistorySequence, 'beforeHistorySequence')
  const historyLimit = limit(record.historyLimit, 'historyLimit')
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    ...(exposure === undefined ? {} : { exposure }),
    ...(status === undefined ? {} : { status }),
    ...(record.riskOwnerMemberId === undefined
      ? {}
      : { riskOwnerMemberId: safeId(record.riskOwnerMemberId, 'riskOwnerMemberId') }),
    ...(triggerState === undefined ? {} : { triggerState }),
    ...(triggerContains === undefined || triggerContains.length === 0 ? {} : { triggerContains }),
    ...(reviewFrom === undefined ? {} : { reviewFrom }),
    ...(reviewTo === undefined ? {} : { reviewTo }),
    ...(record.selectedRiskId === undefined
      ? {}
      : { selectedRiskId: safeId(record.selectedRiskId, 'selectedRiskId') }),
    ...(beforeRiskSequence === undefined ? {} : { beforeRiskSequence }),
    ...(riskLimit === undefined ? {} : { riskLimit }),
    ...(beforeActivitySequence === undefined ? {} : { beforeActivitySequence }),
    ...(activityLimit === undefined ? {} : { activityLimit }),
    ...(beforeHistorySequence === undefined ? {} : { beforeHistorySequence }),
    ...(historyLimit === undefined ? {} : { historyLimit }),
  })
}

function strictRiskDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !STRICT_DATE.test(value)) {
    throw badRequest(`${field} must be an ISO date`, { field })
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} must be a valid ISO date`, { field })
  }
  return value
}

function validateCreateProjectRiskRequest(value: CreateProjectRiskRequest) {
  const record = exactRecord(value, 'createProjectRisk request', [
    'projectId', 'assessment', 'expectedRisksRevision', 'expectedRiskRevision',
    'expectedTeamRevision', 'expectedTaskRevision', 'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.expectedRiskRevision !== null) {
    throw badRequest('expectedRiskRevision must be null for create', { field: 'expectedRiskRevision' })
  }
  if (record.reason !== 'owner-project-risk-create') {
    throw badRequest('reason must be owner-project-risk-create', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    assessment: normalizeRiskPolicyInput(
      () => normalizeProjectRiskAssessmentIntent(record.assessment),
      'assessment',
    ),
    expectedRisksRevision: nonNegativeRevision(record.expectedRisksRevision, 'expectedRisksRevision'),
    expectedRiskRevision: null,
    expectedTeamRevision: nonNegativeRevision(record.expectedTeamRevision, 'expectedTeamRevision'),
    expectedTaskRevision: nonNegativeRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-risk-create' as const,
  })
}

function validateReviseProjectRiskRequest(value: ReviseProjectRiskRequest) {
  const record = exactRecord(value, 'reviseProjectRisk request', [
    'projectId', 'riskId', 'assessment', 'expectedRisksRevision', 'expectedRiskRevision',
    'expectedTeamRevision', 'expectedTaskRevision', 'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.reason !== 'owner-project-risk-revise') {
    throw badRequest('reason must be owner-project-risk-revise', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    riskId: safeId(record.riskId, 'riskId'),
    assessment: normalizeRiskPolicyInput(
      () => normalizeProjectRiskAssessmentIntent(record.assessment),
      'assessment',
    ),
    expectedRisksRevision: nonNegativeRevision(record.expectedRisksRevision, 'expectedRisksRevision'),
    expectedRiskRevision: positiveRevision(record.expectedRiskRevision, 'expectedRiskRevision'),
    expectedTeamRevision: nonNegativeRevision(record.expectedTeamRevision, 'expectedTeamRevision'),
    expectedTaskRevision: nonNegativeRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-risk-revise' as const,
  })
}

function validateTransitionProjectRiskRequest(value: TransitionProjectRiskRequest) {
  const candidateStatus = typeof value === 'object' && value !== null
    ? Reflect.get(value, 'status')
    : undefined
  const record = exactRecord(value, 'transitionProjectRisk request', [
    'projectId', 'riskId', 'status', 'rationale',
    ...(candidateStatus === 'closed' ? ['closureReason'] : []),
    'expectedRisksRevision', 'expectedRiskRevision', 'expectedTaskRevision',
    'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.reason !== 'owner-project-risk-transition') {
    throw badRequest('reason must be owner-project-risk-transition', { field: 'reason' })
  }
  const transitionValue = candidateStatus === 'closed'
    ? { status: record.status, rationale: record.rationale, closureReason: record.closureReason }
    : { status: record.status, rationale: record.rationale }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    riskId: safeId(record.riskId, 'riskId'),
    transition: normalizeRiskPolicyInput(
      () => normalizeProjectRiskTransitionIntent(transitionValue),
      'transition',
    ),
    expectedRisksRevision: nonNegativeRevision(record.expectedRisksRevision, 'expectedRisksRevision'),
    expectedRiskRevision: positiveRevision(record.expectedRiskRevision, 'expectedRiskRevision'),
    expectedTaskRevision: nonNegativeRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-risk-transition' as const,
  })
}

function normalizedRiskAssessment(
  value: ReturnType<typeof normalizeProjectRiskAssessmentIntent>,
  options: Parameters<typeof normalizeProjectRiskAssessment>[1],
) {
  const { exposure: _exposure, ...draft } = value
  return normalizeRiskPolicyInput(
    () => normalizeProjectRiskAssessment(draft, options),
    'assessment',
  )
}

function normalizedRiskTransition(
  value: ReturnType<typeof normalizeProjectRiskTransitionIntent>,
  options: Parameters<typeof normalizeProjectRiskTransition>[1],
) {
  const draft = value.toStatus === 'closed'
    ? { status: value.toStatus, rationale: value.rationale, closureReason: value.closureReason }
    : { status: value.toStatus, rationale: value.rationale }
  return normalizeProjectRiskTransition(draft, options)
}

function projectRiskCommand<R extends
  | 'owner-project-risk-create'
  | 'owner-project-risk-revise'
  | 'owner-project-risk-transition'>(
  ids: WorkbenchIdGenerator,
  commandId: string,
  scope: AuthorizedScope,
  idempotencyKey: string,
  causationId: string,
  reason: R,
  occurredAt: string,
) {
  return Object.freeze({
    commandId,
    auditEventId: generatedId(ids.nextAuditEventId(), 'audit event'),
    outboxId: generatedId(ids.nextOutboxId(), 'outbox'),
    idempotencyKey,
    causationId,
    reason,
    actor: Object.freeze({
      kind: 'owner' as const,
      id: scope.ownerId,
      organizationId: scope.organizationId,
      teamId: scope.teamId,
    }),
    occurredAt,
  })
}

function projectRiskFailure<T>(code: ProjectRiskConflict['code'], message: string): T {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) }) as T
}

function projectRiskProjectMissing<T>(projectId: string): T {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found' as const,
      message: 'Workbench Project was not found in the authorized scope',
      projectId,
    }),
  }) as T
}

function validateProjectDeliverablesQuery(
  value: ProjectDeliverablesQuery,
): ProjectDeliverablesQuery {
  const record = exactRecord(
    value,
    'projectDeliverables query',
    ['projectId'],
    ['beforeActivitySequence', 'activityLimit'],
  )
  const before = record.beforeActivitySequence === undefined
    ? undefined
    : positiveRevision(record.beforeActivitySequence, 'beforeActivitySequence')
  const limit = record.activityLimit === undefined
    ? undefined
    : positiveRevision(record.activityLimit, 'activityLimit')
  if (limit !== undefined && limit > 100) {
    throw badRequest('activityLimit must not exceed 100', { field: 'activityLimit' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    ...(before === undefined ? {} : { beforeActivitySequence: before }),
    ...(limit === undefined ? {} : { activityLimit: limit }),
  })
}

function validateCreateProjectDeliverableRequest(
  value: CreateProjectDeliverableRequest,
): CreateProjectDeliverableRequest {
  const record = exactRecord(value, 'createProjectDeliverable request', [
    'projectId', 'name', 'criteria', 'accountableMemberId', 'contributorMemberIds',
    'humanSponsorMemberId', 'acceptorMemberId', 'taskGuids', 'event',
    'expectedDeliverablesRevision', 'expectedDeliverableRevision', 'expectedTeamRevision',
    'expectedTaskRevision', 'expectedScheduleRevision', 'idempotencyKey', 'causationId', 'reason',
  ], ['description'])
  if (!Array.isArray(record.criteria) || record.criteria.length < 1
    || record.criteria.length > MAX_DELIVERABLE_CRITERIA) {
    throw badRequest(`criteria must contain 1-${MAX_DELIVERABLE_CRITERIA} items`, {
      field: 'criteria',
    })
  }
  const criteria = Object.freeze(record.criteria.map((value, index) => {
    const criterion = exactRecord(value, `criteria[${String(index)}]`, ['statement'])
    return Object.freeze({
      statement: boundedText(
        criterion.statement,
        `criteria[${String(index)}].statement`,
        MAX_DELIVERABLE_CRITERION_LENGTH,
      ),
    })
  }))
  if (!Array.isArray(record.contributorMemberIds)
    || record.contributorMemberIds.length > MAX_DELIVERABLE_CONTRIBUTORS) {
    throw badRequest(
      `contributorMemberIds must contain 0-${MAX_DELIVERABLE_CONTRIBUTORS} items`,
      { field: 'contributorMemberIds' },
    )
  }
  const contributorMemberIds = Object.freeze(record.contributorMemberIds.map((memberId, index) =>
    safeId(memberId, `contributorMemberIds[${String(index)}]`)))
  if (new Set(contributorMemberIds).size !== contributorMemberIds.length) {
    throw badRequest('contributorMemberIds must not contain duplicates', {
      field: 'contributorMemberIds',
    })
  }
  if (!Array.isArray(record.taskGuids) || record.taskGuids.length < 1
    || record.taskGuids.length > MAX_DELIVERABLE_TASKS) {
    throw badRequest(`taskGuids must contain 1-${MAX_DELIVERABLE_TASKS} items`, {
      field: 'taskGuids',
    })
  }
  const taskGuids = Object.freeze(record.taskGuids.map((taskGuid, index) =>
    safeId(taskGuid, `taskGuids[${String(index)}]`)))
  if (new Set(taskGuids).size !== taskGuids.length) {
    throw badRequest('taskGuids must not contain duplicates', { field: 'taskGuids' })
  }
  const sponsor = record.humanSponsorMemberId === null
    ? null
    : safeId(record.humanSponsorMemberId, 'humanSponsorMemberId')
  if (record.expectedDeliverableRevision !== null) {
    throw badRequest('expectedDeliverableRevision must be null for creation', {
      field: 'expectedDeliverableRevision',
    })
  }
  if (record.reason !== 'owner-project-deliverable-create') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  const event = validateCreateProjectDeliverableEvent(record.event)
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    name: boundedText(record.name, 'name', MAX_DELIVERABLE_NAME_LENGTH),
    description: nullableDeliverableText(record.description, 'description'),
    criteria,
    accountableMemberId: safeId(record.accountableMemberId, 'accountableMemberId'),
    contributorMemberIds,
    humanSponsorMemberId: sponsor,
    acceptorMemberId: safeId(record.acceptorMemberId, 'acceptorMemberId'),
    taskGuids,
    event,
    expectedDeliverablesRevision: nonNegativeRevision(
      record.expectedDeliverablesRevision,
      'expectedDeliverablesRevision',
    ),
    expectedDeliverableRevision: null,
    expectedTeamRevision: nonNegativeRevision(record.expectedTeamRevision, 'expectedTeamRevision'),
    expectedTaskRevision: nonNegativeRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    expectedScheduleRevision: nonNegativeRevision(
      record.expectedScheduleRevision,
      'expectedScheduleRevision',
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-deliverable-create',
  })
}

function validateCreateProjectDeliverableEvent(
  value: unknown,
): CreateProjectDeliverableRequest['event'] {
  const mode = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, 'mode')
    : undefined
  if (mode === 'existing-event') {
    const record = exactRecord(value, 'event', ['mode', 'eventId'])
    return Object.freeze({
      mode: 'existing-event',
      eventId: safeId(record.eventId, 'event.eventId'),
    })
  }
  if (mode === 'create-event') {
    const record = exactRecord(value, 'event', ['mode', 'schedule'])
    return Object.freeze({
      mode: 'create-event',
      schedule: validateCalendarSchedule(record.schedule, 'event.schedule'),
    })
  }
  throw badRequest('event.mode must be existing-event or create-event', { field: 'event.mode' })
}

function nullableDeliverableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`, { field })
  const normalized = value.trim()
  if (normalized.length === 0) return null
  return boundedText(normalized, field, MAX_DELIVERABLE_DESCRIPTION_LENGTH)
}

function validateRequestDeliverableAcceptanceRequest(
  value: RequestDeliverableAcceptanceRequest,
): RequestDeliverableAcceptanceRequest {
  const record = exactRecord(value, 'requestDeliverableAcceptance request', [
    'projectId', 'deliverableId', 'candidateVersions', 'expectedDeliverablesRevision',
    'expectedDeliverableRevision', 'expectedTeamRevision', 'expectedTaskRevision',
    'expectedScheduleRevision', 'expectedRemoteObservationVersion', 'idempotencyKey',
    'causationId', 'reason',
  ])
  if (!Array.isArray(record.candidateVersions) || record.candidateVersions.length < 1
    || record.candidateVersions.length > MAX_DELIVERABLE_CANDIDATES) {
    throw badRequest(`candidateVersions must contain 1-${MAX_DELIVERABLE_CANDIDATES} items`, {
      field: 'candidateVersions',
    })
  }
  const candidateVersions = Object.freeze(record.candidateVersions.map((candidate, index) =>
    validateDeliverableArtifactVersion(candidate, index)))
  const digests = candidateVersions.map(candidate => scenarioContentDigest(candidate))
  if (new Set(digests).size !== digests.length) {
    throw badRequest('candidateVersions must contain distinct normalized references', {
      field: 'candidateVersions',
    })
  }
  if (record.reason !== 'owner-deliverable-acceptance-request') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    deliverableId: safeId(record.deliverableId, 'deliverableId'),
    candidateVersions,
    expectedDeliverablesRevision: nonNegativeRevision(
      record.expectedDeliverablesRevision,
      'expectedDeliverablesRevision',
    ),
    expectedDeliverableRevision: positiveRevision(
      record.expectedDeliverableRevision,
      'expectedDeliverableRevision',
    ),
    expectedTeamRevision: nonNegativeRevision(record.expectedTeamRevision, 'expectedTeamRevision'),
    expectedTaskRevision: nonNegativeRevision(record.expectedTaskRevision, 'expectedTaskRevision'),
    expectedScheduleRevision: nonNegativeRevision(
      record.expectedScheduleRevision,
      'expectedScheduleRevision',
    ),
    expectedRemoteObservationVersion: calendarObservationVersion(
      record.expectedRemoteObservationVersion,
      'expectedRemoteObservationVersion',
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-deliverable-acceptance-request',
  })
}

function validateDeliverableArtifactVersion(
  value: unknown,
  index: number,
): DeliverableArtifactVersionRef {
  const field = `candidateVersions[${String(index)}]`
  const record = exactRecord(value, field, [
    'kind', 'source', 'resourceId', 'versionId', 'displayName', 'canonicalUrl', 'contentDigest',
  ])
  if (record.kind !== 'declared-file-version') {
    throw badRequest(`${field}.kind is not supported`, { field: `${field}.kind` })
  }
  if (record.source !== 'managed' && record.source !== 'local' && record.source !== 'feishu') {
    throw badRequest(`${field}.source is not supported`, { field: `${field}.source` })
  }
  const contentDigest = record.contentDigest
  if (contentDigest !== null
    && (typeof contentDigest !== 'string' || !DIGEST_PATTERN.test(contentDigest))) {
    throw badRequest(`${field}.contentDigest must be null or a SHA-256 digest`, {
      field: `${field}.contentDigest`,
    })
  }
  return Object.freeze({
    kind: 'declared-file-version',
    source: record.source,
    resourceId: boundedArtifactReference(record.resourceId, `${field}.resourceId`),
    versionId: boundedArtifactReference(record.versionId, `${field}.versionId`),
    displayName: boundedText(
      record.displayName,
      `${field}.displayName`,
      MAX_DELIVERABLE_ARTIFACT_LABEL_LENGTH,
    ),
    canonicalUrl: validateDeliverableCanonicalUrl(record.canonicalUrl, `${field}.canonicalUrl`),
    contentDigest: contentDigest as string | null,
  })
}

function boundedArtifactReference(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`, { field })
  const normalized = value.trim()
  if (normalized.length < 1 || [...normalized].length > MAX_DELIVERABLE_ARTIFACT_REFERENCE_LENGTH
    || !normalized.isWellFormed() || TEXT_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw badRequest(`${field} must be a bounded safe reference`, { field })
  }
  return normalized
}

function validateDeliverableCanonicalUrl(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > MAX_DELIVERABLE_CANONICAL_URL_LENGTH) {
    throw badRequest(`${field} must be null or a bounded HTTPS URL`, { field })
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw badRequest(`${field} must be null or a bounded HTTPS URL`, { field })
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw badRequest(`${field} must be null or a bounded HTTPS URL`, { field })
  }
  const normalized = parsed.toString()
  if (normalized.length > MAX_DELIVERABLE_CANONICAL_URL_LENGTH) {
    throw badRequest(`${field} must be null or a bounded HTTPS URL`, { field })
  }
  return normalized
}

function validateDecideDeliverableAcceptanceRequest(
  value: DecideDeliverableAcceptanceRequest,
): DecideDeliverableAcceptanceRequest {
  const record = exactRecord(value, 'decideDeliverableAcceptance request', [
    'projectId', 'deliverableId', 'acceptanceRequestId', 'mode', 'criteria', 'feedback',
    'expectedDeliverablesRevision', 'expectedDeliverableRevision',
    'expectedAcceptanceRequestRevision', 'idempotencyKey', 'causationId', 'reason',
  ])
  if (record.mode !== 'approve' && record.mode !== 'reject' && record.mode !== 'request-changes') {
    throw badRequest('mode is not supported', { field: 'mode' })
  }
  const expectedReason = record.mode === 'approve'
    ? 'owner-deliverable-acceptance-approve'
    : record.mode === 'reject'
      ? 'owner-deliverable-acceptance-reject'
      : 'owner-deliverable-acceptance-needs-changes'
  if (record.reason !== expectedReason) {
    throw badRequest('reason does not match the decision mode', { field: 'reason' })
  }
  if (!Array.isArray(record.criteria) || record.criteria.length < 1
    || record.criteria.length > MAX_DELIVERABLE_CRITERIA) {
    throw badRequest(`criteria must contain 1-${MAX_DELIVERABLE_CRITERIA} items`, {
      field: 'criteria',
    })
  }
  const criteria = Object.freeze(record.criteria.map((value, index) => {
    const field = `criteria[${String(index)}]`
    const criterion = exactRecord(value, field, ['criterionId', 'outcome'])
    if (criterion.outcome !== 'met' && criterion.outcome !== 'not-met') {
      throw badRequest(`${field}.outcome is invalid`, { field: `${field}.outcome` })
    }
    return Object.freeze({
      criterionId: safeId(criterion.criterionId, `${field}.criterionId`),
      outcome: criterion.outcome,
    })
  }))
  if (new Set(criteria.map(criterion => criterion.criterionId)).size !== criteria.length) {
    throw badRequest('criteria must not contain duplicate criterionId values', { field: 'criteria' })
  }
  const common = {
    projectId: safeId(record.projectId, 'projectId'),
    deliverableId: safeId(record.deliverableId, 'deliverableId'),
    acceptanceRequestId: safeId(record.acceptanceRequestId, 'acceptanceRequestId'),
    criteria,
    feedback: boundedText(record.feedback, 'feedback', MAX_DELIVERABLE_FEEDBACK_LENGTH),
    expectedDeliverablesRevision: nonNegativeRevision(
      record.expectedDeliverablesRevision,
      'expectedDeliverablesRevision',
    ),
    expectedDeliverableRevision: positiveRevision(
      record.expectedDeliverableRevision,
      'expectedDeliverableRevision',
    ),
    expectedAcceptanceRequestRevision: positiveRevision(
      record.expectedAcceptanceRequestRevision,
      'expectedAcceptanceRequestRevision',
    ),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
  }
  if (record.mode === 'approve') return Object.freeze({
    ...common, mode: 'approve', reason: 'owner-deliverable-acceptance-approve',
  })
  if (record.mode === 'reject') return Object.freeze({
    ...common, mode: 'reject', reason: 'owner-deliverable-acceptance-reject',
  })
  return Object.freeze({
    ...common, mode: 'request-changes', reason: 'owner-deliverable-acceptance-needs-changes',
  })
}

function validateProjectMilestonesQuery(value: ProjectMilestonesQuery): ProjectMilestonesQuery {
  const record = exactRecord(value, 'getProjectMilestones query', ['projectId'])
  return Object.freeze({ projectId: safeId(record.projectId, 'projectId') })
}

function validateDiscoverFeishuCalendarsRequest(
  value: DiscoverFeishuCalendarsRequest,
): DiscoverFeishuCalendarsRequest {
  const record = exactRecord(value, 'discoverFeishuCalendars request', [
    'projectId', 'kind', 'expectedConnectionRevision', 'expectedRouteGeneration',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    kind: validateFeishuKind(record.kind, 'kind'),
    expectedConnectionRevision: nonNegativeRevision(
      record.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration: positiveRevision(
      record.expectedRouteGeneration,
      'expectedRouteGeneration',
    ),
  })
}

function validateBindProjectCalendarRequest(
  value: BindProjectCalendarRequest,
): BindProjectCalendarRequest {
  const record = exactRecord(value, 'bindProjectCalendar request', [
    'projectId', 'kind', 'mode', 'expectedConnectionRevision',
    'expectedRouteGeneration', 'expectedBindingRevision', 'idempotencyKey',
    'causationId', 'reason',
  ], ['calendarId', 'summary', 'description'])
  if (record.reason !== 'owner-project-calendar-bind') {
    throw badRequest('reason is not supported for Calendar binding', { field: 'reason' })
  }
  if (record.expectedBindingRevision !== null) {
    throw badRequest('expectedBindingRevision must be null', { field: 'expectedBindingRevision' })
  }
  const common = Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    kind: validateFeishuKind(record.kind, 'kind'),
    expectedConnectionRevision: nonNegativeRevision(
      record.expectedConnectionRevision,
      'expectedConnectionRevision',
    ),
    expectedRouteGeneration: positiveRevision(
      record.expectedRouteGeneration,
      'expectedRouteGeneration',
    ),
    expectedBindingRevision: null,
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-calendar-bind' as const,
  })
  if (record.mode === 'existing') {
    if (record.summary !== undefined || record.description !== undefined) {
      throw badRequest('existing Calendar binding cannot carry create fields', { field: 'mode' })
    }
    return Object.freeze({
      ...common,
      mode: 'existing',
      calendarId: safeFeishuResourceId(record.calendarId, 'calendarId'),
    })
  }
  if (record.mode === 'create') {
    if (record.calendarId !== undefined) {
      throw badRequest('Calendar create cannot carry calendarId', { field: 'calendarId' })
    }
    return Object.freeze({
      ...common,
      mode: 'create',
      summary: boundedText(record.summary, 'summary', MAX_CALENDAR_SUMMARY_LENGTH),
      description: nullableCalendarText(record.description, 'description'),
    })
  }
  throw badRequest('mode must be existing or create', { field: 'mode' })
}

function validateDiscoverFeishuCalendarEventsRequest(
  value: DiscoverFeishuCalendarEventsRequest,
): DiscoverFeishuCalendarEventsRequest {
  const record = exactRecord(value, 'discoverFeishuCalendarEvents request', [
    'projectId', 'expectedRevision',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
  })
}

function validateCreateProjectMilestoneRequest(
  value: CreateProjectMilestoneRequest,
): CreateProjectMilestoneRequest {
  const record = exactRecord(value, 'createProjectMilestone request', [
    'projectId', 'mode', 'expectedRevision', 'expectedMilestoneRevision',
    'name', 'idempotencyKey', 'causationId', 'reason',
  ], ['description', 'eventId', 'schedule'])
  if (record.expectedMilestoneRevision !== null) {
    throw badRequest('expectedMilestoneRevision must be null', {
      field: 'expectedMilestoneRevision',
    })
  }
  if (record.reason !== 'owner-project-milestone-create') {
    throw badRequest('reason is not supported for Milestone creation', { field: 'reason' })
  }
  const common = Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
    expectedMilestoneRevision: null,
    name: boundedText(record.name, 'name', MAX_MILESTONE_NAME_LENGTH),
    description: nullableCalendarText(record.description, 'description'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-milestone-create' as const,
  })
  if (record.mode === 'existing-event') {
    if (record.schedule !== undefined) {
      throw badRequest('existing-event mode cannot carry schedule', { field: 'schedule' })
    }
    return Object.freeze({
      ...common,
      mode: 'existing-event',
      eventId: safeFeishuResourceId(record.eventId, 'eventId'),
    })
  }
  if (record.mode === 'create-event') {
    if (record.eventId !== undefined) {
      throw badRequest('create-event mode cannot carry eventId', { field: 'eventId' })
    }
    return Object.freeze({
      ...common,
      mode: 'create-event',
      schedule: validateCalendarSchedule(record.schedule, 'schedule'),
    })
  }
  throw badRequest('mode must be existing-event or create-event', { field: 'mode' })
}

function validateUpdateProjectMilestoneDateRequest(
  value: UpdateProjectMilestoneDateRequest,
): UpdateProjectMilestoneDateRequest {
  const record = exactRecord(value, 'updateProjectMilestoneDate request', [
    'projectId', 'milestoneId', 'expectedRevision', 'expectedMilestoneRevision',
    'expectedRemoteObservationVersion', 'schedule', 'idempotencyKey',
    'causationId', 'reason',
  ])
  if (record.reason !== 'owner-project-milestone-date-update') {
    throw badRequest('reason is not supported for Milestone date update', { field: 'reason' })
  }
  const remoteVersion = record.expectedRemoteObservationVersion
  if (typeof remoteVersion !== 'string' || !CALENDAR_OBSERVATION_VERSION.test(remoteVersion)) {
    throw badRequest('expectedRemoteObservationVersion is invalid', {
      field: 'expectedRemoteObservationVersion',
    })
  }
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    milestoneId: safeId(record.milestoneId, 'milestoneId'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
    expectedMilestoneRevision: positiveRevision(
      record.expectedMilestoneRevision,
      'expectedMilestoneRevision',
    ),
    expectedRemoteObservationVersion: remoteVersion,
    schedule: validateCalendarSchedule(record.schedule, 'schedule'),
    idempotencyKey: validateCommandKey(record.idempotencyKey, 'idempotencyKey'),
    causationId: validateCommandKey(record.causationId, 'causationId'),
    reason: 'owner-project-milestone-date-update',
  })
}

function validateReconcileProjectCalendarRequest(
  value: ReconcileProjectCalendarRequest,
): ReconcileProjectCalendarRequest {
  const record = exactRecord(value, 'reconcileProjectCalendar request', [
    'projectId', 'expectedRevision',
  ])
  return Object.freeze({
    projectId: safeId(record.projectId, 'projectId'),
    expectedRevision: positiveRevision(record.expectedRevision, 'expectedRevision'),
  })
}

function validateFeishuCalendarEventInput(
  value: FeishuCalendarEventInput,
): FeishuCalendarEventInput {
  const record = exactRecord(value, 'Feishu Calendar event', [
    'eventEnvelopeId', 'calendarId', 'eventId', 'occurredAt',
  ])
  return Object.freeze({
    eventEnvelopeId: safeId(record.eventEnvelopeId, 'eventEnvelopeId'),
    calendarId: safeFeishuResourceId(record.calendarId, 'calendarId'),
    eventId: record.eventId === null ? null : safeFeishuResourceId(record.eventId, 'eventId'),
    occurredAt: canonicalRequestInstant(record.occurredAt, 'occurredAt'),
  })
}

function validateCalendarSchedule(value: unknown, field: string): ProjectCalendarSchedule {
  const record = exactRecord(value, field, ['kind'], [
    'startDate', 'endDate', 'startAt', 'endAt', 'timeZone',
  ])
  if (record.kind === 'all-day') {
    if (record.startAt !== undefined || record.endAt !== undefined || record.timeZone !== undefined) {
      throw badRequest(`${field} mixes all-day and timed fields`, { field })
    }
    const startDate = strictCalendarDate(record.startDate, `${field}.startDate`)
    const endDate = strictCalendarDate(record.endDate, `${field}.endDate`)
    if (startDate >= endDate) {
      throw badRequest(`${field} start must precede exclusive end`, { field })
    }
    return Object.freeze({ kind: 'all-day', startDate, endDate })
  }
  if (record.kind === 'timed') {
    if (record.startDate !== undefined || record.endDate !== undefined) {
      throw badRequest(`${field} mixes all-day and timed fields`, { field })
    }
    const startAt = offsetInstant(record.startAt, `${field}.startAt`)
    const endAt = offsetInstant(record.endAt, `${field}.endAt`)
    const timeZone = ianaTimeZone(record.timeZone, `${field}.timeZone`)
    if (Date.parse(startAt) >= Date.parse(endAt)) {
      throw badRequest(`${field} start must precede end`, { field })
    }
    return Object.freeze({ kind: 'timed', startAt, endAt, timeZone })
  }
  throw badRequest(`${field}.kind must be all-day or timed`, { field: `${field}.kind` })
}

function strictCalendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be an ISO date`, { field })
  const match = STRICT_DATE.exec(value)
  if (match === null) throw badRequest(`${field} must be an ISO date`, { field })
  const instant = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} is not a real calendar date`, { field })
  }
  return value
}

function offsetInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OFFSET_RFC3339.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw badRequest(`${field} must be an offset-bearing RFC 3339 instant`, { field })
  }
  return value
}

function ianaTimeZone(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
    || TEXT_CONTROL_CHARACTER_PATTERN.test(value)) {
    throw badRequest(`${field} must be a valid IANA timezone`, { field })
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
  } catch {
    throw badRequest(`${field} must be a valid IANA timezone`, { field })
  }
  return value
}

function canonicalRequestInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw badRequest(`${field} must be a canonical ISO instant`, { field })
  }
  return value
}

function nullableCalendarText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`, { field })
  const normalized = value.trim()
  if ([...normalized].length > MAX_MILESTONE_DESCRIPTION_LENGTH
    || TEXT_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw badRequest(`${field} is invalid`, { field })
  }
  return normalized.length === 0 ? null : normalized
}

function validateCalendarSnapshot(value: import('./feishu-calendar-federation.ts').WorkbenchFeishuCalendarSnapshot): void {
  safeProviderResourceId(value.calendarId, 'Calendar id')
  safeProviderText(value.summary, 'Calendar summary', MAX_CALENDAR_SUMMARY_LENGTH, false)
  if (value.description !== null) {
    safeProviderText(value.description, 'Calendar description', MAX_MILESTONE_DESCRIPTION_LENGTH, true)
  }
  if (!['primary', 'shared', 'resource', 'unknown'].includes(value.calendarType)
    || !['unknown', 'free_busy_reader', 'reader', 'writer', 'owner'].includes(value.role)
    || typeof value.deleted !== 'boolean' || typeof value.thirdParty !== 'boolean') {
    throw infrastructure('Feishu Calendar response is invalid')
  }
}

function validateCalendarEventSnapshot(value: WorkbenchFeishuCalendarEventSnapshot): void {
  safeProviderResourceId(value.calendarId, 'Calendar event calendar id')
  safeProviderResourceId(value.eventId, 'Calendar event id')
  safeProviderResourceId(value.organizerCalendarId, 'Calendar event organizer id')
  safeProviderText(value.summary, 'Calendar event summary', MAX_CALENDAR_SUMMARY_LENGTH, true)
  if (value.description !== null) {
    safeProviderText(value.description, 'Calendar event description', MAX_MILESTONE_DESCRIPTION_LENGTH, true)
  }
  validateCalendarSchedule(value.schedule, 'provider.schedule')
  if (!['confirmed', 'cancelled', 'unknown'].includes(value.status)
    || typeof value.recurring !== 'boolean' || typeof value.exception !== 'boolean'
    || typeof value.appLink !== 'string' || value.appLink.length < 1 || value.appLink.length > 2_048
    || !CALENDAR_OBSERVATION_VERSION.test(value.remoteObservationVersion)) {
    throw infrastructure('Feishu Calendar event response is invalid')
  }
  canonicalProviderInstant(value.observedAt, 'Calendar event observedAt')
}

function safeProviderResourceId(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_FEISHU_RESOURCE_ID.test(value)) {
    throw infrastructure(`Feishu provider returned an invalid ${label}`)
  }
}

function safeProviderText(value: string, label: string, maximum: number, allowEmpty: boolean): void {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)
    || [...value].length > maximum || TEXT_CONTROL_CHARACTER_PATTERN.test(value)) {
    throw infrastructure(`Feishu provider returned invalid ${label}`)
  }
}

function canonicalProviderInstant(value: string, label: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw infrastructure(`Feishu provider returned invalid ${label}`)
  }
}

function calendarSelectable(value: import('./feishu-calendar-federation.ts').WorkbenchFeishuCalendarSnapshot): boolean {
  return !value.deleted && !value.thirdParty
    && (value.calendarType === 'primary' || value.calendarType === 'shared')
    && (value.role === 'writer' || value.role === 'owner')
}

function eventSelectable(value: WorkbenchFeishuCalendarEventSnapshot, calendarId: string): boolean {
  return value.calendarId === calendarId && value.organizerCalendarId === calendarId
    && !value.recurring && !value.exception && value.status === 'confirmed'
}

function calendarCandidate(value: import('./feishu-calendar-federation.ts').WorkbenchFeishuCalendarSnapshot) {
  return Object.freeze({ ...value, selectable: calendarSelectable(value) })
}

function calendarEventCandidate(
  value: WorkbenchFeishuCalendarEventSnapshot,
  calendarId: string,
  unused: boolean,
) {
  return Object.freeze({
    eventId: value.eventId,
    summary: value.summary,
    description: value.description,
    schedule: Object.freeze({ ...value.schedule }),
    remoteStatus: value.status,
    recurring: value.recurring,
    exception: value.exception,
    organizerMatchesCalendar: value.organizerCalendarId === calendarId,
    eventAppLink: value.appLink,
    remoteObservationVersion: value.remoteObservationVersion,
    selectable: unused && eventSelectable(value, calendarId),
  })
}

function resolveCalendarRouteForBinding(
  stored: StoredFeishuConnection,
  request: Pick<DiscoverFeishuCalendarsRequest,
    'kind' | 'expectedConnectionRevision' | 'expectedRouteGeneration'>,
):
  | { readonly ok: true; readonly route: WorkbenchFeishuCalendarRoute }
  | { readonly ok: false; readonly error: Extract<BindProjectCalendarResult, { readonly ok: false }> } {
  if (stored.revision !== request.expectedConnectionRevision) {
    return { ok: false, error: Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'connection-revision-conflict',
        message: 'Feishu connection changed before Calendar access',
      }),
    }) }
  }
  const selected = request.kind === 'bot' ? stored.bot : stored.user
  if (selected.generation === null) return calendarRouteFailure('route-unconfigured')
  if (selected.generation !== request.expectedRouteGeneration) {
    return calendarRouteFailure('route-generation-conflict')
  }
  if (selected.state === 'disabled') return calendarRouteFailure('route-disabled')
  if (selected.actor === null) return calendarRouteFailure('route-unverified')
  if (selected.appId === null || selected.credentialRef === null) {
    throw infrastructure('Workbench Feishu Calendar route projection is incomplete')
  }
  return { ok: true, route: Object.freeze({
    kind: request.kind,
    routeGeneration: selected.generation,
    appId: selected.appId,
    credentialRef: selected.credentialRef,
    actor: Object.freeze({ ...selected.actor }),
  }) }
}

function calendarRouteFailure(
  code: 'route-unconfigured' | 'route-generation-conflict' | 'route-disabled' | 'route-unverified',
): { readonly ok: false; readonly error: Extract<BindProjectCalendarResult, { readonly ok: false }> } {
  return { ok: false, error: Object.freeze({
    ok: false,
    error: Object.freeze({ code, message: `Feishu Calendar route is ${code}` }),
  }) }
}

function requiredCalendarAdapter(
  adapters: WorkbenchExternalAdapters,
): WorkbenchFeishuCalendarExternalAdapter {
  if (adapters.feishuCalendars === undefined) {
    throw unavailable('Workbench Feishu Calendar adapter is not available')
  }
  return adapters.feishuCalendars
}

function calendarCommand<R extends WorkbenchProjectCalendarReason>(
  ids: WorkbenchIdGenerator,
  commandId: string,
  scope: AuthorizedScope,
  idempotencyKey: string,
  causationId: string,
  reason: R,
  occurredAt: string,
): WorkbenchCommandMetadata & { readonly reason: R } {
  return Object.freeze({
    commandId,
    auditEventId: generatedId(ids.nextAuditEventId(), 'audit event'),
    outboxId: generatedId(ids.nextOutboxId(), 'outbox'),
    idempotencyKey,
    causationId,
    reason,
    actor: Object.freeze({
      kind: 'owner',
      id: scope.ownerId,
      organizationId: scope.organizationId,
      teamId: scope.teamId,
    }),
    occurredAt,
  })
}

function nextMilestoneId(ids: WorkbenchIdGenerator, fallback: string): string {
  return generatedId(ids.nextMilestoneId?.() ?? `milestone-${fallback}`, 'Milestone')
}

function nextScheduleChangeId(ids: WorkbenchIdGenerator, fallback: string): string {
  const normalizedFallback = createHash('sha256').update(fallback).digest('hex').slice(0, 32)
  return generatedId(
    ids.nextScheduleChangeId?.() ?? `schedule-change-${normalizedFallback}`,
    'schedule change',
  )
}

function calendarProviderIdempotencyKey(commandId: string, projectId: string): string {
  return `dshwb-${createHash('sha256').update(`${commandId}\0${projectId}`).digest('hex')}`
}

function milestoneCreationPreflight(
  current: ProjectMilestonesProjection | null,
  request: CreateProjectMilestoneRequest,
): CreateProjectMilestoneResult | null {
  if (current === null) return calendarProjectNotFound(request.projectId)
  if (current.binding === null) return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'calendar-unbound', message: 'Project has no bound Calendar' }),
  })
  if (current.revision !== request.expectedRevision) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-schedule-revision-conflict',
      message: 'Project schedule revision changed',
      current,
    }),
  })
  if (current.milestones.length >= MAX_PROJECT_MILESTONES) return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'milestone-limit-reached', message: 'Project has 100 Milestones' }),
  })
  if (request.mode === 'existing-event'
    && current.milestones.some(item => item.eventId === request.eventId)) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({ code: 'event-already-used', message: 'Event already backs a Milestone' }),
    })
  }
  return null
}

function milestoneDatePreflight(
  current: ProjectMilestonesProjection | null,
  request: UpdateProjectMilestoneDateRequest,
): UpdateProjectMilestoneDateResult | null {
  if (current === null) return calendarProjectNotFound(request.projectId)
  if (current.binding === null) return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'calendar-unbound', message: 'Project has no bound Calendar' }),
  })
  if (current.revision !== request.expectedRevision) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-schedule-revision-conflict',
      message: 'Project schedule revision changed',
      current,
    }),
  })
  const milestone = current.milestones.find(item => item.milestoneId === request.milestoneId)
  if (milestone === undefined) return milestoneNotFound(request.milestoneId)
  if (milestone.revision !== request.expectedMilestoneRevision) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'milestone-revision-conflict',
      message: 'Milestone revision changed',
      current,
      currentMilestone: milestone,
    }),
  })
  return null
}

function calendarReconciliationPreflight(
  current: ProjectMilestonesProjection | null,
  request: ReconcileProjectCalendarRequest,
): ReconcileProjectCalendarResult | null {
  if (current === null) return calendarProjectNotFound(request.projectId)
  if (current.binding === null) return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'calendar-unbound', message: 'Project has no bound Calendar' }),
  })
  if (current.revision !== request.expectedRevision) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-schedule-revision-conflict',
      message: 'Project schedule revision changed',
      current,
    }),
  })
  return null
}

function deliverableCreatePreflight(
  current: ProjectDeliverablesProjection | null,
  request: CreateProjectDeliverableRequest,
): CreateProjectDeliverableResult | null {
  if (current === null) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${request.projectId} was not found in the authorized scope`,
      projectId: request.projectId,
    }),
  })
  if (current.calendarBinding === null) {
    return deliverableConflict('calendar-unbound', 'Project has no bound Calendar', current)
  }
  if (current.revision !== request.expectedDeliverablesRevision) {
    return deliverableConflict(
      'deliverables-revision-conflict',
      'Deliverables revision changed',
      current,
    )
  }
  if (current.teamRevision !== request.expectedTeamRevision) {
    return deliverableConflict('team-revision-conflict', 'Project Team revision changed', current)
  }
  if (current.taskRevision !== request.expectedTaskRevision) {
    return deliverableConflict(
      'task-projection-revision-conflict',
      'Project task projection changed',
      current,
    )
  }
  if (current.scheduleRevision !== request.expectedScheduleRevision) {
    return deliverableConflict(
      'project-schedule-revision-conflict',
      'Project schedule revision changed',
      current,
    )
  }
  if (current.deliverables.length >= 100) {
    return deliverableConflict('deliverable-limit-reached', 'Project already has 100 Deliverables', current)
  }
  if (request.contributorMemberIds.includes(request.accountableMemberId)) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'accountable-also-contributor',
        message: 'Deliverable Accountable cannot also be a Contributor',
        memberId: request.accountableMemberId,
      }),
    })
  }
  const requestedMembers = new Set([
    request.accountableMemberId,
    ...request.contributorMemberIds,
    ...(request.humanSponsorMemberId === null ? [] : [request.humanSponsorMemberId]),
    request.acceptorMemberId,
  ])
  for (const memberId of requestedMembers) {
    const member = current.memberOptions.find(option => option.memberId === memberId)
    if (member === undefined) return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'member-not-found',
        message: `Workbench ProjectMember ${memberId} was not found`,
        memberId,
      }),
    })
    if (member.status !== 'active') return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'member-inactive',
        message: `Workbench ProjectMember ${memberId} is inactive`,
        memberId,
      }),
    })
  }
  const accountable = current.memberOptions.find(
    option => option.memberId === request.accountableMemberId,
  )
  const acceptor = current.memberOptions.find(option => option.memberId === request.acceptorMemberId)
  if (accountable === undefined || acceptor === undefined) {
    throw infrastructure('Workbench Deliverable member option disappeared during preflight')
  }
  if (accountable.requiresHumanSponsor && request.humanSponsorMemberId === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'human-sponsor-required',
        message: 'Deliverable Accountable requires a Human Sponsor',
        memberId: accountable.memberId,
      }),
    })
  }
  if (!accountable.requiresHumanSponsor && request.humanSponsorMemberId !== null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'human-sponsor-forbidden',
        message: 'A declared-Feishu human Accountable cannot have a Human Sponsor',
        memberId: accountable.memberId,
      }),
    })
  }
  if (request.humanSponsorMemberId !== null) {
    const sponsor = current.memberOptions.find(
      option => option.memberId === request.humanSponsorMemberId,
    )
    if (sponsor === undefined || !sponsor.canBeHumanSponsor) return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'human-sponsor-invalid',
        message: 'Deliverable Human Sponsor must be an active human',
        memberId: request.humanSponsorMemberId,
      }),
    })
  }
  if (!acceptor.canAccept) return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'acceptor-invalid',
      message: 'Deliverable Acceptor must be an active human',
      memberId: acceptor.memberId,
    }),
  })
  for (const taskGuid of request.taskGuids) {
    if (!current.taskOptions.some(task => task.taskGuid === taskGuid)) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'task-not-in-project',
          message: 'Deliverable task is not visible in this Project',
          taskGuid,
          current,
        }),
      })
    }
  }
  return null
}

function deliverableConflict(
  code: ProjectDeliverableConflict['code'],
  message: string,
  current?: ProjectDeliverablesProjection,
  issue?: FeishuConnectionIssue,
): CreateProjectDeliverableResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      ...(current === undefined ? {} : { current }),
      ...(issue === undefined ? {} : { issue: detachedIssue(issue) }),
    }),
  })
}

function nextDeliverableIdentity(
  generator: (() => string) | undefined,
  fallback: string,
  kind: string,
): string {
  return generatedId(generator?.() ?? fallback, kind)
}

function scenarioContentDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`
}

function calendarProjectNotFound(projectId: string) {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'project-not-found' as const,
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  })
}

function calendarAlreadyBound(current: ProjectMilestonesProjection): BindProjectCalendarResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'calendar-already-bound', message: 'Project already has a bound Calendar', current,
    }),
  })
}

function calendarNotSelectable(): BindProjectCalendarResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'calendar-not-selectable', message: 'Calendar is not writable or supported',
    }),
  })
}

function calendarRemoteBindFailure(
  code: 'remote-outcome-unknown' | 'remote-rejected',
  issue: FeishuConnectionIssue,
): BindProjectCalendarResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message: 'Calendar access failed', issue: detachedIssue(issue) }) })
}

function calendarUnknownBinding(
  _effect: import('./client.ts').FeishuCalendarMutationEffectProjection,
): BindProjectCalendarResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-outcome-unknown', message: 'Calendar create outcome is unknown',
      issue: ambiguousCalendarTransportIssue(),
    }),
  })
}

function milestoneEventNotSelectable(): CreateProjectMilestoneResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'event-not-selectable', message: 'Event cannot back a T10 Milestone',
    }),
  })
}

function milestoneRemoteFailure(
  code: 'remote-outcome-unknown' | 'remote-rejected',
  issue: FeishuConnectionIssue,
): CreateProjectMilestoneResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message: 'Milestone event access failed', issue: detachedIssue(issue) }) })
}

function milestoneUnknownCreation(
  _effect: import('./client.ts').FeishuCalendarMutationEffectProjection,
): CreateProjectMilestoneResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-outcome-unknown', message: 'Milestone event create outcome is unknown',
      issue: ambiguousCalendarTransportIssue(),
    }),
  })
}

function milestoneNotFound(milestoneId: string): UpdateProjectMilestoneDateResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'milestone-not-found', message: `Milestone ${milestoneId} was not found` }),
  })
}

function milestoneDateRemoteFailure(
  code: 'remote-outcome-unknown' | 'remote-rejected',
  issue: FeishuConnectionIssue,
): UpdateProjectMilestoneDateResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message: 'Milestone date access failed', issue: detachedIssue(issue) }) })
}

function milestoneDateUnknown(
  effect: import('./client.ts').FeishuCalendarMutationEffectProjection,
): UpdateProjectMilestoneDateResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-outcome-unknown', message: 'Milestone date update outcome is unknown',
      effect: Object.freeze({ ...effect, state: 'unknown' }),
      issue: ambiguousCalendarTransportIssue(),
    }),
  })
}

function ambiguousCalendarTransportIssue(): FeishuConnectionIssue {
  return Object.freeze({
    code: 'unknown-provider-error',
    recovery: 'inspect-provider',
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function invalidCalendarIssue(): FeishuConnectionIssue {
  return Object.freeze({
    code: 'provider-response-invalid',
    recovery: 'inspect-provider',
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
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

function forbidden(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'forbidden', message, details: {} })
}

function infrastructure(message: string, cause?: unknown): TypertRemoteFailure {
  const failure = new TypertRemoteFailure({ code: 'internal', message, details: {} })
  if (cause !== undefined) Object.defineProperty(failure, 'cause', { value: cause })
  return failure
}
