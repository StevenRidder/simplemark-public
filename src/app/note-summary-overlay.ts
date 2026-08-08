import type { WorkspaceCatalog } from '../application/index.js'

/**
 * Lays summaries that have arrived over a catalog's extracted previews.
 *
 * Patching the row's DOM when a summary arrives is not enough on its own, and
 * that was a real defect rather than a theoretical one: the catalog's `preview`
 * is the extracted lead sentence, so every reconcile — and every remount, which
 * happens on each note open — rebuilt the rows from the catalog and put the
 * extracted line straight back. Summaries appeared and then vanished.
 *
 * Pure and separate from `tauri.ts` so it can be tested: the composition root
 * touches the DOM, and vitest runs in `node` deliberately.
 */
export function applySummariesToCatalog(
  catalog: WorkspaceCatalog,
  summaries: ReadonlyMap<string, string>,
): WorkspaceCatalog {
  if (summaries.size === 0) return catalog
  return {
    ...catalog,
    notes: catalog.notes.map((note) => {
      const summary = summaries.get(note.handle)
      return summary === undefined ? note : { ...note, preview: summary }
    }),
  }
}
