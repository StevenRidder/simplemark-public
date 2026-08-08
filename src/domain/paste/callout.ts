/**
 * GitHub callout markers — `> [!NOTE]`, `> [!WARNING]`, and the rest.
 *
 * The marker pattern and the "strip it from the first paragraph, keep the
 * remainder" shape are adapted from livemark's
 * `source/plugins/remark-github-callout.ts`
 * (https://github.com/datisthq/livemark, MIT © 2025 Evgeny Karev). Livemark
 * maps the five onto its own component vocabulary — CAUTION becomes "danger",
 * IMPORTANT becomes "info". SimpleMark keeps GitHub's own five names instead:
 * the file has to stay portable, and the name in the source should be the name
 * GitHub renders (D1 — files are the truth).
 *
 * This module is pure. Turning a blockquote into a callout node is the
 * adapter's job; deciding whether a line *is* a marker is a rule about text,
 * so it lives here and is testable without a parser.
 */

/** GitHub's five, in the order its documentation lists them. */
export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

export interface CalloutMarker {
  readonly type: CalloutType
  /** Whatever followed the marker on the same line, trimmed. */
  readonly rest: string
}

/**
 * Anchored at the start: a marker mid-sentence is prose, not a callout. The
 * word character class is what stops `[link](…)` and `![image](…)` matching,
 * and an unknown word is declined rather than coerced — inventing a type would
 * silently rewrite the author's meaning.
 */
const MARKER = /^\s*\[!(\w+)\]\s*/

export function matchCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER.exec(line)
  if (match === null) return null

  const raw = match[1]
  if (raw === undefined) return null

  const type = raw.toLowerCase() as CalloutType
  if (!CALLOUT_TYPES.includes(type)) return null

  return { type, rest: line.slice(match[0].length).trim() }
}
