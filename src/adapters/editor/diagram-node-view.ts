import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Selection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { ClipboardPort, DiagramFixPort, DiagramRenderer, RenderedDiagram } from '../../application/index.js'
import { parseFenceLayout, withFenceMetaKey } from '../../domain/index.js'
import { openFigureViewer } from './figure-viewer.js'

/** CSS absolute lengths, in px. The relative ones cannot be resolved here. */
const CSS_UNITS: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

/**
 * The drawing's natural width **in CSS pixels**.
 *
 * The unit is the whole point: this gets compared against a container's
 * `clientWidth` and written back as a pixel length, so anything else silently
 * scales the answer. Graphviz reports `width="445pt"` — 593px, not 445 — so
 * reading the viewBox alone made its diagrams cross the "too wide" line a third
 * too early and then draw at three-quarters of their intended size. Mermaid and
 * Vega happen to speak px, which is what made that easy to miss.
 *
 * The `width` attribute wins when it carries an absolute length. A percentage
 * (Mermaid writes `width="100%"`) describes the container rather than the
 * drawing, so the viewBox answers instead — its user units are px by
 * construction once no other scaling applies.
 */
export function naturalWidth(svg: SVGElement): number | undefined {
  const attribute = svg.getAttribute('width')?.trim() ?? ''
  const match = /^([\d.]+)\s*([a-z]*)$/i.exec(attribute)
  if (match !== null) {
    const value = Number(match[1])
    const scale = CSS_UNITS[(match[2] ?? '').toLowerCase() || 'px']
    if (Number.isFinite(value) && value > 0 && scale !== undefined) return value * scale
  }

  const viewBox = svg.getAttribute('viewBox')
  if (viewBox !== null) {
    const width = Number(viewBox.split(/[\s,]+/)[2])
    if (Number.isFinite(width) && width > 0) return width
  }
  return undefined
}

/** One pasteable block: language, error, and source together (diagram-error Copy button). */
export function formatDiagramErrorForCopy(language: string, source: string, errorMessage: string): string {
  return `Diagram type: ${language}\nError: ${errorMessage}\n\nSource:\n\`\`\`${language}\n${source}\n\`\`\`\n`
}

/**
 * §6: zoom lives on generated renders only. Pasted SVGs resize instead.
 *
 * `graphviz` sits beside `dot` — `graphviz-renderer.ts`'s `languages: ['dot',
 * 'graphviz']` are the same renderer, and this set had only ever grown `dot`.
 * Final review, Minor 8: spec errata, fixed alongside the `kind()` rework
 * below since both read this set.
 */
const ZOOMABLE_LANGUAGES: ReadonlySet<string> = new Set(['mermaid', 'dot', 'graphviz', 'vega-lite'])

/**
 * True for every language this NodeView treats as "zoomable" (§6). Exported
 * so `MilkdownEditor#diagram.kind()` (milkdown-editor.ts) classifies through
 * this same set instead of keeping its own copy that can drift from it —
 * final review Finding 2.
 */
export function isZoomableLanguage(language: string): boolean {
  return ZOOMABLE_LANGUAGES.has(language)
}

/**
 * §2/§3 of the chip-chrome spec: "every diagram block" — svg plus every
 * zoomable generated language — gets the grip, the float segment, and the
 * context menu's float items. Math (and the paste-exhaust text cards that
 * happen to share this NodeView: ansi/diff/json/tree/stacktrace) fall
 * outside both sets and get neither, matching the minimal-chrome rule. One
 * predicate for all three call sites so they cannot drift onto different
 * sets, the same reasoning as `#floatRoomToWrap`.
 */
export function isDiagramLanguage(language: string): boolean {
  return language === 'svg' || isZoomableLanguage(language)
}

/**
 * Live NodeView handles, so view-state verbs (edit source, zoom) can reach
 * the instance that owns the sheet and the transient zoom — state that lives
 * only on the DOM/NodeView, never in the document `MilkdownEditor` can read
 * with a transaction. `MilkdownEditor` holds the registry; each NodeView
 * registers itself on construction and deregisters on `destroy()`.
 */
export interface DiagramViewRegistry {
  register(view: DiagramNodeView): void
  deregister(view: DiagramNodeView): void
}

/**
 * NodeView for a fenced code block whose language this renderer claims.
 *
 * The block renders as a picture and reveals its source on click — one frame,
 * shared by every extension-rendered block, so a future third-party block is
 * indistinguishable from a built-in (DESIGN.md §10.2).
 *
 * The source is a plain textarea, deliberately. DESIGN.md §4.5 makes CodeMirror
 * an optimisation only *after* the editing behaviour passes, not a prerequisite:
 * a nested editor brings its own selection, focus, and undo problems that
 * ProseMirror cannot infer.
 *
 * `stopEvent` and `ignoreMutation` are the load-bearing pair. Without them,
 * typing in the textarea churns the outer selection and ProseMirror tries to
 * reconcile DOM it does not own.
 */
export class DiagramNodeView implements NodeView {
  readonly dom: HTMLElement
  #node: ProseNode
  #showingSource = false
  /** Guards against an out-of-order async render overwriting a newer one. */
  #renderToken = 0
  /**
   * The diagram's own last render failure, kept separate from whatever text
   * `#errorMessage` happens to be showing. A transport/auth failure overwrites
   * that DOM element with its own message, and `#runFix` must not re-seed a
   * later retry's prompt from that stale API-error text.
   */
  #lastRenderError: string | undefined = undefined
  /** The block's own context menu, while it is open. */
  #menu: HTMLElement | undefined
  /** Transient reader state, like folding — never written to the document. */
  #zoom = 1
  /** Lives inside `#chips`; rebuilt with it, so this is `undefined` whenever the block is not selected. */
  #zoomLevel: HTMLButtonElement | undefined
  /**
   * §2 of the chip-chrome spec: the selection-triggered toolbar. Built in
   * `selectNode()`, torn down in `deselectNode()`/`destroy()` — it exists only
   * while the block is the current `NodeSelection`.
   */
  #chips: HTMLElement | undefined
  /**
   * Opens the figure full screen. Offered only on a figure too wide for its
   * column, because on one that already fits there is nothing to go and see.
   */
  #expand: HTMLButtonElement | undefined
  /** Closes an open viewer, so tearing down the block takes it along. */
  #closeViewer: (() => void) | undefined
  /** Present on every diagram block (§3) — absent on math, which offers no resize. */
  #grip: HTMLElement | undefined

  readonly #render: HTMLElement
  readonly #sheet: HTMLElement
  readonly #sheetHeader: HTMLElement
  readonly #textarea: HTMLTextAreaElement
  readonly #error: HTMLElement
  readonly #errorMessage: HTMLElement
  readonly #copyButton: HTMLButtonElement
  readonly #fixButton: HTMLButtonElement
  readonly #close: HTMLButtonElement

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: DiagramRenderer,
    /** Backs the diagram-error box's Copy button. Absent hides that button. */
    private readonly clipboard?: ClipboardPort,
    /** Backs the diagram-error box's Fix it button. Absent hides that button. */
    private readonly diagramFix?: DiagramFixPort,
    /**
     * Lets the `DiagramController` (milkdown-editor.ts) reach this instance's
     * view-state verbs. Optional so a caller with no such registry — a future
     * test, say — still constructs a working NodeView.
     */
    private readonly registry?: DiagramViewRegistry,
  ) {
    this.#node = node

    this.dom = document.createElement('figure')
    this.dom.className = 'diagram'

    const label = document.createElement('span')
    label.className = 'diagram-label'
    label.textContent = node.attrs['language'] ?? 'diagram'

    this.#render = document.createElement('div')
    this.#render.className = 'diagram-render'

    this.#sheet = document.createElement('section')
    this.#sheet.className = 'diagram-source-sheet'
    this.#sheet.hidden = true
    this.#sheet.setAttribute('aria-label', 'Diagram source editor')

    this.#sheetHeader = document.createElement('header')
    this.#sheetHeader.className = 'diagram-source-header'

    const sheetTitle = document.createElement('span')
    sheetTitle.className = 'diagram-source-title'
    sheetTitle.textContent = `${label.textContent} source`

    // The sheet is `position: fixed` on <body>, so once it is dragged — or the
    // block scrolls away — the figure's own Done button is no longer anywhere
    // near it. Without this the sheet has no visible way out at all.
    this.#close = document.createElement('button')
    this.#close.className = 'diagram-source-close'
    this.#close.type = 'button'
    this.#close.textContent = '✕'
    this.#close.title = 'Close (Esc)'
    this.#close.setAttribute('aria-label', 'Close source editor')
    this.#close.addEventListener('click', (event) => {
      event.preventDefault()
      this.#setShowingSource(false)
    })

    this.#sheetHeader.append(sheetTitle, this.#close)

    this.#textarea = document.createElement('textarea')
    this.#textarea.className = 'diagram-source'
    this.#textarea.spellcheck = false
    this.#textarea.value = node.textContent
    this.#textarea.addEventListener('input', () => this.#commitSource())

    this.#error = document.createElement('div')
    this.#error.className = 'diagram-error'
    this.#error.hidden = true

    const actions = document.createElement('div')
    actions.className = 'diagram-error-actions'

    this.#copyButton = document.createElement('button')
    this.#copyButton.type = 'button'
    this.#copyButton.className = 'diagram-error-copy'
    this.#copyButton.textContent = 'Copy'
    this.#copyButton.hidden = this.clipboard === undefined
    this.#copyButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#copyError()
    })

    this.#fixButton = document.createElement('button')
    this.#fixButton.type = 'button'
    this.#fixButton.className = 'diagram-error-fix'
    this.#fixButton.textContent = 'Fix it'
    this.#fixButton.hidden = this.diagramFix === undefined
    this.#fixButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#runFix()
    })

    this.#errorMessage = document.createElement('div')
    this.#errorMessage.className = 'diagram-error-message'

    actions.append(this.#copyButton, this.#fixButton)
    this.#error.append(actions, this.#errorMessage)

    this.#sheet.append(this.#sheetHeader, this.#textarea)
    document.body.append(this.#sheet)
    this.#expand = document.createElement('button')
    this.#expand.className = 'diagram-expand'
    this.#expand.type = 'button'
    this.#expand.textContent = 'Open figure'
    this.#expand.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.#openViewer()
    })

    this.dom.append(label, this.#expand, this.#render, this.#error)

    const language = (node.attrs['language'] as string | undefined) ?? ''
    if (isDiagramLanguage(language)) {
      this.#grip = document.createElement('div')
      this.#grip.className = 'diagram-resize-grip'
      this.#grip.setAttribute('aria-label', 'Resize chart')
      this.#grip.addEventListener('pointerdown', this.#beginResize)
      this.dom.append(this.#grip)
    }

    this.#applyFloat()

    // A click anywhere on the figure selects the block. The source sheet and
    // the chip toolbar are excluded — `stopEvent` already treats those as
    // ours, and selecting the block from them would fight the textarea or
    // double-handle a chip's own click (Delete, say, which has already torn
    // the block down by the time this bubbles up).
    this.dom.addEventListener('click', (event) => {
      if (this.#sheet.contains(event.target as Node)) return
      if (this.#chips?.contains(event.target as Node) === true) return
      if (this.#expand?.contains(event.target as Node) === true) return
      this.#selectBlock()
    })
    this.#render.addEventListener('scroll', this.#markScrollEnd, { passive: true })
    this.dom.addEventListener('contextmenu', this.#openMenu)
    this.#sheetHeader.addEventListener('pointerdown', this.#beginDrag)

    // A rendered diagram bakes its colours into the SVG, so it does not follow
    // the theme the way CSS does. Without this, switching the system appearance
    // leaves a light diagram stranded on dark paper.
    this.#scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
    this.#onSchemeChange = () => void this.#paint()
    this.#scheme?.addEventListener('change', this.#onSchemeChange)

    // Fit-or-scroll is a question about the column, not the diagram, so it has
    // to be answered again whenever the column changes: opening the sidebar,
    // resizing the window, changing text size. It also answers the first one —
    // the initial paint runs before layout, when there is no width to measure.
    this.#resize = new ResizeObserver(() => {
      this.#fitDiagram()
      this.#refreshNarrow()
    })
    this.#resize.observe(this.#render)

    void this.#paint()
    this.registry?.register(this)
  }

  readonly #scheme: MediaQueryList | undefined
  readonly #onSchemeChange: () => void
  readonly #resize: ResizeObserver

  /**
   * Document-scoped, and only while the sheet is open.
   *
   * This was bound to the textarea, so dragging the header moved focus off it
   * and Escape stopped working from that moment on — precisely when it matters
   * most, since a dragged sheet has left its figure's Done button behind.
   */
  readonly #onEscape = (event: KeyboardEvent): void => {
    if (!this.#showingSource || event.key !== 'Escape') return
    event.preventDefault()
    this.#setShowingSource(false)
  }

  /**
   * §2 of the chip-chrome spec: "Escape or clicking prose deselects; chrome
   * vanishes." Document-scoped and only while selected, same pattern as
   * `#onEscape` above — the click-to-deselect half is ProseMirror's own
   * default (any click on ordinary prose replaces the `NodeSelection`), so
   * this only has to cover the keyboard half.
   */
  readonly #onSelectionEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    this.#focusAfterBlock()
  }

  #setShowingSource(showing: boolean): void {
    this.#showingSource = showing
    this.#sheet.hidden = !showing
    if (showing) {
      document.addEventListener('keydown', this.#onEscape)
      this.#placeSheet()
      this.#textarea.focus()
      return
    }
    document.removeEventListener('keydown', this.#onEscape)
    this.#focusAfterBlock()
  }

  readonly #beginDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return
    // The close button lives in the drag handle; a press on it must close the
    // sheet, not start dragging it out from under the pointer.
    if (this.#close.contains(event.target as Node)) return
    event.preventDefault()
    const rect = this.#sheet.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    const move = (moveEvent: PointerEvent): void => {
      const next = this.#boundedSheetPosition(
        moveEvent.clientX - offsetX,
        moveEvent.clientY - offsetY,
      )
      this.#sheet.style.left = `${next.left}px`
      this.#sheet.style.top = `${next.top}px`
      this.#sheet.dataset['positioned'] = 'true'
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  #placeSheet(): void {
    if (this.#sheet.dataset['positioned'] === 'true') return
    const rect = this.#sheet.getBoundingClientRect()
    const next = this.#boundedSheetPosition((window.innerWidth - rect.width) / 2, 112)
    this.#sheet.style.left = `${next.left}px`
    this.#sheet.style.top = `${next.top}px`
    this.#sheet.dataset['positioned'] = 'true'
  }

  #boundedSheetPosition(left: number, top: number): { left: number; top: number } {
    const rect = this.#sheet.getBoundingClientRect()
    return {
      left: Math.max(12, Math.min(left, window.innerWidth - rect.width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - rect.height - 12)),
    }
  }

  #focusAfterBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const after = pos + this.#node.nodeSize
    const { state } = this.view
    this.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(after), 1)).scrollIntoView())
    this.view.focus()
  }

  /**
   * Puts a real selection on the block.
   *
   * Without it there was no way to remove a diagram at all: the NodeView has
   * no `contentDOM`, so a click landed outside the editor content and
   * Backspace had nothing to act on. A `NodeSelection` is the whole fix —
   * ProseMirror deletes one on Backspace and Delete with no keymap of ours.
   */
  readonly #selectBlock = (): boolean => {
    const pos = this.getPos()
    if (pos === undefined) return false
    const { state } = this.view
    if (state.doc.nodeAt(pos) === null) return false
    this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    this.view.focus()
    return true
  }

  /**
   * The column the figure sits in, measured float-proof.
   *
   * A floated figure is `width: fit-content`, so its own render box collapses
   * to the drawing and can't serve as "the column" (§4 resize clamp, §5 float
   * threshold). The parent block — the editor column — keeps the real measure.
   */
  #columnWidth(): number {
    return this.dom.parentElement?.clientWidth ?? this.#render.clientWidth
  }

  /**
   * §5: float is only offered while the rendered content leaves the prose
   * real room — wrapping a sliver of text beside a wide chart reads as a bug.
   * Shared by the context menu and the chip toolbar's float segment, so the
   * two thresholds cannot drift apart.
   *
   * Fix round 2, Finding 1: measured against the column (`#columnWidth()`),
   * not the figure's own render box — a floated figure is `width:
   * fit-content`, so once already floated, `#render.clientWidth` had
   * collapsed to ≈ the drawing's own width and this was never true again.
   * Float left/right read as permanently disabled the moment a chart floated
   * once.
   */
  #floatRoomToWrap(): boolean {
    const svg = this.#render.querySelector('svg')
    const effective = svg?.getBoundingClientRect().width ?? 0
    return effective > 0 && effective <= this.#columnWidth() * 0.6
  }

  /**
   * The block's own context menu.
   *
   * `.note-context-menu` is the sidebar's menu styling, reused so this looks
   * like the rest of the app rather than a second kind of menu. Both actions
   * already exist — this is an affordance for them, not new behaviour.
   */
  readonly #openMenu = (event: MouseEvent): void => {
    if (this.#sheet.contains(event.target as Node)) return
    event.preventDefault()
    if (!this.#selectBlock()) return
    this.#closeMenu()

    const menu = document.createElement('div')
    menu.className = 'note-context-menu diagram-context-menu'
    menu.style.left = `${event.clientX}px`
    menu.style.top = `${event.clientY}px`

    const item = (text: string, run: () => void): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'note-context-row'
      button.textContent = text
      button.addEventListener('click', () => {
        this.#closeMenu()
        run()
      })
      return button
    }

    menu.append(
      item('Edit source', () => this.#setShowingSource(true)),
      item('Delete', () => this.#deleteBlock()),
    )

    const language = (this.#node.attrs['language'] as string | undefined) ?? ''
    if (isDiagramLanguage(language)) {
      const separator = document.createElement('hr')
      const roomToWrap = this.#floatRoomToWrap()
      const floatItem = (text: string, value: string | null): HTMLButtonElement => {
        const button = item(text, () => this.#commitLayout('float', value))
        if (value !== null && !roomToWrap) button.disabled = true
        return button
      }
      menu.append(
        separator,
        floatItem('Float left', 'left'),
        floatItem('Float right', 'right'),
        floatItem('Inline', null),
      )
    }

    document.body.append(menu)
    this.#menu = menu

    // Any click or Escape outside dismisses it. Deferred by a tick so the
    // right-click that opened it does not immediately close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', this.#onOutsidePress)
      document.addEventListener('keydown', this.#onMenuEscape)
    }, 0)
  }

  readonly #closeMenu = (): void => {
    this.#menu?.remove()
    this.#menu = undefined
    document.removeEventListener('pointerdown', this.#onOutsidePress)
    document.removeEventListener('keydown', this.#onMenuEscape)
  }

  // A pointerdown on the menu's own buttons bubbles to document too, so
  // closing unconditionally there would remove the menu before its click ever
  // fires — Delete and Edit source would silently do nothing.
  readonly #onOutsidePress = (event: PointerEvent): void => {
    if (this.#menu?.contains(event.target as Node) === true) return
    this.#closeMenu()
  }

  readonly #onMenuEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#closeMenu()
  }

  /**
   * Selects the block, then removes it.
   *
   * `closeHistory` stops this delete from being folded into whatever the
   * user was just doing — e.g. the block's own conversion-from-paste — into
   * one merged undo step. `prosemirror-history` groups transactions inside
   * its `newGroupDelay` (500ms) by default, which a real reader's paste-then-
   * decide-to-delete rarely beats but a script (a test, an agent) routinely
   * does; deleting a block is a deliberate, distinct action and undoing it
   * must not also revert the paste that created it.
   */
  #deleteBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const node = state.doc.nodeAt(pos)
    if (node === null) return
    this.view.dispatch(closeHistory(state.tr.delete(pos, pos + node.nodeSize)))
    this.view.focus()
  }

  /** Writes text back through ProseMirror, never into the DOM. Does not repaint. */
  #writeSource(text: string): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const { state, dispatch } = this.view
    const from = pos + 1
    const to = pos + this.#node.nodeSize - 1

    const transaction = state.tr.replaceWith(
      from,
      to,
      text === '' ? [] : state.schema.text(text),
    )
    dispatch(transaction)
  }

  /** The textarea's own edit path: write, then repaint without waiting. */
  #commitSource(): void {
    this.#writeSource(this.#textarea.value)
    void this.#paint()
  }

  /**
   * §4: the drag writes width= into the fence meta on release — one
   * transaction, one undo step. Dragging to the column edge clears the key,
   * which reads as "back to natural".
   */
  readonly #beginResize = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const grip = this.#grip
    if (grip === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const svg = this.#render.querySelector('svg')
    if (svg === null) return
    const startWidth = svg.getBoundingClientRect().width
    const startX = event.clientX
    // Fix round 2, Finding 1: the column, not the figure's own render box —
    // on a floated figure (`width: fit-content`) `#render.clientWidth` had
    // collapsed to ≈ the drawing's own width, so a grow-drag clamped at the
    // current width and any rightward release landed in the edge-clear band
    // below, silently deleting the committed width= instead of growing it.
    const available = this.#columnWidth()

    const width = (moveEvent: PointerEvent): number =>
      Math.min(
        available,
        Math.max(DiagramNodeView.#MIN_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX))),
      )

    const move = (moveEvent: PointerEvent): void => {
      svg.style.width = `${width(moveEvent)}px`
    }
    const stop = (stopEvent: PointerEvent): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', stop)
      const final = width(stopEvent)
      this.#commitLayout('width', final >= available - 4 ? null : String(final))
    }
    // Fix round 1, Finding 2: capturing the pointer retargets its later
    // events straight to the grip, even past the viewport edge. Without
    // this, the listeners lived on `window` — a pointerup missed outside the
    // window (or firing after this NodeView is destroyed mid-drag) left them
    // stale, so a later unrelated pointerup could dispatch a bogus width=
    // transaction. Attaching to the grip instead of `window` also means the
    // listeners simply die with it.
    grip.setPointerCapture(event.pointerId)
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', stop, { once: true })
  }

  /**
   * Rewrites one layout key in the fence meta through the editor.
   *
   * `setNodeMarkup` replaces the node's opening/closing "tag" as a structural
   * step, so ProseMirror's default selection mapping reports the
   * `NodeSelection`'s anchor deleted and strands the caret after the block —
   * which would deselect the block, and with it the whole chip toolbar (§2:
   * chips exist only while selected), the instant a layout chip was clicked.
   * The node's size is unchanged, so `pos` is still valid in the
   * post-transaction doc and the same transaction can restore the selection
   * to it directly. Same bug, same fix, as `MilkdownEditor#layoutKey`.
   */
  #commitLayout(key: string, value: string | null): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const node = state.doc.nodeAt(pos)
    if (node === null) return
    const meta = withFenceMetaKey((node.attrs['meta'] as string | undefined) ?? '', key, value)
    const transaction = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, meta })
    this.view.dispatch(transaction.setSelection(NodeSelection.create(transaction.doc, pos)))
    this.view.focus()
  }

  /** float= drives layout classes; the stylesheet does the rest. */
  #applyFloat(): void {
    const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
    this.dom.classList.toggle('diagram--float-left', layout.float === 'left')
    this.dom.classList.toggle('diagram--float-right', layout.float === 'right')
  }

  /**
   * §2 of the chip-chrome spec: the selection-triggered toolbar. Built fresh
   * in `selectNode()`, torn down in `deselectNode()`/`destroy()` — it exists
   * only while the block is the current `NodeSelection`.
   *
   * Every action calls the same private methods `DiagramController`
   * (milkdown-editor.ts) reaches (`#setShowingSource`, `#setZoom`,
   * `#commitLayout`, `#deleteBlock`), so a chip click and an app-API call run
   * identical code and cannot drift apart.
   */
  #buildChips(): HTMLElement {
    const chips = document.createElement('div')
    chips.className = 'diagram-chips'
    const language = this.language()
    const zoomable = isZoomableLanguage(language)
    // §2's table: float is offered on every diagram block — svg and every
    // zoomable generated language — and withheld only from the minimal-chrome
    // set (math, and the paste-exhaust text cards: ansi/diff/json/tree/stacktrace).
    const floatable = isDiagramLanguage(language)

    const chip = (label: string, icon: string, run: () => void, extra?: string): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `diagram-chip${extra === undefined ? '' : ` ${extra}`}`
      button.setAttribute('aria-label', label)
      button.innerHTML = icon
      button.addEventListener('click', (event) => {
        event.preventDefault()
        run()
      })
      return button
    }

    chips.append(
      chip(
        'Edit source',
        '<span class="chip-glyph" aria-hidden="true">&lt;/&gt;</span><span class="chip-label">Edit source</span>',
        () => this.#setShowingSource(true),
      ),
    )

    if (zoomable) {
      chips.append(chip('Zoom out', '−', () => this.#setZoom(this.#zoom / DiagramNodeView.#ZOOM_STEP)))
      this.#zoomLevel = chip(
        'Reset zoom',
        `${Math.round(this.#zoom * 100)}%`,
        () => this.#setZoom(1),
        'diagram-zoom-level',
      )
      chips.append(this.#zoomLevel)
      chips.append(chip('Zoom in', '+', () => this.#setZoom(this.#zoom * DiagramNodeView.#ZOOM_STEP)))
    }

    if (floatable) {
      const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
      const roomToWrap = this.#floatRoomToWrap()
      const floatEntries: ReadonlyArray<readonly [string, string, 'left' | 'right' | null]> = [
        ['Float left', '⇤', 'left'],
        ['Inline', '▭', null],
        ['Float right', '⇥', 'right'],
      ]
      for (const [floatLabel, icon, value] of floatEntries) {
        const active = (layout.float ?? null) === value
        const button = chip(floatLabel, icon, () => this.#commitLayout('float', value), active ? 'is-active' : undefined)
        // Lets `#refreshChipState` find these again after a rebuild-free
        // `update()` without re-deriving each button's own meaning by index.
        button.dataset['floatValue'] = value ?? ''
        if (value !== null && !roomToWrap) button.disabled = true
        chips.append(button)
      }
    }

    chips.append(
      chip(
        'Delete diagram',
        '<span class="chip-glyph" aria-hidden="true">✕</span><span class="chip-label">Delete</span>',
        () => this.#deleteBlock(),
        'diagram-chip-danger',
      ),
    )

    // Task 4 §2: a chart already rendering under 420px (a small pasted svg,
    // say) starts collapsed rather than waiting for the next render or
    // resize to notice.
    chips.classList.toggle('is-narrow', this.#isNarrow())

    return chips
  }

  /**
   * Re-syncs the parts of `#chips` that can go stale without a full rebuild:
   * the active float segment and the zoom readout. Called from `#paint()`'s
   * two outcomes — an undo, an API call, another chip's own commit all flow
   * through `update()`, which always repaints — so a toolbar left standing
   * across one keeps agreeing with the document instead of showing whatever
   * was true when it was first built.
   *
   * Deliberately not called from `update()` itself: `#floatRoomToWrap()`
   * reads the rendered svg's own box, which `#paint()` has not redrawn yet
   * at that point (`void this.#paint()` is fire-and-forget) — a synchronous
   * call there was re-syncing the float segment's disabled state against
   * the *previous* render, one update behind, and never got another chance
   * to correct itself once the new render actually landed. Found via TDD: a
   * generated diagram resized narrow enough to float still reported its
   * chip Float button disabled.
   */
  #refreshChipState(): void {
    if (this.#chips === undefined) return
    if (this.#zoomLevel !== undefined) {
      this.#zoomLevel.textContent = `${Math.round(this.#zoom * 100)}%`
    }
    const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
    const active = layout.float ?? null
    const roomToWrap = this.#floatRoomToWrap()
    for (const button of this.#chips.querySelectorAll<HTMLButtonElement>('[data-float-value]')) {
      const raw = button.dataset['floatValue'] ?? ''
      const value: 'left' | 'right' | null = raw === '' ? null : (raw as 'left' | 'right')
      button.classList.toggle('is-active', active === value)
      button.disabled = value !== null && !roomToWrap
    }
  }

  /**
   * Task 4 §2: how small "too small to spare the words" means — measured
   * the same way `#floatRoomToWrap` measures room to wrap, the rendered
   * drawing's own box, not the figure's or `#render`'s (both stay
   * column-width whenever the block isn't floated, regardless of how
   * narrow the chart inside them actually renders). Falls back to the
   * render box for the non-svg text cards, which have no drawing of their
   * own to measure — those only go narrow with the reading column itself.
   */
  #isNarrow(): boolean {
    const svg = this.#render.querySelector('svg')
    const effective = svg?.getBoundingClientRect().width ?? this.#render.clientWidth
    return effective > 0 && effective < DiagramNodeView.#NARROW_BELOW
  }

  /**
   * Re-syncs `.diagram-chips`' `is-narrow` class against the current render.
   * Called from every path that can change the diagram's own rendered width
   * — the ResizeObserver (the column resizing), `#setZoom`, and `#paint`'s
   * two outcomes (a committed width, an undo, any other node update) — so a
   * toolbar left standing across one of those keeps agreeing with what's
   * actually on screen.
   */
  #refreshNarrow(): void {
    if (this.#chips === undefined) return
    this.#chips.classList.toggle('is-narrow', this.#isNarrow())
  }

  #setZoom(next: number): void {
    const clamped = Math.min(
      DiagramNodeView.#ZOOM_MAX,
      Math.max(DiagramNodeView.#ZOOM_MIN, next),
    )
    // Fix round 2, Finding 3: repeated in/out steps accumulate float error
    // (0.8 * 1.25 = 1.0000000000000002) — close enough to read "100%" but
    // never `=== 1`, so #fitDiagram's zoom branch stayed active forever.
    this.#zoom = Math.abs(clamped - 1) < 0.001 ? 1 : clamped
    if (this.#zoomLevel !== undefined) {
      this.#zoomLevel.textContent = `${Math.round(this.#zoom * 100)}%`
    }
    this.#fitDiagram()
    this.#refreshNarrow()
  }

  static readonly #ZOOM_STEP = 1.25
  static readonly #ZOOM_MIN = 0.5
  static readonly #ZOOM_MAX = 4
  /**
   * Mirrors `.diagram-render svg`'s `max-width: min(100%, 720px)`.
   *
   * The resting (zoom === 1) width defers to that CSS rule entirely, so it
   * never needs to know the number. An explicit zoom instead computes its own
   * inline width, which beats `max-width` once `is-wide` lifts the cap — so
   * the cap has to be duplicated here, or a zoomed diagram on a column wider
   * than 720px would visually jump on the very first zoom click instead of
   * scaling smoothly from what was already on screen. Keep the two in sync.
   */
  static readonly #FILL_CAP = 720

  /**
   * How much narrower than its natural width a diagram may be squeezed before
   * scrolling beats shrinking.
   *
   * Both engines size their text in absolute units, so scaling the SVG scales
   * the labels with it. A dense graph forced into the measure ends up with
   * unreadable type — the diagram is still "visible" and no longer says
   * anything. Past this ratio the figure keeps the diagram legible and scrolls
   * inside itself instead. The page must never scroll sideways to read a note.
   */
  static readonly #WIDEST_SQUEEZE = 1.6

  /** §4: the floor a drag (or a hand-typed `width=`) may shrink an svg block to. */
  static readonly #MIN_WIDTH = 120

  /** Task 4 §2: below this rendered width, chip labels collapse to icons. */
  static readonly #NARROW_BELOW = 420

  /**
   * Decides between filling the column and keeping natural size.
   *
   * Graphviz and Vega both emit a `viewBox`, which is what makes stretching
   * safe: the drawing scales rather than being cropped or letterboxed. The
   * default without this was `max-width: 100%`, which can only ever shrink — so
   * a small graph sat at its natural 445pt in a 660px column, surrounded by
   * air, and looked like a rendering bug rather than a diagram.
   */
  #fitDiagram(): void {
    const svg = this.#render.querySelector('svg')
    if (svg === null) return

    // Mermaid writes `style="max-width: 567px"` onto its own root, which is an
    // inline declaration and therefore beats the stylesheet outright. That cap
    // is the whole reason a Mermaid diagram never grew to meet its column, and
    // no amount of CSS below can answer it. Sizing belongs to one place, so the
    // renderer's opinion is removed rather than fought.
    svg.style.removeProperty('max-width')

    const available = this.#render.clientWidth
    const natural = naturalWidth(svg)
    // Before layout there is nothing to compare against. The ResizeObserver
    // below calls back the moment a width exists, so this returns rather than
    // guessing — the first paint almost always lands here.
    if (available === 0 || natural === undefined) return

    const language = (this.#node.attrs['language'] as string | undefined) ?? ''

    // §3 of the chip-chrome spec: width= means the same thing on any diagram
    // block now, not just svg — the fill base a generated diagram zooms from
    // becomes its committed width once one exists, floored the same way a
    // drag already floors it. Hoisted so both branches below (and the svg
    // tail further down) read one parse of the meta, not three.
    const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
    const base = layout.width !== undefined
      ? Math.max(layout.width, DiagramNodeView.#MIN_WIDTH)
      : Math.min(available, DiagramNodeView.#FILL_CAP)

    // An explicit zoom is the reader's own choice and wins over the
    // natural-width "wide" default below — a dense diagram that already
    // trips `#WIDEST_SQUEEZE` is exactly the one a reader reaches for zoom
    // on. Without this check first, the wide branch would return before
    // zoom ever ran: the readout would climb 100% -> 125% -> ... on every
    // click while the picture never moved, in either direction.
    //
    // `zoom === 1` skips this and falls through to today's wide/svg/fill
    // ruling unchanged. Zooming out can un-wide a diagram that was wide by
    // default; zooming in can push one wide that wasn't.
    if (this.#zoom !== 1 && isZoomableLanguage(language)) {
      // The base is the resting fill width — `metaWidth ?? min(available,
      // #FILL_CAP)` — not `natural`: §2 of the design ruling has generated
      // diagrams fill the column (or honor a committed width) regardless of
      // natural size, so the un-zoomed (100%) width already *is* this value.
      // Scaling from `natural` instead would, for any diagram smaller than
      // its column — the common case — make the first "Zoom in" click
      // shrink the drawing below its resting size.
      const scaled = base * this.#zoom
      this.#render.classList.toggle('is-wide', scaled > available)
      svg.style.width = `${scaled}px`
      return
    }

    // Fix round 1, Finding 1: a committed width (a drag, or a hand-typed
    // fence meta) is the reader's own explicit choice and wins over the
    // natural-width "wide" default below — the same way zoom, just above,
    // already wins over wide. Without this check first, the wide branch ran
    // unconditionally for an oversized natural width and returned before the
    // meta was ever read: a drag to 400px on an svg whose natural width
    // trips `#WIDEST_SQUEEZE` would commit `width=400` correctly and then
    // get overwritten straight back to natural (e.g. 1200px) on the very
    // next paint. §3 extends this from svg-only to every diagram block, the
    // same base the zoom branch above now shares.
    if (layout.width !== undefined) {
      this.#render.classList.toggle('is-wide', false)
      // Floated figures self-size (fit-content): capping at the container
      // would chase our own shadow. The stylesheet clamps to 60% instead.
      const chosen = layout.float !== undefined ? base : Math.min(base, available)
      svg.style.width = `${chosen}px`
      return
    }

    const wide = natural > available * DiagramNodeView.#WIDEST_SQUEEZE
    this.#render.classList.toggle('is-wide', wide)
    // The offer to open it full screen belongs to the figure that does not fit,
    // and to no other. Kept on the block rather than the render because the
    // button is positioned against the block's padding.
    this.dom.classList.toggle('has-wide-figure', wide)
    this.#markScrollEnd()

    if (wide) {
      // Legibility beats fitting: the drawing keeps its own size and the
      // figure scrolls, unchanged for every language. The explicit length is
      // load-bearing, not just the number: `width: auto` is not enough to
      // restore natural size, because Mermaid writes `width="100%"` as an
      // *attribute*, which an `auto` computed width defers to — so the
      // diagram obediently shrank back into the column and the scrolling had
      // nothing to scroll. Only an explicit length overrides it.
      svg.style.width = `${natural}px`
      return
    }

    if (language === 'svg') {
      // §2: a pasted SVG has an author-chosen size (no meta width — that
      // case returned above). Cap at the column, but never inflate —
      // inflating is for renders whose size the engine invented, not for a
      // drawing that arrived with one.
      this.#render.classList.remove('is-wide')
      // Floated figures self-size (fit-content): capping at the container
      // would chase our own shadow. The stylesheet clamps to 60% instead.
      const chosen = layout.float !== undefined ? natural : Math.min(natural, available)
      svg.style.width = `${chosen}px`
      return
    }

    // Generated diagrams (mermaid, dot, vega-lite) fill the measure; the
    // stylesheet's `width: 100%` does that once no explicit width remains.
    svg.style.removeProperty('width')
  }

  static readonly #MAX_FIX_ATTEMPTS = 3

  /** Set in `destroy()`; stops the fix-it loop from writing into a torn-down block. */
  #destroyed = false

  async #copyError(): Promise<void> {
    if (this.clipboard === undefined) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const text = formatDiagramErrorForCopy(language, this.#textarea.value, this.#errorMessage.textContent ?? '')
    const ok = await this.clipboard.write({ 'text/plain': text })
    this.#copyButton.textContent = ok ? 'Copied' : 'Copy failed'
    window.setTimeout(() => {
      if (this.#destroyed) return
      this.#copyButton.textContent = 'Copy'
    }, 1500)
  }

  async #runFix(): Promise<void> {
    if (this.diagramFix === undefined) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'

    this.#fixButton.disabled = true
    this.#copyButton.disabled = true
    let errorMessage = this.#lastRenderError ?? ''

    for (let attempt = 1; attempt <= DiagramNodeView.#MAX_FIX_ATTEMPTS; attempt += 1) {
      if (this.#destroyed) return
      this.#fixButton.textContent = `Fixing… (${attempt}/${DiagramNodeView.#MAX_FIX_ATTEMPTS})`

      const outcome = await this.diagramFix.fix(language, this.#textarea.value, errorMessage)
      if (this.#destroyed) return

      if (!outcome.ok) {
        // A transport/auth failure, not a syntax error the model could retry.
        // Stop immediately rather than spending the remaining attempts on a
        // request that cannot succeed.
        this.#errorMessage.textContent = outcome.message
        break
      }

      this.#textarea.value = outcome.source
      this.#writeSource(outcome.source)
      const rendered = await this.#paint()
      if (this.#destroyed) return

      if (rendered.ok) {
        this.#fixButton.disabled = false
        this.#copyButton.disabled = false
        this.#fixButton.textContent = 'Fix it'
        return
      }

      errorMessage = rendered.message
      if (attempt === DiagramNodeView.#MAX_FIX_ATTEMPTS) {
        this.#errorMessage.textContent =
          `Couldn't auto-fix after ${DiagramNodeView.#MAX_FIX_ATTEMPTS} attempts. Last error: ${rendered.message}`
      }
    }

    this.#fixButton.disabled = false
    this.#copyButton.disabled = false
    this.#fixButton.textContent = 'Fix it'
  }

  /** Renders the node's current content and paints the result. Returns it so callers — the fix-it loop — can inspect success without a second render. */
  async #paint(): Promise<RenderedDiagram> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    // A renderer that *throws* is a crash, not the `{ok: false}` a parser
    // returns for source it can read but not draw. Every caller invokes this as
    // `void this.#paint()`, so without this the rejection went nowhere: the
    // block kept the previous picture and reported nothing.
    let result: RenderedDiagram
    try {
      result = await this.renderer.render(language, this.#node.textContent)
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (token !== this.#renderToken) return result

    if (result.ok) {
      this.#render.innerHTML = result.markup
      this.#error.hidden = true
      this.#fitDiagram()
      this.#refreshChipState()
      this.#refreshNarrow()
      return result
    }

    // Fail visibly and locally: keep the source reachable and show the parser's
    // own message rather than an empty frame.
    this.#render.replaceChildren()
    this.#error.hidden = false
    this.#errorMessage.textContent = result.message
    this.#lastRenderError = result.message
    this.#refreshChipState()
    this.#refreshNarrow()
    return result
  }

  /** The block's position, for registry lookups. */
  blockPos(): number | undefined {
    return this.getPos()
  }

  language(): string {
    return (this.#node.attrs['language'] as string | undefined) ?? ''
  }

  /** `DiagramController.editSource()`'s entry point: opens the source sheet. */
  openSource(): void {
    this.#setShowingSource(true)
  }

  /** `DiagramController.zoomIn/zoomOut/zoomReset()`'s entry point. */
  zoomBy(step: 'in' | 'out' | 'reset'): boolean {
    if (!isZoomableLanguage(this.language())) return false
    if (step === 'reset') this.#setZoom(1)
    else if (step === 'in') this.#setZoom(this.#zoom * DiagramNodeView.#ZOOM_STEP)
    else this.#setZoom(this.#zoom / DiagramNodeView.#ZOOM_STEP)
    return true
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    this.#applyFloat()
    if (this.#textarea.value !== node.textContent && document.activeElement !== this.#textarea) {
      // Refresh source without recreating the NodeView or stealing focus.
      this.#textarea.value = node.textContent
    }
    void this.#paint()
    return true
  }

  /** ProseMirror tells us when the block is the selection; show it. */
  selectNode(): void {
    this.dom.classList.add('is-selected')
    this.#chips = this.#buildChips()
    this.dom.append(this.#chips)
    document.addEventListener('keydown', this.#onSelectionEscape)
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
    this.#chips?.remove()
    this.#chips = undefined
    this.#zoomLevel = undefined
    document.removeEventListener('keydown', this.#onSelectionEscape)
  }

  /** Inner control activity is ours, not ProseMirror's. */
  stopEvent(event: Event): boolean {
    return (
      event.target === this.#copyButton ||
      event.target === this.#fixButton ||
      this.#sheet.contains(event.target as Node) ||
      (this.#chips !== undefined && event.target instanceof Node && this.#chips.contains(event.target)) ||
      (this.#grip !== undefined && event.target instanceof Node && this.#grip.contains(event.target))
    )
  }

  /** The rendered SVG is ours too; ProseMirror must not try to reconcile it. */
  ignoreMutation(): boolean {
    return true
  }

  /**
   * Drops the edge fade once there is nothing left behind it.
   *
   * The fade exists to say the drawing continues past the edge. Leaving it up
   * at the far end would keep making that promise after it stopped being true,
   * which reads as a rendering fault rather than an affordance.
   */
  #markScrollEnd = (): void => {
    const remaining = this.#render.scrollWidth - this.#render.clientWidth - this.#render.scrollLeft
    this.#render.classList.toggle('is-at-end', remaining <= 2)
  }

  /** Hands the rendered drawing to the full-screen reader. */
  #openViewer(): void {
    const svg = this.#render.querySelector('svg')
    if (svg === null) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'diagram'
    this.#closeViewer?.()
    this.#closeViewer = openFigureViewer(svg, `${language} figure`)
  }

  destroy(): void {
    this.#destroyed = true
    this.registry?.deregister(this)
    this.#closeViewer?.()
    this.#render.removeEventListener('scroll', this.#markScrollEnd)
    this.#renderToken += 1
    this.#scheme?.removeEventListener('change', this.#onSchemeChange)
    this.#sheetHeader.removeEventListener('pointerdown', this.#beginDrag)
    // The sheet lives on <body>, so this listener would outlive the block that
    // owns it if the node is destroyed while the sheet is open.
    document.removeEventListener('keydown', this.#onEscape)
    // Same reasoning, for the selection-Escape listener: destroyed while
    // selected (e.g. the whole editor unmounts) must not leak it onto <body>.
    document.removeEventListener('keydown', this.#onSelectionEscape)
    this.#resize.disconnect()
    this.#sheet.remove()
    // The menu lives on <body> too, so it would outlive its block just the same.
    this.#closeMenu()
    this.#chips?.remove()
    this.dom.removeEventListener('contextmenu', this.#openMenu)
  }
}
