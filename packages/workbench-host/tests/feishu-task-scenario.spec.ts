import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  FeishuTaskListCandidateProjection,
  FeishuTaskWorkflowFieldCandidate,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  SqliteWorkbenchRepository,
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchIdGenerator,
} from '../src/index.ts'
import type { WorkbenchAuthorization } from '../src/authorization.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuTaskEventListener,
  WorkbenchFeishuTaskEventObservation,
  WorkbenchFeishuTaskExternalAdapter,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
  WorkbenchFeishuTaskWorkflowFieldWrite,
  WorkbenchFeishuWriteResult,
} from '../src/feishu-task-federation.ts'
import type { WorkbenchFeishuExternalAdapter } from '../src/scenario.ts'

const PROJECT_ID = 'project-task-scenario'
const APP_ID = 'cli_task_scenario'
const OPEN_ID = 'ou_task_scenario'
const TASK_LIST_GUID = 'tasklist-scenario'
const signal = new AbortController().signal

const authorization: WorkbenchAuthorization = Object.freeze({
  require: async () => Object.freeze({
    ownerId: 'owner-task-scenario',
    organizationId: 'organization-task-scenario',
    teamId: 'team-task-scenario',
  }),
  filterProjection: async <T>(_action: string, projection: T) => projection,
})

function task(
  taskGuid: string,
  remoteVersion: string,
  overrides: Partial<WorkbenchFeishuTaskSnapshot> = {},
): WorkbenchFeishuTaskSnapshot {
  return Object.freeze({
    taskGuid,
    taskId: null,
    parentTaskGuid: null,
    summary: `Scenario ${taskGuid}`,
    description: '',
    assignees: Object.freeze([]),
    followers: Object.freeze([]),
    comments: Object.freeze([]),
    completed: false,
    completedAt: null,
    canonicalUrl: `https://applink.feishu.cn/client/todo/detail?guid=${taskGuid}`,
    remoteVersion,
    ...overrides,
  })
}

function taskListSnapshot(
  tasks: readonly WorkbenchFeishuTaskSnapshot[],
  version = '10',
): WorkbenchFeishuTaskListSnapshot {
  return Object.freeze({
    taskList: Object.freeze({
      taskListGuid: TASK_LIST_GUID,
      name: 'Scenario tasks',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/tasklist-scenario',
      remoteVersion: version,
    }),
    tasks: Object.freeze([...tasks]),
    observedAt: '2026-08-31T05:00:00.000Z',
  })
}

class FixtureTaskAdapter implements WorkbenchFeishuExternalAdapter, WorkbenchFeishuTaskExternalAdapter {
  readonly adapterId = 'fixture-task-adapter'
  snapshot = taskListSnapshot([task('task-primary', '100')])
  readonly externalTasks = new Map<string, WorkbenchFeishuTaskSnapshot>([
    ['task-external', task('task-external', '200')],
  ])
  updateMode: 'delivered' | 'unknown' | 'throw' = 'delivered'
  updateCalls = 0
  listCalls = 0
  readListCalls = 0
  workflowFieldCalls = 0
  workflowCreateCalls = 0
  workflowUpdateCalls = 0
  workflowFields: readonly FeishuTaskWorkflowFieldCandidate[] = Object.freeze([
    Object.freeze({
      fieldGuid: 'field-project-status',
      name: 'Project status',
      type: 'single_select',
      remoteVersion: 'field-version-1',
      options: Object.freeze([
        Object.freeze({ optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false }),
        Object.freeze({ optionGuid: 'option-doing', name: 'Doing', colorIndex: 2, hidden: false }),
        Object.freeze({ optionGuid: 'option-done', name: 'Done', colorIndex: 3, hidden: false }),
      ]),
    }),
  ])
  private listener: WorkbenchFeishuTaskEventListener | null = null

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    return Object.freeze({ ref, configured: true, source: 'fixture', writable: false })
  }

  async startIdentityVerification(
    input: Readonly<WorkbenchFeishuIdentityVerificationInput>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    if (input.kind !== 'bot' || input.appId !== APP_ID) {
      throw new Error('fixture received an unexpected identity route')
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
        displayLabel: 'Scenario Task Bot',
        finishVerification: async (): Promise<WorkbenchFeishuResourceVerificationObservation> => {
          if (disposed) throw new Error('fixture identity session was disposed')
          return Object.freeze({
            result: 'healthy',
            scopeInspection: Object.freeze({
              state: 'observed',
              scopes: Object.freeze([
                Object.freeze({
                  scope: 'task:tasklist:read',
                  tokenType: 'tenant',
                  state: 'verified',
                }),
                Object.freeze({
                  scope: 'task:task:write',
                  tokenType: 'tenant',
                  state: 'verified',
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
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskListCandidateProjection[]>> {
    this.listCalls += 1
    return Object.freeze({ state: 'ok', value: Object.freeze([this.snapshot.taskList]) })
  }

  async createTaskList(
    _route: WorkbenchFeishuTaskRoute,
    _input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<FeishuTaskListCandidateProjection>> {
    return Object.freeze({ state: 'ok', value: this.snapshot.taskList })
  }

  async readTaskList(
    _route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskListSnapshot>> {
    this.readListCalls += 1
    if (taskListGuid !== TASK_LIST_GUID) throw new Error('fixture task-list route changed')
    return Object.freeze({ state: 'ok', value: this.snapshot })
  }

  async readTask(
    _route: WorkbenchFeishuTaskRoute,
    taskGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskSnapshot>> {
    const value = this.externalTasks.get(taskGuid)
    return value === undefined
      ? Object.freeze({
        state: 'rejected',
        issue: Object.freeze({
          code: 'resource-not-found',
          recovery: 'check-resource-id',
          missingScopes: Object.freeze([]),
          grantPlane: null,
          retryAt: null,
        }),
      })
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
    this.updateCalls += 1
    if (this.updateMode === 'throw') throw new Error('ambiguous fixture transport')
    if (this.updateMode === 'unknown') {
      return Object.freeze({
        state: 'unknown',
        issue: Object.freeze({
          code: 'provider-unavailable',
          recovery: 'retry-later',
          missingScopes: Object.freeze([]),
          grantPlane: null,
          retryAt: null,
        }),
      })
    }
    const current = this.snapshot.tasks.find(candidate => candidate.taskGuid === input.taskGuid)
    if (current === undefined) throw new Error('fixture task disappeared')
    if (current.remoteVersion !== input.expectedRemoteVersion) {
      return Object.freeze({ state: 'ok', value: current })
    }
    const workflowValues = input.changes.workflow === undefined
      ? current.customFieldValues
      : Object.freeze([
        ...(current.customFieldValues ?? []).filter(value =>
          value.fieldGuid !== input.changes.workflow?.fieldGuid),
        Object.freeze({
          fieldGuid: input.changes.workflow.fieldGuid,
          type: 'single_select',
          singleSelectOptionGuid: input.changes.workflow.optionGuid,
        }),
      ])
    const next = Object.freeze({
      ...current,
      ...(input.changes.summary === undefined ? {} : { summary: input.changes.summary }),
      ...(input.changes.description === undefined ? {} : { description: input.changes.description }),
      ...(input.changes.completed === undefined ? {} : { completed: input.changes.completed }),
      customFieldValues: workflowValues,
      remoteVersion: String(Number(current.remoteVersion) + 1),
      completedAt: input.changes.completed === undefined
        ? current.completedAt
        : input.changes.completed
          ? '2026-08-31T05:30:00.000Z'
          : null,
    }) satisfies WorkbenchFeishuTaskSnapshot
    this.snapshot = taskListSnapshot(
      this.snapshot.tasks.map(candidate => candidate.taskGuid === next.taskGuid ? next : candidate),
      this.snapshot.taskList.remoteVersion,
    )
    return Object.freeze({ state: 'ok', value: next })
  }

  async listTaskWorkflowFields(
    _route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskWorkflowFieldCandidate[]>> {
    if (taskListGuid !== TASK_LIST_GUID) throw new Error('fixture workflow task-list changed')
    this.workflowFieldCalls += 1
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
    this.workflowCreateCalls += 1
    return Object.freeze({
      state: 'ok',
      value: Object.freeze({
        fieldGuid: 'field-created-status',
        name: input.name,
        type: 'single_select',
        remoteVersion: 'field-created-version-1',
        options: Object.freeze(input.options.map((option, index) => Object.freeze({
          optionGuid: `option-created-${String(index + 1)}`,
          name: option.name,
          colorIndex: option.colorIndex,
          hidden: false,
        }))),
      }),
    })
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
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskWorkflowFieldWrite>> {
    this.workflowUpdateCalls += 1
    return Object.freeze({
      state: 'ok',
      value: Object.freeze({
        fieldGuid: input.fieldGuid,
        name: input.name,
        type: 'single_select',
        remoteVersion: `${input.expectedRemoteVersion}-next`,
        options: Object.freeze(input.options.map((option, index) => Object.freeze({
          optionGuid: option.optionGuid ?? `option-new-${String(index + 1)}`,
          name: option.name,
          colorIndex: option.colorIndex,
          hidden: false,
        }))),
      }),
    })
  }

  subscribeTaskEvents(listener: WorkbenchFeishuTaskEventListener): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  async emit(observation: WorkbenchFeishuTaskEventObservation): Promise<void> {
    if (this.listener === null) throw new Error('fixture event listener is not installed')
    await this.listener(observation)
  }
}

function ids(): WorkbenchIdGenerator {
  let command = 0
  let audit = 0
  let outbox = 0
  return Object.freeze({
    nextStatusId: () => 'status-task-scenario',
    nextProjectId: () => PROJECT_ID,
    nextProjectMemberId: () => 'member-task-scenario',
    nextSuggestedChangeId: () => 'suggested-task-scenario',
    nextSuggestedChangeDecisionId: () => 'decision-task-scenario',
    nextFeishuVerificationId: () => 'verification-task-scenario',
    nextGoalId: () => 'goal-task-scenario',
    nextOutcomeId: () => 'outcome-task-scenario',
    nextCommandId: () => `command-task-scenario-${String(++command).padStart(3, '0')}`,
    nextAuditEventId: () => `audit-task-scenario-${String(++audit).padStart(3, '0')}`,
    nextOutboxId: () => `outbox-task-scenario-${String(++outbox).padStart(3, '0')}`,
  })
}

function clock(): WorkbenchClock {
  let milliseconds = Date.parse('2026-08-31T05:00:00.000Z')
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
    projectName: 'Scenario task project',
    primaryGoal: Object.freeze({
      name: 'Exercise task federation',
      outcomes: Object.freeze([Object.freeze({
        name: 'Convergent projection',
        metric: Object.freeze({
          metricName: 'Cases',
          initialValue: 0,
          targetValue: 4,
          unit: 'cases',
          direction: 'increase',
        }),
      })]),
    }),
    supportingGoals: Object.freeze([]),
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'project-task-scenario-key-0001',
    causationId: 'project-task-scenario-cause-0001',
    reason: 'owner-project-create',
  })
}

async function fixture(taskReconciliationIntervalMs = 0): Promise<Readonly<{
  scenario: WorkbenchScenario
  adapter: FixtureTaskAdapter
}>> {
  const repository = new SqliteWorkbenchRepository({
    databasePath: ':memory:',
    journalMode: 'wal',
    busyTimeoutMs: 1_000,
  })
  const adapter = new FixtureTaskAdapter()
  const scenario = new WorkbenchScenario({
    repository,
    clock: clock(),
    ids: ids(),
    adapters: Object.freeze({ feishu: adapter, feishuTasks: adapter }),
    authorization,
    maxStatusLength: 280,
    taskReconciliationIntervalMs,
  })
  await scenario.open()
  await scenario.createProject(projectRequest(), signal)
  await scenario.configureFeishuIdentityRoute({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_TASK_SCENARIO_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'feishu-task-configure-0001',
    causationId: 'feishu-task-configure-cause-0001',
    reason: 'owner-feishu-route-configure',
  }, signal)
  await scenario.verifyFeishuIdentityRoute({
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'feishu-task-verify-0001',
    causationId: 'feishu-task-verify-cause-0001',
    reason: 'owner-feishu-route-verify',
  }, signal)
  return Object.freeze({ scenario, adapter })
}

async function bind(scenario: WorkbenchScenario) {
  return scenario.bindFeishuTaskList({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    taskListGuid: TASK_LIST_GUID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'feishu-task-bind-0001',
    causationId: 'feishu-task-bind-cause-0001',
    reason: 'owner-feishu-task-list-bind',
  }, signal)
}

describe('T08 Feishu task scenario', () => {
  afterEach(() => { vi.useRealTimers() })

  it('connects discovery, binding, explicit reference, reconciliation, events, and writes', async () => {
    const { scenario, adapter } = await fixture()
    await expect(scenario.discoverFeishuTaskLists({
      projectId: PROJECT_ID,
      kind: 'bot',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
    }, signal)).resolves.toMatchObject({
      projectId: PROJECT_ID,
      items: [{ taskListGuid: TASK_LIST_GUID }],
    })
    expect(adapter.listCalls).toBe(1)
    await expect(bind(scenario)).resolves.toMatchObject({
      ok: true,
      value: { revision: 1, tasks: [{ taskGuid: 'task-primary' }] },
    })

    await expect(scenario.referenceFeishuTask({
      projectId: PROJECT_ID,
      taskGuid: 'task-external',
      expectedRevision: 1,
      idempotencyKey: 'feishu-task-reference-0001',
      causationId: 'feishu-task-reference-cause-0001',
      reason: 'owner-feishu-task-reference',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 2,
        tasks: expect.arrayContaining([
          expect.objectContaining({ taskGuid: 'task-external', scope: 'explicit-reference' }),
        ]),
      },
    })

    adapter.snapshot = taskListSnapshot([task('task-primary', '101', {
      summary: 'Reconciled primary',
    })], '11')
    await expect(scenario.reconcileProjectTasks({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, tasks: expect.arrayContaining([
        expect.objectContaining({ taskGuid: 'task-primary', remoteVersion: '101' }),
        expect.objectContaining({ taskGuid: 'task-external' }),
      ]) },
    })

    const eventTask = task('task-primary', '102', { summary: 'Event primary' })
    await adapter.emit(Object.freeze({
      event: Object.freeze({
        eventId: 'scenario-event-0001',
        taskListGuid: TASK_LIST_GUID,
        taskGuid: 'task-primary',
        kind: 'upsert',
        remoteVersion: '102',
        occurredAt: '2026-08-31T05:20:00.000Z',
      }),
      task: eventTask,
    }))
    adapter.snapshot = taskListSnapshot([eventTask], '12')
    await expect(scenario.projectTasks({ projectId: PROJECT_ID }, signal)).resolves.toMatchObject({
      revision: 4,
      tasks: expect.arrayContaining([
        expect.objectContaining({ taskGuid: 'task-primary', summary: 'Event primary' }),
      ]),
    })

    await expect(scenario.updateFeishuTask({
      projectId: PROJECT_ID,
      taskGuid: 'task-primary',
      expectedRevision: 4,
      expectedRemoteVersion: '102',
      changes: Object.freeze({ summary: 'Workbench primary' }),
      idempotencyKey: 'feishu-task-update-0001',
      causationId: 'feishu-task-update-cause-0001',
      reason: 'owner-feishu-task-update',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 5, tasks: expect.arrayContaining([
        expect.objectContaining({
          taskGuid: 'task-primary',
          summary: 'Workbench primary',
          remoteVersion: '103',
        }),
      ]) },
      effect: { state: 'delivered' },
    })
    expect(adapter.updateCalls).toBe(1)
    await scenario.close()
  })

  it('settles an ambiguous write as unknown and replays it without a second adapter call', async () => {
    const { scenario, adapter } = await fixture()
    await bind(scenario)
    adapter.updateMode = 'throw'
    const request = Object.freeze({
      projectId: PROJECT_ID,
      taskGuid: 'task-primary',
      expectedRevision: 1,
      expectedRemoteVersion: '100',
      changes: Object.freeze({ summary: 'Ambiguous write' }),
      idempotencyKey: 'feishu-task-update-unknown-0001',
      causationId: 'feishu-task-update-unknown-cause-0001',
      reason: 'owner-feishu-task-update' as const,
    })
    await expect(scenario.updateFeishuTask(request, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        effect: { state: 'unknown' },
      },
    })
    await expect(scenario.updateFeishuTask(request, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        effect: { state: 'unknown' },
      },
    })
    expect(adapter.updateCalls).toBe(1)
    await expect(scenario.projectTasks({ projectId: PROJECT_ID }, signal)).resolves.toMatchObject({
      revision: 2,
      sync: { state: 'unknown' },
      effects: [expect.objectContaining({ state: 'unknown' })],
    })
    await scenario.close()
  })

  it('periodically repairs a missed event from the complete remote baseline', async () => {
    vi.useFakeTimers()
    const { scenario, adapter } = await fixture(30_000)
    await bind(scenario)
    adapter.snapshot = taskListSnapshot([task('task-primary', '110', {
      summary: 'Recovered by periodic reconciliation',
    })], '20')

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(scenario.projectTasks({ projectId: PROJECT_ID }, signal)).resolves.toMatchObject({
      revision: 2,
      sync: { state: 'healthy' },
      tasks: [expect.objectContaining({
        taskGuid: 'task-primary',
        summary: 'Recovered by periodic reconciliation',
        remoteVersion: '110',
      })],
    })
    expect(adapter.readListCalls).toBe(2)
    await scenario.close()
  })

  it('maps a workflow, converges Feishu status, and requires explicit completion confirmation', async () => {
    const { scenario, adapter } = await fixture()
    adapter.snapshot = taskListSnapshot([task('task-primary', '100', {
      customFieldValues: Object.freeze([Object.freeze({
        fieldGuid: 'field-project-status',
        type: 'single_select',
        singleSelectOptionGuid: 'option-doing',
      })]),
    })])
    await bind(scenario)
    const definition = Object.freeze({
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
    })
    const mapping = Object.freeze({
      mode: 'existing' as const,
      fieldGuid: 'field-project-status',
      options: Object.freeze([
        Object.freeze({ stateId: 'planned', optionGuid: 'option-planned' }),
        Object.freeze({ stateId: 'doing', optionGuid: 'option-doing' }),
        Object.freeze({ stateId: 'done', optionGuid: 'option-done' }),
      ]),
    })

    await expect(scenario.discoverFeishuTaskWorkflowFields({
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
    }, signal)).resolves.toMatchObject({
      taskRevision: 1,
      items: [{ fieldGuid: 'field-project-status', type: 'single_select' }],
    })
    await expect(scenario.previewFeishuTaskWorkflow({
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
      expectedWorkflowRevision: null,
      definition,
      mapping,
    }, signal)).resolves.toMatchObject({
      compatibility: { state: 'compatible', issues: [] },
      usedStateIds: ['doing'],
    })
    const configureRequest = Object.freeze({
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
      expectedWorkflowRevision: null,
      definition,
      mapping,
      idempotencyKey: 'feishu-workflow-configure-0001',
      causationId: 'feishu-workflow-configure-cause-0001',
      reason: 'owner-feishu-task-workflow-configure' as const,
    })
    await expect(scenario.configureFeishuTaskWorkflow(configureRequest, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 2,
        workflow: {
          revision: 1,
          values: [{ taskGuid: 'task-primary', stateId: 'doing' }],
        },
      },
    })
    await expect(scenario.configureFeishuTaskWorkflow(configureRequest, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, workflow: { revision: 1 } },
    })
    expect(adapter.workflowFieldCalls).toBe(3)

    await expect(scenario.updateFeishuTask({
      projectId: PROJECT_ID,
      taskGuid: 'task-primary',
      expectedRevision: 2,
      expectedRemoteVersion: '100',
      expectedWorkflowRevision: 1,
      changes: Object.freeze({ workflowStateId: 'done' }),
      idempotencyKey: 'feishu-workflow-state-0001',
      causationId: 'feishu-workflow-state-cause-0001',
      reason: 'owner-feishu-task-update',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        tasks: [{ taskGuid: 'task-primary', completed: false }],
        workflow: {
          values: [{ taskGuid: 'task-primary', stateId: 'done' }],
          completionSuggestions: [{
            taskGuid: 'task-primary',
            reason: 'terminal-state-awaiting-owner-confirmation',
          }],
        },
      },
    })
    await expect(scenario.updateFeishuTask({
      projectId: PROJECT_ID,
      taskGuid: 'task-primary',
      expectedRevision: 3,
      expectedRemoteVersion: '101',
      changes: Object.freeze({ completed: true }),
      idempotencyKey: 'feishu-workflow-complete-0001',
      causationId: 'feishu-workflow-complete-cause-0001',
      reason: 'owner-feishu-task-update',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        tasks: [{ taskGuid: 'task-primary', completed: true }],
        workflow: { completionSuggestions: [] },
      },
    })
    expect(adapter.updateCalls).toBe(2)
    await scenario.close()
  })
})
