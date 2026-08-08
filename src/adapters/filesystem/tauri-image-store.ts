import type { ImageStorePort, LoadedImage, StoredImage } from '../../application/index.js'
import { isPortableAssetReference } from '../../domain/index.js'

export type TauriImageInvoke = (
  command: string,
  args: Record<string, string>,
) => Promise<unknown>

/**
 * Thin transport to the audited image commands (ADR-0008).
 *
 * Every refusal becomes `null` rather than an exception: the caller's answer to
 * "this image could not be stored" is to keep the remote URL it already has,
 * which is a visible, unchanged state rather than a lost paste (§4.4).
 */
export class TauriImageStore implements ImageStorePort {
  constructor(private readonly invoke: TauriImageInvoke) {}

  async store(documentHandle: string, url: string): Promise<StoredImage | null> {
    try {
      const result = (await this.invoke('download_note_image', { documentHandle, url })) as {
        src?: unknown
      } | null
      const src = typeof result?.src === 'string' ? result.src : ''
      // The document may only ever hold a note-relative path, whatever the
      // native side reports.
      return isPortableAssetReference(src) ? { src } : null
    } catch {
      return null
    }
  }

  async read(documentHandle: string, href: string): Promise<LoadedImage | null> {
    try {
      const result = (await this.invoke('read_note_asset', { documentHandle, href })) as {
        bytes?: unknown
        mediaType?: unknown
      } | null
      if (typeof result?.bytes !== 'string' || typeof result.mediaType !== 'string') return null
      const binary = atob(result.bytes)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return { bytes, mediaType: result.mediaType }
    } catch {
      return null
    }
  }
}
