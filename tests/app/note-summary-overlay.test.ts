import { describe, expect, it } from 'vitest'
import { applySummariesToCatalog } from '../../src/app/note-summary-overlay.js'
import type { WorkspaceCatalog } from '../../src/application/index.js'

const catalog = (): WorkspaceCatalog => ({
  handle: '/notes',
  name: 'notes',
  notes: [
    { handle: '/notes/a.md', name: 'a.md', modifiedMs: 2, createdMs: 1, preview: 'First line of A.' },
    { handle: '/notes/b.md', name: 'b.md', modifiedMs: 3, createdMs: 1, preview: 'First line of B.' },
  ],
})

describe('laying summaries over a catalog', () => {
  // The defect this guards shipped twice: a summary was written into the DOM
  // and the note model, then the next reconcile rebuilt the rows from the
  // catalog — whose preview is the extracted line — and put it straight back.
  it('replaces the extracted preview where a summary has arrived', () => {
    const summaries = new Map([['/notes/a.md', 'Two sentences. The second carries the detail.']])

    const shown = applySummariesToCatalog(catalog(), summaries)

    expect(shown.notes[0]?.preview).toBe('Two sentences. The second carries the detail.')
    expect(shown.notes[1]?.preview).toBe('First line of B.')
  })

  it('leaves the catalog alone when nothing has arrived', () => {
    const original = catalog()

    expect(applySummariesToCatalog(original, new Map())).toBe(original)
  })

  it('does not mutate the catalog it is given', () => {
    const original = catalog()
    const summaries = new Map([['/notes/a.md', 'A summary.']])

    applySummariesToCatalog(original, summaries)

    expect(original.notes[0]?.preview).toBe('First line of A.')
  })

  // A summary can outlive the note it described — the folder changed while the
  // request was in flight. It must not land on whichever note is there now.
  it('ignores a summary for a note the catalog no longer lists', () => {
    const summaries = new Map([['/notes/gone.md', 'Should not appear.']])

    const shown = applySummariesToCatalog(catalog(), summaries)

    expect(shown.notes.map((note) => note.preview)).toEqual([
      'First line of A.',
      'First line of B.',
    ])
  })

  it('keeps every other field of the note untouched', () => {
    const shown = applySummariesToCatalog(catalog(), new Map([['/notes/a.md', 'A summary.']]))

    expect(shown.notes[0]).toEqual({
      handle: '/notes/a.md',
      name: 'a.md',
      modifiedMs: 2,
      createdMs: 1,
      preview: 'A summary.',
    })
  })
})
