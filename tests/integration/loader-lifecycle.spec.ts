import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type {
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from '../../packages/workbench-host/src/client.ts'
import type { WorkbenchService } from '../../packages/workbench-host/src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const hostEntry = resolve(repositoryRoot, 'packages/workbench-host/lib/index.js')
const temporaryRoots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async context => {
    await context.fiber.dispose().catch(() => undefined)
  }))
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })))
})

interface WorkbenchContext extends Context {
  readonly workbench: WorkbenchService
}

async function fixture(): Promise<{
  readonly root: string
  readonly databasePath: string
  readonly configPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-loader-'))
  temporaryRoots.push(root)
  return {
    root,
    databasePath: join(root, 'state', 'workbench.sqlite'),
    configPath: join(root, 'cordis.yml'),
  }
}

function config(entry: string, databasePath: string, maxStatusLength = 280): string {
  return [
    '- id: workbench-host',
    `  name: ${JSON.stringify(entry)}`,
    '  config:',
    `    databasePath: ${JSON.stringify(databasePath)}`,
    '    journalMode: wal',
    '    busyTimeoutMs: 500',
    `    maxStatusLength: ${String(maxStatusLength)}`,
    '',
  ].join('\n')
}

async function load(configPath: string): Promise<WorkbenchContext> {
  const context = await boot('workbench-test', configPath) as WorkbenchContext
  contexts.push(context)
  return context
}

describe('built Workbench Host through the real DSH Loader', () => {
  it('rejects invalid runtime Config before publishing the service or opening SQLite', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath, 0))

    await expect(boot('workbench-test', test.configPath)).rejects.toThrow(
      /failed to apply loader entry workbench-host|maxStatusLength/u,
    )
    expect(existsSync(test.databasePath)).toBe(false)
  })

  it('commits through the public command, disposes cleanly, and recovers after restart', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const first = await load(test.configPath)
    const firstService = first.workbench
    await expect(firstService.snapshot(new AbortController().signal)).resolves.toBeNull()
    const committed: SetStatusResult = await firstService.setStatus({
      message: 'Loader-owned durable status',
      expectedRevision: null,
    }, new AbortController().signal)
    expect(committed).toMatchObject({
      ok: true,
      value: {
        message: 'Loader-owned durable status',
        revision: 1,
      },
    })
    if (!committed.ok) throw new Error('expected the initial status commit to succeed')
    const expected: WorkbenchStatusSnapshot = committed.value

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    expect(first.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')

    const restarted = await load(test.configPath)
    await expect(restarted.workbench.snapshot(new AbortController().signal)).resolves.toEqual(expected)
    await restarted.fiber.dispose()
    contexts.splice(contexts.indexOf(restarted), 1)
    expect(restarted.get('workbench')).toBeUndefined()
  })

  it('withdraws and remounts the built Host cleanly through one live Loader entry', async () => {
    expect(existsSync(hostEntry)).toBe(true)
    const test = await fixture()
    await writeFile(test.configPath, config(hostEntry, test.databasePath))

    const context = await load(test.configPath)
    const entry = [...context.loader.entries()]
      .find(candidate => candidate.options.id === 'workbench-host')
    if (entry === undefined) throw new Error('real Loader did not publish workbench-host entry')
    const firstService = context.workbench
    const committed = await firstService.setStatus({
      message: 'same-process HMR status',
      expectedRevision: null,
    }, new AbortController().signal)
    if (!committed.ok) throw new Error('expected the HMR fixture commit to succeed')

    await entry.update({ disabled: true })
    await context.loader.await()
    expect(entry.fiber).toBeUndefined()
    expect(context.get('workbench')).toBeUndefined()
    expect(firstService.scenario.lifecycle).toBe('closed')
    expect((firstService.scenario.options.repository as { closed?: boolean }).closed).toBe(true)

    await entry.update({ disabled: false })
    await context.loader.await()
    expect(entry.fiber).toBeDefined()
    expect(context.get('workbench')).toBeDefined()
    expect(context.workbench).not.toBe(firstService)
    await expect(context.workbench.snapshot(new AbortController().signal)).resolves.toEqual(committed.value)

    const replacement = context.workbench
    await entry.update({ disabled: true })
    await context.loader.await()
    expect(context.get('workbench')).toBeUndefined()
    expect(replacement.scenario.lifecycle).toBe('closed')
    expect((replacement.scenario.options.repository as { closed?: boolean }).closed).toBe(true)
  })
})
