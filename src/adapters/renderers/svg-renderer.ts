import DOMPurify from 'dompurify'

import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/**
 * Renders pasted SVG, sanitised.
 *
 * DESIGN.md §7 is unambiguous: SVG and embedded HTML are untrusted input. A
 * pasted `<svg>` can carry `<script>`, `onload=`, `<foreignObject>`, and
 * external references.
 *
 * Sanitisation runs *before* validation, deliberately — "an SVG that only
 * survives by being neutered still renders, neutered." So the order is
 * sanitise, then check something survived, not the other way round.
 */

/**
 * `foreignObject` is dropped because it re-opens the HTML parser inside SVG,
 * and `use` because its href can pull in external documents. The rest of the
 * SVG profile is DOMPurify's own.
 */
const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'use', 'image', 'a'],
  FORBID_ATTR: ['href', 'xlink:href', 'formaction', 'ping'],
}

export class SvgRenderer implements DiagramRenderer {
  readonly languages = ['svg'] as const

  async render(language: string, source: string): Promise<RenderedDiagram> {
    if (!this.languages.includes(language as 'svg')) {
      return { ok: false, message: `SvgRenderer cannot render "${language}"` }
    }

    try {
      const clean = DOMPurify.sanitize(source, PURIFY_CONFIG)

      // Nothing survived: the payload was entirely script or markup we strip.
      // Fail visibly rather than rendering an empty frame (§4.4).
      if (clean.trim() === '') {
        return { ok: false, message: 'Nothing renderable survived sanitisation' }
      }
      if (!/<svg[\s>]/i.test(clean)) {
        return { ok: false, message: 'Sanitisation removed the <svg> root element' }
      }

      return { ok: true, markup: clean }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
