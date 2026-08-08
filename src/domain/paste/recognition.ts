/**
 * Deterministic paste recognition — the pure half of DESIGN.md §4.
 *
 * A sniffer may convert only when all four conditions hold (§4.2):
 *
 *   1. Standalone block — the caret is at a block boundary and the pasted text
 *      is the entire clipboard payload.
 *   2. Signature match.
 *   3. Validation succeeds — `mermaid.parse()` returns, or the SVG survives
 *      sanitisation.
 *   4. No higher-priority sniffer claimed it.
 *
 * Conditions 1 and 2 live here because they are pure rules over text and
 * belong to `domain` (DESIGN.md §3 lists recognition contracts there).
 * Conditions 3 and 4 need a parser, a sanitiser, and a DOM, so they live in the
 * adapters. Splitting it this way means the ruling table is testable without a
 * browser, and the signatures cannot drift away from the spec unnoticed.
 *
 * The governing rule for all of it (§4.4): never guess silently wrong.
 */

/**
 * Mermaid's first non-blank line, verbatim from DESIGN.md §4.2.
 *
 * `\b` after the alternation is what stops "graphics" and "pierced" matching —
 * the signature is a cheap filter, and `mermaid.parse()` in the adapter is the
 * real gate.
 */
export const MERMAID_SIGNATURE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart)\b/

export interface PasteCandidate {
  /** The `text/plain` clipboard payload. */
  readonly text: string
  /** True when the caret sits at a block boundary rather than inside a block. */
  readonly atBlockBoundary: boolean
}

/** §4.2 condition 1. */
export function isStandaloneBlockPaste(candidate: PasteCandidate): boolean {
  if (!candidate.atBlockBoundary) return false
  return candidate.text.trim() !== ''
}

/** §4.2 condition 2, Mermaid. */
export function looksLikeMermaid(text: string): boolean {
  const firstNonBlank = text.split('\n').find((line) => line.trim() !== '')
  if (firstNonBlank === undefined) return false
  return MERMAID_SIGNATURE.test(firstNonBlank)
}

/**
 * §4.2 condition 2, SVG: the document's root element is `<svg>`.
 *
 * An `<svg>` nested inside other markup is deliberately not claimed here — that
 * is the svg-in-html case, and priority order decides it rather than a looser
 * signature.
 */
export function looksLikeSvg(text: string): boolean {
  const withoutProlog = text.replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trimStart()
  return /^<svg[\s>]/i.test(withoutProlog)
}

/**
 * §4.2, priority 30: pull an `<svg>` out of an HTML clipboard flavour.
 *
 * Returns the SVG source, or null when the HTML carries none. String
 * extraction rather than DOM parsing keeps this pure; the adapter sanitises
 * whatever comes back before anything renders (§7).
 */
export function svgInHtml(html: string): string | null {
  const match = /<svg[\s>][\s\S]*?<\/svg\s*>/i.exec(html)
  return match === null ? null : match[0]
}

/** Escape HTML to prevent tag/entity interpretation in text nodes. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Rewrites every inline `<svg>` in an HTML clipboard flavour into the fenced
 * form the renderer already draws.
 *
 * ProseMirror's clipboard parse has no rule for `<svg>`, so a pasted chart
 * simply vanishes — measured on a report where the prose, table and headings
 * all survived and the picture did not. Turning it into
 * ```` ```svg ```` before the parse runs keeps it *where it was*, rather than
 * appending it or dropping it.
 *
 * String rewriting rather than DOM surgery keeps this in `domain`, and the
 * source is escaped because it is untrusted markup on the way to a text node.
 * Sanitisation still happens later, at render (§7) — this only decides where
 * the bytes land.
 */
export function svgToCodeFenceHtml(html: string): string {
  return html.replace(
    /<svg[\s>][\s\S]*?<\/svg\s*>/gi,
    (svg) => `<pre><code class="language-svg">${escapeHtml(svg)}</code></pre>`,
  )
}
