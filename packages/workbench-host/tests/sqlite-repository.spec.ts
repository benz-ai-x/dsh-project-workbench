import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateProjectResult,
  SetStatusResult,
  WorkbenchProjectMutation,
  WorkbenchStatusMutation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
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

function projectCommand(
  suffix: string,
  expectedCatalogRevision: number,
  options: {
    readonly outcomeCount?: number
    readonly supportingGoals?: WorkbenchProjectMutation['supportingGoals']
    readonly organizationId?: string
    readonly teamId?: string
    readonly idempotencyKey?: string
    readonly projectName?: string
    readonly goalName?: string
    readonly hour?: number
  } = {},
): WorkbenchProjectMutation {
  const hour = options.hour ?? expectedCatalogRevision + 1
  const instant = `2026-08-31T${String(hour).padStart(2, '0')}:30:00.000Z`
  const outcomeCount = options.outcomeCount ?? 1
  return {
    projectId: `project-${suffix}`,
    primaryGoalId: `goal-${suffix}`,
    projectName: options.projectName ?? `Project ${suffix}`,
    primaryGoal: {
      name: options.goalName ?? `Goal ${suffix}`,
      outcomes: Array.from({ length: outcomeCount }, (_, index) => ({
        outcomeId: `outcome-${suffix}-${String(index + 1)}`,
        name: `Outcome ${suffix} ${String(index + 1)}`,
        metric: index % 2 === 0
          ? {
            metricName: `Metric ${String(index + 1)}`,
            initialValue: index,
            targetValue: index + 10,
            unit: 'items',
            direction: 'increase' as const,
          }
          : {
            metricName: `Metric ${String(index + 1)}`,
            initialValue: index + 10,
            targetValue: index,
            unit: 'hours',
            direction: 'decrease' as const,
          },
      })),
    },
    supportingGoals: options.supportingGoals ?? [],
    template: { ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1 },
    expectedCatalogRevision,
    expectedRevision: null,
    createdAt: instant,
    command: {
      commandId: `command-project-${suffix}`,
      auditEventId: `audit-project-${suffix}`,
      outboxId: `outbox-project-${suffix}`,
      idempotencyKey: options.idempotencyKey ?? `project-key-${suffix}`,
      causationId: `project-cause-${suffix}`,
      reason: 'owner-project-create',
      actor: {
        kind: 'owner',
        id: 'owner-test',
        organizationId: options.organizationId ?? 'organization-test',
        teamId: options.teamId ?? 'team-test',
      },
      occurredAt: instant,
    },
  }
}

function projectArtifactCounts(database: DatabaseSync) {
  return {
    projects: database.prepare('SELECT COUNT(*) AS count FROM workbench_project').get(),
    goals: database.prepare('SELECT COUNT(*) AS count FROM workbench_goal').get(),
    outcomes: database.prepare('SELECT COUNT(*) AS count FROM workbench_outcome').get(),
    snapshots: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_template_snapshot
    `).get(),
    supporting: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_supporting_goal
    `).get(),
    catalog: database.prepare(`
      SELECT revision FROM workbench_project_catalog WHERE singleton = 1
    `).get(),
    outbox: database.prepare('SELECT COUNT(*) AS count FROM workbench_outbox').get(),
    audit: database.prepare('SELECT COUNT(*) AS count FROM workbench_audit_event').get(),
    receipts: database.prepare('SELECT COUNT(*) AS count FROM workbench_command_receipt').get(),
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

  it('migrates v2 to v3, seeds the exact compiled template, and preserves the T03 ledger', async () => {
    const path = await databasePath()
    const seeded = repository(path)
    await seeded.open()
    await seeded.commitStatus(command('legacy-v2', 'Preserved T03 value', null), signal)
    await seeded.close()

    const legacy = new DatabaseSync(path)
    legacy.exec(`
      DROP TRIGGER workbench_project_snapshot_columns_no_update;
      DROP TRIGGER workbench_project_template_snapshot_no_delete;
      DROP TRIGGER workbench_project_template_snapshot_no_update;
      DROP TRIGGER workbench_template_version_no_delete;
      DROP TRIGGER workbench_template_version_no_update;
      DROP TABLE workbench_project_supporting_goal;
      DROP TABLE workbench_project_template_snapshot;
      DROP TABLE workbench_project;
      DROP TABLE workbench_outcome;
      DROP TABLE workbench_goal;
      DROP TABLE workbench_project_catalog;
      DROP TABLE workbench_template_version;
      PRAGMA user_version = 2;
    `)
    legacy.close()

    const upgraded = repository(path)
    await upgraded.open()
    expect(connection(upgraded).prepare('PRAGMA user_version').get()).toEqual({
      user_version: 3,
    })
    await expect(upgraded.snapshot(signal)).resolves.toMatchObject({
      id: 'status-legacy-v2',
      message: 'Preserved T03 value',
      revision: 1,
    })
    await expect(upgraded.readProjectStart({
      organizationId: 'organization-test',
      teamId: 'team-test',
      filter: {},
    }, signal)).resolves.toEqual({
      template: {
        selection: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
        definition: JSON.parse(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1),
      },
      catalogRevision: 0,
      projects: [],
      nextBeforeSequence: null,
    })
    expect(connection(upgraded).prepare(`
      SELECT canonical_definition_json, definition_digest
      FROM workbench_template_version
    `).get()).toEqual({
      canonical_definition_json: KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
      definition_digest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    })
    await expect(upgraded.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
    })
    await upgraded.close()
  })

  it('creates and reopens an independently persisted, recursively detached template snapshot', async () => {
    const path = await databasePath()
    const first = repository(path)
    await first.open()
    const committed = await first.commitProject(projectCommand('durable', 0), signal)
    expect(committed).toMatchObject({
      ok: true,
      catalogRevision: 1,
      value: {
        project: {
          projectId: 'project-durable',
          revision: 1,
          catalogSequence: 1,
          timezone: 'Asia/Shanghai',
          primaryGoal: { goalId: 'goal-durable', revision: 1 },
        },
        primaryGoal: {
          goalId: 'goal-durable',
          outcomes: [{ outcomeId: 'outcome-durable-1', revision: 1 }],
        },
        supportingGoals: [],
        templateSnapshot: {
          template: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
          snapshotSchemaVersion: 1,
          snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
        },
      },
    })
    expect(projectArtifactCounts(connection(first))).toEqual({
      projects: { count: 1 }, goals: { count: 1 }, outcomes: { count: 1 },
      snapshots: { count: 1 }, supporting: { count: 0 }, catalog: { revision: 1 },
      outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })
    const storedCopies = connection(first).prepare(`
      SELECT template.canonical_definition_json AS source_json,
        snapshot.canonical_snapshot_json AS snapshot_json
      FROM workbench_template_version AS template
      CROSS JOIN workbench_project_template_snapshot AS snapshot
    `).get()
    expect(storedCopies).toEqual({
      source_json: KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
      snapshot_json: KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
    })
    if (!committed.ok) throw new Error('expected committed Project')
    expect(Object.isFrozen(committed.value.templateSnapshot.definition.defaults)).toBe(true)
    expect(() => {
      const mutable = committed.value.templateSnapshot.definition.defaults as {
        projectTimezone: string
      }
      mutable.projectTimezone = 'UTC'
    }).toThrow()
    await first.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProject({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-durable',
    }, signal)).resolves.toEqual(committed.value)
    const start = await restarted.readProjectStart({
      organizationId: 'organization-test', teamId: 'team-test', filter: {},
    }, signal)
    expect(start.catalogRevision).toBe(1)
    expect(start.projects).toHaveLength(1)
    expect(start.projects[0]?.primaryGoal).toEqual({
      goalId: 'goal-durable', name: 'Goal durable', revision: 1,
    })
    await restarted.close()
  })

  it('enforces permanent template, snapshot-row, and Project snapshot-column immutability', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await workbench.commitProject(projectCommand('immutable', 0), signal)
    const database = connection(workbench)
    expect(() => database.exec(`
      UPDATE workbench_template_version SET kind = 'drifted'
    `)).toThrow(/Template Versions are immutable/u)
    expect(() => database.exec(`DELETE FROM workbench_template_version`))
      .toThrow(/Template Versions cannot be deleted/u)
    expect(() => database.exec(`
      UPDATE workbench_project_template_snapshot SET canonical_snapshot_json = '{}'
    `)).toThrow(/creation snapshots are immutable/u)
    expect(() => database.exec(`DELETE FROM workbench_project_template_snapshot`))
      .toThrow(/creation snapshots cannot be deleted/u)
    expect(() => database.exec(`
      UPDATE workbench_project SET creation_snapshot_digest = 'sha256:${'1'.repeat(64)}'
    `)).toThrow(/snapshot identity is immutable/u)
    await workbench.close()

    const drift = new DatabaseSync(path)
    drift.exec(`
      DROP TRIGGER workbench_template_version_no_update;
      UPDATE workbench_template_version
      SET canonical_definition_json = '{"drift":true}';
      CREATE TRIGGER workbench_template_version_no_update
        BEFORE UPDATE ON workbench_template_version
      BEGIN SELECT RAISE(ABORT, 'workbench Template Versions are immutable'); END;
    `)
    drift.close()
    const rejected = repository(path)
    await expect(rejected.open()).rejects.toThrow(/Template Version drifted/u)
    await rejected.close()
  })

  it('fails closed on restart when a bypassed snapshot trigger leaves non-canonical Project bytes', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await workbench.commitProject(projectCommand('snapshot-drift', 0), signal)
    await workbench.close()

    const tamper = new DatabaseSync(path)
    tamper.exec(`
      DROP TRIGGER workbench_project_template_snapshot_no_update;
      UPDATE workbench_project_template_snapshot
      SET canonical_snapshot_json = '{"drift":true}';
      CREATE TRIGGER workbench_project_template_snapshot_no_update
        BEFORE UPDATE ON workbench_project_template_snapshot
      BEGIN SELECT RAISE(ABORT, 'workbench Project creation snapshots are immutable'); END;
    `)
    tamper.close()
    const rejected = repository(path)
    await expect(rejected.open()).rejects.toThrow(/creation snapshot failed identity validation/u)
    await rejected.close()
  })

  it('fails startup domain validation when a Goal loses its required Outcome', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await workbench.commitProject(projectCommand('missing-outcome', 0), signal)
    await workbench.close()

    const tamper = new DatabaseSync(path)
    tamper.exec(`DELETE FROM workbench_outcome WHERE goal_id = 'goal-missing-outcome'`)
    tamper.close()
    const rejected = repository(path)
    await expect(rejected.open()).rejects.toThrow(/must contain from 1 to 20 Outcomes/u)
    await rejected.close()
  })

  it('persists twenty ordered Outcomes and links a second Project to the first Primary Goal', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const first = await workbench.commitProject(projectCommand('first', 0), signal)
    expect(first.ok).toBe(true)
    const second = await workbench.commitProject(projectCommand('second', 1, {
      outcomeCount: 20,
      supportingGoals: [{ goalId: 'goal-first', expectedRevision: 1 }],
    }), signal)
    expect(second).toMatchObject({
      ok: true,
      catalogRevision: 2,
      value: {
        project: { projectId: 'project-second', catalogSequence: 2 },
        supportingGoals: [{ goalId: 'goal-first', name: 'Goal first', revision: 1 }],
      },
    })
    if (!second.ok) throw new Error('expected second Project commit')
    expect(second.value.primaryGoal.outcomes).toHaveLength(20)
    expect(second.value.primaryGoal.outcomes[0]).toMatchObject({
      outcomeId: 'outcome-second-1', metric: { direction: 'increase' },
    })
    expect(second.value.primaryGoal.outcomes[1]).toMatchObject({
      outcomeId: 'outcome-second-2', metric: { direction: 'decrease' },
    })
    expect(second.value.primaryGoal.outcomes[19]).toMatchObject({
      outcomeId: 'outcome-second-20', revision: 1,
    })
    const newest = await workbench.readProjectStart({
      organizationId: 'organization-test', teamId: 'team-test', filter: { limit: 1 },
    }, signal)
    expect(newest.projects.map(project => project.projectId)).toEqual(['project-second'])
    expect(newest.nextBeforeSequence).toBe(2)
    const older = await workbench.readProjectStart({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { beforeSequence: newest.nextBeforeSequence ?? undefined, limit: 1 },
    }, signal)
    expect(older.projects.map(project => project.projectId)).toEqual(['project-first'])
    expect(older.nextBeforeSequence).toBeNull()
    await expect(workbench.readProject({
      organizationId: 'another-organization', teamId: 'team-test', projectId: 'project-second',
    }, signal)).resolves.toBeNull()
    expect(projectArtifactCounts(connection(workbench))).toEqual({
      projects: { count: 2 }, goals: { count: 2 }, outcomes: { count: 21 },
      snapshots: { count: 2 }, supporting: { count: 1 }, catalog: { revision: 2 },
      outbox: { count: 2 }, audit: { count: 2 }, receipts: { count: 2 },
    })
    await workbench.close()
  })

  it('returns closed template, catalog, and Supporting Goal conflicts without partial writes', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const mismatchedTemplate = projectCommand('template-conflict', 0)
    await expect(workbench.commitProject({
      ...mismatchedTemplate,
      template: {
        ...mismatchedTemplate.template,
        definitionDigest: `sha256:${'9'.repeat(64)}`,
      },
    }, signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'template-version-conflict',
        message: 'Workbench Template Version does not match the compiled Project template',
        current: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
      },
    })
    expect(projectArtifactCounts(connection(workbench))).toMatchObject({
      projects: { count: 0 }, goals: { count: 0 }, outcomes: { count: 0 },
      snapshots: { count: 0 }, supporting: { count: 0 }, catalog: { revision: 0 },
    })

    await workbench.commitProject(projectCommand('source', 0), signal)
    const baseline = projectArtifactCounts(connection(workbench))
    await expect(workbench.commitProject(projectCommand('catalog-stale', 0), signal))
      .resolves.toMatchObject({
        ok: false,
        error: {
          code: 'catalog-revision-conflict',
          expectedCatalogRevision: 0,
          currentCatalogRevision: 1,
        },
      })
    await expect(workbench.commitProject(projectCommand('support-missing', 1, {
      supportingGoals: [{ goalId: 'goal-missing', expectedRevision: 1 }],
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'supporting-goal-conflict', goalId: 'goal-missing', currentRevision: null,
      },
    })
    await expect(workbench.commitProject(projectCommand('support-stale', 1, {
      supportingGoals: [{ goalId: 'goal-source', expectedRevision: 2 }],
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'supporting-goal-conflict', goalId: 'goal-source',
        expectedRevision: 2, currentRevision: 1,
      },
    })
    connection(workbench).exec(`UPDATE workbench_goal SET state = 'inactive' WHERE id = 'goal-source'`)
    await expect(workbench.commitProject(projectCommand('support-inactive', 1, {
      supportingGoals: [{ goalId: 'goal-source', expectedRevision: 1 }],
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'supporting-goal-conflict', goalId: 'goal-source',
        expectedRevision: 1, currentRevision: 1,
      },
    })
    connection(workbench).exec(`UPDATE workbench_goal SET state = 'active' WHERE id = 'goal-source'`)
    expect(projectArtifactCounts(connection(workbench))).toEqual(baseline)

    await workbench.commitProject(projectCommand('other-scope', 1, {
      organizationId: 'organization-other', teamId: 'team-other',
    }), signal)
    const crossScopeBaseline = projectArtifactCounts(connection(workbench))
    await expect(workbench.commitProject(projectCommand('support-cross-scope', 2, {
      supportingGoals: [{ goalId: 'goal-other-scope', expectedRevision: 1 }],
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'supporting-goal-conflict', goalId: 'goal-other-scope', currentRevision: null,
      },
    })
    expect(projectArtifactCounts(connection(workbench))).toEqual(crossScopeBaseline)
    await workbench.close()
  })

  it.each([
    ['zero Outcomes', { outcomeCount: 0 }],
    ['twenty-one Outcomes', { outcomeCount: 21 }],
  ] as const)('rejects %s before opening a write transaction', async (_label, options) => {
    const workbench = repository(':memory:')
    await workbench.open()
    await expect(workbench.commitProject(projectCommand('invalid-count', 0, options), signal))
      .rejects.toThrow(/1 to 20 Outcomes/u)
    expect(projectArtifactCounts(connection(workbench))).toMatchObject({
      projects: { count: 0 }, goals: { count: 0 }, outcomes: { count: 0 },
      catalog: { revision: 0 }, outbox: { count: 0 }, audit: { count: 0 }, receipts: { count: 0 },
    })
    await workbench.close()
  })

  it('rejects non-measurable metrics, duplicate Supporting Goals, and non-null create revision', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const base = projectCommand('invalid-domain', 0)
    for (const metric of [
      { ...base.primaryGoal.outcomes[0]?.metric, initialValue: Number.NaN },
      { ...base.primaryGoal.outcomes[0]?.metric, initialValue: -0 },
      { ...base.primaryGoal.outcomes[0]?.metric, targetValue: 0 },
    ]) {
      await expect(workbench.commitProject({
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{ ...base.primaryGoal.outcomes[0]!, metric } as never],
        },
      }, signal)).rejects.toThrow(/finite number|does not improve/u)
    }
    await expect(workbench.commitProject({
      ...base,
      supportingGoals: [
        { goalId: 'goal-repeat', expectedRevision: 1 },
        { goalId: 'goal-repeat', expectedRevision: 1 },
      ],
    }, signal)).rejects.toThrow(/must be unique/u)
    await expect(workbench.commitProject({
      ...base,
      expectedRevision: 1,
    } as never, signal)).rejects.toThrow(/must be null/u)
    expect(projectArtifactCounts(connection(workbench))).toMatchObject({
      projects: { count: 0 }, goals: { count: 0 }, outcomes: { count: 0 }, catalog: { revision: 0 },
    })
    await workbench.close()
  })

  it('converges response-loss and two-connection replay on one exact Project receipt', async () => {
    const path = await databasePath()
    const firstConnection = repository(path)
    const secondConnection = repository(path)
    await firstConnection.open()
    await secondConnection.open()
    const original = projectCommand('replay', 0, {
      outcomeCount: 3,
      idempotencyKey: 'stable-project-replay-key',
      projectName: 'Replay-safe Project',
      goalName: 'Replay-safe Goal',
    })
    const replay: WorkbenchProjectMutation = {
      ...original,
      projectId: 'project-generated-on-retry',
      primaryGoalId: 'goal-generated-on-retry',
      primaryGoal: {
        ...original.primaryGoal,
        outcomes: original.primaryGoal.outcomes.map((outcome, index) => ({
          ...outcome,
          outcomeId: `outcome-generated-retry-${String(index + 1)}`,
        })),
      },
      createdAt: '2026-08-31T05:30:00.000Z',
      command: {
        ...original.command,
        commandId: 'command-generated-on-retry',
        auditEventId: 'audit-generated-on-retry',
        outboxId: 'outbox-generated-on-retry',
        occurredAt: '2026-08-31T05:30:00.000Z',
      },
    }
    const [first, repeated] = await Promise.all([
      firstConnection.commitProject(original, signal),
      secondConnection.commitProject(replay, signal),
    ])
    expect(first).toEqual(repeated)
    expect(first).toMatchObject({
      ok: true,
      value: { project: { projectId: 'project-replay' } },
      receipt: {
        commandId: 'command-project-replay',
        auditEventId: 'audit-project-replay',
        outboxId: 'outbox-project-replay',
      },
    })
    expect(projectArtifactCounts(connection(firstConnection))).toEqual({
      projects: { count: 1 }, goals: { count: 1 }, outcomes: { count: 3 },
      snapshots: { count: 1 }, supporting: { count: 0 }, catalog: { revision: 1 },
      outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })
    await expect(secondConnection.commitProject({
      ...replay,
      projectName: 'Changed retry intent',
    }, signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'idempotency-conflict',
        message: 'Workbench idempotency key was already used for different intent',
      },
    })
    expect(projectArtifactCounts(connection(secondConnection))).toMatchObject({
      projects: { count: 1 }, goals: { count: 1 }, outcomes: { count: 3 },
      catalog: { revision: 1 }, outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })
    await secondConnection.close()
    await firstConnection.close()
  })

  it('treats a different idempotency key as a distinct Project even for matching business text', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitProject(projectCommand('same-text-one', 0, {
      projectName: 'Same Project name', goalName: 'Same Goal name',
    }), signal)
    await expect(workbench.commitProject(projectCommand('same-text-two', 1, {
      projectName: 'Same Project name', goalName: 'Same Goal name',
    }), signal)).resolves.toMatchObject({
      ok: true,
      catalogRevision: 2,
      value: { project: { projectId: 'project-same-text-two' } },
    })
    expect(projectArtifactCounts(connection(workbench))).toMatchObject({
      projects: { count: 2 }, goals: { count: 2 }, outcomes: { count: 2 },
      snapshots: { count: 2 }, catalog: { revision: 2 },
      outbox: { count: 2 }, audit: { count: 2 }, receipts: { count: 2 },
    })
    await workbench.close()
  })

  it.each([
    ['Goal', `BEFORE INSERT ON workbench_goal`, 3],
    ['second Outcome', `BEFORE INSERT ON workbench_outcome WHEN NEW.ordinal = 2`, 3],
    ['Project', `BEFORE INSERT ON workbench_project`, 3],
    ['creation snapshot', `BEFORE INSERT ON workbench_project_template_snapshot`, 3],
    ['Supporting Goal link', `BEFORE INSERT ON workbench_project_supporting_goal`, 3],
    ['catalog CAS', `BEFORE UPDATE ON workbench_project_catalog`, 3],
    ['Outbox', `BEFORE INSERT ON workbench_outbox`, 3],
    ['audit event', `BEFORE INSERT ON workbench_audit_event`, 3],
    ['audit head', `BEFORE UPDATE ON workbench_audit_head`, 3],
    ['receipt', `BEFORE INSERT ON workbench_command_receipt`, 3],
  ] as const)(
    'rolls back the complete Project cluster when the %s stage fails, including after restart',
    async (label, triggerPoint, outcomeCount) => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await workbench.commitProject(projectCommand(`fault-source-${label.replaceAll(' ', '-')}`, 0), signal)
      const baseline = projectArtifactCounts(connection(workbench))
      connection(workbench).exec(`
        CREATE TRIGGER injected_t04_failure ${triggerPoint}
        BEGIN SELECT RAISE(ABORT, 'injected T04 ${label} failure'); END
      `)
      await expect(workbench.commitProject(projectCommand(`fault-target-${label.replaceAll(' ', '-')}`, 1, {
        outcomeCount,
        supportingGoals: [{
          goalId: `goal-fault-source-${label.replaceAll(' ', '-')}`,
          expectedRevision: 1,
        }],
      }), signal)).rejects.toThrow(/injected T04/u)
      expect(projectArtifactCounts(connection(workbench))).toEqual(baseline)
      await workbench.close()

      const restarted = repository(path)
      await restarted.open()
      expect(projectArtifactCounts(connection(restarted))).toEqual(baseline)
      await expect(restarted.verifyAuditChain(signal)).resolves.toMatchObject({
        valid: true, eventCount: 1, issue: null,
      })
      await restarted.close()
    },
  )

  it('projects scoped Project Activity while redacting Project, Goal, Outcome, metric, and snapshot text', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await workbench.commitStatus(command('activity-status', 'STATUS-ACTIVITY-CANARY', null), signal)
    const activityDraft = projectCommand('activity', 0, {
      projectName: 'PROJECT-ACTIVITY-CANARY',
      goalName: 'GOAL-ACTIVITY-CANARY',
    })
    const activityOutcome = activityDraft.primaryGoal.outcomes[0]!
    const mutation: WorkbenchProjectMutation = {
      ...activityDraft,
      primaryGoal: {
        ...activityDraft.primaryGoal,
        outcomes: [{
          ...activityOutcome,
          name: 'OUTCOME-ACTIVITY-CANARY',
          metric: {
            ...activityOutcome.metric,
            metricName: 'METRIC-ACTIVITY-CANARY',
            unit: 'UNIT-CANARY',
          },
        }],
      },
    }
    await workbench.commitProject(mutation, signal)

    const projectActivity = await workbench.readActivity({
      organizationId: 'organization-test',
      filter: {
        projectId: 'project-activity',
        objectType: 'project',
        objectId: 'project-activity',
        action: 'workbench.project.created',
        limit: 10,
      },
    }, signal)
    expect(projectActivity).toMatchObject({
      items: [{
        sequence: 2,
        actor: { kind: 'owner', id: 'owner-test' },
        projectId: 'project-activity',
        action: 'workbench.project.created',
        reason: 'owner-project-create',
        object: { type: 'project', id: 'project-activity', version: 1 },
        causationId: 'project-cause-activity',
        commandId: 'command-project-activity',
        summaryCode: 'project-created-from-template',
        outbox: { id: 'outbox-project-activity', state: 'pending', attemptCount: 0 },
      }],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 2, issue: null },
    })
    const workspaceActivity = await workbench.readActivity({
      organizationId: 'organization-test', filter: { projectId: null, limit: 10 },
    }, signal)
    expect(workspaceActivity.items.map(item => item.action)).toEqual(['workbench.status.updated'])
    const publicJson = JSON.stringify(projectActivity)
    for (const canary of [
      'PROJECT-ACTIVITY-CANARY',
      'GOAL-ACTIVITY-CANARY',
      'OUTCOME-ACTIVITY-CANARY',
      'METRIC-ACTIVITY-CANARY',
      'UNIT-CANARY',
    ]) expect(publicJson).not.toContain(canary)
    const permanentRows = connection(workbench).prepare(`
      SELECT audit.canonical_envelope, audit.summary_fields_json,
        outbox.payload_json, receipt.request_hash
      FROM workbench_audit_event AS audit
      INNER JOIN workbench_outbox AS outbox ON outbox.id = audit.outbox_id
      INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
      WHERE audit.action = 'workbench.project.created'
    `).all()
    const permanentJson = JSON.stringify(permanentRows)
    for (const canary of [
      'PROJECT-ACTIVITY-CANARY',
      'GOAL-ACTIVITY-CANARY',
      'OUTCOME-ACTIVITY-CANARY',
      'METRIC-ACTIVITY-CANARY',
      'UNIT-CANARY',
      KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
    ]) expect(permanentJson).not.toContain(canary)
    await workbench.close()
  })

  it.each([
    ['receipt result', `
      DROP TRIGGER workbench_command_receipt_no_update;
      UPDATE workbench_command_receipt
      SET result_json = json_set(result_json, '$.value.project.name', 'FORGED-PROJECT');
      CREATE TRIGGER workbench_command_receipt_no_update
        BEFORE UPDATE ON workbench_command_receipt
      BEGIN SELECT RAISE(ABORT, 'workbench command receipts are immutable'); END;
    `],
    ['receipt actor scope', `
      DROP TRIGGER workbench_command_receipt_no_update;
      UPDATE workbench_command_receipt SET actor_id = 'forged-owner';
      CREATE TRIGGER workbench_command_receipt_no_update
        BEFORE UPDATE ON workbench_command_receipt
      BEGIN SELECT RAISE(ABORT, 'workbench command receipts are immutable'); END;
    `],
    ['Outbox organization scope', `
      DROP TRIGGER workbench_outbox_intent_no_update;
      UPDATE workbench_outbox SET organization_id = 'forged-organization';
      CREATE TRIGGER workbench_outbox_intent_no_update BEFORE UPDATE OF
        id, command_id, organization_id, topic, effect_key, project_id,
        object_type, object_id, object_version, causation_id, payload_json, created_at
        ON workbench_outbox
      BEGIN SELECT RAISE(ABORT, 'workbench Outbox intent is immutable'); END;
    `],
    ['Outbox payload', `
      DROP TRIGGER workbench_outbox_intent_no_update;
      UPDATE workbench_outbox SET payload_json = '{"forged":true}';
      CREATE TRIGGER workbench_outbox_intent_no_update BEFORE UPDATE OF
        id, command_id, organization_id, topic, effect_key, project_id,
        object_type, object_id, object_version, causation_id, payload_json, created_at
        ON workbench_outbox
      BEGIN SELECT RAISE(ABORT, 'workbench Outbox intent is immutable'); END;
    `],
  ] as const)('rejects forged Project %s during replay and restart ledger validation', async (_label, sql) => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    const original = projectCommand('ledger-forgery', 0)
    await workbench.commitProject(original, signal)
    connection(workbench).exec(sql)
    await expect(workbench.commitProject(original, signal)).rejects.toThrow(
      /request hash|audit and Outbox facts/u,
    )
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/request hash|audit and Outbox facts/u)
    await restarted.close()
  })

  it('rolls back Project creation on pre-commit cancellation and keeps a raced post-commit result', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    const preAborted = new AbortController()
    preAborted.abort(new Error('Project caller left before admission'))
    await expect(workbench.commitProject(projectCommand('cancelled-before', 0), preAborted.signal))
      .rejects.toThrow('Project caller left before admission')

    const database = connection(workbench)
    const during = new AbortController()
    const originalPrepare = database.prepare.bind(database)
    const prepare = vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = originalPrepare(sql)
      if (sql.includes('INSERT INTO workbench_command_receipt')) {
        const originalRun = statement.run.bind(statement)
        vi.spyOn(statement, 'run').mockImplementation((...parameters) => {
          const result = originalRun(...parameters)
          during.abort(new Error('Project caller left before commit'))
          return result
        })
      }
      return statement
    })
    await expect(workbench.commitProject(projectCommand('cancelled-during', 0), during.signal))
      .rejects.toThrow('Project caller left before commit')
    prepare.mockRestore()
    expect(projectArtifactCounts(database)).toEqual({
      projects: { count: 0 }, goals: { count: 0 }, outcomes: { count: 0 },
      snapshots: { count: 0 }, supporting: { count: 0 }, catalog: { revision: 0 },
      outbox: { count: 0 }, audit: { count: 0 }, receipts: { count: 0 },
    })

    const afterCommit = new AbortController()
    const execute = database.exec.bind(database)
    const exec = vi.spyOn(database, 'exec').mockImplementation(sql => {
      const result = execute(sql)
      if (sql === 'COMMIT') afterCommit.abort(new Error('response raced after commit'))
      return result
    })
    await expect(workbench.commitProject(projectCommand('committed-race', 0), afterCommit.signal))
      .resolves.toMatchObject({ ok: true, value: { project: { projectId: 'project-committed-race' } } })
    exec.mockRestore()
    expect(projectArtifactCounts(database)).toMatchObject({
      projects: { count: 1 }, goals: { count: 1 }, outcomes: { count: 1 },
      snapshots: { count: 1 }, catalog: { revision: 1 },
      outbox: { count: 1 }, audit: { count: 1 }, receipts: { count: 1 },
    })
    await workbench.close()
    await expect(workbench.readProject({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-committed-race',
    }, signal)).rejects.toThrow(/not open/u)
    await expect(workbench.commitProject(projectCommand('after-close', 1), signal))
      .rejects.toThrow(/not open/u)
  })
})
