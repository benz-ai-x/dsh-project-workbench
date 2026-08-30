# T03 research: transactional commands, Outbox, and hash-chained audit

Research date: 2026-08-31

Ticket: [#4 — T03 可追溯命令、Outbox 与审计活动流](https://github.com/benz-ai-x/dsh-project-workbench/issues/4)
Runtime in scope: Node 26, `node:sqlite`, the Workbench-owned Host repository

This note uses only primary sources: official Node and SQLite documentation,
RFCs, NIST publications, OWASP guidance, and first-party AWS/Stripe guidance.
It marks sourced facts separately from Workbench design inferences.

## Executive recommendation

**Design inference.** Add one Host-owned transactional command seam that, in a
single SQLite `BEGIN IMMEDIATE` transaction:

1. checks the command receipt before optimistic concurrency;
2. applies the business mutation;
3. inserts immutable Outbox intent;
4. appends the audit event and advances its chain head; and
5. saves the command receipt/result before `COMMIT`.

All five records must live in the same Workbench database file. The dispatcher
does network I/O only after that commit. A retry with the same command key and
same normalized intent returns the stored result and creates no new business,
Outbox, or audit rows. Reusing a key with different intent is a stable conflict.

Keep the current project boundaries: the Host is authoritative, the actor comes
from the authenticated Host principal, Activity is a typed Remote projection,
and these durable facts belong in plugin-owned storage—not a custom DSH Session
event. See the local [project contract](../agent/PROJECT_CONTRACT.md) and the
current [`SqliteWorkbenchRepository`](../../packages/workbench-host/src/sqlite-repository.ts).

## 1. SQLite and `node:sqlite` facts that constrain the seam

### Source facts

- Node's `DatabaseSync` represents one SQLite connection and all its APIs run
  synchronously. Node 26 also exposes a constructor `timeout` (the lock wait in
  milliseconds) and `database.isTransaction` (a wrapper over SQLite autocommit
  state). [Node 26 `node:sqlite` documentation](https://nodejs.org/docs/latest-v26.x/api/sqlite.html#class-databasesync)
- SQLite permits many concurrent readers but only one simultaneous writer.
  `BEGIN DEFERRED` can fail later while upgrading a read snapshot;
  `BEGIN IMMEDIATE` tries to acquire the write transaction at the start and can
  return `SQLITE_BUSY` there. [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions)
  SQLite further documents that a successful `BEGIN IMMEDIATE` avoids a later
  `SQLITE_BUSY` caused by another writer jumping ahead.
  [SQLite isolation documentation](https://www.sqlite.org/isolation.html)
- WAL lets readers and a writer proceed concurrently, but WAL still permits
  only one writer and requires every process to be on the same host. A
  transaction spanning multiple attached databases is atomic per database,
  not across the attached set. [SQLite WAL documentation](https://www.sqlite.org/wal.html)
- In WAL mode, `synchronous=FULL` is ACID and performs an extra WAL sync at each
  commit; `NORMAL` can lose a recently acknowledged transaction after power or
  OS failure. [SQLite `PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)
- SQLite foreign-key enforcement is connection-local. Node enables it by
  default, but an application should set or verify the intended value on each
  connection. [Node constructor options](https://nodejs.org/docs/latest-v26.x/api/sqlite.html#new-databasesyncpath-options),
  [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html#fk_enable)

### Workbench design inferences

- Preserve the repository's existing WAL, foreign-key, busy-timeout, and
  `synchronous=FULL` setup. `FULL` is the appropriate durability choice because
  a returned command receipt is a promise that the business row, Outbox intent,
  and audit evidence survived together.
- Keep the transaction callback wholly synchronous and prohibit thenables. Do
  not `await`, call an adapter, publish a Remote notification, or invoke
  user-controlled code while the write lock is held. The public repository
  method may still return a `Promise`, as it does today, but the SQLite critical
  section should be a straight synchronous block.
- Put business tables, `command_receipt`, `outbox`, `outbox_attempt`,
  `audit_event`, and `audit_chain_head` in `main`. A separate attached audit
  database would invalidate T03's all-or-nothing claim.
- Treat `COMMIT` returning successfully and `database.isTransaction === false`
  as the local commit point. In error cleanup, roll back if
  `database.isTransaction` is still true; if rollback itself fails, retire the
  connection instead of swallowing the failure and reusing uncertain state.
- The current single `DatabaseSync` connection naturally avoids same-process
  interleaving during its synchronous calls, but the busy timeout remains
  necessary for another process or connection. Keep write transactions short.

## 2. Transactional command and idempotency contract

### Source facts

Official AWS transactional-outbox guidance puts the business update and Outbox
row in the same relational transaction, then has a separate processor publish
only committed rows. It also warns that duplicate delivery remains possible and
consumers should track processed messages idempotently.
[AWS Transactional Outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

AWS's first-party idempotent-API guidance recommends a caller-provided request
identifier, atomic storage of that identifier with the mutation, a semantically
equivalent response on retry, and a parameter-mismatch error when one identifier
is reused for different intent.
[Amazon Builders' Library: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

### Workbench design inference: public envelope

Every formal mutation should enter one reusable seam with at least:

```ts
interface CommandEnvelope<I> {
  commandType: string
  idempotencyKey: string
  intent: I                 // normalized caller intent only
  expectedVersion: number | null
  reason: { code: string; detail?: string }
  causationId: string
}
```

The trusted execution context adds `commandId`, authenticated `actor`, time,
and generated resource IDs. The idempotency fingerprint should be
`SHA-256(JCS(normalized caller intent + command type + target scope + expected
version))`; exclude generated IDs and clock time, because those legitimately
change when a response-lost request is retried.

Scope the unique key to the authenticated actor/organization plus command key,
and persist the fingerprint and detached result:

```text
UNIQUE(actor_scope, idempotency_key)
command_type, intent_hash, command_id, committed_result_json, committed_at
```

The transaction order matters:

1. `BEGIN IMMEDIATE`.
2. Look up the receipt first. Same key + same fingerprint closes the
   no-change transaction and returns its saved result; same key + different fingerprint returns
   `idempotency-key-reused`. This check must precede the version check, or a
   successful response-lost retry would incorrectly see its own newer version
   as a conflict.
3. Read and validate the current object version; decide the normalized mutation.
4. Apply the mutation and assert exactly one expected row/version changed.
5. Insert one Outbox row per approved external intent, with a stable effect key.
6. Append one or more audit events in chain order.
7. Insert the receipt containing the exact result the caller should see.
8. Check cancellation immediately before `COMMIT`; after `COMMIT`, return the
   committed result even if caller cancellation races in. The existing
   [`WorkbenchScenario`](../../packages/workbench-host/src/scenario.ts) already
   follows this post-commit cancellation rule.

If any step throws, roll back all of it. Validation and authorization failures
that occur before the transaction create no business or Outbox row. Security
attempt/rejection events may be written as explicitly separate audit facts, but
must never masquerade as the audit event for a committed mutation.

This provides **one committed local intent**, not exactly-once delivery. The
Outbox/consumer or destination's idempotency contract is still required for the
external effect.

## 3. Outbox delivery and explicit unknown outcomes

### Source facts

HTTP defines PUT, DELETE, and safe methods as idempotent. It permits automatic
retry after losing a response because the original request might already have
succeeded; it says a client should not automatically retry a non-idempotent
request unless it knows the application semantics are idempotent or can prove
the original was not applied. [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)

Stripe's first-party API guidance illustrates the practical ambiguity: after a
network error the client does not know whether the server received the request,
so it retries identical parameters under the same idempotency key; Stripe also
classifies some server-error results as indeterminate and warns against retrying
with a new key because the original may have produced effects.
[Stripe advanced error handling](https://docs.stripe.com/error-low-level#network-errors)

### Workbench design inference: state meanings

The four ticket states should mean facts, not retry-policy shorthand:

| State | Meaning | Allowed next action |
|---|---|---|
| `pending` | No attempt that may have affected the destination is outstanding; the intent is eligible to send. | Claim by lease and send. |
| `delivered` | A definitive provider result, reconciliation result, or authoritative inbound event proves the intended effect. | Terminal; retain provider reference/version. |
| `unknown` | An attempt may have taken effect, but no authoritative result proves success or non-application. | Reconcile; retry only with the same still-valid provider idempotency key. |
| `failed` | A definitive terminal result proves rejection/non-application, or a bounded retry budget was exhausted using only outcomes known not to have applied. | Human correction or a new approved command/key. |

Never turn `unknown` into `failed` merely because time or retry count elapsed.
Never retry it with a fresh external key. If the provider has neither a durable
idempotency contract nor a lookup/reconciliation API, leave it `unknown` for
Owner review.

Use a stable external effect key such as `workbench:<outbox-id>` and enforce
`UNIQUE(destination, effect_key)`. Store the destination, operation, immutable
schema-versioned payload, credential **reference** (never credential value),
causation ID, next-attempt time, bounded attempt count, and optional provider
request/resource/version references.

Dispatch in three phases:

1. In a short transaction, lease a `pending` row and append an attempt-start
   fact. Do not hold a SQLite transaction over network I/O.
2. Invoke an adapter that returns a typed outcome:

   ```ts
   type ExternalOutcome =
     | { kind: 'delivered'; externalRef: string; version?: string }
     | { kind: 'not-applied-retryable'; code: string; retryAt: string }
     | { kind: 'not-applied-terminal'; code: string }
     | { kind: 'unknown'; code: string; providerRequestId?: string }
   ```

   Once the request might have left the process, an opaque exception defaults
   to `unknown`, not `failed`.
3. In another short transaction, append the attempt outcome, transition the
   Outbox row, and append an audit event. An expired lease with an unfinished
   started attempt becomes `unknown` on restart unless the adapter can prove no
   send occurred.

On disposal, stop claims, abort owned calls, and await finalization. An abort or
timeout does not prove the remote side rolled back; settle such an admitted
attempt as `unknown` when it may have crossed the transport boundary.

For future inbox consumers, use `UNIQUE(source, message_id)` and atomically
store the processed-message marker with the local mutation. That implements the
processed-ID tracking required by at-least-once delivery; it does not depend on
payload equality to guess intent.

## 4. Audit event, canonical hash input, and tamper evidence

### Source facts

- RFC 8785 JCS produces hashable JSON by constraining input to I-JSON, using
  ECMAScript primitive serialization, recursively sorting object properties,
  omitting inter-token whitespace, and encoding the result as UTF-8. It rejects
  non-finite numbers, recommends strings for integers beyond IEEE-754 precision,
  and deliberately does not normalize Unicode. RFC 8785 is an Informational RFC,
  not an Internet Standards Track document.
  [RFC 8785 §§3.1–3.2](https://www.rfc-editor.org/rfc/rfc8785.html#section-3)
- FIPS 180-4 specifies SHA-256 and other secure hash algorithms for message
  digests used to detect changes. [NIST FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
- NIST SP 800-92 recommends securely retaining the original digest so later log
  changes can be detected. [NIST SP 800-92, §3.1](https://nvlpubs.nist.gov/nistpubs/legacy/SP/nistspecialpublication800-92.pdf#page=29)
- NIST SP 800-53 AU-9 requires protection from unauthorized access,
  modification, and deletion; its enhancements identify separate storage,
  cryptographic integrity protection, and restricted read-only access as
  stronger controls. [NIST SP 800-53 Rev. 5, AU-9](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf#page=100)

### Workbench design inference: versioned chain

Hash the UTF-8 JCS bytes of this versioned envelope using SHA-256:

```json
{
  "chain":"project-workbench.audit",
  "version":1,
  "sequence":"42",
  "previousHash":"sha256:<64 lowercase hex chars>",
  "event":{
    "auditId":"audit-...",
    "occurredAt":"2026-08-31T03:04:05.000Z",
    "actor":{"kind":"owner","id":"owner"},
    "action":"project.updated",
    "reason":{"code":"owner-edit","detail":"bounded safe text"},
    "object":{"type":"project","id":"project-...","version":"7"},
    "commandId":"command-...",
    "causationId":"cause-...",
    "outcome":"committed",
    "summary":{"changedFields":["name"]}
  }
}
```

Use a documented fixed genesis value. Store `sequence` and versions as decimal
strings in the hash envelope so future 64-bit values do not cross JavaScript's
safe-integer boundary. Canonicalize normalized committed values, preserve their
Unicode code points exactly, and reject values outside the JCS/I-JSON domain.
Run the RFC vectors in tests rather than assuming ordinary `JSON.stringify`
property order is canonical.

Store the canonical envelope, 32-byte digest, previous digest, algorithm and
format version, plus indexed safe columns for Activity filters. Verification
must re-canonicalize/compare the envelope, recompute every digest, check sequence
continuity, compare each `previousHash`, and compare the final digest with an
optional trusted checkpoint.

Serialize appends with the same `BEGIN IMMEDIATE` write transaction and keep a
singleton mutable chain-head row. Add permanent `BEFORE UPDATE` and
`BEFORE DELETE` triggers on `audit_event` that `RAISE(ABORT, ...)`; SQLite
supports trigger-raised constraint aborts.
[SQLite `CREATE TRIGGER` and `RAISE`](https://www.sqlite.org/lang_createtrigger.html#the_raise_function)

A plain chain plus a head stored only in the same database is not proof against
an attacker who can rewrite the entire database and head. It detects interior
modification/deletion/reordering, and suffix deletion only when a trusted prior
head exists. Expose `verifyAuditChain(trustedHead?)` in T03 and let the later
backup ticket checkpoint the head outside the live database. If the threat
model later requires resistance to a database-writing administrator, sign or
MAC external checkpoints with a key held outside the business database; do not
overstate a SHA-256 chain as non-repudiation.

NIST's separate-storage guidance and T03 atomicity can coexist: append the
authoritative event in the same database transaction, then asynchronously copy
or checkpoint committed audit material to protected storage. Do not dual-write
the command transaction to another file or service.

## 5. Sensitive-data exclusion and Activity projection

### Source facts

OWASP says session identifiers, access tokens, authentication passwords,
database connection strings, encryption keys/primary secrets, sensitive PII,
and data above the logging system's classification should usually be removed,
masked, sanitized, hashed, or encrypted rather than logged directly. It also
recommends input sanitization and tamper detection, restricted access, and
monitoring log access.
[OWASP Logging Cheat Sheet — data to exclude](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude),
[protection](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#protection)

NIST likewise notes that logs can capture passwords and other sensitive content
and therefore need confidentiality and integrity protection.
[NIST SP 800-92, §2.3.2](https://nvlpubs.nist.gov/nistpubs/legacy/SP/nistspecialpublication800-92.pdf#page=22)

### Workbench design inferences

- Build audit events from an allowlisted typed schema; do not accept an
  arbitrary `metadata` object, exception, request, headers, or adapter response.
  Redact before persistence and before hashing. Hashing a secret is not the same
  as excluding it, and append-only storage makes later cleanup especially hard.
- Never persist raw passwords, recovery codes, session cookies/tokens,
  authorization headers, Feishu/model/API tokens, database URLs, encryption
  keys, full request/response bodies, raw stack traces, subprocess environments,
  or hidden model reasoning. Store a stable error/reason code and bounded safe
  diagnostic; store credential references, never values.
- Derive `actor` from `AuthorizationPolicy`/Host principal, never caller JSON.
  For unauthenticated login failures use an explicit anonymous/system actor and
  a safe reason code; do not copy the submitted password or session token.
- Require `reason.code`; allow a short normalized `reason.detail` only for
  actions where it is useful. Store the committed object version and the exact
  `causationId` from the command envelope.
- Activity should query only safe indexed audit columns and return summaries,
  never the canonical audit envelope or Outbox payload. Support cursor paging
  by sequence plus ticket-required filters for project, object, and action.
  Restrict Activity through the same Owner authorization seam as every query.
- Keep operational request-attempt logs separate from the permanent business
  audit ledger. A replay of an already committed command may be counted in
  redacted operations telemetry, but must not append a second committed audit
  event.

## 6. Minimum behavioral evidence for T03

These are design inferences tailored to the project's scenario-first testing
contract.

1. **Atomic fault matrix:** inject failure after the business write, each
   Outbox insert, audit insert/head update, and receipt insert; after restart,
   assert none of the five artifacts partially committed.
2. **Response-loss replay:** commit, suppress the response, then retry the same
   key/intent. Assert the identical result, one business version increment, one
   Outbox intent, and one audit event. Concurrent identical retries must do the
   same; a changed intent with that key must fail deterministically.
3. **SQLite contention:** use two real connections/process-level repository
   instances. Prove bounded `BEGIN IMMEDIATE` acquisition/failure and no
   duplicate chain sequence or receipt.
4. **Outbox crash windows:** crash before send (`pending`), after attempt start
   with no final result (`unknown`), after remote success before local finalize
   (`unknown`, reconciles to `delivered`), and after definitive rejection
   (`failed`). Prove no fresh key is used for an ambiguous retry.
5. **Hash verification:** use RFC 8785 vectors; detect field mutation, interior
   deletion, reorder, previous-hash change, and suffix deletion when a trusted
   head is supplied. Verify old format versions without rewriting them.
6. **Secret canaries:** exercise login/recovery, command, adapter failure, and
   Activity. Search audit/Outbox diagnostics and database/WAL bytes for the
   canary password, recovery code, session token, API token, and Authorization
   header; they must never have entered persistent storage.
7. **Public surface:** through `WorkbenchScenario`, real Loader/Profile, and the
   generated Remote, prove authorization, actor derivation, Activity filters,
   post-commit publication, cancellation ownership transfer, restart recovery,
   and disposal quiescence.

## Decision summary

- Use one SQLite file, `BEGIN IMMEDIATE`, WAL, foreign keys, busy timeout, and
  `synchronous=FULL`.
- Make the command receipt, business mutation, Outbox insert, and audit append
  one transaction; do all external I/O after commit.
- Deduplicate explicit caller intent, not coincidentally equal payloads.
- Treat at-least-once delivery as normal; keep provider/consumer idempotency and
  reconciliation explicit.
- Make `unknown` a durable, sticky truth for ambiguous external outcomes.
- Hash RFC 8785 canonical UTF-8 envelopes with SHA-256, version the format, and
  verify against an external trusted head when suffix-deletion detection matters.
- Use an allowlist for permanent audit data and expose only a safe Activity
  projection.
