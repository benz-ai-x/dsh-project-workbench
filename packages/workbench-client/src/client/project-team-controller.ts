/** React-free Client state machine for one opened Project's Team projection. */

import type {
  AddProjectMemberRequest,
  AddProjectMemberResult,
  ProjectMemberDraft,
  ProjectMemberProjection,
  ProjectMemberStatus,
  ProjectTeamProjection,
  ProjectTeamQuery,
  SetProjectMemberStatusRequest,
  SetProjectMemberStatusResult,
  SetProjectResponsibilityRequest,
  SetProjectResponsibilityResult,
  WorkbenchCommandReceipt,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type WorkbenchProjectTeamPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'stale'
  | 'error'
  | 'conflict'

type DomainResult =
  | AddProjectMemberResult
  | SetProjectMemberStatusResult
  | SetProjectResponsibilityResult

export type WorkbenchProjectTeamConflictCode = Extract<
  DomainResult,
  { readonly ok: false }
>['error']['code']

export type WorkbenchProjectTeamOperation =
  | 'read-team'
  | 'add-member'
  | 'member-status'
  | 'set-responsibility'

export type WorkbenchProjectTeamTransportCode =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'internal'
  | 'transport-failure'

export interface WorkbenchProjectTeamTransportIssue {
  readonly kind: 'transport'
  readonly code: WorkbenchProjectTeamTransportCode
  readonly operation: WorkbenchProjectTeamOperation
}

export interface WorkbenchProjectTeamInputIssue {
  readonly kind: 'input'
  readonly code: 'bad-request' | 'project-not-found'
  readonly operation: WorkbenchProjectTeamOperation
}

export interface WorkbenchProjectTeamConflictIssue {
  readonly kind: 'conflict'
  readonly code: WorkbenchProjectTeamConflictCode
  readonly operation: Exclude<WorkbenchProjectTeamOperation, 'read-team'>
}

export type WorkbenchProjectTeamIssue =
  | WorkbenchProjectTeamTransportIssue
  | WorkbenchProjectTeamInputIssue
  | WorkbenchProjectTeamConflictIssue

export type WorkbenchHumanIdentityDraft = 'feishu' | 'external'
export type WorkbenchExternalContactMethod = 'email' | 'phone' | 'other'

/** Complete recoverable form. Inactive fields stay local but never cross the wire. */
export interface WorkbenchProjectMemberDraft {
  readonly kind: 'human' | 'agent'
  readonly displayName: string
  readonly humanIdentity: WorkbenchHumanIdentityDraft
  readonly feishuAppId: string
  readonly feishuOpenId: string
  readonly externalMethod: WorkbenchExternalContactMethod
  readonly externalValue: string
}

/** Whole responsibility tuple edited atomically. */
export interface WorkbenchProjectResponsibilityDraft {
  readonly accountableMemberId: string
  readonly contributorMemberIds: readonly string[]
  readonly humanSponsorMemberId: string
}

export interface WorkbenchProjectSelection {
  readonly projectId: string
  readonly projectName: string
}

export interface WorkbenchProjectTeamClientState {
  readonly phase: WorkbenchProjectTeamPhase
  readonly selection: WorkbenchProjectSelection | null
  readonly team: ProjectTeamProjection | null
  readonly memberDraft: WorkbenchProjectMemberDraft
  readonly memberDraftDirty: boolean
  readonly responsibilityDraft: WorkbenchProjectResponsibilityDraft
  readonly responsibilityDraftDirty: boolean
  readonly pendingOperation: Exclude<WorkbenchProjectTeamOperation, 'read-team'> | null
  readonly pendingMemberId: string | null
  readonly issue: WorkbenchProjectTeamIssue | null
  readonly canRetryMutation: boolean
  /** Accepted member acknowledgement directs focus after the authoritative repull. */
  readonly focusMemberId: string | null
  readonly focusEpoch: number
}

/** Generated `remote.workbench` subset used by this controller. */
export interface WorkbenchProjectTeamRemote {
  projectTeam(
    query: ProjectTeamQuery,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ProjectTeamProjection | null>>
  addProjectMember(
    request: AddProjectMemberRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<AddProjectMemberResult>>
  setProjectMemberStatus(
    request: SetProjectMemberStatusRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SetProjectMemberStatusResult>>
  setProjectResponsibility(
    request: SetProjectResponsibilityRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SetProjectResponsibilityResult>>
}

export interface WorkbenchProjectTeamControllerOptions {
  readonly onBeforeProtectedOperation?: () => boolean
  readonly onTransportFailure?: () => void
  readonly onCommitted?: (receipt: WorkbenchCommandReceipt) => void
  readonly nextCommandKey?: () => string
}

type MutationEnvelope =
  | {
    readonly kind: 'add-member'
    readonly fingerprint: string
    readonly request: AddProjectMemberRequest
  }
  | {
    readonly kind: 'member-status'
    readonly fingerprint: string
    readonly request: SetProjectMemberStatusRequest
  }
  | {
    readonly kind: 'set-responsibility'
    readonly fingerprint: string
    readonly request: SetProjectResponsibilityRequest
  }

const SAFE_TRANSPORT_CODES = new Set<WorkbenchProjectTeamTransportCode>([
  'unavailable',
  'unauthorized',
  'forbidden',
  'rate-limited',
  'internal',
  'transport-failure',
])

export const MAX_PROJECT_TEAM_MEMBERS = 100
export const MAX_PROJECT_TEAM_CONTRIBUTORS = 20
export const MAX_PROJECT_MEMBER_NAME_LENGTH = 200
export const MAX_FEISHU_APP_ID_LENGTH = 128
export const MAX_FEISHU_OPEN_ID_LENGTH = 128
export const MAX_EXTERNAL_CONTACT_LENGTH = 320
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const FEISHU_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function emptyMemberDraft(): WorkbenchProjectMemberDraft {
  return Object.freeze({
    kind: 'human',
    displayName: '',
    humanIdentity: 'feishu',
    feishuAppId: '',
    feishuOpenId: '',
    externalMethod: 'email',
    externalValue: '',
  })
}

function emptyResponsibilityDraft(): WorkbenchProjectResponsibilityDraft {
  return Object.freeze({
    accountableMemberId: '',
    contributorMemberIds: Object.freeze([]),
    humanSponsorMemberId: '',
  })
}

export const INITIAL_WORKBENCH_PROJECT_TEAM_STATE: WorkbenchProjectTeamClientState = Object.freeze({
  phase: 'idle',
  selection: null,
  team: null,
  memberDraft: emptyMemberDraft(),
  memberDraftDirty: false,
  responsibilityDraft: emptyResponsibilityDraft(),
  responsibilityDraftDirty: false,
  pendingOperation: null,
  pendingMemberId: null,
  issue: null,
  canRetryMutation: false,
  focusMemberId: null,
  focusEpoch: 0,
})

/**
 * Owns one Project Team mirror, two recoverable drafts, exact mutation replay,
 * Project-switch cancellation, and the mandatory post-commit authoritative read.
 */
export class WorkbenchProjectTeamController {
  private state: WorkbenchProjectTeamClientState = INITIAL_WORKBENCH_PROJECT_TEAM_STATE
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
    private readonly remote: WorkbenchProjectTeamRemote,
    private readonly options: WorkbenchProjectTeamControllerOptions = {},
  ) {}

  readonly getSnapshot = (): WorkbenchProjectTeamClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** A different opened Project is a hard draft and request identity boundary. */
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
    this.cancelAll('Workbench Project Team switched Project')
    this.retryEnvelope = null
    this.publish({
      ...INITIAL_WORKBENCH_PROJECT_TEAM_STATE,
      phase: 'loading',
      selection: Object.freeze({ projectId: normalized, projectName }),
    })
    return this.track(this.doRefresh(false))
  }

  clearSelection(): void {
    if (this.disposed) return
    this.cancelAll('Workbench Project Team selection cleared')
    this.retryEnvelope = null
    this.publish(INITIAL_WORKBENCH_PROJECT_TEAM_STATE)
  }

  refresh(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null) return Promise.resolve()
    return this.track(this.doRefresh(false))
  }

  setMemberKind(kind: 'human' | 'agent'): void {
    this.updateMemberDraft({ ...this.state.memberDraft, kind })
  }

  setMemberDisplayName(displayName: string): void {
    this.updateMemberDraft({ ...this.state.memberDraft, displayName })
  }

  setHumanIdentity(humanIdentity: WorkbenchHumanIdentityDraft): void {
    this.updateMemberDraft({ ...this.state.memberDraft, humanIdentity })
  }

  setFeishuAppId(feishuAppId: string): void {
    this.updateMemberDraft({ ...this.state.memberDraft, feishuAppId })
  }

  setFeishuOpenId(feishuOpenId: string): void {
    this.updateMemberDraft({ ...this.state.memberDraft, feishuOpenId })
  }

  setExternalMethod(externalMethod: WorkbenchExternalContactMethod): void {
    this.updateMemberDraft({ ...this.state.memberDraft, externalMethod })
  }

  setExternalValue(externalValue: string): void {
    this.updateMemberDraft({ ...this.state.memberDraft, externalValue })
  }

  resetMemberDraft(): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    if (this.retryEnvelope?.kind === 'add-member') this.retryEnvelope = null
    this.publish({
      ...this.state,
      memberDraft: emptyMemberDraft(),
      memberDraftDirty: false,
      issue: this.state.issue?.operation === 'add-member' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  canAddMember(): boolean {
    return this.canMutate()
      && this.state.team !== null
      && this.state.team.members.length < MAX_PROJECT_TEAM_MEMBERS
      && normalizeMemberDraft(this.state.memberDraft) !== null
  }

  addMember(): Promise<void> {
    if (!this.canAddMember() || this.state.selection === null || this.state.team === null) {
      return Promise.resolve()
    }
    const fingerprint = fingerprintMemberDraft(this.state.memberDraft)
    const retained = this.retryEnvelope?.kind === 'add-member'
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const member = normalizeMemberDraft(this.state.memberDraft)
    if (member === null) return Promise.resolve()
    const envelope = retained ?? Object.freeze({
      kind: 'add-member' as const,
      fingerprint,
      request: Object.freeze({
        projectId: this.state.selection.projectId,
        member,
        expectedTeamRevision: this.state.team.teamRevision,
        expectedRevision: null,
        ...this.correlation(),
        reason: 'owner-project-member-add' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  setAccountable(memberId: string): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    const accountableMemberId = memberId.trim()
    const accountable = this.activeMember(accountableMemberId)
    const sponsorRequired = accountable !== null && requiresHumanSponsor(accountable)
    const contributorMemberIds = this.state.responsibilityDraft.contributorMemberIds
      .filter(candidate => candidate !== accountableMemberId)
    this.updateResponsibilityDraft({
      ...this.state.responsibilityDraft,
      accountableMemberId,
      contributorMemberIds,
      humanSponsorMemberId: sponsorRequired
        ? this.state.responsibilityDraft.humanSponsorMemberId
        : '',
    })
  }

  setContributor(memberId: string, selected: boolean): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    const normalized = memberId.trim()
    if (normalized === '' || normalized === this.state.responsibilityDraft.accountableMemberId) return
    const retained = this.state.responsibilityDraft.contributorMemberIds
      .filter(candidate => candidate !== normalized)
    if (selected && retained.length >= MAX_PROJECT_TEAM_CONTRIBUTORS) return
    this.updateResponsibilityDraft({
      ...this.state.responsibilityDraft,
      contributorMemberIds: selected ? [...retained, normalized].sort() : retained,
    })
  }

  setHumanSponsor(memberId: string): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    const accountable = this.activeMember(this.state.responsibilityDraft.accountableMemberId)
    if (accountable === null || !requiresHumanSponsor(accountable)) return
    this.updateResponsibilityDraft({
      ...this.state.responsibilityDraft,
      humanSponsorMemberId: memberId.trim(),
    })
  }

  resetResponsibilityDraft(): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    if (this.retryEnvelope?.kind === 'set-responsibility') this.retryEnvelope = null
    this.publish({
      ...this.state,
      responsibilityDraft: responsibilityDraftFrom(this.state.team),
      responsibilityDraftDirty: false,
      issue: this.state.issue?.operation === 'set-responsibility' ? null : this.state.issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  canSaveResponsibility(): boolean {
    return this.canMutate()
      && this.state.responsibilityDraftDirty
      && validResponsibilityDraft(this.state.responsibilityDraft, this.state.team)
  }

  saveResponsibility(): Promise<void> {
    const selection = this.state.selection
    const team = this.state.team
    if (!this.canSaveResponsibility() || selection === null || team === null) {
      return Promise.resolve()
    }
    const fingerprint = fingerprintResponsibilityDraft(this.state.responsibilityDraft)
    const retained = this.retryEnvelope?.kind === 'set-responsibility'
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const draft = this.state.responsibilityDraft
    const envelope = retained ?? Object.freeze({
      kind: 'set-responsibility' as const,
      fingerprint,
      request: Object.freeze({
        projectId: selection.projectId,
        accountableMemberId: draft.accountableMemberId,
        contributorMemberIds: Object.freeze([...draft.contributorMemberIds]),
        humanSponsorMemberId: draft.humanSponsorMemberId === ''
          ? null
          : draft.humanSponsorMemberId,
        expectedTeamRevision: team.teamRevision,
        expectedResponsibilityRevision: team.responsibility?.revision ?? null,
        ...this.correlation(),
        reason: 'owner-project-responsibility-set' as const,
      }),
    })
    this.retryEnvelope = envelope
    return this.track(this.doMutation(envelope))
  }

  changeMemberStatus(memberId: string, status: ProjectMemberStatus): Promise<void> {
    const selection = this.state.selection
    const team = this.state.team
    const member = team?.members.find(candidate => candidate.memberId === memberId)
    if (!this.canMutate() || selection === null || team === null || member === undefined
      || member.status === status) return Promise.resolve()
    const fingerprint = JSON.stringify({
      projectId: selection.projectId,
      memberId,
      status,
      expectedTeamRevision: team.teamRevision,
      expectedMemberRevision: member.revision,
    })
    const retained = this.retryEnvelope?.kind === 'member-status'
      && this.retryEnvelope.fingerprint === fingerprint
      ? this.retryEnvelope
      : null
    const envelope = retained ?? Object.freeze({
      kind: 'member-status' as const,
      fingerprint,
      request: Object.freeze({
        projectId: selection.projectId,
        memberId,
        status,
        expectedTeamRevision: team.teamRevision,
        expectedMemberRevision: member.revision,
        ...this.correlation(),
        reason: 'owner-project-member-status-change' as const,
      }),
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
    this.cancelAll('Workbench Project Team connection generation changed')
    this.publish({
      ...this.state,
      phase: this.state.selection === null ? 'idle' : 'stale',
      pendingOperation: null,
      pendingMemberId: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  /** Retain same-Project dirty drafts and replay identity while replacing Host truth. */
  connectionReset(): Promise<void> {
    if (!this.admitProtectedOperation() || this.state.selection === null) return Promise.resolve()
    this.cancelAll('Workbench Project Team connection generation changed')
    this.publish({
      ...this.state,
      phase: 'stale',
      pendingOperation: null,
      pendingMemberId: null,
      issue: null,
      canRetryMutation: this.retryEnvelope !== null,
    })
    return this.track(this.doRefresh(false))
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    this.disposed = true
    this.cancelAll('Workbench Project Team Client disposed')
    this.retryEnvelope = null
    this.state = INITIAL_WORKBENCH_PROJECT_TEAM_STATE
    this.listeners.clear()
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => undefined)
    return this.disposal
  }

  private async doRefresh(keepIssue: boolean): Promise<void> {
    const selection = this.state.selection
    if (selection === null || this.disposed) return
    const epoch = ++this.readEpoch
    this.readAbort?.abort(new Error('Workbench Project Team refresh was superseded'))
    const abort = new AbortController()
    this.readAbort = abort
    const retainedIssue = keepIssue ? this.state.issue : null
    this.publish({
      ...this.state,
      phase: this.state.team === null ? 'loading' : keepIssue ? 'conflict' : 'stale',
      issue: retainedIssue,
    })
    try {
      const result = await this.remote.projectTeam(
        Object.freeze({ projectId: selection.projectId }),
        abort.signal,
      )
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
          team: null,
          issue: Object.freeze({
            kind: 'input',
            code: 'project-not-found',
            operation: 'read-team',
          }),
        })
        return
      }
      const team = detachTeam(result.value)
      this.publish({
        ...this.state,
        phase: keepIssue && retainedIssue?.kind === 'conflict' ? 'conflict' : 'ready',
        team,
        responsibilityDraft: this.state.responsibilityDraftDirty
          ? this.state.responsibilityDraft
          : responsibilityDraftFrom(team),
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
    if (this.disposed || this.state.selection?.projectId !== envelope.request.projectId) return
    const epoch = ++this.mutationEpoch
    this.mutationAbort?.abort(new Error('Workbench Project Team mutation was superseded'))
    const abort = new AbortController()
    this.mutationAbort = abort
    this.publish({
      ...this.state,
      phase: 'pending',
      pendingOperation: envelope.kind,
      pendingMemberId: envelope.kind === 'member-status' ? envelope.request.memberId : null,
      issue: null,
      canRetryMutation: false,
      focusMemberId: null,
    })
    let result: RemoteResult<DomainResult>
    try {
      result = await this.invokeMutation(envelope, abort.signal)
    } catch (error) {
      if (!this.acceptMutation(epoch, abort, envelope.request.projectId)) return
      this.mutationAbort = null
      this.publishMutationTransportFailure(envelope.kind, error)
      return
    }
    if (!this.acceptMutation(epoch, abort, envelope.request.projectId)) return
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
        pendingMemberId: null,
        issue: Object.freeze({
          kind: 'conflict',
          code: outcome.error.code,
          operation: envelope.kind,
        }),
        canRetryMutation: false,
      })
      await this.doRefresh(true)
      return
    }

    this.retryEnvelope = null
    const focusMemberId = envelope.kind === 'add-member' && 'memberId' in outcome.value
      ? outcome.value.memberId
      : null
    if (envelope.kind === 'add-member') {
      this.publish({
        ...this.state,
        memberDraft: emptyMemberDraft(),
        memberDraftDirty: false,
        focusMemberId,
      })
    } else if (envelope.kind === 'set-responsibility') {
      this.publish({ ...this.state, responsibilityDraftDirty: false })
    }
    this.publish({
      ...this.state,
      phase: 'stale',
      pendingOperation: null,
      pendingMemberId: null,
      issue: null,
      canRetryMutation: false,
      focusMemberId,
    })
    this.notifyCommitted(outcome.receipt)
    await this.doRefresh(false)
    if (focusMemberId !== null
      && this.state.team?.members.some(member => member.memberId === focusMemberId) === true) {
      this.publish({
        ...this.state,
        focusMemberId,
        focusEpoch: this.state.focusEpoch + 1,
      })
    }
  }

  private async invokeMutation(
    envelope: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<RemoteResult<DomainResult>> {
    switch (envelope.kind) {
      case 'add-member': return await this.remote.addProjectMember(envelope.request, signal)
      case 'member-status': return await this.remote.setProjectMemberStatus(envelope.request, signal)
      case 'set-responsibility': return await this.remote.setProjectResponsibility(
        envelope.request,
        signal,
      )
    }
  }

  private updateMemberDraft(next: WorkbenchProjectMemberDraft): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    const memberDraft = freezeMemberDraft(next)
    if (this.retryEnvelope?.kind === 'add-member'
      && this.retryEnvelope.fingerprint !== fingerprintMemberDraft(memberDraft)) {
      this.retryEnvelope = null
    }
    this.publish({
      ...this.state,
      memberDraft,
      memberDraftDirty: true,
      issue: this.state.issue?.operation === 'add-member' ? null : this.state.issue,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private updateResponsibilityDraft(next: WorkbenchProjectResponsibilityDraft): void {
    if (!this.admitProtectedOperation() || this.state.pendingOperation !== null) return
    const responsibilityDraft = freezeResponsibilityDraft(next)
    if (this.retryEnvelope?.kind === 'set-responsibility'
      && this.retryEnvelope.fingerprint !== fingerprintResponsibilityDraft(responsibilityDraft)) {
      this.retryEnvelope = null
    }
    this.publish({
      ...this.state,
      responsibilityDraft,
      responsibilityDraftDirty: true,
      issue: this.state.issue?.operation === 'set-responsibility' ? null : this.state.issue,
      phase: this.state.phase === 'conflict' ? 'ready' : this.state.phase,
      canRetryMutation: this.retryEnvelope !== null,
    })
  }

  private activeMember(memberId: string): ProjectMemberProjection | null {
    return this.state.team?.members.find(member => member.memberId === memberId
      && member.status === 'active') ?? null
  }

  private correlation(): { readonly idempotencyKey: string; readonly causationId: string } {
    const next = this.options.nextCommandKey ?? (() => globalThis.crypto.randomUUID())
    return Object.freeze({ idempotencyKey: next(), causationId: next() })
  }

  private canMutate(): boolean {
    return !this.disposed
      && this.state.selection !== null
      && this.state.team !== null
      && this.state.pendingOperation === null
      && this.state.phase !== 'loading'
      && this.state.phase !== 'stale'
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
    const issue = classifyTransportOrInput(error, 'read-team')
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingMemberId: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private publishMutationTransportFailure(
    operation: Exclude<WorkbenchProjectTeamOperation, 'read-team'>,
    error: unknown,
  ): void {
    const issue = classifyTransportOrInput(error, operation)
    if (issue.kind === 'input') this.retryEnvelope = null
    this.publish({
      ...this.state,
      phase: 'error',
      pendingOperation: null,
      pendingMemberId: null,
      issue,
      canRetryMutation: this.retryEnvelope !== null,
    })
    if (issue.kind === 'transport') this.notifyTransportFailure()
  }

  private notifyCommitted(receipt: WorkbenchCommandReceipt): void {
    try {
      this.options.onCommitted?.(Object.freeze({ ...receipt }))
    } catch {
      console.error('[workbench-client] Project Team committed observer failed')
    }
  }

  private notifyTransportFailure(): void {
    try {
      this.options.onTransportFailure?.()
    } catch {
      console.error('[workbench-client] Project Team transport observer failed')
    }
  }

  private admitProtectedOperation(): boolean {
    if (this.disposed) return false
    try {
      return this.options.onBeforeProtectedOperation?.() ?? true
    } catch {
      console.error('[workbench-client] Project Team admission observer failed')
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

  private publish(next: WorkbenchProjectTeamClientState): void {
    if (this.disposed) return
    this.state = Object.freeze(next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        console.error('[workbench-client] Project Team state observer failed')
      }
    }
  }
}

function normalizeMemberDraft(draft: WorkbenchProjectMemberDraft): ProjectMemberDraft | null {
  const displayName = draft.displayName.trim()
  if (!boundedText(displayName, MAX_PROJECT_MEMBER_NAME_LENGTH)) return null
  if (draft.kind === 'agent') return Object.freeze({ kind: 'agent', displayName })
  if (draft.humanIdentity === 'feishu') {
    const appId = draft.feishuAppId.trim()
    const openId = draft.feishuOpenId.trim()
    if (!FEISHU_OPAQUE_ID.test(appId) || !FEISHU_OPAQUE_ID.test(openId)) return null
    return Object.freeze({
      kind: 'human',
      displayName,
      identity: Object.freeze({ type: 'feishu', appId, openId }),
    })
  }
  const value = draft.externalValue.trim()
  if (!boundedText(value, MAX_EXTERNAL_CONTACT_LENGTH)) return null
  return Object.freeze({
    kind: 'human',
    displayName,
    identity: Object.freeze({
      type: 'external',
      method: draft.externalMethod,
      value,
    }),
  })
}

function validResponsibilityDraft(
  draft: WorkbenchProjectResponsibilityDraft,
  team: ProjectTeamProjection | null,
): boolean {
  if (team === null || draft.accountableMemberId === '') return false
  const active = new Map(team.members
    .filter(member => member.status === 'active')
    .map(member => [member.memberId, member] as const))
  const accountable = active.get(draft.accountableMemberId)
  if (accountable === undefined
    || draft.contributorMemberIds.length > MAX_PROJECT_TEAM_CONTRIBUTORS
    || new Set(draft.contributorMemberIds).size !== draft.contributorMemberIds.length
    || draft.contributorMemberIds.includes(draft.accountableMemberId)
    || draft.contributorMemberIds.some(memberId => !active.has(memberId))) return false
  const sponsorRequired = requiresHumanSponsor(accountable)
  if (!sponsorRequired) return draft.humanSponsorMemberId === ''
  if (draft.humanSponsorMemberId === ''
    || draft.humanSponsorMemberId === draft.accountableMemberId) return false
  const sponsor = active.get(draft.humanSponsorMemberId)
  return sponsor?.kind === 'human'
}

export function requiresHumanSponsor(member: ProjectMemberProjection): boolean {
  return member.kind === 'agent'
    || (member.kind === 'human' && member.identity.type === 'external')
}

function responsibilityDraftFrom(
  team: ProjectTeamProjection | null,
): WorkbenchProjectResponsibilityDraft {
  const responsibility = team?.responsibility
  if (responsibility === null || responsibility === undefined) return emptyResponsibilityDraft()
  return Object.freeze({
    accountableMemberId: responsibility.accountableMemberId,
    contributorMemberIds: Object.freeze([...responsibility.contributorMemberIds]),
    humanSponsorMemberId: responsibility.humanSponsorMemberId ?? '',
  })
}

function freezeMemberDraft(value: WorkbenchProjectMemberDraft): WorkbenchProjectMemberDraft {
  return Object.freeze({ ...value })
}

function freezeResponsibilityDraft(
  value: WorkbenchProjectResponsibilityDraft,
): WorkbenchProjectResponsibilityDraft {
  return Object.freeze({
    accountableMemberId: value.accountableMemberId,
    contributorMemberIds: Object.freeze([...value.contributorMemberIds]),
    humanSponsorMemberId: value.humanSponsorMemberId,
  })
}

function fingerprintMemberDraft(draft: WorkbenchProjectMemberDraft): string {
  return JSON.stringify(normalizeMemberDraft(draft) ?? freezeMemberDraft(draft))
}

function fingerprintResponsibilityDraft(draft: WorkbenchProjectResponsibilityDraft): string {
  return JSON.stringify({
    accountableMemberId: draft.accountableMemberId,
    contributorMemberIds: draft.contributorMemberIds,
    humanSponsorMemberId: draft.humanSponsorMemberId,
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
  operation: WorkbenchProjectTeamOperation,
): WorkbenchProjectTeamTransportIssue | WorkbenchProjectTeamInputIssue {
  const candidate = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (candidate === 'bad-request' || candidate === 'project-not-found') {
    return Object.freeze({ kind: 'input', code: candidate, operation })
  }
  const code = typeof candidate === 'string'
    && SAFE_TRANSPORT_CODES.has(candidate as WorkbenchProjectTeamTransportCode)
    ? candidate as WorkbenchProjectTeamTransportCode
    : 'transport-failure'
  return Object.freeze({ kind: 'transport', code, operation })
}

function detachTeam(value: ProjectTeamProjection): ProjectTeamProjection {
  return Object.freeze({
    projectId: value.projectId,
    teamRevision: value.teamRevision,
    members: Object.freeze(value.members.map(detachMember)),
    responsibility: value.responsibility === null ? null : Object.freeze({
      projectId: value.responsibility.projectId,
      revision: value.responsibility.revision,
      accountableMemberId: value.responsibility.accountableMemberId,
      contributorMemberIds: Object.freeze([...value.responsibility.contributorMemberIds]),
      humanSponsorMemberId: value.responsibility.humanSponsorMemberId,
      updatedAt: value.responsibility.updatedAt,
    }),
  })
}

function detachMember(value: ProjectMemberProjection): ProjectMemberProjection {
  const common = {
    memberId: value.memberId,
    projectId: value.projectId,
    displayName: value.displayName,
    status: value.status,
    revision: value.revision,
    feishuAssigneeEligibility: value.feishuAssigneeEligibility,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } as const
  if (value.kind === 'agent') return Object.freeze({ ...common, kind: 'agent' })
  return Object.freeze({
    ...common,
    kind: 'human',
    identity: value.identity.type === 'feishu'
      ? Object.freeze({
        type: 'feishu',
        appId: value.identity.appId,
        openId: value.identity.openId,
        state: 'declared',
      })
      : Object.freeze({
        type: 'external',
        method: value.identity.method,
        value: value.identity.value,
      }),
  })
}
