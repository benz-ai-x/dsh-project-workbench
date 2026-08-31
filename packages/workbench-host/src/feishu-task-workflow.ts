/** Pure T09 workflow validation and compatibility planning. */

import type {
  ConfigureFeishuTaskWorkflowMapping,
  FeishuTaskWorkflowFieldCandidate,
  ProjectTaskWorkflowCompatibilityIssue,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
} from './client.ts'

export const MAX_PROJECT_TASK_WORKFLOW_STATES = 100
export const MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH = 64
export const MAX_FEISHU_CUSTOM_FIELD_NAME_LENGTH = 50
export const MAX_FEISHU_CUSTOM_FIELD_OPTION_NAME_LENGTH = 50
export const MIN_FEISHU_CUSTOM_FIELD_COLOR_INDEX = 0
export const MAX_FEISHU_CUSTOM_FIELD_COLOR_INDEX = 54

export interface WorkbenchFeishuTaskCustomFieldValue {
  readonly fieldGuid: string
  readonly type: string
  readonly singleSelectOptionGuid: string | null
}

export interface WorkbenchFeishuTaskWorkflowValueObservation {
  readonly taskGuid: string
  readonly values: readonly WorkbenchFeishuTaskCustomFieldValue[]
}

export interface WorkbenchTaskWorkflowCompatibilityInput {
  readonly current: ProjectTaskWorkflowProjection | null
  readonly desired: ProjectTaskWorkflowDefinition
  readonly mapping: ConfigureFeishuTaskWorkflowMapping
  readonly remoteFields: readonly FeishuTaskWorkflowFieldCandidate[]
  readonly taskValues: readonly WorkbenchFeishuTaskWorkflowValueObservation[]
}

export interface WorkbenchTaskWorkflowCompatibilityResult {
  readonly compatibility: ProjectTaskWorkflowProjection['compatibility']
  readonly usedStateIds: readonly string[]
}

export function projectTaskWorkflowDefinition(
  definition: ProjectTaskWorkflowDefinition,
): ProjectTaskWorkflowDefinition {
  const fieldName = boundedText(
    definition.fieldName,
    'workflow field name',
    MAX_FEISHU_CUSTOM_FIELD_NAME_LENGTH,
  )
  if (!Array.isArray(definition.states)
    || definition.states.length < 2
    || definition.states.length > MAX_PROJECT_TASK_WORKFLOW_STATES) {
    throw new TypeError(
      `workflow must define between 2 and ${MAX_PROJECT_TASK_WORKFLOW_STATES} states`,
    )
  }
  const stateIds = new Set<string>()
  const stateNames = new Set<string>()
  const states = definition.states.map((state, index) => {
    const stateId = workflowStateId(state.stateId, `workflow state ${index + 1} id`)
    const name = boundedText(
      state.name,
      `workflow state ${stateId} name`,
      MAX_FEISHU_CUSTOM_FIELD_OPTION_NAME_LENGTH,
    )
    if (stateIds.has(stateId)) throw new TypeError(`workflow state id ${stateId} is duplicated`)
    if (stateNames.has(name)) throw new TypeError(`workflow state name ${name} is duplicated`)
    stateIds.add(stateId)
    stateNames.add(name)
    if (!Number.isInteger(state.colorIndex)
      || state.colorIndex < MIN_FEISHU_CUSTOM_FIELD_COLOR_INDEX
      || state.colorIndex > MAX_FEISHU_CUSTOM_FIELD_COLOR_INDEX) {
      throw new TypeError(
        `workflow state ${stateId} colorIndex must be an integer from 0 through 54`,
      )
    }
    if (!Array.isArray(state.allowedNextStateIds)) {
      throw new TypeError(`workflow state ${stateId} transitions must be an array`)
    }
    const allowedNextStateIds = state.allowedNextStateIds.map((
      target: string,
      targetIndex: number,
    ) =>
      workflowStateId(target, `workflow state ${stateId} transition ${targetIndex + 1}`))
    if (new Set(allowedNextStateIds).size !== allowedNextStateIds.length) {
      throw new TypeError(`workflow state ${stateId} has duplicate transitions`)
    }
    if (allowedNextStateIds.includes(stateId)) {
      throw new TypeError(`workflow state ${stateId} cannot transition to itself`)
    }
    return Object.freeze({ stateId, name, colorIndex: state.colorIndex, allowedNextStateIds })
  })
  const initialStateId = workflowStateId(definition.initialStateId, 'workflow initialStateId')
  if (!stateIds.has(initialStateId)) throw new TypeError('workflow initial state is not defined')
  if (!Array.isArray(definition.terminalStateIds)
    || definition.terminalStateIds.length < 1
    || definition.terminalStateIds.length > states.length) {
    throw new TypeError('workflow must define at least one terminal state')
  }
  const terminalStateIds = definition.terminalStateIds.map((stateId, index) =>
    workflowStateId(stateId, `workflow terminal state ${index + 1}`))
  if (new Set(terminalStateIds).size !== terminalStateIds.length) {
    throw new TypeError('workflow terminal states must be unique')
  }
  for (const stateId of terminalStateIds) {
    if (!stateIds.has(stateId)) throw new TypeError(`workflow terminal state ${stateId} is not defined`)
    const state = states.find(candidate => candidate.stateId === stateId)
    if (state?.allowedNextStateIds.length !== 0) {
      throw new TypeError(`workflow terminal state ${stateId} cannot allow outgoing transitions`)
    }
  }
  for (const state of states) {
    for (const target of state.allowedNextStateIds) {
      if (!stateIds.has(target)) {
        throw new TypeError(`workflow transition ${state.stateId} -> ${target} is not defined`)
      }
    }
  }
  return Object.freeze({
    fieldName,
    initialStateId,
    terminalStateIds: Object.freeze(terminalStateIds),
    states: Object.freeze(states),
  })
}

export function assessTaskWorkflowCompatibility(
  input: WorkbenchTaskWorkflowCompatibilityInput,
): WorkbenchTaskWorkflowCompatibilityResult {
  const desired = projectTaskWorkflowDefinition(input.desired)
  const issues: ProjectTaskWorkflowCompatibilityIssue[] = []
  const usedStateIds = new Set<string>()
  const currentOptions = new Map(
    (input.current?.options ?? []).map(option => [option.stateId, option] as const),
  )
  const currentByGuid = new Map(
    (input.current?.options ?? []).map(option => [option.optionGuid, option] as const),
  )
  const selected = selectField(input, issues)
  const mapping = selected === null
    ? new Map<string, string>()
    : mappedOptionGuids(input.mapping, input.current, desired, selected, issues)

  for (const task of input.taskValues) {
    const value = selected === null
      ? null
      : task.values.find(candidate => candidate.fieldGuid === selected.fieldGuid) ?? null
    const optionGuid = value?.singleSelectOptionGuid ?? null
    if (optionGuid === null) continue
    const logical = [...mapping].find(([, guid]) => guid === optionGuid)?.[0]
      ?? currentByGuid.get(optionGuid)?.stateId
      ?? null
    if (logical === null) {
      issues.push(issue(
        'task-state-unmapped',
        'blocked',
        null,
        task.taskGuid,
        'A task uses an option that is not mapped to a workflow state',
      ))
      continue
    }
    usedStateIds.add(logical)
  }

  const desiredIds = new Set(desired.states.map(state => state.stateId))
  for (const [stateId, option] of currentOptions) {
    if (!desiredIds.has(stateId) && (option.usedTaskCount > 0 || usedStateIds.has(stateId))) {
      issues.push(issue(
        'used-state-removal',
        'blocked',
        stateId,
        null,
        `State ${stateId} is still used and cannot be removed or hidden`,
      ))
    }
  }

  const uniqueIssues = deduplicateIssues(issues)
  const state = uniqueIssues.some(candidate => candidate.severity === 'blocked')
    ? 'blocked'
    : uniqueIssues.length > 0 ? 'attention' : 'compatible'
  return Object.freeze({
    compatibility: Object.freeze({ state, issues: Object.freeze(uniqueIssues) }),
    usedStateIds: Object.freeze([...usedStateIds].sort()),
  })
}

export function workflowTransitionAllowed(
  definition: ProjectTaskWorkflowDefinition,
  currentStateId: string,
  requestedStateId: string,
): boolean {
  const normalized = projectTaskWorkflowDefinition(definition)
  return normalized.states.find(state => state.stateId === currentStateId)
    ?.allowedNextStateIds.includes(requestedStateId) ?? false
}

function selectField(
  input: WorkbenchTaskWorkflowCompatibilityInput,
  issues: ProjectTaskWorkflowCompatibilityIssue[],
): FeishuTaskWorkflowFieldCandidate | null {
  if (input.mapping.mode === 'create') return null
  const fieldGuid = input.mapping.mode === 'existing'
    ? input.mapping.fieldGuid
    : input.current?.field.fieldGuid ?? null
  if (fieldGuid === null) {
    issues.push(issue('field-missing', 'blocked', null, null, 'No mapped workflow field exists'))
    return null
  }
  const selected = input.remoteFields.find(field => field.fieldGuid === fieldGuid) ?? null
  if (selected === null) {
    issues.push(issue('field-missing', 'blocked', null, null, 'The mapped Feishu field no longer exists'))
    return null
  }
  if (selected.type !== 'single_select') {
    issues.push(issue(
      'field-type-mismatch',
      'blocked',
      null,
      null,
      'Workflow mapping requires a Feishu single-select custom field',
    ))
  }
  if (input.mapping.mode === 'migrate'
    && input.current !== null
    && selected.remoteVersion !== input.current.field.remoteVersion) {
    issues.push(issue(
      'field-version-changed',
      'attention',
      null,
      null,
      'The Feishu field changed since the stored workflow mapping was observed',
    ))
  }
  return selected
}

function mappedOptionGuids(
  mapping: ConfigureFeishuTaskWorkflowMapping,
  current: ProjectTaskWorkflowProjection | null,
  desired: ProjectTaskWorkflowDefinition,
  field: FeishuTaskWorkflowFieldCandidate,
  issues: ProjectTaskWorkflowCompatibilityIssue[],
): Map<string, string> {
  const pairs = mapping.mode === 'existing'
    ? mapping.options
    : (current?.options ?? []).map(option => ({
      stateId: option.stateId,
      optionGuid: option.optionGuid,
    }))
  const stateIds = new Set<string>()
  const optionGuids = new Set<string>()
  const result = new Map<string, string>()
  for (const pair of pairs) {
    const stateId = workflowStateId(pair.stateId, 'workflow option mapping stateId')
    const optionGuid = boundedText(pair.optionGuid, 'workflow option guid', 256)
    if (stateIds.has(stateId) || optionGuids.has(optionGuid)) {
      throw new TypeError('workflow option mappings must be one-to-one')
    }
    stateIds.add(stateId)
    optionGuids.add(optionGuid)
    result.set(stateId, optionGuid)
  }
  if (mapping.mode === 'existing' && result.size !== desired.states.length) {
    throw new TypeError('existing workflow mapping must map every desired state exactly once')
  }
  for (const state of desired.states) {
    const guid = result.get(state.stateId)
    if (guid === undefined) {
      if (mapping.mode === 'existing') {
        issues.push(issue(
          'option-missing', 'blocked', state.stateId, null,
          `State ${state.stateId} has no mapped Feishu option`,
        ))
      }
      continue
    }
    const option = field.options.find(candidate => candidate.optionGuid === guid)
    if (option === undefined) {
      issues.push(issue(
        'option-missing', 'blocked', state.stateId, null,
        `The Feishu option mapped to ${state.stateId} no longer exists`,
      ))
      continue
    }
    if (option.hidden) {
      issues.push(issue(
        'option-hidden', 'blocked', state.stateId, null,
        `The Feishu option mapped to ${state.stateId} is hidden`,
      ))
    }
    if (option.name !== state.name) {
      issues.push(issue(
        'option-name-changed', 'attention', state.stateId, null,
        `Feishu option ${option.name} differs from workflow state ${state.name}`,
      ))
    }
  }
  const visibleNames = new Set<string>()
  for (const option of field.options) {
    if (option.hidden) continue
    if (visibleNames.has(option.name)) {
      issues.push(issue(
        'duplicate-visible-option-name', 'blocked', null, null,
        `Feishu field contains duplicate visible option name ${option.name}`,
      ))
    }
    visibleNames.add(option.name)
  }
  return result
}

function workflowStateId(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_PROJECT_TASK_WORKFLOW_STATE_ID_LENGTH
    || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new TypeError(`${field} must be a lowercase stable identifier`)
  }
  return value
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum) {
    throw new TypeError(`${field} must contain 1 through ${maximum} trimmed characters`)
  }
  return value
}

function issue(
  code: ProjectTaskWorkflowCompatibilityIssue['code'],
  severity: ProjectTaskWorkflowCompatibilityIssue['severity'],
  stateId: string | null,
  taskGuid: string | null,
  message: string,
): ProjectTaskWorkflowCompatibilityIssue {
  return Object.freeze({ code, severity, stateId, taskGuid, message })
}

function deduplicateIssues(
  issues: readonly ProjectTaskWorkflowCompatibilityIssue[],
): readonly ProjectTaskWorkflowCompatibilityIssue[] {
  const seen = new Set<string>()
  return issues.filter((candidate) => {
    const key = `${candidate.code}\u0000${candidate.stateId ?? ''}\u0000${candidate.taskGuid ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
