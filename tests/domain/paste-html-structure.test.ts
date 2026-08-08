import { describe, expect, it } from 'vitest'

import { htmlCarriesDocumentStructure } from '../../src/domain/index.js'

/**
 * The triage that decides whether a paste keeps its formatting.
 *
 * True means "use the HTML flavour" — real headings, marks and tables. False
 * means the Markdown path on text/plain, which is what BUG-1 requires for a
 * pasted Markdown source document.
 */
describe('htmlCarriesDocumentStructure', () => {
  it('is true for a heading', () => {
    expect(htmlCarriesDocumentStructure('<h2>A heading</h2>')).toBe(true)
  })
  it('is true for a table', () => {
    expect(htmlCarriesDocumentStructure('<table><tr><td>a</td></tr></table>')).toBe(true)
  })
  it('is true for a list', () => {
    expect(htmlCarriesDocumentStructure('<ul><li>one</li></ul>')).toBe(true)
  })
  it('is true for bold, italic and links', () => {
    expect(htmlCarriesDocumentStructure('<p>a <strong>b</strong></p>')).toBe(true)
    expect(htmlCarriesDocumentStructure('<p>a <em>b</em></p>')).toBe(true)
    expect(htmlCarriesDocumentStructure('<p>a <a href="https://x.test">b</a></p>')).toBe(true)
  })
  it('is true for more than one paragraph', () => {
    expect(htmlCarriesDocumentStructure('<p>one</p><p>two</p>')).toBe(true)
  })

  // The reason the predicate is narrow. A plain-text copy from a browser or an
  // editor arrives with this wrapper, and it must keep taking the Markdown
  // path or BUG-1 comes back.
  it('is false for the wrapper a plain-text copy carries', () => {
    expect(
      htmlCarriesDocumentStructure('<meta charset="utf-8"><span style="font-family: monospace">## not a heading</span>'),
    ).toBe(false)
  })
  it('is false for a single unstyled paragraph', () => {
    expect(htmlCarriesDocumentStructure('<p>just one line</p>')).toBe(false)
  })
  it('is false for empty or absent HTML', () => {
    expect(htmlCarriesDocumentStructure('')).toBe(false)
    expect(htmlCarriesDocumentStructure('   ')).toBe(false)
  })
  it('is false for HTML that is only an SVG — svg-in-html still owns that', () => {
    expect(htmlCarriesDocumentStructure('<meta charset="utf-8"><svg viewBox="0 0 4 4"><rect/></svg>')).toBe(false)
  })

  // BUG-2: an editor's clipboard (VS Code, a terminal) is a <pre> of <span>s
  // around the same plain text — a syntax-highlighted wrapper, not a document.
  // Treating it as one sent a pasted Markdown source file through the HTML
  // path, where it landed as a single unparsed code block.
  it('is false for a <pre> wrapping plain text with no real code tag', () => {
    expect(
      htmlCarriesDocumentStructure(
        '<pre style="font-family: monospace"><span>## not a heading</span>\n<span>Some **bold** prose.</span></pre>',
      ),
    ).toBe(false)
  })
  it('is true for a <pre> that wraps a real code block', () => {
    expect(htmlCarriesDocumentStructure('<pre><code class="language-js">const x = 1</code></pre>')).toBe(true)
  })
})
