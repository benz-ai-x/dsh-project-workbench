import { describe, expect, it } from 'vitest'
import type {
  FeishuTaskWorkflowFieldCandidate,
  ProjectTaskWorkflowDefinition,
  ProjectTaskWorkflowProjection,
} from '../src/client.ts'
import {
  assessTaskWorkflowCompatibility,
  projectTaskWorkflowDefinition,
  workflowTransitionAllowed,
} from '../src/feishu-task-workflow.ts'

function definition(
  overrides: Partial<ProjectTaskWorkflowDefinition> = {},
): ProjectTaskWorkflowDefinition {
  return {
    fieldName: 'Project status',
    initialStateId: 'planned',
    terminalStateIds: ['done'],
    states: [
      { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['doing'] },
      { stateId: 'doing', name: 'Doing', colorIndex: 11, allowedNextStateIds: ['done'] },
      { stateId: 'done', name: 'Done', colorIndex: 32, allowedNextStateIds: [] },
    ],
    ...overrides,
  }
}

function field(
  overrides: Partial<FeishuTaskWorkflowFieldCandidate> = {},
): FeishuTaskWorkflowFieldCandidate {
  return {
    fieldGuid: 'field-status',
    name: 'Project status',
    type: 'single_select',
    remoteVersion: '10',
    options: [
      { optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false },
      { optionGuid: 'option-doing', name: 'Doing', colorIndex: 11, hidden: false },
      { optionGuid: 'option-done', name: 'Done', colorIndex: 32, hidden: false },
    ],
    ...overrides,
  }
}

function currentWorkflow(): ProjectTaskWorkflowProjection {
  return {
    revision: 1,
    definition: definition(),
    field: {
      fieldGuid: 'field-status',
      name: 'Project status',
      type: 'single_select',
      remoteVersion: '10',
    },
    options: [
      { stateId: 'planned', optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: false, usedTaskCount: 0 },
      { stateId: 'doing', optionGuid: 'option-doing', name: 'Doing', colorIndex: 11, hidden: false, usedTaskCount: 1 },
      { stateId: 'done', optionGuid: 'option-done', name: 'Done', colorIndex: 32, hidden: false, usedTaskCount: 0 },
    ],
    values: [],
    compatibility: { state: 'compatible', issues: [] },
    completionSuggestions: [],
    configuredAt: '2026-08-31T05:00:00.000Z',
    updatedAt: '2026-08-31T05:00:00.000Z',
  }
}

describe('T09 task workflow domain', () => {
  it('accepts one closed workflow graph and enforces allowed transitions', () => {
    const normalized = projectTaskWorkflowDefinition(definition())
    expect(normalized).toEqual(definition())
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(workflowTransitionAllowed(normalized, 'planned', 'doing')).toBe(true)
    expect(workflowTransitionAllowed(normalized, 'planned', 'done')).toBe(false)
  })

  it.each([
    ['duplicate state IDs', definition({
      states: [
        { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: [] },
        { stateId: 'planned', name: 'Again', colorIndex: 2, allowedNextStateIds: [] },
      ],
      terminalStateIds: ['planned'],
    })],
    ['unknown transition targets', definition({
      states: [
        { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['missing'] },
        { stateId: 'done', name: 'Done', colorIndex: 2, allowedNextStateIds: [] },
      ],
    })],
    ['outgoing terminal transitions', definition({
      states: [
        { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['done'] },
        { stateId: 'done', name: 'Done', colorIndex: 2, allowedNextStateIds: ['planned'] },
      ],
    })],
  ])('rejects %s', (_label, invalid) => {
    expect(() => projectTaskWorkflowDefinition(invalid)).toThrow(TypeError)
  })

  it('maps every state one-to-one to a visible existing Feishu option', () => {
    const result = assessTaskWorkflowCompatibility({
      current: null,
      desired: definition(),
      mapping: {
        mode: 'existing',
        fieldGuid: 'field-status',
        options: [
          { stateId: 'planned', optionGuid: 'option-planned' },
          { stateId: 'doing', optionGuid: 'option-doing' },
          { stateId: 'done', optionGuid: 'option-done' },
        ],
      },
      remoteFields: [field()],
      taskValues: [{
        taskGuid: 'task-1',
        values: [{
          fieldGuid: 'field-status',
          type: 'single_select',
          singleSelectOptionGuid: 'option-doing',
        }],
      }],
    })
    expect(result).toEqual({
      compatibility: { state: 'compatible', issues: [] },
      usedStateIds: ['doing'],
    })
  })

  it('blocks a hidden mapping, unmapped task value, and removal of an in-use state', () => {
    const desired = definition({
      states: [
        { stateId: 'planned', name: 'Planned', colorIndex: 1, allowedNextStateIds: ['done'] },
        { stateId: 'done', name: 'Done', colorIndex: 32, allowedNextStateIds: [] },
      ],
    })
    const result = assessTaskWorkflowCompatibility({
      current: currentWorkflow(),
      desired,
      mapping: { mode: 'migrate' },
      remoteFields: [field({
        remoteVersion: '11',
        options: [
          { optionGuid: 'option-planned', name: 'Planned', colorIndex: 1, hidden: true },
          { optionGuid: 'option-doing', name: 'Doing', colorIndex: 11, hidden: false },
          { optionGuid: 'option-done', name: 'Done', colorIndex: 32, hidden: false },
        ],
      })],
      taskValues: [
        {
          taskGuid: 'task-doing',
          values: [{ fieldGuid: 'field-status', type: 'single_select', singleSelectOptionGuid: 'option-doing' }],
        },
        {
          taskGuid: 'task-unknown',
          values: [{ fieldGuid: 'field-status', type: 'single_select', singleSelectOptionGuid: 'option-unknown' }],
        },
      ],
    })
    expect(result.compatibility.state).toBe('blocked')
    expect(result.compatibility.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'field-version-changed',
      'option-hidden',
      'task-state-unmapped',
      'used-state-removal',
    ]))
  })
})
