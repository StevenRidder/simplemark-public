const HISTORY_STORAGE_KEY = 'simplemark.workspace-history.v1'

/**
 * How many visits are kept. Deep enough that a day of note-hopping never hits
 * it, shallow enough that the persisted blob stays small.
 */
const HISTORY_LIMIT = 200

/**
 * One place you went: a note, and the collection you were browsing when you
 * opened it.
 *
 * The collection rides along because going back to a note without going back to
 * the list it came from leaves the sidebar showing a catalog the open note is
 * not in — which reads as a bug rather than as navigation.
 */
export interface Visit {
  readonly handle: string
  readonly collectionId: string
}

function sameVisit(left: Visit, right: Visit): boolean {
  return left.handle === right.handle && left.collectionId === right.collectionId
}

function isVisit(value: unknown): value is Visit {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<Record<keyof Visit, unknown>>
  return typeof record.handle === 'string'
    && record.handle.trim() !== ''
    && typeof record.collectionId === 'string'
}

/**
 * Where you have been, in the order you went there.
 *
 * A back button is not a most-recently-used list, and that difference is the
 * whole reason this exists instead of reusing Recent Notes: an MRU reorders
 * itself on every visit, so "back" twice would oscillate between two notes and
 * "forward" would have no meaning at all. History needs a cursor into a fixed
 * sequence, which is a different shape from anything the collections hold.
 *
 * The rule encoded here is the browser's: visiting while parked mid-stack
 * discards everything ahead of the cursor. That branch is gone on purpose — it
 * is the path you did not take.
 *
 * Pure by design. No storage, no DOM, no file access, so the awkward cases
 * (empty, one entry, cursor at either end, branch truncation) are ordinary unit
 * tests rather than something only a running app can exercise.
 */
export class VisitHistory {
  #entries: Visit[]
  /** Index of the entry currently open; -1 when nothing has been visited. */
  #cursor: number

  constructor(entries: readonly Visit[] = [], cursor: number = entries.length - 1) {
    this.#entries = [...entries]
    this.#cursor = Math.min(Math.max(Math.trunc(cursor), -1), this.#entries.length - 1)
  }

  entries(): readonly Visit[] {
    return [...this.#entries]
  }

  cursor(): number {
    return this.#cursor
  }

  current(): Visit | undefined {
    return this.#entries[this.#cursor]
  }

  canBack(): boolean {
    return this.#cursor > 0
  }

  canForward(): boolean {
    return this.#cursor < this.#entries.length - 1
  }

  /**
   * Records an arrival. Re-opening the note already showing is not a new place
   * to have been, so it is ignored rather than stacked — otherwise every
   * repaint-triggered reselect would pad the stack with entries that go nowhere.
   */
  visit(entry: Visit): void {
    const current = this.current()
    if (current !== undefined && sameVisit(current, entry)) return
    this.#entries.length = this.#cursor + 1
    this.#entries.push(entry)
    if (this.#entries.length > HISTORY_LIMIT) {
      this.#entries.splice(0, this.#entries.length - HISTORY_LIMIT)
    }
    this.#cursor = this.#entries.length - 1
  }

  /** Steps back one entry, or returns undefined when there is nowhere to go. */
  back(): Visit | undefined {
    if (!this.canBack()) return undefined
    this.#cursor -= 1
    return this.#entries[this.#cursor]
  }

  /** Steps forward one entry, or returns undefined at the head of the stack. */
  forward(): Visit | undefined {
    if (!this.canForward()) return undefined
    this.#cursor += 1
    return this.#entries[this.#cursor]
  }

  /**
   * Drops entries the workspace can no longer open, keeping the cursor on the
   * nearest surviving entry at or before where it was.
   *
   * A persisted history outlives the files in it: notes get renamed, moved, and
   * deleted between launches. Pruning at load keeps a dead handle from becoming
   * a Back button that appears to work and then does nothing.
   */
  retain(keep: (visit: Visit) => boolean): void {
    const survivors: Visit[] = []
    let cursor = -1
    for (const [index, visit] of this.#entries.entries()) {
      if (!keep(visit)) continue
      survivors.push(visit)
      if (index <= this.#cursor) cursor = survivors.length - 1
    }
    this.#entries = survivors
    this.#cursor = cursor
  }
}

/**
 * Persists the stack and the cursor across launches.
 *
 * Only opaque handles are stored, never note bytes or metadata — the same rule
 * the folder, recent, and hidden stores follow, for the same reason: the
 * filesystem stays authoritative and stale metadata never masquerades as truth.
 */
export class WorkspaceHistoryStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  load(): VisitHistory {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(HISTORY_STORAGE_KEY) ?? 'null')
      if (value === null || typeof value !== 'object') return new VisitHistory()
      const record = value as { entries?: unknown; cursor?: unknown }
      const entries = Array.isArray(record.entries) ? record.entries.filter(isVisit) : []
      const cursor = typeof record.cursor === 'number' ? record.cursor : entries.length - 1
      return new VisitHistory(entries, cursor)
    } catch {
      // A corrupt blob costs you your history, not your launch.
      return new VisitHistory()
    }
  }

  save(history: VisitHistory): void {
    try {
      this.storage.setItem(
        HISTORY_STORAGE_KEY,
        JSON.stringify({ entries: history.entries(), cursor: history.cursor() }),
      )
    } catch {
      // Navigation still works for this session when storage is unavailable.
    }
  }
}
