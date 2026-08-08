/**
 * Byte-level divergence reporting for the D7 fidelity contract.
 *
 * D7 is defined in terms of byte identity — "opening a note and saving it must
 * produce a byte-identical file" — so locating the exact byte where two
 * serializations diverge is a rule of the source model, not a generic helper.
 * That is why this lives in `domain/source` rather than a `utils` bucket
 * (ADR-0001 explicitly rejects a generic utils dumping ground).
 *
 * Pure: no filesystem, no DOM, no framework. Runs in plain Node.
 */

const LINE_FEED = 0x0a

export interface ByteDifference {
  /** Byte offset of the first divergence, 0-based. */
  readonly offset: number
  /** 1-based line containing `offset`, counting LF. */
  readonly line: number
  /** 1-based column within that line, measured in bytes. */
  readonly column: number
  /** Escaped window of the expected bytes around `offset`. */
  readonly expectedSnippet: string
  /** Escaped window of the actual bytes around `offset`. */
  readonly actualSnippet: string
}

/** Bytes of context shown either side of the divergence. */
const SNIPPET_RADIUS = 24

const decoder = new TextDecoder('utf-8')

/**
 * Renders a byte window as text with invisible and control bytes escaped.
 * Without this, a report of a tab-for-space or CRLF-for-LF substitution prints
 * two strings that look identical, which is the failure mode the D7 fixtures
 * exist to catch.
 */
function snippet(source: Uint8Array, offset: number): string {
  const start = Math.max(0, offset - SNIPPET_RADIUS)
  const end = Math.min(source.length, offset + SNIPPET_RADIUS)

  return [...decoder.decode(source.subarray(start, end))]
    .map((character) => {
      switch (character) {
        case '\t':
          return '\\t'
        case '\r':
          return '\\r'
        case '\n':
          return '\\n'
        default: {
          const code = character.codePointAt(0) ?? 0
          if (code < 0x20 || code === 0x7f) {
            return `\\x${code.toString(16).padStart(2, '0')}`
          }
          return character
        }
      }
    })
    .join('')
}

/**
 * Line and column are measured in bytes, not code points. A multi-byte
 * character that differs mid-sequence should report where the bytes actually
 * diverge; rounding to a character boundary would hide the real edit.
 */
function locate(source: Uint8Array, offset: number): { line: number; column: number } {
  let line = 1
  let lastLineStart = 0

  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === LINE_FEED) {
      line += 1
      lastLineStart = index + 1
    }
  }

  return { line, column: offset - lastLineStart + 1 }
}

export function firstByteDifference(
  expected: Uint8Array,
  actual: Uint8Array,
): ByteDifference | null {
  const shared = Math.min(expected.length, actual.length)

  for (let offset = 0; offset < shared; offset += 1) {
    if (expected[offset] !== actual[offset]) {
      return describe(expected, actual, offset)
    }
  }

  if (expected.length !== actual.length) {
    return describe(expected, actual, shared)
  }

  return null
}

function describe(expected: Uint8Array, actual: Uint8Array, offset: number): ByteDifference {
  return {
    offset,
    ...locate(expected, offset),
    expectedSnippet: snippet(expected, offset),
    actualSnippet: snippet(actual, offset),
  }
}
