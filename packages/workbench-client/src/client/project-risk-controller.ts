/** React-free Client state machine for one Project's Risk register. */

import type {
  CreateProjectRiskRequest,
  CreateProjectRiskResult,
  ProjectRiskAssessmentDraft,
  ProjectRiskCategory,
  ProjectRiskClosureReason,
  ProjectRiskConfidence,
  ProjectRiskConflict,
  ProjectRiskEvidenceRef,
  ProjectRiskImpactInterval,
  ProjectRiskProjection,
  ProjectRisksProjection,
  ProjectRisksQuery,
  ProjectRiskStatus,
  ProjectRiskTriggerState,
  ReviseProjectRiskRequest,
  ReviseProjectRiskResult,
  TransitionProjectRiskRequest,
  TransitionProjectRiskResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchProjectRisksPhase =
  | 'idle' | 'loading' | 'ready' | 'pending' | 'stale' | 'error' | 'conflict'
export type WorkbenchProjectRisksOperation =
  | 'read-risks' | 'create-risk' | 'revise-risk' | 'transition-risk'
export type WorkbenchProjectRisksTransportCode =
  | 'unavailable' | 'unauthorized' | 'forbidden' | 'rate-limited' | 'internal'
  | 'transport-failure'

type ProjectRiskDomainResult =
  | CreateProjectRiskResult | ReviseProjectRiskResult | TransitionProjectRiskResult
export type WorkbenchProjectRisksConflictCode = Extract<
  ProjectRiskDomainResult, { readonly ok: false }
>['error']['code'] | ProjectRiskConflict['code']

export interface WorkbenchProjectRisksIssue {
  readonly kind: 'transport' | 'input' | 'conflict'
  readonly code: WorkbenchProjectRisksTransportCode | 'bad-request' | 'project-not-found'
    | WorkbenchProjectRisksConflictCode
  readonly operation: WorkbenchProjectRisksOperation
}

export interface WorkbenchProjectRisksSelection {
  readonly projectId: string
  readonly projectName: string
}

/** Text-valued editor; semantic parsing happens only at command admission. */
export interface WorkbenchProjectRiskAssessmentEditorDraft {
  readonly condition: string
  readonly event: string
  readonly consequence: string
  readonly category: ProjectRiskCategory
  readonly triggerStatement: string
  readonly triggerState: ProjectRiskTriggerState
  readonly probabilityLowerBasisPoints: string
  readonly probabilityUpperBasisPoints: string
  readonly impactLowerBand: string
  readonly impactUpperBand: string
  readonly confidence: ProjectRiskConfidence
  readonly confidenceRationale: string
  readonly assessmentHorizonEnd: string
  readonly nextReviewOn: string
  readonly assumptions: readonly string[]
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string
  readonly evidence: readonly ProjectRiskEvidenceRef[]
  readonly dependencyRiskIds: readonly string[]
  readonly mitigationTaskGuids: readonly string[]
  readonly contingencyTaskGuids: readonly string[]
}

export interface WorkbenchProjectRiskRevisionDraft {
  readonly riskId: string
  readonly draft: WorkbenchProjectRiskAssessmentEditorDraft
}

export interface WorkbenchProjectRiskTransitionDraft {
  readonly status: ProjectRiskStatus
  readonly rationale: string
  readonly closureReason: ProjectRiskClosureReason | ''
}

/** Five UI filter groups; trigger/review groups each contain two closed fields. */
export interface WorkbenchProjectRiskFilters {
  readonly exposure: '' | 'low' | 'medium' | 'high'
  readonly status: '' | ProjectRiskStatus
  readonly riskOwnerMemberId: string
  readonly triggerState: '' | ProjectRiskTriggerState
  readonly triggerContains: string
  readonly reviewFrom: string
  readonly reviewTo: string
}

export interface WorkbenchProjectRisksClientState {
  readonly phase: WorkbenchProjectRisksPhase
  readonly selection: WorkbenchProjectRisksSelection | null
  /** Last Host-confirmed projection; browser drafts never replace it. */
  readonly projection: ProjectRisksProjection | null
  readonly filters: WorkbenchProjectRiskFilters
  readonly selectedRiskId: string | null
  readonly createDraft: WorkbenchProjectRiskAssessmentEditorDraft
  readonly revisionDraft: WorkbenchProjectRiskRevisionDraft | null
  readonly transitionDrafts: Readonly<Record<string, WorkbenchProjectRiskTransitionDraft>>
  readonly pendingOperation: 'create-risk' | 'revise-risk' | 'transition-risk' | null
  readonly pendingRiskId: string | null
  readonly loadingMore: 'risks' | 'activity' | 'history' | null
  readonly issue: WorkbenchProjectRisksIssue | null
  readonly canRetryMutation: boolean
  readonly focusRiskId: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` T12 subset consumed by the Client. */
export interface WorkbenchProjectRisksRemote {
  projectRisks(
    query: ProjectRisksQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectRisksProjection | null>>
  createProjectRisk(
    request: CreateProjectRiskRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<CreateProjectRiskResult>>
  reviseProjectRisk(
    request: ReviseProjectRiskRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ReviseProjectRiskResult>>
  transitionProjectRisk(
    request: TransitionProjectRiskRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<TransitionProjectRiskResult>>
}

export interface WorkbenchProjectRisksControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
  readonly pageSize?: number
}

type MutationEnvelope =
  | Readonly<{ readonly kind: 'create-risk'; readonly request: CreateProjectRiskRequest }>
  | Readonly<{
    readonly kind: 'revise-risk'
    readonly riskId: string
    readonly request: ReviseProjectRiskRequest
  }>
  | Readonly<{
    readonly kind: 'transition-risk'
    readonly riskId: string
    readonly request: TransitionProjectRiskRequest
  }>

type ReadMode = 'replace' | 'risks' | 'activity' | 'history'

export const MAX_PROJECT_RISK_STATEMENT_LENGTH = 2_000
export const MAX_PROJECT_RISK_TRIGGER_LENGTH = 1_000
export const MAX_PROJECT_RISK_CONFIDENCE_RATIONALE_LENGTH = 2_000
export const MAX_PROJECT_RISK_ASSUMPTION_LENGTH = 1_000
export const MAX_PROJECT_RISK_ASSUMPTIONS = 20
export const MAX_PROJECT_RISK_CONTRIBUTORS = 20
export const MAX_PROJECT_RISK_EVIDENCE = 20
export const MAX_PROJECT_RISK_DEPENDENCIES = 20
export const MAX_PROJECT_RISK_TREATMENT_TASKS = 50
export const MAX_PROJECT_RISK_TRANSITION_RATIONALE_LENGTH = 2_000

const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectRisksTransportCode>([
  'unavailable', 'unauthorized', 'forbidden', 'rate-limited', 'internal', 'transport-failure',
])
const AMBIGUOUS_TRANSPORT_CODES = new Set<WorkbenchProjectRisksTransportCode>([
  'unavailable', 'internal', 'transport-failure',
])
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const DEFAULT_PAGE_SIZE = 50

function emptyFilters(): WorkbenchProjectRiskFilters {
  return Object.freeze({
    exposure: '', status: '', riskOwnerMemberId: '', triggerState: '', triggerContains: '',
    reviewFrom: '', reviewTo: '',
  })
}

function emptyAssessmentDraft(): WorkbenchProjectRiskAssessmentEditorDraft {
  return Object.freeze({
    condition: '', event: '', consequence: '', category: 'schedule',
    triggerStatement: '', triggerState: 'unknown',
    probabilityLowerBasisPoints: '', probabilityUpperBasisPoints: '',
    impactLowerBand: '', impactUpperBand: '', confidence: 'low', confidenceRationale: '',
    assessmentHorizonEnd: '', nextReviewOn: '', assumptions: Object.freeze([]),
    accountableMemberId: '', contributorMemberIds: Object.freeze([]), humanSponsorMemberId: '',
    evidence: Object.freeze([]), dependencyRiskIds: Object.freeze([]),
    mitigationTaskGuids: Object.freeze([]), contingencyTaskGuids: Object.freeze([]),
  })
}

export const INITIAL_WORKBENCH_PROJECT_RISKS_STATE: WorkbenchProjectRisksClientState
  = Object.freeze({
    phase: 'idle', selection: null, projection: null, filters: emptyFilters(),
    selectedRiskId: null, createDraft: emptyAssessmentDraft(), revisionDraft: null,
    transitionDrafts: Object.freeze({}), pendingOperation: null, pendingRiskId: null,
    loadingMore: null, issue: null, canRetryMutation: false,
    focusRiskId: null, focusEpoch: 0,
  })

/**
 * Owns recoverable Risk drafts, filtered reads, three independent cursors, and
 * exact ambiguous replay identity. Host remains sole assessment/status authority.
 */
export class WorkbenchProjectRisksController {
  private state = INITIAL_WORKBENCH_PROJECT_RISKS_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private readEpoch = 0
  private mutationEpoch = 0
  private readAbort: AbortController | null = null
  private mutationAbort: AbortController | null = null
  private retryEnvelope: MutationEnvelope | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchProjectRisksRemote,
    private readonly options: WorkbenchProjectRisksControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectRisksClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  selectProject(projectId: string | null, projectName = ''): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    const normalized = projectId?.trim() ?? ''
    if (normalized === '') {
      this.clearSelection()
      return Promise.resolve()
    }
    if (this.state.selection?.projectId === normalized) {
      if (projectName !== '' && projectName !== this.state.selection.projectName) {
        this.publish({
          ...this.state,
          selection: Object.freeze({ projectId: normalized, projectName }),
        })
      }
      return Promise.resolve()
    }
    this.cancelAll('Workbench Risks switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_PROJECT_RISKS_STATE,
      phase: 'loading',
      selection: Object.freeze({ projectId: normalized, projectName }),
      filters: emptyFilters(),
      createDraft: emptyAssessmentDraft(),
    })
    return this.track(this.doRead('replace'))
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Risks selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_PROJECT_RISKS_STATE)
  }

  refresh(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    return this.track(this.doRead('replace'))
  }

  setFilters(filters: WorkbenchProjectRiskFilters): void {
    if (!this.canEdit()) return
    this.publish({ ...this.state, filters: freezeFilters(filters), issue: null })
  }

  applyFilters(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    const filters = normalizedFilters(this.state.filters)
    if (filters === null) {
      this.publish({
        ...this.state,
        phase: 'error',
        issue: Object.freeze({ kind: 'input', code: 'bad-request', operation: 'read-risks' }),
      })
      return Promise.resolve()
    }
    this.publish({ ...this.state, filters, issue: null })
    return this.track(this.doRead('replace', filters))
  }

  selectRisk(riskId: string | null): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    const normalized = riskId?.trim() ?? ''
    this.publish({
      ...this.state,
      selectedRiskId: normalized === '' ? null : normalized,
      issue: null,
    })
    return this.track(this.doRead('replace'))
  }

  loadMoreRisks(): Promise<void> {
    if (!this.canRead() || this.state.projection?.nextBeforeRiskSequence === null
      || this.state.projection === null) return Promise.resolve()
    return this.track(this.doRead('risks'))
  }

  loadMoreActivity(): Promise<void> {
    if (!this.canRead() || this.state.projection?.nextBeforeActivitySequence === null
      || this.state.projection === null) return Promise.resolve()
    return this.track(this.doRead('activity'))
  }

  loadMoreHistory(): Promise<void> {
    const selected = this.state.projection?.selectedRisk
    if (!this.canRead() || selected === null || selected === undefined
      || selected.nextBeforeHistorySequence === null) return Promise.resolve()
    return this.track(this.doRead('history'))
  }

  setCreateDraft(draft: WorkbenchProjectRiskAssessmentEditorDraft): void {
    if (!this.canEdit()) return
    if (this.retryEnvelope?.kind === 'create-risk') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      createDraft: freezeAssessmentDraft(draft),
      issue: this.state.issue?.operation === 'create-risk' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  beginRevision(riskId: string): void {
    if (!this.canEdit()) return
    const item = this.risk(riskId)
    if (item === null || item.status === 'closed') return
    if (this.retryEnvelope?.kind === 'revise-risk') this.retryEnvelope = null
    this.publish({
      ...this.state,
      revisionDraft: Object.freeze({ riskId: item.riskId, draft: draftFromAssessment(item) }),
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  cancelRevision(): void {
    if (!this.canEdit()) return
    if (this.retryEnvelope?.kind === 'revise-risk') this.retryEnvelope = null
    this.publish({ ...this.state, revisionDraft: null, canRetryMutation: false })
  }

  setRevisionDraft(draft: WorkbenchProjectRiskAssessmentEditorDraft): void {
    if (!this.canEdit() || this.state.revisionDraft === null) return
    if (this.retryEnvelope?.kind === 'revise-risk') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      revisionDraft: Object.freeze({
        riskId: this.state.revisionDraft.riskId,
        draft: freezeAssessmentDraft(draft),
      }),
      issue: this.state.issue?.operation === 'revise-risk' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  setTransitionDraft(riskId: string, draft: WorkbenchProjectRiskTransitionDraft): void {
    if (!this.canEdit() || this.risk(riskId)?.status === 'closed') return
    if (this.retryEnvelope?.kind === 'transition-risk'
      && this.retryEnvelope.riskId === riskId) this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      transitionDrafts: Object.freeze({
        ...this.state.transitionDrafts,
        [riskId]: freezeTransitionDraft(draft),
      }),
      issue: this.state.issue?.operation === 'transition-risk' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  canCreate(): boolean {
    return this.canOperate()
      && this.assessmentFromDraft(this.state.createDraft, null) !== null
  }

  create(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const assessment = this.assessmentFromDraft(this.state.createDraft, null)
    if (!this.canOperate() || selection === null || projection === null || assessment === null) {
      return Promise.resolve()
    }
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'create-risk',
      request: Object.freeze({
        projectId: selection.projectId,
        assessment,
        expectedRisksRevision: projection.revision,
        expectedRiskRevision: null,
        expectedTeamRevision: projection.teamRevision,
        expectedTaskRevision: projection.taskRevision,
        ...this.correlation(),
        reason: 'owner-project-risk-create' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  canRevise(): boolean {
    const revision = this.state.revisionDraft
    if (!this.canOperate() || revision === null) return false
    const item = this.risk(revision.riskId)
    if (item === null || item.status === 'closed') return false
    const assessment = this.assessmentFromDraft(revision.draft, item.riskId)
    return assessment !== null
      && (item.status !== 'mitigate' || assessment.mitigationTaskGuids.length > 0)
  }

  revise(): Promise<void> {
    const projection = this.state.projection
    const revision = this.state.revisionDraft
    if (!this.canRevise() || projection === null || revision === null) return Promise.resolve()
    const item = this.risk(revision.riskId)
    const assessment = this.assessmentFromDraft(revision.draft, revision.riskId)
    if (item === null || assessment === null) return Promise.resolve()
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'revise-risk', riskId: item.riskId,
      request: Object.freeze({
        projectId: projection.projectId,
        riskId: item.riskId,
        assessment,
        expectedRisksRevision: projection.revision,
        expectedRiskRevision: item.revision,
        expectedTeamRevision: projection.teamRevision,
        expectedTaskRevision: projection.taskRevision,
        ...this.correlation(),
        reason: 'owner-project-risk-revise' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  canTransition(riskId: string): boolean {
    if (!this.canOperate()) return false
    const item = this.risk(riskId)
    const draft = this.state.transitionDrafts[riskId]
    if (item === null || item.status === 'closed' || draft === undefined
      || draft.status === item.status
      || safeRequiredText(
        draft.rationale,
        MAX_PROJECT_RISK_TRANSITION_RATIONALE_LENGTH,
      ) === null) return false
    if (draft.status === 'closed') {
      if (draft.closureReason === '') return false
    } else if (draft.closureReason !== '') return false
    if (draft.status === 'mitigate' && !item.treatmentTasks.some(link =>
      link.role === 'mitigation' && link.availability === 'available')) return false
    return true
  }

  transition(riskId: string): Promise<void> {
    const projection = this.state.projection
    const item = this.risk(riskId)
    const draft = this.state.transitionDrafts[riskId]
    if (!this.canTransition(riskId) || projection === null || item === null || draft === undefined) {
      return Promise.resolve()
    }
    const base = {
      projectId: projection.projectId,
      riskId: item.riskId,
      rationale: draft.rationale.trim(),
      expectedRisksRevision: projection.revision,
      expectedRiskRevision: item.revision,
      expectedTaskRevision: projection.taskRevision,
      ...this.correlation(),
      reason: 'owner-project-risk-transition' as const,
    }
    let request: TransitionProjectRiskRequest
    if (draft.status === 'closed') {
      if (draft.closureReason === '') return Promise.resolve()
      request = Object.freeze({
        ...base,
        status: 'closed' as const,
        closureReason: draft.closureReason,
      })
    } else {
      request = Object.freeze({ ...base, status: draft.status })
    }
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'transition-risk', riskId: item.riskId, request,
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  retryMutation(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null
      || this.retryEnvelope === null) return Promise.resolve()
    return this.track(this.doMutation(this.retryEnvelope))
  }

  markDisconnected(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Risks connection generation changed')
    this.publish({
      ...this.state,
      phase: this.state.selection === null ? 'idle' : 'stale',
      pendingOperation: null,
      pendingRiskId: null,
      loadingMore: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  connectionReset(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    this.cancelAll('Workbench Risks connection generation changed')
    this.publish({
      ...this.state, phase: 'stale', pendingOperation: null, pendingRiskId: null,
      loadingMore: null,
    })
    return this.track(this.doRead('replace'))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Risks Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_RISKS_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRead(
    mode: ReadMode,
    filters: WorkbenchProjectRiskFilters = this.state.filters,
  ): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Risks read was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    this.publish({
      ...this.state,
      phase: mode === 'replace' ? 'loading' : this.state.phase,
      loadingMore: mode === 'replace' ? null : mode,
      issue: null,
    })
    try {
      const result = await this.remote.projectRisks(
        this.readQuery(mode, filters),
        abort.signal,
      )
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      if (!result.ok) return this.publishReadFailure(result.error)
      if (result.value === null) {
        this.publish({
          ...this.state,
          phase: 'error',
          loadingMore: null,
          issue: Object.freeze({
            kind: 'input', code: 'project-not-found', operation: 'read-risks',
          }),
        })
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        projection: mergeProjection(this.state.projection, result.value, mode),
        loadingMore: null,
        issue: null,
        canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      this.publishReadFailure(error)
    }
  }

  private readQuery(
    mode: ReadMode,
    filters: WorkbenchProjectRiskFilters,
  ): ProjectRisksQuery {
    const selection = this.state.selection
    if (selection === null) throw new Error('Risk selection missing')
    const pageSize = this.options.pageSize ?? DEFAULT_PAGE_SIZE
    const projection = this.state.projection
    const selected = this.state.selectedRiskId
    return Object.freeze({
      projectId: selection.projectId,
      ...filters.exposure === '' ? {} : { exposure: filters.exposure },
      ...filters.status === '' ? {} : { status: filters.status },
      ...filters.riskOwnerMemberId === ''
        ? {} : { riskOwnerMemberId: filters.riskOwnerMemberId.trim() },
      ...filters.triggerState === '' ? {} : { triggerState: filters.triggerState },
      ...filters.triggerContains.trim() === ''
        ? {} : { triggerContains: filters.triggerContains.trim() },
      ...filters.reviewFrom === '' ? {} : { reviewFrom: filters.reviewFrom },
      ...filters.reviewTo === '' ? {} : { reviewTo: filters.reviewTo },
      ...selected === null ? {} : { selectedRiskId: selected },
      riskLimit: pageSize,
      activityLimit: pageSize,
      historyLimit: pageSize,
      ...mode === 'risks' && projection?.nextBeforeRiskSequence !== null
        && projection?.nextBeforeRiskSequence !== undefined
        ? { beforeRiskSequence: projection.nextBeforeRiskSequence } : {},
      ...mode === 'activity' && projection?.nextBeforeActivitySequence !== null
        && projection?.nextBeforeActivitySequence !== undefined
        ? { beforeActivitySequence: projection.nextBeforeActivitySequence } : {},
      ...mode === 'history'
        && projection?.selectedRisk?.nextBeforeHistorySequence !== null
        && projection?.selectedRisk?.nextBeforeHistorySequence !== undefined
        ? { beforeHistorySequence: projection.selectedRisk.nextBeforeHistorySequence } : {},
    })
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    const projectId = envelope.request.projectId
    if (this.disposed || this.state.selection?.projectId !== projectId
      || this.state.pendingOperation !== null) return
    const epoch = ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench Risks mutation was superseded'))
    const abort = new AbortController()
    this.mutationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.kind,
      pendingRiskId: envelope.kind === 'create-risk' ? null : envelope.riskId,
      issue: null,
      canRetryMutation: false,
      focusRiskId: null,
    })
    let result: RemoteResult<ProjectRiskDomainResult>
    try {
      if (envelope.kind === 'create-risk') {
        result = await this.remote.createProjectRisk(envelope.request, abort.signal)
      } else if (envelope.kind === 'revise-risk') {
        result = await this.remote.reviseProjectRisk(envelope.request, abort.signal)
      } else {
        result = await this.remote.transitionProjectRisk(envelope.request, abort.signal)
      }
    } catch (error) {
      if (!this.acceptMutation(epoch, abort, projectId)) return
      this.mutationAbort = null
      return this.publishMutationFailure(envelope, error)
    }
    if (!this.acceptMutation(epoch, abort, projectId)) return
    this.mutationAbort = null
    if (!result.ok) return this.publishMutationFailure(envelope, result.error)
    const outcome = result.value
    if (!outcome.ok) {
      this.retryEnvelope = null
      this.publish({
        ...this.state,
        phase: 'conflict',
        pendingOperation: null,
        pendingRiskId: null,
        issue: Object.freeze({
          kind: 'conflict', code: outcome.error.code, operation: envelope.kind,
        }),
        canRetryMutation: false,
      })
      return
    }
    this.retryEnvelope = null
    let createDraft = this.state.createDraft
    let revisionDraft = this.state.revisionDraft
    let transitionDrafts = this.state.transitionDrafts
    if (envelope.kind === 'create-risk') createDraft = emptyAssessmentDraft()
    if (envelope.kind === 'revise-risk') revisionDraft = null
    if (envelope.kind === 'transition-risk') {
      const next = { ...transitionDrafts }
      delete next[envelope.riskId]
      transitionDrafts = Object.freeze(next)
    }
    this.publish({
      ...this.state,
      phase: 'ready',
      projection: detachProjection(outcome.value),
      createDraft,
      revisionDraft,
      transitionDrafts,
      pendingOperation: null,
      pendingRiskId: null,
      issue: null,
      canRetryMutation: false,
      focusRiskId: outcome.risk.riskId,
      focusEpoch: this.state.focusEpoch + 1,
    })
    this.notifyCommitted(outcome.receipt)
  }

  private assessmentFromDraft(
    draft: WorkbenchProjectRiskAssessmentEditorDraft,
    riskId: string | null,
  ): ProjectRiskAssessmentDraft | null {
    const projection = this.state.projection
    if (projection === null) return null
    const condition = safeOptionalText(draft.condition, MAX_PROJECT_RISK_STATEMENT_LENGTH)
    const event = safeRequiredText(draft.event, MAX_PROJECT_RISK_STATEMENT_LENGTH)
    const consequence = safeRequiredText(draft.consequence, MAX_PROJECT_RISK_STATEMENT_LENGTH)
    const triggerStatement = safeRequiredText(
      draft.triggerStatement,
      MAX_PROJECT_RISK_TRIGGER_LENGTH,
    )
    const confidenceRationale = safeRequiredText(
      draft.confidenceRationale,
      MAX_PROJECT_RISK_CONFIDENCE_RATIONALE_LENGTH,
    )
    const probabilityLower = parseInteger(draft.probabilityLowerBasisPoints, 0, 10_000)
    const probabilityUpper = parseInteger(draft.probabilityUpperBasisPoints, 1, 10_000)
    const impactLower = parseInteger(draft.impactLowerBand, 1, 5)
    const impactUpper = parseInteger(draft.impactUpperBand, 1, 5)
    if (condition === null || event === null || consequence === null || triggerStatement === null
      || confidenceRationale === null || probabilityLower === null || probabilityUpper === null
      || impactLower === null || impactUpper === null || probabilityLower > probabilityUpper
      || impactLower > impactUpper || !validIsoDate(draft.assessmentHorizonEnd)
      || !validIsoDate(draft.nextReviewOn)
      || draft.nextReviewOn > draft.assessmentHorizonEnd) return null
    const assumptions = draft.assumptions.map(value =>
      safeRequiredText(value, MAX_PROJECT_RISK_ASSUMPTION_LENGTH))
    if (assumptions.length > MAX_PROJECT_RISK_ASSUMPTIONS
      || assumptions.some(value => value === null)) return null
    const accountable = projection.memberOptions.find(member =>
      member.memberId === draft.accountableMemberId && member.status === 'active')
    if (accountable === undefined) return null
    const contributors = canonicalSet(draft.contributorMemberIds)
    if (contributors === null || contributors.length > MAX_PROJECT_RISK_CONTRIBUTORS
      || contributors.includes(accountable.memberId)
      || contributors.some(id => !projection.memberOptions.some(member =>
        member.memberId === id && member.status === 'active'))) return null
    const sponsor = draft.humanSponsorMemberId.trim()
    if (accountable.requiresHumanSponsor) {
      if (sponsor === '' || sponsor === accountable.memberId
        || !projection.memberOptions.some(member =>
          member.memberId === sponsor && member.status === 'active' && member.canBeHumanSponsor)) {
        return null
      }
    } else if (sponsor !== '') return null
    const evidence = canonicalEvidence(draft.evidence)
    if (evidence === null || evidence.length > MAX_PROJECT_RISK_EVIDENCE
      || evidence.some(ref => !projection.evidenceOptions.some(option => sameEvidence(option, ref)))) {
      return null
    }
    const dependencyRiskIds = canonicalSet(draft.dependencyRiskIds)
    if (dependencyRiskIds === null || dependencyRiskIds.length > MAX_PROJECT_RISK_DEPENDENCIES
      || (riskId !== null && dependencyRiskIds.includes(riskId))
      || dependencyRiskIds.some(id => !projection.dependencyOptions.some(option =>
        option.riskId === id && option.selectable))) return null
    const mitigationTaskGuids = canonicalSet(draft.mitigationTaskGuids)
    const contingencyTaskGuids = canonicalSet(draft.contingencyTaskGuids)
    if (mitigationTaskGuids === null || contingencyTaskGuids === null
      || mitigationTaskGuids.length > MAX_PROJECT_RISK_TREATMENT_TASKS
      || contingencyTaskGuids.length > MAX_PROJECT_RISK_TREATMENT_TASKS
      || mitigationTaskGuids.some(id => contingencyTaskGuids.includes(id))
      || [...mitigationTaskGuids, ...contingencyTaskGuids].some(id =>
        !projection.taskOptions.some(task => task.taskGuid === id))) return null
    return Object.freeze({
      statement: Object.freeze({ condition: condition === '' ? null : condition, event, consequence }),
      category: draft.category,
      trigger: Object.freeze({ statement: triggerStatement, state: draft.triggerState }),
      probability: Object.freeze({
        lowerBasisPoints: probabilityLower,
        upperBasisPoints: probabilityUpper,
      }),
      impact: Object.freeze({
        lowerBand: impactLower as ProjectRiskImpactInterval['lowerBand'],
        upperBand: impactUpper as ProjectRiskImpactInterval['upperBand'],
      }),
      confidence: draft.confidence,
      confidenceRationale,
      assessmentHorizonEnd: draft.assessmentHorizonEnd,
      nextReviewOn: draft.nextReviewOn,
      assumptions: Object.freeze(assumptions as string[]),
      accountableMemberId: accountable.memberId,
      contributorMemberIds: Object.freeze(contributors),
      humanSponsorMemberId: sponsor === '' ? null : sponsor,
      evidence: Object.freeze(evidence),
      dependencies: Object.freeze(dependencyRiskIds.map(id => Object.freeze({
        kind: 'depends-on' as const, riskId: id,
      }))),
      mitigationTaskGuids: Object.freeze(mitigationTaskGuids),
      contingencyTaskGuids: Object.freeze(contingencyTaskGuids),
    })
  }

  private risk(riskId: string): ProjectRiskProjection | null {
    const projection = this.state.projection
    if (projection === null) return null
    const listed = projection.risks.find(item => item.riskId === riskId)
    if (listed !== undefined) return listed
    return projection.selectedRisk?.risk.riskId === riskId ? projection.selectedRisk.risk : null
  }

  private publishReadFailure(error: unknown): void {
    const issue = classifyIssue(error, 'read-risks')
    this.publish({ ...this.state, phase: 'error', loadingMore: null, issue })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private publishMutationFailure(envelope: MutationEnvelope, error: unknown): void {
    const issue = classifyIssue(error, envelope.kind)
    if (issue.kind !== 'transport' || !AMBIGUOUS_TRANSPORT_CODES.has(
      issue.code as WorkbenchProjectRisksTransportCode,
    )) this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingRiskId: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private canRead(): boolean {
    return this.admitProtectedOperation() && this.state.selection !== null
      && this.state.pendingOperation === null && this.state.loadingMore === null
  }
  private canEdit(): boolean {
    return this.admitProtectedOperation() && this.state.pendingOperation === null
  }
  private canOperate(): boolean {
    return this.canEdit() && this.state.selection !== null && this.state.projection !== null
      && this.state.phase !== 'loading' && this.state.phase !== 'stale'
  }
  private acceptRead(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed && this.state.selection?.projectId === projectId
      && this.readEpoch === epoch && this.readAbort === abort && !abort.signal.aborted
  }
  private acceptMutation(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed && this.state.selection?.projectId === projectId
      && this.mutationEpoch === epoch && this.mutationAbort === abort && !abort.signal.aborted
  }
  private notifyCommitted(value: WorkbenchCommandReceipt): void {
    try { this.options.onCommitted?.(Object.freeze({ ...value })) } catch {
      console.error('[workbench-client] Risks committed observer failed')
    }
  }
  private notifyTransportFailure(): void {
    try { this.options.onTransportFailure?.() } catch {
      console.error('[workbench-client] Risks transport observer failed')
    }
  }
  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try { return this.options.onBeforeProtectedOperation?.() ?? true } catch {
      console.error('[workbench-client] Risks admission observer failed')
      return false
    }
  }
  private cancelAll(reason: string): void {
    ++this.readEpoch
    ++this.mutationEpoch
    this.readAbort?.abort(new Error(reason))
    this.mutationAbort?.abort(new Error(reason))
    this.readAbort = null
    this.mutationAbort = null
  }
  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(() => { this.inFlight.delete(pending) }, () => { this.inFlight.delete(pending) })
    return pending
  }
  private publish(next: WorkbenchProjectRisksClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try { listener() } catch { console.error('[workbench-client] Risks observer failed') }
    }
  }
}

function draftFromAssessment(item: ProjectRiskProjection): WorkbenchProjectRiskAssessmentEditorDraft {
  const value = item.currentAssessment
  return freezeAssessmentDraft({
    condition: value.statement.condition ?? '', event: value.statement.event,
    consequence: value.statement.consequence, category: value.category,
    triggerStatement: value.trigger.statement, triggerState: value.trigger.state,
    probabilityLowerBasisPoints: String(value.probability.lowerBasisPoints),
    probabilityUpperBasisPoints: String(value.probability.upperBasisPoints),
    impactLowerBand: String(value.impact.lowerBand), impactUpperBand: String(value.impact.upperBand),
    confidence: value.confidence, confidenceRationale: value.confidenceRationale,
    assessmentHorizonEnd: value.assessmentHorizonEnd, nextReviewOn: value.nextReviewOn,
    assumptions: value.assumptions,
    accountableMemberId: value.responsibility.accountable.memberId,
    contributorMemberIds: value.responsibility.contributors.map(member => member.memberId),
    humanSponsorMemberId: value.responsibility.humanSponsor?.memberId ?? '',
    evidence: value.evidence, dependencyRiskIds: value.dependencies.map(link => link.riskId),
    mitigationTaskGuids: value.mitigationTaskGuids,
    contingencyTaskGuids: value.contingencyTaskGuids,
  })
}

function freezeAssessmentDraft(
  value: WorkbenchProjectRiskAssessmentEditorDraft,
): WorkbenchProjectRiskAssessmentEditorDraft {
  return Object.freeze({
    ...value,
    assumptions: Object.freeze([...value.assumptions]),
    contributorMemberIds: Object.freeze([...value.contributorMemberIds]),
    evidence: Object.freeze(value.evidence.map(ref => Object.freeze({ ...ref }))),
    dependencyRiskIds: Object.freeze([...value.dependencyRiskIds]),
    mitigationTaskGuids: Object.freeze([...value.mitigationTaskGuids]),
    contingencyTaskGuids: Object.freeze([...value.contingencyTaskGuids]),
  })
}

function freezeTransitionDraft(
  value: WorkbenchProjectRiskTransitionDraft,
): WorkbenchProjectRiskTransitionDraft {
  return Object.freeze({ ...value })
}

function freezeFilters(value: WorkbenchProjectRiskFilters): WorkbenchProjectRiskFilters {
  return Object.freeze({ ...value })
}

function normalizedFilters(
  value: WorkbenchProjectRiskFilters,
): WorkbenchProjectRiskFilters | null {
  const reviewFrom = value.reviewFrom.trim()
  const reviewTo = value.reviewTo.trim()
  if ((reviewFrom !== '' && !validIsoDate(reviewFrom))
    || (reviewTo !== '' && !validIsoDate(reviewTo))
    || (reviewFrom !== '' && reviewTo !== '' && reviewFrom > reviewTo)) return null
  return Object.freeze({
    ...value,
    riskOwnerMemberId: value.riskOwnerMemberId.trim(),
    triggerContains: value.triggerContains.trim(),
    reviewFrom,
    reviewTo,
  })
}

function mergeProjection(
  current: ProjectRisksProjection | null,
  incoming: ProjectRisksProjection,
  mode: ReadMode,
): ProjectRisksProjection {
  if (current === null || mode === 'replace' || current.projectId !== incoming.projectId) {
    return detachProjection(incoming)
  }
  if (mode === 'risks') {
    return detachProjection({
      ...incoming,
      risks: mergeBySequence(current.risks, incoming.risks),
      selectedRisk: current.selectedRisk,
      activity: current.activity,
      nextBeforeActivitySequence: current.nextBeforeActivitySequence,
    })
  }
  if (mode === 'activity') {
    return detachProjection({
      ...incoming,
      risks: current.risks,
      nextBeforeRiskSequence: current.nextBeforeRiskSequence,
      selectedRisk: current.selectedRisk,
      activity: mergeBySequence(current.activity, incoming.activity),
    })
  }
  if (mode === 'history' && current.selectedRisk !== null && incoming.selectedRisk !== null
    && current.selectedRisk.risk.riskId === incoming.selectedRisk.risk.riskId) {
    return detachProjection({
      ...incoming,
      risks: current.risks,
      nextBeforeRiskSequence: current.nextBeforeRiskSequence,
      activity: current.activity,
      nextBeforeActivitySequence: current.nextBeforeActivitySequence,
      selectedRisk: {
        ...incoming.selectedRisk,
        history: mergeBySequence(current.selectedRisk.history, incoming.selectedRisk.history),
      },
    })
  }
  return detachProjection(incoming)
}

function mergeBySequence<T extends { readonly sequence: number }>(
  current: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  const values = new Map<number, T>()
  for (const item of [...current, ...incoming]) values.set(item.sequence, item)
  return Object.freeze([...values.values()].sort((left, right) => right.sequence - left.sequence))
}

function detachProjection(value: ProjectRisksProjection): ProjectRisksProjection {
  return structuredClone(value)
}

function safeRequiredText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed() && [...normalized].length >= 1
    && [...normalized].length <= maximum && !CONTROL_CHARACTER.test(normalized)
    ? normalized : null
}

/** Empty optional text is valid; null means malformed or overlong. */
function safeOptionalText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed() && [...normalized].length <= maximum
    && !CONTROL_CHARACTER.test(normalized) ? normalized : null
}

function parseInteger(value: string, minimum: number, maximum: number): number | null {
  const normalized = value.trim()
  if (!/^-?\d+$/u.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function validIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || year > 9_999 || month < 1 || month > 12 || day < 1) return false
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= days
}

function canonicalSet(values: readonly string[]): string[] | null {
  const normalized = values.map(value => value.trim())
  if (normalized.some(value => value === '') || new Set(normalized).size !== normalized.length) {
    return null
  }
  return normalized.sort()
}

function canonicalEvidence(values: readonly ProjectRiskEvidenceRef[]): ProjectRiskEvidenceRef[] | null {
  const normalized = values.map(ref => Object.freeze({ ...ref }))
  const identities = normalized.map(evidenceIdentity)
  if (new Set(identities).size !== identities.length) return null
  return normalized.sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right)))
}

function evidenceIdentity(value: ProjectRiskEvidenceRef): string {
  return value.kind === 'workbench-audit-event'
    ? `audit:${value.auditEventId}` : `schedule:${value.scheduleChangeId}`
}

function sameEvidence(
  option: ProjectRisksProjection['evidenceOptions'][number],
  value: ProjectRiskEvidenceRef,
): boolean {
  return option.kind === value.kind
    && (option.kind === 'workbench-audit-event' && value.kind === 'workbench-audit-event'
      ? option.auditEventId === value.auditEventId
      : option.kind === 'project-schedule-change' && value.kind === 'project-schedule-change'
        && option.scheduleChangeId === value.scheduleChangeId)
}

function classifyIssue(
  error: unknown,
  operation: WorkbenchProjectRisksOperation,
): WorkbenchProjectRisksIssue {
  const candidate = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectRisksTransportCode)
    ? candidate as WorkbenchProjectRisksTransportCode : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}
