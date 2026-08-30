import { describe, expect, it } from 'vitest'
import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  MAX_OWNER_PASSWORD_CODE_POINTS,
  MIN_OWNER_PASSWORD_CODE_POINTS,
  PasswordValidationError,
  argon2idPasswordHasher,
  normalizeOwnerPassword,
} from '../src/password.ts'

describe('Owner password policy and Argon2id', () => {
  it('executes a real Argon2id PHC hash and verification with pinned parameters', async () => {
    const password = 'a long local owner passphrase'
    const phc = await argon2idPasswordHasher.hash(password)
    expect(phc).toMatch(new RegExp(
      `^\\$argon2id\\$v=19\\$m=${String(ARGON2_MEMORY_COST_KIB)},p=${String(ARGON2_PARALLELISM)},t=${String(ARGON2_TIME_COST)}\\$`,
      'u',
    ))
    await expect(argon2idPasswordHasher.verify(phc, password)).resolves.toBe(true)
    await expect(argon2idPasswordHasher.verify(phc, `${password}!`)).resolves.toBe(false)
    expect(argon2idPasswordHasher.needsRehash(phc)).toBe(false)
  }, 20_000)

  it('uses NFC, accepts passphrases without composition rules, and bounds work', () => {
    expect(normalizeOwnerPassword(`Cafe\u0301 ${'x'.repeat(10)}`, true))
      .toBe(`Café ${'x'.repeat(10)}`)
    expect(normalizeOwnerPassword('spaces are valid in a password', true))
      .toBe('spaces are valid in a password')
    expect(() => normalizeOwnerPassword('x'.repeat(MIN_OWNER_PASSWORD_CODE_POINTS - 1), true))
      .toThrow(PasswordValidationError)
    expect(() => normalizeOwnerPassword('x'.repeat(MAX_OWNER_PASSWORD_CODE_POINTS + 1), true))
      .toThrow(PasswordValidationError)
    expect(() => normalizeOwnerPassword('passwordpassword', true))
      .toThrow(PasswordValidationError)
  })
})
