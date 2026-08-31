# T10 Feishu calendar and Milestone research

## Scope and source policy

This note freezes the provider and product contract for GitHub Issue #11. It
covers one Project calendar binding, Workbench-owned Milestone semantics,
Feishu-authoritative dates, create-or-bind event flows, convergence, and
response-loss handling. It does not introduce meetings, recurring Milestones,
Deliverable deadlines, task-date projection, a public webhook receiver, or a
generic calendar connector registry.

Only first-party Feishu/Lark material is normative. The reproducible provider
baseline is the official `larksuite/oapi-sdk-go` repository at commit
[`b059ee1824d45444306559b5c33c3f268c0de10d`](https://github.com/larksuite/oapi-sdk-go/tree/b059ee1824d45444306559b5c33c3f268c0de10d).
Its generated Calendar v4 source embeds the OpenAPI routes, request fields,
access-token support, limits, and response models used below. API Explorer
pages remain useful operator documentation, but an unversioned browser page is
not the implementation baseline.

## Provider contract

### Calendar and event routes

| Purpose | Method and path | T10 use |
|---|---|---|
| List accessible calendars | `GET /open-apis/calendar/v4/calendars` | Bounded discovery for the explicitly selected route |
| Read one calendar | `GET /open-apis/calendar/v4/calendars/:calendar_id` | Preflight type, deletion, third-party, and role checks |
| Create one shared calendar | `POST /open-apis/calendar/v4/calendars` | Optional Project-calendar creation |
| List calendar events | `GET /open-apis/calendar/v4/calendars/:calendar_id/events` | Bounded existing-event discovery and incremental repair |
| Read one event | `GET /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id` | Binding validation, pre-write observation, and reconciliation |
| Create one event | `POST /open-apis/calendar/v4/calendars/:calendar_id/events?idempotency_key=...` | Create a Milestone's authoritative event |
| Update one event | `PATCH /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id` | Update only the authoritative start/end time |

The official generated resource binds both tenant and user tokens to Calendar
list/get/create and Event create/get/list/PATCH. It also says event creation and
date-changing PATCH require a `primary` or `shared` calendar with `writer` or
`owner` access. A non-organizer participant may edit only personal fields, not
the event's formal date. See the official
[`calendar` methods](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/resource.go#L57-L243)
and
[`calendar.event` methods](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/resource.go#L592-L785).

A selectable Project calendar must therefore be visible through the exact
verified route, not deleted, not third-party, type `primary` or `shared`, and
role `writer` or `owner`. T10 pins that route generation and never retries with
the other identity. A bound existing event must be non-recurring,
non-exceptional, readable in that calendar, and organized by that calendar so
Workbench can honestly offer date writes.

### Stable identity and links

Calendar identity is the provider `calendar_id`; Event identity is the
provider `event_id`. The calendar response exposes its current route-relative
`role`, `type`, deletion flag, and third-party flag. The event response exposes
the organizer calendar, date fields, recurrence/status, and an `app_link` for a
canonical Feishu client link. See the official
[`Calendar` model](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L600-L620)
and
[`CalendarEvent` model](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L1012-L1069).

T10 stores exactly one immutable Project-to-calendar binding and one immutable
Milestone-to-event binding. The same provider calendar cannot silently become
the primary calendar of another local Project, and the same provider event
cannot back two local Milestones. Resource IDs and app links are returned only
inside authorized Project Calendar projections; they do not enter generic
Activity, audit, Outbox payloads, receipts, logs, or error strings.

### Date representation

Feishu supports all-day dates and timed values. Its `TimeInfo` carries either a
calendar `date` or a timestamp/date-time plus an IANA timezone. See the
official
[`TimeInfo` model](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L7633-L7715).

Workbench uses a closed business value rather than leaking the provider body:

- `all-day`: `startDate` and exclusive `endDate`, both strict ISO calendar
  dates; `startDate < endDate`.
- `timed`: an RFC 3339 `startAt`, RFC 3339 `endAt`, and one validated IANA
  `timeZone`; both instants must include an offset and `startAt < endAt`.

Both ends must have the same kind. Zero-length, mixed all-day/timed, invalid
calendar dates, missing offsets, and unrecognized timezones fail before any
provider call. The adapter canonicalizes Feishu's accepted response back into
this value; the returned Feishu observation, not the submitted request, becomes
the projection.

Milestone name and optional description remain Workbench business semantics.
The event summary/description are initialized from them only when Workbench
creates an event. Later Feishu edits to title or description do not overwrite
Milestone semantics, and T10 does not add a Milestone semantic-edit command.

### Event create idempotency and calendar-create limitation

Event creation has a documented query parameter named `idempotency_key`, unique
in the application-and-calendar dimension and intended to prevent duplicate
resource creation. T10 derives one stable provider key from the immutable local
operation identity and persists it before delivery. See the official
[`CreateCalendarEventReq`](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L9603-L9665).

Calendar creation has no corresponding idempotency parameter in the official
request, and event PATCH has neither an idempotency parameter nor a conditional
version header. Consequently:

- calendar creation is a one-attempt external effect; an ambiguous response is
  `unknown` and is never automatically redelivered;
- event creation always sends the frozen provider idempotency key, but an
  ambiguous response still becomes `unknown` rather than weakening the T03
  receipt-first replay rule or assuming undocumented key retention;
- event PATCH uses Workbench's caller-stable command key plus one durable
  provider attempt. Ambiguity remains `unknown` until reconciliation.

An unknown event-create operation may be resolved only by exact reconciliation
evidence. A later explicit recovery feature may use the same provider key, but
T10 does not introduce an implicit receipt replay that calls Feishu again.

## Concurrency and authority

### “Remote version” is an observation digest

The current official `CalendarEvent` response contains no resource revision,
ETag, update timestamp, or sequence, and Event PATCH accepts no expected
version. This is a material provider limitation, not an implementation detail.
T10 defines `remoteObservationVersion` as a versioned SHA-256 digest of the
canonical Feishu authority tuple:

`calendarId + eventId + organizerCalendarId + status + recurrence + normalized start + normalized end`.

The digest is opaque to callers. It is a stable comparison token for an exact
Feishu observation, not a claim that Feishu enforces CAS.

A Workbench date write supplies the current Project schedule revision,
Milestone revision, and remote observation version. The Host re-proves the
pinned identity, GETs the event outside the database transaction, and compares
the fresh digest before reserving the write. A changed digest is an observable
`remote-version-changed` conflict and the freshly observed Feishu dates are
committed as authority. If it still matches, Workbench reserves and claims one
exact date PATCH, validates the returned event, and commits only that returned
observation. Another editor can still race between GET and PATCH; response
validation and subsequent reconciliation can expose the result, but T10 must
not describe this as provider-atomic CAS.

### Feishu dates are authoritative

Workbench owns Milestone identity, name, description, lifecycle provenance,
and its event binding. Feishu owns the formal start/end dates and remote event
status. Both origins converge to the same detached projection:

- a Workbench-originated create/update projects only Feishu's accepted event;
- a Feishu-originated change is read from the bound event and advances the
  Project schedule revision if the authority tuple changed;
- a cancelled, deleted, recurring, moved, inaccessible, or no-longer-organizer
  event is retained as an explicit blocked sync fact, never silently replaced;
- no local timestamp wins over a different Feishu observation.

Every changed Milestone atomically appends a durable `ProjectScheduleChange`
with source (`workbench` or `feishu`), changed-field codes, Project schedule
revision, and Milestone revision. This is the dependency-consumer seam for
later planning and risk modules. Authorized Milestone projections may show the
bounded before/after dates in recent-change history; generic Activity shows
only the redacted action, IDs, versions, and safe result code.

### Event notifications are hints; reconciliation is correctness

The Calendar v4 event-change notification is calendar-scoped. Its event ID and
change type are explicitly documented as gray-release fields, so T10 cannot
depend on them. See the official
[`P2CalendarEventChangedV4Data`](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L12487-L12497).

A trusted normalized notification therefore carries an event envelope ID and
the bound calendar ID, deduplicates through the Inbox, and triggers a bounded
GET of every event currently bound to that Project. The same reconciliation is
available explicitly and runs periodically to repair missed, duplicated,
reordered, or unavailable notifications. The periodic timer is cancelled and
drained with the Scenario. A public webhook carrier and subscription
administration remain outside T10.

## Frozen Workbench design

### Domain and revisions

- One Project has zero or one immutable primary `ProjectCalendarBinding`.
- A binding pins the exact Feishu realm, route kind, route generation, actor
  binding, calendar ID, observed calendar role/type, and local binding revision.
- A `Milestone` has a stable ID, immutable T10 name/description, creation
  provenance, one event ID, an authoritative schedule projection, an opaque
  remote observation version, sync status, revision, and last successful
  observation time.
- A Project owns one monotonically increasing schedule revision. Any binding,
  Milestone creation, authoritative date/status change, or recovered outcome
  advances it exactly once in the same transaction as its change feed, audit,
  Outbox/receipt settlement, and projection.
- T10 admits at most 100 Milestones per Project and returns at most 50 recent
  schedule changes. External discovery and reconciliation have explicit page,
  item, body-size, timeout, and cancellation bounds.

### Public Host surface

T10 adds seven generated `workbench` Remote behaviors:

1. `discoverFeishuCalendars`
2. `bindProjectCalendar`
3. `discoverFeishuCalendarEvents`
4. `getProjectMilestones`
5. `createProjectMilestone`
6. `updateProjectMilestoneDate`
7. `reconcileProjectCalendar`

Event ingestion remains an internal Scenario seam. Discovery and reads require
`workbench.project.calendar.read`; binding requires
`workbench.project.calendar.bind`; reconciliation requires
`workbench.project.calendar.reconcile`; Milestone creation/date changes require
`workbench.project.milestone.write`. Every operation independently authorizes,
then verifies Project scope and the exact pinned Feishu actor before touching a
provider resource.

`bindProjectCalendar` has `existing` and `create` modes. Existing mode is a
read/validate plus local ledger commit. Create mode reserves/claims/settles one
non-idempotent provider operation. A successful binding is immutable in T10.

`createProjectMilestone` has `existing-event` and `create-event` modes. Both
persist the same Milestone shape. Existing mode validates the event without an
external write. Create mode reserves the Milestone draft and exact event intent
before sending one create request with its provider idempotency key.

`updateProjectMilestoneDate` patches only `start_time` and `end_time`; it does
not round-trip unrelated Feishu fields. It carries Project schedule,
Milestone, and remote observation versions plus a caller-stable idempotency key,
causation ID, and closed reason.

### Durable external-effect protocol

1. Receipt replay and immutable intent-hash comparison happen before provider
   work.
2. Identity/resource reads occur outside SQLite write transactions.
3. One transaction reserves the normalized operation, immutable provider
   intent, accepted receipt, pending redacted Outbox fact, and hash-chained
   audit event under local CAS.
4. One claim changes `prepared` to `inflight` and permits exactly one provider
   attempt.
5. A definitive response settles delivered or failed and commits the returned
   Feishu observation. A preflight authority change settles conflict while
   converging the fresh Feishu dates.
6. Transport ambiguity, malformed success, or restart-recovered inflight state
   settles `unknown`; it is never automatically offered for delivery again.
7. Reconciliation may prove an unknown date update delivered when the complete
   authority tuple exactly equals its frozen intent. Otherwise the unknown fact
   remains visible for Owner resolution.

Calendar/event titles, descriptions, exact dates, provider IDs/links, raw
bodies/errors, credentials, tokens, and identity values stay out of generic
audit, Activity, Outbox payloads, receipts, diagnostics, and logs.

## Client contract

The localized Project Milestones surface:

- discovers calendars only after the Owner explicitly selects one verified
  Bot/User route;
- supports create/select calendar and create/select event without hidden actor
  fallback;
- shows Milestone semantics, authoritative date, event app link, sync status,
  remote-change conflict, pending/unknown effect, and bounded recent changes;
- requires explicit confirmation before a date PATCH and preserves the exact
  retry envelope only for an ambiguous browser response;
- never auto-retries a provider-unknown operation;
- keeps the last authoritative projection while disconnected, and clears
  protected discovery results/drafts on Project switch, logout, expiry, Owner
  change, selection clearing, HMR, and Fiber disposal.

All-day and timed inputs have textual labels and errors; sync health is not
color-only; links name their destination; loading, empty, stale, conflict,
unknown, and failed states remain distinguishable to screen readers.

## Required behavioral evidence

- Schema v8 to v9 migration, restart, and operation recovery.
- Exact Calendar v4 list/get/create and Event list/get/create/PATCH fixtures for
  Bot and User routes, including the event-create `idempotency_key`.
- Calendar type/role/deleted/third-party checks, exact route pinning, unique
  binding, bounded pagination, timeout, cancellation, and response-size limits.
- Strict all-day/timed validation and canonical remote-observation digests.
- Existing/create calendar and existing/create event paths with stable provider
  IDs and links.
- Local Project/Milestone/remote-version conflict matrices and proof that a
  preflight conflict commits fresh Feishu authority without a PATCH.
- Duplicate notifications, missing notifications, event deletion/cancellation,
  organizer/calendar drift, periodic repair, and committed schedule-change feed
  observations.
- Event create and date update success replay without duplicate effects;
  calendar-create/date-PATCH response loss and inflight restart become unknown
  without blind redelivery; exact reconciliation can resolve a matching update.
- Audit/Activity/Outbox/receipt/log redaction, transaction rollback, disposal,
  and timer drain.
- Seven generated Remote faces, localized accessible Client lifecycle tests,
  real Loader/Profile behavior, browser boundary coverage, built entries, and
  real packed archives without requiring live Feishu credentials.

## Explicitly outside T10

- Calendar rebinding/unbinding/deletion, event deletion, recurring events,
  meetings, attendees, rooms, RSVP, reminders, and subscription administration.
- Deliverable or task-date synchronization, dependency graph calculations,
  capacity/probability scheduling, Plan Baselines, PMO reminders, and risk
  derivation.
- Public webhook transport, Feishu permission administration, live production
  mutation in automated tests, or a generic provider registry.
