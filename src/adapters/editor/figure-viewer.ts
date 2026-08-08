/**
 * A rendered figure, opened full screen and put under a thumb.
 *
 * A chart authored at 760px on a 402pt phone is not a layout problem that
 * better CSS solves — squeezing it to the column makes its labels unreadable,
 * and letting it scroll inside its own box hides most of it behind an edge with
 * nothing to say more is there. Notes and Bear both answer this the same way:
 * the figure stays small in the document and opens to the whole screen when you
 * ask, where zoom and pan are gestures rather than controls.
 *
 * The viewer shows a *clone*. It never borrows the live node, so dismissing it
 * cannot leave the document short of a diagram, and nothing here can edit —
 * this is a reading surface, and correction stays in the source sheet where the
 * bytes are.
 */

/** Beyond this the drawing is bigger than any use for it. */
const MAX_SCALE = 8

/** Below this the figure is smaller than its thumbnail in the document. */
const MIN_SCALE = 0.5

/** What a double tap jumps to when the figure is already fitted. */
const DOUBLE_TAP_SCALE = 2.5

/** Two taps further apart in time than this are two separate taps. */
const DOUBLE_TAP_MS = 300

interface Point {
  readonly x: number
  readonly y: number
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Opens `figure` full screen until dismissed.
 *
 * Returns a function that closes it, so a caller tearing down its own node view
 * can take the viewer with it rather than leaving an overlay above a document
 * that no longer exists.
 */
export function openFigureViewer(figure: SVGElement, title: string): () => void {
  const overlay = document.createElement('div')
  overlay.className = 'figure-viewer'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', title)

  const stage = document.createElement('div')
  stage.className = 'figure-viewer-stage'

  const clone = figure.cloneNode(true) as SVGElement
  // The document sizes its figures to a column; here the only constraint is the
  // screen, so whatever inline width the fit logic left behind has to go.
  clone.style.removeProperty('width')
  clone.style.removeProperty('max-width')
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  stage.append(clone)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'figure-viewer-close'
  close.textContent = 'Done'

  const hint = document.createElement('p')
  hint.className = 'figure-viewer-hint'
  hint.textContent = 'Pinch to zoom · drag to move · double-tap to fit'

  overlay.append(stage, close, hint)
  document.body.append(overlay)

  let scale = 1
  let offsetX = 0
  let offsetY = 0
  const paint = (): void => {
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
  }

  const fit = (): void => {
    scale = 1
    offsetX = 0
    offsetY = 0
    paint()
  }

  /** Live pointers, so a second finger turns a drag into a pinch mid-gesture. */
  const pointers = new Map<number, Point>()
  let pinchDistance = 0
  let pinchScale = 1
  let lastPan: Point | undefined
  let lastTapAt = 0

  const onPointerDown = (event: PointerEvent): void => {
    if (close.contains(event.target as Node)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    overlay.setPointerCapture(event.pointerId)

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      if (a !== undefined && b !== undefined) {
        pinchDistance = distance(a, b)
        pinchScale = scale
      }
      lastPan = undefined
      return
    }
    lastPan = { x: event.clientX, y: event.clientY }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      if (a === undefined || b === undefined || pinchDistance === 0) return
      const next = pinchScale * (distance(a, b) / pinchDistance)
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
      paint()
      return
    }

    if (lastPan === undefined) return
    offsetX += event.clientX - lastPan.x
    offsetY += event.clientY - lastPan.y
    lastPan = { x: event.clientX, y: event.clientY }
    paint()
  }

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinchDistance = 0
    if (pointers.size === 0) lastPan = undefined
  }

  // A tap that neither zoomed nor panned is a request to leave, which is how
  // every full-screen photo on this platform behaves. A double tap is the
  // shortcut between fitted and close-up.
  const onClick = (event: MouseEvent): void => {
    if (close.contains(event.target as Node)) return
    const now = event.timeStamp
    if (now - lastTapAt < DOUBLE_TAP_MS) {
      lastTapAt = 0
      if (scale === 1) {
        scale = DOUBLE_TAP_SCALE
        paint()
      } else {
        fit()
      }
      return
    }
    lastTapAt = now
    if (stage.contains(event.target as Node)) return
    dismiss()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss()
  }

  // Rotating the device changes what "fitted" means, and a figure left at an
  // offset computed for portrait lands somewhere arbitrary in landscape.
  const onResize = (): void => fit()

  let dismissed = false
  function dismiss(): void {
    if (dismissed) return
    dismissed = true
    overlay.removeEventListener('pointerdown', onPointerDown)
    overlay.removeEventListener('pointermove', onPointerMove)
    overlay.removeEventListener('pointerup', onPointerUp)
    overlay.removeEventListener('pointercancel', onPointerUp)
    overlay.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('resize', onResize)
    overlay.remove()
  }

  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('pointermove', onPointerMove)
  overlay.addEventListener('pointerup', onPointerUp)
  overlay.addEventListener('pointercancel', onPointerUp)
  overlay.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onResize)
  close.addEventListener('click', dismiss)

  paint()
  close.focus()
  return dismiss
}
