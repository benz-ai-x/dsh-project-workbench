import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WorkbenchService, {
  Config,
  DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS,
  DEFAULT_WORKBENCH_DATABASE_PATH,
  DEFAULT_WORKBENCH_MAX_STATUS_LENGTH,
  V1OwnerAuthorizationPolicy,
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

class TestWorkbenchAuthService extends Service {
  readonly authorization = new WorkbenchAuthorizationContext(
    new V1OwnerAuthorizationPolicy(async () => true),
  )
  private readonly principal = ownerPrincipal({
    kind: 'owner',
    ownerId: 'owner-service-test',
    organizationId: 'organization-service-test',
    teamId: 'team-service-test',
    sessionId: 'session-service-test',
    credentialVersion: 1,
  })

  constructor(ctx: Context) {
    super(ctx, 'workbenchAuth')
  }

  run<T>(operation: () => T): T {
    return this.authorization.runAs(this.principal, operation)
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('WorkbenchService', () => {
  it('publishes the exact service key, namespace, and public Remote methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-service-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('credentials', Object.freeze({
      describe: async () => ({ configured: false, writable: true }),
      resolve: async () => undefined,
    }) as never)
    await ctx.plugin(TestWorkbenchAuthService)
    const fiber = ctx.plugin(WorkbenchService, {
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 500,
      maxStatusLength: 20,
    })
    await fiber.await()

    expect(ctx.workbench.typertRemote).toMatchObject({
      serviceKey: 'workbench',
      namespace: 'workbench',
    })
    expect(remoteMethods(ctx.workbench)).toEqual([
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'setStatus', invocation: { kind: 'direct' } },
      { method: 'activity', invocation: { kind: 'direct' } },
      { method: 'auditIntegrity', invocation: { kind: 'direct' } },
      { method: 'feishuConnectionCenter', invocation: { kind: 'direct' } },
      { method: 'configureFeishuIdentityRoute', invocation: { kind: 'direct' } },
      { method: 'verifyFeishuIdentityRoute', invocation: { kind: 'direct' } },
      { method: 'projectStart', invocation: { kind: 'direct' } },
      { method: 'createProject', invocation: { kind: 'direct' } },
      { method: 'project', invocation: { kind: 'direct' } },
      { method: 'projectTeam', invocation: { kind: 'direct' } },
      { method: 'addProjectMember', invocation: { kind: 'direct' } },
      { method: 'setProjectMemberStatus', invocation: { kind: 'direct' } },
      { method: 'setProjectResponsibility', invocation: { kind: 'direct' } },
      { method: 'reviewCenter', invocation: { kind: 'direct' } },
      { method: 'proposeProjectResponsibilityChange', invocation: { kind: 'direct' } },
      { method: 'decideSuggestedChange', invocation: { kind: 'direct' } },
    ])
    const auth = ctx.get('workbenchAuth') as unknown as TestWorkbenchAuthService
    await expect(ctx.workbench.snapshot(new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.activity(
      {},
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.auditIntegrity(
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.feishuConnectionCenter(
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.projectStart(
      {},
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.createProject({
      template: {
        templateId: 'knowledge-work',
        templateVersion: 1,
        definitionDigest: `sha256:${'0'.repeat(64)}`,
      },
      projectName: 'must not pass',
      primaryGoal: { name: 'must not pass', outcomes: [] },
      supportingGoals: [],
      expectedCatalogRevision: 0,
      expectedRevision: null,
      idempotencyKey: 'unauthorized-project-key-001',
      causationId: 'unauthorized-project-cause-001',
      reason: 'owner-project-create',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.project(
      { projectId: 'project-secret' },
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.projectTeam(
      { projectId: 'project-secret' },
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(ctx.workbench.addProjectMember({
      projectId: 'project-secret',
      member: { kind: 'agent', displayName: 'Secret Agent' },
      expectedTeamRevision: 0,
      expectedRevision: null,
      idempotencyKey: 'unauthorized-member-key-001',
      causationId: 'unauthorized-member-cause-001',
      reason: 'owner-project-member-add',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.setProjectMemberStatus({
      projectId: 'project-secret',
      memberId: 'member-secret',
      status: 'inactive',
      expectedTeamRevision: 0,
      expectedMemberRevision: 1,
      idempotencyKey: 'unauthorized-member-status-key-001',
      causationId: 'unauthorized-member-status-cause-001',
      reason: 'owner-project-member-status-change',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.setProjectResponsibility({
      projectId: 'project-secret',
      accountableMemberId: 'member-secret',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
      expectedTeamRevision: 0,
      expectedResponsibilityRevision: null,
      idempotencyKey: 'unauthorized-responsibility-key-001',
      causationId: 'unauthorized-responsibility-cause-001',
      reason: 'owner-project-responsibility-set',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.reviewCenter({
      projectId: 'project-secret',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.proposeProjectResponsibilityChange({
      projectId: 'project-secret',
      candidate: {
        accountableMemberId: 'member-secret',
        contributorMemberIds: [],
        humanSponsorMemberId: null,
      },
      expectedTeamRevision: 0,
      evidenceRefs: [{
        kind: 'workbench-audit-event',
        auditEventId: 'audit-secret',
      }],
      idempotencyKey: 'unauthorized-suggestion-key-001',
      causationId: 'unauthorized-suggestion-cause-001',
      reason: 'owner-suggested-change-propose',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(ctx.workbench.decideSuggestedChange({
      projectId: 'project-secret',
      suggestedChangeId: 'suggested-change-secret',
      expectedSuggestedChangeRevision: 1,
      feedback: 'Must not pass.',
      mode: 'reject',
      idempotencyKey: 'unauthorized-decision-key-0001',
      causationId: 'unauthorized-decision-cause-0001',
      reason: 'owner-suggested-change-reject',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(auth.run(() =>
      ctx.workbench.snapshot(new AbortController().signal))).resolves.toBeNull()
    await expect(auth.run(() => ctx.workbench.setStatus({
      message: 'Walking skeleton',
      expectedRevision: null,
      idempotencyKey: 'service-idempotency-key-0001',
      causationId: 'service-causation-id-0001',
      reason: 'owner-status-edit',
    }, new AbortController().signal))).resolves.toMatchObject({
      ok: true,
      value: { message: 'Walking skeleton', revision: 1 },
    })
    await expect(auth.run(() => ctx.workbench.activity(
      { projectId: null, limit: 10 },
      new AbortController().signal,
    ))).resolves.toMatchObject({
      items: [{ action: 'workbench.status.updated', outbox: { state: 'pending' } }],
    })
    await expect(auth.run(() =>
      ctx.workbench.auditIntegrity(new AbortController().signal))).resolves.toMatchObject({
      valid: true,
      eventCount: 1,
      issue: null,
    })
    const projectStart = await auth.run(() => ctx.workbench.projectStart(
      { limit: 10 },
      new AbortController().signal,
    ))
    expect(projectStart).toMatchObject({
      template: {
        selection: { templateId: 'knowledge-work', templateVersion: 1 },
        definition: { kind: 'knowledge-work', snapshotSchemaVersion: 1 },
      },
      catalogRevision: 0,
      projects: [],
      nextBeforeSequence: null,
    })
    const created = await auth.run(() => ctx.workbench.createProject({
      template: projectStart.template.selection,
      projectName: 'Service Project',
      primaryGoal: {
        name: 'Service Goal',
        outcomes: [{
          name: 'Service Outcome',
          metric: {
            metricName: 'Validated items',
            initialValue: 0,
            targetValue: 3,
            unit: 'items',
            direction: 'increase',
          },
        }],
      },
      supportingGoals: [],
      expectedCatalogRevision: projectStart.catalogRevision,
      expectedRevision: null,
      idempotencyKey: 'service-project-idempotency-001',
      causationId: 'service-project-causation-001',
      reason: 'owner-project-create',
    }, new AbortController().signal))
    expect(created).toMatchObject({
      ok: true,
      catalogRevision: 1,
      value: {
        project: { name: 'Service Project', primaryGoal: { name: 'Service Goal' } },
        primaryGoal: { outcomes: [{ name: 'Service Outcome' }] },
        templateSnapshot: { definition: { kind: 'knowledge-work' } },
      },
    })
    if (!created.ok) throw new Error('service Project creation unexpectedly failed')
    await expect(auth.run(() => ctx.workbench.project(
      { projectId: created.value.project.projectId },
      new AbortController().signal,
    ))).resolves.toEqual(created.value)

    const projectId = created.value.project.projectId
    await expect(auth.run(() => ctx.workbench.projectTeam(
      { projectId },
      new AbortController().signal,
    ))).resolves.toEqual({
      projectId,
      teamRevision: 0,
      members: [],
      responsibility: null,
    })
    const sponsor = await auth.run(() => ctx.workbench.addProjectMember({
      projectId,
      member: {
        kind: 'human',
        displayName: 'Service Sponsor',
        identity: { type: 'feishu', appId: 'cli_service', openId: 'ou_sponsor' },
      },
      expectedTeamRevision: 0,
      expectedRevision: null,
      idempotencyKey: 'service-member-idempotency-001',
      causationId: 'service-member-causation-001',
      reason: 'owner-project-member-add',
    }, new AbortController().signal))
    if (!sponsor.ok) throw new Error('service Sponsor creation unexpectedly failed')
    expect(JSON.stringify(sponsor)).not.toContain('Service Sponsor')
    expect(JSON.stringify(sponsor)).not.toContain('ou_sponsor')
    const agent = await auth.run(() => ctx.workbench.addProjectMember({
      projectId,
      member: { kind: 'agent', displayName: 'Service Agent' },
      expectedTeamRevision: 1,
      expectedRevision: null,
      idempotencyKey: 'service-member-idempotency-002',
      causationId: 'service-member-causation-002',
      reason: 'owner-project-member-add',
    }, new AbortController().signal))
    if (!agent.ok) throw new Error('service Agent creation unexpectedly failed')
    await expect(auth.run(() => ctx.workbench.setProjectResponsibility({
      projectId,
      accountableMemberId: agent.value.memberId,
      contributorMemberIds: [],
      humanSponsorMemberId: null,
      expectedTeamRevision: 2,
      expectedResponsibilityRevision: null,
      idempotencyKey: 'service-responsibility-idempotency-001',
      causationId: 'service-responsibility-causation-001',
      reason: 'owner-project-responsibility-set',
    }, new AbortController().signal))).resolves.toMatchObject({
      ok: false,
      error: { code: 'human-sponsor-required' },
    })
    await expect(auth.run(() => ctx.workbench.setProjectResponsibility({
      projectId,
      accountableMemberId: agent.value.memberId,
      contributorMemberIds: [],
      humanSponsorMemberId: sponsor.value.memberId,
      expectedTeamRevision: 2,
      expectedResponsibilityRevision: null,
      idempotencyKey: 'service-responsibility-idempotency-002',
      causationId: 'service-responsibility-causation-002',
      reason: 'owner-project-responsibility-set',
    }, new AbortController().signal))).resolves.toMatchObject({
      ok: true,
      value: { projectId, responsibilityRevision: 1, teamRevision: 3 },
    })
    const projectTeam = await auth.run(() => ctx.workbench.projectTeam(
      { projectId },
      new AbortController().signal,
    ))
    expect(projectTeam).toMatchObject({
      projectId,
      teamRevision: 3,
      members: [
        {
          memberId: sponsor.value.memberId,
          kind: 'human',
          identity: { type: 'feishu', state: 'declared' },
          feishuAssigneeEligibility: 'identifier-present',
        },
        {
          memberId: agent.value.memberId,
          kind: 'agent',
          feishuAssigneeEligibility: 'agent-not-assignable',
        },
      ],
      responsibility: {
        revision: 1,
        accountableMemberId: agent.value.memberId,
        contributorMemberIds: [],
        humanSponsorMemberId: sponsor.value.memberId,
      },
    })
    await expect(auth.run(() => ctx.workbench.setProjectMemberStatus({
      projectId,
      memberId: sponsor.value.memberId,
      status: 'inactive',
      expectedTeamRevision: 3,
      expectedMemberRevision: 1,
      idempotencyKey: 'service-member-status-idempotency-001',
      causationId: 'service-member-status-causation-001',
      reason: 'owner-project-member-status-change',
    }, new AbortController().signal))).resolves.toMatchObject({
      ok: false,
      error: { code: 'member-in-use' },
    })
    const teamActivity = await auth.run(() => ctx.workbench.activity(
      { projectId, limit: 20 },
      new AbortController().signal,
    ))
    expect(teamActivity.items.map(item => item.action)).toEqual([
      'workbench.project.responsibility-assigned',
      'workbench.project-member.created',
      'workbench.project-member.created',
      'workbench.project.created',
    ])
    expect(JSON.stringify(teamActivity)).not.toMatch(
      /Service Sponsor|Service Agent|ou_sponsor|cli_service/u,
    )

    const service = ctx.workbench
    await fiber.dispose()
    expect(ctx.get('workbench')).toBeUndefined()
    expect(service.scenario.lifecycle).toBe('closed')
  })

  it('exports one same-named type/runtime Config with validated defaults', async () => {
    expect(WorkbenchService.inject).toEqual(['workbenchAuth', 'credentials'])
    expect(WorkbenchService.Config).toBe(Config)
    expect(Config({})).toEqual({
      databasePath: DEFAULT_WORKBENCH_DATABASE_PATH,
      journalMode: 'wal',
      busyTimeoutMs: DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS,
      maxStatusLength: DEFAULT_WORKBENCH_MAX_STATUS_LENGTH,
    })
    expect(() => Config({ maxStatusLength: 0 })).toThrow()
    expect(() => Config({ busyTimeoutMs: 1.5 })).toThrow()
    expect(() => Config({ databasePath: '   ' })).toThrow()

    const ctx = new Context()
    contexts.push(ctx)
    expect(() => new WorkbenchService(ctx, { maxStatusLength: 0 })).toThrow()
  })
})
