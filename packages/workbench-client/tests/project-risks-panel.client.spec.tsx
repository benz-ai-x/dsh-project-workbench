// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ProjectRiskAssessmentProjection,
  ProjectRiskProjection,
  ProjectRisksProjection,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRisksPanel } from '../src/client/ProjectRisksPanel.tsx'
import {
  WorkbenchProjectRisksController,
  type WorkbenchProjectRisksRemote,
} from '../src/client/project-risk-controller.ts'
import { en, zh, type WorkbenchKey } from '../src/client/locales.ts'

function ok<T>(value: T): RemoteResult<T> { return { ok: true, value } }

const receipt: WorkbenchCommandReceipt = {
  commandId: 'command-risk-1', auditEventId: 'audit-risk-1', outboxId: 'outbox-risk-1',
}

function task(taskGuid: string, summary: string) {
  return {
    taskGuid, taskId: taskGuid, scope: 'primary-list' as const, parentTaskGuid: null,
    summary, description: '', assignees: [], followers: [], comments: [], completed: false,
    completedAt: null, canonicalUrl: `https://applink.feishu.cn/${taskGuid}`,
    remoteVersion: `remote-${taskGuid}`, projectionRevision: 1,
  }
}

function assessment(): ProjectRiskAssessmentProjection {
  return {
    assessmentId: 'assessment-with-an-extremely-long-stable-identifier-1234567890', sequence: 2,
    statement: {
      condition: 'If the reviewer is unavailable', event: 'Review may start late',
      consequence: 'The release may miss its commitment',
    },
    category: 'schedule',
    trigger: {
      statement: 'Review has not started by the checkpoint', state: 'met',
      observedAt: '2026-09-01T02:00:00.000Z',
    },
    probability: { lowerBasisPoints: 1_500, upperBasisPoints: 3_000 },
    impact: { lowerBand: 2, upperBand: 4 }, confidence: 'medium',
    confidenceRationale: 'The reviewer confirmed limited capacity.',
    assessmentHorizonEnd: '2026-10-31', nextReviewOn: '2026-09-08',
    assumptions: ['No backup reviewer is assigned'],
    responsibility: {
      accountable: { memberId: 'human-1', displayName: 'Risk Owner', kind: 'human' },
      contributors: [{ memberId: 'agent-1', displayName: 'Risk Analyst', kind: 'agent' }],
      humanSponsor: null,
    },
    evidence: [{ kind: 'workbench-audit-event', auditEventId: 'audit-evidence-1' }],
    dependencies: [{ kind: 'depends-on', riskId: 'risk-dependency' }],
    mitigationTaskGuids: ['task-mitigation'], contingencyTaskGuids: ['task-contingency'],
    exposure: {
      policyVersion: 'project-risk-exposure-v1', likelihoodBand: 'P3',
      impactBand: 'I4', level: 'high',
    },
    digest: `sha256:${'a'.repeat(64)}`, assessedAt: '2026-09-01T02:00:00.000Z',
  }
}

function risk(status: ProjectRiskProjection['status'] = 'watch'): ProjectRiskProjection {
  return {
    riskId: 'risk-with-an-extremely-long-stable-identifier-1234567890', sequence: 2,
    revision: 4, status, closureReason: status === 'closed' ? 'no-longer-exists' : null,
    currentAssessment: assessment(),
    treatmentTasks: [
      {
        role: 'mitigation', taskGuid: 'task-mitigation', availability: 'available',
        task: task('task-mitigation', 'Prepare backup reviewer'),
      },
      {
        role: 'contingency', taskGuid: 'task-contingency', availability: 'unavailable', task: null,
      },
    ],
    createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z',
  }
}

function projection(selected = false, status: ProjectRiskProjection['status'] = 'watch'):
ProjectRisksProjection {
  const item = risk(status)
  return {
    projectId: 'project-1', revision: 7, teamRevision: 3, taskRevision: 5,
    risks: [item], nextBeforeRiskSequence: null,
    selectedRisk: selected ? {
      risk: item,
      history: [
        {
          kind: 'transition', sequence: 2,
          transition: {
            transitionId: 'transition-with-an-extremely-long-stable-identifier-1234567890',
            sequence: 1,
            fromStatus: status === 'closed' ? 'mitigate' : 'research',
            toStatus: status === 'closed' ? 'closed' : 'watch',
            rationale: 'Monitor the review checkpoint.',
            closureReason: status === 'closed' ? 'no-longer-exists' : null,
            occurredAt: '2026-09-01T01:30:00.000Z',
          },
          source: { kind: 'audit-event', auditEventId: 'audit-transition-1' },
          actor: { kind: 'owner', id: 'owner-1' }, causationId: 'cause-transition-1',
        },
        {
          kind: 'assessment', sequence: 1, assessment: item.currentAssessment,
          source: { kind: 'audit-event', auditEventId: 'audit-assessment-1' },
          actor: { kind: 'owner', id: 'owner-1' }, causationId: 'cause-assessment-1',
        },
      ],
      nextBeforeHistorySequence: null,
    } : null,
    activity: [{
      sequence: 2, activityId: 'risk-activity-2', riskId: item.riskId,
      riskRevision: 4, action: 'risk-revised', assessmentId: item.currentAssessment.assessmentId,
      transitionId: null, fromStatus: null, toStatus: status, rationale: null,
      closureReason: item.closureReason, actor: { kind: 'owner', id: 'owner-1' },
      auditEventId: 'audit-risk-2', causationId: 'cause-risk-2',
      occurredAt: '2026-09-01T02:00:00.000Z',
    }],
    nextBeforeActivitySequence: null,
    memberOptions: [
      {
        memberId: 'human-1', displayName: 'Risk Owner', kind: 'human', status: 'active',
        requiresHumanSponsor: false, canBeHumanSponsor: true,
      },
      {
        memberId: 'agent-1', displayName: 'Risk Analyst', kind: 'agent', status: 'active',
        requiresHumanSponsor: true, canBeHumanSponsor: false,
      },
    ],
    evidenceOptions: [{
      kind: 'workbench-audit-event', auditEventId: 'audit-evidence-1',
      occurredAt: '2026-08-31T12:00:00.000Z', summaryCode: 'project-created-from-template',
    }],
    dependencyOptions: [{
      riskId: 'risk-dependency', status: 'research',
      statement: { condition: null, event: 'Source may be delayed', consequence: 'Review starts late' },
      exposure: {
        policyVersion: 'project-risk-exposure-v1', likelihoodBand: 'P2',
        impactBand: 'I2', level: 'low',
      },
      selectable: true,
    }],
    taskOptions: [
      task('task-mitigation', 'Prepare backup reviewer'),
      task('task-contingency', 'Move release window'),
    ],
  }
}

function remote(status: ProjectRiskProjection['status'] = 'watch'): WorkbenchProjectRisksRemote {
  return {
    projectRisks: vi.fn(query => Promise.resolve(ok(projection(
      query.selectedRiskId !== undefined, status,
    )))),
    createProjectRisk: vi.fn(() => Promise.resolve(ok({
      ok: true as const, value: projection(false, status), risk: risk(status), receipt,
    }))),
    reviseProjectRisk: vi.fn(() => Promise.resolve(ok({
      ok: true as const, value: projection(false, status), risk: risk(status), receipt,
    }))),
    transitionProjectRisk: vi.fn(() => Promise.resolve(ok({
      ok: true as const, value: projection(false, status), risk: risk(status), receipt,
    }))),
  }
}

const t = (key: WorkbenchKey): string => zh[key]
afterEach(() => { cleanup() })

describe('ProjectRisksPanel', () => {
  it('renders a register-first five-filter surface and explains exposure without color alone', async () => {
    const workbenchRemote = remote()
    const controller = new WorkbenchProjectRisksController(workbenchRemote)
    render(<ProjectRisksPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })

    const panel = screen.getByRole('region', { name: zh['risks.title'] })
    expect(panel.getAttribute('aria-labelledby')).toBe('workbench-project-risks-title')
    const filters = within(panel).getByRole('form', { name: zh['risks.filters.legend'] })
    expect(within(filters).getByLabelText(zh['risks.filters.exposure'])).toBeTruthy()
    expect(within(filters).getByLabelText(zh['risks.filters.status'])).toBeTruthy()
    expect(within(filters).getByLabelText(zh['risks.filters.owner'])).toBeTruthy()
    expect(within(filters).getByRole('group', { name: zh['risks.filters.trigger'] })).toBeTruthy()
    expect(within(filters).getByRole('group', { name: zh['risks.filters.review'] })).toBeTruthy()
    fireEvent.change(within(filters).getByLabelText(zh['risks.filters.exposure']), {
      target: { value: 'high' },
    })
    fireEvent.change(within(filters).getByLabelText(zh['risks.filters.triggerText']), {
      target: { value: 'checkpoint' },
    })
    await act(async () => { fireEvent.submit(filters) })
    expect(workbenchRemote.projectRisks).toHaveBeenLastCalledWith(expect.objectContaining({
      exposure: 'high', triggerContains: 'checkpoint',
    }), expect.any(AbortSignal))

    const card = screen.getByRole('article', { name: 'Review may start late' })
    expect(within(card).getByText('The release may miss its commitment')).toBeTruthy()
    expect(within(card).getByText(zh['risks.exposure.high'])).toBeTruthy()
    expect(within(card).getByText(zh['risks.exposure.likelihood.P3'])).toBeTruthy()
    expect(within(card).getByText(zh['risks.exposure.impact.I4'])).toBeTruthy()
    expect(within(card).getByText('project-risk-exposure-v1')).toBeTruthy()
    expect(within(card).getByText(zh['risks.confidence.medium'])).toBeTruthy()
    expect(within(card).getByText('Risk Owner')).toBeTruthy()
    expect(within(card).getByText('Review has not started by the checkpoint')).toBeTruthy()
    expect(within(card).getByText(zh['risks.trigger.state.met'])).toBeTruthy()
    expect(within(card).getByText('2026-09-08')).toBeTruthy()
    expect(within(card).getByRole('group', { name: zh['risks.tasks.mitigation'] })).toBeTruthy()
    expect(within(card).getByRole('group', { name: zh['risks.tasks.contingency'] })).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Prepare backup reviewer' })).toBeTruthy()
    expect(within(card).getByText(zh['risks.tasks.unavailable'])).toBeTruthy()
    await controller.dispose()
  })

  it('uses labeled native disclosures for complete drafts, trigger episodes, and selected history', async () => {
    const controller = new WorkbenchProjectRisksController(remote())
    render(<ProjectRisksPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })

    const create = screen.getByText(zh['risks.create.summary']).closest('details')
    expect(create?.tagName).toBe('DETAILS')
    const createForm = within(create as HTMLElement).getByRole('form', {
      name: zh['risks.create.legend'],
    })
    expect(within(createForm).getByLabelText(zh['risks.field.event'])).toBeTruthy()
    expect(within(createForm).getByLabelText(zh['risks.field.consequence'])).toBeTruthy()
    expect(within(createForm).getByLabelText(zh['risks.field.probabilityLower'])).toBeTruthy()
    expect(within(createForm).getByLabelText(zh['risks.field.impactUpper'])).toBeTruthy()
    expect(within(createForm).getByLabelText(zh['risks.field.horizon'])).toHaveProperty('type', 'date')
    expect(within(createForm).getByLabelText(zh['risks.field.nextReview'])).toHaveProperty('type', 'date')
    const owner = within(createForm).getByLabelText(zh['risks.field.owner'])
    const advanced = within(createForm).getByText(zh['risks.form.advanced']).closest('details')
    expect(advanced?.tagName).toBe('DETAILS')
    expect(advanced?.hasAttribute('open')).toBe(false)
    expect(advanced?.contains(owner)).toBe(false)
    expect(within(advanced as HTMLElement).getByRole('group', {
      name: zh['risks.tasks.mitigation'],
    })).toBeTruthy()
    expect(within(advanced as HTMLElement).getByRole('group', {
      name: zh['risks.tasks.contingency'],
    })).toBeTruthy()

    const card = screen.getByRole('article', { name: 'Review may start late' })
    fireEvent.click(within(card).getByRole('button', { name: zh['risks.action.revise'] }))
    expect(within(card).getByText(zh['risks.trigger.episodeHint'])).toBeTruthy()
    const transition = within(card).getByRole('form', { name: zh['risks.transition.legend'] })
    expect(within(transition).getByLabelText(zh['risks.transition.status'])).toBeTruthy()
    expect(within(transition).getByLabelText(zh['risks.transition.rationale'])).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: zh['risks.history.open'] }))
    })
    const historySummary = await screen.findByText(zh['risks.history.title'])
    expect(historySummary.tagName).toBe('SPAN')
    const history = historySummary.closest('details')
    expect(history?.tagName).toBe('DETAILS')
    const summary = history?.querySelector(':scope > summary')
    expect(summary?.contains(historySummary)).toBe(true)
    fireEvent.click(summary as HTMLElement)
    const assessmentEntry = history?.querySelector('details[data-history-kind="assessment"]')
    expect(assessmentEntry?.tagName).toBe('DETAILS')
    fireEvent.click(assessmentEntry!.querySelector(':scope > summary') as HTMLElement)
    const assessmentHistory = within(assessmentEntry as HTMLElement)
    expect(assessmentHistory.getByText(assessment().assessmentId)).toBeTruthy()
    expect(assessmentHistory.getByText('Review has not started by the checkpoint')).toBeTruthy()
    expect(assessmentHistory.getByText('Risk Owner')).toBeTruthy()
    expect(assessmentHistory.getByText('Risk Analyst')).toBeTruthy()
    expect(assessmentHistory.getByText('audit-evidence-1')).toBeTruthy()
    expect(assessmentHistory.getByText('risk-dependency')).toBeTruthy()
    expect(assessmentHistory.getByText('task-mitigation')).toBeTruthy()
    expect(assessmentHistory.getByText('task-contingency')).toBeTruthy()
    expect(assessmentHistory.getByText(assessment().digest)).toBeTruthy()
    expect(assessmentHistory.getAllByText('2026-09-01T02:00:00.000Z').length).toBeGreaterThan(0)
    expect(assessmentHistory.getByText('audit-assessment-1')).toBeTruthy()
    expect(assessmentHistory.getByText(zh['risks.actor.owner'])).toBeTruthy()
    expect(assessmentHistory.getByText('owner-1')).toBeTruthy()
    expect(assessmentHistory.getByText('cause-assessment-1')).toBeTruthy()

    const transitionEntry = history?.querySelector('details[data-history-kind="transition"]')
    expect(transitionEntry?.tagName).toBe('DETAILS')
    fireEvent.click(transitionEntry!.querySelector(':scope > summary') as HTMLElement)
    const transitionHistory = within(transitionEntry as HTMLElement)
    expect(transitionHistory.getByText('Monitor the review checkpoint.')).toBeTruthy()
    expect(transitionHistory.getByText('2026-09-01T01:30:00.000Z')).toBeTruthy()
    expect(transitionHistory.getByText('audit-transition-1')).toBeTruthy()

    const packageRoot = process.cwd().endsWith('packages/workbench-client')
      ? process.cwd() : resolve(process.cwd(), 'packages/workbench-client')
    const styles = await readFile(resolve(packageRoot, 'src/client/ProjectRisksPanel.module.css'), 'utf8')
    expect(styles).toContain('@media (max-width: 640px)')
    expect(styles).toMatch(/overflow-wrap:\s*anywhere/u)
    expect(styles).toMatch(/min-width:\s*0/u)
    expect(en['risks.title']).toBe('Project Risks')
    await controller.dispose()
  })

  it('renders terminal closure text and removes every revise/transition affordance', async () => {
    const controller = new WorkbenchProjectRisksController(remote('closed'))
    render(<ProjectRisksPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })

    const card = screen.getByRole('article', { name: 'Review may start late' })
    expect(within(card).getByText(zh['risks.status.closed'])).toBeTruthy()
    expect(within(card).getByText(zh['risks.closure.noLongerExists'])).toBeTruthy()
    expect(within(card).queryByRole('button', { name: zh['risks.action.revise'] })).toBeNull()
    expect(within(card).queryByRole('form', { name: zh['risks.transition.legend'] })).toBeNull()
    expect(within(card).getByText(zh['risks.closed.terminal'])).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: zh['risks.history.open'] }))
    })
    const historySummary = await screen.findByText(zh['risks.history.title'])
    const history = historySummary.closest('details')
    fireEvent.click(history!.querySelector(':scope > summary') as HTMLElement)
    const transitionEntry = history!.querySelector('details[data-history-kind="transition"]')
    fireEvent.click(transitionEntry!.querySelector(':scope > summary') as HTMLElement)
    expect(within(transitionEntry as HTMLElement).getByText(zh['risks.closure.noLongerExists']))
      .toBeTruthy()
    expect(within(transitionEntry as HTMLElement).getByText('2026-09-01T01:30:00.000Z'))
      .toBeTruthy()
    await controller.dispose()
  })

  it('keeps exact retry visible after a same-Owner reconnect clears the transport issue', async () => {
    const workbenchRemote = remote()
    const revise = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable' } })
      .mockResolvedValueOnce(ok({
        ok: true as const, value: projection(), risk: risk(), receipt,
      }))
    workbenchRemote.reviseProjectRisk = revise
    const controller = new WorkbenchProjectRisksController(workbenchRemote)
    render(<ProjectRisksPanel controller={controller} t={t} />)
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })
    controller.beginRevision(risk().riskId)
    await act(async () => { await controller.revise() })
    const exactRequest = revise.mock.calls[0]?.[0]

    const filters = screen.getByRole('form', { name: zh['risks.filters.legend'] })
    expect(within(filters).getByRole('group', {
      name: zh['risks.filters.legend'],
    })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', {
      name: zh['risks.retryExact'],
    })).toHaveProperty('disabled', false)
    const createForm = screen.getByRole('form', { name: zh['risks.create.legend'] })
    expect(within(createForm).getByRole('group', {
      name: zh['risks.create.legend'],
    })).toHaveProperty('disabled', true)
    const card = screen.getByRole('article', { name: 'Review may start late' })
    expect(within(card).getByRole('button', {
      name: zh['risks.action.revise'],
    })).toHaveProperty('disabled', true)
    const reviseForm = within(card).getByRole('form', { name: zh['risks.revise.legend'] })
    expect(within(reviseForm).getByRole('group', {
      name: zh['risks.revise.legend'],
    })).toHaveProperty('disabled', true)
    const transitionForm = within(card).getByRole('form', { name: zh['risks.transition.legend'] })
    expect(within(transitionForm).getByRole('group', {
      name: zh['risks.transition.legend'],
    })).toHaveProperty('disabled', true)

    act(() => { controller.markDisconnected() })
    await act(async () => { await controller.connectionReset() })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', issue: null, canRetryMutation: true,
    })
    const retry = screen.getByRole('button', { name: zh['risks.retryExact'] })
    await act(async () => { fireEvent.click(retry) })

    expect(revise).toHaveBeenCalledTimes(2)
    expect(revise.mock.calls[1]?.[0]).toBe(exactRequest)
    await controller.dispose()
  })
})
