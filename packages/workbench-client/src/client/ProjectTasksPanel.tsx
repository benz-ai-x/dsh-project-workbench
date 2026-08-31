/** Accessible Project-scoped Feishu Task List binding, mirror, and editor. */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  ProjectTaskProjection,
  ProjectTaskWorkflowProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchFeishuConnectionController } from './feishu-connection-controller.ts'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_FEISHU_TASK_LIST_NAME_LENGTH,
  MAX_FEISHU_TASK_RESOURCE_ID_LENGTH,
  MAX_FEISHU_TASK_TEXT_LENGTH,
  type WorkbenchProjectTasksClientState,
  type WorkbenchProjectTasksController,
  type WorkbenchProjectTasksIssue,
} from './task-controller.ts'
import css from './ProjectTasksPanel.module.css'
import { ProjectTaskWorkflowPanel } from './ProjectTaskWorkflowPanel.tsx'

export interface ProjectTasksPanelProps {
  readonly controller: WorkbenchProjectTasksController
  readonly connectionController: WorkbenchFeishuConnectionController
  readonly t: (key: WorkbenchKey) => string
}

function phasePresentation(state: WorkbenchProjectTasksClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'tasks.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'tasks.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'tasks.status.loading' }
    case 'ready': return { dot: 'done', key: 'tasks.status.ready' }
    case 'stale': return { dot: 'warning', key: 'tasks.status.stale' }
    case 'error': return { dot: 'error', key: 'tasks.status.error' }
    case 'conflict': return { dot: 'warning', key: 'tasks.status.conflict' }
  }
}

export function ProjectTasksPanel({
  controller,
  connectionController,
  t,
}: ProjectTasksPanelProps) {
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
  const [candidateGuid, setCandidateGuid] = useState('')
  const [createName, setCreateName] = useState('')
  const [referenceGuid, setReferenceGuid] = useState('')
  const presentation = phasePresentation(state)
  const route = connection.center?.[kind] ?? null
  const routeReady = usableRoute(route)
  const discoveryCurrent = state.discovery !== null
    && connection.center !== null
    && state.discovery.kind === kind
    && state.discovery.connectionRevision === connection.center.revision
    && state.discovery.routeGeneration === route?.generation

  useEffect(() => {
    setCandidateGuid('')
  }, [state.discovery, kind])
  useEffect(() => {
    setReferenceGuid('')
  }, [state.selection?.projectId])

  const roots = useMemo(() => taskTree(state.projection?.tasks ?? []), [state.projection?.tasks])
  const binding = state.projection?.binding ?? null
  const discover = (): void => {
    if (connection.center === null || !routeReady || route === null
      || route.generation === null) return
    void controller.discover(kind, connection.center.revision, route.generation)
  }
  const bindExisting = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const candidate = state.discovery?.items.find(item => item.taskListGuid === candidateGuid)
    if (candidate !== undefined && discoveryCurrent) void controller.bindExisting(candidate)
  }
  const bindNew = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (discoveryCurrent && createName.trim() !== '') {
      void controller.createAndBind(createName)
    }
  }
  const reference = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (referenceGuid.trim() !== '') void controller.reference(referenceGuid)
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-project-tasks-title"
      aria-busy={state.phase === 'loading' || state.pendingOperation !== null}
      data-project-tasks-phase={state.phase}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('tasks.kicker')}</p>
          <h2 id="workbench-project-tasks-title" className={css.title}>{t('tasks.title')}</h2>
          <p className={css.subtitle}>{t('tasks.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.selection === null ? (
        <p className={css.notice}>{t('tasks.noProject')}</p>
      ) : (
        <>
          <dl className={css.meta}>
            <div><dt>{t('tasks.meta.project')}</dt><dd>{state.selection.projectName}</dd></div>
            <div><dt>{t('tasks.meta.revision')}</dt><dd>{state.projection?.revision ?? '—'}</dd></div>
            <div><dt>{t('tasks.meta.sync')}</dt><dd>{state.projection?.sync.state ?? '—'}</dd></div>
          </dl>

          {state.phase === 'loading' && state.projection === null && (
            <p className={css.notice} role="status">{t('tasks.loading')}</p>
          )}
          {state.phase === 'stale' && (
            <p className={css.warning} role="status">{t('tasks.stale')}</p>
          )}
          {state.issue !== null && (
            <TaskIssue issue={state.issue} state={state} controller={controller} t={t} />
          )}

          {state.projection !== null && binding === null && (
            <section className={css.binding} aria-labelledby="workbench-task-binding-title">
              <div className={css.sectionHeader}>
                <div>
                  <h3 id="workbench-task-binding-title">{t('tasks.binding.title')}</h3>
                  <p>{t('tasks.binding.body')}</p>
                </div>
              </div>
              <fieldset className={css.routePicker} disabled={state.pendingOperation !== null}>
                <legend>{t('tasks.binding.identity')}</legend>
                {(['bot', 'user'] as const).map(candidate => {
                  const candidateRoute = connection.center?.[candidate] ?? null
                  return (
                    <label key={candidate}>
                      <input
                        type="radio"
                        name="workbench-task-route"
                        checked={kind === candidate}
                        onChange={() => { setKind(candidate) }}
                      />
                      <span>{candidate === 'bot' ? t('tasks.identity.bot') : t('tasks.identity.user')}</span>
                      <small>{usableRoute(candidateRoute)
                        ? candidateRoute?.displayLabel ?? t('tasks.identity.verified')
                        : t('tasks.identity.unavailable')}</small>
                    </label>
                  )
                })}
              </fieldset>
              {!routeReady && <p className={css.warning}>{t('tasks.binding.routeRequired')}</p>}
              <div className={css.actions}>
                <Button
                  variant="outline"
                  type="button"
                  disabled={!routeReady || state.pendingOperation !== null}
                  onClick={discover}
                >
                  {state.pendingOperation === 'discover-lists'
                    ? t('tasks.binding.discovering')
                    : t('tasks.binding.discover')}
                </Button>
              </div>

              {state.discovery !== null && !discoveryCurrent && (
                <p className={css.warning}>{t('tasks.binding.discoveryStale')}</p>
              )}
              {state.discovery !== null && discoveryCurrent && (
                <div className={css.bindingForms}>
                  <form onSubmit={bindExisting}>
                    <label className={css.field}>
                      <span>{t('tasks.binding.existing')}</span>
                      <select
                        value={candidateGuid}
                        disabled={state.pendingOperation !== null}
                        onChange={event => { setCandidateGuid(event.currentTarget.value) }}
                      >
                        <option value="">{t('tasks.binding.choose')}</option>
                        {state.discovery.items.map(item => (
                          <option key={item.taskListGuid} value={item.taskListGuid}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                    {state.discovery.items.length === 0 && (
                      <p className={css.hint}>{t('tasks.binding.none')}</p>
                    )}
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={candidateGuid === '' || state.pendingOperation !== null}
                    >{t('tasks.binding.bind')}</Button>
                  </form>
                  <form onSubmit={bindNew}>
                    <label className={css.field}>
                      <span>{t('tasks.binding.create')}</span>
                      <input
                        value={createName}
                        maxLength={MAX_FEISHU_TASK_LIST_NAME_LENGTH}
                        disabled={state.pendingOperation !== null}
                        onChange={event => { setCreateName(event.currentTarget.value) }}
                      />
                    </label>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={createName.trim() === '' || state.pendingOperation !== null}
                    >{t('tasks.binding.createAndBind')}</Button>
                  </form>
                </div>
              )}
            </section>
          )}

          {state.projection !== null && binding !== null && (
            <>
              <section className={css.bindingSummary} aria-labelledby="workbench-task-list-title">
                <div>
                  <p className={css.kicker}>{t('tasks.binding.primary')}</p>
                  <h3 id="workbench-task-list-title">{binding.name}</h3>
                  <p>{binding.identity.kind === 'bot'
                    ? t('tasks.identity.bot')
                    : t('tasks.identity.user')} · {binding.identity.openId}</p>
                </div>
                <div className={css.actions}>
                  <CanonicalLink url={binding.canonicalUrl} label={t('tasks.openInFeishu')} />
                  <Button
                    variant="outline"
                    type="button"
                    disabled={state.pendingOperation !== null}
                    onClick={() => { void controller.reconcile() }}
                  >{state.pendingOperation === 'reconcile'
                    ? t('tasks.reconciling')
                    : t('tasks.reconcile')}</Button>
                </div>
              </section>

              <ProjectTaskWorkflowPanel controller={controller} state={state} t={t} />

              <form className={css.referenceForm} onSubmit={reference}>
                <label className={css.field}>
                  <span>{t('tasks.reference.label')}</span>
                  <input
                    value={referenceGuid}
                    maxLength={MAX_FEISHU_TASK_RESOURCE_ID_LENGTH}
                    disabled={state.pendingOperation !== null}
                    placeholder={t('tasks.reference.placeholder')}
                    onChange={event => { setReferenceGuid(event.currentTarget.value) }}
                  />
                </label>
                <Button
                  variant="outline"
                  type="submit"
                  disabled={referenceGuid.trim() === '' || state.pendingOperation !== null}
                >{t('tasks.reference.action')}</Button>
                <p className={css.hint}>{t('tasks.reference.hint')}</p>
              </form>

              {state.projection.effects.some(effect => effect.state !== 'delivered') && (
                <aside className={css.effects} aria-label={t('tasks.effects.title')}>
                  <strong>{t('tasks.effects.title')}</strong>
                  <ul>
                    {state.projection.effects.filter(effect => effect.state !== 'delivered').map(effect => (
                      <li key={effect.effectId}>
                        <code>{effect.taskGuid}</code> · {effect.state}
                      </li>
                    ))}
                  </ul>
                  <p>{t('tasks.effects.unknownHint')}</p>
                </aside>
              )}

              <section className={css.taskSection} aria-labelledby="workbench-task-tree-title">
                <div className={css.sectionHeader}>
                  <div>
                    <h3 id="workbench-task-tree-title">{t('tasks.list.title')}</h3>
                    <p>{t('tasks.list.body')}</p>
                  </div>
                  <span>{state.projection.tasks.length} {t('tasks.list.count')}</span>
                </div>
                {roots.length === 0 ? (
                  <p className={css.notice}>{t('tasks.empty')}</p>
                ) : (
                  <TaskTree
                    nodes={roots}
                    controller={controller}
                    pendingTaskGuid={state.pendingTaskGuid}
                    workflow={state.projection.workflow}
                    t={t}
                  />
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

interface TaskNode {
  readonly task: ProjectTaskProjection
  readonly children: readonly TaskNode[]
}

function TaskTree({
  nodes,
  controller,
  pendingTaskGuid,
  workflow,
  t,
}: {
  readonly nodes: readonly TaskNode[]
  readonly controller: WorkbenchProjectTasksController
  readonly pendingTaskGuid: string | null
  readonly workflow: ProjectTaskWorkflowProjection | null
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <ul className={css.taskTree}>
      {nodes.map(node => (
        <li key={node.task.taskGuid}>
          <TaskCard
            task={node.task}
            controller={controller}
            pending={pendingTaskGuid === node.task.taskGuid}
            workflow={workflow}
            t={t}
          />
          {node.children.length > 0 && (
            <TaskTree
              nodes={node.children}
              controller={controller}
              pendingTaskGuid={pendingTaskGuid}
              workflow={workflow}
              t={t}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function TaskCard({
  task,
  controller,
  pending,
  workflow,
  t,
}: {
  readonly task: ProjectTaskProjection
  readonly controller: WorkbenchProjectTasksController
  readonly pending: boolean
  readonly workflow: ProjectTaskWorkflowProjection | null
  readonly t: (key: WorkbenchKey) => string
}) {
  const [summary, setSummary] = useState(task.summary)
  const [description, setDescription] = useState(task.description)
  const workflowValue = workflow?.values.find(candidate => candidate.taskGuid === task.taskGuid) ?? null
  const suggestion = workflow?.completionSuggestions.find(
    candidate => candidate.taskGuid === task.taskGuid,
  ) ?? null
  const transitions = controller.allowedWorkflowTransitions(task.taskGuid)
  useEffect(() => {
    setSummary(task.summary)
    setDescription(task.description)
  }, [task.remoteVersion, task.summary, task.description])
  const dirty = summary.trim() !== task.summary || description.trim() !== task.description
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (dirty) void controller.update(task, { summary, description })
  }
  return (
    <article className={css.taskCard} data-task-scope={task.scope}>
      <header className={css.taskHeader}>
        <div>
          <p className={css.kicker}>{task.scope === 'primary-list'
            ? t('tasks.scope.primary')
            : t('tasks.scope.reference')}</p>
          <h4>{task.summary}</h4>
        </div>
        <span className={task.completed ? css.complete : css.open}>
          {task.completed ? t('tasks.completed') : t('tasks.open')}
        </span>
      </header>
      <dl className={css.taskMeta}>
        <div><dt>{t('tasks.assignees')}</dt><dd>{memberNames(task.assignees, t)}</dd></div>
        <div><dt>{t('tasks.followers')}</dt><dd>{memberNames(task.followers, t)}</dd></div>
        <div><dt>{t('tasks.remoteVersion')}</dt><dd><code>{task.remoteVersion}</code></dd></div>
      </dl>
      {workflow !== null && (
        <div className={css.workflowTaskState}>
          <div>
            <span>{t('tasks.workflow.taskState')}</span>
            <strong>{workflowValue?.stateName
              ?? workflowValue?.stateId
              ?? t('tasks.workflow.taskStateUnset')}</strong>
          </div>
          {workflowValue?.recognized === false ? (
            <p className={css.warning} role="alert">{t('tasks.workflow.taskStateUnrecognized')}</p>
          ) : (
            <label className={css.field}>
              <span>{t('tasks.workflow.nextState')}</span>
              <select
                aria-label={`${t('tasks.workflow.nextState')} · ${task.summary}`}
                value=""
                disabled={pending || transitions.length === 0}
                onChange={event => {
                  if (event.currentTarget.value !== '') {
                    void controller.update(task, { workflowStateId: event.currentTarget.value })
                  }
                }}
              >
                <option value="">{transitions.length === 0
                  ? t('tasks.workflow.noTransition')
                  : t('tasks.workflow.chooseTransition')}</option>
                {transitions.map(transition => (
                  <option key={transition.stateId} value={transition.stateId}>
                    {transition.name}{transition.terminal ? ` · ${t('tasks.workflow.terminal')}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {suggestion !== null && !task.completed && (
        <aside className={css.completionSuggestion} aria-label={t('tasks.workflow.completionSuggested')}>
          <div>
            <strong>{t('tasks.workflow.completionSuggested')}</strong>
            <p>{t('tasks.workflow.completionSuggestedHint')}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={pending}
            onClick={() => { void controller.update(task, { completed: true }) }}
          >{t('tasks.workflow.confirmCompletion')}</Button>
        </aside>
      )}
      <div className={css.actions}>
        <CanonicalLink url={task.canonicalUrl} label={t('tasks.openInFeishu')} />
        {(suggestion === null || task.completed) && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={pending}
            onClick={() => { void controller.update(task, { completed: !task.completed }) }}
          >{task.completed ? t('tasks.markOpen') : t('tasks.markComplete')}</Button>
        )}
      </div>
      <details className={css.editor}>
        <summary>{t('tasks.edit')}</summary>
        <form aria-busy={pending} onSubmit={submit}>
          <label className={css.field}>
            <span>{t('tasks.summary')}</span>
            <input
              value={summary}
              required
              maxLength={MAX_FEISHU_TASK_TEXT_LENGTH}
              disabled={pending}
              onChange={event => { setSummary(event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('tasks.description')}</span>
            <textarea
              value={description}
              maxLength={MAX_FEISHU_TASK_TEXT_LENGTH}
              disabled={pending}
              onChange={event => { setDescription(event.currentTarget.value) }}
            />
          </label>
          <Button variant="primary" size="sm" type="submit" disabled={!dirty || pending}>
            {pending ? t('tasks.saving') : t('tasks.save')}
          </Button>
        </form>
      </details>
      <details className={css.comments}>
        <summary>{t('tasks.comments')} ({task.comments.length})</summary>
        {task.comments.length === 0 ? <p>{t('tasks.comments.empty')}</p> : (
          <ol>
            {task.comments.map(comment => (
              <li key={comment.commentId}>
                <strong>{comment.creator?.name ?? comment.creator?.openId ?? t('tasks.member.unknown')}</strong>
                <p>{comment.content}</p>
                <time dateTime={comment.updatedAt}>{readableTimestamp(comment.updatedAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </details>
    </article>
  )
}

function TaskIssue({
  issue,
  state,
  controller,
  t,
}: {
  readonly issue: WorkbenchProjectTasksIssue
  readonly state: WorkbenchProjectTasksClientState
  readonly controller: WorkbenchProjectTasksController
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <div className={issue.kind === 'conflict' ? css.conflict : css.error} role="alert">
      <div>
        <strong>{issue.kind === 'conflict' ? t('tasks.conflict.title') : t('tasks.error.title')}</strong>
        <p>{t(issueMessageKey(issue))}</p>
      </div>
      <div className={css.actions}>
        {state.canRetryMutation && (
          <Button variant="outline" size="sm" type="button" onClick={() => { void controller.retryMutation() }}>
            {t('tasks.retryExact')}
          </Button>
        )}
        <Button variant="outline" size="sm" type="button" onClick={() => { void controller.refresh() }}>
          {t('tasks.refresh')}
        </Button>
      </div>
    </div>
  )
}

function issueMessageKey(issue: WorkbenchProjectTasksIssue): WorkbenchKey {
  if (issue.kind === 'transport') {
    if (issue.code === 'unauthorized' || issue.code === 'forbidden') return 'tasks.error.permission'
    if (issue.code === 'rate-limited') return 'tasks.error.rateLimited'
    return 'tasks.error.transport'
  }
  if (issue.kind === 'input') {
    return issue.code === 'project-not-found' ? 'tasks.error.projectNotFound' : 'tasks.error.badRequest'
  }
  if (issue.code === 'remote-outcome-unknown') return 'tasks.error.unknown'
  if (issue.code === 'remote-version-conflict') return 'tasks.error.remoteVersion'
  if (issue.code === 'task-projection-revision-conflict') return 'tasks.error.projectionRevision'
  if (issue.code === 'workflow-revision-conflict') return 'tasks.error.workflowRevision'
  if (issue.code === 'workflow-transition-forbidden') return 'tasks.error.workflowTransition'
  if (issue.code === 'workflow-unconfigured' || issue.code === 'workflow-state-unmapped'
    || issue.code === 'workflow-value-unrecognized') return 'tasks.error.workflowMapping'
  if (issue.code === 'workflow-compatibility-blocked') return 'tasks.error.workflowCompatibility'
  if (issue.code === 'route-unverified' || issue.code === 'route-unconfigured'
    || issue.code === 'route-disabled') return 'tasks.error.route'
  return 'tasks.error.domain'
}

function usableRoute(route: FeishuIdentityRouteProjection | null): boolean {
  return route?.state === 'configured'
    && route.generation !== null
    && route.actor !== null
    && route.lastVerification?.identity.state === 'verified'
}

function taskTree(tasks: readonly ProjectTaskProjection[]): readonly TaskNode[] {
  const byId = new Map(tasks.map(task => [task.taskGuid, task] as const))
  const children = new Map<string, ProjectTaskProjection[]>()
  const roots: ProjectTaskProjection[] = []
  for (const task of tasks) {
    if (task.parentTaskGuid === null || !byId.has(task.parentTaskGuid)) roots.push(task)
    else children.set(task.parentTaskGuid, [...(children.get(task.parentTaskGuid) ?? []), task])
  }
  const visited = new Set<string>()
  const build = (task: ProjectTaskProjection): TaskNode => {
    visited.add(task.taskGuid)
    return Object.freeze({
      task,
      children: Object.freeze((children.get(task.taskGuid) ?? [])
        .filter(child => !visited.has(child.taskGuid))
        .map(build)),
    })
  }
  const nodes = roots.map(build)
  for (const task of tasks) if (!visited.has(task.taskGuid)) nodes.push(build(task))
  return Object.freeze(nodes)
}

function memberNames(
  members: ProjectTaskProjection['assignees'],
  t: (key: WorkbenchKey) => string,
): string {
  return members.length === 0
    ? t('tasks.members.none')
    : members.map(member => member.name ?? member.openId).join(', ')
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

function readableTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
  } catch {
    return value
  }
}
