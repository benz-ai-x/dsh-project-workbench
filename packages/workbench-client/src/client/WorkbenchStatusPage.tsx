/** Pure React Project Workbench status page. */

import { useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchStatusController, WorkbenchClientState } from './controller.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './WorkbenchStatusPage.module.css'

/** Ordinary props supplied by the Client adapter; no Cordis or transport leaks into React. */
export interface WorkbenchStatusPageProps {
  readonly controller: WorkbenchStatusController
  readonly t: (key: WorkbenchKey) => string
  readonly children?: ReactNode
}

function statePresentation(state: WorkbenchClientState): {
  readonly dot: StateDotState
  readonly key: WorkbenchKey
} {
  if (state.pending || state.phase === 'pending') return { dot: 'ongoing', key: 'status.pending' }
  switch (state.phase) {
    case 'loading': return { dot: 'ongoing', key: 'status.loading' }
    case 'empty': return { dot: 'done', key: 'status.empty' }
    case 'value': return { dot: 'done', key: 'status.value' }
    case 'stale': return { dot: 'warning', key: 'status.stale' }
    case 'error': return state.issue?.kind === 'input'
      ? { dot: 'warning', key: 'status.input' }
      : { dot: 'error', key: 'status.error' }
    case 'conflict': return { dot: 'warning', key: 'status.conflict' }
  }
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

/** Full center-column replacement registered into ui-layout's conversation seat. */
export function WorkbenchStatusPage({ controller, t, children }: WorkbenchStatusPageProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const presentation = statePresentation(state)
  const unchanged = state.draft.trim() === (state.snapshot?.message ?? '')
  const saveDisabled = !controller.canSave()
  const resetDisabled = state.pending || (!state.draftDirty && unchanged)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (saveDisabled) return
    void controller.save()
  }

  const editorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && !state.pending) {
      event.preventDefault()
      controller.resetDraft()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!saveDisabled) event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <main className={css.surface} aria-labelledby="workbench-title" data-workbench-phase={state.phase}>
      <div className={css.shell}>
        <header className={css.hero}>
          <p className={css.eyebrow}>{t('eyebrow')}</p>
          <h1 id="workbench-title" className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </header>

        <section className={css.card} aria-labelledby="workbench-status-title" aria-busy={state.pending}>
          <div className={css.cardHeader}>
            <div>
              <p className={css.kicker}>{t('card.kicker')}</p>
              <h2 id="workbench-status-title" className={css.cardTitle}>{t('card.title')}</h2>
            </div>
            <div className={css.syncState} role="status" aria-live="polite">
              <StateDot state={presentation.dot} size={12} />
              <span>{t(presentation.key)}</span>
            </div>
          </div>

          {state.phase === 'loading' && state.snapshot === null && (
            <div className={css.loadingBlock} aria-hidden="true">
              <span className={css.loadingLine} />
              <span className={css.loadingLineShort} />
            </div>
          )}

          {state.phase === 'empty' && state.snapshot === null && state.draft === '' && (
            <div className={css.emptyBlock}>
              <strong>{t('empty.title')}</strong>
              <span>{t('empty.body')}</span>
            </div>
          )}

          {state.phase === 'stale' && (
            <p className={css.notice} role="status">{t('notice.stale')}</p>
          )}

          {state.phase === 'error' && state.issue?.kind === 'transport' && (
            <div className={css.problem} role="alert">
              <div>
                <strong>{t('notice.error.title')}</strong>
                <p>{t('notice.error.body')}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { void controller.refresh() }}>
                {t('action.retry')}
              </Button>
            </div>
          )}

          {state.phase === 'error' && state.issue?.kind === 'input' && (
            <div className={css.conflict} role="alert">
              <strong>{t('notice.input.title')}</strong>
              <p>{t('notice.input.body')}</p>
            </div>
          )}

          {state.phase === 'conflict' && (
            <div className={css.conflict} role="alert">
              <strong>{t('notice.conflict.title')}</strong>
              <p>{t('notice.conflict.body')}</p>
            </div>
          )}

          {state.snapshot !== null && (
            <div className={css.authoritative} aria-label={t('card.title')}>
              <p>{state.snapshot.message}</p>
              <dl className={css.meta}>
                <div>
                  <dt>{t('meta.revision')}</dt>
                  <dd>{state.snapshot.revision}</dd>
                </div>
                <div>
                  <dt>{t('meta.updated')}</dt>
                  <dd><time dateTime={state.snapshot.updatedAt}>{readableTimestamp(state.snapshot.updatedAt)}</time></dd>
                </div>
              </dl>
            </div>
          )}

          <form className={css.form} onSubmit={submit}>
            <label className={css.label} htmlFor="workbench-status-editor">{t('field.label')}</label>
            <textarea
              id="workbench-status-editor"
              className={css.editor}
              value={state.draft}
              placeholder={t('field.placeholder')}
              aria-describedby="workbench-status-hint"
              disabled={state.pending}
              rows={4}
              onChange={event => { controller.setDraft(event.currentTarget.value) }}
              onKeyDown={editorKeyDown}
            />
            <div className={css.formFooter}>
              <p id="workbench-status-hint" className={css.hint}>{t('field.hint')}</p>
              <div className={css.actions}>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={resetDisabled}
                  onClick={() => { controller.resetDraft() }}
                >
                  {t('action.reset')}
                </Button>
                <Button variant="primary" type="submit" disabled={saveDisabled}>
                  {state.pending ? t('action.saving') : t('action.save')}
                </Button>
              </div>
            </div>
          </form>
        </section>
        {children !== undefined && <div className={css.secondary}>{children}</div>}
      </div>
    </main>
  )
}
