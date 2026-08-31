# T09 Feishu task workflow research

## Scope and source policy

This note freezes the provider contract used by Issue #10. It covers one
Project-bound Feishu Task v2 custom field, its single-select options, task
custom-field values, migration safety, and response-loss handling. It does not
claim a generic Feishu schema registry.

Only Feishu/Lark first-party material is used. The machine-readable baseline is
the official `larksuite/oapi-sdk-go` repository at commit
[`bc44d5264ec8d286d1015b9345410a4e07901e3a`](https://github.com/larksuite/oapi-sdk-go/tree/bc44d5264ec8d286d1015b9345410a4e07901e3a).
The generated SDK embeds the official OpenAPI descriptions and exact HTTP
routes, which makes it more reproducible than an unversioned API Explorer page.

## Provider contract

### Resource model and routes

Feishu custom fields are reusable resources. A field can be attached to more
than one task list; T09 deliberately creates or maps one field on exactly the
Project's primary task list. Listing with both `resource_type=tasklist` and the
exact task-list GUID prevents discovery from silently expanding to every field
visible to the identity. The official SDK documents list pagination and the
task-list filter in the generated
[`ListCustomField` request](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L6435-L6577).

| Purpose | Method and path | T09 use |
|---|---|---|
| List fields attached to the primary list | `GET /open-apis/task/v2/custom_fields` | Bounded pagination with exact `resource_type=tasklist` and `resource_id=<tasklist_guid>` |
| Read one field | `GET /open-apis/task/v2/custom_fields/:custom_field_guid` | Preflight and post-write observation |
| Create and attach one field | `POST /open-apis/task/v2/custom_fields` | `type=single_select`, exact task-list resource, full initial visible options |
| Update name/options | `PATCH /open-apis/task/v2/custom_fields/:custom_field_guid` | `update_fields=[name,single_select_setting]` as needed |
| Attach an existing field | `POST /open-apis/task/v2/custom_fields/:custom_field_guid/add` | Available provider operation; T09's mapping flow only maps fields already listed on the primary list |
| Create one option | `POST /open-apis/task/v2/custom_fields/:custom_field_guid/options` | Not needed by the initial whole-schema migration, but confirms the option GUID returned by Feishu is the durable identity |
| Update one option | `PATCH /open-apis/task/v2/custom_fields/:custom_field_guid/options/:option_guid` | Available for a future narrower migration planner |
| Write a task value | `PATCH /open-apis/task/v2/tasks/:task_guid` | `task.custom_fields` plus `update_fields=[custom_fields]` |

The routes and tenant/user token support are frozen in the official generated
[`task/v2/resource.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L345-L566),
and the task PATCH behavior is documented in the same
[`resource.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L979-L1010).

### Stable identity and bounds

- A custom field has a provider `guid`, display `name`, immutable `type`, and
  `updated_at`. Workbench stores the field GUID and treats `updated_at` as an
  opaque remote-version observation, never as a numeric clock. See the official
  [`CustomField` model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L829-L852).
- A single-select option has its own GUID. Its name is non-empty and at most 50
  characters, `color_index` is 0 through 54, and `is_hidden` controls whether it
  can be selected. A hidden option cannot be assigned through OpenAPI. See the
  official [`Option` model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L3106-L3183).
- A single- or multi-select field supports at most 100 options, and visible
  option names must be unique. The official generated create-option contract
  records both limits in
  [`model.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L6866-L6940).
- Field names are at most 50 characters and new custom fields can currently be
  attached to a `tasklist`; the exact resource ID is that list's GUID. See
  [`InputCustomField`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L1867-L1990).

Logical `stateId` is a Workbench identity and must not be derived from a display
name. Each Project workflow version therefore persists
`stateId -> option_guid`, plus the stable field GUID. Names and colors may
change without changing logical or provider identity.

### Migration semantics are destructive unless planned

The official field PATCH contract says the field type cannot change. For
single/multi-select settings, the request provides the final visible option
list: an existing option omitted from the request is made hidden and moved
after visible options. Supplying its GUID updates that option; omitting a GUID
creates a new option and returns its new GUID. Visible names must be unique.
These semantics are explicit in the official
[`PatchCustomField` contract](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L459-L477).

Consequences for T09:

1. Read the exact current field and every visible Project task value before a
   migration preview.
2. Preserve the GUID for every retained logical state.
3. Block removal/hiding of a state while any projected task still uses its
   option GUID.
4. Block missing, hidden, duplicate, wrong-type, and unmapped values. Name drift
   is attention unless another invariant makes it blocked.
5. Add a new state without an option GUID, then persist only the GUID returned
   by Feishu.
6. Re-read and validate the complete response before committing the local
   mapping version.

This is why a migration is a previewed schema operation, not a series of blind
option deletes.

### Task values and Feishu authority

The task model carries `custom_fields`; a single-select value contains the
field GUID, type, and one `single_select_value` option GUID. An empty string
clears the value. See the official
[`CustomFieldValue` model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L1052-L1208).

For task PATCH, only custom fields included in `task.custom_fields` change; the
others remain unchanged. The caller needs edit permission for both the task and
the custom field. Workbench therefore sends one exact field value and never
round-trips unrelated custom fields. The generated request exposes
`custom_fields` on the official
[`InputTask` model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L2360-L2752)
and `custom_fields` in task PATCH `update_fields` in
[`PatchTaskReqBody`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L8376-L8518).

Feishu remains authoritative after both origins of change:

- A Workbench-originated transition validates Project task revision, opaque
  task remote version, workflow revision, current mapped value, allowed graph
  edge, and visible target option before reserving one provider PATCH. Its
  projection changes only from the returned Feishu task observation.
- A Feishu-originated value can jump across Workbench's allowed graph because
  Feishu is the authority. Event or complete-list reconciliation projects the
  provider value as observed; an unknown GUID is shown as unrecognized and
  blocks another Workbench transition until reconciled or remapped.
- Entering a terminal state produces only
  `terminal-state-awaiting-owner-confirmation`. It does not set
  `completed_at`; task completion remains a separate explicit Owner command.

## Concurrency and response-loss boundary

### Remote version is an observation, not provider-enforced CAS

The custom-field PATCH request contains the field body and `update_fields`, but
no `If-Match`, expected version, or equivalent field revision. See the official
[`PatchCustomFieldReqBody`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L6580-L6733).
Workbench can GET and compare `updated_at` before PATCH and can detect a changed
preflight observation, but this is not an atomic provider CAS: another editor
can still write between GET and PATCH. The adapter must re-read/validate the
returned field, expose an observed conflict as a closed result, and never claim
stronger concurrency than the provider contract offers.

### Custom-field writes have no documented idempotency token

This is an inference from the pinned official contract. Custom-field create
accepts only `InputCustomField`, and custom-field PATCH accepts only
`custom_field` plus `update_fields`; neither request has `client_token`. In
contrast, the same official model explicitly includes `client_token` on task
and task-list create inputs:
[`InputTask`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L2420-L2430)
and
[`InputTasklist`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L2775-L2837).
No undocumented server behavior is assumed.

Therefore receipt lookup after the provider response is insufficient. The
required Workbench reliability protocol is:

1. Normalize and hash the complete configuration intent.
2. Atomically reserve a durable workflow operation, redacted Outbox intent,
   audit event, and immutable receipt before provider mutation.
3. Claim `prepared -> inflight` once, then make exactly one create/PATCH attempt.
4. Settle a definitive response as delivered/failed. If transport or response
   parsing cannot prove whether the write took effect, settle `unknown`.
5. Replay the same actor/key/intent from the stored operation. An inflight
   operation recovered after restart becomes unknown. Unknown is never offered
   for automatic delivery again.
6. Resolve unknown by an explicit field-list/read reconciliation and Owner
   choice. For create, match only evidence strong enough to recover the actual
   field and option GUIDs; ambiguous candidates require manual selection.

Provider calls, field/option names, task values, raw bodies/errors, credentials,
and resource IDs do not enter generic audit or Activity. The safe audit fact is
the operation type, Project scope, operation state, stable command correlation,
and bounded result code.

## Frozen T09 design decisions

- One Project workflow maps to one `single_select` field on its immutable
  primary task-list binding.
- The Owner defines 2–100 stable logical states, one initial state, explicit
  allowed transitions, and at least one terminal state with no outgoing edges.
- Configuration modes are create, map-existing, and migrate. They all converge
  to the same persisted field GUID plus complete state-to-option-GUID mapping.
- Mapping/history is append-only; current mapping uses workflow CAS and Project
  task CAS. A field identity cannot silently switch during migration.
- A used state is never destructively removed or hidden. External unmapped
  values remain visible as blocked compatibility evidence.
- Workbench transition rules govern only Workbench-originated writes. Feishu
  observations always converge into the projection.
- Terminal state and task completion are separate facts. Completion is never an
  automatic side effect of status reconciliation.
- Custom-field create/PATCH is a non-idempotent external effect for reliability
  purposes. Unknown outcome means stop and reconcile, never blind retry.

## Required behavioral evidence

- Schema v7 to v8 migration and a second persistence restart.
- Existing/create/migrate modes retain the exact field and option GUIDs returned
  or selected, including rename and new-option migration.
- Field-version conflict and used-state removal stop before a provider write.
- Workbench status write enforces task CAS, task remote version, workflow CAS,
  mapped current value, mapped target, and allowed transition.
- Feishu-originated status converges through reconciliation, including unknown
  options, without automatic completion.
- Terminal state yields one suggestion; only a separate Owner completion
  command changes `completed_at`.
- Successful configuration response replay makes no second provider call.
- Configuration response loss/restart turns inflight into durable unknown,
  records safe audit/Outbox/receipt evidence, and never redelivers the operation.
- Exact adapter fixtures cover field list/create/get/PATCH and task
  `custom_fields` PATCH bodies, pagination limits, response bounds, cancellation,
  and both Bot/User route token forms without live production mutation.
