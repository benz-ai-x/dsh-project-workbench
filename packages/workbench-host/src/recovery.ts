/** Local-only Owner recovery over the official DSH credential provider. */

import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  OwnerAccess,
  type OwnerRecoveryResult,
} from './owner-access.ts'
import { DshOwnerCredentialStore } from './owner-credential-store.ts'

/**
 * One offline recovery request. The literal precondition makes every caller
 * acknowledge that the normal Web Host no longer has the credential store
 * open before this second, short-lived Cordis composition is started.
 */
export interface OfflineOwnerRecoveryRequest {
  readonly recoveryCode: string
  readonly newPassword: string
  readonly dshHome?: string
  readonly webHostStopped: true
  readonly signal?: AbortSignal
}

/** Stable failure for a caller that did not acknowledge the offline boundary. */
export class OfflineOwnerRecoveryPreconditionError extends Error {
  readonly code = 'web-host-must-be-stopped'

  constructor() {
    super('Offline Owner recovery requires the Workbench Web Host to be stopped')
    this.name = 'OfflineOwnerRecoveryPreconditionError'
  }
}

/**
 * Reset the singleton Owner through a minimal, watcher-free Cordis Context.
 *
 * The LocalCredentialProvider owns parsing, permissions, locking, and atomic
 * persistence. OwnerAccess owns recovery-code consumption, password hashing,
 * credential-version rotation, and session revocation. Plaintext inputs and
 * the one replacement code never enter configuration, argv, or environment.
 */
export async function recoverOwnerOffline(
  request: OfflineOwnerRecoveryRequest,
): Promise<OwnerRecoveryResult> {
  if (request.webHostStopped !== true) {
    throw new OfflineOwnerRecoveryPreconditionError()
  }

  const context = new Context()
  const provider = context.plugin(LocalCredentialProvider, {
    dshHome: resolveDshHome(request.dshHome),
    watch: false,
  })
  let access: OwnerAccess | undefined
  let result: OwnerRecoveryResult | undefined
  let failure: unknown

  try {
    await provider
    access = new OwnerAccess({
      store: new DshOwnerCredentialStore(context.credentials),
    })
    await access.open()
    result = await access.recover(
      request.recoveryCode,
      request.newPassword,
      request.signal,
    )
  } catch (error) {
    failure = error
  }

  try {
    await access?.close()
  } catch (error) {
    failure ??= error
  }
  try {
    await provider.dispose()
  } catch (error) {
    failure ??= error
  }

  if (failure !== undefined) throw failure
  if (result === undefined) throw new Error('Offline Owner recovery produced no result')
  return result
}
