import {
  credentialRef,
  type CredentialProvider,
} from '@deepseek-ai/dsh-credentials'
import type {
  FeishuConnectionIssue,
  FeishuCredentialProjection,
  FeishuIdentityKind,
  FeishuResourceProbeProjection,
  FeishuScopeObservation,
  FeishuTaskCommentProjection,
  FeishuTaskListCandidateProjection,
  FeishuTaskMemberProjection,
  FeishuTaskListProbe,
} from './client.ts'
import { FEISHU_CONNECTION_ID } from './client.ts'
import type {
  WorkbenchFeishuReadResult,
  WorkbenchFeishuTaskExternalAdapter,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskSnapshot,
  WorkbenchFeishuWriteResult,
} from './feishu-task-federation.ts'
import type {
  WorkbenchFeishuExternalAdapter,
  WorkbenchFeishuIdentityVerificationResult,
  WorkbenchFeishuResourceVerificationObservation,
  WorkbenchFeishuVerifiedIdentitySession,
} from './scenario.ts'

const FEISHU_ORIGIN = 'https://open.feishu.cn'
const TENANT_TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal'
const BOT_INFO_PATH = '/open-apis/bot/v3/info'
const USER_INFO_PATH = '/open-apis/authen/v1/user_info'
const TASK_LIST_COLLECTION_PATH = '/open-apis/task/v2/tasklists'
const TASK_LIST_PATH = `${TASK_LIST_COLLECTION_PATH}/`
const TASK_COLLECTION_PATH = '/open-apis/task/v2/tasks'
const COMMENT_COLLECTION_PATH = '/open-apis/task/v2/comments'
const SAFE_ROUTE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/u
const MAX_APP_ID_LENGTH = 128
const MAX_CREDENTIAL_REF_LENGTH = 128
const MAX_RESOURCE_ID_LENGTH = 256
const MAX_ACTOR_ID_LENGTH = 128
const MAX_DISPLAY_LABEL_LENGTH = 200
const MAX_SECRET_LENGTH = 16_384
const MAX_SOURCE_LENGTH = 64
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000
const MAX_CANONICAL_URL_LENGTH = 2_048
const MAX_PAGE_TOKEN_LENGTH = 2_048
const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MAX_TASK_LIST_NAME_LENGTH = 100
const MAX_TASK_TEXT_LENGTH = 3_000
const MAX_MEMBER_NAME_LENGTH = 200
const MAX_TASK_LISTS = 1_000
const MAX_TASKS = 1_000
const MAX_COMMENTS_PER_TASK = 500
const PROVIDER_PAGE_SIZE = 50
const TASK_LIST_READ_SCOPE = 'task:tasklist:read'
const TASK_LIST_WRITE_SCOPE = 'task:tasklist:write'
const TASK_READ_SCOPE = 'task:task:read'
const TASK_WRITE_SCOPE = 'task:task:write'

export const DEFAULT_FEISHU_REQUEST_TIMEOUT_MS = 10_000
export const DEFAULT_FEISHU_MAX_RESPONSE_BYTES = 256 * 1_024
export const FEISHU_CONNECTION_ADAPTER_ID = 'feishu-open-platform-v1'

export interface FeishuConnectionVerificationInput {
  readonly kind: FeishuIdentityKind
  readonly appId: string
  readonly credentialRef: string
}

/** Exact-route Host seam. A call contains no alternate identity to fall back to. */
export interface FeishuConnectionAdapter
  extends WorkbenchFeishuExternalAdapter, WorkbenchFeishuTaskExternalAdapter {}

export type FeishuFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface DshFeishuConnectionAdapterOptions {
  readonly fetch?: FeishuFetch
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly now?: () => Date
}

/** Fixed-message failure: provider diagnostics are deliberately not forwarded. */
export class FeishuCredentialDescriptionError extends Error {
  constructor() {
    super('Workbench Feishu credential description is unavailable')
    this.name = 'FeishuCredentialDescriptionError'
  }
}

interface HttpJsonResponse {
  readonly state: 'response'
  readonly status: number
  readonly payload: unknown
  readonly retryAt: string | null
}

interface InvalidHttpJsonResponse {
  readonly state: 'invalid-response'
  readonly status: number
  readonly retryAt: string | null
}

interface UnavailableHttpResponse {
  readonly state: 'unavailable'
}

type HttpResult = HttpJsonResponse | InvalidHttpJsonResponse | UnavailableHttpResponse
type EndpointKind = 'tenant-token' | 'identity' | 'task-resource'

interface VerifiedIdentity {
  readonly actor: WorkbenchFeishuVerifiedIdentitySession['actor']
  readonly displayLabel: string | null
}

interface TaskAccess {
  readonly state: 'ok'
  readonly kind: FeishuIdentityKind
  readonly token: string
}

type TaskAccessResult = TaskAccess | {
  readonly state: 'rejected'
  readonly issue: FeishuConnectionIssue
}

interface ProviderTaskWithMetadata {
  readonly task: WorkbenchFeishuTaskSnapshot
  readonly raw: Readonly<Record<string, unknown>>
  readonly subtaskCount: number
}

/** Production Feishu adapter over the pinned DSH credential-reference seam. */
export class DshFeishuConnectionAdapter implements FeishuConnectionAdapter {
  readonly adapterId = FEISHU_CONNECTION_ADAPTER_ID
  private readonly request: FeishuFetch
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly now: () => Date

  constructor(
    private readonly credentials: CredentialProvider,
    options: DshFeishuConnectionAdapterOptions = {},
  ) {
    this.request = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_FEISHU_REQUEST_TIMEOUT_MS,
      'Feishu request timeout is invalid',
    )
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_FEISHU_MAX_RESPONSE_BYTES,
      'Feishu response limit is invalid',
    )
    this.now = options.now ?? (() => new Date())
  }

  async describeCredential(ref: string): Promise<FeishuCredentialProjection> {
    const checkedRef = checkedCredentialRef(ref)
    try {
      const description = await this.credentials.describe(checkedRef)
      if (typeof description.configured !== 'boolean'
        || typeof description.writable !== 'boolean') {
        throw new TypeError('invalid credential description')
      }
      return Object.freeze({
        ref: checkedRef,
        configured: description.configured,
        source: safeSource(description.source),
        writable: description.writable,
      })
    } catch {
      throw new FeishuCredentialDescriptionError()
    }
  }

  async startIdentityVerification(
    input: FeishuConnectionVerificationInput,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const route = checkedInput(input)
    signal.throwIfAborted()

    let resolved: Awaited<ReturnType<CredentialProvider['resolve']>>
    try {
      resolved = await this.credentials.resolve(checkedCredentialRef(route.credentialRef))
    } catch {
      signal.throwIfAborted()
      return failedIdentity(issue('provider-unavailable', 'inspect-provider'))
    }
    signal.throwIfAborted()
    if (resolved === undefined) {
      return failedIdentity(issue('credential-unconfigured', 'configure-credential'))
    }
    let credentialValue: unknown
    try {
      credentialValue = resolved.value
    } catch {
      return failedIdentity(issue('provider-unavailable', 'inspect-provider'))
    }
    if (!safeSecret(credentialValue)) {
      return failedIdentity(issue('credential-invalid', 'rotate-credential'))
    }

    if (route.kind === 'bot') {
      return this.verifyBot(route, credentialValue, signal)
    }
    return this.verifyUser(route, credentialValue, signal)
  }

  async listTaskLists(
    route: WorkbenchFeishuTaskRoute,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly FeishuTaskListCandidateProjection[]>> {
    const access = await this.resolveTaskAccess(route, signal)
    if (access.state === 'rejected') return access
    const listed = await this.readPagedItems(
      TASK_LIST_COLLECTION_PATH,
      Object.freeze({ user_id_type: 'open_id' }),
      access,
      MAX_TASK_LISTS,
      signal,
    )
    if (listed.state === 'rejected') return listed
    try {
      const seen = new Set<string>()
      const items = listed.value.map((item) => {
        const normalized = taskListCandidate(item)
        if (seen.has(normalized.taskListGuid)) throw new TypeError('duplicate task-list guid')
        seen.add(normalized.taskListGuid)
        return normalized
      })
      return readOk(Object.freeze(items))
    } catch {
      return readRejected(invalidProviderIssue())
    }
  }

  async createTaskList(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<FeishuTaskListCandidateProjection>> {
    const normalized = checkedTaskListCreation(input)
    const access = await this.resolveTaskAccess(route, signal)
    if (access.state === 'rejected') return access
    const response = await this.fetchJson(
      providerUrl(TASK_LIST_COLLECTION_PATH, { user_id_type: 'open_id' }),
      jsonBearerRequest(access.token, 'POST', {
        name: normalized.name,
        client_token: normalized.idempotencyKey,
      }),
      signal,
    )
    const failure = providerIssue(response, 'task-resource', access.kind)
    if (failure !== null) {
      return writeOutcomeMayBeUnknown(response)
        ? writeUnknown(failure)
        : writeRejected(failure)
    }
    try {
      const tasklist = nestedProviderEntity(response, 'tasklist')
      return writeOk(taskListCandidate(tasklist))
    } catch {
      return writeUnknown(invalidProviderIssue())
    }
  }

  async readTaskList(
    route: WorkbenchFeishuTaskRoute,
    taskListGuid: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskListSnapshot>> {
    const checkedGuid = checkedResourceId(taskListGuid, 'Feishu task-list guid')
    const access = await this.resolveTaskAccess(route, signal)
    if (access.state === 'rejected') return access
    const taskListResponse = await this.readProviderPayload(
      providerUrl(`${TASK_LIST_PATH}${encodeURIComponent(checkedGuid)}`, {
        user_id_type: 'open_id',
      }),
      access,
      signal,
    )
    if (taskListResponse.state === 'rejected') return taskListResponse

    let taskList: FeishuTaskListCandidateProjection
    try {
      taskList = taskListCandidate(nestedProviderEntity(taskListResponse.value, 'tasklist'))
      if (taskList.taskListGuid !== checkedGuid) throw new TypeError('task-list identity changed')
    } catch {
      return readRejected(invalidProviderIssue())
    }

    const listed = await this.readPagedItems(
      `${TASK_LIST_PATH}${encodeURIComponent(checkedGuid)}/tasks`,
      Object.freeze({ user_id_type: 'open_id' }),
      access,
      MAX_TASKS,
      signal,
    )
    if (listed.state === 'rejected') return listed

    const queue: string[] = []
    const queued = new Set<string>()
    try {
      for (const item of listed.value) {
        const guid = providerResourceId(recordRequired(item).guid, 'task guid')
        if (queued.has(guid)) throw new TypeError('duplicate task guid')
        queued.add(guid)
        queue.push(guid)
      }
    } catch {
      return readRejected(invalidProviderIssue())
    }

    const rawTasks = new Map<string, Readonly<Record<string, unknown>>>()
    const completed = new Set<string>()
    const tasks: WorkbenchFeishuTaskSnapshot[] = []
    for (let index = 0; index < queue.length; index += 1) {
      signal.throwIfAborted()
      if (queue.length > MAX_TASKS) return readRejected(invalidProviderIssue())
      const guid = queue[index]
      if (guid === undefined || completed.has(guid)) continue
      const observed = await this.readTaskWithAccess(access, guid, signal, rawTasks.get(guid))
      if (observed.state === 'rejected') return observed
      if (observed.value.task.taskGuid !== guid) return readRejected(invalidProviderIssue())
      completed.add(guid)
      tasks.push(observed.value.task)

      if (observed.value.subtaskCount === 0) continue
      const subtasks = await this.readPagedItems(
        `${TASK_COLLECTION_PATH}/${encodeURIComponent(guid)}/subtasks`,
        Object.freeze({ user_id_type: 'open_id' }),
        access,
        MAX_TASKS,
        signal,
      )
      if (subtasks.state === 'rejected') return subtasks
      try {
        for (const candidate of subtasks.value) {
          const raw = Object.freeze({ ...recordRequired(candidate) })
          const subtaskGuid = providerResourceId(raw.guid, 'subtask guid')
          if (subtaskGuid === guid) throw new TypeError('task cannot be its own subtask')
          const parent = providerNullableResourceId(raw.parent_task_guid, 'subtask parent guid')
          if (parent !== guid) throw new TypeError('subtask parent changed')
          if (!rawTasks.has(subtaskGuid)) rawTasks.set(subtaskGuid, raw)
          if (!queued.has(subtaskGuid)) {
            queued.add(subtaskGuid)
            queue.push(subtaskGuid)
          }
        }
      } catch {
        return readRejected(invalidProviderIssue())
      }
    }

    let observedAt: string
    try {
      observedAt = currentInstant(this.now())
    } catch {
      return readRejected(invalidProviderIssue())
    }
    return readOk(Object.freeze({
      taskList,
      tasks: Object.freeze(tasks),
      observedAt,
    }))
  }

  async readTask(
    route: WorkbenchFeishuTaskRoute,
    taskGuid: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<WorkbenchFeishuTaskSnapshot>> {
    const checkedGuid = checkedResourceId(taskGuid, 'Feishu task guid')
    const access = await this.resolveTaskAccess(route, signal)
    if (access.state === 'rejected') return access
    const result = await this.readTaskWithAccess(access, checkedGuid, signal)
    return result.state === 'ok' ? readOk(result.value.task) : result
  }

  async updateTask(
    route: WorkbenchFeishuTaskRoute,
    input: Readonly<{
      readonly taskGuid: string
      readonly expectedRemoteVersion: string
      readonly idempotencyKey: string
      readonly changes: WorkbenchFeishuTaskPatch
    }>,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuWriteResult<WorkbenchFeishuTaskSnapshot> | {
    readonly state: 'conflict'
    readonly current: WorkbenchFeishuTaskSnapshot
  }> {
    const normalized = checkedTaskUpdate(input)
    const access = await this.resolveTaskAccess(route, signal)
    if (access.state === 'rejected') return access
    const preflight = await this.readTaskWithAccess(access, normalized.taskGuid, signal)
    if (preflight.state === 'rejected') return preflight
    if (preflight.value.task.remoteVersion !== normalized.expectedRemoteVersion) {
      return Object.freeze({ state: 'conflict', current: preflight.value.task })
    }

    const task: Record<string, string> = {}
    const updateFields: string[] = []
    if (normalized.changes.summary !== undefined
      && normalized.changes.summary !== preflight.value.task.summary) {
      task.summary = normalized.changes.summary
      updateFields.push('summary')
    }
    if (normalized.changes.description !== undefined
      && normalized.changes.description !== preflight.value.task.description) {
      task.description = normalized.changes.description
      updateFields.push('description')
    }
    if (normalized.changes.completed !== undefined
      && normalized.changes.completed !== preflight.value.task.completed) {
      task.completed_at = normalized.changes.completed
        ? String(checkedNow(this.now()).getTime())
        : '0'
      updateFields.push('completed_at')
    }
    if (updateFields.length === 0) return writeOk(preflight.value.task)

    const response = await this.fetchJson(
      providerUrl(`${TASK_COLLECTION_PATH}/${encodeURIComponent(normalized.taskGuid)}`, {
        user_id_type: 'open_id',
      }),
      jsonBearerRequest(access.token, 'PATCH', {
        task,
        update_fields: updateFields,
      }),
      signal,
    )
    const failure = providerIssue(response, 'task-resource', access.kind)
    if (failure !== null) {
      return writeOutcomeMayBeUnknown(response)
        ? writeUnknown(failure)
        : writeRejected(failure)
    }
    try {
      const raw = nestedProviderEntity(response, 'task')
      const updated = normalizedTask(raw, preflight.value.task.comments)
      if (updated.taskGuid !== normalized.taskGuid) throw new TypeError('task identity changed')
      return writeOk(updated)
    } catch {
      return writeUnknown(invalidProviderIssue())
    }
  }

  private async resolveTaskAccess(
    route: WorkbenchFeishuTaskRoute,
    signal: AbortSignal,
  ): Promise<TaskAccessResult> {
    const checked = checkedTaskRoute(route)
    signal.throwIfAborted()
    let resolved: Awaited<ReturnType<CredentialProvider['resolve']>>
    try {
      resolved = await this.credentials.resolve(checkedCredentialRef(checked.credentialRef))
    } catch {
      signal.throwIfAborted()
      return readRejected(issue('provider-unavailable', 'inspect-provider'))
    }
    signal.throwIfAborted()
    if (resolved === undefined) {
      return readRejected(issue('credential-unconfigured', 'configure-credential'))
    }
    let credentialValue: unknown
    try {
      credentialValue = resolved.value
    } catch {
      return readRejected(issue('provider-unavailable', 'inspect-provider'))
    }
    if (!safeSecret(credentialValue)) {
      return readRejected(issue('credential-invalid', 'rotate-credential'))
    }

    let token = credentialValue
    let observed: VerifiedIdentity | { readonly issue: FeishuConnectionIssue }
    if (checked.kind === 'bot') {
      const tokenResponse = await this.fetchJson(
        `${FEISHU_ORIGIN}${TENANT_TOKEN_PATH}`,
        {
          method: 'POST',
          headers: Object.freeze({ 'content-type': 'application/json' }),
          body: JSON.stringify({ app_id: checked.appId, app_secret: credentialValue }),
        },
        signal,
      )
      signal.throwIfAborted()
      const tokenIssue = providerIssue(tokenResponse, 'tenant-token', checked.kind)
      if (tokenIssue !== null) return readRejected(tokenIssue)
      if (tokenResponse.state !== 'response') return readRejected(invalidProviderIssue())
      const candidate = safeStringField(tokenResponse.payload, 'tenant_access_token', MAX_SECRET_LENGTH)
      if (providerCode(tokenResponse.payload) !== 0 || candidate === null || !safeSecret(candidate)) {
        return readRejected(invalidProviderIssue())
      }
      token = candidate
      const identityResponse = await this.fetchJson(
        `${FEISHU_ORIGIN}${BOT_INFO_PATH}`,
        bearerRequest(token),
        signal,
      )
      signal.throwIfAborted()
      const identityIssue = providerIssue(identityResponse, 'identity', checked.kind)
      if (identityIssue !== null) return readRejected(identityIssue)
      observed = botIdentity(identityResponse, checked.appId)
    } else {
      const identityResponse = await this.fetchJson(
        `${FEISHU_ORIGIN}${USER_INFO_PATH}`,
        bearerRequest(token),
        signal,
      )
      signal.throwIfAborted()
      const identityIssue = providerIssue(identityResponse, 'identity', checked.kind)
      if (identityIssue !== null) return readRejected(identityIssue)
      observed = userIdentity(identityResponse, checked.appId)
    }
    if ('issue' in observed) return readRejected(observed.issue)
    if (observed.actor.openId !== checked.actor.openId) {
      return readRejected(issue('identity-continuity-mismatch', 'reset-identity-binding'))
    }
    if (observed.actor.tenantKey !== checked.actor.tenantKey) {
      return readRejected(issue('tenant-mismatch', 'reset-identity-binding'))
    }
    return Object.freeze({ state: 'ok', kind: checked.kind, token })
  }

  private async readProviderPayload(
    url: string,
    access: TaskAccess,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<unknown>> {
    const response = await this.fetchJson(url, bearerRequest(access.token), signal)
    const failure = providerIssue(response, 'task-resource', access.kind)
    if (failure !== null) return readRejected(failure)
    return response.state === 'response'
      ? readOk(response.payload)
      : readRejected(invalidProviderIssue())
  }

  private async readPagedItems(
    path: string,
    fixedQuery: Readonly<Record<string, string>>,
    access: TaskAccess,
    maximum: number,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuReadResult<readonly unknown[]>> {
    const items: unknown[] = []
    const tokens = new Set<string>()
    let pageToken: string | null = null
    for (let page = 0; page < 100; page += 1) {
      const query: Record<string, string> = {
        page_size: String(PROVIDER_PAGE_SIZE),
        ...fixedQuery,
      }
      if (pageToken !== null) query.page_token = pageToken
      const response = await this.readProviderPayload(providerUrl(path, query), access, signal)
      if (response.state === 'rejected') return response
      let pageData: Readonly<{
        readonly items: readonly unknown[]
        readonly hasMore: boolean
        readonly nextToken: string | null
      }>
      try {
        pageData = providerPage(response.value)
      } catch {
        return readRejected(invalidProviderIssue())
      }
      if (items.length + pageData.items.length > maximum) {
        return readRejected(invalidProviderIssue())
      }
      items.push(...pageData.items)
      if (!pageData.hasMore) return readOk(Object.freeze(items))
      if (pageData.nextToken === null || tokens.has(pageData.nextToken)) {
        return readRejected(invalidProviderIssue())
      }
      tokens.add(pageData.nextToken)
      pageToken = pageData.nextToken
    }
    return readRejected(invalidProviderIssue())
  }

  private async readTaskWithAccess(
    access: TaskAccess,
    taskGuid: string,
    signal: AbortSignal,
    suppliedRaw?: Readonly<Record<string, unknown>>,
  ): Promise<WorkbenchFeishuReadResult<ProviderTaskWithMetadata>> {
    let raw = suppliedRaw
    if (raw === undefined) {
      const response = await this.readProviderPayload(
        providerUrl(`${TASK_COLLECTION_PATH}/${encodeURIComponent(taskGuid)}`, {
          user_id_type: 'open_id',
        }),
        access,
        signal,
      )
      if (response.state === 'rejected') return response
      try {
        raw = nestedProviderEntity(response.value, 'task')
      } catch {
        return readRejected(invalidProviderIssue())
      }
    }
    const comments = await this.readPagedItems(
      COMMENT_COLLECTION_PATH,
      Object.freeze({
        resource_type: 'task',
        resource_id: taskGuid,
        direction: 'asc',
        user_id_type: 'open_id',
      }),
      access,
      MAX_COMMENTS_PER_TASK,
      signal,
    )
    if (comments.state === 'rejected') return comments
    try {
      const normalizedComments = normalizedTaskComments(comments.value)
      const task = normalizedTask(raw, normalizedComments)
      const count = providerSubtaskCount(raw.subtask_count)
      return readOk(Object.freeze({ task, raw, subtaskCount: count }))
    } catch {
      return readRejected(invalidProviderIssue())
    }
  }

  private async verifyBot(
    input: FeishuConnectionVerificationInput & { readonly kind: 'bot' },
    appSecret: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const tokenResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${TENANT_TOKEN_PATH}`,
      {
        method: 'POST',
        headers: Object.freeze({ 'content-type': 'application/json' }),
        body: JSON.stringify({ app_id: input.appId, app_secret: appSecret }),
      },
      signal,
    )
    signal.throwIfAborted()
    const tokenIssue = providerIssue(tokenResponse, 'tenant-token', input.kind)
    if (tokenIssue !== null) return failedIdentity(tokenIssue)
    if (tokenResponse.state !== 'response') {
      return failedIdentity(issue('provider-response-invalid', 'inspect-provider'))
    }
    const tenantToken = safeStringField(tokenResponse.payload, 'tenant_access_token', MAX_SECRET_LENGTH)
    if (providerCode(tokenResponse.payload) !== 0 || tenantToken === null || !safeSecret(tenantToken)) {
      return failedIdentity(issue('provider-response-invalid', 'inspect-provider'))
    }

    const identityResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${BOT_INFO_PATH}`,
      bearerRequest(tenantToken),
      signal,
    )
    signal.throwIfAborted()
    const identityIssue = providerIssue(identityResponse, 'identity', input.kind)
    if (identityIssue !== null) return failedIdentity(identityIssue)
    const identity = botIdentity(identityResponse, input.appId)
    if ('issue' in identity) return failedIdentity(identity.issue)
    return this.verifiedIdentity(input.kind, tenantToken, identity)
  }

  private async verifyUser(
    input: FeishuConnectionVerificationInput & { readonly kind: 'user' },
    userToken: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuIdentityVerificationResult> {
    const identityResponse = await this.fetchJson(
      `${FEISHU_ORIGIN}${USER_INFO_PATH}`,
      bearerRequest(userToken),
      signal,
    )
    signal.throwIfAborted()
    const identityIssue = providerIssue(identityResponse, 'identity', input.kind)
    if (identityIssue !== null) return failedIdentity(identityIssue)
    const identity = userIdentity(identityResponse, input.appId)
    if ('issue' in identity) return failedIdentity(identity.issue)
    return this.verifiedIdentity(input.kind, userToken, identity)
  }

  private verifiedIdentity(
    kind: FeishuIdentityKind,
    accessToken: string,
    identity: VerifiedIdentity,
  ): WorkbenchFeishuIdentityVerificationResult {
    let retainedToken: string | null = accessToken
    let finished = false
    const session: WorkbenchFeishuVerifiedIdentitySession = Object.freeze({
      actor: identity.actor,
      displayLabel: identity.displayLabel,
      finishVerification: async (
        resourceProbe: FeishuTaskListProbe | null,
        signal: AbortSignal,
      ): Promise<WorkbenchFeishuResourceVerificationObservation> => {
        if (finished || retainedToken === null) {
          throw new Error('Workbench Feishu identity session is no longer available')
        }
        finished = true
        const operationToken = retainedToken
        retainedToken = null
        return this.finishVerification(kind, resourceProbe, operationToken, signal)
      },
      dispose: (): void => {
        finished = true
        retainedToken = null
      },
    })
    return Object.freeze({ state: 'verified', session })
  }

  private async finishVerification(
    kind: FeishuIdentityKind,
    resourceProbe: FeishuTaskListProbe | null,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuResourceVerificationObservation> {
    const checkedProbe = checkedResourceProbe(resourceProbe)
    signal.throwIfAborted()
    if (checkedProbe === null) {
      return capabilityObservation(uninspectedScopes(), notTestedProbe())
    }

    const resourceId = checkedProbe.resourceId
    const response = await this.fetchJson(
      `${FEISHU_ORIGIN}${TASK_LIST_PATH}${encodeURIComponent(resourceId)}`,
      bearerRequest(accessToken),
      signal,
    )
    signal.throwIfAborted()
    const probeIssue = providerIssue(response, 'task-resource', kind)
    if (probeIssue === null && response.state === 'response' && providerCode(response.payload) === 0) {
      return capabilityObservation(
        uninspectedScopes(),
        Object.freeze({ state: 'accessible', kind: 'task-list', resourceId }),
      )
    }
    const closedIssue = probeIssue
      ?? issue('provider-response-invalid', 'inspect-provider')
    return capabilityObservation(
      scopeEvidenceFor(closedIssue, kind),
      Object.freeze({
        state: 'unavailable',
        kind: 'task-list',
        resourceId,
        issue: closedIssue,
      }),
    )
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    callerSignal: AbortSignal,
  ): Promise<HttpResult> {
    callerSignal.throwIfAborted()
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
    const signal = AbortSignal.any([callerSignal, timeout.signal])
    try {
      const response = await this.request(url, {
        ...init,
        redirect: 'error',
        signal,
      })
      callerSignal.throwIfAborted()
      if (timeout.signal.aborted) {
        await response.body?.cancel().catch(() => undefined)
        return Object.freeze({ state: 'unavailable' })
      }
      const retryAt = retryInstant(response.headers.get('retry-after'), this.now())
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined)
        return Object.freeze({ state: 'invalid-response', status: response.status, retryAt })
      }
      const payload = await boundedJson(response, this.maxResponseBytes)
      callerSignal.throwIfAborted()
      if (timeout.signal.aborted) return Object.freeze({ state: 'unavailable' })
      if (payload === INVALID_JSON) {
        return Object.freeze({ state: 'invalid-response', status: response.status, retryAt })
      }
      return Object.freeze({ state: 'response', status: response.status, payload, retryAt })
    } catch {
      callerSignal.throwIfAborted()
      return Object.freeze({ state: 'unavailable' })
    } finally {
      clearTimeout(timer)
    }
  }
}

const INVALID_JSON = Symbol('invalid-json')

async function boundedJson(response: Response, maximum: number): Promise<unknown | typeof INVALID_JSON> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > maximum) {
    await response.body?.cancel().catch(() => undefined)
    return INVALID_JSON
  }
  if (response.body === null) return INVALID_JSON

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let total = 0
  let text = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximum) {
        await reader.cancel().catch(() => undefined)
        return INVALID_JSON
      }
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    await reader.cancel().catch(() => undefined)
    return INVALID_JSON
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A cancelled stream may already have released its lock.
    }
  }
  if (text.length === 0) return INVALID_JSON
  try {
    return JSON.parse(text) as unknown
  } catch {
    return INVALID_JSON
  }
}

function providerUrl(path: string, query: Readonly<Record<string, string>>): string {
  const url = new URL(path, FEISHU_ORIGIN)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}

function jsonBearerRequest(
  token: string,
  method: 'POST' | 'PATCH',
  body: Readonly<Record<string, unknown>>,
): RequestInit {
  return Object.freeze({
    method,
    headers: Object.freeze({
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  })
}

function readOk<T>(value: T): { readonly state: 'ok'; readonly value: T } {
  return Object.freeze({ state: 'ok', value })
}

function readRejected(issueValue: FeishuConnectionIssue): {
  readonly state: 'rejected'
  readonly issue: FeishuConnectionIssue
} {
  return Object.freeze({ state: 'rejected', issue: issueValue })
}

function writeOk<T>(value: T): { readonly state: 'ok'; readonly value: T } {
  return Object.freeze({ state: 'ok', value })
}

function writeRejected(issueValue: FeishuConnectionIssue): {
  readonly state: 'rejected'
  readonly issue: FeishuConnectionIssue
} {
  return Object.freeze({ state: 'rejected', issue: issueValue })
}

function writeUnknown(issueValue: FeishuConnectionIssue): {
  readonly state: 'unknown'
  readonly issue: FeishuConnectionIssue
} {
  return Object.freeze({ state: 'unknown', issue: issueValue })
}

function invalidProviderIssue(): FeishuConnectionIssue {
  return issue('provider-response-invalid', 'inspect-provider')
}

function writeOutcomeMayBeUnknown(response: HttpResult): boolean {
  if (response.state === 'unavailable') return true
  if (response.status === 408 || response.status >= 500) return true
  return response.state === 'invalid-response'
    && response.status >= 200
    && response.status < 300
}

function nestedProviderEntity(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> {
  const possibleResponse = record(value)
  const payload = possibleResponse?.state === 'response' && 'payload' in possibleResponse
    ? possibleResponse.payload
    : value
  const envelope = recordRequired(payload)
  const data = recordRequired(envelope.data)
  return Object.freeze({ ...recordRequired(data[key]) })
}

function providerPage(value: unknown): Readonly<{
  readonly items: readonly unknown[]
  readonly hasMore: boolean
  readonly nextToken: string | null
}> {
  const envelope = recordRequired(value)
  const data = recordRequired(envelope.data)
  const items = data.items === undefined || data.items === null
    ? []
    : data.items
  if (!Array.isArray(items) || items.length > PROVIDER_PAGE_SIZE) {
    throw new TypeError('provider page items are invalid')
  }
  if (typeof data.has_more !== 'boolean') throw new TypeError('provider page marker is invalid')
  let nextToken: string | null = null
  if (data.has_more) {
    if (!safeBoundedString(data.page_token, MAX_PAGE_TOKEN_LENGTH)) {
      throw new TypeError('provider page token is invalid')
    }
    nextToken = data.page_token
  }
  return Object.freeze({
    items: Object.freeze([...items]),
    hasMore: data.has_more,
    nextToken,
  })
}

function taskListCandidate(value: unknown): FeishuTaskListCandidateProjection {
  const taskList = recordRequired(value)
  return Object.freeze({
    taskListGuid: providerResourceId(taskList.guid, 'task-list guid'),
    name: providerRequiredText(taskList.name, MAX_TASK_LIST_NAME_LENGTH, 'task-list name'),
    canonicalUrl: providerCanonicalUrl(taskList.url, 'task-list url'),
    remoteVersion: providerRemoteVersion(taskList.updated_at, 'task-list remote version'),
  })
}

function normalizedTaskComments(
  values: readonly unknown[],
): readonly FeishuTaskCommentProjection[] {
  const seen = new Set<string>()
  const comments = values.map((value) => {
    const comment = recordRequired(value)
    const commentId = providerResourceId(comment.id, 'comment id')
    if (seen.has(commentId)) throw new TypeError('duplicate comment id')
    seen.add(commentId)
    const createdAt = providerMillisecondInstant(comment.created_at, 'comment created time')
    const updatedAt = comment.updated_at === undefined || comment.updated_at === null
      ? createdAt
      : providerMillisecondInstant(comment.updated_at, 'comment updated time')
    return Object.freeze({
      commentId,
      content: providerText(comment.content, MAX_TASK_TEXT_LENGTH, 'comment content'),
      creator: providerCommentCreator(comment.creator),
      replyToCommentId: providerNullableResourceId(comment.reply_to_comment_id, 'reply comment id'),
      createdAt,
      updatedAt,
    })
  })
  return Object.freeze(comments)
}

function normalizedTask(
  value: unknown,
  comments: readonly FeishuTaskCommentProjection[],
): WorkbenchFeishuTaskSnapshot {
  const task = recordRequired(value)
  const members = providerTaskMembers(task.members)
  const status = task.status
  if (status !== 'todo' && status !== 'done') throw new TypeError('task status is invalid')
  const completedAt = task.completed_at === undefined || task.completed_at === null
    || task.completed_at === '0'
    ? null
    : providerMillisecondInstant(task.completed_at, 'task completed time')
  if ((status === 'done') !== (completedAt !== null)) {
    throw new TypeError('task completion fields are inconsistent')
  }
  return Object.freeze({
    taskGuid: providerResourceId(task.guid, 'task guid'),
    taskId: providerNullableResourceId(task.task_id, 'task id'),
    parentTaskGuid: providerNullableResourceId(task.parent_task_guid, 'parent task guid'),
    summary: providerRequiredText(task.summary, MAX_TASK_TEXT_LENGTH, 'task summary'),
    description: task.description === undefined || task.description === null
      ? ''
      : providerText(task.description, MAX_TASK_TEXT_LENGTH, 'task description'),
    assignees: members.assignees,
    followers: members.followers,
    comments: Object.freeze([...comments]),
    completed: status === 'done',
    completedAt,
    canonicalUrl: providerCanonicalUrl(task.url, 'task url'),
    remoteVersion: providerRemoteVersion(task.updated_at, 'task remote version'),
  })
}

function providerTaskMembers(value: unknown): Readonly<{
  readonly assignees: readonly FeishuTaskMemberProjection[]
  readonly followers: readonly FeishuTaskMemberProjection[]
}> {
  if (value === undefined || value === null) {
    return Object.freeze({ assignees: Object.freeze([]), followers: Object.freeze([]) })
  }
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('task members are invalid')
  const assignees: FeishuTaskMemberProjection[] = []
  const followers: FeishuTaskMemberProjection[] = []
  const assigneeIds = new Set<string>()
  const followerIds = new Set<string>()
  for (const candidate of value) {
    const member = recordRequired(candidate)
    if (member.role !== 'assignee' && member.role !== 'follower') continue
    if (member.type !== 'user') continue
    const normalized = providerUserMember(member)
    const target = member.role === 'assignee' ? assignees : followers
    const ids = member.role === 'assignee' ? assigneeIds : followerIds
    if (ids.has(normalized.openId)) throw new TypeError('duplicate task member')
    ids.add(normalized.openId)
    target.push(normalized)
  }
  return Object.freeze({
    assignees: Object.freeze(assignees),
    followers: Object.freeze(followers),
  })
}

function providerUserMember(value: Readonly<Record<string, unknown>>): FeishuTaskMemberProjection {
  let name: string | null = null
  if (value.name !== undefined && value.name !== null && value.name !== '') {
    name = providerRequiredText(value.name, MAX_MEMBER_NAME_LENGTH, 'member name')
  }
  return Object.freeze({
    openId: providerResourceId(value.id, 'member open id'),
    name,
  })
}

function providerCommentCreator(value: unknown): FeishuTaskMemberProjection | null {
  if (value === undefined || value === null) return null
  const member = recordRequired(value)
  if (member.type !== 'user') return null
  return providerUserMember(member)
}

function providerSubtaskCount(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_TASKS) {
    throw new TypeError('subtask count is invalid')
  }
  return value as number
}

function checkedTaskListCreation(
  input: Readonly<{ readonly name: string; readonly idempotencyKey: string }>,
): Readonly<{ readonly name: string; readonly idempotencyKey: string }> {
  if (record(input) === null) throw new TypeError('Feishu task-list input is invalid')
  return Object.freeze({
    name: checkedRequiredText(input.name, MAX_TASK_LIST_NAME_LENGTH, 'Feishu task-list name'),
    idempotencyKey: checkedCommandKey(input.idempotencyKey),
  })
}

function checkedTaskUpdate(input: Readonly<{
  readonly taskGuid: string
  readonly expectedRemoteVersion: string
  readonly idempotencyKey: string
  readonly changes: WorkbenchFeishuTaskPatch
}>): Readonly<{
  readonly taskGuid: string
  readonly expectedRemoteVersion: string
  readonly idempotencyKey: string
  readonly changes: WorkbenchFeishuTaskPatch
}> {
  if (record(input) === null) throw new TypeError('Feishu task update is invalid')
  const changes = record(input.changes)
  if (changes === null) throw new TypeError('Feishu task changes are invalid')
  const keys = Object.keys(changes)
  if (keys.length < 1 || keys.some(key =>
    key !== 'summary' && key !== 'description' && key !== 'completed')) {
    throw new TypeError('Feishu task changes are invalid')
  }
  const normalized: {
    summary?: string
    description?: string
    completed?: boolean
  } = {}
  if (changes.summary !== undefined) {
    normalized.summary = checkedRequiredText(
      changes.summary,
      MAX_TASK_TEXT_LENGTH,
      'Feishu task summary',
    )
  }
  if (changes.description !== undefined) {
    normalized.description = checkedText(
      changes.description,
      MAX_TASK_TEXT_LENGTH,
      'Feishu task description',
    )
  }
  if (changes.completed !== undefined) {
    if (typeof changes.completed !== 'boolean') throw new TypeError('Feishu completion is invalid')
    normalized.completed = changes.completed
  }
  return Object.freeze({
    taskGuid: checkedResourceId(input.taskGuid, 'Feishu task guid'),
    expectedRemoteVersion: checkedRequiredText(
      input.expectedRemoteVersion,
      64,
      'Feishu remote version',
    ),
    idempotencyKey: checkedCommandKey(input.idempotencyKey),
    changes: Object.freeze(normalized),
  })
}

function checkedTaskRoute(route: WorkbenchFeishuTaskRoute): WorkbenchFeishuTaskRoute {
  if (record(route) === null || (route.kind !== 'bot' && route.kind !== 'user')) {
    throw new TypeError('Feishu task route is invalid')
  }
  if (!Number.isSafeInteger(route.routeGeneration) || route.routeGeneration < 1) {
    throw new TypeError('Feishu route generation is invalid')
  }
  if (!safeRouteValue(route.appId, MAX_APP_ID_LENGTH)) {
    throw new TypeError('Feishu app id is invalid')
  }
  checkedCredentialRef(route.credentialRef)
  const actor = route.actor
  if (record(actor) === null || actor.connectionId !== FEISHU_CONNECTION_ID
    || actor.realm !== 'feishu-cn' || actor.kind !== route.kind || actor.appId !== route.appId
    || !Number.isSafeInteger(actor.routeGeneration) || actor.routeGeneration < 1
    || actor.routeGeneration !== route.routeGeneration
    || safeActorId(actor.openId) === null
    || (route.kind === 'bot' ? actor.tenantKey !== null : safeActorId(actor.tenantKey) === null)) {
    throw new TypeError('Feishu verified actor route is invalid')
  }
  return Object.freeze({
    kind: route.kind,
    routeGeneration: route.routeGeneration,
    appId: route.appId,
    credentialRef: route.credentialRef,
    actor: Object.freeze({ ...actor }),
  })
}

function checkedCommandKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 16 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || !SAFE_ROUTE_VALUE.test(value)) {
    throw new TypeError('Feishu idempotency key is invalid')
  }
  return value
}

function checkedResourceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_RESOURCE_ID_LENGTH
    || !SAFE_ROUTE_VALUE.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function providerResourceId(value: unknown, label: string): string {
  return checkedResourceId(value, `Provider ${label}`)
}

function providerNullableResourceId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return providerResourceId(value, label)
}

function checkedRequiredText(value: unknown, maximum: number, label: string): string {
  const text = checkedText(value, maximum, label)
  if (text.length === 0) throw new TypeError(`${label} is invalid`)
  return text
}

function checkedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.isWellFormed() || ASCII_CONTROL.test(value)
    || [...value].length > maximum) throw new TypeError(`${label} is invalid`)
  return value
}

function providerRequiredText(value: unknown, maximum: number, label: string): string {
  return checkedRequiredText(value, maximum, `Provider ${label}`)
}

function providerText(value: unknown, maximum: number, label: string): string {
  return checkedText(value, maximum, `Provider ${label}`)
}

function providerRemoteVersion(value: unknown, label: string): string {
  return providerRequiredText(value, 64, label)
}

function providerCanonicalUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CANONICAL_URL_LENGTH
    || value.trim() !== value || ASCII_CONTROL.test(value)) {
    throw new TypeError(`Provider ${label} is invalid`)
  }
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(`Provider ${label} is invalid`)
  }
  return value
}

function providerMillisecondInstant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{1,16}$/u.test(value) || value === '0') {
    throw new TypeError(`Provider ${label} is invalid`)
  }
  const milliseconds = Number(value)
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError(`Provider ${label} is invalid`)
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Provider ${label} is invalid`)
  return date.toISOString()
}

function currentInstant(value: Date): string {
  return checkedNow(value).toISOString()
}

function checkedNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Feishu adapter clock is invalid')
  }
  return value
}

function recordRequired(value: unknown): Readonly<Record<string, unknown>> {
  const candidate = record(value)
  if (candidate === null) throw new TypeError('provider object is invalid')
  return candidate
}

function providerIssue(
  response: HttpResult,
  endpoint: EndpointKind,
  actor: FeishuIdentityKind,
): FeishuConnectionIssue | null {
  if (response.state === 'unavailable') {
    return issue('provider-unavailable', 'retry-later')
  }
  if (response.status === 429) {
    return issue('rate-limited', 'retry-later', [], null, response.retryAt)
  }
  if (response.state === 'invalid-response') {
    if (response.status >= 500 || response.status === 408) {
      return issue('provider-unavailable', 'retry-later')
    }
    return issue('provider-response-invalid', 'inspect-provider')
  }

  const code = providerCode(response.payload)
  if (response.status >= 200 && response.status < 300 && code === 0) return null
  if (endpoint === 'task-resource' && code === 99991672) {
    const scopes = missingTaskScopes(response.payload)
    return issue('missing-app-scope', 'grant-app-scope', scopes, 'application')
  }
  if (endpoint === 'task-resource' && actor === 'user' && code === 99991679) {
    const scopes = missingTaskScopes(response.payload)
    return issue('missing-user-grant', 'reauthorize-user', scopes, 'user-consent')
  }
  if (endpoint === 'task-resource' && code === 1470403) {
    return issue('resource-access-unavailable', 'share-resource')
  }
  if (endpoint === 'task-resource' && code === 1470404) {
    return issue('resource-not-found', 'check-resource-id')
  }
  if (code === 99991668) {
    return actor === 'user'
      ? issue('user-authorization-revoked', 'reauthorize-user')
      : issue('unsupported-actor', 'inspect-provider')
  }
  if (code === 99991663) {
    return actor === 'bot'
      ? issue('credential-invalid', 'rotate-credential')
      : issue('unsupported-actor', 'inspect-provider')
  }
  if (response.status === 429) {
    return issue('rate-limited', 'retry-later', [], null, response.retryAt)
  }
  if (response.status >= 500 || response.status === 408) {
    return issue('provider-unavailable', 'retry-later')
  }
  if (endpoint === 'tenant-token') {
    return issue('credential-invalid', 'rotate-credential')
  }
  return issue('unknown-provider-error', 'inspect-provider')
}

function botIdentity(
  response: HttpResult,
  appId: string,
): VerifiedIdentity | { readonly issue: FeishuConnectionIssue } {
  if (response.state !== 'response' || providerCode(response.payload) !== 0) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  const envelope = record(response.payload)
  const direct = envelope === null ? null : record(envelope.bot)
  const nestedData = envelope === null ? null : record(envelope.data)
  const bot = direct ?? (nestedData === null ? null : record(nestedData.bot))
  const openId = bot === null ? null : safeActorId(bot.open_id)
  if (bot === null || openId === null) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  if (!Number.isSafeInteger(bot.activate_status)) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  if (bot.activate_status !== 2) {
    return Object.freeze({ issue: issue('app-disabled', 'enable-app') })
  }
  return Object.freeze({
    actor: Object.freeze({ realm: 'feishu-cn', appId, kind: 'bot', openId, tenantKey: null }),
    displayLabel: safeDisplayLabel(bot.app_name),
  })
}

function userIdentity(
  response: HttpResult,
  appId: string,
): VerifiedIdentity | { readonly issue: FeishuConnectionIssue } {
  if (response.state !== 'response' || providerCode(response.payload) !== 0) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  const envelope = record(response.payload)
  const data = envelope === null ? null : record(envelope.data)
  const openId = data === null ? null : safeActorId(data.open_id)
  const tenantKey = data === null ? null : safeActorId(data.tenant_key)
  if (data === null || openId === null || tenantKey === null) {
    return Object.freeze({ issue: issue('provider-response-invalid', 'inspect-provider') })
  }
  return Object.freeze({
    actor: Object.freeze({ realm: 'feishu-cn', appId, kind: 'user', openId, tenantKey }),
    displayLabel: safeDisplayLabel(data.name),
  })
}

function capabilityObservation(
  scopeInspection: WorkbenchFeishuResourceVerificationObservation['scopeInspection'],
  resourceProbe: FeishuResourceProbeProjection,
): WorkbenchFeishuResourceVerificationObservation {
  const hasAttention = scopeInspection.state === 'unavailable'
    || scopeInspection.scopes.some(scope => scope.state === 'missing')
    || resourceProbe.state === 'unavailable'
  return Object.freeze({
    result: hasAttention ? 'attention' : 'healthy',
    scopeInspection,
    resourceProbe,
  })
}

function failedIdentity(failure: FeishuConnectionIssue): WorkbenchFeishuIdentityVerificationResult {
  return Object.freeze({ state: 'failed', issue: failure })
}

function uninspectedScopes(): WorkbenchFeishuResourceVerificationObservation['scopeInspection'] {
  return Object.freeze({
    state: 'not-inspected',
    scopes: Object.freeze([]),
    issue: null,
  })
}

function scopeEvidenceFor(
  failure: FeishuConnectionIssue,
  kind: FeishuIdentityKind,
): WorkbenchFeishuResourceVerificationObservation['scopeInspection'] {
  if (failure.code !== 'missing-app-scope' && failure.code !== 'missing-user-grant') {
    return uninspectedScopes()
  }
  const scopes: readonly FeishuScopeObservation[] = Object.freeze(
    failure.missingScopes.map(scope => Object.freeze({
      scope,
      tokenType: kind === 'bot' ? 'tenant' as const : 'user' as const,
      state: 'missing' as const,
    })),
  )
  return Object.freeze({ state: 'observed', scopes, issue: null })
}

function notTestedProbe(): FeishuResourceProbeProjection {
  return Object.freeze({ state: 'not-tested' })
}

function issue(
  code: FeishuConnectionIssue['code'],
  recovery: FeishuConnectionIssue['recovery'],
  missingScopes: readonly string[] = [],
  grantPlane: FeishuConnectionIssue['grantPlane'] = null,
  retryAt: string | null = null,
): FeishuConnectionIssue {
  return Object.freeze({
    code,
    recovery,
    missingScopes: Object.freeze([...missingScopes]),
    grantPlane,
    retryAt,
  })
}

function bearerRequest(token: string): RequestInit {
  return Object.freeze({
    method: 'GET',
    headers: Object.freeze({ authorization: `Bearer ${token}` }),
  })
}

function providerCode(payload: unknown): number | null {
  const envelope = record(payload)
  return envelope !== null && Number.isSafeInteger(envelope.code)
    ? envelope.code as number
    : null
}

function missingTaskScopes(payload: unknown): readonly string[] {
  const candidates = new Set<string>()
  const envelope = record(payload)
  const error = envelope === null ? null : record(envelope.error)
  const violations = error === null || !Array.isArray(error.permission_violations)
    ? []
    : error.permission_violations
  for (const candidate of violations) {
    const violation = record(candidate)
    if (violation === null) continue
    for (const key of ['scope', 'name', 'subject'] as const) {
      const value = violation[key]
      if (value === TASK_LIST_READ_SCOPE || value === TASK_LIST_WRITE_SCOPE
        || value === TASK_READ_SCOPE || value === TASK_WRITE_SCOPE) candidates.add(value)
    }
  }
  if (candidates.size === 0) candidates.add(TASK_LIST_READ_SCOPE)
  return Object.freeze([...candidates].sort())
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeStringField(value: unknown, key: string, maximum: number): string | null {
  const candidate = record(value)?.[key]
  return safeBoundedString(candidate, maximum) ? candidate : null
}

function safeActorId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= MAX_ACTOR_ID_LENGTH
    && SAFE_ROUTE_VALUE.test(value)
    ? value
    : null
}

function safeDisplayLabel(value: unknown): string | null {
  if (!safeBoundedString(value, MAX_DISPLAY_LABEL_LENGTH)) return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_LABEL_LENGTH ? trimmed : null
}

function safeSource(value: string | undefined): string | null {
  return safeBoundedString(value, MAX_SOURCE_LENGTH) ? value : null
}

function safeSecret(value: unknown): value is string {
  return safeBoundedString(value, MAX_SECRET_LENGTH)
}

function safeBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.isWellFormed()
    && !ASCII_CONTROL.test(value)
}

function checkedInput(input: FeishuConnectionVerificationInput):
  | FeishuConnectionVerificationInput & { readonly kind: 'bot' }
  | FeishuConnectionVerificationInput & { readonly kind: 'user' } {
  if (input.kind !== 'bot' && input.kind !== 'user') {
    throw new TypeError('Feishu route kind is invalid')
  }
  if (!safeRouteValue(input.appId, MAX_APP_ID_LENGTH)) {
    throw new TypeError('Feishu app id is invalid')
  }
  checkedCredentialRef(input.credentialRef)
  if (input.kind === 'bot') {
    return Object.freeze({
      kind: 'bot' as const,
      appId: input.appId,
      credentialRef: input.credentialRef,
    })
  }
  return Object.freeze({
    kind: 'user' as const,
    appId: input.appId,
    credentialRef: input.credentialRef,
  })
}

function checkedResourceProbe(value: FeishuTaskListProbe | null): FeishuTaskListProbe | null {
  if (value === null) return null
  if (value.kind !== 'task-list'
    || !safeRouteValue(value.resourceId, MAX_RESOURCE_ID_LENGTH)) {
    throw new TypeError('Feishu resource probe is invalid')
  }
  return Object.freeze({ kind: 'task-list', resourceId: value.resourceId })
}

function checkedCredentialRef(value: string): ReturnType<typeof credentialRef> {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_REF_LENGTH) {
    throw new TypeError('Feishu credential reference is invalid')
  }
  try {
    return credentialRef(value)
  } catch {
    throw new TypeError('Feishu credential reference is invalid')
  }
}

function safeRouteValue(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && SAFE_ROUTE_VALUE.test(value)
}

function positiveInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(message)
  return value
}

function retryInstant(value: string | null, now: Date): string | null {
  if (value === null || !Number.isFinite(now.getTime())) return null
  let delay: number
  if (/^\d{1,10}$/u.test(value)) {
    delay = Number(value) * 1_000
  } else {
    const instant = Date.parse(value)
    if (!Number.isFinite(instant)) return null
    delay = instant - now.getTime()
  }
  if (!Number.isFinite(delay) || delay < 0) return null
  return new Date(now.getTime() + Math.min(delay, MAX_RETRY_DELAY_MS)).toISOString()
}
