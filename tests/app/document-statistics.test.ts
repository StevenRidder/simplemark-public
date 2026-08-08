import { describe, expect, it } from 'vitest'

import { documentStatistics } from '../../src/app/document-statistics.js'

/**
 * These fix the one property that matters: the numbers describe the prose a
 * person reads, not the Markdown that encodes it. A count that includes fence
 * characters and link targets is not wrong by a little, it answers a different
 * question than the one the panel asks.
 */
describe('document statistics', () => {
  it('counts words of prose', () => {
    expect(documentStatistics('one two three').words).toBe(3)
  })

  it('reports zero for an empty document rather than a one-minute read', () => {
    const stats = documentStatistics('')
    expect(stats.words).toBe(0)
    expect(stats.paragraphs).toBe(0)
    expect(stats.readMinutes).toBe(0)
  })

  it('never rounds a short note down to no reading time at all', () => {
    expect(documentStatistics('a single sentence here').readMinutes).toBe(1)
  })

  it('ignores fenced code, which is looked at rather than read', () => {
    const markdown = ['Before the block.', '', '```js', 'const a = 1', 'const b = 2', '```', '', 'After.'].join(
      '\n',
    )
    expect(documentStatistics(markdown).words).toBe(4)
  })

  it('ignores an unterminated fence rather than counting the rest of the file', () => {
    // A half-typed block is the normal state of a document being written.
    expect(documentStatistics('Real words here\n\n```\nnever closed at all').words).toBe(3)
  })

  it('counts link text but not link targets', () => {
    // "See the design notes." — the URL contributes nothing a person reads.
    expect(documentStatistics('See [the design notes](https://example.com/a/very/long/path).').words).toBe(4)
  })

  it('ignores images entirely, alt text included', () => {
    expect(documentStatistics('Look ![a wide diagram](./diagram.png) here').words).toBe(2)
  })

  it('drops heading, quote, and list markers', () => {
    const markdown = ['# Title here', '', '> quoted line', '', '- first item', '- second item'].join('\n')
    expect(documentStatistics(markdown).words).toBe(8)
  })

  it('drops task-list checkboxes', () => {
    expect(documentStatistics('- [ ] buy milk\n- [x] write tests').words).toBe(4)
  })

  it('does not count a thematic break as a word', () => {
    expect(documentStatistics('Above.\n\n---\n\nBelow.').words).toBe(2)
  })

  it('does not count emphasis markers as characters', () => {
    // "one two" — the asterisks are syntax, not letters on the page.
    expect(documentStatistics('**one** *two*').characters).toBe('one two'.length)
  })

  it('counts characters including the spaces between words, as Bear reports', () => {
    expect(documentStatistics('one two three').characters).toBe(13)
  })

  it('counts paragraphs as blank-line separated blocks that say something', () => {
    expect(documentStatistics('First block.\n\n\n\nSecond block.\n\n   \n\nThird.').paragraphs).toBe(3)
  })

  it('rounds reading time up, at the rate that reproduces Bear on a shared note', () => {
    const stats = documentStatistics(Array.from({ length: 525 }, (_, index) => `word${index}`).join(' '))
    expect(stats.words).toBe(525)
    expect(stats.readMinutes).toBe(2)
  })
})
