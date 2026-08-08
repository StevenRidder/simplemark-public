import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import type { Parent, Root, Table } from 'mdast'
import type { Position } from 'unist'
import type { Plugin, Processor } from 'unified'
import type { VFile } from 'vfile'

import { planTableRendering } from '../../domain/index.js'

/**
 * Holds back the tables a document cannot afford to render live.
 *
 * ProseMirror gives every table cell a node and a DOM element, and the cost is
 * superlinear — O(n^1.62) measured over this repo's PDF-converted corpus. A
 * 208-page statistical release opened in 44.7 seconds and built 169,082 DOM
 * nodes. That is not a slow render; it is a beachball, an unresponsive-app
 * dialog, and a force quit.
 *
 * The budget lives in `domain` because it is a rule, not a rendering trick.
 * This module is only its hands: count the cells, ask `planTableRendering`
 * which tables fit, and swap the rest for a leaf node that carries the table's
 * original Markdown untouched.
 *
 * **Nothing is destroyed and nothing is hidden.** The deferred node stores the
 * exact source bytes sliced out of the file, renders them inside a `<details>`
 * the reader can open, and serializes back verbatim through a `toMarkdown`
 * handler — the same shape `wiki-link.ts` uses. A document full of deferred
 * tables round-trips byte-for-byte, which is what DESIGN.md §12 requires and
 * what `tests/ui/large-table-guard.spec.ts` asserts.
 *
 * The alternative — rendering a truncated table — would have been a lie about
 * the document's contents, and TECH-SPEC.md §"Never lies" rules it out.
 */

interface LargeTableNode {
  type: 'largeTable'
  /** The table's original Markdown, sliced from the file. Never reformatted. */
  value: string
  rows: number
  columns: number
  /**
   * Absent on this node — it replaces a whole table, so no offset within the
   * original source is still meaningful. Declared anyway so consumers that
   * walk `RootContent`/`BlockContent` and read `.position` (e.g.
   * `mdast-block-boundaries.ts`) keep a type-checked, always-optional field
   * instead of losing it from the union entirely.
   */
  position?: Position
}

declare module 'mdast' {
  interface RootContentMap {
    largeTable: LargeTableNode
  }
  interface BlockContentMap {
    largeTable: LargeTableNode
  }
}

/** Cells in a GFM table node: the header row counts like any other. */
function cellCount(table: Table): number {
  return table.children.reduce((sum, row) => sum + row.children.length, 0)
}

/** Every table in the tree, in document order, with the parent that holds it. */
function collectTables(parent: Parent, found: { parent: Parent; index: number; table: Table }[]): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index]
    if (child === undefined) continue
    if (child.type === 'table') {
      found.push({ parent, index, table: child })
      continue
    }
    if ('children' in child && Array.isArray(child.children)) collectTables(child as Parent, found)
  }
}

const largeTableTransform: Plugin<[], Root> = () => (tree: Root, file: VFile) => {
  const found: { parent: Parent; index: number; table: Table }[] = []
  collectTables(tree, found)
  if (found.length === 0) return

  const plan = planTableRendering(found.map(({ table }) => cellCount(table)))
  if (plan.deferredCount === 0) return

  const source = typeof file.value === 'string' ? file.value : String(file.value ?? '')

  for (let i = found.length - 1; i >= 0; i -= 1) {
    if (plan.renderLive[i] !== false) continue
    const entry = found[i]
    if (entry === undefined) continue
    const { parent, index, table } = entry

    // The original bytes are the only acceptable payload. Without offsets we
    // cannot guarantee them, so the table renders live rather than risk a
    // re-serialized approximation reaching the file.
    const start = table.position?.start.offset
    const end = table.position?.end.offset
    if (start === undefined || end === undefined) continue

    const replacement: LargeTableNode = {
      type: 'largeTable',
      value: source.slice(start, end),
      rows: table.children.length,
      columns: table.children[0]?.children.length ?? 0,
    }
    parent.children.splice(index, 1, replacement as unknown as (typeof parent.children)[number])
  }
}

/** Serializes back to the exact source the transform sliced out. */
function serializeLargeTable(node: LargeTableNode): string {
  return node.value
}

function largeTableRemarkPlugin(this: Processor): void {
  const data = this.data() as Record<string, unknown>
  const existing = data['toMarkdownExtensions']
  const extension = { handlers: { largeTable: serializeLargeTable } }
  data['toMarkdownExtensions'] = Array.isArray(existing) ? [...existing, extension] : [extension]
  return largeTableTransform.call(this as never) as never
}

export const largeTableRemark = $remark('simplemarkLargeTableRemark', () => largeTableRemarkPlugin as never)

export const largeTableSchema = $nodeSchema('large_table', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,
  attrs: {
    value: { default: '' },
    rows: { default: 0 },
    columns: { default: 0 },
  },
  parseDOM: [{
    tag: 'details[data-type="large-table"]',
    getAttrs: (dom) => ({
      value: (dom as HTMLElement).querySelector('pre')?.textContent ?? '',
      rows: Number((dom as HTMLElement).dataset['rows'] ?? 0),
      columns: Number((dom as HTMLElement).dataset['columns'] ?? 0),
    }),
  }],
  toDOM: (node) => {
    const rows = Number(node.attrs['rows'] ?? 0)
    const columns = Number(node.attrs['columns'] ?? 0)
    return [
      'details',
      {
        'data-type': 'large-table',
        'data-rows': String(rows),
        'data-columns': String(columns),
        class: 'large-table-placeholder',
      },
      [
        'summary',
        {},
        `Large table held back — ${rows} rows × ${columns} columns. Show source`,
      ],
      ['pre', {}, String(node.attrs['value'] ?? '')],
    ] as const
  },
  parseMarkdown: {
    match: (node) => node.type === 'largeTable',
    runner: (state, node, type) => {
      state.addNode(type, {
        value: typeof node['value'] === 'string' ? node['value'] : '',
        rows: typeof node['rows'] === 'number' ? node['rows'] : 0,
        columns: typeof node['columns'] === 'number' ? node['columns'] : 0,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'large_table',
    runner: (state, node) => {
      state.addNode('largeTable', undefined, String(node.attrs['value'] ?? ''), {
        rows: Number(node.attrs['rows'] ?? 0),
        columns: Number(node.attrs['columns'] ?? 0),
      })
    },
  },
}))
