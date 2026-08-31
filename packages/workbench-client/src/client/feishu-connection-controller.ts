/** React-free Client state machine for the Feishu Bot/User Connection Center. */

import type {
  ConfigureFeishuIdentityRouteRequest,
  ConfigureFeishuIdentityRouteResult,
  FeishuConnectionCenterProjection,
  FeishuConnectionIssue,
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  FeishuResourceProbeProjection,
  FeishuVerificationProjection,
  VerifyFeishuIdentityRouteRequest,
  VerifyFeishuIdentityRouteResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchFeishuConnectionPhase =
  | 'loading'
  | 'ready'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

export type WorkbenchFeishuConnectionOperation =
  | 'read-connection'
  | 'configure'
  | 'reset'
  | 'disable'
  | 'verify'

export type WorkbenchFeishuConnectionTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

type FeishuDomainFailure =
  | Extract<ConfigureFeishuIdentityRouteResult, { readonly ok: false }>
  | Extract<VerifyFeishuIdentityRouteResult, { readonly ok: false }>

export type WorkbenchFeishuConnectionConflictCode = FeishuDomainFailure['error']['code']

export interface WorkbenchFeishuConnectionTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchFeishuConnectionTransportCode
  readonly operation: WorkbenchFeishuConnectionOperation
  readonly routeKind: FeishuIdentityKind | null
}

export interface WorkbenchFeishuConnectionInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request'
  readonly operation: WorkbenchFeishuConnectionOperation
  readonly routeKind: FeishuIdentityKind | null
}

export interface WorkbenchFeishuConnectionConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchFeishuConnectionConflictCode
  readonly operation: Exclude<WorkbenchFeishuConnectionOperation, 'read-connection'>
  readonly routeKind: FeishuIdentityKind
}

export type WorkbenchFeishuConnectionClientIssue =
  | WorkbenchFeishuConnectionTransportIssue
  | WorkbenchFeishuConnectionInputIssue
  | WorkbenchFeishuConnectionConflictIssue

export type WorkbenchFeishuConnectionClientIssueCode =
  WorkbenchFeishuConnectionClientIssue['code']

/** One route's recoverable local configuration and optional read-only probe. */
export interface WorkbenchFeishuIdentityDraft {
  readonly appId: string
  readonly credentialRef: string
  readonly taskListResourceId: string
  readonly configDirty: boolean
  readonly probeDirty: boolean
  readonly basedOnConnectionRevision: number | null
  readonly basedOnRouteGeneration: number | null
}

export interface WorkbenchFeishuConnectionClientState {
  readonly phase: WorkbenchFeishuConnectionPhase
  readonly center: FeishuConnectionCenterProjection | null
  readonly drafts: Readonly<Record<FeishuIdentityKind, WorkbenchFeishuIdentityDraft>>
  readonly pendingOperation: Exclude<WorkbenchFeishuConnectionOperation, 'read-connection'> | null
  readonly pendingKind: FeishuIdentityKind | null
  readonly issue: WorkbenchFeishuConnectionClientIssue | null
  readonly canRetryMutation: boolean
  readonly focusKind: FeishuIdentityKind | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` T07 subset consumed by this controller. */
export interface WorkbenchFeishuConnectionRemote {
  feishuConnectionCenter(
    signal?: AbortSignal,
  ): Promise<RemoteResult<FeishuConnectionCenterProjection>>
  configureFeishuIdentityRoute(
    request: ConfigureFeishuIdentityRouteRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ConfigureFeishuIdentityRouteResult>>
  verifyFeishuIdentityRoute(
    request: VerifyFeishuIdentityRouteRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<VerifyFeishuIdentityRouteResult>>
}

export interface WorkbenchFeishuConnectionControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
}

type ConfigureOperation = 'configure' | 'reset' | 'disable'

type MutationEnvelope =
  | Readonly<{
    operation: ConfigureOperation
    routeKind: FeishuIdentityKind
    fingerprint: string
    request: ConfigureFeishuIdentityRouteRequest
  }>
  | Readonly<{
    operation: 'verify'
    routeKind: FeishuIdentityKind
    fingerprint: string
    request: VerifyFeishuIdentityRouteRequest
  }>

const SAFE_TRANSPORT_CODES = new Set<WorkbenchFeishuConnectionTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])

const RETRYABLE_TRANSPORT_CODES = new Set<WorkbenchFeishuConnectionTransportCode>([
  'unavailable',
  'rate-limited',
  'internal',
  'transport-failure',
])

export const MAX_FEISHU_APP_ID_LENGTH = 128
export const MAX_FEISHU_CREDENTIAL_REF_LENGTH = 128
export const MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH = 256

const FEISHU_APP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const FEISHU_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u

function emptyDraft(): WorkbenchFeishuIdentityDraft {
  return Object.freeze({
    appId: '',
    credentialRef: '',
    taskListResourceId: '',
    configDirty: false,
    probeDirty: false,
    basedOnConnectionRevision: null,
    basedOnRouteGeneration: null,
  })
}

function emptyDrafts(): WorkbenchFeishuConnectionClientState['drafts'] {
  return Object.freeze({ bot: emptyDraft(), user: emptyDraft() })
}

export const INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE: WorkbenchFeishuConnectionClientState
  = Object.freeze({
    phase: 'loading',
    center: null,
    drafts: emptyDrafts(),
    pendingOperation: null,
    pendingKind: null,
    issue: null,
    canRetryMutation: false,
    focusKind: null,
    focusEpoch: 0,
  })

/**
 * Owns the authorized whole connection projection, route-scoped drafts, and
 * one exact response-loss retry envelope. It never selects or retries another
 * actor route after a Bot/User failure.
 */
export class WorkbenchFeishuConnectionController {
  private state: WorkbenchFeishuConnectionClientState
    = INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE
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
    private readonly remote: WorkbenchFeishuConnectionRemote,
    private readonly options: WorkbenchFeishuConnectionControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchFeishuConnectionClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  refresh(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) {
      return Promise.resolve()
    }
    return this.track(this.doRefresh(false))
  }

  setAppId(kind: FeishuIdentityKind, appId: string): void {
    this.updateDraft(kind, { appId }, 'config')
  }

  setCredentialRef(kind: FeishuIdentityKind, credentialRef: string): void {
    this.updateDraft(kind, { credentialRef }, 'config')
  }

  setTaskListResourceId(kind: FeishuIdentityKind, taskListResourceId: string): void {
    this.updateDraft(kind, { taskListResourceId }, 'probe')
  }

  resetDraft(kind: FeishuIdentityKind): void {
    if (!this.canEditLocalState()) return
    this.clearRetryFor(kind)
    const center = this.state.center
    const drafts = replaceDraft(this.state.drafts, kind, center === null
      ? emptyDraft()
      : draftFromRoute(center[kind], center.revision))
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? center === null ? 'loading' : 'ready' : this.state.phase,
      drafts,
      issue: this.state.issue?.routeKind === kind ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  /** Explicitly move a dirty form's CAS fence to the latest visible route. */
  adoptLatestBase(kind: FeishuIdentityKind): void {
    if (!this.canEditLocalState() || this.state.center === null) return
    const route = this.state.center[kind]
    const current = this.state.drafts[kind]
    const routeChanged = current.basedOnRouteGeneration !== route.generation
    this.clearRetryFor(kind)
    const drafts = replaceDraft(this.state.drafts, kind, freezeDraft({
      ...current,
      taskListResourceId: routeChanged ? '' : current.taskListResourceId,
      probeDirty: routeChanged ? false : current.probeDirty,
      basedOnConnectionRevision: this.state.center.revision,
      basedOnRouteGeneration: route.generation,
    }))
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      drafts,
      issue: this.state.issue?.routeKind === kind ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  isDraftStale(kind: FeishuIdentityKind): boolean {
    const center = this.state.center
    const draft = this.state.drafts[kind]
    if (center === null || !draft.configDirty) return false
    return draft.basedOnConnectionRevision !== center.revision
      || draft.basedOnRouteGeneration !== center[kind].generation
  }

  canConfigure(kind: FeishuIdentityKind): boolean {
    const center = this.state.center
    const draft = this.state.drafts[kind]
    if (!this.canMutate() || center === null) return false
    const route = center[kind]
    if ((!draft.configDirty && route.state !== 'disabled')
      || this.isDraftStale(kind)) return false
    const normalized = normalizeConfigurationDraft(draft)
    if (normalized === null) return false
    return route.state === 'disabled'
      || normalized.appId !== route.appId
      || normalized.credentialRef !== route.credential.ref
  }

  configure(kind: FeishuIdentityKind): Promise<void> {
    if (!this.admitProtectedOperation() || !this.canConfigure(kind)
      || this.state.center === null) return Promise.resolve()
    const normalized = normalizeConfigurationDraft(this.state.drafts[kind])
    if (normalized === null) return Promise.resolve()
    const route = this.state.center[kind]
    const fingerprint = JSON.stringify({
      operation: 'configure',
      kind,
      appId: normalized.appId,
      credentialRef: normalized.credentialRef,
      expectedConnectionRevision: this.state.center.revision,
      expectedRouteGeneration: route.generation,
    })
    const retained = this.retryEnvelope?.operation === 'configure'
      && this.retryEnvelope.routeKind === kind
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope = retained ?? Object.freeze({
      operation: 'configure' as const,
      routeKind: kind,
      fingerprint,
      request: Object.freeze({
        mode: 'set' as const,
        kind,
        appId: normalized.appId,
        credentialRef: normalized.credentialRef,
        expectedConnectionRevision: this.state.center.revision,
        expectedRouteGeneration: route.generation,
        ...this.correlation(),
        reason: 'owner-feishu-route-configure' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  canReset(kind: FeishuIdentityKind): boolean {
    return this.canMutate() && this.state.center?.[kind].state === 'configured'
  }

  resetIdentity(kind: FeishuIdentityKind): Promise<void> {
    return this.configureRouteState(kind, 'reset')
  }

  canDisable(kind: FeishuIdentityKind): boolean {
    return this.canMutate() && this.state.center?.[kind].state === 'configured'
  }

  disable(kind: FeishuIdentityKind): Promise<void> {
    return this.configureRouteState(kind, 'disable')
  }

  canVerify(kind: FeishuIdentityKind): boolean {
    if (!this.canMutate() || this.state.center?.[kind].state !== 'configured') return false
    const resourceId = this.state.drafts[kind].taskListResourceId.trim()
    return resourceId === '' || validTaskListResourceId(resourceId)
  }

  verify(kind: FeishuIdentityKind): Promise<void> {
    if (!this.admitProtectedOperation() || !this.canVerify(kind)
      || this.state.center === null) return Promise.resolve()
    const route = this.state.center[kind]
    if (route.generation === null) return Promise.resolve()
    const resourceId = this.state.drafts[kind].taskListResourceId.trim()
    const fingerprint = JSON.stringify({
      operation: 'verify',
      kind,
      resourceId,
      expectedConnectionRevision: this.state.center.revision,
      expectedRouteGeneration: route.generation,
    })
    const retained = this.retryEnvelope?.operation === 'verify'
      && this.retryEnvelope.routeKind === kind
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope = retained ?? Object.freeze({
      operation: 'verify' as const,
      routeKind: kind,
      fingerprint,
      request: Object.freeze({
        kind,
        expectedConnectionRevision: this.state.center.revision,
        expectedRouteGeneration: route.generation,
        ...(resourceId === '' ? {} : {
          resourceProbe: Object.freeze({
            kind: 'task-list' as const,
            resourceId,
          }),
        }),
        ...this.correlation(),
        reason: 'owner-feishu-route-verify' as const,
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
    this.cancelAll('Workbench Feishu Connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      pendingOperation: null,
      pendingKind: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    this.cancelAll('Workbench Feishu Connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      pendingOperation: null,
      pendingKind: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
    return this.track(this.doRefresh(false))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Feishu Connection Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private configureRouteState(
    kind: FeishuIdentityKind,
    operation: 'reset' | 'disable',
  ): Promise<void> {
    if (!this.admitProtectedOperation()
      || (operation === 'reset' ? !this.canReset(kind) : !this.canDisable(kind))
      || this.state.center === null) return Promise.resolve()
    const route = this.state.center[kind]
    const connectionRevision = this.state.center.revision
    const fingerprint = JSON.stringify({
      operation,
      kind,
      expectedConnectionRevision: connectionRevision,
      expectedRouteGeneration: route.generation,
    })
    const retained = this.retryEnvelope?.operation === operation
      && this.retryEnvelope.routeKind === kind
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope = retained ?? (() => {
      const correlation = this.correlation()
      const request: ConfigureFeishuIdentityRouteRequest = operation === 'reset'
        ? Object.freeze({
          mode: 'reset',
          kind,
          expectedConnectionRevision: connectionRevision,
          expectedRouteGeneration: route.generation,
          ...correlation,
          reason: 'owner-feishu-route-reset',
        })
        : Object.freeze({
          mode: 'disable',
          kind,
          expectedConnectionRevision: connectionRevision,
          expectedRouteGeneration: route.generation,
          ...correlation,
          reason: 'owner-feishu-route-disable',
        })
      return Object.freeze({ operation, routeKind: kind, fingerprint, request })
    })()
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  private async doRefresh(keepIssue: boolean): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Feishu Connection refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    const retainedIssue = keepIssue ? this.state.issue : null
    this.publish({
      ...this.state,
      phase: this.state.center === null ? 'loading' : keepIssue ? 'conflict' : 'stale',
      issue: retainedIssue,
    })
    try {
      const result = await this.remote.feishuConnectionCenter(abort.signal)
      if (!this.acceptRead(epoch, abort)) return
      this.readAbort = null
      if (!result.ok) {
        this.publishReadFailure(result.error)
        return
      }
      const center = detachCenter(result.value)
      this.publish({
        ...this.state,
        phase: keepIssue && retainedIssue?.kind === 'conflict' ? 'conflict' : 'ready',
        center,
        drafts: mergeDrafts(this.state.drafts, center),
        pendingOperation: null,
        pendingKind: null,
        issue: keepIssue ? retainedIssue : null,
        canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort)) return
      this.readAbort = null
      this.publishReadFailure(error)
    }
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    if (this.disposed || this.state.pendingOperation !== null) return
    ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Feishu mutation superseded refresh'))
    this.readAbort = null
    const epoch = ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench Feishu mutation was superseded'))
    const abort = new AbortController()
    this.mutationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.operation,
      pendingKind: envelope.routeKind,
      issue: null,
      canRetryMutation: false,
      focusKind: null,
    })
    let result: RemoteResult<ConfigureFeishuIdentityRouteResult | VerifyFeishuIdentityRouteResult>
    try {
      result = await this.invokeMutation(envelope, abort.signal)
    } catch (error) {
      if (!this.acceptMutation(epoch, abort)) return
      this.mutationAbort = null
      this.publishMutationTransportFailure(envelope, error)
      return
    }
    if (!this.acceptMutation(epoch, abort)) return
    this.mutationAbort = null
    if (!result.ok) {
      this.publishMutationTransportFailure(envelope, result.error)
      return
    }
    const outcome = result.value
    if (!outcome.ok) {
      this.retryEnvelope = null
      this.publish({
        ...this.state,
        phase: 'conflict',
        pendingOperation: null,
        pendingKind: null,
        issue: Object.freeze({
          kind: 'conflict',
          code: outcome.error.code,
          operation: envelope.operation,
          routeKind: envelope.routeKind,
        }),
        canRetryMutation: false,
      })
      await this.doRefresh(true)
      return
    }

    this.retryEnvelope = null
    const drafts = envelope.operation === 'verify'
      ? replaceDraft(this.state.drafts, envelope.routeKind, freezeDraft({
        ...this.state.drafts[envelope.routeKind],
        probeDirty: false,
      }))
      : replaceDraft(this.state.drafts, envelope.routeKind, emptyDraft())
    this.publish({
      ...this.state,
      phase: 'stale',
      drafts,
      pendingOperation: null,
      pendingKind: null,
      issue: null,
      canRetryMutation: false,
      focusKind: envelope.routeKind,
    })
    this.notifyCommitted(outcome.receipt)
    await this.doRefresh(false)
    if (this.state.center !== null) {
      this.publish({
        ...this.state,
        focusKind: envelope.routeKind,
        focusEpoch: this.state.focusEpoch + 1,
      })
    }
  }

  private async invokeMutation(
    envelope: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<RemoteResult<ConfigureFeishuIdentityRouteResult | VerifyFeishuIdentityRouteResult>> {
    if (envelope.operation === 'verify') {
      return await this.remote.verifyFeishuIdentityRoute(envelope.request, signal)
    }
    return await this.remote.configureFeishuIdentityRoute(envelope.request, signal)
  }

  private updateDraft(
    kind: FeishuIdentityKind,
    patch: Partial<Pick<WorkbenchFeishuIdentityDraft, 'appId' | 'credentialRef' | 'taskListResourceId'>>,
    axis: 'config' | 'probe',
  ): void {
    if (!this.canEditLocalState()) return
    const current = this.state.drafts[kind]
    const next = freezeDraft({
      ...current,
      ...patch,
      configDirty: axis === 'config' ? true : current.configDirty,
      probeDirty: axis === 'probe' ? true : current.probeDirty,
    })
    if (sameDraft(current, next)) return
    this.clearRetryFor(kind)
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? this.state.center === null ? 'loading' : 'ready' : this.state.phase,
      drafts: replaceDraft(this.state.drafts, kind, next),
      issue: this.state.issue?.routeKind === kind ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private publishReadFailure(error: unknown): void {
    const issue = classifyRemoteFailure(error, 'read-connection', null)
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingKind: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private publishMutationTransportFailure(envelope: MutationEnvelope, error: unknown): void {
    const issue = classifyRemoteFailure(error, envelope.operation, envelope.routeKind)
    const retryable = issue.kind === 'transport' && RETRYABLE_TRANSPORT_CODES.has(issue.code)
    if (!retryable) this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingKind: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private canMutate(): boolean {
    return !this.disposed
      && this.state.center !== null
      && this.state.pendingOperation === null
      && this.state.phase !== 'loading'
      && this.state.phase !== 'stale'
      && this.state.phase !== 'conflict'
  }

  private canEditLocalState(): boolean {
    return this.admitProtectedOperation() && this.state.pendingOperation === null
  }

  private acceptRead(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.readEpoch
      && this.readAbort === abort && !abort.signal.aborted
  }

  private acceptMutation(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.mutationEpoch
      && this.mutationAbort === abort && !abort.signal.aborted
  }

  private clearRetryFor(kind: FeishuIdentityKind): void {
    if (this.retryEnvelope?.routeKind === kind) this.retryEnvelope = null
  }

  private cancelAll(reason: string): void {
    ++this.readEpoch
    ++this.mutationEpoch
    this.readAbort?.abort(new Error(reason))
    this.mutationAbort?.abort(new Error(reason))
    this.readAbort = null
    this.mutationAbort = null
  }

  private notifyCommitted(receipt: WorkbenchCommandReceipt): void {
    try {
      this.options.onCommitted?.(Object.freeze({ ...receipt }))
    } catch {
      console.error('[workbench-client] Feishu Connection committed observer failed')
    }
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Feishu Connection transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Feishu Connection admission observer failed')
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

  private publish(next: WorkbenchFeishuConnectionClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Feishu Connection state observer failed')
      }
    }
  }
}

export function validFeishuAppId(value: string): boolean {
  return FEISHU_APP_ID.test(value.trim())
}

export function validCredentialRef(value: string): boolean {
  return CREDENTIAL_REF.test(value.trim())
}

export function validTaskListResourceId(value: string): boolean {
  return FEISHU_RESOURCE_ID.test(value.trim())
}

function normalizeConfigurationDraft(
  draft: WorkbenchFeishuIdentityDraft,
): { readonly appId: string; readonly credentialRef: string } | null {
  const appId = draft.appId.trim()
  const credentialRef = draft.credentialRef.trim()
  return validFeishuAppId(appId) && validCredentialRef(credentialRef)
    ? Object.freeze({ appId, credentialRef })
    : null
}

function classifyRemoteFailure(
  error: unknown,
  operation: WorkbenchFeishuConnectionOperation,
  routeKind: FeishuIdentityKind | null,
): WorkbenchFeishuConnectionInputIssue | WorkbenchFeishuConnectionTransportIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request') {
    return Object.freeze({ kind: 'input', code: 'bad-request', operation, routeKind })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchFeishuConnectionTransportCode)
    ? candidate as WorkbenchFeishuConnectionTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation, routeKind })
}

function mergeDrafts(
  current: WorkbenchFeishuConnectionClientState['drafts'],
  center: FeishuConnectionCenterProjection,
): WorkbenchFeishuConnectionClientState['drafts'] {
  return Object.freeze({
    bot: mergeDraft(current.bot, center.bot, center.revision),
    user: mergeDraft(current.user, center.user, center.revision),
  })
}

function mergeDraft(
  current: WorkbenchFeishuIdentityDraft,
  route: FeishuIdentityRouteProjection,
  connectionRevision: number,
): WorkbenchFeishuIdentityDraft {
  const routeChanged = current.basedOnRouteGeneration !== route.generation
  if (!current.configDirty) {
    const seeded = draftFromRoute(route, connectionRevision)
    return freezeDraft({
      ...seeded,
      taskListResourceId: routeChanged ? '' : current.taskListResourceId,
      probeDirty: routeChanged ? false : current.probeDirty,
    })
  }
  return freezeDraft({
    ...current,
    taskListResourceId: routeChanged ? '' : current.taskListResourceId,
    probeDirty: routeChanged ? false : current.probeDirty,
  })
}

function draftFromRoute(
  route: FeishuIdentityRouteProjection,
  connectionRevision: number,
): WorkbenchFeishuIdentityDraft {
  return Object.freeze({
    appId: route.appId ?? '',
    credentialRef: route.credential.ref ?? '',
    taskListResourceId: '',
    configDirty: false,
    probeDirty: false,
    basedOnConnectionRevision: connectionRevision,
    basedOnRouteGeneration: route.generation,
  })
}

function freezeDraft(value: WorkbenchFeishuIdentityDraft): WorkbenchFeishuIdentityDraft {
  return Object.freeze({
    appId: value.appId,
    credentialRef: value.credentialRef,
    taskListResourceId: value.taskListResourceId,
    configDirty: value.configDirty,
    probeDirty: value.probeDirty,
    basedOnConnectionRevision: value.basedOnConnectionRevision,
    basedOnRouteGeneration: value.basedOnRouteGeneration,
  })
}

function sameDraft(
  left: WorkbenchFeishuIdentityDraft,
  right: WorkbenchFeishuIdentityDraft,
): boolean {
  return left.appId === right.appId
    && left.credentialRef === right.credentialRef
    && left.taskListResourceId === right.taskListResourceId
    && left.configDirty === right.configDirty
    && left.probeDirty === right.probeDirty
    && left.basedOnConnectionRevision === right.basedOnConnectionRevision
    && left.basedOnRouteGeneration === right.basedOnRouteGeneration
}

function replaceDraft(
  drafts: WorkbenchFeishuConnectionClientState['drafts'],
  kind: FeishuIdentityKind,
  draft: WorkbenchFeishuIdentityDraft,
): WorkbenchFeishuConnectionClientState['drafts'] {
  return Object.freeze(kind === 'bot'
    ? { bot: draft, user: drafts.user }
    : { bot: drafts.bot, user: draft })
}

function detachIssue(issue: FeishuConnectionIssue): FeishuConnectionIssue {
  return Object.freeze({
    code: issue.code,
    recovery: issue.recovery,
    missingScopes: Object.freeze([...issue.missingScopes]),
    grantPlane: issue.grantPlane,
    retryAt: issue.retryAt,
  })
}

function detachResourceProbe(value: FeishuResourceProbeProjection): FeishuResourceProbeProjection {
  if (value.state === 'not-tested') return Object.freeze({ state: 'not-tested' })
  if (value.state === 'accessible') {
    return Object.freeze({ state: 'accessible', kind: value.kind, resourceId: value.resourceId })
  }
  return Object.freeze({
    state: 'unavailable',
    kind: value.kind,
    resourceId: value.resourceId,
    issue: detachIssue(value.issue),
  })
}

function detachVerification(value: FeishuVerificationProjection): FeishuVerificationProjection {
  return Object.freeze({
    verificationId: value.verificationId,
    sequence: value.sequence,
    routeGeneration: value.routeGeneration,
    checkedAt: value.checkedAt,
    result: value.result,
    identity: Object.freeze({
      state: value.identity.state,
      issue: value.identity.issue === null ? null : detachIssue(value.identity.issue),
    }),
    scopeInspection: Object.freeze({
      state: value.scopeInspection.state,
      scopes: Object.freeze(value.scopeInspection.scopes.map(scope => Object.freeze({ ...scope }))),
      issue: value.scopeInspection.issue === null
        ? null
        : detachIssue(value.scopeInspection.issue),
    }),
    resourceProbe: detachResourceProbe(value.resourceProbe),
  })
}

function detachRoute(value: FeishuIdentityRouteProjection): FeishuIdentityRouteProjection {
  return Object.freeze({
    kind: value.kind,
    state: value.state,
    generation: value.generation,
    appId: value.appId,
    credential: Object.freeze({ ...value.credential }),
    actor: value.actor === null ? null : Object.freeze({ ...value.actor }),
    displayLabel: value.displayLabel,
    lastVerification: value.lastVerification === null
      ? null
      : detachVerification(value.lastVerification),
  })
}

function detachCenter(value: FeishuConnectionCenterProjection): FeishuConnectionCenterProjection {
  return Object.freeze({
    connectionId: value.connectionId,
    realm: value.realm,
    revision: value.revision,
    bot: detachRoute(value.bot),
    user: detachRoute(value.user),
    updatedAt: value.updatedAt,
  })
}
