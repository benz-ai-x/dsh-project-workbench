/** Browser entry for the Project Workbench status surface. */

import workbenchRemote from '@benz-ai-x/dsh-project-workbench/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountWorkbenchClient } from './mount.ts'

export { WorkbenchStatusController } from './controller.ts'
export type {
  WorkbenchClientState,
  WorkbenchConflictIssue,
  WorkbenchInputIssue,
  WorkbenchIssue,
  WorkbenchPhase,
  WorkbenchRemote,
  WorkbenchTransportIssue,
} from './controller.ts'
export { WorkbenchStatusPage } from './WorkbenchStatusPage.tsx'
export type { WorkbenchStatusPageProps } from './WorkbenchStatusPage.tsx'
export { mountWorkbenchClient, registerWorkbenchUi, uiInject, WORKBENCH_SLOT_PRIORITY } from './mount.ts'
export { en, NS, zh } from './locales.ts'
export type { WorkbenchKey } from './locales.ts'

/** Initial browser dependency: the shared Remote BFF used to mount descriptors. */
export const inject = ['remote']

/** Mount generated Host reflection before any Workbench UI reads it. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountWorkbenchClient(ctx, workbenchRemote)
}
