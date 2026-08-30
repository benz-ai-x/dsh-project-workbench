#!/usr/bin/env node

/**
 * Remove one package's generated output before a production build.
 *
 * Callers select a closed package name rather than supplying a filesystem
 * path. Each selection resolves to one exact repo-owned `lib` directory.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const expectedWorkspaceName = '@benz-ai-x/dsh-project-workbench-workspace'
const targets = new Map([
  ['host', {
    packageDir: resolve(root, 'packages/workbench-host'),
    packageName: '@benz-ai-x/dsh-project-workbench',
  }],
  ['client', {
    packageDir: resolve(root, 'packages/workbench-client'),
    packageName: '@benz-ai-x/dsh-project-workbench-client',
  }],
])

const requested = process.argv.slice(2)
const selection = requested.length === 1 ? targets.get(requested[0]) : undefined
if (selection === undefined) {
  console.error('Usage: node scripts/clean-package-output.mjs <host|client>')
  process.exitCode = 2
} else {
  const workspaceManifest = readManifest(resolve(root, 'package.json'))
  if (workspaceManifest.name !== expectedWorkspaceName) {
    throw new Error(`refusing to clean output for unexpected workspace ${String(workspaceManifest.name)}`)
  }

  const packageManifest = readManifest(resolve(selection.packageDir, 'package.json'))
  if (packageManifest.name !== selection.packageName) {
    throw new Error(`refusing to clean output for unexpected package ${String(packageManifest.name)}`)
  }

  const target = resolve(selection.packageDir, 'lib')
  if (dirname(target) !== selection.packageDir || basename(target) !== 'lib') {
    throw new Error(`refusing to clean unexpected package output path ${target}`)
  }
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`refusing to clean symbolic-link package output ${target}`)
    }
    rmSync(target, { recursive: true, force: true })
  }
}

function readManifest(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid package manifest at ${path}`)
  }
  return value
}
