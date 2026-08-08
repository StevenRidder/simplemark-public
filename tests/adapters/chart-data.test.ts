import { describe, expect, it } from 'vitest'

import { parseChartData } from '../../src/adapters/renderers/chart-data.js'

describe('parseChartData', () => {
  it('reads CSV into rows keyed by the header', () => {
    expect(parseChartData('slot,hit\none,94\ntwo,88\n', 'sales.csv')).toEqual([
      { slot: 'one', hit: 94 },
      { slot: 'two', hit: 88 },
    ])
  })

  it('coerces numbers so a quantitative encoding has numbers to scale', () => {
    const rows = parseChartData('a,b\n1,2.5\n', 'x.csv') as Array<Record<string, unknown>>
    expect(rows[0]).toEqual({ a: 1, b: 2.5 })
    expect(typeof rows[0]!['a']).toBe('number')
  })

  it('leaves genuinely non-numeric text alone', () => {
    const rows = parseChartData('name,note\nQ1,12 units\n', 'x.csv') as Array<
      Record<string, unknown>
    >
    expect(rows[0]).toEqual({ name: 'Q1', note: '12 units' })
  })

  it('honours quoted fields containing the delimiter', () => {
    const rows = parseChartData('a,b\n"one, two",3\n', 'x.csv') as Array<Record<string, unknown>>
    expect(rows[0]).toEqual({ a: 'one, two', b: 3 })
  })

  it('reads TSV from the extension', () => {
    expect(parseChartData('a\tb\n1\t2\n', 'x.tsv')).toEqual([{ a: 1, b: 2 }])
  })

  it('reads JSON, array or object', () => {
    expect(parseChartData('[{"a":1}]', 'x.json')).toEqual([{ a: 1 }])
    expect(parseChartData('{"a":1}', 'x.json')).toEqual([{ a: 1 }])
  })

  it('takes an explicit format over the extension', () => {
    expect(parseChartData('a\tb\n1\t2\n', 'mislabelled.csv', { type: 'tsv' })).toEqual([
      { a: 1, b: 2 },
    ])
  })

  it('honours a custom delimiter', () => {
    expect(parseChartData('a;b\n1;2\n', 'x.dsv', { type: 'dsv', delimiter: ';' })).toEqual([
      { a: 1, b: 2 },
    ])
  })

  it('leaves an empty blank rather than inventing a zero', () => {
    const rows = parseChartData('a,b\n1,\n', 'x.csv') as Array<Record<string, unknown>>
    expect(rows[0]).toEqual({ a: 1, b: null })
  })

  it('refuses a format it cannot read rather than returning nothing', () => {
    expect(() => parseChartData('<xml/>', 'x.xml')).toThrow(/cannot read/i)
  })

  it('refuses malformed JSON with the parser’s own message', () => {
    expect(() => parseChartData('{oops', 'x.json')).toThrow()
  })
})
