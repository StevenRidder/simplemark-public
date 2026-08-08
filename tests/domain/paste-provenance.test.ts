import { describe, expect, it } from 'vitest'

import { provenanceHtml, readPasteProvenance } from '../../src/domain/index.js'

/**
 * DESIGN.md §4.4 and ADR-0006: provenance is honest, not uniform. A source we
 * cannot read is written as nothing at all — never inferred from a CDN path or
 * a publication name.
 */
describe('readPasteProvenance', () => {
  it('reads the CF_HTML SourceURL header a browser puts above the fragment', () => {
    const html = [
      'Version:0.9',
      'StartHTML:00000097',
      'SourceURL:https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking',
      '<html><body><p>Body</p></body></html>',
    ].join('\r\n')
    expect(readPasteProvenance(html)?.url).toBe(
      'https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking',
    )
  })

  it('falls back to a base href', () => {
    const html = '<html><head><base href="https://example.com/post"></head><body><p>Body</p></body></html>'
    expect(readPasteProvenance(html)?.url).toBe('https://example.com/post')
  })

  it('prefers the SourceURL header over a base href', () => {
    const html = 'SourceURL:https://real.example/post\n<html><head><base href="https://cdn.example/"></head></html>'
    expect(readPasteProvenance(html)?.url).toBe('https://real.example/post')
  })

  it('reads the title, preferring the document title over og:title', () => {
    const html =
      'SourceURL:https://example.com/p\n<html><head><title>Gemini is Cooked</title>' +
      '<meta property="og:title" content="Something else"></head></html>'
    expect(readPasteProvenance(html)?.title).toBe('Gemini is Cooked')
  })

  it('falls back to og:title in either attribute order', () => {
    const before = 'SourceURL:https://example.com/p\n<meta property="og:title" content="From OG">'
    const after = 'SourceURL:https://example.com/p\n<meta content="From OG" property="og:title">'
    expect(readPasteProvenance(before)?.title).toBe('From OG')
    expect(readPasteProvenance(after)?.title).toBe('From OG')
  })

  it('decodes entities in the title', () => {
    const html = 'SourceURL:https://example.com/p\n<title>Gemini &amp; GCP &#39;26</title>'
    expect(readPasteProvenance(html)?.title).toBe("Gemini & GCP '26")
  })

  it('returns null when no source is present, and never guesses one', () => {
    expect(readPasteProvenance('<html><body><p>Body</p></body></html>')).toBeNull()
    expect(readPasteProvenance('')).toBeNull()
  })

  it('refuses a source that is not http or https', () => {
    expect(readPasteProvenance('SourceURL:file:///tmp/x/post.html\n<p>Body</p>')).toBeNull()
    expect(readPasteProvenance('SourceURL:javascript:alert(1)\n<p>Body</p>')).toBeNull()
  })

  it('reports a url with no title rather than inventing one', () => {
    const provenance = readPasteProvenance('SourceURL:https://example.com/p\n<p>Body</p>')
    expect(provenance).toEqual({ url: 'https://example.com/p' })
  })
})

describe('provenanceHtml', () => {
  it('writes a blockquote that serializes to a Markdown source line', () => {
    expect(provenanceHtml({ url: 'https://example.com/p', title: 'A title' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">A title</a></p></blockquote>',
    )
  })

  it('uses the url as its own link text when no title is known', () => {
    expect(provenanceHtml({ url: 'https://example.com/p' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">https://example.com/p</a></p></blockquote>',
    )
  })

  it('escapes markup in a title so a hostile page cannot inject nodes', () => {
    expect(provenanceHtml({ url: 'https://example.com/p', title: '<img src=x onerror=alert(1)>' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">' +
        '&lt;img src=x onerror=alert(1)&gt;</a></p></blockquote>',
    )
  })
})
