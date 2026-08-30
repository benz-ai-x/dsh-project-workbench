import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SetStatusResult, WorkbenchStatusMutation } from '../src/index.ts'
import {
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_SQLITE_APPLICATION_ID,
} from '../src/index.ts'

const roots: string[] = []
const signal = new AbortController().signal

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  roots.push(root)
  return join(root, 'nested', 'workbench.sqlite')
}

function repository(
  path: string,
  now: () => Date = () => new Date('2026-08-31T00:00:00.000Z'),
): SqliteWorkbenchRepository {
  return new SqliteWorkbenchRepository({
    databasePath: path,
    journalMode: 'wal',
    busyTimeoutMs: 1_234,
    now,
  })
}

function command(
  suffix: string,
  message: string,
  expectedRevision: number | null,
  hour = 1,
  idempotencyKey = `idempotency-key-${suffix.padStart(4, '0')}`,
): WorkbenchStatusMutation {
  const instant = `2026-08-31T${String(hour).padStart(2, '0')}:00:00.000Z`
  return {
    candidateId: `status-${suffix}`,
    message,
    expectedRevision,
    updatedAt: instant,
    command: {
      commandId: `command-${suffix}`,
      auditEventId: `audit-${suffix}`,
      outboxId: `outbox-${suffix}`,
      idempotencyKey,
      causationId: `causation-id-${suffix.padStart(6, '0')}`,
      reason: 'owner-status-edit',
      actor: {
        kind: 'owner',
        id: 'owner-test',
        organizationId: 'organization-test',
        teamId: 'team-test',
      },
      occurredAt: instant,
    },
  }
}

function connection(workbench: SqliteWorkbenchRepository): DatabaseSync {
  return Reflect.get(workbench, 'database') as DatabaseSync
}

function artifactCounts(database: DatabaseSync) {
  return {
    status: database.prepare('SELECT COUNT(*) AS count FROM workbench_status').get(),
    outbox: database.prepare('SELECT COUNT(*) AS count FROM workbench_outbox').get(),
    audit: database.prepare('SELECT COUNT(*) AS count FROM workbench_audit_event').get(),
    receipts: database.prepare('SELECT COUNT(*) AS count FROM workbench_command_receipt').get(),
    head: database.prepare('SELECT sequence FROM workbench_audit_head WHERE singleton = 1').get(),
  }
}

describe('SqliteWorkbenchRepository', () => {
  it('migrates a fresh database and configures WAL, foreign keys, timeout, and an empty audit head', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()

    const database = connection(workbench)
    expect(database.prepare('PRAGMA user_version').get()).toEqual({
      user_version: WORKBENCH_SCHEMA_VERSION,
    })
    expect(database.prepare('PRAGMA application_id').get()).toEqual({
      application_id: WORKBENCH_SQLITE_APPLICATION_ID,
    })
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(database.prepare('PRAGMA recursive_triggers').get()).toEqual({ recursive_triggers: 1 })
    expect(database.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 1_234 })
    await expect(workbench.snapshot(signal)).resolves.toBeNull()
    await expect(workbench.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 0,
      issue: null,
    })

    await workbench.close()
    expect(workbench.closed).toBe(true)
  })

  it('upgrades a real v1 database without changing its durable status', async () => {
    const path = await databasePath()
    await mkdir(dirname(path), { recursive: true })
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE workbench_status (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL CHECK (length(id) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;
      INSERT INTO workbench_status VALUES (
        1, 'status-legacy', 'Legacy status', 7, '2026-08-30T01:00:00.000Z'
      );
      PRAGMA user_version = 1;
      PRAGMA application_id = ${WORKBENCH_SQLITE_APPLICATION_ID};
    `)
    legacy.close()

    const upgraded = repository(path)
    await upgraded.open()
    await expect(upgraded.snapshot(signal)).resolves.toEqual({
      id: 'status-legacy',
      message: 'Legacy status',
      revision: 7,
      updatedAt: '2026-08-30T01:00:00.000Z',
    })
    expect(connection(upgraded).prepare('PRAGMA user_version').get()).toEqual({
      user_version: WORKBENCH_SCHEMA_VERSION,
    })
    await upgraded.close()
  })

  it('does not partially commit when an upgraded v1 status has exhausted safe revisions', async () => {
    const path = await databasePath()
    await mkdir(dirname(path), { recursive: true })
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE workbench_status (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL CHECK (length(id) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;
      INSERT INTO workbench_status VALUES (
        1, 'status-exhausted', 'Legacy maximum', ${Number.MAX_SAFE_INTEGER},
        '2026-08-30T01:00:00.000Z'
      );
      PRAGMA user_version = 1;
      PRAGMA application_id = ${WORKBENCH_SQLITE_APPLICATION_ID};
    `)
    legacy.close()

    const upgraded = repository(path)
    await upgraded.open()
    await expect(upgraded.commitStatus(
      command('overflow', 'Must not commit', Number.MAX_SAFE_INTEGER),
      signal,
    )).rejects.toThrow(/revision exhausted/u)
    expect(artifactCounts(connection(upgraded))).toEqual({
      status: { count: 1 },
      outbox: { count: 0 },
      audit: { count: 0 },
      receipts: { count: 0 },
      head: { sequence: 0 },
    })
    await expect(upgraded.snapshot(signal)).resolves.toMatchObject({
      id: 'status-exhausted',
      message: 'Legacy maximum',
      revision: Number.MAX_SAFE_INTEGER,
    })
    await upgraded.close()
  })

  it('atomically persists status, pending Outbox, audit, and replay receipt across restart', async () => {
    const path = await databasePath()
    const first = repository(path)
    await first.open()
    const original = command('durable', 'Durable state', null)
    const committed = await first.commitStatus(original, signal)
    expect(committed).toEqual({
      ok: true,
      value: {
        id: 'status-durable',
        message: 'Durable state',
        revision: 1,
        updatedAt: '2026-08-31T01:00:00.000Z',
      },
      receipt: {
        commandId: 'command-durable',
        auditEventId: 'audit-durable',
        outboxId: 'outbox-durable',
      },
    })
    expect(artifactCounts(connection(first))).toEqual({
      status: { count: 1 },
      outbox: { count: 1 },
      audit: { count: 1 },
      receipts: { count: 1 },
      head: { sequence: 1 },
    })
    await first.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.snapshot(signal)).resolves.toEqual(committed.ok ? committed.value : null)
    await expect(restarted.commitStatus({
      ...original,
      candidateId: 'status-restart-retry',
      updatedAt: '2026-08-31T02:00:00.000Z',
      command: {
        ...original.command,
        commandId: 'command-restart-retry',
        auditEventId: 'audit-restart-retry',
        outboxId: 'outbox-restart-retry',
        occurredAt: '2026-08-31T02:00:00.000Z',
      },
    }, signal)).resolves.toEqual(committed)
    expect(artifactCounts(connection(restarted))).toEqual({
      status: { count: 1 },
      outbox: { count: 1 },
      audit: { count: 1 },
      receipts: { count: 1 },
      head: { sequence: 1 },
    })
    await expect(restarted.readActivity({
      organizationId: 'organization-test',
      filter: { projectId: null, limit: 10 },
    }, signal)).resolves.toMatchObject({
      items: [{
        actor: { kind: 'owner', id: 'owner-test' },
        reason: 'owner-status-edit',
        object: { id: 'status-durable', version: 1 },
        causationId: 'causation-id-durable',
        outbox: { id: 'outbox-durable', state: 'pending', attemptCount: 0 },
      }],
    })
    await expect(restarted.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
      issue: null,
    })
    await restarted.close()
  })

  it.each([
    ['Outbox', 'workbench_outbox'],
    ['audit', 'workbench_audit_event'],
    ['receipt', 'workbench_command_receipt'],
  ])('rolls back every artifact when %s insertion fails', async (_label, table) => {
    const workbench = repository(':memory:')
    await workbench.open()
    connection(workbench).exec(`
      CREATE TRIGGER injected_failure BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected T03 failure'); END
    `)

    await expect(workbench.commitStatus(command('rollback', 'Must roll back', null), signal))
      .rejects.toThrow(/injected T03 failure/u)
    expect(artifactCounts(connection(workbench))).toEqual({
      status: { count: 0 },
      outbox: { count: 0 },
      audit: { count: 0 },
      receipts: { count: 0 },
      head: { sequence: 0 },
    })
    await workbench.close()
  })

  it('closes an uncertain connection when transaction rollback itself fails', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const database = connection(workbench)
    database.exec(`
      CREATE TRIGGER injected_failure BEFORE INSERT ON workbench_audit_event
      BEGIN SELECT RAISE(ABORT, 'injected operation failure'); END
    `)
    const execute = database.exec.bind(database)
    const exec = vi.spyOn(database, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK') throw new Error('injected rollback failure')
      return execute(sql)
    })

    await expect(workbench.commitStatus(
      command('rollback-failure', 'Must close', null),
      signal,
    )).rejects.toThrow(/rollback failed; repository was closed/u)
    expect(workbench.closed).toBe(true)
    await expect(workbench.snapshot(signal)).rejects.toThrow(/not open/u)
    await expect(workbench.open()).rejects.toThrow(/closed/u)
    exec.mockRestore()
    await workbench.close()
  })

  it('replays the same intent exactly once and rejects changed intent under the same key', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const original = command('one', 'Initial', null, 1, 'stable-idempotency-key-0001')
    const first = await workbench.commitStatus(original, signal)
    const replay = await workbench.commitStatus({
      ...original,
      candidateId: 'status-retry-generated',
      updatedAt: '2026-08-31T02:00:00.000Z',
      command: {
        ...original.command,
        commandId: 'command-retry-generated',
        auditEventId: 'audit-retry-generated',
        outboxId: 'outbox-retry-generated',
        occurredAt: '2026-08-31T02:00:00.000Z',
      },
    }, signal)
    expect(replay).toEqual(first)
    expect(artifactCounts(connection(workbench))).toMatchObject({
      status: { count: 1 }, outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })

    await expect(workbench.commitStatus(command(
      'different', 'Changed intent', 1, 3, 'stable-idempotency-key-0001',
    ), signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'idempotency-conflict',
        message: 'Workbench idempotency key was already used for different intent',
      },
    })
    expect(artifactCounts(connection(workbench))).toMatchObject({
      status: { count: 1 }, outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })
    const stored = connection(workbench).prepare(`
      SELECT idempotency_key_hash FROM workbench_command_receipt
    `).get() as { idempotency_key_hash: string }
    expect(stored.idempotency_key_hash).toMatch(/^[0-9a-f]{64}$/u)
    expect(stored.idempotency_key_hash).not.toContain('stable-idempotency-key')
    await workbench.close()
  })

  it('commits one stale-writer winner while a revision conflict creates no artifacts', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const created = await workbench.commitStatus(command('one', 'Initial', null), signal)
    expect(created.ok).toBe(true)
    const winner = await workbench.commitStatus(command('two', 'Winner', 1, 2), signal)
    const loser = await workbench.commitStatus(command('three', 'Loser', 1, 3), signal)
    expect(winner).toMatchObject({ ok: true, value: { revision: 2, message: 'Winner' } })
    expect(loser).toEqual({
      ok: false,
      error: {
        code: 'revision-conflict',
        message: 'Workbench status revision changed (expected 1, current 2)',
        current: winner.ok ? winner.value : null,
      },
    })
    expect(artifactCounts(connection(workbench))).toMatchObject({
      outbox: { count: 2 }, audit: { count: 2 }, receipts: { count: 2 }, head: { sequence: 2 },
    })
    await workbench.close()
  })

  it('filters and pages redacted Activity without exposing status text or Outbox payload', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('one', 'SECRET-STATUS-CANARY-1', null, 1), signal)
    await workbench.commitStatus(command('two', 'SECRET-STATUS-CANARY-2', 1, 2), signal)
    await workbench.commitStatus(command('three', 'SECRET-STATUS-CANARY-3', 2, 3), signal)

    const page = await workbench.readActivity({
      organizationId: 'organization-test',
      filter: {
        projectId: null,
        objectType: 'workbench-status',
        objectId: 'status-one',
        action: 'workbench.status.updated',
        limit: 2,
      },
    }, signal)
    expect(page.items.map(item => item.sequence)).toEqual([3, 2])
    expect(page.nextBeforeSequence).toBe(2)
    expect(JSON.stringify(page)).not.toContain('SECRET-STATUS-CANARY')
    expect(JSON.stringify(page)).not.toContain('payload_json')
    const permanentAudit = connection(workbench).prepare(`
      SELECT canonical_envelope, summary_fields_json FROM workbench_audit_event
    `).all()
    const integrationIntents = connection(workbench).prepare(`
      SELECT payload_json, topic, effect_key FROM workbench_outbox
    `).all()
    expect(JSON.stringify({ permanentAudit, integrationIntents }))
      .not.toContain('SECRET-STATUS-CANARY')
    await expect(workbench.readActivity({
      organizationId: 'organization-test',
      filter: { projectId: 'project-not-created-yet', limit: 10 },
    }, signal)).resolves.toMatchObject({
      items: [],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 3, issue: null },
    })
    await expect(workbench.readActivity({
      organizationId: 'another-organization',
      filter: { limit: 10 },
    }, signal)).resolves.toMatchObject({
      items: [],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 3, issue: null },
    })
    await workbench.close()
  })

  it('verifies one stable audit snapshot while another WAL connection commits', async () => {
    const path = await databasePath()
    const reader = repository(path)
    const writer = repository(path)
    await reader.open()
    await writer.open()
    await reader.commitStatus(command('one', 'One', null, 1), signal)

    const database = connection(reader)
    const originalPrepare = database.prepare.bind(database)
    let injected = false
    let concurrentCommit: Promise<SetStatusResult> | undefined
    const prepare = vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = originalPrepare(sql)
      if (!injected && sql.includes('SELECT sequence, head_hash FROM workbench_audit_head')) {
        const originalGet = statement.get.bind(statement)
        vi.spyOn(statement, 'get').mockImplementation((...parameters) => {
          const row = originalGet(...parameters)
          injected = true
          concurrentCommit = writer.commitStatus(command('two', 'Two', 1, 2), signal)
          return row
        })
      }
      return statement
    })

    await expect(reader.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
      issue: null,
    })
    prepare.mockRestore()
    await expect(concurrentCommit).resolves.toMatchObject({
      ok: true,
      value: { revision: 2 },
    })
    await expect(reader.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 2,
      issue: null,
    })
    await writer.close()
    await reader.close()
  })

  it('makes pending, delivered, unknown, and failed Outbox truths observable', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    await workbench.commitStatus(command('two', 'Two', 1, 2), signal)
    await workbench.commitStatus(command('three', 'Three', 2, 3), signal)
    await workbench.commitStatus(command('four', 'Four', 3, 4), signal)

    for (const [index, state, errorCode] of [
      [1, 'delivered', null],
      [2, 'unknown', 'transport-ambiguous'],
      [3, 'failed', 'definitive-rejection'],
    ] as const) {
      const claimToken = `claim-token-000${index}`
      const claim = await workbench.claimOutbox({
        claimToken,
        claimedAt: `2026-08-31T0${index}:10:00.000Z`,
        leaseExpiresAt: `2026-08-31T0${index}:20:00.000Z`,
      }, signal)
      expect(claim).not.toBeNull()
      await expect(workbench.settleOutbox({
        outboxId: claim?.id ?? '',
        claimToken,
        state,
        settledAt: `2026-08-31T0${index}:11:00.000Z`,
        errorCode,
      }, signal)).resolves.toBe(true)
    }

    const activity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(new Set(activity.items.map(item => item.outbox.state))).toEqual(
      new Set(['pending', 'delivered', 'unknown', 'failed']),
    )
    expect(activity.items.find(item => item.outbox.state === 'unknown')?.outbox.errorCode)
      .toBe('transport-ambiguous')
    await workbench.close()
  })

  it('turns an expired unresolved claim into unknown before claiming another pending intent', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    await workbench.commitStatus(command('two', 'Two', 1, 2), signal)
    await workbench.claimOutbox({
      claimToken: 'claim-token-expiring',
      claimedAt: '2026-08-31T03:00:00.000Z',
      leaseExpiresAt: '2026-08-31T03:01:00.000Z',
    }, signal)
    const second = await workbench.claimOutbox({
      claimToken: 'claim-token-second00',
      claimedAt: '2026-08-31T03:02:00.000Z',
      leaseExpiresAt: '2026-08-31T03:03:00.000Z',
    }, signal)
    expect(second?.id).toBe('outbox-two')
    const activity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(activity.items.find(item => item.outbox.id === 'outbox-one')?.outbox)
      .toMatchObject({ state: 'unknown', errorCode: 'lease-expired' })
    await workbench.close()
  })

  it('rejects a stale worker settlement and makes the elapsed lease unknown immediately', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    const claim = await workbench.claimOutbox({
      claimToken: 'claim-token-stale00',
      claimedAt: '2026-08-31T03:00:00.000Z',
      leaseExpiresAt: '2026-08-31T03:01:00.000Z',
    }, signal)
    await expect(workbench.settleOutbox({
      outboxId: claim?.id ?? '',
      claimToken: 'claim-token-stale00',
      state: 'delivered',
      settledAt: '2026-08-31T03:02:00.000Z',
      errorCode: null,
    }, signal)).resolves.toBe(false)
    const activity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(activity.items[0]?.outbox).toMatchObject({
      state: 'unknown',
      attemptCount: 1,
      errorCode: 'lease-expired',
    })
    await workbench.close()
  })

  it('uses its trusted clock so a stale worker cannot backdate a settlement', async () => {
    let now = new Date('2026-08-31T03:00:00.000Z')
    const workbench = repository(':memory:', () => now)
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    const claim = await workbench.claimOutbox({
      claimToken: 'claim-token-backdate',
      claimedAt: '2026-08-31T03:00:00.000Z',
      leaseExpiresAt: '2026-08-31T03:01:00.000Z',
    }, signal)
    now = new Date('2026-08-31T03:02:00.000Z')
    await expect(workbench.settleOutbox({
      outboxId: claim?.id ?? '',
      claimToken: 'claim-token-backdate',
      state: 'delivered',
      settledAt: '2026-08-31T03:00:30.000Z',
      errorCode: null,
    }, signal)).resolves.toBe(false)
    const activity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(activity.items[0]?.outbox).toMatchObject({
      state: 'unknown',
      updatedAt: '2026-08-31T03:02:00.000Z',
      errorCode: 'lease-expired',
    })
    await workbench.close()
  })

  it('resolves an elapsed in-flight attempt to unknown while reopening after a crash', async () => {
    const path = await databasePath()
    let now = new Date('2000-01-01T00:00:00.000Z')
    const first = repository(path, () => now)
    await first.open()
    await first.commitStatus(command('one', 'One', null, 1), signal)
    await first.claimOutbox({
      claimToken: 'claim-token-crash00',
      claimedAt: '2000-01-01T00:00:00.000Z',
      leaseExpiresAt: '2000-01-01T00:01:00.000Z',
    }, signal)
    await first.close()

    now = new Date('2000-01-01T00:02:00.000Z')
    const restarted = repository(path, () => now)
    await restarted.open()
    const activity = await restarted.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(activity.items[0]?.outbox).toMatchObject({
      state: 'unknown',
      attemptCount: 1,
      errorCode: 'lease-expired',
    })
    await restarted.close()
  })

  it('rejects arbitrary adapter details instead of persisting them as Activity error codes', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    const claim = await workbench.claimOutbox({
      claimToken: 'claim-token-secret0',
      claimedAt: '2026-08-31T03:00:00.000Z',
      leaseExpiresAt: '2026-08-31T03:01:00.000Z',
    }, signal)
    await expect(workbench.settleOutbox({
      outboxId: claim?.id ?? '',
      claimToken: 'claim-token-secret0',
      state: 'failed',
      settledAt: '2026-08-31T03:00:30.000Z',
      errorCode: 'password123',
    } as never, signal)).rejects.toThrow(/allowlisted/u)

    const activity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { limit: 10 },
    }, signal)
    expect(JSON.stringify(activity)).not.toContain('password123')
    expect(activity.items[0]?.outbox).toMatchObject({ state: 'pending', errorCode: null })
    await workbench.close()
  })

  it('rejects audit mutation at runtime and detects tampering on restart', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await workbench.commitStatus(command('one', 'Protected', null), signal)
    expect(() => connection(workbench).exec(`
      UPDATE workbench_audit_event SET reason_code = 'tampered' WHERE sequence = 1
    `)).toThrow(/append-only/u)
    expect(() => connection(workbench).exec(`
      INSERT OR REPLACE INTO workbench_audit_event
      SELECT * FROM workbench_audit_event WHERE sequence = 1
    `)).toThrow(/append-only/u)
    await workbench.close()

    const tamper = new DatabaseSync(path)
    tamper.exec(`
      DROP TRIGGER workbench_audit_event_no_update;
      UPDATE workbench_audit_event SET reason_code = 'tampered' WHERE sequence = 1;
    `)
    tamper.close()
    const rejected = repository(path)
    await expect(rejected.open()).rejects.toThrow(/audit chain is invalid|missing trigger/u)
    await rejected.close()
  })

  it('protects immutable Outbox intents and rejects a forged replay receipt', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const original = command('one', 'Original', null, 1, 'receipt-integrity-key-0001')
    await workbench.commitStatus(original, signal)
    expect(() => connection(workbench).exec(`
      UPDATE workbench_outbox SET payload_json = '{"forged":true}'
    `)).toThrow(/immutable/u)
    expect(() => connection(workbench).exec(`
      UPDATE workbench_command_receipt SET result_json = '{}'
    `)).toThrow(/immutable/u)

    connection(workbench).exec(`
      DROP TRIGGER workbench_command_receipt_no_update;
      UPDATE workbench_command_receipt
      SET result_json = json_set(result_json, '$.value.message', 'FORGED')
    `)
    await expect(workbench.commitStatus({
      ...original,
      candidateId: 'status-retry-forged',
      command: {
        ...original.command,
        commandId: 'command-retry-forged',
        auditEventId: 'audit-retry-forged',
        outboxId: 'outbox-retry-forged',
      },
    }, signal)).rejects.toThrow(/request hash/u)
    await workbench.close()
  })

  it('detects tail deletion by comparing the event set with the stored head', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await workbench.commitStatus(command('one', 'One', null, 1), signal)
    await workbench.commitStatus(command('two', 'Two', 1, 2), signal)
    await workbench.close()

    const tamper = new DatabaseSync(path)
    tamper.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TRIGGER workbench_audit_event_no_delete;
      DELETE FROM workbench_audit_event WHERE sequence = 2;
    `)
    tamper.close()
    const rejected = repository(path)
    await expect(rejected.open()).rejects.toThrow(/audit chain is invalid|missing trigger/u)
    await rejected.close()
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
    await expect(workbench.commitStatus(
      command('cancelled', 'Must not commit', null),
      cancelled.signal,
    )).rejects.toThrow('caller left')
    await expect(workbench.snapshot(signal)).resolves.toBeNull()
    expect(artifactCounts(connection(workbench))).toMatchObject({
      outbox: { count: 0 }, audit: { count: 0 }, receipts: { count: 0 },
    })

    await workbench.close()
    await expect(workbench.snapshot(signal)).rejects.toThrow(/not open/u)
    await expect(workbench.open()).rejects.toThrow(/closed/u)
  })
})
