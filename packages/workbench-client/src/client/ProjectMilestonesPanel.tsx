/** Accessible Project Calendar binding and Feishu-authoritative Milestone workspace. */

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
  FeishuCalendarCandidateProjection,
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  ProjectCalendarSchedule,
  ProjectMilestoneProjection,
  ProjectScheduleChangeProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchFeishuConnectionController } from './feishu-connection-controller.ts'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_PROJECT_CALENDAR_DESCRIPTION_LENGTH,
  MAX_PROJECT_CALENDAR_SUMMARY_LENGTH,
  MAX_PROJECT_MILESTONE_DESCRIPTION_LENGTH,
  MAX_PROJECT_MILESTONE_NAME_LENGTH,
  validProjectCalendarSchedule,
  type WorkbenchProjectMilestonesClientState,
  type WorkbenchProjectMilestonesController,
  type WorkbenchProjectMilestonesIssue,
} from './milestone-controller.ts'
import css from './ProjectMilestonesPanel.module.css'

export interface ProjectMilestonesPanelProps {
  readonly controller: WorkbenchProjectMilestonesController
  readonly connectionController: WorkbenchFeishuConnectionController
  readonly t: (key: WorkbenchKey) => string
  /** Capability projection supplied by the authenticated shell. */
  readonly canManage?: boolean
}

interface ScheduleDraft {
  readonly kind: ProjectCalendarSchedule['kind']
  readonly startDate: string
  readonly endDate: string
  readonly startAt: string
  readonly endAt: string
  readonly timeZone: string
}

const EMPTY_SCHEDULE_DRAFT: ScheduleDraft = Object.freeze({
  kind: 'all-day',
  startDate: '',
  endDate: '',
  startAt: '',
  endAt: '',
  timeZone: 'Asia/Shanghai',
})

function phasePresentation(state: WorkbenchProjectMilestonesClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'milestones.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'milestones.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'milestones.status.loading' }
    case 'ready': return { dot: 'done', key: 'milestones.status.ready' }
    case 'stale': return { dot: 'warning', key: 'milestones.status.stale' }
    case 'error': return { dot: 'error', key: 'milestones.status.error' }
    case 'conflict': return { dot: 'warning', key: 'milestones.status.conflict' }
  }
}

export function ProjectMilestonesPanel({
  controller,
  connectionController,
  t,
  canManage = true,
}: ProjectMilestonesPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const connection = useSyncExternalStore(
    connectionController.subscribe,
    connectionController.getSnapshot,
    connectionController.getSnapshot,
  )
  const [kind, setKind] = useState<FeishuIdentityKind>('bot')
  const [calendarId, setCalendarId] = useState('')
  const [calendarSummary, setCalendarSummary] = useState('')
  const [calendarDescription, setCalendarDescription] = useState('')
  const [bindingConfirmed, setBindingConfirmed] = useState(false)
  const [eventMode, setEventMode] = useState<'existing-event' | 'create-event'>('existing-event')
  const [eventId, setEventId] = useState('')
  const [milestoneName, setMilestoneName] = useState('')
  const [milestoneDescription, setMilestoneDescription] = useState('')
  const [createSchedule, setCreateSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE_DRAFT)
  const milestoneRefs = useRef(new Map<string, HTMLElement>())
  const presentation = phasePresentation(state)
  const route = connection.center?.[kind] ?? null
  const routeReady = usableRoute(route)
  const projection = state.projection
  const binding = projection?.binding ?? null
  const calendarDiscoveryCurrent = state.calendarDiscovery !== null
    && connection.center !== null
    && state.calendarDiscovery.kind === kind
    && state.calendarDiscovery.connectionRevision === connection.center.revision
    && state.calendarDiscovery.routeGeneration === route?.generation
  const eventDiscoveryCurrent = state.eventDiscovery !== null
    && projection !== null
    && binding !== null
    && state.eventDiscovery.projectId === projection.projectId
    && state.eventDiscovery.revision === projection.revision
    && state.eventDiscovery.calendarId === binding.calendarId
  const pending = state.pendingOperation !== null

  useEffect(() => {
    setCalendarId('')
    setBindingConfirmed(false)
  }, [state.calendarDiscovery, kind])
  useEffect(() => {
    setEventId('')
  }, [state.eventDiscovery])
  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusMilestoneId === null) return
    milestoneRefs.current.get(state.focusMilestoneId)?.focus({ preventScroll: true })
  }, [state.focusEpoch, state.focusMilestoneId])
  useEffect(() => {
    setCalendarId('')
    setCalendarSummary('')
    setCalendarDescription('')
    setBindingConfirmed(false)
    setEventMode('existing-event')
    setEventId('')
    setMilestoneName('')
    setMilestoneDescription('')
    setCreateSchedule(EMPTY_SCHEDULE_DRAFT)
  }, [state.selection?.projectId])

  const discoverCalendars = (): void => {
    if (connection.center === null || !routeReady || route === null
      || route.generation === null) return
    void controller.discoverCalendars(kind, connection.center.revision, route.generation)
  }
  const bindExisting = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!bindingConfirmed || !calendarDiscoveryCurrent) return
    const candidate = state.calendarDiscovery?.items.find(item => item.calendarId === calendarId)
    if (candidate?.selectable === true) void controller.bindExisting(candidate)
  }
  const bindNew = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!bindingConfirmed || !calendarDiscoveryCurrent || calendarSummary.trim() === '') return
    void controller.createAndBind(calendarSummary, calendarDescription)
  }
  const createMilestone = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (milestoneName.trim() === '') return
    if (eventMode === 'existing-event') {
      if (!eventDiscoveryCurrent) return
      const candidate = state.eventDiscovery?.items.find(item => item.eventId === eventId)
      if (candidate?.selectable === true) {
        void controller.createFromExistingEvent(
          milestoneName,
          nullableText(milestoneDescription),
          candidate,
        )
      }
      return
    }
    const schedule = draftSchedule(createSchedule)
    if (schedule !== null) {
      void controller.createWithEvent(
        milestoneName,
        nullableText(milestoneDescription),
        schedule,
      )
    }
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-project-milestones-title"
      aria-busy={state.phase === 'loading' || pending}
      data-project-milestones-phase={state.phase}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('milestones.kicker')}</p>
          <h2 id="workbench-project-milestones-title" className={css.title}>
            {t('milestones.title')}
          </h2>
          <p className={css.subtitle}>{t('milestones.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {!canManage && <p className={css.readOnly}>{t('milestones.readOnly')}</p>}

      {state.selection === null ? (
        <p className={css.notice}>{t('milestones.noProject')}</p>
      ) : (
        <>
          <dl className={css.meta}>
            <div><dt>{t('milestones.meta.project')}</dt><dd>{state.selection.projectName}</dd></div>
            <div><dt>{t('milestones.meta.revision')}</dt><dd>{projection?.revision ?? '—'}</dd></div>
            <div>
              <dt>{t('milestones.meta.sync')}</dt>
              <dd>{projection === null ? '—' : t(syncStateKey(projection.sync.state))}</dd>
            </div>
          </dl>

          {state.phase === 'loading' && projection === null && (
            <p className={css.notice} role="status">{t('milestones.loading')}</p>
          )}
          {state.phase === 'stale' && (
            <p className={css.warning} role="status">{t('milestones.stale')}</p>
          )}
          {state.issue !== null && (
            <MilestoneIssue
              issue={state.issue}
              state={state}
              controller={controller}
              canManage={canManage}
              t={t}
            />
          )}

          {projection !== null && binding === null && canManage && (
            <section className={css.section} aria-labelledby="workbench-calendar-binding-title">
              <div className={css.sectionHeader}>
                <div>
                  <h3 id="workbench-calendar-binding-title">{t('milestones.binding.title')}</h3>
                  <p>{t('milestones.binding.body')}</p>
                </div>
              </div>
              <fieldset className={css.routePicker} disabled={pending}>
                <legend>{t('milestones.binding.identity')}</legend>
                {(['bot', 'user'] as const).map(candidate => {
                  const candidateRoute = connection.center?.[candidate] ?? null
                  return (
                    <label key={candidate}>
                      <input
                        type="radio"
                        name="workbench-calendar-route"
                        checked={kind === candidate}
                        onChange={() => { setKind(candidate) }}
                      />
                      <span>{candidate === 'bot'
                        ? t('milestones.identity.bot')
                        : t('milestones.identity.user')}</span>
                      <small>{usableRoute(candidateRoute)
                        ? candidateRoute?.displayLabel ?? t('milestones.identity.verified')
                        : t('milestones.identity.unavailable')}</small>
                    </label>
                  )
                })}
              </fieldset>
              {!routeReady && <p className={css.warning}>{t('milestones.binding.routeRequired')}</p>}
              <div className={css.actions}>
                <Button
                  variant="outline"
                  type="button"
                  disabled={!routeReady || pending}
                  onClick={discoverCalendars}
                >
                  {state.pendingOperation === 'discover-calendars'
                    ? t('milestones.binding.discovering')
                    : t('milestones.binding.discover')}
                </Button>
              </div>

              {state.calendarDiscovery !== null && !calendarDiscoveryCurrent && (
                <p className={css.warning}>{t('milestones.binding.discoveryStale')}</p>
              )}
              {state.calendarDiscovery !== null && calendarDiscoveryCurrent && (
                <>
                  <CalendarCandidateList items={state.calendarDiscovery.items} t={t} />
                  <label className={css.confirmation}>
                    <input
                      type="checkbox"
                      checked={bindingConfirmed}
                      disabled={pending}
                      onChange={event => { setBindingConfirmed(event.currentTarget.checked) }}
                    />
                    <span>{t('milestones.binding.confirm')}</span>
                  </label>
                  <div className={css.forms}>
                    <form onSubmit={bindExisting}>
                      <label className={css.field}>
                        <span>{t('milestones.binding.existing')}</span>
                        <select
                          value={calendarId}
                          disabled={pending}
                          onChange={event => { setCalendarId(event.currentTarget.value) }}
                        >
                          <option value="">{t('milestones.binding.choose')}</option>
                          {state.calendarDiscovery.items.map(item => (
                            <option
                              key={item.calendarId}
                              value={item.calendarId}
                              disabled={!item.selectable}
                            >{item.summary}</option>
                          ))}
                        </select>
                      </label>
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={!bindingConfirmed || calendarId === '' || pending}
                      >{t('milestones.binding.bind')}</Button>
                    </form>
                    <form onSubmit={bindNew}>
                      <label className={css.field}>
                        <span>{t('milestones.binding.create')}</span>
                        <input
                          value={calendarSummary}
                          maxLength={MAX_PROJECT_CALENDAR_SUMMARY_LENGTH}
                          disabled={pending}
                          onChange={event => { setCalendarSummary(event.currentTarget.value) }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('milestones.binding.description')}</span>
                        <textarea
                          value={calendarDescription}
                          maxLength={MAX_PROJECT_CALENDAR_DESCRIPTION_LENGTH}
                          disabled={pending}
                          onChange={event => { setCalendarDescription(event.currentTarget.value) }}
                        />
                      </label>
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={!bindingConfirmed || calendarSummary.trim() === '' || pending}
                      >{t('milestones.binding.createAndBind')}</Button>
                    </form>
                  </div>
                </>
              )}
            </section>
          )}

          {projection !== null && binding !== null && (
            <>
              <section className={css.bindingSummary} aria-labelledby="workbench-calendar-title">
                <div>
                  <p className={css.kicker}>{t('milestones.binding.primary')}</p>
                  <h3 id="workbench-calendar-title">{binding.summary}</h3>
                  <p>
                    {t(calendarTypeKey(binding.calendarType))} · {t(calendarRoleKey(binding.role))}
                    {' · '}{binding.identity.kind === 'bot'
                      ? t('milestones.identity.bot')
                      : t('milestones.identity.user')}
                  </p>
                </div>
                {canManage && (
                  <div className={css.actions}>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={pending}
                      onClick={() => { void controller.reconcile() }}
                    >{state.pendingOperation === 'reconcile'
                      ? t('milestones.reconciling')
                      : t('milestones.reconcile')}</Button>
                  </div>
                )}
              </section>

              {projection.sync.issue !== null && (
                <p className={css.warning} role="status">{t('milestones.sync.needsAttention')}</p>
              )}

              {projection.effects.some(effect => effect.state !== 'delivered') && (
                <section className={css.effects} aria-labelledby="workbench-calendar-effects-title">
                  <h3 id="workbench-calendar-effects-title">{t('milestones.effects.title')}</h3>
                  <ul>
                    {projection.effects.filter(effect => effect.state !== 'delivered').map(effect => (
                      <li key={effect.effectId}>
                        {t(effectOperationKey(effect.operation))} · {t(effectStateKey(effect.state))}
                      </li>
                    ))}
                  </ul>
                  {projection.effects.some(effect => effect.state === 'unknown') && (
                    <p>{t('milestones.effects.unknownHint')}</p>
                  )}
                </section>
              )}

              {canManage && (
                <section className={css.section} aria-labelledby="workbench-milestone-create-title">
                  <div className={css.sectionHeader}>
                    <div>
                      <h3 id="workbench-milestone-create-title">{t('milestones.create.title')}</h3>
                      <p>{t('milestones.create.body')}</p>
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={pending}
                      onClick={() => { void controller.discoverEvents() }}
                    >{state.pendingOperation === 'discover-events'
                      ? t('milestones.events.discovering')
                      : t('milestones.events.discover')}</Button>
                  </div>
                  {state.eventDiscovery !== null && !eventDiscoveryCurrent && (
                    <p className={css.warning}>{t('milestones.events.discoveryStale')}</p>
                  )}
                  <form className={css.createForm} onSubmit={createMilestone}>
                    <div className={css.formGrid}>
                      <label className={css.field}>
                        <span>{t('milestones.create.name')}</span>
                        <input
                          value={milestoneName}
                          maxLength={MAX_PROJECT_MILESTONE_NAME_LENGTH}
                          disabled={pending}
                          onChange={event => { setMilestoneName(event.currentTarget.value) }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('milestones.create.description')}</span>
                        <textarea
                          value={milestoneDescription}
                          maxLength={MAX_PROJECT_MILESTONE_DESCRIPTION_LENGTH}
                          disabled={pending}
                          onChange={event => { setMilestoneDescription(event.currentTarget.value) }}
                        />
                      </label>
                    </div>
                    <fieldset className={css.modePicker} disabled={pending}>
                      <legend>{t('milestones.create.eventMode')}</legend>
                      <label>
                        <input
                          type="radio"
                          name="workbench-milestone-event-mode"
                          checked={eventMode === 'existing-event'}
                          onChange={() => { setEventMode('existing-event') }}
                        />
                        <span>{t('milestones.create.existingEvent')}</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="workbench-milestone-event-mode"
                          checked={eventMode === 'create-event'}
                          onChange={() => { setEventMode('create-event') }}
                        />
                        <span>{t('milestones.create.newEvent')}</span>
                      </label>
                    </fieldset>
                    {eventMode === 'existing-event' ? (
                      <label className={css.field}>
                        <span>{t('milestones.create.event')}</span>
                        <select
                          value={eventId}
                          disabled={pending || !eventDiscoveryCurrent}
                          onChange={event => { setEventId(event.currentTarget.value) }}
                        >
                          <option value="">{t('milestones.create.chooseEvent')}</option>
                          {state.eventDiscovery?.items.map(item => (
                            <option key={item.eventId} value={item.eventId} disabled={!item.selectable}>
                              {item.summary}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <ScheduleFields
                        idPrefix="workbench-milestone-create"
                        value={createSchedule}
                        disabled={pending}
                        onChange={setCreateSchedule}
                        t={t}
                      />
                    )}
                    <div className={css.actions}>
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={pending
                          || milestoneName.trim() === ''
                          || (eventMode === 'existing-event'
                            ? !eventDiscoveryCurrent || eventId === ''
                            : draftSchedule(createSchedule) === null)}
                      >{eventMode === 'existing-event'
                        ? t('milestones.create.bindAction')
                        : t('milestones.create.createAction')}</Button>
                    </div>
                  </form>
                </section>
              )}

              <section className={css.section} aria-labelledby="workbench-milestone-list-title">
                <div className={css.sectionHeader}>
                  <div>
                    <h3 id="workbench-milestone-list-title">{t('milestones.list.title')}</h3>
                    <p>{t('milestones.list.body')}</p>
                  </div>
                  <span className={css.count}>{projection.milestones.length}</span>
                </div>
                {projection.milestones.length === 0 ? (
                  <p className={css.notice}>{t('milestones.empty')}</p>
                ) : (
                  <div className={css.milestoneList}>
                    {projection.milestones.map(item => (
                      <MilestoneCard
                        key={item.milestoneId}
                        milestone={item}
                        controller={controller}
                        pending={pending}
                        canManage={canManage}
                        cardRef={node => {
                          if (node === null) milestoneRefs.current.delete(item.milestoneId)
                          else milestoneRefs.current.set(item.milestoneId, node)
                        }}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className={css.section} aria-labelledby="workbench-schedule-changes-title">
                <div className={css.sectionHeader}>
                  <div>
                    <h3 id="workbench-schedule-changes-title">{t('milestones.changes.title')}</h3>
                    <p>{t('milestones.changes.body')}</p>
                  </div>
                </div>
                {projection.recentChanges.length === 0 ? (
                  <p className={css.notice}>{t('milestones.changes.empty')}</p>
                ) : (
                  <ol className={css.changeList}>
                    {projection.recentChanges.map(change => (
                      <ScheduleChange key={change.changeId} change={change} t={t} />
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

function CalendarCandidateList({
  items,
  t,
}: {
  readonly items: readonly FeishuCalendarCandidateProjection[]
  readonly t: (key: WorkbenchKey) => string
}) {
  if (items.length === 0) return <p className={css.notice}>{t('milestones.binding.none')}</p>
  return (
    <ul className={css.candidateList}>
      {items.map(item => (
        <li key={item.calendarId} data-selectable={item.selectable}>
          <div><strong>{item.summary}</strong>{item.description !== null && <p>{item.description}</p>}</div>
          <span>
            {t(calendarTypeKey(item.calendarType))} · {t(calendarRoleKey(item.role))}
            {!item.selectable && ` · ${t('milestones.binding.notWritable')}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function MilestoneCard({
  milestone,
  controller,
  pending,
  canManage,
  cardRef,
  t,
}: {
  readonly milestone: ProjectMilestoneProjection
  readonly controller: WorkbenchProjectMilestonesController
  readonly pending: boolean
  readonly canManage: boolean
  readonly cardRef: (node: HTMLElement | null) => void
  readonly t: (key: WorkbenchKey) => string
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraft(milestone.schedule))
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    setDraft(scheduleDraft(milestone.schedule))
    setConfirmed(false)
  }, [milestone.milestoneId, milestone.revision, milestone.remoteObservationVersion])
  const next = draftSchedule(draft)
  const changed = next !== null && !sameSchedule(next, milestone.schedule)
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (next !== null && changed && confirmed) void controller.updateDate(milestone, next)
  }
  return (
    <article
      ref={cardRef}
      className={css.milestoneCard}
      aria-label={milestone.name}
      tabIndex={-1}
    >
      <header className={css.milestoneHeader}>
        <div>
          <h4>{milestone.name}</h4>
          {milestone.description !== null && <p>{milestone.description}</p>}
        </div>
        <span className={css.health} data-sync-state={milestone.syncState}>
          {t(milestoneSyncKey(milestone.syncState))}
        </span>
      </header>
      <div className={css.authority}>
        <strong>{t('milestones.authoritativeDate')}</strong>
        <ScheduleValue value={milestone.schedule} t={t} />
      </div>
      <dl className={css.milestoneMeta}>
        <div><dt>{t('milestones.remoteStatus')}</dt><dd>{t(remoteStatusKey(milestone.remoteStatus))}</dd></div>
        <div><dt>{t('milestones.lastObserved')}</dt><dd>{readableTimestamp(milestone.lastObservedAt)}</dd></div>
        <div><dt>{t('milestones.milestoneRevision')}</dt><dd>{milestone.revision}</dd></div>
      </dl>
      <CanonicalLink
        url={milestone.eventAppLink}
        label={`${t('milestones.openPrefix')} ${milestone.name} ${t('milestones.openSuffix')}`}
      />
      {canManage && (
        <details className={css.editor}>
          <summary>{t('milestones.update.title')}</summary>
          <form onSubmit={submit}>
            <p className={css.hint}>{t('milestones.update.body')}</p>
            <ScheduleFields
              idPrefix={`workbench-milestone-${milestone.milestoneId}`}
              value={draft}
              disabled={pending}
              onChange={setDraft}
              t={t}
            />
            <label className={css.confirmation}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={pending}
                onChange={event => { setConfirmed(event.currentTarget.checked) }}
              />
              <span>{t('milestones.update.confirm')}</span>
            </label>
            <Button
              variant="primary"
              type="submit"
              disabled={pending || !confirmed || !changed}
            >{t('milestones.update.action')}</Button>
          </form>
        </details>
      )}
    </article>
  )
}

function ScheduleFields({
  idPrefix,
  value,
  disabled,
  onChange,
  t,
}: {
  readonly idPrefix: string
  readonly value: ScheduleDraft
  readonly disabled: boolean
  readonly onChange: (next: ScheduleDraft) => void
  readonly t: (key: WorkbenchKey) => string
}) {
  const update = (patch: Partial<ScheduleDraft>): void => { onChange(Object.freeze({ ...value, ...patch })) }
  const started = value.kind === 'all-day'
    ? value.startDate !== '' || value.endDate !== ''
    : value.startAt !== '' || value.endAt !== ''
  const invalid = started && draftSchedule(value) === null
  const hintId = `${idPrefix}-schedule-hint`
  const errorId = `${idPrefix}-schedule-error`
  return (
    <fieldset
      className={css.scheduleFields}
      disabled={disabled}
      aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
    >
      <legend>{t('milestones.schedule.legend')}</legend>
      <div className={css.modePicker}>
        <label>
          <input
            type="radio"
            name={`${idPrefix}-schedule-kind`}
            checked={value.kind === 'all-day'}
            onChange={() => { update({ kind: 'all-day' }) }}
          />
          <span>{t('milestones.schedule.allDay')}</span>
        </label>
        <label>
          <input
            type="radio"
            name={`${idPrefix}-schedule-kind`}
            checked={value.kind === 'timed'}
            onChange={() => { update({ kind: 'timed' }) }}
          />
          <span>{t('milestones.schedule.timed')}</span>
        </label>
      </div>
      {value.kind === 'all-day' ? (
        <div className={css.scheduleGrid}>
          <label className={css.field} htmlFor={`${idPrefix}-start-date`}>
            <span>{t('milestones.schedule.startDate')}</span>
            <input
              id={`${idPrefix}-start-date`}
              type="date"
              value={value.startDate}
              aria-invalid={invalid}
              onChange={event => { update({ startDate: event.currentTarget.value }) }}
            />
          </label>
          <label className={css.field} htmlFor={`${idPrefix}-end-date`}>
            <span>{t('milestones.schedule.endDate')}</span>
            <input
              id={`${idPrefix}-end-date`}
              type="date"
              value={value.endDate}
              aria-invalid={invalid}
              onChange={event => { update({ endDate: event.currentTarget.value }) }}
            />
          </label>
          <p id={hintId} className={css.hint}>{t('milestones.schedule.exclusiveHint')}</p>
          {invalid && (
            <p id={errorId} className={css.inlineError} role="status">
              {t('milestones.schedule.invalid')}
            </p>
          )}
        </div>
      ) : (
        <div className={css.scheduleGrid}>
          <label className={css.field} htmlFor={`${idPrefix}-start-at`}>
            <span>{t('milestones.schedule.startAt')}</span>
            <input
              id={`${idPrefix}-start-at`}
              type="text"
              spellCheck={false}
              placeholder="2026-09-10T09:00:00+08:00"
              value={value.startAt}
              aria-invalid={invalid}
              onChange={event => { update({ startAt: event.currentTarget.value }) }}
            />
          </label>
          <label className={css.field} htmlFor={`${idPrefix}-end-at`}>
            <span>{t('milestones.schedule.endAt')}</span>
            <input
              id={`${idPrefix}-end-at`}
              type="text"
              spellCheck={false}
              placeholder="2026-09-10T10:00:00+08:00"
              value={value.endAt}
              aria-invalid={invalid}
              onChange={event => { update({ endAt: event.currentTarget.value }) }}
            />
          </label>
          <label className={css.field} htmlFor={`${idPrefix}-timezone`}>
            <span>{t('milestones.schedule.timeZone')}</span>
            <input
              id={`${idPrefix}-timezone`}
              type="text"
              spellCheck={false}
              placeholder="Asia/Shanghai"
              value={value.timeZone}
              aria-invalid={invalid}
              onChange={event => { update({ timeZone: event.currentTarget.value }) }}
            />
          </label>
          <p id={hintId} className={css.hint}>{t('milestones.schedule.timedHint')}</p>
          {invalid && (
            <p id={errorId} className={css.inlineError} role="status">
              {t('milestones.schedule.invalid')}
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}

function ScheduleValue({
  value,
  t,
}: {
  readonly value: ProjectCalendarSchedule
  readonly t: (key: WorkbenchKey) => string
}) {
  if (value.kind === 'all-day') {
    return (
      <span className={css.scheduleValue}>
        <time dateTime={value.startDate}>{readableDate(value.startDate)}</time>
        <span aria-hidden="true"> → </span>
        <time dateTime={value.endDate}>{readableDate(value.endDate)}</time>
        <small>{t('milestones.schedule.exclusiveDisplay')}</small>
      </span>
    )
  }
  return (
    <span className={css.scheduleValue}>
      <time dateTime={value.startAt}>{readableTimestamp(value.startAt, value.timeZone)}</time>
      <span aria-hidden="true"> → </span>
      <time dateTime={value.endAt}>{readableTimestamp(value.endAt, value.timeZone)}</time>
      <small>{value.timeZone}</small>
    </span>
  )
}

function ScheduleChange({
  change,
  t,
}: {
  readonly change: ProjectScheduleChangeProjection
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <li>
      <div className={css.changeHeader}>
        <strong>{change.source === 'feishu'
          ? t('milestones.changes.feishu')
          : t('milestones.changes.workbench')}</strong>
        <time dateTime={change.occurredAt}>{readableTimestamp(change.occurredAt)}</time>
      </div>
      <p>{change.changedFields.map(field => t(changeFieldKey(field))).join(', ')}</p>
      <div className={css.changeSchedules}>
        {change.beforeSchedule === null ? (
          <p>{t('milestones.changes.initial')}</p>
        ) : (
          <div>
            <strong>{t('milestones.changes.before')}</strong>
            <ScheduleValue value={change.beforeSchedule} t={t} />
          </div>
        )}
        <div>
          <strong>{t('milestones.changes.after')}</strong>
          <ScheduleValue value={change.afterSchedule} t={t} />
        </div>
      </div>
    </li>
  )
}

function MilestoneIssue({
  issue,
  state,
  controller,
  canManage,
  t,
}: {
  readonly issue: WorkbenchProjectMilestonesIssue
  readonly state: WorkbenchProjectMilestonesClientState
  readonly controller: WorkbenchProjectMilestonesController
  readonly canManage: boolean
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <div className={issue.kind === 'conflict' ? css.conflict : css.error} role="alert">
      <div>
        <strong>{issue.kind === 'conflict'
          ? t('milestones.conflict.title')
          : t('milestones.error.title')}</strong>
        <p>{t(issueMessageKey(issue))}</p>
      </div>
      {canManage && (
        <div className={css.actions}>
          {state.canRetryMutation && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => { void controller.retryMutation() }}
            >{t('milestones.retryExact')}</Button>
          )}
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => { void controller.refresh() }}
          >{t('milestones.refresh')}</Button>
        </div>
      )}
    </div>
  )
}

function issueMessageKey(issue: WorkbenchProjectMilestonesIssue): WorkbenchKey {
  if (issue.kind === 'transport') {
    if (issue.code === 'unauthorized' || issue.code === 'forbidden') {
      return 'milestones.error.permission'
    }
    if (issue.code === 'rate-limited') return 'milestones.error.rateLimited'
    return 'milestones.error.transport'
  }
  if (issue.kind === 'input') {
    return issue.code === 'project-not-found'
      ? 'milestones.error.projectNotFound'
      : 'milestones.error.badRequest'
  }
  if (issue.code === 'remote-outcome-unknown') return 'milestones.error.unknown'
  if (issue.code === 'remote-version-changed') return 'milestones.error.remoteVersion'
  if (issue.code === 'project-schedule-revision-conflict') return 'milestones.error.projectRevision'
  if (issue.code === 'milestone-revision-conflict') return 'milestones.error.milestoneRevision'
  if (issue.code === 'route-unverified' || issue.code === 'route-unconfigured'
    || issue.code === 'route-disabled') return 'milestones.error.route'
  if (issue.code === 'calendar-not-selectable' || issue.code === 'event-not-selectable') {
    return 'milestones.error.notSelectable'
  }
  return 'milestones.error.domain'
}

function draftSchedule(value: ScheduleDraft): ProjectCalendarSchedule | null {
  const schedule: ProjectCalendarSchedule = value.kind === 'all-day'
    ? { kind: 'all-day', startDate: value.startDate, endDate: value.endDate }
    : {
        kind: 'timed', startAt: value.startAt, endAt: value.endAt, timeZone: value.timeZone,
      }
  return validProjectCalendarSchedule(schedule) ? Object.freeze(schedule) : null
}

function scheduleDraft(value: ProjectCalendarSchedule): ScheduleDraft {
  return value.kind === 'all-day'
    ? Object.freeze({ ...EMPTY_SCHEDULE_DRAFT, kind: 'all-day', startDate: value.startDate, endDate: value.endDate })
    : Object.freeze({
        ...EMPTY_SCHEDULE_DRAFT,
        kind: 'timed',
        startAt: value.startAt,
        endAt: value.endAt,
        timeZone: value.timeZone,
      })
}

function sameSchedule(left: ProjectCalendarSchedule, right: ProjectCalendarSchedule): boolean {
  if (left.kind !== right.kind) return false
  return left.kind === 'all-day' && right.kind === 'all-day'
    ? left.startDate === right.startDate && left.endDate === right.endDate
    : left.kind === 'timed' && right.kind === 'timed'
      && left.startAt === right.startAt && left.endAt === right.endAt
      && left.timeZone === right.timeZone
}

function nullableText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function usableRoute(route: FeishuIdentityRouteProjection | null): boolean {
  return route?.state === 'configured'
    && route.generation !== null
    && route.actor !== null
    && route.lastVerification?.identity.state === 'verified'
}

function syncStateKey(value: 'unbound' | 'healthy' | 'attention' | 'unknown'): WorkbenchKey {
  if (value === 'unbound') return 'milestones.sync.unbound'
  if (value === 'healthy') return 'milestones.sync.healthy'
  if (value === 'attention') return 'milestones.sync.attention'
  return 'milestones.sync.unknown'
}

function milestoneSyncKey(value: 'healthy' | 'attention' | 'unknown'): WorkbenchKey {
  if (value === 'healthy') return 'milestones.sync.healthy'
  if (value === 'attention') return 'milestones.sync.attention'
  return 'milestones.sync.unknown'
}

function remoteStatusKey(value: 'confirmed' | 'cancelled' | 'unknown'): WorkbenchKey {
  if (value === 'confirmed') return 'milestones.remote.confirmed'
  if (value === 'cancelled') return 'milestones.remote.cancelled'
  return 'milestones.remote.unknown'
}

function calendarTypeKey(value: string): WorkbenchKey {
  if (value === 'primary') return 'milestones.calendar.primary'
  if (value === 'shared') return 'milestones.calendar.shared'
  if (value === 'resource') return 'milestones.calendar.resource'
  return 'milestones.calendar.unknown'
}

function calendarRoleKey(value: string): WorkbenchKey {
  if (value === 'owner') return 'milestones.role.owner'
  if (value === 'writer') return 'milestones.role.writer'
  if (value === 'reader') return 'milestones.role.reader'
  if (value === 'free_busy_reader') return 'milestones.role.freeBusyReader'
  return 'milestones.role.unknown'
}

function effectOperationKey(value: string): WorkbenchKey {
  if (value === 'calendar-create') return 'milestones.effect.calendarCreate'
  if (value === 'event-create') return 'milestones.effect.eventCreate'
  return 'milestones.effect.dateUpdate'
}

function effectStateKey(value: string): WorkbenchKey {
  if (value === 'prepared') return 'milestones.effect.prepared'
  if (value === 'delivered') return 'milestones.effect.delivered'
  if (value === 'failed') return 'milestones.effect.failed'
  if (value === 'conflict') return 'milestones.effect.conflict'
  return 'milestones.effect.unknown'
}

function changeFieldKey(value: string): WorkbenchKey {
  if (value === 'schedule') return 'milestones.change.schedule'
  if (value === 'remote-status') return 'milestones.change.remoteStatus'
  if (value === 'remote-eligibility') return 'milestones.change.remoteEligibility'
  return 'milestones.change.eventLink'
}

function CanonicalLink({ url, label }: { readonly url: string; readonly label: string }) {
  const href = safeHttpUrl(url)
  return href === null
    ? <span>{label}</span>
    : <a className={css.externalLink} href={href} target="_blank" rel="noreferrer noopener">{label}</a>
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

function readableDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.valueOf())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed)
  } catch {
    return value
  }
}

function readableTimestamp(value: string, timeZone?: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(parsed)
  } catch {
    return value
  }
}
