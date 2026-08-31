/** SQLite implementation of the transactional Workbench repository. */

import { createHash } from 'node:crypto'
import { open as openFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  AddProjectMemberResult,
  BindFeishuTaskListResult,
  ConfigureFeishuIdentityRouteResult,
  ConfigureFeishuTaskWorkflowResult,
  CreateProjectResult,
  DecideSuggestedChangeResult,
  FEISHU_CONNECTION_ID,
  FeishuConnectionIssue,
  FeishuIdentityKind,
  FeishuTaskCommentProjection,
  FeishuTaskEventResult,
  FeishuTaskMemberProjection,
  FeishuTaskMutationEffectProjection,
  ProjectTaskListBindingProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowCompatibilityIssue,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowOptionProjection,
  ProjectTaskWorkflowProjection,
  ProjectTasksProjection,
  FeishuResourceProbeProjection,
  FeishuScopeObservation,
  FeishuVerificationProjection,
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
  ReconcileProjectTasksResult,
  ReferenceFeishuTaskResult,
  ReviewCenterProjection,
  SetStatusResult,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
  VerifyFeishuIdentityRouteResult,
  UpdateFeishuTaskResult,
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
  projectTasksProjection,
  reviewCenterProjection,
  statusResult,
  statusSnapshot,
  type WorkbenchActivityQuery,
  type WorkbenchCommandMetadata,
  type WorkbenchFeishuConnectionQuery,
  type WorkbenchFeishuRouteMutation,
  type WorkbenchFeishuVerificationMutation,
  type WorkbenchFeishuVerificationObservation,
  type WorkbenchFeishuVerificationReplayQuery,
  type WorkbenchFeishuTaskEventMutation,
  type WorkbenchFeishuTaskListBindingMutation,
  type WorkbenchFeishuTaskListBindingReplayQuery,
  type WorkbenchFeishuTaskReconciliationFailureMutation,
  type WorkbenchFeishuTaskReconciliationMutation,
  type WorkbenchFeishuTaskReconciliationTarget,
  type WorkbenchFeishuTaskWorkflowConfigurationMutation,
  type WorkbenchFeishuTaskWorkflowContext,
  type WorkbenchFeishuTaskWorkflowOperationMutation,
  type WorkbenchFeishuTaskWorkflowOperationReservation,
  type WorkbenchFeishuTaskWorkflowReplayQuery,
  type WorkbenchFeishuTaskReferenceMutation,
  type WorkbenchFeishuTaskUpdateReservation,
  type WorkbenchFeishuTaskUpdateReservationMutation,
  type WorkbenchFeishuTaskUpdateSettlement,
  type WorkbenchStoredFeishuConnectionProjection,
  type WorkbenchOutboxClaim,
  type WorkbenchOutboxClaimRequest,
  type WorkbenchOutboxSettlement,
  type WorkbenchProjectMutation,
  type WorkbenchProjectMemberMutation,
  type WorkbenchProjectMemberStatusMutation,
  type WorkbenchProjectReadQuery,
  type WorkbenchProjectTasksReadQuery,
  type WorkbenchProjectResponsibilityMutation,
  type WorkbenchProjectStartQuery,
  type WorkbenchProjectTeamReadQuery,
  type WorkbenchReviewCenterQuery,
  type WorkbenchRepository,
  type WorkbenchStatusMutation,
  type WorkbenchSuggestedChangeDecisionMutation,
  type WorkbenchSuggestedChangeProposalMutation,
} from './repository.ts'
import type {
  WorkbenchFeishuTaskPatch,
  WorkbenchFeishuTaskRoute,
  WorkbenchFeishuTaskListSnapshot,
  WorkbenchFeishuTaskSnapshot,
} from './feishu-task-federation.ts'
import type { WorkbenchFeishuTaskCustomFieldValue } from './feishu-task-workflow.ts'
import {
  projectTaskWorkflowDefinition,
  workflowTransitionAllowed,
} from './feishu-task-workflow.ts'

export const WORKBENCH_SCHEMA_VERSION = 8
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
const FEISHU_CONNECTION_ID_VALUE: typeof FEISHU_CONNECTION_ID = 'feishu-primary'
const FEISHU_REALM = 'feishu-cn'
const FEISHU_ROUTE_SET_COMMAND_TYPE = 'workbench.feishu-route.configure'
const FEISHU_ROUTE_RESET_COMMAND_TYPE = 'workbench.feishu-route.reset'
const FEISHU_ROUTE_DISABLE_COMMAND_TYPE = 'workbench.feishu-route.disable'
const FEISHU_VERIFY_COMMAND_TYPE = 'workbench.feishu-route.verify'
const FEISHU_CONNECTION_OBJECT_TYPE = 'feishu-connection'
const FEISHU_ROUTE_SET_AUDIT_ACTION = 'workbench.feishu-route.configured'
const FEISHU_ROUTE_RESET_AUDIT_ACTION = 'workbench.feishu-route.reset'
const FEISHU_ROUTE_DISABLE_AUDIT_ACTION = 'workbench.feishu-route.disabled'
const FEISHU_VERIFY_AUDIT_ACTION = 'workbench.feishu-route.verification-recorded'
const FEISHU_ROUTE_SET_REASON = 'owner-feishu-route-configure'
const FEISHU_ROUTE_RESET_REASON = 'owner-feishu-route-reset'
const FEISHU_ROUTE_DISABLE_REASON = 'owner-feishu-route-disable'
const FEISHU_VERIFY_REASON = 'owner-feishu-route-verify'
const FEISHU_ROUTE_SET_SUMMARY = 'feishu-route-configured'
const FEISHU_ROUTE_RESET_SUMMARY = 'feishu-route-reset'
const FEISHU_ROUTE_DISABLE_SUMMARY = 'feishu-route-disabled'
const FEISHU_VERIFY_HEALTHY_SUMMARY = 'feishu-route-verification-healthy'
const FEISHU_VERIFY_ATTENTION_SUMMARY = 'feishu-route-verification-attention'
const FEISHU_VERIFY_FAILED_SUMMARY = 'feishu-route-verification-failed'
const FEISHU_ROUTE_OUTBOX_TOPIC = 'workbench.feishu-route.changed.v1'
const FEISHU_VERIFY_OUTBOX_TOPIC = 'workbench.feishu-route.verified.v1'
const FEISHU_TASK_LIST_BIND_COMMAND_TYPE = 'workbench.feishu-task-list.bind'
const FEISHU_TASK_REFERENCE_COMMAND_TYPE = 'workbench.feishu-task.reference'
const FEISHU_TASK_UPDATE_COMMAND_TYPE = 'workbench.feishu-task.update'
const FEISHU_TASK_WORKFLOW_COMMAND_TYPE = 'workbench.feishu-task-workflow.configure'
const FEISHU_TASK_LIST_BIND_AUDIT_ACTION = 'workbench.feishu-task-list.bound'
const FEISHU_TASK_REFERENCE_AUDIT_ACTION = 'workbench.feishu-task.referenced'
const FEISHU_TASK_UPDATE_AUDIT_ACTION = 'workbench.feishu-task.update-requested'
const FEISHU_TASK_WORKFLOW_AUDIT_ACTION = 'workbench.feishu-task-workflow.configured'
const FEISHU_TASK_LIST_BIND_REASON = 'owner-feishu-task-list-bind'
const FEISHU_TASK_REFERENCE_REASON = 'owner-feishu-task-reference'
const FEISHU_TASK_UPDATE_REASON = 'owner-feishu-task-update'
const FEISHU_TASK_WORKFLOW_REASON = 'owner-feishu-task-workflow-configure'
const FEISHU_TASK_LIST_BIND_SUMMARY = 'feishu-task-list-bound'
const FEISHU_TASK_REFERENCE_SUMMARY = 'feishu-task-referenced'
const FEISHU_TASK_UPDATE_SUMMARY = 'feishu-task-update-requested'
const FEISHU_TASK_WORKFLOW_SUMMARY = 'feishu-task-workflow-configured'
const FEISHU_TASK_LIST_BIND_OBJECT_TYPE = 'feishu-task-list-binding'
const FEISHU_TASK_OBJECT_TYPE = 'feishu-task'
const FEISHU_TASK_WORKFLOW_OBJECT_TYPE = 'feishu-task-workflow'
const FEISHU_TASK_LIST_BIND_OUTBOX_TOPIC = 'workbench.feishu-task-list.bound.v1'
const FEISHU_TASK_REFERENCE_OUTBOX_TOPIC = 'workbench.feishu-task.referenced.v1'
const FEISHU_TASK_UPDATE_OUTBOX_TOPIC = 'workbench.feishu-task.update.v1'
const FEISHU_TASK_WORKFLOW_OUTBOX_TOPIC = 'workbench.feishu-task-workflow.configured.v1'
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
const MAX_FEISHU_CREDENTIAL_REF_LENGTH = 128
const MAX_FEISHU_DISPLAY_LABEL_LENGTH = 200
const MAX_FEISHU_RESOURCE_ID_LENGTH = 256
const MAX_FEISHU_TASKS_PER_PROJECT = 1_000
const MAX_FEISHU_TASK_COMMENTS = 500
const MAX_FEISHU_TASK_TEXT_LENGTH = 3_000
const MAX_FEISHU_TASK_MEMBER_NAME_LENGTH = 200

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

interface FeishuConnectionRow {
  readonly organization_id: string
  readonly team_id: string
  readonly connection_id: string
  readonly realm: string
  readonly revision: number
  readonly updated_at: string
}

interface FeishuRouteRow {
  readonly organization_id: string
  readonly team_id: string
  readonly kind: string
  readonly generation: number
  readonly identity_epoch: number
  readonly state: string
  readonly app_id: string
  readonly credential_ref: string
  readonly command_id: string
  readonly created_at: string
}

interface FeishuIdentityBindingRow {
  readonly organization_id: string
  readonly team_id: string
  readonly kind: string
  readonly identity_epoch: number
  readonly route_generation: number
  readonly app_id: string
  readonly open_id: string
  readonly tenant_key: string | null
  readonly verification_id: string
  readonly bound_at: string
}

interface FeishuVerificationRow {
  readonly sequence: number
  readonly route_sequence: number
  readonly id: string
  readonly organization_id: string
  readonly team_id: string
  readonly kind: string
  readonly route_generation: number
  readonly identity_epoch: number
  readonly connection_revision: number
  readonly result: string
  readonly identity_state: string
  readonly identity_issue_json: string | null
  readonly actor_app_id: string | null
  readonly actor_open_id: string | null
  readonly actor_tenant_key: string | null
  readonly display_label: string | null
  readonly scope_state: string
  readonly scopes_json: string
  readonly scope_issue_json: string | null
  readonly requested_resource_probe_json: string
  readonly resource_probe_json: string
  readonly command_id: string
  readonly checked_at: string
}

interface FeishuTaskBindingRow {
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly revision: number
  readonly tasklist_guid: string
  readonly tasklist_name: string
  readonly canonical_url: string
  readonly route_kind: string
  readonly route_generation: number
  readonly app_id: string
  readonly open_id: string
  readonly tenant_key: string | null
  readonly created_by_workbench: number
  readonly remote_version: string
  readonly sync_state: string
  readonly sync_issue_json: string | null
  readonly last_event_at: string | null
  readonly last_reconciled_at: string | null
  readonly last_attempt_at: string | null
  readonly reconcile_generation: number
  readonly bound_at: string
  readonly updated_at: string
}

interface FeishuTaskProjectionRow {
  readonly project_id: string
  readonly task_guid: string
  readonly scope: string
  readonly visible: number
  readonly parent_task_guid: string | null
  readonly task_id: string | null
  readonly summary: string
  readonly description: string
  readonly assignees_json: string
  readonly followers_json: string
  readonly comments_json: string
  readonly completed: number
  readonly completed_at: string | null
  readonly canonical_url: string
  readonly remote_version: string
  readonly projection_revision: number
  readonly reconcile_generation: number
  readonly created_at: string
  readonly updated_at: string
}

interface FeishuTaskEffectRow {
  readonly id: string
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly actor_id: string
  readonly task_guid: string
  readonly expected_project_revision: number
  readonly expected_remote_version: string
  readonly changes_json: string
  readonly request_hash: string
  readonly idempotency_key_hash: string
  readonly state: string
  readonly issue_json: string | null
  readonly current_remote_version: string | null
  readonly attempt_count: number
  readonly command_id: string
  readonly audit_event_id: string
  readonly outbox_id: string
  readonly created_at: string
  readonly updated_at: string
}

interface FeishuTaskWorkflowRow {
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly revision: number
  readonly field_guid: string
  readonly field_name: string
  readonly field_type: string
  readonly field_remote_version: string
  readonly definition_json: string
  readonly options_json: string
  readonly compatibility_state: string
  readonly compatibility_issues_json: string
  readonly configured_at: string
  readonly updated_at: string
}

interface FeishuTaskWorkflowOperationRow {
  readonly id: string
  readonly project_id: string
  readonly organization_id: string
  readonly team_id: string
  readonly actor_id: string
  readonly expected_task_revision: number
  readonly expected_workflow_revision: number | null
  readonly mapping_mode: string
  readonly definition_json: string
  readonly mapping_json: string
  readonly request_hash: string
  readonly idempotency_key_hash: string
  readonly state: string
  readonly issue_json: string | null
  readonly attempt_count: number
  readonly command_id: string
  readonly audit_event_id: string
  readonly outbox_id: string
  readonly created_at: string
  readonly updated_at: string
}

interface FeishuTaskCustomValueRow {
  readonly project_id: string
  readonly task_guid: string
  readonly field_guid: string
  readonly field_type: string
  readonly single_select_option_guid: string | null
  readonly observed_at: string
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
  'workbench_feishu_connection_scope_no_update',
  'workbench_feishu_connection_no_delete',
  'workbench_feishu_route_no_update',
  'workbench_feishu_route_no_delete',
  'workbench_feishu_binding_no_update',
  'workbench_feishu_binding_no_delete',
  'workbench_feishu_verification_no_update',
  'workbench_feishu_verification_no_delete',
  'workbench_feishu_task_binding_scope_no_update',
  'workbench_feishu_task_binding_no_delete',
  'workbench_feishu_task_reference_no_update',
  'workbench_feishu_task_reference_no_delete',
  'workbench_feishu_task_inbox_no_update',
  'workbench_feishu_task_inbox_no_delete',
  'workbench_feishu_task_reconciliation_no_update',
  'workbench_feishu_task_reconciliation_no_delete',
  'workbench_feishu_task_effect_intent_no_update',
  'workbench_feishu_task_effect_no_delete',
  'workbench_feishu_task_workflow_scope_no_update',
  'workbench_feishu_task_workflow_no_delete',
  'workbench_feishu_task_workflow_version_no_update',
  'workbench_feishu_task_workflow_version_no_delete',
  'workbench_feishu_task_workflow_operation_intent_no_update',
  'workbench_feishu_task_workflow_operation_no_delete',
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

  async readFeishuConnection(
    query: WorkbenchFeishuConnectionQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchStoredFeishuConnectionProjection> {
    throwIfAborted(signal)
    validateFeishuConnectionQuery(query)
    const projection = readFeishuConnectionProjection(
      this.requireDatabase(),
      query.organizationId,
      query.teamId,
    )
    throwIfAborted(signal)
    return projection
  }

  async commitFeishuRoute(
    mutation: WorkbenchFeishuRouteMutation,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuIdentityRouteResult> {
    throwIfAborted(signal)
    validateFeishuRouteMutation(mutation)
    const database = this.requireDatabase()
    const vocabulary = feishuRouteVocabulary(mutation.mode)
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = feishuRouteRequestHash(mutation, vocabulary.commandType)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== vocabulary.commandType
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return feishuIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeFeishuRouteResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const connection = readFeishuConnectionRow(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
      )
      const currentRevision = connection?.revision ?? 0
      if (currentRevision !== mutation.expectedConnectionRevision) {
        database.exec('ROLLBACK')
        began = false
        return feishuConnectionRevisionConflict(
          mutation.expectedConnectionRevision,
          currentRevision,
        )
      }
      const currentRoute = readCurrentFeishuRoute(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
      )
      const currentGeneration = currentRoute?.generation ?? null
      if (currentGeneration !== mutation.expectedRouteGeneration) {
        database.exec('ROLLBACK')
        began = false
        return feishuRouteGenerationConflict(
          mutation.kind,
          mutation.expectedRouteGeneration,
          currentGeneration,
        )
      }
      if (mutation.mode !== 'set'
        && (currentRoute === null || currentRoute.state !== 'configured')) {
        database.exec('ROLLBACK')
        began = false
        return feishuRouteStateError('route-unconfigured', mutation.kind)
      }
      if (mutation.mode === 'set'
        && currentRoute !== null
        && currentRoute.state === 'configured'
        && currentRoute.app_id === mutation.appId
        && currentRoute.credential_ref === mutation.credentialRef) {
        database.exec('ROLLBACK')
        began = false
        return feishuRouteStateError('no-op-route-configuration', mutation.kind)
      }
      if (currentRevision >= Number.MAX_SAFE_INTEGER
        || (currentRoute?.generation ?? 0) >= Number.MAX_SAFE_INTEGER
        || (mutation.mode === 'reset'
          && (currentRoute?.identity_epoch ?? 0) >= Number.MAX_SAFE_INTEGER)) {
        throw new Error('Workbench Feishu connection revision exhausted')
      }
      const nextRevision = currentRevision + 1
      const nextGeneration = (currentRoute?.generation ?? 0) + 1
      // Config generations fence stale commands; only an explicit reset starts new identity continuity.
      const nextIdentityEpoch = currentRoute === null
        ? 1
        : mutation.mode === 'reset'
          ? currentRoute.identity_epoch + 1
          : currentRoute.identity_epoch
      const appId = mutation.mode === 'set'
        ? mutation.appId as string
        : currentRoute?.app_id as string
      const credentialRef = mutation.mode === 'set'
        ? mutation.credentialRef as string
        : currentRoute?.credential_ref as string
      const state = mutation.mode === 'disable' ? 'disabled' as const : 'configured' as const

      if (connection === null) {
        const inserted = database.prepare(`
          INSERT INTO workbench_feishu_connection (
            organization_id, team_id, connection_id, realm, revision, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          FEISHU_CONNECTION_ID_VALUE,
          FEISHU_REALM,
          nextRevision,
          mutation.updatedAt,
        )
        if (inserted.changes !== 1) {
          throw new Error('Workbench Feishu connection was not inserted exactly once')
        }
      } else {
        const advanced = database.prepare(`
          UPDATE workbench_feishu_connection SET revision = ?, updated_at = ?
          WHERE organization_id = ? AND team_id = ? AND revision = ?
        `).run(
          nextRevision,
          mutation.updatedAt,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          currentRevision,
        )
        if (advanced.changes !== 1) {
          throw new Error('Workbench Feishu connection did not advance exactly once')
        }
      }
      const insertedRoute = database.prepare(`
        INSERT INTO workbench_feishu_route_version (
          organization_id, team_id, kind, generation, identity_epoch, state,
          app_id, credential_ref, command_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
        nextGeneration,
        nextIdentityEpoch,
        state,
        appId,
        credentialRef,
        mutation.command.commandId,
        mutation.updatedAt,
      )
      if (insertedRoute.changes !== 1) {
        throw new Error('Workbench Feishu route version was not inserted exactly once')
      }

      const committed = Object.freeze({
        ok: true,
        value: Object.freeze({
          connectionId: FEISHU_CONNECTION_ID_VALUE,
          connectionRevision: nextRevision,
          kind: mutation.kind,
          routeGeneration: nextGeneration,
          state,
        }),
        receipt: Object.freeze({
          commandId: mutation.command.commandId,
          auditEventId: mutation.command.auditEventId,
          outboxId: mutation.command.outboxId,
        }),
      }) satisfies Extract<ConfigureFeishuIdentityRouteResult, { readonly ok: true }>
      appendFeishuLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: vocabulary.commandType,
        auditAction: vocabulary.auditAction,
        summaryCode: vocabulary.summaryCode,
        changedFields: mutation.mode === 'set'
          ? ['route', 'credentialRef']
          : mutation.mode === 'reset' ? ['route', 'identityBinding'] : ['route', 'state'],
        outboxTopic: FEISHU_ROUTE_OUTBOX_TOPIC,
        connectionRevision: nextRevision,
        routeKind: mutation.kind,
        routeGeneration: nextGeneration,
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

  async replayFeishuVerification(
    query: WorkbenchFeishuVerificationReplayQuery,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult | null> {
    throwIfAborted(signal)
    validateFeishuVerificationReplayQuery(query)
    const database = this.requireDatabase()
    const receipt = database.prepare(`
      SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
      FROM workbench_command_receipt
      WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
    `).get(
      query.organizationId,
      query.actorId,
      idempotencyKeyHash(query.idempotencyKey),
    ) as ReceiptRow | undefined
    if (receipt === undefined) return null
    const requestHash = feishuVerificationRequestHash(query)
    if (receipt.command_type !== FEISHU_VERIFY_COMMAND_TYPE
      || receipt.request_hash !== requestHash) {
      return feishuVerificationIdempotencyConflict()
    }
    assertValidLedger(database)
    throwIfAborted(signal)
    return decodeFeishuVerificationResult(receipt.result_json, receipt)
  }

  async commitFeishuVerification(
    mutation: WorkbenchFeishuVerificationMutation,
    signal: AbortSignal,
  ): Promise<VerifyFeishuIdentityRouteResult> {
    throwIfAborted(signal)
    validateFeishuVerificationMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = feishuVerificationRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_VERIFY_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return feishuVerificationIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeFeishuVerificationResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }

      assertValidLedger(database)
      const connection = readFeishuConnectionRow(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
      )
      const currentRevision = connection?.revision ?? 0
      if (currentRevision !== mutation.expectedConnectionRevision) {
        database.exec('ROLLBACK')
        began = false
        return feishuVerificationConnectionRevisionConflict(
          mutation.expectedConnectionRevision,
          currentRevision,
        )
      }
      const currentRoute = readCurrentFeishuRoute(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
      )
      if (currentRoute === null) {
        database.exec('ROLLBACK')
        began = false
        return feishuVerificationRouteStateError('route-unconfigured', mutation.kind)
      }
      if (currentRoute.generation !== mutation.expectedRouteGeneration) {
        database.exec('ROLLBACK')
        began = false
        return feishuVerificationRouteGenerationConflict(
          mutation.kind,
          mutation.expectedRouteGeneration,
          currentRoute.generation,
        )
      }
      if (currentRoute.state === 'disabled') {
        database.exec('ROLLBACK')
        began = false
        return feishuVerificationRouteStateError('route-disabled', mutation.kind)
      }
      if (currentRevision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Workbench Feishu connection revision exhausted')
      }
      const existingBinding = readFeishuIdentityBinding(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
        currentRoute.identity_epoch,
      )
      const effective = enforceFeishuIdentityContinuity(
        mutation.observation,
        currentRoute,
        existingBinding,
      )
      if (existingBinding === null && effective.actor !== null
        && effective.identity.state === 'verified') {
        const bound = database.prepare(`
          INSERT INTO workbench_feishu_identity_binding (
            organization_id, team_id, kind, identity_epoch, route_generation,
            app_id, open_id, tenant_key, verification_id, bound_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          mutation.kind,
          currentRoute.identity_epoch,
          currentRoute.generation,
          effective.actor.appId,
          effective.actor.openId,
          effective.actor.tenantKey,
          mutation.verificationId,
          mutation.checkedAt,
        )
        if (bound.changes !== 1) {
          throw new Error('Workbench Feishu identity binding was not inserted exactly once')
        }
      }
      const routeSequence = integerField(database.prepare(`
        SELECT COUNT(*) AS count FROM workbench_feishu_verification
        WHERE organization_id = ? AND team_id = ? AND kind = ? AND route_generation = ?
      `).get(
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
        currentRoute.generation,
      ), 'count') + 1
      const nextRevision = currentRevision + 1
      const inserted = database.prepare(`
        INSERT INTO workbench_feishu_verification (
          route_sequence, id, organization_id, team_id, kind, route_generation,
          identity_epoch, connection_revision, result, identity_state, identity_issue_json,
          actor_app_id, actor_open_id, actor_tenant_key,
          display_label, scope_state, scopes_json, scope_issue_json,
          requested_resource_probe_json, resource_probe_json, command_id, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        routeSequence,
        mutation.verificationId,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.kind,
        currentRoute.generation,
        currentRoute.identity_epoch,
        nextRevision,
        effective.result,
        effective.identity.state,
        effective.identity.issue === null ? null : canonicalizeJson(effective.identity.issue),
        effective.actor?.appId ?? null,
        effective.actor?.openId ?? null,
        effective.actor?.tenantKey ?? null,
        effective.displayLabel,
        effective.scopeInspection.state,
        canonicalizeJson(effective.scopeInspection.scopes),
        effective.scopeInspection.issue === null
          ? null
          : canonicalizeJson(effective.scopeInspection.issue),
        canonicalizeJson(mutation.resourceProbe),
        canonicalizeJson(effective.resourceProbe),
        mutation.command.commandId,
        mutation.checkedAt,
      )
      if (inserted.changes !== 1) {
        throw new Error('Workbench Feishu verification was not inserted exactly once')
      }
      const advanced = database.prepare(`
        UPDATE workbench_feishu_connection SET revision = ?, updated_at = ?
        WHERE organization_id = ? AND team_id = ? AND revision = ?
      `).run(
        nextRevision,
        mutation.checkedAt,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        currentRevision,
      )
      if (advanced.changes !== 1) {
        throw new Error('Workbench Feishu verification did not advance its connection exactly once')
      }
      const committed = Object.freeze({
        ok: true,
        value: Object.freeze({
          connectionId: FEISHU_CONNECTION_ID_VALUE,
          connectionRevision: nextRevision,
          kind: mutation.kind,
          routeGeneration: currentRoute.generation,
          verificationSequence: routeSequence,
          result: effective.result,
        }),
        receipt: Object.freeze({
          commandId: mutation.command.commandId,
          auditEventId: mutation.command.auditEventId,
          outboxId: mutation.command.outboxId,
        }),
      }) satisfies Extract<VerifyFeishuIdentityRouteResult, { readonly ok: true }>
      appendFeishuLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: FEISHU_VERIFY_COMMAND_TYPE,
        auditAction: FEISHU_VERIFY_AUDIT_ACTION,
        summaryCode: feishuVerificationSummary(effective.result),
        changedFields: ['verification'],
        outboxTopic: FEISHU_VERIFY_OUTBOX_TOPIC,
        connectionRevision: nextRevision,
        routeKind: mutation.kind,
        routeGeneration: currentRoute.generation,
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

  async readProjectTasks(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<ProjectTasksProjection | null> {
    throwIfAborted(signal)
    validateProjectTasksReadQuery(query)
    const projection = readProjectTasksProjection(this.requireDatabase(), query)
    throwIfAborted(signal)
    return projection === null ? null : projectTasksProjection(projection)
  }

  async readFeishuTaskReconciliationTarget(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskReconciliationTarget | null> {
    throwIfAborted(signal)
    validateProjectTasksReadQuery(query)
    const database = this.requireDatabase()
    const project = readProjectScopeRow(
      database,
      query.organizationId,
      query.teamId,
      query.projectId,
    )
    if (project === null) return null
    const binding = readTaskBindingRow(database, query.projectId)
    if (binding === null) return null
    const target = Object.freeze({
      projectId: binding.project_id,
      revision: binding.revision,
      taskListGuid: binding.tasklist_guid,
      route: taskRouteFromBinding(database, binding.project_id),
    })
    throwIfAborted(signal)
    return target
  }

  async readFeishuTaskWorkflowContext(
    query: WorkbenchProjectTasksReadQuery,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskWorkflowContext | null> {
    throwIfAborted(signal)
    validateProjectTasksReadQuery(query)
    const database = this.requireDatabase()
    const project = readProjectTasksProjection(database, query)
    if (project === null || project.binding === null) return null
    const binding = readTaskBindingRow(database, query.projectId)
    if (binding === null) throw new Error('Workbench workflow context lost its task binding')
    const target = Object.freeze({
      projectId: binding.project_id,
      revision: binding.revision,
      taskListGuid: binding.tasklist_guid,
      route: taskRouteFromBinding(database, binding.project_id),
    })
    const rows = database.prepare(`
      SELECT value.project_id, value.task_guid, value.field_guid, value.field_type,
        value.single_select_option_guid, value.observed_at
      FROM workbench_feishu_task_custom_value AS value
      INNER JOIN workbench_feishu_task_projection AS task
        ON task.project_id = value.project_id AND task.task_guid = value.task_guid
      WHERE value.project_id = ? AND task.visible = 1
      ORDER BY value.task_guid, value.field_guid
      LIMIT ${MAX_FEISHU_TASKS_PER_PROJECT * MAX_CUSTOM_FIELDS_PER_TASK + 1}
    `).all(query.projectId) as unknown as FeishuTaskCustomValueRow[]
    if (rows.length > MAX_FEISHU_TASKS_PER_PROJECT * MAX_CUSTOM_FIELDS_PER_TASK) {
      throw new Error('Workbench workflow custom values exceed their bounded limit')
    }
    const byTask = new Map<string, WorkbenchFeishuTaskCustomFieldValue[]>()
    for (const row of rows) {
      const values = byTask.get(row.task_guid) ?? []
      values.push(Object.freeze({
        fieldGuid: row.field_guid,
        type: row.field_type,
        singleSelectOptionGuid: row.single_select_option_guid,
      }))
      byTask.set(row.task_guid, values)
    }
    const taskValues = Object.freeze(project.tasks.map(task => Object.freeze({
      taskGuid: task.taskGuid,
      values: Object.freeze(byTask.get(task.taskGuid) ?? []),
    })))
    throwIfAborted(signal)
    return Object.freeze({ project, target, taskValues })
  }

  async replayFeishuTaskWorkflowConfiguration(
    query: WorkbenchFeishuTaskWorkflowReplayQuery,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult | null> {
    throwIfAborted(signal)
    validateTaskWorkflowReplayQuery(query)
    const database = this.requireDatabase()
    const command: WorkbenchCommandMetadata = {
      commandId: 'replay-placeholder-command',
      auditEventId: 'replay-placeholder-audit',
      outboxId: 'replay-placeholder-outbox',
      idempotencyKey: query.idempotencyKey,
      causationId: query.causationId,
      reason: query.reason,
      actor: {
        kind: 'owner',
        id: query.actorId,
        organizationId: query.organizationId,
        teamId: query.teamId,
      },
      occurredAt: '1970-01-01T00:00:00.000Z',
    }
    const keyHash = idempotencyKeyHash(query.idempotencyKey)
    const requestHash = taskWorkflowRequestHash(query)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, command, keyHash)
      if (receipt === undefined) {
        const operation = readTaskWorkflowOperationByKey(
          database,
          query.organizationId,
          query.actorId,
          keyHash,
        )
        if (operation !== null) {
          if (operation.request_hash !== requestHash) {
            database.exec('COMMIT')
            began = false
            return taskIdempotencyConflict()
          }
          throw new Error('Workbench workflow operation lacks its receipt-first ledger')
        }
        database.exec('COMMIT')
        began = false
        return null
      }
      if (receipt.command_type !== FEISHU_TASK_WORKFLOW_COMMAND_TYPE
        || receipt.request_hash !== requestHash) {
        database.exec('COMMIT')
        began = false
        return taskIdempotencyConflict()
      }
      assertValidLedger(database)
      const operation = readTaskWorkflowOperationByCommand(database, receipt.command_id)
      if (operation === null) {
        const replay = decodeTaskWorkflowConfigurationResult(receipt.result_json, receipt)
        throwIfAborted(signal)
        database.exec('COMMIT')
        began = false
        return replay
      }
      if (operation.state === 'prepared') {
        database.exec('COMMIT')
        began = false
        return null
      }
      let replayOperation = operation
      if (replayOperation.state === 'inflight') {
        markTaskWorkflowOperationUnknown(database, replayOperation, replayOperation.updated_at)
        const recovered = readTaskWorkflowOperation(database, replayOperation.id)
        if (recovered === null) throw new Error('Workbench workflow operation recovery disappeared')
        replayOperation = recovered
      }
      const replay = replayOperation.state === 'delivered'
        ? deliveredTaskWorkflowOperationResult(database, replayOperation, receipt)
        : taskWorkflowOperationResult(replayOperation)
      throwIfAborted(signal)
      database.exec('COMMIT')
      began = false
      return replay
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async reserveFeishuTaskWorkflowOperation(
    mutation: WorkbenchFeishuTaskWorkflowOperationMutation,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskWorkflowOperationReservation> {
    throwIfAborted(signal)
    validateTaskWorkflowOperationMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = taskWorkflowRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_TASK_WORKFLOW_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return Object.freeze({ state: 'rejected', result: taskIdempotencyConflict() })
        }
        assertValidLedger(database)
        let operation = readTaskWorkflowOperationByCommand(database, receipt.command_id)
        if (operation === null) {
          const replay = decodeTaskWorkflowConfigurationResult(receipt.result_json, receipt)
          database.exec('COMMIT')
          began = false
          return Object.freeze({ state: 'replay', result: replay })
        }
        if (operation.state === 'prepared') {
          const reservedCommand = taskWorkflowOperationCommand(operation, mutation.command)
          database.exec('COMMIT')
          began = false
          return Object.freeze({
            state: 'deliver',
            operationId: operation.id,
            command: reservedCommand,
          })
        }
        if (operation.state === 'inflight') {
          markTaskWorkflowOperationUnknown(database, operation, mutation.preparedAt)
          const recovered = readTaskWorkflowOperation(database, operation.id)
          if (recovered === null) throw new Error('Workbench workflow operation recovery disappeared')
          operation = recovered
        }
        const replay = operation.state === 'delivered'
          ? deliveredTaskWorkflowOperationResult(database, operation, receipt)
          : taskWorkflowOperationResult(operation)
        database.exec('COMMIT')
        began = false
        return Object.freeze({ state: 'replay', result: replay })
      }
      let operation = readTaskWorkflowOperationByKey(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.id,
        keyHash,
      )
      if (operation !== null) {
        if (operation.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return Object.freeze({ state: 'rejected', result: taskIdempotencyConflict() })
        }
        throw new Error('Workbench workflow operation lacks its receipt-first ledger')
      }
      assertValidLedger(database)
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectScopeRow(
          database,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          mutation.projectId,
        )
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: project === null ? taskProjectNotFound(mutation.projectId) : taskListUnbound(),
        })
      }
      if (binding.organization_id !== mutation.command.actor.organizationId
        || binding.team_id !== mutation.command.actor.teamId) {
        throw new Error('Workbench workflow operation escaped its authorized Project')
      }
      if (binding.revision !== mutation.expectedTaskRevision) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: taskProjectionRevisionConflict(mutation.expectedTaskRevision, binding.revision),
        })
      }
      const workflow = readTaskWorkflowRow(database, mutation.projectId)
      const currentWorkflowRevision = workflow?.revision ?? null
      if (currentWorkflowRevision !== mutation.expectedWorkflowRevision) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: Object.freeze({
            ok: false,
            error: Object.freeze({
              code: 'workflow-revision-conflict',
              message: 'Task workflow revision changed before the provider write was reserved',
            }),
          }),
        })
      }
      if ((mutation.mapping.mode === 'create') !== (workflow === null)) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: workflowCompatibilityBlockedResult(
            mutation.mapping.mode === 'create'
              ? 'An existing workflow cannot create a second field'
              : 'A workflow must exist before it can be migrated',
          ),
        })
      }
      const inserted = database.prepare(`
        INSERT INTO workbench_feishu_task_workflow_operation (
          id, project_id, organization_id, team_id, actor_id,
          expected_task_revision, expected_workflow_revision, mapping_mode,
          definition_json, mapping_json,
          request_hash, idempotency_key_hash, state, issue_json, attempt_count,
          command_id, audit_event_id, outbox_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, 0, ?, ?, ?, ?, ?)
      `).run(
        mutation.operationId,
        mutation.projectId,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.command.actor.id,
        mutation.expectedTaskRevision,
        mutation.expectedWorkflowRevision,
        mutation.mapping.mode,
        canonicalizeJson(projectTaskWorkflowDefinition(mutation.definition)),
        canonicalizeJson(normalizedWorkflowMapping(mutation.mapping)),
        requestHash,
        keyHash,
        mutation.command.commandId,
        mutation.command.auditEventId,
        mutation.command.outboxId,
        mutation.preparedAt,
        mutation.preparedAt,
      )
      if (inserted.changes !== 1) throw new Error('Workbench workflow operation was not reserved')
      const accepted = taskWorkflowOperationAcceptedResult(mutation)
      appendFeishuTaskLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
        auditAction: FEISHU_TASK_WORKFLOW_AUDIT_ACTION,
        summaryCode: FEISHU_TASK_WORKFLOW_SUMMARY,
        objectType: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
        objectId: mutation.projectId,
        objectVersion: (mutation.expectedWorkflowRevision ?? 0) + 1,
        changedFields: ['workflowDefinition', 'fieldMapping', 'compatibility'],
        outboxTopic: FEISHU_TASK_WORKFLOW_OUTBOX_TOPIC,
        result: accepted,
      })
      database.exec('COMMIT')
      began = false
      return Object.freeze({
        state: 'deliver',
        operationId: mutation.operationId,
        command: mutation.command,
      })
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async claimFeishuTaskWorkflowOperation(
    operationId: string,
    claimedAt: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    validateBoundedReference(operationId, 'Feishu workflow operation id')
    canonicalInstant(claimedAt, 'Feishu workflow operation claimedAt')
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const operation = readTaskWorkflowOperation(database, operationId)
      if (operation === null || operation.state !== 'prepared') {
        database.exec('COMMIT')
        began = false
        return false
      }
      const updated = database.prepare(`
        UPDATE workbench_feishu_task_workflow_operation
        SET state = 'inflight', attempt_count = 1, updated_at = ?
        WHERE id = ? AND state = 'prepared' AND attempt_count = 0
      `).run(claimedAt, operationId)
      if (updated.changes !== 1) throw new Error('Workbench workflow operation claim lost its CAS')
      const outbox = database.prepare(`
        UPDATE workbench_outbox SET attempt_count = 1, updated_at = ?
        WHERE id = ? AND state = 'pending' AND attempt_count = 0
      `).run(claimedAt, operation.outbox_id)
      if (outbox.changes !== 1) throw new Error('Workbench workflow operation Outbox was not claimed')
      database.exec('COMMIT')
      began = false
      return true
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async settleFeishuTaskWorkflowOperation(
    operationId: string,
    settlement:
      | Readonly<{
        readonly state: 'unknown' | 'failed'
        readonly issue: FeishuConnectionIssue
        readonly settledAt: string
      }>
      | Readonly<{
        readonly state: 'conflict'
        readonly settledAt: string
      }>,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult> {
    throwIfAborted(signal)
    validateBoundedReference(operationId, 'Feishu workflow operation id')
    if (settlement.state !== 'unknown' && settlement.state !== 'failed'
      && settlement.state !== 'conflict') {
      throw new TypeError('Feishu workflow operation settlement is unsupported')
    }
    if (settlement.state !== 'conflict') {
      safeFeishuIssue(settlement.issue, 'Feishu workflow operation issue')
    }
    canonicalInstant(settlement.settledAt, 'Feishu workflow operation settledAt')
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const operation = readTaskWorkflowOperation(database, operationId)
      if (operation === null) throw new Error('Workbench workflow operation was not found')
      if (operation.state === 'unknown' || operation.state === 'failed'
        || operation.state === 'conflict') {
        const replay = taskWorkflowOperationResult(operation)
        database.exec('COMMIT')
        began = false
        return replay
      }
      if (operation.state === 'delivered') {
        const receipt = readFeishuReceiptByCommand(database, operation.command_id)
        if (receipt === undefined) {
          throw new Error('Workbench delivered workflow operation lacks its receipt')
        }
        const replay = deliveredTaskWorkflowOperationResult(database, operation, receipt)
        database.exec('COMMIT')
        began = false
        return replay
      }
      if (operation.state !== 'inflight' || operation.attempt_count !== 1) {
        throw new Error('Workbench workflow operation is not claimable for settlement')
      }
      const updated = database.prepare(`
        UPDATE workbench_feishu_task_workflow_operation
        SET state = ?, issue_json = ?, updated_at = ?
        WHERE id = ? AND state = 'inflight' AND attempt_count = 1
      `).run(
        settlement.state,
        settlement.state === 'conflict' ? null : canonicalizeJson(settlement.issue),
        settlement.settledAt,
        operationId,
      )
      if (updated.changes !== 1) throw new Error('Workbench workflow operation settlement lost its CAS')
      const outboxState = settlement.state === 'unknown' ? 'unknown' : 'failed'
      const outboxError = settlement.state === 'unknown'
        ? 'transport-ambiguous'
        : 'definitive-rejection'
      const outbox = database.prepare(`
        UPDATE workbench_outbox SET state = ?, error_code = ?, claim_token = NULL,
          claimed_at = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND state = 'pending' AND attempt_count = 1
      `).run(outboxState, outboxError, settlement.settledAt, operation.outbox_id)
      if (outbox.changes !== 1) {
        throw new Error('Workbench workflow operation Outbox was not settled')
      }
      const settled = readTaskWorkflowOperation(database, operationId)
      if (settled === null) throw new Error('Workbench settled workflow operation disappeared')
      const result = taskWorkflowOperationResult(settled)
      database.exec('COMMIT')
      began = false
      return result
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitFeishuTaskWorkflowConfiguration(
    mutation: WorkbenchFeishuTaskWorkflowConfigurationMutation,
    signal: AbortSignal,
  ): Promise<ConfigureFeishuTaskWorkflowResult> {
    throwIfAborted(signal)
    validateTaskWorkflowConfigurationMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = taskWorkflowRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      const externalOperation = mutation.mapping.mode === 'existing'
        ? null
        : readTaskWorkflowOperation(database, mutation.operationId as string)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_TASK_WORKFLOW_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return taskIdempotencyConflict()
        }
        assertValidLedger(database)
        if (externalOperation === null && mutation.mapping.mode === 'existing') {
          const replay = decodeTaskWorkflowConfigurationResult(receipt.result_json, receipt)
          database.exec('COMMIT')
          began = false
          return replay
        }
        if (externalOperation === null) {
          throw new Error('Workbench workflow configuration lacks its reserved provider operation')
        }
        if (externalOperation.state === 'delivered') {
          const replay = deliveredTaskWorkflowOperationResult(database, externalOperation, receipt)
          database.exec('COMMIT')
          began = false
          return replay
        }
        if (externalOperation.state === 'unknown' || externalOperation.state === 'failed'
          || externalOperation.state === 'conflict') {
          const replay = taskWorkflowOperationResult(externalOperation)
          database.exec('COMMIT')
          began = false
          return replay
        }
      } else {
        assertValidLedger(database)
        if (externalOperation !== null || mutation.mapping.mode !== 'existing') {
          throw new Error('Workbench workflow provider operation lacks its receipt-first ledger')
        }
      }
      if (mutation.mapping.mode !== 'existing'
        && (externalOperation === null
          || externalOperation.state !== 'inflight'
          || externalOperation.attempt_count !== 1
          || externalOperation.request_hash !== requestHash
          || externalOperation.command_id !== mutation.command.commandId
          || externalOperation.audit_event_id !== mutation.command.auditEventId
          || externalOperation.outbox_id !== mutation.command.outboxId)) {
        throw new Error('Workbench workflow configuration lacks its claimed provider operation')
      }
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectScopeRow(
          database,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          mutation.projectId,
        )
        database.exec('ROLLBACK')
        began = false
        return project === null ? taskProjectNotFound(mutation.projectId) : taskListUnbound()
      }
      if (binding.organization_id !== mutation.command.actor.organizationId
        || binding.team_id !== mutation.command.actor.teamId) {
        throw new Error('Workbench workflow mutation escaped its authorized Project')
      }
      if (binding.revision !== mutation.expectedTaskRevision) {
        if (externalOperation !== null) {
          const result = markTaskWorkflowCommitConflictUnknown(
            database,
            externalOperation,
            mutation.configuredAt,
          )
          database.exec('COMMIT')
          began = false
          return result
        }
        database.exec('ROLLBACK')
        began = false
        return taskProjectionRevisionConflict(mutation.expectedTaskRevision, binding.revision)
      }
      const current = readTaskWorkflowRow(database, mutation.projectId)
      const currentRevision = current?.revision ?? null
      if (currentRevision !== mutation.expectedWorkflowRevision) {
        if (externalOperation !== null) {
          const result = markTaskWorkflowCommitConflictUnknown(
            database,
            externalOperation,
            mutation.configuredAt,
          )
          database.exec('COMMIT')
          began = false
          return result
        }
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: 'workflow-revision-conflict' as const,
            message: 'Task workflow revision changed before configuration committed',
          }),
        })
      }
      if (current !== null && current.field_guid !== mutation.field.fieldGuid) {
        if (externalOperation !== null) {
          const result = markTaskWorkflowCommitConflictUnknown(
            database,
            externalOperation,
            mutation.configuredAt,
          )
          database.exec('COMMIT')
          began = false
          return result
        }
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: 'workflow-compatibility-blocked' as const,
            message: 'An existing workflow cannot silently change its Feishu field identity',
          }),
        })
      }
      if (mutation.compatibility.state === 'blocked') {
        if (externalOperation !== null) {
          const result = markTaskWorkflowCommitConflictUnknown(
            database,
            externalOperation,
            mutation.configuredAt,
          )
          database.exec('COMMIT')
          began = false
          return result
        }
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: 'workflow-compatibility-blocked' as const,
            message: 'Workflow compatibility checks blocked configuration',
            compatibility: mutation.compatibility,
          }),
        })
      }
      const workflowRevision = currentRevision === null
        ? 1
        : incrementRevision(currentRevision, 'Feishu workflow')
      const taskRevision = incrementRevision(binding.revision, 'Feishu task projection')
      const definitionJson = canonicalizeJson(projectTaskWorkflowDefinition(mutation.definition))
      const mappingJson = canonicalizeJson(normalizedWorkflowMapping(mutation.mapping))
      const optionsJson = canonicalizeJson(mutation.field.options)
      const issuesJson = canonicalizeJson(mutation.compatibility.issues)
      if (current === null) {
        const inserted = database.prepare(`
          INSERT INTO workbench_feishu_task_workflow (
            project_id, organization_id, team_id, revision, field_guid, field_name,
            field_type, field_remote_version, definition_json, options_json,
            compatibility_state, compatibility_issues_json, configured_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'single_select', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mutation.projectId,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          workflowRevision,
          mutation.field.fieldGuid,
          mutation.field.name,
          mutation.field.remoteVersion,
          definitionJson,
          optionsJson,
          mutation.compatibility.state,
          issuesJson,
          mutation.configuredAt,
          mutation.configuredAt,
        )
        if (inserted.changes !== 1) throw new Error('Workbench workflow was not inserted')
      } else {
        const updated = database.prepare(`
          UPDATE workbench_feishu_task_workflow SET revision = ?, field_name = ?,
            field_remote_version = ?, definition_json = ?, options_json = ?,
            compatibility_state = ?, compatibility_issues_json = ?, updated_at = ?
          WHERE project_id = ? AND revision = ?
        `).run(
          workflowRevision,
          mutation.field.name,
          mutation.field.remoteVersion,
          definitionJson,
          optionsJson,
          mutation.compatibility.state,
          issuesJson,
          mutation.configuredAt,
          mutation.projectId,
          current.revision,
        )
        if (updated.changes !== 1) throw new Error('Workbench workflow update lost its CAS')
      }
      const version = database.prepare(`
        INSERT INTO workbench_feishu_task_workflow_version (
          project_id, revision, field_guid, field_remote_version, definition_json,
          mapping_json, options_json, compatibility_state, compatibility_issues_json,
          command_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.projectId,
        workflowRevision,
        mutation.field.fieldGuid,
        mutation.field.remoteVersion,
        definitionJson,
        mappingJson,
        optionsJson,
        mutation.compatibility.state,
        issuesJson,
        mutation.command.commandId,
        mutation.configuredAt,
      )
      if (version.changes !== 1) throw new Error('Workbench workflow version was not appended')
      advanceTaskBindingRevision(database, binding, taskRevision, mutation.configuredAt)
      const value = readProjectTasksProjection(database, {
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
        projectId: mutation.projectId,
      })
      if (value === null || value.workflow === null) {
        throw new Error('Workbench configured workflow projection disappeared')
      }
      const committed = Object.freeze({
        ok: true,
        value,
        receipt: taskReceipt(mutation.command),
      }) satisfies Extract<ConfigureFeishuTaskWorkflowResult, { readonly ok: true }>
      if (externalOperation !== null) {
        const delivered = database.prepare(`
          UPDATE workbench_feishu_task_workflow_operation
          SET state = 'delivered', issue_json = NULL, updated_at = ?
          WHERE id = ? AND state = 'inflight' AND attempt_count = 1
        `).run(mutation.configuredAt, externalOperation.id)
        if (delivered.changes !== 1) {
          throw new Error('Workbench workflow provider operation was not committed as delivered')
        }
        const outbox = database.prepare(`
          UPDATE workbench_outbox SET state = 'delivered', error_code = NULL,
            claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND state = 'pending' AND attempt_count = 1
        `).run(mutation.configuredAt, externalOperation.outbox_id)
        if (outbox.changes !== 1) {
          throw new Error('Workbench workflow provider operation Outbox was not delivered')
        }
      } else {
        appendFeishuTaskLedger(database, {
          command: mutation.command,
          requestHash,
          commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
          auditAction: FEISHU_TASK_WORKFLOW_AUDIT_ACTION,
          summaryCode: FEISHU_TASK_WORKFLOW_SUMMARY,
          objectType: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
          objectId: mutation.projectId,
          objectVersion: workflowRevision,
          changedFields: ['workflowDefinition', 'fieldMapping', 'compatibility'],
          outboxTopic: FEISHU_TASK_WORKFLOW_OUTBOX_TOPIC,
          result: committed,
        })
      }
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async replayFeishuTaskListBinding(
    query: WorkbenchFeishuTaskListBindingReplayQuery,
    signal: AbortSignal,
  ): Promise<BindFeishuTaskListResult | null> {
    throwIfAborted(signal)
    validateTaskListBindingReplayQuery(query)
    const database = this.requireDatabase()
    const command: WorkbenchCommandMetadata = {
      commandId: 'replay-placeholder-command',
      auditEventId: 'replay-placeholder-audit',
      outboxId: 'replay-placeholder-outbox',
      idempotencyKey: query.idempotencyKey,
      causationId: query.causationId,
      reason: query.reason,
      actor: {
        kind: 'owner',
        id: query.actorId,
        organizationId: query.organizationId,
        teamId: query.teamId,
      },
      occurredAt: '1970-01-01T00:00:00.000Z',
    }
    const receipt = findFeishuReceipt(database, command, idempotencyKeyHash(query.idempotencyKey))
    if (receipt === undefined) return null
    if (receipt.command_type !== FEISHU_TASK_LIST_BIND_COMMAND_TYPE
      || receipt.request_hash !== taskListBindingRequestHash(query)) {
      return taskIdempotencyConflict()
    }
    assertValidLedger(database)
    throwIfAborted(signal)
    return decodeTaskListBindingResult(receipt.result_json, receipt)
  }

  async listFeishuTaskReconciliationTargets(
    signal: AbortSignal,
  ): Promise<readonly WorkbenchFeishuTaskReconciliationTarget[]> {
    throwIfAborted(signal)
    const database = this.requireDatabase()
    const rows = database.prepare(`
      SELECT project_id FROM workbench_feishu_task_binding
      ORDER BY project_id LIMIT ${MAX_FEISHU_TASKS_PER_PROJECT + 1}
    `).all() as unknown as Array<{ readonly project_id: string }>
    if (rows.length > MAX_FEISHU_TASKS_PER_PROJECT) {
      throw new Error('Workbench task-list bindings exceed the periodic repair bound')
    }
    const targets = rows.map(({ project_id: projectId }) => {
      const binding = readTaskBindingRow(database, projectId)
      if (binding === null) throw new Error('Workbench task-list target disappeared')
      return Object.freeze({
        projectId,
        revision: binding.revision,
        taskListGuid: binding.tasklist_guid,
        route: taskRouteFromBinding(database, projectId),
      })
    })
    throwIfAborted(signal)
    return Object.freeze(targets)
  }

  async commitFeishuTaskListBinding(
    mutation: WorkbenchFeishuTaskListBindingMutation,
    signal: AbortSignal,
  ): Promise<BindFeishuTaskListResult> {
    throwIfAborted(signal)
    validateTaskListBindingMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = taskListBindingRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_TASK_LIST_BIND_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return taskIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeTaskListBindingResult(receipt.result_json, receipt)
        database.exec('COMMIT')
        began = false
        return replay
      }
      assertValidLedger(database)
      const project = readProjectScopeRow(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.projectId,
      )
      if (project === null) {
        database.exec('ROLLBACK')
        began = false
        return taskProjectNotFound(mutation.projectId)
      }
      const existing = readTaskBindingRow(database, mutation.projectId)
      if (existing !== null) {
        const current = readProjectTasksProjection(database, {
          organizationId: mutation.command.actor.organizationId,
          teamId: mutation.command.actor.teamId,
          projectId: mutation.projectId,
        })
        if (current === null) throw new Error('Workbench task binding escaped its Project')
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          ok: false,
          error: Object.freeze({
            code: 'task-list-already-bound',
            message: 'Project already has a primary Feishu task list',
            current,
          }),
        })
      }
      const connection = readFeishuConnectionRow(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
      )
      const currentConnectionRevision = connection?.revision ?? 0
      if (currentConnectionRevision !== mutation.expectedConnectionRevision) {
        database.exec('ROLLBACK')
        began = false
        return taskConnectionRevisionConflict(
          mutation.expectedConnectionRevision,
          currentConnectionRevision,
        )
      }
      const route = readCurrentFeishuRoute(
        database,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.route.kind,
      )
      const routeFailure = validateTaskRouteForCommit(database, route, mutation.route)
      if (routeFailure !== null) {
        database.exec('ROLLBACK')
        began = false
        return routeFailure
      }
      const inserted = database.prepare(`
        INSERT INTO workbench_feishu_task_binding (
          project_id, organization_id, team_id, revision, tasklist_guid,
          tasklist_name, canonical_url, route_kind, route_generation, app_id,
          open_id, tenant_key, created_by_workbench, remote_version, sync_state,
          sync_issue_json, last_event_at, last_reconciled_at, last_attempt_at,
          reconcile_generation, bound_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy',
          NULL, NULL, ?, ?, 1, ?, ?)
      `).run(
        mutation.projectId,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.snapshot.taskList.taskListGuid,
        mutation.snapshot.taskList.name,
        mutation.snapshot.taskList.canonicalUrl,
        mutation.route.kind,
        mutation.route.routeGeneration,
        mutation.route.appId,
        mutation.route.actor.openId,
        mutation.route.actor.tenantKey,
        mutation.createdByWorkbench ? 1 : 0,
        mutation.snapshot.taskList.remoteVersion,
        mutation.snapshot.observedAt,
        mutation.snapshot.observedAt,
        mutation.boundAt,
        mutation.boundAt,
      )
      if (inserted.changes !== 1) {
        throw new Error('Workbench Feishu task-list binding was not inserted exactly once')
      }
      for (const task of mutation.snapshot.tasks) {
        upsertTaskProjection(database, mutation.projectId, task, 'primary-list', 1, 1, mutation.boundAt)
      }
      insertTaskReconciliation(database, {
        projectId: mutation.projectId,
        bindingRevision: 1,
        generation: 1,
        outcome: 'healthy',
        issue: null,
        taskCount: mutation.snapshot.tasks.length,
        snapshotDigest: taskListSnapshotDigest(mutation.snapshot),
        attemptedAt: mutation.snapshot.observedAt,
      })
      const value = readProjectTasksProjection(database, {
        organizationId: mutation.command.actor.organizationId,
        teamId: mutation.command.actor.teamId,
        projectId: mutation.projectId,
      })
      if (value === null) throw new Error('Workbench task binding projection disappeared')
      const committed = Object.freeze({
        ok: true,
        value,
        receipt: taskReceipt(mutation.command),
      }) satisfies Extract<BindFeishuTaskListResult, { readonly ok: true }>
      appendFeishuTaskLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: FEISHU_TASK_LIST_BIND_COMMAND_TYPE,
        auditAction: FEISHU_TASK_LIST_BIND_AUDIT_ACTION,
        summaryCode: FEISHU_TASK_LIST_BIND_SUMMARY,
        objectType: FEISHU_TASK_LIST_BIND_OBJECT_TYPE,
        objectId: mutation.projectId,
        objectVersion: 1,
        changedFields: ['taskList', 'tasks', 'sync'],
        outboxTopic: FEISHU_TASK_LIST_BIND_OUTBOX_TOPIC,
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

  async commitFeishuTaskReconciliation(
    mutation: WorkbenchFeishuTaskReconciliationMutation,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult> {
    throwIfAborted(signal)
    validateTaskReconciliationMutation(mutation)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectById(database, mutation.projectId)
        database.exec('ROLLBACK')
        began = false
        return project === null
          ? taskProjectNotFound(mutation.projectId)
          : taskListUnbound()
      }
      if (binding.revision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return taskProjectionRevisionConflict(mutation.expectedRevision, binding.revision)
      }
      if (binding.tasklist_guid !== mutation.snapshot.taskList.taskListGuid) {
        throw new Error('Workbench reconciliation snapshot escaped its bound task list')
      }
      const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
      const nextGeneration = incrementRevision(binding.reconcile_generation, 'Feishu reconciliation')
      database.prepare(`
        UPDATE workbench_feishu_task_projection
        SET visible = CASE
          WHEN EXISTS (
            SELECT 1 FROM workbench_feishu_task_reference AS reference
            WHERE reference.project_id = workbench_feishu_task_projection.project_id
              AND reference.task_guid = workbench_feishu_task_projection.task_guid
          ) THEN 1 ELSE 0 END,
          scope = CASE
            WHEN EXISTS (
              SELECT 1 FROM workbench_feishu_task_reference AS reference
              WHERE reference.project_id = workbench_feishu_task_projection.project_id
                AND reference.task_guid = workbench_feishu_task_projection.task_guid
            ) THEN 'explicit-reference' ELSE scope END,
          updated_at = ?
        WHERE project_id = ? AND scope = 'primary-list'
      `).run(mutation.attemptedAt, mutation.projectId)
      for (const task of mutation.snapshot.tasks) {
        const referenced = taskReferenceExists(database, mutation.projectId, task.taskGuid)
        upsertTaskProjection(
          database,
          mutation.projectId,
          task,
          referenced ? 'explicit-reference' : 'primary-list',
          nextRevision,
          nextGeneration,
          mutation.attemptedAt,
        )
      }
      const advanced = database.prepare(`
        UPDATE workbench_feishu_task_binding SET
          revision = ?, tasklist_name = ?, canonical_url = ?, remote_version = ?,
          sync_state = 'healthy', sync_issue_json = NULL,
          last_reconciled_at = ?, last_attempt_at = ?, reconcile_generation = ?, updated_at = ?
        WHERE project_id = ? AND revision = ?
      `).run(
        nextRevision,
        mutation.snapshot.taskList.name,
        mutation.snapshot.taskList.canonicalUrl,
        mutation.snapshot.taskList.remoteVersion,
        mutation.snapshot.observedAt,
        mutation.attemptedAt,
        nextGeneration,
        mutation.attemptedAt,
        mutation.projectId,
        binding.revision,
      )
      if (advanced.changes !== 1) throw new Error('Workbench task reconciliation lost its CAS')
      insertTaskReconciliation(database, {
        projectId: mutation.projectId,
        bindingRevision: nextRevision,
        generation: nextGeneration,
        outcome: 'healthy',
        issue: null,
        taskCount: mutation.snapshot.tasks.length,
        snapshotDigest: taskListSnapshotDigest(mutation.snapshot),
        attemptedAt: mutation.attemptedAt,
      })
      const value = readProjectTasksProjection(database, {
        organizationId: binding.organization_id,
        teamId: binding.team_id,
        projectId: binding.project_id,
      })
      if (value === null) throw new Error('Workbench reconciled projection disappeared')
      database.exec('COMMIT')
      began = false
      return Object.freeze({ ok: true, value })
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitFeishuTaskReconciliationFailure(
    mutation: WorkbenchFeishuTaskReconciliationFailureMutation,
    signal: AbortSignal,
  ): Promise<ReconcileProjectTasksResult> {
    throwIfAborted(signal)
    validateTaskReconciliationFailureMutation(mutation)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectById(database, mutation.projectId)
        database.exec('ROLLBACK')
        began = false
        return project === null ? taskProjectNotFound(mutation.projectId) : taskListUnbound()
      }
      if (binding.revision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return taskProjectionRevisionConflict(mutation.expectedRevision, binding.revision)
      }
      const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
      const nextGeneration = incrementRevision(binding.reconcile_generation, 'Feishu reconciliation')
      const issueJson = canonicalizeJson(mutation.issue)
      const advanced = database.prepare(`
        UPDATE workbench_feishu_task_binding SET revision = ?, sync_state = 'attention',
          sync_issue_json = ?, last_attempt_at = ?, reconcile_generation = ?, updated_at = ?
        WHERE project_id = ? AND revision = ?
      `).run(
        nextRevision,
        issueJson,
        mutation.attemptedAt,
        nextGeneration,
        mutation.attemptedAt,
        mutation.projectId,
        binding.revision,
      )
      if (advanced.changes !== 1) throw new Error('Workbench task failure fact lost its CAS')
      insertTaskReconciliation(database, {
        projectId: mutation.projectId,
        bindingRevision: nextRevision,
        generation: nextGeneration,
        outcome: 'attention',
        issue: mutation.issue,
        taskCount: 0,
        snapshotDigest: null,
        attemptedAt: mutation.attemptedAt,
      })
      const value = readProjectTasksProjection(database, {
        organizationId: binding.organization_id,
        teamId: binding.team_id,
        projectId: binding.project_id,
      })
      if (value === null) throw new Error('Workbench failed reconciliation projection disappeared')
      database.exec('COMMIT')
      began = false
      return Object.freeze({
        ok: false,
        error: Object.freeze({
          code: 'remote-rejected',
          message: 'Feishu task reconciliation was rejected',
          issue: cloneFeishuIssue(mutation.issue),
        }),
      })
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitFeishuTaskReference(
    mutation: WorkbenchFeishuTaskReferenceMutation,
    signal: AbortSignal,
  ): Promise<ReferenceFeishuTaskResult> {
    throwIfAborted(signal)
    validateTaskReferenceMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = taskReferenceRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_TASK_REFERENCE_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return taskIdempotencyConflict()
        }
        assertValidLedger(database)
        const replay = decodeTaskReferenceResult(receipt.result_json, receipt)
        database.exec('COMMIT')
        began = false
        return replay
      }
      assertValidLedger(database)
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectScopeRow(
          database,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          mutation.projectId,
        )
        database.exec('ROLLBACK')
        began = false
        return project === null ? taskProjectNotFound(mutation.projectId) : taskListUnbound()
      }
      if (binding.revision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return taskProjectionRevisionConflict(mutation.expectedRevision, binding.revision)
      }
      const current = readTaskProjectionRow(database, mutation.projectId, mutation.task.taskGuid)
      if (current?.visible === 1) {
        database.exec('ROLLBACK')
        began = false
        return taskAlreadyInProject(mutation.task.taskGuid)
      }
      const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
      upsertTaskProjection(
        database,
        mutation.projectId,
        mutation.task,
        'explicit-reference',
        nextRevision,
        binding.reconcile_generation,
        mutation.referencedAt,
      )
      const referenced = database.prepare(`
        INSERT INTO workbench_feishu_task_reference (
          project_id, task_guid, command_id, referenced_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        mutation.projectId,
        mutation.task.taskGuid,
        mutation.command.commandId,
        mutation.referencedAt,
      )
      if (referenced.changes !== 1) throw new Error('Workbench task reference was not inserted')
      advanceTaskBindingRevision(database, binding, nextRevision, mutation.referencedAt)
      const value = readProjectTasksProjection(database, {
        organizationId: binding.organization_id,
        teamId: binding.team_id,
        projectId: binding.project_id,
      })
      if (value === null) throw new Error('Workbench task reference projection disappeared')
      const committed = Object.freeze({
        ok: true,
        value,
        receipt: taskReceipt(mutation.command),
      }) satisfies Extract<ReferenceFeishuTaskResult, { readonly ok: true }>
      appendFeishuTaskLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: FEISHU_TASK_REFERENCE_COMMAND_TYPE,
        auditAction: FEISHU_TASK_REFERENCE_AUDIT_ACTION,
        summaryCode: FEISHU_TASK_REFERENCE_SUMMARY,
        objectType: FEISHU_TASK_OBJECT_TYPE,
        objectId: mutation.task.taskGuid,
        objectVersion: nextRevision,
        changedFields: ['scope', 'task'],
        outboxTopic: FEISHU_TASK_REFERENCE_OUTBOX_TOPIC,
        result: committed,
      })
      database.exec('COMMIT')
      began = false
      return committed
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async commitFeishuTaskEvent(
    mutation: WorkbenchFeishuTaskEventMutation,
    signal: AbortSignal,
  ): Promise<FeishuTaskEventResult> {
    throwIfAborted(signal)
    validateTaskEventMutation(mutation)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const duplicate = database.prepare(`
        SELECT project_id, outcome, projection_revision
        FROM workbench_feishu_task_inbox WHERE event_id = ?
      `).get(mutation.event.eventId) as {
        readonly project_id: string
        readonly outcome: string
        readonly projection_revision: number | null
      } | undefined
      if (duplicate !== undefined) {
        database.exec('COMMIT')
        began = false
        return Object.freeze({
          outcome: 'duplicate',
          projectId: duplicate.project_id,
          projectionRevision: duplicate.projection_revision,
        })
      }
      const binding = database.prepare(`
        SELECT project_id, organization_id, team_id, revision, tasklist_guid,
          tasklist_name, canonical_url, route_kind, route_generation, app_id,
          open_id, tenant_key, created_by_workbench, remote_version, sync_state,
          sync_issue_json, last_event_at, last_reconciled_at, last_attempt_at,
          reconcile_generation, bound_at, updated_at
        FROM workbench_feishu_task_binding WHERE tasklist_guid = ?
      `).get(mutation.event.taskListGuid) as FeishuTaskBindingRow | undefined
      if (binding === undefined) {
        database.exec('COMMIT')
        began = false
        return Object.freeze({ outcome: 'ignored', projectId: null, projectionRevision: null })
      }
      const current = readTaskProjectionRow(database, binding.project_id, mutation.event.taskGuid)
      const stale = current !== null
        && compareRemoteVersion(mutation.event.remoteVersion, current.remote_version) <= 0
      let outcome: 'applied' | 'stale' = stale ? 'stale' : 'applied'
      let projectionRevision: number | null = null
      if (!stale) {
        const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
        if (mutation.event.kind === 'upsert') {
          if (mutation.task === null || mutation.task.taskGuid !== mutation.event.taskGuid
            || mutation.task.remoteVersion !== mutation.event.remoteVersion) {
            throw new Error('Workbench Feishu upsert event lacks its exact task observation')
          }
          const referenced = taskReferenceExists(database, binding.project_id, mutation.event.taskGuid)
          upsertTaskProjection(
            database,
            binding.project_id,
            mutation.task,
            referenced ? 'explicit-reference' : 'primary-list',
            nextRevision,
            binding.reconcile_generation,
            mutation.receivedAt,
          )
        } else if (current !== null) {
          const referenced = taskReferenceExists(database, binding.project_id, mutation.event.taskGuid)
          database.prepare(`
            UPDATE workbench_feishu_task_projection SET visible = ?, scope = ?,
              remote_version = ?, projection_revision = ?, updated_at = ?
            WHERE project_id = ? AND task_guid = ?
          `).run(
            referenced ? 1 : 0,
            referenced ? 'explicit-reference' : current.scope,
            mutation.event.remoteVersion,
            nextRevision,
            mutation.receivedAt,
            binding.project_id,
            mutation.event.taskGuid,
          )
        }
        database.prepare(`
          UPDATE workbench_feishu_task_binding SET revision = ?, sync_state = 'healthy',
            sync_issue_json = NULL, last_event_at = ?, updated_at = ?
          WHERE project_id = ? AND revision = ?
        `).run(
          nextRevision,
          mutation.event.occurredAt,
          mutation.receivedAt,
          binding.project_id,
          binding.revision,
        )
        projectionRevision = nextRevision
      }
      const inserted = database.prepare(`
        INSERT INTO workbench_feishu_task_inbox (
          event_id, project_id, tasklist_guid, task_guid, event_kind,
          remote_version, outcome, occurred_at, received_at, projection_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mutation.event.eventId,
        binding.project_id,
        mutation.event.taskListGuid,
        mutation.event.taskGuid,
        mutation.event.kind,
        mutation.event.remoteVersion,
        outcome,
        mutation.event.occurredAt,
        mutation.receivedAt,
        projectionRevision,
      )
      if (inserted.changes !== 1) throw new Error('Workbench Feishu task event was not inserted')
      database.exec('COMMIT')
      began = false
      return Object.freeze({ outcome, projectId: binding.project_id, projectionRevision })
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async reserveFeishuTaskUpdate(
    mutation: WorkbenchFeishuTaskUpdateReservationMutation,
    signal: AbortSignal,
  ): Promise<WorkbenchFeishuTaskUpdateReservation> {
    throwIfAborted(signal)
    validateTaskUpdateReservationMutation(mutation)
    const database = this.requireDatabase()
    const keyHash = idempotencyKeyHash(mutation.command.idempotencyKey)
    const requestHash = taskUpdateRequestHash(mutation)
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const receipt = findFeishuReceipt(database, mutation.command, keyHash)
      if (receipt !== undefined) {
        if (receipt.command_type !== FEISHU_TASK_UPDATE_COMMAND_TYPE
          || receipt.request_hash !== requestHash) {
          database.exec('ROLLBACK')
          began = false
          return Object.freeze({ state: 'rejected', result: taskIdempotencyConflict() })
        }
        assertValidLedger(database)
        let effect = readTaskEffectByCommand(database, receipt.command_id)
        if (effect === null) throw new Error('Workbench task update receipt lacks its effect')
        if (effect.state === 'prepared') {
          const route = taskRouteFromBinding(database, effect.project_id)
          database.exec('COMMIT')
          began = false
          return Object.freeze({
            state: 'deliver',
            route,
            patch: providerTaskPatchFromStored(effect.changes_json),
            effect: taskEffectProjection(effect),
            receipt: taskReceiptFromRow(effect),
          })
        }
        if (effect.state === 'inflight') {
          markInflightTaskEffectUnknown(database, effect, mutation.preparedAt)
          effect = readTaskEffect(database, effect.id)
          if (effect === null || effect.state !== 'unknown') {
            throw new Error('Workbench ambiguous task effect was not durably recovered')
          }
        }
        const result = taskUpdateResultFromEffect(database, effect)
        database.exec('COMMIT')
        began = false
        return Object.freeze({ state: 'replay', result })
      }
      assertValidLedger(database)
      const binding = readTaskBindingRow(database, mutation.projectId)
      if (binding === null) {
        const project = readProjectScopeRow(
          database,
          mutation.command.actor.organizationId,
          mutation.command.actor.teamId,
          mutation.projectId,
        )
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: project === null ? taskProjectNotFound(mutation.projectId) : taskUpdateListUnbound(),
        })
      }
      if (binding.revision !== mutation.expectedRevision) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: taskUpdateProjectionRevisionConflict(mutation.expectedRevision, binding.revision),
        })
      }
      const task = readTaskProjectionRow(database, mutation.projectId, mutation.taskGuid)
      if (task === null || task.visible !== 1) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({ state: 'rejected', result: taskNotInProject(mutation.taskGuid) })
      }
      if (task.remote_version !== mutation.expectedRemoteVersion) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({
          state: 'rejected',
          result: taskRemoteVersionConflict(
            mutation.taskGuid,
            mutation.expectedRemoteVersion,
            task.remote_version,
          ),
        })
      }
      const planned = planTaskUpdateChanges(database, binding, task, mutation)
      if (!planned.ok) {
        database.exec('ROLLBACK')
        began = false
        return Object.freeze({ state: 'rejected', result: planned.result })
      }
      const route = taskRouteFromBinding(database, mutation.projectId)
      const inserted = database.prepare(`
        INSERT INTO workbench_feishu_task_effect (
          id, project_id, organization_id, team_id, actor_id, task_guid,
          expected_project_revision, expected_remote_version, changes_json,
          request_hash, idempotency_key_hash, state, issue_json,
          current_remote_version, attempt_count, command_id, audit_event_id,
          outbox_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, NULL, 0, ?, ?, ?, ?, ?)
      `).run(
        mutation.effectId,
        mutation.projectId,
        mutation.command.actor.organizationId,
        mutation.command.actor.teamId,
        mutation.command.actor.id,
        mutation.taskGuid,
        mutation.expectedRevision,
        mutation.expectedRemoteVersion,
        canonicalizeJson(planned.storedChanges),
        requestHash,
        keyHash,
        mutation.command.commandId,
        mutation.command.auditEventId,
        mutation.command.outboxId,
        mutation.preparedAt,
        mutation.preparedAt,
      )
      if (inserted.changes !== 1) throw new Error('Workbench task effect was not reserved')
      const effect: FeishuTaskMutationEffectProjection = Object.freeze({
        effectId: mutation.effectId,
        taskGuid: mutation.taskGuid,
        state: 'prepared',
        expectedRemoteVersion: mutation.expectedRemoteVersion,
        createdAt: mutation.preparedAt,
        updatedAt: mutation.preparedAt,
      })
      const accepted = Object.freeze({
        ok: true,
        value: effect,
        receipt: taskReceipt(mutation.command),
      })
      appendFeishuTaskLedger(database, {
        command: mutation.command,
        requestHash,
        commandType: FEISHU_TASK_UPDATE_COMMAND_TYPE,
        auditAction: FEISHU_TASK_UPDATE_AUDIT_ACTION,
        summaryCode: FEISHU_TASK_UPDATE_SUMMARY,
        objectType: FEISHU_TASK_OBJECT_TYPE,
        objectId: mutation.taskGuid,
        objectVersion: mutation.expectedRevision,
        changedFields: ['remoteVersion', 'changes', 'effectState'],
        outboxTopic: FEISHU_TASK_UPDATE_OUTBOX_TOPIC,
        result: accepted,
      })
      database.exec('COMMIT')
      began = false
      return Object.freeze({
        state: 'deliver',
        route,
        patch: planned.providerPatch,
        effect,
        receipt: taskReceipt(mutation.command),
      })
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async claimFeishuTaskUpdate(
    effectId: string,
    claimedAt: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    validateReference(effectId, 'Feishu task effect id')
    canonicalInstant(claimedAt, 'Feishu task effect claimedAt')
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const effect = readTaskEffect(database, effectId)
      if (effect === null || effect.state !== 'prepared') {
        database.exec('COMMIT')
        began = false
        return false
      }
      const claimed = database.prepare(`
        UPDATE workbench_feishu_task_effect
        SET state = 'inflight', attempt_count = 1, updated_at = ?
        WHERE id = ? AND state = 'prepared' AND attempt_count = 0
      `).run(claimedAt, effectId)
      if (claimed.changes !== 1) throw new Error('Workbench task effect claim lost its CAS')
      const outbox = database.prepare(`
        UPDATE workbench_outbox SET attempt_count = 1, updated_at = ?
        WHERE id = ? AND state = 'pending' AND attempt_count = 0
      `).run(claimedAt, effect.outbox_id)
      if (outbox.changes !== 1) throw new Error('Workbench task effect Outbox was not claimed')
      database.exec('COMMIT')
      began = false
      return true
    } catch (error: unknown) {
      if (began) this.rollbackAfterFailure(database, error)
      throw error
    }
  }

  async settleFeishuTaskUpdate(
    effectId: string,
    settlement: WorkbenchFeishuTaskUpdateSettlement,
    signal: AbortSignal,
  ): Promise<UpdateFeishuTaskResult> {
    throwIfAborted(signal)
    validateReference(effectId, 'Feishu task effect id')
    validateTaskUpdateSettlement(settlement)
    const database = this.requireDatabase()
    let began = false
    try {
      database.exec('BEGIN IMMEDIATE')
      began = true
      const effect = readTaskEffect(database, effectId)
      if (effect === null) throw new Error('Workbench task effect does not exist')
      if (effect.state !== 'inflight') {
        const replay = effect.state === 'prepared'
          ? taskInflightUnknown(effect)
          : taskUpdateResultFromEffect(database, effect)
        database.exec('COMMIT')
        began = false
        return replay
      }
      const binding = readTaskBindingRow(database, effect.project_id)
      if (binding === null) throw new Error('Workbench task effect lost its binding')
      const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
      let nextState: FeishuTaskEffectRow['state']
      let issue: FeishuConnectionIssue | null = null
      let currentRemoteVersion: string | null = null
      let outboxState: 'delivered' | 'unknown' | 'failed'
      let outboxError: WorkbenchOutboxErrorCode | null
      if (settlement.state === 'delivered') {
        if (settlement.task.taskGuid !== effect.task_guid) {
          throw new Error('Workbench task effect settlement changed task identity')
        }
        const current = readTaskProjectionRow(database, effect.project_id, effect.task_guid)
        if (current === null) throw new Error('Workbench delivered task projection is missing')
        upsertTaskProjection(
          database,
          effect.project_id,
          settlement.task,
          current.scope === 'explicit-reference' ? 'explicit-reference' : 'primary-list',
          nextRevision,
          binding.reconcile_generation,
          settlement.settledAt,
        )
        nextState = 'delivered'
        outboxState = 'delivered'
        outboxError = null
      } else if (settlement.state === 'conflict') {
        if (settlement.current.taskGuid !== effect.task_guid) {
          throw new Error('Workbench task conflict changed task identity')
        }
        const current = readTaskProjectionRow(database, effect.project_id, effect.task_guid)
        if (current === null) throw new Error('Workbench conflicted task projection is missing')
        upsertTaskProjection(
          database,
          effect.project_id,
          settlement.current,
          current.scope === 'explicit-reference' ? 'explicit-reference' : 'primary-list',
          nextRevision,
          binding.reconcile_generation,
          settlement.settledAt,
        )
        nextState = 'conflict'
        currentRemoteVersion = settlement.current.remoteVersion
        outboxState = 'failed'
        outboxError = 'definitive-rejection'
      } else {
        nextState = settlement.state
        issue = cloneFeishuIssue(settlement.issue)
        outboxState = settlement.state === 'unknown' ? 'unknown' : 'failed'
        outboxError = settlement.state === 'unknown'
          ? 'transport-ambiguous'
          : 'definitive-rejection'
      }
      const settled = database.prepare(`
        UPDATE workbench_feishu_task_effect SET state = ?, issue_json = ?,
          current_remote_version = ?, updated_at = ?
        WHERE id = ? AND state = 'inflight' AND attempt_count = 1
      `).run(
        nextState,
        issue === null ? null : canonicalizeJson(issue),
        currentRemoteVersion,
        settlement.settledAt,
        effectId,
      )
      if (settled.changes !== 1) throw new Error('Workbench task effect settlement lost its CAS')
      const outbox = database.prepare(`
        UPDATE workbench_outbox SET state = ?, error_code = ?, claim_token = NULL,
          claimed_at = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND state = 'pending'
      `).run(outboxState, outboxError, settlement.settledAt, effect.outbox_id)
      if (outbox.changes !== 1) throw new Error('Workbench task effect Outbox was not settled')
      database.prepare(`
        UPDATE workbench_feishu_task_binding SET revision = ?,
          sync_state = CASE WHEN ? = 'unknown' THEN 'unknown' ELSE sync_state END,
          sync_issue_json = CASE WHEN ? = 'unknown' THEN ? ELSE sync_issue_json END,
          updated_at = ? WHERE project_id = ? AND revision = ?
      `).run(
        nextRevision,
        nextState,
        nextState,
        issue === null ? null : canonicalizeJson(issue),
        settlement.settledAt,
        effect.project_id,
        binding.revision,
      )
      const updated = readTaskEffect(database, effectId)
      if (updated === null) throw new Error('Workbench settled task effect disappeared')
      const result = taskUpdateResultFromEffect(database, updated)
      database.exec('COMMIT')
      began = false
      return result
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

interface FeishuRouteVocabulary {
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction:
    | typeof FEISHU_ROUTE_SET_AUDIT_ACTION
    | typeof FEISHU_ROUTE_RESET_AUDIT_ACTION
    | typeof FEISHU_ROUTE_DISABLE_AUDIT_ACTION
  readonly reason:
    | typeof FEISHU_ROUTE_SET_REASON
    | typeof FEISHU_ROUTE_RESET_REASON
    | typeof FEISHU_ROUTE_DISABLE_REASON
  readonly summaryCode:
    | typeof FEISHU_ROUTE_SET_SUMMARY
    | typeof FEISHU_ROUTE_RESET_SUMMARY
    | typeof FEISHU_ROUTE_DISABLE_SUMMARY
}

function feishuRouteVocabulary(mode: WorkbenchFeishuRouteMutation['mode']): FeishuRouteVocabulary {
  if (mode === 'set') {
    return {
      commandType: FEISHU_ROUTE_SET_COMMAND_TYPE,
      auditAction: FEISHU_ROUTE_SET_AUDIT_ACTION,
      reason: FEISHU_ROUTE_SET_REASON,
      summaryCode: FEISHU_ROUTE_SET_SUMMARY,
    }
  }
  if (mode === 'reset') {
    return {
      commandType: FEISHU_ROUTE_RESET_COMMAND_TYPE,
      auditAction: FEISHU_ROUTE_RESET_AUDIT_ACTION,
      reason: FEISHU_ROUTE_RESET_REASON,
      summaryCode: FEISHU_ROUTE_RESET_SUMMARY,
    }
  }
  return {
    commandType: FEISHU_ROUTE_DISABLE_COMMAND_TYPE,
    auditAction: FEISHU_ROUTE_DISABLE_AUDIT_ACTION,
    reason: FEISHU_ROUTE_DISABLE_REASON,
    summaryCode: FEISHU_ROUTE_DISABLE_SUMMARY,
  }
}

function readFeishuConnectionRow(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
): FeishuConnectionRow | null {
  const row = database.prepare(`
    SELECT organization_id, team_id, connection_id, realm, revision, updated_at
    FROM workbench_feishu_connection WHERE organization_id = ? AND team_id = ?
  `).get(organizationId, teamId) as FeishuConnectionRow | undefined
  if (row === undefined) return null
  if (row.organization_id !== organizationId || row.team_id !== teamId
    || row.connection_id !== FEISHU_CONNECTION_ID_VALUE || row.realm !== FEISHU_REALM) {
    throw new Error('Workbench database contains an invalid Feishu connection scope')
  }
  positiveInteger(row.revision, 'Feishu connection revision')
  canonicalInstant(row.updated_at, 'Feishu connection updatedAt')
  return row
}

function readCurrentFeishuRoute(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  kind: FeishuIdentityKind,
): FeishuRouteRow | null {
  const row = database.prepare(`
    SELECT organization_id, team_id, kind, generation, identity_epoch, state, app_id,
      credential_ref, command_id, created_at
    FROM workbench_feishu_route_version
    WHERE organization_id = ? AND team_id = ? AND kind = ?
    ORDER BY generation DESC LIMIT 1
  `).get(organizationId, teamId, kind) as FeishuRouteRow | undefined
  if (row === undefined) return null
  validateFeishuRouteRow(row, organizationId, teamId, kind)
  return row
}

function validateFeishuRouteRow(
  row: FeishuRouteRow,
  organizationId: string,
  teamId: string,
  kind: FeishuIdentityKind,
): void {
  if (row.organization_id !== organizationId || row.team_id !== teamId || row.kind !== kind
    || (row.state !== 'configured' && row.state !== 'disabled')) {
    throw new Error('Workbench database contains an invalid Feishu route scope')
  }
  positiveInteger(row.generation, 'Feishu route generation')
  positiveInteger(row.identity_epoch, 'Feishu route identity epoch')
  validateFeishuAppId(row.app_id, 'Feishu route app id')
  validateCredentialRef(row.credential_ref, 'Feishu route credential ref')
  boundedReference(row.command_id, 'Feishu route command id')
  canonicalInstant(row.created_at, 'Feishu route createdAt')
}

function readFeishuIdentityBinding(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  kind: FeishuIdentityKind,
  identityEpoch: number,
): FeishuIdentityBindingRow | null {
  const row = database.prepare(`
    SELECT organization_id, team_id, kind, identity_epoch, route_generation,
      app_id, open_id, tenant_key, verification_id, bound_at
    FROM workbench_feishu_identity_binding
    WHERE organization_id = ? AND team_id = ? AND kind = ? AND identity_epoch = ?
  `).get(organizationId, teamId, kind, identityEpoch) as FeishuIdentityBindingRow | undefined
  if (row === undefined) return null
  if (row.organization_id !== organizationId || row.team_id !== teamId
    || row.kind !== kind || row.identity_epoch !== identityEpoch) {
    throw new Error('Workbench database contains an invalid Feishu identity binding scope')
  }
  positiveInteger(row.identity_epoch, 'Feishu binding identity epoch')
  positiveInteger(row.route_generation, 'Feishu binding route generation')
  validateFeishuAppId(row.app_id, 'Feishu binding app id')
  validateBoundedReference(row.open_id, 'Feishu binding open id')
  if (row.tenant_key !== null) validateBoundedReference(row.tenant_key, 'Feishu binding tenant key')
  boundedReference(row.verification_id, 'Feishu binding verification id')
  canonicalInstant(row.bound_at, 'Feishu binding boundAt')
  return row
}

function readLatestFeishuVerification(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  kind: FeishuIdentityKind,
  generation: number,
): FeishuVerificationRow | null {
  const row = database.prepare(`
    SELECT sequence, route_sequence, id, organization_id, team_id, kind,
      route_generation, identity_epoch, connection_revision, result, identity_state,
      identity_issue_json, actor_app_id, actor_open_id, actor_tenant_key,
      display_label, scope_state, scopes_json,
      scope_issue_json, requested_resource_probe_json, resource_probe_json,
      command_id, checked_at
    FROM workbench_feishu_verification
    WHERE organization_id = ? AND team_id = ? AND kind = ? AND route_generation = ?
    ORDER BY route_sequence DESC LIMIT 1
  `).get(organizationId, teamId, kind, generation) as FeishuVerificationRow | undefined
  return row ?? null
}

function readFeishuBindingVerification(
  database: DatabaseSync,
  binding: FeishuIdentityBindingRow,
): FeishuVerificationRow {
  const row = database.prepare(`
    SELECT sequence, route_sequence, id, organization_id, team_id, kind,
      route_generation, identity_epoch, connection_revision, result, identity_state,
      identity_issue_json, actor_app_id, actor_open_id, actor_tenant_key,
      display_label, scope_state, scopes_json,
      scope_issue_json, requested_resource_probe_json, resource_probe_json,
      command_id, checked_at
    FROM workbench_feishu_verification WHERE id = ?
  `).get(binding.verification_id) as FeishuVerificationRow | undefined
  if (row === undefined
    || row.organization_id !== binding.organization_id
    || row.team_id !== binding.team_id
    || row.kind !== binding.kind
    || row.identity_epoch !== binding.identity_epoch
    || row.route_generation !== binding.route_generation
    || row.identity_state !== 'verified') {
    throw new Error('Workbench Feishu identity binding lost its source verification')
  }
  feishuVerificationProjectionFromRow(row)
  return row
}

function readFeishuConnectionProjection(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
): WorkbenchStoredFeishuConnectionProjection {
  const connection = readFeishuConnectionRow(database, organizationId, teamId)
  const route = (kind: FeishuIdentityKind) => {
    const current = readCurrentFeishuRoute(database, organizationId, teamId, kind)
    if (current === null) {
      return Object.freeze({
        kind,
        state: 'unconfigured' as const,
        generation: null,
        appId: null,
        credentialRef: null,
        actor: null,
        displayLabel: null,
        lastVerification: null,
      })
    }
    const binding = readFeishuIdentityBinding(
      database,
      organizationId,
      teamId,
      kind,
      current.identity_epoch,
    )
    const latest = readLatestFeishuVerification(
      database,
      organizationId,
      teamId,
      kind,
      current.generation,
    )
    const bindingVerification = binding === null
      ? null
      : readFeishuBindingVerification(database, binding)
    const verification = latest === null ? null : feishuVerificationProjectionFromRow(latest)
    return Object.freeze({
      kind,
      state: current.state as 'configured' | 'disabled',
      generation: current.generation,
      appId: current.app_id,
      credentialRef: current.credential_ref,
      actor: binding === null ? null : Object.freeze({
        connectionId: FEISHU_CONNECTION_ID_VALUE,
        realm: FEISHU_REALM,
        appId: binding.app_id,
        kind,
        routeGeneration: binding.route_generation,
        openId: binding.open_id,
        tenantKey: binding.tenant_key,
      }),
      displayLabel: latest?.display_label ?? bindingVerification?.display_label ?? null,
      lastVerification: verification,
    })
  }
  return Object.freeze({
    connectionId: FEISHU_CONNECTION_ID_VALUE,
    realm: FEISHU_REALM,
    revision: connection?.revision ?? 0,
    bot: route('bot'),
    user: route('user'),
    updatedAt: connection?.updated_at ?? null,
  })
}

function feishuVerificationProjectionFromRow(
  row: FeishuVerificationRow,
): FeishuVerificationProjection {
  positiveInteger(row.sequence, 'Feishu verification storage sequence')
  const sequence = positiveInteger(row.route_sequence, 'Feishu verification route sequence')
  const routeGeneration = positiveInteger(row.route_generation, 'Feishu verification generation')
  positiveInteger(row.identity_epoch, 'Feishu verification identity epoch')
  positiveInteger(row.connection_revision, 'Feishu verification connection revision')
  const result = feishuVerificationResult(row.result)
  const identityState = row.identity_state === 'verified'
    ? 'verified' as const
    : row.identity_state === 'failed' ? 'failed' as const : null
  if (identityState === null) throw new Error('Workbench database contains invalid Feishu identity state')
  const identityIssue = row.identity_issue_json === null
    ? null
    : decodeFeishuIssue(row.identity_issue_json)
  if ((identityState === 'verified') !== (identityIssue === null)) {
    throw new Error('Workbench database contains inconsistent Feishu identity evidence')
  }
  if (identityState === 'verified') {
    if (row.actor_app_id === null || row.actor_open_id === null) {
      throw new Error('Workbench database Feishu verification lost its actor')
    }
    validateFeishuAppId(row.actor_app_id, 'Feishu verification actor app id')
    validateBoundedReference(row.actor_open_id, 'Feishu verification actor open id')
    if (row.actor_tenant_key !== null) {
      validateBoundedReference(row.actor_tenant_key, 'Feishu verification actor tenant key')
    }
  } else if (row.actor_app_id !== null || row.actor_open_id !== null
    || row.actor_tenant_key !== null) {
    throw new Error('Workbench database failed Feishu verification contains an actor')
  }
  const scopeState = row.scope_state === 'observed'
    || row.scope_state === 'unavailable'
    || row.scope_state === 'not-inspected'
    ? row.scope_state
    : null
  if (scopeState === null) throw new Error('Workbench database contains invalid Feishu scope state')
  const scopes = decodeFeishuScopes(row.scopes_json)
  const scopeIssue = row.scope_issue_json === null ? null : decodeFeishuIssue(row.scope_issue_json)
  if (scopeState === 'observed' && scopeIssue !== null) {
    throw new Error('Workbench database contains inconsistent Feishu scope evidence')
  }
  const requestedResourceProbe = decodeFeishuRequestedResourceProbe(
    row.requested_resource_probe_json,
  )
  const resourceProbe = decodeFeishuResourceProbe(row.resource_probe_json)
  if (resourceProbe.state !== 'not-tested'
    && (requestedResourceProbe === null
      || requestedResourceProbe.kind !== resourceProbe.kind
      || requestedResourceProbe.resourceId !== resourceProbe.resourceId)) {
    throw new Error('Workbench database Feishu resource result escaped its requested probe')
  }
  if (row.display_label !== null) {
    validateSafeText(row.display_label, 'Feishu display label', MAX_FEISHU_DISPLAY_LABEL_LENGTH)
  }
  return Object.freeze({
    verificationId: boundedReference(row.id, 'Feishu verification id'),
    sequence,
    routeGeneration,
    checkedAt: canonicalInstant(row.checked_at, 'Feishu verification checkedAt'),
    result,
    identity: Object.freeze({ state: identityState, issue: identityIssue }),
    scopeInspection: Object.freeze({
      state: scopeState,
      scopes: Object.freeze(scopes),
      issue: scopeIssue,
    }),
    resourceProbe,
  })
}

function findFeishuReceipt(
  database: DatabaseSync,
  command: WorkbenchCommandMetadata,
  keyHash: string,
): ReceiptRow | undefined {
  return database.prepare(`
    SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
    FROM workbench_command_receipt
    WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
  `).get(
    command.actor.organizationId,
    command.actor.id,
    keyHash,
  ) as ReceiptRow | undefined
}

function readFeishuReceiptByCommand(
  database: DatabaseSync,
  commandId: string,
): ReceiptRow | undefined {
  return database.prepare(`
    SELECT command_type, request_hash, command_id, audit_event_id, outbox_id, result_json
    FROM workbench_command_receipt WHERE command_id = ?
  `).get(commandId) as ReceiptRow | undefined
}

function feishuRouteRequestHash(
  mutation: WorkbenchFeishuRouteMutation,
  commandType: string,
): string {
  return digest(canonicalizeJson({
    commandType,
    target: FEISHU_CONNECTION_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
    },
    kind: mutation.kind,
    mode: mutation.mode,
    ...(mutation.mode === 'set'
      ? { appId: mutation.appId, credentialRef: mutation.credentialRef }
      : {}),
    expectedConnectionRevision: mutation.expectedConnectionRevision,
    expectedRouteGeneration: mutation.expectedRouteGeneration,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

type FeishuVerificationHashInput = WorkbenchFeishuVerificationMutation
  | WorkbenchFeishuVerificationReplayQuery

function feishuVerificationRequestHash(input: FeishuVerificationHashInput): string {
  return digest(canonicalizeJson({
    commandType: FEISHU_VERIFY_COMMAND_TYPE,
    target: FEISHU_CONNECTION_OBJECT_TYPE,
    scope: {
      organizationId: 'command' in input
        ? input.command.actor.organizationId
        : input.organizationId,
      teamId: 'command' in input ? input.command.actor.teamId : input.teamId,
    },
    kind: input.kind,
    expectedConnectionRevision: input.expectedConnectionRevision,
    expectedRouteGeneration: input.expectedRouteGeneration,
    resourceProbe: input.resourceProbe,
    reason: 'command' in input ? input.command.reason : input.reason,
    causationId: 'command' in input ? input.command.causationId : input.causationId,
  }))
}

type FeishuCommittedResult =
  | Extract<ConfigureFeishuIdentityRouteResult, { readonly ok: true }>
  | Extract<VerifyFeishuIdentityRouteResult, { readonly ok: true }>

interface FeishuLedgerInput {
  readonly command: WorkbenchCommandMetadata
  readonly requestHash: string
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
  readonly connectionRevision: number
  readonly routeKind: FeishuIdentityKind
  readonly routeGeneration: number
  readonly result: FeishuCommittedResult
}

function appendFeishuLedger(database: DatabaseSync, input: FeishuLedgerInput): void {
  const payload = canonicalizeJson({
    schemaVersion: 1,
    commandId: input.command.commandId,
    auditEventId: input.command.auditEventId,
    requestHash: input.requestHash,
    connectionRevision: input.connectionRevision,
    routeKind: input.routeKind,
    routeGeneration: input.routeGeneration,
    causationId: input.command.causationId,
  })
  const outbox = database.prepare(`
    INSERT INTO workbench_outbox (
      id, command_id, organization_id, topic, effect_key, project_id,
      object_type, object_id, object_version, causation_id, payload_json,
      state, attempt_count, created_at, updated_at, error_code
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL)
  `).run(
    input.command.outboxId,
    input.command.commandId,
    input.command.actor.organizationId,
    input.outboxTopic,
    `workbench:${input.command.outboxId}`,
    FEISHU_CONNECTION_OBJECT_TYPE,
    FEISHU_CONNECTION_ID_VALUE,
    input.connectionRevision,
    input.command.causationId,
    payload,
    input.command.occurredAt,
    input.command.occurredAt,
  )
  if (outbox.changes !== 1) {
    throw new Error('Workbench Feishu Outbox intent was not inserted exactly once')
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
      projectId: null,
    },
    reason: { code: input.command.reason },
    object: {
      type: FEISHU_CONNECTION_OBJECT_TYPE,
      id: FEISHU_CONNECTION_ID_VALUE,
      version: String(input.connectionRevision),
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
    throw new Error('Workbench Feishu command receipt was not inserted exactly once')
  }
}

function enforceFeishuIdentityContinuity(
  observation: WorkbenchFeishuVerificationObservation,
  route: FeishuRouteRow,
  binding: FeishuIdentityBindingRow | null,
): WorkbenchFeishuVerificationObservation {
  const actor = observation.actor
  if (observation.identity.state !== 'verified' || actor === null) return observation
  if (actor.realm !== FEISHU_REALM || actor.kind !== route.kind || actor.appId !== route.app_id) {
    return failedFeishuObservation('provider-response-invalid', 'inspect-provider')
  }
  if (binding === null) return observation
  if (binding.app_id !== actor.appId || binding.open_id !== actor.openId) {
    return failedFeishuObservation('identity-continuity-mismatch', 'reset-identity-binding')
  }
  if (binding.tenant_key !== actor.tenantKey) {
    return failedFeishuObservation('tenant-mismatch', 'reset-identity-binding')
  }
  return observation
}

function failedFeishuObservation(
  code: FeishuConnectionIssue['code'],
  recovery: FeishuConnectionIssue['recovery'],
): WorkbenchFeishuVerificationObservation {
  const issue = Object.freeze({
    code,
    recovery,
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
  return Object.freeze({
    result: 'failed',
    identity: Object.freeze({ state: 'failed', issue }),
    actor: null,
    displayLabel: null,
    scopeInspection: Object.freeze({
      state: 'not-inspected',
      scopes: Object.freeze([]),
      issue: null,
    }),
    resourceProbe: Object.freeze({ state: 'not-tested' }),
  })
}

function feishuVerificationSummary(
  result: WorkbenchFeishuVerificationObservation['result'],
): typeof FEISHU_VERIFY_HEALTHY_SUMMARY
  | typeof FEISHU_VERIFY_ATTENTION_SUMMARY
  | typeof FEISHU_VERIFY_FAILED_SUMMARY {
  return result === 'healthy'
      ? FEISHU_VERIFY_HEALTHY_SUMMARY
    : result === 'attention' ? FEISHU_VERIFY_ATTENTION_SUMMARY : FEISHU_VERIFY_FAILED_SUMMARY
}

const FEISHU_CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const FEISHU_SCOPE_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/u
const FEISHU_ISSUE_CODES = new Set<FeishuConnectionIssue['code']>([
  'credential-unconfigured',
  'credential-invalid',
  'credential-expired',
  'user-authorization-revoked',
  'app-disabled',
  'missing-app-scope',
  'missing-user-grant',
  'outside-app-data-range',
  'resource-access-unavailable',
  'resource-not-found',
  'unsupported-actor',
  'identity-continuity-mismatch',
  'tenant-mismatch',
  'rate-limited',
  'provider-unavailable',
  'provider-response-invalid',
  'unknown-provider-error',
])
const FEISHU_RECOVERY_CODES = new Set<FeishuConnectionIssue['recovery']>([
  'configure-credential',
  'rotate-credential',
  'enable-app',
  'grant-app-scope',
  'reauthorize-user',
  'expand-app-data-range',
  'share-resource',
  'check-resource-id',
  'reset-identity-binding',
  'retry-later',
  'inspect-provider',
])

function validateFeishuConnectionQuery(query: WorkbenchFeishuConnectionQuery): void {
  validateBoundedReference(query.organizationId, 'Feishu organization id')
  validateBoundedReference(query.teamId, 'Feishu team id')
}

function validateFeishuRouteMutation(mutation: WorkbenchFeishuRouteMutation): void {
  if (mutation.kind !== 'bot' && mutation.kind !== 'user') {
    throw new TypeError('Feishu route kind must be bot or user')
  }
  const vocabulary = feishuRouteVocabulary(mutation.mode)
  if (mutation.command.reason !== vocabulary.reason) {
    throw new TypeError('Feishu route reason does not match its mode')
  }
  nonNegativeStoredRevision(
    mutation.expectedConnectionRevision,
    'Feishu expected connection revision',
  )
  nullablePositiveStoredRevision(
    mutation.expectedRouteGeneration,
    'Feishu expected route generation',
  )
  if (mutation.mode === 'set') {
    if (mutation.appId === null || mutation.credentialRef === null) {
      throw new TypeError('Feishu set route requires appId and credentialRef')
    }
    validateFeishuAppId(mutation.appId, 'Feishu route app id')
    validateCredentialRef(mutation.credentialRef, 'Feishu route credential ref')
  } else if (mutation.appId !== null || mutation.credentialRef !== null) {
    throw new TypeError('Feishu reset/disable route must not carry new credential material')
  }
  validateInstant(mutation.updatedAt, 'Feishu route updatedAt')
  validateFeishuCommand(mutation.command)
  if (mutation.updatedAt !== mutation.command.occurredAt) {
    throw new TypeError('Feishu route and command instants must match')
  }
}

function validateFeishuVerificationReplayQuery(
  query: WorkbenchFeishuVerificationReplayQuery,
): void {
  validateBoundedReference(query.organizationId, 'Feishu replay organization id')
  validateBoundedReference(query.teamId, 'Feishu replay team id')
  validateBoundedReference(query.actorId, 'Feishu replay actor id')
  if (query.kind !== 'bot' && query.kind !== 'user') {
    throw new TypeError('Feishu replay kind must be bot or user')
  }
  nonNegativeStoredRevision(
    query.expectedConnectionRevision,
    'Feishu replay connection revision',
  )
  positiveInteger(query.expectedRouteGeneration, 'Feishu replay route generation')
  validateFeishuResourceProbeInput(query.resourceProbe)
  validateReference(query.idempotencyKey, 'Feishu replay idempotency key')
  validateReference(query.causationId, 'Feishu replay causation id')
  if (query.reason !== FEISHU_VERIFY_REASON) {
    throw new TypeError('Feishu replay reason is unsupported')
  }
}

function validateFeishuVerificationMutation(
  mutation: WorkbenchFeishuVerificationMutation,
): void {
  validateBoundedReference(mutation.verificationId, 'Feishu verification id')
  if (mutation.kind !== 'bot' && mutation.kind !== 'user') {
    throw new TypeError('Feishu verification kind must be bot or user')
  }
  nonNegativeStoredRevision(
    mutation.expectedConnectionRevision,
    'Feishu expected connection revision',
  )
  positiveInteger(mutation.expectedRouteGeneration, 'Feishu expected route generation')
  validateFeishuResourceProbeInput(mutation.resourceProbe)
  validateFeishuObservation(mutation.observation, mutation.kind)
  validateInstant(mutation.checkedAt, 'Feishu verification checkedAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_VERIFY_REASON
    || mutation.checkedAt !== mutation.command.occurredAt) {
    throw new TypeError('Feishu verification command metadata is inconsistent')
  }
}

function validateFeishuCommand(command: WorkbenchCommandMetadata): void {
  for (const [label, value] of [
    ['Feishu command id', command.commandId],
    ['Feishu audit event id', command.auditEventId],
    ['Feishu Outbox id', command.outboxId],
    ['Feishu idempotency key', command.idempotencyKey],
    ['Feishu causation id', command.causationId],
    ['Feishu actor id', command.actor.id],
    ['Feishu organization id', command.actor.organizationId],
    ['Feishu team id', command.actor.teamId],
  ] as const) validateReference(value, label)
  if (command.actor.kind !== 'owner') throw new TypeError('Feishu command actor must be owner')
  validateInstant(command.occurredAt, 'Feishu command occurredAt')
}

function validateFeishuResourceProbeInput(
  probe: { readonly kind: 'task-list'; readonly resourceId: string } | null,
): void {
  if (probe === null) return
  if (probe.kind !== 'task-list') throw new TypeError('Feishu resource probe kind is unsupported')
  validateFeishuResourceId(probe.resourceId, 'Feishu resource probe id')
}

function validateFeishuObservation(
  observation: WorkbenchFeishuVerificationObservation,
  kind: FeishuIdentityKind,
): void {
  const identityIssue = observation.identity.issue === null
    ? null
    : safeFeishuIssue(observation.identity.issue, 'Feishu identity issue')
  if (observation.identity.state === 'verified') {
    if (identityIssue !== null || observation.actor === null) {
      throw new TypeError('Verified Feishu identity requires one actor and no issue')
    }
    validateFeishuActor(observation.actor, kind)
  } else if (observation.identity.state === 'failed') {
    if (identityIssue === null || observation.actor !== null) {
      throw new TypeError('Failed Feishu identity requires one issue and no actor')
    }
  } else {
    throw new TypeError('Feishu identity observation state is unsupported')
  }
  if (observation.displayLabel !== null) {
    validateSafeText(
      observation.displayLabel,
      'Feishu display label',
      MAX_FEISHU_DISPLAY_LABEL_LENGTH,
    )
  }
  if (observation.scopeInspection.state === 'observed') {
    if (observation.scopeInspection.issue !== null) {
      throw new TypeError('Observed Feishu scopes cannot carry an inspection issue')
    }
  } else if (observation.scopeInspection.state === 'unavailable') {
    if (observation.scopeInspection.issue === null) {
      throw new TypeError('Unavailable Feishu scope inspection requires an issue')
    }
    safeFeishuIssue(observation.scopeInspection.issue, 'Feishu scope issue')
  } else if (observation.scopeInspection.state === 'not-inspected') {
    if (observation.scopeInspection.issue !== null
      || observation.scopeInspection.scopes.length !== 0) {
      throw new TypeError('Uninspected Feishu scopes cannot carry evidence')
    }
  } else {
    throw new TypeError('Feishu scope inspection state is unsupported')
  }
  if (!Array.isArray(observation.scopeInspection.scopes)
    || observation.scopeInspection.scopes.length > 100) {
    throw new TypeError('Feishu scopes must be a bounded array')
  }
  for (const scope of observation.scopeInspection.scopes) validateFeishuScope(scope)
  validateFeishuResourceProjection(observation.resourceProbe)
  const hasAttention = observation.scopeInspection.state === 'unavailable'
    || observation.scopeInspection.scopes.some(scope => scope.state === 'missing')
    || observation.resourceProbe.state === 'unavailable'
  const expectedResult = observation.identity.state === 'failed'
    ? 'failed'
    : hasAttention ? 'attention' : 'healthy'
  if (observation.result !== expectedResult) {
    throw new TypeError('Feishu verification result does not match its evidence')
  }
}

function validateFeishuActor(
  actor: WorkbenchFeishuVerificationObservation['actor'] & object,
  kind: FeishuIdentityKind,
): void {
  if (actor.realm !== FEISHU_REALM || actor.kind !== kind) {
    throw new TypeError('Feishu actor route is inconsistent')
  }
  validateFeishuAppId(actor.appId, 'Feishu actor app id')
  validateBoundedReference(actor.openId, 'Feishu actor open id')
  if (actor.tenantKey !== null) validateBoundedReference(actor.tenantKey, 'Feishu actor tenant key')
}

function validateFeishuScope(scope: FeishuScopeObservation): void {
  if (typeof scope.scope !== 'string' || !FEISHU_SCOPE_PATTERN.test(scope.scope)) {
    throw new TypeError('Feishu scope name is invalid')
  }
  if (scope.tokenType !== 'tenant' && scope.tokenType !== 'user') {
    throw new TypeError('Feishu scope token type is invalid')
  }
  if (scope.state !== 'configured' && scope.state !== 'verified'
    && scope.state !== 'missing' && scope.state !== 'unknown') {
    throw new TypeError('Feishu scope state is invalid')
  }
}

function validateFeishuResourceProjection(probe: FeishuResourceProbeProjection): void {
  if (probe.state === 'not-tested') return
  if (probe.kind !== 'task-list') throw new TypeError('Feishu resource projection kind is invalid')
  validateFeishuResourceId(probe.resourceId, 'Feishu resource projection id')
  if (probe.state === 'accessible') return
  if (probe.state !== 'unavailable') throw new TypeError('Feishu resource projection state is invalid')
  safeFeishuIssue(probe.issue, 'Feishu resource issue')
}

function safeFeishuIssue(value: FeishuConnectionIssue, label: string): FeishuConnectionIssue {
  if (!FEISHU_ISSUE_CODES.has(value.code) || !FEISHU_RECOVERY_CODES.has(value.recovery)) {
    throw new TypeError(`${label} vocabulary is unsupported`)
  }
  if (!Array.isArray(value.missingScopes) || value.missingScopes.length > 20) {
    throw new TypeError(`${label} missingScopes must be bounded`)
  }
  const missingScopes = value.missingScopes.map((scope) => {
    if (typeof scope !== 'string' || !FEISHU_SCOPE_PATTERN.test(scope)) {
      throw new TypeError(`${label} contains an invalid scope`)
    }
    return scope
  })
  if (new Set(missingScopes).size !== missingScopes.length) {
    throw new TypeError(`${label} contains duplicate scopes`)
  }
  if (value.grantPlane !== null
    && value.grantPlane !== 'application'
    && value.grantPlane !== 'user-consent') {
    throw new TypeError(`${label} grant plane is unsupported`)
  }
  if (value.retryAt !== null) canonicalInstant(value.retryAt, `${label} retryAt`)
  return Object.freeze({
    code: value.code,
    recovery: value.recovery,
    missingScopes: Object.freeze([...missingScopes]),
    grantPlane: value.grantPlane,
    retryAt: value.retryAt,
  })
}

function decodeFeishuIssue(value: string): FeishuConnectionIssue {
  const parsed = parseCanonicalJson(value, 'Feishu issue')
  const record = exactStoredObject(parsed, 'Feishu issue', [
    'code', 'recovery', 'missingScopes', 'grantPlane', 'retryAt',
  ])
  return safeFeishuIssue(record as unknown as FeishuConnectionIssue, 'Feishu issue')
}

function decodeFeishuScopes(value: string): readonly FeishuScopeObservation[] {
  const parsed = parseCanonicalJson(value, 'Feishu scopes')
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error('Workbench database contains invalid Feishu scopes')
  }
  return Object.freeze(parsed.map((candidate, index) => {
    const record = exactStoredObject(candidate, `Feishu scope ${String(index)}`, [
      'scope', 'tokenType', 'state',
    ]) as unknown as FeishuScopeObservation
    validateFeishuScope(record)
    return Object.freeze({ ...record })
  }))
}

function decodeFeishuResourceProbe(value: string): FeishuResourceProbeProjection {
  const parsed = parseCanonicalJson(value, 'Feishu resource probe')
  const basic = objectValue(parsed, 'Feishu resource probe')
  let projection: FeishuResourceProbeProjection
  if (basic.state === 'not-tested') {
    assertExactStoredKeys(basic, 'Feishu resource probe', ['state'])
    projection = Object.freeze({ state: 'not-tested' })
  } else if (basic.state === 'accessible') {
    assertExactStoredKeys(basic, 'Feishu resource probe', ['state', 'kind', 'resourceId'])
    projection = Object.freeze({
      state: 'accessible',
      kind: basic.kind as 'task-list',
      resourceId: basic.resourceId as string,
    })
  } else if (basic.state === 'unavailable') {
    assertExactStoredKeys(basic, 'Feishu resource probe', [
      'state', 'kind', 'resourceId', 'issue',
    ])
    const issueRecord = exactStoredObject(basic.issue, 'Feishu resource issue', [
      'code', 'recovery', 'missingScopes', 'grantPlane', 'retryAt',
    ])
    projection = Object.freeze({
      state: 'unavailable',
      kind: basic.kind as 'task-list',
      resourceId: basic.resourceId as string,
      issue: safeFeishuIssue(
        issueRecord as unknown as FeishuConnectionIssue,
        'Feishu resource issue',
      ),
    })
  } else {
    throw new Error('Workbench database contains unsupported Feishu resource probe state')
  }
  validateFeishuResourceProjection(projection)
  return projection
}

function decodeFeishuRequestedResourceProbe(
  value: string,
): WorkbenchFeishuVerificationMutation['resourceProbe'] {
  const parsed = parseCanonicalJson(value, 'Feishu requested resource probe')
  if (parsed === null) return null
  const record = exactStoredObject(parsed, 'Feishu requested resource probe', [
    'kind', 'resourceId',
  ])
  if (record.kind !== 'task-list' || typeof record.resourceId !== 'string') {
    throw new Error('Workbench database contains an unsupported Feishu requested resource probe')
  }
  validateFeishuResourceId(record.resourceId, 'Feishu requested resource id')
  return Object.freeze({ kind: 'task-list', resourceId: record.resourceId })
}

function parseCanonicalJson(value: string, label: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Workbench database contains invalid ${label} JSON`)
  }
  if (canonicalizeJson(parsed) !== value) {
    throw new Error(`Workbench database contains non-canonical ${label} JSON`)
  }
  return parsed
}

function decodeFeishuReceipt(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): { readonly value: Record<string, unknown>; readonly receipt: {
  readonly commandId: string
  readonly auditEventId: string
  readonly outboxId: string
} } {
  const root = exactStoredObject(parseCanonicalJson(value, 'Feishu receipt'), 'Feishu receipt', [
    'ok', 'value', 'receipt',
  ])
  if (root.ok !== true) throw new Error('Workbench Feishu receipt is not committed')
  const result = objectValue(root.value, 'Feishu receipt value')
  const receiptRecord = exactStoredObject(root.receipt, 'Feishu receipt identities', [
    'commandId', 'auditEventId', 'outboxId',
  ])
  const receipt = Object.freeze({
    commandId: boundedReference(receiptRecord.commandId, 'Feishu receipt command id'),
    auditEventId: boundedReference(receiptRecord.auditEventId, 'Feishu receipt audit id'),
    outboxId: boundedReference(receiptRecord.outboxId, 'Feishu receipt Outbox id'),
  })
  if (receipt.commandId !== stored.command_id
    || receipt.auditEventId !== stored.audit_event_id
    || receipt.outboxId !== stored.outbox_id) {
    throw new Error('Workbench Feishu receipt identities do not match durable references')
  }
  return Object.freeze({ value: result, receipt })
}

function decodeFeishuRouteResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<ConfigureFeishuIdentityRouteResult, { readonly ok: true }> {
  const decoded = decodeFeishuReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'Feishu route acknowledgement', [
    'connectionId', 'connectionRevision', 'kind', 'routeGeneration', 'state',
  ])
  const kind = feishuIdentityKind(decoded.value.kind)
  const state = decoded.value.state === 'configured'
    ? 'configured' as const
    : decoded.value.state === 'disabled' ? 'disabled' as const : null
  if (decoded.value.connectionId !== FEISHU_CONNECTION_ID_VALUE || state === null) {
    throw new Error('Workbench Feishu route receipt contains unsupported values')
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      connectionId: FEISHU_CONNECTION_ID_VALUE,
      connectionRevision: positiveInteger(
        decoded.value.connectionRevision,
        'Feishu receipt connection revision',
      ),
      kind,
      routeGeneration: positiveInteger(
        decoded.value.routeGeneration,
        'Feishu receipt route generation',
      ),
      state,
    }),
    receipt: decoded.receipt,
  })
}

function decodeFeishuVerificationResult(
  value: string,
  stored: Pick<ReceiptRow, 'command_id' | 'audit_event_id' | 'outbox_id'>,
): Extract<VerifyFeishuIdentityRouteResult, { readonly ok: true }> {
  const decoded = decodeFeishuReceipt(value, stored)
  assertExactStoredKeys(decoded.value, 'Feishu verification acknowledgement', [
    'connectionId', 'connectionRevision', 'kind', 'routeGeneration',
    'verificationSequence', 'result',
  ])
  if (decoded.value.connectionId !== FEISHU_CONNECTION_ID_VALUE) {
    throw new Error('Workbench Feishu verification receipt has an invalid connection id')
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      connectionId: FEISHU_CONNECTION_ID_VALUE,
      connectionRevision: positiveInteger(
        decoded.value.connectionRevision,
        'Feishu receipt connection revision',
      ),
      kind: feishuIdentityKind(decoded.value.kind),
      routeGeneration: positiveInteger(
        decoded.value.routeGeneration,
        'Feishu receipt route generation',
      ),
      verificationSequence: positiveInteger(
        decoded.value.verificationSequence,
        'Feishu receipt verification sequence',
      ),
      result: feishuVerificationResult(decoded.value.result),
    }),
    receipt: decoded.receipt,
  })
}

function feishuIdentityKind(value: unknown): FeishuIdentityKind {
  if (value !== 'bot' && value !== 'user') {
    throw new Error('Workbench database contains an invalid Feishu route kind')
  }
  return value
}

function feishuVerificationResult(
  value: unknown,
): WorkbenchFeishuVerificationObservation['result'] {
  if (value !== 'healthy' && value !== 'attention' && value !== 'failed') {
    throw new Error('Workbench database contains an invalid Feishu verification result')
  }
  return value
}

function validateCredentialRef(value: string, label: string): void {
  if (!FEISHU_CREDENTIAL_REF_PATTERN.test(value)
    || value.length > MAX_FEISHU_CREDENTIAL_REF_LENGTH) {
    throw new TypeError(`${label} must be a bounded DSH CredentialRef`)
  }
}

function validateFeishuAppId(value: string, label: string): void {
  validateSafeText(value, label, MAX_FEISHU_APP_ID_LENGTH)
  if (!SAFE_REFERENCE.test(value)) throw new TypeError(`${label} must be wire-safe`)
}

function validateFeishuResourceId(value: string, label: string): void {
  validateSafeText(value, label, MAX_FEISHU_RESOURCE_ID_LENGTH)
  if (!SAFE_REFERENCE.test(value)) throw new TypeError(`${label} must be wire-safe`)
}

function validateSafeText(value: string, label: string, maximum: number): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || !value.isWellFormed() || ASCII_CONTROL.test(value)) {
    throw new TypeError(`${label} is not bounded safe text`)
  }
}

function nonNegativeStoredRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`)
}

function nullablePositiveStoredRevision(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError(`${label} is invalid`)
  }
}

function feishuIdempotencyConflict(): ConfigureFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  })
}

function feishuVerificationIdempotencyConflict(): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different intent',
    }),
  })
}

function feishuConnectionRevisionConflict(
  expected: number,
  current: number,
): ConfigureFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'connection-revision-conflict',
      message: `Workbench Feishu connection revision changed (expected ${String(expected)}, current ${String(current)})`,
      expectedConnectionRevision: expected,
      currentConnectionRevision: current,
    }),
  })
}

function feishuVerificationConnectionRevisionConflict(
  expected: number,
  current: number,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'connection-revision-conflict',
      message: `Workbench Feishu connection revision changed (expected ${String(expected)}, current ${String(current)})`,
      expectedConnectionRevision: expected,
      currentConnectionRevision: current,
    }),
  })
}

function feishuRouteGenerationConflict(
  kind: FeishuIdentityKind,
  expected: number | null,
  current: number | null,
): ConfigureFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'route-generation-conflict',
      message: 'Workbench Feishu route generation changed',
      kind,
      expectedRouteGeneration: expected,
      currentRouteGeneration: current,
    }),
  })
}

function feishuVerificationRouteGenerationConflict(
  kind: FeishuIdentityKind,
  expected: number,
  current: number,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'route-generation-conflict',
      message: 'Workbench Feishu route generation changed',
      kind,
      expectedRouteGeneration: expected,
      currentRouteGeneration: current,
    }),
  })
}

function feishuRouteStateError(
  code: 'route-unconfigured' | 'no-op-route-configuration',
  kind: FeishuIdentityKind,
): ConfigureFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message: code === 'route-unconfigured'
        ? 'Workbench Feishu route is not configured'
        : 'Workbench Feishu route configuration would not change',
      kind,
    }),
  })
}

function feishuVerificationRouteStateError(
  code: 'route-unconfigured' | 'route-disabled',
  kind: FeishuIdentityKind,
): VerifyFeishuIdentityRouteResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message: code === 'route-disabled'
        ? 'Workbench Feishu route is disabled'
        : 'Workbench Feishu route is not configured',
      kind,
    }),
  })
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
  if (targetVersion === 6) {
    database.exec(`
      CREATE TABLE workbench_feishu_connection (
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        connection_id TEXT NOT NULL CHECK (connection_id = '${FEISHU_CONNECTION_ID_VALUE}'),
        realm TEXT NOT NULL CHECK (realm = '${FEISHU_REALM}'),
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (organization_id, team_id),
        UNIQUE (organization_id, team_id, connection_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_route_version (
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        kind TEXT NOT NULL CHECK (kind IN ('bot', 'user')),
        generation INTEGER NOT NULL CHECK (generation > 0),
        identity_epoch INTEGER NOT NULL CHECK (identity_epoch > 0),
        state TEXT NOT NULL CHECK (state IN ('configured', 'disabled')),
        app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND ${MAX_FEISHU_APP_ID_LENGTH}),
        credential_ref TEXT NOT NULL CHECK (
          length(credential_ref) BETWEEN 1 AND ${MAX_FEISHU_CREDENTIAL_REF_LENGTH}
        ),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED,
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        PRIMARY KEY (organization_id, team_id, kind, generation),
        UNIQUE (organization_id, team_id, kind, generation, app_id),
        UNIQUE (organization_id, team_id, kind, generation, identity_epoch),
        UNIQUE (organization_id, team_id, kind, generation, identity_epoch, app_id),
        FOREIGN KEY (organization_id, team_id)
          REFERENCES workbench_feishu_connection (organization_id, team_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_identity_binding (
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        kind TEXT NOT NULL CHECK (kind IN ('bot', 'user')),
        identity_epoch INTEGER NOT NULL CHECK (identity_epoch > 0),
        route_generation INTEGER NOT NULL CHECK (route_generation > 0),
        app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND ${MAX_FEISHU_APP_ID_LENGTH}),
        open_id TEXT NOT NULL CHECK (length(open_id) BETWEEN 1 AND ${MAX_FEISHU_OPEN_ID_LENGTH}),
        tenant_key TEXT CHECK (tenant_key IS NULL OR length(tenant_key) BETWEEN 1 AND 128),
        verification_id TEXT NOT NULL UNIQUE
          REFERENCES workbench_feishu_verification (id) DEFERRABLE INITIALLY DEFERRED,
        bound_at TEXT NOT NULL CHECK (length(bound_at) > 0),
        PRIMARY KEY (organization_id, team_id, kind, identity_epoch),
        FOREIGN KEY (
          organization_id, team_id, kind, route_generation, identity_epoch, app_id
        )
          REFERENCES workbench_feishu_route_version (
            organization_id, team_id, kind, generation, identity_epoch, app_id
          )
      ) STRICT;

      CREATE TABLE workbench_feishu_verification (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
        route_sequence INTEGER NOT NULL CHECK (route_sequence > 0),
        id TEXT NOT NULL UNIQUE CHECK (length(id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        kind TEXT NOT NULL CHECK (kind IN ('bot', 'user')),
        route_generation INTEGER NOT NULL CHECK (route_generation > 0),
        identity_epoch INTEGER NOT NULL CHECK (identity_epoch > 0),
        connection_revision INTEGER NOT NULL CHECK (connection_revision > 0),
        result TEXT NOT NULL CHECK (result IN ('healthy', 'attention', 'failed')),
        identity_state TEXT NOT NULL CHECK (identity_state IN ('verified', 'failed')),
        identity_issue_json TEXT,
        actor_app_id TEXT CHECK (
          actor_app_id IS NULL OR length(actor_app_id) BETWEEN 1 AND ${MAX_FEISHU_APP_ID_LENGTH}
        ),
        actor_open_id TEXT CHECK (
          actor_open_id IS NULL OR length(actor_open_id) BETWEEN 1 AND ${MAX_FEISHU_OPEN_ID_LENGTH}
        ),
        actor_tenant_key TEXT CHECK (
          actor_tenant_key IS NULL OR length(actor_tenant_key) BETWEEN 1 AND 128
        ),
        display_label TEXT CHECK (
          display_label IS NULL OR length(display_label) BETWEEN 1 AND ${MAX_FEISHU_DISPLAY_LABEL_LENGTH}
        ),
        scope_state TEXT NOT NULL CHECK (scope_state IN ('observed', 'unavailable', 'not-inspected')),
        scopes_json TEXT NOT NULL CHECK (length(scopes_json) > 0),
        scope_issue_json TEXT,
        requested_resource_probe_json TEXT NOT NULL CHECK (
          length(requested_resource_probe_json) > 0
        ),
        resource_probe_json TEXT NOT NULL CHECK (length(resource_probe_json) > 0),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED,
        checked_at TEXT NOT NULL CHECK (length(checked_at) > 0),
        CHECK (
          (identity_state = 'failed' AND actor_app_id IS NULL
            AND actor_open_id IS NULL AND actor_tenant_key IS NULL)
          OR (identity_state = 'verified' AND actor_app_id IS NOT NULL AND actor_open_id IS NOT NULL)
        ),
        UNIQUE (organization_id, team_id, kind, route_generation, route_sequence),
        UNIQUE (organization_id, team_id, connection_revision),
        FOREIGN KEY (organization_id, team_id, kind, route_generation, identity_epoch)
          REFERENCES workbench_feishu_route_version (
            organization_id, team_id, kind, generation, identity_epoch
          )
      ) STRICT;

      CREATE INDEX workbench_feishu_route_current
        ON workbench_feishu_route_version (organization_id, team_id, kind, generation DESC);
      CREATE INDEX workbench_feishu_verification_current
        ON workbench_feishu_verification (
          organization_id, team_id, kind, route_generation, route_sequence DESC
        );
      CREATE INDEX workbench_feishu_verification_identity_epoch
        ON workbench_feishu_verification (
          organization_id, team_id, kind, identity_epoch, sequence
        );

      CREATE TRIGGER workbench_feishu_connection_scope_no_update BEFORE UPDATE OF
        organization_id, team_id, connection_id, realm ON workbench_feishu_connection
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu connection scope is immutable'); END;
      CREATE TRIGGER workbench_feishu_connection_no_delete
        BEFORE DELETE ON workbench_feishu_connection
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu connections cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_route_no_update
        BEFORE UPDATE ON workbench_feishu_route_version
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu route versions are append-only'); END;
      CREATE TRIGGER workbench_feishu_route_no_delete
        BEFORE DELETE ON workbench_feishu_route_version
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu route versions cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_binding_no_update
        BEFORE UPDATE ON workbench_feishu_identity_binding
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu identity bindings are immutable'); END;
      CREATE TRIGGER workbench_feishu_binding_no_delete
        BEFORE DELETE ON workbench_feishu_identity_binding
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu identity bindings cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_verification_no_update
        BEFORE UPDATE ON workbench_feishu_verification
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu verifications are append-only'); END;
      CREATE TRIGGER workbench_feishu_verification_no_delete
        BEFORE DELETE ON workbench_feishu_verification
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu verifications cannot be deleted'); END
    `)
    return
  }
  if (targetVersion === 7) {
    database.exec(`
      CREATE TABLE workbench_feishu_task_binding (
        project_id TEXT PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        revision INTEGER NOT NULL CHECK (revision > 0),
        tasklist_guid TEXT NOT NULL CHECK (length(tasklist_guid) BETWEEN 1 AND 256),
        tasklist_name TEXT NOT NULL CHECK (length(tasklist_name) BETWEEN 1 AND 100),
        canonical_url TEXT NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 2048),
        route_kind TEXT NOT NULL CHECK (route_kind IN ('bot', 'user')),
        route_generation INTEGER NOT NULL CHECK (route_generation > 0),
        app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND ${MAX_FEISHU_APP_ID_LENGTH}),
        open_id TEXT NOT NULL CHECK (length(open_id) BETWEEN 1 AND ${MAX_FEISHU_OPEN_ID_LENGTH}),
        tenant_key TEXT CHECK (tenant_key IS NULL OR length(tenant_key) BETWEEN 1 AND 128),
        created_by_workbench INTEGER NOT NULL CHECK (created_by_workbench IN (0, 1)),
        remote_version TEXT NOT NULL CHECK (length(remote_version) BETWEEN 1 AND 64),
        sync_state TEXT NOT NULL CHECK (sync_state IN ('healthy', 'attention', 'unknown')),
        sync_issue_json TEXT,
        last_event_at TEXT,
        last_reconciled_at TEXT,
        last_attempt_at TEXT,
        reconcile_generation INTEGER NOT NULL CHECK (reconcile_generation >= 0),
        bound_at TEXT NOT NULL CHECK (length(bound_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        UNIQUE (tasklist_guid),
        UNIQUE (project_id, organization_id, team_id),
        FOREIGN KEY (project_id, organization_id, team_id)
          REFERENCES workbench_project (id, organization_id, team_id),
        FOREIGN KEY (organization_id, team_id, route_kind, route_generation, app_id)
          REFERENCES workbench_feishu_route_version (
            organization_id, team_id, kind, generation, app_id
          )
      ) STRICT;

      CREATE TABLE workbench_feishu_task_projection (
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        task_guid TEXT NOT NULL CHECK (length(task_guid) BETWEEN 1 AND 256),
        scope TEXT NOT NULL CHECK (scope IN ('primary-list', 'explicit-reference')),
        visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
        parent_task_guid TEXT CHECK (parent_task_guid IS NULL OR length(parent_task_guid) BETWEEN 1 AND 256),
        task_id TEXT CHECK (task_id IS NULL OR length(task_id) BETWEEN 1 AND 256),
        summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND ${MAX_FEISHU_TASK_TEXT_LENGTH}),
        description TEXT NOT NULL CHECK (length(description) <= ${MAX_FEISHU_TASK_TEXT_LENGTH}),
        assignees_json TEXT NOT NULL CHECK (length(assignees_json) > 0),
        followers_json TEXT NOT NULL CHECK (length(followers_json) > 0),
        comments_json TEXT NOT NULL CHECK (length(comments_json) > 0),
        completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
        completed_at TEXT,
        canonical_url TEXT NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 2048),
        remote_version TEXT NOT NULL CHECK (length(remote_version) BETWEEN 1 AND 64),
        projection_revision INTEGER NOT NULL CHECK (projection_revision > 0),
        reconcile_generation INTEGER NOT NULL CHECK (reconcile_generation >= 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (project_id, task_guid),
        FOREIGN KEY (project_id) REFERENCES workbench_feishu_task_binding (project_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_task_reference (
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        task_guid TEXT NOT NULL CHECK (length(task_guid) BETWEEN 1 AND 256),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED,
        referenced_at TEXT NOT NULL CHECK (length(referenced_at) > 0),
        PRIMARY KEY (project_id, task_guid),
        FOREIGN KEY (project_id, task_guid)
          REFERENCES workbench_feishu_task_projection (project_id, task_guid)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE TABLE workbench_feishu_task_inbox (
        event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        tasklist_guid TEXT NOT NULL CHECK (length(tasklist_guid) BETWEEN 1 AND 256),
        task_guid TEXT NOT NULL CHECK (length(task_guid) BETWEEN 1 AND 256),
        event_kind TEXT NOT NULL CHECK (event_kind IN ('upsert', 'removed')),
        remote_version TEXT NOT NULL CHECK (length(remote_version) BETWEEN 1 AND 64),
        outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'stale', 'ignored')),
        occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
        received_at TEXT NOT NULL CHECK (length(received_at) > 0),
        projection_revision INTEGER CHECK (projection_revision IS NULL OR projection_revision > 0),
        FOREIGN KEY (project_id) REFERENCES workbench_feishu_task_binding (project_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_task_reconciliation (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        binding_revision INTEGER NOT NULL CHECK (binding_revision > 0),
        reconcile_generation INTEGER NOT NULL CHECK (reconcile_generation > 0),
        outcome TEXT NOT NULL CHECK (outcome IN ('healthy', 'attention')),
        issue_json TEXT,
        task_count INTEGER NOT NULL CHECK (task_count BETWEEN 0 AND ${MAX_FEISHU_TASKS_PER_PROJECT}),
        snapshot_digest TEXT,
        attempted_at TEXT NOT NULL CHECK (length(attempted_at) > 0),
        UNIQUE (project_id, reconcile_generation),
        FOREIGN KEY (project_id) REFERENCES workbench_feishu_task_binding (project_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_task_effect (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
        task_guid TEXT NOT NULL CHECK (length(task_guid) BETWEEN 1 AND 256),
        expected_project_revision INTEGER NOT NULL CHECK (expected_project_revision > 0),
        expected_remote_version TEXT NOT NULL CHECK (length(expected_remote_version) BETWEEN 1 AND 64),
        changes_json TEXT NOT NULL CHECK (length(changes_json) > 0),
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
        state TEXT NOT NULL CHECK (state IN (
          'prepared', 'inflight', 'delivered', 'unknown', 'failed', 'conflict'
        )),
        issue_json TEXT,
        current_remote_version TEXT,
        attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 1),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED,
        audit_event_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (id)
          DEFERRABLE INITIALLY DEFERRED,
        outbox_id TEXT NOT NULL UNIQUE REFERENCES workbench_outbox (id)
          DEFERRABLE INITIALLY DEFERRED,
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        UNIQUE (organization_id, actor_id, idempotency_key_hash),
        UNIQUE (project_id, task_guid, id),
        FOREIGN KEY (project_id, task_guid)
          REFERENCES workbench_feishu_task_projection (project_id, task_guid)
      ) STRICT;

      CREATE INDEX workbench_feishu_task_projection_visible
        ON workbench_feishu_task_projection (project_id, visible, task_guid);
      CREATE INDEX workbench_feishu_task_effect_project
        ON workbench_feishu_task_effect (project_id, created_at DESC, id);
      CREATE INDEX workbench_feishu_task_inbox_project
        ON workbench_feishu_task_inbox (project_id, received_at, event_id);

      CREATE TRIGGER workbench_feishu_task_binding_scope_no_update BEFORE UPDATE OF
        project_id, organization_id, team_id, tasklist_guid, route_kind,
        route_generation, app_id, open_id, tenant_key, created_by_workbench, bound_at
        ON workbench_feishu_task_binding
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task-list binding scope is immutable'); END;
      CREATE TRIGGER workbench_feishu_task_binding_no_delete
        BEFORE DELETE ON workbench_feishu_task_binding
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task-list bindings cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_reference_no_update
        BEFORE UPDATE ON workbench_feishu_task_reference
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task references are immutable'); END;
      CREATE TRIGGER workbench_feishu_task_reference_no_delete
        BEFORE DELETE ON workbench_feishu_task_reference
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task references cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_inbox_no_update
        BEFORE UPDATE ON workbench_feishu_task_inbox
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task Inbox is append-only'); END;
      CREATE TRIGGER workbench_feishu_task_inbox_no_delete
        BEFORE DELETE ON workbench_feishu_task_inbox
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task Inbox cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_reconciliation_no_update
        BEFORE UPDATE ON workbench_feishu_task_reconciliation
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task reconciliations are append-only'); END;
      CREATE TRIGGER workbench_feishu_task_reconciliation_no_delete
        BEFORE DELETE ON workbench_feishu_task_reconciliation
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task reconciliations cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_effect_intent_no_update BEFORE UPDATE OF
        id, project_id, organization_id, team_id, actor_id, task_guid,
        expected_project_revision, expected_remote_version, changes_json,
        request_hash, idempotency_key_hash, command_id, audit_event_id,
        outbox_id, created_at ON workbench_feishu_task_effect
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task effect intent is immutable'); END;
      CREATE TRIGGER workbench_feishu_task_effect_no_delete
        BEFORE DELETE ON workbench_feishu_task_effect
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu task effects cannot be deleted'); END
    `)
    return
  }
  if (targetVersion === 8) {
    database.exec(`
      CREATE TABLE workbench_feishu_task_workflow (
        project_id TEXT PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        revision INTEGER NOT NULL CHECK (revision > 0),
        field_guid TEXT NOT NULL CHECK (length(field_guid) BETWEEN 1 AND 256),
        field_name TEXT NOT NULL CHECK (length(field_name) BETWEEN 1 AND 50),
        field_type TEXT NOT NULL CHECK (field_type = 'single_select'),
        field_remote_version TEXT NOT NULL CHECK (length(field_remote_version) BETWEEN 1 AND 64),
        definition_json TEXT NOT NULL CHECK (length(definition_json) > 0),
        options_json TEXT NOT NULL CHECK (length(options_json) > 0),
        compatibility_state TEXT NOT NULL
          CHECK (compatibility_state IN ('compatible', 'attention', 'blocked')),
        compatibility_issues_json TEXT NOT NULL CHECK (length(compatibility_issues_json) > 0),
        configured_at TEXT NOT NULL CHECK (length(configured_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        UNIQUE (project_id, organization_id, team_id),
        FOREIGN KEY (project_id, organization_id, team_id)
          REFERENCES workbench_feishu_task_binding (project_id, organization_id, team_id)
      ) STRICT;

      CREATE TABLE workbench_feishu_task_workflow_version (
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        revision INTEGER NOT NULL CHECK (revision > 0),
        field_guid TEXT NOT NULL CHECK (length(field_guid) BETWEEN 1 AND 256),
        field_remote_version TEXT NOT NULL CHECK (length(field_remote_version) BETWEEN 1 AND 64),
        definition_json TEXT NOT NULL CHECK (length(definition_json) > 0),
        mapping_json TEXT NOT NULL CHECK (length(mapping_json) > 0),
        options_json TEXT NOT NULL CHECK (length(options_json) > 0),
        compatibility_state TEXT NOT NULL
          CHECK (compatibility_state IN ('compatible', 'attention', 'blocked')),
        compatibility_issues_json TEXT NOT NULL CHECK (length(compatibility_issues_json) > 0),
        command_id TEXT NOT NULL UNIQUE REFERENCES workbench_audit_event (command_id)
          DEFERRABLE INITIALLY DEFERRED,
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        PRIMARY KEY (project_id, revision),
        FOREIGN KEY (project_id) REFERENCES workbench_feishu_task_workflow (project_id)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE TABLE workbench_feishu_task_custom_value (
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        task_guid TEXT NOT NULL CHECK (length(task_guid) BETWEEN 1 AND 256),
        field_guid TEXT NOT NULL CHECK (length(field_guid) BETWEEN 1 AND 256),
        field_type TEXT NOT NULL CHECK (length(field_type) BETWEEN 1 AND 64),
        single_select_option_guid TEXT
          CHECK (single_select_option_guid IS NULL
            OR length(single_select_option_guid) BETWEEN 1 AND 256),
        observed_at TEXT NOT NULL CHECK (length(observed_at) > 0),
        PRIMARY KEY (project_id, task_guid, field_guid),
        FOREIGN KEY (project_id, task_guid)
          REFERENCES workbench_feishu_task_projection (project_id, task_guid)
      ) STRICT;

      CREATE TABLE workbench_feishu_task_workflow_operation (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        organization_id TEXT NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 128),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 128),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
        expected_task_revision INTEGER NOT NULL CHECK (expected_task_revision > 0),
        expected_workflow_revision INTEGER CHECK (expected_workflow_revision > 0),
        mapping_mode TEXT NOT NULL CHECK (mapping_mode IN ('create', 'migrate')),
        definition_json TEXT NOT NULL CHECK (length(definition_json) > 0),
        mapping_json TEXT NOT NULL CHECK (length(mapping_json) > 0),
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
        state TEXT NOT NULL
          CHECK (state IN ('prepared', 'inflight', 'delivered', 'unknown', 'failed', 'conflict')),
        issue_json TEXT,
        attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 1),
        command_id TEXT NOT NULL UNIQUE CHECK (length(command_id) BETWEEN 1 AND 256),
        audit_event_id TEXT NOT NULL UNIQUE CHECK (length(audit_event_id) BETWEEN 1 AND 256),
        outbox_id TEXT NOT NULL UNIQUE CHECK (length(outbox_id) BETWEEN 1 AND 256),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        UNIQUE (organization_id, actor_id, idempotency_key_hash),
        FOREIGN KEY (project_id, organization_id, team_id)
          REFERENCES workbench_feishu_task_binding (project_id, organization_id, team_id)
      ) STRICT;

      CREATE INDEX workbench_feishu_task_custom_value_field
        ON workbench_feishu_task_custom_value (project_id, field_guid, single_select_option_guid);
      CREATE INDEX workbench_feishu_task_workflow_operation_project
        ON workbench_feishu_task_workflow_operation (project_id, created_at DESC, id);

      CREATE TRIGGER workbench_feishu_task_workflow_scope_no_update BEFORE UPDATE OF
        project_id, organization_id, team_id, field_guid, field_type, configured_at
        ON workbench_feishu_task_workflow
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow scope is immutable'); END;
      CREATE TRIGGER workbench_feishu_task_workflow_no_delete
        BEFORE DELETE ON workbench_feishu_task_workflow
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow mappings cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_workflow_version_no_update
        BEFORE UPDATE ON workbench_feishu_task_workflow_version
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow versions are append-only'); END;
      CREATE TRIGGER workbench_feishu_task_workflow_version_no_delete
        BEFORE DELETE ON workbench_feishu_task_workflow_version
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow versions cannot be deleted'); END;
      CREATE TRIGGER workbench_feishu_task_workflow_operation_intent_no_update BEFORE UPDATE OF
        id, project_id, organization_id, team_id, actor_id, expected_task_revision,
        expected_workflow_revision, mapping_mode, definition_json, mapping_json,
        request_hash, idempotency_key_hash,
        command_id, audit_event_id, outbox_id, created_at
        ON workbench_feishu_task_workflow_operation
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow operation intent is immutable'); END;
      CREATE TRIGGER workbench_feishu_task_workflow_operation_no_delete
        BEFORE DELETE ON workbench_feishu_task_workflow_operation
      BEGIN SELECT RAISE(ABORT, 'workbench Feishu workflow operations cannot be deleted'); END
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
  database.prepare(`
    SELECT organization_id, team_id, connection_id, realm, revision, updated_at
    FROM workbench_feishu_connection LIMIT 1
  `)
  database.prepare(`
    SELECT organization_id, team_id, kind, generation, identity_epoch, state, app_id,
      credential_ref, command_id, created_at
    FROM workbench_feishu_route_version LIMIT 1
  `)
  database.prepare(`
    SELECT organization_id, team_id, kind, identity_epoch, route_generation,
      app_id, open_id, tenant_key, verification_id, bound_at
    FROM workbench_feishu_identity_binding LIMIT 1
  `)
  database.prepare(`
    SELECT sequence, route_sequence, id, organization_id, team_id, kind,
      route_generation, identity_epoch, connection_revision, result,
      requested_resource_probe_json, checked_at
    FROM workbench_feishu_verification LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, organization_id, team_id, revision, tasklist_guid,
      route_kind, route_generation, sync_state, reconcile_generation
    FROM workbench_feishu_task_binding LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, task_guid, scope, visible, remote_version, projection_revision
    FROM workbench_feishu_task_projection LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, task_guid, command_id, referenced_at
    FROM workbench_feishu_task_reference LIMIT 1
  `)
  database.prepare(`
    SELECT event_id, project_id, task_guid, event_kind, outcome
    FROM workbench_feishu_task_inbox LIMIT 1
  `)
  database.prepare(`
    SELECT sequence, project_id, reconcile_generation, outcome
    FROM workbench_feishu_task_reconciliation LIMIT 1
  `)
  database.prepare(`
    SELECT id, project_id, task_guid, state, attempt_count, command_id
    FROM workbench_feishu_task_effect LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, revision, field_guid, field_remote_version, compatibility_state
    FROM workbench_feishu_task_workflow LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, revision, field_guid, mapping_json, command_id
    FROM workbench_feishu_task_workflow_version LIMIT 1
  `)
  database.prepare(`
    SELECT project_id, task_guid, field_guid, field_type, single_select_option_guid
    FROM workbench_feishu_task_custom_value LIMIT 1
  `)
  database.prepare(`
    SELECT id, project_id, expected_task_revision, expected_workflow_revision,
      mapping_mode, definition_json, mapping_json, request_hash, state, attempt_count, command_id
    FROM workbench_feishu_task_workflow_operation LIMIT 1
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
  const taskVocabulary = storedFeishuTaskVocabulary(row.command_type)
  if (taskVocabulary !== null) {
    const projectId = nullableString(row.project_id, 'Audit Project id')
    if (projectId === null
      || row.action !== taskVocabulary.auditAction
      || row.reason_code !== taskVocabulary.reason
      || row.object_type !== taskVocabulary.objectType
      || row.summary_code !== taskVocabulary.summaryCode
      || (row.command_type === FEISHU_TASK_LIST_BIND_COMMAND_TYPE && objectId !== projectId)
      || changedFields.length !== taskVocabulary.changedFields.length
      || changedFields.some((field, index) => field !== taskVocabulary.changedFields[index])) {
      throw new Error('Workbench database contains unsupported Feishu task audit fields')
    }
    return {
      ...common,
      action: taskVocabulary.auditAction,
      scope: { organizationId, teamId, projectId },
      reason: { code: taskVocabulary.reason },
      object: { type: taskVocabulary.objectType, id: objectId, version: objectVersion },
      command: { id: commandId, type: taskVocabulary.commandType },
      summary: {
        code: taskVocabulary.summaryCode,
        changedFields: Object.freeze([...taskVocabulary.changedFields]),
      },
    }
  }
  const feishuVocabulary = storedFeishuVocabulary(row.command_type, row.summary_code)
  if (feishuVocabulary !== null) {
    if (row.action !== feishuVocabulary.auditAction
      || row.reason_code !== feishuVocabulary.reason
      || row.object_type !== FEISHU_CONNECTION_OBJECT_TYPE
      || row.object_id !== FEISHU_CONNECTION_ID_VALUE
      || row.project_id !== null
      || row.summary_code !== feishuVocabulary.summaryCode
      || changedFields.length !== feishuVocabulary.changedFields.length
      || changedFields.some((field, index) => field !== feishuVocabulary.changedFields[index])) {
      throw new Error('Workbench database contains unsupported Feishu audit fields')
    }
    return {
      ...common,
      action: feishuVocabulary.auditAction,
      scope: { organizationId, teamId, projectId: null },
      reason: { code: feishuVocabulary.reason },
      object: {
        type: FEISHU_CONNECTION_OBJECT_TYPE,
        id: FEISHU_CONNECTION_ID_VALUE,
        version: objectVersion,
      },
      command: { id: commandId, type: feishuVocabulary.commandType },
      summary: {
        code: feishuVocabulary.summaryCode,
        changedFields: Object.freeze([...feishuVocabulary.changedFields]),
      },
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
  assertValidFeishuConnections(database)
  assertValidFeishuTasks(database)
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

function assertValidFeishuConnections(database: DatabaseSync): void {
  const connections = database.prepare(`
    SELECT organization_id, team_id, connection_id, realm, revision, updated_at
    FROM workbench_feishu_connection ORDER BY organization_id, team_id
  `).all() as unknown as FeishuConnectionRow[]
  for (const connection of connections) {
    readFeishuConnectionRow(database, connection.organization_id, connection.team_id)
    const audits = database.prepare(`
      SELECT object_version, occurred_at FROM workbench_audit_event
      WHERE organization_id = ? AND team_id = ? AND object_type = ? AND object_id = ?
        AND command_type IN (?, ?, ?, ?)
      ORDER BY object_version
    `).all(
      connection.organization_id,
      connection.team_id,
      FEISHU_CONNECTION_OBJECT_TYPE,
      FEISHU_CONNECTION_ID_VALUE,
      FEISHU_ROUTE_SET_COMMAND_TYPE,
      FEISHU_ROUTE_RESET_COMMAND_TYPE,
      FEISHU_ROUTE_DISABLE_COMMAND_TYPE,
      FEISHU_VERIFY_COMMAND_TYPE,
    ) as unknown as Array<{ readonly object_version: number; readonly occurred_at: string }>
    if (audits.length !== connection.revision) {
      throw new Error('Workbench Feishu connection revision does not match its audit history')
    }
    for (let index = 0; index < audits.length; index += 1) {
      if (audits[index]?.object_version !== index + 1) {
        throw new Error('Workbench Feishu connection audit revisions are not contiguous')
      }
    }
    if (audits.at(-1)?.occurred_at !== connection.updated_at) {
      throw new Error('Workbench Feishu connection head does not match its latest command')
    }
    for (const kind of ['bot', 'user'] as const) {
      const routes = database.prepare(`
        SELECT organization_id, team_id, kind, generation, identity_epoch, state, app_id,
          credential_ref, command_id, created_at
        FROM workbench_feishu_route_version
        WHERE organization_id = ? AND team_id = ? AND kind = ? ORDER BY generation
      `).all(
        connection.organization_id,
        connection.team_id,
        kind,
      ) as unknown as FeishuRouteRow[]
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index]
        if (route === undefined || route.generation !== index + 1) {
          throw new Error('Workbench Feishu route generations are not contiguous')
        }
        validateFeishuRouteRow(
          route,
          connection.organization_id,
          connection.team_id,
          kind,
        )
        const routeAudit = database.prepare(`
          SELECT command_type FROM workbench_audit_event WHERE command_id = ?
        `).get(route.command_id) as { readonly command_type: string } | undefined
        const previousRoute = routes[index - 1]
        const isInitialSet = index === 0
          && routeAudit?.command_type === FEISHU_ROUTE_SET_COMMAND_TYPE
          && route.identity_epoch === 1
        const isReset = index > 0
          && routeAudit?.command_type === FEISHU_ROUTE_RESET_COMMAND_TYPE
          && previousRoute !== undefined
          && previousRoute.state === 'configured'
          && route.state === 'configured'
          && route.app_id === previousRoute.app_id
          && route.credential_ref === previousRoute.credential_ref
          && route.identity_epoch === previousRoute.identity_epoch + 1
        const preservesIdentity = index > 0
          && (routeAudit?.command_type === FEISHU_ROUTE_SET_COMMAND_TYPE
            || routeAudit?.command_type === FEISHU_ROUTE_DISABLE_COMMAND_TYPE)
          && previousRoute !== undefined
          && (routeAudit.command_type !== FEISHU_ROUTE_DISABLE_COMMAND_TYPE
            || (previousRoute.state === 'configured'
              && route.state === 'disabled'
              && route.app_id === previousRoute.app_id
              && route.credential_ref === previousRoute.credential_ref))
          && (routeAudit.command_type !== FEISHU_ROUTE_SET_COMMAND_TYPE
            || route.state === 'configured')
          && route.identity_epoch === previousRoute.identity_epoch
        if (!isInitialSet && !isReset && !preservesIdentity) {
          throw new Error('Workbench Feishu route changed identity continuity without reset')
        }
        const verifications = database.prepare(`
          SELECT sequence, route_sequence, id, organization_id, team_id, kind,
            route_generation, identity_epoch, connection_revision, result, identity_state,
            identity_issue_json, actor_app_id, actor_open_id, actor_tenant_key,
            display_label, scope_state, scopes_json, scope_issue_json,
            requested_resource_probe_json, resource_probe_json, command_id, checked_at
          FROM workbench_feishu_verification
          WHERE organization_id = ? AND team_id = ? AND kind = ? AND route_generation = ?
          ORDER BY route_sequence
        `).all(
          connection.organization_id,
          connection.team_id,
          kind,
          route.generation,
        ) as unknown as FeishuVerificationRow[]
        const binding = readFeishuIdentityBinding(
          database,
          connection.organization_id,
          connection.team_id,
          kind,
          route.identity_epoch,
        )
        for (let verificationIndex = 0;
          verificationIndex < verifications.length;
          verificationIndex += 1) {
          const verification = verifications[verificationIndex]
          if (verification === undefined || verification.route_sequence !== verificationIndex + 1
            || verification.route_generation !== route.generation
            || verification.identity_epoch !== route.identity_epoch
            || verification.organization_id !== connection.organization_id
            || verification.team_id !== connection.team_id
            || verification.kind !== kind) {
            throw new Error('Workbench Feishu verification sequence escaped its route')
          }
          feishuVerificationProjectionFromRow(verification)
          if (verification.identity_state === 'verified') {
            if (binding === null
              || binding.app_id !== verification.actor_app_id
              || binding.open_id !== verification.actor_open_id
              || binding.tenant_key !== verification.actor_tenant_key) {
              throw new Error('Workbench Feishu verified actor does not match its binding')
            }
          }
        }
      }
      const identityEpochs = [...new Set(routes.map(route => route.identity_epoch))]
      for (const identityEpoch of identityEpochs) {
        const binding = readFeishuIdentityBinding(
          database,
          connection.organization_id,
          connection.team_id,
          kind,
          identityEpoch,
        )
        if (binding === null) continue
        const source = readFeishuBindingVerification(database, binding)
        const firstVerified = database.prepare(`
          SELECT id FROM workbench_feishu_verification
          WHERE organization_id = ? AND team_id = ? AND kind = ?
            AND identity_epoch = ? AND identity_state = 'verified'
          ORDER BY sequence LIMIT 1
        `).get(
          connection.organization_id,
          connection.team_id,
          kind,
          identityEpoch,
        ) as { readonly id: string } | undefined
        if (firstVerified?.id !== binding.verification_id
          || source.checked_at !== binding.bound_at
          || source.route_generation !== binding.route_generation
          || source.actor_app_id !== binding.app_id
          || source.actor_open_id !== binding.open_id
          || source.actor_tenant_key !== binding.tenant_key) {
          throw new Error('Workbench Feishu identity binding lacks its first verification fact')
        }
      }
    }
  }
  const orphanRoutes = integerField(database.prepare(`
    SELECT COUNT(*) AS count FROM workbench_feishu_route_version AS route
    LEFT JOIN workbench_feishu_connection AS connection
      ON connection.organization_id = route.organization_id
      AND connection.team_id = route.team_id
    WHERE connection.organization_id IS NULL
  `).get(), 'count')
  if (orphanRoutes !== 0) throw new Error('Workbench Feishu route escaped its connection')
}

function assertValidFeishuTasks(database: DatabaseSync): void {
  const bindings = database.prepare(`
    SELECT project_id, organization_id, team_id, revision, tasklist_guid,
      tasklist_name, canonical_url, route_kind, route_generation, app_id,
      open_id, tenant_key, created_by_workbench, remote_version, sync_state,
      sync_issue_json, last_event_at, last_reconciled_at, last_attempt_at,
      reconcile_generation, bound_at, updated_at
    FROM workbench_feishu_task_binding ORDER BY project_id
  `).all() as unknown as FeishuTaskBindingRow[]
  for (const binding of bindings) {
    validateStoredTaskBinding(binding)
    const project = readProjectById(database, binding.project_id)
    if (project === null || project.organization_id !== binding.organization_id
      || project.team_id !== binding.team_id) {
      throw new Error('Workbench Feishu task-list binding escaped its Project scope')
    }
    const route = taskRouteFromBinding(database, binding.project_id)
    if (route.kind !== binding.route_kind || route.routeGeneration !== binding.route_generation
      || route.actor.openId !== binding.open_id || route.actor.tenantKey !== binding.tenant_key) {
      throw new Error('Workbench Feishu task-list binding escaped its exact identity route')
    }

    const taskRows = database.prepare(`
      SELECT project_id, task_guid, scope, visible, parent_task_guid, task_id,
        summary, description, assignees_json, followers_json, comments_json,
        completed, completed_at, canonical_url, remote_version,
        projection_revision, reconcile_generation, created_at, updated_at
      FROM workbench_feishu_task_projection WHERE project_id = ?
      ORDER BY task_guid LIMIT ${MAX_FEISHU_TASKS_PER_PROJECT + 1}
    `).all(binding.project_id) as unknown as FeishuTaskProjectionRow[]
    if (taskRows.length > MAX_FEISHU_TASKS_PER_PROJECT) {
      throw new Error('Workbench Feishu task projection exceeds its bound')
    }
    for (const row of taskRows) {
      taskProjectionFromRow(row)
      if (row.project_id !== binding.project_id
        || row.projection_revision > binding.revision
        || row.reconcile_generation > binding.reconcile_generation) {
        throw new Error('Workbench Feishu task projection escaped its binding revision')
      }
      const referenced = taskReferenceExists(database, row.project_id, row.task_guid)
      if ((row.scope === 'explicit-reference') !== referenced
        || (referenced && row.visible !== 1)) {
        throw new Error('Workbench Feishu task visibility escaped its explicit reference')
      }
    }

    const workflowRow = readTaskWorkflowRow(database, binding.project_id)
    if (workflowRow !== null) {
      const visibleTasks = taskRows.filter(row => row.visible === 1).map(taskProjectionFromRow)
      const workflow = readTaskWorkflowProjection(database, binding, visibleTasks)
      if (workflow === null || workflow.revision !== workflowRow.revision) {
        throw new Error('Workbench Feishu workflow projection is inconsistent')
      }
      const versions = database.prepare(`
        SELECT revision, field_guid, field_remote_version, definition_json, mapping_json,
          options_json, compatibility_state, compatibility_issues_json, command_id, created_at
        FROM workbench_feishu_task_workflow_version WHERE project_id = ? ORDER BY revision
      `).all(binding.project_id) as unknown as Array<{
        readonly revision: number
        readonly field_guid: string
        readonly field_remote_version: string
        readonly definition_json: string
        readonly mapping_json: string
        readonly options_json: string
        readonly compatibility_state: string
        readonly compatibility_issues_json: string
        readonly command_id: string
        readonly created_at: string
      }>
      if (versions.length !== workflow.revision) {
        throw new Error('Workbench Feishu workflow version history is incomplete')
      }
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index]
        if (version === undefined || version.revision !== index + 1
          || version.field_guid !== workflow.field.fieldGuid) {
          throw new Error('Workbench Feishu workflow version history is invalid')
        }
        decodeWorkflowDefinition(version.definition_json)
        validateWorkflowMapping(JSON.parse(version.mapping_json) as
          import('./client.ts').ConfigureFeishuTaskWorkflowMapping)
        decodeWorkflowCompatibilityIssues(version.compatibility_issues_json)
        canonicalInstant(version.created_at, 'Stored workflow version createdAt')
      }
    }

    const customValues = database.prepare(`
      SELECT project_id, task_guid, field_guid, field_type,
        single_select_option_guid, observed_at
      FROM workbench_feishu_task_custom_value WHERE project_id = ?
      ORDER BY task_guid, field_guid
      LIMIT ${MAX_FEISHU_TASKS_PER_PROJECT * MAX_CUSTOM_FIELDS_PER_TASK + 1}
    `).all(binding.project_id) as unknown as FeishuTaskCustomValueRow[]
    if (customValues.length > MAX_FEISHU_TASKS_PER_PROJECT * MAX_CUSTOM_FIELDS_PER_TASK) {
      throw new Error('Workbench Feishu task custom values exceed their bound')
    }
    for (const value of customValues) {
      validateTaskCustomFieldValues([Object.freeze({
        fieldGuid: value.field_guid,
        type: value.field_type,
        singleSelectOptionGuid: value.single_select_option_guid,
      })], 'Stored Feishu task')
      canonicalInstant(value.observed_at, 'Stored task custom value observedAt')
      if (readTaskProjectionRow(database, value.project_id, value.task_guid) === null) {
        throw new Error('Workbench task custom value lost its task projection')
      }
    }

    const workflowOperations = database.prepare(`
      SELECT id, project_id, organization_id, team_id, actor_id,
        expected_task_revision, expected_workflow_revision, mapping_mode,
        definition_json, mapping_json,
        request_hash, idempotency_key_hash, state, issue_json, attempt_count,
        command_id, audit_event_id, outbox_id, created_at, updated_at
      FROM workbench_feishu_task_workflow_operation
      WHERE project_id = ? ORDER BY created_at, id
    `).all(binding.project_id) as unknown as FeishuTaskWorkflowOperationRow[]
    for (const operation of workflowOperations) {
      validateStoredTaskWorkflowOperation(operation)
      if (operation.organization_id !== binding.organization_id
        || operation.team_id !== binding.team_id
        || operation.expected_task_revision > binding.revision) {
        throw new Error('Workbench workflow operation escaped its task binding')
      }
      const receipt = database.prepare(`
        SELECT command_type, request_hash, audit_event_id, outbox_id
        FROM workbench_command_receipt WHERE command_id = ?
      `).get(operation.command_id) as {
        readonly command_type: string
        readonly request_hash: string
        readonly audit_event_id: string
        readonly outbox_id: string
      } | undefined
      if (receipt?.command_type !== FEISHU_TASK_WORKFLOW_COMMAND_TYPE
        || receipt.request_hash !== operation.request_hash
        || receipt.audit_event_id !== operation.audit_event_id
        || receipt.outbox_id !== operation.outbox_id) {
        throw new Error('Workflow operation lacks its receipt-first ledger')
      }
      const outbox = database.prepare(`
        SELECT state, attempt_count, error_code FROM workbench_outbox WHERE id = ?
      `).get(operation.outbox_id) as {
        readonly state: string
        readonly attempt_count: number
        readonly error_code: string | null
      } | undefined
      const claimed = operation.state !== 'prepared'
      const expectedOutboxState = operation.state === 'delivered'
        ? 'delivered'
        : operation.state === 'unknown'
          ? 'unknown'
          : operation.state === 'failed' || operation.state === 'conflict'
            ? 'failed'
            : 'pending'
      const expectedError = expectedOutboxState === 'unknown'
        ? 'transport-ambiguous'
        : expectedOutboxState === 'failed' ? 'definitive-rejection' : null
      if (outbox === undefined || outbox.state !== expectedOutboxState
        || outbox.attempt_count !== (claimed ? 1 : 0)
        || outbox.error_code !== expectedError) {
        throw new Error('Workflow operation disagrees with its Outbox state')
      }
    }

    const references = database.prepare(`
      SELECT project_id, task_guid, command_id, referenced_at
      FROM workbench_feishu_task_reference WHERE project_id = ? ORDER BY task_guid
    `).all(binding.project_id) as unknown as Array<{
      readonly project_id: string
      readonly task_guid: string
      readonly command_id: string
      readonly referenced_at: string
    }>
    for (const reference of references) {
      validateFeishuResourceId(reference.task_guid, 'Stored referenced task guid')
      validateBoundedReference(reference.command_id, 'Stored task reference command id')
      canonicalInstant(reference.referenced_at, 'Stored task referencedAt')
      const task = readTaskProjectionRow(database, reference.project_id, reference.task_guid)
      if (task === null || task.scope !== 'explicit-reference' || task.visible !== 1) {
        throw new Error('Workbench Feishu task reference lacks its visible projection')
      }
    }

    const reconciliations = database.prepare(`
      SELECT sequence, binding_revision, reconcile_generation, outcome, issue_json,
        task_count, snapshot_digest, attempted_at
      FROM workbench_feishu_task_reconciliation WHERE project_id = ?
      ORDER BY reconcile_generation
    `).all(binding.project_id) as unknown as Array<{
      readonly sequence: number
      readonly binding_revision: number
      readonly reconcile_generation: number
      readonly outcome: string
      readonly issue_json: string | null
      readonly task_count: number
      readonly snapshot_digest: string | null
      readonly attempted_at: string
    }>
    if (reconciliations.length !== binding.reconcile_generation) {
      throw new Error('Workbench Feishu reconciliation generation is incomplete')
    }
    for (let index = 0; index < reconciliations.length; index += 1) {
      const reconciliation = reconciliations[index]
      if (reconciliation === undefined || reconciliation.reconcile_generation !== index + 1
        || reconciliation.binding_revision < 1
        || reconciliation.binding_revision > binding.revision
        || !Number.isSafeInteger(reconciliation.task_count)
        || reconciliation.task_count < 0
        || reconciliation.task_count > MAX_FEISHU_TASKS_PER_PROJECT) {
        throw new Error('Workbench Feishu reconciliation history is invalid')
      }
      positiveInteger(reconciliation.sequence, 'Stored task reconciliation sequence')
      canonicalInstant(reconciliation.attempted_at, 'Stored task reconciliation attemptedAt')
      if (reconciliation.outcome === 'healthy') {
        if (reconciliation.issue_json !== null || reconciliation.snapshot_digest === null
          || !reconciliation.snapshot_digest.startsWith('sha256:')
          || !SHA256_HEX.test(reconciliation.snapshot_digest.slice(7))) {
          throw new Error('Workbench healthy Feishu reconciliation lacks its snapshot fact')
        }
      } else if (reconciliation.outcome === 'attention') {
        if (reconciliation.issue_json === null || reconciliation.snapshot_digest !== null) {
          throw new Error('Workbench failed Feishu reconciliation lacks its issue fact')
        }
        decodeFeishuIssue(reconciliation.issue_json)
      } else {
        throw new Error('Workbench Feishu reconciliation outcome is invalid')
      }
    }

    const inbox = database.prepare(`
      SELECT event_id, project_id, tasklist_guid, task_guid, event_kind,
        remote_version, outcome, occurred_at, received_at, projection_revision
      FROM workbench_feishu_task_inbox WHERE project_id = ? ORDER BY received_at, event_id
    `).all(binding.project_id) as unknown as Array<{
      readonly event_id: string
      readonly project_id: string
      readonly tasklist_guid: string
      readonly task_guid: string
      readonly event_kind: string
      readonly remote_version: string
      readonly outcome: string
      readonly occurred_at: string
      readonly received_at: string
      readonly projection_revision: number | null
    }>
    for (const event of inbox) {
      validateBoundedReference(event.event_id, 'Stored task event id')
      validateFeishuResourceId(event.task_guid, 'Stored task event guid')
      validateRemoteVersion(event.remote_version, 'Stored task event remote version')
      canonicalInstant(event.occurred_at, 'Stored task event occurredAt')
      canonicalInstant(event.received_at, 'Stored task event receivedAt')
      if (event.tasklist_guid !== binding.tasklist_guid
        || (event.event_kind !== 'upsert' && event.event_kind !== 'removed')
        || (event.outcome !== 'applied' && event.outcome !== 'stale'
          && event.outcome !== 'ignored')) {
        throw new Error('Workbench Feishu task event escaped its binding')
      }
      if (event.outcome === 'applied') {
        if (event.projection_revision === null || event.projection_revision > binding.revision) {
          throw new Error('Workbench applied task event lacks its projection revision')
        }
        positiveInteger(event.projection_revision, 'Stored task event projection revision')
      } else if (event.projection_revision !== null) {
        throw new Error('Workbench unapplied task event advanced the projection')
      }
    }

    const effects = database.prepare(`
      SELECT id, project_id, organization_id, team_id, actor_id, task_guid,
        expected_project_revision, expected_remote_version, changes_json,
        request_hash, idempotency_key_hash, state, issue_json,
        current_remote_version, attempt_count, command_id, audit_event_id,
        outbox_id, created_at, updated_at
      FROM workbench_feishu_task_effect WHERE project_id = ? ORDER BY created_at, id
    `).all(binding.project_id) as unknown as FeishuTaskEffectRow[]
    for (const effect of effects) {
      validateStoredTaskEffect(effect)
      if (effect.organization_id !== binding.organization_id || effect.team_id !== binding.team_id) {
        throw new Error('Workbench Feishu task effect escaped its authorized scope')
      }
      const state = taskEffectState(effect.state)
      const claimed = state !== 'prepared'
      if (effect.attempt_count !== (claimed ? 1 : 0)
        || ((state === 'unknown' || state === 'failed') !== (effect.issue_json !== null))
        || (state === 'conflict') !== (effect.current_remote_version !== null)) {
        throw new Error('Workbench Feishu task effect state facts are inconsistent')
      }
      if (effect.issue_json !== null) decodeFeishuIssue(effect.issue_json)
      if (effect.current_remote_version !== null) {
        validateRemoteVersion(effect.current_remote_version, 'Stored task conflict remote version')
      }
      const outbox = database.prepare(`
        SELECT state, attempt_count, error_code FROM workbench_outbox WHERE id = ?
      `).get(effect.outbox_id) as {
        readonly state: string
        readonly attempt_count: number
        readonly error_code: string | null
      } | undefined
      const expectedOutboxState = state === 'delivered'
        ? 'delivered'
        : state === 'unknown'
          ? 'unknown'
          : state === 'failed' || state === 'conflict'
            ? 'failed'
            : 'pending'
      if (outbox === undefined || outbox.state !== expectedOutboxState
        || outbox.attempt_count !== (claimed ? 1 : 0)) {
        throw new Error('Workbench Feishu task effect disagrees with its Outbox state')
      }
    }
  }
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
  if (storedFeishuTaskVocabulary(row.command_type) !== null) {
    assertValidFeishuTaskReceipt(database, row)
    return
  }
  if (storedFeishuVocabulary(row.command_type, row.audit_summary_code) !== null) {
    assertValidFeishuReceipt(database, row)
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

function assertValidFeishuTaskReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  const vocabulary = storedFeishuTaskVocabulary(row.command_type)
  if (vocabulary === null
    || row.audit_action !== vocabulary.auditAction
    || row.audit_reason_code !== vocabulary.reason
    || row.audit_object_type !== vocabulary.objectType
    || row.audit_summary_code !== vocabulary.summaryCode
    || row.audit_project_id === null
    || row.outbox_topic !== vocabulary.outboxTopic
    || row.outbox_project_id !== row.audit_project_id
    || row.outbox_object_type !== vocabulary.objectType
    || row.outbox_object_id !== row.audit_object_id) {
    throw new Error('Workbench Feishu task receipt has mismatched audit or Outbox vocabulary')
  }
  let expectedRequestHash: string
  if (row.command_type === FEISHU_TASK_LIST_BIND_COMMAND_TYPE) {
    const decoded = decodeTaskListBindingResult(row.result_json, row)
    const binding = decoded.value.binding
    if (binding === null || decoded.value.projectId !== row.audit_project_id
      || row.audit_object_id !== decoded.value.projectId
      || row.audit_object_version !== decoded.value.revision
      || decoded.value.revision !== 1) {
      throw new Error('Workbench task-list receipt does not match its committed projection')
    }
    const historicalConnectionRevision = integerField(database.prepare(`
      SELECT COUNT(*) AS count FROM workbench_audit_event
      WHERE organization_id = ? AND team_id = ? AND sequence < ?
        AND command_type IN (?, ?, ?, ?)
    `).get(
      row.audit_organization_id,
      row.audit_team_id,
      row.audit_sequence,
      FEISHU_ROUTE_SET_COMMAND_TYPE,
      FEISHU_ROUTE_RESET_COMMAND_TYPE,
      FEISHU_ROUTE_DISABLE_COMMAND_TYPE,
      FEISHU_VERIFY_COMMAND_TYPE,
    ), 'count')
    expectedRequestHash = digest(canonicalizeJson({
      commandType: FEISHU_TASK_LIST_BIND_COMMAND_TYPE,
      target: FEISHU_TASK_LIST_BIND_OBJECT_TYPE,
      scope: {
        organizationId: row.audit_organization_id,
        teamId: row.audit_team_id,
        projectId: row.audit_project_id,
      },
      intent: binding.createdByWorkbench
        ? { mode: 'create', name: binding.name }
        : { mode: 'existing', taskListGuid: binding.taskListGuid },
      expectedBindingRevision: null,
      expectedConnectionRevision: historicalConnectionRevision,
      expectedRouteGeneration: binding.identity.routeGeneration,
      routeKind: binding.identity.kind,
      reason: vocabulary.reason,
      causationId: row.audit_causation_id,
    }))
  } else if (row.command_type === FEISHU_TASK_REFERENCE_COMMAND_TYPE) {
    const decoded = decodeTaskReferenceResult(row.result_json, row)
    if (decoded.value.projectId !== row.audit_project_id
      || decoded.value.revision !== row.audit_object_version
      || !decoded.value.tasks.some(task =>
        task.taskGuid === row.audit_object_id && task.scope === 'explicit-reference')) {
      throw new Error('Workbench task reference receipt does not match its projection')
    }
    expectedRequestHash = digest(canonicalizeJson({
      commandType: FEISHU_TASK_REFERENCE_COMMAND_TYPE,
      target: FEISHU_TASK_OBJECT_TYPE,
      scope: {
        organizationId: row.audit_organization_id,
        teamId: row.audit_team_id,
        projectId: row.audit_project_id,
      },
      taskGuid: row.audit_object_id,
      expectedRevision: row.audit_object_version - 1,
      reason: vocabulary.reason,
      causationId: row.audit_causation_id,
    }))
  } else if (row.command_type === FEISHU_TASK_WORKFLOW_COMMAND_TYPE) {
    const operation = readTaskWorkflowOperationByCommand(database, row.command_id)
    if (operation !== null) {
      const accepted = decodeTaskWorkflowOperationAcceptedResult(row.result_json, row)
      const intent = decodeStoredTaskWorkflowOperationIntent(operation)
      if (accepted.operationId !== operation.id
        || accepted.projectId !== operation.project_id
        || accepted.mappingMode !== operation.mapping_mode
        || accepted.expectedTaskRevision !== operation.expected_task_revision
        || accepted.expectedWorkflowRevision !== operation.expected_workflow_revision
        || accepted.createdAt !== operation.created_at
        || operation.organization_id !== row.audit_organization_id
        || operation.team_id !== row.audit_team_id
        || operation.actor_id !== row.receipt_actor_id
        || operation.idempotency_key_hash !== row.idempotency_key_hash
        || operation.request_hash !== row.request_hash
        || operation.audit_event_id !== row.audit_event_id
        || operation.outbox_id !== row.outbox_id
        || row.audit_object_id !== operation.project_id
        || row.audit_object_version !== (operation.expected_workflow_revision ?? 0) + 1
        || row.audit_occurred_at !== operation.created_at) {
        throw new Error('Workbench workflow operation receipt does not match its durable intent')
      }
      const version = database.prepare(`
        SELECT revision, definition_json, mapping_json, created_at
        FROM workbench_feishu_task_workflow_version WHERE command_id = ?
      `).get(row.command_id) as {
        readonly revision: number
        readonly definition_json: string
        readonly mapping_json: string
        readonly created_at: string
      } | undefined
      if (operation.state === 'delivered') {
        if (version === undefined
          || version.revision !== (operation.expected_workflow_revision ?? 0) + 1
          || version.definition_json !== operation.definition_json
          || version.mapping_json !== operation.mapping_json
          || version.created_at !== row.audit_occurred_at) {
          throw new Error('Delivered workflow operation disagrees with its immutable version')
        }
      } else if (version !== undefined) {
        throw new Error('Uncommitted workflow operation unexpectedly owns a workflow version')
      }
      expectedRequestHash = digest(canonicalizeJson({
        commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
        target: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
        scope: {
          organizationId: operation.organization_id,
          teamId: operation.team_id,
          projectId: operation.project_id,
        },
        expectedTaskRevision: operation.expected_task_revision,
        expectedWorkflowRevision: operation.expected_workflow_revision,
        definition: intent.definition,
        mapping: intent.mapping,
        reason: vocabulary.reason,
        causationId: row.audit_causation_id,
      }))
    } else {
      const decoded = decodeTaskWorkflowConfigurationResult(row.result_json, row)
      const workflow = decoded.value.workflow
      if (workflow === null || decoded.value.projectId !== row.audit_project_id
        || row.audit_object_id !== decoded.value.projectId
        || row.audit_object_version !== workflow.revision) {
        throw new Error('Workbench mapped workflow receipt does not match its projection')
      }
      const version = database.prepare(`
        SELECT revision, definition_json, mapping_json, created_at
        FROM workbench_feishu_task_workflow_version WHERE command_id = ?
      `).get(row.command_id) as {
        readonly revision: number
        readonly definition_json: string
        readonly mapping_json: string
        readonly created_at: string
      } | undefined
      if (version === undefined || version.revision !== workflow.revision
        || version.created_at !== row.audit_occurred_at) {
        throw new Error('Workbench mapped workflow receipt lost its immutable version')
      }
      let mappingValue: unknown
      try { mappingValue = JSON.parse(version.mapping_json) } catch {
        throw new Error('Workbench mapped workflow version contains invalid mapping JSON')
      }
      const mapping = normalizedWorkflowMapping(
        mappingValue as import('./client.ts').ConfigureFeishuTaskWorkflowMapping,
      )
      if (canonicalizeJson(mapping) !== version.mapping_json) {
        throw new Error('Workbench mapped workflow version is not normalized')
      }
      if (mapping.mode !== 'existing') {
        throw new Error('Workbench external workflow receipt lost its durable operation')
      }
      expectedRequestHash = digest(canonicalizeJson({
        commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
        target: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
        scope: {
          organizationId: row.audit_organization_id,
          teamId: row.audit_team_id,
          projectId: row.audit_project_id,
        },
        expectedTaskRevision: decoded.value.revision - 1,
        expectedWorkflowRevision: workflow.revision === 1 ? null : workflow.revision - 1,
        definition: workflow.definition,
        mapping,
        reason: vocabulary.reason,
        causationId: row.audit_causation_id,
      }))
    }
  } else {
    let parsed: unknown
    try { parsed = JSON.parse(row.result_json) } catch {
      throw new Error('Workbench task update receipt contains invalid JSON')
    }
    if (canonicalizeJson(parsed) !== row.result_json) {
      throw new Error('Workbench task update receipt is not canonical JSON')
    }
    const committed = objectValue(parsed, 'Workbench task update receipt')
    if (committed.ok !== true) throw new Error('Workbench task update receipt is not committed')
    const receipt = objectValue(committed.receipt, 'Workbench task update command receipt')
    if (receipt.commandId !== row.command_id || receipt.auditEventId !== row.audit_event_id
      || receipt.outboxId !== row.outbox_id) {
      throw new Error('Workbench task update receipt references mismatched ledger artifacts')
    }
    const projectedEffect = decodeStoredTaskEffectProjection(committed.value)
    const effect = readTaskEffectByCommand(database, row.command_id)
    if (effect === null || effect.id !== projectedEffect.effectId
      || effect.task_guid !== projectedEffect.taskGuid
      || row.audit_object_id !== effect.task_guid
      || row.audit_object_version !== effect.expected_project_revision
      || effect.audit_event_id !== row.audit_event_id
      || effect.outbox_id !== row.outbox_id
      || effect.organization_id !== row.audit_organization_id
      || effect.team_id !== row.audit_team_id
      || effect.project_id !== row.audit_project_id) {
      throw new Error('Workbench task update receipt does not match its durable effect')
    }
    const requested = publicTaskChangesFromStored(effect.changes_json)
    expectedRequestHash = digest(canonicalizeJson({
      commandType: FEISHU_TASK_UPDATE_COMMAND_TYPE,
      target: FEISHU_TASK_OBJECT_TYPE,
      scope: {
        organizationId: row.audit_organization_id,
        teamId: row.audit_team_id,
        projectId: row.audit_project_id,
      },
      taskGuid: effect.task_guid,
      expectedRevision: effect.expected_project_revision,
      expectedRemoteVersion: effect.expected_remote_version,
      ...(requested.expectedWorkflowRevision === undefined
        ? {}
        : { expectedWorkflowRevision: requested.expectedWorkflowRevision }),
      changes: requested.changes,
      reason: vocabulary.reason,
      causationId: row.audit_causation_id,
    }))
  }
  const expectedPayload = canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    requestHash: row.request_hash,
    projectId: row.audit_project_id,
    objectType: vocabulary.objectType,
    objectId: row.audit_object_id,
    objectVersion: row.audit_object_version,
    causationId: row.audit_causation_id,
  })
  if (row.request_hash !== expectedRequestHash || row.outbox_payload_json !== expectedPayload) {
    throw new Error('Workbench Feishu task receipt has invalid request or Outbox facts')
  }
}

function assertValidFeishuReceipt(
  database: DatabaseSync,
  row: ReceiptIntegrityRow,
): void {
  const vocabulary = storedFeishuVocabulary(row.command_type, row.audit_summary_code)
  if (vocabulary === null
    || row.audit_action !== vocabulary.auditAction
    || row.audit_reason_code !== vocabulary.reason
    || row.audit_object_type !== FEISHU_CONNECTION_OBJECT_TYPE
    || row.audit_object_id !== FEISHU_CONNECTION_ID_VALUE
    || row.audit_project_id !== null
    || row.outbox_topic !== vocabulary.outboxTopic
    || row.outbox_project_id !== null
    || row.outbox_object_type !== FEISHU_CONNECTION_OBJECT_TYPE
    || row.outbox_object_id !== FEISHU_CONNECTION_ID_VALUE) {
    throw new Error('Workbench Feishu receipt has mismatched audit or Outbox vocabulary')
  }
  let routeKind: FeishuIdentityKind
  let routeGeneration: number
  if (row.command_type === FEISHU_VERIFY_COMMAND_TYPE) {
    const verification = database.prepare(`
      SELECT sequence, route_sequence, id, organization_id, team_id, kind,
        route_generation, identity_epoch, connection_revision, result, identity_state,
        identity_issue_json, actor_app_id, actor_open_id, actor_tenant_key,
        display_label, scope_state, scopes_json, scope_issue_json,
        requested_resource_probe_json, resource_probe_json, command_id, checked_at
      FROM workbench_feishu_verification WHERE command_id = ?
    `).get(row.command_id) as FeishuVerificationRow | undefined
    if (verification === undefined) {
      throw new Error('Workbench Feishu verification receipt lost its observation')
    }
    const projection = feishuVerificationProjectionFromRow(verification)
    const decoded = decodeFeishuVerificationResult(row.result_json, row)
    routeKind = feishuIdentityKind(verification.kind)
    routeGeneration = verification.route_generation
    if (verification.organization_id !== row.audit_organization_id
      || verification.team_id !== row.audit_team_id
      || verification.command_id !== row.command_id
      || verification.connection_revision !== row.audit_object_version
      || verification.checked_at !== row.audit_occurred_at
      || decoded.value.connectionRevision !== verification.connection_revision
      || decoded.value.kind !== routeKind
      || decoded.value.routeGeneration !== routeGeneration
      || decoded.value.verificationSequence !== verification.route_sequence
      || decoded.value.result !== projection.result
      || vocabulary.summaryCode !== feishuVerificationSummary(projection.result)) {
      throw new Error('Workbench Feishu verification receipt does not match its observation')
    }
    const resource = decodeFeishuRequestedResourceProbe(
      verification.requested_resource_probe_json,
    )
    const expectedRequestHash = digest(canonicalizeJson({
      commandType: FEISHU_VERIFY_COMMAND_TYPE,
      target: FEISHU_CONNECTION_OBJECT_TYPE,
      scope: {
        organizationId: row.audit_organization_id,
        teamId: row.audit_team_id,
      },
      kind: routeKind,
      expectedConnectionRevision: verification.connection_revision - 1,
      expectedRouteGeneration: routeGeneration,
      resourceProbe: resource,
      reason: FEISHU_VERIFY_REASON,
      causationId: row.audit_causation_id,
    }))
    if (row.request_hash !== expectedRequestHash) {
      throw new Error('Workbench Feishu verification receipt has an invalid request hash')
    }
  } else {
    const route = database.prepare(`
      SELECT organization_id, team_id, kind, generation, identity_epoch, state, app_id,
        credential_ref, command_id, created_at
      FROM workbench_feishu_route_version WHERE command_id = ?
    `).get(row.command_id) as FeishuRouteRow | undefined
    if (route === undefined) throw new Error('Workbench Feishu route receipt lost its version')
    routeKind = feishuIdentityKind(route.kind)
    routeGeneration = route.generation
    validateFeishuRouteRow(
      route,
      row.audit_organization_id,
      row.audit_team_id,
      routeKind,
    )
    const decoded = decodeFeishuRouteResult(row.result_json, row)
    const mode = row.command_type === FEISHU_ROUTE_SET_COMMAND_TYPE
      ? 'set' as const
      : row.command_type === FEISHU_ROUTE_RESET_COMMAND_TYPE
        ? 'reset' as const
        : 'disable' as const
    if (decoded.value.connectionRevision !== row.audit_object_version
      || decoded.value.kind !== routeKind
      || decoded.value.routeGeneration !== routeGeneration
      || decoded.value.state !== route.state
      || route.command_id !== row.command_id
      || route.created_at !== row.audit_occurred_at) {
      throw new Error('Workbench Feishu route receipt does not match its version')
    }
    const expectedRequestHash = digest(canonicalizeJson({
      commandType: row.command_type,
      target: FEISHU_CONNECTION_OBJECT_TYPE,
      scope: {
        organizationId: row.audit_organization_id,
        teamId: row.audit_team_id,
      },
      kind: routeKind,
      mode,
      ...(mode === 'set' ? { appId: route.app_id, credentialRef: route.credential_ref } : {}),
      expectedConnectionRevision: decoded.value.connectionRevision - 1,
      expectedRouteGeneration: routeGeneration === 1 ? null : routeGeneration - 1,
      reason: vocabulary.reason,
      causationId: row.audit_causation_id,
    }))
    if (row.request_hash !== expectedRequestHash) {
      throw new Error('Workbench Feishu route receipt has an invalid request hash')
    }
  }
  const expectedPayload = canonicalizeJson({
    schemaVersion: 1,
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    requestHash: row.request_hash,
    connectionRevision: row.audit_object_version,
    routeKind,
    routeGeneration,
    causationId: row.audit_causation_id,
  })
  if (row.outbox_payload_json !== expectedPayload) {
    throw new Error('Workbench Feishu receipt has an invalid redacted Outbox intent')
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
    const taskVocabulary = storedFeishuTaskVocabulary(row.command_type)
    if (taskVocabulary !== null) {
      if (row.action !== taskVocabulary.auditAction
        || row.reason_code !== taskVocabulary.reason
        || row.object_type !== taskVocabulary.objectType
        || row.summary_code !== taskVocabulary.summaryCode
        || projectId === null
        || (row.command_type === FEISHU_TASK_LIST_BIND_COMMAND_TYPE
          && projectId !== row.object_id)) {
        throw new Error('Workbench database contains an unsupported Feishu task Activity row')
      }
      vocabulary = {
        action: taskVocabulary.auditAction,
        reason: taskVocabulary.reason,
        summaryCode: taskVocabulary.summaryCode,
        objectType: taskVocabulary.objectType,
      }
    } else {
    const feishuVocabulary = storedFeishuVocabulary(row.command_type, row.summary_code)
    if (feishuVocabulary !== null) {
      if (row.action !== feishuVocabulary.auditAction
        || row.reason_code !== feishuVocabulary.reason
        || row.object_type !== FEISHU_CONNECTION_OBJECT_TYPE
        || row.object_id !== FEISHU_CONNECTION_ID_VALUE
        || row.summary_code !== feishuVocabulary.summaryCode
        || projectId !== null) {
        throw new Error('Workbench database contains an unsupported Feishu Activity row')
      }
      vocabulary = {
        action: feishuVocabulary.auditAction,
        reason: feishuVocabulary.reason,
        summaryCode: feishuVocabulary.summaryCode,
        objectType: FEISHU_CONNECTION_OBJECT_TYPE,
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

interface StoredFeishuVocabulary {
  readonly commandType: AuditEvent['command']['type']
  readonly auditAction: WorkbenchAuditAction
  readonly reason: WorkbenchCommandMetadata['reason']
  readonly summaryCode: WorkbenchActivitySummaryCode
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
}

interface StoredFeishuTaskVocabulary {
  readonly commandType:
    | typeof FEISHU_TASK_LIST_BIND_COMMAND_TYPE
    | typeof FEISHU_TASK_REFERENCE_COMMAND_TYPE
    | typeof FEISHU_TASK_UPDATE_COMMAND_TYPE
    | typeof FEISHU_TASK_WORKFLOW_COMMAND_TYPE
  readonly auditAction:
    | typeof FEISHU_TASK_LIST_BIND_AUDIT_ACTION
    | typeof FEISHU_TASK_REFERENCE_AUDIT_ACTION
    | typeof FEISHU_TASK_UPDATE_AUDIT_ACTION
    | typeof FEISHU_TASK_WORKFLOW_AUDIT_ACTION
  readonly reason:
    | typeof FEISHU_TASK_LIST_BIND_REASON
    | typeof FEISHU_TASK_REFERENCE_REASON
    | typeof FEISHU_TASK_UPDATE_REASON
    | typeof FEISHU_TASK_WORKFLOW_REASON
  readonly summaryCode:
    | typeof FEISHU_TASK_LIST_BIND_SUMMARY
    | typeof FEISHU_TASK_REFERENCE_SUMMARY
    | typeof FEISHU_TASK_UPDATE_SUMMARY
    | typeof FEISHU_TASK_WORKFLOW_SUMMARY
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
  readonly objectType:
    | typeof FEISHU_TASK_LIST_BIND_OBJECT_TYPE
    | typeof FEISHU_TASK_OBJECT_TYPE
    | typeof FEISHU_TASK_WORKFLOW_OBJECT_TYPE
}

function storedFeishuTaskVocabulary(commandType: string): StoredFeishuTaskVocabulary | null {
  switch (commandType) {
    case FEISHU_TASK_LIST_BIND_COMMAND_TYPE:
      return {
        commandType: FEISHU_TASK_LIST_BIND_COMMAND_TYPE,
        auditAction: FEISHU_TASK_LIST_BIND_AUDIT_ACTION,
        reason: FEISHU_TASK_LIST_BIND_REASON,
        summaryCode: FEISHU_TASK_LIST_BIND_SUMMARY,
        changedFields: ['taskList', 'tasks', 'sync'],
        outboxTopic: FEISHU_TASK_LIST_BIND_OUTBOX_TOPIC,
        objectType: FEISHU_TASK_LIST_BIND_OBJECT_TYPE,
      }
    case FEISHU_TASK_REFERENCE_COMMAND_TYPE:
      return {
        commandType: FEISHU_TASK_REFERENCE_COMMAND_TYPE,
        auditAction: FEISHU_TASK_REFERENCE_AUDIT_ACTION,
        reason: FEISHU_TASK_REFERENCE_REASON,
        summaryCode: FEISHU_TASK_REFERENCE_SUMMARY,
        changedFields: ['scope', 'task'],
        outboxTopic: FEISHU_TASK_REFERENCE_OUTBOX_TOPIC,
        objectType: FEISHU_TASK_OBJECT_TYPE,
      }
    case FEISHU_TASK_UPDATE_COMMAND_TYPE:
      return {
        commandType: FEISHU_TASK_UPDATE_COMMAND_TYPE,
        auditAction: FEISHU_TASK_UPDATE_AUDIT_ACTION,
        reason: FEISHU_TASK_UPDATE_REASON,
        summaryCode: FEISHU_TASK_UPDATE_SUMMARY,
        changedFields: ['remoteVersion', 'changes', 'effectState'],
        outboxTopic: FEISHU_TASK_UPDATE_OUTBOX_TOPIC,
        objectType: FEISHU_TASK_OBJECT_TYPE,
      }
    case FEISHU_TASK_WORKFLOW_COMMAND_TYPE:
      return {
        commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
        auditAction: FEISHU_TASK_WORKFLOW_AUDIT_ACTION,
        reason: FEISHU_TASK_WORKFLOW_REASON,
        summaryCode: FEISHU_TASK_WORKFLOW_SUMMARY,
        changedFields: ['workflowDefinition', 'fieldMapping', 'compatibility'],
        outboxTopic: FEISHU_TASK_WORKFLOW_OUTBOX_TOPIC,
        objectType: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
      }
    default: return null
  }
}

function storedFeishuVocabulary(
  commandType: string,
  summaryCode: string,
): StoredFeishuVocabulary | null {
  if (commandType === FEISHU_ROUTE_SET_COMMAND_TYPE) {
    return {
      commandType: FEISHU_ROUTE_SET_COMMAND_TYPE,
      auditAction: FEISHU_ROUTE_SET_AUDIT_ACTION,
      reason: FEISHU_ROUTE_SET_REASON,
      summaryCode: FEISHU_ROUTE_SET_SUMMARY,
      changedFields: ['route', 'credentialRef'],
      outboxTopic: FEISHU_ROUTE_OUTBOX_TOPIC,
    }
  }
  if (commandType === FEISHU_ROUTE_RESET_COMMAND_TYPE) {
    return {
      commandType: FEISHU_ROUTE_RESET_COMMAND_TYPE,
      auditAction: FEISHU_ROUTE_RESET_AUDIT_ACTION,
      reason: FEISHU_ROUTE_RESET_REASON,
      summaryCode: FEISHU_ROUTE_RESET_SUMMARY,
      changedFields: ['route', 'identityBinding'],
      outboxTopic: FEISHU_ROUTE_OUTBOX_TOPIC,
    }
  }
  if (commandType === FEISHU_ROUTE_DISABLE_COMMAND_TYPE) {
    return {
      commandType: FEISHU_ROUTE_DISABLE_COMMAND_TYPE,
      auditAction: FEISHU_ROUTE_DISABLE_AUDIT_ACTION,
      reason: FEISHU_ROUTE_DISABLE_REASON,
      summaryCode: FEISHU_ROUTE_DISABLE_SUMMARY,
      changedFields: ['route', 'state'],
      outboxTopic: FEISHU_ROUTE_OUTBOX_TOPIC,
    }
  }
  if (commandType !== FEISHU_VERIFY_COMMAND_TYPE) return null
  const verificationSummary = summaryCode === FEISHU_VERIFY_HEALTHY_SUMMARY
    || summaryCode === FEISHU_VERIFY_ATTENTION_SUMMARY
    || summaryCode === FEISHU_VERIFY_FAILED_SUMMARY
    ? summaryCode
    : null
  if (verificationSummary === null) return null
  return {
    commandType: FEISHU_VERIFY_COMMAND_TYPE,
    auditAction: FEISHU_VERIFY_AUDIT_ACTION,
    reason: FEISHU_VERIFY_REASON,
    summaryCode: verificationSummary,
    changedFields: ['verification'],
    outboxTopic: FEISHU_VERIFY_OUTBOX_TOPIC,
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

function taskListBindingRequestHash(
  mutation: WorkbenchFeishuTaskListBindingMutation | WorkbenchFeishuTaskListBindingReplayQuery,
): string {
  const organizationId = 'command' in mutation
    ? mutation.command.actor.organizationId
    : mutation.organizationId
  const teamId = 'command' in mutation ? mutation.command.actor.teamId : mutation.teamId
  const reason = 'command' in mutation ? mutation.command.reason : mutation.reason
  const causationId = 'command' in mutation
    ? mutation.command.causationId
    : mutation.causationId
  return digest(canonicalizeJson({
    commandType: FEISHU_TASK_LIST_BIND_COMMAND_TYPE,
    target: FEISHU_TASK_LIST_BIND_OBJECT_TYPE,
    scope: {
      organizationId,
      teamId,
      projectId: mutation.projectId,
    },
    intent: mutation.intent,
    expectedBindingRevision: mutation.expectedBindingRevision,
    expectedConnectionRevision: mutation.expectedConnectionRevision,
    expectedRouteGeneration: mutation.expectedRouteGeneration,
    routeKind: 'route' in mutation ? mutation.route.kind : mutation.kind,
    reason,
    causationId,
  }))
}

function taskReferenceRequestHash(mutation: WorkbenchFeishuTaskReferenceMutation): string {
  return digest(canonicalizeJson({
    commandType: FEISHU_TASK_REFERENCE_COMMAND_TYPE,
    target: FEISHU_TASK_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    taskGuid: mutation.task.taskGuid,
    expectedRevision: mutation.expectedRevision,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

function taskUpdateRequestHash(mutation: WorkbenchFeishuTaskUpdateReservationMutation): string {
  return digest(canonicalizeJson({
    commandType: FEISHU_TASK_UPDATE_COMMAND_TYPE,
    target: FEISHU_TASK_OBJECT_TYPE,
    scope: {
      organizationId: mutation.command.actor.organizationId,
      teamId: mutation.command.actor.teamId,
      projectId: mutation.projectId,
    },
    taskGuid: mutation.taskGuid,
    expectedRevision: mutation.expectedRevision,
    expectedRemoteVersion: mutation.expectedRemoteVersion,
    ...(mutation.expectedWorkflowRevision === undefined
      ? {}
      : { expectedWorkflowRevision: mutation.expectedWorkflowRevision }),
    changes: mutation.changes,
    reason: mutation.command.reason,
    causationId: mutation.command.causationId,
  }))
}

interface StoredTaskUpdateChanges {
  readonly summary?: string
  readonly description?: string
  readonly completed?: boolean
  readonly workflowStateId?: string
  readonly expectedWorkflowRevision?: number
  readonly workflow?: {
    readonly fieldGuid: string
    readonly optionGuid: string
  }
}

function planTaskUpdateChanges(
  database: DatabaseSync,
  binding: FeishuTaskBindingRow,
  task: FeishuTaskProjectionRow,
  mutation: WorkbenchFeishuTaskUpdateReservationMutation,
):
  | {
    readonly ok: true
    readonly storedChanges: StoredTaskUpdateChanges
    readonly providerPatch: WorkbenchFeishuTaskPatch
  }
  | { readonly ok: false; readonly result: UpdateFeishuTaskResult } {
  const providerPatch: {
    summary?: string
    description?: string
    completed?: boolean
    workflow?: { fieldGuid: string; optionGuid: string }
  } = {
    ...(mutation.changes.summary === undefined ? {} : { summary: mutation.changes.summary }),
    ...(mutation.changes.description === undefined
      ? {}
      : { description: mutation.changes.description }),
    ...(mutation.changes.completed === undefined ? {} : { completed: mutation.changes.completed }),
  }
  const storedChanges: {
    summary?: string
    description?: string
    completed?: boolean
    workflowStateId?: string
    expectedWorkflowRevision?: number
    workflow?: { fieldGuid: string; optionGuid: string }
  } = { ...providerPatch }
  const requestedStateId = mutation.changes.workflowStateId
  if (requestedStateId !== undefined) {
    const workflow = readTaskWorkflowProjection(database, binding, [taskProjectionFromRow(task)])
    if (workflow === null) {
      return { ok: false, result: taskWorkflowUpdateConflict('workflow-unconfigured', {
        message: 'Project has no configured task workflow',
        requestedStateId,
      }) }
    }
    if (mutation.expectedWorkflowRevision !== workflow.revision) {
      return { ok: false, result: taskWorkflowUpdateConflict('workflow-revision-conflict', {
        message: 'Project task workflow changed before the task update',
        ...(mutation.expectedWorkflowRevision === undefined
          ? {}
          : { expectedWorkflowRevision: mutation.expectedWorkflowRevision }),
        currentWorkflowRevision: workflow.revision,
        requestedStateId,
      }) }
    }
    const value = workflow.values[0]
    if (value === undefined || value.taskGuid !== task.task_guid) {
      throw new Error('Workbench workflow update lost its task value')
    }
    if (!value.recognized) {
      return { ok: false, result: taskWorkflowUpdateConflict('workflow-value-unrecognized', {
        message: 'Current Feishu task workflow value is not mapped',
        currentStateId: null,
        requestedStateId,
      }) }
    }
    const target = workflow.options.find(option => option.stateId === requestedStateId)
    if (target === undefined || target.hidden) {
      return { ok: false, result: taskWorkflowUpdateConflict('workflow-state-unmapped', {
        message: 'Requested workflow state has no visible Feishu option mapping',
        currentStateId: value.stateId,
        requestedStateId,
      }) }
    }
    const transitionAllowed = value.stateId === null
      ? requestedStateId === workflow.definition.initialStateId
      : workflowTransitionAllowed(workflow.definition, value.stateId, requestedStateId)
    if (!transitionAllowed) {
      return { ok: false, result: taskWorkflowUpdateConflict('workflow-transition-forbidden', {
        message: 'Requested workflow transition is not allowed by the Project schema',
        currentStateId: value.stateId,
        requestedStateId,
      }) }
    }
    const workflowPatch = Object.freeze({
      fieldGuid: workflow.field.fieldGuid,
      optionGuid: target.optionGuid,
    })
    providerPatch.workflow = workflowPatch
    storedChanges.workflowStateId = requestedStateId
    storedChanges.expectedWorkflowRevision = workflow.revision
    storedChanges.workflow = workflowPatch
  }
  return Object.freeze({
    ok: true,
    storedChanges: Object.freeze(storedChanges),
    providerPatch: Object.freeze(providerPatch),
  })
}

function taskWorkflowUpdateConflict(
  code: 'workflow-unconfigured' | 'workflow-revision-conflict'
    | 'workflow-transition-forbidden' | 'workflow-state-unmapped'
    | 'workflow-value-unrecognized',
  details: Readonly<{
    readonly message: string
    readonly expectedWorkflowRevision?: number
    readonly currentWorkflowRevision?: number
    readonly currentStateId?: string | null
    readonly requestedStateId?: string
  }>,
): UpdateFeishuTaskResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, ...details }) })
}

function decodeStoredTaskUpdateChanges(value: string): StoredTaskUpdateChanges {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch {
    throw new Error('Stored Feishu task effect changes contain invalid JSON')
  }
  const record = objectValue(parsed, 'Stored Feishu task effect changes')
  const keys = Object.keys(record)
  if (keys.length < 1 || keys.some(key => key !== 'summary' && key !== 'description'
    && key !== 'completed' && key !== 'workflowStateId'
    && key !== 'expectedWorkflowRevision' && key !== 'workflow')) {
    throw new Error('Stored Feishu task effect changes contain unsupported fields')
  }
  const providerPatch: WorkbenchFeishuTaskPatch = Object.freeze({
    ...(record.summary === undefined ? {} : { summary: record.summary as string }),
    ...(record.description === undefined ? {} : { description: record.description as string }),
    ...(record.completed === undefined ? {} : { completed: record.completed as boolean }),
    ...(record.workflow === undefined ? {} : {
      workflow: Object.freeze({
        fieldGuid: stringValue(
          objectValue(record.workflow, 'Stored workflow task patch').fieldGuid,
          'Stored workflow field guid',
        ),
        optionGuid: stringValue(
          objectValue(record.workflow, 'Stored workflow task patch').optionGuid,
          'Stored workflow option guid',
        ),
      }),
    }),
  })
  validateTaskPatch(providerPatch)
  if (record.workflowStateId === undefined) {
    if (record.expectedWorkflowRevision !== undefined || record.workflow !== undefined) {
      throw new Error('Stored Feishu task effect has orphan workflow delivery metadata')
    }
    return providerPatch
  }
  const workflowStateId = stringValue(record.workflowStateId, 'Stored workflow state id')
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(workflowStateId)
    || record.workflow === undefined
    || !Number.isSafeInteger(record.expectedWorkflowRevision)
    || (record.expectedWorkflowRevision as number) < 1) {
    throw new Error('Stored Feishu task effect workflow intent is invalid')
  }
  return Object.freeze({
    ...providerPatch,
    workflowStateId,
    expectedWorkflowRevision: record.expectedWorkflowRevision as number,
  })
}

function providerTaskPatchFromStored(value: string): WorkbenchFeishuTaskPatch {
  const stored = decodeStoredTaskUpdateChanges(value)
  return Object.freeze({
    ...(stored.summary === undefined ? {} : { summary: stored.summary }),
    ...(stored.description === undefined ? {} : { description: stored.description }),
    ...(stored.completed === undefined ? {} : { completed: stored.completed }),
    ...(stored.workflow === undefined ? {} : { workflow: Object.freeze({ ...stored.workflow }) }),
  })
}

function publicTaskChangesFromStored(value: string): Readonly<{
  readonly changes: import('./client.ts').UpdateFeishuTaskRequest['changes']
  readonly expectedWorkflowRevision?: number
}> {
  const stored = decodeStoredTaskUpdateChanges(value)
  return Object.freeze({
    changes: Object.freeze({
      ...(stored.summary === undefined ? {} : { summary: stored.summary }),
      ...(stored.description === undefined ? {} : { description: stored.description }),
      ...(stored.completed === undefined ? {} : { completed: stored.completed }),
      ...(stored.workflowStateId === undefined ? {} : { workflowStateId: stored.workflowStateId }),
    }),
    ...(stored.expectedWorkflowRevision === undefined
      ? {}
      : { expectedWorkflowRevision: stored.expectedWorkflowRevision }),
  })
}

function taskWorkflowRequestHash(
  mutation: WorkbenchFeishuTaskWorkflowConfigurationMutation
    | WorkbenchFeishuTaskWorkflowOperationMutation
    | WorkbenchFeishuTaskWorkflowReplayQuery,
): string {
  const organizationId = 'command' in mutation
    ? mutation.command.actor.organizationId
    : mutation.organizationId
  const teamId = 'command' in mutation ? mutation.command.actor.teamId : mutation.teamId
  const reason = 'command' in mutation ? mutation.command.reason : mutation.reason
  const causationId = 'command' in mutation
    ? mutation.command.causationId
    : mutation.causationId
  return digest(canonicalizeJson({
    commandType: FEISHU_TASK_WORKFLOW_COMMAND_TYPE,
    target: FEISHU_TASK_WORKFLOW_OBJECT_TYPE,
    scope: { organizationId, teamId, projectId: mutation.projectId },
    expectedTaskRevision: mutation.expectedTaskRevision,
    expectedWorkflowRevision: mutation.expectedWorkflowRevision,
    definition: projectTaskWorkflowDefinition(mutation.definition),
    mapping: normalizedWorkflowMapping(mutation.mapping),
    reason,
    causationId,
  }))
}

interface FeishuTaskLedgerInput {
  readonly command: WorkbenchCommandMetadata
  readonly requestHash: string
  readonly commandType:
    | typeof FEISHU_TASK_LIST_BIND_COMMAND_TYPE
    | typeof FEISHU_TASK_REFERENCE_COMMAND_TYPE
    | typeof FEISHU_TASK_UPDATE_COMMAND_TYPE
    | typeof FEISHU_TASK_WORKFLOW_COMMAND_TYPE
  readonly auditAction:
    | typeof FEISHU_TASK_LIST_BIND_AUDIT_ACTION
    | typeof FEISHU_TASK_REFERENCE_AUDIT_ACTION
    | typeof FEISHU_TASK_UPDATE_AUDIT_ACTION
    | typeof FEISHU_TASK_WORKFLOW_AUDIT_ACTION
  readonly summaryCode:
    | typeof FEISHU_TASK_LIST_BIND_SUMMARY
    | typeof FEISHU_TASK_REFERENCE_SUMMARY
    | typeof FEISHU_TASK_UPDATE_SUMMARY
    | typeof FEISHU_TASK_WORKFLOW_SUMMARY
  readonly objectType:
    | typeof FEISHU_TASK_LIST_BIND_OBJECT_TYPE
    | typeof FEISHU_TASK_OBJECT_TYPE
    | typeof FEISHU_TASK_WORKFLOW_OBJECT_TYPE
  readonly objectId: string
  readonly objectVersion: number
  readonly changedFields: readonly string[]
  readonly outboxTopic: string
  readonly result: unknown
}

function appendFeishuTaskLedger(database: DatabaseSync, input: FeishuTaskLedgerInput): void {
  const projectId = (() => {
    const parsed = objectValue(input.result, 'Feishu task committed result')
    if (input.commandType === FEISHU_TASK_UPDATE_COMMAND_TYPE) {
      const effect = objectValue(parsed.value, 'Feishu task update effect')
      const row = database.prepare(`
        SELECT project_id FROM workbench_feishu_task_effect WHERE id = ?
      `).get(stringValue(effect.effectId, 'Feishu task effect id')) as {
        readonly project_id: string
      } | undefined
      if (row === undefined) throw new Error('Workbench task effect lost its Project')
      return row.project_id
    }
    const value = objectValue(parsed.value, 'Feishu task committed projection')
    return stringValue(value.projectId, 'Feishu task committed Project id')
  })()
  const payload = canonicalizeJson({
    schemaVersion: 1,
    commandId: input.command.commandId,
    auditEventId: input.command.auditEventId,
    requestHash: input.requestHash,
    projectId,
    objectType: input.objectType,
    objectId: input.objectId,
    objectVersion: input.objectVersion,
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
    projectId,
    input.objectType,
    input.objectId,
    input.objectVersion,
    input.command.causationId,
    payload,
    input.command.occurredAt,
    input.command.occurredAt,
  )
  if (outbox.changes !== 1) throw new Error('Workbench Feishu task Outbox was not inserted')
  const head = readAuditHead(database)
  const sequence = incrementRevision(head.sequence, 'Workbench audit sequence')
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
      projectId,
    },
    reason: { code: input.command.reason },
    object: { type: input.objectType, id: input.objectId, version: String(input.objectVersion) },
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
  if (advanced.changes !== 1) throw new Error('Workbench audit head did not advance')
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
  if (receipt.changes !== 1) throw new Error('Workbench Feishu task receipt was not inserted')
}

function taskReceipt(command: WorkbenchCommandMetadata) {
  return Object.freeze({
    commandId: command.commandId,
    auditEventId: command.auditEventId,
    outboxId: command.outboxId,
  })
}

function taskReceiptFromRow(row: FeishuTaskEffectRow) {
  return Object.freeze({
    commandId: row.command_id,
    auditEventId: row.audit_event_id,
    outboxId: row.outbox_id,
  })
}

function validateTaskRouteForCommit(
  database: DatabaseSync,
  route: FeishuRouteRow | null,
  supplied: WorkbenchFeishuTaskRoute,
): Extract<BindFeishuTaskListResult, { readonly ok: false }> | null {
  if (route === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'route-unconfigured',
        message: `Feishu ${supplied.kind} route is not configured`,
        kind: supplied.kind,
      }),
    })
  }
  if (route.generation !== supplied.routeGeneration) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'route-generation-conflict',
        message: 'Feishu task route generation changed before binding',
        kind: supplied.kind,
        expectedRouteGeneration: supplied.routeGeneration,
        currentRouteGeneration: route.generation,
      }),
    })
  }
  if (route.state !== 'configured') {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'route-disabled',
        message: `Feishu ${supplied.kind} route is disabled`,
        kind: supplied.kind,
      }),
    })
  }
  if (route.app_id !== supplied.appId || route.credential_ref !== supplied.credentialRef) {
    throw new Error('Workbench Feishu task route material changed within one generation')
  }
  const binding = readFeishuIdentityBinding(
    database,
    route.organization_id,
    route.team_id,
    supplied.kind,
    route.identity_epoch,
  )
  if (binding === null) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'route-unverified',
        message: `Feishu ${supplied.kind} route has no verified identity binding`,
        kind: supplied.kind,
      }),
    })
  }
  if (binding.app_id !== supplied.actor.appId
    || binding.open_id !== supplied.actor.openId
    || binding.tenant_key !== supplied.actor.tenantKey
    || binding.route_generation !== supplied.actor.routeGeneration) {
    throw new Error('Workbench supplied Feishu actor escaped its immutable identity binding')
  }
  return null
}

function taskRouteFromBinding(database: DatabaseSync, projectId: string): WorkbenchFeishuTaskRoute {
  const binding = readTaskBindingRow(database, projectId)
  if (binding === null) throw new Error('Workbench task route lacks its task-list binding')
  const route = database.prepare(`
    SELECT organization_id, team_id, kind, generation, identity_epoch, state, app_id,
      credential_ref, command_id, created_at
    FROM workbench_feishu_route_version
    WHERE organization_id = ? AND team_id = ? AND kind = ? AND generation = ?
  `).get(
    binding.organization_id,
    binding.team_id,
    binding.route_kind,
    binding.route_generation,
  ) as FeishuRouteRow | undefined
  if (route === undefined || route.state !== 'configured' || route.app_id !== binding.app_id) {
    throw new Error('Workbench task-list binding lost its exact configured route')
  }
  const kind = binding.route_kind as FeishuIdentityKind
  validateFeishuRouteRow(route, binding.organization_id, binding.team_id, kind)
  const identity = readFeishuIdentityBinding(
    database,
    binding.organization_id,
    binding.team_id,
    kind,
    route.identity_epoch,
  )
  if (identity === null || identity.app_id !== binding.app_id
    || identity.open_id !== binding.open_id || identity.tenant_key !== binding.tenant_key) {
    throw new Error('Workbench task-list binding lost its exact verified identity')
  }
  return Object.freeze({
    kind,
    routeGeneration: route.generation,
    appId: route.app_id,
    credentialRef: route.credential_ref,
    actor: Object.freeze({
      connectionId: FEISHU_CONNECTION_ID_VALUE,
      realm: FEISHU_REALM,
      appId: identity.app_id,
      kind,
      routeGeneration: identity.route_generation,
      openId: identity.open_id,
      tenantKey: identity.tenant_key,
    }),
  })
}

function readTaskEffect(database: DatabaseSync, effectId: string): FeishuTaskEffectRow | null {
  const row = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id, task_guid,
      expected_project_revision, expected_remote_version, changes_json,
      request_hash, idempotency_key_hash, state, issue_json,
      current_remote_version, attempt_count, command_id, audit_event_id,
      outbox_id, created_at, updated_at
    FROM workbench_feishu_task_effect WHERE id = ?
  `).get(effectId) as FeishuTaskEffectRow | undefined
  if (row === undefined) return null
  validateStoredTaskEffect(row)
  return row
}

function readTaskEffectByCommand(
  database: DatabaseSync,
  commandId: string,
): FeishuTaskEffectRow | null {
  const row = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id, task_guid,
      expected_project_revision, expected_remote_version, changes_json,
      request_hash, idempotency_key_hash, state, issue_json,
      current_remote_version, attempt_count, command_id, audit_event_id,
      outbox_id, created_at, updated_at
    FROM workbench_feishu_task_effect WHERE command_id = ?
  `).get(commandId) as FeishuTaskEffectRow | undefined
  if (row === undefined) return null
  validateStoredTaskEffect(row)
  return row
}

function validateStoredTaskEffect(row: FeishuTaskEffectRow): void {
  validateBoundedReference(row.id, 'Stored Feishu task effect id')
  validateBoundedReference(row.project_id, 'Stored Feishu task effect Project id')
  validateBoundedReference(row.organization_id, 'Stored Feishu task effect organization id')
  validateBoundedReference(row.team_id, 'Stored Feishu task effect team id')
  validateBoundedReference(row.actor_id, 'Stored Feishu task effect actor id')
  validateFeishuResourceId(row.task_guid, 'Stored Feishu task effect task guid')
  positiveInteger(row.expected_project_revision, 'Stored task effect expected revision')
  validateRemoteVersion(row.expected_remote_version, 'Stored task effect remote version')
  decodeStoredTaskUpdateChanges(row.changes_json)
  if (!SHA256_HEX.test(row.request_hash) || !SHA256_HEX.test(row.idempotency_key_hash)) {
    throw new Error('Stored Feishu task effect contains an invalid digest')
  }
  taskEffectState(row.state)
  if (row.issue_json !== null) decodeFeishuIssue(row.issue_json)
  if (row.current_remote_version !== null) {
    validateRemoteVersion(row.current_remote_version, 'Stored task effect current version')
  }
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 || row.attempt_count > 1) {
    throw new Error('Stored Feishu task effect contains an invalid attempt count')
  }
  for (const [label, value] of [
    ['command id', row.command_id],
    ['audit id', row.audit_event_id],
    ['Outbox id', row.outbox_id],
  ] as const) validateBoundedReference(value, `Stored task effect ${label}`)
  canonicalInstant(row.created_at, 'Stored task effect createdAt')
  canonicalInstant(row.updated_at, 'Stored task effect updatedAt')
}

function taskEffectState(value: string):
  | 'prepared'
  | 'inflight'
  | 'delivered'
  | 'unknown'
  | 'failed'
  | 'conflict' {
  if (value !== 'prepared' && value !== 'inflight' && value !== 'delivered'
    && value !== 'unknown' && value !== 'failed' && value !== 'conflict') {
    throw new Error('Workbench database contains an invalid Feishu task effect state')
  }
  return value
}

function taskEffectProjection(row: FeishuTaskEffectRow): FeishuTaskMutationEffectProjection {
  validateStoredTaskEffect(row)
  const state = taskEffectState(row.state)
  return Object.freeze({
    effectId: row.id,
    taskGuid: row.task_guid,
    state: state === 'inflight' ? 'unknown' : state,
    expectedRemoteVersion: row.expected_remote_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function markInflightTaskEffectUnknown(
  database: DatabaseSync,
  effect: FeishuTaskEffectRow,
  recoveredAt: string,
): void {
  if (effect.state !== 'inflight' || effect.attempt_count !== 1) {
    throw new Error('Workbench can only recover a claimed task effect')
  }
  canonicalInstant(recoveredAt, 'Recovered Feishu task effect instant')
  const failure = ambiguousTaskIssue()
  const updated = database.prepare(`
    UPDATE workbench_feishu_task_effect
    SET state = 'unknown', issue_json = ?, updated_at = ?
    WHERE id = ? AND state = 'inflight' AND attempt_count = 1
  `).run(canonicalizeJson(failure), recoveredAt, effect.id)
  if (updated.changes !== 1) {
    throw new Error('Workbench ambiguous task effect recovery lost its CAS')
  }
  const outbox = database.prepare(`
    UPDATE workbench_outbox SET state = 'unknown', error_code = 'transport-ambiguous',
      claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND state = 'pending' AND attempt_count = 1
  `).run(recoveredAt, effect.outbox_id)
  if (outbox.changes !== 1) {
    throw new Error('Workbench ambiguous task effect Outbox was not recovered')
  }
  const binding = readTaskBindingRow(database, effect.project_id)
  if (binding === null) throw new Error('Workbench ambiguous task effect lost its binding')
  const nextRevision = incrementRevision(binding.revision, 'Feishu task projection')
  const advanced = database.prepare(`
    UPDATE workbench_feishu_task_binding SET revision = ?, sync_state = 'unknown',
      sync_issue_json = ?, updated_at = ? WHERE project_id = ? AND revision = ?
  `).run(
    nextRevision,
    canonicalizeJson(failure),
    recoveredAt,
    effect.project_id,
    binding.revision,
  )
  if (advanced.changes !== 1) {
    throw new Error('Workbench ambiguous task effect binding recovery lost its CAS')
  }
}

function taskUpdateResultFromEffect(
  database: DatabaseSync,
  effect: FeishuTaskEffectRow,
): UpdateFeishuTaskResult {
  const state = taskEffectState(effect.state)
  if (state === 'prepared' || state === 'inflight') return taskInflightUnknown(effect)
  if (state === 'conflict') {
    const current = effect.current_remote_version
    if (current === null) throw new Error('Workbench conflicted task effect lacks current version')
    return taskRemoteVersionConflict(effect.task_guid, effect.expected_remote_version, current)
  }
  const projection = readProjectTasksProjection(database, {
    organizationId: effect.organization_id,
    teamId: effect.team_id,
    projectId: effect.project_id,
  })
  if (projection === null) throw new Error('Workbench task effect escaped its Project')
  const projectedEffect = taskEffectProjection(effect)
  if (state === 'delivered') {
    return Object.freeze({
      ok: true,
      value: projection,
      effect: projectedEffect,
      receipt: taskReceiptFromRow(effect),
    })
  }
  const issue = effect.issue_json === null
    ? ambiguousTaskIssue()
    : decodeFeishuIssue(effect.issue_json)
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: state === 'unknown' ? 'remote-outcome-unknown' : 'remote-rejected',
      message: state === 'unknown'
        ? 'Feishu task update outcome is unknown; reconcile before another write'
        : 'Feishu rejected the task update',
      effect: projectedEffect,
      issue: cloneFeishuIssue(issue),
    }),
  })
}

function taskInflightUnknown(effect: FeishuTaskEffectRow): UpdateFeishuTaskResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-outcome-unknown',
      message: 'Feishu task update may have been delivered; reconcile before another write',
      effect: Object.freeze({
        ...taskEffectProjection(effect),
        state: 'unknown' as const,
      }),
      issue: ambiguousTaskIssue(),
    }),
  })
}

function ambiguousTaskIssue(): FeishuConnectionIssue {
  return Object.freeze({
    code: 'unknown-provider-error',
    recovery: 'inspect-provider',
    missingScopes: Object.freeze([]),
    grantPlane: null,
    retryAt: null,
  })
}

function taskIdempotencyConflict(): Extract<
  BindFeishuTaskListResult | ReferenceFeishuTaskResult | UpdateFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'idempotency-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'idempotency-conflict',
      message: 'Workbench idempotency key was already used for different task intent',
    }),
  })
}

function taskProjectNotFound(projectId: string): Extract<
  BindFeishuTaskListResult | ReconcileProjectTasksResult
    | ReferenceFeishuTaskResult | UpdateFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'project-not-found' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'project-not-found',
      message: `Workbench Project ${projectId} was not found in the authorized scope`,
      projectId,
    }),
  })
}

function taskListUnbound(): Extract<
  ReconcileProjectTasksResult | ReferenceFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'task-list-unbound' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-list-unbound',
      message: 'Project has no primary Feishu task list',
    }),
  })
}

function taskUpdateListUnbound() {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-list-unbound',
      message: 'Project has no primary Feishu task list',
    }),
  })
}

function taskProjectionRevisionConflict(
  expectedRevision: number,
  currentRevision: number,
): Extract<
  ReconcileProjectTasksResult | ReferenceFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'task-projection-revision-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-projection-revision-conflict',
      message: `Project task revision changed (expected ${expectedRevision}, current ${currentRevision})`,
      expectedRevision,
      currentRevision,
    }),
  })
}

function taskUpdateProjectionRevisionConflict(
  expectedRevision: number,
  currentRevision: number,
): Extract<
  UpdateFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'task-projection-revision-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-projection-revision-conflict',
      message: `Project task revision changed (expected ${expectedRevision}, current ${currentRevision})`,
      expectedRevision,
      currentRevision,
    }),
  })
}

function taskAlreadyInProject(taskGuid: string): Extract<
  ReferenceFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'task-already-in-project' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-already-in-project',
      message: 'Feishu task is already visible in this Project',
      taskGuid,
    }),
  })
}

function taskNotInProject(taskGuid: string) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'task-not-in-project',
      message: 'Feishu task is not visible in this Project',
      taskGuid,
    }),
  })
}

function taskRemoteVersionConflict(
  taskGuid: string,
  expectedRemoteVersion: string,
  currentRemoteVersion: string,
): Extract<
  UpdateFeishuTaskResult,
  { readonly ok: false; readonly error: { readonly code: 'remote-version-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'remote-version-conflict',
      message: 'Feishu task changed since the Workbench projection was read',
      taskGuid,
      expectedRemoteVersion,
      currentRemoteVersion,
    }),
  })
}

function taskConnectionRevisionConflict(
  expectedConnectionRevision: number,
  currentConnectionRevision: number,
): Extract<
  BindFeishuTaskListResult,
  { readonly ok: false; readonly error: { readonly code: 'connection-revision-conflict' } }
> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'connection-revision-conflict',
      message: 'Feishu connection changed before the task list was bound',
      expectedConnectionRevision,
      currentConnectionRevision,
    }),
  })
}

function decodeTaskListBindingResult(
  resultJson: string,
  receipt: ReceiptRow,
): Extract<BindFeishuTaskListResult, { readonly ok: true }> {
  const decoded = decodeStoredTaskProjectionResult(resultJson, receipt)
  return Object.freeze({ ok: true, value: decoded.value, receipt: decoded.receipt })
}

function decodeTaskReferenceResult(
  resultJson: string,
  receipt: ReceiptRow,
): Extract<ReferenceFeishuTaskResult, { readonly ok: true }> {
  const decoded = decodeStoredTaskProjectionResult(resultJson, receipt)
  return Object.freeze({ ok: true, value: decoded.value, receipt: decoded.receipt })
}

function decodeTaskWorkflowConfigurationResult(
  resultJson: string,
  receipt: ReceiptRow,
): Extract<ConfigureFeishuTaskWorkflowResult, { readonly ok: true }> {
  const decoded = decodeStoredTaskProjectionResult(resultJson, receipt)
  if (decoded.value.workflow === null) {
    throw new Error('Workbench workflow receipt lost its configured workflow')
  }
  return Object.freeze({ ok: true, value: decoded.value, receipt: decoded.receipt })
}

function decodeStoredTaskProjectionResult(
  resultJson: string,
  receipt: ReceiptRow,
): Readonly<{
  value: ProjectTasksProjection
  receipt: { readonly commandId: string; readonly auditEventId: string; readonly outboxId: string }
}> {
  let parsed: unknown
  try { parsed = JSON.parse(resultJson) } catch {
    throw new Error('Workbench Feishu task receipt contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== resultJson) {
    throw new Error('Workbench Feishu task receipt is not canonical JSON')
  }
  const row = objectValue(parsed, 'Feishu task receipt')
  if (row.ok !== true) throw new Error('Workbench Feishu task receipt is not committed')
  const storedReceipt = objectValue(row.receipt, 'Feishu task command receipt')
  const decodedReceipt = Object.freeze({
    commandId: stringValue(storedReceipt.commandId, 'Feishu task receipt command id'),
    auditEventId: stringValue(storedReceipt.auditEventId, 'Feishu task receipt audit id'),
    outboxId: stringValue(storedReceipt.outboxId, 'Feishu task receipt Outbox id'),
  })
  if (decodedReceipt.commandId !== receipt.command_id
    || decodedReceipt.auditEventId !== receipt.audit_event_id
    || decodedReceipt.outboxId !== receipt.outbox_id) {
    throw new Error('Workbench Feishu task receipt references mismatched ledger artifacts')
  }
  return Object.freeze({
    value: decodeStoredProjectTasksProjection(row.value),
    receipt: decodedReceipt,
  })
}

function decodeStoredProjectTasksProjection(value: unknown): ProjectTasksProjection {
  const row = objectValue(value, 'Stored Project tasks projection')
  const projectId = boundedReference(row.projectId, 'Stored Project tasks Project id')
  const revision = positiveInteger(row.revision, 'Stored Project tasks revision', true)
  const binding = row.binding === null ? null : decodeStoredTaskListBinding(row.binding)
  const taskValues = arrayValue(row.tasks, 'Stored Project tasks')
  if (taskValues.length > MAX_FEISHU_TASKS_PER_PROJECT) {
    throw new Error('Stored Project tasks exceed their bounded limit')
  }
  const tasks = Object.freeze(taskValues.map(decodeStoredTaskProjection))
  const syncRow = objectValue(row.sync, 'Stored Project task sync')
  const state = syncRow.state
  if (state !== 'unbound' && state !== 'healthy' && state !== 'attention' && state !== 'unknown') {
    throw new Error('Stored Project task sync state is invalid')
  }
  const issue = syncRow.issue === null
    ? null
    : decodeFeishuIssue(canonicalizeJson(syncRow.issue))
  const nullableInstant = (candidate: unknown, label: string): string | null => {
    if (candidate === null) return null
    return canonicalInstant(candidate, label)
  }
  const effectValues = arrayValue(row.effects, 'Stored Project task effects')
  if (effectValues.length > 100) throw new Error('Stored Project task effects exceed their limit')
  const effects = Object.freeze(effectValues.map(decodeStoredTaskEffectProjection))
  const workflow = row.workflow === null || row.workflow === undefined
    ? null
    : decodeStoredTaskWorkflowProjection(row.workflow)
  if ((binding === null) !== (revision === 0) || (binding === null) !== (state === 'unbound')) {
    throw new Error('Stored Project task projection has inconsistent binding state')
  }
  return projectTasksProjection({
    projectId,
    revision,
    binding,
    tasks,
    sync: Object.freeze({
      state,
      lastEventAt: nullableInstant(syncRow.lastEventAt, 'Stored task sync lastEventAt'),
      lastReconciledAt: nullableInstant(
        syncRow.lastReconciledAt,
        'Stored task sync lastReconciledAt',
      ),
      lastAttemptAt: nullableInstant(syncRow.lastAttemptAt, 'Stored task sync lastAttemptAt'),
      issue,
    }),
    effects,
    workflow,
  })
}

function decodeStoredTaskWorkflowProjection(value: unknown): ProjectTaskWorkflowProjection {
  const row = objectValue(value, 'Stored task workflow projection')
  const definition = decodeWorkflowDefinition(canonicalizeJson(row.definition))
  const field = objectValue(row.field, 'Stored task workflow field')
  if (field.type !== 'single_select') throw new Error('Stored workflow field type is invalid')
  const fieldProjection = Object.freeze({
    fieldGuid: stringValue(field.fieldGuid, 'Stored workflow field guid'),
    name: stringValue(field.name, 'Stored workflow field name'),
    type: 'single_select' as const,
    remoteVersion: stringValue(field.remoteVersion, 'Stored workflow field remote version'),
  })
  validateFeishuResourceId(fieldProjection.fieldGuid, 'Stored workflow field guid')
  validateSafeText(fieldProjection.name, 'Stored workflow field name', 50)
  validateRemoteVersion(fieldProjection.remoteVersion, 'Stored workflow field remote version')
  const baseOptions = decodeWorkflowOptions(canonicalizeJson(
    arrayValue(row.options, 'Stored workflow options').map((candidate) => {
      const option = objectValue(candidate, 'Stored workflow option')
      return {
        stateId: option.stateId,
        optionGuid: option.optionGuid,
        name: option.name,
        colorIndex: option.colorIndex,
        hidden: option.hidden,
      }
    }),
  ), definition)
  const storedOptions = arrayValue(row.options, 'Stored workflow options')
  const options = Object.freeze(baseOptions.map((option, index) => {
    const stored = objectValue(storedOptions[index], 'Stored workflow option')
    return Object.freeze({
      ...option,
      usedTaskCount: positiveInteger(
        stored.usedTaskCount,
        'Stored workflow option usage count',
        true,
      ),
    })
  }))
  const values = Object.freeze(arrayValue(row.values, 'Stored workflow values').map((candidate) => {
    const item = objectValue(candidate, 'Stored workflow value')
    return Object.freeze({
      taskGuid: stringValue(item.taskGuid, 'Stored workflow value task guid'),
      stateId: nullableString(item.stateId, 'Stored workflow value state id'),
      optionGuid: nullableString(item.optionGuid, 'Stored workflow value option guid'),
      stateName: nullableString(item.stateName, 'Stored workflow value state name'),
      recognized: booleanValue(item.recognized, 'Stored workflow value recognized flag'),
    })
  }))
  const compatibilityRow = objectValue(row.compatibility, 'Stored workflow compatibility')
  const issues = decodeWorkflowCompatibilityIssues(canonicalizeJson(compatibilityRow.issues))
  if (compatibilityRow.state !== 'compatible'
    && compatibilityRow.state !== 'attention'
    && compatibilityRow.state !== 'blocked') {
    throw new Error('Stored workflow compatibility state is invalid')
  }
  const completionSuggestions = Object.freeze(arrayValue(
    row.completionSuggestions,
    'Stored workflow completion suggestions',
  ).map((candidate) => {
    const suggestion = objectValue(candidate, 'Stored workflow completion suggestion')
    if (suggestion.reason !== 'terminal-state-awaiting-owner-confirmation') {
      throw new Error('Stored workflow completion suggestion reason is invalid')
    }
    return Object.freeze({
      taskGuid: stringValue(suggestion.taskGuid, 'Stored completion suggestion task guid'),
      stateId: stringValue(suggestion.stateId, 'Stored completion suggestion state id'),
      stateName: stringValue(suggestion.stateName, 'Stored completion suggestion state name'),
      reason: 'terminal-state-awaiting-owner-confirmation' as const,
    })
  }))
  return Object.freeze({
    revision: positiveInteger(row.revision, 'Stored workflow revision'),
    definition,
    field: fieldProjection,
    options,
    values,
    compatibility: Object.freeze({ state: compatibilityRow.state, issues }),
    completionSuggestions,
    configuredAt: canonicalInstant(row.configuredAt, 'Stored workflow configuredAt'),
    updatedAt: canonicalInstant(row.updatedAt, 'Stored workflow updatedAt'),
  })
}

function decodeStoredTaskListBinding(value: unknown): ProjectTaskListBindingProjection {
  const row = objectValue(value, 'Stored task-list binding')
  const identity = objectValue(row.identity, 'Stored task-list identity')
  const kind = identity.kind
  if (kind !== 'bot' && kind !== 'user') throw new Error('Stored task-list identity kind is invalid')
  const result: ProjectTaskListBindingProjection = Object.freeze({
    taskListGuid: stringValue(row.taskListGuid, 'Stored task-list guid'),
    name: stringValue(row.name, 'Stored task-list name'),
    canonicalUrl: stringValue(row.canonicalUrl, 'Stored task-list URL'),
    identity: Object.freeze({
      kind,
      routeGeneration: positiveInteger(
        identity.routeGeneration,
        'Stored task-list route generation',
      ),
      appId: stringValue(identity.appId, 'Stored task-list app id'),
      openId: stringValue(identity.openId, 'Stored task-list open id'),
      tenantKey: nullableString(identity.tenantKey, 'Stored task-list tenant key'),
    }),
    createdByWorkbench: booleanValue(row.createdByWorkbench, 'Stored task-list creator flag'),
    remoteVersion: stringValue(row.remoteVersion, 'Stored task-list remote version'),
    boundAt: canonicalInstant(row.boundAt, 'Stored task-list boundAt'),
  })
  validateFeishuResourceId(result.taskListGuid, 'Stored task-list guid')
  validateSafeText(result.name, 'Stored task-list name', 100)
  validateCanonicalFeishuUrl(result.canonicalUrl, 'Stored task-list URL')
  validateFeishuAppId(result.identity.appId, 'Stored task-list app id')
  validateBoundedReference(result.identity.openId, 'Stored task-list open id')
  if (result.identity.tenantKey !== null) {
    validateBoundedReference(result.identity.tenantKey, 'Stored task-list tenant key')
  }
  validateRemoteVersion(result.remoteVersion, 'Stored task-list remote version')
  return result
}

function decodeStoredTaskProjection(value: unknown): ProjectTaskProjection {
  const row = objectValue(value, 'Stored task projection')
  const scope = row.scope
  if (scope !== 'primary-list' && scope !== 'explicit-reference') {
    throw new Error('Stored task projection scope is invalid')
  }
  const snapshot: WorkbenchFeishuTaskSnapshot = {
    taskGuid: stringValue(row.taskGuid, 'Stored task guid'),
    taskId: nullableString(row.taskId, 'Stored task id'),
    parentTaskGuid: nullableString(row.parentTaskGuid, 'Stored task parent guid'),
    summary: stringValue(row.summary, 'Stored task summary'),
    description: stringValue(row.description, 'Stored task description'),
    assignees: decodeTaskMembers(canonicalizeJson(row.assignees), 'Stored task assignees'),
    followers: decodeTaskMembers(canonicalizeJson(row.followers), 'Stored task followers'),
    comments: decodeTaskComments(canonicalizeJson(row.comments)),
    completed: booleanValue(row.completed, 'Stored task completion'),
    completedAt: nullableString(row.completedAt, 'Stored task completedAt'),
    canonicalUrl: stringValue(row.canonicalUrl, 'Stored task URL'),
    remoteVersion: stringValue(row.remoteVersion, 'Stored task remote version'),
  }
  validateTaskSnapshot(snapshot, 'Stored task projection')
  return Object.freeze({
    ...snapshot,
    scope,
    projectionRevision: positiveInteger(
      row.projectionRevision,
      'Stored task projection revision',
    ),
  })
}

function decodeStoredTaskEffectProjection(value: unknown): FeishuTaskMutationEffectProjection {
  const row = objectValue(value, 'Stored task effect projection')
  const state = row.state
  if (state !== 'prepared' && state !== 'delivered' && state !== 'unknown'
    && state !== 'failed' && state !== 'conflict') {
    throw new Error('Stored task effect projection state is invalid')
  }
  const result = Object.freeze({
    effectId: boundedReference(row.effectId, 'Stored task effect id'),
    taskGuid: stringValue(row.taskGuid, 'Stored task effect task guid'),
    state,
    expectedRemoteVersion: stringValue(
      row.expectedRemoteVersion,
      'Stored task effect expected remote version',
    ),
    createdAt: canonicalInstant(row.createdAt, 'Stored task effect createdAt'),
    updatedAt: canonicalInstant(row.updatedAt, 'Stored task effect updatedAt'),
  })
  validateFeishuResourceId(result.taskGuid, 'Stored task effect task guid')
  validateRemoteVersion(result.expectedRemoteVersion, 'Stored task effect expected remote version')
  return result
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is not boolean`)
  return value
}

interface ProjectScopeRow {
  readonly id: string
  readonly organization_id: string
  readonly team_id: string
}

function validateProjectTasksReadQuery(query: WorkbenchProjectTasksReadQuery): void {
  validateBoundedReference(query.organizationId, 'Project tasks organization id')
  validateBoundedReference(query.teamId, 'Project tasks team id')
  validateBoundedReference(query.projectId, 'Project tasks Project id')
}

function validateTaskListBindingMutation(
  mutation: WorkbenchFeishuTaskListBindingMutation,
): void {
  validateBoundedReference(mutation.projectId, 'Feishu task-list Project id')
  validateTaskListBindingIntent(mutation.intent)
  if (mutation.expectedBindingRevision !== null) {
    throw new TypeError('A new Feishu task-list binding must expect no prior revision')
  }
  nonNegativeStoredRevision(
    mutation.expectedConnectionRevision,
    'Feishu task-list expected connection revision',
  )
  positiveInteger(
    mutation.expectedRouteGeneration,
    'Feishu task-list expected route generation',
  )
  validateTaskRoute(mutation.route)
  if (mutation.route.routeGeneration !== mutation.expectedRouteGeneration) {
    throw new TypeError('Feishu task-list route generation does not match the request')
  }
  validateTaskListSnapshot(mutation.snapshot)
  validateInstant(mutation.boundAt, 'Feishu task-list boundAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_TASK_LIST_BIND_REASON
    || mutation.command.occurredAt !== mutation.boundAt) {
    throw new TypeError('Feishu task-list command metadata is inconsistent')
  }
}

function validateTaskListBindingReplayQuery(
  query: WorkbenchFeishuTaskListBindingReplayQuery,
): void {
  validateBoundedReference(query.organizationId, 'Feishu task replay organization id')
  validateBoundedReference(query.teamId, 'Feishu task replay team id')
  validateBoundedReference(query.actorId, 'Feishu task replay actor id')
  validateBoundedReference(query.projectId, 'Feishu task replay Project id')
  validateTaskListBindingIntent(query.intent)
  if (query.kind !== 'bot' && query.kind !== 'user') {
    throw new TypeError('Feishu task replay route kind is unsupported')
  }
  nonNegativeStoredRevision(
    query.expectedConnectionRevision,
    'Feishu task replay expected connection revision',
  )
  positiveInteger(query.expectedRouteGeneration, 'Feishu task replay route generation')
  if (query.expectedBindingRevision !== null) {
    throw new TypeError('Feishu task replay must expect no prior binding')
  }
  validateProjectCommandKey(query.idempotencyKey, 'Feishu task replay idempotency key')
  validateProjectCommandKey(query.causationId, 'Feishu task replay causation id')
  if (query.reason !== FEISHU_TASK_LIST_BIND_REASON) {
    throw new TypeError('Feishu task replay reason is unsupported')
  }
}

function validateTaskListBindingIntent(
  intent: WorkbenchFeishuTaskListBindingMutation['intent'],
): void {
  if (intent.mode === 'existing') {
    validateFeishuResourceId(intent.taskListGuid, 'Feishu task-list intent guid')
    return
  }
  if (intent.mode !== 'create') throw new TypeError('Feishu task-list intent mode is unsupported')
  validateSafeText(intent.name, 'Feishu task-list intent name', 100)
}

function validateTaskWorkflowReplayQuery(query: WorkbenchFeishuTaskWorkflowReplayQuery): void {
  validateBoundedReference(query.organizationId, 'Workflow replay organization id')
  validateBoundedReference(query.teamId, 'Workflow replay team id')
  validateBoundedReference(query.actorId, 'Workflow replay actor id')
  validateBoundedReference(query.projectId, 'Workflow replay Project id')
  positiveInteger(query.expectedTaskRevision, 'Workflow replay task revision')
  if (query.expectedWorkflowRevision !== null) {
    positiveInteger(query.expectedWorkflowRevision, 'Workflow replay workflow revision')
  }
  projectTaskWorkflowDefinition(query.definition)
  validateWorkflowMapping(query.mapping)
  validateProjectCommandKey(query.idempotencyKey, 'Workflow replay idempotency key')
  validateProjectCommandKey(query.causationId, 'Workflow replay causation id')
  if (query.reason !== FEISHU_TASK_WORKFLOW_REASON) {
    throw new TypeError('Workflow replay reason is unsupported')
  }
}

function validateTaskWorkflowConfigurationMutation(
  mutation: WorkbenchFeishuTaskWorkflowConfigurationMutation,
): void {
  validateBoundedReference(mutation.projectId, 'Workflow Project id')
  positiveInteger(mutation.expectedTaskRevision, 'Workflow expected task revision')
  if (mutation.expectedWorkflowRevision !== null) {
    positiveInteger(mutation.expectedWorkflowRevision, 'Workflow expected revision')
  }
  const definition = projectTaskWorkflowDefinition(mutation.definition)
  validateWorkflowMapping(mutation.mapping)
  if (mutation.mapping.mode === 'existing') {
    if (mutation.operationId !== undefined) {
      throw new TypeError('Mapped workflow configuration cannot carry a provider operation')
    }
  } else {
    if (mutation.operationId === undefined) {
      throw new TypeError('Workflow provider write requires a durable operation id')
    }
    validateBoundedReference(mutation.operationId, 'Workflow provider operation id')
  }
  validateFeishuResourceId(mutation.field.fieldGuid, 'Workflow field guid')
  validateSafeText(mutation.field.name, 'Workflow field name', 50)
  validateRemoteVersion(mutation.field.remoteVersion, 'Workflow field remote version')
  if (!Array.isArray(mutation.field.options)
    || mutation.field.options.length !== definition.states.length) {
    throw new TypeError('Workflow field must map every state exactly once')
  }
  const stateIds = new Set<string>()
  const optionGuids = new Set<string>()
  for (const option of mutation.field.options) {
    if (!definition.states.some(state => state.stateId === option.stateId)
      || stateIds.has(option.stateId)) {
      throw new TypeError('Workflow field contains an invalid state mapping')
    }
    validateFeishuResourceId(option.optionGuid, 'Workflow option guid')
    if (optionGuids.has(option.optionGuid)) {
      throw new TypeError('Workflow option GUIDs must be unique')
    }
    validateSafeText(option.name, 'Workflow option name', 50)
    if (!Number.isInteger(option.colorIndex) || option.colorIndex < 0 || option.colorIndex > 54
      || typeof option.hidden !== 'boolean') {
      throw new TypeError('Workflow option metadata is invalid')
    }
    stateIds.add(option.stateId)
    optionGuids.add(option.optionGuid)
  }
  decodeWorkflowCompatibilityIssues(canonicalizeJson(mutation.compatibility.issues))
  const derivedState = mutation.compatibility.issues.some(issue => issue.severity === 'blocked')
    ? 'blocked'
    : mutation.compatibility.issues.length > 0 ? 'attention' : 'compatible'
  if (mutation.compatibility.state !== derivedState) {
    throw new TypeError('Workflow compatibility state does not match its issues')
  }
  validateInstant(mutation.configuredAt, 'Workflow configuredAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_TASK_WORKFLOW_REASON
    || mutation.command.occurredAt !== mutation.configuredAt) {
    throw new TypeError('Workflow command metadata is inconsistent')
  }
}

function validateTaskWorkflowOperationMutation(
  mutation: WorkbenchFeishuTaskWorkflowOperationMutation,
): void {
  validateBoundedReference(mutation.operationId, 'Workflow operation id')
  validateBoundedReference(mutation.projectId, 'Workflow operation Project id')
  positiveInteger(mutation.expectedTaskRevision, 'Workflow operation expected task revision')
  if (mutation.expectedWorkflowRevision !== null) {
    positiveInteger(mutation.expectedWorkflowRevision, 'Workflow operation expected revision')
  }
  projectTaskWorkflowDefinition(mutation.definition)
  validateWorkflowMapping(mutation.mapping)
  if (mutation.mapping.mode !== 'create' && mutation.mapping.mode !== 'migrate') {
    throw new TypeError('Only create or migrate workflow configuration needs a provider operation')
  }
  validateInstant(mutation.preparedAt, 'Workflow operation preparedAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_TASK_WORKFLOW_REASON
    || mutation.command.occurredAt !== mutation.preparedAt) {
    throw new TypeError('Workflow operation command metadata is inconsistent')
  }
}

function validateWorkflowMapping(
  mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping,
): void {
  if (mapping.mode === 'create' || mapping.mode === 'migrate') return
  if (mapping.mode !== 'existing') throw new TypeError('Workflow mapping mode is unsupported')
  validateFeishuResourceId(mapping.fieldGuid, 'Workflow mapped field guid')
  if (!Array.isArray(mapping.options) || mapping.options.length < 2
    || mapping.options.length > 100) {
    throw new TypeError('Workflow option mapping is invalid')
  }
  const stateIds = new Set<string>()
  const optionGuids = new Set<string>()
  for (const option of mapping.options) {
    validateSafeText(option.stateId, 'Workflow mapped state id', 64)
    validateFeishuResourceId(option.optionGuid, 'Workflow mapped option guid')
    if (stateIds.has(option.stateId) || optionGuids.has(option.optionGuid)) {
      throw new TypeError('Workflow option mapping must be one-to-one')
    }
    stateIds.add(option.stateId)
    optionGuids.add(option.optionGuid)
  }
}

function normalizedWorkflowMapping(
  mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping,
): import('./client.ts').ConfigureFeishuTaskWorkflowMapping {
  validateWorkflowMapping(mapping)
  if (mapping.mode === 'create') return Object.freeze({ mode: 'create' })
  if (mapping.mode === 'migrate') return Object.freeze({ mode: 'migrate' })
  return Object.freeze({
    mode: 'existing',
    fieldGuid: mapping.fieldGuid,
    options: Object.freeze(mapping.options.map(option => Object.freeze({
      stateId: option.stateId,
      optionGuid: option.optionGuid,
    }))),
  })
}

function validateTaskReconciliationMutation(
  mutation: WorkbenchFeishuTaskReconciliationMutation,
): void {
  validateBoundedReference(mutation.projectId, 'Feishu reconciliation Project id')
  positiveInteger(mutation.expectedRevision, 'Feishu reconciliation expected revision')
  validateTaskListSnapshot(mutation.snapshot)
  validateInstant(mutation.attemptedAt, 'Feishu reconciliation attemptedAt')
}

function validateTaskReconciliationFailureMutation(
  mutation: WorkbenchFeishuTaskReconciliationFailureMutation,
): void {
  validateBoundedReference(mutation.projectId, 'Feishu reconciliation Project id')
  positiveInteger(mutation.expectedRevision, 'Feishu reconciliation expected revision')
  validateInstant(mutation.attemptedAt, 'Feishu reconciliation attemptedAt')
  safeFeishuIssue(mutation.issue, 'Feishu reconciliation issue')
}

function validateTaskReferenceMutation(mutation: WorkbenchFeishuTaskReferenceMutation): void {
  validateBoundedReference(mutation.projectId, 'Feishu task reference Project id')
  positiveInteger(mutation.expectedRevision, 'Feishu task reference expected revision')
  validateTaskSnapshot(mutation.task, 'Feishu referenced task')
  validateInstant(mutation.referencedAt, 'Feishu task referencedAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_TASK_REFERENCE_REASON
    || mutation.command.occurredAt !== mutation.referencedAt) {
    throw new TypeError('Feishu task reference command metadata is inconsistent')
  }
}

function validateTaskEventMutation(mutation: WorkbenchFeishuTaskEventMutation): void {
  validateBoundedReference(mutation.event.eventId, 'Feishu task event id')
  validateFeishuResourceId(mutation.event.taskListGuid, 'Feishu event task-list guid')
  validateFeishuResourceId(mutation.event.taskGuid, 'Feishu event task guid')
  if (mutation.event.kind !== 'upsert' && mutation.event.kind !== 'removed') {
    throw new TypeError('Feishu task event kind is unsupported')
  }
  validateRemoteVersion(mutation.event.remoteVersion, 'Feishu task event remote version')
  validateInstant(mutation.event.occurredAt, 'Feishu task event occurredAt')
  validateInstant(mutation.receivedAt, 'Feishu task event receivedAt')
  if (mutation.event.kind === 'upsert') {
    if (mutation.task === null) throw new TypeError('Feishu upsert event requires a task')
    validateTaskSnapshot(mutation.task, 'Feishu event task')
    if (mutation.task.taskGuid !== mutation.event.taskGuid
      || mutation.task.remoteVersion !== mutation.event.remoteVersion) {
      throw new TypeError('Feishu event task identity or version does not match')
    }
  } else if (mutation.task !== null) {
    throw new TypeError('Feishu removal event cannot carry a task snapshot')
  }
}

function validateTaskUpdateReservationMutation(
  mutation: WorkbenchFeishuTaskUpdateReservationMutation,
): void {
  validateBoundedReference(mutation.effectId, 'Feishu task effect id')
  validateBoundedReference(mutation.projectId, 'Feishu task update Project id')
  validateFeishuResourceId(mutation.taskGuid, 'Feishu task update task guid')
  positiveInteger(mutation.expectedRevision, 'Feishu task update expected revision')
  validateRemoteVersion(mutation.expectedRemoteVersion, 'Feishu task expected remote version')
  validateTaskRequestedChanges(mutation.changes)
  if (mutation.changes.workflowStateId === undefined) {
    if (mutation.expectedWorkflowRevision !== undefined) {
      throw new TypeError('Feishu task update has an unused workflow revision')
    }
  } else {
    positiveInteger(mutation.expectedWorkflowRevision, 'Feishu task expected workflow revision')
  }
  validateInstant(mutation.preparedAt, 'Feishu task update preparedAt')
  validateFeishuCommand(mutation.command)
  if (mutation.command.reason !== FEISHU_TASK_UPDATE_REASON
    || mutation.command.occurredAt !== mutation.preparedAt) {
    throw new TypeError('Feishu task update command metadata is inconsistent')
  }
}

function validateTaskRequestedChanges(
  changes: WorkbenchFeishuTaskUpdateReservationMutation['changes'],
): void {
  const keys = Object.keys(changes)
  if (keys.length < 1 || keys.some(key => key !== 'summary' && key !== 'description'
    && key !== 'completed' && key !== 'workflowStateId')) {
    throw new TypeError('Feishu task update must contain supported requested fields')
  }
  const provider: WorkbenchFeishuTaskPatch = Object.freeze({
    ...(changes.summary === undefined ? {} : { summary: changes.summary }),
    ...(changes.description === undefined ? {} : { description: changes.description }),
    ...(changes.completed === undefined ? {} : { completed: changes.completed }),
  })
  if (Object.keys(provider).length > 0) validateTaskPatch(provider)
  if (changes.workflowStateId !== undefined
    && !/^[a-z][a-z0-9-]{0,63}$/u.test(changes.workflowStateId)) {
    throw new TypeError('Feishu task workflow state id is invalid')
  }
}

function validateTaskUpdateSettlement(settlement: WorkbenchFeishuTaskUpdateSettlement): void {
  validateInstant(settlement.settledAt, 'Feishu task settlement settledAt')
  if (settlement.state === 'delivered') {
    validateTaskSnapshot(settlement.task, 'Delivered Feishu task')
    return
  }
  if (settlement.state === 'conflict') {
    validateTaskSnapshot(settlement.current, 'Conflicted Feishu task')
    return
  }
  if (settlement.state !== 'unknown' && settlement.state !== 'failed') {
    throw new TypeError('Feishu task settlement state is unsupported')
  }
  safeFeishuIssue(settlement.issue, 'Feishu task settlement issue')
}

function validateTaskRoute(route: WorkbenchFeishuTaskRoute): void {
  if (route.kind !== 'bot' && route.kind !== 'user') {
    throw new TypeError('Feishu task route kind is unsupported')
  }
  positiveInteger(route.routeGeneration, 'Feishu task route generation')
  validateFeishuAppId(route.appId, 'Feishu task route app id')
  validateCredentialRef(route.credentialRef, 'Feishu task route credential ref')
  validateFeishuActor(route.actor, route.kind)
  if (route.actor.connectionId !== FEISHU_CONNECTION_ID_VALUE
    || route.actor.routeGeneration !== route.routeGeneration
    || route.actor.appId !== route.appId) {
    throw new TypeError('Feishu task route and verified actor are inconsistent')
  }
}

function validateTaskListSnapshot(snapshot: WorkbenchFeishuTaskListSnapshot): void {
  validateFeishuResourceId(snapshot.taskList.taskListGuid, 'Feishu task-list guid')
  validateSafeText(snapshot.taskList.name, 'Feishu task-list name', 100)
  validateCanonicalFeishuUrl(snapshot.taskList.canonicalUrl, 'Feishu task-list URL')
  validateRemoteVersion(snapshot.taskList.remoteVersion, 'Feishu task-list remote version')
  validateInstant(snapshot.observedAt, 'Feishu task-list observedAt')
  if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length > MAX_FEISHU_TASKS_PER_PROJECT) {
    throw new TypeError(`Feishu task-list may contain at most ${MAX_FEISHU_TASKS_PER_PROJECT} tasks`)
  }
  const guids = new Set<string>()
  for (const task of snapshot.tasks) {
    validateTaskSnapshot(task, 'Feishu task-list task')
    if (guids.has(task.taskGuid)) throw new TypeError('Feishu task-list task guids must be unique')
    guids.add(task.taskGuid)
  }
}

function validateTaskSnapshot(task: WorkbenchFeishuTaskSnapshot, label: string): void {
  validateFeishuResourceId(task.taskGuid, `${label} guid`)
  if (task.taskId !== null) validateFeishuResourceId(task.taskId, `${label} id`)
  if (task.parentTaskGuid !== null) {
    validateFeishuResourceId(task.parentTaskGuid, `${label} parent guid`)
    if (task.parentTaskGuid === task.taskGuid) throw new TypeError(`${label} cannot parent itself`)
  }
  validateSafeText(task.summary, `${label} summary`, MAX_FEISHU_TASK_TEXT_LENGTH)
  validateTaskText(task.description, `${label} description`)
  validateTaskMembers(task.assignees, `${label} assignees`)
  validateTaskMembers(task.followers, `${label} followers`)
  if (!Array.isArray(task.comments) || task.comments.length > MAX_FEISHU_TASK_COMMENTS) {
    throw new TypeError(`${label} comments must be bounded`)
  }
  const commentIds = new Set<string>()
  for (const comment of task.comments) {
    validateFeishuResourceId(comment.commentId, `${label} comment id`)
    if (commentIds.has(comment.commentId)) throw new TypeError(`${label} comment ids must be unique`)
    commentIds.add(comment.commentId)
    validateTaskText(comment.content, `${label} comment content`)
    if (comment.creator !== null) validateTaskMember(comment.creator, `${label} comment creator`)
    if (comment.replyToCommentId !== null) {
      validateFeishuResourceId(comment.replyToCommentId, `${label} reply comment id`)
    }
    validateInstant(comment.createdAt, `${label} comment createdAt`)
    validateInstant(comment.updatedAt, `${label} comment updatedAt`)
  }
  if (typeof task.completed !== 'boolean') throw new TypeError(`${label} completion is invalid`)
  if (task.completedAt !== null) validateInstant(task.completedAt, `${label} completedAt`)
  if (!task.completed && task.completedAt !== null) {
    throw new TypeError(`${label} cannot have completedAt while incomplete`)
  }
  validateCanonicalFeishuUrl(task.canonicalUrl, `${label} URL`)
  validateRemoteVersion(task.remoteVersion, `${label} remote version`)
  validateTaskCustomFieldValues(task.customFieldValues ?? Object.freeze([]), label)
}

function validateTaskCustomFieldValues(
  values: readonly WorkbenchFeishuTaskCustomFieldValue[],
  label: string,
): void {
  if (!Array.isArray(values) || values.length > MAX_CUSTOM_FIELDS_PER_TASK) {
    throw new TypeError(`${label} custom fields must be bounded`)
  }
  const fieldGuids = new Set<string>()
  for (const value of values) {
    validateFeishuResourceId(value.fieldGuid, `${label} custom-field guid`)
    validateSafeText(value.type, `${label} custom-field type`, 64)
    if (value.singleSelectOptionGuid !== null) {
      validateFeishuResourceId(value.singleSelectOptionGuid, `${label} custom-field option guid`)
      if (value.type !== 'single_select') {
        throw new TypeError(`${label} non-select custom field cannot contain a select option`)
      }
    }
    if (fieldGuids.has(value.fieldGuid)) {
      throw new TypeError(`${label} custom-field guids must be unique`)
    }
    fieldGuids.add(value.fieldGuid)
  }
}

function validateTaskMembers(
  members: readonly FeishuTaskMemberProjection[],
  label: string,
): void {
  if (!Array.isArray(members) || members.length > 100) {
    throw new TypeError(`${label} must be a bounded array`)
  }
  const ids = new Set<string>()
  for (const member of members) {
    validateTaskMember(member, label)
    if (ids.has(member.openId)) throw new TypeError(`${label} must not contain duplicate identities`)
    ids.add(member.openId)
  }
}

function validateTaskMember(member: FeishuTaskMemberProjection, label: string): void {
  validateBoundedReference(member.openId, `${label} open id`)
  if (member.name !== null) {
    validateSafeText(member.name, `${label} name`, MAX_FEISHU_TASK_MEMBER_NAME_LENGTH)
  }
}

function validateTaskPatch(patch: WorkbenchFeishuTaskPatch): void {
  const keys = Object.keys(patch)
  if (keys.length < 1 || keys.some(key =>
    key !== 'summary' && key !== 'description' && key !== 'completed' && key !== 'workflow')) {
    throw new TypeError('Feishu task update must contain supported changed fields')
  }
  if (patch.summary !== undefined) {
    validateSafeText(patch.summary, 'Feishu task update summary', MAX_FEISHU_TASK_TEXT_LENGTH)
  }
  if (patch.description !== undefined) {
    validateTaskText(patch.description, 'Feishu task update description')
  }
  if (patch.completed !== undefined && typeof patch.completed !== 'boolean') {
    throw new TypeError('Feishu task update completion must be boolean')
  }
  if (patch.workflow !== undefined) {
    const workflowKeys = Object.keys(patch.workflow)
    if (workflowKeys.length !== 2
      || workflowKeys.some(key => key !== 'fieldGuid' && key !== 'optionGuid')) {
      throw new TypeError('Feishu task workflow update contains unsupported fields')
    }
    validateFeishuResourceId(patch.workflow.fieldGuid, 'Feishu workflow field guid')
    validateFeishuResourceId(patch.workflow.optionGuid, 'Feishu workflow option guid')
  }
}

function validateTaskText(value: string, label: string): void {
  if (typeof value !== 'string' || !value.isWellFormed() || ASCII_CONTROL.test(value)
    || [...value].length > MAX_FEISHU_TASK_TEXT_LENGTH) {
    throw new TypeError(`${label} is not bounded safe text`)
  }
}

function validateRemoteVersion(value: string, label: string): void {
  validateSafeText(value, label, 64)
}

function validateCanonicalFeishuUrl(value: string, label: string): void {
  if (typeof value !== 'string' || value.length > 2_048 || value.trim() !== value
    || ASCII_CONTROL.test(value)) throw new TypeError(`${label} is invalid`)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`${label} is invalid`)
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(`${label} must be an HTTPS URL without credentials`)
  }
}

function readProjectScopeRow(
  database: DatabaseSync,
  organizationId: string,
  teamId: string,
  projectId: string,
): ProjectScopeRow | null {
  const row = database.prepare(`
    SELECT id, organization_id, team_id FROM workbench_project
    WHERE id = ? AND organization_id = ? AND team_id = ?
  `).get(projectId, organizationId, teamId) as ProjectScopeRow | undefined
  return row ?? null
}

function readProjectById(database: DatabaseSync, projectId: string): ProjectScopeRow | null {
  const row = database.prepare(`
    SELECT id, organization_id, team_id FROM workbench_project WHERE id = ?
  `).get(projectId) as ProjectScopeRow | undefined
  return row ?? null
}

function readTaskBindingRow(database: DatabaseSync, projectId: string): FeishuTaskBindingRow | null {
  const row = database.prepare(`
    SELECT project_id, organization_id, team_id, revision, tasklist_guid,
      tasklist_name, canonical_url, route_kind, route_generation, app_id,
      open_id, tenant_key, created_by_workbench, remote_version, sync_state,
      sync_issue_json, last_event_at, last_reconciled_at, last_attempt_at,
      reconcile_generation, bound_at, updated_at
    FROM workbench_feishu_task_binding WHERE project_id = ?
  `).get(projectId) as FeishuTaskBindingRow | undefined
  if (row === undefined) return null
  validateStoredTaskBinding(row)
  return row
}

function readTaskWorkflowRow(database: DatabaseSync, projectId: string): FeishuTaskWorkflowRow | null {
  const row = database.prepare(`
    SELECT project_id, organization_id, team_id, revision, field_guid, field_name,
      field_type, field_remote_version, definition_json, options_json,
      compatibility_state, compatibility_issues_json, configured_at, updated_at
    FROM workbench_feishu_task_workflow WHERE project_id = ?
  `).get(projectId) as FeishuTaskWorkflowRow | undefined
  return row ?? null
}

function readTaskWorkflowOperation(
  database: DatabaseSync,
  operationId: string,
): FeishuTaskWorkflowOperationRow | null {
  const row = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id,
      expected_task_revision, expected_workflow_revision, mapping_mode,
      definition_json, mapping_json,
      request_hash, idempotency_key_hash, state, issue_json, attempt_count,
      command_id, audit_event_id, outbox_id, created_at, updated_at
    FROM workbench_feishu_task_workflow_operation WHERE id = ?
  `).get(operationId) as FeishuTaskWorkflowOperationRow | undefined
  if (row === undefined) return null
  validateStoredTaskWorkflowOperation(row)
  return row
}

function readTaskWorkflowOperationByKey(
  database: DatabaseSync,
  organizationId: string,
  actorId: string,
  idempotencyKeyHashValue: string,
): FeishuTaskWorkflowOperationRow | null {
  const row = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id,
      expected_task_revision, expected_workflow_revision, mapping_mode,
      definition_json, mapping_json,
      request_hash, idempotency_key_hash, state, issue_json, attempt_count,
      command_id, audit_event_id, outbox_id, created_at, updated_at
    FROM workbench_feishu_task_workflow_operation
    WHERE organization_id = ? AND actor_id = ? AND idempotency_key_hash = ?
  `).get(
    organizationId,
    actorId,
    idempotencyKeyHashValue,
  ) as FeishuTaskWorkflowOperationRow | undefined
  if (row === undefined) return null
  validateStoredTaskWorkflowOperation(row)
  return row
}

function readTaskWorkflowOperationByCommand(
  database: DatabaseSync,
  commandId: string,
): FeishuTaskWorkflowOperationRow | null {
  const row = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id,
      expected_task_revision, expected_workflow_revision, mapping_mode,
      definition_json, mapping_json,
      request_hash, idempotency_key_hash, state, issue_json, attempt_count,
      command_id, audit_event_id, outbox_id, created_at, updated_at
    FROM workbench_feishu_task_workflow_operation WHERE command_id = ?
  `).get(commandId) as FeishuTaskWorkflowOperationRow | undefined
  if (row === undefined) return null
  validateStoredTaskWorkflowOperation(row)
  return row
}

function validateStoredTaskWorkflowOperation(row: FeishuTaskWorkflowOperationRow): void {
  for (const [label, value] of [
    ['id', row.id],
    ['Project id', row.project_id],
    ['organization id', row.organization_id],
    ['team id', row.team_id],
    ['actor id', row.actor_id],
    ['command id', row.command_id],
    ['audit id', row.audit_event_id],
    ['Outbox id', row.outbox_id],
  ] as const) validateBoundedReference(value, `Stored workflow operation ${label}`)
  positiveInteger(row.expected_task_revision, 'Stored workflow operation task revision')
  if (row.expected_workflow_revision !== null) {
    positiveInteger(row.expected_workflow_revision, 'Stored workflow operation workflow revision')
  }
  if (row.mapping_mode !== 'create' && row.mapping_mode !== 'migrate') {
    throw new Error('Stored workflow operation mapping mode is invalid')
  }
  const intent = decodeStoredTaskWorkflowOperationIntent(row)
  if (intent.mapping.mode !== row.mapping_mode) {
    throw new Error('Stored workflow operation mapping mode disagrees with its intent')
  }
  if (!SHA256_HEX.test(row.request_hash) || !SHA256_HEX.test(row.idempotency_key_hash)) {
    throw new Error('Stored workflow operation contains an invalid digest')
  }
  if (row.state !== 'prepared' && row.state !== 'inflight' && row.state !== 'delivered'
    && row.state !== 'unknown' && row.state !== 'failed' && row.state !== 'conflict') {
    throw new Error('Stored workflow operation state is invalid')
  }
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 || row.attempt_count > 1
    || ((row.state === 'prepared') !== (row.attempt_count === 0))) {
    throw new Error('Stored workflow operation attempt count is invalid')
  }
  if (row.issue_json !== null) decodeFeishuIssue(row.issue_json)
  if ((row.state === 'unknown' || row.state === 'failed') !== (row.issue_json !== null)) {
    throw new Error('Stored workflow operation issue does not match its state')
  }
  canonicalInstant(row.created_at, 'Stored workflow operation createdAt')
  canonicalInstant(row.updated_at, 'Stored workflow operation updatedAt')
}

function decodeStoredTaskWorkflowOperationIntent(
  row: FeishuTaskWorkflowOperationRow,
): Readonly<{
  definition: ProjectTaskWorkflowDefinition
  mapping: import('./client.ts').ConfigureFeishuTaskWorkflowMapping
}> {
  let definitionValue: unknown
  let mappingValue: unknown
  try {
    definitionValue = JSON.parse(row.definition_json)
    mappingValue = JSON.parse(row.mapping_json)
  } catch {
    throw new Error('Stored workflow operation intent is invalid JSON')
  }
  if (canonicalizeJson(definitionValue) !== row.definition_json
    || canonicalizeJson(mappingValue) !== row.mapping_json) {
    throw new Error('Stored workflow operation intent is not canonical JSON')
  }
  const definition = projectTaskWorkflowDefinition(
    definitionValue as ProjectTaskWorkflowDefinition,
  )
  const mapping = normalizedWorkflowMapping(
    mappingValue as import('./client.ts').ConfigureFeishuTaskWorkflowMapping,
  )
  if (canonicalizeJson(definition) !== row.definition_json
    || canonicalizeJson(mapping) !== row.mapping_json) {
    throw new Error('Stored workflow operation intent is not normalized')
  }
  if (mapping.mode !== 'create' && mapping.mode !== 'migrate') {
    throw new Error('Stored workflow operation does not contain an external mapping intent')
  }
  return Object.freeze({ definition, mapping })
}

function taskWorkflowOperationCommand(
  operation: FeishuTaskWorkflowOperationRow,
  request: WorkbenchFeishuTaskWorkflowOperationMutation['command'],
): WorkbenchFeishuTaskWorkflowOperationMutation['command'] {
  if (operation.organization_id !== request.actor.organizationId
    || operation.team_id !== request.actor.teamId
    || operation.actor_id !== request.actor.id) {
    throw new Error('Workbench workflow operation command escaped its reserved actor scope')
  }
  return Object.freeze({
    commandId: operation.command_id,
    auditEventId: operation.audit_event_id,
    outboxId: operation.outbox_id,
    idempotencyKey: request.idempotencyKey,
    causationId: request.causationId,
    reason: request.reason,
    actor: Object.freeze({ ...request.actor }),
    occurredAt: operation.created_at,
  })
}

function markTaskWorkflowOperationUnknown(
  database: DatabaseSync,
  operation: FeishuTaskWorkflowOperationRow,
  recoveredAt: string,
): void {
  if (operation.state !== 'inflight' || operation.attempt_count !== 1) {
    throw new Error('Workbench can only recover a claimed workflow operation')
  }
  canonicalInstant(recoveredAt, 'Recovered workflow operation instant')
  const updated = database.prepare(`
    UPDATE workbench_feishu_task_workflow_operation
    SET state = 'unknown', issue_json = ?, updated_at = ?
    WHERE id = ? AND state = 'inflight' AND attempt_count = 1
  `).run(canonicalizeJson(ambiguousTaskIssue()), recoveredAt, operation.id)
  if (updated.changes !== 1) throw new Error('Workbench workflow operation recovery lost its CAS')
  const outbox = database.prepare(`
    UPDATE workbench_outbox SET state = 'unknown', error_code = 'transport-ambiguous',
      claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND state = 'pending' AND attempt_count = 1
  `).run(recoveredAt, operation.outbox_id)
  if (outbox.changes !== 1) {
    throw new Error('Workbench workflow operation Outbox recovery lost its CAS')
  }
}

function markTaskWorkflowCommitConflictUnknown(
  database: DatabaseSync,
  operation: FeishuTaskWorkflowOperationRow,
  recoveredAt: string,
): ConfigureFeishuTaskWorkflowResult {
  markTaskWorkflowOperationUnknown(database, operation, recoveredAt)
  const recovered = readTaskWorkflowOperation(database, operation.id)
  if (recovered === null) throw new Error('Workbench workflow commit conflict recovery disappeared')
  return taskWorkflowOperationResult(recovered)
}

function taskWorkflowOperationResult(
  operation: FeishuTaskWorkflowOperationRow,
): ConfigureFeishuTaskWorkflowResult {
  validateStoredTaskWorkflowOperation(operation)
  if (operation.state === 'conflict') {
    return workflowFieldVersionChangedResult()
  }
  if (operation.state !== 'unknown' && operation.state !== 'failed') {
    throw new Error('Workbench workflow operation has no replayable terminal failure')
  }
  const issue = operation.issue_json === null
    ? ambiguousTaskIssue()
    : decodeFeishuIssue(operation.issue_json)
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: operation.state === 'unknown' ? 'remote-outcome-unknown' : 'remote-rejected',
      message: operation.state === 'unknown'
        ? 'Feishu workflow-field write outcome is unknown; inspect and map the resulting field'
        : 'Feishu rejected the workflow-field write',
      issue: cloneFeishuIssue(issue),
    }),
  })
}

function taskWorkflowOperationAcceptedResult(
  mutation: WorkbenchFeishuTaskWorkflowOperationMutation,
) {
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      operationId: mutation.operationId,
      projectId: mutation.projectId,
      state: 'prepared' as const,
      mappingMode: mutation.mapping.mode,
      expectedTaskRevision: mutation.expectedTaskRevision,
      expectedWorkflowRevision: mutation.expectedWorkflowRevision,
      createdAt: mutation.preparedAt,
    }),
    receipt: taskReceipt(mutation.command),
  })
}

function decodeTaskWorkflowOperationAcceptedResult(
  resultJson: string,
  receipt: ReceiptRow,
): Readonly<{
  operationId: string
  projectId: string
  mappingMode: 'create' | 'migrate'
  expectedTaskRevision: number
  expectedWorkflowRevision: number | null
  createdAt: string
}> {
  let parsed: unknown
  try { parsed = JSON.parse(resultJson) } catch {
    throw new Error('Workbench workflow operation receipt contains invalid JSON')
  }
  if (canonicalizeJson(parsed) !== resultJson) {
    throw new Error('Workbench workflow operation receipt is not canonical JSON')
  }
  const accepted = objectValue(parsed, 'Workbench workflow operation receipt')
  if (accepted.ok !== true) throw new Error('Workbench workflow operation receipt is not accepted')
  const storedReceipt = objectValue(
    accepted.receipt,
    'Workbench workflow operation command receipt',
  )
  if (storedReceipt.commandId !== receipt.command_id
    || storedReceipt.auditEventId !== receipt.audit_event_id
    || storedReceipt.outboxId !== receipt.outbox_id) {
    throw new Error('Workbench workflow operation receipt references mismatched ledger artifacts')
  }
  const value = objectValue(accepted.value, 'Workbench workflow accepted operation')
  if (value.state !== 'prepared'
    || (value.mappingMode !== 'create' && value.mappingMode !== 'migrate')) {
    throw new Error('Workbench workflow operation receipt has an invalid accepted state')
  }
  const expectedWorkflowRevision = value.expectedWorkflowRevision === null
    ? null
    : positiveInteger(
      value.expectedWorkflowRevision,
      'Workbench workflow operation expected workflow revision',
    )
  return Object.freeze({
    operationId: boundedReference(value.operationId, 'Workbench workflow operation receipt id'),
    projectId: boundedReference(value.projectId, 'Workbench workflow operation receipt Project id'),
    mappingMode: value.mappingMode,
    expectedTaskRevision: positiveInteger(
      value.expectedTaskRevision,
      'Workbench workflow operation expected task revision',
    ),
    expectedWorkflowRevision,
    createdAt: canonicalInstant(value.createdAt, 'Workbench workflow operation createdAt'),
  })
}

function deliveredTaskWorkflowOperationResult(
  database: DatabaseSync,
  operation: FeishuTaskWorkflowOperationRow,
  receipt: ReceiptRow,
): Extract<ConfigureFeishuTaskWorkflowResult, { readonly ok: true }> {
  validateStoredTaskWorkflowOperation(operation)
  if (operation.state !== 'delivered' || receipt.command_id !== operation.command_id
    || receipt.audit_event_id !== operation.audit_event_id
    || receipt.outbox_id !== operation.outbox_id
    || receipt.request_hash !== operation.request_hash) {
    throw new Error('Workbench delivered workflow operation disagrees with its receipt')
  }
  const version = database.prepare(`
    SELECT project_id, revision FROM workbench_feishu_task_workflow_version
    WHERE command_id = ?
  `).get(operation.command_id) as {
    readonly project_id: string
    readonly revision: number
  } | undefined
  if (version === undefined || version.project_id !== operation.project_id
    || version.revision !== (operation.expected_workflow_revision ?? 0) + 1) {
    throw new Error('Workbench delivered workflow operation lost its immutable version')
  }
  const value = readProjectTasksProjection(database, {
    organizationId: operation.organization_id,
    teamId: operation.team_id,
    projectId: operation.project_id,
  })
  if (value === null || value.workflow === null) {
    throw new Error('Workbench delivered workflow operation lost its Project projection')
  }
  return Object.freeze({
    ok: true,
    value,
    receipt: Object.freeze({
      commandId: receipt.command_id,
      auditEventId: receipt.audit_event_id,
      outboxId: receipt.outbox_id,
    }),
  })
}

function workflowFieldVersionChangedResult(): ConfigureFeishuTaskWorkflowResult {
  const message = 'Feishu workflow field changed after the migration preflight'
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'workflow-compatibility-blocked',
      message,
      compatibility: Object.freeze({
        state: 'blocked',
        issues: Object.freeze([Object.freeze({
          code: 'field-version-changed',
          severity: 'blocked',
          stateId: null,
          taskGuid: null,
          message,
        })]),
      }),
    }),
  })
}

function workflowCompatibilityBlockedResult(message: string): ConfigureFeishuTaskWorkflowResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'workflow-compatibility-blocked',
      message,
      compatibility: Object.freeze({
        state: 'blocked',
        issues: Object.freeze([Object.freeze({
          code: 'field-missing',
          severity: 'blocked',
          stateId: null,
          taskGuid: null,
          message,
        })]),
      }),
    }),
  })
}

function validateStoredTaskBinding(row: FeishuTaskBindingRow): void {
  validateBoundedReference(row.project_id, 'Stored task-list Project id')
  validateBoundedReference(row.organization_id, 'Stored task-list organization id')
  validateBoundedReference(row.team_id, 'Stored task-list team id')
  positiveInteger(row.revision, 'Stored task-list revision')
  validateFeishuResourceId(row.tasklist_guid, 'Stored task-list guid')
  validateSafeText(row.tasklist_name, 'Stored task-list name', 100)
  validateCanonicalFeishuUrl(row.canonical_url, 'Stored task-list URL')
  if (row.route_kind !== 'bot' && row.route_kind !== 'user') {
    throw new Error('Workbench database contains an invalid task-list route kind')
  }
  positiveInteger(row.route_generation, 'Stored task-list route generation')
  validateFeishuAppId(row.app_id, 'Stored task-list app id')
  validateBoundedReference(row.open_id, 'Stored task-list open id')
  if (row.tenant_key !== null) validateBoundedReference(row.tenant_key, 'Stored tenant key')
  if (row.created_by_workbench !== 0 && row.created_by_workbench !== 1) {
    throw new Error('Workbench database contains an invalid task-list creator flag')
  }
  validateRemoteVersion(row.remote_version, 'Stored task-list remote version')
  if (row.sync_state !== 'healthy' && row.sync_state !== 'attention'
    && row.sync_state !== 'unknown') {
    throw new Error('Workbench database contains an invalid task sync state')
  }
  if (row.sync_issue_json !== null) decodeFeishuIssue(row.sync_issue_json)
  if (row.sync_state === 'healthy' && row.sync_issue_json !== null) {
    throw new Error('Workbench healthy task-list binding contains an issue')
  }
  for (const [label, value] of [
    ['lastEventAt', row.last_event_at],
    ['lastReconciledAt', row.last_reconciled_at],
    ['lastAttemptAt', row.last_attempt_at],
  ] as const) if (value !== null) canonicalInstant(value, `Stored task-list ${label}`)
  positiveInteger(row.reconcile_generation, 'Stored reconciliation generation', true)
  canonicalInstant(row.bound_at, 'Stored task-list boundAt')
  canonicalInstant(row.updated_at, 'Stored task-list updatedAt')
}

function readTaskProjectionRow(
  database: DatabaseSync,
  projectId: string,
  taskGuid: string,
): FeishuTaskProjectionRow | null {
  const row = database.prepare(`
    SELECT project_id, task_guid, scope, visible, parent_task_guid, task_id,
      summary, description, assignees_json, followers_json, comments_json,
      completed, completed_at, canonical_url, remote_version,
      projection_revision, reconcile_generation, created_at, updated_at
    FROM workbench_feishu_task_projection WHERE project_id = ? AND task_guid = ?
  `).get(projectId, taskGuid) as FeishuTaskProjectionRow | undefined
  return row ?? null
}

function readProjectTasksProjection(
  database: DatabaseSync,
  query: WorkbenchProjectTasksReadQuery,
): ProjectTasksProjection | null {
  const project = readProjectScopeRow(
    database,
    query.organizationId,
    query.teamId,
    query.projectId,
  )
  if (project === null) return null
  const binding = readTaskBindingRow(database, query.projectId)
  if (binding === null) {
    return Object.freeze({
      projectId: query.projectId,
      revision: 0,
      binding: null,
      tasks: Object.freeze([]),
      sync: Object.freeze({
        state: 'unbound',
        lastEventAt: null,
        lastReconciledAt: null,
        lastAttemptAt: null,
        issue: null,
      }),
      effects: Object.freeze([]),
      workflow: null,
    })
  }
  if (binding.organization_id !== query.organizationId || binding.team_id !== query.teamId) {
    throw new Error('Workbench task-list binding escaped its authorized Project scope')
  }
  const taskRows = database.prepare(`
    SELECT project_id, task_guid, scope, visible, parent_task_guid, task_id,
      summary, description, assignees_json, followers_json, comments_json,
      completed, completed_at, canonical_url, remote_version,
      projection_revision, reconcile_generation, created_at, updated_at
    FROM workbench_feishu_task_projection
    WHERE project_id = ? AND visible = 1
    ORDER BY CASE WHEN parent_task_guid IS NULL THEN 0 ELSE 1 END,
      parent_task_guid, task_guid
    LIMIT ${MAX_FEISHU_TASKS_PER_PROJECT + 1}
  `).all(query.projectId) as unknown as FeishuTaskProjectionRow[]
  if (taskRows.length > MAX_FEISHU_TASKS_PER_PROJECT) {
    throw new Error('Workbench task projection exceeds its bounded limit')
  }
  const effects = database.prepare(`
    SELECT id, project_id, organization_id, team_id, actor_id, task_guid,
      expected_project_revision, expected_remote_version, changes_json,
      request_hash, idempotency_key_hash, state, issue_json,
      current_remote_version, attempt_count, command_id, audit_event_id,
      outbox_id, created_at, updated_at
    FROM workbench_feishu_task_effect WHERE project_id = ?
    ORDER BY created_at DESC, id LIMIT 100
  `).all(query.projectId) as unknown as FeishuTaskEffectRow[]
  const issue = binding.sync_issue_json === null ? null : decodeFeishuIssue(binding.sync_issue_json)
  const tasks = Object.freeze(taskRows.map(taskProjectionFromRow))
  const result: ProjectTasksProjection = {
    projectId: binding.project_id,
    revision: binding.revision,
    binding: Object.freeze({
      taskListGuid: binding.tasklist_guid,
      name: binding.tasklist_name,
      canonicalUrl: binding.canonical_url,
      identity: Object.freeze({
        kind: binding.route_kind as FeishuIdentityKind,
        routeGeneration: binding.route_generation,
        appId: binding.app_id,
        openId: binding.open_id,
        tenantKey: binding.tenant_key,
      }),
      createdByWorkbench: binding.created_by_workbench === 1,
      remoteVersion: binding.remote_version,
      boundAt: binding.bound_at,
    }),
    tasks,
    sync: Object.freeze({
      state: binding.sync_state as 'healthy' | 'attention' | 'unknown',
      lastEventAt: binding.last_event_at,
      lastReconciledAt: binding.last_reconciled_at,
      lastAttemptAt: binding.last_attempt_at,
      issue,
    }),
    effects: Object.freeze(effects.map(taskEffectProjection)),
    workflow: readTaskWorkflowProjection(database, binding, tasks),
  }
  return projectTasksProjection(result)
}

function readTaskWorkflowProjection(
  database: DatabaseSync,
  binding: FeishuTaskBindingRow,
  tasks: readonly ProjectTaskProjection[],
): ProjectTaskWorkflowProjection | null {
  const row = database.prepare(`
    SELECT project_id, organization_id, team_id, revision, field_guid, field_name,
      field_type, field_remote_version, definition_json, options_json,
      compatibility_state, compatibility_issues_json, configured_at, updated_at
    FROM workbench_feishu_task_workflow WHERE project_id = ?
  `).get(binding.project_id) as FeishuTaskWorkflowRow | undefined
  if (row === undefined) return null
  if (row.organization_id !== binding.organization_id || row.team_id !== binding.team_id
    || row.field_type !== 'single_select') {
    throw new Error('Workbench Feishu workflow escaped its Project or field type')
  }
  positiveInteger(row.revision, 'Feishu workflow revision')
  validateFeishuResourceId(row.field_guid, 'Feishu workflow field guid')
  validateSafeText(row.field_name, 'Feishu workflow field name', 50)
  validateRemoteVersion(row.field_remote_version, 'Feishu workflow field remote version')
  const definition = decodeWorkflowDefinition(row.definition_json)
  const storedOptions = decodeWorkflowOptions(row.options_json, definition)
  const usageRows = database.prepare(`
    SELECT value.single_select_option_guid AS option_guid, COUNT(*) AS task_count
    FROM workbench_feishu_task_custom_value AS value
    INNER JOIN workbench_feishu_task_projection AS task
      ON task.project_id = value.project_id AND task.task_guid = value.task_guid
    WHERE value.project_id = ? AND value.field_guid = ? AND task.visible = 1
      AND value.single_select_option_guid IS NOT NULL
    GROUP BY value.single_select_option_guid
  `).all(binding.project_id, row.field_guid) as unknown as Array<{
    readonly option_guid: string
    readonly task_count: number
  }>
  const usage = new Map(usageRows.map(item => [item.option_guid, item.task_count] as const))
  const options: readonly ProjectTaskWorkflowOptionProjection[] = Object.freeze(
    storedOptions.map(option => Object.freeze({
      ...option,
      usedTaskCount: usage.get(option.optionGuid) ?? 0,
    })),
  )
  const mappedByGuid = new Map(options.map(option => [option.optionGuid, option] as const))
  const customRows = database.prepare(`
    SELECT value.project_id, value.task_guid, value.field_guid, value.field_type,
      value.single_select_option_guid, value.observed_at
    FROM workbench_feishu_task_custom_value AS value
    INNER JOIN workbench_feishu_task_projection AS task
      ON task.project_id = value.project_id AND task.task_guid = value.task_guid
    WHERE value.project_id = ? AND value.field_guid = ? AND task.visible = 1
  `).all(binding.project_id, row.field_guid) as unknown as FeishuTaskCustomValueRow[]
  const customByTask = new Map(customRows.map(item => [item.task_guid, item] as const))
  const dynamicIssues: ProjectTaskWorkflowCompatibilityIssue[] = []
  const values = Object.freeze(tasks.map((task) => {
    const custom = customByTask.get(task.taskGuid)
    const optionGuid = custom?.single_select_option_guid ?? null
    const mapped = optionGuid === null ? null : mappedByGuid.get(optionGuid) ?? null
    if (optionGuid !== null && mapped === null) {
      dynamicIssues.push(Object.freeze({
        code: 'task-state-unmapped' as const,
        severity: 'blocked' as const,
        stateId: null,
        taskGuid: task.taskGuid,
        message: 'A task uses an option that is not mapped to a workflow state',
      }))
    }
    return Object.freeze({
      taskGuid: task.taskGuid,
      stateId: mapped?.stateId ?? null,
      optionGuid,
      stateName: mapped?.name ?? null,
      recognized: optionGuid === null || mapped !== null,
    })
  }))
  const storedIssues = decodeWorkflowCompatibilityIssues(row.compatibility_issues_json)
  const issues = Object.freeze([...storedIssues, ...dynamicIssues])
  const compatibilityState = issues.some(item => item.severity === 'blocked')
    ? 'blocked' as const
    : issues.length > 0 ? 'attention' as const : 'compatible' as const
  if (row.compatibility_state !== 'compatible'
    && row.compatibility_state !== 'attention'
    && row.compatibility_state !== 'blocked') {
    throw new Error('Workbench Feishu workflow compatibility state is invalid')
  }
  const terminal = new Set(definition.terminalStateIds)
  const completedByGuid = new Map(tasks.map(task => [task.taskGuid, task.completed] as const))
  const completionSuggestions = Object.freeze(values.flatMap((value) => {
    if (value.stateId === null || value.stateName === null
      || !terminal.has(value.stateId) || completedByGuid.get(value.taskGuid) === true) return []
    return [Object.freeze({
      taskGuid: value.taskGuid,
      stateId: value.stateId,
      stateName: value.stateName,
      reason: 'terminal-state-awaiting-owner-confirmation' as const,
    })]
  }))
  return Object.freeze({
    revision: row.revision,
    definition,
    field: Object.freeze({
      fieldGuid: row.field_guid,
      name: row.field_name,
      type: 'single_select' as const,
      remoteVersion: row.field_remote_version,
    }),
    options,
    values,
    compatibility: Object.freeze({ state: compatibilityState, issues }),
    completionSuggestions,
    configuredAt: canonicalInstant(row.configured_at, 'Feishu workflow configuredAt'),
    updatedAt: canonicalInstant(row.updated_at, 'Feishu workflow updatedAt'),
  })
}

function decodeWorkflowDefinition(value: string): ProjectTaskWorkflowDefinition {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Stored workflow definition is invalid JSON') }
  const row = objectValue(parsed, 'Stored workflow definition')
  const states = arrayValue(row.states, 'Stored workflow states').map((candidate) => {
    const state = objectValue(candidate, 'Stored workflow state')
    return {
      stateId: stringValue(state.stateId, 'Stored workflow state id'),
      name: stringValue(state.name, 'Stored workflow state name'),
      colorIndex: positiveInteger(state.colorIndex, 'Stored workflow color index', true),
      allowedNextStateIds: arrayValue(
        state.allowedNextStateIds,
        'Stored workflow transitions',
      ).map(target => stringValue(target, 'Stored workflow transition')),
    }
  })
  const definition = projectTaskWorkflowDefinition({
    fieldName: stringValue(row.fieldName, 'Stored workflow field name'),
    initialStateId: stringValue(row.initialStateId, 'Stored workflow initial state'),
    terminalStateIds: arrayValue(row.terminalStateIds, 'Stored workflow terminal states')
      .map(stateId => stringValue(stateId, 'Stored workflow terminal state')),
    states,
  })
  if (canonicalizeJson(definition) !== value) {
    throw new Error('Stored workflow definition is not canonical')
  }
  return definition
}

function decodeWorkflowOptions(
  value: string,
  definition: ProjectTaskWorkflowDefinition,
): readonly Omit<ProjectTaskWorkflowOptionProjection, 'usedTaskCount'>[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Stored workflow options are invalid JSON') }
  if (!Array.isArray(parsed) || parsed.length !== definition.states.length) {
    throw new Error('Stored workflow options do not map every current state')
  }
  const stateIds = new Set<string>()
  const optionGuids = new Set<string>()
  const options = parsed.map((candidate) => {
    const row = objectValue(candidate, 'Stored workflow option')
    const stateId = stringValue(row.stateId, 'Stored workflow option state id')
    const optionGuid = stringValue(row.optionGuid, 'Stored workflow option guid')
    if (!definition.states.some(state => state.stateId === stateId)
      || stateIds.has(stateId) || optionGuids.has(optionGuid)) {
      throw new Error('Stored workflow option mapping is inconsistent')
    }
    stateIds.add(stateId)
    optionGuids.add(optionGuid)
    validateFeishuResourceId(optionGuid, 'Stored workflow option guid')
    const colorIndex = positiveInteger(row.colorIndex, 'Stored workflow option color', true)
    if (colorIndex > 54) throw new Error('Stored workflow option color is invalid')
    return Object.freeze({
      stateId,
      optionGuid,
      name: stringValue(row.name, 'Stored workflow option name'),
      colorIndex,
      hidden: booleanValue(row.hidden, 'Stored workflow option hidden flag'),
    })
  })
  return Object.freeze(options)
}

function decodeWorkflowCompatibilityIssues(
  value: string,
): readonly ProjectTaskWorkflowCompatibilityIssue[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Stored workflow issues are invalid JSON') }
  if (!Array.isArray(parsed) || parsed.length > 1_000) {
    throw new Error('Stored workflow issues are not bounded')
  }
  const codes = new Set<ProjectTaskWorkflowCompatibilityIssue['code']>([
    'field-missing', 'field-type-mismatch', 'field-version-changed', 'option-missing',
    'option-hidden', 'option-name-changed', 'used-state-removal',
    'duplicate-visible-option-name', 'task-state-unmapped',
  ])
  return Object.freeze(parsed.map((candidate) => {
    const row = objectValue(candidate, 'Stored workflow issue')
    if (typeof row.code !== 'string'
      || !codes.has(row.code as ProjectTaskWorkflowCompatibilityIssue['code'])
      || (row.severity !== 'attention' && row.severity !== 'blocked')) {
      throw new Error('Stored workflow issue is invalid')
    }
    return Object.freeze({
      code: row.code as ProjectTaskWorkflowCompatibilityIssue['code'],
      severity: row.severity,
      stateId: nullableString(row.stateId, 'Stored workflow issue state id'),
      taskGuid: nullableString(row.taskGuid, 'Stored workflow issue task guid'),
      message: stringValue(row.message, 'Stored workflow issue message'),
    })
  }))
}

function taskProjectionFromRow(row: FeishuTaskProjectionRow): ProjectTaskProjection {
  if (row.scope !== 'primary-list' && row.scope !== 'explicit-reference') {
    throw new Error('Workbench database contains an invalid task scope')
  }
  if (row.visible !== 0 && row.visible !== 1) {
    throw new Error('Workbench database contains an invalid task visibility flag')
  }
  const snapshot: WorkbenchFeishuTaskSnapshot = {
    taskGuid: row.task_guid,
    taskId: row.task_id,
    parentTaskGuid: row.parent_task_guid,
    summary: row.summary,
    description: row.description,
    assignees: decodeTaskMembers(row.assignees_json, 'Stored task assignees'),
    followers: decodeTaskMembers(row.followers_json, 'Stored task followers'),
    comments: decodeTaskComments(row.comments_json),
    completed: row.completed === 1,
    completedAt: row.completed_at,
    canonicalUrl: row.canonical_url,
    remoteVersion: row.remote_version,
  }
  if (row.completed !== 0 && row.completed !== 1) {
    throw new Error('Workbench database contains invalid task completion')
  }
  validateTaskSnapshot(snapshot, 'Stored Feishu task')
  positiveInteger(row.projection_revision, 'Stored task projection revision')
  positiveInteger(row.reconcile_generation, 'Stored task reconciliation generation', true)
  canonicalInstant(row.created_at, 'Stored task createdAt')
  canonicalInstant(row.updated_at, 'Stored task updatedAt')
  return Object.freeze({ ...snapshot, scope: row.scope, projectionRevision: row.projection_revision })
}

function decodeTaskMembers(value: string, label: string): readonly FeishuTaskMemberProjection[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`${label} contains invalid JSON`) }
  if (!Array.isArray(parsed)) throw new Error(`${label} is not an array`)
  const members = parsed.map((candidate) => {
    const row = objectValue(candidate, label)
    const member = Object.freeze({
      openId: stringValue(row.openId, `${label} open id`),
      name: nullableString(row.name, `${label} name`),
    })
    validateTaskMember(member, label)
    return member
  })
  validateTaskMembers(members, label)
  return Object.freeze(members)
}

function decodeTaskComments(value: string): readonly FeishuTaskCommentProjection[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Stored task comments contain invalid JSON') }
  if (!Array.isArray(parsed)) throw new Error('Stored task comments are not an array')
  const comments = parsed.map((candidate) => {
    const row = objectValue(candidate, 'Stored task comment')
    const creatorRow = row.creator === null ? null : objectValue(row.creator, 'Stored comment creator')
    return Object.freeze({
      commentId: stringValue(row.commentId, 'Stored comment id'),
      content: stringValue(row.content, 'Stored comment content'),
      creator: creatorRow === null ? null : Object.freeze({
        openId: stringValue(creatorRow.openId, 'Stored comment creator open id'),
        name: nullableString(creatorRow.name, 'Stored comment creator name'),
      }),
      replyToCommentId: nullableString(row.replyToCommentId, 'Stored reply comment id'),
      createdAt: stringValue(row.createdAt, 'Stored comment createdAt'),
      updatedAt: stringValue(row.updatedAt, 'Stored comment updatedAt'),
    })
  })
  if (comments.length > MAX_FEISHU_TASK_COMMENTS) {
    throw new Error('Stored task comments exceed their bounded limit')
  }
  return Object.freeze(comments)
}

function upsertTaskProjection(
  database: DatabaseSync,
  projectId: string,
  task: WorkbenchFeishuTaskSnapshot,
  scope: 'primary-list' | 'explicit-reference',
  projectionRevision: number,
  reconcileGeneration: number,
  updatedAt: string,
): void {
  validateTaskSnapshot(task, 'Feishu task projection')
  const result = database.prepare(`
    INSERT INTO workbench_feishu_task_projection (
      project_id, task_guid, scope, visible, parent_task_guid, task_id,
      summary, description, assignees_json, followers_json, comments_json,
      completed, completed_at, canonical_url, remote_version,
      projection_revision, reconcile_generation, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, task_guid) DO UPDATE SET
      scope = excluded.scope, visible = 1,
      parent_task_guid = excluded.parent_task_guid, task_id = excluded.task_id,
      summary = excluded.summary, description = excluded.description,
      assignees_json = excluded.assignees_json,
      followers_json = excluded.followers_json,
      comments_json = excluded.comments_json, completed = excluded.completed,
      completed_at = excluded.completed_at, canonical_url = excluded.canonical_url,
      remote_version = excluded.remote_version,
      projection_revision = excluded.projection_revision,
      reconcile_generation = excluded.reconcile_generation,
      updated_at = excluded.updated_at
  `).run(
    projectId,
    task.taskGuid,
    scope,
    task.parentTaskGuid,
    task.taskId,
    task.summary,
    task.description,
    canonicalizeJson(task.assignees),
    canonicalizeJson(task.followers),
    canonicalizeJson(task.comments),
    task.completed ? 1 : 0,
    task.completedAt,
    task.canonicalUrl,
    task.remoteVersion,
    projectionRevision,
    reconcileGeneration,
    updatedAt,
    updatedAt,
  )
  if (result.changes !== 1) throw new Error('Workbench task projection was not upserted exactly once')
  replaceTaskCustomFieldValues(
    database,
    projectId,
    task.taskGuid,
    task.customFieldValues ?? Object.freeze([]),
    updatedAt,
  )
}

const MAX_CUSTOM_FIELDS_PER_TASK = 100

function replaceTaskCustomFieldValues(
  database: DatabaseSync,
  projectId: string,
  taskGuid: string,
  values: readonly WorkbenchFeishuTaskCustomFieldValue[],
  observedAt: string,
): void {
  const removed = database.prepare(`
    DELETE FROM workbench_feishu_task_custom_value WHERE project_id = ? AND task_guid = ?
  `).run(projectId, taskGuid)
  if (removed.changes > MAX_CUSTOM_FIELDS_PER_TASK) {
    throw new Error('Workbench task custom-field cleanup exceeded its bounded limit')
  }
  const insert = database.prepare(`
    INSERT INTO workbench_feishu_task_custom_value (
      project_id, task_guid, field_guid, field_type, single_select_option_guid, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const value of values) {
    const inserted = insert.run(
      projectId,
      taskGuid,
      value.fieldGuid,
      value.type,
      value.singleSelectOptionGuid,
      observedAt,
    )
    if (inserted.changes !== 1) throw new Error('Workbench task custom-field value was not inserted')
  }
}

function taskReferenceExists(database: DatabaseSync, projectId: string, taskGuid: string): boolean {
  return database.prepare(`
    SELECT 1 FROM workbench_feishu_task_reference WHERE project_id = ? AND task_guid = ?
  `).get(projectId, taskGuid) !== undefined
}

function insertTaskReconciliation(
  database: DatabaseSync,
  input: Readonly<{
    projectId: string
    bindingRevision: number
    generation: number
    outcome: 'healthy' | 'attention'
    issue: FeishuConnectionIssue | null
    taskCount: number
    snapshotDigest: string | null
    attemptedAt: string
  }>,
): void {
  const inserted = database.prepare(`
    INSERT INTO workbench_feishu_task_reconciliation (
      project_id, binding_revision, reconcile_generation, outcome,
      issue_json, task_count, snapshot_digest, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId,
    input.bindingRevision,
    input.generation,
    input.outcome,
    input.issue === null ? null : canonicalizeJson(input.issue),
    input.taskCount,
    input.snapshotDigest,
    input.attemptedAt,
  )
  if (inserted.changes !== 1) throw new Error('Workbench task reconciliation was not appended')
}

function taskListSnapshotDigest(snapshot: WorkbenchFeishuTaskListSnapshot): string {
  return contentDigest(canonicalizeJson(snapshot))
}

function advanceTaskBindingRevision(
  database: DatabaseSync,
  binding: FeishuTaskBindingRow,
  nextRevision: number,
  updatedAt: string,
): void {
  const advanced = database.prepare(`
    UPDATE workbench_feishu_task_binding SET revision = ?, updated_at = ?
    WHERE project_id = ? AND revision = ?
  `).run(nextRevision, updatedAt, binding.project_id, binding.revision)
  if (advanced.changes !== 1) throw new Error('Workbench task-list binding revision lost its CAS')
}

function incrementRevision(value: number, label: string): number {
  positiveInteger(value, `${label} current revision`, true)
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(`${label} revision exhausted`)
  return value + 1
}

function compareRemoteVersion(left: string, right: string): number {
  if (left === right) return 0
  if (/^(?:0|[1-9][0-9]*)$/u.test(left) && /^(?:0|[1-9][0-9]*)$/u.test(right)) {
    const leftInteger = BigInt(left)
    const rightInteger = BigInt(right)
    return leftInteger < rightInteger ? -1 : 1
  }
  if (isIsoInstant(left) && isIsoInstant(right)) return left < right ? -1 : 1
  return left < right ? -1 : 1
}

function cloneFeishuIssue(issue: FeishuConnectionIssue): FeishuConnectionIssue {
  const safe = safeFeishuIssue(issue, 'Feishu issue')
  return Object.freeze({ ...safe, missingScopes: Object.freeze([...safe.missingScopes]) })
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
