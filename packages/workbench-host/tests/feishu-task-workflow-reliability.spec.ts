import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeJson } from '../src/audit.ts'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  FeishuTaskWorkflowFieldCandidate,
  ProjectTaskWorkflowDefinition,
  WorkbenchStatusMutation,
  WorkbenchFeishuTaskWorkflowOperationMutation,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchIdGenerator,
} from '../src/index.ts'
import type { WorkbenchAuthorization } from '../src/authorization.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuTaskExternalAdapter,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
  WorkbenchFeishuTaskWorkflowFieldWrite,
  WorkbenchFeishuWriteResult,
} from '../src/feishu-task-federation.ts'
import type { WorkbenchFeishuExternalAdapter } from '../src/scenario.ts'

const PROJECT_ID = 'project-workflow-reliability'
const APP_ID = 'cli_workflow_reliability'
const OPEN_ID = 'ou_workflow_reliability'
const TASK_LIST_GUID = 'tasklist-workflow-reliability'
const FIELD_GUID = 'field-project-status'
const signal = new AbortController().signal
const temporaryRoots: string[] = []

const authorization: WorkbenchAuthorization = Object.freeze({
  require: async () => Object.freeze({
    ownerId: 'owner-workflow-reliability',
    organizationId: 'organization-workflow-reliability',
    teamId: 'team-workflow-reliability',
  }),
  filterProjection: async <T>(_action: string, projection: T) => projection,
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })))
})

function providerIssue() {
  return Object.freeze({
    code: 'provider-unavailable' as const,
    recovery: 'retry-later' as const,
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function task(
  remoteVersion: string,
  optionGuid: string | null = 'option-doing',
  overrides: Partial<WorkbenchFeishuTaskSnapshot> = {},
): WorkbenchFeishuTaskSnapshot {
  return Object.freeze({
    taskGuid: 'task-primary',
    taskId: null,
    parentTaskGuid: null,
    summary: 'Workflow reliability task',
    description: '',
    assignees: Object.freeze([]),
    followers: Object.freeze([]),
    comments: Object.freeze([]),
    completed: false,
    completedAt: null,
    canonicalUrl: 'https://applink.feishu.cn/client/todo/detail?guid=task-primary',
    remoteVersion,
    customFieldValues: Object.freeze([Object.freeze({
      fieldGuid: FIELD_GUID,
      type: 'single_select',
      singleSelectOptionGuid: optionGuid,
    })]),
    ...overrides,
  })
}

function snapshot(
  taskValue: WorkbenchFeishuTaskSnapshot,
  remoteVersion = '10',
): WorkbenchFeishuTaskListSnapshot {
  return Object.freeze({
    taskList: Object.freeze({
      taskListGuid: TASK_LIST_GUID,
      name: 'Workflow reliability tasks',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/workflow-reliability',
      remoteVersion,
    }),
    tasks: Object.freeze([taskValue]),
    observedAt: '2026-08-31T06:00:00.000Z',
  })
}

function definition(
  overrides: Partial<ProjectTaskWorkflowDefinition> = {},
): ProjectTaskWorkflowDefinition {
  return Object.freeze({
    fieldName: 'Project status',
    initialStateId: 'planned',
    terminalStateIds: Object.freeze(['done']),
    states: Object.freeze([
      Object.freeze({
        stateId: 'planned', name: 'Planned', colorIndex: 1,
        allowedNextStateIds: Object.freeze(['doing']),
      }),
      Object.freeze({
        stateId: 'doing', name: 'Doing', colorIndex: 2,
        allowedNextStateIds: Object.freeze(['done']),
      }),
      Object.freeze({
        stateId: 'done', name: 'Done', colorIndex: 3,
        allowedNextStateIds: Object.freeze([]),
      }),
    ]),
    ...overrides,
  })
}

function existingMapping() {
  return Object.freeze({
    mode: 'existing' as const,
    fieldGuid: FIELD_GUID,
    options: Object.freeze([
      Object.freeze({ stateId: 'planned', optionGuid: 'option-planned' }),
      Object.freeze({ stateId: 'doing', optionGuid: 'option-doing' }),
      Object.freeze({ stateId: 'done', optionGuid: 'option-done' }),
    ]),
  })
}

function field(
  overrides: Partial<FeishuTaskWorkflowFieldCandidate> = {},
): FeishuTaskWorkflowFieldCandidate {
  return Object.freeze({
    fieldGuid: FIELD_GUID,
    name: 'Project status',
    type: 'single_select',
    remoteVersion: 'field-version-1',
    options: Object.freeze([
      Object.freeze({ optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false }),
      Object.freeze({ optionGuid: 'option-doing', name: 'Doing', colorIndex: 2, hidden: false }),
      Object.freeze({ optionGuid: 'option-done', name: 'Done', colorIndex: 3, hidden: false }),
    ]),
    ...overrides,
  })
}

class ReliabilityAdapter implements WorkbenchFeishuExternalAdapter, WorkbenchFeishuTaskExternalAdapter {
  readonly adapterId = 'workflow-reliability-adapter'
  snapshot = snapshot(task('100'))
  workflowFields: readonly FeishuTaskWorkflowFieldCandidate[] = Object.freeze([field()])
  workflowCreateCalls = 0
  workflowUpdateCalls = 0
  taskUpdateCalls = 0
  workflowUpdateMode: 'ok' | 'conflict' | 'unknown' = 'ok'

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    return Object.freeze({ ref, configured: true, source: 'fixture', writable: false })
  }

  async startIdentityVerification(
    input: Readonly<WorkbenchFeishuIdentityVerificationInput>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    if (input.kind !== 'bot' || input.appId !== APP_ID) {
      throw new Error('reliability fixture received an unexpected identity route')
    }
    let disposed = false
    return Object.freeze({
      state: 'verified',
      session: Object.freeze({
        actor: Object.freeze({
          realm: 'feishu-cn',
          appId: APP_ID,
          kind: 'bot',
          openId: OPEN_ID,
          tenantKey: null,
        }),
        displayLabel: 'Workflow Reliability Bot',
        finishVerification: async (): Promise<WorkbenchFeishuResourceVerificationObservation> => {
          if (disposed) throw new Error('reliability identity session was disposed')
          return Object.freeze({
            result: 'healthy',
            scopeInspection: Object.freeze({
              state: 'observed',
              scopes: Object.freeze([
                Object.freeze({
                  scope: 'task:tasklist:read', tokenType: 'tenant', state: 'verified',
                }),
                Object.freeze({
                  scope: 'task:task:write', tokenType: 'tenant', state: 'verified',
                }),
              ]),
              issue: null,
            }),
            resourceProbe: Object.freeze({ state: 'not-tested' }),
          })
        },
        dispose: () => { disposed = true },
      }),
    })
  }

  async listTaskLists(
    _route: WorkbenchFeishuTaskRoute,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly import('../src/client.ts').FeishuTaskListCandidateProjection[]>> {
    return Object.freeze({ state: 'ok', value: Object.freeze([this.snapshot.taskList]) })
  }

  async createTaskList(
    _route: WorkbenchFeishuTaskRoute,
    _input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<import('../src/client.ts').FeishuTaskListCandidateProjection>> {
    return Object.freeze({ state: 'ok', value: this.snapshot.taskList })
  }

  async readTaskList(
    _route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskListSnapshot>> {
    if (taskListGuid !== TASK_LIST_GUID) throw new Error('reliability task-list route changed')
    return Object.freeze({ state: 'ok', value: this.snapshot })
  }

  async readTask(
    _route: WorkbenchFeishuTaskRoute,
    taskGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskSnapshot>> {
    const value = this.snapshot.tasks.find(candidate => candidate.taskGuid === taskGuid)
    return value === undefined
      ? Object.freeze({ state: 'rejected', issue: providerIssue() })
      : Object.freeze({ state: 'ok', value })
  }

  async updateTask(
    _route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly taskGuid: string
      readonly expectedRemoteVersion: string
      readonly idempotencyKey: string
      readonly changes: WorkbenchFeishuTaskPatch
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskSnapshot>> {
    this.taskUpdateCalls += 1
    const current = this.snapshot.tasks[0]
    if (current === undefined || current.taskGuid !== input.taskGuid) {
      throw new Error('reliability task disappeared')
    }
    const customFieldValues = input.changes.workflow === undefined
      ? current.customFieldValues
      : Object.freeze([Object.freeze({
        fieldGuid: input.changes.workflow.fieldGuid,
        type: 'single_select',
        singleSelectOptionGuid: input.changes.workflow.optionGuid,
      })])
    const next = Object.freeze({
      ...current,
      ...(input.changes.completed === undefined ? {} : { completed: input.changes.completed }),
      customFieldValues,
      remoteVersion: String(Number(current.remoteVersion) + 1),
    }) satisfies WorkbenchFeishuTaskSnapshot
    this.snapshot = snapshot(next, this.snapshot.taskList.remoteVersion)
    return Object.freeze({ state: 'ok', value: next })
  }

  async listTaskWorkflowFields(
    _route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskWorkflowFieldCandidate[]>> {
    if (taskListGuid !== TASK_LIST_GUID) throw new Error('reliability workflow list changed')
    return Object.freeze({ state: 'ok', value: this.workflowFields })
  }

  async createTaskWorkflowField(
    _route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly taskListGuid: string
      readonly name: string
      readonly options: readonly { readonly name: string; readonly colorIndex: number }[]
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskWorkflowFieldWrite>> {
    if (input.taskListGuid !== TASK_LIST_GUID) throw new Error('reliability create list changed')
    this.workflowCreateCalls += 1
    const created = Object.freeze({
      fieldGuid: 'field-created-status',
      name: input.name,
      type: 'single_select' as const,
      remoteVersion: 'field-created-version-1',
      options: Object.freeze(input.options.map((option, index) => Object.freeze({
        optionGuid: `option-created-${String(index + 1)}`,
        name: option.name,
        colorIndex: option.colorIndex,
        hidden: false,
      }))),
    })
    this.workflowFields = Object.freeze([created])
    return Object.freeze({ state: 'ok', value: created })
  }

  async updateTaskWorkflowField(
    _route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly fieldGuid: string
      readonly expectedRemoteVersion: string
      readonly name: string
      readonly options: readonly {
        readonly optionGuid?: string
        readonly name: string
        readonly colorIndex: number
      }[]
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskWorkflowFieldWrite> | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuTaskWorkflowFieldWrite
  }> {
    this.workflowUpdateCalls += 1
    const current = this.workflowFields.find(candidate => candidate.fieldGuid === input.fieldGuid)
    if (current === undefined || current.type !== 'single_select') {
      throw new Error('reliability workflow field disappeared')
    }
    if (this.workflowUpdateMode === 'unknown') {
      return Object.freeze({ state: 'unknown', issue: providerIssue() })
    }
    if (this.workflowUpdateMode === 'conflict') {
      return Object.freeze({ state: 'conflict', current: Object.freeze({ ...current, type: 'single_select' }) })
    }
    const next = Object.freeze({
      fieldGuid: input.fieldGuid,
      name: input.name,
      type: 'single_select' as const,
      remoteVersion: `${input.expectedRemoteVersion}-next`,
      options: Object.freeze(input.options.map((option, index) => Object.freeze({
        optionGuid: option.optionGuid ?? `option-migrated-${String(index + 1)}`,
        name: option.name,
        colorIndex: option.colorIndex,
        hidden: false,
      }))),
    })
    this.workflowFields = Object.freeze([next])
    return Object.freeze({ state: 'ok', value: next })
  }
}

function ids(): WorkbenchIdGenerator {
  let command = 0
  let audit = 0
  let outbox = 0
  return Object.freeze({
    nextStatusId: () => 'status-workflow-reliability',
    nextProjectId: () => PROJECT_ID,
    nextProjectMemberId: () => 'member-workflow-reliability',
    nextSuggestedChangeId: () => 'suggested-workflow-reliability',
    nextSuggestedChangeDecisionId: () => 'decision-workflow-reliability',
    nextFeishuVerificationId: () => 'verification-workflow-reliability',
    nextGoalId: () => 'goal-workflow-reliability',
    nextOutcomeId: () => 'outcome-workflow-reliability',
    nextCommandId: () => `command-workflow-${String(++command).padStart(3, '0')}`,
    nextAuditEventId: () => `audit-workflow-${String(++audit).padStart(3, '0')}`,
    nextOutboxId: () => `outbox-workflow-${String(++outbox).padStart(3, '0')}`,
  })
}

function clock(start = '2026-08-31T06:00:00.000Z'): WorkbenchClock {
  let milliseconds = Date.parse(start)
  return Object.freeze({
    now: () => {
      milliseconds += 1_000
      return new Date(milliseconds)
    },
  })
}

function projectRequest(): CreateProjectRequest {
  return Object.freeze({
    template: Object.freeze({
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    }),
    projectName: 'Workflow reliability project',
    primaryGoal: Object.freeze({
      name: 'Prove authoritative workflow convergence',
      outcomes: Object.freeze([Object.freeze({
        name: 'Reliable transitions',
        metric: Object.freeze({
          metricName: 'Cases',
          initialValue: 0,
          targetValue: 8,
          unit: 'cases',
          direction: 'increase',
        }),
      })]),
    }),
    supportingGoals: Object.freeze([]),
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'project-workflow-reliability-0001',
    causationId: 'project-workflow-reliability-cause-0001',
    reason: 'owner-project-create',
  })
}

async function scenarioFixture(
  initialOptionGuid: string | null = 'option-doing',
  databasePath = ':memory:',
): Promise<Readonly<{
  scenario: WorkbenchScenario
  adapter: ReliabilityAdapter
  repository: SqliteWorkbenchRepository
}>> {
  const repository = new SqliteWorkbenchRepository({
    databasePath,
    journalMode: 'wal',
    busyTimeoutMs: 1_000,
  })
  const adapter = new ReliabilityAdapter()
  adapter.snapshot = snapshot(task('100', initialOptionGuid))
  const scenario = new WorkbenchScenario({
    repository,
    clock: clock(),
    ids: ids(),
    adapters: Object.freeze({ feishu: adapter, feishuTasks: adapter }),
    authorization,
    maxStatusLength: 280,
    taskReconciliationIntervalMs: 0,
  })
  await scenario.open()
  await scenario.createProject(projectRequest(), signal)
  await scenario.configureFeishuIdentityRoute({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_WORKFLOW_RELIABILITY_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'workflow-route-configure-0001',
    causationId: 'workflow-route-configure-cause-0001',
    reason: 'owner-feishu-route-configure',
  }, signal)
  await scenario.verifyFeishuIdentityRoute({
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'workflow-route-verify-0001',
    causationId: 'workflow-route-verify-cause-0001',
    reason: 'owner-feishu-route-verify',
  }, signal)
  await scenario.bindFeishuTaskList({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    taskListGuid: TASK_LIST_GUID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'workflow-task-bind-0001',
    causationId: 'workflow-task-bind-cause-0001',
    reason: 'owner-feishu-task-list-bind',
  }, signal)
  return Object.freeze({ scenario, adapter, repository })
}

function configureExisting(scenario: WorkbenchScenario) {
  return scenario.configureFeishuTaskWorkflow({
    projectId: PROJECT_ID,
    expectedTaskRevision: 1,
    expectedWorkflowRevision: null,
    definition: definition(),
    mapping: existingMapping(),
    idempotencyKey: 'workflow-existing-configure-0001',
    causationId: 'workflow-existing-configure-cause-0001',
    reason: 'owner-feishu-task-workflow-configure',
  }, signal)
}

function createWorkflowRequest(suffix: string) {
  return Object.freeze({
    projectId: PROJECT_ID,
    expectedTaskRevision: 1,
    expectedWorkflowRevision: null,
    definition: definition(),
    mapping: Object.freeze({ mode: 'create' as const }),
    idempotencyKey: `workflow-create-${suffix}-idempotency`,
    causationId: `workflow-create-${suffix}-causation`,
    reason: 'owner-feishu-task-workflow-configure' as const,
  })
}

function workflowOperationMutation(
  request: ReturnType<typeof createWorkflowRequest>,
  suffix: string,
): WorkbenchFeishuTaskWorkflowOperationMutation {
  const preparedAt = '2026-08-31T06:01:00.000Z'
  return Object.freeze({
    operationId: `operation-workflow-${suffix}`,
    projectId: request.projectId,
    expectedTaskRevision: request.expectedTaskRevision,
    expectedWorkflowRevision: request.expectedWorkflowRevision,
    definition: request.definition,
    mapping: request.mapping,
    preparedAt,
    command: Object.freeze({
      commandId: `command-workflow-${suffix}`,
      auditEventId: `audit-workflow-${suffix}`,
      outboxId: `outbox-workflow-${suffix}`,
      idempotencyKey: request.idempotencyKey,
      causationId: request.causationId,
      reason: request.reason,
      actor: Object.freeze({
        kind: 'owner' as const,
        id: 'owner-workflow-reliability',
        organizationId: 'organization-workflow-reliability',
        teamId: 'team-workflow-reliability',
      }),
      occurredAt: preparedAt,
    }),
  })
}

function restartScenario(
  repository: SqliteWorkbenchRepository,
  adapter: ReliabilityAdapter,
): WorkbenchScenario {
  return new WorkbenchScenario({
    repository,
    clock: clock('2026-08-31T06:01:00.000Z'),
    ids: ids(),
    adapters: Object.freeze({ feishu: adapter, feishuTasks: adapter }),
    authorization,
    maxStatusLength: 280,
    taskReconciliationIntervalMs: 0,
  })
}

function dropV8WorkflowSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE workbench_deliverable_calendar_effect;
    DROP TABLE workbench_deliverable_activity;
    DROP TABLE workbench_deliverable_final_release_version;
    DROP TABLE workbench_deliverable_final_release;
    DROP TABLE workbench_deliverable_acceptance_decision;
    DROP TABLE workbench_deliverable_candidate_version;
    DROP TABLE workbench_deliverable_acceptance_request;
    DROP TABLE workbench_project_deliverable_member;
    DROP TABLE workbench_project_deliverable;
    DROP TABLE workbench_calendar_commitment;
    DROP TABLE workbench_project_deliverable_head;
    DROP TABLE workbench_feishu_calendar_effect;
    DROP TABLE workbench_feishu_calendar_inbox;
    DROP TABLE workbench_project_schedule_change;
    DROP TABLE workbench_project_milestone;
    DROP TABLE workbench_project_calendar_binding;
    DROP TABLE workbench_project_calendar_head;
    DROP TRIGGER workbench_feishu_task_workflow_operation_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_operation_intent_no_update;
    DROP TRIGGER workbench_feishu_task_workflow_version_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_version_no_update;
    DROP TRIGGER workbench_feishu_task_workflow_no_delete;
    DROP TRIGGER workbench_feishu_task_workflow_scope_no_update;
    DROP TABLE workbench_feishu_task_custom_value;
    DROP TABLE workbench_feishu_task_workflow_operation;
    DROP TABLE workbench_feishu_task_workflow_version;
    DROP TABLE workbench_feishu_task_workflow;
    PRAGMA user_version = 7;
    PRAGMA foreign_keys = ON;
  `)
}

function legacyStatusMutation(): WorkbenchStatusMutation {
  const occurredAt = '2026-08-30T06:00:00.000Z'
  return Object.freeze({
    candidateId: 'status-before-v8',
    message: 'Preserved across the T09 migration',
    expectedRevision: null,
    updatedAt: occurredAt,
    command: Object.freeze({
      commandId: 'command-before-v8',
      auditEventId: 'audit-before-v8',
      outboxId: 'outbox-before-v8',
      idempotencyKey: 'status-before-v8-idempotency',
      causationId: 'status-before-v8-causation',
      reason: 'owner-status-edit',
      actor: Object.freeze({
        kind: 'owner',
        id: 'owner-workflow-reliability',
        organizationId: 'organization-workflow-reliability',
        teamId: 'team-workflow-reliability',
      }),
      occurredAt,
    }),
  })
}

describe('T09 workflow reliability', () => {
  it('migrates an exact Schema v7 database to v10 and survives a second restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-t09-v7-'))
    temporaryRoots.push(root)
    const databasePath = join(root, 'workbench.sqlite')
    const seeded = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await seeded.open()
    await seeded.commitStatus(legacyStatusMutation(), signal)
    const seededDatabase = Reflect.get(seeded, 'database') as DatabaseSync
    dropV8WorkflowSchema(seededDatabase)
    await seeded.close()

    const upgraded = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await upgraded.open()
    const upgradedDatabase = Reflect.get(upgraded, 'database') as DatabaseSync
    expect(upgradedDatabase.prepare('PRAGMA user_version').get()).toEqual({
      user_version: WORKBENCH_SCHEMA_VERSION,
    })
    expect(upgradedDatabase.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE 'workbench_feishu_task_workflow%'
      ORDER BY name
    `).all()).toEqual([
      { name: 'workbench_feishu_task_workflow' },
      { name: 'workbench_feishu_task_workflow_operation' },
      { name: 'workbench_feishu_task_workflow_version' },
    ])
    expect(upgradedDatabase.prepare(`
      SELECT name FROM pragma_table_info('workbench_feishu_task_workflow_operation')
      WHERE name IN ('definition_json', 'mapping_json') ORDER BY name
    `).all()).toEqual([{ name: 'definition_json' }, { name: 'mapping_json' }])
    await expect(upgraded.snapshot(signal)).resolves.toMatchObject({
      id: 'status-before-v8',
      message: 'Preserved across the T09 migration',
      revision: 1,
    })
    await expect(upgraded.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
    })
    await upgraded.close()

    const restarted = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await restarted.open()
    await expect(restarted.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
    })
    expect((Reflect.get(restarted, 'database') as DatabaseSync)
      .prepare('PRAGMA user_version').get()).toEqual({
        user_version: WORKBENCH_SCHEMA_VERSION,
      })
    await restarted.close()
  })

  it('resumes a prepared workflow operation after restart with its original ledger identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-t09-prepared-'))
    temporaryRoots.push(root)
    const databasePath = join(root, 'workbench.sqlite')
    const seeded = await scenarioFixture(null, databasePath)
    seeded.adapter.workflowFields = Object.freeze([])
    const request = createWorkflowRequest('prepared-restart-0001')
    const mutation = workflowOperationMutation(request, 'prepared-restart-0001')

    await expect(seeded.repository.reserveFeishuTaskWorkflowOperation(mutation, signal))
      .resolves.toEqual({
        state: 'deliver',
        operationId: mutation.operationId,
        command: mutation.command,
      })
    const seededDatabase = Reflect.get(seeded.repository, 'database') as DatabaseSync
    expect(seededDatabase.prepare(`
      SELECT state, attempt_count, command_id, audit_event_id, outbox_id
      FROM workbench_feishu_task_workflow_operation WHERE id = ?
    `).get(mutation.operationId)).toEqual({
      state: 'prepared',
      attempt_count: 0,
      command_id: mutation.command.commandId,
      audit_event_id: mutation.command.auditEventId,
      outbox_id: mutation.command.outboxId,
    })
    const reservedOutbox = seededDatabase.prepare(`
      SELECT state, attempt_count, error_code, payload_json
      FROM workbench_outbox WHERE id = ?
    `).get(mutation.command.outboxId) as {
      readonly state: string
      readonly attempt_count: number
      readonly error_code: string | null
      readonly payload_json: string
    }
    expect(reservedOutbox).toMatchObject({ state: 'pending', attempt_count: 0, error_code: null })
    expect(reservedOutbox.payload_json).not.toContain('Project status')
    expect(reservedOutbox.payload_json).not.toContain('Planned')
    await seeded.scenario.close()

    const repository = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    const restarted = restartScenario(repository, seeded.adapter)
    await restarted.open()
    const delivered = await restarted.configureFeishuTaskWorkflow(request, signal)
    expect(delivered).toMatchObject({
      ok: true,
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
      value: { workflow: { revision: 1, field: { fieldGuid: 'field-created-status' } } },
    })
    await expect(restarted.configureFeishuTaskWorkflow(request, signal)).resolves.toEqual(delivered)
    expect(seeded.adapter.workflowCreateCalls).toBe(1)

    const restartedDatabase = Reflect.get(repository, 'database') as DatabaseSync
    expect(restartedDatabase.prepare(`
      SELECT state, attempt_count FROM workbench_feishu_task_workflow_operation WHERE id = ?
    `).get(mutation.operationId)).toEqual({ state: 'delivered', attempt_count: 1 })
    expect(restartedDatabase.prepare(`
      SELECT state, attempt_count, error_code FROM workbench_outbox WHERE id = ?
    `).get(mutation.command.outboxId)).toEqual({
      state: 'delivered', attempt_count: 1, error_code: null,
    })
    expect(restartedDatabase.prepare(`
      SELECT
        (SELECT COUNT(*) FROM workbench_command_receipt WHERE command_id = ?) AS receipts,
        (SELECT COUNT(*) FROM workbench_audit_event WHERE command_id = ?) AS audits,
        (SELECT COUNT(*) FROM workbench_outbox WHERE command_id = ?) AS outboxes
    `).get(
      mutation.command.commandId,
      mutation.command.commandId,
      mutation.command.commandId,
    )).toEqual({ receipts: 1, audits: 1, outboxes: 1 })
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({ valid: true })
    await restarted.close()
  })

  it('recovers an inflight response-loss as unknown without redelivering after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-t09-inflight-'))
    temporaryRoots.push(root)
    const databasePath = join(root, 'workbench.sqlite')
    const seeded = await scenarioFixture(null, databasePath)
    seeded.adapter.workflowFields = Object.freeze([])
    const request = createWorkflowRequest('inflight-restart-0001')
    const mutation = workflowOperationMutation(request, 'inflight-restart-0001')
    await seeded.repository.reserveFeishuTaskWorkflowOperation(mutation, signal)
    await expect(seeded.repository.claimFeishuTaskWorkflowOperation(
      mutation.operationId,
      '2026-08-31T06:01:01.000Z',
      signal,
    )).resolves.toBe(true)
    await seeded.adapter.createTaskWorkflowField(
      {} as WorkbenchFeishuTaskRoute,
      Object.freeze({
        taskListGuid: TASK_LIST_GUID,
        name: request.definition.fieldName,
        options: Object.freeze(request.definition.states.map(state => Object.freeze({
          name: state.name,
          colorIndex: state.colorIndex,
        }))),
      }),
      signal,
    )
    expect(seeded.adapter.workflowCreateCalls).toBe(1)
    await seeded.scenario.close()

    const repository = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    const restarted = restartScenario(repository, seeded.adapter)
    await restarted.open()
    await expect(restarted.configureFeishuTaskWorkflow(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    await expect(restarted.configureFeishuTaskWorkflow(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(seeded.adapter.workflowCreateCalls).toBe(1)

    const restartedDatabase = Reflect.get(repository, 'database') as DatabaseSync
    expect(restartedDatabase.prepare(`
      SELECT state, attempt_count FROM workbench_feishu_task_workflow_operation WHERE id = ?
    `).get(mutation.operationId)).toEqual({ state: 'unknown', attempt_count: 1 })
    const unknownOutbox = restartedDatabase.prepare(`
      SELECT state, attempt_count, error_code, payload_json
      FROM workbench_outbox WHERE id = ?
    `).get(mutation.command.outboxId) as {
      readonly state: string
      readonly attempt_count: number
      readonly error_code: string | null
      readonly payload_json: string
    }
    expect(unknownOutbox).toMatchObject({
      state: 'unknown', attempt_count: 1, error_code: 'transport-ambiguous',
    })
    expect(unknownOutbox.payload_json).not.toContain('Project status')
    expect(unknownOutbox.payload_json).not.toContain('Planned')
    expect(restartedDatabase.prepare(`
      SELECT
        (SELECT COUNT(*) FROM workbench_command_receipt WHERE command_id = ?) AS receipts,
        (SELECT COUNT(*) FROM workbench_audit_event WHERE command_id = ?) AS audits,
        (SELECT COUNT(*) FROM workbench_outbox WHERE command_id = ?) AS outboxes
    `).get(
      mutation.command.commandId,
      mutation.command.commandId,
      mutation.command.commandId,
    )).toEqual({ receipts: 1, audits: 1, outboxes: 1 })
    const activity = await repository.readActivity({
      organizationId: 'organization-workflow-reliability',
      filter: { projectId: PROJECT_ID, objectType: 'feishu-task-workflow', limit: 10 },
    }, signal)
    expect(activity.items).toEqual([
      expect.objectContaining({
        eventId: mutation.command.auditEventId,
        causationId: request.causationId,
        outbox: expect.objectContaining({
          id: mutation.command.outboxId,
          state: 'unknown',
          attemptCount: 1,
          errorCode: 'transport-ambiguous',
        }),
      }),
    ])
    expect(JSON.stringify(activity)).not.toContain('Project status')
    expect(JSON.stringify(activity)).not.toContain('Planned')
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({ valid: true })
    await restarted.close()
  })

  it('recomputes the reserved workflow request hash from immutable normalized intent', async () => {
    const fixture = await scenarioFixture(null)
    fixture.adapter.workflowFields = Object.freeze([])
    const request = createWorkflowRequest('intent-integrity-0001')
    const mutation = workflowOperationMutation(request, 'intent-integrity-0001')
    await fixture.repository.reserveFeishuTaskWorkflowOperation(mutation, signal)
    const database = Reflect.get(fixture.repository, 'database') as DatabaseSync
    database.exec('DROP TRIGGER workbench_feishu_task_workflow_operation_intent_no_update')
    database.prepare(`
      UPDATE workbench_feishu_task_workflow_operation SET definition_json = ? WHERE id = ?
    `).run(canonicalizeJson(definition({ fieldName: 'Tampered project status' })), mutation.operationId)

    await expect(fixture.repository.reserveFeishuTaskWorkflowOperation(mutation, signal))
      .rejects.toThrow(/invalid request or Outbox facts/u)
    await fixture.scenario.close()
  })

  it('persists stable GUIDs for existing, create, and migrate mapping modes', async () => {
    const existing = await scenarioFixture()
    await expect(configureExisting(existing.scenario)).resolves.toMatchObject({
      ok: true,
      value: {
        workflow: {
          field: { fieldGuid: FIELD_GUID },
          options: [
            { stateId: 'planned', optionGuid: 'option-planned' },
            { stateId: 'doing', optionGuid: 'option-doing' },
            { stateId: 'done', optionGuid: 'option-done' },
          ],
        },
      },
    })
    await existing.scenario.close()

    const created = await scenarioFixture(null)
    created.adapter.workflowFields = Object.freeze([])
    const createRequest = Object.freeze({
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
      expectedWorkflowRevision: null,
      definition: definition(),
      mapping: Object.freeze({ mode: 'create' }),
      idempotencyKey: 'workflow-create-configure-0001',
      causationId: 'workflow-create-configure-cause-0001',
      reason: 'owner-feishu-task-workflow-configure' as const,
    })
    const createdResult = await created.scenario.configureFeishuTaskWorkflow(createRequest, signal)
    expect(createdResult).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        workflow: {
          revision: 1,
          field: { fieldGuid: 'field-created-status' },
          options: [
            { stateId: 'planned', optionGuid: 'option-created-1' },
            { stateId: 'doing', optionGuid: 'option-created-2' },
            { stateId: 'done', optionGuid: 'option-created-3' },
          ],
        },
      },
    })
    await expect(created.scenario.configureFeishuTaskWorkflow(createRequest, signal))
      .resolves.toEqual(createdResult)
    expect(created.adapter.workflowCreateCalls).toBe(1)

    const migratedDefinition = definition({
      states: Object.freeze([
        Object.freeze({
          stateId: 'planned', name: 'Planned', colorIndex: 1,
          allowedNextStateIds: Object.freeze(['doing']),
        }),
        Object.freeze({
          stateId: 'doing', name: 'Doing now', colorIndex: 4,
          allowedNextStateIds: Object.freeze(['review']),
        }),
        Object.freeze({
          stateId: 'review', name: 'Review', colorIndex: 5,
          allowedNextStateIds: Object.freeze(['done']),
        }),
        Object.freeze({
          stateId: 'done', name: 'Done', colorIndex: 3,
          allowedNextStateIds: Object.freeze([]),
        }),
      ]),
    })
    const migrateRequest = Object.freeze({
      projectId: PROJECT_ID,
      expectedTaskRevision: 2,
      expectedWorkflowRevision: 1,
      definition: migratedDefinition,
      mapping: Object.freeze({ mode: 'migrate' }),
      idempotencyKey: 'workflow-migrate-configure-0001',
      causationId: 'workflow-migrate-configure-cause-0001',
      reason: 'owner-feishu-task-workflow-configure' as const,
    })
    const migratedResult = await created.scenario.configureFeishuTaskWorkflow(
      migrateRequest,
      signal,
    )
    expect(migratedResult).toMatchObject({
      ok: true,
      value: {
        revision: 3,
        workflow: {
          revision: 2,
          field: { fieldGuid: 'field-created-status' },
          options: [
            { stateId: 'planned', optionGuid: 'option-created-1' },
            { stateId: 'doing', optionGuid: 'option-created-2', name: 'Doing now' },
            { stateId: 'review', optionGuid: 'option-migrated-3' },
            { stateId: 'done', optionGuid: 'option-created-3' },
          ],
        },
      },
    })
    await expect(created.scenario.configureFeishuTaskWorkflow(migrateRequest, signal))
      .resolves.toEqual(migratedResult)
    expect(created.adapter.workflowUpdateCalls).toBe(1)
    await created.scenario.close()
  })

  it('blocks a used-state removal before provider mutation and surfaces a field CAS conflict', async () => {
    const { scenario, adapter, repository } = await scenarioFixture()
    await configureExisting(scenario)
    const removalDefinition = definition({
      states: Object.freeze([
        Object.freeze({
          stateId: 'planned', name: 'Planned', colorIndex: 1,
          allowedNextStateIds: Object.freeze(['done']),
        }),
        Object.freeze({
          stateId: 'done', name: 'Done', colorIndex: 3,
          allowedNextStateIds: Object.freeze([]),
        }),
      ]),
    })
    await expect(scenario.configureFeishuTaskWorkflow({
      projectId: PROJECT_ID,
      expectedTaskRevision: 2,
      expectedWorkflowRevision: 1,
      definition: removalDefinition,
      mapping: Object.freeze({ mode: 'migrate' }),
      idempotencyKey: 'workflow-remove-used-0001',
      causationId: 'workflow-remove-used-cause-0001',
      reason: 'owner-feishu-task-workflow-configure',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-compatibility-blocked',
        compatibility: {
          state: 'blocked',
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'used-state-removal', stateId: 'doing' }),
          ]),
        },
      },
    })
    expect(adapter.workflowUpdateCalls).toBe(0)

    adapter.workflowUpdateMode = 'conflict'
    const renameDefinition = definition({
      states: Object.freeze([
        Object.freeze({
          stateId: 'planned', name: 'Planned', colorIndex: 1,
          allowedNextStateIds: Object.freeze(['doing']),
        }),
        Object.freeze({
          stateId: 'doing', name: 'In progress', colorIndex: 2,
          allowedNextStateIds: Object.freeze(['done']),
        }),
        Object.freeze({
          stateId: 'done', name: 'Done', colorIndex: 3,
          allowedNextStateIds: Object.freeze([]),
        }),
      ]),
    })
    const conflictRequest = Object.freeze({
      projectId: PROJECT_ID,
      expectedTaskRevision: 2,
      expectedWorkflowRevision: 1,
      definition: renameDefinition,
      mapping: Object.freeze({ mode: 'migrate' }),
      idempotencyKey: 'workflow-field-conflict-0001',
      causationId: 'workflow-field-conflict-cause-0001',
      reason: 'owner-feishu-task-workflow-configure' as const,
    })
    await expect(scenario.configureFeishuTaskWorkflow(conflictRequest, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-compatibility-blocked',
        compatibility: {
          state: 'blocked',
          issues: [expect.objectContaining({ code: 'field-version-changed' })],
        },
      },
    })
    expect(adapter.workflowUpdateCalls).toBe(1)
    await expect(scenario.configureFeishuTaskWorkflow(conflictRequest, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-compatibility-blocked',
        compatibility: { issues: [expect.objectContaining({ code: 'field-version-changed' })] },
      },
    })
    expect(adapter.workflowUpdateCalls).toBe(1)
    expect((Reflect.get(repository, 'database') as DatabaseSync).prepare(`
      SELECT operation.state, operation.attempt_count, outbox.state AS outbox_state,
        outbox.attempt_count AS outbox_attempt_count, outbox.error_code
      FROM workbench_feishu_task_workflow_operation AS operation
      INNER JOIN workbench_outbox AS outbox ON outbox.id = operation.outbox_id
      WHERE operation.project_id = ?
    `).get(PROJECT_ID)).toEqual({
      state: 'conflict',
      attempt_count: 1,
      outbox_state: 'failed',
      outbox_attempt_count: 1,
      error_code: 'definitive-rejection',
    })
    await expect(scenario.projectTasks({ projectId: PROJECT_ID }, signal)).resolves.toMatchObject({
      revision: 2,
      workflow: {
        revision: 1,
        options: expect.arrayContaining([
          expect.objectContaining({ stateId: 'doing', name: 'Doing' }),
        ]),
      },
    })
    await scenario.close()
  })

  it('converges an external Feishu terminal state without completing the task', async () => {
    const { scenario, adapter } = await scenarioFixture()
    await configureExisting(scenario)
    adapter.snapshot = snapshot(task('101', 'option-done'), '11')
    await expect(scenario.reconcileProjectTasks({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        tasks: [{ taskGuid: 'task-primary', completed: false }],
        workflow: {
          values: [{
            taskGuid: 'task-primary',
            stateId: 'done',
            optionGuid: 'option-done',
            recognized: true,
          }],
          completionSuggestions: [{
            taskGuid: 'task-primary',
            stateId: 'done',
            reason: 'terminal-state-awaiting-owner-confirmation',
          }],
        },
      },
    })
    expect(adapter.taskUpdateCalls).toBe(0)
    await scenario.close()
  })

  it('rejects stale workflow CAS, illegal transitions, unmapped targets, and values before delivery', async () => {
    const { scenario, adapter } = await scenarioFixture('option-planned')
    await configureExisting(scenario)

    const request = Object.freeze({
      projectId: PROJECT_ID,
      taskGuid: 'task-primary',
      expectedRevision: 2,
      expectedRemoteVersion: '100',
      expectedWorkflowRevision: 1,
      changes: Object.freeze({ workflowStateId: 'doing' }),
      idempotencyKey: 'workflow-update-valid-template-0001',
      causationId: 'workflow-update-valid-template-cause-0001',
      reason: 'owner-feishu-task-update' as const,
    })
    await expect(scenario.updateFeishuTask(Object.freeze({
      ...request,
      expectedRevision: 1,
      idempotencyKey: 'workflow-update-stale-task-cas-0001',
      causationId: 'workflow-update-stale-task-cas-cause-0001',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'task-projection-revision-conflict',
        expectedRevision: 1,
        currentRevision: 2,
      },
    })
    await expect(scenario.updateFeishuTask(Object.freeze({
      ...request,
      expectedWorkflowRevision: 2,
      idempotencyKey: 'workflow-update-stale-cas-0001',
      causationId: 'workflow-update-stale-cas-cause-0001',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-revision-conflict',
        expectedWorkflowRevision: 2,
        currentWorkflowRevision: 1,
      },
    })
    await expect(scenario.updateFeishuTask(Object.freeze({
      ...request,
      changes: Object.freeze({ workflowStateId: 'done' }),
      idempotencyKey: 'workflow-update-illegal-0001',
      causationId: 'workflow-update-illegal-cause-0001',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-transition-forbidden',
        currentStateId: 'planned',
        requestedStateId: 'done',
      },
    })
    await expect(scenario.updateFeishuTask(Object.freeze({
      ...request,
      changes: Object.freeze({ workflowStateId: 'missing' }),
      idempotencyKey: 'workflow-update-unmapped-target-0001',
      causationId: 'workflow-update-unmapped-target-cause-0001',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-state-unmapped',
        currentStateId: 'planned',
        requestedStateId: 'missing',
      },
    })
    expect(adapter.taskUpdateCalls).toBe(0)

    adapter.snapshot = snapshot(task('101', 'option-provider-only'), '11')
    await expect(scenario.reconcileProjectTasks({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        workflow: {
          values: [{
            taskGuid: 'task-primary',
            optionGuid: 'option-provider-only',
            stateId: null,
            recognized: false,
          }],
          compatibility: {
            state: 'blocked',
            issues: [expect.objectContaining({
              code: 'task-state-unmapped',
              taskGuid: 'task-primary',
            })],
          },
        },
      },
    })
    await expect(scenario.updateFeishuTask(Object.freeze({
      ...request,
      expectedRevision: 3,
      expectedRemoteVersion: '101',
      idempotencyKey: 'workflow-update-unrecognized-value-0001',
      causationId: 'workflow-update-unrecognized-value-cause-0001',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'workflow-value-unrecognized',
        currentStateId: null,
        requestedStateId: 'doing',
      },
    })
    expect(adapter.taskUpdateCalls).toBe(0)
    await scenario.close()
  })
})
