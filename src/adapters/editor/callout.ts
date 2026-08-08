import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import type { Blockquote, Paragraph, Root, RootContent, Text } from 'mdast'
import type { Plugin, Processor } from 'unified'

interface CalloutNode {
  type: 'callout'
  calloutType: CalloutType
  children: RootContent[]
}

interface ToMarkdownState {
  enter(name: string): () => void
  createTracker(info: unknown): { move(v: string): void; shift(n: number): void; current(): unknown }
  containerFlow(node: unknown, info: unknown): string
  indentLines(value: string, map: (line: string, index: number, blank: boolean) => string): string
}
type ToMarkdownInfo = unknown
import { visit } from 'unist-util-visit'

import { CALLOUT_TYPES, matchCalloutMarker } from '../../domain/index.js'
import type { CalloutType } from '../../domain/index.js'

/**
 * GitHub callouts as a first-class block, stored as `> [!NOTE]` blockquotes.
 *
 * The transform is adapted from livemark's `remark-github-callout.ts`
 * (https://github.com/datisthq/livemark, MIT © 2025 Evgeny Karev). Livemark
 * emits an MDX JSX element because it compiles to React at build time.
 * SimpleMark cannot: the document is an output as well as an input, so this
 * produces a real node that serialises back to the same blockquote it came
 * from. Nothing about the file changes — GitHub, Obsidian and `cat` all still
 * show a blockquote.
 *
 * The fiddly part, worth borrowing verbatim in shape: the marker lives inside
 * the first paragraph's first text node, so removing it means rebuilding that
 * paragraph from the remaining inline children — and dropping the paragraph
 * entirely when the marker was the whole of it. Getting that wrong either
 * strips the first line of the note or leaves `[!NOTE]` visible in the body.
 */

const MARKER_LINE = (type: CalloutType): string => `[!${type.toUpperCase()}]`

/** mdast → callout node. Runs before Milkdown's own blockquote handling. */
const calloutRemarkPlugin: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, 'blockquote', (node: Blockquote, index, parent) => {
    if (parent === undefined || index === undefined || node.children.length === 0) return

    const first = node.children[0]
    if (first === undefined || first.type !== 'paragraph' || first.children.length === 0) return

    const firstInline = first.children[0]
    if (firstInline === undefined || firstInline.type !== 'text') return

    const marker = matchCalloutMarker(firstInline.value)
    if (marker === null) return

    // Rebuild the first paragraph without the marker; drop it if nothing else
    // was on that line and it held no other inline content.
    const remainingInline = [
      ...(marker.rest === '' ? [] : [{ type: 'text' as const, value: marker.rest } as Text]),
      ...first.children.slice(1),
    ]
    const body =
      remainingInline.length > 0
        ? [{ ...first, children: remainingInline } as Paragraph, ...node.children.slice(1)]
        : node.children.slice(1)

    parent.children[index] = {
      type: 'callout',
      calloutType: marker.type,
      children: body.length > 0 ? body : [{ type: 'paragraph', children: [] } as Paragraph],
    } as unknown as Blockquote
  })
}

/**
 * Serialising a callout back to `> [!NOTE]` needs string-level control.
 *
 * Emitting the marker through the node tree does not work: as text remark
 * escapes the `[` (it reads as a link reference), and as an `html` node it is
 * treated as *flow* html, which puts a bare `>` line between marker and body.
 * Neither survives as a callout on GitHub.
 *
 * So the callout gets its own mdast-util-to-markdown handler, the same shape
 * highlight-mark.ts uses. It reproduces the blockquote handler and prepends the
 * marker as the first line, which is byte-for-byte what came in.
 */
function serializeCallout(node: CalloutNode, _parent: unknown, state: ToMarkdownState, info: ToMarkdownInfo): string {
  const exit = state.enter('blockquote')
  const tracker = state.createTracker(info)
  tracker.move('> ')
  tracker.shift(2)
  const type = CALLOUT_TYPES.includes(node.calloutType) ? node.calloutType : 'note'
  // containerFlow returns its content with a leading break, which would put a
  // bare `>` line between the marker and the body. GitHub's syntax wants them
  // adjacent, so the leading break is dropped.
  const body = state.containerFlow(node, tracker.current()).replace(/^\n+/, '')
  const withMarker = body === '' ? MARKER_LINE(type) : `${MARKER_LINE(type)}\n${body}`
  const value = state.indentLines(withMarker, (line: string, _index: number, blank: boolean) =>
    `>${blank ? '' : ' '}${line}`,
  )
  exit()
  return value
}

function calloutRemarkPluginWithSerializer(this: Processor): void {
  const data = this.data() as Record<string, unknown>
  const existing = data['toMarkdownExtensions']
  const extension = { handlers: { callout: serializeCallout } }
  data['toMarkdownExtensions'] = Array.isArray(existing) ? [...existing, extension] : [extension]
  return calloutRemarkPlugin.call(this as never) as never
}

export const calloutRemark = $remark('simplemarkCalloutRemark', () => calloutRemarkPluginWithSerializer as never)

export const calloutSchema = $nodeSchema('callout', () => ({
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: { calloutType: { default: 'note' } },
  parseDOM: [
    {
      tag: 'div[data-callout]',
      getAttrs: (dom) => ({
        calloutType: (dom as HTMLElement).getAttribute('data-callout') ?? 'note',
      }),
    },
  ],
  toDOM: (node) => {
    const type = String(node.attrs['calloutType'] ?? 'note')
    return ['div', { 'data-callout': type, class: `callout callout-${type}` }, 0] as const
  },
  parseMarkdown: {
    match: (node) => node.type === 'callout',
    runner: (state, node, type) => {
      const calloutType = String(
        (node as unknown as { calloutType?: string }).calloutType ?? 'note',
      )
      state.openNode(type, { calloutType })
      state.next((node as unknown as { children: unknown[] }).children as never)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'callout',
    runner: (state, node) => {
      const type = (node.attrs['calloutType'] ?? 'note') as CalloutType
      state.openNode('callout' as never, undefined, {
        calloutType: CALLOUT_TYPES.includes(type) ? type : 'note',
      } as never)
      state.next(node.content)
      state.closeNode()
    },
  },
}))
