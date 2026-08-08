import { describe, expect, it } from 'vitest'

import { tablerIcon, tablerIconPaths } from '../../src/app/ui/tabler-icons.js'

describe('local Tabler icon subset', () => {
  it('renders the official pin geometry as an offline current-color SVG', () => {
    expect(tablerIcon('pin')).toBe(
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5M14.5 4l5.5 5.5"/></svg>',
    )
  })

  it('keeps bottom-bar icons in the same Tabler 24px vocabulary', () => {
    for (const name of [
      'heading',
      'checkbox',
      'list',
      'bold',
      'italic',
      'highlight',
      'link',
      'table',
      'photo',
      'dots-vertical',
    ] as const) {
      expect(tablerIconPaths(name)).toContain('<path')
      expect(tablerIcon(name)).toMatch(/^<svg[^>]*viewBox="0 0 24 24"/)
    }
  })

  it('uses the official quiet x geometry for Close Note', () => {
    expect(tablerIconPaths('x')).toBe('<path d="M18 6l-12 12M6 6l12 12"/>')
  })
})
