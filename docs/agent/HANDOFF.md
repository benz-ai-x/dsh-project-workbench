# Project Workbench shutdown handoff

Last updated: 2026-08-31 20:44 CST (Asia/Shanghai)

## Current state

- Repository: `/Users/pc2026/Dev-Space/dsh-project-workbench`
- Upstream: `git@github.com:benz-ai-x/dsh-project-workbench.git`
- Main branch: `main`
- Main and `origin/main` were both at `fdb45b1bed6287bb649ede6d79575660bb830e29` before this handoff commit.
- The main worktree and all three T10 implementation worktrees were clean when the agents were stopped.
- Active delivery ticket: [#11 — T10: Bind a Project calendar and manage Milestones](https://github.com/benz-ai-x/dsh-project-workbench/issues/11), currently open.
- The implementation goal remains active and intentionally incomplete. Do not mark it complete until all remaining tickets and final acceptance are complete.

## Completed checkpoint

T09 is complete and [issue #10](https://github.com/benz-ai-x/dsh-project-workbench/issues/10) is closed. The final T09 commit is `d80919e`.

The final T09 verification passed:

- Context contract: 207/207
- Tests: 40 files, 452 tests
- Build: 554 modules
- Package verification: 3 archives, 318 checks
- Browser smoke test: passed

Evidence was posted in the [T09 completion comment](https://github.com/benz-ai-x/dsh-project-workbench/issues/10#issuecomment-5476581487).

## T10 contract already frozen

The T10 design and public seams are committed and pushed:

- `b55903e` — calendar and Milestone domain/authority contract
- `207fd73` — Feishu Calendar adapter seam
- `fdb45b1` — public Host/Client calendar contract

Read these before implementation:

- [`CONTEXT.md`](../../CONTEXT.md)
- [`TODO.md`](../../TODO.md)
- [`PROJECT_CONTRACT.md`](./PROJECT_CONTRACT.md)
- [`t10-feishu-calendar-milestones.md`](../research/t10-feishu-calendar-milestones.md)
- [`client.ts`](../../packages/workbench-host/src/client.ts)
- [`feishu-calendar-federation.ts`](../../packages/workbench-host/src/feishu-calendar-federation.ts)

The frozen public Remote surface contains exactly seven T10 behaviors:

1. `discoverFeishuCalendars`
2. `bindProjectCalendar`
3. `discoverFeishuCalendarEvents`
4. `getProjectMilestones`
5. `createProjectMilestone`
6. `updateProjectMilestoneDate`
7. `reconcileProjectCalendar`

Important contract decisions:

- A Project has zero or one immutable binding to one writable Feishu Calendar v4 calendar through one exact verified Bot/User route. There is no actor fallback.
- A Milestone owns Workbench business semantics and binds to one non-recurring, non-exception event organized by that calendar.
- Feishu is authoritative for event dates and status. Workbench stores the latest normalized observation and emits durable `ProjectScheduleChange` facts.
- Schedules are a closed union: all-day ISO dates with an exclusive end, or RFC 3339 timed instants with an IANA time zone.
- Event creation uses Feishu's provider `idempotency_key`. Calendar creation and event PATCH are one-attempt operations; ambiguous outcomes become visible `unknown` facts and must not be blindly redelivered.
- Calendar event responses do not expose a usable resource revision/ETag. `remoteObservationVersion` is a SHA-256 digest of the canonical authority tuple, not provider CAS. Date writes therefore require GET-before-PATCH, one PATCH attempt, response validation, and reconciliation.
- Event-change notifications are hints only because relevant event ID/change-type fields are gray-release fields. Correctness must also come from bounded reconciliation of all bound events.
- T10 advances the SQLite schema from v8 to v9.

Public webhook exposure, recurring events, meetings, deliverables, task-date synchronization, files, and AI-native analysis remain outside T10.

## Stopped parallel work

All three agents were interrupted safely before shutdown. Their branches have no branch-only commits and their worktrees have no tracked or untracked changes. Each currently points to `fdb45b1`.

| Workstream | Branch | Worktree | Ownership when resumed |
| --- | --- | --- | --- |
| Domain/reliability | `codex/t10-domain` | `/Users/pc2026/Dev-Space/dsh-project-workbench-t10-domain` | Host domain, authorization, repository, SQLite schema v9, scenarios, reliable operations, and tests; do not edit production adapter, Client, generated Remote, index, browser, or packaging files. |
| Feishu adapter | `codex/t10-adapter` | `/Users/pc2026/Dev-Space/dsh-project-workbench-t10-adapter` | Calendar v4 runtime helpers, `feishu-connection-adapter.ts`, and adapter tests; implement exact list/get/create/PATCH behavior for Bot/User routes and digest/constraint handling; do not edit repository, scenarios, Client, or Remote. |
| Client | `codex/t10-client` | `/Users/pc2026/Dev-Space/dsh-project-workbench-t10-client` | `packages/workbench-client/**`, including controller, panel, styling, localization, and tests; do not edit Host core, adapter, or Remote during the independent phase. |

Do not delete or recreate these worktrees unless a read-only check proves they are gone. If dependencies are absent after restart, run `pnpm install --offline --frozen-lockfile` inside the affected worktree.

## Recommended resume and integration order

1. Confirm main and all worktrees still match the recorded state.
2. Resume at most the same three agents in their existing worktrees, with the ownership boundaries above. Require each agent to run the context check first, commit only its scoped changes, and report the commit SHA plus focused test evidence.
3. Main agent reviews and cherry-picks the domain commit first, then the adapter commit, then the Client commit. Resolve contract mismatches centrally; do not let a workstream silently widen the frozen public types.
4. Main agent owns the remaining integration work: Host service composition, generated Remote declarations/loader/index wiring, browser fixtures, archive assertions, documentation/evidence, and end-to-end acceptance.
5. Run focused tests after every integration commit, then run the complete verification command.
6. Only after all eight T10 checklist items in `TODO.md` have behavioral evidence: update issue #11, close it, and continue to the next ticket.

Useful restart checks:

```sh
cd /Users/pc2026/Dev-Space/dsh-project-workbench
git status --short --branch
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git worktree list
node scripts/verify-dsh-context.mjs --require-source

git -C /Users/pc2026/Dev-Space/dsh-project-workbench-t10-domain status --short --branch
git -C /Users/pc2026/Dev-Space/dsh-project-workbench-t10-adapter status --short --branch
git -C /Users/pc2026/Dev-Space/dsh-project-workbench-t10-client status --short --branch
```

Final verification command:

```sh
pnpm verify
```

The last known complete baseline before T10 implementation was green. If the first post-restart context check fails, treat that as an environment or worktree problem before changing the frozen contract.
