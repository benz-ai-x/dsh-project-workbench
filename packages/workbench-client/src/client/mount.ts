/** Browser adapter: generated Remote contribution -> controller -> ui-layout Slot. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { OwnerAuthHttpAdapter, type OwnerAuthHttp } from './auth-http.ts'
import { type WorkbenchRemote } from './controller.ts'
import { OwnerController } from './owner-controller.ts'
import { OwnerPage } from './OwnerPage.tsx'
import { en, NS, zh, type WorkbenchKey } from './locales.ts'
import { mountWorkbenchStyles } from './style-lifecycle.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project Workbench status-page copy. */
    workbench: WorkbenchKey
  }
}

/** Workbench wins the single conversation cell without touching the root frame. */
export const WORKBENCH_SLOT_PRIORITY = -100

/** Required services after the generated `workbench` Remote namespace is mounted. */
export const uiInject = ['remote.workbench', 'slots', 'locale', 'connection']

/** Register the React-free model and pure page inside the UI child Fiber. */
export function registerWorkbenchUi(
  ctx: ClientContext,
  auth: OwnerAuthHttp = new OwnerAuthHttpAdapter(),
): void {
  const workbench = ctx.get('remote.workbench') as WorkbenchRemote
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new OwnerController(auth, workbench)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-workbench: dictionaries')
  ctx.effect(() => {
    let hadGeneration = connection.generation.getSnapshot() !== undefined
    const offGeneration = connection.generation.subscribe(() => {
      const connected = connection.generation.getSnapshot() !== undefined
      if (hadGeneration && !connected) controller.markDisconnected()
      hadGeneration = connected
    })
    const offReset = ctx.on('connection/reset', () => { void controller.connectionReset() })
    const checkExpiry = () => { controller.checkSessionExpiry() }
    const checkVisibleExpiry = () => {
      if (document.visibilityState === 'visible') checkExpiry()
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', checkExpiry)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', checkVisibleExpiry)
    }
    void controller.start()
    return async () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', checkVisibleExpiry)
      }
      if (typeof window !== 'undefined') window.removeEventListener('focus', checkExpiry)
      offReset()
      offGeneration()
      await controller.dispose()
    }
  }, 'project-workbench: Owner controller')

  ctx.slots.inject('conversation', () => ctx.slots.register({
    name: 'conversation',
    priority: WORKBENCH_SLOT_PRIORITY,
    locale: NS,
    registrant: '@benz-ai-x/dsh-project-workbench-client',
    inject: () => ({ controller }),
  }, OwnerPage))
}

/**
 * Mount the generated Remote first, then its dependent UI. Roll back partial
 * setup and always unload UI before withdrawing the Remote namespace.
 */
export async function mountWorkbenchClient(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
  auth: OwnerAuthHttp = new OwnerAuthHttpAdapter(),
): Promise<() => Promise<void>> {
  const disposeStyles = mountWorkbenchStyles()
  let disposeRemote: () => Promise<void>
  try {
    disposeRemote = await ctx.remote.$mount(contribution)
  } catch (error) {
    disposeStyles()
    throw error
  }
  const ui = ctx.inject([...uiInject], uiContext => { registerWorkbenchUi(uiContext, auth) })
  try {
    await ui
  } catch (error) {
    try {
      await ui.dispose()
    } finally {
      disposeStyles()
      await disposeRemote()
    }
    throw error
  }
  return async () => {
    try {
      await ui.dispose()
    } finally {
      disposeStyles()
      await disposeRemote()
    }
  }
}
