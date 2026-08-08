import { describe, expect, it } from 'vitest'

import { DRAFT_NOTE_ID, noteRows, relativeDate } from '../../src/app/workspace-view.js'
import type { WorkspaceCatalogEntry } from '../../src/application/index.js'

/**
 * The middle pane's rows, as a value.
 *
 * A new note used to be shown by swapping the whole workspace for a synthetic
 * one-row welcome shape, which is why creating a note emptied the note list.
 * Rows are assembled here instead so that "there is an unsaved new note" is one
 * more row in the real catalog rather than a different catalog.
 */

const NOTES: readonly WorkspaceCatalogEntry[] = [
  { handle: '/notes/roadmap.md', name: 'roadmap.md', modifiedMs: 1_000, createdMs: 500 },
  { handle: '/notes/meeting.md', name: 'meeting.md', modifiedMs: 2_000, createdMs: 600 },
]

const unpinned = (): boolean => false

describe('note rows', () => {
  it('carries every catalog note through, in catalog order', () => {
    const rows = noteRows(NOTES, unpinned)
    expect(rows.map((row) => row.id)).toEqual(['/notes/roadmap.md', '/notes/meeting.md'])
    expect(rows.map((row) => row.title)).toEqual(['roadmap', 'meeting'])
  })

  it('reports each note as pinned exactly when the pin store says so', () => {
    const rows = noteRows(NOTES, (handle) => handle === '/notes/meeting.md')
    expect(rows.map((row) => row.pinned)).toEqual([false, true])
  })

  it('keeps the whole catalog visible while a new note is unsaved', () => {
    const rows = noteRows(NOTES, unpinned, { draft: true })
    expect(rows.map((row) => row.id)).toEqual([
      DRAFT_NOTE_ID,
      '/notes/roadmap.md',
      '/notes/meeting.md',
    ])
  })

  it('puts the unsaved note at the top of the list', () => {
    const [first] = noteRows(NOTES, unpinned, { draft: true })
    expect(first?.id).toBe(DRAFT_NOTE_ID)
    expect(first?.title).toBe('Untitled')
    expect(first?.pinned).toBe(false)
  })

  it('never pins the unsaved note, whatever the pin store claims', () => {
    const rows = noteRows(NOTES, () => true, { draft: true })
    expect(rows[0]?.id).toBe(DRAFT_NOTE_ID)
    expect(rows[0]?.pinned).toBe(false)
  })

  it('offers a draft row even when no note has been opened yet', () => {
    expect(noteRows([], unpinned, { draft: true }).map((row) => row.id)).toEqual([DRAFT_NOTE_ID])
  })

  it('gives the draft no timestamps, because it has none until it is saved', () => {
    const [first] = noteRows(NOTES, unpinned, { draft: true })
    expect(first?.updatedAt).toBeUndefined()
    expect(first?.createdAt).toBeUndefined()
  })

  it('carries real stamps through, so the date sorts stay available', () => {
    const [roadmap] = noteRows(NOTES, unpinned)
    expect(roadmap?.updatedAt).toBe(1_000)
    expect(roadmap?.createdAt).toBe(500)
  })

  it('omits a stamp the catalog could not supply rather than claiming epoch', () => {
    // A zero means "unknown". Passing it through as 0 would sort the note to
    // the far end of every date order as though it were genuinely that old.
    const undated = [{ handle: '/a.md', name: 'a.md', modifiedMs: 0, createdMs: 0 }]
    const [row] = noteRows(undated, unpinned)
    expect(row?.updatedAt).toBeUndefined()
    expect(row?.createdAt).toBeUndefined()
    expect(row?.updatedLabel).toBe('Unknown')
  })
})

describe('relative dates', () => {
  const now = 1_700_000_000_000

  it('says Unknown when the catalog has no stamp', () => {
    expect(relativeDate(0, now)).toBe('Unknown')
  })

  it('reads the clock passed to it rather than the wall clock', () => {
    expect(relativeDate(now - 30_000, now)).toBe('Now')
    expect(relativeDate(now - 5 * 60_000, now)).toBe('5m')
    expect(relativeDate(now - 3 * 3_600_000, now)).toBe('3h')
    expect(relativeDate(now - 30 * 3_600_000, now)).toBe('Yesterday')
  })
})
