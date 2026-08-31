import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  ProjectCalendarSchedule,
  UpdateProjectMilestoneDateRequest,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
} from '../src/client.ts'
import { KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1 } from '../src/project-template.ts'
import { SqliteWorkbenchRepository } from '../src/sqlite-repository.ts'
import {
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchFeishuExternalAdapter,
  type WorkbenchIdGenerator,
} from '../src/scenario.ts'
import type { WorkbenchAuthorization } from '../src/authorization.ts'
import type {
  WorkbenchFeishuCalendarChangeListener,
  WorkbenchFeishuCalendarEventSnapshot,
  WorkbenchFeishuCalendarExternalAdapter,
  WorkbenchFeishuCalendarRoute,
  WorkbenchFeishuCalendarSnapshot,
} from '../src/feishu-calendar-federation.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuWriteResult,
} from '../src/feishu-task-federation.ts'

const PROJECT_ID = 'project-calendar-scenario'
const CALENDAR_ID = 'calendar-scenario'
const EVENT_ID = 'event-scenario'
const APP_ID = 'cli_calendar_scenario'
const OPEN_ID = 'ou_calendar_scenario'
const signal = new AbortController().signal
const temporaryRoots = new Set<string>()

const authorization: WorkbenchAuthorization = Object.freeze({
  require: async () => Object.freeze({
    ownerId: 'owner-calendar-scenario',
    organizationId: 'organization-calendar-scenario',
    teamId: 'team-calendar-scenario',
  }),
  filterProjection: async <T>(_action: string, projection: T) => projection,
})

const allDay = (startDate: string, endDate: string): ProjectCalendarSchedule => Object.freeze({
  kind: 'all-day',
  startDate,
  endDate,
})

const timed = (
  startAt: string,
  endAt: string,
  timeZone = 'Asia/Shanghai',
): ProjectCalendarSchedule => Object.freeze({ kind: 'timed', startAt, endAt, timeZone })

function calendar(): WorkbenchFeishuCalendarSnapshot {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    summary: 'Project calendar',
    description: null,
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  })
}

function event(
  schedule: ProjectCalendarSchedule = allDay('2026-09-10', '2026-09-11'),
  version = `sha256:${'1'.repeat(64)}`,
): WorkbenchFeishuCalendarEventSnapshot {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    eventId: EVENT_ID,
    organizerCalendarId: CALENDAR_ID,
    summary: 'Provider event title',
    description: null,
    schedule,
    status: 'confirmed',
    recurring: false,
    exception: false,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${EVENT_ID}`,
    remoteObservationVersion: version,
    observedAt: '2026-08-31T06:00:00.000Z',
  })
}

function eventFor(
  eventId: string,
  schedule: ProjectCalendarSchedule,
  version: string,
): WorkbenchFeishuCalendarEventSnapshot {
  return Object.freeze({
    ...event(schedule, version),
    eventId,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${eventId}`,
  })
}

class FixtureCalendarAdapter implements
WorkbenchFeishuExternalAdapter, WorkbenchFeishuCalendarExternalAdapter {
  readonly adapterId = 'fixture-calendar-adapter'
  currentEvent = event()
  readonly additionalEvents = new Map<string, WorkbenchFeishuCalendarEventSnapshot>()
  readonly readFailures = new Map<string, FeishuConnectionIssue>()
  readEventCalls = 0
  updateCalls = 0
  private listener: WorkbenchFeishuCalendarChangeListener | null = null

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
        displayLabel: 'Scenario Calendar Bot',
        finishVerification: async (): Promise<WorkbenchFeishuResourceVerificationObservation> =>
          Object.freeze({
            result: 'healthy',
            scopeInspection: Object.freeze({
              state: 'observed',
              scopes: Object.freeze([]),
              issue: null,
            }),
            resourceProbe: Object.freeze({ state: 'not-tested' }),
          }),
        dispose: () => undefined,
      }),
    })
  }

  async listCalendars(
    _route: WorkbenchFeishuCalendarRoute,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarSnapshot[]>> {
    return Object.freeze({ state: 'ok', value: Object.freeze([calendar()]) })
  }

  async readCalendar(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarSnapshot>> {
    if (calendarId !== CALENDAR_ID) throw new Error('fixture calendar identity changed')
    return Object.freeze({ state: 'ok', value: calendar() })
  }

  async createCalendar(
    _route: WorkbenchFeishuCalendarRoute,
    _input: Readonly<{ readonly summary: string; readonly description: string | null }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarSnapshot>> {
    return Object.freeze({ state: 'ok', value: calendar() })
  }

  async listCalendarEvents(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarEventSnapshot[]>> {
    if (calendarId !== CALENDAR_ID) throw new Error('fixture calendar identity changed')
    return Object.freeze({ state: 'ok', value: Object.freeze([this.currentEvent]) })
  }

  async readCalendarEvent(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    eventId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarEventSnapshot>> {
    this.readEventCalls += 1
    if (calendarId !== CALENDAR_ID) {
      throw new Error('fixture event identity changed')
    }
    const issue = this.readFailures.get(eventId)
    if (issue !== undefined) return Object.freeze({ state: 'failed', issue })
    const value = eventId === EVENT_ID ? this.currentEvent : this.additionalEvents.get(eventId)
    if (value === undefined) throw new Error('fixture event identity changed')
    return Object.freeze({ state: 'ok', value })
  }

  async createCalendarEvent(
    _route: WorkbenchFeishuCalendarRoute,
    _input: Readonly<{
      readonly calendarId: string
      readonly idempotencyKey: string
      readonly summary: string
      readonly description: string | null
      readonly schedule: ProjectCalendarSchedule
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>> {
    return Object.freeze({ state: 'ok', value: this.currentEvent })
  }

  async updateCalendarEventSchedule(
    _route: WorkbenchFeishuCalendarRoute,
    _input: Readonly<{
      readonly calendarId: string
      readonly eventId: string
      readonly expectedRemoteObservationVersion: string
      readonly schedule: ProjectCalendarSchedule
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>> {
    this.updateCalls += 1
    return Object.freeze({ state: 'ok', value: this.currentEvent })
  }

  subscribeCalendarChanges(listener: WorkbenchFeishuCalendarChangeListener): () => void {
    this.listener = listener
    return () => { if (this.listener === listener) this.listener = null }
  }
}

function ids(): WorkbenchIdGenerator {
  let command = 0
  let audit = 0
  let outbox = 0
  let change = 0
  let milestone = 0
  return Object.freeze({
    nextStatusId: () => 'status-calendar-scenario',
    nextProjectId: () => PROJECT_ID,
    nextProjectMemberId: () => 'member-calendar-scenario',
    nextSuggestedChangeId: () => 'suggested-calendar-scenario',
    nextSuggestedChangeDecisionId: () => 'decision-calendar-scenario',
    nextFeishuVerificationId: () => 'verification-calendar-scenario',
    nextGoalId: () => 'goal-calendar-scenario',
    nextOutcomeId: () => 'outcome-calendar-scenario',
    nextCommandId: () => `command-calendar-scenario-${String(++command).padStart(3, '0')}`,
    nextAuditEventId: () => `audit-calendar-scenario-${String(++audit).padStart(3, '0')}`,
    nextOutboxId: () => `outbox-calendar-scenario-${String(++outbox).padStart(3, '0')}`,
    nextMilestoneId: () => ++milestone === 1
      ? 'milestone-calendar-scenario'
      : `milestone-calendar-scenario-${String(milestone).padStart(3, '0')}`,
    nextScheduleChangeId: () => `schedule-change-${String(++change).padStart(3, '0')}`,
  })
}

function idsWithoutScheduleChangeGenerator(): WorkbenchIdGenerator {
  const { nextScheduleChangeId: _omitted, ...generator } = ids()
  return Object.freeze(generator)
}

function clock(): WorkbenchClock {
  let milliseconds = Date.parse('2026-08-31T06:00:00.000Z')
  return Object.freeze({ now: () => new Date(milliseconds += 1_000) })
}

function projectRequest(): CreateProjectRequest {
  return Object.freeze({
    template: Object.freeze({
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    }),
    projectName: 'Scenario calendar project',
    primaryGoal: Object.freeze({
      name: 'Exercise calendar federation',
      outcomes: Object.freeze([Object.freeze({
        name: 'Convergent schedule',
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
    idempotencyKey: 'project-calendar-scenario-key-0001',
    causationId: 'project-calendar-scenario-cause-0001',
    reason: 'owner-project-create',
  })
}

function scenarioFor(
  databasePath: string,
  adapter: FixtureCalendarAdapter,
  idGenerator: WorkbenchIdGenerator = ids(),
): WorkbenchScenario {
  return new WorkbenchScenario({
    repository: new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    }),
    clock: clock(),
    ids: idGenerator,
    adapters: Object.freeze({ feishu: adapter, feishuCalendars: adapter }),
    authorization,
    maxStatusLength: 280,
  })
}

async function fixture(idGenerator: WorkbenchIdGenerator = ids()) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-calendar-scenario-'))
  temporaryRoots.add(root)
  const databasePath = join(root, 'workbench.sqlite')
  const adapter = new FixtureCalendarAdapter()
  const scenario = scenarioFor(databasePath, adapter, idGenerator)
  await scenario.open()
  await scenario.createProject(projectRequest(), signal)
  await scenario.configureFeishuIdentityRoute({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_CALENDAR_SCENARIO_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'feishu-calendar-configure-0001',
    causationId: 'feishu-calendar-configure-cause-0001',
    reason: 'owner-feishu-route-configure',
  }, signal)
  await scenario.verifyFeishuIdentityRoute({
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'feishu-calendar-verify-0001',
    causationId: 'feishu-calendar-verify-cause-0001',
    reason: 'owner-feishu-route-verify',
  }, signal)
  return Object.freeze({ scenario, adapter, databasePath })
}

async function bindExistingCalendarAndMilestone(scenario: WorkbenchScenario): Promise<void> {
  await scenario.bindProjectCalendar({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    calendarId: CALENDAR_ID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'feishu-calendar-bind-shared-0001',
    causationId: 'feishu-calendar-bind-shared-cause-0001',
    reason: 'owner-project-calendar-bind',
  }, signal)
  await scenario.createProjectMilestone({
    projectId: PROJECT_ID,
    mode: 'existing-event',
    eventId: EVENT_ID,
    expectedRevision: 1,
    expectedMilestoneRevision: null,
    name: 'Reliable checkpoint',
    description: null,
    idempotencyKey: 'feishu-milestone-shared-0001',
    causationId: 'feishu-milestone-shared-cause-0001',
    reason: 'owner-project-milestone-create',
  }, signal)
}

function dateUpdateRequest(
  idempotencyKey: string,
  schedule: ProjectCalendarSchedule,
): UpdateProjectMilestoneDateRequest {
  return Object.freeze({
    projectId: PROJECT_ID,
    milestoneId: 'milestone-calendar-scenario',
    expectedRevision: 2,
    expectedMilestoneRevision: 1,
    expectedRemoteObservationVersion: `sha256:${'1'.repeat(64)}`,
    schedule,
    idempotencyKey,
    causationId: `${idempotencyKey}-cause`,
    reason: 'owner-project-milestone-date-update',
  })
}

describe('T10 Feishu calendar scenario', () => {
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all([...temporaryRoots].map(async root => {
      await rm(root, { recursive: true, force: true })
      temporaryRoots.delete(root)
    }))
  })

  it('binds an exact writable calendar and converges an existing Milestone event', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    await expect(scenario.discoverFeishuCalendars({
      projectId: PROJECT_ID,
      kind: 'bot',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
    }, signal)).resolves.toMatchObject({
      projectId: PROJECT_ID,
      items: [{ calendarId: CALENDAR_ID, selectable: true }],
    })
    await expect(scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'existing',
      calendarId: CALENDAR_ID,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-0001',
      causationId: 'feishu-calendar-bind-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 1, binding: { calendarId: CALENDAR_ID } },
    })
    await expect(scenario.discoverFeishuCalendarEvents({
      projectId: PROJECT_ID,
      expectedRevision: 1,
    }, signal)).resolves.toMatchObject({
      calendarId: CALENDAR_ID,
      items: [{ eventId: EVENT_ID, selectable: true }],
    })
    await expect(scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'existing-event',
      eventId: EVENT_ID,
      expectedRevision: 1,
      expectedMilestoneRevision: null,
      name: 'Contract signed',
      description: 'Formal checkpoint',
      idempotencyKey: 'feishu-milestone-create-0001',
      causationId: 'feishu-milestone-create-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 2,
        milestones: [{ milestoneId: 'milestone-calendar-scenario', revision: 1 }],
        recentChanges: [{ source: 'workbench', beforeSchedule: null }],
      },
    })

    adapter.currentEvent = event(
      allDay('2026-09-12', '2026-09-13'),
      `sha256:${'2'.repeat(64)}`,
    )
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        milestones: [{
          revision: 2,
          schedule: { startDate: '2026-09-12', endDate: '2026-09-13' },
        }],
        recentChanges: [
          { source: 'feishu', changedFields: ['schedule'] },
          { source: 'workbench', beforeSchedule: null },
        ],
      },
    })
    expect(adapter.readEventCalls).toBe(2)
    await scenario.close()

    const reopened = scenarioFor(databasePath, adapter)
    await reopened.open()
    await expect(reopened.getProjectMilestones({ projectId: PROJECT_ID }, signal)).resolves.toMatchObject({
      revision: 3,
      binding: { calendarId: CALENDAR_ID },
      milestones: [{ milestoneId: 'milestone-calendar-scenario', revision: 2 }],
    })
    const activity = await reopened.activity({ projectId: PROJECT_ID }, signal)
    expect(activity.integrity).toMatchObject({ valid: true })
    expect(activity.items.slice(0, 2)).toMatchObject([
      { action: 'workbench.project-milestone.created', summaryCode: 'project-milestone-created' },
      { action: 'workbench.project-calendar.bound', summaryCode: 'project-calendar-bound' },
    ])
    await expect(reopened.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    await reopened.close()
  })

  it('retains an unbound attention projection after a definitive Calendar-create rejection', async () => {
    const { scenario, adapter } = await fixture()
    vi.spyOn(adapter, 'createCalendar').mockResolvedValue(Object.freeze({
      state: 'rejected',
      issue: Object.freeze({
        code: 'missing-app-scope',
        recovery: 'grant-app-scope',
        missingScopes: Object.freeze(['calendar:calendar:create']),
        grantPlane: 'application',
        retryAt: null,
      }),
    }))

    await expect(scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'create',
      summary: 'Rejected Project calendar',
      description: null,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-rejected-0001',
      causationId: 'feishu-calendar-bind-rejected-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-rejected',
        current: {
          binding: null,
          revision: 1,
          sync: { state: 'attention' },
          effects: [{ operation: 'calendar-create', state: 'failed' }],
        },
      },
    })
    await expect(scenario.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({
        binding: null,
        revision: 1,
        sync: { state: 'attention' },
      })
    await scenario.close()
  })

  it('does not let an existing Calendar bind bypass an unknown Calendar-create effect', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    vi.spyOn(adapter, 'createCalendar').mockResolvedValue(Object.freeze({
      state: 'unknown',
      issue: Object.freeze({
        code: 'unknown-provider-error',
        recovery: 'inspect-provider',
        missingScopes: Object.freeze([]),
        grantPlane: null,
        retryAt: null,
      }),
    }))
    await expect(scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'create',
      summary: 'Ambiguous Project calendar',
      description: null,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-unknown-create-0001',
      causationId: 'feishu-calendar-bind-unknown-create-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown', current: { revision: 1 } },
    })

    await expect(scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'existing',
      calendarId: CALENDAR_ID,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-after-unknown-0001',
      causationId: 'feishu-calendar-bind-after-unknown-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        current: {
          revision: 1,
          binding: null,
          sync: { state: 'unknown' },
          effects: [{ operation: 'calendar-create', state: 'unknown' }],
        },
      },
    })
    await scenario.close()

    const reopened = scenarioFor(databasePath, adapter)
    await reopened.open()
    await expect(reopened.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    await expect(reopened.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({ revision: 1, binding: null, sync: { state: 'unknown' } })
    await reopened.close()
  })

  it('never PATCHes a cancelled Milestone even after the cancelled authority is current', async () => {
    const { scenario, adapter } = await fixture()
    await scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'existing',
      calendarId: CALENDAR_ID,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-cancelled-0001',
      causationId: 'feishu-calendar-bind-cancelled-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)
    await scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'existing-event',
      eventId: EVENT_ID,
      expectedRevision: 1,
      expectedMilestoneRevision: null,
      name: 'Cancelled checkpoint',
      description: null,
      idempotencyKey: 'feishu-milestone-cancelled-0001',
      causationId: 'feishu-milestone-cancelled-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)

    adapter.currentEvent = Object.freeze({
      ...event(undefined, `sha256:${'3'.repeat(64)}`),
      status: 'cancelled',
    })
    const stale = await scenario.updateProjectMilestoneDate({
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: 2,
      expectedMilestoneRevision: 1,
      expectedRemoteObservationVersion: `sha256:${'1'.repeat(64)}`,
      schedule: allDay('2026-09-20', '2026-09-21'),
      idempotencyKey: 'feishu-milestone-date-cancelled-0001',
      causationId: 'feishu-milestone-date-cancelled-cause-0001',
      reason: 'owner-project-milestone-date-update',
    }, signal)
    expect(stale).toMatchObject({
      ok: false,
      error: {
        code: 'remote-version-changed',
        current: { revision: 3, milestones: [{ revision: 2, remoteStatus: 'cancelled' }] },
      },
    })

    await expect(scenario.updateProjectMilestoneDate({
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: 3,
      expectedMilestoneRevision: 2,
      expectedRemoteObservationVersion: `sha256:${'3'.repeat(64)}`,
      schedule: allDay('2026-09-20', '2026-09-21'),
      idempotencyKey: 'feishu-milestone-date-cancelled-0002',
      causationId: 'feishu-milestone-date-cancelled-cause-0002',
      reason: 'owner-project-milestone-date-update',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'event-not-selectable' },
    })
    expect(adapter.updateCalls).toBe(0)
    await scenario.close()
  })

  it('claims and settles the original prepared Calendar-create effect on same-key replay', async () => {
    const { scenario, adapter } = await fixture()
    const createCalendar = vi.spyOn(adapter, 'createCalendar')
    const claim = vi.spyOn(
      SqliteWorkbenchRepository.prototype,
      'claimFeishuCalendarEffect',
    ).mockResolvedValueOnce(false)
    const request = Object.freeze({
      projectId: PROJECT_ID,
      kind: 'bot' as const,
      mode: 'create' as const,
      summary: 'Replay-safe Project calendar',
      description: 'Prepared intent',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-prepared-replay-0001',
      causationId: 'feishu-calendar-bind-prepared-replay-cause-0001',
      reason: 'owner-project-calendar-bind' as const,
    })

    await expect(scenario.bindProjectCalendar(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(createCalendar).not.toHaveBeenCalled()
    claim.mockRestore()

    await expect(scenario.bindProjectCalendar(request, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        binding: { calendarId: CALENDAR_ID, createdByWorkbench: true },
        effects: [{ operation: 'calendar-create', state: 'delivered' }],
      },
    })
    expect(createCalendar).toHaveBeenCalledTimes(1)
    await scenario.close()
  })

  it('rejects a Calendar-create provider intent that no longer matches its accepted receipt', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    const claim = vi.spyOn(
      SqliteWorkbenchRepository.prototype,
      'claimFeishuCalendarEffect',
    ).mockResolvedValueOnce(false)
    const request = Object.freeze({
      projectId: PROJECT_ID,
      kind: 'bot' as const,
      mode: 'create' as const,
      summary: 'Immutable Project calendar',
      description: 'Original provider intent',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-intent-integrity-0001',
      causationId: 'feishu-calendar-bind-intent-integrity-cause-0001',
      reason: 'owner-project-calendar-bind' as const,
    })
    await expect(scenario.bindProjectCalendar(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    claim.mockRestore()
    await scenario.close()

    const database = new DatabaseSync(databasePath)
    database.exec(`
      DROP TRIGGER workbench_feishu_calendar_effect_intent_no_update;
      UPDATE workbench_feishu_calendar_effect
      SET intent_json = '{"description":"Original provider intent","mode":"create","summary":"FORGED"}'
      WHERE operation = 'calendar-create';
      CREATE TRIGGER workbench_feishu_calendar_effect_intent_no_update BEFORE UPDATE OF
        id, project_id, organization_id, team_id, actor_id, operation, milestone_id,
        expected_project_revision, expected_milestone_revision,
        expected_remote_observation_version, intent_json, request_hash,
        idempotency_key_hash, provider_idempotency_key, route_kind, route_generation,
        app_id, open_id, tenant_key, command_id, audit_event_id, outbox_id, created_at
        ON workbench_feishu_calendar_effect
      BEGIN SELECT RAISE(ABORT, 'workbench Calendar effect intent is immutable'); END;
    `)
    database.close()

    const reopened = scenarioFor(databasePath, adapter)
    await expect(reopened.open()).rejects.toThrow(/Calendar receipt has invalid request/u)
  })

  it('claims and settles the original prepared event-create effect on same-key replay', async () => {
    const { scenario, adapter } = await fixture()
    await scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'existing',
      calendarId: CALENDAR_ID,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-prepared-event-0001',
      causationId: 'feishu-calendar-bind-prepared-event-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)
    const createEvent = vi.spyOn(adapter, 'createCalendarEvent')
    const claim = vi.spyOn(
      SqliteWorkbenchRepository.prototype,
      'claimFeishuCalendarEffect',
    ).mockResolvedValueOnce(false)
    const request = Object.freeze({
      projectId: PROJECT_ID,
      mode: 'create-event' as const,
      schedule: allDay('2026-09-14', '2026-09-15'),
      expectedRevision: 1,
      expectedMilestoneRevision: null,
      name: 'Replay-safe checkpoint',
      description: 'Prepared event intent',
      idempotencyKey: 'feishu-milestone-create-prepared-replay-0001',
      causationId: 'feishu-milestone-create-prepared-replay-cause-0001',
      reason: 'owner-project-milestone-create' as const,
    })

    await expect(scenario.createProjectMilestone(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(createEvent).not.toHaveBeenCalled()
    claim.mockRestore()

    adapter.currentEvent = event(request.schedule, `sha256:${'2'.repeat(64)}`)
    await expect(scenario.createProjectMilestone(request, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 2,
        effects: [{ operation: 'event-create', state: 'delivered' }],
        milestones: [{ name: 'Replay-safe checkpoint', schedule: request.schedule }],
      },
    })
    expect(createEvent).toHaveBeenCalledTimes(1)
    await scenario.close()
  })

  it('does not let an existing event bind bypass an unknown event-create effect', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    await scenario.bindProjectCalendar({
      projectId: PROJECT_ID,
      kind: 'bot',
      mode: 'existing',
      calendarId: CALENDAR_ID,
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 1,
      expectedBindingRevision: null,
      idempotencyKey: 'feishu-calendar-bind-unknown-event-0001',
      causationId: 'feishu-calendar-bind-unknown-event-cause-0001',
      reason: 'owner-project-calendar-bind',
    }, signal)
    vi.spyOn(adapter, 'createCalendarEvent').mockResolvedValue(Object.freeze({
      state: 'unknown',
      issue: Object.freeze({
        code: 'unknown-provider-error',
        recovery: 'inspect-provider',
        missingScopes: Object.freeze([]),
        grantPlane: null,
        retryAt: null,
      }),
    }))
    await expect(scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'create-event',
      schedule: allDay('2026-09-14', '2026-09-15'),
      expectedRevision: 1,
      expectedMilestoneRevision: null,
      name: 'Ambiguous checkpoint',
      description: null,
      idempotencyKey: 'feishu-milestone-unknown-create-0001',
      causationId: 'feishu-milestone-unknown-create-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown', current: { revision: 2 } },
    })

    await expect(scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'existing-event',
      eventId: EVENT_ID,
      expectedRevision: 2,
      expectedMilestoneRevision: null,
      name: 'Unsafe replacement checkpoint',
      description: null,
      idempotencyKey: 'feishu-milestone-after-unknown-0001',
      causationId: 'feishu-milestone-after-unknown-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        current: {
          revision: 2,
          milestones: [],
          sync: { state: 'unknown' },
          effects: [{ operation: 'event-create', state: 'unknown' }],
        },
      },
    })
    await scenario.close()

    const reopened = scenarioFor(databasePath, adapter)
    await reopened.open()
    await expect(reopened.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    await expect(reopened.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({ revision: 2, milestones: [], sync: { state: 'unknown' } })
    await reopened.close()
  })

  it('claims and settles the original prepared date effect on same-key replay', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    const intended = allDay('2026-09-16', '2026-09-17')
    const updateEvent = vi.spyOn(adapter, 'updateCalendarEventSchedule')
      .mockImplementation(async (_route, input) => {
        adapter.updateCalls += 1
        adapter.currentEvent = event(input.schedule, `sha256:${'2'.repeat(64)}`)
        return Object.freeze({ state: 'ok', value: adapter.currentEvent })
      })
    const claim = vi.spyOn(
      SqliteWorkbenchRepository.prototype,
      'claimFeishuCalendarEffect',
    ).mockResolvedValueOnce(false)
    const request = dateUpdateRequest(
      'feishu-milestone-date-prepared-replay-0001',
      intended,
    )

    await expect(scenario.updateProjectMilestoneDate(request, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(updateEvent).not.toHaveBeenCalled()
    claim.mockRestore()

    await expect(scenario.updateProjectMilestoneDate(request, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        effects: [{ operation: 'event-date-update', state: 'delivered' }],
        milestones: [{ schedule: intended }],
      },
    })
    expect(updateEvent).toHaveBeenCalledTimes(1)
    const readsAfterDelivery = adapter.readEventCalls
    await expect(scenario.updateProjectMilestoneDate(request, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 3 },
      milestone: { schedule: intended },
    })
    expect(adapter.readEventCalls).toBe(readsAfterDelivery)
    expect(updateEvent).toHaveBeenCalledTimes(1)
    await scenario.close()
  })

  it('lets a live inflight winner settle after a same-key replay observes an unknown outcome', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    let enterProvider!: () => void
    let releaseProvider!: () => void
    const providerEntered = new Promise<void>(resolve => { enterProvider = resolve })
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve })
    vi.spyOn(adapter, 'updateCalendarEventSchedule').mockImplementation(async (_route, input) => {
      adapter.updateCalls += 1
      enterProvider()
      await providerGate
      adapter.currentEvent = event(input.schedule, `sha256:${'2'.repeat(64)}`)
      return Object.freeze({ state: 'ok', value: adapter.currentEvent })
    })
    const request = dateUpdateRequest(
      'feishu-milestone-date-live-replay-0001',
      allDay('2026-09-20', '2026-09-21'),
    )

    const winner = scenario.updateProjectMilestoneDate(request, signal)
    await providerEntered
    const replay = await scenario.updateProjectMilestoneDate(request, signal)
    const inFlightActivity = await scenario.activity({ projectId: PROJECT_ID }, signal)
    expect(inFlightActivity.items.find(item =>
      item.action === 'workbench.project-milestone.date-update-requested',
    )?.outbox).toMatchObject({ state: 'pending', attemptCount: 1, errorCode: null })
    releaseProvider()
    const delivered = await winner

    expect(replay).toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        current: {
          revision: 2,
          sync: { state: 'healthy' },
          effects: [{ state: 'prepared' }],
        },
      },
    })
    expect(delivered).toMatchObject({
      ok: true,
      value: {
        revision: 3,
        effects: [{ state: 'delivered' }],
        milestones: [{ schedule: { startDate: '2026-09-20', endDate: '2026-09-21' } }],
      },
    })
    expect(adapter.updateCalls).toBe(1)
    await scenario.close()
  })

  it('fences a different key while the Project has an active Calendar effect', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    let enterProvider!: () => void
    let releaseProvider!: () => void
    const providerEntered = new Promise<void>(resolve => { enterProvider = resolve })
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve })
    vi.spyOn(adapter, 'updateCalendarEventSchedule').mockImplementation(async (_route, input) => {
      adapter.updateCalls += 1
      if (adapter.updateCalls === 1) {
        enterProvider()
        await providerGate
      }
      adapter.currentEvent = event(input.schedule, `sha256:${String(adapter.updateCalls + 1).repeat(64)}`)
      return Object.freeze({ state: 'ok', value: adapter.currentEvent })
    })
    const winner = scenario.updateProjectMilestoneDate(dateUpdateRequest(
      'feishu-milestone-date-fence-winner-0001',
      allDay('2026-09-20', '2026-09-21'),
    ), signal)
    await providerEntered
    const contender = await scenario.updateProjectMilestoneDate(dateUpdateRequest(
      'feishu-milestone-date-fence-contender-0001',
      allDay('2026-09-22', '2026-09-23'),
    ), signal)
    releaseProvider()
    const delivered = await winner

    expect(contender).toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(delivered).toMatchObject({ ok: true })
    expect(adapter.updateCalls).toBe(1)
    await scenario.close()
  })

  it('recovers a claimed Calendar effect to unknown only after reopening the repository', async () => {
    const { scenario, databasePath } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    await scenario.close()
    const repository = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
      now: () => new Date('2026-08-31T07:00:00.000Z'),
    })
    await repository.open()
    const effectId = 'effect-calendar-restart-0001'
    const preparedAt = '2026-08-31T06:30:00.000Z'
    const reservation = await repository.reserveFeishuCalendarDateUpdate(Object.freeze({
      effectId,
      changeId: 'schedule-change-restart-0001',
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: 2,
      expectedMilestoneRevision: 1,
      expectedRemoteObservationVersion: `sha256:${'1'.repeat(64)}`,
      observed: event(),
      schedule: allDay('2026-09-24', '2026-09-25'),
      preparedAt,
      command: Object.freeze({
        commandId: 'command-calendar-restart-0001',
        auditEventId: 'audit-calendar-restart-0001',
        outboxId: 'outbox-calendar-restart-0001',
        idempotencyKey: 'feishu-calendar-restart-key-0001',
        causationId: 'feishu-calendar-restart-cause-0001',
        reason: 'owner-project-milestone-date-update',
        actor: Object.freeze({
          kind: 'owner',
          id: 'owner-calendar-scenario',
          organizationId: 'organization-calendar-scenario',
          teamId: 'team-calendar-scenario',
        }),
        occurredAt: preparedAt,
      }),
    }), signal)
    expect(reservation.state).toBe('deliver')
    await expect(repository.claimFeishuCalendarEffect(
      effectId,
      '2026-08-31T06:31:00.000Z',
      signal,
    )).resolves.toBe(true)
    await expect(repository.readProjectMilestones({
      organizationId: 'organization-calendar-scenario',
      teamId: 'team-calendar-scenario',
      projectId: PROJECT_ID,
    }, signal)).resolves.toMatchObject({
      revision: 2,
      sync: { state: 'healthy' },
      effects: [{ effectId, state: 'prepared' }],
    })
    await repository.close()

    const reopened = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
      now: () => new Date('2026-08-31T07:00:00.000Z'),
    })
    await reopened.open()
    await expect(reopened.readProjectMilestones({
      organizationId: 'organization-calendar-scenario',
      teamId: 'team-calendar-scenario',
      projectId: PROJECT_ID,
    }, signal)).resolves.toMatchObject({
      revision: 3,
      sync: { state: 'unknown' },
      effects: [{ effectId, state: 'unknown' }],
    })
    await reopened.close()
  })

  it('atomically delivers an unknown date effect when reconciliation exactly matches its frozen intent', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    const intended = allDay('2026-09-26', '2026-09-27')
    vi.spyOn(adapter, 'updateCalendarEventSchedule').mockImplementation(async () => {
      adapter.updateCalls += 1
      return Object.freeze({
        state: 'unknown',
        issue: Object.freeze({
          code: 'unknown-provider-error',
          recovery: 'inspect-provider',
          missingScopes: Object.freeze([]),
          grantPlane: null,
          retryAt: null,
        }),
      })
    })
    await expect(scenario.updateProjectMilestoneDate(dateUpdateRequest(
      'feishu-milestone-date-reconcile-match-0001',
      intended,
    ), signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'remote-outcome-unknown',
        current: { revision: 3, sync: { state: 'unknown' }, effects: [{ state: 'unknown' }] },
      },
    })

    adapter.currentEvent = event(intended, `sha256:${'4'.repeat(64)}`)
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 3,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        sync: { state: 'healthy' },
        effects: [{ state: 'delivered' }],
        milestones: [{ schedule: { startDate: '2026-09-26', endDate: '2026-09-27' } }],
      },
    })
    const activity = await scenario.activity({
      projectId: PROJECT_ID,
    }, signal)
    expect(activity.items.find(item =>
      item.action === 'workbench.project-milestone.date-update-requested',
    )?.outbox).toMatchObject({ state: 'delivered', attemptCount: 1, errorCode: null })
    await expect(scenario.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    await scenario.close()
  })

  it('reconciles an offset timed intent against the same canonical UTC instants', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    const intended = timed(
      '2026-09-26T09:00:00+08:00',
      '2026-09-26T10:30:00+08:00',
    )
    vi.spyOn(adapter, 'updateCalendarEventSchedule').mockImplementation(async () => {
      adapter.updateCalls += 1
      return Object.freeze({
        state: 'unknown',
        issue: Object.freeze({
          code: 'unknown-provider-error',
          recovery: 'inspect-provider',
          missingScopes: Object.freeze([]),
          grantPlane: null,
          retryAt: null,
        }),
      })
    })
    await expect(scenario.updateProjectMilestoneDate(dateUpdateRequest(
      'feishu-milestone-date-timed-offset-0001',
      intended,
    ), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })

    adapter.currentEvent = event(timed(
      '2026-09-26T01:00:00.000Z',
      '2026-09-26T02:30:00.000Z',
    ), `sha256:${'7'.repeat(64)}`)
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 3,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        sync: { state: 'healthy' },
        effects: [{ operation: 'event-date-update', state: 'delivered' }],
        milestones: [{ schedule: adapter.currentEvent.schedule }],
      },
    })
    await scenario.close()
  })

  it('keeps an unmatched unknown date effect and Project head unknown after reconciliation', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    vi.spyOn(adapter, 'updateCalendarEventSchedule').mockImplementation(async () => {
      adapter.updateCalls += 1
      return Object.freeze({
        state: 'unknown',
        issue: Object.freeze({
          code: 'unknown-provider-error',
          recovery: 'inspect-provider',
          missingScopes: Object.freeze([]),
          grantPlane: null,
          retryAt: null,
        }),
      })
    })
    await scenario.updateProjectMilestoneDate(dateUpdateRequest(
      'feishu-milestone-date-reconcile-miss-0001',
      allDay('2026-09-28', '2026-09-29'),
    ), signal)
    adapter.currentEvent = event(
      allDay('2026-09-30', '2026-10-01'),
      `sha256:${'5'.repeat(64)}`,
    )

    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 3,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        sync: { state: 'unknown' },
        effects: [{ state: 'unknown' }],
        milestones: [{ schedule: { startDate: '2026-09-30', endDate: '2026-10-01' } }],
      },
    })
    const activity = await scenario.activity({
      projectId: PROJECT_ID,
    }, signal)
    expect(activity.items.find(item =>
      item.action === 'workbench.project-milestone.date-update-requested',
    )?.outbox).toMatchObject({
      state: 'unknown',
      attemptCount: 1,
      errorCode: 'transport-ambiguous',
    })
    await expect(scenario.updateProjectMilestoneDate({
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: 4,
      expectedMilestoneRevision: 2,
      expectedRemoteObservationVersion: `sha256:${'5'.repeat(64)}`,
      schedule: allDay('2026-10-04', '2026-10-05'),
      idempotencyKey: 'feishu-milestone-date-unresolved-fence-0001',
      causationId: 'feishu-milestone-date-unresolved-fence-cause-0001',
      reason: 'owner-project-milestone-date-update',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    expect(adapter.updateCalls).toBe(1)
    await scenario.close()
  })

  it('reconciles an old unknown date effect outside the bounded projection window', async () => {
    const { scenario, databasePath } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    await scenario.close()
    const repository = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    })
    await repository.open()
    const actor = Object.freeze({
      kind: 'owner' as const,
      id: 'owner-calendar-scenario',
      organizationId: 'organization-calendar-scenario',
      teamId: 'team-calendar-scenario',
    })
    const bulkSchedules = Object.freeze([
      allDay('2026-10-10', '2026-10-11'),
      allDay('2026-10-12', '2026-10-13'),
    ])
    let projectRevision = 2
    let milestoneRevision = 1
    let currentSchedule = allDay('2026-09-10', '2026-09-11')
    let currentVersion = `sha256:${'1'.repeat(64)}`
    for (let index = 0; index < 101; index += 1) {
      const suffix = String(index).padStart(3, '0')
      const preparedAt = new Date(Date.parse('2026-09-01T00:00:00.000Z') + index * 60_000)
        .toISOString()
      const claimedAt = new Date(Date.parse(preparedAt) + 1_000).toISOString()
      const settledAt = new Date(Date.parse(preparedAt) + 2_000).toISOString()
      const schedule = bulkSchedules[index % bulkSchedules.length]
      if (schedule === undefined) throw new Error('bulk Calendar schedule disappeared')
      const nextVersion = `sha256:${(index + 2).toString(16).padStart(64, '0')}`
      const effectId = `effect-calendar-window-${suffix}`
      const reservation = await repository.reserveFeishuCalendarDateUpdate(Object.freeze({
        effectId,
        changeId: `schedule-change-window-reserve-${suffix}`,
        projectId: PROJECT_ID,
        milestoneId: 'milestone-calendar-scenario',
        expectedRevision: projectRevision,
        expectedMilestoneRevision: milestoneRevision,
        expectedRemoteObservationVersion: currentVersion,
        observed: event(currentSchedule, currentVersion),
        schedule,
        preparedAt,
        command: Object.freeze({
          commandId: `command-calendar-window-${suffix}`,
          auditEventId: `audit-calendar-window-${suffix}`,
          outboxId: `outbox-calendar-window-${suffix}`,
          idempotencyKey: `feishu-calendar-window-key-${suffix}`,
          causationId: `feishu-calendar-window-cause-${suffix}`,
          reason: 'owner-project-milestone-date-update',
          actor,
          occurredAt: preparedAt,
        }),
      }), signal)
      expect(reservation.state).toBe('deliver')
      await expect(repository.claimFeishuCalendarEffect(effectId, claimedAt, signal))
        .resolves.toBe(true)
      await expect(repository.settleFeishuCalendarDateUpdate(effectId, Object.freeze({
        state: 'delivered',
        event: event(schedule, nextVersion),
        changeId: `schedule-change-window-delivered-${suffix}`,
        settledAt,
      }), signal)).resolves.toMatchObject({ ok: true })
      projectRevision += 1
      milestoneRevision += 1
      currentSchedule = schedule
      currentVersion = nextVersion
    }

    const intended = allDay('2026-11-10', '2026-11-11')
    const unknownPreparedAt = '2026-08-31T06:30:00.000Z'
    const unknownEffectId = 'effect-calendar-window-unknown'
    const unknownMutation = Object.freeze({
      effectId: unknownEffectId,
      changeId: 'schedule-change-window-unknown-reserve',
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: projectRevision,
      expectedMilestoneRevision: milestoneRevision,
      expectedRemoteObservationVersion: currentVersion,
      observed: event(currentSchedule, currentVersion),
      schedule: intended,
      preparedAt: unknownPreparedAt,
      command: Object.freeze({
        commandId: 'command-calendar-window-unknown',
        auditEventId: 'audit-calendar-window-unknown',
        outboxId: 'outbox-calendar-window-unknown',
        idempotencyKey: 'feishu-calendar-window-unknown-key',
        causationId: 'feishu-calendar-window-unknown-cause',
        reason: 'owner-project-milestone-date-update' as const,
        actor,
        occurredAt: unknownPreparedAt,
      }),
    })
    await expect(repository.reserveFeishuCalendarDateUpdate(unknownMutation, signal))
      .resolves.toMatchObject({ state: 'deliver' })
    await expect(repository.claimFeishuCalendarEffect(
      unknownEffectId,
      '2026-10-01T00:01:00.000Z',
      signal,
    )).resolves.toBe(true)
    await expect(repository.settleFeishuCalendarDateUpdate(unknownEffectId, Object.freeze({
      state: 'unknown',
      issue: Object.freeze({
        code: 'unknown-provider-error',
        recovery: 'inspect-provider',
        missingScopes: Object.freeze([]),
        grantPlane: null,
        retryAt: null,
      }),
      settledAt: '2026-10-01T00:02:00.000Z',
    }), signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-outcome-unknown' },
    })
    projectRevision += 1
    const projectedWithOldUnknown = await repository.readProjectMilestones({
      organizationId: actor.organizationId,
      teamId: actor.teamId,
      projectId: PROJECT_ID,
    }, signal)
    expect(projectedWithOldUnknown?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effectId: unknownEffectId, state: 'unknown' }),
    ]))

    const unmatchedSchedule = allDay('2026-11-12', '2026-11-13')
    await expect(repository.commitFeishuCalendarReconciliation(Object.freeze({
      projectId: PROJECT_ID,
      expectedRevision: projectRevision,
      observations: Object.freeze([Object.freeze({
        event: event(unmatchedSchedule, `sha256:${'d'.repeat(64)}`),
        changeId: 'schedule-change-window-unmatched',
      })]),
      attemptedAt: '2026-10-02T00:00:00.000Z',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { sync: { state: 'unknown' } },
    })
    projectRevision += 1

    await expect(repository.commitFeishuCalendarReconciliation(Object.freeze({
      projectId: PROJECT_ID,
      expectedRevision: projectRevision,
      observations: Object.freeze([Object.freeze({
        event: event(intended, `sha256:${'e'.repeat(64)}`),
        changeId: 'schedule-change-window-matched',
      })]),
      attemptedAt: '2026-10-03T00:00:00.000Z',
    }), signal)).resolves.toMatchObject({
      ok: true,
      value: { sync: { state: 'healthy' } },
    })
    await expect(repository.reserveFeishuCalendarDateUpdate(unknownMutation, signal))
      .resolves.toMatchObject({ state: 'replay', result: { ok: true } })
    await expect(repository.verifyAuditChain(signal)).resolves.toMatchObject({ valid: true })
    await repository.close()
  })

  it('continues reconciling healthy events when one bound event cannot be read', async () => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    const secondEventId = 'event-scenario-secondary'
    const secondInitial = eventFor(
      secondEventId,
      allDay('2026-09-14', '2026-09-15'),
      `sha256:${'8'.repeat(64)}`,
    )
    adapter.additionalEvents.set(secondEventId, secondInitial)
    await expect(scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'existing-event',
      eventId: secondEventId,
      expectedRevision: 2,
      expectedMilestoneRevision: null,
      name: 'Secondary checkpoint',
      description: null,
      idempotencyKey: 'feishu-milestone-secondary-0001',
      causationId: 'feishu-milestone-secondary-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)).resolves.toMatchObject({ ok: true, value: { revision: 3 } })

    adapter.currentEvent = event(
      allDay('2026-09-20', '2026-09-21'),
      `sha256:${'9'.repeat(64)}`,
    )
    adapter.readFailures.set(secondEventId, Object.freeze({
      code: 'resource-not-found',
      recovery: 'check-resource-id',
      missingScopes: Object.freeze([]),
      grantPlane: null,
      retryAt: null,
    }))
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 3,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 5,
        sync: { state: 'attention', issue: { code: 'resource-not-found' } },
        milestones: [
          { revision: 2, schedule: adapter.currentEvent.schedule, syncState: 'healthy' },
          { revision: 2, schedule: secondInitial.schedule, syncState: 'attention' },
        ],
        recentChanges: expect.arrayContaining([
          expect.objectContaining({ projectRevision: 5, changedFields: ['remote-eligibility'] }),
          expect.objectContaining({ projectRevision: 4, changedFields: ['schedule'] }),
        ]),
      },
    })

    adapter.readFailures.delete(secondEventId)
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 5,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 6,
        sync: { state: 'healthy', issue: null },
        milestones: [
          { revision: 2, syncState: 'healthy' },
          { revision: 3, syncState: 'healthy' },
        ],
        recentChanges: expect.arrayContaining([
          expect.objectContaining({ projectRevision: 6, changedFields: ['remote-eligibility'] }),
        ]),
      },
    })
    await scenario.close()
  })

  it('uses distinct deterministic fallback change IDs across failure recovery', async () => {
    const { scenario, adapter } = await fixture(idsWithoutScheduleChangeGenerator())
    await bindExistingCalendarAndMilestone(scenario)
    adapter.readFailures.set(EVENT_ID, Object.freeze({
      code: 'resource-not-found',
      recovery: 'check-resource-id',
      missingScopes: Object.freeze([]),
      grantPlane: null,
      retryAt: null,
    }))
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, milestones: [{ revision: 2, syncState: 'attention' }] },
    })

    adapter.readFailures.delete(EVENT_ID)
    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 3,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        sync: { state: 'healthy' },
        milestones: [{ revision: 3, syncState: 'healthy' }],
        recentChanges: expect.arrayContaining([
          expect.objectContaining({
            projectRevision: 4,
            changedFields: ['remote-eligibility'],
          }),
          expect.objectContaining({
            projectRevision: 3,
            changedFields: ['remote-eligibility'],
          }),
        ]),
      },
    })
    await scenario.close()
  })

  it.each([
    ['organizer', { organizerCalendarId: 'calendar-drifted-organizer' }],
    ['recurring', { recurring: true }],
    ['exception', { exception: true }],
  ] as const)('persists %s drift as attention and blocks a later date PATCH', async (_label, drift) => {
    const { scenario, adapter } = await fixture()
    await bindExistingCalendarAndMilestone(scenario)
    adapter.currentEvent = Object.freeze({
      ...event(undefined, `sha256:${'6'.repeat(64)}`),
      ...drift,
    })

    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        sync: { state: 'attention' },
        milestones: [{
          revision: 2,
          syncState: 'attention',
          remoteObservationVersion: `sha256:${'6'.repeat(64)}`,
        }],
        recentChanges: expect.arrayContaining([
          expect.objectContaining({ source: 'feishu', changedFields: ['remote-eligibility'] }),
        ]),
      },
    })
    await expect(scenario.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({
        revision: 3,
        sync: { state: 'attention' },
        milestones: [{ revision: 2, syncState: 'attention' }],
      })
    await expect(scenario.updateProjectMilestoneDate({
      projectId: PROJECT_ID,
      milestoneId: 'milestone-calendar-scenario',
      expectedRevision: 3,
      expectedMilestoneRevision: 2,
      expectedRemoteObservationVersion: `sha256:${'6'.repeat(64)}`,
      schedule: allDay('2026-10-02', '2026-10-03'),
      idempotencyKey: `feishu-milestone-date-drift-${_label}-0001`,
      causationId: `feishu-milestone-date-drift-${_label}-cause-0001`,
      reason: 'owner-project-milestone-date-update',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'event-not-selectable' },
    })
    expect(adapter.updateCalls).toBe(0)
    await scenario.close()
  })
})
