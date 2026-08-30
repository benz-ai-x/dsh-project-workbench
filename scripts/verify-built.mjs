#!/usr/bin/env node

/**
 * Verify the executable artifacts that T04 actually loads.
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
  }

  const browserContract = await importArtifact(hostDir, './lib/client.js', `${packageName}: browser-safe contract`)
  if (browserContract !== undefined) {
    check(!('default' in browserContract), `${packageName}/client has no accidental default export`)
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
    if (typeof auth.default !== 'function' || auth.default !== auth.OwnerAuthService) throw new Error('invalid Owner auth export')
    if ('default' in contract) throw new Error('browser-safe contract has an accidental default export')
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
    'auditIntegrity',
    'createProject',
    'project',
    'projectStart',
    'setStatus',
    'snapshot',
  ]
  check(
    sameStrings(methods, expectedMethods),
    `${packageName}: ${label} Typert face contains exactly the seven T04 Remote methods`,
  )
  for (const invocation of invocations) {
    check(invocation?.namespace === 'workbench', `${packageName}: ${label} ${String(invocation?.method)} uses workbench namespace`)
    check(invocation?.service === 'workbench', `${packageName}: ${label} ${String(invocation?.method)} uses workbench service`)
  }
  const activity = invocations.find(invocation => invocation?.method === 'activity')
  const auditIntegrity = invocations.find(invocation => invocation?.method === 'auditIntegrity')
  const createProject = invocations.find(invocation => invocation?.method === 'createProject')
  const project = invocations.find(invocation => invocation?.method === 'project')
  const projectStart = invocations.find(invocation => invocation?.method === 'projectStart')
  const setStatus = invocations.find(invocation => invocation?.method === 'setStatus')
  const snapshot = invocations.find(invocation => invocation?.method === 'snapshot')
  for (const invocation of [
    activity,
    auditIntegrity,
    createProject,
    project,
    projectStart,
    setStatus,
    snapshot,
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
  const shape = unwrapSchema(value)?.def?.shape
  return shape !== null && typeof shape === 'object' && !Array.isArray(shape)
    ? Object.keys(shape).sort()
    : []
}

function arrayElementSchema(value) {
  const unwrapped = unwrapSchema(value)
  if (unwrapped?.def?.type !== 'array') return undefined
  return unwrapped.def.element
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
