/** React-free Client state machine for one Project's Feishu task workspace. */

import type {
  BindFeishuTaskListRequest,
  BindFeishuTaskListResult,
  ConfigureFeishuTaskWorkflowMapping,
  ConfigureFeishuTaskWorkflowRequest,
  ConfigureFeishuTaskWorkflowResult,
  DiscoverFeishuTaskListsRequest,
  DiscoverFeishuTaskWorkflowFieldsRequest,
  FeishuIdentityKind,
  FeishuTaskListCandidateProjection,
  FeishuTaskListDiscoveryProjection,
  FeishuTaskWorkflowCompatibilityPreview,
  FeishuTaskWorkflowFieldDiscoveryProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
  ProjectTasksProjection,
  ProjectTasksQuery,
  PreviewFeishuTaskWorkflowRequest,
  ReconcileProjectTasksRequest,
  ReconcileProjectTasksResult,
  ReferenceFeishuTaskRequest,
  ReferenceFeishuTaskResult,
  UpdateFeishuTaskRequest,
  UpdateFeishuTaskResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchProjectTasksPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

export type WorkbenchProjectTasksOperation =
  | 'read-tasks'
  | 'discover-lists'
  | 'bind-list'
  | 'reconcile'
  | 'reference-task'
  | 'update-task'
  | 'discover-workflow-fields'
  | 'preview-workflow'
  | 'configure-workflow'

export type WorkbenchProjectTasksTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

type TaskDomainResult =
  | BindFeishuTaskListResult
  | ReconcileProjectTasksResult
  | ReferenceFeishuTaskResult
  | UpdateFeishuTaskResult
  | ConfigureFeishuTaskWorkflowResult

export type WorkbenchProjectTasksConflictCode = Extract<
  TaskDomainResult,
  { readonly ok: false }
>['error']['code']

export interface WorkbenchProjectTasksTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchProjectTasksTransportCode
  readonly operation: WorkbenchProjectTasksOperation
}

export interface WorkbenchProjectTasksInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request' | 'project-not-found'
  readonly operation: WorkbenchProjectTasksOperation
}

export interface WorkbenchProjectTasksConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchProjectTasksConflictCode
  readonly operation: Exclude<
    WorkbenchProjectTasksOperation,
    'read-tasks' | 'discover-lists' | 'discover-workflow-fields' | 'preview-workflow'
  >
}

export type WorkbenchProjectTasksIssue =
  | WorkbenchProjectTasksTransportIssue
  | WorkbenchProjectTasksInputIssue
  | WorkbenchProjectTasksConflictIssue

export interface WorkbenchProjectTasksSelection {
  readonly projectId: string
  readonly projectName: string
}

export interface WorkbenchProjectTasksClientState {
  readonly phase: WorkbenchProjectTasksPhase
  readonly selection: WorkbenchProjectTasksSelection | null
  readonly projection: ProjectTasksProjection | null
  readonly discovery: FeishuTaskListDiscoveryProjection | null
  readonly workflowDiscovery: FeishuTaskWorkflowFieldDiscoveryProjection | null
  readonly workflowPreview: FeishuTaskWorkflowCompatibilityPreview | null
  readonly pendingOperation: Exclude<WorkbenchProjectTasksOperation, 'read-tasks'> | null
  readonly pendingTaskGuid: string | null
  readonly issue: WorkbenchProjectTasksIssue | null
  readonly canRetryMutation: boolean
  readonly focusTaskGuid: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` Project Tasks subset consumed by this controller. */
export interface WorkbenchProjectTasksRemote {
  projectTasks(
    query: ProjectTasksQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectTasksProjection | null>>
  discoverFeishuTaskLists(
    request: DiscoverFeishuTaskListsRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuTaskListDiscoveryProjection>>
  bindFeishuTaskList(
    request: BindFeishuTaskListRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<BindFeishuTaskListResult>>
  reconcileProjectTasks(
    request: ReconcileProjectTasksRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ReconcileProjectTasksResult>>
  referenceFeishuTask(
    request: ReferenceFeishuTaskRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ReferenceFeishuTaskResult>>
  updateFeishuTask(
    request: UpdateFeishuTaskRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<UpdateFeishuTaskResult>>
  discoverFeishuTaskWorkflowFields(
    request: DiscoverFeishuTaskWorkflowFieldsRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuTaskWorkflowFieldDiscoveryProjection>>
  previewFeishuTaskWorkflow(
    request: PreviewFeishuTaskWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuTaskWorkflowCompatibilityPreview>>
  configureFeishuTaskWorkflow(
    request: ConfigureFeishuTaskWorkflowRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ConfigureFeishuTaskWorkflowResult>>
}

export interface WorkbenchProjectTasksControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
}

type MutationEnvelope =
  | Readonly<{ readonly kind: 'bind-list'; readonly request: BindFeishuTaskListRequest }>
  | Readonly<{ readonly kind: 'reference-task'; readonly request: ReferenceFeishuTaskRequest }>
  | Readonly<{ readonly kind: 'update-task'; readonly request: UpdateFeishuTaskRequest }>
  | Readonly<{
    readonly kind: 'configure-workflow'
    readonly request: ConfigureFeishuTaskWorkflowRequest
  }>

const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectTasksTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const FEISHU_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u

export const MAX_FEISHU_TASK_LIST_NAME_LENGTH = 100
export const MAX_FEISHU_TASK_TEXT_LENGTH = 3_000
export const MAX_FEISHU_TASK_RESOURCE_ID_LENGTH = 256
export const MAX_PROJECT_TASK_WORKFLOW_STATES = 100
export const MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH = 64
export const MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH = 50
export const MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH = 50
export const MIN_FEISHU_WORKFLOW_COLOR_INDEX = 0
export const MAX_FEISHU_WORKFLOW_COLOR_INDEX = 54

export interface WorkbenchProjectTaskWorkflowTransition {
  readonly stateId: string
  readonly name: string
  readonly colorIndex: number
  readonly terminal: boolean
}

export const INITIAL_WORKBENCH_PROJECT_TASKS_STATE: WorkbenchProjectTasksClientState
  = Object.freeze({
    phase: 'idle',
    selection: null,
    projection: null,
    discovery: null,
    workflowDiscovery: null,
    workflowPreview: null,
    pendingOperation: null,
    pendingTaskGuid: null,
    issue: null,
    canRetryMutation: false,
    focusTaskGuid: null,
    focusEpoch: 0,
  })

/**
 * Owns one Project's task mirror and explicit command envelopes. Transport
 * ambiguity is never retried automatically; only an Owner action can replay
 * the exact Host idempotency key, and Host keeps unknown provider writes inert.
 */
export class WorkbenchProjectTasksController {
  private state: WorkbenchProjectTasksClientState = INITIAL_WORKBENCH_PROJECT_TASKS_STATE
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
    private readonly remote: WorkbenchProjectTasksRemote,
    private readonly options: WorkbenchProjectTasksControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectTasksClientState => this.state

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
    this.cancelAll('Workbench Project Tasks switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_PROJECT_TASKS_STATE,
      phase: 'loading',
      selection: Object.freeze({ projectId: normalized, projectName }),
    })
    return this.track(this.doRefresh(false))
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project Tasks selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_PROJECT_TASKS_STATE)
  }

  refresh(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null
      || this.state.pendingOperation !== null) return Promise.resolve()
    return this.track(this.doRefresh(false))
  }

  discover(
    kind: FeishuIdentityKind,
    expectedConnectionRevision: number,
    expectedRouteGeneration: number,
  ): Promise<void> {
    const selection = this.state.selection
    if (!this.canOperate() || selection === null || this.state.projection?.binding !== null) {
      return Promise.resolve()
    }
    const request: DiscoverFeishuTaskListsRequest = Object.freeze({
      projectId: selection.projectId,
      kind,
      expectedConnectionRevision,
      expectedRouteGeneration,
    })
    return this.track(this.doDiscover(request))
  }

  bindExisting(candidate: FeishuTaskListCandidateProjection): Promise<void> {
    const discovery = this.state.discovery
    if (discovery === null || !discovery.items.some(item => item.taskListGuid === candidate.taskListGuid)) {
      return Promise.resolve()
    }
    return this.bind(Object.freeze({ mode: 'existing', taskListGuid: candidate.taskListGuid }))
  }

  createAndBind(name: string): Promise<void> {
    const normalized = safeBoundedText(name, MAX_FEISHU_TASK_LIST_NAME_LENGTH)
    if (normalized === null || this.state.discovery === null) return Promise.resolve()
    return this.bind(Object.freeze({ mode: 'create', name: normalized }))
  }

  discoverWorkflowFields(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null) {
      return Promise.resolve()
    }
    const request: DiscoverFeishuTaskWorkflowFieldsRequest = Object.freeze({
      projectId: selection.projectId,
      expectedTaskRevision: projection.revision,
    })
    return this.track(this.doWorkflowDiscovery(request))
  }

  previewWorkflow(
    definition: ProjectTaskWorkflowDefinition,
    mapping: ConfigureFeishuTaskWorkflowMapping,
  ): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null) {
      return Promise.resolve()
    }
    const normalizedDefinition = normalizeWorkflowDefinition(definition)
    const normalizedMapping = normalizedDefinition === null
      ? null
      : normalizeWorkflowMapping(mapping, normalizedDefinition, projection, this.state.workflowDiscovery)
    if (normalizedDefinition === null || normalizedMapping === null) {
      this.publishInputFailure('preview-workflow')
      return Promise.resolve()
    }
    const request: PreviewFeishuTaskWorkflowRequest = Object.freeze({
      projectId: selection.projectId,
      expectedTaskRevision: projection.revision,
      expectedWorkflowRevision: projection.workflow?.revision ?? null,
      definition: normalizedDefinition,
      mapping: normalizedMapping,
    })
    return this.track(this.doWorkflowPreview(request))
  }

  canConfigureWorkflow(
    definition: ProjectTaskWorkflowDefinition,
    mapping: ConfigureFeishuTaskWorkflowMapping,
  ): boolean {
    const projection = this.state.projection
    const preview = this.state.workflowPreview
    if (this.retryEnvelope !== null || projection === null || preview === null
      || preview.compatibility.state === 'blocked'
      || preview.taskRevision !== projection.revision
      || preview.workflowRevision !== (projection.workflow?.revision ?? null)) return false
    const normalizedDefinition = normalizeWorkflowDefinition(definition)
    const normalizedMapping = normalizedDefinition === null
      ? null
      : normalizeWorkflowMapping(mapping, normalizedDefinition, projection, this.state.workflowDiscovery)
    return normalizedDefinition !== null
      && normalizedMapping !== null
      && sameWorkflowIntent(preview, normalizedDefinition, normalizedMapping)
  }

  configureWorkflow(
    definition: ProjectTaskWorkflowDefinition,
    mapping: ConfigureFeishuTaskWorkflowMapping,
  ): Promise<void> {
    const selection = this.state.selection
    const preview = this.state.workflowPreview
    if (!this.canOperate() || selection === null || preview === null
      || !this.canConfigureWorkflow(definition, mapping)) return Promise.resolve()
    const correlation = this.correlation()
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'configure-workflow',
      request: Object.freeze({
        projectId: selection.projectId,
        expectedTaskRevision: preview.taskRevision,
        expectedWorkflowRevision: preview.workflowRevision,
        definition: detachWorkflowDefinition(preview.definition),
        mapping: detachWorkflowMapping(preview.mapping),
        ...correlation,
        reason: 'owner-feishu-task-workflow-configure' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  allowedWorkflowTransitions(taskGuid: string): readonly WorkbenchProjectTaskWorkflowTransition[] {
    const projection = this.state.projection
    if (projection === null) return Object.freeze([])
    return allowedProjectTaskWorkflowTransitions(projection, taskGuid)
  }

  reconcile(): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null) {
      return Promise.resolve()
    }
    const request: ReconcileProjectTasksRequest = Object.freeze({
      projectId: selection.projectId,
      expectedRevision: projection.revision,
    })
    return this.track(this.doReconcile(request))
  }

  reference(taskGuid: string): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const normalized = taskGuid.trim()
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null
      || !FEISHU_RESOURCE_ID.test(normalized)) return Promise.resolve()
    const correlation = this.correlation()
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'reference-task',
      request: Object.freeze({
        projectId: selection.projectId,
        taskGuid: normalized,
        expectedRevision: projection.revision,
        ...correlation,
        reason: 'owner-feishu-task-reference' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  update(
    task: ProjectTaskProjection,
    changes: UpdateFeishuTaskRequest['changes'],
  ): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    if (!this.canOperate() || selection === null || projection === null
      || projection.binding === null
      || !projection.tasks.some(candidate => candidate.taskGuid === task.taskGuid)) {
      return Promise.resolve()
    }
    const normalized = normalizeChanges(task, changes, projection.workflow)
    if (normalized === null) return Promise.resolve()
    if (normalized.workflowStateId !== undefined && projection.workflow === null) {
      return Promise.resolve()
    }
    const correlation = this.correlation()
    const envelope: MutationEnvelope = Object.freeze({
      kind: 'update-task',
      request: Object.freeze({
        projectId: selection.projectId,
        taskGuid: task.taskGuid,
        expectedRevision: projection.revision,
        expectedRemoteVersion: task.remoteVersion,
        ...(normalized.workflowStateId === undefined
          ? {}
          : { expectedWorkflowRevision: (projection.workflow as ProjectTaskWorkflowProjection).revision }),
        changes: normalized,
        ...correlation,
        reason: 'owner-feishu-task-update' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  retryMutation(): Promise<void> {
    if (!this.canOperate() || this.retryEnvelope === null) return Promise.resolve()
    return this.track(this.doMutation(this.retryEnvelope))
  }

  markDisconnected(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project Tasks connection generation changed')
    this.publish({
      ...this.state,
      phase: this.state.selection === null ? 'idle' : 'stale',
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null) return Promise.resolve()
    this.cancelAll('Workbench Project Tasks connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
    return this.track(this.doRefresh(false))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Project Tasks Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_TASKS_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async bind(mode: Pick<
    Extract<BindFeishuTaskListRequest, { readonly mode: 'existing' }>,
    'mode' | 'taskListGuid'
  > | Pick<
    Extract<BindFeishuTaskListRequest, { readonly mode: 'create' }>,
    'mode' | 'name'
  >): Promise<void> {
    const selection = this.state.selection
    const projection = this.state.projection
    const discovery = this.state.discovery
    if (!this.canOperate() || selection === null || projection?.binding !== null
      || discovery === null) return
    const correlation = this.correlation()
    const common = {
      projectId: selection.projectId,
      kind: discovery.kind,
      expectedConnectionRevision: discovery.connectionRevision,
      expectedRouteGeneration: discovery.routeGeneration,
      expectedBindingRevision: null,
      ...correlation,
      reason: 'owner-feishu-task-list-bind' as const,
    }
    const request: BindFeishuTaskListRequest = mode.mode === 'existing'
      ? Object.freeze({ ...common, mode: 'existing', taskListGuid: mode.taskListGuid })
      : Object.freeze({ ...common, mode: 'create', name: mode.name })
    const envelope: MutationEnvelope = Object.freeze({ kind: 'bind-list', request })
    this.retryEnvelope = envelope
    return await this.track(this.doMutation(envelope))
  }

  private async doRefresh(keepIssue: boolean): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Project Tasks refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    const retainedIssue = keepIssue ? this.state.issue : null
    this.publish({
      ...this.state,
      phase: this.state.projection === null ? 'loading' : keepIssue ? 'conflict' : 'stale',
      issue: retainedIssue,
    })
    try {
      const result = await this.remote.projectTasks(
        Object.freeze({ projectId: selection.projectId }),
        abort.signal,
      )
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      if (!result.ok) {
        this.publishFailure('read-tasks', result.error, false)
        return
      }
      if (result.value === null) {
        this.publish({
          ...this.state,
          phase: 'error',
          projection: null,
          issue: Object.freeze({
            kind: 'input', code: 'project-not-found', operation: 'read-tasks',
          }),
        })
        return
      }
      const projection = detachProjection(result.value)
      this.publish({
        ...this.state,
        phase: keepIssue && retainedIssue?.kind === 'conflict' ? 'conflict' : 'ready',
        projection,
        discovery: result.value.binding === null ? this.state.discovery : null,
        workflowDiscovery: workflowDiscoveryMatches(this.state.workflowDiscovery, projection)
          ? this.state.workflowDiscovery
          : null,
        workflowPreview: workflowPreviewMatchesProjection(this.state.workflowPreview, projection)
          ? this.state.workflowPreview
          : null,
        issue: retainedIssue,
        canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      this.publishFailure('read-tasks', error, false)
    }
  }

  private async doDiscover(request: DiscoverFeishuTaskListsRequest): Promise<void> {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error('Workbench task-list discovery was superseded'))
    const abort = new AbortController()
    this.operationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: 'discover-lists',
      pendingTaskGuid: null,
      issue: null,
    })
    try {
      const result = await this.remote.discoverFeishuTaskLists(request, abort.signal)
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('discover-lists', result.error, false)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        discovery: detachDiscovery(result.value),
        pendingOperation: null,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('discover-lists', error, false)
    }
  }

  private async doWorkflowDiscovery(
    request: DiscoverFeishuTaskWorkflowFieldsRequest,
  ): Promise<void> {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error('Workbench workflow-field discovery was superseded'))
    const abort = new AbortController()
    this.operationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: 'discover-workflow-fields',
      pendingTaskGuid: null,
      issue: null,
    })
    try {
      const result = await this.remote.discoverFeishuTaskWorkflowFields(request, abort.signal)
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('discover-workflow-fields', result.error, false)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        workflowDiscovery: detachWorkflowDiscovery(result.value),
        workflowPreview: null,
        pendingOperation: null,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('discover-workflow-fields', error, false)
    }
  }

  private async doWorkflowPreview(request: PreviewFeishuTaskWorkflowRequest): Promise<void> {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error('Workbench workflow preview was superseded'))
    const abort = new AbortController()
    this.operationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      workflowPreview: null,
      pendingOperation: 'preview-workflow',
      pendingTaskGuid: null,
      issue: null,
    })
    try {
      const result = await this.remote.previewFeishuTaskWorkflow(request, abort.signal)
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('preview-workflow', result.error, false)
        return
      }
      this.publish({
        ...this.state,
        phase: 'ready',
        workflowPreview: detachWorkflowPreview(result.value),
        pendingOperation: null,
        issue: null,
      })
    } catch (error) {
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('preview-workflow', error, false)
    }
  }

  private async doReconcile(request: ReconcileProjectTasksRequest): Promise<void> {
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error('Workbench task reconciliation was superseded'))
    const abort = new AbortController()
    this.operationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: 'reconcile',
      pendingTaskGuid: null,
      issue: null,
    })
    try {
      const result = await this.remote.reconcileProjectTasks(request, abort.signal)
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      if (!result.ok) {
        this.publishFailure('reconcile', result.error, false)
        return
      }
      if (!result.value.ok) {
        this.publishDomainConflict('reconcile', result.value.error.code)
        await this.doRefresh(true)
        return
      }
      this.publishProjection(result.value.value, null)
    } catch (error) {
      if (!this.acceptOperation(epoch, abort, request.projectId)) return
      this.operationAbort = null
      this.publishFailure('reconcile', error, false)
    }
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    if (this.disposed || this.state.selection?.projectId !== envelope.request.projectId) return
    const epoch = ++this.operationEpoch
    this.operationAbort?.abort(new Error('Workbench Project Tasks operation was superseded'))
    const abort = new AbortController()
    this.operationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.kind,
      pendingTaskGuid: 'taskGuid' in envelope.request ? envelope.request.taskGuid : null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
    })
    let result: RemoteResult<
      BindFeishuTaskListResult
      | ReferenceFeishuTaskResult
      | UpdateFeishuTaskResult
      | ConfigureFeishuTaskWorkflowResult
    >
    try {
      result = await this.invokeMutation(envelope, abort.signal)
    } catch (error) {
      if (!this.acceptOperation(epoch, abort, envelope.request.projectId)) return
      this.operationAbort = null
      this.publishFailure(envelope.kind, error, true)
      return
    }
    if (!this.acceptOperation(epoch, abort, envelope.request.projectId)) return
    this.operationAbort = null
    if (!result.ok) {
      this.publishFailure(envelope.kind, result.error, true)
      return
    }
    const outcome = result.value
    if (!outcome.ok) {
      this.retryEnvelope = null
      this.publishDomainConflict(
        envelope.kind,
        outcome.error.code,
        envelope.kind === 'configure-workflow',
      )
      await this.doRefresh(true)
      return
    }
    this.retryEnvelope = null
    const focusTaskGuid = envelope.kind === 'bind-list' || envelope.kind === 'configure-workflow'
      ? null
      : envelope.request.taskGuid
    this.publishProjection(outcome.value, focusTaskGuid)
    this.notifyCommitted(outcome.receipt)
  }

  private async invokeMutation(
    envelope: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<RemoteResult<
    BindFeishuTaskListResult
    | ReferenceFeishuTaskResult
    | UpdateFeishuTaskResult
    | ConfigureFeishuTaskWorkflowResult
  >> {
    switch (envelope.kind) {
      case 'bind-list': return await this.remote.bindFeishuTaskList(envelope.request, signal)
      case 'reference-task': return await this.remote.referenceFeishuTask(envelope.request, signal)
      case 'update-task': return await this.remote.updateFeishuTask(envelope.request, signal)
      case 'configure-workflow': {
        return await this.remote.configureFeishuTaskWorkflow(envelope.request, signal)
      }
    }
  }

  private publishProjection(value: ProjectTasksProjection, focusTaskGuid: string | null): void {
    const projection = detachProjection(value)
    this.publish({
      ...this.state,
      phase: 'ready',
      projection,
      discovery: projection.binding === null ? this.state.discovery : null,
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid,
      focusEpoch: focusTaskGuid === null ? this.state.focusEpoch : this.state.focusEpoch + 1,
    })
  }

  private publishDomainConflict(
    operation: Exclude<
      WorkbenchProjectTasksOperation,
      'read-tasks' | 'discover-lists' | 'discover-workflow-fields' | 'preview-workflow'
    >,
    code: WorkbenchProjectTasksConflictCode,
    clearWorkflowPreview = false,
  ): void {
    this.publish({
      ...this.state,
      phase: 'conflict',
      pendingOperation: null,
      pendingTaskGuid: null,
      ...(clearWorkflowPreview ? { workflowPreview: null } : {}),
      issue: Object.freeze({ kind: 'conflict', code, operation }),
      canRetryMutation: false,
    })
  }

  private publishInputFailure(operation: WorkbenchProjectTasksOperation): void {
    this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: Object.freeze({ kind: 'input', code: 'bad-request', operation }),
      canRetryMutation: false,
    })
  }

  private publishFailure(
    operation: WorkbenchProjectTasksOperation,
    error: unknown,
    retainReplay: boolean,
  ): void {
    const issue = classifyTransportOrInput(error, operation)
    if (!retainReplay || issue.kind === 'input') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingTaskGuid: null,
      issue,
      canRetryMutation: retainReplay && issue.kind === 'transport' && this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
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

  private acceptOperation(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed
      && this.state.selection?.projectId === projectId
      && this.operationEpoch === epoch
      && this.operationAbort === abort
      && !abort.signal.aborted
  }

  private notifyCommitted(receipt: WorkbenchCommandReceipt): void {
    try {
      this.options.onCommitted?.(Object.freeze({ ...receipt }))
    } catch {
      console.error('[workbench-client] Project Tasks committed observer failed')
    }
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Project Tasks transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Project Tasks admission observer failed')
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

  private publish(next: WorkbenchProjectTasksClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Project Tasks state observer failed')
      }
    }
  }
}

function normalizeChanges(
  task: ProjectTaskProjection,
  changes: UpdateFeishuTaskRequest['changes'],
  workflow: ProjectTaskWorkflowProjection | null,
): UpdateFeishuTaskRequest['changes'] | null {
  if (changes.workflowStateId !== undefined && changes.completed !== undefined) return null
  const next: {
    summary?: string
    description?: string
    completed?: boolean
    workflowStateId?: string
  } = {}
  if (changes.summary !== undefined) {
    const summary = safeBoundedText(changes.summary, MAX_FEISHU_TASK_TEXT_LENGTH)
    if (summary === null) return null
    if (summary !== task.summary) next.summary = summary
  }
  if (changes.description !== undefined) {
    const description = safeOptionalText(changes.description, MAX_FEISHU_TASK_TEXT_LENGTH)
    if (description === null) return null
    if (description !== task.description) next.description = description
  }
  if (changes.completed !== undefined && changes.completed !== task.completed) {
    next.completed = changes.completed
  }
  if (changes.workflowStateId !== undefined) {
    const requested = safeWorkflowStateId(changes.workflowStateId)
    if (requested === null || workflow === null) return null
    const allowed = allowedWorkflowTransitions(workflow, task.taskGuid)
    if (!allowed.some(candidate => candidate.stateId === requested)) return null
    next.workflowStateId = requested
  }
  return Object.keys(next).length === 0 ? null : Object.freeze(next)
}

function normalizeWorkflowDefinition(
  definition: ProjectTaskWorkflowDefinition,
): ProjectTaskWorkflowDefinition | null {
  const fieldName = safeBoundedText(definition.fieldName, MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH)
  if (fieldName === null || !Array.isArray(definition.states)
    || definition.states.length < 2
    || definition.states.length > MAX_PROJECT_TASK_WORKFLOW_STATES) return null
  const ids = new Set<string>()
  const names = new Set<string>()
  const states: ProjectTaskWorkflowDefinition['states'][number][] = []
  for (const candidate of definition.states) {
    const stateId = safeWorkflowStateId(candidate.stateId)
    const name = safeBoundedText(candidate.name, MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH)
    if (stateId === null || name === null || ids.has(stateId) || names.has(name)
      || !Number.isInteger(candidate.colorIndex)
      || candidate.colorIndex < MIN_FEISHU_WORKFLOW_COLOR_INDEX
      || candidate.colorIndex > MAX_FEISHU_WORKFLOW_COLOR_INDEX
      || !Array.isArray(candidate.allowedNextStateIds)) return null
    const allowedNextStateIds = candidate.allowedNextStateIds.map(
      (target: string) => safeWorkflowStateId(target),
    )
    if (allowedNextStateIds.some((target: string | null) => target === null)) return null
    const targets = allowedNextStateIds as string[]
    if (new Set(targets).size !== targets.length || targets.includes(stateId)) return null
    ids.add(stateId)
    names.add(name)
    states.push(Object.freeze({
      stateId,
      name,
      colorIndex: candidate.colorIndex,
      allowedNextStateIds: Object.freeze(targets),
    }))
  }
  if (states.some(state => state.allowedNextStateIds.some(target => !ids.has(target)))) return null
  const initialStateId = safeWorkflowStateId(definition.initialStateId)
  if (initialStateId === null || !ids.has(initialStateId)
    || !Array.isArray(definition.terminalStateIds)
    || definition.terminalStateIds.length < 1
    || definition.terminalStateIds.length > states.length) return null
  const terminalStateIds = definition.terminalStateIds.map(safeWorkflowStateId)
  if (terminalStateIds.some(stateId => stateId === null)) return null
  const terminals = terminalStateIds as string[]
  if (new Set(terminals).size !== terminals.length
    || terminals.some(stateId => !ids.has(stateId))
    || terminals.some(stateId => (
      states.find(state => state.stateId === stateId)?.allowedNextStateIds.length ?? 1
    ) !== 0)) return null
  return Object.freeze({
    fieldName,
    initialStateId,
    terminalStateIds: Object.freeze(terminals),
    states: Object.freeze(states),
  })
}

function normalizeWorkflowMapping(
  mapping: ConfigureFeishuTaskWorkflowMapping,
  definition: ProjectTaskWorkflowDefinition,
  projection: ProjectTasksProjection,
  discovery: FeishuTaskWorkflowFieldDiscoveryProjection | null,
): ConfigureFeishuTaskWorkflowMapping | null {
  if (mapping.mode === 'create') return Object.freeze({ mode: 'create' })
  if (mapping.mode === 'migrate') return Object.freeze({ mode: 'migrate' })
  if (!workflowDiscoveryMatches(discovery, projection)
    || discovery === null
    || !FEISHU_RESOURCE_ID.test(mapping.fieldGuid)) return null
  const field = discovery.items.find(candidate => candidate.fieldGuid === mapping.fieldGuid)
  if (field === undefined || field.type !== 'single_select'
    || mapping.options.length !== definition.states.length) return null
  const definitionIds = new Set(definition.states.map(state => state.stateId))
  const stateIds = new Set<string>()
  const optionGuids = new Set<string>()
  const options: Extract<
    ConfigureFeishuTaskWorkflowMapping,
    { readonly mode: 'existing' }
  >['options'][number][] = []
  for (const candidate of mapping.options) {
    const stateId = safeWorkflowStateId(candidate.stateId)
    if (stateId === null || !definitionIds.has(stateId) || stateIds.has(stateId)
      || !FEISHU_RESOURCE_ID.test(candidate.optionGuid)
      || optionGuids.has(candidate.optionGuid)
      || !field.options.some(option => option.optionGuid === candidate.optionGuid)) return null
    stateIds.add(stateId)
    optionGuids.add(candidate.optionGuid)
    options.push(Object.freeze({ stateId, optionGuid: candidate.optionGuid }))
  }
  if (stateIds.size !== definitionIds.size) return null
  const byState = new Map(options.map(option => [option.stateId, option] as const))
  return Object.freeze({
    mode: 'existing',
    fieldGuid: mapping.fieldGuid,
    options: Object.freeze(definition.states.map(state => byState.get(state.stateId) as typeof options[number])),
  })
}

function safeWorkflowStateId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH
    && /^[a-z][a-z0-9-]*$/u.test(value)
    ? value
    : null
}

export function allowedProjectTaskWorkflowTransitions(
  projection: ProjectTasksProjection,
  taskGuid: string,
): readonly WorkbenchProjectTaskWorkflowTransition[] {
  if (!projection.tasks.some(task => task.taskGuid === taskGuid) || projection.workflow === null) {
    return Object.freeze([])
  }
  return allowedWorkflowTransitions(projection.workflow, taskGuid)
}

function allowedWorkflowTransitions(
  workflow: ProjectTaskWorkflowProjection,
  taskGuid: string,
): readonly WorkbenchProjectTaskWorkflowTransition[] {
  if (workflow.compatibility.state === 'blocked') return Object.freeze([])
  const value = workflow.values.find(candidate => candidate.taskGuid === taskGuid)
  if (value?.recognized === false) return Object.freeze([])
  const targetIds = value?.stateId === null || value === undefined
    ? [workflow.definition.initialStateId]
    : workflow.definition.states.find(state => state.stateId === value.stateId)
      ?.allowedNextStateIds ?? []
  const terminals = new Set(workflow.definition.terminalStateIds)
  return Object.freeze(targetIds.flatMap((stateId) => {
    const definition = workflow.definition.states.find(state => state.stateId === stateId)
    const option = workflow.options.find(candidate => candidate.stateId === stateId)
    return definition === undefined || option === undefined || option.hidden
      ? []
      : [Object.freeze({
          stateId,
          name: definition.name,
          colorIndex: definition.colorIndex,
          terminal: terminals.has(stateId),
        })]
  }))
}

function safeBoundedText(value: string, maximum: number): string | null {
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
  operation: WorkbenchProjectTasksOperation,
): WorkbenchProjectTasksTransportIssue | WorkbenchProjectTasksInputIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectTasksTransportCode)
    ? candidate as WorkbenchProjectTasksTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}

function detachDiscovery(value: FeishuTaskListDiscoveryProjection): FeishuTaskListDiscoveryProjection {
  return Object.freeze({
    projectId: value.projectId,
    connectionRevision: value.connectionRevision,
    kind: value.kind,
    routeGeneration: value.routeGeneration,
    items: Object.freeze(value.items.map(item => Object.freeze({ ...item }))),
  })
}

function detachWorkflowDefinition(
  value: ProjectTaskWorkflowDefinition,
): ProjectTaskWorkflowDefinition {
  return Object.freeze({
    fieldName: value.fieldName,
    initialStateId: value.initialStateId,
    terminalStateIds: Object.freeze([...value.terminalStateIds]),
    states: Object.freeze(value.states.map(state => Object.freeze({
      ...state,
      allowedNextStateIds: Object.freeze([...state.allowedNextStateIds]),
    }))),
  })
}

function detachWorkflowMapping(
  value: ConfigureFeishuTaskWorkflowMapping,
): ConfigureFeishuTaskWorkflowMapping {
  if (value.mode === 'create') return Object.freeze({ mode: 'create' })
  if (value.mode === 'migrate') return Object.freeze({ mode: 'migrate' })
  return Object.freeze({
    mode: 'existing',
    fieldGuid: value.fieldGuid,
    options: Object.freeze(value.options.map(option => Object.freeze({ ...option }))),
  })
}

function detachWorkflowDiscovery(
  value: FeishuTaskWorkflowFieldDiscoveryProjection,
): FeishuTaskWorkflowFieldDiscoveryProjection {
  return Object.freeze({
    projectId: value.projectId,
    taskListGuid: value.taskListGuid,
    taskRevision: value.taskRevision,
    items: Object.freeze(value.items.map(field => Object.freeze({
      ...field,
      options: Object.freeze(field.options.map(option => Object.freeze({ ...option }))),
    }))),
  })
}

function detachWorkflowPreview(
  value: FeishuTaskWorkflowCompatibilityPreview,
): FeishuTaskWorkflowCompatibilityPreview {
  return Object.freeze({
    projectId: value.projectId,
    taskRevision: value.taskRevision,
    workflowRevision: value.workflowRevision,
    definition: detachWorkflowDefinition(value.definition),
    mapping: detachWorkflowMapping(value.mapping),
    compatibility: Object.freeze({
      state: value.compatibility.state,
      issues: Object.freeze(value.compatibility.issues.map(issue => Object.freeze({ ...issue }))),
    }),
    usedStateIds: Object.freeze([...value.usedStateIds]),
  })
}

function detachWorkflowProjection(
  value: ProjectTaskWorkflowProjection,
): ProjectTaskWorkflowProjection {
  return Object.freeze({
    revision: value.revision,
    definition: detachWorkflowDefinition(value.definition),
    field: Object.freeze({ ...value.field }),
    options: Object.freeze(value.options.map(option => Object.freeze({ ...option }))),
    values: Object.freeze(value.values.map(taskValue => Object.freeze({ ...taskValue }))),
    compatibility: Object.freeze({
      state: value.compatibility.state,
      issues: Object.freeze(value.compatibility.issues.map(issue => Object.freeze({ ...issue }))),
    }),
    completionSuggestions: Object.freeze(
      value.completionSuggestions.map(suggestion => Object.freeze({ ...suggestion })),
    ),
    configuredAt: value.configuredAt,
    updatedAt: value.updatedAt,
  })
}

function workflowDiscoveryMatches(
  discovery: FeishuTaskWorkflowFieldDiscoveryProjection | null,
  projection: ProjectTasksProjection,
): boolean {
  return discovery !== null
    && projection.binding !== null
    && discovery.projectId === projection.projectId
    && discovery.taskListGuid === projection.binding.taskListGuid
    && discovery.taskRevision === projection.revision
}

function workflowPreviewMatchesProjection(
  preview: FeishuTaskWorkflowCompatibilityPreview | null,
  projection: ProjectTasksProjection,
): boolean {
  return preview !== null
    && preview.projectId === projection.projectId
    && preview.taskRevision === projection.revision
    && preview.workflowRevision === (projection.workflow?.revision ?? null)
}

function sameWorkflowIntent(
  preview: FeishuTaskWorkflowCompatibilityPreview,
  definition: ProjectTaskWorkflowDefinition,
  mapping: ConfigureFeishuTaskWorkflowMapping,
): boolean {
  return JSON.stringify(preview.definition) === JSON.stringify(definition)
    && JSON.stringify(preview.mapping) === JSON.stringify(mapping)
}

function detachProjection(value: ProjectTasksProjection): ProjectTasksProjection {
  return Object.freeze({
    projectId: value.projectId,
    revision: value.revision,
    binding: value.binding === null ? null : Object.freeze({
      ...value.binding,
      identity: Object.freeze({ ...value.binding.identity }),
    }),
    tasks: Object.freeze(value.tasks.map(task => Object.freeze({
      ...task,
      assignees: Object.freeze(task.assignees.map(member => Object.freeze({ ...member }))),
      followers: Object.freeze(task.followers.map(member => Object.freeze({ ...member }))),
      comments: Object.freeze(task.comments.map(comment => Object.freeze({
        ...comment,
        creator: comment.creator === null ? null : Object.freeze({ ...comment.creator }),
      }))),
    }))),
    sync: Object.freeze({
      ...value.sync,
      issue: value.sync.issue === null ? null : Object.freeze({ ...value.sync.issue }),
    }),
    effects: Object.freeze(value.effects.map(effect => Object.freeze({ ...effect }))),
    workflow: value.workflow === null ? null : detachWorkflowProjection(value.workflow),
  })
}
