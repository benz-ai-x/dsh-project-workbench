/** Versioned Owner authentication state over the DSH credential-record seam. */

import {
  credentialKey,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'

export const OWNER_AUTH_CREDENTIAL_KEY = credentialKey('project-workbench', 'owner-auth')
export const OWNER_AUTH_RECORD_VERSION = 1
const MAX_STORED_SESSIONS = 64
const SAFE_ID = /^[A-Za-z0-9._~-]{1,160}$/u
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/u
const ARGON2ID_PHC = /^\$argon2id\$v=19\$m=\d+,p=\d+,t=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u

/** Stable singleton identity created with the first Owner credential. */
export interface OwnerIdentityRecord {
  readonly ownerId: string
  readonly organizationId: string
  readonly teamId: string
  readonly createdAt: string
}

/** Only the high-entropy recovery-code digest is durable. */
export interface OwnerRecoveryRecord {
  readonly generation: number
  readonly digest: string
  readonly issuedAt: string
}

/** One revocable opaque browser session; the raw token lives only in its cookie. */
export interface OwnerSessionRecord {
  readonly id: string
  readonly digest: string
  readonly credentialVersion: number
  readonly issuedAt: string
  readonly expiresAt: string
}

/** Entire atomic grant payload owned by Project Workbench. */
export interface OwnerAuthRecord {
  readonly version: typeof OWNER_AUTH_RECORD_VERSION
  readonly credentialVersion: number
  readonly identity: OwnerIdentityRecord
  readonly passwordPhc: string
  readonly recovery: OwnerRecoveryRecord
  readonly sessions: readonly OwnerSessionRecord[]
}

/** Narrow persistence port used by auth/service and the offline recovery CLI. */
export interface OwnerCredentialStore {
  read(): Promise<OwnerAuthRecord | null>
  modify(
    mutation: (current: OwnerAuthRecord | null) => Promise<OwnerAuthRecord | undefined>,
  ): Promise<OwnerAuthRecord | null>
}

/** A malformed credential record is an unavailable security store, never setup-required. */
export class OwnerCredentialStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OwnerCredentialStateError'
  }
}

/** DSH Credentials adapter. Its whole-record mutation is the singleton race boundary. */
export class DshOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly credentials: CredentialProvider) {}

  async read(): Promise<OwnerAuthRecord | null> {
    return decodeCredentialRecord(await this.credentials.readRecord(OWNER_AUTH_CREDENTIAL_KEY))
  }

  async modify(
    mutation: (current: OwnerAuthRecord | null) => Promise<OwnerAuthRecord | undefined>,
  ): Promise<OwnerAuthRecord | null> {
    const result = await this.credentials.modifyRecord(OWNER_AUTH_CREDENTIAL_KEY, async (raw) => {
      const current = decodeCredentialRecord(raw)
      const next = await mutation(current)
      if (next === undefined) return undefined
      const checked = decodeOwnerAuthRecord(next)
      return { kind: 'grant', payload: checked }
    })
    return decodeCredentialRecord(result)
  }
}

/** Strictly validate, detach, and freeze an auth payload before it reaches policy code. */
export function decodeOwnerAuthRecord(value: unknown): OwnerAuthRecord {
  const record = object(value, 'Owner auth credential payload')
  exactKeys(record, [
    'version',
    'credentialVersion',
    'identity',
    'passwordPhc',
    'recovery',
    'sessions',
  ], 'Owner auth credential payload')
  if (record.version !== OWNER_AUTH_RECORD_VERSION) {
    throw stateError(`unsupported Owner auth credential version ${String(record.version)}`)
  }
  const credentialVersion = positiveInteger(record.credentialVersion, 'credentialVersion')
  const identityValue = object(record.identity, 'identity')
  exactKeys(identityValue, ['ownerId', 'organizationId', 'teamId', 'createdAt'], 'identity')
  const identity: OwnerIdentityRecord = Object.freeze({
    ownerId: id(identityValue.ownerId, 'identity.ownerId'),
    organizationId: id(identityValue.organizationId, 'identity.organizationId'),
    teamId: id(identityValue.teamId, 'identity.teamId'),
    createdAt: instant(identityValue.createdAt, 'identity.createdAt'),
  })
  if (typeof record.passwordPhc !== 'string' || !ARGON2ID_PHC.test(record.passwordPhc)) {
    throw stateError('passwordPhc is not an Argon2id v=19 PHC string')
  }
  const recoveryValue = object(record.recovery, 'recovery')
  exactKeys(recoveryValue, ['generation', 'digest', 'issuedAt'], 'recovery')
  const recovery: OwnerRecoveryRecord = Object.freeze({
    generation: positiveInteger(recoveryValue.generation, 'recovery.generation'),
    digest: digest(recoveryValue.digest, 'recovery.digest'),
    issuedAt: instant(recoveryValue.issuedAt, 'recovery.issuedAt'),
  })
  if (!Array.isArray(record.sessions) || record.sessions.length > MAX_STORED_SESSIONS) {
    throw stateError(`sessions must be an array with at most ${MAX_STORED_SESSIONS} entries`)
  }
  const sessionIds = new Set<string>()
  const sessionDigests = new Set<string>()
  const sessions = record.sessions.map((candidate, index): OwnerSessionRecord => {
    const session = object(candidate, `sessions[${index}]`)
    exactKeys(session, [
      'id',
      'digest',
      'credentialVersion',
      'issuedAt',
      'expiresAt',
    ], `sessions[${index}]`)
    const decoded = Object.freeze({
      id: id(session.id, `sessions[${index}].id`),
      digest: digest(session.digest, `sessions[${index}].digest`),
      credentialVersion: positiveInteger(
        session.credentialVersion,
        `sessions[${index}].credentialVersion`,
      ),
      issuedAt: instant(session.issuedAt, `sessions[${index}].issuedAt`),
      expiresAt: instant(session.expiresAt, `sessions[${index}].expiresAt`),
    })
    if (Date.parse(decoded.expiresAt) <= Date.parse(decoded.issuedAt)) {
      throw stateError(`sessions[${index}].expiresAt must be after issuedAt`)
    }
    if (sessionIds.has(decoded.id) || sessionDigests.has(decoded.digest)) {
      throw stateError('sessions contain a duplicate id or digest')
    }
    sessionIds.add(decoded.id)
    sessionDigests.add(decoded.digest)
    return decoded
  })
  return Object.freeze({
    version: OWNER_AUTH_RECORD_VERSION,
    credentialVersion,
    identity,
    passwordPhc: record.passwordPhc,
    recovery,
    sessions: Object.freeze(sessions),
  })
}

function decodeCredentialRecord(record: CredentialRecord | undefined): OwnerAuthRecord | null {
  if (record === undefined) return null
  if (record.kind !== 'grant') throw stateError('Owner auth credential must be a grant record')
  return decodeOwnerAuthRecord(record.payload)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw stateError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw stateError(`${field} has unsupported fields`)
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw stateError(`${field} must be a positive safe integer`)
  }
  return value as number
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw stateError(`${field} must be a bounded wire-safe identifier`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_BASE64URL.test(value)) {
    throw stateError(`${field} must be a SHA-256 base64url digest`)
  }
  return value
}

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw stateError(`${field} must be an ISO instant`)
  }
  const parsed = new Date(value).toISOString()
  if (parsed !== value) throw stateError(`${field} must be a canonical ISO instant`)
  return value
}

function stateError(message: string): OwnerCredentialStateError {
  return new OwnerCredentialStateError(`Project Workbench Owner credentials are invalid: ${message}`)
}
