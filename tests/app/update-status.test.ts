import { describe, expect, it } from 'vitest'

import { describeUpdate, detailUpdate, readComparison, updateStatus } from '../../src/app/update-status.js'
import type { RemoteComparison } from '../../src/app/update-status.js'
import type { BuildProvenance } from '../../src/app/build-provenance.js'

/**
 * The rule these all serve: the bar's absence is a claim, so nothing may
 * resolve to `current` unless the app actually knows it is current.
 */

const BUILD: BuildProvenance = {
  sha: '61bc1577c757a4dc846dba6836d0bd0758192e0a',
  shortSha: '61bc157',
  builtAt: '2026-08-04T02:52:18Z',
  repository: 'example/simplemark',
}
const NEWER = 'da2c689f1b4e7a3c5d8f9021ab34cd56ef7890ab'

const compare = (over: Partial<RemoteComparison> = {}): RemoteComparison => ({
  status: 'behind',
  latestSha: NEWER,
  behindBy: 3,
  ...over,
})

describe('update status', () => {
  it('offers an update when the build trails main', () => {
    const status = updateStatus(BUILD, compare())
    expect(status).toEqual({
      state: 'behind',
      latestSha: NEWER,
      latestShortSha: 'da2c689',
      behindBy: 3,
    })
  })

  it('says nothing when the build is the newest commit', () => {
    expect(updateStatus(BUILD, compare({ status: 'identical', behindBy: 0 }))).toEqual({
      state: 'current',
    })
  })

  it('does not nag a branch build that is ahead of main', () => {
    // The normal state of a development machine. Treating it as an update
    // would make the bar something to ignore.
    expect(updateStatus(BUILD, compare({ status: 'ahead', behindBy: 0 }))).toEqual({
      state: 'current',
    })
  })

  it('offers the newer work when a branch build has diverged', () => {
    const status = updateStatus(BUILD, compare({ status: 'diverged', behindBy: 2 }))
    expect(status.state).toBe('behind')
  })

  it('never reports current when the check did not complete', () => {
    // The whole point: a failed request is not evidence of being up to date.
    const status = updateStatus(BUILD, null, 'No network')
    expect(status).toEqual({ state: 'unknown', reason: 'No network' })
  })

  it('cannot measure a build that never recorded its commit', () => {
    const anonymous: BuildProvenance = {
      sha: 'unknown',
      shortSha: 'unknown',
      builtAt: 'unknown',
      repository: 'unknown',
    }
    expect(updateStatus(anonymous, compare()).state).toBe('unknown')
    expect(updateStatus(undefined, compare()).state).toBe('unknown')
  })

  it('treats a zero-commit gap as current whatever the remote called it', () => {
    expect(updateStatus(BUILD, compare({ status: 'behind', behindBy: 0 })).state).toBe('current')
  })
})

describe('reading the remote comparison', () => {
  it('accepts a well-formed payload', () => {
    expect(readComparison({ status: 'behind', latestSha: NEWER, behindBy: 4 })).toEqual({
      status: 'behind',
      latestSha: NEWER,
      behindBy: 4,
    })
  })

  it.each([
    ['not an object', 'nonsense'],
    ['null', null],
    ['an unknown status', { status: 'sideways', latestSha: NEWER, behindBy: 1 }],
    ['a missing sha', { status: 'behind', behindBy: 1 }],
    ['a sha that is not a commit', { status: 'behind', latestSha: 'HEAD', behindBy: 1 }],
    ['a non-numeric distance', { status: 'behind', latestSha: NEWER, behindBy: 'three' }],
    ['a negative distance', { status: 'behind', latestSha: NEWER, behindBy: -1 }],
    ['an infinite distance', { status: 'behind', latestSha: NEWER, behindBy: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, payload) => {
    expect(readComparison(payload)).toBeNull()
  })

  it('becomes unknown rather than a plausible-looking update', () => {
    // A malformed body must not produce a confident `behind` with nonsense in
    // it — the rejection above is only useful if this is what it leads to.
    expect(updateStatus(BUILD, readComparison({ status: 'behind' })).state).toBe('unknown')
  })
})

describe('the strip’s label', () => {
  it('is empty when current, so the strip renders nothing at all', () => {
    expect(describeUpdate({ state: 'current' })).toBe('')
    expect(detailUpdate({ state: 'current' })).toBe('')
  })

  it('stays one short line whatever the commit count', () => {
    // The library column is narrow and resizable. A label carrying the count
    // wraps at the default width and changes height as the count changes.
    const one = describeUpdate(updateStatus(BUILD, compare({ behindBy: 1 })))
    const many = describeUpdate(updateStatus(BUILD, compare({ behindBy: 148 })))
    expect(one).toBe('Update ready')
    expect(many).toBe(one)
  })

  it('puts the count and the target commit in the detail', () => {
    expect(detailUpdate(updateStatus(BUILD, compare({ behindBy: 1 })))).toBe(
      '1 commit behind — update to da2c689',
    )
    expect(detailUpdate(updateStatus(BUILD, compare({ behindBy: 9 })))).toBe(
      '9 commits behind — update to da2c689',
    )
  })

  it('names a failed check as a failed check, never as an update', () => {
    const label = describeUpdate({ state: 'unknown', reason: 'No network' })
    expect(label).toBe('Could not check')
    expect(label).not.toContain('Update ready')
    expect(detailUpdate({ state: 'unknown', reason: 'No network' })).toBe('No network')
  })
})
