import type {
  AddProjectMemberResult,
  ProjectMemberProjection,
  ProjectTeamProjection,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityResult,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PROJECT_TEAM_CONTRIBUTORS,
  WorkbenchProjectTeamController,
  type WorkbenchProjectTeamRemote,
} from '../src/client/project-team-controller.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function receipt(id: string) {
  return { commandId: `command-${id}`, auditEventId: `audit-${id}`, outboxId: `outbox-${id}` }
}

function feishuHuman(
  memberId = 'member-feishu',
  overrides: Partial<ProjectMemberProjection> = {},
): ProjectMemberProjection {
  return {
    memberId,
    projectId: 'project-1',
    kind: 'human',
    displayName: 'Feishu Human',
    status: 'active',
    revision: 1,
    identity: {
      type: 'feishu',
      appId: 'cli_a1',
      openId: 'ou_a1',
      state: 'declared',
    },
    feishuAssigneeEligibility: 'identifier-present',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  } as ProjectMemberProjection
}

function externalHuman(
  memberId = 'member-external',
  overrides: Partial<ProjectMemberProjection> = {},
): ProjectMemberProjection {
  return {
    memberId,
    projectId: 'project-1',
    kind: 'human',
    displayName: 'External Human',
    status: 'active',
    revision: 1,
    identity: { type: 'external', method: 'email', value: 'human@example.test' },
    feishuAssigneeEligibility: 'external-contact',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  } as ProjectMemberProjection
}

function agent(
  memberId = 'member-agent',
  overrides: Partial<ProjectMemberProjection> = {},
): ProjectMemberProjection {
  return {
    memberId,
    projectId: 'project-1',
    kind: 'agent',
    displayName: 'Research Agent',
    status: 'active',
    revision: 1,
    feishuAssigneeEligibility: 'agent-not-assignable',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  } as ProjectMemberProjection
}

function team(
  members: readonly ProjectMemberProjection[] = [],
  teamRevision = 0,
  responsibility: ProjectTeamProjection['responsibility'] = null,
  projectId = 'project-1',
): ProjectTeamProjection {
  return { projectId, teamRevision, members, responsibility }
}

function addSuccess(
  memberId = 'member-feishu',
  teamRevision = 1,
): AddProjectMemberResult {
  return {
    ok: true,
    value: {
      projectId: 'project-1',
      memberId,
      kind: 'human',
      status: 'active',
      memberRevision: 1,
      teamRevision,
    },
    receipt: receipt('member-add'),
  }
}

function statusSuccess(
  memberId: string,
  status: 'active' | 'inactive',
  memberRevision: number,
  teamRevision: number,
): SetProjectMemberStatusResult {
  return {
    ok: true,
    value: {
      projectId: 'project-1',
      memberId,
      kind: 'human',
      status,
      memberRevision,
      teamRevision,
    },
    receipt: receipt(`status-${teamRevision}`),
  }
}

function responsibilitySuccess(
  responsibilityRevision: number,
  teamRevision: number,
): SetProjectResponsibilityResult {
  return {
    ok: true,
    value: { projectId: 'project-1', responsibilityRevision, teamRevision },
    receipt: receipt(`responsibility-${teamRevision}`),
  }
}

function remote(overrides: Partial<WorkbenchProjectTeamRemote> = {}): WorkbenchProjectTeamRemote {
  return {
    projectTeam: overrides.projectTeam
      ?? vi.fn(query => Promise.resolve(ok(team([], 0, null, query.projectId)))),
    addProjectMember: overrides.addProjectMember
      ?? vi.fn(() => Promise.resolve(ok(addSuccess()))),
    setProjectMemberStatus: overrides.setProjectMemberStatus
      ?? vi.fn(() => Promise.resolve(ok(statusSuccess('member-feishu', 'inactive', 2, 2)))),
    setProjectResponsibility: overrides.setProjectResponsibility
      ?? vi.fn(() => Promise.resolve(ok(responsibilitySuccess(1, 1)))),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function completeFeishuDraft(controller: WorkbenchProjectTeamController): void {
  controller.setMemberDisplayName('  Ada Owner  ')
  controller.setFeishuAppId('  cli_app-1  ')
  controller.setFeishuOpenId('  ou_user:1  ')
}

describe('WorkbenchProjectTeamController', () => {
  it('adds declared Feishu metadata without declaration authority, repulls full truth, and focuses it', async () => {
    const committed = feishuHuman('member-created', { displayName: 'Ada Owner' })
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([committed], 1)))
    const addProjectMember = vi.fn(() => Promise.resolve(ok(addSuccess('member-created', 1))))
    const onCommitted = vi.fn()
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('idem-member-1')
      .mockReturnValueOnce('cause-member-1')
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      addProjectMember,
    }), { onCommitted, nextCommandKey })

    await controller.selectProject('project-1', 'Evidence Project')
    completeFeishuDraft(controller)
    expect(controller.canAddMember()).toBe(true)
    await controller.addMember()

    expect(addProjectMember).toHaveBeenCalledWith({
      projectId: 'project-1',
      member: {
        kind: 'human',
        displayName: 'Ada Owner',
        identity: { type: 'feishu', appId: 'cli_app-1', openId: 'ou_user:1' },
      },
      expectedTeamRevision: 0,
      expectedRevision: null,
      idempotencyKey: 'idem-member-1',
      causationId: 'cause-member-1',
      reason: 'owner-project-member-add',
    }, expect.any(AbortSignal))
    expect(JSON.stringify(addProjectMember.mock.calls[0]?.[0])).not.toContain('declared')
    expect(projectTeam).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      team: { teamRevision: 1, members: [{ memberId: 'member-created' }] },
      memberDraft: { displayName: '', feishuAppId: '', feishuOpenId: '' },
      memberDraftDirty: false,
      focusMemberId: 'member-created',
      focusEpoch: 1,
    })
    expect(onCommitted).toHaveBeenCalledWith(receipt('member-add'))
  })

  it('builds exact external-human and descriptive-Agent unions while ignoring inactive fields', async () => {
    const addProjectMember = vi.fn()
      .mockResolvedValueOnce(ok(addSuccess('member-external', 1)))
      .mockResolvedValueOnce(ok({
        ...addSuccess('member-agent', 2),
        value: { ...addSuccess('member-agent', 2).value, memberId: 'member-agent', kind: 'agent' },
      } satisfies AddProjectMemberResult))
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([externalHuman()], 1)))
      .mockResolvedValueOnce(ok(team([externalHuman(), agent()], 2)))
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      addProjectMember,
    }))
    await controller.selectProject('project-1')

    controller.setMemberDisplayName('External Human')
    controller.setHumanIdentity('external')
    controller.setExternalMethod('phone')
    controller.setExternalValue(' +86 138 0000 0000 ')
    controller.setFeishuAppId('must-not-cross')
    controller.setFeishuOpenId('must-not-cross')
    await controller.addMember()
    expect(addProjectMember.mock.calls[0]?.[0].member).toEqual({
      kind: 'human',
      displayName: 'External Human',
      identity: { type: 'external', method: 'phone', value: '+86 138 0000 0000' },
    })

    controller.setMemberKind('agent')
    controller.setMemberDisplayName('Research Agent')
    controller.setHumanIdentity('feishu')
    controller.setFeishuAppId('must-not-cross')
    controller.setFeishuOpenId('must-not-cross')
    await controller.addMember()
    expect(addProjectMember.mock.calls[1]?.[0].member).toEqual({
      kind: 'agent',
      displayName: 'Research Agent',
    })
  })

  it('matches Host bounds and opaque Feishu grammar before Remote admission', async () => {
    const controller = new WorkbenchProjectTeamController(remote())
    await controller.selectProject('project-1')
    completeFeishuDraft(controller)
    expect(controller.canAddMember()).toBe(true)

    controller.setFeishuOpenId('contains space')
    expect(controller.canAddMember()).toBe(false)
    controller.setFeishuOpenId('ümlaut')
    expect(controller.canAddMember()).toBe(false)
    controller.setFeishuOpenId('-starts-wrong')
    expect(controller.canAddMember()).toBe(false)
    controller.setFeishuOpenId(`a${'b'.repeat(128)}`)
    expect(controller.canAddMember()).toBe(false)
    controller.setFeishuOpenId(`a${'b'.repeat(127)}`)
    expect(controller.canAddMember()).toBe(true)
    controller.setFeishuAppId('bad space')
    expect(controller.canAddMember()).toBe(false)
    controller.setFeishuAppId('cli.app:1-ok')
    expect(controller.canAddMember()).toBe(true)
    controller.setMemberDisplayName(`bad\u0000name`)
    expect(controller.canAddMember()).toBe(false)
    controller.setMemberDisplayName(`bad\ud800name`)
    expect(controller.canAddMember()).toBe(false)
    controller.setMemberDisplayName('x'.repeat(201))
    expect(controller.canAddMember()).toBe(false)
  })

  it('retries the byte-equivalent command after response loss despite a newer Team read', async () => {
    const created = feishuHuman('member-created', { displayName: 'Ada Owner' })
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([], 1)))
      .mockResolvedValueOnce(ok(team([created], 1)))
    const addProjectMember = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'unavailable', message: 'response lost', body: 'SECRET' },
      })
      .mockResolvedValueOnce(ok(addSuccess('member-created', 1)))
    const nextCommandKey = vi.fn()
      .mockReturnValueOnce('idem-response-loss')
      .mockReturnValueOnce('cause-response-loss')
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      addProjectMember,
    }), { nextCommandKey })
    await controller.selectProject('project-1')
    completeFeishuDraft(controller)

    await controller.addMember()
    const original = addProjectMember.mock.calls[0]?.[0]
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      canRetryMutation: true,
      memberDraftDirty: true,
      issue: { kind: 'transport', code: 'unavailable' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('SECRET')

    await controller.connectionReset()
    expect(controller.getSnapshot().team?.teamRevision).toBe(1)
    await controller.addMember()
    expect(addProjectMember.mock.calls[1]?.[0]).toEqual(original)
    expect(original?.expectedTeamRevision).toBe(0)
    expect(nextCommandKey).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().team?.members).toHaveLength(1)
  })

  it('retains member draft, accepts only safe conflict code, and repulls after a duplicate', async () => {
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([], 0)))
      .mockResolvedValueOnce(ok(team([feishuHuman()], 1)))
    const addProjectMember = vi.fn(() => Promise.resolve(ok({
      ok: false,
      error: { code: 'duplicate-feishu-identity', message: 'SECRET open_id ou_secret' },
    } satisfies AddProjectMemberResult)))
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      addProjectMember,
    }))
    await controller.selectProject('project-1')
    completeFeishuDraft(controller)
    const before = controller.getSnapshot().memberDraft

    await controller.addMember()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      team: { teamRevision: 1 },
      memberDraft: before,
      memberDraftDirty: true,
      issue: { kind: 'conflict', code: 'duplicate-feishu-identity' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('SECRET')
    expect(projectTeam).toHaveBeenCalledTimes(2)
  })

  it('requires a distinct active human Sponsor for Agent or external Accountable only', async () => {
    const members = [feishuHuman(), externalHuman(), agent()]
    const setProjectResponsibility = vi.fn(() => Promise.resolve(ok(responsibilitySuccess(1, 1))))
    const committedResponsibility = {
      projectId: 'project-1',
      revision: 1,
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-external', 'member-feishu'],
      humanSponsorMemberId: 'member-feishu',
      updatedAt: '2026-08-31T13:00:00.000Z',
    }
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team(members, 0)))
      .mockResolvedValueOnce(ok(team(members, 1, committedResponsibility)))
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      setProjectResponsibility,
    }))
    await controller.selectProject('project-1')

    controller.setAccountable('member-agent')
    expect(controller.canSaveResponsibility()).toBe(false)
    controller.setContributor('member-feishu', true)
    controller.setContributor('member-external', true)
    controller.setHumanSponsor('member-feishu')
    expect(controller.canSaveResponsibility()).toBe(true)
    await controller.saveResponsibility()
    expect(setProjectResponsibility).toHaveBeenCalledWith(expect.objectContaining({
      accountableMemberId: 'member-agent',
      contributorMemberIds: ['member-external', 'member-feishu'],
      humanSponsorMemberId: 'member-feishu',
      expectedTeamRevision: 0,
      expectedResponsibilityRevision: null,
      reason: 'owner-project-responsibility-set',
    }), expect.any(AbortSignal))
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      responsibilityDraftDirty: false,
      team: { responsibility: { accountableMemberId: 'member-agent' } },
    })

    controller.setAccountable('member-external')
    expect(controller.getSnapshot().responsibilityDraft.humanSponsorMemberId).toBe('member-feishu')
    expect(controller.canSaveResponsibility()).toBe(true)
    controller.setAccountable('member-feishu')
    expect(controller.getSnapshot().responsibilityDraft.humanSponsorMemberId).toBe('')
    expect(controller.canSaveResponsibility()).toBe(true)
  })

  it('excludes inactive members and caps a distinct Contributor set at 20', async () => {
    const accountable = feishuHuman('member-00')
    const contributors = Array.from({ length: 22 }, (_, index) => agent(`member-${index + 1}`))
    const inactive = externalHuman('member-inactive', {
      status: 'inactive',
      feishuAssigneeEligibility: 'inactive',
    })
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam: vi.fn(() => Promise.resolve(ok(team([
        accountable,
        ...contributors,
        inactive,
      ], 1)))),
    }))
    await controller.selectProject('project-1')
    controller.setAccountable('member-00')
    for (const member of contributors) controller.setContributor(member.memberId, true)
    controller.setContributor('member-inactive', true)
    expect(controller.getSnapshot().responsibilityDraft.contributorMemberIds)
      .toHaveLength(MAX_PROJECT_TEAM_CONTRIBUTORS)
    expect(controller.getSnapshot().responsibilityDraft.contributorMemberIds)
      .not.toContain('member-inactive')
    expect(controller.canSaveResponsibility()).toBe(true)
    controller.setAccountable('member-inactive')
    expect(controller.canSaveResponsibility()).toBe(false)
  })

  it('preserves state on current-role deactivation, then allows reassign-and-deactivate', async () => {
    const owner = feishuHuman('member-owner')
    const next = feishuHuman('member-next', { displayName: 'Next Owner' })
    const initialResponsibility = {
      projectId: 'project-1',
      revision: 1,
      accountableMemberId: 'member-owner',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
      updatedAt: '2026-08-31T12:00:00.000Z',
    }
    const reassigned = { ...initialResponsibility, revision: 2, accountableMemberId: 'member-next' }
    const inactiveOwner = feishuHuman('member-owner', {
      status: 'inactive',
      revision: 2,
      feishuAssigneeEligibility: 'inactive',
    })
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([owner, next], 2, initialResponsibility)))
      .mockResolvedValueOnce(ok(team([owner, next], 2, initialResponsibility)))
      .mockResolvedValueOnce(ok(team([owner, next], 3, reassigned)))
      .mockResolvedValueOnce(ok(team([inactiveOwner, next], 4, reassigned)))
    const setProjectMemberStatus = vi.fn()
      .mockResolvedValueOnce(ok({
        ok: false,
        error: { code: 'member-in-use', message: 'SECRET roles', memberId: 'member-owner' },
      } satisfies SetProjectMemberStatusResult))
      .mockResolvedValueOnce(ok(statusSuccess('member-owner', 'inactive', 2, 4)))
    const setProjectResponsibility = vi.fn(() => Promise.resolve(ok(
      responsibilitySuccess(2, 3),
    )))
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      setProjectMemberStatus,
      setProjectResponsibility,
    }))
    await controller.selectProject('project-1')

    await controller.changeMemberStatus('member-owner', 'inactive')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      team: { responsibility: { accountableMemberId: 'member-owner' } },
      issue: { code: 'member-in-use' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('SECRET')

    controller.setAccountable('member-next')
    await controller.saveResponsibility()
    expect(controller.getSnapshot().team?.responsibility?.accountableMemberId).toBe('member-next')
    await controller.changeMemberStatus('member-owner', 'inactive')
    expect(controller.getSnapshot().team?.members.find(member => member.memberId === 'member-owner'))
      .toMatchObject({ status: 'inactive', revision: 2 })
    expect(setProjectMemberStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps drafts and refreshes on typed same-state status conflict', async () => {
    const member = feishuHuman()
    const projectTeam = vi.fn()
      .mockResolvedValueOnce(ok(team([member], 1)))
      .mockResolvedValueOnce(ok(team([member], 2)))
    const setProjectMemberStatus = vi.fn(() => Promise.resolve(ok({
      ok: false,
      error: {
        code: 'member-status-conflict',
        message: 'raw no-op detail',
        memberId: member.memberId,
        status: 'inactive',
      },
    } satisfies SetProjectMemberStatusResult)))
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      setProjectMemberStatus,
    }))
    await controller.selectProject('project-1')
    completeFeishuDraft(controller)
    const draft = controller.getSnapshot().memberDraft
    await controller.changeMemberStatus(member.memberId, 'inactive')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'conflict',
      team: { teamRevision: 2 },
      memberDraft: draft,
      memberDraftDirty: true,
      issue: { code: 'member-status-conflict' },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('raw no-op')
  })

  it('preserves same-Project drafts through reconnect and clears them across Project switch', async () => {
    const projectTeam = vi.fn(query => Promise.resolve(ok(team([], 1, null, query.projectId))))
    const controller = new WorkbenchProjectTeamController(remote({ projectTeam }))
    await controller.selectProject('project-1', 'One')
    completeFeishuDraft(controller)
    controller.setAccountable('missing-draft-id')
    const memberDraft = controller.getSnapshot().memberDraft
    const responsibilityDraft = controller.getSnapshot().responsibilityDraft

    await controller.connectionReset()
    expect(controller.getSnapshot()).toMatchObject({
      selection: { projectId: 'project-1' },
      memberDraft,
      responsibilityDraft,
      memberDraftDirty: true,
      responsibilityDraftDirty: true,
    })
    await controller.selectProject('project-2', 'Two')
    expect(controller.getSnapshot()).toMatchObject({
      selection: { projectId: 'project-2' },
      memberDraft: { displayName: '' },
      responsibilityDraft: { accountableMemberId: '' },
      memberDraftDirty: false,
      responsibilityDraftDirty: false,
    })
  })

  it('fences superseded Project reads and drains an aborted mutation on disposal', async () => {
    const first = deferred<RemoteResult<ProjectTeamProjection | null>>()
    const mutation = deferred<RemoteResult<AddProjectMemberResult>>()
    let firstSignal: AbortSignal | undefined
    let mutationSignal: AbortSignal | undefined
    const projectTeam = vi.fn()
      .mockImplementationOnce((_query, signal?: AbortSignal) => {
        firstSignal = signal
        return first.promise
      })
      .mockResolvedValueOnce(ok(team([], 0, null, 'project-2')))
    const addProjectMember = vi.fn((_request, signal?: AbortSignal) => {
      mutationSignal = signal
      signal?.addEventListener('abort', () => mutation.resolve(ok(addSuccess())), { once: true })
      return mutation.promise
    })
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam,
      addProjectMember,
    }))

    const oldRead = controller.selectProject('project-1')
    const newRead = controller.selectProject('project-2')
    expect(firstSignal?.aborted).toBe(true)
    first.resolve(ok(team([feishuHuman()], 9)))
    await Promise.all([oldRead, newRead])
    expect(controller.getSnapshot().selection?.projectId).toBe('project-2')
    expect(controller.getSnapshot().team?.members).toHaveLength(0)

    completeFeishuDraft(controller)
    const adding = controller.addMember()
    const disposal = controller.dispose()
    expect(mutationSignal?.aborted).toBe(true)
    await Promise.all([adding, disposal])
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      phase: 'idle',
      selection: null,
      team: null,
    }))
  })

  it('bounds unknown transport diagnostics to one safe fallback', async () => {
    const controller = new WorkbenchProjectTeamController(remote({
      projectTeam: vi.fn(() => Promise.resolve({
        ok: false,
        error: { code: 'Bearer-secret-raw', message: 'TOP SECRET', token: 'TOP SECRET' },
      })),
    }))
    await controller.selectProject('project-1')
    expect(controller.getSnapshot().issue).toEqual({
      kind: 'transport',
      code: 'transport-failure',
      operation: 'read-team',
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('TOP SECRET')
  })
})
