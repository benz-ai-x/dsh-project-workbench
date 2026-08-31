// @vitest-environment jsdom

import type {
  WorkbenchActivityFilter,
  WorkbenchActivityItem,
  WorkbenchActivityProjection,
  WorkbenchAuditIntegrityProjection,
  WorkbenchOutboxState,
} from '@benz-ai-x/dsh-project-workbench/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_WORKBENCH_ACTIVITY_STATE,
  type WorkbenchActivityClientState,
  type WorkbenchActivityControllerFace,
} from '../src/client/activity-controller.ts'
import {
  ActivityPanel,
  DEFAULT_ACTIVITY_PANEL_COPY,
} from '../src/client/ActivityPanel.tsx'

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function item(
  sequence: number,
  state: WorkbenchOutboxState,
): WorkbenchActivityItem {
  return {
    sequence,
    eventId: `audit-${sequence}`,
    occurredAt: `2026-08-31T0${sequence}:00:00.000Z`,
    actor: { kind: 'owner', id: `owner-${sequence}` },
    projectId: sequence % 2 === 0 ? `project-${sequence}` : null,
    action: 'workbench.status.updated',
    reason: 'owner-status-edit',
    object: { type: 'workbench-status', id: `status-${sequence}`, version: sequence },
    causationId: `causation-${sequence}`,
    commandId: `command-${sequence}`,
    summaryCode: 'status-revision-committed',
    hash: `safe-hash-${sequence}`,
    previousHash: sequence === 1 ? '' : `safe-hash-${sequence - 1}`,
    outbox: {
      id: `outbox-${sequence}`,
      state,
      attemptCount: sequence - 1,
      updatedAt: `2026-08-31T0${sequence}:01:00.000Z`,
      errorCode: state === 'failed' ? 'definitive-rejection' : null,
    },
  }
}

function projectItem(): WorkbenchActivityItem {
  return {
    ...item(5, 'pending'),
    projectId: 'project-5',
    action: 'workbench.project.created',
    reason: 'owner-project-create',
    object: { type: 'project', id: 'project-5', version: 1 },
    summaryCode: 'project-created-from-template',
  }
}

function projectTeamItems(): readonly WorkbenchActivityItem[] {
  return [
    {
      ...item(6, 'delivered'),
      projectId: 'project-6',
      action: 'workbench.project-member.created',
      reason: 'owner-project-member-add',
      object: { type: 'project-member', id: 'member-6', version: 1 },
      summaryCode: 'project-member-created',
    },
    {
      ...item(7, 'delivered'),
      projectId: 'project-6',
      action: 'workbench.project-member.status-changed',
      reason: 'owner-project-member-status-change',
      object: { type: 'project-member', id: 'member-6', version: 2 },
      summaryCode: 'project-member-status-changed',
    },
    {
      ...item(8, 'delivered'),
      projectId: 'project-6',
      action: 'workbench.project.responsibility-assigned',
      reason: 'owner-project-responsibility-set',
      object: { type: 'project-responsibility', id: 'project-6', version: 1 },
      summaryCode: 'project-responsibility-assigned',
    },
  ]
}

function ready(
  items: readonly WorkbenchActivityItem[] = [],
  integrity: WorkbenchAuditIntegrityProjection = {
    valid: true,
    eventCount: items.length,
    headHash: items.at(-1)?.hash ?? '',
    issue: null,
  },
  nextBeforeSequence: number | null = null,
  loadingMore = false,
): WorkbenchActivityClientState {
  const activity: WorkbenchActivityProjection = {
    items,
    nextBeforeSequence,
    integrity,
  }
  return Object.freeze({
    phase: 'ready',
    filter: Object.freeze({}),
    activity,
    integrity: activity.integrity,
    loadingMore,
    issue: null,
  })
}

class PanelController implements WorkbenchActivityControllerFace {
  private listeners = new Set<() => void>()
  readonly refresh = vi.fn(() => Promise.resolve())
  readonly setFilter = vi.fn((_filter: WorkbenchActivityFilter) => Promise.resolve())
  readonly loadMore = vi.fn(() => Promise.resolve())

  constructor(private state: WorkbenchActivityClientState) {}

  readonly getSnapshot = (): WorkbenchActivityClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(state: WorkbenchActivityClientState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

describe('ActivityPanel', () => {
  it('renders loading, empty, stale, and safe error states accessibly', () => {
    const controller = new PanelController(INITIAL_WORKBENCH_ACTIVITY_STATE)
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    expect(screen.getByRole('region', { name: 'Activity' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Loading activity…').getAttribute('role')).toBe('status')

    act(() => {
      controller.publish(Object.freeze({
        ...INITIAL_WORKBENCH_ACTIVITY_STATE,
        phase: 'stale',
      }))
    })
    expect(screen.getByText(/may be out of date/u)).toBeTruthy()
    expect(screen.queryByText('No matching activity')).toBeNull()

    act(() => { controller.publish(ready()) })
    expect(screen.getByText('No matching activity')).toBeTruthy()
    expect(screen.getByText('Audit chain verified')).toBeTruthy()

    act(() => { controller.publish(Object.freeze({ ...ready(), phase: 'stale' })) })
    expect(screen.getByText(/may be out of date/u)).toBeTruthy()

    act(() => {
      controller.publish(Object.freeze({
        ...ready(),
        phase: 'error',
        issue: Object.freeze({ kind: 'transport', code: 'unavailable' }),
      }))
    })
    expect(screen.getByRole('alert').textContent).toContain('Activity is unavailable')
    expect(screen.queryByText('No matching activity')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }))
    expect(controller.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByText('unavailable')).toBeNull()
  })

  it('renders a correctable input rejection without offering a transport retry', () => {
    const controller = new PanelController(Object.freeze({
      ...ready(),
      phase: 'error',
      issue: Object.freeze({ kind: 'input', code: 'bad-request' }),
    }))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    expect(screen.getByRole('alert').textContent).toContain('The activity filter is invalid')
    expect(screen.getByRole('alert').textContent).toContain('valid bounded Project or object identifier')
    expect(screen.queryByRole('button', { name: 'Retry activity' })).toBeNull()
    expect(screen.getByLabelText('Project ID').getAttribute('maxlength')).toBe('128')
    expect(screen.getByLabelText('Object ID').getAttribute('maxlength')).toBe('128')
  })

  it('shows integrity failure and all four redacted Outbox states without payload data', () => {
    const states: WorkbenchOutboxState[] = ['pending', 'delivered', 'unknown', 'failed']
    const unsafeItems = states.map((state, index) => ({
      ...item(index + 1, state),
      payload: `secret-payload-${state}`,
      rawAdapterError: `secret-adapter-${state}`,
    })) as unknown as readonly WorkbenchActivityItem[]
    const controller = new PanelController(ready(unsafeItems, {
      valid: false,
      eventCount: 4,
      headHash: 'visible-safe-head',
      issue: 'event-hash-mismatch',
    }))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    expect(screen.getByRole('alert').textContent).toContain('Audit chain verification failed')
    expect(screen.getByText('visible-safe-head')).toBeTruthy()
    for (const label of ['Pending', 'Delivered', 'Outcome unknown', 'Failed']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getAllByText('Status revision committed')).toHaveLength(4)
    expect(document.body.textContent).not.toMatch(/secret-payload|secret-adapter|rawAdapterError/u)
    expect(document.querySelectorAll('[data-outbox-state]')).toHaveLength(4)
  })

  it('applies project, object, and action filters as a new whole-page request', () => {
    const controller = new PanelController(ready([item(1, 'pending')]))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    fireEvent.change(screen.getByLabelText('Project scope'), {
      target: { value: 'project' },
    })
    expect((screen.getByLabelText('Project ID') as HTMLInputElement).required).toBe(true)
    fireEvent.change(screen.getByLabelText('Project ID'), {
      target: { value: ' project-safe ' },
    })
    fireEvent.change(screen.getByLabelText('Object type'), {
      target: { value: 'workbench-status' },
    })
    fireEvent.change(screen.getByLabelText('Object ID'), {
      target: { value: ' status-safe ' },
    })
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'workbench.status.updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    expect(controller.setFilter).toHaveBeenCalledWith({
      projectId: 'project-safe',
      objectType: 'workbench-status',
      objectId: 'status-safe',
      action: 'workbench.status.updated',
    })

    fireEvent.change(screen.getByLabelText('Project scope'), {
      target: { value: 'workspace' },
    })
    expect((screen.getByLabelText('Project ID') as HTMLInputElement).required).toBe(false)
    fireEvent.change(screen.getByLabelText('Object type'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Object ID'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(controller.setFilter).toHaveBeenLastCalledWith({ projectId: null })
  })

  it('renders and filters the allowlisted Project-created Activity vocabulary', () => {
    const controller = new PanelController(ready([projectItem()]))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    expect(screen.getByText('Project created from template')).toBeTruthy()
    expect(screen.getByText('Owner Project creation')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Object type'), { target: { value: 'project' } })
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'workbench.project.created' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    expect(controller.setFilter).toHaveBeenCalledWith({
      objectType: 'project',
      action: 'workbench.project.created',
    })
  })

  it('renders and filters the allowlisted Project Team Activity vocabulary', () => {
    const controller = new PanelController(ready(projectTeamItems()))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    expect(screen.getByText('ProjectMember added')).toBeTruthy()
    expect(screen.getByText('ProjectMember status changed')).toBeTruthy()
    expect(screen.getByText('Project Responsibility replaced')).toBeTruthy()
    expect(screen.getByText('Owner ProjectMember addition')).toBeTruthy()
    expect(screen.getByText('Owner ProjectMember status change')).toBeTruthy()
    expect(screen.getByText('Owner Project Responsibility assignment')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Object type'), {
      target: { value: 'project-responsibility' },
    })
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'workbench.project.responsibility-assigned' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    expect(controller.setFilter).toHaveBeenCalledWith({
      objectType: 'project-responsibility',
      action: 'workbench.project.responsibility-assigned',
    })
  })

  it('loads the next cursor page once and exposes its pending state accessibly', () => {
    const firstItem = item(2, 'pending')
    const controller = new PanelController(ready([firstItem], undefined, 2))
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    const region = screen.getByRole('region', { name: 'Activity' })
    const loadMore = screen.getByRole('button', { name: 'Load older activity' })
    expect((loadMore as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(loadMore)
    expect(controller.loadMore).toHaveBeenCalledOnce()

    act(() => { controller.publish(ready([firstItem], undefined, 2, true)) })
    const pending = screen.getByRole('button', { name: 'Loading older activity…' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    expect(region.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(pending)
    expect(controller.loadMore).toHaveBeenCalledOnce()

    act(() => { controller.publish(ready([firstItem, item(1, 'delivered')])) })
    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull()
    expect(region.getAttribute('aria-busy')).toBe('false')
  })

  it('announces the appended count and restores focus to the heading after the final page', async () => {
    const completion = deferred<void>()
    const firstItem = item(3, 'pending')
    const controller = new PanelController(ready([firstItem], undefined, 3))
    controller.loadMore.mockImplementationOnce(() => completion.promise)
    render(<ActivityPanel controller={controller} copy={DEFAULT_ACTIVITY_PANEL_COPY} />)

    const loadMore = screen.getByRole('button', { name: 'Load older activity' })
    loadMore.focus()
    expect(document.activeElement).toBe(loadMore)
    fireEvent.click(loadMore)
    act(() => {
      controller.publish(ready([firstItem, item(2, 'delivered'), item(1, 'failed')]))
    })
    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull()

    await act(async () => {
      completion.resolve()
      await completion.promise
    })

    const heading = screen.getByRole('heading', { name: 'Activity' })
    expect(document.activeElement).toBe(heading)
    expect(document.activeElement).not.toBe(document.body)
    const announcement = screen.getByText(
      'Loaded 2 older entries; 3 entries are now shown. All matching activity is loaded.',
    )
    expect(announcement.getAttribute('role')).toBe('status')
    expect(announcement.getAttribute('aria-live')).toBe('polite')
    expect(announcement.getAttribute('aria-atomic')).toBe('true')
  })
})
