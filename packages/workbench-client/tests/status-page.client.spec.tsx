// @vitest-environment jsdom

import type { SetStatusResult, WorkbenchStatusSnapshot } from '@benz-ai-x/dsh-project-workbench/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { WorkbenchStatusController, type WorkbenchRemote } from '../src/client/controller.ts'
import { WorkbenchStatusPage } from '../src/client/WorkbenchStatusPage.tsx'
import { zh, type WorkbenchKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: WorkbenchKey): string => zh[key]

function snapshot(revision: number, message: string): WorkbenchStatusSnapshot {
  return {
    id: 'status-1',
    message,
    revision,
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

async function renderPage(remote: WorkbenchRemote) {
  const controller = new WorkbenchStatusController(remote)
  const view = render(<WorkbenchStatusPage controller={controller} t={t} />)
  await act(async () => { await controller.refresh() })
  return { controller, ...view }
}

describe('WorkbenchStatusPage', () => {
  it('renders an accessible ready-empty editor and supports the keyboard save path', async () => {
    const mutation = deferred<RemoteResult<SetStatusResult>>()
    const setStatus = vi.fn(() => mutation.promise)
    await renderPage({
      snapshot: vi.fn(() => Promise.resolve(ok(null))),
      setStatus,
    })

    expect(screen.getByRole('main', { name: '让项目状态始终清晰可见' })).toBeTruthy()
    expect(screen.getByText('从一条简短状态开始')).toBeTruthy()
    const editor = screen.getByRole('textbox', { name: '项目状态' })
    const save = screen.getByRole('button', { name: '保存状态' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(editor, { target: { value: '准备第一个里程碑' } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(setStatus).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: '保存中…' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      mutation.resolve(ok({ ok: true, value: snapshot(1, '准备第一个里程碑') }))
      await mutation.promise
    })
    expect(screen.getByText('已与 Host 同步')).toBeTruthy()
    expect(screen.getAllByText('准备第一个里程碑')).toHaveLength(2)
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('preserves the typed draft through a conflict and retries on the displayed Host revision', async () => {
    const setStatus = vi.fn()
      .mockResolvedValueOnce(ok({
        ok: false,
        error: {
          code: 'revision-conflict',
          message: 'stale',
          current: snapshot(2, '来自其他窗口'),
        },
      } satisfies SetStatusResult))
      .mockResolvedValueOnce(ok({
        ok: true,
        value: snapshot(3, '保留我的草稿'),
      } satisfies SetStatusResult))
    await renderPage({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(1, '初始状态')))),
      setStatus,
    })
    const editor = screen.getByRole('textbox', { name: '项目状态' })
    fireEvent.change(editor, { target: { value: '保留我的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存状态' }))

    expect((await screen.findByRole('alert')).textContent).toContain('发现更新冲突')
    expect(screen.queryByText('stale')).toBeNull()
    expect((editor as HTMLTextAreaElement).value).toBe('保留我的草稿')
    expect(screen.getByText('来自其他窗口')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存状态' }))
    expect(setStatus.mock.calls[1]?.[0]).toEqual({
      message: '保留我的草稿',
      expectedRevision: 2,
    })
    expect(await screen.findByText('已与 Host 同步')).toBeTruthy()
  })

  it('keeps transport errors separate, retains drafts, retries, and restores with Escape', async () => {
    const snapshotRemote = vi.fn()
      .mockResolvedValueOnce(ok(snapshot(1, '已同步内容')))
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'unavailable', message: 'offline', details: {} },
      })
      .mockResolvedValueOnce(ok(snapshot(2, '恢复后的内容')))
    const { controller } = await renderPage({
      snapshot: snapshotRemote,
      setStatus: vi.fn(() => Promise.resolve(ok({ ok: true, value: snapshot(2, 'unused') }))),
    })
    const editor = screen.getByRole('textbox', { name: '项目状态' })
    fireEvent.change(editor, { target: { value: '离线草稿' } })
    await act(async () => { await controller.refresh() })

    expect(screen.getByRole('alert').textContent).toContain('无法连接到 Project Workbench')
    expect(screen.queryByText(/offline|unavailable/u)).toBeNull()
    expect((editor as HTMLTextAreaElement).value).toBe('离线草稿')
    fireEvent.click(screen.getByRole('button', { name: '重新同步' }))
    expect(await screen.findByText('恢复后的内容')).toBeTruthy()
    expect((editor as HTMLTextAreaElement).value).toBe('离线草稿')

    fireEvent.keyDown(editor, { key: 'Escape' })
    expect((editor as HTMLTextAreaElement).value).toBe('恢复后的内容')
  })

  it('shows an actionable input rejection without claiming that the connection failed', async () => {
    await renderPage({
      snapshot: vi.fn(() => Promise.resolve(ok(snapshot(1, '已同步内容')))),
      setStatus: vi.fn(() => Promise.resolve({
        ok: false,
        error: {
          code: 'bad-request',
          message: 'status exceeds configured limit',
          details: { configuredLimit: 3 },
        },
      })),
    })
    const editor = screen.getByRole('textbox', { name: '项目状态' })
    fireEvent.change(editor, { target: { value: '需要用户调整的内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存状态' }))

    expect((await screen.findByRole('alert')).textContent).toContain('状态未保存')
    expect(screen.queryByText('无法连接到 Project Workbench')).toBeNull()
    expect(screen.queryByText(/configured limit|exceeds/u)).toBeNull()
    expect((editor as HTMLTextAreaElement).value).toBe('需要用户调整的内容')
    expect((screen.getByRole('button', { name: '保存状态' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
