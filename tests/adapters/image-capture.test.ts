import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'

import { captureRemoteImages, remoteImageSources } from '../../src/adapters/editor/image-capture.js'

/**
 * The rewrite finds its image by `src`, not by a remembered position: a
 * download that lands after the person has typed, reordered blocks or accepted
 * a trim must still find the picture it fetched, and one whose picture is gone
 * must do nothing at all.
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    image: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: (node) => ['img', node.attrs],
    },
    text: { group: 'inline' },
  },
})

function documentWith(...sources: string[]) {
  const images = sources.map((src) => schema.nodes['image']!.create({ src, alt: 'a' }))
  return schema.nodes['doc']!.create(null, schema.nodes['paragraph']!.create(null, images))
}

/** A minimal stand-in for the parts of EditorView this module touches. */
function viewFor(doc: ReturnType<typeof documentWith>) {
  let state = EditorState.create({ schema, doc })
  return {
    get state() {
      return state
    },
    dispatch(tr: ReturnType<typeof state.tr.setMeta>) {
      state = state.apply(tr as never)
    },
    historyFlags: [] as unknown[],
  }
}

function sourcesIn(view: ReturnType<typeof viewFor>): string[] {
  const found: string[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'image') found.push(String(node.attrs['src']))
    return true
  })
  return found
}

describe('remoteImageSources', () => {
  it('collects each remote source once, ignoring local ones', () => {
    const doc = documentWith(
      'https://example.com/a.png',
      'https://example.com/a.png',
      'assets/b.png',
      'data:image/png;base64,AAAA',
    )
    expect(remoteImageSources(doc.content)).toEqual(['https://example.com/a.png'])
  })
})

describe('captureRemoteImages', () => {
  it('rewrites every node carrying the source it downloaded', async () => {
    const view = viewFor(documentWith('https://example.com/a.png', 'https://example.com/a.png'))
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/a.png'])

    expect(sourcesIn(view)).toEqual(['assets/hash.png', 'assets/hash.png'])
  })

  it('keeps the remote url when the store declines', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = { store: async () => null, read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/a.png'])

    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })

  it('keeps the remote url when the store throws', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = {
      store: async () => {
        throw new Error('offline')
      },
      read: async () => null,
    }

    await expect(
      captureRemoteImages(view as never, store, ['https://example.com/a.png']),
    ).resolves.toBeUndefined()
    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })

  it('does nothing when the image is gone by the time the download lands', async () => {
    const view = viewFor(documentWith('assets/already-local.png'))
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/gone.png'])

    expect(sourcesIn(view)).toEqual(['assets/already-local.png'])
  })

  it('keeps the queue moving when a worker throws mid-run, resolving with every success rewritten and every failure untouched', async () => {
    // More sources than MAX_CONCURRENT_DOWNLOADS (4) so several items remain
    // queued behind the first batch of workers, and some of those workers
    // throw. A try/catch that only guarded the first iteration, or a bug that
    // let one throw abort the shared queue, would strand the remaining items
    // and this test would see fewer than 9 images in the final document.
    const sources = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.png`)
    const view = viewFor(documentWith(...sources))
    const store = {
      store: async (url: string) => {
        const index = Number(url.match(/\/(\d)\.png$/)?.[1])
        if (index % 2 === 0) throw new Error(`offline: ${url}`)
        return { src: `assets/${index}.png` }
      },
      read: async () => null,
    }

    await expect(captureRemoteImages(view as never, store, sources)).resolves.toBeUndefined()

    const result = sourcesIn(view)
    for (let i = 0; i < 9; i++) {
      if (i % 2 === 0) {
        expect(result).toContain(`https://example.com/${i}.png`)
      } else {
        expect(result).toContain(`assets/${i}.png`)
      }
    }
    expect(result).toHaveLength(9)
  })

  it('rewrites outside undo history so one undo lands on the faithful paste', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const seen: unknown[] = []
    const recording = {
      get state() {
        return view.state
      },
      dispatch(tr: { getMeta(key: string): unknown }) {
        seen.push(tr.getMeta('addToHistory'))
        view.dispatch(tr as never)
      },
    }
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(recording as never, store, ['https://example.com/a.png'])

    expect(seen).toEqual([false])
  })
})
