#!/usr/bin/env node

/**
 * Verify the executable artifacts that T08 actually loads.
 *
 * This intentionally runs after `pnpm build`.  It imports the Host entry and
 * generated Typert modules as plain JavaScript, and executes the Client bundle
 * only far enough to observe its lazy-CJS registration handoff.
 */

import {
  existsSync,
  globSync,
  readFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const hostDir = resolve(root, 'packages/workbench-host')
const clientDir = resolve(root, 'packages/workbench-client')
const failures = []
const passed = []

const hostManifest = readManifest(hostDir)
const clientManifest = readManifest(clientDir)

try {
  await verifyHost()
} catch (error) {
  fail(`Host verification stopped unexpectedly: ${errorMessage(error)}`)
}
try {
  await verifyClient()
} catch (error) {
  fail(`Client verification stopped unexpectedly: ${errorMessage(error)}`)
}

if (failures.length > 0) {
  console.error('verify-built: built artifact failures:')
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exitCode = 1
} else {
  console.log(`verify-built: ${passed.length} check(s) passed.`)
}

async function verifyHost() {
  if (hostManifest === undefined) return
  const packageName = hostManifest.name
  check(packageName === '@benz-ai-x/dsh-project-workbench', 'Host package keeps its public name')
  check(hostManifest.type === 'module', `${packageName}: package is ESM`)

  const expectedExports = {
    '.': './lib/index.js',
    './auth': './lib/owner-auth-service.js',
    './client': './lib/client.js',
    './typert': './lib/typert.host.js',
    './remote': './lib/typert.remote-client.js',
    './recovery': './lib/recovery.js',
    './package.json': './package.json',
  }
  for (const [subpath, expected] of Object.entries(expectedExports)) {
    const actual = defaultExportTarget(hostManifest.exports?.[subpath])
    check(actual === expected, `${packageName}: export ${subpath} resolves to ${expected}`)
    if (actual !== undefined) checkArtifact(hostDir, actual, `${packageName}: export ${subpath}`)
  }

  check(hostManifest.main === 'lib/index.js', `${packageName}: main resolves to built JavaScript`)
  check(hostManifest.types === 'lib/types/index.d.ts', `${packageName}: types resolve to built declarations`)
  check(hostManifest.bin?.['dsh-workbench'] === './lib/recover-cli.js', `${packageName}: dsh-workbench resolves to the built recovery CLI`)
  checkArtifact(hostDir, hostManifest.bin?.['dsh-workbench'], `${packageName}: dsh-workbench bin`)
  verifyDeclaredFiles(hostDir, hostManifest)
  verifyNoSourceEntries(hostManifest)
  verifyRuntimeImports(hostDir, hostManifest)
  verifyPublicHostImports(hostDir, packageName)

  const main = await importArtifact(hostDir, './lib/index.js', `${packageName}: Host main`)
  if (main !== undefined) {
    check(typeof main.default === 'function', `${packageName}: default export is the Host Service class`)
    check(main.default === main.WorkbenchService, `${packageName}: default export is WorkbenchService`)
    check(typeof main.Config === 'function', `${packageName}: Config runtime schema is exported`)
    check(typeof main.WorkbenchScenario === 'function', `${packageName}: WorkbenchScenario is exported`)
    check(typeof main.SqliteWorkbenchRepository === 'function', `${packageName}: SQLite repository is exported`)
    check(main.WORKBENCH_SCHEMA_VERSION === 9, `${packageName}: built SQLite authority exports Schema v9`)
    check(typeof main.DshFeishuConnectionAdapter === 'function', `${packageName}: production Feishu adapter is a packed main export`)
    check(main.FEISHU_CONNECTION_ADAPTER_ID === 'feishu-open-platform-v1', `${packageName}: Feishu adapter exports its stable identity`)
    check(
      typeof main.DshFeishuConnectionAdapter.prototype.startIdentityVerification === 'function'
        && !Object.hasOwn(main.DshFeishuConnectionAdapter.prototype, 'verify'),
      `${packageName}: Feishu adapter starts identity verification explicitly and has no legacy one-phase verify method`,
    )
    check(
      typeof main.DshFeishuConnectionAdapter.prototype.listTaskWorkflowFields === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.createTaskWorkflowField === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.updateTaskWorkflowField === 'function',
      `${packageName}: Feishu adapter ships the complete T09 workflow-field read/write surface`,
    )
    check(
      typeof main.DshFeishuConnectionAdapter.prototype.listCalendars === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.readCalendar === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.createCalendar === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.listCalendarEvents === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.readCalendarEvent === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.createCalendarEvent === 'function'
        && typeof main.DshFeishuConnectionAdapter.prototype.updateCalendarEventSchedule === 'function',
      `${packageName}: Feishu adapter ships the complete T10 Calendar v4 surface`,
    )
  }

  const feishuAdapterDeclaration = readArtifact(
    hostDir,
    './lib/types/feishu-connection-adapter.d.ts',
    `${packageName}: Feishu adapter declaration`,
  )
  const scenarioDeclaration = readArtifact(
    hostDir,
    './lib/types/scenario.d.ts',
    `${packageName}: Scenario declaration`,
  )
  if (feishuAdapterDeclaration !== undefined && scenarioDeclaration !== undefined) {
    const identityInput = scenarioDeclaration.match(
      /export interface WorkbenchFeishuIdentityVerificationInput \{([\s\S]*?)\n\}/u,
    )?.[1]
    const verifiedSession = scenarioDeclaration.match(
      /export interface WorkbenchFeishuVerifiedIdentitySession \{([\s\S]*?)\n\}/u,
    )?.[1]
    check(
      /\bstartIdentityVerification\(/u.test(feishuAdapterDeclaration)
        && !/\n\s+verify\(/u.test(feishuAdapterDeclaration),
      `${packageName}: public adapter declaration exposes startIdentityVerification and no one-phase verify`,
    )
    check(
      typeof identityInput === 'string'
        && identityInput.includes('kind: FeishuIdentityKind')
        && identityInput.includes('appId: string')
        && identityInput.includes('credentialRef: string')
        && !identityInput.includes('resourceProbe'),
      `${packageName}: identity phase declaration cannot receive a resource identifier`,
    )
    check(
      typeof verifiedSession === 'string'
        && verifiedSession.includes('finishVerification(')
        && verifiedSession.includes('resourceId: string')
        && verifiedSession.includes('dispose(): void'),
      `${packageName}: verified identity returns an opaque one-shot resource continuation with disposal`,
    )
  }

  const browserContract = await importArtifact(hostDir, './lib/client.js', `${packageName}: browser-safe contract`)
  if (browserContract !== undefined) {
    check(!('default' in browserContract), `${packageName}/client has no accidental default export`)
    check(browserContract.FEISHU_CONNECTION_ID === 'feishu-primary', `${packageName}/client exports the stable Feishu connection identity`)
  }

  const auth = await importArtifact(hostDir, './lib/owner-auth-service.js', `${packageName}: Owner auth Service`)
  if (auth !== undefined) {
    check(typeof auth.default === 'function', `${packageName}/auth exposes a default Service class`)
    check(auth.default === auth.OwnerAuthService, `${packageName}/auth default is OwnerAuthService`)
    check(auth.OWNER_SESSION_COOKIE_NAME?.startsWith('__Host-') === true, `${packageName}/auth owns a __Host- session cookie`)
  }
  const recovery = await importArtifact(hostDir, './lib/recovery.js', `${packageName}: offline recovery API`)
  if (recovery !== undefined) {
    check(typeof recovery.recoverOwnerOffline === 'function', `${packageName}/recovery exposes recoverOwnerOffline`)
    check(!('default' in recovery), `${packageName}/recovery has no accidental default export`)
  }
  const recoveryCli = readArtifact(hostDir, './lib/recover-cli.js', `${packageName}: recovery CLI`)
  if (recoveryCli !== undefined) {
    check(recoveryCli.startsWith('#!/usr/bin/env node'), `${packageName}: recovery CLI preserves its executable shebang`)
  }

  const hostTypertSource = readArtifact(hostDir, './lib/typert.host.js', `${packageName}: generated Host Typert`)
  const remoteTypertSource = readArtifact(hostDir, './lib/typert.remote-client.js', `${packageName}: generated Remote Typert`)
  if (hostTypertSource !== undefined) {
    check(hostTypertSource.includes('Generated by @deepseek-ai/dsh-typert-generator'), `${packageName}/typert carries the generator marker`)
  }
  if (remoteTypertSource !== undefined) {
    check(remoteTypertSource.includes('Generated by @deepseek-ai/dsh-typert-generator'), `${packageName}/remote carries the generator marker`)
  }

  const hostTypert = await importArtifact(hostDir, './lib/typert.host.js', `${packageName}: generated Host Typert`)
  const remoteTypert = await importArtifact(hostDir, './lib/typert.remote-client.js', `${packageName}: generated Remote Typert`)
  if (hostTypert !== undefined) verifyTypertFace(hostTypert.TYPERT, packageName, 'Host')
  if (remoteTypert !== undefined) {
    verifyTypertFace(remoteTypert.TYPERT_REMOTE, packageName, 'Remote')
    check(remoteTypert.default === remoteTypert.TYPERT_REMOTE, `${packageName}/remote default is TYPERT_REMOTE`)
  }
}

async function verifyClient() {
  if (clientManifest === undefined) return
  const packageName = clientManifest.name
  check(packageName === '@benz-ai-x/dsh-project-workbench-client', 'Client package keeps its public name')
  check(clientManifest.type === 'module', `${packageName}: package is ESM`)
  check(clientManifest.dsh?.client?.platform === 'web', `${packageName}: dsh.client declares the web platform`)

  const expectedExports = {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './package.json': './package.json',
  }
  for (const [subpath, expected] of Object.entries(expectedExports)) {
    const actual = defaultExportTarget(clientManifest.exports?.[subpath])
    check(actual === expected, `${packageName}: export ${subpath} resolves to ${expected}`)
    if (actual !== undefined) checkArtifact(clientDir, actual, `${packageName}: export ${subpath}`)
  }

  check(clientManifest.main === 'lib/index.js', `${packageName}: main resolves to built JavaScript`)
  check(clientManifest.types === 'lib/types/index.d.ts', `${packageName}: types resolve to built declarations`)
  verifyDeclaredFiles(clientDir, clientManifest)
  verifyNoSourceEntries(clientManifest)
  verifyRuntimeImports(clientDir, clientManifest)
  verifyPublicClientImport(clientDir, packageName)

  const nodeHalf = await importArtifact(clientDir, './lib/index.js', `${packageName}: Node half`)
  if (nodeHalf !== undefined) {
    check(typeof nodeHalf.apply === 'function', `${packageName}: Node half exposes named apply`)
    check(!('default' in nodeHalf), `${packageName}: Node half has no accidental default export`)
  }

  const bundlePath = resolve(clientDir, 'lib/client.js')
  if (!existsSync(bundlePath)) return
  const source = readFileSync(bundlePath, 'utf8')
  const handoffs = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(handoff) {
          handoffs.push(handoff)
        },
      },
    },
  }
  try {
    vm.runInNewContext(source, sandbox, {
      filename: bundlePath,
      timeout: 5_000,
    })
  } catch (error) {
    fail(`${packageName}/client is not an executable lazy-CJS script: ${errorMessage(error)}`)
    return
  }
  check(handoffs.length === 1, `${packageName}/client registers exactly one lazy-CJS handoff`)
  if (handoffs.length === 1) {
    check(handoffs[0]?.id === packageName, `${packageName}/client registers with its manifest id`)
    check(typeof handoffs[0]?.factory === 'function', `${packageName}/client registers a require factory`)
  }
}

function verifyPublicHostImports(packageDir, packageName) {
  const script = `
    const main = await import(${JSON.stringify(packageName)})
    const auth = await import(${JSON.stringify(`${packageName}/auth`)})
    const contract = await import(${JSON.stringify(`${packageName}/client`)})
    const typert = await import(${JSON.stringify(`${packageName}/typert`)})
    const remote = await import(${JSON.stringify(`${packageName}/remote`)})
    const recovery = await import(${JSON.stringify(`${packageName}/recovery`)})
    if (typeof main.default !== 'function' || main.default !== main.WorkbenchService) throw new Error('invalid Host default export')
    if (typeof main.DshFeishuConnectionAdapter !== 'function' || main.FEISHU_CONNECTION_ADAPTER_ID !== 'feishu-open-platform-v1') throw new Error('invalid Feishu adapter export')
    if (typeof main.DshFeishuConnectionAdapter.prototype.startIdentityVerification !== 'function' || Object.hasOwn(main.DshFeishuConnectionAdapter.prototype, 'verify')) throw new Error('invalid two-phase Feishu adapter surface')
    if (typeof main.DshFeishuConnectionAdapter.prototype.listTaskWorkflowFields !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.createTaskWorkflowField !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.updateTaskWorkflowField !== 'function') throw new Error('invalid Feishu workflow-field adapter surface')
    if (typeof main.DshFeishuConnectionAdapter.prototype.listCalendars !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.readCalendar !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.createCalendar !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.listCalendarEvents !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.readCalendarEvent !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.createCalendarEvent !== 'function' || typeof main.DshFeishuConnectionAdapter.prototype.updateCalendarEventSchedule !== 'function') throw new Error('invalid Feishu Calendar v4 adapter surface')
    if (typeof auth.default !== 'function' || auth.default !== auth.OwnerAuthService) throw new Error('invalid Owner auth export')
    if ('default' in contract) throw new Error('browser-safe contract has an accidental default export')
    if (contract.FEISHU_CONNECTION_ID !== 'feishu-primary') throw new Error('invalid Feishu browser contract export')
    if (typert.TYPERT?.package !== ${JSON.stringify(packageName)}) throw new Error('invalid Host Typert export')
    if (remote.TYPERT_REMOTE?.package !== ${JSON.stringify(packageName)}) throw new Error('invalid Remote Typert export')
    if (typeof recovery.recoverOwnerOffline !== 'function' || 'default' in recovery) throw new Error('invalid recovery export')
  `
  verifyPublicImport(packageDir, script, `${packageName}: public-name imports traverse package exports`)
}

function verifyPublicClientImport(packageDir, packageName) {
  const script = `
    const main = await import(${JSON.stringify(packageName)})
    if (typeof main.apply !== 'function') throw new Error('named apply is missing')
    if ('default' in main) throw new Error('Node half has an accidental default export')
  `
  verifyPublicImport(packageDir, script, `${packageName}: public-name import traverses package exports`)
}

function verifyPublicImport(packageDir, script, label) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined || result.status !== 0) {
    const details = []
    if (result.error !== undefined) details.push(errorMessage(result.error))
    if (result.status !== null) details.push(`exit ${result.status}`)
    if (result.stderr?.trim()) details.push(result.stderr.trim())
    if (result.stdout?.trim()) details.push(result.stdout.trim())
    fail(`${label} failed${details.length === 0 ? '' : `: ${details.join(' | ')}`}`)
    return
  }
  check(true, label)
}

function verifyTypertFace(face, packageName, label) {
  check(face !== null && typeof face === 'object', `${packageName}: ${label} Typert face is exported`)
  if (face === null || typeof face !== 'object') return
  check(face.package === packageName, `${packageName}: ${label} Typert face names its package`)
  if (label === 'Host') check(face.face === 'host', `${packageName}: Host Typert face is host`)
  const invocations = label === 'Host' ? face.invocations : face.descriptors
  check(Array.isArray(invocations), `${packageName}: ${label} Typert face contains invocation descriptors`)
  if (!Array.isArray(invocations)) return
  const methods = invocations.map(invocation => invocation?.method).sort()
  const expectedMethods = [
    'activity',
    'addProjectMember',
    'auditIntegrity',
    'bindFeishuTaskList',
    'bindProjectCalendar',
    'configureFeishuIdentityRoute',
    'configureFeishuTaskWorkflow',
    'createProject',
    'createProjectMilestone',
    'decideSuggestedChange',
    'discoverFeishuCalendarEvents',
    'discoverFeishuCalendars',
    'discoverFeishuTaskLists',
    'discoverFeishuTaskWorkflowFields',
    'feishuConnectionCenter',
    'getProjectMilestones',
    'project',
    'projectStart',
    'projectTasks',
    'projectTeam',
    'previewFeishuTaskWorkflow',
    'proposeProjectResponsibilityChange',
    'reconcileProjectCalendar',
    'reconcileProjectTasks',
    'referenceFeishuTask',
    'reviewCenter',
    'setProjectMemberStatus',
    'setProjectResponsibility',
    'setStatus',
    'snapshot',
    'updateFeishuTask',
    'updateProjectMilestoneDate',
    'verifyFeishuIdentityRoute',
  ]
  check(
    sameStrings(methods, expectedMethods),
    `${packageName}: ${label} Typert face contains exactly the thirty-three T10 Remote methods`,
  )
  for (const invocation of invocations) {
    check(invocation?.namespace === 'workbench', `${packageName}: ${label} ${String(invocation?.method)} uses workbench namespace`)
    check(invocation?.service === 'workbench', `${packageName}: ${label} ${String(invocation?.method)} uses workbench service`)
  }
  const activity = invocations.find(invocation => invocation?.method === 'activity')
  const addProjectMember = invocations.find(invocation => invocation?.method === 'addProjectMember')
  const auditIntegrity = invocations.find(invocation => invocation?.method === 'auditIntegrity')
  const bindFeishuTaskList = invocations.find(
    invocation => invocation?.method === 'bindFeishuTaskList',
  )
  const bindProjectCalendar = invocations.find(
    invocation => invocation?.method === 'bindProjectCalendar',
  )
  const createProject = invocations.find(invocation => invocation?.method === 'createProject')
  const createProjectMilestone = invocations.find(
    invocation => invocation?.method === 'createProjectMilestone',
  )
  const configureFeishuIdentityRoute = invocations.find(
    invocation => invocation?.method === 'configureFeishuIdentityRoute',
  )
  const configureFeishuTaskWorkflow = invocations.find(
    invocation => invocation?.method === 'configureFeishuTaskWorkflow',
  )
  const feishuConnectionCenter = invocations.find(
    invocation => invocation?.method === 'feishuConnectionCenter',
  )
  const discoverFeishuTaskLists = invocations.find(
    invocation => invocation?.method === 'discoverFeishuTaskLists',
  )
  const discoverFeishuCalendars = invocations.find(
    invocation => invocation?.method === 'discoverFeishuCalendars',
  )
  const discoverFeishuCalendarEvents = invocations.find(
    invocation => invocation?.method === 'discoverFeishuCalendarEvents',
  )
  const discoverFeishuTaskWorkflowFields = invocations.find(
    invocation => invocation?.method === 'discoverFeishuTaskWorkflowFields',
  )
  const project = invocations.find(invocation => invocation?.method === 'project')
  const getProjectMilestones = invocations.find(
    invocation => invocation?.method === 'getProjectMilestones',
  )
  const projectStart = invocations.find(invocation => invocation?.method === 'projectStart')
  const projectTasks = invocations.find(invocation => invocation?.method === 'projectTasks')
  const projectTeam = invocations.find(invocation => invocation?.method === 'projectTeam')
  const previewFeishuTaskWorkflow = invocations.find(
    invocation => invocation?.method === 'previewFeishuTaskWorkflow',
  )
  const proposeProjectResponsibilityChange = invocations.find(
    invocation => invocation?.method === 'proposeProjectResponsibilityChange',
  )
  const reviewCenter = invocations.find(invocation => invocation?.method === 'reviewCenter')
  const reconcileProjectTasks = invocations.find(
    invocation => invocation?.method === 'reconcileProjectTasks',
  )
  const reconcileProjectCalendar = invocations.find(
    invocation => invocation?.method === 'reconcileProjectCalendar',
  )
  const referenceFeishuTask = invocations.find(
    invocation => invocation?.method === 'referenceFeishuTask',
  )
  const decideSuggestedChange = invocations.find(
    invocation => invocation?.method === 'decideSuggestedChange',
  )
  const setProjectMemberStatus = invocations.find(
    invocation => invocation?.method === 'setProjectMemberStatus',
  )
  const setProjectResponsibility = invocations.find(
    invocation => invocation?.method === 'setProjectResponsibility',
  )
  const setStatus = invocations.find(invocation => invocation?.method === 'setStatus')
  const snapshot = invocations.find(invocation => invocation?.method === 'snapshot')
  const updateFeishuTask = invocations.find(invocation => invocation?.method === 'updateFeishuTask')
  const updateProjectMilestoneDate = invocations.find(
    invocation => invocation?.method === 'updateProjectMilestoneDate',
  )
  const verifyFeishuIdentityRoute = invocations.find(
    invocation => invocation?.method === 'verifyFeishuIdentityRoute',
  )
  for (const invocation of [
    activity,
    addProjectMember,
    auditIntegrity,
    bindFeishuTaskList,
    bindProjectCalendar,
    configureFeishuIdentityRoute,
    configureFeishuTaskWorkflow,
    createProject,
    createProjectMilestone,
    discoverFeishuCalendarEvents,
    discoverFeishuCalendars,
    discoverFeishuTaskLists,
    discoverFeishuTaskWorkflowFields,
    feishuConnectionCenter,
    getProjectMilestones,
    project,
    projectStart,
    projectTasks,
    projectTeam,
    previewFeishuTaskWorkflow,
    proposeProjectResponsibilityChange,
    reconcileProjectCalendar,
    reconcileProjectTasks,
    referenceFeishuTask,
    reviewCenter,
    decideSuggestedChange,
    setProjectMemberStatus,
    setProjectResponsibility,
    setStatus,
    snapshot,
    updateFeishuTask,
    updateProjectMilestoneDate,
    verifyFeishuIdentityRoute,
  ]) {
    check(
      invocation?.cancellation?.parameter === 'signal',
      `${packageName}: ${label} ${String(invocation?.method)} carries caller cancellation`,
    )
  }

  const request = setStatus?.parameters?.find(parameter => parameter?.name === 'request')
  check(
    sameStrings(schemaObjectKeys(request?.codec?.schema), [
      'causationId',
      'expectedRevision',
      'idempotencyKey',
      'message',
      'reason',
    ]),
    `${packageName}: ${label} SetStatusRequest contains the exact T03 command fields`,
  )
  const resultOptions = unwrapSchema(setStatus?.result?.schema)?.def?.options
  const successfulResult = Array.isArray(resultOptions)
    ? resultOptions.find(option => schemaObjectKeys(option).includes('receipt'))
    : undefined
  check(
    sameStrings(schemaObjectKeys(successfulResult), ['ok', 'receipt', 'value']),
    `${packageName}: ${label} successful SetStatusResult contains its durable receipt`,
  )
  const successShape = unwrapSchema(successfulResult)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(successShape?.receipt), [
      'auditEventId',
      'commandId',
      'outboxId',
    ]),
    `${packageName}: ${label} command receipt contains command, audit, and Outbox identities`,
  )
  const activityFilter = activity?.parameters?.find(parameter => parameter?.name === 'filter')
  check(
    sameStrings(schemaObjectKeys(activityFilter?.codec?.schema), [
      'action',
      'beforeSequence',
      'limit',
      'objectId',
      'objectType',
      'projectId',
    ]),
    `${packageName}: ${label} Activity filter exposes only the stable query fields`,
  )
  check(
    schemaAccepts(activityFilter?.codec?.schema, {
      projectId: 'project-built-artifact',
      objectType: 'suggested-change',
      action: 'workbench.suggested-change.edited-accepted',
      limit: 5,
    })
      && schemaRejects(activityFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        objectType: 'suggested-change',
        action: 'workbench.suggested-change.unknown',
        limit: 5,
      }),
    `${packageName}: ${label} Activity filter carries T06 SuggestedChange vocabulary and rejects unknown actions`,
  )
  check(
    schemaAccepts(activityFilter?.codec?.schema, {
      projectId: null,
      objectType: 'feishu-connection',
      action: 'workbench.feishu-route.verification-recorded',
      limit: 5,
    })
      && schemaRejects(activityFilter?.codec?.schema, {
        projectId: null,
        objectType: 'feishu-connection',
        action: 'workbench.feishu-route.fallback',
        limit: 5,
      }),
    `${packageName}: ${label} Activity filter carries the closed T07 Feishu vocabulary without a fallback action`,
  )
  check(
    schemaAccepts(activityFilter?.codec?.schema, {
      projectId: 'project-built-artifact',
      objectType: 'feishu-task',
      action: 'workbench.feishu-task.update-requested',
      limit: 5,
    })
      && schemaRejects(activityFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        objectType: 'feishu-task',
        action: 'workbench.feishu-task.retried',
        limit: 5,
      }),
    `${packageName}: ${label} Activity filter carries closed T08 task vocabulary without a retry action`,
  )
  check(
    schemaAccepts(activityFilter?.codec?.schema, {
      projectId: 'project-built-artifact',
      objectType: 'feishu-task-workflow',
      action: 'workbench.feishu-task-workflow.configured',
      limit: 5,
    })
      && schemaRejects(activityFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        objectType: 'feishu-task-workflow',
        action: 'workbench.feishu-task-workflow.deleted',
        limit: 5,
      }),
    `${packageName}: ${label} Activity filter carries closed T09 workflow vocabulary without destructive actions`,
  )
  check(
    schemaAccepts(activityFilter?.codec?.schema, {
      projectId: 'project-built-artifact',
      objectType: 'project-milestone',
      action: 'workbench.project-milestone.date-update-requested',
      limit: 5,
    })
      && schemaRejects(activityFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        objectType: 'project-milestone',
        action: 'workbench.project-milestone.deleted',
        limit: 5,
      }),
    `${packageName}: ${label} Activity filter carries closed T10 calendar vocabulary without destructive actions`,
  )
  const activityShape = unwrapSchema(activity?.result?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(activity?.result?.schema), ['integrity', 'items', 'nextBeforeSequence']),
    `${packageName}: ${label} Activity result embeds integrity with the paged browser projection`,
  )
  check(
    sameStrings(schemaObjectKeys(activityShape?.integrity), [
      'eventCount',
      'headHash',
      'issue',
      'valid',
    ]),
    `${packageName}: ${label} Activity result embeds the safe same-snapshot integrity projection`,
  )
  check(
    sameStrings(schemaObjectKeys(auditIntegrity?.result?.schema), [
      'eventCount',
      'headHash',
      'issue',
      'valid',
    ]),
    `${packageName}: ${label} auditIntegrity result exposes the safe verification projection`,
  )

  const discoverCalendarsRequest = discoverFeishuCalendars?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(discoverCalendarsRequest?.codec?.schema), [
      'expectedConnectionRevision',
      'expectedRouteGeneration',
      'kind',
      'projectId',
    ]),
    `${packageName}: ${label} calendar discovery pins one exact route and Project`,
  )
  const bindCalendarRequest = bindProjectCalendar?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    schemaAccepts(bindCalendarRequest?.codec?.schema, {
      projectId: 'project-built-artifact',
      kind: 'bot',
      expectedConnectionRevision: 2,
      expectedRouteGeneration: 3,
      expectedBindingRevision: null,
      idempotencyKey: 'built-calendar-bind-key-0001',
      causationId: 'built-calendar-bind-cause-0001',
      reason: 'owner-project-calendar-bind',
      mode: 'existing',
      calendarId: 'calendar-built',
    })
      && schemaAccepts(bindCalendarRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        kind: 'user',
        expectedConnectionRevision: 2,
        expectedRouteGeneration: 3,
        expectedBindingRevision: null,
        idempotencyKey: 'built-calendar-bind-key-0002',
        causationId: 'built-calendar-bind-cause-0002',
        reason: 'owner-project-calendar-bind',
        mode: 'create',
        summary: 'Built Project calendar',
        description: null,
      })
      && schemaRejects(bindCalendarRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        kind: 'bot',
        expectedConnectionRevision: 2,
        expectedRouteGeneration: 3,
        expectedBindingRevision: null,
        idempotencyKey: 'built-calendar-bind-key-0003',
        causationId: 'built-calendar-bind-cause-0003',
        reason: 'owner-project-calendar-bind',
        mode: 'existing',
        calendarId: 'calendar-built',
        summary: 'must not cross modes',
      }),
    `${packageName}: ${label} calendar binding keeps exact existing/create modes without fallback fields`,
  )
  const discoverEventsRequest = discoverFeishuCalendarEvents?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(discoverEventsRequest?.codec?.schema), [
      'expectedRevision',
      'projectId',
    ]),
    `${packageName}: ${label} event discovery is fenced by Project schedule revision`,
  )
  const milestonesQuery = getProjectMilestones?.parameters?.find(
    parameter => parameter?.name === 'query',
  )
  check(
    sameStrings(schemaObjectKeys(milestonesQuery?.codec?.schema), ['projectId']),
    `${packageName}: ${label} Milestone lookup accepts only one Project identity`,
  )
  const milestonesProjection = unionOptions(getProjectMilestones?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('milestones'))
    ?? unwrapSchema(getProjectMilestones?.result?.schema)
  check(
    sameStrings(schemaObjectKeys(milestonesProjection), [
      'binding',
      'effects',
      'milestones',
      'projectId',
      'recentChanges',
      'revision',
      'sync',
    ]),
    `${packageName}: ${label} Milestone lookup carries binding, authority, effects, and change feed`,
  )
  const createMilestoneRequest = createProjectMilestone?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    schemaAccepts(createMilestoneRequest?.codec?.schema, {
      projectId: 'project-built-artifact',
      expectedRevision: 4,
      expectedMilestoneRevision: null,
      name: 'Built milestone',
      description: null,
      idempotencyKey: 'built-milestone-create-key-0001',
      causationId: 'built-milestone-create-cause-0001',
      reason: 'owner-project-milestone-create',
      mode: 'create-event',
      schedule: { kind: 'all-day', startDate: '2026-09-01', endDate: '2026-09-02' },
    })
      && schemaAccepts(createMilestoneRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedRevision: 4,
        expectedMilestoneRevision: null,
        name: 'Built timed milestone',
        idempotencyKey: 'built-milestone-create-key-0002',
        causationId: 'built-milestone-create-cause-0002',
        reason: 'owner-project-milestone-create',
        mode: 'create-event',
        schedule: {
          kind: 'timed',
          startAt: '2026-09-01T09:00:00+08:00',
          endAt: '2026-09-01T10:00:00+08:00',
          timeZone: 'Asia/Shanghai',
        },
      })
      && schemaRejects(createMilestoneRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedRevision: 4,
        expectedMilestoneRevision: null,
        name: 'Invalid mixed milestone',
        idempotencyKey: 'built-milestone-create-key-0003',
        causationId: 'built-milestone-create-cause-0003',
        reason: 'owner-project-milestone-create',
        mode: 'existing-event',
        eventId: 'event-built',
        schedule: { kind: 'all-day', startDate: '2026-09-01', endDate: '2026-09-02' },
      }),
    `${packageName}: ${label} Milestone creation carries closed event modes and schedule variants`,
  )
  const updateMilestoneRequest = updateProjectMilestoneDate?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(updateMilestoneRequest?.codec?.schema), [
      'causationId',
      'expectedMilestoneRevision',
      'expectedRemoteObservationVersion',
      'expectedRevision',
      'idempotencyKey',
      'milestoneId',
      'projectId',
      'reason',
      'schedule',
    ]),
    `${packageName}: ${label} Milestone date update carries Project, Milestone, and observation fencing`,
  )
  const reconcileCalendarRequest = reconcileProjectCalendar?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(reconcileCalendarRequest?.codec?.schema), [
      'expectedRevision',
      'projectId',
    ]),
    `${packageName}: ${label} calendar reconciliation is one Project-revision-fenced command`,
  )

  const projectTasksQuery = projectTasks?.parameters?.find(parameter => parameter?.name === 'query')
  check(
    sameStrings(schemaObjectKeys(projectTasksQuery?.codec?.schema), ['projectId']),
    `${packageName}: ${label} Project Tasks query carries only Project identity`,
  )
  const projectTasksResult = unionOptions(projectTasks?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('projectId'))
  check(
    sameStrings(schemaObjectKeys(projectTasksResult), [
      'binding',
      'effects',
      'projectId',
      'revision',
      'sync',
      'tasks',
      'workflow',
    ]),
    `${packageName}: ${label} Project Tasks result carries the optional Host workflow projection`,
  )
  const discoverWorkflowRequest = discoverFeishuTaskWorkflowFields?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(discoverWorkflowRequest?.codec?.schema), [
      'expectedTaskRevision',
      'projectId',
    ]),
    `${packageName}: ${label} workflow-field discovery carries only Project identity and task CAS`,
  )
  check(
    sameStrings(schemaObjectKeys(discoverFeishuTaskWorkflowFields?.result?.schema), [
      'items',
      'projectId',
      'taskListGuid',
      'taskRevision',
    ]),
    `${packageName}: ${label} workflow-field discovery returns one task-revision-fenced field page`,
  )
  const workflowFieldCandidate = arrayElementSchema(
    unwrapSchema(discoverFeishuTaskWorkflowFields?.result?.schema)?.def?.shape?.items,
  )
  check(
    sameStrings(schemaObjectKeys(workflowFieldCandidate), [
      'fieldGuid',
      'name',
      'options',
      'remoteVersion',
      'type',
    ]),
    `${packageName}: ${label} discovered workflow fields retain stable field identity and opaque version`,
  )
  const workflowDefinition = {
    fieldName: 'Workbench status',
    initialStateId: 'planned',
    terminalStateIds: ['done'],
    states: [
      {
        stateId: 'planned',
        name: 'Planned',
        colorIndex: 1,
        allowedNextStateIds: ['done'],
      },
      {
        stateId: 'done',
        name: 'Done',
        colorIndex: 2,
        allowedNextStateIds: [],
      },
    ],
  }
  const previewWorkflowRequest = previewFeishuTaskWorkflow?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(previewWorkflowRequest?.codec?.schema), [
      'definition',
      'expectedTaskRevision',
      'expectedWorkflowRevision',
      'mapping',
      'projectId',
    ]),
    `${packageName}: ${label} workflow preview carries exact definition, mapping, and dual CAS fields`,
  )
  const previewWorkflowRequestShape = unwrapSchema(previewWorkflowRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(previewWorkflowRequestShape?.definition), [
      'fieldName',
      'initialStateId',
      'states',
      'terminalStateIds',
    ]),
    `${packageName}: ${label} workflow definition carries field, initial, states, and terminal semantics`,
  )
  const workflowStateDefinition = arrayElementSchema(
    unwrapSchema(previewWorkflowRequestShape?.definition)?.def?.shape?.states,
  )
  check(
    sameStrings(schemaObjectKeys(workflowStateDefinition), [
      'allowedNextStateIds',
      'colorIndex',
      'name',
      'stateId',
    ]),
    `${packageName}: ${label} workflow states carry stable IDs, display metadata, and transition edges`,
  )
  check(
    schemaAccepts(previewWorkflowRequest?.codec?.schema, {
      projectId: 'project-built-artifact',
      expectedTaskRevision: 4,
      expectedWorkflowRevision: null,
      definition: workflowDefinition,
      mapping: { mode: 'create' },
    })
      && schemaAccepts(previewWorkflowRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedTaskRevision: 4,
        expectedWorkflowRevision: 2,
        definition: workflowDefinition,
        mapping: { mode: 'migrate' },
      })
      && schemaAccepts(previewWorkflowRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedTaskRevision: 4,
        expectedWorkflowRevision: null,
        definition: workflowDefinition,
        mapping: {
          mode: 'existing',
          fieldGuid: 'field-built-1',
          options: [
            { stateId: 'planned', optionGuid: 'option-built-planned' },
            { stateId: 'done', optionGuid: 'option-built-done' },
          ],
        },
      })
      && schemaRejects(previewWorkflowRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedTaskRevision: 4,
        expectedWorkflowRevision: null,
        definition: workflowDefinition,
        mapping: { mode: 'delete' },
      }),
    `${packageName}: ${label} workflow preview admits create/existing/migrate and rejects unknown mapping modes`,
  )
  check(
    sameStrings(schemaObjectKeys(previewFeishuTaskWorkflow?.result?.schema), [
      'compatibility',
      'definition',
      'mapping',
      'projectId',
      'taskRevision',
      'usedStateIds',
      'workflowRevision',
    ]),
    `${packageName}: ${label} workflow preview returns compatibility and observed usage under both CAS fences`,
  )
  const configureWorkflowRequest = configureFeishuTaskWorkflow?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    sameStrings(schemaObjectKeys(configureWorkflowRequest?.codec?.schema), [
      'causationId',
      'definition',
      'expectedTaskRevision',
      'expectedWorkflowRevision',
      'idempotencyKey',
      'mapping',
      'projectId',
      'reason',
    ]),
    `${packageName}: ${label} workflow configuration adds exact durable command identity fields`,
  )
  check(
    schemaAccepts(configureWorkflowRequest?.codec?.schema, {
      projectId: 'project-built-artifact',
      expectedTaskRevision: 4,
      expectedWorkflowRevision: null,
      definition: workflowDefinition,
      mapping: { mode: 'create' },
      idempotencyKey: 'built-workflow-idempotency-0001',
      causationId: 'built-workflow-causation-0001',
      reason: 'owner-feishu-task-workflow-configure',
    })
      && schemaRejects(configureWorkflowRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        expectedTaskRevision: 4,
        expectedWorkflowRevision: null,
        definition: workflowDefinition,
        mapping: { mode: 'create' },
        idempotencyKey: 'built-workflow-idempotency-0001',
        causationId: 'built-workflow-causation-0001',
        reason: 'owner-feishu-task-workflow-delete',
      }),
    `${packageName}: ${label} workflow configuration exposes only the closed T09 reason`,
  )
  const configureWorkflowSuccess = unionOptions(configureFeishuTaskWorkflow?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('receipt'))
  check(
    sameStrings(schemaObjectKeys(configureWorkflowSuccess), ['ok', 'receipt', 'value'])
      && sameStrings(
        schemaObjectKeys(unwrapSchema(configureWorkflowSuccess)?.def?.shape?.value),
        ['binding', 'effects', 'projectId', 'revision', 'sync', 'tasks', 'workflow'],
      ),
    `${packageName}: ${label} successful workflow configuration returns receipt plus complete Project Tasks truth`,
  )
  const bindTaskListRequest = bindFeishuTaskList?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const bindTaskListBase = {
    projectId: 'project-built-artifact',
    kind: 'bot',
    expectedConnectionRevision: 7,
    expectedRouteGeneration: 3,
    expectedBindingRevision: null,
    idempotencyKey: 'built-task-bind-idempotency-0001',
    causationId: 'built-task-bind-causation-0001',
    reason: 'owner-feishu-task-list-bind',
  }
  check(
    schemaAccepts(bindTaskListRequest?.codec?.schema, {
      ...bindTaskListBase,
      mode: 'existing',
      taskListGuid: 'tasklist-built-1',
    })
      && schemaAccepts(bindTaskListRequest?.codec?.schema, {
        ...bindTaskListBase,
        mode: 'create',
        name: 'Built Project Tasks',
      })
      && schemaRejects(bindTaskListRequest?.codec?.schema, {
        ...bindTaskListBase,
        mode: 'existing',
        taskListGuid: 'tasklist-built-1',
        name: 'Mixed mode',
      }),
    `${packageName}: ${label} task-list binding carries one exact identity fence and one closed mode`,
  )
  const updateTaskRequest = updateFeishuTask?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  check(
    schemaAccepts(updateTaskRequest?.codec?.schema, {
      projectId: 'project-built-artifact',
      taskGuid: 'task-built-1',
      expectedRevision: 4,
      expectedRemoteVersion: '1700000000000',
      changes: { summary: 'Versioned update', completed: true },
      idempotencyKey: 'built-task-update-idempotency-0001',
      causationId: 'built-task-update-causation-0001',
      reason: 'owner-feishu-task-update',
    })
      && schemaRejects(updateTaskRequest?.codec?.schema, {
        projectId: 'project-built-artifact',
        taskGuid: 'task-built-1',
        expectedRevision: 4,
        changes: { summary: 'Missing remote version' },
        idempotencyKey: 'built-task-update-idempotency-0001',
        causationId: 'built-task-update-causation-0001',
        reason: 'owner-feishu-task-update',
      }),
    `${packageName}: ${label} task update requires both local and remote versions plus idempotency`,
  )

  const projectStartFilter = projectStart?.parameters?.find(
    parameter => parameter?.name === 'filter',
  )
  check(
    sameStrings(schemaObjectKeys(projectStartFilter?.codec?.schema), [
      'beforeSequence',
      'limit',
    ]),
    `${packageName}: ${label} ProjectStartFilter contains only the stable paging cursor and limit`,
  )
  check(
    sameStrings(schemaObjectKeys(projectStart?.result?.schema), [
      'catalogRevision',
      'nextBeforeSequence',
      'projects',
      'template',
    ]),
    `${packageName}: ${label} projectStart returns the one-round-trip T04 creation projection`,
  )

  const createRequest = createProject?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const createRequestShape = unwrapSchema(createRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(createRequest?.codec?.schema), [
      'causationId',
      'expectedCatalogRevision',
      'expectedRevision',
      'idempotencyKey',
      'primaryGoal',
      'projectName',
      'reason',
      'supportingGoals',
      'template',
    ]),
    `${packageName}: ${label} CreateProjectRequest contains the exact T04 command fields`,
  )
  check(
    sameStrings(schemaObjectKeys(createRequestShape?.template), [
      'definitionDigest',
      'templateId',
      'templateVersion',
    ]),
    `${packageName}: ${label} project creation selects one exact immutable Template Version`,
  )
  check(
    sameStrings(schemaObjectKeys(createRequestShape?.primaryGoal), ['name', 'outcomes']),
    `${packageName}: ${label} project creation nests one Primary Goal and its Outcomes`,
  )
  const outcomeSchema = arrayElementSchema(
    unwrapSchema(createRequestShape?.primaryGoal)?.def?.shape?.outcomes,
  )
  check(
    sameStrings(schemaObjectKeys(outcomeSchema), ['metric', 'name']),
    `${packageName}: ${label} each new Outcome has a name and measurable metric`,
  )
  check(
    sameStrings(schemaObjectKeys(unwrapSchema(outcomeSchema)?.def?.shape?.metric), [
      'direction',
      'initialValue',
      'metricName',
      'targetValue',
      'unit',
    ]),
    `${packageName}: ${label} each Outcome metric carries baseline, target, unit, and direction`,
  )
  const createResultOptions = unwrapSchema(createProject?.result?.schema)?.def?.options
  const successfulCreate = Array.isArray(createResultOptions)
    ? createResultOptions.find(option => schemaObjectKeys(option).includes('receipt'))
    : undefined
  check(
    sameStrings(schemaObjectKeys(successfulCreate), [
      'catalogRevision',
      'ok',
      'receipt',
      'value',
    ]),
    `${packageName}: ${label} successful project creation returns aggregate, catalog CAS, and receipt`,
  )
  const successfulCreateShape = unwrapSchema(successfulCreate)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(successfulCreateShape?.value), [
      'primaryGoal',
      'project',
      'supportingGoals',
      'templateSnapshot',
    ]),
    `${packageName}: ${label} project creation returns the complete Project detail projection`,
  )
  check(
    sameStrings(schemaObjectKeys(
      unwrapSchema(successfulCreateShape?.value)?.def?.shape?.templateSnapshot,
    ), [
      'capturedAt',
      'definition',
      'snapshotDigest',
      'snapshotSchemaVersion',
      'template',
    ]),
    `${packageName}: ${label} Project detail carries an independent versioned Template Snapshot`,
  )

  const teamQuery = projectTeam?.parameters?.find(parameter => parameter?.name === 'query')
  const teamQueryShape = unwrapSchema(teamQuery?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(teamQuery?.codec?.schema), [
      'actor',
      'organizationId',
      'projectId',
      'teamId',
    ])
      && ['actor', 'organizationId', 'teamId']
        .every(key => isOptionalNever(teamQueryShape?.[key])),
    `${packageName}: ${label} Project Team lookup exposes Project identity and rejects caller authority`,
  )
  check(
    schemaRejects(teamQuery?.codec?.schema, {
      projectId: 'project-built-artifact',
      actor: 'caller-forged-owner',
    }),
    `${packageName}: ${label} Project Team carrier rejects rather than strips caller authority`,
  )
  check(
    sameStrings(schemaObjectKeys(
      unionOptions(projectTeam?.result?.schema)
        .find(option => schemaObjectKeys(option).includes('teamRevision'))
        ?? projectTeam?.result?.schema,
    ), [
      'members',
      'projectId',
      'responsibility',
      'teamRevision',
    ]),
    `${packageName}: ${label} Project Team returns roster, responsibility, and one Team CAS`,
  )

  const addMemberRequest = addProjectMember?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const addMemberShape = unwrapSchema(addMemberRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(addMemberRequest?.codec?.schema), [
      'actor',
      'causationId',
      'expectedRevision',
      'expectedTeamRevision',
      'idempotencyKey',
      'member',
      'memberId',
      'organizationId',
      'projectId',
      'reason',
      'teamId',
    ]),
    `${packageName}: ${label} AddProjectMemberRequest contains caller fields plus explicit authority fences`,
  )
  check(
    ['actor', 'memberId', 'organizationId', 'teamId']
      .every(key => isOptionalNever(addMemberShape?.[key])),
    `${packageName}: ${label} member addition rejects caller-derived actor, scope, and identity`,
  )
  const memberOptions = unionOptions(addMemberShape?.member)
  const humanMember = memberOptions.find(option => schemaLiteralValues(
    unwrapSchema(option)?.def?.shape?.kind,
  ).includes('human'))
  const agentMember = memberOptions.find(option => schemaLiteralValues(
    unwrapSchema(option)?.def?.shape?.kind,
  ).includes('agent'))
  const humanMemberShape = unwrapSchema(humanMember)?.def?.shape
  const agentMemberShape = unwrapSchema(agentMember)?.def?.shape
  check(
    memberOptions.length === 2
      && sameStrings(schemaObjectKeys(humanMember), [
        'agentProfileId',
        'agentProfileVersionId',
        'displayName',
        'identity',
        'kind',
      ])
      && sameStrings(schemaObjectKeys(agentMember), [
        'agentProfileId',
        'agentProfileVersionId',
        'displayName',
        'identity',
        'kind',
      ])
      && ['agentProfileId', 'agentProfileVersionId']
        .every(key => isOptionalNever(humanMemberShape?.[key]))
      && ['agentProfileId', 'agentProfileVersionId', 'identity']
        .every(key => isOptionalNever(agentMemberShape?.[key])),
    `${packageName}: ${label} member creation requires one-identity humans and forbids Agent profiles`,
  )
  const humanIdentity = humanMemberShape?.identity
  const identityOptions = unionOptions(humanIdentity)
  const feishuIdentity = identityOptions.find(option => schemaLiteralValues(
    unwrapSchema(option)?.def?.shape?.type,
  ).includes('feishu'))
  const externalIdentity = identityOptions.find(option => schemaLiteralValues(
    unwrapSchema(option)?.def?.shape?.type,
  ).includes('external'))
  const feishuIdentityShape = unwrapSchema(feishuIdentity)?.def?.shape
  const externalIdentityShape = unwrapSchema(externalIdentity)?.def?.shape
  check(
    identityOptions.length === 2
      && sameStrings(schemaObjectKeys(feishuIdentity), [
        'appId', 'method', 'openId', 'state', 'type', 'value',
      ])
      && sameStrings(schemaObjectKeys(externalIdentity), [
        'appId', 'method', 'openId', 'state', 'type', 'value',
      ])
      && ['method', 'state', 'value']
        .every(key => isOptionalNever(feishuIdentityShape?.[key]))
      && ['appId', 'openId', 'state']
        .every(key => isOptionalNever(externalIdentityShape?.[key])),
    `${packageName}: ${label} human creation rejects mixed identity fields and caller state`,
  )
  const addMemberBase = {
    projectId: 'project-built-artifact',
    expectedTeamRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'built-member-idempotency-0001',
    causationId: 'built-member-causation-0001',
    reason: 'owner-project-member-add',
  }
  check(
    schemaAccepts(addMemberRequest?.codec?.schema, {
      ...addMemberBase,
      member: {
        kind: 'human',
        displayName: 'Built Feishu human',
        identity: { type: 'feishu', appId: 'cli.built:001', openId: 'ou-built_001' },
      },
    })
      && schemaAccepts(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: {
          kind: 'human',
          displayName: 'Built external human',
          identity: { type: 'external', method: 'email', value: 'built@example.invalid' },
        },
      })
      && schemaAccepts(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: { kind: 'agent', displayName: 'Built Agent' },
      }),
    `${packageName}: ${label} member carrier accepts exactly the three T05 identity variants`,
  )
  check(
    schemaRejects(addMemberRequest?.codec?.schema, {
      ...addMemberBase,
      member: {
        kind: 'human',
        displayName: 'Forged declaration state',
        identity: {
          type: 'feishu', appId: 'cli.built:001', openId: 'ou-built_001', state: 'declared',
        },
      },
    })
      && schemaRejects(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: {
          kind: 'human',
          displayName: 'Mixed identity',
          identity: {
            type: 'feishu', appId: 'cli.built:001', openId: 'ou-built_001',
            method: 'email', value: 'mixed@example.invalid',
          },
        },
      })
      && schemaRejects(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: {
          kind: 'agent', displayName: 'Forged Agent', identity: { type: 'external' },
        },
      })
      && schemaRejects(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: {
          kind: 'agent', displayName: 'Profiled Agent', agentProfileVersionId: 'profile-v1',
        },
      })
      && schemaRejects(addMemberRequest?.codec?.schema, {
        ...addMemberBase,
        member: { kind: 'agent', displayName: 'Caller-scoped Agent' },
        memberId: 'member-caller-forged',
      }),
    `${packageName}: ${label} member carrier rejects declaration, mixed, profile, and authority forgery`,
  )

  const memberStatusRequest = setProjectMemberStatus?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const memberStatusShape = unwrapSchema(memberStatusRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(memberStatusRequest?.codec?.schema), [
      'actor',
      'causationId',
      'displayName',
      'expectedMemberRevision',
      'expectedTeamRevision',
      'idempotencyKey',
      'identity',
      'memberId',
      'organizationId',
      'projectId',
      'reason',
      'status',
      'teamId',
    ]),
    `${packageName}: ${label} member lifecycle uses both Team and member compare-and-swap revisions`,
  )
  check(
    ['actor', 'displayName', 'identity', 'organizationId', 'teamId']
      .every(key => isOptionalNever(memberStatusShape?.[key])),
    `${packageName}: ${label} member lifecycle rejects caller scope and identity rewrites`,
  )
  const memberStatusBase = {
    projectId: 'project-built-artifact',
    memberId: 'member-built-artifact',
    status: 'inactive',
    expectedTeamRevision: 3,
    expectedMemberRevision: 1,
    idempotencyKey: 'built-status-idempotency-0001',
    causationId: 'built-status-causation-0001',
    reason: 'owner-project-member-status-change',
  }
  check(
    schemaAccepts(memberStatusRequest?.codec?.schema, memberStatusBase)
      && schemaRejects(memberStatusRequest?.codec?.schema, {
        ...memberStatusBase,
        identity: { type: 'external', method: 'email', value: 'rewrite@example.invalid' },
      }),
    `${packageName}: ${label} lifecycle carrier accepts status only and rejects identity rewrites`,
  )

  const responsibilityRequest = setProjectResponsibility?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const responsibilityShape = unwrapSchema(responsibilityRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(responsibilityRequest?.codec?.schema), [
      'accountableMemberId',
      'actor',
      'causationId',
      'contributorMemberIds',
      'expectedResponsibilityRevision',
      'expectedTeamRevision',
      'humanSponsorMemberId',
      'idempotencyKey',
      'organizationId',
      'projectId',
      'reason',
      'responsibilityRevision',
      'teamId',
    ]),
    `${packageName}: ${label} responsibility replaces one complete role tuple atomically`,
  )
  check(
    ['actor', 'organizationId', 'responsibilityRevision', 'teamId']
      .every(key => isOptionalNever(responsibilityShape?.[key])),
    `${packageName}: ${label} responsibility rejects caller scope and committed revision`,
  )
  const responsibilityBase = {
    projectId: 'project-built-artifact',
    accountableMemberId: 'member-built-agent',
    contributorMemberIds: ['member-built-contributor'],
    humanSponsorMemberId: 'member-built-sponsor',
    expectedTeamRevision: 3,
    expectedResponsibilityRevision: null,
    idempotencyKey: 'built-responsibility-idempotency-0001',
    causationId: 'built-responsibility-causation-0001',
    reason: 'owner-project-responsibility-set',
  }
  check(
    schemaAccepts(responsibilityRequest?.codec?.schema, responsibilityBase)
      && schemaRejects(responsibilityRequest?.codec?.schema, {
        ...responsibilityBase,
        responsibilityRevision: 1,
      }),
    `${packageName}: ${label} responsibility carrier rejects caller committed revision`,
  )

  const reviewFilter = reviewCenter?.parameters?.find(parameter => parameter?.name === 'filter')
  const reviewFilterShape = unwrapSchema(reviewFilter?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(reviewFilter?.codec?.schema), [
      'actor',
      'beforeSequence',
      'limit',
      'organizationId',
      'projectId',
      'riskLevel',
      'status',
      'teamId',
    ])
      && ['actor', 'organizationId', 'teamId']
        .every(key => isOptionalNever(reviewFilterShape?.[key])),
    `${packageName}: ${label} Review Center filter exposes five states, risk, paging, and no caller authority`,
  )
  check(
    schemaAccepts(reviewFilter?.codec?.schema, {
      projectId: 'project-built-artifact',
      status: 'stale',
      riskLevel: 'high',
      beforeSequence: 9,
      limit: 5,
    })
      && schemaRejects(reviewFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        status: 'pending',
        actor: 'caller-forged-owner',
      })
      && schemaRejects(reviewFilter?.codec?.schema, {
        projectId: 'project-built-artifact',
        status: 'disconnected',
      }),
    `${packageName}: ${label} Review Center carrier accepts stale and rejects authority or transport-state forgery`,
  )
  const reviewProjection = unionOptions(reviewCenter?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('proposalBuilder'))
    ?? reviewCenter?.result?.schema
  const reviewProjectionShape = unwrapSchema(reviewProjection)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(reviewProjection), [
      'items',
      'nextBeforeSequence',
      'projectId',
      'proposalBuilder',
    ])
      && sameStrings(schemaObjectKeys(reviewProjectionShape?.proposalBuilder), [
        'base',
        'evidenceOptions',
        'memberOptions',
        'projectId',
        'responsibilityRevision',
        'teamRevision',
      ]),
    `${packageName}: ${label} Review Center returns one-round-trip proposal context and a stable page`,
  )
  const reviewMemberOption = arrayElementSchema(
    unwrapSchema(reviewProjectionShape?.proposalBuilder)?.def?.shape?.memberOptions,
  )
  check(
    sameStrings(schemaObjectKeys(reviewMemberOption), [
      'canBeHumanSponsor',
      'displayName',
      'kind',
      'memberId',
      'requiresHumanSponsor',
      'status',
    ]),
    `${packageName}: ${label} proposal context distinguishes sponsor eligibility from sponsor requirement`,
  )
  const reviewItem = arrayElementSchema(reviewProjectionShape?.items)
  const reviewItemShape = unwrapSchema(reviewItem)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(reviewItem), [
      'allowedDecisions',
      'createdAt',
      'decisions',
      'effectiveStatus',
      'evidence',
      'originCausationId',
      'persistedState',
      'projectId',
      'proposedDiff',
      'revision',
      'risk',
      'sequence',
      'source',
      'suggestedChangeId',
      'target',
      'updatedAt',
    ]),
    `${packageName}: ${label} Review card retains source, target, diff, evidence, risk, causation, state, and history`,
  )
  check(
    sameStrings(schemaObjectKeys(reviewItemShape?.target), [
      'adapter',
      'baseResponsibilityRevision',
      'baseTeamRevision',
      'currentResponsibilityRevision',
      'currentTeamRevision',
      'kind',
      'projectId',
      'representationSchemaVersion',
    ])
      && sameStrings(schemaObjectKeys(reviewItemShape?.proposedDiff), [
        'after',
        'before',
        'changedFields',
        'digest',
        'kind',
        'schemaVersion',
      ])
      && sameStrings(schemaObjectKeys(reviewItemShape?.risk), [
        'batchPolicy',
        'effectiveLevel',
        'policyVersion',
        'proposedLevel',
        'proposedReasonCodes',
      ]),
    `${packageName}: ${label} Review card exposes immutable and current versions plus typed diff and Host risk`,
  )
  const reviewEvidence = arrayElementSchema(reviewItemShape?.evidence)
  const reviewDecision = arrayElementSchema(reviewItemShape?.decisions)
  check(
    sameStrings(schemaObjectKeys(reviewEvidence), [
      'action',
      'auditEventId',
      'kind',
      'object',
      'occurredAt',
      'summaryCode',
    ])
      && sameStrings(schemaObjectKeys(reviewDecision), [
        'actor',
        'appliedDiff',
        'appliedResponsibilityRevision',
        'appliedRiskLevel',
        'appliedRiskReasonCodes',
        'appliedTeamRevision',
        'causationId',
        'decidedAt',
        'decisionId',
        'feedback',
        'mode',
        'receipt',
        'suggestedChangeRevision',
      ]),
    `${packageName}: ${label} Review card carries immutable EvidenceRefs and append-only decision provenance`,
  )

  const proposalRequest = proposeProjectResponsibilityChange?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const proposalShape = unwrapSchema(proposalRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(proposalRequest?.codec?.schema), [
      'actor',
      'candidate',
      'causationId',
      'diff',
      'digest',
      'evidenceRefs',
      'expectedTeamRevision',
      'idempotencyKey',
      'organizationId',
      'projectId',
      'reason',
      'risk',
      'source',
      'suggestedChangeId',
      'target',
      'teamId',
    ])
      && ['actor', 'diff', 'digest', 'organizationId', 'risk', 'source',
        'suggestedChangeId', 'target', 'teamId']
        .every(key => isOptionalNever(proposalShape?.[key])),
    `${packageName}: ${label} proposal accepts semantic intent while rejecting every Host-derived envelope field`,
  )
  check(
    sameStrings(schemaObjectKeys(proposalShape?.candidate), [
      'accountableMemberId',
      'contributorMemberIds',
      'humanSponsorMemberId',
    ])
      && sameStrings(schemaObjectKeys(arrayElementSchema(proposalShape?.evidenceRefs)), [
        'auditEventId',
        'kind',
      ]),
    `${packageName}: ${label} proposal carries one complete responsibility candidate and typed audit evidence refs`,
  )
  const proposalBase = {
    projectId: 'project-built-artifact',
    candidate: {
      accountableMemberId: 'member-built-agent',
      contributorMemberIds: ['member-built-contributor'],
      humanSponsorMemberId: 'member-built-sponsor',
    },
    expectedTeamRevision: 4,
    evidenceRefs: [{ kind: 'workbench-audit-event', auditEventId: 'audit-built-evidence' }],
    idempotencyKey: 'built-proposal-idempotency-0001',
    causationId: 'built-proposal-causation-0001',
    reason: 'owner-suggested-change-propose',
  }
  check(
    schemaAccepts(proposalRequest?.codec?.schema, proposalBase)
      && schemaRejects(proposalRequest?.codec?.schema, {
        ...proposalBase,
        risk: { proposedLevel: 'low' },
      })
      && schemaRejects(proposalRequest?.codec?.schema, {
        ...proposalBase,
        source: { kind: 'owner', actorId: 'caller-forged-owner' },
      }),
    `${packageName}: ${label} proposal carrier accepts typed intent and rejects forged risk or source`,
  )
  const proposalSuccess = unionOptions(proposeProjectResponsibilityChange?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('receipt'))
  const proposalSuccessShape = unwrapSchema(proposalSuccess)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(proposalSuccess), ['ok', 'receipt', 'value'])
      && sameStrings(schemaObjectKeys(proposalSuccessShape?.value), [
        'baseTargetVersion',
        'persistedState',
        'riskLevel',
        'suggestedChangeId',
        'suggestedChangeRevision',
        'targetAdapter',
      ]),
    `${packageName}: ${label} proposal success returns a PII-free Review acknowledgement and receipt`,
  )

  const decisionRequest = decideSuggestedChange?.parameters?.find(
    parameter => parameter?.name === 'request',
  )
  const decisionOptions = unionOptions(decisionRequest?.codec?.schema)
  check(
    decisionOptions.length === 4
      && decisionOptions.every(option => sameStrings(schemaObjectKeys(option), [
        'acknowledgedRiskLevel',
        'actor',
        'candidate',
        'causationId',
        'diff',
        'expectedSuggestedChangeRevision',
        'expectedTargetVersion',
        'feedback',
        'idempotencyKey',
        'mode',
        'organizationId',
        'projectId',
        'reason',
        'risk',
        'source',
        'suggestedChangeId',
        'target',
        'teamId',
      ])),
    `${packageName}: ${label} decision is a closed four-mode discriminated carrier`,
  )
  const decisionBase = {
    projectId: 'project-built-artifact',
    suggestedChangeId: 'suggested-change-built-artifact',
    expectedSuggestedChangeRevision: 1,
    feedback: 'Built artifact reviewer feedback',
    idempotencyKey: 'built-decision-idempotency-0001',
    causationId: 'built-decision-causation-0001',
  }
  check(
    schemaAccepts(decisionRequest?.codec?.schema, {
      ...decisionBase,
      mode: 'accept',
      acknowledgedRiskLevel: 'low',
      reason: 'owner-suggested-change-accept',
    })
      && schemaAccepts(decisionRequest?.codec?.schema, {
        ...decisionBase,
        mode: 'edit-and-accept',
        acknowledgedRiskLevel: 'high',
        candidate: proposalBase.candidate,
        reason: 'owner-suggested-change-edit-accept',
      })
      && schemaAccepts(decisionRequest?.codec?.schema, {
        ...decisionBase,
        mode: 'reject',
        reason: 'owner-suggested-change-reject',
      })
      && schemaAccepts(decisionRequest?.codec?.schema, {
        ...decisionBase,
        mode: 'defer',
        reason: 'owner-suggested-change-defer',
      }),
    `${packageName}: ${label} decision carrier accepts accept, edited accept, reject, and defer`,
  )
  check(
    schemaRejects(decisionRequest?.codec?.schema, {
      ...decisionBase,
      mode: 'accept',
      reason: 'owner-suggested-change-accept',
    })
      && schemaRejects(decisionRequest?.codec?.schema, {
        ...decisionBase,
        mode: 'reject',
        acknowledgedRiskLevel: 'low',
        reason: 'owner-suggested-change-reject',
      })
      && schemaRejects(decisionRequest?.codec?.schema, {
        ...decisionBase,
        mode: 'accept',
        acknowledgedRiskLevel: 'low',
        expectedTargetVersion: 4,
        reason: 'owner-suggested-change-accept',
      }),
    `${packageName}: ${label} decision carrier requires risk acknowledgement only for acceptance and forbids target-version forgery`,
  )
  const decisionSuccess = unionOptions(decideSuggestedChange?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('receipt'))
  const decisionSuccessShape = unwrapSchema(decisionSuccess)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(decisionSuccess), ['ok', 'receipt', 'value'])
      && sameStrings(schemaObjectKeys(decisionSuccessShape?.value), [
        'appliedResponsibilityRevision',
        'appliedTeamRevision',
        'decisionMode',
        'persistedState',
        'riskLevel',
        'suggestedChangeId',
        'suggestedChangeRevision',
      ]),
    `${packageName}: ${label} decision success returns Review and applied target versions with one receipt`,
  )

  for (const [invocation, expectedValueKeys, commandLabel] of [
    [
      addProjectMember,
      ['kind', 'memberId', 'memberRevision', 'projectId', 'status', 'teamRevision'],
      'member addition',
    ],
    [
      setProjectMemberStatus,
      ['kind', 'memberId', 'memberRevision', 'projectId', 'status', 'teamRevision'],
      'member lifecycle',
    ],
    [
      setProjectResponsibility,
      ['projectId', 'responsibilityRevision', 'teamRevision'],
      'responsibility assignment',
    ],
  ]) {
    const success = unionOptions(invocation?.result?.schema)
      .find(option => schemaObjectKeys(option).includes('receipt'))
    const successShape = unwrapSchema(success)?.def?.shape
    check(
      sameStrings(schemaObjectKeys(success), ['ok', 'receipt', 'value'])
        && sameStrings(schemaObjectKeys(successShape?.value), expectedValueKeys),
      `${packageName}: ${label} ${commandLabel} returns only a PII-free acknowledgement and receipt`,
    )
  }

  const connectionShape = unwrapSchema(feishuConnectionCenter?.result?.schema)?.def?.shape
  const botRouteShape = unwrapSchema(connectionShape?.bot)?.def?.shape
  const actorSchema = unionOptions(botRouteShape?.actor)
    .find(option => schemaObjectKeys(option).includes('openId'))
  const verificationSchema = unionOptions(botRouteShape?.lastVerification)
    .find(option => schemaObjectKeys(option).includes('verificationId'))
  const verificationShape = unwrapSchema(verificationSchema)?.def?.shape
  const unavailableProbe = unionOptions(verificationShape?.resourceProbe)
    .find(option => schemaObjectKeys(option).includes('issue'))
  const unavailableProbeShape = unwrapSchema(unavailableProbe)?.def?.shape
  const issueShape = unwrapSchema(unavailableProbeShape?.issue)?.def?.shape
  check(
    (feishuConnectionCenter?.parameters?.length ?? -1) === 0
      && sameStrings(schemaObjectKeys(feishuConnectionCenter?.result?.schema), [
        'bot',
        'connectionId',
        'realm',
        'revision',
        'updatedAt',
        'user',
      ])
      && sameStrings(schemaObjectKeys(connectionShape?.bot), [
        'actor',
        'appId',
        'credential',
        'displayLabel',
        'generation',
        'kind',
        'lastVerification',
        'state',
      ])
      && sameStrings(schemaObjectKeys(connectionShape?.user), schemaObjectKeys(connectionShape?.bot)),
    `${packageName}: ${label} Connection Center is one exact Bot/User whole-value projection`,
  )
  check(
    sameStrings(schemaObjectKeys(botRouteShape?.credential), [
      'configured',
      'ref',
      'source',
      'writable',
    ])
      && sameStrings(schemaObjectKeys(actorSchema), [
        'appId',
        'connectionId',
        'kind',
        'openId',
        'realm',
        'routeGeneration',
        'tenantKey',
      ])
      && sameStrings(schemaObjectKeys(verificationSchema), [
        'checkedAt',
        'identity',
        'resourceProbe',
        'result',
        'routeGeneration',
        'scopeInspection',
        'sequence',
        'verificationId',
      ]),
    `${packageName}: ${label} Connection Center exposes references, identity binding, and dated verification without credential values`,
  )
  check(
    sameStrings(schemaObjectKeys(verificationShape?.identity), ['issue', 'state'])
      && sameStrings(schemaObjectKeys(verificationShape?.scopeInspection), [
        'issue',
        'scopes',
        'state',
      ])
      && sameStrings(schemaObjectKeys(unavailableProbeShape?.issue), [
        'code',
        'grantPlane',
        'missingScopes',
        'recovery',
        'retryAt',
      ]),
    `${packageName}: ${label} Feishu failures use only the closed redacted issue schema`,
  )
  check(
    sameStrings(schemaLiteralTreeValues(issueShape?.code), [
      'credential-unconfigured',
      'credential-invalid',
      'credential-expired',
      'user-authorization-revoked',
      'app-disabled',
      'missing-app-scope',
      'missing-user-grant',
      'outside-app-data-range',
      'resource-access-unavailable',
      'resource-not-found',
      'unsupported-actor',
      'identity-continuity-mismatch',
      'tenant-mismatch',
      'rate-limited',
      'provider-unavailable',
      'provider-response-invalid',
      'unknown-provider-error',
    ])
      && sameStrings(schemaLiteralTreeValues(issueShape?.recovery), [
        'configure-credential',
        'rotate-credential',
        'enable-app',
        'grant-app-scope',
        'reauthorize-user',
        'expand-app-data-range',
        'share-resource',
        'check-resource-id',
        'reset-identity-binding',
        'retry-later',
        'inspect-provider',
      ])
      && sameStrings(
        unionOptions(verificationShape?.resourceProbe).flatMap(option => {
          const shape = unwrapSchema(option)?.def?.shape
          return schemaLiteralTreeValues(shape?.state)
        }),
        ['not-tested', 'accessible', 'unavailable'],
      ),
    `${packageName}: ${label} Feishu issue, recovery, and resource-state vocabularies are exact closed T07 unions`,
  )

  const configureFeishuRequest = configureFeishuIdentityRoute?.parameters
    ?.find(parameter => parameter?.name === 'request')
  const configureFeishuOptions = unionOptions(configureFeishuRequest?.codec?.schema)
  const feishuCommandBase = {
    kind: 'bot',
    expectedConnectionRevision: 0,
    expectedRouteGeneration: null,
    idempotencyKey: 'built-feishu-idempotency-0001',
    causationId: 'built-feishu-causation-0001',
  }
  check(
    configureFeishuOptions.length === 3
      && configureFeishuOptions.every(option => sameStrings(schemaObjectKeys(option), [
        'appId',
        'causationId',
        'credentialRef',
        'expectedConnectionRevision',
        'expectedRouteGeneration',
        'idempotencyKey',
        'kind',
        'mode',
        'reason',
      ])),
    `${packageName}: ${label} Feishu route configuration is a closed set/reset/disable carrier with reference metadata only`,
  )
  check(
    schemaAccepts(configureFeishuRequest?.codec?.schema, {
      ...feishuCommandBase,
      mode: 'set',
      appId: 'cli_built_feishu',
      credentialRef: 'FEISHU_BUILT_BOT_SECRET',
      reason: 'owner-feishu-route-configure',
    })
      && schemaAccepts(configureFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        mode: 'reset',
        reason: 'owner-feishu-route-reset',
      })
      && schemaAccepts(configureFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        mode: 'disable',
        reason: 'owner-feishu-route-disable',
      })
      && schemaRejects(configureFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        mode: 'reset',
        appId: 'cli_forbidden_reset_rebind',
        reason: 'owner-feishu-route-reset',
      })
      && schemaRejects(configureFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        mode: 'fallback',
        appId: 'cli_forbidden_fallback',
        credentialRef: 'FEISHU_FALLBACK_SECRET',
        reason: 'owner-feishu-route-configure',
      }),
    `${packageName}: ${label} Feishu route schema accepts explicit modes and has no actor-fallback mode`,
  )
  const configureFeishuSuccess = unionOptions(configureFeishuIdentityRoute?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('receipt'))
  const configureFeishuSuccessShape = unwrapSchema(configureFeishuSuccess)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(configureFeishuSuccess), ['ok', 'receipt', 'value'])
      && sameStrings(schemaObjectKeys(configureFeishuSuccessShape?.value), [
        'connectionId',
        'connectionRevision',
        'kind',
        'routeGeneration',
        'state',
      ]),
    `${packageName}: ${label} Feishu configuration returns only a redacted acknowledgement and receipt`,
  )

  const verifyFeishuRequest = verifyFeishuIdentityRoute?.parameters
    ?.find(parameter => parameter?.name === 'request')
  const verifyFeishuRequestShape = unwrapSchema(verifyFeishuRequest?.codec?.schema)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(verifyFeishuRequest?.codec?.schema), [
      'causationId',
      'expectedConnectionRevision',
      'expectedRouteGeneration',
      'idempotencyKey',
      'kind',
      'reason',
      'resourceProbe',
    ])
      && sameStrings(schemaObjectKeys(verifyFeishuRequestShape?.resourceProbe), [
        'kind',
        'resourceId',
      ]),
    `${packageName}: ${label} Feishu verification selects one route and optional read-only Task-list probe`,
  )
  check(
    schemaAccepts(verifyFeishuRequest?.codec?.schema, {
      ...feishuCommandBase,
      resourceProbe: { kind: 'task-list', resourceId: 'tasklist_built_feishu' },
      reason: 'owner-feishu-route-verify',
    })
      && schemaRejects(verifyFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        kind: 'fallback',
        resourceProbe: { kind: 'task-list', resourceId: 'tasklist_built_feishu' },
        reason: 'owner-feishu-route-verify',
      })
      && schemaRejects(verifyFeishuRequest?.codec?.schema, {
        ...feishuCommandBase,
        resourceProbe: { kind: 'calendar', resourceId: 'calendar_forbidden' },
        reason: 'owner-feishu-route-verify',
      }),
    `${packageName}: ${label} Feishu verification rejects alternate actors and non-T07 resource probes`,
  )
  const verifyFeishuSuccess = unionOptions(verifyFeishuIdentityRoute?.result?.schema)
    .find(option => schemaObjectKeys(option).includes('receipt'))
  const verifyFeishuSuccessShape = unwrapSchema(verifyFeishuSuccess)?.def?.shape
  check(
    sameStrings(schemaObjectKeys(verifyFeishuSuccess), ['ok', 'receipt', 'value'])
      && sameStrings(schemaObjectKeys(verifyFeishuSuccessShape?.value), [
        'connectionId',
        'connectionRevision',
        'kind',
        'result',
        'routeGeneration',
        'verificationSequence',
      ]),
    `${packageName}: ${label} Feishu verification returns only status/version facts and a receipt`,
  )

  const projectQuery = project?.parameters?.find(parameter => parameter?.name === 'query')
  check(
    sameStrings(schemaObjectKeys(projectQuery?.codec?.schema), ['projectId']),
    `${packageName}: ${label} project lookup accepts only a scoped Project identity`,
  )
  const projectResult = unwrapSchema(project?.result?.schema)
  const projectDetail = Array.isArray(projectResult?.def?.options)
    ? projectResult.def.options.find(option => schemaObjectKeys(option).includes('templateSnapshot'))
    : projectResult
  check(
    sameStrings(schemaObjectKeys(projectDetail), [
      'primaryGoal',
      'project',
      'supportingGoals',
      'templateSnapshot',
    ]),
    `${packageName}: ${label} project lookup reopens the complete durable T04 projection`,
  )
}

function unwrapSchema(value) {
  let current = value
  const seen = new Set()
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (current.def?.type !== 'readonly'
      && current.def?.type !== 'optional'
      && current.def?.type !== 'nullable') break
    current = current.def.innerType
  }
  return current
}

function schemaObjectKeys(value) {
  const unwrapped = unwrapSchema(value)
  if (unwrapped?.def?.type === 'intersection') {
    return [...new Set([
      ...schemaObjectKeys(unwrapped.def.left),
      ...schemaObjectKeys(unwrapped.def.right),
    ])].sort()
  }
  const shape = unwrapped?.def?.shape
  return shape !== null && typeof shape === 'object' && !Array.isArray(shape)
    ? Object.keys(shape).sort()
    : []
}

function arrayElementSchema(value) {
  const unwrapped = unwrapSchema(value)
  if (unwrapped?.def?.type !== 'array') return undefined
  return unwrapped.def.element
}

function unionOptions(value) {
  const options = unwrapSchema(value)?.def?.options
  return Array.isArray(options) ? options : []
}

function schemaLiteralValues(value) {
  const values = unwrapSchema(value)?.def?.values
  return Array.isArray(values) ? values : []
}

function schemaLiteralTreeValues(value) {
  const unwrapped = unwrapSchema(value)
  const direct = Array.isArray(unwrapped?.def?.values) ? unwrapped.def.values : []
  const nested = Array.isArray(unwrapped?.def?.options)
    ? unwrapped.def.options.flatMap(option => schemaLiteralTreeValues(option))
    : []
  return [...new Set([...direct, ...nested])]
}

function isOptionalNever(value) {
  return value?.def?.type === 'optional' && unwrapSchema(value)?.def?.type === 'never'
}

function schemaAccepts(schema, value) {
  try {
    return schema?.safeParse(value)?.success === true
  } catch {
    return false
  }
}

function schemaRejects(schema, value) {
  try {
    return schema?.safeParse(value)?.success === false
  } catch {
    return false
  }
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function readManifest(packageDir) {
  const path = resolve(packageDir, 'package.json')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object')
    return value
  } catch (error) {
    fail(`${path}: cannot read manifest: ${errorMessage(error)}`)
    return undefined
  }
}

function defaultExportTarget(entry) {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object' && typeof entry.default === 'string') return entry.default
  return undefined
}

function checkArtifact(packageDir, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('./')) {
    fail(`${label} is not a package-relative target`)
    return
  }
  check(existsSync(resolve(packageDir, relativePath)), `${label} exists at ${relativePath}`)
}

function readArtifact(packageDir, relativePath, label) {
  const path = resolve(packageDir, relativePath)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    fail(`${label} cannot be read at ${relativePath}: ${errorMessage(error)}`)
    return undefined
  }
}

async function importArtifact(packageDir, relativePath, label) {
  const path = resolve(packageDir, relativePath)
  if (!existsSync(path)) {
    fail(`${label} is missing at ${relativePath}`)
    return undefined
  }
  try {
    return await import(`${pathToFileURL(path).href}?verify-built=${Date.now()}-${Math.random()}`)
  } catch (error) {
    fail(`${label} failed a plain-Node import: ${errorMessage(error)}`)
    return undefined
  }
}

function verifyDeclaredFiles(packageDir, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(`${manifest.name}: files must explicitly enumerate built deliverables`)
    return
  }
  for (const pattern of manifest.files) {
    if (typeof pattern !== 'string') {
      fail(`${manifest.name}: files contains a non-string entry`)
      continue
    }
    const matches = globSync(pattern, { cwd: packageDir, nodir: true })
    check(matches.length > 0, `${manifest.name}: files pattern ${pattern} matches a built artifact`)
  }
  check(
    !manifest.files.some(pattern => typeof pattern === 'string' && pattern.endsWith('.map')),
    `${manifest.name}: files excludes source and declaration maps`,
  )
}

function verifyNoSourceEntries(manifest) {
  const entries = [manifest.main, manifest.types, ...(manifest.files ?? []), ...allExportTargets(manifest.exports)]
  for (const entry of entries) {
    if (typeof entry !== 'string') continue
    const normalized = entry.replaceAll('\\', '/')
    check(!/(^|\/)src\//u.test(normalized), `${manifest.name}: published entry ${entry} does not point at src/`)
    check(!normalized.startsWith('file:'), `${manifest.name}: published entry ${entry} is not a file URL`)
    check(!normalized.endsWith('.ts') || normalized.endsWith('.d.ts'), `${manifest.name}: published entry ${entry} is JavaScript or a declaration`)
  }
}

function verifyRuntimeImports(packageDir, manifest) {
  const allowedPackages = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  const jsFiles = new Set()
  for (const pattern of manifest.files ?? []) {
    if (typeof pattern !== 'string') continue
    for (const relativePath of globSync(pattern, { cwd: packageDir, nodir: true })) {
      if (extname(relativePath) === '.js') jsFiles.add(relativePath)
    }
  }
  for (const relativePath of [...jsFiles].sort()) {
    const absolutePath = resolve(packageDir, relativePath)
    const source = readFileSync(absolutePath, 'utf8')
    for (const specifier of runtimeSpecifiers(source)) {
      if (isBuiltin(specifier)) continue
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        check(!specifier.startsWith('/'), `${manifest.name}: ${relativePath} has no absolute runtime import ${specifier}`)
        check(!sourceOnlySpecifier(specifier), `${manifest.name}: ${relativePath} has no source-only runtime import ${specifier}`)
        if (specifier.startsWith('.')) {
          check(existsSync(resolve(dirname(absolutePath), specifier)), `${manifest.name}: ${relativePath} runtime import ${specifier} exists`)
        }
        continue
      }
      if (specifier.startsWith('file:')) {
        fail(`${manifest.name}: ${relativePath} has source-local runtime import ${specifier}`)
        continue
      }
      const dependency = packageNameFromSpecifier(specifier)
      check(allowedPackages.has(dependency), `${manifest.name}: ${relativePath} declares runtime package ${dependency}`)
    }
  }
}

function runtimeSpecifiers(source) {
  const values = new Set()
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.add(match[1])
  }
  return values
}

function sourceOnlySpecifier(specifier) {
  const normalized = specifier.replaceAll('\\', '/')
  return /(^|\/)src\//u.test(normalized)
    || /(^|\/)lib\/types\//u.test(normalized)
    || (/\.tsx?(?:$|[?#])/u.test(normalized) && !/\.d\.ts(?:$|[?#])/u.test(normalized))
}

function packageNameFromSpecifier(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/', 1)[0]
  return specifier.split('/').slice(0, 2).join('/')
}

function isBuiltin(specifier) {
  const plain = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return builtinModules.includes(plain) || builtinModules.includes(`node:${plain}`)
}

function allExportTargets(exportsField) {
  const targets = []
  visit(exportsField)
  return targets

  function visit(value) {
    if (typeof value === 'string') {
      targets.push(value)
      return
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    for (const child of Object.values(value)) visit(child)
  }
}

function check(condition, label) {
  if (condition) passed.push(label)
  else failures.push(label)
}

function fail(message) {
  failures.push(message)
}

function errorMessage(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}
