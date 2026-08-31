import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WorkbenchAuthorization } from '../src/authorization.ts'
import type {
  CreateProjectDeliverableRequest,
  CreateProjectRequest,
  DecideDeliverableAcceptanceRequest,
  DeliverableArtifactVersionRef,
  FeishuCredentialProjection,
  FeishuTaskListCandidateProjection,
  ProjectCalendarSchedule,
  ProjectDeliverablesProjection,
  RequestDeliverableAcceptanceRequest,
  WorkbenchFeishuIdentityVerificationInput,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
} from '../src/client.ts'
import { KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1 } from '../src/project-template.ts'
import {
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
} from '../src/sqlite-repository.ts'
import {
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchFeishuExternalAdapter,
  type WorkbenchIdGenerator,
} from '../src/scenario.ts'
import type {
  WorkbenchFeishuCalendarChangeListener,
  WorkbenchFeishuCalendarEventSnapshot,
  WorkbenchFeishuCalendarExternalAdapter,
  WorkbenchFeishuCalendarRoute,
  WorkbenchFeishuCalendarSnapshot,
} from '../src/feishu-calendar-federation.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuTaskEventListener,
  WorkbenchFeishuTaskExternalAdapter,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
  WorkbenchFeishuWriteResult,
} from '../src/feishu-task-federation.ts'

const temporaryRoots = new Set<string>()
const signal = new AbortController().signal
const PROJECT_ID = 'project-deliverable-scenario'
const CALENDAR_ID = 'calendar-deliverable-scenario'
const TASK_LIST_GUID = 'tasklist-deliverable-scenario'
const TASK_GUID = 'task-deliverable-scenario'
const SECOND_TASK_GUID = 'task-deliverable-scenario-secondary'
const APP_ID = 'cli_deliverable_scenario'
const OPEN_ID = 'ou_deliverable_scenario'

const allDay = (startDate: string, endDate: string): ProjectCalendarSchedule => Object.freeze({
  kind: 'all-day',
  startDate,
  endDate,
})

const authorization: WorkbenchAuthorization = Object.freeze({
  require: async () => Object.freeze({
    ownerId: 'owner-deliverable-scenario',
    organizationId: 'organization-deliverable-scenario',
    teamId: 'team-deliverable-scenario',
  }),
  filterProjection: async <T>(_action: string, projection: T) => projection,
})

function taskSnapshot(
  version = 'task-version-1',
  taskGuid = TASK_GUID,
): WorkbenchFeishuTaskSnapshot {
  return Object.freeze({
    taskGuid,
    taskId: null,
    parentTaskGuid: null,
    summary: taskGuid === TASK_GUID
      ? 'Prepare the exact Deliverable candidate'
      : 'Review the secondary Deliverable evidence',
    description: 'Provider-owned execution truth',
    assignees: Object.freeze([]),
    followers: Object.freeze([]),
    comments: Object.freeze([]),
    completed: false,
    completedAt: null,
    canonicalUrl: `https://applink.feishu.cn/client/todo/detail?guid=${taskGuid}`,
    remoteVersion: version,
  })
}

function calendarSnapshot(): WorkbenchFeishuCalendarSnapshot {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    summary: 'Deliverable calendar',
    description: null,
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  })
}

function calendarEvent(
  eventId: string,
  versionCharacter: string,
  schedule: ProjectCalendarSchedule = allDay('2026-09-10', '2026-09-11'),
): WorkbenchFeishuCalendarEventSnapshot {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    eventId,
    organizerCalendarId: CALENDAR_ID,
    summary: `Provider ${eventId}`,
    description: null,
    schedule,
    status: 'confirmed',
    recurring: false,
    exception: false,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${eventId}`,
    remoteObservationVersion: `sha256:${versionCharacter.repeat(64)}`,
    observedAt: '2026-09-01T00:00:00.000Z',
  })
}

class DeliverableAdapter implements WorkbenchFeishuExternalAdapter,
WorkbenchFeishuTaskExternalAdapter, WorkbenchFeishuCalendarExternalAdapter {
  readonly adapterId = 'deliverable-fixture-adapter'
  readonly events = new Map<string, WorkbenchFeishuCalendarEventSnapshot>([
    ['event-deliverable-1', calendarEvent('event-deliverable-1', '1')],
    ['event-deliverable-2', calendarEvent('event-deliverable-2', '2')],
    ['event-deliverable-3', calendarEvent('event-deliverable-3', '3')],
  ])
  createEventMode: 'ok' | 'unknown' | 'throw' = 'ok'
  createEventCalls = 0
  readEventCalls = 0
  calendarListReads = 0
  taskAvailable = true
  secondTaskAvailable = false
  onReadEvent: (() => void) | null = null
  createEventGate: Promise<void> | null = null
  lastCreateEventRoute: WorkbenchFeishuCalendarRoute | null = null
  lastCreateEventInput: Readonly<{
    readonly calendarId: string
    readonly idempotencyKey: string
    readonly summary: string
    readonly description: string | null
    readonly schedule: ProjectCalendarSchedule
  }> | null = null
  private calendarListener: WorkbenchFeishuCalendarChangeListener | null = null
  private taskListener: WorkbenchFeishuTaskEventListener | null = null

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    return Object.freeze({ ref, configured: true, source: 'fixture', writable: false })
  }

  async startIdentityVerification(
    input: Readonly<WorkbenchFeishuIdentityVerificationInput>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    if (input.kind !== 'bot' || input.appId !== APP_ID) {
      throw new Error('Deliverable fixture received an unexpected identity route')
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
        displayLabel: 'Deliverable Fixture Bot',
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

  async listTaskLists(
    _route: WorkbenchFeishuTaskRoute,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskListCandidateProjection[]>> {
    return Object.freeze({ state: 'ok', value: Object.freeze([this.taskList().taskList]) })
  }

  async createTaskList(
    _route: WorkbenchFeishuTaskRoute,
    _input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<FeishuTaskListCandidateProjection>> {
    return Object.freeze({ state: 'ok', value: this.taskList().taskList })
  }

  async readTaskList(
    _route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskListSnapshot>> {
    if (taskListGuid !== TASK_LIST_GUID) throw new Error('Deliverable task-list identity changed')
    return Object.freeze({ state: 'ok', value: this.taskList() })
  }

  async readTask(
    _route: WorkbenchFeishuTaskRoute,
    taskGuid: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskSnapshot>> {
    if (taskGuid === TASK_GUID && this.taskAvailable) {
      return Object.freeze({ state: 'ok', value: taskSnapshot() })
    }
    if (taskGuid === SECOND_TASK_GUID && this.secondTaskAvailable) {
      return Object.freeze({ state: 'ok', value: taskSnapshot('task-version-secondary-1', taskGuid) })
    }
    return Object.freeze({ state: 'rejected', issue: providerIssue() })
  }

  async updateTask(
    _route: WorkbenchFeishuTaskRoute,
    _input: Readonly<{
      readonly taskGuid: string
      readonly expectedRemoteVersion: string
      readonly idempotencyKey: string
      readonly changes: WorkbenchFeishuTaskPatch
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskSnapshot>> {
    return Object.freeze({ state: 'ok', value: taskSnapshot('task-version-2') })
  }

  subscribeTaskEvents(listener: WorkbenchFeishuTaskEventListener): () => void {
    this.taskListener = listener
    return () => { if (this.taskListener === listener) this.taskListener = null }
  }

  async listCalendars(
    _route: WorkbenchFeishuCalendarRoute,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarSnapshot[]>> {
    this.calendarListReads += 1
    return Object.freeze({ state: 'ok', value: Object.freeze([calendarSnapshot()]) })
  }

  async readCalendar(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarSnapshot>> {
    if (calendarId !== CALENDAR_ID) throw new Error('Deliverable Calendar identity changed')
    return Object.freeze({ state: 'ok', value: calendarSnapshot() })
  }

  async createCalendar(
    _route: WorkbenchFeishuCalendarRoute,
    _input: Readonly<{ readonly summary: string; readonly description: string | null }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarSnapshot>> {
    return Object.freeze({ state: 'ok', value: calendarSnapshot() })
  }

  async listCalendarEvents(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarEventSnapshot[]>> {
    if (calendarId !== CALENDAR_ID) throw new Error('Deliverable Calendar identity changed')
    return Object.freeze({ state: 'ok', value: Object.freeze([...this.events.values()]) })
  }

  async readCalendarEvent(
    _route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    eventId: string,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarEventSnapshot>> {
    this.readEventCalls += 1
    if (calendarId !== CALENDAR_ID) throw new Error('Deliverable Calendar identity changed')
    const value = this.events.get(eventId)
    if (value === undefined) return Object.freeze({ state: 'rejected', issue: providerIssue() })
    this.onReadEvent?.()
    return Object.freeze({ state: 'ok', value })
  }

  async createCalendarEvent(
    route: WorkbenchFeishuCalendarRoute,
    input: Readonly<{
      readonly calendarId: string
      readonly idempotencyKey: string
      readonly summary: string
      readonly description: string | null
      readonly schedule: ProjectCalendarSchedule
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>> {
    this.createEventCalls += 1
    this.lastCreateEventRoute = route
    this.lastCreateEventInput = Object.freeze({ ...input, schedule: Object.freeze({ ...input.schedule }) })
    await this.createEventGate
    if (this.createEventMode === 'throw') throw new Error('ambiguous Deliverable Calendar transport')
    if (this.createEventMode === 'unknown') {
      return Object.freeze({ state: 'unknown', issue: providerIssue() })
    }
    const value = calendarEvent('event-created-deliverable', '9', input.schedule)
    this.events.set(value.eventId, value)
    return Object.freeze({ state: 'ok', value })
  }

  async updateCalendarEventSchedule(
    _route: WorkbenchFeishuCalendarRoute,
    input: Readonly<{
      readonly calendarId: string
      readonly eventId: string
      readonly expectedRemoteObservationVersion: string
      readonly schedule: ProjectCalendarSchedule
    }>,
    _signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>> {
    const current = this.events.get(input.eventId)
    if (current === undefined) return Object.freeze({ state: 'rejected', issue: providerIssue() })
    return Object.freeze({ state: 'ok', value: Object.freeze({ ...current, schedule: input.schedule }) })
  }

  subscribeCalendarChanges(listener: WorkbenchFeishuCalendarChangeListener): () => void {
    this.calendarListener = listener
    return () => { if (this.calendarListener === listener) this.calendarListener = null }
  }

  async emitCalendar(eventId: string, envelope: number): Promise<void> {
    if (this.calendarListener === null) throw new Error('Calendar listener is not installed')
    await this.calendarListener(Object.freeze({
      eventEnvelopeId: `deliverable-envelope-${String(envelope).padStart(4, '0')}`,
      calendarId: CALENDAR_ID,
      eventId,
      observedAt: '2026-09-01T01:00:00.000Z',
    }))
  }

  private taskList(): WorkbenchFeishuTaskListSnapshot {
    return Object.freeze({
      taskList: Object.freeze({
        taskListGuid: TASK_LIST_GUID,
        name: 'Deliverable execution tasks',
        canonicalUrl: 'https://applink.feishu.cn/client/todo/deliverable-list',
        remoteVersion: 'task-list-version-1',
      }),
      tasks: Object.freeze([
        ...(this.taskAvailable ? [taskSnapshot()] : []),
        ...(this.secondTaskAvailable
          ? [taskSnapshot('task-version-secondary-1', SECOND_TASK_GUID)]
          : []),
      ]),
      observedAt: '2026-09-01T00:00:00.000Z',
    })
  }
}

function providerIssue() {
  return Object.freeze({
    code: 'provider-unavailable' as const,
    recovery: 'retry-later' as const,
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function deliverableDatabaseSnapshot(databasePath: string): object {
  const database = new DatabaseSync(databasePath)
  try {
    const count = (table: string): number => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        readonly count: number
      }
      return row.count
    }
    return Object.freeze({
      deliverableHead: database.prepare(`
        SELECT revision, updated_at FROM workbench_project_deliverable_head
        WHERE project_id = ?
      `).get(PROJECT_ID),
      calendarHead: database.prepare(`
        SELECT revision, sync_state, updated_at FROM workbench_project_calendar_head
        WHERE project_id = ?
      `).get(PROJECT_ID),
      auditHead: database.prepare(`
        SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1
      `).get(),
      counts: Object.freeze({
        deliverables: count('workbench_project_deliverable'),
        members: count('workbench_project_deliverable_member'),
        commitments: count('workbench_calendar_commitment'),
        scheduleChanges: count('workbench_project_schedule_change'),
        requests: count('workbench_deliverable_acceptance_request'),
        candidates: count('workbench_deliverable_candidate_version'),
        decisions: count('workbench_deliverable_acceptance_decision'),
        releases: count('workbench_deliverable_final_release'),
        releaseVersions: count('workbench_deliverable_final_release_version'),
        activity: count('workbench_deliverable_activity'),
        effects: count('workbench_deliverable_calendar_effect'),
        audit: count('workbench_audit_event'),
        outbox: count('workbench_outbox'),
        receipts: count('workbench_command_receipt'),
      }),
    })
  } finally {
    database.close()
  }
}

function installDeliverableFault(
  databasePath: string,
  name: string,
  point: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      CREATE TRIGGER ${name} ${point}
      BEGIN SELECT RAISE(ABORT, 'injected T11 rollback failure'); END
    `)
  } finally {
    database.close()
  }
}

function removeDeliverableFault(databasePath: string, name: string): void {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`DROP TRIGGER ${name}`)
  } finally {
    database.close()
  }
}

function ids(): WorkbenchIdGenerator {
  const counters = new Map<string, number>()
  const next = (kind: string): string => {
    const value = (counters.get(kind) ?? 0) + 1
    counters.set(kind, value)
    return `${kind}-deliverable-${String(value).padStart(4, '0')}`
  }
  return Object.freeze({
    nextStatusId: () => 'status-deliverable-scenario',
    nextProjectId: () => PROJECT_ID,
    nextProjectMemberId: () => next('member'),
    nextSuggestedChangeId: () => next('suggested'),
    nextSuggestedChangeDecisionId: () => next('suggested-decision'),
    nextFeishuVerificationId: () => next('verification'),
    nextGoalId: () => next('goal'),
    nextOutcomeId: () => next('outcome'),
    nextCommandId: () => next('command'),
    nextAuditEventId: () => next('audit'),
    nextOutboxId: () => next('outbox'),
    nextMilestoneId: () => next('milestone'),
    nextScheduleChangeId: () => next('schedule-change'),
    nextDeliverableId: () => next('deliverable'),
    nextDeliverablePlanSnapshotId: () => next('deliverable-plan'),
    nextDeliverableCriterionId: () => next('criterion'),
    nextDeliverableAcceptanceRequestId: () => next('acceptance-request'),
    nextDeliverableDecisionId: () => next('acceptance-decision'),
    nextDeliverableFinalReleaseId: () => next('final-release'),
    nextDeliverableActivityId: () => next('deliverable-activity'),
  })
}

function clock(): WorkbenchClock {
  let time = Date.parse('2026-09-01T00:00:00.000Z')
  return Object.freeze({ now: () => new Date(time += 1_000) })
}

function projectRequest(): CreateProjectRequest {
  return Object.freeze({
    template: Object.freeze({
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    }),
    projectName: 'Deliverable acceptance scenario',
    primaryGoal: Object.freeze({
      name: 'Ship one exact reviewed Deliverable',
      outcomes: Object.freeze([Object.freeze({
        name: 'Accepted candidate set',
        metric: Object.freeze({
          metricName: 'Accepted releases',
          initialValue: 0,
          targetValue: 1,
          unit: 'releases',
          direction: 'increase',
        }),
      })]),
    }),
    supportingGoals: Object.freeze([]),
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'deliverable-project-create-key-0001',
    causationId: 'deliverable-project-create-cause-0001',
    reason: 'owner-project-create',
  })
}

function scenarioFor(
  databasePath: string,
  adapter: DeliverableAdapter,
  access: WorkbenchAuthorization = authorization,
  calendarReconciliationIntervalMs = 0,
): WorkbenchScenario {
  return new WorkbenchScenario({
    repository: new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    }),
    clock: clock(),
    ids: ids(),
    adapters: Object.freeze({
      feishu: adapter,
      feishuTasks: adapter,
      feishuCalendars: adapter,
    }),
    authorization: access,
    maxStatusLength: 280,
    calendarReconciliationIntervalMs,
  })
}

async function fixture(options: Readonly<{
  readonly access?: WorkbenchAuthorization
  readonly calendarReconciliationIntervalMs?: number
  readonly secondTaskAvailable?: boolean
}> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-deliverable-scenario-'))
  temporaryRoots.add(root)
  const databasePath = join(root, 'workbench.sqlite')
  const adapter = new DeliverableAdapter()
  adapter.secondTaskAvailable = options.secondTaskAvailable ?? false
  const scenario = scenarioFor(
    databasePath,
    adapter,
    options.access ?? authorization,
    options.calendarReconciliationIntervalMs ?? 0,
  )
  await scenario.open()
  const created = await scenario.createProject(projectRequest(), signal)
  if (!created.ok) throw new Error('Deliverable fixture Project creation failed')
  await scenario.configureFeishuIdentityRoute({
    kind: 'bot',
    mode: 'set',
    appId: APP_ID,
    credentialRef: 'FEISHU_DELIVERABLE_SCENARIO_SECRET',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'deliverable-feishu-configure-0001',
    causationId: 'deliverable-feishu-configure-cause-0001',
    reason: 'owner-feishu-route-configure',
  }, signal)
  await scenario.verifyFeishuIdentityRoute({
    kind: 'bot',
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'deliverable-feishu-verify-0001',
    causationId: 'deliverable-feishu-verify-cause-0001',
    reason: 'owner-feishu-route-verify',
  }, signal)
  await scenario.addProjectMember({
    projectId: PROJECT_ID,
    member: Object.freeze({
      kind: 'human',
      displayName: 'Deliverable Accountable',
      identity: Object.freeze({ type: 'feishu', appId: APP_ID, openId: 'ou_accountable' }),
    }),
    expectedTeamRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'deliverable-member-accountable-0001',
    causationId: 'deliverable-member-accountable-cause-0001',
    reason: 'owner-project-member-add',
  }, signal)
  await scenario.addProjectMember({
    projectId: PROJECT_ID,
    member: Object.freeze({ kind: 'agent', displayName: 'Deliverable Contributor Agent' }),
    expectedTeamRevision: 1,
    expectedRevision: null,
    idempotencyKey: 'deliverable-member-contributor-0001',
    causationId: 'deliverable-member-contributor-cause-0001',
    reason: 'owner-project-member-add',
  }, signal)
  await scenario.addProjectMember({
    projectId: PROJECT_ID,
    member: Object.freeze({
      kind: 'human',
      displayName: 'Deliverable Acceptor',
      identity: Object.freeze({ type: 'feishu', appId: APP_ID, openId: 'ou_acceptor' }),
    }),
    expectedTeamRevision: 2,
    expectedRevision: null,
    idempotencyKey: 'deliverable-member-acceptor-0001',
    causationId: 'deliverable-member-acceptor-cause-0001',
    reason: 'owner-project-member-add',
  }, signal)
  await scenario.bindFeishuTaskList({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    taskListGuid: TASK_LIST_GUID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'deliverable-task-bind-0001',
    causationId: 'deliverable-task-bind-cause-0001',
    reason: 'owner-feishu-task-list-bind',
  }, signal)
  await scenario.bindProjectCalendar({
    projectId: PROJECT_ID,
    kind: 'bot',
    mode: 'existing',
    calendarId: CALENDAR_ID,
    expectedConnectionRevision: 2,
    expectedRouteGeneration: 1,
    expectedBindingRevision: null,
    idempotencyKey: 'deliverable-calendar-bind-0001',
    causationId: 'deliverable-calendar-bind-cause-0001',
    reason: 'owner-project-calendar-bind',
  }, signal)
  return Object.freeze({ scenario, adapter, databasePath })
}

function createRequest(
  event: CreateProjectDeliverableRequest['event'] = Object.freeze({
    mode: 'existing-event',
    eventId: 'event-deliverable-1',
  }),
  overrides: Partial<CreateProjectDeliverableRequest> = {},
): CreateProjectDeliverableRequest {
  return Object.freeze({
    projectId: PROJECT_ID,
    name: 'Release evidence bundle',
    description: 'The immutable output under formal acceptance.',
    criteria: Object.freeze([
      Object.freeze({ statement: 'The release contains the declared evidence.' }),
      Object.freeze({ statement: 'The execution task has a reviewable outcome.' }),
    ]),
    accountableMemberId: 'member-deliverable-0001',
    contributorMemberIds: Object.freeze(['member-deliverable-0002']),
    humanSponsorMemberId: null,
    acceptorMemberId: 'member-deliverable-0003',
    taskGuids: Object.freeze([TASK_GUID]),
    event,
    expectedDeliverablesRevision: 0,
    expectedDeliverableRevision: null,
    expectedTeamRevision: 3,
    expectedTaskRevision: 1,
    expectedScheduleRevision: 1,
    idempotencyKey: 'deliverable-create-key-0001',
    causationId: 'deliverable-create-cause-0001',
    reason: 'owner-project-deliverable-create',
    ...overrides,
  })
}

function candidateVersions(): readonly DeliverableArtifactVersionRef[] {
  return Object.freeze([
    Object.freeze({
      kind: 'declared-file-version',
      source: 'managed',
      resourceId: 'managed-release-evidence',
      versionId: 'version-2026-09-01',
      displayName: 'Release evidence.md',
      canonicalUrl: 'https://files.example.test/releases/evidence',
      contentDigest: `sha256:${'a'.repeat(64)}`,
    }),
    Object.freeze({
      kind: 'declared-file-version',
      source: 'managed',
      resourceId: 'managed-release-evidence',
      versionId: 'version-2026-09-01',
      displayName: 'Release evidence local mirror.md',
      canonicalUrl: null,
      contentDigest: null,
    }),
  ])
}

function acceptanceRequest(
  value: ProjectDeliverablesProjection,
  key: string,
  candidates: readonly DeliverableArtifactVersionRef[] = candidateVersions(),
): RequestDeliverableAcceptanceRequest {
  const deliverable = value.deliverables[0]
  if (deliverable === undefined) throw new Error('Deliverable fixture lost its target')
  return Object.freeze({
    projectId: PROJECT_ID,
    deliverableId: deliverable.deliverableId,
    candidateVersions: candidates,
    expectedDeliverablesRevision: value.revision,
    expectedDeliverableRevision: deliverable.revision,
    expectedTeamRevision: value.teamRevision,
    expectedTaskRevision: value.taskRevision,
    expectedScheduleRevision: value.scheduleRevision,
    expectedRemoteObservationVersion: deliverable.calendar.remoteObservationVersion,
    idempotencyKey: `deliverable-request-${key}-0001`,
    causationId: `deliverable-request-${key}-cause-0001`,
    reason: 'owner-deliverable-acceptance-request',
  })
}

function decisionRequest(
  mode: DecideDeliverableAcceptanceRequest['mode'],
  value: ProjectDeliverablesProjection,
  acceptanceRequestId: string,
  criteria: DecideDeliverableAcceptanceRequest['criteria'],
  key: string,
): DecideDeliverableAcceptanceRequest {
  const deliverable = value.deliverables[0]
  if (deliverable === undefined) throw new Error('Deliverable fixture lost its decision target')
  const common = {
    projectId: PROJECT_ID,
    deliverableId: deliverable.deliverableId,
    acceptanceRequestId,
    criteria,
    feedback: `Owner feedback for ${mode}.`,
    expectedDeliverablesRevision: value.revision,
    expectedDeliverableRevision: deliverable.revision,
    expectedAcceptanceRequestRevision: 1,
    idempotencyKey: `deliverable-decision-${key}-0001`,
    causationId: `deliverable-decision-${key}-cause-0001`,
  }
  if (mode === 'approve') return Object.freeze({
    ...common,
    mode,
    reason: 'owner-deliverable-acceptance-approve',
  })
  if (mode === 'reject') return Object.freeze({
    ...common,
    mode,
    reason: 'owner-deliverable-acceptance-reject',
  })
  return Object.freeze({
    ...common,
    mode,
    reason: 'owner-deliverable-acceptance-needs-changes',
  })
}

describe('T11 Deliverable Host surface', () => {
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all([...temporaryRoots].map(async (root) => {
      await rm(root, { recursive: true, force: true })
      temporaryRoots.delete(root)
    }))
  })

  it('migrates the real SQLite seam to schema v10 with CalendarCommitment storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-deliverable-schema-'))
    temporaryRoots.add(root)
    const databasePath = join(root, 'workbench.sqlite')
    const repository = new SqliteWorkbenchRepository({
      databasePath,
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })

    await repository.open()
    await repository.close()

    const database = new DatabaseSync(databasePath)
    try {
      expect(WORKBENCH_SCHEMA_VERSION).toBe(10)
      expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 10 })
      expect(database.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'workbench_calendar_commitment'
      `).get()).toEqual({ name: 'workbench_calendar_commitment' })
    } finally {
      database.close()
    }
  })

  it('exposes the authorized Deliverables query through WorkbenchScenario and real SQLite', async () => {
    const scenario = new WorkbenchScenario({
      repository: new SqliteWorkbenchRepository({
        databasePath: ':memory:',
        journalMode: 'wal',
        busyTimeoutMs: 1_000,
      }),
      clock: Object.freeze({ now: () => new Date('2026-09-01T00:00:00.000Z') }),
      ids: ids(),
      adapters: Object.freeze({}),
      authorization,
      maxStatusLength: 280,
    })
    await scenario.open()
    try {
      await expect(scenario.projectDeliverables({
        projectId: 'missing-project',
      }, signal)).resolves.toBeNull()
    } finally {
      await scenario.close()
    }
  })

  it('delivers a create-event exactly once with the pinned route and provider idempotency key', async () => {
    const { scenario, adapter } = await fixture()
    try {
      const schedule = allDay('2026-09-20', '2026-09-21')
      const request = createRequest(Object.freeze({ mode: 'create-event', schedule }))
      const created = await scenario.createProjectDeliverable(request, signal)

      expect(created.ok, JSON.stringify(created)).toBe(true)
      expect(created).toMatchObject({
        ok: true,
        deliverable: {
          state: 'planned',
          calendar: { eventId: 'event-created-deliverable', schedule },
        },
        effect: { operation: 'event-create', state: 'delivered' },
      })
      expect(adapter.createEventCalls).toBe(1)
      expect(adapter.lastCreateEventRoute).toMatchObject({
        routeGeneration: 1,
        appId: APP_ID,
        credentialRef: 'FEISHU_DELIVERABLE_SCENARIO_SECRET',
        actor: { kind: 'bot', appId: APP_ID, openId: OPEN_ID },
      })
      expect(adapter.lastCreateEventInput).toEqual({
        calendarId: CALENDAR_ID,
        idempotencyKey: expect.stringMatching(/^dshwb-[0-9a-f]{64}$/u),
        summary: 'Release evidence bundle',
        description: 'The immutable output under formal acceptance.',
        schedule,
      })

      await expect(scenario.createProjectDeliverable(request, signal)).resolves.toMatchObject({
        ok: true,
        effect: { state: 'delivered' },
      })
      expect(adapter.createEventCalls).toBe(1)
    } finally {
      await scenario.close()
    }
  })

  it('persists one ambiguous create-event attempt and never blindly resends it after restart', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    const request = createRequest(Object.freeze({
      mode: 'create-event',
      schedule: allDay('2026-09-20', '2026-09-21'),
    }))
    adapter.createEventMode = 'throw'
    let closed = false
    try {
      await expect(scenario.createProjectDeliverable(request, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'remote-outcome-unknown' },
      })
      expect(adapter.createEventCalls).toBe(1)
      await expect(scenario.createProjectDeliverable(request, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'remote-outcome-unknown' },
      })
      expect(adapter.createEventCalls).toBe(1)
      await scenario.close()
      closed = true

      const reopened = scenarioFor(databasePath, adapter)
      await reopened.open()
      try {
        await expect(reopened.createProjectDeliverable(request, signal)).resolves.toMatchObject({
          ok: false,
          error: { code: 'remote-outcome-unknown' },
        })
        expect(adapter.createEventCalls).toBe(1)
        await expect(reopened.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
      } finally {
        await reopened.close()
      }
    } finally {
      if (!closed) await scenario.close()
    }
  })

  it('enforces one Calendar event identity across Milestones and Deliverables in both directions', async () => {
    const first = await fixture()
    try {
      await expect(first.scenario.createProjectMilestone({
        projectId: PROJECT_ID,
        mode: 'existing-event',
        eventId: 'event-deliverable-1',
        expectedRevision: 1,
        expectedMilestoneRevision: null,
        name: 'Milestone owns this event',
        description: null,
        idempotencyKey: 'deliverable-collision-milestone-first-0001',
        causationId: 'deliverable-collision-milestone-first-cause-0001',
        reason: 'owner-project-milestone-create',
      }, signal)).resolves.toMatchObject({ ok: true, value: { revision: 2 } })
      await expect(first.scenario.createProjectDeliverable(createRequest(
        Object.freeze({ mode: 'existing-event', eventId: 'event-deliverable-1' }),
        Object.freeze({
          expectedScheduleRevision: 2,
          idempotencyKey: 'deliverable-collision-after-milestone-0001',
          causationId: 'deliverable-collision-after-milestone-cause-0001',
        }),
      ), signal)).resolves.toMatchObject({ ok: false, error: { code: 'event-already-used' } })
    } finally {
      await first.scenario.close()
    }

    const second = await fixture()
    try {
      await expect(second.scenario.createProjectDeliverable(createRequest(), signal)).resolves
        .toMatchObject({ ok: true, value: { scheduleRevision: 2 } })
      await expect(second.scenario.createProjectMilestone({
        projectId: PROJECT_ID,
        mode: 'existing-event',
        eventId: 'event-deliverable-1',
        expectedRevision: 2,
        expectedMilestoneRevision: null,
        name: 'Milestone cannot steal Deliverable event',
        description: null,
        idempotencyKey: 'deliverable-collision-milestone-second-0001',
        causationId: 'deliverable-collision-milestone-second-cause-0001',
        reason: 'owner-project-milestone-create',
      }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'event-already-used' } })
    } finally {
      await second.scenario.close()
    }
  })

  it('checks every dependency CAS and permits only one pending Acceptance Request', async () => {
    const { scenario, adapter } = await fixture()
    try {
      const createConflicts: readonly [Partial<CreateProjectDeliverableRequest>, string][] = [
        [{ expectedDeliverablesRevision: 1 }, 'deliverables-revision-conflict'],
        [{ expectedTeamRevision: 2 }, 'team-revision-conflict'],
        [{ expectedTaskRevision: 0 }, 'task-projection-revision-conflict'],
        [{ expectedScheduleRevision: 0 }, 'project-schedule-revision-conflict'],
      ]
      for (const [override, code] of createConflicts) {
        const suffix = code.replaceAll('-', '')
        await expect(scenario.createProjectDeliverable(createRequest(undefined, {
          ...override,
          idempotencyKey: `deliverable-create-cas-${suffix}-0001`,
          causationId: `deliverable-create-cas-${suffix}-cause-0001`,
        }), signal)).resolves.toMatchObject({ ok: false, error: { code } })
      }
      expect(adapter.readEventCalls).toBe(0)

      const created = await scenario.createProjectDeliverable(createRequest(), signal)
      if (!created.ok) throw new Error('CAS fixture Deliverable was not created')
      const requestConflicts: readonly [Partial<RequestDeliverableAcceptanceRequest>, string][] = [
        [{ expectedDeliverablesRevision: 0 }, 'deliverables-revision-conflict'],
        [{ expectedDeliverableRevision: 2 }, 'deliverable-revision-conflict'],
        [{ expectedTeamRevision: 2 }, 'team-revision-conflict'],
        [{ expectedTaskRevision: 0 }, 'task-projection-revision-conflict'],
        [{ expectedScheduleRevision: 1 }, 'project-schedule-revision-conflict'],
      ]
      for (const [override, code] of requestConflicts) {
        const suffix = code.replaceAll('-', '')
        await expect(scenario.requestDeliverableAcceptance(Object.freeze({
          ...acceptanceRequest(created.value, `cas-${suffix}`),
          ...override,
        }), signal)).resolves.toMatchObject({ ok: false, error: { code } })
      }

      const requested = await scenario.requestDeliverableAcceptance(
        acceptanceRequest(created.value, 'cas-valid'),
        signal,
      )
      if (!requested.ok) throw new Error('CAS fixture Acceptance Request was not created')
      await expect(scenario.requestDeliverableAcceptance(
        acceptanceRequest(requested.value, 'cas-second-pending'),
        signal,
      )).resolves.toMatchObject({ ok: false, error: { code: 'acceptance-request-pending' } })

      const criteria = Object.freeze(requested.request.plan.criteria.map(criterion => Object.freeze({
        criterionId: criterion.criterionId,
        outcome: 'met' as const,
      })))
      const decisionConflicts: readonly [Partial<DecideDeliverableAcceptanceRequest>, string][] = [
        [{ expectedDeliverablesRevision: requested.value.revision - 1 }, 'deliverables-revision-conflict'],
        [{ expectedDeliverableRevision: requested.value.deliverables[0]!.revision - 1 }, 'deliverable-revision-conflict'],
        [{ expectedAcceptanceRequestRevision: 2 }, 'acceptance-request-revision-conflict'],
      ]
      for (const [override, code] of decisionConflicts) {
        const suffix = code.replaceAll('-', '')
        await expect(scenario.decideDeliverableAcceptance(Object.freeze({
          ...decisionRequest(
            'approve',
            requested.value,
            requested.request.acceptanceRequestId,
            criteria,
            `cas-${suffix}`,
          ),
          ...override,
        }), signal)).resolves.toMatchObject({ ok: false, error: { code } })
      }
    } finally {
      await scenario.close()
    }
  })

  it('rejects invalid Team, Sponsor, Acceptor, and visible-task responsibility before provider reads', async () => {
    const { scenario, adapter } = await fixture()
    try {
      await expect(scenario.addProjectMember({
        projectId: PROJECT_ID,
        member: Object.freeze({ kind: 'agent', displayName: 'Inactive Deliverable Agent' }),
        expectedTeamRevision: 3,
        expectedRevision: null,
        idempotencyKey: 'deliverable-member-inactive-fixture-add-0001',
        causationId: 'deliverable-member-inactive-fixture-add-cause-0001',
        reason: 'owner-project-member-add',
      }, signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 4 } })
      await expect(scenario.setProjectMemberStatus({
        projectId: PROJECT_ID,
        memberId: 'member-deliverable-0004',
        status: 'inactive',
        expectedTeamRevision: 4,
        expectedMemberRevision: 1,
        idempotencyKey: 'deliverable-member-inactive-fixture-status-0001',
        causationId: 'deliverable-member-inactive-fixture-status-cause-0001',
        reason: 'owner-project-member-status-change',
      }, signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 5 } })

      const cases: readonly [string, Partial<CreateProjectDeliverableRequest>, string][] = [
        ['member-missing', { accountableMemberId: 'member-deliverable-missing' }, 'member-not-found'],
        ['member-inactive', { contributorMemberIds: Object.freeze(['member-deliverable-0004']) }, 'member-inactive'],
        ['accountable-overlap', {
          contributorMemberIds: Object.freeze(['member-deliverable-0001']),
        }, 'accountable-also-contributor'],
        ['sponsor-required', {
          accountableMemberId: 'member-deliverable-0002',
          contributorMemberIds: Object.freeze([]),
          humanSponsorMemberId: null,
        }, 'human-sponsor-required'],
        ['sponsor-invalid', {
          accountableMemberId: 'member-deliverable-0002',
          contributorMemberIds: Object.freeze([]),
          humanSponsorMemberId: 'member-deliverable-0002',
        }, 'human-sponsor-invalid'],
        ['sponsor-forbidden', {
          humanSponsorMemberId: 'member-deliverable-0003',
        }, 'human-sponsor-forbidden'],
        ['acceptor-invalid', {
          contributorMemberIds: Object.freeze([]),
          acceptorMemberId: 'member-deliverable-0002',
        }, 'acceptor-invalid'],
        ['task-not-visible', {
          taskGuids: Object.freeze(['task-deliverable-not-in-project']),
        }, 'task-not-in-project'],
      ]
      for (const [key, override, code] of cases) {
        await expect(scenario.createProjectDeliverable(createRequest(undefined, Object.freeze({
          ...override,
          expectedTeamRevision: 5,
          idempotencyKey: `deliverable-preflight-${key}-0001`,
          causationId: `deliverable-preflight-${key}-cause-0001`,
        })), signal)).resolves.toMatchObject({ ok: false, error: { code } })
      }
      expect(adapter.readEventCalls).toBe(0)
      await expect(scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)).resolves
        .toMatchObject({ revision: 0, deliverables: [] })
    } finally {
      await scenario.close()
    }
  })

  it('replays the exact local CAS conflict when provider creation wins a settlement race', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    const releaseProvider = Promise.withResolvers<void>()
    adapter.createEventGate = releaseProvider.promise
    const request = createRequest(Object.freeze({
      mode: 'create-event',
      schedule: allDay('2026-09-20', '2026-09-21'),
    }), Object.freeze({
      idempotencyKey: 'deliverable-create-provider-race-0001',
      causationId: 'deliverable-create-provider-race-cause-0001',
    }))
    let closed = false
    try {
      const pending = scenario.createProjectDeliverable(request, signal)
      await vi.waitFor(() => expect(adapter.createEventCalls).toBe(1))
      await expect(scenario.setProjectMemberStatus({
        projectId: PROJECT_ID,
        memberId: 'member-deliverable-0002',
        status: 'inactive',
        expectedTeamRevision: 3,
        expectedMemberRevision: 1,
        idempotencyKey: 'deliverable-provider-race-team-change-0001',
        causationId: 'deliverable-provider-race-team-change-cause-0001',
        reason: 'owner-project-member-status-change',
      }, signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 4 } })
      releaseProvider.resolve()

      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: { code: 'team-revision-conflict' },
      })
      await expect(scenario.createProjectDeliverable(request, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'team-revision-conflict' },
      })
      expect(adapter.createEventCalls).toBe(1)
      await scenario.close()
      closed = true

      const database = new DatabaseSync(databasePath)
      try {
        expect(database.prepare(`
          SELECT state, local_conflict_code, issue_json
          FROM workbench_deliverable_calendar_effect
        `).get()).toEqual({
          state: 'conflict',
          local_conflict_code: 'team-revision-conflict',
          issue_json: null,
        })
      } finally {
        database.close()
      }
      const reopened = scenarioFor(databasePath, adapter)
      await reopened.open()
      try {
        await expect(reopened.createProjectDeliverable(request, signal)).resolves.toMatchObject({
          ok: false,
          error: { code: 'team-revision-conflict' },
        })
        expect(adapter.createEventCalls).toBe(1)
      } finally {
        await reopened.close()
      }
    } finally {
      if (!closed) {
        releaseProvider.resolve()
        await scenario.close()
      }
    }
  })

  it('blocks an Acceptance Request when a frozen execution task is no longer available', async () => {
    const { scenario, adapter } = await fixture()
    try {
      const created = await scenario.createProjectDeliverable(createRequest(), signal)
      if (!created.ok) throw new Error('Task-unavailable fixture Deliverable was not created')
      adapter.taskAvailable = false
      await expect(scenario.reconcileProjectTasks({
        projectId: PROJECT_ID,
        expectedRevision: 1,
      }, signal)).resolves.toMatchObject({ ok: true, value: { revision: 2, tasks: [] } })
      const current = await scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)
      if (current === null) throw new Error('Task-unavailable fixture Project disappeared')
      await expect(scenario.requestDeliverableAcceptance(
        acceptanceRequest(current, 'task-unavailable'),
        signal,
      )).resolves.toMatchObject({
        ok: false,
        error: { code: 'task-unavailable', taskGuid: TASK_GUID },
      })
    } finally {
      await scenario.close()
    }
  })

  it('opens an Acceptance Request while at least one frozen execution task remains visible', async () => {
    const { scenario, adapter } = await fixture({ secondTaskAvailable: true })
    try {
      const created = await scenario.createProjectDeliverable(createRequest(undefined, {
        taskGuids: Object.freeze([TASK_GUID, SECOND_TASK_GUID]),
      }), signal)
      if (!created.ok) throw new Error('Partial-task fixture Deliverable was not created')
      adapter.secondTaskAvailable = false
      await expect(scenario.reconcileProjectTasks({
        projectId: PROJECT_ID,
        expectedRevision: 1,
      }, signal)).resolves.toMatchObject({
        ok: true,
        value: { revision: 2, tasks: [{ taskGuid: TASK_GUID }] },
      })
      const current = await scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)
      if (current === null) throw new Error('Partial-task fixture Project disappeared')
      await expect(scenario.requestDeliverableAcceptance(
        acceptanceRequest(current, 'one-task-visible'),
        signal,
      )).resolves.toMatchObject({
        ok: true,
        request: { taskGuids: [TASK_GUID, SECOND_TASK_GUID] },
      })
    } finally {
      await scenario.close()
    }
  })

  it('validates complete artifact references and enforces the criterion decision rules', async () => {
    const { scenario } = await fixture()
    try {
      const created = await scenario.createProjectDeliverable(createRequest(), signal)
      if (!created.ok) throw new Error('Validation fixture Deliverable was not created')
      const candidate = candidateVersions()[0]!
      const invalidCandidates: readonly [string, readonly DeliverableArtifactVersionRef[]][] = [
        ['duplicate', Object.freeze([candidate, candidate])],
        ['http-url', Object.freeze([Object.freeze({ ...candidate, canonicalUrl: 'http://files.example.test/v1' })])],
        ['bad-digest', Object.freeze([Object.freeze({ ...candidate, contentDigest: 'sha256:bad' })])],
        ['resource-bound', Object.freeze([Object.freeze({ ...candidate, resourceId: 'r'.repeat(257) })])],
        ['version-bound', Object.freeze([Object.freeze({ ...candidate, versionId: 'v'.repeat(257) })])],
        ['label-bound', Object.freeze([Object.freeze({ ...candidate, displayName: 'd'.repeat(201) })])],
        ['url-bound', Object.freeze([Object.freeze({
          ...candidate,
          canonicalUrl: `https://files.example.test/${'u'.repeat(2_100)}`,
        })])],
        ['count-bound', Object.freeze(Array.from({ length: 21 }, (_, index) => Object.freeze({
          ...candidate,
          resourceId: `candidate-resource-${String(index).padStart(2, '0')}`,
        })))],
      ]
      for (const [key, candidates] of invalidCandidates) {
        await expect(scenario.requestDeliverableAcceptance(
          acceptanceRequest(created.value, `invalid-${key}`, candidates),
          signal,
        )).rejects.toMatchObject({ failure: { code: 'bad-request' } })
      }

      const urlPrefix = 'https://files.example.test/'
      const boundaryCandidate = Object.freeze({
        ...candidate,
        resourceId: 'r'.repeat(256),
        versionId: 'v'.repeat(256),
        displayName: 'd'.repeat(200),
        canonicalUrl: `${urlPrefix}${'u'.repeat(2_048 - urlPrefix.length)}`,
      })
      const sameNarrowTupleDifferentReference = Object.freeze({
        ...boundaryCandidate,
        displayName: 'e'.repeat(200),
        canonicalUrl: null,
        contentDigest: null,
      })
      const requested = await scenario.requestDeliverableAcceptance(
        acceptanceRequest(created.value, 'decision-rules', Object.freeze([
          boundaryCandidate,
          sameNarrowTupleDifferentReference,
        ])),
        signal,
      )
      if (!requested.ok) throw new Error('Decision-rule Acceptance Request was not created')
      expect(requested.request.candidateVersions).toHaveLength(2)
      expect(new Set(requested.request.candidateVersions.map(item => item.referenceDigest)).size).toBe(2)
      const met = Object.freeze(requested.request.plan.criteria.map(criterion => Object.freeze({
        criterionId: criterion.criterionId,
        outcome: 'met' as const,
      })))
      const notMet = Object.freeze(met.map((criterion, index) => Object.freeze({
        ...criterion,
        outcome: index === 0 ? 'not-met' as const : 'met' as const,
      })))
      await expect(scenario.decideDeliverableAcceptance(decisionRequest(
        'reject',
        requested.value,
        requested.request.acceptanceRequestId,
        Object.freeze(met.slice(0, 1)),
        'criteria-incomplete',
      ), signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'criterion-result-incomplete' },
      })
      await expect(scenario.decideDeliverableAcceptance(decisionRequest(
        'approve',
        requested.value,
        requested.request.acceptanceRequestId,
        notMet,
        'approval-not-met',
      ), signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'approval-criteria-not-met' },
      })
      await expect(scenario.decideDeliverableAcceptance(decisionRequest(
        'request-changes',
        requested.value,
        requested.request.acceptanceRequestId,
        met,
        'changes-all-met',
      ), signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'needs-changes-criterion-required' },
      })
      for (const [key, feedback] of [['blank', '   '], ['bound', 'f'.repeat(2_001)]] as const) {
        await expect(scenario.decideDeliverableAcceptance(Object.freeze({
          ...decisionRequest(
            'reject',
            requested.value,
            requested.request.acceptanceRequestId,
            notMet,
            `feedback-${key}`,
          ),
          feedback,
        }), signal)).rejects.toMatchObject({ failure: { code: 'bad-request' } })
      }
    } finally {
      await scenario.close()
    }
  })

  it('fails all three acceptance decisions closed when Review and accept scopes differ', async () => {
    const prepared = await fixture()
    const created = await prepared.scenario.createProjectDeliverable(createRequest(), signal)
    if (!created.ok) throw new Error('Authorization fixture Deliverable was not created')
    const requested = await prepared.scenario.requestDeliverableAcceptance(
      acceptanceRequest(created.value, 'authorization'),
      signal,
    )
    if (!requested.ok) throw new Error('Authorization fixture Acceptance Request was not created')
    await prepared.scenario.close()

    const required: string[] = []
    const mismatched: WorkbenchAuthorization = Object.freeze({
      require: async (action) => {
        required.push(action)
        return Object.freeze({
          ownerId: 'owner-deliverable-scenario',
          organizationId: 'organization-deliverable-scenario',
          teamId: action === 'workbench.project.deliverable.accept'
            ? 'team-outside-deliverable-scope'
            : 'team-deliverable-scenario',
        })
      },
      filterProjection: async <T>(_action: string, projection: T) => projection,
    })
    const scenario = scenarioFor(prepared.databasePath, prepared.adapter, mismatched)
    await scenario.open()
    try {
      const met = Object.freeze(requested.request.plan.criteria.map(criterion => Object.freeze({
        criterionId: criterion.criterionId,
        outcome: 'met' as const,
      })))
      for (const mode of ['approve', 'reject', 'request-changes'] as const) {
        const criteria = mode === 'request-changes'
          ? Object.freeze(met.map((criterion, index) => Object.freeze({
              ...criterion,
              outcome: index === 0 ? 'not-met' as const : 'met' as const,
            })))
          : met
        await expect(scenario.decideDeliverableAcceptance(decisionRequest(
          mode,
          requested.value,
          requested.request.acceptanceRequestId,
          criteria,
          `scope-${mode}`,
        ), signal)).rejects.toMatchObject({ failure: { code: 'forbidden' } })
        expect(required.splice(0)).toEqual([
          'workbench.review.decide',
          'workbench.project.deliverable.accept',
        ])
      }
    } finally {
      await scenario.close()
    }
  })

  it('repairs a missed Deliverable Calendar notification through periodic reconciliation', async () => {
    vi.useFakeTimers()
    const { scenario, adapter } = await fixture({ calendarReconciliationIntervalMs: 30_000 })
    try {
      await expect(scenario.createProjectDeliverable(createRequest(), signal)).resolves
        .toMatchObject({ ok: true, value: { revision: 1, scheduleRevision: 2 } })
      adapter.events.set('event-deliverable-1', calendarEvent(
        'event-deliverable-1',
        '8',
        allDay('2026-09-24', '2026-09-25'),
      ))

      await vi.advanceTimersByTimeAsync(30_000)

      await expect(scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)).resolves
        .toMatchObject({
          revision: 2,
          scheduleRevision: 3,
          deliverables: [{
            revision: 2,
            calendar: {
              schedule: { startDate: '2026-09-24', endDate: '2026-09-25' },
              remoteObservationVersion: `sha256:${'8'.repeat(64)}`,
            },
          }],
          activity: [
            { action: 'calendar-observed', source: { kind: 'schedule-change' } },
            { action: 'deliverable-created', source: { kind: 'audit-event' } },
          ],
        })
      expect(adapter.readEventCalls).toBe(2)
    } finally {
      await scenario.close()
    }
  })

  it('rolls back caller-cancelled existing-event creation and drains an admitted provider write on close', async () => {
    const cancelledFixture = await fixture()
    try {
      const caller = new AbortController()
      cancelledFixture.adapter.onReadEvent = () => { caller.abort(new Error('caller left')) }
      await expect(cancelledFixture.scenario.createProjectDeliverable(
        createRequest(),
        caller.signal,
      )).rejects.toMatchObject({ failure: { code: 'cancelled' } })
      await expect(cancelledFixture.scenario.projectDeliverables({ projectId: PROJECT_ID }, signal))
        .resolves.toMatchObject({ revision: 0, scheduleRevision: 1, deliverables: [] })
      await expect(cancelledFixture.scenario.auditIntegrity(signal)).resolves
        .toMatchObject({ valid: true })
    } finally {
      await cancelledFixture.scenario.close()
    }

    const drainingFixture = await fixture()
    const releaseProvider = Promise.withResolvers<void>()
    drainingFixture.adapter.createEventGate = releaseProvider.promise
    const pending = drainingFixture.scenario.createProjectDeliverable(createRequest(Object.freeze({
      mode: 'create-event',
      schedule: allDay('2026-09-26', '2026-09-27'),
    })), signal)
    await vi.waitFor(() => expect(drainingFixture.adapter.createEventCalls).toBe(1))
    let closeSettled = false
    const closing = drainingFixture.scenario.close().then(() => { closeSettled = true })
    await Promise.resolve()
    expect(closeSettled).toBe(false)
    releaseProvider.resolve()
    await expect(pending).resolves.toMatchObject({ ok: true, effect: { state: 'delivered' } })
    await closing
    expect(closeSettled).toBe(true)
    expect(drainingFixture.scenario.lifecycle).toBe('closed')

    const reopened = scenarioFor(drainingFixture.databasePath, drainingFixture.adapter)
    await reopened.open()
    try {
      await expect(reopened.projectDeliverables({ projectId: PROJECT_ID }, signal)).resolves
        .toMatchObject({ deliverables: [{ state: 'planned' }] })
      await expect(reopened.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    } finally {
      await reopened.close()
    }
  })

  it('migrates a real v9 Milestone database, backfills CalendarCommitment, and survives restart', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    await expect(scenario.createProjectMilestone({
      projectId: PROJECT_ID,
      mode: 'existing-event',
      eventId: 'event-deliverable-1',
      expectedRevision: 1,
      expectedMilestoneRevision: null,
      name: 'Persisted v9 Milestone',
      description: null,
      idempotencyKey: 'deliverable-v9-milestone-create-0001',
      causationId: 'deliverable-v9-milestone-create-cause-0001',
      reason: 'owner-project-milestone-create',
    }, signal)).resolves.toMatchObject({ ok: true, value: { revision: 2 } })
    await scenario.close()

    const legacy = new DatabaseSync(databasePath)
    try {
      legacy.exec(`
        PRAGMA foreign_keys = OFF;
        DROP TRIGGER workbench_calendar_commitment_no_update;
        DROP TRIGGER workbench_calendar_commitment_no_delete;
        DROP TRIGGER workbench_project_deliverable_plan_no_update;
        DROP TRIGGER workbench_project_deliverable_no_delete;
        DROP TRIGGER workbench_project_deliverable_member_no_update;
        DROP TRIGGER workbench_project_deliverable_member_no_delete;
        DROP TRIGGER workbench_deliverable_request_snapshot_no_update;
        DROP TRIGGER workbench_deliverable_request_no_delete;
        DROP TRIGGER workbench_deliverable_candidate_version_no_update;
        DROP TRIGGER workbench_deliverable_candidate_version_no_delete;
        DROP TRIGGER workbench_deliverable_decision_no_update;
        DROP TRIGGER workbench_deliverable_decision_no_delete;
        DROP TRIGGER workbench_deliverable_final_release_no_update;
        DROP TRIGGER workbench_deliverable_final_release_no_delete;
        DROP TRIGGER workbench_deliverable_final_release_version_no_update;
        DROP TRIGGER workbench_deliverable_final_release_version_no_delete;
        DROP TRIGGER workbench_deliverable_activity_no_update;
        DROP TRIGGER workbench_deliverable_activity_no_delete;
        DROP TRIGGER workbench_deliverable_calendar_effect_intent_no_update;
        DROP TRIGGER workbench_deliverable_calendar_effect_no_delete;
        DROP TRIGGER workbench_project_schedule_change_no_update;
        DROP TRIGGER workbench_project_schedule_change_no_delete;
        DROP INDEX workbench_project_schedule_change_recent;

        CREATE TABLE workbench_project_schedule_change_v9_restore (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
          id TEXT NOT NULL UNIQUE CHECK (length(id) BETWEEN 1 AND 128),
          project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
          project_revision INTEGER NOT NULL CHECK (project_revision > 0),
          milestone_id TEXT NOT NULL CHECK (length(milestone_id) BETWEEN 1 AND 128),
          milestone_revision INTEGER NOT NULL CHECK (milestone_revision > 0),
          source TEXT NOT NULL CHECK (source IN ('workbench', 'feishu')),
          changed_fields_json TEXT NOT NULL CHECK (length(changed_fields_json) > 0),
          before_schedule_json TEXT,
          after_schedule_json TEXT NOT NULL CHECK (length(after_schedule_json) > 0),
          occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
          UNIQUE (project_id, project_revision),
          FOREIGN KEY (project_id, milestone_id)
            REFERENCES workbench_project_milestone (project_id, id)
            DEFERRABLE INITIALLY DEFERRED
        ) STRICT;
        INSERT INTO workbench_project_schedule_change_v9_restore (
          sequence, id, project_id, project_revision, milestone_id, milestone_revision,
          source, changed_fields_json, before_schedule_json, after_schedule_json, occurred_at
        ) SELECT sequence, id, project_id, project_revision, milestone_id, milestone_revision,
            source, changed_fields_json, before_schedule_json, after_schedule_json, occurred_at
          FROM workbench_project_schedule_change WHERE target_kind = 'milestone';
        DROP TABLE workbench_project_schedule_change;
        ALTER TABLE workbench_project_schedule_change_v9_restore
          RENAME TO workbench_project_schedule_change;
        CREATE INDEX workbench_project_schedule_change_recent
          ON workbench_project_schedule_change (project_id, project_revision DESC);
        CREATE TRIGGER workbench_project_schedule_change_no_update
          BEFORE UPDATE ON workbench_project_schedule_change
        BEGIN SELECT RAISE(ABORT, 'workbench Project schedule changes are append-only'); END;
        CREATE TRIGGER workbench_project_schedule_change_no_delete
          BEFORE DELETE ON workbench_project_schedule_change
        BEGIN SELECT RAISE(ABORT, 'workbench Project schedule changes cannot be deleted'); END;

        DROP TABLE workbench_deliverable_calendar_effect;
        DROP TABLE workbench_deliverable_activity;
        DROP TABLE workbench_deliverable_final_release_version;
        DROP TABLE workbench_deliverable_final_release;
        DROP TABLE workbench_deliverable_acceptance_decision;
        DROP TABLE workbench_deliverable_candidate_version;
        DROP TABLE workbench_deliverable_acceptance_request;
        DROP TABLE workbench_project_deliverable_member;
        DROP TABLE workbench_project_deliverable;
        DROP TABLE workbench_calendar_commitment;
        DROP TABLE workbench_project_deliverable_head;
        PRAGMA user_version = 9;
        PRAGMA foreign_keys = ON;
      `)
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(legacy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 })
    } finally {
      legacy.close()
    }

    const migrated = scenarioFor(databasePath, adapter)
    await migrated.open()
    try {
      const database = new DatabaseSync(databasePath)
      try {
        expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 10 })
        expect(database.prepare(`
          SELECT target_kind, target_id, calendar_id, event_id
          FROM workbench_calendar_commitment
        `).get()).toMatchObject({
          target_kind: 'milestone',
          calendar_id: CALENDAR_ID,
          event_id: 'event-deliverable-1',
        })
        expect(database.prepare(`
          SELECT target_kind, target_id, target_revision, milestone_id, milestone_revision
          FROM workbench_project_schedule_change
        `).get()).toMatchObject({
          target_kind: 'milestone',
          target_revision: 1,
          milestone_revision: 1,
        })
      } finally {
        database.close()
      }
      await expect(migrated.createProjectDeliverable(createRequest(
        undefined,
        Object.freeze({
          expectedScheduleRevision: 2,
          idempotencyKey: 'deliverable-after-v9-collision-0001',
          causationId: 'deliverable-after-v9-collision-cause-0001',
        }),
      ), signal)).resolves.toMatchObject({ ok: false, error: { code: 'event-already-used' } })
      await expect(migrated.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
    } finally {
      await migrated.close()
    }

    const restarted = scenarioFor(databasePath, adapter)
    await restarted.open()
    try {
      await expect(restarted.getProjectMilestones({ projectId: PROJECT_ID }, signal)).resolves
        .toMatchObject({ revision: 2, milestones: [{ eventId: 'event-deliverable-1' }] })
      await expect(restarted.projectDeliverables({ projectId: PROJECT_ID }, signal)).resolves
        .toMatchObject({ revision: 0, deliverables: [] })
    } finally {
      await restarted.close()
    }
  })

  it('rolls back injected create, request, and approval failures as complete atomic clusters', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    let closed = false
    try {
      let baseline = deliverableDatabaseSnapshot(databasePath)
      const createFaults = [
        ['injected_t11_create_member',
          "BEFORE INSERT ON workbench_project_deliverable_member WHEN NEW.role = 'contributor'"],
        ['injected_t11_create_schedule',
          "BEFORE INSERT ON workbench_project_schedule_change WHEN NEW.target_kind = 'deliverable'"],
        ['injected_t11_create_activity',
          "BEFORE INSERT ON workbench_deliverable_activity WHEN NEW.action = 'deliverable-created'"],
      ] as const
      for (const [index, [name, point]] of createFaults.entries()) {
        installDeliverableFault(databasePath, name, point)
        try {
          await expect(scenario.createProjectDeliverable(createRequest(undefined, Object.freeze({
            idempotencyKey: `deliverable-rollback-create-${String(index).padStart(2, '0')}-0001`,
            causationId: `deliverable-rollback-create-${String(index).padStart(2, '0')}-cause-0001`,
          })), signal)).rejects.toMatchObject({ failure: { code: 'internal' } })
        } finally {
          removeDeliverableFault(databasePath, name)
        }
        expect(deliverableDatabaseSnapshot(databasePath)).toEqual(baseline)
      }

      const created = await scenario.createProjectDeliverable(createRequest(undefined, Object.freeze({
        idempotencyKey: 'deliverable-rollback-create-success-0001',
        causationId: 'deliverable-rollback-create-success-cause-0001',
      })), signal)
      if (!created.ok) throw new Error('Rollback fixture Deliverable was not created')
      baseline = deliverableDatabaseSnapshot(databasePath)
      const requestFaults = [
        ['injected_t11_request_candidate',
          'BEFORE INSERT ON workbench_deliverable_candidate_version WHEN NEW.ordinal = 2'],
        ['injected_t11_request_state',
          "BEFORE UPDATE OF state ON workbench_project_deliverable WHEN NEW.state = 'in-review'"],
        ['injected_t11_request_activity',
          "BEFORE INSERT ON workbench_deliverable_activity WHEN NEW.action = 'acceptance-requested'"],
      ] as const
      for (const [index, [name, point]] of requestFaults.entries()) {
        installDeliverableFault(databasePath, name, point)
        try {
          await expect(scenario.requestDeliverableAcceptance(
            acceptanceRequest(created.value, `rollback-request-${String(index).padStart(2, '0')}`),
            signal,
          )).rejects.toMatchObject({ failure: { code: 'internal' } })
        } finally {
          removeDeliverableFault(databasePath, name)
        }
        expect(deliverableDatabaseSnapshot(databasePath)).toEqual(baseline)
      }

      const requested = await scenario.requestDeliverableAcceptance(
        acceptanceRequest(created.value, 'rollback-request-success'),
        signal,
      )
      if (!requested.ok) throw new Error('Rollback fixture Acceptance Request was not created')
      const criteria = Object.freeze(requested.request.plan.criteria.map(criterion => Object.freeze({
        criterionId: criterion.criterionId,
        outcome: 'met' as const,
      })))
      baseline = deliverableDatabaseSnapshot(databasePath)
      const approvalFaults = [
        ['injected_t11_approve_decision',
          'BEFORE INSERT ON workbench_deliverable_acceptance_decision'],
        ['injected_t11_approve_request',
          "BEFORE UPDATE OF persisted_state ON workbench_deliverable_acceptance_request WHEN NEW.persisted_state = 'approved'"],
        ['injected_t11_approve_version',
          'BEFORE INSERT ON workbench_deliverable_final_release_version WHEN NEW.ordinal = 2'],
        ['injected_t11_approve_activity',
          "BEFORE INSERT ON workbench_deliverable_activity WHEN NEW.action = 'acceptance-approved'"],
      ] as const
      for (const [index, [name, point]] of approvalFaults.entries()) {
        installDeliverableFault(databasePath, name, point)
        try {
          await expect(scenario.decideDeliverableAcceptance(decisionRequest(
            'approve',
            requested.value,
            requested.request.acceptanceRequestId,
            criteria,
            `rollback-approve-${String(index).padStart(2, '0')}`,
          ), signal)).rejects.toMatchObject({ failure: { code: 'internal' } })
        } finally {
          removeDeliverableFault(databasePath, name)
        }
        expect(deliverableDatabaseSnapshot(databasePath)).toEqual(baseline)
      }

      const approved = await scenario.decideDeliverableAcceptance(decisionRequest(
        'approve',
        requested.value,
        requested.request.acceptanceRequestId,
        criteria,
        'rollback-approve-success',
      ), signal)
      expect(approved).toMatchObject({
        ok: true,
        request: { persistedState: 'approved' },
        finalRelease: { versions: candidateVersions() },
      })
      await expect(scenario.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
      await scenario.close()
      closed = true

      const restarted = scenarioFor(databasePath, adapter)
      await restarted.open()
      try {
        await expect(restarted.projectDeliverables({ projectId: PROJECT_ID }, signal)).resolves
          .toMatchObject({ deliverables: [{ state: 'accepted', finalRelease: { versions: candidateVersions() } }] })
        await expect(restarted.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
      } finally {
        await restarted.close()
      }
    } finally {
      if (!closed) await scenario.close()
    }
  })

  it('replays the complete responsibility-to-Final-Release chain across stale and repeated rounds', async () => {
    const { scenario, adapter, databasePath } = await fixture()
    let closed = false
    try {
      const create = await scenario.createProjectDeliverable(createRequest(), signal)
      expect(create).toMatchObject({
        ok: true,
        value: { revision: 1, teamRevision: 3, taskRevision: 1, scheduleRevision: 2 },
        deliverable: { revision: 1, state: 'planned' },
        effect: null,
      })
      if (!create.ok) throw new Error('Deliverable creation unexpectedly failed')
      const createReads = adapter.readEventCalls
      const replayedCreate = await scenario.createProjectDeliverable(createRequest(), signal)
      expect(replayedCreate).toMatchObject({ ok: true, receipt: create.receipt })
      expect(adapter.readEventCalls).toBe(createReads)

      await expect(scenario.setProjectMemberStatus({
        projectId: PROJECT_ID,
        memberId: 'member-deliverable-0002',
        status: 'inactive',
        expectedTeamRevision: 3,
        expectedMemberRevision: 1,
        idempotencyKey: 'deliverable-member-deactivate-open-0001',
        causationId: 'deliverable-member-deactivate-open-cause-0001',
        reason: 'owner-project-member-status-change',
      }, signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'member-in-use', memberId: 'member-deliverable-0002' },
      })

      const roundOneInput = acceptanceRequest(create.value, 'round-one')
      const roundOne = await scenario.requestDeliverableAcceptance(roundOneInput, signal)
      expect(roundOne).toMatchObject({
        ok: true,
        value: { revision: 2 },
        request: { sequence: 1, revision: 1, effectiveStatus: 'pending' },
      })
      if (!roundOne.ok) throw new Error('First Acceptance Request unexpectedly failed')
      await expect(scenario.requestDeliverableAcceptance(roundOneInput, signal)).resolves
        .toMatchObject({ ok: true, receipt: roundOne.receipt })

      adapter.events.set('event-deliverable-1', calendarEvent(
        'event-deliverable-1',
        '4',
        allDay('2026-09-12', '2026-09-13'),
      ))
      await adapter.emitCalendar('event-deliverable-1', 1)
      const staleValue = await scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)
      expect(staleValue).toMatchObject({
        revision: 3,
        scheduleRevision: 3,
        deliverables: [{
          revision: 3,
          state: 'in-review',
          acceptanceRequests: [{ effectiveStatus: 'stale', allowedDecisions: ['reject', 'request-changes'] }],
        }],
        activity: [
          { action: 'calendar-observed', source: { kind: 'schedule-change' } },
          { action: 'acceptance-requested', source: { kind: 'audit-event' } },
          { action: 'deliverable-created', source: { kind: 'audit-event' } },
        ],
      })
      if (staleValue === null) throw new Error('Stale Deliverable projection disappeared')
      const staleRequest = staleValue.deliverables[0]?.acceptanceRequests[0]
      if (staleRequest === undefined) throw new Error('Stale Acceptance Request disappeared')
      await expect(scenario.reviewCenter({
        reviewKind: 'deliverable-acceptance',
        projectId: PROJECT_ID,
        status: 'stale',
        limit: 10,
      }, signal)).resolves.toMatchObject({
        reviewKind: 'deliverable-acceptance',
        deliverablesRevision: 3,
        items: [{ request: { acceptanceRequestId: staleRequest.acceptanceRequestId } }],
      })

      const met = staleRequest.plan.criteria.map(criterion => Object.freeze({
        criterionId: criterion.criterionId,
        outcome: 'met' as const,
      }))
      const reversed = Object.freeze([...met].reverse())
      await expect(scenario.decideDeliverableAcceptance(decisionRequest(
        'request-changes',
        staleValue,
        staleRequest.acceptanceRequestId,
        reversed,
        'round-one-order-invalid',
      ), signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'criterion-result-invalid' },
      })
      await expect(scenario.decideDeliverableAcceptance(decisionRequest(
        'approve',
        staleValue,
        staleRequest.acceptanceRequestId,
        Object.freeze(met),
        'round-one-stale-approve',
      ), signal)).resolves.toMatchObject({
        ok: false,
        error: { code: 'acceptance-request-stale' },
      })
      const needsCriteria = Object.freeze(met.map((criterion, index) => Object.freeze({
        ...criterion,
        outcome: index === 0 ? 'not-met' as const : 'met' as const,
      })))
      const needsInput = decisionRequest(
        'request-changes',
        staleValue,
        staleRequest.acceptanceRequestId,
        needsCriteria,
        'round-one-needs-changes',
      )
      const needsChanges = await scenario.decideDeliverableAcceptance(needsInput, signal)
      expect(needsChanges).toMatchObject({
        ok: true,
        value: { revision: 4, deliverables: [{ revision: 4, state: 'planned' }] },
        request: { persistedState: 'needs_changes', revision: 2 },
        finalRelease: null,
      })
      if (!needsChanges.ok) throw new Error('Needs-changes decision unexpectedly failed')
      await expect(scenario.decideDeliverableAcceptance(needsInput, signal)).resolves
        .toMatchObject({ ok: true, receipt: needsChanges.receipt })

      const roundTwoInput = acceptanceRequest(needsChanges.value, 'round-two')
      const roundTwo = await scenario.requestDeliverableAcceptance(roundTwoInput, signal)
      if (!roundTwo.ok) throw new Error('Second Acceptance Request unexpectedly failed')
      expect(roundTwo.request.sequence).toBe(2)
      const rejectCriteria = Object.freeze(roundTwo.request.plan.criteria.map(criterion =>
        Object.freeze({ criterionId: criterion.criterionId, outcome: 'not-met' as const })))
      const rejectInput = decisionRequest(
        'reject',
        roundTwo.value,
        roundTwo.request.acceptanceRequestId,
        rejectCriteria,
        'round-two-reject',
      )
      const rejected = await scenario.decideDeliverableAcceptance(rejectInput, signal)
      expect(rejected).toMatchObject({
        ok: true,
        value: { revision: 6, deliverables: [{ revision: 6, state: 'planned' }] },
        request: { persistedState: 'rejected' },
        finalRelease: null,
      })
      if (!rejected.ok) throw new Error('Reject decision unexpectedly failed')

      const roundThreeInput = acceptanceRequest(rejected.value, 'round-three')
      const roundThree = await scenario.requestDeliverableAcceptance(roundThreeInput, signal)
      if (!roundThree.ok) throw new Error('Third Acceptance Request unexpectedly failed')
      expect(roundThree.request.sequence).toBe(3)
      const approveCriteria = Object.freeze(roundThree.request.plan.criteria.map(criterion =>
        Object.freeze({ criterionId: criterion.criterionId, outcome: 'met' as const })))
      const approveInput = decisionRequest(
        'approve',
        roundThree.value,
        roundThree.request.acceptanceRequestId,
        approveCriteria,
        'round-three-approve',
      )
      const approved = await scenario.decideDeliverableAcceptance(approveInput, signal)
      expect(approved).toMatchObject({
        ok: true,
        value: { revision: 8, deliverables: [{ revision: 8, state: 'accepted' }] },
        request: { persistedState: 'approved', revision: 2 },
      })
      if (!approved.ok || approved.finalRelease === null) {
        throw new Error('Approval did not create its Final Release')
      }
      expect(approved.finalRelease.acceptanceRequestId).toBe(roundThree.request.acceptanceRequestId)
      expect(approved.finalRelease.versions).toEqual(roundThree.request.candidateVersions)
      expect(approved.finalRelease.versionsDigest).toBe(roundThree.request.candidatesDigest)
      await expect(scenario.decideDeliverableAcceptance(approveInput, signal)).resolves
        .toMatchObject({
          ok: true,
          receipt: approved.receipt,
          finalRelease: approved.finalRelease,
        })

      await expect(scenario.setProjectMemberStatus({
        projectId: PROJECT_ID,
        memberId: 'member-deliverable-0002',
        status: 'inactive',
        expectedTeamRevision: 3,
        expectedMemberRevision: 1,
        idempotencyKey: 'deliverable-member-deactivate-accepted-0001',
        causationId: 'deliverable-member-deactivate-accepted-cause-0001',
        reason: 'owner-project-member-status-change',
      }, signal)).resolves.toMatchObject({ ok: true, value: { teamRevision: 4 } })

      const authorized = await scenario.projectDeliverables({ projectId: PROJECT_ID }, signal)
      expect(authorized?.activity.map(item => item.action)).toEqual([
        'acceptance-approved',
        'acceptance-requested',
        'acceptance-rejected',
        'acceptance-requested',
        'acceptance-needs-changes',
        'calendar-observed',
        'acceptance-requested',
        'deliverable-created',
      ])
      const genericActivity = await scenario.activity({ projectId: PROJECT_ID }, signal)
      const genericText = JSON.stringify(genericActivity.items.filter(item =>
        item.action.includes('deliverable')))
      for (const sensitive of [
        'Release evidence bundle',
        'member-deliverable-0001',
        TASK_GUID,
        'event-deliverable-1',
        'managed-release-evidence',
        'Owner feedback',
        'The release contains the declared evidence.',
      ]) {
        expect(genericText).not.toContain(sensitive)
      }
      await expect(scenario.auditIntegrity(signal)).resolves.toMatchObject({ valid: true })
      await scenario.close()
      closed = true

      const database = new DatabaseSync(databasePath)
      try {
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM workbench_deliverable_candidate_version
        `).get()).toEqual({ count: 6 })
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM workbench_deliverable_final_release_version
        `).get()).toEqual({ count: 2 })
        expect(() => database.prepare(`
          UPDATE workbench_deliverable_candidate_version SET display_name = 'mutated'
        `).run()).toThrow(/append-only/u)
        expect(() => database.prepare(`
          UPDATE workbench_deliverable_final_release_version SET ordinal = 2 WHERE ordinal = 1
        `).run()).toThrow(/append-only/u)
        const durableText = JSON.stringify({
          outbox: database.prepare(`
            SELECT payload_json FROM workbench_outbox
            WHERE topic LIKE 'workbench.%deliverable%' ORDER BY created_at
          `).all(),
          receipts: database.prepare(`
            SELECT result_json FROM workbench_command_receipt
            WHERE command_type LIKE 'workbench.%deliverable%'
              OR command_type LIKE 'workbench.project-deliverable%'
          `).all(),
          audit: database.prepare(`
            SELECT canonical_envelope FROM workbench_audit_event
            WHERE action LIKE 'workbench.%deliverable%'
              OR action = 'workbench.project-deliverable.created'
          `).all(),
        })
        for (const sensitive of [
          'Release evidence bundle',
          'member-deliverable-0001',
          TASK_GUID,
          'event-deliverable-1',
          'managed-release-evidence',
          'Owner feedback',
        ]) {
          expect(durableText).not.toContain(sensitive)
        }
      } finally {
        database.close()
      }

      const reopened = scenarioFor(databasePath, adapter)
      await reopened.open()
      const restored = await reopened.projectDeliverables({ projectId: PROJECT_ID }, signal)
      expect(restored?.deliverables[0]?.finalRelease).toEqual(approved.finalRelease)
      await reopened.close()
    } finally {
      if (!closed) await scenario.close()
    }
  })
})
