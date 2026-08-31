/** SQLite implementation of the transactional Workbench repository. */

import { createHash } from 'node:crypto'
import { open as openFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  AddProjectMemberResult,
  CreateProjectResult,
  DecideSuggestedChangeResult,
  GoalProjection,
  GoalSummaryProjection,
  KnowledgeWorkTemplateDefinitionV1,
  OutcomeMetric,
  OutcomeMetricDirection,
  OutcomeProjection,
  ProjectDetailProjection,
  ProjectMemberProjection,
  ProjectMemberStatus,
  ProjectResponsibilityProjection,
  ProjectResponsibilityReviewDiff,
  ProjectResponsibilityReviewValue,
  ProjectResponsibilitySuggestedValue,
  ProjectStartProjection,
  ProjectSummaryProjection,
  ProjectTeamProjection,
  ProjectTemplateSelection,
  ProjectTemplateSnapshotProjection,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterProjection,
  SetStatusResult,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
  SuggestedChangeDecisionMode,
  SuggestedChangeEvidenceProjection,
  SuggestedChangePersistedState,
  SuggestedChangeRiskLevel,
  SuggestedChangeRiskReason,
  WorkbenchActivityItem,
  WorkbenchActivityProjection,
  WorkbenchActivitySummaryCode,
  WorkbenchAuditAction,
  WorkbenchAuditIntegrityIssue,
  WorkbenchAuditIntegrityProjection,
  WorkbenchAuditObjectType,
  WorkbenchOutboxErrorCode,
  WorkbenchOutboxState,
  WorkbenchStatusSnapshot,
} from './client.ts'
import {
  AUDIT_GENESIS_HASH,
  canonicalizeJson,
  createAuditEvent,
  verifyAuditChain as verifyAuditEvents,
  type AuditEvent,
  type AuditHash,
  type AuditIntegrityFailureCode,
} from './audit.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  isKnowledgeWorkTemplateSelection,
  knowledgeWorkTemplateProjection,
} from './project-template.ts'
import {
  projectTeamCommandResult,
  projectTeamProjection,
  reviewCenterProjection,
  statusResult,
  statusSnapshot,
  type WorkbenchActivityQuery,
  type WorkbenchCommandMetadata,
  type WorkbenchOutboxClaim,
  type WorkbenchOutboxClaimRequest,
  type WorkbenchOutboxSettlement,
  type WorkbenchProjectMutation,
  type WorkbenchProjectMemberMutation,
  type WorkbenchProjectMemberStatusMutation,
  type WorkbenchProjectReadQuery,
  type WorkbenchProjectResponsibilityMutation,
  type WorkbenchProjectStartQuery,
  type WorkbenchProjectTeamReadQuery,
  type WorkbenchReviewCenterQuery,
  type WorkbenchRepository,
  type WorkbenchStatusMutation,
  type WorkbenchSuggestedChangeDecisionMutation,
  type WorkbenchSuggestedChangeProposalMutation,
} from './repository.ts'

export const WORKBENCH_SCHEMA_VERSION = 5
export const WORKBENCH_SQLITE_APPLICATION_ID = 0x44535742

const STATUS_COMMAND_TYPE = 'workbench.status.set'
const STATUS_AUDIT_ACTION = 'workbench.status.updated'
const STATUS_OBJECT_TYPE = 'workbench-status'
const STATUS_REASON = 'owner-status-edit'
const STATUS_SUMMARY = 'status-revision-committed'
const STATUS_OUTBOX_TOPIC = 'workbench.status.committed.v1'
const PROJECT_COMMAND_TYPE = 'workbench.project.create'
const PROJECT_AUDIT_ACTION = 'workbench.project.created'
const PROJECT_OBJECT_TYPE = 'project'
const PROJECT_REASON = 'owner-project-create'
const PROJECT_SUMMARY = 'project-created-from-template'
const PROJECT_OUTBOX_TOPIC = 'workbench.project.created.v1'
const PROJECT_MEMBER_COMMAND_TYPE = 'workbench.project-member.add'
const PROJECT_MEMBER_AUDIT_ACTION = 'workbench.project-member.created'
const PROJECT_MEMBER_OBJECT_TYPE = 'project-member'
const PROJECT_MEMBER_REASON = 'owner-project-member-add'
const PROJECT_MEMBER_SUMMARY = 'project-member-created'
const PROJECT_MEMBER_OUTBOX_TOPIC = 'workbench.project-member.created.v1'
const PROJECT_MEMBER_STATUS_COMMAND_TYPE = 'workbench.project-member.set-status'
const PROJECT_MEMBER_STATUS_AUDIT_ACTION = 'workbench.project-member.status-changed'
const PROJECT_MEMBER_STATUS_REASON = 'owner-project-member-status-change'
const PROJECT_MEMBER_STATUS_SUMMARY = 'project-member-status-changed'
const PROJECT_MEMBER_STATUS_OUTBOX_TOPIC = 'workbench.project-member.status-changed.v1'
const PROJECT_RESPONSIBILITY_COMMAND_TYPE = 'workbench.project.set-responsibility'
const PROJECT_RESPONSIBILITY_AUDIT_ACTION = 'workbench.project.responsibility-assigned'
const PROJECT_RESPONSIBILITY_OBJECT_TYPE = 'project-responsibility'
const PROJECT_RESPONSIBILITY_REASON = 'owner-project-responsibility-set'
const PROJECT_RESPONSIBILITY_SUMMARY = 'project-responsibility-assigned'
const PROJECT_RESPONSIBILITY_OUTBOX_TOPIC = 'workbench.project.responsibility-assigned.v1'
const SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE = 'workbench.suggested-change.propose'
const SUGGESTED_CHANGE_PROPOSAL_AUDIT_ACTION = 'workbench.suggested-change.proposed'
const SUGGESTED_CHANGE_PROPOSAL_REASON = 'owner-suggested-change-propose'
const SUGGESTED_CHANGE_PROPOSAL_SUMMARY = 'suggested-change-proposed'
const SUGGESTED_CHANGE_PROPOSAL_OUTBOX_TOPIC = 'workbench.suggested-change.proposed.v1'
const SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE = 'workbench.suggested-change.accept'
const SUGGESTED_CHANGE_ACCEPT_AUDIT_ACTION = 'workbench.suggested-change.accepted'
const SUGGESTED_CHANGE_ACCEPT_REASON = 'owner-suggested-change-accept'
const SUGGESTED_CHANGE_ACCEPT_SUMMARY = 'suggested-change-accepted'
const SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE = 'workbench.suggested-change.edit-accept'
const SUGGESTED_CHANGE_EDIT_ACCEPT_AUDIT_ACTION = 'workbench.suggested-change.edited-accepted'
const SUGGESTED_CHANGE_EDIT_ACCEPT_REASON = 'owner-suggested-change-edit-accept'
const SUGGESTED_CHANGE_EDIT_ACCEPT_SUMMARY = 'suggested-change-edited-accepted'
const SUGGESTED_CHANGE_REJECT_COMMAND_TYPE = 'workbench.suggested-change.reject'
const SUGGESTED_CHANGE_REJECT_AUDIT_ACTION = 'workbench.suggested-change.rejected'
const SUGGESTED_CHANGE_REJECT_REASON = 'owner-suggested-change-reject'
const SUGGESTED_CHANGE_REJECT_SUMMARY = 'suggested-change-rejected'
const SUGGESTED_CHANGE_DEFER_COMMAND_TYPE = 'workbench.suggested-change.defer'
const SUGGESTED_CHANGE_DEFER_AUDIT_ACTION = 'workbench.suggested-change.deferred'
const SUGGESTED_CHANGE_DEFER_REASON = 'owner-suggested-change-defer'
const SUGGESTED_CHANGE_DEFER_SUMMARY = 'suggested-change-deferred'
const SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC = 'workbench.suggested-change.decided.v1'
const SUGGESTED_CHANGE_OBJECT_TYPE = 'suggested-change'
const SUGGESTED_CHANGE_TARGET_ADAPTER = 'project-responsibility.replace'
const SUGGESTED_CHANGE_POLICY_VERSION = 'project-responsibility-v1'
const SUGGESTED_CHANGE_REPRESENTATION_VERSION = 1
const MAX_REVIEW_CENTER_LIMIT = 50
const MAX_SUGGESTED_CHANGE_EVIDENCE = 20
const MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH = 2_000
const MAX_ACTIVITY_LIMIT = 100
const MAX_PROJECT_PAGE_LIMIT = 100
const MAX_PROJECT_OUTCOMES = 20
const MAX_SUPPORTING_GOALS = 20
const MAX_DOMAIN_NAME_LENGTH = 200
const MAX_METRIC_NAME_LENGTH = 120
const MAX_METRIC_UNIT_LENGTH = 64
const MAX_DOMAIN_ID_LENGTH = 128
const MAX_PROJECT_MEMBERS = 100
const MAX_RESPONSIBILITY_CONTRIBUTORS = 20
const MAX_MEMBER_DISPLAY_NAME_LENGTH = 200
const MAX_FEISHU_APP_ID_LENGTH = 128
const MAX_FEISHU_OPEN_ID_LENGTH = 128
const MAX_EXTERNAL_CONTACT_LENGTH = 320

export type WorkbenchJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

export interface SqliteWorkbenchRepositoryOptions {
  readonly databasePath: string
  readonly journalMode: WorkbenchJournalMode
  readonly busyTimeoutMs: number
  /** Trusted repository observation clock; injectable only for deterministic tests. */
  readonly now?: () => Date
}

interface StatusRow {
  readonly id: string
  readonly message: string
  readonly revision: number
  readonly updated_at: string
}

interface ProjectCatalogRow {
  readonly revision: number
}

interface ProjectTeamHeadRow {
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly team_revision: number
  readonly current_responsibility_revision: number | null
  readonly updated_at: string
}

interface ProjectMemberRow {
  readonly id: string
  readonly organization_id: string
  readonly team_id: string
  readonly project_id: string
  readonly kind: string
  readonly display_name: string
  readonly status: string
  readonly identity_type: string
  readonly feishu_app_id: string | null
  readonly feishu_open_id: string | null
  readonly external_method: string | null
  readonly external_value: string | null
  readonly revision: number
  readonly created_at: string
  readonly updated_at: string
}

interface ProjectResponsibilityRow {
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly revision: number
  readonly accountable_member_id: string
  readonly human_sponsor_member_id: string | null
  readonly contributor_count: number
  readonly updated_at: string
}

interface ProjectResponsibilityContributorRow {
  readonly member_id: string
  readonly ordinal: number
}

interface SuggestedChangeRow {
  readonly sequence: number
  readonly id: string
  readonly organization_id: string
  readonly team_id: string
  readonly project_id: string
  readonly source_actor_id: string
  readonly target_adapter: string
  readonly representation_schema_version: number
  readonly base_team_revision: number
  readonly base_responsibility_revision: number | null
  readonly candidate_json: string
  readonly proposed_diff_json: string
  readonly proposed_diff_digest: string
  readonly proposed_risk_level: string
  readonly proposed_risk_reasons_json: string
  readonly policy_version: string
  readonly origin_causation_id: string
  readonly proposal_command_id: string
  readonly revision: number
  readonly persisted_state: string
  readonly created_at: string
  readonly updated_at: string
}

interface SuggestedChangeDecisionRow {
  readonly id: string
  readonly suggested_change_id: string
  readonly suggested_change_revision: number
  readonly mode: string
  readonly actor_id: string
  readonly feedback: string
  readonly applied_candidate_json: string | null
  readonly applied_diff_json: string | null
  readonly applied_risk_level: string | null
  readonly applied_risk_reasons_json: string
  readonly applied_team_revision: number | null
  readonly applied_responsibility_revision: number | null
  readonly causation_id: string
  readonly command_id: string
  readonly audit_event_id: string
  readonly outbox_id: string
  readonly decided_at: string
}

interface SuggestedChangeEvidenceRow {
  readonly suggested_change_id: string
  readonly ordinal: number
  readonly audit_event_id: string
}

interface TemplateVersionRow {
  readonly template_id: string
  readonly template_version: number
  readonly snapshot_schema_version: number
  readonly kind: string
  readonly canonical_definition_json: string
  readonly definition_digest: string
}

interface GoalRow {
  readonly id: string
  readonly organization_id: string
  readonly team_id: string
  readonly name: string
  readonly revision: number
  readonly state: string
  readonly created_at: string
  readonly updated_at: string
}

interface OutcomeRow {
  readonly id: string
  readonly goal_id: string
  readonly ordinal: number
  readonly name: string
  readonly metric_name: string
  readonly initial_value: number
  readonly target_value: number
  readonly unit: string
  readonly direction: string
  readonly revision: number
  readonly created_at: string
  readonly updated_at: string
}

interface ProjectSummaryRow {
  readonly project_id: string
  readonly project_name: string
  readonly project_revision: number
  readonly catalog_sequence: number
  readonly timezone: string
  readonly created_at: string
  readonly primary_goal_id: string
  readonly primary_goal_name: string
  readonly primary_goal_revision: number
}

interface ProjectDetailRow extends ProjectSummaryRow {
  readonly organization_id: string
  readonly team_id: string
  readonly template_id: string
  readonly template_version: number
  readonly template_definition_digest: string
  readonly snapshot_schema_version: number
  readonly snapshot_digest: string
  readonly canonical_snapshot_json: string
  readonly captured_at: string
}

interface SupportingGoalRow {
  readonly goal_id: string
  readonly name: string
  readonly revision: number
  readonly ordinal: number
  readonly linked_goal_revision: number
}

interface ReceiptRow {
  readonly command_type: string
  readonly request_hash: string
  readonly command_id: string
  readonly audit_event_id: string
  readonly outbox_id: string
  readonly result_json: string
}

interface ReceiptIntegrityRow extends ReceiptRow {
  readonly receipt_organization_id: string
  readonly receipt_actor_id: string
  readonly idempotency_key_hash: string
  readonly committed_at: string
  readonly audit_object_id: string
  readonly audit_sequence: number
  readonly audit_object_version: number
  readonly audit_occurred_at: string
  readonly audit_causation_id: string
  readonly audit_command_id: string
  readonly audit_outbox_id: string | null
  readonly audit_action: string
  readonly audit_actor_id: string
  readonly audit_reason_code: string
  readonly audit_object_type: string
  readonly audit_project_id: string | null
  readonly audit_organization_id: string
  readonly audit_team_id: string
  readonly audit_summary_code: string
  readonly outbox_command_id: string
  readonly outbox_organization_id: string
  readonly outbox_topic: string
  readonly outbox_project_id: string | null
  readonly outbox_object_type: string
  readonly outbox_object_id: string
  readonly outbox_object_version: number
  readonly outbox_causation_id: string
  readonly outbox_payload_json: string
}

interface AuditHeadRow {
  readonly sequence: number
  readonly head_hash: string
}

interface AuditRow {
  readonly sequence: number
  readonly id: string
  readonly occurred_at: string
  readonly actor_kind: string
  readonly actor_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly project_id: string | null
  readonly action: string
  readonly reason_code: string
  readonly reason_detail: string | null
  readonly object_type: string
  readonly object_id: string
  readonly object_version: number
  readonly command_id: string
  readonly command_type: string
  readonly causation_id: string
  readonly outbox_id: string | null
  readonly outbox_state: string | null
  readonly outcome: string
  readonly summary_code: string
  readonly summary_fields_json: string
  readonly previous_hash: string
  readonly event_hash: string
  readonly canonical_envelope: string
}

interface ActivityRow {
  readonly sequence: number
  readonly event_id: string
  readonly occurred_at: string
  readonly actor_kind: string
  readonly actor_id: string
  readonly project_id: string | null
  readonly action: string
  readonly reason_code: string
  readonly object_type: string
  readonly object_id: string
  readonly object_version: number
  readonly causation_id: string
  readonly command_id: string
  readonly command_type: string
  readonly summary_code: string
  readonly previous_hash: string
  readonly event_hash: string
  readonly outbox_id: string
  readonly outbox_state: string
  readonly attempt_count: number
  readonly outbox_updated_at: string
  readonly error_code: string | null
}

interface OutboxClaimRow {
  readonly id: string
  readonly topic: string
  readonly effect_key: string
  readonly payload_json: string
  readonly causation_id: string
  readonly attempt_count: number
}

const JOURNAL_MODES = new Set<WorkbenchJournalMode>(['wal', 'delete', 'truncate', 'persist'])
const MAX_BUSY_TIMEOUT_MS = 2_147_483_647
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const SHA256_HEX = /^[0-9a-f]{64}$/u
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/u
const OUTBOX_ERROR_CODES = new Set<WorkbenchOutboxErrorCode>([
  'lease-expired',
  'transport-ambiguous',
  'definitive-rejection',
])
const REQUIRED_IMMUTABILITY_TRIGGERS = [
  'workbench_audit_event_no_update',
  'workbench_audit_event_no_delete',
  'workbench_outbox_intent_no_update',
  'workbench_outbox_no_delete',
  'workbench_command_receipt_no_update',
  'workbench_command_receipt_no_delete',
  'workbench_template_version_no_update',
  'workbench_template_version_no_delete',
  'workbench_project_template_snapshot_no_update',
  'workbench_project_template_snapshot_no_delete',
  'workbench_project_snapshot_columns_no_update',
  'workbench_project_team_scope_no_update',
  'workbench_project_team_no_delete',
  'workbench_project_member_identity_no_update',
  'workbench_project_member_no_delete',
  'workbench_project_responsibility_no_update',
  'workbench_project_responsibility_no_delete',
  'workbench_project_responsibility_contributor_no_update',
  'workbench_project_responsibility_contributor_no_delete',
  'workbench_suggested_change_envelope_no_update',
  'workbench_suggested_change_head_transition',
  'workbench_suggested_change_no_delete',
  'workbench_suggested_change_evidence_no_update',
  'workbench_suggested_change_evidence_no_delete',
  'workbench_suggested_change_decision_no_update',
  'workbench_suggested_change_decision_no_delete',
] as const

/** A single-connection repository whose write transaction body is wholly synchronous. */
export class SqliteWorkbenchRepository implements WorkbenchRepository {
  private readonly options: SqliteWorkbenchRepositoryOptions
  private database: DatabaseSync | undefined
  private opening: Promise<void> | undefined
  private closePromise: Promise<void> | undefined

  constructor(options: SqliteWorkbenchRepositoryOptions) {
    validateOptions(options)
    this.options = options
  }

  get closed(): boolean {
    return this.closePromise !== undefined && this.database === undefined
  }

  async open(): Promise<void> {
    if (this.closePromise !== undefined) throw new Error('workbench repository is closed')
    if (this.database !== undefined) return
    this.opening ??= this.openDatabase()
    return this.opening
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    throwIfAborted(signal)
    const row = readStatus(this.requireDatabase())
    throwIfAborted(signal)
    return row === null ? null : statusSnapshot(row)
  }

  async commitStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    throwIfAborted(signal)
    validateMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = digest(`project-workbench.idempotency.v1\0${mutation.command.idempotencyKey}`)
    const requestHash = statusRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = database.prepare(`
        SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
        FROM workbench_command_receipt
        WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
      `).get(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
      ) as ReceiptRow | undefined
      if (receipt !== undefined) {
        if (receipt.command_type !== STATUS_COMMAND_TYPE || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return idempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeCommittedResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const current = readStatus(database)
      const actualRevision = current?.revision ?? null
      if (actualRevision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return revisionConflict(mutation.expectedRevision, current)
      }
      if (current !== null && current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Workbench status revision exhausted')
      }

      const next: WorkbenchStatusSnapshot = current === null
        ? {
          id: mutation.candidateId,
          message: mutation.message,
          revision: 1,
          updatedAt: mutation.updatedAt,
        }
        : {
          id: current.id,
          message: mutation.message,
          revision: current.revision + 1,
          updatedAt: mutation.updatedAt,
        }
      writeStatus(database, next, current === null)

      const outboxPayload = canonicalizeJson({
        schemaVersion: 1,
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        statusId: next.id,
        statusRevision: next.revision,
        causationId: mutation.command.causationId,
      })
      insertOutbox(database, mutation, next, outboxPayload)

      const head = readAuditHead(database)
      if (head.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Workbench audit sequence exhausted')
      const sequence = head.sequence + 1
      const event = createAuditEvent({
        sequence: String(sequence),
        previousHash: auditHash(head.head_hash),
        auditId: mutation.command.auditEventId,
        occurredAt: mutation.command.occurredAt,
        actor: { kind: mutation.command.actor.kind, id: mutation.command.actor.id },
        action: STATUS_AUDIT_ACTION,
        scope: {
          organizationId: mutation.command.actor.organizationId,
          teamId: mutation.command.actor.teamId,
          projectId: null,
        },
        reason: { code: mutation.command.reason },
        object: { type: STATUS_OBJECT_TYPE, id: next.id, version: String(next.revision) },
        command: { id: mutation.command.commandId, type: STATUS_COMMAND_TYPE },
        causation: { id: mutation.command.causationId },
        outbox: { id: mutation.command.outboxId, state: 'pending' },
        outcome: 'committed',
        summary: { code: STATUS_SUMMARY, changedFields: ['message'] },
      })
      insertAuditEvent(database, event)
      const advanced = database.prepare(`
        UPDATE workbench_audit_head
        SET sequence = ?, head_hash = ?
        WHERE singleton = 1 AND sequence = ? AND head_hash = ?
      `).run(sequence, event.eventHash, head.sequence, head.head_hash)
      if (advanced.changes !== 1) throw new Error('Workbench audit head did not advance exactly once')

      const committed = statusResult({
        ok: true,
        value: next,
        receipt: {
          commandId: mutation.command.commandId,
          auditEventId: mutation.command.auditEventId,
          outboxId: mutation.command.outboxId,
        },
      })
      const resultJson = canonicalizeJson(committed)
      const saved = database.prepare(`
        INSERT INTO workbench_command_receipt (
          organization_id, actor_id, idempotency_key_hash, command_type,
          request_hash, command_id, audit_event_id, outbox_id, result_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
        STATUS_COMMAND_TYPE,
        requestHash,
        mutation.command.commandId,
        mutation.command.auditEventId,
        mutation.command.outboxId,
        resultJson,
        mutation.command.occurredAt,
      )
      if (saved.changes !== 1) throw new Error('Workbench command receipt was not inserted exactly once')

      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readProjectStart(
    query: WorkbenchProjectStartQuery,
    signal: AbortSignal,
  ): Promise<ProjectStartProjection> {
    throwIfAborted(signal)
    validateProjectStartQuery(query)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      const template = readCompiledTemplate(database)
      const catalogRevision = readProjectCatalog(database).revision
      const limit = query.filter.limit ?? 20
      const parameters: Array<string | number> = [query.organizationId, query.teamId]
      const cursor = query.filter.beforeSequence
      const cursorClause = cursor === undefined ? '' : 'AND project.catalog_sequence < ?'
      if (cursor !== undefined) parameters.push(cursor)
      parameters.push(limit + 1)
      const rows = database.prepare(`
        SELECT project.id AS project_id, project.name AS project_name,
          project.revision AS project_revision, project.catalog_sequence,
          project.timezone, project.created_at,
          goal.id AS primary_goal_id, goal.name AS primary_goal_name,
          goal.revision AS primary_goal_revision
        FROM workbench_project AS project
        INNER JOIN workbench_goal AS goal
          ON goal.organization_id = project.organization_id
          AND goal.team_id = project.team_id
          AND goal.id = project.primary_goal_id
        WHERE project.organization_id = ? AND project.team_id = ?
          ${cursorClause}
        ORDER BY project.catalog_sequence DESC
        LIMIT ?
      `).all(...parameters) as unknown as ProjectSummaryRow[]
      const hasMore = rows.length > limit
      const visible = hasMore ? rows.slice(0, limit) : rows
      const projects = Object.freeze(visible.map(projectSummaryFromRow))
      const projection = Object.freeze({
        template,
        catalogRevision,
        projects,
        nextBeforeSequence: hasMore ? projects.at(-1)?.catalogSequence ?? null : null,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitProject(
    mutation: WorkbenchProjectMutation,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    throwIfAborted(signal)
    validateProjectMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = digest(`project-workbench.idempotency.v1\0${mutation.command.idempotencyKey}`)
    const requestHash = projectRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = database.prepare(`
        SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
        FROM workbench_command_receipt
        WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
      `).get(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
      ) as ReceiptRow | undefined
      if (receipt !== undefined) {
        if (receipt.command_type !== PROJECT_COMMAND_TYPE || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return idempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeCommittedProjectResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      readCompiledTemplate(database)
      if (!isKnowledgeWorkTemplateSelection(mutation.template)) {
        database.exec('ROLLBACK')
        began = false
        return templateVersionConflict()
      }

      const catalog = readProjectCatalog(database)
      if (catalog.revision !== mutation.expectedCatalogRevision) {
        database.exec('ROLLBACK')
        began = false
        return catalogRevisionConflict(mutation.expectedCatalogRevision, catalog.revision)
      }
      if (catalog.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Workbench Project catalog revision exhausted')
      }

      for (const supporting of mutation.supportingGoals) {
        const row = database.prepare(`
          SELECT id, organization_id, team_id, name, revision, state, created_at, updated_at
          FROM workbench_goal
          WHERE organization_id = ? AND team_id = ? AND id = ?
        `).get(
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          supporting.goalId,
        ) as GoalRow | undefined
        if (row === undefined || row.state !== 'active' || row.revision !== supporting.expectedRevision) {
          database.exec('ROLLBACK')
          began = false
          return supportingGoalConflict(
            supporting.goalId,
            supporting.expectedRevision,
            row === undefined ? null : positiveInteger(row.revision, 'Supporting Goal revision'),
          )
        }
        goalSummaryFromRow(row)
      }

      const nextCatalogRevision = catalog.revision + 1
      insertProjectDomain(database, mutation, nextCatalogRevision)
      const advancedCatalog = database.prepare(`
        UPDATE workbench_project_catalog SET revision = ?
        WHERE singleton = 1 AND revision = ?
      `).run(nextCatalogRevision, catalog.revision)
      if (advancedCatalog.changes !== 1) {
        throw new Error('Workbench Project catalog did not advance exactly once')
      }

      const outboxPayload = canonicalizeJson({
        schemaVersion: 1,
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        projectId: mutation.projectId,
        projectRevision: 1,
        primaryGoalId: mutation.primaryGoalId,
        primaryGoalRevision: 1,
        templateId: mutation.template.templateId,
        templateVersion: mutation.template.templateVersion,
        templateDefinitionDigest: mutation.template.definitionDigest,
        outcomeCount: mutation.primaryGoal.outcomes.length,
        supportingGoalCount: mutation.supportingGoals.length,
        catalogRevision: nextCatalogRevision,
        causationId: mutation.command.causationId,
      })
      insertProjectOutbox(database, mutation, outboxPayload)

      const head = readAuditHead(database)
      if (head.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Workbench audit sequence exhausted')
      const sequence = head.sequence + 1
      const event = createAuditEvent({
        sequence: String(sequence),
        previousHash: auditHash(head.head_hash),
        auditId: mutation.command.auditEventId,
        occurredAt: mutation.command.occurredAt,
        actor: { kind: mutation.command.actor.kind, id: mutation.command.actor.id },
        action: PROJECT_AUDIT_ACTION,
        scope: {
          organizationId: mutation.command.actor.organizationId,
          teamId: mutation.command.actor.teamId,
          projectId: mutation.projectId,
        },
        reason: { code: mutation.command.reason },
        object: { type: PROJECT_OBJECT_TYPE, id: mutation.projectId, version: '1' },
        command: { id: mutation.command.commandId, type: PROJECT_COMMAND_TYPE },
        causation: { id: mutation.command.causationId },
        outbox: { id: mutation.command.outboxId, state: 'pending' },
        outcome: 'committed',
        summary: {
          code: PROJECT_SUMMARY,
          changedFields: ['primaryGoal', 'outcomes', 'supportingGoals', 'templateSnapshot'],
        },
      })
      insertAuditEvent(database, event)
      const advancedHead = database.prepare(`
        UPDATE workbench_audit_head
        SET sequence = ?, head_hash = ?
        WHERE singleton = 1 AND sequence = ? AND head_hash = ?
      `).run(sequence, event.eventHash, head.sequence, head.head_hash)
      if (advancedHead.changes !== 1) throw new Error('Workbench audit head did not advance exactly once')

      const detail = readProjectDetailSync(database, {
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
        projectId: mutation.projectId,
      })
      if (detail === null) throw new Error('Workbench committed Project cannot be read back')
      const committed = projectResult({
        ok: true,
        value: detail,
        catalogRevision: nextCatalogRevision,
        receipt: {
          commandId: mutation.command.commandId,
          auditEventId: mutation.command.auditEventId,
          outboxId: mutation.command.outboxId,
        },
      })
      const resultJson = canonicalizeJson(committed)
      const saved = database.prepare(`
        INSERT INTO workbench_command_receipt (
          organization_id, actor_id, idempotency_key_hash, command_type,
          request_hash, command_id, audit_event_id, outbox_id, result_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
        PROJECT_COMMAND_TYPE,
        requestHash,
        mutation.command.commandId,
        mutation.command.auditEventId,
        mutation.command.outboxId,
        resultJson,
        mutation.command.occurredAt,
      )
      if (saved.changes !== 1) throw new Error('Workbench command receipt was not inserted exactly once')

      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readProject(
    query: WorkbenchProjectReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectDetailProjection | null> {
    throwIfAborted(signal)
    validateProjectReadQuery(query)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      const detail = readProjectDetailSync(database, query)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return detail
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readProjectTeam(
    query: WorkbenchProjectTeamReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectTeamProjection | null> {
    throwIfAborted(signal)
    validateProjectTeamReadQuery(query)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      const team = readProjectTeamSync(database, query)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return team
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitProjectMember(
    mutation: WorkbenchProjectMemberMutation,
    signal: AbortSignal,
  ): Promise<AddProjectMemberResult> {
    throwIfAborted(signal)
    validateProjectMemberMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = projectMemberRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findReceipt(database, mutation, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== PROJECT_MEMBER_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return projectTeamIdempotencyConflict<AddProjectMemberResult>()
        }
        assertValidLedger(database)
        const replay = decodeProjectMemberResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const head = readProjectTeamHead(database, mutation)
      if (head === null) {
        database.exec('ROLLBACK')
        began = false
        return projectNotFound<AddProjectMemberResult>(mutation.projectId)
      }
      if (head.team_revision !== mutation.expectedTeamRevision) {
        database.exec('ROLLBACK')
        began = false
        return teamRevisionConflict<AddProjectMemberResult>(
          mutation.expectedTeamRevision,
          head.team_revision,
        )
      }
      const memberCount = integerField(database.prepare(`
        SELECT COUNT(*) AS count FROM workbench_project_member WHERE project_id = ?
      `).get(mutation.projectId), 'count')
      if (memberCount >= MAX_PROJECT_MEMBERS) {
        database.exec('ROLLBACK')
        began = false
        return projectTeamCommandResult({
          ok: false,
          error: {
            code: 'member-limit-reached',
            message: `Workbench Project Team already contains ${MAX_PROJECT_MEMBERS} members`,
            limit: 100,
          },
        })
      }
      if (mutation.member.kind === 'human' && mutation.member.identity.type === 'feishu') {
        const duplicate = database.prepare(`
          SELECT id FROM workbench_project_member
          WHERE project_id = ? AND identity_type = 'feishu'
            AND feishu_app_id = ? AND feishu_open_id = ?
        `).get(
          mutation.projectId,
          mutation.member.identity.appId,
          mutation.member.identity.openId,
        )
        if (duplicate !== undefined) {
          database.exec('ROLLBACK')
          began = false
          return projectTeamCommandResult({
            ok: false,
            error: {
              code: 'duplicate-feishu-identity',
              message: 'Workbench Project Team already contains this app-scoped Feishu identity',
            },
          })
        }
      }

      insertProjectMember(database, mutation)
      const teamRevision = advanceProjectTeamHead(
        database,
        head,
        mutation.createdAt,
        head.current_responsibility_revision,
      )
      const committed = projectTeamCommandResult({
        ok: true,
        value: {
          projectId: mutation.projectId,
          memberId: mutation.memberId,
          kind: mutation.member.kind,
          status: 'active',
          memberRevision: 1,
          teamRevision,
        },
        receipt: commandReceipt(mutation),
      } satisfies AddProjectMemberResult)
      appendProjectTeamLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: PROJECT_MEMBER_COMMAND_TYPE,
        auditAction: PROJECT_MEMBER_AUDIT_ACTION,
        objectType: PROJECT_MEMBER_OBJECT_TYPE,
        objectId: mutation.memberId,
        objectVersion: 1,
        projectId: mutation.projectId,
        summaryCode: PROJECT_MEMBER_SUMMARY,
        changedFields: ['member', 'teamRevision'],
        outboxTopic: PROJECT_MEMBER_OUTBOX_TOPIC,
        payload: {
          projectId: mutation.projectId,
          memberId: mutation.memberId,
          memberKind: mutation.member.kind,
          memberStatus: 'active',
          memberRevision: 1,
          teamRevision,
        },
        result: committed,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitProjectMemberStatus(
    mutation: WorkbenchProjectMemberStatusMutation,
    signal: AbortSignal,
  ): Promise<SetProjectMemberStatusResult> {
    throwIfAborted(signal)
    validateProjectMemberStatusMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = projectMemberStatusRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findReceipt(database, mutation, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== PROJECT_MEMBER_STATUS_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return projectTeamIdempotencyConflict<SetProjectMemberStatusResult>()
        }
        assertValidLedger(database)
        const replay = decodeProjectMemberStatusResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const head = readProjectTeamHead(database, mutation)
      if (head === null) {
        database.exec('ROLLBACK')
        began = false
        return projectNotFound<SetProjectMemberStatusResult>(mutation.projectId)
      }
      if (head.team_revision !== mutation.expectedTeamRevision) {
        database.exec('ROLLBACK')
        began = false
        return teamRevisionConflict<SetProjectMemberStatusResult>(
          mutation.expectedTeamRevision,
          head.team_revision,
        )
      }
      const member = readProjectMember(database, mutation.projectId, mutation.memberId)
      if (member === null) {
        database.exec('ROLLBACK')
        began = false
        return memberNotFound<SetProjectMemberStatusResult>(mutation.memberId)
      }
      if (member.revision !== mutation.expectedMemberRevision) {
        database.exec('ROLLBACK')
        began = false
        return projectTeamCommandResult({
          ok: false,
          error: {
            code: 'member-revision-conflict',
            message: `Workbench ProjectMember revision changed for ${mutation.memberId}`,
            memberId: mutation.memberId,
            expectedMemberRevision: mutation.expectedMemberRevision,
            currentMemberRevision: member.revision,
          },
        })
      }
      if (member.status === mutation.status) {
        database.exec('ROLLBACK')
        began = false
        return projectTeamCommandResult({
          ok: false,
          error: {
            code: 'member-status-conflict',
            message: `Workbench ProjectMember already has status ${mutation.status}`,
            memberId: mutation.memberId,
            status: mutation.status,
          },
        })
      }
      if (mutation.status === 'inactive'
        && isMemberInCurrentResponsibility(database, head, mutation.memberId)) {
        database.exec('ROLLBACK')
        began = false
        return projectTeamCommandResult({
          ok: false,
          error: {
            code: 'member-in-use',
            message: `Workbench ProjectMember ${mutation.memberId} holds a current responsibility`,
            memberId: mutation.memberId,
          },
        })
      }
      if (member.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Workbench ProjectMember revision exhausted')
      }
      const memberRevision = member.revision + 1
      const updated = database.prepare(`
        UPDATE workbench_project_member
        SET status = ?, revision = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND revision = ? AND status = ?
      `).run(
        mutation.status,
        memberRevision,
        mutation.updatedAt,
        mutation.projectId,
        mutation.memberId,
        member.revision,
        member.status,
      )
      if (updated.changes !== 1) {
        throw new Error('Workbench ProjectMember status did not change exactly once')
      }
      const teamRevision = advanceProjectTeamHead(
        database,
        head,
        mutation.updatedAt,
        head.current_responsibility_revision,
      )
      const committed = projectTeamCommandResult({
        ok: true,
        value: {
          projectId: mutation.projectId,
          memberId: mutation.memberId,
          kind: projectMemberKind(member.kind),
          status: mutation.status,
          memberRevision,
          teamRevision,
        },
        receipt: commandReceipt(mutation),
      } satisfies SetProjectMemberStatusResult)
      appendProjectTeamLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: PROJECT_MEMBER_STATUS_COMMAND_TYPE,
        auditAction: PROJECT_MEMBER_STATUS_AUDIT_ACTION,
        objectType: PROJECT_MEMBER_OBJECT_TYPE,
        objectId: mutation.memberId,
        objectVersion: memberRevision,
        projectId: mutation.projectId,
        summaryCode: PROJECT_MEMBER_STATUS_SUMMARY,
        changedFields: ['status', 'teamRevision'],
        outboxTopic: PROJECT_MEMBER_STATUS_OUTBOX_TOPIC,
        payload: {
          projectId: mutation.projectId,
          memberId: mutation.memberId,
          memberKind: member.kind,
          memberStatus: mutation.status,
          memberRevision,
          teamRevision,
        },
        result: committed,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitProjectResponsibility(
    mutation: WorkbenchProjectResponsibilityMutation,
    signal: AbortSignal,
  ): Promise<SetProjectResponsibilityResult> {
    throwIfAborted(signal)
    validateProjectResponsibilityMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = projectResponsibilityRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findReceipt(database, mutation, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== PROJECT_RESPONSIBILITY_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return projectTeamIdempotencyConflict<SetProjectResponsibilityResult>()
        }
        assertValidLedger(database)
        const replay = decodeProjectResponsibilityResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const replacement = responsibilityReplacementInput(mutation)
      const plan = planProjectResponsibilityReplacement(database, replacement)
      if (!plan.ok) {
        database.exec('ROLLBACK')
        began = false
        return projectTeamCommandResult({
          ok: false,
          error: plan.error,
        } as SetProjectResponsibilityResult)
      }
      const { responsibilityRevision, teamRevision } = applyProjectResponsibilityPlan(
        database,
        replacement,
        plan,
      )
      const committed = projectTeamCommandResult({
        ok: true,
        value: {
          projectId: mutation.projectId,
          responsibilityRevision,
          teamRevision,
        },
        receipt: commandReceipt(mutation),
      } satisfies SetProjectResponsibilityResult)
      appendProjectTeamLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: PROJECT_RESPONSIBILITY_COMMAND_TYPE,
        auditAction: PROJECT_RESPONSIBILITY_AUDIT_ACTION,
        objectType: PROJECT_RESPONSIBILITY_OBJECT_TYPE,
        objectId: mutation.projectId,
        objectVersion: responsibilityRevision,
        projectId: mutation.projectId,
        summaryCode: PROJECT_RESPONSIBILITY_SUMMARY,
        changedFields: ['accountable', 'contributors', 'humanSponsor', 'teamRevision'],
        outboxTopic: PROJECT_RESPONSIBILITY_OUTBOX_TOPIC,
        payload: {
          projectId: mutation.projectId,
          responsibilityRevision,
          teamRevision,
        },
        result: committed,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readReviewCenter(
    query: WorkbenchReviewCenterQuery,
    signal: AbortSignal,
  ): Promise<ReviewCenterProjection | null> {
    throwIfAborted(signal)
    validateReviewCenterQuery(query)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      assertValidLedger(database)
      const projection = readReviewCenterSync(database, query)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitSuggestedChangeProposal(
    mutation: WorkbenchSuggestedChangeProposalMutation,
    signal: AbortSignal,
  ): Promise<ProposeProjectResponsibilityChangeResult> {
    throwIfAborted(signal)
    validateSuggestedChangeProposalMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = suggestedChangeProposalRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findReceipt(database, mutation, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return suggestedChangeIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeSuggestedChangeProposalResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const head = readProjectTeamHead(database, {
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
        projectId: mutation.projectId,
      })
      if (head === null) {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeProjectNotFound(mutation.projectId)
      }
      if (head.team_revision !== mutation.expectedTeamRevision) {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeTeamRevisionConflict(
          mutation.expectedTeamRevision,
          head.team_revision,
        )
      }
      const replacement: ResponsibilityReplacementInput = {
        projectId: mutation.projectId,
        accountableMemberId: mutation.candidate.accountableMemberId,
        contributorMemberIds: mutation.candidate.contributorMemberIds,
        humanSponsorMemberId: mutation.candidate.humanSponsorMemberId,
        expectedTeamRevision: mutation.expectedTeamRevision,
        expectedResponsibilityRevision: head.current_responsibility_revision,
        updatedAt: mutation.createdAt,
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
      }
      const plan = planProjectResponsibilityReplacement(database, replacement)
      if (!plan.ok) {
        database.exec('ROLLBACK')
        began = false
        return responsibilityErrorForProposal(plan.error)
      }
      const before = responsibilityReviewValue(database, head)
      const proposedDiff = projectResponsibilityReviewDiff(before, mutation.candidate)
      if (proposedDiff.changedFields.length === 0) {
        database.exec('ROLLBACK')
        began = false
        return noOpSuggestedChangeProposal()
      }
      const proposedRisk = suggestedChangeRisk(before, mutation.candidate)
      const evidence = resolveSuggestedChangeEvidence(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.projectId,
        mutation.evidenceRefs.map(reference => reference.auditEventId),
      )
      if (!evidence.ok) {
        database.exec('ROLLBACK')
        began = false
        return evidenceError(evidence.reason)
      }

      insertSuggestedChangeProposal(
        database,
        mutation,
        head.current_responsibility_revision,
        proposedDiff,
        proposedRisk,
      )
      insertSuggestedChangeEvidence(database, mutation.suggestedChangeId, evidence.rows)
      const committed = Object.freeze({
        ok: true,
        value: Object.freeze({
          suggestedChangeId: mutation.suggestedChangeId,
          suggestedChangeRevision: 1 as const,
          targetAdapter: SUGGESTED_CHANGE_TARGET_ADAPTER,
          baseTargetVersion: mutation.expectedTeamRevision,
          persistedState: 'pending' as const,
          riskLevel: proposedRisk.level,
        }),
        receipt: commandReceipt(mutation),
      }) satisfies Extract<ProposeProjectResponsibilityChangeResult, { readonly ok: true }>
      appendSuggestedChangeLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_PROPOSAL_AUDIT_ACTION,
        objectId: mutation.suggestedChangeId,
        objectVersion: 1,
        projectId: mutation.projectId,
        summaryCode: SUGGESTED_CHANGE_PROPOSAL_SUMMARY,
        changedFields: ['proposal', 'risk', 'evidence'],
        outboxTopic: SUGGESTED_CHANGE_PROPOSAL_OUTBOX_TOPIC,
        payload: {
          projectId: mutation.projectId,
          suggestedChangeId: mutation.suggestedChangeId,
          suggestedChangeRevision: 1,
          riskLevel: proposedRisk.level,
        },
        result: committed,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitSuggestedChangeDecision(
    mutation: WorkbenchSuggestedChangeDecisionMutation,
    signal: AbortSignal,
  ): Promise<DecideSuggestedChangeResult> {
    throwIfAborted(signal)
    validateSuggestedChangeDecisionMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = suggestedChangeDecisionRequestHash(mutation)
    const vocabulary = suggestedChangeDecisionVocabulary(mutation.mode)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findReceipt(database, mutation, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== vocabulary.commandType
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return suggestedChangeDecisionIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeSuggestedChangeDecisionResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const head = readProjectTeamHead(database, {
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
        projectId: mutation.projectId,
      })
      if (head === null) {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeDecisionProjectNotFound(mutation.projectId)
      }
      const stored = readSuggestedChange(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.projectId,
        mutation.suggestedChangeId,
      )
      if (stored === null) {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeNotFound(mutation.suggestedChangeId)
      }
      if (stored.revision !== mutation.expectedSuggestedChangeRevision) {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeRevisionConflict(
          mutation.expectedSuggestedChangeRevision,
          stored.revision,
        )
      }
      const effectiveStatus = suggestedChangeEffectiveStatus(stored, head.team_revision)
      if (stored.persisted_state === 'accepted' || stored.persisted_state === 'rejected') {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeStateConflict(effectiveStatus, mutation.mode)
      }
      if (effectiveStatus === 'stale' && mutation.mode !== 'reject') {
        database.exec('ROLLBACK')
        began = false
        return mutation.mode === 'accept' || mutation.mode === 'edit-and-accept'
          ? suggestedChangeStale(stored.base_team_revision, head.team_revision)
          : suggestedChangeStateConflict('stale', mutation.mode)
      }
      if (stored.persisted_state === 'deferred' && mutation.mode === 'defer') {
        database.exec('ROLLBACK')
        began = false
        return suggestedChangeStateConflict('deferred', mutation.mode)
      }

      const proposedDiff = decodeProjectResponsibilityReviewDiff(stored.proposed_diff_json)
      const proposedRiskLevel = suggestedChangeRiskLevel(stored.proposed_risk_level)
      let appliedCandidate: ProjectResponsibilitySuggestedValue | null = null
      let appliedDiff: ProjectResponsibilityReviewDiff | null = null
      let appliedRiskLevel: SuggestedChangeRiskLevel | null = null
      let appliedRiskReasons: readonly SuggestedChangeRiskReason[] = Object.freeze([])
      let appliedTeamRevision: number | null = null
      let appliedResponsibilityRevision: number | null = null
      let effectiveRiskLevel = proposedRiskLevel

      if (mutation.mode === 'accept' || mutation.mode === 'edit-and-accept') {
        const evidenceIds = readSuggestedChangeEvidenceRows(database, stored.id)
          .map(row => row.audit_event_id)
        const evidence = resolveSuggestedChangeEvidence(
          database,
          stored.organization_id,
          stored.team_id,
          stored.project_id,
          evidenceIds,
          suggestedChangeProposalAuditSequence(database, stored),
        )
        if (!evidence.ok) {
          database.exec('ROLLBACK')
          began = false
          return evidence.reason === 'integrity-failed'
            ? suggestedChangeStale(stored.base_team_revision, head.team_revision)
            : suggestedChangeStateConflict(effectiveStatus, mutation.mode)
        }
        appliedCandidate = mutation.mode === 'accept'
          ? decodeProjectResponsibilitySuggestedValue(stored.candidate_json)
          : mutation.candidate
        appliedDiff = projectResponsibilityReviewDiff(proposedDiff.before, appliedCandidate)
        if (appliedDiff.changedFields.length === 0) {
          database.exec('ROLLBACK')
          began = false
          return noOpSuggestedChangeDecision()
        }
        const appliedRisk = suggestedChangeRisk(proposedDiff.before, appliedCandidate)
        appliedRiskLevel = appliedRisk.level
        appliedRiskReasons = appliedRisk.reasons
        effectiveRiskLevel = maxSuggestedChangeRisk(proposedRiskLevel, appliedRisk.level)
        if (mutation.acknowledgedRiskLevel !== effectiveRiskLevel) {
          database.exec('ROLLBACK')
          began = false
          return riskAcknowledgementMismatch(effectiveRiskLevel)
        }
        if (head.team_revision !== stored.base_team_revision
          || head.current_responsibility_revision !== stored.base_responsibility_revision) {
          database.exec('ROLLBACK')
          began = false
          return suggestedChangeStale(stored.base_team_revision, head.team_revision)
        }
        const replacement: ResponsibilityReplacementInput = {
          projectId: stored.project_id,
          accountableMemberId: appliedCandidate.accountableMemberId,
          contributorMemberIds: appliedCandidate.contributorMemberIds,
          humanSponsorMemberId: appliedCandidate.humanSponsorMemberId,
          expectedTeamRevision: stored.base_team_revision,
          expectedResponsibilityRevision: stored.base_responsibility_revision,
          updatedAt: mutation.decidedAt,
          organizationId: stored.organization_id,
          teamId: stored.team_id,
        }
        const plan = planProjectResponsibilityReplacement(database, replacement)
        if (!plan.ok) {
          database.exec('ROLLBACK')
          began = false
          return responsibilityErrorForDecision(plan.error, stored.base_team_revision, head.team_revision)
        }
        const applied = applyProjectResponsibilityPlan(database, replacement, plan)
        appliedTeamRevision = applied.teamRevision
        appliedResponsibilityRevision = applied.responsibilityRevision
      }

      const nextRevision = stored.revision + 1
      if (!Number.isSafeInteger(nextRevision)) {
        throw new Error('Workbench SuggestedChange revision exhausted')
      }
      const persistedState: SuggestedChangePersistedState = mutation.mode === 'accept'
        || mutation.mode === 'edit-and-accept'
        ? 'accepted'
        : mutation.mode === 'reject' ? 'rejected' : 'deferred'
      const decisionMode: SuggestedChangeDecisionMode = mutation.mode === 'accept'
        ? 'accepted'
        : mutation.mode === 'edit-and-accept' ? 'edited-accepted' : persistedState
      const advanced = database.prepare(`
        UPDATE workbench_suggested_change
        SET revision = ?, persisted_state = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND team_id = ? AND project_id = ?
          AND revision = ? AND persisted_state = ?
      `).run(
        nextRevision,
        persistedState,
        mutation.decidedAt,
        stored.id,
        stored.organization_id,
        stored.team_id,
        stored.project_id,
        stored.revision,
        stored.persisted_state,
      )
      if (advanced.changes !== 1) {
        throw new Error('Workbench SuggestedChange head did not advance exactly once')
      }
      const committed = Object.freeze({
        ok: true,
        value: Object.freeze({
          suggestedChangeId: stored.id,
          suggestedChangeRevision: nextRevision,
          persistedState,
          decisionMode,
          riskLevel: effectiveRiskLevel,
          appliedTeamRevision,
          appliedResponsibilityRevision,
        }),
        receipt: commandReceipt(mutation),
      }) satisfies Extract<DecideSuggestedChangeResult, { readonly ok: true }>
      appendSuggestedChangeLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: vocabulary.commandType,
        auditAction: vocabulary.auditAction,
        objectId: stored.id,
        objectVersion: nextRevision,
        projectId: stored.project_id,
        summaryCode: vocabulary.summaryCode,
        changedFields: mutation.mode === 'accept' || mutation.mode === 'edit-and-accept'
          ? ['decision', 'target']
          : ['decision'],
        outboxTopic: SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC,
        payload: {
          projectId: stored.project_id,
          suggestedChangeId: stored.id,
          suggestedChangeRevision: nextRevision,
          persistedState,
          decisionMode,
          riskLevel: effectiveRiskLevel,
          ...(appliedTeamRevision === null ? {} : { appliedTeamRevision }),
          ...(appliedResponsibilityRevision === null ? {} : { appliedResponsibilityRevision }),
        },
        result: committed,
      })
      insertSuggestedChangeDecision(database, {
        mutation,
        suggestedChangeRevision: nextRevision,
        decisionMode,
        appliedCandidate,
        appliedDiff,
        appliedRiskLevel,
        appliedRiskReasons,
        appliedTeamRevision,
        appliedResponsibilityRevision,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async readActivity(
    query: WorkbenchActivityQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchActivityProjection> {
    throwIfAborted(signal)
    validateReference(query.organizationId, 'Activity organization id')
    const limit = query.filter.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT) {
      throw new TypeError(`Activity limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}`)
    }
    const where = ['audit.organization_id = ?']
    const parameters: Array<string | number> = [query.organizationId]
    if (query.filter.projectId === null) {
      where.push('audit.project_id IS NULL')
    } else if (query.filter.projectId !== undefined) {
      validateReference(query.filter.projectId, 'Activity project id')
      where.push('audit.project_id = ?')
      parameters.push(query.filter.projectId)
    }
    if (query.filter.objectType !== undefined) {
      where.push('audit.object_type = ?')
      parameters.push(query.filter.objectType)
    }
    if (query.filter.objectId !== undefined) {
      validateReference(query.filter.objectId, 'Activity object id')
      where.push('audit.object_id = ?')
      parameters.push(query.filter.objectId)
    }
    if (query.filter.action !== undefined) {
      where.push('audit.action = ?')
      parameters.push(query.filter.action)
    }
    if (query.filter.beforeSequence !== undefined) {
      if (!Number.isSafeInteger(query.filter.beforeSequence) || query.filter.beforeSequence < 1) {
        throw new TypeError('Activity beforeSequence must be a positive safe integer')
      }
      where.push('audit.sequence < ?')
      parameters.push(query.filter.beforeSequence)
    }
    parameters.push(limit + 1)
    const database = this.requireDatabase()
    let began = false
    try {
      // Bind filtered rows and ledger verification to one SQLite snapshot.
      database.exec('BEGIN')
      began = true
      const rows = database.prepare(`
        SELECT audit.sequence, audit.id AS event_id, audit.occurred_at,
          audit.actor_kind, audit.actor_id, audit.project_id, audit.action,
          audit.reason_code, audit.object_type, audit.object_id, audit.object_version,
          audit.causation_id, audit.command_id, audit.command_type, audit.summary_code,
          audit.previous_hash, audit.event_hash, outbox.id AS outbox_id,
          outbox.state AS outbox_state, outbox.attempt_count,
          outbox.updated_at AS outbox_updated_at, outbox.error_code
        FROM workbench_audit_event AS audit
        INNER JOIN workbench_outbox AS outbox ON outbox.id = audit.outbox_id
        WHERE ${where.join(' AND ')}
        ORDER BY audit.sequence DESC
        LIMIT ?
      `).all(...parameters) as unknown as ActivityRow[]
      const integrity = verifyAuditChainSync(database)
      throwIfAborted(signal)
      const hasMore = rows.length > limit
      const visible = hasMore ? rows.slice(0, limit) : rows
      const items = Object.freeze(visible.map(activityItem))
      const projection = Object.freeze({
        items,
        nextBeforeSequence: hasMore ? items.at(-1)?.sequence ?? null : null,
        integrity,
      })
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async verifyAuditChain(signal: AbortSignal): Promise<WorkbenchAuditIntegrityProjection> {
    throwIfAborted(signal)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN')
      began = true
      const result = verifyAuditChainSync(database)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return result
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async claimOutbox(
    request: WorkbenchOutboxClaimRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchOutboxClaim | null> {
    throwIfAborted(signal)
    validateReference(request.claimToken, 'Outbox claim token')
    validateInstant(request.claimedAt, 'Outbox claimedAt')
    validateInstant(request.leaseExpiresAt, 'Outbox leaseExpiresAt')
    const observedAt = laterInstant(this.observedAt(), request.claimedAt)
    if (request.leaseExpiresAt <= observedAt) {
      throw new TypeError('Outbox leaseExpiresAt must be later than claimedAt')
    }
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      expireOutboxClaims(database, observedAt)
      const row = database.prepare(`
        SELECT id, topic, effect_key, payload_json, causation_id, attempt_count
        FROM workbench_outbox
        WHERE state = 'pending' AND claim_token IS NULL
        ORDER BY created_at, id
        LIMIT 1
      `).get() as OutboxClaimRow | undefined
      if (row === undefined) {
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return null
      }
      const claimed = database.prepare(`
        UPDATE workbench_outbox
        SET claim_token = ?, claimed_at = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, updated_at = ?, error_code = NULL
        WHERE id = ? AND state = 'pending' AND claim_token IS NULL
      `).run(
        request.claimToken, observedAt, request.leaseExpiresAt,
        observedAt, row.id,
      )
      if (claimed.changes !== 1) throw new Error('Workbench Outbox claim lost its write race')
      const projection = Object.freeze({
        id: stringValue(row.id, 'Outbox id'),
        topic: stringValue(row.topic, 'Outbox topic'),
        effectKey: stringValue(row.effect_key, 'Outbox effect key'),
        payload: stringValue(row.payload_json, 'Outbox payload'),
        causationId: stringValue(row.causation_id, 'Outbox causation id'),
        claimToken: request.claimToken,
        leaseExpiresAt: request.leaseExpiresAt,
        attemptCount: positiveInteger(row.attempt_count, 'Outbox attempt count', true) + 1,
      })
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return projection
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async settleOutbox(
    settlement: WorkbenchOutboxSettlement,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    validateReference(settlement.outboxId, 'Outbox id')
    validateReference(settlement.claimToken, 'Outbox claim token')
    validateInstant(settlement.settledAt, 'Outbox settledAt')
    const observedAt = laterInstant(this.observedAt(), settlement.settledAt)
    if (settlement.state !== 'delivered'
      && settlement.state !== 'unknown'
      && settlement.state !== 'failed') {
      throw new TypeError('Outbox settlement state is unsupported')
    }
    if (settlement.state === 'delivered') {
      if (settlement.errorCode !== null) {
        throw new TypeError('Delivered Outbox settlement cannot contain an error code')
      }
    } else if (!isOutboxErrorCode(settlement.errorCode)
      || (settlement.state === 'unknown'
        && settlement.errorCode !== 'transport-ambiguous')
      || (settlement.state === 'failed'
        && settlement.errorCode !== 'definitive-rejection')) {
      throw new TypeError('Outbox settlement requires its allowlisted state error code')
    }
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      expireOutboxClaims(database, observedAt)
      const result = database.prepare(`
        UPDATE workbench_outbox
        SET state = ?, claim_token = NULL, lease_expires_at = NULL,
            updated_at = ?, error_code = ?
        WHERE id = ? AND state = 'pending' AND claim_token = ?
          AND claimed_at <= ? AND lease_expires_at > ?
      `).run(
        settlement.state, observedAt, settlement.errorCode,
        settlement.outboxId, settlement.claimToken,
        settlement.settledAt, observedAt,
      )
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return result.changes === 1
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.doClose()
    return this.closePromise
  }

  private async openDatabase(): Promise<void> {
    const actual = this.options.databasePath === ':memory:'
      ? ':memory:'
      : resolve(this.options.databasePath)
    if (actual !== ':memory:') {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await createDatabaseFile(actual)
    }
    if (this.closePromise !== undefined) return
    const database = new DatabaseSync(actual, { timeout: this.options.busyTimeoutMs })
    try {
      configureConnection(database, actual, this.options)
      migrate(database, actual)
      prepareLedger(database, this.observedAt())
      if (this.closePromise !== undefined) {
        database.close()
        return
      }
      this.database = database
    } catch (error: unknown) {
      database.close()
      throw error
    }
  }

  private async doClose(): Promise<void> {
    await this.opening?.catch(() => undefined)
    const database = this.database
    this.database = undefined
    database?.close()
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('workbench repository is not open')
    return this.database
  }

  /** A failed rollback makes the connection unusable; close it instead of accepting more work. */
  private rollbackAfterFailure(database: DatabaseSync, operationError: unknown): void {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      if (this.database === database) this.database = undefined
      this.closePromise ??= Promise.resolve()
      const failures = [operationError, rollbackError]
      try {
        database.close()
      } catch (closeError: unknown) {
        failures.push(closeError)
      }
      throw new AggregateError(
        failures,
        'Workbench transaction rollback failed; repository was closed',
      )
    }
  }

  private observedAt(): string {
    const value = (this.options.now ?? (() => new Date()))()
    if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
      throw new Error('Workbench repository clock returned an invalid instant')
    }
    return value.toISOString()
  }
}

/** Sweep startup leases and validate all related ledger rows under one writer snapshot. */
function prepareLedger(database: DatabaseSync, observedAt: string): void {
  let began = false
  try {
    database.exec('BEGIN IMMEDIATE')
    began = true
    expireOutboxClaims(database, observedAt)
    assertValidLedger(database)
    database.exec('COMMIT')
    began = false
  } catch (error: unknown) {
    if (began) rollback(database, error)
    throw error
  }
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await openFile(path, 'wx', 0o600)
    await handle.close()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function validateOptions(options: SqliteWorkbenchRepositoryOptions): void {
  if (typeof options.databasePath !== 'string'
    || options.databasePath.includes('\0')
    || options.databasePath.trim().length === 0) {
    throw new TypeError('databasePath must be a non-blank filesystem path or :memory:')
  }
  if (!JOURNAL_MODES.has(options.journalMode)) {
    throw new TypeError(`unsupported Workbench journal mode: ${String(options.journalMode)}`)
  }
  if (!Number.isSafeInteger(options.busyTimeoutMs)
    || options.busyTimeoutMs < 0
    || options.busyTimeoutMs > MAX_BUSY_TIMEOUT_MS) {
    throw new TypeError(`busyTimeoutMs must be an integer from 0 to ${MAX_BUSY_TIMEOUT_MS}`)
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('now must be a clock function')
  }
}

function configureConnection(
  database: DatabaseSync,
  path: string,
  options: SqliteWorkbenchRepositoryOptions,
): void {
  database.exec('PRAGMA trusted_schema = OFF')
  database.exec('PRAGMA mmap_size = 0')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA recursive_triggers = ON')
  database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs}`)
  const selected = stringField(
    database.prepare(`PRAGMA journal_mode = ${options.journalMode.toUpperCase()}`).get(),
    'journal_mode',
  ).toLowerCase()
  const expected = path === ':memory:' ? 'memory' : options.journalMode
  if (selected !== expected) {
    throw new Error(`Workbench database selected journal mode ${selected}, expected ${expected}`)
  }
  database.exec('PRAGMA synchronous = FULL')
  if (integerField(database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys') !== 1) {
    throw new Error('Workbench database could not enable foreign keys')
  }
  if (integerField(database.prepare('PRAGMA recursive_triggers').get(), 'recursive_triggers') !== 1) {
    throw new Error('Workbench database could not enable recursive triggers')
  }
  if (integerField(database.prepare('PRAGMA busy_timeout').get(), 'timeout')
    !== options.busyTimeoutMs) {
    throw new Error('Workbench database could not retain its busy timeout')
  }
}

function migrate(database: DatabaseSync, path: string): void {
  let began = false
  try {
    database.exec('BEGIN IMMEDIATE')
    began = true
    let version = integerField(database.prepare('PRAGMA user_version').get(), 'user_version')
    const applicationId = integerField(database.prepare('PRAGMA application_id').get(), 'application_id')
    const userObjectCount = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
    `).get(), 'count')
    if (version === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`Workbench database at "${path}" has an unversioned foreign schema`)
    }
    if (version > WORKBENCH_SCHEMA_VERSION) {
      throw new Error(
        `Workbench database at "${path}" has schema version ${version}, newer than ${WORKBENCH_SCHEMA_VERSION}`,
      )
    }
    if (version > 0 && applicationId !== WORKBENCH_SQLITE_APPLICATION_ID) {
      throw new Error(
        `Workbench database at "${path}" has application id ${applicationId}, expected ${WORKBENCH_SQLITE_APPLICATION_ID}`,
      )
    }
    while (version < WORKBENCH_SCHEMA_VERSION) {
      const nextVersion = version + 1
      applyMigration(database, nextVersion)
      database.exec(`PRAGMA user_version = ${nextVersion}`)
      version = nextVersion
    }
    database.exec(`PRAGMA application_id = ${WORKBENCH_SQLITE_APPLICATION_ID}`)
    validateSchema(database)
    database.exec('COMMIT')
    began = false
  } catch (error: unknown) {
    if (began) rollback(database, error)
    throw error
  }
}

function applyMigration(database: DatabaseSync, targetVersion: number): void {
  if (targetVersion === 1) {
    database.exec(`
      CREATE TABLE workbench_status (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL CHECK (length(id) > 0),
        message TEXT NOT NULL CHECK (length(message) > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT
    `)
    return
  }
  if (targetVersion === 2) {
    database.exec(`
    CREATE TABLE workbench_audit_head (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      head_hash TEXT NOT NULL CHECK (length(head_hash) = 71)
    ) STRICT;
    INSERT INTO workbench_audit_head VALUES (1, 0, '${AUDIT_GENESIS_HASH}');

    CREATE TABLE workbench_outbox (
      id TEXT PRIMARY KEY CHECK (length(id) > 0),
      command_id TEXT NOT NULL UNIQUE CHECK (length(command_id) > 0),
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      topic TEXT NOT NULL CHECK (length(topic) > 0),
      effect_key TEXT NOT NULL UNIQUE CHECK (length(effect_key) > 0),
      project_id TEXT,
      object_type TEXT NOT NULL CHECK (length(object_type) > 0),
      object_id TEXT NOT NULL CHECK (length(object_id) > 0),
      object_version INTEGER NOT NULL CHECK (object_version > 0),
      causation_id TEXT NOT NULL CHECK (length(causation_id) > 0),
      payload_json TEXT NOT NULL CHECK (length(payload_json) > 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'unknown', 'failed')),
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
      claim_token TEXT,
      claimed_at TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      error_code TEXT,
      CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL)),
      CHECK (claim_token IS NULL OR state = 'pending'),
      CHECK (
        (state IN ('pending', 'delivered') AND error_code IS NULL)
        OR (state = 'unknown' AND error_code IS NOT NULL
          AND error_code IN ('lease-expired', 'transport-ambiguous'))
        OR (state = 'failed' AND error_code IS NOT NULL
          AND error_code = 'definitive-rejection')
      )
    ) STRICT;

    CREATE TABLE workbench_audit_event (
      sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
      id TEXT NOT NULL UNIQUE CHECK (length(id) > 0),
      occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('anonymous', 'owner', 'system')),
      actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      team_id TEXT NOT NULL CHECK (length(team_id) > 0),
      project_id TEXT,
      action TEXT NOT NULL CHECK (length(action) > 0),
      reason_code TEXT NOT NULL CHECK (length(reason_code) > 0),
      reason_detail TEXT,
      object_type TEXT NOT NULL CHECK (length(object_type) > 0),
      object_id TEXT NOT NULL CHECK (length(object_id) > 0),
      object_version INTEGER NOT NULL CHECK (object_version > 0),
      command_id TEXT NOT NULL UNIQUE CHECK (length(command_id) > 0),
      command_type TEXT NOT NULL CHECK (length(command_type) > 0),
      causation_id TEXT NOT NULL CHECK (length(causation_id) > 0),
      outbox_id TEXT UNIQUE REFERENCES workbench_outbox(id),
      outbox_state TEXT CHECK (outbox_state IN ('pending', 'delivered', 'unknown', 'failed')),
      outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'failed', 'rejected')),
      summary_code TEXT NOT NULL CHECK (length(summary_code) > 0),
      summary_fields_json TEXT NOT NULL CHECK (length(summary_fields_json) > 0),
      previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 71),
      event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 71),
      canonical_envelope TEXT NOT NULL CHECK (length(canonical_envelope) > 0),
      CHECK ((outbox_id IS NULL) = (outbox_state IS NULL))
    ) STRICT;

    CREATE TABLE workbench_command_receipt (
      organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
      actor_id TEXT NOT NULL CHECK (length(actor_id) > 0),
      idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
      command_type TEXT NOT NULL CHECK (length(command_type) > 0),
      request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
      command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event(command_id),
      audit_event_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event(id),
      outbox_id TEXT NOT NULL UNIQUE REFERENCES workbench_outbox(id),
      result_json TEXT NOT NULL CHECK (length(result_json) > 0),
      committed_at TEXT NOT NULL CHECK (length(committed_at) > 0),
      PRIMARY KEY (organization_id, actor_id, idempotency_key_hash)
    ) STRICT;

    CREATE INDEX workbench_audit_project_sequence
      ON workbench_audit_event (organization_id, project_id, sequence DESC);
    CREATE INDEX workbench_audit_object_sequence
      ON workbench_audit_event (organization_id, object_type, object_id, sequence DESC);
    CREATE INDEX workbench_audit_action_sequence
      ON workbench_audit_event (organization_id, action, sequence DESC);
    CREATE INDEX workbench_outbox_state_created
      ON workbench_outbox (state, created_at, id);

    CREATE TRIGGER workbench_audit_event_no_update BEFORE UPDATE ON workbench_audit_event
    BEGIN SELECT RAISE(ABORT, 'workbench audit events are append-only'); END;
    CREATE TRIGGER workbench_audit_event_no_delete BEFORE DELETE ON workbench_audit_event
    BEGIN SELECT RAISE(ABORT, 'workbench audit events are append-only'); END;

    CREATE TRIGGER workbench_outbox_intent_no_update BEFORE UPDATE OF
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json, created_at
      ON workbench_outbox
    BEGIN SELECT RAISE(ABORT, 'workbench Outbox intent is immutable'); END;
    CREATE TRIGGER workbench_outbox_no_delete BEFORE DELETE ON workbench_outbox
    BEGIN SELECT RAISE(ABORT, 'workbench Outbox rows cannot be deleted'); END;

    CREATE TRIGGER workbench_command_receipt_no_update
      BEFORE UPDATE ON workbench_command_receipt
    BEGIN SELECT RAISE(ABORT, 'workbench command receipts are immutable'); END;
    CREATE TRIGGER workbench_command_receipt_no_delete
      BEFORE DELETE ON workbench_command_receipt
    BEGIN SELECT RAISE(ABORT, 'workbench command receipts cannot be deleted'); END
    `)
    return
  }
  if (targetVersion === 3) {
    database.exec(`
    CREATE TABLE workbench_template_version (
      template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 128),
      template_version INTEGER NOT NULL CHECK (template_version > 0),
      snapshot_schema_version INTEGER NOT NULL CHECK (snapshot_schema_version > 0),
      kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 128),
      canonical_definition_json TEXT NOT NULL CHECK (length(canonical_definition_json) > 0),
      definition_digest TEXT NOT NULL
        CHECK (length(definition_digest) = 71 AND substr(definition_digest, 1, 7) = 'sha256:'),
      PRIMARY KEY (template_id, template_version),
      UNIQUE (template_id, template_version, definition_digest)
    ) STRICT;

    CREATE TABLE workbench_project_catalog (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;
    INSERT INTO workbench_project_catalog VALUES (1, 0);

    CREATE TABLE workbench_goal (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND ${MAX_DOMAIN_NAME_LENGTH}),
      revision INTEGER NOT NULL CHECK (revision > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'inactive')),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      UNIQUE (organization_id, team_id, id)
    ) STRICT;

    CREATE TABLE workbench_outcome (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      goal_id TEXT NOT NULL CHECK (length(goal_id) BETWEEN 1 AND 128),
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND ${MAX_PROJECT_OUTCOMES}),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND ${MAX_DOMAIN_NAME_LENGTH}),
      metric_name TEXT NOT NULL CHECK (length(metric_name) BETWEEN 1 AND ${MAX_METRIC_NAME_LENGTH}),
      initial_value REAL NOT NULL CHECK (abs(initial_value) <= 1.7976931348623157e308),
      target_value REAL NOT NULL CHECK (abs(target_value) <= 1.7976931348623157e308),
      unit TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND ${MAX_METRIC_UNIT_LENGTH}),
      direction TEXT NOT NULL CHECK (direction IN ('increase', 'decrease')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      UNIQUE (goal_id, ordinal),
      FOREIGN KEY (organization_id, team_id, goal_id)
        REFERENCES workbench_goal (organization_id, team_id, id),
      CHECK (
        (direction = 'increase' AND target_value > initial_value)
        OR (direction = 'decrease' AND target_value < initial_value)
      )
    ) STRICT;

    CREATE TABLE workbench_project (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND ${MAX_DOMAIN_NAME_LENGTH}),
      revision INTEGER NOT NULL CHECK (revision > 0),
      catalog_sequence INTEGER NOT NULL UNIQUE CHECK (catalog_sequence > 0),
      primary_goal_id TEXT NOT NULL CHECK (length(primary_goal_id) BETWEEN 1 AND 128),
      timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 128),
      template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 128),
      template_version INTEGER NOT NULL CHECK (template_version > 0),
      template_definition_digest TEXT NOT NULL
        CHECK (length(template_definition_digest) = 71
          AND substr(template_definition_digest, 1, 7) = 'sha256:'),
      creation_snapshot_schema_version INTEGER NOT NULL
        CHECK (creation_snapshot_schema_version > 0),
      creation_snapshot_digest TEXT NOT NULL
        CHECK (length(creation_snapshot_digest) = 71
          AND substr(creation_snapshot_digest, 1, 7) = 'sha256:'),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      UNIQUE (id, organization_id, team_id),
      UNIQUE (id, organization_id, team_id, primary_goal_id),
      UNIQUE (
        id, template_id, template_version, template_definition_digest,
        creation_snapshot_schema_version, creation_snapshot_digest
      ),
      FOREIGN KEY (organization_id, team_id, primary_goal_id)
        REFERENCES workbench_goal (organization_id, team_id, id),
      FOREIGN KEY (template_id, template_version, template_definition_digest)
        REFERENCES workbench_template_version (template_id, template_version, definition_digest)
    ) STRICT;

    CREATE TABLE workbench_project_template_snapshot (
      project_id TEXT PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 128),
      template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 128),
      template_version INTEGER NOT NULL CHECK (template_version > 0),
      template_definition_digest TEXT NOT NULL
        CHECK (length(template_definition_digest) = 71
          AND substr(template_definition_digest, 1, 7) = 'sha256:'),
      snapshot_schema_version INTEGER NOT NULL CHECK (snapshot_schema_version > 0),
      snapshot_digest TEXT NOT NULL
        CHECK (length(snapshot_digest) = 71 AND substr(snapshot_digest, 1, 7) = 'sha256:'),
      canonical_snapshot_json TEXT NOT NULL CHECK (length(canonical_snapshot_json) > 0),
      captured_at TEXT NOT NULL CHECK (length(captured_at) > 0),
      FOREIGN KEY (
        project_id, template_id, template_version, template_definition_digest,
        snapshot_schema_version, snapshot_digest
      ) REFERENCES workbench_project (
        id, template_id, template_version, template_definition_digest,
        creation_snapshot_schema_version, creation_snapshot_digest
      )
    ) STRICT;

    CREATE TABLE workbench_project_supporting_goal (
      project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      primary_goal_id TEXT NOT NULL CHECK (length(primary_goal_id) BETWEEN 1 AND 128),
      goal_id TEXT NOT NULL CHECK (length(goal_id) BETWEEN 1 AND 128),
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND ${MAX_SUPPORTING_GOALS}),
      linked_goal_revision INTEGER NOT NULL CHECK (linked_goal_revision > 0),
      PRIMARY KEY (project_id, goal_id),
      UNIQUE (project_id, ordinal),
      FOREIGN KEY (project_id, organization_id, team_id, primary_goal_id)
        REFERENCES workbench_project (id, organization_id, team_id, primary_goal_id),
      FOREIGN KEY (organization_id, team_id, goal_id)
        REFERENCES workbench_goal (organization_id, team_id, id),
      CHECK (goal_id <> primary_goal_id)
    ) STRICT;

    CREATE INDEX workbench_project_scope_sequence
      ON workbench_project (organization_id, team_id, catalog_sequence DESC);
    CREATE INDEX workbench_outcome_goal_ordinal
      ON workbench_outcome (goal_id, ordinal);
    CREATE INDEX workbench_supporting_goal_project_ordinal
      ON workbench_project_supporting_goal (project_id, ordinal);

    CREATE TRIGGER workbench_template_version_no_update
      BEFORE UPDATE ON workbench_template_version
    BEGIN SELECT RAISE(ABORT, 'workbench Template Versions are immutable'); END;
    CREATE TRIGGER workbench_template_version_no_delete
      BEFORE DELETE ON workbench_template_version
    BEGIN SELECT RAISE(ABORT, 'workbench Template Versions cannot be deleted'); END;

    CREATE TRIGGER workbench_project_template_snapshot_no_update
      BEFORE UPDATE ON workbench_project_template_snapshot
    BEGIN SELECT RAISE(ABORT, 'workbench Project creation snapshots are immutable'); END;
    CREATE TRIGGER workbench_project_template_snapshot_no_delete
      BEFORE DELETE ON workbench_project_template_snapshot
    BEGIN SELECT RAISE(ABORT, 'workbench Project creation snapshots cannot be deleted'); END;

    CREATE TRIGGER workbench_project_snapshot_columns_no_update BEFORE UPDATE OF
      template_id, template_version, template_definition_digest,
      creation_snapshot_schema_version, creation_snapshot_digest
      ON workbench_project
    BEGIN SELECT RAISE(ABORT, 'workbench Project creation snapshot identity is immutable'); END
  `)
    const seeded = database.prepare(`
      INSERT INTO workbench_template_version (
        template_id, template_version, snapshot_schema_version, kind,
        canonical_definition_json, definition_digest
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateId,
      KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateVersion,
      1,
      'knowledge-work',
      KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
      KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    )
    if (seeded.changes !== 1) {
      throw new Error('Workbench Knowledge Work Template V1 was not seeded exactly once')
    }
    return
  }
  if (targetVersion === 4) {
    database.exec(`
    CREATE TABLE workbench_project_team_head (
      project_id TEXT PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      team_revision INTEGER NOT NULL CHECK (team_revision >= 0),
      current_responsibility_revision INTEGER
        CHECK (current_responsibility_revision IS NULL OR current_responsibility_revision > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      UNIQUE (project_id, organization_id, team_id),
      FOREIGN KEY (project_id, organization_id, team_id)
        REFERENCES workbench_project (id, organization_id, team_id)
    ) STRICT;

    CREATE TABLE workbench_project_member (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
      display_name TEXT NOT NULL
        CHECK (length(display_name) BETWEEN 1 AND ${MAX_MEMBER_DISPLAY_NAME_LENGTH}),
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      identity_type TEXT NOT NULL CHECK (identity_type IN ('feishu', 'external', 'workbench-agent')),
      feishu_app_id TEXT CHECK (
        feishu_app_id IS NULL
        OR length(feishu_app_id) BETWEEN 1 AND ${MAX_FEISHU_APP_ID_LENGTH}
      ),
      feishu_open_id TEXT CHECK (
        feishu_open_id IS NULL
        OR length(feishu_open_id) BETWEEN 1 AND ${MAX_FEISHU_OPEN_ID_LENGTH}
      ),
      external_method TEXT CHECK (external_method IS NULL OR external_method IN ('email', 'phone', 'other')),
      external_value TEXT CHECK (
        external_value IS NULL
        OR length(external_value) BETWEEN 1 AND ${MAX_EXTERNAL_CONTACT_LENGTH}
      ),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      UNIQUE (project_id, organization_id, team_id, id),
      FOREIGN KEY (project_id, organization_id, team_id)
        REFERENCES workbench_project_team_head (project_id, organization_id, team_id),
      CHECK (
        (kind = 'human' AND identity_type = 'feishu'
          AND feishu_app_id IS NOT NULL AND feishu_open_id IS NOT NULL
          AND external_method IS NULL AND external_value IS NULL)
        OR (kind = 'human' AND identity_type = 'external'
          AND feishu_app_id IS NULL AND feishu_open_id IS NULL
          AND external_method IS NOT NULL AND external_value IS NOT NULL)
        OR (kind = 'agent' AND identity_type = 'workbench-agent'
          AND feishu_app_id IS NULL AND feishu_open_id IS NULL
          AND external_method IS NULL AND external_value IS NULL)
      )
    ) STRICT;

    CREATE UNIQUE INDEX workbench_project_member_feishu_identity
      ON workbench_project_member (project_id, feishu_app_id, feishu_open_id)
      WHERE identity_type = 'feishu';
    CREATE INDEX workbench_project_member_project_created
      ON workbench_project_member (project_id, created_at, id);

    CREATE TABLE workbench_project_responsibility_version (
      project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      revision INTEGER NOT NULL CHECK (revision > 0),
      accountable_member_id TEXT NOT NULL CHECK (length(accountable_member_id) BETWEEN 1 AND 128),
      human_sponsor_member_id TEXT CHECK (
        human_sponsor_member_id IS NULL OR length(human_sponsor_member_id) BETWEEN 1 AND 128
      ),
      contributor_count INTEGER NOT NULL
        CHECK (contributor_count BETWEEN 0 AND ${MAX_RESPONSIBILITY_CONTRIBUTORS}),
      updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
      PRIMARY KEY (project_id, revision),
      UNIQUE (project_id, organization_id, team_id, revision),
      FOREIGN KEY (project_id, organization_id, team_id)
        REFERENCES workbench_project_team_head (project_id, organization_id, team_id),
      FOREIGN KEY (project_id, organization_id, team_id, accountable_member_id)
        REFERENCES workbench_project_member (project_id, organization_id, team_id, id),
      FOREIGN KEY (project_id, organization_id, team_id, human_sponsor_member_id)
        REFERENCES workbench_project_member (project_id, organization_id, team_id, id),
      CHECK (human_sponsor_member_id IS NULL OR human_sponsor_member_id <> accountable_member_id)
    ) STRICT;

    CREATE TABLE workbench_project_responsibility_contributor (
      project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
      organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
      team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
      responsibility_revision INTEGER NOT NULL CHECK (responsibility_revision > 0),
      member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND ${MAX_RESPONSIBILITY_CONTRIBUTORS}),
      PRIMARY KEY (project_id, responsibility_revision, member_id),
      UNIQUE (project_id, responsibility_revision, ordinal),
      FOREIGN KEY (project_id, organization_id, team_id, responsibility_revision)
        REFERENCES workbench_project_responsibility_version (
          project_id, organization_id, team_id, revision
        ),
      FOREIGN KEY (project_id, organization_id, team_id, member_id)
        REFERENCES workbench_project_member (project_id, organization_id, team_id, id)
    ) STRICT;

    INSERT INTO workbench_project_team_head (
      project_id, organization_id, team_id, team_revision,
      current_responsibility_revision, updated_at
    )
    SELECT id, organization_id, team_id, 0, NULL, created_at
    FROM workbench_project;

    CREATE TRIGGER workbench_project_team_scope_no_update BEFORE UPDATE OF
      project_id, organization_id, team_id ON workbench_project_team_head
    BEGIN SELECT RAISE(ABORT, 'workbench Project Team scope is immutable'); END;
    CREATE TRIGGER workbench_project_team_no_delete BEFORE DELETE ON workbench_project_team_head
    BEGIN SELECT RAISE(ABORT, 'workbench Project Team heads cannot be deleted'); END;

    CREATE TRIGGER workbench_project_member_identity_no_update BEFORE UPDATE OF
      id, organization_id, team_id, project_id, kind, display_name, identity_type,
      feishu_app_id, feishu_open_id, external_method, external_value, created_at
      ON workbench_project_member
    BEGIN SELECT RAISE(ABORT, 'workbench ProjectMember identity is immutable'); END;
    CREATE TRIGGER workbench_project_member_no_delete BEFORE DELETE ON workbench_project_member
    BEGIN SELECT RAISE(ABORT, 'workbench ProjectMembers cannot be deleted'); END;

    CREATE TRIGGER workbench_project_responsibility_no_update
      BEFORE UPDATE ON workbench_project_responsibility_version
    BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility versions are append-only'); END;
    CREATE TRIGGER workbench_project_responsibility_no_delete
      BEFORE DELETE ON workbench_project_responsibility_version
    BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility versions cannot be deleted'); END;
    CREATE TRIGGER workbench_project_responsibility_contributor_no_update
      BEFORE UPDATE ON workbench_project_responsibility_contributor
    BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility contributors are append-only'); END;
    CREATE TRIGGER workbench_project_responsibility_contributor_no_delete
      BEFORE DELETE ON workbench_project_responsibility_contributor
    BEGIN SELECT RAISE(ABORT, 'workbench Project Responsibility contributors cannot be deleted'); END
    `)
    return
  }
  if (targetVersion === 5) {
    database.exec(`
      CREATE TABLE workbench_suggested_change (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
        id TEXT NOT NULL UNIQUE CHECK (length(id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        source_actor_id TEXT NOT NULL CHECK (length(source_actor_id) BETWEEN 1 AND 128),
        target_adapter TEXT NOT NULL CHECK (target_adapter = '${SUGGESTED_CHANGE_TARGET_ADAPTER}'),
        representation_schema_version INTEGER NOT NULL
          CHECK (representation_schema_version = ${SUGGESTED_CHANGE_REPRESENTATION_VERSION}),
        base_team_revision INTEGER NOT NULL CHECK (base_team_revision >= 0),
        base_responsibility_revision INTEGER
          CHECK (base_responsibility_revision IS NULL OR base_responsibility_revision > 0),
        candidate_json TEXT NOT NULL CHECK (length(candidate_json) > 0),
        proposed_diff_json TEXT NOT NULL CHECK (length(proposed_diff_json) > 0),
        proposed_diff_digest TEXT NOT NULL CHECK (
          length(proposed_diff_digest) = 71
          AND substr(proposed_diff_digest, 1, 7) = 'sha256:'
        ),
        proposed_risk_level TEXT NOT NULL CHECK (proposed_risk_level IN ('low', 'high')),
        proposed_risk_reasons_json TEXT NOT NULL CHECK (length(proposed_risk_reasons_json) > 0),
        policy_version TEXT NOT NULL CHECK (policy_version = '${SUGGESTED_CHANGE_POLICY_VERSION}'),
        origin_causation_id TEXT NOT NULL CHECK (length(origin_causation_id) BETWEEN 1 AND 128),
        proposal_command_id TEXT NOT NULL UNIQUE CHECK (length(proposal_command_id) BETWEEN 1 AND 128),
        revision INTEGER NOT NULL CHECK (revision > 0),
        persisted_state TEXT NOT NULL
          CHECK (persisted_state IN ('pending', 'accepted', 'rejected', 'deferred')),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        UNIQUE (id, organization_id, team_id, project_id),
        FOREIGN KEY (project_id, organization_id, team_id)
          REFERENCES workbench_project_team_head (project_id, organization_id, team_id),
        FOREIGN KEY (proposal_command_id) REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE TABLE workbench_suggested_change_evidence (
        suggested_change_id TEXT NOT NULL
          REFERENCES workbench_suggested_change (id),
        ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND ${MAX_SUGGESTED_CHANGE_EVIDENCE}),
        audit_event_id TEXT NOT NULL REFERENCES workbench_audit_event (id),
        PRIMARY KEY (suggested_change_id, ordinal),
        UNIQUE (suggested_change_id, audit_event_id)
      ) STRICT;

      CREATE TABLE workbench_suggested_change_decision (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
        suggested_change_id TEXT NOT NULL REFERENCES workbench_suggested_change (id),
        suggested_change_revision INTEGER NOT NULL CHECK (suggested_change_revision > 1),
        mode TEXT NOT NULL CHECK (mode IN ('accepted', 'edited-accepted', 'rejected', 'deferred')),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
        feedback TEXT NOT NULL
          CHECK (length(feedback) BETWEEN 1 AND ${MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH}),
        applied_candidate_json TEXT,
        applied_diff_json TEXT,
        applied_risk_level TEXT CHECK (applied_risk_level IS NULL OR applied_risk_level IN ('low', 'high')),
        applied_risk_reasons_json TEXT NOT NULL CHECK (length(applied_risk_reasons_json) > 0),
        applied_team_revision INTEGER CHECK (applied_team_revision IS NULL OR applied_team_revision > 0),
        applied_responsibility_revision INTEGER
          CHECK (applied_responsibility_revision IS NULL OR applied_responsibility_revision > 0),
        causation_id TEXT NOT NULL CHECK (length(causation_id) BETWEEN 1 AND 128),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id),
        audit_event_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (id),
        outbox_id TEXT NOT NULL UNIQUE REFERENCES workbench_outbox (id),
        decided_at TEXT NOT NULL CHECK (length(decided_at) > 0),
        UNIQUE (suggested_change_id, suggested_change_revision),
        CHECK (
          (mode IN ('accepted', 'edited-accepted')
            AND applied_candidate_json IS NOT NULL AND applied_diff_json IS NOT NULL
            AND applied_risk_level IS NOT NULL AND applied_team_revision IS NOT NULL
            AND applied_responsibility_revision IS NOT NULL)
          OR (mode IN ('rejected', 'deferred')
            AND applied_candidate_json IS NULL AND applied_diff_json IS NULL
            AND applied_risk_level IS NULL AND applied_team_revision IS NULL
            AND applied_responsibility_revision IS NULL)
        )
      ) STRICT;

      CREATE INDEX workbench_suggested_change_scope_sequence
        ON workbench_suggested_change (organization_id, team_id, project_id, sequence DESC);
      CREATE INDEX workbench_suggested_change_state_risk_sequence
        ON workbench_suggested_change (
          organization_id, team_id, project_id, persisted_state,
          proposed_risk_level, sequence DESC
        );
      CREATE INDEX workbench_suggested_change_decision_order
        ON workbench_suggested_change_decision (
          suggested_change_id, suggested_change_revision
        );

      CREATE TRIGGER workbench_suggested_change_envelope_no_update BEFORE UPDATE OF
        sequence, id, organization_id, team_id, project_id, source_actor_id,
        target_adapter, representation_schema_version, base_team_revision,
        base_responsibility_revision, candidate_json, proposed_diff_json,
        proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
        policy_version, origin_causation_id, proposal_command_id, created_at
        ON workbench_suggested_change
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange envelopes are immutable'); END;
      CREATE TRIGGER workbench_suggested_change_head_transition BEFORE UPDATE OF
        revision, persisted_state, updated_at ON workbench_suggested_change
      WHEN NOT (
        NEW.revision = OLD.revision + 1
        AND NEW.updated_at >= OLD.updated_at
        AND (
          (OLD.persisted_state = 'pending'
            AND NEW.persisted_state IN ('deferred', 'accepted', 'rejected'))
          OR (OLD.persisted_state = 'deferred'
            AND NEW.persisted_state IN ('accepted', 'rejected'))
        )
      )
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange head transition is invalid'); END;
      CREATE TRIGGER workbench_suggested_change_no_delete
        BEFORE DELETE ON workbench_suggested_change
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChanges cannot be deleted'); END;
      CREATE TRIGGER workbench_suggested_change_evidence_no_update
        BEFORE UPDATE ON workbench_suggested_change_evidence
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange evidence is immutable'); END;
      CREATE TRIGGER workbench_suggested_change_evidence_no_delete
        BEFORE DELETE ON workbench_suggested_change_evidence
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange evidence cannot be deleted'); END;
      CREATE TRIGGER workbench_suggested_change_decision_no_update
        BEFORE UPDATE ON workbench_suggested_change_decision
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange decisions are append-only'); END;
      CREATE TRIGGER workbench_suggested_change_decision_no_delete
        BEFORE DELETE ON workbench_suggested_change_decision
      BEGIN SELECT RAISE(ABORT, 'workbench SuggestedChange decisions cannot be deleted'); END
    `)
    return
  }
  throw new Error(`missing Workbench migration ${targetVersion}`)
}

function validateSchema(database: DatabaseSync): void {
  database.prepare('SELECT id, message, revision, updated_at FROM workbench_status WHERE singleton = 1')
  database.prepare('SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1')
  database.prepare('SELECT id, state, payload_json FROM workbench_outbox LIMIT 1')
  database.prepare('SELECT id, event_hash, canonical_envelope FROM workbench_audit_event LIMIT 1')
  database.prepare('SELECT command_id, result_json FROM workbench_command_receipt LIMIT 1')
  database.prepare(`
    SELECT template_id, template_version, snapshot_schema_version, kind,
      canonical_definition_json, definition_digest
    FROM workbench_template_version LIMIT 1
  `)
  database.prepare('SELECT revision FROM workbench_project_catalog WHERE singleton = 1')
  database.prepare('SELECT id, organization_id, team_id, revision FROM workbench_goal LIMIT 1')
  database.prepare('SELECT id, goal_id, ordinal, revision FROM workbench_outcome LIMIT 1')
  database.prepare(`
    SELECT id, catalog_sequence, primary_goal_id, template_id, template_version
    FROM workbench_project LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, canonical_snapshot_json, snapshot_digest
    FROM workbench_project_template_snapshot LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, goal_id, ordinal FROM workbench_project_supporting_goal LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, organization_id, team_id, team_revision,
      current_responsibility_revision, updated_at
    FROM workbench_project_team_head LIMIT 1
  `)
  database.prepare(`
    SELECT id, project_id, kind, status, identity_type, revision
    FROM workbench_project_member LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, revision, accountable_member_id, human_sponsor_member_id,
      contributor_count, updated_at
    FROM workbench_project_responsibility_version LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, responsibility_revision, member_id, ordinal
    FROM workbench_project_responsibility_contributor LIMIT 1
  `)
  database.prepare(`
    SELECT sequence, id, project_id, base_team_revision,
      base_responsibility_revision, revision, persisted_state
    FROM workbench_suggested_change LIMIT 1
  `)
  database.prepare(`
    SELECT suggested_change_id, ordinal, audit_event_id
    FROM workbench_suggested_change_evidence LIMIT 1
  `)
  database.prepare(`
    SELECT id, suggested_change_id, suggested_change_revision, mode, command_id
    FROM workbench_suggested_change_decision LIMIT 1
  `)
  const triggers = new Set((database.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'trigger'
  `).all() as Array<{ readonly name: string }>).map(row => row.name))
  for (const trigger of REQUIRED_IMMUTABILITY_TRIGGERS) {
    if (!triggers.has(trigger)) throw new Error(`Workbench database is missing trigger ${trigger}`)
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Workbench database contains broken foreign-key references')
  }
  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<{
    readonly integrity_check: string
  }>
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new Error('Workbench database failed SQLite integrity validation')
  }
  readCompiledTemplate(database)
  assertValidProjectDomain(database)
}

function readStatus(database: DatabaseSync): WorkbenchStatusSnapshot | null {
  const row = database.prepare(`
    SELECT id, message, revision, updated_at FROM workbench_status WHERE singleton = 1
  `).get() as StatusRow | undefined
  if (row === undefined) return null
  if (typeof row.id !== 'string' || row.id.length === 0
    || typeof row.message !== 'string' || row.message.length === 0
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.updated_at !== 'string' || !isIsoInstant(row.updated_at)) {
    throw new Error('Workbench database contains an invalid status projection')
  }
  return { id: row.id, message: row.message, revision: row.revision, updatedAt: row.updated_at }
}

function writeStatus(
  database: DatabaseSync,
  value: WorkbenchStatusSnapshot,
  create: boolean,
): void {
  const statement: StatementSync = create
    ? database.prepare(`INSERT INTO workbench_status VALUES (1, ?, ?, ?, ?)`)
    : database.prepare(`
      UPDATE workbench_status SET message = ?, revision = ?, updated_at = ? WHERE singleton = 1
    `)
  const result = create
    ? statement.run(value.id, value.message, value.revision, value.updatedAt)
    : statement.run(value.message, value.revision, value.updatedAt)
  if (result.changes !== 1) throw new Error('Workbench status mutation did not affect exactly one row')
}

function readCompiledTemplate(database: DatabaseSync) {
  const rows = database.prepare(`
    SELECT template_id, template_version, snapshot_schema_version, kind,
      canonical_definition_json, definition_digest
    FROM workbench_template_version
    ORDER BY template_id, template_version
  `).all() as unknown as TemplateVersionRow[]
  if (rows.length !== 1) {
    throw new Error('Workbench database must contain exactly the compiled Template Version')
  }
  const row = rows[0]
  if (row === undefined
    || row.template_id !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateId
    || row.template_version !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateVersion
    || row.snapshot_schema_version !== 1
    || row.kind !== 'knowledge-work'
    || row.canonical_definition_json !== KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1
    || row.definition_digest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1
    || contentDigest(row.canonical_definition_json) !== row.definition_digest) {
    throw new Error('Workbench database Template Version drifted from the compiled definition')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.canonical_definition_json)
  } catch {
    throw new Error('Workbench database Template Version contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== row.canonical_definition_json) {
    throw new Error('Workbench database Template Version is not canonical JSON')
  }
  return knowledgeWorkTemplateProjection()
}

function readProjectCatalog(database: DatabaseSync): ProjectCatalogRow {
  const row = database.prepare(`
    SELECT revision FROM workbench_project_catalog WHERE singleton = 1
  `).get() as ProjectCatalogRow | undefined
  if (row === undefined) throw new Error('Workbench database is missing its Project catalog')
  positiveInteger(row.revision, 'Project catalog revision', true)
  return row
}

function insertProjectDomain(
  database: DatabaseSync,
  mutation: WorkbenchProjectMutation,
  catalogSequence: number,
): void {
  const organizationId = mutation.command.actor.organizationId
  const teamId = mutation.command.actor.teamId
  const insertedGoal = database.prepare(`
    INSERT INTO workbench_goal (
      id, organization_id, team_id, name, revision, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, 'active', ?, ?)
  `).run(
    mutation.primaryGoalId,
    organizationId,
    teamId,
    mutation.primaryGoal.name,
    mutation.createdAt,
    mutation.createdAt,
  )
  if (insertedGoal.changes !== 1) throw new Error('Workbench Primary Goal was not inserted exactly once')

  const insertOutcome = database.prepare(`
    INSERT INTO workbench_outcome (
      id, organization_id, team_id, goal_id, ordinal, name, metric_name,
      initial_value, target_value, unit, direction, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)
  for (let index = 0; index < mutation.primaryGoal.outcomes.length; index += 1) {
    const outcome = mutation.primaryGoal.outcomes[index]
    if (outcome === undefined) throw new Error('Workbench Outcome order is sparse')
    const inserted = insertOutcome.run(
      outcome.outcomeId,
      organizationId,
      teamId,
      mutation.primaryGoalId,
      index + 1,
      outcome.name,
      outcome.metric.metricName,
      outcome.metric.initialValue,
      outcome.metric.targetValue,
      outcome.metric.unit,
      outcome.metric.direction,
      mutation.createdAt,
      mutation.createdAt,
    )
    if (inserted.changes !== 1) throw new Error('Workbench Outcome was not inserted exactly once')
  }

  const insertedProject = database.prepare(`
    INSERT INTO workbench_project (
      id, organization_id, team_id, name, revision, catalog_sequence,
      primary_goal_id, timezone, template_id, template_version,
      template_definition_digest, creation_snapshot_schema_version,
      creation_snapshot_digest, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    mutation.projectId,
    organizationId,
    teamId,
    mutation.projectName,
    catalogSequence,
    mutation.primaryGoalId,
    'Asia/Shanghai',
    mutation.template.templateId,
    mutation.template.templateVersion,
    mutation.template.definitionDigest,
    KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    mutation.createdAt,
    mutation.createdAt,
  )
  if (insertedProject.changes !== 1) throw new Error('Workbench Project was not inserted exactly once')

  const insertedTeam = database.prepare(`
    INSERT INTO workbench_project_team_head (
      project_id, organization_id, team_id, team_revision,
      current_responsibility_revision, updated_at
    ) VALUES (?, ?, ?, 0, NULL, ?)
  `).run(mutation.projectId, organizationId, teamId, mutation.createdAt)
  if (insertedTeam.changes !== 1) {
    throw new Error('Workbench Project Team head was not inserted exactly once')
  }

  const insertedSnapshot = database.prepare(`
    INSERT INTO workbench_project_template_snapshot (
      project_id, template_id, template_version, template_definition_digest,
      snapshot_schema_version, snapshot_digest, canonical_snapshot_json, captured_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    mutation.projectId,
    mutation.template.templateId,
    mutation.template.templateVersion,
    mutation.template.definitionDigest,
    KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
    mutation.createdAt,
  )
  if (insertedSnapshot.changes !== 1) {
    throw new Error('Workbench Project creation snapshot was not inserted exactly once')
  }

  const insertSupportingGoal = database.prepare(`
    INSERT INTO workbench_project_supporting_goal (
      project_id, organization_id, team_id, primary_goal_id, goal_id,
      ordinal, linked_goal_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (let index = 0; index < mutation.supportingGoals.length; index += 1) {
    const supporting = mutation.supportingGoals[index]
    if (supporting === undefined) throw new Error('Workbench Supporting Goal order is sparse')
    const inserted = insertSupportingGoal.run(
      mutation.projectId,
      organizationId,
      teamId,
      mutation.primaryGoalId,
      supporting.goalId,
      index + 1,
      supporting.expectedRevision,
    )
    if (inserted.changes !== 1) {
      throw new Error('Workbench Supporting Goal relation was not inserted exactly once')
    }
  }
}

function insertProjectOutbox(
  database: DatabaseSync,
  mutation: WorkbenchProjectMutation,
  payload: string,
): void {
  const result = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    mutation.command.outboxId,
    mutation.command.commandId,
    mutation.command.actor.organizationId,
    PROJECT_OUTBOX_TOPIC,
    `workbench:${mutation.command.outboxId}`,
    mutation.projectId,
    PROJECT_OBJECT_TYPE,
    mutation.projectId,
    mutation.command.causationId,
    payload,
    mutation.command.occurredAt,
    mutation.command.occurredAt,
  )
  if (result.changes !== 1) throw new Error('Workbench Project Outbox intent was not inserted exactly once')
}

function insertProjectMember(
  database: DatabaseSync,
  mutation: WorkbenchProjectMemberMutation,
): void {
  const identity = mutation.member.kind === 'human' ? mutation.member.identity : null
  const result = database.prepare(`
    INSERT INTO workbench_project_member (
      id, organization_id, team_id, project_id, kind, display_name, status,
      identity_type, feishu_app_id, feishu_open_id, external_method,
      external_value, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    mutation.memberId,
    mutation.command.actor.organizationId,
    mutation.command.actor.teamId,
    mutation.projectId,
    mutation.member.kind,
    mutation.member.displayName,
    identity === null ? 'workbench-agent' : identity.type,
    identity?.type === 'feishu' ? identity.appId : null,
    identity?.type === 'feishu' ? identity.openId : null,
    identity?.type === 'external' ? identity.method : null,
    identity?.type === 'external' ? identity.value : null,
    mutation.createdAt,
    mutation.createdAt,
  )
  if (result.changes !== 1) throw new Error('Workbench ProjectMember was not inserted exactly once')
}

interface ResponsibilityReplacementInput {
  readonly projectId: string
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly expectedTeamRevision: number
  readonly expectedResponsibilityRevision: number | null
  readonly updatedAt: string
  readonly organizationId: string
  readonly teamId: string
}

type ResponsibilityReplacementError = Extract<
SetProjectResponsibilityResult,
{ readonly ok: false }
>['error']

type ResponsibilityReplacementPlan =
  | {
    readonly ok: true
    readonly head: ProjectTeamHeadRow
    readonly responsibilityRevision: number
  }
  | { readonly ok: false; readonly error: ResponsibilityReplacementError }

function responsibilityReplacementInput(
  mutation: WorkbenchProjectResponsibilityMutation,
): ResponsibilityReplacementInput {
  return {
    projectId: mutation.projectId,
    accountableMemberId: mutation.accountableMemberId,
    contributorMemberIds: mutation.contributorMemberIds,
    humanSponsorMemberId: mutation.humanSponsorMemberId,
    expectedTeamRevision: mutation.expectedTeamRevision,
    expectedResponsibilityRevision: mutation.expectedResponsibilityRevision,
    updatedAt: mutation.updatedAt,
    organizationId: mutation.command.actor.organizationId,
    teamId: mutation.command.actor.teamId,
  }
}

/** Shared synchronous T05/T06 invariant planner; it never writes or opens a transaction. */
function planProjectResponsibilityReplacement(
  database: DatabaseSync,
  input: ResponsibilityReplacementInput,
): ResponsibilityReplacementPlan {
  const head = database.prepare(`
    SELECT project_id, organization_id, team_id, team_revision,
      current_responsibility_revision, updated_at
    FROM workbench_project_team_head
    WHERE project_id = ? AND organization_id = ? AND team_id = ?
  `).get(input.projectId, input.organizationId, input.teamId) as ProjectTeamHeadRow | undefined
  if (head === undefined) {
    return {
      ok: false,
      error: {
        code: 'project-not-found',
        message: `Workbench Project ${input.projectId} was not found in the authorized scope`,
        projectId: input.projectId,
      },
    }
  }
  projectTeamHeadValues(head)
  if (head.team_revision !== input.expectedTeamRevision) {
    return {
      ok: false,
      error: {
        code: 'team-revision-conflict',
        message: `Workbench Project Team revision changed (expected ${String(input.expectedTeamRevision)}, current ${String(head.team_revision)})`,
        expectedTeamRevision: input.expectedTeamRevision,
        currentTeamRevision: head.team_revision,
      },
    }
  }
  if (head.current_responsibility_revision !== input.expectedResponsibilityRevision) {
    return {
      ok: false,
      error: {
        code: 'responsibility-revision-conflict',
        message: 'Workbench Project Responsibility revision changed',
        expectedResponsibilityRevision: input.expectedResponsibilityRevision,
        currentResponsibilityRevision: head.current_responsibility_revision,
      },
    }
  }
  if (input.contributorMemberIds.includes(input.accountableMemberId)) {
    return {
      ok: false,
      error: {
        code: 'accountable-also-contributor',
        message: `Workbench Accountable ${input.accountableMemberId} cannot also be a Contributor`,
        memberId: input.accountableMemberId,
      },
    }
  }
  const referencedIds = [
    input.accountableMemberId,
    ...input.contributorMemberIds,
    ...(input.humanSponsorMemberId === null ? [] : [input.humanSponsorMemberId]),
  ]
  const members = new Map<string, ProjectMemberRow>()
  for (const memberId of referencedIds) {
    const member = readProjectMember(database, input.projectId, memberId)
    if (member === null) {
      return {
        ok: false,
        error: {
          code: 'member-not-found',
          message: `Workbench ProjectMember ${memberId} was not found in this Project`,
          memberId,
        },
      }
    }
    if (member.status !== 'active') {
      return {
        ok: false,
        error: {
          code: 'member-inactive',
          message: `Workbench ProjectMember ${memberId} is inactive`,
          memberId,
        },
      }
    }
    members.set(memberId, member)
  }
  const accountable = members.get(input.accountableMemberId)
  if (accountable === undefined) throw new Error('Workbench Accountable member disappeared')
  const sponsor = input.humanSponsorMemberId === null
    ? null
    : members.get(input.humanSponsorMemberId) ?? null
  const sponsorRequired = accountable.kind === 'agent' || accountable.identity_type === 'external'
  if (sponsorRequired && sponsor === null) {
    return {
      ok: false,
      error: {
        code: 'human-sponsor-required',
        message: `Workbench Accountable member ${input.accountableMemberId} requires a human Sponsor`,
        accountableMemberId: input.accountableMemberId,
      },
    }
  }
  if (!sponsorRequired && sponsor !== null) {
    return {
      ok: false,
      error: {
        code: 'human-sponsor-forbidden',
        message: `Workbench declared-Feishu human ${input.accountableMemberId} cannot have a Sponsor`,
        accountableMemberId: input.accountableMemberId,
      },
    }
  }
  if (sponsor !== null && (sponsor.kind !== 'human' || sponsor.id === accountable.id)) {
    return {
      ok: false,
      error: {
        code: 'human-sponsor-invalid',
        message: `Workbench Sponsor ${sponsor.id} must be a distinct active human`,
        humanSponsorMemberId: sponsor.id,
      },
    }
  }
  const responsibilityRevision = (head.current_responsibility_revision ?? 0) + 1
  if (!Number.isSafeInteger(responsibilityRevision)) {
    throw new Error('Workbench Project Responsibility revision exhausted')
  }
  return { ok: true, head, responsibilityRevision }
}

function applyProjectResponsibilityPlan(
  database: DatabaseSync,
  input: ResponsibilityReplacementInput,
  plan: Extract<ResponsibilityReplacementPlan, { readonly ok: true }>,
): { readonly responsibilityRevision: number; readonly teamRevision: number } {
  insertProjectResponsibility(database, input, plan.responsibilityRevision)
  const teamRevision = advanceProjectTeamHead(
    database,
    plan.head,
    input.updatedAt,
    plan.responsibilityRevision,
  )
  return { responsibilityRevision: plan.responsibilityRevision, teamRevision }
}

function insertProjectResponsibility(
  database: DatabaseSync,
  mutation: ResponsibilityReplacementInput,
  revision: number,
): void {
  const inserted = database.prepare(`
    INSERT INTO workbench_project_responsibility_version (
      project_id, organization_id, team_id, revision, accountable_member_id,
      human_sponsor_member_id, contributor_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mutation.projectId,
    mutation.organizationId,
    mutation.teamId,
    revision,
    mutation.accountableMemberId,
    mutation.humanSponsorMemberId,
    mutation.contributorMemberIds.length,
    mutation.updatedAt,
  )
  if (inserted.changes !== 1) {
    throw new Error('Workbench Project Responsibility version was not inserted exactly once')
  }
  const insertContributor = database.prepare(`
    INSERT INTO workbench_project_responsibility_contributor (
      project_id, organization_id, team_id, responsibility_revision, member_id, ordinal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (let index = 0; index < mutation.contributorMemberIds.length; index += 1) {
    const memberId = mutation.contributorMemberIds[index]
    if (memberId === undefined) throw new Error('Workbench Contributor order is sparse')
    const result = insertContributor.run(
      mutation.projectId,
      mutation.organizationId,
      mutation.teamId,
      revision,
      memberId,
      index + 1,
    )
    if (result.changes !== 1) {
      throw new Error('Workbench Project Responsibility Contributor was not inserted exactly once')
    }
  }
}

function advanceProjectTeamHead(
  database: DatabaseSync,
  head: ProjectTeamHeadRow,
  updatedAt: string,
  responsibilityRevision: number | null,
): number {
  if (head.team_revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Workbench Project Team revision exhausted')
  }
  const next = head.team_revision + 1
  const result = database.prepare(`
    UPDATE workbench_project_team_head
    SET team_revision = ?, current_responsibility_revision = ?, updated_at = ?
    WHERE project_id = ? AND organization_id = ? AND team_id = ?
      AND team_revision = ? AND current_responsibility_revision IS ?
  `).run(
    next,
    responsibilityRevision,
    updatedAt,
    head.project_id,
    head.organization_id,
    head.team_id,
    head.team_revision,
    head.current_responsibility_revision,
  )
  if (result.changes !== 1) throw new Error('Workbench Project Team head did not advance exactly once')
  return next
}

function isMemberInCurrentResponsibility(
  database: DatabaseSync,
  head: ProjectTeamHeadRow,
  memberId: string,
): boolean {
  if (head.current_responsibility_revision === null) return false
  const direct = database.prepare(`
    SELECT 1 AS present
    FROM workbench_project_responsibility_version
    WHERE project_id = ? AND revision = ?
      AND (accountable_member_id = ? OR human_sponsor_member_id = ?)
  `).get(
    head.project_id,
    head.current_responsibility_revision,
    memberId,
    memberId,
  )
  if (direct !== undefined) return true
  return database.prepare(`
    SELECT 1 AS present
    FROM workbench_project_responsibility_contributor
    WHERE project_id = ? AND responsibility_revision = ? AND member_id = ?
  `).get(head.project_id, head.current_responsibility_revision, memberId) !== undefined
}

type ProjectTeamCommittedResult =
  | Extract<AddProjectMemberResult, { readonly ok: true }>
  | Extract<SetProjectMemberStatusResult, { readonly ok: true }>
  | Extract<SetProjectResponsibilityResult, { readonly ok: true }>

interface ProjectTeamLedgerInput {
  readonly command: WorkbenchCommandMetadata
  readonly requestHash: string
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly objectType: WorkbenchAuditObjectType
  readonly objectId: string
  readonly objectVersion: number
  readonly projectId: string
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
  readonly payload: Readonly<Record<string, string | number>>
  readonly result: ProjectTeamCommittedResult
}

function appendProjectTeamLedger(database: DatabaseSync, input: ProjectTeamLedgerInput): void {
  const payload = canonicalizeJson({
    schemaVersion: 1,
    commandId: input.command.commandId,
    auditEventId: input.command.auditEventId,
    requestHash: input.requestHash,
    ...input.payload,
    causationId: input.command.causationId,
  })
  const outbox = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    input.command.outboxId,
    input.command.commandId,
    input.command.actor.organizationId,
    input.outboxTopic,
    `workbench:${input.command.outboxId}`,
    input.projectId,
    input.objectType,
    input.objectId,
    input.objectVersion,
    input.command.causationId,
    payload,
    input.command.occurredAt,
    input.command.occurredAt,
  )
  if (outbox.changes !== 1) {
    throw new Error('Workbench Project Team Outbox intent was not inserted exactly once')
  }

  const head = readAuditHead(database)
  if (head.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Workbench audit sequence exhausted')
  const sequence = head.sequence + 1
  const event = createAuditEvent({
    sequence: String(sequence),
    previousHash: auditHash(head.head_hash),
    auditId: input.command.auditEventId,
    occurredAt: input.command.occurredAt,
    actor: { kind: input.command.actor.kind, id: input.command.actor.id },
    action: input.auditAction,
    scope: {
      organizationId: input.command.actor.organizationId,
      teamId: input.command.actor.teamId,
      projectId: input.projectId,
    },
    reason: { code: input.command.reason },
    object: {
      type: input.objectType,
      id: input.objectId,
      version: String(input.objectVersion),
    },
    command: { id: input.command.commandId, type: input.commandType },
    causation: { id: input.command.causationId },
    outbox: { id: input.command.outboxId, state: 'pending' },
    outcome: 'committed',
    summary: { code: input.summaryCode, changedFields: input.changedFields },
  })
  insertAuditEvent(database, event)
  const advanced = database.prepare(`
    UPDATE workbench_audit_head SET sequence = ?, head_hash = ?
    WHERE singleton = 1 AND sequence = ? AND head_hash = ?
  `).run(sequence, event.eventHash, head.sequence, head.head_hash)
  if (advanced.changes !== 1) throw new Error('Workbench audit head did not advance exactly once')

  const receipt = database.prepare(`
    INSERT INTO workbench_command_receipt (
      organization_id, actor_id, idempotency_key_hash, command_type,
      request_hash, command_id, audit_event_id, outbox_id, result_json, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.command.actor.organizationId,
    input.command.actor.id,
    idempotencyKeyHash(input.command.idempotencyKey),
    input.commandType,
    input.requestHash,
    input.command.commandId,
    input.command.auditEventId,
    input.command.outboxId,
    canonicalizeJson(input.result),
    input.command.occurredAt,
  )
  if (receipt.changes !== 1) {
    throw new Error('Workbench Project Team command receipt was not inserted exactly once')
  }
}

interface SuggestedChangeRiskMaterial {
  readonly level: SuggestedChangeRiskLevel
  readonly reasons: readonly SuggestedChangeRiskReason[]
}

function responsibilityReviewValue(
  database: DatabaseSync,
  head: ProjectTeamHeadRow,
): ProjectResponsibilityReviewValue {
  if (head.current_responsibility_revision === null) {
    return Object.freeze({
      accountableMemberId: null,
      contributorMemberIds: Object.freeze([]),
      humanSponsorMemberId: null,
    })
  }
  const current = readProjectResponsibility(
    database,
    head,
    head.current_responsibility_revision,
    true,
  )
  return Object.freeze({
    accountableMemberId: current.accountableMemberId,
    contributorMemberIds: Object.freeze([...current.contributorMemberIds]),
    humanSponsorMemberId: current.humanSponsorMemberId,
  })
}

function projectResponsibilityReviewDiff(
  before: ProjectResponsibilityReviewValue,
  after: ProjectResponsibilitySuggestedValue,
): ProjectResponsibilityReviewDiff {
  const changedFields: Array<'accountable' | 'contributors' | 'human-sponsor'> = []
  if (before.accountableMemberId !== after.accountableMemberId) changedFields.push('accountable')
  if (before.contributorMemberIds.length !== after.contributorMemberIds.length
    || before.contributorMemberIds.some((memberId, index) =>
      memberId !== after.contributorMemberIds[index])) {
    changedFields.push('contributors')
  }
  if (before.humanSponsorMemberId !== after.humanSponsorMemberId) {
    changedFields.push('human-sponsor')
  }
  const normalizedBefore = Object.freeze({
    accountableMemberId: before.accountableMemberId,
    contributorMemberIds: Object.freeze([...before.contributorMemberIds]),
    humanSponsorMemberId: before.humanSponsorMemberId,
  })
  const normalizedAfter = Object.freeze({
    accountableMemberId: after.accountableMemberId,
    contributorMemberIds: Object.freeze([...after.contributorMemberIds]),
    humanSponsorMemberId: after.humanSponsorMemberId,
  })
  const digest = contentDigest(canonicalizeJson({
    kind: 'project-responsibility.diff',
    schemaVersion: 1,
    before: normalizedBefore,
    after: normalizedAfter,
    changedFields,
  }))
  return Object.freeze({
    kind: 'project-responsibility.diff',
    schemaVersion: 1,
    before: normalizedBefore,
    after: normalizedAfter,
    changedFields: Object.freeze(changedFields),
    digest,
  })
}

function suggestedChangeRisk(
  before: ProjectResponsibilityReviewValue,
  after: ProjectResponsibilitySuggestedValue,
): SuggestedChangeRiskMaterial {
  if (before.accountableMemberId === null) {
    return Object.freeze({
      level: 'high',
      reasons: Object.freeze(['initial-responsibility'] as const),
    })
  }
  const reasons: SuggestedChangeRiskReason[] = []
  if (before.accountableMemberId !== after.accountableMemberId) {
    reasons.push('accountable-changed')
  }
  if (before.humanSponsorMemberId !== after.humanSponsorMemberId) {
    reasons.push('human-sponsor-changed')
  }
  if (reasons.length > 0) {
    return Object.freeze({ level: 'high', reasons: Object.freeze(reasons) })
  }
  return Object.freeze({
    level: 'low',
    reasons: Object.freeze(['contributors-only'] as const),
  })
}

function maxSuggestedChangeRisk(
  proposed: SuggestedChangeRiskLevel,
  applied: SuggestedChangeRiskLevel,
): SuggestedChangeRiskLevel {
  return proposed === 'high' || applied === 'high' ? 'high' : 'low'
}

interface SuggestedChangeLedgerInput {
  readonly command: WorkbenchCommandMetadata
  readonly requestHash: string
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly objectId: string
  readonly objectVersion: number
  readonly projectId: string
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
  readonly payload: Readonly<Record<string, string | number>>
  readonly result:
    | Extract<ProposeProjectResponsibilityChangeResult, { readonly ok: true }>
    | Extract<DecideSuggestedChangeResult, { readonly ok: true }>
}

function appendSuggestedChangeLedger(
  database: DatabaseSync,
  input: SuggestedChangeLedgerInput,
): void {
  const payload = canonicalizeJson({
    schemaVersion: 1,
    commandId: input.command.commandId,
    auditEventId: input.command.auditEventId,
    requestHash: input.requestHash,
    ...input.payload,
    causationId: input.command.causationId,
  })
  const outbox = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    input.command.outboxId,
    input.command.commandId,
    input.command.actor.organizationId,
    input.outboxTopic,
    `workbench:${input.command.outboxId}`,
    input.projectId,
    SUGGESTED_CHANGE_OBJECT_TYPE,
    input.objectId,
    input.objectVersion,
    input.command.causationId,
    payload,
    input.command.occurredAt,
    input.command.occurredAt,
  )
  if (outbox.changes !== 1) {
    throw new Error('Workbench SuggestedChange Outbox intent was not inserted exactly once')
  }
  const head = readAuditHead(database)
  if (head.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Workbench audit sequence exhausted')
  const sequence = head.sequence + 1
  const event = createAuditEvent({
    sequence: String(sequence),
    previousHash: auditHash(head.head_hash),
    auditId: input.command.auditEventId,
    occurredAt: input.command.occurredAt,
    actor: { kind: input.command.actor.kind, id: input.command.actor.id },
    action: input.auditAction,
    scope: {
      organizationId: input.command.actor.organizationId,
      teamId: input.command.actor.teamId,
      projectId: input.projectId,
    },
    reason: { code: input.command.reason },
    object: {
      type: SUGGESTED_CHANGE_OBJECT_TYPE,
      id: input.objectId,
      version: String(input.objectVersion),
    },
    command: { id: input.command.commandId, type: input.commandType },
    causation: { id: input.command.causationId },
    outbox: { id: input.command.outboxId, state: 'pending' },
    outcome: 'committed',
    summary: { code: input.summaryCode, changedFields: input.changedFields },
  })
  insertAuditEvent(database, event)
  const advanced = database.prepare(`
    UPDATE workbench_audit_head SET sequence = ?, head_hash = ?
    WHERE singleton = 1 AND sequence = ? AND head_hash = ?
  `).run(sequence, event.eventHash, head.sequence, head.head_hash)
  if (advanced.changes !== 1) throw new Error('Workbench audit head did not advance exactly once')
  const receipt = database.prepare(`
    INSERT INTO workbench_command_receipt (
      organization_id, actor_id, idempotency_key_hash, command_type,
      request_hash, command_id, audit_event_id, outbox_id, result_json, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.command.actor.organizationId,
    input.command.actor.id,
    idempotencyKeyHash(input.command.idempotencyKey),
    input.commandType,
    input.requestHash,
    input.command.commandId,
    input.command.auditEventId,
    input.command.outboxId,
    canonicalizeJson(input.result),
    input.command.occurredAt,
  )
  if (receipt.changes !== 1) {
    throw new Error('Workbench SuggestedChange receipt was not inserted exactly once')
  }
}

function insertSuggestedChangeProposal(
  database: DatabaseSync,
  mutation: WorkbenchSuggestedChangeProposalMutation,
  baseResponsibilityRevision: number | null,
  proposedDiff: ProjectResponsibilityReviewDiff,
  risk: SuggestedChangeRiskMaterial,
): void {
  const inserted = database.prepare(`
    INSERT INTO workbench_suggested_change (
      id, organization_id, team_id, project_id, source_actor_id, target_adapter,
      representation_schema_version, base_team_revision,
      base_responsibility_revision, candidate_json, proposed_diff_json,
      proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
      policy_version, origin_causation_id, proposal_command_id,
      revision, persisted_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)
  `).run(
    mutation.suggestedChangeId,
    mutation.command.actor.organizationId,
    mutation.command.actor.teamId,
    mutation.projectId,
    mutation.command.actor.id,
    SUGGESTED_CHANGE_TARGET_ADAPTER,
    SUGGESTED_CHANGE_REPRESENTATION_VERSION,
    mutation.expectedTeamRevision,
    baseResponsibilityRevision,
    canonicalizeJson(mutation.candidate),
    canonicalizeJson(proposedDiff),
    proposedDiff.digest,
    risk.level,
    canonicalizeJson(risk.reasons),
    SUGGESTED_CHANGE_POLICY_VERSION,
    mutation.command.causationId,
    mutation.command.commandId,
    mutation.createdAt,
    mutation.createdAt,
  )
  if (inserted.changes !== 1) {
    throw new Error('Workbench SuggestedChange proposal was not inserted exactly once')
  }
}

function insertSuggestedChangeEvidence(
  database: DatabaseSync,
  suggestedChangeId: string,
  rows: readonly AuditRow[],
): void {
  const statement = database.prepare(`
    INSERT INTO workbench_suggested_change_evidence (
      suggested_change_id, ordinal, audit_event_id
    ) VALUES (?, ?, ?)
  `)
  rows.forEach((row, index) => {
    const inserted = statement.run(suggestedChangeId, index + 1, row.id)
    if (inserted.changes !== 1) {
      throw new Error('Workbench SuggestedChange EvidenceRef was not inserted exactly once')
    }
  })
}

interface SuggestedChangeDecisionInsert {
  readonly mutation: WorkbenchSuggestedChangeDecisionMutation
  readonly suggestedChangeRevision: number
  readonly decisionMode: SuggestedChangeDecisionMode
  readonly appliedCandidate: ProjectResponsibilitySuggestedValue | null
  readonly appliedDiff: ProjectResponsibilityReviewDiff | null
  readonly appliedRiskLevel: SuggestedChangeRiskLevel | null
  readonly appliedRiskReasons: readonly SuggestedChangeRiskReason[]
  readonly appliedTeamRevision: number | null
  readonly appliedResponsibilityRevision: number | null
}

function insertSuggestedChangeDecision(
  database: DatabaseSync,
  input: SuggestedChangeDecisionInsert,
): void {
  const inserted = database.prepare(`
    INSERT INTO workbench_suggested_change_decision (
      id, suggested_change_id, suggested_change_revision, mode, actor_id,
      feedback, applied_candidate_json, applied_diff_json, applied_risk_level,
      applied_risk_reasons_json, applied_team_revision,
      applied_responsibility_revision, causation_id, command_id,
      audit_event_id, outbox_id, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.mutation.decisionId,
    input.mutation.suggestedChangeId,
    input.suggestedChangeRevision,
    input.decisionMode,
    input.mutation.command.actor.id,
    input.mutation.feedback,
    input.appliedCandidate === null ? null : canonicalizeJson(input.appliedCandidate),
    input.appliedDiff === null ? null : canonicalizeJson(input.appliedDiff),
    input.appliedRiskLevel,
    canonicalizeJson(input.appliedRiskReasons),
    input.appliedTeamRevision,
    input.appliedResponsibilityRevision,
    input.mutation.command.causationId,
    input.mutation.command.commandId,
    input.mutation.command.auditEventId,
    input.mutation.command.outboxId,
    input.mutation.decidedAt,
  )
  if (inserted.changes !== 1) {
    throw new Error('Workbench SuggestedChange decision was not inserted exactly once')
  }
}

function readSuggestedChange(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  projectId: string,
  suggestedChangeId: string,
): SuggestedChangeRow | null {
  const row = database.prepare(`
    SELECT sequence, id, organization_id, team_id, project_id, source_actor_id,
      target_adapter, representation_schema_version, base_team_revision,
      base_responsibility_revision, candidate_json, proposed_diff_json,
      proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
      policy_version, origin_causation_id, proposal_command_id, revision,
      persisted_state, created_at, updated_at
    FROM workbench_suggested_change
    WHERE id = ? AND organization_id = ? AND team_id = ? AND project_id = ?
  `).get(
    suggestedChangeId,
    organizationId,
    teamId,
    projectId,
  ) as SuggestedChangeRow | undefined
  if (row === undefined) return null
  validateSuggestedChangeRow(row)
  return row
}

function readSuggestedChangeEvidenceRows(
  database: DatabaseSync,
  suggestedChangeId: string,
): readonly SuggestedChangeEvidenceRow[] {
  const rows = database.prepare(`
    SELECT suggested_change_id, ordinal, audit_event_id
    FROM workbench_suggested_change_evidence
    WHERE suggested_change_id = ? ORDER BY ordinal
  `).all(suggestedChangeId) as unknown as SuggestedChangeEvidenceRow[]
  if (rows.length < 1 || rows.length > MAX_SUGGESTED_CHANGE_EVIDENCE) {
    throw new Error('Workbench SuggestedChange has an invalid EvidenceRef count')
  }
  rows.forEach((row, index) => {
    if (row.suggested_change_id !== suggestedChangeId || row.ordinal !== index + 1) {
      throw new Error('Workbench SuggestedChange EvidenceRef order is invalid')
    }
    boundedReference(row.audit_event_id, 'SuggestedChange EvidenceRef audit id')
    const previous = rows[index - 1]
    if (previous !== undefined && previous.audit_event_id >= row.audit_event_id) {
      throw new Error('Workbench SuggestedChange EvidenceRefs lost their canonical order')
    }
  })
  return rows
}

type SuggestedChangeEvidenceResolution =
  | { readonly ok: true; readonly rows: readonly AuditRow[] }
  | {
    readonly ok: false
    readonly reason: 'duplicate' | 'unavailable' | 'wrong-project' | 'integrity-failed'
  }

function resolveSuggestedChangeEvidence(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  projectId: string,
  auditEventIds: readonly string[],
  beforeSequence?: number,
): SuggestedChangeEvidenceResolution {
  if (auditEventIds.length < 1 || auditEventIds.length > MAX_SUGGESTED_CHANGE_EVIDENCE) {
    return { ok: false, reason: 'unavailable' }
  }
  if (new Set(auditEventIds).size !== auditEventIds.length) {
    return { ok: false, reason: 'duplicate' }
  }
  if (!verifyAuditChainSync(database).valid) {
    return { ok: false, reason: 'integrity-failed' }
  }
  const rows: AuditRow[] = []
  for (const auditEventId of auditEventIds) {
    const row = readAuditRow(database, auditEventId)
    if (row === null) return { ok: false, reason: 'unavailable' }
    if (row.organization_id !== organizationId
      || row.team_id !== teamId
      || row.project_id !== projectId) {
      return { ok: false, reason: 'wrong-project' }
    }
    if (beforeSequence !== undefined && row.sequence >= beforeSequence) {
      return { ok: false, reason: 'unavailable' }
    }
    auditEventFromRow(row)
    rows.push(row)
  }
  return { ok: true, rows: Object.freeze(rows) }
}

function suggestedChangeProposalAuditSequence(
  database: DatabaseSync,
  suggested: Pick<SuggestedChangeRow, 'proposal_command_id'>,
): number {
  const row = database.prepare(`
    SELECT sequence FROM workbench_audit_event WHERE command_id = ?
      AND command_type = ?
  `).get(
    suggested.proposal_command_id,
    SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
  ) as { readonly sequence: number } | undefined
  if (row === undefined) throw new Error('Workbench SuggestedChange lost its proposal audit')
  return positiveInteger(row.sequence, 'SuggestedChange proposal audit sequence')
}

function readAuditRow(database: DatabaseSync, auditEventId: string): AuditRow | null {
  const row = database.prepare(`
    SELECT sequence, id, occurred_at, actor_kind, actor_id, organization_id,
      team_id, project_id, action, reason_code, reason_detail, object_type,
      object_id, object_version, command_id, command_type, causation_id,
      outbox_id, outbox_state, outcome, summary_code, summary_fields_json,
      previous_hash, event_hash, canonical_envelope
    FROM workbench_audit_event WHERE id = ?
  `).get(auditEventId) as AuditRow | undefined
  return row ?? null
}

function readReviewCenterSync(
  database: DatabaseSync,
  query: WorkbenchReviewCenterQuery,
): ReviewCenterProjection | null {
  const head = readProjectTeamHead(database, {
    organizationId: query.organizationId,
    teamId: query.teamId,
    projectId: query.filter.projectId,
  })
  if (head === null) return null
  const limit = query.filter.limit ?? 20
  const effectiveStatusSql = `CASE
    WHEN suggested.persisted_state IN ('pending', 'deferred')
      AND suggested.base_team_revision <> ? THEN 'stale'
    ELSE suggested.persisted_state END`
  const effectiveRiskSql = `CASE
    WHEN suggested.proposed_risk_level = 'high' OR EXISTS (
      SELECT 1 FROM workbench_suggested_change_decision AS risk_decision
      WHERE risk_decision.suggested_change_id = suggested.id
        AND risk_decision.applied_risk_level = 'high'
    ) THEN 'high' ELSE 'low' END`
  const where = [
    'suggested.organization_id = ?',
    'suggested.team_id = ?',
    'suggested.project_id = ?',
  ]
  const parameters: Array<string | number> = [
    query.organizationId,
    query.teamId,
    query.filter.projectId,
  ]
  if (query.filter.status !== undefined) {
    where.push(`${effectiveStatusSql} = ?`)
    parameters.push(head.team_revision, query.filter.status)
  }
  if (query.filter.riskLevel !== undefined) {
    where.push(`${effectiveRiskSql} = ?`)
    parameters.push(query.filter.riskLevel)
  }
  if (query.filter.beforeSequence !== undefined) {
    where.push('suggested.sequence < ?')
    parameters.push(query.filter.beforeSequence)
  }
  parameters.push(limit + 1)
  const rows = database.prepare(`
    SELECT suggested.sequence, suggested.id, suggested.organization_id,
      suggested.team_id, suggested.project_id, suggested.source_actor_id,
      suggested.target_adapter, suggested.representation_schema_version,
      suggested.base_team_revision, suggested.base_responsibility_revision,
      suggested.candidate_json, suggested.proposed_diff_json,
      suggested.proposed_diff_digest, suggested.proposed_risk_level,
      suggested.proposed_risk_reasons_json, suggested.policy_version,
      suggested.origin_causation_id, suggested.proposal_command_id,
      suggested.revision, suggested.persisted_state,
      suggested.created_at, suggested.updated_at
    FROM workbench_suggested_change AS suggested
    WHERE ${where.join(' AND ')}
    ORDER BY suggested.sequence DESC
    LIMIT ?
  `).all(...parameters) as unknown as SuggestedChangeRow[]
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const items = visible.map(row => suggestedChangeProjectionFromRow(database, row, head))
  const memberRows = database.prepare(`
    SELECT id, organization_id, team_id, project_id, kind, display_name, status,
      identity_type, feishu_app_id, feishu_open_id, external_method,
      external_value, revision, created_at, updated_at
    FROM workbench_project_member WHERE project_id = ? ORDER BY created_at, id
  `).all(head.project_id) as unknown as ProjectMemberRow[]
  const memberOptions = memberRows.map(row => {
    const member = projectMemberFromRow(row)
    return Object.freeze({
      memberId: member.memberId,
      displayName: member.displayName,
      kind: member.kind,
      status: member.status,
      requiresHumanSponsor: member.kind === 'agent'
        || (member.kind === 'human' && member.identity.type === 'external'),
      canBeHumanSponsor: member.kind === 'human' && member.status === 'active',
    })
  })
  const evidenceOptions = readRecentProjectEvidence(database, head.project_id)
  return reviewCenterProjection({
    projectId: head.project_id,
    proposalBuilder: {
      projectId: head.project_id,
      teamRevision: head.team_revision,
      responsibilityRevision: head.current_responsibility_revision,
      base: responsibilityReviewValue(database, head),
      memberOptions,
      evidenceOptions,
    },
    items,
    nextBeforeSequence: hasMore ? items.at(-1)?.sequence ?? null : null,
  })
}

function suggestedChangeProjectionFromRow(
  database: DatabaseSync,
  row: SuggestedChangeRow,
  currentHead: ProjectTeamHeadRow,
): ReviewCenterProjection['items'][number] {
  validateSuggestedChangeRow(row)
  const proposedDiff = decodeProjectResponsibilityReviewDiff(row.proposed_diff_json)
  if (proposedDiff.digest !== row.proposed_diff_digest) {
    throw new Error('Workbench SuggestedChange diff digest does not match its envelope')
  }
  const proposedLevel = suggestedChangeRiskLevel(row.proposed_risk_level)
  const proposedReasonCodes = decodeSuggestedChangeRiskReasons(
    row.proposed_risk_reasons_json,
  )
  const evidenceRows = readSuggestedChangeEvidenceRows(database, row.id)
  const evidence = evidenceRows.map(evidenceRow => {
    const audit = readAuditRow(database, evidenceRow.audit_event_id)
    if (audit === null) throw new Error('Workbench SuggestedChange lost an EvidenceRef')
    if (audit.project_id !== row.project_id) {
      throw new Error('Workbench SuggestedChange EvidenceRef escaped its Project')
    }
    return suggestedChangeEvidenceProjection(audit)
  })
  const decisionRows = database.prepare(`
    SELECT id, suggested_change_id, suggested_change_revision, mode, actor_id,
      feedback, applied_candidate_json, applied_diff_json, applied_risk_level,
      applied_risk_reasons_json, applied_team_revision,
      applied_responsibility_revision, causation_id, command_id,
      audit_event_id, outbox_id, decided_at
    FROM workbench_suggested_change_decision
    WHERE suggested_change_id = ? ORDER BY suggested_change_revision
  `).all(row.id) as unknown as SuggestedChangeDecisionRow[]
  const decisions = decisionRows.map(decision =>
    suggestedChangeDecisionProjectionFromRow(decision, row.id))
  const effectiveStatus = suggestedChangeEffectiveStatus(row, currentHead.team_revision)
  const appliedHigh = decisions.some(decision => decision.appliedRiskLevel === 'high')
  const effectiveLevel: SuggestedChangeRiskLevel = proposedLevel === 'high' || appliedHigh
    ? 'high'
    : 'low'
  const actionable = effectiveStatus === 'pending' || effectiveStatus === 'deferred'
  const allowedDecisions = effectiveStatus === 'stale'
    ? ['reject'] as const
    : effectiveStatus === 'pending'
      ? ['accept', 'edit-and-accept', 'reject', 'defer'] as const
      : effectiveStatus === 'deferred'
        ? ['accept', 'edit-and-accept', 'reject'] as const
        : [] as const
  return Object.freeze({
    suggestedChangeId: row.id,
    sequence: row.sequence,
    revision: row.revision,
    projectId: row.project_id,
    source: Object.freeze({ kind: 'owner', actorId: row.source_actor_id }),
    target: Object.freeze({
      kind: 'project-responsibility',
      adapter: SUGGESTED_CHANGE_TARGET_ADAPTER,
      representationSchemaVersion: 1,
      projectId: row.project_id,
      baseTeamRevision: row.base_team_revision,
      baseResponsibilityRevision: row.base_responsibility_revision,
      currentTeamRevision: currentHead.team_revision,
      currentResponsibilityRevision: currentHead.current_responsibility_revision,
    }),
    proposedDiff,
    evidence: Object.freeze(evidence),
    risk: Object.freeze({
      proposedLevel,
      effectiveLevel,
      proposedReasonCodes,
      policyVersion: SUGGESTED_CHANGE_POLICY_VERSION,
      batchPolicy: effectiveLevel === 'low' && actionable
        ? Object.freeze({
          policy: 'eligible-later' as const,
          homogeneityKey: 'project-responsibility.replace|low|project-responsibility-v1' as const,
        })
        : Object.freeze({
          policy: 'forbidden' as const,
          reason: !actionable ? 'not-actionable' as const : 'high-risk' as const,
        }),
    }),
    originCausationId: row.origin_causation_id,
    persistedState: suggestedChangePersistedState(row.persisted_state),
    effectiveStatus,
    decisions: Object.freeze(decisions),
    allowedDecisions: Object.freeze([...allowedDecisions]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function suggestedChangeDecisionProjectionFromRow(
  row: SuggestedChangeDecisionRow,
  suggestedChangeId: string,
): ReviewCenterProjection['items'][number]['decisions'][number] {
  if (row.suggested_change_id !== suggestedChangeId) {
    throw new Error('Workbench SuggestedChange decision escaped its envelope')
  }
  const mode = suggestedChangeDecisionMode(row.mode)
  const accepting = mode === 'accepted' || mode === 'edited-accepted'
  const appliedDiff = row.applied_diff_json === null
    ? null
    : decodeProjectResponsibilityReviewDiff(row.applied_diff_json)
  if (accepting !== (appliedDiff !== null)
    || accepting !== (row.applied_risk_level !== null)
    || accepting !== (row.applied_team_revision !== null)
    || accepting !== (row.applied_responsibility_revision !== null)) {
    throw new Error('Workbench SuggestedChange decision has inconsistent applied material')
  }
  if (row.applied_candidate_json !== null) {
    const candidate = decodeProjectResponsibilitySuggestedValue(row.applied_candidate_json)
    if (appliedDiff === null
      || canonicalizeJson(candidate) !== canonicalizeJson(appliedDiff.after)) {
      throw new Error('Workbench SuggestedChange applied candidate does not match its diff')
    }
  } else if (accepting) {
    throw new Error('Workbench accepted SuggestedChange is missing its applied candidate')
  }
  const appliedRiskReasonCodes = decodeSuggestedChangeRiskReasons(
    row.applied_risk_reasons_json,
    !accepting,
  )
  return Object.freeze({
    decisionId: boundedReference(row.id, 'SuggestedChange decision id'),
    suggestedChangeRevision: positiveInteger(
      row.suggested_change_revision,
      'SuggestedChange decision revision',
    ),
    mode,
    actor: Object.freeze({
      kind: 'owner',
      id: boundedReference(row.actor_id, 'SuggestedChange decision actor id'),
    }),
    feedback: storedText(
      row.feedback,
      'SuggestedChange decision feedback',
      MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH,
    ),
    appliedDiff,
    appliedRiskLevel: row.applied_risk_level === null
      ? null
      : suggestedChangeRiskLevel(row.applied_risk_level),
    appliedRiskReasonCodes,
    appliedTeamRevision: row.applied_team_revision === null
      ? null
      : positiveInteger(row.applied_team_revision, 'SuggestedChange applied Team revision'),
    appliedResponsibilityRevision: row.applied_responsibility_revision === null
      ? null
      : positiveInteger(
        row.applied_responsibility_revision,
        'SuggestedChange applied Responsibility revision',
      ),
    causationId: boundedReference(row.causation_id, 'SuggestedChange decision causation id'),
    receipt: Object.freeze({
      commandId: boundedReference(row.command_id, 'SuggestedChange decision command id'),
      auditEventId: boundedReference(row.audit_event_id, 'SuggestedChange decision audit id'),
      outboxId: boundedReference(row.outbox_id, 'SuggestedChange decision Outbox id'),
    }),
    decidedAt: canonicalInstant(row.decided_at, 'SuggestedChange decision decidedAt'),
  })
}

function suggestedChangeEvidenceProjection(row: AuditRow): SuggestedChangeEvidenceProjection {
  const event = auditEventFromRow(row)
  return Object.freeze({
    kind: 'workbench-audit-event',
    auditEventId: event.auditId,
    occurredAt: event.occurredAt,
    action: event.action,
    summaryCode: event.summary.code,
    object: Object.freeze({
      type: event.object.type,
      id: event.object.id,
      version: positiveInteger(Number(event.object.version), 'Evidence object version'),
    }),
  })
}

function readRecentProjectEvidence(
  database: DatabaseSync,
  projectId: string,
): readonly SuggestedChangeEvidenceProjection[] {
  const rows = database.prepare(`
    SELECT sequence, id, occurred_at, actor_kind, actor_id, organization_id,
      team_id, project_id, action, reason_code, reason_detail, object_type,
      object_id, object_version, command_id, command_type, causation_id,
      outbox_id, outbox_state, outcome, summary_code, summary_fields_json,
      previous_hash, event_hash, canonical_envelope
    FROM workbench_audit_event WHERE project_id = ?
    ORDER BY sequence DESC LIMIT ${MAX_SUGGESTED_CHANGE_EVIDENCE}
  `).all(projectId) as unknown as AuditRow[]
  return Object.freeze(rows.map(suggestedChangeEvidenceProjection))
}

function validateSuggestedChangeRow(row: SuggestedChangeRow): void {
  positiveInteger(row.sequence, 'SuggestedChange sequence')
  boundedReference(row.id, 'SuggestedChange id')
  boundedReference(row.organization_id, 'SuggestedChange organization id')
  boundedReference(row.team_id, 'SuggestedChange team id')
  boundedReference(row.project_id, 'SuggestedChange Project id')
  boundedReference(row.source_actor_id, 'SuggestedChange source actor id')
  if (row.target_adapter !== SUGGESTED_CHANGE_TARGET_ADAPTER
    || row.representation_schema_version !== SUGGESTED_CHANGE_REPRESENTATION_VERSION
    || row.policy_version !== SUGGESTED_CHANGE_POLICY_VERSION) {
    throw new Error('Workbench SuggestedChange has an unsupported target contract')
  }
  positiveInteger(row.base_team_revision, 'SuggestedChange base Team revision', true)
  if (row.base_responsibility_revision !== null) {
    positiveInteger(
      row.base_responsibility_revision,
      'SuggestedChange base Responsibility revision',
    )
  }
  const candidate = decodeProjectResponsibilitySuggestedValue(row.candidate_json)
  const diff = decodeProjectResponsibilityReviewDiff(row.proposed_diff_json)
  if (canonicalizeJson(candidate) !== canonicalizeJson(diff.after)
    || diff.digest !== row.proposed_diff_digest
    || diff.changedFields.length === 0) {
    throw new Error('Workbench SuggestedChange candidate and proposed diff are inconsistent')
  }
  const risk = suggestedChangeRisk(diff.before, diff.after)
  const storedLevel = suggestedChangeRiskLevel(row.proposed_risk_level)
  const storedReasons = decodeSuggestedChangeRiskReasons(row.proposed_risk_reasons_json)
  if (risk.level !== storedLevel
    || canonicalizeJson(risk.reasons) !== canonicalizeJson(storedReasons)) {
    throw new Error('Workbench SuggestedChange risk does not match its semantic diff')
  }
  boundedReference(row.origin_causation_id, 'SuggestedChange origin causation id')
  boundedReference(row.proposal_command_id, 'SuggestedChange proposal command id')
  positiveInteger(row.revision, 'SuggestedChange revision')
  suggestedChangePersistedState(row.persisted_state)
  const createdAt = canonicalInstant(row.created_at, 'SuggestedChange createdAt')
  const updatedAt = canonicalInstant(row.updated_at, 'SuggestedChange updatedAt')
  if (updatedAt < createdAt) throw new Error('Workbench SuggestedChange updatedAt precedes createdAt')
}

function decodeProjectResponsibilitySuggestedValue(
  json: string,
): ProjectResponsibilitySuggestedValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Workbench SuggestedChange candidate contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== json) {
    throw new Error('Workbench SuggestedChange candidate is not canonical JSON')
  }
  const record = exactStoredObject(parsed, 'SuggestedChange candidate', [
    'accountableMemberId', 'contributorMemberIds', 'humanSponsorMemberId',
  ])
  const contributors = decodeCanonicalContributorIds(record.contributorMemberIds)
  return Object.freeze({
    accountableMemberId: boundedReference(
      record.accountableMemberId,
      'SuggestedChange Accountable member id',
    ),
    contributorMemberIds: contributors,
    humanSponsorMemberId: record.humanSponsorMemberId === null
      ? null
      : boundedReference(
        record.humanSponsorMemberId,
        'SuggestedChange Human Sponsor member id',
      ),
  })
}

function decodeProjectResponsibilityReviewValue(
  value: unknown,
): ProjectResponsibilityReviewValue {
  const record = exactStoredObject(value, 'SuggestedChange Responsibility before value', [
    'accountableMemberId', 'contributorMemberIds', 'humanSponsorMemberId',
  ])
  return Object.freeze({
    accountableMemberId: record.accountableMemberId === null
      ? null
      : boundedReference(record.accountableMemberId, 'Review Accountable member id'),
    contributorMemberIds: decodeCanonicalContributorIds(record.contributorMemberIds),
    humanSponsorMemberId: record.humanSponsorMemberId === null
      ? null
      : boundedReference(record.humanSponsorMemberId, 'Review Human Sponsor member id'),
  })
}

function decodeProjectResponsibilitySuggestedValueFromValue(
  value: unknown,
): ProjectResponsibilitySuggestedValue {
  const record = exactStoredObject(value, 'SuggestedChange Responsibility after value', [
    'accountableMemberId', 'contributorMemberIds', 'humanSponsorMemberId',
  ])
  return Object.freeze({
    accountableMemberId: boundedReference(record.accountableMemberId, 'Review Accountable member id'),
    contributorMemberIds: decodeCanonicalContributorIds(record.contributorMemberIds),
    humanSponsorMemberId: record.humanSponsorMemberId === null
      ? null
      : boundedReference(record.humanSponsorMemberId, 'Review Human Sponsor member id'),
  })
}

function decodeCanonicalContributorIds(value: unknown): readonly string[] {
  const values = arrayValue(value, 'SuggestedChange Contributor ids')
  if (values.length > MAX_RESPONSIBILITY_CONTRIBUTORS) {
    throw new Error('Workbench SuggestedChange has too many Contributors')
  }
  const contributors = values.map(memberId =>
    boundedReference(memberId, 'SuggestedChange Contributor member id'))
  if (new Set(contributors).size !== contributors.length
    || contributors.some((memberId, index) => index > 0 && contributors[index - 1]! > memberId)) {
    throw new Error('Workbench SuggestedChange Contributor ids are not a canonical set')
  }
  return Object.freeze(contributors)
}

function decodeProjectResponsibilityReviewDiff(json: string): ProjectResponsibilityReviewDiff {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Workbench SuggestedChange diff contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== json) {
    throw new Error('Workbench SuggestedChange diff is not canonical JSON')
  }
  const record = exactStoredObject(parsed, 'SuggestedChange diff', [
    'kind', 'schemaVersion', 'before', 'after', 'changedFields', 'digest',
  ])
  if (record.kind !== 'project-responsibility.diff' || record.schemaVersion !== 1) {
    throw new Error('Workbench SuggestedChange diff schema is unsupported')
  }
  const before = decodeProjectResponsibilityReviewValue(record.before)
  const after = decodeProjectResponsibilitySuggestedValueFromValue(record.after)
  const expected = projectResponsibilityReviewDiff(before, after)
  const changedFields = arrayValue(record.changedFields, 'SuggestedChange changed fields')
  if (canonicalizeJson(changedFields) !== canonicalizeJson(expected.changedFields)
    || record.digest !== expected.digest) {
    throw new Error('Workbench SuggestedChange typed diff or digest is invalid')
  }
  return expected
}

function decodeSuggestedChangeRiskReasons(
  json: string,
  allowEmpty = false,
): readonly SuggestedChangeRiskReason[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Workbench SuggestedChange risk reasons contain invalid JSON')
  }
  if (canonicalizeJson(parsed) !== json || !Array.isArray(parsed)) {
    throw new Error('Workbench SuggestedChange risk reasons are not a canonical array')
  }
  if ((!allowEmpty && parsed.length < 1) || parsed.length > 2) {
    throw new Error('Workbench SuggestedChange risk reasons have an invalid count')
  }
  const reasons = parsed.map(reason => {
    if (reason !== 'initial-responsibility'
      && reason !== 'accountable-changed'
      && reason !== 'human-sponsor-changed'
      && reason !== 'contributors-only') {
      throw new Error('Workbench SuggestedChange risk reason is unsupported')
    }
    return reason
  })
  if (new Set(reasons).size !== reasons.length) {
    throw new Error('Workbench SuggestedChange risk reasons are duplicated')
  }
  return Object.freeze(reasons)
}

function suggestedChangeRiskLevel(value: unknown): SuggestedChangeRiskLevel {
  if (value !== 'low' && value !== 'high') {
    throw new Error('Workbench SuggestedChange risk level is unsupported')
  }
  return value
}

function suggestedChangePersistedState(value: unknown): SuggestedChangePersistedState {
  if (value !== 'pending' && value !== 'accepted'
    && value !== 'rejected' && value !== 'deferred') {
    throw new Error('Workbench SuggestedChange persisted state is unsupported')
  }
  return value
}

function suggestedChangeDecisionMode(value: unknown): SuggestedChangeDecisionMode {
  if (value !== 'accepted' && value !== 'edited-accepted'
    && value !== 'rejected' && value !== 'deferred') {
    throw new Error('Workbench SuggestedChange decision mode is unsupported')
  }
  return value
}

function suggestedChangeEffectiveStatus(
  row: Pick<SuggestedChangeRow, 'persisted_state' | 'base_team_revision'>,
  currentTeamRevision: number,
): ReviewCenterProjection['items'][number]['effectiveStatus'] {
  const persisted = suggestedChangePersistedState(row.persisted_state)
  return (persisted === 'pending' || persisted === 'deferred')
    && row.base_team_revision !== currentTeamRevision
    ? 'stale'
    : persisted
}

function readProjectDetailSync(
  database: DatabaseSync,
  query: WorkbenchProjectReadQuery,
): ProjectDetailProjection | null {
  const row = database.prepare(`
    SELECT project.id AS project_id, project.organization_id, project.team_id,
      project.name AS project_name, project.revision AS project_revision,
      project.catalog_sequence, project.timezone, project.created_at,
      project.primary_goal_id, goal.name AS primary_goal_name,
      goal.revision AS primary_goal_revision,
      project.template_id, project.template_version,
      project.template_definition_digest,
      snapshot.snapshot_schema_version, snapshot.snapshot_digest,
      snapshot.canonical_snapshot_json, snapshot.captured_at
    FROM workbench_project AS project
    INNER JOIN workbench_goal AS goal
      ON goal.organization_id = project.organization_id
      AND goal.team_id = project.team_id
      AND goal.id = project.primary_goal_id
    INNER JOIN workbench_project_template_snapshot AS snapshot
      ON snapshot.project_id = project.id
    WHERE project.organization_id = ? AND project.team_id = ? AND project.id = ?
  `).get(query.organizationId, query.teamId, query.projectId) as ProjectDetailRow | undefined
  if (row === undefined) return null
  const project = projectSummaryFromRow(row)
  const outcomes = readGoalOutcomes(database, row.primary_goal_id)
  const primaryGoal: GoalProjection = Object.freeze({
    ...project.primaryGoal,
    outcomes,
  })
  const supportingRows = database.prepare(`
    SELECT goal.id AS goal_id, goal.name, goal.revision, relation.ordinal,
      relation.linked_goal_revision
    FROM workbench_project_supporting_goal AS relation
    INNER JOIN workbench_goal AS goal
      ON goal.organization_id = relation.organization_id
      AND goal.team_id = relation.team_id
      AND goal.id = relation.goal_id
    WHERE relation.project_id = ?
    ORDER BY relation.ordinal
  `).all(row.project_id) as unknown as SupportingGoalRow[]
  if (supportingRows.length > MAX_SUPPORTING_GOALS) {
    throw new Error('Workbench Project contains too many Supporting Goals')
  }
  const supportingGoalValues: GoalSummaryProjection[] = []
  for (let index = 0; index < supportingRows.length; index += 1) {
    const supportingRow = supportingRows[index]
    if (supportingRow === undefined || supportingRow.ordinal !== index + 1) {
      throw new Error('Workbench Project contains invalid Supporting Goal ordinals')
    }
    if (supportingRow.linked_goal_revision !== supportingRow.revision) {
      throw new Error('Workbench Supporting Goal relation has a mismatched linked revision')
    }
    if (supportingRow.goal_id === row.primary_goal_id) {
      throw new Error('Workbench Project repeats its Primary Goal as a Supporting Goal')
    }
    supportingGoalValues.push(supportingGoalFromRow(supportingRow))
  }
  const supportingGoals = Object.freeze(supportingGoalValues)
  const templateSnapshot = templateSnapshotFromRow(row)
  if (row.organization_id !== query.organizationId || row.team_id !== query.teamId) {
    throw new Error('Workbench database returned a Project outside its requested scope')
  }
  if (row.captured_at !== row.created_at) {
    throw new Error('Workbench Project creation snapshot has a mismatched capture instant')
  }
  return Object.freeze({ project, primaryGoal, supportingGoals, templateSnapshot })
}

function readProjectTeamSync(
  database: DatabaseSync,
  query: WorkbenchProjectTeamReadQuery,
): ProjectTeamProjection | null {
  const head = readProjectTeamHead(database, query)
  if (head === null) return null
  const memberRows = database.prepare(`
    SELECT id, organization_id, team_id, project_id, kind, display_name, status,
      identity_type, feishu_app_id, feishu_open_id, external_method,
      external_value, revision, created_at, updated_at
    FROM workbench_project_member
    WHERE project_id = ? AND organization_id = ? AND team_id = ?
    ORDER BY created_at, id
  `).all(query.projectId, query.organizationId, query.teamId) as unknown as ProjectMemberRow[]
  if (memberRows.length > MAX_PROJECT_MEMBERS) {
    throw new Error('Workbench Project Team contains too many members')
  }
  const members = Object.freeze(memberRows.map((row) => {
    if (row.project_id !== query.projectId
      || row.organization_id !== query.organizationId
      || row.team_id !== query.teamId) {
      throw new Error('Workbench database returned a ProjectMember outside its Team scope')
    }
    return projectMemberFromRow(row)
  }))
  const responsibility = head.current_responsibility_revision === null
    ? null
    : readProjectResponsibility(
      database,
      head,
      head.current_responsibility_revision,
      true,
    )
  return projectTeamProjection({
    projectId: boundedReference(head.project_id, 'Project Team Project id'),
    teamRevision: positiveInteger(head.team_revision, 'Project Team revision', true),
    members,
    responsibility,
  })
}

function readProjectTeamHead(
  database: DatabaseSync,
  query: WorkbenchProjectTeamReadQuery | WorkbenchProjectMemberMutation
    | WorkbenchProjectMemberStatusMutation | WorkbenchProjectResponsibilityMutation,
): ProjectTeamHeadRow | null {
  const organizationId = 'command' in query
    ? query.command.actor.organizationId
    : query.organizationId
  const teamId = 'command' in query ? query.command.actor.teamId : query.teamId
  const row = database.prepare(`
    SELECT project_id, organization_id, team_id, team_revision,
      current_responsibility_revision, updated_at
    FROM workbench_project_team_head
    WHERE project_id = ? AND organization_id = ? AND team_id = ?
  `).get(query.projectId, organizationId, teamId) as ProjectTeamHeadRow | undefined
  if (row === undefined) return null
  projectTeamHeadValues(row)
  return row
}

function projectTeamHeadValues(row: ProjectTeamHeadRow): void {
  boundedReference(row.project_id, 'Project Team Project id')
  boundedReference(row.organization_id, 'Project Team organization id')
  boundedReference(row.team_id, 'Project Team team id')
  positiveInteger(row.team_revision, 'Project Team revision', true)
  if (row.current_responsibility_revision !== null) {
    positiveInteger(row.current_responsibility_revision, 'Project Responsibility revision')
  }
  canonicalInstant(row.updated_at, 'Project Team updatedAt')
}

function readProjectMember(
  database: DatabaseSync,
  projectId: string,
  memberId: string,
): ProjectMemberRow | null {
  const row = database.prepare(`
    SELECT id, organization_id, team_id, project_id, kind, display_name, status,
      identity_type, feishu_app_id, feishu_open_id, external_method,
      external_value, revision, created_at, updated_at
    FROM workbench_project_member WHERE project_id = ? AND id = ?
  `).get(projectId, memberId) as ProjectMemberRow | undefined
  if (row === undefined) return null
  projectMemberFromRow(row)
  return row
}

function projectMemberFromRow(row: ProjectMemberRow): ProjectMemberProjection {
  const memberId = boundedReference(row.id, 'ProjectMember id')
  const projectId = boundedReference(row.project_id, 'ProjectMember Project id')
  boundedReference(row.organization_id, 'ProjectMember organization id')
  boundedReference(row.team_id, 'ProjectMember team id')
  const kind = projectMemberKind(row.kind)
  const status = projectMemberStatus(row.status)
  const displayName = storedText(
    row.display_name,
    'ProjectMember display name',
    MAX_MEMBER_DISPLAY_NAME_LENGTH,
  )
  const revision = positiveInteger(row.revision, 'ProjectMember revision')
  const createdAt = canonicalInstant(row.created_at, 'ProjectMember createdAt')
  const updatedAt = canonicalInstant(row.updated_at, 'ProjectMember updatedAt')
  if (updatedAt < createdAt) throw new Error('ProjectMember updatedAt precedes createdAt')
  const base = {
    memberId,
    projectId,
    displayName,
    status,
    revision,
    createdAt,
    updatedAt,
  }
  if (kind === 'agent') {
    if (row.identity_type !== 'workbench-agent'
      || row.feishu_app_id !== null || row.feishu_open_id !== null
      || row.external_method !== null || row.external_value !== null) {
      throw new Error('Workbench Agent member contains invalid identity fields')
    }
    return Object.freeze({
      ...base,
      kind: 'agent',
      feishuAssigneeEligibility: status === 'inactive' ? 'inactive' : 'agent-not-assignable',
    })
  }
  if (row.identity_type === 'feishu') {
    if (row.feishu_app_id === null || row.feishu_open_id === null
      || row.external_method !== null || row.external_value !== null) {
      throw new Error('Workbench Feishu human contains invalid identity fields')
    }
    return Object.freeze({
      ...base,
      kind: 'human',
      identity: Object.freeze({
        type: 'feishu',
        appId: boundedReference(row.feishu_app_id, 'Feishu application id'),
        openId: boundedReference(row.feishu_open_id, 'Feishu open id'),
        state: 'declared',
      }),
      feishuAssigneeEligibility: status === 'inactive' ? 'inactive' : 'identifier-present',
    })
  }
  if (row.identity_type !== 'external'
    || row.external_method === null || row.external_value === null
    || row.feishu_app_id !== null || row.feishu_open_id !== null) {
    throw new Error('Workbench external human contains invalid identity fields')
  }
  const method = externalContactMethod(row.external_method)
  return Object.freeze({
    ...base,
    kind: 'human',
    identity: Object.freeze({
      type: 'external',
      method,
      value: storedText(row.external_value, 'External contact value', MAX_EXTERNAL_CONTACT_LENGTH),
    }),
    feishuAssigneeEligibility: status === 'inactive' ? 'inactive' : 'external-contact',
  })
}

function readProjectResponsibility(
  database: DatabaseSync,
  head: ProjectTeamHeadRow,
  revision: number,
  requireActive: boolean,
): ProjectResponsibilityProjection {
  const row = database.prepare(`
    SELECT project_id, organization_id, team_id, revision,
      accountable_member_id, human_sponsor_member_id, contributor_count, updated_at
    FROM workbench_project_responsibility_version
    WHERE project_id = ? AND revision = ?
  `).get(head.project_id, revision) as ProjectResponsibilityRow | undefined
  if (row === undefined) throw new Error('Workbench Project Team points to a missing Responsibility version')
  if (row.project_id !== head.project_id || row.organization_id !== head.organization_id
    || row.team_id !== head.team_id || row.revision !== revision) {
    throw new Error('Workbench Project Responsibility escaped its Team scope')
  }
  const contributorCount = positiveInteger(
    row.contributor_count,
    'Project Responsibility contributor count',
    true,
  )
  if (contributorCount > MAX_RESPONSIBILITY_CONTRIBUTORS) {
    throw new Error('Workbench Project Responsibility contains too many Contributors')
  }
  const contributorRows = database.prepare(`
    SELECT member_id, ordinal
    FROM workbench_project_responsibility_contributor
    WHERE project_id = ? AND responsibility_revision = ?
    ORDER BY ordinal
  `).all(head.project_id, revision) as unknown as ProjectResponsibilityContributorRow[]
  if (contributorRows.length !== contributorCount) {
    throw new Error('Workbench Project Responsibility contributor count is inconsistent')
  }
  const contributorIds: string[] = []
  for (let index = 0; index < contributorRows.length; index += 1) {
    const contributor = contributorRows[index]
    if (contributor === undefined || contributor.ordinal !== index + 1) {
      throw new Error('Workbench Project Responsibility contributor order is invalid')
    }
    contributorIds.push(boundedReference(contributor.member_id, 'Contributor member id'))
  }
  const accountableId = boundedReference(
    row.accountable_member_id,
    'Accountable member id',
  )
  const sponsorId = nullableString(row.human_sponsor_member_id, 'Human Sponsor member id')
  if (new Set(contributorIds).size !== contributorIds.length
    || contributorIds.includes(accountableId)) {
    throw new Error('Workbench Project Responsibility contains invalid Contributor identities')
  }
  const accountable = readProjectMember(database, head.project_id, accountableId)
  if (accountable === null) throw new Error('Workbench Project Responsibility lost its Accountable')
  const sponsor = sponsorId === null ? null : readProjectMember(database, head.project_id, sponsorId)
  if (sponsorId !== null && sponsor === null) {
    throw new Error('Workbench Project Responsibility lost its Human Sponsor')
  }
  for (const contributorId of contributorIds) {
    const contributor = readProjectMember(database, head.project_id, contributorId)
    if (contributor === null) throw new Error('Workbench Project Responsibility lost a Contributor')
    if (requireActive && contributor.status !== 'active') {
      throw new Error('Workbench current Project Responsibility contains an inactive Contributor')
    }
  }
  const sponsorRequired = accountable.kind === 'agent' || accountable.identity_type === 'external'
  if ((sponsorRequired && sponsor === null)
    || (!sponsorRequired && sponsor !== null)
    || (sponsor !== null && (sponsor.kind !== 'human' || sponsor.id === accountable.id))) {
    throw new Error('Workbench Project Responsibility violates its Human Sponsor policy')
  }
  if (requireActive && (accountable.status !== 'active'
    || (sponsor !== null && sponsor.status !== 'active'))) {
    throw new Error('Workbench current Project Responsibility contains an inactive role holder')
  }
  return Object.freeze({
    projectId: boundedReference(row.project_id, 'Project Responsibility Project id'),
    revision: positiveInteger(row.revision, 'Project Responsibility revision'),
    accountableMemberId: accountableId,
    contributorMemberIds: Object.freeze(contributorIds),
    humanSponsorMemberId: sponsorId,
    updatedAt: canonicalInstant(row.updated_at, 'Project Responsibility updatedAt'),
  })
}

function readGoalOutcomes(database: DatabaseSync, goalId: string): readonly OutcomeProjection[] {
  const rows = database.prepare(`
    SELECT id, goal_id, ordinal, name, metric_name, initial_value, target_value,
      unit, direction, revision, created_at, updated_at
    FROM workbench_outcome WHERE goal_id = ? ORDER BY ordinal
  `).all(goalId) as unknown as OutcomeRow[]
  if (rows.length < 1 || rows.length > MAX_PROJECT_OUTCOMES) {
    throw new Error('Workbench Goal must contain from 1 to 20 Outcomes')
  }
  const outcomes: OutcomeProjection[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row === undefined || row.goal_id !== goalId || row.ordinal !== index + 1) {
      throw new Error('Workbench Goal contains invalid Outcome ordinals')
    }
    outcomes.push(outcomeFromRow(row))
  }
  return Object.freeze(outcomes)
}

function projectSummaryFromRow(row: ProjectSummaryRow): ProjectSummaryProjection {
  const projectId = boundedReference(row.project_id, 'Project id')
  const primaryGoalId = boundedReference(row.primary_goal_id, 'Primary Goal id')
  const primaryGoal = Object.freeze({
    goalId: primaryGoalId,
    name: storedText(row.primary_goal_name, 'Primary Goal name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(row.primary_goal_revision, 'Primary Goal revision'),
  })
  return Object.freeze({
    projectId,
    name: storedText(row.project_name, 'Project name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(row.project_revision, 'Project revision'),
    catalogSequence: positiveInteger(row.catalog_sequence, 'Project catalog sequence'),
    timezone: storedText(row.timezone, 'Project timezone', 128),
    createdAt: canonicalInstant(row.created_at, 'Project createdAt'),
    primaryGoal,
  })
}

function goalSummaryFromRow(row: GoalRow): GoalSummaryProjection {
  if (row.state !== 'active' && row.state !== 'inactive') {
    throw new Error('Workbench database contains an invalid Goal state')
  }
  canonicalInstant(row.created_at, 'Goal createdAt')
  canonicalInstant(row.updated_at, 'Goal updatedAt')
  return Object.freeze({
    goalId: boundedReference(row.id, 'Goal id'),
    name: storedText(row.name, 'Goal name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(row.revision, 'Goal revision'),
  })
}

function supportingGoalFromRow(row: SupportingGoalRow): GoalSummaryProjection {
  positiveInteger(row.ordinal, 'Supporting Goal ordinal')
  return Object.freeze({
    goalId: boundedReference(row.goal_id, 'Supporting Goal id'),
    name: storedText(row.name, 'Supporting Goal name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(row.revision, 'Supporting Goal revision'),
  })
}

function outcomeFromRow(row: OutcomeRow): OutcomeProjection {
  const direction = metricDirection(row.direction)
  const metric: OutcomeMetric = Object.freeze({
    metricName: storedText(row.metric_name, 'Outcome metric name', MAX_METRIC_NAME_LENGTH),
    initialValue: finiteNumber(row.initial_value, 'Outcome initial value'),
    targetValue: finiteNumber(row.target_value, 'Outcome target value'),
    unit: storedText(row.unit, 'Outcome metric unit', MAX_METRIC_UNIT_LENGTH),
    direction,
  })
  assertMetricDirection(metric, 'Stored Outcome metric')
  canonicalInstant(row.created_at, 'Outcome createdAt')
  canonicalInstant(row.updated_at, 'Outcome updatedAt')
  return Object.freeze({
    outcomeId: boundedReference(row.id, 'Outcome id'),
    name: storedText(row.name, 'Outcome name', MAX_DOMAIN_NAME_LENGTH),
    metric,
    revision: positiveInteger(row.revision, 'Outcome revision'),
  })
}

function templateSnapshotFromRow(row: ProjectDetailRow): ProjectTemplateSnapshotProjection {
  if (row.template_id !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateId
    || row.template_version !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateVersion
    || row.template_definition_digest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1
    || row.snapshot_schema_version !== 1
    || row.snapshot_digest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1
    || row.canonical_snapshot_json !== KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1
    || contentDigest(row.canonical_snapshot_json) !== row.snapshot_digest) {
    throw new Error('Workbench Project creation snapshot failed identity validation')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.canonical_snapshot_json)
  } catch {
    throw new Error('Workbench Project creation snapshot contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== row.canonical_snapshot_json) {
    throw new Error('Workbench Project creation snapshot is not canonical JSON')
  }
  const template = knowledgeWorkTemplateProjection()
  return Object.freeze({
    template: template.selection,
    snapshotSchemaVersion: 1,
    definition: template.definition,
    snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    capturedAt: canonicalInstant(row.captured_at, 'Project snapshot capturedAt'),
  })
}

function assertValidProjectDomain(database: DatabaseSync): void {
  readCompiledTemplate(database)
  const catalog = readProjectCatalog(database)
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workbench_project) AS project_count,
      (SELECT COUNT(*) FROM workbench_goal) AS goal_count,
      (SELECT COUNT(*) FROM workbench_project_template_snapshot) AS snapshot_count,
      (SELECT COUNT(*) FROM workbench_project_team_head) AS team_count,
      COALESCE((SELECT MAX(catalog_sequence) FROM workbench_project), 0) AS max_sequence
  `).get()
  const projectCount = integerField(counts, 'project_count')
  const goalCount = integerField(counts, 'goal_count')
  const snapshotCount = integerField(counts, 'snapshot_count')
  const teamCount = integerField(counts, 'team_count')
  const maxSequence = integerField(counts, 'max_sequence')
  if (catalog.revision !== projectCount || catalog.revision !== maxSequence
    || goalCount !== projectCount || snapshotCount !== projectCount
    || teamCount !== projectCount) {
    throw new Error('Workbench Project catalog contains incomplete domain artifacts')
  }
  const projects = database.prepare(`
    SELECT id, organization_id, team_id, updated_at FROM workbench_project
    ORDER BY catalog_sequence
  `).all() as Array<{
    readonly id: string
    readonly organization_id: string
    readonly team_id: string
    readonly updated_at: string
  }>
  for (const project of projects) {
    const organizationId = boundedReference(project.organization_id, 'Project organization id')
    const teamId = boundedReference(project.team_id, 'Project team id')
    const projectId = boundedReference(project.id, 'Project id')
    canonicalInstant(project.updated_at, 'Project updatedAt')
    if (readProjectDetailSync(database, { organizationId, teamId, projectId }) === null) {
      throw new Error('Workbench Project is missing a reachable Goal or creation snapshot')
    }
  }
  const goals = database.prepare(`
    SELECT id, organization_id, team_id, name, revision, state, created_at, updated_at
    FROM workbench_goal ORDER BY id
  `).all() as unknown as GoalRow[]
  for (const goal of goals) {
    goalSummaryFromRow(goal)
    readGoalOutcomes(database, goal.id)
  }
  const duplicatePrimary = integerField(database.prepare(`
    SELECT COUNT(*) AS count
    FROM workbench_project_supporting_goal AS relation
    INNER JOIN workbench_project AS project ON project.id = relation.project_id
    WHERE relation.goal_id = project.primary_goal_id
  `).get(), 'count')
  if (duplicatePrimary !== 0) {
    throw new Error('Workbench Project repeats a Primary Goal as Supporting')
  }
  assertValidProjectTeams(database)
}

function assertValidProjectTeams(database: DatabaseSync): void {
  const heads = database.prepare(`
    SELECT head.project_id, head.organization_id, head.team_id,
      head.team_revision, head.current_responsibility_revision, head.updated_at,
      project.created_at AS project_created_at
    FROM workbench_project_team_head AS head
    INNER JOIN workbench_project AS project
      ON project.id = head.project_id
      AND project.organization_id = head.organization_id
      AND project.team_id = head.team_id
    ORDER BY head.project_id
  `).all() as unknown as Array<ProjectTeamHeadRow & { readonly project_created_at: string }>
  for (const head of heads) {
    projectTeamHeadValues(head)
    const projectCreatedAt = canonicalInstant(
      head.project_created_at,
      'Project Team Project createdAt',
    )
    if (head.updated_at < projectCreatedAt) {
      throw new Error('Workbench Project Team predates its Project')
    }
    const memberRows = database.prepare(`
      SELECT id, organization_id, team_id, project_id, kind, display_name, status,
        identity_type, feishu_app_id, feishu_open_id, external_method,
        external_value, revision, created_at, updated_at
      FROM workbench_project_member WHERE project_id = ? ORDER BY created_at, id
    `).all(head.project_id) as unknown as ProjectMemberRow[]
    if (memberRows.length > MAX_PROJECT_MEMBERS) {
      throw new Error('Workbench Project Team contains too many members')
    }
    for (const member of memberRows) {
      if (member.organization_id !== head.organization_id
        || member.team_id !== head.team_id || member.project_id !== head.project_id) {
        throw new Error('Workbench ProjectMember escaped its Project Team scope')
      }
      projectMemberFromRow(member)
      const statusEvents = integerField(database.prepare(`
        SELECT COUNT(*) AS count FROM workbench_audit_event
        WHERE command_type = ? AND project_id = ? AND object_id = ?
      `).get(PROJECT_MEMBER_STATUS_COMMAND_TYPE, head.project_id, member.id), 'count')
      if (member.revision !== statusEvents + 1) {
        throw new Error('Workbench ProjectMember revision does not match its status history')
      }
      const addReceipt = database.prepare(`
        SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
          receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
          audit.occurred_at
        FROM workbench_audit_event AS audit
        INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
        WHERE audit.command_type = ? AND audit.project_id = ? AND audit.object_id = ?
      `).get(
        PROJECT_MEMBER_COMMAND_TYPE,
        head.project_id,
        member.id,
      ) as (ReceiptRow & { readonly occurred_at: string }) | undefined
      if (addReceipt === undefined) {
        throw new Error('Workbench ProjectMember is missing its creation command')
      }
      const created = decodeProjectMemberResult(addReceipt.result_json, addReceipt)
      if (created.value.projectId !== head.project_id
        || created.value.memberId !== member.id
        || created.value.kind !== member.kind
        || created.value.status !== 'active'
        || member.created_at !== addReceipt.occurred_at) {
        throw new Error('Workbench ProjectMember does not match its creation command')
      }
      if (statusEvents === 0) {
        if (member.status !== 'active' || member.updated_at !== member.created_at) {
          throw new Error('Workbench new ProjectMember has an unexplained status')
        }
      } else {
        const latestStatus = database.prepare(`
          SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
            receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
            audit.occurred_at
          FROM workbench_audit_event AS audit
          INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
          WHERE audit.command_type = ? AND audit.project_id = ? AND audit.object_id = ?
          ORDER BY audit.sequence DESC LIMIT 1
        `).get(
          PROJECT_MEMBER_STATUS_COMMAND_TYPE,
          head.project_id,
          member.id,
        ) as (ReceiptRow & { readonly occurred_at: string }) | undefined
        if (latestStatus === undefined) {
          throw new Error('Workbench ProjectMember is missing its latest status command')
        }
        const status = decodeProjectMemberStatusResult(latestStatus.result_json, latestStatus)
        if (status.value.memberId !== member.id
          || status.value.kind !== member.kind
          || status.value.status !== member.status
          || status.value.memberRevision !== member.revision
          || member.updated_at !== latestStatus.occurred_at) {
          throw new Error('Workbench ProjectMember does not match its latest status command')
        }
      }
    }
    const responsibilityCount = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_project_responsibility_version
      WHERE project_id = ?
    `).get(head.project_id), 'count')
    if (head.current_responsibility_revision === null) {
      if (responsibilityCount !== 0) {
        throw new Error('Workbench Project Team has unselected Responsibility history')
      }
    } else {
      if (responsibilityCount !== head.current_responsibility_revision) {
        throw new Error('Workbench Project Responsibility history is not contiguous')
      }
      for (let revision = 1; revision <= head.current_responsibility_revision; revision += 1) {
        const responsibility = readProjectResponsibility(
          database,
          head,
          revision,
          revision === head.current_responsibility_revision,
        )
        const receipt = database.prepare(`
          SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
            receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
            audit.occurred_at
          FROM workbench_audit_event AS audit
          INNER JOIN workbench_command_receipt AS receipt ON receipt.audit_event_id = audit.id
          WHERE audit.command_type = ? AND audit.project_id = ?
            AND audit.object_version = ?
        `).get(
          PROJECT_RESPONSIBILITY_COMMAND_TYPE,
          head.project_id,
          revision,
        ) as (ReceiptRow & { readonly occurred_at: string }) | undefined
        if (receipt !== undefined) {
          const committed = decodeProjectResponsibilityResult(receipt.result_json, receipt)
          if (committed.value.projectId !== head.project_id
            || committed.value.responsibilityRevision !== revision
            || responsibility.updatedAt !== receipt.occurred_at) {
            throw new Error('Workbench Project Responsibility does not match its command')
          }
        } else {
          const accepted = database.prepare(`
            SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
              receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
              audit.occurred_at
            FROM workbench_suggested_change_decision AS decision
            INNER JOIN workbench_suggested_change AS suggested
              ON suggested.id = decision.suggested_change_id
            INNER JOIN workbench_command_receipt AS receipt
              ON receipt.command_id = decision.command_id
            INNER JOIN workbench_audit_event AS audit
              ON audit.id = receipt.audit_event_id
            WHERE suggested.project_id = ?
              AND decision.applied_responsibility_revision = ?
              AND decision.mode IN ('accepted', 'edited-accepted')
          `).get(
            head.project_id,
            revision,
          ) as (ReceiptRow & { readonly occurred_at: string }) | undefined
          if (accepted === undefined) {
            throw new Error('Workbench Project Responsibility is missing its command')
          }
          const committed = decodeSuggestedChangeDecisionResult(
            accepted.result_json,
            accepted,
          )
          if (committed.value.appliedResponsibilityRevision !== revision
            || responsibility.updatedAt !== accepted.occurred_at) {
            throw new Error('Workbench accepted Responsibility does not match its decision')
          }
        }
      }
    }
    const teamEvents = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_audit_event
      WHERE project_id = ? AND command_type IN (?, ?, ?, ?, ?)
    `).get(
      head.project_id,
      PROJECT_MEMBER_COMMAND_TYPE,
      PROJECT_MEMBER_STATUS_COMMAND_TYPE,
      PROJECT_RESPONSIBILITY_COMMAND_TYPE,
      SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
      SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
    ), 'count')
    if (head.team_revision !== teamEvents) {
      throw new Error('Workbench Project Team revision does not match its command history')
    }
    if (teamEvents === 0) {
      if (head.updated_at !== projectCreatedAt) {
        throw new Error('Workbench empty Project Team has an unexplained update instant')
      }
    } else {
      const latest = database.prepare(`
        SELECT occurred_at FROM workbench_audit_event
        WHERE project_id = ? AND command_type IN (?, ?, ?, ?, ?)
        ORDER BY sequence DESC LIMIT 1
      `).get(
        head.project_id,
        PROJECT_MEMBER_COMMAND_TYPE,
        PROJECT_MEMBER_STATUS_COMMAND_TYPE,
        PROJECT_RESPONSIBILITY_COMMAND_TYPE,
        SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
        SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
      ) as { readonly occurred_at: string } | undefined
      if (latest === undefined || head.updated_at !== latest.occurred_at) {
        throw new Error('Workbench Project Team does not match its latest command instant')
      }
    }
  }
}

function insertOutbox(
  database: DatabaseSync,
  mutation: WorkbenchStatusMutation,
  next: WorkbenchStatusSnapshot,
  payload: string,
): void {
  const result = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    mutation.command.outboxId, mutation.command.commandId,
    mutation.command.actor.organizationId, STATUS_OUTBOX_TOPIC,
    `workbench:${mutation.command.outboxId}`, STATUS_OBJECT_TYPE, next.id,
    next.revision, mutation.command.causationId, payload,
    mutation.command.occurredAt, mutation.command.occurredAt,
  )
  if (result.changes !== 1) throw new Error('Workbench Outbox intent was not inserted exactly once')
}

function insertAuditEvent(database: DatabaseSync, event: AuditEvent): void {
  const result = database.prepare(`
    INSERT INTO workbench_audit_event (
      sequence, id, occurred_at, actor_kind, actor_id, organization_id, team_id,
      project_id, action, reason_code, reason_detail, object_type, object_id,
      object_version, command_id, command_type, causation_id, outbox_id,
      outbox_state, outcome, summary_code, summary_fields_json, previous_hash,
      event_hash, canonical_envelope
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(event.sequence), event.auditId, event.occurredAt, event.actor.kind,
    event.actor.id, event.scope.organizationId, event.scope.teamId,
    event.scope.projectId, event.action, event.reason.code,
    null, event.object.type, event.object.id,
    Number(event.object.version), event.command.id, event.command.type,
    event.causation.id, event.outbox?.id ?? null, event.outbox?.state ?? null,
    event.outcome, event.summary.code, canonicalizeJson(event.summary.changedFields),
    event.previousHash, event.eventHash, event.canonicalEnvelope,
  )
  if (result.changes !== 1) throw new Error('Workbench audit event was not inserted exactly once')
}

/** Resolve every elapsed in-flight attempt to an explicit ambiguous outcome. */
function expireOutboxClaims(database: DatabaseSync, observedAt: string): void {
  database.prepare(`
    UPDATE workbench_outbox
    SET state = 'unknown', claim_token = NULL, lease_expires_at = NULL,
        updated_at = ?, error_code = 'lease-expired'
    WHERE state = 'pending' AND claim_token IS NOT NULL AND lease_expires_at <= ?
  `).run(observedAt, observedAt)
}

function readAuditHead(database: DatabaseSync): AuditHeadRow {
  const row = database.prepare(`
    SELECT sequence, head_hash FROM workbench_audit_head WHERE singleton = 1
  `).get() as AuditHeadRow | undefined
  if (row === undefined || !Number.isSafeInteger(row.sequence) || row.sequence < 0
    || typeof row.head_hash !== 'string') {
    throw new Error('Workbench database contains an invalid audit head')
  }
  auditHash(row.head_hash)
  return row
}

function readAuditEvents(database: DatabaseSync): readonly AuditEvent[] {
  const rows = database.prepare(`
    SELECT sequence, id, occurred_at, actor_kind, actor_id, organization_id,
      team_id, project_id, action, reason_code, reason_detail, object_type,
      object_id, object_version, command_id, command_type, causation_id,
      outbox_id, outbox_state, outcome, summary_code, summary_fields_json,
      previous_hash, event_hash, canonical_envelope
    FROM workbench_audit_event ORDER BY sequence
  `).all() as unknown as AuditRow[]
  return rows.map(row => auditEventFromRow(row))
}

function auditEventFromRow(row: AuditRow): AuditEvent {
  const changedFields = JSON.parse(stringValue(row.summary_fields_json, 'Audit summary fields')) as unknown
  if (!Array.isArray(changedFields)) throw new Error('Workbench database contains invalid audit summary fields')
  const reasonDetail = nullableString(row.reason_detail, 'Audit reason detail')
  const outboxId = nullableString(row.outbox_id, 'Audit Outbox id')
  const outboxStateValue = nullableString(row.outbox_state, 'Audit Outbox state')
  if (row.actor_kind !== 'owner' || reasonDetail !== null
    || row.outcome !== 'committed' || outboxId === null || outboxStateValue !== 'pending') {
    throw new Error('Workbench database contains unsupported audit fields')
  }
  const common = {
    sequence: String(positiveInteger(row.sequence, 'Audit sequence')),
    previousHash: auditHash(stringValue(row.previous_hash, 'Audit previous hash')),
    auditId: boundedReference(row.id, 'Audit id'),
    occurredAt: canonicalInstant(row.occurred_at, 'Audit occurredAt'),
    actor: { kind: 'owner' as const, id: boundedReference(row.actor_id, 'Audit actor id') },
    causation: { id: boundedReference(row.causation_id, 'Audit causation id') },
    outbox: { id: boundedReference(outboxId, 'Audit Outbox id'), state: outboxState(outboxStateValue) },
    outcome: 'committed' as const,
    eventHash: auditHash(stringValue(row.event_hash, 'Audit event hash')),
    canonicalEnvelope: stringValue(row.canonical_envelope, 'Audit canonical envelope'),
  }
  const organizationId = boundedReference(row.organization_id, 'Audit organization id')
  const teamId = boundedReference(row.team_id, 'Audit team id')
  const objectId = boundedReference(row.object_id, 'Audit object id')
  const objectVersion = String(positiveInteger(row.object_version, 'Audit object version'))
  const commandId = boundedReference(row.command_id, 'Audit command id')
  if (row.command_type === STATUS_COMMAND_TYPE) {
    if (row.action !== STATUS_AUDIT_ACTION || row.reason_code !== STATUS_REASON
      || row.object_type !== STATUS_OBJECT_TYPE || row.summary_code !== STATUS_SUMMARY
      || row.project_id !== null || changedFields.length !== 1 || changedFields[0] !== 'message') {
      throw new Error('Workbench database contains unsupported status audit fields')
    }
    return {
      ...common,
      action: STATUS_AUDIT_ACTION,
      scope: { organizationId, teamId, projectId: null },
      reason: { code: STATUS_REASON },
      object: { type: STATUS_OBJECT_TYPE, id: objectId, version: objectVersion },
      command: { id: commandId, type: STATUS_COMMAND_TYPE },
      summary: { code: STATUS_SUMMARY, changedFields: Object.freeze(['message']) },
    }
  }
  if (row.command_type === PROJECT_COMMAND_TYPE) {
    const projectId = nullableString(row.project_id, 'Audit Project id')
    const expectedFields = ['primaryGoal', 'outcomes', 'supportingGoals', 'templateSnapshot']
    if (row.action !== PROJECT_AUDIT_ACTION || row.reason_code !== PROJECT_REASON
      || row.object_type !== PROJECT_OBJECT_TYPE || row.summary_code !== PROJECT_SUMMARY
      || projectId === null || projectId !== objectId || changedFields.length !== expectedFields.length
      || changedFields.some((field, index) => field !== expectedFields[index])) {
      throw new Error('Workbench database contains unsupported Project audit fields')
    }
    return {
      ...common,
      action: PROJECT_AUDIT_ACTION,
      scope: { organizationId, teamId, projectId },
      reason: { code: PROJECT_REASON },
      object: { type: PROJECT_OBJECT_TYPE, id: objectId, version: objectVersion },
      command: { id: commandId, type: PROJECT_COMMAND_TYPE },
      summary: { code: PROJECT_SUMMARY, changedFields: Object.freeze(expectedFields) },
    }
  }
  if (row.command_type === PROJECT_MEMBER_COMMAND_TYPE
    || row.command_type === PROJECT_MEMBER_STATUS_COMMAND_TYPE
    || row.command_type === PROJECT_RESPONSIBILITY_COMMAND_TYPE) {
    const projectId = nullableString(row.project_id, 'Audit Project id')
    if (projectId === null) throw new Error('Workbench Project Team audit is missing Project scope')
    if (row.command_type === PROJECT_MEMBER_COMMAND_TYPE) {
      const expectedFields = ['member', 'teamRevision']
      if (row.action !== PROJECT_MEMBER_AUDIT_ACTION
        || row.reason_code !== PROJECT_MEMBER_REASON
        || row.object_type !== PROJECT_MEMBER_OBJECT_TYPE
        || row.summary_code !== PROJECT_MEMBER_SUMMARY
        || changedFields.length !== expectedFields.length
        || changedFields.some((field, index) => field !== expectedFields[index])) {
        throw new Error('Workbench database contains unsupported ProjectMember audit fields')
      }
      return {
        ...common,
        action: PROJECT_MEMBER_AUDIT_ACTION,
        scope: { organizationId, teamId, projectId },
        reason: { code: PROJECT_MEMBER_REASON },
        object: { type: PROJECT_MEMBER_OBJECT_TYPE, id: objectId, version: objectVersion },
        command: { id: commandId, type: PROJECT_MEMBER_COMMAND_TYPE },
        summary: { code: PROJECT_MEMBER_SUMMARY, changedFields: Object.freeze(expectedFields) },
      }
    }
    if (row.command_type === PROJECT_MEMBER_STATUS_COMMAND_TYPE) {
      const expectedFields = ['status', 'teamRevision']
      if (row.action !== PROJECT_MEMBER_STATUS_AUDIT_ACTION
        || row.reason_code !== PROJECT_MEMBER_STATUS_REASON
        || row.object_type !== PROJECT_MEMBER_OBJECT_TYPE
        || row.summary_code !== PROJECT_MEMBER_STATUS_SUMMARY
        || changedFields.length !== expectedFields.length
        || changedFields.some((field, index) => field !== expectedFields[index])) {
        throw new Error('Workbench database contains unsupported ProjectMember status audit fields')
      }
      return {
        ...common,
        action: PROJECT_MEMBER_STATUS_AUDIT_ACTION,
        scope: { organizationId, teamId, projectId },
        reason: { code: PROJECT_MEMBER_STATUS_REASON },
        object: { type: PROJECT_MEMBER_OBJECT_TYPE, id: objectId, version: objectVersion },
        command: { id: commandId, type: PROJECT_MEMBER_STATUS_COMMAND_TYPE },
        summary: {
          code: PROJECT_MEMBER_STATUS_SUMMARY,
          changedFields: Object.freeze(expectedFields),
        },
      }
    }
    const expectedFields = ['accountable', 'contributors', 'humanSponsor', 'teamRevision']
    if (row.action !== PROJECT_RESPONSIBILITY_AUDIT_ACTION
      || row.reason_code !== PROJECT_RESPONSIBILITY_REASON
      || row.object_type !== PROJECT_RESPONSIBILITY_OBJECT_TYPE
      || row.summary_code !== PROJECT_RESPONSIBILITY_SUMMARY
      || objectId !== projectId
      || changedFields.length !== expectedFields.length
      || changedFields.some((field, index) => field !== expectedFields[index])) {
      throw new Error('Workbench database contains unsupported Project Responsibility audit fields')
    }
    return {
      ...common,
      action: PROJECT_RESPONSIBILITY_AUDIT_ACTION,
      scope: { organizationId, teamId, projectId },
      reason: { code: PROJECT_RESPONSIBILITY_REASON },
      object: { type: PROJECT_RESPONSIBILITY_OBJECT_TYPE, id: objectId, version: objectVersion },
      command: { id: commandId, type: PROJECT_RESPONSIBILITY_COMMAND_TYPE },
      summary: { code: PROJECT_RESPONSIBILITY_SUMMARY, changedFields: Object.freeze(expectedFields) },
    }
  }
  const suggestedVocabulary = storedSuggestedChangeVocabulary(row.command_type)
  if (suggestedVocabulary !== null) {
    const projectId = nullableString(row.project_id, 'Audit Project id')
    if (projectId === null
      || row.action !== suggestedVocabulary.auditAction
      || row.reason_code !== suggestedVocabulary.reason
      || row.object_type !== SUGGESTED_CHANGE_OBJECT_TYPE
      || row.summary_code !== suggestedVocabulary.summaryCode
      || changedFields.length !== suggestedVocabulary.changedFields.length
      || changedFields.some((field, index) =>
        field !== suggestedVocabulary.changedFields[index])) {
      throw new Error('Workbench database contains unsupported SuggestedChange audit fields')
    }
    return {
      ...common,
      action: suggestedVocabulary.auditAction,
      scope: { organizationId, teamId, projectId },
      reason: { code: suggestedVocabulary.reason },
      object: {
        type: SUGGESTED_CHANGE_OBJECT_TYPE,
        id: objectId,
        version: objectVersion,
      },
      command: { id: commandId, type: suggestedVocabulary.commandType },
      summary: {
        code: suggestedVocabulary.summaryCode,
        changedFields: Object.freeze([...suggestedVocabulary.changedFields]),
      },
    }
  }
  throw new Error('Workbench database contains an unsupported audit command type')
}

function verifyAuditChainSync(database: DatabaseSync): WorkbenchAuditIntegrityProjection {
  try {
    const head = readAuditHead(database)
    const result = verifyAuditEvents(readAuditEvents(database), {
      eventCount: head.sequence,
      headHash: auditHash(head.head_hash),
    })
    return result.ok
      ? Object.freeze({
        valid: true, eventCount: result.eventCount, headHash: result.headHash, issue: null,
      })
      : Object.freeze({
        valid: false, eventCount: result.eventCount, headHash: result.headHash,
        issue: publicIntegrityIssue(result.failure.code),
      })
  } catch {
    return Object.freeze({
      valid: false, eventCount: 0, headHash: AUDIT_GENESIS_HASH, issue: 'invalid-event',
    })
  }
}

function assertValidAudit(database: DatabaseSync): void {
  const integrity = verifyAuditChainSync(database)
  if (!integrity.valid) {
    throw new Error(`Workbench database audit chain is invalid: ${String(integrity.issue)}`)
  }
}

function assertValidSuggestedChanges(database: DatabaseSync): void {
  const rows = database.prepare(`
    SELECT sequence, id, organization_id, team_id, project_id, source_actor_id,
      target_adapter, representation_schema_version, base_team_revision,
      base_responsibility_revision, candidate_json, proposed_diff_json,
      proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
      policy_version, origin_causation_id, proposal_command_id, revision,
      persisted_state, created_at, updated_at
    FROM workbench_suggested_change ORDER BY sequence
  `).all() as unknown as SuggestedChangeRow[]
  const proposalAuditCount = integerField(database.prepare(`
    SELECT COUNT(*) AS count FROM workbench_audit_event WHERE command_type = ?
  `).get(SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE), 'count')
  if (proposalAuditCount !== rows.length) {
    throw new Error('Workbench SuggestedChange proposals do not match their audit history')
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row === undefined || row.sequence !== index + 1) {
      throw new Error('Workbench SuggestedChange sequence is not contiguous')
    }
    validateSuggestedChangeRow(row)
    const head = readProjectTeamHead(database, {
      organizationId: row.organization_id,
      teamId: row.team_id,
      projectId: row.project_id,
    })
    if (head === null || row.base_team_revision > head.team_revision) {
      throw new Error('Workbench SuggestedChange base escaped its Project Team history')
    }
    const proposalAudit = database.prepare(`
      SELECT sequence, actor_id, organization_id, team_id, project_id, occurred_at,
        causation_id, object_id, object_version
      FROM workbench_audit_event WHERE command_id = ? AND command_type = ?
    `).get(
      row.proposal_command_id,
      SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
    ) as {
      readonly sequence: number
      readonly actor_id: string
      readonly organization_id: string
      readonly team_id: string
      readonly project_id: string | null
      readonly occurred_at: string
      readonly causation_id: string
      readonly object_id: string
      readonly object_version: number
    } | undefined
    if (proposalAudit === undefined
      || proposalAudit.actor_id !== row.source_actor_id
      || proposalAudit.organization_id !== row.organization_id
      || proposalAudit.team_id !== row.team_id
      || proposalAudit.project_id !== row.project_id
      || proposalAudit.occurred_at !== row.created_at
      || proposalAudit.causation_id !== row.origin_causation_id
      || proposalAudit.object_id !== row.id
      || proposalAudit.object_version !== 1) {
      throw new Error('Workbench SuggestedChange envelope does not match its proposal audit')
    }
    const baseTeamOrdinal = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_audit_event
      WHERE project_id = ? AND sequence < ?
        AND command_type IN (?, ?, ?, ?, ?)
    `).get(
      row.project_id,
      proposalAudit.sequence,
      PROJECT_MEMBER_COMMAND_TYPE,
      PROJECT_MEMBER_STATUS_COMMAND_TYPE,
      PROJECT_RESPONSIBILITY_COMMAND_TYPE,
      SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
      SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
    ), 'count')
    if (baseTeamOrdinal !== row.base_team_revision) {
      throw new Error('Workbench SuggestedChange base Team revision is not historical truth')
    }
    const baseResponsibilityOrdinal = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_audit_event
      WHERE project_id = ? AND sequence < ?
        AND command_type IN (?, ?, ?)
    `).get(
      row.project_id,
      proposalAudit.sequence,
      PROJECT_RESPONSIBILITY_COMMAND_TYPE,
      SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
      SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
    ), 'count')
    const historicalResponsibilityRevision = baseResponsibilityOrdinal === 0
      ? null
      : baseResponsibilityOrdinal
    if (row.base_responsibility_revision !== historicalResponsibilityRevision) {
      throw new Error(
        'Workbench SuggestedChange base Responsibility revision is not historical truth',
      )
    }
    const historicalBefore = responsibilityReviewValueAtRevision(
      database,
      head,
      row.base_responsibility_revision,
    )
    const candidate = decodeProjectResponsibilitySuggestedValue(row.candidate_json)
    const expectedDiff = projectResponsibilityReviewDiff(historicalBefore, candidate)
    const storedDiff = decodeProjectResponsibilityReviewDiff(row.proposed_diff_json)
    const expectedRisk = suggestedChangeRisk(historicalBefore, candidate)
    if (canonicalizeJson(expectedDiff) !== canonicalizeJson(storedDiff)
      || row.proposed_diff_digest !== expectedDiff.digest
      || row.proposed_risk_level !== expectedRisk.level
      || row.proposed_risk_reasons_json !== canonicalizeJson(expectedRisk.reasons)) {
      throw new Error('Workbench SuggestedChange review material is not bound to target history')
    }
    const evidenceRows = readSuggestedChangeEvidenceRows(database, row.id)
    for (const evidence of evidenceRows) {
      const audit = readAuditRow(database, evidence.audit_event_id)
      if (audit === null
        || audit.organization_id !== row.organization_id
        || audit.team_id !== row.team_id
        || audit.project_id !== row.project_id
        || audit.sequence >= proposalAudit.sequence) {
        throw new Error('Workbench SuggestedChange evidence escaped its Project')
      }
      auditEventFromRow(audit)
    }
    const decisions = database.prepare(`
      SELECT id, suggested_change_id, suggested_change_revision, mode, actor_id,
        feedback, applied_candidate_json, applied_diff_json, applied_risk_level,
        applied_risk_reasons_json, applied_team_revision,
        applied_responsibility_revision, causation_id, command_id,
        audit_event_id, outbox_id, decided_at
      FROM workbench_suggested_change_decision
      WHERE suggested_change_id = ? ORDER BY suggested_change_revision
    `).all(row.id) as unknown as SuggestedChangeDecisionRow[]
    if (decisions.length !== row.revision - 1) {
      throw new Error('Workbench SuggestedChange revision does not match decision history')
    }
    let state: SuggestedChangePersistedState = 'pending'
    let latestAt = row.created_at
    let deferred = false
    for (let decisionIndex = 0; decisionIndex < decisions.length; decisionIndex += 1) {
      const decision = decisions[decisionIndex]
      if (decision === undefined
        || decision.suggested_change_revision !== decisionIndex + 2) {
        throw new Error('Workbench SuggestedChange decision revisions are not contiguous')
      }
      const projection = suggestedChangeDecisionProjectionFromRow(decision, row.id)
      if (projection.decidedAt < latestAt) {
        throw new Error('Workbench SuggestedChange decisions are not time ordered')
      }
      latestAt = projection.decidedAt
      if (state === 'accepted' || state === 'rejected') {
        throw new Error('Workbench terminal SuggestedChange has a later decision')
      }
      const expectedCommandType = projection.mode === 'accepted'
        ? SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE
        : projection.mode === 'edited-accepted'
          ? SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE
          : projection.mode === 'rejected'
            ? SUGGESTED_CHANGE_REJECT_COMMAND_TYPE
            : SUGGESTED_CHANGE_DEFER_COMMAND_TYPE
      const receipt = database.prepare(`
        SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
        FROM workbench_command_receipt WHERE command_id = ?
      `).get(decision.command_id) as ReceiptRow | undefined
      if (receipt === undefined
        || receipt.command_type !== expectedCommandType
        || receipt.command_id !== decision.command_id
        || receipt.audit_event_id !== decision.audit_event_id
        || receipt.outbox_id !== decision.outbox_id) {
        throw new Error(
          'Workbench SuggestedChange decision does not match its formal command ledger',
        )
      }
      if (projection.mode === 'deferred') {
        if (state !== 'pending' || deferred) {
          throw new Error('Workbench SuggestedChange was deferred more than once')
        }
        deferred = true
        state = 'deferred'
        continue
      }
      if (projection.mode === 'rejected') {
        state = 'rejected'
        continue
      }
      const appliedCandidate = decodeProjectResponsibilitySuggestedValue(
        stringValue(decision.applied_candidate_json, 'Applied candidate JSON'),
      )
      if (projection.mode === 'accepted'
        && canonicalizeJson(appliedCandidate) !== canonicalizeJson(candidate)) {
        throw new Error(
          'Workbench accepted SuggestedChange does not apply its immutable proposal candidate',
        )
      }
      const appliedDiff = projectResponsibilityReviewDiff(historicalBefore, appliedCandidate)
      const storedAppliedDiff = decodeProjectResponsibilityReviewDiff(
        stringValue(decision.applied_diff_json, 'Applied diff JSON'),
      )
      const appliedRisk = suggestedChangeRisk(historicalBefore, appliedCandidate)
      if (canonicalizeJson(appliedDiff) !== canonicalizeJson(storedAppliedDiff)
        || decision.applied_risk_level !== appliedRisk.level
        || decision.applied_risk_reasons_json !== canonicalizeJson(appliedRisk.reasons)
        || decision.applied_team_revision !== row.base_team_revision + 1
        || decision.applied_responsibility_revision
          !== (row.base_responsibility_revision ?? 0) + 1) {
        throw new Error('Workbench accepted SuggestedChange has invalid applied target facts')
      }
      const appliedResponsibility = readProjectResponsibility(
        database,
        head,
        decision.applied_responsibility_revision,
        false,
      )
      if (canonicalizeJson({
        accountableMemberId: appliedResponsibility.accountableMemberId,
        contributorMemberIds: appliedResponsibility.contributorMemberIds,
        humanSponsorMemberId: appliedResponsibility.humanSponsorMemberId,
      }) !== canonicalizeJson(appliedCandidate)
        || appliedResponsibility.updatedAt !== decision.decided_at) {
        throw new Error('Workbench accepted SuggestedChange does not match Responsibility history')
      }
      const result = decodeSuggestedChangeDecisionResult(receipt.result_json, receipt)
      const effectiveRisk = maxSuggestedChangeRisk(
        suggestedChangeRiskLevel(row.proposed_risk_level),
        appliedRisk.level,
      )
      if (result.value.riskLevel !== effectiveRisk
        || result.value.appliedTeamRevision !== decision.applied_team_revision
        || result.value.appliedResponsibilityRevision
          !== decision.applied_responsibility_revision) {
        throw new Error('Workbench accepted SuggestedChange receipt downgraded applied risk or version')
      }
      state = 'accepted'
    }
    if (state !== row.persisted_state || latestAt !== row.updated_at) {
      throw new Error('Workbench SuggestedChange head does not match its decision history')
    }
  }
}

function responsibilityReviewValueAtRevision(
  database: DatabaseSync,
  head: ProjectTeamHeadRow,
  revision: number | null,
): ProjectResponsibilityReviewValue {
  if (revision === null) {
    return Object.freeze({
      accountableMemberId: null,
      contributorMemberIds: Object.freeze([]),
      humanSponsorMemberId: null,
    })
  }
  const responsibility = readProjectResponsibility(database, head, revision, false)
  return Object.freeze({
    accountableMemberId: responsibility.accountableMemberId,
    contributorMemberIds: Object.freeze([...responsibility.contributorMemberIds]),
    humanSponsorMemberId: responsibility.humanSponsorMemberId,
  })
}

function assertValidLedger(database: DatabaseSync): void {
  assertValidProjectDomain(database)
  assertValidAudit(database)
  assertValidSuggestedChanges(database)
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workbench_audit_event) AS audit_count,
      (SELECT COUNT(*) FROM workbench_outbox) AS outbox_count,
      (SELECT COUNT(*) FROM workbench_command_receipt) AS receipt_count
  `).get()
  const auditCount = integerField(counts, 'audit_count')
  const outboxCount = integerField(counts, 'outbox_count')
  const receiptCount = integerField(counts, 'receipt_count')
  if (auditCount !== outboxCount || auditCount !== receiptCount) {
    throw new Error('Workbench command ledger contains incomplete durable artifacts')
  }

  const rows = database.prepare(`
    SELECT receipt.command_type, receipt.request_hash, receipt.command_id,
      receipt.audit_event_id, receipt.outbox_id, receipt.result_json,
      receipt.organization_id AS receipt_organization_id,
      receipt.actor_id AS receipt_actor_id,
      receipt.idempotency_key_hash, receipt.committed_at,
      audit.object_id AS audit_object_id,
      audit.sequence AS audit_sequence,
      audit.object_version AS audit_object_version,
      audit.occurred_at AS audit_occurred_at,
      audit.causation_id AS audit_causation_id,
      audit.command_id AS audit_command_id,
      audit.outbox_id AS audit_outbox_id,
      audit.action AS audit_action,
      audit.actor_id AS audit_actor_id,
      audit.reason_code AS audit_reason_code,
      audit.object_type AS audit_object_type,
      audit.project_id AS audit_project_id,
      audit.organization_id AS audit_organization_id,
      audit.team_id AS audit_team_id,
      audit.summary_code AS audit_summary_code,
      outbox.command_id AS outbox_command_id,
      outbox.organization_id AS outbox_organization_id,
      outbox.topic AS outbox_topic,
      outbox.project_id AS outbox_project_id,
      outbox.object_type AS outbox_object_type,
      outbox.object_id AS outbox_object_id,
      outbox.object_version AS outbox_object_version,
      outbox.causation_id AS outbox_causation_id,
      outbox.payload_json AS outbox_payload_json
    FROM workbench_command_receipt AS receipt
    INNER JOIN workbench_audit_event AS audit ON audit.id = receipt.audit_event_id
    INNER JOIN workbench_outbox AS outbox ON outbox.id = receipt.outbox_id
  `).all() as unknown as ReceiptIntegrityRow[]
  if (rows.length !== receiptCount) {
    throw new Error('Workbench command ledger contains broken durable references')
  }
  for (const row of rows) assertValidCommandReceipt(database, row)
}

function assertValidCommandReceipt(database: DatabaseSync, row: ReceiptIntegrityRow): void {
  positiveInteger(row.audit_sequence, 'Audit sequence')
  if (!SHA256_HEX.test(row.request_hash)
    || !SHA256_HEX.test(row.idempotency_key_hash)
    || row.command_id !== row.audit_command_id
    || row.command_id !== row.outbox_command_id
    || row.outbox_id !== row.audit_outbox_id
    || row.committed_at !== row.audit_occurred_at
    || row.outbox_causation_id !== row.audit_causation_id
    || row.outbox_object_id !== row.audit_object_id
    || row.outbox_object_version !== row.audit_object_version
    || row.receipt_organization_id !== row.audit_organization_id
    || row.receipt_organization_id !== row.outbox_organization_id
    || row.receipt_actor_id !== row.audit_actor_id) {
    throw new Error('Workbench command receipt does not match its audit and Outbox facts')
  }
  if (row.command_type === STATUS_COMMAND_TYPE) {
    assertValidStatusReceipt(row)
    return
  }
  if (row.command_type === PROJECT_COMMAND_TYPE) {
    assertValidProjectReceipt(row)
    return
  }
  if (row.command_type === PROJECT_MEMBER_COMMAND_TYPE) {
    assertValidProjectMemberReceipt(database, row)
    return
  }
  if (row.command_type === PROJECT_MEMBER_STATUS_COMMAND_TYPE) {
    assertValidProjectMemberStatusReceipt(database, row)
    return
  }
  if (row.command_type === PROJECT_RESPONSIBILITY_COMMAND_TYPE) {
    assertValidProjectResponsibilityReceipt(database, row)
    return
  }
  if (storedSuggestedChangeVocabulary(row.command_type) !== null) {
    assertValidSuggestedChangeReceipt(database, row)
    return
  }
  throw new Error('Workbench command receipt has an unsupported command type')
}

function assertValidStatusReceipt(row: ReceiptIntegrityRow): void {
  if (row.audit_action !== STATUS_AUDIT_ACTION || row.audit_reason_code !== STATUS_REASON
    || row.audit_object_type !== STATUS_OBJECT_TYPE || row.audit_project_id !== null
    || row.audit_summary_code !== STATUS_SUMMARY || row.outbox_topic !== STATUS_OUTBOX_TOPIC
    || row.outbox_project_id !== null || row.outbox_object_type !== STATUS_OBJECT_TYPE) {
    throw new Error('Workbench status receipt has mismatched audit or Outbox vocabulary')
  }
  const decoded = decodeCommittedResult(row.result_json, row)
  if (!decoded.ok) throw new Error('Workbench status command receipt is not committed')
  if (decoded.value.id !== row.audit_object_id
    || decoded.value.revision !== row.audit_object_version
    || decoded.value.updatedAt !== row.audit_occurred_at) {
    throw new Error('Workbench status command receipt projection does not match its audit object')
  }
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: STATUS_COMMAND_TYPE,
    target: STATUS_OBJECT_TYPE,
    message: decoded.value.message,
    expectedRevision: decoded.value.revision === 1 ? null : decoded.value.revision - 1,
    reason: STATUS_REASON,
    causationId: row.audit_causation_id,
  }))
  const expectedPayload = canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    statusId: decoded.value.id,
    statusRevision: decoded.value.revision,
    causationId: row.audit_causation_id,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error('Workbench status command receipt does not match its request hash or Outbox intent')
  }
}

function assertValidProjectReceipt(row: ReceiptIntegrityRow): void {
  if (row.audit_action !== PROJECT_AUDIT_ACTION || row.audit_reason_code !== PROJECT_REASON
    || row.audit_object_type !== PROJECT_OBJECT_TYPE || row.audit_summary_code !== PROJECT_SUMMARY
    || row.audit_project_id === null || row.audit_project_id !== row.audit_object_id
    || row.outbox_topic !== PROJECT_OUTBOX_TOPIC
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== PROJECT_OBJECT_TYPE) {
    throw new Error('Workbench Project receipt has mismatched audit or Outbox vocabulary')
  }
  const decoded = decodeCommittedProjectResult(row.result_json, row)
  if (!decoded.ok) throw new Error('Workbench Project command receipt is not committed')
  const detail = decoded.value
  if (detail.project.projectId !== row.audit_object_id
    || detail.project.revision !== row.audit_object_version
    || detail.project.revision !== 1
    || detail.project.createdAt !== row.audit_occurred_at
    || detail.project.catalogSequence !== decoded.catalogRevision
    || detail.primaryGoal.revision !== 1
    || detail.primaryGoal.outcomes.some(outcome => outcome.revision !== 1)
    || detail.templateSnapshot.capturedAt !== row.audit_occurred_at
    || detail.templateSnapshot.snapshotDigest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1
    || !isKnowledgeWorkTemplateSelection(detail.templateSnapshot.template)) {
    throw new Error('Workbench Project receipt projection does not match its audit object')
  }
  const expectedRequestHash = projectRequestHashFromResult(
    decoded,
    row.audit_organization_id,
    row.audit_team_id,
    row.audit_causation_id,
  )
  const expectedPayload = canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    projectId: detail.project.projectId,
    projectRevision: detail.project.revision,
    primaryGoalId: detail.primaryGoal.goalId,
    primaryGoalRevision: detail.primaryGoal.revision,
    templateId: detail.templateSnapshot.template.templateId,
    templateVersion: detail.templateSnapshot.template.templateVersion,
    templateDefinitionDigest: detail.templateSnapshot.template.definitionDigest,
    outcomeCount: detail.primaryGoal.outcomes.length,
    supportingGoalCount: detail.supportingGoals.length,
    catalogRevision: decoded.catalogRevision,
    causationId: row.audit_causation_id,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error('Workbench Project command receipt does not match its request hash or Outbox intent')
  }
}

function assertValidProjectMemberReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  if (row.audit_action !== PROJECT_MEMBER_AUDIT_ACTION
    || row.audit_reason_code !== PROJECT_MEMBER_REASON
    || row.audit_object_type !== PROJECT_MEMBER_OBJECT_TYPE
    || row.audit_summary_code !== PROJECT_MEMBER_SUMMARY
    || row.audit_project_id === null
    || row.outbox_topic !== PROJECT_MEMBER_OUTBOX_TOPIC
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== PROJECT_MEMBER_OBJECT_TYPE) {
    throw new Error('Workbench ProjectMember receipt has mismatched audit or Outbox vocabulary')
  }
  const decoded = decodeProjectMemberResult(row.result_json, row)
  if (decoded.value.projectId !== row.audit_project_id
    || decoded.value.memberId !== row.audit_object_id
    || decoded.value.memberId !== row.outbox_object_id
    || decoded.value.memberRevision !== row.audit_object_version
    || decoded.value.memberRevision !== 1) {
    throw new Error('Workbench ProjectMember receipt does not match its audit object')
  }
  assertTeamCommandOrdinal(database, row, decoded.value.teamRevision)
  const member = readProjectMember(database, decoded.value.projectId, decoded.value.memberId)
  if (member === null) throw new Error('Workbench ProjectMember receipt lost its member')
  if (decoded.value.kind !== projectMemberKind(member.kind)
    || decoded.value.status !== 'active') {
    throw new Error('Workbench ProjectMember receipt changed its immutable member kind or initial status')
  }
  const memberDraft = member.kind === 'agent'
    ? {
      kind: 'agent' as const,
      displayName: member.display_name,
    }
    : member.identity_type === 'feishu'
      ? {
        kind: 'human' as const,
        displayName: member.display_name,
        identity: {
          type: 'feishu' as const,
          appId: member.feishu_app_id,
          openId: member.feishu_open_id,
        },
      }
      : {
        kind: 'human' as const,
        displayName: member.display_name,
        identity: {
          type: 'external' as const,
          method: member.external_method,
          value: member.external_value,
        },
      }
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: PROJECT_MEMBER_COMMAND_TYPE,
    target: PROJECT_MEMBER_OBJECT_TYPE,
    scope: {
      organizationId: row.audit_organization_id,
      teamId: row.audit_team_id,
      projectId: decoded.value.projectId,
    },
    member: memberDraft,
    expectedTeamRevision: decoded.value.teamRevision - 1,
    expectedRevision: null,
    reason: PROJECT_MEMBER_REASON,
    causationId: row.audit_causation_id,
  }))
  const expectedPayload = projectTeamOutboxPayload(row, {
    projectId: decoded.value.projectId,
    memberId: decoded.value.memberId,
    memberKind: decoded.value.kind,
    memberStatus: decoded.value.status,
    memberRevision: decoded.value.memberRevision,
    teamRevision: decoded.value.teamRevision,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error(
      'Workbench ProjectMember receipt does not match its request hash or redacted Outbox intent',
    )
  }
}

function assertValidProjectMemberStatusReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  if (row.audit_action !== PROJECT_MEMBER_STATUS_AUDIT_ACTION
    || row.audit_reason_code !== PROJECT_MEMBER_STATUS_REASON
    || row.audit_object_type !== PROJECT_MEMBER_OBJECT_TYPE
    || row.audit_summary_code !== PROJECT_MEMBER_STATUS_SUMMARY
    || row.audit_project_id === null
    || row.outbox_topic !== PROJECT_MEMBER_STATUS_OUTBOX_TOPIC
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== PROJECT_MEMBER_OBJECT_TYPE) {
    throw new Error('Workbench ProjectMember status receipt has mismatched audit or Outbox vocabulary')
  }
  const decoded = decodeProjectMemberStatusResult(row.result_json, row)
  if (decoded.value.projectId !== row.audit_project_id
    || decoded.value.memberId !== row.audit_object_id
    || decoded.value.memberId !== row.outbox_object_id
    || decoded.value.memberRevision !== row.audit_object_version
    || decoded.value.memberRevision < 2) {
    throw new Error('Workbench ProjectMember status receipt does not match its audit object')
  }
  assertTeamCommandOrdinal(database, row, decoded.value.teamRevision)
  const memberStatusOrdinal = integerField(database.prepare(`
    SELECT COUNT(*) AS count FROM workbench_audit_event
    WHERE command_type = ? AND project_id = ? AND object_id = ? AND sequence <= ?
  `).get(
    PROJECT_MEMBER_STATUS_COMMAND_TYPE,
    decoded.value.projectId,
    decoded.value.memberId,
    row.audit_sequence,
  ), 'count')
  if (decoded.value.memberRevision !== memberStatusOrdinal + 1) {
    throw new Error('Workbench ProjectMember status receipt has an invalid member revision')
  }
  const member = readProjectMember(database, decoded.value.projectId, decoded.value.memberId)
  if (member === null) throw new Error('Workbench ProjectMember status receipt lost its member')
  const expectedStatus = decoded.value.memberRevision % 2 === 0 ? 'inactive' : 'active'
  if (decoded.value.kind !== projectMemberKind(member.kind)
    || decoded.value.status !== expectedStatus) {
    throw new Error(
      'Workbench ProjectMember status receipt changed its immutable kind or transition sequence',
    )
  }
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: PROJECT_MEMBER_STATUS_COMMAND_TYPE,
    target: PROJECT_MEMBER_OBJECT_TYPE,
    scope: {
      organizationId: row.audit_organization_id,
      teamId: row.audit_team_id,
      projectId: decoded.value.projectId,
    },
    memberId: decoded.value.memberId,
    status: decoded.value.status,
    expectedTeamRevision: decoded.value.teamRevision - 1,
    expectedMemberRevision: decoded.value.memberRevision - 1,
    reason: PROJECT_MEMBER_STATUS_REASON,
    causationId: row.audit_causation_id,
  }))
  const expectedPayload = projectTeamOutboxPayload(row, {
    projectId: decoded.value.projectId,
    memberId: decoded.value.memberId,
    memberKind: decoded.value.kind,
    memberStatus: decoded.value.status,
    memberRevision: decoded.value.memberRevision,
    teamRevision: decoded.value.teamRevision,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error(
      'Workbench ProjectMember status receipt does not match its request hash or redacted Outbox intent',
    )
  }
}

function assertValidProjectResponsibilityReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  if (row.audit_action !== PROJECT_RESPONSIBILITY_AUDIT_ACTION
    || row.audit_reason_code !== PROJECT_RESPONSIBILITY_REASON
    || row.audit_object_type !== PROJECT_RESPONSIBILITY_OBJECT_TYPE
    || row.audit_summary_code !== PROJECT_RESPONSIBILITY_SUMMARY
    || row.audit_project_id === null
    || row.audit_object_id !== row.audit_project_id
    || row.outbox_topic !== PROJECT_RESPONSIBILITY_OUTBOX_TOPIC
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== PROJECT_RESPONSIBILITY_OBJECT_TYPE) {
    throw new Error(
      'Workbench Project Responsibility receipt has mismatched audit or Outbox vocabulary',
    )
  }
  const decoded = decodeProjectResponsibilityResult(row.result_json, row)
  if (decoded.value.projectId !== row.audit_project_id
    || decoded.value.projectId !== row.outbox_object_id
    || decoded.value.responsibilityRevision !== row.audit_object_version) {
    throw new Error('Workbench Project Responsibility receipt does not match its audit object')
  }
  assertTeamCommandOrdinal(database, row, decoded.value.teamRevision)
  const responsibilityOrdinal = integerField(database.prepare(`
    SELECT COUNT(*) AS count FROM workbench_audit_event
    WHERE command_type IN (?, ?, ?) AND project_id = ? AND sequence <= ?
  `).get(
    PROJECT_RESPONSIBILITY_COMMAND_TYPE,
    SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
    SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
    decoded.value.projectId,
    row.audit_sequence,
  ), 'count')
  if (decoded.value.responsibilityRevision !== responsibilityOrdinal) {
    throw new Error('Workbench Project Responsibility receipt has an invalid revision')
  }
  const head = readProjectTeamHead(database, {
    organizationId: row.audit_organization_id,
    teamId: row.audit_team_id,
    projectId: decoded.value.projectId,
  })
  if (head === null) throw new Error('Workbench Project Responsibility receipt lost its Team')
  const responsibility = readProjectResponsibility(
    database,
    head,
    decoded.value.responsibilityRevision,
    false,
  )
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: PROJECT_RESPONSIBILITY_COMMAND_TYPE,
    target: PROJECT_RESPONSIBILITY_OBJECT_TYPE,
    scope: {
      organizationId: row.audit_organization_id,
      teamId: row.audit_team_id,
      projectId: decoded.value.projectId,
    },
    accountableMemberId: responsibility.accountableMemberId,
    contributorMemberIds: responsibility.contributorMemberIds,
    humanSponsorMemberId: responsibility.humanSponsorMemberId,
    expectedTeamRevision: decoded.value.teamRevision - 1,
    expectedResponsibilityRevision: decoded.value.responsibilityRevision === 1
      ? null
      : decoded.value.responsibilityRevision - 1,
    reason: PROJECT_RESPONSIBILITY_REASON,
    causationId: row.audit_causation_id,
  }))
  const expectedPayload = projectTeamOutboxPayload(row, {
    projectId: decoded.value.projectId,
    responsibilityRevision: decoded.value.responsibilityRevision,
    teamRevision: decoded.value.teamRevision,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error(
      'Workbench Project Responsibility receipt does not match its request hash or redacted Outbox intent',
    )
  }
}

function assertValidSuggestedChangeReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  const vocabulary = storedSuggestedChangeVocabulary(row.command_type)
  if (vocabulary === null
    || row.audit_action !== vocabulary.auditAction
    || row.audit_reason_code !== vocabulary.reason
    || row.audit_object_type !== SUGGESTED_CHANGE_OBJECT_TYPE
    || row.audit_summary_code !== vocabulary.summaryCode
    || row.audit_project_id === null
    || row.outbox_topic !== vocabulary.outboxTopic
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== SUGGESTED_CHANGE_OBJECT_TYPE
    || row.outbox_object_id !== row.audit_object_id) {
    throw new Error('Workbench SuggestedChange receipt has mismatched audit or Outbox vocabulary')
  }
  if (row.command_type === SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE) {
    const suggested = database.prepare(`
      SELECT sequence, id, organization_id, team_id, project_id, source_actor_id,
        target_adapter, representation_schema_version, base_team_revision,
        base_responsibility_revision, candidate_json, proposed_diff_json,
        proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
        policy_version, origin_causation_id, proposal_command_id, revision,
        persisted_state, created_at, updated_at
      FROM workbench_suggested_change WHERE proposal_command_id = ?
    `).get(row.command_id) as SuggestedChangeRow | undefined
    if (suggested === undefined) {
      throw new Error('Workbench SuggestedChange proposal receipt lost its envelope')
    }
    validateSuggestedChangeRow(suggested)
    const decoded = decodeSuggestedChangeProposalResult(row.result_json, row)
    if (decoded.value.suggestedChangeId !== suggested.id
      || decoded.value.baseTargetVersion !== suggested.base_team_revision
      || decoded.value.riskLevel !== suggested.proposed_risk_level
      || row.audit_object_id !== suggested.id
      || row.audit_object_version !== 1
      || suggested.source_actor_id !== row.audit_actor_id
      || suggested.organization_id !== row.audit_organization_id
      || suggested.team_id !== row.audit_team_id
      || suggested.project_id !== row.audit_project_id
      || suggested.created_at !== row.audit_occurred_at
      || suggested.origin_causation_id !== row.audit_causation_id) {
      throw new Error('Workbench SuggestedChange proposal receipt does not match its envelope')
    }
    const candidate = decodeProjectResponsibilitySuggestedValue(suggested.candidate_json)
    const evidenceRefs = readSuggestedChangeEvidenceRows(database, suggested.id).map(evidence => ({
      kind: 'workbench-audit-event' as const,
      auditEventId: evidence.audit_event_id,
    }))
    const expectedRequestHash = digest(canonicalizeJson({
      commandType: SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
      target: SUGGESTED_CHANGE_TARGET_ADAPTER,
      scope: {
        organizationId: suggested.organization_id,
        teamId: suggested.team_id,
        projectId: suggested.project_id,
      },
      candidate,
      evidenceRefs,
      expectedTeamRevision: suggested.base_team_revision,
      expectedRevision: null,
      reason: SUGGESTED_CHANGE_PROPOSAL_REASON,
      causationId: suggested.origin_causation_id,
    }))
    const expectedPayload = suggestedChangeOutboxPayload(row, {
      projectId: suggested.project_id,
      suggestedChangeId: suggested.id,
      suggestedChangeRevision: 1,
      riskLevel: suggested.proposed_risk_level,
    })
    if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
      throw new Error('Workbench SuggestedChange proposal receipt has invalid redacted ledger facts')
    }
    return
  }

  const decision = database.prepare(`
    SELECT id, suggested_change_id, suggested_change_revision, mode, actor_id,
      feedback, applied_candidate_json, applied_diff_json, applied_risk_level,
      applied_risk_reasons_json, applied_team_revision,
      applied_responsibility_revision, causation_id, command_id,
      audit_event_id, outbox_id, decided_at
    FROM workbench_suggested_change_decision WHERE command_id = ?
  `).get(row.command_id) as SuggestedChangeDecisionRow | undefined
  if (decision === undefined) {
    throw new Error('Workbench SuggestedChange decision receipt lost its decision')
  }
  const suggested = database.prepare(`
    SELECT sequence, id, organization_id, team_id, project_id, source_actor_id,
      target_adapter, representation_schema_version, base_team_revision,
      base_responsibility_revision, candidate_json, proposed_diff_json,
      proposed_diff_digest, proposed_risk_level, proposed_risk_reasons_json,
      policy_version, origin_causation_id, proposal_command_id, revision,
      persisted_state, created_at, updated_at
    FROM workbench_suggested_change WHERE id = ?
  `).get(decision.suggested_change_id) as SuggestedChangeRow | undefined
  if (suggested === undefined) throw new Error('Workbench SuggestedChange decision lost its envelope')
  validateSuggestedChangeRow(suggested)
  const projection = suggestedChangeDecisionProjectionFromRow(decision, suggested.id)
  const decoded = decodeSuggestedChangeDecisionResult(row.result_json, row)
  if (decoded.value.suggestedChangeId !== suggested.id
    || decoded.value.suggestedChangeRevision !== decision.suggested_change_revision
    || decoded.value.decisionMode !== decision.mode
    || decoded.value.appliedTeamRevision !== decision.applied_team_revision
    || decoded.value.appliedResponsibilityRevision !== decision.applied_responsibility_revision
    || row.audit_object_id !== suggested.id
    || row.audit_object_version !== decision.suggested_change_revision
    || decision.actor_id !== row.audit_actor_id
    || decision.audit_event_id !== row.audit_event_id
    || decision.outbox_id !== row.outbox_id
    || decision.decided_at !== row.audit_occurred_at
    || decision.causation_id !== row.audit_causation_id
    || suggested.project_id !== row.audit_project_id) {
    throw new Error('Workbench SuggestedChange decision receipt does not match its history')
  }
  const requestMode = row.command_type === SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE
    ? 'accept'
    : row.command_type === SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE
      ? 'edit-and-accept'
      : row.command_type === SUGGESTED_CHANGE_REJECT_COMMAND_TYPE ? 'reject' : 'defer'
  const expectedRequestHash = digest(canonicalizeJson({
    commandType: row.command_type,
    target: SUGGESTED_CHANGE_OBJECT_TYPE,
    scope: {
      organizationId: row.audit_organization_id,
      teamId: row.audit_team_id,
      projectId: suggested.project_id,
    },
    suggestedChangeId: suggested.id,
    expectedSuggestedChangeRevision: decision.suggested_change_revision - 1,
    mode: requestMode,
    feedback: decision.feedback,
    ...(requestMode === 'accept' || requestMode === 'edit-and-accept'
      ? { acknowledgedRiskLevel: decoded.value.riskLevel }
      : {}),
    ...(requestMode === 'edit-and-accept'
      ? {
        candidate: decodeProjectResponsibilitySuggestedValue(
          stringValue(decision.applied_candidate_json, 'Edited candidate JSON'),
        ),
      }
      : {}),
    reason: vocabulary.reason,
    causationId: decision.causation_id,
  }))
  const expectedPayload = suggestedChangeOutboxPayload(row, {
    projectId: suggested.project_id,
    suggestedChangeId: suggested.id,
    suggestedChangeRevision: decision.suggested_change_revision,
    persistedState: decoded.value.persistedState,
    decisionMode: decoded.value.decisionMode,
    riskLevel: decoded.value.riskLevel,
    ...(decoded.value.appliedTeamRevision === null
      ? {} : { appliedTeamRevision: decoded.value.appliedTeamRevision }),
    ...(decoded.value.appliedResponsibilityRevision === null
      ? {} : { appliedResponsibilityRevision: decoded.value.appliedResponsibilityRevision }),
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload
    || projection.mode !== decoded.value.decisionMode) {
    throw new Error('Workbench SuggestedChange decision receipt has invalid redacted ledger facts')
  }
}

function assertTeamCommandOrdinal(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
  teamRevision: number,
): void {
  if (row.audit_project_id === null) {
    throw new Error('Workbench Project Team receipt is missing Project scope')
  }
  const ordinal = integerField(database.prepare(`
    SELECT COUNT(*) AS count FROM workbench_audit_event
    WHERE project_id = ? AND command_type IN (?, ?, ?, ?, ?) AND sequence <= ?
  `).get(
    row.audit_project_id,
    PROJECT_MEMBER_COMMAND_TYPE,
    PROJECT_MEMBER_STATUS_COMMAND_TYPE,
    PROJECT_RESPONSIBILITY_COMMAND_TYPE,
    SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
    SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
    row.audit_sequence,
  ), 'count')
  if (teamRevision !== ordinal) {
    throw new Error('Workbench Project Team receipt has an invalid Team revision')
  }
}

function projectTeamOutboxPayload(
  row: ReceiptIntegrityRow,
  value: Readonly<Record<string, string | number>>,
): string {
  return canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    requestHash: row.request_hash,
    ...value,
    causationId: row.audit_causation_id,
  })
}

function suggestedChangeOutboxPayload(
  row: ReceiptIntegrityRow,
  value: Readonly<Record<string, string | number>>,
): string {
  return canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    requestHash: row.request_hash,
    ...value,
    causationId: row.audit_causation_id,
  })
}

function publicIntegrityIssue(code: AuditIntegrityFailureCode): WorkbenchAuditIntegrityIssue {
  switch (code) {
    case 'sequence-mismatch': return 'sequence-gap'
    case 'previous-hash-mismatch': return 'previous-hash-mismatch'
    case 'event-hash-mismatch': return 'event-hash-mismatch'
    case 'tail-checkpoint-mismatch': return 'head-mismatch'
    case 'canonical-envelope-mismatch':
    case 'malformed-event': return 'invalid-event'
    case 'unsupported-format': return 'unsupported-format'
  }
}

function activityItem(row: ActivityRow): WorkbenchActivityItem {
  if (row.actor_kind !== 'owner') throw new Error('Workbench database contains an unsupported Activity actor')
  const errorCode = nullableString(row.error_code, 'Activity error code')
  if (errorCode !== null && !isOutboxErrorCode(errorCode)) {
    throw new Error('Workbench database contains an unsafe Outbox error code')
  }
  const state = outboxState(row.outbox_state)
  if (((state === 'pending' || state === 'delivered') && errorCode !== null)
    || (state === 'unknown'
      && errorCode !== 'lease-expired'
      && errorCode !== 'transport-ambiguous')
    || (state === 'failed' && errorCode !== 'definitive-rejection')) {
    throw new Error('Workbench database contains an inconsistent Outbox outcome')
  }
  const projectId = nullableString(row.project_id, 'Activity project id')
  let vocabulary: Pick<WorkbenchActivityItem, 'action' | 'reason' | 'summaryCode'>
    & { readonly objectType: WorkbenchActivityItem['object']['type'] }
  if (row.command_type === STATUS_COMMAND_TYPE) {
    if (row.action !== STATUS_AUDIT_ACTION || row.reason_code !== STATUS_REASON
      || row.object_type !== STATUS_OBJECT_TYPE || row.summary_code !== STATUS_SUMMARY
      || projectId !== null) {
      throw new Error('Workbench database contains an unsupported status Activity row')
    }
    vocabulary = {
      action: STATUS_AUDIT_ACTION,
      reason: STATUS_REASON,
      summaryCode: STATUS_SUMMARY,
      objectType: STATUS_OBJECT_TYPE,
    }
  } else if (row.command_type === PROJECT_COMMAND_TYPE) {
    if (row.action !== PROJECT_AUDIT_ACTION || row.reason_code !== PROJECT_REASON
      || row.object_type !== PROJECT_OBJECT_TYPE || row.summary_code !== PROJECT_SUMMARY
      || projectId === null || projectId !== row.object_id) {
      throw new Error('Workbench database contains an unsupported Project Activity row')
    }
    vocabulary = {
      action: PROJECT_AUDIT_ACTION,
      reason: PROJECT_REASON,
      summaryCode: PROJECT_SUMMARY,
      objectType: PROJECT_OBJECT_TYPE,
    }
  } else if (row.command_type === PROJECT_MEMBER_COMMAND_TYPE) {
    if (row.action !== PROJECT_MEMBER_AUDIT_ACTION
      || row.reason_code !== PROJECT_MEMBER_REASON
      || row.object_type !== PROJECT_MEMBER_OBJECT_TYPE
      || row.summary_code !== PROJECT_MEMBER_SUMMARY
      || projectId === null) {
      throw new Error('Workbench database contains an unsupported ProjectMember Activity row')
    }
    vocabulary = {
      action: PROJECT_MEMBER_AUDIT_ACTION,
      reason: PROJECT_MEMBER_REASON,
      summaryCode: PROJECT_MEMBER_SUMMARY,
      objectType: PROJECT_MEMBER_OBJECT_TYPE,
    }
  } else if (row.command_type === PROJECT_MEMBER_STATUS_COMMAND_TYPE) {
    if (row.action !== PROJECT_MEMBER_STATUS_AUDIT_ACTION
      || row.reason_code !== PROJECT_MEMBER_STATUS_REASON
      || row.object_type !== PROJECT_MEMBER_OBJECT_TYPE
      || row.summary_code !== PROJECT_MEMBER_STATUS_SUMMARY
      || projectId === null) {
      throw new Error('Workbench database contains an unsupported ProjectMember status Activity row')
    }
    vocabulary = {
      action: PROJECT_MEMBER_STATUS_AUDIT_ACTION,
      reason: PROJECT_MEMBER_STATUS_REASON,
      summaryCode: PROJECT_MEMBER_STATUS_SUMMARY,
      objectType: PROJECT_MEMBER_OBJECT_TYPE,
    }
  } else if (row.command_type === PROJECT_RESPONSIBILITY_COMMAND_TYPE) {
    if (row.action !== PROJECT_RESPONSIBILITY_AUDIT_ACTION
      || row.reason_code !== PROJECT_RESPONSIBILITY_REASON
      || row.object_type !== PROJECT_RESPONSIBILITY_OBJECT_TYPE
      || row.summary_code !== PROJECT_RESPONSIBILITY_SUMMARY
      || projectId === null || projectId !== row.object_id) {
      throw new Error('Workbench database contains an unsupported Project Responsibility Activity row')
    }
    vocabulary = {
      action: PROJECT_RESPONSIBILITY_AUDIT_ACTION,
      reason: PROJECT_RESPONSIBILITY_REASON,
      summaryCode: PROJECT_RESPONSIBILITY_SUMMARY,
      objectType: PROJECT_RESPONSIBILITY_OBJECT_TYPE,
    }
  } else {
    const suggestedVocabulary = storedSuggestedChangeVocabulary(row.command_type)
    if (suggestedVocabulary === null
      || row.action !== suggestedVocabulary.auditAction
      || row.reason_code !== suggestedVocabulary.reason
      || row.object_type !== SUGGESTED_CHANGE_OBJECT_TYPE
      || row.summary_code !== suggestedVocabulary.summaryCode
      || projectId === null) {
      throw new Error('Workbench database contains an unsupported Activity command type')
    }
    vocabulary = {
      action: suggestedVocabulary.auditAction,
      reason: suggestedVocabulary.reason,
      summaryCode: suggestedVocabulary.summaryCode,
      objectType: SUGGESTED_CHANGE_OBJECT_TYPE,
    }
  }
  return Object.freeze({
    sequence: positiveInteger(row.sequence, 'Activity sequence'),
    eventId: boundedReference(row.event_id, 'Activity event id'),
    occurredAt: canonicalInstant(row.occurred_at, 'Activity occurredAt'),
    actor: Object.freeze({ kind: 'owner', id: boundedReference(row.actor_id, 'Activity actor id') }),
    projectId,
    action: vocabulary.action,
    reason: vocabulary.reason,
    object: Object.freeze({
      type: vocabulary.objectType,
      id: boundedReference(row.object_id, 'Activity object id'),
      version: positiveInteger(row.object_version, 'Activity object version'),
    }),
    causationId: boundedReference(row.causation_id, 'Activity causation id'),
    commandId: boundedReference(row.command_id, 'Activity command id'),
    summaryCode: vocabulary.summaryCode,
    hash: auditHash(stringValue(row.event_hash, 'Activity event hash')),
    previousHash: auditHash(stringValue(row.previous_hash, 'Activity previous hash')),
    outbox: Object.freeze({
      id: boundedReference(row.outbox_id, 'Activity Outbox id'),
      state,
      attemptCount: positiveInteger(row.attempt_count, 'Activity attempt count', true),
      updatedAt: canonicalInstant(row.outbox_updated_at, 'Activity Outbox updatedAt'),
      errorCode,
    }),
  })
}

function isOutboxErrorCode(value: unknown): value is WorkbenchOutboxErrorCode {
  return typeof value === 'string'
    && OUTBOX_ERROR_CODES.has(value as WorkbenchOutboxErrorCode)
}

function statusRequestHash(mutation: WorkbenchStatusMutation): string {
  return digest(canonicalizeJson({
    commandType: STATUS_COMMAND_TYPE,
    target: STATUS_OBJECT_TYPE,
    message: mutation.message,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function projectRequestHash(mutation: WorkbenchProjectMutation): string {
  return digest(canonicalizeJson({
    commandType: PROJECT_COMMAND_TYPE,
    target: PROJECT_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
    },
    template: mutation.template,
    projectName: mutation.projectName,
    primaryGoal: {
      name: mutation.primaryGoal.name,
      outcomes: mutation.primaryGoal.outcomes.map(outcome => ({
        name: outcome.name,
        metric: outcome.metric,
      })),
    },
    supportingGoals: mutation.supportingGoals.map(goal => ({
      goalId: goal.goalId,
      expectedRevision: goal.expectedRevision,
    })),
    expectedCatalogRevision: mutation.expectedCatalogRevision,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function projectRequestHashFromResult(
  result: Extract<CreateProjectResult, { readonly ok: true }>,
  organizationId: string,
  teamId: string,
  causationId: string,
): string {
  return digest(canonicalizeJson({
    commandType: PROJECT_COMMAND_TYPE,
    target: PROJECT_OBJECT_TYPE,
    scope: { organizationId, teamId },
    template: result.value.templateSnapshot.template,
    projectName: result.value.project.name,
    primaryGoal: {
      name: result.value.primaryGoal.name,
      outcomes: result.value.primaryGoal.outcomes.map(outcome => ({
        name: outcome.name,
        metric: outcome.metric,
      })),
    },
    supportingGoals: result.value.supportingGoals.map(goal => ({
      goalId: goal.goalId,
      expectedRevision: goal.revision,
    })),
    expectedCatalogRevision: result.catalogRevision - 1,
    expectedRevision: null,
    reason: PROJECT_REASON,
    causationId,
  }))
}

function validateMutation(mutation: WorkbenchStatusMutation): void {
  validateReference(mutation.candidateId, 'Status candidate id')
  if (typeof mutation.message !== 'string' || mutation.message.length === 0) {
    throw new TypeError('Status message must be non-empty')
  }
  if (mutation.expectedRevision !== null
    && (!Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 1)) {
    throw new TypeError('Status expected revision is invalid')
  }
  validateInstant(mutation.updatedAt, 'Status updatedAt')
  if (mutation.command.reason !== STATUS_REASON) throw new TypeError('Status reason is unsupported')
  for (const [label, value] of [
    ['Command id', mutation.command.commandId],
    ['Audit event id', mutation.command.auditEventId],
    ['Outbox id', mutation.command.outboxId],
    ['Idempotency key', mutation.command.idempotencyKey],
    ['Causation id', mutation.command.causationId],
    ['Actor id', mutation.command.actor.id],
    ['Organization id', mutation.command.actor.organizationId],
    ['Team id', mutation.command.actor.teamId],
  ] as const) validateReference(value, label)
  if (mutation.command.actor.kind !== 'owner') throw new TypeError('Status actor must be owner')
  validateInstant(mutation.command.occurredAt, 'Command occurredAt')
  if (mutation.command.occurredAt !== mutation.updatedAt) {
    throw new TypeError('Status and command instants must match')
  }
}

function validateProjectStartQuery(query: WorkbenchProjectStartQuery): void {
  validateBoundedReference(query.organizationId, 'Project organization id')
  validateBoundedReference(query.teamId, 'Project team id')
  const limit = query.filter.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PROJECT_PAGE_LIMIT) {
    throw new TypeError(`Project limit must be an integer from 1 to ${MAX_PROJECT_PAGE_LIMIT}`)
  }
  if (query.filter.beforeSequence !== undefined
    && (!Number.isSafeInteger(query.filter.beforeSequence)
      || query.filter.beforeSequence < 1)) {
    throw new TypeError('Project beforeSequence must be a positive safe integer')
  }
}

function validateProjectReadQuery(query: WorkbenchProjectReadQuery): void {
  validateBoundedReference(query.organizationId, 'Project organization id')
  validateBoundedReference(query.teamId, 'Project team id')
  validateBoundedReference(query.projectId, 'Project id')
}

function validateProjectTeamReadQuery(query: WorkbenchProjectTeamReadQuery): void {
  validateBoundedReference(query.organizationId, 'Project Team organization id')
  validateBoundedReference(query.teamId, 'Project Team team id')
  validateBoundedReference(query.projectId, 'Project Team Project id')
}

function validateProjectMutation(mutation: WorkbenchProjectMutation): void {
  validateBoundedReference(mutation.projectId, 'Project id')
  validateBoundedReference(mutation.primaryGoalId, 'Primary Goal id')
  validateDomainText(mutation.projectName, 'Project name', MAX_DOMAIN_NAME_LENGTH)
  validateDomainText(mutation.primaryGoal.name, 'Primary Goal name', MAX_DOMAIN_NAME_LENGTH)
  if (!Array.isArray(mutation.primaryGoal.outcomes)
    || mutation.primaryGoal.outcomes.length < 1
    || mutation.primaryGoal.outcomes.length > MAX_PROJECT_OUTCOMES) {
    throw new TypeError(`Project must create from 1 to ${MAX_PROJECT_OUTCOMES} Outcomes`)
  }
  const outcomeIds = new Set<string>()
  for (let index = 0; index < mutation.primaryGoal.outcomes.length; index += 1) {
    const outcome = mutation.primaryGoal.outcomes[index]
    if (outcome === undefined) throw new TypeError('Project Outcomes must be a dense array')
    validateBoundedReference(outcome.outcomeId, `Outcome ${String(index + 1)} id`)
    if (outcomeIds.has(outcome.outcomeId)) throw new TypeError('Project Outcome ids must be unique')
    outcomeIds.add(outcome.outcomeId)
    validateDomainText(outcome.name, `Outcome ${String(index + 1)} name`, MAX_DOMAIN_NAME_LENGTH)
    validateDomainText(
      outcome.metric.metricName,
      `Outcome ${String(index + 1)} metric name`,
      MAX_METRIC_NAME_LENGTH,
    )
    validateDomainText(
      outcome.metric.unit,
      `Outcome ${String(index + 1)} metric unit`,
      MAX_METRIC_UNIT_LENGTH,
    )
    finiteMutationNumber(outcome.metric.initialValue, `Outcome ${String(index + 1)} initial value`)
    finiteMutationNumber(outcome.metric.targetValue, `Outcome ${String(index + 1)} target value`)
    assertMetricDirection(outcome.metric, `Outcome ${String(index + 1)} metric`)
  }
  if (!Array.isArray(mutation.supportingGoals)
    || mutation.supportingGoals.length > MAX_SUPPORTING_GOALS) {
    throw new TypeError(`Project may contain at most ${MAX_SUPPORTING_GOALS} Supporting Goals`)
  }
  const supportingIds = new Set<string>()
  for (const supporting of mutation.supportingGoals) {
    validateBoundedReference(supporting.goalId, 'Supporting Goal id')
    if (supporting.goalId === mutation.primaryGoalId) {
      throw new TypeError('Project cannot repeat its Primary Goal as Supporting')
    }
    if (supportingIds.has(supporting.goalId)) {
      throw new TypeError('Project Supporting Goal ids must be unique')
    }
    supportingIds.add(supporting.goalId)
    if (!Number.isSafeInteger(supporting.expectedRevision) || supporting.expectedRevision < 1) {
      throw new TypeError('Supporting Goal expected revision must be a positive safe integer')
    }
  }
  validateBoundedReference(mutation.template.templateId, 'Template id')
  if (!Number.isSafeInteger(mutation.template.templateVersion)
    || mutation.template.templateVersion < 1) {
    throw new TypeError('Template version must be a positive safe integer')
  }
  if (typeof mutation.template.definitionDigest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(mutation.template.definitionDigest)) {
    throw new TypeError('Template definition digest must be a SHA-256 digest')
  }
  if (!Number.isSafeInteger(mutation.expectedCatalogRevision)
    || mutation.expectedCatalogRevision < 0) {
    throw new TypeError('Project catalog expected revision must be a non-negative safe integer')
  }
  if (mutation.expectedRevision !== null) {
    throw new TypeError('New Project expected revision must be null')
  }
  validateInstant(mutation.createdAt, 'Project createdAt')
  if (mutation.command.reason !== PROJECT_REASON) throw new TypeError('Project reason is unsupported')
  for (const [label, value] of [
    ['Command id', mutation.command.commandId],
    ['Audit event id', mutation.command.auditEventId],
    ['Outbox id', mutation.command.outboxId],
    ['Actor id', mutation.command.actor.id],
    ['Organization id', mutation.command.actor.organizationId],
    ['Team id', mutation.command.actor.teamId],
  ] as const) validateBoundedReference(value, label)
  validateProjectCommandKey(mutation.command.idempotencyKey, 'Idempotency key')
  validateProjectCommandKey(mutation.command.causationId, 'Causation id')
  if (mutation.command.actor.kind !== 'owner') throw new TypeError('Project actor must be owner')
  validateInstant(mutation.command.occurredAt, 'Command occurredAt')
  if (mutation.command.occurredAt !== mutation.createdAt) {
    throw new TypeError('Project and command instants must match')
  }
}

function validateProjectMemberMutation(mutation: WorkbenchProjectMemberMutation): void {
  validateBoundedReference(mutation.projectId, 'ProjectMember Project id')
  validateBoundedReference(mutation.memberId, 'ProjectMember id')
  if (!Number.isSafeInteger(mutation.expectedTeamRevision)
    || mutation.expectedTeamRevision < 0) {
    throw new TypeError('Project Team expected revision must be a non-negative safe integer')
  }
  if (mutation.expectedRevision !== null) {
    throw new TypeError('New ProjectMember expected revision must be null')
  }
  if (typeof mutation.member !== 'object' || mutation.member === null) {
    throw new TypeError('ProjectMember draft must be an object')
  }
  validateDomainText(
    mutation.member.displayName,
    'ProjectMember display name',
    MAX_MEMBER_DISPLAY_NAME_LENGTH,
  )
  if (mutation.member.kind === 'agent') {
    validateExactMutationKeys(
      mutation.member,
      'Agent ProjectMember draft',
      ['kind', 'displayName'],
    )
  } else if (mutation.member.kind === 'human') {
    validateExactMutationKeys(
      mutation.member,
      'Human ProjectMember draft',
      ['kind', 'displayName', 'identity'],
    )
    const identity = mutation.member.identity
    if (typeof identity !== 'object' || identity === null) {
      throw new TypeError('Human ProjectMember requires one identity')
    }
    if (identity.type === 'feishu') {
      validateExactMutationKeys(
        identity,
        'Feishu ProjectMember identity',
        ['type', 'appId', 'openId'],
      )
      validateBoundedReference(identity.appId, 'Feishu application id')
      validateBoundedReference(identity.openId, 'Feishu open id')
    } else if (identity.type === 'external') {
      validateExactMutationKeys(
        identity,
        'External ProjectMember identity',
        ['type', 'method', 'value'],
      )
      externalContactMethod(identity.method)
      validateDomainText(
        identity.value,
        'External contact value',
        MAX_EXTERNAL_CONTACT_LENGTH,
      )
    } else {
      throw new TypeError('Human ProjectMember identity type is unsupported')
    }
  } else {
    throw new TypeError('ProjectMember kind is unsupported')
  }
  validateInstant(mutation.createdAt, 'ProjectMember createdAt')
  validateProjectTeamCommand(
    mutation.command,
    PROJECT_MEMBER_REASON,
    mutation.createdAt,
  )
}

function validateProjectMemberStatusMutation(
  mutation: WorkbenchProjectMemberStatusMutation,
): void {
  validateBoundedReference(mutation.projectId, 'ProjectMember Project id')
  validateBoundedReference(mutation.memberId, 'ProjectMember id')
  projectMemberStatus(mutation.status)
  if (!Number.isSafeInteger(mutation.expectedTeamRevision)
    || mutation.expectedTeamRevision < 0) {
    throw new TypeError('Project Team expected revision must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(mutation.expectedMemberRevision)
    || mutation.expectedMemberRevision < 1) {
    throw new TypeError('ProjectMember expected revision must be a positive safe integer')
  }
  validateInstant(mutation.updatedAt, 'ProjectMember updatedAt')
  validateProjectTeamCommand(
    mutation.command,
    PROJECT_MEMBER_STATUS_REASON,
    mutation.updatedAt,
  )
}

function validateProjectResponsibilityMutation(
  mutation: WorkbenchProjectResponsibilityMutation,
): void {
  validateBoundedReference(mutation.projectId, 'Project Responsibility Project id')
  validateBoundedReference(mutation.accountableMemberId, 'Accountable member id')
  if (!Array.isArray(mutation.contributorMemberIds)
    || mutation.contributorMemberIds.length > MAX_RESPONSIBILITY_CONTRIBUTORS) {
    throw new TypeError(
      `Project Responsibility may contain at most ${MAX_RESPONSIBILITY_CONTRIBUTORS} Contributors`,
    )
  }
  const contributorIds = new Set<string>()
  let previous: string | undefined
  for (const memberId of mutation.contributorMemberIds) {
    validateBoundedReference(memberId, 'Contributor member id')
    if (contributorIds.has(memberId)) {
      throw new TypeError('Project Responsibility Contributor ids must be unique')
    }
    if (previous !== undefined && previous > memberId) {
      throw new TypeError('Project Responsibility Contributor ids must be canonical sorted')
    }
    previous = memberId
    contributorIds.add(memberId)
  }
  if (mutation.humanSponsorMemberId !== null) {
    validateBoundedReference(mutation.humanSponsorMemberId, 'Human Sponsor member id')
  }
  if (!Number.isSafeInteger(mutation.expectedTeamRevision)
    || mutation.expectedTeamRevision < 0) {
    throw new TypeError('Project Team expected revision must be a non-negative safe integer')
  }
  if (mutation.expectedResponsibilityRevision !== null
    && (!Number.isSafeInteger(mutation.expectedResponsibilityRevision)
      || mutation.expectedResponsibilityRevision < 1)) {
    throw new TypeError(
      'Project Responsibility expected revision must be null or a positive safe integer',
    )
  }
  validateInstant(mutation.updatedAt, 'Project Responsibility updatedAt')
  validateProjectTeamCommand(
    mutation.command,
    PROJECT_RESPONSIBILITY_REASON,
    mutation.updatedAt,
  )
}

function validateReviewCenterQuery(query: WorkbenchReviewCenterQuery): void {
  validateBoundedReference(query.organizationId, 'Review Center organization id')
  validateBoundedReference(query.teamId, 'Review Center team id')
  validateBoundedReference(query.filter.projectId, 'Review Center Project id')
  if (query.filter.status !== undefined
    && query.filter.status !== 'pending'
    && query.filter.status !== 'deferred'
    && query.filter.status !== 'stale'
    && query.filter.status !== 'accepted'
    && query.filter.status !== 'rejected') {
    throw new TypeError('Review Center status filter is unsupported')
  }
  if (query.filter.riskLevel !== undefined
    && query.filter.riskLevel !== 'low'
    && query.filter.riskLevel !== 'high') {
    throw new TypeError('Review Center risk filter is unsupported')
  }
  if (query.filter.beforeSequence !== undefined
    && (!Number.isSafeInteger(query.filter.beforeSequence)
      || query.filter.beforeSequence < 1)) {
    throw new TypeError('Review Center beforeSequence must be a positive safe integer')
  }
  const limit = query.filter.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REVIEW_CENTER_LIMIT) {
    throw new TypeError(`Review Center limit must be an integer from 1 to ${MAX_REVIEW_CENTER_LIMIT}`)
  }
}

function validateSuggestedResponsibilityCandidate(
  candidate: ProjectResponsibilitySuggestedValue,
): void {
  validateExactMutationKeys(candidate, 'SuggestedChange candidate', [
    'accountableMemberId', 'contributorMemberIds', 'humanSponsorMemberId',
  ])
  validateBoundedReference(candidate.accountableMemberId, 'SuggestedChange Accountable member id')
  if (!Array.isArray(candidate.contributorMemberIds)
    || candidate.contributorMemberIds.length > MAX_RESPONSIBILITY_CONTRIBUTORS) {
    throw new TypeError(
      `SuggestedChange candidate may contain at most ${MAX_RESPONSIBILITY_CONTRIBUTORS} Contributors`,
    )
  }
  let previous: string | undefined
  const seen = new Set<string>()
  for (const memberId of candidate.contributorMemberIds) {
    validateBoundedReference(memberId, 'SuggestedChange Contributor member id')
    if (seen.has(memberId) || (previous !== undefined && previous > memberId)) {
      throw new TypeError('SuggestedChange Contributor ids must be a canonical unique set')
    }
    previous = memberId
    seen.add(memberId)
  }
  if (candidate.humanSponsorMemberId !== null) {
    validateBoundedReference(
      candidate.humanSponsorMemberId,
      'SuggestedChange Human Sponsor member id',
    )
  }
}

function validateSuggestedChangeProposalMutation(
  mutation: WorkbenchSuggestedChangeProposalMutation,
): void {
  validateExactMutationKeys(mutation, 'SuggestedChange proposal mutation', [
    'suggestedChangeId', 'projectId', 'candidate', 'evidenceRefs',
    'expectedTeamRevision', 'expectedRevision', 'createdAt', 'command',
  ])
  validateBoundedReference(mutation.suggestedChangeId, 'SuggestedChange id')
  validateBoundedReference(mutation.projectId, 'SuggestedChange Project id')
  validateSuggestedResponsibilityCandidate(mutation.candidate)
  if (!Array.isArray(mutation.evidenceRefs)
    || mutation.evidenceRefs.length < 1
    || mutation.evidenceRefs.length > MAX_SUGGESTED_CHANGE_EVIDENCE) {
    throw new TypeError(
      `SuggestedChange requires 1 to ${MAX_SUGGESTED_CHANGE_EVIDENCE} EvidenceRefs`,
    )
  }
  let previousEvidenceId: string | undefined
  for (const evidence of mutation.evidenceRefs) {
    validateExactMutationKeys(evidence, 'SuggestedChange EvidenceRef', ['kind', 'auditEventId'])
    if (evidence.kind !== 'workbench-audit-event') {
      throw new TypeError('SuggestedChange EvidenceRef kind is unsupported')
    }
    validateBoundedReference(evidence.auditEventId, 'SuggestedChange EvidenceRef audit id')
    if (previousEvidenceId !== undefined && previousEvidenceId > evidence.auditEventId) {
      throw new TypeError('SuggestedChange EvidenceRefs must use canonical audit id order')
    }
    previousEvidenceId = evidence.auditEventId
  }
  if (!Number.isSafeInteger(mutation.expectedTeamRevision)
    || mutation.expectedTeamRevision < 0) {
    throw new TypeError('SuggestedChange expected Team revision must be non-negative')
  }
  if (mutation.expectedRevision !== null) {
    throw new TypeError('New SuggestedChange expected revision must be null')
  }
  validateInstant(mutation.createdAt, 'SuggestedChange createdAt')
  validateProjectTeamCommand(
    mutation.command,
    SUGGESTED_CHANGE_PROPOSAL_REASON,
    mutation.createdAt,
  )
}

function validateSuggestedChangeDecisionMutation(
  mutation: WorkbenchSuggestedChangeDecisionMutation,
): void {
  const common = [
    'decisionId', 'projectId', 'suggestedChangeId', 'expectedSuggestedChangeRevision',
    'feedback', 'decidedAt', 'mode', 'command',
  ]
  validateExactMutationKeys(
    mutation,
    'SuggestedChange decision mutation',
    mutation.mode === 'accept'
      ? [...common, 'acknowledgedRiskLevel']
      : mutation.mode === 'edit-and-accept'
        ? [...common, 'acknowledgedRiskLevel', 'candidate']
        : common,
  )
  validateBoundedReference(mutation.decisionId, 'SuggestedChange decision id')
  validateBoundedReference(mutation.projectId, 'SuggestedChange decision Project id')
  validateBoundedReference(mutation.suggestedChangeId, 'SuggestedChange decision target id')
  if (!Number.isSafeInteger(mutation.expectedSuggestedChangeRevision)
    || mutation.expectedSuggestedChangeRevision < 1) {
    throw new TypeError('SuggestedChange expected revision must be positive')
  }
  validateDomainText(
    mutation.feedback,
    'SuggestedChange decision feedback',
    MAX_SUGGESTED_CHANGE_FEEDBACK_LENGTH,
  )
  if (mutation.mode === 'accept' || mutation.mode === 'edit-and-accept') {
    suggestedChangeRiskLevel(mutation.acknowledgedRiskLevel)
    if (mutation.mode === 'edit-and-accept') {
      validateSuggestedResponsibilityCandidate(mutation.candidate)
    }
  }
  const vocabulary = suggestedChangeDecisionVocabulary(mutation.mode)
  validateInstant(mutation.decidedAt, 'SuggestedChange decidedAt')
  validateProjectTeamCommand(mutation.command, vocabulary.reason, mutation.decidedAt)
}

function suggestedChangeProposalRequestHash(
  mutation: WorkbenchSuggestedChangeProposalMutation,
): string {
  return digest(canonicalizeJson({
    commandType: SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
    target: SUGGESTED_CHANGE_TARGET_ADAPTER,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    candidate: mutation.candidate,
    evidenceRefs: mutation.evidenceRefs,
    expectedTeamRevision: mutation.expectedTeamRevision,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function suggestedChangeDecisionRequestHash(
  mutation: WorkbenchSuggestedChangeDecisionMutation,
): string {
  return digest(canonicalizeJson({
    commandType: suggestedChangeDecisionVocabulary(mutation.mode).commandType,
    target: SUGGESTED_CHANGE_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    suggestedChangeId: mutation.suggestedChangeId,
    expectedSuggestedChangeRevision: mutation.expectedSuggestedChangeRevision,
    mode: mutation.mode,
    feedback: mutation.feedback,
    ...(mutation.mode === 'accept' || mutation.mode === 'edit-and-accept'
      ? { acknowledgedRiskLevel: mutation.acknowledgedRiskLevel }
      : {}),
    ...(mutation.mode === 'edit-and-accept' ? { candidate: mutation.candidate } : {}),
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function suggestedChangeDecisionVocabulary(
  mode: WorkbenchSuggestedChangeDecisionMutation['mode'],
): {
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly reason: WorkbenchCommandMetadata['reason']
  readonly summaryCode: WorkbenchActivitySummaryCode
} {
  switch (mode) {
    case 'accept': return {
      commandType: SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
      auditAction: SUGGESTED_CHANGE_ACCEPT_AUDIT_ACTION,
      reason: SUGGESTED_CHANGE_ACCEPT_REASON,
      summaryCode: SUGGESTED_CHANGE_ACCEPT_SUMMARY,
    }
    case 'edit-and-accept': return {
      commandType: SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
      auditAction: SUGGESTED_CHANGE_EDIT_ACCEPT_AUDIT_ACTION,
      reason: SUGGESTED_CHANGE_EDIT_ACCEPT_REASON,
      summaryCode: SUGGESTED_CHANGE_EDIT_ACCEPT_SUMMARY,
    }
    case 'reject': return {
      commandType: SUGGESTED_CHANGE_REJECT_COMMAND_TYPE,
      auditAction: SUGGESTED_CHANGE_REJECT_AUDIT_ACTION,
      reason: SUGGESTED_CHANGE_REJECT_REASON,
      summaryCode: SUGGESTED_CHANGE_REJECT_SUMMARY,
    }
    case 'defer': return {
      commandType: SUGGESTED_CHANGE_DEFER_COMMAND_TYPE,
      auditAction: SUGGESTED_CHANGE_DEFER_AUDIT_ACTION,
      reason: SUGGESTED_CHANGE_DEFER_REASON,
      summaryCode: SUGGESTED_CHANGE_DEFER_SUMMARY,
    }
  }
}

interface StoredSuggestedChangeVocabulary {
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly reason: WorkbenchCommandMetadata['reason']
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
}

function storedSuggestedChangeVocabulary(
  commandType: string,
): StoredSuggestedChangeVocabulary | null {
  switch (commandType) {
    case SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE:
      return {
        commandType: SUGGESTED_CHANGE_PROPOSAL_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_PROPOSAL_AUDIT_ACTION,
        reason: SUGGESTED_CHANGE_PROPOSAL_REASON,
        summaryCode: SUGGESTED_CHANGE_PROPOSAL_SUMMARY,
        changedFields: ['proposal', 'risk', 'evidence'],
        outboxTopic: SUGGESTED_CHANGE_PROPOSAL_OUTBOX_TOPIC,
      }
    case SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE:
      return {
        commandType: SUGGESTED_CHANGE_ACCEPT_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_ACCEPT_AUDIT_ACTION,
        reason: SUGGESTED_CHANGE_ACCEPT_REASON,
        summaryCode: SUGGESTED_CHANGE_ACCEPT_SUMMARY,
        changedFields: ['decision', 'target'],
        outboxTopic: SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC,
      }
    case SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE:
      return {
        commandType: SUGGESTED_CHANGE_EDIT_ACCEPT_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_EDIT_ACCEPT_AUDIT_ACTION,
        reason: SUGGESTED_CHANGE_EDIT_ACCEPT_REASON,
        summaryCode: SUGGESTED_CHANGE_EDIT_ACCEPT_SUMMARY,
        changedFields: ['decision', 'target'],
        outboxTopic: SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC,
      }
    case SUGGESTED_CHANGE_REJECT_COMMAND_TYPE:
      return {
        commandType: SUGGESTED_CHANGE_REJECT_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_REJECT_AUDIT_ACTION,
        reason: SUGGESTED_CHANGE_REJECT_REASON,
        summaryCode: SUGGESTED_CHANGE_REJECT_SUMMARY,
        changedFields: ['decision'],
        outboxTopic: SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC,
      }
    case SUGGESTED_CHANGE_DEFER_COMMAND_TYPE:
      return {
        commandType: SUGGESTED_CHANGE_DEFER_COMMAND_TYPE,
        auditAction: SUGGESTED_CHANGE_DEFER_AUDIT_ACTION,
        reason: SUGGESTED_CHANGE_DEFER_REASON,
        summaryCode: SUGGESTED_CHANGE_DEFER_SUMMARY,
        changedFields: ['decision'],
        outboxTopic: SUGGESTED_CHANGE_DECISION_OUTBOX_TOPIC,
      }
    default: return null
  }
}

function validateProjectTeamCommand(
  command: WorkbenchCommandMetadata,
  reason: string,
  domainInstant: string,
): void {
  if (command.reason !== reason) throw new TypeError('Project Team command reason is unsupported')
  for (const [label, value] of [
    ['Command id', command.commandId],
    ['Audit event id', command.auditEventId],
    ['Outbox id', command.outboxId],
    ['Actor id', command.actor.id],
    ['Organization id', command.actor.organizationId],
    ['Team id', command.actor.teamId],
  ] as const) validateBoundedReference(value, label)
  validateProjectCommandKey(command.idempotencyKey, 'Idempotency key')
  validateProjectCommandKey(command.causationId, 'Causation id')
  if (command.actor.kind !== 'owner') throw new TypeError('Project Team actor must be owner')
  validateInstant(command.occurredAt, 'Project Team command occurredAt')
  if (command.occurredAt !== domainInstant) {
    throw new TypeError('Project Team domain and command instants must match')
  }
}

function projectMemberRequestHash(mutation: WorkbenchProjectMemberMutation): string {
  return digest(canonicalizeJson({
    commandType: PROJECT_MEMBER_COMMAND_TYPE,
    target: PROJECT_MEMBER_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    member: mutation.member,
    expectedTeamRevision: mutation.expectedTeamRevision,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function projectMemberStatusRequestHash(
  mutation: WorkbenchProjectMemberStatusMutation,
): string {
  return digest(canonicalizeJson({
    commandType: PROJECT_MEMBER_STATUS_COMMAND_TYPE,
    target: PROJECT_MEMBER_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    memberId: mutation.memberId,
    status: mutation.status,
    expectedTeamRevision: mutation.expectedTeamRevision,
    expectedMemberRevision: mutation.expectedMemberRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function projectResponsibilityRequestHash(
  mutation: WorkbenchProjectResponsibilityMutation,
): string {
  return digest(canonicalizeJson({
    commandType: PROJECT_RESPONSIBILITY_COMMAND_TYPE,
    target: PROJECT_RESPONSIBILITY_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    accountableMemberId: mutation.accountableMemberId,
    contributorMemberIds: mutation.contributorMemberIds,
    humanSponsorMemberId: mutation.humanSponsorMemberId,
    expectedTeamRevision: mutation.expectedTeamRevision,
    expectedResponsibilityRevision: mutation.expectedResponsibilityRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

type ProjectTeamMutation = WorkbenchProjectMemberMutation
  | WorkbenchProjectMemberStatusMutation
  | WorkbenchProjectResponsibilityMutation

type ReceiptMutation = ProjectTeamMutation
  | WorkbenchSuggestedChangeProposalMutation
  | WorkbenchSuggestedChangeDecisionMutation

function idempotencyKeyHash(value: string): string {
  return digest(`project-workbench.idempotency.v1\0${value}`)
}

function findReceipt(
  database: DatabaseSync,
  mutation: ReceiptMutation,
  keyHash: string,
): ReceiptRow | undefined {
  return database.prepare(`
    SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
    FROM workbench_command_receipt
    WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
  `).get(
    mutation.command.actor.organizationId,
    mutation.command.actor.id,
    keyHash,
  ) as ReceiptRow | undefined
}

function commandReceipt(mutation: ReceiptMutation) {
  return Object.freeze({
    commandId: mutation.command.commandId,
    auditEventId: mutation.command.auditEventId,
    outboxId: mutation.command.outboxId,
  })
}

type ProjectTeamCommandResult = AddProjectMemberResult
  | SetProjectMemberStatusResult
  | SetProjectResponsibilityResult

function projectTeamIdempotencyConflict<T extends ProjectTeamCommandResult>(): T {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  }) as T
}

function projectNotFound<T extends ProjectTeamCommandResult>(projectId: string): T {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  }) as T
}

function teamRevisionConflict<T extends ProjectTeamCommandResult>(
  expectedTeamRevision: number,
  currentTeamRevision: number,
): T {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'team-revision-conflict',
      message: `Workbench Project Team revision changed (expected ${String(expectedTeamRevision)}, current ${String(currentTeamRevision)})`,
      expectedTeamRevision,
      currentTeamRevision,
    }),
  }) as T
}

function memberNotFound<T extends ProjectTeamCommandResult>(memberId: string): T {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'member-not-found',
      message: `Workbench ProjectMember ${memberId} was not found in this Project`,
      memberId,
    }),
  }) as T
}

function suggestedChangeIdempotencyConflict(): ProposeProjectResponsibilityChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  })
}

function suggestedChangeDecisionIdempotencyConflict(): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  })
}

function suggestedChangeProjectNotFound(
  projectId: string,
): ProposeProjectResponsibilityChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  })
}

function suggestedChangeDecisionProjectNotFound(projectId: string): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  })
}

function suggestedChangeTeamRevisionConflict(
  expectedTeamRevision: number,
  currentTeamRevision: number,
): ProposeProjectResponsibilityChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'team-revision-conflict',
      message: `Workbench Project Team revision changed (expected ${String(expectedTeamRevision)}, current ${String(currentTeamRevision)})`,
      expectedTeamRevision,
      currentTeamRevision,
    }),
  })
}

function noOpSuggestedChangeProposal(): ProposeProjectResponsibilityChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'no-op-suggested-change',
      message: 'Workbench SuggestedChange does not change Project Responsibility',
    }),
  })
}

function noOpSuggestedChangeDecision(): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'no-op-suggested-change',
      message: 'Workbench edited SuggestedChange does not change Project Responsibility',
    }),
  })
}

function evidenceError(
  reason: 'duplicate' | 'unavailable' | 'wrong-project' | 'integrity-failed',
): ProposeProjectResponsibilityChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'evidence-invalid',
      message: 'Workbench SuggestedChange evidence could not be admitted',
      reason,
    }),
  })
}

function suggestedChangeNotFound(suggestedChangeId: string): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'suggested-change-not-found',
      message: 'Workbench SuggestedChange was not found in the authorized Project',
      suggestedChangeId,
    }),
  })
}

function suggestedChangeRevisionConflict(
  expectedSuggestedChangeRevision: number,
  currentSuggestedChangeRevision: number,
): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'suggested-change-revision-conflict',
      message: 'Workbench SuggestedChange revision changed',
      expectedSuggestedChangeRevision,
      currentSuggestedChangeRevision,
    }),
  })
}

function suggestedChangeStale(
  baseTeamRevision: number,
  currentTeamRevision: number,
): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'suggested-change-stale',
      message: 'Workbench SuggestedChange target base is stale',
      baseTeamRevision,
      currentTeamRevision,
    }),
  })
}

function suggestedChangeStateConflict(
  status: ReviewCenterProjection['items'][number]['effectiveStatus'],
  attemptedMode: WorkbenchSuggestedChangeDecisionMutation['mode'],
): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'suggested-change-state-conflict',
      message: 'Workbench SuggestedChange cannot accept this decision in its current state',
      status,
      attemptedMode,
    }),
  })
}

function riskAcknowledgementMismatch(
  requiredRiskLevel: SuggestedChangeRiskLevel,
): DecideSuggestedChangeResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'risk-acknowledgement-mismatch',
      message: 'Workbench SuggestedChange risk acknowledgement is stale',
      requiredRiskLevel,
    }),
  })
}

function responsibilityErrorForProposal(
  error: ResponsibilityReplacementError,
): ProposeProjectResponsibilityChangeResult {
  if (error.code === 'responsibility-revision-conflict'
    || error.code === 'idempotency-conflict') {
    throw new Error('Workbench proposal planner returned an impossible conflict')
  }
  if (error.code === 'project-not-found') return suggestedChangeProjectNotFound(error.projectId)
  if (error.code === 'team-revision-conflict') {
    return suggestedChangeTeamRevisionConflict(
      error.expectedTeamRevision,
      error.currentTeamRevision,
    )
  }
  return Object.freeze({ ok: false, error: Object.freeze({ ...error }) }) as unknown as ProposeProjectResponsibilityChangeResult
}

function responsibilityErrorForDecision(
  error: ResponsibilityReplacementError,
  baseTeamRevision: number,
  currentTeamRevision: number,
): DecideSuggestedChangeResult {
  if (error.code === 'project-not-found') {
    return suggestedChangeDecisionProjectNotFound(error.projectId)
  }
  if (error.code === 'team-revision-conflict'
    || error.code === 'responsibility-revision-conflict') {
    return suggestedChangeStale(baseTeamRevision, currentTeamRevision)
  }
  if (error.code === 'idempotency-conflict') {
    throw new Error('Workbench decision planner returned an impossible idempotency conflict')
  }
  return Object.freeze({ ok: false, error: Object.freeze({ ...error }) }) as unknown as DecideSuggestedChangeResult
}

interface DecodedSuggestedChangeReceipt {
  readonly value: Record<string, unknown>
  readonly receipt: {
    readonly commandId: string
    readonly auditEventId: string
    readonly outboxId: string
  }
}

function decodeSuggestedChangeReceipt(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): DecodedSuggestedChangeReceipt {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Workbench SuggestedChange receipt contains invalid JSON')
  }
  const record = exactStoredObject(parsed, 'SuggestedChange receipt', ['ok', 'value', 'receipt'])
  if (record.ok !== true) throw new Error('Workbench SuggestedChange receipt is not committed')
  const acknowledgement = objectValue(record.value, 'SuggestedChange acknowledgement')
  const receiptRecord = exactStoredObject(record.receipt, 'SuggestedChange receipt identities', [
    'commandId', 'auditEventId', 'outboxId',
  ])
  const receipt = Object.freeze({
    commandId: boundedReference(receiptRecord.commandId, 'Receipt command id'),
    auditEventId: boundedReference(receiptRecord.auditEventId, 'Receipt audit event id'),
    outboxId: boundedReference(receiptRecord.outboxId, 'Receipt Outbox id'),
  })
  if (receipt.commandId !== stored.command_id
    || receipt.auditEventId !== stored.audit_event_id
    || receipt.outboxId !== stored.outbox_id) {
    throw new Error('Workbench SuggestedChange receipt identities do not match durable references')
  }
  return Object.freeze({ value: acknowledgement, receipt })
}

function decodeSuggestedChangeProposalResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<ProposeProjectResponsibilityChangeResult, { readonly ok: true }> {
  const decoded = decodeSuggestedChangeReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'SuggestedChange proposal acknowledgement', [
    'suggestedChangeId', 'suggestedChangeRevision', 'targetAdapter',
    'baseTargetVersion', 'persistedState', 'riskLevel',
  ])
  if (decoded.value.suggestedChangeRevision !== 1
    || decoded.value.targetAdapter !== SUGGESTED_CHANGE_TARGET_ADAPTER
    || decoded.value.persistedState !== 'pending') {
    throw new Error('Workbench SuggestedChange proposal acknowledgement is unsupported')
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      suggestedChangeId: boundedReference(decoded.value.suggestedChangeId, 'Receipt SuggestedChange id'),
      suggestedChangeRevision: 1,
      targetAdapter: SUGGESTED_CHANGE_TARGET_ADAPTER,
      baseTargetVersion: positiveInteger(
        decoded.value.baseTargetVersion,
        'Receipt SuggestedChange base target version',
        true,
      ),
      persistedState: 'pending',
      riskLevel: suggestedChangeRiskLevel(decoded.value.riskLevel),
    }),
    receipt: decoded.receipt,
  })
}

function decodeSuggestedChangeDecisionResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<DecideSuggestedChangeResult, { readonly ok: true }> {
  const decoded = decodeSuggestedChangeReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'SuggestedChange decision acknowledgement', [
    'suggestedChangeId', 'suggestedChangeRevision', 'persistedState',
    'decisionMode', 'riskLevel', 'appliedTeamRevision',
    'appliedResponsibilityRevision',
  ])
  const persistedState = suggestedChangePersistedState(decoded.value.persistedState)
  if (persistedState === 'pending') {
    throw new Error('Workbench SuggestedChange decision receipt remained pending')
  }
  const decisionMode = suggestedChangeDecisionMode(decoded.value.decisionMode)
  const expectedPersistedState: SuggestedChangePersistedState = decisionMode === 'accepted'
    || decisionMode === 'edited-accepted'
    ? 'accepted'
    : decisionMode === 'rejected'
      ? 'rejected'
      : 'deferred'
  if (persistedState !== expectedPersistedState) {
    throw new Error('Workbench SuggestedChange decision receipt has inconsistent state')
  }
  const hasAppliedVersions = decoded.value.appliedTeamRevision !== null
    && decoded.value.appliedResponsibilityRevision !== null
  const accepted = decisionMode === 'accepted' || decisionMode === 'edited-accepted'
  if (accepted !== hasAppliedVersions
    || (decoded.value.appliedTeamRevision === null)
      !== (decoded.value.appliedResponsibilityRevision === null)) {
    throw new Error('Workbench SuggestedChange decision receipt has inconsistent applied versions')
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      suggestedChangeId: boundedReference(decoded.value.suggestedChangeId, 'Receipt SuggestedChange id'),
      suggestedChangeRevision: positiveInteger(
        decoded.value.suggestedChangeRevision,
        'Receipt SuggestedChange revision',
      ),
      persistedState,
      decisionMode,
      riskLevel: suggestedChangeRiskLevel(decoded.value.riskLevel),
      appliedTeamRevision: decoded.value.appliedTeamRevision === null
        ? null
        : positiveInteger(decoded.value.appliedTeamRevision, 'Receipt applied Team revision'),
      appliedResponsibilityRevision: decoded.value.appliedResponsibilityRevision === null
        ? null
        : positiveInteger(
          decoded.value.appliedResponsibilityRevision,
          'Receipt applied Responsibility revision',
        ),
    }),
    receipt: decoded.receipt,
  })
}

interface DecodedProjectTeamReceipt {
  readonly value: Record<string, unknown>
  readonly receipt: {
    readonly commandId: string
    readonly auditEventId: string
    readonly outboxId: string
  }
}

function decodeProjectTeamReceipt(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): DecodedProjectTeamReceipt {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Workbench Project Team command receipt contains invalid JSON')
  }
  const record = exactStoredObject(parsed, 'Project Team command receipt', [
    'ok', 'value', 'receipt',
  ])
  if (record.ok !== true) throw new Error('Workbench Project Team receipt is not committed')
  const acknowledgement = objectValue(record.value, 'Project Team acknowledgement')
  const receiptRecord = exactStoredObject(record.receipt, 'Project Team receipt identities', [
    'commandId', 'auditEventId', 'outboxId',
  ])
  const receipt = Object.freeze({
    commandId: boundedReference(receiptRecord.commandId, 'Receipt command id'),
    auditEventId: boundedReference(receiptRecord.auditEventId, 'Receipt audit event id'),
    outboxId: boundedReference(receiptRecord.outboxId, 'Receipt Outbox id'),
  })
  if (receipt.commandId !== stored.command_id
    || receipt.auditEventId !== stored.audit_event_id
    || receipt.outboxId !== stored.outbox_id) {
    throw new Error('Workbench Project Team receipt identities do not match durable references')
  }
  return Object.freeze({ value: acknowledgement, receipt })
}

function decodeProjectMemberResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<AddProjectMemberResult, { readonly ok: true }> {
  const decoded = decodeProjectTeamReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'ProjectMember acknowledgement', [
    'projectId', 'memberId', 'kind', 'status', 'memberRevision', 'teamRevision',
  ])
  const kind = projectMemberKind(decoded.value.kind)
  const status = projectMemberStatus(decoded.value.status)
  if (status !== 'active') throw new Error('New ProjectMember receipt is not active')
  const memberRevision = positiveInteger(
    decoded.value.memberRevision,
    'ProjectMember acknowledgement revision',
  )
  if (memberRevision !== 1) throw new Error('New ProjectMember receipt revision is not one')
  return projectTeamCommandResult({
    ok: true,
    value: {
      projectId: boundedReference(decoded.value.projectId, 'Receipt Project id'),
      memberId: boundedReference(decoded.value.memberId, 'Receipt ProjectMember id'),
      kind,
      status,
      memberRevision,
      teamRevision: positiveInteger(
        decoded.value.teamRevision,
        'ProjectMember acknowledgement Team revision',
      ),
    },
    receipt: decoded.receipt,
  })
}

function decodeProjectMemberStatusResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<SetProjectMemberStatusResult, { readonly ok: true }> {
  const decoded = decodeProjectTeamReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'ProjectMember status acknowledgement', [
    'projectId', 'memberId', 'kind', 'status', 'memberRevision', 'teamRevision',
  ])
  return projectTeamCommandResult({
    ok: true,
    value: {
      projectId: boundedReference(decoded.value.projectId, 'Receipt Project id'),
      memberId: boundedReference(decoded.value.memberId, 'Receipt ProjectMember id'),
      kind: projectMemberKind(decoded.value.kind),
      status: projectMemberStatus(decoded.value.status),
      memberRevision: positiveInteger(
        decoded.value.memberRevision,
        'ProjectMember status acknowledgement revision',
      ),
      teamRevision: positiveInteger(
        decoded.value.teamRevision,
        'ProjectMember status acknowledgement Team revision',
      ),
    },
    receipt: decoded.receipt,
  })
}

function decodeProjectResponsibilityResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<SetProjectResponsibilityResult, { readonly ok: true }> {
  const decoded = decodeProjectTeamReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'Project Responsibility acknowledgement', [
    'projectId', 'responsibilityRevision', 'teamRevision',
  ])
  return projectTeamCommandResult({
    ok: true,
    value: {
      projectId: boundedReference(decoded.value.projectId, 'Receipt Project id'),
      responsibilityRevision: positiveInteger(
        decoded.value.responsibilityRevision,
        'Project Responsibility acknowledgement revision',
      ),
      teamRevision: positiveInteger(
        decoded.value.teamRevision,
        'Project Responsibility acknowledgement Team revision',
      ),
    },
    receipt: decoded.receipt,
  })
}

function exactStoredObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  const record = objectValue(value, label)
  assertExactStoredKeys(record, label, keys)
  return record
}

function assertExactStoredKeys(
  record: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): void {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported fields`)
  }
}

function decodeCommittedResult(value: string, stored?: Pick<
ReceiptRow,
'command_id' | 'audit_event_id' | 'outbox_id'
>): SetStatusResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Workbench command receipt contains invalid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Reflect.get(parsed, 'ok') !== true) {
    throw new Error('Workbench command receipt is not a committed result')
  }
  const snapshot = Reflect.get(parsed, 'value')
  const receipt = Reflect.get(parsed, 'receipt')
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)
    || typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    throw new Error('Workbench command receipt is malformed')
  }
  const result = statusResult({
    ok: true,
    value: {
      id: stringValue(Reflect.get(snapshot, 'id'), 'Receipt status id'),
      message: stringValue(Reflect.get(snapshot, 'message'), 'Receipt status message'),
      revision: positiveInteger(Reflect.get(snapshot, 'revision'), 'Receipt status revision'),
      updatedAt: canonicalInstant(Reflect.get(snapshot, 'updatedAt'), 'Receipt status updatedAt'),
    },
    receipt: {
      commandId: stringValue(Reflect.get(receipt, 'commandId'), 'Receipt command id'),
      auditEventId: stringValue(Reflect.get(receipt, 'auditEventId'), 'Receipt audit event id'),
      outboxId: stringValue(Reflect.get(receipt, 'outboxId'), 'Receipt Outbox id'),
    },
  })
  if (!result.ok) throw new Error('Workbench command receipt is not committed')
  if (stored !== undefined
    && (result.receipt.commandId !== stored.command_id
      || result.receipt.auditEventId !== stored.audit_event_id
      || result.receipt.outboxId !== stored.outbox_id)) {
    throw new Error('Workbench command receipt identities do not match their durable references')
  }
  return result
}

function decodeCommittedProjectResult(
  value: string,
  stored?: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<CreateProjectResult, { readonly ok: true }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Workbench Project command receipt contains invalid JSON')
  }
  const record = objectValue(parsed, 'Project command receipt')
  if (record.ok !== true) throw new Error('Workbench Project command receipt is not committed')
  const detail = projectDetailFromValue(record.value)
  const catalogRevision = positiveInteger(
    record.catalogRevision,
    'Receipt Project catalog revision',
  )
  if (catalogRevision !== detail.project.catalogSequence) {
    throw new Error('Workbench Project receipt catalog revision does not match its Project sequence')
  }
  const receiptRecord = objectValue(record.receipt, 'Project command receipt identities')
  const result = projectResult({
    ok: true,
    value: detail,
    catalogRevision,
    receipt: {
      commandId: boundedReference(receiptRecord.commandId, 'Receipt command id'),
      auditEventId: boundedReference(receiptRecord.auditEventId, 'Receipt audit event id'),
      outboxId: boundedReference(receiptRecord.outboxId, 'Receipt Outbox id'),
    },
  })
  if (stored !== undefined
    && (result.receipt.commandId !== stored.command_id
      || result.receipt.auditEventId !== stored.audit_event_id
      || result.receipt.outboxId !== stored.outbox_id)) {
    throw new Error('Workbench Project receipt identities do not match their durable references')
  }
  return result
}

function projectDetailFromValue(value: unknown): ProjectDetailProjection {
  const record = objectValue(value, 'Receipt Project detail')
  const project = projectSummaryFromValue(record.project)
  const primaryGoal = goalFromValue(record.primaryGoal)
  if (primaryGoal.goalId !== project.primaryGoal.goalId
    || primaryGoal.name !== project.primaryGoal.name
    || primaryGoal.revision !== project.primaryGoal.revision) {
    throw new Error('Receipt Project and Primary Goal projections disagree')
  }
  const supportingValues = arrayValue(record.supportingGoals, 'Receipt Supporting Goals')
  if (supportingValues.length > MAX_SUPPORTING_GOALS) {
    throw new Error('Receipt Project contains too many Supporting Goals')
  }
  const supportingGoals = Object.freeze(supportingValues.map(goalSummaryFromValue))
  const supportingIds = new Set(supportingGoals.map(goal => goal.goalId))
  if (supportingIds.size !== supportingGoals.length || supportingIds.has(primaryGoal.goalId)) {
    throw new Error('Receipt Project contains invalid Supporting Goal identities')
  }
  const templateSnapshot = templateSnapshotFromValue(record.templateSnapshot)
  if (templateSnapshot.capturedAt !== project.createdAt) {
    throw new Error('Receipt Project creation snapshot has a mismatched capture instant')
  }
  return Object.freeze({ project, primaryGoal, supportingGoals, templateSnapshot })
}

function projectSummaryFromValue(value: unknown): ProjectSummaryProjection {
  const record = objectValue(value, 'Receipt Project summary')
  const timezone = storedText(record.timezone, 'Receipt Project timezone', 128)
  if (timezone !== 'Asia/Shanghai') throw new Error('Receipt Project timezone is unsupported')
  return Object.freeze({
    projectId: boundedReference(record.projectId, 'Receipt Project id'),
    name: storedText(record.name, 'Receipt Project name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(record.revision, 'Receipt Project revision'),
    catalogSequence: positiveInteger(record.catalogSequence, 'Receipt Project catalog sequence'),
    timezone,
    createdAt: canonicalInstant(record.createdAt, 'Receipt Project createdAt'),
    primaryGoal: goalSummaryFromValue(record.primaryGoal),
  })
}

function goalFromValue(value: unknown): GoalProjection {
  const record = objectValue(value, 'Receipt Primary Goal')
  const outcomes = arrayValue(record.outcomes, 'Receipt Outcomes')
  if (outcomes.length < 1 || outcomes.length > MAX_PROJECT_OUTCOMES) {
    throw new Error('Receipt Primary Goal has an invalid Outcome count')
  }
  const decoded = Object.freeze(outcomes.map(outcomeFromValue))
  const outcomeIds = new Set(decoded.map(outcome => outcome.outcomeId))
  if (outcomeIds.size !== decoded.length) throw new Error('Receipt Outcome ids are not unique')
  return Object.freeze({
    goalId: boundedReference(record.goalId, 'Receipt Primary Goal id'),
    name: storedText(record.name, 'Receipt Primary Goal name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(record.revision, 'Receipt Primary Goal revision'),
    outcomes: decoded,
  })
}

function goalSummaryFromValue(value: unknown): GoalSummaryProjection {
  const record = objectValue(value, 'Receipt Goal summary')
  return Object.freeze({
    goalId: boundedReference(record.goalId, 'Receipt Goal id'),
    name: storedText(record.name, 'Receipt Goal name', MAX_DOMAIN_NAME_LENGTH),
    revision: positiveInteger(record.revision, 'Receipt Goal revision'),
  })
}

function outcomeFromValue(value: unknown): OutcomeProjection {
  const record = objectValue(value, 'Receipt Outcome')
  const metricRecord = objectValue(record.metric, 'Receipt Outcome metric')
  const metric: OutcomeMetric = Object.freeze({
    metricName: storedText(
      metricRecord.metricName,
      'Receipt Outcome metric name',
      MAX_METRIC_NAME_LENGTH,
    ),
    initialValue: finiteNumber(metricRecord.initialValue, 'Receipt Outcome initial value'),
    targetValue: finiteNumber(metricRecord.targetValue, 'Receipt Outcome target value'),
    unit: storedText(metricRecord.unit, 'Receipt Outcome metric unit', MAX_METRIC_UNIT_LENGTH),
    direction: metricDirection(metricRecord.direction),
  })
  assertMetricDirection(metric, 'Receipt Outcome metric')
  return Object.freeze({
    outcomeId: boundedReference(record.outcomeId, 'Receipt Outcome id'),
    name: storedText(record.name, 'Receipt Outcome name', MAX_DOMAIN_NAME_LENGTH),
    metric,
    revision: positiveInteger(record.revision, 'Receipt Outcome revision'),
  })
}

function templateSnapshotFromValue(value: unknown): ProjectTemplateSnapshotProjection {
  const record = objectValue(value, 'Receipt Project template snapshot')
  const template = templateSelectionFromValue(record.template)
  if (record.snapshotSchemaVersion !== 1
    || record.snapshotDigest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1) {
    throw new Error('Receipt Project template snapshot identity is unsupported')
  }
  const definition = templateDefinitionFromValue(record.definition)
  return Object.freeze({
    template,
    snapshotSchemaVersion: 1,
    definition,
    snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    capturedAt: canonicalInstant(record.capturedAt, 'Receipt Project snapshot capturedAt'),
  })
}

function templateSelectionFromValue(value: unknown): ProjectTemplateSelection {
  const record = objectValue(value, 'Receipt Template selection')
  if (record.templateId !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateId
    || record.templateVersion !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateVersion
    || record.definitionDigest !== KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.definitionDigest) {
    throw new Error('Receipt Template selection does not match the compiled Template Version')
  }
  return Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1 })
}

function templateDefinitionFromValue(value: unknown): KnowledgeWorkTemplateDefinitionV1 {
  let canonical: string
  try {
    canonical = canonicalizeJson(value)
  } catch {
    throw new Error('Receipt Project template definition is invalid')
  }
  if (canonical !== KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1) {
    throw new Error('Receipt Project template definition drifted from the compiled version')
  }
  return knowledgeWorkTemplateProjection().definition
}

function projectResult(
  value: Extract<CreateProjectResult, { readonly ok: true }>,
): Extract<CreateProjectResult, { readonly ok: true }> {
  return Object.freeze({
    ok: true,
    value: projectDetailCopy(value.value),
    catalogRevision: value.catalogRevision,
    receipt: Object.freeze({ ...value.receipt }),
  })
}

function projectDetailCopy(value: ProjectDetailProjection): ProjectDetailProjection {
  const primarySummary = Object.freeze({ ...value.project.primaryGoal })
  const project = Object.freeze({ ...value.project, primaryGoal: primarySummary })
  const primaryGoal = Object.freeze({
    goalId: value.primaryGoal.goalId,
    name: value.primaryGoal.name,
    revision: value.primaryGoal.revision,
    outcomes: Object.freeze(value.primaryGoal.outcomes.map(outcome => Object.freeze({
      outcomeId: outcome.outcomeId,
      name: outcome.name,
      metric: Object.freeze({ ...outcome.metric }),
      revision: outcome.revision,
    }))),
  })
  const supportingGoals = Object.freeze(value.supportingGoals.map(goal => Object.freeze({ ...goal })))
  const templateProjection = knowledgeWorkTemplateProjection()
  const templateSnapshot = Object.freeze({
    template: templateProjection.selection,
    snapshotSchemaVersion: 1 as const,
    definition: templateProjection.definition,
    snapshotDigest: value.templateSnapshot.snapshotDigest,
    capturedAt: value.templateSnapshot.capturedAt,
  })
  return Object.freeze({ project, primaryGoal, supportingGoals, templateSnapshot })
}

function revisionConflict(
  expected: number | null,
  current: WorkbenchStatusSnapshot | null,
): SetStatusResult {
  const actual = current?.revision ?? null
  return statusResult({
    ok: false,
    error: {
      code: 'revision-conflict',
      message: `Workbench status revision changed (expected ${String(expected)}, current ${String(actual)})`,
      current,
    },
  })
}

function idempotencyConflict(): Extract<
CreateProjectResult,
{ readonly ok: false; readonly error: { readonly code: 'idempotency-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  })
}

function catalogRevisionConflict(
  expectedCatalogRevision: number,
  currentCatalogRevision: number,
): Extract<
CreateProjectResult,
{ readonly ok: false; readonly error: { readonly code: 'catalog-revision-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'catalog-revision-conflict',
      message: `Workbench Project catalog revision changed (expected ${String(expectedCatalogRevision)}, current ${String(currentCatalogRevision)})`,
      expectedCatalogRevision,
      currentCatalogRevision,
    }),
  })
}

function supportingGoalConflict(
  goalId: string,
  expectedRevision: number,
  currentRevision: number | null,
): Extract<
CreateProjectResult,
{ readonly ok: false; readonly error: { readonly code: 'supporting-goal-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'supporting-goal-conflict',
      message: `Workbench Supporting Goal revision changed for ${goalId}`,
      goalId,
      expectedRevision,
      currentRevision,
    }),
  })
}

function templateVersionConflict(): Extract<
CreateProjectResult,
{ readonly ok: false; readonly error: { readonly code: 'template-version-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'template-version-conflict',
      message: 'Workbench Template Version does not match the compiled Project template',
      current: Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1 }),
    }),
  })
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function contentDigest(value: string): `sha256:${string}` {
  return `sha256:${digest(value)}`
}

function auditHash(value: string): AuditHash {
  if (!value.startsWith('sha256:') || !SHA256_HEX.test(value.slice(7))) {
    throw new Error('Workbench database contains an invalid audit hash')
  }
  return value as AuditHash
}

function outboxState(value: unknown): WorkbenchOutboxState {
  if (value !== 'pending' && value !== 'delivered' && value !== 'unknown' && value !== 'failed') {
    throw new Error('Workbench database contains an invalid Outbox state')
  }
  return value
}

function rollback(database: DatabaseSync, operationError: unknown): void {
  try {
    database.exec('ROLLBACK')
  } catch (rollbackError: unknown) {
    throw new AggregateError(
      [operationError, rollbackError],
      'Workbench migration rollback failed',
    )
  }
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is not a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
  }
  return value
}

function integerField(value: unknown, key: string): number {
  return positiveInteger(recordField(value, key), `SQLite field ${key}`, true)
}

function stringField(value: unknown, key: string): string {
  return stringValue(recordField(value, key), `SQLite field ${key}`)
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return stringValue(value, label)
}

function recordField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SQLite did not return a row object')
  }
  return Reflect.get(value, key)
}

function validateReference(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) {
    throw new TypeError(`${label} must be a bounded safe identifier`)
  }
}

function validateBoundedReference(value: string, label: string): void {
  validateReference(value, label)
  if (value.length > MAX_DOMAIN_ID_LENGTH) {
    throw new TypeError(`${label} must contain at most ${MAX_DOMAIN_ID_LENGTH} characters`)
  }
}

function validateProjectCommandKey(value: string, label: string): void {
  validateBoundedReference(value, label)
  if (value.length < 16) throw new TypeError(`${label} must contain from 16 to 128 characters`)
}

function validateExactMutationKeys(
  value: object,
  label: string,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} contains unsupported fields`)
  }
}

function boundedReference(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  try {
    validateBoundedReference(value, label)
  } catch {
    throw new Error(`${label} is not a bounded safe identifier`)
  }
  return value
}

function validateDomainText(value: string, label: string, maximumCodePoints: number): void {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0
    || ASCII_CONTROL.test(value) || [...value].length > maximumCodePoints) {
    throw new TypeError(`${label} must be trimmed text from 1 to ${maximumCodePoints} characters`)
  }
  try {
    canonicalizeJson(value)
  } catch {
    throw new TypeError(`${label} must contain valid Unicode`)
  }
}

function storedText(value: unknown, label: string, maximumCodePoints: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  try {
    validateDomainText(value, label, maximumCodePoints)
  } catch {
    throw new Error(`${label} is invalid stored text`)
  }
  return value
}

function finiteMutationNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a finite number other than negative zero`)
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    throw new Error(`${label} is not a finite number other than negative zero`)
  }
  return value
}

function metricDirection(value: unknown): OutcomeMetricDirection {
  if (value !== 'increase' && value !== 'decrease') {
    throw new Error('Outcome metric direction is invalid')
  }
  return value
}

function projectMemberKind(value: unknown): 'human' | 'agent' {
  if (value !== 'human' && value !== 'agent') {
    throw new Error('ProjectMember kind is invalid')
  }
  return value
}

function projectMemberStatus(value: unknown): ProjectMemberStatus {
  if (value !== 'active' && value !== 'inactive') {
    throw new Error('ProjectMember status is invalid')
  }
  return value
}

function externalContactMethod(value: unknown): 'email' | 'phone' | 'other' {
  if (value !== 'email' && value !== 'phone' && value !== 'other') {
    throw new Error('External contact method is invalid')
  }
  return value
}

function assertMetricDirection(metric: OutcomeMetric, label: string): void {
  if ((metric.direction === 'increase' && metric.targetValue <= metric.initialValue)
    || (metric.direction === 'decrease' && metric.targetValue >= metric.initialValue)) {
    throw new TypeError(`${label} target does not improve in its declared direction`)
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`)
  return value
}

function validateInstant(value: string, label: string): void {
  if (typeof value !== 'string' || !isIsoInstant(value)) {
    throw new TypeError(`${label} must be a canonical ISO instant`)
  }
}

function canonicalInstant(value: unknown, label: string): string {
  const result = stringValue(value, label)
  validateInstant(result, label)
  return result
}

function isIsoInstant(value: string): boolean {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function laterInstant(left: string, right: string): string {
  return left >= right ? left : right
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'))
}
