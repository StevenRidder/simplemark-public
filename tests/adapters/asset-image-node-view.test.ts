import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssetImageNodeView } from '../../src/adapters/editor/asset-image-node-view.js'

/**
 * There is no working relative-image path in the packaged app: its policy
 * admits `'self' data: blob: asset:` and nothing registers `asset:`. So a
 * note-relative reference renders by reading bytes through the port and
 * showing them as a `blob:` URL. Everything else keeps today's behaviour.
 */
function fakeElement(tag: string) {
  let ownText = ''
  const element: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    children: [] as unknown[],
    className: '',
    hidden: false,
    style: {},
    classList: { toggle: () => {} },
    setAttribute(name: string, value: string) {
      element[name] = value
    },
    getAttribute(name: string) {
      return element[name] ?? null
    },
    addEventListener: () => {},
    append(...nodes: unknown[]) {
      ;(element['children'] as unknown[]).push(...nodes)
    },
    querySelector(selector: string) {
      const wanted = selector.toLowerCase()
      const walk = (node: Record<string, unknown>): unknown => {
        for (const child of (node['children'] as Record<string, unknown>[]) ?? []) {
          if (String(child['tagName']).toLowerCase() === wanted) return child
          const found = walk(child)
          if (found !== undefined) return found
        }
        return undefined
      }
      return walk(element) ?? null
    },
  }
  // Real DOM `textContent` is a getter that concatenates descendant text
  // rather than a plain field, which matters here: the assertions read it
  // off `nodeView.dom` (the outer span) while the implementation only ever
  // assigns it on the nested fallback span. A flat string property would
  // never see that write.
  Object.defineProperty(element, 'textContent', {
    get() {
      const children = element['children'] as Record<string, unknown>[]
      if (children.length === 0) return ownText
      return children.map((child) => String(child['textContent'] ?? '')).join('')
    },
    set(value: unknown) {
      ownText = String(value)
      ;(element['children'] as unknown[]).length = 0
    },
  })
  return element
}

function nodeWith(src: string) {
  return { type: { name: 'image' }, attrs: { src, alt: 'alt text' } } as never
}
const view = { state: { tr: {} }, dispatch: () => {} } as never

describe('AssetImageNodeView', () => {
  // Re-stubbed before every test: a couple of tests below call
  // `vi.unstubAllGlobals()` to drop their own `URL` stub, which would
  // otherwise also drop this one and break whichever test runs next.
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: (tag: string) => fakeElement(tag) })
  })


  it('assigns a remote source directly, without touching the store', () => {
    const store = { store: vi.fn(), read: vi.fn() }
    const nodeView = new AssetImageNodeView(nodeWith('https://example.com/a.png'), view, () => 0, store)
    expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
    expect(store.read).not.toHaveBeenCalled()
  })

  it('assigns a relative source directly when no store is composed', () => {
    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0)
    expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('assets/a.png')
  })

  it('renders a relative source through the store as a blob url', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:stub'
      },
      revokeObjectURL: () => {},
    })
    const store = {
      store: vi.fn(),
      read: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })),
    }

    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0, store)
    await vi.waitFor(() => expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('blob:stub'))

    expect(store.read).toHaveBeenCalledWith('assets/a.png')
    expect(created[0]?.type).toBe('image/png')
    vi.unstubAllGlobals()
  })

  it('falls back to the plain reference when the store has no bytes, so the miss stays visible', async () => {
    const store = { store: vi.fn(), read: vi.fn(async () => null) }
    const nodeView = new AssetImageNodeView(nodeWith('assets/missing.png'), view, () => 0, store)
    await vi.waitFor(() =>
      expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('assets/missing.png'),
    )
    expect(nodeView.dom.textContent).toContain('File unavailable: assets/missing.png')
  })

  it('revokes the blob url it created when the node view is destroyed', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: (url: string) => revoked.push(url),
    })
    const store = {
      store: vi.fn(),
      read: vi.fn(async () => ({ bytes: new Uint8Array([1]), mediaType: 'image/png' })),
    }

    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0, store)
    await vi.waitFor(() => expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('blob:stub'))
    nodeView.destroy?.()

    expect(revoked).toEqual(['blob:stub'])
    vi.unstubAllGlobals()
  })
})
