# Project Workbench agent entrypoint

Codex and Claude Code share this project contract. Before substantive work, read these files completely:

1. `docs/agent/PROJECT_CONTRACT.md`
2. `TODO.md`
3. `dsh-reference.lock.json`
4. The active ticket and its parent spec

Use the installed `dsh-plugin-dev` skill for every DeepSeek Harness task. Read only the skill references needed by the active Host, Client, Profile, packaging, or testing surface.

Before implementation, run `node scripts/verify-dsh-context.mjs --require-source`. After dependency installation, use `pnpm context:check:strict`. Stop on a baseline mismatch; do not silently develop against another Harness checkout. If the pinned checkout moves, set `DSH_HARNESS_BASELINE_ROOT` and run `pnpm context:sync` so the source links and lock stay aligned.

Preserve Host authority, generated Typert Remote contracts, same-named TypeScript/Schema configuration, explicit Slot ownership, typed localization, cancellation, disposal quiescence, real Loader/Profile coverage, and packed-artifact verification. Do not add custom Session event types to the pinned Harness. Keep changes inside the active ticket boundary and update `TODO.md` as evidence lands.
