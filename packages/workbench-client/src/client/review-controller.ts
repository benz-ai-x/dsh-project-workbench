/** React-free Client state machine for one Project-scoped Review Center. */

import type {
  DecideSuggestedChangeRequest,
  DecideSuggestedChangeResult,
  ProjectResponsibilityReviewDiff,
  ProjectResponsibilityReviewValue,
  ProjectResponsibilitySuggestedValue,
  ProposeProjectResponsibilityChangeRequest,
  ProposeProjectResponsibilityChangeResult,
  ReviewCenterFilter,
  ReviewCenterProjection,
  SuggestedChangeAllowedDecision,
  SuggestedChangeDecisionProjection,
  SuggestedChangeEffectiveStatus,
  SuggestedChangeEvidenceProjection,
  SuggestedChangeProjection,
  SuggestedChangeRiskLevel,
  SuggestedChangeRiskReason,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchReviewPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'disconnected'
  | 'error'
  | 'conflict'

export type WorkbenchReviewOperation = 'read-review' | 'propose' | 'decide'

export type WorkbenchReviewTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

type ReviewDomainResult =
  | ProposeProjectResponsibilityChangeResult
  | DecideSuggestedChangeResult

export type WorkbenchReviewConflictCode = Extract<
  ReviewDomainResult,
  { readonly ok: false }
>['error']['code']

export interface WorkbenchReviewTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchReviewTransportCode
  readonly operation: WorkbenchReviewOperation
}

export interface WorkbenchReviewInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request' | 'project-not-found'
  readonly operation: WorkbenchReviewOperation
}

export interface WorkbenchReviewConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchReviewConflictCode
  readonly operation: 'propose' | 'decide'
}

export type WorkbenchReviewIssue =
  | WorkbenchReviewTransportIssue
  | WorkbenchReviewInputIssue
  | WorkbenchReviewConflictIssue

export interface WorkbenchReviewSelection {
  readonly projectId: string
  readonly projectName: string
}

export interface WorkbenchReviewFilters {
  readonly status: SuggestedChangeEffectiveStatus | 'all'
  readonly riskLevel: SuggestedChangeRiskLevel | 'all'
}

/** Complete local proposal form plus the Host base against which it was reviewed. */
export interface WorkbenchReviewProposalDraft {
  readonly basedOnTeamRevision: number | null
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string
  readonly evidenceAuditEventIds: readonly string[]
}

/** One recoverable per-card review form. */
export interface WorkbenchReviewDecisionDraft {
  readonly suggestedChangeId: string
  readonly basedOnSuggestedChangeRevision: number
  readonly mode: SuggestedChangeAllowedDecision
  readonly feedback: string
  readonly candidate: ProjectResponsibilitySuggestedValue
  readonly riskAcknowledged: boolean
}

/** Advisory decision risk shown before submit; the Host remains authoritative. */
export interface WorkbenchReviewDecisionRiskPreview {
  readonly effectiveLevel: SuggestedChangeRiskLevel
  readonly appliedLevel: SuggestedChangeRiskLevel | null
  readonly appliedReasonCodes: readonly SuggestedChangeRiskReason[]
}

export interface WorkbenchReviewClientState {
  readonly phase: WorkbenchReviewPhase
  readonly selection: WorkbenchReviewSelection | null
  readonly review: ReviewCenterProjection | null
  readonly filters: WorkbenchReviewFilters
  readonly appliedFilters: WorkbenchReviewFilters
  readonly filtersDirty: boolean
  readonly proposalDraft: WorkbenchReviewProposalDraft
  readonly proposalDraftDirty: boolean
  readonly retainedProposalEvidence: readonly SuggestedChangeEvidenceProjection[]
  readonly decisionDrafts: Readonly<Record<string, WorkbenchReviewDecisionDraft>>
  readonly pendingOperation: 'propose' | 'decide' | null
  readonly pendingSuggestedChangeId: string | null
  readonly loadingMore: boolean
  readonly issue: WorkbenchReviewIssue | null
  readonly canRetryMutation: boolean
  readonly focusSuggestedChangeId: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` T06 subset used by this controller. */
export interface WorkbenchReviewRemote {
  reviewCenter(
    filter: ReviewCenterFilter,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ReviewCenterProjection | null>>
  proposeProjectResponsibilityChange(
    request: ProposeProjectResponsibilityChangeRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProposeProjectResponsibilityChangeResult>>
  decideSuggestedChange(
    request: DecideSuggestedChangeRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<DecideSuggestedChangeResult>>
}

export interface WorkbenchReviewControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (
    receipt: WorkbenchCommandReceipt,
    targetChanged: boolean,
  ) => void
  readonly nextCommandKey?: () => string
}

type MutationEnvelope =
  | {
    readonly kind: 'propose'
    readonly projectId: string
    readonly fingerprint: string
    readonly request: ProposeProjectResponsibilityChangeRequest
  }
  | {
    readonly kind: 'decide'
    readonly projectId: string
    readonly suggestedChangeId: string
    readonly fingerprint: string
    readonly request: DecideSuggestedChangeRequest
  }

const SAFE_TRANSPORT_CODES = new Set<WorkbenchReviewTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])

const AMBIGUOUS_TRANSPORT_CODES = new Set<WorkbenchReviewTransportCode>([
  'unavailable',
  'internal',
  'transport-failure',
])

export const MAX_REVIEW_EVIDENCE = 20
export const MAX_REVIEW_CONTRIBUTORS = 20
export const MAX_REVIEW_FEEDBACK_LENGTH = 2_000
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

function emptyProposalDraft(): WorkbenchReviewProposalDraft {
  return Object.freeze({
    basedOnTeamRevision: null,
    accountableMemberId: '',
    contributorMemberIds: Object.freeze([]),
    humanSponsorMemberId: '',
    evidenceAuditEventIds: Object.freeze([]),
  })
}

const INITIAL_FILTERS: WorkbenchReviewFilters = Object.freeze({
  status: 'all',
  riskLevel: 'all',
})

export const INITIAL_WORKBENCH_REVIEW_STATE: WorkbenchReviewClientState = Object.freeze({
  phase: 'idle',
  selection: null,
  review: null,
  filters: INITIAL_FILTERS,
  appliedFilters: INITIAL_FILTERS,
  filtersDirty: false,
  proposalDraft: emptyProposalDraft(),
  proposalDraftDirty: false,
  retainedProposalEvidence: Object.freeze([]),
  decisionDrafts: Object.freeze({}),
  pendingOperation: null,
  pendingSuggestedChangeId: null,
  loadingMore: false,
  issue: null,
  canRetryMutation: false,
  focusSuggestedChangeId: null,
  focusEpoch: 0,
})

/**
 * Owns the authorized Review projection, protected drafts, and exactly one
 * ambiguous-transport replay envelope. It never replays a mutation after a read.
 */
export class WorkbenchReviewController {
  private state: WorkbenchReviewClientState = INITIAL_WORKBENCH_REVIEW_STATE
  private readonly listeners = new Set<() => void>()
  private readonly inFlight = new Set<Promise<void>>()
  private readEpoch = 0
  private mutationEpoch = 0
  private readAbort: AbortController | null = null
  private mutationAbort: AbortController | null = null
  private retryEnvelope: MutationEnvelope | null = null
  private disposed = false
  private disposal: Promise<void> | null = null

  constructor(
    private readonly remote: WorkbenchReviewRemote,
    private readonly options: WorkbenchReviewControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchReviewClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Project identity is a hard boundary for Review data, drafts, and replay keys. */
  selectProject(projectId: string | null, projectName = ''): Promise<void> {
    if (!this.admitProtectedOperation()) return Promise.resolve()
    const normalized = projectId?.trim() ?? ''
    if (normalized === '') {
      this.clearSelection()
      return Promise.resolve()
    }
    if (this.state.selection?.projectId === normalized) {
      if (projectName !== '' && projectName !== this.state.selection.projectName) {
        this.publish({
          ...this.state,
          selection: Object.freeze({ projectId: normalized, projectName }),
        })
      }
      return Promise.resolve()
    }
    this.cancelAll('Workbench Review Center switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_REVIEW_STATE,
      phase: 'loading',
      selection: Object.freeze({ projectId: normalized, projectName }),
    })
    return this.track(this.doRefresh(false, false))
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Review Center selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_REVIEW_STATE)
  }

  refresh(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    return this.track(this.doRefresh(false, false))
  }

  setStatusFilter(status: SuggestedChangeEffectiveStatus | 'all'): void {
    if (!this.canEditLocalState()) return
    const filters = Object.freeze({ ...this.state.filters, status })
    this.publish({
      ...this.state,
      filters,
      filtersDirty: !sameReviewFilters(filters, this.state.appliedFilters),
      issue: this.state.issue?.operation === 'read-review' ? null : this.state.issue,
    })
  }

  setRiskFilter(riskLevel: SuggestedChangeRiskLevel | 'all'): void {
    if (!this.canEditLocalState()) return
    const filters = Object.freeze({ ...this.state.filters, riskLevel })
    this.publish({
      ...this.state,
      filters,
      filtersDirty: !sameReviewFilters(filters, this.state.appliedFilters),
      issue: this.state.issue?.operation === 'read-review' ? null : this.state.issue,
    })
  }

  applyFilters(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    return this.track(this.doRefresh(false, false, Object.freeze({
      filters: this.state.filters,
      commitFilters: true,
    })))
  }

  loadMore(): Promise<void> {
    if (!this.canRead() || this.state.review?.nextBeforeSequence === null
      || this.state.phase === 'loading' || this.state.loadingMore
      || this.state.filtersDirty) return Promise.resolve()
    return this.track(this.doRefresh(true, false))
  }

  setProposalAccountable(memberId: string): void {
    const accountableMemberId = memberId.trim()
    const accountable = this.state.review?.proposalBuilder.memberOptions
      .find(member => member.memberId === accountableMemberId)
    this.updateProposalDraft({
      ...this.state.proposalDraft,
      accountableMemberId,
      contributorMemberIds: this.state.proposalDraft.contributorMemberIds
        .filter(candidate => candidate !== accountableMemberId),
      humanSponsorMemberId: accountable?.requiresHumanSponsor !== true
        || this.state.proposalDraft.humanSponsorMemberId === accountableMemberId
        ? ''
        : this.state.proposalDraft.humanSponsorMemberId,
    })
  }

  setProposalContributor(memberId: string, selected: boolean): void {
    const normalized = memberId.trim()
    if (normalized === '' || normalized === this.state.proposalDraft.accountableMemberId) return
    if (selected && this.state.review?.proposalBuilder.memberOptions.some(member =>
      member.memberId === normalized && member.status === 'active') !== true) return
    const retained = this.state.proposalDraft.contributorMemberIds
      .filter(candidate => candidate !== normalized)
    if (selected && retained.length >= MAX_REVIEW_CONTRIBUTORS) return
    this.updateProposalDraft({
      ...this.state.proposalDraft,
      contributorMemberIds: selected ? [...retained, normalized].sort() : retained,
    })
  }

  setProposalHumanSponsor(memberId: string): void {
    const humanSponsorMemberId = memberId.trim()
    this.updateProposalDraft({
      ...this.state.proposalDraft,
      humanSponsorMemberId,
    })
  }

  setProposalEvidence(auditEventId: string, selected: boolean): void {
    const normalized = auditEventId.trim()
    if (normalized === '') return
    const retained = this.state.proposalDraft.evidenceAuditEventIds
      .filter(candidate => candidate !== normalized)
    if (selected && retained.length >= MAX_REVIEW_EVIDENCE) return
    const evidence = this.state.review?.proposalBuilder.evidenceOptions
      .find(candidate => candidate.auditEventId === normalized)
      ?? this.state.retainedProposalEvidence
        .find(candidate => candidate.auditEventId === normalized)
    if (selected && evidence === undefined) return
    const retainedProjection = this.state.retainedProposalEvidence
      .filter(candidate => candidate.auditEventId !== normalized)
    if (selected && evidence !== undefined) retainedProjection.push(detachEvidence(evidence))
    this.updateProposalDraft({
      ...this.state.proposalDraft,
      evidenceAuditEventIds: selected ? [...retained, normalized] : retained,
    }, Object.freeze(retainedProjection))
  }

  resetProposalDraft(): void {
    if (!this.canEditLocalState()) return
    if (this.retryEnvelope?.kind === 'propose') this.retryEnvelope = null
    this.publish({
      ...this.state,
      proposalDraft: proposalDraftFrom(this.state.review),
      proposalDraftDirty: false,
      retainedProposalEvidence: Object.freeze([]),
      issue: this.state.issue?.operation === 'propose' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  /** Explicitly acknowledges a refreshed Team base without silently submitting. */
  adoptLatestProposalBase(): void {
    const builder = this.state.review?.proposalBuilder
    if (!this.canEditLocalState() || builder === undefined) return
    if (this.retryEnvelope?.kind === 'propose') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      proposalDraft: freezeProposalDraft({
        ...this.state.proposalDraft,
        basedOnTeamRevision: builder.teamRevision,
      }),
      proposalDraftDirty: true,
      issue: this.state.issue?.operation === 'propose' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  canPropose(): boolean {
    const review = this.state.review
    return this.canMutate()
      && review !== null
      && this.state.proposalDraftDirty
      && this.state.proposalDraft.basedOnTeamRevision === review.proposalBuilder.teamRevision
      && validCandidate(this.proposalCandidate(), review)
      && validEvidence(this.state.proposalDraft.evidenceAuditEventIds)
      && this.state.proposalDraft.evidenceAuditEventIds.every(auditEventId =>
        review.proposalBuilder.evidenceOptions.some(
          evidence => evidence.auditEventId === auditEventId,
        ) || this.state.retainedProposalEvidence.some(
          evidence => evidence.auditEventId === auditEventId,
        ))
      && !sameResponsibility(review.proposalBuilder.base, this.proposalCandidate())
  }

  propose(): Promise<void> {
    const selection = this.state.selection
    const draft = this.state.proposalDraft
    const candidate = this.proposalCandidate()
    if (!this.canPropose() || selection === null || draft.basedOnTeamRevision === null) {
      return Promise.resolve()
    }
    const fingerprint = JSON.stringify({
      projectId: selection.projectId,
      candidate,
      expectedTeamRevision: draft.basedOnTeamRevision,
      evidenceAuditEventIds: draft.evidenceAuditEventIds,
    })
    const retained = this.retryEnvelope?.kind === 'propose'
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope: MutationEnvelope = retained ?? Object.freeze({
      kind: 'propose' as const,
      projectId: selection.projectId,
      fingerprint,
      request: Object.freeze({
        projectId: selection.projectId,
        candidate: freezeCandidate(candidate),
        expectedTeamRevision: draft.basedOnTeamRevision,
        evidenceRefs: Object.freeze(draft.evidenceAuditEventIds.map(auditEventId => Object.freeze({
          kind: 'workbench-audit-event' as const,
          auditEventId,
        }))),
        ...this.correlation(),
        reason: 'owner-suggested-change-propose' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  setDecisionMode(suggestedChangeId: string, mode: SuggestedChangeAllowedDecision): void {
    const card = this.card(suggestedChangeId)
    if (!this.canEditLocalState() || card === null || !card.allowedDecisions.includes(mode)) return
    const current = this.decisionDraft(card)
    this.updateDecisionDraft({
      ...current,
      mode,
      riskAcknowledged: false,
    })
  }

  setDecisionFeedback(suggestedChangeId: string, feedback: string): void {
    const card = this.card(suggestedChangeId)
    if (!this.canEditLocalState() || card === null) return
    this.updateDecisionDraft({ ...this.decisionDraft(card), feedback })
  }

  setDecisionRiskAcknowledged(suggestedChangeId: string, acknowledged: boolean): void {
    const card = this.card(suggestedChangeId)
    if (!this.canEditLocalState() || card === null) return
    this.updateDecisionDraft({
      ...this.decisionDraft(card),
      riskAcknowledged: acknowledged,
    })
  }

  setDecisionAccountable(suggestedChangeId: string, memberId: string): void {
    this.updateDecisionCandidate(suggestedChangeId, candidate => {
      const accountableMemberId = memberId.trim()
      const accountable = this.state.review?.proposalBuilder.memberOptions
        .find(member => member.memberId === accountableMemberId)
      return {
        ...candidate,
        accountableMemberId,
        contributorMemberIds: candidate.contributorMemberIds
          .filter(value => value !== accountableMemberId),
        humanSponsorMemberId: accountable?.requiresHumanSponsor !== true
          || candidate.humanSponsorMemberId === accountableMemberId
          ? null
          : candidate.humanSponsorMemberId,
      }
    })
  }

  setDecisionContributor(
    suggestedChangeId: string,
    memberId: string,
    selected: boolean,
  ): void {
    this.updateDecisionCandidate(suggestedChangeId, candidate => {
      const normalized = memberId.trim()
      if (normalized === '' || normalized === candidate.accountableMemberId) return candidate
      if (selected && this.state.review?.proposalBuilder.memberOptions.some(member =>
        member.memberId === normalized && member.status === 'active') !== true) return candidate
      const retained = candidate.contributorMemberIds.filter(value => value !== normalized)
      if (selected && retained.length >= MAX_REVIEW_CONTRIBUTORS) return candidate
      return {
        ...candidate,
        contributorMemberIds: selected ? [...retained, normalized].sort() : retained,
      }
    })
  }

  setDecisionHumanSponsor(suggestedChangeId: string, memberId: string): void {
    this.updateDecisionCandidate(suggestedChangeId, candidate => {
      const normalized = memberId.trim()
      return {
        ...candidate,
        humanSponsorMemberId: normalized === '' ? null : normalized,
      }
    })
  }

  resetDecisionDraft(suggestedChangeId: string): void {
    if (!this.canEditLocalState()) return
    if (this.retryEnvelope?.kind === 'decide'
      && this.retryEnvelope.suggestedChangeId === suggestedChangeId) this.retryEnvelope = null
    const decisionDrafts = { ...this.state.decisionDrafts }
    delete decisionDrafts[suggestedChangeId]
    this.publish({
      ...this.state,
      decisionDrafts: Object.freeze(decisionDrafts),
      issue: this.state.issue?.operation === 'decide' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  /** Explicitly adopts the refreshed card revision; no decision is submitted. */
  adoptLatestDecisionRevision(suggestedChangeId: string): void {
    const card = this.card(suggestedChangeId)
    if (!this.canEditLocalState() || card === null || card.allowedDecisions.length === 0) return
    const current = this.decisionDraft(card)
    const mode = card.allowedDecisions.includes(current.mode)
      ? current.mode
      : card.allowedDecisions[0]
    if (mode === undefined) return
    if (this.retryEnvelope?.kind === 'decide'
      && this.retryEnvelope.suggestedChangeId === suggestedChangeId) this.retryEnvelope = null
    this.updateDecisionDraft({
      ...current,
      basedOnSuggestedChangeRevision: card.revision,
      mode,
      riskAcknowledged: false,
    })
  }

  decisionRiskLevel(suggestedChangeId: string): SuggestedChangeRiskLevel | null {
    return this.decisionRiskPreview(suggestedChangeId)?.effectiveLevel ?? null
  }

  decisionRiskPreview(suggestedChangeId: string): WorkbenchReviewDecisionRiskPreview | null {
    const card = this.card(suggestedChangeId)
    if (card === null) return null
    const draft = this.decisionDraft(card)
    if (draft.mode !== 'edit-and-accept') {
      return Object.freeze({
        effectiveLevel: card.risk.effectiveLevel,
        appliedLevel: null,
        appliedReasonCodes: Object.freeze([]),
      })
    }
    const applied = riskForCandidate(card.proposedDiff.before, draft.candidate)
    return Object.freeze({
      effectiveLevel: card.risk.effectiveLevel === 'high' || applied.level === 'high'
        ? 'high'
        : 'low',
      appliedLevel: applied.level,
      appliedReasonCodes: applied.reasons,
    })
  }

  canDecide(suggestedChangeId: string): boolean {
    const card = this.card(suggestedChangeId)
    if (!this.canMutate() || card === null) return false
    const draft = this.decisionDraft(card)
    if (draft.basedOnSuggestedChangeRevision !== card.revision
      || !card.allowedDecisions.includes(draft.mode)
      || !boundedText(draft.feedback.trim(), MAX_REVIEW_FEEDBACK_LENGTH)) return false
    if (draft.mode === 'edit-and-accept') {
      if (!validCandidate(draft.candidate, this.state.review)
        || sameResponsibility(card.proposedDiff.before, draft.candidate)) return false
    }
    const risk = this.decisionRiskLevel(suggestedChangeId)
    return (draft.mode !== 'accept' && draft.mode !== 'edit-and-accept')
      || risk !== 'high'
      || draft.riskAcknowledged
  }

  decide(suggestedChangeId: string): Promise<void> {
    const selection = this.state.selection
    const card = this.card(suggestedChangeId)
    if (!this.canDecide(suggestedChangeId) || selection === null || card === null) {
      return Promise.resolve()
    }
    const draft = this.decisionDraft(card)
    const feedback = draft.feedback.trim()
    const riskLevel = this.decisionRiskLevel(suggestedChangeId)
    const request = this.decisionRequest(selection.projectId, card, draft, feedback, riskLevel)
    const fingerprint = fingerprintDecisionRequest(request)
    const retained = this.retryEnvelope?.kind === 'decide'
      && this.retryEnvelope.suggestedChangeId === suggestedChangeId
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope: MutationEnvelope = retained ?? Object.freeze({
      kind: 'decide' as const,
      projectId: selection.projectId,
      suggestedChangeId,
      fingerprint,
      request,
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  retryMutation(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null
      || this.retryEnvelope === null) return Promise.resolve()
    return this.track(this.doMutation(this.retryEnvelope))
  }

  markDisconnected(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Review Center connection generation changed')
    this.publish({
      ...this.state,
      phase: this.state.selection === null ? 'idle' : 'disconnected',
      pendingOperation: null,
      pendingSuggestedChangeId: null,
      loadingMore: false,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  /** Re-read Host truth while retaining same-Project drafts and exact retry identity. */
  connectionReset(): Promise<void> {
    if (!this.canRead()) return Promise.resolve()
    this.cancelAll('Workbench Review Center connection generation changed')
    this.publish({
      ...this.state,
      phase: 'disconnected',
      pendingOperation: null,
      pendingSuggestedChangeId: null,
      loadingMore: false,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
    return this.track(this.doRefresh(false, false))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Review Center Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_REVIEW_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRefresh(
    append: boolean,
    keepIssue: boolean,
    filterRequest?: {
      readonly filters: WorkbenchReviewFilters
      readonly commitFilters: boolean
    },
  ): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const requestFilters = Object.freeze({
      ...(filterRequest?.filters ?? this.state.appliedFilters),
    })
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Review Center refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    const retainedIssue = keepIssue ? this.state.issue : null
    const beforeSequence = append ? this.state.review?.nextBeforeSequence ?? undefined : undefined
    this.publish({
      ...this.state,
      phase: append ? this.state.phase : 'loading',
      loadingMore: append,
      issue: retainedIssue,
    })
    try {
      const result = await this.remote.reviewCenter(Object.freeze({
        projectId: selection.projectId,
        ...(requestFilters.status === 'all' ? {} : { status: requestFilters.status }),
        ...(requestFilters.riskLevel === 'all'
          ? {}
          : { riskLevel: requestFilters.riskLevel }),
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
        limit: 20,
      }), abort.signal)
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      if (!result.ok) {
        this.publishReadFailure(result.error)
        return
      }
      if (result.value === null) {
        this.publish({
          ...this.state,
          phase: 'error',
          review: null,
          loadingMore: false,
          issue: Object.freeze({
            kind: 'input',
            code: 'project-not-found',
            operation: 'read-review',
          }),
        })
        return
      }
      const incoming = detachReviewCenter(result.value)
      const review = append && this.state.review !== null
        ? mergeReviewCenter(this.state.review, incoming)
        : incoming
      const appliedFilters = filterRequest?.commitFilters === true
        ? requestFilters
        : this.state.appliedFilters
      this.publish({
        ...this.state,
        phase: keepIssue && retainedIssue?.kind === 'conflict' ? 'conflict' : 'ready',
        review,
        appliedFilters,
        filtersDirty: !sameReviewFilters(this.state.filters, appliedFilters),
        proposalDraft: this.state.proposalDraftDirty
          ? this.state.proposalDraft
          : proposalDraftFrom(review),
        retainedProposalEvidence: this.state.proposalDraftDirty
          ? this.state.retainedProposalEvidence
          : Object.freeze([]),
        loadingMore: false,
        issue: keepIssue ? retainedIssue : null,
        canRetryMutation: this.retryEnvelope !== null,
      })
    } catch (error) {
      if (!this.acceptRead(epoch, abort, selection.projectId)) return
      this.readAbort = null
      this.publishReadFailure(error)
    }
  }

  private async doMutation(envelope: MutationEnvelope): Promise<void> {
    if (this.disposed || this.state.selection?.projectId !== envelope.projectId) return
    const epoch = ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench Review Center mutation was superseded'))
    const abort = new AbortController()
    this.mutationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.kind,
      pendingSuggestedChangeId: envelope.kind === 'decide'
        ? envelope.suggestedChangeId
        : null,
      issue: null,
      canRetryMutation: false,
      focusSuggestedChangeId: null,
    })
    let result: RemoteResult<ReviewDomainResult>
    try {
      result = await this.invokeMutation(envelope, abort.signal)
    } catch (error) {
      if (!this.acceptMutation(epoch, abort, envelope.projectId)) return
      this.mutationAbort = null
      this.publishMutationTransportFailure(envelope.kind, error)
      return
    }
    if (!this.acceptMutation(epoch, abort, envelope.projectId)) return
    this.mutationAbort = null
    if (!result.ok) {
      this.publishMutationTransportFailure(envelope.kind, result.error)
      return
    }
    const outcome = result.value
    if (!outcome.ok) {
      this.retryEnvelope = null
      this.publish({
        ...this.state,
        phase: 'conflict',
        pendingOperation: null,
        pendingSuggestedChangeId: null,
        issue: Object.freeze({
          kind: 'conflict',
          code: outcome.error.code,
          operation: envelope.kind,
        }),
        canRetryMutation: false,
      })
      await this.doRefresh(false, true)
      return
    }

    this.retryEnvelope = null
    const focusSuggestedChangeId = outcome.value.suggestedChangeId
    let targetChanged = false
    if (envelope.kind === 'propose') {
      this.publish({
        ...this.state,
        proposalDraft: emptyProposalDraft(),
        proposalDraftDirty: false,
        retainedProposalEvidence: Object.freeze([]),
      })
    } else {
      const decisionDrafts = { ...this.state.decisionDrafts }
      delete decisionDrafts[envelope.suggestedChangeId]
      targetChanged = 'appliedTeamRevision' in outcome.value
        && outcome.value.appliedTeamRevision !== null
      this.publish({ ...this.state, decisionDrafts: Object.freeze(decisionDrafts) })
    }
    this.publish({
      ...this.state,
      phase: 'loading',
      pendingOperation: null,
      pendingSuggestedChangeId: null,
      issue: null,
      canRetryMutation: false,
      focusSuggestedChangeId,
    })
    this.notifyCommitted(outcome.receipt, targetChanged)
    await this.doRefresh(false, false)
    if (this.state.review?.items.some(item => item.suggestedChangeId === focusSuggestedChangeId)
      === true) {
      this.publish({
        ...this.state,
        focusSuggestedChangeId,
        focusEpoch: this.state.focusEpoch + 1,
      })
    }
  }

  private invokeMutation(
    envelope: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<RemoteResult<ReviewDomainResult>> {
    if (envelope.kind === 'propose') {
      return this.remote.proposeProjectResponsibilityChange(envelope.request, signal)
    }
    return this.remote.decideSuggestedChange(envelope.request, signal)
  }

  private updateProposalDraft(
    next: WorkbenchReviewProposalDraft,
    retainedProposalEvidence = this.state.retainedProposalEvidence,
  ): void {
    if (!this.canEditLocalState()) return
    if (this.retryEnvelope?.kind === 'propose') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      proposalDraft: freezeProposalDraft(next),
      proposalDraftDirty: true,
      retainedProposalEvidence,
      issue: this.state.issue?.operation === 'propose' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private updateDecisionCandidate(
    suggestedChangeId: string,
    update: (candidate: ProjectResponsibilitySuggestedValue) => ProjectResponsibilitySuggestedValue,
  ): void {
    const card = this.card(suggestedChangeId)
    if (!this.canEditLocalState() || card === null) return
    const draft = this.decisionDraft(card)
    this.updateDecisionDraft({
      ...draft,
      candidate: freezeCandidate(update(draft.candidate)),
      riskAcknowledged: false,
    })
  }

  private updateDecisionDraft(next: WorkbenchReviewDecisionDraft): void {
    if (!this.canEditLocalState()) return
    if (this.retryEnvelope?.kind === 'decide'
      && this.retryEnvelope.suggestedChangeId === next.suggestedChangeId) {
      this.retryEnvelope = null
    }
    this.publish({
      ...this.state,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      decisionDrafts: Object.freeze({
        ...this.state.decisionDrafts,
        [next.suggestedChangeId]: freezeDecisionDraft(next),
      }),
      issue: this.state.issue?.operation === 'decide' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private decisionDraft(card: SuggestedChangeProjection): WorkbenchReviewDecisionDraft {
    return this.state.decisionDrafts[card.suggestedChangeId]
      ?? decisionDraftFrom(card)
  }

  private card(suggestedChangeId: string): SuggestedChangeProjection | null {
    return this.state.review?.items.find(item => item.suggestedChangeId === suggestedChangeId)
      ?? null
  }

  private proposalCandidate(): ProjectResponsibilitySuggestedValue {
    return Object.freeze({
      accountableMemberId: this.state.proposalDraft.accountableMemberId,
      contributorMemberIds: Object.freeze([...this.state.proposalDraft.contributorMemberIds]),
      humanSponsorMemberId: this.state.proposalDraft.humanSponsorMemberId === ''
        ? null
        : this.state.proposalDraft.humanSponsorMemberId,
    })
  }

  private decisionRequest(
    projectId: string,
    card: SuggestedChangeProjection,
    draft: WorkbenchReviewDecisionDraft,
    feedback: string,
    riskLevel: SuggestedChangeRiskLevel | null,
  ): DecideSuggestedChangeRequest {
    const common = {
      projectId,
      suggestedChangeId: card.suggestedChangeId,
      expectedSuggestedChangeRevision: draft.basedOnSuggestedChangeRevision,
      feedback,
      ...this.correlation(),
    } as const
    switch (draft.mode) {
      case 'accept':
        return Object.freeze({
          ...common,
          mode: 'accept',
          acknowledgedRiskLevel: riskLevel ?? card.risk.effectiveLevel,
          reason: 'owner-suggested-change-accept',
        })
      case 'edit-and-accept':
        return Object.freeze({
          ...common,
          mode: 'edit-and-accept',
          acknowledgedRiskLevel: riskLevel ?? card.risk.effectiveLevel,
          candidate: freezeCandidate(draft.candidate),
          reason: 'owner-suggested-change-edit-accept',
        })
      case 'reject':
        return Object.freeze({
          ...common,
          mode: 'reject',
          reason: 'owner-suggested-change-reject',
        })
      case 'defer':
        return Object.freeze({
          ...common,
          mode: 'defer',
          reason: 'owner-suggested-change-defer',
        })
    }
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private canRead(): boolean {
    return this.admitProtectedOperation()
      && this.state.selection !== null
      && this.state.pendingOperation === null
  }

  private canEditLocalState(): boolean {
    return this.admitProtectedOperation() && this.state.pendingOperation === null
  }

  private canMutate(): boolean {
    return this.canEditLocalState()
      && this.state.selection !== null
      && this.state.review !== null
      && this.state.phase !== 'loading'
      && this.state.phase !== 'disconnected'
  }

  private acceptRead(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed
      && this.state.selection?.projectId === projectId
      && epoch === this.readEpoch
      && this.readAbort === abort
      && !abort.signal.aborted
  }

  private acceptMutation(epoch: number, abort: AbortController, projectId: string): boolean {
    return !this.disposed
      && this.state.selection?.projectId === projectId
      && epoch === this.mutationEpoch
      && this.mutationAbort === abort
      && !abort.signal.aborted
  }

  private publishReadFailure(error: unknown): void {
    const issue = classifyTransportOrInput(error, 'read-review')
    this.publish({
      ...this.state,
      phase: 'error',
      loadingMore: false,
      pendingOperation: null,
      pendingSuggestedChangeId: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private publishMutationTransportFailure(
    operation: 'propose' | 'decide',
    error: unknown,
  ): void {
    const issue = classifyTransportOrInput(error, operation)
    if (issue.kind === 'input'
      || (issue.kind === 'transport' && !AMBIGUOUS_TRANSPORT_CODES.has(issue.code))) {
      this.retryEnvelope = null
    }
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingSuggestedChangeId: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private notifyCommitted(receipt: WorkbenchCommandReceipt, targetChanged: boolean): void {
    try {
      this.options.onCommitted?.(Object.freeze({ ...receipt }), targetChanged)
    } catch {
      console.error('[workbench-client] Review committed observer failed')
    }
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Review transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Review admission observer failed')
      return false
    }
  }

  private cancelAll(reason: string): void {
    ++this.readEpoch
    ++this.mutationEpoch
    this.readAbort?.abort(new Error(reason))
    this.mutationAbort?.abort(new Error(reason))
    this.readAbort = null
    this.mutationAbort = null
  }

  private track(pending: Promise<void>): Promise<void> {
    this.inFlight.add(pending)
    void pending.then(
      () => { this.inFlight.delete(pending) },
      () => { this.inFlight.delete(pending) },
    )
    return pending
  }

  private publish(next: WorkbenchReviewClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Review state observer failed')
      }
    }
  }
}

function proposalDraftFrom(review: ReviewCenterProjection | null): WorkbenchReviewProposalDraft {
  const builder = review?.proposalBuilder
  if (builder === undefined) return emptyProposalDraft()
  return Object.freeze({
    basedOnTeamRevision: builder.teamRevision,
    accountableMemberId: builder.base.accountableMemberId ?? '',
    contributorMemberIds: Object.freeze([...builder.base.contributorMemberIds]),
    humanSponsorMemberId: builder.base.humanSponsorMemberId ?? '',
    evidenceAuditEventIds: Object.freeze([]),
  })
}

function decisionDraftFrom(card: SuggestedChangeProjection): WorkbenchReviewDecisionDraft {
  return Object.freeze({
    suggestedChangeId: card.suggestedChangeId,
    basedOnSuggestedChangeRevision: card.revision,
    mode: card.allowedDecisions[0] ?? 'reject',
    feedback: '',
    candidate: freezeCandidate(card.proposedDiff.after),
    riskAcknowledged: false,
  })
}

function freezeProposalDraft(value: WorkbenchReviewProposalDraft): WorkbenchReviewProposalDraft {
  return Object.freeze({
    basedOnTeamRevision: value.basedOnTeamRevision,
    accountableMemberId: value.accountableMemberId,
    contributorMemberIds: Object.freeze([...value.contributorMemberIds].sort()),
    humanSponsorMemberId: value.humanSponsorMemberId,
    evidenceAuditEventIds: Object.freeze([...value.evidenceAuditEventIds].sort()),
  })
}

function freezeDecisionDraft(value: WorkbenchReviewDecisionDraft): WorkbenchReviewDecisionDraft {
  return Object.freeze({
    suggestedChangeId: value.suggestedChangeId,
    basedOnSuggestedChangeRevision: value.basedOnSuggestedChangeRevision,
    mode: value.mode,
    feedback: value.feedback,
    candidate: freezeCandidate(value.candidate),
    riskAcknowledged: value.riskAcknowledged,
  })
}

function freezeCandidate(
  value: ProjectResponsibilitySuggestedValue,
): ProjectResponsibilitySuggestedValue {
  return Object.freeze({
    accountableMemberId: value.accountableMemberId,
    contributorMemberIds: Object.freeze([...value.contributorMemberIds].sort()),
    humanSponsorMemberId: value.humanSponsorMemberId,
  })
}

function validCandidate(
  candidate: ProjectResponsibilitySuggestedValue,
  review: ReviewCenterProjection | null,
): boolean {
  if (review === null || candidate.accountableMemberId === '') return false
  const active = new Map(review.proposalBuilder.memberOptions
    .filter(member => member.status === 'active')
    .map(member => [member.memberId, member] as const))
  const accountable = active.get(candidate.accountableMemberId)
  if (accountable === undefined
    || candidate.contributorMemberIds.length > MAX_REVIEW_CONTRIBUTORS
    || new Set(candidate.contributorMemberIds).size !== candidate.contributorMemberIds.length
    || candidate.contributorMemberIds.includes(candidate.accountableMemberId)
    || candidate.contributorMemberIds.some(memberId => !active.has(memberId))) return false
  if (candidate.humanSponsorMemberId !== null) {
    const sponsor = active.get(candidate.humanSponsorMemberId)
    if (sponsor === undefined
      || !sponsor.canBeHumanSponsor
      || sponsor.memberId === candidate.accountableMemberId) return false
  }
  return accountable.requiresHumanSponsor
    ? candidate.humanSponsorMemberId !== null
    : candidate.humanSponsorMemberId === null
}

function validEvidence(values: readonly string[]): boolean {
  return values.length >= 1
    && values.length <= MAX_REVIEW_EVIDENCE
    && new Set(values).size === values.length
}

function sameResponsibility(
  before: ProjectResponsibilityReviewValue,
  after: ProjectResponsibilitySuggestedValue,
): boolean {
  return before.accountableMemberId === after.accountableMemberId
    && before.humanSponsorMemberId === after.humanSponsorMemberId
    && JSON.stringify([...before.contributorMemberIds].sort())
      === JSON.stringify([...after.contributorMemberIds].sort())
}

function riskForCandidate(
  before: ProjectResponsibilityReviewValue,
  after: ProjectResponsibilitySuggestedValue,
): {
  readonly level: SuggestedChangeRiskLevel
  readonly reasons: readonly SuggestedChangeRiskReason[]
} {
  if (before.accountableMemberId === null) {
    return Object.freeze({
      level: 'high',
      reasons: Object.freeze(['initial-responsibility'] as const),
    })
  }
  const reasons: SuggestedChangeRiskReason[] = []
  if (before.accountableMemberId !== after.accountableMemberId) {
    reasons.push('accountable-changed')
  }
  if (before.humanSponsorMemberId !== after.humanSponsorMemberId) {
    reasons.push('human-sponsor-changed')
  }
  if (reasons.length > 0) {
    return Object.freeze({ level: 'high', reasons: Object.freeze(reasons) })
  }
  return Object.freeze({
    level: 'low',
    reasons: Object.freeze(['contributors-only'] as const),
  })
}

function fingerprintDecisionRequest(request: DecideSuggestedChangeRequest): string {
  return JSON.stringify({
    projectId: request.projectId,
    suggestedChangeId: request.suggestedChangeId,
    expectedSuggestedChangeRevision: request.expectedSuggestedChangeRevision,
    feedback: request.feedback,
    mode: request.mode,
    ...request.mode === 'accept' || request.mode === 'edit-and-accept'
      ? { acknowledgedRiskLevel: request.acknowledgedRiskLevel }
      : {},
    ...request.mode === 'edit-and-accept' ? { candidate: request.candidate } : {},
  })
}

function boundedText(value: string, maximum: number): boolean {
  const length = [...value].length
  return value.isWellFormed()
    && length >= 1
    && length <= maximum
    && !CONTROL_CHARACTER.test(value)
}

function classifyTransportOrInput(
  error: unknown,
  operation: WorkbenchReviewOperation,
): WorkbenchReviewTransportIssue | WorkbenchReviewInputIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchReviewTransportCode)
    ? candidate as WorkbenchReviewTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}

function detachReviewCenter(value: ReviewCenterProjection): ReviewCenterProjection {
  return Object.freeze({
    projectId: value.projectId,
    proposalBuilder: Object.freeze({
      projectId: value.proposalBuilder.projectId,
      teamRevision: value.proposalBuilder.teamRevision,
      responsibilityRevision: value.proposalBuilder.responsibilityRevision,
      base: detachReviewValue(value.proposalBuilder.base),
      memberOptions: Object.freeze(value.proposalBuilder.memberOptions.map(member => Object.freeze({
        memberId: member.memberId,
        displayName: member.displayName,
        kind: member.kind,
        status: member.status,
        requiresHumanSponsor: member.requiresHumanSponsor,
        canBeHumanSponsor: member.canBeHumanSponsor,
      }))),
      evidenceOptions: Object.freeze(value.proposalBuilder.evidenceOptions.map(detachEvidence)),
    }),
    items: Object.freeze(value.items.map(detachSuggestedChange)),
    nextBeforeSequence: value.nextBeforeSequence,
  })
}

function mergeReviewCenter(
  current: ReviewCenterProjection,
  incoming: ReviewCenterProjection,
): ReviewCenterProjection {
  const byId = new Map(current.items.map(item => [item.suggestedChangeId, item] as const))
  for (const item of incoming.items) byId.set(item.suggestedChangeId, item)
  return Object.freeze({
    projectId: incoming.projectId,
    proposalBuilder: incoming.proposalBuilder,
    items: Object.freeze([...byId.values()].sort((left, right) => right.sequence - left.sequence)),
    nextBeforeSequence: incoming.nextBeforeSequence,
  })
}

function sameReviewFilters(
  left: WorkbenchReviewFilters,
  right: WorkbenchReviewFilters,
): boolean {
  return left.status === right.status && left.riskLevel === right.riskLevel
}

function detachSuggestedChange(value: SuggestedChangeProjection): SuggestedChangeProjection {
  return Object.freeze({
    suggestedChangeId: value.suggestedChangeId,
    sequence: value.sequence,
    revision: value.revision,
    projectId: value.projectId,
    source: Object.freeze({ kind: 'owner', actorId: value.source.actorId }),
    target: Object.freeze({ ...value.target }),
    proposedDiff: detachDiff(value.proposedDiff),
    evidence: Object.freeze(value.evidence.map(detachEvidence)),
    risk: Object.freeze({
      proposedLevel: value.risk.proposedLevel,
      effectiveLevel: value.risk.effectiveLevel,
      proposedReasonCodes: Object.freeze([...value.risk.proposedReasonCodes]),
      policyVersion: value.risk.policyVersion,
      batchPolicy: Object.freeze({ ...value.risk.batchPolicy }),
    }),
    originCausationId: value.originCausationId,
    persistedState: value.persistedState,
    effectiveStatus: value.effectiveStatus,
    decisions: Object.freeze(value.decisions.map(detachDecision)),
    allowedDecisions: Object.freeze([...value.allowedDecisions]),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  })
}

function detachReviewValue(value: ProjectResponsibilityReviewValue): ProjectResponsibilityReviewValue {
  return Object.freeze({
    accountableMemberId: value.accountableMemberId,
    contributorMemberIds: Object.freeze([...value.contributorMemberIds]),
    humanSponsorMemberId: value.humanSponsorMemberId,
  })
}

function detachDiff(value: ProjectResponsibilityReviewDiff): ProjectResponsibilityReviewDiff {
  return Object.freeze({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    before: detachReviewValue(value.before),
    after: freezeCandidate(value.after),
    changedFields: Object.freeze([...value.changedFields]),
    digest: value.digest,
  })
}

function detachEvidence(value: SuggestedChangeEvidenceProjection): SuggestedChangeEvidenceProjection {
  return Object.freeze({
    kind: value.kind,
    auditEventId: value.auditEventId,
    occurredAt: value.occurredAt,
    action: value.action,
    summaryCode: value.summaryCode,
    object: Object.freeze({ ...value.object }),
  })
}

function detachDecision(value: SuggestedChangeDecisionProjection): SuggestedChangeDecisionProjection {
  return Object.freeze({
    decisionId: value.decisionId,
    suggestedChangeRevision: value.suggestedChangeRevision,
    mode: value.mode,
    actor: Object.freeze({ ...value.actor }),
    feedback: value.feedback,
    appliedDiff: value.appliedDiff === null ? null : detachDiff(value.appliedDiff),
    appliedRiskLevel: value.appliedRiskLevel,
    appliedRiskReasonCodes: Object.freeze([...value.appliedRiskReasonCodes]),
    appliedTeamRevision: value.appliedTeamRevision,
    appliedResponsibilityRevision: value.appliedResponsibilityRevision,
    causationId: value.causationId,
    receipt: Object.freeze({ ...value.receipt }),
    decidedAt: value.decidedAt,
  })
}
