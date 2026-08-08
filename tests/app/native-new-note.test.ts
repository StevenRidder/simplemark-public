import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Creating a note must not empty the note list.
 *
 * The native shell composes a whole new app around every document transition,
 * and each transition has to say what the middle pane shows. `createNote` used
 * to answer that with the welcome-screen shape, whose note list was a single
 * synthetic row for the current file. So a new note replaced
 * the entire catalog with one "Untitled" row, and the real list only returned
 * when saving routed back through `install` and the catalog shape.
 *
 * The native shell is a composition root: it opens real windows, talks to
 * AppKit, and self-starts on import, so no behavioural test in this suite can
 * reach it. A source guard can, and the thing worth guarding is not the pixels
 * but the wiring decision that produced them — which workspace shape a new note
 * is composed with, and whether it quietly changes collection on the way.
 */

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

/** The body of a top-level `const <name> = ...` arrow in the shell's closure. */
function shellFunction(name: string): string {
  const start = TAURI.indexOf(`  const ${name} = `)
  expect(start, `${name} should exist in src/app/tauri.ts`).toBeGreaterThan(-1)
  // Every function in this closure is indented two spaces and closes on a line
  // that is nothing but `  }`, so the first one after the opening ends it.
  const end = TAURI.indexOf('\n  }\n', start)
  expect(end, `${name} should be a two-space-indented closure member`).toBeGreaterThan(start)
  return TAURI.slice(start, end)
}

describe('creating a note in the native shell', () => {
  const createNote = shellFunction('createNote')

  it('does not swap the catalog for the bundled sample shape', () => {
    expect(createNote).not.toContain('mountSample(')
  })

  it('composes the new note against the real catalog', () => {
    expect(createNote).toContain('workspaceView(')
  })

  it('builds that view from the collection catalog, draft row included', () => {
    // `workspaceView` is the single builder every catalog mount goes through.
    // If a new note is composed with it, a new note gets the real note list.
    const view = shellFunction('workspaceView')
    expect(view).toContain('collections.collection(')
    expect(view).toContain('catalogWorkspace(')
    expect(view).toMatch(/\bdraft,?\s*\n?\s*\)/)
  })

  it('marks the document a draft rather than inventing a note list for it', () => {
    expect(createNote).toMatch(/\bdraft = true\b/)
  })

  it('leaves you in the collection you were browsing', () => {
    expect(createNote).not.toMatch(/activeCollectionId = /)
    expect(createNote).not.toMatch(/workspaceHandle = /)
  })

  it('focuses the editor so typing or pasting works without an extra click', () => {
    expect(createNote).toContain('current.editor.focusEnd()')
  })

})

describe('the unsaved note is never mistaken for a file', () => {
  it('builds its row from the shared, tested assembly', () => {
    expect(TAURI).toContain("from './workspace-view.js'")
    expect(TAURI).toContain('noteRows(')
  })

  it('refuses to hand the draft row id to the filesystem', () => {
    // Row actions are wired straight to catalog handles. The draft's id answers
    // to nothing on disk, so every one of them has to be able to recognise it.
    expect(TAURI).toContain('DRAFT_NOTE_ID')
    expect(shellFunction('openInCollection')).toContain('DRAFT_NOTE_ID')
  })

  it('discards an untouched draft instead of demanding a destination for it', () => {
    // Navigating away from a new note you never typed in must not raise a save
    // panel; that is the modal that made "go back to Recent Notes" feel broken.
    expect(TAURI).toContain('discardsUntouchedDraft')
  })
})
