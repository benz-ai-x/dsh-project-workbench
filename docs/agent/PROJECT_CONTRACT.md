# Project Contract

## Product outcome

Project Workbench is an external DeepSeek Harness Cordis plugin. It will provide a project-centered workspace for durable project state, documents, collaboration, and AI-native progress/risk/topic workflows. T01 established the durable Host-to-browser walking skeleton, T02 added the local Owner boundary, T03 completed the traceable transaction/Outbox/audit seam plus Owner Activity, and T04 added immutable Template-driven Project creation. The current implementation boundary is GitHub Issue #6 (T05): one Project-scoped human/Agent roster and responsibility tuple.

## Runtime shape

- `@benz-ai-x/dsh-project-workbench` owns Host truth, the `workbench` Typert Remote namespace, SQLite persistence, the injectable `WorkbenchScenario` test seam, and the Owner authentication/authorization boundary.
- `@benz-ai-x/dsh-project-workbench-client` owns the browser projection and UI. It mounts the generated Remote artifact before registering into the `conversation` Slot and tears down in reverse order.
- `@benz-ai-x/dsh-project-workbench-bundle` inserts the Host and Client rows. The tracked `workbench-test` profile composes `dsh-base`, `dsh-web-app`, and this bundle.
- Host state never crosses through a custom Session event. Client code never imports Node, repository, credentials, or external adapter implementations.
- T03 still uses the neutral status value as its first formal command target. It is not a Project, Goal, risk, or topic; those aggregates begin in T04 and later tickets.

## Pinned baseline

The only implementation baseline is `dsh-v0.1.2-alpha.1` at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`. The clean local fallback is `../deepseek-harness-baseline`. `../deepseek-harness` contains unrelated user changes and is not an allowed source.

Before runtime changes:

1. Read this file, `TODO.md`, `dsh-reference.lock.json`, the active ticket, and the relevant `dsh-plugin-dev` references.
2. Run `node scripts/verify-dsh-context.mjs --require-source`.
3. Inspect the worktree and preserve unrelated changes.

## Invariants

- Host Service packages use the Service plugin shape: explicit static injection, static Config, generated Typert artifacts, and a default Service export. Namespace function plugins use named exports and no accidental default export.
- Public `Config` has a TypeScript interface and a same-named Schemastery runtime schema. Defaults live in the schema. Invalid values fail through the real Loader path.
- Public commands validate before commit. Observers receive only committed whole-value projections. Revision conflicts are explicit and never silently overwrite another writer.
- `WorkbenchScenario` accepts a deterministic clock, ID generator, Repository, and external adapter set. Its public command/query seam is the primary test boundary.
- Disposal closes admission, waits for accepted work, removes Client Slot and Remote contributions, then closes owned persistence. No timer, listener, Remote, database handle, or late async publication may survive its Fiber.
- Client state distinguishes loading, ready-empty, ready-value, pending, stale/disconnected, domain conflict, and transport failure. It keeps the last authoritative value while stale, preserves recoverable drafts, prevents duplicate submission, uses typed zh/en copy, and is keyboard/screen-reader usable.
- UI code registers in a declared additive/replacement Slot and never registers `root`. It uses CSS Modules and Harness semantic theme tokens; no global CSS, hard-coded theme colors, or new component framework.
- External DSH packages stay source-linked until a clean registry-install closure is proven. Passing local checks is not a publication-readiness claim.

## T02 identity and transport invariants

- V1 has exactly one local Owner. Initialization is an atomic absent-to-present DSH credential-record transition; a second initializer never creates another login identity.
- The DSH Connection launch cookie remains an outer Harness-access fence, not the Workbench login. Workbench owns a separate `__Host-` session cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain` attribute.
- Password verification uses Argon2id. Raw passwords, recovery codes, and session tokens are ephemeral; only a PHC password hash and high-entropy token digests may enter the versioned `project-workbench/owner-auth` DSH credential record.
- The Workbench `/api/workbench` carrier route first reuses Connection's Host/Origin/launch-cookie rejection, then authenticates the Owner session, removes the opaque Owner cookie from the internally forwarded request, and establishes a Host-only principal context before forwarding to the generated Typert Gateway handler.
- Every public Workbench scenario command/query independently calls the same `AuthorizationPolicy` seam. Missing principal context denies access, including direct in-process invocation; the carrier check is defense in depth, not the sole policy call.
- The Client treats the server-issued absolute session deadline as a fail-closed projection fence: a deadline timer, window reactivation, and every protected local/Remote operation erase cached status, drafts, and recovery plaintext once expired. Host session validation remains authoritative on every request.
- Logout removes the server-side session before clearing the browser cookie. Password recovery consumes the current code, increments the credential version, invalidates every session, and issues one replacement code exactly once.
- Recovery is a local package CLI with hidden TTY input (and a bounded stdin mode for automation), not a public browser form. It uses the official DSH credential provider rather than parsing its backing file.
- T02 deliberately did not invent a competing authentication audit store. T03's atomicity claim applies to formal business commands in the Workbench SQLite database. Owner credentials live in the separate DSH credential provider, so authentication/recovery mutations and this ledger cannot honestly be described as one atomic transaction; durable security-event integration requires an explicit later cross-store design rather than a best-effort optional sink.

## T03 command, Outbox, and audit invariants

- Every formal mutation carries a caller-stable idempotency key, causation ID, bounded reason code, expected version, and a server-derived authenticated actor. Browser input never supplies actor or organization scope.
- The normalized business mutation, one immutable pending Outbox intent, one append-only audit event/hash-head advance, and the replay receipt live in the same SQLite file and one synchronous `BEGIN IMMEDIATE` transaction. No `await`, adapter call, observer, or log call occurs while that write transaction is held.
- Receipt lookup precedes optimistic-concurrency validation. The same actor/key and same normalized intent returns its stored result without another mutation, event, or Outbox row; reuse for different intent is an explicit domain conflict.
- A committed audit event contains only allowlisted fields: actor, organization/team scope, bounded reason, action, nullable Project scope, object identity/version, command ID, causation ID, Outbox ID, timestamp, and safe summary code. Status text, credentials, tokens, request bodies, headers, raw errors, and arbitrary metadata never enter audit or Activity.
- Audit hashes use a versioned RFC 8785-compatible canonical JSON envelope and SHA-256 with sequence and previous hash. Verification recomputes the complete chain and compares the stored head. This is tamper evidence, not non-repudiation against an attacker able to rewrite the database and every external checkpoint.
- Outbox states are facts: `pending`, `delivered`, `unknown`, and `failed`. A transport outcome that may have taken effect is `unknown`, never blindly retried with a fresh effect key or aged into `failed`.
- Activity and audit-integrity reads authorize before storage, constrain organization from the Host principal, apply Project/object/action filters in the repository, and return only detached browser-safe projections.

## T04 Project Template, Goal, Outcome, and Project invariants

- The canonical domain vocabulary is recorded in `CONTEXT.md`. A Project has exactly one Primary Goal and zero or more distinct Supporting Goals; a Goal owns at least one Outcome, and an Outcome is a measurable result rather than a task or output.
- The built-in Knowledge Work Template is one immutable Template Version with a closed runtime schema, canonical bytes, and a SHA-256 digest. A changed definition must be a new Template Version; no caller may select a mutable `latest` alias.
- Every Project records Template Version provenance and owns a complete immutable Project Template Snapshot. The creation snapshot is copied, digest-verified, and never rewritten by a future Template Version or upgrade.
- Project creation is one formal command: catalog CAS, Supporting Goal revision/scope checks, Primary Goal, ordered Outcomes, Project, snapshot, links, pending Outbox, one Project-scoped audit event/hash-head advance, and replay receipt either commit together or do not exist.
- Outcome metrics carry bounded names, a finite baseline and target, a bounded unit, and an increase/decrease direction consistent with those values. Execution completion and Outcome attainment remain separate concepts.
- The browser supplies exact Template Version/digest, expected revisions, idempotency key, causation ID, and bounded domain input. Actor, organization/team scope, generated IDs, time, audit vocabulary, and Outbox facts remain Host-derived.
- Project names, Goal/Outcome text, metric values, Template Snapshot content, request bodies, and raw failures never enter audit or Activity. The Project detail projection may return authorized business values as detached whole objects.

## T05 ProjectMember and responsibility invariants

- A ProjectMember is a stable, Project-scoped responsibility identity, not a Workbench login, Feishu contact record, or runnable Agent Profile. T05 admits exactly one creation identity variant: declared Feishu human (`appId + openId`), external-contact human, or descriptive Agent.
- A declared Feishu identity is app-scoped metadata, not verified connector truth. Only an active declared-Feishu human is marked as having an assignee identifier; T07 must verify connection scope and T08 remains authoritative for real Feishu task assignment.
- The Project is T05's only Responsibility Target. Its current Project Responsibility is either unconfigured or one complete tuple with exactly one active Accountable, zero or more distinct active Contributors excluding the Accountable, and a Human Sponsor when the Accountable is an Agent or external-contact human.
- Human Sponsor is an active human ProjectMember distinct from the sponsored Accountable. Sponsor is oversight and escalation, not a second Accountable, and may also be a Contributor.
- Project Team revision serializes roster creation, member status, and responsibility replacement. Responsibility versions are append-only. ProjectMember status is reversible; identity rows are never deleted, and a current Accountable, Contributor, or Sponsor must be reassigned before deactivation.
- Member creation, status change, and responsibility replacement are authorized T03 commands with receipt-first replay, exact CAS, one pending Outbox fact, one Project-scoped audit event, and one receipt in the same transaction. Success receipts contain only IDs, versions, safe status/kind codes, and correlation IDs.
- Display names, Feishu app/open IDs, external-contact values, complete responsibility input, raw request/failure content, and Project Team projections never enter audit, Activity, Outbox payloads, diagnostics, or immutable command receipts. Authorized roster reads may return detached business values.
- The live Client controller retains Team drafts and exact retry identity across recoverable conflicts and connection-generation resets. Project switch, logout, session expiry, and Fiber disposal erase them. Under the pinned DSH HMR contract, a replacement Fiber re-reads Host truth after the Owner explicitly reopens the Project; T05 does not place protected draft data in Web Storage or a process-global handoff.

## Ticket boundary

T05 adds only the Project-scoped human/Agent roster, declared identity metadata, Project Responsibility, status lifecycle, and their authorized browser/ledger paths. It does not implement a global directory, member login/invitation/claiming, Feishu verification or synchronization, real task assignees, Agent Profiles or execution, Review Center, Template Studio, calendar, risks, topics, Deliverables, files, AI analysis, automation, backup, TLS/VPN, or production operations.

## Required evidence

- Unit and scenario tests for validation, CAS conflict, deterministic IDs/time, persistence restart, cancellation boundary, and drain/close behavior.
- Host plugin and real Loader tests, including invalid Config and Fiber disposal/remount.
- Client controller, component, Slot lifecycle, Remote mount rollback, and HMR cleanup tests.
- A dedicated Profile test that resolves both stable rows without modifying DSH core.
- A browser journey that writes through the public command, observes the Host projection, and observes it again after a full restart with the same database.
- Built-entry, lazy-CJS bundle, generated Typert, and real tarball checks.
- T02 additionally requires real carrier-level 401/403 evidence, server-observed Cookie attributes/round trips, one-time recovery behavior, and proof that an unauthenticated browser never renders or mutates the Workbench projection.
- T03 additionally requires rollback fault evidence, response-loss replay without duplicate rows, hash-chain mutation/deletion/reorder detection, Activity filtering/redaction, all four observable Outbox states, generated four-method Typert faces, and a real-browser Activity journey that never renders protected data before authentication.
- T04 additionally requires immutable Template Version and Project Template Snapshot evidence, Goal/Outcome/Project relationship and metric validation, catalog/Supporting Goal conflict and rollback matrices, response-loss replay, Project-scoped Activity redaction, migration/restart, generated seven-method Typert faces, and a real-browser create/reopen journey.
- T05 additionally requires discriminated member-identity validation, app-scoped Feishu declaration semantics, unique Accountable and Sponsor policy evidence, retained inactive/history facts, Project Team CAS/replay/rollback, PII-redacted Activity and receipts, Schema v3→v4 migration/restart, generated eleven-method Typert faces, and a real-browser roster/responsibility journey.
