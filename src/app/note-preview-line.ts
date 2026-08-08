/**
 * The subtitle text for one note-list row.
 *
 * Every row used to show the constant `'Local Markdown file'`, which told the
 * reader nothing at all. A note with no prose now shows nothing rather than
 * boilerplate, and the row's title and date still carry it.
 *
 * Kept out of `tauri.ts` so it can be tested: the composition root touches the
 * DOM, and `vitest.config.ts` runs in `node` deliberately, so importing that
 * module from a test fails on `document is not defined`.
 */
export function previewFor(note: { readonly preview?: string | null }): string {
  // `null` is accepted as well as absent. The native catalog skips the field
  // entirely, but a JSON producer that emits `null` must not put the string
  // "null" under someone's note title.
  return note.preview ?? ''
}
