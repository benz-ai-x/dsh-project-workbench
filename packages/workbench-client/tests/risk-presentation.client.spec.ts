import { describe, expect, it } from 'vitest'
import {
  projectRiskCategoryKey,
  projectRiskClosureReasonKey,
  projectRiskConfidenceKey,
  projectRiskExposureLevelKey,
  projectRiskImpactBandKey,
  projectRiskLikelihoodBandKey,
  projectRiskStatusKey,
  projectRiskTriggerStateKey,
} from '../src/client/risk-presentation.ts'

describe('Risk presentation vocabulary', () => {
  it('maps every closed assessment vocabulary to one typed locale key', () => {
    expect([
      'schedule', 'dependency', 'scope', 'capacity', 'ownership',
      'quality', 'information', 'governance', 'external', 'other',
    ].map(projectRiskCategoryKey)).toEqual([
      'risks.category.schedule',
      'risks.category.dependency',
      'risks.category.scope',
      'risks.category.capacity',
      'risks.category.ownership',
      'risks.category.quality',
      'risks.category.information',
      'risks.category.governance',
      'risks.category.external',
      'risks.category.other',
    ])
    expect(['research', 'watch', 'mitigate', 'accept', 'closed'].map(
      projectRiskStatusKey,
    )).toEqual([
      'risks.status.research',
      'risks.status.watch',
      'risks.status.mitigate',
      'risks.status.accept',
      'risks.status.closed',
    ])
    expect(['unknown', 'not-met', 'met'].map(projectRiskTriggerStateKey)).toEqual([
      'risks.trigger.state.unknown',
      'risks.trigger.state.notMet',
      'risks.trigger.state.met',
    ])
    expect(['low', 'medium', 'high'].map(projectRiskConfidenceKey)).toEqual([
      'risks.confidence.low',
      'risks.confidence.medium',
      'risks.confidence.high',
    ])
    expect(['low', 'medium', 'high'].map(projectRiskExposureLevelKey)).toEqual([
      'risks.exposure.low',
      'risks.exposure.medium',
      'risks.exposure.high',
    ])
  })

  it('keeps all terminal closure reasons explicit instead of collapsing them into closed', () => {
    expect([
      'no-longer-exists', 'below-threshold', 'materialized-as-issue', 'superseded',
    ].map(projectRiskClosureReasonKey)).toEqual([
      'risks.closure.noLongerExists',
      'risks.closure.belowThreshold',
      'risks.closure.materializedAsIssue',
      'risks.closure.superseded',
    ])
  })

  it('names both matrix axes so exposure can never be communicated by color alone', () => {
    expect(['P1', 'P2', 'P3', 'P4', 'P5'].map(projectRiskLikelihoodBandKey)).toEqual([
      'risks.exposure.likelihood.P1',
      'risks.exposure.likelihood.P2',
      'risks.exposure.likelihood.P3',
      'risks.exposure.likelihood.P4',
      'risks.exposure.likelihood.P5',
    ])
    expect(['I1', 'I2', 'I3', 'I4', 'I5'].map(projectRiskImpactBandKey)).toEqual([
      'risks.exposure.impact.I1',
      'risks.exposure.impact.I2',
      'risks.exposure.impact.I3',
      'risks.exposure.impact.I4',
      'risks.exposure.impact.I5',
    ])
  })
})
