import { describe, expect, it } from 'vitest'

import { GRAPHVIZ_UNAVAILABLE, GraphvizRenderer } from '../../src/adapters/renderers/graphviz-renderer.js'
import { KatexRenderer } from '../../src/adapters/renderers/katex-renderer.js'

describe('GraphvizRenderer', () => {
  const renderer = new GraphvizRenderer()

  it('claims dot and graphviz', () => {
    expect([...renderer.languages]).toEqual(['dot', 'graphviz'])
  })

  it('lays out a directed graph as SVG', async () => {
    const result = await renderer.render('dot', 'digraph { paste -> render }')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('<svg')
    expect(result.markup).toContain('paste')
    expect(result.markup).toContain('render')
  }, 30_000)

  it('reports a syntax error rather than throwing', async () => {
    const result = await renderer.render('dot', 'digraph { a -> }')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message.length).toBeGreaterThan(0)
    // The author's mistake earns the engine's own words, not the build-fault sentence.
    expect(result.message).not.toBe(GRAPHVIZ_UNAVAILABLE)
  }, 30_000)

  it('declines an empty graph and a foreign language', async () => {
    expect((await renderer.render('dot', '   ')).ok).toBe(false)
    expect((await renderer.render('mermaid', 'flowchart LR')).ok).toBe(false)
  })
})

describe('GraphvizRenderer when the engine will not start', () => {
  // Standing in for the real fault: under a CSP without 'wasm-unsafe-eval',
  // WebKit refuses to compile the module and the loader rejects with a
  // paragraph of policy text. That paragraph must not reach the document.
  const refusal = () =>
    Promise.reject(
      new Error(
        "Refused to create a WebAssembly object because 'unsafe-eval' or 'wasm-unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"default-src 'self'\"",
      ),
    )

  it('answers with one plain sentence instead of the engine refusal', async () => {
    const result = await new GraphvizRenderer(refusal).render('dot', 'digraph { a -> b }')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toBe(GRAPHVIZ_UNAVAILABLE)
    expect(result.message).not.toMatch(/Content Security Policy|WebAssembly/)
  })

  it('does not re-import a dead engine on every repaint', async () => {
    let attempts = 0
    const counted = () => {
      attempts += 1
      return refusal()
    }
    const renderer = new GraphvizRenderer(counted)

    for (let repaint = 0; repaint < 3; repaint += 1) {
      expect((await renderer.render('dot', 'digraph { a -> b }')).ok).toBe(false)
    }

    expect(attempts).toBe(1)
  })

  it('still refuses a foreign language without reaching for the engine', async () => {
    let attempts = 0
    const renderer = new GraphvizRenderer(() => {
      attempts += 1
      return refusal()
    })

    expect((await renderer.render('mermaid', 'flowchart LR')).ok).toBe(false)
    expect((await renderer.render('dot', '  ')).ok).toBe(false)
    expect(attempts).toBe(0)
  })
})

describe('KatexRenderer', () => {
  const renderer = new KatexRenderer()

  it('claims display and inline math, latex and tex', () => {
    expect([...renderer.languages]).toEqual(['math', 'math-inline', 'latex', 'tex'])
  })

  it('typesets a formula to KaTeX markup', async () => {
    const result = await renderer.render('math', 'E = mc^2')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('class="katex"')
    expect(result.markup).toContain('math-block')
  })

  it('typesets a multi-line environment', async () => {
    const result = await renderer.render('math', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}')
    expect(result.ok).toBe(true)
  })

  it('typesets inline math without a display wrapper', async () => {
    const result = await renderer.render('math-inline', 'x+y')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('class="katex"')
    expect(result.markup).not.toContain('math-block')
  })

  it('fails visibly on a bad formula rather than rendering red source', async () => {
    const result = await renderer.render('math', '\\frac{1}{')
    expect(result.ok).toBe(false)
  })

  it('strips outbound references — trust is off, so a formula cannot reach outside itself', async () => {
    // KaTeX renders these inert rather than throwing: the command survives, its
    // destination does not. That is the property worth asserting.
    for (const attack of [
      '\\href{https://evil.example}{click}',
      '\\url{https://evil.example}',
      '\\includegraphics{http://evil.example/x.png}',
    ]) {
      const result = await renderer.render('math', attack)
      if (!result.ok) continue
      expect(result.markup).not.toMatch(/<a\s[^>]*href/i)
      expect(result.markup).not.toContain('evil.example')
    }
  })

  it('declines an empty formula and a foreign language', async () => {
    expect((await renderer.render('math', '  ')).ok).toBe(false)
    expect((await renderer.render('dot', 'digraph {}')).ok).toBe(false)
  })
})
