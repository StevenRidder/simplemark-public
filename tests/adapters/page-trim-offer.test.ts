import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import type { Transaction } from '@milkdown/kit/prose/state'
import { describe, expect, it, vi } from 'vitest'

import {
  applyPageTrim,
  offerPageTrim,
  pageTrimOfferKey,
  pageTrimOfferPlugin,
} from '../../src/adapters/editor/page-trim-offer.js'

/**
 * Accepting a trim rebuilds the replacement from the RAW clipboard HTML, so
 * its image sources are the original remote URLs again — including any the
 * paste-time capture had already rewritten to local copies. The 12 Playwright
 * tests structurally cannot catch a regression here: the browser shell
 * composes no image store, so no download ever happens there. This suite
 * drives the DOM-free half of the accept path (`applyPageTrim`) with a fake
 * `NoteImageStore` and asserts the trim re-issues capture for exactly the
 * remote sources present in the trimmed content.
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

/** The slice `accept` would have parsed out of the raw clipboard HTML. */
function trimmedSlice(...sources: string[]): Slice {
  const images = sources.map((src) => schema.nodes['image']!.create({ src, alt: 'a' }))
  return new Slice(Fragment.from(schema.nodes['paragraph']!.create(null, images)), 0, 0)
}

/** A minimal stand-in for the parts of EditorView this module touches, with
 * the real plugin composed so `applyPageTrim` reads genuine offer state. */
function viewFor(doc: ReturnType<typeof documentWith>) {
  let state = EditorState.create({ schema, doc, plugins: [pageTrimOfferPlugin()] })
  const historyFlags: unknown[] = []
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      historyFlags.push(tr.getMeta('addToHistory'))
      state = state.apply(tr)
    },
    historyFlags,
  }
  // Raise an offer over the whole document, as a full-page paste would.
  view.dispatch(
    offerPageTrim(state.tr, { from: 0, to: state.doc.content.size, html: '<html>raw</html>' }),
  )
  return view
}

function sourcesIn(view: ReturnType<typeof viewFor>): string[] {
  const found: string[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'image') found.push(String(node.attrs['src']))
    return true
  })
  return found
}

function recordingStore() {
  const stored: string[] = []
  return {
    stored,
    store: async (url: string) => {
      stored.push(url)
      const name = url.split('/').pop() ?? 'image.png'
      return { src: `assets/${name}` }
    },
    read: async () => null,
  }
}

describe('applyPageTrim', () => {
  it('re-issues capture for the remote sources the trimmed content reintroduces', async () => {
    // Mid-capture state: the fast image already downloaded and was rewritten
    // to a local copy; the slow one is still remote. Trimming replaces both
    // with the raw clipboard's remote URLs — capture must run again or the
    // fast image stays remote forever.
    const view = viewFor(documentWith('assets/fast.png', 'https://example.com/slow.png'))
    const store = recordingStore()

    applyPageTrim(
      view as never,
      store,
      trimmedSlice('https://example.com/fast.png', 'https://example.com/slow.png'),
    )

    // The replacement itself is synchronous and dismisses the offer.
    expect(sourcesIn(view)).toEqual(['https://example.com/fast.png', 'https://example.com/slow.png'])
    expect(pageTrimOfferKey.getState(view.state)).toBeNull()

    await vi.waitFor(() => {
      expect([...store.stored].sort()).toEqual([
        'https://example.com/fast.png',
        'https://example.com/slow.png',
      ])
      expect(sourcesIn(view)).toEqual(['assets/fast.png', 'assets/slow.png'])
    })
  })

  it('keeps the trim one undoable step, with the capture rewrites outside history', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = recordingStore()

    applyPageTrim(view as never, store, trimmedSlice('https://example.com/a.png'))
    await vi.waitFor(() => expect(sourcesIn(view)).toEqual(['assets/a.png']))

    // Dispatches: the offer, the one replacement transaction (history-
    // eligible), then only `addToHistory: false` rewrites.
    expect(view.historyFlags.slice(0, 2)).toEqual([undefined, undefined])
    expect(view.historyFlags.length).toBeGreaterThan(2)
    expect(view.historyFlags.slice(2)).toEqual(view.historyFlags.slice(2).map(() => false))
  })

  it('leaves remote URLs exactly as pasted when no store is composed', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))

    applyPageTrim(view as never, undefined, trimmedSlice('https://example.com/a.png'))

    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
    expect(pageTrimOfferKey.getState(view.state)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })

  it('issues no capture when the trimmed content carries no remote sources', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = recordingStore()

    applyPageTrim(view as never, store, trimmedSlice('assets/local.png', 'data:image/png;base64,AAAA'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.stored).toEqual([])
  })

  it('does nothing at all when no offer is live', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    view.dispatch(view.state.tr.setMeta(pageTrimOfferKey, { dismiss: true }))
    const dispatches = view.historyFlags.length
    const store = recordingStore()

    applyPageTrim(view as never, store, trimmedSlice('https://example.com/b.png'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.historyFlags.length).toBe(dispatches)
    expect(store.stored).toEqual([])
    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })
})
