import { describe, expect, it } from 'vitest'

import { claimPaste } from '../../src/adapters/editor/paste-sniffers.js'

const CHART = JSON.stringify({
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: { values: [{ a: 1, b: 2 }] },
  mark: 'bar',
  encoding: { x: { field: 'a', type: 'ordinal' }, y: { field: 'b', type: 'quantitative' } },
})

describe('paste sniffer chain', () => {
  it('claims a chart spec as a chart, not as a JSON tree', () => {
    // Both sniffers match this text — it is valid JSON and a Vega-Lite spec.
    // Priority is what decides, and the more specific claim has to win or a
    // pasted chart lands as a collapsible object dump.
    expect(claimPaste(CHART, '')).toEqual({ language: 'vega-lite', source: CHART })
  })

  it('still claims ordinary JSON as JSON', () => {
    const json = '{"name":"simplemark","version":"0.1.0"}'
    expect(claimPaste(json, '')).toEqual({ language: 'json', source: json })
  })

  it('leaves prose to the Markdown path', () => {
    expect(claimPaste('Just a sentence about charts.', '')).toBeNull()
  })

  const SVG = '<svg viewBox="0 0 4 4"><rect/></svg>'

  // The reported bug. svg-in-html matched an <svg> anywhere in the HTML, so a
  // whole report — headings, prose, a table — was replaced by its one chart.
  // DESIGN.md §4.4 rule 2: never lose the source.
  it('declines a document that merely contains an SVG', () => {
    const html = `<h1>Report</h1><p>Prose.</p><figure>${SVG}</figure><table><tr><td>1</td></tr></table>`
    expect(claimPaste('Report\nProse.\n1', html)).toBeNull()
  })

  it('still claims HTML that is only a wrapped SVG', () => {
    expect(claimPaste('irrelevant plain text', `<meta charset="utf-8"><div>${SVG}</div>`)).toEqual({
      language: 'svg',
      source: SVG,
    })
  })
})
