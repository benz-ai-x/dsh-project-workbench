// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  AddProjectMemberResult,
  ProjectMemberProjection,
  ProjectTeamProjection,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectTeamPanel } from '../src/client/ProjectTeamPanel.tsx'
import {
  WorkbenchProjectTeamController,
  type WorkbenchProjectTeamRemote,
} from '../src/client/project-team-controller.ts'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

const t = (key: WorkbenchKey): string => zh[key]
const controllers: WorkbenchProjectTeamController[] = []

afterEach(async () => {
  cleanup()
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
})

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function memberBase(memberId: string) {
  return {
    memberId,
    projectId: 'project-1',
    status: 'active' as const,
    revision: 1,
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

function feishu(memberId = 'member-human'): ProjectMemberProjection {
  return {
    ...memberBase(memberId),
    kind: 'human',
    displayName: memberId === 'member-sponsor' ? 'Sponsor Human' : 'Feishu Human',
    identity: {
      type: 'feishu',
      appId: 'cli_app1',
      openId: `ou_${memberId}`,
      state: 'declared',
    },
    feishuAssigneeEligibility: 'identifier-present',
  }
}

function external(memberId = 'member-external'): ProjectMemberProjection {
  return {
    ...memberBase(memberId),
    kind: 'human',
    displayName: 'External Human',
    identity: { type: 'external', method: 'email', value: 'external@example.test' },
    feishuAssigneeEligibility: 'external-contact',
  }
}

function agent(memberId = 'member-agent'): ProjectMemberProjection {
  return {
    ...memberBase(memberId),
    kind: 'agent',
    displayName: 'Research Agent',
    feishuAssigneeEligibility: 'agent-not-assignable',
  }
}

function inactive(memberId = 'member-inactive'): ProjectMemberProjection {
  return {
    ...external(memberId),
    displayName: 'Inactive Human',
    status: 'inactive',
    revision: 2,
    feishuAssigneeEligibility: 'inactive',
  }
}

function team(
  members: readonly ProjectMemberProjection[] = [],
  teamRevision = 0,
  responsibility: ProjectTeamProjection['responsibility'] = null,
): ProjectTeamProjection {
  return { projectId: 'project-1', teamRevision, members, responsibility }
}

function addSuccess(memberId: string, kind: 'human' | 'agent', revision: number): AddProjectMemberResult {
  return {
    ok: true,
    value: {
      projectId: 'project-1',
      memberId,
      kind,
      status: 'active',
      memberRevision: 1,
      teamRevision: revision,
    },
    receipt: {
      commandId: `command-add-${revision}`,
      auditEventId: `audit-add-${revision}`,
      outboxId: `outbox-add-${revision}`,
    },
  }
}

function responsibilitySuccess(revision: number): SetProjectResponsibilityResult {
  return {
    ok: true,
    value: {
      projectId: 'project-1',
      responsibilityRevision: revision,
      teamRevision: revision,
    },
    receipt: {
      commandId: `command-responsibility-${revision}`,
      auditEventId: `audit-responsibility-${revision}`,
      outboxId: `outbox-responsibility-${revision}`,
    },
  }
}

function remote(overrides: Partial<WorkbenchProjectTeamRemote> = {}): WorkbenchProjectTeamRemote {
  return {
    projectTeam: overrides.projectTeam ?? vi.fn(() => Promise.resolve(ok(team()))),
    addProjectMember: overrides.addProjectMember
      ?? vi.fn(() => Promise.resolve(ok(addSuccess('member-created', 'human', 1)))),
    setProjectMemberStatus: overrides.setProjectMemberStatus
      ?? vi.fn(() => Promise.resolve(ok({
        ok: true,
        value: {
          projectId: 'project-1',
          memberId: 'member-created',
          kind: 'human',
          status: 'inactive',
          memberRevision: 2,
          teamRevision: 2,
        },
        receipt: { commandId: 'command-status', auditEventId: 'audit-status', outboxId: 'outbox-status' },
      } satisfies SetProjectMemberStatusResult))),
    setProjectResponsibility: overrides.setProjectResponsibility
      ?? vi.fn(() => Promise.resolve(ok(responsibilitySuccess(1)))),
  }
}

async function renderPanel(workbenchRemote: WorkbenchProjectTeamRemote, select = true) {
  const controller = new WorkbenchProjectTeamController(workbenchRemote, {
    nextCommandKey: (() => {
      let sequence = 0
      return () => `command-key-${++sequence}`
    })(),
  })
  controllers.push(controller)
  const view = render(<ProjectTeamPanel controller={controller} t={t} />)
  if (select) await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })
  return { controller, ...view }
}

function openAddForm(): void {
  fireEvent.click(screen.getByText('添加 ProjectMember'))
}

function fillFeishu(): void {
  fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Ada Owner' } })
  fireEvent.change(screen.getByLabelText('飞书 App ID'), { target: { value: 'cli_app1' } })
  fireEvent.change(screen.getByLabelText('飞书 open_id'), { target: { value: 'ou_ada1' } })
}

describe('ProjectTeamPanel', () => {
  it('is Project-scoped and adds declared Feishu identity through labeled fieldsets', async () => {
    const created = { ...feishu('member-created'), displayName: 'Ada Owner' }
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([created], 1)))
    const pending = deferred<RemoteResult<AddProjectMemberResult>>()
    const addProjectMember = vi.fn(() => pending.promise)
    const { controller } = await renderPanel(remote({ projectTeam, addProjectMember }), false)

    expect(screen.getByRole('heading', { name: 'Project Team' })).toBeTruthy()
    expect(screen.getByText(/打开一个 Project/u)).toBeTruthy()
    await act(async () => { await controller.selectProject('project-1', 'Evidence Project') })
    expect(screen.getByText('Evidence Project')).toBeTruthy()
    openAddForm()

    expect(screen.getByRole('group', { name: '成员身份' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '成员类型' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '人类身份记录' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: '人类' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', {
      name: '声明的飞书身份',
    }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/T05 只记录声明值/u)).toBeTruthy()
    fillFeishu()

    const add = screen.getByRole('button', { name: '添加成员' }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    fireEvent.click(screen.getByRole('button', { name: '正在添加…' }))
    expect(addProjectMember).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '正在添加…' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(addProjectMember.mock.calls[0]?.[0].member).toEqual({
      kind: 'human',
      displayName: 'Ada Owner',
      identity: { type: 'feishu', appId: 'cli_app1', openId: 'ou_ada1' },
    })

    await act(async () => {
      pending.resolve(ok(addSuccess('member-created', 'human', 1)))
      await pending.promise
    })
    const memberTitle = screen.getByRole('heading', { name: 'Ada Owner' })
    expect(document.activeElement).toBe(memberTitle.closest('article'))
    expect(screen.getByText('仅声明，未验证')).toBeTruthy()
    expect(screen.getByText(/后续连接器验证/u)).toBeTruthy()
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('')
  })

  it('renders exact external-human and Agent creation variants without identity leakage', async () => {
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([external()], 1)))
      .mockResolvedValueOnce(ok(team([external(), agent()], 2)))
    const addProjectMember = vi.fn()
      .mockResolvedValueOnce(ok(addSuccess('member-external', 'human', 1)))
      .mockResolvedValueOnce(ok(addSuccess('member-agent', 'agent', 2)))
    await renderPanel(remote({ projectTeam, addProjectMember }))
    openAddForm()

    fireEvent.click(screen.getByRole('radio', { name: '外部联系人' }))
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'External Human' } })
    fireEvent.change(screen.getByLabelText('联系方式'), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText('联系值'), { target: { value: 'external@example.test' } })
    expect(screen.getByText(/不会因为邮箱、电话或名称/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    expect(addProjectMember.mock.calls[0]?.[0].member).toEqual({
      kind: 'human',
      displayName: 'External Human',
      identity: { type: 'external', method: 'email', value: 'external@example.test' },
    })

    expect(await screen.findByRole('heading', { name: 'External Human' })).toBeTruthy()
    expect(screen.getByText(
      '不可用：外部联系值不是飞书 assignee ID',
      { exact: true },
    )).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Agent' }))
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Research Agent' } })
    expect(screen.queryByLabelText('飞书 App ID')).toBeNull()
    expect(screen.queryByLabelText('联系值')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    expect(addProjectMember.mock.calls[1]?.[0].member).toEqual({
      kind: 'agent',
      displayName: 'Research Agent',
    })
    expect(await screen.findByText(
      '不可用：T05 Agent 不是飞书成员',
      { exact: true },
    )).toBeTruthy()
  })

  it('keeps inactive members visible but excludes them from roles and supports reactivation', async () => {
    const members = [feishu(), agent(), inactive()]
    await renderPanel(remote({
      projectTeam: vi.fn(() => Promise.resolve(ok(team(members, 3)))),
    }))

    expect(screen.getByRole('region', { name: '活跃成员' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '已停用成员' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Inactive Human' })).toBeTruthy()
    expect(screen.getByText(/不可用：成员已停用/u)).toBeTruthy()
    const accountable = screen.getByRole('combobox', { name: 'Accountable' })
    expect(within(accountable).queryByRole('option', { name: /Inactive Human/u })).toBeNull()
    expect((screen.getByRole('button', {
      name: '重新启用成员',
    }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('requires Sponsor for Agent/external Accountable, excludes Accountable from Contributors, and saves atomically', async () => {
    const members = [feishu(), feishu('member-sponsor'), external(), agent(), inactive()]
    const committed = {
      projectId: 'project-1',
      revision: 1,
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-external', 'member-human'],
      humanSponsorMemberId: 'member-sponsor',
      updatedAt: '2026-08-31T13:00:00.000Z',
    }
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team(members, 0)))
      .mockResolvedValueOnce(ok(team(members, 1, committed)))
    const setProjectResponsibility = vi.fn(() => Promise.resolve(ok(responsibilitySuccess(1))))
    await renderPanel(remote({ projectTeam, setProjectResponsibility }))

    const accountable = screen.getByRole('combobox', { name: 'Accountable' })
    fireEvent.change(accountable, { target: { value: 'member-agent' } })
    expect(screen.getByText(/必须选择一位不同的活跃人类 Sponsor/u)).toBeTruthy()
    const save = screen.getByRole('button', { name: '保存 Project Responsibility' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    const contributors = screen.getByRole('group', { name: 'Contributors' })
    expect(within(contributors).queryByRole('checkbox', { name: 'Research Agent' })).toBeNull()
    fireEvent.click(within(contributors).getByRole('checkbox', { name: 'Feishu Human' }))
    fireEvent.click(within(contributors).getByRole('checkbox', { name: 'External Human' }))
    const sponsor = screen.getByRole('combobox', { name: 'Human Sponsor' })
    fireEvent.change(sponsor, { target: { value: 'member-sponsor' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(setProjectResponsibility).toHaveBeenCalledWith(expect.objectContaining({
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-external', 'member-human'],
      humanSponsorMemberId: 'member-sponsor',
      expectedTeamRevision: 0,
      expectedResponsibilityRevision: null,
    }), expect.any(AbortSignal))
    expect(await screen.findByRole('heading', { name: '当前 Host 责任' })).toBeTruthy()
    expect(screen.getAllByText('Research Agent').length).toBeGreaterThan(0)

    fireEvent.change(accountable, { target: { value: 'member-human' } })
    expect((sponsor as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('当前 Accountable 不使用 Sponsor，选择保持为空。')).toBeTruthy()
  })

  it('blocks locally known current role deactivation with visible and aria guidance', async () => {
    const members = [feishu(), feishu('member-sponsor'), agent()]
    const responsibility = {
      projectId: 'project-1',
      revision: 1,
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-human'],
      humanSponsorMemberId: 'member-sponsor',
      updatedAt: '2026-08-31T13:00:00.000Z',
    }
    const setProjectMemberStatus = vi.fn()
    await renderPanel(remote({
      projectTeam: vi.fn(() => Promise.resolve(ok(team(members, 1, responsibility)))),
      setProjectMemberStatus,
    }))

    const disabled = screen.getAllByRole('button', { name: '停用成员' }) as HTMLButtonElement[]
    expect(disabled).toHaveLength(3)
    for (const button of disabled) {
      expect(button.disabled).toBe(true)
      const describedBy = button.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy as string)?.textContent)
        .toContain('请先重新分配责任')
      fireEvent.click(button)
    }
    expect(setProjectMemberStatus).not.toHaveBeenCalled()
  })

  it('retains the add draft and exposes same-key retry after a transport loss', async () => {
    const created = { ...feishu('member-created'), displayName: 'Ada Owner' }
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([created], 1)))
    const addProjectMember = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'unavailable', message: 'response lost SECRET' },
      })
      .mockResolvedValueOnce(ok(addSuccess('member-created', 'human', 1)))
    await renderPanel(remote({ projectTeam, addProjectMember }))
    openAddForm()
    fillFeishu()
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('草稿与安全重试身份已保留')
    expect(alert.textContent).not.toContain('SECRET')
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('Ada Owner')
    fireEvent.click(screen.getByRole('button', { name: '使用同一安全命令身份重试' }))

    expect(addProjectMember).toHaveBeenCalledTimes(2)
    expect(addProjectMember.mock.calls[1]?.[0]).toEqual(addProjectMember.mock.calls[0]?.[0])
    expect(await screen.findByRole('heading', { name: 'Ada Owner' })).toBeTruthy()
  })

  it('renders safe member-in-use race copy without PII diagnostics and retains the roster', async () => {
    const current = feishu()
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([current], 1)))
      .mockResolvedValueOnce(ok(team([current], 1)))
    const setProjectMemberStatus = vi.fn(() => Promise.resolve(ok({
      ok: false,
      error: { code: 'member-in-use', message: 'SECRET Ada details', memberId: current.memberId },
    } satisfies SetProjectMemberStatusResult)))
    await renderPanel(remote({ projectTeam, setProjectMemberStatus }))

    fireEvent.click(screen.getByRole('button', { name: '停用成员' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('请先重新分配责任')
    expect(alert.textContent).not.toContain('SECRET')
    expect(screen.getByRole('heading', { name: 'Feishu Human' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新读取 Project Team' })).toBeTruthy()
  })

  it('keeps a no-overflow single-column mobile layout and removes motion when requested', async () => {
    const source = await readFile(resolve(
      process.cwd(),
      'packages/workbench-client/src/client/ProjectTeamPanel.module.css',
    ), 'utf8')
    expect(source).toContain('@media (max-width: 700px)')
    expect(source).toContain('overflow: hidden;')
    expect(source).toMatch(/\.memberList,[\s\S]*grid-template-columns: minmax\(0, 1fr\);/u)
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toContain('animation: none;')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
