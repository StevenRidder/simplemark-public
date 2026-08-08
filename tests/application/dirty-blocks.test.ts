import { describe, expect, it } from 'vitest'

import { buildSourceMap } from '../../src/domain/index.js'
import { dirtyBlocks } from '../../src/application/index.js'

/**
 * Block starts for a test fixture: the offset of every top-level block.
 *
 * `buildSourceMap` is a tiling function and takes these from its caller — it
 * does not parse Markdown. In the app they come from a parser (see the plan);
 * here a blank-line split is enough and keeps the test about comparison.
 */
function starts(markdown: string): number[] {
  const offsets: number[] = []
  let atBlockStart = true
  for (let i = 0; i < markdown.length; i += 1) {
    if (atBlockStart && !/\s/.test(markdown[i]!)) {
      offsets.push(i)
      atBlockStart = false
    }
    if (markdown.startsWith('\n\n', i)) atBlockStart = true
  }
  return offsets
}

const map = (markdown: string) => buildSourceMap(markdown, starts(markdown))

describe('deriving the dirty block set', () => {
  it('finds nothing dirty when the document is unchanged', () => {
    const source = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'

    expect(dirtyBlocks(map(source), map(source))?.size).toBe(0)
  })

  // The defect this whole change exists to fix: one edited paragraph must not
  // make its neighbours dirty, because a dirty block is re-serialized and a
  // re-serialized block is renormalized.
  it('marks only the block whose text actually changed', () => {
    const before = map('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
    const after = map('# Title\n\nFirst paragraph, edited.\n\nSecond paragraph.\n')

    const dirty = dirtyBlocks(before, after)

    expect(dirty?.size).toBe(1)
    expect([...dirty!.values()][0]).toContain('edited')
  })

  it('marks every changed block and no others', () => {
    const before = map('# Title\n\nAlpha.\n\nBravo.\n\nCharlie.\n')
    const after = map('# Title\n\nAlpha changed.\n\nBravo.\n\nCharlie changed.\n')

    const dirty = dirtyBlocks(before, after)

    expect(dirty?.size).toBe(2)
  })

  // Pairing blocks by index is only meaningful while the counts agree. When a
  // block is added, removed or split, the honest answer is "cannot tell" —
  // which the caller turns into a whole-document write rather than a guess.
  it('refuses when the block count changes', () => {
    const before = map('# Title\n\nOnly paragraph.\n')
    const after = map('# Title\n\nOnly paragraph.\n\nA new one.\n')

    expect(dirtyBlocks(before, after)).toBeNull()
  })

  it('refuses when the preamble changes', () => {
    // Front matter is the preamble, so block starts begin after it — which is
    // what the app's parser will report and what the naive test helper above
    // cannot model.
    const beforeSource = '---\ntitle: a\n---\n\n# Title\n\nBody.\n'
    const afterSource = '---\ntitle: b\n---\n\n# Title\n\nBody.\n'
    const afterFrontMatter = beforeSource.indexOf('# Title')
    const before = buildSourceMap(beforeSource, [afterFrontMatter, beforeSource.indexOf('Body.')])
    const after = buildSourceMap(afterSource, [afterFrontMatter, afterSource.indexOf('Body.')])

    // Front matter is the preamble, and `emitDocument` re-emits the baseline's.
    // Letting this through would silently discard a front-matter edit.
    expect(dirtyBlocks(before, after)).toBeNull()
  })
})
