import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      '@benz-ai-x/dsh-project-workbench-bundle': 'workspace:*',
    })
  })

  it('ships a parseable empty user patch layer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    })
    expect(parsed).toEqual([])
  })

  it('resolves and composes both Workbench rows after the stock Web layers', () => {
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
    const composed = applyEntryPatches([], patches, message => warnings.push(message))

    expect(warnings).toEqual([])
    expect(composed.find(row => row.id === 'workbench-host')).toMatchObject({
      name: '@benz-ai-x/dsh-project-workbench',
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
  })
})
