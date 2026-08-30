// @vitest-environment jsdom

import type {
  CreateProjectResult,
  ProjectDetailProjection,
  ProjectStartProjection,
  ProjectSummaryProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchProjectController,
  type WorkbenchProjectRemote,
} from '../src/client/project-controller.ts'
import { ProjectsPanel } from '../src/client/ProjectsPanel.tsx'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

const DIGEST = `sha256:${'a'.repeat(64)}` as const
const controllers: WorkbenchProjectController[] = []
const t = (key: WorkbenchKey): string => zh[key]

afterEach(async () => {
  cleanup()
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
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

function summary(sequence: number): ProjectSummaryProjection {
  return {
    projectId: `project-${sequence}`,
    name: `Project ${sequence}`,
    revision: 1,
    catalogSequence: sequence,
    timezone: 'Asia/Shanghai',
    createdAt: '2026-08-31T12:00:00.000Z',
    primaryGoal: {
      goalId: `goal-${sequence}`,
      name: `Goal ${sequence}`,
      revision: sequence,
    },
  }
}

function detail(sequence: number): ProjectDetailProjection {
  const project = summary(sequence)
  return {
    project,
    primaryGoal: {
      ...project.primaryGoal,
      outcomes: [{
        outcomeId: `outcome-${sequence}`,
        name: `Outcome ${sequence}`,
        revision: 1,
        metric: {
          metricName: 'Coverage',
          initialValue: 10,
          targetValue: 90,
          unit: '%',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: sequence === 3 ? [summary(1).primaryGoal] : [],
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
  return { template: template(), catalogRevision, projects, nextBeforeSequence }
}

function remote(overrides: Partial<WorkbenchProjectRemote> = {}): WorkbenchProjectRemote {
  return {
    projectStart: overrides.projectStart ?? vi.fn(() => Promise.resolve(ok(start()))),
    createProject: overrides.createProject ?? vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: detail(1),
      catalogRevision: 1,
      receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
    }))),
    project: overrides.project ?? vi.fn(query => Promise.resolve(ok(detail(Number(query.projectId.split('-')[1]))))),
  }
}

async function renderPanel(workbenchRemote: WorkbenchProjectRemote) {
  const controller = new WorkbenchProjectController(workbenchRemote)
  controllers.push(controller)
  const view = render(<ProjectsPanel controller={controller} t={t} />)
  await act(async () => { await controller.refresh() })
  return { controller, ...view }
}

function fillRequiredFields(): void {
  fireEvent.change(screen.getByLabelText('Project 名称'), { target: { value: 'Evidence Project' } })
  fireEvent.change(screen.getByLabelText('Primary Goal 名称'), { target: { value: 'Improve evidence' } })
  fireEvent.change(screen.getByLabelText('Outcome 名称'), { target: { value: 'Increase coverage' } })
  fireEvent.change(screen.getByLabelText('衡量指标'), { target: { value: 'Coverage' } })
  fireEvent.change(screen.getByLabelText('数值基线'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('数值目标'), { target: { value: '90' } })
  fireEvent.change(screen.getByLabelText('单位'), { target: { value: '%' } })
}

describe('ProjectsPanel', () => {
  it('renders labeled Project/Goal/Outcome fieldsets and rejects negative zero before Host submission', async () => {
    const createProject = vi.fn(() => Promise.resolve(ok({
      ok: true as const,
      value: detail(1),
      catalogRevision: 1,
      receipt: { commandId: 'command-1', auditEventId: 'audit-1', outboxId: 'outbox-1' },
    })))
    await renderPanel(remote({ createProject }))

    expect(screen.getByRole('heading', { name: 'Knowledge Work Template' })).toBeTruthy()
    expect(screen.getByText('Template Version')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Project' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Primary Goal' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Outcomes' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Supporting Goals（可选）' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '改善方向' })).toBeTruthy()
    const remove = screen.getByRole('button', { name: '移除 Outcome 1' }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)

    fillRequiredFields()
    const create = screen.getByRole('button', { name: '创建 Project' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('数值基线'), { target: { value: '-0' } })
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    expect(createProject).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('数值基线'), { target: { value: '0' } })
    expect(create.disabled).toBe(false)

    expect((screen.getByLabelText('Project 名称') as HTMLInputElement).maxLength).toBe(200)
    expect((screen.getByLabelText('Outcome 名称') as HTMLInputElement).maxLength).toBe(200)
    expect((screen.getByLabelText('衡量指标') as HTMLInputElement).maxLength).toBe(120)
    expect((screen.getByLabelText('单位') as HTMLInputElement).maxLength).toBe(64)
  })

  it('locks pending create, focuses the committed detail title, and clears every draft field', async () => {
    const pending = deferred<RemoteResult<CreateProjectResult>>()
    const createProject = vi.fn(() => pending.promise)
    await renderPanel(remote({ createProject }))
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: '创建 Project' }))
    fireEvent.click(screen.getByRole('button', { name: '正在创建…' }))
    expect(createProject).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '正在创建…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      pending.resolve(ok({
        ok: true,
        value: detail(3),
        catalogRevision: 3,
        receipt: { commandId: 'command-3', auditEventId: 'audit-3', outboxId: 'outbox-3' },
      }))
      await pending.promise
    })

    const detailTitle = screen.getByRole('heading', { name: 'Project 3', level: 3 })
    expect(document.activeElement).toBe(detailTitle)
    expect((screen.getByLabelText('Project 名称') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Primary Goal 名称') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Outcome 名称') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Project Template Snapshot')).toBeTruthy()
  })

  it('preserves all fields and exposes an accessible domain-conflict recovery action', async () => {
    await renderPanel(remote({
      createProject: vi.fn(() => Promise.resolve(ok({
        ok: false,
        error: {
          code: 'supporting-goal-conflict',
          message: 'raw goal detail must not render',
          goalId: 'goal-1',
          expectedRevision: 1,
          currentRevision: 2,
        },
      }))),
    }))
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: '创建 Project' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Supporting Goal 已发生变化')
    expect(alert.textContent).not.toContain('raw goal detail')
    expect(screen.getByRole('button', { name: '重新读取项目目录' })).toBeTruthy()
    expect((screen.getByLabelText('Project 名称') as HTMLInputElement).value).toBe('Evidence Project')
    expect((screen.getByLabelText('Outcome 名称') as HTMLInputElement).value).toBe('Increase coverage')
  })

  it('loads older Projects, makes their Goals selectable, opens detail, and focuses the fresh title', async () => {
    const projectStart = vi.fn()
      .mockResolvedValueOnce(ok(start([summary(3), summary(2)], 3, 2)))
      .mockResolvedValueOnce(ok(start([summary(1)], 3, null)))
    const project = vi.fn(() => Promise.resolve(ok(detail(1))))
    await renderPanel(remote({ projectStart, project }))

    fireEvent.click(screen.getByRole('button', { name: '加载更早的 Projects' }))
    expect(await screen.findByText(/已加载 1 个更早 Project/u)).toBeTruthy()
    expect(screen.getByText('Goal 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Goal 1/u }))
    expect((screen.getByRole('checkbox', { name: /Goal 1/u }) as HTMLInputElement).checked).toBe(true)

    const cards = screen.getAllByRole('button', { name: '打开 Project' })
    fireEvent.click(cards.at(-1) as HTMLButtonElement)
    const title = await screen.findByRole('heading', { name: 'Project 1', level: 3 })
    expect(document.activeElement).toBe(title)
    expect(project).toHaveBeenCalledWith({ projectId: 'project-1' }, expect.any(AbortSignal))
    expect(screen.getAllByText('Outcome 1').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Snapshot Schema Version')).toBeTruthy()
    expect(screen.getByText('允许 Supporting Goals')).toBeTruthy()
    expect(screen.getAllByText(DIGEST).length).toBeGreaterThanOrEqual(2)
  })

  it('disables add/select controls at the 20 Outcome and Supporting Goal limits with live guidance', async () => {
    const projects = Array.from({ length: 21 }, (_, index) => summary(21 - index))
    await renderPanel(remote({
      projectStart: vi.fn(() => Promise.resolve(ok(start(projects, 21)))),
    }))

    const add = screen.getByRole('button', { name: '添加 Outcome' }) as HTMLButtonElement
    for (let index = 1; index < 20; index += 1) fireEvent.click(add)
    expect(add.disabled).toBe(true)
    expect(screen.getByText(/最多 20 个 Outcomes/u)).toBeTruthy()

    const choices = screen.getAllByRole('checkbox') as HTMLInputElement[]
    for (const choice of choices.slice(0, 20)) fireEvent.click(choice)
    expect(choices[20]?.disabled).toBe(true)
    expect(screen.getByText(/最多 20 个 Supporting Goals/u)).toBeTruthy()
  })
})
