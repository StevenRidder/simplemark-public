import type { WorkspaceCatalogEntry } from '../application/index.js'
import type { WorkspaceNote } from './ui/window-chrome.js'
import { previewFor } from './note-preview-line.js'

/**
 * The middle pane's rows, assembled as a value.
 *
 * This exists because the shell used to have two ways to describe the note
 * list: the real catalog, and a synthetic one-row shape borrowed from the
 * welcome screen. Creating a note reached for the second one, so the list
 * emptied itself until the new note was saved and the first one came back.
 *
 * An unsaved new note is a row, not a different note list. Keeping that
 * decision in one pure function is what stops the two shapes drifting apart
 * again.
 */

/**
 * Identity for the row standing in for an unsaved new note.
 *
 * Deliberately not a path: nothing on disk answers to it, and every action the
 * shell can take on a row has to be able to tell it apart from a real note
 * before it reaches the filesystem.
 */
export const DRAFT_NOTE_ID = 'draft:new-note'

/** What an unsaved note is called until a save gives it a real file name. */
const DRAFT_NOTE_TITLE = 'Untitled'

/** A new note that exists only in the editor until the first save names a file. */
function draftRow(): WorkspaceNote {
  return {
    id: DRAFT_NOTE_ID,
    title: DRAFT_NOTE_TITLE,
    preview: 'New note — not saved yet',
    updatedLabel: 'Now',
    // Never pinned, and given no stamps: pinning sorts a row above the whole
    // catalog, and a stamp would be a claim about a file that does not exist.
    pinned: false,
  }
}

export function noteRows(
  notes: readonly WorkspaceCatalogEntry[],
  isPinned: (handle: string) => boolean,
  options: { readonly draft?: boolean; readonly now?: number } = {},
): readonly WorkspaceNote[] {
  const rows = notes.map((note) => ({
    id: note.handle,
    identifier: note.name,
    portableLink: `./${note.name}`,
    title: note.name.replace(/\.(md|markdown)$/i, ''),
    preview: previewFor(note),
    updatedLabel: relativeDate(note.modifiedMs, options.now),
    // A zero stamp means the catalog does not know, and the View menu disables
    // the date sorts for a catalog that cannot answer. Passing 0 through would
    // answer with 1970 instead, which sorts but lies.
    ...(note.modifiedMs === 0 ? {} : { updatedAt: note.modifiedMs }),
    ...(note.createdMs === 0 ? {} : { createdAt: note.createdMs }),
    pinned: isPinned(note.handle),
  }))
  return options.draft === true ? [draftRow(), ...rows] : rows
}

export function relativeDate(modifiedMs: number, now = Date.now()): string {
  if (modifiedMs === 0) return 'Unknown'
  const elapsed = Math.max(0, now - modifiedMs)
  if (elapsed < 60_000) return 'Now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  if (elapsed < 172_800_000) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(modifiedMs)
}
