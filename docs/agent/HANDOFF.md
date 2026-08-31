# Project Workbench handoff

Last updated: 2026-09-01 CST (Asia/Shanghai)

## Current state

- Repository: `/root/workspace/dsh-project-workbench`
- Branch: `main`
- Published T11 implementation checkpoint before this handoff: `db57c5e`.
- Pinned Harness checkout: `/root/workspace/deepseek-harness-baseline` at clean detached commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- Completed delivery ticket: [#12 — T11: Deliverable from plan to acceptance](https://github.com/benz-ai-x/dsh-project-workbench/issues/12).
- Prepared next ticket: [#13 — T12: Independent Risk register and mitigation tasks](https://github.com/benz-ai-x/dsh-project-workbench/issues/13).

T11 is implemented and verified. Its completion checklist is recorded in `TODO.md`; the current handoff commit closes Issue #12 when published on the default branch. T12 has been selected and its public acceptance boundary is transcribed into `TODO.md`, but no T12 implementation contract has been frozen and no T12 code has begun.

## T11 delivered surface

T11 adds four explicit Remote behaviors:

1. `projectDeliverables`
2. `createProjectDeliverable`
3. `requestDeliverableAcceptance`
4. `decideDeliverableAcceptance`

The existing `reviewCenter` query is now a closed `suggested-change | deliverable-acceptance` union while retaining target-specific decision commands. Creation freezes the Deliverable plan, criteria, responsibility, linked task GUIDs, and one unique calendar commitment. An Acceptance Request freezes 1–20 declared exact artifact-version references. Approval copies the complete request candidate set into one immutable Final Release; rejection or needs-changes closes the round and permits a later request.

Authority and lifecycle guarantees include:

- Workbench owns Deliverable, review, and release semantics; Feishu remains authoritative for linked task facts and calendar event time.
- Review is allowed while at least one linked task remains visible and is blocked only when none remain visible.
- A changed calendar authority tuple makes a pending request stale and unapprovable.
- The authenticated Owner records the formal decision separately from the designated active Human Acceptor; T11 does not claim that a ProjectMember logged in.
- Artifact versions are immutable `declared-file-version` references. T11 does not claim File-source verification before later File adapters exist.
- Receipt-first replay, Team/Task/Schedule/Deliverable CAS, rollback, redacted ledger facts, cancellation, drain, restart, and member-in-use protection remain enforced.

## Final review corrections

The two-axis final review found and closed three concrete gaps:

- Corrected linked-task visibility from “all links visible” to the specified “at least one link visible” rule.
- Replaced mock-only restart evidence with a browser journey through the real authenticated Host, generated Remote carrier, SQLite repository, Client, and same-database restart.
- Made the browser test Profile's inherited Loader metadata explicit so dependency injection and config validation are contractually visible.

Final follow-up review reports Standards 0 actionable findings and Spec 0 actionable findings. Two low-priority design observations about repeated decision vocabulary and future Milestone/Deliverable calendar convergence remain non-blocking refactoring opportunities, not T11 acceptance defects.

## Verification evidence

The authoritative verification command now runs under the workspace-default Node 22.22.1 runtime:

```sh
DSH_PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell pnpm verify
```

Final results at `db57c5e` plus the T11 implementation commits:

- Strict pinned context: 207/207 checks.
- Host and Client build: passed.
- TypeScript project references: passed.
- Tests: 50 files, 548 tests.
- Built artifacts: 661 checks.
- Packed artifacts: 3 real archives, 323 checks.
- Real Chromium: passed the cumulative authenticated journey, the auxiliary mock-Remote Client remount path, and the real Host/SQLite T11 create → request → approve → restart path on desktop/mobile coverage.

`pack:check` warnings remain deliberate boundaries: packages are private, DSH dependencies are source-linked to the pinned checkout, and registry-only installation/publication is not claimed.

## Deferred UI issue

`TODO.md` records `UI-MANUAL-01`. Automated real-Chromium functional, accessibility, keyboard, overflow, desktop, and 375px responsive checks pass. The container has no CJK font, so Chinese glyph appearance renders as missing-glyph boxes and cannot be judged honestly here. After all development is complete, repeat the zh-CN desktop and mobile visual pass manually in a normal CJK-font environment.

This is a visual-font follow-up, not a claim that UI testing as a whole was unavailable.

## T12 prepared boundary

Issue #13 asks for a first-class Workbench Risk register whose entries store the uncertain event, category, trigger, probability interval, impact interval, confidence, Owner, and review date. Exposure must be derived deterministically rather than accepted as arbitrary caller/model text. Risks link evidence, dependencies, and authoritative Feishu mitigation/contingency tasks; audited business rules govern status changes, and closing a Risk must not complete linked tasks. The Project Risks view must filter by exposure, status, Owner, trigger, and review date.

T12 is unblocked by completed T06 and T08. Before implementation, read Issue #13 and the parent spec completely, then freeze the exact domain/authority/Remote/Client/migration/test contract in a T12 research note and update `CONTEXT.md`. Do not infer File-source verification, AI Risk Radar behavior, or new Feishu task mutation authority unless the ticket explicitly requires it.

## Next-session entry

1. Read `docs/agent/PROJECT_CONTRACT.md`, `TODO.md`, `dsh-reference.lock.json`, this handoff, Issue #13, and its parent spec completely.
2. Confirm the main worktree and pinned Harness checkout are clean and at the recorded commits.
3. Run `node scripts/verify-dsh-context.mjs --require-source`; after dependency installation, run `pnpm context:check:strict`. Stop on any baseline mismatch.
4. Use the installed `dsh-plugin-dev` skill and read only its Risk-adjacent Host, Client, Profile, packaging, and testing references needed by the frozen T12 surface.
5. Write the T12 domain/authority decision and failing public-seam tests before implementation; preserve Host authority, generated Typert contracts, typed localization, cancellation, disposal quiescence, real Loader/Profile coverage, and packed-artifact verification.
6. Keep `UI-MANUAL-01` open until all development is complete, then perform the requested manual CJK-font visual pass.
