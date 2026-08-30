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
