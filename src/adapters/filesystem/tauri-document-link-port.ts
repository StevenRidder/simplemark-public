import type { DocumentLinkPort } from '../../application/index.js'

export type TauriLinkInvoke = (
  command: string,
  args: { documentHandle: string; href: string },
) => Promise<unknown>

/** Thin transport to the native, validated document-link command. */
export class TauriDocumentLinkPort implements DocumentLinkPort {
  constructor(private readonly invoke: TauriLinkInvoke) {}

  async open(documentHandle: string, href: string): Promise<void> {
    await this.invoke('open_document_link', { documentHandle, href })
  }
}
