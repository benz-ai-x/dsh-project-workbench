import { fileURLToPath, pathToFileURL } from 'node:url'
import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  RECOVERY_CLI_USAGE,
  RecoveryCliExitCode,
  RecoveryCliInputError,
  isRecoveryCliEntrypoint,
  parseRecoveryCliArguments,
  readRecoveryValuesFromStdin,
  readRecoveryValuesFromTty,
  runRecoveryCli,
  type RecoveryCliIo,
} from '../src/recover-cli.ts'

const RECOVERY_CODE = 'WB1-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789'
const REPLACEMENT_CODE = 'WB1-BCDE-FGHJ-KLMN-PQRS-TUVW-XYZ2-3456-789A'
const PASSWORD = 'a sufficiently long password 2026'

class CapturedOutput {
  text = ''

  constructor(readonly isTTY = false) {}

  write(value: string): boolean {
    this.text += value
    return true
  }
}

function automationIo(text: string): {
  readonly io: RecoveryCliIo
  readonly stdout: CapturedOutput
  readonly stderr: CapturedOutput
} {
  const stdout = new CapturedOutput()
  const stderr = new CapturedOutput()
  return {
    io: {
      input: Readable.from(text),
      stdout,
      stderr,
    } as RecoveryCliIo,
    stdout,
    stderr,
  }
}

async function nextTurn(): Promise<void> {
  await new Promise<void>(resolveTurn => setImmediate(resolveTurn))
}

describe('recovery CLI arguments', () => {
  it('accepts only the public command and non-secret options', () => {
    expect(parseRecoveryCliArguments(['owner', 'recover'])).toEqual({
      kind: 'recover',
      stdin: false,
    })
    expect(parseRecoveryCliArguments([
      'owner',
      'recover',
      '--stdin',
      '--dsh-home',
      '/private/dsh home',
    ])).toEqual({
      kind: 'recover',
      stdin: true,
      dshHome: '/private/dsh home',
    })
    expect(parseRecoveryCliArguments(['owner', 'recover', '--help'])).toEqual({ kind: 'help' })
  })

  it('refuses positional or option-shaped secret material without echoing it', async () => {
    const secret = 'must-never-be-echoed'
    const { io, stdout, stderr } = automationIo('')
    const exitCode = await runRecoveryCli(['owner', 'recover', secret], io)

    expect(exitCode).toBe(RecoveryCliExitCode.usage)
    expect(stdout.text).toBe('')
    expect(stderr.text).toBe(`${RECOVERY_CLI_USAGE}\n`)
    expect(stderr.text).not.toContain(secret)
  })
})

describe('bounded automation input', () => {
  it('reads exactly three LF or CRLF-delimited values', async () => {
    const lf = await readRecoveryValuesFromStdin(Readable.from(
      `${RECOVERY_CODE}\n${PASSWORD}\n${PASSWORD}\n`,
    ) as RecoveryCliIo['input'])
    const crlf = await readRecoveryValuesFromStdin(Readable.from(
      `${RECOVERY_CODE}\r\n${PASSWORD}\r\n${PASSWORD}\r\n`,
    ) as RecoveryCliIo['input'])

    expect(lf).toEqual({
      recoveryCode: RECOVERY_CODE,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    })
    expect(crlf).toEqual(lf)
  })

  it('rejects extra lines and overlong values before recovery', async () => {
    const recover = vi.fn()
    const extra = automationIo(`${RECOVERY_CODE}\n${PASSWORD}\n${PASSWORD}\nextra\n`)
    const extraExit = await runRecoveryCli(
      ['owner', 'recover', '--stdin'],
      extra.io,
      { recoverOwnerOffline: recover },
    )
    expect(extraExit).toBe(RecoveryCliExitCode.input)
    expect(recover).not.toHaveBeenCalled()

    const overlong = 'x'.repeat(2_400)
    await expect(readRecoveryValuesFromStdin(
      Readable.from(overlong) as RecoveryCliIo['input'],
    )).rejects.toMatchObject<Partial<RecoveryCliInputError>>({ issue: 'input-too-long' })
  })

  it('prints the replacement once and keeps every supplied value out of diagnostics', async () => {
    const { io, stdout, stderr } = automationIo(
      `${RECOVERY_CODE}\n${PASSWORD}\n${PASSWORD}\n`,
    )
    const recover = vi.fn(async () => ({ recoveryCode: REPLACEMENT_CODE }))
    const exitCode = await runRecoveryCli(
      ['owner', 'recover', '--stdin', '--dsh-home', '/tmp/test-dsh'],
      io,
      { recoverOwnerOffline: recover },
    )

    expect(exitCode).toBe(RecoveryCliExitCode.success)
    expect(stdout.text).toBe(`${REPLACEMENT_CODE}\n`)
    expect(stdout.text.split(REPLACEMENT_CODE)).toHaveLength(2)
    expect(stderr.text).not.toContain(RECOVERY_CODE)
    expect(stderr.text).not.toContain(PASSWORD)
    expect(stderr.text).not.toContain(REPLACEMENT_CODE)
    expect(recover).toHaveBeenCalledWith({
      recoveryCode: RECOVERY_CODE,
      newPassword: PASSWORD,
      dshHome: '/tmp/test-dsh',
      webHostStopped: true,
    })
  })

  it('contains an unexpected secret-bearing failure behind a fixed diagnostic', async () => {
    const leaked = 'internal-error-containing-secret-material'
    const { io, stdout, stderr } = automationIo(
      `${RECOVERY_CODE}\n${PASSWORD}\n${PASSWORD}\n`,
    )
    const exitCode = await runRecoveryCli(
      ['owner', 'recover', '--stdin'],
      io,
      { recoverOwnerOffline: () => Promise.reject(new Error(leaked)) },
    )

    expect(exitCode).toBe(RecoveryCliExitCode.failure)
    expect(stdout.text).toBe('')
    expect(stderr.text).not.toContain(leaked)
    expect(stderr.text).not.toContain(RECOVERY_CODE)
    expect(stderr.text).not.toContain(PASSWORD)
  })
})

describe('hidden TTY input', () => {
  it('requires a TTY by default', async () => {
    const { io, stdout, stderr } = automationIo('')
    const exitCode = await runRecoveryCli(['owner', 'recover'], io)

    expect(exitCode).toBe(RecoveryCliExitCode.input)
    expect(stdout.text).toBe('')
    expect(stderr.text).toContain('requires a TTY')
  })

  it('does not echo secrets and restores raw mode after success', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: true
      isRaw: boolean
      setRawMode(mode: boolean): void
    }
    input.isTTY = true
    input.isRaw = false
    const rawModes: boolean[] = []
    input.setRawMode = (mode) => {
      rawModes.push(mode)
      input.isRaw = mode
    }
    const output = new CapturedOutput(true)
    const reading = readRecoveryValuesFromTty(
      input as RecoveryCliIo['input'],
      output,
    )

    await nextTurn()
    for (const character of RECOVERY_CODE) input.emit('keypress', character, { name: character })
    input.emit('keypress', '\r', { name: 'return' })
    await nextTurn()
    for (const character of PASSWORD) input.emit('keypress', character, { name: character })
    input.emit('keypress', '\r', { name: 'return' })
    await nextTurn()
    for (const character of PASSWORD) input.emit('keypress', character, { name: character })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(reading).resolves.toEqual({
      recoveryCode: RECOVERY_CODE,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    })
    expect(output.text).toBe(
      'Recovery code: \nNew password: \nConfirm new password: \n',
    )
    expect(output.text).not.toContain(RECOVERY_CODE)
    expect(output.text).not.toContain(PASSWORD)
    expect(rawModes).toEqual([true, false])
  })

  it('restores raw mode when Ctrl-C cancels a prompt', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: true
      isRaw: boolean
      setRawMode(mode: boolean): void
    }
    input.isTTY = true
    input.isRaw = false
    const rawModes: boolean[] = []
    input.setRawMode = (mode) => {
      rawModes.push(mode)
      input.isRaw = mode
    }
    const output = new CapturedOutput(true)
    const reading = readRecoveryValuesFromTty(
      input as RecoveryCliIo['input'],
      output,
    )

    await nextTurn()
    input.emit('keypress', '\u0003', { ctrl: true, name: 'c' })
    await expect(reading).rejects.toMatchObject<Partial<RecoveryCliInputError>>({
      issue: 'cancelled',
    })
    expect(rawModes).toEqual([true, false])
  })
})

describe('packed entrypoint guard', () => {
  it('recognizes the actual module path but not an ordinary import', () => {
    const modulePath = fileURLToPath(new URL('../src/recover-cli.ts', import.meta.url))
    expect(isRecoveryCliEntrypoint(pathToFileURL(modulePath).href, modulePath)).toBe(true)
    expect(isRecoveryCliEntrypoint(pathToFileURL(modulePath).href, fileURLToPath(import.meta.url))).toBe(false)
    expect(isRecoveryCliEntrypoint(pathToFileURL(modulePath).href, undefined)).toBe(false)
  })
})
