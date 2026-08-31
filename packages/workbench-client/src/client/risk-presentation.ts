/** Typed presentation keys for closed Project Risk vocabularies. */

import type {
  ProjectRiskActivityAction,
  ProjectRiskCategory,
  ProjectRiskClosureReason,
  ProjectRiskConfidence,
  ProjectRiskEvidenceRef,
  ProjectRiskExposure,
  ProjectRiskExposureLevel,
  ProjectRiskStatus,
  ProjectRiskTriggerState,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'

export function projectRiskCategoryKey(value: ProjectRiskCategory): WorkbenchKey {
  switch (value) {
    case 'schedule': return 'risks.category.schedule'
    case 'dependency': return 'risks.category.dependency'
    case 'scope': return 'risks.category.scope'
    case 'capacity': return 'risks.category.capacity'
    case 'ownership': return 'risks.category.ownership'
    case 'quality': return 'risks.category.quality'
    case 'information': return 'risks.category.information'
    case 'governance': return 'risks.category.governance'
    case 'external': return 'risks.category.external'
    case 'other': return 'risks.category.other'
  }
}

export function projectRiskStatusKey(value: ProjectRiskStatus): WorkbenchKey {
  switch (value) {
    case 'research': return 'risks.status.research'
    case 'watch': return 'risks.status.watch'
    case 'mitigate': return 'risks.status.mitigate'
    case 'accept': return 'risks.status.accept'
    case 'closed': return 'risks.status.closed'
  }
}

export function projectRiskTriggerStateKey(value: ProjectRiskTriggerState): WorkbenchKey {
  switch (value) {
    case 'unknown': return 'risks.trigger.state.unknown'
    case 'not-met': return 'risks.trigger.state.notMet'
    case 'met': return 'risks.trigger.state.met'
  }
}

export function projectRiskConfidenceKey(value: ProjectRiskConfidence): WorkbenchKey {
  switch (value) {
    case 'low': return 'risks.confidence.low'
    case 'medium': return 'risks.confidence.medium'
    case 'high': return 'risks.confidence.high'
  }
}

export function projectRiskExposureLevelKey(value: ProjectRiskExposureLevel): WorkbenchKey {
  switch (value) {
    case 'low': return 'risks.exposure.low'
    case 'medium': return 'risks.exposure.medium'
    case 'high': return 'risks.exposure.high'
  }
}

export function projectRiskClosureReasonKey(value: ProjectRiskClosureReason): WorkbenchKey {
  switch (value) {
    case 'no-longer-exists': return 'risks.closure.noLongerExists'
    case 'below-threshold': return 'risks.closure.belowThreshold'
    case 'materialized-as-issue': return 'risks.closure.materializedAsIssue'
    case 'superseded': return 'risks.closure.superseded'
  }
}

export function projectRiskLikelihoodBandKey(
  value: ProjectRiskExposure['likelihoodBand'],
): WorkbenchKey {
  switch (value) {
    case 'P1': return 'risks.exposure.likelihood.P1'
    case 'P2': return 'risks.exposure.likelihood.P2'
    case 'P3': return 'risks.exposure.likelihood.P3'
    case 'P4': return 'risks.exposure.likelihood.P4'
    case 'P5': return 'risks.exposure.likelihood.P5'
  }
}

export function projectRiskImpactBandKey(
  value: ProjectRiskExposure['impactBand'],
): WorkbenchKey {
  switch (value) {
    case 'I1': return 'risks.exposure.impact.I1'
    case 'I2': return 'risks.exposure.impact.I2'
    case 'I3': return 'risks.exposure.impact.I3'
    case 'I4': return 'risks.exposure.impact.I4'
    case 'I5': return 'risks.exposure.impact.I5'
  }
}

export function projectRiskActivityActionKey(value: ProjectRiskActivityAction): WorkbenchKey {
  switch (value) {
    case 'risk-created': return 'risks.activity.created'
    case 'risk-revised': return 'risks.activity.revised'
    case 'risk-transitioned': return 'risks.activity.transitioned'
  }
}

export function projectRiskEvidenceKindKey(value: ProjectRiskEvidenceRef['kind']): WorkbenchKey {
  switch (value) {
    case 'workbench-audit-event': return 'risks.evidence.auditEvent'
    case 'project-schedule-change': return 'risks.evidence.scheduleChange'
  }
}
