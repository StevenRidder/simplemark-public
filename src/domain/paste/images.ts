/**
 * What a paste may fetch, and what it may write into Markdown.
 *
 * Both halves of image capture are bounded by these two rules, which is why
 * they are here rather than in the adapter that happens to call them: a
 * downloaded image that arrived with an absolute path or a scheme would put
 * something unportable into the person's file, and DESIGN.md §5 tier 1 asks
 * that the file keep working as ordinary Markdown somewhere else.
 */

/** Sources worth downloading: a remote host the paste named. */
export function isRemoteImageSource(src: string): boolean {
  return /^https?:\/\//i.test(src.trim())
}

/**
 * The only shape that may be written back into an image reference: a
 * note-relative path. Mirrors `normaliseRelativeAssetPath`'s rule in the
 * browser asset adapter, applied to a value the native side produced.
 */
export function isPortableAssetReference(src: string): boolean {
  const candidate = src.trim()
  if (candidate === '') return false
  if (candidate.includes('\\')) return false
  if (candidate.startsWith('/') || candidate.startsWith('~')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false
  const segments = candidate.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
