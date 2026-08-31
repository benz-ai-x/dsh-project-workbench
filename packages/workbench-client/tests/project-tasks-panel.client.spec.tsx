// @vitest-environment jsdom

import type {
  FeishuConnectionCenterProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowProjection,
  ProjectTasksProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE,
  type WorkbenchFeishuConnectionClientState,
  type WorkbenchFeishuConnectionController,
} from '../src/client/feishu-connection-controller.ts'
import { en, type WorkbenchKey } from '../src/client/locales.ts'
import { ProjectTasksPanel } from '../src/client/ProjectTasksPanel.tsx'
import {
  type WorkbenchProjectTasksClientState,
  type WorkbenchProjectTasksController,
} from '../src/client/task-controller.ts'

const t = (key: WorkbenchKey): string => en[key]

afterEach(() => { cleanup() })

function verifiedCenter(): FeishuConnectionCenterProjection {
  const bot = {
    kind: 'bot' as const,
    state: 'configured' as const,
    generation: 3,
    appId: 'cli-app',
    credential: { ref: 'FEISHU_BOT', configured: true, source: 'env', writable: false },
    actor: {
      connectionId: 'feishu-primary' as const,
      realm: 'feishu-cn' as const,
      appId: 'cli-app',
      kind: 'bot' as const,
      routeGeneration: 3,
      openId: 'ou-bot',
      tenantKey: 'tenant-1',
    },
    displayLabel: 'Project Bot',
    lastVerification: {
      verificationId: 'verification-1',
      sequence: 1,
      routeGeneration: 3,
      checkedAt: '2026-08-31T12:00:00.000Z',
      result: 'healthy' as const,
      identity: { state: 'verified' as const, issue: null },
      scopeInspection: { state: 'observed' as const, scopes: [], issue: null },
      resourceProbe: { state: 'not-tested' as const },
    },
  }
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision: 7,
    bot,
    user: {
      kind: 'user',
      state: 'unconfigured',
      generation: null,
      appId: null,
      credential: { ref: null, configured: false, source: null, writable: false },
      actor: null,
      displayLabel: null,
      lastVerification: null,
    },
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

function task(overrides: Partial<ProjectTaskProjection> = {}): ProjectTaskProjection {
  return {
    taskGuid: 'task-parent',
    taskId: 'provider-parent',
    scope: 'primary-list',
    parentTaskGuid: null,
    summary: 'Parent investigation',
    description: 'Inspect the primary evidence.',
    assignees: [{ openId: 'ou-owner', name: 'Ada' }],
    followers: [{ openId: 'ou-reviewer', name: 'Lin' }],
    comments: [{
      commentId: 'comment-1',
      content: 'Evidence checked.',
      creator: { openId: 'ou-reviewer', name: 'Lin' },
      replyToCommentId: null,
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:01:00.000Z',
    }],
    completed: false,
    completedAt: null,
    canonicalUrl: 'https://applink.feishu.cn/client/todo/detail?guid=task-parent',
    remoteVersion: 'remote-v1',
    projectionRevision: 1,
    ...overrides,
  }
}

function unboundProjection(): ProjectTasksProjection {
  return {
    projectId: 'project-1',
    revision: 0,
    binding: null,
    tasks: [],
    sync: {
      state: 'unbound', lastEventAt: null, lastReconciledAt: null, lastAttemptAt: null, issue: null,
    },
    effects: [],
    workflow: null,
  }
}

function boundProjection(): ProjectTasksProjection {
  return {
    projectId: 'project-1',
    revision: 4,
    binding: {
      taskListGuid: 'list-1',
      name: 'Evidence Project Tasks',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/task_list?guid=list-1',
      identity: {
        kind: 'bot', routeGeneration: 3, appId: 'cli-app', openId: 'ou-bot', tenantKey: 'tenant-1',
      },
      createdByWorkbench: true,
      remoteVersion: 'list-v1',
      boundAt: '2026-08-31T12:00:00.000Z',
    },
    tasks: [
      task(),
      task({
        taskGuid: 'task-child', taskId: 'provider-child', parentTaskGuid: 'task-parent',
        summary: 'Child evidence check', description: '', assignees: [], followers: [], comments: [],
        completed: true, completedAt: '2026-08-31T13:00:00.000Z',
        canonicalUrl: 'https://applink.feishu.cn/client/todo/detail?guid=task-child',
        remoteVersion: 'remote-v2',
      }),
    ],
    sync: {
      state: 'unknown', lastEventAt: null, lastReconciledAt: null,
      lastAttemptAt: '2026-08-31T12:03:00.000Z', issue: null,
    },
    effects: [{
      effectId: 'effect-unknown', taskGuid: 'task-parent', state: 'unknown',
      expectedRemoteVersion: 'remote-v1',
      createdAt: '2026-08-31T12:02:00.000Z', updatedAt: '2026-08-31T12:03:00.000Z',
    }],
    workflow: null,
  }
}

function workflowProjection(): ProjectTaskWorkflowProjection {
  return {
    revision: 3,
    definition: {
      fieldName: 'Project status', initialStateId: 'planned', terminalStateIds: ['done'],
      states: [
        { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['doing'] },
        { stateId: 'doing', name: 'Doing', colorIndex: 2, allowedNextStateIds: ['done'] },
        { stateId: 'done', name: 'Done', colorIndex: 3, allowedNextStateIds: [] },
      ],
    },
    field: {
      fieldGuid: 'field-status', name: 'Project status', type: 'single_select', remoteVersion: 'field-v3',
    },
    options: [
      { stateId: 'planned', optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false, usedTaskCount: 0 },
      { stateId: 'doing', optionGuid: 'option-doing', name: 'Doing', colorIndex: 2, hidden: false, usedTaskCount: 1 },
      { stateId: 'done', optionGuid: 'option-done', name: 'Done', colorIndex: 3, hidden: false, usedTaskCount: 1 },
    ],
    values: [
      { taskGuid: 'task-parent', stateId: 'doing', optionGuid: 'option-doing', stateName: 'Doing', recognized: true },
      { taskGuid: 'task-child', stateId: 'done', optionGuid: 'option-done', stateName: 'Done', recognized: true },
    ],
    compatibility: { state: 'compatible', issues: [] },
    completionSuggestions: [{
      taskGuid: 'task-child', stateId: 'done', stateName: 'Done',
      reason: 'terminal-state-awaiting-owner-confirmation',
    }],
    configuredAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:10:00.000Z',
  }
}

function connectionFace(): WorkbenchFeishuConnectionController {
  const state: WorkbenchFeishuConnectionClientState = {
    ...INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE,
    phase: 'ready',
    center: verifiedCenter(),
  }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
  } as unknown as WorkbenchFeishuConnectionController
}

function taskFace(state: WorkbenchProjectTasksClientState) {
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    discover: vi.fn(),
    bindExisting: vi.fn(),
    createAndBind: vi.fn(),
    reconcile: vi.fn(),
    reference: vi.fn(),
    update: vi.fn(),
    allowedWorkflowTransitions: vi.fn(() => []),
    canConfigureWorkflow: vi.fn(() => false),
    discoverWorkflowFields: vi.fn(),
    previewWorkflow: vi.fn(),
    configureWorkflow: vi.fn(),
    retryMutation: vi.fn(),
    refresh: vi.fn(),
  }
}

describe('ProjectTasksPanel', () => {
  it('requires an explicit verified identity discovery before binding or creating a primary list', () => {
    const candidate = {
      taskListGuid: 'list-1',
      name: 'Existing Evidence List',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/task_list?guid=list-1',
      remoteVersion: 'list-v1',
    }
    const controller = taskFace({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: unboundProjection(),
      discovery: {
        projectId: 'project-1', connectionRevision: 7, kind: 'bot', routeGeneration: 3,
        items: [candidate],
      },
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
      focusEpoch: 0,
    })
    render(<ProjectTasksPanel
      controller={controller as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Read accessible lists' }))
    expect(controller.discover).toHaveBeenCalledWith('bot', 7, 3)

    fireEvent.change(screen.getByLabelText('Existing task list'), { target: { value: 'list-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bind selected list' }))
    expect(controller.bindExisting).toHaveBeenCalledWith(candidate)

    fireEvent.change(screen.getByLabelText('New task-list name'), { target: { value: 'New list' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create and bind' }))
    expect(controller.createAndBind).toHaveBeenCalledWith('New list')
  })

  it('renders nested tasks, roles, comments, canonical links, explicit reference, and unknown safety copy', () => {
    const controller = taskFace({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: boundProjection(),
      discovery: null,
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
      focusEpoch: 0,
    })
    render(<ProjectTasksPanel
      controller={controller as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)

    expect(screen.getByText('Parent investigation')).toBeTruthy()
    expect(screen.getByText('Child evidence check')).toBeTruthy()
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Lin').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Comments (1)'))
    expect(screen.getByText('Evidence checked.')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: 'Open in Feishu' })
    expect(links.some(link => link.getAttribute('href')?.includes('task_list'))).toBe(true)
    expect(screen.getByText(/does not retry blindly/i)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Explicitly reference an outside-list task'), {
      target: { value: 'outside-task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add reference' }))
    expect(controller.reference).toHaveBeenCalledWith('outside-task')

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark complete' })[0]!)
    expect(controller.update).toHaveBeenCalledWith(
      expect.objectContaining({ taskGuid: 'task-parent', remoteVersion: 'remote-v1' }),
      { completed: true },
    )
  })

  it('offers only allowed Host states and keeps terminal completion behind explicit confirmation', () => {
    const base = boundProjection()
    const project = {
      ...base,
      tasks: [
        base.tasks[0]!,
        { ...base.tasks[1]!, completed: false, completedAt: null },
      ],
      workflow: workflowProjection(),
    }
    const controller = taskFace({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: project,
      discovery: null,
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
      focusEpoch: 0,
    })
    controller.allowedWorkflowTransitions.mockImplementation((taskGuid: string) => taskGuid === 'task-parent'
      ? [{ stateId: 'done', name: 'Done', colorIndex: 3, terminal: true }]
      : [])
    render(<ProjectTasksPanel
      controller={controller as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)

    expect(screen.getAllByText('Feishu authoritative state')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Allowed transition · Parent investigation'), {
      target: { value: 'done' },
    })
    expect(controller.update).toHaveBeenCalledWith(
      expect.objectContaining({ taskGuid: 'task-parent' }),
      { workflowStateId: 'done' },
    )
    expect(controller.update.mock.calls[0]?.[1]).not.toHaveProperty('completed')

    expect(screen.getByText('Completion suggested')).toBeTruthy()
    expect(screen.getByText(/Only the explicit Owner confirmation/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' }))
    expect(controller.update).toHaveBeenCalledWith(
      expect.objectContaining({ taskGuid: 'task-child' }),
      { completed: true },
    )
  })

  it('exposes create preview and field discovery without enabling an unreviewed configuration', () => {
    const controller = taskFace({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: boundProjection(),
      discovery: null,
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
      focusEpoch: 0,
    })
    render(<ProjectTasksPanel
      controller={controller as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Read Feishu fields' }))
    expect(controller.discoverWorkflowFields).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Preview compatibility' }))
    expect(controller.previewWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      fieldName: 'Project status', initialStateId: 'planned', terminalStateIds: ['done'],
    }), { mode: 'create' })
    expect((screen.getByRole('button', {
      name: 'Confirm configuration',
    }) as HTMLButtonElement).disabled).toBe(true)
    expect(controller.configureWorkflow).not.toHaveBeenCalled()
  })

  it('clears the workflow draft at Project replacement and HMR remount boundaries', () => {
    const state = (projectId: string): WorkbenchProjectTasksClientState => ({
      phase: 'ready',
      selection: { projectId, projectName: `Project ${projectId}` },
      projection: { ...boundProjection(), projectId },
      discovery: null,
      workflowDiscovery: null,
      workflowPreview: null,
      pendingOperation: null,
      pendingTaskGuid: null,
      issue: null,
      canRetryMutation: false,
      focusTaskGuid: null,
      focusEpoch: 0,
    })
    const first = taskFace(state('project-1'))
    const view = render(<ProjectTasksPanel
      controller={first as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)
    const field = screen.getByLabelText('Status field name') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Private project-one draft' } })
    expect(field.value).toBe('Private project-one draft')

    const second = taskFace(state('project-2'))
    view.rerender(<ProjectTasksPanel
      controller={second as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)
    expect((screen.getByLabelText('Status field name') as HTMLInputElement).value).toBe('Project status')

    view.unmount()
    render(<ProjectTasksPanel
      controller={taskFace(state('project-2')) as unknown as WorkbenchProjectTasksController}
      connectionController={connectionFace()}
      t={t}
    />)
    expect((screen.getByLabelText('Status field name') as HTMLInputElement).value).toBe('Project status')
  })
})
