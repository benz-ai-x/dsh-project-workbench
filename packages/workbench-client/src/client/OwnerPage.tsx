/** Accessible Owner setup/login shell around the protected status page. */

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OwnerController, OwnerIssueCode } from './owner-controller.ts'
import { WorkbenchStatusPage } from './WorkbenchStatusPage.tsx'
import { ActivityPanel, type ActivityPanelCopy } from './ActivityPanel.tsx'
import { ProjectsPanel } from './ProjectsPanel.tsx'
import { ProjectTeamPanel } from './ProjectTeamPanel.tsx'
import { ReviewCenterPanel } from './ReviewCenterPanel.tsx'
import {
  FeishuConnectionPanel,
  type FeishuConnectionPanelCopy,
} from './FeishuConnectionPanel.tsx'
import { ProjectTasksPanel } from './ProjectTasksPanel.tsx'
import type { WorkbenchKey } from './locales.ts'
import css from './OwnerPage.module.css'

export interface OwnerPageProps {
  readonly controller: OwnerController
  readonly t: (key: WorkbenchKey) => string
  /** Optional browser-effect seam for deterministic component tests. */
  readonly copyText?: (value: string) => Promise<void>
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed'

const ISSUE_KEYS = {
  'password-mismatch': 'auth.error.password-mismatch',
  'already-initialized': 'auth.error.already-initialized',
  'bad-request': 'auth.error.bad-request',
  'invalid-credentials': 'auth.error.invalid-credentials',
  'rate-limited': 'auth.error.rate-limited',
  'unavailable': 'auth.error.unavailable',
} satisfies Record<OwnerIssueCode, WorkbenchKey>

/** One conversation replacement covering both public auth and protected status. */
export function OwnerPage({ controller, t, copyText = copyToClipboard }: OwnerPageProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [setupPassword, setSetupPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state.phase !== 'setup' && state.phase !== 'setup-pending') {
      setSetupPassword('')
      setConfirmation('')
    }
    if (state.phase !== 'login' && state.phase !== 'login-pending') setLoginPassword('')
    if (state.phase !== 'recovery') setCopyState('idle')
  }, [state.phase])

  if (state.phase === 'probing') {
    return (
      <AuthSurface title={t('auth.probing.title')} t={t}>
        <div className={css.probing} role="status" aria-live="polite">
          <StateDot state="ongoing" size={14} />
          <p>{t('auth.probing.body')}</p>
        </div>
      </AuthSurface>
    )
  }

  if (state.phase === 'setup' || state.phase === 'setup-pending') {
    const pending = state.phase === 'setup-pending'
    const descriptionId = state.issue === null
      ? 'workbench-setup-hint'
      : 'workbench-setup-hint workbench-auth-issue'
    const submit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      if (pending || setupPassword === '' || confirmation === '') return
      void controller.initialize(setupPassword, confirmation)
    }
    return (
      <AuthSurface title={t('auth.setup.title')} t={t}>
        <p className={css.lede}>{t('auth.setup.body')}</p>
        <AuthIssue issue={state.issue} t={t} />
        <form className={css.form} aria-busy={pending} onSubmit={submit}>
          <label className={css.label} htmlFor="workbench-owner-password">
            {t('auth.setup.password.label')}
          </label>
          <input
            id="workbench-owner-password"
            className={css.input}
            type="password"
            value={setupPassword}
            autoComplete="new-password"
            aria-describedby={descriptionId}
            disabled={pending}
            required
            onChange={event => { setSetupPassword(event.currentTarget.value) }}
          />
          <p id="workbench-setup-hint" className={css.hint}>{t('auth.setup.password.hint')}</p>

          <label className={css.label} htmlFor="workbench-owner-confirmation">
            {t('auth.setup.confirm.label')}
          </label>
          <input
            id="workbench-owner-confirmation"
            className={css.input}
            type="password"
            value={confirmation}
            autoComplete="new-password"
            disabled={pending}
            required
            onChange={event => { setConfirmation(event.currentTarget.value) }}
          />
          <div className={css.submitRow}>
            <Button
              variant="primary"
              type="submit"
              disabled={pending || setupPassword === '' || confirmation === ''}
            >
              {pending ? t('auth.setup.pending') : t('auth.setup.action')}
            </Button>
          </div>
        </form>
      </AuthSurface>
    )
  }

  if (state.phase === 'recovery' && state.recoveryCode !== null) {
    const copy = async (): Promise<void> => {
      const value = state.recoveryCode
      if (value === null || copyState === 'copying') return
      setCopyState('copying')
      try {
        await copyText(value)
        if (controller.getSnapshot().recoveryCode === value) setCopyState('copied')
      } catch {
        if (controller.getSnapshot().recoveryCode === value) setCopyState('failed')
      }
    }
    return (
      <AuthSurface title={t('auth.recovery.title')} t={t}>
        <p className={css.lede}>{t('auth.recovery.body')}</p>
        <p className={css.warning} role="alert">{t('auth.recovery.warning')}</p>
        <div className={css.recoveryBlock}>
          <span id="workbench-recovery-label" className={css.label}>
            {t('auth.recovery.code.label')}
          </span>
          <code
            className={css.recoveryCode}
            aria-labelledby="workbench-recovery-label"
            tabIndex={0}
          >
            {state.recoveryCode}
          </code>
          <div className={css.copyRow}>
            <Button
              variant="outline"
              type="button"
              disabled={copyState === 'copying'}
              onClick={() => { void copy() }}
            >
              {copyState === 'copied' ? t('auth.recovery.copied') : t('auth.recovery.copy')}
            </Button>
            <span className={css.copyStatus} role="status" aria-live="polite">
              {copyState === 'copied' ? t('auth.recovery.copied') : ''}
            </span>
          </div>
          {copyState === 'failed' && (
            <p className={css.inlineError} role="alert">{t('auth.recovery.copyFailed')}</p>
          )}
        </div>
        <p className={css.cliInstruction}><code>dsh-workbench owner recover</code><span>{t('auth.recovery.cli')}</span></p>
        <div className={css.submitRow}>
          <Button
            variant="primary"
            type="button"
            onClick={() => { void controller.acknowledgeRecovery() }}
          >
            {t('auth.recovery.acknowledge')}
          </Button>
        </div>
      </AuthSurface>
    )
  }

  if (state.phase === 'login' || state.phase === 'login-pending') {
    const pending = state.phase === 'login-pending'
    const submit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      if (pending || loginPassword === '') return
      void controller.login(loginPassword)
    }
    return (
      <AuthSurface title={t('auth.login.title')} t={t}>
        <p className={css.lede}>{t('auth.login.body')}</p>
        <AuthIssue issue={state.issue} t={t} />
        <form className={css.form} aria-busy={pending} onSubmit={submit}>
          <label className={css.label} htmlFor="workbench-login-password">
            {t('auth.login.password.label')}
          </label>
          <input
            id="workbench-login-password"
            className={css.input}
            type="password"
            value={loginPassword}
            autoComplete="current-password"
            aria-describedby={state.issue === null ? undefined : 'workbench-auth-issue'}
            disabled={pending}
            required
            autoFocus
            onChange={event => { setLoginPassword(event.currentTarget.value) }}
          />
          <div className={css.submitRow}>
            <Button variant="primary" type="submit" disabled={pending || loginPassword === ''}>
              {pending ? t('auth.login.pending') : t('auth.login.action')}
            </Button>
          </div>
        </form>
      </AuthSurface>
    )
  }

  if ((state.phase === 'authenticated' || state.phase === 'logout-pending')
    && state.access?.state === 'signed-in'
    && state.status !== null
    && state.projects !== null
    && state.projectTeam !== null
    && state.review !== null
    && state.feishuConnection !== null
    && state.projectTasks !== null
    && state.activity !== null) {
    const pending = state.phase === 'logout-pending'
    return (
      <div className={css.authenticated}>
        <header className={css.sessionBar} aria-label={t('auth.session.label')}>
          <div className={css.sessionSummary}>
            <StateDot state={state.issue === null ? 'done' : 'warning'} size={12} />
            <span>{t('auth.session.label')}</span>
            <span className={css.expiry}>
              {t('auth.session.expires')}{' '}
              <time dateTime={state.access.sessionExpiresAt}>
                {readableTimestamp(state.access.sessionExpiresAt)}
              </time>
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={pending}
            onClick={() => { void controller.logout() }}
          >
            {pending ? t('auth.logout.pending') : t('auth.logout.action')}
          </Button>
        </header>
        {state.issue !== null && (
          <div className={css.sessionIssue} role="alert">
            <span>{issueText(state.issue.code, t)}</span>
            <Button variant="outline" size="sm" type="button" onClick={() => { void controller.probe() }}>
              {t('auth.action.retry')}
            </Button>
          </div>
        )}
        <WorkbenchStatusPage controller={state.status} t={t}>
          <ProjectsPanel controller={state.projects} t={t} />
          <ProjectTeamPanel controller={state.projectTeam} t={t} />
          <ReviewCenterPanel controller={state.review} t={t} />
          <FeishuConnectionPanel
            controller={state.feishuConnection}
            copy={feishuConnectionCopy(t)}
          />
          <ProjectTasksPanel
            controller={state.projectTasks}
            connectionController={state.feishuConnection}
            t={t}
          />
          <ActivityPanel controller={state.activity} copy={activityCopy(t)} />
        </WorkbenchStatusPage>
      </div>
    )
  }

  return (
    <AuthSurface title={t('auth.error.title')} t={t}>
      <AuthIssue issue={state.issue} t={t} />
      <div className={css.submitRow}>
        <Button variant="primary" type="button" onClick={() => { void controller.probe() }}>
          {t('auth.action.retry')}
        </Button>
      </div>
    </AuthSurface>
  )
}

function AuthSurface({
  title,
  t,
  children,
}: {
  readonly title: string
  readonly t: (key: WorkbenchKey) => string
  readonly children: ReactNode
}) {
  return (
    <main className={css.surface} aria-labelledby="workbench-owner-title">
      <section className={css.authCard}>
        <header className={css.header}>
          <p className={css.eyebrow}>{t('auth.eyebrow')}</p>
          <h1 id="workbench-owner-title" className={css.title}>{title}</h1>
        </header>
        {children}
      </section>
    </main>
  )
}

function AuthIssue({
  issue,
  t,
}: {
  readonly issue: ReturnType<OwnerController['getSnapshot']>['issue']
  readonly t: (key: WorkbenchKey) => string
}) {
  if (issue === null) return null
  return (
    <div id="workbench-auth-issue" className={css.issue} role="alert">
      <strong>{t('auth.error.title')}</strong>
      <p>{issueText(issue.code, t)}</p>
      {issue.retryAfterSeconds !== undefined && (
        <p>
          {t('auth.error.retryAfterPrefix')}{' '}
          {new Intl.NumberFormat().format(issue.retryAfterSeconds)}{' '}
          {t('auth.error.retryAfterSuffix')}
        </p>
      )}
    </div>
  )
}

function issueText(code: OwnerIssueCode, t: (key: WorkbenchKey) => string): string {
  return t(ISSUE_KEYS[code])
}

async function copyToClipboard(value: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined) throw new Error('Clipboard API unavailable')
  await clipboard.writeText(value)
}

function readableTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed)
  } catch {
    return value
  }
}

function activityCopy(t: (key: WorkbenchKey) => string): ActivityPanelCopy {
  return {
    title: t('activity.title'),
    subtitle: t('activity.subtitle'),
    filtersLegend: t('activity.filters.legend'),
    projectScopeLabel: t('activity.project.scope'),
    projectAll: t('activity.project.all'),
    projectWorkspace: t('activity.project.workspace'),
    projectSpecific: t('activity.project.specific'),
    projectIdLabel: t('activity.project.id'),
    objectTypeLabel: t('activity.object.type'),
    objectAll: t('activity.object.all'),
    objectStatus: t('activity.object.status'),
    objectProject: t('activity.object.project'),
    objectProjectMember: t('activity.object.projectMember'),
    objectProjectResponsibility: t('activity.object.projectResponsibility'),
    objectSuggestedChange: t('activity.object.suggestedChange'),
    objectFeishuConnection: t('activity.object.feishuConnection'),
    objectFeishuTaskListBinding: t('activity.object.feishuTaskListBinding'),
    objectFeishuTask: t('activity.object.feishuTask'),
    objectFeishuTaskWorkflow: t('activity.object.feishuTaskWorkflow'),
    objectIdLabel: t('activity.object.id'),
    actionLabel: t('activity.action.label'),
    actionAll: t('activity.action.all'),
    actionStatusUpdated: t('activity.action.statusUpdated'),
    actionProjectCreated: t('activity.action.projectCreated'),
    actionProjectMemberCreated: t('activity.action.projectMemberCreated'),
    actionProjectMemberStatusChanged: t('activity.action.projectMemberStatusChanged'),
    actionProjectResponsibilityAssigned: t('activity.action.projectResponsibilityAssigned'),
    actionSuggestedChangeProposed: t('activity.action.suggestedChangeProposed'),
    actionSuggestedChangeAccepted: t('activity.action.suggestedChangeAccepted'),
    actionSuggestedChangeEditedAccepted: t('activity.action.suggestedChangeEditedAccepted'),
    actionSuggestedChangeRejected: t('activity.action.suggestedChangeRejected'),
    actionSuggestedChangeDeferred: t('activity.action.suggestedChangeDeferred'),
    actionFeishuRouteConfigured: t('activity.action.feishuRouteConfigured'),
    actionFeishuRouteReset: t('activity.action.feishuRouteReset'),
    actionFeishuRouteDisabled: t('activity.action.feishuRouteDisabled'),
    actionFeishuRouteVerificationRecorded: t('activity.action.feishuRouteVerificationRecorded'),
    actionFeishuTaskListBound: t('activity.action.feishuTaskListBound'),
    actionFeishuTaskReferenced: t('activity.action.feishuTaskReferenced'),
    actionFeishuTaskUpdateRequested: t('activity.action.feishuTaskUpdateRequested'),
    actionFeishuTaskWorkflowConfigured: t('activity.action.feishuTaskWorkflowConfigured'),
    applyFilters: t('activity.filters.apply'),
    loading: t('activity.loading'),
    stale: t('activity.stale'),
    unavailableTitle: t('activity.unavailable.title'),
    unavailableBody: t('activity.unavailable.body'),
    invalidTitle: t('activity.invalid.title'),
    invalidBody: t('activity.invalid.body'),
    retry: t('activity.retry'),
    loadMore: t('activity.loadMore'),
    loadingMore: t('activity.loadingMore'),
    paginationLoaded: t('activity.pagination.loaded'),
    paginationComplete: t('activity.pagination.complete'),
    emptyTitle: t('activity.empty.title'),
    emptyBody: t('activity.empty.body'),
    integrityValid: t('activity.integrity.valid'),
    integrityInvalid: t('activity.integrity.invalid'),
    integrityEvents: t('activity.integrity.events'),
    integrityHead: t('activity.integrity.head'),
    integrityEmptyHead: t('activity.integrity.emptyHead'),
    summaryStatusCommitted: t('activity.summary.statusCommitted'),
    summaryProjectCreated: t('activity.summary.projectCreated'),
    summaryProjectMemberCreated: t('activity.summary.projectMemberCreated'),
    summaryProjectMemberStatusChanged: t('activity.summary.projectMemberStatusChanged'),
    summaryProjectResponsibilityAssigned: t('activity.summary.projectResponsibilityAssigned'),
    summarySuggestedChangeProposed: t('activity.summary.suggestedChangeProposed'),
    summarySuggestedChangeAccepted: t('activity.summary.suggestedChangeAccepted'),
    summarySuggestedChangeEditedAccepted: t('activity.summary.suggestedChangeEditedAccepted'),
    summarySuggestedChangeRejected: t('activity.summary.suggestedChangeRejected'),
    summarySuggestedChangeDeferred: t('activity.summary.suggestedChangeDeferred'),
    summaryFeishuRouteConfigured: t('activity.summary.feishuRouteConfigured'),
    summaryFeishuRouteReset: t('activity.summary.feishuRouteReset'),
    summaryFeishuRouteDisabled: t('activity.summary.feishuRouteDisabled'),
    summaryFeishuVerificationHealthy: t('activity.summary.feishuVerificationHealthy'),
    summaryFeishuVerificationAttention: t('activity.summary.feishuVerificationAttention'),
    summaryFeishuVerificationFailed: t('activity.summary.feishuVerificationFailed'),
    summaryFeishuTaskListBound: t('activity.summary.feishuTaskListBound'),
    summaryFeishuTaskReferenced: t('activity.summary.feishuTaskReferenced'),
    summaryFeishuTaskUpdateRequested: t('activity.summary.feishuTaskUpdateRequested'),
    summaryFeishuTaskWorkflowConfigured: t('activity.summary.feishuTaskWorkflowConfigured'),
    workspaceScope: t('activity.scope.workspace'),
    projectPrefix: t('activity.prefix.project'),
    actorPrefix: t('activity.prefix.actor'),
    objectPrefix: t('activity.prefix.object'),
    revisionPrefix: t('activity.prefix.revision'),
    reasonPrefix: t('activity.prefix.reason'),
    reasonOwnerStatusEdit: t('activity.reason.ownerEdit'),
    reasonOwnerProjectCreate: t('activity.reason.ownerProjectCreate'),
    reasonOwnerProjectMemberAdd: t('activity.reason.ownerProjectMemberAdd'),
    reasonOwnerProjectMemberStatusChange: t('activity.reason.ownerProjectMemberStatusChange'),
    reasonOwnerProjectResponsibilitySet: t('activity.reason.ownerProjectResponsibilitySet'),
    reasonOwnerSuggestedChangePropose: t('activity.reason.ownerSuggestedChangePropose'),
    reasonOwnerSuggestedChangeAccept: t('activity.reason.ownerSuggestedChangeAccept'),
    reasonOwnerSuggestedChangeEditAccept: t('activity.reason.ownerSuggestedChangeEditAccept'),
    reasonOwnerSuggestedChangeReject: t('activity.reason.ownerSuggestedChangeReject'),
    reasonOwnerSuggestedChangeDefer: t('activity.reason.ownerSuggestedChangeDefer'),
    reasonOwnerFeishuRouteConfigure: t('activity.reason.ownerFeishuRouteConfigure'),
    reasonOwnerFeishuRouteReset: t('activity.reason.ownerFeishuRouteReset'),
    reasonOwnerFeishuRouteDisable: t('activity.reason.ownerFeishuRouteDisable'),
    reasonOwnerFeishuRouteVerify: t('activity.reason.ownerFeishuRouteVerify'),
    reasonOwnerFeishuTaskListBind: t('activity.reason.ownerFeishuTaskListBind'),
    reasonOwnerFeishuTaskReference: t('activity.reason.ownerFeishuTaskReference'),
    reasonOwnerFeishuTaskUpdate: t('activity.reason.ownerFeishuTaskUpdate'),
    reasonOwnerFeishuTaskWorkflowConfigure: t('activity.reason.ownerFeishuTaskWorkflowConfigure'),
    causationPrefix: t('activity.prefix.causation'),
    outboxPrefix: t('activity.prefix.outbox'),
    attemptsPrefix: t('activity.prefix.attempts'),
    outboxPending: t('activity.outbox.pending'),
    outboxDelivered: t('activity.outbox.delivered'),
    outboxUnknown: t('activity.outbox.unknown'),
    outboxFailed: t('activity.outbox.failed'),
  }
}

function feishuConnectionCopy(
  t: (key: WorkbenchKey) => string,
): FeishuConnectionPanelCopy {
  return {
    kicker: t('feishu.kicker'),
    title: t('feishu.title'),
    subtitle: t('feishu.subtitle'),
    noActorFallback: t('feishu.noActorFallback'),
    loading: t('feishu.loading'),
    unavailable: t('feishu.unavailable'),
    phase: {
      loading: t('feishu.phase.loading'),
      ready: t('feishu.phase.ready'),
      pending: t('feishu.phase.pending'),
      stale: t('feishu.phase.stale'),
      error: t('feishu.phase.error'),
      conflict: t('feishu.phase.conflict'),
    },
    routeTitle: {
      bot: t('feishu.route.bot.title'),
      user: t('feishu.route.user.title'),
    },
    routeBody: {
      bot: t('feishu.route.bot.body'),
      user: t('feishu.route.user.body'),
    },
    credentialReferenceLabel: {
      bot: t('feishu.route.bot.credentialReference'),
      user: t('feishu.route.user.credentialReference'),
    },
    routeState: {
      unconfigured: t('feishu.route.state.unconfigured'),
      configured: t('feishu.route.state.configured'),
      disabled: t('feishu.route.state.disabled'),
    },
    verificationResult: {
      healthy: t('feishu.verification.result.healthy'),
      attention: t('feishu.verification.result.attention'),
      failed: t('feishu.verification.result.failed'),
    },
    identityState: {
      verified: t('feishu.identity.state.verified'),
      failed: t('feishu.identity.state.failed'),
    },
    scopeInspectionState: {
      observed: t('feishu.scopeInspection.observed'),
      unavailable: t('feishu.scopeInspection.unavailable'),
      'not-inspected': t('feishu.scopeInspection.notInspected'),
    },
    scopeState: {
      configured: t('feishu.scope.state.configured'),
      verified: t('feishu.scope.state.verified'),
      missing: t('feishu.scope.state.missing'),
      unknown: t('feishu.scope.state.unknown'),
    },
    tokenType: {
      tenant: t('feishu.token.tenant'),
      user: t('feishu.token.user'),
    },
    providerIssue: {
      'credential-unconfigured': t('feishu.issue.credentialUnconfigured'),
      'credential-invalid': t('feishu.issue.credentialInvalid'),
      'credential-expired': t('feishu.issue.credentialExpired'),
      'user-authorization-revoked': t('feishu.issue.userAuthorizationRevoked'),
      'app-disabled': t('feishu.issue.appDisabled'),
      'missing-app-scope': t('feishu.issue.missingAppScope'),
      'missing-user-grant': t('feishu.issue.missingUserGrant'),
      'outside-app-data-range': t('feishu.issue.outsideAppDataRange'),
      'resource-access-unavailable': t('feishu.issue.resourceAccessUnavailable'),
      'resource-not-found': t('feishu.issue.resourceNotFound'),
      'unsupported-actor': t('feishu.issue.unsupportedActor'),
      'identity-continuity-mismatch': t('feishu.issue.identityContinuityMismatch'),
      'tenant-mismatch': t('feishu.issue.tenantMismatch'),
      'rate-limited': t('feishu.issue.rateLimited'),
      'provider-unavailable': t('feishu.issue.providerUnavailable'),
      'provider-response-invalid': t('feishu.issue.providerResponseInvalid'),
      'unknown-provider-error': t('feishu.issue.unknownProviderError'),
    },
    recovery: {
      'configure-credential': t('feishu.recovery.configureCredential'),
      'rotate-credential': t('feishu.recovery.rotateCredential'),
      'enable-app': t('feishu.recovery.enableApp'),
      'grant-app-scope': t('feishu.recovery.grantAppScope'),
      'reauthorize-user': t('feishu.recovery.reauthorizeUser'),
      'expand-app-data-range': t('feishu.recovery.expandAppDataRange'),
      'share-resource': t('feishu.recovery.shareResource'),
      'check-resource-id': t('feishu.recovery.checkResourceId'),
      'reset-identity-binding': t('feishu.recovery.resetIdentityBinding'),
      'retry-later': t('feishu.recovery.retryLater'),
      'inspect-provider': t('feishu.recovery.inspectProvider'),
    },
    clientIssue: {
      unavailable: t('feishu.clientIssue.unavailable'),
      unauthorized: t('feishu.clientIssue.unauthorized'),
      forbidden: t('feishu.clientIssue.forbidden'),
      'rate-limited': t('feishu.clientIssue.rateLimited'),
      internal: t('feishu.clientIssue.internal'),
      'transport-failure': t('feishu.clientIssue.transportFailure'),
      'bad-request': t('feishu.clientIssue.badRequest'),
      'idempotency-conflict': t('feishu.clientIssue.idempotencyKeyReused'),
      'connection-revision-conflict': t('feishu.clientIssue.connectionRevisionConflict'),
      'route-generation-conflict': t('feishu.clientIssue.routeGenerationConflict'),
      'route-unconfigured': t('feishu.clientIssue.routeUnconfigured'),
      'no-op-route-configuration': t('feishu.clientIssue.noopRouteConfiguration'),
      'route-disabled': t('feishu.clientIssue.routeDisabled'),
    },
    operation: {
      'read-connection': t('feishu.operation.read'),
      configure: t('feishu.operation.configure'),
      reset: t('feishu.operation.reset'),
      disable: t('feishu.operation.disable'),
      verify: t('feishu.operation.verify'),
    },
    connectionId: t('feishu.meta.connectionId'),
    realm: t('feishu.meta.realm'),
    revision: t('feishu.meta.revision'),
    updatedAt: t('feishu.meta.updatedAt'),
    routeGeneration: t('feishu.meta.routeGeneration'),
    configuration: t('feishu.configuration'),
    appId: t('feishu.appId'),
    credential: t('feishu.credential'),
    credentialReference: t('feishu.credentialReference'),
    credentialConfigured: t('feishu.credentialConfigured'),
    credentialSource: t('feishu.credentialSource'),
    credentialWritable: t('feishu.credentialWritable'),
    actor: t('feishu.actor'),
    displayLabel: t('feishu.displayLabel'),
    openId: t('feishu.openId'),
    tenantKey: t('feishu.tenantKey'),
    authorization: t('feishu.authorization'),
    scopes: t('feishu.scopes'),
    scope: t('feishu.scope'),
    token: t('feishu.token'),
    status: t('feishu.status'),
    latestVerification: t('feishu.latestVerification'),
    verificationSequence: t('feishu.verificationSequence'),
    verificationCheckedAt: t('feishu.verificationCheckedAt'),
    identityCheck: t('feishu.identityCheck'),
    scopeInspection: t('feishu.scopeInspection'),
    resourceProbe: t('feishu.resourceProbe'),
    resourceAccessible: t('feishu.resourceAccessible'),
    resourceUnavailable: t('feishu.resourceUnavailable'),
    resourceNotTested: t('feishu.resourceNotTested'),
    taskListProbe: t('feishu.taskListProbe'),
    taskListProbeHint: t('feishu.taskListProbeHint'),
    externalProvisioningHint: t('feishu.externalProvisioningHint'),
    resetIdentityHint: t('feishu.resetIdentityHint'),
    disableHint: t('feishu.disableHint'),
    draftStale: t('feishu.draftStale'),
    invalidConfiguration: t('feishu.invalidConfiguration'),
    invalidProbe: t('feishu.invalidProbe'),
    issueTitle: t('feishu.issueTitle'),
    recoveryTitle: t('feishu.recoveryTitle'),
    missingScopes: t('feishu.missingScopes'),
    retryAt: t('feishu.retryAt'),
    yes: t('feishu.yes'),
    no: t('feishu.no'),
    none: t('feishu.none'),
    notValidated: t('feishu.notValidated'),
    notInspected: t('feishu.notInspected'),
    refresh: t('feishu.action.refresh'),
    retryExact: t('feishu.action.retryExact'),
    saveConfiguration: t('feishu.action.saveConfiguration'),
    reenableRoute: t('feishu.action.reenableRoute'),
    resetForm: t('feishu.action.resetForm'),
    adoptLatest: t('feishu.action.adoptLatest'),
    resetIdentity: t('feishu.action.resetIdentity'),
    disableRoute: t('feishu.action.disableRoute'),
    verifyRoute: t('feishu.action.verifyRoute'),
  }
}
