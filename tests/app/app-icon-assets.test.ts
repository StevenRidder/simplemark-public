import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const ICON_IDS = [
  'original',
  'live-layers',
  'movable-blocks',
  'blue-trio',
  'electric-blocks',
  'midnight',
  'blue-page',
] as const

const alternate = (path: string): string =>
  resolve(process.cwd(), 'src-tauri', 'icons', 'alternates', path)

describe('alternate app icon assets', () => {
  test('ships a vector master and generated PNG for every offered icon', () => {
    for (const id of ICON_IDS) {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg, `${id} must stay fully vector`).not.toMatch(/<image\b|data:image|<text\b/i)
      expect(statSync(alternate(`png/${id}.png`)).size, `${id} PNG must not be empty`)
        .toBeGreaterThan(0)
    }
  })

  test.each(['live-layers', 'blue-trio', 'electric-blocks', 'blue-page'])(
    '%s uses the approved pure-white tile instead of warm white',
    (id) => {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg).toContain('data-tile-background="#FFFFFF"')
    },
  )

  test('uses the approved Live Layers palette for both blue block treatments', () => {
    const trio = readFileSync(alternate('blue-trio.svg'), 'utf8')
    const electric = readFileSync(alternate('electric-blocks.svg'), 'utf8')

    expect(trio).toContain('data-block-palette="royal-sky-cyan"')
    expect(electric).toContain('data-block-palette="royal-charcoal-charcoal"')
  })

  test('centres the Live Layers MDown mark on its front panel', () => {
    const svg = readFileSync(alternate('live-layers.svg'), 'utf8')

    expect(svg).toContain('data-mark-offset-x="-24"')
    expect(svg).toContain('transform="translate(-24 0)"')
  })
})
