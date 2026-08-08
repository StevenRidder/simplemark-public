import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/**
 * Routes a language to whichever renderer claims it.
 *
 * The editor holds one `DiagramRenderer` port, so adding SVG alongside Mermaid
 * is a composition concern rather than a change to the editor — which is the
 * point of the port. DOT, KaTeX, Vega-Lite, and Markmap join the same way.
 */
export class CompositeRenderer implements DiagramRenderer {
  readonly languages: readonly string[]

  constructor(private readonly renderers: readonly DiagramRenderer[]) {
    this.languages = renderers.flatMap((renderer) => [...renderer.languages])
  }

  async render(language: string, source: string): Promise<RenderedDiagram> {
    const renderer = this.renderers.find((candidate) => candidate.languages.includes(language))
    if (renderer === undefined) {
      return { ok: false, message: `No renderer claims "${language}"` }
    }
    return renderer.render(language, source)
  }
}
