import type {
  CreateProjectDeliverableResult,
  DeliverableArtifactVersionRef,
  FeishuCalendarEventDiscoveryProjection,
  ProjectDeliverableProjection,
  ProjectDeliverablesProjection,
  RequestDeliverableAcceptanceResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE,
  WorkbenchProjectDeliverablesController,
  type WorkbenchProjectDeliverablesRemote,
} from '../src/client/project-deliverables-controller.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

const receipt: WorkbenchCommandReceipt = {
  commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1',
}

function deliverable(overrides: Partial<ProjectDeliverableProjection> = {}): ProjectDeliverableProjection {
  const human = { memberId: 'human-1', displayName: 'Owner Human', kind: 'human' as const }
  return {
    deliverableId: 'deliverable-1', sequence: 1, revision: 1, state: 'planned',
    plan: {
      planSnapshotId: 'plan-1', name: 'Evidence report', description: 'Source-backed report',
      criteria: [{ criterionId: 'criterion-1', statement: 'Sources are inspectable' }],
      responsibility: {
        accountable: human, contributors: [], humanSponsor: null,
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
    ...overrides,
  }
}

function projection(
  projectId = 'project-1',
  overrides: Partial<ProjectDeliverablesProjection> = {},
): ProjectDeliverablesProjection {
  return {
    projectId, revision: 3, teamRevision: 4, taskRevision: 5, scheduleRevision: 6,
    calendarBinding: {
      calendarId: 'calendar-1', summary: 'Delivery dates', calendarType: 'shared', role: 'owner',
      identity: {
        kind: 'bot', routeGeneration: 1, appId: 'cli-app', openId: 'ou-bot', tenantKey: 'tenant-1',
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
    taskOptions: deliverable().tasks.flatMap(link => link.task === null ? [] : [link.task]),
    deliverables: [deliverable()], activity: [], nextBeforeActivitySequence: null,
    ...overrides,
  }
}

function eventDiscovery(): FeishuCalendarEventDiscoveryProjection {
  return {
    projectId: 'project-1', revision: 6, calendarId: 'calendar-1',
    items: [{
      eventId: 'event-existing', summary: 'Existing review', description: null,
      schedule: { kind: 'all-day', startDate: '2026-09-04', endDate: '2026-09-05' },
      remoteStatus: 'confirmed', recurring: false, exception: false,
      organizerMatchesCalendar: true, eventAppLink: 'https://applink.feishu.cn/event-existing',
      remoteObservationVersion: 'event-observation-1', selectable: true,
    }],
  }
}

function createSuccess(value = projection()): CreateProjectDeliverableResult {
  return { ok: true, value, deliverable: deliverable(), effect: null, receipt }
}

function requestSuccess(value = projection()): RequestDeliverableAcceptanceResult {
  const item = deliverable()
  const version = artifact()
  return {
    ok: true, value,
    request: {
      acceptanceRequestId: 'request-1', sequence: 1, revision: 1, deliverableRevision: 2,
      plan: item.plan, calendar: item.calendar, taskGuids: item.plan.taskGuids,
      candidateVersions: [{
        ...version, referenceDigest: `sha256:${'b'.repeat(64)}`, resolution: 'declared',
      }],
      candidatesDigest: `sha256:${'c'.repeat(64)}`, persistedState: 'pending',
      effectiveStatus: 'pending', decision: null,
      allowedDecisions: ['approve', 'reject', 'request-changes'],
      createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T01:00:00.000Z',
    },
    receipt,
  }
}

function artifact(): DeliverableArtifactVersionRef {
  return {
    kind: 'declared-file-version', source: 'managed', resourceId: 'report.md',
    versionId: 'sha-123', displayName: 'Evidence report v1', canonicalUrl: null,
    contentDigest: null,
  }
}

function makeRemote(
  overrides: Partial<WorkbenchProjectDeliverablesRemote> = {},
): WorkbenchProjectDeliverablesRemote {
  return {
    projectDeliverables: overrides.projectDeliverables
      ?? vi.fn(query => Promise.resolve(ok(projection(query.projectId)))),
    discoverFeishuCalendarEvents: overrides.discoverFeishuCalendarEvents
      ?? vi.fn(() => Promise.resolve(ok(eventDiscovery()))),
    createProjectDeliverable: overrides.createProjectDeliverable
      ?? vi.fn(() => Promise.resolve(ok(createSuccess()))),
    requestDeliverableAcceptance: overrides.requestDeliverableAcceptance
      ?? vi.fn(() => Promise.resolve(ok(requestSuccess()))),
  }
}

function keys() {
  const values = ['idem-1', 'cause-1', 'idem-2', 'cause-2']
  return () => values.shift() ?? 'unexpected'
}

describe('WorkbenchProjectDeliverablesController', () => {
  it('reads one Project and erases protected drafts and replay identity at the Project boundary', async () => {
    const read = vi.fn(query => Promise.resolve(ok(projection(query.projectId))))
    const controller = new WorkbenchProjectDeliverablesController(makeRemote({
      projectDeliverables: read,
    }), { today: () => '2026-09-02' })

    await controller.selectProject('project-1', 'Evidence Project')
    controller.setCreateName('Secret draft')
    controller.addCandidateVersion('deliverable-1', artifact())

    expect(read).toHaveBeenCalledWith(
      { projectId: 'project-1', activityLimit: 50 }, expect.any(AbortSignal),
    )
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', selection: { projectId: 'project-1' },
      createDraft: {
        name: 'Secret draft', eventMode: 'create-event',
        schedule: { kind: 'all-day', startDate: '2026-09-02', endDate: '2026-09-03' },
      },
      candidateDrafts: { 'deliverable-1': [{ resolution: 'declared' }] },
    })

    await controller.selectProject('project-2', 'Second Project')
    expect(controller.getSnapshot()).toMatchObject({
      selection: { projectId: 'project-2' },
      createDraft: { name: '' },
      candidateDrafts: {},
    })

    controller.clearSelection()
    expect(controller.getSnapshot()).toEqual(INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE)
    await controller.dispose()
  })

  it('creates the trivial path as a new all-day event and fences duplicate submission', async () => {
    let release!: (value: RemoteResult<CreateProjectDeliverableResult>) => void
    const create = vi.fn(() => new Promise<RemoteResult<CreateProjectDeliverableResult>>(resolve => {
      release = resolve
    }))
    const controller = new WorkbenchProjectDeliverablesController(makeRemote({
      createProjectDeliverable: create,
    }), { today: () => '2026-09-02', nextCommandKey: keys() })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setCreateName('Evidence report')
    controller.setCreateCriterion(0, 'Sources are inspectable')
    controller.setCreateAccountable('human-1')
    controller.setCreateAcceptor('human-2')
    controller.setCreateTask('task-1', true)

    const first = controller.create()
    const duplicate = controller.create()
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', name: 'Evidence report',
      criteria: [{ statement: 'Sources are inspectable' }],
      accountableMemberId: 'human-1', acceptorMemberId: 'human-2', taskGuids: ['task-1'],
      event: {
        mode: 'create-event',
        schedule: { kind: 'all-day', startDate: '2026-09-02', endDate: '2026-09-03' },
      },
      expectedDeliverablesRevision: 3, expectedDeliverableRevision: null,
      expectedTeamRevision: 4, expectedTaskRevision: 5, expectedScheduleRevision: 6,
      idempotencyKey: 'idem-1', causationId: 'cause-1',
      reason: 'owner-project-deliverable-create',
    }), expect.any(AbortSignal))

    release(ok(createSuccess()))
    await Promise.all([first, duplicate])
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', createDraft: { name: '' } })
    await controller.dispose()
  })

  it('retains the last safe projection and replays only the exact ambiguous envelope', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable' } })
      .mockResolvedValueOnce(ok(createSuccess(projection('project-1', { revision: 4 }))))
    const controller = new WorkbenchProjectDeliverablesController(makeRemote({
      createProjectDeliverable: create,
    }), { today: () => '2026-09-02', nextCommandKey: keys() })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setCreateName('Evidence report')
    controller.setCreateCriterion(0, 'Sources are inspectable')
    controller.setCreateAccountable('human-1')
    controller.setCreateAcceptor('human-2')
    controller.setCreateTask('task-1', true)

    await controller.create()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', projection: { revision: 3 }, canRetryMutation: true,
      createDraft: { name: 'Evidence report' },
    })
    const exactRequest = create.mock.calls[0]?.[0]
    await controller.retryMutation()
    expect(create.mock.calls[1]?.[0]).toBe(exactRequest)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', projection: { revision: 4 } })
    await controller.dispose()
  })

  it('requests acceptance with immutable declared refs and clears only the committed draft', async () => {
    const request = vi.fn(() => Promise.resolve(ok(requestSuccess())))
    const controller = new WorkbenchProjectDeliverablesController(makeRemote({
      requestDeliverableAcceptance: request,
    }), { nextCommandKey: keys() })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.addCandidateVersion('deliverable-1', artifact())

    await controller.requestAcceptance('deliverable-1')

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', deliverableId: 'deliverable-1',
      candidateVersions: [artifact()], expectedDeliverablesRevision: 3,
      expectedDeliverableRevision: 1, expectedTeamRevision: 4,
      expectedTaskRevision: 5, expectedScheduleRevision: 6,
      expectedRemoteObservationVersion: 'observation-1',
      reason: 'owner-deliverable-acceptance-request',
    }), expect.any(AbortSignal))
    expect(controller.getSnapshot().candidateDrafts['deliverable-1']).toBeUndefined()
    await controller.dispose()
  })

  it('permits acceptance while at least one linked execution task remains available', async () => {
    const available = deliverable().tasks[0]!
    const item = deliverable({
      plan: {
        ...deliverable().plan,
        taskGuids: ['task-1', 'task-unavailable'],
      },
      tasks: [
        available,
        { taskGuid: 'task-unavailable', availability: 'unavailable', task: null },
      ],
    })
    const current = projection('project-1', { deliverables: [item] })
    const request = vi.fn(() => Promise.resolve(ok(requestSuccess(current))))
    const controller = new WorkbenchProjectDeliverablesController(makeRemote({
      projectDeliverables: vi.fn(() => Promise.resolve(ok(current))),
      requestDeliverableAcceptance: request,
    }), { nextCommandKey: keys() })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.addCandidateVersion('deliverable-1', artifact())

    expect(controller.canRequestAcceptance('deliverable-1')).toBe(true)
    await controller.requestAcceptance('deliverable-1')
    expect(request).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('caps one acceptance round at 20 unique refs and rejects non-HTTPS URLs or malformed digests', async () => {
    const controller = new WorkbenchProjectDeliverablesController(makeRemote())
    await controller.selectProject('project-1', 'Evidence Project')

    expect(controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'bad-url', canonicalUrl: 'http://example.test/report',
    })).toBe('invalid')
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'bad-digest', contentDigest: `sha256:${'A'.repeat(64)}`,
    })
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'bad-credentials',
      canonicalUrl: 'https://owner:secret@example.test/report',
    })
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'x'.repeat(257), versionId: 'bad-long-resource',
    })
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'bad-long-label', displayName: 'x'.repeat(201),
    })
    expect(controller.addCandidateVersion('deliverable-1', {
      ...artifact(), resourceId: 'boundary-reference', versionId: 'v'.repeat(256),
      displayName: 'd'.repeat(200), canonicalUrl: 'https://example.test/report',
    })).toBe('added')
    for (let index = 0; index < 21; index += 1) {
      controller.addCandidateVersion('deliverable-1', {
        ...artifact(), resourceId: `report-${index}.md`, versionId: `version-${index}`,
      })
    }

    const candidates = controller.getSnapshot().candidateDrafts['deliverable-1']
    expect(candidates).toHaveLength(20)
    expect(candidates?.some(item => item.resourceId.startsWith('bad-'))).toBe(false)
    expect(candidates?.some(item => item.versionId === 'bad-long-resource')).toBe(false)
    expect(candidates).toContainEqual(expect.objectContaining({
      resourceId: 'boundary-reference', versionId: 'v'.repeat(256),
      displayName: 'd'.repeat(200), canonicalUrl: 'https://example.test/report',
    }))
    await controller.dispose()
  })

  it('deduplicates the complete normalized reference instead of only its source identity', async () => {
    const controller = new WorkbenchProjectDeliverablesController(makeRemote())
    await controller.selectProject('project-1', 'Evidence Project')

    controller.addCandidateVersion('deliverable-1', artifact())
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), displayName: '  Evidence report v1  ',
    })
    controller.addCandidateVersion('deliverable-1', {
      ...artifact(), displayName: 'Evidence report v1 — signed',
    })

    expect(controller.getSnapshot().candidateDrafts['deliverable-1']).toEqual([
      { ...artifact(), resolution: 'declared' },
      { ...artifact(), displayName: 'Evidence report v1 — signed', resolution: 'declared' },
    ])
    await controller.dispose()
  })
})
