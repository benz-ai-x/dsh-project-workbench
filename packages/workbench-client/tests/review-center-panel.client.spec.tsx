// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ReviewCenterProjection,
  SuggestedChangeProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCenterPanel } from '../src/client/ReviewCenterPanel.tsx'
import { WorkbenchReviewController, type WorkbenchReviewRemote } from '../src/client/review-controller.ts'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function suggestion(
  id = 'suggestion-1',
  sequence = 1,
  risk: 'low' | 'high' = 'high',
): SuggestedChangeProjection {
  return {
    suggestedChangeId: id,
    sequence,
    revision: 1,
    projectId: 'project-1',
    source: { kind: 'owner', actorId: 'owner-1' },
    target: {
      kind: 'project-responsibility',
      adapter: 'project-responsibility.replace',
      representationSchemaVersion: 1,
      projectId: 'project-1',
      baseTeamRevision: 4,
      baseResponsibilityRevision: 1,
      currentTeamRevision: 4,
      currentResponsibilityRevision: 1,
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
    originCausationId: 'cause-1',
    persistedState: 'pending',
    effectiveStatus: 'pending',
    decisions: [],
    allowedDecisions: ['accept', 'edit-and-accept', 'reject', 'defer'],
    createdAt: '2026-08-31T02:00:00.000Z',
    updatedAt: '2026-08-31T02:00:00.000Z',
  }
}

function projection(items: readonly SuggestedChangeProjection[]): ReviewCenterProjection {
  return {
    projectId: 'project-1',
    proposalBuilder: {
      projectId: 'project-1',
      teamRevision: 4,
      responsibilityRevision: 1,
      base: {
        accountableMemberId: 'human-1',
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
      memberOptions: [
        {
          memberId: 'human-1', displayName: 'Owner Human', kind: 'human', status: 'active',
          requiresHumanSponsor: false, canBeHumanSponsor: true,
        },
        {
          memberId: 'human-2', displayName: 'Sponsor Human', kind: 'human', status: 'active',
          requiresHumanSponsor: false, canBeHumanSponsor: true,
        },
        {
          memberId: 'external-1', displayName: 'External Owner', kind: 'human', status: 'active',
          requiresHumanSponsor: true, canBeHumanSponsor: true,
        },
        {
          memberId: 'agent-1', displayName: 'Research Agent', kind: 'agent', status: 'active',
          requiresHumanSponsor: true, canBeHumanSponsor: false,
        },
      ],
      evidenceOptions: [{
        kind: 'workbench-audit-event',
        auditEventId: 'audit-evidence-1',
        occurredAt: '2026-08-31T01:00:00.000Z',
        action: 'workbench.project.responsibility-assigned',
        summaryCode: 'project-responsibility-assigned',
        object: { type: 'project-responsibility', id: 'project-1', version: 1 },
      }],
    },
    items,
    nextBeforeSequence: null,
  }
}

function projectionWithInactiveDraftMembers(
  items: readonly SuggestedChangeProjection[],
): ReviewCenterProjection {
  const value = projection(items)
  return {
    ...value,
    proposalBuilder: {
      ...value.proposalBuilder,
      teamRevision: 5,
      memberOptions: [
        ...value.proposalBuilder.memberOptions.map(member => {
          if (!['human-1', 'human-2', 'agent-1'].includes(member.memberId)) return member
          return {
            ...member,
            status: 'inactive' as const,
            canBeHumanSponsor: false,
          }
        }),
        {
          memberId: 'human-3', displayName: 'Replacement Human', kind: 'human', status: 'active',
          requiresHumanSponsor: false, canBeHumanSponsor: true,
        },
      ],
    },
  }
}

function remote(overrides: Partial<WorkbenchReviewRemote> = {}): WorkbenchReviewRemote {
  return {
    reviewCenter: overrides.reviewCenter
      ?? vi.fn(() => Promise.resolve(ok(projection([suggestion()])))),
    proposeProjectResponsibilityChange: overrides.proposeProjectResponsibilityChange
      ?? vi.fn(() => Promise.resolve(ok({
        ok: true as const,
        value: {
          suggestedChangeId: 'suggestion-2',
          suggestedChangeRevision: 1 as const,
          targetAdapter: 'project-responsibility.replace' as const,
          baseTargetVersion: 4,
          persistedState: 'pending' as const,
          riskLevel: 'low' as const,
        },
        receipt: {
          commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1',
        },
      }))),
    decideSuggestedChange: overrides.decideSuggestedChange ?? vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: {
        suggestedChangeId: 'suggestion-1',
        suggestedChangeRevision: 2,
        persistedState: 'accepted' as const,
        decisionMode: 'accepted' as const,
        riskLevel: 'high' as const,
        appliedTeamRevision: 5,
        appliedResponsibilityRevision: 2,
      },
      receipt: { commandId: 'command-2', auditEventId: 'audit-2', outboxId: 'outbox-2' },
    }))),
  }
}

const t = (key: WorkbenchKey): string => zh[key]

afterEach(() => { cleanup() })

async function renderPanel(workbenchRemote: WorkbenchReviewRemote) {
  const controller = new WorkbenchReviewController(workbenchRemote, {
    nextCommandKey: (() => {
      let next = 0
      return () => `key-${++next}`
    })(),
  })
  render(<ReviewCenterPanel controller={controller} t={t} />)
  await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })
  return controller
}

describe('ReviewCenterPanel', () => {
  it('exposes stable semantic filters, typed diff/evidence/history, four decisions, and high-risk confirmation', async () => {
    const historical: SuggestedChangeProjection = {
      ...suggestion(),
      revision: 2,
      persistedState: 'deferred',
      effectiveStatus: 'deferred',
      decisions: [{
        decisionId: 'decision-1',
        suggestedChangeRevision: 2,
        mode: 'deferred',
        actor: { kind: 'owner', id: 'owner-1' },
        feedback: '等待下一次项目核对。',
        appliedDiff: null,
        appliedRiskLevel: null,
        appliedRiskReasonCodes: [],
        appliedTeamRevision: null,
        appliedResponsibilityRevision: null,
        causationId: 'cause-defer-1',
        receipt: { commandId: 'command-defer', auditEventId: 'audit-defer', outboxId: 'outbox-defer' },
        decidedAt: '2026-08-31T02:30:00.000Z',
      }],
    }
    const decide = vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: {
        suggestedChangeId: 'suggestion-1',
        suggestedChangeRevision: 2,
        persistedState: 'accepted' as const,
        decisionMode: 'accepted' as const,
        riskLevel: 'high' as const,
        appliedTeamRevision: 5,
        appliedResponsibilityRevision: 2,
      },
      receipt: { commandId: 'command-2', auditEventId: 'audit-2', outboxId: 'outbox-2' },
    })))
    const controller = await renderPanel(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(projection([historical])))),
      decideSuggestedChange: decide,
    }))

    const section = document.querySelector('section[aria-labelledby="workbench-review-center-title"]')
    expect(section).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Review Center' }).id)
      .toBe('workbench-review-center-title')
    const statusFilter = screen.getByLabelText('建议状态')
    const riskFilter = screen.getByLabelText('风险等级')
    for (const name of ['待处理', '已接受', '已拒绝', '已延期', '已过期']) {
      expect(within(statusFilter).getByRole('option', { name })).toBeTruthy()
    }
    for (const name of ['低风险', '高风险']) {
      expect(within(riskFilter).getByRole('option', { name })).toBeTruthy()
    }
    expect(screen.getByLabelText('提案 Accountable')).toBeTruthy()
    expect(screen.getByRole('group', { name: '提案 Contributors' })).toBeTruthy()
    expect(screen.getByLabelText('提案 Human Sponsor')).toBeTruthy()
    expect(screen.getByRole('group', { name: '提案 Evidence' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('提案 Accountable'), {
      target: { value: 'external-1' },
    })
    expect(screen.getByText(/外部联系人作为 Accountable/u)).toBeTruthy()
    expect((screen.getByLabelText('提案 Human Sponsor') as HTMLSelectElement).required).toBe(true)

    const article = screen.getByRole('article', { name: '建议 #1' })
    expect(within(article).getAllByText('已延期').length).toBeGreaterThan(0)
    expect(within(article).getAllByText('高风险').length).toBeGreaterThan(0)
    expect(within(article).getByText('高风险必须逐条确认，不可批量处理。')).toBeTruthy()
    const diff = within(article).getByRole('table', { name: '建议差异' })
    expect(within(diff).getByRole('columnheader', { name: '变更前' })).toBeTruthy()
    expect(within(diff).getByRole('rowheader', { name: 'Accountable' })).toBeTruthy()
    expect(within(article).getByRole('heading', { name: '证据' })).toBeTruthy()
    expect(within(article).getByRole('heading', { name: '审核历史' })).toBeTruthy()
    expect(within(article).getByText('等待下一次项目核对。')).toBeTruthy()
    for (const name of ['接受', '编辑后接受', '拒绝', '延期']) {
      expect(within(article).getByRole('button', { name })).toBeTruthy()
    }

    const submit = within(article).getByRole('button', { name: '提交决定' }) as HTMLButtonElement
    fireEvent.change(within(article).getByLabelText('反馈原因'), {
      target: { value: '证据与责任影响已核对。' },
    })
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(article).getByLabelText('我已核对高风险差异与证据'))
    expect(submit.disabled).toBe(false)
    await act(async () => { fireEvent.click(submit) })
    expect(decide).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('creates a proposal from candidate plus Evidence and focuses the authoritative refreshed card', async () => {
    const proposed = suggestion('suggestion-2', 2, 'low')
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(projection([])))
      .mockResolvedValueOnce(ok(projection([proposed])))
    const propose = vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: {
        suggestedChangeId: 'suggestion-2',
        suggestedChangeRevision: 1 as const,
        targetAdapter: 'project-responsibility.replace' as const,
        baseTargetVersion: 4,
        persistedState: 'pending' as const,
        riskLevel: 'low' as const,
      },
      receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
    })))
    const controller = await renderPanel(remote({
      reviewCenter,
      proposeProjectResponsibilityChange: propose,
    }))

    const contributors = screen.getByRole('group', { name: '提案 Contributors' })
    fireEvent.click(within(contributors).getByRole('checkbox', {
      name: 'Sponsor Human · 人类 · human-2',
    }))
    const evidence = screen.getByRole('group', { name: '提案 Evidence' })
    fireEvent.click(within(evidence).getByRole('checkbox'))
    const submit = screen.getByRole('button', { name: '创建建议' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await act(async () => { fireEvent.click(submit) })

    expect(propose).toHaveBeenCalledWith(expect.objectContaining({
      candidate: {
        accountableMemberId: 'human-1',
        contributorMemberIds: ['human-2'],
        humanSponsorMemberId: null,
      },
      evidenceRefs: [{ kind: 'workbench-audit-event', auditEventId: 'audit-evidence-1' }],
    }), expect.any(AbortSignal))
    const heading = screen.getByRole('heading', { name: '建议 #2' })
    expect(document.activeElement).toBe(heading.closest('article'))
    await controller.dispose()
  })

  it('shows draft-aware low-to-high risk before an edited acceptance can be confirmed', async () => {
    const controller = await renderPanel(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(projection([
        suggestion('suggestion-low-to-high', 3, 'low'),
      ])))),
    }))
    const article = screen.getByRole('article', { name: '建议 #3' })
    expect(within(article).getByRole('heading', { name: '原建议风险依据' })).toBeTruthy()
    expect(within(article).getByText('仅 Contributor 集合发生变化。')).toBeTruthy()

    fireEvent.click(within(article).getByRole('button', { name: '编辑后接受' }))
    fireEvent.change(within(article).getByLabelText('编辑后的 Accountable'), {
      target: { value: 'agent-1' },
    })
    fireEvent.change(within(article).getByLabelText('编辑后的 Human Sponsor'), {
      target: { value: 'human-2' },
    })

    const effectiveRisk = within(article).getByText('本次决定有效风险：').parentElement
    const appliedRisk = within(article).getByText('编辑后候选风险：').parentElement
    expect(effectiveRisk?.textContent).toContain('高风险')
    expect(appliedRisk?.textContent).toContain('高风险')
    expect(within(article).getByText('Accountable 将发生变化。')).toBeTruthy()
    expect(within(article).getByText('Human Sponsor 将发生变化。')).toBeTruthy()

    const submit = within(article).getByRole('button', { name: '提交决定' }) as HTMLButtonElement
    fireEvent.change(within(article).getByLabelText('反馈原因'), {
      target: { value: '已核对编辑后的高风险责任变化。' },
    })
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(article).getByLabelText('我已核对高风险差异与证据'))
    expect(submit.disabled).toBe(false)
    await controller.dispose()
  })

  it('renders the exact applied risk, semantic before/after values, and digest in history', async () => {
    const original = suggestion('suggestion-applied-history', 4, 'low')
    const accepted: SuggestedChangeProjection = {
      ...original,
      revision: 2,
      target: {
        ...original.target,
        currentTeamRevision: 5,
        currentResponsibilityRevision: 2,
      },
      risk: {
        ...original.risk,
        effectiveLevel: 'high',
        batchPolicy: { policy: 'forbidden', reason: 'not-actionable' },
      },
      persistedState: 'accepted',
      effectiveStatus: 'accepted',
      decisions: [{
        decisionId: 'decision-edited-history',
        suggestedChangeRevision: 2,
        mode: 'edited-accepted',
        actor: { kind: 'owner', id: 'owner-1' },
        feedback: '最终采用 Agent Accountable，并保留人工 Sponsor。',
        appliedDiff: {
          kind: 'project-responsibility.diff',
          schemaVersion: 1,
          before: original.proposedDiff.before,
          after: {
            accountableMemberId: 'agent-1',
            contributorMemberIds: ['human-1'],
            humanSponsorMemberId: 'human-2',
          },
          changedFields: ['accountable', 'contributors', 'human-sponsor'],
          digest: `sha256:${'b'.repeat(64)}`,
        },
        appliedRiskLevel: 'high',
        appliedRiskReasonCodes: ['accountable-changed', 'human-sponsor-changed'],
        appliedTeamRevision: 5,
        appliedResponsibilityRevision: 2,
        causationId: 'cause-edited-history',
        receipt: {
          commandId: 'command-edited-history',
          auditEventId: 'audit-edited-history',
          outboxId: 'outbox-edited-history',
        },
        decidedAt: '2026-08-31T03:00:00.000Z',
      }],
      allowedDecisions: [],
      updatedAt: '2026-08-31T03:00:00.000Z',
    }
    const controller = await renderPanel(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(projection([accepted])))),
    }))
    const article = screen.getByRole('article', { name: '建议 #4' })
    const classification = within(article).getByLabelText('建议状态与风险')
    expect(within(classification).getByText('高风险')).toBeTruthy()
    const proposedRiskHeading = within(article).getByRole('heading', { name: '原建议风险依据' })
    const proposedRisk = proposedRiskHeading.closest('section')
    expect(proposedRisk).not.toBeNull()
    expect(within(proposedRisk!).getByText(/低风险/u)).toBeTruthy()
    expect(within(proposedRisk!).getByText('仅 Contributor 集合发生变化。')).toBeTruthy()
    expect(within(article).getByText('当前状态不可操作，因此不可批量处理。')).toBeTruthy()
    const appliedRisk = within(article).getByText('实际应用风险：').parentElement
    expect(appliedRisk?.textContent).toContain('高风险')
    const appliedDiff = within(article).getByRole('table', { name: '实际应用差异' })
    expect(within(appliedDiff).getByRole('rowheader', { name: 'Accountable' })).toBeTruthy()
    expect(within(appliedDiff).getAllByText('Owner Human · 人类 · human-1')).toHaveLength(2)
    expect(within(appliedDiff).getByText('Research Agent · Agent · agent-1')).toBeTruthy()
    expect(within(appliedDiff).getByText('Sponsor Human · 人类 · human-2')).toBeTruthy()
    expect(within(article).getByText(`sha256:${'b'.repeat(64)}`)).toBeTruthy()
    expect(within(article).getByText('Accountable 将发生变化。')).toBeTruthy()
    expect(within(article).getByText('Human Sponsor 将发生变化。')).toBeTruthy()
    await controller.dispose()
  })

  it('keeps a selected EvidenceRef inspectable when it leaves the recent builder window', async () => {
    const initial = projection([])
    const previousEvidence = initial.proposalBuilder.evidenceOptions[0]
    if (previousEvidence === undefined) throw new Error('expected proposal Evidence')
    const rotated: ReviewCenterProjection = {
      ...initial,
      proposalBuilder: {
        ...initial.proposalBuilder,
        evidenceOptions: [{
          ...previousEvidence,
          auditEventId: 'audit-evidence-new-window',
          occurredAt: '2026-08-31T04:00:00.000Z',
        }],
      },
    }
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(rotated))
    const controller = await renderPanel(remote({ reviewCenter }))
    fireEvent.click(within(screen.getByRole('group', { name: '提案 Contributors' }))
      .getByRole('checkbox', { name: 'Sponsor Human · 人类 · human-2' }))
    const evidenceGroup = screen.getByRole('group', { name: '提案 Evidence' })
    fireEvent.click(within(evidenceGroup).getByRole('checkbox'))
    expect(controller.canPropose()).toBe(true)

    await act(async () => { await controller.refresh() })
    expect(within(evidenceGroup).getByText('audit-evidence-1')).toBeTruthy()
    expect(within(evidenceGroup).getByText('audit-evidence-new-window')).toBeTruthy()
    expect(within(evidenceGroup).getByText(
      '已选；现已离开近期 Evidence 窗口，仍保留供本次提案核对。',
    )).toBeTruthy()
    expect((within(evidenceGroup).getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
    expect(controller.canPropose()).toBe(true)
    await controller.dispose()
  })

  it('blocks pagination while changed Review filters are still unapplied', async () => {
    const paged = { ...projection([suggestion('suggestion-page-1')]), nextBeforeSequence: 1 }
    const reviewCenter = vi.fn(() => Promise.resolve(ok(paged)))
    const controller = await renderPanel(remote({ reviewCenter }))
    const loadMore = screen.getByRole('button', { name: '加载更早的建议' }) as HTMLButtonElement
    expect(loadMore.disabled).toBe(false)

    fireEvent.change(screen.getByLabelText('建议状态'), { target: { value: 'accepted' } })
    expect(screen.getByText('筛选条件尚未应用；应用后才能继续加载更早的建议。')).toBeTruthy()
    expect(loadMore.disabled).toBe(true)
    fireEvent.click(loadMore)
    expect(reviewCenter).toHaveBeenCalledOnce()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    })
    expect(reviewCenter).toHaveBeenCalledTimes(2)
    expect(reviewCenter).toHaveBeenLastCalledWith({
      projectId: 'project-1', status: 'accepted', limit: 20,
    }, expect.any(AbortSignal))
    expect(screen.queryByText('筛选条件尚未应用；应用后才能继续加载更早的建议。'))
      .toBeNull()
    expect(loadMore.disabled).toBe(false)
    await controller.dispose()
  })

  it('keeps newly inactive proposal selections visible until the Owner repairs the refreshed draft', async () => {
    const initial = projection([])
    const refreshed = projectionWithInactiveDraftMembers([])
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(refreshed))
    const controller = await renderPanel(remote({ reviewCenter }))

    fireEvent.change(screen.getByLabelText('提案 Accountable'), {
      target: { value: 'agent-1' },
    })
    fireEvent.click(within(screen.getByRole('group', { name: '提案 Contributors' }))
      .getByRole('checkbox', { name: 'Owner Human · 人类 · human-1' }))
    fireEvent.change(screen.getByLabelText('提案 Human Sponsor'), {
      target: { value: 'human-2' },
    })
    fireEvent.click(within(screen.getByRole('group', { name: '提案 Evidence' }))
      .getByRole('checkbox'))

    await act(async () => { await controller.refresh() })

    const accountable = screen.getByLabelText('提案 Accountable') as HTMLSelectElement
    const contributors = screen.getByRole('group', { name: '提案 Contributors' })
    const sponsor = screen.getByLabelText('提案 Human Sponsor') as HTMLSelectElement
    expect(accountable.value).toBe('agent-1')
    expect((within(accountable).getByRole('option', {
      name: 'Research Agent · Agent · agent-1 · 已停用',
    }) as HTMLOptionElement).disabled).toBe(true)
    const inactiveContributor = within(contributors).getByRole('checkbox', {
      name: 'Owner Human · 人类 · human-1 · 已停用',
    }) as HTMLInputElement
    expect(inactiveContributor.checked).toBe(true)
    expect(inactiveContributor.disabled).toBe(false)
    expect(sponsor.value).toBe('human-2')
    expect((within(sponsor).getByRole('option', {
      name: 'Sponsor Human · 人类 · human-2 · 已停用',
    }) as HTMLOptionElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '创建建议' }) as HTMLButtonElement).disabled)
      .toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '采用最新 Team 基线' }))
    expect(controller.getSnapshot().proposalDraft.basedOnTeamRevision).toBe(5)
    fireEvent.click(inactiveContributor)
    expect(within(contributors).queryByRole('checkbox', { name: /human-1 · 已停用/u }))
      .toBeNull()
    fireEvent.change(accountable, { target: { value: 'external-1' } })
    fireEvent.change(sponsor, { target: { value: 'human-3' } })
    expect(within(accountable).queryByRole('option', { name: /agent-1 · 已停用/u }))
      .toBeNull()
    expect(within(sponsor).queryByRole('option', { name: /human-2 · 已停用/u }))
      .toBeNull()
    expect((screen.getByRole('button', { name: '创建建议' }) as HTMLButtonElement).disabled)
      .toBe(false)
    await controller.dispose()
  })

  it('keeps inactive edited-decision selections visible and removable without offering them again', async () => {
    const controller = await renderPanel(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(
        projectionWithInactiveDraftMembers([suggestion()]),
      ))),
    }))
    const article = screen.getByRole('article', { name: '建议 #1' })
    fireEvent.click(within(article).getByRole('button', { name: '编辑后接受' }))

    const accountable = within(article).getByLabelText('编辑后的 Accountable') as HTMLSelectElement
    const contributors = within(article).getByRole('group', { name: '编辑后的 Contributors' })
    const sponsor = within(article).getByLabelText('编辑后的 Human Sponsor') as HTMLSelectElement
    expect((within(accountable).getByRole('option', {
      name: 'Research Agent · Agent · agent-1 · 已停用',
    }) as HTMLOptionElement).disabled).toBe(true)
    const inactiveContributor = within(contributors).getByRole('checkbox', {
      name: 'Owner Human · 人类 · human-1 · 已停用',
    }) as HTMLInputElement
    expect(inactiveContributor.checked).toBe(true)
    expect(inactiveContributor.disabled).toBe(false)
    expect((within(sponsor).getByRole('option', {
      name: 'Sponsor Human · 人类 · human-2 · 已停用',
    }) as HTMLOptionElement).disabled).toBe(true)

    fireEvent.click(inactiveContributor)
    expect(within(contributors).queryByRole('checkbox', { name: /human-1 · 已停用/u }))
      .toBeNull()
    controller.setDecisionContributor('suggestion-1', 'human-1', true)
    expect(controller.getSnapshot().decisionDrafts['suggestion-1']?.candidate.contributorMemberIds)
      .not.toContain('human-1')
    fireEvent.change(accountable, { target: { value: 'external-1' } })
    fireEvent.change(sponsor, { target: { value: 'human-3' } })
    fireEvent.change(within(article).getByLabelText('反馈原因'), {
      target: { value: '已将停用成员替换为当前有效责任人。' },
    })
    fireEvent.click(within(article).getByLabelText('我已核对高风险差异与证据'))
    expect((within(article).getByRole('button', { name: '提交决定' }) as HTMLButtonElement)
      .disabled).toBe(false)
    await controller.dispose()
  })

  it('distinguishes same-name members in responsibility controls and semantic diffs', async () => {
    const original = projection([suggestion()])
    const sameNameSuggestion: SuggestedChangeProjection = {
      ...suggestion('suggestion-same-name', 9),
      proposedDiff: {
        ...suggestion().proposedDiff,
        before: {
          accountableMemberId: 'human-1',
          contributorMemberIds: [],
          humanSponsorMemberId: null,
        },
        after: {
          accountableMemberId: 'human-2',
          contributorMemberIds: [],
          humanSponsorMemberId: null,
        },
        changedFields: ['accountable'],
      },
    }
    const sameNames: ReviewCenterProjection = {
      ...original,
      proposalBuilder: {
        ...original.proposalBuilder,
        memberOptions: original.proposalBuilder.memberOptions.map(member =>
          member.memberId === 'human-1' || member.memberId === 'human-2'
            ? { ...member, displayName: 'Alex' }
            : member),
      },
      items: [sameNameSuggestion],
    }
    const controller = await renderPanel(remote({
      reviewCenter: vi.fn(() => Promise.resolve(ok(sameNames))),
    }))

    const proposalAccountable = screen.getByLabelText('提案 Accountable')
    expect(within(proposalAccountable).getByRole('option', {
      name: 'Alex · 人类 · human-1',
    })).toBeTruthy()
    expect(within(proposalAccountable).getByRole('option', {
      name: 'Alex · 人类 · human-2',
    })).toBeTruthy()
    const article = screen.getByRole('article', { name: '建议 #9' })
    const diff = within(article).getByRole('table', { name: '建议差异' })
    const row = within(diff).getByRole('row', { name: /Accountable/u })
    expect(within(row).getByText('Alex · 人类 · human-1')).toBeTruthy()
    expect(within(row).getByText('Alex · 人类 · human-2')).toBeTruthy()
    await controller.dispose()
  })

  it('disables old-cursor pagination while a full refresh is loading', async () => {
    const paged = { ...projection([suggestion('suggestion-old')]), nextBeforeSequence: 7 }
    let resolveRefresh!: (value: RemoteResult<ReviewCenterProjection | null>) => void
    const reviewCenter = vi.fn()
      .mockResolvedValueOnce(ok(paged))
      .mockImplementationOnce(() => new Promise(done => { resolveRefresh = done }))
    const controller = await renderPanel(remote({ reviewCenter }))
    const loadMore = screen.getByRole('button', { name: '加载更早的建议' }) as HTMLButtonElement
    expect(loadMore.disabled).toBe(false)

    let refreshing!: Promise<void>
    act(() => { refreshing = controller.refresh() })
    expect(loadMore.disabled).toBe(true)
    fireEvent.click(loadMore)
    expect(reviewCenter).toHaveBeenCalledTimes(2)

    resolveRefresh(ok(projection([suggestion('suggestion-current')])))
    await act(async () => { await refreshing })
    expect(screen.getByRole('article', { name: '建议 #1' })).toBeTruthy()
    expect(reviewCenter).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('keeps a bounded mobile layout and removes decorative motion when requested', async () => {
    const root = process.cwd().endsWith('workbench-client')
      ? process.cwd()
      : resolve(process.cwd(), 'packages/workbench-client')
    const source = await readFile(resolve(root, 'src/client/ReviewCenterPanel.module.css'), 'utf8')
    expect(source).toContain('min-width: 0')
    expect(source).toContain('overflow-x: auto')
    expect(source).toContain('@media (max-width: 760px)')
    expect(source).toContain('content: attr(data-label)')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toMatch(/\.panel\s*\{\s*animation:\s*none/u)
  })
})
