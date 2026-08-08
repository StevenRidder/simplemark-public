/**
 * The selection-to-format rules for EDITOR-10, as pure functions over Markdown.
 *
 * The task's boundary is explicit: *clipboard adapters may vary by host, but
 * the selection-to-format contract must be shared and testable*. So the
 * conversions live here, testable without a browser, and an adapter's only job
 * is to hand the resulting strings to a platform clipboard.
 *
 * Every one of these is lossy by design — that is what "copy as" means — but
 * none of them mutate the document. Copy never writes to the file.
 */

/** Cells a GFM table row was built from, with the escapes undone. */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n'))
}

/** A GFM table needs a header, a delimiter row of dashes, and at least one body row. */
function parseTable(markdown: string): string[][] | null {
  const lines = markdown
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length < 3) return null
  if (!lines.every((line) => line.startsWith('|'))) return null
  if (!/^\|[\s:|-]+\|?$/.test(lines[1]!)) return null

  const header = parseTableRow(lines[0]!)
  const body = lines.slice(2).map(parseTableRow)
  return [header, ...body]
}

/** RFC 4180: quote when the field holds a comma, quote or newline; double the quotes. */
function csvField(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function markdownTableToCsv(markdown: string): string | null {
  const rows = parseTable(markdown)
  if (rows === null) return null
  return rows.map((row) => row.map(csvField).join(',')).join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function markdownTableToHtml(markdown: string): string | null {
  const rows = parseTable(markdown)
  if (rows === null) return null
  const [header, ...body] = rows
  const head = `<thead><tr>${(header ?? []).map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
  const rest = body
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${head}<tbody>${rest}</tbody></table>`
}

/** The body of a single fenced block, without the fence or its language. */
export function codeFenceContent(markdown: string): string | null {
  const match = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(markdown)
  return match === null ? null : (match[1] ?? '')
}

/**
 * Markdown with its syntax removed and its words kept.
 *
 * Deliberately conservative: it strips the punctuation that carries no meaning
 * once formatting is gone, and keeps everything a reader would have read aloud
 * — link text, image alt text, task-checkbox marks, callout type names.
 */
export function markdownToPlainText(markdown: string): string {
  const fence = codeFenceContent(markdown)
  if (fence !== null) return fence

  return markdown
    .split('\n')
    .map((line) =>
      line
        // Blockquote and callout markers; the callout's type survives as a word.
        .replace(/^\s*>\s?/, '')
        .replace(/^\[!(\w+)\]\s*/, (_m, type: string) => `${type.toUpperCase()} `)
        // Leading block syntax.
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?=\[[ xX]\])/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .trimEnd(),
    )
    .join('\n')
    // Inline syntax. Images before links, or the alt text loses its bang.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .trim()
}
