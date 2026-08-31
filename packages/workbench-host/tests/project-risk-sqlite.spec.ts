import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  type WorkbenchProjectMutation,
} from '../src/index.ts'

const temporaryRoots = new Set<string>()
const signal = new AbortController().signal

afterEach(async () => {
  await Promise.all([...temporaryRoots].map(root => rm(root, { recursive: true, force: true })))
  temporaryRoots.clear()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-risk-sqlite-'))
  temporaryRoots.add(root)
  const path = join(root, 'workbench.sqlite')
  const repository = new SqliteWorkbenchRepository({
    databasePath: path,
    journalMode: 'wal',
    busyTimeoutMs: 1_000,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  })
  await repository.open()
  const database = Reflect.get(repository, 'database') as DatabaseSync
  return { path, repository, database }
}

function projectMutation(projectId: string): WorkbenchProjectMutation {
  return {
    projectId,
    primaryGoalId: `goal-${projectId}`,
    projectName: 'Risk migration fixture',
    primaryGoal: {
      name: 'Ship the governed Risk register',
      outcomes: [{
        outcomeId: `outcome-${projectId}`,
        name: 'Risk register is durable',
        metric: {
          metricName: 'Register readiness',
          initialValue: 0,
          targetValue: 1,
          unit: 'state',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    template: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
    expectedCatalogRevision: 0,
    expectedRevision: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    command: {
      commandId: `command-${projectId}`,
      auditEventId: `audit-${projectId}`,
      outboxId: `outbox-${projectId}`,
      idempotencyKey: `idempotency-${projectId}`,
      causationId: `causation-${projectId}`,
      reason: 'owner-project-create',
      actor: {
        kind: 'owner',
        id: 'owner-risk',
        organizationId: 'organization-risk',
        teamId: 'team-risk',
      },
      occurredAt: '2026-09-01T00:00:00.000Z',
    },
  }
}

describe('Project Risk SQLite v11', () => {
  it('installs the Risk aggregate and immutable-history schema', async () => {
    const { repository, database } = await fixture()
    try {
      expect(WORKBENCH_SCHEMA_VERSION).toBe(11)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 })
      const names = (database.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name LIKE 'workbench_project_risk%' OR name LIKE 'workbench_risk_%'
        ORDER BY name
      `).all() as { name: string }[]).map(row => row.name)
      expect(names).toEqual(expect.arrayContaining([
        'workbench_project_risk_head',
        'workbench_project_risk',
        'workbench_project_risk_status_recent',
        'workbench_project_risk_assessment',
        'workbench_project_risk_assessment_member',
        'workbench_project_risk_evidence',
        'workbench_project_risk_dependency',
        'workbench_project_risk_task',
        'workbench_project_risk_transition',
        'workbench_project_risk_activity',
      ]))
    } finally {
      await repository.close()
    }
  })

  it('creates the revision-0 Risk head in the Project creation transaction', async () => {
    const { repository, database } = await fixture()
    try {
      const result = await repository.commitProject(projectMutation('project-risk-head'), signal)
      expect(result.ok).toBe(true)
      expect(database.prepare(`
        SELECT revision, next_risk_sequence, next_activity_sequence
        FROM workbench_project_risk_head WHERE project_id = ?
      `).get('project-risk-head')).toEqual({
        revision: 0,
        next_risk_sequence: 1,
        next_activity_sequence: 1,
      })
    } finally {
      await repository.close()
    }
  })

  it('backfills one revision-0 head per existing Project during v10 to v11 migration', async () => {
    const { path, repository } = await fixture()
    const result = await repository.commitProject(projectMutation('project-risk-backfill'), signal)
    expect(result.ok).toBe(true)
    await repository.close()

    const legacy = new DatabaseSync(path)
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE workbench_project_risk_activity;
      DROP TABLE workbench_project_risk_transition;
      DROP TABLE workbench_project_risk_task;
      DROP TABLE workbench_project_risk_dependency;
      DROP TABLE workbench_project_risk_evidence;
      DROP TABLE workbench_project_risk_assessment_member;
      DROP TABLE workbench_project_risk_assessment;
      DROP TABLE workbench_project_risk;
      DROP TABLE workbench_project_risk_head;
      PRAGMA user_version = 10;
      PRAGMA foreign_keys = ON;
    `)
    legacy.close()

    const upgraded = new SqliteWorkbenchRepository({
      databasePath: path,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    })
    await upgraded.open()
    try {
      const upgradedDatabase = Reflect.get(upgraded, 'database') as DatabaseSync
      expect(upgradedDatabase.prepare(`
        SELECT project_id, revision, next_risk_sequence, next_activity_sequence
        FROM workbench_project_risk_head
      `).all()).toEqual([{
        project_id: 'project-risk-backfill',
        revision: 0,
        next_risk_sequence: 1,
        next_activity_sequence: 1,
      }])
    } finally {
      await upgraded.close()
    }
  })

  it('prevents changing or deleting the Project Risk aggregate scope', async () => {
    const { repository, database } = await fixture()
    try {
      const result = await repository.commitProject(projectMutation('project-risk-trigger'), signal)
      expect(result.ok).toBe(true)
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_head SET team_id = 'another-team' WHERE project_id = ?
      `).run('project-risk-trigger')).toThrow('scope is immutable')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_head WHERE project_id = ?
      `).run('project-risk-trigger')).toThrow('cannot be deleted')
    } finally {
      await repository.close()
    }
  })

  it('rejects a v11 database missing a required Project Risk filter index', async () => {
    const { path, repository } = await fixture()
    await repository.close()
    const tampered = new DatabaseSync(path)
    tampered.exec('DROP INDEX workbench_project_risk_status_recent')
    tampered.close()

    const reopened = new SqliteWorkbenchRepository({
      databasePath: path,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await expect(reopened.open()).rejects.toThrow(
      'missing index workbench_project_risk_status_recent',
    )
  })
})
