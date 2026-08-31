/** Accessible Project-scoped roster and whole-responsibility editor. */

import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectMemberProjection } from '@benz-ai-x/dsh-project-workbench/client'
import type { WorkbenchKey } from './locales.ts'
import {
  MAX_EXTERNAL_CONTACT_LENGTH,
  MAX_FEISHU_APP_ID_LENGTH,
  MAX_FEISHU_OPEN_ID_LENGTH,
  MAX_PROJECT_MEMBER_NAME_LENGTH,
  MAX_PROJECT_TEAM_CONTRIBUTORS,
  MAX_PROJECT_TEAM_MEMBERS,
  requiresHumanSponsor,
  type WorkbenchProjectTeamClientState,
  type WorkbenchProjectTeamController,
  type WorkbenchProjectTeamIssue,
} from './project-team-controller.ts'
import css from './ProjectTeamPanel.module.css'

export interface ProjectTeamPanelProps {
  readonly controller: WorkbenchProjectTeamController
  readonly t: (key: WorkbenchKey) => string
}

function phasePresentation(state: WorkbenchProjectTeamClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', key: 'team.status.pending' }
  }
  switch (state.phase) {
    case 'idle': return { dot: 'done', key: 'team.status.ready' }
    case 'loading': return { dot: 'ongoing', key: 'team.status.loading' }
    case 'ready': return { dot: 'done', key: 'team.status.ready' }
    case 'stale': return { dot: 'warning', key: 'team.status.stale' }
    case 'error': return { dot: 'error', key: 'team.status.error' }
    case 'conflict': return { dot: 'warning', key: 'team.status.conflict' }
  }
}

export function ProjectTeamPanel({ controller, t }: ProjectTeamPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const memberRefs = useRef(new Map<string, HTMLElement>())
  const presentation = phasePresentation(state)

  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusMemberId === null) return
    memberRefs.current.get(state.focusMemberId)?.focus({ preventScroll: true })
  }, [state.focusEpoch, state.focusMemberId])

  const memberById = useMemo(() => new Map(
    state.team?.members.map(member => [member.memberId, member] as const) ?? [],
  ), [state.team])
  const active = state.team?.members.filter(member => member.status === 'active') ?? []
  const inactive = state.team?.members.filter(member => member.status === 'inactive') ?? []
  const accountable = memberById.get(state.responsibilityDraft.accountableMemberId) ?? null
  const sponsorRequired = accountable !== null
    && accountable.status === 'active'
    && requiresHumanSponsor(accountable)

  const submitMember = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canAddMember()) void controller.addMember()
  }
  const submitResponsibility = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canSaveResponsibility()) void controller.saveResponsibility()
  }

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-project-team-title"
      aria-busy={state.phase === 'loading' || state.pendingOperation !== null}
      data-project-team-phase={state.phase}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{t('team.kicker')}</p>
          <h2 id="workbench-project-team-title" className={css.title}>{t('team.title')}</h2>
          <p className={css.subtitle}>{t('team.subtitle')}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{t(presentation.key)}</span>
        </div>
      </header>

      {state.selection === null ? (
        <p className={css.emptyBlock}>{t('team.noProject')}</p>
      ) : (
        <>
          <dl className={css.teamMeta}>
            <div>
              <dt>{t('team.meta.project')}</dt>
              <dd>{state.selection.projectName || state.selection.projectId}</dd>
            </div>
            <div>
              <dt>{t('team.meta.revision')}</dt>
              <dd>{state.team?.teamRevision ?? '—'}</dd>
            </div>
          </dl>

          {state.phase === 'loading' && state.team === null && (
            <p className={css.notice} role="status">{t('team.loading')}</p>
          )}
          {state.phase === 'stale' && (
            <p className={css.stale} role="status">{t('team.stale')}</p>
          )}
          {state.issue !== null && (
            <ProjectTeamIssue issue={state.issue} state={state} controller={controller} t={t} />
          )}

          {state.team !== null && (
            <>
              <details className={css.addDisclosure}>
                <summary>{t('team.add.summary')}</summary>
                <div className={css.disclosureBody}>
                  <p>{t('team.add.body')}</p>
                  <form aria-busy={state.pendingOperation === 'add-member'} onSubmit={submitMember}>
                    <fieldset
                      className={css.fieldset}
                      disabled={state.pendingOperation !== null
                        || state.team.members.length >= MAX_PROJECT_TEAM_MEMBERS}
                    >
                      <legend>{t('team.form.identity.legend')}</legend>
                      <fieldset className={css.radioFieldset}>
                        <legend>{t('team.form.kind')}</legend>
                        <div className={css.radioChoices}>
                          <label>
                            <input
                              type="radio"
                              name="workbench-project-member-kind"
                              value="human"
                              checked={state.memberDraft.kind === 'human'}
                              onChange={() => { controller.setMemberKind('human') }}
                            />
                            <span>{t('team.form.kind.human')}</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="workbench-project-member-kind"
                              value="agent"
                              checked={state.memberDraft.kind === 'agent'}
                              onChange={() => { controller.setMemberKind('agent') }}
                            />
                            <span>{t('team.form.kind.agent')}</span>
                          </label>
                        </div>
                      </fieldset>

                      <label className={css.field}>
                        <span>{t('team.form.name')}</span>
                        <input
                          value={state.memberDraft.displayName}
                          required
                          maxLength={MAX_PROJECT_MEMBER_NAME_LENGTH}
                          autoComplete="off"
                          onChange={event => {
                            controller.setMemberDisplayName(event.currentTarget.value)
                          }}
                        />
                      </label>

                      {state.memberDraft.kind === 'human' && (
                        <fieldset className={css.radioFieldset}>
                          <legend>{t('team.form.humanIdentity')}</legend>
                          <div className={css.radioChoices}>
                            <label>
                              <input
                                type="radio"
                                name="workbench-human-identity-kind"
                                value="feishu"
                                checked={state.memberDraft.humanIdentity === 'feishu'}
                                onChange={() => { controller.setHumanIdentity('feishu') }}
                              />
                              <span>{t('team.form.identity.feishu')}</span>
                            </label>
                            <label>
                              <input
                                type="radio"
                                name="workbench-human-identity-kind"
                                value="external"
                                checked={state.memberDraft.humanIdentity === 'external'}
                                onChange={() => { controller.setHumanIdentity('external') }}
                              />
                              <span>{t('team.form.identity.external')}</span>
                            </label>
                          </div>
                        </fieldset>
                      )}

                      {state.memberDraft.kind === 'human'
                        && state.memberDraft.humanIdentity === 'feishu' && (
                        <div className={css.identityFields}>
                          <label className={css.field}>
                            <span>{t('team.form.feishu.appId')}</span>
                            <input
                              value={state.memberDraft.feishuAppId}
                              required
                              maxLength={MAX_FEISHU_APP_ID_LENGTH}
                              autoComplete="off"
                              onChange={event => {
                                controller.setFeishuAppId(event.currentTarget.value)
                              }}
                            />
                          </label>
                          <label className={css.field}>
                            <span>{t('team.form.feishu.openId')}</span>
                            <input
                              value={state.memberDraft.feishuOpenId}
                              required
                              maxLength={MAX_FEISHU_OPEN_ID_LENGTH}
                              autoComplete="off"
                              onChange={event => {
                                controller.setFeishuOpenId(event.currentTarget.value)
                              }}
                            />
                          </label>
                          <p className={css.fullHint}>{t('team.form.feishu.hint')}</p>
                        </div>
                      )}

                      {state.memberDraft.kind === 'human'
                        && state.memberDraft.humanIdentity === 'external' && (
                        <div className={css.identityFields}>
                          <label className={css.field}>
                            <span>{t('team.form.external.method')}</span>
                            <select
                              value={state.memberDraft.externalMethod}
                              onChange={event => {
                                const value = event.currentTarget.value
                                controller.setExternalMethod(value === 'phone'
                                  ? 'phone'
                                  : value === 'other'
                                    ? 'other'
                                    : 'email')
                              }}
                            >
                              <option value="email">{t('team.form.external.method.email')}</option>
                              <option value="phone">{t('team.form.external.method.phone')}</option>
                              <option value="other">{t('team.form.external.method.other')}</option>
                            </select>
                          </label>
                          <label className={css.field}>
                            <span>{t('team.form.external.value')}</span>
                            <input
                              value={state.memberDraft.externalValue}
                              required
                              maxLength={MAX_EXTERNAL_CONTACT_LENGTH}
                              autoComplete="off"
                              onChange={event => {
                                controller.setExternalValue(event.currentTarget.value)
                              }}
                            />
                          </label>
                          <p className={css.fullHint}>{t('team.form.external.hint')}</p>
                        </div>
                      )}
                    </fieldset>
                    <div className={css.formActions}>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={state.pendingOperation !== null || !state.memberDraftDirty}
                        onClick={() => { controller.resetMemberDraft() }}
                      >
                        {t('team.action.reset')}
                      </Button>
                      <Button variant="primary" type="submit" disabled={!controller.canAddMember()}>
                        {state.pendingOperation === 'add-member'
                          ? t('team.action.adding')
                          : t('team.action.add')}
                      </Button>
                    </div>
                  </form>
                </div>
              </details>

              <section className={css.roster} aria-labelledby="workbench-roster-title">
                <div className={css.sectionHeader}>
                  <div>
                    <h3 id="workbench-roster-title">{t('team.roster.title')}</h3>
                    <p>{t('team.roster.subtitle')}</p>
                  </div>
                  <span className={css.countBadge}>
                    {state.team.members.length}/{MAX_PROJECT_TEAM_MEMBERS}
                  </span>
                </div>
                {state.team.members.length === 0 ? (
                  <p className={css.emptyBlock}>{t('team.roster.empty')}</p>
                ) : (
                  <div className={css.rosterGroups}>
                    <MemberGroup
                      title={t('team.roster.active')}
                      members={active}
                      state={state}
                      controller={controller}
                      responsibility={state.team.responsibility}
                      registerRef={(memberId, node) => {
                        if (node === null) memberRefs.current.delete(memberId)
                        else memberRefs.current.set(memberId, node)
                      }}
                      t={t}
                    />
                    {inactive.length > 0 && (
                      <MemberGroup
                        title={t('team.roster.inactive')}
                        members={inactive}
                        state={state}
                        controller={controller}
                        responsibility={state.team.responsibility}
                        registerRef={(memberId, node) => {
                          if (node === null) memberRefs.current.delete(memberId)
                          else memberRefs.current.set(memberId, node)
                        }}
                        t={t}
                      />
                    )}
                  </div>
                )}
              </section>

              <section className={css.responsibility} aria-labelledby="workbench-responsibility-title">
                <div className={css.sectionHeader}>
                  <div>
                    <h3 id="workbench-responsibility-title">{t('team.responsibility.title')}</h3>
                    <p>{t('team.responsibility.body')}</p>
                  </div>
                  {state.team.responsibility !== null && (
                    <span className={css.countBadge}>
                      {t('team.meta.revision')} {state.team.responsibility.revision}
                    </span>
                  )}
                </div>

                <CurrentResponsibility state={state} memberById={memberById} t={t} />

                <form
                  className={css.responsibilityForm}
                  aria-busy={state.pendingOperation === 'set-responsibility'}
                  onSubmit={submitResponsibility}
                >
                  <fieldset className={css.fieldset} disabled={state.pendingOperation !== null}>
                    <legend>{t('team.responsibility.legend')}</legend>
                    <label className={css.field}>
                      <span>{t('team.responsibility.accountable')}</span>
                      <select
                        value={state.responsibilityDraft.accountableMemberId}
                        required
                        aria-describedby="workbench-accountable-hint"
                        onChange={event => { controller.setAccountable(event.currentTarget.value) }}
                      >
                        <option value="">{t('team.responsibility.accountable.placeholder')}</option>
                        {active.map(member => (
                          <option key={member.memberId} value={member.memberId}>
                            {member.displayName} · {memberKind(member, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p id="workbench-accountable-hint" className={css.fullHint}>
                      {t('team.responsibility.accountable.hint')}
                    </p>

                    <fieldset className={css.roleFieldset}>
                      <legend>{t('team.responsibility.contributors')}</legend>
                      <p className={css.fullHint}>{t('team.responsibility.contributors.hint')}</p>
                      <div className={css.contributorChoices}>
                        {active
                          .filter(member => member.memberId
                            !== state.responsibilityDraft.accountableMemberId)
                          .map(member => {
                            const checked = state.responsibilityDraft.contributorMemberIds
                              .includes(member.memberId)
                            const atLimit = state.responsibilityDraft.contributorMemberIds.length
                              >= MAX_PROJECT_TEAM_CONTRIBUTORS
                            return (
                              <label key={member.memberId}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!checked && atLimit}
                                  onChange={event => {
                                    controller.setContributor(
                                      member.memberId,
                                      event.currentTarget.checked,
                                    )
                                  }}
                                />
                                <span>{member.displayName}</span>
                              </label>
                            )
                          })}
                      </div>
                      {state.responsibilityDraft.contributorMemberIds.length
                        >= MAX_PROJECT_TEAM_CONTRIBUTORS && (
                        <p className={css.limitHint} role="status">
                          {t('team.limit.contributors')}
                        </p>
                      )}
                    </fieldset>

                    <label className={css.field}>
                      <span>{t('team.responsibility.sponsor')}</span>
                      <select
                        value={sponsorRequired
                          ? state.responsibilityDraft.humanSponsorMemberId
                          : ''}
                        required={sponsorRequired}
                        disabled={!sponsorRequired}
                        aria-describedby="workbench-sponsor-hint"
                        onChange={event => {
                          controller.setHumanSponsor(event.currentTarget.value)
                        }}
                      >
                        <option value="">{t('team.responsibility.sponsor.placeholder')}</option>
                        {active
                          .filter(member => member.kind === 'human'
                            && member.memberId !== state.responsibilityDraft.accountableMemberId)
                          .map(member => (
                            <option key={member.memberId} value={member.memberId}>
                              {member.displayName}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p id="workbench-sponsor-hint" className={sponsorRequired
                      ? css.sponsorRequired
                      : css.fullHint}
                    >
                      {t(sponsorRequired
                        ? 'team.responsibility.sponsor.required'
                        : 'team.responsibility.sponsor.notRequired')}
                    </p>

                    {state.responsibilityDraftDirty
                      && !controller.canSaveResponsibility()
                      && state.responsibilityDraft.accountableMemberId !== '' && (
                      <p className={css.invalidDraft} role="status">
                        {t('team.responsibility.invalidDraft')}
                      </p>
                    )}
                  </fieldset>
                  <div className={css.formActions}>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={state.pendingOperation !== null
                        || !state.responsibilityDraftDirty}
                      onClick={() => { controller.resetResponsibilityDraft() }}
                    >
                      {t('team.responsibility.action.reset')}
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={!controller.canSaveResponsibility()}
                    >
                      {state.pendingOperation === 'set-responsibility'
                        ? t('team.responsibility.action.saving')
                        : t('team.responsibility.action.save')}
                    </Button>
                  </div>
                </form>
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

function ProjectTeamIssue({
  issue,
  state,
  controller,
  t,
}: {
  readonly issue: WorkbenchProjectTeamIssue
  readonly state: WorkbenchProjectTeamClientState
  readonly controller: WorkbenchProjectTeamController
  readonly t: (key: WorkbenchKey) => string
}) {
  const title = issue.kind === 'transport'
    ? t('team.issue.transport.title')
    : issue.kind === 'input'
      ? t('team.issue.input.title')
      : t('team.issue.conflict.title')
  const body = issue.kind === 'transport'
    ? t('team.issue.transport.body')
    : issue.kind === 'input'
      ? issue.code === 'project-not-found'
        ? t('team.issue.project-not-found')
        : t('team.issue.input.body')
      : t(conflictCopyKey(issue.code))
  return (
    <div className={issue.kind === 'transport' ? css.error : css.conflict} role="alert">
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <div className={css.issueActions}>
        {issue.kind === 'transport' && state.canRetryMutation && (
          <button className={css.secondaryButton} type="button" onClick={() => {
            void controller.retryMutation()
          }}>
            {t('team.action.retry')}
          </button>
        )}
        <button className={css.secondaryButton} type="button" onClick={() => {
          void controller.refresh()
        }}>
          {t('team.action.refresh')}
        </button>
      </div>
    </div>
  )
}

function MemberGroup({
  title,
  members,
  state,
  controller,
  responsibility,
  registerRef,
  t,
}: {
  readonly title: string
  readonly members: readonly ProjectMemberProjection[]
  readonly state: WorkbenchProjectTeamClientState
  readonly controller: WorkbenchProjectTeamController
  readonly responsibility: WorkbenchProjectTeamClientState['team'] extends infer _T
    ? NonNullable<WorkbenchProjectTeamClientState['team']>['responsibility']
    : never
  readonly registerRef: (memberId: string, node: HTMLElement | null) => void
  readonly t: (key: WorkbenchKey) => string
}) {
  return (
    <section className={css.memberGroup} aria-label={title}>
      <h4>{title}</h4>
      <ul className={css.memberList}>
        {members.map(member => (
          <li key={member.memberId}>
            {(() => {
              const holdsCurrentRole = responsibility !== null && (
                responsibility.accountableMemberId === member.memberId
                || responsibility.contributorMemberIds.includes(member.memberId)
                || responsibility.humanSponsorMemberId === member.memberId
              )
              const reassignHintId = `workbench-project-member-reassign-${member.memberId}`
              return (
            <article
              ref={node => { registerRef(member.memberId, node) }}
              id={`workbench-project-member-${member.memberId}`}
              className={member.status === 'active' ? css.memberCard : css.inactiveCard}
              tabIndex={-1}
              aria-labelledby={`workbench-project-member-name-${member.memberId}`}
            >
              <div className={css.memberHeader}>
                <div>
                  <h5 id={`workbench-project-member-name-${member.memberId}`}>
                    {member.displayName}
                  </h5>
                  <p>{memberKind(member, t)} · {t(`team.member.status.${member.status}`)}</p>
                </div>
                <RoleBadges memberId={member.memberId} responsibility={responsibility} t={t} />
              </div>
              <MemberIdentity member={member} t={t} />
              <dl className={css.memberMeta}>
                <div><dt>ID</dt><dd><code>{member.memberId}</code></dd></div>
                <div><dt>{t('team.member.revision')}</dt><dd>{member.revision}</dd></div>
                <div>
                  <dt>{t('team.member.eligibility.label')}</dt>
                  <dd>{t(`team.member.eligibility.${member.feishuAssigneeEligibility}`)}</dd>
                </div>
              </dl>
              <div className={css.memberActions}>
                <button
                  className={css.secondaryButton}
                  type="button"
                  disabled={state.pendingOperation !== null
                    || (member.status === 'active' && holdsCurrentRole)}
                  aria-describedby={member.status === 'active' && holdsCurrentRole
                    ? reassignHintId
                    : undefined}
                  onClick={() => {
                    void controller.changeMemberStatus(
                      member.memberId,
                      member.status === 'active' ? 'inactive' : 'active',
                    )
                  }}
                >
                  {state.pendingOperation === 'member-status'
                    && state.pendingMemberId === member.memberId
                    ? t('team.member.action.updating')
                    : member.status === 'active'
                      ? t('team.member.action.deactivate')
                      : t('team.member.action.reactivate')}
                </button>
              </div>
              {member.status === 'active' && holdsCurrentRole && (
                <p id={reassignHintId} className={css.memberActionHint}>
                  {t('team.member.action.reassignFirst')}
                </p>
              )}
            </article>
              )
            })()}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RoleBadges({
  memberId,
  responsibility,
  t,
}: {
  readonly memberId: string
  readonly responsibility: NonNullable<WorkbenchProjectTeamClientState['team']>['responsibility']
  readonly t: (key: WorkbenchKey) => string
}) {
  if (responsibility === null) return null
  return (
    <div className={css.roleBadges} aria-label={t('team.responsibility.current')}>
      {responsibility.accountableMemberId === memberId && (
        <span>{t('team.responsibility.current.accountable')}</span>
      )}
      {responsibility.contributorMemberIds.includes(memberId) && (
        <span>{t('team.responsibility.current.contributors')}</span>
      )}
      {responsibility.humanSponsorMemberId === memberId && (
        <span>{t('team.responsibility.current.sponsor')}</span>
      )}
    </div>
  )
}

function MemberIdentity({
  member,
  t,
}: {
  readonly member: ProjectMemberProjection
  readonly t: (key: WorkbenchKey) => string
}) {
  if (member.kind === 'agent') {
    return <p className={css.identity}>{t('team.member.identity.agent')}</p>
  }
  if (member.identity.type === 'external') {
    return (
      <p className={css.identity}>
        <strong>{t('team.member.identity.external')}</strong>
        <span>{member.identity.method}: {member.identity.value}</span>
      </p>
    )
  }
  return (
    <div className={css.identity}>
      <strong>{t('team.member.identity.feishu')}</strong>
      <span>{t('team.member.feishu.declared')}</span>
      <dl>
        <div><dt>App ID</dt><dd><code>{member.identity.appId}</code></dd></div>
        <div><dt>open_id</dt><dd><code>{member.identity.openId}</code></dd></div>
      </dl>
    </div>
  )
}

function CurrentResponsibility({
  state,
  memberById,
  t,
}: {
  readonly state: WorkbenchProjectTeamClientState
  readonly memberById: ReadonlyMap<string, ProjectMemberProjection>
  readonly t: (key: WorkbenchKey) => string
}) {
  const responsibility = state.team?.responsibility ?? null
  if (responsibility === null) {
    return <p className={css.emptyBlock}>{t('team.responsibility.empty')}</p>
  }
  const memberName = (memberId: string): string => memberById.get(memberId)?.displayName ?? memberId
  return (
    <section className={css.currentResponsibility} aria-label={t('team.responsibility.current')}>
      <h4>{t('team.responsibility.current')}</h4>
      <dl>
        <div>
          <dt>{t('team.responsibility.current.accountable')}</dt>
          <dd>{memberName(responsibility.accountableMemberId)}</dd>
        </div>
        <div>
          <dt>{t('team.responsibility.current.contributors')}</dt>
          <dd>{responsibility.contributorMemberIds.length === 0
            ? t('team.responsibility.current.noContributors')
            : responsibility.contributorMemberIds.map(memberName).join(', ')}</dd>
        </div>
        <div>
          <dt>{t('team.responsibility.current.sponsor')}</dt>
          <dd>{responsibility.humanSponsorMemberId === null
            ? t('team.responsibility.current.noSponsor')
            : memberName(responsibility.humanSponsorMemberId)}</dd>
        </div>
      </dl>
    </section>
  )
}

function memberKind(member: ProjectMemberProjection, t: (key: WorkbenchKey) => string): string {
  return t(member.kind === 'human' ? 'team.member.kind.human' : 'team.member.kind.agent')
}

function conflictCopyKey(
  code: Extract<WorkbenchProjectTeamIssue, { readonly kind: 'conflict' }>['code'],
): WorkbenchKey {
  const keys = {
    'idempotency-conflict': 'team.issue.idempotency-conflict',
    'project-not-found': 'team.issue.project-not-found',
    'team-revision-conflict': 'team.issue.team-revision-conflict',
    'member-limit-reached': 'team.issue.member-limit-reached',
    'duplicate-feishu-identity': 'team.issue.duplicate-feishu-identity',
    'member-not-found': 'team.issue.member-not-found',
    'member-revision-conflict': 'team.issue.member-revision-conflict',
    'member-in-use': 'team.issue.member-in-use',
    'member-status-conflict': 'team.issue.member-status-conflict',
    'responsibility-revision-conflict': 'team.issue.responsibility-revision-conflict',
    'member-inactive': 'team.issue.member-inactive',
    'accountable-also-contributor': 'team.issue.accountable-also-contributor',
    'human-sponsor-required': 'team.issue.human-sponsor-required',
    'human-sponsor-invalid': 'team.issue.human-sponsor-invalid',
    'human-sponsor-forbidden': 'team.issue.human-sponsor-forbidden',
  } as const satisfies Record<typeof code, WorkbenchKey>
  return keys[code]
}
