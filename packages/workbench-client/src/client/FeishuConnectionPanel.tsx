/** Accessible Feishu Bot/User Connection Center with explicit actor routes. */

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FeishuConnectionIssue,
  FeishuConnectionIssueCode,
  FeishuConnectionRecoveryCode,
  FeishuIdentityKind,
  FeishuIdentityRouteProjection,
  FeishuScopeObservation,
  FeishuVerificationProjection,
} from '@benz-ai-x/dsh-project-workbench/client'
import {
  MAX_FEISHU_APP_ID_LENGTH,
  MAX_FEISHU_CREDENTIAL_REF_LENGTH,
  MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH,
  validTaskListResourceId,
  type WorkbenchFeishuConnectionClientIssue,
  type WorkbenchFeishuConnectionClientIssueCode,
  type WorkbenchFeishuConnectionClientState,
  type WorkbenchFeishuConnectionController,
  type WorkbenchFeishuConnectionOperation,
  type WorkbenchFeishuConnectionPhase,
} from './feishu-connection-controller.ts'
import css from './FeishuConnectionPanel.module.css'

type RouteState = FeishuIdentityRouteProjection['state']
type VerificationResult = FeishuVerificationProjection['result']
type IdentityState = FeishuVerificationProjection['identity']['state']
type ScopeInspectionState = FeishuVerificationProjection['scopeInspection']['state']
type ScopeState = FeishuScopeObservation['state']
type TokenType = FeishuScopeObservation['tokenType']

/** Typed copy contract; the integration layer supplies the active zh/en locale. */
export interface FeishuConnectionPanelCopy {
  readonly kicker: string
  readonly title: string
  readonly subtitle: string
  readonly noActorFallback: string
  readonly loading: string
  readonly unavailable: string
  readonly phase: Readonly<Record<WorkbenchFeishuConnectionPhase, string>>
  readonly routeTitle: Readonly<Record<FeishuIdentityKind, string>>
  readonly routeBody: Readonly<Record<FeishuIdentityKind, string>>
  readonly credentialReferenceLabel: Readonly<Record<FeishuIdentityKind, string>>
  readonly routeState: Readonly<Record<RouteState, string>>
  readonly verificationResult: Readonly<Record<VerificationResult, string>>
  readonly identityState: Readonly<Record<IdentityState, string>>
  readonly scopeInspectionState: Readonly<Record<ScopeInspectionState, string>>
  readonly scopeState: Readonly<Record<ScopeState, string>>
  readonly tokenType: Readonly<Record<TokenType, string>>
  readonly providerIssue: Readonly<Record<FeishuConnectionIssueCode, string>>
  readonly recovery: Readonly<Record<FeishuConnectionRecoveryCode, string>>
  readonly clientIssue: Readonly<Record<WorkbenchFeishuConnectionClientIssueCode, string>>
  readonly operation: Readonly<Record<WorkbenchFeishuConnectionOperation, string>>
  readonly connectionId: string
  readonly realm: string
  readonly revision: string
  readonly updatedAt: string
  readonly routeGeneration: string
  readonly configuration: string
  readonly appId: string
  readonly credential: string
  readonly credentialReference: string
  readonly credentialConfigured: string
  readonly credentialSource: string
  readonly credentialWritable: string
  readonly actor: string
  readonly displayLabel: string
  readonly openId: string
  readonly tenantKey: string
  readonly authorization: string
  readonly scopes: string
  readonly scope: string
  readonly token: string
  readonly status: string
  readonly latestVerification: string
  readonly verificationSequence: string
  readonly verificationCheckedAt: string
  readonly identityCheck: string
  readonly scopeInspection: string
  readonly resourceProbe: string
  readonly resourceAccessible: string
  readonly resourceUnavailable: string
  readonly resourceNotTested: string
  readonly taskListProbe: string
  readonly taskListProbeHint: string
  readonly externalProvisioningHint: string
  readonly resetIdentityHint: string
  readonly disableHint: string
  readonly draftStale: string
  readonly invalidConfiguration: string
  readonly invalidProbe: string
  readonly issueTitle: string
  readonly recoveryTitle: string
  readonly missingScopes: string
  readonly retryAt: string
  readonly yes: string
  readonly no: string
  readonly none: string
  readonly notValidated: string
  readonly notInspected: string
  readonly refresh: string
  readonly retryExact: string
  readonly saveConfiguration: string
  readonly reenableRoute: string
  readonly resetForm: string
  readonly adoptLatest: string
  readonly resetIdentity: string
  readonly disableRoute: string
  readonly verifyRoute: string
}

export interface FeishuConnectionPanelProps {
  readonly controller: WorkbenchFeishuConnectionController
  readonly copy: FeishuConnectionPanelCopy
}

const ROUTE_KINDS: readonly FeishuIdentityKind[] = ['bot', 'user']

function phasePresentation(
  state: WorkbenchFeishuConnectionClientState,
): { readonly dot: StateDotState; readonly label: WorkbenchFeishuConnectionPhase } {
  if (state.pendingOperation !== null || state.phase === 'pending') {
    return { dot: 'ongoing', label: 'pending' }
  }
  switch (state.phase) {
    case 'loading': return { dot: 'ongoing', label: 'loading' }
    case 'ready': return { dot: 'done', label: 'ready' }
    case 'stale': return { dot: 'warning', label: 'stale' }
    case 'error': return { dot: 'error', label: 'error' }
    case 'conflict': return { dot: 'warning', label: 'conflict' }
  }
}

export function FeishuConnectionPanel({
  controller,
  copy,
}: FeishuConnectionPanelProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const routeRefs = useRef(new Map<FeishuIdentityKind, HTMLElement>())
  const presentation = phasePresentation(state)

  useEffect(() => {
    if (state.focusEpoch === 0 || state.focusKind === null) return
    routeRefs.current.get(state.focusKind)?.focus({ preventScroll: true })
  }, [state.focusEpoch, state.focusKind])

  return (
    <section
      className={css.panel}
      aria-labelledby="workbench-feishu-connection-title"
      aria-busy={state.phase === 'loading' || state.pendingOperation !== null}
    >
      <header className={css.header}>
        <div>
          <p className={css.kicker}>{copy.kicker}</p>
          <h2 id="workbench-feishu-connection-title" className={css.title}>{copy.title}</h2>
          <p className={css.subtitle}>{copy.subtitle}</p>
        </div>
        <div className={css.syncState} role="status" aria-live="polite" aria-atomic="true">
          <StateDot state={presentation.dot} size={12} />
          <span>{copy.phase[presentation.label]}</span>
        </div>
      </header>

      <p className={css.identityBoundary} role="note">{copy.noActorFallback}</p>

      {state.issue !== null && (
        <ControllerIssueNotice state={state} controller={controller} copy={copy} />
      )}

      {state.center === null ? (
        <p className={css.loading} role="status">
          {state.phase === 'loading' ? copy.loading : copy.unavailable}
        </p>
      ) : (
        <>
          <dl className={css.connectionMeta}>
            <Meta label={copy.connectionId} value={state.center.connectionId} />
            <Meta label={copy.realm} value={state.center.realm} />
            <Meta label={copy.revision} value={String(state.center.revision)} />
            <Meta
              label={copy.updatedAt}
              value={state.center.updatedAt === null
                ? copy.none
                : readableTimestamp(state.center.updatedAt)}
            />
          </dl>

          <div className={css.routeGrid}>
            {ROUTE_KINDS.map(kind => (
              <FeishuRouteCard
                key={kind}
                kind={kind}
                route={state.center?.[kind] as FeishuIdentityRouteProjection}
                state={state}
                controller={controller}
                copy={copy}
                setRef={node => {
                  if (node === null) routeRefs.current.delete(kind)
                  else routeRefs.current.set(kind, node)
                }}
              />
            ))}
          </div>

          <div className={css.footerActions}>
            {state.canRetryMutation && state.issue === null && (
              <Button
                variant="outline"
                type="button"
                disabled={state.pendingOperation !== null}
                onClick={() => { void controller.retryMutation() }}
              >
                {copy.retryExact}
              </Button>
            )}
            <Button
              variant="outline"
              type="button"
              disabled={state.pendingOperation !== null}
              onClick={() => { void controller.refresh() }}
            >
              {copy.refresh}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function FeishuRouteCard({
  kind,
  route,
  state,
  controller,
  copy,
  setRef,
}: {
  readonly kind: FeishuIdentityKind
  readonly route: FeishuIdentityRouteProjection
  readonly state: WorkbenchFeishuConnectionClientState
  readonly controller: WorkbenchFeishuConnectionController
  readonly copy: FeishuConnectionPanelCopy
  readonly setRef: (node: HTMLElement | null) => void
}) {
  const draft = state.drafts[kind]
  const pending = state.pendingKind === kind && state.pendingOperation !== null
  const draftStale = controller.isDraftStale(kind)
  const invalidConfiguration = draft.configDirty
    && !controller.canConfigure(kind)
    && !draftStale
  const probeValue = draft.taskListResourceId.trim()
  const invalidProbe = probeValue !== '' && !validTaskListResourceId(probeValue)

  const submitConfiguration = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canConfigure(kind)) void controller.configure(kind)
  }
  const submitVerification = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (controller.canVerify(kind)) void controller.verify(kind)
  }

  return (
    <article
      ref={setRef}
      className={css.routeCard}
      tabIndex={-1}
      aria-labelledby={`workbench-feishu-${kind}-title`}
    >
      <header className={css.cardHeader}>
        <div>
          <p className={css.cardKicker}>{kind.toUpperCase()}</p>
          <h3 id={`workbench-feishu-${kind}-title`}>{copy.routeTitle[kind]}</h3>
          <p>{copy.routeBody[kind]}</p>
        </div>
        <span className={css.routeState} data-state={route.state}>
          {copy.routeState[route.state]}
        </span>
      </header>

      <dl className={css.routeMeta}>
        <Meta label={copy.appId} value={route.appId ?? copy.none} />
        <Meta label={copy.routeGeneration} value={route.generation?.toString() ?? copy.none} />
      </dl>

      <section className={css.infoSection} aria-labelledby={`workbench-feishu-${kind}-credential`}>
        <h4 id={`workbench-feishu-${kind}-credential`}>{copy.credential}</h4>
        <dl className={css.details}>
          <Meta label={copy.credentialReference} value={route.credential.ref ?? copy.none} code />
          <Meta
            label={copy.credentialConfigured}
            value={route.credential.configured ? copy.yes : copy.no}
          />
          <Meta label={copy.credentialSource} value={route.credential.source ?? copy.none} />
          <Meta
            label={copy.credentialWritable}
            value={route.credential.writable ? copy.yes : copy.no}
          />
        </dl>
      </section>

      <ActorSection kind={kind} route={route} copy={copy} />
      <VerificationSection kind={kind} verification={route.lastVerification} copy={copy} />

      <form className={css.form} onSubmit={submitConfiguration}>
        <fieldset disabled={state.pendingOperation !== null}>
          <legend>{copy.configuration}</legend>
          <p className={css.hint}>{copy.externalProvisioningHint}</p>
          <label className={css.field}>
            <span>{copy.appId}</span>
            <input
              type="text"
              name={`feishu-${kind}-app-id`}
              value={draft.appId}
              maxLength={MAX_FEISHU_APP_ID_LENGTH}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={event => { controller.setAppId(kind, event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span>{copy.credentialReferenceLabel[kind]}</span>
            <input
              type="text"
              name={`feishu-${kind}-credential-ref`}
              value={draft.credentialRef}
              maxLength={MAX_FEISHU_CREDENTIAL_REF_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              onChange={event => {
                controller.setCredentialRef(kind, event.currentTarget.value)
              }}
            />
          </label>
          {draftStale && (
            <div className={css.staleDraft} role="alert">
              <span>{copy.draftStale}</span>
              <Button variant="outline" size="sm" type="button" onClick={() => {
                controller.adoptLatestBase(kind)
              }}>
                {copy.adoptLatest}
              </Button>
            </div>
          )}
          {invalidConfiguration && (
            <p className={css.validation} role="status">{copy.invalidConfiguration}</p>
          )}
          <div className={css.formActions}>
            <Button variant="ghost" type="button" onClick={() => {
              controller.resetDraft(kind)
            }}>
              {copy.resetForm}
            </Button>
            <Button variant="primary" type="submit" disabled={!controller.canConfigure(kind)}>
              {route.state === 'disabled' ? copy.reenableRoute : copy.saveConfiguration}
            </Button>
          </div>
        </fieldset>
      </form>

      <form className={css.form} onSubmit={submitVerification}>
        <fieldset disabled={state.pendingOperation !== null || route.state !== 'configured'}>
          <legend>{copy.authorization}</legend>
          <label className={css.field}>
            <span>{copy.taskListProbe}</span>
            <input
              type="text"
              name={`feishu-${kind}-task-list-probe`}
              value={draft.taskListResourceId}
              maxLength={MAX_FEISHU_TASK_LIST_RESOURCE_ID_LENGTH}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`workbench-feishu-${kind}-probe-hint`}
              onChange={event => {
                controller.setTaskListResourceId(kind, event.currentTarget.value)
              }}
            />
          </label>
          <p id={`workbench-feishu-${kind}-probe-hint`} className={css.hint}>
            {copy.taskListProbeHint}
          </p>
          {invalidProbe && <p className={css.validation} role="status">{copy.invalidProbe}</p>}
          <div className={css.formActions}>
            <Button variant="primary" type="submit" disabled={!controller.canVerify(kind)}>
              {pending && state.pendingOperation === 'verify'
                ? copy.phase.pending
                : copy.verifyRoute}
            </Button>
          </div>
        </fieldset>
      </form>

      <div className={css.routeActions}>
        <div>
          <strong>{copy.resetIdentity}</strong>
          <p>{copy.resetIdentityHint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={!controller.canReset(kind)}
          onClick={() => { void controller.resetIdentity(kind) }}
        >
          {copy.resetIdentity}
        </Button>
      </div>
      <div className={css.routeActions}>
        <div>
          <strong>{copy.disableRoute}</strong>
          <p>{copy.disableHint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={!controller.canDisable(kind)}
          onClick={() => { void controller.disable(kind) }}
        >
          {copy.disableRoute}
        </Button>
      </div>
    </article>
  )
}

function ActorSection({
  kind,
  route,
  copy,
}: {
  readonly kind: FeishuIdentityKind
  readonly route: FeishuIdentityRouteProjection
  readonly copy: FeishuConnectionPanelCopy
}) {
  return (
    <section className={css.infoSection} aria-labelledby={`workbench-feishu-${kind}-actor`}>
      <h4 id={`workbench-feishu-${kind}-actor`}>{copy.actor}</h4>
      {route.actor === null ? (
        <p className={css.empty}>{copy.notValidated}</p>
      ) : (
        <dl className={css.details}>
          <Meta label={copy.displayLabel} value={route.displayLabel ?? copy.none} />
          <Meta label={copy.openId} value={route.actor.openId} code />
          <Meta label={copy.tenantKey} value={route.actor.tenantKey ?? copy.none} code />
          <Meta label={copy.routeGeneration} value={String(route.actor.routeGeneration)} />
        </dl>
      )}
    </section>
  )
}

function VerificationSection({
  kind,
  verification,
  copy,
}: {
  readonly kind: FeishuIdentityKind
  readonly verification: FeishuVerificationProjection | null
  readonly copy: FeishuConnectionPanelCopy
}) {
  if (verification === null) {
    return (
      <section className={css.infoSection} aria-labelledby={`workbench-feishu-${kind}-verification`}>
        <h4 id={`workbench-feishu-${kind}-verification`}>{copy.latestVerification}</h4>
        <p className={css.empty}>{copy.notValidated}</p>
      </section>
    )
  }
  return (
    <section className={css.infoSection} aria-labelledby={`workbench-feishu-${kind}-verification`}>
      <h4 id={`workbench-feishu-${kind}-verification`}>{copy.latestVerification}</h4>
      <dl className={css.details}>
        <Meta label={copy.status} value={copy.verificationResult[verification.result]} />
        <Meta label={copy.verificationSequence} value={String(verification.sequence)} />
        <Meta label={copy.verificationCheckedAt} value={readableTimestamp(verification.checkedAt)} />
        <Meta label={copy.identityCheck} value={copy.identityState[verification.identity.state]} />
        <Meta
          label={copy.scopeInspection}
          value={copy.scopeInspectionState[verification.scopeInspection.state]}
        />
      </dl>

      {verification.identity.issue !== null && (
        <ProviderIssueNotice issue={verification.identity.issue} copy={copy} />
      )}
      {verification.scopeInspection.issue !== null && (
        <ProviderIssueNotice issue={verification.scopeInspection.issue} copy={copy} />
      )}

      <ScopeTable scopes={verification.scopeInspection.scopes} copy={copy} />
      <ResourceProbe verification={verification} copy={copy} />
    </section>
  )
}

function ScopeTable({
  scopes,
  copy,
}: {
  readonly scopes: readonly FeishuScopeObservation[]
  readonly copy: FeishuConnectionPanelCopy
}) {
  return (
    <div className={css.tableRegion}>
      <h5>{copy.scopes}</h5>
      {scopes.length === 0 ? (
        <p className={css.empty}>{copy.notInspected}</p>
      ) : (
        <table className={css.scopeTable}>
          <thead>
            <tr>
              <th scope="col">{copy.scope}</th>
              <th scope="col">{copy.token}</th>
              <th scope="col">{copy.status}</th>
            </tr>
          </thead>
          <tbody>
            {scopes.map(scope => (
              <tr key={`${scope.tokenType}:${scope.scope}`}>
                <th scope="row"><code>{scope.scope}</code></th>
                <td>{copy.tokenType[scope.tokenType]}</td>
                <td>{copy.scopeState[scope.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ResourceProbe({
  verification,
  copy,
}: {
  readonly verification: FeishuVerificationProjection
  readonly copy: FeishuConnectionPanelCopy
}) {
  const probe = verification.resourceProbe
  return (
    <div className={css.probeResult}>
      <h5>{copy.resourceProbe}</h5>
      {probe.state === 'not-tested' ? (
        <p>{copy.resourceNotTested}</p>
      ) : probe.state === 'accessible' ? (
        <p>{copy.resourceAccessible}: <code>{probe.resourceId}</code></p>
      ) : (
        <>
          <p>{copy.resourceUnavailable}: <code>{probe.resourceId}</code></p>
          <ProviderIssueNotice issue={probe.issue} copy={copy} />
        </>
      )}
    </div>
  )
}

function ProviderIssueNotice({
  issue,
  copy,
}: {
  readonly issue: FeishuConnectionIssue
  readonly copy: FeishuConnectionPanelCopy
}) {
  return (
    <div className={css.providerIssue} role="status">
      <strong>{copy.issueTitle}</strong>
      <p>{copy.providerIssue[issue.code]}</p>
      <p><b>{copy.recoveryTitle}:</b> {copy.recovery[issue.recovery]}</p>
      {issue.missingScopes.length > 0 && (
        <p>
          <b>{copy.missingScopes}:</b>{' '}
          {issue.missingScopes.map(scope => <code key={scope}>{scope}</code>)}
        </p>
      )}
      {issue.retryAt !== null && (
        <p><b>{copy.retryAt}:</b> {readableTimestamp(issue.retryAt)}</p>
      )}
    </div>
  )
}

function ControllerIssueNotice({
  state,
  controller,
  copy,
}: {
  readonly state: WorkbenchFeishuConnectionClientState
  readonly controller: WorkbenchFeishuConnectionController
  readonly copy: FeishuConnectionPanelCopy
}) {
  const issue = state.issue as WorkbenchFeishuConnectionClientIssue
  return (
    <div
      className={issue.kind === 'conflict' ? css.conflictNotice : css.errorNotice}
      role="alert"
    >
      <div>
        <strong>{copy.issueTitle}</strong>
        <p>{copy.operation[issue.operation]}: {copy.clientIssue[issue.code]}</p>
      </div>
      <div className={css.issueActions}>
        {state.canRetryMutation && (
          <Button variant="outline" size="sm" type="button" onClick={() => {
            void controller.retryMutation()
          }}>
            {copy.retryExact}
          </Button>
        )}
        <Button variant="outline" size="sm" type="button" onClick={() => {
          void controller.refresh()
        }}>
          {copy.refresh}
        </Button>
      </div>
    </div>
  )
}

function Meta({
  label,
  value,
  code = false,
}: {
  readonly label: string
  readonly value: string
  readonly code?: boolean
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  )
}

function readableTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
