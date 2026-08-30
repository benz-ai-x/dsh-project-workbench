/** SQLite implementation of the transactional Workbench repository. */

import { createHash } from 'node:crypto'
import { open as openFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  SetStatusResult,
  WorkbenchActivityItem,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityIssue,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxErrorCode,
  WorkbenchOutboxState,
  WorkbenchStatusSnapshot,
} from './client.ts'
import {
  AUDIT_GENESIS_HASH,
  canonicalizeJson,
  createAuditEvent,
  verifyAuditChain as verifyAuditEvents,
  type AuditEvent,
  type AuditHash,
  type AuditIntegrityFailureCode,
} from './audit.ts'
import {
  statusResult,
  statusSnapshot,
  type WorkbenchActivityQuery,
  type WorkbenchOutboxClaim,
  type WorkbenchOutboxClaimRequest,
  type WorkbenchOutboxSettlement,
  type WorkbenchRepository,
  type WorkbenchStatusMutation,
} from './repository.ts'

export const WORKBENCH_SCHEMA_VERSION = 2
export const WORKBENCH_SQLITE_APPLICATION_ID = 0x44535742

const STATUS_COMMAND_TYPE = 'workbench.status.set'
const STATUS_AUDIT_ACTION = 'workbench.status.updated'
const STATUS_OBJECT_TYPE = 'workbench-status'
const STATUS_REASON = 'owner-status-edit'
const STATUS_SUMMARY = 'status-revision-committed'
const STATUS_OUTBOX_TOPIC = 'workbench.status.committed.v1'
const MAX_ACTIVITY_LIMIT = 100

export type WorkbenchJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

export interface SqliteWorkbenchRepositoryOptions {
  readonly databasePath: string
  readonly journalMode: WorkbenchJournalMode
  readonly busyTimeoutMs: number
  /** Trusted repository observation clock; injectable only for deterministic tests. */
  readonly now?: () => Date
}

interface StatusRow {
  readonly id: string
  readonly message: string
  readonly revision: number
  readonly updated_at: string
}

interface ReceiptRow {
  readonly command_type: string
  readonly request_hash: string
  readonly command_id: string
  readonly audit_event_id: string
  readonly outbox_id: string
  readonly result_json: string
}

interface ReceiptIntegrityRow extends ReceiptRow {
  readonly idempotency_key_hash: string
  readonly committed_at: string
  readonly audit_object_id: string
  readonly audit_object_version: number
  readonly audit_occurred_at: string
  readonly audit_causation_id: string
  readonly audit_command_id: string
  readonly audit_outbox_id: string | null
  readonly outbox_command_id: string
}

interface AuditHeadRow {
  readonly sequence: number
  readonly head_hash: string
}

interface AuditRow {
  readonly sequence: number
  readonly id: string
  readonly occurred_at: string
  readonly actor_kind: string
  readonly actor_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly project_id: string | null
  readonly action: string
  readonly reason_code: string
  readonly reason_detail: string | null
  readonly object_type: string
  readonly object_id: string
  readonly object_version: number
  readonly command_id: string
  readonly command_type: string
  readonly causation_id: string
  readonly outbox_id: string | null
  readonly outbox_state: string | null
  readonly outcome: string
  readonly summary_code: string
  readonly summary_fields_json: string
  readonly previous_hash: string
  readonly event_hash: string
  readonly canonical_envelope: string
}

interface ActivityRow {
  readonly sequence: number
  readonly event_id: string
  readonly occurred_at: string
  readonly actor_kind: string
  readonly actor_id: string
  readonly project_id: string | null
  readonly action: string
  readonly reason_code: string
  readonly object_type: string
  readonly object_id: string
  readonly object_version: number
  readonly causation_id: string
  readonly command_id: string
  readonly summary_code: string
  readonly previous_hash: string
  readonly event_hash: string
  readonly outbox_id: string
  readonly outbox_state: string
  readonly attempt_count: number
  readonly outbox_updated_at: string
  readonly error_code: string | null
}

interface OutboxClaimRow {
  readonly id: string
  readonly topic: string
  readonly effect_key: string
  readonly payload_json: string
  readonly causation_id: string
  readonly attempt_count: number
}

const JOURNAL_MODES = new Set<WorkbenchJournalMode>(['wal', 'delete', 'truncate', 'persist'])
const MAX_BUSY_TIMEOUT_MS = 2_147_483_647
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const SHA256_HEX = /^[0-9a-f]{64}$/u
const OUTBOX_ERROR_CODES = new Set<WorkbenchOutboxErrorCode>([
  'lease-expired',
  'transport-ambiguous',
  'definitive-rejection',
])
const REQUIRED_IMMUTABILITY_TRIGGERS = [
  'workbench_audit_event_no_update',
  'workbench_audit_event_no_delete',
  'workbench_outbox_intent_no_update',
  'workbench_outbox_no_delete',
  'workbench_command_receipt_no_update',
  'workbench_command_receipt_no_delete',
] as const

/** A single-connection repository whose write transaction body is wholly synchronous. */
export class SqliteWorkbenchRepository implements WorkbenchRepository {
  private readonly options: SqliteWorkbenchRepositoryOptions
  private database: DatabaseSync | undefined
  private opening: Promise<void> | undefined
  private closePromise: Promise<void> | undefined

  constructor(options: SqliteWorkbenchRepositoryOptions) {
    validateOptions(options)
    this.options = options
  }

  get closed(): boolean {
    return this.closePromise !== undefined && this.database === undefined
  }

  async open(): Promise<void> {
    if (this.closePromise !== undefined) throw new Error('workbench repository is closed')
    if (this.database !== undefined) return
    this.opening ??= this.openDatabase()
    return this.opening
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    throwIfAborted(signal)
    const row = readStatus(this.requireDatabase())
    throwIfAborted(signal)
    return row === null ? null : statusSnapshot(row)
  }

  async commitStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    throwIfAborted(signal)
    validateMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = digest(`project-workbench.idempotency.v1\0${mutation.command.idempotencyKey}`)
    const requestHash = statusRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = database.prepare(`
        SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
        FROM workbench_command_receipt
        WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
      `).get(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
      ) as ReceiptRow | undefined
      if (receipt !== undefined) {
        if (receipt.command_type !== STATUS_COMMAND_TYPE || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return idempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeCommittedResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const current = readStatus(database)
      const actualRevision = current?.revision ?? null
      if (actualRevision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return revisionConflict(mutation.expectedRevision, current)
      }
      if (current !== null && current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Workbench status revision exhausted')
      }

      const next: WorkbenchStatusSnapshot = current === null
        ? {
          id: mutation.candidateId,
          message: mutation.message,
          revision: 1,
          updatedAt: mutation.updatedAt,
        }
        : {
          id: current.id,
          message: mutation.message,
          revision: current.revision + 1,
          updatedAt: mutation.updatedAt,
        }
      writeStatus(database, next, current === null)

      const outboxPayload = canonicalizeJson({
        schemaVersion: 1,
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        statusId: next.id,
        statusRevision: next.revision,
        causationId: mutation.command.causationId,
      })
      insertOutbox(database, mutation, next, outboxPayload)

      const head = readAuditHead(database)
      if (head.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Workbench audit sequence exhausted')
      const sequence = head.sequence + 1
      const event = createAuditEvent({
        sequence: String(sequence),
        previousHash: auditHash(head.head_hash),
        auditId: mutation.command.auditEventId,
        occurredAt: mutation.command.occurredAt,
        actor: { kind: mutation.command.actor.kind, id: mutation.command.actor.id },
        action: STATUS_AUDIT_ACTION,
        scope: {
          organizationId: mutation.command.actor.organizationId,
          teamId: mutation.command.actor.teamId,
          projectId: null,
        },
        reason: { code: mutation.command.reason },
        object: { type: STATUS_OBJECT_TYPE, id: next.id, version: String(next.revision) },
        command: { id: mutation.command.commandId, type: STATUS_COMMAND_TYPE },
        causation: { id: mutation.command.causationId },
        outbox: { id: mutation.command.outboxId, state: 'pending' },
        outcome: 'committed',
        summary: { code: STATUS_SUMMARY, changedFields: ['message'] },
      })
      insertAuditEvent(database, event)
      const advanced = database.prepare(`
        UPDATE workbench_audit_head
        SET sequence = ?, head_hash = ?
        WHERE singleton = 1 AND sequence = ? AND head_hash = ?
      `).run(sequence, event.eventHash, head.sequence, head.head_hash)
      if (advanced.changes !== 1) throw new Error('Workbench audit head did not advance exactly once')

      const committed = statusResult({
        ok: true,
        value: next,
        receipt: {
          commandId: mutation.command.commandId,
          auditEventId: mutation.command.auditEventId,
          outboxId: mutation.command.outboxId,
        },
      })
      const resultJson = canonicalizeJson(committed)
      const saved = database.prepare(`
        INSERT INTO workbench_command_receipt (
          organization_id, actor_id, idempotency_key_hash, command_type,
          request_hash, command_id, audit_event_id, outbox_id, result_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
        STATUS_COMMAND_TYPE,
        requestHash,
        mutation.command.commandId,
        mutation.command.auditEventId,
        mutation.command.outboxId,
        resultJson,
        mutation.command.occurredAt,
      )
      if (saved.changes !== 1) throw new Error('Workbench command receipt was not inserted exactly once')

      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readActivity(
    query: WorkbenchActivityQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchActivityProjection> {
    throwIfAborted(signal)
    validateReference(query.organizationId, 'Activity organization id')
    const limit = query.filter.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT) {
      throw new TypeError(`Activity limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}`)
    }
    const where = ['audit.organization_id = ?']
    const parameters: Array<string | number> = [query.organizationId]
    if (query.filter.projectId === null) {
      where.push('audit.project_id IS NULL')
    } else if (query.filter.projectId !== undefined) {
      validateReference(query.filter.projectId, 'Activity project id')
      where.push('audit.project_id = ?')
      parameters.push(query.filter.projectId)
    }
    if (query.filter.objectType !== undefined) {
      where.push('audit.object_type = ?')
      parameters.push(query.filter.objectType)
    }
    if (query.filter.objectId !== undefined) {
      validateReference(query.filter.objectId, 'Activity object id')
      where.push('audit.object_id = ?')
      parameters.push(query.filter.objectId)
    }
    if (query.filter.action !== undefined) {
      where.push('audit.action = ?')
      parameters.push(query.filter.action)
    }
    if (query.filter.beforeSequence !== undefined) {
      if (!Number.isSafeInteger(query.filter.beforeSequence) || query.filter.beforeSequence < 1) {
        throw new TypeError('Activity beforeSequence must be a positive safe integer')
      }
      where.push('audit.sequence < ?')
      parameters.push(query.filter.beforeSequence)
    }
    parameters.push(limit + 1)
    const database = this.requireDatabase()
    let began = false
    try {
      // Bind filtered rows and ledger verification to one SQLite snapshot.
      database.exec('BEGIN')
      began = true
      const rows = database.prepare(`
        SELECT audit.sequence, audit.id AS event_id, audit.occurred_at,
          audit.actor_kind, audit.actor_id, audit.project_id, audit.action,
          audit.reason_code, audit.object_type, audit.object_id, audit.object_version,
          audit.causation_id, audit.command_id, audit.summary_code,
          audit.previous_hash, audit.event_hash, outbox.id AS outbox_id,
          outbox.state AS outbox_state, outbox.attempt_count,
          outbox.updated_at AS outbox_updated_at, outbox.error_code
        FROM workbench_audit_event AS audit
        INNER JOIN workbench_outbox AS outbox ON outbox.id = audit.outbox_id
        WHERE ${where.join(' AND ')}
        ORDER BY audit.sequence DESC
        LIMIT ?
      `).all(...parameters) as unknown as ActivityRow[]
      const integrity = verifyAuditChainSync(database)
      throwIfAborted(signal)
      const hasMore = rows.length > limit
      const visible = hasMore ? rows.slice(0, limit) : rows
      const items = Object.freeze(visible.map(activityItem))
      const projection = Object.freeze({
        items,
        nextBeforeSequence: hasMore ? items.at(-1)?.sequence ?? null : null,
        integrity,
      })
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async verifyAuditChain(signal: AbortSignal): Promise<WorkbenchAuditIntegrityProjection> {
    throwIfAborted(signal)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      const result = verifyAuditChainSync(database)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return result
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async claimOutbox(
    request: WorkbenchOutboxClaimRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchOutboxClaim | null> {
    throwIfAborted(signal)
    validateReference(request.claimToken, 'Outbox claim token')
    validateInstant(request.claimedAt, 'Outbox claimedAt')
    validateInstant(request.leaseExpiresAt, 'Outbox leaseExpiresAt')
    const observedAt = laterInstant(this.observedAt(), request.claimedAt)
    if (request.leaseExpiresAt <= observedAt) {
      throw new TypeError('Outbox leaseExpiresAt must be later than claimedAt')
    }
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      expireOutboxClaims(database, observedAt)
      const row = database.prepare(`
        SELECT id, topic, effect_key, payload_json, causation_id, attempt_count
        FROM workbench_outbox
        WHERE state = 'pending' AND claim_token IS NULL
        ORDER BY created_at, id
        LIMIT 1
      `).get() as OutboxClaimRow | undefined
      if (row === undefined) {
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return null
      }
      const claimed = database.prepare(`
        UPDATE workbench_outbox
        SET claim_token = ?, claimed_at = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, updated_at = ?, error_code = NULL
        WHERE id = ? AND state = 'pending' AND claim_token IS NULL
      `).run(
        request.claimToken, observedAt, request.leaseExpiresAt,
        observedAt, row.id,
      )
      if (claimed.changes !== 1) throw new Error('Workbench Outbox claim lost its write race')
      const projection = Object.freeze({
        id: stringValue(row.id, 'Outbox id'),
        topic: stringValue(row.topic, 'Outbox topic'),
        effectKey: stringValue(row.effect_key, 'Outbox effect key'),
        payload: stringValue(row.payload_json, 'Outbox payload'),
        causationId: stringValue(row.causation_id, 'Outbox causation id'),
        claimToken: request.claimToken,
        leaseExpiresAt: request.leaseExpiresAt,
        attemptCount: positiveInteger(row.attempt_count, 'Outbox attempt count', true) + 1,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async settleOutbox(
    settlement: WorkbenchOutboxSettlement,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    validateReference(settlement.outboxId, 'Outbox id')
    validateReference(settlement.claimToken, 'Outbox claim token')
    validateInstant(settlement.settledAt, 'Outbox settledAt')
    const observedAt = laterInstant(this.observedAt(), settlement.settledAt)
    if (settlement.state !== 'delivered'
      && settlement.state !== 'unknown'
      && settlement.state !== 'failed') {
      throw new TypeError('Outbox settlement state is unsupported')
    }
    if (settlement.state === 'delivered') {
      if (settlement.errorCode !== null) {
        throw new TypeError('Delivered Outbox settlement cannot contain an error code')
      }
    } else if (!isOutboxErrorCode(settlement.errorCode)
      || (settlement.state === 'unknown'
        && settlement.errorCode !== 'transport-ambiguous')
      || (settlement.state === 'failed'
        && settlement.errorCode !== 'definitive-rejection')) {
      throw new TypeError('Outbox settlement requires its allowlisted state error code')
    }
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      expireOutboxClaims(database, observedAt)
      const result = database.prepare(`
        UPDATE workbench_outbox
        SET state = ?, claim_token = NULL, lease_expires_at = NULL,
            updated_at = ?, error_code = ?
        WHERE id = ? AND state = 'pending' AND claim_token = ?
          AND claimed_at <= ? AND lease_expires_at > ?
      `).run(
        settlement.state, observedAt, settlement.errorCode,
        settlement.outboxId, settlement.claimToken,
        settlement.settledAt, observedAt,
      )
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return result.changes === 1
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.doClose()
    return this.closePromise
  }

  private async openDatabase(): Promise<void> {
    const actual = this.options.databasePath === ':memory:'
      ? ':memory:'
      : resolve(this.options.databasePath)
    if (actual !== ':memory:') {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await createDatabaseFile(actual)
    }
    if (this.closePromise !== undefined) return
    const database = new DatabaseSync(actual, { timeout: this.options.busyTimeoutMs })
    try {
      configureConnection(database, actual, this.options)
      migrate(database, actual)
      prepareLedger(database, this.observedAt())
      if (this.closePromise !== undefined) {
        database.close()
        return
      }
      this.database = database
    } catch (error: unknown) {
      database.close()
      throw error
    }
  }

  private async doClose(): Promise<void> {
    await this.opening?.catch(() => undefined)
    const database = this.database
    this.database = undefined
    database?.close()
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('workbench repository is not open')
    return this.database
  }

  /** A failed rollback makes the connection unusable; close it instead of accepting more work. */
  private rollbackAfterFailure(database: DatabaseSync, operationError: unknown): void {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      if (this.database === database) this.database = undefined
      this.closePromise ??= Promise.resolve()
      const failures = [operationError, rollbackError]
      try {
        database.close()
      } catch (closeError: unknown) {
        failures.push(closeError)
      }
      throw new AggregateError(
        failures,
        'Workbench transaction rollback failed; repository was closed',
      )
    }
  }

  private observedAt(): string {
    const value = (this.options.now ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
      throw new Error('Workbench repository clock returned an invalid instant')
    }
    return value.toISOString()
  }
}

/** Sweep startup leases and validate all related ledger rows under one writer snapshot. */
function prepareLedger(database: DatabaseSync, observedAt: string): void {
  let began = false
  try {
    database.exec('BEGIN IMMEDIATE')
    began = true
    expireOutboxClaims(database, observedAt)
    assertValidLedger(database)
    database.exec('COMMIT')
    began = false
  } catch (error: unknown) {
    if (began) rollback(database, error)
    throw error
  }
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await openFile(path, 'wx', 0o600)
    await handle.close()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function validateOptions(options: SqliteWorkbenchRepositoryOptions): void {
  if (typeof options.databasePath !== 'string'
    || options.databasePath.includes('\0')
    || options.databasePath.trim().length === 0) {
    throw new TypeError('databasePath must be a non-blank filesystem path or :memory:')
  }
  if (!JOURNAL_MODES.has(options.journalMode)) {
    throw new TypeError(`unsupported Workbench journal mode: ${String(options.journalMode)}`)
  }
  if (!Number.isSafeInteger(options.busyTimeoutMs)
    || options.busyTimeoutMs < 0
    || options.busyTimeoutMs > MAX_BUSY_TIMEOUT_MS) {
    throw new TypeError(`busyTimeoutMs must be an integer from 0 to ${MAX_BUSY_TIMEOUT_MS}`)
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('now must be a clock function')
  }
}

function configureConnection(
  database: DatabaseSync,
  path: string,
  options: SqliteWorkbenchRepositoryOptions,
): void {
  database.exec('PRAGMA trusted_schema = OFF')
  database.exec('PRAGMA mmap_size = 0')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA recursive_triggers = ON')
  database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs}`)
  const selected = stringField(
    database.prepare(`PRAGMA journal_mode = ${options.journalMode.toUpperCase()}`).get(),
    'journal_mode',
  ).toLowerCase()
  const expected = path === ':memory:' ? 'memory' : options.journalMode
  if (selected !== expected) {
    throw new Error(`Workbench database selected journal mode ${selected}, expected ${expected}`)
  }
  database.exec('PRAGMA synchronous = FULL')
  if (integerField(database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys') !== 1) {
    throw new Error('Workbench database could not enable foreign keys')
  }
  if (integerField(database.prepare('PRAGMA recursive_triggers').get(), 'recursive_triggers') !== 1) {
    throw new Error('Workbench database could not enable recursive triggers')
  }
  if (integerField(database.prepare('PRAGMA busy_timeout').get(), 'timeout')
    !== options.busyTimeoutMs) {
    throw new Error('Workbench database could not retain its busy timeout')
  }
}

function migrate(database: DatabaseSync, path: string): void {
  let began = false
  try {
    database.exec('BEGIN IMMEDIATE')
    began = true
    let version = integerField(database.prepare('PRAGMA user_version').get(), 'user_version')
    const applicationId = integerField(database.prepare('PRAGMA application_id').get(), 'application_id')
    const userObjectCount = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
    `).get(), 'count')
    if (version === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`Workbench database at "${path}" has an unversioned foreign schema`)
    }
    if (version > WORKBENCH_SCHEMA_VERSION) {
      throw new Error(
        `Workbench database at "${path}" has schema version ${version}, newer than ${WORKBENCH_SCHEMA_VERSION}`,
      )
    }
    if (version > 0 && applicationId !== WORKBENCH_SQLITE_APPLICATION_ID) {
      throw new Error(
        `Workbench database at "${path}" has application id ${applicationId}, expected ${WORKBENCH_SQLITE_APPLICATION_ID}`,
      )
    }
    while (version < WORKBENCH_SCHEMA_VERSION) {
      const nextVersion = version + 1
      applyMigration(database, nextVersion)
      database.exec(`PRAGMA user_version = ${nextVersion}`)
      version = nextVersion
    }
    database.exec(`PRAGMA application_id = ${WORKBENCH_SQLITE_APPLICATION_ID}`)
    validateSchema(database)
    database.exec('COMMIT')
    began = false
  } catch (error: unknown) {
    if (began) rollback(database, error)
    throw error
  }
}

function applyMigration(database: DatabaseSync, targetVersion: number): void {
  if (targetVersion === 1) {
    database.exec(`
      CREATE TABLE workbench_status (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL CHECK (length(id) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT
    `)
    return
  }
  if (targetVersion !== 2) throw new Error(`missing Workbench migration ${targetVersion}`)
  database.exec(`
    CREATE TABLE workbench_audit_head (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      head_hash TEXT NOT NULL CHECK (length(head_hash) = 71)
    ) STRICT;
    INSERT INTO workbench_audit_head VALUES (1, 0, '${AUDIT_GENESIS_HASH}');

    CREATE TABLE workbench_outbox (
      id TEXT PRIMARY KEY CHECK (length(id) > 0),
      command_id TEXT NOT NULL UNIQUE CHECK (length(command_id) > 0),
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      topic TEXT NOT NULL CHECK (length(topic) > 0),
      effect_key TEXT NOT NULL UNIQUE CHECK (length(effect_key) > 0),
      project_id TEXT,
      object_type TEXT NOT NULL CHECK (length(object_type) > 0),
      object_id TEXT NOT NULL CHECK (length(object_id) > 0),
      object_version INTEGER NOT NULL CHECK (object_version > 0),
      causation_id TEXT NOT NULL CHECK (length(causation_id) > 0),
      payload_json TEXT NOT NULL CHECK (length(payload_json) > 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'unknown', 'failed')),
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
      claim_token TEXT,
      claimed_at TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      error_code TEXT,
      CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL)),
      CHECK (claim_token IS NULL OR state = 'pending'),
      CHECK (
        (state IN ('pending', 'delivered') AND error_code IS NULL)
        OR (state = 'unknown' AND error_code IS NOT NULL
          AND error_code IN ('lease-expired', 'transport-ambiguous'))
        OR (state = 'failed' AND error_code IS NOT NULL
          AND error_code = 'definitive-rejection')
      )
    ) STRICT;

    CREATE TABLE workbench_audit_event (
      sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
      id TEXT NOT NULL UNIQUE CHECK (length(id) > 0),
      occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('anonymous', 'owner', 'system')),
      actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      team_id TEXT NOT NULL CHECK (length(team_id) > 0),
      project_id TEXT,
      action TEXT NOT NULL CHECK (length(action) > 0),
      reason_code TEXT NOT NULL CHECK (length(reason_code) > 0),
      reason_detail TEXT,
      object_type TEXT NOT NULL CHECK (length(object_type) > 0),
      object_id TEXT NOT NULL CHECK (length(object_id) > 0),
      object_version INTEGER NOT NULL CHECK (object_version > 0),
      command_id TEXT NOT NULL UNIQUE CHECK (length(command_id) > 0),
      command_type TEXT NOT NULL CHECK (length(command_type) > 0),
      causation_id TEXT NOT NULL CHECK (length(causation_id) > 0),
      outbox_id TEXT UNIQUE REFERENCES workbench_outbox(id),
      outbox_state TEXT CHECK (outbox_state IN ('pending', 'delivered', 'unknown', 'failed')),
      outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'failed', 'rejected')),
      summary_code TEXT NOT NULL CHECK (length(summary_code) > 0),
      summary_fields_json TEXT NOT NULL CHECK (length(summary_fields_json) > 0),
      previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 71),
      event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 71),
      canonical_envelope TEXT NOT NULL CHECK (length(canonical_envelope) > 0),
      CHECK ((outbox_id IS NULL) = (outbox_state IS NULL))
    ) STRICT;

    CREATE TABLE workbench_command_receipt (
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
      idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
      command_type TEXT NOT NULL CHECK (length(command_type) > 0),
      request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
      command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event(command_id),
      audit_event_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event(id),
      outbox_id TEXT NOT NULL UNIQUE REFERENCES workbench_outbox(id),
      result_json TEXT NOT NULL CHECK (length(result_json) > 0),
      committed_at TEXT NOT NULL CHECK (length(committed_at) > 0),
      PRIMARY KEY (organization_id, actor_id, idempotency_key_hash)
    ) STRICT;

    CREATE INDEX workbench_audit_project_sequence
      ON workbench_audit_event (organization_id, project_id, sequence DESC);
    CREATE INDEX workbench_audit_object_sequence
      ON workbench_audit_event (organization_id, object_type, object_id, sequence DESC);
    CREATE INDEX workbench_audit_action_sequence
      ON workbench_audit_event (organization_id, action, sequence DESC);
    CREATE INDEX workbench_outbox_state_created
      ON workbench_outbox (state, created_at, id);

    CREATE TRIGGER workbench_audit_event_no_update BEFORE UPDATE ON workbench_audit_event
    BEGIN SELECT RAISE(ABORT, 'workbench audit events are append-only'); END;
    CREATE TRIGGER workbench_audit_event_no_delete BEFORE DELETE ON workbench_audit_event
    BEGIN SELECT RAISE(ABORT, 'workbench audit events are append-only'); END;

    CREATE TRIGGER workbench_outbox_intent_no_update BEFORE UPDATE OF
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json, created_at
      ON workbench_outbox
    BEGIN SELECT RAISE(ABORT, 'workbench Outbox intent is immutable'); END;
    CREATE TRIGGER workbench_outbox_no_delete BEFORE DELETE ON workbench_outbox
    BEGIN SELECT RAISE(ABORT, 'workbench Outbox rows cannot be deleted'); END;

    CREATE TRIGGER workbench_command_receipt_no_update
      BEFORE UPDATE ON workbench_command_receipt
    BEGIN SELECT RAISE(ABORT, 'workbench command receipts are immutable'); END;
    CREATE TRIGGER workbench_command_receipt_no_delete
      BEFORE DELETE ON workbench_command_receipt
    BEGIN SELECT RAISE(ABORT, 'workbench command receipts cannot be deleted'); END
  `)
}

function validateSchema(database: DatabaseSync): void {
  database.prepare('SELECT id, message, revision, updated_at FROM workbench_status WHERE singleton = 1')
  database.prepare('SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1')
  database.prepare('SELECT id, state, payload_json FROM workbench_outbox LIMIT 1')
  database.prepare('SELECT id, event_hash, canonical_envelope FROM workbench_audit_event LIMIT 1')
  database.prepare('SELECT command_id, result_json FROM workbench_command_receipt LIMIT 1')
  const triggers = new Set((database.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'trigger'
  `).all() as Array<{ readonly name: string }>).map(row => row.name))
  for (const trigger of REQUIRED_IMMUTABILITY_TRIGGERS) {
    if (!triggers.has(trigger)) throw new Error(`Workbench database is missing trigger ${trigger}`)
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Workbench database contains broken foreign-key references')
  }
}

function readStatus(database: DatabaseSync): WorkbenchStatusSnapshot | null {
  const row = database.prepare(`
    SELECT id, message, revision, updated_at FROM workbench_status WHERE singleton = 1
  `).get() as StatusRow | undefined
  if (row === undefined) return null
  if (typeof row.id !== 'string' || row.id.length === 0
    || typeof row.message !== 'string' || row.message.length === 0
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.updated_at !== 'string' || !isIsoInstant(row.updated_at)) {
    throw new Error('Workbench database contains an invalid status projection')
  }
  return { id: row.id, message: row.message, revision: row.revision, updatedAt: row.updated_at }
}

function writeStatus(
  database: DatabaseSync,
  value: WorkbenchStatusSnapshot,
  create: boolean,
): void {
  const statement: StatementSync = create
    ? database.prepare(`INSERT INTO workbench_status VALUES (1, ?, ?, ?, ?)`)
    : database.prepare(`
      UPDATE workbench_status SET message = ?, revision = ?, updated_at = ? WHERE singleton = 1
    `)
  const result = create
    ? statement.run(value.id, value.message, value.revision, value.updatedAt)
    : statement.run(value.message, value.revision, value.updatedAt)
  if (result.changes !== 1) throw new Error('Workbench status mutation did not affect exactly one row')
}

function insertOutbox(
  database: DatabaseSync,
  mutation: WorkbenchStatusMutation,
  next: WorkbenchStatusSnapshot,
  payload: string,
): void {
  const result = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    mutation.command.outboxId, mutation.command.commandId,
    mutation.command.actor.organizationId, STATUS_OUTBOX_TOPIC,
    `workbench:${mutation.command.outboxId}`, STATUS_OBJECT_TYPE, next.id,
    next.revision, mutation.command.causationId, payload,
    mutation.command.occurredAt, mutation.command.occurredAt,
  )
  if (result.changes !== 1) throw new Error('Workbench Outbox intent was not inserted exactly once')
}

function insertAuditEvent(database: DatabaseSync, event: AuditEvent): void {
  const result = database.prepare(`
    INSERT INTO workbench_audit_event (
      sequence, id, occurred_at, actor_kind, actor_id, organization_id, team_id,
      project_id, action, reason_code, reason_detail, object_type, object_id,
      object_version, command_id, command_type, causation_id, outbox_id,
      outbox_state, outcome, summary_code, summary_fields_json, previous_hash,
      event_hash, canonical_envelope
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(event.sequence), event.auditId, event.occurredAt, event.actor.kind,
    event.actor.id, event.scope.organizationId, event.scope.teamId,
    event.scope.projectId, event.action, event.reason.code,
    event.reason.detail ?? null, event.object.type, event.object.id,
    Number(event.object.version), event.command.id, event.command.type,
    event.causation.id, event.outbox?.id ?? null, event.outbox?.state ?? null,
    event.outcome, event.summary.code, canonicalizeJson(event.summary.changedFields),
    event.previousHash, event.eventHash, event.canonicalEnvelope,
  )
  if (result.changes !== 1) throw new Error('Workbench audit event was not inserted exactly once')
}

/** Resolve every elapsed in-flight attempt to an explicit ambiguous outcome. */
function expireOutboxClaims(database: DatabaseSync, observedAt: string): void {
  database.prepare(`
    UPDATE workbench_outbox
    SET state = 'unknown', claim_token = NULL, lease_expires_at = NULL,
        updated_at = ?, error_code = 'lease-expired'
    WHERE state = 'pending' AND claim_token IS NOT NULL AND lease_expires_at <= ?
  `).run(observedAt, observedAt)
}

function readAuditHead(database: DatabaseSync): AuditHeadRow {
  const row = database.prepare(`
    SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1
  `).get() as AuditHeadRow | undefined
  if (row === undefined || !Number.isSafeInteger(row.sequence) || row.sequence < 0
    || typeof row.head_hash !== 'string') {
    throw new Error('Workbench database contains an invalid audit head')
  }
  auditHash(row.head_hash)
  return row
}

function readAuditEvents(database: DatabaseSync): readonly AuditEvent[] {
  const rows = database.prepare(`
    SELECT sequence, id, occurred_at, actor_kind, actor_id, organization_id,
      team_id, project_id, action, reason_code, reason_detail, object_type,
      object_id, object_version, command_id, command_type, causation_id,
      outbox_id, outbox_state, outcome, summary_code, summary_fields_json,
      previous_hash, event_hash, canonical_envelope
    FROM workbench_audit_event ORDER BY sequence
  `).all() as unknown as AuditRow[]
  return rows.map(row => auditEventFromRow(row))
}

function auditEventFromRow(row: AuditRow): AuditEvent {
  const changedFields = JSON.parse(stringValue(row.summary_fields_json, 'Audit summary fields')) as unknown
  if (!Array.isArray(changedFields)
    || changedFields.length !== 1
    || changedFields[0] !== 'message') {
    throw new Error('Workbench database contains invalid audit summary fields')
  }
  const reasonDetail = nullableString(row.reason_detail, 'Audit reason detail')
  const outboxId = nullableString(row.outbox_id, 'Audit Outbox id')
  const outboxStateValue = nullableString(row.outbox_state, 'Audit Outbox state')
  if (row.actor_kind !== 'owner'
    || row.action !== STATUS_AUDIT_ACTION
    || row.reason_code !== STATUS_REASON
    || reasonDetail !== null
    || row.object_type !== STATUS_OBJECT_TYPE
    || row.command_type !== STATUS_COMMAND_TYPE
    || row.outcome !== 'committed'
    || row.summary_code !== STATUS_SUMMARY
    || outboxStateValue !== 'pending') {
    throw new Error('Workbench database contains unsupported T03 audit fields')
  }
  return {
    sequence: String(positiveInteger(row.sequence, 'Audit sequence')),
    previousHash: auditHash(stringValue(row.previous_hash, 'Audit previous hash')),
    auditId: stringValue(row.id, 'Audit id'),
    occurredAt: stringValue(row.occurred_at, 'Audit occurredAt'),
    actor: { kind: 'owner', id: stringValue(row.actor_id, 'Audit actor id') },
    action: STATUS_AUDIT_ACTION,
    scope: {
      organizationId: stringValue(row.organization_id, 'Audit organization id'),
      teamId: stringValue(row.team_id, 'Audit team id'),
      projectId: nullableString(row.project_id, 'Audit project id'),
    },
    reason: { code: STATUS_REASON },
    object: {
      type: STATUS_OBJECT_TYPE,
      id: stringValue(row.object_id, 'Audit object id'),
      version: String(positiveInteger(row.object_version, 'Audit object version')),
    },
    command: {
      id: stringValue(row.command_id, 'Audit command id'),
      type: STATUS_COMMAND_TYPE,
    },
    causation: { id: stringValue(row.causation_id, 'Audit causation id') },
    outbox: outboxId === null
      ? null
      : { id: outboxId, state: outboxState(outboxStateValue) },
    outcome: 'committed',
    summary: {
      code: STATUS_SUMMARY,
      changedFields: Object.freeze(['message']),
    },
    eventHash: auditHash(stringValue(row.event_hash, 'Audit event hash')),
    canonicalEnvelope: stringValue(row.canonical_envelope, 'Audit canonical envelope'),
  }
}

function verifyAuditChainSync(database: DatabaseSync): WorkbenchAuditIntegrityProjection {
  try {
    const head = readAuditHead(database)
    const result = verifyAuditEvents(readAuditEvents(database), {
      eventCount: head.sequence,
      headHash: auditHash(head.head_hash),
    })
    return result.ok
      ? Object.freeze({
        valid: true, eventCount: result.eventCount, headHash: result.headHash, issue: null,
      })
      : Object.freeze({
        valid: false, eventCount: result.eventCount, headHash: result.headHash,
        issue: publicIntegrityIssue(result.failure.code),
      })
  } catch {
    return Object.freeze({
      valid: false, eventCount: 0, headHash: AUDIT_GENESIS_HASH, issue: 'invalid-event',
    })
  }
}

function assertValidAudit(database: DatabaseSync): void {
  const integrity = verifyAuditChainSync(database)
  if (!integrity.valid) {
    throw new Error(`Workbench database audit chain is invalid: ${String(integrity.issue)}`)
  }
}

function assertValidLedger(database: DatabaseSync): void {
  assertValidAudit(database)
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workbench_audit_event) AS audit_count,
      (SELECT COUNT(*) FROM workbench_outbox) AS outbox_count,
      (SELECT COUNT(*) FROM workbench_command_receipt) AS receipt_count
  `).get()
  const auditCount = integerField(counts, 'audit_count')
  const outboxCount = integerField(counts, 'outbox_count')
  const receiptCount = integerField(counts, 'receipt_count')
  if (auditCount !== outboxCount || auditCount !== receiptCount) {
    throw new Error('Workbench command ledger contains incomplete durable artifacts')
  }

  const rows = database.prepare(`
    SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
      receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
      receipt.idempotency_key_hash, receipt.committed_at,
      audit.object_id AS audit_object_id,
      audit.object_version AS audit_object_version,
      audit.occurred_at AS audit_occurred_at,
      audit.causation_id AS audit_causation_id,
      audit.command_id AS audit_command_id,
      audit.outbox_id AS audit_outbox_id,
      outbox.command_id AS outbox_command_id
    FROM workbench_command_receipt AS receipt
    INNER JOIN workbench_audit_event AS audit ON audit.id = receipt.audit_event_id
    INNER JOIN workbench_outbox AS outbox ON outbox.id = receipt.outbox_id
  `).all() as unknown as ReceiptIntegrityRow[]
  if (rows.length !== receiptCount) {
    throw new Error('Workbench command ledger contains broken durable references')
  }
  for (const row of rows) assertValidCommandReceipt(row)
}

function assertValidCommandReceipt(row: ReceiptIntegrityRow): void {
  if (row.command_type !== STATUS_COMMAND_TYPE
    || !SHA256_HEX.test(row.request_hash)
    || !SHA256_HEX.test(row.idempotency_key_hash)
    || row.command_id !== row.audit_command_id
    || row.command_id !== row.outbox_command_id
    || row.outbox_id !== row.audit_outbox_id
    || row.committed_at !== row.audit_occurred_at) {
    throw new Error('Workbench command receipt does not match its audit and Outbox facts')
  }
  const decoded = decodeCommittedResult(row.result_json, row)
  if (!decoded.ok) throw new Error('Workbench command receipt is not committed')
  if (decoded.value.id !== row.audit_object_id
    || decoded.value.revision !== row.audit_object_version
    || decoded.value.updatedAt !== row.audit_occurred_at) {
    throw new Error('Workbench command receipt projection does not match its audit object')
  }
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: STATUS_COMMAND_TYPE,
    target: STATUS_OBJECT_TYPE,
    message: decoded.value.message,
    expectedRevision: decoded.value.revision === 1 ? null : decoded.value.revision - 1,
    reason: STATUS_REASON,
    causationId: row.audit_causation_id,
  }))
  if (row.request_hash !== expectedRequestHash) {
    throw new Error('Workbench command receipt projection does not match its request hash')
  }
}

function publicIntegrityIssue(code: AuditIntegrityFailureCode): WorkbenchAuditIntegrityIssue {
  switch (code) {
    case 'sequence-mismatch': return 'sequence-gap'
    case 'previous-hash-mismatch': return 'previous-hash-mismatch'
    case 'event-hash-mismatch': return 'event-hash-mismatch'
    case 'tail-checkpoint-mismatch': return 'head-mismatch'
    case 'canonical-envelope-mismatch':
    case 'malformed-event': return 'invalid-event'
    case 'unsupported-format': return 'unsupported-format'
  }
}

function activityItem(row: ActivityRow): WorkbenchActivityItem {
  if (row.actor_kind !== 'owner' || row.action !== STATUS_AUDIT_ACTION
    || row.reason_code !== STATUS_REASON || row.object_type !== STATUS_OBJECT_TYPE
    || row.summary_code !== STATUS_SUMMARY) {
    throw new Error('Workbench database contains an unsupported Activity row')
  }
  const errorCode = nullableString(row.error_code, 'Activity error code')
  if (errorCode !== null && !isOutboxErrorCode(errorCode)) {
    throw new Error('Workbench database contains an unsafe Outbox error code')
  }
  const state = outboxState(row.outbox_state)
  if (((state === 'pending' || state === 'delivered') && errorCode !== null)
    || (state === 'unknown'
      && errorCode !== 'lease-expired'
      && errorCode !== 'transport-ambiguous')
    || (state === 'failed' && errorCode !== 'definitive-rejection')) {
    throw new Error('Workbench database contains an inconsistent Outbox outcome')
  }
  return Object.freeze({
    sequence: positiveInteger(row.sequence, 'Activity sequence'),
    eventId: stringValue(row.event_id, 'Activity event id'),
    occurredAt: canonicalInstant(row.occurred_at, 'Activity occurredAt'),
    actor: Object.freeze({ kind: 'owner', id: stringValue(row.actor_id, 'Activity actor id') }),
    projectId: nullableString(row.project_id, 'Activity project id'),
    action: STATUS_AUDIT_ACTION,
    reason: STATUS_REASON,
    object: Object.freeze({
      type: STATUS_OBJECT_TYPE,
      id: stringValue(row.object_id, 'Activity object id'),
      version: positiveInteger(row.object_version, 'Activity object version'),
    }),
    causationId: stringValue(row.causation_id, 'Activity causation id'),
    commandId: stringValue(row.command_id, 'Activity command id'),
    summaryCode: STATUS_SUMMARY,
    hash: auditHash(stringValue(row.event_hash, 'Activity event hash')),
    previousHash: auditHash(stringValue(row.previous_hash, 'Activity previous hash')),
    outbox: Object.freeze({
      id: stringValue(row.outbox_id, 'Activity Outbox id'),
      state,
      attemptCount: positiveInteger(row.attempt_count, 'Activity attempt count', true),
      updatedAt: canonicalInstant(row.outbox_updated_at, 'Activity Outbox updatedAt'),
      errorCode,
    }),
  })
}

function isOutboxErrorCode(value: unknown): value is WorkbenchOutboxErrorCode {
  return typeof value === 'string'
    && OUTBOX_ERROR_CODES.has(value as WorkbenchOutboxErrorCode)
}

function statusRequestHash(mutation: WorkbenchStatusMutation): string {
  return digest(canonicalizeJson({
    commandType: STATUS_COMMAND_TYPE,
    target: STATUS_OBJECT_TYPE,
    message: mutation.message,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function validateMutation(mutation: WorkbenchStatusMutation): void {
  validateReference(mutation.candidateId, 'Status candidate id')
  if (typeof mutation.message !== 'string' || mutation.message.length === 0) {
    throw new TypeError('Status message must be non-empty')
  }
  if (mutation.expectedRevision !== null
    && (!Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 1)) {
    throw new TypeError('Status expected revision is invalid')
  }
  validateInstant(mutation.updatedAt, 'Status updatedAt')
  if (mutation.command.reason !== STATUS_REASON) throw new TypeError('Status reason is unsupported')
  for (const [label, value] of [
    ['Command id', mutation.command.commandId],
    ['Audit event id', mutation.command.auditEventId],
    ['Outbox id', mutation.command.outboxId],
    ['Idempotency key', mutation.command.idempotencyKey],
    ['Causation id', mutation.command.causationId],
    ['Actor id', mutation.command.actor.id],
    ['Organization id', mutation.command.actor.organizationId],
    ['Team id', mutation.command.actor.teamId],
  ] as const) validateReference(value, label)
  if (mutation.command.actor.kind !== 'owner') throw new TypeError('Status actor must be owner')
  validateInstant(mutation.command.occurredAt, 'Command occurredAt')
  if (mutation.command.occurredAt !== mutation.updatedAt) {
    throw new TypeError('Status and command instants must match')
  }
}

function decodeCommittedResult(value: string, stored?: Pick<
ReceiptRow,
'command_id' | 'audit_event_id' | 'outbox_id'
>): SetStatusResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Workbench command receipt contains invalid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Reflect.get(parsed, 'ok') !== true) {
    throw new Error('Workbench command receipt is not a committed result')
  }
  const snapshot = Reflect.get(parsed, 'value')
  const receipt = Reflect.get(parsed, 'receipt')
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)
    || typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    throw new Error('Workbench command receipt is malformed')
  }
  const result = statusResult({
    ok: true,
    value: {
      id: stringValue(Reflect.get(snapshot, 'id'), 'Receipt status id'),
      message: stringValue(Reflect.get(snapshot, 'message'), 'Receipt status message'),
      revision: positiveInteger(Reflect.get(snapshot, 'revision'), 'Receipt status revision'),
      updatedAt: canonicalInstant(Reflect.get(snapshot, 'updatedAt'), 'Receipt status updatedAt'),
    },
    receipt: {
      commandId: stringValue(Reflect.get(receipt, 'commandId'), 'Receipt command id'),
      auditEventId: stringValue(Reflect.get(receipt, 'auditEventId'), 'Receipt audit event id'),
      outboxId: stringValue(Reflect.get(receipt, 'outboxId'), 'Receipt Outbox id'),
    },
  })
  if (!result.ok) throw new Error('Workbench command receipt is not committed')
  if (stored !== undefined
    && (result.receipt.commandId !== stored.command_id
      || result.receipt.auditEventId !== stored.audit_event_id
      || result.receipt.outboxId !== stored.outbox_id)) {
    throw new Error('Workbench command receipt identities do not match their durable references')
  }
  return result
}

function revisionConflict(
  expected: number | null,
  current: WorkbenchStatusSnapshot | null,
): SetStatusResult {
  const actual = current?.revision ?? null
  return statusResult({
    ok: false,
    error: {
      code: 'revision-conflict',
      message: `Workbench status revision changed (expected ${String(expected)}, current ${String(actual)})`,
      current,
    },
  })
}

function idempotencyConflict(): SetStatusResult {
  return statusResult({
    ok: false,
    error: {
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    },
  })
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function auditHash(value: string): AuditHash {
  if (!value.startsWith('sha256:') || !SHA256_HEX.test(value.slice(7))) {
    throw new Error('Workbench database contains an invalid audit hash')
  }
  return value as AuditHash
}

function outboxState(value: unknown): WorkbenchOutboxState {
  if (value !== 'pending' && value !== 'delivered' && value !== 'unknown' && value !== 'failed') {
    throw new Error('Workbench database contains an invalid Outbox state')
  }
  return value
}

function rollback(database: DatabaseSync, operationError: unknown): void {
  try {
    database.exec('ROLLBACK')
  } catch (rollbackError: unknown) {
    throw new AggregateError(
      [operationError, rollbackError],
      'Workbench migration rollback failed',
    )
  }
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is not a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
  }
  return value
}

function integerField(value: unknown, key: string): number {
  return positiveInteger(recordField(value, key), `SQLite field ${key}`, true)
}

function stringField(value: unknown, key: string): string {
  return stringValue(recordField(value, key), `SQLite field ${key}`)
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return stringValue(value, label)
}

function recordField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SQLite did not return a row object')
  }
  return Reflect.get(value, key)
}

function validateReference(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) {
    throw new TypeError(`${label} must be a bounded safe identifier`)
  }
}

function validateInstant(value: string, label: string): void {
  if (typeof value !== 'string' || !isIsoInstant(value)) {
    throw new TypeError(`${label} must be a canonical ISO instant`)
  }
}

function canonicalInstant(value: unknown, label: string): string {
  const result = stringValue(value, label)
  validateInstant(result, label)
  return result
}

function isIsoInstant(value: string): boolean {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function laterInstant(left: string, right: string): string {
  return left >= right ? left : right
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'))
}
