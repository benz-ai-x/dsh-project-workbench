/** React-free Client state machine for the Workbench status projection. */

import type {
  SetStatusRequest,
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The seven user-visible projection states. */
export type WorkbenchPhase =
  | 'loading'
  | 'empty'
  | 'value'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

/** A transport failure, reduced to safe display fields. */
export interface WorkbenchTransportIssue {
  readonly kind: 'transport'
  readonly code: string
  readonly message: string
}

/** A typed compare-and-set rejection from the Host domain. */
export interface WorkbenchConflictIssue {
  readonly kind: 'conflict'
  readonly code: 'revision-conflict'
  readonly message: string
}

/** A Host validation rejection that the user can fix without reconnecting. */
export interface WorkbenchInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request'
}

/** Display-safe issue kept in controller state. */
export type WorkbenchIssue = WorkbenchTransportIssue | WorkbenchConflictIssue | WorkbenchInputIssue

/** Immutable state consumed by the React page through useSyncExternalStore. */
export interface WorkbenchClientState {
  readonly phase: WorkbenchPhase
  readonly snapshot: WorkbenchStatusSnapshot | null
  readonly draft: string
  readonly draftDirty: boolean
  readonly pending: boolean
  readonly issue: WorkbenchIssue | null
}

/** Narrow generated Remote face used by this controller. */
export interface WorkbenchRemote {
  snapshot(signal?: AbortSignal): Promise<RemoteResult<WorkbenchStatusSnapshot | null>>
  setStatus(
    request: SetStatusRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SetStatusResult>>
}

/** Optional lifecycle hooks owned by the authenticated Owner shell. */
export interface WorkbenchStatusControllerOptions {
  /** Fail-closed admission check run before every protected local/Remote operation. */
  readonly onBeforeProtectedOperation?: () => boolean
  /** Revalidate the Owner session after a protected carrier failure. */
  readonly onTransportFailure?: () => void
}

const INITIAL_STATE: WorkbenchClientState = Object.freeze({
  phase: 'loading',
  snapshot: null,
  draft: '',
  draftDirty: false,
  pending: false,
  issue: null,
})

/** Detach a transport value before publishing it to observers. */
function detachSnapshot(value: WorkbenchStatusSnapshot | null): WorkbenchStatusSnapshot | null {
  return value === null ? null : Object.freeze({ ...value })
}

function transportIssue(error: unknown): WorkbenchTransportIssue {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown }
    return Object.freeze({
      kind: 'transport',
      code: typeof candidate.code === 'string' ? candidate.code : 'transport-failure',
      message: typeof candidate.message === 'string' ? candidate.message : 'Workbench transport failed',
    })
  }
  return Object.freeze({
    kind: 'transport',
    code: 'transport-failure',
    message: typeof error === 'string' ? error : 'Workbench transport failed',
  })
}

/**
 * Observable, lifecycle-owned status controller.
 *
 * It keeps Host truth as a whole snapshot, fences every async completion, and
 * owns the only transient draft and duplicate-submit lock. No React or Cordis
 * value enters this module.
 */
export class WorkbenchStatusController {
  private state: WorkbenchClientState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private refreshEpoch = 0
  private mutationEpoch = 0
  private refreshAbort: AbortController | null = null
  private mutationAbort: AbortController | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchRemote,
    private readonly options: WorkbenchStatusControllerOptions = {},
  ) {}

  /** Stable useSyncExternalStore getter. */
  readonly getSnapshot = (): WorkbenchClientState => this.state

  /** Stable useSyncExternalStore subscription. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace the local editor draft without changing authoritative state. */
  setDraft(value: string): void {
    if (!this.admitProtectedOperation() || value === this.state.draft) return
    this.publish({ ...this.state, draft: value, draftDirty: true })
  }

  /** Restore the editor from the latest authoritative snapshot. */
  resetDraft(): void {
    if (!this.admitProtectedOperation()) return
    const draft = this.state.snapshot?.message ?? ''
    const clearsConflict = this.state.phase === 'conflict'
    if (draft === this.state.draft && !this.state.draftDirty && !clearsConflict) return
    this.publish({
      ...this.state,
      phase: clearsConflict ? this.state.snapshot === null ? 'empty' : 'value' : this.state.phase,
      draft,
      draftDirty: false,
      issue: clearsConflict ? null : this.state.issue,
    })
  }

  /**
   * Pull a whole Host snapshot. A late response from an older connection or a
   * disposed controller is ignored.
   */
  refresh(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doRefresh())
  }

  private async doRefresh(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.refreshEpoch
    this.refreshAbort?.abort(new Error('Workbench snapshot was superseded'))
    const abort = new AbortController()
    this.refreshAbort = abort
    if (this.state.phase === 'error') {
      this.publish({
        ...this.state,
        phase: this.state.snapshot === null ? 'loading' : 'stale',
        issue: null,
      })
    } else if (this.state.snapshot === null && this.state.phase !== 'stale') {
      this.publish({ ...this.state, phase: 'loading', issue: null })
    }
    try {
      const result = await this.remote.snapshot(abort.signal)
      if (!this.acceptRefresh(epoch, abort)) return
      if (!result.ok) {
        this.publish({
          ...this.state,
          phase: 'error',
          issue: transportIssue(result.error),
        })
        this.notifyTransportFailure()
        return
      }
      this.adoptSnapshot(detachSnapshot(result.value))
    } catch (error) {
      if (!this.acceptRefresh(epoch, abort)) return
      this.publish({
        ...this.state,
        phase: 'error',
        issue: transportIssue(error),
      })
      this.notifyTransportFailure()
    } finally {
      if (this.refreshAbort === abort) this.refreshAbort = null
    }
  }

  /** Mark the last value stale as soon as the physical carrier disappears. */
  markDisconnected(): void {
    if (this.disposed) return
    ++this.refreshEpoch
    this.cancelRefresh()
    this.cancelMutation()
    this.publish({
      ...this.state,
      phase: 'stale',
      pending: false,
      issue: null,
    })
  }

  /** Preserve the last value across a connection generation and repull it. */
  async connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation()) return
    ++this.refreshEpoch
    this.cancelRefresh()
    this.cancelMutation()
    this.publish({
      ...this.state,
      phase: 'stale',
      pending: false,
      issue: null,
    })
    await this.refresh()
  }

  /**
   * Submit the trimmed draft once. Outer Remote failures and inner revision
   * conflicts remain distinct; both preserve the recoverable draft.
   */
  save(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    return this.track(this.doSave())
  }

  private async doSave(): Promise<void> {
    if (this.disposed || this.state.pending) return
    const message = this.state.draft.trim()
    if (message === '') return

    const epoch = ++this.mutationEpoch
    const abort = new AbortController()
    this.mutationAbort = abort
    const request: SetStatusRequest = Object.freeze({
      message,
      expectedRevision: this.state.snapshot?.revision ?? null,
    })
    this.publish({ ...this.state, phase: 'pending', pending: true, issue: null })

    try {
      const result = await this.remote.setStatus(request, abort.signal)
      if (!this.acceptMutation(epoch, abort)) return
      this.mutationAbort = null
      if (!result.ok) {
        if (result.error.code === 'bad-request') {
          this.publish({
            ...this.state,
            phase: 'error',
            pending: false,
            issue: Object.freeze({ kind: 'input', code: 'bad-request' }),
          })
          return
        }
        this.publish({
          ...this.state,
          phase: 'error',
          pending: false,
          issue: transportIssue(result.error),
        })
        this.notifyTransportFailure()
        return
      }
      this.adoptMutation(result.value)
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

  /** Abort owned work, reject late completion, and wait for transport quiescence. */
  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    ++this.refreshEpoch
    ++this.mutationEpoch
    this.refreshAbort?.abort(new Error('Workbench Client disposed'))
    this.refreshAbort = null
    this.mutationAbort?.abort(new Error('Workbench Client disposed'))
    this.mutationAbort = null
    this.state = INITIAL_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private acceptRefresh(epoch: number, abort: AbortController): boolean {
    return !this.disposed
      && epoch === this.refreshEpoch
      && this.refreshAbort === abort
      && !abort.signal.aborted
  }

  private acceptMutation(epoch: number, abort: AbortController): boolean {
    return !this.disposed
      && epoch === this.mutationEpoch
      && this.mutationAbort === abort
      && !abort.signal.aborted
  }

  private cancelMutation(): void {
    ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench connection generation changed'))
    this.mutationAbort = null
  }

  private cancelRefresh(): void {
    this.refreshAbort?.abort(new Error('Workbench connection generation changed'))
    this.refreshAbort = null
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
    } catch (error) {
      console.error('[workbench-client] transport-failure observer failed:', error)
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch (error) {
      console.error('[workbench-client] protected-operation admission failed:', error)
      return false
    }
  }

  private adoptSnapshot(snapshot: WorkbenchStatusSnapshot | null): void {
    const entityChanged = this.state.snapshot !== null
      && snapshot !== null
      && this.state.snapshot.id !== snapshot.id
    const keepDraft = this.state.draftDirty && !entityChanged
    this.publish({
      phase: snapshot === null ? 'empty' : 'value',
      snapshot,
      draft: keepDraft ? this.state.draft : snapshot?.message ?? '',
      draftDirty: keepDraft,
      pending: this.state.pending,
      issue: null,
    })
  }

  private adoptMutation(result: SetStatusResult): void {
    if (!result.ok) {
      this.publish({
        ...this.state,
        phase: 'conflict',
        snapshot: detachSnapshot(result.error.current),
        draftDirty: true,
        pending: false,
        issue: Object.freeze({
          kind: 'conflict',
          code: result.error.code,
          message: result.error.message,
        }),
      })
      return
    }
    const snapshot = detachSnapshot(result.value)
    this.publish({
      phase: 'value',
      snapshot,
      draft: snapshot?.message ?? '',
      draftDirty: false,
      pending: false,
      issue: null,
    })
  }

  private publish(next: WorkbenchClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[workbench-client] state observer failed:', error)
      }
    }
  }
}
