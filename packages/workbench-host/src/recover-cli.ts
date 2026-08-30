#!/usr/bin/env node

/** Secret-safe command line entrypoint for local, offline Owner recovery. */

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { OwnerAuthFailure } from './owner-access.ts'
import {
  MAX_OWNER_PASSWORD_BYTES,
  normalizeOwnerPassword,
  PasswordValidationError,
} from './password.ts'
import {
  OfflineOwnerRecoveryPreconditionError,
  recoverOwnerOffline,
  type OfflineOwnerRecoveryRequest,
} from './recovery.ts'

export const RECOVERY_CLI_USAGE = 'Usage: dsh-workbench owner recover [--dsh-home PATH] [--stdin]'

export const RecoveryCliExitCode = Object.freeze({
  success: 0,
  failure: 1,
  usage: 2,
  input: 3,
  cancelled: 130,
} as const)

const RECOVERY_CODE_INPUT_MAX_BYTES = 256
const MAX_STDIN_INPUT_BYTES = RECOVERY_CODE_INPUT_MAX_BYTES
  + (2 * MAX_OWNER_PASSWORD_BYTES)
  + 6 // Three optional CRLF delimiters.

interface CliReadable extends NodeJS.ReadableStream {
  readonly isTTY?: boolean
  readonly isRaw?: boolean
  readonly readableEnded?: boolean
  readonly readableFlowing?: boolean | null
  setRawMode?(mode: boolean): unknown
}

interface CliWritable {
  readonly isTTY?: boolean
  write(value: string): unknown
}

export interface RecoveryCliIo {
  readonly input: CliReadable
  readonly stdout: CliWritable
  readonly stderr: CliWritable
}

export interface RecoveryCliDependencies {
  readonly recoverOwnerOffline?: (
    request: OfflineOwnerRecoveryRequest,
  ) => Promise<{ readonly recoveryCode: string }>
  readonly signal?: AbortSignal
}

export interface RecoveryCliValues {
  readonly recoveryCode: string
  readonly newPassword: string
  readonly confirmPassword: string
}

interface ParsedRecoveryCommand {
  readonly kind: 'recover'
  readonly dshHome?: string
  readonly stdin: boolean
}

interface ParsedHelpCommand {
  readonly kind: 'help'
}

type ParsedCommand = ParsedRecoveryCommand | ParsedHelpCommand

type RecoveryCliInputIssue =
  | 'cancelled'
  | 'confirmation-mismatch'
  | 'input-too-long'
  | 'invalid-encoding'
  | 'stdin-shape'
  | 'tty-required'

/** An input failure whose message never contains a supplied value. */
export class RecoveryCliInputError extends Error {
  constructor(readonly issue: RecoveryCliInputIssue) {
    super(`Owner recovery input rejected: ${issue}`)
    this.name = 'RecoveryCliInputError'
  }
}

class RecoveryCliUsageError extends Error {
  constructor() {
    super('Invalid Owner recovery command')
    this.name = 'RecoveryCliUsageError'
  }
}

const processIo: RecoveryCliIo = {
  input: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Parse only the public command shape; positional secrets are always refused. */
export function parseRecoveryCliArguments(argv: readonly string[]): ParsedCommand {
  if ((argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))
    || (argv.length === 3
      && argv[0] === 'owner'
      && argv[1] === 'recover'
      && (argv[2] === '--help' || argv[2] === '-h'))) {
    return { kind: 'help' }
  }
  if (argv[0] !== 'owner' || argv[1] !== 'recover') throw new RecoveryCliUsageError()

  let dshHome: string | undefined
  let stdin = false
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--stdin' && !stdin) {
      stdin = true
      continue
    }
    if (argument === '--dsh-home' && dshHome === undefined) {
      const value = argv[index + 1]
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new RecoveryCliUsageError()
      }
      dshHome = value
      index += 1
      continue
    }
    throw new RecoveryCliUsageError()
  }

  return dshHome === undefined
    ? { kind: 'recover', stdin }
    : { kind: 'recover', dshHome, stdin }
}

/**
 * Read the automation format to EOF with a hard byte ceiling. The accepted
 * payload is exactly three LF/CRLF-delimited values, with one optional final
 * newline: recovery code, new password, and password confirmation.
 */
export async function readRecoveryValuesFromStdin(
  input: CliReadable,
  signal?: AbortSignal,
): Promise<RecoveryCliValues> {
  const bytes = await readBoundedInput(input, MAX_STDIN_INPUT_BYTES, signal)
  try {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new RecoveryCliInputError('invalid-encoding')
    }
    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()
    if (lines.length !== 3) throw new RecoveryCliInputError('stdin-shape')
    const values = lines.map((line) => {
      const value = line.endsWith('\r') ? line.slice(0, -1) : line
      if (value.includes('\r')) throw new RecoveryCliInputError('stdin-shape')
      return value
    })
    assertInputBound(values[0] as string, RECOVERY_CODE_INPUT_MAX_BYTES)
    assertInputBound(values[1] as string, MAX_OWNER_PASSWORD_BYTES)
    assertInputBound(values[2] as string, MAX_OWNER_PASSWORD_BYTES)
    return Object.freeze({
      recoveryCode: values[0] as string,
      newPassword: values[1] as string,
      confirmPassword: values[2] as string,
    })
  } finally {
    bytes.fill(0)
  }
}

/** Read all three secrets without terminal echo, restoring the prior mode. */
export async function readRecoveryValuesFromTty(
  input: CliReadable,
  output: CliWritable,
  signal?: AbortSignal,
): Promise<RecoveryCliValues> {
  if (input.isTTY !== true
    || output.isTTY !== true
    || typeof input.setRawMode !== 'function') {
    throw new RecoveryCliInputError('tty-required')
  }
  if (signal?.aborted === true) throw new RecoveryCliInputError('cancelled')

  const wasRaw = input.isRaw === true
  const shouldPauseAfter = input.readableFlowing !== true
  let rawModeChanged = false
  emitKeypressEvents(input)
  try {
    rawModeChanged = true
    input.setRawMode(true)
    input.resume()
    const recoveryCode = await hiddenQuestion(
      input,
      output,
      'Recovery code: ',
      RECOVERY_CODE_INPUT_MAX_BYTES,
      signal,
    )
    const newPassword = await hiddenQuestion(
      input,
      output,
      'New password: ',
      MAX_OWNER_PASSWORD_BYTES,
      signal,
    )
    const confirmPassword = await hiddenQuestion(
      input,
      output,
      'Confirm new password: ',
      MAX_OWNER_PASSWORD_BYTES,
      signal,
    )
    return Object.freeze({ recoveryCode, newPassword, confirmPassword })
  } finally {
    if (rawModeChanged) input.setRawMode(wasRaw)
    if (shouldPauseAfter) input.pause()
  }
}

/** Run the CLI without terminating the importing process. */
export async function runRecoveryCli(
  argv: readonly string[] = process.argv.slice(2),
  io: RecoveryCliIo = processIo,
  dependencies: RecoveryCliDependencies = {},
): Promise<number> {
  let command: ParsedCommand
  try {
    command = parseRecoveryCliArguments(argv)
  } catch {
    io.stderr.write(`${RECOVERY_CLI_USAGE}\n`)
    return RecoveryCliExitCode.usage
  }
  if (command.kind === 'help') {
    io.stdout.write(`${RECOVERY_CLI_USAGE}\n`)
    return RecoveryCliExitCode.success
  }

  io.stderr.write(
    'Offline recovery requires the Workbench Web Host to be stopped.\n'
    + 'Continue only after the Host has fully shut down.\n',
  )

  try {
    const values = command.stdin
      ? await readRecoveryValuesFromStdin(io.input, dependencies.signal)
      : await readRecoveryValuesFromTty(io.input, io.stderr, dependencies.signal)
    const newPassword = normalizeOwnerPassword(values.newPassword, true)
    const confirmPassword = normalizeOwnerPassword(values.confirmPassword, true)
    if (newPassword !== confirmPassword) {
      throw new RecoveryCliInputError('confirmation-mismatch')
    }
    const recover = dependencies.recoverOwnerOffline ?? recoverOwnerOffline
    const request: OfflineOwnerRecoveryRequest = {
      recoveryCode: values.recoveryCode,
      newPassword,
      webHostStopped: true,
      ...(command.dshHome === undefined ? {} : { dshHome: command.dshHome }),
      ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
    }
    const recovered = await recover(request)

    // Standard output is intentionally machine-readable and contains the
    // replacement exactly once. All prose stays on standard error.
    io.stdout.write(`${recovered.recoveryCode}\n`)
    io.stderr.write(
      'Owner password reset; every prior session is now invalid.\n'
      + 'Save the replacement recovery code from standard output now; it cannot be shown again.\n',
    )
    return RecoveryCliExitCode.success
  } catch (error) {
    return reportRecoveryFailure(error, io.stderr)
  }
}

function assertInputBound(value: string, maxBytes: number): void {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new RecoveryCliInputError('input-too-long')
  }
}

function readBoundedInput(
  input: CliReadable,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (signal?.aborted === true) return Promise.reject(new RecoveryCliInputError('cancelled'))
  return new Promise<Buffer>((resolveInput, rejectInput) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const shouldPauseAfter = input.readableFlowing !== true

    const zeroChunks = (): void => {
      for (const chunk of chunks) chunk.fill(0)
    }
    const cleanup = (): void => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (shouldPauseAfter) input.pause()
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      zeroChunks()
      rejectInput(error)
    }
    const onData = (value: string | Buffer): void => {
      const chunk = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
      size += chunk.byteLength
      if (size > maxBytes) {
        chunk.fill(0)
        fail(new RecoveryCliInputError('input-too-long'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (settled) return
      settled = true
      cleanup()
      const value = Buffer.concat(chunks, size)
      zeroChunks()
      resolveInput(value)
    }
    const onError = (): void => fail(new RecoveryCliInputError('stdin-shape'))
    const onAbort = (): void => fail(new RecoveryCliInputError('cancelled'))

    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      input.resume()
    } catch (error) {
      fail(error)
      return
    }
    if (input.readableEnded === true) queueMicrotask(onEnd)
  })
}

interface Keypress {
  readonly name?: string
  readonly ctrl?: boolean
  readonly meta?: boolean
}

function hiddenQuestion(
  input: CliReadable,
  output: CliWritable,
  prompt: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted === true) return Promise.reject(new RecoveryCliInputError('cancelled'))
  return new Promise<string>((resolveValue, rejectValue) => {
    let value = ''
    let settled = false

    const cleanup = (): void => {
      input.off('keypress', onKeypress)
      input.off('end', onEnd)
      input.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (next?: string, error?: RecoveryCliInputError): void => {
      if (settled) return
      settled = true
      cleanup()
      try {
        output.write('\n')
      } catch (writeError) {
        rejectValue(writeError)
        return
      }
      if (error !== undefined) rejectValue(error)
      else resolveValue(next as string)
    }
    const onKeypress = (text: string | undefined, key: Keypress = {}): void => {
      if (key.ctrl === true && key.name === 'c') {
        finish(undefined, new RecoveryCliInputError('cancelled'))
        return
      }
      if (key.ctrl === true && key.name === 'd') {
        finish(undefined, new RecoveryCliInputError('cancelled'))
        return
      }
      if (key.ctrl === true && key.name === 'u') {
        value = ''
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(value)
        return
      }
      if (key.name === 'backspace') {
        const codePoints = [...value]
        codePoints.pop()
        value = codePoints.join('')
        return
      }
      if (text === undefined
        || key.ctrl === true
        || key.meta === true
        || /[\u0000-\u001f\u007f]/u.test(text)) return
      const next = value + text
      if (Buffer.byteLength(next, 'utf8') > maxBytes) {
        finish(undefined, new RecoveryCliInputError('input-too-long'))
        return
      }
      value = next
    }
    const onEnd = (): void => finish(undefined, new RecoveryCliInputError('cancelled'))
    const onError = (): void => finish(undefined, new RecoveryCliInputError('cancelled'))
    const onAbort = (): void => finish(undefined, new RecoveryCliInputError('cancelled'))

    input.on('keypress', onKeypress)
    input.once('end', onEnd)
    input.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      output.write(prompt)
    } catch (error) {
      cleanup()
      settled = true
      rejectValue(error)
    }
  })
}

function reportRecoveryFailure(error: unknown, output: CliWritable): number {
  if (error instanceof RecoveryCliInputError) {
    if (error.issue === 'cancelled') {
      output.write('Recovery cancelled.\n')
      return RecoveryCliExitCode.cancelled
    }
    if (error.issue === 'tty-required') {
      output.write('Interactive recovery requires a TTY; use --stdin only for bounded automation input.\n')
    } else if (error.issue === 'confirmation-mismatch') {
      output.write('Recovery input rejected: the new passwords do not match.\n')
    } else {
      output.write('Recovery input rejected: expected exactly three bounded newline-delimited values.\n')
    }
    return RecoveryCliExitCode.input
  }
  if (error instanceof PasswordValidationError) {
    if (error.code === 'too-short') {
      output.write('Recovery input rejected: the new password must contain at least 15 characters.\n')
    } else if (error.code === 'too-long') {
      output.write('Recovery input rejected: the new password is too long.\n')
    } else if (error.code === 'common') {
      output.write('Recovery input rejected: choose a less common password.\n')
    } else {
      output.write('Recovery input rejected.\n')
    }
    return RecoveryCliExitCode.input
  }
  if (error instanceof OwnerAuthFailure && error.code === 'invalid-credentials') {
    output.write('Recovery failed: the recovery code is invalid or has already been used.\n')
    return RecoveryCliExitCode.failure
  }
  if (error instanceof OfflineOwnerRecoveryPreconditionError) {
    output.write('Recovery refused: stop the Workbench Web Host before running this command.\n')
    return RecoveryCliExitCode.failure
  }
  output.write(
    'Recovery failed. Confirm that the Workbench Web Host is stopped and the DSH credential store is available.\n',
  )
  return RecoveryCliExitCode.failure
}

/** Realpath-aware direct-execution guard that also works through npm bin links. */
export function isRecoveryCliEntrypoint(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvEntry))
  } catch {
    return false
  }
}

async function runBin(): Promise<void> {
  const abort = new AbortController()
  let receivedSignal: NodeJS.Signals | undefined
  const onSignal = (signal: NodeJS.Signals): void => {
    receivedSignal ??= signal
    abort.abort(new Error('Owner recovery interrupted'))
  }
  const onSighup = (): void => onSignal('SIGHUP')
  const onSigint = (): void => onSignal('SIGINT')
  const onSigterm = (): void => onSignal('SIGTERM')
  process.on('SIGHUP', onSighup)
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  try {
    const code = await runRecoveryCli(process.argv.slice(2), processIo, { signal: abort.signal })
    process.exitCode = receivedSignal === 'SIGHUP'
      ? 129
      : receivedSignal === 'SIGTERM'
        ? 143
        : code
  } finally {
    process.off('SIGHUP', onSighup)
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

if (isRecoveryCliEntrypoint(import.meta.url, process.argv[1])) {
  void runBin().catch(() => {
    process.stderr.write('Recovery failed safely.\n')
    process.exitCode = RecoveryCliExitCode.failure
  })
}
