/**
 * Previous/Next Note over a list that reorders while you walk it.
 *
 * Recent Notes is ordered by recency, and opening a note moves it to the front.
 * So resolving "the note after this one" from the list *as it currently stands*
 * is a trap: step to the second note, it becomes the first, and the second is
 * now the note you just left. Down, down, down bounces between two notes
 * forever. That is the same most-recently-used reordering that makes an MRU
 * useless as a back button, arriving from the other direction.
 *
 * The fix is to walk the order the walk started in. A run of presses steps
 * through one remembered sequence; the list is free to re-sort underneath and
 * the walk ignores it. Anything that is not a continuation — a sidebar click, a
 * search that changes which notes are listed, a new note — starts a fresh walk
 * from what is on screen at that moment.
 *
 * Kept as a separate unit because the reordering case is the whole difficulty
 * and it is invisible in a shell whose list never re-sorts. Here it is ordinary
 * unit tests rather than something only the packaged app can show.
 */
export class NoteWalk {
  /** The sequence being walked, or null before the first step. */
  #order: readonly string[] | null = null
  /** The note this walk last moved to, used to detect it is still the one driving. */
  #current: string | undefined

  /**
   * Returns the note to open, or undefined when there is nowhere to go.
   *
   * Wraps at both ends: the note after the last is the first. A list of one has
   * nowhere to go, and wrapping onto yourself is not movement, so both answer
   * undefined rather than reopening what is already showing.
   */
  step(displayed: readonly string[], activeId: string, delta: 1 | -1): string | undefined {
    if (displayed.length < 2) {
      this.reset()
      return undefined
    }

    const present = new Set(displayed)
    // A run continues only while this walk is what last moved the selection and
    // the remembered sequence still covers exactly the notes on screen. Order
    // may differ — that is the churn being ignored — but membership may not.
    const continuing = this.#order !== null
      && this.#current === activeId
      && this.#order.length === displayed.length
      && this.#order.every((id) => present.has(id))
    const order = continuing ? this.#order! : displayed

    const index = order.indexOf(activeId)
    const next = index === -1
      // The open note is not in the list at all — mid-search, say. Enter from
      // whichever end the direction is heading toward.
      ? (delta === 1 ? order[0] : order[order.length - 1])
      : order[(index + delta + order.length) % order.length]

    this.#order = order
    this.#current = next
    return next === activeId ? undefined : next
  }

  /** Forgets the remembered sequence, so the next step reads the live list. */
  reset(): void {
    this.#order = null
    this.#current = undefined
  }
}
