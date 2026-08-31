import type {
  CreateProjectRiskResult,
  ProjectRiskAssessmentProjection,
  ProjectRiskProjection,
  ProjectRisksProjection,
  ReviseProjectRiskResult,
  TransitionProjectRiskResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_PROJECT_RISKS_STATE,
  WorkbenchProjectRisksController,
  type WorkbenchProjectRiskAssessmentEditorDraft,
  type WorkbenchProjectRisksRemote,
} from '../src/client/project-risk-controller.ts'

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

function assessment(
  overrides: Partial<ProjectRiskAssessmentProjection> = {},
): ProjectRiskAssessmentProjection {
  return {
    assessmentId: 'assessment-1', sequence: 1,
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
    impact: { lowerBand: 2, upperBand: 4 },
    confidence: 'medium', confidenceRationale: 'The reviewer confirmed limited capacity.',
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
    ...overrides,
  }
}

function risk(overrides: Partial<ProjectRiskProjection> = {}): ProjectRiskProjection {
  const currentAssessment = assessment()
  return {
    riskId: 'risk-1', sequence: 2, revision: 4, status: 'watch', closureReason: null,
    currentAssessment,
    treatmentTasks: [
      {
        role: 'mitigation', taskGuid: 'task-mitigation', availability: 'available',
        task: task('task-mitigation', 'Prepare backup reviewer'),
      },
      {
        role: 'contingency', taskGuid: 'task-contingency', availability: 'available',
        task: task('task-contingency', 'Move release window'),
      },
    ],
    createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  }
}

function projection(
  projectId = 'project-1',
  overrides: Partial<ProjectRisksProjection> = {},
): ProjectRisksProjection {
  const item = risk()
  return {
    projectId, revision: 7, teamRevision: 3, taskRevision: 5, risks: [item],
    nextBeforeRiskSequence: null, selectedRisk: null,
    activity: [{
      sequence: 2, activityId: 'risk-activity-2', riskId: item.riskId,
      riskRevision: item.revision, action: 'risk-revised',
      assessmentId: item.currentAssessment.assessmentId, transitionId: null,
      fromStatus: null, toStatus: item.status, rationale: null, closureReason: null,
      actor: { kind: 'owner', id: 'owner-1' }, auditEventId: 'audit-risk-2',
      causationId: 'cause-risk-2', occurredAt: '2026-09-01T02:00:00.000Z',
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
      {
        memberId: 'human-sponsor', displayName: 'Human Sponsor', kind: 'human', status: 'active',
        requiresHumanSponsor: false, canBeHumanSponsor: true,
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
    ...overrides,
  }
}

function selectedProjection(): ProjectRisksProjection {
  const value = projection()
  const item = value.risks[0]!
  return {
    ...value,
    selectedRisk: {
      risk: item,
      history: [
        {
          kind: 'transition', sequence: 2,
          transition: {
            transitionId: 'transition-1', sequence: 1, fromStatus: 'research', toStatus: 'watch',
            rationale: 'Monitor the review checkpoint.', closureReason: null,
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
      nextBeforeHistorySequence: 1,
    },
  }
}

function editorDraft(): WorkbenchProjectRiskAssessmentEditorDraft {
  return {
    condition: 'If the reviewer is unavailable', event: 'Review may start late',
    consequence: 'The release may miss its commitment', category: 'schedule',
    triggerStatement: 'Review has not started by the checkpoint', triggerState: 'met',
    probabilityLowerBasisPoints: '1500', probabilityUpperBasisPoints: '3000',
    impactLowerBand: '2', impactUpperBand: '4', confidence: 'medium',
    confidenceRationale: 'The reviewer confirmed limited capacity.',
    assessmentHorizonEnd: '2026-10-31', nextReviewOn: '2026-09-08',
    assumptions: ['No backup reviewer is assigned'], accountableMemberId: 'human-1',
    contributorMemberIds: ['agent-1'], humanSponsorMemberId: '',
    evidence: [{ kind: 'workbench-audit-event', auditEventId: 'audit-evidence-1' }],
    dependencyRiskIds: ['risk-dependency'], mitigationTaskGuids: ['task-mitigation'],
    contingencyTaskGuids: ['task-contingency'],
  }
}

function createSuccess(value = projection()): CreateProjectRiskResult {
  return { ok: true, value, risk: risk(), receipt }
}
function reviseSuccess(value = projection()): ReviseProjectRiskResult {
  return { ok: true, value, risk: risk(), receipt }
}
function transitionSuccess(value = projection()): TransitionProjectRiskResult {
  return { ok: true, value, risk: risk(), receipt }
}

function makeRemote(overrides: Partial<WorkbenchProjectRisksRemote> = {}): WorkbenchProjectRisksRemote {
  return {
    projectRisks: overrides.projectRisks
      ?? vi.fn(query => Promise.resolve(ok(query.selectedRiskId === undefined
        ? projection(query.projectId)
        : selectedProjection()))),
    createProjectRisk: overrides.createProjectRisk
      ?? vi.fn(() => Promise.resolve(ok(createSuccess()))),
    reviseProjectRisk: overrides.reviseProjectRisk
      ?? vi.fn(() => Promise.resolve(ok(reviseSuccess()))),
    transitionProjectRisk: overrides.transitionProjectRisk
      ?? vi.fn(() => Promise.resolve(ok(transitionSuccess()))),
  }
}

function keys() {
  const values = ['idem-1', 'cause-1', 'idem-2', 'cause-2', 'idem-3', 'cause-3']
  return () => values.shift() ?? 'unexpected'
}

describe('WorkbenchProjectRisksController', () => {
  it('applies all five conjunctive filters and pages register, activity, and selected history independently', async () => {
    const read = vi.fn(query => Promise.resolve(ok(query.selectedRiskId === undefined
      ? projection(query.projectId)
      : selectedProjection())))
    const controller = new WorkbenchProjectRisksController(makeRemote({ projectRisks: read }))
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setFilters({
      exposure: 'high', status: 'watch', riskOwnerMemberId: 'human-1',
      triggerState: 'met', triggerContains: ' checkpoint ',
      reviewFrom: '2026-09-01', reviewTo: '2026-09-30',
    })
    await controller.applyFilters()
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: 'project-1', exposure: 'high', status: 'watch',
      riskOwnerMemberId: 'human-1', triggerState: 'met', triggerContains: 'checkpoint',
      reviewFrom: '2026-09-01', reviewTo: '2026-09-30',
    }), expect.any(AbortSignal))

    await controller.selectRisk('risk-1')
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedRiskId: 'risk-1', historyLimit: 50,
    }), expect.any(AbortSignal))
    await controller.loadMoreRisks()
    await controller.loadMoreActivity()
    await controller.loadMoreHistory()
    expect(read.mock.calls.some(([query]) => query.beforeHistorySequence === 1
      && query.selectedRiskId === 'risk-1')).toBe(true)

    controller.setCreateDraft(editorDraft())
    await controller.selectProject('project-2', 'Second Project')
    expect(controller.getSnapshot()).toMatchObject({
      selection: { projectId: 'project-2' }, createDraft: { event: '' },
      revisionDraft: null, transitionDrafts: {}, selectedRiskId: null,
    })
    controller.clearSelection()
    expect(controller.getSnapshot()).toEqual(INITIAL_WORKBENCH_PROJECT_RISKS_STATE)
    await controller.dispose()
  })

  it('submits one complete assessment and fences a duplicate before rerender', async () => {
    let release!: (value: RemoteResult<CreateProjectRiskResult>) => void
    const create = vi.fn(() => new Promise<RemoteResult<CreateProjectRiskResult>>(resolve => {
      release = resolve
    }))
    const controller = new WorkbenchProjectRisksController(makeRemote({ createProjectRisk: create }), {
      nextCommandKey: keys(),
    })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setCreateDraft(editorDraft())

    const first = controller.create()
    const duplicate = controller.create()
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', assessment: {
        statement: {
          condition: 'If the reviewer is unavailable', event: 'Review may start late',
          consequence: 'The release may miss its commitment',
        },
        category: 'schedule',
        trigger: { statement: 'Review has not started by the checkpoint', state: 'met' },
        probability: { lowerBasisPoints: 1500, upperBasisPoints: 3000 },
        impact: { lowerBand: 2, upperBand: 4 }, confidence: 'medium',
        confidenceRationale: 'The reviewer confirmed limited capacity.',
        assessmentHorizonEnd: '2026-10-31', nextReviewOn: '2026-09-08',
        assumptions: ['No backup reviewer is assigned'], accountableMemberId: 'human-1',
        contributorMemberIds: ['agent-1'], humanSponsorMemberId: null,
        evidence: [{ kind: 'workbench-audit-event', auditEventId: 'audit-evidence-1' }],
        dependencies: [{ kind: 'depends-on', riskId: 'risk-dependency' }],
        mitigationTaskGuids: ['task-mitigation'], contingencyTaskGuids: ['task-contingency'],
      },
      expectedRisksRevision: 7, expectedRiskRevision: null,
      expectedTeamRevision: 3, expectedTaskRevision: 5,
      idempotencyKey: 'idem-1', causationId: 'cause-1', reason: 'owner-project-risk-create',
    }), expect.any(AbortSignal))
    release(ok(createSuccess()))
    await Promise.all([first, duplicate])
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', createDraft: { event: '' }, focusRiskId: 'risk-1', focusEpoch: 1,
    })
    await controller.dispose()
  })

  it('prefills a complete revision, blocks closed mutation, and keeps trigger episodes Host-derived', async () => {
    const revise = vi.fn(() => Promise.resolve(ok(reviseSuccess())))
    const controller = new WorkbenchProjectRisksController(makeRemote({ reviseProjectRisk: revise }), {
      nextCommandKey: keys(),
    })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.beginRevision('risk-1')
    expect(controller.getSnapshot().revisionDraft).toMatchObject({
      riskId: 'risk-1', draft: {
        event: 'Review may start late', triggerState: 'met',
        mitigationTaskGuids: ['task-mitigation'], contingencyTaskGuids: ['task-contingency'],
      },
    })
    controller.setRevisionDraft({ ...editorDraft(), triggerStatement: 'A new met episode' })
    await controller.revise()
    expect(revise).toHaveBeenCalledWith(expect.objectContaining({
      riskId: 'risk-1', expectedRisksRevision: 7, expectedRiskRevision: 4,
      expectedTeamRevision: 3, expectedTaskRevision: 5,
      assessment: expect.objectContaining({
        trigger: { statement: 'A new met episode', state: 'met' },
      }),
    }), expect.any(AbortSignal))
    expect(revise.mock.calls[0]?.[0].assessment.trigger).not.toHaveProperty('observedAt')

    const closed = risk({ status: 'closed', closureReason: 'no-longer-exists' })
    const closedController = new WorkbenchProjectRisksController(makeRemote({
      projectRisks: vi.fn(() => Promise.resolve(ok(projection('project-1', { risks: [closed] })))),
      reviseProjectRisk: revise,
    }))
    await closedController.selectProject('project-1', 'Evidence Project')
    closedController.beginRevision('risk-1')
    expect(closedController.getSnapshot().revisionDraft).toBeNull()
    expect(closedController.canTransition('risk-1')).toBe(false)
    await closedController.dispose()
    await controller.dispose()
  })

  it('requires explicit transition rationale/closure reason and preserves an overdue conflict draft', async () => {
    const transition = vi.fn()
      .mockResolvedValueOnce(ok({
        ok: false as const,
        error: { code: 'risk-review-overdue' as const, message: 'private values omitted' },
      }))
      .mockResolvedValueOnce(ok(transitionSuccess()))
    const controller = new WorkbenchProjectRisksController(makeRemote({
      transitionProjectRisk: transition,
    }), { nextCommandKey: keys() })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setTransitionDraft('risk-1', {
      status: 'mitigate', rationale: 'Activate the visible mitigation task.', closureReason: '',
    })
    await controller.transition('risk-1')
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mitigate', rationale: 'Activate the visible mitigation task.',
      expectedRisksRevision: 7, expectedRiskRevision: 4, expectedTaskRevision: 5,
    }), expect.any(AbortSignal))
    expect(transition.mock.calls[0]?.[0]).not.toHaveProperty('closureReason')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict', issue: { code: 'risk-review-overdue' },
      transitionDrafts: { 'risk-1': { status: 'mitigate' } },
    })

    controller.setTransitionDraft('risk-1', {
      status: 'closed', rationale: 'The event can no longer occur.',
      closureReason: 'no-longer-exists',
    })
    await controller.transition('risk-1')
    expect(transition).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'closed', closureReason: 'no-longer-exists',
    }), expect.any(AbortSignal))
    expect(controller.getSnapshot().transitionDrafts['risk-1']).toBeUndefined()
    await controller.dispose()
  })

  it('retains only the exact ambiguous envelope, survives reconnect, and erases on disposal', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable' } })
      .mockResolvedValueOnce(ok(createSuccess(projection('project-1', { revision: 8 }))))
    const controller = new WorkbenchProjectRisksController(makeRemote({ createProjectRisk: create }), {
      nextCommandKey: keys(),
    })
    await controller.selectProject('project-1', 'Evidence Project')
    controller.setCreateDraft(editorDraft())
    await controller.create()
    const exactRequest = create.mock.calls[0]?.[0]
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error', projection: { revision: 7 }, canRetryMutation: true,
      createDraft: { event: 'Review may start late' },
    })
    controller.markDisconnected()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'stale', projection: { revision: 7 }, canRetryMutation: true,
    })
    await controller.retryMutation()
    expect(create.mock.calls[1]?.[0]).toBe(exactRequest)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', projection: { revision: 8 } })

    const disposal = controller.dispose()
    expect(controller.getSnapshot()).toEqual(INITIAL_WORKBENCH_PROJECT_RISKS_STATE)
    await disposal
  })
})
