/** Password normalization, policy, and the production Argon2id adapter. */

import {
  argon2id,
  hash as argonHash,
  needsRehash as argonNeedsRehash,
  verify as argonVerify,
} from 'argon2'

export const MIN_OWNER_PASSWORD_CODE_POINTS = 15
export const MAX_OWNER_PASSWORD_CODE_POINTS = 256
export const MAX_OWNER_PASSWORD_BYTES = 1_024
export const ARGON2_MEMORY_COST_KIB = 65_536
export const ARGON2_TIME_COST = 3
export const ARGON2_PARALLELISM = 4
export const ARGON2_HASH_LENGTH = 32

const COMMON_PASSWORDS = new Set([
  '123456789012345',
  'administratoradministrator',
  'letmeinletmeinletmein',
  'passwordpassword',
  'projectworkbench',
  'qwertyqwertyqwerty',
])

/** Safe, localizable reason why a proposed password was rejected. */
export type PasswordIssueCode = 'not-string' | 'too-short' | 'too-long' | 'common'

export class PasswordValidationError extends Error {
  constructor(readonly code: PasswordIssueCode) {
    super(`Owner password rejected: ${code}`)
    this.name = 'PasswordValidationError'
  }
}

/** Replaceable expensive-hash seam for deterministic auth tests. */
export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(phc: string, password: string): Promise<boolean>
  needsRehash(phc: string): boolean
}

/** Normalize according to NIST's Unicode guidance, then enforce bounded length. */
export function normalizeOwnerPassword(value: unknown, proposed: boolean): string {
  if (typeof value !== 'string') throw new PasswordValidationError('not-string')
  const normalized = value.normalize('NFC')
  const codePoints = [...normalized].length
  if (proposed && codePoints < MIN_OWNER_PASSWORD_CODE_POINTS) {
    throw new PasswordValidationError('too-short')
  }
  const byteLength = Buffer.byteLength(normalized, 'utf8')
  if (codePoints > MAX_OWNER_PASSWORD_CODE_POINTS || byteLength > MAX_OWNER_PASSWORD_BYTES) {
    throw new PasswordValidationError('too-long')
  }
  if (proposed && COMMON_PASSWORDS.has(normalized.toLocaleLowerCase('en-US'))) {
    throw new PasswordValidationError('common')
  }
  return normalized
}

/** Production password adapter with explicit Argon2id v=19 parameters. */
export const argon2idPasswordHasher: PasswordHasher = Object.freeze({
  async hash(password: string): Promise<string> {
    return argonHash(normalizeOwnerPassword(password, true), {
      type: argon2id,
      version: 0x13,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
      hashLength: ARGON2_HASH_LENGTH,
    })
  },
  async verify(phc: string, password: string): Promise<boolean> {
    let normalized: string
    try {
      normalized = normalizeOwnerPassword(password, false)
    } catch (error) {
      if (error instanceof PasswordValidationError) return false
      throw error
    }
    return argonVerify(phc, normalized)
  },
  needsRehash(phc: string): boolean {
    return argonNeedsRehash(phc, {
      version: 0x13,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
    })
  },
})

