import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * EDITOR-14's hard constraint, enforced structurally: **the native context
 * menu and plain Copy are not ours to replace.**
 *
 * The ordinary copy path belongs to ProseMirror and Milkdown's clipboard
 * plugin. The context menu adds choices beside it and must never wrap, proxy
 * or re-implement it. A behavioural test cannot prove that — it can only show
 * one case working — but a source guard can: if nobody registers a copy
 * handler or a clipboard serializer, then Cmd+C provably still does what it
 * always did.
 *
 * If this fails, the question is not "how do I satisfy the test" but "why is
 * something now intercepting copy".
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

const FILES = sourceFiles('src')

describe('the ordinary copy path is untouched', () => {
  it('registers no copy or cut DOM handler anywhere in src', () => {
    const offenders = FILES.filter((file) =>
      /addEventListener\(\s*['"](copy|cut)['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('installs no custom clipboard serializer', () => {
    const offenders = FILES.filter((file) =>
      /clipboardTextSerializer|clipboardSerializer/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('overrides no handleDOMEvents copy hook', () => {
    const offenders = FILES.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /handleDOMEvents/.test(text) && /\bcopy\b/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('the context menu delegates Copy to the platform, not to an export', () => {
    const chrome = readFileSync('src/app/ui/window-chrome.ts', 'utf8')
    expect(chrome).toContain("document.execCommand('copy')")
  })

  it('returns to WebKit before the browser fallback cancels contextmenu', () => {
    const chrome = readFileSync('src/app/ui/window-chrome.ts', 'utf8')
    expect(chrome).toMatch(
      /if \(isMacOS && options\.onNativeContextMenu !== undefined\) \{[\s\S]*?return\s*\}\s*event\.preventDefault\(\)/,
    )
  })

  it('augments the unattached native menu after Copy without clearing it', () => {
    const native = readFileSync('src-tauri/src/macos_context_menu.rs', 'utf8')
    expect(native).toContain('NSMenuDidBeginTrackingNotification')
    expect(native).toContain('WKMenuItemIdentifierCopy')
    expect(native).toContain('sel!(copy:)')
    expect(native).toContain('menu.insertItem_atIndex(&parent, copy_index as isize + 1)')
    expect(native).not.toContain('removeAllItems')
  })

  it('keeps contextual Code and Table exports inside Copy As', () => {
    const native = readFileSync('src-tauri/src/macos_context_menu.rs', 'utf8')
    expect(native).toContain('if shape.in_code')
    expect(native).toContain('"Code", "copyCode"')
    expect(native).toContain('if shape.in_table')
    expect(native).toContain('"CSV", "copyTableAsCsv"')
  })
})
