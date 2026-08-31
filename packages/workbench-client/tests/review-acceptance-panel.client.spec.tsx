// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  DeliverableAcceptanceReviewCenterProjection,
  DecideDeliverableAcceptanceResult,
  ReviewCenterProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCenterPanel } from '../src/client/ReviewCenterPanel.tsx'
import { WorkbenchReviewController, type WorkbenchReviewRemote } from '../src/client/review-controller.ts'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

function ok<T>(value: T): RemoteResult<T> { return { ok: true, value } }

function suggested(): ReviewCenterProjection {
  return {
    reviewKind: 'suggested-change', projectId: 'project-1',
    proposalBuilder: {
      projectId: 'project-1', teamRevision: 1, responsibilityRevision: null,
      base: { accountableMemberId: null, contributorMemberIds: [], humanSponsorMemberId: null },
      memberOptions: [], evidenceOptions: [],
    },
    items: [], nextBeforeSequence: null,
  }
}

function acceptance(): DeliverableAcceptanceReviewCenterProjection {
  const accountable = { memberId: 'human-1', displayName: 'Owner Human', kind: 'human' as const }
  const acceptor = { memberId: 'human-2', displayName: 'Designated Acceptor', kind: 'human' as const }
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
    reviewKind: 'deliverable-acceptance', projectId: 'project-1', deliverablesRevision: 3,
    items: [{
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
    }],
    nextBeforeSequence: null,
  }
}

function decisionSuccess(): DecideDeliverableAcceptanceResult {
  const item = acceptance().items[0]
  if (item === undefined) throw new Error('acceptance fixture missing')
  return {
    ok: true,
    value: {
      projectId: 'project-1', revision: 4, teamRevision: 1, taskRevision: 1,
      scheduleRevision: 1, calendarBinding: null, memberOptions: [], taskOptions: [],
      deliverables: [], activity: [], nextBeforeActivitySequence: null,
    },
    request: item.request,
    finalRelease: null,
    receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
  }
}

function remote(decide = vi.fn(() => Promise.resolve(ok(decisionSuccess())))): WorkbenchReviewRemote {
  return {
    reviewCenter: vi.fn(query => Promise.resolve(ok(
      query.reviewKind === 'deliverable-acceptance' ? acceptance() : suggested(),
    ))),
    proposeProjectResponsibilityChange: vi.fn(() => Promise.reject(new Error('not used'))),
    decideSuggestedChange: vi.fn(() => Promise.reject(new Error('not used'))),
    decideDeliverableAcceptance: decide,
  }
}

const t = (key: WorkbenchKey): string => zh[key]

afterEach(() => { cleanup() })

describe('ReviewCenterPanel Deliverable Acceptance', () => {
  it('shows explicit decision prerequisites and submits the typed Owner decision from accessible controls', async () => {
    const decide = vi.fn(() => Promise.resolve(ok(decisionSuccess())))
    const controller = new WorkbenchReviewController(remote(decide), {
      nextCommandKey: (() => {
        const values = ['idem-1', 'cause-1']
        return () => values.shift() ?? 'unexpected'
      })(),
    })
    render(<ReviewCenterPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['review.kind.acceptance'] }))
    })

    const card = screen.getByRole('article', {
      name: `Evidence report — ${zh['review.acceptance.frozen']}`,
    })
    expect(card.getAttribute('data-review-kind')).toBe('deliverable-acceptance')
    expect(within(card).getByText(zh['deliverables.artifact.declared'])).toBeTruthy()
    expect(within(card).getByText(zh['review.acceptance.decision.actor'])).toBeTruthy()
    expect(within(card).getByText(zh['review.acceptance.decision.hint'])).toBeTruthy()

    const approve = within(card).getByRole('button', {
      name: zh['review.acceptance.decision.approve'],
    }) as HTMLButtonElement
    const reject = within(card).getByRole('button', {
      name: zh['review.acceptance.decision.reject'],
    }) as HTMLButtonElement
    const changes = within(card).getByRole('button', {
      name: zh['review.acceptance.decision.changes'],
    }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(reject.disabled).toBe(true)
    expect(changes.disabled).toBe(true)

    for (const criterion of ['Sources are inspectable', 'Recommendation is actionable']) {
      const group = within(card).getByRole('group', { name: criterion })
      fireEvent.click(within(group).getByRole('radio', {
        name: zh['review.acceptance.decision.met'],
      }))
    }
    fireEvent.change(within(card).getByLabelText(
      zh['review.acceptance.decision.feedback'],
    ), { target: { value: 'Accepted with evidence.' } })

    expect(approve.disabled).toBe(false)
    expect(reject.disabled).toBe(false)
    expect(changes.disabled).toBe(true)
    await act(async () => { fireEvent.click(approve) })

    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'approve', feedback: 'Accepted with evidence.',
      expectedDeliverablesRevision: 3,
      criteria: [
        { criterionId: 'criterion-1', outcome: 'met' },
        { criterionId: 'criterion-2', outcome: 'met' },
      ],
    }), expect.any(AbortSignal))
    expect(decide.mock.calls[0]?.[0]).not.toHaveProperty('candidateVersions')
    await controller.dispose()
  })
})
