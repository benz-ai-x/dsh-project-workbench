/** Accessible Project creation, catalog, and immutable snapshot inspection UI. */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type RefObject,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ProjectDetailProjection,
  ProjectSummaryProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import type {
  WorkbenchProjectClientState,
  WorkbenchProjectController,
  WorkbenchProjectIssue,
} from './project-controller.ts'
import {
  MAX_PROJECT_METRIC_NAME_LENGTH,
  MAX_PROJECT_OUTCOME_COUNT,
  MAX_PROJECT_SUPPORTING_GOAL_COUNT,
  MAX_PROJECT_TEXT_LENGTH,
  MAX_PROJECT_UNIT_LENGTH,
} from './project-controller.ts'
import css from './ProjectsPanel.module.css'

export interface ProjectsPanelProps {
  readonly controller: WorkbenchProjectController
  readonly t: (key: WorkbenchKey) => string
}

function phasePresentation(state: WorkbenchProjectClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pending || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'projects.status.pending' }
  }
  switch (state.phase) {
    case 'loading': return { dot: 'ongoing', key: 'projects.status.loading' }
    case 'ready': return { dot: 'done', key: 'projects.status.ready' }
    case 'stale': return { dot: 'warning', key: 'projects.status.stale' }
    case 'error': return state.issue?.kind === 'input'
      ? { dot: 'warning', key: 'projects.status.input' }
      : { dot: 'error', key: 'projects.status.error' }
    case 'conflict': return { dot: 'warning', key: 'projects.status.conflict' }
  }
}

export function ProjectsPanel({ controller, t }: ProjectsPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const [paginationAnnouncement, setPaginationAnnouncement] = useState('')
  const presentation = phasePresentation(state)
  const selectedGoalIds = new Set(state.draft.supportingGoals.map(goal => goal.goalId))
  const loadedGoalIds = new Set(state.start?.projects.map(project => project.primaryGoal.goalId) ?? [])

  useEffect(() => {
    if (state.detailFocusEpoch > 0) detailTitle.current?.focus({ preventScroll: true })
  }, [state.detailFocusEpoch])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canCreate()) void controller.create()
  }

  const loadMore = async (): Promise<void> => {
    const before = controller.getSnapshot().start?.projects.length ?? 0
    setPaginationAnnouncement('')
    await controller.loadMore()
    const accepted = controller.getSnapshot()
    const total = accepted.start?.projects.length ?? before
    if (total <= before) return
    setPaginationAnnouncement(t('projects.catalog.loaded')
      .replace('{count}', new Intl.NumberFormat().format(total - before))
      .replace('{total}', new Intl.NumberFormat().format(total)))
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-projects-title"
      aria-busy={state.pending || (state.phase === 'loading' && state.start === null)}
      data-project-phase={state.phase}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('projects.kicker')}</p>
          <h2 id="workbench-projects-title" className={css.title}>{t('projects.title')}</h2>
          <p className={css.subtitle}>{t('projects.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.phase === 'loading' && state.start === null && (
        <p className={css.notice} role="status">{t('projects.loading')}</p>
      )}
      {state.phase === 'stale' && (
        <p className={css.stale} role="status">{t('projects.stale')}</p>
      )}
      {state.phase === 'error' && (
        <ProjectIssue issue={state.issue} controller={controller} t={t} />
      )}
      {state.phase === 'conflict' && (
        <ProjectIssue issue={state.issue} controller={controller} t={t} />
      )}

      {state.start !== null && (
        <>
          <article className={css.templateCard} aria-labelledby="workbench-template-title">
            <div>
              <p className={css.templateEyebrow}>{t('projects.template.eyebrow')}</p>
              <h3 id="workbench-template-title" className={css.templateTitle}>
                {t('projects.template.title')}
              </h3>
              <p className={css.templateBody}>{t('projects.template.body')}</p>
            </div>
            <dl className={css.templateMeta}>
              <div>
                <dt>{t('projects.template.version')}</dt>
                <dd>{state.start.template.selection.templateVersion}</dd>
              </div>
              <div>
                <dt>{t('projects.template.timezone')}</dt>
                <dd>{state.start.template.definition.defaults.projectTimezone}</dd>
              </div>
              <div className={css.wideMeta}>
                <dt>{t('projects.template.digest')}</dt>
                <dd><code>{state.start.template.selection.definitionDigest}</code></dd>
              </div>
            </dl>
          </article>

          <form className={css.createForm} aria-busy={state.pending} onSubmit={submit}>
            <fieldset className={css.fieldset} disabled={state.pending}>
              <legend>{t('projects.form.project.legend')}</legend>
              <label className={css.field}>
                <span>{t('projects.form.project.name')}</span>
                <input
                  value={state.draft.projectName}
                  required
                  maxLength={MAX_PROJECT_TEXT_LENGTH}
                  autoComplete="off"
                  onChange={event => { controller.setProjectName(event.currentTarget.value) }}
                />
              </label>
            </fieldset>

            <fieldset className={css.fieldset} disabled={state.pending}>
              <legend>{t('projects.form.goal.legend')}</legend>
              <label className={css.field}>
                <span>{t('projects.form.goal.name')}</span>
                <input
                  value={state.draft.primaryGoalName}
                  required
                  maxLength={MAX_PROJECT_TEXT_LENGTH}
                  autoComplete="off"
                  onChange={event => { controller.setPrimaryGoalName(event.currentTarget.value) }}
                />
              </label>
            </fieldset>

            <fieldset className={css.fieldset} disabled={state.pending}>
              <legend>{t('projects.form.outcomes.legend')}</legend>
              <p className={css.fieldsetHint}>{t('projects.form.outcomes.hint')}</p>
              <div className={css.outcomes}>
                {state.draft.outcomes.map((outcome, index) => (
                  <section
                    key={outcome.key}
                    className={css.outcome}
                    aria-labelledby={`workbench-outcome-${outcome.key}`}
                  >
                    <div className={css.outcomeHeader}>
                      <h4 id={`workbench-outcome-${outcome.key}`}>
                        {t('projects.form.outcome.title').replace('{number}', String(index + 1))}
                      </h4>
                      <button
                        className={css.removeButton}
                        type="button"
                        disabled={state.draft.outcomes.length === 1}
                        aria-label={`${t('projects.form.outcome.remove')} ${index + 1}`}
                        onClick={() => { controller.removeOutcome(outcome.key) }}
                      >
                        {t('projects.form.outcome.remove')}
                      </button>
                    </div>
                    <div className={css.outcomeGrid}>
                      <label className={`${css.field} ${css.spanTwo}`}>
                        <span>{t('projects.form.outcome.name')}</span>
                        <input
                          value={outcome.name}
                          required
                          maxLength={MAX_PROJECT_TEXT_LENGTH}
                          autoComplete="off"
                          onChange={event => {
                            controller.updateOutcome(outcome.key, { name: event.currentTarget.value })
                          }}
                        />
                      </label>
                      <label className={`${css.field} ${css.spanTwo}`}>
                        <span>{t('projects.form.outcome.metric')}</span>
                        <input
                          value={outcome.metricName}
                          required
                          maxLength={MAX_PROJECT_METRIC_NAME_LENGTH}
                          autoComplete="off"
                          onChange={event => {
                            controller.updateOutcome(outcome.key, { metricName: event.currentTarget.value })
                          }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('projects.form.outcome.baseline')}</span>
                        <input
                          type="number"
                          step="any"
                          value={outcome.initialValue}
                          required
                          onChange={event => {
                            controller.updateOutcome(outcome.key, { initialValue: event.currentTarget.value })
                          }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('projects.form.outcome.target')}</span>
                        <input
                          type="number"
                          step="any"
                          value={outcome.targetValue}
                          required
                          onChange={event => {
                            controller.updateOutcome(outcome.key, { targetValue: event.currentTarget.value })
                          }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('projects.form.outcome.unit')}</span>
                        <input
                          value={outcome.unit}
                          required
                          maxLength={MAX_PROJECT_UNIT_LENGTH}
                          autoComplete="off"
                          onChange={event => {
                            controller.updateOutcome(outcome.key, { unit: event.currentTarget.value })
                          }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('projects.form.outcome.direction')}</span>
                        <select
                          aria-label={t('projects.form.outcome.direction')}
                          value={outcome.direction}
                          onChange={event => {
                            controller.updateOutcome(outcome.key, {
                              direction: event.currentTarget.value === 'decrease'
                                ? 'decrease'
                                : 'increase',
                            })
                          }}
                        >
                          <option value="increase">{t('projects.form.outcome.increase')}</option>
                          <option value="decrease">{t('projects.form.outcome.decrease')}</option>
                        </select>
                      </label>
                    </div>
                  </section>
                ))}
              </div>
              <button
                className={css.secondaryButton}
                type="button"
                disabled={state.draft.outcomes.length >= MAX_PROJECT_OUTCOME_COUNT}
                onClick={() => {
                controller.addOutcome()
                }}
              >
                {t('projects.form.outcome.add')}
              </button>
              {state.draft.outcomes.length >= MAX_PROJECT_OUTCOME_COUNT && (
                <p className={css.limitHint} role="status">
                  {t('projects.form.outcomes.limit')}
                </p>
              )}
            </fieldset>

            <fieldset className={css.fieldset} disabled={state.pending}>
              <legend>{t('projects.form.supporting.legend')}</legend>
              <p className={css.fieldsetHint}>{t('projects.form.supporting.hint')}</p>
              {state.start.projects.length === 0 && state.draft.supportingGoals.length === 0 ? (
                <p className={css.emptyInline}>{t('projects.form.supporting.empty')}</p>
              ) : (
                <div className={css.goalChoices}>
                  {state.start.projects.map(project => (
                    <SupportingGoalChoice
                      key={project.primaryGoal.goalId}
                      project={project}
                      checked={selectedGoalIds.has(project.primaryGoal.goalId)}
                      disabled={state.pending || (
                        state.draft.supportingGoals.length >= MAX_PROJECT_SUPPORTING_GOAL_COUNT
                        && !selectedGoalIds.has(project.primaryGoal.goalId)
                      )}
                      controller={controller}
                      t={t}
                    />
                  ))}
                  {state.draft.supportingGoals
                    .filter(goal => !loadedGoalIds.has(goal.goalId))
                    .map(goal => (
                      <label key={goal.goalId} className={css.goalChoice}>
                        <input
                          type="checkbox"
                          checked
                          disabled={state.pending}
                          onChange={() => { controller.removeSupportingGoal(goal.goalId) }}
                        />
                        <span>
                          <strong>{goal.goalName}</strong>
                          <small>{goal.projectName} · {t('projects.meta.revision')} {goal.expectedRevision}</small>
                        </span>
                      </label>
                    ))}
                </div>
              )}
              {state.draft.supportingGoals.length >= MAX_PROJECT_SUPPORTING_GOAL_COUNT && (
                <p className={css.limitHint} role="status">
                  {t('projects.form.supporting.limit')}
                </p>
              )}
            </fieldset>

            <div className={css.formActions}>
              <Button
                variant="ghost"
                type="button"
                disabled={state.pending || !state.draftDirty}
                onClick={() => { controller.resetDraft() }}
              >
                {t('projects.action.reset')}
              </Button>
              <Button variant="primary" type="submit" disabled={!controller.canCreate()}>
                {state.pending ? t('projects.action.creating') : t('projects.action.create')}
              </Button>
            </div>
          </form>

          <section className={css.catalog} aria-labelledby="workbench-project-catalog-title">
            <div className={css.sectionHeader}>
              <div>
                <h3 id="workbench-project-catalog-title">{t('projects.catalog.title')}</h3>
                <p>{t('projects.catalog.subtitle')}</p>
              </div>
              <span className={css.revisionBadge}>
                {t('projects.catalog.revision')} {state.start.catalogRevision}
              </span>
            </div>
            {state.start.projects.length === 0 ? (
              <p className={css.emptyBlock}>{t('projects.catalog.empty')}</p>
            ) : (
              <ul className={css.projectList}>
                {state.start.projects.map(project => (
                  <ProjectCard
                    key={project.projectId}
                    project={project}
                    opening={state.openingProjectId === project.projectId}
                    disabled={state.pending || state.openingProjectId !== null}
                    onOpen={() => { void controller.openProject(project.projectId) }}
                    t={t}
                  />
                ))}
              </ul>
            )}
            <p className={css.visuallyHidden} role="status" aria-live="polite">
              {paginationAnnouncement}
            </p>
            {state.start.nextBeforeSequence !== null && (
              <div className={css.pagination}>
                <button
                  className={css.secondaryButton}
                  type="button"
                  disabled={state.loadingMore}
                  onClick={() => { void loadMore() }}
                >
                  {state.loadingMore
                    ? t('projects.catalog.loadingOlder')
                    : t('projects.catalog.loadOlder')}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {state.detail !== null && (
        <ProjectDetail detail={state.detail} titleRef={detailTitle} t={t} />
      )}
    </section>
  )
}

function ProjectIssue({
  issue,
  controller,
  t,
}: {
  readonly issue: WorkbenchProjectIssue | null
  readonly controller: WorkbenchProjectController
  readonly t: (key: WorkbenchKey) => string
}) {
  const conflict = issue?.kind === 'conflict'
  const title = conflict
    ? t(`projects.conflict.${issue.code}.title`)
    : issue?.kind === 'input'
      ? t('projects.error.input.title')
      : t('projects.error.transport.title')
  const body = conflict
    ? t(`projects.conflict.${issue.code}.body`)
    : issue?.kind === 'input'
      ? issue.code === 'project-not-found'
        ? t('projects.error.notFound.body')
        : t('projects.error.input.body')
      : t('projects.error.transport.body')
  return (
    <div className={conflict ? css.conflict : css.error} role="alert">
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <button className={css.secondaryButton} type="button" onClick={() => {
        void controller.refresh()
      }}>
        {t('projects.action.refresh')}
      </button>
    </div>
  )
}

function SupportingGoalChoice({
  project,
  checked,
  disabled,
  controller,
  t,
}: {
  readonly project: ProjectSummaryProjection
  readonly checked: boolean
  readonly disabled: boolean
  readonly controller: WorkbenchProjectController
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <label className={css.goalChoice}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => { controller.setSupportingGoal(project, event.currentTarget.checked) }}
      />
      <span>
        <strong>{project.primaryGoal.name}</strong>
        <small>{project.name} · {t('projects.meta.revision')} {project.primaryGoal.revision}</small>
      </span>
    </label>
  )
}

function ProjectCard({
  project,
  opening,
  disabled,
  onOpen,
  t,
}: {
  readonly project: ProjectSummaryProjection
  readonly opening: boolean
  readonly disabled: boolean
  readonly onOpen: () => void
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <li className={css.projectCard}>
      <div>
        <h4>{project.name}</h4>
        <p>{t('projects.detail.primaryGoal')}: {project.primaryGoal.name}</p>
        <dl className={css.compactMeta}>
          <div><dt>{t('projects.meta.revision')}</dt><dd>{project.revision}</dd></div>
          <div><dt>{t('projects.meta.timezone')}</dt><dd>{project.timezone}</dd></div>
          <div><dt>{t('projects.meta.created')}</dt><dd><time dateTime={project.createdAt}>{readableTimestamp(project.createdAt)}</time></dd></div>
        </dl>
      </div>
      <button className={css.secondaryButton} type="button" disabled={disabled} onClick={onOpen}>
        {opening ? t('projects.action.opening') : t('projects.action.open')}
      </button>
    </li>
  )
}

function ProjectDetail({
  detail,
  titleRef,
  t,
}: {
  readonly detail: ProjectDetailProjection
  readonly titleRef: RefObject<HTMLHeadingElement>
  readonly t: (key: WorkbenchKey) => string
}) {
  const definition = detail.templateSnapshot.definition
  return (
    <article className={css.detail} aria-labelledby="workbench-project-detail-title">
      <header className={css.detailHeader}>
        <p className={css.kicker}>{t('projects.detail.kicker')}</p>
        <h3
          ref={titleRef}
          id="workbench-project-detail-title"
          className={css.detailTitle}
          tabIndex={-1}
        >
          {detail.project.name}
        </h3>
        <p>{t('projects.detail.reopened')}</p>
      </header>

      <dl className={css.detailMeta}>
        <div><dt>{t('projects.meta.revision')}</dt><dd>{detail.project.revision}</dd></div>
        <div><dt>{t('projects.meta.timezone')}</dt><dd>{detail.project.timezone}</dd></div>
        <div><dt>{t('projects.meta.created')}</dt><dd><time dateTime={detail.project.createdAt}>{readableTimestamp(detail.project.createdAt)}</time></dd></div>
      </dl>

      <section className={css.detailSection} aria-labelledby="workbench-primary-goal-title">
        <h4 id="workbench-primary-goal-title">{t('projects.detail.primaryGoal')}</h4>
        <p className={css.goalName}>{detail.primaryGoal.name}</p>
        <p className={css.caption}>{t('projects.meta.revision')} {detail.primaryGoal.revision}</p>
        <h5>{t('projects.detail.outcomes')}</h5>
        <ul className={css.detailOutcomes}>
          {detail.primaryGoal.outcomes.map(outcome => (
            <li key={outcome.outcomeId}>
              <strong>{outcome.name}</strong>
              <span>{outcome.metric.metricName}</span>
              <span>
                {outcome.metric.initialValue} → {outcome.metric.targetValue}{' '}
                {outcome.metric.unit} · {outcome.metric.direction === 'increase'
                  ? t('projects.form.outcome.increase')
                  : t('projects.form.outcome.decrease')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.detailSection} aria-labelledby="workbench-supporting-goals-title">
        <h4 id="workbench-supporting-goals-title">{t('projects.detail.supportingGoals')}</h4>
        {detail.supportingGoals.length === 0 ? (
          <p className={css.caption}>{t('projects.detail.supportingEmpty')}</p>
        ) : (
          <ul className={css.simpleList}>
            {detail.supportingGoals.map(goal => (
              <li key={goal.goalId}>{goal.name} · {t('projects.meta.revision')} {goal.revision}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={css.snapshot} aria-labelledby="workbench-project-snapshot-title">
        <div>
          <p className={css.templateEyebrow}>{t('projects.snapshot.eyebrow')}</p>
          <h4 id="workbench-project-snapshot-title">{t('projects.snapshot.title')}</h4>
          <p>{t('projects.snapshot.body')}</p>
        </div>
        <dl className={css.snapshotGrid}>
          <div><dt>{t('projects.snapshot.templateId')}</dt><dd>{definition.templateId}</dd></div>
          <div><dt>{t('projects.template.version')}</dt><dd>{definition.templateVersion}</dd></div>
          <div><dt>{t('projects.snapshot.kind')}</dt><dd>{definition.kind}</dd></div>
          <div><dt>{t('projects.snapshot.schema')}</dt><dd>{definition.snapshotSchemaVersion}</dd></div>
          <div><dt>{t('projects.template.timezone')}</dt><dd>{definition.defaults.projectTimezone}</dd></div>
          <div><dt>{t('projects.snapshot.minimumOutcomes')}</dt><dd>{definition.rules.minimumOutcomeCount}</dd></div>
          <div><dt>{t('projects.snapshot.metricRequired')}</dt><dd>{yesNo(definition.rules.outcomeMetricRequired, t)}</dd></div>
          <div><dt>{t('projects.snapshot.primaryRequired')}</dt><dd>{yesNo(definition.rules.primaryGoalRequired, t)}</dd></div>
          <div><dt>{t('projects.snapshot.supportingAllowed')}</dt><dd>{yesNo(definition.rules.supportingGoalsAllowed, t)}</dd></div>
          <div><dt>{t('projects.snapshot.captured')}</dt><dd><time dateTime={detail.templateSnapshot.capturedAt}>{readableTimestamp(detail.templateSnapshot.capturedAt)}</time></dd></div>
          <div className={css.wideMeta}><dt>{t('projects.template.digest')}</dt><dd><code>{detail.templateSnapshot.template.definitionDigest}</code></dd></div>
          <div className={css.wideMeta}><dt>{t('projects.snapshot.digest')}</dt><dd><code>{detail.templateSnapshot.snapshotDigest}</code></dd></div>
        </dl>
      </section>
    </article>
  )
}

function yesNo(value: boolean, t: (key: WorkbenchKey) => string): string {
  return value ? t('projects.value.yes') : t('projects.value.no')
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
