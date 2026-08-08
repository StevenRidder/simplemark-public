import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The native shell must never decide anything from a stale session.
 *
 * Milkdown's listener plugin debounces `markdownUpdated` by 200ms, so for a
 * moment after each keystroke `session.snapshot()` describes the *previous*
 * document. The shell reads that snapshot to answer two questions, and both
 * answers are irreversible: whether a new note is untouched enough to discard
 * without raising a destination panel, and what a draft — which has no file
 * behind it — puts on the clipboard. Answering the first one from a stale
 * snapshot throws away whatever was typed in the last fraction of a second,
 * silently, with no panel and no undo.
 *
 * `AppComposition.flushPendingChanges()` closes the gap, and the contract it
 * offers is proved behaviourally against the real editor in
 * tests/ui/session-freshness.spec.ts. What cannot be proved there is that this
 * shell actually calls it: the native entrypoint self-starts on import and
 * talks to AppKit, so no test in this suite can reach it. A source guard can,
 * and the thing worth guarding is the ordering — a flush that happens after the
 * read is the same bug with more code.
 *
 * If this fails, the question is not "how do I satisfy the test" but "what is
 * this new snapshot reader about to decide from a document that is a moment out
 * of date".
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

/** Every closure member that reads the session, paired with its source. */
function snapshotReaders(): { readonly name: string; readonly body: string }[] {
  const readers: { name: string; body: string }[] = []
  for (let at = TAURI.indexOf('session.snapshot()'); at > -1; at = TAURI.indexOf('session.snapshot()', at + 1)) {
    const opening = TAURI.lastIndexOf('\n  const ', at)
    expect(opening, 'a session read should sit inside a closure member').toBeGreaterThan(-1)
    const name = TAURI.slice(opening + '\n  const '.length, at).match(/^[A-Za-z0-9_]+/u)?.[0]
    expect(name, 'a session read should sit inside a named closure member').toBeDefined()
    readers.push({ name: name!, body: TAURI.slice(opening, at) })
  }
  return readers
}

describe('the native shell reading its session', () => {
  it('reads the session somewhere, so this guard still has something to guard', () => {
    expect(snapshotReaders().length).toBeGreaterThan(0)
  })

  it('flushes before every read, never after', () => {
    for (const reader of snapshotReaders()) {
      // The body here is everything from the start of the closure member up to
      // the read itself, so a flush appearing in it is a flush that happened
      // first. One placed below the read would not show up.
      expect(
        reader.body,
        `${reader.name} reads session.snapshot() without flushing the editor first`,
      ).toContain('flushPendingChanges()')
    }
  })

  it('keeps the draft check flushing itself, not trusting its one call site', () => {
    // `discardsUntouchedDraft` short-circuits `flush()`, so the save that would
    // otherwise have brought the session up to date never runs when this answers
    // true. Holding the flush inside the check means the guarantee travels with
    // it to any future caller, rather than being a rule the next one remembers.
    const check = shellFunction('discardsUntouchedDraft')
    expect(check.indexOf('flushPendingChanges()')).toBeGreaterThan(-1)
    expect(check.indexOf('flushPendingChanges()')).toBeLessThan(check.indexOf('session.snapshot()'))
  })
})
