import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateProjectRequest,
  FeishuCredentialProjection,
  ProjectCalendarSchedule,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
} from '../src/client.ts'
import type { WorkbenchAuthorization } from '../src/authorization.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
} from '../src/project-template.ts'
import { SqliteWorkbenchRepository } from '../src/sqlite-repository.ts'
import {
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchFeishuExternalAdapter,
  type WorkbenchIdGenerator,
} from '../src/scenario.ts'
import type {
  WorkbenchFeishuCalendarChangeListener,
  WorkbenchFeishuCalendarChangeNotification,
  WorkbenchFeishuCalendarEventSnapshot,
  WorkbenchFeishuCalendarExternalAdapter,
  WorkbenchFeishuCalendarRoute,
  WorkbenchFeishuCalendarSnapshot,
} from '../src/feishu-calendar-federation.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuWriteResult,
} from '../src/feishu-task-federation.ts'

const PROJECT_ID = 'project-calendar-repair'
const CALENDAR_ID = 'calendar-repair'
const EVENT_ID = 'event-repair'
const APP_ID = 'cli_calendar_repair'
const OPEN_ID = 'ou_calendar_repair'
const signal = new AbortController().signal

const authorization: WorkbenchAuthorization = Object.freeze({
  require: async () => Object.freeze({
    ownerId: 'owner-calendar-repair',
    organizationId: 'organization-calendar-repair',
    teamId: 'team-calendar-repair',
  }),
  filterProjection: async <T>(_action: string, projection: T) => projection,
})

function allDay(startDate: string, endDate: string): ProjectCalendarSchedule {
  return Object.freeze({ kind: 'all-day', startDate, endDate })
}

function calendar(): WorkbenchFeishuCalendarSnapshot {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    summary: 'Repair calendar',
    description: null,
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  })
}

function event(
  schedule = allDay('2026-09-10', '2026-09-11'),
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
    observedAt: '2026-09-01T00:00:00.000Z',
  })
}

class RepairCalendarAdapter implements
WorkbenchFeishuExternalAdapter, WorkbenchFeishuCalendarExternalAdapter {
  readonly adapterId = 'repair-calendar-adapter'
  currentEvent = event()
  readEventCalls = 0
  activeReads = 0
  unsubscribeCalls = 0
  lastReadSignal: AbortSignal | null = null
  private listener: WorkbenchFeishuCalendarChangeListener | null = null
  private blockedRead: {
    readonly started: ReturnType<typeof Promise.withResolvers<void>>
    readonly aborted: ReturnType<typeof Promise.withResolvers<void>>
    readonly release: ReturnType<typeof Promise.withResolvers<void>>
    readonly settled: ReturnType<typeof Promise.withResolvers<void>>
  } | null = null

  get subscribed(): boolean {
    return this.listener !== null
  }

  blockNextRead(): Readonly<{
    started: Promise<void>
    aborted: Promise<void>
    settled: Promise<void>
    release: () => void
  }> {
    if (this.blockedRead !== null) throw new Error('fixture Calendar read is already blocked')
    const block = {
      started: Promise.withResolvers<void>(),
      aborted: Promise.withResolvers<void>(),
      release: Promise.withResolvers<void>(),
      settled: Promise.withResolvers<void>(),
    }
    this.blockedRead = block
    return Object.freeze({
      started: block.started.promise,
      aborted: block.aborted.promise,
      settled: block.settled.promise,
      release: () => { block.release.resolve() },
    })
  }

  releaseBlockedRead(): void {
    this.blockedRead?.release.resolve()
  }

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
        displayLabel: 'Repair Calendar Bot',
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
    operationSignal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarEventSnapshot>> {
    this.readEventCalls += 1
    this.lastReadSignal = operationSignal
    if (calendarId !== CALENDAR_ID || eventId !== EVENT_ID) {
      throw new Error('fixture event identity changed')
    }
    const block = this.blockedRead
    if (block !== null) {
      this.activeReads += 1
      const onAbort = () => { block.aborted.resolve() }
      if (operationSignal.aborted) onAbort()
      else operationSignal.addEventListener('abort', onAbort, { once: true })
      block.started.resolve()
      try {
        await block.release.promise
        if (operationSignal.aborted) {
          throw operationSignal.reason ?? new Error('fixture Calendar read was aborted')
        }
      } finally {
        operationSignal.removeEventListener('abort', onAbort)
        this.activeReads -= 1
        block.settled.resolve()
        if (this.blockedRead === block) this.blockedRead = null
      }
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
    return Object.freeze({ state: 'ok', value: this.currentEvent })
  }

  subscribeCalendarChanges(listener: WorkbenchFeishuCalendarChangeListener): () => void {
    this.listener = listener
    return () => {
      this.unsubscribeCalls += 1
      if (this.listener === listener) this.listener = null
    }
  }

  async emit(notification: WorkbenchFeishuCalendarChangeNotification): Promise<void> {
    if (this.listener === null) throw new Error('fixture Calendar listener is not installed')
    await this.listener(notification)
  }
}

function ids(): WorkbenchIdGenerator {
  let command = 0
  let audit = 0
  let outbox = 0
  let change = 0
  return Object.freeze({
    nextStatusId: () => 'status-calendar-repair',
    nextProjectId: () => PROJECT_ID,
    nextProjectMemberId: () => 'member-calendar-repair',
    nextSuggestedChangeId: () => 'suggested-calendar-repair',
    nextSuggestedChangeDecisionId: () => 'decision-calendar-repair',
    nextFeishuVerificationId: () => 'verification-calendar-repair',
    nextGoalId: () => 'goal-calendar-repair',
    nextOutcomeId: () => 'outcome-calendar-repair',
    nextCommandId: () => `command-calendar-repair-${String(++command).padStart(3, '0')}`,
    nextAuditEventId: () => `audit-calendar-repair-${String(++audit).padStart(3, '0')}`,
    nextOutboxId: () => `outbox-calendar-repair-${String(++outbox).padStart(3, '0')}`,
    nextMilestoneId: () => 'milestone-calendar-repair',
    nextScheduleChangeId: () => `schedule-change-repair-${String(++change).padStart(3, '0')}`,
  })
}

function clock(): WorkbenchClock {
  let milliseconds = Date.parse('2026-09-01T00:00:00.000Z')
  return Object.freeze({ now: () => new Date(milliseconds += 1_000) })
}

function projectRequest(): CreateProjectRequest {
  return Object.freeze({
    template: Object.freeze({
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    }),
    projectName: 'Calendar repair project',
    primaryGoal: Object.freeze({
      name: 'Prove Calendar repair',
      outcomes: Object.freeze([Object.freeze({
        name: 'Convergent schedule',
        metric: Object.freeze({
          metricName: 'Cases',
          initialValue: 0,
          targetValue: 3,
          unit: 'cases',
          direction: 'increase',
        }),
      })]),
    }),
    supportingGoals: Object.freeze([]),
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'project-calendar-repair-key-0001',
    causationId: 'project-calendar-repair-cause-0001',
    reason: 'owner-project-create',
  })
}

interface ManagedFixture {
  readonly scenario: WorkbenchScenario
  readonly adapter: RepairCalendarAdapter
}

const managedFixtures = new Set<ManagedFixture>()

async function fixture(calendarReconciliationIntervalMs = 0): Promise<ManagedFixture> {
  const adapter = new RepairCalendarAdapter()
  const scenario = new WorkbenchScenario({
    repository: new SqliteWorkbenchRepository({
      databasePath: ':memory:',
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    }),
    clock: clock(),
    ids: ids(),
    adapters: Object.freeze({ feishu: adapter, feishuCalendars: adapter }),
    authorization,
    maxStatusLength: 280,
    calendarReconciliationIntervalMs,
  })
  const managed = Object.freeze({ scenario, adapter })
  managedFixtures.add(managed)
  await scenario.open()
  await scenario.createProject(projectRequest(), signal)
  await scenario.configureFeishuIdentityRoute({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_CALENDAR_REPAIR_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'feishu-calendar-repair-configure-0001',
    causationId: 'feishu-calendar-repair-configure-cause-0001',
    reason: 'owner-feishu-route-configure',
  }, signal)
  await scenario.verifyFeishuIdentityRoute({
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'feishu-calendar-repair-verify-0001',
    causationId: 'feishu-calendar-repair-verify-cause-0001',
    reason: 'owner-feishu-route-verify',
  }, signal)
  await scenario.bindProjectCalendar({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    calendarId: CALENDAR_ID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'feishu-calendar-repair-bind-0001',
    causationId: 'feishu-calendar-repair-bind-cause-0001',
    reason: 'owner-project-calendar-bind',
  }, signal)
  await scenario.createProjectMilestone({
    projectId: PROJECT_ID,
    mode: 'existing-event',
    eventId: EVENT_ID,
    expectedRevision: 1,
    expectedMilestoneRevision: null,
    name: 'Repair checkpoint',
    description: null,
    idempotencyKey: 'feishu-calendar-repair-milestone-0001',
    causationId: 'feishu-calendar-repair-milestone-cause-0001',
    reason: 'owner-project-milestone-create',
  }, signal)
  adapter.readEventCalls = 0
  return managed
}

describe('T10 Calendar notification repair and lifecycle', () => {
  afterEach(async () => {
    try {
      await Promise.all([...managedFixtures].map(async managed => {
        managed.adapter.releaseBlockedRead()
        await managed.scenario.close()
        managedFixtures.delete(managed)
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('deduplicates one notification envelope before a second reconcile or change fact', async () => {
    const { scenario, adapter } = await fixture()
    const notification = Object.freeze({
      eventEnvelopeId: 'calendar-envelope-duplicate-0001',
      calendarId: CALENDAR_ID,
      eventId: null,
      observedAt: '2026-09-01T00:05:00.000Z',
    })
    adapter.currentEvent = event(
      allDay('2026-09-12', '2026-09-13'),
      `sha256:${'2'.repeat(64)}`,
    )
    await adapter.emit(notification)

    adapter.currentEvent = event(
      allDay('2026-09-14', '2026-09-15'),
      `sha256:${'3'.repeat(64)}`,
    )
    await adapter.emit(notification)

    await expect(scenario.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({
        revision: 3,
        milestones: [{
          revision: 2,
          schedule: { startDate: '2026-09-12', endDate: '2026-09-13' },
        }],
        recentChanges: [
          { source: 'feishu', changedFields: ['schedule'] },
          { source: 'workbench', beforeSchedule: null },
        ],
      })
    expect(adapter.readEventCalls).toBe(1)
  })

  it('repairs missing notifications through manual and periodic reconciliation', async () => {
    vi.useFakeTimers()
    const { scenario, adapter } = await fixture(30_000)
    adapter.currentEvent = event(
      allDay('2026-09-16', '2026-09-17'),
      `sha256:${'4'.repeat(64)}`,
    )

    await expect(scenario.reconcileProjectCalendar({
      projectId: PROJECT_ID,
      expectedRevision: 2,
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        milestones: [{ schedule: { startDate: '2026-09-16', endDate: '2026-09-17' } }],
      },
    })

    adapter.currentEvent = event(
      allDay('2026-09-18', '2026-09-19'),
      `sha256:${'5'.repeat(64)}`,
    )
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(scenario.getProjectMilestones({ projectId: PROJECT_ID }, signal))
      .resolves.toMatchObject({
        revision: 4,
        milestones: [{
          revision: 3,
          schedule: { startDate: '2026-09-18', endDate: '2026-09-19' },
        }],
        recentChanges: [
          { source: 'feishu', changedFields: ['schedule'] },
          { source: 'feishu', changedFields: ['schedule'] },
          { source: 'workbench', beforeSchedule: null },
        ],
      })
    expect(adapter.readEventCalls).toBe(2)
  })

  it('unsubscribes, clears its timer, aborts periodic repair, and waits for quiescence', async () => {
    vi.useFakeTimers()
    const { scenario, adapter } = await fixture(30_000)
    const blocked = adapter.blockNextRead()
    expect(adapter.subscribed).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    const timerAdvance = vi.advanceTimersByTimeAsync(30_000)
    await blocked.started
    expect(adapter.activeReads).toBe(1)

    let closeSettled = false
    const closing = scenario.close().then(() => { closeSettled = true })
    await blocked.aborted
    await Promise.resolve()

    expect(adapter.subscribed).toBe(false)
    expect(adapter.unsubscribeCalls).toBe(1)
    expect(adapter.lastReadSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(closeSettled).toBe(false)

    blocked.release()
    await Promise.all([blocked.settled, timerAdvance, closing])
    expect(adapter.activeReads).toBe(0)
    expect(scenario.lifecycle).toBe('closed')

    const settledCalls = adapter.readEventCalls
    await vi.advanceTimersByTimeAsync(60_000)
    expect(adapter.readEventCalls).toBe(settledCalls)
    await expect(adapter.emit(Object.freeze({
      eventEnvelopeId: 'calendar-envelope-after-close-0001',
      calendarId: CALENDAR_ID,
      eventId: EVENT_ID,
      observedAt: '2026-09-01T00:10:00.000Z',
    }))).rejects.toThrow('fixture Calendar listener is not installed')
  })
})
