import { describe, expect, it, vi } from 'vitest'

import { BrowserClipboardPort } from '../../src/adapters/clipboard/browser-clipboard-port.js'

/**
 * EDITOR-10 acceptance: "clipboard payloads are asserted with adapter fakes."
 *
 * The fake records exactly what each call hands the platform, which is the only
 * way to prove a rich copy really carries both flavours and that a refused
 * write is reported rather than swallowed.
 */

function fakeClipboard(options: { rejectRich?: boolean; rejectText?: boolean } = {}) {
  const written: Array<Record<string, string>> = []
  const clipboard = {
    write: vi.fn(async (items: Array<Record<string, Blob>>) => {
      if (options.rejectRich === true) throw new DOMException('denied', 'NotAllowedError')
      const entry: Record<string, string> = {}
      for (const [type, blob] of Object.entries(items[0] ?? {})) entry[type] = await blob.text()
      written.push(entry)
    }),
    writeText: vi.fn(async (text: string) => {
      if (options.rejectText === true) throw new DOMException('denied', 'NotAllowedError')
      written.push({ 'text/plain': text })
    }),
    readText: vi.fn(async () => 'clipboard text'),
  }
  const makeItem = (parts: Record<string, Blob>): ClipboardItem => parts as unknown as ClipboardItem
  return { clipboard, makeItem, written }
}

describe('BrowserClipboardPort.write', () => {
  it('carries both flavours when there is rich content', async () => {
    const { clipboard, makeItem, written } = fakeClipboard()
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, makeItem)

    const ok = await port.write({ 'text/plain': 'Plain words', 'text/html': '<b>Rich</b>' })

    expect(ok).toBe(true)
    expect(written).toEqual([{ 'text/plain': 'Plain words', 'text/html': '<b>Rich</b>' }])
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('uses the plain path when there is nothing rich to carry', async () => {
    const { clipboard, makeItem, written } = fakeClipboard()
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, makeItem)

    const ok = await port.write({ 'text/plain': '# Markdown source' })

    expect(ok).toBe(true)
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(written).toEqual([{ 'text/plain': '# Markdown source' }])
  })

  it('falls back to text when the host refuses the rich write', async () => {
    const { clipboard, makeItem, written } = fakeClipboard({ rejectRich: true })
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, makeItem)

    const ok = await port.write({ 'text/plain': 'Plain words', 'text/html': '<b>Rich</b>' })

    expect(ok).toBe(true)
    expect(written).toEqual([{ 'text/plain': 'Plain words' }])
  })

  it('reports refusal rather than claiming success', async () => {
    const { clipboard, makeItem } = fakeClipboard({ rejectRich: true, rejectText: true })
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, makeItem)

    expect(await port.write({ 'text/plain': 'x', 'text/html': '<b>x</b>' })).toBe(false)
  })

  it('reports refusal when the platform has no clipboard at all', async () => {
    const port = new BrowserClipboardPort(undefined, undefined)
    expect(await port.write({ 'text/plain': 'x' })).toBe(false)
    expect(await port.readText()).toBeNull()
  })
})

describe('BrowserClipboardPort.readText', () => {
  it('returns the clipboard text', async () => {
    const { clipboard, makeItem } = fakeClipboard()
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, makeItem)
    expect(await port.readText()).toBe('clipboard text')
  })

  it('returns null rather than throwing when the host refuses', async () => {
    const clipboard = { readText: vi.fn(async () => { throw new DOMException('no', 'NotAllowedError') }) }
    const port = new BrowserClipboardPort(clipboard as unknown as Clipboard, undefined)
    expect(await port.readText()).toBeNull()
  })
})
