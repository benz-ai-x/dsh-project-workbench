/** Project Workbench Host authority, Typert Remote, and deterministic scenario seam. */

import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  CreateProjectRequest,
  CreateProjectResult,
  DecideSuggestedChangeRequest,
  DecideSuggestedChangeResult,
  ProjectDetailProjection,
  ProjectQuery,
  ProjectStartFilter,
  ProjectStartProjection,
  ProjectTeamProjection,
  ProjectTeamQuery,
  ProposeProjectResponsibilityChangeRequest,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterFilter,
  ReviewCenterProjection,
  SetProjectMemberStatusRequest,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityRequest,
  SetProjectResponsibilityResult,
  SetStatusRequest,
  SetStatusResult,
  WorkbenchActivityFilter,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchStatusSnapshot,
} from './client.ts'
import type { WorkbenchRepository } from './repository.ts'
import {
  noWorkbenchExternalAdapters,
  randomWorkbenchIds,
  systemWorkbenchClock,
  WorkbenchScenario,
  type WorkbenchClock,
  type WorkbenchExternalAdapters,
  type WorkbenchIdGenerator,
} from './scenario.ts'
import type { WorkbenchAuthorization } from './authorization.ts'
import {
  SqliteWorkbenchRepository,
  type WorkbenchJournalMode,
} from './sqlite-repository.ts'

export type * from './client.ts'
export type * from './repository.ts'
export {
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_BYTES_V1,
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
  KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  isKnowledgeWorkTemplateSelection,
  knowledgeWorkTemplateProjection,
} from './project-template.ts'
export {
  V1OwnerAuthorizationPolicy,
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from './authorization.ts'
export type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationRequest,
  AuthorizedScope,
  OwnerPrincipal,
  OwnerPrincipalValidator,
  WorkbenchAction,
  WorkbenchAuthorization,
} from './authorization.ts'
export {
  Config as OwnerAuthConfigSchema,
  DEFAULT_OWNER_AUTH_MAX_REQUEST_BODY_BYTES,
  LoginFailureThrottle,
  MAX_OWNER_AUTH_REQUEST_BODY_BYTES,
  OWNER_AUTH_API_PATH,
  OWNER_AUTH_INITIALIZE_PATH,
  OWNER_AUTH_LOGIN_PATH,
  OWNER_AUTH_LOGOUT_PATH,
  OWNER_AUTH_STATE_PATH,
  OWNER_SESSION_COOKIE_NAME,
  OwnerAuthService,
  WORKBENCH_API_PATH,
  ownerSessionClearCookie,
  ownerSessionSetCookie,
  ownerSessionToken,
} from './owner-auth-service.ts'
export type {
  Config as OwnerAuthConfig,
  OwnerAuthServiceInternals,
} from './owner-auth-service.ts'
export {
  DEFAULT_OWNER_MAX_CONCURRENT_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_QUEUED_PASSWORD_JOBS,
  DEFAULT_OWNER_MAX_SESSIONS,
  DEFAULT_OWNER_SESSION_LIFETIME_MINUTES,
  OwnerAccess,
  OwnerAuthFailure,
  normalizeRecoveryCode,
  secretDigest,
} from './owner-access.ts'
export type {
  OwnerAccessClock,
  OwnerAccessOptions,
  OwnerAccessRandom,
  OwnerRecoveryResult,
  OwnerSessionGrant,
} from './owner-access.ts'
export {
  DshOwnerCredentialStore,
  OWNER_AUTH_CREDENTIAL_KEY,
  OWNER_AUTH_RECORD_VERSION,
  OwnerCredentialStateError,
  decodeOwnerAuthRecord,
} from './owner-credential-store.ts'
export type {
  OwnerAuthRecord,
  OwnerCredentialStore,
  OwnerIdentityRecord,
  OwnerRecoveryRecord,
  OwnerSessionRecord,
} from './owner-credential-store.ts'
export {
  noWorkbenchExternalAdapters,
  randomWorkbenchIds,
  systemWorkbenchClock,
  WorkbenchScenario,
} from './scenario.ts'
export type {
  WorkbenchClock,
  WorkbenchExternalAdapter,
  WorkbenchExternalAdapters,
  WorkbenchIdGenerator,
  WorkbenchScenarioOptions,
} from './scenario.ts'
export {
  SqliteWorkbenchRepository,
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_SQLITE_APPLICATION_ID,
} from './sqlite-repository.ts'
export type {
  SqliteWorkbenchRepositoryOptions,
  WorkbenchJournalMode,
} from './sqlite-repository.ts'

export const DEFAULT_WORKBENCH_DATABASE_PATH = '.dsh/project-workbench.sqlite'
export const DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS = 5_000
export const DEFAULT_WORKBENCH_MAX_STATUS_LENGTH = 280
const MAX_BUSY_TIMEOUT_MS = 2_147_483_647

/** Public Loader configuration. Every property has an operational default. */
export interface Config {
  readonly databasePath?: string
  readonly journalMode?: WorkbenchJournalMode
  readonly busyTimeoutMs?: number
  readonly maxStatusLength?: number
}

/** Runtime mirror of {@link Config}; Loader validation happens before activation. */
export const Config: Schema<Config> = Schema.object({
  databasePath: Schema.string()
    .pattern(/^(?=.*\S)[^\0]+$/u)
    .default(DEFAULT_WORKBENCH_DATABASE_PATH),
  journalMode: Schema.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  busyTimeoutMs: Schema.number()
    .step(1)
    .min(0)
    .max(MAX_BUSY_TIMEOUT_MS)
    .default(DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS),
  maxStatusLength: Schema.number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_WORKBENCH_MAX_STATUS_LENGTH),
})

interface ResolvedConfig {
  readonly databasePath: string
  readonly journalMode: WorkbenchJournalMode
  readonly busyTimeoutMs: number
  readonly maxStatusLength: number
}

/** Optional construction ports used by WorkbenchScenario and focused Host tests. */
export interface WorkbenchServiceInternals {
  readonly clock?: WorkbenchClock
  readonly ids?: WorkbenchIdGenerator
  readonly repository?: WorkbenchRepository
  readonly adapters?: WorkbenchExternalAdapters
  readonly authorization?: WorkbenchAuthorization
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host authority behind the generated `remote.workbench` namespace. */
    workbench: WorkbenchService
  }
}

/** Cordis class plugin owning the singleton status command/query path. */
export class WorkbenchService extends TypertRemoteService {
  static inject = ['workbenchAuth']
  static Config = Config

  /** Highest-level seam shared with all future feature scenarios. */
  readonly scenario: WorkbenchScenario

  constructor(ctx: Context, config: Config = {}, internals: WorkbenchServiceInternals = {}) {
    super(ctx, 'workbench')
    const resolved = resolveConfig(config)
    const repository = internals.repository ?? new SqliteWorkbenchRepository({
      databasePath: resolved.databasePath,
      journalMode: resolved.journalMode,
      busyTimeoutMs: resolved.busyTimeoutMs,
    })
    this.scenario = new WorkbenchScenario({
      clock: internals.clock ?? systemWorkbenchClock,
      ids: internals.ids ?? randomWorkbenchIds,
      repository,
      adapters: internals.adapters ?? noWorkbenchExternalAdapters,
      authorization: internals.authorization ?? ctx.workbenchAuth.authorization,
      maxStatusLength: resolved.maxStatusLength,
    })
  }

  /** Open storage before activation and install the quiescent teardown first. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield () => this.scenario.close()
    await this.scenario.open()
  }

  /** Read the current durable projection, or null before the first command. */
  @Remote
  snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    return this.scenario.snapshot(signal)
  }

  /** Commit a status with optimistic concurrency. */
  @Remote
  setStatus(request: SetStatusRequest, signal: AbortSignal): Promise<SetStatusResult> {
    return this.scenario.setStatus(request, signal)
  }

  /** Read safe audit summaries and their observable Outbox delivery state. */
  @Remote
  activity(
    filter: WorkbenchActivityFilter,
    signal: AbortSignal,
  ): Promise<WorkbenchActivityProjection> {
    return this.scenario.activity(filter, signal)
  }

  /** Recompute the complete versioned audit chain and compare its stored head. */
  @Remote
  auditIntegrity(signal: AbortSignal): Promise<WorkbenchAuditIntegrityProjection> {
    return this.scenario.auditIntegrity(signal)
  }

  /** Read the immutable template and a stable descending Project catalog page. */
  @Remote
  projectStart(
    filter: ProjectStartFilter,
    signal: AbortSignal,
  ): Promise<ProjectStartProjection> {
    return this.scenario.projectStart(filter, signal)
  }

  /** Atomically create a Project from one exact Template Version. */
  @Remote
  createProject(
    request: CreateProjectRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    return this.scenario.createProject(request, signal)
  }

  /** Reopen one visible Project from Host-owned truth. */
  @Remote
  project(
    query: ProjectQuery,
    signal: AbortSignal,
  ): Promise<ProjectDetailProjection | null> {
    return this.scenario.project(query, signal)
  }

  /** Read one authorized Project Team with its current responsibility. */
  @Remote
  projectTeam(
    query: ProjectTeamQuery,
    signal: AbortSignal,
  ): Promise<ProjectTeamProjection | null> {
    return this.scenario.projectTeam(query, signal)
  }

  /** Add one Project-scoped human or descriptive Agent member. */
  @Remote
  addProjectMember(
    request: AddProjectMemberRequest,
    signal: AbortSignal,
  ): Promise<AddProjectMemberResult> {
    return this.scenario.addProjectMember(request, signal)
  }

  /** Activate or deactivate one retained Project member. */
  @Remote
  setProjectMemberStatus(
    request: SetProjectMemberStatusRequest,
    signal: AbortSignal,
  ): Promise<SetProjectMemberStatusResult> {
    return this.scenario.setProjectMemberStatus(request, signal)
  }

  /** Atomically replace the complete Project Responsibility tuple. */
  @Remote
  setProjectResponsibility(
    request: SetProjectResponsibilityRequest,
    signal: AbortSignal,
  ): Promise<SetProjectResponsibilityResult> {
    return this.scenario.setProjectResponsibility(request, signal)
  }

  /** Read one Project's proposal context and Host-filtered Review page. */
  @Remote
  reviewCenter(
    filter: ReviewCenterFilter,
    signal: AbortSignal,
  ): Promise<ReviewCenterProjection | null> {
    return this.scenario.reviewCenter(filter, signal)
  }

  /** Propose one complete Project Responsibility candidate against an exact Team base. */
  @Remote
  proposeProjectResponsibilityChange(
    request: ProposeProjectResponsibilityChangeRequest,
    signal: AbortSignal,
  ): Promise<ProposeProjectResponsibilityChangeResult> {
    return this.scenario.proposeProjectResponsibilityChange(request, signal)
  }

  /** Apply one closed Owner disposition to a SuggestedChange. */
  @Remote
  decideSuggestedChange(
    request: DecideSuggestedChangeRequest,
    signal: AbortSignal,
  ): Promise<DecideSuggestedChangeResult> {
    return this.scenario.decideSuggestedChange(request, signal)
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = Config(config)
  return {
    databasePath: resolved.databasePath ?? DEFAULT_WORKBENCH_DATABASE_PATH,
    journalMode: resolved.journalMode ?? 'wal',
    busyTimeoutMs: resolved.busyTimeoutMs ?? DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS,
    maxStatusLength: resolved.maxStatusLength ?? DEFAULT_WORKBENCH_MAX_STATUS_LENGTH,
  }
}

export default WorkbenchService
