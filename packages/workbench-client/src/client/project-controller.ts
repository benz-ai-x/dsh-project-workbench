/** React-free Client state machine for Project creation and detail projections. */

import type {
  CreateProjectRequest,
  CreateProjectResult,
  OutcomeMetricDirection,
  ProjectDetailProjection,
  ProjectQuery,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectSummaryProjection,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchProjectPhase =
  | 'loading'
  | 'ready'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

export type WorkbenchProjectConflictCode =
  | 'idempotency-conflict'
  | 'catalog-revision-conflict'
  | 'supporting-goal-conflict'
  | 'template-version-conflict'

export type WorkbenchProjectTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

export interface WorkbenchProjectTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchProjectTransportCode
}

export interface WorkbenchProjectInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request' | 'project-not-found'
}

export interface WorkbenchProjectConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchProjectConflictCode
}

export type WorkbenchProjectIssue =
  | WorkbenchProjectTransportIssue
  | WorkbenchProjectInputIssue
  | WorkbenchProjectConflictIssue

/** Text-valued metric editor; numeric parsing happens only at command admission. */
export interface WorkbenchOutcomeDraft {
  readonly key: string
  readonly name: string
  readonly metricName: string
  readonly initialValue: string
  readonly targetValue: string
  readonly unit: string
  readonly direction: OutcomeMetricDirection
}

/** A detached Goal selection retains its optimistic-concurrency precondition. */
export interface WorkbenchSupportingGoalDraft {
  readonly projectId: string
  readonly projectName: string
  readonly goalId: string
  readonly goalName: string
  readonly expectedRevision: number
}

/** Complete recoverable create form owned by this controller. */
export interface WorkbenchProjectDraft {
  readonly projectName: string
  readonly primaryGoalName: string
  readonly outcomes: readonly WorkbenchOutcomeDraft[]
  readonly supportingGoals: readonly WorkbenchSupportingGoalDraft[]
}

export interface WorkbenchProjectClientState {
  readonly phase: WorkbenchProjectPhase
  readonly start: ProjectStartProjection | null
  readonly detail: ProjectDetailProjection | null
  readonly draft: WorkbenchProjectDraft
  readonly draftDirty: boolean
  readonly pending: boolean
  readonly loadingMore: boolean
  readonly openingProjectId: string | null
  readonly issue: WorkbenchProjectIssue | null
  /** Incremented only when a successful create/open should move focus to detail. */
  readonly detailFocusEpoch: number
}

/** Generated `remote.workbench` subset used by the Project controller. */
export interface WorkbenchProjectRemote {
  projectStart(
    filter: ProjectStartFilter,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectStartProjection>>
  createProject(
    request: CreateProjectRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<CreateProjectResult>>
  project(
    query: ProjectQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectDetailProjection | null>>
}

export interface WorkbenchProjectControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
  readonly nextOutcomeKey?: () => string
  readonly pageSize?: number
}

interface RetryEnvelope {
  readonly draftFingerprint: string
  readonly request: CreateProjectRequest
}

const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])

const DEFAULT_PAGE_SIZE = 20
export const MAX_PROJECT_TEXT_LENGTH = 200
export const MAX_PROJECT_METRIC_NAME_LENGTH = 120
export const MAX_PROJECT_UNIT_LENGTH = 64
export const MAX_PROJECT_OUTCOME_COUNT = 20
export const MAX_PROJECT_SUPPORTING_GOAL_COUNT = 20
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

function emptyOutcome(key: string): WorkbenchOutcomeDraft {
  return Object.freeze({
    key,
    name: '',
    metricName: '',
    initialValue: '',
    targetValue: '',
    unit: '',
    direction: 'increase',
  })
}

function emptyDraft(outcomeKey = 'outcome-1'): WorkbenchProjectDraft {
  return Object.freeze({
    projectName: '',
    primaryGoalName: '',
    outcomes: Object.freeze([emptyOutcome(outcomeKey)]),
    supportingGoals: Object.freeze([]),
  })
}

export const INITIAL_WORKBENCH_PROJECT_STATE: WorkbenchProjectClientState = Object.freeze({
  phase: 'loading',
  start: null,
  detail: null,
  draft: emptyDraft(),
  draftDirty: false,
  pending: false,
  loadingMore: false,
  openingProjectId: null,
  issue: null,
  detailFocusEpoch: 0,
})

/**
 * Owns catalog paging, a complete local create draft, safe replay identity, and
 * one freshly queried Project detail without allowing React to become authority.
 */
export class WorkbenchProjectController {
  private state: WorkbenchProjectClientState = INITIAL_WORKBENCH_PROJECT_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private startEpoch = 0
  private mutationEpoch = 0
  private detailEpoch = 0
  private startAbort: AbortController | null = null
  private mutationAbort: AbortController | null = null
  private detailAbort: AbortController | null = null
  private retryEnvelope: RetryEnvelope | null = null
  private outcomeSequence = 1
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchProjectRemote,
    private readonly options: WorkbenchProjectControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  canCreate(): boolean {
    if (this.disposed || this.state.pending || this.state.start === null
      || this.state.phase === 'loading' || this.state.phase === 'stale'
      || this.state.phase === 'conflict') return false
    if (this.retryEnvelope !== null
      && this.retryEnvelope.draftFingerprint === fingerprintDraft(this.state.draft)) return true
    return normalizeDraft(this.state.draft) !== null
  }

  setProjectName(value: string): void {
    this.updateDraft({ ...this.state.draft, projectName: value })
  }

  setPrimaryGoalName(value: string): void {
    this.updateDraft({ ...this.state.draft, primaryGoalName: value })
  }

  updateOutcome(
    key: string,
    patch: Partial<Omit<WorkbenchOutcomeDraft, 'key'>>,
  ): void {
    if (!this.admitProtectedOperation()) return
    const outcomes = this.state.draft.outcomes.map(outcome => outcome.key === key
      ? Object.freeze({ ...outcome, ...patch, key: outcome.key })
      : outcome)
    if (outcomes.every((outcome, index) => outcome === this.state.draft.outcomes[index])) return
    this.updateDraft({ ...this.state.draft, outcomes })
  }

  addOutcome(): void {
    if (!this.admitProtectedOperation()
      || this.state.draft.outcomes.length >= MAX_PROJECT_OUTCOME_COUNT) return
    const key = this.options.nextOutcomeKey?.() ?? `outcome-${++this.outcomeSequence}`
    this.updateDraft({
      ...this.state.draft,
      outcomes: [...this.state.draft.outcomes, emptyOutcome(key)],
    })
  }

  removeOutcome(key: string): void {
    if (!this.admitProtectedOperation() || this.state.draft.outcomes.length <= 1) return
    const outcomes = this.state.draft.outcomes.filter(outcome => outcome.key !== key)
    if (outcomes.length === this.state.draft.outcomes.length || outcomes.length === 0) return
    this.updateDraft({ ...this.state.draft, outcomes })
  }

  setSupportingGoal(project: ProjectSummaryProjection, selected: boolean): void {
    if (!this.admitProtectedOperation()) return
    const goalId = project.primaryGoal.goalId
    const retained = this.state.draft.supportingGoals.filter(goal => goal.goalId !== goalId)
    if (selected && retained.length >= MAX_PROJECT_SUPPORTING_GOAL_COUNT) return
    const supportingGoals = selected
      ? [...retained, Object.freeze({
        projectId: project.projectId,
        projectName: project.name,
        goalId,
        goalName: project.primaryGoal.name,
        expectedRevision: project.primaryGoal.revision,
      })]
      : retained
    if (sameSupportingGoals(supportingGoals, this.state.draft.supportingGoals)) return
    this.updateDraft({ ...this.state.draft, supportingGoals })
  }

  removeSupportingGoal(goalId: string): void {
    if (!this.admitProtectedOperation()) return
    const supportingGoals = this.state.draft.supportingGoals.filter(goal => goal.goalId !== goalId)
    if (supportingGoals.length === this.state.draft.supportingGoals.length) return
    this.updateDraft({ ...this.state.draft, supportingGoals })
  }

  resetDraft(): void {
    if (!this.admitProtectedOperation()) return
    this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.start === null ? 'loading' : 'ready',
      draft: this.freshEmptyDraft(),
      draftDirty: false,
      issue: null,
    })
  }

  refresh(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pending) return Promise.resolve()
    return this.track(this.doRefresh())
  }

  loadMore(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pending || this.state.loadingMore
      || this.state.start === null || this.state.start.nextBeforeSequence === null) {
      return Promise.resolve()
    }
    return this.track(this.doLoadMore())
  }

  create(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doCreate())
  }

  openProject(projectId: string): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pending) return Promise.resolve()
    const normalized = projectId.trim()
    if (normalized === '') return Promise.resolve()
    return this.track(this.doOpenProject(normalized))
  }

  markDisconnected(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      pending: false,
      loadingMore: false,
      openingProjectId: null,
      issue: null,
    })
  }

  /** Repull the catalog and reopen the previously selected Project on a new Host generation. */
  connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doConnectionReset())
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Project Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRefresh(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.startEpoch
    this.startAbort?.abort(new Error('Workbench Project catalog refresh was superseded'))
    const abort = new AbortController()
    this.startAbort = abort
    this.publish({
      ...this.state,
      phase: this.state.start === null ? 'loading' : 'stale',
      loadingMore: false,
      issue: null,
    })
    try {
      const result = await this.remote.projectStart(
        Object.freeze({ limit: this.pageSize() }),
        abort.signal,
      )
      if (!this.acceptStart(epoch, abort)) return
      this.startAbort = null
      if (!result.ok) {
        this.publishFailure(result.error)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        start: detachStart(result.value),
        loadingMore: false,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptStart(epoch, abort)) return
      this.startAbort = null
      this.publishFailure(error)
    }
  }

  private async doLoadMore(): Promise<void> {
    const current = this.state.start
    if (current === null || current.nextBeforeSequence === null) return
    const epoch = ++this.startEpoch
    this.startAbort?.abort(new Error('Workbench Project page was superseded'))
    const abort = new AbortController()
    this.startAbort = abort
    this.publish({ ...this.state, loadingMore: true, issue: null })
    try {
      const result = await this.remote.projectStart(Object.freeze({
        beforeSequence: current.nextBeforeSequence,
        limit: this.pageSize(),
      }), abort.signal)
      if (!this.acceptStart(epoch, abort)) return
      this.startAbort = null
      if (!result.ok) {
        this.publishFailure(result.error)
        return
      }
      const page = detachStart(result.value)
      const projects = mergeProjects(current.projects, page.projects)
      this.publish({
        ...this.state,
        phase: 'ready',
        start: Object.freeze({
          template: page.template,
          catalogRevision: page.catalogRevision,
          projects,
          nextBeforeSequence: page.nextBeforeSequence,
        }),
        loadingMore: false,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptStart(epoch, abort)) return
      this.startAbort = null
      this.publishFailure(error)
    }
  }

  private async doCreate(): Promise<void> {
    if (!this.canCreate() || this.state.start === null) return
    const draftFingerprint = fingerprintDraft(this.state.draft)
    const normalized = normalizeDraft(this.state.draft)
    const envelope = this.retryEnvelope?.draftFingerprint === draftFingerprint
      ? this.retryEnvelope
      : normalized === null
        ? null
        : this.createEnvelope(normalized, draftFingerprint)
    if (envelope === null) return

    ++this.startEpoch
    this.startAbort?.abort(new Error('Workbench Project create superseded catalog refresh'))
    this.startAbort = null
    ++this.detailEpoch
    this.detailAbort?.abort(new Error('Workbench Project create superseded detail query'))
    this.detailAbort = null

    const epoch = ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench Project create was superseded'))
    const abort = new AbortController()
    this.mutationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pending: true,
      loadingMore: false,
      openingProjectId: null,
      issue: null,
    })
    try {
      const result = await this.remote.createProject(envelope.request, abort.signal)
      if (!this.acceptMutation(epoch, abort)) return
      this.mutationAbort = null
      if (!result.ok) {
        const issue = classifyRemoteFailure(result.error)
        if (issue.kind !== 'transport') this.retryEnvelope = null
        this.publish({
          ...this.state,
          phase: 'error',
          pending: false,
          issue,
        })
        if (issue.kind === 'transport') this.notifyTransportFailure()
        return
      }
      this.adoptCreateResult(result.value)
    } catch (error) {
      if (!this.acceptMutation(epoch, abort)) return
      this.mutationAbort = null
      this.publish({
        ...this.state,
        phase: 'error',
        pending: false,
        issue: transportIssue(error),
      })
      this.notifyTransportFailure()
    }
  }

  private async doOpenProject(projectId: string): Promise<void> {
    const epoch = ++this.detailEpoch
    this.detailAbort?.abort(new Error('Workbench Project detail query was superseded'))
    const abort = new AbortController()
    this.detailAbort = abort
    this.publish({
      ...this.state,
      phase: 'loading',
      openingProjectId: projectId,
      issue: null,
    })
    try {
      const result = await this.remote.project(Object.freeze({ projectId }), abort.signal)
      if (!this.acceptDetail(epoch, abort)) return
      this.detailAbort = null
      if (!result.ok) {
        this.publishFailure(result.error)
        return
      }
      if (result.value === null) {
        this.publish({
          ...this.state,
          phase: 'error',
          openingProjectId: null,
          issue: Object.freeze({ kind: 'input', code: 'project-not-found' }),
        })
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        detail: detachDetail(result.value),
        openingProjectId: null,
        issue: null,
        detailFocusEpoch: this.state.detailFocusEpoch + 1,
      })
    } catch (error) {
      if (!this.acceptDetail(epoch, abort)) return
      this.detailAbort = null
      this.publishFailure(error)
    }
  }

  private async doConnectionReset(): Promise<void> {
    const projectId = this.state.detail?.project.projectId ?? null
    this.cancelAll('Workbench Project connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      pending: false,
      loadingMore: false,
      openingProjectId: null,
      issue: null,
    })
    await this.doRefresh()
    if (projectId !== null && !this.disposed && this.state.phase === 'ready') {
      await this.doOpenProject(projectId)
    }
  }

  private createEnvelope(
    normalized: NonNullable<ReturnType<typeof normalizeDraft>>,
    draftFingerprint: string,
  ): RetryEnvelope {
    const start = this.state.start as ProjectStartProjection
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    const request: CreateProjectRequest = Object.freeze({
      template: detachSelection(start.template.selection),
      projectName: normalized.projectName,
      primaryGoal: Object.freeze({
        name: normalized.primaryGoalName,
        outcomes: Object.freeze(normalized.outcomes.map(outcome => Object.freeze({
          name: outcome.name,
          metric: Object.freeze({ ...outcome.metric }),
        }))),
      }),
      supportingGoals: Object.freeze(this.state.draft.supportingGoals.map(goal => Object.freeze({
        goalId: goal.goalId,
        expectedRevision: goal.expectedRevision,
      }))),
      expectedCatalogRevision: start.catalogRevision,
      expectedRevision: null,
      idempotencyKey: next(),
      causationId: next(),
      reason: 'owner-project-create',
    })
    const envelope = Object.freeze({ draftFingerprint, request })
    this.retryEnvelope = envelope
    return envelope
  }

  private adoptCreateResult(result: CreateProjectResult): void {
    if (!result.ok) {
      this.retryEnvelope = null
      this.publish({
        ...this.state,
        phase: 'conflict',
        pending: false,
        issue: Object.freeze({ kind: 'conflict', code: result.error.code }),
      })
      return
    }
    this.retryEnvelope = null
    const detail = detachDetail(result.value)
    const current = this.state.start
    const start = current === null ? null : Object.freeze({
      ...current,
      catalogRevision: result.catalogRevision,
      projects: mergeProjects([detail.project], current.projects),
    })
    this.publish({
      ...this.state,
      phase: 'ready',
      start,
      detail,
      draft: this.freshEmptyDraft(),
      draftDirty: false,
      pending: false,
      issue: null,
      detailFocusEpoch: this.state.detailFocusEpoch + 1,
    })
    try {
      this.options.onCommitted?.(Object.freeze({ ...result.receipt }))
    } catch {
      console.error('[workbench-client] committed-project observer failed')
    }
  }

  private updateDraft(next: {
    readonly projectName: string
    readonly primaryGoalName: string
    readonly outcomes: readonly WorkbenchOutcomeDraft[]
    readonly supportingGoals: readonly WorkbenchSupportingGoalDraft[]
  }): void {
    if (!this.admitProtectedOperation()) return
    const draft = freezeDraft(next)
    if (fingerprintDraft(draft) !== this.retryEnvelope?.draftFingerprint) {
      this.retryEnvelope = null
    }
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict'
        ? this.state.start === null ? 'loading' : 'ready'
        : this.state.phase,
      draft,
      draftDirty: true,
      issue: this.state.phase === 'conflict' ? null : this.state.issue,
    })
  }

  private freshEmptyDraft(): WorkbenchProjectDraft {
    const key = this.options.nextOutcomeKey?.() ?? `outcome-${++this.outcomeSequence}`
    return emptyDraft(key)
  }

  private publishFailure(error: unknown): void {
    const issue = classifyRemoteFailure(error)
    this.publish({
      ...this.state,
      phase: 'error',
      pending: false,
      loadingMore: false,
      openingProjectId: null,
      issue,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private acceptStart(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.startEpoch
      && this.startAbort === abort && !abort.signal.aborted
  }

  private acceptMutation(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.mutationEpoch
      && this.mutationAbort === abort && !abort.signal.aborted
  }

  private acceptDetail(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.detailEpoch
      && this.detailAbort === abort && !abort.signal.aborted
  }

  private cancelAll(reason: string): void {
    ++this.startEpoch
    ++this.mutationEpoch
    ++this.detailEpoch
    this.startAbort?.abort(new Error(reason))
    this.mutationAbort?.abort(new Error(reason))
    this.detailAbort?.abort(new Error(reason))
    this.startAbort = null
    this.mutationAbort = null
    this.detailAbort = null
  }

  private pageSize(): number {
    const requested = this.options.pageSize ?? DEFAULT_PAGE_SIZE
    return Number.isInteger(requested) && requested >= 1 && requested <= 100
      ? requested
      : DEFAULT_PAGE_SIZE
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Project transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Project admission observer failed')
      return false
    }
  }

  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(
      () => { this.inFlight.delete(pending) },
      () => { this.inFlight.delete(pending) },
    )
    return pending
  }

  private publish(next: WorkbenchProjectClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Project state observer failed')
      }
    }
  }
}

function normalizeDraft(draft: WorkbenchProjectDraft): {
  readonly projectName: string
  readonly primaryGoalName: string
  readonly outcomes: CreateProjectRequest['primaryGoal']['outcomes']
} | null {
  const projectName = draft.projectName.trim()
  const primaryGoalName = draft.primaryGoalName.trim()
  if (!boundedText(projectName, MAX_PROJECT_TEXT_LENGTH)
    || !boundedText(primaryGoalName, MAX_PROJECT_TEXT_LENGTH)
    || draft.outcomes.length === 0
    || draft.outcomes.length > MAX_PROJECT_OUTCOME_COUNT
    || draft.supportingGoals.length > MAX_PROJECT_SUPPORTING_GOAL_COUNT) return null
  const outcomes: Array<CreateProjectRequest['primaryGoal']['outcomes'][number]> = []
  for (const outcome of draft.outcomes) {
    const name = outcome.name.trim()
    const metricName = outcome.metricName.trim()
    const unit = outcome.unit.trim()
    const initialValue = finiteNumber(outcome.initialValue)
    const targetValue = finiteNumber(outcome.targetValue)
    if (!boundedText(name, MAX_PROJECT_TEXT_LENGTH)
      || !boundedText(metricName, MAX_PROJECT_METRIC_NAME_LENGTH)
      || !boundedText(unit, MAX_PROJECT_UNIT_LENGTH)
      || initialValue === null || targetValue === null
      || (outcome.direction !== 'increase' && outcome.direction !== 'decrease')
      || (outcome.direction === 'increase' && targetValue <= initialValue)
      || (outcome.direction === 'decrease' && targetValue >= initialValue)) return null
    outcomes.push(Object.freeze({
      name,
      metric: Object.freeze({
        metricName,
        initialValue,
        targetValue,
        unit,
        direction: outcome.direction,
      }),
    }))
  }
  return Object.freeze({ projectName, primaryGoalName, outcomes: Object.freeze(outcomes) })
}

function boundedText(value: string, maximum: number): boolean {
  const length = [...value].length
  return value.isWellFormed()
    && length >= 1
    && length <= maximum
    && !CONTROL_CHARACTER.test(value)
}

function finiteNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && !Object.is(parsed, -0) ? parsed : null
}

function freezeDraft(value: {
  readonly projectName: string
  readonly primaryGoalName: string
  readonly outcomes: readonly WorkbenchOutcomeDraft[]
  readonly supportingGoals: readonly WorkbenchSupportingGoalDraft[]
}): WorkbenchProjectDraft {
  return Object.freeze({
    projectName: value.projectName,
    primaryGoalName: value.primaryGoalName,
    outcomes: Object.freeze(value.outcomes.map(outcome => Object.freeze({ ...outcome }))),
    supportingGoals: Object.freeze(value.supportingGoals.map(goal => Object.freeze({ ...goal }))),
  })
}

function fingerprintDraft(draft: WorkbenchProjectDraft): string {
  return JSON.stringify({
    projectName: draft.projectName.trim(),
    primaryGoalName: draft.primaryGoalName.trim(),
    outcomes: draft.outcomes.map(outcome => ({
      name: outcome.name.trim(),
      metricName: outcome.metricName.trim(),
      initialValue: outcome.initialValue.trim(),
      targetValue: outcome.targetValue.trim(),
      unit: outcome.unit.trim(),
      direction: outcome.direction,
    })),
    supportingGoals: draft.supportingGoals.map(goal => ({
      goalId: goal.goalId,
      expectedRevision: goal.expectedRevision,
    })),
  })
}

function sameSupportingGoals(
  left: readonly WorkbenchSupportingGoalDraft[],
  right: readonly WorkbenchSupportingGoalDraft[],
): boolean {
  return left.length === right.length && left.every((goal, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && goal.goalId === candidate.goalId
      && goal.expectedRevision === candidate.expectedRevision
  })
}

function classifyRemoteFailure(error: unknown): WorkbenchProjectInputIssue | WorkbenchProjectTransportIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request') return Object.freeze({ kind: 'input', code: 'bad-request' })
  return transportIssue(error)
}

function transportIssue(error: unknown): WorkbenchProjectTransportIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectTransportCode)
    ? candidate as WorkbenchProjectTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code })
}

function mergeProjects(
  left: readonly ProjectSummaryProjection[],
  right: readonly ProjectSummaryProjection[],
): readonly ProjectSummaryProjection[] {
  const byId = new Map<string, ProjectSummaryProjection>()
  for (const project of [...right, ...left]) byId.set(project.projectId, detachSummary(project))
  return Object.freeze([...byId.values()].sort((a, b) => b.catalogSequence - a.catalogSequence))
}

function detachSelection(
  value: ProjectStartProjection['template']['selection'],
): ProjectStartProjection['template']['selection'] {
  return Object.freeze({
    templateId: value.templateId,
    templateVersion: value.templateVersion,
    definitionDigest: value.definitionDigest,
  })
}

function detachDefinition(
  value: ProjectStartProjection['template']['definition'],
): ProjectStartProjection['template']['definition'] {
  return Object.freeze({
    snapshotSchemaVersion: value.snapshotSchemaVersion,
    templateId: value.templateId,
    templateVersion: value.templateVersion,
    kind: value.kind,
    rules: Object.freeze({ ...value.rules }),
    defaults: Object.freeze({ ...value.defaults }),
  })
}

function detachSummary(value: ProjectSummaryProjection): ProjectSummaryProjection {
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

function detachStart(value: ProjectStartProjection): ProjectStartProjection {
  return Object.freeze({
    template: Object.freeze({
      selection: detachSelection(value.template.selection),
      definition: detachDefinition(value.template.definition),
    }),
    catalogRevision: value.catalogRevision,
    projects: Object.freeze(value.projects.map(detachSummary)),
    nextBeforeSequence: value.nextBeforeSequence,
  })
}

function detachDetail(value: ProjectDetailProjection): ProjectDetailProjection {
  return Object.freeze({
    project: detachSummary(value.project),
    primaryGoal: Object.freeze({
      goalId: value.primaryGoal.goalId,
      name: value.primaryGoal.name,
      revision: value.primaryGoal.revision,
      outcomes: Object.freeze(value.primaryGoal.outcomes.map(outcome => Object.freeze({
        outcomeId: outcome.outcomeId,
        revision: outcome.revision,
        name: outcome.name,
        metric: Object.freeze({ ...outcome.metric }),
      }))),
    }),
    supportingGoals: Object.freeze(value.supportingGoals.map(goal => Object.freeze({ ...goal }))),
    templateSnapshot: Object.freeze({
      template: detachSelection(value.templateSnapshot.template),
      snapshotSchemaVersion: value.templateSnapshot.snapshotSchemaVersion,
      definition: detachDefinition(value.templateSnapshot.definition),
      snapshotDigest: value.templateSnapshot.snapshotDigest,
      capturedAt: value.templateSnapshot.capturedAt,
    }),
  })
}
