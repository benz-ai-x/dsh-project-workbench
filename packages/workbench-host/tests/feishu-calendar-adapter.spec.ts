import type {
  CredentialInfo,
  CredentialProvider,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import type { WorkbenchFeishuCalendarRoute } from '../src/feishu-calendar-federation.ts'
import {
  DshFeishuConnectionAdapter,
  type FeishuFetch,
} from '../src/feishu-connection-adapter.ts'

const APP_ID = 'cli_workbench_calendar_fixture'
const USER_TOKEN = 'calendar-user-token-SENTINEL'
const BOT_SECRET = 'calendar-bot-secret-SENTINEL'
const TENANT_TOKEN = 'calendar-tenant-token-SENTINEL'
const EVENT_IDEMPOTENCY_KEY = '25fdf41b-8c80-2ce1-e94c-de8b5e7aa7e6'
const FIXED_NOW = new Date('2026-08-31T00:00:00.000Z')

interface CredentialHarness {
  readonly provider: CredentialProvider
  readonly refs: string[]
  readonly values: Map<string, ResolvedCredential | undefined>
}

function credentials(): CredentialHarness {
  const refs: string[] = []
  const values = new Map<string, ResolvedCredential | undefined>()
  const provider = {
    resolve: async (ref: string) => {
      refs.push(ref)
      return values.get(ref)
    },
    describe: async (): Promise<CredentialInfo> => ({ configured: true, writable: false }),
  } as unknown as CredentialProvider
  return { provider, refs, values }
}

function route(): WorkbenchFeishuCalendarRoute {
  return Object.freeze({
    kind: 'user',
    routeGeneration: 3,
    appId: APP_ID,
    credentialRef: 'FEISHU_CALENDAR_USER_TOKEN',
    actor: Object.freeze({
      connectionId: 'feishu-primary',
      realm: 'feishu-cn',
      appId: APP_ID,
      kind: 'user',
      routeGeneration: 3,
      openId: 'ou_calendar_owner',
      tenantKey: 'tenant_calendar_fixture',
    }),
  })
}

function botRoute(): WorkbenchFeishuCalendarRoute {
  return Object.freeze({
    kind: 'bot',
    routeGeneration: 5,
    appId: APP_ID,
    credentialRef: 'FEISHU_CALENDAR_BOT_SECRET',
    actor: Object.freeze({
      connectionId: 'feishu-primary',
      realm: 'feishu-cn',
      appId: APP_ID,
      kind: 'bot',
      routeGeneration: 5,
      openId: 'ou_calendar_bot',
      tenantKey: null,
    }),
  })
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function identity(): Response {
  return json({
    code: 0,
    data: {
      open_id: 'ou_calendar_owner',
      tenant_key: 'tenant_calendar_fixture',
      name: 'Calendar Owner',
    },
  })
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url)
}

function method(init: RequestInit | undefined): string {
  return init?.method ?? 'GET'
}

function authorize(init: RequestInit | undefined): void {
  expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${USER_TOKEN}`)
  expect(init?.redirect).toBe('error')
}

describe('DshFeishuConnectionAdapter calendar federation', () => {
  it('uses only the explicitly pinned Bot route for Calendar discovery', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_BOT_SECRET', { value: BOT_SECRET, source: 'file' })
    const paths: string[] = []
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      paths.push(url.pathname)
      expect(init?.redirect).toBe('error')
      if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
        expect(method(init)).toBe('POST')
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        expect(JSON.parse(String(init?.body))).toEqual({
          app_id: APP_ID,
          app_secret: BOT_SECRET,
        })
        return json({ code: 0, tenant_access_token: TENANT_TOKEN, expire: 7_200 })
      }
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TENANT_TOKEN}`)
      if (url.pathname === '/open-apis/bot/v3/info') {
        return json({
          code: 0,
          bot: { activate_status: 2, app_name: 'Calendar Bot', open_id: 'ou_calendar_bot' },
        })
      }
      expect(url.pathname).toBe('/open-apis/calendar/v4/calendars')
      expect(method(init)).toBe('GET')
      return json({ code: 0, data: { calendar_list: [], has_more: false } })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })

    await expect(adapter.listCalendars(botRoute(), new AbortController().signal))
      .resolves.toEqual({ state: 'ok', value: [] })
    expect(store.refs).toEqual(['FEISHU_CALENDAR_BOT_SECRET'])
    expect(paths).toEqual([
      '/open-apis/auth/v3/tenant_access_token/internal',
      '/open-apis/bot/v3/info',
      '/open-apis/calendar/v4/calendars',
    ])
    expect(paths).not.toContain('/open-apis/authen/v1/user_info')
  })

  it('paginates Calendar v4 discovery through the one explicitly selected user route', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let page = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      expect(method(init)).toBe('GET')
      expect(url.pathname).toBe('/open-apis/calendar/v4/calendars')
      expect(url.searchParams.get('page_size')).toBe('50')
      page += 1
      if (page === 1) {
        expect(url.searchParams.has('page_token')).toBe(false)
        return json({
          code: 0,
          data: {
            calendar_list: [{
              calendar_id: 'feishu.cn_alpha@group.calendar.feishu.cn',
              summary: 'Alpha',
              description: 'Writable project calendar',
              type: 'shared',
              role: 'writer',
              is_deleted: false,
              is_third_party: false,
            }],
            has_more: true,
            page_token: 'calendar-page-2',
          },
        })
      }
      expect(url.searchParams.get('page_token')).toBe('calendar-page-2')
      return json({
        code: 0,
        data: {
          calendar_list: [{
            calendar_id: 'feishu.cn_resource@resource.calendar.feishu.cn',
            summary: 'Room',
            description: '',
            type: 'resource',
            role: 'reader',
            is_deleted: true,
            is_third_party: true,
          }],
          has_more: false,
          sync_token: 'ignored-incremental-token',
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.listCalendars(route(), new AbortController().signal)).resolves.toEqual({
      state: 'ok',
      value: [
        {
          calendarId: 'feishu.cn_alpha@group.calendar.feishu.cn',
          summary: 'Alpha',
          description: 'Writable project calendar',
          calendarType: 'shared',
          role: 'writer',
          deleted: false,
          thirdParty: false,
        },
        {
          calendarId: 'feishu.cn_resource@resource.calendar.feishu.cn',
          summary: 'Room',
          description: '',
          calendarType: 'resource',
          role: 'reader',
          deleted: true,
          thirdParty: true,
        },
      ],
    })

    expect(store.refs).toEqual(['FEISHU_CALENDAR_USER_TOKEN'])
    expect(page).toBe(2)
  })

  it('reads one Calendar v4 resource without switching the verified actor', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_primary@group.calendar.feishu.cn'
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      expect(method(init)).toBe('GET')
      expect(decodeURIComponent(url.pathname))
        .toBe(`/open-apis/calendar/v4/calendars/${calendarId}`)
      expect([...url.searchParams]).toEqual([])
      return json({
        code: 0,
        data: {
          calendar_id: calendarId,
          summary: 'Primary',
          description: null,
          type: 'primary',
          role: 'owner',
          is_deleted: false,
          is_third_party: false,
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })

    await expect(adapter.readCalendar(
      route(),
      calendarId,
      new AbortController().signal,
    )).resolves.toEqual({
      state: 'ok',
      value: {
        calendarId,
        summary: 'Primary',
        description: null,
        calendarType: 'primary',
        role: 'owner',
        deleted: false,
        thirdParty: false,
      },
    })
    expect(store.refs).toEqual(['FEISHU_CALENDAR_USER_TOKEN'])
  })

  it('creates one shared calendar with the exact Calendar v4 body', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let createCalls = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      createCalls += 1
      expect(method(init)).toBe('POST')
      expect(url.pathname).toBe('/open-apis/calendar/v4/calendars')
      expect([...url.searchParams]).toEqual([])
      expect(JSON.parse(String(init?.body))).toEqual({
        summary: 'Workbench launch',
        description: 'Formal project dates',
      })
      return json({
        code: 0,
        data: {
          calendar: {
            calendar_id: 'feishu.cn_created@group.calendar.feishu.cn',
            summary: 'Workbench launch',
            description: 'Formal project dates',
            type: 'shared',
            role: 'owner',
            is_deleted: false,
            is_third_party: false,
          },
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })

    await expect(adapter.createCalendar(route(), {
      summary: 'Workbench launch',
      description: 'Formal project dates',
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'ok',
      value: {
        calendarId: 'feishu.cn_created@group.calendar.feishu.cn',
        calendarType: 'shared',
        role: 'owner',
      },
    })
    expect(createCalls).toBe(1)
  })

  it('paginates events and normalizes timed and all-day authority observations', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    let page = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      expect(method(init)).toBe('GET')
      expect(decodeURIComponent(url.pathname))
        .toBe(`/open-apis/calendar/v4/calendars/${calendarId}/events`)
      expect(url.searchParams.get('page_size')).toBe('50')
      expect(url.searchParams.get('user_id_type')).toBe('open_id')
      page += 1
      if (page === 1) {
        expect(url.searchParams.has('page_token')).toBe(false)
        return json({
          code: 0,
          data: {
            items: [{
              event_id: 'event-timed_0',
              organizer_calendar_id: calendarId,
              summary: 'Timed launch',
              description: 'Provider-owned date',
              start_time: { timestamp: '1788228000', timezone: 'Asia/Shanghai' },
              end_time: { timestamp: '1788233400', timezone: 'Asia/Shanghai' },
              recurrence: '',
              status: 'confirmed',
              is_exception: false,
              app_link: 'https://applink.feishu.cn/client/calendar/event/timed',
            }],
            has_more: true,
            page_token: 'event-page-2',
          },
        })
      }
      expect(url.searchParams.get('page_token')).toBe('event-page-2')
      return json({
        code: 0,
        data: {
          items: [{
            event_id: 'event-all-day_0',
            organizer_calendar_id: calendarId,
            summary: 'All-day gate',
            description: null,
            start_time: { date: '2026-09-02', timezone: 'UTC' },
            end_time: { date: '2026-09-03', timezone: 'UTC' },
            recurrence: null,
            status: 'cancelled',
            is_exception: false,
            app_link: 'https://applink.feishu.cn/client/calendar/event/all-day',
          }],
          has_more: false,
          sync_token: 'ignored-event-sync-token',
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.listCalendarEvents(
      route(),
      calendarId,
      new AbortController().signal,
    )).resolves.toEqual({
      state: 'ok',
      value: [
        {
          calendarId,
          eventId: 'event-timed_0',
          organizerCalendarId: calendarId,
          summary: 'Timed launch',
          description: 'Provider-owned date',
          schedule: {
            kind: 'timed',
            startAt: '2026-09-01T02:00:00.000Z',
            endAt: '2026-09-01T03:30:00.000Z',
            timeZone: 'Asia/Shanghai',
          },
          status: 'confirmed',
          recurring: false,
          exception: false,
          appLink: 'https://applink.feishu.cn/client/calendar/event/timed',
          remoteObservationVersion: 'sha256:cc32673b1d0671974204bef1c34608d5619f054f8f111816fdcd263f36094b1f',
          observedAt: '2026-08-31T00:00:00.000Z',
        },
        {
          calendarId,
          eventId: 'event-all-day_0',
          organizerCalendarId: calendarId,
          summary: 'All-day gate',
          description: null,
          schedule: { kind: 'all-day', startDate: '2026-09-02', endDate: '2026-09-03' },
          status: 'cancelled',
          recurring: false,
          exception: false,
          appLink: 'https://applink.feishu.cn/client/calendar/event/all-day',
          remoteObservationVersion: 'sha256:0853ebcdb0c4ed86194036fec157e3c02731bcf8fce239ee771aefe155c5039f',
          observedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    })
    expect(page).toBe(2)
  })

  it('reads one event and preserves recurring, exception, organizer, and unknown status facts', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      expect(method(init)).toBe('GET')
      expect(decodeURIComponent(url.pathname))
        .toBe(`/open-apis/calendar/v4/calendars/${calendarId}/events/event-recurring_0`)
      expect(url.searchParams.get('user_id_type')).toBe('open_id')
      return json({
        code: 0,
        data: {
          event: {
            event_id: 'event-recurring_0',
            organizer_calendar_id: 'feishu.cn_other@group.calendar.feishu.cn',
            summary: 'External recurring event',
            description: '',
            start_time: {
              date_time: '2026-09-04T09:00:00+08:00',
              timezone: 'Asia/Shanghai',
            },
            end_time: {
              date_time: '2026-09-04T10:00:00+08:00',
              timezone: 'Asia/Shanghai',
            },
            recurrence: 'FREQ=DAILY;INTERVAL=1',
            status: 'tentative',
            is_exception: true,
            app_link: 'https://applink.feishu.cn/client/calendar/event/recurring',
          },
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.readCalendarEvent(
      route(),
      calendarId,
      'event-recurring_0',
      new AbortController().signal,
    )).resolves.toEqual({
      state: 'ok',
      value: {
        calendarId,
        eventId: 'event-recurring_0',
        organizerCalendarId: 'feishu.cn_other@group.calendar.feishu.cn',
        summary: 'External recurring event',
        description: '',
        schedule: {
          kind: 'timed',
          startAt: '2026-09-04T01:00:00.000Z',
          endAt: '2026-09-04T02:00:00.000Z',
          timeZone: 'Asia/Shanghai',
        },
        status: 'unknown',
        recurring: true,
        exception: true,
        appLink: 'https://applink.feishu.cn/client/calendar/event/recurring',
        remoteObservationVersion: 'sha256:544e09ff5b2e31ba0e268df3afa357391906631332aa70cea03e91f5072f664b',
        observedAt: '2026-08-31T00:00:00.000Z',
      },
    })
  })

  it('creates one timed event with the stable provider idempotency key and exact time fields', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    let createCalls = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      createCalls += 1
      expect(method(init)).toBe('POST')
      expect(decodeURIComponent(url.pathname))
        .toBe(`/open-apis/calendar/v4/calendars/${calendarId}/events`)
      expect(url.searchParams.get('user_id_type')).toBe('open_id')
      expect(url.searchParams.get('idempotency_key')).toBe(EVENT_IDEMPOTENCY_KEY)
      expect(JSON.parse(String(init?.body))).toEqual({
        summary: 'Release gate',
        description: 'Formal commitment',
        start_time: { timestamp: '1788228000', timezone: 'Asia/Shanghai' },
        end_time: { timestamp: '1788233400', timezone: 'Asia/Shanghai' },
      })
      return json({
        code: 0,
        data: {
          event: {
            event_id: 'event-created_0',
            organizer_calendar_id: calendarId,
            summary: 'Release gate',
            description: 'Formal commitment',
            start_time: { timestamp: '1788228000', timezone: 'Asia/Shanghai' },
            end_time: { timestamp: '1788233400', timezone: 'Asia/Shanghai' },
            recurrence: '',
            status: 'confirmed',
            is_exception: false,
            app_link: 'https://applink.feishu.cn/client/calendar/event/created',
          },
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.createCalendarEvent(route(), {
      calendarId,
      idempotencyKey: EVENT_IDEMPOTENCY_KEY,
      summary: 'Release gate',
      description: 'Formal commitment',
      schedule: {
        kind: 'timed',
        startAt: '2026-09-01T10:00:00+08:00',
        endAt: '2026-09-01T11:30:00+08:00',
        timeZone: 'Asia/Shanghai',
      },
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'ok',
      value: {
        eventId: 'event-created_0',
        schedule: {
          kind: 'timed',
          startAt: '2026-09-01T02:00:00.000Z',
          endAt: '2026-09-01T03:30:00.000Z',
          timeZone: 'Asia/Shanghai',
        },
        remoteObservationVersion: 'sha256:cb006ecf51ff9555d5ed204b3d0b72bb4062715085df82c52bd451675455b411',
      },
    })
    expect(createCalls).toBe(1)
  })

  it('GETs before one date-only PATCH and projects only the returned event authority', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    const methods: string[] = []
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      expect(decodeURIComponent(url.pathname))
        .toBe(`/open-apis/calendar/v4/calendars/${calendarId}/events/event-timed_0`)
      expect(url.searchParams.get('user_id_type')).toBe('open_id')
      methods.push(method(init))
      if (method(init) === 'GET') {
        return json({
          code: 0,
          data: {
            event: {
              event_id: 'event-timed_0',
              organizer_calendar_id: calendarId,
              summary: 'Timed launch',
              description: 'Provider-owned date',
              start_time: { timestamp: '1788228000', timezone: 'Asia/Shanghai' },
              end_time: { timestamp: '1788233400', timezone: 'Asia/Shanghai' },
              recurrence: '',
              status: 'confirmed',
              is_exception: false,
              app_link: 'https://applink.feishu.cn/client/calendar/event/timed',
            },
          },
        })
      }
      expect(method(init)).toBe('PATCH')
      expect(JSON.parse(String(init?.body))).toEqual({
        start_time: { date: '2026-09-05', timezone: 'UTC' },
        end_time: { date: '2026-09-06', timezone: 'UTC' },
      })
      return json({
        code: 0,
        data: {
          event: {
            event_id: 'event-timed_0',
            organizer_calendar_id: calendarId,
            summary: 'Provider retained title',
            description: 'Provider retained description',
            start_time: { date: '2026-09-05', timezone: 'UTC' },
            end_time: { date: '2026-09-06', timezone: 'UTC' },
            recurrence: '',
            status: 'confirmed',
            is_exception: false,
            app_link: 'https://applink.feishu.cn/client/calendar/event/timed',
          },
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.updateCalendarEventSchedule(route(), {
      calendarId,
      eventId: 'event-timed_0',
      expectedRemoteObservationVersion: 'sha256:cc32673b1d0671974204bef1c34608d5619f054f8f111816fdcd263f36094b1f',
      schedule: { kind: 'all-day', startDate: '2026-09-05', endDate: '2026-09-06' },
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'ok',
      value: {
        summary: 'Provider retained title',
        description: 'Provider retained description',
        schedule: { kind: 'all-day', startDate: '2026-09-05', endDate: '2026-09-06' },
        remoteObservationVersion: 'sha256:b943de0c617a68358f023b3a9dcf0c0547d7e4f3aa5921f9938e26c07c0a8a75',
      },
    })
    expect(methods).toEqual(['GET', 'PATCH'])
  })

  it('maps Calendar v4 not-found and access failures to closed safe issues', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      const calendarId = decodeURIComponent(url.pathname).split('/').at(-1)
      return calendarId === 'feishu.cn_missing@group.calendar.feishu.cn'
        ? json({ code: 191000, msg: 'SENSITIVE missing resource body' }, { status: 404 })
        : json({ code: 191002, msg: 'SENSITIVE denied resource body' }, { status: 403 })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })
    const signal = new AbortController().signal

    await expect(adapter.readCalendar(
      route(),
      'feishu.cn_missing@group.calendar.feishu.cn',
      signal,
    )).resolves.toMatchObject({
      state: 'rejected',
      issue: { code: 'resource-not-found', recovery: 'check-resource-id' },
    })
    await expect(adapter.readCalendar(
      route(),
      'feishu.cn_denied@group.calendar.feishu.cn',
      signal,
    )).resolves.toMatchObject({
      state: 'rejected',
      issue: { code: 'resource-access-unavailable', recovery: 'share-resource' },
    })
  })

  it('returns the fresh Feishu observation and performs no PATCH after version drift', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    const methods: string[] = []
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      authorize(init)
      methods.push(method(init))
      return json({
        code: 0,
        data: {
          event: {
            event_id: 'event-timed_0',
            organizer_calendar_id: calendarId,
            summary: 'Feishu moved this milestone',
            description: null,
            start_time: { date: '2026-09-05', timezone: 'UTC' },
            end_time: { date: '2026-09-06', timezone: 'UTC' },
            recurrence: '',
            status: 'confirmed',
            is_exception: false,
            app_link: 'https://applink.feishu.cn/client/calendar/event/timed',
          },
        },
      })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    await expect(adapter.updateCalendarEventSchedule(route(), {
      calendarId,
      eventId: 'event-timed_0',
      expectedRemoteObservationVersion: 'sha256:cc32673b1d0671974204bef1c34608d5619f054f8f111816fdcd263f36094b1f',
      schedule: { kind: 'all-day', startDate: '2026-09-07', endDate: '2026-09-08' },
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'conflict',
      current: {
        schedule: { kind: 'all-day', startDate: '2026-09-05', endDate: '2026-09-06' },
        remoteObservationVersion: 'sha256:b943de0c617a68358f023b3a9dcf0c0547d7e4f3aa5921f9938e26c07c0a8a75',
      },
    })
    expect(methods).toEqual(['GET'])
  })

  it('reports ambiguous calendar create and date PATCH once without exposing transport details', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let calendarCreateCalls = 0
    const calendarAdapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input) => {
        const url = requestUrl(input)
        if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
        calendarCreateCalls += 1
        throw new Error('SENSITIVE calendar transport failure')
      },
    })

    await expect(calendarAdapter.createCalendar(route(), {
      summary: 'Ambiguous calendar',
      description: null,
    }, new AbortController().signal)).resolves.toEqual({
      state: 'unknown',
      issue: {
        code: 'provider-unavailable',
        recovery: 'retry-later',
        missingScopes: [],
        grantPlane: null,
        retryAt: null,
      },
    })
    expect(calendarCreateCalls).toBe(1)

    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    let patchCalls = 0
    const patchAdapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input, init) => {
        const url = requestUrl(input)
        if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
        if (method(init) === 'PATCH') {
          patchCalls += 1
          throw new Error('SENSITIVE patch transport failure')
        }
        return json({
          code: 0,
          data: {
            event: {
              event_id: 'event-timed_0',
              organizer_calendar_id: calendarId,
              summary: 'Timed launch',
              description: null,
              start_time: { timestamp: '1788228000', timezone: 'Asia/Shanghai' },
              end_time: { timestamp: '1788233400', timezone: 'Asia/Shanghai' },
              recurrence: '',
              status: 'confirmed',
              is_exception: false,
              app_link: 'https://applink.feishu.cn/client/calendar/event/timed',
            },
          },
        })
      },
      now: () => FIXED_NOW,
    })
    await expect(patchAdapter.updateCalendarEventSchedule(route(), {
      calendarId,
      eventId: 'event-timed_0',
      expectedRemoteObservationVersion: 'sha256:cc32673b1d0671974204bef1c34608d5619f054f8f111816fdcd263f36094b1f',
      schedule: { kind: 'all-day', startDate: '2026-09-05', endDate: '2026-09-06' },
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'unknown',
      issue: { code: 'provider-unavailable', recovery: 'retry-later' },
    })
    expect(patchCalls).toBe(1)
  })

  it('fails invalid schedules before resolving credentials or calling Calendar v4', async () => {
    const store = credentials()
    let fetchCalls = 0
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async () => {
        fetchCalls += 1
        return json({ code: 0 })
      },
    })
    const base = {
      calendarId: 'feishu.cn_alpha@group.calendar.feishu.cn',
      idempotencyKey: EVENT_IDEMPOTENCY_KEY,
      summary: 'Invalid date fixture',
      description: null,
    }
    const invalidSchedules = [
      { kind: 'all-day', startDate: '2026-02-30', endDate: '2026-03-01' },
      { kind: 'all-day', startDate: '2026-09-01', endDate: '2026-09-01' },
      {
        kind: 'timed',
        startAt: '2026-09-01T09:00:00',
        endAt: '2026-09-01T10:00:00+08:00',
        timeZone: 'Asia/Shanghai',
      },
      {
        kind: 'timed',
        startAt: '2026-09-01T09:00:00+08:00',
        endAt: '2026-09-01T10:00:00+08:00',
        timeZone: 'Mars/Olympus_Mons',
      },
      {
        kind: 'timed',
        startAt: '2026-09-01T09:00:00.100+08:00',
        endAt: '2026-09-01T09:00:00.900+08:00',
        timeZone: 'Asia/Shanghai',
      },
    ] as const

    for (const schedule of invalidSchedules) {
      await expect(adapter.createCalendarEvent(
        route(),
        { ...base, schedule },
        new AbortController().signal,
      )).rejects.toThrow(TypeError)
    }
    expect(store.refs).toEqual([])
    expect(fetchCalls).toBe(0)
  })

  it('fails closed on malformed reads and treats incomplete 2xx writes as unknown', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calendarId = 'feishu.cn_alpha@group.calendar.feishu.cn'
    let mode: 'read' | 'write' = 'read'
    const request: FeishuFetch = async (input) => {
      const url = requestUrl(input)
      if (url.pathname === '/open-apis/authen/v1/user_info') return identity()
      if (mode === 'read') {
        return json({
          code: 0,
          data: {
            event: {
              event_id: 'event-malformed_0',
              organizer_calendar_id: calendarId,
              summary: 'SENSITIVE malformed response',
              description: null,
              start_time: { date: '2026-09-01', timestamp: '1788228000', timezone: 'UTC' },
              end_time: { date: '2026-09-02', timezone: 'UTC' },
              recurrence: '',
              status: 'confirmed',
              is_exception: false,
              app_link: 'https://applink.feishu.cn/client/calendar/event/malformed',
            },
          },
        })
      }
      return json({ data: { calendar: { summary: 'SENSITIVE incomplete write' } } })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })

    const malformed = await adapter.readCalendarEvent(
      route(),
      calendarId,
      'event-malformed_0',
      new AbortController().signal,
    )
    expect(malformed).toMatchObject({
      state: 'rejected',
      issue: { code: 'provider-response-invalid', recovery: 'inspect-provider' },
    })
    expect(JSON.stringify(malformed)).not.toContain('SENSITIVE')

    mode = 'write'
    await expect(adapter.createCalendar(route(), {
      summary: 'Ambiguous 2xx calendar',
      description: null,
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'unknown',
      issue: { code: 'unknown-provider-error', recovery: 'inspect-provider' },
    })
  })

  it('rejects a Calendar page missing its item collection', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input) => requestUrl(input).pathname === '/open-apis/authen/v1/user_info'
        ? identity()
        : json({ code: 0, data: { has_more: false } }),
    })

    await expect(adapter.listCalendars(route(), new AbortController().signal))
      .resolves.toMatchObject({
        state: 'rejected',
        issue: { code: 'provider-response-invalid', recovery: 'inspect-provider' },
      })
  })

  it('allowlists Calendar scopes without forwarding provider diagnostics', async () => {
    const store = credentials()
    store.values.set('FEISHU_CALENDAR_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input) => requestUrl(input).pathname === '/open-apis/authen/v1/user_info'
        ? identity()
        : json({
            code: 99991672,
            msg: 'SENSITIVE provider scope diagnostic',
            error: {
              permission_violations: [
                { subject: 'calendar:calendar.event:read' },
                { subject: 'unknown:SENSITIVE:scope' },
              ],
            },
          }, { status: 403 }),
    })

    const result = await adapter.listCalendars(route(), new AbortController().signal)
    expect(result).toMatchObject({
      state: 'rejected',
      issue: {
        code: 'missing-app-scope',
        recovery: 'grant-app-scope',
        missingScopes: ['calendar:calendar.event:read'],
        grantPlane: 'application',
      },
    })
    expect(JSON.stringify(result)).not.toContain('SENSITIVE')
  })
})
