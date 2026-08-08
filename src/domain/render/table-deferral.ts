/**
 * Plans which GFM tables are safe to materialise as live editor nodes.
 *
 * A Markdown file is allowed to contain enormous tables. Rendering every cell
 * as a ProseMirror node makes opening that file a synchronous UI-thread task,
 * which can leave the desktop application unresponsive before a person can
 * decide what to do. This module is deliberately parser- and DOM-free: it
 * identifies normal pipe tables, counts their cells, and returns source spans
 * an editor adapter can replace with a lightweight representation.
 *
 * The source spans are half-open character ranges into the original Markdown.
 * The adapter owns the replacement representation; this domain rule never
 * rewrites, truncates, or stores the document source itself.
 */

/** A modest upper bound for live editable GFM table cells in one document. */
export const DEFAULT_LIVE_TABLE_CELL_BUDGET = 2_000

export interface MarkdownTableSpan {
  /** Inclusive source offset of the table's first line. */
  readonly start: number
  /** Exclusive source offset after the table's final row. */
  readonly end: number
  /** Number of cells that would become editable table nodes. */
  readonly cellCount: number
  /** Header-derived number of columns, for a useful safe-renderer label. */
  readonly columnCount: number
  /** Header plus body rows, excluding the Markdown delimiter row. */
  readonly rowCount: number
}

export interface TableDeferralPlan {
  /** Tables that can safely become normal ProseMirror table nodes. */
  readonly liveTables: readonly MarkdownTableSpan[]
  /** Tables an adapter must keep out of the live editable tree. */
  readonly deferredTables: readonly MarkdownTableSpan[]
  readonly liveCellCount: number
}

interface SourceLine {
  readonly text: string
  readonly start: number
  readonly end: number
}

/**
 * Split a pipe-table row without mistaking an escaped pipe for a cell boundary.
 * This intentionally stays small: it is a safety budget, not a Markdown
 * parser. Milkdown remains the source of truth for ordinary table parsing.
 */
function cellsInLine(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)

  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of value) {
    if (escaped) {
      cell += character
      escaped = false
      continue
    }
    if (character === '\\') {
      cell += character
      escaped = true
      continue
    }
    if (character === '|') {
      cells.push(cell)
      cell = ''
      continue
    }
    cell += character
  }
  cells.push(cell)
  return cells
}

function isTableDelimiter(line: string): boolean {
  const cells = cellsInLine(line)
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function looksLikeTableRow(line: string): boolean {
  return line.includes('|')
}

function sourceLines(markdown: string): SourceLine[] {
  const lines = markdown.split('\n')
  const result: SourceLine[] = []
  let start = 0
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!
    const hasNewline = index < lines.length - 1
    const end = start + text.length + (hasNewline ? 1 : 0)
    result.push({ text, start, end })
    start = end
  }
  return result
}

function fenceStart(line: string): { readonly marker: '`' | '~'; readonly length: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  if (match === null) return undefined
  const fence = match[1]!
  return { marker: fence[0] as '`' | '~', length: fence.length }
}

function closesFence(line: string, fence: { readonly marker: '`' | '~'; readonly length: number }): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
  return match !== null && match[1]![0] === fence.marker && match[1]!.length >= fence.length
}

/**
 * Returns the GFM pipe tables whose live editor materialisation fits within the
 * given document-wide cell budget. Once the budget is crossed, subsequent
 * tables are deferred too: an enormous generated report therefore has one
 * predictable safe path instead of a mixture whose cost depends on order.
 */
export function planTableDeferral(
  markdown: string,
  liveCellBudget = DEFAULT_LIVE_TABLE_CELL_BUDGET,
): TableDeferralPlan {
  const lines = sourceLines(markdown)
  const liveTables: MarkdownTableSpan[] = []
  const deferredTables: MarkdownTableSpan[] = []
  let liveCellCount = 0
  let deferRemainingTables = false
  let openFence: { readonly marker: '`' | '~'; readonly length: number } | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (openFence !== undefined) {
      if (closesFence(line.text, openFence)) openFence = undefined
      continue
    }

    const openingFence = fenceStart(line.text)
    if (openingFence !== undefined) {
      openFence = openingFence
      continue
    }

    const delimiter = lines[index + 1]
    if (
      delimiter === undefined ||
      !looksLikeTableRow(line.text) ||
      !isTableDelimiter(delimiter.text)
    ) {
      continue
    }

    let finalRow = index + 1
    let cellCount = cellsInLine(line.text).length
    let rowCount = 1
    for (let row = index + 2; row < lines.length && looksLikeTableRow(lines[row]!.text); row += 1) {
      cellCount += cellsInLine(lines[row]!.text).length
      rowCount += 1
      finalRow = row
    }

    const span: MarkdownTableSpan = {
      start: line.start,
      end: lines[finalRow]!.end,
      cellCount,
      columnCount: cellsInLine(delimiter.text).length,
      rowCount,
    }

    if (deferRemainingTables || liveCellCount + cellCount > liveCellBudget) {
      deferredTables.push(span)
      deferRemainingTables = true
    } else {
      liveTables.push(span)
      liveCellCount += cellCount
    }

    index = finalRow
  }

  return { liveTables, deferredTables, liveCellCount }
}
