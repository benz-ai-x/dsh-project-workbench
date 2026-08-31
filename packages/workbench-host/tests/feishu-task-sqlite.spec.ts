import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  SqliteWorkbenchRepository,
  type WorkbenchCommandMetadata,
  type WorkbenchFeishuRouteMutation,
  type WorkbenchFeishuTaskEventMutation,
  type WorkbenchFeishuTaskListBindingMutation,
  type WorkbenchFeishuTaskListSnapshot,
  type WorkbenchFeishuTaskReferenceMutation,
  type WorkbenchFeishuTaskRoute,
  type WorkbenchFeishuTaskSnapshot,
  type WorkbenchFeishuTaskUpdateReservationMutation,
  type WorkbenchFeishuTaskWorkflowConfigurationMutation,
  type WorkbenchFeishuVerificationMutation,
  type WorkbenchProjectMutation,
} from '../src/index.ts'

const signal = new AbortController().signal
const ORGANIZATION_ID = 'organization-task'
const TEAM_ID = 'team-task'
const OWNER_ID = 'owner-task'
const PROJECT_ID = 'project-task'
const APP_ID = 'cli_task_workbench'
const OPEN_ID = 'ou_task_bot'
const TASK_LIST_GUID = 'tasklist-primary'
const at = (second: number) => `2026-08-31T04:00:${String(second).padStart(2, '0')}.000Z`

function command(
  sequence: number,
  reason: WorkbenchCommandMetadata['reason'],
  options: Readonly<{
    idempotencyKey?: string
    causationId?: string
    prefix?: string
  }> = {},
): WorkbenchCommandMetadata {
  const prefix = options.prefix ?? `task-${String(sequence)}`
  return Object.freeze({
    commandId: `command-${prefix}`,
    auditEventId: `audit-${prefix}`,
    outboxId: `outbox-${prefix}`,
    idempotencyKey: options.idempotencyKey ?? `task-idempotency-${String(sequence).padStart(4, '0')}`,
    causationId: options.causationId ?? `task-causation-${String(sequence).padStart(4, '0')}`,
    reason,
    actor: Object.freeze({
      kind: 'owner',
      id: OWNER_ID,
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
    }),
    occurredAt: at(sequence),
  })
}

function projectMutation(): WorkbenchProjectMutation {
  return Object.freeze({
    projectId: PROJECT_ID,
    primaryGoalId: 'goal-task',
    projectName: 'Task federation project',
    primaryGoal: Object.freeze({
      name: 'Deliver task federation',
      outcomes: Object.freeze([Object.freeze({
        outcomeId: 'outcome-task',
        name: 'Convergent task projection',
        metric: Object.freeze({
          metricName: 'Passing cases',
          initialValue: 0,
          targetValue: 5,
          unit: 'cases',
          direction: 'increase' as const,
        }),
      })]),
    }),
    supportingGoals: Object.freeze([]),
    template: Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1 }),
    expectedCatalogRevision: 0,
    expectedRevision: null,
    createdAt: at(1),
    command: command(1, 'owner-project-create', { prefix: 'task-project' }) as
      WorkbenchProjectMutation['command'],
  })
}

function routeMutation(): WorkbenchFeishuRouteMutation {
  return Object.freeze({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_TASK_APP_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    updatedAt: at(2),
    command: command(2, 'owner-feishu-route-configure') as WorkbenchFeishuRouteMutation['command'],
  })
}

function verificationMutation(): WorkbenchFeishuVerificationMutation {
  return Object.freeze({
    verificationId: 'verification-task-route',
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    resourceProbe: null,
    observation: Object.freeze({
      result: 'healthy',
      identity: Object.freeze({ state: 'verified', issue: null }),
      actor: Object.freeze({
        realm: 'feishu-cn',
        appId: APP_ID,
        kind: 'bot',
        openId: OPEN_ID,
        tenantKey: null,
      }),
      displayLabel: 'Task Workbench Bot',
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
    }),
    checkedAt: at(3),
    command: command(3, 'owner-feishu-route-verify') as WorkbenchFeishuVerificationMutation['command'],
  })
}

function task(
  taskGuid: string,
  remoteVersion: string,
  overrides: Partial<WorkbenchFeishuTaskSnapshot> = {},
): WorkbenchFeishuTaskSnapshot {
  return Object.freeze({
    taskGuid,
    taskId: null,
    parentTaskGuid: null,
    summary: `Task ${taskGuid}`,
    description: `Description for ${taskGuid}`,
    assignees: Object.freeze([Object.freeze({ openId: 'ou_assignee', name: 'Assignee' })]),
    followers: Object.freeze([Object.freeze({ openId: 'ou_follower', name: 'Follower' })]),
    comments: Object.freeze([Object.freeze({
      commentId: `comment-${taskGuid}`,
      content: 'Tracked comment',
      creator: Object.freeze({ openId: 'ou_reviewer', name: 'Reviewer' }),
      replyToCommentId: null,
      createdAt: at(3),
      updatedAt: at(3),
    })]),
    completed: false,
    completedAt: null,
    canonicalUrl: `https://applink.feishu.cn/client/todo/detail?guid=${taskGuid}`,
    remoteVersion,
    ...overrides,
  })
}

function snapshot(
  tasks: readonly WorkbenchFeishuTaskSnapshot[],
  remoteVersion = '10',
  observedAt = at(4),
): WorkbenchFeishuTaskListSnapshot {
  return Object.freeze({
    taskList: Object.freeze({
      taskListGuid: TASK_LIST_GUID,
      name: 'Primary project task list',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/tasklist-primary',
      remoteVersion,
    }),
    tasks: Object.freeze([...tasks]),
    observedAt,
  })
}

async function seededRepository(): Promise<Readonly<{
  repository: SqliteWorkbenchRepository
  route: WorkbenchFeishuTaskRoute
}>> {
  const repository = new SqliteWorkbenchRepository({
    databasePath: ':memory:',
    journalMode: 'wal',
    busyTimeoutMs: 1_000,
  })
  await repository.open()
  await repository.commitProject(projectMutation(), signal)
  await repository.commitFeishuRoute(routeMutation(), signal)
  await repository.commitFeishuVerification(verificationMutation(), signal)
  const connection = await repository.readFeishuConnection({
    organizationId: ORGANIZATION_ID,
    teamId: TEAM_ID,
  }, signal)
  if (connection.bot.actor === null) throw new Error('fixture route was not verified')
  return Object.freeze({
    repository,
    route: Object.freeze({
      kind: 'bot',
      routeGeneration: 1,
      appId: APP_ID,
      credentialRef: 'FEISHU_TASK_APP_SECRET',
      actor: Object.freeze({ ...connection.bot.actor }),
    }),
  })
}

function bindingMutation(
  route: WorkbenchFeishuTaskRoute,
  tasks: readonly WorkbenchFeishuTaskSnapshot[] = [task('task-primary', '100')],
): WorkbenchFeishuTaskListBindingMutation {
  return Object.freeze({
    projectId: PROJECT_ID,
    intent: Object.freeze({ mode: 'existing', taskListGuid: TASK_LIST_GUID }),
    expectedBindingRevision: null,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    route,
    createdByWorkbench: false,
    snapshot: snapshot(tasks),
    boundAt: at(4),
    command: command(4, 'owner-feishu-task-list-bind') as
      WorkbenchFeishuTaskListBindingMutation['command'],
  })
}

function referenceMutation(
  expectedRevision: number,
  sequence: number,
  taskValue = task('task-external', '200'),
): WorkbenchFeishuTaskReferenceMutation {
  return Object.freeze({
    projectId: PROJECT_ID,
    expectedRevision,
    task: taskValue,
    referencedAt: at(sequence),
    command: command(sequence, 'owner-feishu-task-reference') as
      WorkbenchFeishuTaskReferenceMutation['command'],
  })
}

function updateReservation(
  expectedRevision: number,
  sequence: number,
  options: Readonly<{
    idempotencyKey?: string
    causationId?: string
    prefix?: string
    preparedAt?: string
  }> = {},
): WorkbenchFeishuTaskUpdateReservationMutation {
  return Object.freeze({
    effectId: `effect-${options.prefix ?? String(sequence)}`,
    projectId: PROJECT_ID,
    taskGuid: 'task-primary',
    expectedRevision,
    expectedRemoteVersion: '100',
    changes: Object.freeze({ summary: 'Updated primary task' }),
    preparedAt: options.preparedAt ?? at(sequence),
    command: command(sequence, 'owner-feishu-task-update', options) as
      WorkbenchFeishuTaskUpdateReservationMutation['command'],
  })
}

describe('T08 Feishu task SQLite federation', () => {
  it('rejects a verified actor from an older route generation before any task mutation', async () => {
    const { repository, route } = await seededRepository()
    const staleActorRoute = Object.freeze({
      ...route,
      routeGeneration: 2,
    })

    await expect(repository.commitFeishuTaskListBinding(Object.freeze({
      ...bindingMutation(staleActorRoute),
      expectedRouteGeneration: 2,
    }), signal)).rejects.toThrow('Feishu task route and verified actor are inconsistent')
    await expect(repository.readProjectTasks({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    }, signal)).resolves.toMatchObject({
      revision: 0,
      binding: null,
      sync: { state: 'unbound' },
      tasks: [],
    })
    await repository.close()
  })

  it('binds one primary list exactly once and persists the complete safe projection', async () => {
    const { repository, route } = await seededRepository()
    const mutation = bindingMutation(route, [
      task('task-primary', '100'),
      task('task-child', '101', { parentTaskGuid: 'task-primary' }),
    ])
    const committed = await repository.commitFeishuTaskListBinding(mutation, signal)

    expect(committed).toMatchObject({
      ok: true,
      value: {
        projectId: PROJECT_ID,
        revision: 1,
        binding: {
          taskListGuid: TASK_LIST_GUID,
          createdByWorkbench: false,
          identity: { kind: 'bot', appId: APP_ID, openId: OPEN_ID },
        },
        sync: { state: 'healthy', lastReconciledAt: at(4) },
        tasks: [
          {
            taskGuid: 'task-primary',
            scope: 'primary-list',
            assignees: [{ openId: 'ou_assignee', name: 'Assignee' }],
            followers: [{ openId: 'ou_follower', name: 'Follower' }],
            comments: [{ commentId: 'comment-task-primary', content: 'Tracked comment' }],
            canonicalUrl: 'https://applink.feishu.cn/client/todo/detail?guid=task-primary',
          },
          { taskGuid: 'task-child', parentTaskGuid: 'task-primary' },
        ],
      },
    })
    await expect(repository.replayFeishuTaskListBinding({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      intent: mutation.intent,
      kind: 'bot',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: mutation.command.idempotencyKey,
      causationId: mutation.command.causationId,
      reason: 'owner-feishu-task-list-bind',
    }, signal)).resolves.toEqual(committed)
    await expect(repository.commitFeishuTaskListBinding(Object.freeze({
      ...mutation,
      boundAt: at(5),
      command: command(5, 'owner-feishu-task-list-bind') as
        WorkbenchFeishuTaskListBindingMutation['command'],
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-list-already-bound' },
    })
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 4,
    })
    await repository.close()
  })

  it('keeps out-of-list tasks invisible until explicit reference and converges events with repair', async () => {
    const { repository, route } = await seededRepository()
    await repository.commitFeishuTaskListBinding(bindingMutation(route), signal)
    await expect(repository.readProjectTasks({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    }, signal)).resolves.not.toMatchObject({
      tasks: expect.arrayContaining([{ taskGuid: 'task-external' }]),
    })

    const referenced = await repository.commitFeishuTaskReference(referenceMutation(1, 5), signal)
    expect(referenced).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        tasks: expect.arrayContaining([
          expect.objectContaining({ taskGuid: 'task-external', scope: 'explicit-reference' }),
        ]),
      },
    })
    await repository.commitFeishuTaskReconciliation({
      projectId: PROJECT_ID,
      expectedRevision: 2,
      snapshot: snapshot([task('task-primary', '102')], '11', at(6)),
      attemptedAt: at(6),
    }, signal)

    const upsert: WorkbenchFeishuTaskEventMutation = Object.freeze({
      event: Object.freeze({
        eventId: 'event-task-upsert',
        taskListGuid: TASK_LIST_GUID,
        taskGuid: 'task-primary',
        kind: 'upsert',
        remoteVersion: '103',
        occurredAt: at(7),
      }),
      task: task('task-primary', '103', { summary: 'Event-updated task' }),
      receivedAt: at(7),
    })
    await expect(repository.commitFeishuTaskEvent(upsert, signal)).resolves.toEqual({
      outcome: 'applied', projectId: PROJECT_ID, projectionRevision: 4,
    })
    await expect(repository.commitFeishuTaskEvent(upsert, signal)).resolves.toEqual({
      outcome: 'duplicate', projectId: PROJECT_ID, projectionRevision: 4,
    })
    await expect(repository.commitFeishuTaskEvent(Object.freeze({
      ...upsert,
      event: Object.freeze({
        ...upsert.event,
        eventId: 'event-task-stale',
        remoteVersion: '102',
        occurredAt: at(8),
      }),
      task: task('task-primary', '102'),
      receivedAt: at(8),
    }), signal)).resolves.toEqual({
      outcome: 'stale', projectId: PROJECT_ID, projectionRevision: null,
    })
    await expect(repository.commitFeishuTaskEvent(Object.freeze({
      event: Object.freeze({
        eventId: 'event-task-removed',
        taskListGuid: TASK_LIST_GUID,
        taskGuid: 'task-primary',
        kind: 'removed',
        remoteVersion: '104',
        occurredAt: at(9),
      }),
      task: null,
      receivedAt: at(9),
    }), signal)).resolves.toEqual({
      outcome: 'applied', projectId: PROJECT_ID, projectionRevision: 5,
    })
    const removed = await repository.readProjectTasks({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    }, signal)
    expect(removed?.tasks.map(item => item.taskGuid)).toEqual(['task-external'])

    const repaired = await repository.commitFeishuTaskReconciliation({
      projectId: PROJECT_ID,
      expectedRevision: 5,
      snapshot: snapshot([task('task-primary', '105')], '12', at(10)),
      attemptedAt: at(10),
    }, signal)
    expect(repaired).toMatchObject({
      ok: true,
      value: {
        revision: 6,
        tasks: expect.arrayContaining([
          expect.objectContaining({ taskGuid: 'task-primary', remoteVersion: '105' }),
          expect.objectContaining({ taskGuid: 'task-external', scope: 'explicit-reference' }),
        ]),
      },
    })
    await repository.close()
  })

  it('durably turns a claimed replay into unknown and never offers it for delivery again', async () => {
    const { repository, route } = await seededRepository()
    await repository.commitFeishuTaskListBinding(bindingMutation(route), signal)
    const initial = updateReservation(1, 5, {
      idempotencyKey: 'task-update-idempotency-0001',
      causationId: 'task-update-causation-0001',
      prefix: 'task-update-first',
    })
    const reserved = await repository.reserveFeishuTaskUpdate(initial, signal)
    expect(reserved).toMatchObject({
      state: 'deliver',
      effect: { state: 'prepared', taskGuid: 'task-primary' },
    })
    if (reserved.state !== 'deliver') throw new Error('fixture task update was not reserved')
    await expect(repository.claimFeishuTaskUpdate(reserved.effect.effectId, at(6), signal))
      .resolves.toBe(true)
    await expect(repository.claimFeishuTaskUpdate(reserved.effect.effectId, at(7), signal))
      .resolves.toBe(false)

    const replayMutation = Object.freeze({
      ...initial,
      effectId: 'effect-retry-must-not-replace-original',
      preparedAt: at(8),
      command: command(8, 'owner-feishu-task-update', {
        idempotencyKey: initial.command.idempotencyKey,
        causationId: initial.command.causationId,
        prefix: 'task-update-retry',
      }) as WorkbenchFeishuTaskUpdateReservationMutation['command'],
    })
    const replay = await repository.reserveFeishuTaskUpdate(replayMutation, signal)
    expect(replay).toMatchObject({
      state: 'replay',
      result: {
        ok: false,
        error: {
          code: 'remote-outcome-unknown',
          effect: { effectId: reserved.effect.effectId, state: 'unknown' },
        },
      },
    })
    const database = Reflect.get(repository, 'database') as DatabaseSync
    expect(database.prepare(`
      SELECT state, attempt_count, updated_at FROM workbench_feishu_task_effect WHERE id = ?
    `).get(reserved.effect.effectId)).toEqual({
      state: 'unknown', attempt_count: 1, updated_at: at(8),
    })
    expect(database.prepare(`
      SELECT state, attempt_count, error_code FROM workbench_outbox WHERE id = ?
    `).get(reserved.receipt.outboxId)).toEqual({
      state: 'unknown', attempt_count: 1, error_code: 'transport-ambiguous',
    })
    await expect(repository.reserveFeishuTaskUpdate(Object.freeze({
      ...replayMutation,
      preparedAt: at(9),
      command: command(9, 'owner-feishu-task-update', {
        idempotencyKey: initial.command.idempotencyKey,
        causationId: initial.command.causationId,
        prefix: 'task-update-retry-again',
      }) as WorkbenchFeishuTaskUpdateReservationMutation['command'],
    }), signal)).resolves.toMatchObject({
      state: 'replay',
      result: { ok: false, error: { code: 'remote-outcome-unknown' } },
    })
    await expect(repository.readProjectTasks({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    }, signal)).resolves.toMatchObject({
      revision: 2,
      sync: { state: 'unknown' },
      effects: [{ effectId: reserved.effect.effectId, state: 'unknown' }],
    })
    await repository.close()
  })

  it('settles a confirmed task write once and rejects stale remote versions before reserving', async () => {
    const { repository, route } = await seededRepository()
    await repository.commitFeishuTaskListBinding(bindingMutation(route), signal)
    const mutation = updateReservation(1, 5, { prefix: 'task-update-delivered' })
    const reserved = await repository.reserveFeishuTaskUpdate(mutation, signal)
    if (reserved.state !== 'deliver') throw new Error('fixture task update was not reserved')
    await repository.claimFeishuTaskUpdate(reserved.effect.effectId, at(6), signal)
    const deliveredTask = task('task-primary', '101', { summary: 'Updated primary task' })
    await expect(repository.settleFeishuTaskUpdate(reserved.effect.effectId, {
      state: 'delivered',
      task: deliveredTask,
      settledAt: at(7),
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, tasks: [{ summary: 'Updated primary task', remoteVersion: '101' }] },
      effect: { state: 'delivered' },
    })
    await expect(repository.settleFeishuTaskUpdate(reserved.effect.effectId, {
      state: 'delivered',
      task: deliveredTask,
      settledAt: at(8),
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 2 },
      effect: { state: 'delivered', updatedAt: at(7) },
    })

    await expect(repository.reserveFeishuTaskUpdate(Object.freeze({
      ...updateReservation(2, 9, { prefix: 'task-update-stale' }),
      expectedRemoteVersion: '100',
    }), signal)).resolves.toMatchObject({
      state: 'rejected',
      result: {
        ok: false,
        error: {
          code: 'remote-version-conflict',
          expectedRemoteVersion: '100',
          currentRemoteVersion: '101',
        },
      },
    })
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 5,
    })
    await repository.close()
  })

  it('persists stable workflow GUIDs, replays configuration, and only suggests completion at a terminal state', async () => {
    const { repository, route } = await seededRepository()
    const fieldGuid = 'field-project-status'
    const optionPlanned = 'option-planned'
    const optionDoing = 'option-doing'
    const optionDone = 'option-done'
    await repository.commitFeishuTaskListBinding(bindingMutation(route, [task(
      'task-primary',
      '100',
      {
        customFieldValues: Object.freeze([Object.freeze({
          fieldGuid,
          type: 'single_select',
          singleSelectOptionGuid: optionDoing,
        })]),
      },
    )]), signal)
    const definition = Object.freeze({
      fieldName: 'Project status',
      initialStateId: 'planned',
      terminalStateIds: Object.freeze(['done']),
      states: Object.freeze([
        Object.freeze({
          stateId: 'planned',
          name: 'Planned',
          colorIndex: 1,
          allowedNextStateIds: Object.freeze(['doing']),
        }),
        Object.freeze({
          stateId: 'doing',
          name: 'Doing',
          colorIndex: 2,
          allowedNextStateIds: Object.freeze(['done']),
        }),
        Object.freeze({
          stateId: 'done',
          name: 'Done',
          colorIndex: 3,
          allowedNextStateIds: Object.freeze([]),
        }),
      ]),
    })
    const mapping = Object.freeze({
      mode: 'existing' as const,
      fieldGuid,
      options: Object.freeze([
        Object.freeze({ stateId: 'planned', optionGuid: optionPlanned }),
        Object.freeze({ stateId: 'doing', optionGuid: optionDoing }),
        Object.freeze({ stateId: 'done', optionGuid: optionDone }),
      ]),
    })
    const configuredAt = at(5)
    const mutation: WorkbenchFeishuTaskWorkflowConfigurationMutation = Object.freeze({
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
      expectedWorkflowRevision: null,
      definition,
      mapping,
      field: Object.freeze({
        fieldGuid,
        name: 'Project status',
        remoteVersion: 'field-version-1',
        options: Object.freeze([
          Object.freeze({
            stateId: 'planned', optionGuid: optionPlanned, name: 'Planned',
            colorIndex: 1, hidden: false,
          }),
          Object.freeze({
            stateId: 'doing', optionGuid: optionDoing, name: 'Doing',
            colorIndex: 2, hidden: false,
          }),
          Object.freeze({
            stateId: 'done', optionGuid: optionDone, name: 'Done',
            colorIndex: 3, hidden: false,
          }),
        ]),
      }),
      compatibility: Object.freeze({ state: 'compatible', issues: Object.freeze([]) }),
      configuredAt,
      command: command(5, 'owner-feishu-task-workflow-configure') as
        WorkbenchFeishuTaskWorkflowConfigurationMutation['command'],
    })

    const committed = await repository.commitFeishuTaskWorkflowConfiguration(mutation, signal)
    expect(committed).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        tasks: [{ taskGuid: 'task-primary', completed: false }],
        workflow: {
          revision: 1,
          field: { fieldGuid, remoteVersion: 'field-version-1' },
          options: [
            { stateId: 'planned', optionGuid: optionPlanned, usedTaskCount: 0 },
            { stateId: 'doing', optionGuid: optionDoing, usedTaskCount: 1 },
            { stateId: 'done', optionGuid: optionDone, usedTaskCount: 0 },
          ],
          values: [{
            taskGuid: 'task-primary',
            stateId: 'doing',
            optionGuid: optionDoing,
            recognized: true,
          }],
          compatibility: { state: 'compatible', issues: [] },
          completionSuggestions: [],
        },
      },
    })
    await expect(repository.replayFeishuTaskWorkflowConfiguration({
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      expectedTaskRevision: 1,
      expectedWorkflowRevision: null,
      definition,
      mapping,
      idempotencyKey: mutation.command.idempotencyKey,
      causationId: mutation.command.causationId,
      reason: 'owner-feishu-task-workflow-configure',
    }, signal)).resolves.toEqual(committed)

    const reconciled = await repository.commitFeishuTaskReconciliation({
      projectId: PROJECT_ID,
      expectedRevision: 2,
      snapshot: snapshot([task('task-primary', '101', {
        customFieldValues: Object.freeze([Object.freeze({
          fieldGuid,
          type: 'single_select',
          singleSelectOptionGuid: optionDone,
        })]),
      })], '11', at(6)),
      attemptedAt: at(6),
    }, signal)
    expect(reconciled).toMatchObject({
      ok: true,
      value: {
        revision: 3,
        tasks: [{ taskGuid: 'task-primary', completed: false }],
        workflow: {
          revision: 1,
          values: [{ taskGuid: 'task-primary', stateId: 'done', optionGuid: optionDone }],
          completionSuggestions: [{
            taskGuid: 'task-primary',
            stateId: 'done',
            reason: 'terminal-state-awaiting-owner-confirmation',
          }],
        },
      },
    })
    const database = Reflect.get(repository, 'database') as DatabaseSync
    const workflowVersions = database.prepare(`
      SELECT revision, field_guid, mapping_json FROM workbench_feishu_task_workflow_version
      WHERE project_id = ? ORDER BY revision
    `).all(PROJECT_ID) as Array<{
      readonly revision: number
      readonly field_guid: string
      readonly mapping_json: string
    }>
    expect(workflowVersions.map(row => ({
      revision: row.revision,
      field_guid: row.field_guid,
      mapping: JSON.parse(row.mapping_json),
    }))).toEqual([{
      revision: 1,
      field_guid: fieldGuid,
      mapping,
    }])
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({
      valid: true,
      eventCount: 5,
    })
    await repository.close()
  })
})
