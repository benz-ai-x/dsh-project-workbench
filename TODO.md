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

## Later tickets

- [ ] T02+ authorization, transactional outbox/audit, Project domain, collaboration, files, AI-native analysis, automation, and production hardening remain intentionally outside T01.

## Definition of done

The current ticket is done only when every GitHub acceptance item has behavioral evidence, `pnpm verify` passes, the ticket is updated with that evidence, and no known lifecycle or publication claim is overstated.
