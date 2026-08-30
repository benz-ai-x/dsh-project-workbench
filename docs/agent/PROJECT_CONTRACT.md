# Project Contract

## Product outcome

Project Workbench is an external DeepSeek Harness Cordis plugin. It will provide a project-centered workspace for durable project state, documents, collaboration, and AI-native progress/risk/topic workflows. T01 established the durable Host-to-browser walking skeleton. The active implementation boundary is GitHub Issue #3 (T02): one local Owner, revocable browser sessions, local recovery, and a unified authorization gate.

## Runtime shape

- `@benz-ai-x/dsh-project-workbench` owns Host truth, the `workbench` Typert Remote namespace, SQLite persistence, the injectable `WorkbenchScenario` test seam, and the Owner authentication/authorization boundary.
- `@benz-ai-x/dsh-project-workbench-client` owns the browser projection and UI. It mounts the generated Remote artifact before registering into the `conversation` Slot and tears down in reverse order.
- `@benz-ai-x/dsh-project-workbench-bundle` inserts the Host and Client rows. The tracked `workbench-test` profile composes `dsh-base`, `dsh-web-app`, and this bundle.
- Host state never crosses through a custom Session event. Client code never imports Node, repository, credentials, or external adapter implementations.
- T01 exposes one neutral status value. It is not a Project, Goal, risk, topic, or audit record.

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
- Auth and authorization security events become durable/hash-chained only in T03 (#4); T02 must not invent a competing audit store.

## Ticket boundary

T02 implements only Owner authentication, session/recovery lifecycle, and the reusable authorization entrypoint. It does not implement audit hash chains, outbox delivery, Project/Goal domains, members, Feishu, calendar, risks, topics, deliverables, file search/preview, AI analysis, agents, automation, backup, TLS/VPN, or production operations. It may expose typed future policy ports, but it must not simulate those capabilities.

## Required evidence

- Unit and scenario tests for validation, CAS conflict, deterministic IDs/time, persistence restart, cancellation boundary, and drain/close behavior.
- Host plugin and real Loader tests, including invalid Config and Fiber disposal/remount.
- Client controller, component, Slot lifecycle, Remote mount rollback, and HMR cleanup tests.
- A dedicated Profile test that resolves both stable rows without modifying DSH core.
- A browser journey that writes through the public command, observes the Host projection, and observes it again after a full restart with the same database.
- Built-entry, lazy-CJS bundle, generated Typert, and real tarball checks.
- T02 additionally requires real carrier-level 401/403 evidence, server-observed Cookie attributes/round trips, one-time recovery behavior, and proof that an unauthenticated browser never renders or mutates the Workbench projection.
