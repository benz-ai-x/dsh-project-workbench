import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_SQLITE_APPLICATION_ID,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  roots.push(root)
  return join(root, 'nested', 'workbench.sqlite')
}

function repository(path: string): SqliteWorkbenchRepository {
  return new SqliteWorkbenchRepository({
    databasePath: path,
    journalMode: 'wal',
    busyTimeoutMs: 1_234,
  })
}

describe('SqliteWorkbenchRepository', () => {
  it('migrates a fresh database and configures WAL, foreign keys, and busy timeout', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()

    const connection = Reflect.get(workbench, 'database') as DatabaseSync
    expect(connection.prepare('PRAGMA user_version').get()).toEqual({
      user_version: WORKBENCH_SCHEMA_VERSION,
    })
    expect(connection.prepare('PRAGMA application_id').get()).toEqual({
      application_id: WORKBENCH_SQLITE_APPLICATION_ID,
    })
    expect(connection.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(connection.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(connection.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 1_234 })
    await expect(workbench.snapshot(new AbortController().signal)).resolves.toBeNull()

    await workbench.close()
    expect(workbench.closed).toBe(true)
  })

  it('persists the singleton projection across repository restart', async () => {
    const path = await databasePath()
    const first = repository(path)
    await first.open()
    await expect(first.setStatus({
      candidateId: 'status-durable',
      message: 'Durable state',
      expectedRevision: null,
      updatedAt: '2026-08-31T01:02:03.000Z',
    }, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-durable',
        message: 'Durable state',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
    })
    await first.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.snapshot(new AbortController().signal)).resolves.toEqual({
      id: 'status-durable',
      message: 'Durable state',
      revision: 1,
      updatedAt: '2026-08-31T01:02:03.000Z',
    })
    await restarted.close()
  })

  it('commits one stale-writer winner and returns the current row to the loser', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const signal = new AbortController().signal
    const created = await workbench.setStatus({
      candidateId: 'status-one',
      message: 'Initial',
      expectedRevision: null,
      updatedAt: '2026-08-31T01:00:00.000Z',
    }, signal)
    expect(created.ok).toBe(true)

    const [winner, loser] = await Promise.all([
      workbench.setStatus({
        candidateId: 'ignored-a',
        message: 'Winner',
        expectedRevision: 1,
        updatedAt: '2026-08-31T02:00:00.000Z',
      }, signal),
      workbench.setStatus({
        candidateId: 'ignored-b',
        message: 'Loser',
        expectedRevision: 1,
        updatedAt: '2026-08-31T03:00:00.000Z',
      }, signal),
    ])
    expect(winner).toEqual({
      ok: true,
      value: {
        id: 'status-one',
        message: 'Winner',
        revision: 2,
        updatedAt: '2026-08-31T02:00:00.000Z',
      },
    })
    expect(loser).toEqual({
      ok: false,
      error: {
        code: 'revision-conflict',
        message: 'Workbench status revision changed (expected 1, current 2)',
        current: winner.ok ? winner.value : null,
      },
    })
    await workbench.close()
  })

  it('rejects a newer schema and releases the failed-open handle', async () => {
    const path = await databasePath()
    await mkdir(dirname(path), { recursive: true })
    const incompatible = new DatabaseSync(path)
    incompatible.exec(`PRAGMA user_version = ${WORKBENCH_SCHEMA_VERSION + 1}`)
    incompatible.exec(`PRAGMA application_id = ${WORKBENCH_SQLITE_APPLICATION_ID}`)
    incompatible.close()

    const workbench = repository(path)
    await expect(workbench.open()).rejects.toThrow(/newer than/u)
    await workbench.close()
    expect(workbench.closed).toBe(true)

    const proof = new DatabaseSync(path)
    proof.exec(`PRAGMA user_version = ${WORKBENCH_SCHEMA_VERSION}`)
    proof.close()
  })

  it('does not mutate after caller cancellation or terminal close', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const cancelled = new AbortController()
    cancelled.abort(new Error('caller left'))
    await expect(workbench.setStatus({
      candidateId: 'status-cancelled',
      message: 'Must not commit',
      expectedRevision: null,
      updatedAt: '2026-08-31T01:00:00.000Z',
    }, cancelled.signal)).rejects.toThrow('caller left')
    await expect(workbench.snapshot(new AbortController().signal)).resolves.toBeNull()

    await workbench.close()
    await expect(workbench.snapshot(new AbortController().signal)).rejects.toThrow(/not open/u)
    await expect(workbench.open()).rejects.toThrow(/closed/u)
  })
})
