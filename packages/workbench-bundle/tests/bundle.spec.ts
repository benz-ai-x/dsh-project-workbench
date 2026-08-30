import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface BundleManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

describe('Project Workbench bundle', () => {
  it('declares an installable DSH bundle with the Host and Client closure', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as BundleManifest

    expect(manifest).toMatchObject({
      name: '@benz-ai-x/dsh-project-workbench-bundle',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      dependencies: {
        '@benz-ai-x/dsh-project-workbench': 'workspace:*',
        '@benz-ai-x/dsh-project-workbench-client': 'workspace:*',
      },
    })
    expect(manifest.private).toBe(true)
  })

  it('parses to stable auth, Host, and Client rows with explicit defaults', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as BundleManifest
    const patchPath = resolve(root, manifest.dsh?.bundle?.patch ?? '')
    const parsed = yaml.load(readFileSync(patchPath, 'utf8'), {
      schema: entryListSchema,
    })

    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as { insert?: PatchRow[] }[])
      .flatMap(patch => patch.insert ?? [])
    expect(rows).toEqual([
      {
        id: 'workbench-auth',
        name: '@benz-ai-x/dsh-project-workbench/auth',
        config: {
          sessionLifetimeMinutes: 720,
          maxSessions: 16,
          maxConcurrentPasswordJobs: 2,
          maxQueuedPasswordJobs: 8,
          maxRequestBodyBytes: 8192,
        },
      },
      {
        id: 'workbench-host',
        name: '@benz-ai-x/dsh-project-workbench',
        config: {
          databasePath: '.dsh/project-workbench.sqlite',
          journalMode: 'wal',
          busyTimeoutMs: 5000,
          maxStatusLength: 280,
        },
      },
      {
        id: 'workbench-client',
        name: '@benz-ai-x/dsh-project-workbench-client',
      },
    ])
  })
})
