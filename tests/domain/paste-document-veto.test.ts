import { describe, expect, it } from 'vitest'

import {
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeStackTrace,
} from '../../src/domain/index.js'

/**
 * BUG-5: the exhaust tier claims a paste that **is** a terminal artifact, not a
 * document that happens to contain one.
 *
 * Reported by pasting a long Markdown document whose ASCII architecture diagram
 * held four box-drawing lines. `looksLikeFileTree` tested for presence, so the
 * whole document — headings, tables, lists and all — became one ```tree card.
 *
 * Three siblings shared the flaw, so each is covered both ways here: the bare
 * artifact must still convert, and the same artifact quoted inside a document
 * must not claim the document.
 */

const TREE = `src
├── domain
│   └── paste
└── adapters
    └── renderers`

const DIFF = `diff --git a/a.ts b/a.ts
@@ -1,3 +1,3 @@
-const a = 1
+const a = 2`

const ANSI = '[32mPASS[0m tests/app.test.ts\n[31mFAIL[0m tests/x.test.ts'

const STACK = `Traceback (most recent call last):
  File "app.py", line 12, in <module>
    main()
  File "app.py", line 8, in main
    raise ValueError("no")`

/** The reported paste, reduced to the shape that matters. */
const documentContaining = (artifact: string, fence = 'text'): string => `## What you get once it's built

Not "3,000 integrations in the UI." You get a **local connector gateway**:

| Outcome | When |
|---|---|
| Composio private mode | Own-cloud stack passes every hard gate |

\`\`\`${fence}
${artifact}
\`\`\`

Internal contract stays stable regardless of vendor.`

describe('the exhaust tier still claims a bare artifact', () => {
  it('claims a bare file tree', () => {
    expect(looksLikeFileTree(TREE)).toBe(true)
  })
  it('claims a bare unified diff', () => {
    expect(looksLikeDiff(DIFF)).toBe(true)
  })
  it('claims a bare ANSI capture', () => {
    expect(looksLikeAnsi(ANSI)).toBe(true)
  })
  it('claims a bare stack trace', () => {
    expect(looksLikeStackTrace(STACK)).toBe(true)
  })
})

describe('the exhaust tier declines a document that merely contains one', () => {
  it('declines a Markdown document holding an ASCII tree — the reported bug', () => {
    expect(looksLikeFileTree(documentContaining(TREE))).toBe(false)
  })
  it('declines a Markdown document quoting a diff', () => {
    expect(looksLikeDiff(documentContaining(DIFF, 'diff'))).toBe(false)
  })
  it('declines a Markdown document quoting CI output with colour codes', () => {
    expect(looksLikeAnsi(documentContaining(ANSI, 'ansi'))).toBe(false)
  })
  it('declines a Markdown document quoting a stack trace', () => {
    expect(looksLikeStackTrace(documentContaining(STACK))).toBe(false)
  })
})

describe('what marks a payload as a document', () => {
  it('a heading is enough', () => {
    expect(looksLikeFileTree(`## Architecture\n\n${TREE}`)).toBe(false)
  })
  it('a table is enough', () => {
    expect(looksLikeFileTree(`| a | b |\n|---|---|\n| 1 | 2 |\n\n${TREE}`)).toBe(false)
  })
  it('a code fence is enough', () => {
    expect(looksLikeFileTree('```text\n' + TREE + '\n```')).toBe(false)
  })
  it('prose alone is not — a tree pasted under a sentence is still a tree', () => {
    // No heading, table or fence: this is someone pasting terminal output with
    // a stray line above it, which the tier should still claim.
    expect(looksLikeFileTree(`here is the layout\n${TREE}`)).toBe(true)
  })
})

describe('density: a couple of stragglers do not make an artifact', () => {
  it('declines two tree lines adrift in a wall of prose', () => {
    const prose = Array.from({ length: 40 }, (_, i) => `Line ${i} of ordinary prose.`).join('\n')
    expect(looksLikeFileTree(`${prose}\n├── one\n└── two`)).toBe(false)
  })
  it('claims a tree with a heading line above it', () => {
    expect(looksLikeFileTree('project\n├── one\n├── two\n└── three')).toBe(true)
  })
})
