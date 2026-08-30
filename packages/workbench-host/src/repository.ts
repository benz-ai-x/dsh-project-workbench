import type {
  SetStatusResult,
  WorkbenchStatusSnapshot,
} from './client.ts'

/** Provider-neutral write material prepared by the command boundary. */
export interface WorkbenchStatusMutation {
  readonly candidateId: string
  readonly message: string
  readonly expectedRevision: number | null
  readonly updatedAt: string
}

/** Portable persistence seam owned by the highest-level Workbench scenario. */
export interface WorkbenchRepository {
  /** Open the medium and migrate it before accepting commands. */
  open(): Promise<void>
  /** Return a detached current projection, or null before the first write. */
  snapshot(signal: AbortSignal): Promise<WorkbenchStatusSnapshot | null>
  /** Atomically compare, commit, and return the resulting projection. */
  setStatus(mutation: WorkbenchStatusMutation, signal: AbortSignal): Promise<SetStatusResult>
  /** Release every handle after callers have stopped admission and drained work. */
  close(): Promise<void>
}

/** Copy and freeze one projection at a process or transport boundary. */
export function statusSnapshot(value: WorkbenchStatusSnapshot): WorkbenchStatusSnapshot {
  return Object.freeze({
    id: value.id,
    message: value.message,
    revision: value.revision,
    updatedAt: value.updatedAt,
  })
}

/** Copy and freeze a complete mutation outcome. */
export function statusResult(value: SetStatusResult): SetStatusResult {
  if (value.ok) return Object.freeze({ ok: true, value: statusSnapshot(value.value) })
  const current = value.error.current === null ? null : statusSnapshot(value.error.current)
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: 'revision-conflict',
      message: value.error.message,
      current,
    }),
  })
}
