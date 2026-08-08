import { describe, expect, it } from 'vitest'

import {
  codeFenceContent,
  markdownTableToCsv,
  markdownTableToHtml,
  markdownToPlainText,
} from '../../src/domain/index.js'

/**
 * EDITOR-10's selection-to-format contract, as pure rules over Markdown.
 *
 * These are the parts that must behave identically no matter which host owns
 * the clipboard, so they live in `domain` and are tested without a browser.
 * The adapters only carry the resulting strings to a platform clipboard.
 */

describe('markdownToPlainText', () => {
  it('drops emphasis, code and heading punctuation but keeps the words', () => {
    expect(markdownToPlainText('## The **bold** and `code` and *soft*')).toBe(
      'The bold and code and soft',
    )
  })

  it('keeps link text and drops the target', () => {
    expect(markdownToPlainText('See [the plan](https://example.com/x) today')).toBe(
      'See the plan today',
    )
  })

  it('keeps image alt text', () => {
    expect(markdownToPlainText('![Architecture diagram](assets/a.png)')).toBe(
      'Architecture diagram',
    )
  })

  it('keeps list content and strips the markers', () => {
    expect(markdownToPlainText('- first\n- second')).toBe('first\nsecond')
    expect(markdownToPlainText('1. first\n2. second')).toBe('first\nsecond')
  })

  it('keeps task text and renders the checkbox as a readable mark', () => {
    expect(markdownToPlainText('- [x] done\n- [ ] todo')).toBe('[x] done\n[ ] todo')
  })

  it('strips blockquote and callout markers', () => {
    expect(markdownToPlainText('> [!NOTE]\n> Body here')).toBe('NOTE\nBody here')
  })

  it('keeps a code fence body without the fence', () => {
    expect(markdownToPlainText('```ts\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('leaves ordinary prose untouched', () => {
    expect(markdownToPlainText('Just a sentence.')).toBe('Just a sentence.')
  })
})

describe('markdownTableToCsv', () => {
  const TABLE = '| Region | Revenue |\n| --- | --- |\n| West | 1200 |\n| East | 900 |'

  it('emits header and rows in document order', () => {
    expect(markdownTableToCsv(TABLE)).toBe('Region,Revenue\nWest,1200\nEast,900')
  })

  it('quotes cells containing a comma', () => {
    expect(markdownTableToCsv('| A | B |\n| --- | --- |\n| x,y | z |')).toBe('A,B\n"x,y",z')
  })

  it('escapes embedded double quotes by doubling them', () => {
    expect(markdownTableToCsv('| A |\n| --- |\n| say "hi" |')).toBe('A\n"say ""hi"""')
  })

  it('quotes cells containing a newline', () => {
    expect(markdownTableToCsv('| A |\n| --- |\n| one<br>two |')).toContain('"one\ntwo"')
  })

  it('unescapes the pipe escape the table syntax required, and does not quote it', () => {
    // A pipe is not a CSV special character (RFC 4180 quotes only for comma,
    // quote and newline), so it travels bare once the Markdown escape is undone.
    expect(markdownTableToCsv('| A |\n| --- |\n| x \\| y |')).toBe('A\nx | y')
  })

  it('preserves empty cells as empty fields', () => {
    expect(markdownTableToCsv('| A | B |\n| --- | --- |\n|  | z |')).toBe('A,B\n,z')
  })

  it('returns null when the selection is not a table', () => {
    expect(markdownTableToCsv('Just prose')).toBeNull()
    expect(markdownTableToCsv('| A | B |')).toBeNull()
  })
})

describe('markdownTableToHtml', () => {
  it('emits a real table with a header row', () => {
    const html = markdownTableToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('escapes cell content rather than emitting markup', () => {
    const html = markdownTableToHtml('| A |\n| --- |\n| <script> |')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('returns null when the selection is not a table', () => {
    expect(markdownTableToHtml('nope')).toBeNull()
  })
})

describe('codeFenceContent', () => {
  it('returns the body without the fence or language', () => {
    expect(codeFenceContent('```ts\nconst a = 1\nconst b = 2\n```')).toBe(
      'const a = 1\nconst b = 2',
    )
  })

  it('handles a fence with no language', () => {
    expect(codeFenceContent('```\nplain\n```')).toBe('plain')
  })

  it('preserves internal blank lines and indentation', () => {
    expect(codeFenceContent('```py\ndef f():\n\n    return 1\n```')).toBe('def f():\n\n    return 1')
  })

  it('returns null when the selection is not a fence', () => {
    expect(codeFenceContent('not code')).toBeNull()
  })
})
