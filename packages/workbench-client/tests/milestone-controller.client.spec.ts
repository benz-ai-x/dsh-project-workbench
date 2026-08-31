import type {
  FeishuCalendarDiscoveryProjection,
  FeishuCalendarEventDiscoveryProjection,
  ProjectCalendarSchedule,
  ProjectMilestoneProjection,
  ProjectMilestonesProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE,
  WorkbenchProjectMilestonesController,
  type WorkbenchProjectMilestonesRemote,
} from '../src/client/milestone-controller.ts'

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

const allDay: ProjectCalendarSchedule = {
  kind: 'all-day', startDate: '2026-09-08', endDate: '2026-09-09',
}

function milestone(
  overrides: Partial<ProjectMilestoneProjection> = {},
): ProjectMilestoneProjection {
  return {
    milestoneId: 'milestone-1',
    name: 'Research sign-off',
    description: 'Confirm the source-backed recommendation.',
    eventId: 'event-1',
    eventAppLink: 'https://applink.feishu.cn/client/calendar/event/detail?eventId=event-1',
    schedule: allDay,
    remoteStatus: 'confirmed',
    remoteObservationVersion: 'calendar-observation-v1',
    syncState: 'healthy',
    revision: 1,
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    lastObservedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  }
}

function projection(
  projectId = 'project-1',
  overrides: Partial<ProjectMilestonesProjection> = {},
): ProjectMilestonesProjection {
  return {
    projectId,
    revision: 3,
    binding: {
      calendarId: 'calendar-1',
      summary: 'Evidence calendar',
      calendarType: 'shared',
      role: 'owner',
      identity: {
        kind: 'bot', routeGeneration: 4, appId: 'cli-app', openId: 'ou-bot', tenantKey: 'tenant-1',
      },
      createdByWorkbench: false,
      revision: 1,
      boundAt: '2026-08-31T11:00:00.000Z',
    },
    milestones: [milestone()],
    sync: {
      state: 'healthy', lastEventAt: null,
      lastReconciledAt: '2026-08-31T12:00:00.000Z',
      lastAttemptAt: '2026-08-31T12:00:00.000Z', issue: null,
    },
    effects: [],
    recentChanges: [{
      changeId: 'change-1', projectRevision: 3, milestoneId: 'milestone-1', milestoneRevision: 1,
      source: 'workbench', changedFields: ['schedule'], beforeSchedule: null,
      afterSchedule: allDay, occurredAt: '2026-08-31T12:00:00.000Z',
    }],
    ...overrides,
  }
}

function unbound(projectId = 'project-1'): ProjectMilestonesProjection {
  return projection(projectId, {
    revision: 0,
    binding: null,
    milestones: [],
    sync: {
      state: 'unbound', lastEventAt: null, lastReconciledAt: null, lastAttemptAt: null, issue: null,
    },
    recentChanges: [],
  })
}

function calendarDiscovery(): FeishuCalendarDiscoveryProjection {
  return {
    projectId: 'project-1', connectionRevision: 8, kind: 'bot', routeGeneration: 4,
    items: [{
      calendarId: 'calendar-1', summary: 'Evidence calendar', description: 'Formal dates',
      calendarType: 'shared', role: 'owner', deleted: false, thirdParty: false, selectable: true,
    }],
  }
}

function eventDiscovery(): FeishuCalendarEventDiscoveryProjection {
  return {
    projectId: 'project-1', revision: 3, calendarId: 'calendar-1',
    items: [{
      eventId: 'event-existing', summary: 'External checkpoint', description: null,
      schedule: allDay, remoteStatus: 'confirmed', recurring: false, exception: false,
      organizerMatchesCalendar: true,
      eventAppLink: 'https://applink.feishu.cn/client/calendar/event/detail?eventId=event-existing',
      remoteObservationVersion: 'calendar-event-existing-v1', selectable: true,
    }],
  }
}

function makeRemote(
  overrides: Partial<WorkbenchProjectMilestonesRemote> = {},
): WorkbenchProjectMilestonesRemote {
  return {
    getProjectMilestones: overrides.getProjectMilestones
      ?? vi.fn(query => Promise.resolve(remoteOk(unbound(query.projectId)))),
    discoverFeishuCalendars: overrides.discoverFeishuCalendars
      ?? vi.fn(() => Promise.resolve(remoteOk(calendarDiscovery()))),
    bindProjectCalendar: overrides.bindProjectCalendar ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection('project-1', { revision: 1, milestones: [], recentChanges: [] }),
      receipt: { commandId: 'command-bind', auditEventId: 'audit-bind', outboxId: 'outbox-bind' },
    }))),
    discoverFeishuCalendarEvents: overrides.discoverFeishuCalendarEvents
      ?? vi.fn(() => Promise.resolve(remoteOk(eventDiscovery()))),
    createProjectMilestone: overrides.createProjectMilestone ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection(),
      milestone: milestone(),
      effect: null,
      receipt: { commandId: 'command-create', auditEventId: 'audit-create', outboxId: 'outbox-create' },
    }))),
    updateProjectMilestoneDate: overrides.updateProjectMilestoneDate
      ?? vi.fn(() => Promise.resolve(remoteOk({
        ok: true as const,
        value: projection('project-1', {
          revision: 4,
          milestones: [milestone({
            schedule: { kind: 'all-day', startDate: '2026-09-09', endDate: '2026-09-10' },
            remoteObservationVersion: 'calendar-observation-v2', revision: 2,
          })],
        }),
        milestone: milestone({ revision: 2, remoteObservationVersion: 'calendar-observation-v2' }),
        effect: {
          effectId: 'effect-update', operation: 'event-date-update', milestoneId: 'milestone-1',
          state: 'delivered' as const,
          createdAt: '2026-08-31T12:05:00.000Z', updatedAt: '2026-08-31T12:05:00.000Z',
        },
        receipt: { commandId: 'command-update', auditEventId: 'audit-update', outboxId: 'outbox-update' },
      }))),
    reconcileProjectCalendar: overrides.reconcileProjectCalendar
      ?? vi.fn(() => Promise.resolve(remoteOk({ ok: true as const, value: projection() }))),
  }
}

describe('WorkbenchProjectMilestonesController', () => {
  it('reads one Project schedule and erases it at the Project identity boundary', async () => {
    const read = vi.fn(query => Promise.resolve(remoteOk(unbound(query.projectId))))
    const controller = new WorkbenchProjectMilestonesController(makeRemote({
      getProjectMilestones: read,
    }))

    await controller.selectProject('project-1', 'Evidence Project')

    expect(read).toHaveBeenCalledWith({ projectId: 'project-1' }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      projection: { projectId: 'project-1', binding: null },
    })

    controller.clearSelection()
    expect(controller.getSnapshot()).toEqual(INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE)
    await controller.dispose()
  })

  it('discovers and binds a selectable calendar through the exact verified route', async () => {
    const bind = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: projection('project-1', { revision: 1, milestones: [], recentChanges: [] }),
      receipt: { commandId: 'command-bind', auditEventId: 'audit-bind', outboxId: 'outbox-bind' },
    })))
    const keys = ['idem-bind', 'cause-bind']
    const committed = vi.fn()
    const controller = new WorkbenchProjectMilestonesController(makeRemote({
      bindProjectCalendar: bind,
    }), {
      nextCommandKey: () => keys.shift() ?? 'unexpected',
      onCommitted: committed,
    })
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.discoverCalendars('bot', 8, 4)
    const candidate = controller.getSnapshot().calendarDiscovery?.items[0]
    if (candidate === undefined) throw new Error('calendar candidate missing')

    await controller.bindExisting(candidate)

    expect(bind).toHaveBeenCalledWith({
      projectId: 'project-1', kind: 'bot', expectedConnectionRevision: 8,
      expectedRouteGeneration: 4, expectedBindingRevision: null,
      mode: 'existing', calendarId: 'calendar-1',
      idempotencyKey: 'idem-bind', causationId: 'cause-bind', reason: 'owner-project-calendar-bind',
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', projection: { binding: { calendarId: 'calendar-1' } },
      calendarDiscovery: null,
    })
    expect(committed).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('creates from an existing event and creates a new authoritative timed event', async () => {
    const create = vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const, value: projection(), milestone: milestone(), effect: null,
      receipt: { commandId: 'command-create', auditEventId: 'audit-create', outboxId: 'outbox-create' },
    })))
    const keys = ['idem-existing', 'cause-existing', 'idem-new', 'cause-new']
    const controller = new WorkbenchProjectMilestonesController(makeRemote({
      getProjectMilestones: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      createProjectMilestone: create,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.discoverEvents()
    const candidate = controller.getSnapshot().eventDiscovery?.items[0]
    if (candidate === undefined) throw new Error('event candidate missing')

    await controller.createFromExistingEvent('External sign-off', 'Provider event retained', candidate)
    await controller.createWithEvent('Launch review', null, {
      kind: 'timed',
      startAt: '2026-09-10T09:00:00+08:00',
      endAt: '2026-09-10T10:00:00+08:00',
      timeZone: 'Asia/Shanghai',
    })

    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      mode: 'existing-event', eventId: 'event-existing', expectedRevision: 3,
      expectedMilestoneRevision: null, name: 'External sign-off',
      idempotencyKey: 'idem-existing', causationId: 'cause-existing',
    }), expect.any(AbortSignal))
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      mode: 'create-event',
      schedule: {
        kind: 'timed', startAt: '2026-09-10T09:00:00+08:00',
        endAt: '2026-09-10T10:00:00+08:00', timeZone: 'Asia/Shanghai',
      },
      idempotencyKey: 'idem-new', causationId: 'cause-new',
    }), expect.any(AbortSignal))
    await controller.dispose()
  })

  it('carries all three versions for date changes and never retries a provider-unknown fact', async () => {
    const update = vi.fn(() => Promise.resolve(remoteOk({
      ok: false as const,
      error: {
        code: 'remote-outcome-unknown' as const,
        message: 'sensitive provider detail must not enter client state',
        current: projection('project-1', {
          effects: [{
            effectId: 'effect-unknown', operation: 'event-date-update', milestoneId: 'milestone-1',
            state: 'unknown', createdAt: '2026-08-31T12:05:00.000Z',
            updatedAt: '2026-08-31T12:05:00.000Z',
          }],
        }),
      },
    })))
    const keys = ['idem-update', 'cause-update']
    const controller = new WorkbenchProjectMilestonesController(makeRemote({
      getProjectMilestones: vi.fn(() => Promise.resolve(remoteOk(projection()))),
      updateProjectMilestoneDate: update,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1', 'Evidence Project')

    await controller.updateDate(milestone(), {
      kind: 'all-day', startDate: '2026-09-09', endDate: '2026-09-10',
    })

    expect(update).toHaveBeenCalledWith({
      projectId: 'project-1', milestoneId: 'milestone-1', expectedRevision: 3,
      expectedMilestoneRevision: 1,
      expectedRemoteObservationVersion: 'calendar-observation-v1',
      schedule: { kind: 'all-day', startDate: '2026-09-09', endDate: '2026-09-10' },
      idempotencyKey: 'idem-update', causationId: 'cause-update',
      reason: 'owner-project-milestone-date-update',
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      issue: { kind: 'conflict', code: 'remote-outcome-unknown', operation: 'update-date' },
      canRetryMutation: false,
      projection: { effects: [{ state: 'unknown' }] },
    })
    await controller.retryMutation()
    expect(update).toHaveBeenCalledOnce()
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('sensitive provider detail')
    await controller.dispose()
  })

  it('retains only an exact browser-ambiguous mutation envelope and clears it on disconnect disposal', async () => {
    const bind = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('raw browser failure'), { code: 'transport-failure' }))
      .mockResolvedValueOnce(remoteOk({
        ok: true as const,
        value: projection('project-1', { revision: 1, milestones: [], recentChanges: [] }),
        receipt: { commandId: 'command-bind', auditEventId: 'audit-bind', outboxId: 'outbox-bind' },
      }))
    const keys = ['idem-bind', 'cause-bind']
    const controller = new WorkbenchProjectMilestonesController(makeRemote({
      bindProjectCalendar: bind,
    }), { nextCommandKey: () => keys.shift() ?? 'unexpected' })
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.discoverCalendars('bot', 8, 4)

    await controller.createAndBind('New formal calendar', 'Created for this Project')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', canRetryMutation: true,
      issue: { kind: 'transport', code: 'transport-failure', operation: 'bind-calendar' },
    })
    await controller.retryMutation()
    expect(bind.mock.calls[1]?.[0]).toEqual(bind.mock.calls[0]?.[0])

    controller.markDisconnected()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stale', calendarDiscovery: null, eventDiscovery: null,
    })
    await controller.dispose()
    expect(controller.getSnapshot()).toEqual(INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE)
  })
})
