import mermaid from 'mermaid'

import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/**
 * Mermaid implementation of the DiagramRenderer port.
 *
 * `securityLevel: 'strict'` disables HTML labels, so diagram source cannot
 * inject markup into the document (DESIGN.md §7). Note content never issues
 * network requests, so `startOnLoad` stays off and rendering only ever happens
 * through this adapter.
 *
 * Every failure resolves as `{ ok: false }` rather than throwing: a diagram that
 * does not parse must render an inline error card carrying the parser's own
 * message, never a blank rectangle and never a crash that takes the document
 * with it (DESIGN.md §4.4, §9.1).
 */

/**
 * Mermaid's own themes, not ours.
 *
 * EDITOR-1 fixed a dark-mode defect by switching to `theme: 'base'` with
 * themeVariables derived from the design tokens. That fixed the scheme but
 * degraded fidelity to real mermaid.js output — washed-out borders and
 * arrowheads next to what every other Mermaid renderer produces. A diagram
 * should look like the diagram, so the official themes are used instead:
 * `neutral` in light, `dark` in dark. Both are Mermaid's, both are maintained,
 * and switching between them is all the scheme support this needs.
 */
function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

/** The theme the last initialise used, so a scheme change re-initialises. */
let initialisedTheme = ''

function ensureInitialised(): void {
  const theme = prefersDark() ? 'dark' : 'neutral'
  if (theme === initialisedTheme) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
  })
  initialisedTheme = theme
}

let renderSequence = 0

export class MermaidRenderer implements DiagramRenderer {
  readonly languages = ['mermaid'] as const

  async render(language: string, source: string): Promise<RenderedDiagram> {
    if (!this.languages.includes(language as 'mermaid')) {
      return { ok: false, message: `MermaidRenderer cannot render "${language}"` }
    }

    const trimmed = source.trim()
    if (trimmed === '') {
      return { ok: false, message: 'Diagram source is empty' }
    }

    try {
      ensureInitialised()
      // parse() first so a syntax error is reported as a syntax error, before
      // render() has a chance to leave orphaned nodes in the document.
      await mermaid.parse(trimmed)
      const { svg } = await mermaid.render(`simplemark-diagram-${(renderSequence += 1)}`, trimmed)
      return { ok: true, markup: svg }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
