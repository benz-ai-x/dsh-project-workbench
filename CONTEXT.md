# Project Workbench

Project Workbench governs project intent, outcomes, evidence, and controlled execution while preserving the authority of connected systems for their own domains.

## Language

**Project Template**:
A family of published definitions from which Projects are created. A Project Template has immutable Template Versions rather than one mutable current definition.
_Avoid_: Blueprint, preset

**Knowledge Work Template**:
The built-in Project Template validated by V1 for research, analysis, coordination, and evidence-based delivery.
_Avoid_: Default template, generic template

**Template Version**:
An immutable published definition within one Project Template family, identified by a monotonic version.
_Avoid_: Latest template, mutable template

**Project Template Snapshot**:
The immutable, Project-owned copy of the exact Template Version definition captured when a Project is created.
_Avoid_: Template link, live inheritance

**Goal**:
A durable desired result to which one or more Projects may contribute. A Goal owns one or more measurable Outcomes.
_Avoid_: Task, Project

**Outcome**:
A measurable result belonging to one Goal, expressed with a baseline, target, unit, and direction of improvement.
_Avoid_: Task completion, activity, output

**Project**:
A governed body of work created from one Project Template Snapshot, with exactly one Primary Goal and zero or more Supporting Goals.
_Avoid_: Goal, task list

**Primary Goal**:
The single Goal that states a Project's principal purpose.
_Avoid_: Main objective

**Supporting Goal**:
An additional Goal to which a Project contributes without replacing its Primary Goal.
_Avoid_: Secondary Goal, auxiliary Goal

**Project Team**:
The Project-scoped aggregate containing its stable ProjectMember roster and current Project Responsibility.
_Avoid_: Global directory, Feishu contact list

**ProjectMember**:
A stable human or Agent responsibility identity inside one Project. Inactivation changes eligibility but never deletes historical attribution.
_Avoid_: Login account, ephemeral assignee

**Human Member**:
A ProjectMember represented either by a recorded app-scoped Feishu open_id or by explicit external-contact information. Recording an open_id is not proof that a Feishu connection has verified it.
_Avoid_: Workbench user

**Agent Member**:
An AI ProjectMember that may hold Workbench responsibility but cannot provide human oversight.
_Avoid_: Agent runtime, model profile

**Feishu Identity Reference**:
An app-scoped `{appId, openId}` declaration that makes the member eligible for a future formal Feishu assignee mapping once the authoritative connector validates and uses it.
_Avoid_: Verified Feishu connection, Workbench account

**Feishu Connection**:
The workspace-scoped integration aggregate that owns two independent Feishu Identity Routes, one Bot and one User. It is configuration and verification truth, not a Project resource binding.
_Avoid_: Shared token pool, automatic actor selector

**Feishu Identity Route**:
One explicit `appId + Credential Reference + actor kind` configuration generation used for every verification and later resource operation. Configuration generations are append-only, while ordinary edits and disable/re-enable preserve the separate identity-continuity epoch. A failed route is never replaced by the other route as a permission fallback.
_Avoid_: Credential candidate, any available identity

**Credential Reference**:
A value-free name resolved by the DSH credential provider for each external operation. Workbench stores and projects the name and presence metadata, never the secret or token value.
_Avoid_: App Secret, access token, encrypted business-table credential

**Feishu Actor Binding**:
The immutable `realm + appId + kind + openId + tenantKey` subject established by the first successful verification of one Identity Route continuity epoch. Changing configuration or disabling a route does not clear it; an intentional actor change requires an explicit reset that advances the epoch.
_Avoid_: Last verified user, mutable identity cache

**Feishu Verification Fact**:
An append-only observation for one exact Identity Route generation, recording only closed identity, scope, resource-probe, result, and recovery codes. Provider bodies, messages, request IDs, credentials, and tokens are not facts.
_Avoid_: Live authorization guarantee, raw API response

**Feishu Resource Probe**:
An optional read-only check of one concrete resource with the same explicit actor route, performed only after identity continuity passes. It distinguishes API-scope or user-grant failure, resource ACL denial, and resource-not-found, and does not create a Project resource binding.
_Avoid_: Tenant-wide discovery, actor fallback

**External Contact**:
Human contact information for a ProjectMember without a Feishu identity reference. The member may hold Workbench responsibility but is not a formal Feishu assignee.
_Avoid_: Guest login

**Project Responsibility**:
The versioned Workbench-governance assignment for the Project target: exactly one Accountable, zero or more distinct Contributors, and a required Human Sponsor when the Accountable is an Agent Member or external-contact Human Member.
_Avoid_: Feishu task assignment, mutable RACI list

**Responsibility Target**:
The governed object to which a complete responsibility tuple applies. T05 admits only the Project itself; later object kinds require their own authority and policy before joining the closed vocabulary.
_Avoid_: Browser-supplied arbitrary object type

**Accountable**:
The single active ProjectMember answerable for the current Responsibility Target.
_Avoid_: Co-owner, multiple owners

**Contributor**:
An active ProjectMember who contributes work without sharing the Accountable role. Contributors are distinct and may be empty.
_Avoid_: Co-accountable

**Human Sponsor**:
The active Human Member who provides escalation and oversight when an Agent Member or external-contact Human Member is Accountable. A Sponsor may also be a Contributor but cannot be the sponsored Accountable member.
_Avoid_: Agent supervisor process, optional reviewer

**Inactive Member**:
A retained ProjectMember who cannot receive new responsibility but remains visible through historical IDs, responsibility versions, evidence, and audit attribution.
_Avoid_: Deleted member

**Review Center**:
The authorized Project-scoped projection in which an Owner inspects one closed review kind at a time: evidence-backed SuggestedChanges or Deliverable Acceptance Requests, with their target-specific lifecycle and retained decisions.
_Avoid_: Approval queue, arbitrary command console

**SuggestedChange**:
An immutable proposal to apply one closed semantic command candidate to one exact target version. It is not authority to mutate the target and never silently rebases when the target advances.
_Avoid_: Patch request, pending fact

**SuggestedChange Source**:
The Host-derived principal or producer identity that created a SuggestedChange. T06 admits only the authenticated Owner; later trusted producers require new closed variants.
_Avoid_: Evidence, reviewer, browser-supplied actor

**Review Target**:
The typed aggregate and immutable base version against which a SuggestedChange was formed. T06's only Review Target is one Project's Project Responsibility at an exact Project Team revision.
_Avoid_: Arbitrary object path, latest state

**Review Diff**:
The Host-derived, versioned before/after representation and changed-field set for one typed Review Target. It is inspectable intent, not a generic patch execution format.
_Avoid_: Caller-supplied JSON Patch, unbounded object diff

**EvidenceRef**:
A stable reference to an authorized record that supports a SuggestedChange without copying the evidence body into the proposal or generic command ledger. T06 admits immutable, same-Project Workbench audit-event references.
_Avoid_: Source identity, free-text justification

**Review Risk**:
The Host-derived `low` or `high` impact classification produced by a versioned target policy. It is distinct from model confidence and cannot be downgraded by the caller.
_Avoid_: Confidence score, browser-selected severity

**Review Decision**:
An append-only Owner disposition with mandatory feedback: accept, edited accept, reject, or defer. Accepted means the target mutation committed in the same transaction.
_Avoid_: Mutable approval flag, optional comment

**Deferred SuggestedChange**:
An unresolved SuggestedChange intentionally postponed by the Owner. It remains actionable only while its immutable Review Target base version is current.
_Avoid_: Rejected change, scheduled job

**Stale SuggestedChange**:
An unresolved SuggestedChange whose Review Target has advanced beyond its immutable base version. Stale is Host-derived, cannot be accepted or deferred, and requires a new proposal rather than force or rebase.
_Avoid_: Transport stale, rejected change

**Project Calendar Binding**:
The immutable association between one Project and one writable Feishu Calendar v4 resource through one exact verified Feishu Identity Route generation. It establishes where that Project's formal time commitments live; it is not a copy of the calendar or permission to switch actors.
_Avoid_: Calendar preference, fallback calendar

**Milestone**:
A Workbench-owned Project checkpoint with stable business identity, name, and description whose formal date is supplied by exactly one bound Feishu calendar event.
_Avoid_: Calendar event, task due date, Deliverable

**Milestone Event Binding**:
The immutable association between one Milestone and one non-recurring Feishu event in the Project Calendar Binding. The provider event ID and app link remain external identities, while the Milestone remains the Workbench business object.
_Avoid_: Copied event, recurring meeting

**Authoritative Schedule**:
The normalized all-day or timed start/end value most recently observed from the bound Feishu event. A submitted Workbench date is intent until Feishu returns or reconciliation observes it.
_Avoid_: Local due date, optimistic calendar value

**Remote Observation Version**:
An opaque, versioned digest of the canonical Feishu event authority tuple used to compare exact observations when the provider exposes no resource revision or conditional update. It is not a Feishu-enforced CAS token.
_Avoid_: ETag, provider revision, update timestamp

**Project Schedule Change**:
An append-only, Project-scoped fact emitted in the same transaction as an authoritative Milestone date or remote-status change. Its revisioned feed is the durable dependency-consumer seam for later planning and risk modules.
_Avoid_: Notification-only event, mutable date history

**Deliverable**:
A Workbench-owned executable Project object whose immutable plan binds responsibility, Acceptance Criteria, visible execution tasks, and one authoritative calendar event through acceptance to a Final Release.
_Avoid_: Task, Milestone, mutable file link

**Deliverable Plan**:
The immutable semantic definition captured when a Deliverable is created: its name, description, ordered Acceptance Criteria, responsibility assignments, task GUID links, and creation provenance.
_Avoid_: Editable draft, JSON patch

**Acceptance Criterion**:
One ordered, stable-ID statement in a Deliverable Plan against which every formal acceptance decision records `met` or `not-met`.
_Avoid_: Task status, optional checklist note

**Designated Acceptor**:
The active Human ProjectMember assigned to evaluate a Deliverable. In V1 the authenticated Owner records the decision and retains this assignment separately; designation is not proof that the member logged in or signed.
_Avoid_: Workbench login, external attestation

**Calendar Commitment**:
The internal closed ownership seam that associates one unique Project calendar event with exactly one Workbench target, currently either a Milestone or Deliverable.
_Avoid_: Shared event link, generic calendar object

**Declared Artifact Version Reference**:
An immutable, source-qualified reference to one exact managed, local, or Feishu resource version, optionally carrying a declared content digest. It records Owner intent but does not prove source existence, readability, or permission.
_Avoid_: Verified file, mutable latest link

**Deliverable Acceptance Request**:
One immutable review round freezing the exact Deliverable revision, plan, responsibility, calendar observation, task links, and complete candidate artifact-version set presented for acceptance.
_Avoid_: Mutable review draft, generic SuggestedChange

**Deliverable Acceptance Decision**:
An append-only Owner disposition of one Acceptance Request—approved, rejected, or needs changes—with mandatory feedback and one result for every frozen Acceptance Criterion.
_Avoid_: Boolean approval flag, Acceptor login proof

**Final Release**:
The immutable accepted output created atomically on approval and containing exactly every candidate artifact version frozen by that Acceptance Request.
_Avoid_: Latest file, replaceable publication pointer

**Deliverable Activity**:
The separately authorized append-only projection that connects immutable Deliverable plan, acceptance-request, decision, calendar-observation, and responsibility snapshots to their matching audit-event or Project Schedule Change source facts.
_Avoid_: Generic Activity payload, mutable timeline
