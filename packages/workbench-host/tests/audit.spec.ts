import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_CHAIN_NAME,
  AUDIT_FORMAT_VERSION,
  AUDIT_GENESIS_HASH,
  canonicalizeJson,
  createAuditEvent,
  verifyAuditChain,
  type AuditEvent,
  type AuditEventInput,
  type AuditHash,
} from '../src/audit.ts'

describe('audit JSON canonicalization', () => {
  it('matches the RFC 8785 primitive, escape, finite-number, and recursive sorting vector', () => {
    const input = JSON.parse(String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
      "literals": [null, true, false]
    }`)

    expect(canonicalizeJson(input)).toBe(String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`)
    expect(canonicalizeJson({ z: [{ b: 1, a: 2 }], a: { d: false, c: null } }))
      .toBe('{"a":{"c":null,"d":false},"z":[{"a":2,"b":1}]}')
  })

  it('sorts property names by raw UTF-16 code units using the RFC 8785 vector', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    }

    expect(canonicalizeJson(input)).toBe('{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}')
  })

  it('rejects values outside the I-JSON/JCS domain without normalizing Unicode', () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/finite/u)
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(/finite/u)
    expect(() => canonicalizeJson(Number.NEGATIVE_INFINITY)).toThrow(/finite/u)
    expect(() => canonicalizeJson(-0)).toThrow(/negative zero/u)
    expect(() => canonicalizeJson({ value: undefined })).toThrow(/JSON/u)
    expect(() => canonicalizeJson({ value: 1n })).toThrow(/JSON/u)
    expect(() => canonicalizeJson({ value: '\ud800' })).toThrow(/Unicode/u)
    expect(() => canonicalizeJson({ value: '\udc00' })).toThrow(/Unicode/u)

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalizeJson(cyclic)).toThrow(/cyclic/u)

    expect(canonicalizeJson({ composed: 'é', decomposed: 'e\u0301' }))
      .toBe('{"composed":"é","decomposed":"é"}')
  })

  it('rejects executable or structurally ambiguous values without invoking accessors', () => {
    let accessed = false
    const accessor = {}
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get: () => { accessed = true; return 'must-not-run' },
    })
    expect(() => canonicalizeJson(accessor)).toThrow(/data fields/u)
    expect(accessed).toBe(false)

    const inherited = Object.create({ inherited: true }) as Record<string, unknown>
    inherited.value = 1
    expect(() => canonicalizeJson(inherited)).toThrow(/plain data objects/u)
    expect(() => canonicalizeJson({ [Symbol('extra')]: true })).toThrow(/symbol/u)

    const sparse = new Array(2)
    sparse[1] = 1
    expect(() => canonicalizeJson(sparse)).toThrow(/dense/u)
    const extended = [1] as unknown[] & { extra?: number }
    extended.extra = 2
    expect(() => canonicalizeJson(extended)).toThrow(/dense/u)

    const shared = { value: 1 }
    expect(canonicalizeJson({ left: shared, right: shared }))
      .toBe('{"left":{"value":1},"right":{"value":1}}')
  })

  it.each([
    ['0000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ])('serializes RFC 8785 Appendix B double %s', (hex, expected) => {
    expect(canonicalizeJson(doubleFromHex(hex))).toBe(expected)
  })

  it('applies the verified RFC 8785 negative-zero erratum', () => {
    expect(Object.is(doubleFromHex('8000000000000000'), -0)).toBe(true)
    expect(() => canonicalizeJson(doubleFromHex('8000000000000000')))
      .toThrow(/negative zero/u)
  })
})

describe('audit hash envelope', () => {
  it('creates a detached versioned SHA-256 event using decimal-string versions', () => {
    const created = createAuditEvent(eventInput())
    const envelope = JSON.parse(created.canonicalEnvelope)
    const goldenEnvelope = '{"chain":"project-workbench.audit","event":{"action":"workbench.status.updated","actor":{"id":"owner-001","kind":"owner"},"auditId":"audit-001","causation":{"id":"cause-001"},"command":{"id":"command-001","type":"workbench.status.set"},"object":{"id":"status-001","type":"workbench-status","version":"9007199254740993"},"occurredAt":"2026-08-31T03:04:05.000Z","outbox":{"id":"outbox-001","state":"pending"},"outcome":"committed","reason":{"code":"owner-status-edit"},"scope":{"organizationId":"organization-001","projectId":null,"teamId":"team-001"},"summary":{"changedFields":["message"],"code":"status-revision-committed"}},"previousHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000","sequence":"1","version":1}'
    const expectedHash = createHash('sha256')
      .update(created.canonicalEnvelope, 'utf8')
      .digest('hex')

    expect(created.sequence).toBe('1')
    expect(created.object.version).toBe('9007199254740993')
    expect(created.previousHash).toBe(AUDIT_GENESIS_HASH)
    expect(created.eventHash).toBe(`sha256:${expectedHash}`)
    expect(created.canonicalEnvelope).toBe(goldenEnvelope)
    expect(created.eventHash).toBe('sha256:d5b2a45238e9f173c7346b0ba0fdea9ab748a11f56190e350820c3d30b71a6a0')
    expect(envelope).toMatchObject({
      chain: AUDIT_CHAIN_NAME,
      version: AUDIT_FORMAT_VERSION,
      sequence: '1',
      previousHash: AUDIT_GENESIS_HASH,
      event: {
        auditId: 'audit-001',
        scope: {
          organizationId: 'organization-001',
          teamId: 'team-001',
          projectId: null,
        },
        object: { version: '9007199254740993' },
      },
    })
    expect(canonicalizeJson(envelope)).toBe(created.canonicalEnvelope)
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.actor)).toBe(true)
    expect(Object.isFrozen(created.summary.changedFields)).toBe(true)

    const largeSequence = createAuditEvent({
      ...eventInput(),
      sequence: '9007199254740993',
      previousHash: alternateHash('a'),
    })
    expect(largeSequence.sequence).toBe('9007199254740993')
  })

  it('rejects non-canonical sequence/version strings and arbitrary metadata', () => {
    expect(() => createAuditEvent({ ...eventInput(), sequence: '01' }))
      .toThrow(/sequence/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      object: { ...eventInput().object, version: '9007199254740993.0' },
    })).toThrow(/version/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      metadata: { password: 'must-not-enter-audit' },
    } as unknown as AuditEventInput)).toThrow(/field/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      reason: { code: 'owner-status-edit', detail: 'free-form status text' },
    })).toThrow(/no arbitrary detail/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      summary: {
        code: 'status-revision-committed',
        changedFields: [`a${'x'.repeat(128)}`],
      },
    })).toThrow(/unsafe/u)
  })

  it('admits only the correlated Project-created vocabulary without reason detail', () => {
    const input: AuditEventInput = {
      ...eventInput(),
      action: 'workbench.project.created',
      scope: {
        organizationId: 'organization-001',
        teamId: 'team-001',
        projectId: 'project-001',
      },
      reason: { code: 'owner-project-create' },
      object: { type: 'project', id: 'project-001', version: '1' },
      command: { id: 'command-001', type: 'workbench.project.create' },
      summary: {
        code: 'project-created-from-template',
        changedFields: ['primaryGoal', 'outcomes', 'supportingGoals', 'templateSnapshot'],
      },
    }
    const created = createAuditEvent(input)
    expect(created).toMatchObject({
      action: 'workbench.project.created',
      scope: { projectId: 'project-001' },
      reason: { code: 'owner-project-create' },
      object: { type: 'project', id: 'project-001', version: '1' },
      command: { type: 'workbench.project.create' },
      summary: { code: 'project-created-from-template' },
    })
    expect(created.canonicalEnvelope).not.toContain('detail')

    expect(() => createAuditEvent({
      ...input,
      command: { ...input.command, type: 'workbench.status.set' },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...input,
      scope: { ...input.scope, projectId: 'project-other' },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...input,
      reason: { code: 'owner-project-create', detail: 'must-not-enter-audit' },
    } as unknown as AuditEventInput)).toThrow(/no arbitrary detail/u)
  })

  it('admits only correlated, Project-scoped, PII-free Project Team vocabulary', () => {
    const created = createAuditEvent(projectTeamEventInput('created'))
    const statusChanged = createAuditEvent(projectTeamEventInput('status'))
    const responsibility = createAuditEvent(projectTeamEventInput('responsibility'))

    expect(created).toMatchObject({
      action: 'workbench.project-member.created',
      scope: { projectId: 'project-001' },
      reason: { code: 'owner-project-member-add' },
      object: { type: 'project-member', id: 'member-001', version: '1' },
      command: { type: 'workbench.project-member.add' },
      summary: { code: 'project-member-created', changedFields: ['member', 'teamRevision'] },
    })
    expect(statusChanged).toMatchObject({
      action: 'workbench.project-member.status-changed',
      reason: { code: 'owner-project-member-status-change' },
      command: { type: 'workbench.project-member.set-status' },
      summary: { code: 'project-member-status-changed' },
    })
    expect(responsibility).toMatchObject({
      action: 'workbench.project.responsibility-assigned',
      object: { type: 'project-responsibility', id: 'project-001', version: '1' },
      command: { type: 'workbench.project.set-responsibility' },
      summary: { code: 'project-responsibility-assigned' },
    })
    for (const event of [created, statusChanged, responsibility]) {
      expect(event.canonicalEnvelope).not.toMatch(
        /displayName|openId|appId|externalContact|expert@example|responsibilityInput/u,
      )
    }

    expect(() => createAuditEvent({
      ...projectTeamEventInput('created'),
      command: { id: 'command-001', type: 'workbench.project-member.set-status' },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...projectTeamEventInput('created'),
      scope: { organizationId: 'organization-001', teamId: 'team-001', projectId: null },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...projectTeamEventInput('responsibility'),
      object: { type: 'project-responsibility', id: 'project-other', version: '1' },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...projectTeamEventInput('created'),
      summary: { code: 'project-member-created', changedFields: ['displayName'] },
    })).toThrow(/correlated combination/u)
  })

  it('admits only correlated, Project-scoped SuggestedChange vocabulary without review content', () => {
    const cases = [
      [
        'workbench.suggested-change.proposed',
        'owner-suggested-change-propose',
        'workbench.suggested-change.propose',
        'suggested-change-proposed',
        ['proposal', 'risk', 'evidence'],
      ],
      [
        'workbench.suggested-change.accepted',
        'owner-suggested-change-accept',
        'workbench.suggested-change.accept',
        'suggested-change-accepted',
        ['decision', 'target'],
      ],
      [
        'workbench.suggested-change.edited-accepted',
        'owner-suggested-change-edit-accept',
        'workbench.suggested-change.edit-accept',
        'suggested-change-edited-accepted',
        ['decision', 'target'],
      ],
      [
        'workbench.suggested-change.rejected',
        'owner-suggested-change-reject',
        'workbench.suggested-change.reject',
        'suggested-change-rejected',
        ['decision'],
      ],
      [
        'workbench.suggested-change.deferred',
        'owner-suggested-change-defer',
        'workbench.suggested-change.defer',
        'suggested-change-deferred',
        ['decision'],
      ],
    ] as const

    for (const [action, reason, commandType, summaryCode, changedFields] of cases) {
      const input: AuditEventInput = {
        ...eventInput(),
        action,
        scope: {
          organizationId: 'organization-001',
          teamId: 'team-001',
          projectId: 'project-001',
        },
        reason: { code: reason },
        object: { type: 'suggested-change', id: 'suggested-change-001', version: '2' },
        command: { id: 'command-review-001', type: commandType },
        summary: { code: summaryCode, changedFields },
      }
      const created = createAuditEvent(input)
      expect(created).toMatchObject({ action, reason: { code: reason }, summary: { code: summaryCode } })
      expect(created.canonicalEnvelope).not.toMatch(
        /candidate|feedback|evidenceRef|member-private|private@example/u,
      )
    }

    expect(() => createAuditEvent({
      ...eventInput(),
      action: 'workbench.suggested-change.accepted',
      scope: {
        organizationId: 'organization-001', teamId: 'team-001', projectId: 'project-001',
      },
      reason: { code: 'owner-suggested-change-accept' },
      object: { type: 'suggested-change', id: 'suggested-change-001', version: '2' },
      command: { id: 'command-review-001', type: 'workbench.suggested-change.reject' },
      summary: { code: 'suggested-change-accepted', changedFields: ['decision', 'target'] },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      action: 'workbench.suggested-change.rejected',
      scope: { organizationId: 'organization-001', teamId: 'team-001', projectId: null },
      reason: { code: 'owner-suggested-change-reject' },
      object: { type: 'suggested-change', id: 'suggested-change-001', version: '2' },
      command: { id: 'command-review-001', type: 'workbench.suggested-change.reject' },
      summary: { code: 'suggested-change-rejected', changedFields: ['decision'] },
    })).toThrow(/correlated combination/u)
  })

  it('admits only workspace-scoped, credential-free Feishu connection vocabulary', () => {
    const cases = [
      [
        'workbench.feishu-route.configured',
        'owner-feishu-route-configure',
        'workbench.feishu-route.configure',
        'feishu-route-configured',
        ['route', 'credentialRef'],
      ],
      [
        'workbench.feishu-route.reset',
        'owner-feishu-route-reset',
        'workbench.feishu-route.reset',
        'feishu-route-reset',
        ['route', 'identityBinding'],
      ],
      [
        'workbench.feishu-route.disabled',
        'owner-feishu-route-disable',
        'workbench.feishu-route.disable',
        'feishu-route-disabled',
        ['route', 'state'],
      ],
      [
        'workbench.feishu-route.verification-recorded',
        'owner-feishu-route-verify',
        'workbench.feishu-route.verify',
        'feishu-route-verification-attention',
        ['verification'],
      ],
    ] as const

    for (const [action, reason, commandType, summaryCode, changedFields] of cases) {
      const input: AuditEventInput = {
        ...eventInput(),
        action,
        scope: {
          organizationId: 'organization-001',
          teamId: 'team-001',
          projectId: null,
        },
        reason: { code: reason },
        object: { type: 'feishu-connection', id: 'feishu-primary', version: '3' },
        command: { id: 'command-feishu-001', type: commandType },
        summary: { code: summaryCode, changedFields },
      }
      const created = createAuditEvent(input)
      expect(created).toMatchObject({
        action,
        scope: { projectId: null },
        object: { type: 'feishu-connection', id: 'feishu-primary' },
        reason: { code: reason },
        summary: { code: summaryCode },
      })
      expect(created.canonicalEnvelope).not.toMatch(
        /app-secret|user-access-token|cli_feishu|ou_private|tasklist-private/u,
      )
    }

    expect(() => createAuditEvent({
      ...eventInput(),
      action: 'workbench.feishu-route.verification-recorded',
      scope: {
        organizationId: 'organization-001', teamId: 'team-001', projectId: 'project-001',
      },
      reason: { code: 'owner-feishu-route-verify' },
      object: { type: 'feishu-connection', id: 'feishu-primary', version: '3' },
      command: { id: 'command-feishu-001', type: 'workbench.feishu-route.verify' },
      summary: { code: 'feishu-route-verification-attention', changedFields: ['verification'] },
    })).toThrow(/correlated combination/u)
    expect(() => createAuditEvent({
      ...eventInput(),
      action: 'workbench.feishu-route.configured',
      reason: { code: 'owner-feishu-route-configure' },
      object: { type: 'feishu-connection', id: 'feishu-primary', version: '3' },
      command: { id: 'command-feishu-001', type: 'workbench.feishu-route.configure' },
      summary: { code: 'feishu-route-configured', changedFields: ['route', 'appSecret'] },
    })).toThrow(/correlated combination/u)
  })
})

describe('audit chain verification', () => {
  it('verifies a complete chain and an optional trusted tail checkpoint', () => {
    const chain = auditChain()
    const head = chain[2]

    expect(verifyAuditChain(chain)).toEqual({
      ok: true,
      eventCount: 3,
      headHash: head.eventHash,
    })
    expect(verifyAuditChain(chain, {
      eventCount: 3,
      headHash: head.eventHash,
    })).toEqual({
      ok: true,
      eventCount: 3,
      headHash: head.eventHash,
    })
  })

  it('detects field, canonical-envelope, previous-hash, and event-hash tampering', () => {
    const chain = auditChain()
    const changedSummary: AuditEvent = {
      ...chain[1],
      summary: { ...chain[1].summary, changedFields: ['revision'] },
    }
    expectFailure(verifyAuditChain([chain[0], changedSummary, chain[2]]), 'canonical-envelope-mismatch', 1)

    const changedScope: AuditEvent = {
      ...chain[1],
      scope: { ...chain[1].scope, projectId: 'project-tampered' },
    }
    expectFailure(verifyAuditChain([chain[0], changedScope, chain[2]]), 'canonical-envelope-mismatch', 1)

    const changedActor: AuditEvent = {
      ...chain[1],
      actor: { ...chain[1].actor, id: 'owner-tampered' },
    }
    expectFailure(verifyAuditChain([chain[0], changedActor, chain[2]]), 'canonical-envelope-mismatch', 1)

    const changedObjectVersion: AuditEvent = {
      ...chain[1],
      object: { ...chain[1].object, version: '9007199254740999' },
    }
    expectFailure(verifyAuditChain([chain[0], changedObjectVersion, chain[2]]), 'canonical-envelope-mismatch', 1)

    const changedCausation: AuditEvent = {
      ...chain[1],
      causation: { id: 'cause-tampered' },
    }
    expectFailure(verifyAuditChain([chain[0], changedCausation, chain[2]]), 'canonical-envelope-mismatch', 1)

    const malformedReason: AuditEvent = {
      ...chain[1],
      reason: { code: 'free-form-secret' } as unknown as AuditEvent['reason'],
    }
    expectFailure(verifyAuditChain([chain[0], malformedReason, chain[2]]), 'malformed-event', 1)

    const nonCanonical: AuditEvent = {
      ...chain[0],
      canonicalEnvelope: `${chain[0].canonicalEnvelope} `,
    }
    expectFailure(verifyAuditChain([nonCanonical]), 'canonical-envelope-mismatch', 0)

    const futureEnvelope = JSON.parse(chain[0].canonicalEnvelope)
    futureEnvelope.version = 2
    const unsupportedFormat: AuditEvent = {
      ...chain[0],
      canonicalEnvelope: canonicalizeJson(futureEnvelope),
    }
    expectFailure(verifyAuditChain([unsupportedFormat]), 'event-hash-mismatch', 0)

    const futureCanonicalEnvelope = canonicalizeJson(futureEnvelope)
    const selfConsistentUnsupportedFormat: AuditEvent = {
      ...chain[0],
      canonicalEnvelope: futureCanonicalEnvelope,
      eventHash: `sha256:${createHash('sha256').update(futureCanonicalEnvelope, 'utf8').digest('hex')}`,
    }
    expectFailure(verifyAuditChain([selfConsistentUnsupportedFormat]), 'unsupported-format', 0)

    const changedPrevious: AuditEvent = {
      ...chain[1],
      previousHash: alternateHash('f'),
    }
    expectFailure(verifyAuditChain([chain[0], changedPrevious, chain[2]]), 'previous-hash-mismatch', 1)

    const changedHash: AuditEvent = {
      ...chain[0],
      eventHash: alternateHash('e'),
    }
    expectFailure(verifyAuditChain([changedHash]), 'event-hash-mismatch', 0)
  })

  it('detects deletion and reordering through sequence continuity', () => {
    const chain = auditChain()
    expectFailure(verifyAuditChain([chain[0], chain[2]]), 'sequence-mismatch', 1)
    expectFailure(verifyAuditChain([chain[1], chain[0], chain[2]]), 'sequence-mismatch', 0)
  })

  it('uses a trusted head to detect suffix deletion while accepting a valid prefix alone', () => {
    const chain = auditChain()
    const prefix = chain.slice(0, 2)

    expect(verifyAuditChain(prefix)).toMatchObject({ ok: true, eventCount: 2 })
    expectFailure(verifyAuditChain(prefix, {
      eventCount: 3,
      headHash: chain[2].eventHash,
    }), 'tail-checkpoint-mismatch', 2)
  })
})

function eventInput(): AuditEventInput {
  return {
    sequence: '1',
    previousHash: AUDIT_GENESIS_HASH,
    auditId: 'audit-001',
    occurredAt: '2026-08-31T03:04:05.000Z',
    actor: { kind: 'owner', id: 'owner-001' },
    action: 'workbench.status.updated',
    scope: {
      organizationId: 'organization-001',
      teamId: 'team-001',
      projectId: null,
    },
    reason: { code: 'owner-status-edit' },
    object: {
      type: 'workbench-status',
      id: 'status-001',
      version: '9007199254740993',
    },
    command: { id: 'command-001', type: 'workbench.status.set' },
    causation: { id: 'cause-001' },
    outbox: { id: 'outbox-001', state: 'pending' },
    outcome: 'committed',
    summary: { code: 'status-revision-committed', changedFields: ['message'] },
  }
}

function projectTeamEventInput(
  kind: 'created' | 'status' | 'responsibility',
): AuditEventInput {
  const scope = {
    organizationId: 'organization-001',
    teamId: 'team-001',
    projectId: 'project-001',
  } as const
  if (kind === 'created') {
    return {
      ...eventInput(),
      action: 'workbench.project-member.created',
      scope,
      reason: { code: 'owner-project-member-add' },
      object: { type: 'project-member', id: 'member-001', version: '1' },
      command: { id: 'command-001', type: 'workbench.project-member.add' },
      summary: { code: 'project-member-created', changedFields: ['member', 'teamRevision'] },
    }
  }
  if (kind === 'status') {
    return {
      ...eventInput(),
      action: 'workbench.project-member.status-changed',
      scope,
      reason: { code: 'owner-project-member-status-change' },
      object: { type: 'project-member', id: 'member-001', version: '2' },
      command: { id: 'command-002', type: 'workbench.project-member.set-status' },
      summary: {
        code: 'project-member-status-changed',
        changedFields: ['status', 'teamRevision'],
      },
    }
  }
  return {
    ...eventInput(),
    action: 'workbench.project.responsibility-assigned',
    scope,
    reason: { code: 'owner-project-responsibility-set' },
    object: { type: 'project-responsibility', id: 'project-001', version: '1' },
    command: { id: 'command-003', type: 'workbench.project.set-responsibility' },
    summary: {
      code: 'project-responsibility-assigned',
      changedFields: ['accountable', 'contributors', 'humanSponsor', 'teamRevision'],
    },
  }
}

function auditChain(): readonly [AuditEvent, AuditEvent, AuditEvent] {
  const first = createAuditEvent(eventInput())
  const second = createAuditEvent({
    ...eventInput(),
    sequence: '2',
    previousHash: first.eventHash,
    auditId: 'audit-002',
    occurredAt: '2026-08-31T03:05:05.000Z',
    object: { ...eventInput().object, version: '9007199254740994' },
    command: { id: 'command-002', type: 'workbench.status.set' },
    causation: { id: 'cause-002' },
    outbox: null,
  })
  const third = createAuditEvent({
    ...eventInput(),
    sequence: '3',
    previousHash: second.eventHash,
    auditId: 'audit-003',
    occurredAt: '2026-08-31T03:06:05.000Z',
    object: { ...eventInput().object, version: '9007199254740995' },
    command: { id: 'command-003', type: 'workbench.status.set' },
    causation: { id: 'cause-003' },
    outbox: { id: 'outbox-003', state: 'unknown' },
  })
  return [first, second, third]
}

function alternateHash(character: string): AuditHash {
  return `sha256:${character.repeat(64)}`
}

function doubleFromHex(hex: string): number {
  const bytes = Buffer.allocUnsafe(8)
  bytes.writeBigUInt64BE(BigInt(`0x${hex}`))
  return bytes.readDoubleBE(0)
}

function expectFailure(
  result: ReturnType<typeof verifyAuditChain>,
  code: string,
  index: number,
): void {
  expect(result).toMatchObject({
    ok: false,
    failure: { code, index },
  })
}
