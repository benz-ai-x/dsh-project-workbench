import { describe, expect, it } from 'vitest'
import {
  assertProjectRiskDependencyGraph,
  normalizeProjectRiskAssessment,
  normalizeProjectRiskTransition,
  projectRiskExposure,
  type ProjectRiskAssessmentDraft,
} from '../src/index.ts'

const assessmentDraft = (): ProjectRiskAssessmentDraft => ({
  statement: {
    condition: '  Vendor approval remains pending  ',
    event: '  the migration window may be missed  ',
    consequence: '  the primary launch commitment may move  ',
  },
  category: 'schedule',
  trigger: { statement: '  approval is not received by Friday  ', state: 'met' },
  probability: { lowerBasisPoints: 1_000, upperBasisPoints: 5_001 },
  impact: { lowerBand: 2, upperBand: 4 },
  confidence: 'medium',
  confidenceRationale: '  Two approvals remain unresolved.  ',
  assessmentHorizonEnd: '2026-10-31',
  nextReviewOn: '2026-09-15',
  assumptions: ['  No emergency approval path  ', 'Current launch scope remains fixed'],
  accountableMemberId: 'member-owner',
  contributorMemberIds: ['member-z', 'member-a'],
  humanSponsorMemberId: null,
  evidence: [
    { kind: 'project-schedule-change', scheduleChangeId: 'schedule-2' },
    { kind: 'workbench-audit-event', auditEventId: 'audit-1' },
  ],
  dependencies: [
    { kind: 'depends-on', riskId: 'risk-z' },
    { kind: 'depends-on', riskId: 'risk-a' },
  ],
  mitigationTaskGuids: ['task-z', 'task-a'],
  contingencyTaskGuids: ['task-y', 'task-b'],
})

describe('project Risk policy', () => {
  it('derives every project-risk-exposure-v1 cell from the interval upper endpoints', () => {
    const probabilityUpperBounds = [500, 2_000, 5_000, 8_000, 10_000] as const
    const expected = [
      ['low', 'low', 'low', 'medium', 'high'],
      ['low', 'low', 'medium', 'medium', 'high'],
      ['low', 'medium', 'medium', 'high', 'high'],
      ['medium', 'medium', 'high', 'high', 'high'],
      ['medium', 'high', 'high', 'high', 'high'],
    ] as const

    for (const [probabilityIndex, upperBasisPoints] of probabilityUpperBounds.entries()) {
      for (const [impactIndex, level] of expected[probabilityIndex].entries()) {
        expect(projectRiskExposure(
          { lowerBasisPoints: 1, upperBasisPoints },
          { lowerBand: 1, upperBand: (impactIndex + 1) as 1 | 2 | 3 | 4 | 5 },
        )).toEqual({
          policyVersion: 'project-risk-exposure-v1',
          likelihoodBand: `P${String(probabilityIndex + 1)}`,
          impactBand: `I${String(impactIndex + 1)}`,
          level,
        })
      }
    }
  })

  it.each([
    [1, 'P1'],
    [500, 'P1'],
    [501, 'P2'],
    [2_000, 'P2'],
    [2_001, 'P3'],
    [5_000, 'P3'],
    [5_001, 'P4'],
    [8_000, 'P4'],
    [8_001, 'P5'],
    [10_000, 'P5'],
  ] as const)('classifies %i basis points as %s', (upperBasisPoints, likelihoodBand) => {
    expect(projectRiskExposure(
      { lowerBasisPoints: 1, upperBasisPoints },
      { lowerBand: 1, upperBand: 1 },
    ).likelihoodBand).toBe(likelihoodBand)
  })

  it.each([
    [{ lowerBasisPoints: 0, upperBasisPoints: 0 }, { lowerBand: 1, upperBand: 1 }, 'probability'],
    [{ lowerBasisPoints: -1, upperBasisPoints: 500 }, { lowerBand: 1, upperBand: 1 }, 'probability'],
    [{ lowerBasisPoints: 501, upperBasisPoints: 500 }, { lowerBand: 1, upperBand: 1 }, 'probability'],
    [{ lowerBasisPoints: 1, upperBasisPoints: 10_001 }, { lowerBand: 1, upperBand: 1 }, 'probability'],
    [{ lowerBasisPoints: 1.5, upperBasisPoints: 500 }, { lowerBand: 1, upperBand: 1 }, 'probability'],
    [{ lowerBasisPoints: 1, upperBasisPoints: 500 }, { lowerBand: 0, upperBand: 1 }, 'impact'],
    [{ lowerBasisPoints: 1, upperBasisPoints: 500 }, { lowerBand: 3, upperBand: 2 }, 'impact'],
    [{ lowerBasisPoints: 1, upperBasisPoints: 500 }, { lowerBand: 1, upperBand: 6 }, 'impact'],
    [{ lowerBasisPoints: 1, upperBasisPoints: 500 }, { lowerBand: 1, upperBand: 1.5 }, 'impact'],
  ] as const)('rejects invalid interval %#', (probability, impact, field) => {
    expect(() => projectRiskExposure(probability, impact)).toThrow(field)
  })

  it('is monotonic as either upper endpoint becomes more severe', () => {
    const rank = { low: 1, medium: 2, high: 3 } as const
    const probabilityUpperBounds = [1, 500, 501, 2_000, 2_001, 5_000, 5_001, 8_000, 8_001, 10_000]

    for (const impactBand of [1, 2, 3, 4, 5] as const) {
      const levels = probabilityUpperBounds.map(upperBasisPoints => rank[projectRiskExposure(
        { lowerBasisPoints: 0, upperBasisPoints },
        { lowerBand: 1, upperBand: impactBand },
      ).level])
      expect(levels).toEqual([...levels].sort((left, right) => left - right))
    }
    for (const upperBasisPoints of probabilityUpperBounds) {
      const levels = ([1, 2, 3, 4, 5] as const).map(upperBand => rank[projectRiskExposure(
        { lowerBasisPoints: 0, upperBasisPoints },
        { lowerBand: 1, upperBand },
      ).level])
      expect(levels).toEqual([...levels].sort((left, right) => left - right))
    }
  })

  it('normalizes one complete assessment and derives trigger time, exposure, and digest', () => {
    const normalized = normalizeProjectRiskAssessment(assessmentDraft(), {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger: null,
    })

    expect(normalized).toMatchObject({
      statement: {
        condition: 'Vendor approval remains pending',
        event: 'the migration window may be missed',
        consequence: 'the primary launch commitment may move',
      },
      trigger: {
        statement: 'approval is not received by Friday',
        state: 'met',
        observedAt: '2026-09-01T10:00:00.000Z',
      },
      confidenceRationale: 'Two approvals remain unresolved.',
      contributorMemberIds: ['member-a', 'member-z'],
      evidence: [
        { kind: 'project-schedule-change', scheduleChangeId: 'schedule-2' },
        { kind: 'workbench-audit-event', auditEventId: 'audit-1' },
      ],
      dependencies: [
        { kind: 'depends-on', riskId: 'risk-a' },
        { kind: 'depends-on', riskId: 'risk-z' },
      ],
      mitigationTaskGuids: ['task-a', 'task-z'],
      contingencyTaskGuids: ['task-b', 'task-y'],
      exposure: {
        policyVersion: 'project-risk-exposure-v1',
        likelihoodBand: 'P4',
        impactBand: 'I4',
        level: 'high',
      },
      assessedAt: '2026-09-01T10:00:00.000Z',
    })
    expect(normalized.digest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.statement)).toBe(true)
    expect(Object.isFrozen(normalized.dependencies)).toBe(true)
  })

  it('canonicalizes set order for a stable digest while preserving ordered assumptions', () => {
    const left = normalizeProjectRiskAssessment(assessmentDraft(), {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger: null,
    })
    const draft = assessmentDraft()
    const right = normalizeProjectRiskAssessment({
      ...draft,
      contributorMemberIds: [...draft.contributorMemberIds].reverse(),
      evidence: [...draft.evidence].reverse(),
      dependencies: [...draft.dependencies].reverse(),
      mitigationTaskGuids: [...draft.mitigationTaskGuids].reverse(),
      contingencyTaskGuids: [...draft.contingencyTaskGuids].reverse(),
    }, {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger: null,
    })
    const reorderedAssumptions = normalizeProjectRiskAssessment({
      ...draft,
      assumptions: [...draft.assumptions].reverse(),
    }, {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger: null,
    })

    expect(right.digest).toBe(left.digest)
    expect(reorderedAssumptions.digest).not.toBe(left.digest)
  })

  it('preserves first-met time while met and clears it after the trigger is no longer met', () => {
    const previousTrigger = {
      statement: 'approval is not received by Friday',
      state: 'met' as const,
      observedAt: '2026-08-31T09:00:00.000Z',
    }
    expect(normalizeProjectRiskAssessment(assessmentDraft(), {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger,
    }).trigger.observedAt).toBe(previousTrigger.observedAt)
    expect(normalizeProjectRiskAssessment({
      ...assessmentDraft(),
      trigger: { statement: 'a changed trigger statement', state: 'met' },
    }, {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger,
    }).trigger.observedAt).toBe('2026-09-01T10:00:00.000Z')
    expect(normalizeProjectRiskAssessment({
      ...assessmentDraft(),
      trigger: { statement: 'approval is received', state: 'not-met' },
    }, {
      assessedAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger,
    }).trigger.observedAt).toBeNull()
  })

  it.each([
    ['caller-supplied exposure', (draft: Record<string, unknown>) => ({ ...draft, exposure: {} }), 'exposure'],
    ['unknown category', (draft: Record<string, unknown>) => ({ ...draft, category: 'security' }), 'category'],
    ['empty event', (draft: Record<string, unknown>) => ({
      ...draft,
      statement: { ...(draft.statement as object), event: ' ' },
    }), 'statement.event'],
    ['unknown trigger state', (draft: Record<string, unknown>) => ({
      ...draft,
      trigger: { ...(draft.trigger as object), state: 'automatic' },
    }), 'trigger.state'],
    ['review after horizon', (draft: Record<string, unknown>) => ({
      ...draft,
      nextReviewOn: '2026-11-01',
    }), 'nextReviewOn'],
    ['overlapping treatment tasks', (draft: Record<string, unknown>) => ({
      ...draft,
      contingencyTaskGuids: ['task-a'],
    }), 'treatment'],
    ['duplicate dependency', (draft: Record<string, unknown>) => ({
      ...draft,
      dependencies: [
        { kind: 'depends-on', riskId: 'risk-a' },
        { kind: 'depends-on', riskId: 'risk-a' },
      ],
    }), 'dependencies'],
  ])('rejects %s', (_label, mutate, field) => {
    expect(() => normalizeProjectRiskAssessment(
      mutate(assessmentDraft() as unknown as Record<string, unknown>),
      {
        assessedAt: '2026-09-01T10:00:00.000Z',
        projectTimezone: 'Asia/Shanghai',
        previousTrigger: null,
      },
    )).toThrow(field)
  })

  it('compares date-only policy against the Host instant in the Project timezone', () => {
    const draft = assessmentDraft()
    expect(() => normalizeProjectRiskAssessment({
      ...draft,
      nextReviewOn: '2026-09-01',
    }, {
      assessedAt: '2026-09-01T16:30:00.000Z',
      projectTimezone: 'Asia/Shanghai',
      previousTrigger: null,
    })).toThrow('nextReviewOn')
    expect(normalizeProjectRiskAssessment({
      ...draft,
      nextReviewOn: '2026-09-01',
    }, {
      assessedAt: '2026-09-01T16:30:00.000Z',
      projectTimezone: 'UTC',
      previousTrigger: null,
    }).nextReviewOn).toBe('2026-09-01')
  })

  it('admits every different active-status edge and every active close edge', () => {
    const active = ['research', 'watch', 'mitigate', 'accept'] as const
    for (const currentStatus of active) {
      for (const status of active) {
        if (status === currentStatus) continue
        expect(normalizeProjectRiskTransition({
          status,
          rationale: 'Owner reviewed the current evidence.',
        }, {
          currentStatus,
          currentNextReviewOn: '2026-09-02',
          availableMitigationTaskCount: 1,
          occurredAt: '2026-09-01T10:00:00.000Z',
          projectTimezone: 'Asia/Shanghai',
        }).toStatus).toBe(status)
      }
      expect(normalizeProjectRiskTransition({
        status: 'closed',
        rationale: 'The uncertain condition no longer exists.',
        closureReason: 'no-longer-exists',
      }, {
        currentStatus,
        currentNextReviewOn: '2026-08-01',
        availableMitigationTaskCount: 0,
        occurredAt: '2026-09-01T10:00:00.000Z',
        projectTimezone: 'Asia/Shanghai',
      })).toMatchObject({
        fromStatus: currentStatus,
        toStatus: 'closed',
        closureReason: 'no-longer-exists',
      })
    }
  })

  it.each([
    ['no-op', { currentStatus: 'watch', status: 'watch' }, 'different'],
    ['terminal', { currentStatus: 'closed', status: 'research' }, 'terminal'],
    ['missing closure reason', { currentStatus: 'watch', status: 'closed' }, 'closureReason'],
    ['active closure reason', {
      currentStatus: 'watch', status: 'accept', closureReason: 'superseded',
    }, 'closureReason'],
    ['mitigate without task', { currentStatus: 'watch', status: 'mitigate' }, 'mitigation'],
  ] as const)('rejects %s transition', (_label, transition, message) => {
    const { currentStatus, ...value } = transition
    expect(() => normalizeProjectRiskTransition({
      rationale: 'Owner reviewed the current evidence.',
      ...value,
    }, {
      currentStatus,
      currentNextReviewOn: '2026-09-02',
      availableMitigationTaskCount: 0,
      occurredAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
    })).toThrow(message)
  })

  it('requires reassessment before an overdue active transition but still permits close', () => {
    const options = {
      currentStatus: 'watch' as const,
      currentNextReviewOn: '2026-08-31',
      availableMitigationTaskCount: 1,
      occurredAt: '2026-09-01T10:00:00.000Z',
      projectTimezone: 'Asia/Shanghai',
    }
    expect(() => normalizeProjectRiskTransition({
      status: 'accept',
      rationale: 'Exposure is consciously retained.',
    }, options)).toThrow('overdue')
    expect(normalizeProjectRiskTransition({
      status: 'closed',
      rationale: 'The Risk was superseded.',
      closureReason: 'superseded',
    }, options).toStatus).toBe('closed')
  })

  it('rejects direct and transitive Risk dependency cycles', () => {
    const graph = new Map<string, readonly string[]>([
      ['risk-a', ['risk-b']],
      ['risk-b', ['risk-c']],
      ['risk-c', []],
    ])
    expect(() => assertProjectRiskDependencyGraph(
      'risk-a',
      [{ kind: 'depends-on', riskId: 'risk-a' }],
      graph,
    )).toThrow('itself')
    expect(() => assertProjectRiskDependencyGraph(
      'risk-c',
      [{ kind: 'depends-on', riskId: 'risk-a' }],
      graph,
    )).toThrow('cycle')
    expect(() => assertProjectRiskDependencyGraph(
      'risk-d',
      [{ kind: 'depends-on', riskId: 'risk-a' }],
      graph,
    )).not.toThrow()
  })
})
