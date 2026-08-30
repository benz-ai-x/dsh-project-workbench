/** Compiled immutable Knowledge Work Template V1 and its canonical identity. */

import { createHash } from 'node:crypto'
import { canonicalizeJson } from './audit.ts'
import type {
  KnowledgeWorkTemplateDefinitionV1,
  ProjectTemplateProjection,
  ProjectTemplateSelection,
  WorkbenchDigest,
} from './client.ts'

export const KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1: KnowledgeWorkTemplateDefinitionV1 =
  Object.freeze({
    snapshotSchemaVersion: 1,
    templateId: 'knowledge-work',
    templateVersion: 1,
    kind: 'knowledge-work',
    rules: Object.freeze({
      minimumOutcomeCount: 1,
      outcomeMetricRequired: true,
      primaryGoalRequired: true,
      supportingGoalsAllowed: true,
    }),
    defaults: Object.freeze({
      projectTimezone: 'Asia/Shanghai',
    }),
  })

export const KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1 = canonicalizeJson(
  KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
)

/** Frozen UTF-8 octets; callers needing a mutable buffer must copy them. */
export const KNOWLEDGE_WORK_TEMPLATE_CANONICAL_BYTES_V1: readonly number[] = Object.freeze(
  [...Buffer.from(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1, 'utf8')],
)

/** Fixed golden for the compiled canonical definition above. */
export const KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1 =
  'sha256:1c77cb582acf9ee4d751346225f08ec8ca2fb7a3afb9d8231b7127d802a3f8c4' as const

const compiledDigest = `sha256:${createHash('sha256')
  .update(KNOWLEDGE_WORK_TEMPLATE_CANONICAL_JSON_V1, 'utf8')
  .digest('hex')}` as WorkbenchDigest

if (compiledDigest !== KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1) {
  throw new Error('Compiled Knowledge Work Template V1 digest does not match its fixed golden')
}

export const KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1: ProjectTemplateSelection = Object.freeze({
  templateId: 'knowledge-work',
  templateVersion: 1,
  definitionDigest: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_DIGEST_V1,
})

export const KNOWLEDGE_WORK_TEMPLATE_PROJECTION_V1: ProjectTemplateProjection = Object.freeze({
  selection: KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1,
  definition: KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
})

/** Return a fresh recursively frozen public copy rather than a mutable stored alias. */
export function knowledgeWorkTemplateProjection(): ProjectTemplateProjection {
  return Object.freeze({
    selection: Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1 }),
    definition: Object.freeze({
      ...KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1,
      rules: Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1.rules }),
      defaults: Object.freeze({ ...KNOWLEDGE_WORK_TEMPLATE_DEFINITION_V1.defaults }),
    }),
  })
}

/** Exact-match guard used at public and persistence template boundaries. */
export function isKnowledgeWorkTemplateSelection(
  value: ProjectTemplateSelection,
): boolean {
  return value.templateId === KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateId
    && value.templateVersion === KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.templateVersion
    && value.definitionDigest === KNOWLEDGE_WORK_TEMPLATE_SELECTION_V1.definitionDigest
}
