# T07 research: Feishu Bot/User connection center and actor continuity

Research date: 2026-08-31

Ticket: [#8 — T07 Feishu Bot/User connection center](https://github.com/benz-ai-x/dsh-project-workbench/issues/8)

Runtime in scope: the Workbench Host, its generated Remote contract, the
Workbench-owned SQLite repository, the pinned DSH Credentials provider, one
private injectable Feishu adapter, and one authenticated Owner connection-center
Client surface. Project task-list/calendar binding and all Feishu writes remain
outside T07.

This note uses official Feishu Open Platform documentation, the audited
DeepSeek Harness source pinned by this repository, and the approved Workbench
design/spec/contract. It separates **source facts** from **Workbench design
inferences**. Feishu documentation defines the external API behavior; it does
not define Workbench's domain or persistence model.

## Executive recommendation

Implement one Feishu connection containing two explicit identity slots:
`bot` and `user`. Each slot resolves one externally provisioned DSH
`CredentialRef` on the Host for each operation:

- Bot uses an App Secret reference. The Host exchanges it for a
  `tenant_access_token` in memory and calls Feishu as the application.
- User uses a pre-provisioned `user_access_token` reference and calls Feishu as
  that user.

T07 must not accept an App Secret or token value in the browser, configuration
command, SQLite database, audit event, Outbox, receipt, log, diagnostic, or
Client projection. A Workbench connection may store the **name** of a
`CredentialRef`; only `ctx.credentials.resolve()` may reveal the value, and
only inside the Host operation that needs it. The Client receives
`configured/source/writable` facts obtained through `describe()`, never a
resolved value. The connection page does not need to echo the reference name.

The first successful identity probe creates an immutable actor binding. Later
token rotation must prove the same principal. A deliberate principal change
creates a new binding and retires the old one; it never rewrites an existing
actor. Every later Feishu resource reference records the exact
`FeishuActorRef` that discovered it. Adapter calls require that actor ref and
have no Bot-to-User or User-to-Bot fallback path.

Model permissions as three separate evidence layers, not one “authorized”
boolean:

1. **configured** — scopes Workbench expects the operator/app to configure;
2. **effective** — scopes Feishu authoritatively reported for this grant, or a
   known missing-scope result; and
3. **probed** — dated endpoint/capability/resource observations made with one
   exact actor.

T07's externally provisioned tokens usually have no issuance response from
which Workbench can recover the complete effective scope set. Therefore
`effective` is often `unknown`, while a self probe or a selected read-only
Task-list probe can still provide honest, bounded evidence. A successful Bot
self probe does not prove Task scope; a successful scoped API does not prove
access to every resource.

Use Feishu's no-scope self endpoints to identify each actor, and an optional
Owner-selected Task-list read probe to demonstrate the required distinction
between API scope and resource ACL:

- Bot: `GET /open-apis/bot/v3/info` with the tenant token;
- User: `GET /open-apis/authen/v1/user_info` with the user token; and
- either actor: `GET /open-apis/task/v2/tasklists/:tasklist_guid` with the same
  actor used for discovery.

Validation is an observation, not an atomic authorization grant. Resolve the
credential and call Feishu outside SQLite transactions, then commit a sanitized
validation snapshot only if the connection revision is unchanged. DSH
Credentials and Workbench SQLite are separate stores and cannot participate in
one ACID transaction. Never claim that a validation snapshot is current beyond
its actor, config revision, endpoint, resource, and `observedAt` fence.

T07 deliberately does **not** implement an OAuth redirect/callback, PKCE,
refresh-token rotation, or DSH `GrantRecord`. It leaves a versioned credential
source union so a future v3 OAuth grant can replace the external user-token ref
without changing `FeishuActorRef` or resource-continuity semantics.

## 1. Ticket boundary and inherited constraints

### Source facts

- Ticket #8 requires Bot and User configuration/validation, real permission
  status, separate scope-versus-resource-ACL errors, identity continuity, no
  automatic identity switching, and audited validation/configuration changes.
  [Ticket #8](https://github.com/benz-ai-x/dsh-project-workbench/issues/8)
- The approved design assigns background synchronization and application-agent
  work to Bot, and personal resources or actions explicitly on behalf of the
  Owner to User. Every call must choose an identity explicitly, and an ID
  discovered through one identity must continue through that identity.
  [V1 design §14.1](../design/project-workbench-v1.md#141-%E5%8F%8C%E8%BA%AB%E4%BB%BD)
- The design treats Feishu Tasks and Calendar as external authorities and
  explicitly requires missing API scope and invisible resource ACL to remain
  distinct.
  [V1 design §5](../design/project-workbench-v1.md#5-%E8%81%94%E9%82%A6%E4%BA%8B%E5%AE%9E%E6%BA%90%E6%9E%B6%E6%9E%84)
- The V1 spec requires explicit Bot/User routes, no permission-bypass switch,
  credentials outside the business database, and federation tests for expired
  credentials, scope failures, ACL failures, and identity continuity.
  [V1 spec](../specs/project-workbench-v1-spec.md#review-pmo-and-external-effects),
  [testing decisions](../specs/project-workbench-v1-spec.md#testing-decisions)
- T05's declared Feishu human `{appId, openId}` is app-scoped metadata rather
  than verified connector truth. T07 verifies connection identity/capability;
  T08 remains responsible for actual Feishu task assignment.
  [Project contract: T05](../agent/PROJECT_CONTRACT.md#t05-projectmember-and-responsibility-invariants)
- The Workbench Host owns truth, authorization, persistence, external effects,
  and generated Remote behavior. The Client consumes detached, explicit
  projections and cannot import credentials or an external adapter.
  [Project contract](../agent/PROJECT_CONTRACT.md#invariants)

### Workbench design inferences

- T07 extends the current `WorkbenchScenario`, repository, command ledger,
  authorization policy, generated `workbench` Remote, and existing Client Slot.
  It must not introduce a second database, a browser-authoritative permission
  state machine, a custom DSH Session event, or a Harness-core patch.
- The private `FeishuAdapter` is a deterministic scenario seam, not a public
  Cordis Service/registry yet. There is one provider and one Host consumer in
  T07; a public provider/consumer API would be premature.
- Connection configuration and validation are Owner-authorized Host commands.
  Actor, organization/team scope, IDs, time, audit vocabulary, and safe error
  mapping remain Host-derived.
- External validation calls are read-only. T07 performs no Task, Calendar,
  document, chat, approval, or permission mutation.

## 2. Official Feishu token and identity facts

### 2.1 Application and user tokens are different actors

#### Source facts

- Feishu defines multiple access-token types for different calling identities.
  `tenant_access_token` represents an application in a tenant, while
  `user_access_token` represents a user. The selected token changes the caller
  and the data range available to the API.
  [Access-token overview](https://open.feishu.cn/document/ukTMukTMukTM/uMTNz4yM1MjLzUzM),
  [official token-selection guidance](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-choose-which-type-of-token-to-use)
- Feishu says access tokens are server-side credentials and should not be used
  in frontend code.
  [Access-token overview](https://open.feishu.cn/document/ukTMukTMukTM/uMTNz4yM1MjLzUzM)
- A self-built app obtains a tenant token from its App ID and App Secret. The
  token is valid for at most two hours; Feishu can return the existing token
  while it has at least 30 minutes left and a new one when less remains.
  [Self-built app tenant token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- `GET /open-apis/bot/v3/info` accepts only a tenant token, requires no API
  scope, and returns Bot identity/activation facts including `open_id`, app
  name, activation status, avatar, and IP allowlist.
  [Get Bot information](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info)
- `GET /open-apis/authen/v1/user_info` accepts a user token, requires no API
  scope, and returns user identity facts including `open_id`, `union_id`,
  `tenant_key`, and name.
  [Get user information](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- Tenant metadata can be queried with a tenant token, but that endpoint itself
  requires `tenant:tenant:readonly`. It must not be silently made mandatory
  merely to validate a Bot.
  [Get tenant information](https://open.feishu.cn/document/server-docs/tenant-v2/query)

#### Workbench design inferences

- `bot` and `user` are domain discriminants, not interchangeable credential
  strategies. Code must not expose “try any available token.”
- Bot validation exchanges the App Secret for a tenant token and immediately
  calls Bot info. The tenant token is ephemeral and never persisted, projected,
  logged, or included in error data.
- User validation resolves the externally supplied user token and calls user
  info. It allowlists only the identity fields Workbench needs; it does not
  retain email, mobile, the raw response, or unrelated profile fields.
- A Bot-info success proves the application actor and activation state only.
  It does not prove tenant-read, Task, Calendar, Docs, or any resource ACL.
- T07 does not require `tenant:tenant:readonly`. If the operator configured it,
  tenant query may be a separate optional probe. Otherwise Bot tenant metadata
  remains unknown rather than causing over-privilege.
- User info does not prove that an externally provisioned user token was issued
  for the configured App ID. T07 must expose that app-binding evidence as
  `unknown`. A future Workbench-owned OAuth grant can prove it because the grant
  originates through the configured app.

### 2.2 Future OAuth grant facts, not T07 behavior

#### Source facts

- Feishu's OAuth authorization code is short-lived and one-time. Redirect URIs
  must be registered, and the caller must generate and verify `state` to defend
  against CSRF.
  [Obtain OAuth code](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)
- Feishu's v3 token endpoint returns expiration data that clients must honor.
  An `offline_access` grant is required to receive a refresh token, and the
  response contains the actual scope granted to the user token.
  [Get user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- The v3 refresh operation rotates the refresh token. The old and new grant
  values must be replaced together; eventually the user must authorize again.
  [Refresh user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token-v3)

#### Workbench design inferences

- These facts justify a later OAuth v3 grant provider with `state`, registered
  redirect URI, PKCE after tenant verification, expiry-aware refresh, and
  serialized refresh-token rotation. They do not justify implementing a
  partial callback in T07.
- The future flow must store access/refresh tokens and grant metadata in a DSH
  `GrantRecord`, never SQLite. The Workbench connection continues to point to a
  versioned credential source and to the same actor binding when the verified
  principal is unchanged.

## 3. Permission evidence has three layers

Feishu permission is not one boolean. T07 defines the following normalized
model for each scope/capability.

```ts
type EffectiveScopeState = 'granted' | 'missing' | 'unknown'

type ProbeOutcome =
  | Readonly<{ kind: 'passed' }>
  | Readonly<{ kind: 'not-run' }>
  | Readonly<{
      kind: 'failed'
      code:
        | 'feishu-credential-unconfigured'
        | 'feishu-credential-unavailable'
        | 'feishu-bot-secret-rejected'
        | 'feishu-actor-token-invalid'
        | 'feishu-token-type-unsupported'
        | 'feishu-app-scope-missing'
        | 'feishu-user-grant-missing'
        | 'feishu-resource-acl-denied'
        | 'feishu-resource-not-found'
        | 'feishu-actor-disabled'
        | 'feishu-actor-identity-mismatch'
        | 'feishu-realm-mismatch'
        | 'feishu-rate-limited'
        | 'feishu-transport-failed'
        | 'feishu-provider-failure'
    }>

interface FeishuScopeEvidence {
  readonly scope: string
  readonly configured: boolean
  readonly effective: EffectiveScopeState
  readonly effectiveSource:
    | 'oauth-token-response'
    | 'feishu-app-scope-error'
    | 'feishu-user-grant-error'
    | 'none'
  readonly probes: readonly FeishuCapabilityProbe[]
}

interface FeishuCapabilityProbe {
  readonly capability: 'bot-self' | 'user-self' | 'tenant-read' | 'tasklist-read'
  readonly actorRef: FeishuActorRef
  readonly resourceRef?: Readonly<{
    kind: 'tasklist'
    id: string
  }>
  readonly outcome: ProbeOutcome
  readonly observedAt: string
  readonly configRevision: number
}
```

### Layer 1: `configured`

`configured` is Workbench/operator intent: the scope is listed as required or
expected for an enabled capability. It does not prove that an app version was
published with that scope, that a tenant admin approved it, that the user
granted it, or that any resource ACL admits the actor.

T07 should ship a small closed capability catalog rather than arbitrary free
text. At minimum it can describe:

| Capability | Actor | Expected scope | Probe |
|---|---|---|---|
| Bot identity | Bot | none | Bot info |
| User identity | User | none | User info |
| Tenant metadata | Bot | `tenant:tenant:readonly` | optional tenant query |
| Task-list read readiness | Bot/User | `task:tasklist:read` (or API-supported write alternative) | selected Task list |

Configured scope names are not authorization facts and must be labeled as
“expected/configured,” not “granted.”

### Layer 2: `effective`

`effective` is an authoritative observation about the grant itself:

- `granted` only when Feishu returned the scope in token/grant metadata;
- `missing` when a recognized Feishu permission error identifies that scope or
  user privilege as absent; and
- `unknown` when T07 has no authoritative grant metadata.

T07's external `CredentialRef` path did not execute the user-token issuance
flow and therefore normally cannot reconstruct the token's complete scope set.
Bot app permissions likewise have no documented all-scopes introspection path
selected for this ticket. `unknown` is the honest default.

A successful API whose documentation accepts either read or write scope proves
the capability worked for that request; it does not identify which alternative
scope was granted. That evidence belongs in `probed`, not in an invented exact
effective-scope set.

### Layer 3: `probed`

`probed` is dated evidence for one exact actor, endpoint, and optional resource.
It answers “did this capability work here at this time?” It never answers “can
this actor access every object of this type?”

Store only allowlisted probe facts: capability, actor binding ID, outcome,
timestamp, config revision, and a sanitized provider code/request ID when safe.
Do not store headers, tokens, App Secret, raw body, raw error, URL query, or SDK
request/response objects.

The page should show all three columns. In particular:

- configured + effective unknown + probe passed is valid;
- configured + effective missing + scope probe failed is actionable;
- configured + effective unknown + resource ACL denied is also actionable but
  requires a different recovery; and
- no recent probe is “not validated,” never “authorized.”

## 4. A Task-list probe cleanly separates scope and resource ACL

### Source facts

- `GET /open-apis/task/v2/tasklists/:tasklist_guid` accepts either a tenant or
  user token and requires one of `task:tasklist:read` or
  `task:tasklist:write`.
  [Get Task list](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/get)
- The endpoint documents `1470403` when the current calling identity lacks
  read ACL for that Task list, `1470404` when the list does not exist or was
  deleted, and separate invalid-parameter/server errors.
  [Get Task list errors](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/get)
- Task-list readability depends on resource roles such as owner/editor/viewer,
  independently of the API scope required to invoke the endpoint.
  [Task-list overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/overview)
- Feishu also documents resource-specific denial on a no-scope image download:
  the app can be denied because it is not the resource sender. This is another
  official example of resource access remaining independent of API scope.
  [Download image](https://open.feishu.cn/s/61BYfeQRQ0s)

### Workbench design inferences

- The Connection Center may accept an optional Owner-selected Task-list GUID as
  a **diagnostic read-only probe**. It does not bind the list to a Project and
  does not make Workbench authoritative for the list; T08 owns binding.
- Execute the probe separately for Bot or User with the actor explicitly chosen
  by the Owner. Store that actor in the probe record. Never retry `1470403`
  with the other actor.
- Map recognized missing-scope errors to `scope-missing`; map documented
  `1470403` to `resource-acl-denied`; and map `1470404` to
  `resource-not-found`. Do not collapse them into “no permission.”
- Do not generically map every provider 403/404 to ACL denial or not-found.
  Error translation is endpoint-specific and closed. Unknown codes remain a
  sanitized `provider-failure`.

## 5. CredentialRef boundary on the pinned DSH baseline

### Source facts

- The pinned DSH credential-reference seam keeps secret values out of settings
  and lets configuration carry environment-shaped references. `resolve(ref)`
  returns the value only on the Host; `describe(ref)` returns
  `configured/source/writable` without a value.
  [Audited CredentialProvider source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/index.ts),
  [repository baseline lock](../../dsh-reference.lock.json)
- Consumers must resolve a reference for each operation rather than cache the
  credential across operations. That is how rotation takes effect without a
  plugin restart.
  [Audited DSH Credentials README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/README.md)
- A DSH `CredentialRef` uses a POSIX environment-variable grammar. Durable
  records use a disjoint owner-scoped `<scope>/<id>` key. A `GrantRecord`
  payload is opaque to the credentials seam, and `modifyRecord()` provides the
  serialized read-modify-write needed for token rotation.
  [Credential types](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/types.ts),
  [CredentialProvider record API](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/index.ts)
- Credential update notifications occur after the credential provider's change
  committed, and listener failure does not roll that credential change back.
  Ambient environment changes are not observable events.
  [Audited DSH Credentials README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/README.md)

### T07 credential-source contract

```ts
type FeishuCredentialSourceV1 =
  | Readonly<{
      kind: 'bot-app-secret-ref-v1'
      ref: CredentialRef
    }>
  | Readonly<{
      kind: 'user-access-token-ref-v1'
      ref: CredentialRef
    }>

type FeishuUserCredentialSource =
  | Extract<FeishuCredentialSourceV1, { kind: 'user-access-token-ref-v1' }>
  | Readonly<{
      // Reserved contract only; not accepted by T07 runtime codecs.
      kind: 'oauth-grant-v3'
      credentialKey: CredentialKey
    }>
```

The runtime schema accepts only the two v1 variants. The v3 variant records the
migration seam; it is not selectable until a future ticket implements and
tests the OAuth lifecycle.

### Storage and projection allowlist

| Value | DSH Credentials | Workbench SQLite | Client projection | Audit/Outbox/receipt/log |
|---|---:|---:|---:|---:|
| App ID / realm | no | yes | yes | safe code/connection ID only |
| CredentialRef name | provider address only | yes, as config metadata | not required; omit | no |
| App Secret | yes, behind ref | never | never | never |
| tenant access token | ephemeral only | never | never | never |
| user access token | yes, behind ref | never | never | never |
| future refresh token | future grant record | never | never | never |
| credential configured/source/writable | derived by `describe()` | optional dated observation | yes | safe summary only |
| Feishu raw response/error | no | never | never | never |
| sanitized validation result | no | yes | yes | bounded summary code |

The reference name is non-secret configuration metadata, but minimizing its
projection and generic-ledger exposure reduces accidental coupling. The UI
should show whether the external credential is configured and writable, not
offer a password/token field.

### Operation rules

1. Authorize the Owner before reading connection configuration or credentials.
2. Validate the stored reference name with DSH `credentialRef()`.
3. Call `describe()` for UI-safe configured/source/writable facts.
4. Call `resolve()` only inside the Host operation using the credential.
5. Keep the resolved value in the smallest lexical scope and never attach it to
   an Error, observer, adapter result, trace attribute, or diagnostic.
6. Preserve the caller's `AbortSignal` through token exchange and every probe.
7. Re-resolve on the next operation. T07 does not build a cross-operation token
   cache.
8. On disposal, close admission, abort owned transports, await their settlement,
   remove Remote/Client contributions, and only then close owned persistence.

## 6. Connection, actor binding, and actorRef model

### Recommended aggregate

```ts
type FeishuActorKind = 'bot' | 'user'

interface FeishuConnection {
  readonly connectionId: string
  readonly revision: number
  readonly realm: 'feishu-cn'
  readonly appId: string
  readonly bot: FeishuIdentitySlot
  readonly user: FeishuIdentitySlot
  readonly createdAt: string
  readonly updatedAt: string
}

type FeishuIdentitySlot =
  | Readonly<{
      kind: 'bot'
      credentialSource:
        | Extract<FeishuCredentialSourceV1, { kind: 'bot-app-secret-ref-v1' }>
        | null
      configuredScopes: readonly string[]
      activeActorBindingId: string | null
      status: 'unconfigured' | 'configured' | 'verified' | 'degraded' | 'disabled'
    }>
  | Readonly<{
      kind: 'user'
      credentialSource:
        | Extract<FeishuCredentialSourceV1, { kind: 'user-access-token-ref-v1' }>
        | null
      configuredScopes: readonly string[]
      activeActorBindingId: string | null
      status: 'unconfigured' | 'configured' | 'verified' | 'degraded' | 'disabled'
    }>

interface FeishuActorBinding {
  readonly actorBindingId: string
  readonly connectionId: string
  readonly kind: FeishuActorKind
  readonly realm: 'feishu-cn'
  readonly appId: string
  readonly principalOpenId: string
  readonly tenantKey: string | null
  readonly displayName: string
  readonly firstVerifiedAt: string
  readonly retiredAt: string | null
}

interface FeishuActorRef {
  readonly provider: 'feishu'
  readonly actorBindingId: string
  readonly kind: FeishuActorKind
}
```

The public `FeishuActorRef` is intentionally small. The Host resolves it to the
immutable binding and current credential source. Browser or future connector
callers cannot construct authority by supplying an App ID, open ID, or token.

### Binding rules

1. A new identity slot has no actor binding. Its first successful self probe
   creates one from Host-derived Feishu identity facts.
2. Token/App Secret rotation changes only the credential reference or value.
   The next successful self probe must match the existing binding's kind,
   realm, App ID claim where verifiable, tenant, and principal.
3. A mismatch is `actor-identity-mismatch`, not an automatic rebind.
4. An explicit Owner rebind is a separate version-checked configuration
   command. It retires the old binding and creates a new binding only after a
   successful self probe. It never mutates the old principal in place.
5. A future resource discovered by an actor stores the exact `actorRef`:

   ```ts
   interface FeishuExternalResourceRef {
     readonly resourceKind: string
     readonly resourceId: string
     readonly discoveredBy: FeishuActorRef
     readonly discoveredAt: string
   }
   ```

6. Read, reconcile, refresh, or mutate receives `discoveredBy` explicitly. If
   the binding is retired, disabled, mismatched, or unavailable, the operation
   fails with that actor. It does not search for another usable slot.
7. Explicit migration to another actor is a later reviewed domain operation
   that must revalidate the resource and preserve provenance. T07 does not
   implement it.

### Privacy boundary

Authorized Connection Center detail may show the verified display name,
activation state, and an appropriately presented external ID so the Owner can
recognize the actor. Generic Activity, audit, Outbox, receipts, logs, and error
messages retain only `connectionId`, actor kind, binding ID, safe result code,
and correlation IDs. They do not contain open IDs, tenant keys, display names,
resource GUIDs, credential refs, or provider bodies.

## 7. Validation flow and commit points

### Configure connection/slot

A configuration command carries exact expected revision, caller-stable
idempotency key, causation ID, bounded reason, realm/App ID, actor slot, a
validated credential-ref name, and closed configured capabilities. It never
carries a secret or token value.

Inside one synchronous SQLite transaction, after authorization and validation,
commit the connection revision, redacted Outbox intent, hash-chained audit
event, and replay receipt. The receipt contains only safe IDs, versions, actor
kind, status codes, and correlations. It does not echo the reference name.

Changing only a credential ref preserves the expected actor binding. Changing
realm/App ID or explicitly replacing a principal uses the rebind path and
creates new identity provenance.

### Validate identity/capability

Use this ordering:

1. Authorize `workbench.feishu.connection.validate` and derive Owner scope.
2. Normalize the request and look up a same-actor/idempotency receipt before
   any credential or network work. A replay returns the stored result.
3. Read and detach the connection at exact revision.
4. Call DSH `describe()` and `resolve()` outside SQLite.
5. For Bot, exchange App Secret for a tenant token; for User, use the resolved
   user token. Keep both Host-only and ephemeral.
6. Run the actor self probe. If it succeeds, compare the principal with any
   existing binding. Stop on mismatch.
7. Run only the explicitly selected optional capability/resource probes, using
   the exact same actor. Never call the other slot.
8. Normalize raw provider results into the closed error/evidence vocabulary.
9. Begin a synchronous SQLite transaction. Recheck the receipt and connection
   revision. If configuration advanced, reject the observation as stale.
10. Append a detached validation snapshot, create the initial binding if legal,
    update the connection head, and atomically append the redacted Outbox,
    audit event, and receipt.
11. Publish a whole new Host projection only after commit.

No `await`, credential resolution, HTTP call, SDK call, logging callback, or
observer runs while SQLite holds its write transaction.

### Idempotency and races

- The same validation idempotency key and normalized request returns its stored
  observation without another network call after commit.
- Two first-time validations may both perform read-only probes, but only one
  exact connection CAS creates/binds state; the loser replays or receives a
  conflict without a second binding.
- A credential can rotate while validation is in flight. The stored result is
  truthfully “what this operation observed,” not proof about the replacement.
- A DSH credential-update event may mark matching connection validations stale
  and prompt revalidation, but it is post-credential-commit observation and
  cannot make SQLite and Credentials atomic. Ambient environment changes emit
  no event, so time and revalidation remain necessary.

## 8. Stable error taxonomy and recovery

### Official error facts

- Feishu documents `99991672` with
  `error.permission_violations.type = action_scope_required` for missing app
  API scope.
  [Resolve 99991672](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-fix-the-99991672-error)
- Feishu documents `99991679` with
  `type = action_privilege_required` when the user did not grant the required
  privilege; recovery requires user authorization again.
  [Resolve 99991679](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-resolve-error-99991679)
- Feishu's common errors include distinct invalid/unsupported tenant-token and
  user-token cases (`99991663` and `99991668`).
  [Common server API errors](https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN)
- Task-list `1470403` is the current actor's resource ACL denial, while
  `1470404` is missing/deleted.
  [Get Task list](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/get)

### Workbench error contract

| Stable Workbench code | Meaning | Owner recovery | Automatic behavior |
|---|---|---|---|
| `feishu-credential-unconfigured` | DSH ref is absent/blank | provision the named external credential | no network; no fallback |
| `feishu-credential-unavailable` | credentials service/read failed | repair DSH provider/configuration | fail closed |
| `feishu-bot-secret-rejected` | App ID/App Secret exchange failed | verify App ID, secret ref, app state | re-resolve only on a new command |
| `feishu-actor-token-invalid` | same actor token expired/invalid | reprovision that actor's credential | never switch actor |
| `feishu-token-type-unsupported` | endpoint does not support selected actor token | correct explicit route/capability | never try other type |
| `feishu-app-scope-missing` | app scope absent/not published/approved | add and publish/approve app scope | no retry until config changes |
| `feishu-user-grant-missing` | app may have scope but user grant lacks it | externally reauthorize/reprovision User token in T07 | no Bot fallback |
| `feishu-resource-acl-denied` | exact actor lacks resource role/access | grant that same actor ACL or select another resource | no actor fallback |
| `feishu-resource-not-found` | endpoint says missing/deleted | correct resource ID or choose another | no ACL guessing |
| `feishu-actor-disabled` | Bot/application/tenant actor inactive | enable/publish/install the app | no fallback |
| `feishu-actor-identity-mismatch` | resolved credential identifies another principal | restore correct ref or explicitly rebind | block binding/use |
| `feishu-realm-mismatch` | credential/resource belongs to another realm | configure the correct realm explicitly | no cross-domain retry |
| `feishu-rate-limited` | provider rate limit | retry same actor after bounded delay | no immediate identity switch |
| `feishu-transport-failed` | timeout/DNS/TLS/network | retry same idempotent validation explicitly | no inferred auth state |
| `feishu-provider-failure` | unmapped sanitized provider failure | inspect safe request/log ID and official docs | fail closed |
| `feishu-config-conflict` | connection revision changed | refresh and validate current config | discard stale result |
| `cancelled` / `disposed` | caller or Fiber ended ownership | retry after service is active | settle quietly |

Only a recognized endpoint/token/error shape may select a specific code.
Unknown provider text is never copied into the Client or generic ledger. A
bounded Feishu request/log ID can be retained for support if reviewed as safe.

Recovery guidance must name the same actor. For example:

- Bot `1470403`: add the Bot/app as reader/editor for this Task list or choose
  a Bot-readable list;
- User `1470403`: grant that user Task-list access or choose a user-readable
  list;
- `99991672`: configure/publish the application scope; and
- `99991679`: reauthorize and externally provision a User token containing the
  grant.

“Try User instead” and “Try Bot instead” are never recovery suggestions for a
bound resource.

## 9. SQLite and DSH Credentials are not one transaction

### Source facts

- DSH Credentials owns and commits its own reference/record store. Workbench's
  business ledger is a separate SQLite file and transaction boundary.
  [Audited CredentialProvider source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/index.ts),
  [Project contract: T02](../agent/PROJECT_CONTRACT.md#t02-identity-and-transport-invariants)
- Credential notifications are post-commit and contained; a listener cannot
  roll back a credential change. Environment-source changes may have no event.
  [Audited DSH Credentials README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/README.md)

### Workbench design inferences

- T07 avoids a cross-store write by requiring credentials to be provisioned
  externally before Workbench references them. `configure` writes only safe
  connection metadata and the reference name to SQLite.
- A successful `describe()` immediately before SQLite commit is still only an
  observation. The ref can change before or after commit.
- A validation result binds to `connectionRevision`, `actorBindingId`,
  capability/resource, and `observedAt`. It never says the credential remains
  current indefinitely.
- Workbench-owned config changes and validation records are auditable in the
  SQLite hash chain. External credential provisioning/rotation is owned by DSH
  Credentials and cannot honestly be claimed as the same atomic audit event.
  A post-commit update listener may append a safe “credential observation
  changed” event, but loss of that observer cannot reverse or invalidate the
  credential provider's commit.
- Do not solve this with a best-effort two-write “transaction,” a raw secret
  copy in SQLite, a secret digest in the audit log, or an unbounded raw error
  payload.

### Future OAuth migration seam

A later OAuth v3 flow will necessarily write both stores. It must use an
explicit state machine rather than claim atomicity:

1. persist a pending, nonce/state-bound connection intent without credentials;
2. complete OAuth and atomically write/rotate one DSH `GrantRecord` through
   `modifyRecord()`;
3. verify the returned user identity and grant scope;
4. activate the SQLite connection through exact revision CAS, referring only
   to the `CredentialKey`; and
5. reconcile an orphan grant or pending connection after crash.

Refresh uses serialized `modifyRecord()` so access token, rotated refresh token,
expiry, and effective scopes change together inside the credential store. The
actor binding remains unchanged only after the refreshed access token proves
the same principal.

## 10. Connection Center projection and interaction

The authorized whole-value projection should contain no credential values and
no raw provider objects. A minimal shape is:

```ts
interface FeishuConnectionCenterProjection {
  readonly connectionId: string | null
  readonly revision: number
  readonly realm: 'feishu-cn'
  readonly appId: string | null
  readonly identities: Readonly<{
    bot: FeishuIdentityProjection
    user: FeishuIdentityProjection
  }>
}

interface FeishuIdentityProjection {
  readonly kind: 'bot' | 'user'
  readonly configStatus: 'unconfigured' | 'configured' | 'disabled'
  readonly credential: Readonly<{
    configured: boolean
    source?: string
    writable: boolean
  }>
  readonly actor: Readonly<{
    actorRef: FeishuActorRef
    displayName: string
    externalId: string
    tenantKey?: string
    activationStatus?: string
  }> | null
  readonly scopeEvidence: readonly FeishuScopeEvidence[]
  readonly latestValidation: Readonly<{
    status: 'passed' | 'partial' | 'failed' | 'stale'
    observedAt: string
    configRevision: number
    outcomes: readonly ProbeOutcome[]
  }> | null
}
```

The actual transport codecs should bound all arrays/strings, close every union,
and return detached objects. Sensitive external IDs may be masked in summary
cards and shown in detail for the authenticated Owner.

### Required UI states

- service/loading versus no connection configured;
- configured ref absent from DSH versus credential present;
- identity unvalidated, verified, degraded, disabled, or stale;
- configured/effective/probed scope columns with explanatory labels;
- missing app scope, missing User grant, resource ACL denial, and not-found as
  distinct textual errors and recovery actions;
- validation pending, exact config conflict, transport failure, and successful
  whole-value refresh;
- stale/disconnected transport that retains the last authoritative snapshot
  without presenting it as current;
- duplicate-submit fencing before the next React render; and
- draft cleanup on logout, session expiry, entity replacement, HMR/Fiber
  disposal, and explicit cancel.

The page never contains App Secret/token inputs. It may accept an App ID,
credential-reference name, configured capability choices, and optional
Task-list GUID for a read-only diagnostic. Labels must say that secret values
are provisioned through DSH Credentials outside Workbench.

Use typed zh/en locale strings, semantic theme tokens, CSS Modules, ordinary
React props, and the existing additive/replacement Slot. Mount the generated
Remote contribution before the UI and dispose them in reverse order.

## 11. Minimal T07 delivery boundary

### In scope

- one Feishu-CN connection with explicit Bot and User slots;
- external provisioning of Bot App Secret and User access token through two DSH
  `CredentialRef`s;
- SQLite connection metadata/revision, immutable actor bindings, validation
  history, safe audit/Outbox/receipts, restart, and migration;
- Host-only per-operation `describe()`/`resolve()` and ephemeral Bot tenant-token
  exchange;
- Bot-info and user-info identity validation with exact principal continuity;
- configured/effective/probed permission evidence and honest `unknown` states;
- optional same-actor Task-list read probe demonstrating scope, User grant,
  ACL, and not-found distinction;
- stable, sanitized Feishu error mapping and actor-specific recovery guidance;
- connection query, exact-revision configuration, validation, and explicit
  actor-rebind semantics through generated Remote methods;
- an authenticated, accessible Connection Center showing both identities,
  credential presence, key scopes, and latest validation;
- deterministic adapter tests plus optional read-only contract tests against a
  dedicated Feishu test tenant;
- Loader/Profile, cancellation, disposal/remount, generated Typert, built
  Client, packed-artifact, restart, and browser evidence.

### Explicitly out of scope

- OAuth authorization page, callback, redirect server, `state`/PKCE ceremony,
  refresh-token rotation, or DSH `GrantRecord` creation;
- entering, displaying, persisting, exporting, logging, or auditing a raw App
  Secret, tenant token, user token, authorization code, or refresh token;
- Task-list/Calendar creation or Project binding, Task assignment, comments,
  task-agent steps, or any other Feishu write (T08+);
- event subscription, Inbox, reconciliation, scheduler, retry worker, or
  external-effect Outbox delivery;
- Feishu Docs/Wiki/Drive/Minutes/chat/approval/global-search ingestion;
- permission administration, app publication, tenant installation, resource
  sharing, or automatic remediation;
- global permission completeness claims or a universal Feishu scope
  introspection API;
- automatic Bot/User fallback, fastest-success routing, cross-realm fallback,
  silent principal replacement, or automatic resource migration;
- Lark/global realm support; T07 uses an explicit Feishu-CN realm and does not
  retry against another domain;
- public connector registry/Service, Harness-core changes, or custom DSH
  Session events.

## 12. Test matrix

| Area | Scenario | Required observable result |
|---|---|---|
| Config schema | malformed App ID, realm, scope, ref grammar, extra fields | rejected before publication/commit; no rows or credential reads |
| Secret boundary | sentinel App Secret/user token/provider payload | absent from SQLite, page HTML/state, Remote response, audit, Outbox, receipt, logs, errors, and packed fixtures |
| DSH describe | ref absent, configured, env/file source, read-only shadow | correct configured/source/writable projection; never a value |
| DSH resolve | credential rotates between commands | next command resolves the new value; no cross-operation cache |
| Bot exchange | valid/invalid App ID+secret, expiry-shaped response | ephemeral tenant token used only by Bot route; sanitized result |
| Bot identity | activation statuses and identity response | closed status mapping and immutable Bot binding |
| User identity | valid/expired/wrong user token | immutable User binding or exact same-actor error |
| Identity continuity | rotate credential to same principal | binding ID preserved after successful validation |
| Identity mismatch | rotate credential to another user/Bot | `actor-identity-mismatch`; binding/resources unchanged |
| Explicit rebind | Owner replaces principal with expected revision | old binding retired, new binding created, audited; no in-place rewrite |
| Scope model | configured scope but no issuance metadata | effective remains unknown; page does not claim grant |
| App scope | Feishu `99991672`/`action_scope_required` | `app-scope-missing` and publish/approve guidance |
| User grant | `99991679`/`action_privilege_required` | `user-grant-missing` and external reauthorization guidance |
| Resource ACL | Task-list `1470403` under Bot and User separately | `resource-acl-denied` names same actor; other actor is never called |
| Resource absent | Task-list `1470404` | distinct `resource-not-found`, not scope/ACL |
| Scope versus ACL | same endpoint fixtures for missing scope and ACL | different stable code, projection, audit summary, and recovery |
| No fallback | selected Bot fails while User fixture would pass, and inverse | exactly one actor route called; failure retained |
| ActorRef | discover then read/reconcile via injected adapter | exact discovery actor ref is required and forwarded |
| Token kind | tenant token on User-only or user token on Bot-only endpoint | explicit unsupported-kind error; no fallback |
| Unknown provider error | raw body contains secret/PII | bounded `provider-failure`; raw content absent everywhere |
| Config CAS | config changes while network probe is in flight | result rejected/stored stale; current head not overwritten |
| Validation replay | response loss then same key/request | stored result returned; no new rows or network probe |
| Validation key reuse | same key with changed actor/resource/config | stable idempotency conflict |
| Concurrent first validation | two successes race | at most one actor binding/head transition; one ledger unit per accepted command |
| Cross-store race | DSH ref changes before/after SQLite commit | dated observation only; no false atomicity claim; next validation sees current ref |
| Credential event | provider-managed ref update | matching UI status can become stale; listener failure cannot roll back provider |
| Ambient credential | environment changes without event | no false notification guarantee; navigation/validation re-describes |
| Cancellation | abort before/during token exchange or probe | no late commit/publication; transport receives signal |
| Disposal | dispose during admitted validation | admission closes, work aborts/settles, repository closes after drain |
| Restart | configure and validate both actors, reopen database | identical bindings/history/status; secrets still only in Credentials |
| Migration | pre-T07 schema to T07 and rollback fault points | all-or-nothing safe metadata migration and restart |
| Authorization | unauthenticated/direct cross-scope calls | fail before repository/credential/network access |
| Client | double click, reconnect, conflict, logout/expiry/HMR | one command; distinct stale/domain/transport states; protected drafts cleared |
| Loader/Profile | invalid Config and real profile composition | fail before Remote/Slot; valid rows resolve without Harness change |
| Packaging | generated faces, lazy-CJS Client, real tarballs | no source alias, secret fixture, Host adapter, or Node credential code in browser |
| Browser | configure refs, validate Bot/User, show scope and ACL failures, restart | accessible exact statuses persist; no raw credential appears |
| Live contract | dedicated test tenant and disposable Task list, read-only | official endpoints/error mapping confirmed without personal production writes |

The deterministic `FeishuAdapter` should return normalized transport envelopes
that still exercise the production mapper. Tests must assert the selected actor,
endpoint, safe projection, durable observation, and absence of a second actor
call—not merely that a mock callback ran.

## 13. Decision summary

1. **Bot and User are actors, not retries.** Every operation selects one actor;
   a permission failure never expands authority by trying the other.
2. **Identity is bound before resources.** Successful self probes create
   immutable bindings, and later resources retain the exact `FeishuActorRef`.
3. **Rotation is not rebinding.** A changed credential must identify the same
   principal; a deliberate principal replacement creates new provenance.
4. **Permission evidence is layered.** Configured intent, effective grant facts,
   and dated capability/resource probes remain separate, with `unknown` as a
   first-class honest state.
5. **Scope and ACL are different failures.** Feishu permission codes and
   Task-list `1470403` receive distinct stable errors and recovery guidance.
6. **Secrets stay behind DSH references.** SQLite may store a validated ref
   name, but no secret/token/code/value/hash; the Client receives only safe
   credential status and connection identity.
7. **Resolve per operation.** T07 does not cache credentials or derived tokens
   across commands; rotations reach the next operation through DSH.
8. **Validation is fenced observation.** Network work happens outside SQLite,
   then config CAS binds a sanitized result to actor/revision/time.
9. **The stores are not atomic.** DSH Credentials and SQLite have separate
   commit points; post-commit events and reconciliation must never be described
   as one transaction.
10. **OAuth is a future versioned source.** T07 consumes externally provisioned
    App Secret/User token refs; a later v3 grant uses `GrantRecord` and
    serialized refresh without changing actor/resource contracts.
11. **The first resource probe is read-only and diagnostic.** It proves error
    semantics but does not preempt T08 Project binding or Feishu authority.
12. **The connector seam stays private.** One injectable adapter is sufficient
    for Scenario and lifecycle testing; publish a Service only when independent
    providers/consumers justify it.

## Primary source index

| Subject | Primary source | Design use |
|---|---|---|
| Token identities | [Feishu token overview](https://open.feishu.cn/document/ukTMukTMukTM/uMTNz4yM1MjLzUzM) | application/user actor distinction and server-only token handling |
| Token selection | [Feishu guidance](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-choose-which-type-of-token-to-use) | explicit actor route; different visibility |
| Bot tenant token | [tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal) | App Secret exchange and expiry behavior |
| Bot self identity | [Bot v3 info](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info) | no-scope Bot identity/activation probe |
| User self identity | [authen v1 user info](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get) | no-scope User identity/tenant probe |
| Tenant metadata | [tenant v2 query](https://open.feishu.cn/document/server-docs/tenant-v2/query) | optional scoped tenant evidence, not mandatory validation |
| Permission axes | [scope/authorization overview](https://open.feishu.cn/document/home/introduction-to-scope-and-authorization/overview), [app data permissions](https://open.feishu.cn/document/home/introduction-to-scope-and-authorization/configure-app-data-permissions) | configured scope, token identity, API scope, data range, resource access separation |
| App scope missing | [99991672](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-fix-the-99991672-error) | `action_scope_required` mapping |
| User grant missing | [99991679](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-resolve-error-99991679) | `action_privilege_required` mapping |
| Common token errors | [Feishu common errors](https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN) | invalid/unsupported tenant versus user token |
| Task-list read | [Task v2 get](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/get) | same endpoint for Bot/User, scope and resource-specific errors |
| Task-list ACL | [Task-list overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/tasklist/overview) | owner/editor/viewer resource roles |
| Independent resource ACL | [Download image](https://open.feishu.cn/s/61BYfeQRQ0s) | no-scope endpoint can still deny by resource relationship |
| OAuth code | [Obtain OAuth code](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code) | future redirect/state/CSRF boundary |
| OAuth v3 grant | [Get user token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3) | future actual scopes, expiry, offline grant |
| OAuth v3 refresh | [Refresh user token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token-v3) | future serialized grant rotation |
| DSH refs/records | [Pinned CredentialProvider](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/index.ts), [types](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/credentials/credentials/src/types.ts) | per-operation resolve, safe describe, opaque grant, serialized modification |
