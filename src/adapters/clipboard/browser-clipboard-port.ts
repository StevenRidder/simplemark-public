import type { ClipboardPayload, ClipboardPort } from '../../application/index.js'

/**
 * The browser implementation of ClipboardPort (EDITOR-10).
 *
 * Two capabilities are injected rather than read from `navigator`, so the port
 * is testable without a browser and the unsupported case is a value rather than
 * a thrown surprise.
 *
 * Rich text travels as `text/html` alongside `text/plain`. That pairing is what
 * makes one copy work in both Gmail and a terminal: the receiving app picks the
 * richest flavour it understands, and a plain-text target still gets readable
 * words rather than markup.
 *
 * Every failure resolves `false`. A browser can refuse a clipboard write for
 * reasons the document cannot control — no user gesture, no permission, an
 * unfocused document — and the shell must be able to say so out loud instead of
 * showing a success state for something that did not happen.
 */
export class BrowserClipboardPort implements ClipboardPort {
  constructor(
    private readonly clipboard: Clipboard | undefined = typeof navigator === 'undefined'
      ? undefined
      : navigator.clipboard,
    /** Injected for tests; the real one is the platform constructor. */
    private readonly makeItem: ((parts: Record<string, Blob>) => ClipboardItem) | undefined =
      typeof ClipboardItem === 'undefined' ? undefined : (parts) => new ClipboardItem(parts),
  ) {}

  async write(payload: ClipboardPayload): Promise<boolean> {
    if (this.clipboard === undefined) return false

    const html = payload['text/html']
    // Only reach for the richer API when there is something rich to carry;
    // writeText is far more widely permitted than write().
    if (html !== undefined && this.makeItem !== undefined && this.clipboard.write !== undefined) {
      try {
        const item = this.makeItem({
          'text/plain': new Blob([payload['text/plain']], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })
        await this.clipboard.write([item])
        return true
      } catch {
        // Fall through: a host that refuses the rich write may still take text.
      }
    }

    try {
      await this.clipboard.writeText(payload['text/plain'])
      return true
    } catch {
      return false
    }
  }

  async readText(): Promise<string | null> {
    if (this.clipboard?.readText === undefined) return null
    try {
      return await this.clipboard.readText()
    } catch {
      return null
    }
  }
}
