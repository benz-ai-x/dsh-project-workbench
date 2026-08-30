# T04 research: immutable project templates and per-project snapshots

Research date: 2026-08-31

Ticket: [#5 — T04 从知识工作模板创建 Goal 与 Project](https://github.com/benz-ai-x/dsh-project-workbench/issues/5)

Runtime in scope: Node 26, `node:sqlite`, and the Workbench-owned Host repository

This note uses only primary sources: the ticket and repository contract, official
product/API documentation, standards, and first-party source. Each section
separates **source facts** from **Workbench design inferences**. External systems
are precedents, not normative models for Workbench.

## Executive recommendation

**Workbench design inference.** Ship one built-in template definition identified
by all four of these values:

- stable `templateId = "knowledge-work"`;
- monotonic domain `templateVersion = 1`;
- independent `snapshotSchemaVersion = 1`; and
- `sha256:<hex>` over RFC 8785-compatible canonical definition bytes.

Persist the canonical definition in an append-only template-version row. During
project creation, copy those exact canonical bytes and digest into an immutable
project-owned snapshot row; retaining only a foreign key to the template version
does **not** satisfy the ticket's independent-snapshot requirement. A later
template change inserts version 2 and changes only the default offered to future
creates. It never updates version 1 or any existing project's creation snapshot.

Make `createProjectFromTemplate` one authorized T03 command. In one synchronous
`BEGIN IMMEDIATE` transaction, perform receipt-first replay lookup, validate the
exact template version and all relationship preconditions, insert one Goal, one
or more measurable Outcomes, the Project and secondary-Goal links, copy the
template snapshot, insert one pending Outbox intent, append one allowlisted audit
event/hash-head advance, and save the exact result receipt. Publish only after
commit.

## 1. Local requirements and the seam T04 actually inherits

### Source facts

- Ticket #5 requires one immutable knowledge-work template version; creation of
  a Goal, one or more Outcomes, and a Project whose primary Goal is that Goal;
  storage of both the template version and an independent snapshot; optional
  secondary Goals; authorization, optimistic concurrency and audit; and a
  browser projection that can be reopened.
  [Ticket #5](https://github.com/benz-ai-x/dsh-project-workbench/issues/5)
- The parent design says a Project has exactly one primary Goal and optional
  secondary Goals, a Goal has one or more measurable Outcomes, template versions
  and per-project snapshots are immutable, and upgrades require a preview and an
  Owner choice. It also separates execution, Deliverable acceptance, and Outcome
  attainment.
  [V1 design](../design/project-workbench-v1.md#61-%E7%9B%AE%E6%A0%87%E4%B8%8E%E9%A1%B9%E7%9B%AE),
  [template design](../design/project-workbench-v1.md#71-%E7%89%88%E6%9C%AC%E5%8C%96%E6%A8%A1%E6%9D%BF)
- The current Host already authorizes every scenario operation, derives the
  actor from Host scope, admits caller-stable idempotency and causation IDs,
  owns deterministic time/IDs, drains admitted work on disposal, and delegates
  the commit point to `WorkbenchRepository`.
  [`WorkbenchScenario`](../../packages/workbench-host/src/scenario.ts),
  [`WorkbenchRepository`](../../packages/workbench-host/src/repository.ts)
- The SQLite implementation already uses one synchronous `DatabaseSync`
  connection, `BEGIN IMMEDIATE`, receipt lookup before CAS, canonical request
  hashes, one database file, `STRICT` tables, immutable audit/receipt/Outbox
  intent triggers, `synchronous=FULL`, foreign keys, a busy timeout, and an
  RFC 8785-compatible JSON canonicalizer.
  [`SqliteWorkbenchRepository`](../../packages/workbench-host/src/sqlite-repository.ts),
  [`canonicalizeJson`](../../packages/workbench-host/src/audit.ts),
  [T03 research](./t03-transactional-audit-outbox.md)

### Workbench design inferences

- T04 should extend this seam rather than introduce a second repository,
  transaction helper, audit store, or custom DSH Session event.
- The neutral T03 status remains separate. T04 adds real Goal, Outcome, Project,
  template, and snapshot tables and vocabulary; it must not reinterpret the
  singleton status as a Project version counter.
- The smallest public slice is: list/read the built-in template version, create
  the aggregate cluster, and read a detached Project detail projection after
  creation/restart. Template editing, cloning, upgrade diff/apply, and project
  customization remain later slices, but this storage format must not prevent
  them.

## 2. Immutable, explicitly versioned template definitions

### Source facts

- Kubernetes `ControllerRevision` is an official example of a serialized state
  snapshot with a separate numeric `revision`; after creation its `Data` cannot
  be updated.
  [Kubernetes ControllerRevision API](https://kubernetes.io/docs/reference/kubernetes-api/apps/controller-revision-v1/)
- An OCI descriptor's digest is a content identifier computed from the content
  bytes. Consumers can recompute it to verify that the content was not modified;
  compliant implementations must support SHA-256 verification.
  [OCI Image Spec v1.1.1, descriptors and digests](https://github.com/opencontainers/image-spec/blob/v1.1.1/descriptor.md#digests)
- OCI Distribution treats a human-readable tag as a pointer and a digest as the
  manifest's content identity; one digest may have multiple tags, and manifests
  can still be deleted by digest. Thus content identity alone is not a retention
  guarantee.
  [OCI Distribution Spec v1.1.1: pull](https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md#pulling-manifests),
  [delete](https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md#deleting-manifests)
- RFC 8785 recursively sorts object properties, preserves array order, applies
  ECMAScript primitive serialization, and emits UTF-8, yielding deterministic
  bytes suitable for cryptographic hashing.
  [RFC 8785 §§3.2.2–3.2.4](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2)
- TypeScript `readonly` is a type-checking aid, does not change runtime behavior,
  does not make nested contents totally immutable, and can be bypassed through
  aliasing. It therefore cannot enforce durable template immutability.
  [TypeScript Handbook: `readonly` properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties)
- SQLite triggers can run on update/delete and `RAISE(ABORT, ...)` terminates the
  statement with a constraint error.
  [SQLite `CREATE TRIGGER` and `RAISE`](https://www.sqlite.org/lang_createtrigger.html#the_raise_function)

### Workbench design inferences

Use a closed, versioned envelope, not an unbounded
`Record<string, unknown>`. A minimal T04 shape is:

```ts
interface KnowledgeWorkTemplateDefinitionV1 {
  readonly snapshotSchemaVersion: 1
  readonly templateId: 'knowledge-work'
  readonly templateVersion: 1
  readonly kind: 'knowledge-work'
  readonly rules: {
    readonly minimumOutcomeCount: 1
    readonly outcomeMetricRequired: true
    readonly primaryGoalRequired: true
    readonly secondaryGoalsAllowed: true
  }
  readonly defaults: {
    readonly projectTimezone: 'Asia/Shanghai'
  }
}
```

The fields have distinct jobs:

| Field | Meaning | Mutation rule |
|---|---|---|
| `templateId` | Stable template family | Never reused for another meaning |
| `templateVersion` | Monotonic business revision within that family | A changed definition gets a new integer |
| `snapshotSchemaVersion` | Decoder/migration vocabulary | Changes only when the serialized envelope changes |
| `definitionDigest` | Integrity identity of exact canonical bytes | Recomputed and compared on every seed/read boundary |

Persist `canonical_definition_json` and `definition_digest` under
`UNIQUE(template_id, template_version)`. Seed the built-in row idempotently at
repository migration/open, then read it back and fail closed unless both bytes
and digest match the compiled definition. Never upsert new content over an
existing version. Permanent update/delete rejection triggers make the database,
not TypeScript, the durable immutability boundary.

Do not claim SemVer semantics: T04 has no compatible/breaking-upgrade policy.
An integer domain revision plus a separately versioned snapshot schema is less
ambiguous. The digest detects accidental same-version drift; it is integrity
evidence, not authorship or non-repudiation.

## 3. Independent project snapshots and non-propagating upgrades

### Source facts

- Kubernetes documents template-instantiation behavior directly: changing a
  CronJob applies to new Jobs, while already-started Jobs continue unchanged;
  the controller does not update existing Jobs.
  [Kubernetes CronJob: modifying a CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/#modifying-a-cronjob)
- Camunda assigns deployed process definitions numeric versions. By default,
  running instances continue on the version with which they started, while new
  instances use the latest; changing an existing instance is a distinct,
  explicit migration operation.
  [Camunda process-definition versioning](https://docs.camunda.io/docs/components/best-practices/operations/versioning-process-definitions/),
  [Camunda glossary](https://docs.camunda.io/docs/reference/glossary/#process-instance)
- GitHub creates a new repository with the template's files and directory
  structure, but template-created branches have unrelated histories and the new
  repository starts as a new project rather than a fork.
  [GitHub repository templates](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template#about-repository-templates)
- Tekton's version-pinned API source says a `PipelineRun` stores the exact
  `PipelineSpec` used to instantiate it; its official documentation states that
  preserving the full spec provides full auditability.
  [Tekton Pipeline v1.15.0 API source](https://github.com/tektoncd/pipeline/blob/v1.15.0/pkg/apis/pipeline/v1/pipelinerun_types.go#L539-L543),
  [PipelineRun documentation source](https://github.com/tektoncd/pipeline/blob/v1.15.0/docs/pipelineruns.md#L56-L59)

### Workbench design inferences

One project creation should persist both provenance and a detached copy:

```ts
interface ProjectTemplateSnapshotV1 {
  readonly projectId: string
  readonly templateId: string
  readonly templateVersion: number
  readonly templateDefinitionDigest: `sha256:${string}`
  readonly snapshotSchemaVersion: 1
  readonly snapshotJson: string       // exact canonical definition bytes copied at creation
  readonly snapshotDigest: `sha256:${string}`
  readonly capturedAt: string
}
```

- A foreign key to `template_version` proves provenance but is not an
  independent snapshot. `snapshot_json` must contain a copied value, and reads
  must return a detached decoded value.
- The complete copy is the replay/audit fact; the version is its lineage and the
  digest verifies its bytes. None of these three fields substitutes for either
  of the others. Template-version and snapshot retention are separate Workbench
  rules because external content-addressed systems can delete identified data.
- At T04 creation, `snapshotDigest` equals `templateDefinitionDigest` because no
  template migration/customization is in scope. Keeping both fields makes the
  source identity and the project-owned copy independently verifiable.
- Publishing template version 2 inserts a new version row and may move a
  separate “default for new projects” pointer. It does not cascade or rewrite
  `project_template_snapshot`, Goal, Outcome, or Project rows created from
  version 1.
- Future customization belongs in separate project configuration versions or
  overlays. Future template adoption is an explicit, audited command that shows
  a diff and creates another applied-snapshot/baseline record. It must never
  rewrite the immutable **creation** snapshot.
- Creation commands should accept an exact `templateId` + `templateVersion`,
  not the word `latest`. The Client can display the current default, but submits
  the exact identity it read; this removes an alias race and makes replay intent
  stable.

## 4. Goal, measurable Outcome, and primary/secondary Project Goals

### Source facts

- GitLab's official OKR model describes an Objective as the goal and Key Results
  as measures of progress that express how achievement is known; a specific
  achieved outcome contributes progress to its linked Objective.
  [GitLab OKR documentation](https://docs.gitlab.com/user/okrs/#designing-effective-okrs)
- Asana's official Goal API represents a numeric metric with unit, initial,
  target, and current values; the target cannot equal the initial value. It also
  models explicit Goal relationships whose supporting resource can be a
  Project, task, portfolio, or Goal.
  [Asana Goal metric API](https://developers.asana.com/reference/goals),
  [Asana Goal relationships API](https://developers.asana.com/reference/goal-relationships)
- Asana calls Objectives broad outcomes and Key Results specific measurable
  results, and allows projects/tasks to be connected as progress sources.
  [Asana company Goals](https://help.asana.com/s/article/plan-and-manage-company-goals?language=en_US)
- Atlassian likewise defines a Goal as an outcome to which multiple projects or
  workstreams can contribute, while a success measure/key result is an
  outcome-based metric with a baseline and target.
  [Atlassian: what is a Goal?](https://support.atlassian.com/platform-experiences/docs/what-is-a-goal/),
  [success measures and key results](https://support.atlassian.com/platform-experiences/docs/what-are-success-measures-and-key-results/)

### Workbench design inferences

The external products support measurable result objects and explicit
Goal-to-work relations, but they do **not** prescribe Workbench's primary versus
secondary distinction. That distinction is normative project policy from #5
and the V1 design.

Enforce these T04 invariants:

1. A `Goal` is organization/team scoped, starts at revision 1, and owns at least
   one `Outcome` in the creation command.
2. Every `Outcome` belongs to exactly one Goal and contains a bounded name plus
   a typed metric: `metricName`, finite `initialValue`, finite `targetValue`,
   `unit`, `direction: "increase" | "decrease"`, and optional `dueOn`;
   `increase` requires target > initial and `decrease` requires target < initial.
   Free text alone is not a measurable Outcome.
3. `Project.primaryGoalId` is non-null and points to the newly created Goal.
   This direct column gives exactly one primary Goal structurally.
4. A separate `project_secondary_goal` relation permits zero or more distinct
   auxiliary Goals. It rejects duplicate links and rejects the primary Goal as
   its own secondary Goal.
5. Every linked Goal must share the Project's organization/team. Each existing
   secondary Goal is supplied with `expectedRevision`; stale, missing, or
   inactive Goals cause a conflict before any insert commits.
6. Outcome attainment is projected separately from Project execution. T04 must
   not derive an overall Project percentage from Outcome values or task counts.

The minimum relational shape is therefore a direct required primary relation
plus a secondary join table—not one nullable, role-tagged join table whose
“at least one primary” invariant SQLite cannot express with a simple unique
index.

## 5. Atomic create, idempotent replay, optimistic concurrency, and audit

### Source facts

- SQLite allows only one simultaneous writer. `BEGIN IMMEDIATE` starts the write
  transaction at the beginning and can report `SQLITE_BUSY` there rather than
  failing later while upgrading a read transaction.
  [SQLite transactions §§2.1–2.2](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions)
- AWS's first-party idempotency guidance recommends a unique caller-provided
  request identifier. Recording that identifier and performing the mutation
  must be one ACID operation; replay should return a semantically equivalent
  response, while reuse for different intent is a distinct problem.
  [Amazon Builders' Library: idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- The transactional Outbox pattern stores the domain update and Outbox row in
  the same transaction, publishes only committed rows afterward, and still
  assumes duplicate delivery can occur.
  [AWS Transactional Outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- A version precondition is established optimistic-concurrency practice:
  Kubernetes uses `resourceVersion` to detect lost updates and returns a
  conflict for a stale client.
  [Kubernetes API concepts: updates to existing resources](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources)
- Node's `DatabaseSync` is one synchronous connection; `StatementSync.run()`
  returns the affected-row count, and `database.isTransaction` exposes SQLite's
  autocommit state.
  [Node 26 `node:sqlite`](https://nodejs.org/docs/latest-v26.x/api/sqlite.html#class-databasesync)

### Workbench design inferences

Use this exact command order:

1. Validate the request and authorize `workbench.project.create`; derive actor,
   organization, and team exclusively from Host scope.
2. Normalize the exact template version, Goal/Project fields, ordered Outcomes,
   secondary Goal IDs/revisions, `expectedVersion: null`, reason, idempotency
   key, and causation ID. Hash this intent; exclude generated IDs and clock time.
3. Generate IDs/time through the existing injected seams and enter
   `BEGIN IMMEDIATE` with no `await` or callback inside the transaction.
4. Look up the actor/organization-scoped receipt **before** template lookup or
   concurrency checks. Same key + same intent returns the stored result; changed
   intent returns `idempotency-conflict` with no mutation.
5. Read the exact immutable template version, recompute/compare its digest, and
   verify every expected secondary-Goal revision. Treat new Goal/Project
   `expectedVersion: null` as absent-to-present creation semantics.
6. Insert Goal revision 1, all Outcome revision-1 rows, Project revision 1,
   secondary links, and the copied immutable project snapshot.
7. Insert one pending `workbench.project.created.v1` Outbox intent, append one
   `workbench.project.created-from-template` audit event and advance the hash
   head, then save the exact detached Project-detail result in the receipt.
8. Check cancellation immediately before `COMMIT`. After a successful commit,
   return the stored result even if cancellation races; publish observers only
   afterward.

The audit event should use the new Project as both object and Project scope,
version 1, and an allowlisted summary such as
`project-created-from-template` with bounded fields (`templateId`, numeric
version, Outcome count, secondary-Goal count). Do not copy titles, metric names,
the full snapshot, request JSON, or Outbox payload into Activity. One command
event is enough to prove the atomic aggregate creation; the Project detail
projection carries the created Goal/Outcomes.

No external adapter call belongs in T04's transaction. The Outbox row is the
durable post-commit integration/event intent inherited from T03, not evidence
that an external effect has already occurred.

## 6. SQLite and TypeScript storage boundary

### Source facts

- SQLite `STRICT` tables enforce a declared storage class (or fail with a
  datatype constraint), while retaining `CHECK`, `NOT NULL`, foreign-key, and
  `UNIQUE` constraints.
  [SQLite STRICT tables](https://www.sqlite.org/stricttables.html)
- Foreign-key enforcement must be enabled per connection, and parent keys must
  be a primary key or covered by a matching unique constraint.
  [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
- An `UPDATE ... WHERE ...` that matches no row is valid and changes zero rows;
  Node exposes that count, which makes a version-guarded `UPDATE` an observable
  CAS result.
  [SQLite `UPDATE`](https://www.sqlite.org/lang_update.html),
  [Node `StatementSync.run()`](https://nodejs.org/docs/latest-v26.x/api/sqlite.html#statementrunnamedparameters-anonymousparameters)
- SQLite forbids subqueries in `CHECK` expressions, so a row-level `CHECK`
  cannot prove that a Goal has at least one child Outcome.
  [SQLite `CREATE TABLE`: `CHECK` constraints](https://www.sqlite.org/lang_createtable.html#check_constraints)

### Workbench design inferences

Add migration-owned `STRICT` tables for:

- `workbench_template_version`;
- `workbench_goal`;
- `workbench_outcome`;
- `workbench_project`;
- `workbench_project_template_snapshot`; and
- `workbench_project_secondary_goal`.

Use positive revision checks, canonical timestamps, bounded IDs/text, finite
numeric validation at the TypeScript boundary, same-scope composite candidate
keys/foreign keys, and uniqueness on `(project_id, goal_id)`. Preserve the
current same-file Outbox, audit, hash-head, and receipt tables. Reject
update/delete of template-version rows and project creation-snapshot rows with
permanent schema triggers; validate their presence on repository open just as
T03 validates its immutability triggers.

Enforce the cross-row “new Goal has at least one Outcome” invariant in the
validated command and the same creation transaction, then cover it with the
post-commit invariant query; an ordinary SQLite `CHECK` cannot express it.

Runtime schemas and normalization remain mandatory even with `STRICT` tables:
SQLite storage classes cannot prove bounded Unicode, canonical instants, finite
JavaScript numeric intent, exact union vocabulary, or a valid versioned JSON
envelope. Public TypeScript values should be recursively `readonly`, copied,
and frozen at boundaries, but the database constraints, canonical bytes,
digest verification, and forbidden-mutation triggers are the durable proof.

## 7. Minimum behavioral evidence for T04

These are Workbench design inferences tailored to the existing scenario-first
contract.

1. **Template identity and immutability:** assert the compiled V1 canonical
   bytes and SHA-256 digest; reopen/seed repeatedly without drift; direct SQL
   update/delete of V1 fails; changing any admitted definition field requires a
   new version and changes the digest; unknown snapshot schema fails closed.
2. **Snapshot independence:** create Project A from V1, add V2 as the new
   default, create Project B from V2, restart, and prove A still returns the
   exact V1 snapshot/digest while B returns V2. Mutating a decoded return value
   must alter neither subsequent reads nor stored bytes.
3. **Domain invariants:** cover one and many Outcomes, numeric increase and
   decrease targets, zero Outcomes, equal/non-finite metric values, duplicate
   secondary Goals, primary repeated as secondary, cross-scope/missing/stale
   secondary Goals, and exactly one primary Goal.
4. **Atomic fault matrix:** inject failure after each Goal, Outcome, Project,
   secondary-link, snapshot, Outbox, audit/head, and receipt write. After a real
   file-backed restart, assert that either every artifact exists once or none
   exists.
5. **Response-loss replay:** commit and suppress the response, then replay the
   same actor/key/intent. Assert the identical IDs/result and exactly one Goal,
   each Outcome, Project, snapshot, link set, Outbox row, audit event, and
   receipt. Changed intent under the same key is a deterministic conflict.
6. **Optimistic concurrency and contention:** stale secondary-Goal revision
   conflicts without partial rows; two real SQLite connections racing the same
   command converge on one receipt/result; a different create key remains a
   distinct Project even when titles/metrics match.
7. **Authorization, cancellation, lifecycle:** direct in-process and Remote
   calls without an Owner fail; actor/scope cannot be supplied by browser JSON;
   pre-commit cancellation rolls back; post-commit cancellation returns the
   committed result; disposal closes admission, drains the accepted create, and
   closes SQLite without late publication.
8. **Projection and restart:** through `WorkbenchScenario`, the generated
   Typert Remote, real Loader/Profile, and a browser journey, create the Project,
   render its primary Goal, all Outcomes, template version/digest, and secondary
   Goals, reload it, then stop and restart the Host on the same database and
   render the same authoritative projection. An unauthenticated browser must
   render none of it.
9. **Packed artifact:** regenerate and verify the Remote faces and exercise the
   same create/read route from the built and packed Host/Client artifacts; do
   not count a repository-only SQL test as the ticket's browser evidence.

Run the existing RFC 8785 vectors for template canonicalization rather than
introducing a second JSON serializer. After migration, run
`PRAGMA foreign_key_check`, `PRAGMA integrity_check`, and an invariant query that
confirms every Project has a snapshot, one reachable primary Goal, at least one
Outcome on a newly created Goal, and no primary/secondary duplicate.

## Decision summary

- Identify a template by stable family ID, monotonic domain version, independent
  snapshot schema version, and SHA-256 of canonical bytes.
- Enforce immutability in SQLite; TypeScript `readonly` is helpful but not a
  persistence control.
- Store both provenance and an actual project-owned snapshot copy. New template
  versions affect only new creates; migration is a future explicit command.
- Make Outcomes measurably typed and subordinate to one Goal; make the primary
  Goal a required Project field and auxiliary Goals a distinct relation.
- Reuse the T03 receipt-first, `BEGIN IMMEDIATE`, Outbox, hash-chain, audit,
  cancellation, and post-commit publication seam for the whole aggregate create.
- Treat restart-visible Scenario/Remote/browser behavior—not table presence
  alone—as the acceptance evidence.
