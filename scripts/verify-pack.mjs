#!/usr/bin/env node

/**
 * Create and inspect the real T11 npm archives without touching publication.
 *
 * Archives and extraction roots live under one mkdtemp-owned directory and
 * are removed in `finally`.  Publication readiness is kept separate from
 * artifact correctness: this source-linked workspace deliberately contains
 * private packages and therefore cannot yet prove a registry-only install.
 */

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const PACK_TIMEOUT_MS = 60_000
const ARCHIVE_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 45_000
const PROCESS_MAX_BUFFER = 4 * 1024 * 1024
// Node 22's loadable experimental SQLite builtin is absent from builtinModules;
// the workspace engine floor already guarantees this one closed module exists.
const engineSupportedBuiltins = new Set(['node:sqlite'])
const packageSpecs = [
  {
    role: 'Host',
    directory: 'packages/workbench-host',
    name: '@benz-ai-x/dsh-project-workbench',
    requiredExports: [
      '.',
      './auth',
      './client',
      './typert',
      './remote',
      './recovery',
      './package.json',
    ],
    requiredFiles: [
      'lib/index.js',
      'lib/client.js',
      'lib/owner-auth-service.js',
      'lib/recovery.js',
      'lib/recover-cli.js',
      'lib/types/index.d.ts',
      'lib/types/client.d.ts',
      'lib/types/feishu-calendar-federation.d.ts',
      'lib/types/feishu-connection-adapter.d.ts',
      'lib/types/feishu-task-federation.d.ts',
      'lib/types/feishu-task-workflow.d.ts',
      'lib/types/owner-auth-service.d.ts',
      'lib/types/recovery.d.ts',
      'lib/typert.host.js',
      'lib/typert.host.d.ts',
      'lib/typert.remote-client.js',
      'lib/typert.remote-client.d.ts',
    ],
    expectedDeclarations: [
      'lib/typert.host.d.ts',
      'lib/typert.remote-client.d.ts',
      'lib/types/audit.d.ts',
      'lib/types/authorization.d.ts',
      'lib/types/client.d.ts',
      'lib/types/feishu-calendar-federation.d.ts',
      'lib/types/feishu-connection-adapter.d.ts',
      'lib/types/feishu-task-federation.d.ts',
      'lib/types/feishu-task-workflow.d.ts',
      'lib/types/http-bridge.d.ts',
      'lib/types/index.d.ts',
      'lib/types/owner-access.d.ts',
      'lib/types/owner-auth-service.d.ts',
      'lib/types/owner-credential-store.d.ts',
      'lib/types/password.d.ts',
      'lib/types/project-template.d.ts',
      'lib/types/recover-cli.d.ts',
      'lib/types/recovery.d.ts',
      'lib/types/repository.d.ts',
      'lib/types/scenario.d.ts',
      'lib/types/sqlite-repository.d.ts',
    ],
  },
  {
    role: 'Client',
    directory: 'packages/workbench-client',
    name: '@benz-ai-x/dsh-project-workbench-client',
    requiredExports: ['.', './client', './package.json'],
    requiredFiles: [
      'lib/index.js',
      'lib/client.js',
      'lib/types/client/ProjectDeliverablesPanel.d.ts',
      'lib/types/client/ProjectMilestonesPanel.d.ts',
      'lib/types/client/project-deliverables-controller.d.ts',
      'lib/types/client/ProjectTaskWorkflowPanel.d.ts',
      'lib/types/index.d.ts',
    ],
    expectedDeclarations: [
      'lib/types/client/ActivityPanel.d.ts',
      'lib/types/client/FeishuConnectionPanel.d.ts',
      'lib/types/client/OwnerPage.d.ts',
      'lib/types/client/ProjectDeliverablesPanel.d.ts',
      'lib/types/client/ProjectMilestonesPanel.d.ts',
      'lib/types/client/ProjectTeamPanel.d.ts',
      'lib/types/client/ProjectTaskWorkflowPanel.d.ts',
      'lib/types/client/ProjectTasksPanel.d.ts',
      'lib/types/client/ProjectsPanel.d.ts',
      'lib/types/client/ReviewCenterPanel.d.ts',
      'lib/types/client/WorkbenchStatusPage.d.ts',
      'lib/types/client/activity-controller.d.ts',
      'lib/types/client/auth-http.d.ts',
      'lib/types/client/controller.d.ts',
      'lib/types/client/deliverable-presentation.d.ts',
      'lib/types/client/feishu-connection-controller.d.ts',
      'lib/types/client/index.d.ts',
      'lib/types/client/locales.d.ts',
      'lib/types/client/milestone-controller.d.ts',
      'lib/types/client/mount.d.ts',
      'lib/types/client/owner-controller.d.ts',
      'lib/types/client/project-controller.d.ts',
      'lib/types/client/project-deliverables-controller.d.ts',
      'lib/types/client/project-team-controller.d.ts',
      'lib/types/client/review-controller.d.ts',
      'lib/types/client/style-lifecycle.d.ts',
      'lib/types/client/task-controller.d.ts',
      'lib/types/index.d.ts',
    ],
  },
  {
    role: 'Bundle',
    directory: 'packages/workbench-bundle',
    name: '@benz-ai-x/dsh-project-workbench-bundle',
    requiredExports: ['./cordis.patch.yml', './package.json'],
    requiredFiles: ['cordis.patch.yml'],
  },
]

const failures = []
const warnings = []
const passed = []
const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-project-workbench-pack-'))
const archiveDir = join(tempRoot, 'archives')
const extracted = new Map()

try {
  for (const spec of packageSpecs) {
    try {
      packAndInspect(spec)
    } catch (error) {
      fail(`${spec.role}: verification stopped unexpectedly: ${errorMessage(error)}`)
    }
  }
  try {
    verifyWorkspaceClosure()
  } catch (error) {
    fail(`workspace closure verification stopped unexpectedly: ${errorMessage(error)}`)
  }
  try {
    verifyCleanConsumerInstall()
  } catch (error) {
    fail(`clean consumer verification stopped unexpectedly: ${errorMessage(error)}`)
  }
} finally {
  // tempRoot was returned directly by mkdtemp with this task-specific prefix.
  if (basename(tempRoot).startsWith('dsh-project-workbench-pack-')) {
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch (error) {
      failures.push(`could not clean temporary pack directory ${tempRoot}: ${errorMessage(error)}`)
    }
  } else {
    failures.push(`refused to clean unexpected temporary path ${tempRoot}`)
  }
}

for (const warning of warnings) console.warn(`WARN ${warning}`)
if (failures.length > 0) {
  console.error('verify-pack: packed artifact failures:')
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exitCode = 1
} else {
  console.log(`verify-pack: ${packageSpecs.length} real archive(s), ${passed.length} check(s) passed.`)
  console.log('verify-pack: registry publication is not claimed; see WARN lines for the deliberate source-linked boundary.')
}

function packAndInspect(spec) {
  const packageDir = resolve(root, spec.directory)
  const sourceManifest = readJson(resolve(packageDir, 'package.json'), `${spec.role} source manifest`)
  if (sourceManifest === undefined) return
  check(sourceManifest.name === spec.name, `${spec.role}: source manifest name is ${spec.name}`)

  const before = new Set(existsSync(archiveDir) ? readdirSync(archiveDir) : [])
  const packed = spawnSync(
    'pnpm',
    ['--dir', packageDir, 'pack', '--pack-destination', archiveDir],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PACK_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
    },
  )
  if (packed.error !== undefined || packed.status !== 0) {
    fail(`${spec.role}: pnpm pack failed${formatProcessFailure(packed)}`)
    return
  }
  const candidates = readdirSync(archiveDir)
    .filter(file => file.endsWith('.tgz') && !before.has(file))
    .map(file => resolve(archiveDir, file))
  if (candidates.length !== 1) {
    fail(`${spec.role}: pnpm pack created ${candidates.length} new .tgz files (expected exactly one)`)
    return
  }
  const archive = candidates[0]
  check(statSync(archive).size > 0, `${spec.role}: real archive is non-empty`)

  const listed = run('tar', ['-tzf', archive], root, `${spec.role}: list archive`)
  if (listed === undefined) return
  const entries = listed.split(/\r?\n/u).filter(Boolean)
  const unsafeEntries = entries.filter(entry => {
    const normalized = entry.replaceAll('\\', '/')
    return !normalized.startsWith('package/')
      || normalized.split('/').includes('..')
      || normalized.startsWith('/')
  })
  if (unsafeEntries.length > 0) {
    fail(`${spec.role}: archive contains unsafe paths: ${unsafeEntries.join(', ')}`)
    return
  }
  check(true, `${spec.role}: every archive entry stays below package/ without traversal`)
  check(!entries.some(entry => entry.endsWith('.map')), `${spec.role}: archive excludes source/declaration maps`)
  check(!entries.some(entry => entry.startsWith('package/src/')), `${spec.role}: archive excludes source files`)
  check(!entries.some(entry => /(?:^|\/)tests?\//u.test(entry)), `${spec.role}: archive excludes tests`)

  const extractionRoot = resolve(tempRoot, `extract-${spec.role.toLowerCase()}`)
  const extraction = run('tar', ['-xzf', archive, '-C', extractionRoot, '--no-same-owner'], root, `${spec.role}: extract archive`, true)
  if (extraction === undefined) return
  const packedDir = resolve(extractionRoot, 'package')
  const manifest = readJson(resolve(packedDir, 'package.json'), `${spec.role} packed manifest`)
  if (manifest === undefined) return
  extracted.set(spec.name, { archive, manifest, packedDir, sourceManifest })

  check(manifest.name === spec.name, `${spec.role}: packed manifest keeps its name`)
  check(manifest.version === sourceManifest.version, `${spec.role}: packed manifest keeps its version`)
  check(manifest.type === 'module', `${spec.role}: packed manifest remains ESM`)
  for (const subpath of spec.requiredExports) {
    check(manifest.exports?.[subpath] !== undefined, `${spec.role}: packed manifest exports ${subpath}`)
  }
  for (const file of spec.requiredFiles) {
    check(existsSync(resolve(packedDir, file)), `${spec.role}: archive contains ${file}`)
  }
  verifyPackedDeclarationSet(spec, packedDir)
  verifyExportTargets(spec, packedDir, manifest)
  verifyRuntimeDependencySpecs(spec, manifest)
  verifyPackedRuntimeImports(spec, packedDir, manifest)
  reportPublicationBoundary(spec, manifest)

  if (spec.role === 'Host') {
    check(manifest.main === 'lib/index.js', 'Host: packed main is lib/index.js')
    check(manifest.types === 'lib/types/index.d.ts', 'Host: packed types are lib/types/index.d.ts')
    check(manifest.bin?.['dsh-workbench'] === './lib/recover-cli.js', 'Host: packed dsh-workbench bin targets built JavaScript')
    verifyPackedFeishuContract(packedDir)
    const packedCli = resolve(packedDir, 'lib/recover-cli.js')
    if (existsSync(packedCli)) {
      check(readFileSync(packedCli, 'utf8').startsWith('#!/usr/bin/env node'), 'Host: packed recovery CLI preserves its shebang')
      if (process.platform !== 'win32') {
        check((statSync(packedCli).mode & 0o111) !== 0, 'Host: packed recovery CLI is executable')
      }
    }
  } else if (spec.role === 'Client') {
    check(manifest.main === 'lib/index.js', 'Client: packed main is lib/index.js')
    check(manifest.types === 'lib/types/index.d.ts', 'Client: packed types are lib/types/index.d.ts')
    check(manifest.dsh?.client?.platform === 'web', 'Client: packed manifest declares dsh.client web metadata')
    verifyPackedClientRegistration(spec, packedDir, manifest)
  } else if (spec.role === 'Bundle') {
    check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'Bundle: packed manifest activates cordis.patch.yml')
  }
}

function verifyWorkspaceClosure() {
  const host = extracted.get('@benz-ai-x/dsh-project-workbench')
  const client = extracted.get('@benz-ai-x/dsh-project-workbench-client')
  const bundle = extracted.get('@benz-ai-x/dsh-project-workbench-bundle')
  if (host === undefined || client === undefined || bundle === undefined) return

  const version = host.manifest.version
  check(client.manifest.peerDependencies?.[host.manifest.name] === version, 'Client: packed peer closes on the exact Host version')
  check(bundle.manifest.dependencies?.[host.manifest.name] === version, 'Bundle: pnpm pack rewrites Host workspace dependency to its exact version')
  check(bundle.manifest.dependencies?.[client.manifest.name] === client.manifest.version, 'Bundle: pnpm pack rewrites Client workspace dependency to its exact version')

  const privatePackages = [host, client, bundle]
    .filter(item => item.manifest.private === true)
    .map(item => item.manifest.name)
  if (privatePackages.length > 0) {
    warnings.push(`registry-only installation is intentionally unproven because these packed packages are private: ${privatePackages.join(', ')}`)
  }
  if (client.manifest.peerDependencies?.[host.manifest.name] !== undefined && host.manifest.private === true) {
    warnings.push(`${client.manifest.name} is not independently publishable while its required Host peer ${host.manifest.name} remains private`)
  }
  warnings.push('the audited DSH build dependencies are local source links in the workspace; archive shape and runtime declarations pass, but a clean registry-only install is deferred')
}

function verifyCleanConsumerInstall() {
  const hostName = '@benz-ai-x/dsh-project-workbench'
  const clientName = '@benz-ai-x/dsh-project-workbench-client'
  const bundleName = '@benz-ai-x/dsh-project-workbench-bundle'
  const host = extracted.get(hostName)
  const client = extracted.get(clientName)
  const bundle = extracted.get(bundleName)
  if (host === undefined || client === undefined || bundle === undefined) {
    fail('clean consumer: all three archives must pass inspection before installation')
    return
  }

  const baseline = resolveAuditedBaseline()
  if (baseline === undefined) return
  const baselinePackages = {
    '@deepseek-ai/cordis': 'vendor/cordis',
    '@deepseek-ai/cordis-plugin-group': 'vendor/group',
    '@deepseek-ai/cordis-plugin-hmr': 'vendor/hmr',
    '@deepseek-ai/cordis-plugin-include': 'vendor/include',
    '@deepseek-ai/cordis-plugin-loader': 'vendor/loader',
    '@deepseek-ai/dsh-api-remotes': 'packages/api/remotes',
    '@deepseek-ai/dsh-app-boot': 'packages/boot/app-boot',
    '@deepseek-ai/dsh-atomic-write': 'packages/util/atomic-write',
    '@deepseek-ai/dsh-client-connection': 'packages/client/connection',
    '@deepseek-ai/dsh-credentials': 'packages/credentials/credentials',
    '@deepseek-ai/dsh-credentials-local': 'packages/credentials/credentials-local',
    '@deepseek-ai/dsh-client-locale': 'packages/client/locale',
    '@deepseek-ai/dsh-client-ui-layout': 'packages/client/ui-layout',
    '@deepseek-ai/dsh-client-ui-primitives': 'packages/client/ui-primitives',
    '@deepseek-ai/dsh-client-ui-renderer': 'packages/client/ui-renderer',
    '@deepseek-ai/dsh-client-ui-slots': 'packages/client/ui-slots',
    '@deepseek-ai/dsh-home-paths': 'packages/util/home-paths',
    '@deepseek-ai/dsh-host-webserver': 'packages/host/webserver',
    '@deepseek-ai/dsh-invariants': 'packages/runtime-diagnostics/invariants',
    '@deepseek-ai/dsh-launch-environment': 'packages/util/launch-environment',
    '@deepseek-ai/dsh-system-prompt': 'packages/core/system-prompt',
    '@deepseek-ai/dsh-typert-protocol': 'packages/typert/protocol',
    '@deepseek-ai/schemastery': 'vendor/schemastery',
  }
  const linkedDependencies = {}
  for (const [name, relativePath] of Object.entries(baselinePackages)) {
    const directory = resolve(baseline, relativePath)
    const manifest = readJson(resolve(directory, 'package.json'), `clean consumer baseline ${name}`)
    if (manifest === undefined) return
    check(manifest.name === name, `clean consumer: audited link ${name} resolves to its matching package`)
    linkedDependencies[name] = `link:${directory}`
  }

  const reactVersion = installedPackageVersion('react')
  const zodVersion = installedPackageVersion('zod')
  if (reactVersion === undefined || zodVersion === undefined) return

  const consumerRoot = resolve(tempRoot, 'clean-consumer')
  mkdirSync(consumerRoot, { recursive: true })
  const archiveDependencies = {
    [hostName]: `file:${host.archive}`,
    [clientName]: `file:${client.archive}`,
    [bundleName]: `file:${bundle.archive}`,
  }
  const consumerManifest = {
    name: 'dsh-project-workbench-packed-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: 'pnpm@11.7.0',
    dependencies: {
      ...archiveDependencies,
      ...linkedDependencies,
      react: reactVersion,
      zod: zodVersion,
    },
  }
  writeFileSync(resolve(consumerRoot, 'package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`)
  writeFileSync(resolve(consumerRoot, 'pnpm-workspace.yaml'), [
    'packages:',
    "  - '.'",
    'overrides:',
    `  ${JSON.stringify(hostName)}: ${JSON.stringify(archiveDependencies[hostName])}`,
    `  ${JSON.stringify(clientName)}: ${JSON.stringify(archiveDependencies[clientName])}`,
    `  ${JSON.stringify('@deepseek-ai/schemastery')}: ${JSON.stringify(linkedDependencies['@deepseek-ai/schemastery'])}`,
    'allowBuilds:',
    '  argon2: true',
    '',
  ].join('\n'))

  const install = spawnSync(
    'pnpm',
    ['install', '--offline', '--no-frozen-lockfile', '--reporter=append-only'],
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
    },
  )
  if (install.error !== undefined || install.status !== 0) {
    fail(`clean consumer: ordinary pnpm install --offline failed${formatProcessFailure(install)}`)
    return
  }
  check(existsSync(resolve(consumerRoot, 'pnpm-lock.yaml')), 'clean consumer: offline pnpm install wrote an isolated lockfile')
  check(existsSync(resolve(consumerRoot, 'node_modules')), 'clean consumer: offline pnpm install materialized node_modules')

  const packedBin = resolve(
    consumerRoot,
    'node_modules/.bin',
    process.platform === 'win32' ? 'dsh-workbench.cmd' : 'dsh-workbench',
  )
  check(existsSync(packedBin), 'clean consumer: package manager installed the dsh-workbench bin')
  if (existsSync(packedBin)) {
    const help = spawnSync(packedBin, ['--help'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
    })
    if (help.error !== undefined || help.status !== 0) {
      fail(`clean consumer: packed dsh-workbench --help failed${formatProcessFailure(help)}`)
    } else {
      check(
        help.stdout.trim() === 'Usage: dsh-workbench owner recover [--dsh-home PATH] [--stdin]',
        'clean consumer: packed recovery CLI executes through its installed bin',
      )
      check(help.stderr.trim() === '', 'clean consumer: packed recovery CLI help emits no secret-channel noise')
    }
  }

  const configPath = resolve(consumerRoot, 'workbench.cordis.yml')
  const databasePath = resolve(consumerRoot, 'runtime/workbench.sqlite')
  const authFixturePath = resolve(consumerRoot, 'packed-auth-fixture.mjs')
  const credentialsFixturePath = resolve(consumerRoot, 'packed-credentials-fixture.mjs')
  writeFileSync(authFixturePath, `
import { Service } from '@deepseek-ai/cordis'
import {
  V1OwnerAuthorizationPolicy,
  WorkbenchAuthorizationContext,
  ownerPrincipal,
} from ${JSON.stringify(hostName)}

export default class PackedAuthFixture extends Service {
  static inject = []

  constructor(ctx) {
    super(ctx, 'workbenchAuth')
    this.authorization = new WorkbenchAuthorizationContext(
      new V1OwnerAuthorizationPolicy(async () => true),
    )
    this.principal = ownerPrincipal({
      kind: 'owner',
      ownerId: 'owner-packed-fixture',
      organizationId: 'organization-packed-fixture',
      teamId: 'team-packed-fixture',
      sessionId: 'session-packed-fixture',
      credentialVersion: 1,
    })
  }

  run(operation) {
    return this.authorization.runAs(this.principal, operation)
  }
}
`)
  writeFileSync(credentialsFixturePath, `
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'

export default class PackedCredentialsFixture extends CredentialProvider {
  static inject = []

  constructor(ctx) {
    super(ctx)
    this.describeRefs = []
    this.resolveRefs = []
  }

  async describe(ref) {
    this.describeRefs.push(String(ref))
    return { configured: false, writable: false }
  }

  async resolve(ref) {
    this.resolveRefs.push(String(ref))
    return undefined
  }

  async set() {
    throw new Error('packed credential fixture is read-only')
  }

  async unset() {
    throw new Error('packed credential fixture is read-only')
  }

  async readRecord() {
    return undefined
  }

  async describeRecord() {
    return { configured: false, writable: false }
  }

  async listRecords() {
    return []
  }

  async modifyRecord() {
    return undefined
  }
}
`)
  writeFileSync(configPath, [
    '- id: packed-workbench-auth-fixture',
    `  name: ${JSON.stringify(authFixturePath)}`,
    '- id: packed-workbench-credentials-fixture',
    `  name: ${JSON.stringify(credentialsFixturePath)}`,
    '- id: packed-workbench-host',
    `  name: ${JSON.stringify(hostName)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 5000',
    '    maxStatusLength: 280',
    '',
  ].join('\n'))

  const probePath = resolve(consumerRoot, 'packed-consumer-probe.mjs')
  writeFileSync(probePath, cleanConsumerProbe({
    bundleName,
    clientName,
    configPath,
    consumerRoot,
    databasePath,
    hostName,
    projectRoot: root,
  }))
  const probe = spawnSync(process.execPath, [probePath], {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_HOME: resolve(consumerRoot, 'dsh-home'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROCESS_MAX_BUFFER,
  })
  if (probe.error !== undefined || probe.status !== 0) {
    fail(`clean consumer: installed-package app-boot/Loader probe failed${formatProcessFailure(probe)}`)
    return
  }
  const marker = probe.stdout
    .split(/\r?\n/u)
    .findLast(line => line.startsWith('PACKED_CONSUMER_RESULT '))
  if (marker === undefined) {
    fail(`clean consumer: probe emitted no result marker${probe.stdout.trim() ? `: ${probe.stdout.trim()}` : ''}`)
    return
  }
  let result
  try {
    result = JSON.parse(marker.slice('PACKED_CONSUMER_RESULT '.length))
  } catch (error) {
    fail(`clean consumer: probe result was not JSON: ${errorMessage(error)}`)
    return
  }
  check(result?.resolvedCount === 9, 'clean consumer: all Host, Auth, Client, Typert, Remote, Recovery, and Bundle subpaths resolve from installed node_modules')
  check(result?.allResolvedInsideConsumer === true, 'clean consumer: public imports resolve inside the temporary consumer')
  check(result?.loaderEntryName === hostName, 'clean consumer: real Loader activates the public Host package name')
  check(result?.loadedInstanceMatchesPublicImport === true, 'clean consumer: Loader instance comes from the tgz-installed public Host import')
  check(result?.unauthorizedCode === 'unauthorized', 'clean consumer: installed Host direct invocation fails closed without a principal')
  check(result?.initialSnapshot === null, 'clean consumer: installed Host starts with an empty projection')
  check(
    result?.initialFeishuConnection?.connectionId === 'feishu-primary'
      && result?.initialFeishuConnection?.revision === 0
      && result?.initialFeishuConnection?.bot?.state === 'unconfigured'
      && result?.initialFeishuConnection?.user?.state === 'unconfigured'
      && result?.initialFeishuConnection?.bot?.credential?.configured === false
      && result?.initialFeishuConnection?.user?.credential?.configured === false,
    'clean consumer: installed Host starts with two explicit unconfigured Feishu routes',
  )
  check(
    result?.initialProjectStart?.catalogRevision === 0
      && result?.initialProjectStart?.projects?.length === 0
      && result?.initialProjectStart?.template?.selection?.templateId === 'knowledge-work'
      && result?.initialProjectStart?.template?.selection?.templateVersion === 1
      && /^sha256:[0-9a-f]{64}$/u.test(
        result?.initialProjectStart?.template?.selection?.definitionDigest ?? '',
      ),
    'clean consumer: installed Host exposes the exact immutable Knowledge Work Template Version',
  )
  check(result?.committed?.message === 'packed consumer status' && result?.committed?.revision === 1, 'clean consumer: installed Host commits setStatus revision 1')
  check(
    typeof result?.receipt?.commandId === 'string'
      && typeof result?.receipt?.auditEventId === 'string'
      && typeof result?.receipt?.outboxId === 'string',
    'clean consumer: installed Host returns the three durable receipt identities',
  )
  check(
    result?.initialActivity?.items?.length === 0
      && result?.initialActivity?.nextBeforeSequence === null
      && result?.initialActivity?.integrity?.valid === true
      && result?.initialActivity?.integrity?.eventCount === 0
      && result?.initialActivity?.integrity?.issue === null,
    'clean consumer: installed Host starts with an empty Activity page and same-snapshot integrity',
  )
  check(
    result?.committedActivity?.items?.length === 1
      && result?.committedActivity?.items?.[0]?.eventId === result?.receipt?.auditEventId
      && result?.committedActivity?.items?.[0]?.commandId === result?.receipt?.commandId
      && result?.committedActivity?.items?.[0]?.outbox?.id === result?.receipt?.outboxId
      && result?.committedActivity?.items?.[0]?.outbox?.state === 'pending',
    'clean consumer: installed Host projects the committed audit and pending Outbox receipt in Activity',
  )
  check(
    result?.committedActivity?.integrity?.valid === true
      && result?.committedActivity?.integrity?.eventCount === 1
      && result?.committedActivity?.integrity?.issue === null
      && result?.committedActivity?.integrity?.headHash === result?.committedActivity?.items?.[0]?.hash
      && JSON.stringify(result?.committedIntegrity) === JSON.stringify(result?.committedActivity?.integrity),
    'clean consumer: installed Host returns rows and one-event integrity from the Activity snapshot',
  )
  check(
    result?.createdProject?.project?.name === 'Packed consumer Project'
      && result?.createdProject?.project?.revision === 1
      && result?.createdProject?.primaryGoal?.outcomes?.length === 1
      && result?.createdProject?.primaryGoal?.outcomes?.[0]?.metric?.targetValue === 4
      && result?.createdProject?.templateSnapshot?.snapshotDigest
        === result?.initialProjectStart?.template?.selection?.definitionDigest,
    'clean consumer: installed Host atomically creates Project, Primary Goal, Outcome, and snapshot',
  )
  check(
    typeof result?.projectReceipt?.commandId === 'string'
      && typeof result?.projectReceipt?.auditEventId === 'string'
      && typeof result?.projectReceipt?.outboxId === 'string',
    'clean consumer: Project creation returns the three durable receipt identities',
  )
  check(
    JSON.stringify(result?.projectedProject) === JSON.stringify(result?.createdProject)
      && result?.createdProjectStart?.catalogRevision === 1
      && result?.createdProjectStart?.projects?.[0]?.projectId
        === result?.createdProject?.project?.projectId,
    'clean consumer: Project detail and creation catalog reopen the committed aggregate',
  )
  check(
    result?.createdProjectActivity?.items?.length === 1
      && result?.createdProjectActivity?.items?.[0]?.eventId
        === result?.projectReceipt?.auditEventId
      && result?.createdProjectActivity?.items?.[0]?.projectId
        === result?.createdProject?.project?.projectId
      && result?.createdProjectActivity?.items?.[0]?.outbox?.state === 'pending'
      && result?.createdProjectActivity?.integrity?.valid === true
      && result?.createdProjectActivity?.integrity?.eventCount === 2
      && result?.finalIntegrity?.valid === true
      && result?.finalIntegrity?.eventCount === 12
      && result?.finalIntegrity?.issue === null,
    'clean consumer: Project, Review, and Feishu audits extend the verified ledger without protected values',
  )
  check(
    result?.configuredFeishuConnection?.revision === 1
      && result?.configuredFeishuConnection?.bot?.state === 'configured'
      && result?.configuredFeishuConnection?.bot?.generation === 1
      && result?.configuredFeishuConnection?.bot?.credential?.configured === false
      && result?.feishuConfiguration?.connectionRevision === 1
      && result?.feishuConfiguration?.routeGeneration === 1,
    'clean consumer: packed Host persists one Bot route using only a DSH credential reference',
  )
  check(
    result?.feishuVerification?.result === 'failed'
      && result?.feishuVerification?.connectionRevision === 2
      && result?.verifiedFeishuConnection?.revision === 2
      && result?.verifiedFeishuConnection?.bot?.lastVerification?.result === 'failed'
      && result?.verifiedFeishuConnection?.bot?.lastVerification?.identity?.issue?.code
        === 'credential-unconfigured'
      && result?.verifiedFeishuConnection?.bot?.lastVerification?.resourceProbe?.state
        === 'not-tested'
      && result?.verifiedFeishuConnection?.bot?.actor === null,
    'clean consumer: packed Host fails identity before the requested resource probe for the exact unconfigured Bot credential',
  )
  check(
    result?.feishuActivity?.items?.length === 2
      && result?.feishuActivity?.items?.[0]?.action
        === 'workbench.feishu-route.verification-recorded'
      && result?.feishuActivity?.items?.[1]?.action
        === 'workbench.feishu-route.configured'
      && result?.feishuActivity?.integrity?.eventCount === 12
      && result?.feishuActivityRedacted === true
      && result?.credentialResolveWasExact === true
      && result?.identityFailureSkippedResource === true
      && result?.networkCalls === 0,
    'clean consumer: Feishu ledger is redacted, resolves only the configured ref, and never reads the requested resource',
  )
  check(
    JSON.stringify(result?.restartActivity?.items)
        === JSON.stringify(result?.committedActivity?.items)
      && JSON.stringify(result?.restartIntegrity) === JSON.stringify(result?.finalIntegrity)
      && JSON.stringify(result?.restartProjectStart)
        === JSON.stringify(result?.createdProjectStart)
      && JSON.stringify(result?.restartProject) === JSON.stringify(result?.createdProject)
      && JSON.stringify(result?.restartProjectActivity?.items)
        === JSON.stringify(result?.createdProjectActivity?.items)
      && result?.restartProjectActivity?.nextBeforeSequence
        === result?.createdProjectActivity?.nextBeforeSequence
      && JSON.stringify(result?.restartProjectActivity?.integrity)
        === JSON.stringify(result?.finalIntegrity)
      && result?.teamRoundTripVerified === true
      && result?.reviewRoundTripVerified === true
      && result?.deliverableRoundTripVerified === true
      && result?.feishuRoundTripVerified === true,
    'clean consumer: installed Host recovers status, Project, Team, typed Deliverables/Review, Feishu, Activity, and integrity after restart',
  )
  check(
    result?.packedDeliverables?.projectId === result?.createdProject?.project?.projectId
      && result?.packedDeliverables?.deliverables?.length === 0
      && result?.packedDeliverables?.activity?.length === 0
      && result?.packedDeliverableReview?.reviewKind === 'deliverable-acceptance'
      && result?.packedDeliverableReview?.deliverablesRevision
        === result?.packedDeliverables?.revision
      && result?.packedDeliverableReview?.items?.length === 0,
    'clean consumer: tgz-installed Host serves the typed T11 Deliverables workspace and Review target without File or Feishu credentials',
  )
  check(result?.restartSnapshot?.message === 'packed consumer status' && result?.restartSnapshot?.revision === 1, 'clean consumer: installed Host recovers the projection after full restart')
  check(result?.firstLifecycle === 'closed' && result?.secondLifecycle === 'closed', 'clean consumer: both Loader-owned Host instances dispose to closed')
  check(result?.firstRepositoryClosed === true && result?.secondRepositoryClosed === true, 'clean consumer: dispose closes both packed SQLite repositories')
  warnings.push('the clean consumer intentionally links the audited DSH baseline and uses cached React/Zod during pnpm --offline; it proves tgz installation and ordinary public-name loading, not registry availability')
}

function cleanConsumerProbe({
  bundleName,
  clientName,
  configPath,
  consumerRoot,
  databasePath,
  hostName,
  projectRoot,
}) {
  return `
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'

const HOST = ${JSON.stringify(hostName)}
const CLIENT = ${JSON.stringify(clientName)}
const BUNDLE = ${JSON.stringify(bundleName)}
const CONSUMER_ROOT = ${JSON.stringify(consumerRoot)}
const PROJECT_ROOT = ${JSON.stringify(projectRoot)}
const CONFIG_PATH = ${JSON.stringify(configPath)}
const DATABASE_PATH = ${JSON.stringify(databasePath)}
const canonicalConsumer = realpathSync(CONSUMER_ROOT)
const canonicalProjectPackages = realpathSync(resolve(PROJECT_ROOT, 'packages'))
const consumerPrefix = canonicalConsumer.endsWith(sep) ? canonicalConsumer : canonicalConsumer + sep
const projectPrefix = canonicalProjectPackages.endsWith(sep) ? canonicalProjectPackages : canonicalProjectPackages + sep
const specifiers = [
  HOST,
  HOST + '/auth',
  HOST + '/client',
  HOST + '/typert',
  HOST + '/remote',
  HOST + '/recovery',
  CLIENT,
  BUNDLE + '/package.json',
  BUNDLE + '/cordis.patch.yml',
]
const resolved = specifiers.map((specifier) => {
  const entry = realpathSync(fileURLToPath(import.meta.resolve(specifier)))
  assert.ok(entry.startsWith(consumerPrefix), specifier + ' escaped the clean consumer: ' + entry)
  assert.ok(!entry.startsWith(projectPrefix), specifier + ' resolved to the source workspace: ' + entry)
  return { specifier, entry }
})

const host = await import(HOST)
const hostAuth = await import(HOST + '/auth')
const hostContract = await import(HOST + '/client')
const client = await import(CLIENT)
const hostTypert = await import(HOST + '/typert')
const remoteTypert = await import(HOST + '/remote')
const recovery = await import(HOST + '/recovery')
const bundle = (await import(BUNDLE + '/package.json', { with: { type: 'json' } })).default
assert.equal(typeof host.default, 'function')
assert.equal(host.default, host.WorkbenchService)
assert.equal(host.WORKBENCH_SCHEMA_VERSION, 11)
assert.equal(typeof host.DshFeishuConnectionAdapter, 'function')
assert.equal(host.FEISHU_CONNECTION_ADAPTER_ID, 'feishu-open-platform-v1')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.startIdentityVerification, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.readTaskList, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.listTaskWorkflowFields, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.listCalendars, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.readCalendar, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.createCalendar, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.listCalendarEvents, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.readCalendarEvent, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.createCalendarEvent, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.updateCalendarEventSchedule, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.createTaskWorkflowField, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.updateTaskWorkflowField, 'function')
assert.equal(typeof host.DshFeishuConnectionAdapter.prototype.updateTask, 'function')
assert.equal(Object.hasOwn(host.DshFeishuConnectionAdapter.prototype, 'verify'), false)
assert.equal(hostAuth.default, hostAuth.OwnerAuthService)
assert.ok(!('default' in hostContract))
assert.equal(hostContract.FEISHU_CONNECTION_ID, 'feishu-primary')
assert.equal(typeof client.apply, 'function')
assert.ok(!('default' in client))
const remoteMethods = [
  'activity',
  'addProjectMember',
  'auditIntegrity',
  'bindFeishuTaskList',
  'bindProjectCalendar',
  'configureFeishuIdentityRoute',
  'configureFeishuTaskWorkflow',
  'createProject',
  'createProjectDeliverable',
  'createProjectMilestone',
  'createProjectRisk',
  'decideDeliverableAcceptance',
  'decideSuggestedChange',
  'discoverFeishuCalendarEvents',
  'discoverFeishuCalendars',
  'discoverFeishuTaskLists',
  'discoverFeishuTaskWorkflowFields',
  'feishuConnectionCenter',
  'getProjectMilestones',
  'previewFeishuTaskWorkflow',
  'project',
  'projectDeliverables',
  'projectRisks',
  'projectStart',
  'projectTasks',
  'projectTeam',
  'proposeProjectResponsibilityChange',
  'reconcileProjectCalendar',
  'reconcileProjectTasks',
  'referenceFeishuTask',
  'requestDeliverableAcceptance',
  'reviseProjectRisk',
  'reviewCenter',
  'setProjectMemberStatus',
  'setProjectResponsibility',
  'setStatus',
  'snapshot',
  'transitionProjectRisk',
  'updateFeishuTask',
  'updateProjectMilestoneDate',
  'verifyFeishuIdentityRoute',
]
assert.deepEqual(hostTypert.TYPERT.invocations.map(value => value.method).sort(), remoteMethods)
assert.deepEqual(remoteTypert.TYPERT_REMOTE.descriptors.map(value => value.method).sort(), remoteMethods)
assert.equal(typeof recovery.recoverOwnerOffline, 'function')
assert.ok(!('default' in recovery))
assert.equal(bundle.dsh.bundle.patch, './cordis.patch.yml')
const bundlePatchPath = fileURLToPath(import.meta.resolve(BUNDLE + '/cordis.patch.yml'))
const bundlePatch = readFileSync(bundlePatchPath, 'utf8')
assert.ok(bundlePatch.includes(HOST))
assert.ok(bundlePatch.includes(CLIENT))

let networkCalls = 0
globalThis.fetch = async () => {
  networkCalls += 1
  throw new Error('packed consumer forbids real network access')
}

const bareModuleBaseUrl = pathToFileURL(join(CONSUMER_ROOT, 'consumer-anchor.mjs')).href
let initialSnapshot
let initialFeishuConnection
let initialProjectStart
let initialActivity
let initialIntegrity
let committed
let receipt
let committedActivity
let committedIntegrity
let createdProject
let projectReceipt
let projectedProject
let createdProjectStart
let createdProjectActivity
let committedTeam
let teamActivity
let teamRoundTripVerified = false
let acceptedReview
let reviewRoundTripVerified = false
let packedDeliverables
let packedDeliverableReview
let deliverableRoundTripVerified = false
let feishuConfiguration
let configuredFeishuConnection
let feishuVerification
let verifiedFeishuConnection
let feishuActivity
let feishuActivityRedacted = false
let credentialResolveWasExact = false
let identityFailureSkippedResource = false
let finalIntegrity
let firstContext
let firstService
let loaderEntryName
let loadedInstanceMatchesPublicImport = false
let unauthorizedCode
try {
  firstContext = await boot('packed-consumer', CONFIG_PATH, undefined, undefined, bareModuleBaseUrl)
  const entries = [...firstContext.loader.entries()].filter(entry => entry.options.name === HOST)
  assert.equal(entries.length, 1)
  assert.ok(entries[0].fiber !== undefined)
  loaderEntryName = entries[0].options.name
  firstService = firstContext.get('workbench')
  const firstAuth = firstContext.get('workbenchAuth')
  const firstCredentials = firstContext.get('credentials')
  assert.ok(firstService instanceof host.WorkbenchService)
  assert.equal(typeof firstAuth?.run, 'function')
  assert.equal(typeof firstCredentials?.resolve, 'function')
  loadedInstanceMatchesPublicImport = true
  await assert.rejects(
    () => firstService.snapshot(new AbortController().signal),
    error => {
      unauthorizedCode = error?.failure?.code
      return unauthorizedCode === 'unauthorized'
    },
  )
  initialSnapshot = await firstAuth.run(() => firstService.snapshot(new AbortController().signal))
  assert.equal(initialSnapshot, null)
  initialFeishuConnection = await firstAuth.run(() => firstService.feishuConnectionCenter(
    new AbortController().signal,
  ))
  assert.equal(initialFeishuConnection.connectionId, 'feishu-primary')
  assert.equal(initialFeishuConnection.realm, 'feishu-cn')
  assert.equal(initialFeishuConnection.revision, 0)
  assert.equal(initialFeishuConnection.bot.state, 'unconfigured')
  assert.equal(initialFeishuConnection.user.state, 'unconfigured')
  assert.deepEqual(initialFeishuConnection.bot.credential, {
    ref: null,
    configured: false,
    source: null,
    writable: false,
  })
  initialProjectStart = await firstAuth.run(() => firstService.projectStart(
    { limit: 10 },
    new AbortController().signal,
  ))
  assert.equal(initialProjectStart.catalogRevision, 0)
  assert.deepEqual(initialProjectStart.projects, [])
  assert.equal(initialProjectStart.nextBeforeSequence, null)
  assert.equal(initialProjectStart.template.selection.templateId, 'knowledge-work')
  assert.equal(initialProjectStart.template.selection.templateVersion, 1)
  assert.match(initialProjectStart.template.selection.definitionDigest, /^sha256:[0-9a-f]{64}$/u)
  assert.equal(initialProjectStart.template.definition.snapshotSchemaVersion, 1)
  assert.equal(initialProjectStart.template.definition.kind, 'knowledge-work')
  initialActivity = await firstAuth.run(() => firstService.activity(
    { projectId: null, limit: 10 },
    new AbortController().signal,
  ))
  assert.deepEqual(initialActivity.items, [])
  assert.equal(initialActivity.nextBeforeSequence, null)
  assert.equal(initialActivity.integrity.valid, true)
  assert.equal(initialActivity.integrity.eventCount, 0)
  assert.equal(initialActivity.integrity.issue, null)
  assert.match(initialActivity.integrity.headHash, /^sha256:[0-9a-f]{64}$/u)
  initialIntegrity = await firstAuth.run(() => firstService.auditIntegrity(
    new AbortController().signal,
  ))
  assert.deepEqual(initialIntegrity, initialActivity.integrity)
  const outcome = await firstAuth.run(() => firstService.setStatus({
    message: 'packed consumer status',
    expectedRevision: null,
    idempotencyKey: 'packed-consumer-idempotency-0001',
    causationId: 'packed-consumer-causation-0001',
    reason: 'owner-status-edit',
  }, new AbortController().signal))
  assert.equal(outcome.ok, true)
  committed = outcome.value
  receipt = outcome.receipt
  assert.equal(committed.message, 'packed consumer status')
  assert.equal(committed.revision, 1)
  assert.match(receipt.commandId, /^command-/u)
  assert.match(receipt.auditEventId, /^audit-/u)
  assert.match(receipt.outboxId, /^outbox-/u)
  assert.deepEqual(await firstAuth.run(() => firstService.snapshot(new AbortController().signal)), committed)
  committedActivity = await firstAuth.run(() => firstService.activity({
    projectId: null,
    objectType: 'workbench-status',
    objectId: committed.id,
    action: 'workbench.status.updated',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(committedActivity.items.length, 1)
  const item = committedActivity.items[0]
  assert.equal(item.eventId, receipt.auditEventId)
  assert.equal(item.commandId, receipt.commandId)
  assert.equal(item.causationId, 'packed-consumer-causation-0001')
  assert.equal(item.object.id, committed.id)
  assert.equal(item.object.version, 1)
  assert.equal(item.outbox.id, receipt.outboxId)
  assert.equal(item.outbox.state, 'pending')
  assert.equal(JSON.stringify(committedActivity).includes('packed consumer status'), false)
  assert.equal(committedActivity.integrity.valid, true)
  assert.equal(committedActivity.integrity.eventCount, 1)
  assert.equal(committedActivity.integrity.issue, null)
  assert.equal(committedActivity.integrity.headHash, item.hash)
  committedIntegrity = await firstAuth.run(() => firstService.auditIntegrity(
    new AbortController().signal,
  ))
  assert.deepEqual(committedIntegrity, committedActivity.integrity)

  const projectRequest = {
    template: initialProjectStart.template.selection,
    projectName: 'Packed consumer Project',
    primaryGoal: {
      name: 'Shorten packed feedback time',
      outcomes: [{
        name: 'Reduce packed feedback latency',
        metric: {
          metricName: 'Feedback latency',
          initialValue: 10,
          targetValue: 4,
          unit: 'days',
          direction: 'decrease',
        },
      }],
    },
    supportingGoals: [],
    expectedCatalogRevision: initialProjectStart.catalogRevision,
    expectedRevision: null,
    idempotencyKey: 'packed-project-idempotency-0001',
    causationId: 'packed-project-causation-0001',
    reason: 'owner-project-create',
  }
  const createdOutcome = await firstAuth.run(() => firstService.createProject(
    projectRequest,
    new AbortController().signal,
  ))
  assert.equal(createdOutcome.ok, true)
  assert.equal(createdOutcome.catalogRevision, 1)
  createdProject = createdOutcome.value
  projectReceipt = createdOutcome.receipt
  assert.equal(createdProject.project.name, 'Packed consumer Project')
  assert.equal(createdProject.project.revision, 1)
  assert.equal(createdProject.project.catalogSequence, 1)
  assert.equal(createdProject.project.timezone, 'Asia/Shanghai')
  assert.equal(createdProject.primaryGoal.name, 'Shorten packed feedback time')
  assert.equal(createdProject.primaryGoal.revision, 1)
  assert.equal(createdProject.primaryGoal.outcomes.length, 1)
  assert.equal(createdProject.primaryGoal.outcomes[0].name, 'Reduce packed feedback latency')
  assert.deepEqual(createdProject.primaryGoal.outcomes[0].metric, {
    metricName: 'Feedback latency',
    initialValue: 10,
    targetValue: 4,
    unit: 'days',
    direction: 'decrease',
  })
  assert.deepEqual(createdProject.supportingGoals, [])
  assert.deepEqual(createdProject.templateSnapshot.template, initialProjectStart.template.selection)
  assert.equal(createdProject.templateSnapshot.snapshotSchemaVersion, 1)
  assert.deepEqual(createdProject.templateSnapshot.definition, initialProjectStart.template.definition)
  assert.equal(
    createdProject.templateSnapshot.snapshotDigest,
    initialProjectStart.template.selection.definitionDigest,
  )
  assert.match(projectReceipt.commandId, /^command-/u)
  assert.match(projectReceipt.auditEventId, /^audit-/u)
  assert.match(projectReceipt.outboxId, /^outbox-/u)
  const replayedProject = await firstAuth.run(() => firstService.createProject(
    projectRequest,
    new AbortController().signal,
  ))
  assert.deepEqual(replayedProject, createdOutcome)
  projectedProject = await firstAuth.run(() => firstService.project(
    { projectId: createdProject.project.projectId },
    new AbortController().signal,
  ))
  assert.deepEqual(projectedProject, createdProject)
  createdProjectStart = await firstAuth.run(() => firstService.projectStart(
    { limit: 10 },
    new AbortController().signal,
  ))
  assert.equal(createdProjectStart.catalogRevision, 1)
  assert.equal(createdProjectStart.projects.length, 1)
  assert.equal(createdProjectStart.projects[0].projectId, createdProject.project.projectId)
  assert.equal(
    createdProjectStart.projects[0].primaryGoal.goalId,
    createdProject.primaryGoal.goalId,
  )
  createdProjectActivity = await firstAuth.run(() => firstService.activity({
    projectId: createdProject.project.projectId,
    objectType: 'project',
    objectId: createdProject.project.projectId,
    action: 'workbench.project.created',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(createdProjectActivity.items.length, 1)
  const projectItem = createdProjectActivity.items[0]
  assert.equal(projectItem.eventId, projectReceipt.auditEventId)
  assert.equal(projectItem.commandId, projectReceipt.commandId)
  assert.equal(projectItem.projectId, createdProject.project.projectId)
  assert.equal(projectItem.action, 'workbench.project.created')
  assert.equal(projectItem.reason, 'owner-project-create')
  assert.equal(projectItem.object.type, 'project')
  assert.equal(projectItem.object.id, createdProject.project.projectId)
  assert.equal(projectItem.object.version, 1)
  assert.equal(projectItem.outbox.id, projectReceipt.outboxId)
  assert.equal(projectItem.outbox.state, 'pending')
  const projectActivityJson = JSON.stringify(createdProjectActivity)
  assert.equal(projectActivityJson.includes('Packed consumer Project'), false)
  assert.equal(projectActivityJson.includes('Shorten packed feedback time'), false)
  assert.equal(projectActivityJson.includes('Feedback latency'), false)
  assert.equal(createdProjectActivity.integrity.valid, true)
  assert.equal(createdProjectActivity.integrity.eventCount, 2)
  assert.equal(createdProjectActivity.integrity.issue, null)
  assert.equal(createdProjectActivity.integrity.headHash, projectItem.hash)

  const projectId = createdProject.project.projectId
  const initialTeam = await firstAuth.run(() => firstService.projectTeam(
    { projectId },
    new AbortController().signal,
  ))
  assert.deepEqual(initialTeam, {
    projectId,
    teamRevision: 0,
    members: [],
    responsibility: null,
  })
  const feishuRequest = {
    projectId,
    member: {
      kind: 'human',
      displayName: 'Packed Feishu Sponsor',
      identity: {
        type: 'feishu',
        appId: 'cli_packed_consumer',
        openId: 'ou_packed_sponsor',
      },
    },
    expectedTeamRevision: 0,
    expectedRevision: null,
    idempotencyKey: 'packed-member-feishu-idempotency-0001',
    causationId: 'packed-member-feishu-causation-0001',
    reason: 'owner-project-member-add',
  }
  const feishuAdded = await firstAuth.run(() => firstService.addProjectMember(
    feishuRequest,
    new AbortController().signal,
  ))
  assert.equal(feishuAdded.ok, true)
  assert.equal(feishuAdded.value.kind, 'human')
  assert.equal(feishuAdded.value.teamRevision, 1)
  assert.deepEqual(
    await firstAuth.run(() => firstService.addProjectMember(
      feishuRequest,
      new AbortController().signal,
    )),
    feishuAdded,
  )

  const externalAdded = await firstAuth.run(() => firstService.addProjectMember({
    projectId,
    member: {
      kind: 'human',
      displayName: 'Packed External Contributor',
      identity: {
        type: 'external',
        method: 'email',
        value: 'packed.external@example.invalid',
      },
    },
    expectedTeamRevision: 1,
    expectedRevision: null,
    idempotencyKey: 'packed-member-external-idempotency-0001',
    causationId: 'packed-member-external-causation-0001',
    reason: 'owner-project-member-add',
  }, new AbortController().signal))
  assert.equal(externalAdded.ok, true)
  assert.equal(externalAdded.value.kind, 'human')
  assert.equal(externalAdded.value.teamRevision, 2)

  const agentAdded = await firstAuth.run(() => firstService.addProjectMember({
    projectId,
    member: {
      kind: 'agent',
      displayName: 'Packed Research Agent',
    },
    expectedTeamRevision: 2,
    expectedRevision: null,
    idempotencyKey: 'packed-member-agent-idempotency-0001',
    causationId: 'packed-member-agent-causation-0001',
    reason: 'owner-project-member-add',
  }, new AbortController().signal))
  assert.equal(agentAdded.ok, true)
  assert.equal(agentAdded.value.kind, 'agent')
  assert.equal(agentAdded.value.teamRevision, 3)

  const spareAdded = await firstAuth.run(() => firstService.addProjectMember({
    projectId,
    member: {
      kind: 'human',
      displayName: 'Packed Inactive Historian',
      identity: {
        type: 'external',
        method: 'other',
        value: 'packed-historian-reference',
      },
    },
    expectedTeamRevision: 3,
    expectedRevision: null,
    idempotencyKey: 'packed-member-spare-idempotency-0001',
    causationId: 'packed-member-spare-causation-0001',
    reason: 'owner-project-member-add',
  }, new AbortController().signal))
  assert.equal(spareAdded.ok, true)
  assert.equal(spareAdded.value.teamRevision, 4)

  const spareInactive = await firstAuth.run(() => firstService.setProjectMemberStatus({
    projectId,
    memberId: spareAdded.value.memberId,
    status: 'inactive',
    expectedTeamRevision: 4,
    expectedMemberRevision: 1,
    idempotencyKey: 'packed-member-status-idempotency-0001',
    causationId: 'packed-member-status-causation-0001',
    reason: 'owner-project-member-status-change',
  }, new AbortController().signal))
  assert.equal(spareInactive.ok, true)
  assert.equal(spareInactive.value.status, 'inactive')
  assert.equal(spareInactive.value.memberRevision, 2)
  assert.equal(spareInactive.value.teamRevision, 5)

  const responsibilitySet = await firstAuth.run(() => firstService.setProjectResponsibility({
    projectId,
    accountableMemberId: agentAdded.value.memberId,
    contributorMemberIds: [externalAdded.value.memberId],
    humanSponsorMemberId: feishuAdded.value.memberId,
    expectedTeamRevision: 5,
    expectedResponsibilityRevision: null,
    idempotencyKey: 'packed-responsibility-idempotency-0001',
    causationId: 'packed-responsibility-causation-0001',
    reason: 'owner-project-responsibility-set',
  }, new AbortController().signal))
  assert.equal(responsibilitySet.ok, true)
  assert.equal(responsibilitySet.value.responsibilityRevision, 1)
  assert.equal(responsibilitySet.value.teamRevision, 6)

  const acknowledgementJson = JSON.stringify([
    feishuAdded,
    externalAdded,
    agentAdded,
    spareAdded,
    spareInactive,
    responsibilitySet,
  ])
  for (const privateValue of [
    'Packed Feishu Sponsor',
    'cli_packed_consumer',
    'ou_packed_sponsor',
    'Packed External Contributor',
    'packed.external@example.invalid',
    'Packed Research Agent',
    'Packed Inactive Historian',
    'packed-historian-reference',
  ]) assert.equal(acknowledgementJson.includes(privateValue), false)

  committedTeam = await firstAuth.run(() => firstService.projectTeam(
    { projectId },
    new AbortController().signal,
  ))
  assert.equal(committedTeam.teamRevision, 6)
  assert.equal(committedTeam.members.length, 4)
  assert.equal(
    committedTeam.members.find(member => member.memberId === feishuAdded.value.memberId)
      .identity.state,
    'declared',
  )
  assert.equal(
    committedTeam.members.find(member => member.memberId === externalAdded.value.memberId)
      .feishuAssigneeEligibility,
    'external-contact',
  )
  assert.equal(
    committedTeam.members.find(member => member.memberId === agentAdded.value.memberId)
      .feishuAssigneeEligibility,
    'agent-not-assignable',
  )
  assert.equal(
    committedTeam.members.find(member => member.memberId === spareAdded.value.memberId).status,
    'inactive',
  )
  assert.deepEqual(committedTeam.responsibility, {
    projectId,
    revision: 1,
    accountableMemberId: agentAdded.value.memberId,
    contributorMemberIds: [externalAdded.value.memberId],
    humanSponsorMemberId: feishuAdded.value.memberId,
    updatedAt: committedTeam.responsibility.updatedAt,
  })
  teamActivity = await firstAuth.run(() => firstService.activity(
    { projectId, limit: 10 },
    new AbortController().signal,
  ))
  assert.equal(teamActivity.items.length, 7)
  assert.equal(teamActivity.items[0].action, 'workbench.project.responsibility-assigned')
  assert.equal(teamActivity.items.filter(
    activity => activity.action === 'workbench.project-member.created',
  ).length, 4)
  assert.equal(teamActivity.items.filter(
    activity => activity.action === 'workbench.project-member.status-changed',
  ).length, 1)
  const teamActivityJson = JSON.stringify(teamActivity)
  for (const privateValue of [
    'Packed Feishu Sponsor',
    'cli_packed_consumer',
    'ou_packed_sponsor',
    'Packed External Contributor',
    'packed.external@example.invalid',
    'Packed Research Agent',
    'Packed Inactive Historian',
    'packed-historian-reference',
  ]) assert.equal(teamActivityJson.includes(privateValue), false)
  assert.equal(teamActivity.integrity.valid, true)
  assert.equal(teamActivity.integrity.eventCount, 8)

  const reviewProposal = await firstAuth.run(() =>
    firstService.proposeProjectResponsibilityChange({
      projectId,
      candidate: {
        accountableMemberId: agentAdded.value.memberId,
        contributorMemberIds: [],
        humanSponsorMemberId: feishuAdded.value.memberId,
      },
      expectedTeamRevision: 6,
      evidenceRefs: [{
        kind: 'workbench-audit-event',
        auditEventId: responsibilitySet.receipt.auditEventId,
      }],
      idempotencyKey: 'packed-review-proposal-idempotency-0001',
      causationId: 'packed-review-proposal-causation-0001',
      reason: 'owner-suggested-change-propose',
    }, new AbortController().signal))
  assert.equal(reviewProposal.ok, true)
  assert.equal(reviewProposal.value.suggestedChangeRevision, 1)
  assert.equal(reviewProposal.value.baseTargetVersion, 6)
  assert.equal(reviewProposal.value.riskLevel, 'low')
  const pendingReview = await firstAuth.run(() => firstService.reviewCenter({
    projectId,
    status: 'pending',
    riskLevel: 'low',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(pendingReview.items.length, 1)
  assert.equal(pendingReview.items[0].effectiveStatus, 'pending')
  assert.deepEqual(pendingReview.items[0].proposedDiff.changedFields, ['contributors'])
  assert.deepEqual(pendingReview.items[0].risk.proposedReasonCodes, ['contributors-only'])
  assert.equal(pendingReview.items[0].evidence[0].auditEventId, responsibilitySet.receipt.auditEventId)

  const reviewAcceptance = await firstAuth.run(() => firstService.decideSuggestedChange({
    projectId,
    suggestedChangeId: reviewProposal.value.suggestedChangeId,
    expectedSuggestedChangeRevision: 1,
    mode: 'accept',
    acknowledgedRiskLevel: 'low',
    feedback: 'Packed review confirms that the contributor assignment is complete.',
    idempotencyKey: 'packed-review-decision-idempotency-0001',
    causationId: 'packed-review-decision-causation-0001',
    reason: 'owner-suggested-change-accept',
  }, new AbortController().signal))
  assert.equal(reviewAcceptance.ok, true)
  assert.equal(reviewAcceptance.value.suggestedChangeRevision, 2)
  assert.equal(reviewAcceptance.value.persistedState, 'accepted')
  assert.equal(reviewAcceptance.value.appliedTeamRevision, 7)
  assert.equal(reviewAcceptance.value.appliedResponsibilityRevision, 2)

  committedTeam = await firstAuth.run(() => firstService.projectTeam(
    { projectId },
    new AbortController().signal,
  ))
  assert.equal(committedTeam.teamRevision, 7)
  assert.equal(committedTeam.responsibility.revision, 2)
  assert.deepEqual(committedTeam.responsibility.contributorMemberIds, [])
  acceptedReview = await firstAuth.run(() => firstService.reviewCenter({
    projectId,
    status: 'accepted',
    riskLevel: 'low',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(acceptedReview.items.length, 1)
  assert.equal(acceptedReview.items[0].effectiveStatus, 'accepted')
  assert.equal(acceptedReview.items[0].decisions[0].mode, 'accepted')
  assert.equal(acceptedReview.items[0].decisions[0].appliedTeamRevision, 7)
  packedDeliverables = await firstAuth.run(() => firstService.projectDeliverables({
    projectId,
    activityLimit: 10,
  }, new AbortController().signal))
  assert.equal(packedDeliverables.projectId, projectId)
  assert.deepEqual(packedDeliverables.deliverables, [])
  assert.deepEqual(packedDeliverables.activity, [])
  packedDeliverableReview = await firstAuth.run(() => firstService.reviewCenter({
    reviewKind: 'deliverable-acceptance',
    projectId,
    limit: 10,
  }, new AbortController().signal))
  assert.equal(packedDeliverableReview.reviewKind, 'deliverable-acceptance')
  assert.equal(packedDeliverableReview.deliverablesRevision, packedDeliverables.revision)
  assert.deepEqual(packedDeliverableReview.items, [])
  const acceptedReviewActivity = await firstAuth.run(() => firstService.activity({
    projectId,
    action: 'workbench.suggested-change.accepted',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(acceptedReviewActivity.items.length, 1)
  assert.equal(acceptedReviewActivity.items[0].eventId, reviewAcceptance.receipt.auditEventId)
  const acceptedReviewActivityJson = JSON.stringify(acceptedReviewActivity)
  assert.equal(acceptedReviewActivityJson.includes(
    'Packed review confirms that the contributor assignment is complete.',
  ), false)
  assert.equal(acceptedReviewActivityJson.includes(responsibilitySet.receipt.auditEventId), false)
  finalIntegrity = await firstAuth.run(() => firstService.auditIntegrity(
    new AbortController().signal,
  ))
  assert.deepEqual(finalIntegrity, acceptedReviewActivity.integrity)
  assert.equal(finalIntegrity.eventCount, 10)

  const feishuConfigurationOutcome = await firstAuth.run(() =>
    firstService.configureFeishuIdentityRoute({
      kind: 'bot',
      mode: 'set',
      appId: 'cli_packed_feishu',
      credentialRef: 'FEISHU_PACKED_BOT_SECRET',
      expectedConnectionRevision: 0,
      expectedRouteGeneration: null,
      idempotencyKey: 'packed-feishu-config-idempotency-0001',
      causationId: 'packed-feishu-config-causation-0001',
      reason: 'owner-feishu-route-configure',
    }, new AbortController().signal))
  assert.equal(feishuConfigurationOutcome.ok, true)
  feishuConfiguration = feishuConfigurationOutcome.value
  assert.deepEqual(feishuConfiguration, {
    connectionId: 'feishu-primary',
    connectionRevision: 1,
    kind: 'bot',
    routeGeneration: 1,
    state: 'configured',
  })
  configuredFeishuConnection = await firstAuth.run(() => firstService.feishuConnectionCenter(
    new AbortController().signal,
  ))
  assert.equal(configuredFeishuConnection.revision, 1)
  assert.equal(configuredFeishuConnection.bot.appId, 'cli_packed_feishu')
  assert.deepEqual(configuredFeishuConnection.bot.credential, {
    ref: 'FEISHU_PACKED_BOT_SECRET',
    configured: false,
    source: null,
    writable: false,
  })

  const feishuVerifyRequest = {
    kind: 'bot',
    resourceProbe: {
      kind: 'task-list',
      resourceId: 'tasklist_packed_identity_gate',
    },
    expectedConnectionRevision: 1,
    expectedRouteGeneration: 1,
    idempotencyKey: 'packed-feishu-verify-idempotency-0001',
    causationId: 'packed-feishu-verify-causation-0001',
    reason: 'owner-feishu-route-verify',
  }
  const feishuVerificationOutcome = await firstAuth.run(() =>
    firstService.verifyFeishuIdentityRoute(
      feishuVerifyRequest,
      new AbortController().signal,
    ))
  assert.equal(feishuVerificationOutcome.ok, true)
  feishuVerification = feishuVerificationOutcome.value
  assert.equal(feishuVerification.result, 'failed')
  assert.equal(feishuVerification.connectionRevision, 2)
  assert.equal(feishuVerification.routeGeneration, 1)
  assert.deepEqual(
    await firstAuth.run(() => firstService.verifyFeishuIdentityRoute(
      feishuVerifyRequest,
      new AbortController().signal,
    )),
    feishuVerificationOutcome,
  )
  credentialResolveWasExact = firstCredentials.resolveRefs.length === 1
    && firstCredentials.resolveRefs[0] === 'FEISHU_PACKED_BOT_SECRET'
  assert.equal(credentialResolveWasExact, true)
  verifiedFeishuConnection = await firstAuth.run(() => firstService.feishuConnectionCenter(
    new AbortController().signal,
  ))
  assert.equal(verifiedFeishuConnection.revision, 2)
  assert.equal(verifiedFeishuConnection.bot.actor, null)
  assert.equal(verifiedFeishuConnection.bot.lastVerification.result, 'failed')
  assert.equal(
    verifiedFeishuConnection.bot.lastVerification.identity.issue.code,
    'credential-unconfigured',
  )
  assert.equal(verifiedFeishuConnection.bot.lastVerification.resourceProbe.state, 'not-tested')
  identityFailureSkippedResource = networkCalls === 0
  assert.equal(identityFailureSkippedResource, true)
  feishuActivity = await firstAuth.run(() => firstService.activity({
    projectId: null,
    objectType: 'feishu-connection',
    limit: 10,
  }, new AbortController().signal))
  assert.equal(feishuActivity.items.length, 2)
  assert.equal(feishuActivity.items[0].action, 'workbench.feishu-route.verification-recorded')
  assert.equal(feishuActivity.items[1].action, 'workbench.feishu-route.configured')
  const feishuActivityJson = JSON.stringify(feishuActivity)
  feishuActivityRedacted = !feishuActivityJson.includes('cli_packed_feishu')
    && !feishuActivityJson.includes('FEISHU_PACKED_BOT_SECRET')
    && !feishuActivityJson.includes('tasklist_packed_identity_gate')
  assert.equal(feishuActivityRedacted, true)
  assert.equal(networkCalls, 0)
  finalIntegrity = await firstAuth.run(() => firstService.auditIntegrity(
    new AbortController().signal,
  ))
  assert.deepEqual(finalIntegrity, feishuActivity.integrity)
  assert.equal(finalIntegrity.eventCount, 12)
} finally {
  await firstContext?.fiber.dispose()
}
assert.equal(firstService.scenario.lifecycle, 'closed')
assert.equal(firstService.scenario.options.repository.closed, true)
await assert.rejects(() => firstService.snapshot(), error => error?.failure?.code === 'unavailable')

let restartSnapshot
let restartActivity
let restartIntegrity
let restartProjectStart
let restartProject
let restartProjectActivity
let restartTeam
let restartReview
let restartDeliverables
let restartDeliverableReview
let restartFeishuConnection
let restartFeishuActivity
let feishuRoundTripVerified = false
let secondContext
let secondService
try {
  secondContext = await boot('packed-consumer-restart', CONFIG_PATH, undefined, undefined, bareModuleBaseUrl)
  secondService = secondContext.get('workbench')
  const secondAuth = secondContext.get('workbenchAuth')
  const secondCredentials = secondContext.get('credentials')
  assert.ok(secondService instanceof host.WorkbenchService)
  restartSnapshot = await secondAuth.run(() => secondService.snapshot(new AbortController().signal))
  assert.deepEqual(restartSnapshot, committed)
  restartActivity = await secondAuth.run(() => secondService.activity(
    {
      projectId: null,
      objectType: 'workbench-status',
      objectId: committed.id,
      action: 'workbench.status.updated',
      limit: 10,
    },
    new AbortController().signal,
  ))
  restartIntegrity = await secondAuth.run(() => secondService.auditIntegrity(
    new AbortController().signal,
  ))
  assert.deepEqual(restartActivity.items, committedActivity.items)
  assert.equal(restartActivity.nextBeforeSequence, committedActivity.nextBeforeSequence)
  assert.deepEqual(restartActivity.integrity, finalIntegrity)
  assert.deepEqual(restartIntegrity, finalIntegrity)
  restartProjectStart = await secondAuth.run(() => secondService.projectStart(
    { limit: 10 },
    new AbortController().signal,
  ))
  assert.deepEqual(restartProjectStart, createdProjectStart)
  restartProject = await secondAuth.run(() => secondService.project(
    { projectId: createdProject.project.projectId },
    new AbortController().signal,
  ))
  assert.deepEqual(restartProject, createdProject)
  restartProjectActivity = await secondAuth.run(() => secondService.activity({
    projectId: createdProject.project.projectId,
    objectType: 'project',
    objectId: createdProject.project.projectId,
    action: 'workbench.project.created',
    limit: 10,
  }, new AbortController().signal))
  assert.deepEqual(restartProjectActivity.items, createdProjectActivity.items)
  assert.equal(restartProjectActivity.nextBeforeSequence, createdProjectActivity.nextBeforeSequence)
  assert.deepEqual(restartProjectActivity.integrity, finalIntegrity)
  restartTeam = await secondAuth.run(() => secondService.projectTeam(
    { projectId: createdProject.project.projectId },
    new AbortController().signal,
  ))
  assert.deepEqual(restartTeam, committedTeam)
  teamRoundTripVerified = true
  restartReview = await secondAuth.run(() => secondService.reviewCenter({
    projectId: createdProject.project.projectId,
    status: 'accepted',
    riskLevel: 'low',
    limit: 10,
  }, new AbortController().signal))
  assert.deepEqual(restartReview, acceptedReview)
  reviewRoundTripVerified = true
  restartDeliverables = await secondAuth.run(() => secondService.projectDeliverables({
    projectId: createdProject.project.projectId,
    activityLimit: 10,
  }, new AbortController().signal))
  restartDeliverableReview = await secondAuth.run(() => secondService.reviewCenter({
    reviewKind: 'deliverable-acceptance',
    projectId: createdProject.project.projectId,
    limit: 10,
  }, new AbortController().signal))
  assert.deepEqual(restartDeliverables, packedDeliverables)
  assert.deepEqual(restartDeliverableReview, packedDeliverableReview)
  deliverableRoundTripVerified = true
  restartFeishuConnection = await secondAuth.run(() => secondService.feishuConnectionCenter(
    new AbortController().signal,
  ))
  assert.deepEqual(restartFeishuConnection, verifiedFeishuConnection)
  restartFeishuActivity = await secondAuth.run(() => secondService.activity({
    projectId: null,
    objectType: 'feishu-connection',
    limit: 10,
  }, new AbortController().signal))
  assert.deepEqual(restartFeishuActivity.items, feishuActivity.items)
  assert.equal(restartFeishuActivity.nextBeforeSequence, feishuActivity.nextBeforeSequence)
  assert.deepEqual(restartFeishuActivity.integrity, finalIntegrity)
  assert.deepEqual(secondCredentials.resolveRefs, [])
  feishuRoundTripVerified = true
  assert.equal(networkCalls, 0)
} finally {
  await secondContext?.fiber.dispose()
}
assert.equal(secondService.scenario.lifecycle, 'closed')
assert.equal(secondService.scenario.options.repository.closed, true)
assert.equal(resolve(DATABASE_PATH), DATABASE_PATH)

const relativeEntries = resolved.map(value => relative(canonicalConsumer, value.entry))
assert.ok(relativeEntries.every(value => value.length > 0 && !value.startsWith('..' + sep) && !isAbsolute(value)))
console.log('PACKED_CONSUMER_RESULT ' + JSON.stringify({
  resolvedCount: resolved.length,
  allResolvedInsideConsumer: true,
  loaderEntryName,
  loadedInstanceMatchesPublicImport,
  unauthorizedCode,
  initialSnapshot,
  initialFeishuConnection,
  initialProjectStart,
  initialActivity,
  initialIntegrity,
  committed,
  receipt,
  committedActivity,
  committedIntegrity,
  createdProject,
  projectReceipt,
  projectedProject,
  createdProjectStart,
  createdProjectActivity,
  teamRoundTripVerified,
  acceptedReview,
  reviewRoundTripVerified,
  packedDeliverables,
  packedDeliverableReview,
  deliverableRoundTripVerified,
  feishuConfiguration,
  configuredFeishuConnection,
  feishuVerification,
  verifiedFeishuConnection,
  feishuActivity,
  feishuActivityRedacted,
  credentialResolveWasExact,
  identityFailureSkippedResource,
  feishuRoundTripVerified,
  restartFeishuConnection,
  restartFeishuActivity,
  networkCalls,
  finalIntegrity,
  restartSnapshot,
  restartActivity,
  restartIntegrity,
  restartProjectStart,
  restartProject,
  restartProjectActivity,
  restartReview,
  firstLifecycle: firstService.scenario.lifecycle,
  secondLifecycle: secondService.scenario.lifecycle,
  firstRepositoryClosed: firstService.scenario.options.repository.closed,
  secondRepositoryClosed: secondService.scenario.options.repository.closed,
}))
`
}

function resolveAuditedBaseline() {
  const lock = readJson(resolve(root, 'dsh-reference.lock.json'), 'clean consumer DSH reference lock')
  if (lock === undefined) return undefined
  const environmentVariable = lock.localResolution?.environmentVariable
  const fallback = lock.localResolution?.fallbackRelativePath
  if (typeof environmentVariable !== 'string' || typeof fallback !== 'string') {
    fail('clean consumer: DSH reference lock has no usable localResolution')
    return undefined
  }
  const configured = process.env[environmentVariable]
  const baseline = configured === undefined ? resolve(root, fallback) : resolve(configured)
  const manifest = readJson(resolve(baseline, 'package.json'), 'clean consumer audited DSH baseline')
  if (manifest === undefined) return undefined
  check(manifest.version === lock.upstream?.version, 'clean consumer: linked DSH baseline version matches the reference lock')
  return baseline
}

function installedPackageVersion(packageName) {
  const manifest = readJson(resolve(root, 'node_modules', ...packageName.split('/'), 'package.json'), `clean consumer cached ${packageName}`)
  if (manifest === undefined) return undefined
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    fail(`clean consumer: installed ${packageName} has no version`)
    return undefined
  }
  check(true, `clean consumer: cached ${packageName}@${manifest.version} is available for offline installation`)
  return manifest.version
}

function verifyExportTargets(spec, packedDir, manifest) {
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    const targets = allExportTargets(entry)
    if (targets.length === 0) {
      fail(`${spec.role}: export ${subpath} has no string target`)
      continue
    }
    for (const target of targets) {
      check(target.startsWith('./'), `${spec.role}: export ${subpath} target ${target} is package-relative`)
      const normalized = target.replaceAll('\\', '/')
      check(!/(^|\/)src\//u.test(normalized), `${spec.role}: export ${subpath} does not target src/`)
      check(!normalized.endsWith('.ts') || normalized.endsWith('.d.ts'), `${spec.role}: export ${subpath} targets JavaScript or declarations`)
      if (target.startsWith('./')) check(existsSync(resolve(packedDir, target)), `${spec.role}: export ${subpath} target ${target} exists in archive`)
    }
  }
}

function verifyPackedDeclarationSet(spec, packedDir) {
  if (spec.expectedDeclarations === undefined) return
  const expected = [...spec.expectedDeclarations].sort()
  const packed = walkFiles(packedDir)
    .map(relativePath => relativePath.replaceAll('\\', '/'))
    .filter(relativePath => relativePath.endsWith('.d.ts'))
    .sort()
  const expectedSet = new Set(expected)
  const packedSet = new Set(packed)
  const missing = expected.filter(relativePath => !packedSet.has(relativePath))
  const unexpected = packed.filter(relativePath => !expectedSet.has(relativePath))
  if (missing.length > 0 || unexpected.length > 0) {
    const details = []
    if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`)
    if (unexpected.length > 0) details.push(`unexpected: ${unexpected.join(', ')}`)
    fail(`${spec.role}: archive declaration set differs from the expected package surface (${details.join('; ')})`)
    return
  }
  check(true, `${spec.role}: archive declaration set exactly matches the expected package surface`)
}

function verifyPackedFeishuContract(packedDir) {
  const adapter = readFileSync(resolve(packedDir, 'lib/types/feishu-connection-adapter.d.ts'), 'utf8')
  const scenario = readFileSync(resolve(packedDir, 'lib/types/scenario.d.ts'), 'utf8')
  const client = readFileSync(resolve(packedDir, 'lib/types/client.d.ts'), 'utf8')
  const identityInput = declarationInterfaceBody(
    scenario,
    'WorkbenchFeishuIdentityVerificationInput',
  )
  const verifiedSession = declarationInterfaceBody(
    scenario,
    'WorkbenchFeishuVerifiedIdentitySession',
  )

  check(
    /\bstartIdentityVerification\(/u.test(adapter) && !/\n\s+verify\(/u.test(adapter),
    'Host: packed adapter declaration exposes startIdentityVerification and no legacy one-phase verify',
  )
  check(
    identityInput?.includes('kind: FeishuIdentityKind') === true
      && identityInput.includes('appId: string')
      && identityInput.includes('credentialRef: string')
      && !identityInput.includes('resourceProbe'),
    'Host: packed identity phase cannot receive a resource identifier',
  )
  check(
    verifiedSession?.includes('finishVerification(') === true
      && verifiedSession.includes('resourceId: string')
      && verifiedSession.includes('dispose(): void'),
    'Host: packed verified identity exposes only an opaque one-shot resource continuation',
  )
  check(
    sameStrings(declarationStringUnion(client, 'FeishuConnectionIssueCode'), [
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
      && sameStrings(declarationStringUnion(client, 'FeishuConnectionRecoveryCode'), [
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
      ]),
    'Host: packed issue and recovery vocabularies are exact closed T07 unions',
  )
}

function declarationInterfaceBody(source, name) {
  return source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'))?.[1]
}

function declarationStringUnion(source, name) {
  const body = source.match(new RegExp(`export type ${name} =([\\s\\S]*?);`, 'u'))?.[1]
  if (body === undefined) return []
  return [...body.matchAll(/'([^']+)'/gu)].map(match => match[1])
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function verifyRuntimeDependencySpecs(spec, manifest) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      check(typeof range === 'string' && range.length > 0, `${spec.role}: ${field}.${name} has a version`)
      if (typeof range !== 'string') continue
      check(!/^(?:workspace:|link:|file:)/u.test(range), `${spec.role}: ${field}.${name} is installable outside the source workspace`)
      check(!range.startsWith('/') && !range.includes(`${sep}..${sep}`), `${spec.role}: ${field}.${name} is not a local filesystem path`)
    }
  }
  const linkedDevDependencies = Object.entries(manifest.devDependencies ?? {})
    .filter(([, range]) => typeof range === 'string' && /^(?:link:|file:)/u.test(range))
    .map(([name]) => name)
  if (linkedDevDependencies.length > 0) {
    warnings.push(`${spec.name} keeps source-linked devDependencies (${linkedDevDependencies.join(', ')}); consumers ignore them, and they are not registry-readiness evidence`)
  }
}

function verifyPackedRuntimeImports(spec, packedDir, manifest) {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  for (const relativePath of walkFiles(packedDir).filter(file => extname(file) === '.js')) {
    const source = readFileSync(resolve(packedDir, relativePath), 'utf8')
    for (const importSpecifier of runtimeSpecifiers(source)) {
      if (isBuiltin(importSpecifier)) continue
      if (importSpecifier.startsWith('.')) {
        check(!sourceOnlySpecifier(importSpecifier), `${spec.role}: ${relativePath} has no source-only import ${importSpecifier}`)
        check(existsSync(resolve(dirname(resolve(packedDir, relativePath)), importSpecifier)), `${spec.role}: ${relativePath} relative import ${importSpecifier} is in the archive`)
        continue
      }
      if (importSpecifier.startsWith('/') || importSpecifier.startsWith('file:')) {
        fail(`${spec.role}: ${relativePath} contains local runtime import ${importSpecifier}`)
        continue
      }
      const dependency = packageNameFromSpecifier(importSpecifier)
      check(declared.has(dependency), `${spec.role}: ${relativePath} declares runtime package ${dependency}`)
    }
  }
}

function verifyPackedClientRegistration(spec, packedDir, manifest) {
  const bundlePath = resolve(packedDir, 'lib/client.js')
  if (!existsSync(bundlePath)) {
    fail('Client: cannot execute lazy-CJS registration because lib/client.js is absent from the archive')
    return
  }
  const probe = [
    "const fs = require('node:fs')",
    "const vm = require('node:vm')",
    `const source = fs.readFileSync(${JSON.stringify(resolve(packedDir, 'lib/client.js'))}, 'utf8')`,
    'const registrations = []',
    'const window = { __ModuleLoader__: { load(value) { registrations.push({ id: value.id, factory: typeof value.factory }) } } }',
    `vm.runInNewContext(source, { window }, { filename: ${JSON.stringify(resolve(packedDir, 'lib/client.js'))}, timeout: 5000 })`,
    'process.stdout.write(JSON.stringify(registrations))',
  ].join('\n')
  // Keep execution isolated from this ESM process; no file is written and the
  // synthetic filename above is only used for an actionable VM stack trace.
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', probe], {
    cwd: tempRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROCESS_MAX_BUFFER,
  })
  if (result.error !== undefined || result.status !== 0) {
    fail(`${spec.role}: packed client is not executable lazy-CJS${formatProcessFailure(result)}`)
    return
  }
  try {
    const observed = JSON.parse(result.stdout)
    check(Array.isArray(observed) && observed.length === 1, 'Client: packed lazy-CJS registers exactly once')
    check(observed[0]?.id === manifest.name, 'Client: packed lazy-CJS registration id matches manifest name')
    check(observed[0]?.factory === 'function', 'Client: packed lazy-CJS registration carries a factory')
  } catch (error) {
    fail(`Client: could not parse lazy-CJS probe result: ${errorMessage(error)}`)
  }
}

function reportPublicationBoundary(spec, manifest) {
  if (manifest.private === true) warnings.push(`${spec.name} is private; its successful archive is local delivery evidence, not npm publication evidence`)
}

function walkFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(resolve(directory, prefix), { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(directory, relativePath))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files
}

function readJson(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object')
    return value
  } catch (error) {
    fail(`${label}: cannot read ${path}: ${errorMessage(error)}`)
    return undefined
  }
}

function run(command, args, cwd, label, createDestination = false) {
  if (createDestination) {
    const destinationIndex = args.indexOf('-C')
    const destination = destinationIndex === -1 ? undefined : args[destinationIndex + 1]
    if (destination !== undefined) {
      try {
        mkdirSync(destination, { recursive: true })
      } catch (error) {
        fail(`${label}: could not create extraction root: ${errorMessage(error)}`)
        return undefined
      }
    }
  }
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: ARCHIVE_TIMEOUT_MS,
    maxBuffer: PROCESS_MAX_BUFFER,
  })
  if (result.error !== undefined || result.status !== 0) {
    fail(`${label} failed${formatProcessFailure(result)}`)
    return undefined
  }
  return result.stdout
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
  if (engineSupportedBuiltins.has(specifier)) return true
  const plain = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return builtinModules.includes(plain) || builtinModules.includes(`node:${plain}`)
}

function allExportTargets(value) {
  const targets = []
  visit(value)
  return targets

  function visit(current) {
    if (typeof current === 'string') {
      targets.push(current)
      return
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return
    for (const child of Object.values(current)) visit(child)
  }
}

function formatProcessFailure(result) {
  const details = []
  if (result.error !== undefined) details.push(errorMessage(result.error))
  if (result.status !== null) details.push(`exit ${result.status}`)
  if (result.stderr?.trim()) details.push(result.stderr.trim())
  if (result.stdout?.trim()) details.push(result.stdout.trim())
  return details.length === 0 ? '' : `: ${details.join(' | ')}`
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
