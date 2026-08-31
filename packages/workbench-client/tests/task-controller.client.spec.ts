import type {
  ConfigureFeishuTaskWorkflowMapping,
  FeishuTaskListDiscoveryProjection,
  FeishuTaskWorkflowCompatibilityPreview,
  FeishuTaskWorkflowFieldDiscoveryProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
  ProjectTasksProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_PROJECT_TASKS_STATE,
  WorkbenchProjectTasksController,
  type WorkbenchProjectTasksRemote,
} from '../src/client/task-controller.ts'

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function task(overrides: Partial<ProjectTaskProjection> = {}): ProjectTaskProjection {
  return {
    taskGuid: 'task-1',
    taskId: 'provider-task-1',
    scope: 'primary-list',
    parentTaskGuid: null,
    summary: 'Investigate evidence',
    description: 'Read the source material.',
    assignees: [{ openId: 'ou-owner', name: 'Owner' }],
    followers: [],
    comments: [],
    completed: false,
    completedAt: null,
    canonicalUrl: 'https://applink.feishu.cn/client/todo/detail?guid=task-1',
    remoteVersion: '1700000000000',
    projectionRevision: 1,
    ...overrides,
  }
}

function projection(
  projectId = 'project-1',
  overrides: Partial<ProjectTasksProjection> = {},
): ProjectTasksProjection {
  return {
    projectId,
    revision: 1,
    binding: {
      taskListGuid: 'list-1',
      name: 'Evidence Project',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/task_list?guid=list-1',
      identity: {
        kind: 'bot',
        routeGeneration: 3,
        appId: 'cli-app',
        openId: 'ou-bot',
        tenantKey: 'tenant-1',
      },
      createdByWorkbench: false,
      remoteVersion: 'list-v1',
      boundAt: '2026-08-31T12:00:00.000Z',
    },
    tasks: [task()],
    sync: {
      state: 'healthy',
      lastEventAt: null,
      lastReconciledAt: '2026-08-31T12:00:00.000Z',
      lastAttemptAt: '2026-08-31T12:00:00.000Z',
      issue: null,
    },
    effects: [],
    workflow: null,
    ...overrides,
  }
}

function workflowDefinition(): ProjectTaskWorkflowDefinition {
  return {
    fieldName: 'Project status',
    initialStateId: 'planned',
    terminalStateIds: ['done'],
    states: [
      { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['doing'] },
      { stateId: 'doing', name: 'Doing', colorIndex: 2, allowedNextStateIds: ['done'] },
      { stateId: 'done', name: 'Done', colorIndex: 3, allowedNextStateIds: [] },
    ],
  }
}

function workflowProjection(
  overrides: Partial<ProjectTaskWorkflowProjection> = {},
): ProjectTaskWorkflowProjection {
  return {
    revision: 5,
    definition: workflowDefinition(),
    field: {
      fieldGuid: 'field-status', name: 'Project status', type: 'single_select', remoteVersion: 'field-v1',
    },
    options: [
      { stateId: 'planned', optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false, usedTaskCount: 0 },
      { stateId: 'doing', optionGuid: 'option-doing', name: 'Doing', colorIndex: 2, hidden: false, usedTaskCount: 1 },
      { stateId: 'done', optionGuid: 'option-done', name: 'Done', colorIndex: 3, hidden: false, usedTaskCount: 0 },
    ],
    values: [{
      taskGuid: 'task-1', stateId: 'doing', optionGuid: 'option-doing', stateName: 'Doing', recognized: true,
    }],
    compatibility: { state: 'compatible', issues: [] },
    completionSuggestions: [],
    configuredAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  }
}

function workflowDiscovery(): FeishuTaskWorkflowFieldDiscoveryProjection {
  return {
    projectId: 'project-1', taskListGuid: 'list-1', taskRevision: 1,
    items: [{
      fieldGuid: 'field-status', name: 'Project status', type: 'single_select', remoteVersion: 'field-v1',
      options: [
        { optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false },
        { optionGuid: 'option-doing', name: 'Doing', colorIndex: 2, hidden: false },
        { optionGuid: 'option-done', name: 'Done', colorIndex: 3, hidden: false },
      ],
    }],
  }
}

function existingMapping(): ConfigureFeishuTaskWorkflowMapping {
  return {
    mode: 'existing', fieldGuid: 'field-status',
    options: [
      { stateId: 'planned', optionGuid: 'option-planned' },
      { stateId: 'doing', optionGuid: 'option-doing' },
      { stateId: 'done', optionGuid: 'option-done' },
    ],
  }
}

function workflowPreview(
  mapping: ConfigureFeishuTaskWorkflowMapping = existingMapping(),
  overrides: Partial<FeishuTaskWorkflowCompatibilityPreview> = {},
): FeishuTaskWorkflowCompatibilityPreview {
  return {
    projectId: 'project-1', taskRevision: 1, workflowRevision: null,
    definition: workflowDefinition(), mapping,
    compatibility: { state: 'compatible', issues: [] },
    usedStateIds: ['doing'],
    ...overrides,
  }
}

function unbound(projectId = 'project-1'): ProjectTasksProjection {
  return projection(projectId, {
    revision: 0,
    binding: null,
    tasks: [],
    sync: {
      state: 'unbound',
      lastEventAt: null,
      lastReconciledAt: null,
      lastAttemptAt: null,
      issue: null,
    },
  })
}

function discovery(): FeishuTaskListDiscoveryProjection {
  return {
    projectId: 'project-1',
    connectionRevision: 7,
    kind: 'bot',
    routeGeneration: 3,
    items: [{
      taskListGuid: 'list-1',
      name: 'Evidence Project',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/task_list?guid=list-1',
      remoteVersion: 'list-v1',
    }],
  }
}

function makeRemote(overrides: Partial<WorkbenchProjectTasksRemote> = {}): WorkbenchProjectTasksRemote {
  return {
    projectTasks: overrides.projectTasks
      ?? vi.fn(query => Promise.resolve(remoteOk(unbound(query.projectId)))),
    discoverFeishuTaskLists: overrides.discoverFeishuTaskLists
      ?? vi.fn(() => Promise.resolve(remoteOk(discovery()))),
    bindFeishuTaskList: overrides.bindFeishuTaskList ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection(),
      receipt: { commandId: 'command-bind', auditEventId: 'audit-bind', outboxId: 'outbox-bind' },
    }))),
    reconcileProjectTasks: overrides.reconcileProjectTasks ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection(),
    }))),
    referenceFeishuTask: overrides.referenceFeishuTask ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection(),
      receipt: { commandId: 'command-reference', auditEventId: 'audit-reference', outboxId: 'outbox-reference' },
    }))),
    updateFeishuTask: overrides.updateFeishuTask ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection('project-1', {
        revision: 2,
        tasks: [task({ summary: 'Updated evidence', remoteVersion: '1700000000001' })],
      }),
      effect: {
        effectId: 'effect-1', taskGuid: 'task-1', state: 'delivered' as const,
        expectedRemoteVersion: '1700000000000',
        createdAt: '2026-08-31T12:01:00.000Z', updatedAt: '2026-08-31T12:01:00.000Z',
      },
      receipt: { commandId: 'command-update', auditEventId: 'audit-update', outboxId: 'outbox-update' },
    }))),
    discoverFeishuTaskWorkflowFields: overrides.discoverFeishuTaskWorkflowFields
      ?? vi.fn(() => Promise.resolve(remoteOk(workflowDiscovery()))),
    previewFeishuTaskWorkflow: overrides.previewFeishuTaskWorkflow
      ?? vi.fn(request => Promise.resolve(remoteOk(workflowPreview(request.mapping, {
        definition: request.definition,
        taskRevision: request.expectedTaskRevision,
        workflowRevision: request.expectedWorkflowRevision,
      })))),
    configureFeishuTaskWorkflow: overrides.configureFeishuTaskWorkflow
      ?? vi.fn(() => Promise.resolve(remoteOk({
        ok: true as const,
        value: projection('project-1', { revision: 2, workflow: workflowProjection({ revision: 1 }) }),
        receipt: { commandId: 'command-workflow', auditEventId: 'audit-workflow', outboxId: 'outbox-workflow' },
      }))),
  }
}

describe('WorkbenchProjectTasksController', () => {
  it('reads one Project mirror and clears it at the Project identity boundary', async () => {
    const read = vi.fn(query => Promise.resolve(remoteOk(unbound(query.projectId))))
    const controller = new WorkbenchProjectTasksController(makeRemote({ projectTasks: read }))

    await controller.selectProject('project-1', 'Evidence Project')
    expect(read).toHaveBeenCalledWith({ projectId: 'project-1' }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: { projectId: 'project-1', binding: null },
    })

    controller.clearSelection()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', selection: null, projection: null })
    await controller.dispose()
  })

  it('discovers and binds through the exact selected identity revision and idempotency keys', async () => {
    const bind = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection(),
      receipt: { commandId: 'command-bind', auditEventId: 'audit-bind', outboxId: 'outbox-bind' },
    })))
    const keys = ['idem-bind', 'cause-bind']
    const committed = vi.fn()
    const controller = new WorkbenchProjectTasksController(makeRemote({ bindFeishuTaskList: bind }), {
      nextCommandKey: () => keys.shift() ?? 'unexpected',
      onCommitted: committed,
    })
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.discover('bot', 7, 3)
    const candidate = controller.getSnapshot().discovery?.items[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) throw new Error('candidate missing')

    await controller.bindExisting(candidate)
    expect(bind).toHaveBeenCalledWith({
      projectId: 'project-1',
      kind: 'bot',
      expectedConnectionRevision: 7,
      expectedRouteGeneration: 3,
      expectedBindingRevision: null,
      mode: 'existing',
      taskListGuid: 'list-1',
      idempotencyKey: 'idem-bind',
      causationId: 'cause-bind',
      reason: 'owner-feishu-task-list-bind',
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', projection: { binding: { taskListGuid: 'list-1' } }, discovery: null,
    })
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'command-bind' }))
    await controller.dispose()
  })

  it('carries the task remote version and never auto-retries an unknown provider outcome', async () => {
    const update = vi.fn(() => Promise.resolve(remoteOk({
      ok: false as const,
      error: {
        code: 'remote-outcome-unknown' as const,
        message: 'redacted',
        effect: {
          effectId: 'effect-unknown', taskGuid: 'task-1', state: 'unknown' as const,
          expectedRemoteVersion: '1700000000000',
          createdAt: '2026-08-31T12:01:00.000Z', updatedAt: '2026-08-31T12:01:00.000Z',
        },
        issue: {
          code: 'provider-unavailable' as const,
          recovery: 'retry-later' as const,
          missingScopes: [],
          grantPlane: null,
          retryAt: null,
        },
      },
    })))
    const read = vi.fn(() => Promise.resolve(remoteOk(projection())))
    const keys = ['idem-update', 'cause-update']
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: read,
      updateFeishuTask: update,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1')
    const current = controller.getSnapshot().projection?.tasks[0]
    if (current === undefined) throw new Error('task missing')

    await controller.update(current, { summary: 'Updated evidence' })
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      taskGuid: 'task-1',
      expectedRevision: 1,
      expectedRemoteVersion: '1700000000000',
      idempotencyKey: 'idem-update',
      causationId: 'cause-update',
      changes: { summary: 'Updated evidence' },
    }), expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      issue: { kind: 'conflict', code: 'remote-outcome-unknown' },
      canRetryMutation: false,
    })
    expect(update).toHaveBeenCalledOnce()
    await controller.retryMutation()
    expect(update).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('allows only an explicit outside-list task reference and replays transport loss exactly', async () => {
    const reference = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('hidden transport detail'), { code: 'unavailable' }))
      .mockResolvedValueOnce(remoteOk({
        ok: true as const,
        value: projection('project-1', {
          revision: 2,
          tasks: [task(), task({
            taskGuid: 'outside-1', taskId: 'outside-1', scope: 'explicit-reference',
            summary: 'Explicit outside task', remoteVersion: 'outside-v1',
          })],
        }),
        receipt: { commandId: 'command-reference', auditEventId: 'audit-reference', outboxId: 'outbox-reference' },
      }))
    const keys = ['idem-reference', 'cause-reference']
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      referenceFeishuTask: reference,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1')

    await controller.reference('outside-1')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', canRetryMutation: true, issue: { kind: 'transport', code: 'unavailable' },
    })
    const firstRequest = reference.mock.calls[0]?.[0]
    await controller.retryMutation()
    expect(reference).toHaveBeenCalledTimes(2)
    expect(reference.mock.calls[1]?.[0]).toBe(firstRequest)
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      projection: { tasks: expect.arrayContaining([expect.objectContaining({
        taskGuid: 'outside-1', scope: 'explicit-reference',
      })]) },
      canRetryMutation: false,
    })
    await controller.dispose()
  })

  it('discovers fields, previews the exact stable mapping, and configures only that reviewed intent', async () => {
    const discoverFields = vi.fn(() => Promise.resolve(remoteOk(workflowDiscovery())))
    const preview = vi.fn(request => Promise.resolve(remoteOk(workflowPreview(request.mapping, {
      definition: request.definition,
      taskRevision: request.expectedTaskRevision,
      workflowRevision: request.expectedWorkflowRevision,
    }))))
    const configure = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection('project-1', { revision: 2, workflow: workflowProjection({ revision: 1 }) }),
      receipt: { commandId: 'command-workflow', auditEventId: 'audit-workflow', outboxId: 'outbox-workflow' },
    })))
    const keys = ['idem-workflow', 'cause-workflow']
    const committed = vi.fn()
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      discoverFeishuTaskWorkflowFields: discoverFields,
      previewFeishuTaskWorkflow: preview,
      configureFeishuTaskWorkflow: configure,
    }), {
      nextCommandKey: () => keys.shift() ?? 'unexpected',
      onCommitted: committed,
    })
    await controller.selectProject('project-1')
    await controller.discoverWorkflowFields()
    expect(discoverFields).toHaveBeenCalledWith({
      projectId: 'project-1', expectedTaskRevision: 1,
    }, expect.any(AbortSignal))

    const definition = workflowDefinition()
    const mapping = existingMapping()
    await controller.previewWorkflow(definition, mapping)
    expect(preview).toHaveBeenCalledWith({
      projectId: 'project-1', expectedTaskRevision: 1, expectedWorkflowRevision: null,
      definition, mapping,
    }, expect.any(AbortSignal))
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(true)
    expect(controller.canConfigureWorkflow({ ...definition, fieldName: 'Changed' }, mapping)).toBe(false)

    await controller.configureWorkflow(definition, mapping)
    expect(configure).toHaveBeenCalledWith({
      projectId: 'project-1', expectedTaskRevision: 1, expectedWorkflowRevision: null,
      definition, mapping,
      idempotencyKey: 'idem-workflow', causationId: 'cause-workflow',
      reason: 'owner-feishu-task-workflow-configure',
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', projection: { revision: 2, workflow: { revision: 1 } },
      workflowDiscovery: null, workflowPreview: null,
    })
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'command-workflow' }))
    await controller.dispose()
  })

  it('never submits a compatibility preview returned for another Project scope', async () => {
    const configure = vi.fn()
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      previewFeishuTaskWorkflow: vi.fn(request => Promise.resolve(remoteOk(workflowPreview(
        request.mapping,
        { projectId: 'project-2', definition: request.definition },
      )))),
      configureFeishuTaskWorkflow: configure,
    }))
    await controller.selectProject('project-1')
    const definition = workflowDefinition()
    const mapping = { mode: 'create' as const }

    await controller.previewWorkflow(definition, mapping)
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(false)
    await controller.configureWorkflow(definition, mapping)
    expect(configure).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it.each([
    { mode: 'create' as const, currentWorkflow: null, expectedWorkflowRevision: null },
    { mode: 'migrate' as const, currentWorkflow: workflowProjection(), expectedWorkflowRevision: 5 },
  ])('previews and configures the $mode workflow path', async ({
    mode,
    currentWorkflow,
    expectedWorkflowRevision,
  }) => {
    const mapping: ConfigureFeishuTaskWorkflowMapping = { mode }
    const current = projection('project-1', { workflow: currentWorkflow })
    const preview = vi.fn(request => Promise.resolve(remoteOk(workflowPreview(request.mapping, {
      definition: request.definition,
      taskRevision: request.expectedTaskRevision,
      workflowRevision: request.expectedWorkflowRevision,
    }))))
    const configure = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection('project-1', { revision: 2, workflow: workflowProjection({ revision: 6 }) }),
      receipt: { commandId: 'command-workflow', auditEventId: 'audit-workflow', outboxId: 'outbox-workflow' },
    })))
    const keys = ['idem-workflow', 'cause-workflow']
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(current))),
      previewFeishuTaskWorkflow: preview,
      configureFeishuTaskWorkflow: configure,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1')
    await controller.previewWorkflow(workflowDefinition(), mapping)
    await controller.configureWorkflow(workflowDefinition(), mapping)
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      expectedWorkflowRevision, mapping,
    }), expect.any(AbortSignal))
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      expectedWorkflowRevision, mapping,
    }), expect.any(AbortSignal))
    await controller.dispose()
  })

  it('keeps blocked compatibility as read-only evidence and never submits configuration', async () => {
    const configure = vi.fn()
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      previewFeishuTaskWorkflow: vi.fn(request => Promise.resolve(remoteOk(workflowPreview(
        request.mapping,
        {
          definition: request.definition,
          compatibility: {
            state: 'blocked',
            issues: [{
              code: 'used-state-removal', severity: 'blocked', stateId: 'doing', taskGuid: null,
              message: 'safe Host diagnostic',
            }],
          },
        },
      )))),
      configureFeishuTaskWorkflow: configure,
    }))
    await controller.selectProject('project-1')
    const definition = workflowDefinition()
    const mapping = { mode: 'create' as const }
    await controller.previewWorkflow(definition, mapping)
    expect(controller.getSnapshot()).toMatchObject({
      workflowPreview: {
        compatibility: {
          state: 'blocked',
          issues: [{ code: 'used-state-removal', stateId: 'doing' }],
        },
      },
    })
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(false)
    await controller.configureWorkflow(definition, mapping)
    expect(configure).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('invalidates a reviewed draft when Host detects a configuration race', async () => {
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      configureFeishuTaskWorkflow: vi.fn(() => Promise.resolve(remoteOk({
        ok: false as const,
        error: {
          code: 'workflow-compatibility-blocked' as const,
          message: 'safe conflict',
          compatibility: {
            state: 'blocked' as const,
            issues: [{
              code: 'field-version-changed' as const, severity: 'blocked' as const,
              stateId: null, taskGuid: null, message: 'safe Host diagnostic',
            }],
          },
        },
      }))),
    }), { nextCommandKey: (() => {
      const keys = ['idem-workflow', 'cause-workflow']
      return () => keys.shift() ?? 'unexpected'
    })() })
    await controller.selectProject('project-1')
    const definition = workflowDefinition()
    const mapping = { mode: 'create' as const }
    await controller.previewWorkflow(definition, mapping)
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(true)
    await controller.configureWorkflow(definition, mapping)
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict', workflowPreview: null,
      issue: { kind: 'conflict', code: 'workflow-compatibility-blocked' },
    })
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(false)
    await controller.dispose()
  })

  it('offers only Host-defined mapped transitions and separates terminal suggestion from completion', async () => {
    const update = vi.fn()
      .mockResolvedValueOnce(remoteOk({
        ok: true as const,
        value: projection('project-1', {
          revision: 2,
          workflow: workflowProjection({
            values: [{
              taskGuid: 'task-1', stateId: 'done', optionGuid: 'option-done',
              stateName: 'Done', recognized: true,
            }],
            completionSuggestions: [{
              taskGuid: 'task-1', stateId: 'done', stateName: 'Done',
              reason: 'terminal-state-awaiting-owner-confirmation',
            }],
          }),
        }),
        effect: {
          effectId: 'effect-state', taskGuid: 'task-1', state: 'delivered' as const,
          expectedRemoteVersion: '1700000000000',
          createdAt: '2026-08-31T12:01:00.000Z', updatedAt: '2026-08-31T12:01:00.000Z',
        },
        receipt: { commandId: 'command-state', auditEventId: 'audit-state', outboxId: 'outbox-state' },
      }))
      .mockResolvedValueOnce(remoteOk({
        ok: true as const,
        value: projection('project-1', {
          revision: 3,
          tasks: [task({ completed: true, remoteVersion: '1700000000002' })],
          workflow: workflowProjection({ completionSuggestions: [] }),
        }),
        effect: {
          effectId: 'effect-complete', taskGuid: 'task-1', state: 'delivered' as const,
          expectedRemoteVersion: '1700000000000',
          createdAt: '2026-08-31T12:02:00.000Z', updatedAt: '2026-08-31T12:02:00.000Z',
        },
        receipt: { commandId: 'command-complete', auditEventId: 'audit-complete', outboxId: 'outbox-complete' },
      }))
    const keys = ['idem-state', 'cause-state', 'idem-complete', 'cause-complete']
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection('project-1', {
        workflow: workflowProjection(),
      })))),
      updateFeishuTask: update,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1')
    expect(controller.allowedWorkflowTransitions('task-1')).toEqual([
      { stateId: 'done', name: 'Done', colorIndex: 3, terminal: true },
    ])
    const current = controller.getSnapshot().projection?.tasks[0]
    if (current === undefined) throw new Error('task missing')
    await controller.update(current, { workflowStateId: 'planned' })
    expect(update).not.toHaveBeenCalled()
    await controller.update(current, { workflowStateId: 'done', completed: true })
    expect(update).not.toHaveBeenCalled()

    await controller.update(current, { workflowStateId: 'done' })
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expectedWorkflowRevision: 5,
      changes: { workflowStateId: 'done' },
    }), expect.any(AbortSignal))
    expect(update.mock.calls[0]?.[0].changes).not.toHaveProperty('completed')
    expect(controller.getSnapshot()).toMatchObject({
      projection: {
        tasks: [{ completed: false }],
        workflow: { completionSuggestions: [{ taskGuid: 'task-1', stateId: 'done' }] },
      },
    })

    const terminalTask = controller.getSnapshot().projection?.tasks[0]
    if (terminalTask === undefined) throw new Error('terminal task missing')
    await controller.update(terminalTask, { completed: true })
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      changes: { completed: true },
    }), expect.any(AbortSignal))
    expect(update.mock.calls[1]?.[0]).not.toHaveProperty('expectedWorkflowRevision')
    await controller.dispose()
  })

  it('replays a configuration transport loss exactly and never carries it across a Project boundary', async () => {
    const configure = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('redacted transport'), { code: 'unavailable' }))
      .mockResolvedValueOnce(remoteOk({
        ok: true as const,
        value: projection('project-1', { revision: 2, workflow: workflowProjection({ revision: 1 }) }),
        receipt: { commandId: 'command-workflow', auditEventId: 'audit-workflow', outboxId: 'outbox-workflow' },
      }))
    const keys = ['idem-workflow', 'cause-workflow']
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(query => Promise.resolve(remoteOk(projection(query.projectId)))),
      configureFeishuTaskWorkflow: configure,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1')
    const definition = workflowDefinition()
    const mapping = { mode: 'create' as const }
    await controller.previewWorkflow(definition, mapping)
    await controller.configureWorkflow(definition, mapping)
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', canRetryMutation: true,
      issue: { kind: 'transport', code: 'unavailable', operation: 'configure-workflow' },
    })
    expect(controller.canConfigureWorkflow(definition, mapping)).toBe(false)
    const firstRequest = configure.mock.calls[0]?.[0]
    await controller.retryMutation()
    expect(configure.mock.calls[1]?.[0]).toBe(firstRequest)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', canRetryMutation: false })

    await controller.selectProject('project-2')
    await controller.retryMutation()
    expect(configure).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('invalidates provider discovery and preview on disconnect while retaining the last Host projection', async () => {
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
    }))
    await controller.selectProject('project-1')
    await controller.discoverWorkflowFields()
    await controller.previewWorkflow(workflowDefinition(), existingMapping())
    expect(controller.getSnapshot()).toMatchObject({
      workflowDiscovery: { taskRevision: 1 },
      workflowPreview: { taskRevision: 1 },
    })

    controller.markDisconnected()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stale', projection: { projectId: 'project-1', revision: 1 },
      workflowDiscovery: null, workflowPreview: null,
    })
    await controller.dispose()
  })

  it('aborts workflow discovery and ignores every late completion after HMR disposal', async () => {
    const pending = deferred<RemoteResult<FeishuTaskWorkflowFieldDiscoveryProjection>>()
    let operationSignal: AbortSignal | undefined
    const discover = vi.fn((_request, signal?: AbortSignal) => {
      operationSignal = signal
      return pending.promise
    })
    const controller = new WorkbenchProjectTasksController(makeRemote({
      projectTasks: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      discoverFeishuTaskWorkflowFields: discover,
    }))
    const listener = vi.fn()
    controller.subscribe(listener)
    await controller.selectProject('project-1')
    const discovery = controller.discoverWorkflowFields()
    const disposal = controller.dispose()
    expect(operationSignal?.aborted).toBe(true)
    pending.resolve(remoteOk(workflowDiscovery()))
    await discovery
    await disposal
    expect(controller.getSnapshot()).toBe(INITIAL_WORKBENCH_PROJECT_TASKS_STATE)
    const callsAfterDisposal = listener.mock.calls.length
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(callsAfterDisposal)
  })
})
