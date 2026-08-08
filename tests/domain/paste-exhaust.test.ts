import { describe, expect, it } from 'vitest'

import {
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeJson,
  looksLikeStackTrace,
  looksLikeTsv,
  tsvToMarkdownTable,
} from '../../src/domain/index.js'

/**
 * DESIGN.md §4.2 signatures for the paste-exhaust tier: the output formats of
 * AI and terminal work. Same rule as Mermaid — a signature is a cheap filter,
 * never a guarantee; the adapter validates before anything converts.
 */

describe('looksLikeTsv', () => {
  it('claims a rectangular tab-separated grid (the Excel/Sheets clipboard)', () => {
    expect(looksLikeTsv('Name\tRole\nAda\tEngineer\nGrace\tAdmiral')).toBe(true)
  })
  it('declines a single line', () => {
    expect(looksLikeTsv('Name\tRole')).toBe(false)
  })
  it('declines ragged rows — that is prose with tabs, not a table', () => {
    expect(looksLikeTsv('a\tb\nc\nd\te')).toBe(false)
  })
  it('declines text without tabs', () => {
    expect(looksLikeTsv('plain prose\nover two lines')).toBe(false)
  })
})

describe('tsvToMarkdownTable', () => {
  it('emits a GFM table with the first row as header', () => {
    expect(tsvToMarkdownTable('Name\tRole\nAda\tEngineer')).toBe(
      '| Name | Role |\n| --- | --- |\n| Ada | Engineer |',
    )
  })
  it('escapes pipes so cells cannot break the table', () => {
    expect(tsvToMarkdownTable('a|b\tc\nd\te')).toContain('a\\|b')
  })
})

describe('looksLikeDiff', () => {
  it('claims git diff output', () => {
    expect(looksLikeDiff('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-old\n+new')).toBe(true)
  })
  it('claims a bare unified hunk', () => {
    expect(looksLikeDiff('@@ -10,4 +10,6 @@\n context\n-gone\n+here')).toBe(true)
  })
  it('declines prose that merely starts lines with dashes', () => {
    expect(looksLikeDiff('- a bullet\n- another bullet')).toBe(false)
  })
})

describe('looksLikeAnsi', () => {
  it('claims text carrying SGR escape codes', () => {
    expect(looksLikeAnsi('[32m✓ passed[0m 56 tests')).toBe(true)
  })
  it('declines plain text', () => {
    expect(looksLikeAnsi('✓ passed 56 tests')).toBe(false)
  })
})

describe('looksLikeJson', () => {
  it('claims a parseable object', () => {
    expect(looksLikeJson('{ "a": 1, "b": [2, 3] }')).toBe(true)
  })
  it('claims a parseable array of objects', () => {
    expect(looksLikeJson('[{"id": 1}, {"id": 2}]')).toBe(true)
  })
  it('declines invalid JSON', () => {
    expect(looksLikeJson('{ not json }')).toBe(false)
  })
  it('declines bare scalars — "5" is prose, not a document', () => {
    expect(looksLikeJson('5')).toBe(false)
  })
})

describe('looksLikeFileTree', () => {
  it('claims box-drawing tree listings', () => {
    expect(looksLikeFileTree('src\n├── app\n│   └── main.ts\n└── domain')).toBe(true)
  })
  it('declines a single decorated line', () => {
    expect(looksLikeFileTree('└── lonely')).toBe(false)
  })
})

describe('looksLikeStackTrace', () => {
  it('claims a JS/TS stack', () => {
    expect(
      looksLikeStackTrace('Error: boom\n    at save (file.ts:12:5)\n    at main (app.ts:3:1)'),
    ).toBe(true)
  })
  it('claims a Python traceback', () => {
    expect(
      looksLikeStackTrace('Traceback (most recent call last):\n  File "x.py", line 1\nKeyError'),
    ).toBe(true)
  })
  it('declines prose mentioning errors', () => {
    expect(looksLikeStackTrace('The error at hand is boring.')).toBe(false)
  })
})
