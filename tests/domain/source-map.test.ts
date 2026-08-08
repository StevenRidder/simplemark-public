import { describe, expect, test } from 'vitest'

import { buildSourceMap, emitDocument } from '../../src/domain/index.js'

/**
 * The D7 fidelity contract, as executable rules.
 *
 *   | Preserved  | blocks the user did not edit | original bytes re-emitted verbatim |
 *   | Normalized | blocks the user edited       | serialized; semantic equivalence   |
 *
 * The map tiles the file: every byte belongs to exactly one block, including
 * the blank lines between them. That is what makes "untouched save is
 * byte-identical" true by construction rather than by luck.
 */

const SOURCE = ['# Title', '', 'First paragraph.', '', '- a', '- b', '', 'Last.', ''].join('\n')
// offsets:      0          8    9                  26   27     31    35   36      42

describe('buildSourceMap', () => {
  test('tiles the whole file so the spans reconstruct it exactly', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])

    expect(map.blocks.map((b) => b.contentStart)).toEqual([0, 9, 27, 36])
    // Every byte is covered exactly once, in order.
    expect(map.blocks.map((b) => SOURCE.slice(b.contentStart, b.separatorEnd)).join('')).toBe(SOURCE)
  })

  test('gives each block the separator that follows it', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])

    const first = map.blocks[0]!
    expect(SOURCE.slice(first.contentStart, first.contentEnd)).toBe('# Title')
    expect(SOURCE.slice(first.contentEnd, first.separatorEnd)).toBe('\n\n')
  })

  test('the final block keeps whatever trailing bytes the file had, including none', () => {
    const noNewline = 'alpha\n\nomega'
    const map = buildSourceMap(noNewline, [0, 7])

    const last = map.blocks[1]!
    expect(noNewline.slice(last.contentStart, last.separatorEnd)).toBe('omega')
    expect(map.blocks.map((b) => noNewline.slice(b.contentStart, b.separatorEnd)).join('')).toBe(
      noNewline,
    )
  })

  test('preserves bytes before the first block', () => {
    const leading = '\n\n# Title\n'
    const map = buildSourceMap(leading, [2])
    expect(map.preamble).toBe('\n\n')
    expect(map.preamble + map.blocks.map((b) => leading.slice(b.contentStart, b.separatorEnd)).join('')).toBe(leading)
  })
})

describe('emitDocument', () => {
  test('an untouched document is byte-identical', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])
    expect(emitDocument(map, new Map())).toBe(SOURCE)
  })

  // The whole point of D7: editing one block must not disturb the others.
  test('a dirty block serializes while every other block keeps its original bytes', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])

    const out = emitDocument(map, new Map([[2, '* a\n* b']]))

    expect(out).toBe(['# Title', '', 'First paragraph.', '', '* a', '* b', '', 'Last.', ''].join('\n'))
    // Untouched neighbours are untouched byte-for-byte.
    expect(out.startsWith('# Title\n\nFirst paragraph.\n\n')).toBe(true)
    expect(out.endsWith('\n\nLast.\n')).toBe(true)
  })

  test('a dirty block keeps the separator that followed it', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])
    const out = emitDocument(map, new Map([[0, '# Retitled']]))
    expect(out).toBe(['# Retitled', '', 'First paragraph.', '', '- a', '- b', '', 'Last.', ''].join('\n'))
  })

  test('dirtying every block is just a full re-serialization', () => {
    const map = buildSourceMap('a\n\nb\n', [0, 3])
    expect(emitDocument(map, new Map([[0, 'A'], [1, 'B']]))).toBe('A\n\nB\n')
  })

  test('an out-of-range dirty index is ignored rather than corrupting the output', () => {
    const map = buildSourceMap(SOURCE, [0, 9, 27, 36])
    expect(emitDocument(map, new Map([[99, 'nonsense']]))).toBe(SOURCE)
  })
})
