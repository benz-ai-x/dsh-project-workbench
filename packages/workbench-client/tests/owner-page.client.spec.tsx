// @vitest-environment jsdom

import type {
  InitializeOwnerResult,
  LoginOwnerResult,
  OwnerAccessProjection,
  OwnerAuthResponse,
  ProjectStartProjection,
  WorkbenchActivityProjection,
  WorkbenchStatusSnapshot,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OwnerAuthHttp } from '../src/client/auth-http.ts'
import type { WorkbenchRemote } from '../src/client/controller.ts'
import type { WorkbenchProjectRemote } from '../src/client/project-controller.ts'
import { OwnerController } from '../src/client/owner-controller.ts'
import { OwnerPage } from '../src/client/OwnerPage.tsx'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

const controllers: OwnerController[] = []
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

function access(): Extract<OwnerAccessProjection, { readonly state: 'signed-in' }> {
  return {
    state: 'signed-in',
    ownerId: 'owner-1',
    organizationId: 'organization-1',
    teamId: 'team-1',
    sessionExpiresAt: '2099-09-01T00:00:00.000Z',
  }
}

function status(): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message: 'Host 保护的状态',
    revision: 1,
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

function authOk<T>(value: T): OwnerAuthResponse<T> {
  return { ok: true, value }
}

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function activityProjection(): WorkbenchActivityProjection {
  return {
    items: [],
    nextBeforeSequence: null,
    integrity: {
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    },
  }
}

function projectStartProjection(): ProjectStartProjection {
  const definitionDigest = `sha256:${'a'.repeat(64)}` as const
  return {
    template: {
      selection: { templateId: 'knowledge-work', templateVersion: 1, definitionDigest },
      definition: {
        snapshotSchemaVersion: 1,
        templateId: 'knowledge-work',
        templateVersion: 1,
        kind: 'knowledge-work',
        rules: {
          minimumOutcomeCount: 1,
          outcomeMetricRequired: true,
          primaryGoalRequired: true,
          supportingGoalsAllowed: true,
        },
        defaults: { projectTimezone: 'Asia/Shanghai' },
      },
    },
    catalogRevision: 0,
    projects: [],
    nextBeforeSequence: null,
  }
}

function auth(overrides: Partial<OwnerAuthHttp> = {}): OwnerAuthHttp {
  return {
    state: overrides.state ?? vi.fn(() => Promise.resolve(authOk({ state: 'signed-out' }))),
    initialize: overrides.initialize ?? vi.fn(() => Promise.resolve({
      ok: false,
      error: { code: 'unavailable' },
    })),
    login: overrides.login ?? vi.fn(() => Promise.resolve({
      ok: false,
      error: { code: 'invalid-credentials' },
    })),
    logout: overrides.logout ?? vi.fn(() => Promise.resolve(authOk({ state: 'signed-out' }))),
  }
}

type OwnerRemote = WorkbenchRemote & WorkbenchProjectRemote

function remote(overrides: Partial<OwnerRemote> = {}): OwnerRemote {
  return {
    snapshot: overrides.snapshot ?? vi.fn(() => Promise.resolve(remoteOk(status()))),
    setStatus: overrides.setStatus ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: true as const,
      value: status(),
      receipt: {
        commandId: 'command-test',
        auditEventId: 'audit-test',
        outboxId: 'outbox-test',
      },
    }))),
    activity: overrides.activity ?? vi.fn(() => Promise.resolve(remoteOk(activityProjection()))),
    auditIntegrity: overrides.auditIntegrity ?? vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    }))),
    projectStart: overrides.projectStart
      ?? vi.fn(() => Promise.resolve(remoteOk(projectStartProjection()))),
    createProject: overrides.createProject ?? vi.fn(() => Promise.resolve(remoteOk({
      ok: false as const,
      error: { code: 'idempotency-conflict' as const, message: 'unused' },
    }))),
    project: overrides.project ?? vi.fn(() => Promise.resolve(remoteOk(null))),
  }
}

function renderOwner(ownerAuth: OwnerAuthHttp, workbenchRemote: OwnerRemote, copyText?: (value: string) => Promise<void>) {
  const controller = new OwnerController(ownerAuth, workbenchRemote)
  controllers.push(controller)
  const view = render(<OwnerPage controller={controller} t={t} copyText={copyText} />)
  return { controller, ...view }
}

describe('OwnerPage', () => {
  it('renders an explicit probe before any protected Workbench request', async () => {
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(status())))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const projectStartRemote = vi.fn(() => Promise.resolve(remoteOk(projectStartProjection())))
    const createProjectRemote = vi.fn(() => Promise.resolve(remoteOk({
      ok: false as const,
      error: { code: 'idempotency-conflict' as const, message: 'unused' },
    })))
    const projectRemote = vi.fn(() => Promise.resolve(remoteOk(null)))
    const auditIntegrity = vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    })))
    const state = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const { controller } = renderOwner(auth({ state: vi.fn(() => state.promise) }), remote({
      snapshot: snapshotRemote,
      activity: activityRemote,
      auditIntegrity,
      projectStart: projectStartRemote,
      createProject: createProjectRemote,
      project: projectRemote,
    }))

    expect(screen.getByRole('main', { name: '正在确认访问状态' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('先验证本机 Owner 会话')
    const starting = controller.start()
    expect(snapshotRemote).not.toHaveBeenCalled()
    expect(activityRemote).not.toHaveBeenCalled()
    expect(auditIntegrity).not.toHaveBeenCalled()
    expect(projectStartRemote).not.toHaveBeenCalled()
    expect(createProjectRemote).not.toHaveBeenCalled()
    expect(projectRemote).not.toHaveBeenCalled()
    state.resolve(authOk({ state: 'signed-out' }))
    await act(async () => { await starting })
    expect(screen.getByRole('heading', { name: 'Owner 登录' })).toBeTruthy()
    expect(snapshotRemote).not.toHaveBeenCalled()
    expect(activityRemote).not.toHaveBeenCalled()
    expect(auditIntegrity).not.toHaveBeenCalled()
    expect(projectStartRemote).not.toHaveBeenCalled()
    expect(createProjectRemote).not.toHaveBeenCalled()
    expect(projectRemote).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '从知识工作模板创建项目' })).toBeNull()
  })

  it('supports setup confirmation, pending lock, one-time copy/CLI guidance, and acknowledgement', async () => {
    const setup = deferred<OwnerAuthResponse<InitializeOwnerResult>>()
    const initialize = vi.fn(() => setup.promise)
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(status())))
    const activityRemote = vi.fn(() => Promise.resolve(remoteOk(activityProjection())))
    const auditIntegrity = vi.fn(() => Promise.resolve(remoteOk({
      valid: true,
      eventCount: 0,
      headHash: '',
      issue: null,
    })))
    const copyText = vi.fn(() => Promise.resolve())
    const { controller } = renderOwner(auth({
      state: vi.fn(() => Promise.resolve(authOk({ state: 'setup-required' }))),
      initialize,
    }), remote({ snapshot: snapshotRemote, activity: activityRemote, auditIntegrity }), copyText)
    await act(async () => { await controller.start() })

    const password = screen.getByLabelText('Owner 密码')
    const confirmation = screen.getByLabelText('再次输入密码')
    expect(screen.getByText(/至少输入 15 个 Unicode 字符/u)).toBeTruthy()
    fireEvent.change(password, { target: { value: 'first secret' } })
    fireEvent.change(confirmation, { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: '初始化 Owner' }))
    expect(screen.getByRole('alert').textContent).toContain('两次输入的密码不一致')
    expect(initialize).not.toHaveBeenCalled()

    fireEvent.change(confirmation, { target: { value: 'first secret' } })
    fireEvent.click(screen.getByRole('button', { name: '初始化 Owner' }))
    expect(initialize).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '正在安全初始化…' }) as HTMLButtonElement).disabled).toBe(true)
    const recoveryCode = 'WB1-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'
    await act(async () => {
      setup.resolve(authOk({ access: access(), recoveryCode }))
      await setup.promise
    })

    expect(screen.getByRole('heading', { name: '立即保存离线恢复码' })).toBeTruthy()
    expect(screen.getByText(recoveryCode)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('dsh-workbench owner recover')).toBeTruthy()
    expect(snapshotRemote).not.toHaveBeenCalled()
    expect(activityRemote).not.toHaveBeenCalled()
    expect(auditIntegrity).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '复制恢复码' }))
    await screen.findByRole('button', { name: '恢复码已复制' })
    expect(copyText).toHaveBeenCalledWith(recoveryCode)
    fireEvent.click(screen.getByRole('button', { name: '我已安全保存，进入工作台' }))

    expect(await screen.findByRole('main', { name: '让项目状态始终清晰可见' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '从知识工作模板创建项目' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '活动记录' })).toBeTruthy()
    expect(screen.getByText('审计链验证通过')).toBeTruthy()
    expect(screen.queryByText(recoveryCode)).toBeNull()
    expect(snapshotRemote).toHaveBeenCalledOnce()
    expect(activityRemote).toHaveBeenCalledOnce()
    expect(auditIntegrity).not.toHaveBeenCalled()
  })

  it('localizes login failure, disables duplicate login, and clears protected UI after logout', async () => {
    const login = deferred<OwnerAuthResponse<LoginOwnerResult>>()
    const logout = deferred<OwnerAuthResponse<OwnerAccessProjection>>()
    const loginCall = vi.fn()
      .mockImplementationOnce(() => login.promise)
      .mockResolvedValueOnce(authOk({ access: access() }))
    const snapshotRemote = vi.fn(() => Promise.resolve(remoteOk(status())))
    const { controller } = renderOwner(auth({
      login: loginCall,
      logout: vi.fn(() => logout.promise),
    }), remote({ snapshot: snapshotRemote }))
    await act(async () => { await controller.start() })

    const password = screen.getByLabelText('Owner 密码')
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    fireEvent.click(screen.getByRole('button', { name: '正在验证…' }))
    expect(loginCall).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '正在验证…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      login.resolve({ ok: false, error: { code: 'invalid-credentials' } })
      await login.promise
    })
    expect(screen.getByRole('alert').textContent).toContain('密码不正确')
    expect(screen.queryByText(/invalid-credentials/u)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('main', { name: '让项目状态始终清晰可见' })).toBeTruthy()
    const statusController = controller.getSnapshot().status
    const projectController = controller.getSnapshot().projects
    const activityController = controller.getSnapshot().activity
    expect(screen.getByRole('heading', { name: '从知识工作模板创建项目' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '活动记录' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '项目状态' }), {
      target: { value: '退出后必须清除的草稿' },
    })
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect((screen.getByRole('button', { name: '正在退出…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      logout.resolve(authOk({ state: 'signed-out' }))
      await logout.promise
    })

    expect(screen.getByRole('heading', { name: 'Owner 登录' })).toBeTruthy()
    expect(screen.queryByText('Host 保护的状态')).toBeNull()
    expect(screen.queryByRole('heading', { name: '从知识工作模板创建项目' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '活动记录' })).toBeNull()
    expect(statusController?.getSnapshot()).toMatchObject({ snapshot: null, draft: '' })
    expect(activityController?.getSnapshot()).toMatchObject({
      phase: 'loading',
      activity: null,
      integrity: null,
    })
    expect(projectController?.getSnapshot()).toMatchObject({
      start: null,
      detail: null,
      draft: { projectName: '', primaryGoalName: '' },
    })
  })
})
