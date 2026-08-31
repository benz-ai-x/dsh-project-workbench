# T12 Risk register primary-source research

## Status, scope, and source policy

This note is research input for GitHub Issue
[#13](https://github.com/benz-ai-x/dsh-project-workbench/issues/13), not the
frozen T12 implementation contract. Issue #13 requires a first-class Risk
register with an uncertain event, category, trigger, probability interval,
impact interval, confidence, Risk Owner, review date, deterministic exposure,
evidence/dependency/action links, governed status changes, and the explicit
rule that Risk closure does not complete linked tasks.

The parent [V1 spec](../specs/project-workbench-v1-spec.md) makes Workbench
authoritative for Risk governance and Feishu authoritative for task identity,
assignment, comments, and completion. It also says probability, impact,
trigger, owner, exposure, and treatment are separate from mitigation tasks.
The fuller [source design](../design/project-workbench-v1.md) adds assumptions,
dependencies, mitigation-task and contingency-task references, but its future
`RiskCandidate` and Risk Radar flow is outside Issue #13.

Only primary or first-party official material is used below:

- [HM Treasury, *The Orange Book: Management of Risk — Principles and
  Concepts*](https://www.gov.uk/government/publications/orange-book/the-orange-book-management-of-risk-principles-and-concepts),
  updated 29 July 2026;
- [NIST SP 800-30 Rev. 1, *Guide for Conducting Risk
  Assessments*](https://doi.org/10.6028/NIST.SP.800-30r1), including its
  [official PDF](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-30r1.pdf);
- [NASA NPR 8000.4C, *Agency Risk Management Procedural
  Requirements*](https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_8000_004C_&page_name=main);
- [NASA, *Technical Risk
  Management*](https://www.nasa.gov/reference/6-4-technical-risk-management/);
  and
- [UK Department for Education, *Academy trust risk
  management*](https://www.gov.uk/government/publications/managing-risk-in-an-academy-trust/academy-trust-risk-management),
  used only as an official worked example of a practical register.

NIST's detailed tables concern information-security risk, NASA's procedure
concerns NASA programs, and the DfE guide concerns academy trusts. Their
portable concepts are useful; none is authority for Project Workbench's exact
field names, thresholds, or lifecycle. Those choices are explicitly marked as
recommendations or open decisions.

## Direct source findings

### 1. A Risk is an uncertain event affecting an objective, not an action task

The Orange Book defines risk through uncertainty and objectives and recommends
expressing it through causes, potential events, and consequences. It warns
against recording only a consequence or merely negating the objective. Its
analysis then combines likelihood with consequence while also considering
confidence, sensitivity, time, volatility, connectivity, and existing
controls. See Annex 5, especially “Stating risks” and the following risk
analysis guidance in the [Orange
Book](https://www.gov.uk/government/publications/orange-book/the-orange-book-management-of-risk-principles-and-concepts).

NASA NPR 8000.4C gives a compatible project-risk statement structure:
condition, possible departure from a baseline, affected asset, and consequence;
it also calls for context, contributing factors, uncertainty, and the range of
possible consequences. The same procedure distinguishes a still-uncertain Risk
from a realized problem. See §3.4.2(c) and Appendix A of
[NPR 8000.4C, Chapter 3](https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_8000_004C_&page_name=Chapter3).

**Workbench inference:** Issue #13's `event` should remain the uncertain event. Mitigation
and contingency work are related actions, not a substitute description of the
Risk and not its status authority.

### 2. Ranges, confidence, and time are part of honest uncertainty

NIST requires a risk-assessment method to make the model, permitted factor
values, and functional combination explicit. It says this makes results more
repeatable and reproducible. NIST also notes that uncertainty can be
communicated with value ranges rather than point estimates and that every
assessment scale should make its temporal element explicit. See §2.3 and
§2.3.5 of [SP 800-30 Rev.
1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-30r1.pdf).

The Orange Book independently says analysis should consider confidence based
on available information and that confidence falls when information or the
underlying process is uncertain. It permits likelihood to be qualitative or
quantitative but requires consequence scales to differentiate meaningfully.

**Workbench inference:** probability and impact intervals are appropriate first-class
inputs. Confidence must describe the support for the assessment; it must not
be silently multiplied into likelihood or used to make exposure look safer.
An implementation must also define the period over which probability is being
assessed, even though Issue #13 does not name that field.

### 3. Exposure needs a declared, deterministic policy

NIST Appendix I supplies an explicit five-by-five example mapping likelihood
and impact to `very low | low | moderate | high | very high` risk. It describes
this table as tailorable, not universal. Appendix G likewise provides example
bounded likelihood scales. The key transferable rule is that the input scales
and combination table are declared before evaluating a Risk, rather than
accepting a caller's final label. See Tables G-2 through G-5 and I-2 in
[SP 800-30 Rev.
1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-30r1.pdf).

The DfE worked example also permits a one-to-five likelihood and impact grid,
but warns that naïve multiplication can rank low-probability/high-impact and
high-probability/low-impact items identically even when their governance needs
differ. See §§2.3–2.4 of [Academy trust risk
management](https://www.gov.uk/government/publications/managing-risk-in-an-academy-trust/academy-trust-risk-management).

**Workbench inference:** deterministic does not mean “multiply two unversioned numbers.”
Workbench needs a named policy version, closed input scales, a complete lookup
table or function, exhaustive boundary tests, and a Host-derived result.

### 4. Owner, trigger, review, and action responsibility are distinct

The DfE register example includes category, event/consequence description,
likelihood, impact, inherent and residual scores, controls, trigger,
contingency plan, Risk Owner, last-review date, current status, and retained
retirement date/rationale. It describes the Risk Owner as the identifiable
person responsible for deciding whether a trigger requires action and for
overseeing controls and contingency plans. See §2.5 of [Academy trust risk
management](https://www.gov.uk/government/publications/managing-risk-in-an-academy-trust/academy-trust-risk-management).

The current Orange Book says a treatment plan should record the chosen
option's rationale, proposed actions, the people accountable and responsible
for approval and implementation, resources and contingencies, indicators,
constraints, timing, and monitoring. It also calls for continuous monitoring
and risk reporting at a frequency appropriate to the Risk. See D8–D15 in the
[Orange
Book](https://www.gov.uk/government/publications/orange-book/the-orange-book-management-of-risk-principles-and-concepts).

NASA's technical-risk process similarly identifies thresholds that trigger
mitigation or contingency action, periodically monitors approaching
thresholds, and tracks the effectiveness of action-plan implementation. See
[NASA Technical Risk
Management](https://www.nasa.gov/reference/6-4-technical-risk-management/).

**Workbench inference:** one Risk Owner governs the Risk, while individual action tasks may
have other assignees and their own completion truth. A trigger is an observable
condition for review/action; it is not itself a status transition performed by
the browser.

### 5. Lifecycle decisions require rationale, tracking, and retained history

NASA NPR 8000.4C uses one current disposition at a time: accept, mitigate,
close, watch, research, or elevate. Acceptance records rationale, assumptions,
criteria, and a review interval. Mitigation records a plan, contingency
planning, and effectiveness measures. Closure records rationale and management
approval. Watch records triggers or decision points; research is tracked until
there is enough information for another disposition. See §3.4.2(i–q) in
[NPR 8000.4C, Chapter 3](https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_8000_004C_&page_name=Chapter3).

NASA's glossary says closure may mean the underlying condition no longer
exists, the Risk became a problem tracked as such, or likelihood/consequence
fell below a defined threshold. It defines mitigation as changing probability,
consequence, uncertainty, or timeframe, and watch as monitoring those factors
for material change. These are separate governed decisions, not deductions
from task checkboxes. See [NPR 8000.4C, Appendix
A](https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_8000_004C_&page_name=AppendixA).

The DfE worked register retains retirement date and rationale even after an
item leaves the live view. The Orange Book calls for monitoring before, during,
and after treatment and incorporating review results into reporting.

**Workbench inference:** T12 should retain append-only assessment and disposition history.
Closing needs a bounded reason plus rationale and must never delete the Risk.

### 6. Evidence, dependencies, and treatment actions should be linked facts

NIST says explicit models plus rationale for assessed factor values improve
repeatability. It also identifies incomplete knowledge and unrecognized
dependencies as sources of uncertainty. The Orange Book asks organizations to
surface limitations in evidence and to identify interdependencies or combined
events rather than evaluating every Risk in isolation. See §2.3 of
[SP 800-30 Rev.
1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-30r1.pdf)
and Annex 3 §12.4 of the [Orange
Book](https://www.gov.uk/government/publications/orange-book/the-orange-book-management-of-risk-principles-and-concepts).

NASA records mitigation/contingency plans and the parameters used to judge
their effectiveness separately from the Risk disposition. Its technical-risk
guidance treats action implementation and action-result monitoring as work
products related to, but not identical with, the Risk.

**Workbench inference:** evidence and dependency links should retain stable target identity
without copying source bodies. Mitigation and contingency links should state
the task's role while leaving task content, assignees, workflow, and completion
under Feishu authority.

### 7. Why Risk closure must not complete Feishu tasks

No external source dictates Workbench's Feishu behavior. The conclusion follows
from two direct premises:

1. Official risk procedures make closure its own reasoned governance decision
   and track mitigation/contingency action plans separately.
2. The Project Workbench parent spec assigns task completion authority to
   Feishu and expressly separates Risk treatment from action tasks.

**Workbench inference:** `closeProjectRisk` may commit only Workbench Risk
facts. It must issue no Feishu write, no task mutation reservation, and no
completion suggestion. Linked tasks remain exactly as T08 currently projects
them. A closure dialog may warn about incomplete or unavailable links, but any
task completion remains a separate explicit T08 command with its own remote
version, authority, receipt, and one-attempt effect.

## Compatibility with the current repository

The following are repository facts, not external-source claims:

- [PROJECT_CONTRACT.md](../agent/PROJECT_CONTRACT.md) makes the Host,
  `WorkbenchScenario`, authorization policy, T03 command ledger, and SQLite
  repository authoritative. T12 must not create a browser authority or custom
  Session event.
- [CONTEXT.md](../../CONTEXT.md) already distinguishes **Review Risk** from
  model confidence. T12 should name its value **Risk Exposure** in types and UI
  so it is not confused with T06's `SuggestedChangeRiskLevel`.
- T05 provides active/inactive ProjectMembers and the Accountable,
  Contributors, and Human Sponsor rule. The parent design applies that rule to
  Risk as an executable object.
- T06's `SuggestedChangeEvidenceRef` proves a narrow pattern for authorized,
  immutable, same-Project audit-event references. It is not a general evidence
  graph and should not be widened implicitly.
- T08's Project Tasks projection carries stable `taskGuid`, current visibility,
  Feishu-authoritative completion, opaque remote version, and canonical link.
  A Risk link can join this projection exactly as T11 Deliverables do.
- T10's `ProjectScheduleChange` is explicitly documented as the durable seam
  for later planning/risk consumers. It is a useful T12 evidence kind if the
  main contract deliberately admits it.
- T03 mutations already provide receipt-first replay, exact CAS, redacted
  Outbox/audit/Activity, and atomic SQLite commit. Risk commands should extend
  that ledger instead of adding a second audit stream.

## Recommended bounded T12 choices

Everything in this section is a Project Workbench recommendation or inference,
not a requirement copied from an external standard.

### A. One deep `Risks` Host module

Expose four explicit Scenario/Remote behaviors rather than a generic patch or
entity endpoint:

1. `projectRisks` — authorized, filtered, cursor-paginated Project workspace;
2. `createProjectRisk` — create one complete Risk and first assessment;
3. `reassessProjectRisk` — replace the complete current assessment and links
   under Risk, Team, task, and evidence revisions; and
4. `changeProjectRiskDisposition` — append one governed disposition decision,
   including closure.

The reassessment input should be a complete typed value, not JSON Patch. Every
mutation carries the existing idempotency key, causation ID, bounded reason,
expected Risk revision, and any aggregate revisions it relies on. The Host
derives actor/scope, IDs, time, exposure, history IDs, audit vocabulary, and
safe acknowledgements.

### B. Risk statement and category

Use a structured statement while retaining Issue #13's event as the principal
field:

```ts
interface ProjectRiskStatementV1 {
  readonly condition: string | null
  readonly event: string
  readonly consequence: string
}
```

Bound each non-null field to 1–2,000 safe Unicode code points, normalize line
endings and surrounding whitespace, and reject an empty event or consequence.
`condition` may be null because not every Owner can identify a cause at
creation time. Do not accept one opaque Risk blob that prevents the UI from
distinguishing event from consequence.

The recommended closed category vocabulary for the knowledge-work template is
exactly:

```text
schedule | dependency | scope | capacity | ownership | quality |
information | governance | external | other
```

Store the code, not localized display text, and do not add an arbitrary
category label beside `other`; the structured statement still explains the
Risk. Adding or changing category semantics later requires an explicit
vocabulary version or migration. This ten-code set is a Workbench choice, not
an Orange Book or NIST taxonomy.

Keep the observable trigger condition and its current Owner-confirmed state
together but separate from Risk disposition:

```ts
interface ProjectRiskTriggerV1 {
  readonly statement: string // 1..2,000 safe code points
  readonly state: 'unknown' | 'not-met' | 'met'
  readonly observedAt: string | null // Host time when `met` was recorded
}
```

`observedAt` is Host-derived and required only for `met`. T12 has no automatic
sensor; `state` is a formal Owner observation committed through the normal
command ledger. A met trigger may motivate a disposition decision but does not
silently make one.

### C. Probability, impact, confidence, and assessment horizon

Represent probability as integer basis points to avoid floating-point and JSON
canonicalization surprises:

```ts
interface ProbabilityIntervalV1 {
  readonly lowerBasisPoints: number // 0..10_000
  readonly upperBasisPoints: number // 1..10_000
}
```

Require `lower <= upper`; an upper bound of zero is not an active uncertain
event. Make `assessmentHorizonEnd` a required strict ISO date in the Project
timezone. The probability interval means “chance that this event occurs after
this Host-recorded assessment and on or before that date.” Require the horizon
to be today or later and `nextReviewOn <= assessmentHorizonEnd` for an active
Risk. `nextReviewOn` is governance cadence, not the probability horizon.

This required horizon is a Workbench inference from NIST's source requirement
that assessments make their temporal element explicit; neither Issue #13 nor
NIST prescribes this exact field name or date rule.

Represent impact as an ordinal interval, not fake money precision:

```ts
interface ImpactIntervalV1 {
  readonly lowerBand: 1 | 2 | 3 | 4 | 5
  readonly upperBand: 1 | 2 | 3 | 4 | 5
}
```

Require `lowerBand <= upperBand`. Freeze these Workbench-specific definitions:

1. `negligible` — reversible within existing work, with no committed
   Milestone, Deliverable, Outcome, or Goal breach;
2. `minor` — local rework or delay absorbed inside current buffers, without a
   material Outcome effect;
3. `moderate` — at least one Milestone, Deliverable, or dependency chain needs
   replanning, or an Outcome trajectory is threatened;
4. `major` — a primary Deliverable/Milestone or Outcome target is likely to be
   missed and needs explicit scope/capacity escalation; and
5. `severe` — the Primary Goal, a critical obligation, or safety/security/legal
   viability is threatened.

These meanings are product recommendations, not sourced standard labels.

Use `low | medium | high` assessment confidence with a 1–2,000-code-point
rationale and zero to twenty evidence references. Confidence is projected
beside exposure and is never an input that lowers exposure.

Use a strict ISO `nextReviewOn` date interpreted in the Project timezone.
Creation and every active reassessment require today or a future date; the Host
records `reviewedAt` separately. Closing preserves the last review date but
removes the item from overdue calculations.

### D. Versioned exposure policy

Use a closed three-level exposure vocabulary distinct from Review Risk:

```text
low | medium | high
```

Map the probability interval's upper bound to these exact Workbench bands:

| Band | Upper bound in basis points | UI meaning |
|---|---:|---|
| P1 | 1–500 | at most 5% |
| P2 | 501–2,000 | over 5%, at most 20% |
| P3 | 2,001–5,000 | over 20%, at most 50% |
| P4 | 5,001–8,000 | over 50%, at most 80% |
| P5 | 8,001–10,000 | over 80% |

Use the impact interval's upper band and this complete matrix. `L`, `M`, and
`H` mean `low`, `medium`, and `high`; colors are optional secondary UI cues.

| Likelihood \ Impact | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| P1 | L | L | L | M | H |
| P2 | L | L | M | M | H |
| P3 | L | M | M | H | H |
| P4 | M | M | H | H | H |
| P5 | M | H | H | H | H |

This table is a Project Workbench inference, not NIST Table I-2. It deliberately
preserves the DfE warning that rare catastrophic events should not disappear
inside a simple product score. NIST is the source for declaring closed scales
and a complete matrix; the thresholds and cells above are the recommended T12
tailoring.

Persist or recompute:

```ts
{
  policyVersion: 'project-risk-exposure-v1',
  likelihoodBand: 1 | 2 | 3 | 4 | 5,
  impactBand: 1 | 2 | 3 | 4 | 5,
  level: RiskExposureLevel
}
```

Using upper bounds is a conservative Project Workbench choice. The Host should
derive all four values and reject caller-supplied `level`, `likelihoodBand`, or
`policyVersion`. Tests must cover every cell, every numeric boundary,
monotonicity, and codec rejection of authority fields.

If the main contract rejects this recommendation, it must freeze a different
full Project-specific table and rationale before implementation. A raw score
with ad-hoc thresholds is not an acceptable fallback.

### E. Risk responsibility

Map the Issue's Risk Owner to T05's Accountable role and reuse the complete
responsibility invariant:

```ts
interface ProjectRiskResponsibilityV1 {
  readonly accountableMemberId: string // rendered as Risk Owner
  readonly contributorMemberIds: readonly string[] // 0..20, distinct
  readonly humanSponsorMemberId: string | null
}
```

All referenced members must be active and in the same Project; Contributors
exclude the Accountable; the existing Agent/external-contact Sponsor rule
applies. A current Risk role holder cannot be inactivated until a typed Risk
reassessment reassigns the role or the Risk is closed. Immutable history keeps
the original member IDs after later inactivation.

### F. Disposition and closure lifecycle

Keep lifecycle/disposition separate from assessment and task progress. The
closest bounded fit to the official source is:

```text
research | watch | mitigate | accept | closed
```

- creation selects one non-closed disposition;
- reassessment may preserve it or a separate disposition command may move
  among `research`, `watch`, `mitigate`, and `accept`;
- every move requires bounded rationale, exact Risk revision, and a future
  `nextReviewOn` while active;
- `closed` requires a mandatory closure rationale and one closed reason:
  `no-longer-exists | below-threshold | materialized-as-issue |
  superseded`;
- `closed` is terminal in T12; changed conditions create a new linked Risk
  rather than silently rewriting closed history.

`accept` means the Owner knowingly retains the Risk; it is still active and
reviewable. `closed` means it leaves the active register. If a Risk materializes,
T12 records `materialized-as-issue`; it does not invent Topic/Issue creation.

Each assessment and disposition is append-only. A small current head supplies
CAS and filter indexes. No status may be inferred solely from dates, exposure,
task completion, trigger text, or Client state.

### G. Evidence, dependency, and task links

Use closed reference unions and stable IDs. Do not copy source bodies into Risk
history or the generic ledger.

Evidence recommendation, zero to twenty distinct same-Project references:

```ts
type ProjectRiskEvidenceRefV1 =
  | { readonly kind: 'workbench-audit-event'; readonly auditEventId: string }
  | { readonly kind: 'project-schedule-change'; readonly changeId: string }
```

The schedule-change variant deliberately consumes T10's documented seam.
File, document, chat, meeting, AI-output, and web evidence remain unavailable
until their real source adapters and permission/version contracts exist.

For Issue #13's dependency field, start with zero to twenty same-Project Risk
references of kind `depends-on`. Reject self-links, duplicates, missing Risks,
cross-Project IDs, and cycles. Broader dependencies on Milestones,
Deliverables, Outcomes, or tasks require a separately frozen closed union; do
not reserve an arbitrary `{type,id}` pair.

Store mitigation and contingency task roles separately:

```ts
interface ProjectRiskTaskLinksV1 {
  readonly mitigationTaskGuids: readonly string[] // 0..50
  readonly contingencyTaskGuids: readonly string[] // 0..50
}
```

Require distinct GUIDs and no cross-role overlap. Each task must be currently
visible in T08 when linked. Later disappearance does not delete history: the
Risk projection joins `available | unavailable` plus current task truth, as
T11 already does. Risk commands never carry task title, assignee, status,
completion, or remote-version mutation intent.

### H. Filters and accessible UI

`projectRisks` should accept closed, conjunctive filters with a stable cursor:

- one or more exact exposure levels;
- one or more dispositions;
- exact Risk Owner member ID;
- trigger state (`not-met | met | unknown`) and, only if required, a bounded
  normalized text query;
- `nextReviewOn` range and an explicit overdue mode in the Project timezone;
  and
- bounded page size plus `beforeSequence` or another stable ordering key.

The Project Risks UI should keep structured state primary:

- show event, consequence, interval endpoints, confidence, exposure text,
  policy version/help, Owner, disposition, and next review without relying on
  red/amber/green color;
- disclose the matrix calculation so the Owner can understand why an exposure
  was assigned;
- distinguish confidence from exposure and Review Risk in copy and accessible
  labels;
- show mitigation and contingency tasks in separate labeled groups with
  current Feishu completion and availability;
- warn, but do not block or mutate tasks, when closing with incomplete or
  unavailable task links;
- make filters native-label, keyboard, screen-reader, and 375px no-overflow
  usable; and
- follow the existing Client states and cleanup rules for loading, ready,
  pending, stale/disconnected, conflict, exact retry, Project switch, logout,
  expiry, Owner change, HMR, and Fiber disposal.

The existing `UI-MANUAL-01` CJK-font visual check remains deferred. Automated
functional, accessibility, keyboard, overflow, and responsive coverage is not
deferred.

### I. Authority, privacy, and ledger behavior

- Authorize before repository access and derive Project/organization/team
  scope from the principal.
- Reuse receipt-first replay and exact Risk/Team/task/evidence CAS; no external
  provider call is needed for a Risk-only mutation.
- Commit the Risk head/history, references, one redacted Outbox fact, one
  hash-chained audit fact, and one immutable receipt in the same synchronous
  transaction. Publish observers only after commit.
- Keep statement text, condition/consequence, confidence rationale, member
  IDs, task GUIDs, evidence/dependency IDs, review dates, probability/impact,
  and closure rationale out of generic audit, Activity, Outbox payloads,
  receipts, diagnostics, and logs. The separately authorized Risk projection
  may return detached full business values.
- A safe receipt should contain only Risk ID, Risk revision, disposition,
  correlation IDs, and possibly the Host-derived exposure code if the privacy
  contract explicitly allows it.
- Close/reassess commands perform zero Feishu writes. Task mutation tests must
  assert both unchanged local projections and zero adapter calls/effect rows.
- Use Workbench-owned SQLite tables and migrations; do not add a custom Session
  event to the pinned Harness.

### J. Minimum evidence for the eventual implementation

The frozen T12 contract should require at least:

- Schema v10→v11 migration, empty/backfilled restart, immutable-history
  triggers, and filter indexes;
- exhaustive interval validation, every exposure-matrix cell and boundary,
  monotonicity, and confidence independence;
- statement/category/trigger/date bounds and Project-timezone overdue behavior;
- same-Project active-member responsibility rules, Sponsor rules,
  reassignment, member-in-use protection, and historical inactivation;
- valid/missing/cross-Project evidence and dependencies, duplicate/self/cycle
  rejection, and schedule-change evidence;
- visible task linking, disappearance/reappearance, role separation, and
  Feishu-authoritative completion;
- every legal/illegal disposition transition, mandatory rationale, terminal
  closure, and retained history;
- a closure proof that no linked task, provider adapter, task effect, or task
  receipt changes;
- receipt-first replay, changed-intent rejection, rollback fault points,
  redaction, cancellation, observer isolation, and disposal drain;
- generated Typert faces, Scenario/SQLite/Remote, real Loader/Profile,
  localized controller/component/Slot lifecycle, built entries, and real
  packed archives; and
- an authenticated Chromium journey that creates, filters, reassesses, closes,
  verifies tasks stayed unchanged, and observes the same Risk after full Host
  restart with the same database.

## Open decisions for the main agent

These must be resolved in the T12 contract before implementation:

1. **Probability horizon:** the recommendation is a required
   `assessmentHorizonEnd` with `nextReviewOn <= assessmentHorizonEnd`. The main
   contract must accept it or define another explicit time window; it must not
   leave probability temporally unqualified.
2. **Exposure policy:** the recommendation is the exact three-level 5×5 table
   and basis-point thresholds above. If changed, record every replacement
   threshold/cell, upper- vs lower-bound treatment, and policy version.
3. **Impact semantics:** accept the five Workbench definitions above and decide
   whether one highest credible consequence or multiple dimensions determine
   the submitted interval.
4. **Category vocabulary:** accept the recommended ten-code closed set above
   or freeze a different versioned project taxonomy; arbitrary category text
   is not recommended.
5. **Risk Owner shape:** use the full T05 responsibility tuple as recommended,
   or justify why T12 admits only one member ID despite the parent design's
   executable-object rule.
6. **Disposition vocabulary:** accept `research | watch | mitigate | accept |
   closed`, decide whether `materialized` deserves a live status rather than a
   closure reason, and decide whether closed Risks are terminal.
7. **Trigger filtering:** choose structured trigger state, normalized text
   search, or both; define how trigger state changes are confirmed without
   pretending to have an automated sensor.
8. **Dependency targets:** restrict T12 to Risk→Risk as recommended or admit a
   closed union of Milestone/Deliverable/Outcome references; state cycle rules.
9. **Evidence kinds:** confirm whether T10 schedule changes join T06 audit
   events in T12 or keep audit-event-only evidence. Do not imply File evidence.
10. **Task-link closure UX:** warning only is recommended. If an acknowledgement
    is required for incomplete tasks, make it a Risk-decision field that still
    performs no task write.
11. **Risk-specific Activity:** decide whether Issue #13 needs a separately
    authorized Risk history projection or whether complete history lives only
    inside `projectRisks`; generic Activity must remain redacted either way.
12. **Deferred surfaces:** explicitly keep AI `RiskCandidate`, Risk Radar,
    automatic trigger evaluation, task creation/status writes, File/document
    evidence, comments, and Topic/Issue conversion outside T12 unless the
    ticket is expanded deliberately.

## Research conclusion

The primary sources support a narrow, defensible T12: one Workbench-owned Risk
record with structured uncertain-event semantics, ranged assessments and
confidence, a versioned deterministic exposure policy, an identifiable Risk
Owner, explicit review cadence, linked evidence/dependencies/actions, and
append-only disposition decisions. They also support the project's crucial
authority boundary: Risk governance and Feishu task execution have related but
independent lifecycles. Closing a Risk records a reasoned Workbench decision;
it cannot be a hidden task-completion command.
