/** Browser entry for the Project Workbench status surface. */

import workbenchRemote from '@benz-ai-x/dsh-project-workbench/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountWorkbenchClient } from './mount.ts'

export { WorkbenchStatusController } from './controller.ts'
export type {
  WorkbenchClientState,
  WorkbenchConflictIssue,
  WorkbenchInputIssue,
  WorkbenchIssue,
  WorkbenchPhase,
  WorkbenchRemote,
  WorkbenchStatusControllerOptions,
  WorkbenchTransportIssue,
} from './controller.ts'
export {
  INITIAL_WORKBENCH_ACTIVITY_STATE,
  WorkbenchActivityController,
} from './activity-controller.ts'
export {
  INITIAL_WORKBENCH_PROJECT_STATE,
  MAX_PROJECT_METRIC_NAME_LENGTH,
  MAX_PROJECT_OUTCOME_COUNT,
  MAX_PROJECT_SUPPORTING_GOAL_COUNT,
  MAX_PROJECT_TEXT_LENGTH,
  MAX_PROJECT_UNIT_LENGTH,
  WorkbenchProjectController,
} from './project-controller.ts'
export {
  INITIAL_WORKBENCH_PROJECT_TEAM_STATE,
  MAX_EXTERNAL_CONTACT_LENGTH,
  MAX_FEISHU_APP_ID_LENGTH,
  MAX_FEISHU_OPEN_ID_LENGTH,
  MAX_PROJECT_MEMBER_NAME_LENGTH,
  MAX_PROJECT_TEAM_CONTRIBUTORS,
  MAX_PROJECT_TEAM_MEMBERS,
  requiresHumanSponsor,
  WorkbenchProjectTeamController,
} from './project-team-controller.ts'
export {
  INITIAL_WORKBENCH_REVIEW_STATE,
  MAX_REVIEW_CONTRIBUTORS,
  MAX_REVIEW_EVIDENCE,
  MAX_REVIEW_FEEDBACK_LENGTH,
  WorkbenchReviewController,
} from './review-controller.ts'
export {
  INITIAL_WORKBENCH_FEISHU_CONNECTION_STATE,
  MAX_FEISHU_CREDENTIAL_REF_LENGTH,
  MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH,
  validTaskListResourceId,
  WorkbenchFeishuConnectionController,
} from './feishu-connection-controller.ts'
export type {
  WorkbenchFeishuConnectionClientIssue,
  WorkbenchFeishuConnectionClientIssueCode,
  WorkbenchFeishuConnectionClientState,
  WorkbenchFeishuConnectionConflictCode,
  WorkbenchFeishuConnectionControllerOptions,
  WorkbenchFeishuConnectionInputIssue,
  WorkbenchFeishuConnectionOperation,
  WorkbenchFeishuConnectionPhase,
  WorkbenchFeishuConnectionRemote,
  WorkbenchFeishuConnectionTransportCode,
  WorkbenchFeishuConnectionTransportIssue,
  WorkbenchFeishuIdentityDraft,
} from './feishu-connection-controller.ts'
export {
  INITIAL_WORKBENCH_PROJECT_TASKS_STATE,
  MAX_FEISHU_TASK_LIST_NAME_LENGTH,
  MAX_FEISHU_TASK_RESOURCE_ID_LENGTH,
  MAX_FEISHU_TASK_TEXT_LENGTH,
  MAX_FEISHU_WORKFLOW_COLOR_INDEX,
  MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH,
  MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH,
  MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH,
  MAX_PROJECT_TASK_WORKFLOW_STATES,
  MIN_FEISHU_WORKFLOW_COLOR_INDEX,
  allowedProjectTaskWorkflowTransitions,
  WorkbenchProjectTasksController,
} from './task-controller.ts'
export type {
  WorkbenchProjectTasksClientState,
  WorkbenchProjectTasksConflictCode,
  WorkbenchProjectTasksConflictIssue,
  WorkbenchProjectTasksControllerOptions,
  WorkbenchProjectTasksInputIssue,
  WorkbenchProjectTasksIssue,
  WorkbenchProjectTasksOperation,
  WorkbenchProjectTasksPhase,
  WorkbenchProjectTasksRemote,
  WorkbenchProjectTasksSelection,
  WorkbenchProjectTaskWorkflowTransition,
  WorkbenchProjectTasksTransportCode,
  WorkbenchProjectTasksTransportIssue,
} from './task-controller.ts'
export {
  INITIAL_WORKBENCH_PROJECT_MILESTONES_STATE,
  MAX_PROJECT_CALENDAR_DESCRIPTION_LENGTH,
  MAX_PROJECT_CALENDAR_SUMMARY_LENGTH,
  MAX_PROJECT_MILESTONE_DESCRIPTION_LENGTH,
  MAX_PROJECT_MILESTONE_NAME_LENGTH,
  validProjectCalendarSchedule,
  WorkbenchProjectMilestonesController,
} from './milestone-controller.ts'
export type {
  WorkbenchProjectMilestonesClientState,
  WorkbenchProjectMilestonesConflictCode,
  WorkbenchProjectMilestonesConflictIssue,
  WorkbenchProjectMilestonesControllerOptions,
  WorkbenchProjectMilestonesInputIssue,
  WorkbenchProjectMilestonesIssue,
  WorkbenchProjectMilestonesOperation,
  WorkbenchProjectMilestonesPhase,
  WorkbenchProjectMilestonesRemote,
  WorkbenchProjectMilestonesSelection,
  WorkbenchProjectMilestonesTransportCode,
  WorkbenchProjectMilestonesTransportIssue,
} from './milestone-controller.ts'
export {
  INITIAL_WORKBENCH_PROJECT_DELIVERABLES_STATE,
  MAX_DELIVERABLE_CANDIDATE_VERSIONS,
  MAX_DELIVERABLE_CONTRIBUTORS,
  MAX_DELIVERABLE_CRITERIA,
  MAX_DELIVERABLE_CRITERION_LENGTH,
  MAX_DELIVERABLE_DESCRIPTION_LENGTH,
  MAX_DELIVERABLE_NAME_LENGTH,
  MAX_DELIVERABLE_TASKS,
  WorkbenchProjectDeliverablesController,
} from './project-deliverables-controller.ts'
export type {
  WorkbenchDeclaredArtifactVersionDraft,
  WorkbenchProjectDeliverableCreateDraft,
  WorkbenchProjectDeliverablesClientState,
  WorkbenchProjectDeliverablesConflictCode,
  WorkbenchProjectDeliverablesControllerOptions,
  WorkbenchProjectDeliverablesIssue,
  WorkbenchProjectDeliverablesOperation,
  WorkbenchProjectDeliverablesPhase,
  WorkbenchProjectDeliverablesRemote,
  WorkbenchProjectDeliverablesSelection,
  WorkbenchProjectDeliverablesTransportCode,
} from './project-deliverables-controller.ts'
export type {
  WorkbenchReviewClientState,
  WorkbenchAcceptanceDecisionDraft,
  WorkbenchAcceptanceReviewFilters,
  WorkbenchReviewConflictCode,
  WorkbenchReviewConflictIssue,
  WorkbenchReviewControllerOptions,
  WorkbenchReviewDecisionDraft,
  WorkbenchReviewFilters,
  WorkbenchReviewInputIssue,
  WorkbenchReviewIssue,
  WorkbenchReviewKind,
  WorkbenchReviewOperation,
  WorkbenchReviewPhase,
  WorkbenchReviewProposalDraft,
  WorkbenchReviewRemote,
  WorkbenchReviewSelection,
  WorkbenchReviewTransportCode,
  WorkbenchReviewTransportIssue,
} from './review-controller.ts'
export type {
  WorkbenchExternalContactMethod,
  WorkbenchHumanIdentityDraft,
  WorkbenchProjectMemberDraft,
  WorkbenchProjectResponsibilityDraft,
  WorkbenchProjectSelection,
  WorkbenchProjectTeamClientState,
  WorkbenchProjectTeamConflictCode,
  WorkbenchProjectTeamConflictIssue,
  WorkbenchProjectTeamControllerOptions,
  WorkbenchProjectTeamInputIssue,
  WorkbenchProjectTeamIssue,
  WorkbenchProjectTeamOperation,
  WorkbenchProjectTeamPhase,
  WorkbenchProjectTeamRemote,
  WorkbenchProjectTeamTransportCode,
  WorkbenchProjectTeamTransportIssue,
} from './project-team-controller.ts'
export type {
  WorkbenchOutcomeDraft,
  WorkbenchProjectClientState,
  WorkbenchProjectConflictCode,
  WorkbenchProjectConflictIssue,
  WorkbenchProjectControllerOptions,
  WorkbenchProjectDraft,
  WorkbenchProjectInputIssue,
  WorkbenchProjectIssue,
  WorkbenchProjectPhase,
  WorkbenchProjectRemote,
  WorkbenchProjectTransportCode,
  WorkbenchProjectTransportIssue,
  WorkbenchSupportingGoalDraft,
} from './project-controller.ts'
export type {
  WorkbenchActivityClientState,
  WorkbenchActivityControllerFace,
  WorkbenchActivityControllerOptions,
  WorkbenchActivityPhase,
  WorkbenchActivityRemote,
  WorkbenchActivityTransportIssue,
} from './activity-controller.ts'
export { OWNER_AUTH_ENDPOINTS, OwnerAuthHttpAdapter } from './auth-http.ts'
export type { OwnerAuthFetch, OwnerAuthHttp } from './auth-http.ts'
export { OwnerController } from './owner-controller.ts'
export type {
  OwnerControllerOptions,
  OwnerClientState,
  OwnerIssue,
  OwnerIssueCode,
  OwnerOperation,
  OwnerPhase,
} from './owner-controller.ts'
export { OwnerPage } from './OwnerPage.tsx'
export type { OwnerPageProps } from './OwnerPage.tsx'
export { ActivityPanel, DEFAULT_ACTIVITY_PANEL_COPY } from './ActivityPanel.tsx'
export type { ActivityPanelCopy, ActivityPanelProps } from './ActivityPanel.tsx'
export { ProjectsPanel } from './ProjectsPanel.tsx'
export type { ProjectsPanelProps } from './ProjectsPanel.tsx'
export { ProjectTeamPanel } from './ProjectTeamPanel.tsx'
export type { ProjectTeamPanelProps } from './ProjectTeamPanel.tsx'
export { ReviewCenterPanel } from './ReviewCenterPanel.tsx'
export type { ReviewCenterPanelProps } from './ReviewCenterPanel.tsx'
export { FeishuConnectionPanel } from './FeishuConnectionPanel.tsx'
export type {
  FeishuConnectionPanelCopy,
  FeishuConnectionPanelProps,
} from './FeishuConnectionPanel.tsx'
export { ProjectTasksPanel } from './ProjectTasksPanel.tsx'
export type { ProjectTasksPanelProps } from './ProjectTasksPanel.tsx'
export { ProjectMilestonesPanel } from './ProjectMilestonesPanel.tsx'
export type { ProjectMilestonesPanelProps } from './ProjectMilestonesPanel.tsx'
export { ProjectTaskWorkflowPanel } from './ProjectTaskWorkflowPanel.tsx'
export type { ProjectTaskWorkflowPanelProps } from './ProjectTaskWorkflowPanel.tsx'
export { WorkbenchStatusPage } from './WorkbenchStatusPage.tsx'
export type { WorkbenchStatusPageProps } from './WorkbenchStatusPage.tsx'
export { mountWorkbenchClient, registerWorkbenchUi, uiInject, WORKBENCH_SLOT_PRIORITY } from './mount.ts'
export { en, NS, zh } from './locales.ts'
export type { WorkbenchKey } from './locales.ts'

/** Initial browser dependency: the shared Remote BFF used to mount descriptors. */
export const inject = ['remote']

/** Mount generated Host reflection before any Workbench UI reads it. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountWorkbenchClient(ctx, workbenchRemote)
}
