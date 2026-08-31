/** Accessible editor for the Host-owned task workflow definition and Feishu mapping. */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConfigureFeishuTaskWorkflowMapping,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_FEISHU_WORKFLOW_COLOR_INDEX,
  MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH,
  MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH,
  MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH,
  MAX_PROJECT_TASK_WORKFLOW_STATES,
  MIN_FEISHU_WORKFLOW_COLOR_INDEX,
  type WorkbenchProjectTasksClientState,
  type WorkbenchProjectTasksController,
} from './task-controller.ts'
import css from './ProjectTasksPanel.module.css'

interface WorkflowStateDraft {
  readonly stateId: string
  readonly name: string
  readonly colorIndex: string
  readonly allowedNextStateIds: string
  readonly terminal: boolean
}

interface WorkflowDraft {
  readonly fieldName: string
  readonly initialStateId: string
  readonly mode: ConfigureFeishuTaskWorkflowMapping['mode']
  readonly fieldGuid: string
  readonly optionGuids: Readonly<Record<string, string>>
  readonly states: readonly WorkflowStateDraft[]
}

export interface ProjectTaskWorkflowPanelProps {
  readonly controller: WorkbenchProjectTasksController
  readonly state: WorkbenchProjectTasksClientState
  readonly t: (key: WorkbenchKey) => string
}

export function ProjectTaskWorkflowPanel({
  controller,
  state,
  t,
}: ProjectTaskWorkflowPanelProps) {
  const workflow = state.projection?.workflow ?? null
  const identity = `${state.selection?.projectId ?? ''}:${String(workflow?.revision ?? 'none')}`
  const [draft, setDraft] = useState<WorkflowDraft>(() => workflowDraft(workflow))

  useEffect(() => {
    setDraft(workflowDraft(workflow))
  }, [identity])

  const definition = useMemo(() => definitionFromDraft(draft), [draft])
  const mapping = useMemo(
    () => mappingFromDraft(draft, definition, state),
    [definition, draft, state.workflowDiscovery, state.projection?.revision],
  )
  const discoveryCurrent = state.workflowDiscovery !== null
    && state.projection?.binding !== null
    && state.workflowDiscovery.projectId === state.projection?.projectId
    && state.workflowDiscovery.taskListGuid === state.projection.binding.taskListGuid
    && state.workflowDiscovery.taskRevision === state.projection.revision
  const preview = state.workflowPreview
  const canConfigure = definition !== null && mapping !== null
    && controller.canConfigureWorkflow(definition, mapping)
  const field = discoveryCurrent
    ? state.workflowDiscovery?.items.find(candidate => candidate.fieldGuid === draft.fieldGuid) ?? null
    : null

  const update = (patch: Partial<WorkflowDraft>): void => {
    setDraft(current => Object.freeze({ ...current, ...patch }))
  }
  const updateState = (index: number, patch: Partial<WorkflowStateDraft>): void => {
    setDraft(current => Object.freeze({
      ...current,
      states: Object.freeze(current.states.map((candidate, candidateIndex) => (
        candidateIndex === index ? Object.freeze({ ...candidate, ...patch }) : candidate
      ))),
    }))
  }
  const removeState = (index: number): void => {
    if (draft.states.length <= 2) return
    setDraft(current => Object.freeze({
      ...current,
      states: Object.freeze(current.states.filter((_, candidateIndex) => candidateIndex !== index)),
    }))
  }
  const addState = (): void => {
    if (draft.states.length >= MAX_PROJECT_TASK_WORKFLOW_STATES) return
    const suffix = nextStateSuffix(draft.states)
    update({
      states: Object.freeze([...draft.states, Object.freeze({
        stateId: `state-${String(suffix)}`,
        name: `${t('tasks.workflow.newState')} ${String(suffix)}`,
        colorIndex: '1',
        allowedNextStateIds: '',
        terminal: false,
      })]),
    })
  }
  const previewWorkflow = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (definition !== null && mapping !== null) void controller.previewWorkflow(definition, mapping)
  }
  const configure = (): void => {
    if (definition !== null && mapping !== null) void controller.configureWorkflow(definition, mapping)
  }

  return (
    <section className={css.workflowSection} aria-labelledby="workbench-task-workflow-title">
      <div className={css.sectionHeader}>
        <div>
          <h3 id="workbench-task-workflow-title">{t('tasks.workflow.title')}</h3>
          <p>{t('tasks.workflow.body')}</p>
        </div>
        <span className={css.workflowState} data-workflow-compatibility={workflow?.compatibility.state ?? 'unconfigured'}>
          {workflow === null
            ? t('tasks.workflow.unconfigured')
            : t(workflowCompatibilityKey(workflow.compatibility.state))}
        </span>
      </div>

      {workflow !== null && (
        <div className={css.workflowSummary}>
          <dl className={css.taskMeta}>
            <div><dt>{t('tasks.workflow.field')}</dt><dd>{workflow.field.name}</dd></div>
            <div><dt>{t('tasks.workflow.revision')}</dt><dd>{workflow.revision}</dd></div>
            <div><dt>{t('tasks.workflow.initial')}</dt><dd>{workflow.definition.initialStateId}</dd></div>
          </dl>
          {workflow.compatibility.issues.length > 0 && (
            <CompatibilityIssues issues={workflow.compatibility.issues} t={t} />
          )}
        </div>
      )}

      <details className={css.workflowEditor} open={workflow === null ? true : undefined}>
        <summary>{workflow === null
          ? t('tasks.workflow.setup')
          : t('tasks.workflow.edit')}</summary>
        <form aria-busy={state.pendingOperation !== null} onSubmit={previewWorkflow}>
          <label className={css.field}>
            <span>{t('tasks.workflow.fieldName')}</span>
            <input
              value={draft.fieldName}
              maxLength={MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH}
              disabled={state.pendingOperation !== null}
              onChange={event => { update({ fieldName: event.currentTarget.value }) }}
            />
          </label>

          <fieldset className={css.routePicker} disabled={state.pendingOperation !== null}>
            <legend>{t('tasks.workflow.mappingMode')}</legend>
            <WorkflowMode
              value="create"
              checked={draft.mode === 'create'}
              label={t('tasks.workflow.mode.create')}
              hint={t('tasks.workflow.mode.createHint')}
              disabled={workflow !== null}
              onSelect={() => { update({ mode: 'create', fieldGuid: '', optionGuids: {} }) }}
            />
            <WorkflowMode
              value="existing"
              checked={draft.mode === 'existing'}
              label={t('tasks.workflow.mode.existing')}
              hint={t('tasks.workflow.mode.existingHint')}
              onSelect={() => { update({ mode: 'existing', fieldGuid: '', optionGuids: {} }) }}
            />
            <WorkflowMode
              value="migrate"
              checked={draft.mode === 'migrate'}
              label={t('tasks.workflow.mode.migrate')}
              hint={t('tasks.workflow.mode.migrateHint')}
              disabled={workflow === null}
              onSelect={() => { update({ mode: 'migrate', fieldGuid: '', optionGuids: {} }) }}
            />
          </fieldset>

          <div className={css.actions}>
            <Button
              variant="outline"
              type="button"
              disabled={state.pendingOperation !== null}
              onClick={() => { void controller.discoverWorkflowFields() }}
            >{state.pendingOperation === 'discover-workflow-fields'
              ? t('tasks.workflow.discovering')
              : t('tasks.workflow.discover')}</Button>
          </div>

          {draft.mode === 'existing' && (
            <div className={css.mappingFields}>
              {!discoveryCurrent && (
                <p className={css.warning}>{t('tasks.workflow.discoveryRequired')}</p>
              )}
              {discoveryCurrent && (
                <label className={css.field}>
                  <span>{t('tasks.workflow.existingField')}</span>
                  <select
                    value={draft.fieldGuid}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { update({
                      fieldGuid: event.currentTarget.value,
                      optionGuids: {},
                    }) }}
                  >
                    <option value="">{t('tasks.workflow.chooseField')}</option>
                    {state.workflowDiscovery?.items.map(candidate => (
                      <option
                        key={candidate.fieldGuid}
                        value={candidate.fieldGuid}
                        disabled={candidate.type !== 'single_select'}
                      >{candidate.name} · {candidate.type}</option>
                    ))}
                  </select>
                </label>
              )}
              {field !== null && definition !== null && definition.states.map(workflowState => (
                <label className={css.field} key={workflowState.stateId}>
                  <span>{workflowState.name} · {t('tasks.workflow.option')}</span>
                  <select
                    value={draft.optionGuids[workflowState.stateId] ?? ''}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { update({
                      optionGuids: Object.freeze({
                        ...draft.optionGuids,
                        [workflowState.stateId]: event.currentTarget.value,
                      }),
                    }) }}
                  >
                    <option value="">{t('tasks.workflow.chooseOption')}</option>
                    {field.options.map(option => (
                      <option key={option.optionGuid} value={option.optionGuid}>
                        {option.name}{option.hidden ? ` · ${t('tasks.workflow.hidden')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <fieldset className={css.workflowStates}>
            <legend>{t('tasks.workflow.states')}</legend>
            <p className={css.hint}>{t('tasks.workflow.statesHint')}</p>
            {draft.states.map((candidate, index) => (
              <fieldset className={css.workflowStateEditor} key={index}>
                <legend>{t('tasks.workflow.state')} {index + 1}</legend>
                <label className={css.field}>
                  <span>{t('tasks.workflow.stateId')}</span>
                  <input
                    value={candidate.stateId}
                    maxLength={MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { updateState(index, { stateId: event.currentTarget.value }) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('tasks.workflow.stateName')}</span>
                  <input
                    value={candidate.name}
                    maxLength={MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { updateState(index, { name: event.currentTarget.value }) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('tasks.workflow.color')}</span>
                  <input
                    type="number"
                    min={MIN_FEISHU_WORKFLOW_COLOR_INDEX}
                    max={MAX_FEISHU_WORKFLOW_COLOR_INDEX}
                    value={candidate.colorIndex}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { updateState(index, { colorIndex: event.currentTarget.value }) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('tasks.workflow.transitions')}</span>
                  <input
                    value={candidate.allowedNextStateIds}
                    disabled={candidate.terminal || state.pendingOperation !== null}
                    placeholder={t('tasks.workflow.transitionsPlaceholder')}
                    onChange={event => { updateState(index, {
                      allowedNextStateIds: event.currentTarget.value,
                    }) }}
                  />
                </label>
                <label className={css.checkboxField}>
                  <input
                    type="checkbox"
                    checked={candidate.terminal}
                    disabled={state.pendingOperation !== null}
                    onChange={event => { updateState(index, {
                      terminal: event.currentTarget.checked,
                      ...(event.currentTarget.checked ? { allowedNextStateIds: '' } : {}),
                    }) }}
                  />
                  <span>{t('tasks.workflow.terminal')}</span>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={draft.states.length <= 2 || state.pendingOperation !== null}
                  onClick={() => { removeState(index) }}
                >{t('tasks.workflow.removeState')}</Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              type="button"
              disabled={draft.states.length >= MAX_PROJECT_TASK_WORKFLOW_STATES
                || state.pendingOperation !== null}
              onClick={addState}
            >{t('tasks.workflow.addState')}</Button>
          </fieldset>

          <label className={css.field}>
            <span>{t('tasks.workflow.initialState')}</span>
            <select
              value={draft.initialStateId}
              disabled={state.pendingOperation !== null}
              onChange={event => { update({ initialStateId: event.currentTarget.value }) }}
            >
              <option value="">{t('tasks.workflow.chooseInitial')}</option>
              {draft.states.map(candidate => (
                <option key={candidate.stateId} value={candidate.stateId}>
                  {candidate.name || candidate.stateId}
                </option>
              ))}
            </select>
          </label>

          {definition === null && (
            <p className={css.warning} role="alert">{t('tasks.workflow.definitionInvalid')}</p>
          )}
          <div className={css.actions}>
            <Button
              variant="outline"
              type="submit"
              disabled={definition === null || mapping === null || state.pendingOperation !== null}
            >{state.pendingOperation === 'preview-workflow'
              ? t('tasks.workflow.previewing')
              : t('tasks.workflow.preview')}</Button>
            <Button
              variant="primary"
              type="button"
              disabled={!canConfigure || state.pendingOperation !== null}
              onClick={configure}
            >{state.pendingOperation === 'configure-workflow'
              ? t('tasks.workflow.configuring')
              : t('tasks.workflow.configure')}</Button>
          </div>
        </form>
      </details>

      {preview !== null && (
        <aside
          className={preview.compatibility.state === 'blocked' ? css.conflict : css.preview}
          role={preview.compatibility.state === 'blocked' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <strong>{t('tasks.workflow.previewResult')} · {t(workflowCompatibilityKey(
            preview.compatibility.state,
          ))}</strong>
          <p>{t('tasks.workflow.previewHint')}</p>
          {preview.usedStateIds.length > 0 && (
            <p>{t('tasks.workflow.usedStates')} <code>{preview.usedStateIds.join(', ')}</code></p>
          )}
          <CompatibilityIssues issues={preview.compatibility.issues} t={t} />
        </aside>
      )}
    </section>
  )
}

function WorkflowMode({
  value,
  checked,
  label,
  hint,
  disabled = false,
  onSelect,
}: {
  readonly value: ConfigureFeishuTaskWorkflowMapping['mode']
  readonly checked: boolean
  readonly label: string
  readonly hint: string
  readonly disabled?: boolean
  readonly onSelect: () => void
}) {
  return (
    <label>
      <input
        type="radio"
        name="workbench-workflow-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span>{label}</span>
      <small>{hint}</small>
    </label>
  )
}

function CompatibilityIssues({
  issues,
  t,
}: {
  readonly issues: readonly {
    readonly code: Parameters<typeof workflowIssueKey>[0]
    readonly stateId: string | null
    readonly taskGuid: string | null
  }[]
  readonly t: (key: WorkbenchKey) => string
}) {
  if (issues.length === 0) return <p className={css.hint}>{t('tasks.workflow.noIssues')}</p>
  return (
    <ul className={css.compatibilityIssues}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}:${issue.stateId ?? ''}:${issue.taskGuid ?? ''}:${String(index)}`}>
          {t(workflowIssueKey(issue.code))}
          {issue.stateId === null ? null : <> · <code>{issue.stateId}</code></>}
          {issue.taskGuid === null ? null : <> · <code>{issue.taskGuid}</code></>}
        </li>
      ))}
    </ul>
  )
}

function workflowDraft(
  workflow: ProjectTaskWorkflowProjection | null,
): WorkflowDraft {
  if (workflow !== null) {
    return Object.freeze({
      fieldName: workflow.definition.fieldName,
      initialStateId: workflow.definition.initialStateId,
      mode: 'migrate',
      fieldGuid: '',
      optionGuids: Object.freeze({}),
      states: Object.freeze(workflow.definition.states.map(candidate => Object.freeze({
        stateId: candidate.stateId,
        name: candidate.name,
        colorIndex: String(candidate.colorIndex),
        allowedNextStateIds: candidate.allowedNextStateIds.join(', '),
        terminal: workflow.definition.terminalStateIds.includes(candidate.stateId),
      }))),
    })
  }
  return Object.freeze({
    fieldName: 'Project status',
    initialStateId: 'planned',
    mode: 'create',
    fieldGuid: '',
    optionGuids: Object.freeze({}),
    states: Object.freeze([
      Object.freeze({
        stateId: 'planned', name: 'Planned', colorIndex: '1',
        allowedNextStateIds: 'doing', terminal: false,
      }),
      Object.freeze({
        stateId: 'doing', name: 'Doing', colorIndex: '2',
        allowedNextStateIds: 'done', terminal: false,
      }),
      Object.freeze({
        stateId: 'done', name: 'Done', colorIndex: '3',
        allowedNextStateIds: '', terminal: true,
      }),
    ]),
  })
}

function definitionFromDraft(draft: WorkflowDraft): ProjectTaskWorkflowDefinition | null {
  const fieldName = draft.fieldName.trim()
  if (fieldName.length < 1 || fieldName.length > MAX_FEISHU_WORKFLOW_FIELD_NAME_LENGTH
    || draft.states.length < 2 || draft.states.length > MAX_PROJECT_TASK_WORKFLOW_STATES) return null
  const stateIds = new Set<string>()
  const stateNames = new Set<string>()
  const states: ProjectTaskWorkflowDefinition['states'][number][] = []
  for (const candidate of draft.states) {
    const stateId = candidate.stateId.trim()
    const name = candidate.name.trim()
    const colorIndex = Number(candidate.colorIndex)
    const allowedNextStateIds = candidate.terminal
      ? []
      : candidate.allowedNextStateIds.split(/[\s,]+/u).filter(Boolean)
    if (!validStateId(stateId) || stateIds.has(stateId)
      || name.length < 1 || name.length > MAX_FEISHU_WORKFLOW_STATE_NAME_LENGTH
      || stateNames.has(name)
      || !Number.isInteger(colorIndex)
      || colorIndex < MIN_FEISHU_WORKFLOW_COLOR_INDEX
      || colorIndex > MAX_FEISHU_WORKFLOW_COLOR_INDEX
      || new Set(allowedNextStateIds).size !== allowedNextStateIds.length
      || allowedNextStateIds.includes(stateId)
      || allowedNextStateIds.some(target => !validStateId(target))) return null
    stateIds.add(stateId)
    stateNames.add(name)
    states.push(Object.freeze({ stateId, name, colorIndex, allowedNextStateIds: Object.freeze(allowedNextStateIds) }))
  }
  if (states.some(state => state.allowedNextStateIds.some(target => !stateIds.has(target)))) return null
  const initialStateId = draft.initialStateId.trim()
  const terminalStateIds = states
    .filter((_, index) => draft.states[index]?.terminal === true)
    .map(state => state.stateId)
  if (!stateIds.has(initialStateId) || terminalStateIds.length < 1) return null
  return Object.freeze({
    fieldName,
    initialStateId,
    terminalStateIds: Object.freeze(terminalStateIds),
    states: Object.freeze(states),
  })
}

function mappingFromDraft(
  draft: WorkflowDraft,
  definition: ProjectTaskWorkflowDefinition | null,
  state: WorkbenchProjectTasksClientState,
): ConfigureFeishuTaskWorkflowMapping | null {
  if (definition === null) return null
  if (draft.mode === 'create') return Object.freeze({ mode: 'create' })
  if (draft.mode === 'migrate') return state.projection?.workflow === null
    || state.projection?.workflow === undefined
      ? null
      : Object.freeze({ mode: 'migrate' })
  const discovery = state.workflowDiscovery
  const projection = state.projection
  if (discovery === null || projection === null || projection.binding === null
    || discovery.projectId !== projection.projectId
    || discovery.taskListGuid !== projection.binding.taskListGuid
    || discovery.taskRevision !== projection.revision) return null
  const field = discovery.items.find(candidate => candidate.fieldGuid === draft.fieldGuid)
  if (field === undefined || field.type !== 'single_select') return null
  const options = definition.states.map(workflowState => {
    const optionGuid = draft.optionGuids[workflowState.stateId] ?? ''
    return field.options.some(option => option.optionGuid === optionGuid)
      ? Object.freeze({ stateId: workflowState.stateId, optionGuid })
      : null
  })
  if (options.some(option => option === null)) return null
  const present = options as { readonly stateId: string; readonly optionGuid: string }[]
  if (new Set(present.map(option => option.optionGuid)).size !== present.length) return null
  return Object.freeze({
    mode: 'existing',
    fieldGuid: field.fieldGuid,
    options: Object.freeze(present),
  })
}

function validStateId(value: string): boolean {
  return value.length >= 1
    && value.length <= MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH
    && /^[a-z][a-z0-9-]*$/u.test(value)
}

function nextStateSuffix(states: readonly WorkflowStateDraft[]): number {
  let suffix = states.length + 1
  while (states.some(state => state.stateId === `state-${String(suffix)}`)) ++suffix
  return suffix
}

function workflowCompatibilityKey(
  state: 'compatible' | 'attention' | 'blocked',
): WorkbenchKey {
  if (state === 'compatible') return 'tasks.workflow.compatible'
  if (state === 'attention') return 'tasks.workflow.attention'
  return 'tasks.workflow.blocked'
}

function workflowIssueKey(
  code:
    | 'field-missing'
    | 'field-type-mismatch'
    | 'field-version-changed'
    | 'option-missing'
    | 'option-hidden'
    | 'option-name-changed'
    | 'used-state-removal'
    | 'duplicate-visible-option-name'
    | 'task-state-unmapped',
): WorkbenchKey {
  const keys = {
    'field-missing': 'tasks.workflow.issue.fieldMissing',
    'field-type-mismatch': 'tasks.workflow.issue.fieldType',
    'field-version-changed': 'tasks.workflow.issue.fieldVersion',
    'option-missing': 'tasks.workflow.issue.optionMissing',
    'option-hidden': 'tasks.workflow.issue.optionHidden',
    'option-name-changed': 'tasks.workflow.issue.optionName',
    'used-state-removal': 'tasks.workflow.issue.usedRemoval',
    'duplicate-visible-option-name': 'tasks.workflow.issue.duplicateName',
    'task-state-unmapped': 'tasks.workflow.issue.taskUnmapped',
  } as const satisfies Record<typeof code, WorkbenchKey>
  return keys[code]
}
