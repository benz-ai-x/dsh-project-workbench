// @vitest-environment jsdom

import type {
  FeishuConnectionCenterProjection,
  ProjectCalendarSchedule,
  ProjectMilestonesProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE,
  type WorkbenchFeishuConnectionClientState,
  type WorkbenchFeishuConnectionController,
} from '../src/client/feishu-connection-controller.ts'
import {
  INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE,
  type WorkbenchProjectMilestonesClientState,
  type WorkbenchProjectMilestonesController,
} from '../src/client/milestone-controller.ts'
import { en, type WorkbenchKey } from '../src/client/locales.ts'
import { ProjectMilestonesPanel } from '../src/client/ProjectMilestonesPanel.tsx'

const t = (key: WorkbenchKey): string => en[key]
const allDay: ProjectCalendarSchedule = {
  kind: 'all-day', startDate: '2026-09-08', endDate: '2026-09-09',
}

afterEach(() => { cleanup() })

function verifiedCenter(): FeishuConnectionCenterProjection {
  return {
    connectionId: 'feishu-primary',
    realm: 'feishu-cn',
    revision: 8,
    bot: {
      kind: 'bot', state: 'configured', generation: 4, appId: 'cli-app',
      credential: { ref: 'FEISHU_BOT', configured: true, source: 'env', writable: false },
      actor: {
        connectionId: 'feishu-primary', realm: 'feishu-cn', appId: 'cli-app', kind: 'bot',
        routeGeneration: 4, openId: 'ou-bot', tenantKey: 'tenant-1',
      },
      displayLabel: 'Project Bot',
      lastVerification: {
        verificationId: 'verification-1', sequence: 1, routeGeneration: 4,
        checkedAt: '2026-08-31T12:00:00.000Z', result: 'healthy',
        identity: { state: 'verified', issue: null },
        scopeInspection: { state: 'observed', scopes: [], issue: null },
        resourceProbe: { state: 'not-tested' },
      },
    },
    user: {
      kind: 'user', state: 'unconfigured', generation: null, appId: null,
      credential: { ref: null, configured: false, source: null, writable: false },
      actor: null, displayLabel: null, lastVerification: null,
    },
    updatedAt: '2026-08-31T12:00:00.000Z',
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

function unboundState(
  overrides: Partial<WorkbenchProjectMilestonesClientState> = {},
): WorkbenchProjectMilestonesClientState {
  return {
    ...INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE,
    phase: 'ready',
    selection: { projectId: 'project-1', projectName: 'Evidence Project' },
    projection: {
      projectId: 'project-1', revision: 0, binding: null, milestones: [],
      sync: {
        state: 'unbound', lastEventAt: null, lastReconciledAt: null, lastAttemptAt: null, issue: null,
      },
      effects: [], recentChanges: [],
    },
    ...overrides,
  }
}

function boundProjection(): ProjectMilestonesProjection {
  return {
    projectId: 'project-1', revision: 4,
    binding: {
      calendarId: 'calendar-1', summary: 'Evidence calendar', calendarType: 'shared', role: 'owner',
      identity: {
        kind: 'bot', routeGeneration: 4, appId: 'cli-app', openId: 'ou-bot', tenantKey: 'tenant-1',
      },
      createdByWorkbench: true, revision: 1, boundAt: '2026-08-31T11:00:00.000Z',
    },
    milestones: [{
      milestoneId: 'milestone-1', name: 'Research sign-off',
      description: 'Confirm the source-backed recommendation.', eventId: 'event-1',
      eventAppLink: 'https://applink.feishu.cn/client/calendar/event/detail?eventId=event-1',
      schedule: allDay, remoteStatus: 'confirmed',
      remoteObservationVersion: 'calendar-observation-v1', syncState: 'attention', revision: 2,
      createdAt: '2026-08-31T12:00:00.000Z', updatedAt: '2026-08-31T12:05:00.000Z',
      lastObservedAt: '2026-08-31T12:05:00.000Z',
    }],
    sync: {
      state: 'attention', lastEventAt: '2026-08-31T12:04:00.000Z',
      lastReconciledAt: '2026-08-31T12:05:00.000Z',
      lastAttemptAt: '2026-08-31T12:05:00.000Z', issue: null,
    },
    effects: [{
      effectId: 'effect-unknown', operation: 'event-date-update', milestoneId: 'milestone-1',
      state: 'unknown', createdAt: '2026-08-31T12:03:00.000Z',
      updatedAt: '2026-08-31T12:04:00.000Z',
    }],
    recentChanges: [{
      changeId: 'change-1', projectRevision: 4, milestoneId: 'milestone-1', milestoneRevision: 2,
      source: 'feishu', changedFields: ['schedule', 'remote-status'],
      beforeSchedule: { kind: 'all-day', startDate: '2026-09-07', endDate: '2026-09-08' },
      afterSchedule: allDay, occurredAt: '2026-08-31T12:04:00.000Z',
    }],
  }
}

function milestoneFace(state: WorkbenchProjectMilestonesClientState) {
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    discoverCalendars: vi.fn(),
    bindExisting: vi.fn(),
    createAndBind: vi.fn(),
    discoverEvents: vi.fn(),
    createFromExistingEvent: vi.fn(),
    createWithEvent: vi.fn(),
    updateDate: vi.fn(),
    reconcile: vi.fn(),
    retryMutation: vi.fn(),
    refresh: vi.fn(),
  }
}

describe('ProjectMilestonesPanel', () => {
  it('requires exact-route discovery and explicit irreversible confirmation before binding', () => {
    const state = unboundState({
      calendarDiscovery: {
        projectId: 'project-1', connectionRevision: 8, kind: 'bot', routeGeneration: 4,
        items: [
          {
            calendarId: 'calendar-1', summary: 'Evidence calendar', description: 'Formal dates',
            calendarType: 'shared', role: 'owner', deleted: false, thirdParty: false, selectable: true,
          },
          {
            calendarId: 'calendar-reader', summary: 'Read-only calendar', description: null,
            calendarType: 'shared', role: 'reader', deleted: false, thirdParty: false, selectable: false,
          },
        ],
      },
    })
    const controller = milestoneFace(state)
    render(<ProjectMilestonesPanel
      controller={controller as unknown as WorkbenchProjectMilestonesController}
      connectionController={connectionFace()}
      t={t}
      canManage
    />)

    expect(screen.getByRole('heading', { name: 'Project Milestones' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read accessible calendars' }))
    expect(controller.discoverCalendars).toHaveBeenCalledWith('bot', 8, 4)

    fireEvent.change(screen.getByLabelText('Existing writable calendar'), {
      target: { value: 'calendar-1' },
    })
    const bind = screen.getByRole('button', { name: 'Bind selected calendar' })
    expect(bind).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('I understand this Project calendar binding cannot be changed in T10.'))
    expect(bind).toHaveProperty('disabled', false)
    fireEvent.click(bind)
    expect(controller.bindExisting).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'calendar-1', selectable: true,
    }))
    expect(screen.getAllByText(/Read-only calendar/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Reader · Not writable/)).toBeTruthy()
  })

  it('shows authoritative dates, sync attention, canonical links, unknown safety, and Feishu changes', () => {
    const controller = milestoneFace({
      ...unboundState(),
      projection: boundProjection(),
    })
    render(<ProjectMilestonesPanel
      controller={controller as unknown as WorkbenchProjectMilestonesController}
      connectionController={connectionFace()}
      t={t}
      canManage
    />)

    expect(screen.getByText('Evidence calendar')).toBeTruthy()
    expect(screen.getByText('Research sign-off')).toBeTruthy()
    expect(screen.getAllByText('Sep 8, 2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/exclusive/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Open Research sign-off in Feishu Calendar' }))
      .toHaveProperty('href', expect.stringContaining('event-1'))
    expect(screen.getAllByText(/Unknown/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Workbench will not retry it blindly/)).toBeTruthy()
    expect(screen.getByText('Changed in Feishu')).toBeTruthy()
    expect(screen.getByText('Before')).toBeTruthy()
    expect(screen.getByText('After')).toBeTruthy()
    expect(screen.getByText('Sep 7, 2026')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile calendar now' }))
    expect(controller.reconcile).toHaveBeenCalledOnce()
  })

  it('submits explicit timed creation and confirmed all-day date edits', () => {
    const projection = boundProjection()
    const controller = milestoneFace({
      ...unboundState(),
      projection,
      eventDiscovery: {
        projectId: 'project-1', revision: 4, calendarId: 'calendar-1', items: [],
      },
    })
    render(<ProjectMilestonesPanel
      controller={controller as unknown as WorkbenchProjectMilestonesController}
      connectionController={connectionFace()}
      t={t}
      canManage
    />)

    fireEvent.change(screen.getByLabelText('Milestone name'), { target: { value: 'Launch review' } })
    fireEvent.click(screen.getByLabelText('Create a new Feishu event'))
    const createSection = screen.getByRole('heading', { name: 'Create a Milestone' }).closest('section')
    if (createSection === null) throw new Error('create section missing')
    fireEvent.click(within(createSection).getByLabelText('Timed schedule'))
    fireEvent.change(within(createSection).getByLabelText('Start (RFC 3339 with offset)'), {
      target: { value: '2026-09-10T09:00:00+08:00' },
    })
    expect(within(createSection).getByText(
      'Enter valid dates and a recognized time zone; the end must be later than the start.',
    )).toBeTruthy()
    fireEvent.change(within(createSection).getByLabelText('End (RFC 3339 with offset)'), {
      target: { value: '2026-09-10T10:00:00+08:00' },
    })
    fireEvent.change(within(createSection).getByLabelText('IANA time zone'), {
      target: { value: 'Asia/Shanghai' },
    })
    expect(within(createSection).queryByText(
      'Enter valid dates and a recognized time zone; the end must be later than the start.',
    )).toBeNull()
    fireEvent.click(within(createSection).getByRole('button', { name: 'Create Milestone and event' }))
    expect(controller.createWithEvent).toHaveBeenCalledWith('Launch review', null, {
      kind: 'timed', startAt: '2026-09-10T09:00:00+08:00',
      endAt: '2026-09-10T10:00:00+08:00', timeZone: 'Asia/Shanghai',
    })

    const card = screen.getByRole('article', { name: 'Research sign-off' })
    fireEvent.change(within(card).getByLabelText('Start date'), { target: { value: '2026-09-09' } })
    fireEvent.change(within(card).getByLabelText('Exclusive end date'), {
      target: { value: '2026-09-10' },
    })
    const update = within(card).getByRole('button', { name: 'Save authoritative date' })
    expect(update).toHaveProperty('disabled', true)
    fireEvent.click(within(card).getByLabelText(
      'I reviewed this date change; Feishu Calendar will remain authoritative.',
    ))
    fireEvent.click(update)
    expect(controller.updateDate).toHaveBeenCalledWith(projection.milestones[0], {
      kind: 'all-day', startDate: '2026-09-09', endDate: '2026-09-10',
    })
  })

  it('renders no mutation controls when the capability gate is read-only', () => {
    const controller = milestoneFace({ ...unboundState(), projection: boundProjection() })
    render(<ProjectMilestonesPanel
      controller={controller as unknown as WorkbenchProjectMilestonesController}
      connectionController={connectionFace()}
      t={t}
      canManage={false}
    />)

    expect(screen.getByText('Read-only schedule')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Research sign-off in Feishu Calendar' })).toBeTruthy()
  })
})
