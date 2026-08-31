# T11 Deliverable planning and acceptance contract

## Scope and source policy

This note freezes the product and implementation contract for GitHub Issue
[#12](https://github.com/benz-ai-x/dsh-project-workbench/issues/12). T11 adds
one first-class Workbench-owned Deliverable flow from initial plan through a
typed Review Center acceptance decision. It reuses the exact Feishu Calendar
v4 and Task v2 boundaries already proven by T08 and T10; it does not add a new
provider route.

The normative product sources are the parent V1 spec and design. The provider
baseline remains the first-party Feishu/Lark SDK material pinned by the T08 and
T10 research notes. In particular, event creation keeps using Calendar v4's
documented application-and-calendar-scoped `idempotency_key`, and task links
keep using the provider task GUID projected by T08. The official Calendar
methods and models are retained at the audited SDK commit:

- [Calendar v4 methods](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/resource.go#L57-L243)
- [Calendar event methods](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/resource.go#L592-L785)
- [Calendar event model](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L1012-L1069)
- [Event-create idempotency request](https://github.com/larksuite/oapi-sdk-go/blob/b059ee1824d45444306559b5c33c3f268c0de10d/service/calendar/v4/model.go#L9603-L9665)

T11 deliberately has no File provider integration. The public Feishu material
does not give this ticket one cross-source, provider-neutral proof that a
managed, local, and Feishu file version exists and remains readable. T11 can
honestly make a declared exact version reference immutable inside Workbench;
T17--T20 later resolve and verify those references through their real source
adapters. UI copy must not upgrade `declared` into `verified`.

## Module and interface

`Deliverables` is one deep Host module behind four explicit Scenario/Remote
behaviours:

1. `projectDeliverables` reads the complete authorized Project workspace and
   bounded Deliverable Activity.
2. `createProjectDeliverable` creates the semantic plan and binds or creates
   its authoritative calendar event.
3. `requestDeliverableAcceptance` freezes one complete candidate-version set
   and opens one typed Review Center item.
4. `decideDeliverableAcceptance` records one closed Owner decision and, for
   approval, creates the immutable Final Release in the same transaction.

This follows the repository's explicit Remote style. It does not introduce a
generic command console, arbitrary patch, or runtime Review adapter registry.
The existing `reviewCenter` query becomes a closed discriminated union selected
by `reviewKind: 'suggested-change' | 'deliverable-acceptance'`; each target
keeps its own typed decision command.

## Domain values

### Deliverable plan

One immutable T11 plan contains:

- a bounded name and description;
- 1--20 ordered, non-empty Acceptance Criteria with Host-derived stable IDs;
- exactly one active Accountable;
- 0--20 distinct active Contributors excluding the Accountable;
- a Human Sponsor under the same T05 Agent/external-contact rule;
- one designated Acceptor who must be an active Human ProjectMember; and
- 1--50 distinct Feishu task GUIDs currently visible in the Project task
  projection.

T11 does not add plan editing. A later ticket may add a complete typed plan
replacement if a real workflow requires it; no caller-supplied JSON patch or
partial responsibility mutation is reserved now.

The designated Acceptor is a responsibility assignment, not proof of browser
identity. V1 still has one Owner login. `decideDeliverableAcceptance` records
the authenticated Owner as the actual actor and separately retains the
designated Acceptor snapshot. The UI must say that the Owner recorded the
decision and must never render it as the ProjectMember personally signing in.
T11 does not implement the separate evidence-backed External Attestation flow.

T11 does not impose an extra independence rule absent from Issue #12: the
Acceptor may also be the Accountable, Contributor, or Human Sponsor. Future AI
Reviewer policy remains advisory and cannot create formal acceptance.

### Declared artifact version

Each candidate is one closed value:

```ts
interface DeliverableArtifactVersionRef {
  readonly kind: 'declared-file-version'
  readonly source: 'managed' | 'local' | 'feishu'
  readonly resourceId: string
  readonly versionId: string
  readonly displayName: string
  readonly canonicalUrl: string | null
  readonly contentDigest: WorkbenchDigest | null
}
```

The Host validates bounded identifiers, labels, HTTPS links when present, and
the digest format when supplied. It derives a canonical `referenceDigest` from
the complete normalized value. A request contains 1--20 distinct references.
The tuple and digest are immutable; a new source version is a new reference,
never an update of the old row.

`contentDigest` is optional because T11 has no source reader able to compute it
for every source. Its absence is visible. `versionId` remains required, so a
mutable live-document link without an exact version identity is rejected.

### Formal date and execution tasks

The Deliverable binds exactly one non-recurring, non-exception event organized
by the Project's immutable Calendar binding. It supports the existing-event and
create-event paths. The complete `ProjectCalendarSchedule` remains the formal
date value; T11 does not secretly derive a single deadline instant from the
event's start or end.

One Calendar event may back exactly one local calendar commitment. Schema v10
introduces an internal closed `CalendarCommitment` seam with targets
`milestone | deliverable`, backfills every T10 Milestone, and enforces one
unique `(calendarId, eventId)` pair. Discovery, notification hints, and periodic
reconciliation consult this seam so a Deliverable and Milestone cannot bind the
same event and both converge from Feishu authority.

Task links store only stable task GUIDs. Reads join current T08 projections and
show `available | unavailable` plus the current Feishu-authoritative task value.
T11 never creates, modifies, completes, or copies the title/assignee/comment
authority of a Feishu task. Creating a Deliverable requires at least one visible
Project task, making the acceptance criterion's execution linkage observable.

## Acceptance state machine

The Deliverable lifecycle is `planned | in-review | accepted`. Each immutable
Acceptance Request has a persisted state
`pending | approved | rejected | needs_changes` and revision 1 or 2.

1. A planned Deliverable may open one request only when its event is confirmed
   and healthy, every responsibility member remains eligible, at least one task
   link remains visible, and 1--20 candidates pass validation.
2. The request freezes the Deliverable revision, plan, criteria, responsibility,
   event observation, task GUIDs, and complete candidate set.
3. At most one request is pending. A pending request appears in Review Center.
4. Calendar reconciliation that changes the bound authority tuple advances the
   Deliverable revision. The pending request then has effective status `stale`;
   it cannot be approved but may be rejected or returned as `needs_changes`.
5. Every decision includes bounded mandatory feedback and exactly one outcome
   for every Acceptance Criterion. Approval requires every outcome to be
   `met`; `needs_changes` requires at least one `not-met` outcome.
6. `rejected` and `needs_changes` close that immutable request and return the
   Deliverable to `planned`, allowing a later request with a new frozen
   candidate set. Only `approved` ends the Deliverable.
7. Approval atomically appends the decision, marks the request approved, marks
   the Deliverable accepted, and creates one Final Release whose versions are
   copied exactly from the request. The decision request has no field capable
   of replacing or adding a candidate.
8. Final Release and version rows are append-only and cannot be updated,
   deleted, reopened, or repointed in T11.

Member deactivation is blocked while a non-accepted Deliverable assigns that
member as Accountable, Contributor, Human Sponsor, or Acceptor. This preserves
the executable-object responsibility invariant. Since T11 has no plan-edit or
cancel command, the UI must make this limitation explicit; reassignment and
abandonment remain a later typed lifecycle extension.

## Authority, concurrency, and effects

Create carries exact Deliverables, Team, Task, and Project Schedule revisions.
Acceptance request and decision carry exact Deliverable and Acceptance Request
revisions. Every formal mutation retains caller-stable idempotency, causation,
closed reason, and a server-derived Owner actor.

The fixed order is:

1. validate the AbortSignal and authorize the operation;
2. strictly validate and normalize the closed request;
3. perform receipt-first replay before a provider read or write;
4. preflight Project, state, Team, Task, Calendar, and local revision fences;
5. for an existing event, GET and validate through the pinned route outside
   SQLite; for a new event, reserve and claim one durable effect first;
6. make at most one event-create attempt with the frozen provider idempotency
   key;
7. recheck all local CAS/event uniqueness inside one synchronous transaction;
8. atomically commit domain facts, redacted Outbox, hash-chained audit, and
   receipt; and
9. publish only detached whole-value projections after commit.

Transport ambiguity or restart-recovered inflight event creation is `unknown`
and is never blindly redelivered. Local acceptance commands have no external
provider effect but still use the T03 atomic command ledger.

Acceptance decisions require both `workbench.review.decide` and
`workbench.project.deliverable.accept`; both authorization results must resolve
to the identical Owner/organization/team scope before persistence begins.

## Review Center and Activity

Review Center uses a closed query union:

- omitted or `suggested-change` keeps the existing T06 status/risk filters and
  proposal builder;
- `deliverable-acceptance` uses its own persisted/effective status filter,
  returns only typed Deliverable Acceptance cards, and has no generic patch or
  risk field.

A Deliverable card includes the exact plan snapshot, criteria, designated
Acceptor, current and snapshotted due-event facts, current task projections,
candidate versions with declared resolution, prior decisions, allowed
decisions, and Final Release when present.

Generic audit/Activity records safe action, object, version, actor, reason,
causation, and summary codes only. Names, descriptions, criteria, member IDs,
task GUIDs, event IDs/links/dates, artifact IDs/versions/digests, criterion
outcomes, and feedback never enter generic audit, Activity, Outbox payloads,
receipts, logs, or diagnostics.

The authorized Project Deliverables projection separately exposes an
append-only `DeliverableActivityEntry` feed. Formal-command entries reference
an immutable plan/request/decision snapshot and its matching audit event ID;
automatic calendar observations reference their existing durable schedule-
change fact rather than inventing an Owner command. The Owner can therefore
replay creation, acceptance request, all decisions, calendar observations, and
the complete responsibility chain without weakening generic Activity privacy.

## Client and UI contract

The Project Deliverables surface uses a short default path:

- create a Deliverable with an all-day new-event form by default;
- place existing-event selection and timed scheduling in progressive
  disclosure;
- default Contributors to empty;
- require visible labels, fieldset/legend grouping, input formats, and textual
  errors for responsibility, criteria, tasks, dates, and version references;
- render each Deliverable as a compact article showing state, Accountable,
  Acceptor, authoritative date, task progress, and Final Release status;
- put long plan, candidate, and activity details behind native disclosure;
- submit the entire candidate set once, then focus the matching Review Center
  card; and
- show three explicit decision outcomes with mandatory feedback and per-
  criterion results.

The interaction follows W3C's guidance for native disclosures and accessible
forms: Enter/Space toggle the disclosure control, every control remains in the
normal Tab sequence, instructions precede or are associated with inputs, and
validation errors are described in text. See the W3C
[Disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/),
[Form instructions](https://www.w3.org/WAI/tutorials/forms/instructions/), and
[input validation](https://www.w3.org/WAI/tutorials/forms/validation/).

The controller retains the last safe projection while disconnected, fences
duplicate submission before React rerenders, and retains only the exact
ambiguous-transport replay envelope. It never retries a provider-unknown effect.
Project switch, logout, session expiry, Owner change, selection clearing, HMR,
and Fiber disposal clear protected drafts, discovery results, and candidate
references.

Automated UI evidence covers semantic structure, keyboard operation, focus,
textual state, long-token wrapping, 375px overflow, and responsive layout. The
container's missing CJK font remains `UI-MANUAL-01`; final manual acceptance
will repeat the zh-CN desktop and 375px glyph/visual-rhythm pass.

## Required behavioral evidence

- Schema v9 to v10 migration, T10 CalendarCommitment backfill, restart, and
  immutable-table trigger evidence.
- Existing/create event paths, cross-Milestone/Deliverable uniqueness, exact
  route pinning, event-create idempotency, ambiguity, and no blind redelivery.
- Calendar notification and periodic reconciliation convergence for both target
  kinds, including stale pending acceptance.
- Team/Sponsor/Acceptor and visible-task matrices; Project/Deliverables/Team/
  Task/Schedule CAS contention.
- Candidate validation/deduplication, one pending request, all three outcomes,
  per-criterion rules, new rounds after rejection/changes, and exact immutable
  Final Release copying.
- Receipt-first replay, rollback fault points, redacted audit/Activity/Outbox/
  receipts/logs, and authorized Deliverable Activity responsibility replay.
- Scenario cancellation and close drain, real SQLite contract, generated
  Remote faces, Loader/Profile and Client Fiber/HMR lifecycle.
- Localized component/controller coverage, browser create-to-approval-to-restart
  journey, built entries, and real packed archives without live Feishu or File
  credentials.

## Explicitly outside T11

- Deliverable plan edit/delete/cancel/rebind, deadline PATCH, recurring events,
  meetings, attendees, reminders, or Calendar administration.
- Feishu task creation/update/completion/date synchronization or new task scope.
- File discovery, upload, read, preview, edit, source permission verification,
  version resolution, publishing side effects, or revocation handling.
- Topic, Decision, Risk, Outcome, dependency, PlanBaseline, capacity,
  probability, health, or PMO policy links.
- AI Deliverable Reviewer execution, Mission artifacts, automated acceptance,
  batch acceptance, or a generic Review target registry.
- External Attestation, multiple Workbench users, Acceptor login, accepted
  Deliverable reopening, or Final Release replacement.
