import { describe, expect, it } from 'vitest'

import {
  DEFERRED_TABLE_LANGUAGE,
  prepareMarkdownForEditor,
} from '../../src/adapters/editor/deferred-tables.js'

function table(rows: number, columns = 4): string {
  const header = Array.from({ length: columns }, (_, index) => ` C${index + 1} `).join('|')
  const divider = Array.from({ length: columns }, () => ' --- ').join('|')
  const body = Array.from(
    { length: rows },
    (_, row) => `|${Array.from({ length: columns }, (_, column) => ` ${row}:${column} `).join('|')}|`,
  )
  return `|${header}|\n|${divider}|\n${body.join('\n')}`
}

describe('prepareMarkdownForEditor', () => {
  it('does not alter an ordinary document', () => {
    const markdown = `# Small table\n\n${table(2)}\n`
    const prepared = prepareMarkdownForEditor(markdown)

    expect(prepared.editorMarkdown).toBe(markdown)
    expect(prepared.deferredTables.size).toBe(0)
    expect(prepared.restoreMarkdown(markdown)).toBe(markdown)
  })

  it('uses small marker fences but restores the exact original table source', () => {
    const source = table(1_000)
    const markdown = `# Generated report\n\nBefore the data.\n\n${source}\n\nAfter the data.\n`
    const prepared = prepareMarkdownForEditor(markdown)

    expect(prepared.deferredTables.size).toBe(1)
    expect(prepared.editorMarkdown).toContain(`\`\`\`${DEFERRED_TABLE_LANGUAGE}`)
    expect(prepared.editorMarkdown).not.toContain('| 999:3 |')
    expect(prepared.restoreMarkdown(prepared.editorMarkdown)).toBe(markdown)

    const deferred = [...prepared.deferredTables.values()][0]!
    // The source span owns its terminating line break when the table is not
    // the final document block, so replacement can restore the exact boundary.
    expect(deferred.source).toBe(`${source}\n`)
    expect(deferred).toMatchObject({ rowCount: 1_001, columnCount: 4, cellCount: 4_004 })
  })

  it('preserves deferred tables when a later visible paragraph is edited', () => {
    const source = table(1_000)
    const markdown = `# Generated report\n\n${source}\n\nClosing prose.\n`
    const prepared = prepareMarkdownForEditor(markdown)
    const editedProjection = prepared.editorMarkdown.replace('Closing prose.', 'Edited closing prose.')
    const restored = prepared.restoreMarkdown(editedProjection)

    expect(restored).toContain(source)
    expect(restored).toContain('Edited closing prose.')
    expect(restored).not.toContain(DEFERRED_TABLE_LANGUAGE)
  })
})
