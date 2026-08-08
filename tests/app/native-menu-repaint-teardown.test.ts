import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A note switch must not throw at a dead editor.
 *
 * `mount()` (src/app/tauri.ts) runs once per opened note, each preceded by
 * `await current.destroy()`. The debounced native-menu repaint timer
 * (final review Finding 1) is armed by every editor selection change,
 * including one that lands in the last 50ms before a note switch — so
 * without a teardown guard, a timer belonging to the *old* note's
 * composition fires after that composition's editor is destroyed.
 * `repaint()` reads `commandState` → `editor.diagram.kind()` → the Milkdown
 * ctx, and throws `contextNotFound` once that ctx is torn down. Uncaught,
 * since a `setTimeout` callback has no caller left to catch it.
 *
 * Two belts: cancel the pending timer the moment this composition's own
 * `destroy()` runs, and guard the callback itself so a timer that still
 * manages to fire late — from a different composition's schedule, or an
 * out-of-order event — is a no-op rather than a throw.
 *
 * The native entrypoint self-starts on import and talks to AppKit (the same
 * reason tests/app/native-session-freshness.test.ts reads this file as text
 * rather than importing it), so this guards the fix's source shape instead
 * of driving a real timer through a real teardown.
 */

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

/** The text between two markers, asserting both exist and appear in order. */
function between(startMarker: string, endMarker: string): string {
  const start = TAURI.indexOf(startMarker)
  expect(start, `expected to find "${startMarker}" in src/app/tauri.ts`).toBeGreaterThan(-1)
  const end = TAURI.indexOf(endMarker, start + startMarker.length)
  expect(end, `expected to find "${endMarker}" after "${startMarker}" in src/app/tauri.ts`).toBeGreaterThan(start)
  return TAURI.slice(start, end)
}

describe('the native menu repaint timer survives a note switch without throwing', () => {
  it('belt 1 — cancels the pending timer in the same place this composition is torn down', () => {
    const destroyWrapper = between('app.destroy = async () => {', 'await composedDestroy()')
    expect(destroyWrapper, 'destroy() should flag this composition as torn down').toContain(
      'compositionTornDown = true',
    )
    expect(destroyWrapper, 'destroy() should cancel the pending repaint timer').toContain(
      'clearTimeout(menuRepaintTimer)',
    )
  })

  it('belt 2 — guards the debounced callback so a late fire is a no-op, checked before repainting', () => {
    const schedule = between('const scheduleMenuRepaint = (): void => {', 'nativeMenu?.repaint()')
    expect(
      schedule,
      'the timer callback should refuse to repaint once this composition is torn down',
    ).toContain('if (compositionTornDown) return')
  })
})
