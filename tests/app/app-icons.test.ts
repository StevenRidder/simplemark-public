import { describe, expect, test } from 'vitest'

import {
  APP_ICON_CHOICES,
  APP_ICON_IDS,
  normaliseAppIconId,
} from '../../src/app/app-icons.js'

describe('app icon catalog', () => {
  test('offers the seven approved choices in Settings order', () => {
    expect(APP_ICON_IDS).toEqual([
      'original',
      'live-layers',
      'movable-blocks',
      'blue-trio',
      'electric-blocks',
      'midnight',
      'blue-page',
    ])
    expect(APP_ICON_CHOICES.map(({ label }) => label)).toEqual([
      'Original',
      'Live Layers',
      'Movable Blocks',
      'Blue Trio',
      'Electric + Black',
      'Midnight',
      'Blue Page',
    ])
  })

  test('accepts a known native choice and repairs unknown persisted values', () => {
    expect(normaliseAppIconId('midnight')).toBe('midnight')
    expect(normaliseAppIconId('something-from-a-future-build')).toBe('original')
    expect(normaliseAppIconId(null)).toBe('original')
  })
})
