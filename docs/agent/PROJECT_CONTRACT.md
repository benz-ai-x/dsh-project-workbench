# Project Contract

## Product outcome

Project Workbench is an external DeepSeek Harness Cordis plugin. It will provide a project-centered workspace for durable project state, documents, collaboration, and AI-native progress/risk/topic workflows. The current implementation boundary is GitHub Issue #2 (T01): a minimal, durable Host-to-browser walking skeleton.

## Runtime shape

- `@benz-ai-x/dsh-project-workbench` owns Host truth, the `workbench` Typert Remote namespace, SQLite persistence, and the injectable `WorkbenchScenario` test seam.
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

## Ticket boundary

T01 does not implement Owner authentication, authorization, audit hash chains, outbox delivery, Project/Goal domains, members, Feishu, calendar, risks, topics, deliverables, file search/preview, AI analysis, agents, automation, backup, TLS/VPN, or production operations. It may define injectable future adapter ports, but it must not simulate those capabilities.

## Required evidence

- Unit and scenario tests for validation, CAS conflict, deterministic IDs/time, persistence restart, cancellation boundary, and drain/close behavior.
- Host plugin and real Loader tests, including invalid Config and Fiber disposal/remount.
- Client controller, component, Slot lifecycle, Remote mount rollback, and HMR cleanup tests.
- A dedicated Profile test that resolves both stable rows without modifying DSH core.
- A browser journey that writes through the public command, observes the Host projection, and observes it again after a full restart with the same database.
- Built-entry, lazy-CJS bundle, generated Typert, and real tarball checks.
