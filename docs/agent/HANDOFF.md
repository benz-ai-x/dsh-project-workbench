# Project Workbench handoff

Last updated: 2026-09-01 CST (Asia/Shanghai)

## Current state

- Repository: `/root/workspace/dsh-project-workbench`
- Branch: `main`
- Published T12 implementation checkpoint before this handoff: `e58f9a3`.
- Pinned Harness checkout: `/root/workspace/deepseek-harness-baseline` at clean detached commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- Completed delivery ticket: [#13 — T12: Independent Risk register and mitigation tasks](https://github.com/benz-ai-x/dsh-project-workbench/issues/13).
- Prepared next ticket: [#14 — T13: Topic workspace](https://github.com/benz-ai-x/dsh-project-workbench/issues/14).

T12 is implemented, reviewed, and fully verified. Its checklist and frozen contract are recorded in `TODO.md`, `docs/agent/PROJECT_CONTRACT.md`, `CONTEXT.md`, and `docs/research/t12-risk-register.md`. T13's public acceptance boundary is transcribed into `TODO.md`, but its implementation contract is not yet frozen and no T13 code has begun.

## T12 delivered surface

T12 adds four explicit Remote behaviors:

1. `projectRisks`
2. `createProjectRisk`
3. `reviseProjectRisk`
4. `transitionProjectRisk`

Risk is a first-class Workbench-owned uncertain event with immutable complete assessment versions, append-only status transitions, and a separately authorized activity/history projection. The Host derives exposure from the frozen 5×5 probability/impact policy; callers cannot select the exposure. Same-Project audit events and schedule changes provide immutable evidence, Risk dependencies remain acyclic, and Feishu task GUIDs remain read-only mitigation or contingency links.

Authority and lifecycle guarantees include:

- Creation starts in `research`; explicit audited transitions govern `watch`, `mitigate`, `accept`, and terminal `closed`.
- Mitigate requires a currently visible mitigation task. Task availability can disappear and later reappear without changing Risk truth.
- Closing a Risk never completes, edits, or otherwise mutates a linked Feishu task; all Risk revisions and transitions prove zero task-provider/effect/receipt/task-Outbox/projection writes.
- Complete assessment replacement, trigger met-episode timing, Project-timezone date rules, Team/Task/Risk CAS, dependency-cycle checks, member-in-use protection, receipt-first replay, rollback, redaction, cancellation, drain, and restart are enforced transactionally.
- The localized Project Risks UI supports exposure, status, Owner, trigger, and review-date filters; complete history; exact ambiguous retry; reconnect behavior; keyboard access; and responsive no-overflow layouts.

## Final review corrections

The Standards and Spec reviews found and closed the remaining concrete gaps:

- Kept same-Project Risk dependency options stable while retaining transactional self/cycle rejection.
- Aligned transition conflict precedence with repository CAS ordering by preflighting aggregate, target, Risk, and Task revisions before semantic normalization.
- Preserved exact ambiguous retry identity through reconnect and prevented filters or new commands from replacing the retry envelope.
- Cleared protected drafts on connection-generation loss while retaining only safe projection/selection and exact retry state.
- Made selected history complete and native, retained already-linked bounded evidence/dependencies correctly during revision, and restored Owner plus trigger statement/state to core UI semantics.
- Added real treatment-task availability/disappearance/reappearance coverage and explicit proof that Risk commands never mutate task authority.

Final follow-up review reports Standards 0 definite findings and Spec 0 definite findings.

## Verification evidence

The authoritative verification command runs under the workspace-default Node 22.22.1 runtime:

```sh
DSH_PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell pnpm verify
```

Final results at implementation checkpoint `e58f9a3`:

- Strict pinned context: 207/207 checks.
- Host and Client build: passed.
- TypeScript project references: passed.
- Tests: 56 files, 620 tests.
- Built artifacts: 721 checks.
- Packed artifacts: 3 real archives, 328 checks.
- Real Chromium: passed the cumulative authenticated journey, including real Host/SQLite Risk create, filter, revise, mitigate, close, restart, zero task writes, keyboard behavior, and desktop/375px responsive layout.

`pack:check` warnings remain deliberate boundaries: packages are private, DSH dependencies are source-linked to the pinned checkout, and registry-only installation/publication is not claimed.

## Deferred UI issue

`TODO.md` records `UI-MANUAL-01`. Automated real-Chromium functional, accessibility, keyboard, overflow, desktop, and 375px responsive checks pass. The container has no CJK font, so Chinese glyph appearance and visual rhythm cannot be judged honestly here. After all development is complete, repeat the zh-CN desktop and mobile visual pass manually in a normal CJK-font environment.

This is a visual-font follow-up, not a claim that UI testing as a whole was unavailable.

## T13 prepared boundary

Issue #14 asks for one unified Topic workspace with explicit research and already-occurred execution-issue variants. It must retain distinct status semantics; organize facts, evidence, hypotheses, counter-evidence, open questions, conclusions, and next steps; link Goal, Project, Risk, Decision, Deliverable, and Feishu task references; reject unsafe silent type conversion; and expose evidence completeness plus pending confirmations in list/detail projections.

T13 is unblocked by completed T04 and T06. Before implementation, freeze the exact domain vocabulary, authority, variant status machines, conversion rules, evidence/link semantics, privacy, migration, Remote, Client, and test contract in a T13 research note, then update `CONTEXT.md`. Do not infer AI-generated conclusions, File-source verification, automatic linked-object mutation, or new Feishu task mutation authority unless the ticket explicitly requires it.

## Next-session entry

1. Read `docs/agent/PROJECT_CONTRACT.md`, `TODO.md`, `dsh-reference.lock.json`, this handoff, Issue #14, and its parent spec completely.
2. Confirm the main worktree and pinned Harness checkout are clean and at the recorded commits.
3. Run `node scripts/verify-dsh-context.mjs --require-source`; after dependency installation, run `pnpm context:check:strict`. Stop on any baseline mismatch.
4. Use the installed `dsh-plugin-dev` skill and read only its Topic-adjacent Host, Client, Profile, packaging, and testing references needed by the frozen T13 surface.
5. Write the T13 domain/authority decision and failing public-seam tests before implementation; preserve Host authority, generated Typert contracts, same-named TypeScript/Schema configuration, explicit Slot ownership, typed localization, cancellation, disposal quiescence, real Loader/Profile coverage, and packed-artifact verification.
6. Keep `UI-MANUAL-01` open until all development is complete, then perform the requested manual CJK-font visual pass.
