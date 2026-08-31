/** Accessible pure React view over the redacted Activity Client projection. */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import type {
  WorkbenchActivityFilter,
  WorkbenchActivityItem,
  WorkbenchOutboxState,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchActivityControllerFace } from './activity-controller.ts'
import css from './ActivityPanel.module.css'

export interface ActivityPanelCopy {
  readonly title: string
  readonly subtitle: string
  readonly filtersLegend: string
  readonly projectScopeLabel: string
  readonly projectAll: string
  readonly projectWorkspace: string
  readonly projectSpecific: string
  readonly projectIdLabel: string
  readonly objectTypeLabel: string
  readonly objectAll: string
  readonly objectStatus: string
  readonly objectProject: string
  readonly objectProjectMember: string
  readonly objectProjectResponsibility: string
  readonly objectSuggestedChange: string
  readonly objectFeishuConnection: string
  readonly objectIdLabel: string
  readonly actionLabel: string
  readonly actionAll: string
  readonly actionStatusUpdated: string
  readonly actionProjectCreated: string
  readonly actionProjectMemberCreated: string
  readonly actionProjectMemberStatusChanged: string
  readonly actionProjectResponsibilityAssigned: string
  readonly actionSuggestedChangeProposed: string
  readonly actionSuggestedChangeAccepted: string
  readonly actionSuggestedChangeEditedAccepted: string
  readonly actionSuggestedChangeRejected: string
  readonly actionSuggestedChangeDeferred: string
  readonly actionFeishuRouteConfigured: string
  readonly actionFeishuRouteReset: string
  readonly actionFeishuRouteDisabled: string
  readonly actionFeishuRouteVerificationRecorded: string
  readonly applyFilters: string
  readonly loading: string
  readonly stale: string
  readonly unavailableTitle: string
  readonly unavailableBody: string
  readonly invalidTitle: string
  readonly invalidBody: string
  readonly retry: string
  readonly loadMore: string
  readonly loadingMore: string
  readonly paginationLoaded: string
  readonly paginationComplete: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly integrityValid: string
  readonly integrityInvalid: string
  readonly integrityEvents: string
  readonly integrityHead: string
  readonly integrityEmptyHead: string
  readonly summaryStatusCommitted: string
  readonly summaryProjectCreated: string
  readonly summaryProjectMemberCreated: string
  readonly summaryProjectMemberStatusChanged: string
  readonly summaryProjectResponsibilityAssigned: string
  readonly summarySuggestedChangeProposed: string
  readonly summarySuggestedChangeAccepted: string
  readonly summarySuggestedChangeEditedAccepted: string
  readonly summarySuggestedChangeRejected: string
  readonly summarySuggestedChangeDeferred: string
  readonly summaryFeishuRouteConfigured: string
  readonly summaryFeishuRouteReset: string
  readonly summaryFeishuRouteDisabled: string
  readonly summaryFeishuVerificationHealthy: string
  readonly summaryFeishuVerificationAttention: string
  readonly summaryFeishuVerificationFailed: string
  readonly workspaceScope: string
  readonly projectPrefix: string
  readonly actorPrefix: string
  readonly objectPrefix: string
  readonly revisionPrefix: string
  readonly reasonPrefix: string
  readonly reasonOwnerStatusEdit: string
  readonly reasonOwnerProjectCreate: string
  readonly reasonOwnerProjectMemberAdd: string
  readonly reasonOwnerProjectMemberStatusChange: string
  readonly reasonOwnerProjectResponsibilitySet: string
  readonly reasonOwnerSuggestedChangePropose: string
  readonly reasonOwnerSuggestedChangeAccept: string
  readonly reasonOwnerSuggestedChangeEditAccept: string
  readonly reasonOwnerSuggestedChangeReject: string
  readonly reasonOwnerSuggestedChangeDefer: string
  readonly reasonOwnerFeishuRouteConfigure: string
  readonly reasonOwnerFeishuRouteReset: string
  readonly reasonOwnerFeishuRouteDisable: string
  readonly reasonOwnerFeishuRouteVerify: string
  readonly causationPrefix: string
  readonly outboxPrefix: string
  readonly attemptsPrefix: string
  readonly outboxPending: string
  readonly outboxDelivered: string
  readonly outboxUnknown: string
  readonly outboxFailed: string
}

/** Temporary typed English copy; the Owner-shell integration can supply locale-backed values. */
export const DEFAULT_ACTIVITY_PANEL_COPY: ActivityPanelCopy = Object.freeze({
  title: 'Activity',
  subtitle: 'Tamper-evident command history and redacted delivery status.',
  filtersLegend: 'Filter activity',
  projectScopeLabel: 'Project scope',
  projectAll: 'All visible activity',
  projectWorkspace: 'Workspace only',
  projectSpecific: 'Specific project',
  projectIdLabel: 'Project ID',
  objectTypeLabel: 'Object type',
  objectAll: 'All object types',
  objectStatus: 'Workbench status',
  objectProject: 'Project',
  objectProjectMember: 'ProjectMember',
  objectProjectResponsibility: 'Project Responsibility',
  objectSuggestedChange: 'SuggestedChange',
  objectFeishuConnection: 'Feishu connection',
  objectIdLabel: 'Object ID',
  actionLabel: 'Action',
  actionAll: 'All actions',
  actionStatusUpdated: 'Status updated',
  actionProjectCreated: 'Project created',
  actionProjectMemberCreated: 'ProjectMember created',
  actionProjectMemberStatusChanged: 'Member status changed',
  actionProjectResponsibilityAssigned: 'Project Responsibility assigned',
  actionSuggestedChangeProposed: 'SuggestedChange proposed',
  actionSuggestedChangeAccepted: 'SuggestedChange accepted',
  actionSuggestedChangeEditedAccepted: 'SuggestedChange edited and accepted',
  actionSuggestedChangeRejected: 'SuggestedChange rejected',
  actionSuggestedChangeDeferred: 'SuggestedChange deferred',
  actionFeishuRouteConfigured: 'Feishu route configured',
  actionFeishuRouteReset: 'Feishu route reset',
  actionFeishuRouteDisabled: 'Feishu route disabled',
  actionFeishuRouteVerificationRecorded: 'Feishu route verification recorded',
  applyFilters: 'Apply filters',
  loading: 'Loading activity…',
  stale: 'Activity may be out of date. Reconnect to refresh it.',
  unavailableTitle: 'Activity is unavailable',
  unavailableBody: 'The last safe page is retained. Try again after checking the connection.',
  invalidTitle: 'The activity filter is invalid',
  invalidBody: 'Use a valid bounded Project or object identifier and apply the filter again.',
  retry: 'Retry activity',
  loadMore: 'Load older activity',
  loadingMore: 'Loading older activity…',
  paginationLoaded: 'Loaded {count} older entries; {total} entries are now shown.',
  paginationComplete: 'All matching activity is loaded.',
  emptyTitle: 'No matching activity',
  emptyBody: 'Committed actions that match these filters will appear here.',
  integrityValid: 'Audit chain verified',
  integrityInvalid: 'Audit chain verification failed',
  integrityEvents: 'Events checked',
  integrityHead: 'Chain head',
  integrityEmptyHead: 'No audit head yet',
  summaryStatusCommitted: 'Status revision committed',
  summaryProjectCreated: 'Project created from template',
  summaryProjectMemberCreated: 'ProjectMember added',
  summaryProjectMemberStatusChanged: 'ProjectMember status changed',
  summaryProjectResponsibilityAssigned: 'Project Responsibility replaced',
  summarySuggestedChangeProposed: 'SuggestedChange proposed',
  summarySuggestedChangeAccepted: 'SuggestedChange accepted',
  summarySuggestedChangeEditedAccepted: 'SuggestedChange edited and accepted',
  summarySuggestedChangeRejected: 'SuggestedChange rejected',
  summarySuggestedChangeDeferred: 'SuggestedChange deferred',
  summaryFeishuRouteConfigured: 'Feishu route configured',
  summaryFeishuRouteReset: 'Feishu route identity reset',
  summaryFeishuRouteDisabled: 'Feishu route disabled',
  summaryFeishuVerificationHealthy: 'Feishu route verification healthy',
  summaryFeishuVerificationAttention: 'Feishu route verification needs attention',
  summaryFeishuVerificationFailed: 'Feishu route verification failed',
  workspaceScope: 'Workspace',
  projectPrefix: 'Project',
  actorPrefix: 'Actor',
  objectPrefix: 'Object',
  revisionPrefix: 'Revision',
  reasonPrefix: 'Reason',
  reasonOwnerStatusEdit: 'Owner status edit',
  reasonOwnerProjectCreate: 'Owner Project creation',
  reasonOwnerProjectMemberAdd: 'Owner ProjectMember addition',
  reasonOwnerProjectMemberStatusChange: 'Owner ProjectMember status change',
  reasonOwnerProjectResponsibilitySet: 'Owner Project Responsibility assignment',
  reasonOwnerSuggestedChangePropose: 'Owner SuggestedChange proposal',
  reasonOwnerSuggestedChangeAccept: 'Owner SuggestedChange acceptance',
  reasonOwnerSuggestedChangeEditAccept: 'Owner SuggestedChange edit and acceptance',
  reasonOwnerSuggestedChangeReject: 'Owner SuggestedChange rejection',
  reasonOwnerSuggestedChangeDefer: 'Owner SuggestedChange deferral',
  reasonOwnerFeishuRouteConfigure: 'Owner Feishu route configuration',
  reasonOwnerFeishuRouteReset: 'Owner Feishu identity reset',
  reasonOwnerFeishuRouteDisable: 'Owner Feishu route disable',
  reasonOwnerFeishuRouteVerify: 'Owner Feishu route verification',
  causationPrefix: 'Causation',
  outboxPrefix: 'Outbox',
  attemptsPrefix: 'Attempts',
  outboxPending: 'Pending',
  outboxDelivered: 'Delivered',
  outboxUnknown: 'Outcome unknown',
  outboxFailed: 'Failed',
})

export interface ActivityPanelProps {
  readonly controller: WorkbenchActivityControllerFace
  readonly copy?: ActivityPanelCopy
}

type ProjectScope = 'all' | 'workspace' | 'project'

function isActivityObjectType(
  value: string,
): value is NonNullable<WorkbenchActivityFilter['objectType']> {
  return value === 'workbench-status'
    || value === 'project'
    || value === 'project-member'
    || value === 'project-responsibility'
    || value === 'suggested-change'
    || value === 'feishu-connection'
}

function isActivityAction(
  value: string,
): value is NonNullable<WorkbenchActivityFilter['action']> {
  return value === 'workbench.status.updated'
    || value === 'workbench.project.created'
    || value === 'workbench.project-member.created'
    || value === 'workbench.project-member.status-changed'
    || value === 'workbench.project.responsibility-assigned'
    || value === 'workbench.suggested-change.proposed'
    || value === 'workbench.suggested-change.accepted'
    || value === 'workbench.suggested-change.edited-accepted'
    || value === 'workbench.suggested-change.rejected'
    || value === 'workbench.suggested-change.deferred'
    || value === 'workbench.feishu-route.configured'
    || value === 'workbench.feishu-route.reset'
    || value === 'workbench.feishu-route.disabled'
    || value === 'workbench.feishu-route.verification-recorded'
}

/** Render only allowlisted projection fields; no payload or raw error surface exists here. */
export function ActivityPanel({
  controller,
  copy = DEFAULT_ACTIVITY_PANEL_COPY,
}: ActivityPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [projectScope, setProjectScope] = useState<ProjectScope>(scopeOf(state.filter))
  const [projectId, setProjectId] = useState(projectIdOf(state.filter))
  const [objectType, setObjectType] = useState(state.filter.objectType ?? '')
  const [objectId, setObjectId] = useState(state.filter.objectId ?? '')
  const [action, setAction] = useState(state.filter.action ?? '')
  const [paginationAnnouncement, setPaginationAnnouncement] = useState('')
  const [paginationFocusRequest, setPaginationFocusRequest] = useState(0)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (paginationFocusRequest === 0) return
    titleRef.current?.focus({ preventScroll: true })
  }, [paginationFocusRequest])

  useEffect(() => {
    setProjectScope(scopeOf(state.filter))
    setProjectId(projectIdOf(state.filter))
    setObjectType(state.filter.objectType ?? '')
    setObjectId(state.filter.objectId ?? '')
    setAction(state.filter.action ?? '')
  }, [state.filter])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setPaginationAnnouncement('')
    const next: WorkbenchActivityFilter = {
      ...(projectScope === 'workspace'
        ? { projectId: null }
        : projectScope === 'project'
          ? { projectId: projectId.trim() }
          : {}),
      ...(isActivityObjectType(objectType) ? { objectType } : {}),
      ...(objectId.trim() === '' ? {} : { objectId: objectId.trim() }),
      ...(isActivityAction(action) ? { action } : {}),
    }
    void controller.setFilter(Object.freeze(next))
  }

  const items = state.activity?.items ?? []
  const isInitialLoading = state.phase === 'loading' && state.activity === null

  const loadMore = async (): Promise<void> => {
    const beforeCount = controller.getSnapshot().activity?.items.length ?? 0
    setPaginationAnnouncement('')
    try {
      await controller.loadMore()
    } catch {
      return
    }
    if (!mountedRef.current) return
    const accepted = controller.getSnapshot()
    if (accepted.phase !== 'ready' || accepted.loadingMore || accepted.activity === null) return
    const total = accepted.activity.items.length
    const added = Math.max(0, total - beforeCount)
    setPaginationAnnouncement(paginationMessage(copy, added, total, (
      accepted.activity.nextBeforeSequence === null
    )))
    if (accepted.activity.nextBeforeSequence === null) {
      setPaginationFocusRequest(current => current + 1)
    }
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-activity-title"
      aria-busy={isInitialLoading || state.loadingMore}
    >
      <header className={css.header}>
        <div>
          <h2
            ref={titleRef}
            id="workbench-activity-title"
            className={css.title}
            tabIndex={-1}
          >
            {copy.title}
          </h2>
          <p className={css.subtitle}>{copy.subtitle}</p>
        </div>
      </header>

      <form className={css.filters} onSubmit={submit}>
        <fieldset className={css.fieldset}>
          <legend className={css.legend}>{copy.filtersLegend}</legend>
          <div className={css.filterGrid}>
            <label className={css.field}>
              <span>{copy.projectScopeLabel}</span>
              <select
                value={projectScope}
                aria-label={copy.projectScopeLabel}
                onChange={event => { setProjectScope(event.currentTarget.value as ProjectScope) }}
              >
                <option value="all">{copy.projectAll}</option>
                <option value="workspace">{copy.projectWorkspace}</option>
                <option value="project">{copy.projectSpecific}</option>
              </select>
            </label>
            <label className={css.field}>
              <span>{copy.projectIdLabel}</span>
              <input
                value={projectId}
                aria-label={copy.projectIdLabel}
                disabled={projectScope !== 'project'}
                required={projectScope === 'project'}
                autoComplete="off"
                maxLength={128}
                onChange={event => { setProjectId(event.currentTarget.value) }}
              />
            </label>
            <label className={css.field}>
              <span>{copy.objectTypeLabel}</span>
              <select
                value={objectType}
                aria-label={copy.objectTypeLabel}
                onChange={event => { setObjectType(event.currentTarget.value) }}
              >
                <option value="">{copy.objectAll}</option>
                <option value="workbench-status">{copy.objectStatus}</option>
                <option value="project">{copy.objectProject}</option>
                <option value="project-member">{copy.objectProjectMember}</option>
                <option value="project-responsibility">{copy.objectProjectResponsibility}</option>
                <option value="suggested-change">{copy.objectSuggestedChange}</option>
                <option value="feishu-connection">{copy.objectFeishuConnection}</option>
              </select>
            </label>
            <label className={css.field}>
              <span>{copy.objectIdLabel}</span>
              <input
                value={objectId}
                aria-label={copy.objectIdLabel}
                autoComplete="off"
                maxLength={128}
                onChange={event => { setObjectId(event.currentTarget.value) }}
              />
            </label>
            <label className={css.field}>
              <span>{copy.actionLabel}</span>
              <select
                value={action}
                aria-label={copy.actionLabel}
                onChange={event => { setAction(event.currentTarget.value) }}
              >
                <option value="">{copy.actionAll}</option>
                <option value="workbench.status.updated">{copy.actionStatusUpdated}</option>
                <option value="workbench.project.created">{copy.actionProjectCreated}</option>
                <option value="workbench.project-member.created">
                  {copy.actionProjectMemberCreated}
                </option>
                <option value="workbench.project-member.status-changed">
                  {copy.actionProjectMemberStatusChanged}
                </option>
                <option value="workbench.project.responsibility-assigned">
                  {copy.actionProjectResponsibilityAssigned}
                </option>
                <option value="workbench.suggested-change.proposed">
                  {copy.actionSuggestedChangeProposed}
                </option>
                <option value="workbench.suggested-change.accepted">
                  {copy.actionSuggestedChangeAccepted}
                </option>
                <option value="workbench.suggested-change.edited-accepted">
                  {copy.actionSuggestedChangeEditedAccepted}
                </option>
                <option value="workbench.suggested-change.rejected">
                  {copy.actionSuggestedChangeRejected}
                </option>
                <option value="workbench.suggested-change.deferred">
                  {copy.actionSuggestedChangeDeferred}
                </option>
                <option value="workbench.feishu-route.configured">
                  {copy.actionFeishuRouteConfigured}
                </option>
                <option value="workbench.feishu-route.reset">{copy.actionFeishuRouteReset}</option>
                <option value="workbench.feishu-route.disabled">
                  {copy.actionFeishuRouteDisabled}
                </option>
                <option value="workbench.feishu-route.verification-recorded">
                  {copy.actionFeishuRouteVerificationRecorded}
                </option>
              </select>
            </label>
          </div>
          <div className={css.filterActions}>
            <button className={css.button} type="submit">{copy.applyFilters}</button>
          </div>
        </fieldset>
      </form>

      {state.integrity !== null && (
        <div
          className={state.integrity.valid ? css.integrityValid : css.integrityInvalid}
          role={state.integrity.valid ? 'status' : 'alert'}
        >
          <strong>
            {state.integrity.valid ? copy.integrityValid : copy.integrityInvalid}
          </strong>
          <span>{copy.integrityEvents}: {state.integrity.eventCount}</span>
          <span className={css.hash}>
            {copy.integrityHead}:{' '}
            {state.integrity.headHash === '' ? copy.integrityEmptyHead : (
              <code>{state.integrity.headHash}</code>
            )}
          </span>
        </div>
      )}

      {isInitialLoading && (
        <div className={css.notice} role="status">{copy.loading}</div>
      )}

      {state.phase === 'stale' && (
        <div className={css.stale} role="status">{copy.stale}</div>
      )}

      {state.phase === 'error' && (
        <div className={css.error} role="alert">
          <div>
            <strong>{state.issue?.kind === 'input' ? copy.invalidTitle : copy.unavailableTitle}</strong>
            <p>{state.issue?.kind === 'input' ? copy.invalidBody : copy.unavailableBody}</p>
          </div>
          {state.issue?.kind !== 'input' && (
            <button className={css.buttonSecondary} type="button" onClick={() => {
              void controller.refresh()
            }}>
              {copy.retry}
            </button>
          )}
        </div>
      )}

      {!isInitialLoading
        && state.phase !== 'error'
        && state.activity !== null
        && items.length === 0 && (
        <div className={css.empty}>
          <strong>{copy.emptyTitle}</strong>
          <span>{copy.emptyBody}</span>
        </div>
      )}

      {items.length > 0 && (
        <ol className={css.list} aria-label={copy.title}>
          {items.map(item => (
            <ActivityRow key={`${item.eventId}:${item.sequence}`} item={item} copy={copy} />
          ))}
        </ol>
      )}

      <p className={css.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {paginationAnnouncement}
      </p>

      {state.activity?.nextBeforeSequence !== null
        && state.activity?.nextBeforeSequence !== undefined && (
        <div className={css.pagination}>
          <button
            className={css.buttonSecondary}
            type="button"
            disabled={state.loadingMore}
            onClick={() => { void loadMore() }}
          >
            {state.loadingMore ? copy.loadingMore : copy.loadMore}
          </button>
        </div>
      )}
    </section>
  )
}

function ActivityRow({
  item,
  copy,
}: {
  readonly item: WorkbenchActivityItem
  readonly copy: ActivityPanelCopy
}) {
  return (
    <li className={css.item}>
      <article aria-labelledby={`workbench-activity-${item.sequence}`}>
        <div className={css.itemHeader}>
          <div>
            <h3 id={`workbench-activity-${item.sequence}`} className={css.itemTitle}>
              {summary(item, copy)}
            </h3>
            <time className={css.time} dateTime={item.occurredAt}>{item.occurredAt}</time>
          </div>
          <span
            className={css.outboxState}
            data-outbox-state={item.outbox.state}
          >
            {outboxLabel(item.outbox.state, copy)}
          </span>
        </div>
        <dl className={css.details}>
          <div>
            <dt>{item.projectId === null ? copy.workspaceScope : copy.projectPrefix}</dt>
            <dd>{item.projectId === null ? copy.workspaceScope : item.projectId}</dd>
          </div>
          <div>
            <dt>{copy.actorPrefix}</dt>
            <dd>{item.actor.id}</dd>
          </div>
          <div>
            <dt>{copy.objectPrefix}</dt>
            <dd>{item.object.type} · {item.object.id}</dd>
          </div>
          <div>
            <dt>{copy.revisionPrefix}</dt>
            <dd>{item.object.version}</dd>
          </div>
          <div>
            <dt>{copy.reasonPrefix}</dt>
            <dd>{reasonLabel(item, copy)}</dd>
          </div>
          <div>
            <dt>{copy.causationPrefix}</dt>
            <dd><code>{item.causationId}</code></dd>
          </div>
          <div>
            <dt>{copy.outboxPrefix}</dt>
            <dd><code>{item.outbox.id}</code></dd>
          </div>
          <div>
            <dt>{copy.attemptsPrefix}</dt>
            <dd>{item.outbox.attemptCount}</dd>
          </div>
        </dl>
      </article>
    </li>
  )
}

function scopeOf(filter: WorkbenchActivityFilter): ProjectScope {
  if (filter.projectId === null) return 'workspace'
  if (typeof filter.projectId === 'string') return 'project'
  return 'all'
}

function projectIdOf(filter: WorkbenchActivityFilter): string {
  return typeof filter.projectId === 'string' ? filter.projectId : ''
}

function summary(item: WorkbenchActivityItem, copy: ActivityPanelCopy): string {
  switch (item.summaryCode) {
    case 'status-revision-committed': return copy.summaryStatusCommitted
    case 'project-created-from-template': return copy.summaryProjectCreated
    case 'project-member-created': return copy.summaryProjectMemberCreated
    case 'project-member-status-changed': return copy.summaryProjectMemberStatusChanged
    case 'project-responsibility-assigned': return copy.summaryProjectResponsibilityAssigned
    case 'suggested-change-proposed': return copy.summarySuggestedChangeProposed
    case 'suggested-change-accepted': return copy.summarySuggestedChangeAccepted
    case 'suggested-change-edited-accepted': return copy.summarySuggestedChangeEditedAccepted
    case 'suggested-change-rejected': return copy.summarySuggestedChangeRejected
    case 'suggested-change-deferred': return copy.summarySuggestedChangeDeferred
    case 'feishu-route-configured': return copy.summaryFeishuRouteConfigured
    case 'feishu-route-reset': return copy.summaryFeishuRouteReset
    case 'feishu-route-disabled': return copy.summaryFeishuRouteDisabled
    case 'feishu-route-verification-healthy': return copy.summaryFeishuVerificationHealthy
    case 'feishu-route-verification-attention': return copy.summaryFeishuVerificationAttention
    case 'feishu-route-verification-failed': return copy.summaryFeishuVerificationFailed
  }
}

function reasonLabel(item: WorkbenchActivityItem, copy: ActivityPanelCopy): string {
  switch (item.reason) {
    case 'owner-status-edit': return copy.reasonOwnerStatusEdit
    case 'owner-project-create': return copy.reasonOwnerProjectCreate
    case 'owner-project-member-add': return copy.reasonOwnerProjectMemberAdd
    case 'owner-project-member-status-change': return copy.reasonOwnerProjectMemberStatusChange
    case 'owner-project-responsibility-set': return copy.reasonOwnerProjectResponsibilitySet
    case 'owner-suggested-change-propose': return copy.reasonOwnerSuggestedChangePropose
    case 'owner-suggested-change-accept': return copy.reasonOwnerSuggestedChangeAccept
    case 'owner-suggested-change-edit-accept': return copy.reasonOwnerSuggestedChangeEditAccept
    case 'owner-suggested-change-reject': return copy.reasonOwnerSuggestedChangeReject
    case 'owner-suggested-change-defer': return copy.reasonOwnerSuggestedChangeDefer
    case 'owner-feishu-route-configure': return copy.reasonOwnerFeishuRouteConfigure
    case 'owner-feishu-route-reset': return copy.reasonOwnerFeishuRouteReset
    case 'owner-feishu-route-disable': return copy.reasonOwnerFeishuRouteDisable
    case 'owner-feishu-route-verify': return copy.reasonOwnerFeishuRouteVerify
  }
}

function outboxLabel(state: WorkbenchOutboxState, copy: ActivityPanelCopy): string {
  const labels = {
    pending: copy.outboxPending,
    delivered: copy.outboxDelivered,
    unknown: copy.outboxUnknown,
    failed: copy.outboxFailed,
  } satisfies Record<WorkbenchOutboxState, string>
  return labels[state]
}

function paginationMessage(
  copy: ActivityPanelCopy,
  count: number,
  total: number,
  complete: boolean,
): string {
  const format = new Intl.NumberFormat()
  const loaded = copy.paginationLoaded
    .replace('{count}', format.format(count))
    .replace('{total}', format.format(total))
  return complete ? `${loaded} ${copy.paginationComplete}` : loaded
}
