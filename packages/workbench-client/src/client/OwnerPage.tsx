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
    && state.status !== null) {
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
        <WorkbenchStatusPage controller={state.status} t={t} />
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
