import { describe, expect, it } from 'vitest'

import { COMMANDS, MENUS, menuCommandIds } from '../../src/application/index.js'
import type { DocumentCommandId } from '../../src/application/index.js'

/**
 * The registry is the contract between the two shells, so these are the rules
 * that keep them from drifting rather than a restatement of the data.
 *
 * The load-bearing one is completeness: native-first means the macOS menubar is
 * the reliable, complete command surface. A command that exists but has no menu
 * home is reachable only from the optional styles bar — which is precisely the
 * authority inversion this design rejects.
 */

const ids = Object.keys(COMMANDS) as DocumentCommandId[]

describe('the command registry', () => {
  it('gives every command a menu home, so the menubar is the complete surface', () => {
    const inMenus = new Set(menuCommandIds())
    const orphans = ids.filter((id) => !inMenus.has(id))
    expect(orphans).toEqual([])
  })

  it('never shows the same command in two places', () => {
    const placed = menuCommandIds()
    const duplicates = placed.filter((id, index) => placed.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  it('only references commands that exist', () => {
    for (const id of menuCommandIds()) {
      expect(COMMANDS[id], `menu references unknown command ${id}`).toBeDefined()
    }
  })

  it('keys every definition by its own id', () => {
    // A mismatch here would dispatch the wrong command from a correct-looking
    // menu item, which is the least debuggable failure this file can have.
    for (const id of ids) expect(COMMANDS[id].id).toBe(id)
  })

  it('gives every command a label a person could read in a menu', () => {
    for (const id of ids) {
      expect(COMMANDS[id].label.length, `${id} has no label`).toBeGreaterThan(0)
      expect(COMMANDS[id].label).not.toMatch(/^[a-z]+[A-Z]/)
    }
  })

  it('never binds one accelerator to two commands', () => {
    const bound = ids.map((id) => COMMANDS[id].accelerator).filter((a): a is string => a !== undefined)
    const clashes = bound.filter((accel, index) => bound.indexOf(accel) !== index)
    expect(clashes).toEqual([])
  })

  it('routes each command to exactly one executor', () => {
    for (const id of ids) expect(['editor', 'shell']).toContain(COMMANDS[id].target)
  })

  it('keeps the wireframe Format menu order: heading, emphasis, then blocks', () => {
    const format = MENUS.find((menu) => menu.label === 'Format')
    expect(format).toBeDefined()
    const first = format!.sections[0]!
    expect(typeof first[0]).toBe('object')
    expect((first[0] as { label: string }).label).toBe('Heading')
    expect(first).toContain('bold')
    expect(first).toContain('italic')
    expect(first).toContain('link')
  })

  it('adds Paragraph to the Structure group, alongside Indent and Outdent', () => {
    expect(COMMANDS.paragraph).toBeDefined()
    expect(COMMANDS.paragraph.label).toBe('Paragraph')
    expect(COMMANDS.paragraph.target).toBe('editor')

    const format = MENUS.find((menu) => menu.label === 'Format')!
    const structure = format.sections.flat().find(
      (entry): entry is { label: string; items: readonly DocumentCommandId[] } =>
        typeof entry === 'object' && entry.label === 'Structure',
    )!
    expect(structure.items).toEqual(['indentListItem', 'outdentListItem', 'paragraph'])
  })

  it('keeps the optional styles bar in View, not Format', () => {
    // It is a view preference, not a formatting authority.
    const view = MENUS.find((menu) => menu.label === 'View')
    expect(menuCommandIds([view!])).toContain('toggleStylesBar')
    expect(COMMANDS.toggleStylesBar.checkable).toBe(true)
  })

  it('puts the shared pane layouts in View and note state in Note', () => {
    const view = MENUS.find((menu) => menu.label === 'View')
    const note = MENUS.find((menu) => menu.label === 'Note')
    expect(menuCommandIds([view!])).toEqual(expect.arrayContaining([
      'showAllPanes',
      'showNotesAndEditor',
      'showEditorOnly',
    ]))
    expect(menuCommandIds([note!])).toEqual(['togglePinned'])
    expect(COMMANDS.showAllPanes.checkable).toBe(true)
    expect(COMMANDS.togglePinned.checkable).toBe(true)
  })

  it('keeps unavailable folder actions in the shared vocabulary for honest disabling', () => {
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(menuCommandIds([file!])).toEqual(expect.arrayContaining(['newNote', 'openFolder', 'openFile', 'save']))
  })

  /**
   * A group is a promise that picking one member clears the rest. The promise
   * is only keepable if every member is checkable and no member sits in two
   * groups — otherwise the menubar has no way to know what to clear.
   */
  it('makes every member of a radio group checkable', () => {
    const grouped = ids.filter((id) => COMMANDS[id].group !== undefined)
    expect(grouped.length).toBeGreaterThan(0)
    for (const id of grouped) {
      expect(COMMANDS[id].checkable, `${id} is grouped but not checkable`).toBe(true)
    }
  })

  it('never leaves a group with a single member, which would be a checkbox wearing a costume', () => {
    const sizes = new Map<string, number>()
    for (const id of ids) {
      const group = COMMANDS[id].group
      if (group !== undefined) sizes.set(group, (sizes.get(group) ?? 0) + 1)
    }
    for (const [group, size] of sizes) {
      expect(size, `group ${group} has one member`).toBeGreaterThan(1)
    }
  })

  it('keeps every member of a group inside one submenu, where a person can see the choice', () => {
    // A group split across two menus can still be cleared correctly and would
    // still be unreadable: you would see one tick and not the alternatives.
    const homes = new Map<string, Set<string>>()
    for (const menu of MENUS) {
      for (const section of menu.sections) {
        for (const entry of section) {
          const where = typeof entry === 'string' ? menu.label : `${menu.label} › ${entry.label}`
          const members = typeof entry === 'string' ? [entry] : entry.items
          for (const id of members) {
            const group = COMMANDS[id].group
            if (group === undefined) continue
            const seen = homes.get(group) ?? new Set<string>()
            seen.add(where)
            homes.set(group, seen)
          }
        }
      }
    }
    for (const [group, where] of homes) {
      expect([...where], `group ${group} is split across menus`).toHaveLength(1)
    }
  })

  it('gives the View menu Bear’s sections in Bear’s order', () => {
    const view = MENUS.find((menu) => menu.label === 'View')!
    const label = (entry: (typeof view.sections)[number][number]): string =>
      typeof entry === 'string' ? entry : entry.label

    expect(view.sections.map((section) => section.map(label))).toEqual([
      ['zoomIn', 'zoomOut', 'actualSize'],
      ['Theme', 'Font', 'Reading Width', 'Line Height', 'Paragraph Spacing', 'toggleFirstLineIndent'],
      ['Preview Style', 'Notes Sorting', 'Folders Sorting'],
      ['showEditorOnly', 'showNotesAndEditor', 'showAllPanes'],
      ['toggleStatistics', 'contents'],
      ['toggleWordCount', 'toggleStylesBar', 'toggleHistoryNavigation'],
    ])
  })

  it('binds the View accelerators Bear binds', () => {
    // Copied from the running application, not from memory.
    expect(COMMANDS.zoomIn.accelerator).toBe('CmdOrCtrl+Equal')
    expect(COMMANDS.zoomOut.accelerator).toBe('CmdOrCtrl+Minus')
    expect(COMMANDS.actualSize.accelerator).toBe('CmdOrCtrl+0')
    expect(COMMANDS.showEditorOnly.accelerator).toBe('Control+1')
    expect(COMMANDS.showNotesAndEditor.accelerator).toBe('Control+2')
    expect(COMMANDS.showAllPanes.accelerator).toBe('Control+3')
    expect(COMMANDS.toggleStatistics.accelerator).toBe('CmdOrCtrl+Shift+I')
    expect(COMMANDS.contents.accelerator).toBe('CmdOrCtrl+Shift+A')
    expect(COMMANDS.toggleWordCount.accelerator).toBe('CmdOrCtrl+Shift+W')
    expect(COMMANDS.toggleStylesBar.accelerator).toBe('CmdOrCtrl+Shift+Y')
  })

  it('orders the pane layouts narrowest first, so the shortcut number counts panes', () => {
    const view = MENUS.find((menu) => menu.label === 'View')!
    const panes = view.sections.find((section) => section.includes('showEditorOnly'))
    expect(panes).toEqual(['showEditorOnly', 'showNotesAndEditor', 'showAllPanes'])
  })

  it('makes the two document-information views one temporary panel', () => {
    for (const id of ['toggleStatistics', 'contents'] as const) {
      expect(COMMANDS[id].group).toBe('infoPanel')
    }
  })

  /**
   * Accelerators are parsed by the native menu library, not by us, and a key it
   * does not recognise is not an unbound menu item — it throws while the menubar
   * is being built and the application comes up with no menus at all. Since the
   * macOS shell is deliberately outside the Linux gate, that failure would reach
   * a person before it reached CI. So the grammar is asserted here.
   *
   * Transcribed from muda's `parse_modifier` and `parse_code`. The trap this
   * exists to catch is real and was caught by it: `Plus` looks obviously valid
   * and does not exist — the main keyboard has `Equal`, and only the numpad has
   * a plus.
   */
  const MODIFIERS = new Set(['OPTION', 'ALT', 'CONTROL', 'CTRL', 'COMMAND', 'CMD', 'SUPER', 'SHIFT',
    'COMMANDORCONTROL', 'COMMANDORCTRL', 'CMDORCTRL', 'CMDORCONTROL'])
  const KEYS = new Set([
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
    ...Array.from({ length: 21 }, (_, index) => `F${index + 1}`),
    ...Array.from({ length: 10 }, (_, index) => `DIGIT${index}`),
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `KEY${letter}`),
    'BACKQUOTE', '`', 'BACKSLASH', '\\', 'BRACKETLEFT', '[', 'BRACKETRIGHT', ']',
    'COMMA', ',', 'EQUAL', '=', 'MINUS', '-', 'PERIOD', '.', 'QUOTE', "'",
    'SEMICOLON', ';', 'SLASH', '/', 'SPACE', 'TAB', 'ENTER', 'BACKSPACE', 'DELETE',
    'INSERT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'ESC', 'ESCAPE', 'CAPSLOCK',
    'NUMLOCK', 'SCROLLLOCK', 'PRINTSCREEN',
    'UP', 'DOWN', 'LEFT', 'RIGHT', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT',
  ])

  it('binds only accelerators the native menu can actually parse', () => {
    for (const id of ids) {
      const accelerator = COMMANDS[id].accelerator
      if (accelerator === undefined) continue
      const parts = accelerator.split('+')
      const key = parts.pop()!.toUpperCase()
      expect(KEYS.has(key), `${id}: "${accelerator}" ends in unparseable key "${key}"`).toBe(true)
      for (const modifier of parts) {
        expect(
          MODIFIERS.has(modifier.toUpperCase()),
          `${id}: "${accelerator}" has unknown modifier "${modifier}"`,
        ).toBe(true)
      }
    }
  })

  it('reaches ⌘+ through Equal, the only key the grammar has for it', () => {
    expect(COMMANDS.zoomIn.accelerator).toBe('CmdOrCtrl+Equal')
    expect(COMMANDS.zoomIn.accelerator).not.toContain('Plus')
  })

  it('keeps Print its own section, and ends File with Move to Trash apart from it', () => {
    // Print and Move to Trash each render their own rule. Print grouped with
    // Save would read as a second way to keep the file rather than a way out
    // of it; Move to Trash grouped with Print would read as a routine action
    // rather than the destructive one macOS convention sets apart.
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections.at(-2)).toEqual(['print'])
    expect(file!.sections.at(-1)).toEqual(['moveToTrash'])
    expect(COMMANDS.print.accelerator).toBe('CmdOrCtrl+P')
    // The shell owns both: printing is an OS service and trashing is a
    // filesystem operation, neither an editor transaction.
    expect(COMMANDS.print.target).toBe('shell')
    expect(COMMANDS.moveToTrash.accelerator).toBe('CmdOrCtrl+Alt+Delete')
    expect(COMMANDS.moveToTrash.target).toBe('shell')
  })

  it('places Save As beside Save, with its own shortcut', () => {
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections).toContainEqual(['save', 'saveAs'])
    expect(COMMANDS.saveAs.accelerator).toBe('CmdOrCtrl+Shift+S')
    expect(COMMANDS.saveAs.target).toBe('shell')
  })
})
