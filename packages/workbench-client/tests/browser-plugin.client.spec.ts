// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/src/client/registry.ts'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchStatusSnapshot } from '@benz-ai-x/dsh-project-workbench/client'
import { WorkbenchStatusPage } from '../src/client/WorkbenchStatusPage.tsx'
import {
  mountWorkbenchClient,
  uiInject,
  WORKBENCH_SLOT_PRIORITY,
} from '../src/client/mount.ts'
import { inject as browserInject } from '../src/client/index.ts'
import * as nodePlugin from '../src/index.ts'

const REMOTE: TypertRemoteContribution = {
  package: '@benz-ai-x/dsh-project-workbench',
  descriptors: [],
}

function status(): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message: 'Host-backed status',
    revision: 1,
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

type WorkbenchRemoteSnapshot = (
  signal?: AbortSignal,
) => Promise<{ readonly ok: true; readonly value: WorkbenchStatusSnapshot }>

async function bench(options: {
  registrationFailure?: boolean
  snapshot?: WorkbenchRemoteSnapshot
} = {}) {
  const ctx = new Context()
  const order: string[] = []
  let generation: { id: number; host: { home: string } } | undefined = {
    id: 1,
    host: { home: '/tmp' },
  }
  const generationListeners = new Set<() => void>()
  const snapshotGate = vi.fn(options.snapshot ?? (() => Promise.resolve({
    ok: true as const,
    value: status(),
  })))

  class RemoteService extends Service {
    readonly disposeMount = vi.fn(async () => {
      order.push('remote')
      expect(ctx.slots.entries('conversation')).toHaveLength(0)
    })
    readonly mount = vi.fn(async (_contribution: TypertRemoteContribution) => this.disposeMount)

    constructor(serviceContext: Context) {
      super(serviceContext, 'remote')
    }

    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
      return this.mount(contribution)
    }
  }

  const remote = new RemoteService(ctx)
  ctx.provide('remote.workbench', {
    snapshot: snapshotGate,
    setStatus: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: true as const, value: status() },
    })),
  })
  ctx.provide('connection', {
    isLoopback: true,
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        generationListeners.add(listener)
        return () => { generationListeners.delete(listener) }
      },
    },
  } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const disposeLayout = ctx.slots.register({
    name: 'root',
    children: {
      conversation: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, (() => null) as never)

  if (options.registrationFailure === true) {
    vi.spyOn(ctx.slots, 'register').mockImplementationOnce(() => {
      throw new Error('Workbench slot registration failed')
    })
  }

  const fiber = options.registrationFailure === true
    ? undefined
    : ctx.plugin({
      inject: [...browserInject],
      apply: clientContext => mountWorkbenchClient(clientContext, REMOTE),
    })
  if (fiber !== undefined) await fiber.await()

  return {
    ctx,
    fiber,
    remote,
    order,
    snapshotGate,
    disposeLayout,
    disconnect() {
      generation = undefined
      for (const listener of generationListeners) listener()
    },
    reconnect() {
      generation = { id: 2, host: { home: '/tmp' } }
      for (const listener of generationListeners) listener()
      ctx.emit('connection/reset')
    },
  }
}

describe('Project Workbench browser plugin lifecycle', () => {
  it('mounts Remote first and registers a disposable -100 conversation replacement, never root', async () => {
    const b = await bench()
    expect(browserInject).toEqual(['remote'])
    expect(uiInject).toEqual(['remote.workbench', 'slots', 'locale', 'connection'])
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.mount).toHaveBeenCalledWith(REMOTE)

    const entries = b.ctx.slots.entries('conversation')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      component: WorkbenchStatusPage,
      options: { priority: WORKBENCH_SLOT_PRIORITY },
      locale: 'workbench',
    })
    expect(b.ctx.slots.entries('root')).toHaveLength(1)
    const injected = (entries[0]?.inject as (() => { controller: { getSnapshot(): unknown } }))()
    await vi.waitFor(() => {
      expect(injected.controller.getSnapshot()).toMatchObject({ phase: 'value', snapshot: status() })
    })

    await b.fiber?.dispose()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
    expect(b.order).toEqual(['remote'])

    const replacement = b.ctx.plugin({
      inject: [...browserInject],
      apply: clientContext => mountWorkbenchClient(clientContext, REMOTE),
    })
    await replacement.await()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(1)
    expect(b.remote.mount).toHaveBeenCalledTimes(2)
    await replacement.dispose()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
    expect(b.remote.disposeMount).toHaveBeenCalledTimes(2)
    expect(b.order).toEqual(['remote', 'remote'])
  })

  it('marks the last projection stale on disconnect and refreshes on connection/reset', async () => {
    const b = await bench()
    const entry = b.ctx.slots.entries('conversation')[0]
    const controller = (entry?.inject as (() => { controller: {
      getSnapshot(): { phase: string; snapshot: WorkbenchStatusSnapshot | null }
    } }))().controller
    await vi.waitFor(() => { expect(controller.getSnapshot().phase).toBe('value') })

    b.disconnect()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'stale', snapshot: status() })
    b.reconnect()
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({ phase: 'value', snapshot: status() })
    })
    expect(b.snapshotGate).toHaveBeenCalledTimes(2)
    await b.fiber?.dispose()
  })

  it('rolls back the mounted Remote when later Slot setup fails', async () => {
    const b = await bench({ registrationFailure: true })
    await expect(mountWorkbenchClient(b.ctx, REMOTE)).rejects.toThrow('Workbench slot registration failed')
    expect(b.remote.mount).toHaveBeenCalledOnce()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
    expect(b.ctx.slots.entries('conversation')).toHaveLength(0)
  })

  it('drains an aborted UI snapshot before withdrawing the Remote namespace', async () => {
    const order: string[] = []
    let signal: AbortSignal | undefined
    const b = await bench({
      snapshot: currentSignal => new Promise((_resolve, reject) => {
        signal = currentSignal
        currentSignal?.addEventListener('abort', () => {
          order.push('snapshot-settled')
          reject(currentSignal.reason)
        }, { once: true })
      }),
    })
    b.remote.disposeMount.mockImplementationOnce(async () => {
      order.push('remote')
      expect(signal?.aborted).toBe(true)
    })

    await b.fiber?.dispose()

    expect(order).toEqual(['snapshot-settled', 'remote'])
  })

  it('keeps the Node half named-only and the manifest discoverable as a web Client package', async () => {
    expect(() => { nodePlugin.apply() }).not.toThrow()
    expect('default' in nodePlugin).toBe(false)

    const packageRoot = basename(process.cwd()) === 'workbench-client'
      ? process.cwd()
      : resolve(process.cwd(), 'packages/workbench-client')
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      private?: boolean
      exports?: Record<string, unknown>
      dsh?: { client?: { platform?: string; inject?: string[] } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.dsh?.client).toMatchObject({
      platform: 'web',
      inject: expect.arrayContaining([
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-connection',
        '@deepseek-ai/dsh-client-ui-layout',
      ]),
    })

    const config = await readFile(resolve(packageRoot, 'tsdown.client.config.ts'), 'utf8')
    expect(config).toContain('window.__ModuleLoader__.load')
    expect(config).toContain('factory: (require) =>')
    expect(config).not.toContain("from '../deepseek-harness")
  })
})
