/** Accessible Project Deliverables creation, execution, and acceptance-request workspace. */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeliverableArtifactVersionRef,
  DeliverableArtifactVersionProjection,
  ProjectCalendarSchedule,
  ProjectDeliverableProjection,
  WorkbenchDigest,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_DELIVERABLE_CANDIDATE_VERSIONS,
  MAX_DELIVERABLE_CRITERIA,
  MAX_DELIVERABLE_CRITERION_LENGTH,
  MAX_DELIVERABLE_DESCRIPTION_LENGTH,
  MAX_DELIVERABLE_NAME_LENGTH,
  type WorkbenchProjectDeliverablesClientState,
  type WorkbenchProjectDeliverablesController,
} from './project-deliverables-controller.ts'
import css from './ProjectDeliverablesPanel.module.css'

export interface ProjectDeliverablesPanelProps {
  readonly controller: WorkbenchProjectDeliverablesController
  readonly t: (key: WorkbenchKey) => string
}

interface ArtifactInput {
  readonly source: DeliverableArtifactVersionRef['source']
  readonly resourceId: string
  readonly versionId: string
  readonly displayName: string
  readonly canonicalUrl: string
  readonly contentDigest: string
}

const EMPTY_ARTIFACT: ArtifactInput = Object.freeze({
  source: 'managed', resourceId: '', versionId: '', displayName: '',
  canonicalUrl: '', contentDigest: '',
})

function phasePresentation(state: WorkbenchProjectDeliverablesClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'deliverables.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'deliverables.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'deliverables.status.loading' }
    case 'ready': return { dot: 'done', key: 'deliverables.status.ready' }
    case 'stale': return { dot: 'warning', key: 'deliverables.status.stale' }
    case 'error': return { dot: 'error', key: 'deliverables.status.error' }
    case 'conflict': return { dot: 'warning', key: 'deliverables.status.conflict' }
  }
}

export function ProjectDeliverablesPanel({
  controller,
  t,
}: ProjectDeliverablesPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const presentation = phasePresentation(state)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const draft = state.createDraft
  const projection = state.projection
  const accountable = projection?.memberOptions.find(
    member => member.memberId === draft.accountableMemberId,
  )
  const pending = state.pendingOperation !== null

  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusDeliverableId === null) return
    cardRefs.current.get(state.focusDeliverableId)?.focus({ preventScroll: true })
  }, [state.focusDeliverableId, state.focusEpoch])

  const submitCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canCreate()) void controller.create()
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-project-deliverables-title"
      aria-busy={state.phase === 'loading' || pending}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('deliverables.kicker')}</p>
          <h2 id="workbench-project-deliverables-title" className={css.title}>
            {t('deliverables.title')}
          </h2>
          <p className={css.subtitle}>{t('deliverables.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.selection === null ? (
        <p className={css.empty}>{t('deliverables.selection.empty')}</p>
      ) : (
        <>
          <div className={css.projectContext}>
            <span>{t('deliverables.project.label')}</span>
            <strong>{state.selection.projectName || state.selection.projectId}</strong>
          </div>
          <p className={css.actorTruth}>{t('deliverables.decision.actorTruth')}</p>

          {state.issue !== null && (
            <div className={css.issue} role="alert">
              <strong>{t('deliverables.error.title')}</strong>
              <p>{t(state.issue.kind === 'transport'
                ? 'deliverables.error.transport'
                : state.issue.kind === 'input'
                  ? 'deliverables.error.input'
                  : 'deliverables.error.conflict')}</p>
              <code>{state.issue.code}</code>
              <div className={css.actions}>
                {state.canRetryMutation && (
                  <Button variant="outline" size="sm" type="button" onClick={() => {
                    void controller.retryMutation()
                  }}>
                    {t('deliverables.retryExact')}
                  </Button>
                )}
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  void controller.refresh()
                }}>
                  {t('deliverables.refresh')}
                </Button>
              </div>
            </div>
          )}

          {projection !== null && (
            <>
              <details className={css.create} open>
                <summary>{t('deliverables.create.title')}</summary>
                <div className={css.createBody}>
                  <p>{t('deliverables.create.body')}</p>
                  <form aria-label={t('deliverables.create.legend')} onSubmit={submitCreate}>
                    <fieldset className={css.fieldset} disabled={pending}>
                      <legend>{t('deliverables.create.legend')}</legend>
                      <label className={css.field}>
                        <span>{t('deliverables.create.name')}</span>
                        <input
                          value={draft.name}
                          maxLength={MAX_DELIVERABLE_NAME_LENGTH}
                          required
                          onChange={event => { controller.setCreateName(event.currentTarget.value) }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('deliverables.create.description')}</span>
                        <textarea
                          value={draft.description}
                          maxLength={MAX_DELIVERABLE_DESCRIPTION_LENGTH}
                          rows={3}
                          onChange={event => {
                            controller.setCreateDescription(event.currentTarget.value)
                          }}
                        />
                      </label>

                      <fieldset className={css.nestedFieldset}>
                        <legend>{t('deliverables.create.criteria')}</legend>
                        <div className={css.stack}>
                          {draft.criteria.map((criterion, index) => (
                            <div className={css.criteriaRow} key={index}>
                              <label className={css.field}>
                                <span>{t('deliverables.create.criterion')} {index + 1}</span>
                                <textarea
                                  value={criterion}
                                  maxLength={MAX_DELIVERABLE_CRITERION_LENGTH}
                                  rows={2}
                                  required
                                  onChange={event => {
                                    controller.setCreateCriterion(index, event.currentTarget.value)
                                  }}
                                />
                              </label>
                              {draft.criteria.length > 1 && (
                                <Button variant="outline" size="sm" type="button" onClick={() => {
                                  controller.removeCreateCriterion(index)
                                }}>
                                  {t('deliverables.create.removeCriterion')} {index + 1}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={draft.criteria.length >= MAX_DELIVERABLE_CRITERIA}
                          onClick={() => { controller.addCreateCriterion() }}
                        >
                          {t('deliverables.create.addCriterion')}
                        </Button>
                      </fieldset>

                      <fieldset className={css.nestedFieldset}>
                        <legend>{t('deliverables.create.responsibility')}</legend>
                        <div className={css.twoColumn}>
                          <label className={css.field}>
                            <span>{t('deliverables.role.accountable')}</span>
                            <select
                              value={draft.accountableMemberId}
                              required
                              onChange={event => {
                                controller.setCreateAccountable(event.currentTarget.value)
                              }}
                            >
                              <option value="">{t('deliverables.create.chooseMember')}</option>
                              {projection.memberOptions.map(member => (
                                <option
                                  key={member.memberId}
                                  value={member.memberId}
                                  disabled={member.status !== 'active'}
                                >
                                  {member.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={css.field}>
                            <span>{t('deliverables.role.acceptor')}</span>
                            <select
                              value={draft.acceptorMemberId}
                              required
                              onChange={event => {
                                controller.setCreateAcceptor(event.currentTarget.value)
                              }}
                            >
                              <option value="">{t('deliverables.create.chooseMember')}</option>
                              {projection.memberOptions.filter(member => member.canAccept).map(member => (
                                <option
                                  key={member.memberId}
                                  value={member.memberId}
                                  disabled={member.status !== 'active'}
                                >
                                  {member.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <fieldset className={css.choiceFieldset}>
                          <legend>{t('deliverables.create.contributors')}</legend>
                          <div className={css.choices}>
                            {projection.memberOptions.map(member => (
                              <label key={member.memberId}>
                                <input
                                  type="checkbox"
                                  checked={draft.contributorMemberIds.includes(member.memberId)}
                                  disabled={member.status !== 'active'
                                    || member.memberId === draft.accountableMemberId}
                                  onChange={event => {
                                    controller.setCreateContributor(
                                      member.memberId, event.currentTarget.checked,
                                    )
                                  }}
                                />
                                <span>{member.displayName}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        {accountable?.requiresHumanSponsor === true && (
                          <label className={css.field}>
                            <span>{t('deliverables.create.sponsor')}</span>
                            <select
                              value={draft.humanSponsorMemberId}
                              required
                              onChange={event => {
                                controller.setCreateHumanSponsor(event.currentTarget.value)
                              }}
                            >
                              <option value="">{t('deliverables.create.chooseMember')}</option>
                              {projection.memberOptions.filter(member =>
                                member.canBeHumanSponsor
                                && member.memberId !== draft.accountableMemberId).map(member => (
                                  <option key={member.memberId} value={member.memberId}>
                                    {member.displayName}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                      </fieldset>

                      <fieldset className={css.choiceFieldset}>
                        <legend>{t('deliverables.create.tasks')}</legend>
                        <p className={css.hint}>{t('deliverables.create.tasksHint')}</p>
                        <div className={css.choices}>
                          {projection.taskOptions.map(task => (
                            <label key={task.taskGuid}>
                              <input
                                type="checkbox"
                                checked={draft.taskGuids.includes(task.taskGuid)}
                                onChange={event => {
                                  controller.setCreateTask(task.taskGuid, event.currentTarget.checked)
                                }}
                              />
                              <span>{task.summary}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      <fieldset className={css.nestedFieldset}>
                        <legend>{t('deliverables.schedule.legend')}</legend>
                        <label className={css.radio}>
                          <input
                            type="radio"
                            name="deliverable-event-mode"
                            checked={draft.eventMode === 'create-event'
                              && draft.schedule.kind === 'all-day'}
                            onChange={() => {
                              controller.setCreateEventMode('create-event')
                              controller.setCreateSchedule(allDaySchedule(draft.schedule))
                            }}
                          />
                          <span>{t('deliverables.schedule.allDay')}</span>
                        </label>
                        {draft.eventMode === 'create-event' && draft.schedule.kind === 'all-day' && (
                          <div className={css.twoColumn}>
                            <label className={css.field}>
                              <span>{t('deliverables.schedule.startDate')}</span>
                              <input
                                type="date"
                                value={draft.schedule.startDate}
                                required
                                onChange={event => {
                                  if (draft.schedule.kind !== 'all-day') return
                                  controller.setCreateSchedule({
                                    ...draft.schedule, startDate: event.currentTarget.value,
                                  })
                                }}
                              />
                            </label>
                            <label className={css.field}>
                              <span>{t('deliverables.schedule.endDate')}</span>
                              <input
                                type="date"
                                value={draft.schedule.endDate}
                                required
                                onChange={event => {
                                  if (draft.schedule.kind !== 'all-day') return
                                  controller.setCreateSchedule({
                                    ...draft.schedule, endDate: event.currentTarget.value,
                                  })
                                }}
                              />
                            </label>
                          </div>
                        )}

                        <details className={css.advanced}>
                          <summary>{t('deliverables.schedule.advanced')}</summary>
                          <div className={css.advancedBody}>
                            <label className={css.radio}>
                              <input
                                type="radio"
                                name="deliverable-event-mode"
                                checked={draft.eventMode === 'existing-event'}
                                onChange={() => { controller.setCreateEventMode('existing-event') }}
                              />
                              <span>{t('deliverables.schedule.existing')}</span>
                            </label>
                            {draft.eventMode === 'existing-event' && (
                              <div className={css.stack}>
                                <Button variant="outline" size="sm" type="button" onClick={() => {
                                  void controller.discoverEvents()
                                }}>
                                  {t('deliverables.schedule.discover')}
                                </Button>
                                <label className={css.field}>
                                  <span>{t('deliverables.schedule.chooseEvent')}</span>
                                  <select
                                    value={draft.eventId}
                                    required
                                    onChange={event => {
                                      controller.setCreateEventId(event.currentTarget.value)
                                    }}
                                  >
                                    <option value="">{t('deliverables.schedule.chooseEvent')}</option>
                                    {state.eventDiscovery?.items.filter(item => item.selectable).map(item => (
                                      <option key={item.eventId} value={item.eventId}>{item.summary}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            )}
                            <label className={css.radio}>
                              <input
                                type="radio"
                                name="deliverable-event-mode"
                                checked={draft.eventMode === 'create-event'
                                  && draft.schedule.kind === 'timed'}
                                onChange={() => {
                                  controller.setCreateEventMode('create-event')
                                  controller.setCreateSchedule(timedSchedule(draft.schedule))
                                }}
                              />
                              <span>{t('deliverables.schedule.timed')}</span>
                            </label>
                            {draft.eventMode === 'create-event' && draft.schedule.kind === 'timed' && (
                              <div className={css.stack}>
                                <label className={css.field}>
                                  <span>{t('deliverables.schedule.startAt')}</span>
                                  <input
                                    value={draft.schedule.startAt}
                                    placeholder="2026-09-02T09:00:00+08:00"
                                    required
                                    onChange={event => {
                                      if (draft.schedule.kind !== 'timed') return
                                      controller.setCreateSchedule({
                                        ...draft.schedule, startAt: event.currentTarget.value,
                                      })
                                    }}
                                  />
                                </label>
                                <label className={css.field}>
                                  <span>{t('deliverables.schedule.endAt')}</span>
                                  <input
                                    value={draft.schedule.endAt}
                                    placeholder="2026-09-02T10:00:00+08:00"
                                    required
                                    onChange={event => {
                                      if (draft.schedule.kind !== 'timed') return
                                      controller.setCreateSchedule({
                                        ...draft.schedule, endAt: event.currentTarget.value,
                                      })
                                    }}
                                  />
                                </label>
                                <label className={css.field}>
                                  <span>{t('deliverables.schedule.timeZone')}</span>
                                  <input
                                    value={draft.schedule.timeZone}
                                    required
                                    onChange={event => {
                                      if (draft.schedule.kind !== 'timed') return
                                      controller.setCreateSchedule({
                                        ...draft.schedule, timeZone: event.currentTarget.value,
                                      })
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        </details>
                      </fieldset>
                      <div className={css.actions}>
                        <Button variant="primary" type="submit" disabled={!controller.canCreate()}>
                          {state.pendingOperation === 'create-deliverable'
                            ? t('deliverables.create.pending')
                            : t('deliverables.create.action')}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                </div>
              </details>

              <section className={css.list} aria-labelledby="workbench-deliverables-list-title">
                <h3 id="workbench-deliverables-list-title">{t('deliverables.list.title')}</h3>
                {projection.deliverables.length === 0 ? (
                  <p className={css.empty}>{t('deliverables.empty')}</p>
                ) : projection.deliverables.map(item => (
                  <DeliverableCard
                    key={item.deliverableId}
                    item={item}
                    state={state}
                    controller={controller}
                    t={t}
                    setRef={node => {
                      if (node === null) cardRefs.current.delete(item.deliverableId)
                      else cardRefs.current.set(item.deliverableId, node)
                    }}
                  />
                ))}
              </section>

              <section className={css.activity} aria-labelledby="workbench-deliverables-activity-title">
                <h3 id="workbench-deliverables-activity-title">{t('deliverables.activity.title')}</h3>
                {projection.activity.length === 0 ? (
                  <p>{t('deliverables.activity.empty')}</p>
                ) : (
                  <ol>
                    {projection.activity.map(entry => (
                      <li key={entry.activityId}>
                        <div><strong>{entry.action}</strong> · <time dateTime={entry.occurredAt}>{readableTimestamp(entry.occurredAt)}</time></div>
                        <dl className={css.compactMeta}>
                          <div><dt>{t('deliverables.activity.plan')}</dt><dd><code>{entry.planSnapshotId}</code></dd></div>
                          {entry.acceptanceRequestId !== null && <div><dt>{t('deliverables.activity.request')}</dt><dd><code>{entry.acceptanceRequestId}</code></dd></div>}
                          {entry.decisionId !== null && <div><dt>{t('deliverables.activity.decision')}</dt><dd><code>{entry.decisionId}</code></dd></div>}
                          <div><dt>{entry.source.kind}</dt><dd><code>{entry.source.kind === 'audit-event' ? entry.source.auditEventId : entry.source.scheduleChangeId}</code></dd></div>
                        </dl>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

function DeliverableCard({
  item,
  state,
  controller,
  t,
  setRef,
}: {
  readonly item: ProjectDeliverableProjection
  readonly state: WorkbenchProjectDeliverablesClientState
  readonly controller: WorkbenchProjectDeliverablesController
  readonly t: (key: WorkbenchKey) => string
  readonly setRef: (node: HTMLElement | null) => void
}) {
  const [artifact, setArtifact] = useState<ArtifactInput>(EMPTY_ARTIFACT)
  const candidates = state.candidateDrafts[item.deliverableId] ?? []
  const pending = state.pendingOperation !== null
  const addArtifact = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = artifactRef(artifact)
    if (value === null) return
    controller.addCandidateVersion(item.deliverableId, value)
    setArtifact(EMPTY_ARTIFACT)
  }
  return (
    <article
      className={css.card}
      aria-label={item.plan.name}
      tabIndex={-1}
      ref={setRef}
      data-deliverable-id={item.deliverableId}
    >
      <header className={css.cardHeader}>
        <div>
          <p className={css.immutable}>{t('deliverables.plan.immutable')}</p>
          <h4>{item.plan.name}</h4>
          {item.plan.description !== null && <p>{item.plan.description}</p>}
        </div>
        <span className={css.stateBadge}>{item.state}</span>
      </header>
      <dl className={css.meta}>
        <div><dt>{t('deliverables.plan.snapshot')}</dt><dd><code>{item.plan.planSnapshotId}</code></dd></div>
        <div><dt>{t('deliverables.plan.revision')}</dt><dd>{item.revision}</dd></div>
        <div><dt>{t('deliverables.role.accountable')}</dt><dd>{item.plan.responsibility.accountable.displayName}</dd></div>
        <div><dt>{t('deliverables.role.acceptor')}</dt><dd>{item.plan.responsibility.acceptor.displayName}</dd></div>
      </dl>
      <section className={css.cardSection}>
        <h5>{t('deliverables.plan.criteria')}</h5>
        <ol>{item.plan.criteria.map(criterion => <li key={criterion.criterionId}>{criterion.statement}</li>)}</ol>
      </section>
      <section className={css.cardSection}>
        <h5>{t('deliverables.calendar.title')}</h5>
        <p>{scheduleText(item.calendar.schedule)} · {item.calendar.remoteStatus} · {item.calendar.syncState}</p>
        <a href={item.calendar.eventAppLink} target="_blank" rel="noreferrer">
          {t('deliverables.calendar.open')}
        </a>
      </section>
      <section className={css.cardSection}>
        <h5>{t('deliverables.tasks.title')}</h5>
        <ul>
          {item.tasks.map(link => (
            <li key={link.taskGuid}>
              {link.task === null ? (
                <><code>{link.taskGuid}</code> — {t('deliverables.tasks.unavailable')}</>
              ) : (
                <a href={link.task.canonicalUrl} target="_blank" rel="noreferrer">{link.task.summary}</a>
              )}
            </li>
          ))}
        </ul>
      </section>

      {item.state === 'planned' && (
        <form className={css.artifactForm} aria-label={t('deliverables.artifact.legend')} onSubmit={addArtifact}>
          <fieldset className={css.nestedFieldset} disabled={pending}>
            <legend>{t('deliverables.artifact.legend')}</legend>
            <p className={css.hint}>{t('deliverables.artifact.truth')}</p>
            <div className={css.twoColumn}>
              <label className={css.field}>
                <span>{t('deliverables.artifact.source')}</span>
                <select value={artifact.source} onChange={event => {
                  setArtifact({ ...artifact, source: event.currentTarget.value as ArtifactInput['source'] })
                }}>
                  <option value="managed">managed</option>
                  <option value="local">local</option>
                  <option value="feishu">feishu</option>
                </select>
              </label>
              <label className={css.field}>
                <span>{t('deliverables.artifact.resourceId')}</span>
                <input required value={artifact.resourceId} onChange={event => {
                  setArtifact({ ...artifact, resourceId: event.currentTarget.value })
                }} />
              </label>
              <label className={css.field}>
                <span>{t('deliverables.artifact.versionId')}</span>
                <input required value={artifact.versionId} onChange={event => {
                  setArtifact({ ...artifact, versionId: event.currentTarget.value })
                }} />
              </label>
              <label className={css.field}>
                <span>{t('deliverables.artifact.displayName')}</span>
                <input required value={artifact.displayName} onChange={event => {
                  setArtifact({ ...artifact, displayName: event.currentTarget.value })
                }} />
              </label>
              <label className={css.field}>
                <span>{t('deliverables.artifact.url')}</span>
                <input type="url" pattern="https://.*" value={artifact.canonicalUrl} onChange={event => {
                  setArtifact({ ...artifact, canonicalUrl: event.currentTarget.value })
                }} />
              </label>
              <label className={css.field}>
                <span>{t('deliverables.artifact.digest')}</span>
                <input pattern="sha256:[0-9a-f]{64}" value={artifact.contentDigest} onChange={event => {
                  setArtifact({ ...artifact, contentDigest: event.currentTarget.value })
                }} />
              </label>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              disabled={candidates.length >= MAX_DELIVERABLE_CANDIDATE_VERSIONS}
            >
              {t('deliverables.artifact.add')}
            </Button>
            {candidates.length > 0 && (
              <ul className={css.versions}>
                {candidates.map((candidate, index) => (
                  <li key={[
                    index, candidate.kind, candidate.source, candidate.resourceId,
                    candidate.versionId, candidate.displayName, candidate.canonicalUrl ?? '',
                    candidate.contentDigest ?? '',
                  ].join('\u001f')}>
                    <div>
                      <strong>{candidate.displayName}</strong>
                      <span>{t('deliverables.artifact.declared')}</span>
                      <code>{candidate.source}:{candidate.resourceId}@{candidate.versionId}</code>
                    </div>
                    <Button variant="outline" size="sm" type="button" onClick={() => {
                      controller.removeCandidateVersion(item.deliverableId, index)
                    }}>
                      {t('deliverables.artifact.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="primary"
              type="button"
              disabled={!controller.canRequestAcceptance(item.deliverableId)}
              onClick={() => { void controller.requestAcceptance(item.deliverableId) }}
            >
              {state.pendingOperation === 'request-acceptance'
                && state.pendingDeliverableId === item.deliverableId
                ? t('deliverables.acceptance.requesting')
                : t('deliverables.acceptance.request')}
            </Button>
          </fieldset>
        </form>
      )}

      <section className={css.cardSection}>
        <h5>{t('deliverables.acceptance.rounds')}</h5>
        {item.acceptanceRequests.length === 0 ? (
          <p>{t('deliverables.acceptance.none')}</p>
        ) : item.acceptanceRequests.map(request => (
          <article
            className={css.round}
            key={request.acceptanceRequestId}
            aria-label={`${t('deliverables.activity.request')} ${request.sequence}`}
          >
            <header><strong>{request.effectiveStatus}</strong><code>{request.acceptanceRequestId}</code></header>
            <ul>{request.candidateVersions.map(version => <Version key={version.referenceDigest} version={version} t={t} />)}</ul>
            {request.decision !== null && (
              <div className={css.decision}>
                <dl className={css.meta}>
                  <div><dt>{t('deliverables.acceptance.designated')}</dt><dd>{request.decision.designatedAcceptor.displayName}</dd></div>
                  <div><dt>{t('deliverables.acceptance.recordedBy')}</dt><dd>{request.decision.actor.kind} · <code>{request.decision.actor.id}</code></dd></div>
                </dl>
                <p>{request.decision.feedback}</p>
                <ul>{request.decision.criteria.map(result => {
                  const criterion = request.plan.criteria.find(item => item.criterionId === result.criterionId)
                  return <li key={result.criterionId}>{criterion?.statement ?? result.criterionId}: <strong>{result.outcome}</strong></li>
                })}</ul>
              </div>
            )}
          </article>
        ))}
      </section>
      {item.finalRelease !== null && (
        <section className={css.finalRelease}>
          <h5>{t('deliverables.acceptance.final')}</h5>
          <code>{item.finalRelease.finalReleaseId}</code>
          <ul>{item.finalRelease.versions.map(version => <Version key={version.referenceDigest} version={version} t={t} />)}</ul>
        </section>
      )}
    </article>
  )
}

function Version({
  version, t,
}: {
  readonly version: DeliverableArtifactVersionProjection
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <li className={css.version}>
      <strong>{version.displayName}</strong>
      <span>{t('deliverables.artifact.declared')}</span>
      <code>{version.source}:{version.resourceId}@{version.versionId}</code>
    </li>
  )
}

function artifactRef(value: ArtifactInput): DeliverableArtifactVersionRef | null {
  const resourceId = value.resourceId.trim()
  const versionId = value.versionId.trim()
  const displayName = value.displayName.trim()
  const canonicalUrl = value.canonicalUrl.trim()
  const digest = value.contentDigest.trim()
  if (resourceId === '' || versionId === '' || displayName === ''
    || (canonicalUrl !== '' && !validHttpsUrl(canonicalUrl))
    || (digest !== '' && !/^sha256:[0-9a-f]{64}$/u.test(digest))) return null
  return Object.freeze({
    kind: 'declared-file-version', source: value.source, resourceId, versionId, displayName,
    canonicalUrl: canonicalUrl === '' ? null : canonicalUrl,
    contentDigest: digest === '' ? null : digest as WorkbenchDigest,
  })
}

function validHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function allDaySchedule(value: ProjectCalendarSchedule): ProjectCalendarSchedule {
  if (value.kind === 'all-day') return value
  const startDate = value.startAt.slice(0, 10)
  const parsed = Date.parse(`${startDate}T00:00:00Z`)
  return {
    kind: 'all-day', startDate,
    endDate: Number.isFinite(parsed)
      ? new Date(parsed + 86_400_000).toISOString().slice(0, 10) : '',
  }
}

function timedSchedule(value: ProjectCalendarSchedule): ProjectCalendarSchedule {
  if (value.kind === 'timed') return value
  return { kind: 'timed', startAt: '', endAt: '', timeZone: 'Asia/Shanghai' }
}

function scheduleText(value: ProjectCalendarSchedule): string {
  return value.kind === 'all-day'
    ? `${value.startDate} – ${value.endDate}`
    : `${value.startAt} – ${value.endAt} (${value.timeZone})`
}

function readableTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) }
  catch { return value }
}
