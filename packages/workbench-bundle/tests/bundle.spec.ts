import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
    expect(rows.some(row => /file/iu.test(`${row.id ?? ''} ${row.name ?? ''}`))).toBe(false)
  })

  it('resolves the four generated T11 Deliverable Remotes from the bundled Host', async () => {
    const require = createRequire(import.meta.url)
    const hostFace = await import(pathToFileURL(
      require.resolve('@benz-ai-x/dsh-project-workbench/typert'),
    ).href) as {
      TYPERT?: { invocations?: readonly { method?: string }[] }
    }
    const remoteFace = await import(pathToFileURL(
      require.resolve('@benz-ai-x/dsh-project-workbench/remote'),
    ).href) as {
      TYPERT_REMOTE?: { descriptors?: readonly { method?: string }[] }
    }
    const deliverableMethods = [
      'createProjectDeliverable',
      'decideDeliverableAcceptance',
      'projectDeliverables',
      'requestDeliverableAcceptance',
    ]

    expect(hostFace.TYPERT?.invocations?.map(value => value.method)
      .filter(method => deliverableMethods.includes(method ?? ''))
      .sort()).toEqual(deliverableMethods)
    expect(remoteFace.TYPERT_REMOTE?.descriptors?.map(value => value.method)
      .filter(method => deliverableMethods.includes(method ?? ''))
      .sort()).toEqual(deliverableMethods)
  })
})
