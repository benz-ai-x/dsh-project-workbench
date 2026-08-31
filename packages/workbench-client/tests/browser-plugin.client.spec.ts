// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/src/client/registry.ts'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type {
  FeishuConnectionCenterProjection,
  OwnerAccessProjection,
  OwnerAuthResponse,
  ProjectDetailProjection,
  ProjectMilestonesProjection,
  ProjectStartProjection,
  ProjectTasksProjection,
  ReviewCenterProjection,
  WorkbenchActivityProjection,
  WorkbenchStatusSnapshot,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { OwnerAuthHttp } from '../src/client/auth-http.ts'
import { OwnerController } from '../src/client/owner-controller.ts'
import { OwnerPage } from '../src/client/OwnerPage.tsx'
import { registerWorkbenchStyle } from '../src/client/style-lifecycle.ts'
import {
  mountWorkbenchClient,
  uiInject,
  WORKBENCH_SLOT_PRIORITY,
} from '../src/client/mount.ts'
import { inject as browserInject } from '../src/client/index.ts'
import * as nodePlugin from '../src/index.ts'

const REMOTE: TypertRemoteContribution = {
  package: '@benz-ai-x/dsh-project-workbench',
  descriptors: [],
}

function status(): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message: 'Host-backed status',
    revision: 1,
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

function signedIn(): Extract<OwnerAccessProjection, { readonly state: 'signed-in' }> {
  return {
    state: 'signed-in',
    ownerId: 'owner-1',
    organizationId: 'organization-1',
    teamId: 'team-1',
    sessionExpiresAt: '2099-09-01T00:00:00.000Z',
  }
}

function emptyActivity(): WorkbenchActivityProjection {
  return {
    items: [],
    nextBeforeSequence: null,
    integrity: {
      valid: true,
      eventCount: 0,
      headHash: `sha256:${'0'.repeat(64)}`,
      issue: null,
    },
  }
}

function unconfiguredFeishuCenter(): FeishuConnectionCenterProjection {
  const route = (kind: 'bot' | 'user') => ({
    kind,
    state: 'unconfigured' as const,
    generation: null,
    appId: null,
    credential: { ref: null, configured: false, source: null, writable: false },
    actor: null,
    displayLabel: null,
    lastVerification: null,
  })
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision: 0,
    bot: route('bot'),
    user: route('user'),
    updatedAt: null,
  }
}

function emptyProjectStart(): ProjectStartProjection {
  const definitionDigest = `sha256:${'a'.repeat(64)}` as const
  return {
    template: {
      selection: { templateId: 'knowledge-work', templateVersion: 1, definitionDigest },
      definition: {
        snapshotSchemaVersion: 1,
        templateId: 'knowledge-work',
        templateVersion: 1,
        kind: 'knowledge-work',
        rules: {
          minimumOutcomeCount: 1,
          outcomeMetricRequired: true,
          primaryGoalRequired: true,
          supportingGoalsAllowed: true,
        },
        defaults: { projectTimezone: 'Asia/Shanghai' },
      },
    },
    catalogRevision: 0,
    projects: [],
    nextBeforeSequence: null,
  }
}

function projectDetail(): ProjectDetailProjection {
  const template = emptyProjectStart().template
  const project = {
    projectId: 'project-1',
    name: 'Evidence Project',
    revision: 1,
    catalogSequence: 1,
    timezone: 'Asia/Shanghai',
    createdAt: '2026-08-31T12:00:00.000Z',
    primaryGoal: { goalId: 'goal-1', name: 'Improve evidence', revision: 1 },
  }
  return {
    project,
    primaryGoal: {
      ...project.primaryGoal,
      outcomes: [{
        outcomeId: 'outcome-1',
        name: 'Increase coverage',
        revision: 1,
        metric: {
          metricName: 'Coverage', initialValue: 10, targetValue: 90, unit: '%', direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    templateSnapshot: {
      template: template.selection,
      snapshotSchemaVersion: 1,
      definition: template.definition,
      snapshotDigest: template.selection.definitionDigest,
      capturedAt: '2026-08-31T12:00:00.000Z',
    },
  }
}

function emptyReviewCenter(projectId: string): ReviewCenterProjection {
  return {
    projectId,
    proposalBuilder: {
      projectId,
      teamRevision: 0,
      responsibilityRevision: null,
      base: {
        accountableMemberId: null,
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
      memberOptions: [],
      evidenceOptions: [],
    },
    items: [],
    nextBeforeSequence: null,
  }
}

function unboundProjectTasks(projectId: string): ProjectTasksProjection {
  return {
    projectId,
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

function unboundProjectMilestones(projectId: string): ProjectMilestonesProjection {
  return {
    projectId,
    revision: 0,
    binding: null,
    milestones: [],
    sync: {
      state: 'unbound', lastEventAt: null, lastReconciledAt: null, lastAttemptAt: null, issue: null,
    },
    effects: [],
    recentChanges: [],
  }
}

type WorkbenchRemoteSnapshot = (
  signal?: AbortSignal,
) => Promise<{ readonly ok: true; readonly value: WorkbenchStatusSnapshot }>

type WorkbenchRemoteActivity = (
  signal?: AbortSignal,
) => Promise<{ readonly ok: true; readonly value: WorkbenchActivityProjection }>

type WorkbenchRemoteProjectStart = (
  signal?: AbortSignal,
) => Promise<{ readonly ok: true; readonly value: ProjectStartProjection }>

type AuthState = (
  signal?: AbortSignal,
) => Promise<OwnerAuthResponse<OwnerAccessProjection>>

async function bench(options: {
  registrationFailure?: boolean
  snapshot?: WorkbenchRemoteSnapshot
  activity?: WorkbenchRemoteActivity
  projectStart?: WorkbenchRemoteProjectStart
  authState?: AuthState
} = {}) {
  const ctx = new Context()
  const order: string[] = []
  const requestOrder: string[] = []
  let generation: { id: number; host: { home: string } } | undefined = {
    id: 1,
    host: { home: '/tmp' },
  }
  const generationListeners = new Set<() => void>()
  const snapshotSource = options.snapshot ?? (() => Promise.resolve({
    ok: true as const,
    value: status(),
  }))
  const snapshotGate = vi.fn((signal?: AbortSignal) => {
    requestOrder.push('status')
    return snapshotSource(signal)
  })
  const activitySource = options.activity ?? (() => Promise.resolve({
    ok: true as const,
    value: emptyActivity(),
  }))
  const activityGate = vi.fn((_filter: unknown, signal?: AbortSignal) => {
    requestOrder.push('activity')
    return activitySource(signal)
  })
  const projectStartSource = options.projectStart ?? (() => Promise.resolve({
    ok: true as const,
    value: emptyProjectStart(),
  }))
  const projectStartGate = vi.fn((_filter: unknown, signal?: AbortSignal) => {
    requestOrder.push('projects')
    return projectStartSource(signal)
  })
  const projectTeamGate = vi.fn((query: { projectId: string }) => {
    requestOrder.push('team')
    return Promise.resolve({
      ok: true as const,
      value: {
        projectId: query.projectId,
        teamRevision: 0,
        members: [],
        responsibility: null,
      },
    })
  })
  const reviewCenterGate = vi.fn((filter: { projectId: string }) => {
    requestOrder.push('review')
    return Promise.resolve({
      ok: true as const,
      value: emptyReviewCenter(filter.projectId),
    })
  })
  const projectTasksGate = vi.fn((query: { projectId: string }) => {
    requestOrder.push('tasks')
    return Promise.resolve({
      ok: true as const,
      value: unboundProjectTasks(query.projectId),
    })
  })
  const projectMilestonesGate = vi.fn((query: { projectId: string }) => {
    requestOrder.push('milestones')
    return Promise.resolve({
      ok: true as const,
      value: unboundProjectMilestones(query.projectId),
    })
  })
  const feishuConnectionCenterGate = vi.fn((_signal?: AbortSignal) => {
    requestOrder.push('feishu')
    return Promise.resolve({
      ok: true as const,
      value: unconfiguredFeishuCenter(),
    })
  })
  const authStateSource = options.authState ?? (() => Promise.resolve({
    ok: true as const,
    value: signedIn(),
  }))
  const authStateGate = vi.fn((signal?: AbortSignal) => {
    requestOrder.push('auth')
    return authStateSource(signal)
  })
  const auth: OwnerAuthHttp = {
    state: authStateGate,
    initialize: vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'unavailable' as const },
    })),
    login: vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'invalid-credentials' as const },
    })),
    logout: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { state: 'signed-out' as const },
    })),
  }

  class RemoteService extends Service {
    readonly disposeMount = vi.fn(async () => {
      order.push('remote')
      expect(ctx.slots.entries('conversation')).toHaveLength(0)
    })
    readonly mount = vi.fn(async (_contribution: TypertRemoteContribution) => this.disposeMount)

    constructor(serviceContext: Context) {
      super(serviceContext, 'remote')
    }

    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
      return this.mount(contribution)
    }
  }

  const remote = new RemoteService(ctx)
  ctx.provide('remote.workbench', {
    snapshot: snapshotGate,
    setStatus: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        ok: true as const,
        value: status(),
        receipt: {
          commandId: 'command-browser-1',
          auditEventId: 'audit-browser-1',
          outboxId: 'outbox-browser-1',
        },
      },
    })),
    activity: activityGate,
    auditIntegrity: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        valid: true,
        eventCount: 0,
        headHash: `sha256:${'0'.repeat(64)}`,
        issue: null,
      },
    })),
    projectStart: projectStartGate,
    createProject: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        ok: false as const,
        error: { code: 'idempotency-conflict' as const, message: 'unused' },
      },
    })),
    project: vi.fn(() => Promise.resolve({ ok: true as const, value: projectDetail() })),
    projectTeam: projectTeamGate,
    addProjectMember: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    setProjectMemberStatus: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    setProjectResponsibility: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    reviewCenter: reviewCenterGate,
    proposeProjectResponsibilityChange: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    decideSuggestedChange: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    feishuConnectionCenter: feishuConnectionCenterGate,
    configureFeishuIdentityRoute: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    verifyFeishuIdentityRoute: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    projectTasks: projectTasksGate,
    discoverFeishuTaskLists: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        projectId: 'project-1', connectionRevision: 0, kind: 'bot' as const,
        routeGeneration: 1, items: [],
      },
    })),
    bindFeishuTaskList: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    reconcileProjectTasks: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'task-list-unbound' as const, message: 'unused' } },
    })),
    referenceFeishuTask: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    updateFeishuTask: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    discoverFeishuTaskWorkflowFields: vi.fn(request => Promise.resolve({
      ok: true as const,
      value: {
        projectId: request.projectId, taskListGuid: 'list-unused',
        taskRevision: request.expectedTaskRevision, items: [],
      },
    })),
    previewFeishuTaskWorkflow: vi.fn(request => Promise.resolve({
      ok: true as const,
      value: {
        projectId: request.projectId, taskRevision: request.expectedTaskRevision,
        workflowRevision: request.expectedWorkflowRevision, definition: request.definition,
        mapping: request.mapping, compatibility: { state: 'compatible' as const, issues: [] },
        usedStateIds: [],
      },
    })),
    configureFeishuTaskWorkflow: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'idempotency-conflict' as const, message: 'unused' } },
    })),
    discoverFeishuCalendars: vi.fn(request => Promise.resolve({
      ok: true as const,
      value: {
        projectId: request.projectId,
        connectionRevision: request.expectedConnectionRevision,
        kind: request.kind,
        routeGeneration: request.expectedRouteGeneration,
        items: [],
      },
    })),
    bindProjectCalendar: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'calendar-not-selectable' as const, message: 'unused' } },
    })),
    discoverFeishuCalendarEvents: vi.fn(request => Promise.resolve({
      ok: true as const,
      value: {
        projectId: request.projectId,
        revision: request.expectedRevision,
        calendarId: 'calendar-unused',
        items: [],
      },
    })),
    getProjectMilestones: projectMilestonesGate,
    createProjectMilestone: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'calendar-unbound' as const, message: 'unused' } },
    })),
    updateProjectMilestoneDate: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'calendar-unbound' as const, message: 'unused' } },
    })),
    reconcileProjectCalendar: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: false as const, error: { code: 'calendar-unbound' as const, message: 'unused' } },
    })),
  })
  ctx.provide('connection', {
    isLoopback: true,
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        generationListeners.add(listener)
        return () => { generationListeners.delete(listener) }
      },
    },
  } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const disposeLayout = ctx.slots.register({
    name: 'root',
    children: {
      conversation: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, (() => null) as never)

  if (options.registrationFailure === true) {
    vi.spyOn(ctx.slots, 'register').mockImplementationOnce(() => {
      throw new Error('Workbench slot registration failed')
    })
  }

  const fiber = options.registrationFailure === true
    ? undefined
    : ctx.plugin({
      inject: [...browserInject],
      apply: clientContext => mountWorkbenchClient(clientContext, REMOTE, auth),
    })
  if (fiber !== undefined) await fiber.await()

  return {
    ctx,
    fiber,
    remote,
    order,
    requestOrder,
    snapshotGate,
    activityGate,
    projectStartGate,
    projectTeamGate,
    reviewCenterGate,
    projectTasksGate,
    projectMilestonesGate,
    feishuConnectionCenterGate,
    authStateGate,
    auth,
    disposeLayout,
    disconnect() {
      generation = undefined
      for (const listener of generationListeners) listener()
    },
    reconnect() {
      generation = { id: 2, host: { home: '/tmp' } }
      for (const listener of generationListeners) listener()
      ctx.emit('connection/reset')
    },
  }
}

describe('Project Workbench browser plugin lifecycle', () => {
  it('mounts Remote first and registers a disposable -100 conversation replacement, never root', async () => {
    const b = await bench()
    expect(browserInject).toEqual(['remote'])
    expect(uiInject).toEqual(['remote.workbench', 'slots', 'locale', 'connection'])
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.mount).toHaveBeenCalledWith(REMOTE)

    const entries = b.ctx.slots.entries('conversation')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      component: OwnerPage,
      options: { priority: WORKBENCH_SLOT_PRIORITY },
      locale: 'workbench',
    })
    expect(b.ctx.slots.entries('root')).toHaveLength(1)
    const injected = (entries[0]?.inject as (() => { controller: OwnerController }))()
    await vi.waitFor(() => {
      const owner = injected.controller.getSnapshot()
      expect(owner).toMatchObject({ phase: 'authenticated', access: signedIn() })
      expect(owner.status?.getSnapshot()).toMatchObject({ phase: 'value', snapshot: status() })
      expect(owner.projects?.getSnapshot()).toMatchObject({ phase: 'ready', start: emptyProjectStart() })
      expect(owner.feishuConnection?.getSnapshot()).toMatchObject({
        phase: 'ready',
        center: { bot: { state: 'unconfigured' }, user: { state: 'unconfigured' } },
      })
    })
    const feishuConnection = injected.controller.getSnapshot().feishuConnection
    expect(b.requestOrder).toEqual(['auth', 'status', 'projects', 'feishu', 'activity'])

    await b.fiber?.dispose()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
    expect(b.order).toEqual(['remote'])
    expect(feishuConnection?.getSnapshot()).toMatchObject({ phase: 'loading', center: null })

    const replacement = b.ctx.plugin({
      inject: [...browserInject],
      apply: clientContext => mountWorkbenchClient(clientContext, REMOTE, b.auth),
    })
    await replacement.await()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(1)
    expect(b.remote.mount).toHaveBeenCalledTimes(2)
    await replacement.dispose()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
    expect(b.remote.disposeMount).toHaveBeenCalledTimes(2)
    expect(b.order).toEqual(['remote', 'remote'])
  })

  it('marks the last projection stale on disconnect and refreshes on connection/reset', async () => {
    const b = await bench()
    const entry = b.ctx.slots.entries('conversation')[0]
    const controller = (entry?.inject as (() => { controller: OwnerController }))().controller
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('authenticated') })
    const statusController = controller.getSnapshot().status
    const projectController = controller.getSnapshot().projects
    const activityController = controller.getSnapshot().activity
    const feishuConnectionController = controller.getSnapshot().feishuConnection
    expect(statusController).not.toBeNull()
    expect(activityController).not.toBeNull()
    expect(projectController).not.toBeNull()
    expect(feishuConnectionController).not.toBeNull()

    b.disconnect()
    expect(statusController?.getSnapshot()).toMatchObject({ phase: 'stale', snapshot: status() })
    expect(activityController?.getSnapshot()).toMatchObject({
      phase: 'stale',
      activity: emptyActivity(),
    })
    expect(projectController?.getSnapshot()).toMatchObject({
      phase: 'stale',
      start: emptyProjectStart(),
    })
    expect(feishuConnectionController?.getSnapshot()).toMatchObject({
      phase: 'stale',
      center: unconfiguredFeishuCenter(),
    })
    b.requestOrder.length = 0
    b.reconnect()
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({ phase: 'authenticated' })
      expect(statusController?.getSnapshot()).toMatchObject({ phase: 'value', snapshot: status() })
      expect(activityController?.getSnapshot()).toMatchObject({
        phase: 'ready',
        activity: emptyActivity(),
      })
      expect(projectController?.getSnapshot()).toMatchObject({
        phase: 'ready',
        start: emptyProjectStart(),
      })
      expect(feishuConnectionController?.getSnapshot()).toMatchObject({
        phase: 'ready',
        center: unconfiguredFeishuCenter(),
      })
    })
    expect(b.requestOrder).toEqual(['auth', 'status', 'projects', 'feishu', 'activity'])
    expect(b.authStateGate).toHaveBeenCalledTimes(2)
    expect(b.snapshotGate).toHaveBeenCalledTimes(2)
    expect(b.activityGate).toHaveBeenCalledTimes(2)
    expect(b.projectStartGate).toHaveBeenCalledTimes(2)
    expect(b.feishuConnectionCenterGate).toHaveBeenCalledTimes(2)
    await b.fiber?.dispose()
  })

  it('preserves same-Project Team/Review/Task/Milestone state across reconnect and clears it on Fiber disposal', async () => {
    const b = await bench()
    const entry = b.ctx.slots.entries('conversation')[0]
    const controller = (entry?.inject as (() => { controller: OwnerController }))().controller
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('authenticated') })
    const projects = controller.getSnapshot().projects
    const projectTeam = controller.getSnapshot().projectTeam
    const review = controller.getSnapshot().review
    const projectTasks = controller.getSnapshot().projectTasks
    const projectMilestones = controller.getSnapshot().projectMilestones
    expect(projects).not.toBeNull()
    expect(projectTeam).not.toBeNull()
    expect(review).not.toBeNull()
    expect(projectTasks).not.toBeNull()
    expect(projectMilestones).not.toBeNull()

    await projects?.openProject('project-1')
    await vi.waitFor(() => {
      expect(projectTeam?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      })
      expect(review?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      })
      expect(projectTasks?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1', projectName: 'Evidence Project' },
        projection: { projectId: 'project-1', binding: null },
      })
      expect(projectMilestones?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1', projectName: 'Evidence Project' },
        projection: { projectId: 'project-1', binding: null },
      })
    })
    projectTeam?.setMemberKind('agent')
    projectTeam?.setMemberDisplayName('Reconnect-safe Agent')
    expect(projectTeam?.getSnapshot()).toMatchObject({
      memberDraft: { kind: 'agent', displayName: 'Reconnect-safe Agent' },
      memberDraftDirty: true,
    })
    review?.setProposalAccountable('protected-member')
    expect(review?.getSnapshot()).toMatchObject({
      proposalDraft: { accountableMemberId: 'protected-member' },
      proposalDraftDirty: true,
    })

    b.disconnect()
    expect(projectTeam?.getSnapshot()).toMatchObject({
      phase: 'stale',
      memberDraft: { kind: 'agent', displayName: 'Reconnect-safe Agent' },
      memberDraftDirty: true,
    })
    expect(review?.getSnapshot()).toMatchObject({
      phase: 'disconnected',
      proposalDraft: { accountableMemberId: 'protected-member' },
      proposalDraftDirty: true,
    })
    expect(projectTasks?.getSnapshot()).toMatchObject({
      phase: 'stale',
      projection: { projectId: 'project-1', binding: null },
    })
    expect(projectMilestones?.getSnapshot()).toMatchObject({
      phase: 'stale',
      projection: { projectId: 'project-1', binding: null },
    })
    b.requestOrder.length = 0
    b.reconnect()
    await vi.waitFor(() => {
      expect(projectTeam?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1' },
        memberDraft: { kind: 'agent', displayName: 'Reconnect-safe Agent' },
        memberDraftDirty: true,
      })
      expect(review?.getSnapshot()).toMatchObject({
        phase: 'ready',
        proposalDraft: { accountableMemberId: 'protected-member' },
        proposalDraftDirty: true,
      })
      expect(projectTasks?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1' },
        projection: { projectId: 'project-1', binding: null },
      })
      expect(projectMilestones?.getSnapshot()).toMatchObject({
        phase: 'ready',
        selection: { projectId: 'project-1' },
        projection: { projectId: 'project-1', binding: null },
      })
    })
    expect(b.requestOrder).toEqual([
      'auth', 'status', 'projects', 'team', 'review', 'feishu', 'tasks', 'milestones', 'activity',
    ])
    expect(b.projectTeamGate).toHaveBeenCalledTimes(2)
    expect(b.reviewCenterGate).toHaveBeenCalledTimes(2)
    expect(b.projectTasksGate).toHaveBeenCalledTimes(2)
    expect(b.projectMilestonesGate).toHaveBeenCalledTimes(2)

    await b.fiber?.dispose()
    expect(projectTeam?.getSnapshot()).toMatchObject({
      phase: 'idle',
      selection: null,
      team: null,
      memberDraft: { kind: 'human', displayName: '' },
      memberDraftDirty: false,
    })
    expect(review?.getSnapshot()).toMatchObject({
      phase: 'idle',
      selection: null,
      review: null,
      proposalDraftDirty: false,
      decisionDrafts: {},
    })
    expect(projectTasks?.getSnapshot()).toMatchObject({
      phase: 'idle', selection: null, projection: null,
    })
    expect(projectMilestones?.getSnapshot()).toMatchObject({
      phase: 'idle', selection: null, projection: null,
    })
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('rechecks projected expiry on focus and removes the browser listener on disposal', async () => {
    const check = vi.spyOn(OwnerController.prototype, 'checkSessionExpiry')
    const b = await bench()
    await vi.waitFor(() => { expect(b.snapshotGate).toHaveBeenCalledOnce() })
    const beforeFocus = check.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    expect(check.mock.calls.length).toBeGreaterThan(beforeFocus)
    const afterFocus = check.mock.calls.length

    await b.fiber?.dispose()
    window.dispatchEvent(new Event('focus'))
    expect(check.mock.calls.length).toBe(afterFocus)
    check.mockRestore()
  })

  it('rolls back the mounted Remote when later Slot setup fails', async () => {
    const b = await bench({ registrationFailure: true })
    await expect(mountWorkbenchClient(b.ctx, REMOTE, b.auth)).rejects.toThrow('Workbench slot registration failed')
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
  })

  it('drains an aborted UI snapshot before withdrawing the Remote namespace', async () => {
    const order: string[] = []
    let signal: AbortSignal | undefined
    const b = await bench({
      snapshot: currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          order.push('snapshot-settled')
          reject(currentSignal.reason)
        }, { once: true })
      }),
    })
    b.remote.disposeMount.mockImplementationOnce(async () => {
      order.push('remote')
      expect(signal?.aborted).toBe(true)
    })

    await vi.waitFor(() => { expect(signal).toBeInstanceOf(AbortSignal) })

    await b.fiber?.dispose()

    expect(order).toEqual(['snapshot-settled', 'remote'])
  })

  it('drains an aborted auth probe before withdrawing the Remote namespace', async () => {
    const order: string[] = []
    let signal: AbortSignal | undefined
    const b = await bench({
      authState: currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          order.push('auth-settled')
          reject(currentSignal.reason)
        }, { once: true })
      }),
    })
    b.remote.disposeMount.mockImplementationOnce(async () => {
      order.push('remote')
      expect(signal?.aborted).toBe(true)
    })
    await vi.waitFor(() => { expect(signal).toBeInstanceOf(AbortSignal) })

    await b.fiber?.dispose()

    expect(order).toEqual(['auth-settled', 'remote'])
    expect(b.snapshotGate).not.toHaveBeenCalled()
    expect(b.activityGate).not.toHaveBeenCalled()
    expect(b.projectStartGate).not.toHaveBeenCalled()
  })

  it('drains an aborted Activity request before withdrawing the Remote namespace', async () => {
    const order: string[] = []
    let signal: AbortSignal | undefined
    const b = await bench({
      activity: currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          order.push('activity-settled')
          reject(currentSignal.reason)
        }, { once: true })
      }),
    })
    b.remote.disposeMount.mockImplementationOnce(async () => {
      order.push('remote')
      expect(signal?.aborted).toBe(true)
    })
    await vi.waitFor(() => { expect(signal).toBeInstanceOf(AbortSignal) })

    await b.fiber?.dispose()

    expect(order).toEqual(['activity-settled', 'remote'])
  })

  it('drains an aborted Project catalog request before withdrawing the Remote namespace', async () => {
    const order: string[] = []
    let signal: AbortSignal | undefined
    const b = await bench({
      projectStart: currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          order.push('projects-settled')
          reject(currentSignal.reason)
        }, { once: true })
      }),
    })
    b.remote.disposeMount.mockImplementationOnce(async () => {
      order.push('remote')
      expect(signal?.aborted).toBe(true)
    })
    await vi.waitFor(() => { expect(signal).toBeInstanceOf(AbortSignal) })

    await b.fiber?.dispose()

    expect(order).toEqual(['projects-settled', 'remote'])
  })

  it('removes the styles owned by the disposed Client Fiber', async () => {
    const tagId = '@benz-ai-x/dsh-project-workbench-client/FiberFixture.module.css'
    registerWorkbenchStyle(tagId, '.fixture{display:block}')
    const b = await bench()
    expect(document.querySelector(`style[data-plugin-css="${tagId}"]`)).not.toBeNull()

    await b.fiber?.dispose()

    expect(document.querySelector(`style[data-plugin-css="${tagId}"]`)).toBeNull()
  })

  it('keeps the Node half named-only and the manifest discoverable as a web Client package', async () => {
    expect(() => { nodePlugin.apply() }).not.toThrow()
    expect('default' in nodePlugin).toBe(false)

    const packageRoot = basename(process.cwd()) === 'workbench-client'
      ? process.cwd()
      : resolve(process.cwd(), 'packages/workbench-client')
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      private?: boolean
      exports?: Record<string, unknown>
      dsh?: { client?: { platform?: string; inject?: string[] } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.dsh?.client).toMatchObject({
      platform: 'web',
      inject: expect.arrayContaining([
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-connection',
        '@deepseek-ai/dsh-client-ui-layout',
      ]),
    })

    const config = await readFile(resolve(packageRoot, 'tsdown.client.config.ts'), 'utf8')
    expect(config).toContain('window.__ModuleLoader__.load')
    expect(config).toContain('factory: (require) =>')
    expect(config).toContain('registerWorkbenchStyle(tagId, css)')
    expect(config).not.toContain("from '../deepseek-harness")
  })
})
