import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('Workbench test profile', () => {
  it('is a private live-reload profile with the required ordered layers', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      private?: boolean
      packageManager?: string
      dependencies?: Record<string, string>
      dsh?: {
        bundle?: unknown
        profile?: { bundles?: string[]; patchReload?: string }
      }
    }

    expect(manifest.private).toBe(true)
    expect(manifest.packageManager).toBe('pnpm@11.7.0')
    expect(manifest.dsh?.bundle).toBeUndefined()
    expect(manifest.dsh?.profile).toEqual({
      bundles: [
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        '@benz-ai-x/dsh-project-workbench-bundle',
      ],
      patchReload: 'live',
    })
    expect(manifest.dependencies).toEqual({
      '@benz-ai-x/dsh-project-workbench': 'workspace:*',
      '@benz-ai-x/dsh-project-workbench-bundle': 'workspace:*',
    })
  })

  it('materializes the Host as a direct dependency for the recovery CLI', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const repositoryRoot = resolve(root, '../..')
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-workbench-profile-'))

    try {
      const stdout = execFileSync(
        process.execPath,
        [resolve(root, 'materialize.mjs')],
        {
          encoding: 'utf8',
          env: { ...process.env, DSH_HOME: dshHome },
        },
      )
      const profileDir = resolve(dshHome, 'profiles/workbench-test')
      const manifest = JSON.parse(
        readFileSync(resolve(profileDir, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }

      expect(stdout).toBe(`${profileDir}\n`)
      expect(manifest.dependencies).toEqual({
        '@benz-ai-x/dsh-project-workbench':
          `link:${resolve(repositoryRoot, 'packages/workbench-host')}`,
        '@benz-ai-x/dsh-project-workbench-bundle':
          `link:${resolve(repositoryRoot, 'packages/workbench-bundle')}`,
      })
      expect(readFileSync(resolve(profileDir, 'browser-host.mjs'), 'utf8')).toBe(
        readFileSync(resolve(root, 'browser-host.mjs'), 'utf8'),
      )
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
    }
  })

  it('ships an explicit browser-fixture Host override in its final test-only patch layer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    })
    expect(parsed).toEqual([
      { id: 'workbench-host', disabled: true },
      {
        insert: [{
          id: 'workbench-browser-host',
          name: './browser-host.mjs',
          config: {
            databasePath: '.dsh/project-workbench.sqlite',
            journalMode: 'wal',
            busyTimeoutMs: 5000,
            maxStatusLength: 280,
            taskReconciliationIntervalMs: 0,
            calendarReconciliationIntervalMs: 0,
          },
        }],
      },
    ])
  })

  it('resolves and composes the Owner gate, Host, and Client after the stock Web layers', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    const require = createRequire(import.meta.url)
    const patches = manifest.dsh.profile.bundles.flatMap((packageName) => {
      const packagePath = require.resolve(`${packageName}/package.json`)
      const bundle = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        dsh?: { bundle?: { patch?: string } }
      }
      const declared = bundle.dsh?.bundle?.patch
      if (declared === undefined) throw new Error(`${packageName} is not a DSH bundle`)
      const value = yaml.load(
        readFileSync(resolve(dirname(packagePath), declared), 'utf8'),
        { schema: entryListSchema },
      )
      if (!Array.isArray(value)) throw new TypeError(`${packageName} patch must be a list`)
      return value as PatchOptions[]
    })
    const warnings: string[] = []
    const profilePatches = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as PatchOptions[]
    const composed = applyEntryPatches(
      [],
      [...patches, ...profilePatches],
      message => warnings.push(message),
    )

    expect(warnings).toEqual([])
    expect(composed.find(row => row.id === 'workbench-auth')).toMatchObject({
      name: '@benz-ai-x/dsh-project-workbench/auth',
      config: {
        sessionLifetimeMinutes: 720,
        maxSessions: 16,
        maxConcurrentPasswordJobs: 2,
        maxQueuedPasswordJobs: 8,
        maxRequestBodyBytes: 8192,
      },
    })
    expect(composed.find(row => row.id === 'workbench-host')).toMatchObject({
      name: '@benz-ai-x/dsh-project-workbench',
      disabled: true,
      config: {
        databasePath: '.dsh/project-workbench.sqlite',
        journalMode: 'wal',
        busyTimeoutMs: 5000,
        maxStatusLength: 280,
      },
    })
    expect(composed.find(row => row.id === 'workbench-client')).toMatchObject({
      name: '@benz-ai-x/dsh-project-workbench-client',
    })
    expect(composed.find(row => row.id === 'workbench-browser-host')).toMatchObject({
      name: './browser-host.mjs',
      config: {
        databasePath: '.dsh/project-workbench.sqlite',
        journalMode: 'wal',
        busyTimeoutMs: 5000,
        maxStatusLength: 280,
        taskReconciliationIntervalMs: 0,
        calendarReconciliationIntervalMs: 0,
      },
    })
  })

  it('resolves the generated T11 Deliverable Remote face through the materialized Profile closure', async () => {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve('@benz-ai-x/dsh-project-workbench/remote')
    const remote = await import(pathToFileURL(resolved).href) as {
      TYPERT_REMOTE?: { descriptors?: readonly { method?: string }[] }
    }
    const methods = remote.TYPERT_REMOTE?.descriptors?.map(value => value.method) ?? []

    expect(resolved).toMatch(/[/\\]packages[/\\]workbench-host[/\\]lib[/\\]typert\.remote-client\.js$/u)
    expect(methods).toEqual(expect.arrayContaining([
      'createProjectDeliverable',
      'decideDeliverableAcceptance',
      'projectDeliverables',
      'requestDeliverableAcceptance',
    ]))
  })

  it('keeps the browser-fixture Host Loader contract explicit', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const host = await import(pathToFileURL(resolve(root, 'browser-host.mjs')).href) as {
      default: { inject?: unknown; Config?: unknown }
    }

    expect(Object.hasOwn(host.default, 'inject')).toBe(true)
    expect(Object.hasOwn(host.default, 'Config')).toBe(true)
    expect(host.default.inject).toEqual(['workbenchAuth', 'credentials'])
    expect(typeof host.default.Config).toBe('function')
  })
})
