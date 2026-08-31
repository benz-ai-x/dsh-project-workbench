import type {
  FeishuConnectionIssue,
  ProjectCalendarSchedule,
} from './client.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuWriteResult,
} from './feishu-task-federation.ts'

/** Exact verified actor route pinned by one Project calendar binding. */
export type WorkbenchFeishuCalendarRoute = WorkbenchFeishuTaskRoute

/** Closed Workbench schedule value; provider request bodies never cross this seam. */
export type WorkbenchCalendarSchedule = ProjectCalendarSchedule

export type WorkbenchFeishuCalendarRole =
  | 'unknown'
  | 'free_busy_reader'
  | 'reader'
  | 'writer'
  | 'owner'

export type WorkbenchFeishuCalendarType = 'primary' | 'shared' | 'resource' | 'unknown'

/** Route-relative calendar observation returned by Feishu Calendar v4. */
export interface WorkbenchFeishuCalendarSnapshot {
  readonly calendarId: string
  readonly summary: string
  readonly description: string | null
  readonly calendarType: WorkbenchFeishuCalendarType
  readonly role: WorkbenchFeishuCalendarRole
  readonly deleted: boolean
  readonly thirdParty: boolean
}

export type WorkbenchFeishuEventStatus = 'confirmed' | 'cancelled' | 'unknown'

/** Detached provider event observation used by discovery and reconciliation. */
export interface WorkbenchFeishuCalendarEventSnapshot {
  readonly calendarId: string
  readonly eventId: string
  readonly organizerCalendarId: string
  readonly summary: string
  readonly description: string | null
  readonly schedule: WorkbenchCalendarSchedule
  readonly status: WorkbenchFeishuEventStatus
  readonly recurring: boolean
  readonly exception: boolean
  readonly appLink: string
  /** Versioned digest of the canonical provider authority tuple, not provider CAS. */
  readonly remoteObservationVersion: string
  readonly observedAt: string
}

export interface WorkbenchFeishuCalendarChangeNotification {
  readonly eventEnvelopeId: string
  readonly calendarId: string
  /** Gray-release provider hint; correctness must not depend on its presence. */
  readonly eventId: string | null
  readonly observedAt: string
}

export type WorkbenchFeishuCalendarChangeListener = (
  notification: WorkbenchFeishuCalendarChangeNotification,
) => Promise<void>

export type WorkbenchFeishuCalendarEventWriteResult =
  | WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>
  | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuCalendarEventSnapshot
  }

/**
 * Provider-neutral Calendar v4 seam. Every call receives exactly one route;
 * implementations have no alternate actor with which to retry a denial.
 */
export interface WorkbenchFeishuCalendarExternalAdapter {
  listCalendars(
    route: WorkbenchFeishuCalendarRoute,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarSnapshot[]>>

  readCalendar(
    route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarSnapshot>>

  createCalendar(
    route: WorkbenchFeishuCalendarRoute,
    input: Readonly<{ readonly summary: string; readonly description: string | null }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarSnapshot>>

  listCalendarEvents(
    route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly WorkbenchFeishuCalendarEventSnapshot[]>>

  readCalendarEvent(
    route: WorkbenchFeishuCalendarRoute,
    calendarId: string,
    eventId: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuCalendarEventSnapshot>>

  createCalendarEvent(
    route: WorkbenchFeishuCalendarRoute,
    input: Readonly<{
      readonly calendarId: string
      readonly idempotencyKey: string
      readonly summary: string
      readonly description: string | null
      readonly schedule: WorkbenchCalendarSchedule
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuCalendarEventSnapshot>>

  updateCalendarEventSchedule(
    route: WorkbenchFeishuCalendarRoute,
    input: Readonly<{
      readonly calendarId: string
      readonly eventId: string
      readonly expectedRemoteObservationVersion: string
      readonly schedule: WorkbenchCalendarSchedule
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuCalendarEventWriteResult>

  /** Optional low-latency hint. Bounded reconciliation remains correctness. */
  subscribeCalendarChanges?(listener: WorkbenchFeishuCalendarChangeListener): () => void
}

/** Fixed safe issue used when a provider omits its optional Calendar implementation. */
export const FEISHU_CALENDAR_UNAVAILABLE_ISSUE: FeishuConnectionIssue = Object.freeze({
  code: 'provider-unavailable',
  recovery: 'inspect-provider',
  missingScopes: Object.freeze([]),
  grantPlane: null,
  retryAt: null,
})
