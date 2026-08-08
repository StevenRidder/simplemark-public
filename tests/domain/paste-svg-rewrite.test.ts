import { describe, expect, it } from 'vitest'

import { svgToCodeFenceHtml } from '../../src/domain/index.js'

const SVG = '<svg viewBox="0 0 4 4"><rect width="2"/></svg>'

/**
 * ProseMirror's clipboard parse drops <svg> on the floor. Rewriting it to the
 * fenced form the renderer already understands is what keeps a pasted chart in
 * place, between the prose that surrounded it.
 */
describe('svgToCodeFenceHtml', () => {
  it('rewrites a single inline SVG into an svg code fence', () => {
    const out = svgToCodeFenceHtml(`<p>before</p><figure>${SVG}</figure><p>after</p>`)
    expect(out).toContain('<pre><code class="language-svg">')
    expect(out).toContain('<p>before</p>')
    expect(out).toContain('<p>after</p>')
    expect(out).not.toContain('<svg')
  })

  it('escapes the source so it lands as text, not as markup', () => {
    const out = svgToCodeFenceHtml(SVG)
    expect(out).toContain('&lt;svg viewBox="0 0 4 4"&gt;')
    expect(out).toContain('&lt;rect width="2"/&gt;')
  })

  it('rewrites every SVG, not just the first', () => {
    const out = svgToCodeFenceHtml(`${SVG}<p>middle</p>${SVG}`)
    expect(out.match(/<pre><code class="language-svg">/g)).toHaveLength(2)
  })

  it('leaves SVG-free HTML byte-identical', () => {
    const html = '<h2>Title</h2><p>No pictures here.</p>'
    expect(svgToCodeFenceHtml(html)).toBe(html)
  })

  it('handles an SVG carrying a namespace and nested markup', () => {
    const nested = '<svg xmlns="http://www.w3.org/2000/svg"><g><circle r="1"/></g></svg>'
    const out = svgToCodeFenceHtml(`<div>${nested}</div>`)
    expect(out).not.toContain('<circle')
    expect(out).toContain('&lt;circle r="1"/&gt;')
  })
})
