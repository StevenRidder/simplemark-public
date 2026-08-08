import { describe, expect, it } from 'vitest'

import { MdastBlockBoundaries } from '../../src/adapters/editor/mdast-block-boundaries.js'

const boundaries = new MdastBlockBoundaries()

/** The text each reported offset begins, which is what the tiling relies on. */
function blocksOf(markdown: string): string[] {
  const starts = [...boundaries.starts(markdown)]
  return starts.map((start, index) =>
    markdown.slice(start, starts[index + 1] ?? markdown.length).trimEnd(),
  )
}

describe('mdast block boundaries', () => {
  it('reports the start of every top-level block', () => {
    expect(blocksOf('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')).toEqual([
      '# Title',
      'First paragraph.',
      'Second paragraph.',
    ])
  })

  it('reports ascending offsets that begin real content, not whitespace', () => {
    const markdown = '# Title\n\n\nSpaced out.\n'
    const starts = boundaries.starts(markdown)

    expect([...starts]).toEqual([...starts].slice().sort((a, b) => a - b))
    for (const start of starts) expect(markdown[start]).not.toMatch(/\s/)
  })

  // A fenced block is one block however many blank lines it contains — the
  // case a hand-rolled blank-line scanner gets wrong, and the reason this uses
  // a real parser.
  it('keeps a fenced code block whole despite its blank lines', () => {
    const markdown = '# Title\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\nAfter.\n'

    expect(blocksOf(markdown)).toEqual([
      '# Title',
      '```js\nconst a = 1\n\nconst b = 2\n```',
      'After.',
    ])
  })

  it('treats a list as one block rather than one per item', () => {
    const markdown = '# Title\n\n- one\n- two\n- three\n\nAfter.\n'

    expect(blocksOf(markdown)).toEqual(['# Title', '- one\n- two\n- three', 'After.'])
  })

  // The document that started all this: `-` bullets and `---` rules, which the
  // serializer was rewriting. The boundaries must see them as ordinary blocks.
  it('handles the constructs that were being renormalized', () => {
    const markdown = '# Title\n\n- **Status:** draft\n- **Date:** today\n\n---\n\n## Next\n\nBody.\n'

    expect(blocksOf(markdown)).toEqual([
      '# Title',
      '- **Status:** draft\n- **Date:** today',
      '---',
      '## Next',
      'Body.',
    ])
  })

  it('reports nothing for an empty document', () => {
    expect(boundaries.starts('')).toEqual([])
  })
})
