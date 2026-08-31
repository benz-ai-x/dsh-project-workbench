import type {
  DecideSuggestedChangeResult,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterProjection,
  SuggestedChangeProjection,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchReviewController,
  type WorkbenchReviewRemote,
} from '../src/client/review-controller.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

const receipt: WorkbenchCommandReceipt = {
  commandId: 'command-review-1',
  auditEventId: 'audit-review-1',
  outboxId: 'outbox-review-1',
}

function member(
  memberId: string,
  displayName: string,
  kind: 'human' | 'agent' = 'human',
  requiresHumanSponsor = kind === 'agent',
  canBeHumanSponsor = kind === 'human',
) {
  return {
    memberId,
    displayName,
    kind,
    status: 'active' as const,
    requiresHumanSponsor,
    canBeHumanSponsor,
  }
}

function card(options: {
  id?: string
  sequence?: number
  status?: SuggestedChangeProjection['effectiveStatus']
  risk?: 'low' | 'high'
  revision?: number
} = {}): SuggestedChangeProjection {
  const status = options.status ?? 'pending'
  const risk = options.risk ?? 'high'
  return {
    suggestedChangeId: options.id ?? 'suggestion-1',
    sequence: options.sequence ?? 1,
    revision: options.revision ?? 1,
    projectId: 'project-1',
    source: { kind: 'owner', actorId: 'owner-1' },
    target: {
      kind: 'project-responsibility',
      adapter: 'project-responsibility.replace',
      representationSchemaVersion: 1,
      projectId: 'project-1',
      baseTeamRevision: 4,
      baseResponsibilityRevision: 1,
      currentTeamRevision: status === 'stale' ? 5 : 4,
      currentResponsibilityRevision: status === 'stale' ? 2 : 1,
    },
    proposedDiff: {
      kind: 'project-responsibility.diff',
      schemaVersion: 1,
      before: {
        accountableMemberId: 'human-1',
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
      after: risk === 'high'
        ? {
            accountableMemberId: 'agent-1',
            contributorMemberIds: ['human-1'],
            humanSponsorMemberId: 'human-2',
          }
        : {
            accountableMemberId: 'human-1',
            contributorMemberIds: ['human-2'],
            humanSponsorMemberId: null,
          },
      changedFields: risk === 'high'
        ? ['accountable', 'contributors', 'human-sponsor']
        : ['contributors'],
      digest: `sha256:${'a'.repeat(64)}`,
    },
    evidence: [{
      kind: 'workbench-audit-event',
      auditEventId: 'audit-evidence-1',
      occurredAt: '2026-08-31T01:00:00.000Z',
      action: 'workbench.project.responsibility-assigned',
      summaryCode: 'project-responsibility-assigned',
      object: { type: 'project-responsibility', id: 'project-1', version: 1 },
    }],
    risk: {
      proposedLevel: risk,
      effectiveLevel: risk,
      proposedReasonCodes: risk === 'high'
        ? ['accountable-changed', 'human-sponsor-changed']
        : ['contributors-only'],
      policyVersion: 'project-responsibility-v1',
      batchPolicy: risk === 'high'
        ? { policy: 'forbidden', reason: 'high-risk' }
        : {
            policy: 'eligible-later',
            homogeneityKey: 'project-responsibility.replace|low|project-responsibility-v1',
          },
    },
    originCausationId: 'cause-proposal-1',
    persistedState: status === 'stale' ? 'pending' : status,
    effectiveStatus: status,
    decisions: [],
    allowedDecisions: status === 'stale'
      ? ['reject']
      : status === 'accepted' || status === 'rejected'
        ? []
        : ['accept', 'edit-and-accept', 'reject', 'defer'],
    createdAt: '2026-08-31T02:00:00.000Z',
    updatedAt: '2026-08-31T02:00:00.000Z',
  }
}

function projection(
  items: readonly SuggestedChangeProjection[] = [],
  teamRevision = 4,
  projectId = 'project-1',
): ReviewCenterProjection {
  return {
    projectId,
    proposalBuilder: {
      projectId,
      teamRevision,
      responsibilityRevision: 1,
      base: {
        accountableMemberId: 'human-1',
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
      memberOptions: [
        member('human-1', 'Owner Human'),
        member('human-2', 'Sponsor Human'),
        member('external-1', 'External Owner', 'human', true, true),
        member('agent-1', 'Research Agent', 'agent', true, false),
      ],
      evidenceOptions: [{
        kind: 'workbench-audit-event',
        auditEventId: 'audit-evidence-1',
        occurredAt: '2026-08-31T01:00:00.000Z',
        action: 'workbench.project.responsibility-assigned',
        summaryCode: 'project-responsibility-assigned',
        object: { type: 'project-responsibility', id: projectId, version: 1 },
      }],
    },
    items,
    nextBeforeSequence: null,
  }
}

function proposalSuccess(): ProposeProjectResponsibilityChangeResult {
  return {
    ok: true,
    value: {
      suggestedChangeId: 'suggestion-new',
      suggestedChangeRevision: 1,
      targetAdapter: 'project-responsibility.replace',
      baseTargetVersion: 4,
      persistedState: 'pending',
      riskLevel: 'high',
    },
    receipt,
  }
}

function decisionSuccess(): DecideSuggestedChangeResult {
  return {
    ok: true,
    value: {
      suggestedChangeId: 'suggestion-1',
      suggestedChangeRevision: 2,
      persistedState: 'accepted',
      decisionMode: 'accepted',
      riskLevel: 'high',
      appliedTeamRevision: 5,
      appliedResponsibilityRevision: 2,
    },
    receipt,
  }
}

function remote(overrides: Partial<WorkbenchReviewRemote> = {}): WorkbenchReviewRemote {
  return {
    reviewCenter: overrides.reviewCenter ?? vi.fn(filter => Promise.resolve(ok(
      projection([], 4, filter.projectId),
    ))),
    proposeProjectResponsibilityChange: overrides.proposeProjectResponsibilityChange
      ?? vi.fn(() => Promise.resolve(ok(proposalSuccess()))),
    decideSuggestedChange: overrides.decideSuggestedChange
      ?? vi.fn(() => Promise.resolve(ok(decisionSuccess()))),
  }
}

function commandKeys() {
  let next = 0
  return () => `command-key-${++next}`
}

describe('WorkbenchReviewController', () => {
  it('loads one Project-scoped builder round trip, applies five-state/risk filters, and enforces sponsor/evidence policy', async () => {
    const reviewCenter = vi.fn(filter => Promise.resolve(ok(projection([], 4, filter.projectId))))
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))

    await controller.selectProject('project-1', 'Evidence Project')
    expect(reviewCenter).toHaveBeenCalledWith({ projectId: 'project-1', limit: 20 }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      selection: { projectId: 'project-1', projectName: 'Evidence Project' },
      proposalDraft: { basedOnTeamRevision: 4, accountableMemberId: 'human-1' },
    })

    controller.setProposalAccountable('external-1')
    controller.setProposalEvidence('audit-evidence-1', true)
    expect(controller.canPropose()).toBe(false)
    controller.setProposalHumanSponsor('human-2')
    expect(controller.canPropose()).toBe(true)
    controller.setProposalAccountable('human-1')
    expect(controller.getSnapshot().proposalDraft.humanSponsorMemberId).toBe('')
    controller.setProposalContributor('human-2', true)
    expect(controller.canPropose()).toBe(true)

    controller.setStatusFilter('stale')
    controller.setRiskFilter('high')
    await controller.applyFilters()
    expect(reviewCenter).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      status: 'stale',
      riskLevel: 'high',
      limit: 20,
    }, expect.any(AbortSignal))
  })

  it('never combines an unapplied filter draft with the prior page cursor', async () => {
    const first = {
      ...projection([card({ id: 'suggestion-all-first', sequence: 100 })]),
      nextBeforeSequence: 81,
    }
    const acceptedFirst = {
      ...projection([card({
        id: 'suggestion-accepted-first', sequence: 80, status: 'accepted',
      })]),
      nextBeforeSequence: 61,
    }
    const acceptedNext = projection([card({
      id: 'suggestion-accepted-next', sequence: 60, status: 'accepted',
    })])
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValueOnce(ok(acceptedFirst))
      .mockResolvedValueOnce(ok(acceptedNext))
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))

    await controller.selectProject('project-1')
    controller.setStatusFilter('accepted')
    expect(controller.getSnapshot()).toMatchObject({
      filters: { status: 'accepted', riskLevel: 'all' },
      appliedFilters: { status: 'all', riskLevel: 'all' },
      filtersDirty: true,
    })
    await controller.loadMore()
    expect(reviewCenter).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().review?.items.map(item => item.suggestedChangeId))
      .toEqual(['suggestion-all-first'])

    await controller.applyFilters()
    expect(reviewCenter).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      status: 'accepted',
      limit: 20,
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      appliedFilters: { status: 'accepted', riskLevel: 'all' },
      filtersDirty: false,
    })
    expect(controller.getSnapshot().review?.items.map(item => item.suggestedChangeId))
      .toEqual(['suggestion-accepted-first'])

    await controller.loadMore()
    expect(reviewCenter).toHaveBeenNthCalledWith(3, {
      projectId: 'project-1',
      status: 'accepted',
      beforeSequence: 61,
      limit: 20,
    }, expect.any(AbortSignal))
    expect(controller.getSnapshot().review?.items.map(item => item.suggestedChangeId))
      .toEqual(['suggestion-accepted-first', 'suggestion-accepted-next'])
    await controller.dispose()
  })

  it('does not let old-cursor pagination supersede an in-flight full refresh', async () => {
    const initial = {
      ...projection([card({ id: 'suggestion-old', sequence: 100 })]),
      nextBeforeSequence: 81,
    }
    const refreshed = {
      ...projection([card({ id: 'suggestion-current', sequence: 120 })], 5),
      nextBeforeSequence: 101,
    }
    let refreshSignal: AbortSignal | undefined
    let resolveRefresh!: (value: RemoteResult<ReviewCenterProjection | null>) => void
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockImplementationOnce((_filter, signal) => {
        refreshSignal = signal
        return new Promise(done => { resolveRefresh = done })
      })
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))

    await controller.selectProject('project-1')
    const refreshing = controller.refresh()
    expect(controller.getSnapshot().phase).toBe('loading')
    await controller.loadMore()
    expect(reviewCenter).toHaveBeenCalledTimes(2)
    expect(refreshSignal?.aborted).toBe(false)

    resolveRefresh(ok(refreshed))
    await refreshing
    expect(controller.getSnapshot().review).toMatchObject({
      items: [{ suggestedChangeId: 'suggestion-current' }],
      nextBeforeSequence: 101,
    })
    expect(reviewCenter).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('keeps a selected Evidence projection visible when the recent window rotates', async () => {
    const initial = projection()
    const currentEvidence = initial.proposalBuilder.evidenceOptions[0]
    if (currentEvidence === undefined) throw new Error('expected initial Evidence')
    const rotated: ReviewCenterProjection = {
      ...initial,
      proposalBuilder: {
        ...initial.proposalBuilder,
        evidenceOptions: [{
          ...currentEvidence,
          auditEventId: 'audit-evidence-new-window',
          occurredAt: '2026-08-31T03:00:00.000Z',
        }],
      },
    }
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(rotated))
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))

    await controller.selectProject('project-1')
    controller.setProposalContributor('human-2', true)
    controller.setProposalEvidence('audit-evidence-1', true)
    expect(controller.canPropose()).toBe(true)
    await controller.refresh()

    expect(controller.getSnapshot().review?.proposalBuilder.evidenceOptions)
      .toEqual(rotated.proposalBuilder.evidenceOptions)
    expect(controller.getSnapshot().retainedProposalEvidence)
      .toEqual([currentEvidence])
    expect(controller.getSnapshot().proposalDraft.evidenceAuditEventIds)
      .toEqual(['audit-evidence-1'])
    expect(controller.canPropose()).toBe(true)
    controller.setProposalEvidence('audit-evidence-1', false)
    expect(controller.getSnapshot().retainedProposalEvidence).toEqual([])
    expect(controller.canPropose()).toBe(false)
    await controller.dispose()
  })

  it('canonicalizes proposal Evidence IDs before fingerprinting and submission', async () => {
    const initial = projection()
    const evidence = initial.proposalBuilder.evidenceOptions[0]
    if (evidence === undefined) throw new Error('expected proposal Evidence')
    const withEvidence: ReviewCenterProjection = {
      ...initial,
      proposalBuilder: {
        ...initial.proposalBuilder,
        evidenceOptions: [
          { ...evidence, auditEventId: 'audit-z-last' },
          { ...evidence, auditEventId: 'audit-a-first' },
        ],
      },
    }
    const propose = vi.fn(() => Promise.resolve(ok(proposalSuccess())))
    const controller = new WorkbenchReviewController(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(withEvidence))),
      proposeProjectResponsibilityChange: propose,
    }), { nextCommandKey: commandKeys() })

    await controller.selectProject('project-1')
    controller.setProposalContributor('human-2', true)
    controller.setProposalEvidence('audit-z-last', true)
    controller.setProposalEvidence('audit-a-first', true)
    expect(controller.getSnapshot().proposalDraft.evidenceAuditEventIds)
      .toEqual(['audit-a-first', 'audit-z-last'])
    await controller.propose()
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({
      evidenceRefs: [
        { kind: 'workbench-audit-event', auditEventId: 'audit-a-first' },
        { kind: 'workbench-audit-event', auditEventId: 'audit-z-last' },
      ],
    }), expect.any(AbortSignal))
    await controller.dispose()
  })

  it('retains newly inactive draft members for repair but never lets them be selected again', async () => {
    const initial = projection()
    const next = projection([], 5)
    const refreshed: ReviewCenterProjection = {
      ...next,
      proposalBuilder: {
        ...next.proposalBuilder,
        memberOptions: [
          ...next.proposalBuilder.memberOptions.map(option => {
            if (!['human-1', 'human-2', 'agent-1'].includes(option.memberId)) return option
            return {
              ...option,
              status: 'inactive' as const,
              canBeHumanSponsor: false,
            }
          }),
          member('human-3', 'Replacement Human'),
        ],
      },
    }
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(refreshed))
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))

    await controller.selectProject('project-1')
    controller.setProposalAccountable('agent-1')
    controller.setProposalContributor('human-1', true)
    controller.setProposalHumanSponsor('human-2')
    controller.setProposalEvidence('audit-evidence-1', true)
    await controller.refresh()
    expect(controller.getSnapshot().proposalDraft).toMatchObject({
      basedOnTeamRevision: 4,
      accountableMemberId: 'agent-1',
      contributorMemberIds: ['human-1'],
      humanSponsorMemberId: 'human-2',
    })
    expect(controller.canPropose()).toBe(false)

    controller.adoptLatestProposalBase()
    controller.setProposalContributor('human-1', false)
    controller.setProposalAccountable('external-1')
    controller.setProposalHumanSponsor('human-3')
    expect(controller.canPropose()).toBe(true)

    controller.setProposalContributor('human-1', true)
    expect(controller.getSnapshot().proposalDraft).toMatchObject({
      basedOnTeamRevision: 5,
      accountableMemberId: 'external-1',
      contributorMemberIds: [],
      humanSponsorMemberId: 'human-3',
    })
    expect(controller.canPropose()).toBe(true)
    await controller.dispose()
  })

  it('clears a sponsor when proposal and edited-decision Accountable no longer requires one', async () => {
    const controller = new WorkbenchReviewController(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(projection([card()])))),
    }))
    await controller.selectProject('project-1')

    controller.setProposalAccountable('external-1')
    controller.setProposalHumanSponsor('human-2')
    controller.setProposalEvidence('audit-evidence-1', true)
    expect(controller.canPropose()).toBe(true)
    controller.setProposalAccountable('human-1')
    controller.setProposalContributor('human-2', true)
    expect(controller.getSnapshot().proposalDraft.humanSponsorMemberId).toBe('')
    expect(controller.canPropose()).toBe(true)

    controller.setDecisionMode('suggestion-1', 'edit-and-accept')
    expect(controller.getSnapshot().decisionDrafts['suggestion-1']?.candidate)
      .toMatchObject({ accountableMemberId: 'agent-1', humanSponsorMemberId: 'human-2' })
    controller.setDecisionAccountable('suggestion-1', 'human-1')
    controller.setDecisionContributor('suggestion-1', 'human-2', true)
    controller.setDecisionFeedback('suggestion-1', 'Use the Feishu human without a sponsor.')
    controller.setDecisionRiskAcknowledged('suggestion-1', true)
    expect(controller.getSnapshot().decisionDrafts['suggestion-1']?.candidate)
      .toMatchObject({ accountableMemberId: 'human-1', humanSponsorMemberId: null })
    expect(controller.canDecide('suggestion-1')).toBe(true)
  })

  it('deduplicates pending proposal submission and retains only an exact ambiguous-transport retry envelope', async () => {
    const requests: unknown[] = []
    const propose = vi.fn()
      .mockImplementationOnce(request => {
        requests.push(request)
        return Promise.resolve({ ok: false as const, error: { code: 'unavailable' as const } })
      })
      .mockImplementationOnce(request => {
        requests.push(request)
        return Promise.resolve(ok(proposalSuccess()))
      })
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(projection()))
      .mockResolvedValue(ok(projection([card({ id: 'suggestion-new' })])))
    const controller = new WorkbenchReviewController(remote({
      reviewCenter,
      proposeProjectResponsibilityChange: propose,
    }), { nextCommandKey: commandKeys() })
    await controller.selectProject('project-1')
    controller.setProposalAccountable('agent-1')
    controller.setProposalHumanSponsor('human-2')
    controller.setProposalEvidence('audit-evidence-1', true)

    const first = controller.propose()
    const duplicate = controller.propose()
    await Promise.all([first, duplicate])
    expect(propose).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      canRetryMutation: true,
      proposalDraftDirty: true,
    })

    controller.markDisconnected()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'disconnected',
      canRetryMutation: true,
      proposalDraftDirty: true,
    })
    await controller.connectionReset()
    expect(propose).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().canRetryMutation).toBe(true)
    await controller.retryMutation()
    expect(propose).toHaveBeenCalledTimes(2)
    expect(requests[1]).toEqual(requests[0])
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      canRetryMutation: false,
      proposalDraftDirty: false,
      focusSuggestedChangeId: 'suggestion-new',
      focusEpoch: 1,
    })
  })

  it('does not retain retry identity for a definitive permission transport rejection', async () => {
    const propose = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'forbidden' as const },
    }))
    const controller = new WorkbenchReviewController(remote({
      proposeProjectResponsibilityChange: propose,
    }), { nextCommandKey: commandKeys() })
    await controller.selectProject('project-1')
    controller.setProposalAccountable('agent-1')
    controller.setProposalHumanSponsor('human-2')
    controller.setProposalEvidence('audit-evidence-1', true)
    await controller.propose()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      canRetryMutation: false,
      issue: { kind: 'transport', code: 'forbidden' },
    })
    await controller.retryMutation()
    expect(propose).toHaveBeenCalledOnce()
  })

  it('preserves a proposal draft across a definitive Team conflict but never replays it after refresh', async () => {
    const propose = vi.fn(() => Promise.resolve(ok({
      ok: false as const,
      error: {
        code: 'team-revision-conflict' as const,
        message: 'safe',
        expectedTeamRevision: 4,
        currentTeamRevision: 5,
      },
    })))
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(projection([], 4)))
      .mockResolvedValueOnce(ok(projection([], 5)))
    const controller = new WorkbenchReviewController(remote({
      reviewCenter,
      proposeProjectResponsibilityChange: propose,
    }), { nextCommandKey: commandKeys() })
    await controller.selectProject('project-1')
    controller.setProposalAccountable('agent-1')
    controller.setProposalHumanSponsor('human-2')
    controller.setProposalEvidence('audit-evidence-1', true)
    await controller.propose()

    expect(propose).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      proposalDraft: { basedOnTeamRevision: 4, accountableMemberId: 'agent-1' },
      proposalDraftDirty: true,
      canRetryMutation: false,
      issue: { kind: 'conflict', code: 'team-revision-conflict' },
    })
    expect(controller.canPropose()).toBe(false)
    controller.adoptLatestProposalBase()
    expect(controller.getSnapshot().proposalDraft.basedOnTeamRevision).toBe(5)
    expect(propose).toHaveBeenCalledOnce()
  })

  it('requires feedback and explicit high-risk acknowledgement, and submits one closed decision request', async () => {
    const decide = vi.fn(() => Promise.resolve(ok(decisionSuccess())))
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(projection([card()])))
      .mockResolvedValueOnce(ok(projection([card({ status: 'accepted', revision: 2 })], 5)))
    const targetCommitted = vi.fn()
    const controller = new WorkbenchReviewController(remote({
      reviewCenter,
      decideSuggestedChange: decide,
    }), {
      nextCommandKey: commandKeys(),
      onCommitted: targetCommitted,
    })
    await controller.selectProject('project-1')

    expect(controller.canDecide('suggestion-1')).toBe(false)
    controller.setDecisionFeedback('suggestion-1', 'Reviewed evidence and responsibility impact.')
    expect(controller.canDecide('suggestion-1')).toBe(false)
    controller.setDecisionRiskAcknowledged('suggestion-1', true)
    expect(controller.canDecide('suggestion-1')).toBe(true)
    const first = controller.decide('suggestion-1')
    const duplicate = controller.decide('suggestion-1')
    await Promise.all([first, duplicate])

    expect(decide).toHaveBeenCalledOnce()
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      suggestedChangeId: 'suggestion-1',
      expectedSuggestedChangeRevision: 1,
      mode: 'accept',
      acknowledgedRiskLevel: 'high',
      feedback: 'Reviewed evidence and responsibility impact.',
      reason: 'owner-suggested-change-accept',
    }), expect.any(AbortSignal))
    expect(targetCommitted).toHaveBeenCalledWith(receipt, true)
  })

  it.each([
    ['accept', 'owner-suggested-change-accept'],
    ['edit-and-accept', 'owner-suggested-change-edit-accept'],
    ['reject', 'owner-suggested-change-reject'],
    ['defer', 'owner-suggested-change-defer'],
  ] as const)('requires feedback and emits the closed %s decision variant', async (mode, reason) => {
    const decide = vi.fn(() => Promise.resolve(ok(decisionSuccess())))
    const controller = new WorkbenchReviewController(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(projection([card()])))),
      decideSuggestedChange: decide,
    }), { nextCommandKey: commandKeys() })
    await controller.selectProject('project-1')
    controller.setDecisionMode('suggestion-1', mode)
    expect(controller.canDecide('suggestion-1')).toBe(false)
    controller.setDecisionFeedback('suggestion-1', `Required feedback for ${mode}.`)
    if (mode === 'accept' || mode === 'edit-and-accept') {
      expect(controller.canDecide('suggestion-1')).toBe(false)
      controller.setDecisionRiskAcknowledged('suggestion-1', true)
    }
    expect(controller.canDecide('suggestion-1')).toBe(true)
    await controller.decide('suggestion-1')
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ mode, reason }), expect.any(AbortSignal))
    const request = decide.mock.calls[0]?.[0]
    if (mode === 'edit-and-accept') expect(request).toHaveProperty('candidate')
    else expect(request).not.toHaveProperty('candidate')
  })

  it('keeps domain stale distinct from transport disconnect and clears protected drafts on switch and disposal', async () => {
    const reviewCenter = vi.fn(filter => Promise.resolve(ok(projection(
      filter.projectId === 'project-1' ? [card({ status: 'stale' })] : [],
      5,
      filter.projectId,
    ))))
    const controller = new WorkbenchReviewController(remote({ reviewCenter }))
    await controller.selectProject('project-1')
    controller.setDecisionFeedback('suggestion-1', 'Reject stale intent.')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      review: { items: [{ effectiveStatus: 'stale' }] },
    })

    controller.markDisconnected()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'disconnected',
      review: { items: [{ effectiveStatus: 'stale' }] },
      decisionDrafts: { 'suggestion-1': { feedback: 'Reject stale intent.' } },
    })
    await controller.connectionReset()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready' })

    await controller.selectProject('project-2', 'Replacement Project')
    expect(controller.getSnapshot()).toMatchObject({
      selection: { projectId: 'project-2' },
      decisionDrafts: {},
      proposalDraftDirty: false,
    })
    await controller.dispose()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'idle',
      selection: null,
      review: null,
      decisionDrafts: {},
    })
  })

  it('aborts an accepted read and remains quiet after Fiber disposal', async () => {
    let signal: AbortSignal | undefined
    let resolve!: (value: RemoteResult<ReviewCenterProjection | null>) => void
    const pending = new Promise<RemoteResult<ReviewCenterProjection | null>>(done => {
      resolve = done
    })
    const controller = new WorkbenchReviewController(remote({
      reviewCenter: vi.fn((_filter, nextSignal) => {
        signal = nextSignal
        return pending
      }),
    }))
    const loading = controller.selectProject('project-1')
    const disposal = controller.dispose()
    expect(signal?.aborted).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', review: null })
    resolve(ok(projection()))
    await Promise.all([loading, disposal])
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', review: null })
  })
})
