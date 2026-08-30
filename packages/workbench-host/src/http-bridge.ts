/** Workbench-owned node:http to Fetch bridge and route-drain lifecycle. */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

/** Transport-independent handler used behind the Workbench HTTP perimeter. */
export interface WorkbenchFetchHandler {
  fetch(request: Request): Promise<Response>
}

/** Failure statuses produced before a Fetch request can be dispatched. */
export type WorkbenchBridgeRequestFailureStatus = 400 | 413

export interface WorkbenchHttpBridgeOptions {
  readonly maxRequestBodyBytes: number
  readonly signal: AbortSignal
  readonly noStore?: boolean
  readonly requestFailure?: (status: WorkbenchBridgeRequestFailureStatus) => Response
}

type RouteAdmissionPhase = 'accepting' | 'closing' | 'closed'

/**
 * Owns admission and quiescence for raw WebServer routes. Disposal flips the
 * admission bit synchronously, aborts every accepted request, and awaits all
 * of their handler promises without a timer or detached task.
 */
export class WorkbenchRouteAdmission {
  private phase: RouteAdmissionPhase = 'accepting'
  private readonly lifetime = new AbortController()
  private readonly inFlight = new Set<Promise<void>>()
  private closing: Promise<void> | undefined

  constructor(private readonly reportFailure: (error: unknown) => void = () => undefined) {}

  get lifecycle(): RouteAdmissionPhase {
    return this.phase
  }

  get activeRequests(): number {
    return this.inFlight.size
  }

  run(
    res: ServerResponse,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.phase !== 'accepting') {
      writePlainResponse(res, 503, 'unavailable', true)
      return Promise.resolve()
    }

    const disconnected = new AbortController()
    const onClose = (): void => {
      if (!res.writableEnded) disconnected.abort(new Error('Workbench HTTP client disconnected'))
    }
    res.once('close', onClose)
    const signal = AbortSignal.any([this.lifetime.signal, disconnected.signal])
    const pending = Promise.resolve()
      .then(() => operation(signal))
      .catch((error: unknown) => {
        if (signal.aborted) {
          if (!res.writableEnded && !res.destroyed) res.destroy()
          return
        }
        this.reportFailure(error)
        if (res.headersSent) {
          if (!res.writableEnded && !res.destroyed) res.destroy()
          return
        }
        writePlainResponse(res, 500, 'unavailable', true)
      })
      .finally(() => {
        res.off('close', onClose)
        this.inFlight.delete(pending)
      })
    this.inFlight.add(pending)
    return pending
  }

  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    if (this.phase === 'closed') return
    this.phase = 'closing'
    this.lifetime.abort(new Error('Workbench HTTP routes are disposing'))
    await Promise.allSettled([...this.inFlight])
    this.phase = 'closed'
  }
}

/**
 * Buffer one deliberately small request, dispatch it through a Fetch handler,
 * and stream the Fetch response with node:http backpressure. The supplied
 * signal is the union of route disposal and browser disconnect.
 */
export async function bridgeWorkbenchHttp(
  req: IncomingMessage,
  res: ServerResponse,
  handler: WorkbenchFetchHandler,
  options: WorkbenchHttpBridgeOptions,
): Promise<void> {
  assertBodyLimit(options.maxRequestBodyBytes)
  const { signal } = options
  const abortTransport = (): void => {
    if (!req.destroyed) req.destroy()
    if (!res.writableEnded && !res.destroyed) res.destroy()
  }
  signal.addEventListener('abort', abortTransport, { once: true })
  let responseBody: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    throwIfAborted(signal)
    const declaredLength = parseDeclaredLength(req.headers)
    if (declaredLength === null) {
      await writeBridgeFailure(res, 400, options)
      return
    }
    if (declaredLength !== undefined && declaredLength > options.maxRequestBodyBytes) {
      await rejectOversize(req, res, options)
      return
    }

    const chunks: Buffer[] = []
    let received = 0
    for await (const rawChunk of req) {
      throwIfAborted(signal)
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array)
      received += chunk.byteLength
      if (received > options.maxRequestBodyBytes) {
        await rejectOversize(req, res, options)
        return
      }
      chunks.push(chunk)
    }
    throwIfAborted(signal)

    const method = req.method ?? 'GET'
    if ((method === 'GET' || method === 'HEAD') && received !== 0) {
      await writeBridgeFailure(res, 400, options)
      return
    }
    const request = new Request(new URL(req.url ?? '/', 'http://workbench.internal'), {
      method,
      headers: fetchHeaders(req.headers),
      ...(received === 0 ? {} : { body: Buffer.concat(chunks, received) }),
      signal,
    })
    const response = await handler.fetch(request)
    throwIfAborted(signal)
    const responseHeaders = nodeResponseHeaders(response.headers)
    if (options.noStore === true) responseHeaders['cache-control'] = 'no-store'
    res.writeHead(response.status, responseHeaders)
    if (response.body === null || method === 'HEAD') {
      res.end()
      return
    }

    responseBody = response.body.getReader()
    while (true) {
      const chunk = await abortable(responseBody.read(), signal)
      if (chunk.done) break
      if (!res.write(chunk.value)) await waitForDrain(res, signal)
    }
    res.end()
  } finally {
    signal.removeEventListener('abort', abortTransport)
    if (signal.aborted && responseBody !== undefined) {
      await responseBody.cancel(signal.reason).catch(() => undefined)
    }
    responseBody?.releaseLock()
  }
}

/** Write a short response without exposing request, credential, or handler details. */
export function writePlainResponse(
  res: ServerResponse,
  status: number,
  body: string,
  noStore: boolean,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...(noStore ? { 'cache-control': 'no-store' } : {}),
    ...headers,
  })
  res.end(body)
}

function assertBodyLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('maxRequestBodyBytes must be a positive safe integer')
  }
}

/** Undefined content-length is valid; null marks a malformed declaration. */
function parseDeclaredLength(headers: IncomingHttpHeaders): number | undefined | null {
  const value = headers['content-length']
  if (value === undefined) return undefined
  if (Array.isArray(value) || !/^(?:0|[1-9]\d*)$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function rejectOversize(
  req: IncomingMessage,
  res: ServerResponse,
  options: WorkbenchHttpBridgeOptions,
): Promise<void> {
  await writeBridgeFailure(res, 413, options, { connection: 'close' })
  if (!req.destroyed) req.destroy()
}

async function writeBridgeFailure(
  res: ServerResponse,
  status: WorkbenchBridgeRequestFailureStatus,
  options: WorkbenchHttpBridgeOptions,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<void> {
  const response = options.requestFailure?.(status)
    ?? new Response(status === 413 ? 'request too large' : 'bad request', { status })
  const headers = nodeResponseHeaders(response.headers)
  if (options.noStore === true) headers['cache-control'] = 'no-store'
  Object.assign(headers, extraHeaders)
  res.writeHead(response.status, headers)
  const body = response.body === null ? new Uint8Array() : new Uint8Array(await response.arrayBuffer())
  res.end(body)
}

function fetchHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else {
      result.set(name, value)
    }
  }
  return result
}

function nodeResponseHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [name, value] of headers.entries()) result[name] = value
  const setCookies = headers.getSetCookie()
  if (setCookies.length !== 0) result['set-cookie'] = setCookies
  return result
}

async function waitForDrain(res: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted || res.destroyed) throw abortReason(signal)
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      res.off('drain', onDrain)
      res.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('Workbench HTTP client disconnected during response'))
    }
    const onAbort = (): void => {
      cleanup()
      reject(abortReason(signal))
    }
    res.once('drain', onDrain)
    res.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Workbench HTTP request aborted')
}
