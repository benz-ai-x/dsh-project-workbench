/** Loader-only principal fixture for exercising the built Host in-process. */

import { Service } from '@deepseek-ai/cordis'
import {
  V1OwnerAuthorizationPolicy,
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from '../../../packages/workbench-host/lib/index.js'

export default class WorkbenchAuthFixture extends Service {
  static inject = []

  constructor(ctx) {
    super(ctx, 'workbenchAuth')
    this.authorization = new WorkbenchAuthorizationContext(
      new V1OwnerAuthorizationPolicy(async () => true),
    )
    this.principal = ownerPrincipal({
      kind: 'owner',
      ownerId: 'owner-loader-fixture',
      organizationId: 'organization-loader-fixture',
      teamId: 'team-loader-fixture',
      sessionId: 'session-loader-fixture',
      credentialVersion: 1,
    })
  }

  run(operation) {
    return this.authorization.runAs(this.principal, operation)
  }
}
