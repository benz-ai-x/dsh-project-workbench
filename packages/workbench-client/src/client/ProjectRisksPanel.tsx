/** Accessible, register-first Project Risk workspace. */

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ProjectRiskAssessmentProjection,
  ProjectRiskCategory,
  ProjectRiskClosureReason,
  ProjectRiskConfidence,
  ProjectRiskEvidenceOption,
  ProjectRiskEvidenceRef,
  ProjectRiskHistoryEntry,
  ProjectRiskMemberSnapshot,
  ProjectRiskProjection,
  ProjectRiskSelectedProjection,
  ProjectRisksProjection,
  ProjectRiskStatus,
  ProjectRiskTriggerState,
} from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_PROJECT_RISK_ASSUMPTION_LENGTH,
  MAX_PROJECT_RISK_ASSUMPTIONS,
  MAX_PROJECT_RISK_CONFIDENCE_RATIONALE_LENGTH,
  MAX_PROJECT_RISK_STATEMENT_LENGTH,
  MAX_PROJECT_RISK_TRANSITION_RATIONALE_LENGTH,
  MAX_PROJECT_RISK_TRIGGER_LENGTH,
  type WorkbenchProjectRiskAssessmentEditorDraft,
  type WorkbenchProjectRisksClientState,
  type WorkbenchProjectRisksController,
  type WorkbenchProjectRiskTransitionDraft,
} from './project-risk-controller.ts'
import {
  projectRiskActivityActionKey,
  projectRiskCategoryKey,
  projectRiskClosureReasonKey,
  projectRiskConfidenceKey,
  projectRiskEvidenceKindKey,
  projectRiskExposureLevelKey,
  projectRiskImpactBandKey,
  projectRiskLikelihoodBandKey,
  projectRiskStatusKey,
  projectRiskTriggerStateKey,
} from './risk-presentation.ts'
import css from './ProjectRisksPanel.module.css'

export interface ProjectRisksPanelProps {
  readonly controller: WorkbenchProjectRisksController
  readonly t: (key: WorkbenchKey) => string
}

const CATEGORIES: readonly ProjectRiskCategory[] = [
  'schedule', 'dependency', 'scope', 'capacity', 'ownership',
  'quality', 'information', 'governance', 'external', 'other',
]
const STATUSES: readonly ProjectRiskStatus[] = [
  'research', 'watch', 'mitigate', 'accept', 'closed',
]
const TRIGGER_STATES: readonly ProjectRiskTriggerState[] = ['unknown', 'not-met', 'met']
const CONFIDENCES: readonly ProjectRiskConfidence[] = ['low', 'medium', 'high']
const CLOSURE_REASONS: readonly ProjectRiskClosureReason[] = [
  'no-longer-exists', 'below-threshold', 'materialized-as-issue', 'superseded',
]

function phasePresentation(state: WorkbenchProjectRisksClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'risks.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'risks.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'risks.status.loading' }
    case 'ready': return { dot: 'done', key: 'risks.status.ready' }
    case 'stale': return { dot: 'warning', key: 'risks.status.stale' }
    case 'error': return { dot: 'error', key: 'risks.status.error' }
    case 'conflict': return { dot: 'warning', key: 'risks.status.conflict' }
  }
}

function toggleValue(values: readonly string[], value: string, checked: boolean): readonly string[] {
  return checked
    ? values.includes(value) ? values : [...values, value]
    : values.filter(candidate => candidate !== value)
}

function evidenceId(value: ProjectRiskEvidenceRef | ProjectRiskEvidenceOption): string {
  return value.kind === 'workbench-audit-event'
    ? `audit:${value.auditEventId}` : `schedule:${value.scheduleChangeId}`
}

function evidenceLabel(value: ProjectRiskEvidenceRef | ProjectRiskEvidenceOption): string {
  return value.kind === 'workbench-audit-event' ? value.auditEventId : value.scheduleChangeId
}

function toggleEvidence(
  values: readonly ProjectRiskEvidenceRef[],
  option: ProjectRiskEvidenceOption,
  checked: boolean,
): readonly ProjectRiskEvidenceRef[] {
  const id = evidenceId(option)
  if (!checked) return values.filter(value => evidenceId(value) !== id)
  if (values.some(value => evidenceId(value) === id)) return values
  return [...values, option.kind === 'workbench-audit-event'
    ? { kind: 'workbench-audit-event', auditEventId: option.auditEventId }
    : { kind: 'project-schedule-change', scheduleChangeId: option.scheduleChangeId }]
}

function defaultTransition(status: ProjectRiskStatus): WorkbenchProjectRiskTransitionDraft {
  const target: ProjectRiskStatus = status === 'research' ? 'watch'
    : status === 'watch' ? 'mitigate'
      : status === 'mitigate' ? 'accept'
        : 'closed'
  return Object.freeze({ status: target, rationale: '', closureReason: '' })
}

interface AssessmentFormProps {
  readonly controller: WorkbenchProjectRisksController
  readonly draft: WorkbenchProjectRiskAssessmentEditorDraft
  readonly projection: ProjectRisksProjection
  readonly t: ProjectRisksPanelProps['t']
  readonly mode: 'create' | 'revise'
  readonly pending: boolean
  readonly onChange: (draft: WorkbenchProjectRiskAssessmentEditorDraft) => void
  readonly onSubmit: () => void
  readonly onCancel?: () => void
}

function AssessmentForm({
  controller,
  draft,
  projection,
  t,
  mode,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: AssessmentFormProps) {
  const update = <K extends keyof WorkbenchProjectRiskAssessmentEditorDraft>(
    key: K,
    value: WorkbenchProjectRiskAssessmentEditorDraft[K],
  ): void => { onChange({ ...draft, [key]: value }) }
  const accountable = projection.memberOptions.find(
    member => member.memberId === draft.accountableMemberId,
  )
  const hintPrefix = mode === 'create' ? 'project-risk-create' : 'project-risk-revise'
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit()
  }
  const canSubmit = mode === 'create' ? controller.canCreate() : controller.canRevise()

  return (
    <form
      className={css.assessmentForm}
      aria-label={t(mode === 'create' ? 'risks.create.legend' : 'risks.revise.legend')}
      onSubmit={submit}
    >
      <fieldset className={css.fieldset} disabled={pending}>
        <legend>{t(mode === 'create' ? 'risks.create.legend' : 'risks.revise.legend')}</legend>
        <label className={css.field}>
          <span>{t('risks.field.condition')}</span>
          <textarea
            rows={2}
            maxLength={MAX_PROJECT_RISK_STATEMENT_LENGTH}
            value={draft.condition}
            onChange={event => { update('condition', event.currentTarget.value) }}
          />
        </label>
        <label className={css.field}>
          <span>{t('risks.field.event')}</span>
          <textarea
            rows={2}
            required
            maxLength={MAX_PROJECT_RISK_STATEMENT_LENGTH}
            value={draft.event}
            onChange={event => { update('event', event.currentTarget.value) }}
          />
        </label>
        <label className={css.field}>
          <span>{t('risks.field.consequence')}</span>
          <textarea
            rows={2}
            required
            maxLength={MAX_PROJECT_RISK_STATEMENT_LENGTH}
            value={draft.consequence}
            onChange={event => { update('consequence', event.currentTarget.value) }}
          />
        </label>

        <div className={css.threeColumn}>
          <label className={css.field}>
            <span>{t('risks.field.category')}</span>
            <select
              value={draft.category}
              onChange={event => { update('category', event.currentTarget.value as ProjectRiskCategory) }}
            >
              {CATEGORIES.map(value => (
                <option key={value} value={value}>{t(projectRiskCategoryKey(value))}</option>
              ))}
            </select>
          </label>
          <label className={css.field}>
            <span>{t('risks.field.confidence')}</span>
            <select
              value={draft.confidence}
              onChange={event => { update('confidence', event.currentTarget.value as ProjectRiskConfidence) }}
            >
              {CONFIDENCES.map(value => (
                <option key={value} value={value}>{t(projectRiskConfidenceKey(value))}</option>
              ))}
            </select>
          </label>
          <label className={css.field}>
            <span>{t('risks.field.triggerState')}</span>
            <select
              value={draft.triggerState}
              onChange={event => { update('triggerState', event.currentTarget.value as ProjectRiskTriggerState) }}
            >
              {TRIGGER_STATES.map(value => (
                <option key={value} value={value}>{t(projectRiskTriggerStateKey(value))}</option>
              ))}
            </select>
          </label>
        </div>

        <label className={css.field}>
          <span>{t('risks.field.triggerStatement')}</span>
          <textarea
            rows={2}
            required
            maxLength={MAX_PROJECT_RISK_TRIGGER_LENGTH}
            value={draft.triggerStatement}
            onChange={event => { update('triggerStatement', event.currentTarget.value) }}
          />
        </label>
        {mode === 'revise' && <p className={css.hint}>{t('risks.trigger.episodeHint')}</p>}

        <div className={css.fourColumn}>
          <label className={css.field}>
            <span>{t('risks.field.probabilityLower')}</span>
            <input
              inputMode="numeric"
              required
              aria-describedby={`${hintPrefix}-probability-hint`}
              value={draft.probabilityLowerBasisPoints}
              onChange={event => { update('probabilityLowerBasisPoints', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('risks.field.probabilityUpper')}</span>
            <input
              inputMode="numeric"
              required
              aria-describedby={`${hintPrefix}-probability-hint`}
              value={draft.probabilityUpperBasisPoints}
              onChange={event => { update('probabilityUpperBasisPoints', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('risks.field.impactLower')}</span>
            <input
              inputMode="numeric"
              required
              aria-describedby={`${hintPrefix}-impact-hint`}
              value={draft.impactLowerBand}
              onChange={event => { update('impactLowerBand', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('risks.field.impactUpper')}</span>
            <input
              inputMode="numeric"
              required
              aria-describedby={`${hintPrefix}-impact-hint`}
              value={draft.impactUpperBand}
              onChange={event => { update('impactUpperBand', event.currentTarget.value) }}
            />
          </label>
        </div>
        <p id={`${hintPrefix}-probability-hint`} className={css.hint}>{t('risks.form.probabilityHint')}</p>
        <p id={`${hintPrefix}-impact-hint`} className={css.hint}>{t('risks.form.impactHint')}</p>

        <label className={css.field}>
          <span>{t('risks.field.confidenceRationale')}</span>
          <textarea
            rows={2}
            required
            maxLength={MAX_PROJECT_RISK_CONFIDENCE_RATIONALE_LENGTH}
            value={draft.confidenceRationale}
            onChange={event => { update('confidenceRationale', event.currentTarget.value) }}
          />
        </label>
        <div className={css.twoColumn}>
          <label className={css.field}>
            <span>{t('risks.field.horizon')}</span>
            <input
              type="date"
              required
              aria-describedby={`${hintPrefix}-date-hint`}
              value={draft.assessmentHorizonEnd}
              onChange={event => { update('assessmentHorizonEnd', event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('risks.field.nextReview')}</span>
            <input
              type="date"
              required
              aria-describedby={`${hintPrefix}-date-hint`}
              value={draft.nextReviewOn}
              onChange={event => { update('nextReviewOn', event.currentTarget.value) }}
            />
          </label>
        </div>
        <p id={`${hintPrefix}-date-hint`} className={css.hint}>{t('risks.form.dateHint')}</p>

        <label className={css.field}>
          <span>{t('risks.field.owner')}</span>
          <select
            required
            value={draft.accountableMemberId}
            onChange={event => {
              const memberId = event.currentTarget.value
              onChange({
                ...draft,
                accountableMemberId: memberId,
                contributorMemberIds: draft.contributorMemberIds.filter(id => id !== memberId),
                humanSponsorMemberId: '',
              })
            }}
          >
            <option value="">{t('risks.form.chooseMember')}</option>
            {projection.memberOptions.map(member => (
              <option
                key={member.memberId}
                value={member.memberId}
                disabled={member.status !== 'active'}
              >{member.displayName}</option>
            ))}
          </select>
        </label>

        <details className={css.advanced}>
          <summary>{t('risks.form.advanced')}</summary>
          <div className={css.advancedBody}>
            <fieldset className={css.nestedFieldset}>
              <legend>{t('risks.field.contributors')}</legend>
              <div className={css.choices}>
                {projection.memberOptions.map(member => (
                  <label key={member.memberId}>
                    <input
                      type="checkbox"
                      disabled={(member.status !== 'active'
                        && !draft.contributorMemberIds.includes(member.memberId))
                        || member.memberId === draft.accountableMemberId}
                      checked={draft.contributorMemberIds.includes(member.memberId)}
                      onChange={event => {
                        update('contributorMemberIds', toggleValue(
                          draft.contributorMemberIds, member.memberId, event.currentTarget.checked,
                        ))
                      }}
                    />
                    <span>{member.displayName}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {accountable?.requiresHumanSponsor === true && (
              <label className={css.field}>
                <span>{t('risks.field.sponsor')}</span>
                <select
                  required
                  value={draft.humanSponsorMemberId}
                  onChange={event => { update('humanSponsorMemberId', event.currentTarget.value) }}
                >
                  <option value="">{t('risks.form.chooseMember')}</option>
                  {projection.memberOptions.filter(member => member.canBeHumanSponsor).map(member => (
                    <option
                      key={member.memberId}
                      value={member.memberId}
                      disabled={member.status !== 'active'}
                    >{member.displayName}</option>
                  ))}
                </select>
              </label>
            )}

            <fieldset className={css.nestedFieldset}>
              <legend>{t('risks.field.assumptions')}</legend>
              <div className={css.stack}>
                {draft.assumptions.map((assumption, index) => (
                  <div className={css.assumption} key={index}>
                    <label className={css.field}>
                      <span>{t('risks.field.assumptions')} {index + 1}</span>
                      <textarea
                        rows={2}
                        required
                        maxLength={MAX_PROJECT_RISK_ASSUMPTION_LENGTH}
                        value={assumption}
                        onChange={event => {
                          const next = [...draft.assumptions]
                          next[index] = event.currentTarget.value
                          update('assumptions', next)
                        }}
                      />
                    </label>
                    <Button variant="outline" size="sm" type="button" onClick={() => {
                      update('assumptions', draft.assumptions.filter((_, candidate) => candidate !== index))
                    }}>
                      {t('risks.field.removeAssumption')} {index + 1}
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={draft.assumptions.length >= MAX_PROJECT_RISK_ASSUMPTIONS}
                onClick={() => { update('assumptions', [...draft.assumptions, '']) }}
              >{t('risks.field.addAssumption')}</Button>
            </fieldset>

            <fieldset className={css.nestedFieldset}>
              <legend>{t('risks.field.evidence')}</legend>
              <div className={css.choices}>
                {projection.evidenceOptions.map(option => (
                  <label key={evidenceId(option)}>
                    <input
                      type="checkbox"
                      checked={draft.evidence.some(value => evidenceId(value) === evidenceId(option))}
                      onChange={event => {
                        update('evidence', toggleEvidence(draft.evidence, option, event.currentTarget.checked))
                      }}
                    />
                    <span>{t(projectRiskEvidenceKindKey(option.kind))}: {evidenceLabel(option)}</span>
                  </label>
                ))}
                {draft.evidence.filter(value => !projection.evidenceOptions.some(
                  option => evidenceId(option) === evidenceId(value),
                )).map(value => (
                  <label key={evidenceId(value)}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => {
                        update('evidence', draft.evidence.filter(
                          candidate => evidenceId(candidate) !== evidenceId(value),
                        ))
                      }}
                    />
                    <span>{evidenceLabel(value)} · {t('risks.tasks.unavailable')}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={css.nestedFieldset}>
              <legend>{t('risks.field.dependencies')}</legend>
              <div className={css.choices}>
                {projection.dependencyOptions.map(option => (
                  <label key={option.riskId}>
                    <input
                      type="checkbox"
                      disabled={!option.selectable && !draft.dependencyRiskIds.includes(option.riskId)}
                      checked={draft.dependencyRiskIds.includes(option.riskId)}
                      onChange={event => {
                        update('dependencyRiskIds', toggleValue(
                          draft.dependencyRiskIds, option.riskId, event.currentTarget.checked,
                        ))
                      }}
                    />
                    <span>{option.statement.event} · {option.riskId}</span>
                  </label>
                ))}
                {draft.dependencyRiskIds.filter(riskId => !projection.dependencyOptions.some(
                  option => option.riskId === riskId,
                )).map(riskId => (
                  <label key={riskId}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => {
                        update('dependencyRiskIds', draft.dependencyRiskIds.filter(
                          value => value !== riskId,
                        ))
                      }}
                    />
                    <span><code>{riskId}</code> · {t('risks.tasks.unavailable')}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <TreatmentTaskChoices
              legend={t('risks.tasks.mitigation')}
              unavailableLabel={t('risks.tasks.unavailable')}
              selected={draft.mitigationTaskGuids}
              projection={projection}
              onChange={values => {
                onChange({
                  ...draft,
                  mitigationTaskGuids: values,
                  contingencyTaskGuids: draft.contingencyTaskGuids.filter(
                    taskGuid => !values.includes(taskGuid),
                  ),
                })
              }}
            />
            <TreatmentTaskChoices
              legend={t('risks.tasks.contingency')}
              unavailableLabel={t('risks.tasks.unavailable')}
              selected={draft.contingencyTaskGuids}
              projection={projection}
              onChange={values => {
                onChange({
                  ...draft,
                  contingencyTaskGuids: values,
                  mitigationTaskGuids: draft.mitigationTaskGuids.filter(
                    taskGuid => !values.includes(taskGuid),
                  ),
                })
              }}
            />
          </div>
        </details>

        <div className={css.actions}>
          {onCancel !== undefined && (
            <Button variant="outline" size="sm" type="button" onClick={onCancel}>
              {t('risks.revise.cancel')}
            </Button>
          )}
          <Button variant="primary" size="sm" type="submit" disabled={!canSubmit || pending}>
            {pending
              ? t(mode === 'create' ? 'risks.create.pending' : 'risks.revise.pending')
              : t(mode === 'create' ? 'risks.create.action' : 'risks.revise.action')}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}

function TreatmentTaskChoices({
  legend,
  unavailableLabel,
  selected,
  projection,
  onChange,
}: {
  readonly legend: string
  readonly unavailableLabel: string
  readonly selected: readonly string[]
  readonly projection: ProjectRisksProjection
  readonly onChange: (values: readonly string[]) => void
}) {
  const projected = new Set(projection.taskOptions.map(task => task.taskGuid))
  const unavailable = selected.filter(taskGuid => !projected.has(taskGuid))
  return (
    <fieldset className={css.nestedFieldset}>
      <legend>{legend}</legend>
      {projection.taskOptions.length === 0 && unavailable.length === 0
        ? <p className={css.hint}>—</p> : (
        <div className={css.choices}>
          {projection.taskOptions.map(task => (
            <label key={task.taskGuid}>
              <input
                type="checkbox"
                checked={selected.includes(task.taskGuid)}
                onChange={event => {
                  onChange(toggleValue(selected, task.taskGuid, event.currentTarget.checked))
                }}
              />
              <span>{task.summary}</span>
            </label>
          ))}
          {unavailable.map(taskGuid => (
            <label key={taskGuid}>
              <input
                type="checkbox"
                checked
                onChange={() => { onChange(selected.filter(value => value !== taskGuid)) }}
              />
              <span><code>{taskGuid}</code> · {unavailableLabel}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function RiskTreatmentGroups({
  risk,
  t,
}: {
  readonly risk: ProjectRiskProjection
  readonly t: ProjectRisksPanelProps['t']
}) {
  return (
    <div className={css.treatments}>
      {(['mitigation', 'contingency'] as const).map(role => {
        const links = risk.treatmentTasks.filter(link => link.role === role)
        return (
          <fieldset className={css.taskGroup} key={role}>
            <legend>{t(role === 'mitigation' ? 'risks.tasks.mitigation' : 'risks.tasks.contingency')}</legend>
            {links.length === 0 ? <p>{t('risks.tasks.empty')}</p> : (
              <ul>
                {links.map(link => (
                  <li key={link.taskGuid}>
                    {link.availability === 'available' && link.task !== null ? (
                      <a href={link.task.canonicalUrl}>{link.task.summary}</a>
                    ) : (
                      <><code>{link.taskGuid}</code> · <span>{t('risks.tasks.unavailable')}</span></>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}

function AssessmentSummary({
  assessment,
  t,
}: {
  readonly assessment: ProjectRiskAssessmentProjection
  readonly t: ProjectRisksPanelProps['t']
}) {
  return (
    <>
      <p className={css.consequence}>{assessment.statement.consequence}</p>
      <dl className={css.meta}>
        <div><dt>{t('risks.card.condition')}</dt><dd>{assessment.statement.condition ?? '—'}</dd></div>
        <div><dt>{t('risks.card.category')}</dt><dd>{t(projectRiskCategoryKey(assessment.category))}</dd></div>
        <div><dt>{t('risks.card.owner')}</dt><dd>{assessment.responsibility.accountable.displayName}</dd></div>
        <div>
          <dt>{t('risks.card.trigger')}</dt>
          <dd>
            <span>{assessment.trigger.statement}</span>
            {' · '}
            <span>{t(projectRiskTriggerStateKey(assessment.trigger.state))}</span>
          </dd>
        </div>
        <div><dt>{t('risks.card.review')}</dt><dd><time dateTime={assessment.nextReviewOn}>{assessment.nextReviewOn}</time></dd></div>
        <div><dt>{t('risks.card.confidence')}</dt><dd>{t(projectRiskConfidenceKey(assessment.confidence))}</dd></div>
        <div><dt>{t('risks.card.assessedAt')}</dt><dd><time dateTime={assessment.assessedAt}>{assessment.assessedAt}</time></dd></div>
        {assessment.trigger.observedAt !== null && (
          <div><dt>{t('risks.trigger.observedAt')}</dt><dd><time dateTime={assessment.trigger.observedAt}>{assessment.trigger.observedAt}</time></dd></div>
        )}
      </dl>
      <section className={css.exposure} aria-label={t('risks.exposure.title')} data-exposure={assessment.exposure.level}>
        <header>
          <h4>{t('risks.exposure.title')}</h4>
          <strong>{t(projectRiskExposureLevelKey(assessment.exposure.level))}</strong>
        </header>
        <p>{t(projectRiskLikelihoodBandKey(assessment.exposure.likelihoodBand))}</p>
        <p>{t(projectRiskImpactBandKey(assessment.exposure.impactBand))}</p>
        <p>{assessment.probability.lowerBasisPoints}–{assessment.probability.upperBasisPoints} bp · I{assessment.impact.lowerBand}–I{assessment.impact.upperBand}</p>
        <p>{t('risks.exposure.policy')} <code>{assessment.exposure.policyVersion}</code></p>
        <p className={css.hint}>{t('risks.exposure.matrixHint')}</p>
      </section>
    </>
  )
}

function HistoryFact({
  name,
  label,
  children,
}: {
  readonly name: string
  readonly label: string
  readonly children: ReactNode
}) {
  return <div data-history-fact={name}><dt>{label}</dt><dd>{children}</dd></div>
}

function HistoryStringValues({
  values,
  t,
}: {
  readonly values: readonly string[]
  readonly t: ProjectRisksPanelProps['t']
}) {
  if (values.length === 0) return <>{t('risks.history.none')}</>
  return <ul className={css.historyValues}>{values.map(value => <li key={value}>{value}</li>)}</ul>
}

function HistoryMember({
  member,
  t,
}: {
  readonly member: ProjectRiskMemberSnapshot | null
  readonly t: ProjectRisksPanelProps['t']
}) {
  if (member === null) return <>{t('risks.history.none')}</>
  return (
    <>
      <span>{member.displayName}</span>
      {' · '}
      <span>{t(member.kind === 'human' ? 'risks.member.human' : 'risks.member.agent')}</span>
      {' · '}
      <code>{member.memberId}</code>
    </>
  )
}

function HistoryMembers({
  members,
  t,
}: {
  readonly members: readonly ProjectRiskMemberSnapshot[]
  readonly t: ProjectRisksPanelProps['t']
}) {
  if (members.length === 0) return <>{t('risks.history.none')}</>
  return (
    <ul className={css.historyValues}>
      {members.map(member => (
        <li key={member.memberId}><HistoryMember member={member} t={t} /></li>
      ))}
    </ul>
  )
}

function HistoryEvidence({
  values,
  t,
}: {
  readonly values: readonly ProjectRiskEvidenceRef[]
  readonly t: ProjectRisksPanelProps['t']
}) {
  if (values.length === 0) return <>{t('risks.history.none')}</>
  return (
    <ul className={css.historyValues}>
      {values.map(value => (
        <li key={evidenceId(value)}>
          <span>{t(projectRiskEvidenceKindKey(value.kind))}</span>
          {': '}
          <code>{evidenceLabel(value)}</code>
        </li>
      ))}
    </ul>
  )
}

function HistoryEntrySource({
  entry,
  t,
}: {
  readonly entry: ProjectRiskHistoryEntry
  readonly t: ProjectRisksPanelProps['t']
}) {
  return (
    <>
      <HistoryFact name="source" label={t('risks.history.source')}>
        <span>{t('risks.history.source.auditEvent')}</span>
        {' ('}<code>{entry.source.kind}</code>{'): '}
        <code>{entry.source.auditEventId}</code>
      </HistoryFact>
      <HistoryFact name="actor" label={t('risks.history.actor')}>
        <span>{t('risks.actor.owner')}</span>{': '}<code>{entry.actor.id}</code>
      </HistoryFact>
      <HistoryFact name="causation" label={t('risks.history.causation')}>
        <code>{entry.causationId}</code>
      </HistoryFact>
    </>
  )
}

function AssessmentHistoryEntry({
  entry,
  t,
}: {
  readonly entry: Extract<ProjectRiskHistoryEntry, { readonly kind: 'assessment' }>
  readonly t: ProjectRisksPanelProps['t']
}) {
  const value = entry.assessment
  return (
    <details className={css.historyEntry} data-history-kind="assessment">
      <summary>
        <span>{t('risks.history.assessment')}</span>
        {' · '}{entry.sequence}
      </summary>
      <dl className={css.historyFacts}>
        <HistoryFact name="entry-sequence" label={t('risks.history.entrySequence')}>
          {entry.sequence}
        </HistoryFact>
        <HistoryFact name="assessment-id" label={t('risks.history.assessmentId')}>
          <code>{value.assessmentId}</code>
        </HistoryFact>
        <HistoryFact name="version-sequence" label={t('risks.history.versionSequence')}>
          {value.sequence}
        </HistoryFact>
        <HistoryFact name="condition" label={t('risks.field.condition')}>
          {value.statement.condition ?? t('risks.history.none')}
        </HistoryFact>
        <HistoryFact name="event" label={t('risks.field.event')}>{value.statement.event}</HistoryFact>
        <HistoryFact name="consequence" label={t('risks.field.consequence')}>
          {value.statement.consequence}
        </HistoryFact>
        <HistoryFact name="category" label={t('risks.field.category')}>
          {t(projectRiskCategoryKey(value.category))}
        </HistoryFact>
        <HistoryFact name="trigger-statement" label={t('risks.field.triggerStatement')}>
          {value.trigger.statement}
        </HistoryFact>
        <HistoryFact name="trigger-state" label={t('risks.field.triggerState')}>
          {t(projectRiskTriggerStateKey(value.trigger.state))}
        </HistoryFact>
        <HistoryFact name="trigger-observed-at" label={t('risks.trigger.observedAt')}>
          {value.trigger.observedAt === null ? t('risks.history.none') : (
            <time dateTime={value.trigger.observedAt}>{value.trigger.observedAt}</time>
          )}
        </HistoryFact>
        <HistoryFact name="probability" label={t('risks.history.probability')}>
          {value.probability.lowerBasisPoints}–{value.probability.upperBasisPoints} bp
        </HistoryFact>
        <HistoryFact name="impact" label={t('risks.history.impact')}>
          I{value.impact.lowerBand}–I{value.impact.upperBand}
        </HistoryFact>
        <HistoryFact name="confidence" label={t('risks.field.confidence')}>
          {t(projectRiskConfidenceKey(value.confidence))}
        </HistoryFact>
        <HistoryFact name="confidence-rationale" label={t('risks.field.confidenceRationale')}>
          {value.confidenceRationale}
        </HistoryFact>
        <HistoryFact name="horizon" label={t('risks.field.horizon')}>
          <time dateTime={value.assessmentHorizonEnd}>{value.assessmentHorizonEnd}</time>
        </HistoryFact>
        <HistoryFact name="next-review" label={t('risks.field.nextReview')}>
          <time dateTime={value.nextReviewOn}>{value.nextReviewOn}</time>
        </HistoryFact>
        <HistoryFact name="assumptions" label={t('risks.field.assumptions')}>
          <HistoryStringValues values={value.assumptions} t={t} />
        </HistoryFact>
        <HistoryFact name="accountable" label={t('risks.field.owner')}>
          <HistoryMember member={value.responsibility.accountable} t={t} />
        </HistoryFact>
        <HistoryFact name="contributors" label={t('risks.field.contributors')}>
          <HistoryMembers members={value.responsibility.contributors} t={t} />
        </HistoryFact>
        <HistoryFact name="human-sponsor" label={t('risks.field.sponsor')}>
          <HistoryMember member={value.responsibility.humanSponsor} t={t} />
        </HistoryFact>
        <HistoryFact name="evidence" label={t('risks.field.evidence')}>
          <HistoryEvidence values={value.evidence} t={t} />
        </HistoryFact>
        <HistoryFact name="dependencies" label={t('risks.field.dependencies')}>
          {value.dependencies.length === 0 ? t('risks.history.none') : (
            <ul className={css.historyValues}>
              {value.dependencies.map(dependency => (
                <li key={dependency.riskId}>
                  <span>{t('risks.history.dependency.dependsOn')}</span>
                  {' ('}<code>{dependency.kind}</code>{'): '}
                  <code>{dependency.riskId}</code>
                </li>
              ))}
            </ul>
          )}
        </HistoryFact>
        <HistoryFact name="mitigation-tasks" label={t('risks.tasks.mitigation')}>
          <HistoryStringValues values={value.mitigationTaskGuids} t={t} />
        </HistoryFact>
        <HistoryFact name="contingency-tasks" label={t('risks.tasks.contingency')}>
          <HistoryStringValues values={value.contingencyTaskGuids} t={t} />
        </HistoryFact>
        <HistoryFact name="exposure" label={t('risks.exposure.title')}>
          <span>{t(projectRiskExposureLevelKey(value.exposure.level))}</span>
          {' · '}
          <span>{t(projectRiskLikelihoodBandKey(value.exposure.likelihoodBand))}</span>
          {' · '}
          <span>{t(projectRiskImpactBandKey(value.exposure.impactBand))}</span>
          {' · '}
          <code>{value.exposure.policyVersion}</code>
        </HistoryFact>
        <HistoryFact name="digest" label={t('risks.history.digest')}>
          <code>{value.digest}</code>
        </HistoryFact>
        <HistoryFact name="assessed-at" label={t('risks.history.assessedAt')}>
          <time dateTime={value.assessedAt}>{value.assessedAt}</time>
        </HistoryFact>
        <HistoryEntrySource entry={entry} t={t} />
      </dl>
    </details>
  )
}

function TransitionHistoryEntry({
  entry,
  t,
}: {
  readonly entry: Extract<ProjectRiskHistoryEntry, { readonly kind: 'transition' }>
  readonly t: ProjectRisksPanelProps['t']
}) {
  const value = entry.transition
  return (
    <details className={css.historyEntry} data-history-kind="transition">
      <summary>
        <span>{t('risks.history.transition')}</span>
        {' · '}{entry.sequence}
      </summary>
      <dl className={css.historyFacts}>
        <HistoryFact name="entry-sequence" label={t('risks.history.entrySequence')}>
          {entry.sequence}
        </HistoryFact>
        <HistoryFact name="transition-id" label={t('risks.history.transitionId')}>
          <code>{value.transitionId}</code>
        </HistoryFact>
        <HistoryFact name="version-sequence" label={t('risks.history.versionSequence')}>
          {value.sequence}
        </HistoryFact>
        <HistoryFact name="from-status" label={t('risks.history.fromStatus')}>
          {t(projectRiskStatusKey(value.fromStatus))}
        </HistoryFact>
        <HistoryFact name="to-status" label={t('risks.history.toStatus')}>
          {t(projectRiskStatusKey(value.toStatus))}
        </HistoryFact>
        <HistoryFact name="rationale" label={t('risks.transition.rationale')}>
          {value.rationale}
        </HistoryFact>
        <HistoryFact name="closure-reason" label={t('risks.transition.closureReason')}>
          {value.closureReason === null
            ? t('risks.history.none') : t(projectRiskClosureReasonKey(value.closureReason))}
        </HistoryFact>
        <HistoryFact name="occurred-at" label={t('risks.history.occurredAt')}>
          <time dateTime={value.occurredAt}>{value.occurredAt}</time>
        </HistoryFact>
        <HistoryEntrySource entry={entry} t={t} />
      </dl>
    </details>
  )
}

function RiskHistory({
  selected,
  loading,
  controller,
  t,
}: {
  readonly selected: ProjectRiskSelectedProjection
  readonly loading: boolean
  readonly controller: WorkbenchProjectRisksController
  readonly t: ProjectRisksPanelProps['t']
}) {
  return (
    <details className={css.history} data-project-risk-history={selected.risk.riskId}>
      <summary className={css.historySummary}>
        <span>{t('risks.history.title')}</span>
        {' · '}
        <code>{selected.risk.riskId}</code>
      </summary>
      <div className={css.historyBody}>
        {selected.history.length === 0 ? <p>{t('risks.history.empty')}</p> : (
          <ol>
            {selected.history.map(entry => (
              <li key={`${entry.kind}:${entry.sequence}`}>
                {entry.kind === 'assessment'
                  ? <AssessmentHistoryEntry entry={entry} t={t} />
                  : <TransitionHistoryEntry entry={entry} t={t} />}
              </li>
            ))}
          </ol>
        )}
        {selected.nextBeforeHistorySequence !== null && (
          <Button variant="outline" size="sm" type="button" onClick={() => {
            void controller.loadMoreHistory()
          }}>{t(loading ? 'risks.history.loadingMore' : 'risks.history.loadMore')}</Button>
        )}
      </div>
    </details>
  )
}

function TransitionForm({
  controller,
  risk,
  state,
  t,
}: {
  readonly controller: WorkbenchProjectRisksController
  readonly risk: ProjectRiskProjection
  readonly state: WorkbenchProjectRisksClientState
  readonly t: ProjectRisksPanelProps['t']
}) {
  const draft = state.transitionDrafts[risk.riskId] ?? defaultTransition(risk.status)
  const setDraft = (next: WorkbenchProjectRiskTransitionDraft): void => {
    controller.setTransitionDraft(risk.riskId, next)
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setDraft(draft)
    void controller.transition(risk.riskId)
  }
  return (
    <form className={css.transition} aria-label={t('risks.transition.legend')} onSubmit={submit}>
      <fieldset
        className={css.nestedFieldset}
        disabled={state.pendingOperation !== null || state.canRetryMutation}
      >
        <legend>{t('risks.transition.legend')}</legend>
        <label className={css.field}>
          <span>{t('risks.transition.status')}</span>
          <select
            value={draft.status}
            onChange={event => {
              const status = event.currentTarget.value as ProjectRiskStatus
              setDraft({ ...draft, status, closureReason: status === 'closed' ? draft.closureReason : '' })
            }}
          >
            {STATUSES.filter(status => status !== risk.status).map(status => (
              <option key={status} value={status}>{t(projectRiskStatusKey(status))}</option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('risks.transition.rationale')}</span>
          <textarea
            rows={2}
            required
            maxLength={MAX_PROJECT_RISK_TRANSITION_RATIONALE_LENGTH}
            value={draft.rationale}
            onChange={event => { setDraft({ ...draft, rationale: event.currentTarget.value }) }}
          />
        </label>
        {draft.status === 'closed' && (
          <label className={css.field}>
            <span>{t('risks.transition.closureReason')}</span>
            <select
              required
              value={draft.closureReason}
              onChange={event => {
                setDraft({ ...draft, closureReason: event.currentTarget.value as ProjectRiskClosureReason })
              }}
            >
              <option value="">{t('risks.transition.choose')}</option>
              {CLOSURE_REASONS.map(reason => (
                <option key={reason} value={reason}>{t(projectRiskClosureReasonKey(reason))}</option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="outline"
          size="sm"
          type="submit"
          disabled={!controller.canTransition(risk.riskId)}
        >
          {state.pendingOperation === 'transition-risk' && state.pendingRiskId === risk.riskId
            ? t('risks.transition.pending') : t('risks.transition.action')}
        </Button>
      </fieldset>
    </form>
  )
}

export function ProjectRisksPanel({ controller, t }: ProjectRisksPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const projection = state.projection
  const presentation = phasePresentation(state)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const pending = state.pendingOperation !== null
  const mutationLocked = pending || state.canRetryMutation

  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusRiskId === null) return
    cardRefs.current.get(state.focusRiskId)?.focus({ preventScroll: true })
  }, [state.focusEpoch, state.focusRiskId])

  const submitFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void controller.applyFilters()
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-project-risks-title"
      aria-busy={state.phase === 'loading' || pending}
      data-project-risks-phase={state.phase}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('risks.kicker')}</p>
          <h2 id="workbench-project-risks-title" className={css.title}>{t('risks.title')}</h2>
          <p className={css.subtitle}>{t('risks.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.selection === null ? <p className={css.empty}>{t('risks.noProject')}</p> : (
        <>
          <div className={css.projectContext}>
            <span>{t('risks.project.label')}</span>
            <strong>{state.selection.projectName || state.selection.projectId}</strong>
          </div>

          {state.issue !== null && (
            <div className={css.issue} role="alert">
              <strong>{t('risks.error.title')}</strong>
              <p>{t(state.issue.code === 'risk-review-overdue'
                ? 'risks.error.overdue'
                : state.issue.kind === 'transport' ? 'risks.error.transport'
                  : state.issue.kind === 'input' ? 'risks.error.input' : 'risks.error.conflict')}</p>
              <code>{state.issue.code}</code>
              <div className={css.actions}>
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  void controller.refresh()
                }}>{t('risks.refresh')}</Button>
              </div>
            </div>
          )}

          {state.canRetryMutation && (
            <div className={css.actions}>
              <Button variant="outline" size="sm" type="button" onClick={() => {
                void controller.retryMutation()
              }}>{t('risks.retryExact')}</Button>
            </div>
          )}

          {projection !== null && (
            <>
              <form className={css.filters} aria-label={t('risks.filters.legend')} onSubmit={submitFilters}>
                <fieldset className={css.fieldset} disabled={mutationLocked}>
                  <legend>{t('risks.filters.legend')}</legend>
                  <div className={css.threeColumn}>
                    <label className={css.field}>
                      <span>{t('risks.filters.exposure')}</span>
                      <select
                        value={state.filters.exposure}
                        onChange={event => { controller.setFilters({ ...state.filters, exposure: event.currentTarget.value as typeof state.filters.exposure }) }}
                      >
                        <option value="">{t('risks.filters.all')}</option>
                        {(['low', 'medium', 'high'] as const).map(value => (
                          <option key={value} value={value}>{t(projectRiskExposureLevelKey(value))}</option>
                        ))}
                      </select>
                    </label>
                    <label className={css.field}>
                      <span>{t('risks.filters.status')}</span>
                      <select
                        value={state.filters.status}
                        onChange={event => { controller.setFilters({ ...state.filters, status: event.currentTarget.value as typeof state.filters.status }) }}
                      >
                        <option value="">{t('risks.filters.all')}</option>
                        {STATUSES.map(value => <option key={value} value={value}>{t(projectRiskStatusKey(value))}</option>)}
                      </select>
                    </label>
                    <label className={css.field}>
                      <span>{t('risks.filters.owner')}</span>
                      <select
                        value={state.filters.riskOwnerMemberId}
                        onChange={event => { controller.setFilters({ ...state.filters, riskOwnerMemberId: event.currentTarget.value }) }}
                      >
                        <option value="">{t('risks.filters.all')}</option>
                        {projection.memberOptions.map(member => (
                          <option key={member.memberId} value={member.memberId}>{member.displayName}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={css.twoColumn}>
                    <fieldset className={css.nestedFieldset}>
                      <legend>{t('risks.filters.trigger')}</legend>
                      <label className={css.field}>
                        <span>{t('risks.filters.triggerState')}</span>
                        <select
                          value={state.filters.triggerState}
                          onChange={event => { controller.setFilters({ ...state.filters, triggerState: event.currentTarget.value as typeof state.filters.triggerState }) }}
                        >
                          <option value="">{t('risks.filters.all')}</option>
                          {TRIGGER_STATES.map(value => <option key={value} value={value}>{t(projectRiskTriggerStateKey(value))}</option>)}
                        </select>
                      </label>
                      <label className={css.field}>
                        <span>{t('risks.filters.triggerText')}</span>
                        <input
                          value={state.filters.triggerContains}
                          onChange={event => { controller.setFilters({ ...state.filters, triggerContains: event.currentTarget.value }) }}
                        />
                      </label>
                    </fieldset>
                    <fieldset className={css.nestedFieldset}>
                      <legend>{t('risks.filters.review')}</legend>
                      <label className={css.field}>
                        <span>{t('risks.filters.reviewFrom')}</span>
                        <input
                          type="date"
                          value={state.filters.reviewFrom}
                          onChange={event => { controller.setFilters({ ...state.filters, reviewFrom: event.currentTarget.value }) }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('risks.filters.reviewTo')}</span>
                        <input
                          type="date"
                          value={state.filters.reviewTo}
                          onChange={event => { controller.setFilters({ ...state.filters, reviewTo: event.currentTarget.value }) }}
                        />
                      </label>
                    </fieldset>
                  </div>
                  <div className={css.actions}>
                    <Button variant="outline" size="sm" type="button" onClick={() => {
                      controller.setFilters({
                        exposure: '', status: '', riskOwnerMemberId: '', triggerState: '',
                        triggerContains: '', reviewFrom: '', reviewTo: '',
                      })
                    }}>{t('risks.filters.reset')}</Button>
                    <Button variant="primary" size="sm" type="submit">{t('risks.filters.apply')}</Button>
                  </div>
                </fieldset>
              </form>

              <details className={css.create}>
                <summary>{t('risks.create.summary')}</summary>
                <div className={css.createBody}>
                  <p>{t('risks.create.body')}</p>
                  <AssessmentForm
                    controller={controller}
                    draft={state.createDraft}
                    projection={projection}
                    t={t}
                    mode="create"
                    pending={mutationLocked}
                    onChange={draft => { controller.setCreateDraft(draft) }}
                    onSubmit={() => { void controller.create() }}
                  />
                </div>
              </details>

              <div className={css.list}>
                {projection.risks.length === 0 ? <p className={css.empty}>{t('risks.list.empty')}</p> : (
                  projection.risks.map(risk => (
                    <article
                      className={css.card}
                      key={risk.riskId}
                      aria-label={risk.currentAssessment.statement.event}
                      tabIndex={-1}
                      ref={node => {
                        if (node === null) cardRefs.current.delete(risk.riskId)
                        else cardRefs.current.set(risk.riskId, node)
                      }}
                    >
                      <header className={css.cardHeader}>
                        <div>
                          <p className={css.riskId}><code>{risk.riskId}</code></p>
                          <h3>{risk.currentAssessment.statement.event}</h3>
                        </div>
                        <span className={css.statusBadge}>{t(projectRiskStatusKey(risk.status))}</span>
                      </header>
                      <AssessmentSummary assessment={risk.currentAssessment} t={t} />
                      <RiskTreatmentGroups risk={risk} t={t} />

                      {risk.status === 'closed' ? (
                        <div className={css.terminal}>
                          {risk.closureReason !== null && <strong>{t(projectRiskClosureReasonKey(risk.closureReason))}</strong>}
                          <p>{t('risks.closed.terminal')}</p>
                        </div>
                      ) : (
                        <>
                          <div className={css.actions}>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              disabled={mutationLocked}
                              onClick={() => {
                              controller.beginRevision(risk.riskId)
                              }}
                            >{t('risks.action.revise')}</Button>
                          </div>
                          {state.revisionDraft?.riskId === risk.riskId && (
                            <AssessmentForm
                              controller={controller}
                              draft={state.revisionDraft.draft}
                              projection={projection}
                              t={t}
                              mode="revise"
                              pending={mutationLocked}
                              onChange={draft => { controller.setRevisionDraft(draft) }}
                              onSubmit={() => { void controller.revise() }}
                              onCancel={() => { controller.cancelRevision() }}
                            />
                          )}
                          <TransitionForm controller={controller} risk={risk} state={state} t={t} />
                        </>
                      )}

                      <Button variant="outline" size="sm" type="button" onClick={() => {
                        void controller.selectRisk(risk.riskId)
                      }}>{t('risks.history.open')}</Button>
                    </article>
                  ))
                )}
              </div>

              {projection.nextBeforeRiskSequence !== null && (
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  void controller.loadMoreRisks()
                }}>{t(state.loadingMore === 'risks' ? 'risks.list.loadingMore' : 'risks.list.loadMore')}</Button>
              )}

              {projection.selectedRisk !== null && (
                <RiskHistory
                  selected={projection.selectedRisk}
                  loading={state.loadingMore === 'history'}
                  controller={controller}
                  t={t}
                />
              )}

              <section className={css.activity} aria-labelledby="workbench-project-risk-activity-title">
                <h3 id="workbench-project-risk-activity-title">{t('risks.activity.title')}</h3>
                {projection.activity.length === 0 ? <p>{t('risks.activity.empty')}</p> : (
                  <ol>
                    {projection.activity.map(entry => (
                      <li key={entry.activityId}>
                        <strong>{t(projectRiskActivityActionKey(entry.action))}</strong>
                        {' · '}<code>{entry.riskId}</code>
                        {' · '}<time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                      </li>
                    ))}
                  </ol>
                )}
                {projection.nextBeforeActivitySequence !== null && (
                  <Button variant="outline" size="sm" type="button" onClick={() => {
                    void controller.loadMoreActivity()
                  }}>{t(state.loadingMore === 'activity' ? 'risks.activity.loadingMore' : 'risks.activity.loadMore')}</Button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}
