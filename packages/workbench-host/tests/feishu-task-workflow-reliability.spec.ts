import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  FeishuTaskWorkflowFieldCandidate,
  ProjectTaskWorkflowDefinition,
  WorkbenchStatusMutation,
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

function clock(): WorkbenchClock {
  let milliseconds = Date.parse('2026-08-31T06:00:00.000Z')
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
): Promise<Readonly<{
  scenario: WorkbenchScenario
  adapter: ReliabilityAdapter
}>> {
  const repository = new SqliteWorkbenchRepository({
    databasePath: ':memory:',
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
  return Object.freeze({ scenario, adapter })
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

function dropV8WorkflowSchema(database: DatabaseSync): void {
  database.exec(`
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
  it('migrates an exact Schema v7 database to v8 and survives a second restart', async () => {
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
      .prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    await restarted.close()
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
    const { scenario, adapter } = await scenarioFixture()
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
    await expect(scenario.configureFeishuTaskWorkflow({
      projectId: PROJECT_ID,
      expectedTaskRevision: 2,
      expectedWorkflowRevision: 1,
      definition: renameDefinition,
      mapping: Object.freeze({ mode: 'migrate' }),
      idempotencyKey: 'workflow-field-conflict-0001',
      causationId: 'workflow-field-conflict-cause-0001',
      reason: 'owner-feishu-task-workflow-configure',
    }, signal)).resolves.toMatchObject({
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
