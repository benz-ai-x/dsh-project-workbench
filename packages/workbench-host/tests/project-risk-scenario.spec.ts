import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WorkbenchAuthorization, WorkbenchAction } from '../src/authorization.ts'
import type {
  CreateProjectRiskRequest,
  WorkbenchProjectMemberMutation,
  WorkbenchProjectMutation,
} from '../src/index.ts'
import {
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  SqliteWorkbenchRepository,
  WorkbenchScenario,
  noWorkbenchExternalAdapters,
  randomWorkbenchIds,
} from '../src/index.ts'

const roots = new Set<string>()
const signal = new AbortController().signal

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

function projectMutation(): WorkbenchProjectMutation {
  return {
    projectId: 'project-risk-scenario',
    primaryGoalId: 'goal-risk-scenario',
    projectName: 'Risk Scenario',
    primaryGoal: {
      name: 'Govern uncertainty',
      outcomes: [{
        outcomeId: 'outcome-risk-scenario',
        name: 'Risk decisions stay reviewable',
        metric: {
          metricName: 'Reviewable decisions',
          initialValue: 0,
          targetValue: 1,
          unit: 'state',
          direction: 'increase',
        },
      }],
    },
    supportingGoals: [],
    template: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
    expectedCatalogRevision: 0,
    expectedRevision: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    command: command('project', 'owner-project-create'),
  }
}

function memberMutation(): WorkbenchProjectMemberMutation {
  return {
    projectId: 'project-risk-scenario',
    memberId: 'member-risk-owner',
    member: {
      kind: 'human',
      displayName: 'Risk Owner',
      identity: { type: 'feishu', appId: 'cli_risk_scenario', openId: 'ou_risk_owner' },
    },
    expectedTeamRevision: 0,
    expectedRevision: null,
    createdAt: '2026-09-01T00:01:00.000Z',
    command: command('member', 'owner-project-member-add', '2026-09-01T00:01:00.000Z'),
  }
}

function command(
  suffix: string,
  reason: WorkbenchProjectMutation['command']['reason']
    | WorkbenchProjectMemberMutation['command']['reason'],
  occurredAt = '2026-09-01T00:00:00.000Z',
) {
  return {
    commandId: `command-risk-${suffix}`,
    auditEventId: `audit-risk-${suffix}`,
    outboxId: `outbox-risk-${suffix}`,
    idempotencyKey: `idempotency-risk-${suffix}`,
    causationId: `causation-risk-${suffix}`,
    reason,
    actor: {
      kind: 'owner' as const,
      id: 'owner-risk-scenario',
      organizationId: 'organization-risk-scenario',
      teamId: 'team-risk-scenario',
    },
    occurredAt,
  }
}

function createRequest(): CreateProjectRiskRequest {
  return {
    projectId: 'project-risk-scenario',
    assessment: {
      statement: {
        condition: 'The approval owner has not confirmed availability',
        event: 'the approval may miss the launch window',
        consequence: 'the launch commitment may move',
      },
      category: 'schedule',
      trigger: { statement: 'approval remains absent on review day', state: 'unknown' },
      probability: { lowerBasisPoints: 1_000, upperBasisPoints: 2_000 },
      impact: { lowerBand: 2, upperBand: 3 },
      confidence: 'medium',
      confidenceRationale: 'The owner has not yet answered.',
      assessmentHorizonEnd: '2026-10-01',
      nextReviewOn: '2026-09-02',
      assumptions: ['The launch scope stays fixed.'],
      accountableMemberId: 'member-risk-owner',
      contributorMemberIds: [],
      humanSponsorMemberId: null,
      evidence: [],
      dependencies: [],
      mitigationTaskGuids: [],
      contingencyTaskGuids: [],
    },
    expectedRisksRevision: 0,
    expectedRiskRevision: null,
    expectedTeamRevision: 1,
    expectedTaskRevision: 0,
    idempotencyKey: 'create-risk-idempotency',
    causationId: 'create-risk-causation',
    reason: 'owner-project-risk-create',
  }
}

describe('Project Risk Scenario with real SQLite', () => {
  it('double-authorizes the read and creates one detached research Risk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-risk-scenario-'))
    roots.add(root)
    const repository = new SqliteWorkbenchRepository({
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 1_000,
    })
    await repository.open()
    expect((await repository.commitProject(projectMutation(), signal)).ok).toBe(true)
    expect((await repository.commitProjectMember(memberMutation(), signal)).ok).toBe(true)
    const actions: WorkbenchAction[] = []
    let abortAfterFirstRiskAuthorization: AbortController | null = null
    const authorization: WorkbenchAuthorization = {
      require: async (action) => {
        actions.push(action)
        if (action === 'workbench.project.risk.read'
          && abortAfterFirstRiskAuthorization !== null) {
          abortAfterFirstRiskAuthorization.abort()
          abortAfterFirstRiskAuthorization = null
        }
        return {
          ownerId: 'owner-risk-scenario',
          organizationId: 'organization-risk-scenario',
          teamId: 'team-risk-scenario',
        }
      },
      filterProjection: async (_action, projection) => projection,
    }
    const scenario = new WorkbenchScenario({
      repository,
      authorization,
      adapters: noWorkbenchExternalAdapters,
      clock: { now: () => new Date('2026-09-01T08:00:00.000Z') },
      ids: randomWorkbenchIds,
      maxStatusLength: 280,
      taskReconciliationIntervalMs: 0,
      calendarReconciliationIntervalMs: 0,
    })
    await scenario.open()
    try {
      const preAborted = new AbortController()
      preAborted.abort()
      const authorizationCountBeforeCancellation = actions.length
      const preAbortedCalls: ReadonlyArray<() => Promise<unknown>> = [
        () => scenario.projectRisks({ projectId: 'project-risk-scenario' }, preAborted.signal),
        () => scenario.createProjectRisk({} as never, preAborted.signal),
        () => scenario.reviseProjectRisk({} as never, preAborted.signal),
        () => scenario.transitionProjectRisk({} as never, preAborted.signal),
      ]
      for (const call of preAbortedCalls) {
        await expect(call()).rejects.toMatchObject({ failure: { code: 'cancelled' } })
      }
      expect(actions).toHaveLength(authorizationCountBeforeCancellation)

      const cancelledBetweenCapabilities = new AbortController()
      abortAfterFirstRiskAuthorization = cancelledBetweenCapabilities
      const capabilityStart = actions.length
      await expect(scenario.projectRisks(
        { projectId: 'project-risk-scenario' },
        cancelledBetweenCapabilities.signal,
      )).rejects.toMatchObject({ failure: { code: 'cancelled' } })
      expect(actions.slice(capabilityStart)).toEqual(['workbench.project.risk.read'])

      await expect(scenario.projectRisks({
        projectId: 'project-risk-scenario',
        disposition: 'accept',
      } as never, signal)).rejects.toMatchObject({ failure: { code: 'bad-request' } })
      const created = await scenario.createProjectRisk(createRequest(), signal)
      expect(created).toMatchObject({
        ok: true,
        value: { projectId: 'project-risk-scenario', revision: 1 },
        risk: { revision: 1, status: 'research', currentAssessment: { sequence: 1 } },
      })
      const projection = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        selectedRiskId: created.ok ? created.risk.riskId : 'missing',
      }, signal)
      expect(projection).toMatchObject({
        revision: 1,
        teamRevision: 1,
        taskRevision: 0,
        selectedRisk: { history: [{ kind: 'assessment', sequence: 1 }] },
      })
      expect(actions.slice(-2)).toEqual([
        'workbench.project.risk.read',
        'workbench.project.risk.activity.read',
      ])
      if (!created.ok) throw new Error('Risk fixture creation failed')
      const riskId = created.risk.riskId
      const inUse = await scenario.setProjectMemberStatus({
        projectId: 'project-risk-scenario',
        memberId: 'member-risk-owner',
        status: 'inactive',
        expectedTeamRevision: 1,
        expectedMemberRevision: 1,
        idempotencyKey: 'member-risk-in-use',
        causationId: 'member-risk-in-use-causation',
        reason: 'owner-project-member-status-change',
      }, signal)
      expect(inUse).toMatchObject({ ok: false, error: { code: 'member-in-use' } })
      const revisionRequest = {
        ...createRequest(),
        riskId,
        assessment: {
          ...createRequest().assessment,
          trigger: { statement: 'approval remains absent on review day', state: 'met' as const },
          confidenceRationale: 'The review day passed without confirmation.',
        },
        expectedRisksRevision: 1,
        expectedRiskRevision: 1,
        idempotencyKey: 'revise-risk-idempotency',
        causationId: 'revise-risk-causation',
        reason: 'owner-project-risk-revise' as const,
      }
      const revised = await scenario.reviseProjectRisk(revisionRequest, signal)
      expect(revised).toMatchObject({
        ok: true,
        value: { revision: 2 },
        risk: {
          revision: 2,
          status: 'research',
          currentAssessment: { sequence: 2, trigger: { state: 'met' } },
        },
      })
      const mitigationWithoutTask = await scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId,
        status: 'mitigate',
        rationale: 'Try to mitigate without creating a task.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 2,
        expectedTaskRevision: 0,
        idempotencyKey: 'mitigate-risk-idempotency',
        causationId: 'mitigate-risk-causation',
        reason: 'owner-project-risk-transition',
      }, signal)
      expect(mitigationWithoutTask).toMatchObject({
        ok: false,
        error: { code: 'mitigation-task-required' },
      })
      const closed = await scenario.transitionProjectRisk({
        projectId: 'project-risk-scenario',
        riskId,
        status: 'closed',
        closureReason: 'superseded',
        rationale: 'A replacement Risk now governs the uncertainty.',
        expectedRisksRevision: 2,
        expectedRiskRevision: 2,
        expectedTaskRevision: 0,
        idempotencyKey: 'close-risk-idempotency',
        causationId: 'close-risk-causation',
        reason: 'owner-project-risk-transition',
      }, signal)
      expect(closed).toMatchObject({
        ok: true,
        value: { revision: 3 },
        risk: { revision: 3, status: 'closed', closureReason: 'superseded' },
      })

      const database = Reflect.get(repository, 'database') as DatabaseSync
      const countsBeforeReplay = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM workbench_project_risk_assessment) AS assessments,
          (SELECT COUNT(*) FROM workbench_project_risk_transition) AS transitions,
          (SELECT COUNT(*) FROM workbench_project_risk_activity) AS activity,
          (SELECT COUNT(*) FROM workbench_outbox) AS outbox,
          (SELECT COUNT(*) FROM workbench_command_receipt) AS receipts
      `).get()
      const replayedRevision = await scenario.reviseProjectRisk(revisionRequest, signal)
      expect(replayedRevision).toMatchObject({
        ok: true,
        risk: { riskId, status: 'closed', revision: 3 },
      })
      expect(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM workbench_project_risk_assessment) AS assessments,
          (SELECT COUNT(*) FROM workbench_project_risk_transition) AS transitions,
          (SELECT COUNT(*) FROM workbench_project_risk_activity) AS activity,
          (SELECT COUNT(*) FROM workbench_outbox) AS outbox,
          (SELECT COUNT(*) FROM workbench_command_receipt) AS receipts
      `).get()).toEqual(countsBeforeReplay)

      const filtered = await scenario.projectRisks({
        projectId: 'project-risk-scenario',
        exposure: 'medium',
        status: 'closed',
        riskOwnerMemberId: 'member-risk-owner',
        triggerState: 'met',
        triggerContains: 'APPROVAL REMAINS',
        reviewFrom: '2026-09-01',
        reviewTo: '2026-09-03',
        selectedRiskId: riskId,
      }, signal)
      expect(filtered).toMatchObject({
        risks: [{ riskId, status: 'closed' }],
        selectedRisk: {
          history: [
            { kind: 'transition', sequence: 3 },
            { kind: 'assessment', sequence: 2 },
            { kind: 'assessment', sequence: 1 },
          ],
        },
      })
      const riskLedgerRows = database.prepare(`
        SELECT audit.canonical_envelope, outbox.payload_json, receipt.result_json
        FROM workbench_command_receipt AS receipt
        INNER JOIN workbench_audit_event AS audit ON audit.id = receipt.audit_event_id
        INNER JOIN workbench_outbox AS outbox ON outbox.id = receipt.outbox_id
        WHERE receipt.command_type LIKE 'workbench.project-risk.%'
      `).all() as Array<{
        readonly canonical_envelope: string
        readonly payload_json: string
        readonly result_json: string
      }>
      expect(riskLedgerRows).toHaveLength(3)
      for (const ledgerRow of riskLedgerRows) {
        const serialized = JSON.stringify(ledgerRow)
        expect(serialized).not.toContain('member-risk-owner')
        expect(serialized).not.toContain('approval remains absent')
        expect(serialized).not.toContain('launch commitment may move')
        expect(serialized).not.toContain('The review day passed')
      }
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_assessment
        SET next_review_on = next_review_on WHERE risk_id = ?
      `).run(riskId)).toThrow('assessments are append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_assessment WHERE risk_id = ?
      `).run(riskId)).toThrow('assessments cannot be deleted')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_assessment_member SET display_name = display_name
        WHERE assessment_id IN (
          SELECT id FROM workbench_project_risk_assessment WHERE risk_id = ?
        )
      `).run(riskId)).toThrow('responsibility is immutable')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_transition
        SET rationale = rationale WHERE risk_id = ?
      `).run(riskId)).toThrow('transitions are append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_transition WHERE risk_id = ?
      `).run(riskId)).toThrow('transitions cannot be deleted')
      expect(() => database.prepare(`
        UPDATE workbench_project_risk_activity
        SET rationale = rationale WHERE risk_id = ?
      `).run(riskId)).toThrow('Activity is append-only')
      expect(() => database.prepare(`
        DELETE FROM workbench_project_risk_activity WHERE risk_id = ?
      `).run(riskId)).toThrow('Activity cannot be deleted')
      const released = await scenario.setProjectMemberStatus({
        projectId: 'project-risk-scenario',
        memberId: 'member-risk-owner',
        status: 'inactive',
        expectedTeamRevision: 1,
        expectedMemberRevision: 1,
        idempotencyKey: 'member-risk-released',
        causationId: 'member-risk-released-causation',
        reason: 'owner-project-member-status-change',
      }, signal)
      expect(released).toMatchObject({ ok: true, value: { status: 'inactive', teamRevision: 2 } })
    } finally {
      await scenario.close()
    }
  })
})
