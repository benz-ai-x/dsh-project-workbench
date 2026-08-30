/**
 * Minimal injected-service fixture for the built Owner auth Loader boundary.
 * State lives with this dependency Fiber, so it survives auth-provider HMR.
 */

export const name = 'owner-auth-dependencies-fixture'

export function apply(ctx) {
  let record
  const routes = new Map()
  ctx.provide('credentials', {
    readRecord: async () => record,
    modifyRecord: async (_key, mutation) => {
      const next = await mutation(record)
      if (next !== undefined) record = structuredClone(next)
      return record === undefined ? undefined : structuredClone(record)
    },
  })
  ctx.provide('webServer', {
    register: route => {
      const key = `${route.kind}:${route.path}`
      if (routes.has(key)) throw new Error(`duplicate fixture route ${key}`)
      routes.set(key, route)
      return () => { routes.delete(key) }
    },
  })
  ctx.provide('connection', {
    requestRejection: () => undefined,
    createSharedFetchHandler: () => ({
      fetch: async () => new Response('shared Workbench API', { status: 418 }),
    }),
  })
  ctx.provide('ownerAuthDependencies', {
    routes,
    route(pathname) {
      return [...routes.values()]
        .filter(route => route.kind === 'exact'
          ? route.path === pathname
          : route.path === pathname || pathname.startsWith(`${route.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]
    },
  })
}
