# Project Workbench handoff

Last updated: 2026-09-01 02:40 CST (Asia/Shanghai)

## Current state

- Repository: `/root/workspace/dsh-project-workbench`
- Branch: `main`
- Code checkpoint before this handoff update: `c1c6afb`.
- T10 implementation and acceptance evidence are published on `origin/main` and GitHub Issue #11 is closed.
- Pinned Harness checkout: `/root/workspace/deepseek-harness-baseline` at clean detached commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- Completed delivery ticket: [#11 — T10: Bind a Project calendar and manage Milestones](https://github.com/benz-ai-x/dsh-project-workbench/issues/11).
- Active delivery ticket: [#12 — T11: Deliverable from plan to acceptance](https://github.com/benz-ai-x/dsh-project-workbench/issues/12).

T10's implementation and all eight acceptance checklist items are complete. T11's ticket, parent V1 spec/design, required `dsh-plugin-dev` references, and first-party Calendar/File boundaries have now been read. `docs/research/t11-deliverable-acceptance.md`, `CONTEXT.md`, the Project Contract, TODO, and the browser-safe types freeze the implementation boundary before parallel work begins.

T11 intentionally records artifact versions as immutable `declared-file-version` references. It does not claim source verification before the later managed/local/Feishu File adapters exist. The authenticated Owner records formal decisions separately from the designated Human Acceptor; T11 does not pretend that a ProjectMember logged in.

## T11 frozen surface

The next implementation adds four explicit Remote behaviors:

1. `projectDeliverables`
2. `createProjectDeliverable`
3. `requestDeliverableAcceptance`
4. `decideDeliverableAcceptance`

The existing `reviewCenter` query becomes a closed `suggested-change | deliverable-acceptance` union while keeping target-specific decision commands. Creation freezes plan/responsibility/task links and binds one unique calendar event. Each acceptance request freezes the complete candidate set; approval copies it exactly into an immutable Final Release. Rejection or needs-changes closes the round and permits a later request. Calendar authority movement makes a pending request stale and unapprovable.

## T10 delivered surface

The frozen public surface still contains exactly seven T10 Remote behaviors:

1. `discoverFeishuCalendars`
2. `bindProjectCalendar`
3. `discoverFeishuCalendarEvents`
4. `getProjectMilestones`
5. `createProjectMilestone`
6. `updateProjectMilestoneDate`
7. `reconcileProjectCalendar`

Implementation evidence now covers:

- Schema v8→v9 migration and restart recovery.
- Exact Bot/User Calendar v4 list/get/create/event-create/date-PATCH routing with no actor fallback.
- Immutable Project Calendar binding and stable Workbench Milestone semantics.
- All-day and timed authority, provider observation digests, GET-before-PATCH conflict convergence, and provider-response projection.
- Receipt-first replay, prepared/inflight/unknown effect recovery, project-wide active-effect fencing, Outbox alignment, and full ledger integrity checks.
- Exact unknown date reconciliation, including semantically equivalent offset/UTC timed instants and unknown effects outside the bounded terminal projection.
- Explicit organizer/recurrence/exception/read-failure eligibility changes with revisioned `ProjectScheduleChange` facts; one unreadable event no longer prevents other bound events from converging.
- Deterministic failure→recovery change IDs when the optional test ID generator is absent.
- Localized accessible Client flows, lifecycle cleanup, generated Typert contracts, real Loader/Profile coverage, and packed-artifact verification.

The final reliability commits are:

- `2e584bd` — harden Calendar effect recovery and unknown fencing.
- `55efdda` — replay and settle the originally reserved prepared effect.
- `cb34829` — verify immutable Calendar effect/receipt/Outbox integrity.
- `d17f024` — close receipt-first, timed reconciliation, drift/feed, partial-repair, and existing-path fence gaps.

## Verification evidence

Use Node 24.11.1 for context, build, typecheck, unit/integration, built, and pack checks:

```sh
DSH_NODE24_DIR=/root/.local/share/pnpm/store/v11/links/@/node/24.11.1/67fcb385b600281971ca482889a7d0b4d66c24b47a416f079b2b80f426c72a98/node_modules/node/node_modules/node-linux-arm64/bin
PATH="$DSH_NODE24_DIR:$PATH" pnpm context:check:strict
PATH="$DSH_NODE24_DIR:$PATH" pnpm build
PATH="$DSH_NODE24_DIR:$PATH" pnpm typecheck
PATH="$DSH_NODE24_DIR:$PATH" pnpm test
PATH="$DSH_NODE24_DIR:$PATH" pnpm built:check
PATH="$DSH_NODE24_DIR:$PATH" pnpm pack:check
```

Final results at `d17f024`:

- Strict pinned context: 207/207 checks.
- Host and Client build: passed.
- TypeScript project references: passed.
- Tests: 45 files, 515 tests.
- Built artifacts: 615 checks.
- Packed artifacts: 3 real archives, 320 checks.
- Two-axis final review: Standards 0 actionable findings; Spec 0 actionable findings.

Run the real browser check under the workspace-default Node 22 runtime. Node 24 currently fails while preloading a pinned Harness browser module, so do not fold this command into the Node 24 prefix:

```sh
DSH_PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell pnpm test:browser
```

The final browser run passed the cumulative authenticated journey, all seven protected T10 Remotes, redaction, Client HMR, Host restart persistence, 375px keyboard/layout coverage, offline recovery, and session revocation.

`pack:check` warnings remain deliberate boundaries: packages are private, DSH dependencies are source-linked to the pinned checkout, and registry-only installation/publication is not claimed.

## Deferred UI issue

`TODO.md` records `UI-MANUAL-01`. Automated real-Chromium functional, accessibility, keyboard, overflow, desktop, and 375px responsive checks pass. The container has no CJK font, so Chinese glyph appearance renders as missing-glyph boxes and cannot be judged honestly here. After all development is complete, repeat the zh-CN desktop and mobile visual pass manually in a normal CJK-font environment.

This is a visual-font follow-up, not a claim that UI testing as a whole was unavailable.

## Environment limitations

- The container still has no CJK font, so `UI-MANUAL-01` remains the only deferred visual check; automated browser behavior and layout checks remain required.
- T11 has no live File adapter by design, and verification must not require live production Feishu or File credentials.

## Next-session entry

1. Read `docs/agent/PROJECT_CONTRACT.md`, `TODO.md`, `dsh-reference.lock.json`, this handoff, the active ticket, and its parent spec completely.
2. Confirm the main worktree and pinned Harness checkout are clean and at the recorded commits.
3. Run `node scripts/verify-dsh-context.mjs --require-source`; after dependency installation, run `pnpm context:check:strict`. Stop on any baseline mismatch.
4. Continue T11 only within the frozen four-method contract and the explicit exclusions in `docs/research/t11-deliverable-acceptance.md`.
5. Implement from failing public-seam tests, integrate independent worktrees through main, and run focused checks after each integration.
6. Keep `UI-MANUAL-01` open until all development is complete, then perform the requested manual CJK-font visual pass.
