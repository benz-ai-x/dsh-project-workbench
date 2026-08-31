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
