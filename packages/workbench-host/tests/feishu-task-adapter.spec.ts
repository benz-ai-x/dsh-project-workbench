import type {
  CredentialInfo,
  CredentialProvider,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import type { WorkbenchFeishuTaskRoute } from '../src/feishu-task-federation.ts'
import {
  DshFeishuConnectionAdapter,
  type FeishuFetch,
} from '../src/feishu-connection-adapter.ts'

const APP_ID = 'cli_workbench_fixture'
const USER_TOKEN = 'user-token-SENTINEL'
const IDEMPOTENCY_KEY = 'task-command-00000001'
const FIXED_NOW = new Date('2026-08-31T00:00:00.000Z')

interface CredentialHarness {
  readonly provider: CredentialProvider
  readonly refs: string[]
  readonly values: Map<string, ResolvedCredential | undefined>
}

function credentials(): CredentialHarness {
  const refs: string[] = []
  const values = new Map<string, ResolvedCredential | undefined>()
  const provider = {
    resolve: async (ref: string) => {
      refs.push(ref)
      return values.get(ref)
    },
    describe: async (): Promise<CredentialInfo> => ({ configured: true, writable: false }),
  } as unknown as CredentialProvider
  return { provider, refs, values }
}

function route(openId = 'ou_owner_fixture'): WorkbenchFeishuTaskRoute {
  return Object.freeze({
    kind: 'user',
    routeGeneration: 1,
    appId: APP_ID,
    credentialRef: 'FEISHU_USER_TOKEN',
    actor: Object.freeze({
      connectionId: 'feishu-primary',
      realm: 'feishu-cn',
      appId: APP_ID,
      kind: 'user',
      routeGeneration: 1,
      openId,
      tenantKey: 'tenant_fixture',
    }),
  })
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

function identity(openId = 'ou_owner_fixture'): Response {
  return json({
    code: 0,
    data: { open_id: openId, tenant_key: 'tenant_fixture', name: 'Owner' },
  })
}

function providerPage(items: readonly unknown[], pageToken?: string): Response {
  return json({
    code: 0,
    data: {
      items,
      has_more: pageToken !== undefined,
      ...(pageToken === undefined ? {} : { page_token: pageToken }),
    },
  })
}

function task(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    guid: 'task-parent',
    task_id: '42',
    parent_task_guid: null,
    summary: 'Ship workbench',
    description: 'Deliver the integrated workspace',
    members: [
      { id: 'ou_assignee', type: 'user', role: 'assignee', name: 'Assignee' },
      { id: 'ou_follower', type: 'user', role: 'follower', name: 'Follower' },
      { id: 'cli_ignored', type: 'app', role: 'follower', name: 'Ignored app' },
    ],
    completed_at: '0',
    status: 'todo',
    url: 'https://applink.feishu.cn/client/todo/detail?guid=task-parent',
    updated_at: '100',
    subtask_count: 0,
    ...overrides,
  }
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url)
}

function method(init: RequestInit | undefined): string {
  return init?.method ?? 'GET'
}

function authorize(init: RequestInit | undefined): void {
  expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${USER_TOKEN}`)
  expect(init?.redirect).toBe('error')
}

describe('DshFeishuConnectionAdapter task federation', () => {
  it('paginates selectable lists and sends the provider-supported create idempotency token', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const calls: string[] = []
    let listPage = 0
    let createCalls = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      calls.push(`${method(init)} ${url.pathname}${url.search}`)
      if (url.pathname.endsWith('/authen/v1/user_info')) return identity()
      authorize(init)
      if (url.pathname === '/open-apis/task/v2/tasklists' && method(init) === 'GET') {
        expect(url.searchParams.get('page_size')).toBe('50')
        expect(url.searchParams.get('user_id_type')).toBe('open_id')
        listPage += 1
        if (listPage === 1) {
          expect(url.searchParams.has('page_token')).toBe(false)
          return providerPage([{
            guid: 'list-a',
            name: 'Alpha',
            url: 'https://applink.feishu.cn/client/todo/list-a',
            updated_at: '10',
          }], 'next-page')
        }
        expect(url.searchParams.get('page_token')).toBe('next-page')
        return providerPage([{
          guid: 'list-b',
          name: 'Beta',
          url: 'https://applink.feishu.cn/client/todo/list-b',
          updated_at: '11',
        }])
      }
      if (url.pathname === '/open-apis/task/v2/tasklists' && method(init) === 'POST') {
        createCalls += 1
        expect(url.searchParams.get('user_id_type')).toBe('open_id')
        expect(JSON.parse(String(init?.body))).toEqual({
          name: 'Project Workbench',
          client_token: IDEMPOTENCY_KEY,
        })
        return json({
          code: 0,
          data: {
            tasklist: {
              guid: 'list-created',
              name: 'Project Workbench',
              url: 'https://applink.feishu.cn/client/todo/list-created',
              updated_at: '12',
            },
          },
        })
      }
      return json({ code: 1 }, { status: 400 })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, { fetch: request })
    const signal = new AbortController().signal

    await expect(adapter.listTaskLists(route(), signal)).resolves.toEqual({
      state: 'ok',
      value: [
        {
          taskListGuid: 'list-a',
          name: 'Alpha',
          canonicalUrl: 'https://applink.feishu.cn/client/todo/list-a',
          remoteVersion: '10',
        },
        {
          taskListGuid: 'list-b',
          name: 'Beta',
          canonicalUrl: 'https://applink.feishu.cn/client/todo/list-b',
          remoteVersion: '11',
        },
      ],
    })
    await expect(adapter.createTaskList(route(), {
      name: 'Project Workbench',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, signal)).resolves.toMatchObject({
      state: 'ok',
      value: { taskListGuid: 'list-created', remoteVersion: '12' },
    })

    expect(store.refs).toEqual(['FEISHU_USER_TOKEN', 'FEISHU_USER_TOKEN'])
    expect(createCalls).toBe(1)
    expect(calls.filter(call => call.includes('/authen/v1/user_info'))).toHaveLength(2)
    expect(calls.some(call => call.includes('/bot/v3/info'))).toBe(false)
  })

  it('builds a bounded full projection with nested subtasks, roles, comments, and canonical links', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    const paths: string[] = []
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      paths.push(url.pathname)
      if (url.pathname.endsWith('/authen/v1/user_info')) return identity()
      authorize(init)
      if (url.pathname === '/open-apis/task/v2/tasklists/list-primary') {
        return json({
          code: 0,
          data: {
            tasklist: {
              guid: 'list-primary',
              name: 'Primary list',
              url: 'https://applink.feishu.cn/client/todo/list-primary',
              updated_at: '20',
            },
          },
        })
      }
      if (url.pathname === '/open-apis/task/v2/tasklists/list-primary/tasks') {
        return providerPage([{ guid: 'task-parent', subtask_count: 1 }])
      }
      if (url.pathname === '/open-apis/task/v2/tasks/task-parent') {
        return json({ code: 0, data: { task: task({ subtask_count: 1 }) } })
      }
      if (url.pathname === '/open-apis/task/v2/tasks/task-parent/subtasks') {
        return providerPage([task({
          guid: 'task-child',
          task_id: '43',
          parent_task_guid: 'task-parent',
          summary: 'Child task',
          members: [],
          url: 'https://applink.feishu.cn/client/todo/detail?guid=task-child',
          updated_at: '101',
        })])
      }
      if (url.pathname === '/open-apis/task/v2/comments') {
        expect(url.searchParams.get('resource_type')).toBe('task')
        expect(url.searchParams.get('direction')).toBe('asc')
        const guid = url.searchParams.get('resource_id')
        return guid === 'task-parent'
          ? providerPage([{
            id: 'comment-1',
            content: 'Ready to ship',
            creator: { id: 'ou_reviewer', type: 'user', name: 'Reviewer' },
            reply_to_comment_id: null,
            created_at: '1788134400000',
            updated_at: '1788134401000',
          }])
          : providerPage([])
      }
      return json({ code: 1 }, { status: 400 })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })

    const result = await adapter.readTaskList(
      route(),
      'list-primary',
      new AbortController().signal,
    )

    expect(result).toMatchObject({
      state: 'ok',
      value: {
        taskList: { taskListGuid: 'list-primary', remoteVersion: '20' },
        observedAt: FIXED_NOW.toISOString(),
        tasks: [
          {
            taskGuid: 'task-parent',
            parentTaskGuid: null,
            assignees: [{ openId: 'ou_assignee', name: 'Assignee' }],
            followers: [{ openId: 'ou_follower', name: 'Follower' }],
            comments: [{
              commentId: 'comment-1',
              creator: { openId: 'ou_reviewer', name: 'Reviewer' },
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:00:01.000Z',
            }],
            completed: false,
            completedAt: null,
            remoteVersion: '100',
          },
          {
            taskGuid: 'task-child',
            parentTaskGuid: 'task-parent',
            summary: 'Child task',
            comments: [],
            remoteVersion: '101',
          },
        ],
      },
    })
    expect(paths.filter(path => path === '/open-apis/task/v2/tasks/task-child')).toHaveLength(0)
    expect(paths.filter(path => path === '/open-apis/task/v2/comments')).toHaveLength(2)
  })

  it('checks the opaque remote version before one PATCH and reports later conflicts without writing', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let currentVersion = '100'
    let patchCalls = 0
    const request: FeishuFetch = async (input, init) => {
      const url = requestUrl(input)
      if (url.pathname.endsWith('/authen/v1/user_info')) return identity()
      authorize(init)
      if (url.pathname === '/open-apis/task/v2/comments') return providerPage([])
      if (url.pathname === '/open-apis/task/v2/tasks/task-parent' && method(init) === 'GET') {
        return json({ code: 0, data: { task: task({ updated_at: currentVersion }) } })
      }
      if (url.pathname === '/open-apis/task/v2/tasks/task-parent' && method(init) === 'PATCH') {
        patchCalls += 1
        const body = JSON.parse(String(init?.body)) as {
          task: { completed_at: string }
          update_fields: string[]
        }
        expect(body).toEqual({
          task: { completed_at: String(FIXED_NOW.getTime()) },
          update_fields: ['completed_at'],
        })
        currentVersion = '101'
        return json({
          code: 0,
          data: {
            task: task({
              completed_at: String(FIXED_NOW.getTime()),
              status: 'done',
              updated_at: currentVersion,
            }),
          },
        })
      }
      return json({ code: 1 }, { status: 400 })
    }
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: request,
      now: () => FIXED_NOW,
    })
    const signal = new AbortController().signal

    await expect(adapter.updateTask(route(), {
      taskGuid: 'task-parent',
      expectedRemoteVersion: '100',
      idempotencyKey: IDEMPOTENCY_KEY,
      changes: { completed: true },
    }, signal)).resolves.toMatchObject({
      state: 'ok',
      value: {
        taskGuid: 'task-parent',
        completed: true,
        completedAt: FIXED_NOW.toISOString(),
        remoteVersion: '101',
      },
    })
    await expect(adapter.updateTask(route(), {
      taskGuid: 'task-parent',
      expectedRemoteVersion: '100',
      idempotencyKey: 'task-command-00000002',
      changes: { summary: 'Stale write' },
    }, signal)).resolves.toMatchObject({
      state: 'conflict',
      current: { taskGuid: 'task-parent', remoteVersion: '101' },
    })
    expect(patchCalls).toBe(1)
  })

  it('never retries an ambiguous PATCH and rejects identity drift before task access', async () => {
    const store = credentials()
    store.values.set('FEISHU_USER_TOKEN', { value: USER_TOKEN, source: 'env' })
    let patchCalls = 0
    let taskCalls = 0
    const adapter = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input, init) => {
        const url = requestUrl(input)
        if (url.pathname.endsWith('/authen/v1/user_info')) return identity()
        authorize(init)
        taskCalls += 1
        if (url.pathname === '/open-apis/task/v2/comments') return providerPage([])
        if (method(init) === 'GET') return json({ code: 0, data: { task: task() } })
        patchCalls += 1
        throw new Error('connection lost after dispatch')
      },
      now: () => FIXED_NOW,
    })

    await expect(adapter.updateTask(route(), {
      taskGuid: 'task-parent',
      expectedRemoteVersion: '100',
      idempotencyKey: IDEMPOTENCY_KEY,
      changes: { summary: 'Possibly written' },
    }, new AbortController().signal)).resolves.toMatchObject({
      state: 'unknown',
      issue: { code: 'provider-unavailable', recovery: 'retry-later' },
    })
    expect(patchCalls).toBe(1)
    const taskCallsBeforeDrift = taskCalls

    const drifted = new DshFeishuConnectionAdapter(store.provider, {
      fetch: async (input) => requestUrl(input).pathname.endsWith('/authen/v1/user_info')
        ? identity('ou_different_owner')
        : (taskCalls += 1, json({ code: 0 })),
    })
    await expect(drifted.readTask(route(), 'task-parent', new AbortController().signal))
      .resolves.toMatchObject({
        state: 'rejected',
        issue: {
          code: 'identity-continuity-mismatch',
          recovery: 'reset-identity-binding',
        },
      })
    expect(taskCalls).toBe(taskCallsBeforeDrift)

    const staleGeneration = Object.freeze({ ...route(), routeGeneration: 2 })
    await expect(drifted.readTask(
      staleGeneration,
      'task-parent',
      new AbortController().signal,
    )).rejects.toThrow(/verified actor route is invalid/u)
  })
})
