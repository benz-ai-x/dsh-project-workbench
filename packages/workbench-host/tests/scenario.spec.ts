import { describe, expect, it } from 'vitest'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CreateProjectRequest,
  CreateProjectResult,
  ProjectDetailProjection,
  ProjectStartProjection,
  SetStatusRequest,
  SetStatusResult,
  WorkbenchActivityProjection,
  WorkbenchActivityQuery,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxClaim,
  WorkbenchOutboxClaimRequest,
  WorkbenchOutboxSettlement,
  WorkbenchProjectMutation,
  WorkbenchProjectReadQuery,
  WorkbenchProjectStartQuery,
  WorkbenchRepository,
  WorkbenchStatusMutation,
  WorkbenchStatusSnapshot,
} from '../src/index.ts'

const TEST_AUDIT_GENESIS = `sha256:${'0'.repeat(64)}`
import {
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
  KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
  WorkbenchScenario,
} from '../src/index.ts'
import { WorkbenchAuthorizationContext, type WorkbenchAuthorization } from '../src/authorization.ts'

const authorization = Object.freeze({
  require: () => Promise.resolve(Object.freeze({
    ownerId: 'owner-test',
    organizationId: 'organization-test',
    teamId: 'team-test',
  })),
  filterProjection: <T>(_action: string, projection: T) => Promise.resolve(projection),
})

class MemoryRepository implements WorkbenchRepository {
  state: WorkbenchStatusSnapshot | null = null
  openCalls = 0
  closeCalls = 0
  readCalls = 0
  writeCalls = 0
  activityCalls = 0
  integrityCalls = 0
  projectStartCalls = 0
  projectWriteCalls = 0
  projectReadCalls = 0
  catalogRevision = 0
  readonly projects = new Map<string, ProjectDetailProjection>()
  onSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined
  onSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  afterSetStatus: ((signal: AbortSignal) => Promise<void>) | undefined
  onCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined
  afterCreateProject: ((signal: AbortSignal) => Promise<void>) | undefined

  async open(): Promise<void> {
    this.openCalls += 1
  }

  async snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null> {
    this.readCalls += 1
    await this.onSnapshot?.(signal)
    return this.state === null ? null : { ...this.state }
  }

  lastMutation: WorkbenchStatusMutation | null = null

  async commitStatus(
    mutation: WorkbenchStatusMutation,
    signal: AbortSignal,
  ): Promise<SetStatusResult> {
    this.writeCalls += 1
    this.lastMutation = mutation
    await this.onSetStatus?.(signal)
    const actualRevision = this.state?.revision ?? null
    if (actualRevision !== mutation.expectedRevision) {
      return {
        ok: false,
        error: {
          code: 'revision-conflict',
          message: 'fixture conflict',
          current: this.state === null ? null : { ...this.state },
        },
      }
    }
    this.state = this.state === null
      ? {
        id: mutation.candidateId,
        message: mutation.message,
        revision: 1,
        updatedAt: mutation.updatedAt,
      }
      : {
        ...this.state,
        message: mutation.message,
        revision: this.state.revision + 1,
        updatedAt: mutation.updatedAt,
      }
    await this.afterSetStatus?.(signal)
    return {
      ok: true,
      value: { ...this.state },
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
    }
  }

  lastProjectStartQuery: WorkbenchProjectStartQuery | null = null

  async readProjectStart(
    query: WorkbenchProjectStartQuery,
  ): Promise<ProjectStartProjection> {
    this.projectStartCalls += 1
    this.lastProjectStartQuery = query
    const limit = query.filter.limit ?? 20
    const projects = [...this.projects.values()]
      .map(value => value.project)
      .filter(value => query.filter.beforeSequence === undefined
        || value.catalogSequence < query.filter.beforeSequence)
      .sort((left, right) => right.catalogSequence - left.catalogSequence)
      .slice(0, limit)
    return {
      template: KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
      catalogRevision: this.catalogRevision,
      projects,
      nextBeforeSequence: projects.length === limit
        ? projects.at(-1)?.catalogSequence ?? null
        : null,
    }
  }

  lastProjectMutation: WorkbenchProjectMutation | null = null

  async commitProject(
    mutation: WorkbenchProjectMutation,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    this.projectWriteCalls += 1
    this.lastProjectMutation = mutation
    await this.onCreateProject?.(signal)
    if (mutation.expectedCatalogRevision !== this.catalogRevision) {
      return {
        ok: false,
        error: {
          code: 'catalog-revision-conflict',
          message: 'fixture catalog conflict',
          expectedCatalogRevision: mutation.expectedCatalogRevision,
          currentCatalogRevision: this.catalogRevision,
        },
      }
    }
    this.catalogRevision += 1
    const primaryGoal = {
      goalId: mutation.primaryGoalId,
      name: mutation.primaryGoal.name,
      revision: 1,
      outcomes: mutation.primaryGoal.outcomes.map(outcome => ({
        outcomeId: outcome.outcomeId,
        name: outcome.name,
        revision: 1,
        metric: { ...outcome.metric },
      })),
    }
    const supportingGoals = mutation.supportingGoals.map(reference => {
      const source = [...this.projects.values()].find(candidate =>
        candidate.primaryGoal.goalId === reference.goalId)
      if (source === undefined || source.primaryGoal.revision !== reference.expectedRevision) {
        throw new Error('fixture Supporting Goal does not satisfy its revision precondition')
      }
      return {
        goalId: source.primaryGoal.goalId,
        name: source.primaryGoal.name,
        revision: source.primaryGoal.revision,
      }
    })
    const detail: ProjectDetailProjection = {
      project: {
        projectId: mutation.projectId,
        name: mutation.projectName,
        revision: 1,
        catalogSequence: this.catalogRevision,
        timezone: 'Asia/Shanghai',
        createdAt: mutation.createdAt,
        primaryGoal: {
          goalId: primaryGoal.goalId,
          name: primaryGoal.name,
          revision: primaryGoal.revision,
        },
      },
      primaryGoal,
      supportingGoals,
      templateSnapshot: {
        template: { ...mutation.template },
        snapshotSchemaVersion: 1,
        definition: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
        snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
        capturedAt: mutation.createdAt,
      },
    }
    this.projects.set(mutation.projectId, detail)
    await this.afterCreateProject?.(signal)
    return {
      ok: true,
      value: detail,
      catalogRevision: this.catalogRevision,
      receipt: {
        commandId: mutation.command.commandId,
        auditEventId: mutation.command.auditEventId,
        outboxId: mutation.command.outboxId,
      },
    }
  }

  lastProjectReadQuery: WorkbenchProjectReadQuery | null = null

  async readProject(query: WorkbenchProjectReadQuery): Promise<ProjectDetailProjection | null> {
    this.projectReadCalls += 1
    this.lastProjectReadQuery = query
    return this.projects.get(query.projectId) ?? null
  }

  lastActivityQuery: WorkbenchActivityQuery | null = null

  async readActivity(query: WorkbenchActivityQuery): Promise<WorkbenchActivityProjection> {
    this.activityCalls += 1
    this.lastActivityQuery = query
    return Object.freeze({
      items: Object.freeze([]),
      nextBeforeSequence: null,
      integrity: Object.freeze({
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      }),
    })
  }

  async verifyAuditChain(): Promise<WorkbenchAuditIntegrityProjection> {
    this.integrityCalls += 1
    return Object.freeze({
      valid: true,
      eventCount: 0,
      headHash: TEST_AUDIT_GENESIS,
      issue: null,
    })
  }

  async claimOutbox(_request: WorkbenchOutboxClaimRequest): Promise<WorkbenchOutboxClaim | null> {
    return null
  }

  async settleOutbox(_settlement: WorkbenchOutboxSettlement): Promise<boolean> {
    return false
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

function createScenario(
  repository = new MemoryRepository(),
  access: WorkbenchAuthorization = authorization,
): {
  readonly repository: MemoryRepository
  readonly scenario: WorkbenchScenario
} {
  const instants = [
    new Date('2026-08-31T01:02:03.000Z'),
    new Date('2026-08-31T02:03:04.000Z'),
  ]
  const statusIds = ['status-001', 'status-002']
  const projectIds = ['project-001', 'project-002']
  const goalIds = ['goal-001', 'goal-002']
  const outcomeIds = ['outcome-001', 'outcome-002', 'outcome-003']
  const commandIds = ['command-001', 'command-002']
  const auditIds = ['audit-001', 'audit-002']
  const outboxIds = ['outbox-001', 'outbox-002']
  const adapters = { feishu: { adapterId: 'fixture-feishu' } } as const
  return {
    repository,
    scenario: new WorkbenchScenario({
      repository,
      clock: { now: () => instants.shift() ?? new Date('2026-08-31T03:04:05.000Z') },
      ids: {
        nextStatusId: () => statusIds.shift() ?? 'status-fallback',
        nextProjectId: () => projectIds.shift() ?? 'project-fallback',
        nextGoalId: () => goalIds.shift() ?? 'goal-fallback',
        nextOutcomeId: () => outcomeIds.shift() ?? 'outcome-fallback',
        nextCommandId: () => commandIds.shift() ?? 'command-fallback',
        nextAuditEventId: () => auditIds.shift() ?? 'audit-fallback',
        nextOutboxId: () => outboxIds.shift() ?? 'outbox-fallback',
      },
      adapters,
      authorization: access,
      maxStatusLength: 12,
    }),
  }
}

function failureCode(error: unknown): string | undefined {
  return error instanceof TypertRemoteFailure ? error.failure.code : undefined
}

function statusRequest(message: string, expectedRevision: number | null) {
  return {
    message,
    expectedRevision,
    idempotencyKey: 'idempotency-key-001',
    causationId: 'causation-id-000001',
    reason: 'owner-status-edit' as const,
  }
}

function projectRequest(overrides: Partial<CreateProjectRequest> = {}): CreateProjectRequest {
  return {
    template: {
      templateId: 'knowledge-work',
      templateVersion: 1,
      definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
    },
    projectName: 'Market research',
    primaryGoal: {
      name: 'Validate demand',
      outcomes: [{
        name: 'Complete qualified interviews',
        metric: {
          metricName: 'Qualified interviews',
          initialValue: 0,
          targetValue: 20,
          unit: 'interviews',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    expectedCatalogRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'project-idempotency-key-0001',
    causationId: 'project-causation-id-0001',
    reason: 'owner-project-create',
    ...overrides,
  }
}

describe('WorkbenchScenario', () => {
  it('drives a deterministic command through the repository into the public projection', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()

    await expect(scenario.snapshot()).resolves.toBeNull()
    await expect(scenario.setStatus(
      {
        ...statusRequest('  On track  ', null),
        actor: { kind: 'owner', id: 'browser-forged-owner' },
        organizationId: 'browser-forged-organization',
      } as SetStatusRequest,
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'On track',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await expect(scenario.snapshot()).resolves.toEqual({
      id: 'status-001',
      message: 'On track',
      revision: 1,
      updatedAt: '2026-08-31T01:02:03.000Z',
    })
    expect(repository.openCalls).toBe(1)
    expect(repository.lastMutation?.command).toMatchObject({
      actor: {
        kind: 'owner',
        id: 'owner-test',
        organizationId: 'organization-test',
        teamId: 'team-test',
      },
      idempotencyKey: 'idempotency-key-001',
      causationId: 'causation-id-000001',
      reason: 'owner-status-edit',
    })
    expect(scenario.adapters).toEqual({ feishu: { adapterId: 'fixture-feishu' } })

    await scenario.close()
  })

  it('reads Project start, creates deterministic Goal/Outcomes/Project, and reopens a detached snapshot', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    const start = await scenario.projectStart({}, signal)
    expect(start).toEqual({
      template: KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1,
      catalogRevision: 0,
      projects: [],
      nextBeforeSequence: null,
    })
    expect(repository.lastProjectStartQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      filter: { limit: 20 },
    })

    const created = await scenario.createProject(projectRequest({
      projectName: '  Market research  ',
      primaryGoal: {
        name: '  Validate demand  ',
        outcomes: [
          {
            name: '  Complete qualified interviews  ',
            metric: {
              metricName: '  Qualified interviews  ',
              initialValue: 0,
              targetValue: 20,
              unit: '  interviews  ',
              direction: 'increase',
            },
          },
          {
            name: 'Reduce unresolved assumptions',
            metric: {
              metricName: 'Unresolved assumptions',
              initialValue: 12,
              targetValue: 3,
              unit: 'assumptions',
              direction: 'decrease',
            },
          },
        ],
      },
    }), signal)

    expect(created).toMatchObject({
      ok: true,
      catalogRevision: 1,
      value: {
        project: {
          projectId: 'project-001',
          name: 'Market research',
          revision: 1,
          catalogSequence: 1,
          timezone: 'Asia/Shanghai',
          createdAt: '2026-08-31T01:02:03.000Z',
          primaryGoal: { goalId: 'goal-001', name: 'Validate demand', revision: 1 },
        },
        primaryGoal: {
          goalId: 'goal-001',
          outcomes: [
            { outcomeId: 'outcome-001', metric: { direction: 'increase' } },
            { outcomeId: 'outcome-002', metric: { direction: 'decrease' } },
          ],
        },
        templateSnapshot: {
          template: {
            definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
          },
          definition: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
          snapshotDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
        },
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    expect(repository.lastProjectMutation).toMatchObject({
      projectId: 'project-001',
      primaryGoalId: 'goal-001',
      projectName: 'Market research',
      primaryGoal: {
        name: 'Validate demand',
        outcomes: [
          { outcomeId: 'outcome-001', name: 'Complete qualified interviews' },
          { outcomeId: 'outcome-002', name: 'Reduce unresolved assumptions' },
        ],
      },
      expectedCatalogRevision: 0,
      expectedRevision: null,
      command: {
        actor: {
          kind: 'owner',
          id: 'owner-test',
          organizationId: 'organization-test',
          teamId: 'team-test',
        },
        reason: 'owner-project-create',
      },
    })
    if (!created.ok) throw new Error('fixture Project creation unexpectedly failed')
    expect(Object.isFrozen(created.value.primaryGoal.outcomes)).toBe(true)
    expect(Object.isFrozen(created.value.templateSnapshot.definition.rules)).toBe(true)

    await expect(scenario.project({ projectId: 'project-001' }, signal))
      .resolves.toEqual(created.value)
    expect(repository.lastProjectReadQuery).toEqual({
      organizationId: 'organization-test',
      teamId: 'team-test',
      projectId: 'project-001',
    })
    await expect(scenario.project({ projectId: 'project-missing' }, signal)).resolves.toBeNull()

    const linked = await scenario.createProject(projectRequest({
      projectName: 'Research synthesis',
      primaryGoal: {
        name: 'Turn evidence into a decision',
        outcomes: [{
          name: 'Publish the decision brief',
          metric: {
            metricName: 'Accepted decision briefs',
            initialValue: 0,
            targetValue: 1,
            unit: 'briefs',
            direction: 'increase',
          },
        }],
      },
      supportingGoals: [{ goalId: 'goal-001', expectedRevision: 1 }],
      expectedCatalogRevision: 1,
      idempotencyKey: 'project-idempotency-key-0002',
      causationId: 'project-causation-id-0002',
    }), signal)
    expect(linked).toMatchObject({
      ok: true,
      catalogRevision: 2,
      value: {
        project: { projectId: 'project-002', primaryGoal: { goalId: 'goal-002' } },
        primaryGoal: { goalId: 'goal-002', outcomes: [{ outcomeId: 'outcome-003' }] },
        supportingGoals: [{ goalId: 'goal-001', name: 'Validate demand', revision: 1 }],
      },
    })
    if (!linked.ok) throw new Error('fixture linked Project creation unexpectedly failed')
    await expect(scenario.project({ projectId: 'project-002' }, signal))
      .resolves.toEqual(linked.value)

    await scenario.close()
  })

  it('rejects invalid Project input before persistence and keeps domain conflicts typed', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal
    const base = projectRequest()
    const invalidRequests: unknown[] = [
      { ...base, actor: { kind: 'owner', id: 'browser-forged' } },
      { ...base, projectName: '   ' },
      { ...base, projectName: '\ud800' },
      { ...base, primaryGoal: { ...base.primaryGoal, outcomes: [] } },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, targetValue: Number.NaN },
          }],
        },
      },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, initialValue: -0 },
          }],
        },
      },
      {
        ...base,
        primaryGoal: {
          ...base.primaryGoal,
          outcomes: [{
            ...base.primaryGoal.outcomes[0],
            metric: { ...base.primaryGoal.outcomes[0]?.metric, targetValue: 0 },
          }],
        },
      },
      {
        ...base,
        supportingGoals: [
          { goalId: 'goal-existing', expectedRevision: 1 },
          { goalId: 'goal-existing', expectedRevision: 1 },
        ],
      },
      { ...base, expectedCatalogRevision: -1 },
      { ...base, expectedRevision: 1 },
      { ...base, reason: 'arbitrary-reason' },
    ]
    for (const request of invalidRequests) {
      const error = await scenario.createProject(request as CreateProjectRequest, signal)
        .catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.projectWriteCalls).toBe(0)

    repository.catalogRevision = 2
    await expect(scenario.createProject(projectRequest(), signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'catalog-revision-conflict',
        message: 'fixture catalog conflict',
        expectedCatalogRevision: 0,
        currentCatalogRevision: 2,
      },
    })
    await scenario.close()
  })

  it('returns revision conflict as a domain result with the current projection', async () => {
    const { scenario, repository } = createScenario()
    repository.state = {
      id: 'status-existing',
      message: 'Current',
      revision: 3,
      updatedAt: '2026-08-30T01:00:00.000Z',
    }
    await scenario.open()

    await expect(scenario.setStatus(
      statusRequest('Stale update', 2),
      new AbortController().signal,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'revision-conflict',
        message: 'fixture conflict',
        current: repository.state,
      },
    })

    await scenario.close()
  })

  it('rejects malformed commands before persistence with typed Remote failures', async () => {
    const { scenario, repository } = createScenario()
    await scenario.open()
    const signal = new AbortController().signal

    for (const request of [
      { ...statusRequest('   ', null) },
      { ...statusRequest('1234567890123', null) },
      { ...statusRequest('valid', 0) },
      { ...statusRequest('valid', null), idempotencyKey: 'short' },
      { ...statusRequest('valid', null), reason: 'raw user text' },
    ]) {
      const error = await scenario.setStatus(
        request as SetStatusRequest,
        signal,
      ).catch((reason: unknown) => reason)
      expect(failureCode(error)).toBe('bad-request')
    }
    expect(repository.writeCalls).toBe(0)

    const cancelled = new AbortController()
    cancelled.abort(new Error('caller left'))
    const error = await scenario.setStatus(
      statusRequest('valid', null),
      cancelled.signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(repository.writeCalls).toBe(0)

    await scenario.close()
  })

  it('fails closed at the shared authorization seam before reading or writing persistence', async () => {
    const repository = new MemoryRepository()
    const { scenario } = createScenario(repository, new WorkbenchAuthorizationContext())
    await scenario.open()

    const readError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(readError)).toBe('unauthorized')
    const writeError = await scenario.setStatus(
      statusRequest('Must not pass', null),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(writeError)).toBe('unauthorized')
    const projectStartError = await scenario.projectStart({}, new AbortController().signal)
      .catch((reason: unknown) => reason)
    expect(failureCode(projectStartError)).toBe('unauthorized')
    const createProjectError = await scenario.createProject(
      projectRequest(),
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(createProjectError)).toBe('unauthorized')
    const projectError = await scenario.project(
      { projectId: 'project-secret' },
      new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failureCode(projectError)).toBe('unauthorized')
    expect(repository.readCalls).toBe(0)
    expect(repository.writeCalls).toBe(0)
    expect(repository.activityCalls).toBe(0)
    expect(repository.integrityCalls).toBe(0)
    expect(repository.projectStartCalls).toBe(0)
    expect(repository.projectWriteCalls).toBe(0)
    expect(repository.projectReadCalls).toBe(0)

    await scenario.close()
  })

  it('derives Activity scope from authorization and validates safe filters before storage', async () => {
    const repository = new MemoryRepository()
    const required: string[] = []
    const filtered: string[] = []
    const access: WorkbenchAuthorization = {
      require: action => {
        required.push(action)
        return Promise.resolve({
          ownerId: 'owner-authoritative',
          organizationId: 'organization-authoritative',
          teamId: 'team-authoritative',
        })
      },
      filterProjection: (action, projection) => {
        filtered.push(action)
        return Promise.resolve(projection)
      },
    }
    const { scenario } = createScenario(repository, access)
    await scenario.open()

    await expect(scenario.activity({
      projectId: 'project-safe',
      objectType: 'workbench-status',
      objectId: 'status-safe',
      action: 'workbench.status.updated',
      beforeSequence: 4,
      limit: 10,
    })).resolves.toEqual({
      items: [],
      nextBeforeSequence: null,
      integrity: {
        valid: true,
        eventCount: 0,
        headHash: TEST_AUDIT_GENESIS,
        issue: null,
      },
    })
    expect(repository.lastActivityQuery).toEqual({
      organizationId: 'organization-authoritative',
      filter: {
        projectId: 'project-safe',
        objectType: 'workbench-status',
        objectId: 'status-safe',
        action: 'workbench.status.updated',
        beforeSequence: 4,
        limit: 10,
      },
    })
    await expect(scenario.auditIntegrity()).resolves.toMatchObject({ valid: true, eventCount: 0 })
    expect(required).toEqual(['workbench.activity.read', 'workbench.audit.verify'])
    expect(filtered).toEqual(['workbench.activity.read', 'workbench.audit.verify'])

    const error = await scenario.activity({ limit: 101 } as never)
      .catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('bad-request')
    expect(repository.activityCalls).toBe(1)
    await scenario.close()
  })

  it('stops admission, cancels and drains in-flight work, then closes its repository once', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSnapshot = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()

    const pending = scenario.snapshot()
    await started.promise
    const closing = scenario.close()
    const pendingError = await pending.catch((reason: unknown) => reason)
    expect(failureCode(pendingError)).toBe('cancelled')
    await closing

    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
    await scenario.close()
    expect(repository.closeCalls).toBe(1)
    const lateError = await scenario.snapshot().catch((reason: unknown) => reason)
    expect(failureCode(lateError)).toBe('unavailable')
  })

  it('preserves caller cancellation while an accepted persistence operation is in flight', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onSetStatus = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('In flight', null), caller.signal)
    await started.promise
    caller.abort(new Error('caller left'))

    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    expect(scenario.lifecycle).toBe('running')
    await scenario.close()
  })

  it('returns the durable result when cancellation races after the commit point', async () => {
    const repository = new MemoryRepository()
    const committed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    repository.afterSetStatus = async (signal) => {
      committed.resolve()
      await release.promise
      expect(signal.aborted).toBe(true)
    }
    const { scenario } = createScenario(repository)
    await scenario.open()
    const caller = new AbortController()

    const pending = scenario.setStatus(statusRequest('Committed', null), caller.signal)
    await committed.promise
    caller.abort(new Error('caller left after commit'))
    release.resolve()

    await expect(pending).resolves.toEqual({
      ok: true,
      value: {
        id: 'status-001',
        message: 'Committed',
        revision: 1,
        updatedAt: '2026-08-31T01:02:03.000Z',
      },
      receipt: {
        commandId: 'command-001',
        auditEventId: 'audit-001',
        outboxId: 'outbox-001',
      },
    })
    await scenario.close()
  })

  it('cancels and drains an admitted Project create before closing storage', async () => {
    const repository = new MemoryRepository()
    const started = Promise.withResolvers<void>()
    repository.onCreateProject = signal => new Promise<void>((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const { scenario } = createScenario(repository)
    await scenario.open()

    const pending = scenario.createProject(projectRequest(), new AbortController().signal)
    await started.promise
    const closing = scenario.close()
    const error = await pending.catch((reason: unknown) => reason)
    expect(failureCode(error)).toBe('cancelled')
    await closing

    expect(repository.projects.size).toBe(0)
    expect(repository.closeCalls).toBe(1)
    expect(scenario.lifecycle).toBe('closed')
  })
})
