import { fromMarkdown } from 'mdast-util-from-markdown'

import type { BlockBoundaryPort } from '../../application/index.js'

/**
 * Top-level block offsets, from the same mdast parser the editor is built on.
 *
 * Every top-level child of an mdast root carries `position.start.offset`, which
 * is exactly what `buildSourceMap` wants. No second hand-written parser, and no
 * ProseMirror on the save path.
 *
 * **Deliberately CommonMark, without the GFM or front-matter extensions.** The
 * port's contract is self-consistency rather than agreement with the editor:
 * the same implementation reads the baseline and the edited document, so a
 * coarser answer is safe. Without GFM a table parses as one paragraph, which
 * makes the whole table a single block — that block is preserved or replaced
 * whole, which is correct, just less granular. Claiming a boundary that is not
 * really there would not be.
 */
export class MdastBlockBoundaries implements BlockBoundaryPort {
  starts(markdown: string): readonly number[] {
    const root = fromMarkdown(markdown)
    const offsets: number[] = []

    for (const child of root.children) {
      const offset = child.position?.start.offset
      // A node without position information cannot be tiled against. Dropping
      // it would silently merge it into its neighbour's slice, so the whole
      // document is refused instead — `dirtyBlocks` then falls back to a
      // whole-document write, which is the honest outcome.
      if (offset === undefined) return []
      offsets.push(offset)
    }

    return offsets
  }

  /**
   * Whether two blocks parse to the same tree.
   *
   * Positions are stripped before comparison — they describe where the text sat
   * in its document, not what it says, and they always differ. What survives is
   * node types, nesting and text, which is exactly "does this mean the same
   * thing": `- a` and `* a` are the same list, `---` and `***` the same
   * thematic break, `\~` and `~` the same character.
   */
  equivalent(a: string, b: string): boolean {
    if (a === b) return true
    return JSON.stringify(strip(fromMarkdown(a))) === JSON.stringify(strip(fromMarkdown(b)))
  }
}

/** The tree without its positions, which describe placement rather than meaning. */
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip)
  if (node === null || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'position') continue
    out[key] = strip(value)
  }
  return out
}
