/** React-free Client state machine for one Project's Deliverables workspace. */

import type {
  CreateProjectDeliverableRequest,
  CreateProjectDeliverableResult,
  DeliverableArtifactVersionRef,
  DiscoverFeishuCalendarEventsRequest,
  FeishuCalendarEventDiscoveryProjection,
  ProjectCalendarSchedule,
  ProjectDeliverableProjection,
  ProjectDeliverablesProjection,
  ProjectDeliverablesQuery,
  RequestDeliverableAcceptanceRequest,
  RequestDeliverableAcceptanceResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { validProjectCalendarSchedule } from './milestone-controller.ts'

export type WorkbenchProjectDeliverablesPhase =
  | 'idle' | 'loading' | 'ready' | 'pending' | 'stale' | 'error' | 'conflict'
export type WorkbenchProjectDeliverablesOperation =
  | 'read-deliverables' | 'discover-events' | 'create-deliverable' | 'request-acceptance'
export type WorkbenchProjectDeliverablesTransportCode =
  | 'unavailable' | 'unauthorized' | 'forbidden' | 'rate-limited' | 'internal'
  | 'transport-failure'

type DeliverableDomainResult = CreateProjectDeliverableResult | RequestDeliverableAcceptanceResult
export type WorkbenchProjectDeliverablesConflictCode = Extract<
  DeliverableDomainResult, { readonly ok: false }
>['error']['code']

export interface WorkbenchProjectDeliverablesIssue {
  readonly kind: 'transport' | 'input' | 'conflict'
  readonly code: WorkbenchProjectDeliverablesTransportCode | 'bad-request' | 'project-not-found'
    | WorkbenchProjectDeliverablesConflictCode
  readonly operation: WorkbenchProjectDeliverablesOperation
}

export interface WorkbenchProjectDeliverablesSelection {
  readonly projectId: string
  readonly projectName: string
}

export interface WorkbenchDeclaredArtifactVersionDraft extends DeliverableArtifactVersionRef {
  /** Honest Client label: T11 stores this declaration but does not read the File source. */
  readonly resolution: 'declared'
}

export interface WorkbenchProjectDeliverableCreateDraft {
  readonly name: string
  readonly description: string
  readonly criteria: readonly string[]
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string
  readonly acceptorMemberId: string
  readonly taskGuids: readonly string[]
  readonly eventMode: 'create-event' | 'existing-event'
  readonly eventId: string
  readonly schedule: ProjectCalendarSchedule
}

export interface WorkbenchProjectDeliverablesClientState {
  readonly phase: WorkbenchProjectDeliverablesPhase
  readonly selection: WorkbenchProjectDeliverablesSelection | null
  /** Last Host-confirmed projection; never replaced by optimistic browser state. */
  readonly projection: ProjectDeliverablesProjection | null
  readonly eventDiscovery: FeishuCalendarEventDiscoveryProjection | null
  readonly createDraft: WorkbenchProjectDeliverableCreateDraft
  readonly candidateDrafts: Readonly<Record<string, readonly WorkbenchDeclaredArtifactVersionDraft[]>>
  readonly pendingOperation: 'create-deliverable' | 'request-acceptance' | null
  readonly pendingDeliverableId: string | null
  readonly issue: WorkbenchProjectDeliverablesIssue | null
  readonly canRetryMutation: boolean
  readonly focusDeliverableId: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` T11 subset consumed by the Client. */
export interface WorkbenchProjectDeliverablesRemote {
  projectDeliverables(
    query: ProjectDeliverablesQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectDeliverablesProjection | null>>
  discoverFeishuCalendarEvents(
    request: DiscoverFeishuCalendarEventsRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuCalendarEventDiscoveryProjection>>
  createProjectDeliverable(
    request: CreateProjectDeliverableRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<CreateProjectDeliverableResult>>
  requestDeliverableAcceptance(
    request: RequestDeliverableAcceptanceRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<RequestDeliverableAcceptanceResult>>
}

export interface WorkbenchProjectDeliverablesControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
  /** Local-date seam for the default one-day, all-day event intent. */
  readonly today?: () => string
}

type MutationEnvelope =
  | Readonly<{ readonly kind: 'create-deliverable'; readonly request: CreateProjectDeliverableRequest }>
  | Readonly<{
    readonly kind: 'request-acceptance'
    readonly deliverableId: string
    readonly request: RequestDeliverableAcceptanceRequest
  }>

export const MAX_DELIVERABLE_NAME_LENGTH = 200
export const MAX_DELIVERABLE_DESCRIPTION_LENGTH = 2_000
export const MAX_DELIVERABLE_CRITERIA = 20
export const MAX_DELIVERABLE_CRITERION_LENGTH = 1_000
export const MAX_DELIVERABLE_CONTRIBUTORS = 20
export const MAX_DELIVERABLE_TASKS = 50
export const MAX_DELIVERABLE_CANDIDATE_VERSIONS = 20

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const WORKBENCH_DIGEST = /^sha256:[0-9a-f]{64}$/u
const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectDeliverablesTransportCode>([
  'unavailable', 'unauthorized', 'forbidden', 'rate-limited', 'internal', 'transport-failure',
])
const AMBIGUOUS_TRANSPORT_CODES = new Set<WorkbenchProjectDeliverablesTransportCode>([
  'unavailable', 'internal', 'transport-failure',
])

function defaultCreateDraft(today = localIsoDate()): WorkbenchProjectDeliverableCreateDraft {
  return Object.freeze({
    name: '', description: '', criteria: Object.freeze(['']), accountableMemberId: '',
    contributorMemberIds: Object.freeze([]), humanSponsorMemberId: '', acceptorMemberId: '',
    taskGuids: Object.freeze([]), eventMode: 'create-event', eventId: '',
    schedule: Object.freeze({ kind: 'all-day', startDate: today, endDate: nextIsoDate(today) }),
  })
}

export const INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE: WorkbenchProjectDeliverablesClientState
  = Object.freeze({
    phase: 'idle', selection: null, projection: null, eventDiscovery: null,
    createDraft: defaultCreateDraft(''), candidateDrafts: Object.freeze({}),
    pendingOperation: null, pendingDeliverableId: null, issue: null,
    canRetryMutation: false, focusDeliverableId: null, focusEpoch: 0,
  })

/**
 * Owns protected Deliverable drafts and exact ambiguous replay identity. The
 * Host remains the only authority for Plans, event facts, request rounds, and releases.
 */
export class WorkbenchProjectDeliverablesController {
  private state = INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE
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
    private readonly remote: WorkbenchProjectDeliverablesRemote,
    private readonly options: WorkbenchProjectDeliverablesControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectDeliverablesClientState => this.state

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
        this.publish({ ...this.state, selection: Object.freeze({ projectId: normalized, projectName }) })
      }
      return Promise.resolve()
    }
    this.cancelAll('Workbench Deliverables switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE,
      phase: 'loading', selection: Object.freeze({ projectId: normalized, projectName }),
      createDraft: defaultCreateDraft(this.today()),
    })
    return this.track(this.doRefresh())
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Deliverables selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE)
  }

  refresh(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    return this.track(this.doRefresh())
  }

  setCreateName(name: string): void { this.updateCreateDraft({ ...this.state.createDraft, name }) }
  setCreateDescription(description: string): void {
    this.updateCreateDraft({ ...this.state.createDraft, description })
  }
  setCreateCriterion(index: number, statement: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.createDraft.criteria.length) return
    const criteria = [...this.state.createDraft.criteria]
    criteria[index] = statement
    this.updateCreateDraft({ ...this.state.createDraft, criteria })
  }
  addCreateCriterion(): void {
    if (this.state.createDraft.criteria.length >= MAX_DELIVERABLE_CRITERIA) return
    this.updateCreateDraft({
      ...this.state.createDraft, criteria: [...this.state.createDraft.criteria, ''],
    })
  }
  removeCreateCriterion(index: number): void {
    if (this.state.createDraft.criteria.length <= 1 || !Number.isInteger(index)) return
    this.updateCreateDraft({
      ...this.state.createDraft,
      criteria: this.state.createDraft.criteria.filter((_, candidate) => candidate !== index),
    })
  }
  setCreateAccountable(memberId: string): void {
    const normalized = memberId.trim()
    const option = this.state.projection?.memberOptions.find(item => item.memberId === normalized)
    this.updateCreateDraft({
      ...this.state.createDraft, accountableMemberId: normalized,
      contributorMemberIds: this.state.createDraft.contributorMemberIds
        .filter(candidate => candidate !== normalized),
      humanSponsorMemberId: option?.requiresHumanSponsor === true
        && this.state.createDraft.humanSponsorMemberId !== normalized
        ? this.state.createDraft.humanSponsorMemberId : '',
    })
  }
  setCreateContributor(memberId: string, selected: boolean): void {
    const normalized = memberId.trim()
    if (normalized === '' || normalized === this.state.createDraft.accountableMemberId) return
    const retained = this.state.createDraft.contributorMemberIds.filter(value => value !== normalized)
    if (selected && retained.length >= MAX_DELIVERABLE_CONTRIBUTORS) return
    this.updateCreateDraft({
      ...this.state.createDraft,
      contributorMemberIds: selected ? Object.freeze([...retained, normalized].sort()) : retained,
    })
  }
  setCreateHumanSponsor(memberId: string): void {
    this.updateCreateDraft({ ...this.state.createDraft, humanSponsorMemberId: memberId.trim() })
  }
  setCreateAcceptor(memberId: string): void {
    this.updateCreateDraft({ ...this.state.createDraft, acceptorMemberId: memberId.trim() })
  }
  setCreateTask(taskGuid: string, selected: boolean): void {
    const normalized = taskGuid.trim()
    if (normalized === '') return
    const retained = this.state.createDraft.taskGuids.filter(value => value !== normalized)
    if (selected && retained.length >= MAX_DELIVERABLE_TASKS) return
    this.updateCreateDraft({
      ...this.state.createDraft,
      taskGuids: selected ? Object.freeze([...retained, normalized].sort()) : retained,
    })
  }
  setCreateEventMode(mode: 'create-event' | 'existing-event'): void {
    this.updateCreateDraft({ ...this.state.createDraft, eventMode: mode, eventId: '' })
  }
  setCreateEventId(eventId: string): void {
    this.updateCreateDraft({ ...this.state.createDraft, eventId: eventId.trim() })
  }
  setCreateSchedule(schedule: ProjectCalendarSchedule): void {
    this.updateCreateDraft({ ...this.state.createDraft, schedule: detachSchedule(schedule) })
  }

  addCandidateVersion(deliverableId: string, value: DeliverableArtifactVersionRef): void {
    if (!this.canEdit() || this.deliverable(deliverableId) === null) return
    const normalized = normalizeArtifact(value)
    if (normalized === null) return
    const current = this.state.candidateDrafts[deliverableId] ?? []
    if (current.length >= MAX_DELIVERABLE_CANDIDATE_VERSIONS
      || current.some(item => sameArtifactReference(item, normalized))) return
    this.clearRetryFor('request-acceptance', deliverableId)
    this.publish({
      ...this.state,
      candidateDrafts: Object.freeze({
        ...this.state.candidateDrafts,
        [deliverableId]: Object.freeze([...current, freezeArtifactDraft(normalized)]),
      }),
      issue: this.state.issue?.operation === 'request-acceptance' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  removeCandidateVersion(deliverableId: string, index: number): void {
    if (!this.canEdit()) return
    const current = this.state.candidateDrafts[deliverableId]
    if (current === undefined || index < 0 || index >= current.length) return
    this.clearRetryFor('request-acceptance', deliverableId)
    const next = { ...this.state.candidateDrafts }
    const retained = current.filter((_, candidate) => candidate !== index)
    if (retained.length === 0) delete next[deliverableId]
    else next[deliverableId] = Object.freeze(retained)
    this.publish({ ...this.state, candidateDrafts: Object.freeze(next), canRetryMutation: false })
  }

  clearCandidateVersions(deliverableId: string): void {
    if (!this.canEdit() || this.state.candidateDrafts[deliverableId] === undefined) return
    this.clearRetryFor('request-acceptance', deliverableId)
    const next = { ...this.state.candidateDrafts }
    delete next[deliverableId]
    this.publish({ ...this.state, candidateDrafts: Object.freeze(next), canRetryMutation: false })
  }

  discoverEvents(): Promise<void> {
    const projection = this.state.projection
    if (!this.canOperate() || projection?.calendarBinding === null || projection === null) {
      return Promise.resolve()
    }
    return this.track(this.doDiscoverEvents(Object.freeze({
      projectId: projection.projectId, expectedRevision: projection.scheduleRevision,
    })))
  }

  canCreate(): boolean {
    const projection = this.state.projection
    const draft = this.state.createDraft
    if (!this.canOperate() || projection?.calendarBinding === null || projection === null) return false
    const accountable = projection.memberOptions.find(item =>
      item.memberId === draft.accountableMemberId && item.status === 'active')
    const acceptor = projection.memberOptions.find(item =>
      item.memberId === draft.acceptorMemberId && item.status === 'active' && item.canAccept)
    const sponsorOkay = accountable?.requiresHumanSponsor === true
      ? projection.memberOptions.some(item => item.memberId === draft.humanSponsorMemberId
        && item.memberId !== draft.accountableMemberId && item.status === 'active'
        && item.canBeHumanSponsor)
      : draft.humanSponsorMemberId === ''
    const eventOkay = draft.eventMode === 'create-event'
      ? validProjectCalendarSchedule(draft.schedule)
      : this.eventDiscoveryCurrent()
        && this.state.eventDiscovery?.items.some(item =>
          item.eventId === draft.eventId && item.selectable) === true
    return safeRequiredText(draft.name, MAX_DELIVERABLE_NAME_LENGTH) !== null
      && safeOptionalText(draft.description, MAX_DELIVERABLE_DESCRIPTION_LENGTH) !== null
      && draft.criteria.length >= 1 && draft.criteria.length <= MAX_DELIVERABLE_CRITERIA
      && draft.criteria.every(item => safeRequiredText(item, MAX_DELIVERABLE_CRITERION_LENGTH) !== null)
      && accountable !== undefined && acceptor !== undefined && sponsorOkay && eventOkay
      && draft.contributorMemberIds.length <= MAX_DELIVERABLE_CONTRIBUTORS
      && draft.contributorMemberIds.every(id => id !== draft.accountableMemberId
        && projection.memberOptions.some(item => item.memberId === id && item.status === 'active'))
      && draft.taskGuids.length >= 1 && draft.taskGuids.length <= MAX_DELIVERABLE_TASKS
      && draft.taskGuids.every(guid => projection.taskOptions.some(item => item.taskGuid === guid))
  }

  create(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const draft = this.state.createDraft
    if (!this.canCreate() || selection === null || projection === null) return Promise.resolve()
    const event = draft.eventMode === 'existing-event'
      ? Object.freeze({ mode: 'existing-event' as const, eventId: draft.eventId })
      : Object.freeze({ mode: 'create-event' as const, schedule: detachSchedule(draft.schedule) })
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'create-deliverable',
      request: Object.freeze({
        projectId: selection.projectId, name: draft.name.trim(),
        description: nullableText(draft.description),
        criteria: Object.freeze(draft.criteria.map(statement => Object.freeze({ statement: statement.trim() }))),
        accountableMemberId: draft.accountableMemberId,
        contributorMemberIds: Object.freeze([...draft.contributorMemberIds]),
        humanSponsorMemberId: draft.humanSponsorMemberId === '' ? null : draft.humanSponsorMemberId,
        acceptorMemberId: draft.acceptorMemberId, taskGuids: Object.freeze([...draft.taskGuids]), event,
        expectedDeliverablesRevision: projection.revision, expectedDeliverableRevision: null,
        expectedTeamRevision: projection.teamRevision, expectedTaskRevision: projection.taskRevision,
        expectedScheduleRevision: projection.scheduleRevision, ...this.correlation(),
        reason: 'owner-project-deliverable-create' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  canRequestAcceptance(deliverableId: string): boolean {
    const item = this.deliverable(deliverableId)
    const candidates = this.state.candidateDrafts[deliverableId] ?? []
    return this.canOperate() && item !== null && item.state === 'planned'
      && item.calendar.remoteStatus === 'confirmed' && item.calendar.syncState === 'healthy'
      && item.tasks.every(task => task.availability === 'available')
      && candidates.length >= 1 && candidates.length <= MAX_DELIVERABLE_CANDIDATE_VERSIONS
  }

  requestAcceptance(deliverableId: string): Promise<void> {
    const projection = this.state.projection
    const item = this.deliverable(deliverableId)
    const candidates = this.state.candidateDrafts[deliverableId] ?? []
    if (!this.canRequestAcceptance(deliverableId) || projection === null || item === null) {
      return Promise.resolve()
    }
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'request-acceptance', deliverableId,
      request: Object.freeze({
        projectId: projection.projectId, deliverableId,
        candidateVersions: Object.freeze(candidates.map(toArtifactRef)),
        expectedDeliverablesRevision: projection.revision,
        expectedDeliverableRevision: item.revision,
        expectedTeamRevision: projection.teamRevision, expectedTaskRevision: projection.taskRevision,
        expectedScheduleRevision: projection.scheduleRevision,
        expectedRemoteObservationVersion: item.calendar.remoteObservationVersion,
        ...this.correlation(), reason: 'owner-deliverable-acceptance-request' as const,
      }),
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
    this.cancelAll('Workbench Deliverables connection generation changed')
    this.publish({
      ...this.state, phase: this.state.selection === null ? 'idle' : 'stale',
      pendingOperation: null, pendingDeliverableId: null, issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  connectionReset(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    this.cancelAll('Workbench Deliverables connection generation changed')
    this.publish({ ...this.state, phase: 'stale', pendingOperation: null, pendingDeliverableId: null })
    return this.track(this.doRefresh())
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Deliverables Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRefresh(): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Deliverables refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    this.publish({ ...this.state, phase: 'loading', issue: null })
    try {
      const result = await this.remote.projectDeliverables(Object.freeze({
        projectId: selection.projectId, activityLimit: 50,
      }), abort.signal)
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      if (!result.ok) return this.publishReadFailure(result.error)
      if (result.value === null) {
        this.publish({
          ...this.state, phase: 'error', issue: Object.freeze({
            kind: 'input', code: 'project-not-found', operation: 'read-deliverables',
          }),
        })
        return
      }
      this.publish({
        ...this.state, phase: 'ready', projection: detachProjection(result.value),
        eventDiscovery: null, issue: null, canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      this.publishReadFailure(error)
    }
  }

  private async doDiscoverEvents(request: DiscoverFeishuCalendarEventsRequest): Promise<void> {
    const selection = this.state.selection
    if (selection === null) return
    const operation = this.beginOperation('Workbench Deliverables event discovery was superseded')
    this.publish({ ...this.state, phase: 'loading', issue: null })
    try {
      const result = await this.remote.discoverFeishuCalendarEvents(request, operation.abort.signal)
      if (!this.acceptOperation(operation, selection.projectId)) return
      this.operationAbort = null
      if (!result.ok) return this.publishReadFailure(result.error, 'discover-events')
      this.publish({ ...this.state, phase: 'ready', eventDiscovery: detachDiscovery(result.value) })
    } catch (error) {
      if (!this.acceptOperation(operation, selection.projectId)) return
      this.operationAbort = null
      this.publishReadFailure(error, 'discover-events')
    }
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    const projectId = envelope.request.projectId
    if (this.disposed || this.state.selection?.projectId !== projectId
      || this.state.pendingOperation !== null) return
    const operation = this.beginOperation('Workbench Deliverables mutation was superseded')
    this.publish({
      ...this.state, phase: 'pending', pendingOperation: envelope.kind,
      pendingDeliverableId: envelope.kind === 'request-acceptance' ? envelope.deliverableId : null,
      issue: null, canRetryMutation: false, focusDeliverableId: null,
    })
    let result: RemoteResult<DeliverableDomainResult>
    try {
      result = envelope.kind === 'create-deliverable'
        ? await this.remote.createProjectDeliverable(envelope.request, operation.abort.signal)
        : await this.remote.requestDeliverableAcceptance(envelope.request, operation.abort.signal)
    } catch (error) {
      if (!this.acceptOperation(operation, projectId)) return
      this.operationAbort = null
      return this.publishMutationFailure(envelope, error)
    }
    if (!this.acceptOperation(operation, projectId)) return
    this.operationAbort = null
    if (!result.ok) return this.publishMutationFailure(envelope, result.error)
    const outcome = result.value
    if (!outcome.ok) {
      this.retryEnvelope = null
      const current = 'current' in outcome.error ? outcome.error.current : undefined
      this.publish({
        ...this.state, phase: 'conflict',
        projection: current === undefined ? this.state.projection : detachProjection(current),
        pendingOperation: null, pendingDeliverableId: null,
        issue: Object.freeze({ kind: 'conflict', code: outcome.error.code, operation: envelope.kind }),
        canRetryMutation: false,
      })
      return
    }
    this.retryEnvelope = null
    const returnedDeliverable = 'deliverable' in outcome ? outcome.deliverable : null
    const focusDeliverableId = returnedDeliverable !== null
      ? returnedDeliverable.deliverableId
      : envelope.kind === 'request-acceptance' ? envelope.deliverableId : null
    if (focusDeliverableId === null) {
      return this.publishMutationFailure(envelope, new Error('Deliverable response shape mismatch'))
    }
    let createDraft = this.state.createDraft
    let candidateDrafts = this.state.candidateDrafts
    if (envelope.kind === 'create-deliverable') createDraft = defaultCreateDraft(this.today())
    else {
      const next = { ...candidateDrafts }
      delete next[envelope.deliverableId]
      candidateDrafts = Object.freeze(next)
    }
    this.publish({
      ...this.state, phase: 'ready', projection: detachProjection(outcome.value),
      eventDiscovery: null, createDraft, candidateDrafts,
      pendingOperation: null, pendingDeliverableId: null, issue: null,
      canRetryMutation: false, focusDeliverableId, focusEpoch: this.state.focusEpoch + 1,
    })
    this.notifyCommitted(outcome.receipt)
  }

  private updateCreateDraft(next: WorkbenchProjectDeliverableCreateDraft): void {
    if (!this.canEdit()) return
    if (this.retryEnvelope?.kind === 'create-deliverable') this.retryEnvelope = null
    this.publish({
      ...this.state, phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      createDraft: freezeCreateDraft(next),
      issue: this.state.issue?.operation === 'create-deliverable' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private clearRetryFor(kind: MutationEnvelope['kind'], deliverableId?: string): void {
    if (this.retryEnvelope?.kind !== kind) return
    if (kind === 'request-acceptance' && this.retryEnvelope.kind === kind
      && this.retryEnvelope.deliverableId !== deliverableId) return
    this.retryEnvelope = null
  }

  private deliverable(deliverableId: string): ProjectDeliverableProjection | null {
    return this.state.projection?.deliverables.find(item => item.deliverableId === deliverableId) ?? null
  }

  private eventDiscoveryCurrent(): boolean {
    const projection = this.state.projection
    const discovery = this.state.eventDiscovery
    return projection !== null && projection.calendarBinding !== null && discovery !== null
      && discovery.projectId === projection.projectId
      && discovery.calendarId === projection.calendarBinding.calendarId
      && discovery.revision === projection.scheduleRevision
  }

  private publishReadFailure(error: unknown, operation: WorkbenchProjectDeliverablesOperation = 'read-deliverables'): void {
    const issue = classifyIssue(error, operation)
    this.publish({ ...this.state, phase: 'error', issue })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private publishMutationFailure(envelope: MutationEnvelope, error: unknown): void {
    const issue = classifyIssue(error, envelope.kind)
    if (issue.kind !== 'transport' || !AMBIGUOUS_TRANSPORT_CODES.has(
      issue.code as WorkbenchProjectDeliverablesTransportCode,
    )) this.retryEnvelope = null
    this.publish({
      ...this.state, phase: 'error', pendingOperation: null, pendingDeliverableId: null,
      issue, canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private today(): string { return this.options.today?.() ?? localIsoDate() }
  private canRead(): boolean {
    return this.admitProtectedOperation() && this.state.selection !== null
      && this.state.pendingOperation === null
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
  private beginOperation(reason: string): { readonly epoch: number; readonly abort: AbortController } {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error(reason))
    const abort = new AbortController()
    this.operationAbort = abort
    return { epoch, abort }
  }
  private acceptOperation(
    operation: { readonly epoch: number; readonly abort: AbortController }, projectId: string,
  ): boolean {
    return !this.disposed && this.state.selection?.projectId === projectId
      && this.operationEpoch === operation.epoch && this.operationAbort === operation.abort
      && !operation.abort.signal.aborted
  }
  private notifyCommitted(value: WorkbenchCommandReceipt): void {
    try { this.options.onCommitted?.(Object.freeze({ ...value })) } catch {
      console.error('[workbench-client] Deliverables committed observer failed')
    }
  }
  private notifyTransportFailure(): void {
    try { this.options.onTransportFailure?.() } catch {
      console.error('[workbench-client] Deliverables transport observer failed')
    }
  }
  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try { return this.options.onBeforeProtectedOperation?.() ?? true } catch {
      console.error('[workbench-client] Deliverables admission observer failed')
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
    void pending.then(() => { this.inFlight.delete(pending) }, () => { this.inFlight.delete(pending) })
    return pending
  }
  private publish(next: WorkbenchProjectDeliverablesClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try { listener() } catch { console.error('[workbench-client] Deliverables observer failed') }
    }
  }
}

function freezeCreateDraft(value: WorkbenchProjectDeliverableCreateDraft): WorkbenchProjectDeliverableCreateDraft {
  return Object.freeze({
    ...value, criteria: Object.freeze([...value.criteria]),
    contributorMemberIds: Object.freeze([...value.contributorMemberIds]),
    taskGuids: Object.freeze([...value.taskGuids]), schedule: detachSchedule(value.schedule),
  })
}
function freezeArtifactDraft(value: DeliverableArtifactVersionRef): WorkbenchDeclaredArtifactVersionDraft {
  return Object.freeze({ ...value, resolution: 'declared' })
}
function toArtifactRef(value: WorkbenchDeclaredArtifactVersionDraft): DeliverableArtifactVersionRef {
  return Object.freeze({
    kind: value.kind, source: value.source, resourceId: value.resourceId,
    versionId: value.versionId, displayName: value.displayName,
    canonicalUrl: value.canonicalUrl, contentDigest: value.contentDigest,
  })
}
function normalizeArtifact(value: DeliverableArtifactVersionRef): DeliverableArtifactVersionRef | null {
  if (value.kind !== 'declared-file-version'
    || !['managed', 'local', 'feishu'].includes(value.source)
    || (value.canonicalUrl !== null && !validHttpsUrl(value.canonicalUrl))
    || (value.contentDigest !== null && !WORKBENCH_DIGEST.test(value.contentDigest))) return null
  const resourceId = safeRequiredText(value.resourceId, 2_000)
  const versionId = safeRequiredText(value.versionId, 2_000)
  const displayName = safeRequiredText(value.displayName, 500)
  if (resourceId === null || versionId === null || displayName === null) return null
  return Object.freeze({
    kind: value.kind,
    source: value.source,
    resourceId,
    versionId,
    displayName,
    canonicalUrl: value.canonicalUrl,
    contentDigest: value.contentDigest,
  })
}
function sameArtifactReference(
  left: DeliverableArtifactVersionRef,
  right: DeliverableArtifactVersionRef,
): boolean {
  return left.kind === right.kind
    && left.source === right.source
    && left.resourceId === right.resourceId
    && left.versionId === right.versionId
    && left.displayName === right.displayName
    && left.canonicalUrl === right.canonicalUrl
    && left.contentDigest === right.contentDigest
}
function validHttpsUrl(value: string): boolean {
  if (value.trim() !== value || CONTROL_CHARACTER.test(value)) return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}
function safeRequiredText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed() && [...normalized].length >= 1
    && [...normalized].length <= maximum && !CONTROL_CHARACTER.test(normalized)
    ? normalized : null
}
function safeOptionalText(value: string, maximum: number): string | null {
  const normalized = value.trim()
  return normalized.isWellFormed() && [...normalized].length <= maximum
    && !CONTROL_CHARACTER.test(normalized) ? normalized : null
}
function nullableText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}
function classifyIssue(
  error: unknown, operation: WorkbenchProjectDeliverablesOperation,
): WorkbenchProjectDeliverablesIssue {
  const candidate = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectDeliverablesTransportCode)
    ? candidate as WorkbenchProjectDeliverablesTransportCode : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}
function detachSchedule(value: ProjectCalendarSchedule): ProjectCalendarSchedule {
  return value.kind === 'all-day'
    ? Object.freeze({ kind: 'all-day', startDate: value.startDate, endDate: value.endDate })
    : Object.freeze({
        kind: 'timed', startAt: value.startAt, endAt: value.endAt, timeZone: value.timeZone,
      })
}
function detachDiscovery(value: FeishuCalendarEventDiscoveryProjection): FeishuCalendarEventDiscoveryProjection {
  return Object.freeze({
    ...value, items: Object.freeze(value.items.map(item => Object.freeze({
      ...item, schedule: detachSchedule(item.schedule),
    }))),
  })
}
function detachProjection(value: ProjectDeliverablesProjection): ProjectDeliverablesProjection {
  return structuredClone(value)
}
function localIsoDate(): string {
  const now = new Date()
  return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
}
function nextIsoDate(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed + 86_400_000).toISOString().slice(0, 10)
}
