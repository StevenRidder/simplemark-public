import { describe, expect, it } from 'vitest'

import { parseFenceLayout, withFenceMetaKey } from '../../src/domain/index.js'

/**
 * The fence info tail is the user's bytes (D7). Layout edits rewrite only
 * their own key; everything else survives verbatim and in order.
 */
describe('parseFenceLayout', () => {
  it('reads width and float', () => {
    expect(parseFenceLayout('width=320 float=left')).toEqual({ width: 320, float: 'left' })
  })
  it('ignores unknown tokens and junk values', () => {
    expect(parseFenceLayout('twoslash width=abc float=up title=x')).toEqual({
      width: undefined,
      float: undefined,
    })
  })
  it('is empty for an empty meta', () => {
    expect(parseFenceLayout('')).toEqual({ width: undefined, float: undefined })
  })
})

describe('withFenceMetaKey', () => {
  it('appends a new key', () => {
    expect(withFenceMetaKey('', 'width', '320')).toBe('width=320')
  })
  it('replaces an existing key in place', () => {
    expect(withFenceMetaKey('twoslash width=200 title=x', 'width', '320')).toBe(
      'twoslash width=320 title=x',
    )
  })
  it('removes a key with null', () => {
    expect(withFenceMetaKey('width=200 float=left', 'width', null)).toBe('float=left')
  })
  it('removing an absent key is identity', () => {
    expect(withFenceMetaKey('twoslash', 'width', null)).toBe('twoslash')
  })
  it('preserves unknown tokens verbatim and in order', () => {
    expect(withFenceMetaKey('a=1 b c=3', 'float', 'right')).toBe('a=1 b c=3 float=right')
  })
  it('replaces the first duplicate in place and drops the rest', () => {
    expect(withFenceMetaKey('width=100 float=left width=200', 'width', '320')).toBe(
      'width=320 float=left',
    )
  })
  it('removes every duplicate on null', () => {
    expect(withFenceMetaKey('width=100 width=200', 'width', null)).toBe('')
  })
})
