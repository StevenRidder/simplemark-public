import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'
import { ansiToHtml } from './ansi.js'

/**
 * Renders the paste-exhaust languages — ANSI captures, unified diffs, JSON,
 * file trees, stack traces — as sanitised HTML cards (RENDERERS.md, the
 * exhaust tier).
 *
 * One renderer for all five because they share a shape: line- or
 * token-structured text that needs classing and escaping, not a drawing
 * engine. Every fragment of source text passes through esc() before it
 * reaches markup; the input is terminal output and machine dumps, which
 * contain `<script>` as a matter of course.
 */
export class TextCardRenderer implements DiagramRenderer {
  readonly languages = ['ansi', 'diff', 'json', 'tree', 'stacktrace'] as const

  async render(language: string, source: string): Promise<RenderedDiagram> {
    switch (language) {
      case 'ansi':
        return { ok: true, markup: `<pre class="text-card ansi-card">${ansiToHtml(source)}</pre>` }
      case 'diff':
        return { ok: true, markup: renderDiff(source) }
      case 'json':
        return renderJson(source)
      case 'tree':
        return { ok: true, markup: `<pre class="text-card tree-card">${esc(source)}</pre>` }
      case 'stacktrace':
        return { ok: true, markup: renderStackTrace(source) }
      default:
        return { ok: false, message: `TextCardRenderer does not render "${language}".` }
    }
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderDiff(source: string): string {
  const classify = (line: string): string => {
    if (/^@@ /.test(line)) return 'diff-hunk'
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return 'diff-file'
    if (line.startsWith('+')) return 'diff-add'
    if (line.startsWith('-')) return 'diff-del'
    return 'diff-ctx'
  }
  const body = source
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `<span class="diff-line ${classify(line)}">${esc(line)}\n</span>`)
    .join('')
  return `<pre class="text-card diff-card">${body}</pre>`
}

function renderJson(source: string): RenderedDiagram {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { ok: false, message: `Not valid JSON — ${(error as Error).message}` }
  }
  return { ok: true, markup: `<div class="text-card json-card">${jsonNode(value, 0)}</div>` }
}

/** Objects and arrays fold with <details>; depth 0–1 start open, deeper closed. */
function jsonNode(value: unknown, depth: number): string {
  if (value === null || typeof value !== 'object') {
    const cls = typeof value === 'string' ? 'json-str' : 'json-lit'
    return `<span class="${cls}">${esc(JSON.stringify(value))}</span>`
  }
  const entries = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const [openBr, closeBr] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  if (entries.length === 0) return `<span class="json-lit">${openBr}${closeBr}</span>`

  const rows = entries
    .map(
      ([key, item]) =>
        `<div class="json-row"><span class="json-key">${esc(JSON.stringify(key))}</span>: ${jsonNode(item, depth + 1)}</div>`,
    )
    .join('')
  const openAttr = depth < 2 ? ' open' : ''
  return `<details class="json-branch"${openAttr}><summary>${openBr}…${closeBr} <span class="json-count">${entries.length}</span></summary>${rows}</details>`
}

function renderStackTrace(source: string): string {
  const lines = source.replace(/\n$/, '').split('\n')
  const head = lines[0] ?? ''
  const rest = lines.slice(1).join('\n')
  return (
    `<details class="text-card stack-card"><summary>${esc(head)}</summary>` +
    `<pre>${esc(rest)}</pre></details>`
  )
}
