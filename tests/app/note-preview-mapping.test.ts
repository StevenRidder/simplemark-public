import { describe, expect, it } from 'vitest'
import { previewFor } from '../../src/app/note-preview-line.js'

describe('note-list preview', () => {
  it('uses the note’s own lead sentence', () => {
    expect(previewFor({ preview: 'The agent rewrites this file.' })).toBe(
      'The agent rewrites this file.',
    )
  })

  // The row must go bare rather than back to the placeholder this work
  // exists to delete.
  it('is empty when the note has no prose', () => {
    expect(previewFor({})).toBe('')
  })

  // The native catalog skips the field, but never render the string "null"
  // under a note title if some other producer sends one.
  it('treats an explicit null as absent', () => {
    expect(previewFor({ preview: null })).toBe('')
  })
})
