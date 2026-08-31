import type {
  FeishuActorBinding,
  FeishuConnectionIssue,
  FeishuIdentityKind,
  FeishuTaskEventInput,
  FeishuTaskListCandidateProjection,
  FeishuTaskWorkflowFieldCandidate,
  ProjectTaskProjection,
} from './client.ts'
import type { WorkbenchFeishuTaskCustomFieldValue } from './feishu-task-workflow.ts'

/** Exact, continuity-pinned Feishu route used for one provider operation. */
export interface WorkbenchFeishuTaskRoute {
  readonly kind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly appId: string
  readonly credentialRef: string
  readonly actor: FeishuActorBinding
}

/** Provider task data before the repository assigns Project scope and projection revisions. */
export type WorkbenchFeishuTaskSnapshot = Omit<
  ProjectTaskProjection,
  'scope' | 'projectionRevision'
> & {
  /** Detached provider values used only to derive the configured workflow projection. */
  readonly customFieldValues?: readonly WorkbenchFeishuTaskCustomFieldValue[]
}

/** Complete, bounded snapshot used as the reconciliation replacement baseline. */
export interface WorkbenchFeishuTaskListSnapshot {
  readonly taskList: FeishuTaskListCandidateProjection
  readonly tasks: readonly WorkbenchFeishuTaskSnapshot[]
  readonly observedAt: string
}

export type WorkbenchFeishuReadResult<T> =
  | { readonly state: 'ok'; readonly value: T }
  | { readonly state: 'rejected'; readonly issue: FeishuConnectionIssue }

export type WorkbenchFeishuWriteResult<T> =
  | { readonly state: 'ok'; readonly value: T }
  | { readonly state: 'rejected'; readonly issue: FeishuConnectionIssue }
  | { readonly state: 'unknown'; readonly issue: FeishuConnectionIssue }

export interface WorkbenchFeishuTaskPatch {
  readonly summary?: string
  readonly description?: string
  readonly completed?: boolean
  readonly workflow?: {
    readonly fieldGuid: string
    readonly optionGuid: string
  }
}

export interface WorkbenchFeishuTaskWorkflowFieldWrite {
  readonly fieldGuid: string
  readonly name: string
  readonly type: 'single_select'
  readonly remoteVersion: string
  readonly options: readonly {
    readonly optionGuid: string
    readonly name: string
    readonly colorIndex: number
    readonly hidden: boolean
  }[]
}

/** Normalized task event emitted by a trusted Feishu event connector. */
export interface WorkbenchFeishuTaskEventObservation {
  readonly event: FeishuTaskEventInput
  /** Required for upserts; removals deliberately carry no stale entity payload. */
  readonly task: WorkbenchFeishuTaskSnapshot | null
}

export type WorkbenchFeishuTaskEventListener = (
  observation: WorkbenchFeishuTaskEventObservation,
) => Promise<void>

/**
 * Provider-neutral exact-route seam. Every method receives one route and has
 * no alternate actor with which it could silently retry a denied operation.
 */
export interface WorkbenchFeishuTaskExternalAdapter {
  listTaskLists(
    route: WorkbenchFeishuTaskRoute,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskListCandidateProjection[]>>

  createTaskList(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<FeishuTaskListCandidateProjection>>

  readTaskList(
    route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskListSnapshot>>

  readTask(
    route: WorkbenchFeishuTaskRoute,
    taskGuid: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskSnapshot>>

  updateTask(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly taskGuid: string
      readonly expectedRemoteVersion: string
      readonly idempotencyKey: string
      readonly changes: WorkbenchFeishuTaskPatch
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskSnapshot> | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuTaskSnapshot
  }>

  /** Optional on legacy/fake adapters; T09 commands fail closed when absent. */
  listTaskWorkflowFields?(
    route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskWorkflowFieldCandidate[]>>

  createTaskWorkflowField?(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly taskListGuid: string
      readonly name: string
      readonly options: readonly { readonly name: string; readonly colorIndex: number }[]
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskWorkflowFieldWrite>>

  updateTaskWorkflowField?(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly fieldGuid: string
      readonly expectedRemoteVersion: string
      readonly name: string
      readonly options: readonly {
        readonly optionGuid?: string
        readonly name: string
        readonly colorIndex: number
      }[]
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskWorkflowFieldWrite> | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuTaskWorkflowFieldWrite
  }>

  /** Optional low-latency source. Durable reconciliation remains mandatory. */
  subscribeTaskEvents?(listener: WorkbenchFeishuTaskEventListener): () => void
}
