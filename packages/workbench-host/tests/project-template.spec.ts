import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_BYTES_V1,
  KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
  KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  isKnowledgeWorkTemplateSelection,
  knowledgeWorkTemplateProjection,
} from '../src/index.ts'
import { canonicalizeJson } from '../src/audit.ts'

describe('Knowledge Work Template V1', () => {
  it('pins the immutable canonical bytes and fixed SHA-256 golden', () => {
    const canonical = '{"defaults":{"projectTimezone":"Asia/Shanghai"},"kind":"knowledge-work","rules":{"minimumOutcomeCount":1,"outcomeMetricRequired":true,"primaryGoalRequired":true,"supportingGoalsAllowed":true},"snapshotSchemaVersion":1,"templateId":"knowledge-work","templateVersion":1}'

    expect(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1).toBe(canonical)
    expect(Buffer.from(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_BYTES_V1).toString('utf8')).toBe(canonical)
    expect(canonicalizeJson(KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1)).toBe(canonical)
    expect(`sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`)
      .toBe(KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1)
    expect(KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1)
      .toBe('sha256:1c77cb582acf9ee4d751346225f08ec8ca2fb7a3afb9d8231b7127d802a3f8c4')
    expect(Object.isFrozen(KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1)).toBe(true)
    expect(Object.isFrozen(KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1.rules)).toBe(true)
    expect(Object.isFrozen(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_BYTES_V1)).toBe(true)
  })

  it('returns recursively detached projections and exact-matches all selection coordinates', () => {
    const first = knowledgeWorkTemplateProjection()
    const second = knowledgeWorkTemplateProjection()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.selection).not.toBe(second.selection)
    expect(first.definition).not.toBe(second.definition)
    expect(Object.isFrozen(first.definition.defaults)).toBe(true)
    expect(isKnowledgeWorkTemplateSelection(first.selection)).toBe(true)
    expect(isKnowledgeWorkTemplateSelection({
      ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
      definitionDigest: `sha256:${'f'.repeat(64)}`,
    })).toBe(false)
  })
})
