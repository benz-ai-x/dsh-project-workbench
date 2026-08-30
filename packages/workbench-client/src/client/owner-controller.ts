/** React-free Owner shell coordinating auth before protected Remote state. */

import type {
  OwnerAccessProjection,
  OwnerAuthErrorCode,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { OwnerAuthHttp } from './auth-http.ts'
import {
  WorkbenchStatusController,
  type WorkbenchRemote,
} from './controller.ts'
import { WorkbenchActivityController } from './activity-controller.ts'
import {
  WorkbenchProjectController,
  type WorkbenchProjectRemote,
} from './project-controller.ts'

/** User-visible shell modes. */
export type OwnerPhase =
  | 'probing'
  | 'setup'
  | 'setup-pending'
  | 'recovery'
  | 'login'
  | 'login-pending'
  | 'authenticated'
  | 'logout-pending'
  | 'error'

export type OwnerOperation = 'probe' | 'initialize' | 'login' | 'logout'
export type OwnerIssueCode = OwnerAuthErrorCode | 'password-mismatch'

/** Display-safe issue. Raw response bodies and thrown messages never enter UI state. */
export interface OwnerIssue {
  readonly code: OwnerIssueCode
  readonly operation: OwnerOperation
  readonly retryAfterSeconds?: number
}

/** Immutable state consumed by OwnerPage. */
export interface OwnerClientState {
  readonly phase: OwnerPhase
  readonly access: OwnerAccessProjection | null
  readonly status: WorkbenchStatusController | null
  readonly projects: WorkbenchProjectController | null
  readonly activity: WorkbenchActivityController | null
  readonly recoveryCode: string | null
  readonly issue: OwnerIssue | null
}

const INITIAL_STATE: OwnerClientState = Object.freeze({
  phase: 'probing',
  access: null,
  status: null,
  projects: null,
  activity: null,
  recoveryCode: null,
  issue: null,
})

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Browser-clock and timer seams used to enforce the projected session lifetime. */
export interface OwnerControllerOptions {
  readonly now?: () => number
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  readonly cancelScheduled?: (timer: ReturnType<typeof setTimeout>) => void
}

/**
 * Owns the complete browser authentication lifetime and exactly one protected
 * status, Project, and Activity controller. Admission only follows a signed-in result.
 */
export class OwnerController {
  private state: OwnerClientState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private status: WorkbenchStatusController | null = null
  private projects: WorkbenchProjectController | null = null
  private activity: WorkbenchActivityController | null = null
  private authEpoch = 0
  private authAbort: AbortController | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly auth: OwnerAuthHttp,
    private readonly remote: WorkbenchRemote & WorkbenchProjectRemote,
    private readonly options: OwnerControllerOptions = {},
  ) {}

  readonly getSnapshot = (): OwnerClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Initial auth check. It is the only startup path into protected state. */
  start(): Promise<void> {
    return this.track(this.doProbe(true))
  }

  /** Explicit auth retry; freeze protected work until the probe succeeds. */
  probe(): Promise<void> {
    if (this.hasExpiredSignedInAccess()) return Promise.resolve()
    this.status?.markDisconnected()
    this.projects?.markDisconnected()
    this.activity?.markDisconnected()
    return this.track(this.doProbe(true))
  }

  /** Setup confirmation is a Client usability check; Host validation stays authoritative. */
  initialize(password: string, confirmation: string): Promise<void> {
    if (this.disposed || this.state.phase !== 'setup') return Promise.resolve()
    if (password !== confirmation) {
      this.publish({
        ...this.state,
        issue: ownerIssue('initialize', 'password-mismatch'),
      })
      return Promise.resolve()
    }
    return this.track(this.doInitialize(password))
  }

  login(password: string): Promise<void> {
    if (this.disposed || this.state.phase !== 'login') return Promise.resolve()
    return this.track(this.doLogin(password))
  }

  logout(): Promise<void> {
    if (this.disposed
      || this.state.phase !== 'authenticated'
      || !this.checkSessionExpiry()) return Promise.resolve()
    return this.track(this.doLogout())
  }

  /** Clear the one-time plaintext before opening the protected projection. */
  acknowledgeRecovery(): Promise<void> {
    if (this.disposed
      || this.state.phase !== 'recovery'
      || this.state.access?.state !== 'signed-in'
      || !this.checkSessionExpiry()) return Promise.resolve()
    return this.track(this.doAcknowledgeRecovery(this.state.access))
  }

  /** Cancel work immediately when the physical Host generation disappears. */
  markDisconnected(): void {
    if (this.disposed || this.hasExpiredSignedInAccess()) return
    ++this.authEpoch
    this.authAbort?.abort(new Error('Workbench auth connection generation changed'))
    this.authAbort = null
    this.status?.markDisconnected()
    this.projects?.markDisconnected()
    this.activity?.markDisconnected()

    const unavailable = ownerIssue(connectionFallbackOperation(this.state.phase), 'unavailable')
    if (this.state.phase === 'setup-pending') {
      this.publish({ ...this.state, phase: 'setup', issue: unavailable })
    } else if (this.state.phase === 'login-pending') {
      this.publish({ ...this.state, phase: 'login', issue: unavailable })
    } else if (this.state.phase === 'logout-pending') {
      this.publish({ ...this.state, phase: 'authenticated', issue: unavailable })
    } else if (this.state.phase === 'probing') {
      this.restoreAfterProbeFailure(unavailable)
    }
  }

  /** Re-authenticate first; only the accepted signed-in result may refresh protected state. */
  connectionReset(): Promise<void> {
    if (this.disposed || this.hasExpiredSignedInAccess()) return Promise.resolve()
    this.status?.markDisconnected()
    this.projects?.markDisconnected()
    this.activity?.markDisconnected()
    return this.track(this.doProbe(true))
  }

  /** Erase secrets/protected state synchronously, then drain auth and Remote work. */
  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    ++this.authEpoch
    this.authAbort?.abort(new Error('Workbench Owner Client disposed'))
    this.authAbort = null
    this.clearExpiryTimer()
    const currentStatus = this.status
    const currentProjects = this.projects
    const currentActivity = this.activity
    this.status = null
    this.projects = null
    this.activity = null
    const statusDisposal = currentStatus?.dispose()
    const projectDisposal = currentProjects?.dispose()
    const activityDisposal = currentActivity?.dispose()
    this.state = INITIAL_STATE
    this.listeners.clear()
    const pending = [...this.inFlight]
    if (statusDisposal !== undefined) pending.push(statusDisposal)
    if (projectDisposal !== undefined) pending.push(projectDisposal)
    if (activityDisposal !== undefined) pending.push(activityDisposal)
    this.disposal = Promise.allSettled(pending).then(() => undefined)
    return this.disposal
  }

  private async doProbe(refreshStatus: boolean): Promise<void> {
    if (this.disposed) return
    const previous = this.state
    const operation = this.beginAuth('Workbench auth probe was superseded')
    this.publish({ ...previous, phase: 'probing', issue: null })
    try {
      const result = await this.auth.state(operation.abort.signal)
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      if (!result.ok) {
        this.restoreAfterProbeFailure(ownerIssue(
          'probe',
          result.error.code,
          result.error.retryAfterSeconds,
        ))
        return
      }
      await this.adoptAccess(detachAccess(result.value), refreshStatus, operation.epoch)
    } catch {
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      this.restoreAfterProbeFailure(ownerIssue('probe', 'unavailable'))
    } finally {
      if (this.authAbort === operation.abort) this.authAbort = null
    }
  }

  private async doInitialize(password: string): Promise<void> {
    const operation = this.beginAuth('Workbench Owner setup was superseded')
    this.publish({ ...this.state, phase: 'setup-pending', issue: null })
    try {
      const result = await this.auth.initialize(password, operation.abort.signal)
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      if (!result.ok) {
        const issue = ownerIssue(
          'initialize',
          result.error.code,
          result.error.retryAfterSeconds,
        )
        if (result.error.code === 'already-initialized') {
          this.publish({
            phase: 'login',
            access: Object.freeze({ state: 'signed-out' }),
            status: null,
            projects: null,
            activity: null,
            recoveryCode: null,
            issue,
          })
        } else {
          this.publish({ ...this.state, phase: 'setup', issue })
        }
        return
      }
      const access = detachAccess(result.value.access)
      this.publish({
        phase: 'recovery',
        access,
        status: null,
        projects: null,
        activity: null,
        recoveryCode: result.value.recoveryCode,
        issue: null,
      })
      this.scheduleExpiry(access)
    } catch {
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      this.publish({
        ...this.state,
        phase: 'setup',
        issue: ownerIssue('initialize', 'unavailable'),
      })
    } finally {
      if (this.authAbort === operation.abort) this.authAbort = null
    }
  }

  private async doLogin(password: string): Promise<void> {
    const operation = this.beginAuth('Workbench Owner login was superseded')
    this.publish({ ...this.state, phase: 'login-pending', issue: null })
    try {
      const result = await this.auth.login(password, operation.abort.signal)
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      if (!result.ok) {
        this.publish({
          ...this.state,
          phase: 'login',
          issue: ownerIssue('login', result.error.code, result.error.retryAfterSeconds),
        })
        return
      }
      await this.adoptSignedIn(detachAccess(result.value.access), true, operation.epoch)
    } catch {
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      this.publish({
        ...this.state,
        phase: 'login',
        issue: ownerIssue('login', 'unavailable'),
      })
    } finally {
      if (this.authAbort === operation.abort) this.authAbort = null
    }
  }

  private async doLogout(): Promise<void> {
    const operation = this.beginAuth('Workbench Owner logout was superseded')
    this.status?.markDisconnected()
    this.projects?.markDisconnected()
    this.activity?.markDisconnected()
    this.publish({ ...this.state, phase: 'logout-pending', issue: null })
    try {
      const result = await this.auth.logout(operation.abort.signal)
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      if (!result.ok || result.value.state !== 'signed-out') {
        this.publish({
          ...this.state,
          phase: 'authenticated',
          issue: result.ok
            ? ownerIssue('logout', 'unavailable')
            : ownerIssue('logout', result.error.code, result.error.retryAfterSeconds),
        })
        return
      }
      this.clearExpiryTimer()
      const draining = this.retireProtectedControllers()
      this.publish({
        phase: 'login',
        access: detachAccess(result.value),
        status: null,
        projects: null,
        activity: null,
        recoveryCode: null,
        issue: null,
      })
      await draining
    } catch {
      if (!this.acceptAuth(operation)) return
      this.authAbort = null
      this.publish({
        ...this.state,
        phase: 'authenticated',
        issue: ownerIssue('logout', 'unavailable'),
      })
    } finally {
      if (this.authAbort === operation.abort) this.authAbort = null
    }
  }

  private async doAcknowledgeRecovery(
    access: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>,
  ): Promise<void> {
    if (this.disposed) return
    const epoch = this.authEpoch
    this.publish({ ...this.state, recoveryCode: null, issue: null })
    await this.adoptSignedIn(access, true, epoch)
  }

  private async adoptAccess(
    access: OwnerAccessProjection,
    refreshStatus: boolean,
    epoch: number,
  ): Promise<void> {
    if (access.state === 'signed-in') {
      const existingAccess = this.state.access
      const keepRecoveryCode = this.state.recoveryCode !== null
        && existingAccess?.state === 'signed-in'
        && existingAccess.ownerId === access.ownerId
      if (keepRecoveryCode) {
        this.publish({
          phase: 'recovery',
          access,
          status: null,
          projects: null,
          activity: null,
          recoveryCode: this.state.recoveryCode,
          issue: null,
        })
        this.scheduleExpiry(access)
        return
      }
      await this.adoptSignedIn(access, refreshStatus, epoch)
      return
    }

    this.clearExpiryTimer()
    const draining = this.retireProtectedControllers()
    this.publish({
      phase: access.state === 'setup-required' ? 'setup' : 'login',
      access,
      status: null,
      projects: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    await draining
  }

  private async adoptSignedIn(
    access: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>,
    refreshStatus: boolean,
    epoch: number,
  ): Promise<void> {
    if (this.disposed || epoch !== this.authEpoch) return
    const existingAccess = this.state.access
    if ((this.status !== null || this.projects !== null || this.activity !== null)
      && existingAccess?.state === 'signed-in'
      && existingAccess.ownerId !== access.ownerId) {
      await this.retireProtectedControllers()
      if (this.disposed || epoch !== this.authEpoch) return
    }
    const created = this.status === null || this.projects === null || this.activity === null
    const status = this.status ?? this.createStatusController()
    const projects = this.projects ?? this.createProjectController()
    const activity = this.activity ?? this.createActivityController()
    this.status = status
    this.projects = projects
    this.activity = activity
    this.publish({
      phase: 'authenticated',
      access,
      status,
      projects,
      activity,
      recoveryCode: null,
      issue: null,
    })
    this.scheduleExpiry(access)
    if (created || refreshStatus) {
      await Promise.all([
        status.refresh(),
        created ? projects.refresh() : projects.connectionReset(),
        activity.refresh(),
      ])
    }
  }

  private createStatusController(): WorkbenchStatusController {
    return new WorkbenchStatusController(this.remote, {
      onBeforeProtectedOperation: () => this.admitProtectedOperation(),
      onTransportFailure: () => { this.revalidateAfterStatusFailure() },
      onCommitted: () => { void this.activity?.refresh() },
    })
  }

  private createActivityController(): WorkbenchActivityController {
    return new WorkbenchActivityController(this.remote, {
      onBeforeProtectedOperation: () => this.admitProtectedOperation(),
      onTransportFailure: () => { this.revalidateAfterStatusFailure() },
    })
  }

  private createProjectController(): WorkbenchProjectController {
    return new WorkbenchProjectController(this.remote, {
      onBeforeProtectedOperation: () => this.admitProtectedOperation(),
      onTransportFailure: () => { this.revalidateAfterStatusFailure() },
      onCommitted: () => { void this.activity?.refresh() },
    })
  }

  /** Admit retained child controllers only while the Owner shell is fully authenticated. */
  private admitProtectedOperation(): boolean {
    return this.state.phase === 'authenticated' && this.checkSessionExpiry()
  }

  private revalidateAfterStatusFailure(): void {
    if (this.disposed || this.authAbort !== null || this.state.phase !== 'authenticated') return
    void this.track(this.doProbe(false))
  }

  private retireProtectedControllers(): Promise<void> {
    const currentStatus = this.status
    const currentProjects = this.projects
    const currentActivity = this.activity
    this.status = null
    this.projects = null
    this.activity = null
    return Promise.allSettled([
      currentStatus?.dispose() ?? Promise.resolve(),
      currentProjects?.dispose() ?? Promise.resolve(),
      currentActivity?.dispose() ?? Promise.resolve(),
    ]).then(() => undefined)
  }

  /**
   * Reconcile the browser projection with its absolute server-issued expiry.
   * False means no protected projection is currently admissible.
   */
  checkSessionExpiry(): boolean {
    if (this.disposed) return false
    const access = this.state.access
    if (access?.state !== 'signed-in') return false
    const expiresAt = Date.parse(access.sessionExpiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      this.expireProjection()
      return false
    }
    return true
  }

  private hasExpiredSignedInAccess(): boolean {
    return this.state.access?.state === 'signed-in' && !this.checkSessionExpiry()
  }

  private scheduleExpiry(
    access: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>,
  ): void {
    this.clearExpiryTimer()
    if (this.disposed || this.state.access !== access) return
    const expiresAt = Date.parse(access.sessionExpiresAt)
    const remaining = expiresAt - this.now()
    if (!Number.isFinite(remaining) || remaining <= 0) {
      this.expireProjection()
      return
    }
    const delay = Math.min(remaining, MAX_TIMER_DELAY_MS)
    const schedule = this.options.schedule ?? setTimeout
    this.expiryTimer = schedule(() => {
      this.expiryTimer = null
      if (this.disposed || this.state.access !== access) return
      if (expiresAt <= this.now()) this.expireProjection()
      else this.scheduleExpiry(access)
    }, delay)
  }

  private clearExpiryTimer(): void {
    const timer = this.expiryTimer
    this.expiryTimer = null
    if (timer === null) return
    const cancel = this.options.cancelScheduled ?? clearTimeout
    cancel(timer)
  }

  private expireProjection(): void {
    if (this.disposed || this.state.access?.state !== 'signed-in') return
    ++this.authEpoch
    this.authAbort?.abort(new Error('Workbench Owner session projection expired'))
    this.authAbort = null
    this.clearExpiryTimer()
    const draining = this.retireProtectedControllers()
    this.publish({
      phase: 'login',
      access: Object.freeze({ state: 'signed-out' }),
      status: null,
      projects: null,
      activity: null,
      recoveryCode: null,
      issue: null,
    })
    void this.track(draining)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private restoreAfterProbeFailure(issue: OwnerIssue): void {
    const access = this.state.access
    if (access?.state === 'signed-in' && this.state.recoveryCode !== null) {
      this.publish({ ...this.state, phase: 'recovery', issue })
    } else if (access?.state === 'signed-in'
      && this.status !== null
      && this.projects !== null
      && this.activity !== null) {
      this.publish({
        ...this.state,
        phase: 'authenticated',
        status: this.status,
        projects: this.projects,
        activity: this.activity,
        issue,
      })
    } else if (access?.state === 'setup-required') {
      this.publish({ ...this.state, phase: 'setup', issue })
    } else if (access?.state === 'signed-out') {
      this.publish({ ...this.state, phase: 'login', issue })
    } else {
      this.publish({ ...this.state, phase: 'error', issue })
    }
  }

  private beginAuth(reason: string): { readonly epoch: number; readonly abort: AbortController } {
    ++this.authEpoch
    this.authAbort?.abort(new Error(reason))
    const abort = new AbortController()
    this.authAbort = abort
    return { epoch: this.authEpoch, abort }
  }

  private acceptAuth(operation: {
    readonly epoch: number
    readonly abort: AbortController
  }): boolean {
    return !this.disposed
      && operation.epoch === this.authEpoch
      && this.authAbort === operation.abort
      && !operation.abort.signal.aborted
  }

  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(
      () => { this.inFlight.delete(pending) },
      () => { this.inFlight.delete(pending) },
    )
    return pending
  }

  private publish(next: OwnerClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Owner state observer failed')
      }
    }
  }
}

function ownerIssue(
  operation: OwnerOperation,
  code: OwnerIssueCode,
  retryAfterSeconds?: number,
): OwnerIssue {
  return Object.freeze({
    operation,
    code,
    ...retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
  })
}

function connectionFallbackOperation(phase: OwnerPhase): OwnerOperation {
  if (phase === 'setup-pending') return 'initialize'
  if (phase === 'login-pending') return 'login'
  if (phase === 'logout-pending') return 'logout'
  return 'probe'
}

function detachAccess(
  value: Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>,
): Extract<OwnerAccessProjection, { readonly state: 'signed-in' }>
function detachAccess(value: OwnerAccessProjection): OwnerAccessProjection
function detachAccess(value: OwnerAccessProjection): OwnerAccessProjection {
  if (value.state === 'setup-required') return Object.freeze({ state: 'setup-required' })
  if (value.state === 'signed-out') return Object.freeze({ state: 'signed-out' })
  return Object.freeze({
    state: 'signed-in',
    ownerId: value.ownerId,
    organizationId: value.organizationId,
    teamId: value.teamId,
    sessionExpiresAt: value.sessionExpiresAt,
  })
}
