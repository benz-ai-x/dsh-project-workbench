/** Loader-only principal fixture for exercising the built Host in-process. */

import { Service } from '@deepseek-ai/cordis'
import {
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from '../../../packages/workbench-host/lib/index.js'

export default class WorkbenchAuthFixture extends Service {
  static inject = []

  constructor(ctx) {
    super(ctx, 'workbenchAuth')
    this.principal = ownerPrincipal({
      kind: 'owner',
      ownerId: 'owner-loader-fixture',
      organizationId: 'organization-loader-fixture',
      teamId: 'team-loader-fixture',
      sessionId: 'session-loader-fixture',
      credentialVersion: 1,
    })
    this.authorizationRequests = []
    this.deniedActions = new Set()
    this.scopeOverrides = new Map()
    this.authorization = new WorkbenchAuthorizationContext({
      authorize: async request => {
        this.authorizationRequests.push(request.action)
        if (request.principal === null || this.deniedActions.has(request.action)) {
          return { allowed: false, reason: 'revoked-session' }
        }
        return {
          allowed: true,
          scope: this.scopeOverrides.get(request.action) ?? Object.freeze({
            ownerId: request.principal.ownerId,
            organizationId: request.principal.organizationId,
            teamId: request.principal.teamId,
          }),
        }
      },
    })
  }

  run(operation) {
    return this.authorization.runAs(this.principal, operation)
  }

  deny(action) {
    this.deniedActions.add(action)
  }

  overrideScope(action, scope) {
    this.scopeOverrides.set(action, Object.freeze({ ...scope }))
  }

  resetAuthorizationEvidence() {
    this.authorizationRequests.length = 0
    this.deniedActions.clear()
    this.scopeOverrides.clear()
  }
}
