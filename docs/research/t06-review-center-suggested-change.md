# T06 research: Review Center and version-fenced SuggestedChange

Research date: 2026-08-31

Ticket: [#7 — T06 Review Center 与 SuggestedChange](https://github.com/benz-ai-x/dsh-project-workbench/issues/7)

Runtime in scope: the Workbench Host, its generated Remote contract, the
Workbench-owned SQLite repository, and one authenticated Review Center Client
surface. AI generation, Feishu writes, files, Missions, bulk acceptance, and
later evidence-memory invalidation are not part of T06.

This note uses primary sources only: IETF and W3C standards, NIST publications,
official GitHub/GitLab/Kubernetes/Temporal documentation and source, and this
repository's approved ticket/spec/contract. Every section separates **source
facts** from **Workbench design inferences**. The sources inform the design;
none of them defines Workbench's domain model.

## Executive recommendation

> Design decision after the required multi-interface comparison: the primary-source
> findings below still govern version fences, provenance, evidence, and human
> oversight, but the implementation does **not** persist or execute JSON Patch.
> For the first three-field Project Responsibility target, a versioned typed
> `before / after / changedFields` diff is smaller and preserves Contributor-set
> semantics without a path interpreter. A future target may own a patch-shaped
> typed variant when its real domain requires one. T06 also keeps any adapter
> composition private and compile-time closed until a second production target
> proves a shared interface.

**Workbench design inference.** Make `SuggestedChange` an immutable,
Project-scoped proposal envelope plus an append-only human-review history. A
proposal must bind all of the following at creation time:

- a Host-derived source;
- one typed target aggregate and its exact base version;
- a versioned target representation;
- a strict, server-derived diff;
- validated evidence references;
- a Host-derived `low | high` risk classification and policy version; and
- the originating `causationId`.

Do not treat the stored diff as authority to mutate arbitrary JSON. The
authoritative payload is a closed semantic command candidate. The Host derives
an auditable typed `before / after / changedFields / digest` diff from the
observed base and candidate for review. On accept or edited accept, the Host
loads the original or edited typed candidate and runs the normal target
planner's current authorization, exact-version check, and business invariants;
it never executes the diff as a generic mutation program.

The first and only T06 target adapter should be
`project-responsibility.replace`. T05 already provides a meaningful,
Project-scoped mutable aggregate, exact Project Team revision, append-only
responsibility history, and a normal invariant-enforcing command. Supporting
one real adapter proves the generic Review seam without inventing future Risk,
Topic, Decision, file, external-action, or Mission domains.

Classify a responsibility proposal as `high` when it changes Accountable or
Human Sponsor (including initial configuration), and `low` when those roles are
unchanged and only the Contributor set changes. Reject a no-op proposal. Store
`riskPolicyVersion: "project-responsibility-v1"` and bounded reason codes so a
later policy can evolve without reinterpreting old records.

`pending`, `accepted`, `rejected`, and `deferred` are persisted lifecycle
states. `stale` is an effective Review Center status derived for an unresolved
proposal when the current target version differs from its immutable base
version. Accepted and rejected history never becomes stale merely because the
target later advances. A stale proposal cannot be accepted, edited-and-
accepted, force-applied, or silently rebased. If the Owner still wants the
change, a distinct new proposal must be generated against the new base. T06
does not add a supersession carrier; the older stale proposal remains visible.

Proposal creation and every Owner disposition are formal T03 commands. Inside
one synchronous `BEGIN IMMEDIATE` transaction, a successful acceptance commits
the target mutation, review decision, current review head, one redacted Outbox
intent, one hash-chained audit event, and one replay receipt. `accepted` means
the target command committed; it never means merely “the request was received.”

## 1. Ticket boundary and inherited Workbench constraints

### Source facts

- Ticket #7 requires each `SuggestedChange` to retain source, target version,
  diff, evidence, risk level, and `causationId`; the Review Center must filter
  `pending`, `accepted`, `rejected`, `deferred`, and `stale`; the Owner must be
  able to accept, edit and accept, reject, or defer with feedback; and accepting
  must recheck authorization, `expectedVersion`, and business invariants.
  [Ticket #7](https://github.com/benz-ai-x/dsh-project-workbench/issues/7)
- The approved V1 design separates AI suggestions from formal facts, assigns
  deterministic code—not an LLM—responsibility for permissions, risk severity,
  version conflicts, and loop protection, and requires important conclusions
  to remain traceable to evidence.
  [V1 design §3](../design/project-workbench-v1.md#3-%E8%AE%BE%E8%AE%A1%E5%8E%9F%E5%88%99)
- The V1 Review Center is intended to unify many later review kinds, allows
  only homogeneous low-risk batching, forbids bulk release for dangerous
  actions, and retains feedback for accept, edited accept, reject, and defer.
  [V1 design §12](../design/project-workbench-v1.md#12-review-center)
- T03 already establishes Host-derived actor/scope, receipt-first replay,
  optimistic concurrency, and one atomic domain/Outbox/audit/receipt
  transaction. T04 establishes durable Project scope. T05 establishes Project
  Team revision and the `setProjectResponsibility` command with role, member,
  and Sponsor invariants.
  [Project contract: T03 invariants](../agent/PROJECT_CONTRACT.md#t03-command-outbox-and-audit-invariants),
  [T04 invariants](../agent/PROJECT_CONTRACT.md#t04-project-template-goal-outcome-and-project-invariants),
  [T05 invariants](../agent/PROJECT_CONTRACT.md#t05-projectmember-and-responsibility-invariants)
- The pinned DSH Client contract makes the Host authoritative for durable
  state, permissions, and mutations. A browser consumes complete projections
  and must distinguish a domain conflict from transport failure.
  [Project contract](../agent/PROJECT_CONTRACT.md#invariants)

### Workbench design inferences

- T06 extends the existing `WorkbenchScenario`, `WorkbenchRepository`, SQLite
  database, authorization policy, command ledger, generated Typert namespace,
  Client Slot, Activity, and integrity verifier. It must not introduce another
  review database, browser-authoritative state machine, custom DSH Session
  event, or optional best-effort audit path.
- T06 is a governance kernel, not the complete V1 Review Center. It proves one
  typed target adapter end to end and leaves later review kinds behind an
  explicit adapter and risk-policy seam.
- The Owner is the only authenticated reviewer in V1. A ProjectMember is not a
  login principal, and an Agent member cannot approve its own suggestion.
- T06 has no model/subagent producer yet. Its public creation command may let
  the authenticated Owner propose a responsibility change so the vertical
  slice is operable. The stored source is nevertheless derived from the live
  Host principal, never selected by the browser. Later trusted Host producers
  can add new closed source variants without weakening this rule.

## 2. Diff formats: use a strict review representation, not an arbitrary write API

### Source facts

- JSON Pointer is a sequence of `/`-prefixed reference tokens. `~` and `/` in
  tokens are escaped as `~0` and `~1`; object names compare exactly without
  Unicode normalization; invalid syntax and unresolved locations are errors.
  [RFC 6901 §§3–7](https://www.rfc-editor.org/rfc/rfc6901.html)
- JSON Patch applies an ordered array of `add`, `remove`, `replace`, `move`,
  `copy`, and `test` operations. Each operation uses a JSON Pointer path. An
  operation failure makes the whole patch unsuccessful; when used through HTTP
  PATCH, the server must not expose or retain a partial application.
  [RFC 6902 §§3–5](https://www.rfc-editor.org/rfc/rfc6902.html),
  [RFC 5789 §2](https://www.rfc-editor.org/rfc/rfc5789.html)
- RFC 6902 requires implementations to ignore members not defined for an
  operation. Security metadata therefore cannot safely be hidden in custom
  operation fields.
  [RFC 6902 §4](https://www.rfc-editor.org/rfc/rfc6902.html#section-4)
- JSON Merge Patch gives `null` deletion semantics, replaces arrays as whole
  values, and replaces the complete target when the patch is not an object. It
  is explicitly unsuitable for some JSON structures. The server still owns
  authorization and appropriateness decisions.
  [RFC 7396 §§1–2, 5](https://www.rfc-editor.org/rfc/rfc7396.html)

### Workbench design inferences

- JSON Patch and Merge Patch were evaluated but are not selected for T06. A
  three-field aggregate does not justify a path parser, operation interpreter,
  or the risk of accidentally advertising a broader mutation language.
- Normalize the target representation to one complete object, including
  nullable fields and a sorted, duplicate-free Contributor array. Persist one
  closed typed diff with `kind`, `schemaVersion`, `before`, `after`,
  `changedFields`, and a canonical SHA-256 digest.
- `changedFields` is a closed set: `accountable`, `contributors`, and
  `human-sponsor`. It is derived by the Host and must exactly match the semantic
  before/after values; it is display metadata, not an instruction stream.
- Persist `representationSchemaVersion` on the target envelope. A schema
  mismatch is unsupported/stale, never a cue to guess how an older value maps
  to the current aggregate.
- Reject browser-supplied diffs, digests, source, risk, target identity, actor,
  organization, and team fields at the generated runtime codec. The browser
  submits only the complete semantic candidate and exact Team base.
- Store the immutable semantic candidate beside the derived diff. During
  integrity verification, reconstruct `before` from immutable Responsibility
  history, rederive the diff, digest, and risk, and compare canonical values.
- Edited accept preserves the original candidate and `proposedDiff`. The Host
  derives and appends a separate accepted candidate and `appliedDiff`; it never
  rewrites what the producer originally proposed.
- Neither a diff nor a digest replaces aggregate CAS. SQLite owns the actual
  all-or-nothing commit, and the shared Responsibility planner remains the only
  execution path.

## 3. Exact version fences and stale semantics

### Source facts

- RFC 5789 warns that some patch formats require a known base and recommends a
  conditional request that fails if the resource changed. It requires the
  whole change set to apply atomically or not at all. A failed explicit
  precondition maps naturally to `412 Precondition Failed`; a state conflict
  without a precondition can use `409 Conflict`.
  [RFC 5789 §§2–2.2](https://www.rfc-editor.org/rfc/rfc5789.html)
- HTTP `If-Match` uses strong entity-tag comparison to prevent lost updates. A
  false precondition prevents the method and normally returns 412. Entity tags
  are opaque validators for a selected representation.
  [RFC 9110 §§8.8.3, 13.1.1, 13.2.2](https://www.rfc-editor.org/rfc/rfc9110.html)
- Kubernetes requires an update client to send the `resourceVersion` it read;
  a stale value is rejected with `409 Conflict`. Clients needing lost-update
  protection for PATCH should also make the request conditional.
  [Kubernetes API concepts: updates](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources)
- Kubernetes Server-Side Apply reports conflicting field ownership and has an
  explicit force mechanism. Its purpose is to prevent one workflow from
  unintentionally overwriting another workflow's fields.
  [Kubernetes Server-Side Apply: conflicts](https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts)
- GitLab's approval API can bind approval to the merge request HEAD SHA and
  returns a conflict when it no longer matches. GitLab's suggestion model also
  rechecks current content and HEAD before application; a batch is rejected if
  an item is no longer applicable.
  [GitLab merge request approvals API](https://docs.gitlab.com/api/merge_request_approvals/#approve-merge-request),
  [GitLab `Suggestion` source](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/models/suggestion.rb),
  [GitLab `SuggestionSet` source](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/gitlab/suggestions/suggestion_set.rb)
- GitHub review comments retain the original and current commit/location facts;
  a comment attached to an earlier commit can become outdated when later
  changes affect its location. The GraphQL review-thread projection exposes
  `isOutdated` separately from resolution.
  [GitHub review-comments API](https://docs.github.com/en/rest/pulls/comments),
  [GitHub `PullRequestThread`](https://docs.github.com/en/graphql/reference/pulls#pullrequestthread)

### Workbench design inferences

- A target descriptor is closed and explicit:

  ```ts
  interface SuggestedChangeTargetV1 {
    readonly kind: 'project-responsibility'
    readonly projectId: string
    readonly objectId: string       // same Project identity for T06
    readonly versionKind: 'project-team-revision'
    readonly baseVersion: number
    readonly representationSchemaVersion: 1
  }
  ```

- Proposal creation itself carries the current expected Team revision. The Host
  must not produce a proposal from whatever state happens to exist after the
  Owner reviewed a form.
- A disposition command carries `expectedSuggestedChangeRevision`; the stored
  proposal carries the only authoritative target `baseVersion`. Do not let an
  accept request substitute a newer target version. These are two independent
  CAS fences.
- Effective Review status has this precedence:

  | Persisted state | Target still at base | Target advanced | Effective status |
  |---|---:|---:|---|
  | `pending` | yes | no | `pending` |
  | `deferred` | yes | no | `deferred` |
  | `pending` or `deferred` | no | yes | `stale` |
  | `accepted` | either | either | `accepted` |
  | `rejected` | either | either | `rejected` |

- A query-time stale projection improves promptly when another command commits,
  with no unaudited background status writer. The accepting transaction repeats
  the same target-version test, so a projection observed milliseconds earlier
  cannot create a time-of-check/time-of-use hole.
- Do not copy Kubernetes `force-conflicts` into human confirmation. “Force
  stale accept” would apply an intent the human did not review against the
  current state. Do not automatically use Kubernetes-style `RetryOnConflict`
  either; automatic recomputation is appropriate for some controllers, not for
  transferring human consent to a new proposal.
- A stale item may be explicitly rejected to close it. It cannot be accepted or
  deferred again. Re-proposal creates a new ID, new base version, new diff, new
  risk evaluation, and new human decision; the old record remains immutable.
- Internal Typert results should use stable domain codes such as
  `suggested-change-stale`, `suggested-change-conflict`, and `domain-conflict`.
  They need not masquerade as HTTP status codes. Diagnostics expose only safe
  current revisions and reload guidance after authorization succeeds.

## 4. Human confirmation, feedback, and risk

### Source facts

- NIST AI RMF calls for clear human/AI roles, documented human oversight,
  documented knowledge limits and intended output use, risk prioritization,
  ongoing monitoring, and incorporation of adjudicated feedback. It notes that
  documentation supports human review and accountability.
  [NIST AI RMF 1.0, Govern/Map/Measure/Manage](https://doi.org/10.6028/NIST.AI.100-1),
  [official Core view](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- AI RMF characterizes risk through context, likelihood, and magnitude; it does
  not prescribe Workbench's binary `low | high` enum.
  [NIST AI RMF Core, Map 5.1](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- NIST's GenAI Profile identifies human-AI configuration risks including
  over-reliance, recommends risk-proportionate independent evaluation, and
  recommends retaining provenance, version history, human overrides, and
  structured feedback used for go/no-go decisions.
  [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1)
- GitHub and GitLab allow an authorized writer to apply one or a batch of code
  suggestions, producing a commit. GitLab marks an applied suggestion and
  resolves its thread; rejection is represented by resolving the discussion and
  an explanatory reply is optional.
  [GitHub: incorporating feedback](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/incorporating-feedback-in-your-pull-request),
  [GitLab: suggest changes](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/)
- Temporal's official approval pattern recommends rich approval data,
  validating approver permission, audit history, duplicate safety, timestamps,
  and retaining all attempts. A Temporal Update validator can reject before an
  accepted event is written, while an accepted update later records completion
  separately.
  [Temporal approval-pattern source](https://github.com/temporalio/documentation/blob/main/docs/design-patterns/approval.mdx),
  [Temporal message handling](https://docs.temporal.io/handling-messages)

### Workbench design inferences

- NIST supports explicit, risk-proportionate human oversight but does not define
  this state machine, diff, or binary risk policy. Record that boundary in API
  comments and product copy; do not call the Workbench policy “NIST compliant.”
- Every disposition requires bounded Owner feedback text, including plain
  accept. Store the full text only in the authorized review decision row.
  Activity, audit, Outbox, receipts, diagnostics, and logs receive an allowlisted
  decision/reason code, never arbitrary feedback.
- Store `decisionMode: accepted | edited-accepted` beneath effective state
  `accepted`. This satisfies the five Review filters without erasing whether
  the Owner changed the proposal.
- `accepted` is a business commit fact. Unlike Temporal's accepted/completed
  split, Workbench does not publish accepted before the target mutation commits.
  There is no separate asynchronous review execution in T06.
- Proposal risk is Host-derived from base-to-candidate semantics, not copied
  from model confidence or browser input. Edited accept rederives an
  `appliedRisk`; the effective review risk is the maximum of proposed and
  applied risk. Editing cannot downgrade a high-risk review into a low-risk
  confirmation path.
- High-risk and low-risk cards need distinct text and accessible labels, not
  color alone. Both require individual Owner confirmation in T06. Expose a
  policy result such as `batchPolicy: forbidden | eligible-later`; do not add a
  batch mutation yet. High risk is always `forbidden`.
- GitHub/GitLab demonstrate useful suggestion review interaction, not the
  required Workbench governance lifecycle. In particular, optional rejection
  comments and thread resolution do not satisfy mandatory feedback, immutable
  provenance, or exact target CAS.

## 5. Source, evidence, provenance, and causation are different facts

### Source facts

- W3C PROV defines provenance as a record of the people, institutions,
  entities, and activities involved in producing or influencing something. It
  distinguishes entities, activities, agents, derivation, generation, usage,
  association, and attribution. A revision creates a new entity rather than
  rewriting the identity of the prior version.
  [W3C PROV-DM §§1–2](https://www.w3.org/TR/prov-dm/),
  [W3C PROV Primer §§2.2–2.5](https://www.w3.org/TR/prov-primer/)
- NIST's GenAI Profile describes provenance metadata as potentially including
  source, creator, time, versions/modifications, and other history useful for
  authenticity, integrity, and downstream decisions.
  [NIST AI 600-1, Content Provenance](https://doi.org/10.6028/NIST.AI.600-1)
- The Workbench design requires every automatic event to carry a `causationId`
  and prevents a rule from re-entering the same causal chain. T03 already puts
  a causation identifier on every formal command and audit/Outbox fact.
  [V1 design §11.9](../design/project-workbench-v1.md#119-%E8%87%AA%E5%8A%A8%E5%BE%AA%E7%8E%AF%E9%98%B2%E6%8A%A4),
  [Project contract: T03 invariants](../agent/PROJECT_CONTRACT.md#t03-command-outbox-and-audit-invariants)

### Workbench design inferences

- `source` answers **who or what produced the proposal**. For T06 Remote
  creation it is exactly `{ kind: "owner", actorId }`, derived after live Host
  authentication. Later Agent/run/rule variants must enter through trusted
  Host producer APIs and include stable versioned identities.
- `evidenceRefs` answer **what inspectable records support the proposal**. A
  producer's own explanation is not automatically evidence. T06 should support
  only immutable `workbench-audit-event` references already owned by T03:

  ```ts
  interface SuggestedChangeEvidenceRefV1 {
    readonly kind: 'workbench-audit-event'
    readonly auditEventId: string
  }
  ```

- Require 1–20 unique evidence references. At proposal creation, the Host
  authorizes and resolves every reference, verifies the audit chain, and
  requires the event to share organization and Project scope. Persist only the
  stable reference; the Review query resolves the current authorized safe
  evidence projection.
- `causationId` answers **which originating causal chain led to this proposal**.
  It does not identify the evidence or reviewer. Preserve it immutably on the
  proposal. Each review command also has its own T03 command causation metadata;
  its durable decision explicitly links the `suggestedChangeId`, so both origin
  and review action remain traceable.
- `source`, `evidenceRefs`, `causationId`, actor, and `recordedAt` must never be
  collapsed into a single free-text “provenance” field.
- T25 will add revocable evidence, claims, conflicts, and downstream stale
  propagation. T06 audit-event evidence is immutable, so target-version drift
  is the only T06 stale cause. Do not prematurely invent revoked/verified claim
  semantics or copy evidence bodies into the proposal.

## 6. Recommended T06 domain model

### Workbench design inference

The following is a logical contract, not a required SQL column-for-column
layout:

```ts
interface SuggestedChangeV1 {
  readonly id: string
  readonly revision: number
  readonly organizationId: string       // Host-derived, never transported as input
  readonly teamId: string               // Host-derived, never transported as input
  readonly projectId: string
  readonly source: {
    readonly kind: 'owner'
    readonly actorId: string
  }
  readonly target: SuggestedChangeTargetV1
  readonly proposedCandidate: ProjectResponsibilityCandidateV1
  readonly proposedDiff: ProjectResponsibilityReviewDiffV1
  readonly evidenceRefs: readonly SuggestedChangeEvidenceRefV1[]
  readonly risk: {
    readonly level: 'low' | 'high'
    readonly reasonCodes: readonly ProjectResponsibilityRiskReasonV1[]
    readonly policyVersion: 'project-responsibility-v1'
  }
  readonly originCausationId: string
  readonly state: 'pending' | 'accepted' | 'rejected' | 'deferred'
  readonly createdAt: string
  readonly updatedAt: string
}

interface ProjectResponsibilityReviewValueV1 {
  readonly accountableMemberId: string | null
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
}

interface ProjectResponsibilityCandidateV1 {
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
}

interface ProjectResponsibilityReviewDiffV1 {
  readonly kind: 'project-responsibility.diff'
  readonly schemaVersion: 1
  readonly before: ProjectResponsibilityReviewValueV1
  readonly after: ProjectResponsibilityCandidateV1
  readonly changedFields: readonly (
    'accountable' | 'contributors' | 'human-sponsor'
  )[]
  readonly digest: `sha256:${string}`
}

interface SuggestedChangeDecisionV1 {
  readonly id: string
  readonly sequence: number
  readonly suggestedChangeId: string
  readonly resultingSuggestionRevision: number
  readonly mode: 'accepted' | 'edited-accepted' | 'rejected' | 'deferred'
  readonly actor: { readonly kind: 'owner'; readonly id: string }
  readonly feedback: string
  readonly commandId: string
  readonly causationId: string
  readonly auditEventId: string
  readonly outboxId: string
  readonly appliedCandidate: ProjectResponsibilityCandidateV1 | null
  readonly appliedDiff: ProjectResponsibilityReviewDiffV1 | null
  readonly appliedTeamRevision: number | null
  readonly appliedResponsibilityRevision: number | null
  readonly decidedAt: string
}
```

Additional invariants:

1. IDs, time, source actor, scope, risk, diff, digest, audit vocabulary, and
   target version are Host-derived.
2. Proposal envelope and decision rows are append-only. Only the small
   suggestion head (`revision`, persisted state, updated time) may advance
   under CAS and a closed state-transition rule.
3. A proposal is non-empty and changes at least one closed semantic field.
4. Candidate Contributor IDs are canonicalized before hashing/diffing.
5. Evidence refs are unique and ordered lexically by immutable audit-event ID
   before hashing or persistence; risk-reason codes also use their closed
   canonical order. Both are bounded. Changed fields and serialized candidate
   size are bounded.
6. An edited candidate may change only the candidate values. It cannot change
   source, target, Project, base version, schema, evidence, original risk,
   or origin causation.
7. T06 does not add a supersession carrier. Renewed intent is a separate new
   proposal; the stale predecessor remains visible and immutable.
8. Decision revisions are contiguous from 2, the head revision equals one plus
   the decision count, and the head state/time match the latest decision.
9. The repository never hard-deletes proposals or decisions.

## 7. Lifecycle and command behavior

### Workbench design inference

| Current effective status | Command | Result |
|---|---|---|
| `pending` | accept | target commit + `accepted` |
| `pending` | edit and accept | edited target commit + `accepted`/`edited-accepted` |
| `pending` | reject | `rejected` |
| `pending` | defer | `deferred` |
| `deferred` | accept/edit and accept | target commit + `accepted` if base is unchanged |
| `deferred` | reject | `rejected` |
| `deferred` | defer again | state conflict; no duplicate defer history |
| `stale` | reject | `rejected`, target unchanged |
| `stale` | accept/edit/defer | `suggested-change-stale`, no writes |
| `accepted` or `rejected` | any new disposition | terminal conflict, no writes |

Every proposal/disposition command carries a caller-stable idempotency key,
command causation ID, exact expected aggregate revision, and its closed reason
code. Actor and scope are absent from Client input.

Acceptance order is precise:

1. Let the generated Typert carrier reject malformed transport values, then
   establish the live Host operation and require `workbench.review.decide`.
   Normalize the bounded domain request only inside that authorized Scenario.
   Accept and edit-and-accept additionally require
   `workbench.project.responsibility.write`; the two grants must resolve to the
   identical Owner/organization/team scope.
2. Enter `BEGIN IMMEDIATE` only after those asynchronous authorization checks;
   no `await` or authorization callback runs inside the transaction.
3. Look up the immutable receipt before lifecycle or version validation. Exact
   actor/key/intent replay returns the stored result even if the suggestion or
   target has advanced since the original success. Key reuse for another
   intent is an idempotency conflict.
4. Load the suggestion and validate its own expected revision, Project/scope,
   effective state, target adapter, and representation schema.
5. Load the current Team head and require exact equality with the immutable
   target base version. A mismatch returns `suggested-change-stale` and writes
   nothing.
6. Reconstruct the base representation from immutable Responsibility history,
   rederive and verify the proposal diff/digest/risk, resolve the immutable
   EvidenceRefs, and select the original or edited candidate through the closed
   target schema.
7. Re-run the same current member, active-status, Accountable, Contributor, and
   Human Sponsor invariants used by the normal responsibility command. The
   already-authorized live principal remains the command actor; stored proposal
   source is never treated as a grant.
8. Append the next Responsibility version, append the Review decision, advance
   the suggestion head, and insert exactly one redacted Outbox intent, one
   hash-chained audit event/head advance, and one replay receipt.
9. Commit, then publish detached whole-value projections. Observer failure
   cannot roll back the committed decision.

Reject and defer use the same authorization, receipt-first replay, suggestion
CAS, audit, Outbox, and receipt protocol but never mutate the target. Reject is
allowed on a stale unresolved item; defer is not.

Caller cancellation owns work before the synchronous commit begins. Once the
transaction commits, cancellation cannot turn accepted into failure or undo
the target. Disposal closes admission, drains admitted commands, unregisters
Remote/Slot contributions, and only then closes SQLite.

## 8. Ledger, privacy, and integrity

### Workbench design inference

- Add allowlisted audit actions and reason/summary codes for proposal,
  acceptance, edited acceptance, rejection, and deferral. Activity may expose
  suggestion ID, safe Project scope, target kind/version, effective review
  status, risk level, actor, time, causation ID, and correlation IDs.
- Never copy the semantic candidate, diff values, evidence contents, member
  IDs in responsibility fields, Owner feedback, display names, Feishu/external
  identity values, request body, or raw failure into audit, Activity, Outbox
  payload, immutable receipt, logs, or diagnostics.
- A safe receipt contains only suggestion ID/revision, resulting status,
  decision mode, target kind/applied target version where applicable, risk
  level, and command/audit/Outbox IDs.
- The acceptance Outbox/audit object is the `suggested-change` and its new
  revision. Safe summary codes record that a target adapter committed and the
  resulting target version. The append-only decision row links the exact
  accepted candidate to that ledger fact, so one formal command still retains
  T03's one-Outbox/one-audit/one-receipt invariant.
- Integrity verification must cover proposal canonical bytes/digest, source,
  target/base/schema, evidence refs, risk policy result, causation, decision
  sequence, suggestion-head linkage, accepted candidate/diff, resulting
  target version, and correlations among receipt, audit, and Outbox.
- SQL constraints/triggers should reject mutation/deletion of proposal and
  decision facts, duplicate evidence, duplicate decision sequence, invalid
  state/revision transitions, and accepted decisions without one matching
  responsibility version.
- A correlated edit of proposal JSON, diff, risk, receipt, audit, and Outbox
  must still fail integrity because the values are rederived from immutable
  target history and included in the versioned hash-chain/receipt envelope.
- Treat the existing audit chain as tamper evidence, not non-repudiation. T44
  owns external backup checkpoints.

## 9. Review Center projection and Client behavior

### Workbench design inference

Expose one authorized, bounded query that filters at least by Project,
effective status, and risk. Compute effective stale status on the Host by
joining each unresolved proposal to its current target head. Use a stable
cursor such as `(createdAt, suggestedChangeId)`; do not fetch everything and
filter in React.

Each detached Review card includes:

- source label and creation time;
- target kind, base version, and safe current version;
- effective status and persisted state where useful;
- proposed field-by-field before/after diff;
- evidence references with resolvable safe Activity metadata;
- proposed/effective risk, risk reason labels, and batch policy;
- prior decisions and mandatory feedback; and
- only the currently authorized actions.

Client requirements:

- distinguish loading, ready-empty, ready-value, disconnected/stale transport,
  mutation pending, suggestion stale, suggestion revision conflict, target
  domain conflict, and transport failure;
- keep the last Host projection while disconnected and label it stale; do not
  confuse transport staleness with a domain item's `stale` effective status;
- fence rapid duplicate disposition before the next React render;
- retain feedback and edited candidate across a recoverable revision/domain
  conflict, but never auto-submit against a refreshed target;
- preserve the exact idempotency envelope only for replay of the exact same
  intent after ambiguous transport loss;
- reset protected drafts on Project switch, logout, expiry, or Fiber disposal;
- make diff rows, status, risk, evidence, and feedback accessible by keyboard
  and screen reader; risk cannot rely on red/amber color alone;
- require a deliberate confirmation step for high risk and state why batch is
  unavailable; T06 has no multi-select acceptance action; and
- after HMR or Host restart, explicitly reopening the Project re-queries the
  same durable Review projection rather than restoring browser authority.

## 10. Hidden acceptance matrix

The following cases are part of the T06 design, even when the ticket's visible
checklist does not spell them out.

| Area | Required scenario | Observable assertion |
|---|---|---|
| Proposal schema | unknown source/target/risk/diff/digest fields | generated runtime codec rejects; nothing persists |
| Authority | browser supplies actor/org/team/source/risk/diff | field is rejected, not stripped or trusted |
| Proposal CAS | Team changes after form load but before propose | explicit target revision conflict; no proposal/ledger rows |
| No-op | candidate equals base after normalization | stable no-op rejection; no proposal |
| Diff authority | caller supplies before/after/changed fields/digest | generated carrier rejects Host-owned fields |
| Diff integrity | before/after/changed fields/digest do not match immutable target history and candidate | restart/integrity verification fails closed |
| Evidence | empty, duplicate, cross-Project, missing, or unauthorized audit ref | proposal rejected atomically |
| Evidence | audit chain tampered before proposal | proposal rejected; integrity result identifies failure safely |
| Risk | Accountable or Sponsor changes | Host projects `high`, individual-only |
| Risk | only canonical Contributor set changes | Host projects `low`, still individually confirmed in T06 |
| Risk | caller attempts low override | runtime carrier rejects authority field |
| Filter | each persisted state plus unresolved version drift | Host filters exact effective status including `stale` |
| Stale projection | direct Team mutation after pending/deferred proposal | next query shows `stale` without a status-write audit event |
| Stale accept | target changes after Review query, before accept transaction | typed stale result; no target/review/ledger writes |
| Stale edit | Owner edits a stale proposal to match current state | still stale; cannot substitute new base version |
| Re-proposal | Owner wants a stale intent on current state | independent new ID/base/diff/risk; old item retained |
| Invariant recheck | referenced member deactivated or Sponsor rule invalidated | acceptance fails closed even when the stored typed diff is valid |
| Live auth | session expires after Review query | accept denied before version details or mutation |
| Review CAS | two tabs decide the same revision with different keys | one commits; the other gets terminal/revision conflict |
| Receipt-first replay | successful accept response is lost; target later advances | exact same key/intent returns stored success, no duplicate rows |
| Idempotency misuse | same actor/key with changed feedback/edit/mode | explicit idempotency conflict |
| Accepted semantics | target write succeeds | Review becomes accepted in the same commit, never earlier |
| Fault injection | failure after target insert, decision insert, Outbox, audit, or receipt | transaction rolls back every T06/target row |
| Edited accept | Owner changes candidate | original proposal unchanged; applied candidate/diff and feedback retained |
| Edited risk | high proposal edited to contributor-only | effective risk remains high; no downgrade path |
| Reject | pending/deferred/stale item rejected | target unchanged; mandatory feedback and one ledger fact retained |
| Defer | pending item deferred then accepted without target drift | both append-only decisions retained; one target commit |
| Deferred drift | target advances after defer | effective stale; accept forbidden |
| Terminal | accepted/rejected item receives another decision | stable terminal conflict; no rows added |
| Cancellation | abort before admission/commit | no rows; after commit, stored result remains replayable |
| Contention | concurrent proposal/Team/review writers | exact CAS outcome, no partial or duplicate responsibility version |
| Privacy | synthetic feedback/member/evidence text in all paths | absent from Activity, Outbox, receipt, logs, diagnostics, errors |
| Restart | propose/defer/accept/reject then reopen database | identical proposals, decisions, filters, risk, and effective statuses |
| Tamper | mutate/delete/reorder proposal or decision, or mismatch accepted target | integrity check and restart fail closed |
| Client | double click, reconnect, Project switch, expiry | one command; safe retry draft retained only where authorized |
| Lifecycle | dispose during admitted command and remount | drain/quiet close; no late publish; durable result appears once |
| Packaging | generated faces, built Client, real tarball consumer | Review methods/codecs/UI work without source alias or Host code in browser |
| Browser | authenticated Owner reviews low and high items and restarts Host | visible diff/evidence/risk/feedback; same durable result after restart |

## 11. Minimal T06 delivery boundary

### In scope

- one immutable `SuggestedChange` envelope and append-only decision history;
- one typed target adapter: `project-responsibility.replace`;
- Owner-sourced proposal creation with Host-derived source/diff/risk;
- immutable T03 audit-event evidence references;
- pending/accepted/rejected/deferred persistence and derived stale projection;
- accept, edited accept, reject, and defer with mandatory feedback;
- exact proposal and target CAS, receipt-first replay, normal responsibility
  invariants, and one atomic target/review/Outbox/audit/receipt commit;
- low/high policy classification and a non-operational future batch-policy seam;
- authorized Review Center filters, detail, Activity vocabulary, integrity,
  restart, Client lifecycle, real Loader/Profile, browser, and packed-artifact
  evidence.

### Explicitly out of scope

- AI/model/subagent generation, Intelligence Runs, Profile feedback learning,
  or automatic rule changes;
- Risk, Topic, Decision, Deliverable, PlanBaseline, document/file, permission,
  Feishu, Webhook, or external-action review adapters;
- batch mutation, auto-accept, force accept, automatic rebase, three-way merge,
  field ownership, or last-write-wins;
- general user-authored JSON Patch, arbitrary JSON Pointer, or a generic object
  mutation endpoint;
- revocable EvidenceRef/MemoryClaim semantics and downstream stale propagation;
- scheduler-driven defer reminders, notifications, multiple reviewers,
  separation-of-duties policy, or Agent self-review;
- custom DSH Session events or Harness core changes.

## 12. Decision summary

1. **One proposal, one target, one exact base.** A proposal is a versioned
   semantic command candidate, not a free-form patch or batch.
2. **Diff is strict and derived.** Persist a closed typed
   `before / after / changedFields / digest` value plus the target
   representation schema version; reconstruct the base and rederive it for
   integrity.
3. **Stale is an effective unresolved state.** It never authorizes overwrite or
   destroys accepted/rejected history. Rebase means a new proposal.
4. **Human consent is bound to what was reviewed.** Accept and edited accept
   reauthorize, recheck two CAS fences, and rerun current business invariants.
5. **Accepted means committed.** Target mutation and review disposition share
   one synchronous SQLite transaction and one T03 ledger unit.
6. **Original and applied intent both survive.** Edited accept appends the
   Owner's applied candidate/diff and feedback without changing the producer's
   proposal.
7. **Risk is policy, not confidence.** Host-derived low/high classification is
   versioned; high risk remains individual-only and cannot be edited downward.
8. **Source, evidence, and causation stay separate.** T06 uses Host-derived
   Owner source and immutable Project-scoped audit references; later producers
   extend the closed seam.
9. **No content leakage into the generic ledger.** Full proposal, evidence,
   member-role values, and feedback stay in authorized Review storage; audit,
   Outbox, Activity, receipt, diagnostics, and logs remain allowlisted.
10. **The first adapter is deliberately narrow.** Project Responsibility gives
    T06 a real low/high, stale-safe acceptance path while avoiding premature
    implementations of later V1 domains.

## Primary source index

| Subject | Primary source | Design use |
|---|---|---|
| JSON location | [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901.html) | pointer grammar, escaping, error semantics |
| Ordered JSON differences | [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902.html) | operation ordering, `test`, whole-patch failure |
| HTTP patch safety | [RFC 5789](https://www.rfc-editor.org/rfc/rfc5789.html) | known base, atomic application, 409/412 distinction |
| Merge-patch limits | [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396.html) | null and array limitations; not selected as canonical diff |
| Conditional update | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) | strong validator and lost-update model |
| Human AI oversight | [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1) | documented oversight, feedback, contextual risk |
| GenAI provenance/override | [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) | over-reliance, provenance, versioning, human override |
| Provenance vocabulary | [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) | source/entity/activity/version separation |
| Review suggestions | [GitHub](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/incorporating-feedback-in-your-pull-request), [GitLab](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/) | visible diff, authorized apply, low-risk batch precedent |
| Recheck applicability | [GitLab `Suggestion`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/models/suggestion.rb), [`SuggestionSet`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/gitlab/suggestions/suggestion_set.rb), [`ApplyService`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/services/suggestions/apply_service.rb) | current-content/HEAD validation and all-or-nothing batch model |
| Aggregate CAS | [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources) | opaque server version and explicit stale conflict |
| Validation vs completion | [Temporal message handling](https://docs.temporal.io/handling-messages), [approval pattern source](https://github.com/temporalio/documentation/blob/main/docs/design-patterns/approval.mdx) | validate current state, deduplicate, retain rich review history |
