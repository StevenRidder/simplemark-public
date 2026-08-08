/**
 * The D7 fidelity contract (DESIGN.md §7 / §12), as a source map.
 *
 * | Tier       | Scope                              | Guarantee                          |
 * |------------|------------------------------------|------------------------------------|
 * | Preserved  | blocks the user did not edit       | original bytes re-emitted verbatim |
 * | Normalized | blocks the user edited             | serialized; semantic equivalence   |
 *
 * Byte-identical round-tripping through a general Markdown serializer is not
 * achievable — remark normalizes bullet markers, table padding, fence style,
 * setext headings, entity escaping, and blank-line runs. Measured on this
 * repo's own fixtures, plain Milkdown reproduced 1 of 10 files unchanged. So
 * fidelity is not a property of the serializer; it is a property of *not
 * calling* the serializer on anything the user did not touch.
 *
 * The map tiles the file: every byte belongs to exactly one block, including
 * the blank lines between them. "Untouched save is byte-identical" is then true
 * by construction rather than by luck — with no dirty blocks, `emitDocument`
 * concatenates slices of the original string and can only produce the original
 * string.
 *
 * Pure. No parser, no editor, no filesystem: it takes the block offsets someone
 * else computed and owns only the slicing and re-assembly rules.
 */

export interface SourceBlock {
  readonly index: number
  /** Offset of the block's first byte. */
  readonly contentStart: number
  /** Offset one past the block's last content byte. */
  readonly contentEnd: number
  /**
   * Offset one past the separator that follows the block — blank lines, the
   * trailing newline, or nothing at end of file. Owned by this block so a dirty
   * block can be replaced without disturbing the gap after it.
   */
  readonly separatorEnd: number
}

export interface SourceMap {
  /** The immutable baseline. Never edited; only sliced. */
  readonly source: string
  /** Bytes before the first block, if any. */
  readonly preamble: string
  readonly blocks: readonly SourceBlock[]
}

/**
 * Builds a tiling map from the offsets of each top-level block.
 *
 * `blockStarts` must be ascending. A block's content ends where its trailing
 * whitespace begins; the whitespace belongs to the block's separator so that
 * replacing dirty content leaves the document's spacing alone.
 */
export function buildSourceMap(source: string, blockStarts: readonly number[]): SourceMap {
  const starts = [...blockStarts].sort((a, b) => a - b)
  const blocks: SourceBlock[] = []

  for (let index = 0; index < starts.length; index += 1) {
    const contentStart = starts[index]!
    const separatorEnd = index + 1 < starts.length ? starts[index + 1]! : source.length

    // Walk back over trailing whitespace so it lands in the separator, not the
    // content. A block whose own text ends in spaces (fixture 09) keeps them:
    // only whitespace that is part of the *gap* is moved.
    let contentEnd = separatorEnd
    while (contentEnd > contentStart && /\s/.test(source[contentEnd - 1]!)) {
      contentEnd -= 1
    }

    blocks.push({ index, contentStart, contentEnd, separatorEnd })
  }

  return {
    source,
    preamble: starts.length === 0 ? source : source.slice(0, starts[0]!),
    blocks,
  }
}

/**
 * Re-emits the document.
 *
 * Clean blocks are copied from the baseline. Dirty blocks are replaced by the
 * caller's serialized text, keeping their original separator. `dirty` maps a
 * block index to its newly serialized content.
 */
export function emitDocument(map: SourceMap, dirty: ReadonlyMap<number, string>): string {
  const parts: string[] = [map.preamble]

  for (const block of map.blocks) {
    const replacement = dirty.get(block.index)
    if (replacement === undefined) {
      parts.push(map.source.slice(block.contentStart, block.separatorEnd))
      continue
    }
    parts.push(replacement, map.source.slice(block.contentEnd, block.separatorEnd))
  }

  return parts.join('')
}
