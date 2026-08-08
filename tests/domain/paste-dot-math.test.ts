import { describe, expect, it } from 'vitest'

import { looksLikeDot, looksLikeMath, stripMathDelimiters } from '../../src/domain/index.js'

/**
 * DESIGN.md §4.2 signatures for Graphviz DOT and LaTeX math. Same contract as
 * every other sniffer: a cheap filter, never a guarantee — the adapter parses
 * before anything converts.
 */

describe('looksLikeDot', () => {
  it('claims a directed graph', () => {
    expect(looksLikeDot('digraph G {\n  a -> b\n}')).toBe(true)
  })
  it('claims an undirected graph', () => {
    expect(looksLikeDot('graph {\n  a -- b\n}')).toBe(true)
  })
  it('claims a strict graph', () => {
    expect(looksLikeDot('strict digraph {\n  a -> b\n}')).toBe(true)
  })
  it('claims a named graph with quotes', () => {
    expect(looksLikeDot('digraph "my graph" {\n  a -> b\n}')).toBe(true)
  })

  it('declines Mermaid, whose "graph" keyword has no brace', () => {
    expect(looksLikeDot('graph LR\n  A --> B')).toBe(false)
  })
  it('declines prose beginning with the word graph', () => {
    expect(looksLikeDot('graph theory is a branch of mathematics')).toBe(false)
  })
  it('declines a graph without a closing brace', () => {
    expect(looksLikeDot('digraph G {\n  a -> b')).toBe(false)
  })
})

describe('looksLikeMath', () => {
  it('claims a $$ display block', () => {
    expect(looksLikeMath('$$E = mc^2$$')).toBe(true)
  })
  it('claims a multi-line $$ block', () => {
    expect(looksLikeMath('$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$')).toBe(true)
  })
  it('claims a bare LaTeX environment', () => {
    expect(looksLikeMath('\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}')).toBe(true)
  })

  it('declines a lone dollar amount', () => {
    expect(looksLikeMath('$100')).toBe(false)
  })
  it('declines two prices in a sentence — not a display block', () => {
    expect(looksLikeMath('It costs $100 and the other is $250 today.')).toBe(false)
  })
  it('declines inline single-dollar math — that is not a standalone block', () => {
    expect(looksLikeMath('the value $x^2$ appears inline')).toBe(false)
  })
  it('declines prose', () => {
    expect(looksLikeMath('align the columns and begin the work')).toBe(false)
  })
})

describe('stripMathDelimiters', () => {
  it('removes surrounding $$ and trims', () => {
    expect(stripMathDelimiters('$$ E = mc^2 $$')).toBe('E = mc^2')
  })
  it('removes multi-line $$ fencing', () => {
    expect(stripMathDelimiters('$$\n\\frac{a}{b}\n$$')).toBe('\\frac{a}{b}')
  })
  it('leaves a bare environment untouched', () => {
    expect(stripMathDelimiters('\\begin{align}a\\end{align}')).toBe('\\begin{align}a\\end{align}')
  })
})
