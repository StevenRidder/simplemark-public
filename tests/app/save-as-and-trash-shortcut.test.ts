import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `bootstrap.ts` composes a real editor and DOM, so no behavioural test in
 * this suite can drive it end to end (see tests/app/native-new-note.test.ts
 * for the established reasoning). A source guard proves the wiring shape
 * instead: that Save As and Move to Trash reach the workspace hooks they're
 * supposed to, and that both stay disabled with no note open.
 */

const BOOTSTRAP = readFileSync('src/app/bootstrap.ts', 'utf8')

/** The body of a top-level `function <name>` in the composition closure. */
function closureFunction(name: string): string {
  const start = BOOTSTRAP.indexOf(`  function ${name}(`)
  expect(start, `${name} should exist in src/app/bootstrap.ts`).toBeGreaterThan(-1)
  const end = BOOTSTRAP.indexOf('\n  }\n', start)
  expect(end, `${name} should be a two-space-indented closure member`).toBeGreaterThan(start)
  return BOOTSTRAP.slice(start, end)
}

describe('dispatching saveAs and moveToTrash', () => {
  const runCommand = closureFunction('runCommand')
  const commandState = closureFunction('commandState')

  it('routes saveAs to the workspace hook, with the active note as its target', () => {
    expect(runCommand).toMatch(/case 'saveAs':\s*\n\s*void options\.workspace\?\.onSaveNoteAs\?\.\(options\.workspace\?\.activeNoteId/)
  })

  it('routes moveToTrash to the existing trash hook, with the active note as its target', () => {
    expect(runCommand).toMatch(/case 'moveToTrash':\s*\n\s*void options\.workspace\?\.onTrashNote\?\.\(options\.workspace\?\.activeNoteId/)
  })

  it('disables saveAs when there is no active note or no hook to reach', () => {
    expect(commandState).toMatch(/id === 'saveAs'/)
    expect(commandState).toMatch(/onSaveNoteAs !== undefined && active !== undefined/)
  })

  it('disables moveToTrash when there is no active note or no hook to reach', () => {
    expect(commandState).toMatch(/id === 'moveToTrash'/)
    expect(commandState).toMatch(/onTrashNote !== undefined && active !== undefined/)
  })
})

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

/** The body of a top-level `const <name> = ...` arrow in the shell's closure. */
function shellFunction(name: string): string {
  const start = TAURI.indexOf(`  const ${name} = `)
  expect(start, `${name} should exist in src/app/tauri.ts`).toBeGreaterThan(-1)
  const end = TAURI.indexOf('\n  }\n', start)
  expect(end, `${name} should be a two-space-indented closure member`).toBeGreaterThan(start)
  return TAURI.slice(start, end)
}

describe('saveNoteAs in the native shell', () => {
  const saveNoteAs = shellFunction('saveNoteAs')

  it('declines to save-as the unsaved draft, which has no file to copy', () => {
    expect(saveNoteAs).toContain('DRAFT_NOTE_ID')
  })

  it('tells the person to save the note first, instead of silently doing nothing on the draft', () => {
    expect(saveNoteAs).toMatch(
      /if \(handle === DRAFT_NOTE_ID\) \{\s*\n\s*current\.setStatus\('error', 'Save this note before using Save As'\)\s*\n\s*return\s*\n\s*\}/,
    )
  })

  it('flushes pending edits before asking the backend to copy the file', () => {
    expect(saveNoteAs.indexOf('flush()')).toBeGreaterThan(-1)
    expect(saveNoteAs.indexOf('flush()')).toBeLessThan(saveNoteAs.indexOf("invoke<"))
  })

  it('calls the save_note_as command', () => {
    expect(saveNoteAs).toContain("invoke<{ readonly handle: string } | null>('save_note_as', { handle })")
  })

  it('does nothing when the save dialog is cancelled', () => {
    expect(saveNoteAs).toMatch(/if \(saved === null\) return/)
  })

  it('checks whether the saved handle actually landed in the refreshed folder catalog', () => {
    expect(saveNoteAs).toContain('const refreshed = await catalogPort.listFolder(activeCollectionId)')
    expect(saveNoteAs).toContain('collections.addFolder(refreshed)')
    expect(saveNoteAs).toContain('refreshed.notes.some((note) => note.handle === saved.handle)')
  })

  it("falls back to 'recent' when the save destination isn't in the active folder", () => {
    expect(saveNoteAs).toMatch(
      /if \(!refreshed\.notes\.some\(\(note\) => note\.handle === saved\.handle\)\) \{\s*\n\s*destinationCollectionId = 'recent'\s*\n\s*\}/,
    )
  })

  it('installs the saved copy as the active document, like Save As switches you to it', () => {
    expect(saveNoteAs).toContain('install(port, opened, destinationCollectionId)')
  })

  it('is reachable from the command registry through the shared workspace actions', () => {
    expect(shellFunction('workspaceActions')).toContain('saveNoteAs,')
    expect(TAURI).toContain('onSaveNoteAs: actions.saveNoteAs,')
  })
})
