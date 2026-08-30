#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireSource = process.argv.includes('--require-source')
const syncLinks = process.argv.includes('--sync-links')
const harnessRootIndex = process.argv.indexOf('--harness-root')
const explicitHarnessRoot = harnessRootIndex < 0 ? undefined : process.argv[harnessRootIndex + 1]
const failures = []
const warnings = []
const passes = []

const expectedLinks = Object.freeze({
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/cordis-plugin-include': 'vendor/include',
  '@deepseek-ai/cordis-plugin-loader': 'vendor/loader',
  '@deepseek-ai/dsh-app-boot': 'packages/boot/app-boot',
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/dsh-api-remotes': 'packages/api/remotes',
  '@deepseek-ai/dsh-base': 'packages/bundle/base',
  '@deepseek-ai/dsh-client-connection': 'packages/client/connection',
  '@deepseek-ai/dsh-credentials': 'packages/credentials/credentials',
  '@deepseek-ai/dsh-credentials-local': 'packages/credentials/credentials-local',
  '@deepseek-ai/dsh-home-paths': 'packages/util/home-paths',
  '@deepseek-ai/dsh-host-webserver': 'packages/host/webserver',
  '@deepseek-ai/dsh-client-locale': 'packages/client/locale',
  '@deepseek-ai/dsh-client-store': 'packages/client/store',
  '@deepseek-ai/dsh-client-test-runtime': 'packages/test-support/client-runtime',
  '@deepseek-ai/dsh-client-ui-layout': 'packages/client/ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives': 'packages/client/ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer': 'packages/client/ui-renderer',
  '@deepseek-ai/dsh-client-ui-session': 'packages/client/ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar': 'packages/client/ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots': 'packages/client/ui-slots',
  '@deepseek-ai/dsh-typert-generator': 'packages/typert/generator',
  '@deepseek-ai/dsh-typert-loader': 'packages/typert/loader',
  '@deepseek-ai/dsh-typert-protocol': 'packages/typert/protocol',
  '@deepseek-ai/dsh-typert-registry': 'packages/typert/registry',
  '@deepseek-ai/dsh-web-app': 'packages/bundle/web-app',
})

function check(condition, message) {
  if (condition) passes.push(message)
  else failures.push(message)
}

function listFiles(root) {
  const result = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) result.push(absolute)
    }
  }
  visit(root)
  return result.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
}

function digestDocs(sourceRoot) {
  const docsRoot = join(sourceRoot, 'docs')
  if (!existsSync(docsRoot) || !statSync(docsRoot).isDirectory()) {
    throw new Error(`missing docs directory under ${sourceRoot}`)
  }
  const aggregate = createHash('sha256')
  for (const absolute of listFiles(docsRoot)) {
    const fileDigest = createHash('sha256').update(readFileSync(absolute)).digest('hex')
    const sourceRelative = relative(sourceRoot, absolute).split(sep).join('/')
    aggregate.update(`${fileDigest}  ${sourceRelative}\n`)
  }
  return aggregate.digest('hex')
}

function git(sourceRoot, args) {
  const result = spawnSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function harnessChanges(sourceRoot) {
  const changes = new Set()
  for (const args of [
    ['status', '--porcelain=v1', '--untracked-files=all'],
    ['status', '--porcelain=v1', '--ignored=matching', '--untracked-files=all', '--', '.env'],
  ]) {
    for (const line of git(sourceRoot, args).split(/\r?\n/u)) if (line) changes.add(line)
  }
  return [...changes]
}

function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/u.exec(value)
  return match === null ? undefined : match.slice(1).map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function nodeSatisfies(range, version = process.version) {
  const actual = parseVersion(version)
  if (actual === undefined || typeof range !== 'string') return false
  return range.split('||').some((rawClause) => {
    const clause = rawClause.trim()
    const minimum = parseVersion(clause.replace(/^(?:\^|>=)\s*/u, ''))
    if (minimum === undefined || compareVersions(actual, minimum) < 0) return false
    if (clause.startsWith('>=')) return true
    if (clause.startsWith('^')) return compareVersions(actual, [minimum[0] + 1, 0, 0]) < 0
    return compareVersions(actual, minimum) === 0
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonAtomically(path, value) {
  const temporary = `${path}.dsh-context-${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

function relativeLink(fromDirectory, target) {
  let value = relative(fromDirectory, target).split(sep).join('/')
  if (!value.startsWith('.')) value = `./${value}`
  return `link:${value}`
}

function workspaceManifests() {
  const paths = [join(projectRoot, 'package.json')]
  for (const group of ['packages', 'profiles']) {
    const directory = join(projectRoot, group)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = join(directory, entry.name, 'package.json')
      if (existsSync(manifest)) paths.push(manifest)
    }
  }
  return paths
}

const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'TODO.md',
  'docs/agent/PROJECT_CONTRACT.md',
  'dsh-reference.lock.json',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.host.json',
  'tsconfig.client.json',
  'packages/workbench-host/package.json',
  'packages/workbench-client/package.json',
  'packages/workbench-bundle/package.json',
  'profiles/workbench-test/package.json',
]
for (const path of requiredFiles) check(existsSync(join(projectRoot, path)), `${path} exists`)
check(!existsSync(join(projectRoot, '.env')), 'project root has no CLI-loaded .env')

let lock
let rootManifest
let profileManifest
try {
  lock = readJson(join(projectRoot, 'dsh-reference.lock.json'))
} catch (error) {
  failures.push(`dsh-reference.lock.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
try {
  rootManifest = readJson(join(projectRoot, 'package.json'))
} catch (error) {
  failures.push(`package.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
try {
  profileManifest = readJson(join(projectRoot, 'profiles/workbench-test/package.json'))
} catch (error) {
  failures.push(`profiles/workbench-test/package.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (lock !== undefined) {
  check(lock.schemaVersion === 2, 'reference lock schema v2 is supported')
  check(lock.channel === 'stable', 'reference lock selects the stable audited channel')
  check(/^[0-9a-f]{40}$/u.test(lock.upstream?.commit ?? ''), 'reference lock records a full Git commit')
  check(/^[0-9a-f]{64}$/u.test(lock.upstream?.docsDigest ?? ''), 'reference lock records a docs SHA-256')
  check(/^[0-9a-f]{64}$/u.test(lock.upstream?.catalogDigest ?? ''), 'reference lock records a catalog SHA-256')
  check(lock.upstream?.tag === 'dsh-v0.1.2-alpha.1', 'reference lock records the audited DSH tag')
  check(nodeSatisfies(lock.upstream?.node), `Node ${process.version} satisfies ${lock.upstream?.node}`)

  const environmentName = lock.localResolution?.environmentVariable ?? 'DSH_HARNESS_ROOT'
  const configuredRoot = explicitHarnessRoot ?? process.env[environmentName]
  const fallback = lock.localResolution?.fallbackRelativePath
  const sourceRoot = resolve(configuredRoot ?? join(projectRoot, fallback ?? ''))
  if (!existsSync(sourceRoot)) {
    const message = `pinned DSH source not found at ${sourceRoot}`
    if (requireSource) failures.push(message)
    else warnings.push(`${message}; set ${environmentName} for strict validation`)
  } else {
    try {
      const sourceManifest = readJson(join(sourceRoot, 'package.json'))
      check(sourceManifest.version === lock.upstream.version, `DSH version matches ${lock.upstream.version}`)
      check(sourceManifest.engines?.node === lock.upstream.node, `DSH Node engine matches ${lock.upstream.node}`)
      check(sourceManifest.packageManager === lock.upstream.packageManager, `DSH package manager matches ${lock.upstream.packageManager}`)
      check(git(sourceRoot, ['rev-parse', 'HEAD']) === lock.upstream.commit, `DSH commit matches ${lock.upstream.commit}`)
      check(digestDocs(sourceRoot) === lock.upstream.docsDigest, 'DSH docs digest matches the audited baseline')
      const dirty = harnessChanges(sourceRoot)
      check(dirty.length === 0, dirty.length === 0
        ? 'DSH Harness source inputs are clean'
        : `DSH Harness source inputs have changes:\n${dirty.join('\n')}`)

      for (const [packageName, sourcePath] of Object.entries(expectedLinks)) {
        const packageRoot = join(sourceRoot, sourcePath)
        const manifestPath = join(packageRoot, 'package.json')
        check(existsSync(manifestPath), `${packageName} source package exists`)
        if (!existsSync(manifestPath)) continue
        const packageManifest = readJson(manifestPath)
        check(packageManifest.name === packageName, `${sourcePath} declares ${packageName}`)
        for (const field of ['main', 'types']) {
          const entry = packageManifest[field]
          check(typeof entry === 'string' && existsSync(join(packageRoot, entry)), `${packageName} has a built ${field} entry`)
        }
      }

      const manifests = workspaceManifests()
      if (syncLinks && failures.length === 0) {
        for (const manifestPath of manifests) {
          const manifest = readJson(manifestPath)
          let changed = false
          for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
            const dependencies = manifest[section]
            if (dependencies === undefined) continue
            for (const [packageName, sourcePath] of Object.entries(expectedLinks)) {
              if (!(packageName in dependencies)) continue
              const next = relativeLink(dirname(manifestPath), join(sourceRoot, sourcePath))
              if (dependencies[packageName] === next) continue
              dependencies[packageName] = next
              changed = true
            }
          }
          if (changed) writeJsonAtomically(manifestPath, manifest)
        }
        lock.localResolution.fallbackRelativePath = relative(projectRoot, sourceRoot).split(sep).join('/')
        writeJsonAtomically(join(projectRoot, 'dsh-reference.lock.json'), lock)
        passes.push(`synchronized Harness links to ${sourceRoot}`)
      }

      for (const manifestPath of manifests) {
        const manifest = readJson(manifestPath)
        for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
          for (const [packageName, specifier] of Object.entries(manifest[section] ?? {})) {
            if (!packageName.startsWith('@deepseek-ai/')) continue
            check(!String(specifier).startsWith('workspace:'), `${manifest.name} ${section}.${packageName} does not use workspace protocol`)
            const sourcePath = expectedLinks[packageName]
            if (sourcePath === undefined || !String(specifier).startsWith('link:')) continue
            const linkedPath = resolve(dirname(manifestPath), String(specifier).slice('link:'.length))
            check(existsSync(linkedPath) && realpathSync(linkedPath) === realpathSync(join(sourceRoot, sourcePath)),
              `${manifest.name} ${packageName} links to the audited source`)
          }
        }
      }
      passes.push(`validated DSH source at ${sourceRoot}`)
    } catch (error) {
      failures.push(`cannot validate DSH source at ${sourceRoot}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

if (rootManifest !== undefined) {
  check(rootManifest.private === true, 'workspace remains private while source-linked')
  check(rootManifest.type === 'module', 'workspace uses ESM')
  check(rootManifest.engines?.node === '^22.19.0 || >=24.0.0', 'workspace Node engine matches the pinned Harness')
  check(rootManifest.packageManager === 'pnpm@11.7.0', 'workspace package manager matches the pinned Harness')
  check(rootManifest.scripts?.['context:check:strict'] === 'node scripts/verify-dsh-context.mjs --require-source',
    'strict context script requires source validation')
}

if (profileManifest !== undefined) {
  check(profileManifest.packageManager === 'pnpm@11.7.0', 'materialized test Profile pins the audited package manager')
}

for (const message of passes) console.log(`PASS ${message}`)
for (const message of warnings) console.warn(`WARN ${message}`)
for (const message of failures) console.error(`FAIL ${message}`)

if (failures.length > 0) {
  console.error(`\ncontext check failed: ${failures.length} failure(s), ${warnings.length} warning(s)`)
  process.exitCode = 1
} else {
  console.log(`\ncontext check passed: ${passes.length} check(s), ${warnings.length} warning(s)`)
}
