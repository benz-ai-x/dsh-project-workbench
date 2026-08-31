import type {
  DeliverableAcceptanceReviewCenterProjection,
  DeliverableAcceptanceReviewItemProjection,
  DecideDeliverableAcceptanceResult,
  ReviewCenterProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchReviewController, type WorkbenchReviewRemote } from '../src/client/review-controller.ts'

function ok<T>(value: T): RemoteResult<T> { return { ok: true, value } }

function suggested(projectId = 'project-1'): ReviewCenterProjection {
  return {
    reviewKind: 'suggested-change', projectId,
    proposalBuilder: {
      projectId, teamRevision: 1, responsibilityRevision: null,
      base: { accountableMemberId: null, contributorMemberIds: [], humanSponsorMemberId: null },
      memberOptions: [], evidenceOptions: [],
    },
    items: [], nextBeforeSequence: null,
  }
}

function acceptanceItem(): DeliverableAcceptanceReviewItemProjection {
  const acceptor = { memberId: 'human-2', displayName: 'Designated Acceptor', kind: 'human' as const }
  const accountable = { memberId: 'human-1', displayName: 'Owner Human', kind: 'human' as const }
  const plan = {
    planSnapshotId: 'plan-1', name: 'Evidence report', description: null,
    criteria: [
      { criterionId: 'criterion-1', statement: 'Sources are inspectable' },
      { criterionId: 'criterion-2', statement: 'Recommendation is actionable' },
    ],
    responsibility: { accountable, contributors: [], humanSponsor: null, acceptor },
    taskGuids: ['task-1'], digest: `sha256:${'a'.repeat(64)}` as const,
    createdAt: '2026-09-01T00:00:00.000Z',
  }
  const calendar = {
    eventId: 'event-1', eventAppLink: 'https://applink.feishu.cn/event-1',
    schedule: { kind: 'all-day' as const, startDate: '2026-09-02', endDate: '2026-09-03' },
    remoteStatus: 'confirmed' as const, remoteObservationVersion: 'observation-1',
    syncState: 'healthy' as const, lastObservedAt: '2026-09-01T00:00:00.000Z',
  }
  return {
    deliverableId: 'deliverable-1', deliverableName: 'Evidence report',
    currentDeliverableRevision: 2, currentState: 'in-review', currentCalendar: calendar,
    currentTasks: [], finalRelease: null,
    request: {
      acceptanceRequestId: 'request-1', sequence: 1, revision: 1, deliverableRevision: 2,
      plan, calendar, taskGuids: ['task-1'],
      candidateVersions: [{
        kind: 'declared-file-version', source: 'local', resourceId: 'report.md',
        versionId: 'git-sha-1', displayName: 'Evidence report v1', canonicalUrl: null,
        contentDigest: null, referenceDigest: `sha256:${'b'.repeat(64)}`,
        resolution: 'declared',
      }],
      candidatesDigest: `sha256:${'c'.repeat(64)}`, persistedState: 'pending',
      effectiveStatus: 'pending', decision: null,
      allowedDecisions: ['approve', 'reject', 'request-changes'],
      createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T01:00:00.000Z',
    },
  }
}

function acceptance(): DeliverableAcceptanceReviewCenterProjection {
  return {
    reviewKind: 'deliverable-acceptance', projectId: 'project-1', deliverablesRevision: 3,
    items: [acceptanceItem()], nextBeforeSequence: null,
  }
}

function decisionSuccess(): DecideDeliverableAcceptanceResult {
  const item = acceptanceItem()
  return {
    ok: true,
    value: {
      projectId: 'project-1', revision: 4, teamRevision: 1, taskRevision: 1,
      scheduleRevision: 1, calendarBinding: null, memberOptions: [], taskOptions: [],
      deliverables: [], activity: [], nextBeforeActivitySequence: null,
    },
    request: {
      ...item.request, revision: 2, persistedState: 'approved', effectiveStatus: 'approved',
      allowedDecisions: [],
      decision: {
        decisionId: 'decision-1', requestRevision: 2, outcome: 'approved',
        actor: { kind: 'owner', id: 'owner-actual' },
        designatedAcceptor: item.request.plan.responsibility.acceptor,
        criteria: [
          { criterionId: 'criterion-1', outcome: 'met' },
          { criterionId: 'criterion-2', outcome: 'met' },
        ],
        feedback: 'Accepted with evidence.', causationId: 'cause-1',
        receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
        decidedAt: '2026-09-01T02:00:00.000Z',
      },
    },
    finalRelease: null,
    receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
  }
}

function remote(overrides: Partial<WorkbenchReviewRemote> = {}): WorkbenchReviewRemote {
  return {
    reviewCenter: overrides.reviewCenter ?? vi.fn(query => Promise.resolve(ok(
      query.reviewKind === 'deliverable-acceptance' ? acceptance() : suggested(query.projectId),
    ))),
    proposeProjectResponsibilityChange: overrides.proposeProjectResponsibilityChange
      ?? vi.fn(() => Promise.reject(new Error('not used'))),
    decideSuggestedChange: overrides.decideSuggestedChange
      ?? vi.fn(() => Promise.reject(new Error('not used'))),
    decideDeliverableAcceptance: overrides.decideDeliverableAcceptance
      ?? vi.fn(() => Promise.resolve(ok(decisionSuccess()))),
  }
}

describe('WorkbenchReviewController deliverable acceptance', () => {
  it('switches through the closed Review Center kind and applies an acceptance-only status filter', async () => {
    const read = vi.fn(query => Promise.resolve(ok(
      query.reviewKind === 'deliverable-acceptance' ? acceptance() : suggested(query.projectId),
    )))
    const controller = new WorkbenchReviewController(remote({ reviewCenter: read }))
    await controller.selectProject('project-1', 'Evidence Project')

    await controller.setReviewKind('deliverable-acceptance')
    controller.setAcceptanceStatusFilter('stale')
    await controller.applyAcceptanceFilters()

    expect(read).toHaveBeenLastCalledWith({
      reviewKind: 'deliverable-acceptance', projectId: 'project-1', status: 'stale', limit: 20,
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      activeKind: 'deliverable-acceptance', acceptanceReview: { reviewKind: 'deliverable-acceptance' },
      acceptanceFilters: { status: 'stale' },
    })
    await controller.dispose()
  })

  it('requires complete per-criterion outcomes and sends no candidate replacement in a decision', async () => {
    let release!: (value: RemoteResult<DecideDeliverableAcceptanceResult>) => void
    const decide = vi.fn(() => new Promise<RemoteResult<DecideDeliverableAcceptanceResult>>(
      resolve => { release = resolve },
    ))
    const keyValues = ['idem-1', 'cause-1']
    const controller = new WorkbenchReviewController(remote({
      decideDeliverableAcceptance: decide,
    }), { nextCommandKey: () => keyValues.shift() ?? 'unexpected' })
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.setReviewKind('deliverable-acceptance')
    controller.setAcceptanceDecisionMode('request-1', 'approve')
    controller.setAcceptanceCriterionOutcome('request-1', 'criterion-1', 'met')
    controller.setAcceptanceFeedback('request-1', 'Accepted with evidence.')
    expect(controller.canDecideAcceptance('request-1')).toBe(false)
    controller.setAcceptanceCriterionOutcome('request-1', 'criterion-2', 'met')
    expect(controller.canDecideAcceptance('request-1')).toBe(true)

    const first = controller.decideAcceptance('request-1')
    const duplicate = controller.decideAcceptance('request-1')
    expect(decide).toHaveBeenCalledOnce()
    expect(decide).toHaveBeenCalledWith({
      projectId: 'project-1', deliverableId: 'deliverable-1', acceptanceRequestId: 'request-1',
      mode: 'approve',
      criteria: [
        { criterionId: 'criterion-1', outcome: 'met' },
        { criterionId: 'criterion-2', outcome: 'met' },
      ],
      feedback: 'Accepted with evidence.', expectedDeliverablesRevision: 3,
      expectedDeliverableRevision: 2, expectedAcceptanceRequestRevision: 1,
      idempotencyKey: 'idem-1', causationId: 'cause-1',
      reason: 'owner-deliverable-acceptance-approve',
    }, expect.any(AbortSignal))
    expect(decide.mock.calls[0]?.[0]).not.toHaveProperty('candidateVersions')

    release(ok(decisionSuccess()))
    await Promise.all([first, duplicate])
    await controller.dispose()
  })

  it('requires at least one not-met criterion for needs_changes', async () => {
    const controller = new WorkbenchReviewController(remote())
    await controller.selectProject('project-1', 'Evidence Project')
    await controller.setReviewKind('deliverable-acceptance')
    controller.setAcceptanceDecisionMode('request-1', 'request-changes')
    controller.setAcceptanceFeedback('request-1', 'Please revise the recommendation.')
    controller.setAcceptanceCriterionOutcome('request-1', 'criterion-1', 'met')
    controller.setAcceptanceCriterionOutcome('request-1', 'criterion-2', 'met')
    expect(controller.canDecideAcceptance('request-1')).toBe(false)
    controller.setAcceptanceCriterionOutcome('request-1', 'criterion-2', 'not-met')
    expect(controller.canDecideAcceptance('request-1')).toBe(true)
    await controller.dispose()
  })
})
