import type {
  FeishuTaskListDiscoveryProjection,
  ProjectTaskProjection,
  ProjectTasksProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchProjectTasksController,
  type WorkbenchProjectTasksRemote,
} from '../src/client/task-controller.ts'

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
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
})
