#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(sourceDir, '../..')
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const targetDir = join(dshHome, 'profiles', 'workbench-test')
const managedFiles = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']
const force = process.argv.includes('--force')

const existing = managedFiles.filter(file => existsSync(join(targetDir, file)))
if (existing.length > 0 && !force) {
  throw new Error(
    `Refusing to overwrite ${targetDir}; re-run with --force only if this test profile may be replaced.`,
  )
}

mkdirSync(targetDir, { recursive: true })
const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
manifest.dependencies['@benz-ai-x/dsh-project-workbench-bundle'] =
  `link:${join(repositoryRoot, 'packages', 'workbench-bundle')}`
writeFileSync(join(targetDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)

for (const file of managedFiles.slice(1)) {
  writeFileSync(join(targetDir, file), readFileSync(join(sourceDir, file)))
}

process.stdout.write(`${targetDir}\n`)
