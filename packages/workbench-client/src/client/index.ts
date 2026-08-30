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
  WorkbenchStatusControllerOptions,
  WorkbenchTransportIssue,
} from './controller.ts'
export {
  INITIAL_WORKBENCH_ACTIVITY_STATE,
  WorkbenchActivityController,
} from './activity-controller.ts'
export type {
  WorkbenchActivityClientState,
  WorkbenchActivityControllerFace,
  WorkbenchActivityControllerOptions,
  WorkbenchActivityPhase,
  WorkbenchActivityRemote,
  WorkbenchActivityTransportIssue,
} from './activity-controller.ts'
export { OWNER_AUTH_ENDPOINTS, OwnerAuthHttpAdapter } from './auth-http.ts'
export type { OwnerAuthFetch, OwnerAuthHttp } from './auth-http.ts'
export { OwnerController } from './owner-controller.ts'
export type {
  OwnerControllerOptions,
  OwnerClientState,
  OwnerIssue,
  OwnerIssueCode,
  OwnerOperation,
  OwnerPhase,
} from './owner-controller.ts'
export { OwnerPage } from './OwnerPage.tsx'
export type { OwnerPageProps } from './OwnerPage.tsx'
export { ActivityPanel, DEFAULT_ACTIVITY_PANEL_COPY } from './ActivityPanel.tsx'
export type { ActivityPanelCopy, ActivityPanelProps } from './ActivityPanel.tsx'
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
