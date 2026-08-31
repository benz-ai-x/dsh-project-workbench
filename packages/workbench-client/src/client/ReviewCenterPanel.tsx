/** Accessible Project-scoped proposal builder and human Review Center. */

import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeliverableAcceptanceAllowedDecision,
  DeliverableAcceptanceEffectiveStatus,
  DeliverableAcceptanceReviewItemProjection,
  ProjectResponsibilityReviewField,
  ProjectResponsibilityReviewValue,
  ProjectResponsibilitySuggestedValue,
  SuggestedChangeAllowedDecision,
  SuggestedChangeDecisionProjection,
  SuggestedChangeEffectiveStatus,
  SuggestedChangeEvidenceProjection,
  SuggestedChangeProjection,
  SuggestedChangeRiskLevel,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_REVIEW_EVIDENCE,
  MAX_REVIEW_FEEDBACK_LENGTH,
  type WorkbenchReviewClientState,
  type WorkbenchReviewController,
  type WorkbenchAcceptanceDecisionDraft,
  type WorkbenchReviewDecisionDraft,
  type WorkbenchReviewIssue,
} from './review-controller.ts'
import css from './ReviewCenterPanel.module.css'

export interface ReviewCenterPanelProps {
  readonly controller: WorkbenchReviewController
  readonly t: (key: WorkbenchKey) => string
}

type ReviewMemberOption = NonNullable<
  WorkbenchReviewClientState['review']
>['proposalBuilder']['memberOptions'][number]

const STATUS_OPTIONS: readonly SuggestedChangeEffectiveStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'deferred',
  'stale',
]

const RISK_OPTIONS: readonly SuggestedChangeRiskLevel[] = ['low', 'high']

const DECISION_OPTIONS: readonly SuggestedChangeAllowedDecision[] = [
  'accept',
  'edit-and-accept',
  'reject',
  'defer',
]

function phasePresentation(state: WorkbenchReviewClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'review.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'review.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'review.status.loading' }
    case 'ready': return { dot: 'done', key: 'review.status.ready' }
    case 'disconnected': return { dot: 'warning', key: 'review.status.disconnected' }
    case 'error': return { dot: 'error', key: 'review.status.error' }
    case 'conflict': return { dot: 'warning', key: 'review.status.conflict' }
  }
}

export function ReviewCenterPanel({ controller, t }: ReviewCenterPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const presentation = phasePresentation(state)

  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusSuggestedChangeId === null) return
    cardRefs.current.get(state.focusSuggestedChangeId)?.focus({ preventScroll: true })
  }, [state.focusEpoch, state.focusSuggestedChangeId])

  const members = state.review?.proposalBuilder.memberOptions ?? []
  const memberById = useMemo(() => new Map(
    members.map(member => [member.memberId, member] as const),
  ), [members])
  const currentEvidenceIds = useMemo(() => new Set(
    (state.review?.proposalBuilder.evidenceOptions ?? [])
      .map(evidence => evidence.auditEventId),
  ), [state.review])
  const proposalEvidenceOptions = useMemo(() => {
    const current = state.review?.proposalBuilder.evidenceOptions ?? []
    return [
      ...current,
      ...state.retainedProposalEvidence.filter(evidence =>
        !current.some(candidate => candidate.auditEventId === evidence.auditEventId)),
    ]
  }, [state.review, state.retainedProposalEvidence])
  const proposalAccountable = members.find(
    member => member.memberId === state.proposalDraft.accountableMemberId,
  )
  const proposalAccountableOptions = membersForDraft(
    members,
    [state.proposalDraft.accountableMemberId],
  )
  const proposalContributorOptions = membersForDraft(
    members,
    state.proposalDraft.contributorMemberIds,
  )
  const proposalSponsorOptions = members.filter(member =>
    (member.status === 'active'
      && member.canBeHumanSponsor
      && member.memberId !== state.proposalDraft.accountableMemberId)
    || (member.memberId === state.proposalDraft.humanSponsorMemberId
      && member.memberId !== state.proposalDraft.accountableMemberId))
  const proposalStale = state.review !== null
    && state.proposalDraft.basedOnTeamRevision !== null
    && state.proposalDraft.basedOnTeamRevision !== state.review.proposalBuilder.teamRevision

  const applyFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void controller.applyFilters()
  }
  const propose = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canPropose()) void controller.propose()
  }

  if (state.activeKind === 'deliverable-acceptance') {
    return (
      <AcceptanceReviewCenter
        state={state}
        controller={controller}
        t={t}
        presentation={presentation}
      />
    )
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-review-center-title"
      aria-busy={state.phase === 'loading' || state.pendingOperation !== null}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('review.kicker')}</p>
          <h2 id="workbench-review-center-title" className={css.title}>
            {t('review.title')}
          </h2>
          <p className={css.subtitle}>{t('review.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.selection === null ? (
        <p className={css.emptyBlock}>{t('review.selection.empty')}</p>
      ) : (
        <>
          <div className={css.projectContext}>
            <span>{t('review.project.label')}</span>
            <strong>{state.selection.projectName || state.selection.projectId}</strong>
          </div>

          <ReviewKindSwitcher state={state} controller={controller} t={t} />

          {state.phase === 'disconnected' && (
            <p className={css.disconnected} role="status">{t('review.disconnected.body')}</p>
          )}

          {state.issue !== null && (
            <ReviewIssueNotice issue={state.issue} canRetry={state.canRetryMutation} controller={controller} t={t} />
          )}

          <form className={css.filters} onSubmit={applyFilters}>
            <fieldset disabled={state.pendingOperation !== null}>
              <legend>{t('review.filters.legend')}</legend>
              <label>
                <span>{t('review.filters.status.label')}</span>
                <select
                  value={state.filters.status}
                  onChange={event => {
                    controller.setStatusFilter(event.currentTarget.value as SuggestedChangeEffectiveStatus | 'all')
                  }}
                >
                  <option value="all">{t('review.filters.status.all')}</option>
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{t(statusKey(status))}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('review.filters.risk.label')}</span>
                <select
                  value={state.filters.riskLevel}
                  onChange={event => {
                    controller.setRiskFilter(event.currentTarget.value as SuggestedChangeRiskLevel | 'all')
                  }}
                >
                  <option value="all">{t('review.filters.risk.all')}</option>
                  {RISK_OPTIONS.map(risk => (
                    <option key={risk} value={risk}>{t(riskKey(risk))}</option>
                  ))}
                </select>
              </label>
              <Button variant="outline" size="sm" type="submit">
                {t('review.filters.apply')}
              </Button>
            </fieldset>
          </form>
          {state.filtersDirty && (
            <p className={css.hint} role="status">{t('review.filters.unapplied')}</p>
          )}

          {state.review === null ? (
            <p className={css.loading} role="status">
              {state.phase === 'loading' ? t('review.loading') : t('review.unavailable')}
            </p>
          ) : (
            <>
              <details className={css.proposal} open>
                <summary>{t('review.proposal.title')}</summary>
                <div className={css.proposalBody}>
                  <p>{t('review.proposal.body')}</p>
                  <dl className={css.baseMeta}>
                    <div>
                      <dt>{t('review.proposal.teamRevision')}</dt>
                      <dd>{state.review.proposalBuilder.teamRevision}</dd>
                    </div>
                    <div>
                      <dt>{t('review.proposal.responsibilityRevision')}</dt>
                      <dd>{state.review.proposalBuilder.responsibilityRevision ?? t('review.value.none')}</dd>
                    </div>
                  </dl>

                  {proposalStale && (
                    <div className={css.conflictNotice} role="alert">
                      <p>{t('review.proposal.baseChanged')}</p>
                      <Button variant="outline" size="sm" type="button" onClick={() => {
                        controller.adoptLatestProposalBase()
                      }}>
                        {t('review.proposal.adoptLatest')}
                      </Button>
                    </div>
                  )}

                  <form onSubmit={propose}>
                    <fieldset className={css.formFieldset} disabled={state.pendingOperation !== null}>
                      <legend>{t('review.proposal.legend')}</legend>
                      <label className={css.field}>
                        <span>{t('review.proposal.accountable')}</span>
                        <select
                          value={state.proposalDraft.accountableMemberId}
                          required
                          onChange={event => { controller.setProposalAccountable(event.currentTarget.value) }}
                        >
                          <option value="">{t('review.member.choose')}</option>
                          {proposalAccountableOptions.map(member => (
                            <option
                              key={member.memberId}
                              value={member.memberId}
                              disabled={member.status !== 'active'}
                            >
                              {memberOptionLabel(member, t)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {proposalAccountable?.requiresHumanSponsor === true && (
                        <p className={css.sponsorHint} role="status">
                          {t(proposalAccountable.kind === 'agent'
                            ? 'review.sponsor.required.agent'
                            : 'review.sponsor.required.external')}
                        </p>
                      )}

                      <fieldset className={css.choiceFieldset}>
                        <legend>{t('review.proposal.contributors')}</legend>
                        <div className={css.choices}>
                          {proposalContributorOptions.map(member => {
                            const checked = state.proposalDraft.contributorMemberIds
                              .includes(member.memberId)
                            return (
                              <label key={member.memberId}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={member.memberId === state.proposalDraft.accountableMemberId
                                    || (member.status !== 'active' && !checked)}
                                  onChange={event => {
                                    controller.setProposalContributor(member.memberId, event.currentTarget.checked)
                                  }}
                                />
                                <span>{memberDisplayLabel(member, t)}</span>
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>

                      <label className={css.field}>
                        <span>{t('review.proposal.sponsor')}</span>
                        <select
                          value={state.proposalDraft.humanSponsorMemberId}
                          disabled={proposalAccountable?.requiresHumanSponsor !== true}
                          required={proposalAccountable?.requiresHumanSponsor === true}
                          onChange={event => { controller.setProposalHumanSponsor(event.currentTarget.value) }}
                        >
                          <option value="">{t('review.value.none')}</option>
                          {proposalSponsorOptions.map(member => (
                            <option
                              key={member.memberId}
                              value={member.memberId}
                              disabled={member.status !== 'active'}
                            >
                              {memberDisplayLabel(member, t)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <fieldset className={css.choiceFieldset}>
                        <legend>{t('review.proposal.evidence')}</legend>
                        <p className={css.hint}>{t('review.proposal.evidenceHint')}</p>
                        <div className={css.evidenceChoices}>
                          {proposalEvidenceOptions.length === 0 ? (
                            <p>{t('review.proposal.noEvidence')}</p>
                          ) : proposalEvidenceOptions.map(evidence => (
                            <label key={evidence.auditEventId}>
                              <input
                                type="checkbox"
                                checked={state.proposalDraft.evidenceAuditEventIds
                                  .includes(evidence.auditEventId)}
                                disabled={!state.proposalDraft.evidenceAuditEventIds
                                  .includes(evidence.auditEventId)
                                  && state.proposalDraft.evidenceAuditEventIds.length >= MAX_REVIEW_EVIDENCE}
                                onChange={event => {
                                  controller.setProposalEvidence(
                                    evidence.auditEventId,
                                    event.currentTarget.checked,
                                  )
                                }}
                              />
                              <span>
                                <strong>{t(evidenceSummaryKey(evidence.summaryCode))}</strong>
                                <small>{readableTimestamp(evidence.occurredAt)} · {evidence.object.type}</small>
                                <code>{evidence.auditEventId}</code>
                                {!currentEvidenceIds.has(evidence.auditEventId) && (
                                  <small>{t('review.proposal.evidenceRetained')}</small>
                                )}
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      <div className={css.formActions}>
                        <Button variant="outline" type="button" onClick={() => {
                          controller.resetProposalDraft()
                        }}>
                          {t('review.proposal.reset')}
                        </Button>
                        <Button variant="primary" type="submit" disabled={!controller.canPropose()}>
                          {state.pendingOperation === 'propose'
                            ? t('review.proposal.pending')
                            : t('review.proposal.submit')}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                </div>
              </details>

              <div className={css.listHeader}>
                <div>
                  <h3>{t('review.list.title')}</h3>
                  <p>{t('review.list.body')}</p>
                </div>
                <span>{state.review.items.length} {t('review.list.count')}</span>
              </div>

              {state.review.items.length === 0 ? (
                <div className={css.emptyBlock}>
                  <strong>{t('review.empty.title')}</strong>
                  <p>{t('review.empty.body')}</p>
                </div>
              ) : (
                <ol className={css.cards}>
                  {state.review.items.map(card => (
                    <li key={card.suggestedChangeId}>
                      <ReviewCard
                        card={card}
                        state={state}
                        controller={controller}
                        memberById={memberById}
                        members={members}
                        t={t}
                        setRef={node => {
                          if (node === null) cardRefs.current.delete(card.suggestedChangeId)
                          else cardRefs.current.set(card.suggestedChangeId, node)
                        }}
                      />
                    </li>
                  ))}
                </ol>
              )}

              {state.review.nextBeforeSequence !== null && (
                <div className={css.loadMore}>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={state.loadingMore
                      || state.phase === 'loading'
                      || state.pendingOperation !== null
                      || state.filtersDirty}
                    onClick={() => { void controller.loadMore() }}
                  >
                    {state.loadingMore ? t('review.loadingMore') : t('review.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function ReviewKindSwitcher({
  state,
  controller,
  t,
}: {
  readonly state: WorkbenchReviewClientState
  readonly controller: WorkbenchReviewController
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <nav className={css.kindSwitcher} aria-label={t('review.kind.legend')}>
      <Button
        variant={state.activeKind === 'suggested-change' ? 'primary' : 'outline'}
        size="sm"
        type="button"
        aria-pressed={state.activeKind === 'suggested-change'}
        disabled={state.pendingOperation !== null}
        onClick={() => { void controller.setReviewKind('suggested-change') }}
      >
        {t('review.kind.suggested')}
      </Button>
      <Button
        variant={state.activeKind === 'deliverable-acceptance' ? 'primary' : 'outline'}
        size="sm"
        type="button"
        aria-pressed={state.activeKind === 'deliverable-acceptance'}
        disabled={state.pendingOperation !== null}
        onClick={() => { void controller.setReviewKind('deliverable-acceptance') }}
      >
        {t('review.kind.acceptance')}
      </Button>
    </nav>
  )
}

const ACCEPTANCE_STATUSES: readonly DeliverableAcceptanceEffectiveStatus[] = [
  'pending', 'approved', 'rejected', 'needs_changes', 'stale',
]

function AcceptanceReviewCenter({
  state,
  controller,
  t,
  presentation,
}: {
  readonly state: WorkbenchReviewClientState
  readonly controller: WorkbenchReviewController
  readonly t: (key: WorkbenchKey) => string
  readonly presentation: { readonly dot: StateDotState; readonly key: WorkbenchKey }
}) {
  const itemRefs = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (state.acceptanceFocusEpoch === 0 || state.focusAcceptanceRequestId === null) return
    itemRefs.current.get(state.focusAcceptanceRequestId)?.focus({ preventScroll: true })
  }, [state.acceptanceFocusEpoch, state.focusAcceptanceRequestId])
  const applyFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void controller.applyAcceptanceFilters()
  }
  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-review-center-title"
      aria-busy={state.phase === 'loading' || state.pendingOperation !== null}
      data-review-kind="deliverable-acceptance"
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('review.kicker')}</p>
          <h2 id="workbench-review-center-title" className={css.title}>{t('review.title')}</h2>
          <p className={css.subtitle}>{t('review.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>
      {state.selection === null ? (
        <p className={css.emptyBlock}>{t('review.selection.empty')}</p>
      ) : (
        <>
          <div className={css.projectContext}>
            <span>{t('review.project.label')}</span>
            <strong>{state.selection.projectName || state.selection.projectId}</strong>
          </div>
          <ReviewKindSwitcher state={state} controller={controller} t={t} />

          {state.issue !== null && (
            <div className={state.issue.kind === 'conflict' ? css.conflictNotice : css.errorNotice} role="alert">
              <div>
                <strong>{t(state.issue.kind === 'conflict' ? 'review.conflict.title' : 'review.error.title')}</strong>
                <p><code>{state.issue.code}</code></p>
              </div>
              <div className={css.issueActions}>
                {state.canRetryMutation && (
                  <Button variant="outline" size="sm" type="button" onClick={() => {
                    void controller.retryMutation()
                  }}>{t('review.retryExact')}</Button>
                )}
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  void controller.refresh()
                }}>{t('review.refresh')}</Button>
              </div>
            </div>
          )}

          <form className={css.filters} onSubmit={applyFilters}>
            <fieldset disabled={state.pendingOperation !== null}>
              <legend>{t('review.acceptance.filters.legend')}</legend>
              <label>
                <span>{t('review.acceptance.filters.status')}</span>
                <select
                  value={state.acceptanceFilters.status}
                  onChange={event => {
                    controller.setAcceptanceStatusFilter(
                      event.currentTarget.value as DeliverableAcceptanceEffectiveStatus | 'all',
                    )
                  }}
                >
                  <option value="all">{t('review.acceptance.filters.all')}</option>
                  {ACCEPTANCE_STATUSES.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <Button variant="outline" size="sm" type="submit">
                {t('review.acceptance.filters.apply')}
              </Button>
            </fieldset>
          </form>

          {state.acceptanceReview === null ? (
            <p className={css.loading} role="status">
              {state.phase === 'loading' ? t('review.loading') : t('review.unavailable')}
            </p>
          ) : state.acceptanceReview.items.length === 0 ? (
            <p className={css.emptyBlock}>{t('review.acceptance.empty')}</p>
          ) : (
            <ol className={css.acceptanceList}>
              {state.acceptanceReview.items.map(item => (
                <li key={item.request.acceptanceRequestId}>
                  <AcceptanceReviewCard
                    item={item}
                    state={state}
                    controller={controller}
                    t={t}
                    setRef={node => {
                      if (node === null) itemRefs.current.delete(item.request.acceptanceRequestId)
                      else itemRefs.current.set(item.request.acceptanceRequestId, node)
                    }}
                  />
                </li>
              ))}
            </ol>
          )}
          {state.acceptanceReview?.nextBeforeSequence !== null
            && state.acceptanceReview !== null && (
            <div className={css.loadMore}>
              <Button
                variant="outline"
                type="button"
                disabled={state.loadingMore || state.acceptanceFiltersDirty
                  || state.pendingOperation !== null}
                onClick={() => { void controller.loadMoreAcceptance() }}
              >
                {state.loadingMore
                  ? t('review.acceptance.loadingMore')
                  : t('review.acceptance.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AcceptanceReviewCard({
  item,
  state,
  controller,
  t,
  setRef,
}: {
  readonly item: DeliverableAcceptanceReviewItemProjection
  readonly state: WorkbenchReviewClientState
  readonly controller: WorkbenchReviewController
  readonly t: (key: WorkbenchKey) => string
  readonly setRef: (node: HTMLElement | null) => void
}) {
  const request = item.request
  const draft: WorkbenchAcceptanceDecisionDraft = state.acceptanceDecisionDrafts[
    request.acceptanceRequestId
  ] ?? Object.freeze({
    acceptanceRequestId: request.acceptanceRequestId,
    basedOnAcceptanceRequestRevision: request.revision,
    mode: request.allowedDecisions[0] ?? 'reject',
    criteria: Object.freeze({}),
    feedback: '',
  })
  const decide = (mode: DeliverableAcceptanceAllowedDecision): void => {
    controller.setAcceptanceDecisionMode(request.acceptanceRequestId, mode)
    void controller.decideAcceptance(request.acceptanceRequestId)
  }
  const pending = state.pendingAcceptanceRequestId === request.acceptanceRequestId
  return (
    <article
      className={css.acceptanceCard}
      aria-label={`${item.deliverableName} — ${t('review.acceptance.frozen')}`}
      data-review-kind="deliverable-acceptance"
      data-acceptance-request-id={request.acceptanceRequestId}
      tabIndex={-1}
      ref={setRef}
    >
      <header className={css.cardHeader}>
        <div>
          <p className={css.cardKicker}>{t('review.acceptance.frozen')}</p>
          <h3>{item.deliverableName}</h3>
          <code>{request.acceptanceRequestId}</code>
        </div>
        <div className={css.badges}>
          <span>{request.effectiveStatus}</span>
          <span>{item.currentState}</span>
        </div>
      </header>

      <div className={css.acceptanceTruthGrid}>
        <section>
          <h4>{t('review.acceptance.frozen')}</h4>
          <dl className={css.cardMeta}>
            <div><dt>Plan Snapshot</dt><dd><code>{request.plan.planSnapshotId}</code></dd></div>
            <div><dt>{t('deliverables.role.accountable')}</dt><dd>{request.plan.responsibility.accountable.displayName}</dd></div>
            <div><dt>{t('deliverables.role.acceptor')}</dt><dd>{request.plan.responsibility.acceptor.displayName}</dd></div>
            <div><dt>Event observation</dt><dd><code>{request.calendar.remoteObservationVersion}</code></dd></div>
          </dl>
          <h5>{t('review.acceptance.candidates')}</h5>
          <ul className={css.acceptanceVersions}>
            {request.candidateVersions.map(version => (
              <li key={version.referenceDigest}>
                <strong>{version.displayName}</strong>
                <span>{t('deliverables.artifact.declared')}</span>
                <code>{version.source}:{version.resourceId}@{version.versionId}</code>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>{t('review.acceptance.current')}</h4>
          <p>{scheduleLabel(item.currentCalendar.schedule)} · {item.currentCalendar.remoteStatus} · {item.currentCalendar.syncState}</p>
          <ul>{item.currentTasks.map(task => (
            <li key={task.taskGuid}>
              {task.task === null ? <code>{task.taskGuid}</code> : (
                <a href={task.task.canonicalUrl} target="_blank" rel="noreferrer">{task.task.summary}</a>
              )} — {task.availability}
            </li>
          ))}</ul>
        </section>
      </div>

      {request.decision !== null && (
        <section className={css.recordedDecision}>
          <h4>{request.decision.outcome}</h4>
          <dl className={css.cardMeta}>
            <div><dt>{t('deliverables.acceptance.designated')}</dt><dd>{request.decision.designatedAcceptor.displayName}</dd></div>
            <div><dt>{t('deliverables.acceptance.recordedBy')}</dt><dd>Owner · <code>{request.decision.actor.id}</code></dd></div>
          </dl>
          <p>{request.decision.feedback}</p>
          <ul>{request.decision.criteria.map(result => (
            <li key={result.criterionId}>
              {request.plan.criteria.find(criterion =>
                criterion.criterionId === result.criterionId)?.statement ?? result.criterionId}
              {' — '}<strong>{result.outcome}</strong>
            </li>
          ))}</ul>
        </section>
      )}

      {request.allowedDecisions.length > 0 && (
        <form
          className={css.acceptanceDecision}
          aria-label={t('review.acceptance.decision.legend')}
          onSubmit={event => { event.preventDefault() }}
        >
          <fieldset disabled={state.pendingOperation !== null}>
            <legend>{t('review.acceptance.decision.legend')}</legend>
            <p className={css.sponsorHint}>{t('review.acceptance.decision.actor')}</p>
            <p className={css.hint}>{t('review.acceptance.decision.hint')}</p>
            {request.plan.criteria.map(criterion => (
              <fieldset
                className={css.acceptanceCriterion}
                aria-label={criterion.statement}
                key={criterion.criterionId}
              >
                <legend>{criterion.statement}</legend>
                <label>
                  <input
                    type="radio"
                    name={`${request.acceptanceRequestId}-${criterion.criterionId}`}
                    checked={draft.criteria[criterion.criterionId] === 'met'}
                    onChange={() => {
                      controller.setAcceptanceCriterionOutcome(
                        request.acceptanceRequestId, criterion.criterionId, 'met',
                      )
                    }}
                  />
                  <span>{t('review.acceptance.decision.met')}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`${request.acceptanceRequestId}-${criterion.criterionId}`}
                    checked={draft.criteria[criterion.criterionId] === 'not-met'}
                    onChange={() => {
                      controller.setAcceptanceCriterionOutcome(
                        request.acceptanceRequestId, criterion.criterionId, 'not-met',
                      )
                    }}
                  />
                  <span>{t('review.acceptance.decision.notMet')}</span>
                </label>
              </fieldset>
            ))}
            <label className={css.field}>
              <span>{t('review.acceptance.decision.feedback')}</span>
              <textarea
                rows={4}
                maxLength={MAX_REVIEW_FEEDBACK_LENGTH}
                required
                value={draft.feedback}
                onChange={event => {
                  controller.setAcceptanceFeedback(
                    request.acceptanceRequestId, event.currentTarget.value,
                  )
                }}
              />
            </label>
            <div className={css.modeButtons}>
              <Button
                variant={draft.mode === 'approve' ? 'primary' : 'outline'}
                type="button"
                aria-pressed={draft.mode === 'approve'}
                disabled={pending || !controller.canDecideAcceptanceAs(
                  request.acceptanceRequestId, 'approve',
                )}
                onClick={() => { decide('approve') }}
              >{t('review.acceptance.decision.approve')}</Button>
              <Button
                variant={draft.mode === 'reject' ? 'primary' : 'outline'}
                type="button"
                aria-pressed={draft.mode === 'reject'}
                disabled={pending || !controller.canDecideAcceptanceAs(
                  request.acceptanceRequestId, 'reject',
                )}
                onClick={() => { decide('reject') }}
              >{t('review.acceptance.decision.reject')}</Button>
              <Button
                variant={draft.mode === 'request-changes' ? 'primary' : 'outline'}
                type="button"
                aria-pressed={draft.mode === 'request-changes'}
                disabled={pending || !controller.canDecideAcceptanceAs(
                  request.acceptanceRequestId, 'request-changes',
                )}
                onClick={() => { decide('request-changes') }}
              >{t('review.acceptance.decision.changes')}</Button>
              <Button variant="outline" type="button" onClick={() => {
                controller.resetAcceptanceDecisionDraft(request.acceptanceRequestId)
              }}>{t('review.acceptance.decision.reset')}</Button>
            </div>
          </fieldset>
        </form>
      )}
    </article>
  )
}

function scheduleLabel(
  schedule: DeliverableAcceptanceReviewItemProjection['currentCalendar']['schedule'],
): string {
  return schedule.kind === 'all-day'
    ? `${schedule.startDate} – ${schedule.endDate}`
    : `${schedule.startAt} – ${schedule.endAt} (${schedule.timeZone})`
}

function ReviewIssueNotice({
  issue,
  canRetry,
  controller,
  t,
}: {
  readonly issue: WorkbenchReviewIssue
  readonly canRetry: boolean
  readonly controller: WorkbenchReviewController
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <div className={issue.kind === 'conflict' ? css.conflictNotice : css.errorNotice} role="alert">
      <div>
        <strong>{t(issue.kind === 'conflict' ? 'review.conflict.title' : 'review.error.title')}</strong>
        <p>{t(issueMessageKey(issue))}</p>
      </div>
      <div className={css.issueActions}>
        {canRetry && (
          <Button variant="outline" size="sm" type="button" onClick={() => {
            void controller.retryMutation()
          }}>
            {t('review.retryExact')}
          </Button>
        )}
        <Button variant="outline" size="sm" type="button" onClick={() => {
          void controller.refresh()
        }}>
          {t('review.refresh')}
        </Button>
      </div>
    </div>
  )
}

function ReviewCard({
  card,
  state,
  controller,
  memberById,
  members,
  t,
  setRef,
}: {
  readonly card: SuggestedChangeProjection
  readonly state: WorkbenchReviewClientState
  readonly controller: WorkbenchReviewController
  readonly memberById: ReadonlyMap<string, ReviewMemberOption>
  readonly members: readonly ReviewMemberOption[]
  readonly t: (key: WorkbenchKey) => string
  readonly setRef: (node: HTMLElement | null) => void
}) {
  const headingId = `workbench-review-card-${safeId(card.suggestedChangeId)}`
  const feedbackId = `${headingId}-feedback`
  const pending = state.pendingOperation === 'decide'
    && state.pendingSuggestedChangeId === card.suggestedChangeId
  const draft = state.decisionDrafts[card.suggestedChangeId] ?? defaultDecisionDraft(card)
  const riskPreview = controller.decisionRiskPreview(card.suggestedChangeId)
  const riskLevel = riskPreview?.effectiveLevel ?? null
  const draftRevisionChanged = draft.basedOnSuggestedChangeRevision !== card.revision
  const accepting = draft.mode === 'accept' || draft.mode === 'edit-and-accept'
  const highRiskConfirmation = accepting && riskLevel === 'high'
  const decisionAccountable = members.find(
    member => member.memberId === draft.candidate.accountableMemberId,
  )
  const decisionAccountableOptions = membersForDraft(
    members,
    [draft.candidate.accountableMemberId],
  )
  const decisionContributorOptions = membersForDraft(
    members,
    draft.candidate.contributorMemberIds,
  )
  const decisionSponsorOptions = members.filter(member =>
    (member.status === 'active'
      && member.canBeHumanSponsor
      && member.memberId !== draft.candidate.accountableMemberId)
    || (member.memberId === draft.candidate.humanSponsorMemberId
      && member.memberId !== draft.candidate.accountableMemberId))
  const decide = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canDecide(card.suggestedChangeId)) void controller.decide(card.suggestedChangeId)
  }

  return (
    <article
      ref={setRef}
      className={css.card}
      aria-labelledby={headingId}
      aria-busy={pending}
      tabIndex={-1}
    >
      <header className={css.cardHeader}>
        <div>
          <p className={css.cardKicker}>{t('review.card.kicker')}</p>
          <h4 id={headingId}>{t('review.card.heading')} #{card.sequence}</h4>
          <p>
            {t('review.card.proposedBy')} {card.source.actorId} ·{' '}
            <time dateTime={card.createdAt}>{readableTimestamp(card.createdAt)}</time>
          </p>
        </div>
        <div className={css.badges} aria-label={t('review.card.classification')}>
          <span>{t(statusKey(card.effectiveStatus))}</span>
          <span>{t(riskKey(card.risk.effectiveLevel))}</span>
        </div>
      </header>

      {card.effectiveStatus === 'stale' && (
        <p className={css.itemStale} role="status">{t('review.card.stale')}</p>
      )}

      <dl className={css.cardMeta}>
        <div>
          <dt>{t('review.card.baseTeamRevision')}</dt>
          <dd>{card.target.baseTeamRevision}</dd>
        </div>
        <div>
          <dt>{t('review.card.currentTeamRevision')}</dt>
          <dd>{card.target.currentTeamRevision}</dd>
        </div>
        <div>
          <dt>{t('review.card.reviewRevision')}</dt>
          <dd>{card.revision}</dd>
        </div>
        <div>
          <dt>{t('review.card.batchPolicy')}</dt>
          <dd>{t(batchPolicyKey(card.risk.batchPolicy))}</dd>
        </div>
      </dl>

      <section className={css.diffSection} aria-labelledby={`${headingId}-diff`}>
        <h5 id={`${headingId}-diff`}>{t('review.diff.title')}</h5>
        <div className={css.tableWrap}>
          <table>
            <caption>{t('review.diff.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('review.diff.field')}</th>
                <th scope="col">{t('review.diff.before')}</th>
                <th scope="col">{t('review.diff.after')}</th>
              </tr>
            </thead>
            <tbody>
              {card.proposedDiff.changedFields.map(field => (
                <tr key={field}>
                  <th scope="row">{t(diffFieldKey(field))}</th>
                  <td data-label={t('review.diff.before')}>
                    {diffValue(field, card.proposedDiff.before, memberById, t)}
                  </td>
                  <td data-label={t('review.diff.after')}>
                    {diffValue(field, card.proposedDiff.after, memberById, t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={css.changedFields}>
          {t('review.diff.changedFields')}{' '}
          {card.proposedDiff.changedFields.map(field => t(diffFieldKey(field))).join('、')}
        </p>
        <p className={css.digest}>{t('review.diff.digest')} <code>{card.proposedDiff.digest}</code></p>
      </section>

      <section className={css.evidence} aria-labelledby={`${headingId}-evidence`}>
        <h5 id={`${headingId}-evidence`}>{t('review.evidence.title')}</h5>
        <ul>
          {card.evidence.map(evidence => (
            <li key={evidence.auditEventId}>
              <strong>{t(evidenceSummaryKey(evidence.summaryCode))}</strong>
              <span>{readableTimestamp(evidence.occurredAt)}</span>
              <code>{evidence.auditEventId}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.risk} aria-labelledby={`${headingId}-risk`}>
        <h5 id={`${headingId}-risk`}>{t('review.risk.title')}</h5>
        <p>{t(riskKey(card.risk.proposedLevel))} · {card.risk.policyVersion}</p>
        <ul>
          {card.risk.proposedReasonCodes.map(reason => (
            <li key={reason}>{t(riskReasonKey(reason))}</li>
          ))}
        </ul>
      </section>

      <section className={css.history} aria-labelledby={`${headingId}-history`}>
        <h5 id={`${headingId}-history`}>{t('review.history.title')}</h5>
        {card.decisions.length === 0 ? (
          <p>{t('review.history.empty')}</p>
        ) : (
          <ol>
            {card.decisions.map(decision => (
              <DecisionHistory
                key={decision.decisionId}
                decision={decision}
                memberById={memberById}
                t={t}
              />
            ))}
          </ol>
        )}
      </section>

      {card.allowedDecisions.length > 0 && (
        <form className={css.decisionForm} onSubmit={decide}>
          <fieldset disabled={pending || state.pendingOperation !== null}>
            <legend>{t('review.decision.legend')}</legend>

            {draftRevisionChanged && (
              <div className={css.conflictNotice} role="alert">
                <p>{t('review.decision.revisionChanged')}</p>
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  controller.adoptLatestDecisionRevision(card.suggestedChangeId)
                }}>
                  {t('review.decision.adoptLatest')}
                </Button>
              </div>
            )}

            <div className={css.modeButtons} role="group" aria-label={t('review.decision.mode')}>
              {DECISION_OPTIONS.map(mode => {
                const allowed = card.allowedDecisions.includes(mode)
                return (
                  <Button
                    key={mode}
                    variant={draft.mode === mode ? 'primary' : 'outline'}
                    size="sm"
                    type="button"
                    aria-pressed={draft.mode === mode}
                    disabled={!allowed || pending}
                    onClick={() => { controller.setDecisionMode(card.suggestedChangeId, mode) }}
                  >
                    {t(decisionActionKey(mode))}
                  </Button>
                )
              })}
            </div>

            {draft.mode === 'edit-and-accept' && (
              <div className={css.editCandidate}>
                <label className={css.field}>
                  <span>{t('review.decision.edit.accountable')}</span>
                  <select
                    value={draft.candidate.accountableMemberId}
                    required
                    onChange={event => {
                      controller.setDecisionAccountable(
                        card.suggestedChangeId,
                        event.currentTarget.value,
                      )
                    }}
                  >
                    <option value="">{t('review.member.choose')}</option>
                    {decisionAccountableOptions.map(member => (
                      <option
                        key={member.memberId}
                        value={member.memberId}
                        disabled={member.status !== 'active'}
                      >
                        {memberOptionLabel(member, t)}
                      </option>
                    ))}
                  </select>
                </label>
                {decisionAccountable?.requiresHumanSponsor === true && (
                  <p className={css.sponsorHint} role="status">
                    {t(decisionAccountable.kind === 'agent'
                      ? 'review.sponsor.required.agent'
                      : 'review.sponsor.required.external')}
                  </p>
                )}
                <fieldset className={css.choiceFieldset}>
                  <legend>{t('review.decision.edit.contributors')}</legend>
                  <div className={css.choices}>
                    {decisionContributorOptions.map(member => {
                      const checked = draft.candidate.contributorMemberIds
                        .includes(member.memberId)
                      return (
                        <label key={member.memberId}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={member.memberId === draft.candidate.accountableMemberId
                              || (member.status !== 'active' && !checked)}
                            onChange={event => {
                              controller.setDecisionContributor(
                                card.suggestedChangeId,
                                member.memberId,
                                event.currentTarget.checked,
                              )
                            }}
                          />
                          <span>{memberDisplayLabel(member, t)}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <label className={css.field}>
                  <span>{t('review.decision.edit.sponsor')}</span>
                  <select
                    value={draft.candidate.humanSponsorMemberId ?? ''}
                    disabled={decisionAccountable?.requiresHumanSponsor !== true}
                    required={decisionAccountable?.requiresHumanSponsor === true}
                    onChange={event => {
                      controller.setDecisionHumanSponsor(
                        card.suggestedChangeId,
                        event.currentTarget.value,
                      )
                    }}
                  >
                    <option value="">{t('review.value.none')}</option>
                    {decisionSponsorOptions.map(member => (
                      <option
                        key={member.memberId}
                        value={member.memberId}
                        disabled={member.status !== 'active'}
                      >
                        {memberDisplayLabel(member, t)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {accepting && riskPreview !== null && (
              <div className={css.risk} role="status">
                <p>
                  <strong>{t('review.decision.effectiveRisk')}</strong>{' '}
                  {t(riskKey(riskPreview.effectiveLevel))}
                </p>
                {riskPreview.appliedLevel !== null && (
                  <>
                    <p>
                      <strong>{t('review.decision.appliedRisk')}</strong>{' '}
                      {t(riskKey(riskPreview.appliedLevel))}
                    </p>
                    <ul>
                      {riskPreview.appliedReasonCodes.map(reason => (
                        <li key={reason}>{t(riskReasonKey(reason))}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <label className={css.feedback} htmlFor={feedbackId}>
              <span>{t('review.decision.feedback')}</span>
              <textarea
                id={feedbackId}
                value={draft.feedback}
                maxLength={MAX_REVIEW_FEEDBACK_LENGTH}
                required
                aria-describedby={`${feedbackId}-hint`}
                onChange={event => {
                  controller.setDecisionFeedback(card.suggestedChangeId, event.currentTarget.value)
                }}
              />
            </label>
            <p id={`${feedbackId}-hint`} className={css.hint}>{t('review.decision.feedbackHint')}</p>

            {highRiskConfirmation && (
              <label className={css.highRiskConfirm}>
                <input
                  type="checkbox"
                  checked={draft.riskAcknowledged}
                  onChange={event => {
                    controller.setDecisionRiskAcknowledged(
                      card.suggestedChangeId,
                      event.currentTarget.checked,
                    )
                  }}
                />
                <span>{t('review.decision.highRiskConfirm')}</span>
              </label>
            )}

            <div className={css.formActions}>
              <Button variant="outline" type="button" onClick={() => {
                controller.resetDecisionDraft(card.suggestedChangeId)
              }}>
                {t('review.decision.reset')}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={!controller.canDecide(card.suggestedChangeId)}
              >
                {pending ? t('review.decision.pending') : t('review.decision.submit')}
              </Button>
            </div>
          </fieldset>
        </form>
      )}

      {card.allowedDecisions.length === 0 && (
        <p className={css.terminal}>{t('review.decision.terminal')}</p>
      )}
    </article>
  )
}

function DecisionHistory({
  decision,
  memberById,
  t,
}: {
  readonly decision: SuggestedChangeDecisionProjection
  readonly memberById: ReadonlyMap<string, ReviewMemberOption>
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <li>
      <div>
        <strong>{t(decisionModeKey(decision.mode))}</strong>
        <time dateTime={decision.decidedAt}>{readableTimestamp(decision.decidedAt)}</time>
      </div>
      <p>{decision.feedback}</p>
      {decision.appliedDiff !== null && (
        <div>
          {decision.appliedRiskLevel !== null && (
            <p>
              <strong>{t('review.history.appliedRisk')}</strong>{' '}
              {t(riskKey(decision.appliedRiskLevel))}
            </p>
          )}
          {decision.appliedRiskReasonCodes.length > 0 && (
            <ul>
              {decision.appliedRiskReasonCodes.map(reason => (
                <li key={reason}>{t(riskReasonKey(reason))}</li>
              ))}
            </ul>
          )}
          <div className={css.tableWrap}>
            <table>
              <caption>{t('review.history.appliedDiff')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('review.diff.field')}</th>
                  <th scope="col">{t('review.diff.before')}</th>
                  <th scope="col">{t('review.diff.after')}</th>
                </tr>
              </thead>
              <tbody>
                {decision.appliedDiff.changedFields.map(field => (
                  <tr key={field}>
                    <th scope="row">{t(diffFieldKey(field))}</th>
                    <td data-label={t('review.diff.before')}>
                      {diffValue(field, decision.appliedDiff!.before, memberById, t)}
                    </td>
                    <td data-label={t('review.diff.after')}>
                      {diffValue(field, decision.appliedDiff!.after, memberById, t)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t('review.history.appliedFields')}{' '}
            {decision.appliedDiff.changedFields.map(field => t(diffFieldKey(field))).join('、')}
          </p>
          <p className={css.digest}>
            {t('review.history.appliedDigest')} <code>{decision.appliedDiff.digest}</code>
          </p>
        </div>
      )}
    </li>
  )
}

function defaultDecisionDraft(card: SuggestedChangeProjection): WorkbenchReviewDecisionDraft {
  return {
    suggestedChangeId: card.suggestedChangeId,
    basedOnSuggestedChangeRevision: card.revision,
    mode: card.allowedDecisions[0] ?? 'reject',
    feedback: '',
    candidate: card.proposedDiff.after,
    riskAcknowledged: false,
  }
}

function diffValue(
  field: ProjectResponsibilityReviewField,
  value: ProjectResponsibilityReviewValue | ProjectResponsibilitySuggestedValue,
  memberById: ReadonlyMap<string, ReviewMemberOption>,
  t: (key: WorkbenchKey) => string,
): string {
  if (field === 'accountable') return memberLabel(value.accountableMemberId, memberById, t)
  if (field === 'human-sponsor') return memberLabel(value.humanSponsorMemberId, memberById, t)
  if (value.contributorMemberIds.length === 0) return t('review.value.none')
  return value.contributorMemberIds.map(id => memberLabel(id, memberById, t)).join('、')
}

function memberLabel(
  memberId: string | null,
  memberById: ReadonlyMap<string, ReviewMemberOption>,
  t: (key: WorkbenchKey) => string,
): string {
  if (memberId === null) return t('review.value.none')
  const member = memberById.get(memberId)
  return member === undefined ? memberId : memberDisplayLabel(member, t)
}

function statusKey(status: SuggestedChangeEffectiveStatus): WorkbenchKey {
  const keys = {
    pending: 'review.filter.status.pending',
    accepted: 'review.filter.status.accepted',
    rejected: 'review.filter.status.rejected',
    deferred: 'review.filter.status.deferred',
    stale: 'review.filter.status.stale',
  } satisfies Record<SuggestedChangeEffectiveStatus, WorkbenchKey>
  return keys[status]
}

function riskKey(risk: SuggestedChangeRiskLevel): WorkbenchKey {
  return risk === 'high' ? 'review.risk.high' : 'review.risk.low'
}

function memberKindKey(kind: 'human' | 'agent'): WorkbenchKey {
  return kind === 'human' ? 'review.member.human' : 'review.member.agent'
}

function memberOptionLabel(
  member: ReviewMemberOption,
  t: (key: WorkbenchKey) => string,
): string {
  return memberDisplayLabel(member, t)
}

function memberDisplayLabel(
  member: ReviewMemberOption,
  t: (key: WorkbenchKey) => string,
): string {
  const parts = [member.displayName, t(memberKindKey(member.kind)), member.memberId]
  if (member.requiresHumanSponsor && member.kind === 'human') {
    parts.push(t('review.member.external'))
  }
  if (member.status !== 'active') parts.push(t('team.member.status.inactive'))
  return parts.join(' · ')
}

function membersForDraft(
  members: readonly ReviewMemberOption[],
  selectedMemberIds: readonly string[],
): readonly ReviewMemberOption[] {
  const selected = new Set(selectedMemberIds)
  return members.filter(member => member.status === 'active' || selected.has(member.memberId))
}

function diffFieldKey(field: ProjectResponsibilityReviewField): WorkbenchKey {
  const keys = {
    accountable: 'review.diff.accountable',
    contributors: 'review.diff.contributors',
    'human-sponsor': 'review.diff.humanSponsor',
  } satisfies Record<ProjectResponsibilityReviewField, WorkbenchKey>
  return keys[field]
}

function decisionActionKey(mode: SuggestedChangeAllowedDecision): WorkbenchKey {
  const keys = {
    accept: 'review.decision.accept',
    'edit-and-accept': 'review.decision.editAccept',
    reject: 'review.decision.reject',
    defer: 'review.decision.defer',
  } satisfies Record<SuggestedChangeAllowedDecision, WorkbenchKey>
  return keys[mode]
}

function decisionModeKey(mode: SuggestedChangeDecisionProjection['mode']): WorkbenchKey {
  const keys = {
    accepted: 'review.history.accepted',
    'edited-accepted': 'review.history.editedAccepted',
    rejected: 'review.history.rejected',
    deferred: 'review.history.deferred',
  } satisfies Record<SuggestedChangeDecisionProjection['mode'], WorkbenchKey>
  return keys[mode]
}

function riskReasonKey(
  reason: SuggestedChangeProjection['risk']['proposedReasonCodes'][number],
): WorkbenchKey {
  const keys = {
    'initial-responsibility': 'review.risk.reason.initial',
    'accountable-changed': 'review.risk.reason.accountable',
    'human-sponsor-changed': 'review.risk.reason.sponsor',
    'contributors-only': 'review.risk.reason.contributors',
  } satisfies Record<SuggestedChangeProjection['risk']['proposedReasonCodes'][number], WorkbenchKey>
  return keys[reason]
}

function batchPolicyKey(
  policy: SuggestedChangeProjection['risk']['batchPolicy'],
): WorkbenchKey {
  if (policy.policy === 'eligible-later') return 'review.batch.eligibleLater'
  return policy.reason === 'high-risk'
    ? 'review.batch.forbiddenHighRisk'
    : 'review.batch.forbiddenNotActionable'
}

function evidenceSummaryKey(
  summary: SuggestedChangeEvidenceProjection['summaryCode'],
): WorkbenchKey {
  const keys = {
    'status-revision-committed': 'activity.summary.statusCommitted',
    'project-created-from-template': 'activity.summary.projectCreated',
    'project-member-created': 'activity.summary.projectMemberCreated',
    'project-member-status-changed': 'activity.summary.projectMemberStatusChanged',
    'project-responsibility-assigned': 'activity.summary.projectResponsibilityAssigned',
    'suggested-change-proposed': 'activity.summary.suggestedChangeProposed',
    'suggested-change-accepted': 'activity.summary.suggestedChangeAccepted',
    'suggested-change-edited-accepted': 'activity.summary.suggestedChangeEditedAccepted',
    'suggested-change-rejected': 'activity.summary.suggestedChangeRejected',
    'suggested-change-deferred': 'activity.summary.suggestedChangeDeferred',
    'feishu-route-configured': 'activity.summary.feishuRouteConfigured',
    'feishu-route-reset': 'activity.summary.feishuRouteReset',
    'feishu-route-disabled': 'activity.summary.feishuRouteDisabled',
    'feishu-route-verification-healthy': 'activity.summary.feishuVerificationHealthy',
    'feishu-route-verification-attention': 'activity.summary.feishuVerificationAttention',
    'feishu-route-verification-failed': 'activity.summary.feishuVerificationFailed',
    'feishu-task-list-bound': 'activity.summary.feishuTaskListBound',
    'feishu-task-referenced': 'activity.summary.feishuTaskReferenced',
    'feishu-task-update-requested': 'activity.summary.feishuTaskUpdateRequested',
    'feishu-task-workflow-configured': 'activity.summary.feishuTaskWorkflowConfigured',
    'project-calendar-bound': 'activity.summary.projectCalendarBound',
    'project-milestone-created': 'activity.summary.projectMilestoneCreated',
    'project-milestone-date-update-requested': 'activity.summary.projectMilestoneDateUpdateRequested',
    'project-deliverable-created': 'activity.summary.projectDeliverableCreated',
    'deliverable-acceptance-requested': 'activity.summary.deliverableAcceptanceRequested',
    'deliverable-acceptance-approved': 'activity.summary.deliverableAcceptanceApproved',
    'deliverable-acceptance-rejected': 'activity.summary.deliverableAcceptanceRejected',
    'deliverable-acceptance-needs-changes': 'activity.summary.deliverableAcceptanceNeedsChanges',
  } satisfies Record<SuggestedChangeEvidenceProjection['summaryCode'], WorkbenchKey>
  return keys[summary]
}

function issueMessageKey(issue: WorkbenchReviewIssue): WorkbenchKey {
  if (issue.kind === 'transport') {
    if (issue.code === 'unauthorized' || issue.code === 'forbidden') return 'review.error.permission'
    if (issue.code === 'rate-limited') return 'review.error.rateLimited'
    return 'review.error.transport'
  }
  if (issue.kind === 'input') {
    return issue.code === 'project-not-found'
      ? 'review.error.projectNotFound'
      : 'review.error.badRequest'
  }
  if (issue.code === 'suggested-change-stale') return 'review.error.suggestionStale'
  if (issue.code === 'suggested-change-revision-conflict') return 'review.error.reviewConflict'
  if (issue.code === 'team-revision-conflict') return 'review.error.teamConflict'
  if (issue.code === 'evidence-invalid' || issue.code === 'evidence-required') {
    return 'review.error.evidence'
  }
  if (issue.code === 'risk-acknowledgement-mismatch') return 'review.error.riskMismatch'
  if (issue.code === 'no-op-suggested-change') return 'review.error.noop'
  return 'review.error.domain'
}

function readableTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed)
  } catch {
    return value
  }
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '-')
}
