import katex from 'katex'
import 'katex/dist/katex.min.css'

import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/**
 * KaTeX implementation of the DiagramRenderer port, for display math.
 *
 * `throwOnError: true` is deliberate. KaTeX's default is to render bad input
 * as red source text, which would put a broken formula in the document dressed
 * as a rendered one — exactly the silent-wrong-guess DESIGN.md §4.4 forbids.
 * Throwing lets the failure become `{ ok: false }` and an honest error card
 * with the source still editable.
 *
 * `trust: false` blocks `\href`, `\includegraphics` and the other commands that
 * can reach outside the formula (DESIGN.md §7); KaTeX escapes everything else,
 * so the returned HTML is inert without a further sanitising pass.
 */
export class KatexRenderer implements DiagramRenderer {
  readonly languages = ['math', 'math-inline', 'latex', 'tex'] as const

  async render(language: string, source: string): Promise<RenderedDiagram> {
    if (!this.languages.includes(language as 'math')) {
      return { ok: false, message: `KatexRenderer cannot render "${language}"` }
    }

    const trimmed = source.trim()
    if (trimmed === '') return { ok: false, message: 'Formula is empty' }

    try {
      const html = katex.renderToString(trimmed, {
        displayMode: language !== 'math-inline',
        throwOnError: true,
        trust: false,
        strict: false,
        output: 'html',
      })
      return language === 'math-inline'
        ? { ok: true, markup: html }
        : { ok: true, markup: `<div class="math-block">${html}</div>` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
