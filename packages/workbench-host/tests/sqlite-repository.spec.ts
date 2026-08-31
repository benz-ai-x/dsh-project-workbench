import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AddProjectMemberResult,
  CreateProjectResult,
  SetStatusResult,
  WorkbenchProjectMutation,
  WorkbenchProjectMemberMutation,
  WorkbenchProjectMemberStatusMutation,
  WorkbenchProjectResponsibilityMutation,
  WorkbenchStatusMutation,
  WorkbenchSuggestedChangeDecisionMutation,
  WorkbenchSuggestedChangeProposalMutation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_SQLITE_APPLICATION_ID,
} from '../src/index.ts'
import { canonicalizeJson } from '../src/audit.ts'

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

function dropTaskFederationSchema(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER workbench_feishu_task_workflow_operation_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_operation_intent_no_update;
    DROP TRIGGER workbench_feishu_task_workflow_version_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_version_no_update;
    DROP TRIGGER workbench_feishu_task_workflow_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_scope_no_update;
    DROP TRIGGER workbench_feishu_task_effect_no_delete;
    DROP TRIGGER workbench_feishu_task_effect_intent_no_update;
    DROP TRIGGER workbench_feishu_task_reconciliation_no_delete;
    DROP TRIGGER workbench_feishu_task_reconciliation_no_update;
    DROP TRIGGER workbench_feishu_task_inbox_no_delete;
    DROP TRIGGER workbench_feishu_task_inbox_no_update;
    DROP TRIGGER workbench_feishu_task_reference_no_delete;
    DROP TRIGGER workbench_feishu_task_reference_no_update;
    DROP TRIGGER workbench_feishu_task_binding_no_delete;
    DROP TRIGGER workbench_feishu_task_binding_scope_no_update;
    DROP TABLE workbench_feishu_task_custom_value;
    DROP TABLE workbench_feishu_task_workflow_operation;
    DROP TABLE workbench_feishu_task_workflow_version;
    DROP TABLE workbench_feishu_task_workflow;
    DROP TABLE workbench_feishu_task_effect;
    DROP TABLE workbench_feishu_task_reference;
    DROP TABLE workbench_feishu_task_inbox;
    DROP TABLE workbench_feishu_task_reconciliation;
    DROP TABLE workbench_feishu_task_projection;
    DROP TABLE workbench_feishu_task_binding;
  `)
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

function memberCommand(
  suffix: string,
  expectedTeamRevision: number,
  member: WorkbenchProjectMemberMutation['member'],
  options: {
    readonly projectId?: string
    readonly organizationId?: string
    readonly teamId?: string
    readonly idempotencyKey?: string
    readonly minute?: number
  } = {},
): WorkbenchProjectMemberMutation {
  const minute = options.minute ?? Math.min(expectedTeamRevision + 1, 59)
  const instant = `2026-08-31T10:${String(minute).padStart(2, '0')}:00.000Z`
  return {
    projectId: options.projectId ?? 'project-team',
    memberId: `member-${suffix}`,
    member,
    expectedTeamRevision,
    expectedRevision: null,
    createdAt: instant,
    command: {
      commandId: `command-member-${suffix}`,
      auditEventId: `audit-member-${suffix}`,
      outboxId: `outbox-member-${suffix}`,
      idempotencyKey: options.idempotencyKey ?? `member-key-${suffix.padStart(6, '0')}`,
      causationId: `member-cause-${suffix.padStart(6, '0')}`,
      reason: 'owner-project-member-add',
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

function memberStatusCommand(
  suffix: string,
  memberId: string,
  status: 'active' | 'inactive',
  expectedTeamRevision: number,
  expectedMemberRevision: number,
  options: {
    readonly projectId?: string
    readonly idempotencyKey?: string
    readonly minute?: number
  } = {},
): WorkbenchProjectMemberStatusMutation {
  const minute = options.minute ?? Math.min(expectedTeamRevision + 1, 59)
  const instant = `2026-08-31T11:${String(minute).padStart(2, '0')}:00.000Z`
  return {
    projectId: options.projectId ?? 'project-team',
    memberId,
    status,
    expectedTeamRevision,
    expectedMemberRevision,
    updatedAt: instant,
    command: {
      commandId: `command-member-status-${suffix}`,
      auditEventId: `audit-member-status-${suffix}`,
      outboxId: `outbox-member-status-${suffix}`,
      idempotencyKey: options.idempotencyKey ?? `status-key-${suffix.padStart(6, '0')}`,
      causationId: `status-cause-${suffix.padStart(6, '0')}`,
      reason: 'owner-project-member-status-change',
      actor: {
        kind: 'owner', id: 'owner-test',
        organizationId: 'organization-test', teamId: 'team-test',
      },
      occurredAt: instant,
    },
  }
}

function responsibilityCommand(
  suffix: string,
  expectedTeamRevision: number,
  expectedResponsibilityRevision: number | null,
  accountableMemberId: string,
  contributorMemberIds: readonly string[] = [],
  humanSponsorMemberId: string | null = null,
  projectId = 'project-team',
): WorkbenchProjectResponsibilityMutation {
  const minute = Math.min(expectedTeamRevision + 1, 59)
  const instant = `2026-08-31T12:${String(minute).padStart(2, '0')}:00.000Z`
  return {
    projectId,
    accountableMemberId,
    contributorMemberIds,
    humanSponsorMemberId,
    expectedTeamRevision,
    expectedResponsibilityRevision,
    updatedAt: instant,
    command: {
      commandId: `command-responsibility-${suffix}`,
      auditEventId: `audit-responsibility-${suffix}`,
      outboxId: `outbox-responsibility-${suffix}`,
      idempotencyKey: `responsibility-key-${suffix.padStart(6, '0')}`,
      causationId: `responsibility-cause-${suffix.padStart(6, '0')}`,
      reason: 'owner-project-responsibility-set',
      actor: {
        kind: 'owner', id: 'owner-test',
        organizationId: 'organization-test', teamId: 'team-test',
      },
      occurredAt: instant,
    },
  }
}

function suggestedChangeProposalCommand(
  suffix: string,
  expectedTeamRevision: number,
  candidate: WorkbenchSuggestedChangeProposalMutation['candidate'],
  evidenceAuditIds: readonly string[] = ['audit-project-team'],
): WorkbenchSuggestedChangeProposalMutation {
  const instant = `2026-08-31T13:${String(Math.min(expectedTeamRevision + 1, 59)).padStart(2, '0')}:00.000Z`
  return {
    suggestedChangeId: `suggested-change-${suffix}`,
    projectId: 'project-team',
    candidate,
    evidenceRefs: evidenceAuditIds.map(auditEventId => ({
      kind: 'workbench-audit-event' as const,
      auditEventId,
    })),
    expectedTeamRevision,
    expectedRevision: null,
    createdAt: instant,
    command: {
      commandId: `command-suggested-${suffix}`,
      auditEventId: `audit-suggested-${suffix}`,
      outboxId: `outbox-suggested-${suffix}`,
      idempotencyKey: `suggested-key-${suffix.padStart(8, '0')}`,
      causationId: `suggested-cause-${suffix.padStart(8, '0')}`,
      reason: 'owner-suggested-change-propose',
      actor: {
        kind: 'owner', id: 'owner-test',
        organizationId: 'organization-test', teamId: 'team-test',
      },
      occurredAt: instant,
    },
  }
}

function suggestedChangeDecisionCommand(
  suffix: string,
  suggestedChangeId: string,
  expectedSuggestedChangeRevision: number,
  mode: 'accept' | 'edit-and-accept' | 'reject' | 'defer',
  options: {
    readonly acknowledgedRiskLevel?: 'low' | 'high'
    readonly candidate?: WorkbenchSuggestedChangeProposalMutation['candidate']
    readonly feedback?: string
  } = {},
): WorkbenchSuggestedChangeDecisionMutation {
  const instant = `2026-08-31T14:${String(Math.min(expectedSuggestedChangeRevision, 59)).padStart(2, '0')}:00.000Z`
  const common = {
    decisionId: `decision-${suffix}`,
    projectId: 'project-team',
    suggestedChangeId,
    expectedSuggestedChangeRevision,
    feedback: options.feedback ?? `Reviewed ${suffix}`,
    decidedAt: instant,
  }
  const command = {
    commandId: `command-decision-${suffix}`,
    auditEventId: `audit-decision-${suffix}`,
    outboxId: `outbox-decision-${suffix}`,
    idempotencyKey: `decision-key-${suffix.padStart(8, '0')}`,
    causationId: `decision-cause-${suffix.padStart(8, '0')}`,
    actor: {
      kind: 'owner' as const, id: 'owner-test',
      organizationId: 'organization-test', teamId: 'team-test',
    },
    occurredAt: instant,
  }
  if (mode === 'accept') return {
    ...common,
    mode,
    acknowledgedRiskLevel: options.acknowledgedRiskLevel ?? 'high',
    command: { ...command, reason: 'owner-suggested-change-accept' },
  }
  if (mode === 'edit-and-accept') return {
    ...common,
    mode,
    acknowledgedRiskLevel: options.acknowledgedRiskLevel ?? 'high',
    candidate: options.candidate ?? {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
    },
    command: { ...command, reason: 'owner-suggested-change-edit-accept' },
  }
  if (mode === 'reject') return {
    ...common,
    mode,
    command: { ...command, reason: 'owner-suggested-change-reject' },
  }
  return {
    ...common,
    mode,
    command: { ...command, reason: 'owner-suggested-change-defer' },
  }
}

async function createReviewFixture(workbench: SqliteWorkbenchRepository): Promise<void> {
  await createTeamProject(workbench)
  await workbench.commitProjectMember(memberCommand('review-owner', 0, {
    kind: 'human', displayName: 'Review Owner',
    identity: { type: 'feishu', appId: 'app', openId: 'ou_review_owner' },
  }), signal)
  await workbench.commitProjectMember(memberCommand('review-contributor', 1, {
    kind: 'human', displayName: 'Review Contributor',
    identity: { type: 'feishu', appId: 'app', openId: 'ou_review_contributor' },
  }), signal)
}

async function createTeamProject(workbench: SqliteWorkbenchRepository): Promise<void> {
  const result = await workbench.commitProject(projectCommand('team', 0), signal)
  if (!result.ok) throw new Error('expected Team fixture Project')
}

function teamArtifactCounts(database: DatabaseSync) {
  return {
    heads: database.prepare('SELECT COUNT(*) AS count FROM workbench_project_team_head').get(),
    members: database.prepare('SELECT COUNT(*) AS count FROM workbench_project_member').get(),
    responsibilityVersions: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_version
    `).get(),
    contributors: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_contributor
    `).get(),
    teamRevision: database.prepare(`
      SELECT team_revision, current_responsibility_revision
      FROM workbench_project_team_head WHERE project_id = 'project-team'
    `).get(),
    outbox: database.prepare('SELECT COUNT(*) AS count FROM workbench_outbox').get(),
    audit: database.prepare('SELECT COUNT(*) AS count FROM workbench_audit_event').get(),
    receipts: database.prepare('SELECT COUNT(*) AS count FROM workbench_command_receipt').get(),
  }
}

function suggestedChangeArtifactCounts(database: DatabaseSync) {
  return {
    suggestions: database.prepare('SELECT COUNT(*) AS count FROM workbench_suggested_change').get(),
    evidence: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_suggested_change_evidence
    `).get(),
    decisions: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_suggested_change_decision
    `).get(),
    responsibilityVersions: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_version
    `).get(),
    contributors: database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_contributor
    `).get(),
    team: database.prepare(`
      SELECT team_revision, current_responsibility_revision
      FROM workbench_project_team_head WHERE project_id = 'project-team'
    `).get(),
    outbox: database.prepare('SELECT COUNT(*) AS count FROM workbench_outbox').get(),
    audit: database.prepare('SELECT COUNT(*) AS count FROM workbench_audit_event').get(),
    receipts: database.prepare('SELECT COUNT(*) AS count FROM workbench_command_receipt').get(),
    auditHead: database.prepare(`
      SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1
    `).get(),
  }
}

function bypassReceiptImmutability(database: DatabaseSync, tamper: () => void): void {
  database.exec('DROP TRIGGER workbench_command_receipt_no_update')
  try {
    tamper()
  } finally {
    database.exec(`
      CREATE TRIGGER workbench_command_receipt_no_update
        BEFORE UPDATE ON workbench_command_receipt
      BEGIN SELECT RAISE(ABORT, 'workbench command receipts are immutable'); END
    `)
  }
}

function bypassOutboxIntentImmutability(database: DatabaseSync, tamper: () => void): void {
  database.exec('DROP TRIGGER workbench_outbox_intent_no_update')
  try {
    tamper()
  } finally {
    database.exec(`
      CREATE TRIGGER workbench_outbox_intent_no_update BEFORE UPDATE OF
        id, command_id, organization_id, topic, effect_key, project_id,
        object_type, object_id, object_version, causation_id, payload_json, created_at
        ON workbench_outbox
      BEGIN SELECT RAISE(ABORT, 'workbench Outbox intent is immutable'); END
    `)
  }
}

function forgeReceiptAndOutbox(
  database: DatabaseSync,
  commandId: string,
  mutateResult: (result: Record<string, unknown>) => void,
  mutatePayload: (payload: Record<string, unknown>) => void,
  requestHash?: string,
): void {
  const row = database.prepare(`
    SELECT receipt.result_json, receipt.outbox_id, outbox.payload_json
    FROM workbench_command_receipt AS receipt
    INNER JOIN workbench_outbox AS outbox ON outbox.id = receipt.outbox_id
    WHERE receipt.command_id = ?
  `).get(commandId) as {
    readonly result_json: string
    readonly outbox_id: string
    readonly payload_json: string
  }
  const result = JSON.parse(row.result_json) as Record<string, unknown>
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>
  mutateResult(result)
  mutatePayload(payload)
  bypassReceiptImmutability(database, () => {
    if (requestHash === undefined) {
      database.prepare(`
        UPDATE workbench_command_receipt SET result_json = ? WHERE command_id = ?
      `).run(canonicalizeJson(result), commandId)
      return
    }
    database.prepare(`
      UPDATE workbench_command_receipt SET result_json = ?, request_hash = ?
      WHERE command_id = ?
    `).run(canonicalizeJson(result), requestHash, commandId)
  })
  bypassOutboxIntentImmutability(database, () => {
    database.prepare(`
      UPDATE workbench_outbox SET payload_json = ? WHERE id = ?
    `).run(canonicalizeJson(payload), row.outbox_id)
  })
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

  it('migrates v2 through v8, seeds the exact template, and preserves the T03 ledger', async () => {
    const path = await databasePath()
    const seeded = repository(path)
    await seeded.open()
    await seeded.commitStatus(command('legacy-v2', 'Preserved T03 value', null), signal)
    await seeded.close()

    const legacy = new DatabaseSync(path)
    dropTaskFederationSchema(legacy)
    legacy.exec(`
      DROP TRIGGER workbench_feishu_verification_no_delete;
      DROP TRIGGER workbench_feishu_verification_no_update;
      DROP TRIGGER workbench_feishu_binding_no_delete;
      DROP TRIGGER workbench_feishu_binding_no_update;
      DROP TRIGGER workbench_feishu_route_no_delete;
      DROP TRIGGER workbench_feishu_route_no_update;
      DROP TRIGGER workbench_feishu_connection_no_delete;
      DROP TRIGGER workbench_feishu_connection_scope_no_update;
      DROP TABLE workbench_feishu_identity_binding;
      DROP TABLE workbench_feishu_verification;
      DROP TABLE workbench_feishu_route_version;
      DROP TABLE workbench_feishu_connection;
      DROP TRIGGER workbench_suggested_change_decision_no_delete;
      DROP TRIGGER workbench_suggested_change_decision_no_update;
      DROP TRIGGER workbench_suggested_change_evidence_no_delete;
      DROP TRIGGER workbench_suggested_change_evidence_no_update;
      DROP TRIGGER workbench_suggested_change_no_delete;
      DROP TRIGGER workbench_suggested_change_head_transition;
      DROP TRIGGER workbench_suggested_change_envelope_no_update;
      DROP TABLE workbench_suggested_change_decision;
      DROP TABLE workbench_suggested_change_evidence;
      DROP TABLE workbench_suggested_change;
      DROP TRIGGER workbench_project_responsibility_contributor_no_delete;
      DROP TRIGGER workbench_project_responsibility_contributor_no_update;
      DROP TRIGGER workbench_project_responsibility_no_delete;
      DROP TRIGGER workbench_project_responsibility_no_update;
      DROP TRIGGER workbench_project_member_no_delete;
      DROP TRIGGER workbench_project_member_identity_no_update;
      DROP TRIGGER workbench_project_team_no_delete;
      DROP TRIGGER workbench_project_team_scope_no_update;
      DROP TABLE workbench_project_responsibility_contributor;
      DROP TABLE workbench_project_responsibility_version;
      DROP TABLE workbench_project_member;
      DROP TABLE workbench_project_team_head;
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
      user_version: 8,
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

  it('migrates v3 through v8, backfills one empty Team per Project, and creates heads for new Projects', async () => {
    const path = await databasePath()
    const seeded = repository(path)
    await seeded.open()
    await createTeamProject(seeded)
    await seeded.close()

    const legacy = new DatabaseSync(path)
    dropTaskFederationSchema(legacy)
    legacy.exec(`
      DROP TRIGGER workbench_feishu_verification_no_delete;
      DROP TRIGGER workbench_feishu_verification_no_update;
      DROP TRIGGER workbench_feishu_binding_no_delete;
      DROP TRIGGER workbench_feishu_binding_no_update;
      DROP TRIGGER workbench_feishu_route_no_delete;
      DROP TRIGGER workbench_feishu_route_no_update;
      DROP TRIGGER workbench_feishu_connection_no_delete;
      DROP TRIGGER workbench_feishu_connection_scope_no_update;
      DROP TABLE workbench_feishu_identity_binding;
      DROP TABLE workbench_feishu_verification;
      DROP TABLE workbench_feishu_route_version;
      DROP TABLE workbench_feishu_connection;
      DROP TRIGGER workbench_suggested_change_decision_no_delete;
      DROP TRIGGER workbench_suggested_change_decision_no_update;
      DROP TRIGGER workbench_suggested_change_evidence_no_delete;
      DROP TRIGGER workbench_suggested_change_evidence_no_update;
      DROP TRIGGER workbench_suggested_change_no_delete;
      DROP TRIGGER workbench_suggested_change_head_transition;
      DROP TRIGGER workbench_suggested_change_envelope_no_update;
      DROP TABLE workbench_suggested_change_decision;
      DROP TABLE workbench_suggested_change_evidence;
      DROP TABLE workbench_suggested_change;
      DROP TRIGGER workbench_project_responsibility_contributor_no_delete;
      DROP TRIGGER workbench_project_responsibility_contributor_no_update;
      DROP TRIGGER workbench_project_responsibility_no_delete;
      DROP TRIGGER workbench_project_responsibility_no_update;
      DROP TRIGGER workbench_project_member_no_delete;
      DROP TRIGGER workbench_project_member_identity_no_update;
      DROP TRIGGER workbench_project_team_no_delete;
      DROP TRIGGER workbench_project_team_scope_no_update;
      DROP TABLE workbench_project_responsibility_contributor;
      DROP TABLE workbench_project_responsibility_version;
      DROP TABLE workbench_project_member;
      DROP TABLE workbench_project_team_head;
      PRAGMA user_version = 3;
    `)
    legacy.close()

    const upgraded = repository(path)
    await upgraded.open()
    expect(connection(upgraded).prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    await expect(upgraded.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toEqual({
      projectId: 'project-team', teamRevision: 0, members: [], responsibility: null,
    })
    await expect(upgraded.commitProjectMember(memberCommand('migrated', 0, {
      kind: 'agent', displayName: 'Migrated Agent',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { memberId: 'member-migrated', teamRevision: 1 },
    })
    await upgraded.commitProject(projectCommand('after-v4', 1), signal)
    expect(connection(upgraded).prepare(`
      SELECT project_id, team_revision, current_responsibility_revision
      FROM workbench_project_team_head ORDER BY project_id
    `).all()).toEqual([
      { project_id: 'project-after-v4', team_revision: 0, current_responsibility_revision: null },
      { project_id: 'project-team', team_revision: 1, current_responsibility_revision: null },
    ])
    await upgraded.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toMatchObject({
      teamRevision: 1,
      members: [{ memberId: 'member-migrated', kind: 'agent', status: 'active' }],
    })
    await restarted.close()
  })

  it('migrates an exact v4 database to v8 and validates every SuggestedChange trigger', async () => {
    const path = await databasePath()
    const seeded = repository(path)
    await seeded.open()
    await createTeamProject(seeded)
    await seeded.close()

    const legacy = new DatabaseSync(path)
    dropTaskFederationSchema(legacy)
    legacy.exec(`
      DROP TRIGGER workbench_feishu_verification_no_delete;
      DROP TRIGGER workbench_feishu_verification_no_update;
      DROP TRIGGER workbench_feishu_binding_no_delete;
      DROP TRIGGER workbench_feishu_binding_no_update;
      DROP TRIGGER workbench_feishu_route_no_delete;
      DROP TRIGGER workbench_feishu_route_no_update;
      DROP TRIGGER workbench_feishu_connection_no_delete;
      DROP TRIGGER workbench_feishu_connection_scope_no_update;
      DROP TABLE workbench_feishu_identity_binding;
      DROP TABLE workbench_feishu_verification;
      DROP TABLE workbench_feishu_route_version;
      DROP TABLE workbench_feishu_connection;
      DROP TRIGGER workbench_suggested_change_decision_no_delete;
      DROP TRIGGER workbench_suggested_change_decision_no_update;
      DROP TRIGGER workbench_suggested_change_evidence_no_delete;
      DROP TRIGGER workbench_suggested_change_evidence_no_update;
      DROP TRIGGER workbench_suggested_change_no_delete;
      DROP TRIGGER workbench_suggested_change_head_transition;
      DROP TRIGGER workbench_suggested_change_envelope_no_update;
      DROP TABLE workbench_suggested_change_decision;
      DROP TABLE workbench_suggested_change_evidence;
      DROP TABLE workbench_suggested_change;
      PRAGMA user_version = 4;
    `)
    legacy.close()

    const upgraded = repository(path)
    await upgraded.open()
    const database = connection(upgraded)
    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    expect(database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE 'workbench_suggested_change%'
      ORDER BY name
    `).all()).toEqual([
      { name: 'workbench_suggested_change' },
      { name: 'workbench_suggested_change_decision' },
      { name: 'workbench_suggested_change_evidence' },
    ])
    expect(database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'trigger' AND name LIKE 'workbench_suggested_change%'
      ORDER BY name
    `).all()).toEqual([
      { name: 'workbench_suggested_change_decision_no_delete' },
      { name: 'workbench_suggested_change_decision_no_update' },
      { name: 'workbench_suggested_change_envelope_no_update' },
      { name: 'workbench_suggested_change_evidence_no_delete' },
      { name: 'workbench_suggested_change_evidence_no_update' },
      { name: 'workbench_suggested_change_head_transition' },
      { name: 'workbench_suggested_change_no_delete' },
    ])
    await upgraded.close()

    const missingTrigger = new DatabaseSync(path)
    missingTrigger.exec('DROP TRIGGER workbench_suggested_change_head_transition')
    missingTrigger.close()
    await expect(repository(path).open()).rejects.toThrow(
      /missing trigger workbench_suggested_change_head_transition/u,
    )
  })

  it('persists closed Feishu, external-human, and Agent identities with derived eligibility', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createTeamProject(workbench)
    const feishu = await workbench.commitProjectMember(memberCommand('feishu', 0, {
      kind: 'human', displayName: 'Feishu Human',
      identity: { type: 'feishu', appId: 'cli_app', openId: 'ou_member' },
    }), signal)
    const external = await workbench.commitProjectMember(memberCommand('external', 1, {
      kind: 'human', displayName: 'External Human',
      identity: { type: 'external', method: 'email', value: 'person@example.test' },
    }), signal)
    const agent = await workbench.commitProjectMember(memberCommand('agent', 2, {
      kind: 'agent', displayName: 'Research Agent',
    }), signal)
    expect([feishu, external, agent]).toMatchObject([
      { ok: true, value: { kind: 'human', status: 'active', memberRevision: 1, teamRevision: 1 } },
      { ok: true, value: { kind: 'human', status: 'active', memberRevision: 1, teamRevision: 2 } },
      { ok: true, value: { kind: 'agent', status: 'active', memberRevision: 1, teamRevision: 3 } },
    ])
    const team = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    expect(team).toEqual({
      projectId: 'project-team',
      teamRevision: 3,
      members: [
        {
          memberId: 'member-feishu', projectId: 'project-team', kind: 'human',
          displayName: 'Feishu Human', status: 'active', revision: 1,
          identity: { type: 'feishu', appId: 'cli_app', openId: 'ou_member', state: 'declared' },
          feishuAssigneeEligibility: 'identifier-present',
          createdAt: '2026-08-31T10:01:00.000Z', updatedAt: '2026-08-31T10:01:00.000Z',
        },
        {
          memberId: 'member-external', projectId: 'project-team', kind: 'human',
          displayName: 'External Human', status: 'active', revision: 1,
          identity: { type: 'external', method: 'email', value: 'person@example.test' },
          feishuAssigneeEligibility: 'external-contact',
          createdAt: '2026-08-31T10:02:00.000Z', updatedAt: '2026-08-31T10:02:00.000Z',
        },
        {
          memberId: 'member-agent', projectId: 'project-team', kind: 'agent',
          displayName: 'Research Agent', status: 'active', revision: 1,
          feishuAssigneeEligibility: 'agent-not-assignable',
          createdAt: '2026-08-31T10:03:00.000Z', updatedAt: '2026-08-31T10:03:00.000Z',
        },
      ],
      responsibility: null,
    })
    expect(Object.isFrozen(team?.members)).toBe(true)
    expect(Object.isFrozen(team?.members[0]?.kind === 'human' ? team.members[0].identity : null)).toBe(true)
    await expect(workbench.readProjectTeam({
      organizationId: 'organization-other', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toBeNull()
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toEqual(team)
    await restarted.close()
  })

  it.each([
    [
      'caller-supplied Feishu state',
      {
        kind: 'human', displayName: 'State injection',
        identity: { type: 'feishu', appId: 'app', openId: 'ou_state', state: 'declared' },
      },
      /unsupported fields/u,
    ],
    [
      'mixed Feishu/external identity',
      {
        kind: 'human', displayName: 'Mixed identity',
        identity: {
          type: 'feishu', appId: 'app', openId: 'ou_mixed', method: 'email', value: 'mixed@test',
        },
      },
      /unsupported fields/u,
    ],
    [
      'Agent identity',
      {
        kind: 'agent', displayName: 'Agent identity injection',
        identity: { type: 'external', method: 'other', value: 'not-allowed' },
      },
      /unsupported fields/u,
    ],
    [
      'Agent profile',
      { kind: 'agent', displayName: 'Agent profile injection', profile: { secret: 'no' } },
      /unsupported fields/u,
    ],
    [
      'unsafe Feishu application id',
      {
        kind: 'human', displayName: 'Unsafe app id',
        identity: { type: 'feishu', appId: 'app/unsafe', openId: 'ou_safe' },
      },
      /bounded safe identifier/u,
    ],
    [
      'unsafe Feishu open id',
      {
        kind: 'human', displayName: 'Unsafe open id',
        identity: { type: 'feishu', appId: 'app_safe', openId: 'ou unsafe' },
      },
      /bounded safe identifier/u,
    ],
    [
      'oversized Feishu application id',
      {
        kind: 'human', displayName: 'Oversized app id',
        identity: { type: 'feishu', appId: `a${'x'.repeat(128)}`, openId: 'ou_safe' },
      },
      /at most 128/u,
    ],
    [
      'missing human identity',
      { kind: 'human', displayName: 'Missing identity' },
      /unsupported fields/u,
    ],
    [
      'unsupported human identity',
      {
        kind: 'human', displayName: 'Unsupported identity',
        identity: { type: 'directory', directoryId: 'person-one' },
      },
      /identity type is unsupported/u,
    ],
    [
      'unsupported external method',
      {
        kind: 'human', displayName: 'Unsupported external method',
        identity: { type: 'external', method: 'fax', value: '1234' },
      },
      /contact method is invalid/u,
    ],
    [
      'control-bearing external contact',
      {
        kind: 'human', displayName: 'Unsafe external',
        identity: { type: 'external', method: 'other', value: 'line-one\nline-two' },
      },
      /trimmed text/u,
    ],
    [
      'oversized external contact',
      {
        kind: 'human', displayName: 'Oversized external',
        identity: { type: 'external', method: 'other', value: 'x'.repeat(321) },
      },
      /1 to 320/u,
    ],
  ] as const)('rejects %s without creating Team artifacts', async (_label, member, error) => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createTeamProject(workbench)
    const baseline = teamArtifactCounts(connection(workbench))
    const mutation: WorkbenchProjectMemberMutation = {
      ...memberCommand('invalid-shape', 0, {
        kind: 'agent', displayName: 'placeholder',
      }),
      member: member as unknown as WorkbenchProjectMemberMutation['member'],
    }
    await expect(workbench.commitProjectMember(mutation, signal)).rejects.toThrow(error)
    expect(teamArtifactCounts(connection(workbench))).toEqual(baseline)
    await workbench.close()
  })

  it('enforces scoped Feishu uniqueness, member CAS, and typed no-op or missing conflicts', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createTeamProject(workbench)
    await expect(workbench.commitProjectMember(memberCommand('missing-project', 0, {
      kind: 'agent', displayName: 'Missing Project',
    }, { projectId: 'project-missing' }), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'project-not-found', projectId: 'project-missing' },
    })
    await workbench.commitProjectMember(memberCommand('unique-one', 0, {
      kind: 'human', displayName: 'First',
      identity: { type: 'feishu', appId: 'app-one', openId: 'ou_same' },
    }), signal)
    const baseline = teamArtifactCounts(connection(workbench))
    await expect(workbench.commitProjectMember(memberCommand('duplicate', 1, {
      kind: 'human', displayName: 'Duplicate',
      identity: { type: 'feishu', appId: 'app-one', openId: 'ou_same' },
    }), signal)).resolves.toMatchObject({ ok: false, error: { code: 'duplicate-feishu-identity' } })
    await expect(workbench.commitProjectMember(memberCommand('stale-team', 0, {
      kind: 'agent', displayName: 'Stale',
    }), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'team-revision-conflict', currentTeamRevision: 1 },
    })
    expect(teamArtifactCounts(connection(workbench))).toEqual(baseline)
    await expect(workbench.commitProjectMember(memberCommand('other-app', 1, {
      kind: 'human', displayName: 'Other app',
      identity: { type: 'feishu', appId: 'app-two', openId: 'ou_same' },
    }), signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 2 } })
    await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
      'stale-team', 'member-unique-one', 'inactive', 1, 1,
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'team-revision-conflict', currentTeamRevision: 2 },
    })
    await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
      'missing', 'member-missing', 'inactive', 2, 1,
    ), signal)).resolves.toMatchObject({ ok: false, error: { code: 'member-not-found' } })
    await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
      'revision', 'member-unique-one', 'inactive', 2, 2,
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'member-revision-conflict', currentMemberRevision: 1 },
    })
    await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
      'same-state', 'member-unique-one', 'active', 2, 1,
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'member-status-conflict', status: 'active' },
    })
    await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
      'inactive', 'member-unique-one', 'inactive', 2, 1,
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: { status: 'inactive', memberRevision: 2, teamRevision: 3 },
    })
    const inactive = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    expect(inactive?.members.find(member => member.memberId === 'member-unique-one'))
      .toMatchObject({ status: 'inactive', revision: 2, feishuAssigneeEligibility: 'inactive' })
    await workbench.close()
  })

  it('enforces Accountable, Contributor, Sponsor, active, same-Project, and in-use policies', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createTeamProject(workbench)
    await workbench.commitProject(projectCommand('other-team', 1), signal)
    await workbench.commitProjectMember(memberCommand('cross-project', 0, {
      kind: 'human', displayName: 'Cross Project Human',
      identity: { type: 'feishu', appId: 'app', openId: 'ou_cross' },
    }, { projectId: 'project-other-team' }), signal)
    await workbench.commitProjectMember(memberCommand('feishu-owner', 0, {
      kind: 'human', displayName: 'Declared Human',
      identity: { type: 'feishu', appId: 'app', openId: 'ou_owner' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('external', 1, {
      kind: 'human', displayName: 'External Human',
      identity: { type: 'external', method: 'other', value: 'external-reference' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('agent', 2, {
      kind: 'agent', displayName: 'Accountable Agent',
    }), signal)
    await workbench.commitProjectMember(memberCommand('sponsor', 3, {
      kind: 'human', displayName: 'Human Sponsor',
      identity: { type: 'feishu', appId: 'app', openId: 'ou_sponsor' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('inactive', 4, {
      kind: 'human', displayName: 'Inactive Human',
      identity: { type: 'external', method: 'phone', value: '+86-000-0000' },
    }), signal)
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'make-inactive', 'member-inactive', 'inactive', 5, 1,
    ), signal)

    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'stale-team', 5, null, 'member-feishu-owner', [], null,
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'team-revision-conflict', currentTeamRevision: 6 },
    })

    for (const [label, mutation, code] of [
      [
        'missing',
        responsibilityCommand('missing', 6, null, 'member-missing'),
        'member-not-found',
      ],
      [
        'cross Project',
        responsibilityCommand('cross', 6, null, 'member-cross-project'),
        'member-not-found',
      ],
      [
        'inactive',
        responsibilityCommand('inactive', 6, null, 'member-inactive', [], 'member-sponsor'),
        'member-inactive',
      ],
      [
        'missing Contributor',
        responsibilityCommand('missing-contributor', 6, null, 'member-feishu-owner', ['member-missing']),
        'member-not-found',
      ],
      [
        'inactive Contributor',
        responsibilityCommand('inactive-contributor', 6, null, 'member-feishu-owner', ['member-inactive']),
        'member-inactive',
      ],
      [
        'cross-Project Sponsor',
        responsibilityCommand('cross-sponsor', 6, null, 'member-external', [], 'member-cross-project'),
        'member-not-found',
      ],
      [
        'inactive Sponsor',
        responsibilityCommand('inactive-sponsor', 6, null, 'member-external', [], 'member-inactive'),
        'member-inactive',
      ],
      [
        'Accountable contributor overlap',
        responsibilityCommand('overlap', 6, null, 'member-feishu-owner', ['member-feishu-owner']),
        'accountable-also-contributor',
      ],
      [
        'Agent without Sponsor',
        responsibilityCommand('agent-no-sponsor', 6, null, 'member-agent'),
        'human-sponsor-required',
      ],
      [
        'external without Sponsor',
        responsibilityCommand('external-no-sponsor', 6, null, 'member-external'),
        'human-sponsor-required',
      ],
      [
        'Agent Sponsor',
        responsibilityCommand(
          'agent-sponsor', 6, null, 'member-external', [], 'member-agent',
        ),
        'human-sponsor-invalid',
      ],
      [
        'self Sponsor',
        responsibilityCommand(
          'self-sponsor', 6, null, 'member-external', [], 'member-external',
        ),
        'human-sponsor-invalid',
      ],
      [
        'declared human Sponsor forbidden',
        responsibilityCommand(
          'forbidden-sponsor', 6, null, 'member-feishu-owner', [], 'member-sponsor',
        ),
        'human-sponsor-forbidden',
      ],
    ] as const) {
      await expect(workbench.commitProjectResponsibility(mutation, signal), label)
        .resolves.toMatchObject({ ok: false, error: { code } })
    }
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'duplicate-contributor', 6, null, 'member-feishu-owner',
      ['member-external', 'member-external'],
    ), signal)).rejects.toThrow(/must be unique/u)
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'unsorted-contributors', 6, null, 'member-feishu-owner',
      ['member-sponsor', 'member-external'],
    ), signal)).rejects.toThrow(/canonical sorted/u)
    expect(teamArtifactCounts(connection(workbench))).toMatchObject({
      members: { count: 6 },
      responsibilityVersions: { count: 0 }, contributors: { count: 0 },
      teamRevision: { team_revision: 6, current_responsibility_revision: null },
    })

    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'agent-valid',
      6,
      null,
      'member-agent',
      ['member-external', 'member-sponsor'],
      'member-sponsor',
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: { responsibilityRevision: 1, teamRevision: 7 },
    })
    const assigned = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    expect(assigned?.responsibility).toEqual({
      projectId: 'project-team', revision: 1,
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-external', 'member-sponsor'],
      humanSponsorMemberId: 'member-sponsor',
      updatedAt: '2026-08-31T12:07:00.000Z',
    })
    for (const memberId of ['member-agent', 'member-external', 'member-sponsor']) {
      await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
        `in-use-${memberId}`, memberId, 'inactive', 7, 1,
      ), signal)).resolves.toMatchObject({
        ok: false, error: { code: 'member-in-use', memberId },
      })
    }
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'stale-responsibility', 7, null, 'member-feishu-owner', [], null,
    ), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'responsibility-revision-conflict',
        currentResponsibilityRevision: 1,
      },
    })
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'human-valid', 7, 1, 'member-feishu-owner', [], null,
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: { responsibilityRevision: 2, teamRevision: 8 },
    })
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'retire-agent', 'member-agent', 'inactive', 8, 1,
    ), signal)
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'retire-external', 'member-external', 'inactive', 9, 1,
    ), signal)
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'retire-sponsor', 'member-sponsor', 'inactive', 10, 1,
    ), signal)
    const retained = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    expect(retained).toMatchObject({
      teamRevision: 11,
      responsibility: {
        revision: 2,
        accountableMemberId: 'member-feishu-owner',
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
    })
    expect(retained?.members.filter(member => member.status === 'inactive')
      .map(member => member.memberId).sort())
      .toEqual(['member-agent', 'member-external', 'member-inactive', 'member-sponsor'].sort())
    expect(connection(workbench).prepare(`
      SELECT revision, accountable_member_id, human_sponsor_member_id
      FROM workbench_project_responsibility_version
      WHERE project_id = 'project-team' ORDER BY revision
    `).all()).toEqual([
      { revision: 1, accountable_member_id: 'member-agent', human_sponsor_member_id: 'member-sponsor' },
      { revision: 2, accountable_member_id: 'member-feishu-owner', human_sponsor_member_id: null },
    ])
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toEqual(retained)
    expect(connection(restarted).prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_version
      WHERE project_id = 'project-team'
    `).get()).toEqual({ count: 2 })
    await restarted.close()
  })

  it('enforces exactly one hundred retained members and at most twenty Contributors', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createTeamProject(workbench)
    for (let index = 0; index < 100; index += 1) {
      const suffix = `limit-${String(index).padStart(3, '0')}`
      const member = index === 0
        ? {
          kind: 'human' as const,
          displayName: 'Limit Accountable',
          identity: { type: 'feishu' as const, appId: 'app', openId: 'ou_limit_owner' },
        }
        : { kind: 'agent' as const, displayName: `Limit Agent ${String(index)}` }
      const result = await workbench.commitProjectMember(
        memberCommand(suffix, index, member),
        signal,
      )
      expect(result).toMatchObject({ ok: true, value: { teamRevision: index + 1 } })
    }
    const beforeLimit = teamArtifactCounts(connection(workbench))
    await expect(workbench.commitProjectMember(memberCommand('limit-overflow', 100, {
      kind: 'agent', displayName: 'One too many',
    }), signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'member-limit-reached',
        message: 'Workbench Project Team already contains 100 members',
        limit: 100,
      },
    })
    expect(teamArtifactCounts(connection(workbench))).toEqual(beforeLimit)

    const twenty = Array.from(
      { length: 20 },
      (_, index) => `member-limit-${String(index + 1).padStart(3, '0')}`,
    )
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'twenty', 100, null, 'member-limit-000', twenty,
    ), signal)).resolves.toMatchObject({
      ok: true, value: { responsibilityRevision: 1, teamRevision: 101 },
    })
    expect((await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal))?.responsibility?.contributorMemberIds).toEqual(twenty)
    const twentyOne = [...twenty, 'member-limit-021']
    await expect(workbench.commitProjectResponsibility(responsibilityCommand(
      'twenty-one', 101, 1, 'member-limit-000', twentyOne,
    ), signal)).rejects.toThrow(/at most 20 Contributors/u)
    expect(teamArtifactCounts(connection(workbench))).toMatchObject({
      members: { count: 100 },
      responsibilityVersions: { count: 1 }, contributors: { count: 20 },
      teamRevision: { team_revision: 101, current_responsibility_revision: 1 },
    })
    await workbench.close()
  })

  it('replays all three PII-free acknowledgements exactly after later changes and restart', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createTeamProject(workbench)
    const addOriginal = memberCommand('replay-external', 0, {
      kind: 'human', displayName: 'Replay External PII',
      identity: { type: 'external', method: 'email', value: 'replay@example.test' },
    }, { idempotencyKey: 'stable-member-replay-key' })
    const addResult = await workbench.commitProjectMember(addOriginal, signal)
    const statusOriginal = memberStatusCommand(
      'replay-inactive', 'member-replay-external', 'inactive', 1, 1,
      { idempotencyKey: 'stable-status-replay-key' },
    )
    const statusResult = await workbench.commitProjectMemberStatus(statusOriginal, signal)
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'later-reactivation', 'member-replay-external', 'active', 2, 2,
    ), signal)
    await workbench.commitProjectMember(memberCommand('replay-sponsor', 3, {
      kind: 'human', displayName: 'Replay Sponsor PII',
      identity: { type: 'feishu', appId: 'app_replay', openId: 'ou_replay_sponsor' },
    }), signal)
    const responsibilityOriginal = responsibilityCommand(
      'replay-original', 4, null, 'member-replay-external', [], 'member-replay-sponsor',
    )
    const responsibilityResult = await workbench.commitProjectResponsibility(
      responsibilityOriginal,
      signal,
    )
    await workbench.commitProjectResponsibility(responsibilityCommand(
      'later-replacement', 5, 1, 'member-replay-sponsor', [], null,
    ), signal)

    const addRetry: WorkbenchProjectMemberMutation = {
      ...addOriginal,
      memberId: 'member-regenerated-on-retry',
      createdAt: '2026-08-31T20:00:00.000Z',
      command: {
        ...addOriginal.command,
        commandId: 'command-regenerated-add',
        auditEventId: 'audit-regenerated-add',
        outboxId: 'outbox-regenerated-add',
        occurredAt: '2026-08-31T20:00:00.000Z',
      },
    }
    const statusRetry: WorkbenchProjectMemberStatusMutation = {
      ...statusOriginal,
      updatedAt: '2026-08-31T20:01:00.000Z',
      command: {
        ...statusOriginal.command,
        commandId: 'command-regenerated-status',
        auditEventId: 'audit-regenerated-status',
        outboxId: 'outbox-regenerated-status',
        occurredAt: '2026-08-31T20:01:00.000Z',
      },
    }
    const responsibilityRetry: WorkbenchProjectResponsibilityMutation = {
      ...responsibilityOriginal,
      updatedAt: '2026-08-31T20:02:00.000Z',
      command: {
        ...responsibilityOriginal.command,
        commandId: 'command-regenerated-responsibility',
        auditEventId: 'audit-regenerated-responsibility',
        outboxId: 'outbox-regenerated-responsibility',
        occurredAt: '2026-08-31T20:02:00.000Z',
      },
    }
    await expect(workbench.commitProjectMember(addRetry, signal)).resolves.toEqual(addResult)
    await expect(workbench.commitProjectMemberStatus(statusRetry, signal)).resolves.toEqual(statusResult)
    await expect(workbench.commitProjectResponsibility(responsibilityRetry, signal))
      .resolves.toEqual(responsibilityResult)
    const beforeConflicts = teamArtifactCounts(connection(workbench))
    await expect(workbench.commitProjectMember({
      ...addRetry,
      member: { ...addRetry.member, displayName: 'Changed replay intent' },
    }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'idempotency-conflict' } })
    await expect(workbench.commitProjectMemberStatus({
      ...statusRetry,
      status: 'active',
    }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'idempotency-conflict' } })
    await expect(workbench.commitProjectResponsibility({
      ...responsibilityRetry,
      contributorMemberIds: ['member-replay-sponsor'],
    }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'idempotency-conflict' } })
    expect(teamArtifactCounts(connection(workbench))).toEqual(beforeConflicts)
    const counts = teamArtifactCounts(connection(workbench))
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.commitProjectMember(addRetry, signal)).resolves.toEqual(addResult)
    await expect(restarted.commitProjectMemberStatus(statusRetry, signal)).resolves.toEqual(statusResult)
    await expect(restarted.commitProjectResponsibility(responsibilityRetry, signal))
      .resolves.toEqual(responsibilityResult)
    expect(teamArtifactCounts(connection(restarted))).toEqual(counts)
    const receiptJson = JSON.stringify(connection(restarted).prepare(`
      SELECT result_json FROM workbench_command_receipt
      WHERE command_type IN (
        'workbench.project-member.add',
        'workbench.project-member.set-status',
        'workbench.project.set-responsibility'
      )
    `).all())
    for (const pii of [
      'Replay External PII', 'replay@example.test',
      'Replay Sponsor PII', 'app_replay', 'ou_replay_sponsor',
    ]) expect(receiptJson).not.toContain(pii)
    await restarted.close()
  })

  it('projects allowlisted Team Activity and keeps identity PII out of permanent ledgers', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createTeamProject(workbench)
    await workbench.commitProjectMember(memberCommand('activity-sponsor', 0, {
      kind: 'human', displayName: 'FEISHU-DISPLAY-PII-CANARY',
      identity: {
        type: 'feishu', appId: 'app_activity_secret', openId: 'ou_activity_secret',
      },
    }), signal)
    await workbench.commitProjectMember(memberCommand('activity-external', 1, {
      kind: 'human', displayName: 'EXTERNAL-DISPLAY-PII-CANARY',
      identity: { type: 'external', method: 'email', value: 'private-activity@example.test' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('activity-agent', 2, {
      kind: 'agent', displayName: 'AGENT-DISPLAY-PII-CANARY',
    }), signal)
    await workbench.commitProjectMember(memberCommand('activity-retired', 3, {
      kind: 'human', displayName: 'RETIRED-DISPLAY-PII-CANARY',
      identity: { type: 'external', method: 'phone', value: '+86-activity-secret' },
    }), signal)
    await workbench.commitProjectMemberStatus(memberStatusCommand(
      'activity-retire', 'member-activity-retired', 'inactive', 4, 1,
    ), signal)
    await workbench.commitProjectResponsibility(responsibilityCommand(
      'activity',
      5,
      null,
      'member-activity-agent',
      ['member-activity-external'],
      'member-activity-sponsor',
    ), signal)

    const team = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    const teamJson = JSON.stringify(team)
    const pii = [
      'FEISHU-DISPLAY-PII-CANARY', 'app_activity_secret', 'ou_activity_secret',
      'EXTERNAL-DISPLAY-PII-CANARY', 'private-activity@example.test',
      'AGENT-DISPLAY-PII-CANARY', 'RETIRED-DISPLAY-PII-CANARY', '+86-activity-secret',
    ]
    for (const canary of pii) expect(teamJson).toContain(canary)

    const activity = await workbench.readActivity({
      organizationId: 'organization-test',
      filter: { projectId: 'project-team', limit: 20 },
    }, signal)
    expect(activity.items.map(item => item.action)).toEqual([
      'workbench.project.responsibility-assigned',
      'workbench.project-member.status-changed',
      'workbench.project-member.created',
      'workbench.project-member.created',
      'workbench.project-member.created',
      'workbench.project-member.created',
      'workbench.project.created',
    ])
    expect(activity.items[0]).toMatchObject({
      projectId: 'project-team',
      reason: 'owner-project-responsibility-set',
      object: { type: 'project-responsibility', id: 'project-team', version: 1 },
      summaryCode: 'project-responsibility-assigned',
    })
    expect(activity.items[1]).toMatchObject({
      reason: 'owner-project-member-status-change',
      object: { type: 'project-member', id: 'member-activity-retired', version: 2 },
      summaryCode: 'project-member-status-changed',
    })
    expect(activity.items[2]).toMatchObject({
      reason: 'owner-project-member-add',
      object: { type: 'project-member', id: 'member-activity-retired', version: 1 },
      summaryCode: 'project-member-created',
    })
    const permanentRows = connection(workbench).prepare(`
      SELECT audit.canonical_envelope, audit.summary_fields_json,
        outbox.payload_json, receipt.result_json, receipt.request_hash
      FROM workbench_audit_event AS audit
      INNER JOIN workbench_outbox AS outbox ON outbox.id = audit.outbox_id
      INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
      WHERE audit.command_type IN (
        'workbench.project-member.add',
        'workbench.project-member.set-status',
        'workbench.project.set-responsibility'
      )
    `).all()
    const redacted = JSON.stringify({ activity, permanentRows })
    for (const canary of pii) expect(redacted).not.toContain(canary)
    await workbench.close()
  })

  it('converges two SQLite connections for all three Team command receipts', async () => {
    const path = await databasePath()
    const firstConnection = repository(path)
    const secondConnection = repository(path)
    await firstConnection.open()
    await createTeamProject(firstConnection)
    await secondConnection.open()
    const original = memberCommand('concurrent', 0, {
      kind: 'agent', displayName: 'Concurrent Agent',
    }, { idempotencyKey: 'concurrent-member-stable-key' })
    const retry: WorkbenchProjectMemberMutation = {
      ...original,
      memberId: 'member-concurrent-regenerated',
      createdAt: '2026-08-31T20:03:00.000Z',
      command: {
        ...original.command,
        commandId: 'command-concurrent-regenerated',
        auditEventId: 'audit-concurrent-regenerated',
        outboxId: 'outbox-concurrent-regenerated',
        occurredAt: '2026-08-31T20:03:00.000Z',
      },
    }
    const results = await Promise.all([
      firstConnection.commitProjectMember(original, signal),
      secondConnection.commitProjectMember(retry, signal),
    ])
    expect(results[0]).toEqual(results[1])
    expect(results[0]).toMatchObject({
      ok: true,
      value: { memberId: 'member-concurrent', teamRevision: 1 },
      receipt: { commandId: 'command-member-concurrent' },
    })
    await expect(secondConnection.commitProjectMember(memberCommand('stale-writer', 0, {
      kind: 'agent', displayName: 'Stale writer',
    }), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'team-revision-conflict', currentTeamRevision: 1 },
    })

    const statusOriginal = memberStatusCommand(
      'concurrent',
      'member-concurrent',
      'inactive',
      1,
      1,
      { idempotencyKey: 'concurrent-status-stable-key' },
    )
    const statusRetry: WorkbenchProjectMemberStatusMutation = {
      ...statusOriginal,
      updatedAt: '2026-08-31T20:04:00.000Z',
      command: {
        ...statusOriginal.command,
        commandId: 'command-concurrent-status-regenerated',
        auditEventId: 'audit-concurrent-status-regenerated',
        outboxId: 'outbox-concurrent-status-regenerated',
        occurredAt: '2026-08-31T20:04:00.000Z',
      },
    }
    const statusResults = await Promise.all([
      firstConnection.commitProjectMemberStatus(statusOriginal, signal),
      secondConnection.commitProjectMemberStatus(statusRetry, signal),
    ])
    expect(statusResults[0]).toEqual(statusResults[1])
    expect(statusResults[0]).toMatchObject({
      ok: true,
      value: { status: 'inactive', memberRevision: 2, teamRevision: 2 },
      receipt: { commandId: 'command-member-status-concurrent' },
    })
    await firstConnection.commitProjectMemberStatus(memberStatusCommand(
      'concurrent-reactivate', 'member-concurrent', 'active', 2, 2,
    ), signal)
    const sponsorMutation = memberCommand('concurrent-sponsor', 3, {
      kind: 'human', displayName: 'Concurrent Sponsor',
      identity: { type: 'feishu', appId: 'app_concurrent', openId: 'ou_concurrent' },
    })
    await firstConnection.commitProjectMember({
      ...sponsorMutation,
      createdAt: '2026-08-31T11:04:00.000Z',
      command: { ...sponsorMutation.command, occurredAt: '2026-08-31T11:04:00.000Z' },
    }, signal)

    const responsibilityOriginal = responsibilityCommand(
      'concurrent', 4, null, 'member-concurrent', [], 'member-concurrent-sponsor',
    )
    const responsibilityRetry: WorkbenchProjectResponsibilityMutation = {
      ...responsibilityOriginal,
      updatedAt: '2026-08-31T20:05:00.000Z',
      command: {
        ...responsibilityOriginal.command,
        commandId: 'command-concurrent-responsibility-regenerated',
        auditEventId: 'audit-concurrent-responsibility-regenerated',
        outboxId: 'outbox-concurrent-responsibility-regenerated',
        occurredAt: '2026-08-31T20:05:00.000Z',
      },
    }
    const responsibilityResults = await Promise.all([
      firstConnection.commitProjectResponsibility(responsibilityOriginal, signal),
      secondConnection.commitProjectResponsibility(responsibilityRetry, signal),
    ])
    expect(responsibilityResults[0]).toEqual(responsibilityResults[1])
    expect(responsibilityResults[0]).toMatchObject({
      ok: true,
      value: { responsibilityRevision: 1, teamRevision: 5 },
      receipt: { commandId: 'command-responsibility-concurrent' },
    })
    expect(teamArtifactCounts(connection(firstConnection))).toMatchObject({
      members: { count: 2 },
      responsibilityVersions: { count: 1 },
      teamRevision: { team_revision: 5, current_responsibility_revision: 1 },
      outbox: { count: 6 }, audit: { count: 6 }, receipts: { count: 6 },
    })
    await secondConnection.close()
    await firstConnection.close()
  })

  it('enforces immutable member identity and append-only Responsibility history at runtime', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createTeamProject(workbench)
    await workbench.commitProjectMember(memberCommand('immutable-owner', 0, {
      kind: 'human', displayName: 'Immutable Owner',
      identity: { type: 'feishu', appId: 'app_immutable', openId: 'ou_immutable' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('immutable-contributor', 1, {
      kind: 'agent', displayName: 'Immutable Contributor',
    }), signal)
    await workbench.commitProjectResponsibility(responsibilityCommand(
      'immutable',
      2,
      null,
      'member-immutable-owner',
      ['member-immutable-contributor'],
    ), signal)
    const database = connection(workbench)
    expect(() => database.prepare(`
      UPDATE workbench_project_member SET display_name = 'Changed'
      WHERE id = 'member-immutable-owner'
    `).run()).toThrow(/identity is immutable/u)
    expect(() => database.prepare(`
      UPDATE workbench_project_member SET feishu_open_id = 'ou_changed'
      WHERE id = 'member-immutable-owner'
    `).run()).toThrow(/identity is immutable/u)
    expect(() => database.prepare(`
      DELETE FROM workbench_project_member WHERE id = 'member-immutable-contributor'
    `).run()).toThrow(/cannot be deleted/u)
    expect(() => database.prepare(`
      UPDATE workbench_project_responsibility_version SET contributor_count = 0
      WHERE project_id = 'project-team' AND revision = 1
    `).run()).toThrow(/append-only/u)
    expect(() => database.prepare(`
      DELETE FROM workbench_project_responsibility_version
      WHERE project_id = 'project-team' AND revision = 1
    `).run()).toThrow(/cannot be deleted/u)
    expect(() => database.prepare(`
      UPDATE workbench_project_responsibility_contributor SET ordinal = ordinal
      WHERE project_id = 'project-team' AND responsibility_revision = 1
    `).run()).toThrow(/append-only/u)
    expect(() => database.prepare(`
      DELETE FROM workbench_project_responsibility_contributor
      WHERE project_id = 'project-team' AND responsibility_revision = 1
    `).run()).toThrow(/cannot be deleted/u)
    expect(() => database.prepare(`
      UPDATE workbench_project_team_head SET team_id = 'team-forged'
      WHERE project_id = 'project-team'
    `).run()).toThrow(/scope is immutable/u)
    expect(() => database.prepare(`
      DELETE FROM workbench_project_team_head WHERE project_id = 'project-team'
    `).run()).toThrow(/cannot be deleted/u)
    const retained = await workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toEqual(retained)
    await restarted.close()
  })

  it.each([
    [
      'receipt result PII injection',
      (database: DatabaseSync) => {
        const row = database.prepare(`
          SELECT result_json FROM workbench_command_receipt
          WHERE command_id = 'command-member-tamper-sponsor'
        `).get() as { readonly result_json: string }
        const forged = JSON.parse(row.result_json) as {
          value: Record<string, unknown>
        }
        forged.value.displayName = 'FORGED-PERMANENT-PII-CANARY'
        bypassReceiptImmutability(database, () => {
          database.prepare(`
            UPDATE workbench_command_receipt SET result_json = ?
            WHERE command_id = 'command-member-tamper-sponsor'
          `).run(JSON.stringify(forged))
        })
      },
      /unsupported fields/u,
    ],
    [
      'correlated member-add kind',
      (database: DatabaseSync) => {
        forgeReceiptAndOutbox(
          database,
          'command-member-tamper-sponsor',
          (result) => {
            const value = result.value as Record<string, unknown>
            value.kind = 'agent'
          },
          (payload) => { payload.memberKind = 'agent' },
        )
      },
      /creation command|immutable member kind/u,
    ],
    [
      'correlated historical member-status kind',
      (database: DatabaseSync) => {
        forgeReceiptAndOutbox(
          database,
          'command-member-status-tamper-status',
          (result) => {
            const value = result.value as Record<string, unknown>
            value.kind = 'human'
          },
          (payload) => { payload.memberKind = 'human' },
        )
      },
      /immutable kind/u,
    ],
    [
      'fully correlated historical member-status transition',
      (database: DatabaseSync) => {
        const forgedHash = createHash('sha256').update(canonicalizeJson({
          commandType: 'workbench.project-member.set-status',
          target: 'project-member',
          scope: {
            organizationId: 'organization-test',
            teamId: 'team-test',
            projectId: 'project-team',
          },
          memberId: 'member-tamper-status',
          status: 'active',
          expectedTeamRevision: 3,
          expectedMemberRevision: 1,
          reason: 'owner-project-member-status-change',
          causationId: 'status-cause-tamper-status',
        }), 'utf8').digest('hex')
        forgeReceiptAndOutbox(
          database,
          'command-member-status-tamper-status',
          (result) => {
            const value = result.value as Record<string, unknown>
            value.status = 'active'
          },
          (payload) => {
            payload.memberStatus = 'active'
            payload.requestHash = forgedHash
          },
          forgedHash,
        )
      },
      /transition sequence/u,
    ],
    ...([
      ['member add', 'command-member-tamper-sponsor'],
      ['member status', 'command-member-status-tamper-status'],
      ['Responsibility', 'command-responsibility-tamper-responsibility'],
    ] as const).map(([label, commandId]) => [
      `correlated ${label} request hash and Outbox hash`,
      (database: DatabaseSync) => {
        const row = database.prepare(`
          SELECT outbox_id FROM workbench_command_receipt WHERE command_id = ?
        `).get(commandId) as { readonly outbox_id: string }
        const forgedHash = '0'.repeat(64)
        bypassReceiptImmutability(database, () => {
          database.prepare(`
            UPDATE workbench_command_receipt SET request_hash = ? WHERE command_id = ?
          `).run(forgedHash, commandId)
        })
        bypassOutboxIntentImmutability(database, () => {
          database.prepare(`
            UPDATE workbench_outbox
            SET payload_json = json_set(payload_json, '$.requestHash', ?)
            WHERE id = ?
          `).run(forgedHash, row.outbox_id)
        })
      },
      /request hash/u,
    ] as const),
    [
      'unexplained member status',
      (database: DatabaseSync) => {
        database.prepare(`
          UPDATE workbench_project_member SET status = 'inactive'
          WHERE id = 'member-tamper-status'
        `).run()
      },
      /latest status command/u,
    ],
    [
      'Team revision jump',
      (database: DatabaseSync) => {
        database.prepare(`
          UPDATE workbench_project_team_head SET team_revision = team_revision + 1
          WHERE project_id = 'project-team'
        `).run()
      },
      /revision does not match its command history/u,
    ],
    [
      'Outbox organization escape',
      (database: DatabaseSync) => {
        bypassOutboxIntentImmutability(database, () => {
          database.prepare(`
            UPDATE workbench_outbox SET organization_id = 'organization-forged'
            WHERE command_id = 'command-responsibility-tamper-responsibility'
          `).run()
        })
      },
      /audit and Outbox facts/u,
    ],
  ] as ReadonlyArray<readonly [string, (database: DatabaseSync) => void, RegExp]>) (
    'rejects T05 %s during the next command and after restart',
    async (_label, tamper, error) => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await createTeamProject(workbench)
      await workbench.commitProjectMember(memberCommand('tamper-sponsor', 0, {
        kind: 'human', displayName: 'Tamper Sponsor',
        identity: { type: 'feishu', appId: 'app_tamper', openId: 'ou_tamper' },
      }), signal)
      await workbench.commitProjectMember(memberCommand('tamper-external', 1, {
        kind: 'human', displayName: 'Tamper External',
        identity: { type: 'external', method: 'other', value: 'tamper-contact' },
      }), signal)
      await workbench.commitProjectMember(memberCommand('tamper-status', 2, {
        kind: 'agent', displayName: 'Tamper Status Agent',
      }), signal)
      await workbench.commitProjectMemberStatus(memberStatusCommand(
        'tamper-status', 'member-tamper-status', 'inactive', 3, 1,
      ), signal)
      await workbench.commitProjectMemberStatus(memberStatusCommand(
        'tamper-reactivate', 'member-tamper-status', 'active', 4, 2,
      ), signal)
      await workbench.commitProjectResponsibility(responsibilityCommand(
        'tamper-responsibility',
        5,
        null,
        'member-tamper-external',
        [],
        'member-tamper-sponsor',
      ), signal)
      tamper(connection(workbench))
      await expect(workbench.commitProjectMember(memberCommand('after-tamper', 6, {
        kind: 'agent', displayName: 'Must not commit after tamper',
      }), signal)).rejects.toThrow(error)
      await workbench.close()

      const restarted = repository(path)
      await expect(restarted.open()).rejects.toThrow(error)
      await restarted.close()
    },
  )

  it.each([
    ['member row', 'BEFORE INSERT ON workbench_project_member'],
    ['Team head', 'BEFORE UPDATE ON workbench_project_team_head'],
    ['Outbox', 'BEFORE INSERT ON workbench_outbox'],
    ['audit event', 'BEFORE INSERT ON workbench_audit_event'],
    ['audit head', 'BEFORE UPDATE ON workbench_audit_head'],
    ['receipt', 'BEFORE INSERT ON workbench_command_receipt'],
  ] as const)(
    'rolls back member creation when the %s stage fails, including after restart',
    async (label, triggerPoint) => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await createTeamProject(workbench)
      const baseline = teamArtifactCounts(connection(workbench))
      connection(workbench).exec(`
        CREATE TRIGGER injected_t05_member_failure ${triggerPoint}
        BEGIN SELECT RAISE(ABORT, 'injected T05 member ${label} failure'); END
      `)
      await expect(workbench.commitProjectMember(memberCommand(`fault-${label.replaceAll(' ', '-')}`, 0, {
        kind: 'human', displayName: 'Rollback PII',
        identity: { type: 'external', method: 'email', value: 'rollback@example.test' },
      }), signal)).rejects.toThrow(/injected T05 member/u)
      expect(teamArtifactCounts(connection(workbench))).toEqual(baseline)
      await workbench.close()

      const restarted = repository(path)
      await restarted.open()
      expect(teamArtifactCounts(connection(restarted))).toEqual(baseline)
      await expect(restarted.verifyAuditChain(signal)).resolves.toMatchObject({
        valid: true, eventCount: 1,
      })
      await restarted.close()
    },
  )

  it.each([
    ['member status', "BEFORE UPDATE OF status ON workbench_project_member"],
    ['Team head', 'BEFORE UPDATE ON workbench_project_team_head'],
    ['Outbox', 'BEFORE INSERT ON workbench_outbox'],
    ['audit event', 'BEFORE INSERT ON workbench_audit_event'],
    ['audit head', 'BEFORE UPDATE ON workbench_audit_head'],
    ['receipt', 'BEFORE INSERT ON workbench_command_receipt'],
  ] as const)(
    'rolls back member status when the %s stage fails, including after restart',
    async (label, triggerPoint) => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await createTeamProject(workbench)
      await workbench.commitProjectMember(memberCommand('status-fault-member', 0, {
        kind: 'agent', displayName: 'Status rollback Agent',
      }), signal)
      const baseline = teamArtifactCounts(connection(workbench))
      connection(workbench).exec(`
        CREATE TRIGGER injected_t05_status_failure ${triggerPoint}
        BEGIN SELECT RAISE(ABORT, 'injected T05 status ${label} failure'); END
      `)
      await expect(workbench.commitProjectMemberStatus(memberStatusCommand(
        `fault-${label.replaceAll(' ', '-')}`,
        'member-status-fault-member',
        'inactive',
        1,
        1,
      ), signal)).rejects.toThrow(/injected T05 status/u)
      expect(teamArtifactCounts(connection(workbench))).toEqual(baseline)
      await expect(workbench.readProjectTeam({
        organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
      }, signal)).resolves.toMatchObject({
        teamRevision: 1,
        members: [{ memberId: 'member-status-fault-member', status: 'active', revision: 1 }],
      })
      await workbench.close()

      const restarted = repository(path)
      await restarted.open()
      expect(teamArtifactCounts(connection(restarted))).toEqual(baseline)
      await restarted.close()
    },
  )

  it.each([
    ['Responsibility version', 'BEFORE INSERT ON workbench_project_responsibility_version'],
    ['Contributor', 'BEFORE INSERT ON workbench_project_responsibility_contributor'],
    ['Team head', 'BEFORE UPDATE ON workbench_project_team_head'],
    ['Outbox', 'BEFORE INSERT ON workbench_outbox'],
    ['audit event', 'BEFORE INSERT ON workbench_audit_event'],
    ['audit head', 'BEFORE UPDATE ON workbench_audit_head'],
    ['receipt', 'BEFORE INSERT ON workbench_command_receipt'],
  ] as const)(
    'rolls back Responsibility replacement when the %s stage fails, including after restart',
    async (label, triggerPoint) => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await createTeamProject(workbench)
      await workbench.commitProjectMember(memberCommand('responsibility-owner', 0, {
        kind: 'human', displayName: 'Responsibility Owner',
        identity: { type: 'feishu', appId: 'app', openId: 'ou_responsibility_owner' },
      }), signal)
      await workbench.commitProjectMember(memberCommand('responsibility-contributor', 1, {
        kind: 'agent', displayName: 'Responsibility Contributor',
      }), signal)
      const baseline = teamArtifactCounts(connection(workbench))
      connection(workbench).exec(`
        CREATE TRIGGER injected_t05_responsibility_failure ${triggerPoint}
        BEGIN SELECT RAISE(ABORT, 'injected T05 responsibility ${label} failure'); END
      `)
      await expect(workbench.commitProjectResponsibility(responsibilityCommand(
        `fault-${label.replaceAll(' ', '-')}`,
        2,
        null,
        'member-responsibility-owner',
        ['member-responsibility-contributor'],
      ), signal)).rejects.toThrow(/injected T05 responsibility/u)
      expect(teamArtifactCounts(connection(workbench))).toEqual(baseline)
      await expect(workbench.readProjectTeam({
        organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
      }, signal)).resolves.toMatchObject({ teamRevision: 2, responsibility: null })
      await workbench.close()

      const restarted = repository(path)
      await restarted.open()
      expect(teamArtifactCounts(connection(restarted))).toEqual(baseline)
      await restarted.close()
    },
  )

  it('rolls back a Team command on cancellation before COMMIT and preserves a raced commit', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createTeamProject(workbench)
    const database = connection(workbench)
    const baseline = teamArtifactCounts(database)

    const preAborted = new AbortController()
    preAborted.abort(new Error('Team caller left before admission'))
    await expect(workbench.commitProjectMember(memberCommand('cancelled-before', 0, {
      kind: 'agent', displayName: 'Must not be admitted',
    }), preAborted.signal)).rejects.toThrow('Team caller left before admission')
    expect(teamArtifactCounts(database)).toEqual(baseline)

    const during = new AbortController()
    const originalPrepare = database.prepare.bind(database)
    const prepare = vi.spyOn(database, 'prepare').mockImplementation(sql => {
      const statement = originalPrepare(sql)
      if (sql.includes('INSERT INTO workbench_command_receipt')) {
        const originalRun = statement.run.bind(statement)
        vi.spyOn(statement, 'run').mockImplementation((...parameters) => {
          const result = originalRun(...parameters)
          during.abort(new Error('Team caller left before commit'))
          return result
        })
      }
      return statement
    })
    await expect(workbench.commitProjectMember(memberCommand('cancelled-during', 0, {
      kind: 'human', displayName: 'Rolled-back PII',
      identity: { type: 'external', method: 'email', value: 'rollback-cancel@example.test' },
    }), during.signal)).rejects.toThrow('Team caller left before commit')
    prepare.mockRestore()
    expect(teamArtifactCounts(database)).toEqual(baseline)
    await expect(workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toMatchObject({ teamRevision: 0, members: [] })

    const afterCommit = new AbortController()
    const execute = database.exec.bind(database)
    const exec = vi.spyOn(database, 'exec').mockImplementation(sql => {
      const result = execute(sql)
      if (sql === 'COMMIT') afterCommit.abort(new Error('Team response raced after commit'))
      return result
    })
    await expect(workbench.commitProjectMember(memberCommand('committed-race', 0, {
      kind: 'agent', displayName: 'Committed Race Agent',
    }), afterCommit.signal)).resolves.toMatchObject({
      ok: true,
      value: { memberId: 'member-committed-race', memberRevision: 1, teamRevision: 1 },
    })
    exec.mockRestore()
    expect(teamArtifactCounts(database)).toMatchObject({
      members: { count: 1 },
      teamRevision: { team_revision: 1, current_responsibility_revision: null },
      outbox: { count: 2 }, audit: { count: 2 }, receipts: { count: 2 },
    })
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toMatchObject({
      teamRevision: 1,
      members: [{ memberId: 'member-committed-race', status: 'active', revision: 1 }],
    })
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

  it('persists, accepts, replays, and restarts one typed SuggestedChange before a direct Team command', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('accept-flow', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    }, ['audit-member-review-owner', 'audit-project-team'])
    const proposed = await workbench.commitSuggestedChangeProposal(proposal, signal)
    expect(proposed).toMatchObject({
      ok: true,
      value: {
        suggestedChangeId: 'suggested-change-accept-flow',
        suggestedChangeRevision: 1,
        baseTargetVersion: 2,
        persistedState: 'pending',
        riskLevel: 'high',
      },
    })
    await expect(workbench.commitSuggestedChangeProposal({
      ...proposal,
      command: {
        ...proposal.command,
        commandId: 'command-suggested-regenerated',
        auditEventId: 'audit-suggested-regenerated',
        outboxId: 'outbox-suggested-regenerated',
      },
    }, signal)).resolves.toEqual(proposed)

    const center = await workbench.readReviewCenter({
      organizationId: 'organization-test',
      teamId: 'team-test',
      filter: { projectId: 'project-team', limit: 20 },
    }, signal)
    expect(center).toMatchObject({
      projectId: 'project-team',
      proposalBuilder: {
        teamRevision: 2,
        responsibilityRevision: null,
        base: {
          accountableMemberId: null,
          contributorMemberIds: [],
          humanSponsorMemberId: null,
        },
        memberOptions: [
          { memberId: 'member-review-owner', requiresHumanSponsor: false, canBeHumanSponsor: true },
          { memberId: 'member-review-contributor', requiresHumanSponsor: false, canBeHumanSponsor: true },
        ],
      },
      items: [{
        suggestedChangeId: 'suggested-change-accept-flow',
        revision: 1,
        persistedState: 'pending',
        effectiveStatus: 'pending',
        proposedDiff: {
          kind: 'project-responsibility.diff',
          schemaVersion: 1,
          changedFields: ['accountable', 'contributors'],
        },
        risk: {
          proposedLevel: 'high',
          effectiveLevel: 'high',
          proposedReasonCodes: ['initial-responsibility'],
          batchPolicy: { policy: 'forbidden', reason: 'high-risk' },
        },
        allowedDecisions: ['accept', 'edit-and-accept', 'reject', 'defer'],
      }],
    })

    const privateFailure = await workbench.commitSuggestedChangeDecision(
      suggestedChangeDecisionCommand(
        'accept-flow-risk-mismatch',
        'suggested-change-accept-flow',
        1,
        'accept',
        { acknowledgedRiskLevel: 'low', feedback: 'PRIVATE-FAILED-REVIEW-CANARY' },
      ),
      signal,
    )
    expect(privateFailure).toMatchObject({
      ok: false,
      error: { code: 'risk-acknowledgement-mismatch', requiredRiskLevel: 'high' },
    })

    const decision = suggestedChangeDecisionCommand(
      'accept-flow',
      'suggested-change-accept-flow',
      1,
      'accept',
      { acknowledgedRiskLevel: 'high', feedback: 'Approve private review feedback' },
    )
    const accepted = await workbench.commitSuggestedChangeDecision(decision, signal)
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        suggestedChangeRevision: 2,
        persistedState: 'accepted',
        decisionMode: 'accepted',
        riskLevel: 'high',
        appliedTeamRevision: 3,
        appliedResponsibilityRevision: 1,
      },
    })
    await expect(workbench.commitProjectMember(memberCommand('after-review-accept', 3, {
      kind: 'agent', displayName: 'After Review Agent',
    }), signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 4 } })
    await expect(workbench.commitSuggestedChangeDecision(decision, signal)).resolves.toEqual(accepted)
    await expect(workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toMatchObject({
      teamRevision: 4,
      responsibility: {
        revision: 1,
        accountableMemberId: 'member-review-owner',
        contributorMemberIds: ['member-review-contributor'],
      },
    })
    const permanent = connection(workbench).prepare(`
      SELECT audit.canonical_envelope, audit.summary_fields_json,
        outbox.payload_json, receipt.result_json, receipt.request_hash
      FROM workbench_audit_event AS audit
      INNER JOIN workbench_outbox AS outbox ON outbox.id = audit.outbox_id
      INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
      WHERE audit.command_type LIKE 'workbench.suggested-change.%'
      ORDER BY audit.sequence
    `).all()
    const activity = await workbench.readActivity({
      organizationId: 'organization-test',
      filter: { projectId: 'project-team', limit: 20 },
    }, signal)
    const redacted = JSON.stringify({
      permanent,
      reviewActivity: activity.items.filter(item => item.object.type === 'suggested-change'),
      privateFailure,
    })
    for (const privateValue of [
      'member-review-owner',
      'member-review-contributor',
      'audit-project-team',
      'Approve private review feedback',
      'PRIVATE-FAILED-REVIEW-CANARY',
    ]) expect(redacted).not.toContain(privateValue)
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', status: 'accepted', limit: 20 },
    }, signal)).resolves.toMatchObject({
      items: [{
        persistedState: 'accepted',
        effectiveStatus: 'accepted',
        decisions: [{
          mode: 'accepted',
          feedback: 'Approve private review feedback',
          appliedTeamRevision: 3,
          appliedResponsibilityRevision: 1,
        }],
      }],
    })
    await restarted.close()
  })

  it('marks Agent and external-human proposal candidates as requiring a human sponsor', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createTeamProject(workbench)
    await workbench.commitProjectMember(memberCommand('builder-internal', 0, {
      kind: 'human', displayName: 'Internal Human',
      identity: { type: 'feishu', appId: 'app', openId: 'ou_builder_internal' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('builder-external', 1, {
      kind: 'human', displayName: 'External Human',
      identity: { type: 'external', method: 'email', value: 'builder-private@example.test' },
    }), signal)
    await workbench.commitProjectMember(memberCommand('builder-agent', 2, {
      kind: 'agent', displayName: 'Builder Agent',
    }), signal)

    await expect(workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', limit: 20 },
    }, signal)).resolves.toMatchObject({
      proposalBuilder: {
        memberOptions: [
          { memberId: 'member-builder-internal', requiresHumanSponsor: false, canBeHumanSponsor: true },
          { memberId: 'member-builder-external', requiresHumanSponsor: true, canBeHumanSponsor: true },
          { memberId: 'member-builder-agent', requiresHumanSponsor: true, canBeHumanSponsor: false },
        ],
      },
    })
    await workbench.close()
  })

  it('admits only 1–20 distinct, available EvidenceRefs from the authorized Project', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createReviewFixture(workbench)
    const candidate = {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    }
    await expect(workbench.commitSuggestedChangeProposal(suggestedChangeProposalCommand(
      'evidence-order', 2, candidate, ['audit-project-team', 'audit-member-review-owner'],
    ), signal)).rejects.toThrow(/canonical audit id order/u)
    await expect(workbench.commitSuggestedChangeProposal(suggestedChangeProposalCommand(
      'evidence-duplicate', 2, candidate, ['audit-project-team', 'audit-project-team'],
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'evidence-invalid', reason: 'duplicate' },
    })
    await expect(workbench.commitSuggestedChangeProposal(suggestedChangeProposalCommand(
      'evidence-missing', 2, candidate, ['audit-does-not-exist'],
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'evidence-invalid', reason: 'unavailable' },
    })
    await workbench.commitProject(projectCommand('evidence-scope-other', 1), signal)
    await expect(workbench.commitSuggestedChangeProposal(suggestedChangeProposalCommand(
      'evidence-scope', 2, candidate, ['audit-project-evidence-scope-other'],
    ), signal)).resolves.toMatchObject({
      ok: false, error: { code: 'evidence-invalid', reason: 'wrong-project' },
    })
    await expect(workbench.commitSuggestedChangeProposal({
      ...suggestedChangeProposalCommand('evidence-overflow', 2, candidate),
      evidenceRefs: Array.from({ length: 21 }, (_, index) => ({
        kind: 'workbench-audit-event' as const,
        auditEventId: `audit-overflow-${String(index)}`,
      })),
    }, signal)).rejects.toThrow(/requires 1 to 20 EvidenceRefs/u)
    expect(connection(workbench).prepare(`
      SELECT COUNT(*) AS count FROM workbench_suggested_change
    `).get()).toEqual({ count: 0 })
    await workbench.close()
  })

  it('retains proposed and edited diffs while preventing edited acceptance from downgrading risk', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createReviewFixture(workbench)
    await workbench.commitProjectResponsibility(responsibilityCommand(
      'edit-risk-base', 2, null,
      'member-review-owner', ['member-review-contributor'],
    ), signal)
    const proposal = suggestedChangeProposalCommand('edit-risk', 3, {
      accountableMemberId: 'member-review-contributor',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    const edit = suggestedChangeDecisionCommand(
      'edit-risk', proposal.suggestedChangeId, 1, 'edit-and-accept', {
        acknowledgedRiskLevel: 'low',
        candidate: {
          accountableMemberId: 'member-review-owner',
          contributorMemberIds: [],
          humanSponsorMemberId: null,
        },
      },
    )
    await expect(workbench.commitSuggestedChangeDecision(edit, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'risk-acknowledgement-mismatch', requiredRiskLevel: 'high' },
    })
    const acceptedEdit = {
      ...edit,
      acknowledgedRiskLevel: 'high' as const,
      command: {
        ...edit.command,
        commandId: 'command-decision-edit-risk-high',
        auditEventId: 'audit-decision-edit-risk-high',
        outboxId: 'outbox-decision-edit-risk-high',
      },
    }
    const accepted = await workbench.commitSuggestedChangeDecision(acceptedEdit, signal)
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        persistedState: 'accepted', decisionMode: 'edited-accepted', riskLevel: 'high',
        appliedTeamRevision: 4, appliedResponsibilityRevision: 2,
      },
    })
    await expect(workbench.commitSuggestedChangeDecision({
      ...acceptedEdit,
      command: {
        ...acceptedEdit.command,
        commandId: 'command-decision-edit-risk-replay',
        auditEventId: 'audit-decision-edit-risk-replay',
        outboxId: 'outbox-decision-edit-risk-replay',
      },
    }, signal)).resolves.toEqual(accepted)

    await expect(workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', status: 'accepted', limit: 20 },
    }, signal)).resolves.toMatchObject({
      items: [{
        proposedDiff: { changedFields: ['accountable', 'contributors'] },
        risk: { proposedLevel: 'high', effectiveLevel: 'high' },
        decisions: [{
          mode: 'edited-accepted',
          appliedDiff: { changedFields: ['contributors'] },
          appliedRiskLevel: 'low',
        }],
      }],
    })
    await workbench.close()
  })

  it('converges concurrent acceptance retries on one receipt and one double-CAS target mutation', async () => {
    const path = await databasePath()
    const first = repository(path)
    const second = repository(path)
    await first.open()
    await createReviewFixture(first)
    const proposal = suggestedChangeProposalCommand('concurrent-accept', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await first.commitSuggestedChangeProposal(proposal, signal)
    await second.open()
    const original = suggestedChangeDecisionCommand(
      'concurrent-accept', proposal.suggestedChangeId, 1, 'accept',
      { acknowledgedRiskLevel: 'high', feedback: 'One stable private intent' },
    )
    const retry: WorkbenchSuggestedChangeDecisionMutation = {
      ...original,
      decisionId: 'decision-concurrent-accept-regenerated',
      command: {
        ...original.command,
        commandId: 'command-concurrent-accept-regenerated',
        auditEventId: 'audit-concurrent-accept-regenerated',
        outboxId: 'outbox-concurrent-accept-regenerated',
      },
    }
    const results = await Promise.all([
      first.commitSuggestedChangeDecision(original, signal),
      second.commitSuggestedChangeDecision(retry, signal),
    ])
    expect(results[0]).toEqual(results[1])
    expect(results[0]).toMatchObject({
      ok: true,
      value: {
        suggestedChangeRevision: 2, persistedState: 'accepted',
        appliedTeamRevision: 3, appliedResponsibilityRevision: 1,
      },
      receipt: { commandId: original.command.commandId },
    })
    expect(connection(first).prepare(`
      SELECT
        (SELECT COUNT(*) FROM workbench_suggested_change_decision) AS decisions,
        (SELECT COUNT(*) FROM workbench_project_responsibility_version) AS responsibilities,
        (SELECT team_revision FROM workbench_project_team_head
          WHERE project_id = 'project-team') AS team_revision
    `).get()).toEqual({ decisions: 1, responsibilities: 1, team_revision: 3 })
    await first.close()
    await second.close()
  })

  it('allows only one distinct same-revision decision to win the SuggestedChange CAS', async () => {
    const path = await databasePath()
    const first = repository(path)
    const second = repository(path)
    await first.open()
    await createReviewFixture(first)
    const proposal = suggestedChangeProposalCommand('concurrent-distinct', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await first.commitSuggestedChangeProposal(proposal, signal)
    await second.open()
    const accept = suggestedChangeDecisionCommand(
      'concurrent-distinct-accept', proposal.suggestedChangeId, 1, 'accept',
      { acknowledgedRiskLevel: 'high' },
    )
    const reject = suggestedChangeDecisionCommand(
      'concurrent-distinct-reject', proposal.suggestedChangeId, 1, 'reject',
    )

    const [winner, loser] = await Promise.all([
      first.commitSuggestedChangeDecision(accept, signal),
      second.commitSuggestedChangeDecision(reject, signal),
    ])
    expect(winner).toMatchObject({
      ok: true,
      value: { persistedState: 'accepted', suggestedChangeRevision: 2 },
    })
    expect(loser).toMatchObject({
      ok: false,
      error: {
        code: 'suggested-change-revision-conflict',
        expectedSuggestedChangeRevision: 1,
        currentSuggestedChangeRevision: 2,
      },
    })
    expect(connection(first).prepare(`
      SELECT COUNT(*) AS count FROM workbench_suggested_change_decision
      WHERE suggested_change_id = ?
    `).get(proposal.suggestedChangeId)).toEqual({ count: 1 })
    await first.close()
    await second.close()
  })

  it('accepts a current-base deferred proposal with two append-only decisions', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('defer-then-accept', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'defer-then-accept-defer', proposal.suggestedChangeId, 1, 'defer',
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: { persistedState: 'deferred', suggestedChangeRevision: 2 },
    })
    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'defer-then-accept-accept', proposal.suggestedChangeId, 2, 'accept',
      { acknowledgedRiskLevel: 'high' },
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: {
        persistedState: 'accepted', suggestedChangeRevision: 3,
        appliedTeamRevision: 3, appliedResponsibilityRevision: 1,
      },
    })
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    await expect(restarted.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', status: 'accepted', limit: 20 },
    }, signal)).resolves.toMatchObject({
      items: [{
        suggestedChangeId: proposal.suggestedChangeId,
        revision: 3,
        decisions: [{ mode: 'deferred' }, { mode: 'accepted' }],
      }],
    })
    await restarted.close()
  })

  it('derives all five Review statuses, risk filters, and stale-only rejection without overwrite', async () => {
    const workbench = repository(':memory:')
    await workbench.open()
    await createReviewFixture(workbench)
    await workbench.commitProjectResponsibility(responsibilityCommand(
      'review-base',
      2,
      null,
      'member-review-owner',
      ['member-review-contributor'],
    ), signal)

    const acceptedProposal = suggestedChangeProposalCommand('status-accepted', 3, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(acceptedProposal, signal)
    await workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'status-accepted', acceptedProposal.suggestedChangeId, 1, 'accept',
      { acknowledgedRiskLevel: 'low' },
    ), signal)

    const rejectedProposal = suggestedChangeProposalCommand('status-rejected', 4, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(rejectedProposal, signal)
    await workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'status-rejected', rejectedProposal.suggestedChangeId, 1, 'reject',
    ), signal)

    const staleProposal = suggestedChangeProposalCommand('status-stale', 4, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(staleProposal, signal)
    await workbench.commitProjectMember(memberCommand('stale-advance', 4, {
      kind: 'agent', displayName: 'Stale Advance Agent',
    }), signal)
    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'stale-accept-denied', staleProposal.suggestedChangeId, 1, 'accept',
      { acknowledgedRiskLevel: 'low' },
    ), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'suggested-change-stale', baseTeamRevision: 4, currentTeamRevision: 5 },
    })

    const pendingProposal = suggestedChangeProposalCommand('status-pending', 5, {
      accountableMemberId: 'member-review-contributor',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(pendingProposal, signal)
    const deferredProposal = suggestedChangeProposalCommand('status-deferred', 5, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(deferredProposal, signal)
    await workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'status-deferred', deferredProposal.suggestedChangeId, 1, 'defer',
    ), signal)
    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'status-deferred-twice', deferredProposal.suggestedChangeId, 2, 'defer',
    ), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'suggested-change-state-conflict', status: 'deferred' },
    })

    for (const [status, expectedId] of [
      ['accepted', acceptedProposal.suggestedChangeId],
      ['rejected', rejectedProposal.suggestedChangeId],
      ['stale', staleProposal.suggestedChangeId],
      ['pending', pendingProposal.suggestedChangeId],
      ['deferred', deferredProposal.suggestedChangeId],
    ] as const) {
      const center = await workbench.readReviewCenter({
        organizationId: 'organization-test', teamId: 'team-test',
        filter: { projectId: 'project-team', status, limit: 20 },
      }, signal)
      expect(center?.items.map(item => item.suggestedChangeId)).toEqual([expectedId])
    }
    const low = await workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', riskLevel: 'low', limit: 20 },
    }, signal)
    expect(low?.items.map(item => item.suggestedChangeId).sort()).toEqual([
      acceptedProposal.suggestedChangeId,
      deferredProposal.suggestedChangeId,
      rejectedProposal.suggestedChangeId,
      staleProposal.suggestedChangeId,
    ].sort())
    const high = await workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', riskLevel: 'high', limit: 20 },
    }, signal)
    expect(high?.items.map(item => item.suggestedChangeId)).toEqual([
      pendingProposal.suggestedChangeId,
    ])
    const firstPage = await workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', limit: 2 },
    }, signal)
    expect(firstPage?.items).toHaveLength(2)
    expect(firstPage?.nextBeforeSequence).not.toBeNull()
    const nextBeforeSequence = firstPage?.nextBeforeSequence
    if (nextBeforeSequence === null || nextBeforeSequence === undefined) {
      throw new Error('expected a stable Review Center cursor')
    }
    const secondPage = await workbench.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: {
        projectId: 'project-team', limit: 2, beforeSequence: nextBeforeSequence,
      },
    }, signal)
    expect(secondPage?.items).toHaveLength(2)
    expect(new Set([
      ...(firstPage?.items.map(item => item.suggestedChangeId) ?? []),
      ...(secondPage?.items.map(item => item.suggestedChangeId) ?? []),
    ]).size).toBe(4)

    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'stale-rejected', staleProposal.suggestedChangeId, 1, 'reject',
      { feedback: 'Reject stale intent without target mutation' },
    ), signal)).resolves.toMatchObject({
      ok: true,
      value: { persistedState: 'rejected', appliedTeamRevision: null },
    })
    await expect(workbench.readProjectTeam({
      organizationId: 'organization-test', teamId: 'team-test', projectId: 'project-team',
    }, signal)).resolves.toMatchObject({
      teamRevision: 5,
      responsibility: { revision: 2, contributorMemberIds: [] },
    })
    await workbench.close()
  })

  it.each([
    ['proposal', 'BEFORE INSERT ON workbench_suggested_change'],
    ['evidence', 'BEFORE INSERT ON workbench_suggested_change_evidence'],
    ['Outbox', 'BEFORE INSERT ON workbench_outbox'],
    ['audit event', 'BEFORE INSERT ON workbench_audit_event'],
    ['audit head', 'BEFORE UPDATE ON workbench_audit_head'],
    ['receipt', 'BEFORE INSERT ON workbench_command_receipt'],
  ] as const)('rolls back a SuggestedChange proposal when the %s stage fails', async (label, point) => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const database = connection(workbench)
    const baseline = suggestedChangeArtifactCounts(database)
    database.exec(`
      CREATE TRIGGER injected_t06_proposal_failure ${point}
      BEGIN SELECT RAISE(ABORT, 'injected T06 proposal ${label} failure'); END
    `)
    await expect(workbench.commitSuggestedChangeProposal(suggestedChangeProposalCommand(
      `fault-proposal-${label.replaceAll(' ', '-')}`,
      2,
      {
        accountableMemberId: 'member-review-owner',
        contributorMemberIds: ['member-review-contributor'],
        humanSponsorMemberId: null,
      },
    ), signal)).rejects.toThrow(/injected T06 proposal/u)
    expect(suggestedChangeArtifactCounts(database)).toEqual(baseline)
    database.exec('DROP TRIGGER injected_t06_proposal_failure')
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    expect(suggestedChangeArtifactCounts(connection(restarted))).toEqual(baseline)
    await restarted.close()
  })

  it.each([
    ['Responsibility version', 'BEFORE INSERT ON workbench_project_responsibility_version'],
    ['Contributor', 'BEFORE INSERT ON workbench_project_responsibility_contributor'],
    ['Team head', 'BEFORE UPDATE ON workbench_project_team_head'],
    ['SuggestedChange head', 'BEFORE UPDATE ON workbench_suggested_change'],
    ['Outbox', 'BEFORE INSERT ON workbench_outbox'],
    ['audit event', 'BEFORE INSERT ON workbench_audit_event'],
    ['audit head', 'BEFORE UPDATE ON workbench_audit_head'],
    ['receipt', 'BEFORE INSERT ON workbench_command_receipt'],
    ['decision', 'BEFORE INSERT ON workbench_suggested_change_decision'],
  ] as const)('rolls back acceptance when the %s stage fails', async (label, point) => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand(`fault-decision-${label.replaceAll(' ', '-')}`, 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    const database = connection(workbench)
    const baseline = suggestedChangeArtifactCounts(database)
    database.exec(`
      CREATE TRIGGER injected_t06_decision_failure ${point}
      BEGIN SELECT RAISE(ABORT, 'injected T06 decision ${label} failure'); END
    `)
    await expect(workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      `fault-decision-${label.replaceAll(' ', '-')}`,
      proposal.suggestedChangeId,
      1,
      'accept',
      { acknowledgedRiskLevel: 'high' },
    ), signal)).rejects.toThrow(/injected T06 decision/u)
    expect(suggestedChangeArtifactCounts(database)).toEqual(baseline)
    database.exec('DROP TRIGGER injected_t06_decision_failure')
    await workbench.close()

    const restarted = repository(path)
    await restarted.open()
    expect(suggestedChangeArtifactCounts(connection(restarted))).toEqual(baseline)
    await expect(restarted.readReviewCenter({
      organizationId: 'organization-test', teamId: 'team-test',
      filter: { projectId: 'project-team', status: 'pending', limit: 20 },
    }, signal)).resolves.toMatchObject({
      proposalBuilder: { teamRevision: 2, responsibilityRevision: null },
      items: [{ suggestedChangeId: proposal.suggestedChangeId, revision: 1 }],
    })
    await restarted.close()
  })

  it('rejects a coherently rewritten diff, digest, and risk that is no longer bound to history', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('correlated-tamper', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    const before = {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: [] as string[],
      humanSponsorMemberId: null,
    }
    const after = proposal.candidate
    const digestMaterial = {
      kind: 'project-responsibility.diff',
      schemaVersion: 1,
      before,
      after,
      changedFields: ['contributors'],
    }
    const digest = `sha256:${createHash('sha256')
      .update(canonicalizeJson(digestMaterial), 'utf8').digest('hex')}`
    const forgedDiff = canonicalizeJson({ ...digestMaterial, digest })
    const database = connection(workbench)
    database.exec('DROP TRIGGER workbench_suggested_change_envelope_no_update')
    database.prepare(`
      UPDATE workbench_suggested_change
      SET proposed_diff_json = ?, proposed_diff_digest = ?,
        proposed_risk_level = 'low', proposed_risk_reasons_json = '["contributors-only"]'
      WHERE id = ?
    `).run(forgedDiff, digest, proposal.suggestedChangeId)
    database.exec(`
      CREATE TRIGGER workbench_suggested_change_envelope_no_update BEFORE UPDATE OF
        sequence, id, organization_id, team_id, project_id, source_actor_id,
        target_adapter, representation_schema_version, base_team_revision,
        base_responsibility_revision, candidate_json, proposed_diff_json,
        proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
        policy_version, origin_causation_id, proposal_command_id, created_at
        ON workbench_suggested_change
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange envelopes are immutable'); END
    `)
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/review material is not bound to target history/u)
    await restarted.close()
  })

  it('rejects an accepted decision coherently rewritten away from its immutable proposal', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('accepted-candidate-tamper', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    await workbench.commitSuggestedChangeDecision(suggestedChangeDecisionCommand(
      'accepted-candidate-tamper', proposal.suggestedChangeId, 1, 'accept',
      { acknowledgedRiskLevel: 'high' },
    ), signal)

    const before = {
      accountableMemberId: null,
      contributorMemberIds: [] as string[],
      humanSponsorMemberId: null,
    }
    const forgedCandidate = {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: [] as string[],
      humanSponsorMemberId: null,
    }
    const digestMaterial = {
      kind: 'project-responsibility.diff',
      schemaVersion: 1,
      before,
      after: forgedCandidate,
      changedFields: ['accountable'],
    }
    const digest = `sha256:${createHash('sha256')
      .update(canonicalizeJson(digestMaterial), 'utf8').digest('hex')}`
    const forgedDiff = canonicalizeJson({ ...digestMaterial, digest })
    const database = connection(workbench)
    database.exec(`
      DROP TRIGGER workbench_suggested_change_decision_no_update;
      DROP TRIGGER workbench_project_responsibility_no_update;
      DROP TRIGGER workbench_project_responsibility_contributor_no_delete;
    `)
    database.prepare(`
      UPDATE workbench_suggested_change_decision
      SET applied_candidate_json = ?, applied_diff_json = ?
      WHERE suggested_change_id = ? AND mode = 'accepted'
    `).run(canonicalizeJson(forgedCandidate), forgedDiff, proposal.suggestedChangeId)
    database.prepare(`
      UPDATE workbench_project_responsibility_version
      SET contributor_count = 0
      WHERE project_id = 'project-team' AND revision = 1
    `).run()
    database.prepare(`
      DELETE FROM workbench_project_responsibility_contributor
      WHERE project_id = 'project-team' AND responsibility_revision = 1
    `).run()
    database.exec(`
      CREATE TRIGGER workbench_suggested_change_decision_no_update
        BEFORE UPDATE ON workbench_suggested_change_decision
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange decisions are append-only'); END;
      CREATE TRIGGER workbench_project_responsibility_no_update
        BEFORE UPDATE ON workbench_project_responsibility_version
      BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility versions are append-only'); END;
      CREATE TRIGGER workbench_project_responsibility_contributor_no_delete
        BEFORE DELETE ON workbench_project_responsibility_contributor
      BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility contributors cannot be deleted'); END;
    `)
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/immutable proposal candidate/u)
    await restarted.close()
  })

  it.each(['rejected', 'deferred'] as const)(
    'rejects a forged %s decision that reuses the proposal ledger artifacts',
    async persistedState => {
      const path = await databasePath()
      const workbench = repository(path)
      await workbench.open()
      await createReviewFixture(workbench)
      const suffix = `forged-ledger-${persistedState}`
      const proposal = suggestedChangeProposalCommand(suffix, 2, {
        accountableMemberId: 'member-review-owner',
        contributorMemberIds: ['member-review-contributor'],
        humanSponsorMemberId: null,
      })
      await workbench.commitSuggestedChangeProposal(proposal, signal)
      const database = connection(workbench)
      database.prepare(`
        INSERT INTO workbench_suggested_change_decision (
          id, suggested_change_id, suggested_change_revision, mode, actor_id,
          feedback, applied_candidate_json, applied_diff_json, applied_risk_level,
          applied_risk_reasons_json, applied_team_revision,
          applied_responsibility_revision, causation_id, command_id,
          audit_event_id, outbox_id, decided_at
        ) VALUES (?, ?, 2, ?, 'owner-test', ?, NULL, NULL, NULL, '[]', NULL, NULL,
          ?, ?, ?, ?, ?)
      `).run(
        `decision-${suffix}`,
        proposal.suggestedChangeId,
        persistedState,
        `Forged ${persistedState} decision`,
        proposal.command.causationId,
        proposal.command.commandId,
        proposal.command.auditEventId,
        proposal.command.outboxId,
        proposal.createdAt,
      )
      database.prepare(`
        UPDATE workbench_suggested_change
        SET revision = 2, persisted_state = ?, updated_at = ?
        WHERE id = ?
      `).run(persistedState, proposal.createdAt, proposal.suggestedChangeId)
      await workbench.close()

      const restarted = repository(path)
      await expect(restarted.open()).rejects.toThrow(/formal command ledger/u)
      await restarted.close()
    },
  )

  it('rejects a forged mutable head even when the transition trigger is restored', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('head-tamper', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    const database = connection(workbench)
    database.exec(`
      DROP TRIGGER workbench_suggested_change_head_transition;
      UPDATE workbench_suggested_change
      SET revision = 2, persisted_state = 'accepted', updated_at = '2026-08-31T15:00:00.000Z'
      WHERE id = 'suggested-change-head-tamper';
      CREATE TRIGGER workbench_suggested_change_head_transition BEFORE UPDATE OF
        revision, persisted_state, updated_at ON workbench_suggested_change
      WHEN NOT (
        NEW.revision = OLD.revision + 1
        AND NEW.updated_at >= OLD.updated_at
        AND (
          (OLD.persisted_state = 'pending'
            AND NEW.persisted_state IN ('deferred', 'accepted', 'rejected'))
          OR (OLD.persisted_state = 'deferred'
            AND NEW.persisted_state IN ('accepted', 'rejected'))
        )
      )
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange head transition is invalid'); END;
    `)
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/revision does not match decision history/u)
    await restarted.close()
  })

  it.each([
    ['another Project', 'audit-project-evidence-other'],
    ['an event after the proposal', 'audit-member-evidence-later'],
  ] as const)('rejects stored EvidenceRefs redirected to %s', async (_label, forgedAuditId) => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('evidence-tamper', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    })
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    if (forgedAuditId === 'audit-project-evidence-other') {
      await workbench.commitProject(projectCommand('evidence-other', 1), signal)
    } else {
      await workbench.commitProjectMember(memberCommand('evidence-later', 2, {
        kind: 'agent', displayName: 'Later Evidence Agent',
      }), signal)
    }
    const database = connection(workbench)
    database.exec('DROP TRIGGER workbench_suggested_change_evidence_no_update')
    database.prepare(`
      UPDATE workbench_suggested_change_evidence SET audit_event_id = ?
      WHERE suggested_change_id = ? AND ordinal = 1
    `).run(forgedAuditId, proposal.suggestedChangeId)
    database.exec(`
      CREATE TRIGGER workbench_suggested_change_evidence_no_update
        BEFORE UPDATE ON workbench_suggested_change_evidence
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange evidence is immutable'); END
    `)
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/evidence escaped its Project/u)
    await restarted.close()
  })

  it('rejects stored EvidenceRef ordinals rewritten out of canonical audit id order', async () => {
    const path = await databasePath()
    const workbench = repository(path)
    await workbench.open()
    await createReviewFixture(workbench)
    const proposal = suggestedChangeProposalCommand('evidence-order-tamper', 2, {
      accountableMemberId: 'member-review-owner',
      contributorMemberIds: ['member-review-contributor'],
      humanSponsorMemberId: null,
    }, ['audit-member-review-owner', 'audit-project-team'])
    await workbench.commitSuggestedChangeProposal(proposal, signal)
    const database = connection(workbench)
    database.exec('DROP TRIGGER workbench_suggested_change_evidence_no_update')
    database.prepare(`
      UPDATE workbench_suggested_change_evidence SET ordinal = 20
      WHERE suggested_change_id = ? AND ordinal = 1
    `).run(proposal.suggestedChangeId)
    database.prepare(`
      UPDATE workbench_suggested_change_evidence SET ordinal = 1
      WHERE suggested_change_id = ? AND ordinal = 2
    `).run(proposal.suggestedChangeId)
    database.prepare(`
      UPDATE workbench_suggested_change_evidence SET ordinal = 2
      WHERE suggested_change_id = ? AND ordinal = 20
    `).run(proposal.suggestedChangeId)
    database.exec(`
      CREATE TRIGGER workbench_suggested_change_evidence_no_update
        BEFORE UPDATE ON workbench_suggested_change_evidence
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange evidence is immutable'); END
    `)
    await workbench.close()

    const restarted = repository(path)
    await expect(restarted.open()).rejects.toThrow(/canonical order/u)
    await restarted.close()
  })
})
