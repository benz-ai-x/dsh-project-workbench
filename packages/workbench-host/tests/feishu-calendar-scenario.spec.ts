import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  ProjectCalendarSchedule,
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

class FixtureCalendarAdapter implements
WorkbenchFeishuExternalAdapter, WorkbenchFeishuCalendarExternalAdapter {
  readonly adapterId = 'fixture-calendar-adapter'
  currentEvent = event()
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
    if (calendarId !== CALENDAR_ID || eventId !== EVENT_ID) {
      throw new Error('fixture event identity changed')
    }
    return Object.freeze({ state: 'ok', value: this.currentEvent })
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
    nextMilestoneId: () => 'milestone-calendar-scenario',
    nextScheduleChangeId: () => `schedule-change-${String(++change).padStart(3, '0')}`,
  })
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

function scenarioFor(databasePath: string, adapter: FixtureCalendarAdapter): WorkbenchScenario {
  return new WorkbenchScenario({
    repository: new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    }),
    clock: clock(),
    ids: ids(),
    adapters: Object.freeze({ feishu: adapter, feishuCalendars: adapter }),
    authorization,
    maxStatusLength: 280,
  })
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-calendar-scenario-'))
  temporaryRoots.add(root)
  const databasePath = join(root, 'workbench.sqlite')
  const adapter = new FixtureCalendarAdapter()
  const scenario = scenarioFor(databasePath, adapter)
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
})
