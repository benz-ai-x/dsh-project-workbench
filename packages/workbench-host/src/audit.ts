/** Pure canonicalization and tamper-evident audit-chain primitives. */

import { createHash } from 'node:crypto'
import type {
  WorkbenchActivitySummaryCode,
  WorkbenchAuditAction,
  WorkbenchAuditObjectType,
  WorkbenchCommandReason,
  WorkbenchOutboxState,
} from './client.ts'

export const AUDIT_CHAIN_NAME = 'project-workbench.audit' as const
export const AUDIT_FORMAT_VERSION = 1 as const
export type AuditHash = `sha256:${string}`
export const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}` as AuditHash

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/u
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n
const SAFE_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/u
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const MAX_REFERENCE_CODE_POINTS = 256
const MAX_REFERENCE_BYTES = 1_024
const MAX_CHANGED_FIELDS = 64

export type AuditActorKind = 'anonymous' | 'owner' | 'system'

export interface AuditActor {
  readonly kind: AuditActorKind
  readonly id: string
}

export interface AuditReason {
  readonly code: WorkbenchCommandReason
}

/** Indexed authority scope protected by the same event hash. */
export interface AuditScope {
  readonly organizationId: string
  readonly teamId: string
  readonly projectId: string | null
}

export interface AuditObjectReference {
  readonly type: WorkbenchAuditObjectType
  readonly id: string
  /** Canonical decimal string; never cross the JavaScript safe-integer boundary. */
  readonly version: string
}

export interface AuditCommandReference {
  readonly id: string
  readonly type:
    | 'workbench.status.set'
    | 'workbench.project.create'
    | 'workbench.project-member.add'
    | 'workbench.project-member.set-status'
    | 'workbench.project.set-responsibility'
    | 'workbench.suggested-change.propose'
    | 'workbench.suggested-change.accept'
    | 'workbench.suggested-change.edit-accept'
    | 'workbench.suggested-change.reject'
    | 'workbench.suggested-change.defer'
    | 'workbench.feishu-route.configure'
    | 'workbench.feishu-route.reset'
    | 'workbench.feishu-route.disable'
    | 'workbench.feishu-route.verify'
    | 'workbench.feishu-task-list.bind'
    | 'workbench.feishu-task.reference'
    | 'workbench.feishu-task.update'
}

export interface AuditCausationReference {
  readonly id: string
}

export type AuditOutboxState = WorkbenchOutboxState

/** Payloads and credentials are deliberately absent from permanent audit data. */
export interface AuditOutboxReference {
  readonly id: string
  readonly state: AuditOutboxState
}

/** Safe Activity material: codes and changed field names, never changed values. */
export interface AuditSafeSummary {
  readonly code: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
}

export type AuditOutcome = 'committed' | 'failed' | 'rejected'

export interface AuditEventPayload {
  readonly auditId: string
  readonly occurredAt: string
  readonly actor: AuditActor
  readonly action: WorkbenchAuditAction
  readonly scope: AuditScope
  readonly reason: AuditReason
  readonly object: AuditObjectReference
  readonly command: AuditCommandReference
  readonly causation: AuditCausationReference
  readonly outbox: AuditOutboxReference | null
  readonly outcome: AuditOutcome
  readonly summary: AuditSafeSummary
}

export interface AuditEventInput extends AuditEventPayload {
  /** Positive canonical decimal string. */
  readonly sequence: string
  readonly previousHash: AuditHash
}

/** Immutable row material suitable for atomic repository insertion. */
export interface AuditEvent extends AuditEventInput {
  readonly eventHash: AuditHash
  readonly canonicalEnvelope: string
}

export interface AuditHashEnvelopeV1 {
  readonly chain: typeof AUDIT_CHAIN_NAME
  readonly version: typeof AUDIT_FORMAT_VERSION
  readonly sequence: string
  readonly previousHash: AuditHash
  readonly event: AuditEventPayload
}

export interface AuditTrustedHead {
  readonly eventCount: number
  readonly headHash: AuditHash
}

export type AuditIntegrityFailureCode =
  | 'canonical-envelope-mismatch'
  | 'event-hash-mismatch'
  | 'malformed-event'
  | 'previous-hash-mismatch'
  | 'sequence-mismatch'
  | 'tail-checkpoint-mismatch'
  | 'unsupported-format'

export interface AuditIntegrityFailure {
  readonly code: AuditIntegrityFailureCode
  /** Zero-based event index; equals eventCount for a tail-checkpoint failure. */
  readonly index: number
}

/** Safe public integrity result: no event body, diagnostic, or secret-bearing input. */
export type AuditIntegrityResult =
  | {
    readonly ok: true
    readonly eventCount: number
    readonly headHash: AuditHash
  }
  | {
    readonly ok: false
    readonly eventCount: number
    readonly headHash: AuditHash
    readonly failure: AuditIntegrityFailure
  }

/** JSON data accepted by the canonicalizer after its runtime I-JSON checks. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

/**
 * Canonicalize the I-JSON/JCS-compatible subset used by audit hashing.
 *
 * Object properties use raw UTF-16 ordering, arrays preserve order, strings
 * use ECMAScript JSON escaping without Unicode normalization, and every finite
 * admitted finite IEEE-754 double uses ECMAScript number serialization. Non-JSON values,
 * non-finite numbers, lone surrogates, accessors, sparse arrays, and cycles are
 * rejected instead of being silently coerced or omitted.
 */
export function canonicalizeJson(value: unknown): string {
  return serializeCanonical(value, new Set())
}

/** Build one versioned, detached audit event without reading or mutating state. */
export function createAuditEvent(input: AuditEventInput): AuditEvent {
  const normalized = normalizeAuditEventInput(input)
  if (normalized.sequence === '1' && normalized.previousHash !== AUDIT_GENESIS_HASH) {
    throw new TypeError('Audit sequence 1 must use the fixed genesis hash')
  }
  if (normalized.sequence !== '1' && normalized.previousHash === AUDIT_GENESIS_HASH) {
    throw new TypeError('Only audit sequence 1 may use the fixed genesis hash')
  }
  const envelope = auditEnvelope(normalized)
  const canonicalEnvelope = canonicalizeJson(envelope)
  return Object.freeze({
    ...normalized,
    eventHash: hashEnvelope(canonicalEnvelope),
    canonicalEnvelope,
  })
}

/**
 * Verify a complete chain from the fixed genesis and optionally bind its tail
 * to a trusted checkpoint. Failures return bounded public codes, never input.
 */
export function verifyAuditChain(
  events: readonly AuditEvent[],
  trustedHead?: AuditTrustedHead,
): AuditIntegrityResult {
  let verifiedCount = 0
  let headHash = AUDIT_GENESIS_HASH

  for (let index = 0; index < events.length; index += 1) {
    let fields: StoredAuditFields
    try {
      fields = storedAuditFields(events[index])
    } catch {
      return integrityFailure('malformed-event', index, events.length, headHash)
    }

    const expectedSequence = String(index + 1)
    if (!isPositiveDecimal(fields.sequence) || fields.sequence !== expectedSequence) {
      return integrityFailure('sequence-mismatch', index, events.length, headHash)
    }
    if (!isAuditHash(fields.previousHash) || fields.previousHash !== headHash) {
      return integrityFailure('previous-hash-mismatch', index, events.length, headHash)
    }
    if (!isAuditHash(fields.eventHash)) {
      return integrityFailure('event-hash-mismatch', index, events.length, headHash)
    }
    if (typeof fields.canonicalEnvelope !== 'string') {
      return integrityFailure('canonical-envelope-mismatch', index, events.length, headHash)
    }
    let storedVersion: unknown
    try {
      storedVersion = canonicalEnvelopeVersion(fields.canonicalEnvelope)
    } catch {
      return integrityFailure('canonical-envelope-mismatch', index, events.length, headHash)
    }
    if (hashEnvelope(fields.canonicalEnvelope) !== fields.eventHash) {
      return integrityFailure('event-hash-mismatch', index, events.length, headHash)
    }
    if (storedVersion !== AUDIT_FORMAT_VERSION) {
      return integrityFailure('unsupported-format', index, events.length, headHash)
    }

    let rebuilt: AuditEvent
    try {
      rebuilt = createAuditEvent(fields.input)
    } catch (error) {
      if (error instanceof AuditVocabularyCorrelationError) {
        try {
          if (canonicalizeJson(auditEnvelope(fields.input)) !== fields.canonicalEnvelope) {
            return integrityFailure('canonical-envelope-mismatch', index, events.length, headHash)
          }
        } catch {
          // Fall through to the stable malformed-event result below.
        }
      }
      return integrityFailure('malformed-event', index, events.length, headHash)
    }
    if (rebuilt.canonicalEnvelope !== fields.canonicalEnvelope) {
      return integrityFailure('canonical-envelope-mismatch', index, events.length, headHash)
    }
    if (rebuilt.eventHash !== fields.eventHash) {
      return integrityFailure('event-hash-mismatch', index, events.length, headHash)
    }

    verifiedCount += 1
    headHash = fields.eventHash
  }

  if (trustedHead !== undefined && !trustedHeadMatches(trustedHead, verifiedCount, headHash)) {
    return integrityFailure(
      'tail-checkpoint-mismatch',
      events.length,
      verifiedCount,
      headHash,
    )
  }
  return Object.freeze({ ok: true, eventCount: verifiedCount, headHash })
}

interface StoredAuditFields {
  readonly sequence: unknown
  readonly previousHash: unknown
  readonly eventHash: unknown
  readonly canonicalEnvelope: unknown
  readonly input: AuditEventInput
}

function storedAuditFields(value: unknown): StoredAuditFields {
  const record = dataRecord(value, 'Stored audit event')
  assertFields(record, [
    'sequence',
    'previousHash',
    'auditId',
    'occurredAt',
    'actor',
    'action',
    'scope',
    'reason',
    'object',
    'command',
    'causation',
    'outbox',
    'outcome',
    'summary',
    'eventHash',
    'canonicalEnvelope',
  ], [], 'Stored audit event')
  return {
    sequence: record.sequence,
    previousHash: record.previousHash,
    eventHash: record.eventHash,
    canonicalEnvelope: record.canonicalEnvelope,
    input: {
      sequence: record.sequence as string,
      previousHash: record.previousHash as AuditHash,
      auditId: record.auditId as string,
      occurredAt: record.occurredAt as string,
      actor: record.actor as AuditActor,
      action: record.action as WorkbenchAuditAction,
      scope: record.scope as AuditScope,
      reason: record.reason as AuditReason,
      object: record.object as AuditObjectReference,
      command: record.command as AuditCommandReference,
      causation: record.causation as AuditCausationReference,
      outbox: record.outbox as AuditOutboxReference | null,
      outcome: record.outcome as AuditOutcome,
      summary: record.summary as AuditSafeSummary,
    },
  }
}

function auditEnvelope(input: AuditEventInput): AuditHashEnvelopeV1 {
  const event: AuditEventPayload = Object.freeze({
    auditId: input.auditId,
    occurredAt: input.occurredAt,
    actor: input.actor,
    action: input.action,
    scope: input.scope,
    reason: input.reason,
    object: input.object,
    command: input.command,
    causation: input.causation,
    outbox: input.outbox,
    outcome: input.outcome,
    summary: input.summary,
  })
  return Object.freeze({
    chain: AUDIT_CHAIN_NAME,
    version: AUDIT_FORMAT_VERSION,
    sequence: input.sequence,
    previousHash: input.previousHash,
    event,
  })
}

function normalizeAuditEventInput(value: unknown): AuditEventInput {
  const record = dataRecord(value, 'Audit event input')
  assertFields(record, [
    'sequence',
    'previousHash',
    'auditId',
    'occurredAt',
    'actor',
    'action',
    'scope',
    'reason',
    'object',
    'command',
    'causation',
    'outbox',
    'outcome',
    'summary',
  ], [], 'Audit event input')

  const sequence = positiveDecimal(record.sequence, 'Audit sequence')
  const previousHash = auditHash(record.previousHash, 'Audit previousHash')
  const action = auditAction(record.action)
  const reason = normalizeReason(record.reason)
  const scope = normalizeScope(record.scope)
  const object = normalizeObjectReference(record.object)
  const command = normalizeCommandReference(record.command)
  const summary = normalizeSummary(record.summary)
  assertCorrelatedVocabulary(action, reason, scope, object, command, summary)
  return Object.freeze({
    sequence,
    previousHash,
    auditId: safeReference(record.auditId, 'Audit id'),
    occurredAt: canonicalInstant(record.occurredAt),
    actor: normalizeActor(record.actor),
    action,
    scope,
    reason,
    object,
    command,
    causation: normalizeCausationReference(record.causation),
    outbox: record.outbox === null ? null : normalizeOutboxReference(record.outbox),
    outcome: auditOutcome(record.outcome),
    summary,
  })
}

function normalizeActor(value: unknown): AuditActor {
  const record = dataRecord(value, 'Audit actor')
  assertFields(record, ['kind', 'id'], [], 'Audit actor')
  const kind = record.kind
  if (kind !== 'anonymous' && kind !== 'owner' && kind !== 'system') {
    throw new TypeError('Audit actor kind is unsupported')
  }
  return Object.freeze({ kind, id: safeReference(record.id, 'Audit actor id') })
}

function normalizeReason(value: unknown): AuditReason {
  const record = dataRecord(value, 'Audit reason')
  if (Object.hasOwn(record, 'detail')) {
    throw new TypeError('Audit events admit a reason code but no arbitrary detail')
  }
  assertFields(record, ['code'], [], 'Audit reason')
  if (record.code !== 'owner-status-edit'
    && record.code !== 'owner-project-create'
    && record.code !== 'owner-project-member-add'
    && record.code !== 'owner-project-member-status-change'
    && record.code !== 'owner-project-responsibility-set'
    && record.code !== 'owner-suggested-change-propose'
    && record.code !== 'owner-suggested-change-accept'
    && record.code !== 'owner-suggested-change-edit-accept'
    && record.code !== 'owner-suggested-change-reject'
    && record.code !== 'owner-suggested-change-defer'
    && record.code !== 'owner-feishu-route-configure'
    && record.code !== 'owner-feishu-route-reset'
    && record.code !== 'owner-feishu-route-disable'
    && record.code !== 'owner-feishu-route-verify'
    && record.code !== 'owner-feishu-task-list-bind'
    && record.code !== 'owner-feishu-task-reference'
    && record.code !== 'owner-feishu-task-update') {
    throw new TypeError('Audit reason code is unsupported')
  }
  return Object.freeze({ code: record.code })
}

function normalizeScope(value: unknown): AuditScope {
  const record = dataRecord(value, 'Audit scope')
  assertFields(record, ['organizationId', 'teamId', 'projectId'], [], 'Audit scope')
  return Object.freeze({
    organizationId: safeReference(record.organizationId, 'Audit organization id'),
    teamId: safeReference(record.teamId, 'Audit team id'),
    projectId: record.projectId === null
      ? null
      : safeReference(record.projectId, 'Audit project id'),
  })
}

function normalizeObjectReference(value: unknown): AuditObjectReference {
  const record = dataRecord(value, 'Audit object')
  assertFields(record, ['type', 'id', 'version'], [], 'Audit object')
  return Object.freeze({
    type: auditObjectType(record.type),
    id: safeReference(record.id, 'Audit object id'),
    version: positiveDecimal(record.version, 'Audit object version'),
  })
}

function normalizeCommandReference(value: unknown): AuditCommandReference {
  const record = dataRecord(value, 'Audit command')
  assertFields(record, ['id', 'type'], [], 'Audit command')
  return Object.freeze({
    id: safeReference(record.id, 'Audit command id'),
    type: auditCommandType(record.type),
  })
}

function normalizeCausationReference(value: unknown): AuditCausationReference {
  const record = dataRecord(value, 'Audit causation')
  assertFields(record, ['id'], [], 'Audit causation')
  return Object.freeze({ id: safeReference(record.id, 'Audit causation id') })
}

function normalizeOutboxReference(value: unknown): AuditOutboxReference {
  const record = dataRecord(value, 'Audit outbox reference')
  assertFields(record, ['id', 'state'], [], 'Audit outbox reference')
  const state = record.state
  if (state !== 'delivered' && state !== 'failed' && state !== 'pending' && state !== 'unknown') {
    throw new TypeError('Audit outbox state is unsupported')
  }
  return Object.freeze({ id: safeReference(record.id, 'Audit outbox id'), state })
}

function normalizeSummary(value: unknown): AuditSafeSummary {
  const record = dataRecord(value, 'Audit summary')
  assertFields(record, ['code', 'changedFields'], [], 'Audit summary')
  if (!Array.isArray(record.changedFields) || record.changedFields.length > MAX_CHANGED_FIELDS) {
    throw new TypeError('Audit summary changedFields must be a bounded array')
  }
  const changedFields = record.changedFields.map((field, index) => {
    if (typeof field !== 'string'
      || field.length > 128
      || !SAFE_FIELD_PATTERN.test(field)) {
      throw new TypeError(`Audit summary changedFields[${String(index)}] is unsafe`)
    }
    return field
  })
  if (new Set(changedFields).size !== changedFields.length) {
    throw new TypeError('Audit summary changedFields must be unique')
  }
  return Object.freeze({
    code: auditSummaryCode(record.code),
    changedFields: Object.freeze(changedFields),
  })
}

function auditOutcome(value: unknown): AuditOutcome {
  if (value !== 'committed' && value !== 'failed' && value !== 'rejected') {
    throw new TypeError('Audit outcome is unsupported')
  }
  return value
}

function auditAction(value: unknown): WorkbenchAuditAction {
  if (value !== 'workbench.status.updated'
    && value !== 'workbench.project.created'
    && value !== 'workbench.project-member.created'
    && value !== 'workbench.project-member.status-changed'
    && value !== 'workbench.project.responsibility-assigned'
    && value !== 'workbench.suggested-change.proposed'
    && value !== 'workbench.suggested-change.accepted'
    && value !== 'workbench.suggested-change.edited-accepted'
    && value !== 'workbench.suggested-change.rejected'
    && value !== 'workbench.suggested-change.deferred'
    && value !== 'workbench.feishu-route.configured'
    && value !== 'workbench.feishu-route.reset'
    && value !== 'workbench.feishu-route.disabled'
    && value !== 'workbench.feishu-route.verification-recorded'
    && value !== 'workbench.feishu-task-list.bound'
    && value !== 'workbench.feishu-task.referenced'
    && value !== 'workbench.feishu-task.update-requested') {
    throw new TypeError('Audit action is unsupported')
  }
  return value
}

function auditObjectType(value: unknown): WorkbenchAuditObjectType {
  if (value !== 'workbench-status'
    && value !== 'project'
    && value !== 'project-member'
    && value !== 'project-responsibility'
    && value !== 'suggested-change'
    && value !== 'feishu-connection'
    && value !== 'feishu-task-list-binding'
    && value !== 'feishu-task') {
    throw new TypeError('Audit object type is unsupported')
  }
  return value
}

function auditCommandType(value: unknown): AuditCommandReference['type'] {
  if (value !== 'workbench.status.set'
    && value !== 'workbench.project.create'
    && value !== 'workbench.project-member.add'
    && value !== 'workbench.project-member.set-status'
    && value !== 'workbench.project.set-responsibility'
    && value !== 'workbench.suggested-change.propose'
    && value !== 'workbench.suggested-change.accept'
    && value !== 'workbench.suggested-change.edit-accept'
    && value !== 'workbench.suggested-change.reject'
    && value !== 'workbench.suggested-change.defer'
    && value !== 'workbench.feishu-route.configure'
    && value !== 'workbench.feishu-route.reset'
    && value !== 'workbench.feishu-route.disable'
    && value !== 'workbench.feishu-route.verify'
    && value !== 'workbench.feishu-task-list.bind'
    && value !== 'workbench.feishu-task.reference'
    && value !== 'workbench.feishu-task.update') {
    throw new TypeError('Audit command type is unsupported')
  }
  return value
}

function auditSummaryCode(value: unknown): WorkbenchActivitySummaryCode {
  if (value !== 'status-revision-committed'
    && value !== 'project-created-from-template'
    && value !== 'project-member-created'
    && value !== 'project-member-status-changed'
    && value !== 'project-responsibility-assigned'
    && value !== 'suggested-change-proposed'
    && value !== 'suggested-change-accepted'
    && value !== 'suggested-change-edited-accepted'
    && value !== 'suggested-change-rejected'
    && value !== 'suggested-change-deferred'
    && value !== 'feishu-route-configured'
    && value !== 'feishu-route-reset'
    && value !== 'feishu-route-disabled'
    && value !== 'feishu-route-verification-healthy'
    && value !== 'feishu-route-verification-attention'
    && value !== 'feishu-route-verification-failed'
    && value !== 'feishu-task-list-bound'
    && value !== 'feishu-task-referenced'
    && value !== 'feishu-task-update-requested') {
    throw new TypeError('Audit summary code is unsupported')
  }
  return value
}

function assertCorrelatedVocabulary(
  action: WorkbenchAuditAction,
  reason: AuditReason,
  scope: AuditScope,
  object: AuditObjectReference,
  command: AuditCommandReference,
  summary: AuditSafeSummary,
): void {
  const correlated = (() => {
    switch (action) {
      case 'workbench.status.updated':
        return reason.code === 'owner-status-edit'
          && object.type === 'workbench-status'
          && command.type === 'workbench.status.set'
          && summary.code === 'status-revision-committed'
          && exactChangedFields(summary, ['message'])
          && scope.projectId === null
      case 'workbench.project.created':
        return reason.code === 'owner-project-create'
          && object.type === 'project'
          && command.type === 'workbench.project.create'
          && summary.code === 'project-created-from-template'
          && exactChangedFields(summary, [
            'primaryGoal',
            'outcomes',
            'supportingGoals',
            'templateSnapshot',
          ])
          && scope.projectId === object.id
      case 'workbench.project-member.created':
        return reason.code === 'owner-project-member-add'
          && object.type === 'project-member'
          && command.type === 'workbench.project-member.add'
          && summary.code === 'project-member-created'
          && exactChangedFields(summary, ['member', 'teamRevision'])
          && scope.projectId !== null
      case 'workbench.project-member.status-changed':
        return reason.code === 'owner-project-member-status-change'
          && object.type === 'project-member'
          && command.type === 'workbench.project-member.set-status'
          && summary.code === 'project-member-status-changed'
          && exactChangedFields(summary, ['status', 'teamRevision'])
          && scope.projectId !== null
      case 'workbench.project.responsibility-assigned':
        return reason.code === 'owner-project-responsibility-set'
          && object.type === 'project-responsibility'
          && command.type === 'workbench.project.set-responsibility'
          && summary.code === 'project-responsibility-assigned'
          && exactChangedFields(summary, [
            'accountable',
            'contributors',
            'humanSponsor',
            'teamRevision',
          ])
          && scope.projectId === object.id
      case 'workbench.suggested-change.proposed':
        return reason.code === 'owner-suggested-change-propose'
          && object.type === 'suggested-change'
          && command.type === 'workbench.suggested-change.propose'
          && summary.code === 'suggested-change-proposed'
          && exactChangedFields(summary, ['proposal', 'risk', 'evidence'])
          && scope.projectId !== null
      case 'workbench.suggested-change.accepted':
        return reason.code === 'owner-suggested-change-accept'
          && object.type === 'suggested-change'
          && command.type === 'workbench.suggested-change.accept'
          && summary.code === 'suggested-change-accepted'
          && exactChangedFields(summary, ['decision', 'target'])
          && scope.projectId !== null
      case 'workbench.suggested-change.edited-accepted':
        return reason.code === 'owner-suggested-change-edit-accept'
          && object.type === 'suggested-change'
          && command.type === 'workbench.suggested-change.edit-accept'
          && summary.code === 'suggested-change-edited-accepted'
          && exactChangedFields(summary, ['decision', 'target'])
          && scope.projectId !== null
      case 'workbench.suggested-change.rejected':
        return reason.code === 'owner-suggested-change-reject'
          && object.type === 'suggested-change'
          && command.type === 'workbench.suggested-change.reject'
          && summary.code === 'suggested-change-rejected'
          && exactChangedFields(summary, ['decision'])
          && scope.projectId !== null
      case 'workbench.suggested-change.deferred':
        return reason.code === 'owner-suggested-change-defer'
          && object.type === 'suggested-change'
          && command.type === 'workbench.suggested-change.defer'
          && summary.code === 'suggested-change-deferred'
          && exactChangedFields(summary, ['decision'])
          && scope.projectId !== null
      case 'workbench.feishu-route.configured':
        return reason.code === 'owner-feishu-route-configure'
          && object.type === 'feishu-connection'
          && command.type === 'workbench.feishu-route.configure'
          && summary.code === 'feishu-route-configured'
          && exactChangedFields(summary, ['route', 'credentialRef'])
          && scope.projectId === null
      case 'workbench.feishu-route.reset':
        return reason.code === 'owner-feishu-route-reset'
          && object.type === 'feishu-connection'
          && command.type === 'workbench.feishu-route.reset'
          && summary.code === 'feishu-route-reset'
          && exactChangedFields(summary, ['route', 'identityBinding'])
          && scope.projectId === null
      case 'workbench.feishu-route.disabled':
        return reason.code === 'owner-feishu-route-disable'
          && object.type === 'feishu-connection'
          && command.type === 'workbench.feishu-route.disable'
          && summary.code === 'feishu-route-disabled'
          && exactChangedFields(summary, ['route', 'state'])
          && scope.projectId === null
      case 'workbench.feishu-route.verification-recorded':
        return reason.code === 'owner-feishu-route-verify'
          && object.type === 'feishu-connection'
          && command.type === 'workbench.feishu-route.verify'
          && (summary.code === 'feishu-route-verification-healthy'
            || summary.code === 'feishu-route-verification-attention'
            || summary.code === 'feishu-route-verification-failed')
          && exactChangedFields(summary, ['verification'])
          && scope.projectId === null
      case 'workbench.feishu-task-list.bound':
        return reason.code === 'owner-feishu-task-list-bind'
          && object.type === 'feishu-task-list-binding'
          && command.type === 'workbench.feishu-task-list.bind'
          && summary.code === 'feishu-task-list-bound'
          && exactChangedFields(summary, ['taskList', 'tasks', 'sync'])
          && scope.projectId === object.id
      case 'workbench.feishu-task.referenced':
        return reason.code === 'owner-feishu-task-reference'
          && object.type === 'feishu-task'
          && command.type === 'workbench.feishu-task.reference'
          && summary.code === 'feishu-task-referenced'
          && exactChangedFields(summary, ['scope', 'task'])
          && scope.projectId !== null
      case 'workbench.feishu-task.update-requested':
        return reason.code === 'owner-feishu-task-update'
          && object.type === 'feishu-task'
          && command.type === 'workbench.feishu-task.update'
          && summary.code === 'feishu-task-update-requested'
          && exactChangedFields(summary, ['remoteVersion', 'changes', 'effectState'])
          && scope.projectId !== null
    }
  })()
  if (!correlated) {
    throw new AuditVocabularyCorrelationError(
      'Audit vocabulary is not a valid correlated combination',
    )
  }
}

function exactChangedFields(summary: AuditSafeSummary, expected: readonly string[]): boolean {
  return summary.changedFields.length === expected.length
    && summary.changedFields.every((field, index) => field === expected[index])
}

class AuditVocabularyCorrelationError extends TypeError {}

function safeReference(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  assertUnicode(value)
  if (value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || [...value].length > MAX_REFERENCE_CODE_POINTS
    || Buffer.byteLength(value, 'utf8') > MAX_REFERENCE_BYTES) {
    throw new TypeError(`${label} must be a bounded safe reference`)
  }
  return value
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Audit occurredAt must be a string')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError('Audit occurredAt must be a canonical ISO instant')
  }
  return value
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isPositiveDecimal(value)) {
    throw new TypeError(`${label} must be a positive canonical decimal string`)
  }
  return value
}

function isPositiveDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || !POSITIVE_DECIMAL_PATTERN.test(value)) return false
  try {
    return BigInt(value) <= MAX_SQLITE_INTEGER
  } catch {
    return false
  }
}

function auditHash(value: unknown, label: string): AuditHash {
  if (!isAuditHash(value)) throw new TypeError(`${label} is not a SHA-256 hash`)
  return value
}

function isAuditHash(value: unknown): value is AuditHash {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

function hashEnvelope(canonicalEnvelope: string): AuditHash {
  return `sha256:${createHash('sha256').update(canonicalEnvelope, 'utf8').digest('hex')}`
}

function canonicalEnvelopeVersion(canonicalEnvelope: string): unknown {
  const parsed: unknown = JSON.parse(canonicalEnvelope)
  if (canonicalizeJson(parsed) !== canonicalEnvelope) {
    throw new TypeError('Audit hash envelope is not canonical JSON')
  }
  return dataRecord(parsed, 'Audit hash envelope').version
}

function trustedHeadMatches(
  value: unknown,
  eventCount: number,
  headHash: AuditHash,
): boolean {
  try {
    const record = dataRecord(value, 'Trusted audit head')
    assertFields(record, ['eventCount', 'headHash'], [], 'Trusted audit head')
    return typeof record.eventCount === 'number'
      && Number.isSafeInteger(record.eventCount)
      && record.eventCount >= 0
      && record.eventCount === eventCount
      && isAuditHash(record.headHash)
      && record.headHash === headHash
  } catch {
    return false
  }
}

function integrityFailure(
  code: AuditIntegrityFailureCode,
  index: number,
  eventCount: number,
  headHash: AuditHash,
): AuditIntegrityResult {
  return Object.freeze({
    ok: false,
    eventCount,
    headHash,
    failure: Object.freeze({ code, index }),
  })
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number': {
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite')
      if (Object.is(value, -0)) throw new TypeError('Canonical JSON rejects negative zero')
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new TypeError('Value is not JSON serializable')
      return serialized
    }
    case 'string':
      assertUnicode(value)
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new TypeError('Value is outside the JSON data model')
  }

  if (ancestors.has(value)) throw new TypeError('Canonical JSON cannot contain cyclic values')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return serializeArray(value, ancestors)
    return serializeObject(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function serializeArray(value: readonly unknown[], ancestors: Set<object>): string {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Canonical JSON arrays cannot have symbol fields')
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1 || !names.includes('length')) {
    throw new TypeError('Canonical JSON arrays must be dense without extra fields')
  }
  const serialized: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Canonical JSON arrays must contain enumerable data elements')
    }
    serialized.push(serializeCanonical(descriptor.value, ancestors))
  }
  return `[${serialized.join(',')}]`
}

function serializeObject(value: object, ancestors: Set<object>): string {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Canonical JSON objects must be plain data objects')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Canonical JSON objects cannot have symbol fields')
  }
  const entries: Array<readonly [string, unknown]> = []
  for (const key of Object.getOwnPropertyNames(value)) {
    assertUnicode(key)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Canonical JSON objects must contain enumerable data fields')
    }
    entries.push([key, descriptor.value])
  }
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${serializeCanonical(child, ancestors)}`).join(',')}}`
}

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('Canonical JSON strings must contain valid Unicode')
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Canonical JSON strings must contain valid Unicode')
    }
  }
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a data object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain data object`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} cannot contain symbol fields`)
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain enumerable data fields`)
    }
    copy[key] = descriptor.value
  }
  return copy
}

function assertFields(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) throw new TypeError(`${label} has unsupported field ${field}`)
  }
  for (const field of required) {
    if (!Object.hasOwn(record, field)) throw new TypeError(`${label} is missing field ${field}`)
  }
}
