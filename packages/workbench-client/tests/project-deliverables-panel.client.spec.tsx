// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ProjectDeliverableProjection,
  ProjectDeliverablesProjection,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDeliverablesPanel } from '../src/client/ProjectDeliverablesPanel.tsx'
import {
  WorkbenchProjectDeliverablesController,
  type WorkbenchProjectDeliverablesRemote,
} from '../src/client/project-deliverables-controller.ts'
import { en, zh, type WorkbenchKey } from '../src/client/locales.ts'

function ok<T>(value: T): RemoteResult<T> { return { ok: true, value } }
const receipt: WorkbenchCommandReceipt = {
  commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1',
}

function deliverable(): ProjectDeliverableProjection {
  return {
    deliverableId: 'deliverable-with-a-very-long-stable-identifier-1234567890',
    sequence: 1, revision: 1, state: 'planned',
    plan: {
      planSnapshotId: 'plan-snapshot-with-a-very-long-stable-identifier-1234567890',
      name: 'Evidence report', description: 'Inspect the research evidence.',
      criteria: [
        { criterionId: 'criterion-1', statement: 'Sources are inspectable' },
        { criterionId: 'criterion-2', statement: 'Recommendation is actionable' },
      ],
      responsibility: {
        accountable: { memberId: 'human-1', displayName: 'Owner Human', kind: 'human' },
        contributors: [], humanSponsor: null,
        acceptor: { memberId: 'human-2', displayName: 'Designated Acceptor', kind: 'human' },
      },
      taskGuids: ['task-1'], digest: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    calendar: {
      eventId: 'event-1', eventAppLink: 'https://applink.feishu.cn/event-1',
      schedule: { kind: 'all-day', startDate: '2026-09-02', endDate: '2026-09-03' },
      remoteStatus: 'confirmed', remoteObservationVersion: 'observation-1',
      syncState: 'healthy', lastObservedAt: '2026-09-01T00:00:00.000Z',
    },
    tasks: [{
      taskGuid: 'task-1', availability: 'available',
      task: {
        taskGuid: 'task-1', taskId: '1', scope: 'primary-list', parentTaskGuid: null,
        summary: 'Write evidence', description: '', assignees: [], followers: [], comments: [],
        completed: false, completedAt: null, canonicalUrl: 'https://applink.feishu.cn/task-1',
        remoteVersion: 'task-version-1', projectionRevision: 1,
      },
    }],
    acceptanceRequests: [], finalRelease: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function projection(): ProjectDeliverablesProjection {
  const item = deliverable()
  return {
    projectId: 'project-1', revision: 3, teamRevision: 4, taskRevision: 5, scheduleRevision: 6,
    calendarBinding: {
      calendarId: 'calendar-1', summary: 'Delivery dates', calendarType: 'shared', role: 'owner',
      identity: {
        kind: 'bot', routeGeneration: 1, appId: 'cli-app', openId: 'ou-bot', tenantKey: null,
      },
      createdByWorkbench: false, revision: 1, boundAt: '2026-09-01T00:00:00.000Z',
    },
    memberOptions: [
      {
        memberId: 'human-1', displayName: 'Owner Human', kind: 'human', status: 'active',
        requiresHumanSponsor: false, canBeHumanSponsor: true, canAccept: true,
      },
      {
        memberId: 'human-2', displayName: 'Designated Acceptor', kind: 'human', status: 'active',
        requiresHumanSponsor: false, canBeHumanSponsor: true, canAccept: true,
      },
    ],
    taskOptions: item.tasks.flatMap(link => link.task === null ? [] : [link.task]),
    deliverables: [item],
    activity: [{
      sequence: 1, activityId: 'deliverable-activity-1', deliverableId: item.deliverableId,
      deliverableRevision: 1, action: 'deliverable-created',
      source: { kind: 'audit-event', auditEventId: 'audit-create-1' },
      planSnapshotId: item.plan.planSnapshotId, acceptanceRequestId: null, decisionId: null,
      occurredAt: '2026-09-01T00:00:00.000Z',
    }],
    nextBeforeActivitySequence: null,
  }
}

function remote(): WorkbenchProjectDeliverablesRemote {
  return {
    projectDeliverables: vi.fn(() => Promise.resolve(ok(projection()))),
    discoverFeishuCalendarEvents: vi.fn(() => Promise.resolve(ok({
      projectId: 'project-1', revision: 6, calendarId: 'calendar-1', items: [],
    }))),
    createProjectDeliverable: vi.fn(() => Promise.resolve(ok({
      ok: true as const, value: projection(), deliverable: deliverable(), effect: null, receipt,
    }))),
    requestDeliverableAcceptance: vi.fn(() => Promise.resolve(ok({
      ok: false as const, error: { code: 'acceptance-request-pending' as const, message: 'hidden' },
    }))),
  }
}

const t = (key: WorkbenchKey): string => zh[key]

afterEach(() => { cleanup() })

describe('ProjectDeliverablesPanel', () => {
  it('makes the default Owner flow trivial while keeping existing/timed event choices progressive', async () => {
    const workbenchRemote = remote()
    const controller = new WorkbenchProjectDeliverablesController(workbenchRemote, {
      today: () => '2026-09-02',
      nextCommandKey: (() => {
        let index = 0
        return () => `key-${++index}`
      })(),
    })
    render(<ProjectDeliverablesPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })

    const panel = screen.getByRole('region', { name: zh['deliverables.title'] })
    expect(panel.getAttribute('aria-labelledby')).toBe('workbench-project-deliverables-title')
    expect(screen.getAllByText('Accountable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Acceptor').length).toBeGreaterThan(0)
    expect(screen.getByText(zh['deliverables.decision.actorTruth'])).toBeTruthy()

    const createForm = within(panel).getByRole('form', { name: zh['deliverables.create.legend'] })
    expect((within(createForm).getByLabelText(
      zh['deliverables.schedule.startDate'],
    ) as HTMLInputElement).value).toBe('2026-09-02')
    expect((within(createForm).getByLabelText(
      zh['deliverables.schedule.endDate'],
    ) as HTMLInputElement).value).toBe('2026-09-03')
    const advanced = within(createForm).getByText(zh['deliverables.schedule.advanced']).closest('details')
    expect(advanced?.hasAttribute('open')).toBe(false)
    expect(within(advanced as HTMLElement).getByLabelText(
      zh['deliverables.schedule.existing'],
    )).toBeTruthy()
    expect(within(advanced as HTMLElement).getByLabelText(
      zh['deliverables.schedule.timed'],
    )).toBeTruthy()

    fireEvent.change(within(createForm).getByLabelText(zh['deliverables.create.name']), {
      target: { value: 'Owner-ready report' },
    })
    fireEvent.change(within(createForm).getByLabelText(`${zh['deliverables.create.criterion']} 1`), {
      target: { value: 'Sources are inspectable' },
    })
    fireEvent.change(within(createForm).getByLabelText('Accountable'), {
      target: { value: 'human-1' },
    })
    fireEvent.change(within(createForm).getByLabelText('Acceptor'), {
      target: { value: 'human-2' },
    })
    fireEvent.click(within(createForm).getByLabelText('Write evidence'))
    await act(async () => { fireEvent.submit(createForm) })

    expect(workbenchRemote.createProjectDeliverable).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Owner-ready report', taskGuids: ['task-1'],
        event: {
          mode: 'create-event',
          schedule: { kind: 'all-day', startDate: '2026-09-02', endDate: '2026-09-03' },
        },
      }),
      expect.any(AbortSignal),
    )
    await controller.dispose()
  })

  it('shows immutable plan/task/replay truth and labels every artifact version as declared and unverified', async () => {
    const workbenchRemote = remote()
    const controller = new WorkbenchProjectDeliverablesController(workbenchRemote)
    render(<ProjectDeliverablesPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })

    const card = screen.getByRole('article', { name: 'Evidence report' })
    expect(within(card).getByText('Designated Acceptor')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Write evidence' }).getAttribute('href')).toBe(
      'https://applink.feishu.cn/task-1',
    )
    expect(within(card).getByText(zh['deliverables.state.planned'])).toBeTruthy()
    expect(within(card).getByText((_, node) => node?.tagName === 'P'
      && node.textContent?.includes(zh['deliverables.calendar.remote.confirmed']) === true
      && node.textContent?.includes(zh['deliverables.calendar.sync.healthy']) === true)).toBeTruthy()
    expect(within(card).getByText(zh['deliverables.plan.immutable'])).toBeTruthy()
    expect(screen.getByText(zh['deliverables.activity.title'])).toBeTruthy()
    expect(screen.getByText(zh['deliverables.activity.action.created'])).toBeTruthy()
    expect(screen.getByText(zh['deliverables.activity.source.auditEvent'])).toBeTruthy()
    expect(screen.getByText('audit-create-1')).toBeTruthy()

    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.source']), {
      target: { value: 'local' },
    })
    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.resourceId']), {
      target: { value: 'reports/evidence.md' },
    })
    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.versionId']), {
      target: { value: 'git-sha-1234567890' },
    })
    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.displayName']), {
      target: { value: 'Evidence report v1' },
    })
    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.url']), {
      target: { value: 'https://owner:secret@example.test/report' },
    })
    fireEvent.click(within(card).getByRole('button', { name: zh['deliverables.artifact.add'] }))
    expect(within(card).getByRole('alert').textContent).toBe(
      zh['deliverables.artifact.error.invalid'],
    )
    fireEvent.change(within(card).getByLabelText(zh['deliverables.artifact.url']), {
      target: { value: '' },
    })
    fireEvent.click(within(card).getByRole('button', { name: zh['deliverables.artifact.add'] }))
    expect(within(card).queryByRole('alert')).toBeNull()
    expect(within(card).getByText(zh['deliverables.artifact.declared'])).toBeTruthy()

    const packageRoot = process.cwd().endsWith('packages/workbench-client')
      ? process.cwd()
      : resolve(process.cwd(), 'packages/workbench-client')
    const styles = await readFile(resolve(
      packageRoot,
      'src/client/ProjectDeliverablesPanel.module.css',
    ), 'utf8')
    expect(styles).toContain('@media (max-width: 640px)')
    expect(styles).toMatch(/overflow-wrap:\s*anywhere/u)
    expect(en['deliverables.title']).toBe('Project Deliverables')
    await controller.dispose()
  })
})
