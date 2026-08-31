/**
 * Loader-only Workbench Host wrapper with one deterministic Feishu Calendar port.
 * The lifecycle test still exercises the built Host, its public Remote methods,
 * and the durable SQLite repository through the real Loader boundary.
 */

import WorkbenchService from '../../../packages/workbench-host/lib/index.js'

const APP_ID = 'cli_calendar_loader'
const CALENDAR_ID = 'calendar-loader-evidence'
const EVENT_ID = 'event-loader-evidence'
const OPEN_ID = 'ou-calendar-loader'
const REMOTE_OBSERVATION_VERSION = `sha256:${'1'.repeat(64)}`

function calendar() {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    summary: 'Loader evidence calendar',
    description: 'Deterministic external Calendar boundary for Loader restart evidence.',
    calendarType: 'shared',
    role: 'writer',
    deleted: false,
    thirdParty: false,
  })
}

function event() {
  return Object.freeze({
    calendarId: CALENDAR_ID,
    eventId: EVENT_ID,
    organizerCalendarId: CALENDAR_ID,
    summary: 'Loader evidence event',
    description: null,
    schedule: Object.freeze({
      kind: 'all-day',
      startDate: '2026-09-10',
      endDate: '2026-09-11',
    }),
    status: 'confirmed',
    recurring: false,
    exception: false,
    appLink: `https://applink.feishu.cn/client/calendar/event/detail?eventId=${EVENT_ID}`,
    remoteObservationVersion: REMOTE_OBSERVATION_VERSION,
    observedAt: '2026-09-01T00:00:00.000Z',
  })
}

class LoaderCalendarAdapter {
  adapterId = 'loader-calendar-adapter'

  async describeCredential(ref) {
    return Object.freeze({ ref, configured: true, source: 'fixture', writable: false })
  }

  async startIdentityVerification(input) {
    if (input.kind !== 'bot' || input.appId !== APP_ID) {
      throw new Error('Loader Calendar fixture received an unexpected identity route')
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
        displayLabel: 'Loader Calendar Bot',
        finishVerification: async () => Object.freeze({
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

  async listCalendars() {
    return Object.freeze({ state: 'ok', value: Object.freeze([calendar()]) })
  }

  async readCalendar(_route, calendarId) {
    if (calendarId !== CALENDAR_ID) throw new Error('Loader Calendar identity changed')
    return Object.freeze({ state: 'ok', value: calendar() })
  }

  async createCalendar() {
    return Object.freeze({ state: 'ok', value: calendar() })
  }

  async listCalendarEvents(_route, calendarId) {
    if (calendarId !== CALENDAR_ID) throw new Error('Loader Calendar identity changed')
    return Object.freeze({ state: 'ok', value: Object.freeze([event()]) })
  }

  async readCalendarEvent(_route, calendarId, eventId) {
    if (calendarId !== CALENDAR_ID || eventId !== EVENT_ID) {
      throw new Error('Loader Calendar event identity changed')
    }
    return Object.freeze({ state: 'ok', value: event() })
  }

  async createCalendarEvent() {
    return Object.freeze({ state: 'ok', value: event() })
  }

  async updateCalendarEventSchedule() {
    return Object.freeze({ state: 'ok', value: event() })
  }

  subscribeCalendarChanges() {
    return () => undefined
  }
}

export default class WorkbenchCalendarHostFixture extends WorkbenchService {
  static inject = WorkbenchService.inject
  static Config = WorkbenchService.Config

  constructor(ctx, config) {
    const adapter = new LoaderCalendarAdapter()
    super(ctx, config, {
      adapters: Object.freeze({ feishu: adapter, feishuCalendars: adapter }),
    })
  }
}
