import { describe, expect, it } from 'vitest'

import { MACOS_TEXT_SERVICE_MENUS, repaintAll, trashAcceleratorIsSafe } from '../../src/app/ui/native-menu.js'

describe('native macOS service menu contract', () => {
  it('routes language and speech features to named platform services', () => {
    expect(MACOS_TEXT_SERVICE_MENUS.map((menu) => menu.label)).toEqual([
      'Spelling and Grammar',
      'Substitutions',
      'Speech',
    ])
    const ids = MACOS_TEXT_SERVICE_MENUS.flatMap((menu) => menu.items.map((item) => item.id))
    expect(ids).toEqual([
      'show_spelling_and_grammar',
      'check_spelling',
      'toggle_continuous_spell_checking',
      'toggle_grammar_checking',
      'show_substitutions',
      'toggle_smart_quotes',
      'toggle_smart_dashes',
      'toggle_text_replacement',
      'start_speaking',
      'stop_speaking',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the Move to Trash accelerator', () => {
  it('is safe on macOS, where Cmd+Option+Delete reaches the app', () => {
    expect(trashAcceleratorIsSafe('MacIntel')).toBe(true)
    expect(trashAcceleratorIsSafe('Mac')).toBe(true)
  })

  it('is unsafe on Windows, which reserves Ctrl+Alt+Delete for itself before any app sees it', () => {
    expect(trashAcceleratorIsSafe('Win32')).toBe(false)
  })

  it('is unsafe on Linux, which has no Cmd/Option keys to translate the accelerator into', () => {
    expect(trashAcceleratorIsSafe('Linux x86_64')).toBe(false)
  })
})

// Final review Finding 1: before this, the only thing that ever repainted an
// item's enabled/checked state was `activate` — a menu item actually being
// clicked. A selection change with no menu click in it (picking a diagram
// block, say) left the Format → Diagram ids exactly as stale as they were
// when the menu was built. `installNativeMenu` itself needs a real Tauri
// runtime to construct `MenuItem`/`Submenu` and so cannot run headless here
// (this suite is `environment: 'node'`, no `window`, no IPC bridge) — but
// `repaintAll` and the `Repaint` closures it drives are plain functions with
// no Tauri dependency, so the mechanism the fix relies on is covered directly.
// The full wiring (native-menu.ts's real item construction, and tauri.ts's
// hook from editor selection changes into this) is verified by manual pass
// against the running app instead — see the final fix report.
describe('repaintAll, the exported native menu repaint routine', () => {
  it('runs every registered repaint, in order, not just the first', () => {
    const order: number[] = []
    repaintAll([
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  it('re-reads state on every call, so a caller outside activate — a selection change, not a click — still syncs an item', () => {
    // Mirrors what buildEntry's own per-item closure does: read state() fresh
    // each time repaint runs, rather than once when the item was built.
    let diagramSelected = false
    const fakeMenuItem = { enabled: false }
    const repaints = [() => { fakeMenuItem.enabled = diagramSelected }]

    repaintAll(repaints)
    expect(fakeMenuItem.enabled).toBe(false)

    // The selection moved onto a diagram block. No menu item was clicked.
    diagramSelected = true
    repaintAll(repaints)
    expect(fakeMenuItem.enabled).toBe(true)
  })

  it('tolerates a menu with nothing built yet', () => {
    expect(() => repaintAll([])).not.toThrow()
  })
})
