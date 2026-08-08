import { describe, expect, it } from 'vitest'

import { isPortableAssetReference, isRemoteImageSource } from '../../src/domain/index.js'

/**
 * The two guards that bound what a paste may fetch and what it may write.
 * Everything the download path touches passes through one of them.
 */
describe('isRemoteImageSource', () => {
  it('is true for http and https', () => {
    expect(isRemoteImageSource('http://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('https://example.com/a.png')).toBe(true)
  })

  it('ignores surrounding whitespace and case', () => {
    expect(isRemoteImageSource('  HTTPS://example.com/a.png ')).toBe(true)
  })

  it('is false for sources that are already local', () => {
    expect(isRemoteImageSource('assets/a.png')).toBe(false)
    expect(isRemoteImageSource('data:image/png;base64,AAAA')).toBe(false)
    expect(isRemoteImageSource('blob:http://localhost/abc')).toBe(false)
    expect(isRemoteImageSource('file:///tmp/x/a.png')).toBe(false)
    expect(isRemoteImageSource('')).toBe(false)
  })
})

describe('isPortableAssetReference', () => {
  it('accepts a note-relative path', () => {
    expect(isPortableAssetReference('assets/3f9a1c2b7d4e5f60.png')).toBe(true)
  })

  it('refuses anything that leaves the note folder or names a host', () => {
    expect(isPortableAssetReference('/etc/passwd')).toBe(false)
    expect(isPortableAssetReference('~/secrets.png')).toBe(false)
    expect(isPortableAssetReference('../outside.png')).toBe(false)
    expect(isPortableAssetReference('assets/../../outside.png')).toBe(false)
    expect(isPortableAssetReference('https://example.com/a.png')).toBe(false)
    expect(isPortableAssetReference('C:\\images\\a.png')).toBe(false)
    expect(isPortableAssetReference('')).toBe(false)
    expect(isPortableAssetReference('assets//a.png')).toBe(false)
  })
})
