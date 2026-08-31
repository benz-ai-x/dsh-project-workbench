# T12 Risk register and treatment-link contract

## Scope and source policy

This note freezes the product and implementation contract for GitHub Issue
[#13](https://github.com/benz-ai-x/dsh-project-workbench/issues/13). T12 adds
one first-class Workbench-owned Risk register. It reuses T03 command/audit
authority, T05 ProjectMember responsibility, T08 Feishu task projections, T10
schedule-change facts, and T11 Deliverable identities. It does not add a new
provider route or external write.

The normative product sources are the parent V1 specification and design. The
official risk-management sources, their directly supported claims, and the
Project Workbench policy choices derived from them are recorded separately in
`docs/research/t12-risk-register-sources.md`. Those sources inform the model;
the exact category vocabulary, interval boundaries, exposure matrix, and
lifecycle below are versioned Project Workbench policy rather than a claim that
one external publication mandates these exact values.

## Module and interface

`Risks` is one deep Host module behind four explicit Scenario/Remote behaviors:

1. `projectRisks` reads one authorized, filtered Project Risk page plus bounded
   Risk Activity, the safe options needed by the form, and—when
   `selectedRiskId` is present—a separately bounded page of that Risk's
   complete immutable assessment/transition history.
2. `createProjectRisk` creates the initial immutable assessment in `research`
   disposition.
3. `reviseProjectRisk` replaces the complete assessment with a new immutable
   version; it is not a JSON Patch or partial merge.
4. `transitionProjectRisk` applies one allowed, reasoned status transition and
   never edits assessment content or a linked Feishu task.

The module owns normalization, exposure calculation, lifecycle policy, link
validation, cycle detection, and projection detachment. Scenario owns request
validation, authorization, cancellation, IDs, and orchestration. Repository
owns atomic persistence and transaction-local rechecks. Client owns drafts and
presentation only; neither caller nor model can supply exposure, actor, scope,
generated identity, timestamps, or audit vocabulary.

## Risk assessment value

Every assessment version is one complete immutable value containing:

- a structured statement with optional condition, required uncertain event,
  and required consequence;
- one `project-risk-category-v1` code: `schedule`, `dependency`, `scope`,
  `capacity`, `ownership`, `quality`, `information`, `governance`, `external`,
  or `other`;
- a bounded observable trigger statement and Owner-confirmed
  `unknown | not-met | met` state. The Host starts a met episode at its clock
  for create-met, non-met→met, or a changed statement that remains met; it
  preserves `observedAt` only for the same normalized statement staying met
  and clears it whenever state leaves met;
- a probability interval in integer basis points, from 0 through 10,000,
  with `lowerBasisPoints <= upperBasisPoints` and an upper bound greater than
  zero;
- an impact interval on `project-risk-impact-v1`, with integer endpoints from
  1 through 5 and `lowerBand <= upperBand`;
- independent evidence confidence `low | medium | high` plus bounded rationale;
- a strict Gregorian date-only `assessmentHorizonEnd` (`YYYY-MM-DD`) defining
  the probability time box;
- a strict date-only `nextReviewOn` no later than that horizon; and
- a Host-clock offset-bearing `assessedAt` instant interpreted against the
  Project's IANA timezone for date policy;
- zero to twenty bounded assumptions;
- the complete responsibility and link sets described below; and
- Host-derived assessment identity, sequence, digest, exposure, and time.

The impact meanings are frozen: I1 is reversible inside existing work with no
committed-object breach; I2 is local rework/delay absorbed inside current
buffers; I3 requires replanning a Milestone, Deliverable, or dependency chain
or threatens an Outcome trajectory; I4 threatens a primary commitment or
Outcome and requires scope/capacity escalation; I5 threatens the Primary Goal,
a critical obligation, or project viability.

An assessment is always replaced as a complete semantic value. Ordered text
and links are normalized, set-like member/task/dependency/evidence identities
are canonicalized, and the digest covers the complete normalized assessment
plus Host-derived exposure policy/result. A revision creates a new version and
never rewrites or deletes an earlier version.

## Deterministic exposure policy

`project-risk-exposure-v1` is a closed 5×5 lookup policy. The probability
interval's upper endpoint maps to P1 for 1–500 basis points, P2 for 501–2,000,
P3 for 2,001–5,000, P4 for 5,001–8,000, and P5 for 8,001–10,000. The impact
interval's upper endpoint supplies I1–I5. The complete table is:

| Likelihood \\ Impact | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| P1 | low | low | low | medium | high |
| P2 | low | low | medium | medium | high |
| P3 | low | medium | medium | high | high |
| P4 | medium | medium | high | high | high |
| P5 | medium | high | high | high | high |

The projection retains policy version, Host-derived likelihood band, impact
band, and `low | medium | high` level. Using the upper endpoints is deliberate:
a wide interval cannot hide its plausible high-exposure edge, and a rare
catastrophic impact does not disappear inside naïve multiplication. Confidence
describes evidence quality and never raises or lowers exposure. A future matrix
change requires a new policy version and new assessment version; historical
exposure is never recomputed in place. A public request containing `exposure`,
`level`, `likelihoodBand`, `impactBand`, or policy fields fails closed as an
unknown field.

## Responsibility

The Risk Owner is the assessment's unique `accountableMemberId`, using the
same executable-object rule as the parent design:

- exactly one active Accountable, surfaced in UI as Risk Owner;
- zero to twenty distinct active Contributors excluding the Accountable; and
- a Human Sponsor when the Accountable is an Agent or external-contact Human.

Risk Owner filters therefore match the current Accountable identity. Historical
versions retain immutable member snapshots. A member used by any current
non-closed Risk version cannot be deactivated. Closing a Risk releases the
current responsibility-use fence but preserves every historical member ID and
snapshot.

## Evidence, dependencies, and Feishu task links

### Evidence

T12 admits only immutable, authorized, same-Project facts already owned by the
Workbench database:

- `workbench-audit-event` by audit-event ID; and
- `project-schedule-change` by schedule-change ID.

The Host resolves every reference inside the fixed Owner scope, rejects a
missing or cross-Project fact, and stores the stable typed identity rather than
copying evidence text into Risk, audit, Outbox, or receipts. The authorized
Risk projection may show a bounded safe source summary. T13+ File evidence is
not invented early.

### Dependencies

One assessment may contain up to twenty distinct `depends-on` references to an
existing same-Project Risk stable identity. A Risk cannot depend on itself. The
Host evaluates the current graph in the same transaction as creation or
revision and rejects any direct or transitive cycle. Milestone, Deliverable,
Outcome, task-network, and arbitrary `{type,id}` dependencies stay outside T12
so this link cannot preempt T15 PlanBaseline semantics. A later assessment or
closure of the target Risk does not erase the retained link.

### Treatment tasks

Mitigation and contingency are two disjoint sets of zero to fifty stable
Feishu task GUIDs, with no GUID present in both sets. Creation and revision
accept only tasks currently visible in the Project's T08 projection and carry
the observed Project task revision. Reads join each GUID to current
`available | unavailable` task truth; titles, assignees, completion, comments,
and remote versions remain Feishu-owned.

T12 never creates, patches, completes, reopens, assigns, comments on, or copies
authority from a Feishu task. Entering `mitigate`, and every assessment revision
that leaves status at `mitigate`, requires at least one currently available
mitigation task. A provider-side disappearance later only makes the retained
link unavailable; it never infers a Risk transition. Task completion never
changes Risk status, and moving a Risk to `closed` never changes any linked
task. An unavailable retained link stays visible and must be removed or
replaced in a later complete assessment revision.

## Lifecycle and history

The public `status` is the current risk-management disposition. Its closed
vocabulary is `research`, `watch`, `mitigate`, `accept`, or `closed`:

- every Risk starts as `research`;
- any active status may move to any different active status after current
  policy revalidation;
- any active disposition may move to `closed`;
- `closed` is terminal in T12; and
- a no-op transition is rejected.

`accept` means the Owner consciously retains the exposure while it remains
reviewable; it does not mean closed, approved work, or completed tasks. Every
transition requires a bounded non-empty rationale in authorized Risk history,
plus the closed command reason `owner-project-risk-transition`. Closing also
requires exactly one closure reason: `no-longer-exists`, `below-threshold`,
`materialized-as-issue`, or `superseded`. This records
`materialized-as-issue` but does not create a Topic. Creation and revision use
their own closed reasons. No transition is inferred from exposure, review date,
trigger state, evidence, task state, or AI output.

Terminal means more than “no outgoing status edge”: after closure, every new
revision or transition intent is rejected without advancing Risk/aggregate
revision or appending history. Receipt-first replay of the exact command that
already committed remains valid. Changed conditions require a new linked Risk;
T12 provides no reopen or mutation of closed history.

For active create/revision, both date-only values must be on or after the Host
clock's current calendar date in the Project timezone, and
`nextReviewOn <= assessmentHorizonEnd`. An active-to-active transition also
requires the retained `nextReviewOn` not to be overdue; the Owner must first
commit a complete reassessment. Closing is allowed when review is overdue and
retains the final dates. Date comparison never uses the browser timezone.

Creation, every assessment revision, and every status transition advance both
the Project Risk aggregate revision and the individual Risk revision. A
revision also advances assessment-version sequence. Append-only Risk Activity
records action, Risk revision, immutable assessment/transition identity,
matching audit-event ID, actor, safe status codes, causation, and time. The
authorized activity page may include transition rationale; generic Activity
does not.

## Query and filtering

`projectRisks` uses stable descending Risk sequence pagination and supports the
five required independent filters:

- exact derived exposure level;
- exact current status/disposition;
- exact current Risk Owner member ID;
- exact trigger state and/or normalized trigger substring; and
- inclusive review-date from/to bounds.

The trigger search value is Host-normalized with Unicode NFKC, trimming, and
case folding before SQLite comparison. Empty search is treated as omitted;
inverted date bounds fail validation. Pagination cursors and limits are
bounded, and filter fields form a closed request. Risk Activity has an
independent descending sequence cursor so filtering the register cannot hide or
reorder audit history.

The projection also returns detached current Risk values, member choices, task
choices, same-Project dependency choices, and bounded eligible evidence
choices. Inactive historical Risk Owners remain displayable/filterable but are
not selectable for a new assessment.

An optional `selectedRiskId` asks the same read for a selected detail. That
detail uses its own `beforeHistorySequence`/`historyLimit` cursor and returns a
closed chronological-entry union: assessment entries carry the complete
immutable assessment and link snapshots; transition entries carry exact
from/to status, closure reason, rationale, actor/source, and time. A missing or
cross-Project selection is a closed not-found result, never an unscoped lookup.
The filtered register, global Risk Activity, and selected history have
independent cursors so one cannot truncate or reorder another.

## Authority, concurrency, privacy, and disposal

Reads require both `workbench.project.risk.read` and
`workbench.project.risk.activity.read` because the one projection contains
private Risk history. Both authorizations complete before any repository read
and must resolve to the identical Owner/organization/team scope. All three
commands require `workbench.project.risk.write`. Scope is always derived from
the authenticated Owner. Create and revise carry exact Risk aggregate, Team,
and Task revisions; revise and transition additionally carry the exact Risk
revision. Receipt lookup precedes CAS validation, and replay compares the
complete normalized intent.

For each command, domain row(s), aggregate head, append-only Risk Activity,
one redacted pending Outbox intent, one hash-chained generic audit event, and
one immutable receipt commit in the same synchronous `BEGIN IMMEDIATE`
transaction. Repository code rechecks Project scope, revisions, responsibility,
tasks, evidence, dependencies, lifecycle, and cycle policy before writing. No
provider call, callback, `await`, observer, or log occurs in the transaction.

Generic audit, Activity, Outbox payloads, receipts, logs, diagnostics, and
domain-conflict messages never contain statement fields, trigger,
probability, impact, confidence/rationale, horizon/review dates, assumptions, transition
rationale, member IDs, evidence IDs, dependency IDs, task GUIDs, task text, or
raw request/error content. They contain only allowlisted action/object/status
codes, revisions, generated command/audit/outbox identities, actor/scope,
causation, time, and safe summary codes. Full values appear only in the
separately authorized Risk projection.

Cancellation is checked before authorization, after every awaited boundary,
and before repository admission. Closing Scenario admission waits for accepted
Risk work, drains it, then closes persistence. Client selection clearing,
Project switch, logout, expiry, Owner change, connection generation loss, HMR,
and Fiber disposal abort in-flight reads/commands and erase protected drafts;
same-Owner reconnect may keep the last safe projection and exact ambiguous
retry envelope.

## Persistence and migration

Schema v10→v11 adds a Project Risk aggregate head, stable Risk heads,
append-only assessment versions and normalized current-version link rows,
append-only status transitions, and append-only Risk Activity. Current heads
may advance their revision/status/version pointer only; immutable content,
history, audit provenance, and link rows cannot be updated or deleted. Indexes
support Project/sequence pagination and all five filters. Migration creates an
empty Risk aggregate for every existing Project without changing prior facts.
After v11, the existing T04 Project creation transaction must insert that new
Project's revision-zero Risk head atomically with its other aggregate heads;
reads never lazily initialize missing state.

Startup validates every new table, foreign key, trigger, and index. Migration,
restart, receipt replay, fault rollback, and immutable-trigger behavior must be
proven against a real SQLite file. The generated Typert client is the only
browser Remote contract; no handwritten wire shape or custom Session event is
added.

## Client and UI contract

The Project Risks surface uses a compact register-first path:

- one textual summary and five labeled filters above the list;
- compact Risk articles showing event/consequence, textual exposure/status,
  Risk Owner, trigger, review date, confidence, and treatment-task availability;
- a short core create/revise form for statement, category, trigger/state,
  intervals, confidence/rationale, horizon, review date, and Risk Owner;
- native disclosure for Contributors/Sponsor, assumptions, evidence,
  dependencies, and mitigation/contingency task links;
- a separate, labeled status-transition form with required rationale; and
- a selected-Risk native disclosure that pages complete assessment/status
  history and its historical source/link snapshots.

Exposure is never color-only: level, matrix bands, intervals, confidence, and
policy version have localized text. Inputs have visible labels, fieldsets and
legends, formats, instructions, and textual validation/conflict feedback.
Keyboard order follows the document, native controls work with Enter/Space,
post-commit focus moves to the changed Risk, long IDs wrap, and the page has no
horizontal viewport overflow at 375px.

The React-free controller fences duplicate submissions before rerender,
preserves safe drafts across recoverable conflicts, retains only an exact
ambiguous-transport replay envelope, and never silently rebases or automatically
replays a command. Automated component/browser evidence remains required.
Container-dependent CJK glyph and visual-rhythm inspection stays in
`UI-MANUAL-01` for the user's final all-development manual pass.

## Required behavioral evidence

- Every probability/impact boundary and all 25 matrix cells, upper-endpoint
  classification, confidence independence, policy version retention, and
  caller-supplied exposure rejection.
- Complete structured-statement and trigger validation, category/status closed
  vocabularies, timezone date boundaries/DST, trigger met-episode clock rules,
  digest stability, full-replacement revisions, all
  allowed/forbidden transitions, terminal close, and mitigation prerequisite.
- Team/Sponsor/member-in-use matrices; Risk aggregate/Risk/Team/Task CAS;
  response-loss replay; duplicate-key mismatch; cancellation and close drain.
- Same/cross-Project evidence checks, missing dependencies, Risk self/cycle
  rejection, task-set overlap/availability, and proof that revise/every
  transition makes zero task-adapter calls, T08 effect/receipt/task-Outbox rows,
  or projection changes.
- Privacy-redacted audit/Activity/Outbox/receipt/log/conflict evidence plus
  separately authorized complete Risk Activity.
- Schema v10→v11 migration/restart, empty-head backfill, filters/indexes,
  immutable triggers, transaction fault rollback, and detached projections.
- Four generated Remote faces, dual Risk-read authorization and identical-scope
  checks, selected-history pagination/detachment, real Loader/Profile lifecycle,
  localized controller/component/Slot/HMR coverage, and a real-browser create,
  filter, revise, transition, close, and same-database restart journey.
- Built Host/Client/bundle entries and real packed archives verified without
  live Feishu credentials or provider mutation.

## Explicitly outside T12

- AI `RiskCandidate`, Risk Analyst execution, Risk Radar, automatic risk
  creation, model-selected severity, and schedule/task-to-Risk inference.
- Topic, Decision, Goal, Outcome, Mission, File, comment, notification,
  PlanBaseline, capacity, Monte Carlo, or generic dependency-graph behavior.
- Feishu task creation/update/completion/reopen/assignment/comment/date writes,
  a second task source, or task-state-driven Risk transitions.
- Custom category/matrix/status configuration, Risk delete/reopen/merge,
  recurring reviews, automatic escalation, bulk mutation, or generic object
  registry/patch APIs.
- Manual CJK glyph judgment in this container; that remains the final
  `UI-MANUAL-01` acceptance item after all implementation tickets.
