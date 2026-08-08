import type { DocumentLinkPort } from '../../application/index.js'

export interface BrowserLinkWindow {
  open(url: string, target: string, features: string): unknown
}

/**
 * Web links are real in the browser shell. Local sibling-file traversal is not:
 * browsers do not grant a note permission to arbitrary neighbours of its file
 * handle, so the adapter reports that boundary instead of navigating the app.
 */
export class BrowserDocumentLinkPort implements DocumentLinkPort {
  constructor(private readonly browser: BrowserLinkWindow) {}

  async open(_documentHandle: string, href: string): Promise<void> {
    const trimmed = href.trim()
    if (/^(?:https?:|mailto:)/i.test(trimmed)) {
      this.browser.open(trimmed, '_blank', 'noopener,noreferrer')
      return
    }
    throw new Error('Local document links open in the native app; the browser cannot access sibling files')
  }
}
