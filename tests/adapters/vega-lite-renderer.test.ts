import { describe, expect, it } from 'vitest'

import { VegaLiteRenderer } from '../../src/adapters/renderers/vega-lite-renderer.js'

const INLINE_BARS = JSON.stringify({
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: {
    values: [
      { slot: 1, hit: 0.94 },
      { slot: 2, hit: 0.72 },
    ],
  },
  mark: 'bar',
  encoding: {
    x: { field: 'slot', type: 'ordinal' },
    y: { field: 'hit', type: 'quantitative' },
  },
})

describe('VegaLiteRenderer', () => {
  const renderer = new VegaLiteRenderer()

  it('claims vega-lite', () => {
    expect([...renderer.languages]).toEqual(['vega-lite'])
  })

  it('draws a chart from data written inside the block', async () => {
    const result = await renderer.render('vega-lite', INLINE_BARS)
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('<svg')
    expect(result.markup).toContain('slot')
  }, 30_000)

  it('reports malformed JSON rather than throwing', async () => {
    const result = await renderer.render('vega-lite', '{"mark": "bar",}')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('reports an invalid spec rather than throwing', async () => {
    const result = await renderer.render('vega-lite', '{"mark": "notamark"}')
    expect(result.ok).toBe(false)
  })

  it('declines an empty chart and a foreign language', async () => {
    expect((await renderer.render('vega-lite', '   ')).ok).toBe(false)
    expect((await renderer.render('mermaid', 'flowchart LR')).ok).toBe(false)
  })
})

const FILE_BARS = (url: string) =>
  JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { url },
    mark: 'bar',
    encoding: {
      x: { field: 'slot', type: 'ordinal' },
      y: { field: 'hit', type: 'quantitative' },
    },
  })

describe('VegaLiteRenderer data files', () => {
  it('draws a chart from a file next to the note', async () => {
    const asked: string[] = []
    const renderer = new VegaLiteRenderer({
      read: async (href) => {
        asked.push(href)
        return 'slot,hit\n1,0.94\n2,0.72\n'
      },
    })

    const result = await renderer.render('vega-lite', FILE_BARS('sales.csv'))
    if (!result.ok) throw new Error(result.message)
    expect(asked).toEqual(['sales.csv'])
    // Asserting `<svg>` alone is not enough: a chart whose data never arrived
    // still renders axes, and empty axes are an `<svg>`. That weak assertion is
    // what let the packaged-build failure through, so this checks for marks and
    // for a value that could only have come from the file.
    expect((result.markup.match(/<path/g) ?? []).length).toBeGreaterThan(2)
    expect(result.markup).toContain('0.94')
  }, 30_000)

  it('refuses a data file it cannot parse rather than drawing an empty chart', async () => {
    const renderer = new VegaLiteRenderer({ read: async () => '<xml/>' })

    const result = await renderer.render('vega-lite', FILE_BARS('notes.xml'))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toMatch(/cannot read/i)
  })

  it('refuses a remote url and says what to do instead', async () => {
    const renderer = new VegaLiteRenderer({
      read: async () => {
        throw new Error('the reader must not be asked for a remote url')
      },
    })

    const result = await renderer.render(
      'vega-lite',
      FILE_BARS('https://vega.github.io/data/cars.json'),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toContain('Remote data is not loaded')
  })

  it('refuses every url when no reader is wired in, as in the browser build', async () => {
    const result = await new VegaLiteRenderer().render('vega-lite', FILE_BARS('sales.csv'))
    expect(result.ok).toBe(false)
  })

  it('surfaces the resolver message when the file cannot be read', async () => {
    const renderer = new VegaLiteRenderer({
      read: async () => {
        throw new Error('Linked file is unavailable: No such file or directory')
      },
    })

    const result = await renderer.render('vega-lite', FILE_BARS('missing.csv'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toContain('Linked file is unavailable')
  })
})
