import {
  DshFeishuConnectionAdapter,
  WorkbenchService,
} from '@benz-ai-x/dsh-project-workbench'

/**
 * Deterministic external boundary for the private browser acceptance Profile.
 * Host authority, authorization, Typert carriers, SQLite, and the Client remain
 * the production implementations; only the credential-backed Feishu port is
 * replaced for one closed fixture identity so no live tenant is mutated.
 */
export const WORKBENCH_BROWSER_FIXTURE = Object.freeze({
  appId: 'cli_workbench_browser_fixture',
  credentialRef: 'WORKBENCH_E2E_DELIVERABLE_FIXTURE',
  openId: 'ou_workbench_browser_fixture',
  tenantKey: 'tenant_workbench_browser_fixture',
  taskListGuid: 'tasklist-guid-deliverable-browser',
  taskGuid: 'task-guid-deliverable-browser',
  taskSummary: '完成 Deliverable 浏览器证据',
  calendarId: 'calendar-deliverable-browser',
  eventId: 'event-deliverable-browser',
})

const observedAt = '2026-09-01T08:00:00.000Z'
const defaultSchedule = Object.freeze({
  kind: 'all-day',
  startDate: '2026-09-08',
  endDate: '2026-09-09',
})

function fixtureRoute(route) {
  return route?.kind === 'user'
    && route.appId === WORKBENCH_BROWSER_FIXTURE.appId
    && route.credentialRef === WORKBENCH_BROWSER_FIXTURE.credentialRef
    && route.actor?.openId === WORKBENCH_BROWSER_FIXTURE.openId
}

function fixtureTask() {
  return Object.freeze({
    taskGuid: WORKBENCH_BROWSER_FIXTURE.taskGuid,
    taskId: 'task-deliverable-browser',
    parentTaskGuid: null,
    summary: WORKBENCH_BROWSER_FIXTURE.taskSummary,
    description: 'Deterministic provider-owned execution truth for browser acceptance.',
    assignees: Object.freeze([]),
    followers: Object.freeze([]),
    comments: Object.freeze([]),
    completed: false,
    completedAt: null,
    canonicalUrl: `https://applink.feishu.cn/client/todo/detail?guid=${WORKBENCH_BROWSER_FIXTURE.taskGuid}`,
    remoteVersion: 'task-browser-version-1',
  })
}

function fixtureTaskList() {
  return Object.freeze({
    taskList: Object.freeze({
      taskListGuid: WORKBENCH_BROWSER_FIXTURE.taskListGuid,
      name: 'Deliverable browser acceptance tasks',
      canonicalUrl: 'https://applink.feishu.cn/client/todo/browser-fixture-list',
      remoteVersion: 'task-list-browser-version-1',
    }),
    tasks: Object.freeze([fixtureTask()]),
    observedAt,
  })
}

function fixtureCalendar() {
  return Object.freeze({
    calendarId: WORKBENCH_BROWSER_FIXTURE.calendarId,
    summary: 'Deliverable browser acceptance calendar',
    description: null,
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  })
}

function fixtureEvent(schedule = defaultSchedule) {
  return Object.freeze({
    calendarId: WORKBENCH_BROWSER_FIXTURE.calendarId,
    eventId: WORKBENCH_BROWSER_FIXTURE.eventId,
    organizerCalendarId: WORKBENCH_BROWSER_FIXTURE.calendarId,
    summary: 'Deliverable browser acceptance event',
    description: null,
    schedule: Object.freeze({ ...schedule }),
    status: 'confirmed',
    recurring: false,
    exception: false,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${WORKBENCH_BROWSER_FIXTURE.eventId}`,
    remoteObservationVersion: `sha256:${'e'.repeat(64)}`,
    observedAt,
  })
}

function browserFixtureAdapter(credentials) {
  const production = new DshFeishuConnectionAdapter(credentials)
  let currentEvent = fixtureEvent()
  const fixture = {
    adapterId: 'workbench-browser-fixture',

    async describeCredential(ref) {
      if (ref !== WORKBENCH_BROWSER_FIXTURE.credentialRef) {
        return production.describeCredential(ref)
      }
      return Object.freeze({ ref, configured: true, source: 'browser-fixture', writable: false })
    },

    async startIdentityVerification(input, signal) {
      if (input.kind !== 'user'
        || input.appId !== WORKBENCH_BROWSER_FIXTURE.appId
        || input.credentialRef !== WORKBENCH_BROWSER_FIXTURE.credentialRef) {
        return production.startIdentityVerification(input, signal)
      }
      signal.throwIfAborted()
      return Object.freeze({
        state: 'verified',
        session: Object.freeze({
          actor: Object.freeze({
            realm: 'feishu-cn',
            appId: WORKBENCH_BROWSER_FIXTURE.appId,
            kind: 'user',
            openId: WORKBENCH_BROWSER_FIXTURE.openId,
            tenantKey: WORKBENCH_BROWSER_FIXTURE.tenantKey,
          }),
          displayLabel: 'Workbench browser fixture user',
          async finishVerification(resourceProbe, continuationSignal) {
            continuationSignal.throwIfAborted()
            return Object.freeze({
              result: 'healthy',
              scopeInspection: Object.freeze({
                state: 'observed',
                scopes: Object.freeze([]),
                issue: null,
              }),
              resourceProbe: resourceProbe === null
                ? Object.freeze({ state: 'not-tested' })
                : Object.freeze({
                    state: 'accessible',
                    kind: 'task-list',
                    resourceId: resourceProbe.resourceId,
                  }),
            })
          },
          dispose() {},
        }),
      })
    },

    async listTaskLists(route, signal) {
      if (!fixtureRoute(route)) return production.listTaskLists(route, signal)
      signal.throwIfAborted()
      return Object.freeze({ state: 'ok', value: Object.freeze([fixtureTaskList().taskList]) })
    },

    async readTaskList(route, taskListGuid, signal) {
      if (!fixtureRoute(route)) return production.readTaskList(route, taskListGuid, signal)
      signal.throwIfAborted()
      return taskListGuid === WORKBENCH_BROWSER_FIXTURE.taskListGuid
        ? Object.freeze({ state: 'ok', value: fixtureTaskList() })
        : production.readTaskList(route, taskListGuid, signal)
    },

    async readTask(route, taskGuid, signal) {
      if (!fixtureRoute(route)) return production.readTask(route, taskGuid, signal)
      signal.throwIfAborted()
      return taskGuid === WORKBENCH_BROWSER_FIXTURE.taskGuid
        ? Object.freeze({ state: 'ok', value: fixtureTask() })
        : production.readTask(route, taskGuid, signal)
    },

    async updateTask(route, input, signal) {
      if (!fixtureRoute(route)) return production.updateTask(route, input, signal)
      signal.throwIfAborted()
      throw new Error(
        `T12 browser fixture forbids Risk-owned Feishu task writes: ${input.taskGuid}`,
      )
    },

    async listCalendars(route, signal) {
      if (!fixtureRoute(route)) return production.listCalendars(route, signal)
      signal.throwIfAborted()
      return Object.freeze({ state: 'ok', value: Object.freeze([fixtureCalendar()]) })
    },

    async readCalendar(route, calendarId, signal) {
      if (!fixtureRoute(route)) return production.readCalendar(route, calendarId, signal)
      signal.throwIfAborted()
      return calendarId === WORKBENCH_BROWSER_FIXTURE.calendarId
        ? Object.freeze({ state: 'ok', value: fixtureCalendar() })
        : production.readCalendar(route, calendarId, signal)
    },

    async listCalendarEvents(route, calendarId, signal) {
      if (!fixtureRoute(route)) return production.listCalendarEvents(route, calendarId, signal)
      signal.throwIfAborted()
      return calendarId === WORKBENCH_BROWSER_FIXTURE.calendarId
        ? Object.freeze({ state: 'ok', value: Object.freeze([currentEvent]) })
        : production.listCalendarEvents(route, calendarId, signal)
    },

    async readCalendarEvent(route, calendarId, eventId, signal) {
      if (!fixtureRoute(route)) {
        return production.readCalendarEvent(route, calendarId, eventId, signal)
      }
      signal.throwIfAborted()
      return calendarId === WORKBENCH_BROWSER_FIXTURE.calendarId
        && eventId === WORKBENCH_BROWSER_FIXTURE.eventId
        ? Object.freeze({ state: 'ok', value: currentEvent })
        : production.readCalendarEvent(route, calendarId, eventId, signal)
    },

    async createCalendarEvent(route, input, signal) {
      if (!fixtureRoute(route)) return production.createCalendarEvent(route, input, signal)
      signal.throwIfAborted()
      currentEvent = fixtureEvent(input.schedule)
      return Object.freeze({ state: 'ok', value: currentEvent })
    },

    async updateCalendarEventSchedule(route, input, signal) {
      if (!fixtureRoute(route)) {
        return production.updateCalendarEventSchedule(route, input, signal)
      }
      signal.throwIfAborted()
      currentEvent = fixtureEvent(input.schedule)
      return Object.freeze({ state: 'ok', value: currentEvent })
    },
  }

  return new Proxy(production, {
    get(target, property) {
      const value = property in fixture ? fixture[property] : target[property]
      return typeof value === 'function' ? value.bind(property in fixture ? fixture : target) : value
    },
  })
}

export default class WorkbenchBrowserHostService extends WorkbenchService {
  static inject = WorkbenchService.inject
  static Config = WorkbenchService.Config

  constructor(ctx, config = {}) {
    const adapter = browserFixtureAdapter(ctx.credentials)
    super(ctx, config, {
      adapters: Object.freeze({
        feishu: adapter,
        feishuTasks: adapter,
        feishuCalendars: adapter,
      }),
    })
  }
}
