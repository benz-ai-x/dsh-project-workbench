import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WorkbenchService, {
  Config,
  DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS,
  DEFAULT_WORKBENCH_DATABASE_PATH,
  DEFAULT_WORKBENCH_MAX_STATUS_LENGTH,
} from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('WorkbenchService', () => {
  it('publishes the exact service key, namespace, and public Remote methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-service-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = ctx.plugin(WorkbenchService, {
      databasePath: join(root, 'workbench.sqlite'),
      journalMode: 'wal',
      busyTimeoutMs: 500,
      maxStatusLength: 20,
    })
    await fiber.await()

    expect(ctx.workbench.typertRemote).toMatchObject({
      serviceKey: 'workbench',
      namespace: 'workbench',
    })
    expect(remoteMethods(ctx.workbench)).toEqual([
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'setStatus', invocation: { kind: 'direct' } },
    ])
    await expect(ctx.workbench.snapshot(new AbortController().signal)).resolves.toBeNull()
    await expect(ctx.workbench.setStatus({
      message: 'Walking skeleton',
      expectedRevision: null,
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { message: 'Walking skeleton', revision: 1 },
    })

    const service = ctx.workbench
    await fiber.dispose()
    expect(ctx.get('workbench')).toBeUndefined()
    expect(service.scenario.lifecycle).toBe('closed')
  })

  it('exports one same-named type/runtime Config with validated defaults', async () => {
    expect(WorkbenchService.inject).toEqual([])
    expect(WorkbenchService.Config).toBe(Config)
    expect(Config({})).toEqual({
      databasePath: DEFAULT_WORKBENCH_DATABASE_PATH,
      journalMode: 'wal',
      busyTimeoutMs: DEFAULT_WORKBENCH_BUSY_TIMEOUT_MS,
      maxStatusLength: DEFAULT_WORKBENCH_MAX_STATUS_LENGTH,
    })
    expect(() => Config({ maxStatusLength: 0 })).toThrow()
    expect(() => Config({ busyTimeoutMs: 1.5 })).toThrow()
    expect(() => Config({ databasePath: '   ' })).toThrow()

    const ctx = new Context()
    contexts.push(ctx)
    expect(() => new WorkbenchService(ctx, { maxStatusLength: 0 })).toThrow()
  })
})
