/** Pure, versioned Project Risk policy. */

import { createHash } from 'node:crypto'
import { canonicalizeJson } from './audit.ts'
import type {
  ProjectRiskCategory,
  ProjectRiskClosureReason,
  ProjectRiskConfidence,
  ProjectRiskDependency,
  ProjectRiskEvidenceRef,
  ProjectRiskExposure,
  ProjectRiskExposureLevel,
  ProjectRiskImpactInterval,
  ProjectRiskProbabilityInterval,
  ProjectRiskStatus,
  ProjectRiskStatement,
  ProjectRiskTriggerProjection,
  WorkbenchDigest,
} from './client.ts'

const EXPOSURE_MATRIX: readonly (readonly ProjectRiskExposureLevel[])[] = Object.freeze([
  Object.freeze(['low', 'low', 'low', 'medium', 'high'] as const),
  Object.freeze(['low', 'low', 'medium', 'medium', 'high'] as const),
  Object.freeze(['low', 'medium', 'medium', 'high', 'high'] as const),
  Object.freeze(['medium', 'medium', 'high', 'high', 'high'] as const),
  Object.freeze(['medium', 'high', 'high', 'high', 'high'] as const),
] as const)

const PROJECT_RISK_CATEGORIES = new Set<ProjectRiskCategory>([
  'schedule',
  'dependency',
  'scope',
  'capacity',
  'ownership',
  'quality',
  'information',
  'governance',
  'external',
  'other',
])
const PROJECT_RISK_CONFIDENCE = new Set<ProjectRiskConfidence>(['low', 'medium', 'high'])
const PROJECT_RISK_STATUSES = new Set<ProjectRiskStatus>([
  'research', 'watch', 'mitigate', 'accept', 'closed',
])
const PROJECT_RISK_CLOSURE_REASONS = new Set<ProjectRiskClosureReason>([
  'no-longer-exists', 'below-threshold', 'materialized-as-issue', 'superseded',
])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const MAX_STATEMENT_LENGTH = 2_000
const MAX_TRIGGER_LENGTH = 1_000
const MAX_CONFIDENCE_RATIONALE_LENGTH = 2_000
const MAX_ASSUMPTION_LENGTH = 1_000
const MAX_ASSUMPTIONS = 20
const MAX_CONTRIBUTORS = 20
const MAX_EVIDENCE = 20
const MAX_DEPENDENCIES = 20
const MAX_TREATMENT_TASKS = 50
const MAX_TRANSITION_RATIONALE_LENGTH = 2_000

export interface NormalizeProjectRiskAssessmentOptions {
  readonly assessedAt: string
  readonly projectTimezone: string
  readonly previousTrigger: ProjectRiskTriggerProjection | null
}

/** Host-only normalized value before persistence assigns immutable identities. */
export interface NormalizedProjectRiskAssessment {
  readonly statement: ProjectRiskStatement
  readonly category: ProjectRiskCategory
  readonly trigger: ProjectRiskTriggerProjection
  readonly probability: ProjectRiskProbabilityInterval
  readonly impact: ProjectRiskImpactInterval
  readonly confidence: ProjectRiskConfidence
  readonly confidenceRationale: string
  readonly assessmentHorizonEnd: string
  readonly nextReviewOn: string
  readonly assumptions: readonly string[]
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string | null
  readonly evidence: readonly ProjectRiskEvidenceRef[]
  readonly dependencies: readonly ProjectRiskDependency[]
  readonly mitigationTaskGuids: readonly string[]
  readonly contingencyTaskGuids: readonly string[]
  readonly exposure: ProjectRiskExposure
  readonly assessedAt: string
  readonly digest: WorkbenchDigest
}

/** Canonical caller intent used for receipt lookup before clock/current-state policy. */
export type NormalizedProjectRiskAssessmentIntent = Readonly<
  Omit<NormalizedProjectRiskAssessment, 'trigger' | 'assessedAt' | 'digest'> & {
    readonly trigger: Readonly<{
      readonly statement: string
      readonly state: ProjectRiskTriggerProjection['state']
    }>
  }
>

export interface NormalizeProjectRiskTransitionOptions {
  readonly currentStatus: ProjectRiskStatus
  readonly currentNextReviewOn: string
  readonly availableMitigationTaskCount: number
  readonly occurredAt: string
  readonly projectTimezone: string
}

export interface NormalizedProjectRiskTransition {
  readonly fromStatus: ProjectRiskStatus
  readonly toStatus: ProjectRiskStatus
  readonly rationale: string
  readonly closureReason: ProjectRiskClosureReason | null
  readonly occurredAt: string
}

/** Canonical caller intent used for receipt lookup before lifecycle policy. */
export interface NormalizedProjectRiskTransitionIntent {
  readonly toStatus: ProjectRiskStatus
  readonly rationale: string
  readonly closureReason: ProjectRiskClosureReason | null
}

/** Derive exposure from the conservative upper endpoint of both intervals. */
export function projectRiskExposure(
  probability: ProjectRiskProbabilityInterval,
  impact: ProjectRiskImpactInterval,
): ProjectRiskExposure {
  if (!Number.isSafeInteger(probability.lowerBasisPoints)
    || !Number.isSafeInteger(probability.upperBasisPoints)
    || probability.lowerBasisPoints < 0
    || probability.upperBasisPoints < 1
    || probability.upperBasisPoints > 10_000
    || probability.lowerBasisPoints > probability.upperBasisPoints) {
    throw new TypeError('Project Risk probability interval is invalid')
  }
  if (!Number.isSafeInteger(impact.lowerBand)
    || !Number.isSafeInteger(impact.upperBand)
    || impact.lowerBand < 1
    || impact.upperBand > 5
    || impact.lowerBand > impact.upperBand) {
    throw new TypeError('Project Risk impact interval is invalid')
  }
  const likelihoodIndex = probability.upperBasisPoints <= 500
    ? 0
    : probability.upperBasisPoints <= 2_000
      ? 1
      : probability.upperBasisPoints <= 5_000
        ? 2
        : probability.upperBasisPoints <= 8_000
          ? 3
          : 4
  const impactIndex = impact.upperBand - 1
  const level = EXPOSURE_MATRIX[likelihoodIndex]?.[impactIndex]
  if (level === undefined) throw new TypeError('Project Risk exposure policy index is invalid')
  return Object.freeze({
    policyVersion: 'project-risk-exposure-v1',
    likelihoodBand: `P${String(likelihoodIndex + 1)}` as ProjectRiskExposure['likelihoodBand'],
    impactBand: `I${String(impact.upperBand)}` as ProjectRiskExposure['impactBand'],
    level,
  })
}

/**
 * Normalize only facts supplied by the caller. The synthetic instant is the
 * requested review date itself, so this validates date shape/order while
 * deliberately deferring the Project-relative current-date rule.
 */
export function normalizeProjectRiskAssessmentIntent(
  value: unknown,
): NormalizedProjectRiskAssessmentIntent {
  const nextReviewOn = isoDate(
    isPlainRecord(value) ? Reflect.get(value, 'nextReviewOn') : undefined,
    'nextReviewOn',
  )
  const normalized = normalizeProjectRiskAssessment(value, {
    assessedAt: `${nextReviewOn}T00:00:00.000Z`,
    projectTimezone: 'UTC',
    previousTrigger: null,
  })
  const { assessedAt: _assessedAt, digest: _digest, trigger, ...intent } = normalized
  return Object.freeze({
    ...intent,
    trigger: Object.freeze({ statement: trigger.statement, state: trigger.state }),
  })
}

/**
 * Validate, normalize, and derive one complete assessment replacement. Set-like
 * identities are sorted before hashing; assumptions deliberately retain order.
 */
export function normalizeProjectRiskAssessment(
  value: unknown,
  options: NormalizeProjectRiskAssessmentOptions,
): NormalizedProjectRiskAssessment {
  const record = exactRecord(value, 'assessment', [
    'statement',
    'category',
    'trigger',
    'probability',
    'impact',
    'confidence',
    'confidenceRationale',
    'assessmentHorizonEnd',
    'nextReviewOn',
    'assumptions',
    'accountableMemberId',
    'contributorMemberIds',
    'humanSponsorMemberId',
    'evidence',
    'dependencies',
    'mitigationTaskGuids',
    'contingencyTaskGuids',
  ])
  const statementRecord = exactRecord(record.statement, 'statement', [
    'condition', 'event', 'consequence',
  ])
  const statement = Object.freeze({
    condition: optionalText(statementRecord.condition, 'statement.condition', MAX_STATEMENT_LENGTH),
    event: boundedText(statementRecord.event, 'statement.event', MAX_STATEMENT_LENGTH),
    consequence: boundedText(
      statementRecord.consequence,
      'statement.consequence',
      MAX_STATEMENT_LENGTH,
    ),
  })
  if (!PROJECT_RISK_CATEGORIES.has(record.category as ProjectRiskCategory)) {
    throw new TypeError('assessment.category is not supported')
  }
  const category = record.category as ProjectRiskCategory
  const triggerRecord = exactRecord(record.trigger, 'trigger', ['statement', 'state'])
  if (triggerRecord.state !== 'unknown'
    && triggerRecord.state !== 'not-met'
    && triggerRecord.state !== 'met') {
    throw new TypeError('trigger.state is not supported')
  }
  const assessedAt = isoTimestamp(options.assessedAt, 'assessedAt')
  const projectToday = projectDateAt(assessedAt, options.projectTimezone)
  const previousTrigger = normalizePreviousTrigger(options.previousTrigger)
  const triggerStatement = boundedText(
    triggerRecord.statement,
    'trigger.statement',
    MAX_TRIGGER_LENGTH,
  )
  const trigger = Object.freeze({
    statement: triggerStatement,
    state: triggerRecord.state,
    observedAt: triggerRecord.state === 'met'
      ? previousTrigger?.state === 'met' && previousTrigger.statement === triggerStatement
        ? previousTrigger.observedAt
        : assessedAt
      : null,
  }) as ProjectRiskTriggerProjection
  const probabilityRecord = exactRecord(record.probability, 'probability', [
    'lowerBasisPoints', 'upperBasisPoints',
  ])
  const probability = Object.freeze({
    lowerBasisPoints: probabilityRecord.lowerBasisPoints,
    upperBasisPoints: probabilityRecord.upperBasisPoints,
  }) as ProjectRiskProbabilityInterval
  const impactRecord = exactRecord(record.impact, 'impact', ['lowerBand', 'upperBand'])
  const impact = Object.freeze({
    lowerBand: impactRecord.lowerBand,
    upperBand: impactRecord.upperBand,
  }) as ProjectRiskImpactInterval
  const exposure = projectRiskExposure(probability, impact)
  if (!PROJECT_RISK_CONFIDENCE.has(record.confidence as ProjectRiskConfidence)) {
    throw new TypeError('assessment.confidence is not supported')
  }
  const confidence = record.confidence as ProjectRiskConfidence
  const confidenceRationale = boundedText(
    record.confidenceRationale,
    'confidenceRationale',
    MAX_CONFIDENCE_RATIONALE_LENGTH,
  )
  const assessmentHorizonEnd = isoDate(record.assessmentHorizonEnd, 'assessmentHorizonEnd')
  const nextReviewOn = isoDate(record.nextReviewOn, 'nextReviewOn')
  if (nextReviewOn > assessmentHorizonEnd) {
    throw new TypeError('nextReviewOn must not be after assessmentHorizonEnd')
  }
  if (assessmentHorizonEnd < projectToday) {
    throw new TypeError('assessmentHorizonEnd must not be before the Project current date')
  }
  if (nextReviewOn < projectToday) {
    throw new TypeError('nextReviewOn must not be before the Project current date')
  }
  const assumptions = normalizedTextArray(
    record.assumptions,
    'assumptions',
    MAX_ASSUMPTIONS,
    MAX_ASSUMPTION_LENGTH,
  )
  const accountableMemberId = safeId(record.accountableMemberId, 'accountableMemberId')
  const contributorMemberIds = normalizedIdSet(
    record.contributorMemberIds,
    'contributorMemberIds',
    MAX_CONTRIBUTORS,
  )
  if (contributorMemberIds.includes(accountableMemberId)) {
    throw new TypeError('accountableMemberId must not appear in contributorMemberIds')
  }
  const humanSponsorMemberId = record.humanSponsorMemberId === null
    ? null
    : safeId(record.humanSponsorMemberId, 'humanSponsorMemberId')
  if (humanSponsorMemberId === accountableMemberId) {
    throw new TypeError('humanSponsorMemberId must differ from accountableMemberId')
  }
  const evidence = normalizedEvidence(record.evidence)
  const dependencies = normalizedDependencies(record.dependencies)
  const mitigationTaskGuids = normalizedIdSet(
    record.mitigationTaskGuids,
    'mitigationTaskGuids',
    MAX_TREATMENT_TASKS,
  )
  const contingencyTaskGuids = normalizedIdSet(
    record.contingencyTaskGuids,
    'contingencyTaskGuids',
    MAX_TREATMENT_TASKS,
  )
  if (mitigationTaskGuids.some(taskGuid => contingencyTaskGuids.includes(taskGuid))) {
    throw new TypeError('treatment task sets must be disjoint')
  }

  const normalizedWithoutDigest = Object.freeze({
    statement,
    category,
    trigger,
    probability,
    impact,
    confidence,
    confidenceRationale,
    assessmentHorizonEnd,
    nextReviewOn,
    assumptions,
    accountableMemberId,
    contributorMemberIds,
    humanSponsorMemberId,
    evidence,
    dependencies,
    mitigationTaskGuids,
    contingencyTaskGuids,
    exposure,
    assessedAt,
  })
  const digest = `sha256:${createHash('sha256').update(canonicalizeJson({
    schemaVersion: 'project-risk-assessment-v1',
    assessment: normalizedWithoutDigest,
  }), 'utf8').digest('hex')}` as WorkbenchDigest
  return Object.freeze({ ...normalizedWithoutDigest, digest })
}

/** Validate one explicit lifecycle edge without mutating assessment or task truth. */
export function normalizeProjectRiskTransition(
  value: unknown,
  options: NormalizeProjectRiskTransitionOptions,
): NormalizedProjectRiskTransition {
  if (!PROJECT_RISK_STATUSES.has(options.currentStatus)) {
    throw new TypeError('currentStatus is not supported')
  }
  const intent = normalizeProjectRiskTransitionIntent(value)
  const toStatus = intent.toStatus
  if (options.currentStatus === 'closed') {
    throw new TypeError('closed Project Risk status is terminal')
  }
  if (toStatus === options.currentStatus) {
    throw new TypeError('transition.status must be different from currentStatus')
  }
  if (!Number.isSafeInteger(options.availableMitigationTaskCount)
    || options.availableMitigationTaskCount < 0) {
    throw new TypeError('availableMitigationTaskCount must be a non-negative safe integer')
  }
  if (toStatus === 'mitigate' && options.availableMitigationTaskCount < 1) {
    throw new TypeError('mitigate requires an available mitigation task')
  }
  const occurredAt = isoTimestamp(options.occurredAt, 'occurredAt')
  const projectToday = projectDateAt(occurredAt, options.projectTimezone)
  const currentNextReviewOn = isoDate(options.currentNextReviewOn, 'currentNextReviewOn')
  if (toStatus !== 'closed' && currentNextReviewOn < projectToday) {
    throw new TypeError('active Project Risk review is overdue; reassessment is required')
  }
  return Object.freeze({
    fromStatus: options.currentStatus,
    toStatus,
    rationale: intent.rationale,
    closureReason: intent.closureReason,
    occurredAt,
  })
}

/** Validate caller-supplied transition facts without consulting current Risk state. */
export function normalizeProjectRiskTransitionIntent(
  value: unknown,
): NormalizedProjectRiskTransitionIntent {
  const candidateStatus = isPlainRecord(value) ? Reflect.get(value, 'status') : undefined
  const record = exactRecord(
    value,
    'transition',
    candidateStatus === 'closed'
      ? ['status', 'rationale', 'closureReason']
      : ['status', 'rationale'],
  )
  if (!PROJECT_RISK_STATUSES.has(record.status as ProjectRiskStatus)) {
    throw new TypeError('transition.status is not supported')
  }
  const toStatus = record.status as ProjectRiskStatus
  const closureReason = toStatus === 'closed'
    ? PROJECT_RISK_CLOSURE_REASONS.has(record.closureReason as ProjectRiskClosureReason)
      ? record.closureReason as ProjectRiskClosureReason
      : invalid('transition.closureReason is not supported')
    : null
  return Object.freeze({
    toStatus,
    rationale: boundedText(
      record.rationale,
      'transition.rationale',
      MAX_TRANSITION_RATIONALE_LENGTH,
    ),
    closureReason,
  })
}

/** Re-evaluate the complete current Risk->Risk graph with one proposed edge set. */
export function assertProjectRiskDependencyGraph(
  riskIdValue: string,
  proposedDependencies: readonly ProjectRiskDependency[],
  currentGraph: ReadonlyMap<string, readonly string[]>,
): void {
  const riskId = safeId(riskIdValue, 'riskId')
  const normalized = normalizedDependencies(proposedDependencies)
  if (normalized.some(dependency => dependency.riskId === riskId)) {
    throw new TypeError('Project Risk cannot depend on itself')
  }
  const graph = new Map<string, readonly string[]>()
  for (const [nodeValue, edgesValue] of currentGraph) {
    const node = safeId(nodeValue, 'dependencyGraph node')
    if (!Array.isArray(edgesValue)) throw new TypeError('dependencyGraph edges must be an array')
    graph.set(node, Object.freeze(edgesValue.map((edge, index) =>
      safeId(edge, `dependencyGraph[${node}][${String(index)}]`))))
  }
  graph.set(riskId, Object.freeze(normalized.map(dependency => dependency.riskId)))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const dependency of graph.get(node) ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  if (visit(riskId)) throw new TypeError('Project Risk dependency would create a cycle')
}

function normalizePreviousTrigger(
  value: ProjectRiskTriggerProjection | null,
): ProjectRiskTriggerProjection | null {
  if (value === null) return null
  const record = exactRecord(value, 'previousTrigger', ['statement', 'state', 'observedAt'])
  if (record.state !== 'unknown' && record.state !== 'not-met' && record.state !== 'met') {
    throw new TypeError('previousTrigger.state is not supported')
  }
  const observedAt = record.state === 'met'
    ? isoTimestamp(record.observedAt, 'previousTrigger.observedAt')
    : record.observedAt === null
      ? null
      : invalid('previousTrigger.observedAt must be null unless the trigger is met')
  return Object.freeze({
    statement: boundedText(record.statement, 'previousTrigger.statement', MAX_TRIGGER_LENGTH),
    state: record.state,
    observedAt,
  })
}

function normalizedEvidence(value: unknown): readonly ProjectRiskEvidenceRef[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE) {
    throw new TypeError(`evidence must contain 0-${String(MAX_EVIDENCE)} items`)
  }
  const items = value.map((candidate, index): ProjectRiskEvidenceRef => {
    const kind = isPlainRecord(candidate) ? Reflect.get(candidate, 'kind') : undefined
    if (kind === 'workbench-audit-event') {
      const record = exactRecord(candidate, `evidence[${String(index)}]`, ['kind', 'auditEventId'])
      return Object.freeze({
        kind,
        auditEventId: safeId(record.auditEventId, `evidence[${String(index)}].auditEventId`),
      })
    }
    if (kind === 'project-schedule-change') {
      const record = exactRecord(candidate, `evidence[${String(index)}]`, [
        'kind', 'scheduleChangeId',
      ])
      return Object.freeze({
        kind,
        scheduleChangeId: safeId(
          record.scheduleChangeId,
          `evidence[${String(index)}].scheduleChangeId`,
        ),
      })
    }
    throw new TypeError(`evidence[${String(index)}].kind is not supported`)
  })
  const keys = items.map(evidenceKey)
  if (new Set(keys).size !== keys.length) throw new TypeError('evidence must not contain duplicates')
  return Object.freeze(items.toSorted((left, right) => evidenceKey(left).localeCompare(evidenceKey(right))))
}

function normalizedDependencies(value: unknown): readonly ProjectRiskDependency[] {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) {
    throw new TypeError(`dependencies must contain 0-${String(MAX_DEPENDENCIES)} items`)
  }
  const items = value.map((candidate, index): ProjectRiskDependency => {
    const record = exactRecord(candidate, `dependencies[${String(index)}]`, ['kind', 'riskId'])
    if (record.kind !== 'depends-on') {
      throw new TypeError(`dependencies[${String(index)}].kind is not supported`)
    }
    return Object.freeze({
      kind: 'depends-on',
      riskId: safeId(record.riskId, `dependencies[${String(index)}].riskId`),
    })
  })
  const ids = items.map(item => item.riskId)
  if (new Set(ids).size !== ids.length) {
    throw new TypeError('dependencies must not contain duplicates')
  }
  return Object.freeze(items.toSorted((left, right) => left.riskId.localeCompare(right.riskId)))
}

function evidenceKey(value: ProjectRiskEvidenceRef): string {
  return value.kind === 'workbench-audit-event'
    ? `${value.kind}:${value.auditEventId}`
    : `${value.kind}:${value.scheduleChangeId}`
}

function normalizedTextArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumLength: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${field} must contain 0-${String(maximumItems)} items`)
  }
  return Object.freeze(value.map((item, index) =>
    boundedText(item, `${field}[${String(index)}]`, maximumLength)))
}

function normalizedIdSet(
  value: unknown,
  field: string,
  maximumItems: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${field} must contain 0-${String(maximumItems)} items`)
  }
  const items = value.map((item, index) => safeId(item, `${field}[${String(index)}]`))
  if (new Set(items).size !== items.length) throw new TypeError(`${field} must not contain duplicates`)
  return Object.freeze(items.toSorted())
}

function exactRecord(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain data object`)
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol fields`)
  }
  const allowed = new Set(fields)
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const field of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(field)) throw new TypeError(`${label} has unsupported field ${field}`)
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label}.${field} must be an enumerable data field`)
    }
    copy[field] = descriptor.value
  }
  for (const field of fields) {
    if (!Object.hasOwn(copy, field)) throw new TypeError(`${label} is missing field ${field}`)
  }
  return copy
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  const normalized = value.normalize('NFKC').trim()
  if (!normalized.isWellFormed()
    || normalized.length < 1
    || [...normalized].length > maximum
    || CONTROL_CHARACTER.test(normalized)) {
    throw new TypeError(`${field} must contain 1-${String(maximum)} safe characters`)
  }
  return normalized
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === null) return null
  return boundedText(value, field, maximum)
}

function safeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`${field} must be a safe identifier`)
  }
  return value
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be an ISO date`)
  const match = ISO_DATE.exec(value)
  if (match === null) throw new TypeError(`${field} must be an ISO date`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day) {
    throw new TypeError(`${field} must be a valid ISO date`)
  }
  return value
}

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OFFSET_TIMESTAMP.test(value)) {
    throw new TypeError(`${field} must be an offset-bearing ISO timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${field} must be an offset-bearing ISO timestamp`)
  }
  return new Date(milliseconds).toISOString()
}

function projectDateAt(instant: string, timezone: string): string {
  if (typeof timezone !== 'string' || timezone.length < 1 || timezone.length > 128) {
    throw new TypeError('projectTimezone must be a valid IANA timezone')
  }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    throw new TypeError('projectTimezone must be a valid IANA timezone')
  }
  const parts = new Map(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  const year = parts.get('year')
  const month = parts.get('month')
  const day = parts.get('day')
  if (year === undefined || month === undefined || day === undefined) {
    throw new TypeError('projectTimezone could not produce a Project date')
  }
  return `${year}-${month}-${day}`
}

function invalid(message: string): never {
  throw new TypeError(message)
}
