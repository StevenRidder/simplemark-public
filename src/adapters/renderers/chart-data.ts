import { dsvFormat } from 'd3-dsv'

/**
 * Turns a chart's data file into rows, without generating code.
 *
 * **This exists because of the packaged CSP.** Vega ingests `data.url` through
 * d3-dsv's `parse()`, which compiles a row-object constructor with
 * `new Function`. Under `default-src 'self'` with no `'unsafe-eval'` that is
 * refused, and Vega answers by logging "Data ingestion failed" and rendering an
 * empty chart — axes, no marks, no error. A chart that silently shows nothing
 * is exactly the wrong answer §4.4 forbids.
 *
 * `parseRows()` is the same parser without the codegen: it returns arrays, and
 * the row objects are assembled here. Same quoting and escaping rules, no eval.
 *
 * `vega-interpreter` does not help. It replaces expression codegen in the
 * dataflow; ingestion is a separate path. Inline `values` never touch this,
 * which is why the failure only ever appeared for charts naming a file.
 */

export interface ChartDataFormat {
  readonly type?: string
  readonly delimiter?: string
}

const DELIMITERS: Record<string, string> = {
  csv: ',',
  tsv: '\t',
  dsv: ',',
}

/** Numbers arrive as text; a quantitative encoding needs them as numbers. */
function coerce(value: string): string | number | null {
  if (value === '') return null
  // Deliberately strict: `Number('12 units')` is NaN, so mixed text stays text,
  // and `Number('')` being 0 is why the blank case is handled above.
  const asNumber = Number(value)
  return Number.isNaN(asNumber) ? value : asNumber
}

function extensionOf(href: string): string {
  const clean = href.split(/[?#]/)[0] ?? ''
  const dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
}

export function parseChartData(
  text: string,
  href: string,
  format?: ChartDataFormat,
): unknown[] {
  const type = (format?.type ?? extensionOf(href)).toLowerCase()

  if (type === 'json') {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  const delimiter = format?.delimiter ?? DELIMITERS[type]
  if (delimiter === undefined) {
    throw new Error(`SimpleMark cannot read "${href}" — expected a csv, tsv, dsv or json file`)
  }

  const rows = dsvFormat(delimiter).parseRows(text)
  const header = rows[0]
  if (header === undefined) return []

  return rows.slice(1).map((row) => {
    const record: Record<string, string | number | null> = {}
    header.forEach((name, index) => {
      record[name] = coerce(row[index] ?? '')
    })
    return record
  })
}
