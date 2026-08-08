import { describe, expect, test } from 'vitest'

import {
  MERMAID_SIGNATURE,
  isStandaloneBlockPaste,
  looksLikeMermaid,
  looksLikeSvg,
  svgInHtml,
} from '../../src/domain/index.js'

/**
 * The DESIGN.md §4.2 ruling table, as executable rules.
 *
 * These are the deterministic, pure half of the paste pipeline: signature
 * matching and the standalone-block test. Parsing and sanitisation are the
 * adapters' job — a sniffer only converts when *all four* conditions hold, and
 * these cover conditions 1 and 2.
 */

describe('the standalone-block test (§4.2 condition 1)', () => {
  test('accepts a paste that is the whole clipboard payload at a block boundary', () => {
    expect(
      isStandaloneBlockPaste({ text: 'flowchart TB\n  A --> B', atBlockBoundary: true }),
    ).toBe(true)
  })

  // "Pasting into the middle of a sentence never converts — it inserts text."
  test('refuses when the caret is inside a block', () => {
    expect(
      isStandaloneBlockPaste({ text: 'flowchart TB\n  A --> B', atBlockBoundary: false }),
    ).toBe(false)
  })

  test('refuses an empty or whitespace-only payload', () => {
    expect(isStandaloneBlockPaste({ text: '   \n  ', atBlockBoundary: true })).toBe(false)
  })
})

describe('the Mermaid signature (§4.2 condition 2)', () => {
  test.each([
    'flowchart TB',
    'graph LR',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'stateDiagram-v2',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'gitGraph',
    'mindmap',
    'timeline',
    'quadrantChart',
  ])('claims %s', (keyword) => {
    expect(looksLikeMermaid(`${keyword}\n  A --> B`)).toBe(true)
  })

  test('ignores leading blank lines and indentation before the keyword', () => {
    expect(looksLikeMermaid('\n\n   flowchart TB\n  A --> B')).toBe(true)
  })

  // "Prose beginning with the word 'graph'" — the signature is the cheap filter;
  // mermaid.parse() in the adapter is what actually rejects this.
  test('does not claim a word that merely starts with a keyword', () => {
    expect(looksLikeMermaid('graphics are hard to get right')).toBe(false)
    expect(looksLikeMermaid('pierced the abstraction')).toBe(false)
  })

  test('does not claim ordinary prose', () => {
    expect(looksLikeMermaid('The fence is the important one.')).toBe(false)
  })

  test('exposes the signature so the adapter and the docs cannot drift apart', () => {
    expect(MERMAID_SIGNATURE.test('flowchart TB')).toBe(true)
  })
})

describe('the SVG signature (§4.2 condition 2)', () => {
  test('claims a document whose root element is <svg>', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBe(true)
  })

  test('tolerates an XML prolog and leading whitespace', () => {
    expect(looksLikeSvg('<?xml version="1.0"?>\n  <svg viewBox="0 0 1 1"></svg>')).toBe(true)
  })

  // An <svg> buried inside a larger HTML document is the svg-in-html case, not
  // this one — priority order decides, not a looser signature here.
  test('does not claim markup whose root is not svg', () => {
    expect(looksLikeSvg('<div><svg></svg></div>')).toBe(false)
    expect(looksLikeSvg('plain prose')).toBe(false)
  })
})

describe('svg-in-html (§4.2, priority 30)', () => {
  // "Clipboard has text/html wrapping an <svg> → svg-in-html claims it.
  //  HTML path is not consulted."
  test('extracts the svg from an HTML clipboard flavour', () => {
    const html = '<meta charset="utf-8"><div><svg viewBox="0 0 4 4"><rect/></svg></div>'
    expect(svgInHtml(html)).toBe('<svg viewBox="0 0 4 4"><rect/></svg>')
  })

  test('returns null when the HTML carries no svg', () => {
    expect(svgInHtml('<p>just prose</p>')).toBeNull()
    expect(svgInHtml('')).toBeNull()
  })
})
