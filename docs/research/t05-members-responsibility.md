# T05 research: project members, responsibility, identity, and deactivation

Research date: 2026-08-31

Ticket: [#6 — T05 统一成员名册与责任分配](https://github.com/benz-ai-x/dsh-project-workbench/issues/6)

Runtime in scope: the Workbench Host, its generated Remote contract, and the
Workbench-owned SQLite repository. Feishu synchronization, Agent execution,
member login/claiming, Review Center, and later responsibility-bearing domain
objects are not part of T05.

This note uses primary sources only: the repository's approved requirements,
government and intergovernmental standards/guidance, first-party Feishu/Lark
documentation and source, IETF/W3C standards, and SQLite documentation. Every
section separates **source facts** from **Workbench design inferences**. The
external sources inform the design; none of them defines Workbench's domain.

## Executive recommendation

**Workbench design inference.** Model a `ProjectMember` as a durable,
Project-scoped responsibility identity with a generated Workbench ID, a closed
`human | agent` kind, an `active | inactive` eligibility state, and exactly one
creation-time identity variant:

- a human with an app-scoped Feishu identity reference;
- a human represented by bounded external-contact details; or
- an Agent represented only by its Workbench member identity in T05.

Do not accept a dangling `agentProfileVersionId` before Agent Profiles exist,
and do not treat a declared Feishu `open_id` as remotely verified. Preserve room
for a later verified connector binding and a later immutable Agent Profile
binding without making either one a T05 dependency.

Give the current Project one responsibility projection with exactly one
`accountableMemberId`, zero or more distinct `contributorMemberIds`, and an
optional `humanSponsorMemberId`. Require an active human Sponsor whenever the
Accountable member is an Agent. The approved V1 design also requires a tracked
human Sponsor for an external-contact human; apply that same rule when such a
member becomes Accountable. Define Accountable as **unique operational
ownership inside Workbench**, not legal or ultimate human responsibility.

Use status transition rather than deletion. An inactive member cannot receive a
new responsibility or qualify as a Feishu assignee, but every historic object,
attestation, and audit record continues to refer to the same stable member ID.
Reject deactivation while the member holds a current responsibility; the Owner
must first reassign that responsibility in a separate, audited command. There
is no member-delete API in T05, and storage rejects deletion.

Make member creation, status change, and responsibility replacement formal T03
commands: authorize on the Host, normalize and validate before commit, carry
caller-stable idempotency/causation/reason fields, use exact optimistic
revisions, and atomically commit the domain change, one pending Outbox intent,
one redacted audit event/hash-head advance, and one replay receipt. The browser
only consumes detached projections.

## 1. Ticket boundary and current Workbench constraints

### Source facts

- Ticket #6 requires the Owner to add human and Agent `ProjectMember` records,
  bind humans to a Feishu `open_id` or external contact, enforce one
  Accountable and multiple Contributors, require a human Sponsor for an
  Agent Accountable, prevent a human without Feishu identity from being treated
  as a formal Feishu assignee, and preserve historical attribution after
  deactivation.
  [Ticket #6](https://github.com/benz-ai-x/dsh-project-workbench/issues/6)
- The parent design defines one unified `ProjectMember` vocabulary, allows
  non-login humans, distinguishes Feishu-bound and external humans, and says an
  Agent may be Accountable only with a human Sponsor. It also says an external
  contact without Feishu identity needs a traceable human Sponsor.
  [V1 design §4.2–4.3](../design/project-workbench-v1.md#42-%E7%BB%9F%E4%B8%80%E6%88%90%E5%91%98%E8%BA%AB%E4%BB%BD)
- The implementation contract keeps actor, organization, team, authorization,
  persistence truth, and side effects in the Host. T05 expressly excludes
  Feishu synchronization beyond identity metadata, Review Center, Agent Team,
  files, risks, topics, Deliverables, and AI analysis.
  [Project contract](../agent/PROJECT_CONTRACT.md#ticket-boundary)
- T03 established receipt-first idempotency, optimistic concurrency, one
  atomic domain/Outbox/audit/receipt transaction, server-derived scope and
  actor, bounded audit vocabulary, and safe Activity projections. T04 added
  Project-scoped commands and durable Project reads.
  [Project contract: T03 invariants](../agent/PROJECT_CONTRACT.md#t03-command-outbox-and-audit-invariants),
  [T04 invariants](../agent/PROJECT_CONTRACT.md#t04-project-template-goal-outcome-and-project-invariants)

### Workbench design inferences

- T05 extends the existing `WorkbenchScenario` and `WorkbenchRepository`; it
  must not add another authority seam, database, custom DSH Session event, or
  best-effort audit path.
- `ProjectMember` is not a Workbench login account. V1 still has exactly one
  authenticated Owner. A member record is a responsibility identity and roster
  entry only; login invitations and claiming are later work.
- A Feishu identity in T05 is metadata, not a connector result. T07 owns Bot/User
  connection verification, and T08 owns authoritative Feishu task assignment.
- Agent membership is likewise descriptive in T05. T33 owns versioned Agent
  Profiles and executable team behavior. Creating an Agent member now grants no
  model, tools, budget, permissions, or execution capability.
- The only existing governed work aggregate suitable for the first
  responsibility projection is `Project`. Expose a Project responsibility now,
  while keeping the pure responsibility validator reusable by later
  Deliverable, Risk, Mission, and Feishu-task adapters. Do not expose a generic,
  browser-supplied `objectType` before those aggregates and authorization rules
  exist.

## 2. Accountable and Contributors: use a small RACI-derived vocabulary

### Source facts

- A U.S. Department of Education implementation-planning guide defines exactly
  one Accountable person per activity while allowing multiple Responsible,
  Consulted, and Informed participants. It describes Accountable as owning the
  quality/end result and final approval.
  [Department of Education RACI planning tool, Appendix B](https://www.ed.gov/sites/ed/files/2020/10/implementation_planning_tool.pdf)
- The IRS Engineering Planning Process likewise says many roles may participate
  in a task while only one is Accountable for the result.
  [IRS IRM 2.120.6, RACI definition](https://www.irs.gov/irm/part2/irm_02-120-006)
- The same Department of Education guide permits one person to hold more than
  one RACI code for an activity. RACI therefore does not itself require
  Accountable and Responsible sets to be disjoint.
  [Department of Education RACI planning tool, Appendix B](https://www.ed.gov/sites/ed/files/2020/10/implementation_planning_tool.pdf)

### Workbench design inferences

- Workbench is **not** implementing full RACI. Its closed V1 responsibility
  vocabulary is Accountable, Contributor, and Human Sponsor. `Contributor`
  must not be presented as a standards-defined synonym for RACI Responsible.
- Store Accountable as one required scalar, not a list. This makes the invariant
  structural in both TypeScript and SQL. Store Contributors as a set with a
  uniqueness constraint; zero Contributors is valid.
- For an unambiguous compact UI, reject the Accountable member appearing again
  in the Contributor set. This is a Workbench policy choice, not a RACI
  requirement: being Accountable does not imply the person did no work.
- Sponsor is oversight, escalation, and formal human acceptance—not a second
  Accountable. Consequently the UI should show these roles separately and must
  not render “two owners.” A Sponsor may also be a Contributor.
- The assignment validator should enforce:

  1. exactly one Accountable member;
  2. every referenced member belongs to the same Project and is active;
  3. Contributor IDs are unique and exclude Accountable;
  4. Sponsor, when present, is active and human;
  5. Agent Accountable implies Sponsor is present;
  6. external-contact human Accountable implies Sponsor is present; and
  7. Sponsor differs from a human Accountable when sponsorship is mandatory.

## 3. Agent operational ownership still needs named human oversight

### Source facts

- NIST AI RMF 1.0 calls for documented, clear roles and responsibilities,
  accountability structures, explicit differentiation of roles in human-AI
  configurations, and defined human-oversight processes. It assigns leadership
  responsibility for AI risk decisions and calls for safe deactivation when AI
  outcomes are inconsistent with intended use.
  [NIST AI RMF Core, Govern 2 and Govern 3.2](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- UNESCO's adopted Recommendation on the Ethics of AI says an AI system cannot
  replace ultimate human responsibility and accountability, and that ethical
  responsibility and liability for AI-based decisions/actions should remain
  attributable to AI actors according to their lifecycle roles.
  [UNESCO Recommendation, paragraphs 36 and 42](https://unesdoc.unesco.org/in/rest/annotationSVC/DownloadWatermarkedAttachment/attach_import_fa6f4b4a-9298-4a92-ba07-8108ac513153?_=380455eng.pdf&from=1&to=21)
- OECD's AI Principles call for context-appropriate human agency and oversight,
  traceability, and accountability by AI actors based on their roles and ability
  to act.
  [OECD AI Principles](https://www.oecd.org/en/topics/ai-principles.html)
- EU AI Act Article 14 requires effective natural-person oversight for
  **high-risk AI systems**, with the ability to understand limitations, monitor,
  disregard/override/reverse outputs, and intervene. Its legal scope must not be
  generalized to every Workbench use case.
  [EU Regulation 2024/1689, Article 14](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng)

### Workbench design inferences

- None of these sources prescribes a database field named `humanSponsorMemberId`
  or says that ordinary project software must use Workbench's exact rule. The
  mandatory Sponsor is a Workbench governance decision supported by the broader
  principles of explicit human-AI roles, human oversight, traceability, and
  ultimate human responsibility.
- Preserve the approved product behavior that an Agent can be the unique
  **operational** Accountable. The Sponsor is the active human who can extend or
  refuse authority, receive escalation, stop the work, and perform formal
  acceptance. Product copy and API comments should explicitly distinguish this
  operational ownership from legal/business accountability.
- Sponsor must be a concrete active human `ProjectMember`, not the implicit word
  “Owner,” a display name, an email address, or a browser-supplied principal.
  This keeps the relationship inspectable and lets later attestations reference
  a stable identity.
- Deactivating an Agent and deactivating its Sponsor are lifecycle events. Both
  block new assignments. A current assignment must be transferred before either
  member can be deactivated; this is the smallest deterministic safeguard that
  avoids an unsupervised live responsibility.

## 4. Feishu `open_id` is a scoped external reference, not the member primary key

### Source facts

- Feishu's first-party ID documentation says `open_id` identifies a user inside
  one application and the same human has different Open IDs in different apps.
  It contrasts this with developer-scoped `union_id` and tenant-scoped
  `user_id`.
  [Feishu user ID types](https://www.feishu.cn/content/721793695931)
- Feishu Open Platform documents the application/API procedures for obtaining a
  user's Open ID.
  [Feishu Open Platform: obtain Open ID](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-obtain-openid)
- The first-party Lark CLI task implementation adds and removes task assignees
  through the Task v2 member endpoints while explicitly setting
  `user_id_type=open_id`; its member body uses the role `assignee`.
  [Lark CLI Task assignment source](https://github.com/larksuite/cli/blob/main/shortcuts/task/task_assign.go),
  [generated package view](https://pkg.go.dev/github.com/larksuite/cli/shortcuts/task)
- The first-party task-list member documentation likewise accepts user
  `open_id` values such as `ou_...`.
  [Lark CLI task-list member documentation](https://github.com/larksuite/cli/blob/main/skills/lark-task/references/lark-task-tasklist-members.md)

### Workbench design inferences

- Never use raw `open_id` as `ProjectMember.id`. Generate an internal immutable
  member ID and store Feishu identity as a typed external reference. A stable
  internal ID prevents application changes, connector replacement, loss of
  Feishu access, or future identity claiming from rewriting historical links.
- A Feishu reference must include its scope, at minimum `appId + openId`. The
  database uniqueness key is Project + Feishu application + `open_id`, not raw
  `open_id` alone. Keep room for `tenantKey`/connector identity when T07 makes
  the single-organization binding concrete.
- Use a closed discriminated input rather than several unrelated nullable
  fields:

```ts
interface FeishuHumanDraft {
  readonly kind: 'human'
  readonly displayName: string
  readonly identity: {
    readonly type: 'feishu'
    readonly appId: string
    readonly openId: string
  }
}

interface ExternalHumanDraft {
  readonly kind: 'human'
  readonly displayName: string
  readonly identity: {
    readonly type: 'external'
    readonly contact: {
      readonly method: 'email' | 'phone' | 'other'
      readonly value: string
      readonly organization?: string
    }
  }
}

interface AgentMemberDraft {
  readonly kind: 'agent'
  readonly displayName: string
}
```

- T05 validates these as bounded, normalized, control-free opaque values but
  does not call Feishu. A projection should report identity presence honestly,
  for example `feishuIdentityState: 'declared'`; “verified” belongs to T07.
- Derive Feishu assignee eligibility rather than persisting another mutable
  truth:

```text
identifier-present = active human AND identity.type == feishu
not-eligible       = inactive OR agent OR external-contact human
```

  Even `identifier-present` means only that T05 has a correctly typed identifier.
  T08 must still verify connector identity, tenant/application scope, API
  permission, resource ACL, and the authoritative remote result before claiming
  an actual Feishu assignment.
- An external contact remains a real human member and may hold Workbench
  responsibility, but no later adapter may translate an email/phone/display
  name into a formal Feishu assignee silently. Identity resolution must be an
  explicit, reviewed binding that preserves the same internal member ID.
- Contact values and `open_id` are business/identity data. They may appear in an
  authorized roster projection but never in audit summaries, Outbox diagnostics,
  logs, conflict messages, or Activity.

## 5. Inactive is a lifecycle state; it is not deletion or anonymized history

### Source facts

- SCIM's standard User schema defines `active` as administrative status. Its
  typical example treats false as a suspended account, distinct from resource
  deletion.
  [RFC 7643 §4.1.2, `active`](https://www.rfc-editor.org/rfc/rfc7643.html#section-4.1.2)
- SCIM separately defines DELETE as resource removal: the resource is omitted
  from future query results and later retrieval returns not found. This is
  observably different from an inactive retained resource.
  [RFC 7644 §3.6](https://www.rfc-editor.org/rfc/rfc7644.html#section-3.6)
- W3C PROV models an Agent as something bearing responsibility and supports
  association/attribution between Agents, Activities, and Entities, including a
  role attached to an association.
  [W3C PROV-O Recommendation](https://www.w3.org/TR/2013/REC-prov-o-20130430/)
- NIST SP 800-53 AU-3 requires audit records to establish the identity of
  associated individuals, subjects, or objects/entities. AU-11 calls for audit
  retention sufficient for after-the-fact investigation and organizational
  retention requirements.
  [NIST SP 800-53 Rev. 5, AU-3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf),
  [NIST SP 800-53 Rev. 5.1, AU-11](https://csrc.nist.gov/CSRC/media/Projects/risk-management/800-53%20Downloads/800-53r5/SP_800-53_v5_1-derived-OSCAL.pdf)

### Workbench design inferences

- `inactive` means “ineligible for new/current operational responsibility and
  external assignment.” It does not mean deleted, unknown, or erased.
- Do not cascade member status into historical records. Tasks, responsibility
  versions, attestations, Decisions, Missions, and audit events retain their
  original internal `memberId`. Roster and history projections may visibly mark
  that referenced member inactive.
- T05 should offer `setProjectMemberStatus`, not `deleteProjectMember`. Keep the
  state machine reversible (`active -> inactive -> active`) under revision/CAS
  and audit. Reactivation restores eligibility only; it does not silently
  restore old responsibilities.
- Reject deactivation with `member-in-use` when the member is the current
  Accountable, Sponsor, or Contributor. The Owner first submits an atomic
  responsibility replacement, then retries deactivation. This produces two
  explicit audit facts and avoids hidden mutation of assignment history.
- Retention is not a claim that all personal data must legally be kept forever.
  T05 has no erasure/anonymization policy. If such a policy is later required,
  it needs a separate design that reconciles privacy obligations with stable
  attribution; member deletion must not be smuggled into deactivation.

## 6. Recommended public domain and command surface

### Workbench design inference

Use a closed browser-safe projection:

```ts
type ProjectMemberIdentityProjection =
  | {
      readonly type: 'feishu'
      readonly appId: string
      readonly openId: string
      readonly state: 'declared'
    }
  | {
      readonly type: 'external'
      readonly contact: {
        readonly method: 'email' | 'phone' | 'other'
        readonly value: string
        readonly organization?: string
      }
    }
  | { readonly type: 'workbench-agent' }

interface ProjectMemberProjection {
  readonly memberId: string
  readonly projectId: string
  readonly kind: 'human' | 'agent'
  readonly displayName: string
  readonly status: 'active' | 'inactive'
  readonly revision: number
  readonly identity: ProjectMemberIdentityProjection
  readonly feishuAssigneeEligibility:
    | 'identifier-present'
    | 'external-contact'
    | 'agent-not-assignable'
    | 'inactive'
  readonly createdAt: string
  readonly updatedAt: string
}

interface ProjectResponsibilityProjection {
  readonly projectId: string
  readonly revision: number
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly updatedAt: string
}

interface ProjectRosterProjection {
  readonly projectId: string
  readonly catalogRevision: number
  readonly members: readonly ProjectMemberProjection[]
  readonly responsibility: ProjectResponsibilityProjection | null
}
```

The public Remote surface should remain exact and small:

| Method | Purpose | Concurrency precondition |
|---|---|---|
| `projectRoster` | Read one authorized Project's detached roster and current responsibility | none |
| `addProjectMember` | Add one human/Agent member | `expectedCatalogRevision` |
| `setProjectMemberStatus` | Activate/deactivate one existing member | `expectedMemberRevision` and catalog revision |
| `setProjectResponsibility` | Atomically replace Accountable, Contributors, and Sponsor | `expectedRevision: number | null` |

Every command additionally carries `idempotencyKey`, `causationId`, and one
allowlisted reason. Browser input supplies `projectId` and bounded domain data;
Host authorization supplies actor, organization, and team. Generated IDs,
timestamps, audit vocabulary, and Outbox facts remain Host-only.

Prefer whole responsibility replacement over separate “add contributor,”
“change owner,” and “set sponsor” commands. The complete tuple is the invariant,
so one CAS/transaction prevents an intermediate Agent-without-Sponsor state and
makes retry intent canonical.

Suggested closed conflict vocabulary:

- `member-catalog-revision-conflict`;
- `member-revision-conflict`;
- `responsibility-revision-conflict`;
- `duplicate-feishu-identity`;
- `member-not-found` / `member-not-in-project`;
- `member-inactive`;
- `member-in-use`;
- `accountable-also-contributor`;
- `human-sponsor-required`;
- `human-sponsor-invalid`; and
- the existing `idempotency-conflict`.

Malformed text, identity variants, duplicate IDs, or foreign Project IDs are
boundary validation errors, not optimistic-concurrency conflicts. Conflict
messages must use internal IDs and bounded codes, never contact values or raw
request JSON.

## 7. Recommended SQLite shape and transaction invariants

### Source facts

- SQLite foreign keys enforce “referenced row exists” relations and, absent a
  cascading action, reject deletion that would orphan referencing rows. They
  must be enabled on each connection.
  [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
- SQLite unique partial indexes enforce uniqueness only across rows satisfying
  a predicate. The official example uses one to enforce a single leader per
  team.
  [SQLite unique partial indexes](https://www.sqlite.org/partialindex.html#unique_partial_indexes)
- SQLite row `CHECK` constraints cannot contain subqueries. Cross-row rules such
  as “the Sponsor member is active and human” therefore require transactional
  domain validation and, where desired, defensive triggers.
  [SQLite `CREATE TABLE`, CHECK constraints](https://www.sqlite.org/lang_createtable.html#check_constraints)

### Workbench design inferences

Keep the provider-neutral Repository in terms of domain mutations. A minimal
SQLite implementation uses:

```text
workbench_project_member
  id, organization_id, team_id, project_id,
  kind, display_name, state, identity_type,
  feishu_app_id?, feishu_open_id?,
  external_contact_method?, external_contact_value?, external_organization?,
  revision, created_at, updated_at

workbench_project_responsibility
  organization_id, team_id, project_id,
  accountable_member_id, human_sponsor_member_id?,
  revision, updated_at

workbench_project_responsibility_contributor
  organization_id, team_id, project_id, member_id, ordinal
```

Use composite foreign keys that include Project/scope so a member from another
Project or organization cannot be linked accidentally. Use `STRICT`, `NOT NULL`,
closed-value `CHECK`s, and a cross-field identity-shape `CHECK`:

- human/Feishu rows have only app/open IDs;
- human/external rows have only contact fields;
- Agent rows have neither external identity variant; and
- state is only `active | inactive`.

Add a unique partial index on
`(organization_id, project_id, feishu_app_id, feishu_open_id)` for Feishu human
rows. Do **not** automatically merge external contacts by normalized email or
phone: shared addresses and changed contact channels make that an unsafe
identity decision.

Store Accountable and Sponsor as scalar columns, Contributors in a keyed child
table, and order Contributors deterministically for stable canonical requests
and projections. A before-delete trigger should reject member deletion even if
no current foreign key happens to reference the row yet. Future task,
attestation, Decision, Mission, and audit-attribution tables use stable member
foreign keys with `ON DELETE RESTRICT`, never cascade.

For each T05 command, reuse the T03 receipt-first sequence:

1. authorize and normalize before storage;
2. generate Host IDs/time and enter `BEGIN IMMEDIATE`;
3. look up same actor/scope/idempotency key and compare canonical intent;
4. validate Project and exact revisions;
5. validate all member/sponsor/role invariants inside the transaction;
6. mutate member/responsibility rows with guarded CAS;
7. insert one pending Outbox intent, one allowlisted audit event/hash-head
   advance, and the exact detached result receipt;
8. check cancellation before commit; and
9. publish only after successful commit.

Suggested audit vocabulary is Project-scoped:

```text
workbench.project-member.created
workbench.project-member.status-changed
workbench.project.responsibility-assigned
```

Audit object identity is the internal member ID or Project ID and committed
revision. Safe summaries may include kind, state transition, and counts. They
must exclude display names, `open_id`, app/tenant identifiers, contact details,
responsibility request bodies, and arbitrary reason text. T05 creates no Feishu
write; a pending Outbox fact must not be described as an external assignment.

## 8. Acceptance and hidden-case evidence

### Workbench design inference

At minimum, scenario/repository/Remote/Client/restart tests should prove:

1. one Project can contain Feishu human, external human, and Agent members;
2. duplicate Feishu identity in the same app/Project is rejected atomically,
   while the same raw `open_id` under another app scope is not conflated;
3. invalid human identity unions and Agent-with-human-identity input fail before
   commit;
4. exactly one Accountable is returned, Contributors are unique, and whole
   responsibility replacement has no intermediate state;
5. Agent Accountable without an active human Sponsor is rejected;
6. inactive, cross-Project, missing, Agent-as-Sponsor, and self-Sponsor cases
   are rejected;
7. external human Accountable requires a human Sponsor but still remains
   ineligible for formal Feishu assignment;
8. Agent and external humans never become Feishu assignees through display name,
   email, or contact-value fallback;
9. deactivation of a currently referenced member returns `member-in-use` with
   no partial mutation; reassignment then deactivation succeeds;
10. inactive rows and all prior internal member IDs survive restart and remain
    visible in authorized history;
11. same-key/same-intent replay returns the exact result without duplicate
    member, responsibility, Outbox, or audit rows; changed intent conflicts;
12. stale member/catalog/responsibility revisions conflict without partial
    writes, including two SQLite connections racing;
13. rollback faults after every domain/Outbox/audit/head/receipt stage leave no
    partial member or assignment state;
14. Activity is Project-filterable and never exposes name/contact/`open_id`;
15. unauthenticated and cross-scope direct calls fail before repository access;
16. the browser preserves drafts across recoverable conflicts, blocks duplicate
    submission, labels declared versus external identity honestly, and marks
    inactive members without erasing them; and
17. HMR/disposal, built generated Remote faces, packed consumers, and full
    process restart preserve the same roster/responsibility projection.

## 9. Decisions to carry into implementation

### Workbench design inferences

- **Canonical term:** Accountable is the unique operational owner of one
  responsibility subject. It is not a claim that an Agent bears ultimate legal
  or business liability.
- **Canonical term:** Human Sponsor is the active human oversight/escalation and
  formal-acceptance contact required for Agent accountability (and for an
  external-contact Accountable under the approved V1 design).
- **Identity rule:** Workbench member ID is authoritative inside Workbench;
  Feishu `open_id` is a scoped external reference and external contact is not a
  weaker kind of Feishu ID.
- **Lifecycle rule:** inactive revokes eligibility, not identity or provenance.
- **Scope rule:** T05 stores declared identity metadata only. T07 verifies
  connector identity; T08 performs authoritative Feishu task assignment; T14
  consumes stable member IDs for external attestations; T33 binds executable
  Agent Profile versions.
- **Storage rule:** no delete endpoint, no cascading deletion, no member-data in
  Activity/audit summaries, and no generic responsibility target supplied by
  the browser.

The only design choice above that deliberately goes beyond issue #6's literal
checklist is requiring a Sponsor for an external-contact human when that member
is Accountable. That is not inferred from RACI or AI standards; it directly
preserves the approved V1 design statement that an external contact without
Feishu identity must have a traceable human Sponsor.
