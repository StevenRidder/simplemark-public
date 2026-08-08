import { describe, expect, it } from 'vitest'

import { TextCardRenderer } from '../../src/adapters/renderers/text-card-renderer.js'

/**
 * SGR coverage for the ANSI card.
 *
 * The first implementation handled only the 16-colour codes and read any other
 * parameter as a standalone SGR code. That was not merely incomplete: for
 * `38;2;R;G;B` it consumed the `2` as *dim* and dropped the colour, so real CI
 * output rendered with actively wrong styling. These cases pin the extended
 * forms that cargo, pytest, npm and most modern tools actually emit.
 */

const ESC = String.fromCharCode(27)
const renderer = new TextCardRenderer()

async function markup(source: string): Promise<string> {
  const result = await renderer.render('ansi', source)
  if (!result.ok) throw new Error(result.message)
  return result.markup
}

describe('16-colour and styles', () => {
  // The 16 base colours resolve to theme variables, not fixed hex: a terminal
  // green must stay legible on both the light and dark reader grounds
  // (RENDERERS.md contract rule 3). Indices 16+ and truecolor are absolute and
  // are emitted verbatim, because there fidelity to what the tool emitted wins.
  it('colours a standard foreground through the theme', async () => {
    expect(await markup(`${ESC}[32mgreen${ESC}[0m`)).toContain('var(--ansi-2)')
  })
  it('colours a bright foreground through the theme', async () => {
    expect(await markup(`${ESC}[92mbright${ESC}[0m`)).toContain('var(--ansi-10)')
  })
  it('colours a standard background through the theme', async () => {
    expect(await markup(`${ESC}[41mred bg${ESC}[0m`)).toContain('background:var(--ansi-1)')
  })
  it('carries bold, dim, italic, underline and strikethrough', async () => {
    expect(await markup(`${ESC}[1mb${ESC}[0m`)).toContain('font-weight:bold')
    expect(await markup(`${ESC}[2md${ESC}[0m`)).toContain('opacity:')
    expect(await markup(`${ESC}[3mi${ESC}[0m`)).toContain('font-style:italic')
    expect(await markup(`${ESC}[4mu${ESC}[0m`)).toContain('underline')
    expect(await markup(`${ESC}[9ms${ESC}[0m`)).toContain('line-through')
  })
})

describe('256-colour (38;5;N)', () => {
  it('resolves a standard index to the same theme variable', async () => {
    expect(await markup(`${ESC}[38;5;2mgreen${ESC}[0m`)).toContain('var(--ansi-2)')
  })
  it('resolves a bright index to the same theme variable', async () => {
    expect(await markup(`${ESC}[38;5;9mred${ESC}[0m`)).toContain('var(--ansi-9)')
  })
  it('resolves the 6x6x6 colour cube', async () => {
    // 208 -> idx 192 -> r=5 g=2 b=0 -> #ff8700
    expect(await markup(`${ESC}[38;5;208morange${ESC}[0m`)).toContain('color:#ff8700')
  })
  it('resolves the greyscale ramp', async () => {
    // 244 -> 8 + 12*10 = 128 -> #808080
    expect(await markup(`${ESC}[38;5;244mgrey${ESC}[0m`)).toContain('color:#808080')
  })
  it('resolves a 256-colour background', async () => {
    expect(await markup(`${ESC}[48;5;22mbg${ESC}[0m`)).toContain('background:#005f00')
  })
})

describe('truecolor (38;2;R;G;B)', () => {
  it('resolves an exact rgb foreground', async () => {
    expect(await markup(`${ESC}[38;2;255;99;71mtomato${ESC}[0m`)).toContain('color:#ff6347')
  })
  it('resolves an exact rgb background', async () => {
    expect(await markup(`${ESC}[48;2;0;0;255mblue bg${ESC}[0m`)).toContain('background:#0000ff')
  })
  it('does not mistake the colour parameters for style codes', async () => {
    // The original bug: `2` read as dim, `255;99;71` dropped entirely.
    const out = await markup(`${ESC}[38;2;255;99;71mtomato${ESC}[0m`)
    expect(out).not.toContain('opacity:')
    expect(out).toContain('tomato')
  })
})

describe('safety and structure', () => {
  it('escapes markup in the payload', async () => {
    expect(await markup(`${ESC}[32m<script>alert(1)</script>${ESC}[0m`)).not.toContain('<script>')
  })
  it('resets state on 0 and closes every span', async () => {
    const out = await markup(`${ESC}[31mred${ESC}[0mplain`)
    expect(out.split('<span').length - 1).toBe(out.split('</span>').length - 1)
    expect(out).toContain('plain')
  })
  it('drops non-SGR escapes rather than printing them', async () => {
    const out = await markup(`${ESC}[2Jcleared${ESC}[1;1Hhome`)
    expect(out).toContain('cleared')
    expect(out).not.toContain('[2J')
  })
  it('leaves plain text untouched', async () => {
    expect(await markup('no escapes here')).toContain('no escapes here')
  })
})
