/** Highest-level deterministic seam around the Workbench public command/query surface. */

import { randomUUID } from 'node:crypto'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SetStatusRequest,
  SetStatusResult,
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchStatusSnapshot,
} from './client.ts'
import {
  statusResult,
  statusSnapshot,
  type WorkbenchRepository,
} from './repository.ts'
import type { WorkbenchAuthorization } from './authorization.ts'

/** Injectable wall clock; production returns a fresh Date for every command. */
export interface WorkbenchClock {
  now(): Date
}

/** Injectable identities for every durable fact in one transactional command. */
export interface WorkbenchIdGenerator {
  nextStatusId(): string
  nextCommandId(): string
  nextAuditEventId(): string
  nextOutboxId(): string
}

/** Stable identity for a future independently versioned external capability. */
export interface WorkbenchExternalAdapter {
  readonly adapterId: string
}

/**
 * External ports collected at the scenario boundary. T01 intentionally invokes
 * none of them: a durable local status write has no implied external effect.
 */
export interface WorkbenchExternalAdapters {
  readonly feishu?: WorkbenchExternalAdapter
  readonly files?: WorkbenchExternalAdapter
  readonly modelAndSubagent?: WorkbenchExternalAdapter
  readonly scheduler?: WorkbenchExternalAdapter
}

/** Construction dependencies for a deterministic scenario. */
export interface WorkbenchScenarioOptions {
  readonly clock: WorkbenchClock
  readonly ids: WorkbenchIdGenerator
  readonly repository: WorkbenchRepository
  readonly adapters: WorkbenchExternalAdapters
  readonly authorization: WorkbenchAuthorization
  readonly maxStatusLength: number
}

export const systemWorkbenchClock: WorkbenchClock = Object.freeze({
  now: () => new Date(),
})

export const randomWorkbenchIds: WorkbenchIdGenerator = Object.freeze({
  nextStatusId: () => `status-${randomUUID()}`,
  nextCommandId: () => `command-${randomUUID()}`,
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextOutboxId: () => `outbox-${randomUUID()}`,
})

export const noWorkbenchExternalAdapters: WorkbenchExternalAdapters = Object.freeze({})

type ScenarioPhase = 'new' | 'opening' | 'running' | 'closing' | 'closed'

/**
 * Public behavior harness shared by the Cordis service and scenario tests.
 * It owns admission, cancellation, in-flight draining, and repository closure.
 */
export class WorkbenchScenario {
  private phase: ScenarioPhase = 'new'
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<unknown>>()
  private opening: Promise<void> | undefined
  private closing: Promise<void> | undefined

  constructor(readonly options: WorkbenchScenarioOptions) {
    if (!Number.isSafeInteger(options.maxStatusLength) || options.maxStatusLength < 1) {
      throw new TypeError('maxStatusLength must be a positive safe integer')
    }
  }

  /** Expose the injected external port set to scenario fixtures without invoking it. */
  get adapters(): WorkbenchExternalAdapters {
    return this.options.adapters
  }

  /** Current lifecycle phase for deterministic disposal assertions. */
  get lifecycle(): ScenarioPhase {
    return this.phase
  }

  open(): Promise<void> {
    if (this.phase === 'running') return Promise.resolve()
    if (this.phase === 'opening') return this.opening as Promise<void>
    if (this.phase !== 'new') return Promise.reject(unavailable('Workbench scenario cannot be reopened'))
    this.phase = 'opening'
    this.opening = this.doOpen()
    return this.opening
  }

  /** Query the externally observable durable projection. */
  snapshot(callerSignal: AbortSignal = new AbortController().signal): Promise<WorkbenchStatusSnapshot | null> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('snapshot requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      await this.options.authorization.require('workbench.status.read', operationSignal)
      throwIfCancelled(operationSignal)
      try {
        const value = await this.options.repository.snapshot(operationSignal)
        return value === null ? null : statusSnapshot(value)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
    })
  }

  /** Read one redacted, organization-scoped Activity page. */
  activity(
    filter: WorkbenchActivityFilter = {},
    callerSignal: AbortSignal = new AbortController().signal,
  ): Promise<WorkbenchActivityProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('activity requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.activity.read', operationSignal)
      const normalized = validateActivityFilter(filter)
      throwIfCancelled(operationSignal)
      let projection: WorkbenchActivityProjection
      try {
        projection = await this.options.repository.readActivity(Object.freeze({
          organizationId: scope.organizationId,
          filter: normalized,
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return this.options.authorization.filterProjection(
        'workbench.activity.read',
        projection,
        operationSignal,
      )
    })
  }

  /** Verify the complete stored audit chain and its current head. */
  auditIntegrity(
    callerSignal: AbortSignal = new AbortController().signal,
  ): Promise<WorkbenchAuditIntegrityProjection> {
    return this.execute(async (lifetimeSignal) => {
      if (!(callerSignal instanceof AbortSignal)) {
        throw badRequest('auditIntegrity requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([callerSignal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      await this.options.authorization.require('workbench.audit.verify', operationSignal)
      let projection: WorkbenchAuditIntegrityProjection
      try {
        projection = await this.options.repository.verifyAuditChain(operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      return this.options.authorization.filterProjection(
        'workbench.audit.verify',
        projection,
        operationSignal,
      )
    })
  }

  /** Validate and execute the public compare-and-set command. */
  setStatus(request: SetStatusRequest, signal: AbortSignal): Promise<SetStatusResult> {
    return this.execute(async (lifetimeSignal) => {
      if (!(signal instanceof AbortSignal)) {
        throw badRequest('setStatus requires an AbortSignal', { field: 'signal' })
      }
      const operationSignal = AbortSignal.any([signal, lifetimeSignal])
      throwIfCancelled(operationSignal)
      const scope = await this.options.authorization.require('workbench.status.write', operationSignal)
      throwIfCancelled(operationSignal)
      const normalized = validateRequest(request, this.options.maxStatusLength)
      const candidateId = generatedId(this.options.ids.nextStatusId(), 'status')
      const commandId = generatedId(this.options.ids.nextCommandId(), 'command')
      const auditEventId = generatedId(this.options.ids.nextAuditEventId(), 'audit event')
      const outboxId = generatedId(this.options.ids.nextOutboxId(), 'outbox')
      const now = this.options.clock.now()
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw infrastructure('Workbench clock returned an invalid instant')
      }
      let result: SetStatusResult
      try {
        result = await this.options.repository.commitStatus(Object.freeze({
          candidateId,
          message: normalized.message,
          expectedRevision: normalized.expectedRevision,
          updatedAt: now.toISOString(),
          command: Object.freeze({
            commandId,
            auditEventId,
            outboxId,
            idempotencyKey: normalized.idempotencyKey,
            causationId: normalized.causationId,
            reason: normalized.reason,
            actor: Object.freeze({
              kind: 'owner',
              id: scope.ownerId,
              organizationId: scope.organizationId,
              teamId: scope.teamId,
            }),
            occurredAt: now.toISOString(),
          }),
        }), operationSignal)
      } catch (error: unknown) {
        if (operationSignal.aborted) throw cancelled('Workbench request was cancelled')
        throw error
      }
      // A repository result is the durable commit point. Cancellation that
      // races after that result must not turn an acknowledged commit into a
      // false "cancelled" outcome and invite an unsafe retry.
      return statusResult(result)
    })
  }

  /** Stop admission, cancel owned work, wait for quiescence, then close storage. */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doOpen(): Promise<void> {
    try {
      await this.options.repository.open()
      if (this.phase === 'closing') return
      this.phase = 'running'
    } catch (error: unknown) {
      this.phase = 'closed'
      await this.options.repository.close().catch(() => undefined)
      throw error
    }
  }

  private async doClose(): Promise<void> {
    if (this.phase === 'closed') return
    this.phase = 'closing'
    this.lifetime.abort(new Error('Workbench scenario is disposing'))
    await this.opening?.catch(() => undefined)
    await Promise.allSettled([...this.inFlight])
    try {
      await this.options.repository.close()
    } finally {
      this.phase = 'closed'
    }
  }

  private async execute<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase !== 'running') throw unavailable('Workbench is not accepting requests')
    const pending = Promise.resolve().then(() => operation(this.lifetime.signal))
    this.inFlight.add(pending)
    try {
      return await pending
    } catch (error: unknown) {
      if (error instanceof TypertRemoteFailure) throw error
      if (this.lifetime.signal.aborted) throw cancelled('Workbench request was cancelled during disposal')
      throw infrastructure('Workbench persistence operation failed', error)
    } finally {
      this.inFlight.delete(pending)
    }
  }
}

function validateRequest(request: SetStatusRequest, maxStatusLength: number): SetStatusRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw badRequest('setStatus request must be an object', { field: 'request' })
  }
  const messageValue: unknown = Reflect.get(request, 'message')
  if (typeof messageValue !== 'string') {
    throw badRequest('status message must be a string', { field: 'message' })
  }
  const message = messageValue.trim()
  if (message.length === 0) {
    throw badRequest('status message must not be blank', { field: 'message' })
  }
  const actualLength = [...message].length
  if (actualLength > maxStatusLength) {
    throw badRequest(`status message exceeds ${maxStatusLength} characters`, {
      field: 'message',
      maxStatusLength,
      actualLength,
    })
  }
  const expectedRevision: unknown = Reflect.get(request, 'expectedRevision')
  if (expectedRevision !== null
    && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1)) {
    throw badRequest('expectedRevision must be null or a positive safe integer', {
      field: 'expectedRevision',
    })
  }
  const idempotencyKey = validateCommandKey(
    Reflect.get(request, 'idempotencyKey'),
    'idempotencyKey',
  )
  const causationId = validateCommandKey(
    Reflect.get(request, 'causationId'),
    'causationId',
  )
  const reason: unknown = Reflect.get(request, 'reason')
  if (reason !== 'owner-status-edit') {
    throw badRequest('reason is not supported for this command', { field: 'reason' })
  }
  return Object.freeze({
    message,
    expectedRevision: expectedRevision as number | null,
    idempotencyKey,
    causationId,
    reason,
  })
}

const SAFE_COMMAND_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u
const SAFE_FILTER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DEFAULT_ACTIVITY_LIMIT = 50
const MAX_ACTIVITY_LIMIT = 100

function validateCommandKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_COMMAND_KEY.test(value)) {
    throw badRequest(`${field} must be 16-128 safe ASCII characters`, { field })
  }
  return value
}

function validateActivityFilter(value: WorkbenchActivityFilter): WorkbenchActivityFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest('activity filter must be an object', { field: 'filter' })
  }
  const projectId: unknown = Reflect.get(value, 'projectId')
  if (projectId !== undefined && projectId !== null
    && (typeof projectId !== 'string' || !SAFE_FILTER_ID.test(projectId))) {
    throw badRequest('projectId must be null or a safe identifier', { field: 'projectId' })
  }
  const objectType: unknown = Reflect.get(value, 'objectType')
  if (objectType !== undefined && objectType !== 'workbench-status') {
    throw badRequest('objectType is not supported', { field: 'objectType' })
  }
  const objectId: unknown = Reflect.get(value, 'objectId')
  if (objectId !== undefined
    && (typeof objectId !== 'string' || !SAFE_FILTER_ID.test(objectId))) {
    throw badRequest('objectId must be a safe identifier', { field: 'objectId' })
  }
  const action: unknown = Reflect.get(value, 'action')
  if (action !== undefined && action !== 'workbench.status.updated') {
    throw badRequest('action is not supported', { field: 'action' })
  }
  const beforeSequence: unknown = Reflect.get(value, 'beforeSequence')
  if (beforeSequence !== undefined
    && (!Number.isSafeInteger(beforeSequence) || (beforeSequence as number) < 1)) {
    throw badRequest('beforeSequence must be a positive safe integer', {
      field: 'beforeSequence',
    })
  }
  const requestedLimit: unknown = Reflect.get(value, 'limit')
  if (requestedLimit !== undefined
    && (!Number.isSafeInteger(requestedLimit)
      || (requestedLimit as number) < 1
      || (requestedLimit as number) > MAX_ACTIVITY_LIMIT)) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}`, {
      field: 'limit',
    })
  }
  return Object.freeze({
    ...(projectId === undefined ? {} : { projectId: projectId as string | null }),
    ...(objectType === undefined ? {} : { objectType: 'workbench-status' as const }),
    ...(objectId === undefined ? {} : { objectId: objectId as string }),
    ...(action === undefined ? {} : { action: 'workbench.status.updated' as const }),
    ...(beforeSequence === undefined ? {} : { beforeSequence: beforeSequence as number }),
    limit: requestedLimit === undefined ? DEFAULT_ACTIVITY_LIMIT : requestedLimit as number,
  })
}

function generatedId(value: string, kind: string): string {
  if (typeof value !== 'string' || !SAFE_FILTER_ID.test(value)) {
    throw infrastructure(`Workbench id generator returned an invalid ${kind} id`)
  }
  return value
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw cancelled('Workbench request was cancelled')
}

function badRequest(message: string, details: Record<string, string | number>): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'bad-request', message, details })
}

function cancelled(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'cancelled', message, details: {} })
}

function unavailable(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'unavailable', message, details: {} })
}

function infrastructure(message: string, cause?: unknown): TypertRemoteFailure {
  const failure = new TypertRemoteFailure({ code: 'internal', message, details: {} })
  if (cause !== undefined) Object.defineProperty(failure, 'cause', { value: cause })
  return failure
}
