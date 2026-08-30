import type {
  CreateProjectResult,
  ProjectDetailProjection,
  ProjectStartProjection,
  ProjectSummaryProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PROJECT_OUTCOME_COUNT,
  MAX_PROJECT_SUPPORTING_GOAL_COUNT,
  WorkbenchProjectController,
  type WorkbenchProjectRemote,
} from '../src/client/project-controller.ts'

const DIGEST = `sha256:${'a'.repeat(64)}` as const

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function template() {
  return {
    selection: {
      templateId: 'knowledge-work' as const,
      templateVersion: 1 as const,
      definitionDigest: DIGEST,
    },
    definition: {
      snapshotSchemaVersion: 1 as const,
      templateId: 'knowledge-work' as const,
      templateVersion: 1 as const,
      kind: 'knowledge-work' as const,
      rules: {
        minimumOutcomeCount: 1 as const,
        outcomeMetricRequired: true as const,
        primaryGoalRequired: true as const,
        supportingGoalsAllowed: true as const,
      },
      defaults: { projectTimezone: 'Asia/Shanghai' as const },
    },
  }
}

function summary(sequence: number, suffix = String(sequence)): ProjectSummaryProjection {
  return {
    projectId: `project-${suffix}`,
    name: `Project ${suffix}`,
    revision: 1,
    catalogSequence: sequence,
    timezone: 'Asia/Shanghai',
    createdAt: `2026-08-${String(Math.max(1, sequence)).padStart(2, '0')}T00:00:00.000Z`,
    primaryGoal: {
      goalId: `goal-${suffix}`,
      name: `Goal ${suffix}`,
      revision: sequence,
    },
  }
}

function detail(sequence = 3, suffix = String(sequence)): ProjectDetailProjection {
  const project = summary(sequence, suffix)
  return {
    project,
    primaryGoal: {
      ...project.primaryGoal,
      outcomes: [{
        outcomeId: `outcome-${suffix}`,
        name: `Outcome ${suffix}`,
        revision: 1,
        metric: {
          metricName: 'Coverage',
          initialValue: 10,
          targetValue: 20,
          unit: '%',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    templateSnapshot: {
      template: template().selection,
      snapshotSchemaVersion: 1,
      definition: template().definition,
      snapshotDigest: DIGEST,
      capturedAt: '2026-08-31T12:00:00.000Z',
    },
  }
}

function start(
  projects: readonly ProjectSummaryProjection[] = [],
  catalogRevision = projects.length,
  nextBeforeSequence: number | null = null,
): ProjectStartProjection {
  return {
    template: template(),
    catalogRevision,
    projects,
    nextBeforeSequence,
  }
}

function receipt(suffix = '1') {
  return {
    commandId: `command-${suffix}`,
    auditEventId: `audit-${suffix}`,
    outboxId: `outbox-${suffix}`,
  }
}

function remote(overrides: Partial<WorkbenchProjectRemote> = {}): WorkbenchProjectRemote {
  return {
    projectStart: overrides.projectStart ?? vi.fn(() => Promise.resolve(ok(start()))),
    createProject: overrides.createProject ?? vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: detail(),
      catalogRevision: 1,
      receipt: receipt(),
    }))),
    project: overrides.project ?? vi.fn(() => Promise.resolve(ok(detail()))),
  }
}

function completeDraft(controller: WorkbenchProjectController): void {
  const outcome = controller.getSnapshot().draft.outcomes[0]
  if (outcome === undefined) throw new Error('default Outcome missing')
  controller.setProjectName('  Evidence Project  ')
  controller.setPrimaryGoalName('  Improve evidence  ')
  controller.updateOutcome(outcome.key, {
    name: '  Increase evidence coverage  ',
    metricName: '  Coverage  ',
    initialValue: '10',
    targetValue: '90',
    unit: '  %  ',
    direction: 'increase',
  })
}

describe('WorkbenchProjectController', () => {
  it('starts with one non-removable Outcome and replaces loading with detached Host start truth', async () => {
    const source = start([summary(2)], 4, 1)
    const controller = new WorkbenchProjectController(remote({
      projectStart: vi.fn(() => Promise.resolve(ok(source))),
    }))

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'loading',
      start: null,
      draft: { outcomes: [{ direction: 'increase' }] },
    })
    const onlyKey = controller.getSnapshot().draft.outcomes[0]?.key ?? ''
    controller.removeOutcome(onlyKey)
    expect(controller.getSnapshot().draft.outcomes).toHaveLength(1)

    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      start: { catalogRevision: 4, projects: [{ projectId: 'project-2' }], nextBeforeSequence: 1 },
    })
    expect(controller.getSnapshot().start).not.toBe(source)
    expect(controller.getSnapshot().start?.projects).not.toBe(source.projects)
  })

  it('loads older Projects in descending order and submits their exact Primary Goal revision', async () => {
    const projectStart = vi.fn()
      .mockResolvedValueOnce(ok(start([summary(4), summary(3)], 4, 3)))
      .mockResolvedValueOnce(ok(start([summary(2), summary(1)], 4, null)))
    const createProject = vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: detail(5),
      catalogRevision: 5,
      receipt: receipt('5'),
    } satisfies CreateProjectResult)))
    const controller = new WorkbenchProjectController(remote({ projectStart, createProject }), {
      nextCommandKey: vi.fn()
        .mockReturnValueOnce('idempotency-project-5')
        .mockReturnValueOnce('causation-project-5'),
    })
    await controller.refresh()
    await controller.loadMore()
    expect(projectStart.mock.calls[1]?.[0]).toEqual({ beforeSequence: 3, limit: 20 })
    expect(controller.getSnapshot().start?.projects.map(project => project.catalogSequence))
      .toEqual([4, 3, 2, 1])

    const oldProject = controller.getSnapshot().start?.projects.at(-1)
    if (oldProject === undefined) throw new Error('older Project missing')
    controller.setSupportingGoal(oldProject, true)
    completeDraft(controller)
    await controller.create()

    expect(createProject).toHaveBeenCalledWith({
      template: template().selection,
      projectName: 'Evidence Project',
      primaryGoal: {
        name: 'Improve evidence',
        outcomes: [{
          name: 'Increase evidence coverage',
          metric: {
            metricName: 'Coverage',
            initialValue: 10,
            targetValue: 90,
            unit: '%',
            direction: 'increase',
          },
        }],
      },
      supportingGoals: [{ goalId: 'goal-1', expectedRevision: 1 }],
      expectedCatalogRevision: 4,
      expectedRevision: null,
      idempotencyKey: 'idempotency-project-5',
      causationId: 'causation-project-5',
      reason: 'owner-project-create',
    }, expect.any(AbortSignal))
  })

  it('locks duplicate creates, adopts success, focuses detail, clears the full draft, and reports the receipt', async () => {
    const pending = deferred<RemoteResult<CreateProjectResult>>()
    const createProject = vi.fn(() => pending.promise)
    const onCommitted = vi.fn()
    const controller = new WorkbenchProjectController(remote({ createProject }), { onCommitted })
    await controller.refresh()
    completeDraft(controller)

    const first = controller.create()
    const duplicate = controller.create()
    expect(createProject).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'pending', pending: true })
    pending.resolve(ok({
      ok: true,
      value: detail(1),
      catalogRevision: 1,
      receipt: receipt('created'),
    }))
    await Promise.all([first, duplicate])

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      pending: false,
      detail: { project: { projectId: 'project-1' } },
      draft: {
        projectName: '',
        primaryGoalName: '',
        outcomes: [{ name: '', metricName: '', initialValue: '', targetValue: '', unit: '' }],
        supportingGoals: [],
      },
      draftDirty: false,
      detailFocusEpoch: 1,
    })
    expect(onCommitted).toHaveBeenCalledWith(receipt('created'))
  })

  it('replays the identical create envelope after response loss and a newer catalog refresh', async () => {
    const committed = detail(2)
    const projectStart = vi.fn()
      .mockResolvedValueOnce(ok(start([], 1)))
      .mockResolvedValueOnce(ok(start([committed.project], 2)))
    const createProject = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'unavailable', message: 'response lost', details: { secret: 'never retain' } },
      })
      .mockResolvedValueOnce(ok({
        ok: true,
        value: committed,
        catalogRevision: 2,
        receipt: receipt('replayed'),
      } satisfies CreateProjectResult))
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('idempotency-response-loss')
      .mockReturnValueOnce('causation-response-loss')
    const controller = new WorkbenchProjectController(remote({ projectStart, createProject }), {
      nextCommandKey,
    })
    await controller.refresh()
    completeDraft(controller)

    await controller.create()
    const original = createProject.mock.calls[0]?.[0]
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      draftDirty: true,
      issue: { kind: 'transport', code: 'unavailable' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('never retain')

    await controller.connectionReset()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      start: { catalogRevision: 2 },
      draft: { projectName: '  Evidence Project  ' },
    })
    expect(controller.canCreate()).toBe(true)
    await controller.create()

    expect(createProject).toHaveBeenCalledTimes(2)
    expect(createProject.mock.calls[1]?.[0]).toEqual(original)
    expect(original).toMatchObject({ expectedCatalogRevision: 1 })
    expect(nextCommandKey).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().draft.projectName).toBe('')
  })

  it.each([
    ['idempotency-conflict', { code: 'idempotency-conflict', message: 'private' }],
    ['catalog-revision-conflict', {
      code: 'catalog-revision-conflict', message: 'private', expectedCatalogRevision: 1, currentCatalogRevision: 2,
    }],
    ['supporting-goal-conflict', {
      code: 'supporting-goal-conflict', message: 'private', goalId: 'goal-old', expectedRevision: 1, currentRevision: 2,
    }],
    ['template-version-conflict', {
      code: 'template-version-conflict', message: 'private', current: template().selection,
    }],
  ] as const)('keeps the complete draft on %s without retaining Host diagnostics', async (code, error) => {
    const controller = new WorkbenchProjectController(remote({
      projectStart: vi.fn(() => Promise.resolve(ok(start([summary(1)], 1)))),
      createProject: vi.fn(() => Promise.resolve(ok({ ok: false, error } as CreateProjectResult))),
    }))
    await controller.refresh()
    controller.setSupportingGoal(summary(1), true)
    completeDraft(controller)
    const before = controller.getSnapshot().draft

    await controller.create()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      draft: before,
      draftDirty: true,
      issue: { kind: 'conflict', code },
    })
    expect(controller.getSnapshot().draft.supportingGoals).toEqual(before.supportingGoals)
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private')
  })

  it('rejects negative zero, control characters, overlong/count overflow, and enforces both 20-item caps', async () => {
    const projects = Array.from({ length: 21 }, (_, index) => summary(30 - index, String(index + 1)))
    const controller = new WorkbenchProjectController(remote({
      projectStart: vi.fn(() => Promise.resolve(ok(start(projects, 30)))),
    }))
    await controller.refresh()
    completeDraft(controller)
    const first = controller.getSnapshot().draft.outcomes[0]
    if (first === undefined) throw new Error('default Outcome missing')

    controller.updateOutcome(first.key, { initialValue: '-0' })
    expect(controller.canCreate()).toBe(false)
    controller.updateOutcome(first.key, { initialValue: '0' })
    expect(controller.canCreate()).toBe(true)
    controller.setProjectName(`bad\u0000name`)
    expect(controller.canCreate()).toBe(false)
    controller.setProjectName(`bad\ud800name`)
    expect(controller.canCreate()).toBe(false)
    controller.setProjectName('x'.repeat(201))
    expect(controller.canCreate()).toBe(false)
    controller.setProjectName('Evidence Project')
    controller.setPrimaryGoalName(`bad\ud800goal`)
    expect(controller.canCreate()).toBe(false)
    controller.setPrimaryGoalName('Improve evidence')
    controller.updateOutcome(first.key, { name: 'x'.repeat(201) })
    expect(controller.canCreate()).toBe(false)
    controller.updateOutcome(first.key, { name: 'Increase coverage', metricName: 'x'.repeat(121) })
    expect(controller.canCreate()).toBe(false)
    controller.updateOutcome(first.key, { metricName: 'Coverage', unit: 'x'.repeat(65) })
    expect(controller.canCreate()).toBe(false)
    controller.updateOutcome(first.key, { unit: '%' })
    expect(controller.canCreate()).toBe(true)

    for (let index = 1; index < MAX_PROJECT_OUTCOME_COUNT + 3; index += 1) {
      controller.addOutcome()
    }
    expect(controller.getSnapshot().draft.outcomes).toHaveLength(MAX_PROJECT_OUTCOME_COUNT)
    for (const project of projects) controller.setSupportingGoal(project, true)
    expect(controller.getSnapshot().draft.supportingGoals)
      .toHaveLength(MAX_PROJECT_SUPPORTING_GOAL_COUNT)
  })

  it('fences superseded detail queries, reopens the selected Project after reset, and drains disposal', async () => {
    const old = deferred<RemoteResult<ProjectDetailProjection | null>>()
    const draining = deferred<RemoteResult<ProjectDetailProjection | null>>()
    let oldSignal: AbortSignal | undefined
    let drainingSignal: AbortSignal | undefined
    const project = vi.fn()
      .mockImplementationOnce((_query, signal?: AbortSignal) => {
        oldSignal = signal
        return old.promise
      })
      .mockResolvedValueOnce(ok(detail(2)))
      .mockResolvedValueOnce(ok(detail(2)))
      .mockImplementationOnce((_query, signal?: AbortSignal) => {
        drainingSignal = signal
        signal?.addEventListener('abort', () => draining.resolve(ok(detail(9))), { once: true })
        return draining.promise
      })
    const controller = new WorkbenchProjectController(remote({
      projectStart: vi.fn(() => Promise.resolve(ok(start([summary(2), summary(1)], 2)))),
      project,
    }))
    await controller.refresh()

    const oldOpen = controller.openProject('project-1')
    const currentOpen = controller.openProject('project-2')
    expect(oldSignal?.aborted).toBe(true)
    await currentOpen
    old.resolve(ok(detail(1)))
    await oldOpen
    expect(controller.getSnapshot().detail?.project.projectId).toBe('project-2')

    await controller.connectionReset()
    expect(project.mock.calls[2]?.[0]).toEqual({ projectId: 'project-2' })
    expect(controller.getSnapshot().detail?.project.projectId).toBe('project-2')

    const opening = controller.openProject('project-9')
    const disposal = controller.dispose()
    expect(drainingSignal?.aborted).toBe(true)
    await Promise.all([opening, disposal])
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      phase: 'loading',
      start: null,
      detail: null,
      draft: expect.objectContaining({ projectName: '', primaryGoalName: '' }),
    }))
  })

  it('bounds unknown transport codes to one safe fallback', async () => {
    const controller = new WorkbenchProjectController(remote({
      projectStart: vi.fn(() => Promise.resolve({
        ok: false,
        error: { code: 'Bearer-secret-raw', message: 'TOP SECRET', details: { token: 'TOP SECRET' } },
      })),
    }))
    await controller.refresh()
    expect(controller.getSnapshot().issue).toEqual({ kind: 'transport', code: 'transport-failure' })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('TOP SECRET')
  })
})
