/**
 * Where a pasted page came from, when the clipboard says so.
 *
 * String work rather than DOM work on purpose: the CF_HTML `SourceURL` header
 * sits *above* the markup and is not part of any document a parser would build,
 * and ADR-0001 keeps `domain` free of a DOM either way.
 *
 * DESIGN.md §4.4 and ADR-0006 set the bar: an unreadable source is written as
 * nothing. No canonical link, no og:url, no reconstruction from a CDN path.
 */

export interface PasteProvenance {
  readonly url: string
  readonly title?: string
}

const SOURCE_URL = /^\s*SourceURL\s*:\s*(\S+)\s*$/im
const BASE_HREF = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i
const OG_TITLE_CONTENT_LAST =
  /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i
const OG_TITLE_CONTENT_FIRST =
  /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bproperty\s*=\s*["']og:title["']/i

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function readPasteProvenance(html: string): PasteProvenance | null {
  const url = (SOURCE_URL.exec(html)?.[1] ?? BASE_HREF.exec(html)?.[1] ?? '').trim()
  if (!/^https?:\/\/\S+$/i.test(url)) return null

  const rawTitle =
    TITLE.exec(html)?.[1] ??
    OG_TITLE_CONTENT_LAST.exec(html)?.[1] ??
    OG_TITLE_CONTENT_FIRST.exec(html)?.[1] ??
    ''
  const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim()
  return title === '' ? { url } : { url, title }
}

/**
 * The provenance line as HTML, so it joins the trimmed article on the same
 * parsing path and serializes to `> Source: [title](url)`.
 */
export function provenanceHtml(provenance: PasteProvenance): string {
  const text = escapeHtml(provenance.title ?? provenance.url)
  return `<blockquote><p>Source: <a href="${escapeHtml(provenance.url)}">${text}</a></p></blockquote>`
}
