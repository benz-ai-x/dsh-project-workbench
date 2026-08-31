/** Typed presentation keys for closed Deliverable domain vocabularies. */

import type {
  DeliverableAcceptanceEffectiveStatus,
  DeliverableArtifactVersionRef,
  DeliverableCalendarProjection,
  DeliverableCriterionOutcome,
  ProjectDeliverableProjection,
  ProjectDeliverablesProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'

export function deliverableStateKey(
  value: ProjectDeliverableProjection['state'],
): WorkbenchKey {
  switch (value) {
    case 'planned': return 'deliverables.state.planned'
    case 'in-review': return 'deliverables.state.inReview'
    case 'accepted': return 'deliverables.state.accepted'
  }
}

export function acceptanceStatusKey(value: DeliverableAcceptanceEffectiveStatus): WorkbenchKey {
  switch (value) {
    case 'pending': return 'deliverables.acceptance.status.pending'
    case 'approved': return 'deliverables.acceptance.status.approved'
    case 'rejected': return 'deliverables.acceptance.status.rejected'
    case 'needs_changes': return 'deliverables.acceptance.status.needsChanges'
    case 'stale': return 'deliverables.acceptance.status.stale'
  }
}

export function calendarRemoteStatusKey(
  value: DeliverableCalendarProjection['remoteStatus'],
): WorkbenchKey {
  switch (value) {
    case 'confirmed': return 'deliverables.calendar.remote.confirmed'
    case 'cancelled': return 'deliverables.calendar.remote.cancelled'
    case 'unknown': return 'deliverables.calendar.remote.unknown'
  }
}

export function calendarSyncStateKey(
  value: DeliverableCalendarProjection['syncState'],
): WorkbenchKey {
  switch (value) {
    case 'healthy': return 'deliverables.calendar.sync.healthy'
    case 'attention': return 'deliverables.calendar.sync.attention'
    case 'unknown': return 'deliverables.calendar.sync.unknown'
  }
}

export function taskAvailabilityKey(
  value: ProjectDeliverableProjection['tasks'][number]['availability'],
): WorkbenchKey {
  switch (value) {
    case 'available': return 'deliverables.tasks.available'
    case 'unavailable': return 'deliverables.tasks.unavailable'
  }
}

export function criterionOutcomeKey(value: DeliverableCriterionOutcome): WorkbenchKey {
  switch (value) {
    case 'met': return 'review.acceptance.decision.met'
    case 'not-met': return 'review.acceptance.decision.notMet'
  }
}

export function artifactSourceKey(value: DeliverableArtifactVersionRef['source']): WorkbenchKey {
  switch (value) {
    case 'managed': return 'deliverables.artifact.source.managed'
    case 'local': return 'deliverables.artifact.source.local'
    case 'feishu': return 'deliverables.artifact.source.feishu'
  }
}

export function deliverableActivityActionKey(
  value: ProjectDeliverablesProjection['activity'][number]['action'],
): WorkbenchKey {
  switch (value) {
    case 'deliverable-created': return 'deliverables.activity.action.created'
    case 'acceptance-requested': return 'deliverables.activity.action.requested'
    case 'acceptance-approved': return 'deliverables.activity.action.approved'
    case 'acceptance-rejected': return 'deliverables.activity.action.rejected'
    case 'acceptance-needs-changes': return 'deliverables.activity.action.needsChanges'
    case 'calendar-observed': return 'deliverables.activity.action.calendarObserved'
  }
}

export function deliverableActivitySourceKey(
  value: ProjectDeliverablesProjection['activity'][number]['source']['kind'],
): WorkbenchKey {
  switch (value) {
    case 'audit-event': return 'deliverables.activity.source.auditEvent'
    case 'schedule-change': return 'deliverables.activity.source.scheduleChange'
  }
}
