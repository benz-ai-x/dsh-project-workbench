import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  OwnerAccess,
  OwnerAuthFailure,
  secretDigest,
  type OwnerAccessRandom,
} from '../src/owner-access.ts'
import { DshOwnerCredentialStore } from '../src/owner-credential-store.ts'
import {
  argon2idPasswordHasher,
  type PasswordHasher,
} from '../src/password.ts'
import {
  OfflineOwnerRecoveryPreconditionError,
  recoverOwnerOffline,
} from '../src/recovery.ts'
import {
  RecoveryCliExitCode,
  runRecoveryCli,
  type RecoveryCliIo,
} from '../src/recover-cli.ts'

const INITIAL_PASSWORD_PHC = '$argon2id$v=19$m=65536,p=4,t=3$c2FsdA$aGFzaA'
const NEW_PASSWORD = 'correct horse battery staple 2026'

const deterministicHasher: PasswordHasher = Object.freeze({
  hash: () => Promise.resolve(INITIAL_PASSWORD_PHC),
  verify: () => Promise.resolve(false),
  needsRehash: () => false,
})

function deterministicRandom(): OwnerAccessRandom {
  let byteSeed = 1
  let id = 0
  return {
    bytes(size) {
      const value = Uint8Array.from({ length: size }, (_, index) => (byteSeed + index) & 0xff)
      byteSeed += size
      return value
    },
    id(prefix) {
      id += 1
      return `${prefix}-test-${id}`
    },
  }
}

class CapturedOutput {
  readonly isTTY = false
  text = ''

  write(value: string): boolean {
    this.text += value
    return true
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'workbench-owner-recovery-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  return home
}

async function bootCredentials(home: string): Promise<{
  readonly context: Context
  readonly dispose: () => Promise<void>
}> {
  const context = new Context()
  const fiber = context.plugin(LocalCredentialProvider, { dshHome: home, watch: false })
  await fiber
  return {
    context,
    dispose: async () => { await fiber.dispose() },
  }
}

async function initializeOwner(home: string): Promise<{
  readonly recoveryCode: string
  readonly token: string
}> {
  const provider = await bootCredentials(home)
  const access = new OwnerAccess({
    store: new DshOwnerCredentialStore(provider.context.credentials),
    passwordHasher: deterministicHasher,
    random: deterministicRandom(),
    clock: { now: () => new Date('2026-08-31T03:00:00.000Z') },
  })
  try {
    await access.open()
    const initialized = await access.initialize('initial password value')
    return {
      recoveryCode: initialized.value.recoveryCode,
      token: initialized.token,
    }
  } finally {
    await access.close()
    await provider.dispose()
  }
}

describe('offline Owner recovery', () => {
  it('uses the real LocalCredentialProvider, consumes the code, and revokes every session', async () => {
    const home = await tempHome()
    const initialized = await initializeOwner(home)
    const stdout = new CapturedOutput()
    const stderr = new CapturedOutput()
    const input = Readable.from(
      `${initialized.recoveryCode}\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`,
    )
    const exitCode = await runRecoveryCli(
      ['owner', 'recover', '--dsh-home', home, '--stdin'],
      { input, stdout, stderr } as RecoveryCliIo,
    )

    expect(exitCode).toBe(RecoveryCliExitCode.success)
    const replacementCode = stdout.text.trim()
    expect(replacementCode).toMatch(/^WB1-(?:[A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/u)
    expect(stdout.text).toBe(`${replacementCode}\n`)
    expect(stderr.text).not.toContain(initialized.recoveryCode)
    expect(stderr.text).not.toContain(NEW_PASSWORD)
    expect(stderr.text).not.toContain(replacementCode)
    expect(stderr.text).toContain('Web Host to be stopped')
    expect(stderr.text).toContain('every prior session is now invalid')

    const restarted = await bootCredentials(home)
    const store = new DshOwnerCredentialStore(restarted.context.credentials)
    const record = await store.read()
    expect(record).not.toBeNull()
    expect(record?.credentialVersion).toBe(2)
    expect(record?.recovery.generation).toBe(2)
    expect(record?.recovery.digest).toBe(secretDigest(replacementCode))
    expect(record?.sessions).toEqual([])
    expect(await argon2idPasswordHasher.verify(record!.passwordPhc, NEW_PASSWORD)).toBe(true)

    const access = new OwnerAccess({ store })
    try {
      await access.open()
      await expect(access.authenticate(initialized.token)).resolves.toBeNull()
      const loggedIn = await access.login(NEW_PASSWORD)
      expect(loggedIn.value.access.state).toBe('signed-in')
      await expect(access.authenticate(loggedIn.token)).resolves.toMatchObject({
        kind: 'owner',
        credentialVersion: 2,
      })
    } finally {
      await access.close()
      await restarted.dispose()
    }

    await expect(recoverOwnerOffline({
      recoveryCode: initialized.recoveryCode,
      newPassword: 'another secure password value',
      dshHome: home,
      webHostStopped: true,
    })).rejects.toMatchObject<Partial<OwnerAuthFailure>>({
      name: 'OwnerAuthFailure',
      code: 'invalid-credentials',
    })
  })

  it('refuses to open the credential provider without the stopped-Host acknowledgement', async () => {
    const home = await tempHome()
    await expect(recoverOwnerOffline({
      recoveryCode: 'not-a-secret-value-used-by-the-provider',
      newPassword: NEW_PASSWORD,
      dshHome: home,
      webHostStopped: false,
    } as unknown as Parameters<typeof recoverOwnerOffline>[0])).rejects.toBeInstanceOf(
      OfflineOwnerRecoveryPreconditionError,
    )
  })
})
