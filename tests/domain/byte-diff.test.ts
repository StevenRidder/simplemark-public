import { describe, expect, test } from 'vitest'

import { firstByteDifference } from '../../src/domain/index.js'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('firstByteDifference', () => {
  test('reports no difference for byte-identical input', () => {
    expect(firstByteDifference(bytes('# Title\n\nbody\n'), bytes('# Title\n\nbody\n'))).toBeNull()
  })

  test('reports the byte offset where two documents first diverge', () => {
    const difference = firstByteDifference(bytes('line one\nline two\n'), bytes('line one\nline TWO\n'))

    expect(difference?.offset).toBe(14)
  })

  // Fixture 9 ("no trailing newline") fails exactly this way: a serializer that
  // helpfully appends a final newline produces a document identical up to the
  // end of the original. Treating a prefix as "no difference" would report that
  // fixture green while the bytes on disk changed.
  test('reports a difference at the end of the shorter document when one is a prefix of the other', () => {
    expect(firstByteDifference(bytes('body\n'), bytes('body'))?.offset).toBe(4)
    expect(firstByteDifference(bytes('body'), bytes('body\n'))?.offset).toBe(4)
  })

  test('locates the divergence by 1-based line and column', () => {
    const difference = firstByteDifference(
      bytes('alpha\nbravo\ncharlie\n'),
      bytes('alpha\nbravo\nCharlie\n'),
    )

    expect(difference).toMatchObject({ offset: 12, line: 3, column: 1 })
  })

  // Fixtures 5, 7, and 9 diverge on bytes that are invisible when printed
  // raw. A report reading `expected "col " / actual "col "` is worthless; the
  // snippet has to name the byte that actually changed.
  test('escapes invisible bytes in the snippets so tabs, CR, and trailing spaces stay legible', () => {
    const tab = firstByteDifference(bytes('a\tb'), bytes('a b'))
    expect(tab?.expectedSnippet).toContain('\\t')
    expect(tab?.actualSnippet).toContain(' ')

    const carriageReturn = firstByteDifference(bytes('x\r\ny'), bytes('x\ny'))
    expect(carriageReturn?.expectedSnippet).toContain('\\r')
    expect(carriageReturn?.actualSnippet).not.toContain('\\r')
  })
})
