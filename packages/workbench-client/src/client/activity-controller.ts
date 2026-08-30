/** React-free Client state machine for Activity and audit-integrity projections. */

import type {
  WorkbenchActivityFilter,
  WorkbenchActivityItem,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** One generated Remote subset consumed by the Activity controller. */
export interface WorkbenchActivityRemote {
  activity(
    filter: WorkbenchActivityFilter,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkbenchActivityProjection>>
}

/** Activity retains same-filter results while stale and clears results when a filter changes. */
export type WorkbenchActivityPhase = 'loading' | 'ready' | 'stale' | 'error'

/** Display-safe transport issue. Remote messages and details are never retained. */
export interface WorkbenchActivityTransportIssue {
  readonly kind: 'transport' | 'input'
  readonly code: string
}

/** Immutable state consumed through useSyncExternalStore. */
export interface WorkbenchActivityClientState {
  readonly phase: WorkbenchActivityPhase
  readonly filter: WorkbenchActivityFilter
  readonly activity: WorkbenchActivityProjection | null
  readonly integrity: WorkbenchAuditIntegrityProjection | null
  readonly loadingMore: boolean
  readonly issue: WorkbenchActivityTransportIssue | null
}

/** Narrow structural face accepted by the pure Activity panel. */
export interface WorkbenchActivityControllerFace {
  readonly getSnapshot: () => WorkbenchActivityClientState
  readonly subscribe: (listener: () => void) => () => void
  refresh(): Promise<void>
  setFilter(filter: WorkbenchActivityFilter): Promise<void>
  loadMore(): Promise<void>
}

/** Fail-closed admission and auth-revalidation hooks owned by the Owner shell. */
export interface WorkbenchActivityControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
}

const EMPTY_FILTER: WorkbenchActivityFilter = Object.freeze({})

export const INITIAL_WORKBENCH_ACTIVITY_STATE: WorkbenchActivityClientState = Object.freeze({
  phase: 'loading',
  filter: EMPTY_FILTER,
  activity: null,
  integrity: null,
  loadingMore: false,
  issue: null,
})

type SettledRemote<T> =
  | { readonly kind: 'result'; readonly result: RemoteResult<T> }
  | { readonly kind: 'thrown' }

/**
 * Owns one coherent Activity page whose filtered rows and whole-ledger
 * integrity arrive from one Host read snapshot and publish as one epoch.
 */
export class WorkbenchActivityController implements WorkbenchActivityControllerFace {
  private state: WorkbenchActivityClientState = INITIAL_WORKBENCH_ACTIVITY_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private refreshEpoch = 0
  private refreshAbort: AbortController | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchActivityRemote,
    private readonly options: WorkbenchActivityControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchActivityClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Refresh the current filter as one Activity/integrity generation. */
  refresh(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doRefresh(this.state.filter))
  }

  /** Replace the current filter and supersede every older physical request. */
  setFilter(filter: WorkbenchActivityFilter): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doRefresh(detachFilter(filter)))
  }

  /** Append the next cursor page while retaining the already accepted rows. */
  loadMore(): Promise<void> {
    if (!this.admitProtectedOperation()
      || this.state.loadingMore
      || this.state.activity?.nextBeforeSequence === null
      || this.state.activity === null) return Promise.resolve()
    return this.track(this.doLoadMore())
  }

  /** Keep the last accepted page but prevent a disconnected generation from publishing. */
  markDisconnected(): void {
    if (this.disposed) return
    ++this.refreshEpoch
    this.refreshAbort?.abort(new Error('Workbench Activity connection generation changed'))
    this.refreshAbort = null
    this.publish({
      ...this.state,
      phase: 'stale',
      loadingMore: false,
      issue: null,
    })
  }

  /** Abort owned work, fence late results, erase projections, and await quiescence. */
  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    ++this.refreshEpoch
    this.refreshAbort?.abort(new Error('Workbench Activity Client disposed'))
    this.refreshAbort = null
    this.state = INITIAL_WORKBENCH_ACTIVITY_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRefresh(filter: WorkbenchActivityFilter): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.refreshEpoch
    this.refreshAbort?.abort(new Error('Workbench Activity refresh was superseded'))
    const abort = new AbortController()
    this.refreshAbort = abort
    const changedFilter = !sameFilter(filter, this.state.filter)
    const retainedActivity = changedFilter ? null : this.state.activity
    const retainedIntegrity = changedFilter ? null : this.state.integrity
    this.publish({
      ...this.state,
      phase: retainedActivity === null ? 'loading' : 'stale',
      filter,
      activity: retainedActivity,
      integrity: retainedIntegrity,
      loadingMore: false,
      issue: null,
    })

    const activityOutcome = await settleRemote(
      Promise.resolve().then(() => this.remote.activity(filter, abort.signal)),
    )

    if (!this.acceptRefresh(epoch, abort)) return
    this.refreshAbort = null
    if (activityOutcome.kind === 'result' && activityOutcome.result.ok) {
      const activity = detachActivity(activityOutcome.result.value)
      this.publish(Object.freeze({
        phase: 'ready',
        filter,
        activity,
        integrity: activity.integrity,
        loadingMore: false,
        issue: null,
      }))
      return
    }

    const code = failureCode(activityOutcome)
    this.publish(Object.freeze({
      ...this.state,
      phase: 'error',
      loadingMore: false,
      issue: Object.freeze({ kind: code === 'bad-request' ? 'input' : 'transport', code }),
    }))
    if (code !== 'bad-request') this.notifyTransportFailure()
  }

  private async doLoadMore(): Promise<void> {
    const current = this.state.activity
    if (current === null || current.nextBeforeSequence === null) return
    const epoch = ++this.refreshEpoch
    this.refreshAbort?.abort(new Error('Workbench Activity page was superseded'))
    const abort = new AbortController()
    this.refreshAbort = abort
    this.publish({ ...this.state, loadingMore: true, issue: null })
    const outcome = await settleRemote(Promise.resolve().then(() => this.remote.activity({
      ...this.state.filter,
      beforeSequence: current.nextBeforeSequence as number,
    }, abort.signal)))
    if (!this.acceptRefresh(epoch, abort)) return
    this.refreshAbort = null
    if (outcome.kind === 'result' && outcome.result.ok) {
      const page = detachActivity(outcome.result.value)
      const seen = new Set(current.items.map(item => item.eventId))
      const appended = page.items.filter(item => !seen.has(item.eventId))
      const activity = Object.freeze({
        items: Object.freeze([...current.items, ...appended]),
        nextBeforeSequence: page.nextBeforeSequence,
        integrity: page.integrity,
      })
      this.publish(Object.freeze({
        phase: 'ready',
        filter: this.state.filter,
        activity,
        integrity: activity.integrity,
        loadingMore: false,
        issue: null,
      }))
      return
    }
    const code = failureCode(outcome)
    this.publish(Object.freeze({
      ...this.state,
      phase: 'error',
      loadingMore: false,
      issue: Object.freeze({ kind: code === 'bad-request' ? 'input' : 'transport', code }),
    }))
    if (code !== 'bad-request') this.notifyTransportFailure()
  }

  private acceptRefresh(epoch: number, abort: AbortController): boolean {
    return !this.disposed
      && epoch === this.refreshEpoch
      && this.refreshAbort === abort
      && !abort.signal.aborted
  }

  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(
      () => { this.inFlight.delete(pending) },
      () => { this.inFlight.delete(pending) },
    )
    return pending
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      // The observer is best effort and its thrown value may contain secrets.
      console.error('[workbench-client] Activity transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Activity admission observer failed')
      return false
    }
  }

  private publish(next: WorkbenchActivityClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Activity state observer failed')
      }
    }
  }
}

async function settleRemote<T>(pending: Promise<RemoteResult<T>>): Promise<SettledRemote<T>> {
  try {
    return { kind: 'result', result: await pending }
  } catch {
    return { kind: 'thrown' }
  }
}

function failureCode(outcome: SettledRemote<WorkbenchActivityProjection>): string {
  if (outcome.kind === 'result' && !outcome.result.ok) {
    const code = outcome.result.error.code
    if (/^[a-z][a-z0-9-]{0,63}$/u.test(code)) return code
  }
  return 'transport-failure'
}

function detachFilter(value: WorkbenchActivityFilter): WorkbenchActivityFilter {
  return Object.freeze({
    ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
    ...(value.objectType === undefined ? {} : { objectType: value.objectType }),
    ...(value.objectId === undefined ? {} : { objectId: value.objectId }),
    ...(value.action === undefined ? {} : { action: value.action }),
    ...(value.beforeSequence === undefined ? {} : { beforeSequence: value.beforeSequence }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
  })
}

function detachActivity(value: WorkbenchActivityProjection): WorkbenchActivityProjection {
  return Object.freeze({
    items: Object.freeze(value.items.map(detachItem)),
    nextBeforeSequence: value.nextBeforeSequence,
    integrity: detachIntegrity(value.integrity),
  })
}

function sameFilter(left: WorkbenchActivityFilter, right: WorkbenchActivityFilter): boolean {
  return left.projectId === right.projectId
    && left.objectType === right.objectType
    && left.objectId === right.objectId
    && left.action === right.action
    && left.beforeSequence === right.beforeSequence
    && left.limit === right.limit
}

function detachItem(value: WorkbenchActivityItem): WorkbenchActivityItem {
  return Object.freeze({
    sequence: value.sequence,
    eventId: value.eventId,
    occurredAt: value.occurredAt,
    actor: Object.freeze({ kind: value.actor.kind, id: value.actor.id }),
    projectId: value.projectId,
    action: value.action,
    reason: value.reason,
    object: Object.freeze({
      type: value.object.type,
      id: value.object.id,
      version: value.object.version,
    }),
    causationId: value.causationId,
    commandId: value.commandId,
    summaryCode: value.summaryCode,
    hash: value.hash,
    previousHash: value.previousHash,
    outbox: Object.freeze({
      id: value.outbox.id,
      state: value.outbox.state,
      attemptCount: value.outbox.attemptCount,
      updatedAt: value.outbox.updatedAt,
      errorCode: value.outbox.errorCode,
    }),
  })
}

function detachIntegrity(
  value: WorkbenchAuditIntegrityProjection,
): WorkbenchAuditIntegrityProjection {
  return Object.freeze({
    valid: value.valid,
    eventCount: value.eventCount,
    headHash: value.headHash,
    issue: value.issue,
  })
}
