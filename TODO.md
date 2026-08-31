# TODO

## T01 — Walking Skeleton (#2)

- [x] Pin the audited DeepSeek Harness baseline and define the shared Codex/Claude contract.
- [x] Build the Host Service, generated Typert Remote, SQLite repository, and `WorkbenchScenario` seam.
- [x] Build the Client model and accessible Workbench status page.
- [x] Compose Host and Client through a dedicated Bundle and test Profile.
- [x] Prove command → durable commit → Host projection → browser rendering → restart recovery.
- [x] Prove invalid Loader configuration fails before publication.
- [x] Prove Host/Client HMR disposal removes Remote/Slot resources and closes SQLite after draining work.
- [x] Verify built entries and real packed archives; record any source-linked publication limitation.

## T02 — Owner initialization, login, and authorization gate (#3)

- [x] Persist exactly one versioned Owner credential record through DSH Credentials; never put a password, recovery code, or session token in the business database.
- [x] Hash the Owner password with Argon2id and issue a high-entropy recovery code exactly once at initialization.
- [x] Establish bounded, revocable server-side sessions through a `Secure; HttpOnly; SameSite=Strict; Path=/` cookie.
- [x] Route every Workbench Remote command/query through the same Owner authorization context; direct in-process calls without a principal must fail closed.
- [x] Protect both the browser projection and its generated `/api/workbench/*` Remote carrier behind the Owner session gate.
- [x] Provide a local, secret-safe recovery CLI that consumes the prior code, resets the password, invalidates every session, and prints one replacement code once.
- [x] Prove setup races, password verification, cookie attributes, immediate logout, unauthenticated denial, recovery replay denial, HMR/disposal, restart, packed CLI, and real-browser behavior.

## T03 — Traceable command, Outbox, and Activity (#4)

- [x] Commit status state, one pending Outbox intent, append-only audit, hash head, and replay receipt in one SQLite transaction.
- [x] Prove rollback leaves no partial artifacts and same-key/same-intent replay creates no duplicate effect; reject changed intent under the same key.
- [x] Verify the versioned RFC 8785/SHA-256 audit chain and record server-derived actor, bounded reason, object version, and causation ID.
- [x] Expose authorized Activity filtering by Project scope, object, and action without copying status text or sensitive request/adapter values into audit/log projections.
- [x] Make pending, delivered, unknown, and failed Outbox truths observable, with ambiguous delivery remaining unknown.
- [x] Prove Scenario, Loader/Profile, generated Remote, Client lifecycle, HMR, packed artifacts, restart, and real-browser behavior for the T03 surface.

## T04 — Create Goal and Project from the Knowledge Work Template (#5)

- [x] Publish one immutable, digest-verified Knowledge Work Template Version with a closed runtime schema.
- [x] Atomically create one Project, its Primary Goal, one or more measurable Outcomes, and optional Supporting Goal links through the T03 command ledger.
- [x] Preserve exact Template Version provenance and an independent, immutable Project Template Snapshot that survives later template versions and restart.
- [x] Enforce Owner authorization, catalog and Supporting Goal optimistic concurrency, caller-stable replay, and redacted Project-scoped audit/Outbox facts.
- [x] Let the authenticated browser create, list, reopen, and accessibly inspect the Project, Goal, Outcomes, Supporting Goals, and Template Version without becoming an authority.
- [x] Prove migration, rollback, replay, contention, Scenario/Remote, Loader/Profile, Client HMR/drain, built/packed artifacts, restart, and real-browser behavior for T04.

## T05 — Unified ProjectMember roster and responsibility (#6)

- [x] Add a Project-scoped, non-login ProjectMember roster with closed Feishu-human, external-human, and Agent identities.
- [x] Record app-scoped Feishu identity as declared metadata, derive formal-assignee eligibility, and perform no Feishu verification or write.
- [x] Atomically replace one Project Responsibility with exactly one Accountable, distinct Contributors, and the required active Human Sponsor.
- [x] Preserve stable member identity and append-only responsibility history; block current role holders from deactivation until responsibility is reassigned.
- [x] Extend the authorized command ledger with PII-free member/status/responsibility acknowledgements, CAS, replay, Outbox, audit, and Activity.
- [x] Let the authenticated browser manage the roster and responsibility accessibly, retain drafts across safe retries, and reopen the Team after HMR/restart.
- [x] Prove Schema v3→v4 migration, rollback, replay, contention, Remote/Loader, packed artifacts, redaction, and real-browser behavior for T05.

## T06 — Review Center and SuggestedChange (#7)

- [x] Add one immutable SuggestedChange envelope, CAS head, append-only decision history, and authorized Project-scoped Review Center projection.
- [x] Propose a complete Project Responsibility candidate against an exact Team revision with 1–20 same-Project audit-event EvidenceRefs; derive source, typed diff, digest, and risk on the Host.
- [x] Filter pending, deferred, stale, accepted, and rejected items plus low/high risk using bounded stable pagination; derive stale from current Host truth.
- [x] Accept, edit-and-accept, reject, or defer with mandatory feedback, exact SuggestedChange CAS, immutable target base, receipt-first replay, and closed conflicts.
- [x] Reuse the normal Responsibility invariant planner and atomically commit accepted target state, review history, Outbox, audit, and receipt without nested transactions or duplicate ledger facts.
- [x] Keep candidate/diff/evidence/feedback out of Activity, Outbox payloads, receipts, diagnostics, and logs while returning complete authorized Review cards.
- [x] Build an accessible Review Center with one-round-trip proposal context, textual risk/status, semantic before/after diff, evidence choices, high-risk confirmation, safe retry, reconnect, and draft cleanup.
- [x] Prove Schema v4→v5 migration, five-state filtering, low/high policy, double-CAS/stale races, edit history, rollback/replay/redaction, Loader/Profile, generated fourteen-method Remote, packed artifacts, restart, and real-browser behavior.

## T07 — Feishu Bot/User dual-identity Connection Center (#8)

- [x] Model one workspace Feishu Connection with independent append-only Bot/User route generations and immutable first-verified actor bindings.
- [x] Store only DSH credential references and live presence metadata; resolve the exact App Secret/User token once per verification without caching or browser/business-database exposure.
- [x] Verify Bot and User through their distinct self-identity paths and optionally probe one Task list with the same actor, never an automatic fallback.
- [x] Preserve missing application scope, missing User grant, and concrete resource ACL denial as different safe issues and recovery guidance.
- [x] Commit configure/reset/disable/verification facts through the T03 CAS, replay, Outbox, audit, receipt, and privacy invariants.
- [x] Build an accessible localized Connection Center with independent drafts, exact ambiguous-response retry, reconnect retention, and logout/expiry/Fiber cleanup.
- [x] Complete the final Schema v5→v6 migration, scenario, Loader/Profile, generated seventeen-method Remote, packed artifact, restart, and browser verification evidence.

## T08 — Bind one primary Feishu Task List and project tasks (#9)

- [x] Bind exactly one existing or newly created primary Task List to a Project through one explicitly selected, verified Bot/User route generation.
- [x] Project bounded Feishu tasks, recursive subtasks, assignees, followers, comments, completion, opaque remote versions, and canonical URLs without exposing provider payloads.
- [x] Apply trusted normalized events through an append-only idempotent Inbox and reject duplicate or out-of-order versions.
- [x] Repair missed events with a bounded periodic full reconciliation that preserves explicit outside-list references and stops cleanly on disposal.
- [x] Reserve and claim versioned task updates durably before one provider PATCH; settle delivered/conflict/failed/unknown and never blindly retry ambiguity.
- [x] Keep outside-list tasks invisible until an explicit Owner reference command commits through the audit/Outbox/receipt ledger.
- [x] Build an accessible localized Project Tasks browser surface with exact identity discovery, hierarchy, roles, comments, canonical links, reconciliation, reference, edit, unknown, reconnect, and cleanup states.
- [x] Complete Schema v6→v7 migration, production adapter fixtures, Scenario/SQLite/controller/component/lifecycle coverage, generated twenty-three-method Typert artifacts, and built/packed verification.

## T09 — Map template workflow to a Feishu custom field (#10)

- [x] Define a bounded multi-state workflow with stable logical IDs, initial state, allowed transitions, and terminal states.
- [x] Create or map one Feishu single-select field on the Project's primary task list and persist stable field/option GUIDs.
- [x] Preview create/existing/migrate compatibility and block missing, hidden, duplicate, unmapped, or in-use destructive changes before provider mutation.
- [x] Converge both Workbench-originated and Feishu-originated state changes to Feishu-authoritative custom-field values under Project, task, remote-version, and workflow CAS.
- [x] Derive a terminal-state completion suggestion without automatically completing the Feishu task.
- [x] Build the localized accessible Client workflow editor, allowed-transition selector, explicit completion confirmation, exact retry, stale/conflict handling, and Project/logout/HMR draft cleanup.
- [x] Reserve/claim/settle custom-field writes durably so response loss becomes audited unknown and the same command is never blindly redelivered.
- [x] Prove Schema v7→v8 restart, exact Task v2 field/value requests, stable create/map/migrate GUIDs, compatibility conflicts, transition matrices, reconciliation, replay/unknown recovery, Client lifecycle, generated Remote, and packed artifacts.

## T10 — Bind a Project calendar and manage Milestones (#11)

- [x] Bind exactly one existing or newly created writable Feishu Calendar v4 resource to a Project through one explicitly selected verified Bot/User route.
- [x] Model Workbench-owned Milestone semantics with one stable non-recurring Feishu event binding, authoritative all-day/timed dates, remote observation version, link, and sync health.
- [x] Create Milestone events with Feishu's documented provider idempotency key, or bind an existing event after calendar, organizer, recurrence, and uniqueness validation.
- [x] Guard date writes with Project schedule, Milestone, and remote-observation versions; perform GET-before-PATCH, project only Feishu's response, and expose conflicts without claiming provider CAS.
- [x] Converge Feishu-originated date/status changes through a deduplicated notification hint and bounded periodic reconciliation, appending one durable Project schedule-change feed for dependency consumers.
- [x] Reserve/claim/settle calendar and event writes durably so ambiguous or recovered inflight operations become visible unknown facts and are never blindly redelivered.
- [x] Build the localized accessible Project Milestones Client surface with route/calendar/event discovery, create/bind flows, date confirmation, event links, sync status, recent changes, conflict/unknown handling, and lifecycle cleanup.
- [x] Prove Schema v8→v9 restart, exact Calendar v4 requests, Bot/User route fencing, date normalization, identity/version/contention matrices, convergence/recovery, Remote/Loader/Client/browser behavior, and built/packed artifacts.

## T11 — Deliverable from plan to acceptance (#12)

- [x] Create an immutable Deliverable Plan with 1–20 Acceptance Criteria, one Accountable, distinct Contributors, the T05 Human Sponsor rule, and one designated active Human Acceptor.
- [x] Link 1–50 currently visible Feishu task GUIDs without copying or mutating task authority; block review when no linked task remains visible.
- [x] Bind or create one authoritative non-recurring event and enforce cross-Milestone/Deliverable event uniqueness through a migrated Calendar Commitment seam.
- [x] Freeze 1–20 immutable declared exact artifact-version references in one Acceptance Request without claiming File-source verification.
- [x] Project pending Deliverable Acceptance Requests in the typed Review Center and make a changed calendar authority tuple render the request stale and unapprovable.
- [x] Decide approved, rejected, or needs changes with mandatory feedback and a complete per-criterion result set; allow a new round only after rejection/changes.
- [x] Create an immutable Final Release atomically on approval by copying the request's complete candidate set exactly, with no decision-time substitution.
- [x] Preserve receipt-first replay, Team/Task/Schedule/Deliverable CAS, member-in-use protection, rollback, privacy-redacted generic ledger facts, and replayable authorized Deliverable Activity.
- [x] Build localized accessible Project Deliverables and typed acceptance Review Center surfaces with progressive disclosure, exact retry, reconnect, responsive overflow, and protected-draft cleanup.
- [x] Prove Schema v9→v10 migration/restart, real SQLite/Scenario/Remote/Loader/Profile/browser lifecycle, Calendar fixtures/reconciliation, generated artifacts, built entries, and packed archives.

## T12 — Independent Risk register and mitigation tasks (#13)

- [x] Freeze the T12 domain, authority, lifecycle, privacy, migration, Remote, Client, packaging, and testing contract against Issue #13 and the parent V1 spec before implementation.
- [ ] Model Risk as a first-class Workbench-owned uncertain event with category, trigger, probability interval, impact interval, confidence, Owner, and review date.
- [ ] Derive exposure deterministically from bounded Risk inputs; never accept an arbitrary exposure label from a caller or model.
- [ ] Link evidence, dependencies, mitigation tasks, and contingency tasks without copying Feishu task authority or coupling Risk closure to task completion.
- [ ] Enforce audited Risk status transitions and optimistic concurrency through the existing authorization, replay, Outbox, audit, and Activity seams.
- [ ] Build a localized accessible Project Risks surface with exposure, status, Owner, trigger, and review-date filters plus lifecycle-safe drafts and retries.
- [ ] Prove migration/restart, lifecycle rules, deterministic exposure, task/evidence authority, privacy, Scenario/Remote/Loader/Profile/browser behavior, and built/packed artifacts.

## Deferred and later work

- [ ] UI-MANUAL-01 — Non-blocking follow-up issue: after all development is complete, the user will manually repeat the zh-CN desktop and 375px visual pass for every new surface in an environment with CJK fonts. Automated Chromium functional, accessibility, keyboard, overflow, and responsive-layout coverage remains required now; this container cannot reliably judge Chinese glyph rendering because it has no CJK font.
- [ ] T13+ File-source integration, AI-native analysis, automation, backup, integration hardening, and 14-day acceptance remain intentionally outside T12 preparation.

## Definition of done

The current ticket is done only when every GitHub acceptance item has behavioral evidence, `pnpm verify` passes, the ticket is updated with that evidence, and no known lifecycle or publication claim is overstated.
