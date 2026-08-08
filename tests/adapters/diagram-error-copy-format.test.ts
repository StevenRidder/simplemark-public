import { describe, expect, it } from 'vitest'

import { formatDiagramErrorForCopy } from '../../src/adapters/editor/diagram-node-view.js'

describe('formatDiagramErrorForCopy', () => {
  it('carries the language, error, and source in one pasteable block', () => {
    const text = formatDiagramErrorForCopy('mermaid', 'flowchart TD\n  A -> B', 'Parse error on line 1')
    expect(text).toBe(
      'Diagram type: mermaid\n' +
      'Error: Parse error on line 1\n' +
      '\n' +
      'Source:\n' +
      '```mermaid\n' +
      'flowchart TD\n  A -> B\n' +
      '```\n',
    )
  })
})
