/** SQLite implementation of the portable Workbench repository. */

import { open as openFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from './client.ts'
import {
  statusResult,
  statusSnapshot,
  type WorkbenchRepository,
  type WorkbenchStatusMutation,
} from './repository.ts'

/** Current physical layout version for the Workbench-owned database. */
export const WORKBENCH_SCHEMA_VERSION = 1
/** SQLite application id spelling `DSWB`, used to reject a foreign database. */
export const WORKBENCH_SQLITE_APPLICATION_ID = 0x44535742

/** Durable journal modes supported by the Workbench SQLite provider. */
export type WorkbenchJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** SQLite-only construction settings kept outside the repository contract. */
export interface SqliteWorkbenchRepositoryOptions {
  readonly databasePath: string
  readonly journalMode: WorkbenchJournalMode
  readonly busyTimeoutMs: number
}

interface StatusRow {
  readonly id: string
  readonly message: string
  readonly revision: number
  readonly updated_at: string
}

const JOURNAL_MODES = new Set<WorkbenchJournalMode>(['wal', 'delete', 'truncate', 'persist'])
const MAX_BUSY_TIMEOUT_MS = 2_147_483_647

/** A single-connection, migration-owned SQLite repository. */
export class SqliteWorkbenchRepository implements WorkbenchRepository {
  private readonly options: SqliteWorkbenchRepositoryOptions
  private database: DatabaseSync | undefined
  private opening: Promise<void> | undefined
  private closePromise: Promise<void> | undefined

  constructor(options: SqliteWorkbenchRepositoryOptions) {
    validateOptions(options)
    this.options = options
  }

  /** Whether the repository has completed terminal teardown. */
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

  async setStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    throwIfAborted(signal)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const current = readStatus(database)
      const actualRevision = current?.revision ?? null
      if (actualRevision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return revisionConflict(mutation.expectedRevision, current)
      }
      throwIfAborted(signal)
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
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return statusResult({ ok: true, value: next })
    } catch (error: unknown) {
      if (began) rollback(database)
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
}

/** Create a missing database file owner-only without changing an existing file's mode. */
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
}

function configureConnection(
  database: DatabaseSync,
  path: string,
  options: SqliteWorkbenchRepositoryOptions,
): void {
  database.exec('PRAGMA trusted_schema = OFF')
  database.exec('PRAGMA mmap_size = 0')
  database.exec('PRAGMA foreign_keys = ON')
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
      SELECT COUNT(*) AS count
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
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
    if (began) rollback(database)
    throw error
  }
}

function applyMigration(database: DatabaseSync, targetVersion: number): void {
  if (targetVersion !== 1) throw new Error(`missing Workbench migration ${targetVersion}`)
  database.exec(`
    CREATE TABLE workbench_status (
      singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
      id         TEXT NOT NULL CHECK (length(id) > 0),
      message    TEXT NOT NULL CHECK (length(message) > 0),
      revision   INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
    ) STRICT
  `)
}

function validateSchema(database: DatabaseSync): void {
  database.prepare(`
    SELECT id, message, revision, updated_at
    FROM workbench_status
    WHERE singleton = 1
  `)
}

function readStatus(database: DatabaseSync): WorkbenchStatusSnapshot | null {
  const row = database.prepare(`
    SELECT id, message, revision, updated_at
    FROM workbench_status
    WHERE singleton = 1
  `).get() as StatusRow | undefined
  if (row === undefined) return null
  if (typeof row.id !== 'string' || row.id.length === 0
    || typeof row.message !== 'string' || row.message.length === 0
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.updated_at !== 'string' || !isIsoInstant(row.updated_at)) {
    throw new Error('Workbench database contains an invalid status projection')
  }
  return {
    id: row.id,
    message: row.message,
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

function writeStatus(
  database: DatabaseSync,
  value: WorkbenchStatusSnapshot,
  create: boolean,
): void {
  const statement: StatementSync = create
    ? database.prepare(`
      INSERT INTO workbench_status (singleton, id, message, revision, updated_at)
      VALUES (1, ?, ?, ?, ?)
    `)
    : database.prepare(`
      UPDATE workbench_status
      SET message = ?, revision = ?, updated_at = ?
      WHERE singleton = 1
    `)
  const result = create
    ? statement.run(value.id, value.message, value.revision, value.updatedAt)
    : statement.run(value.message, value.revision, value.updatedAt)
  if (result.changes !== 1) throw new Error('Workbench status mutation did not affect exactly one row')
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

function rollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK')
  } catch {
    // Keep the original mutation or migration failure.
  }
}

function integerField(value: unknown, key: string): number {
  const field = recordField(value, key)
  if (typeof field !== 'number' || !Number.isSafeInteger(field)) {
    throw new Error(`SQLite field ${key} is not a safe integer`)
  }
  return field
}

function stringField(value: unknown, key: string): string {
  const field = recordField(value, key)
  if (typeof field !== 'string') throw new Error(`SQLite field ${key} is not a string`)
  return field
}

function recordField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SQLite did not return a row object')
  }
  return Reflect.get(value, key)
}

function isIsoInstant(value: string): boolean {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'))
}
