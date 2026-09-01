import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WorkbenchAuthorization, WorkbenchAction } from '../src/authorization.ts'
import type {
  CreateProjectRiskRequest,
  WorkbenchCommandMetadata,
  WorkbenchFeishuCalendarBindingMutation,
  WorkbenchFeishuCalendarEventSnapshot,
  WorkbenchFeishuCalendarRoute,
  WorkbenchFeishuCalendarSnapshot,
  WorkbenchFeishuRouteMutation,
  WorkbenchFeishuTaskEventObservation,
  WorkbenchFeishuTaskListBindingMutation,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
  WorkbenchFeishuVerificationMutation,
  WorkbenchProjectMemberMutation,
  WorkbenchProjectMilestoneMutation,
  WorkbenchProjectMutation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  SqliteWorkbenchRepository,
  WorkbenchScenario,
  noWorkbenchExternalAdapters,
  randomWorkbenchIds,
} from '../src/index.ts'

const roots = new Set<string>()
const signal = new AbortController().signal
const CROSS_PROJECT_ID = 'project-risk-schedule-cross'
const CALENDAR_ID = 'calendar-risk-schedule'
const EVENT_ID = 'event-risk-schedule'
const APP_ID = 'cli_risk_schedule'
const OPEN_ID = 'ou_risk_schedule'
const TASK_LIST_GUID = 'tasklist-risk-treatment'
const PRIMARY_TASK_GUID = 'task-risk-primary'
const REPLACEMENT_TASK_GUID = 'task-risk-replacement'

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

function projectMutation(): WorkbenchProjectMutation {
  return {
    projectId: 'project-risk-scenario',
    primaryGoalId: 'goal-risk-scenario',
    projectName: 'Risk Scenario',
    primaryGoal: {
      name: 'Govern uncertainty',
      outcomes: [{
        outcomeId: 'outcome-risk-scenario',
        name: 'Risk decisions stay reviewable',
        metric: {
          metricName: 'Reviewable decisions',
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
    command: command('project', 'owner-project-create'),
  }
}

function memberMutation(): WorkbenchProjectMemberMutation {
  return {
    projectId: 'project-risk-scenario',
    memberId: 'member-risk-owner',
    member: {
      kind: 'human',
      displayName: 'Risk Owner',
      identity: { type: 'feishu', appId: 'cli_risk_scenario', openId: 'ou_risk_owner' },
    },
    expectedTeamRevision: 0,
    expectedRevision: null,
    createdAt: '2026-09-01T00:01:00.000Z',
    command: command('member', 'owner-project-member-add', '2026-09-01T00:01:00.000Z'),
  }
}

function command<Reason extends WorkbenchCommandMetadata['reason']>(
  suffix: string,
  reason: Reason,
  occurredAt = '2026-09-01T00:00:00.000Z',
): WorkbenchCommandMetadata & { readonly reason: Reason } {
  return {
    commandId: `command-risk-${suffix}`,
    auditEventId: `audit-risk-${suffix}`,
    outboxId: `outbox-risk-${suffix}`,
    idempotencyKey: `idempotency-risk-${suffix}`,
    causationId: `causation-risk-${suffix}`,
    reason,
    actor: {
      kind: 'owner' as const,
      id: 'owner-risk-scenario',
      organizationId: 'organization-risk-scenario',
      teamId: 'team-risk-scenario',
    },
    occurredAt,
  }
}

function crossProjectMutation(): WorkbenchProjectMutation {
  return {
    ...projectMutation(),
    projectId: CROSS_PROJECT_ID,
    primaryGoalId: 'goal-risk-schedule-cross',
    projectName: 'Cross-project Risk Schedule Evidence',
    expectedCatalogRevision: 1,
    primaryGoal: {
      ...projectMutation().primaryGoal,
      outcomes: [{
        ...projectMutation().primaryGoal.outcomes[0],
        outcomeId: 'outcome-risk-schedule-cross',
      }],
    },
    createdAt: '2026-09-01T00:06:00.000Z',
    command: command(
      'project-schedule-cross',
      'owner-project-create',
      '2026-09-01T00:06:00.000Z',
    ),
  }
}

function crossMemberMutation(): WorkbenchProjectMemberMutation {
  return {
    ...memberMutation(),
    projectId: CROSS_PROJECT_ID,
    memberId: 'member-risk-schedule-cross',
    member: {
      kind: 'human',
      displayName: 'Cross-project Risk Owner',
      identity: { type: 'feishu', appId: APP_ID, openId: 'ou_risk_schedule_cross' },
    },
    createdAt: '2026-09-01T00:07:00.000Z',
    command: command(
      'member-schedule-cross',
      'owner-project-member-add',
      '2026-09-01T00:07:00.000Z',
    ),
  }
}

async function commitVerifiedFeishuRoute(
  repository: SqliteWorkbenchRepository,
): Promise<WorkbenchFeishuTaskRoute> {
  const routeMutation: WorkbenchFeishuRouteMutation = {
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_RISK_SCHEDULE_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    updatedAt: '2026-09-01T00:02:00.000Z',
    command: command(
      'schedule-route',
      'owner-feishu-route-configure',
      '2026-09-01T00:02:00.000Z',
    ),
  }
  await repository.commitFeishuRoute(routeMutation, signal)
  const verificationMutation: WorkbenchFeishuVerificationMutation = {
    verificationId: 'verification-risk-schedule',
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    resourceProbe: null,
    observation: {
      result: 'healthy',
      identity: { state: 'verified', issue: null },
      actor: {
        realm: 'feishu-cn',
        appId: APP_ID,
        kind: 'bot',
        openId: OPEN_ID,
        tenantKey: null,
      },
      displayLabel: 'Risk Schedule Bot',
      scopeInspection: { state: 'observed', scopes: [], issue: null },
      resourceProbe: { state: 'not-tested' },
    },
    checkedAt: '2026-09-01T00:03:00.000Z',
    command: command(
      'schedule-verification',
      'owner-feishu-route-verify',
      '2026-09-01T00:03:00.000Z',
    ),
  }
  await repository.commitFeishuVerification(verificationMutation, signal)
  const connection = await repository.readFeishuConnection({
    organizationId: 'organization-risk-scenario',
    teamId: 'team-risk-scenario',
  }, signal)
  if (connection.bot.actor === null) throw new Error('Risk Scenario route was not verified')
  return {
    kind: 'bot',
    routeGeneration: 1,
    appId: APP_ID,
    credentialRef: 'FEISHU_RISK_SCHEDULE_SECRET',
    actor: connection.bot.actor,
  }
}

async function commitRealProjectScheduleChange(
  repository: SqliteWorkbenchRepository,
): Promise<string> {
  const route: WorkbenchFeishuCalendarRoute = await commitVerifiedFeishuRoute(repository)
  const snapshot: WorkbenchFeishuCalendarSnapshot = {
    calendarId: CALENDAR_ID,
    summary: 'Risk schedule evidence',
    description: null,
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  }
  const bindingMutation: WorkbenchFeishuCalendarBindingMutation = {
    projectId: 'project-risk-scenario',
    intent: { mode: 'existing', calendarId: CALENDAR_ID },
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    route,
    snapshot,
    boundAt: '2026-09-01T00:04:00.000Z',
    command: command(
      'schedule-binding',
      'owner-project-calendar-bind',
      '2026-09-01T00:04:00.000Z',
    ),
  }
  await repository.commitFeishuCalendarBinding(bindingMutation, signal)
  const scheduleChangeId = 'schedule-change-risk-evidence'
  const event: WorkbenchFeishuCalendarEventSnapshot = {
    calendarId: CALENDAR_ID,
    eventId: EVENT_ID,
    organizerCalendarId: CALENDAR_ID,
    summary: 'Risk review checkpoint',
    description: null,
    schedule: { kind: 'all-day', startDate: '2026-09-10', endDate: '2026-09-11' },
    status: 'confirmed',
    recurring: false,
    exception: false,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${EVENT_ID}`,
    remoteObservationVersion: `sha256:${'1'.repeat(64)}`,
    observedAt: '2026-09-01T00:04:30.000Z',
  }
  const milestoneMutation: WorkbenchProjectMilestoneMutation = {
    milestoneId: 'milestone-risk-schedule',
    changeId: scheduleChangeId,
    projectId: 'project-risk-scenario',
    expectedRevision: 1,
    expectedMilestoneRevision: null,
    name: 'Risk review checkpoint',
    description: null,
    intent: { mode: 'existing-event', eventId: EVENT_ID },
    event,
    createdAt: '2026-09-01T00:05:00.000Z',
    command: command(
      'schedule-milestone',
      'owner-project-milestone-create',
      '2026-09-01T00:05:00.000Z',
    ),
  }
  await repository.commitProjectMilestone(milestoneMutation, signal)
  return scheduleChangeId
}

function treatmentTask(
  taskGuid: string,
  remoteVersion: string,
  summary: string,
  completed = false,
): WorkbenchFeishuTaskSnapshot {
  return {
    taskGuid,
    taskId: null,
    parentTaskGuid: null,
    summary,
    description: `Treatment evidence for ${taskGuid}`,
    assignees: [],
    followers: [],
    comments: [],
    completed,
    completedAt: completed ? '2026-09-01T00:03:30.000Z' : null,
    canonicalUrl: `https://applink.feishu.cn/client/todo/detail?guid=${taskGuid}`,
    remoteVersion,
  }
}

async function commitRealProjectTasks(repository: SqliteWorkbenchRepository): Promise<void> {
  const route = await commitVerifiedFeishuRoute(repository)
  const snapshot: WorkbenchFeishuTaskListSnapshot = {
    taskList: {
      taskListGuid: TASK_LIST_GUID,
      name: 'Risk treatment tasks',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/tasklist-risk-treatment',
      remoteVersion: '1',
    },
    tasks: [
      treatmentTask(PRIMARY_TASK_GUID, '100', 'Primary mitigation'),
      treatmentTask(REPLACEMENT_TASK_GUID, '100', 'Replacement mitigation', true),
    ],
    observedAt: '2026-09-01T00:04:00.000Z',
  }
  const mutation: WorkbenchFeishuTaskListBindingMutation = {
    projectId: 'project-risk-scenario',
    intent: { mode: 'existing', taskListGuid: TASK_LIST_GUID },
    expectedBindingRevision: null,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    route,
    createdByWorkbench: false,
    snapshot,
    boundAt: '2026-09-01T00:04:00.000Z',
    command: command(
      'task-binding',
      'owner-feishu-task-list-bind',
      '2026-09-01T00:04:00.000Z',
    ),
  }
  const committed = await repository.commitFeishuTaskListBinding(mutation, signal)
  if (!committed.ok) throw new Error('Risk treatment task binding fixture failed')
}

function createRequest(): CreateProjectRiskRequest {
  return {
    projectId: 'project-risk-scenario',
    assessment: {
      statement: {
        condition: 'The approval owner has not confirmed availability',
        event: 'the approval may miss the launch window',
        consequence: 'the launch commitment may move',
      },
      category: 'schedule',
      trigger: { statement: 'approval remains absent on review day', state: 'unknown' },
      probability: { lowerBasisPoints: 1_000, upperBasisPoints: 2_000 },
      impact: { lowerBand: 2, upperBand: 3 },
      confidence: 'medium',
      confidenceRationale: 'The owner has not yet answered.',
      assessmentHorizonEnd: '2026-10-01',
      nextReviewOn: '2026-09-02',
      assumptions: ['The launch scope stays fixed.'],
      accountableMemberId: 'member-risk-owner',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
      evidence: [],
      dependencies: [],
      mitigationTaskGuids: [],
      contingencyTaskGuids: [],
    },
    expectedRisksRevision: 0,
    expectedRiskRevision: null,
    expectedTeamRevision: 1,
    expectedTaskRevision: 0,
    idempotencyKey: 'create-risk-idempotency',
    causationId: 'create-risk-causation',
    reason: 'owner-project-risk-create',
  }
}

function treatmentRequest(
  suffix: string,
  expectedRisksRevision: number,
  mitigationTaskGuids: readonly string[],
  contingencyTaskGuids: readonly string[] = [],
): CreateProjectRiskRequest {
  const request = createRequest()
  return {
    ...request,
    assessment: { ...request.assessment, mitigationTaskGuids, contingencyTaskGuids },
    expectedRisksRevision,
    expectedTaskRevision: 1,
    idempotencyKey: `risk-treatment-${suffix}`,
    causationId: `risk-treatment-${suffix}-causation`,
  }
}

function treatmentTaskEvent(
  eventId: string,
  kind: 'upsert' | 'removed',
  remoteVersion: string,
): WorkbenchFeishuTaskEventObservation {
  return {
    event: {
      eventId,
      taskListGuid: TASK_LIST_GUID,
      taskGuid: PRIMARY_TASK_GUID,
      kind,
      remoteVersion,
      occurredAt: kind === 'removed'
        ? '2026-09-01T00:05:00.000Z'
        : '2026-09-01T00:06:00.000Z',
    },
    task: kind === 'upsert'
      ? treatmentTask(PRIMARY_TASK_GUID, remoteVersion, 'Primary mitigation restored')
      : null,
  }
}

function riskDurableState(repository: SqliteWorkbenchRepository): unknown {
  const database = Reflect.get(repository, 'database') as DatabaseSync
  return {
    head: database.prepare(`
      SELECT revision, next_risk_sequence, next_activity_sequence, updated_at
      FROM workbench_project_risk_head WHERE project_id = ?
    `).get('project-risk-scenario'),
    risks: database.prepare(`
      SELECT id, revision, status, closure_reason, current_assessment_id,
        next_assessment_sequence, next_transition_sequence, next_history_sequence, updated_at
      FROM workbench_project_risk WHERE project_id = ? ORDER BY sequence
    `).all('project-risk-scenario'),
    assessments: database.prepare(`
      SELECT id, risk_id, sequence, history_sequence, assessment_digest
      FROM workbench_project_risk_assessment WHERE project_id = ? ORDER BY risk_id, sequence
    `).all('project-risk-scenario'),
    treatmentTasks: database.prepare(`
      SELECT task.assessment_id, task.role, task.task_guid
      FROM workbench_project_risk_task AS task
      INNER JOIN workbench_project_risk_assessment AS assessment
        ON assessment.id = task.assessment_id
      WHERE assessment.project_id = ?
      ORDER BY task.assessment_id, task.role, task.task_guid
    `).all('project-risk-scenario'),
    transitions: database.prepare(`
      SELECT id, risk_id, sequence, history_sequence, from_status, to_status
      FROM workbench_project_risk_transition WHERE project_id = ? ORDER BY risk_id, sequence
    `).all('project-risk-scenario'),
    activity: database.prepare(`
      SELECT id, risk_id, risk_revision, action, assessment_id, transition_id
      FROM workbench_project_risk_activity WHERE project_id = ? ORDER BY sequence
    `).all('project-risk-scenario'),
  }
}

function taskWriteState(repository: SqliteWorkbenchRepository): unknown {
  const database = Reflect.get(repository, 'database') as DatabaseSync
  return database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workbench_feishu_task_effect) AS task_effects,
      (SELECT COUNT(*) FROM workbench_command_receipt
        WHERE command_type = 'workbench.feishu-task.update') AS task_update_receipts,
      (SELECT COUNT(*) FROM workbench_outbox
        WHERE topic = 'workbench.feishu-task.update.v1') AS task_update_outbox
  `).get()
}

async function treatmentFixture(): Promise<Readonly<{
  repository: SqliteWorkbenchRepository
  scenario: WorkbenchScenario
}>> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-risk-treatment-'))
  roots.add(root)
  const repository = new SqliteWorkbenchRepository({
    databasePath: join(root, 'workbench.sqlite'),
    journalMode: 'wal',
    busyTimeoutMs: 1_000,
  })
  await repository.open()
  if (!(await repository.commitProject(projectMutation(), signal)).ok) {
    throw new Error('Risk treatment Project fixture failed')
  }
  if (!(await repository.commitProjectMember(memberMutation(), signal)).ok) {
    throw new Error('Risk treatment member fixture failed')
  }
  await commitRealProjectTasks(repository)
  const authorization: WorkbenchAuthorization = {
    require: async () => ({
      ownerId: 'owner-risk-scenario',
      organizationId: 'organization-risk-scenario',
      teamId: 'team-risk-scenario',
    }),
    filterProjection: async (_action, projection) => projection,
  }
  const scenario = new WorkbenchScenario({
    repository,
    authorization,
    adapters: noWorkbenchExternalAdapters,
    clock: { now: () => new Date('2026-09-01T08:00:00.000Z') },
    ids: randomWorkbenchIds,
    maxStatusLength: 280,
    taskReconciliationIntervalMs: 0,
    calendarReconciliationIntervalMs: 0,
  })
  await scenario.open()
  return { repository, scenario }
}

describe('Project Risk Scenario with real SQLite', () => {
  it('keeps stable same-Project Risks selectable while transactionally rejecting self and cycles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-risk-dependency-options-'))
    roots.add(root)
    const repository = new SqliteWorkbenchRepository({
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()
    expect((await repository.commitProject(projectMutation(), signal)).ok).toBe(true)
    expect((await repository.commitProjectMember(memberMutation(), signal)).ok).toBe(true)
    const authorization: WorkbenchAuthorization = {
      require: async () => ({
        ownerId: 'owner-risk-scenario',
        organizationId: 'organization-risk-scenario',
        teamId: 'team-risk-scenario',
      }),
      filterProjection: async (_action, projection) => projection,
    }
    const scenario = new WorkbenchScenario({
      repository,
      authorization,
      adapters: noWorkbenchExternalAdapters,
      clock: { now: () => new Date('2026-09-01T08:00:00.000Z') },
      ids: randomWorkbenchIds,
      maxStatusLength: 280,
      taskReconciliationIntervalMs: 0,
      calendarReconciliationIntervalMs: 0,
    })
    await scenario.open()
    try {
      const target = await scenario.createProjectRisk({
        ...createRequest(),
        idempotencyKey: 'create-risk-dependency-target',
        causationId: 'create-risk-dependency-target-causation',
      }, signal)
      if (!target.ok) throw new Error('Dependency target fixture creation failed')
      const targetRiskId = target.risk.riskId
      await expect(scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: targetRiskId,
      }, signal)).resolves.toMatchObject({
        dependencyOptions: [{ riskId: targetRiskId, status: 'research', selectable: true }],
      })

      const source = await scenario.createProjectRisk({
        ...createRequest(),
        assessment: {
          ...createRequest().assessment,
          statement: {
            condition: 'The dependency target remains unresolved',
            event: 'the dependent work may miss its review window',
            consequence: 'the launch decision may be delayed',
          },
          dependencies: [{ kind: 'depends-on', riskId: targetRiskId }],
        },
        expectedRisksRevision: 1,
        idempotencyKey: 'create-risk-dependency-source',
        causationId: 'create-risk-dependency-source-causation',
      }, signal)
      if (!source.ok) throw new Error('Dependency source fixture creation failed')
      const sourceRiskId = source.risk.riskId

      const cycle = await scenario.reviseProjectRisk({
        ...createRequest(),
        riskId: targetRiskId,
        assessment: {
          ...createRequest().assessment,
          dependencies: [{ kind: 'depends-on', riskId: sourceRiskId }],
        },
        expectedRisksRevision: 2,
        expectedRiskRevision: 1,
        idempotencyKey: 'revise-risk-dependency-cycle',
        causationId: 'revise-risk-dependency-cycle-causation',
        reason: 'owner-project-risk-revise',
      }, signal)
      expect(cycle).toMatchObject({ ok: false, error: { code: 'dependency-cycle' } })

      const selfReference = await scenario.reviseProjectRisk({
        ...createRequest(),
        riskId: sourceRiskId,
        assessment: {
          ...createRequest().assessment,
          dependencies: [{ kind: 'depends-on', riskId: sourceRiskId }],
        },
        expectedRisksRevision: 2,
        expectedRiskRevision: 1,
        idempotencyKey: 'revise-risk-dependency-self',
        causationId: 'revise-risk-dependency-self-causation',
        reason: 'owner-project-risk-revise',
      }, signal)
      expect(selfReference).toMatchObject({
        ok: false,
        error: { code: 'dependency-self-reference' },
      })

      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: targetRiskId,
        status: 'closed',
        closureReason: 'no-longer-exists',
        rationale: 'The target uncertainty no longer exists.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 1,
        expectedTaskRevision: 0,
        idempotencyKey: 'close-risk-dependency-target',
        causationId: 'close-risk-dependency-target-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({ ok: true, risk: { status: 'closed' } })

      await expect(scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: sourceRiskId,
      }, signal)).resolves.toMatchObject({
        selectedRisk: {
          risk: {
            riskId: sourceRiskId,
            currentAssessment: {
              dependencies: [{ kind: 'depends-on', riskId: targetRiskId }],
            },
          },
        },
        dependencyOptions: expect.arrayContaining([
          expect.objectContaining({
            riskId: targetRiskId,
            status: 'closed',
            selectable: true,
          }),
        ]),
      })
    } finally {
      await scenario.close()
    }
  })

  it('uses real T10 schedule changes as same-Project evidence and rejects cross-Project reuse', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-risk-schedule-evidence-'))
    roots.add(root)
    const repository = new SqliteWorkbenchRepository({
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()
    expect((await repository.commitProject(projectMutation(), signal)).ok).toBe(true)
    expect((await repository.commitProjectMember(memberMutation(), signal)).ok).toBe(true)
    const scheduleChangeId = await commitRealProjectScheduleChange(repository)
    expect(await repository.commitProject(crossProjectMutation(), signal)).toMatchObject({ ok: true })
    expect((await repository.commitProjectMember(crossMemberMutation(), signal)).ok).toBe(true)
    const authorization: WorkbenchAuthorization = {
      require: async () => ({
        ownerId: 'owner-risk-scenario',
        organizationId: 'organization-risk-scenario',
        teamId: 'team-risk-scenario',
      }),
      filterProjection: async (_action, projection) => projection,
    }
    const scenario = new WorkbenchScenario({
      repository,
      authorization,
      adapters: noWorkbenchExternalAdapters,
      clock: { now: () => new Date('2026-09-01T08:00:00.000Z') },
      ids: randomWorkbenchIds,
      maxStatusLength: 280,
      taskReconciliationIntervalMs: 0,
      calendarReconciliationIntervalMs: 0,
    })
    await scenario.open()
    try {
      const projection = await scenario.projectRisks({ projectId: 'project-risk-scenario' }, signal)
      expect(projection?.evidenceOptions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'project-schedule-change',
          scheduleChangeId,
          source: 'workbench',
          changedFields: ['schedule'],
        }),
      ]))
      const sameProject = await scenario.createProjectRisk({
        ...createRequest(),
        assessment: {
          ...createRequest().assessment,
          evidence: [{ kind: 'project-schedule-change', scheduleChangeId }],
        },
        idempotencyKey: 'create-risk-schedule-evidence',
        causationId: 'create-risk-schedule-evidence-causation',
      }, signal)
      expect(sameProject).toMatchObject({
        ok: true,
        risk: {
          currentAssessment: {
            evidence: [{ kind: 'project-schedule-change', scheduleChangeId }],
          },
        },
      })

      const crossProject = await scenario.createProjectRisk({
        ...createRequest(),
        projectId: CROSS_PROJECT_ID,
        assessment: {
          ...createRequest().assessment,
          accountableMemberId: 'member-risk-schedule-cross',
          evidence: [{ kind: 'project-schedule-change', scheduleChangeId }],
        },
        idempotencyKey: 'create-risk-cross-schedule-evidence',
        causationId: 'create-risk-cross-schedule-evidence-causation',
      }, signal)
      expect(crossProject).toMatchObject({
        ok: false,
        error: { code: 'evidence-project-mismatch' },
      })
      await expect(scenario.projectRisks({ projectId: CROSS_PROJECT_ID }, signal)).resolves.toMatchObject({
        revision: 0,
        risks: [],
      })
    } finally {
      await scenario.close()
    }
  })

  it('keeps a retained mitigation link and Risk history stable across disappearance and reappearance', async () => {
    const { repository, scenario } = await treatmentFixture()
    try {
      const created = await scenario.createProjectRisk(treatmentRequest(
        'retained-create',
        0,
        [PRIMARY_TASK_GUID],
      ), signal)
      if (!created.ok) throw new Error('Retained Risk fixture creation failed')
      const riskId = created.risk.riskId
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId,
        status: 'mitigate',
        rationale: 'The visible task is the active mitigation.',
        expectedRisksRevision: 1,
        expectedRiskRevision: 1,
        expectedTaskRevision: 1,
        idempotencyKey: 'risk-treatment-retained-mitigate',
        causationId: 'risk-treatment-retained-mitigate-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: true,
        risk: { revision: 2, status: 'mitigate' },
      })

      const before = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: riskId,
      }, signal)
      const durableBefore = riskDurableState(repository)
      const taskWritesBefore = taskWriteState(repository)
      expect(taskWritesBefore).toEqual({
        task_effects: 0,
        task_update_receipts: 0,
        task_update_outbox: 0,
      })
      expect(before).toMatchObject({
        revision: 2,
        taskRevision: 1,
        selectedRisk: { risk: {
          riskId,
          revision: 2,
          status: 'mitigate',
          currentAssessment: { sequence: 1, mitigationTaskGuids: [PRIMARY_TASK_GUID] },
          treatmentTasks: [{
            role: 'mitigation',
            taskGuid: PRIMARY_TASK_GUID,
            availability: 'available',
            task: { taskGuid: PRIMARY_TASK_GUID },
          }],
        } },
      })

      await expect(scenario.ingestFeishuTaskEvent(treatmentTaskEvent(
        'risk-treatment-primary-removed',
        'removed',
        '101',
      ), signal)).resolves.toEqual({
        outcome: 'applied',
        projectId: 'project-risk-scenario',
        projectionRevision: 2,
      })
      const unavailable = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: riskId,
      }, signal)
      expect(unavailable).toMatchObject({
        revision: 2,
        taskRevision: 2,
        selectedRisk: { risk: {
          riskId,
          revision: 2,
          status: 'mitigate',
          currentAssessment: { sequence: 1, mitigationTaskGuids: [PRIMARY_TASK_GUID] },
          treatmentTasks: [{
            role: 'mitigation',
            taskGuid: PRIMARY_TASK_GUID,
            availability: 'unavailable',
            task: null,
          }],
        } },
      })
      expect(unavailable?.selectedRisk?.history).toEqual(before?.selectedRisk?.history)
      expect(unavailable?.activity).toEqual(before?.activity)
      expect(riskDurableState(repository)).toEqual(durableBefore)
      expect(taskWriteState(repository)).toEqual(taskWritesBefore)

      await expect(scenario.ingestFeishuTaskEvent(treatmentTaskEvent(
        'risk-treatment-primary-restored',
        'upsert',
        '102',
      ), signal)).resolves.toEqual({
        outcome: 'applied',
        projectId: 'project-risk-scenario',
        projectionRevision: 3,
      })
      const restored = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: riskId,
      }, signal)
      expect(restored).toMatchObject({
        revision: 2,
        taskRevision: 3,
        selectedRisk: { risk: {
          riskId,
          revision: 2,
          status: 'mitigate',
          currentAssessment: { sequence: 1, mitigationTaskGuids: [PRIMARY_TASK_GUID] },
          treatmentTasks: [{
            role: 'mitigation',
            taskGuid: PRIMARY_TASK_GUID,
            availability: 'available',
            task: { taskGuid: PRIMARY_TASK_GUID, remoteVersion: '102' },
          }],
        } },
      })
      expect(restored?.selectedRisk?.history).toEqual(before?.selectedRisk?.history)
      expect(restored?.activity).toEqual(before?.activity)
      expect(riskDurableState(repository)).toEqual(durableBefore)
      expect(taskWriteState(repository)).toEqual(taskWritesBefore)
    } finally {
      await scenario.close()
    }
  })

  it('fences treatment reassessment and mitigation transitions with Task CAS and visibility', async () => {
    const { repository, scenario } = await treatmentFixture()
    try {
      const research = await scenario.createProjectRisk(treatmentRequest(
        'research-create',
        0,
        [],
        [PRIMARY_TASK_GUID],
      ), signal)
      if (!research.ok) throw new Error('Research Risk fixture creation failed')
      expect(research.risk).toMatchObject({
        currentAssessment: {
          mitigationTaskGuids: [],
          contingencyTaskGuids: [PRIMARY_TASK_GUID],
        },
        treatmentTasks: [{
          role: 'contingency',
          taskGuid: PRIMARY_TASK_GUID,
          availability: 'available',
        }],
      })
      const mitigating = await scenario.createProjectRisk(treatmentRequest(
        'mitigate-create',
        1,
        [PRIMARY_TASK_GUID],
      ), signal)
      if (!mitigating.ok) throw new Error('Mitigate Risk fixture creation failed')
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: mitigating.risk.riskId,
        status: 'mitigate',
        rationale: 'The currently visible task is the active mitigation.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 1,
        expectedTaskRevision: 1,
        idempotencyKey: 'risk-treatment-matrix-enter-mitigate',
        causationId: 'risk-treatment-matrix-enter-mitigate-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: true,
        risk: { revision: 2, status: 'mitigate' },
      })
      await expect(scenario.ingestFeishuTaskEvent(treatmentTaskEvent(
        'risk-treatment-matrix-primary-removed',
        'removed',
        '101',
      ), signal)).resolves.toMatchObject({ outcome: 'applied', projectionRevision: 2 })
      const tasksAfterDisappearance = await scenario.projectTasks({
        projectId: 'project-risk-scenario',
      }, signal)
      expect(tasksAfterDisappearance).toMatchObject({
        revision: 2,
        tasks: [{
          taskGuid: REPLACEMENT_TASK_GUID,
          completed: true,
          completedAt: '2026-09-01T00:03:30.000Z',
        }],
      })
      const taskWritesAfterDisappearance = taskWriteState(repository)
      expect(taskWritesAfterDisappearance).toEqual({
        task_effects: 0,
        task_update_receipts: 0,
        task_update_outbox: 0,
      })
      const unavailableResearch = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: research.risk.riskId,
      }, signal)
      expect(unavailableResearch).toMatchObject({
        revision: 3,
        taskRevision: 2,
        selectedRisk: { risk: {
          revision: 1,
          status: 'research',
          currentAssessment: { contingencyTaskGuids: [PRIMARY_TASK_GUID] },
          treatmentTasks: [{
            role: 'contingency',
            taskGuid: PRIMARY_TASK_GUID,
            availability: 'unavailable',
            task: null,
          }],
        } },
      })
      const durableBeforeRejectedCreates = riskDurableState(repository)
      await expect(scenario.createProjectRisk({
        ...treatmentRequest('stale-task-create', 3, [], [PRIMARY_TASK_GUID]),
        expectedTaskRevision: 1,
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-projection-revision-conflict' },
      })
      await expect(scenario.createProjectRisk({
        ...treatmentRequest('unavailable-task-create', 3, [], [PRIMARY_TASK_GUID]),
        expectedTaskRevision: 2,
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-not-in-project' },
      })
      const afterRejectedCreates = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
      }, signal)
      expect(afterRejectedCreates).toMatchObject({ revision: 3, risks: expect.any(Array) })
      expect(afterRejectedCreates?.risks).toHaveLength(2)
      expect(afterRejectedCreates?.activity).toEqual(unavailableResearch?.activity)
      expect(riskDurableState(repository)).toEqual(durableBeforeRejectedCreates)

      const retainedAssessment = treatmentRequest(
        'retained-revise',
        3,
        [],
        [PRIMARY_TASK_GUID],
      ).assessment

      await expect(scenario.reviseProjectRisk({
        ...treatmentRequest('stale-task-revise', 3, [], [PRIMARY_TASK_GUID]),
        riskId: research.risk.riskId,
        assessment: retainedAssessment,
        expectedRiskRevision: 1,
        expectedTaskRevision: 1,
        reason: 'owner-project-risk-revise',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-projection-revision-conflict' },
      })
      await expect(scenario.reviseProjectRisk({
        ...treatmentRequest('unavailable-task-revise', 3, [], [PRIMARY_TASK_GUID]),
        riskId: research.risk.riskId,
        assessment: retainedAssessment,
        expectedRiskRevision: 1,
        expectedTaskRevision: 2,
        reason: 'owner-project-risk-revise',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-not-in-project' },
      })
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: research.risk.riskId,
        status: 'mitigate',
        rationale: 'The stale Risk aggregate must fail before availability is considered.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 1,
        expectedTaskRevision: 2,
        idempotencyKey: 'risk-treatment-matrix-enter-with-stale-register',
        causationId: 'risk-treatment-matrix-enter-with-stale-register-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'risks-revision-conflict' },
      })
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: research.risk.riskId,
        status: 'mitigate',
        rationale: 'The mismatched Risk revision must fail before availability is considered.',
        expectedRisksRevision: 3,
        expectedRiskRevision: 2,
        expectedTaskRevision: 2,
        idempotencyKey: 'risk-treatment-matrix-enter-with-mismatched-risk',
        causationId: 'risk-treatment-matrix-enter-with-mismatched-risk-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'risk-revision-conflict' },
      })
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: research.risk.riskId,
        status: 'mitigate',
        rationale: 'The stale Task projection must fail before availability is considered.',
        expectedRisksRevision: 3,
        expectedRiskRevision: 1,
        expectedTaskRevision: 1,
        idempotencyKey: 'risk-treatment-matrix-enter-with-stale-tasks',
        causationId: 'risk-treatment-matrix-enter-with-stale-tasks-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-projection-revision-conflict' },
      })
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: research.risk.riskId,
        status: 'mitigate',
        rationale: 'An unavailable retained link is not a current mitigation.',
        expectedRisksRevision: 3,
        expectedRiskRevision: 1,
        expectedTaskRevision: 2,
        idempotencyKey: 'risk-treatment-matrix-enter-with-unavailable-task',
        causationId: 'risk-treatment-matrix-enter-with-unavailable-task-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'mitigation-task-required' },
      })

      await expect(scenario.reviseProjectRisk({
        ...treatmentRequest('remove-unavailable-task', 3, []),
        riskId: research.risk.riskId,
        expectedRiskRevision: 1,
        expectedTaskRevision: 2,
        reason: 'owner-project-risk-revise',
      }, signal)).resolves.toMatchObject({
        ok: true,
        value: { revision: 4 },
        risk: {
          revision: 2,
          status: 'research',
          currentAssessment: {
            sequence: 2,
            mitigationTaskGuids: [],
            contingencyTaskGuids: [],
          },
          treatmentTasks: [],
        },
      })
      await expect(scenario.reviseProjectRisk({
        ...treatmentRequest('mitigate-remove-task', 4, []),
        riskId: mitigating.risk.riskId,
        expectedRiskRevision: 2,
        expectedTaskRevision: 2,
        reason: 'owner-project-risk-revise',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'mitigation-task-required' },
      })
      await expect(scenario.reviseProjectRisk({
        ...treatmentRequest('mitigate-replace-task', 4, [REPLACEMENT_TASK_GUID]),
        riskId: mitigating.risk.riskId,
        expectedRiskRevision: 2,
        expectedTaskRevision: 2,
        reason: 'owner-project-risk-revise',
      }, signal)).resolves.toMatchObject({
        ok: true,
        value: { revision: 5 },
        risk: {
          revision: 3,
          status: 'mitigate',
          currentAssessment: { sequence: 2, mitigationTaskGuids: [REPLACEMENT_TASK_GUID] },
          treatmentTasks: [{
            role: 'mitigation',
            taskGuid: REPLACEMENT_TASK_GUID,
            availability: 'available',
          }],
        },
      })
      const tasksBeforeClose = await scenario.projectTasks({
        projectId: 'project-risk-scenario',
      }, signal)
      expect(tasksBeforeClose).toEqual(tasksAfterDisappearance)
      await expect(scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId: mitigating.risk.riskId,
        status: 'closed',
        closureReason: 'below-threshold',
        rationale: 'The completed mitigation reduced the uncertainty below threshold.',
        expectedRisksRevision: 5,
        expectedRiskRevision: 3,
        expectedTaskRevision: 2,
        idempotencyKey: 'risk-treatment-close-with-completed-task',
        causationId: 'risk-treatment-close-with-completed-task-causation',
        reason: 'owner-project-risk-transition',
      }, signal)).resolves.toMatchObject({
        ok: true,
        value: { revision: 6 },
        risk: {
          revision: 4,
          status: 'closed',
          currentAssessment: { mitigationTaskGuids: [REPLACEMENT_TASK_GUID] },
          treatmentTasks: [{
            role: 'mitigation',
            taskGuid: REPLACEMENT_TASK_GUID,
            availability: 'available',
            task: { completed: true, completedAt: '2026-09-01T00:03:30.000Z' },
          }],
        },
      })
      expect(await scenario.projectTasks({ projectId: 'project-risk-scenario' }, signal))
        .toEqual(tasksBeforeClose)
      expect(taskWriteState(repository)).toEqual(taskWritesAfterDisappearance)
    } finally {
      await scenario.close()
    }
  })

  it('double-authorizes the read and creates one detached research Risk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-risk-scenario-'))
    roots.add(root)
    const repository = new SqliteWorkbenchRepository({
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()
    expect((await repository.commitProject(projectMutation(), signal)).ok).toBe(true)
    expect((await repository.commitProjectMember(memberMutation(), signal)).ok).toBe(true)
    const actions: WorkbenchAction[] = []
    let abortAfterFirstRiskAuthorization: AbortController | null = null
    const authorization: WorkbenchAuthorization = {
      require: async (action) => {
        actions.push(action)
        if (action === 'workbench.project.risk.read'
          && abortAfterFirstRiskAuthorization !== null) {
          abortAfterFirstRiskAuthorization.abort()
          abortAfterFirstRiskAuthorization = null
        }
        return {
          ownerId: 'owner-risk-scenario',
          organizationId: 'organization-risk-scenario',
          teamId: 'team-risk-scenario',
        }
      },
      filterProjection: async (_action, projection) => projection,
    }
    const scenario = new WorkbenchScenario({
      repository,
      authorization,
      adapters: noWorkbenchExternalAdapters,
      clock: { now: () => new Date('2026-09-01T08:00:00.000Z') },
      ids: randomWorkbenchIds,
      maxStatusLength: 280,
      taskReconciliationIntervalMs: 0,
      calendarReconciliationIntervalMs: 0,
    })
    await scenario.open()
    try {
      const preAborted = new AbortController()
      preAborted.abort()
      const authorizationCountBeforeCancellation = actions.length
      const preAbortedCalls: ReadonlyArray<() => Promise<unknown>> = [
        () => scenario.projectRisks({ projectId: 'project-risk-scenario' }, preAborted.signal),
        () => scenario.createProjectRisk({} as never, preAborted.signal),
        () => scenario.reviseProjectRisk({} as never, preAborted.signal),
        () => scenario.transitionProjectRisk({} as never, preAborted.signal),
      ]
      for (const call of preAbortedCalls) {
        await expect(call()).rejects.toMatchObject({ failure: { code: 'cancelled' } })
      }
      expect(actions).toHaveLength(authorizationCountBeforeCancellation)

      const cancelledBetweenCapabilities = new AbortController()
      abortAfterFirstRiskAuthorization = cancelledBetweenCapabilities
      const capabilityStart = actions.length
      await expect(scenario.projectRisks(
        { projectId: 'project-risk-scenario' },
        cancelledBetweenCapabilities.signal,
      )).rejects.toMatchObject({ failure: { code: 'cancelled' } })
      expect(actions.slice(capabilityStart)).toEqual(['workbench.project.risk.read'])

      await expect(scenario.projectRisks({
        projectId: 'project-risk-scenario',
        disposition: 'accept',
      } as never, signal)).rejects.toMatchObject({ failure: { code: 'bad-request' } })
      const created = await scenario.createProjectRisk(createRequest(), signal)
      expect(created).toMatchObject({
        ok: true,
        value: { projectId: 'project-risk-scenario', revision: 1 },
        risk: { revision: 1, status: 'research', currentAssessment: { sequence: 1 } },
      })
      const projection = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: created.ok ? created.risk.riskId : 'missing',
      }, signal)
      expect(projection).toMatchObject({
        revision: 1,
        teamRevision: 1,
        taskRevision: 0,
        selectedRisk: { history: [{ kind: 'assessment', sequence: 1 }] },
      })
      expect(actions.slice(-2)).toEqual([
        'workbench.project.risk.read',
        'workbench.project.risk.activity.read',
      ])
      if (!created.ok) throw new Error('Risk fixture creation failed')
      const riskId = created.risk.riskId
      const inUse = await scenario.setProjectMemberStatus({
        projectId: 'project-risk-scenario',
        memberId: 'member-risk-owner',
        status: 'inactive',
        expectedTeamRevision: 1,
        expectedMemberRevision: 1,
        idempotencyKey: 'member-risk-in-use',
        causationId: 'member-risk-in-use-causation',
        reason: 'owner-project-member-status-change',
      }, signal)
      expect(inUse).toMatchObject({ ok: false, error: { code: 'member-in-use' } })
      const revisionRequest = {
        ...createRequest(),
        riskId,
        assessment: {
          ...createRequest().assessment,
          trigger: { statement: 'approval remains absent on review day', state: 'met' as const },
          confidenceRationale: 'The review day passed without confirmation.',
        },
        expectedRisksRevision: 1,
        expectedRiskRevision: 1,
        idempotencyKey: 'revise-risk-idempotency',
        causationId: 'revise-risk-causation',
        reason: 'owner-project-risk-revise' as const,
      }
      const revised = await scenario.reviseProjectRisk(revisionRequest, signal)
      expect(revised).toMatchObject({
        ok: true,
        value: { revision: 2 },
        risk: {
          revision: 2,
          status: 'research',
          currentAssessment: { sequence: 2, trigger: { state: 'met' } },
        },
      })
      const mitigationWithoutTask = await scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId,
        status: 'mitigate',
        rationale: 'Try to mitigate without creating a task.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 2,
        expectedTaskRevision: 0,
        idempotencyKey: 'mitigate-risk-idempotency',
        causationId: 'mitigate-risk-causation',
        reason: 'owner-project-risk-transition',
      }, signal)
      expect(mitigationWithoutTask).toMatchObject({
        ok: false,
        error: { code: 'mitigation-task-required' },
      })
      const closed = await scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId,
        status: 'closed',
        closureReason: 'superseded',
        rationale: 'A replacement Risk now governs the uncertainty.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 2,
        expectedTaskRevision: 0,
        idempotencyKey: 'close-risk-idempotency',
        causationId: 'close-risk-causation',
        reason: 'owner-project-risk-transition',
      }, signal)
      expect(closed).toMatchObject({
        ok: true,
        value: { revision: 3 },
        risk: { revision: 3, status: 'closed', closureReason: 'superseded' },
      })

      const database = Reflect.get(repository, 'database') as DatabaseSync
      const countsBeforeReplay = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM workbench_project_risk_assessment) AS assessments,
          (SELECT COUNT(*) FROM workbench_project_risk_transition) AS transitions,
          (SELECT COUNT(*) FROM workbench_project_risk_activity) AS activity,
          (SELECT COUNT(*) FROM workbench_outbox) AS outbox,
          (SELECT COUNT(*) FROM workbench_command_receipt) AS receipts
      `).get()
      const replayedRevision = await scenario.reviseProjectRisk(revisionRequest, signal)
      expect(replayedRevision).toMatchObject({
        ok: true,
        risk: { riskId, status: 'closed', revision: 3 },
      })
      expect(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM workbench_project_risk_assessment) AS assessments,
          (SELECT COUNT(*) FROM workbench_project_risk_transition) AS transitions,
          (SELECT COUNT(*) FROM workbench_project_risk_activity) AS activity,
          (SELECT COUNT(*) FROM workbench_outbox) AS outbox,
          (SELECT COUNT(*) FROM workbench_command_receipt) AS receipts
      `).get()).toEqual(countsBeforeReplay)

      const filtered = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        exposure: 'medium',
        status: 'closed',
        riskOwnerMemberId: 'member-risk-owner',
        triggerState: 'met',
        triggerContains: 'APPROVAL REMAINS',
        reviewFrom: '2026-09-01',
        reviewTo: '2026-09-03',
        selectedRiskId: riskId,
      }, signal)
      expect(filtered).toMatchObject({
        risks: [{ riskId, status: 'closed' }],
        selectedRisk: {
          history: [
            { kind: 'transition', sequence: 3 },
            { kind: 'assessment', sequence: 2 },
            { kind: 'assessment', sequence: 1 },
          ],
        },
      })
      const riskLedgerRows = database.prepare(`
        SELECT audit.canonical_envelope, outbox.payload_json, receipt.result_json
        FROM workbench_command_receipt AS receipt
        INNER JOIN workbench_audit_event AS audit ON audit.id = receipt.audit_event_id
        INNER JOIN workbench_outbox AS outbox ON outbox.id = receipt.outbox_id
        WHERE receipt.command_type LIKE 'workbench.project-risk.%'
      `).all() as Array<{
        readonly canonical_envelope: string
        readonly payload_json: string
        readonly result_json: string
      }>
      expect(riskLedgerRows).toHaveLength(3)
      for (const ledgerRow of riskLedgerRows) {
        const serialized = JSON.stringify(ledgerRow)
        expect(serialized).not.toContain('member-risk-owner')
        expect(serialized).not.toContain('approval remains absent')
        expect(serialized).not.toContain('launch commitment may move')
        expect(serialized).not.toContain('The review day passed')
      }
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_assessment
        SET next_review_on = next_review_on WHERE risk_id = ?
      `).run(riskId)).toThrow('assessments are append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_assessment WHERE risk_id = ?
      `).run(riskId)).toThrow('assessments cannot be deleted')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_assessment_member SET display_name = display_name
        WHERE assessment_id IN (
          SELECT id FROM workbench_project_risk_assessment WHERE risk_id = ?
        )
      `).run(riskId)).toThrow('responsibility is immutable')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_transition
        SET rationale = rationale WHERE risk_id = ?
      `).run(riskId)).toThrow('transitions are append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_transition WHERE risk_id = ?
      `).run(riskId)).toThrow('transitions cannot be deleted')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_activity
        SET rationale = rationale WHERE risk_id = ?
      `).run(riskId)).toThrow('Activity is append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_activity WHERE risk_id = ?
      `).run(riskId)).toThrow('Activity cannot be deleted')
      const released = await scenario.setProjectMemberStatus({
        projectId: 'project-risk-scenario',
        memberId: 'member-risk-owner',
        status: 'inactive',
        expectedTeamRevision: 1,
        expectedMemberRevision: 1,
        idempotencyKey: 'member-risk-released',
        causationId: 'member-risk-released-causation',
        reason: 'owner-project-member-status-change',
      }, signal)
      expect(released).toMatchObject({ ok: true, value: { status: 'inactive', teamRevision: 2 } })
    } finally {
      await scenario.close()
    }
  })
})
