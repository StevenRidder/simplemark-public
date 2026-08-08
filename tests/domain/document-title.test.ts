import { describe, expect, it } from 'vitest'

import { suggestedMarkdownFileName } from '../../src/domain/index.js'

describe('suggestedMarkdownFileName', () => {
  it('uses the first non-empty level-one heading and keeps the Markdown suffix', () => {
    expect(suggestedMarkdownFileName('intro\n# Project plan\n\n# Later heading\n')).toBe('Project plan.md')
  })

  it('does not treat a deeper heading or an empty H1 as a filename', () => {
    expect(suggestedMarkdownFileName('## Details\n#   \n')).toBe('Untitled.md')
  })

  it('makes an H1 safe for a filename without changing the source document', () => {
    expect(suggestedMarkdownFileName('# Research: June / July #\n')).toBe('Research June July.md')
  })
})
