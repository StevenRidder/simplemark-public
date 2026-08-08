import { describe, expect, it } from 'vitest'

import {
  buildNumber,
  describeBuild,
  isBuiltFrom,
  isCommit,
  isRepository,
  readProvenance,
} from '../../src/app/build-provenance.js'

/**
 * The rule under test is honesty, not formatting. A build that cannot name its
 * commit must say so; it must never round an absent value up into something a
 * reader would take for a real commit, because the entire point of APP-22 is
 * being able to trust what the About panel says.
 */

const REAL = '7670ea436b308c4ba6669ddc47c54565deb6fa26'

describe('build provenance', () => {
  it('shows the short commit and the build date', () => {
    expect(
      describeBuild({ sha: REAL, shortSha: '7670ea4', builtAt: '2026-08-04T10:05:49Z', repository: 'example/simplemark' }),
    ).toBe('Commit 7670ea4 · built 2026-08-04')
  })

  it('says unknown rather than inventing a commit', () => {
    expect(describeBuild({ sha: 'unknown', shortSha: 'unknown', builtAt: 'unknown', repository: 'example/simplemark' })).toBe(
      'Build unknown — compiled from a source tree with no git metadata',
    )
    expect(describeBuild(undefined)).toBe('Build unknown — this shell reported no provenance')
  })

  it('drops an unreadable date instead of printing a broken one', () => {
    expect(describeBuild({ sha: REAL, shortSha: '7670ea4', builtAt: 'unknown', repository: 'example/simplemark' })).toBe(
      'Commit 7670ea4',
    )
  })

  it('puts the commit in the macOS build-number slot', () => {
    // Renders as `Version 0.1.0 (7670ea4)`. The marketing version has been
    // 0.1.0 for every build ever made, so the parenthesised value is the only
    // part that can identify anything.
    expect(buildNumber({ sha: REAL, shortSha: '7670ea4', builtAt: '2026-08-04T10:05:49Z', repository: 'example/simplemark' })).toBe(
      '7670ea4',
    )
    expect(buildNumber({ sha: 'unknown', shortSha: 'unknown', builtAt: 'unknown', repository: 'example/simplemark' })).toBe('unknown')
    expect(buildNumber(undefined)).toBe('unknown')
  })

  it('recognises a commit only when it is really one', () => {
    expect(isCommit(REAL)).toBe(true)
    expect(isCommit('7670ea4')).toBe(false)
    expect(isCommit('unknown')).toBe(false)
    expect(isCommit('')).toBe(false)
  })

  it('compares identity and refuses to guess at ancestry', () => {
    const provenance = { sha: REAL, shortSha: '7670ea4', builtAt: '2026-08-04T10:05:49Z', repository: 'example/simplemark' }
    expect(isBuiltFrom(provenance, REAL)).toBe(true)
    expect(isBuiltFrom(provenance, REAL.toUpperCase())).toBe(true)
    expect(isBuiltFrom(provenance, 'f5f7d84ee9430934051ab82830ad7e506fa7c3ca')).toBe(false)
    // An unknown build matches nothing, including another unknown.
    expect(isBuiltFrom({ sha: 'unknown', shortSha: 'unknown', builtAt: 'unknown', repository: 'example/simplemark' }, REAL)).toBe(false)
    expect(isBuiltFrom(undefined, REAL)).toBe(false)
  })

  it('reads the native payload and degrades to unknown on a malformed one', () => {
    expect(
      readProvenance({
        sha: REAL,
        short_sha: '7670ea4',
        built_at: '2026-08-04T10:05:49Z',
        repository: 'example/simplemark',
      }),
    ).toEqual({
      sha: REAL,
      shortSha: '7670ea4',
      builtAt: '2026-08-04T10:05:49Z',
      repository: 'example/simplemark',
    })
    expect(readProvenance({})).toEqual({
      sha: 'unknown',
      shortSha: 'unknown',
      builtAt: 'unknown',
      repository: 'unknown',
    })
    expect(readProvenance(null)).toBeUndefined()
    expect(readProvenance('nope')).toBeUndefined()
  })

  it('only calls a repository real when it has the owner/name shape', () => {
    // The update check builds a URL from this. `unknown` must not become a
    // request for `https://api.github.com/repos/unknown/compare/…`.
    expect(isRepository('example/simplemark')).toBe(true)
    expect(isRepository('6th-element-labs/simple.mark')).toBe(true)
    expect(isRepository('unknown')).toBe(false)
    expect(isRepository('')).toBe(false)
    expect(isRepository('no-slash')).toBe(false)
    expect(isRepository('too/many/parts')).toBe(false)
    expect(isRepository('spaces here/name')).toBe(false)
  })
})
