/**
 * DESIGN.md §4.2 signatures for the formal-notation tier: Graphviz DOT and
 * LaTeX math (RENDERERS.md §2, the "verified" and "core" rows).
 *
 * Both are agent-authorable text formats, which is why they belong in the
 * magic-paste set at all: an agent can write them fluently and a human can
 * read them in a diff.
 */

/**
 * Graphviz DOT: an optional `strict`, then `graph`/`digraph`, an optional name,
 * then a brace — and a closing brace somewhere after it.
 *
 * The brace is what separates DOT from Mermaid, whose `graph LR` shares the
 * keyword. Requiring the closing brace too keeps a half-pasted graph from
 * claiming the event and rendering an error card instead of falling through to
 * ordinary text.
 */
const DOT_SIGNATURE = /^\s*(strict\s+)?(di)?graph\b[^{]*\{/i

export function looksLikeDot(text: string): boolean {
  if (!DOT_SIGNATURE.test(text)) return false
  return text.includes('}')
}

/**
 * Display math: a `$$…$$` block, or a bare LaTeX environment.
 *
 * Deliberately narrow. Inline `$x$` is not claimed — a paste is a block-level
 * event, and single dollars are far more often money than math. `$$` at the
 * start with `$$` at the end is unambiguous; so is `\begin{env}…\end{env}`.
 */
const LATEX_ENVIRONMENT = /^\s*\\begin\{([a-z*]+)\}[\s\S]*\\end\{\1\}\s*$/i

export function looksLikeMath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) return true
  return LATEX_ENVIRONMENT.test(trimmed)
}

/**
 * Vega-Lite: valid JSON whose `$schema` names a Vega-Lite version.
 *
 * The schema declaration is the whole signature, and requiring it is
 * deliberate. Chart specs are ordinary JSON objects with keys like `data` and
 * `mark`, so sniffing for shape would claim any config file that happened to
 * use those words — and the cost of a wrong guess is an error card sitting in
 * the document where a code block belonged (§4.4). A spec without `$schema`
 * pastes as JSON, which is what it is.
 *
 * The version is not pinned: the library moves and the note does not, so a v5
 * spec written last year and a v6 spec written today are both charts.
 * `vega/v5` is excluded — that is a Vega spec, which this renderer does not
 * compile.
 */
const VEGA_LITE_SCHEMA = /\/vega-lite\/v\d+/

export function looksLikeVegaLite(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false

  const schema = (parsed as { $schema?: unknown }).$schema
  return typeof schema === 'string' && VEGA_LITE_SCHEMA.test(schema)
}

/** Removes `$$` fencing so the stored source is the expression itself. */
export function stripMathDelimiters(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim()
  }
  return trimmed
}
