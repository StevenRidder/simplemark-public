import { describe, expect, it } from 'vitest'

import {
  BrowserAssetReferencePort,
  normaliseRelativeAssetPath,
} from '../../src/adapters/filesystem/browser-asset-reference-port.js'

describe('normaliseRelativeAssetPath', () => {
  it('keeps an ordinary relative path and normalises Windows separators', () => {
    expect(normaliseRelativeAssetPath('assets\\architecture.png')).toBe('assets/architecture.png')
  })

  it.each(['/absolute.png', '../escape.png', 'C:\\secret.png', 'file:///secret.png', 'blob:temporary'])
  ('rejects a non-portable path: %s', (path) => {
    expect(normaliseRelativeAssetPath(path)).toBeNull()
  })
})

describe('BrowserAssetReferencePort', () => {
  it('creates a normal image reference and names the browser limitation', async () => {
    const answers = ['assets/architecture.png', 'Architecture diagram']
    const port = new BrowserAssetReferencePort(
      async () => new File(['image'], 'architecture.png', { type: 'image/png' }),
      { prompt: () => answers.shift() ?? null },
    )

    await expect(port.chooseReference()).resolves.toEqual({
      kind: 'image',
      src: 'assets/architecture.png',
      label: 'Architecture diagram',
      notice: 'Reference added — place assets/architecture.png beside this Markdown file to render or open it',
    })
  })

  it('creates an ordinary file link, not an attachment', async () => {
    const answers = ['assets/decision.pdf', 'Decision PDF']
    const port = new BrowserAssetReferencePort(
      async () => new File(['pdf'], 'decision.pdf', { type: 'application/pdf' }),
      { prompt: () => answers.shift() ?? null },
    )

    await expect(port.chooseReference()).resolves.toMatchObject({
      kind: 'file', src: 'assets/decision.pdf', label: 'Decision PDF',
    })
  })
})
