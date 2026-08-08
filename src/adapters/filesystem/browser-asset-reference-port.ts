import type { AssetKind, AssetReference, AssetReferencePort } from '../../application/index.js'

export interface BrowserAssetPrompter {
  prompt(message: string, initial: string): string | null
}

/**
 * Browser implementation of the portable asset boundary.
 *
 * A browser File object intentionally reveals no stable local path and cannot
 * copy a sibling into the Markdown document's directory. This adapter therefore
 * asks for the relative Markdown path and returns an honest notice. It never
 * serialises a blob URL, `file:` URL, base64 payload, or hidden handle.
 */
export class BrowserAssetReferencePort implements AssetReferencePort {
  constructor(
    private readonly pick: () => Promise<File>,
    private readonly prompter: BrowserAssetPrompter,
  ) {}

  async chooseReference(): Promise<AssetReference | null> {
    const file = await this.pick()
    const kind = isImage(file) ? 'image' : 'file'
    const src = normaliseRelativeAssetPath(this.prompter.prompt(
      'Relative Markdown path (SimpleMark will not copy the selected file)',
      file.name,
    ))
    if (src === null) return null

    const label = this.prompter.prompt(
      kind === 'image' ? 'Image alternative text' : 'File link label',
      file.name,
    )?.trim()
    if (label === undefined || label === '') return null

    return {
      kind,
      src,
      label,
      notice: `Reference added — place ${src} beside this Markdown file to render or open it`,
    }
  }
}

/**
 * Only ordinary relative paths can be made durable in a Markdown document.
 * The returned path uses forward slashes, including when a person typed a
 * Windows-style path, and rejects every path form that leaks local-machine
 * identity or escapes the document directory.
 */
export function normaliseRelativeAssetPath(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim().replaceAll('\\', '/')
  if (
    trimmed === '' ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
  ) return null

  const parts = trimmed.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return parts.join('/')
}

function isImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name)
}
