/** Browser adapter: generated Remote contribution -> controller -> ui-layout Slot. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { WorkbenchStatusController, type WorkbenchRemote } from './controller.ts'
import { WorkbenchStatusPage } from './WorkbenchStatusPage.tsx'
import { en, NS, zh, type WorkbenchKey } from './locales.ts'

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
export function registerWorkbenchUi(ctx: ClientContext): void {
  const workbench = ctx.get('remote.workbench') as WorkbenchRemote
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new WorkbenchStatusController(workbench)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-workbench: dictionaries')
  ctx.effect(() => {
    let hadGeneration = connection.generation.getSnapshot() !== undefined
    const offGeneration = connection.generation.subscribe(() => {
      const connected = connection.generation.getSnapshot() !== undefined
      if (hadGeneration && !connected) controller.markDisconnected()
      hadGeneration = connected
    })
    const offReset = ctx.on('connection/reset', () => { void controller.connectionReset() })
    void controller.refresh()
    return async () => {
      offReset()
      offGeneration()
      await controller.dispose()
    }
  }, 'project-workbench: status controller')

  ctx.slots.inject('conversation', () => ctx.slots.register({
    name: 'conversation',
    priority: WORKBENCH_SLOT_PRIORITY,
    locale: NS,
    registrant: '@benz-ai-x/dsh-project-workbench-client',
    inject: () => ({ controller }),
  }, WorkbenchStatusPage))
}

/**
 * Mount the generated Remote first, then its dependent UI. Roll back partial
 * setup and always unload UI before withdrawing the Remote namespace.
 */
export async function mountWorkbenchClient(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject([...uiInject], registerWorkbenchUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
