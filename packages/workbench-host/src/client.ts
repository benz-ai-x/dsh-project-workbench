/** Browser-safe public data contract for the Workbench Remote namespace. */

/** The complete durable status projection shown by the walking-skeleton UI. */
export interface WorkbenchStatusSnapshot {
  readonly id: string
  readonly message: string
  readonly revision: number
  readonly updatedAt: string
}

/** Compare-and-set command for the singleton Workbench status. */
export interface SetStatusRequest {
  readonly message: string
  readonly expectedRevision: number | null
}

/** A successful status commit or a recoverable stale-writer outcome. */
export type SetStatusResult =
  | { readonly ok: true; readonly value: WorkbenchStatusSnapshot }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'revision-conflict'
      readonly message: string
      readonly current: WorkbenchStatusSnapshot | null
    }
  }
