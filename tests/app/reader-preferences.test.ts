import { describe, expect, test } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  FONT_FAMILIES,
  INDENTATIONS,
  LINE_HEIGHTS,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  PARAGRAPH_SPACINGS,
  READER_THEMES,
  READING_WIDTHS,
  nextScale,
  normalisePreferences,
  normaliseScale,
  preferenceVariables,
  scaleBy,
} from '../../src/app/reader-preferences.js'

/**
 * D6: "font family, size, line height, line width, and theme are preferences."
 * Document-level, never per selection, because per-selection typography cannot
 * be expressed in Markdown.
 *
 * Pure rules only — clamping, defaults, and validating whatever was persisted.
 * Reading and writing storage is the shell's job.
 */

describe('reader preferences', () => {
  test('defaults to plain paper with the serif body', () => {
    // White, not the wireframe's tan: a first run should look like the document
    // rather than like a filter over it. Everything else is still §10.4 —
    // serif body, no zoom, the approved column and rhythm.
    expect(DEFAULT_PREFERENCES.theme).toBe('white')
    expect(DEFAULT_PREFERENCES.family).toBe('serif')
    expect(DEFAULT_PREFERENCES.scale).toBe(1)
    expect(DEFAULT_PREFERENCES.width).toBe('normal')
    expect(DEFAULT_PREFERENCES.leading).toBe('normal')
    expect(DEFAULT_PREFERENCES.spacing).toBe('normal')
    expect(DEFAULT_PREFERENCES.indent).toBe('none')
  })

  test('offers the three reader backgrounds by their product names', () => {
    expect(READER_THEMES).toEqual(['white', 'tan', 'night'])
  })

  test('offers a curated set of faces, not a system font dump', () => {
    // §6: "a curated set of text faces rather than a system font dump."
    expect(FONT_FAMILIES.length).toBeGreaterThan(1)
    expect(FONT_FAMILIES.length).toBeLessThanOrEqual(6)
    expect(FONT_FAMILIES.map((f) => f.id)).toContain('serif')
  })

  test('every layout preference is a small curated step set, never a slider', () => {
    for (const steps of [READING_WIDTHS, LINE_HEIGHTS, PARAGRAPH_SPACINGS]) {
      expect(steps.length).toBeGreaterThanOrEqual(2)
      expect(steps.length).toBeLessThanOrEqual(5)
    }
    expect(INDENTATIONS).toEqual(['none', 'first-line'])
  })
})

describe('nextScale', () => {
  test('steps up and down through the allowed sizes', () => {
    expect(nextScale(1, 'up')).toBeGreaterThan(1)
    expect(nextScale(1, 'down')).toBeLessThan(1)
  })

  test('keeps moving through a browser-like 25%-500% range', () => {
    let smaller = 1
    let larger = 1
    for (let step = 0; step < 40; step += 1) {
      smaller = nextScale(smaller, 'down')
      larger = nextScale(larger, 'up')
    }
    expect(smaller).toBe(MIN_TEXT_SCALE)
    expect(larger).toBe(MAX_TEXT_SCALE)
  })

  test('clamps at both safety limits rather than making the page disappear', () => {
    expect(nextScale(MIN_TEXT_SCALE, 'down')).toBe(MIN_TEXT_SCALE)
    expect(nextScale(MAX_TEXT_SCALE, 'up')).toBe(MAX_TEXT_SCALE)
  })

  test('moves from any valid persisted or pinched scale', () => {
    expect(nextScale(1.234, 'up')).toBeGreaterThan(1.234)
    expect(nextScale(1.234, 'down')).toBeLessThan(1.234)
  })

  test('applies continuous pinch ratios through the same limits', () => {
    expect(scaleBy(1, 1.35)).toBe(1.35)
    expect(scaleBy(1, 0.7)).toBe(0.7)
    expect(scaleBy(4, 2)).toBe(MAX_TEXT_SCALE)
    expect(normaliseScale(0)).toBe(MIN_TEXT_SCALE)
  })
})

describe('normalisePreferences', () => {
  test('accepts a well-formed stored value', () => {
    const stored = {
      theme: 'night',
      family: 'mono',
      scale: MIN_TEXT_SCALE,
      width: 'wide',
      leading: 'tight',
      spacing: 'airy',
      indent: 'first-line',
    }
    expect(normalisePreferences(stored)).toEqual(stored)
  })

  test('maps the pre-EDITOR-3 `black` theme onto `night`', () => {
    // The dark background was renamed, not removed. A person who chose it
    // before the rename must not wake up on warm paper.
    expect(normalisePreferences({ theme: 'black' }).theme).toBe('night')
  })

  test('fills fields a pre-EDITOR-3 record does not have', () => {
    // Adding a preference in a release must never wipe existing choices.
    const legacy = { theme: 'white', family: 'mono', scale: MIN_TEXT_SCALE }
    expect(normalisePreferences(legacy)).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'white',
      family: 'mono',
      scale: MIN_TEXT_SCALE,
    })
  })

  // Persisted preferences are untrusted input: a stale build, a hand-edited
  // localStorage, or a future version can all produce nonsense. Falling back to
  // defaults beats rendering an unreadable page.
  test.each([
    ['null', null],
    ['a string', 'tan'],
  ])('falls back to defaults wholesale for %s', (_label, value) => {
    expect(normalisePreferences(value)).toEqual(DEFAULT_PREFERENCES)
  })

  test.each([
    ['an unknown theme', { theme: 'neon' }],
    ['an unknown family', { family: 'comic' }],
    ['an unknown width', { width: 'sprawling' }],
    ['an unknown leading', { leading: 3 }],
    ['an unknown spacing', { spacing: 'huge' }],
    ['an unknown indentation', { indent: true }],
  ])('repairs %s to its default without touching the rest', (_label, corrupt) => {
    const rest = { theme: 'white', family: 'mono' }
    const repaired = normalisePreferences({ ...rest, ...corrupt })
    const corruptKey = Object.keys(corrupt)[0] as keyof typeof DEFAULT_PREFERENCES
    expect(repaired[corruptKey]).toEqual(DEFAULT_PREFERENCES[corruptKey])
  })

  test('clamps stored zoom to the browser-like safety range', () => {
    expect(normalisePreferences({ scale: 99 }).scale).toBe(MAX_TEXT_SCALE)
    expect(normalisePreferences({ scale: 0 }).scale).toBe(MIN_TEXT_SCALE)
  })
})

describe('preferenceVariables', () => {
  test('resolves every layout preference to a CSS custom property', () => {
    const variables = preferenceVariables({
      ...DEFAULT_PREFERENCES,
      width: 'wide',
      leading: 'open',
      spacing: 'compact',
      indent: 'first-line',
    })
    expect(variables['--reader-width']).toBe('860px')
    expect(variables['--reader-leading']).toBe('1.9')
    expect(variables['--reader-para-space']).toBe('12px')
    expect(variables['--reader-indent']).not.toBe('0')
  })

  test('the defaults reproduce the approved wireframe values exactly', () => {
    const variables = preferenceVariables(DEFAULT_PREFERENCES)
    expect(variables['--reader-width']).toBe('680px')
    expect(variables['--reader-leading']).toBe('1.68')
    expect(variables['--reader-para-space']).toBe('21px')
    expect(variables['--reader-indent']).toBe('0')
  })
})
