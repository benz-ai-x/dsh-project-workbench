/** React-free Client state machine for one Project's authoritative schedule. */

import type {
  BindProjectCalendarRequest,
  BindProjectCalendarResult,
  CreateProjectMilestoneRequest,
  CreateProjectMilestoneResult,
  DiscoverFeishuCalendarEventsRequest,
  DiscoverFeishuCalendarsRequest,
  FeishuCalendarCandidateProjection,
  FeishuCalendarDiscoveryProjection,
  FeishuCalendarEventCandidateProjection,
  FeishuCalendarEventDiscoveryProjection,
  FeishuIdentityKind,
  ProjectCalendarSchedule,
  ProjectMilestoneProjection,
  ProjectMilestonesProjection,
  ProjectMilestonesQuery,
  ReconcileProjectCalendarRequest,
  ReconcileProjectCalendarResult,
  UpdateProjectMilestoneDateRequest,
  UpdateProjectMilestoneDateResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchProjectMilestonesPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

export type WorkbenchProjectMilestonesOperation =
  | 'read-milestones'
  | 'discover-calendars'
  | 'bind-calendar'
  | 'discover-events'
  | 'create-milestone'
  | 'update-date'
  | 'reconcile'

export type WorkbenchProjectMilestonesTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

type MilestoneDomainResult =
  | BindProjectCalendarResult
  | CreateProjectMilestoneResult
  | UpdateProjectMilestoneDateResult
  | ReconcileProjectCalendarResult

export type WorkbenchProjectMilestonesConflictCode = Extract<
  MilestoneDomainResult,
  { readonly ok: false }
>['error']['code']

export interface WorkbenchProjectMilestonesTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchProjectMilestonesTransportCode
  readonly operation: WorkbenchProjectMilestonesOperation
}

export interface WorkbenchProjectMilestonesInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request' | 'project-not-found'
  readonly operation: WorkbenchProjectMilestonesOperation
}

export interface WorkbenchProjectMilestonesConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchProjectMilestonesConflictCode
  readonly operation: 'bind-calendar' | 'create-milestone' | 'update-date' | 'reconcile'
}

export type WorkbenchProjectMilestonesIssue =
  | WorkbenchProjectMilestonesTransportIssue
  | WorkbenchProjectMilestonesInputIssue
  | WorkbenchProjectMilestonesConflictIssue

export interface WorkbenchProjectMilestonesSelection {
  readonly projectId: string
  readonly projectName: string
}

export interface WorkbenchProjectMilestonesClientState {
  readonly phase: WorkbenchProjectMilestonesPhase
  readonly selection: WorkbenchProjectMilestonesSelection | null
  readonly projection: ProjectMilestonesProjection | null
  readonly calendarDiscovery: FeishuCalendarDiscoveryProjection | null
  readonly eventDiscovery: FeishuCalendarEventDiscoveryProjection | null
  readonly pendingOperation: Exclude<WorkbenchProjectMilestonesOperation, 'read-milestones'> | null
  readonly pendingMilestoneId: string | null
  readonly issue: WorkbenchProjectMilestonesIssue | null
  readonly canRetryMutation: boolean
  readonly focusMilestoneId: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` Calendar/Milestone subset consumed by the Client. */
export interface WorkbenchProjectMilestonesRemote {
  discoverFeishuCalendars(
    request: DiscoverFeishuCalendarsRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuCalendarDiscoveryProjection>>
  bindProjectCalendar(
    request: BindProjectCalendarRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<BindProjectCalendarResult>>
  discoverFeishuCalendarEvents(
    request: DiscoverFeishuCalendarEventsRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuCalendarEventDiscoveryProjection>>
  getProjectMilestones(
    query: ProjectMilestonesQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectMilestonesProjection | null>>
  createProjectMilestone(
    request: CreateProjectMilestoneRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<CreateProjectMilestoneResult>>
  updateProjectMilestoneDate(
    request: UpdateProjectMilestoneDateRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<UpdateProjectMilestoneDateResult>>
  reconcileProjectCalendar(
    request: ReconcileProjectCalendarRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ReconcileProjectCalendarResult>>
}

export interface WorkbenchProjectMilestonesControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
}

type MutationEnvelope =
  | Readonly<{ readonly kind: 'bind-calendar'; readonly request: BindProjectCalendarRequest }>
  | Readonly<{
    readonly kind: 'create-milestone'
    readonly request: CreateProjectMilestoneRequest
  }>
  | Readonly<{
    readonly kind: 'update-date'
    readonly request: UpdateProjectMilestoneDateRequest
  }>

const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectMilestonesTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const STRICT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u

export const MAX_PROJECT_MILESTONE_NAME_LENGTH = 200
export const MAX_PROJECT_MILESTONE_DESCRIPTION_LENGTH = 2_000
export const MAX_PROJECT_CALENDAR_SUMMARY_LENGTH = 200
export const MAX_PROJECT_CALENDAR_DESCRIPTION_LENGTH = 2_000

export const INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE: WorkbenchProjectMilestonesClientState
  = Object.freeze({
    phase: 'idle',
    selection: null,
    projection: null,
    calendarDiscovery: null,
    eventDiscovery: null,
    pendingOperation: null,
    pendingMilestoneId: null,
    issue: null,
    canRetryMutation: false,
    focusMilestoneId: null,
    focusEpoch: 0,
  })

/**
 * Owns one Project's detached schedule projection and exact mutation envelopes.
 * Feishu dates remain authoritative; the controller never manufactures a local
 * optimistic date and never automatically retries an unknown provider effect.
 */
export class WorkbenchProjectMilestonesController {
  private state = INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private readEpoch = 0
  private operationEpoch = 0
  private readAbort: AbortController | null = null
  private operationAbort: AbortController | null = null
  private retryEnvelope: MutationEnvelope | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchProjectMilestonesRemote,
    private readonly options: WorkbenchProjectMilestonesControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectMilestonesClientState => this.state

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
    this.cancelAll('Workbench Project Milestones switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE,
      phase: 'loading',
      selection: Object.freeze({ projectId: normalized, projectName }),
    })
    return this.track(this.doRefresh(false))
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project Milestones selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE)
  }

  refresh(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null
      || this.state.pendingOperation !== null) return Promise.resolve()
    return this.track(this.doRefresh(false))
  }

  discoverCalendars(
    kind: FeishuIdentityKind,
    expectedConnectionRevision: number,
    expectedRouteGeneration: number,
  ): Promise<void> {
    const selection = this.state.selection
    if (!this.canOperate() || selection === null || this.state.projection?.binding !== null) {
      return Promise.resolve()
    }
    const request: DiscoverFeishuCalendarsRequest = Object.freeze({
      projectId: selection.projectId,
      kind,
      expectedConnectionRevision,
      expectedRouteGeneration,
    })
    return this.track(this.doCalendarDiscovery(request))
  }

  bindExisting(candidate: FeishuCalendarCandidateProjection): Promise<void> {
    const discovery = this.state.calendarDiscovery
    if (!candidate.selectable || discovery === null
      || !discovery.items.some(item => item.calendarId === candidate.calendarId && item.selectable)) {
      return Promise.resolve()
    }
    return this.bind(Object.freeze({ mode: 'existing', calendarId: candidate.calendarId }))
  }

  createAndBind(summary: string, description?: string | null): Promise<void> {
    const normalizedSummary = safeRequiredText(summary, MAX_PROJECT_CALENDAR_SUMMARY_LENGTH)
    const normalizedDescription = safeOptionalText(
      description ?? '',
      MAX_PROJECT_CALENDAR_DESCRIPTION_LENGTH,
    )
    if (normalizedSummary === null || normalizedDescription === null
      || this.state.calendarDiscovery === null) return Promise.resolve()
    return this.bind(Object.freeze({
      mode: 'create',
      summary: normalizedSummary,
      description: normalizedDescription === '' ? null : normalizedDescription,
    }))
  }

  discoverEvents(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null) {
      return Promise.resolve()
    }
    const request: DiscoverFeishuCalendarEventsRequest = Object.freeze({
      projectId: selection.projectId,
      expectedRevision: projection.revision,
    })
    return this.track(this.doEventDiscovery(request))
  }

  createFromExistingEvent(
    name: string,
    description: string | null,
    candidate: FeishuCalendarEventCandidateProjection,
  ): Promise<void> {
    const discovery = this.state.eventDiscovery
    if (!candidate.selectable || discovery === null
      || !discovery.items.some(item => item.eventId === candidate.eventId && item.selectable)) {
      return Promise.resolve()
    }
    return this.createMilestone(name, description, Object.freeze({
      mode: 'existing-event', eventId: candidate.eventId,
    }))
  }

  createWithEvent(
    name: string,
    description: string | null,
    schedule: ProjectCalendarSchedule,
  ): Promise<void> {
    if (!validProjectCalendarSchedule(schedule)) return Promise.resolve()
    return this.createMilestone(name, description, Object.freeze({
      mode: 'create-event', schedule: detachSchedule(schedule),
    }))
  }

  updateDate(
    milestone: ProjectMilestoneProjection,
    schedule: ProjectCalendarSchedule,
  ): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null
      || !validProjectCalendarSchedule(schedule)
      || !projection.milestones.some(item => item.milestoneId === milestone.milestoneId)) {
      return Promise.resolve()
    }
    const correlation = this.correlation()
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'update-date',
      request: Object.freeze({
        projectId: selection.projectId,
        milestoneId: milestone.milestoneId,
        expectedRevision: projection.revision,
        expectedMilestoneRevision: milestone.revision,
        expectedRemoteObservationVersion: milestone.remoteObservationVersion,
        schedule: detachSchedule(schedule),
        ...correlation,
        reason: 'owner-project-milestone-date-update' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  reconcile(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null) {
      return Promise.resolve()
    }
    const request: ReconcileProjectCalendarRequest = Object.freeze({
      projectId: selection.projectId,
      expectedRevision: projection.revision,
    })
    return this.track(this.doReconcile(request))
  }

  retryMutation(): Promise<void> {
    if (!this.canOperate() || this.retryEnvelope === null) return Promise.resolve()
    return this.track(this.doMutation(this.retryEnvelope))
  }

  markDisconnected(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project Milestones connection generation changed')
    this.publish({
      ...this.state,
      phase: this.state.selection === null ? 'idle' : 'stale',
      calendarDiscovery: null,
      eventDiscovery: null,
      pendingOperation: null,
      pendingMilestoneId: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null) return Promise.resolve()
    this.cancelAll('Workbench Project Milestones connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      calendarDiscovery: null,
      eventDiscovery: null,
      pendingOperation: null,
      pendingMilestoneId: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
    return this.track(this.doRefresh(false))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Project Milestones Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private bind(mode: Readonly<
    { readonly mode: 'existing'; readonly calendarId: string }
    | { readonly mode: 'create'; readonly summary: string; readonly description: string | null }
  >): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const discovery = this.state.calendarDiscovery
    if (!this.canOperate() || selection === null || projection?.binding !== null
      || discovery === null) return Promise.resolve()
    const common = {
      projectId: selection.projectId,
      kind: discovery.kind,
      expectedConnectionRevision: discovery.connectionRevision,
      expectedRouteGeneration: discovery.routeGeneration,
      expectedBindingRevision: null,
      ...this.correlation(),
      reason: 'owner-project-calendar-bind' as const,
    }
    const request: BindProjectCalendarRequest = mode.mode === 'existing'
      ? Object.freeze({ ...common, mode: 'existing', calendarId: mode.calendarId })
      : Object.freeze({
          ...common,
          mode: 'create',
          summary: mode.summary,
          description: mode.description,
        })
    const envelope: MutationEnvelope = Object.freeze({ kind: 'bind-calendar', request })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  private createMilestone(
    name: string,
    description: string | null,
    mode: Readonly<
      { readonly mode: 'existing-event'; readonly eventId: string }
      | { readonly mode: 'create-event'; readonly schedule: ProjectCalendarSchedule }
    >,
  ): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const normalizedName = safeRequiredText(name, MAX_PROJECT_MILESTONE_NAME_LENGTH)
    const normalizedDescription = safeOptionalText(
      description ?? '',
      MAX_PROJECT_MILESTONE_DESCRIPTION_LENGTH,
    )
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null
      || normalizedName === null || normalizedDescription === null) return Promise.resolve()
    const common = {
      projectId: selection.projectId,
      expectedRevision: projection.revision,
      expectedMilestoneRevision: null,
      name: normalizedName,
      description: normalizedDescription === '' ? null : normalizedDescription,
      ...this.correlation(),
      reason: 'owner-project-milestone-create' as const,
    }
    const request: CreateProjectMilestoneRequest = mode.mode === 'existing-event'
      ? Object.freeze({ ...common, mode: 'existing-event', eventId: mode.eventId })
      : Object.freeze({ ...common, mode: 'create-event', schedule: detachSchedule(mode.schedule) })
    const envelope: MutationEnvelope = Object.freeze({ kind: 'create-milestone', request })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  private async doRefresh(keepIssue: boolean): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Project Milestones refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    const retainedIssue = keepIssue ? this.state.issue : null
    this.publish({
      ...this.state,
      phase: this.state.projection === null ? 'loading' : keepIssue ? 'conflict' : 'stale',
      issue: retainedIssue,
    })
    try {
      const result = await this.remote.getProjectMilestones(
        Object.freeze({ projectId: selection.projectId }),
        abort.signal,
      )
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      if (!result.ok) {
        this.publishFailure('read-milestones', result.error, false)
        return
      }
      if (result.value === null) {
        this.publish({
          ...this.state,
          phase: 'error',
          projection: null,
          issue: Object.freeze({
            kind: 'input', code: 'project-not-found', operation: 'read-milestones',
          }),
        })
        return
      }
      const projection = detachProjection(result.value)
      this.publish({
        ...this.state,
        phase: keepIssue && retainedIssue?.kind === 'conflict' ? 'conflict' : 'ready',
        projection,
        calendarDiscovery: projection.binding === null ? this.state.calendarDiscovery : null,
        eventDiscovery: eventDiscoveryMatches(this.state.eventDiscovery, projection)
          ? this.state.eventDiscovery
          : null,
        issue: retainedIssue,
        canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      this.publishFailure('read-milestones', error, false)
    }
  }

  private async doCalendarDiscovery(request: DiscoverFeishuCalendarsRequest): Promise<void> {
    const operation = this.beginOperation('Workbench calendar discovery was superseded')
    this.publish({
      ...this.state,
      phase: 'pending',
      calendarDiscovery: null,
      pendingOperation: 'discover-calendars',
      pendingMilestoneId: null,
      issue: null,
    })
    try {
      const result = await this.remote.discoverFeishuCalendars(request, operation.abort.signal)
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('discover-calendars', result.error, false)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        calendarDiscovery: detachCalendarDiscovery(result.value),
        pendingOperation: null,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('discover-calendars', error, false)
    }
  }

  private async doEventDiscovery(request: DiscoverFeishuCalendarEventsRequest): Promise<void> {
    const operation = this.beginOperation('Workbench calendar-event discovery was superseded')
    this.publish({
      ...this.state,
      phase: 'pending',
      eventDiscovery: null,
      pendingOperation: 'discover-events',
      pendingMilestoneId: null,
      issue: null,
    })
    try {
      const result = await this.remote.discoverFeishuCalendarEvents(request, operation.abort.signal)
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('discover-events', result.error, false)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        eventDiscovery: detachEventDiscovery(result.value),
        pendingOperation: null,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('discover-events', error, false)
    }
  }

  private async doReconcile(request: ReconcileProjectCalendarRequest): Promise<void> {
    const operation = this.beginOperation('Workbench calendar reconciliation was superseded')
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: 'reconcile',
      pendingMilestoneId: null,
      issue: null,
    })
    try {
      const result = await this.remote.reconcileProjectCalendar(request, operation.abort.signal)
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('reconcile', result.error, false)
        return
      }
      if (!result.value.ok) {
        await this.publishDomainConflict('reconcile', result.value.error)
        return
      }
      this.publishProjection(result.value.value, null)
    } catch (error) {
      if (!this.acceptOperation(operation, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('reconcile', error, false)
    }
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    if (this.disposed || this.state.selection?.projectId !== envelope.request.projectId) return
    const operation = this.beginOperation('Workbench Project Milestones operation was superseded')
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.kind,
      pendingMilestoneId: 'milestoneId' in envelope.request ? envelope.request.milestoneId : null,
      issue: null,
      canRetryMutation: false,
      focusMilestoneId: null,
    })
    let result: RemoteResult<
      BindProjectCalendarResult | CreateProjectMilestoneResult | UpdateProjectMilestoneDateResult
    >
    try {
      result = await this.invokeMutation(envelope, operation.abort.signal)
    } catch (error) {
      if (!this.acceptOperation(operation, envelope.request.projectId)) return
      this.operationAbort = null
      this.publishFailure(envelope.kind, error, true)
      return
    }
    if (!this.acceptOperation(operation, envelope.request.projectId)) return
    this.operationAbort = null
    if (!result.ok) {
      this.publishFailure(envelope.kind, result.error, true)
      return
    }
    if (!result.value.ok) {
      this.retryEnvelope = null
      await this.publishDomainConflict(envelope.kind, result.value.error)
      return
    }
    this.retryEnvelope = null
    const focusMilestoneId = 'milestone' in result.value
      ? result.value.milestone.milestoneId
      : null
    this.publishProjection(result.value.value, focusMilestoneId)
    this.notifyCommitted(result.value.receipt)
  }

  private async invokeMutation(
    envelope: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<RemoteResult<
    BindProjectCalendarResult | CreateProjectMilestoneResult | UpdateProjectMilestoneDateResult
  >> {
    switch (envelope.kind) {
      case 'bind-calendar': return await this.remote.bindProjectCalendar(envelope.request, signal)
      case 'create-milestone': return await this.remote.createProjectMilestone(envelope.request, signal)
      case 'update-date': return await this.remote.updateProjectMilestoneDate(envelope.request, signal)
    }
  }

  private async publishDomainConflict(
    operation: WorkbenchProjectMilestonesConflictIssue['operation'],
    error: Extract<MilestoneDomainResult, { readonly ok: false }>['error'],
  ): Promise<void> {
    const current = 'current' in error && error.current !== undefined
      ? detachProjection(error.current)
      : null
    this.publish({
      ...this.state,
      phase: 'conflict',
      ...(current === null ? {} : {
        projection: current,
        calendarDiscovery: current.binding === null ? this.state.calendarDiscovery : null,
        eventDiscovery: eventDiscoveryMatches(this.state.eventDiscovery, current)
          ? this.state.eventDiscovery
          : null,
      }),
      pendingOperation: null,
      pendingMilestoneId: null,
      issue: Object.freeze({ kind: 'conflict', code: error.code, operation }),
      canRetryMutation: false,
    })
    if (current === null) await this.doRefresh(true)
  }

  private publishProjection(value: ProjectMilestonesProjection, focusMilestoneId: string | null): void {
    const projection = detachProjection(value)
    this.publish({
      ...this.state,
      phase: 'ready',
      projection,
      calendarDiscovery: projection.binding === null ? this.state.calendarDiscovery : null,
      eventDiscovery: eventDiscoveryMatches(this.state.eventDiscovery, projection)
        ? this.state.eventDiscovery
        : null,
      pendingOperation: null,
      pendingMilestoneId: null,
      issue: null,
      canRetryMutation: false,
      focusMilestoneId,
      focusEpoch: focusMilestoneId === null ? this.state.focusEpoch : this.state.focusEpoch + 1,
    })
  }

  private publishFailure(
    operation: WorkbenchProjectMilestonesOperation,
    error: unknown,
    retainReplay: boolean,
  ): void {
    const issue = classifyTransportOrInput(error, operation)
    if (!retainReplay || issue.kind === 'input') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingMilestoneId: null,
      issue,
      canRetryMutation: retainReplay && issue.kind === 'transport' && this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private beginOperation(reason: string): {
    readonly epoch: number
    readonly abort: AbortController
  } {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error(reason))
    const abort = new AbortController()
    this.operationAbort = abort
    return { epoch, abort }
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private canOperate(): boolean {
    return this.admitProtectedOperation()
      && this.state.selection !== null
      && this.state.projection !== null
      && this.state.pendingOperation === null
      && this.state.phase !== 'loading'
      && this.state.phase !== 'stale'
  }

  private acceptRead(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed
      && this.state.selection?.projectId === projectId
      && this.readEpoch === epoch
      && this.readAbort === abort
      && !abort.signal.aborted
  }

  private acceptOperation(
    operation: { readonly epoch: number; readonly abort: AbortController },
    projectId: string,
  ): boolean {
    return !this.disposed
      && this.state.selection?.projectId === projectId
      && this.operationEpoch === operation.epoch
      && this.operationAbort === operation.abort
      && !operation.abort.signal.aborted
  }

  private notifyCommitted(receipt: WorkbenchCommandReceipt): void {
    try {
      this.options.onCommitted?.(Object.freeze({ ...receipt }))
    } catch {
      console.error('[workbench-client] Project Milestones committed observer failed')
    }
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Project Milestones transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Project Milestones admission observer failed')
      return false
    }
  }

  private cancelAll(reason: string): void {
    ++this.readEpoch
    ++this.operationEpoch
    this.readAbort?.abort(new Error(reason))
    this.operationAbort?.abort(new Error(reason))
    this.readAbort = null
    this.operationAbort = null
  }

  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(
      () => { this.inFlight.delete(pending) },
      () => { this.inFlight.delete(pending) },
    )
    return pending
  }

  private publish(next: WorkbenchProjectMilestonesClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Project Milestones state observer failed')
      }
    }
  }
}

export function validProjectCalendarSchedule(schedule: ProjectCalendarSchedule): boolean {
  if (schedule.kind === 'all-day') {
    return validIsoDate(schedule.startDate)
      && validIsoDate(schedule.endDate)
      && schedule.startDate < schedule.endDate
  }
  return OFFSET_DATE_TIME.test(schedule.startAt)
    && OFFSET_DATE_TIME.test(schedule.endAt)
    && Number.isFinite(Date.parse(schedule.startAt))
    && Number.isFinite(Date.parse(schedule.endAt))
    && Date.parse(schedule.startAt) < Date.parse(schedule.endAt)
    && validTimeZone(schedule.timeZone)
}

function validIsoDate(value: string): boolean {
  const match = STRICT_DATE.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function validTimeZone(value: string): boolean {
  if (value.trim() !== value || value === '' || CONTROL_CHARACTER.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

function safeRequiredText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed()
    && [...normalized].length >= 1
    && [...normalized].length <= maximum
    && !CONTROL_CHARACTER.test(normalized)
    ? normalized
    : null
}

function safeOptionalText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed()
    && [...normalized].length <= maximum
    && !CONTROL_CHARACTER.test(normalized)
    ? normalized
    : null
}

function classifyTransportOrInput(
  error: unknown,
  operation: WorkbenchProjectMilestonesOperation,
): WorkbenchProjectMilestonesTransportIssue | WorkbenchProjectMilestonesInputIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectMilestonesTransportCode)
    ? candidate as WorkbenchProjectMilestonesTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}

function eventDiscoveryMatches(
  discovery: FeishuCalendarEventDiscoveryProjection | null,
  projection: ProjectMilestonesProjection,
): boolean {
  return discovery !== null
    && projection.binding !== null
    && discovery.projectId === projection.projectId
    && discovery.calendarId === projection.binding.calendarId
    && discovery.revision === projection.revision
}

function detachSchedule(value: ProjectCalendarSchedule): ProjectCalendarSchedule {
  return value.kind === 'all-day'
    ? Object.freeze({ kind: 'all-day', startDate: value.startDate, endDate: value.endDate })
    : Object.freeze({
        kind: 'timed', startAt: value.startAt, endAt: value.endAt, timeZone: value.timeZone,
      })
}

function detachCalendarDiscovery(
  value: FeishuCalendarDiscoveryProjection,
): FeishuCalendarDiscoveryProjection {
  return Object.freeze({
    projectId: value.projectId,
    connectionRevision: value.connectionRevision,
    kind: value.kind,
    routeGeneration: value.routeGeneration,
    items: Object.freeze(value.items.map(item => Object.freeze({ ...item }))),
  })
}

function detachEventDiscovery(
  value: FeishuCalendarEventDiscoveryProjection,
): FeishuCalendarEventDiscoveryProjection {
  return Object.freeze({
    projectId: value.projectId,
    revision: value.revision,
    calendarId: value.calendarId,
    items: Object.freeze(value.items.map(item => Object.freeze({
      ...item,
      schedule: detachSchedule(item.schedule),
    }))),
  })
}

function detachProjection(value: ProjectMilestonesProjection): ProjectMilestonesProjection {
  return Object.freeze({
    projectId: value.projectId,
    revision: value.revision,
    binding: value.binding === null ? null : Object.freeze({
      ...value.binding,
      identity: Object.freeze({ ...value.binding.identity }),
    }),
    milestones: Object.freeze(value.milestones.map(item => Object.freeze({
      ...item,
      schedule: detachSchedule(item.schedule),
    }))),
    sync: Object.freeze({
      ...value.sync,
      issue: value.sync.issue === null ? null : Object.freeze({ ...value.sync.issue }),
    }),
    effects: Object.freeze(value.effects.map(effect => Object.freeze({ ...effect }))),
    recentChanges: Object.freeze(value.recentChanges.map(change => Object.freeze({
      ...change,
      changedFields: Object.freeze([...change.changedFields]),
      beforeSchedule: change.beforeSchedule === null ? null : detachSchedule(change.beforeSchedule),
      afterSchedule: detachSchedule(change.afterSchedule),
    }))),
  })
}
