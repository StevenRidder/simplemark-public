import { analysePastedPage, provenanceHtml, readPasteProvenance, type PageNode } from '../../domain/index.js'

/**
 * The DOM half of DESIGN.md §4.2's "whole web page wrapped around an article"
 * ruling. It mirrors the parsed clipboard into DOM-free `PageNode`s, asks the
 * domain what to keep, and applies the answer back to the real tree.
 *
 * ADR-0001 keeps the judgement pure and DOM-free in `domain`; this adapter is
 * the only place that touches `DOMParser`, `querySelectorAll` and `remove()`.
 */

interface MirroredPage {
  readonly root: PageNode
  readonly elements: ReadonlyMap<number, Element>
}

function mirror(document: Document): MirroredPage | null {
  const body = document.body as Element | null
  if (body === null) return null

  const elements = new Map<number, Element>()
  let nextId = 0

  const build = (element: Element): PageNode => {
    const id = (nextId += 1)
    elements.set(id, element)
    const children = [...element.children].map(build)
    const tag = element.tagName.toLowerCase()
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const linkText =
      tag === 'a'
        ? text
        : [...element.querySelectorAll('a')]
            .map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ' ').trim())
            .join(' ')
    const role = element.getAttribute('role') ?? undefined
    const domId = element.getAttribute('id') ?? undefined
    const href = element.getAttribute('href') ?? undefined
    return {
      id,
      tag,
      text,
      linkText,
      children,
      ...(role === undefined ? {} : { role }),
      ...(domId === undefined ? {} : { domId }),
      ...(href === undefined ? {} : { href }),
    }
  }

  return { root: build(body), elements }
}

function parse(html: string): Document | null {
  try {
    return new window.DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
}

/** Whether to offer a trim at all. Never throws — a sniffer-adjacent rule. */
export function looksLikeFullPagePaste(html: string): boolean {
  try {
    const document = parse(html)
    if (document === null) return false
    const page = mirror(document)
    if (page === null) return false
    return analysePastedPage(page.root).isFullPage
  } catch {
    return false
  }
}

/**
 * The trimmed article, with a source line when the clipboard named one.
 *
 * `null` when there is nothing confident to do, which is also what the caller
 * treats as "leave the faithful paste exactly as it is".
 */
export function extractArticleHtml(html: string): string | null {
  try {
    const document = parse(html)
    if (document === null) return null
    const page = mirror(document)
    if (page === null) return null

    const analysis = analysePastedPage(page.root)
    if (!analysis.isFullPage || analysis.coreId === undefined) return null

    const core = page.elements.get(analysis.coreId)
    if (core === undefined) return null

    for (const id of analysis.pruned) page.elements.get(id)?.remove()

    const provenance = readPasteProvenance(html)
    const article = core.innerHTML.trim()
    if (article === '') return null
    return provenance === null ? article : `${provenanceHtml(provenance)}${article}`
  } catch {
    return null
  }
}
