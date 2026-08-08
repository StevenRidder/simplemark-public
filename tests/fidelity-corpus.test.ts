import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { firstByteDifference } from '../src/domain/index.js'
import { FIDELITY_FIXTURES, readFixture } from './support/fixtures.js'

describe('the D7 fidelity fixture corpus', () => {
  test('contains exactly the ten acceptance fixtures named in DESIGN.md §12', () => {
    expect(FIDELITY_FIXTURES).toHaveLength(10)
    expect(FIDELITY_FIXTURES.map((fixture) => fixture.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test.each(FIDELITY_FIXTURES)('fixture $id ($file) is present and non-empty', (fixture) => {
    expect(readFixture(fixture).byteLength).toBeGreaterThan(0)
  })

  // The corpus is only evidence if the harness can actually see a change in it.
  // Comparing each fixture against a single-byte mutation of itself proves both
  // halves at once: the fixtures load losslessly, and the differ does not
  // silently pass a document it failed to read.
  test.each(FIDELITY_FIXTURES)('a single flipped byte in fixture $id is detected', (fixture) => {
    const original = readFixture(fixture)
    expect(firstByteDifference(original, original)).toBeNull()

    const target = Math.floor(original.byteLength / 2)
    const mutated = Uint8Array.from(original)
    mutated[target] = original[target] === 0x41 ? 0x42 : 0x41

    expect(firstByteDifference(original, mutated)?.offset).toBe(target)
  })
})

describe('fixture 09, the byte-level hostility fixture', () => {
  const source = readFileSync(
    new URL('./fixtures/09-byte-level-hostility.md', import.meta.url),
  )

  // This fixture is the one an editor, formatter, or git EOL setting is most
  // likely to "fix". If any of these assertions fail the corpus has been
  // sanitised and the whole gate is weaker than it looks — which would be a
  // silently green result, exactly what the fidelity contract forbids.
  test('still carries CRLF line endings', () => {
    expect(source.includes(Buffer.from([0x0d, 0x0a]))).toBe(true)
  })

  test('still carries hard tabs', () => {
    expect(source.includes(0x09)).toBe(true)
  })

  test('still carries trailing whitespace before a line break', () => {
    expect(/[ \t]\r?\n/.test(source.toString('utf8'))).toBe(true)
  })

  test('still ends without a final newline', () => {
    expect(source[source.length - 1]).not.toBe(0x0a)
  })
})
