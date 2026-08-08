import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Folding (EDITOR-3): quiet gutter chevrons on headings and nested lists.
 *
 * Folding is *view state*. A fold hides content with decorations and never
 * touches the document, so the serialised Markdown is byte-identical folded or
 * not — the same invariant D7 demands of untouched blocks. That is why this
 * lives in the editor adapter and not in the document model: the document does
 * not know folding exists.
 *
 * Folded positions live in plugin state and are remapped through every
 * transaction; a fold whose anchor stops being a foldable node is dropped
 * rather than left dangling over the wrong content.
 */

export const foldingKey = new PluginKey<FoldingState>('simplemark-folding')

interface FoldingState {
  /** Start positions of folded heading / list_item nodes. */
  readonly folded: ReadonlyArray<number>
}

interface FoldMeta {
  readonly toggle?: number
  /** Unfold anything hiding this position (contents navigation). */
  readonly reveal?: number
  readonly foldAll?: boolean
  readonly unfoldAll?: boolean
}

/** The heading's section: every following top-level block until the next
 * heading of the same or a higher level. Empty when the heading has nothing
 * under it — such a heading gets no chevron at all. */
export function headingSection(
  doc: ProseNode,
  headingPos: number,
): { from: number; to: number } | null {
  const heading = doc.nodeAt(headingPos)
  if (heading === null || heading.type.name !== 'heading') return null
  // Sections are a top-level concept: a heading inside a blockquote folds
  // nothing rather than folding the wrong thing.
  if (doc.resolve(headingPos).depth !== 0) return null
  const level = heading.attrs['level'] as number

  const from = headingPos + heading.nodeSize
  let to = from
  // forEach cannot break, so carry a stop flag through the scan.
  let stopped = false
  doc.forEach((child, offset) => {
    if (stopped || offset < from) return
    if (child.type.name === 'heading' && (child.attrs['level'] as number) <= level) {
      stopped = true
      return
    }
    to = offset + child.nodeSize
  })

  return to > from ? { from, to } : null
}

/** The nested lists inside a list item — what folding the item hides. */
export function listItemChildren(
  doc: ProseNode,
  itemPos: number,
): ReadonlyArray<{ from: number; to: number }> {
  const item = doc.nodeAt(itemPos)
  if (item === null || item.type.name !== 'list_item') return []
  const ranges: Array<{ from: number; to: number }> = []
  item.forEach((child, offset) => {
    if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') {
      const from = itemPos + 1 + offset
      ranges.push({ from, to: from + child.nodeSize })
    }
  })
  return ranges
}

/** Every position a fold at `pos` hides. Used to validate and to reveal. */
function hiddenRanges(
  doc: ProseNode,
  pos: number,
): ReadonlyArray<{ from: number; to: number }> {
  const node = doc.nodeAt(pos)
  if (node === null) return []
  if (node.type.name === 'heading') {
    const section = headingSection(doc, pos)
    return section === null ? [] : [section]
  }
  if (node.type.name === 'list_item') return listItemChildren(doc, pos)
  return []
}

/** All foldable anchors in the document: sectioned headings and nested lists. */
function foldableAnchors(doc: ProseNode): number[] {
  const anchors: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && headingSection(doc, pos) !== null) {
      anchors.push(pos)
      return false
    }
    if (node.type.name === 'list_item' && listItemChildren(doc, pos).length > 0) {
      anchors.push(pos)
    }
    return true
  })
  return anchors
}

function chevronWidget(view: EditorView, pos: number, folded: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = folded ? 'sm-fold-chevron is-folded' : 'sm-fold-chevron'
  button.setAttribute('aria-label', folded ? 'Unfold' : 'Fold')
  button.setAttribute('aria-expanded', String(!folded))
  button.title = folded ? 'Unfold' : 'Fold'
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  // pointerdown, not click: the editor keeps focus and selection, and the
  // block-reordering gutter (EDITOR-2) also listens on pointerdown over these
  // exact pixels — stopping propagation here is what keeps a chevron press
  // from starting a block drag.
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    view.dispatch(view.state.tr.setMeta(foldingKey, { toggle: pos } satisfies FoldMeta))
  })
  return button
}

function buildDecorations(state: EditorState, folded: ReadonlyArray<number>): DecorationSet {
  const doc = state.doc
  const foldedSet = new Set(folded)
  const decorations: Decoration[] = []

  for (const pos of foldableAnchors(doc)) {
    const isFolded = foldedSet.has(pos)
    const node = doc.nodeAt(pos)!
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class:
          node.type.name === 'heading' && isFolded ? 'sm-foldable sm-fold-head' : 'sm-foldable',
      }),
      Decoration.widget(pos + 1, (view) => chevronWidget(view, pos, isFolded), {
        side: -1,
        key: `fold-${pos}-${isFolded ? 'closed' : 'open'}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
    if (!isFolded) continue
    for (const range of hiddenRanges(doc, pos)) {
      // One decoration per child node: Decoration.node must match node
      // boundaries exactly, and the hidden range spans several blocks.
      doc.nodesBetween(range.from, range.to, (child, childPos, parent) => {
        if (childPos < range.from || childPos + child.nodeSize > range.to) return true
        if (parent !== null && childPos >= range.from) {
          decorations.push(
            Decoration.node(childPos, childPos + child.nodeSize, { class: 'sm-fold-hidden' }),
          )
          return false
        }
        return true
      })
    }
  }

  return DecorationSet.create(doc, decorations)
}

function applyMeta(
  state: FoldingState,
  meta: FoldMeta,
  tr: Transaction,
): ReadonlyArray<number> {
  let folded = state.folded.map((pos) => tr.mapping.map(pos))

  if (meta.toggle !== undefined) {
    const pos = meta.toggle
    folded = folded.includes(pos) ? folded.filter((p) => p !== pos) : [...folded, pos]
  }
  if (meta.reveal !== undefined) {
    const target = meta.reveal
    folded = folded.filter(
      (pos) => !hiddenRanges(tr.doc, pos).some((range) => target >= range.from && target < range.to),
    )
  }
  if (meta.foldAll === true) folded = foldableAnchors(tr.doc)
  if (meta.unfoldAll === true) folded = []
  return folded
}

export function foldingProsePlugin(): Plugin<FoldingState> {
  return new Plugin<FoldingState>({
    key: foldingKey,
    state: {
      init: () => ({ folded: [] }),
      apply: (tr, state) => {
        const meta = tr.getMeta(foldingKey) as FoldMeta | undefined
        let folded =
          meta !== undefined ? applyMeta(state, meta, tr) : state.folded.map((pos) => tr.mapping.map(pos))
        // A fold whose anchor is no longer a foldable node is dropped: a stale
        // fold hiding arbitrary content would be a silent data-visibility bug.
        folded = folded.filter((pos) => hiddenRanges(tr.doc, pos).length > 0)
        return { folded: [...new Set(folded)] }
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state, foldingKey.getState(state)?.folded ?? [])
      },
    },
  })
}

/** The milkdown plugin wrapper the editor adapter mounts. */
export const foldingPlugin = $prose(() => foldingProsePlugin())
