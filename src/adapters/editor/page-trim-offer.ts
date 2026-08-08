import { closeHistory } from '@milkdown/kit/prose/history'
import { DOMParser as ProseDOMParser, type Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

import type { NoteImageStore } from '../../application/index.js'
import { captureRemoteImages, remoteImageSources } from './image-capture.js'
import { extractArticleHtml } from './page-trim.js'

/**
 * DESIGN.md §4.2: a pasted web page keeps its faithful shape, and trimming is
 * offered rather than done.
 *
 * This is the first implementation of the §4.3 ruling that an affordance
 * appears in the corner after an insertion. It deliberately does not expire:
 * "a few seconds" fits a two-word choice, not one that needs the article read
 * first. Ignoring it costs nothing — the faithful paste is already there.
 *
 * The offer's range is remapped through every transaction and dropped when it
 * no longer maps, the pattern `folding.ts` uses for positions it does not own.
 * Mapped positions alone cannot tell "the pasted block moved" apart from "the
 * pasted block was replaced" — a whole-range replacement maps `from`/`to` to
 * a still-valid span, just one that now holds the user's new content instead
 * of the page. So `apply` also walks each step's own map to find whether a
 * step's modified span reaches into the tracked range's interior at all —
 * but a step touching the interior is not by itself grounds to drop the
 * offer. `syncHeadingIdPlugin` (commonmark preset) rewrites a pasted
 * heading's `id` attribute via `setNodeMarkup` the instant the paste lands,
 * and `image-capture.ts` rewrites a pasted image's `src` to a local copy
 * shortly after — both produce a step spanning content inside the tracked
 * range without changing a single character of it. Dropping the offer on
 * either would mean it never survives an ordinary pasted article. So when a
 * step does touch the interior, `apply` compares the range's *text* before
 * and after: unchanged text is attribute-only housekeeping and the offer
 * survives (remapped); changed text is the user actually replacing what was
 * pasted, and the offer drops. This governs every call: the offer may never
 * survive to replace content the user wrote after the paste, but it also
 * must not vanish over a rewrite that touched no text of its own.
 */

interface TrimOffer {
  readonly from: number
  readonly to: number
  readonly html: string
}

/** `id` distinguishes two offers that land on the same range — dismiss one,
 * raise another at an identical `from`/`to` (a re-paste, an undo/redo), and
 * without it the widget decoration key below could be reused for the new
 * offer, keeping the old one's DOM node and its stale `accept` closure. */
interface TrimOfferInternal extends TrimOffer {
  readonly id: number
}

type TrimOfferState = TrimOfferInternal | null

export const pageTrimOfferKey = new PluginKey<TrimOfferState>('simplemark-page-trim-offer')

interface TrimOfferMeta {
  readonly show?: TrimOffer
  readonly dismiss?: true
}

/** Marks a paste transaction as one worth offering to trim. */
export function offerPageTrim(tr: Transaction, offer: TrimOffer): Transaction {
  return tr.setMeta(pageTrimOfferKey, { show: offer } satisfies TrimOfferMeta)
}

function dismiss(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(pageTrimOfferKey, { dismiss: true } satisfies TrimOfferMeta).setMeta('addToHistory', false),
  )
}

/**
 * Replaces the pasted range with the trimmed article, in one undoable step.
 *
 * `closeHistory` stops prosemirror-history grouping it with the paste, so one
 * ⌘Z restores the faithful, untrimmed paste and a second clears it entirely
 * (§4.3).
 *
 * Reads the offer out of plugin state at click time rather than trusting a
 * closure captured when the widget was built. ProseMirror owns the decision
 * to reuse or rebuild a widget's DOM node — the decoration key below (offer
 * `id` plus `from`) deliberately changes whenever the offer moves, so reuse
 * across a mapping-only update rarely happens, but key hygiene is not what
 * correctness rests on. A listener closed over the range at build time would
 * fire with those original, since-moved coordinates whenever a node *is*
 * reused. Re-reading state here means the captured value is never the thing
 * acted on, so a stale closure can't matter regardless of what ProseMirror
 * does with the DOM.
 */
function accept(view: EditorView, images: NoteImageStore | undefined): void {
  const offer = pageTrimOfferKey.getState(view.state)
  if (offer === null || offer === undefined) return

  try {
    const trimmed = extractArticleHtml(offer.html)
    if (trimmed === null) {
      dismiss(view)
      return
    }
    const dom = new window.DOMParser().parseFromString(trimmed, 'text/html')
    const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(dom.body)
    applyPageTrim(view, images, slice)
  } catch {
    // A parse that throws must not eat the paste: leave it exactly as it is.
    dismiss(view)
  }
}

/**
 * The DOM-free half of accepting a trim: replaces the offered range with the
 * already-parsed `slice` in one undoable step, then re-issues image capture
 * for the remote sources that slice carries. Split from `accept` so this
 * state logic is testable in the `node` vitest environment, where `accept`'s
 * `DOMParser` work cannot run.
 */
export function applyPageTrim(
  view: EditorView,
  images: NoteImageStore | undefined,
  slice: Slice,
): void {
  const offer = pageTrimOfferKey.getState(view.state)
  if (offer === null || offer === undefined) return

  // Backstop only: `apply`'s structural guard already drops the offer the
  // instant a step touches this range's interior, so `offer` here should
  // always be within bounds. This clamp stays so a future gap in that
  // guard fails safe — a shortened range — rather than throwing.
  const from = Math.min(offer.from, view.state.doc.content.size)
  const to = Math.min(offer.to, view.state.doc.content.size)
  const tr = view.state.tr
    .replaceRange(from, to, slice)
    .setMeta(pageTrimOfferKey, { dismiss: true } satisfies TrimOfferMeta)
    .scrollIntoView()
  view.dispatch(closeHistory(tr))

  // The replacement was rebuilt from the RAW clipboard HTML, so its images
  // carry their original remote sources again — including any the paste-time
  // capture had already pointed at local copies. Without this re-issue, a
  // Trim clicked after a download finished would permanently revert that
  // image to its remote URL, which the packaged app's content policy then
  // refuses to load. Same contract as the paste site (ADR-0008):
  // fire-and-forget, never rejects, rewrites land outside undo history, and
  // a repeat download dedups to the existing file by content hash on the
  // Rust side. No store composed (the browser shell) → remote URLs stay,
  // exactly as pasted.
  if (images === undefined) return
  const sources = remoteImageSources(slice.content)
  if (sources.length > 0) void captureRemoteImages(view, images, sources)
}

function offerBar(view: EditorView, images: NoteImageStore | undefined): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'page-trim-offer'
  bar.contentEditable = 'false'

  const label = document.createElement('span')
  label.className = 'page-trim-offer-label'
  label.textContent = 'Pasted a full page — trim page chrome?'

  const trim = document.createElement('button')
  trim.type = 'button'
  trim.className = 'page-trim-offer-accept'
  trim.textContent = 'Trim'
  trim.addEventListener('mousedown', (event) => event.preventDefault())
  trim.addEventListener('click', (event) => {
    event.preventDefault()
    // No offer captured here on purpose — `accept` re-reads current plugin
    // state instead. See its docstring.
    accept(view, images)
  })

  const later = document.createElement('button')
  later.type = 'button'
  later.className = 'page-trim-offer-dismiss'
  later.textContent = 'Dismiss'
  later.addEventListener('mousedown', (event) => event.preventDefault())
  later.addEventListener('click', (event) => {
    event.preventDefault()
    dismiss(view)
  })

  bar.append(label, trim, later)
  return bar
}

/**
 * `images` is the bound note-image store, absent in hosts that cannot keep
 * images beside the note (the browser shell). With it, an accepted trim
 * re-captures the remote images its replacement content reintroduces; without
 * it the trimmed content keeps its remote URLs, exactly as the paste did.
 */
export function pageTrimOfferPlugin(images?: NoteImageStore): Plugin {
  // Monotonic, scoped to this plugin instance: every offer shown gets an id
  // no earlier or later offer on this editor can share, however the ranges
  // line up. See `TrimOfferInternal`.
  let nextOfferId = 0

  return new Plugin<TrimOfferState>({
    key: pageTrimOfferKey,
    state: {
      init: () => null,
      apply: (tr, value, oldState, newState) => {
        const meta = tr.getMeta(pageTrimOfferKey) as TrimOfferMeta | undefined
        if (meta?.dismiss === true) return null
        if (meta?.show !== undefined) {
          nextOfferId += 1
          return { ...meta.show, id: nextOfferId }
        }
        if (value === null) return null

        // Structural pass: walk each step's own map and check whether its
        // modified span reaches into the *current* tracked range's interior
        // — using the range as of just before that step, not the final
        // mapped numbers, since a later step could reshuffle positions
        // again. This only decides whether the semantic check below runs;
        // it does not by itself drop the offer (see that check for why).
        let from = value.from
        let to = value.to
        let touched = false
        for (const map of tr.mapping.maps) {
          map.forEach((oldStart, oldEnd) => {
            if (oldStart < to && oldEnd > from) touched = true
          })
          // Insertions land outside the tracked range: `from` biases forward
          // (assoc 1) past anything inserted exactly at the start, `to`
          // biases backward (assoc -1) short of anything inserted exactly at
          // the end. Otherwise text typed the instant after a paste — the
          // cursor sits at `to` — would be pulled inside the range and lost
          // if Trim were clicked before the offer was dismissed.
          from = map.map(from, 1)
          to = map.map(to, -1)
        }

        if (touched) {
          // Semantic check: a step touching the interior is not by itself
          // proof the user changed anything — compare the range's text
          // before and after. `setNodeMarkup` (heading-id sync) and an
          // image-src rewrite both produce a step whose span sits inside
          // `[from, to)` while rewriting only an attribute; `textBetween`
          // sees no difference because atoms like images contribute no text
          // and attribute changes aren't text at all. Selecting the pasted
          // block and typing over it does change this text, almost always
          // to something entirely different — dropped.
          //
          // Deliberately not widened for mark-only edits (bold/italic/etc.
          // on pasted text): AddMarkStep/RemoveMarkStep also touch no text,
          // so the offer survives one the same way it survives an attribute
          // rewrite. A later Trim would then discard that formatting along
          // with the rest of the pasted range — accepted, because what it
          // discards is still the pasted material, not something the user
          // wrote, and it is one ⌘Z away like any other accepted trim.
          const before = oldState.doc.textBetween(value.from, value.to, '\n', '\n')
          const after = newState.doc.textBetween(from, to, '\n', '\n')
          if (before !== after) return null
        }

        // The pasted range is gone — undone, deleted, or collapsed to nothing.
        return to <= from ? null : { ...value, from, to }
      },
    },
    props: {
      decorations: (state) => {
        const offer = pageTrimOfferKey.getState(state)
        if (offer === null || offer === undefined) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.widget(offer.from, (view) => offerBar(view, images), {
            side: -1,
            // Keyed by offer identity *and* position: `id` keeps two
            // different offers from ever sharing a key (dismiss one, raise
            // another at the same spot — no stale DOM reuse across offers).
            // `from` on top of that means a mapping-only update — the same
            // offer, just moved because of an edit elsewhere — gets a fresh
            // key too, so the widget is rebuilt rather than reused whenever
            // its position changes. That is hygiene, not the correctness
            // fix: `accept` re-reading state at click time is what actually
            // makes a reused/stale node harmless (see its docstring); this
            // key just means reuse rarely happens in the first place.
            key: `page-trim-offer-${offer.id}-${offer.from}`,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        ])
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape') return false
        const offer = pageTrimOfferKey.getState(view.state)
        if (offer === null || offer === undefined) return false
        dismiss(view)
        return true
      },
    },
  })
}
