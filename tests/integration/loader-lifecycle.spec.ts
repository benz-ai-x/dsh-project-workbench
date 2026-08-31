import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type {
  AddProjectMemberResult,
  CreateProjectResult,
  DecideSuggestedChangeResult,
  ProjectDetailProjection,
  ProjectMilestonesProjection,
  ProjectStartProjection,
  ProjectTeamProjection,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterProjection,
  SetStatusRequest,
  SetStatusResult,
  SetProjectResponsibilityResult,
  WorkbenchStatusSnapshot,
} from '../../packages/workbench-host/src/client.ts'
import type { WorkbenchService } from '../../packages/workbench-host/src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const hostEntry = resolve(repositoryRoot, 'packages/workbench-host/lib/index.js')
const ownerAuthEntry = resolve(
  repositoryRoot,
  'packages/workbench-host/lib/owner-auth-service.js',
)
const authFixtureEntry = resolve(
  repositoryRoot,
  'tests/integration/fixtures/workbench-auth-fixture.mjs',
)
const authDependenciesFixtureEntry = resolve(
  repositoryRoot,
  'tests/integration/fixtures/owner-auth-dependencies-fixture.mjs',
)
const temporaryRoots: string[] = []
const contexts: Context[] = []
const servers: Server[] = []
const WORKBENCH_REMOTE_METHODS = Object.freeze([
  'activity',
  'addProjectMember',
  'auditIntegrity',
  'bindProjectCalendar',
  'bindFeishuTaskList',
  'configureFeishuIdentityRoute',
  'configureFeishuTaskWorkflow',
  'createProject',
  'createProjectMilestone',
  'decideSuggestedChange',
  'discoverFeishuCalendarEvents',
  'discoverFeishuCalendars',
  'discoverFeishuTaskLists',
  'discoverFeishuTaskWorkflowFields',
  'feishuConnectionCenter',
  'getProjectMilestones',
  'previewFeishuTaskWorkflow',
  'project',
  'projectStart',
  'projectTasks',
  'projectTeam',
  'proposeProjectResponsibilityChange',
  'reconcileProjectCalendar',
  'reconcileProjectTasks',
  'referenceFeishuTask',
  'reviewCenter',
  'setProjectMemberStatus',
  'setProjectResponsibility',
  'setStatus',
  'snapshot',
  'updateFeishuTask',
  'updateProjectMilestoneDate',
  'verifyFeishuIdentityRoute',
])

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async context => {
    await context.fiber.dispose().catch(() => undefined)
  }))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolveClose => {
    server.close(() => { resolveClose() })
  })))
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })))
})

interface WorkbenchContext extends Context {
  readonly workbench: WorkbenchService
  readonly workbenchAuth: {
    readonly routeLifecycle: 'accepting' | 'closing' | 'closed'
    run<T>(operation: () => T): T
  }
  readonly ownerAuthDependencies: {
    readonly routes: Map<string, {
      readonly kind: 'exact' | 'prefix'
      readonly path: string
      readonly handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>
    }>
    route(pathname: string): {
      readonly handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>
    } | undefined
  }
}

async function fixture(): Promise<{
  readonly root: string
  readonly databasePath: string
  readonly configPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-loader-'))
  temporaryRoots.push(root)
  return {
    root,
    databasePath: join(root, 'state', 'workbench.sqlite'),
    configPath: join(root, 'cordis.yml'),
  }
}

function config(entry: string, databasePath: string, maxStatusLength = 280): string {
  return [
    '- id: owner-auth-dependencies-fixture',
    `  name: ${JSON.stringify(authDependenciesFixtureEntry)}`,
    '- id: workbench-auth-fixture',
    `  name: ${JSON.stringify(authFixtureEntry)}`,
    '- id: workbench-host',
    `  name: ${JSON.stringify(entry)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 500',
    `    maxStatusLength: ${String(maxStatusLength)}`,
    '',
  ].join('\n')
}

function invalidOwnerAuthConfig(entry: string): string {
  return [
    '- id: owner-auth-dependencies-fixture',
    `  name: ${JSON.stringify(authDependenciesFixtureEntry)}`,
    '- id: workbench-auth',
    `  name: ${JSON.stringify(entry)}`,
    '  config:',
    '    maxSessions: 0',
    '',
  ].join('\n')
}

function realOwnerAuthConfig(databasePath: string): string {
  return [
    '- id: owner-auth-dependencies-fixture',
    `  name: ${JSON.stringify(authDependenciesFixtureEntry)}`,
    '- id: workbench-auth',
    `  name: ${JSON.stringify(ownerAuthEntry)}`,
    '- id: workbench-host',
    `  name: ${JSON.stringify(hostEntry)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 500',
    '    maxStatusLength: 280',
    '',
  ].join('\n')
}

function statusRequest(
  message: string,
  idempotencyKey: string,
  causationId: string,
): SetStatusRequest {
  return {
    message,
    expectedRevision: null,
    idempotencyKey,
    causationId,
    reason: 'owner-status-edit',
  }
}

async function openFixtureCarrier(context: WorkbenchContext): Promise<string> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
    const route = context.ownerAuthDependencies.route(pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void Promise.resolve(route.handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

async function load(configPath: string): Promise<WorkbenchContext> {
  const context = await boot('workbench-test', configPath) as WorkbenchContext
  contexts.push(context)
  return context
}

describe('built Workbench Host through the real DSH Loader', () => {
  it('rejects invalid Owner auth Config before publishing its injected Service', async () => {
    expect(existsSync(ownerAuthEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, invalidOwnerAuthConfig(ownerAuthEntry))

    await expect(boot('workbench-test', test.configPath)).rejects.toThrow(
      /failed to apply loader entry workbench-auth|maxSessions/u,
    )
  })

  it('rejects invalid runtime Config before publishing the service or opening SQLite', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath, 0))

    await expect(boot('workbench-test', test.configPath)).rejects.toThrow(
      /failed to apply loader entry workbench-host|maxStatusLength/u,
    )
    expect(existsSync(test.databasePath)).toBe(false)
  })

  it('commits through the public command, disposes cleanly, and recovers after restart', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const first = await load(test.configPath)
    const firstService = first.workbench
    expect(WORKBENCH_REMOTE_METHODS.filter(
      method => typeof Reflect.get(firstService, method) === 'function',
    )).toEqual(WORKBENCH_REMOTE_METHODS)
    await expect(firstService.snapshot(new AbortController().signal)).rejects.toMatchObject({
      failure: { code: 'unauthorized' },
    })
    await expect(firstService.projectStart(
      { limit: 10 },
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(firstService.projectTeam(
      { projectId: 'project-secret' },
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(firstService.getProjectMilestones(
      { projectId: 'project-secret' },
      new AbortController().signal,
    )).rejects.toMatchObject({ failure: { code: 'unauthorized' } })
    await expect(first.workbenchAuth.run(() =>
      firstService.snapshot(new AbortController().signal))).resolves.toBeNull()
    const initialProjects: ProjectStartProjection = await first.workbenchAuth.run(() =>
      firstService.projectStart({ limit: 10 }, new AbortController().signal))
    expect(initialProjects).toMatchObject({
      catalogRevision: 0,
      projects: [],
      nextBeforeSequence: null,
      template: {
        selection: {
          templateId: 'knowledge-work',
          templateVersion: 1,
          definitionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        },
        definition: {
          snapshotSchemaVersion: 1,
          kind: 'knowledge-work',
          rules: { minimumOutcomeCount: 1, primaryGoalRequired: true },
        },
      },
    })
    const initialActivity = await first.workbenchAuth.run(() => firstService.activity(
      { projectId: null, limit: 10 },
      new AbortController().signal,
    ))
    expect(initialActivity).toMatchObject({
      items: [],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 0, issue: null },
    })
    expect(initialActivity.integrity.headHash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    await expect(first.workbenchAuth.run(() =>
      firstService.auditIntegrity(new AbortController().signal))).resolves.toEqual(
      initialActivity.integrity,
    )
    const committed: SetStatusResult = await first.workbenchAuth.run(() => firstService.setStatus(
      statusRequest(
        'Loader-owned durable status',
        'loader-idempotency-key-0001',
        'loader-causation-id-0001',
      ),
      new AbortController().signal,
    ))
    expect(committed).toMatchObject({
      ok: true,
      value: {
        message: 'Loader-owned durable status',
        revision: 1,
      },
      receipt: {
        commandId: expect.stringMatching(/^command-/u),
        auditEventId: expect.stringMatching(/^audit-/u),
        outboxId: expect.stringMatching(/^outbox-/u),
      },
    })
    if (!committed.ok) throw new Error('expected the initial status commit to succeed')
    const expected: WorkbenchStatusSnapshot = committed.value
    const activity = await first.workbenchAuth.run(() => firstService.activity({
      projectId: null,
      objectType: 'workbench-status',
      objectId: expected.id,
      action: 'workbench.status.updated',
      limit: 10,
    }, new AbortController().signal))
    expect(activity).toMatchObject({
      items: [{
        eventId: committed.receipt.auditEventId,
        action: 'workbench.status.updated',
        reason: 'owner-status-edit',
        causationId: 'loader-causation-id-0001',
        commandId: committed.receipt.commandId,
        object: { id: expected.id, version: 1 },
        outbox: { id: committed.receipt.outboxId, state: 'pending' },
      }],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 1, issue: null },
    })
    expect(activity.items).toHaveLength(1)
    expect(JSON.stringify(activity)).not.toContain('Loader-owned durable status')
    expect(activity.integrity.headHash).toBe(activity.items[0]?.hash)
    await expect(first.workbenchAuth.run(() =>
      firstService.auditIntegrity(new AbortController().signal))).resolves.toEqual(
      activity.integrity,
    )

    const createdResult: CreateProjectResult = await first.workbenchAuth.run(() =>
      firstService.createProject({
        template: initialProjects.template.selection,
        projectName: 'Loader-created Project',
        primaryGoal: {
          name: 'Shorten Loader feedback time',
          outcomes: [{
            name: 'Reduce feedback latency',
            metric: {
              metricName: 'Feedback latency',
              initialValue: 10,
              targetValue: 4,
              unit: 'days',
              direction: 'decrease',
            },
          }],
        },
        supportingGoals: [],
        expectedCatalogRevision: initialProjects.catalogRevision,
        expectedRevision: null,
        idempotencyKey: 'loader-project-idempotency-0001',
        causationId: 'loader-project-causation-0001',
        reason: 'owner-project-create',
      }, new AbortController().signal))
    expect(createdResult).toMatchObject({
      ok: true,
      catalogRevision: 1,
      value: {
        project: {
          name: 'Loader-created Project',
          revision: 1,
          catalogSequence: 1,
          timezone: 'Asia/Shanghai',
        },
        primaryGoal: {
          name: 'Shorten Loader feedback time',
          revision: 1,
          outcomes: [{
            name: 'Reduce feedback latency',
            revision: 1,
            metric: {
              metricName: 'Feedback latency',
              initialValue: 10,
              targetValue: 4,
              unit: 'days',
              direction: 'decrease',
            },
          }],
        },
        supportingGoals: [],
        templateSnapshot: {
          template: initialProjects.template.selection,
          snapshotSchemaVersion: 1,
          definition: initialProjects.template.definition,
          snapshotDigest: initialProjects.template.selection.definitionDigest,
        },
      },
      receipt: {
        commandId: expect.stringMatching(/^command-/u),
        auditEventId: expect.stringMatching(/^audit-/u),
        outboxId: expect.stringMatching(/^outbox-/u),
      },
    })
    if (!createdResult.ok) throw new Error('expected Loader Project creation to succeed')
    const createdProject: ProjectDetailProjection = createdResult.value
    await expect(first.workbenchAuth.run(() => firstService.project(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))).resolves.toEqual(createdProject)
    await expect(first.workbenchAuth.run(() => firstService.projectStart(
      { limit: 10 },
      new AbortController().signal,
    ))).resolves.toMatchObject({
      catalogRevision: 1,
      projects: [{
        projectId: createdProject.project.projectId,
        primaryGoal: { goalId: createdProject.primaryGoal.goalId },
      }],
      nextBeforeSequence: null,
    })
    const unboundMilestones = await first.workbenchAuth.run(() =>
      firstService.getProjectMilestones(
        { projectId: createdProject.project.projectId },
        new AbortController().signal,
      ))
    expect(unboundMilestones).toEqual({
      projectId: createdProject.project.projectId,
      revision: 0,
      binding: null,
      milestones: [],
      sync: {
        state: 'unbound',
        lastEventAt: null,
        lastReconciledAt: null,
        lastAttemptAt: null,
        issue: null,
      },
      effects: [],
      recentChanges: [],
    } satisfies ProjectMilestonesProjection)
    const projectActivity = await first.workbenchAuth.run(() => firstService.activity({
      projectId: createdProject.project.projectId,
      objectType: 'project',
      objectId: createdProject.project.projectId,
      action: 'workbench.project.created',
      limit: 10,
    }, new AbortController().signal))
    expect(projectActivity).toMatchObject({
      items: [{
        eventId: createdResult.receipt.auditEventId,
        projectId: createdProject.project.projectId,
        action: 'workbench.project.created',
        reason: 'owner-project-create',
        causationId: 'loader-project-causation-0001',
        commandId: createdResult.receipt.commandId,
        object: {
          type: 'project',
          id: createdProject.project.projectId,
          version: 1,
        },
        summaryCode: 'project-created-from-template',
        outbox: { id: createdResult.receipt.outboxId, state: 'pending' },
      }],
      nextBeforeSequence: null,
      integrity: { valid: true, eventCount: 2, issue: null },
    })
    expect(JSON.stringify(projectActivity)).not.toContain('Loader-created Project')
    expect(JSON.stringify(projectActivity)).not.toContain('Shorten Loader feedback time')
    expect(JSON.stringify(projectActivity)).not.toContain('Feedback latency')
    expect(projectActivity.integrity.headHash).toBe(projectActivity.items[0]?.hash)

    const initialTeam = await first.workbenchAuth.run(() => firstService.projectTeam(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))
    expect(initialTeam).toEqual({
      projectId: createdProject.project.projectId,
      teamRevision: 0,
      members: [],
      responsibility: null,
    })

    const feishuMember: AddProjectMemberResult = await first.workbenchAuth.run(() =>
      firstService.addProjectMember({
        projectId: createdProject.project.projectId,
        member: {
          kind: 'human',
          displayName: 'Loader Feishu Sponsor',
          identity: {
            type: 'feishu',
            appId: 'cli_loader_test',
            openId: 'ou_loader_sponsor',
          },
        },
        expectedTeamRevision: 0,
        expectedRevision: null,
        idempotencyKey: 'loader-member-idempotency-0001',
        causationId: 'loader-member-causation-0001',
        reason: 'owner-project-member-add',
      }, new AbortController().signal))
    expect(feishuMember).toMatchObject({
      ok: true,
      value: {
        projectId: createdProject.project.projectId,
        kind: 'human',
        status: 'active',
        memberRevision: 1,
        teamRevision: 1,
      },
      receipt: {
        commandId: expect.stringMatching(/^command-/u),
        auditEventId: expect.stringMatching(/^audit-/u),
        outboxId: expect.stringMatching(/^outbox-/u),
      },
    })
    if (!feishuMember.ok) throw new Error('expected Feishu human member creation to succeed')
    expect(JSON.stringify(feishuMember)).not.toContain('Loader Feishu Sponsor')
    expect(JSON.stringify(feishuMember)).not.toContain('cli_loader_test')
    expect(JSON.stringify(feishuMember)).not.toContain('ou_loader_sponsor')

    const externalMember: AddProjectMemberResult = await first.workbenchAuth.run(() =>
      firstService.addProjectMember({
        projectId: createdProject.project.projectId,
        member: {
          kind: 'human',
          displayName: 'Loader External Contributor',
          identity: {
            type: 'external',
            method: 'email',
            value: 'external-loader@example.test',
          },
        },
        expectedTeamRevision: 1,
        expectedRevision: null,
        idempotencyKey: 'loader-member-idempotency-0002',
        causationId: 'loader-member-causation-0002',
        reason: 'owner-project-member-add',
      }, new AbortController().signal))
    expect(externalMember).toMatchObject({ ok: true, value: { teamRevision: 2 } })
    if (!externalMember.ok) throw new Error('expected external human member creation to succeed')
    expect(JSON.stringify(externalMember)).not.toContain('external-loader@example.test')

    const agentMember: AddProjectMemberResult = await first.workbenchAuth.run(() =>
      firstService.addProjectMember({
        projectId: createdProject.project.projectId,
        member: { kind: 'agent', displayName: 'Loader Research Agent' },
        expectedTeamRevision: 2,
        expectedRevision: null,
        idempotencyKey: 'loader-member-idempotency-0003',
        causationId: 'loader-member-causation-0003',
        reason: 'owner-project-member-add',
      }, new AbortController().signal))
    expect(agentMember).toMatchObject({ ok: true, value: { kind: 'agent', teamRevision: 3 } })
    if (!agentMember.ok) throw new Error('expected Agent member creation to succeed')
    expect(JSON.stringify(agentMember)).not.toContain('Loader Research Agent')

    const responsibility: SetProjectResponsibilityResult = await first.workbenchAuth.run(() =>
      firstService.setProjectResponsibility({
        projectId: createdProject.project.projectId,
        accountableMemberId: agentMember.value.memberId,
        contributorMemberIds: [externalMember.value.memberId],
        humanSponsorMemberId: feishuMember.value.memberId,
        expectedTeamRevision: 3,
        expectedResponsibilityRevision: null,
        idempotencyKey: 'loader-responsibility-idempotency-0001',
        causationId: 'loader-responsibility-causation-0001',
        reason: 'owner-project-responsibility-set',
      }, new AbortController().signal))
    expect(responsibility).toMatchObject({
      ok: true,
      value: {
        projectId: createdProject.project.projectId,
        responsibilityRevision: 1,
        teamRevision: 4,
      },
    })
    if (!responsibility.ok) throw new Error('expected Project responsibility to succeed')

    const loadedTeam = await first.workbenchAuth.run(() =>
      firstService.projectTeam(
        { projectId: createdProject.project.projectId },
        new AbortController().signal,
      ))
    if (loadedTeam === null) throw new Error('expected committed Project Team to be readable')
    const committedTeam: ProjectTeamProjection = loadedTeam
    expect(committedTeam).toMatchObject({
      projectId: createdProject.project.projectId,
      teamRevision: 4,
      responsibility: {
        revision: 1,
        accountableMemberId: agentMember.value.memberId,
        contributorMemberIds: [externalMember.value.memberId],
        humanSponsorMemberId: feishuMember.value.memberId,
      },
    })
    expect(committedTeam.members).toHaveLength(3)
    expect(committedTeam.members.find(member => member.memberId === feishuMember.value.memberId))
      .toMatchObject({
        kind: 'human',
        status: 'active',
        identity: {
          type: 'feishu',
          appId: 'cli_loader_test',
          openId: 'ou_loader_sponsor',
          state: 'declared',
        },
        feishuAssigneeEligibility: 'identifier-present',
      })
    expect(committedTeam.members.find(member => member.memberId === externalMember.value.memberId))
      .toMatchObject({
        kind: 'human',
        identity: { type: 'external', method: 'email' },
        feishuAssigneeEligibility: 'external-contact',
      })
    expect(committedTeam.members.find(member => member.memberId === agentMember.value.memberId))
      .toMatchObject({
        kind: 'agent',
        feishuAssigneeEligibility: 'agent-not-assignable',
      })
    const teamActivity = await first.workbenchAuth.run(() => firstService.activity({
      projectId: createdProject.project.projectId,
      limit: 20,
    }, new AbortController().signal))
    expect(teamActivity).toMatchObject({
      items: [
        {
          action: 'workbench.project.responsibility-assigned',
          reason: 'owner-project-responsibility-set',
          object: { type: 'project-responsibility', version: 1 },
          summaryCode: 'project-responsibility-assigned',
        },
        { action: 'workbench.project-member.created' },
        { action: 'workbench.project-member.created' },
        { action: 'workbench.project-member.created' },
        { action: 'workbench.project.created' },
      ],
      integrity: { valid: true, eventCount: 6, issue: null },
    })
    expect(teamActivity.items).toHaveLength(5)
    const serializedTeamActivity = JSON.stringify(teamActivity)
    for (const protectedValue of [
      'Loader Feishu Sponsor',
      'cli_loader_test',
      'ou_loader_sponsor',
      'Loader External Contributor',
      'external-loader@example.test',
      'Loader Research Agent',
    ]) {
      expect(serializedTeamActivity).not.toContain(protectedValue)
    }

    const proposedChange: ProposeProjectResponsibilityChangeResult = await first.workbenchAuth.run(
      () => firstService.proposeProjectResponsibilityChange({
        projectId: createdProject.project.projectId,
        candidate: {
          accountableMemberId: agentMember.value.memberId,
          contributorMemberIds: [],
          humanSponsorMemberId: feishuMember.value.memberId,
        },
        expectedTeamRevision: 4,
        evidenceRefs: [{
          kind: 'workbench-audit-event',
          auditEventId: responsibility.receipt.auditEventId,
        }],
        idempotencyKey: 'loader-suggested-change-idempotency-0001',
        causationId: 'loader-suggested-change-causation-0001',
        reason: 'owner-suggested-change-propose',
      }, new AbortController().signal),
    )
    expect(proposedChange).toMatchObject({
      ok: true,
      value: {
        suggestedChangeRevision: 1,
        targetAdapter: 'project-responsibility.replace',
        baseTargetVersion: 4,
        persistedState: 'pending',
        riskLevel: 'low',
      },
      receipt: {
        commandId: expect.stringMatching(/^command-/u),
        auditEventId: expect.stringMatching(/^audit-/u),
        outboxId: expect.stringMatching(/^outbox-/u),
      },
    })
    if (!proposedChange.ok) throw new Error('expected SuggestedChange proposal to succeed')

    const pendingReview = await first.workbenchAuth.run(() => firstService.reviewCenter({
      projectId: createdProject.project.projectId,
      status: 'pending',
      riskLevel: 'low',
      limit: 10,
    }, new AbortController().signal))
    if (pendingReview === null) throw new Error('expected Project Review Center to be readable')
    expect(pendingReview).toMatchObject({
      projectId: createdProject.project.projectId,
      proposalBuilder: {
        projectId: createdProject.project.projectId,
        teamRevision: 4,
        responsibilityRevision: 1,
        base: {
          accountableMemberId: agentMember.value.memberId,
          contributorMemberIds: [externalMember.value.memberId],
          humanSponsorMemberId: feishuMember.value.memberId,
        },
      },
      items: [{
        suggestedChangeId: proposedChange.value.suggestedChangeId,
        revision: 1,
        source: { kind: 'owner' },
        target: {
          kind: 'project-responsibility',
          adapter: 'project-responsibility.replace',
          baseTeamRevision: 4,
          baseResponsibilityRevision: 1,
          currentTeamRevision: 4,
          currentResponsibilityRevision: 1,
        },
        proposedDiff: {
          kind: 'project-responsibility.diff',
          schemaVersion: 1,
          before: { contributorMemberIds: [externalMember.value.memberId] },
          after: { contributorMemberIds: [] },
          changedFields: ['contributors'],
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
        evidence: [{
          kind: 'workbench-audit-event',
          auditEventId: responsibility.receipt.auditEventId,
          action: 'workbench.project.responsibility-assigned',
        }],
        risk: {
          proposedLevel: 'low',
          effectiveLevel: 'low',
          proposedReasonCodes: ['contributors-only'],
          policyVersion: 'project-responsibility-v1',
          batchPolicy: { policy: 'eligible-later' },
        },
        originCausationId: 'loader-suggested-change-causation-0001',
        persistedState: 'pending',
        effectiveStatus: 'pending',
        decisions: [],
      }],
      nextBeforeSequence: null,
    })
    expect(pendingReview.items[0]?.allowedDecisions).toEqual(expect.arrayContaining([
      'accept',
      'edit-and-accept',
      'reject',
      'defer',
    ]))
    expect(pendingReview.proposalBuilder.memberOptions.find(
      member => member.memberId === externalMember.value.memberId,
    )).toMatchObject({
      kind: 'human',
      requiresHumanSponsor: true,
      canBeHumanSponsor: true,
    })
    expect(pendingReview.proposalBuilder.memberOptions.find(
      member => member.memberId === feishuMember.value.memberId,
    )).toMatchObject({
      kind: 'human',
      requiresHumanSponsor: false,
      canBeHumanSponsor: true,
    })

    const acceptedChange: DecideSuggestedChangeResult = await first.workbenchAuth.run(() =>
      firstService.decideSuggestedChange({
        projectId: createdProject.project.projectId,
        suggestedChangeId: proposedChange.value.suggestedChangeId,
        expectedSuggestedChangeRevision: 1,
        mode: 'accept',
        acknowledgedRiskLevel: 'low',
        feedback: 'The evidence supports removing the completed contributor assignment.',
        idempotencyKey: 'loader-suggested-change-decision-idempotency-0001',
        causationId: 'loader-suggested-change-decision-causation-0001',
        reason: 'owner-suggested-change-accept',
      }, new AbortController().signal))
    expect(acceptedChange).toMatchObject({
      ok: true,
      value: {
        suggestedChangeId: proposedChange.value.suggestedChangeId,
        suggestedChangeRevision: 2,
        persistedState: 'accepted',
        decisionMode: 'accepted',
        riskLevel: 'low',
        appliedTeamRevision: 5,
        appliedResponsibilityRevision: 2,
      },
    })
    if (!acceptedChange.ok) throw new Error('expected SuggestedChange acceptance to succeed')

    const acceptedTeam = await first.workbenchAuth.run(() => firstService.projectTeam(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))
    expect(acceptedTeam).toMatchObject({
      projectId: createdProject.project.projectId,
      teamRevision: 5,
      responsibility: {
        revision: 2,
        accountableMemberId: agentMember.value.memberId,
        contributorMemberIds: [],
        humanSponsorMemberId: feishuMember.value.memberId,
      },
    })
    if (acceptedTeam === null) throw new Error('expected accepted Responsibility to be readable')

    const acceptedReviewResult = await first.workbenchAuth.run(() => firstService.reviewCenter({
      projectId: createdProject.project.projectId,
      status: 'accepted',
      riskLevel: 'low',
      limit: 10,
    }, new AbortController().signal))
    if (acceptedReviewResult === null) throw new Error('expected accepted Review to be readable')
    const acceptedReview: ReviewCenterProjection = acceptedReviewResult
    expect(acceptedReview).toMatchObject({
      proposalBuilder: { teamRevision: 5, responsibilityRevision: 2 },
      items: [{
        suggestedChangeId: proposedChange.value.suggestedChangeId,
        revision: 2,
        target: { currentTeamRevision: 5, currentResponsibilityRevision: 2 },
        persistedState: 'accepted',
        effectiveStatus: 'accepted',
        allowedDecisions: [],
        decisions: [{
          mode: 'accepted',
          feedback: 'The evidence supports removing the completed contributor assignment.',
          appliedTeamRevision: 5,
          appliedResponsibilityRevision: 2,
          causationId: 'loader-suggested-change-decision-causation-0001',
        }],
      }],
    })

    const acceptedActivity = await first.workbenchAuth.run(() => firstService.activity({
      projectId: createdProject.project.projectId,
      action: 'workbench.suggested-change.accepted',
      limit: 10,
    }, new AbortController().signal))
    expect(acceptedActivity).toMatchObject({
      items: [{
        eventId: acceptedChange.receipt.auditEventId,
        action: 'workbench.suggested-change.accepted',
        reason: 'owner-suggested-change-accept',
        object: {
          type: 'suggested-change',
          id: proposedChange.value.suggestedChangeId,
          version: 2,
        },
        summaryCode: 'suggested-change-accepted',
      }],
      integrity: { valid: true, eventCount: 8, issue: null },
    })
    expect(acceptedActivity.items).toHaveLength(1)
    const serializedAcceptedActivity = JSON.stringify(acceptedActivity)
    expect(serializedAcceptedActivity).not.toContain(
      'The evidence supports removing the completed contributor assignment.',
    )
    expect(serializedAcceptedActivity).not.toContain(responsibility.receipt.auditEventId)

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    expect(first.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')

    const restarted = await load(test.configPath)
    await expect(restarted.workbenchAuth.run(() =>
      restarted.workbench.snapshot(new AbortController().signal))).resolves.toEqual(expected)
    const restartWorkspaceActivity = await restarted.workbenchAuth.run(() => restarted.workbench.activity(
      { projectId: null, limit: 10 },
      new AbortController().signal,
    ))
    expect(restartWorkspaceActivity.items).toEqual(activity.items)
    expect(restartWorkspaceActivity.nextBeforeSequence).toBe(activity.nextBeforeSequence)
    expect(restartWorkspaceActivity.integrity).toEqual(acceptedActivity.integrity)
    await expect(restarted.workbenchAuth.run(() => restarted.workbench.project(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))).resolves.toEqual(createdProject)
    await expect(restarted.workbenchAuth.run(() => restarted.workbench.projectStart(
      { limit: 10 },
      new AbortController().signal,
    ))).resolves.toMatchObject({
      catalogRevision: 1,
      projects: [{ projectId: createdProject.project.projectId }],
      nextBeforeSequence: null,
    })
    await expect(restarted.workbenchAuth.run(() => restarted.workbench.projectTeam(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))).resolves.toEqual(acceptedTeam)
    await expect(restarted.workbenchAuth.run(() => restarted.workbench.getProjectMilestones(
      { projectId: createdProject.project.projectId },
      new AbortController().signal,
    ))).resolves.toEqual(unboundMilestones)
    await expect(restarted.workbenchAuth.run(() => restarted.workbench.reviewCenter({
      projectId: createdProject.project.projectId,
      status: 'accepted',
      riskLevel: 'low',
      limit: 10,
    }, new AbortController().signal))).resolves.toEqual(acceptedReview)
    await expect(restarted.workbenchAuth.run(() =>
      restarted.workbench.auditIntegrity(new AbortController().signal))).resolves.toEqual(
      acceptedActivity.integrity,
    )
    await restarted.fiber.dispose()
    contexts.splice(contexts.indexOf(restarted), 1)
    expect(restarted.get('workbench')).toBeUndefined()
  })

  it('withdraws and remounts the built Host cleanly through one live Loader entry', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const context = await load(test.configPath)
    const entry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-host')
    if (entry === undefined) throw new Error('real Loader did not publish workbench-host entry')
    const firstService = context.workbench
    const committed = await context.workbenchAuth.run(() => firstService.setStatus(
      statusRequest(
        'same-process HMR status',
        'loader-hmr-idempotency-0001',
        'loader-hmr-causation-0001',
      ),
      new AbortController().signal,
    ))
    if (!committed.ok) throw new Error('expected the HMR fixture commit to succeed')

    await entry.update({ disabled: true })
    await context.loader.await()
    expect(entry.fiber).toBeUndefined()
    expect(context.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')
    expect((firstService.scenario.options.repository as { closed?: boolean }).closed).toBe(true)

    await entry.update({ disabled: false })
    await context.loader.await()
    expect(entry.fiber).toBeDefined()
    expect(context.get('workbench')).toBeDefined()
    expect(context.workbench).not.toBe(firstService)
    await expect(context.workbenchAuth.run(() =>
      context.workbench.snapshot(new AbortController().signal))).resolves.toEqual(committed.value)
    const remountedActivity = await context.workbenchAuth.run(() => context.workbench.activity(
      { projectId: null, limit: 10 },
      new AbortController().signal,
    ))
    expect(remountedActivity).toMatchObject({
      items: [{
        eventId: committed.receipt.auditEventId,
        causationId: 'loader-hmr-causation-0001',
        outbox: { id: committed.receipt.outboxId, state: 'pending' },
      }],
      integrity: { valid: true, eventCount: 1, issue: null },
    })
    expect(remountedActivity.integrity.headHash).toBe(remountedActivity.items[0]?.hash)
    await expect(context.workbenchAuth.run(() =>
      context.workbench.auditIntegrity(new AbortController().signal))).resolves.toEqual(
      remountedActivity.integrity,
    )

    const replacement = context.workbench
    await entry.update({ disabled: true })
    await context.loader.await()
    expect(context.get('workbench')).toBeUndefined()
    expect(replacement.scenario.lifecycle).toBe('closed')
    expect((replacement.scenario.options.repository as { closed?: boolean }).closed).toBe(true)
  })

  it('withdraws and remounts the real Owner auth provider, both routes, and its Host consumer', async () => {
    expect(existsSync(ownerAuthEntry)).toBe(true)
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, realOwnerAuthConfig(test.databasePath))

    const context = await load(test.configPath)
    const origin = await openFixtureCarrier(context)
    const authEntry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-auth')
    const hostLoaderEntry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-host')
    if (authEntry === undefined || hostLoaderEntry === undefined) {
      throw new Error('real Loader did not publish both Workbench entries')
    }
    const firstAuth = context.workbenchAuth
    const firstHost = context.workbench
    expect(context.ownerAuthDependencies.routes.size).toBe(2)
    expect(context.ownerAuthDependencies.routes.has('prefix:/api/workbench-auth')).toBe(true)
    expect(context.ownerAuthDependencies.routes.has('prefix:/api/workbench')).toBe(true)

    const initialized = await fetch(`${origin}/api/workbench-auth/initialize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'Loader-HMR-owner-passphrase-2026!' }),
    })
    expect(initialized.status).toBe(201)
    const setCookie = initialized.headers.get('set-cookie')
    if (setCookie === null) throw new Error('Owner initialization omitted its session cookie')
    const cookie = setCookie.split(';', 1)[0]
    expect(cookie).toMatch(/^__Host-dsh-workbench-session=/u)

    await authEntry.update({ disabled: true })
    await context.loader.await()
    expect(authEntry.fiber).toBeUndefined()
    expect(context.get('workbenchAuth')).toBeUndefined()
    expect(context.get('workbench')).toBeUndefined()
    expect(firstAuth.routeLifecycle).toBe('closed')
    expect(firstHost.scenario.lifecycle).toBe('closed')
    expect(context.ownerAuthDependencies.routes.size).toBe(0)
    await expect(fetch(`${origin}/api/workbench-auth/state`)).resolves.toMatchObject({ status: 404 })
    await expect(fetch(`${origin}/api/workbench/probe`)).resolves.toMatchObject({ status: 404 })

    await authEntry.update({ disabled: false })
    await context.loader.await()
    expect(authEntry.fiber).toBeDefined()
    expect(hostLoaderEntry.fiber).toBeDefined()
    expect(context.workbenchAuth).not.toBe(firstAuth)
    expect(context.workbench).not.toBe(firstHost)
    expect(context.ownerAuthDependencies.routes.size).toBe(2)

    const restored = await fetch(`${origin}/api/workbench-auth/state`, {
      headers: { cookie },
    })
    expect(restored.status).toBe(200)
    await expect(restored.json()).resolves.toMatchObject({
      ok: true,
      value: { state: 'signed-in' },
    })
    const forwarded = await fetch(`${origin}/api/workbench/probe`, {
      headers: { cookie },
    })
    expect(forwarded.status).toBe(418)
    await expect(forwarded.text()).resolves.toBe('shared Workbench API')
  })
})
