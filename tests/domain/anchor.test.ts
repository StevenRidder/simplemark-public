import { describe, expect, test } from 'vitest'

import { CONTEXT_LENGTH, buildAnchor, matchAnchor } from '../../src/domain/index.js'

/**
 * The orphan rule, tested as arithmetic.
 *
 * Everything this feature promises about never guessing lives in one function.
 * Ambiguity resolves to `undefined`, never to a best effort — a note on the
 * wrong sentence is worse than a note that admits it is lost (ADR-0007).
 */
describe('buildAnchor', () => {
  test('captures the quote with bounded context on both sides', () => {
    const text = 'A'.repeat(50) + 'QUOTE' + 'B'.repeat(50)
    const anchor = buildAnchor(text, 50, 55, 3)

    expect(anchor.quote).toBe('QUOTE')
    expect(anchor.prefix).toBe('A'.repeat(CONTEXT_LENGTH))
    expect(anchor.suffix).toBe('B'.repeat(CONTEXT_LENGTH))
    expect(anchor.blockIndex).toBe(3)
  })

  test('truncates context at the ends of the text', () => {
    const anchor = buildAnchor('ab QUOTE cd', 3, 8, 0)

    expect(anchor.quote).toBe('QUOTE')
    expect(anchor.prefix).toBe('ab ')
    expect(anchor.suffix).toBe(' cd')
  })
})

describe('matchAnchor', () => {
  test('finds a unique quote', () => {
    const anchor = buildAnchor('the Starlink business grew', 4, 12, 0)

    expect(matchAnchor(anchor, 'the Starlink business grew')).toBe(4)
  })

  test('finds the quote after unrelated edits elsewhere', () => {
    const anchor = buildAnchor('the Starlink business grew', 4, 12, 0)

    expect(matchAnchor(anchor, 'PREAMBLE. the Starlink business grew a lot')).toBe(14)
  })

  test('disambiguates repeats using surrounding context', () => {
    const source = 'alpha TARGET omega ... beta TARGET zeta'
    const anchor = buildAnchor(source, 28, 34, 0) // the second TARGET

    expect(anchor.quote).toBe('TARGET')
    expect(matchAnchor(anchor, source)).toBe(28)
  })

  test('orphans when repeats cannot be told apart', () => {
    // Identical context on both sides: nothing can choose between them.
    const anchor = buildAnchor('x TARGET y', 2, 8, 0)

    expect(matchAnchor(anchor, 'x TARGET y ... x TARGET y')).toBeUndefined()
  })

  test('orphans when the quote is gone', () => {
    const anchor = buildAnchor('the Starlink business', 4, 12, 0)

    expect(matchAnchor(anchor, 'operating losses narrowed')).toBeUndefined()
  })

  test('matches an exact quote inside a longer word', () => {
    const anchor = buildAnchor('the Starlink business', 4, 12, 0)

    expect(matchAnchor(anchor, 'the Starlink businesses')).toBe(4)
  })

  test('does not match a merely similar quote', () => {
    const anchor = buildAnchor('the Starlink business', 4, 12, 0)

    // One transposed letter is not the passage. No fuzzy matching, ever.
    expect(matchAnchor(anchor, 'the Starlnk business')).toBeUndefined()
  })

  test('orphans on an empty quote rather than matching everywhere', () => {
    const anchor = buildAnchor('unchanged', 0, 0, 0)

    expect(anchor.quote).toBe('')
    expect(matchAnchor(anchor, 'unchanged')).toBeUndefined()
  })
})
