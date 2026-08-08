import { describe, expect, it } from 'vitest'

import { CALLOUT_TYPES, matchCalloutMarker } from '../../src/domain/index.js'

/**
 * GitHub callout markers: `> [!NOTE]` and friends.
 *
 * The recogniser is pure — it answers "is this first line a callout marker,
 * and what remains of that line?" The remark plugin and the ProseMirror node
 * are the adapter's job.
 *
 * The five types are GitHub's, which is what EDITOR-9 specifies and what
 * renders natively on github.com — so a note stays legible where it is read.
 */

describe('CALLOUT_TYPES', () => {
  it('is exactly GitHub’s five', () => {
    expect([...CALLOUT_TYPES]).toEqual(['note', 'tip', 'important', 'warning', 'caution'])
  })
})

describe('matchCalloutMarker', () => {
  it('claims each supported type, case-insensitively', () => {
    for (const type of CALLOUT_TYPES) {
      expect(matchCalloutMarker(`[!${type.toUpperCase()}]`)?.type).toBe(type)
      expect(matchCalloutMarker(`[!${type}]`)?.type).toBe(type)
    }
  })

  it('returns the text remaining on the marker line', () => {
    expect(matchCalloutMarker('[!NOTE] Same line as the marker')).toEqual({
      type: 'note',
      rest: 'Same line as the marker',
    })
  })

  it('returns an empty remainder when the marker is alone', () => {
    expect(matchCalloutMarker('[!WARNING]')).toEqual({ type: 'warning', rest: '' })
  })

  it('tolerates the whitespace GitHub tolerates', () => {
    expect(matchCalloutMarker('[!TIP]   padded')?.rest).toBe('padded')
    expect(matchCalloutMarker('  [!TIP] leading space')?.type).toBe('tip')
  })

  it('declines an unknown type rather than inventing one', () => {
    expect(matchCalloutMarker('[!DANGER] not a GitHub type')).toBeNull()
    expect(matchCalloutMarker('[!INFO] neither is this')).toBeNull()
  })

  it('declines ordinary prose and links that merely start with a bracket', () => {
    expect(matchCalloutMarker('Just a quoted sentence.')).toBeNull()
    expect(matchCalloutMarker('[link](https://example.com) at the start')).toBeNull()
    expect(matchCalloutMarker('![image](x.png)')).toBeNull()
    expect(matchCalloutMarker('[!] empty type')).toBeNull()
  })

  it('requires the marker at the start, not mid-sentence', () => {
    expect(matchCalloutMarker('see [!NOTE] later in the line')).toBeNull()
  })
})
