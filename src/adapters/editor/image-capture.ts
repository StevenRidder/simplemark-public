/**
 * Rewrites a freshly pasted article's remote image sources to local copies
 * once the download completes. Governed by the DESIGN.md §4.2 ruling-table
 * row for remote images (docs/DESIGN.md:211 — "outside undo history") and by
 * ADR-0008 decision 5, which requires a failed download to change nothing and
 * leave the reference exactly as it arrived.
 *
 * A pasted web article lands faithfully and synchronously, remote image URLs
 * intact. The download that follows is a network round-trip later, by which
 * time the person may have typed, reordered blocks, or accepted a "trim page
 * chrome" offer. So the rewrite finds its target by matching the `src` VALUE
 * still present in the current document, never by a position remembered from
 * paste time — a position a later edit could have moved or destroyed.
 *
 * The rewrite is a system edit, not a user edit: every transaction it
 * dispatches carries `addToHistory: false` so one ⌘Z restores the raw pasted
 * content instead of walking back through image rewrites one at a time
 * (DESIGN.md §4.2). And it never rejects or drops the paste: a store that
 * declines or throws simply leaves the remote URL exactly as it arrived —
 * visible and unchanged, not lost (ADR-0008 decision 5; DESIGN.md §4.4's
 * "never lose the source" is the general principle this specific rule serves).
 */
import type { Fragment } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { NoteImageStore } from '../../application/index.js'
import { isRemoteImageSource } from '../../domain/index.js'

/** Enough parallelism for a picture-heavy article, few enough to stay polite. */
const MAX_CONCURRENT_DOWNLOADS = 4

/** Every distinct remote image source in freshly pasted content. */
export function remoteImageSources(fragment: Fragment): string[] {
  const found = new Set<string>()
  fragment.descendants((node) => {
    if (node.type.name === 'image') {
      const src = String(node.attrs['src'] ?? '')
      if (isRemoteImageSource(src)) found.add(src)
    }
    return true
  })
  return [...found]
}

/**
 * Points every node that carries `from` at `to`, in one transaction, outside
 * undo history (DESIGN.md §4.2, docs/DESIGN.md:211).
 *
 * By source rather than by position: the download lands a network round-trip
 * after the paste, by which time the person may have typed, reordered blocks,
 * or accepted a trim. `find.ts` records the same reasoning for recomputing
 * rather than remapping — an edit can destroy a target, not just move it.
 *
 * The rewrite is not a user edit, so `addToHistory: false` keeps ⌘Z landing on
 * the faithful paste instead of walking back through one image at a time.
 */
function rewriteSource(view: EditorView, from: string, to: string): void {
  const positions: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && String(node.attrs['src'] ?? '') === from) positions.push(pos)
    return true
  })
  if (positions.length === 0) return

  const tr = view.state.tr
  for (const pos of positions) {
    const node = view.state.doc.nodeAt(pos)
    if (node === null) continue
    // setNodeMarkup replaces the node rather than patching its attrs in
    // place, but a leaf node's nodeSize does not depend on its attributes —
    // so the replacement is still same-size, and earlier positions in this
    // list remain valid for the later ones in the same transaction.
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to })
  }
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

/**
 * Downloads each pasted remote image and points the document at the local copy.
 *
 * Never rejects and never reports a failure into the document: an image that
 * could not be stored keeps the remote URL it arrived with, which is visible
 * and unchanged rather than lost (ADR-0008 decision 5; DESIGN.md §4.4).
 */
export async function captureRemoteImages(
  view: EditorView,
  store: NoteImageStore,
  sources: readonly string[],
): Promise<void> {
  const queue = [...sources]
  const worker = async (): Promise<void> => {
    for (;;) {
      const source = queue.shift()
      if (source === undefined) return
      try {
        const stored = await store.store(source)
        if (stored !== null) rewriteSource(view, source, stored.src)
      } catch {
        // Keep the remote URL.
      }
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, queue.length) }, worker)
  await Promise.all(workers)
}
