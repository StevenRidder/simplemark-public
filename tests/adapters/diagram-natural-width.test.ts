import { describe, expect, it } from 'vitest'

import { naturalWidth } from '../../src/adapters/editor/diagram-node-view.js'

/**
 * The unit, not the number.
 *
 * `naturalWidth` is compared against a container's `clientWidth` and written
 * back as a pixel length, so an answer in the wrong unit does not fail — it
 * quietly scales every decision built on it. Reading the viewBox alone made
 * Graphviz cross the "too wide" line a third too early and then draw at
 * three-quarters of its intended size, because 445pt is 593px. Mermaid and
 * Vega both speak px, which is exactly why browser testing missed it.
 */

/** A stand-in for the one method the function uses; no DOM required. */
const svg = (attrs: Record<string, string>): SVGElement =>
  ({ getAttribute: (name: string) => attrs[name] ?? null }) as unknown as SVGElement

describe('naturalWidth', () => {
  it('converts the absolute units a renderer may emit', () => {
    // Graphviz: the case that was wrong.
    expect(naturalWidth(svg({ width: '445pt', viewBox: '0 0 445 170' }))).toBeCloseTo(593.33, 1)
    expect(naturalWidth(svg({ width: '96px' }))).toBe(96)
    expect(naturalWidth(svg({ width: '1in' }))).toBe(96)
    expect(naturalWidth(svg({ width: '2.54cm' }))).toBeCloseTo(96, 5)
    expect(naturalWidth(svg({ width: '1pc' }))).toBe(16)
  })

  it('treats a bare number as pixels, the way SVG does', () => {
    expect(naturalWidth(svg({ width: '88', viewBox: '0 0 88 345' }))).toBe(88)
  })

  it('falls back to the viewBox when the width describes the container', () => {
    // Mermaid writes `width="100%"`, which says nothing about the drawing.
    expect(naturalWidth(svg({ width: '100%', viewBox: '0 0 567.49 70' }))).toBeCloseTo(567.49, 2)
  })

  it('prefers an absolute width over the viewBox when they disagree', () => {
    // Not interchangeable: the viewBox is user units, the attribute is a length.
    expect(naturalWidth(svg({ width: '300pt', viewBox: '0 0 300 100' }))).toBeCloseTo(400, 5)
  })

  it('has no answer rather than a wrong one', () => {
    expect(naturalWidth(svg({}))).toBeUndefined()
    expect(naturalWidth(svg({ width: 'auto' }))).toBeUndefined()
    expect(naturalWidth(svg({ width: '0', viewBox: '0 0 0 0' }))).toBeUndefined()
    expect(naturalWidth(svg({ width: '10furlongs' }))).toBeUndefined()
    // A viewBox that cannot be parsed must not become NaN downstream.
    expect(naturalWidth(svg({ viewBox: 'nonsense' }))).toBeUndefined()
  })
})
