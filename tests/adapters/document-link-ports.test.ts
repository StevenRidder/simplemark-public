import { describe, expect, it, vi } from 'vitest'

import { BrowserDocumentLinkPort } from '../../src/adapters/filesystem/browser-document-link-port.js'
import { TauriDocumentLinkPort } from '../../src/adapters/filesystem/tauri-document-link-port.js'

describe('document link ports', () => {
  it('opens web links in a separate, non-opener browser context', async () => {
    const open = vi.fn()
    const port = new BrowserDocumentLinkPort({ open })

    await port.open('browser:note', 'https://example.com/reference')

    expect(open).toHaveBeenCalledWith(
      'https://example.com/reference',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('does not pretend a browser file handle grants sibling-file access', async () => {
    const port = new BrowserDocumentLinkPort({ open: vi.fn() })
    await expect(port.open('fsa:1', 'docs/design.md')).rejects.toThrow(/native app/)
  })

  it('passes native resolution the opaque document handle and unchanged portable href', async () => {
    const invoke = vi.fn(async () => undefined)
    const port = new TauriDocumentLinkPort(invoke)

    await port.open('/device-b/notes/index.md', '../shared/decision.pdf')

    expect(invoke).toHaveBeenCalledWith('open_document_link', {
      documentHandle: '/device-b/notes/index.md',
      href: '../shared/decision.pdf',
    })
  })
})
