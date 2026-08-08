import { describe, expect, it } from 'vitest'

import { looksLikeVegaLite } from '../../src/domain/index.js'

const spec = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: [{ a: 1 }] },
    mark: 'bar',
    ...extra,
  })

describe('looksLikeVegaLite (§4.2)', () => {
  it('claims a spec that declares the Vega-Lite schema', () => {
    expect(looksLikeVegaLite(spec())).toBe(true)
  })

  it('claims any schema version, since the library moves and the note does not', () => {
    expect(
      looksLikeVegaLite('{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","mark":"bar"}'),
    ).toBe(true)
  })

  it('leaves ordinary JSON alone rather than guessing at chart shape', () => {
    expect(looksLikeVegaLite('{"mark":"bar","data":{"values":[{"a":1}]}}')).toBe(false)
    expect(looksLikeVegaLite('{"name":"simplemark","version":"0.1.0"}')).toBe(false)
  })

  it('does not claim a Vega spec, which this renderer does not handle', () => {
    expect(
      looksLikeVegaLite('{"$schema":"https://vega.github.io/schema/vega/v5.json","marks":[]}'),
    ).toBe(false)
  })

  it('declines anything that is not JSON at all', () => {
    expect(looksLikeVegaLite('flowchart LR\n  A --> B')).toBe(false)
    expect(looksLikeVegaLite('')).toBe(false)
    expect(looksLikeVegaLite('[1, 2, 3]')).toBe(false)
  })
})
