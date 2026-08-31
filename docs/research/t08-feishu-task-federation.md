# T08 research: Feishu Task federation and convergent Project projection

Research date: 2026-08-31

Ticket: [#9 — T08 bind one primary Task List and project Feishu tasks](https://github.com/benz-ai-x/dsh-project-workbench/issues/9)

Runtime in scope: the Workbench Host, its generated Remote contract, the
Workbench-owned SQLite repository, the T07 pinned Feishu Bot/User connection,
one private injectable Task adapter, a periodic reconciliation loop, and one
authenticated Owner Project Tasks surface. Calendar, Task creation/deletion,
member/comment writes, public webhook hosting, and a general connector registry
remain outside T08.

This note uses official Feishu Open Platform material, the official Feishu Go
SDK generated contract, the audited DeepSeek Harness source pinned by this
repository, and the approved Workbench design/spec/contract. It separates
**source facts** from **Workbench design inferences**. Feishu defines its API;
it does not define Workbench's consistency, audit, or authorization model.

## Executive recommendation

Treat Feishu Tasks as the execution authority and Workbench as a bounded,
repairable projection:

1. An Owner selects one already verified Bot or User route and either chooses
   one accessible Task List or creates one. The resulting binding pins the
   exact route generation and verified actor; there is no identity fallback.
2. Binding and reconciliation read one complete, bounded baseline: Task List,
   top-level tasks, recursive subtasks, user members by role, comments,
   completion, canonical links, and opaque provider update versions.
3. A trusted connector may submit normalized low-latency observations to an
   internal Scenario seam. An append-only Inbox deduplicates event IDs and
   rejects stale resource versions. A periodic full reconciliation remains the
   correctness mechanism for missed, partial, delayed, or unsupported events.
4. A Workbench task edit reserves a durable effect before network I/O, checks
   the projected and currently observed provider version, and performs at most
   one Feishu PATCH. A response that may have been applied is terminal
   `unknown`; it is never blindly retried.
5. A task outside the primary list is absent from the Project projection until
   the Owner explicitly references its GUID. Reconciliation never broadens
   Project scope by search or by the selected actor's global visibility.

The provider does not expose an atomic compare-and-swap parameter for Task
PATCH. T08 therefore must not claim remote linearizability: `updated_at`
provides an opaque preflight fence, while durable single-attempt effects and
reconciliation prevent unsafe replay and repair the final projection.

## 1. Ticket boundary and inherited constraints

### Source facts

- Ticket #9 requires one primary list, a rich task/subtask projection,
  duplicate/reordered/missed-event convergence, versioned idempotent Workbench
  changes with an explicit unknown state, and opt-in visibility for outside-list
  tasks. [Ticket #9](https://github.com/benz-ai-x/dsh-project-workbench/issues/9)
- The approved design makes Feishu Tasks authoritative for execution tasks and
  requires event-driven freshness plus periodic reconciliation, Inbox/Outbox,
  resource versions, and explicit unknown outcomes.
  [V1 design §5](../design/project-workbench-v1.md#5-%E8%81%94%E9%82%A6%E4%BA%8B%E5%AE%9E%E6%BA%90%E6%9E%B6%E6%9E%84)
- The V1 spec requires explicit Bot/User routes, Host-owned business truth and
  effects, durable scheduling, and tests for duplicate, missing, reordered, and
  delayed events, rate limits, credentials, ACL, retry, ambiguity,
  reconciliation, and identity continuity.
  [V1 spec](../specs/project-workbench-v1-spec.md#federated-source-of-truth-model),
  [testing decisions](../specs/project-workbench-v1-spec.md#testing-decisions)
- T07 persists immutable verified actor bindings and requires each later
  resource call to stay on the exact identity that discovered/bound it.
  [T07 research](./t07-feishu-connection-center.md)
- T03 already defines the command, CAS, append-only audit, Outbox, receipt,
  replay, and unknown-effect semantics that T08 must extend rather than bypass.
  [T03 research](./t03-transactional-audit-outbox.md)

### Workbench design inferences

- T08 extends `WorkbenchScenario`, the repository contract, the existing
  authorization policy, and the generated `workbench` Remote. It does not add a
  second database, browser-owned synchronization, or a Harness-core patch.
- The adapter remains a private deterministic Host seam. A concrete inbound
  transport may normalize a verified Feishu notification into that seam, but
  raw provider callbacks are not browser Remote inputs.
- Event delivery is an optimization, not proof of completeness. Only a bounded
  provider baseline can repair arbitrary omission and projection drift.
- Task bodies, comments, members, URLs, tokens, and raw provider errors are
  business data. Generic audit/Activity/Outbox records contain identifiers,
  operation vocabulary, versions, and sanitized outcomes only.

## 2. Official Feishu Task v2 contract facts

The links in this section use the official Feishu repository at audited commit
[`bc44d5`](https://github.com/larksuite/oapi-sdk-go/commit/bc44d5264ec8d286d1015b9345410a4e07901e3a).
The generated SDK is useful here because it exposes exact paths, token types,
request fields, and response models in one reviewable primary source.

### 2.1 Task Lists

#### Source facts

- Task List create/list/get use
  `/open-apis/task/v2/tasklists[/:tasklist_guid]`; list returns every list
  readable by the calling identity, supports pagination, and all three calls
  accept tenant or user access tokens.
  [official generated routes](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L1360-L1480)
- A created Task List requires a name; the caller becomes its owner. The input
  model contains `client_token`, documented as enabling idempotency.
  [Task List model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L2780-L2878),
  [create API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/create)
- A Task List has a globally unique `guid`, name, owner, members, canonical
  `url`, and created/updated timestamps.
  [Task List response model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L4998-L5016)
- Listing tasks in one Task List uses
  `GET /open-apis/task/v2/tasklists/:tasklist_guid/tasks`, supports page tokens,
  and returns Task summaries. Omitting the completion filter means no
  completion filter, so a complete baseline must deliberately include both
  open and completed tasks.
  [official route](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L1570-L1600),
  [request/response model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L10460-L10555)

#### Workbench design inferences

- Discovery is explicit and identity-scoped. The browser chooses `bot` or
  `user`; Host resolves that route, proves actor continuity again, and returns
  only bounded safe candidates.
- Create passes the command idempotency key as Feishu `client_token`. A
  transport timeout or malformed success response remains unknown because the
  provider may have committed the list.
- Binding is immutable in T08 and uses Project ID as the primary key plus the
  provider's globally unique Task List GUID as a database-wide unique key. A
  different Project cannot silently claim the same primary list.
- A binding records `{kind, routeGeneration, appId, openId, tenantKey}` rather
  than merely “connected,” so credential rotation cannot silently change the
  principal behind a Project resource.

### 2.2 Tasks, subtasks, members, comments, and links

#### Source facts

- Task get and patch use `/open-apis/task/v2/tasks/:task_guid`; both accept
  tenant or user tokens and require resource access. The Task response includes
  GUID, display task ID, parent GUID, summary, description, members,
  `completed_at`, status, URL, timestamps, and subtask count.
  [official routes](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L920-L1012),
  [Task response model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L3797-L3850)
- Members carry a role. Feishu distinguishes task assignees and followers;
  member IDs are interpreted according to `user_id_type`, which Workbench fixes
  to `open_id`.
  [Task v2 overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/overview)
- Subtasks are enumerated from
  `/open-apis/task/v2/tasks/:task_guid/subtasks`; the returned parent relation
  must be preserved rather than flattened into independent Project tasks.
  [subtask request/response model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L9416-L9495)
- Comments are listed through `/open-apis/task/v2/comments` with resource type
  and resource ID, support pagination and ordering, and accept both token
  types. A comment includes identity, content, creator, reply relation, and
  timestamps.
  [comment routes](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L190-L330),
  [comment model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L558-L635)
- `completed_at` equal to `"0"` means incomplete. Task PATCH supports
  `summary`, `description`, and `completed_at` in `update_fields`; setting
  `completed_at` to `"0"` reopens a task. Task membership cannot be changed by
  this PATCH.
  [Task PATCH contract](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go#L980-L1012),
  [PATCH body model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L8376-L8524)

#### Workbench design inferences

- A baseline first lists top-level GUIDs, then reads full task details and
  comments, and recursively follows the subtask endpoint. It rejects cycles,
  parent mismatches, duplicate GUIDs, repeated page tokens, oversized pages,
  oversized response bodies, and bounds over 1,000 tasks or 500 comments per
  task.
- Provider bodies are allowlisted into a detached projection. T08 retains only
  the fields required by the ticket; attachments, reminders, task dates,
  custom fields, and arbitrary origin payloads are not accidentally exposed.
- Canonical provider URLs are retained but accepted only as HTTPS URLs without
  embedded credentials. The Client independently renders only safe HTTP(S)
  links with `noopener noreferrer`.
- `updated_at` is stored as an opaque `remoteVersion`; Workbench compares it but
  does not parse it as a causal clock. Projection revisions are separate local
  CAS values.

## 3. Events are hints; reconciliation is correctness

### Source facts

- Feishu's generated Task v2 event model includes
  `task_update_user_access_v2`, carrying a task GUID and event-type hints such
  as create, delete, assignee, follower, completion, description, and summary
  changes. It is not a complete task snapshot.
  [official event model](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L10955-L10975),
  [official handler](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/event.go)
- Feishu also exposes “Task List activity subscriptions,” but those subscribe
  chats to human-facing notification messages; their subscribers are chat
  resources. They are not a durable machine-consumable change feed for a local
  projection.
  [activity subscription contract](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go#L10559-L10625)

### Workbench design inferences

- A transport-specific trusted connector must authenticate/decrypt the Feishu
  event, re-read the affected task when necessary, and submit this normalized
  envelope to Scenario:

  ```text
  eventId + taskListGuid + taskGuid + kind + remoteVersion + observedAt
                                      + sanitized task snapshot or removal
  ```

- T08's production HTTP adapter implements Task v2 reads/writes; its optional
  `subscribeTaskEvents` seam is the internal integration point. T08 does not
  claim that a public webhook endpoint is shipped. The full baseline path is
  always available, so absence of an event transport reduces freshness rather
  than correctness.
- The append-only Inbox primary key is `eventId`. Processing is one transaction:
  resolve the unique bound list, compare the task's opaque version, apply an
  upsert/removal only when newer, advance the binding revision, record safe
  audit/Activity vocabulary, and append the Inbox receipt.
- Duplicate event IDs return the original result. A different event with an
  equal or older remote version is recorded but cannot overwrite a newer
  projection. An event for an unbound list is ignored rather than creating
  scope.
- Periodic reconciliation enumerates bounded bindings and replaces only the
  `primary-list` subset from one complete baseline. Explicit references survive
  removal from the primary list. A failed attempt records `attention`; a later
  successful attempt returns the mirror to `healthy`.
- The Scenario owns one interval and optional subscription disposer. Shutdown
  closes admission, aborts work, clears the interval, unsubscribes, and waits
  for tracked operations before closing the repository.

## 4. Versioned task-write protocol

Feishu Task PATCH does not advertise an `If-Match`/version parameter or a
`client_token`. Workbench therefore uses a local idempotency key to identify the
durable command/effect, not as a fictional provider feature.

```text
Owner intent
  -> authorize + validate + compare Project projectionRevision
  -> transaction: reserve immutable effect(idempotencyKey, changes,
                                           expectedRemoteVersion)
  -> claim prepared effect once; restart converts stranded inflight -> unknown
  -> resolve exact credential and re-prove pinned actor
  -> GET task and compare provider updated_at
       mismatch -> conflict, no PATCH
       match    -> exactly one PATCH
  -> transaction: settle delivered | conflict | failed | unknown
  -> reconciliation/event refreshes authoritative projection
```

The state meanings are:

| State | Evidence | Further automatic write |
|---|---|---|
| `prepared` | intent committed; provider not called | one worker may claim |
| `inflight` | provider attempt may be in progress | never claimed twice |
| `delivered` | provider returned a valid updated task | none |
| `conflict` | local or provider preflight version differed | none; refresh/edit again |
| `failed` | definitive rejection before/at provider | none; new Owner intent required |
| `unknown` | timeout, network loss, 5xx, malformed 2xx, or restart during inflight | none; reconcile first |

The browser may replay an identical command envelope only when the Client lost
its Host transport response before it knows the durable result. Host command
replay returns the same receipt/effect. Once Host reports the provider effect as
`unknown`, neither automatic nor explicit “retry” can issue another PATCH.

Residual limitation: another Feishu client can update a task after Workbench's
preflight GET and before its PATCH. Feishu offers no atomic version predicate in
this API. T08 exposes this honestly and relies on reconciliation to reveal the
result; it does not promise merge-free concurrent editing.

## 5. Persistence and scope model

Schema v7 adds six task-federation tables:

- `workbench_feishu_task_binding`: one immutable primary binding per Project,
  exact actor route, list metadata/version, local revision, and sync state;
- `workbench_feishu_task_projection`: safe current task mirror keyed by Project
  and task GUID, including scope and visibility;
- `workbench_feishu_task_reference`: append-only Owner intent for an outside-list
  task;
- `workbench_feishu_task_inbox`: append-only event identity and disposition;
- `workbench_feishu_task_reconciliation`: append-only attempt/result history;
- `workbench_feishu_task_effect`: immutable write intent plus monotonic outcome.

Database constraints and triggers make binding scope, references, Inbox,
reconciliation, and effect intent append-only. Projection replacement, binding
revision, command ledger, safe audit event, Outbox, and receipt commit in the
same SQLite transaction under CAS. No external network call occurs inside a
database transaction.

Outside-list visibility follows this rule:

```text
visible(task, project) =
  task is in the currently reconciled primary-list baseline
  OR an append-only explicit-reference fact exists for (project, taskGuid)
```

Reading a task GUID does not itself establish Project scope. Only the audited
Owner reference command does. T08 intentionally has no reference-removal
command; a later policy must define its history and consequences explicitly.

## 6. Remote and Client contract

T08 adds six generated Remote methods to the existing seventeen:

- `projectTasks`
- `discoverFeishuTaskLists`
- `bindFeishuTaskList`
- `reconcileProjectTasks`
- `referenceFeishuTask`
- `updateFeishuTask`

Every command carries expected local/connection/route revisions where
applicable, an idempotency key, a causation ID, and a closed reason vocabulary.
Remote schemas reject unknown fields and unsafe or oversized text. Browser
projections are detached values and contain no credential reference, token, raw
provider payload, or raw error.

The Project Tasks panel provides:

- explicit healthy verified Bot/User route choice with no fallback;
- bounded list discovery, existing-list selection, and idempotent create/bind;
- bound-list identity, canonical link, health, last event/reconciliation, and
  manual reconciliation;
- recursive task hierarchy, assignees, followers, comments, completion, and
  canonical task links;
- explicit outside-list GUID reference;
- summary/description/completion edit using both local projection revision and
  opaque remote version;
- textual loading, conflict, stale/reconnect, provider issue, and unknown-effect
  states; and
- exact transport replay only when safe, plus abort/disposal at Project,
  session, Fiber, and plugin lifecycle boundaries.

## 7. Failure and recovery decisions

| Condition | Safe result | Recovery |
|---|---|---|
| route unconfigured/disabled/unverified | reject before Task API | configure and verify exact route |
| actor/app/tenant continuity mismatch | reject, never alternate identity | restore credential or explicitly reset/rebind |
| missing app scope | distinct sanitized issue | grant/publish app scope |
| missing user grant | distinct sanitized issue | reauthorize that User token |
| resource ACL denial | distinct sanitized issue | grant same actor access or choose another list |
| duplicate/repeated page token or oversized baseline | invalid-provider response | inspect provider; do not commit partial baseline |
| duplicate event ID | return prior Inbox disposition | none |
| stale/equal event version | record ignored disposition | later event/reconciliation |
| missed event | no special guessing | periodic/manual complete reconciliation |
| local projection revision changed | conflict before effect | refresh and form a new intent |
| provider version changed at preflight | conflict without PATCH | refresh and form a new intent |
| definitive provider 4xx | failed | correct cause; new intent only |
| timeout/network/5xx/malformed success | unknown | reconcile; never blindly replay PATCH |
| restart with `inflight` effect | recover as unknown | reconcile |
| Scenario/plugin disposal | stop admission, abort, unsubscribe, clear timer, quiesce | restart cleanly |

## 8. Acceptance evidence matrix

| Acceptance item | Behavioral evidence |
|---|---|
| create/select one unique primary list | adapter route/body fixtures; Scenario bind flow; SQLite uniqueness, replay, and restart tests; Client discovery/bind/create tests |
| rich task projection and canonical URL | recursive subtask, member-role, comment pagination, completion, URL normalization fixtures; repository round-trip; accessible component tests |
| incremental events and eventual convergence | duplicate/stale/removal Inbox tests; trusted adapter event Scenario test; periodic fake-timer missed-event repair; manual reconciliation tests |
| version, idempotency, and unknown | local+remote stale races; immutable reservation/claim/settlement; one PATCH fixture; stranded-inflight recovery; Client no-retry unknown test |
| outside-list tasks only by reference | invisible-before-reference repository test; audited explicit-reference Scenario/Client flow; preservation across reconciliation/removal |
| integration and lifecycle | Schema v6→v7 migration/restart, generated 23-method Typert faces, Owner reconnect/logout/Fiber disposal, built/packed artifact checks, real-browser suite |

No live Feishu secret is required by the deterministic suite. Production HTTP
behavior is proven with bounded Fetch fixtures that assert exact paths, query,
actor token use, payloads, pagination, sanitization, and ambiguous outcomes.

## 9. Explicit exclusions and follow-ups

T08 does not implement:

- task/subtask creation or deletion;
- assignee/follower, comment, reminder, date, custom-field, or list-membership
  writes;
- reference removal or primary-list rebinding;
- a public Feishu callback endpoint, websocket daemon, or webhook secret
  administration;
- OAuth callback/refresh ownership;
- Calendar/date federation;
- arbitrary provider search or auto-import of every task visible to an actor;
- a general integration-adapter registry; or
- a claim of atomic provider-side CAS for Task PATCH.

Later integration work must choose and secure a concrete Feishu event transport,
normalize its incomplete task notifications through the internal adapter seam,
and keep periodic reconciliation enabled. That work must not reinterpret Task
List activity-to-chat subscriptions as a machine change feed.

## 10. Primary-source index

| Topic | Primary source | Design use |
|---|---|---|
| Task v2 semantics | [Feishu Task v2 overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/overview) | IDs, members, updates, completion, idempotency concepts |
| exact API routes/token types | [official Go SDK `resource.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/resource.go) | Bot/User routes, list/get/patch/comment/subtask paths |
| exact provider models | [official Go SDK `model.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/model.go) | GUIDs, URLs, timestamps, member roles, pages, event envelope |
| Task event handler | [official Go SDK `event.go`](https://github.com/larksuite/oapi-sdk-go/blob/bc44d5264ec8d286d1015b9345410a4e07901e3a/service/task/v2/event.go) | transport-normalized low-latency hint boundary |
| official operational update UX | [official Lark CLI Task update reference](https://github.com/larksuite/cli/blob/6646386e0996b1ff5df640bccff834a20bcb203b/skills/lark-task/references/lark-task-update.md) | GUID/canonical-link identity and confirmed server output discipline |
| Workbench actor continuity | [T07 research](./t07-feishu-connection-center.md) | exact route, credentials, scope/ACL separation |
| Workbench effect semantics | [T03 research](./t03-transactional-audit-outbox.md) | reserve-before-effect, replay, unknown, audit/Outbox |
