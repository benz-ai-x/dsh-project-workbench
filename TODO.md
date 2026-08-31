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

## Later tickets

- [ ] T06+ review, integrations, files, AI-native analysis, automation, backup, integration hardening, and 14-day acceptance remain intentionally outside T05.

## Definition of done

The current ticket is done only when every GitHub acceptance item has behavioral evidence, `pnpm verify` passes, the ticket is updated with that evidence, and no known lifecycle or publication claim is overstated.
