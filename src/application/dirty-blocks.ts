import type { SourceMap } from '../domain/index.js'

/**
 * Which blocks a save must re-serialize, and which can keep their original bytes.
 *
 * The editor hands the session whole-document Markdown; it does not say what
 * changed. Rather than teach the editor adapter to map ProseMirror nodes onto
 * source blocks — the hard half of FIDELITY-1, and not needed for this — the
 * dirty set is derived by comparing the two source maps. A block is dirty
 * precisely when its bytes differ, which is honest by construction.
 *
 * Returns `null` for "cannot tell". Pairing blocks by index is only meaningful
 * while the counts agree; once a block is added, removed or split, index *n*
 * on each side is not the same block and any answer would be a guess. The
 * caller turns `null` into a whole-document write — which renormalizes, exactly
 * as every save did before this existed, and is the honest boundary rather than
 * a silent wrong preservation.
 */
export function dirtyBlocks(
  baseline: SourceMap,
  next: SourceMap,
  equivalent: (a: string, b: string) => boolean = (a, b) => a === b,
): ReadonlyMap<number, string> | null {
  if (baseline.blocks.length !== next.blocks.length) return null

  // `emitDocument` re-emits the baseline's preamble verbatim, so a changed
  // preamble cannot be expressed through the dirty map at all. Front matter is
  // the preamble; letting this through would silently discard an edit to it.
  if (baseline.preamble !== next.preamble) return null

  const dirty = new Map<number, string>()

  for (const [index, block] of baseline.blocks.entries()) {
    const candidate = next.blocks[index]
    if (candidate === undefined) return null

    const before = baseline.source.slice(block.contentStart, block.contentEnd)
    const after = next.source.slice(candidate.contentStart, candidate.contentEnd)

    // Meaning, not bytes. The editor renormalizes every block it serializes,
    // so byte inequality says almost nothing about what the author changed.
    if (!equivalent(before, after)) dirty.set(block.index, after)
  }

  return dirty
}
